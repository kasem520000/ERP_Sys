import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  IN_ACTOR,
  TENANT_IN,
  installments,
  mintPostedInvoice,
  plans,
  receipts,
  setupInstallmentsFixture,
  su,
  treasuryAllocations,
  withTenant,
  type InstallmentsFixture,
} from "./fixtures";

/**
 * installments-rules.spec (PHASE-027 wave G — BUSINESS_RULES §8 rows
 * BR-048/BR-049 + the G-28 golden): the plan builder/activation gate, the
 * schedule kernel's exact rounding, the late-fee policy shape, and the
 * collections attribution (down-payment slice excluded, receipt_refs
 * accumulate, PAID flips, WAIVED sticky — Σ line collections ≤ settled).
 * Every G-28 journal flows through the real PostingService; attribution
 * recompute reads REAL posted receipts (ReceiptService + allocations +
 * post — never synthesized rows).
 */

let fixture: InstallmentsFixture;

beforeAll(async () => {
  fixture = await setupInstallmentsFixture();
});

function n4(value: string | number | null | undefined): string {
  return new Decimal(String(value ?? "0")).toDecimalPlaces(4).toFixed(4);
}

/** Residue surfaces for zero-partial probes. */
async function residue(): Promise<Record<string, number>> {
  const client = await su();
  const count = async (table: string): Promise<number> => {
    const result = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [TENANT_IN],
    );
    return result.rows[0]?.n ?? 0;
  };
  const snapshot = {
    plans: await count("installment_plans"),
    lines: await count("installment_lines"),
    journals: await count("journal_entries"),
  };
  await client.end();
  return snapshot;
}

describe("BR-048 — the schedule kernel (pure, exact outputs)", () => {
  it("10,000/3 → 3333.3333 × 2 + 3333.3334 on the last line (remainder absorption)", async () => {
    const { computeSchedule, advanceDate } = await import("../../modules/installments/application/plan-service");
    const schedule = computeSchedule({
      total: "10000.0000",
      down: "0.0000",
      count: 3,
      startDate: "2026-07-01",
      frequency: "MONTHLY",
    });
    expect(schedule.map((line) => [line.seq, line.dueDate, line.amount])).toEqual([
      [1, "2026-07-01", "3333.3333"],
      [2, advanceDate("2026-07-01", "MONTHLY", 1), "3333.3333"],
      [3, advanceDate("2026-07-01", "MONTHLY", 2), "3333.3334"],
    ]);
    // Σ == total − down EXACTLY.
    const sum = schedule.reduce((acc, line) => new Decimal(acc).plus(line.amount), new Decimal("0"));
    expect(sum.toDecimalPlaces(4).toFixed(4)).toBe("10000.0000");
  });

  it("the stored lines equal the kernel's outputs byte-for-byte (a 3-way split of 10,000)", async () => {
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const { computeSchedule } = await import("../../modules/installments/application/plan-service");
    const created = await withTenant(TENANT_IN, async () => {
      const minted = await mintPostedInvoice({
        partnerId: fixture.partnerId,
        amount: "10000.0000",
        invoiceNo: "IN-INV-KERNEL",
        invoiceDate: "2026-06-05",
      });
      return plans.createPlan({
        sourceType: "sales_invoice",
        sourceId: minted.invoiceId,
        downPayment: "0.0000",
        count: 3,
        startDate: "2026-07-01",
        frequency: "MONTHLY",
        actorId: IN_ACTOR,
      });
    });
    // Draft (NULL status) — never activated yet.
    expect(created.plan.status).toBeNull();
    const kernel = computeSchedule({
      total: "10000.0000",
      down: "0.0000",
      count: 3,
      startDate: "2026-07-01",
      frequency: "MONTHLY",
    });
    const stored = await withTenant(TENANT_IN, () => store.listLinesByPlan(created.plan.id));
    expect(stored.map((line) => [line.seq, line.dueDate, line.amount, line.status])).toEqual(
      kernel.map((line) => [line.seq, line.dueDate, line.amount, "PENDING"]),
    );
  });
});

describe("BR-048 — activation (the total gate + immutability)", () => {
  it("a mismatched plan total rejects PLAN_TOTAL_MISMATCH; the matching one activates and locks", async () => {
    // The mismatch draft: total override 11,000 ≠ the live source 12,000.
    const mismatchDraft = await withTenant(TENANT_IN, () =>
      plans.createPlan({
        sourceType: "sales_invoice",
        sourceId: fixture.invoices.invoiceId,
        totalAmount: "11000.0000",
        downPayment: "2000.0000",
        count: 4,
        startDate: "2026-07-01",
        frequency: "MONTHLY",
        actorId: IN_ACTOR,
      }),
    );
    const before = await residue();
    await expect(
      withTenant(TENANT_IN, () => plans.activatePlan(mismatchDraft.plan.id, IN_ACTOR)),
    ).rejects.toMatchObject({ code: "PLAN_TOTAL_MISMATCH" });
    expect(await residue()).toEqual(before);

    // The matching plan over a fresh 12,000 invoice activates.
    const world = await withTenant(TENANT_IN, async () => {
      const minted = await mintPostedInvoice({
        partnerId: fixture.partnerId,
        amount: "12000.0000",
        invoiceNo: "IN-INV-ACT",
        invoiceDate: "2026-06-05",
      });
      const created = await plans.createPlan({
        sourceType: "sales_invoice",
        sourceId: minted.invoiceId,
        downPayment: "2000.0000",
        count: 4,
        startDate: "2026-07-01",
        frequency: "MONTHLY",
        actorId: IN_ACTOR,
      });
      return { planId: created.plan.id, itemId: minted.itemId, invoiceId: minted.invoiceId };
    });
    const activated = await withTenant(TENANT_IN, () => plans.activatePlan(world.planId, IN_ACTOR));
    expect(activated.status).toBe("ACTIVE");
    expect(activated.activatedAt).not.toBeNull();

    // The schedule is immutable after activation (the manual-409).
    await expect(
      withTenant(TENANT_IN, () =>
        plans.editDraft(world.planId, { downPayment: "1000.0000", count: 6 }, IN_ACTOR),
      ),
    ).rejects.toMatchObject({ code: "SCHEDULE_IMMUTABLE" });
    // A second activation attempt is equally blocked.
    await expect(withTenant(TENANT_IN, () => plans.activatePlan(world.planId, IN_ACTOR))).rejects.toMatchObject({
      code: "SCHEDULE_IMMUTABLE",
    });
  });
});

describe("BR-049 — the late-fee policy shape (PLACEHOLDER defaults, never silent)", () => {
  it("a plan without explicit policy carries the documented PLACEHOLDER defaults", async () => {
    const created = await withTenant(TENANT_IN, async () => {
      const minted = await mintPostedInvoice({
        partnerId: fixture.partnerId,
        amount: "4000.0000",
        invoiceNo: "IN-INV-POLICY",
        invoiceDate: "2026-06-05",
      });
      return plans.createPlan({
        sourceType: "sales_invoice",
        sourceId: minted.invoiceId,
        downPayment: "2000.0000",
        count: 4,
        startDate: "2026-07-01",
        frequency: "MONTHLY",
        actorId: IN_ACTOR,
      });
    });
    expect(created.plan.lateFeePolicy).toEqual({
      rate: "0.0200",
      cap: "500.0000",
      grace_days: 7,
      auto_charge: false,
      defaulted_after_lines: 3,
    });
  });
});

describe("G-28 — the late fee (flat, engine-only, once per line)", () => {
  it("an OVERDUE 500 line at rate 0.0200 cap 500 charges exactly 10; the new AR item is allocatable", async () => {
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    const world = await withTenant(TENANT_IN, async () => {
      const minted = await mintPostedInvoice({
        partnerId: fixture.partnerId,
        amount: "4000.0000",
        invoiceNo: "N-INV-G28",
        invoiceDate: "2026-06-05",
      });
      const created = await plans.createPlan({
        sourceType: "sales_invoice",
        sourceId: minted.invoiceId,
        downPayment: "2000.0000",
        count: 4,
        startDate: "2026-07-01",
        frequency: "MONTHLY",
        lateFeePolicy: { rate: "0.0200", cap: "500.0000", grace_days: 7 },
        actorId: IN_ACTOR,
      });
      const activated = await plans.activatePlan(created.plan.id, IN_ACTOR);
      return { planId: activated.id };
    });
    // Flip line 1 OVERDUE via the date rules (service path, due 07-01 +8d).
    const linesBefore = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    expect(linesBefore.map((line) => [line.seq, line.amount])).toEqual([
      [1, "500.0000"],
      [2, "500.0000"],
      [3, "500.0000"],
      [4, "500.0000"],
    ]);
    const planRow = (await withTenant(TENANT_IN, () => plans.getPlan(world.planId))).plan;
    await withTenant(TENANT_IN, () =>
      installments.applyPlanPolicyOutcome(planRow, linesBefore, "2026-07-09"),
    );
    const afterFlip = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    expect(afterFlip[0]!.status).toBe("OVERDUE");

    const charged = await withTenant(TENANT_IN, () =>
      installments.chargeLateFee({ lineId: afterFlip[0]!.id, actorId: IN_ACTOR }),
    );
    expect(n4(charged.fee)).toBe("10.0000");
    expect(charged.line.lateFeeEntryId).not.toBeNull();

    // The G-28 golden lines: DR AR_CONTROL (partner) · CR LATE_FEE_INCOME.
    const entry = await withTenant(TENANT_IN, () =>
      journal.findEntryBySourceKey("installment_line", afterFlip[0]!.id, "late_fee"),
    );
    expect(entry).toBeDefined();
    const lines = await withTenant(TENANT_IN, () => journal.listLines(entry!.id));
    expect(lines.map((line) => [line.accountId, line.direction, n4(line.amount), line.partnerId ?? null])).toEqual([
      [fixture.accountIds.arControl, "DEBIT", "10.0000", fixture.partnerId],
      [fixture.accountIds.lateFeeIncome, "CREDIT", "10.0000", null],
    ]);

    // The fee lands as a NEW AR open item — allocatable like any AR item.
    const open = await withTenant(TENANT_IN, () =>
      treasury.listOpenItems({ partnerId: fixture.partnerId, side: "AR", openOnly: true, limit: 200 }),
    );
    const feeItem = open.find((row) => row.sourceType === "installment_line" && row.sourceId === afterFlip[0]!.id);
    expect(feeItem).toBeDefined();
    expect(n4(feeItem!.outstanding)).toBe("10.0000");

    // INV-013: the second attempt rejects (already charged).
    const before = await residue();
    await expect(
      withTenant(TENANT_IN, () => installments.chargeLateFee({ lineId: afterFlip[0]!.id, actorId: IN_ACTOR })),
    ).rejects.toMatchObject({ code: "LATE_FEE_NOT_CHARGEABLE" });
    expect(await residue()).toEqual(before);
  });

  it("the cap is honored: cap 7.0000 on a 500 line charges 7, not 10", async () => {
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const world = await withTenant(TENANT_IN, async () => {
      const minted = await mintPostedInvoice({
        partnerId: fixture.partnerId,
        amount: "4000.0000",
        invoiceNo: "N-INV-G28-CAP",
        invoiceDate: "2026-06-05",
      });
      const created = await plans.createPlan({
        sourceType: "sales_invoice",
        sourceId: minted.invoiceId,
        downPayment: "2000.0000",
        count: 4,
        startDate: "2026-07-01",
        frequency: "MONTHLY",
        lateFeePolicy: { rate: "0.0200", cap: "7.0000", grace_days: 7 },
        actorId: IN_ACTOR,
      });
      return plans.activatePlan(created.plan.id, IN_ACTOR);
    });
    const lines = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.id));
    await withTenant(TENANT_IN, () => installments.applyPlanPolicyOutcome(world, lines, "2026-07-09"));
    const afterFlip = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.id));
    const charged = await withTenant(TENANT_IN, () =>
      installments.chargeLateFee({ lineId: afterFlip[0]!.id, actorId: IN_ACTOR }),
    );
    expect(n4(charged.fee)).toBe("7.0000");
    expect(n4(charged.line.lateFeeAmount ?? "0")).toBe("7.0000");
  });
});

describe("BR-048 — the collections attribution (derived from posted receipts)", () => {
  it("down slice excluded; receipt_refs accumulate; PAID flips; Σ ≤ settled; WAIVED sticky", async () => {
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    // A fresh 12,000 plan: down 2,000 + 4 × 2,500.
    const world = await withTenant(TENANT_IN, async () => {
      const minted = await mintPostedInvoice({
        partnerId: fixture.partnerId,
        amount: "12000.0000",
        invoiceNo: "N-INV-ATTR",
        invoiceDate: "2026-06-05",
      });
      const created = await plans.createPlan({
        sourceType: "sales_invoice",
        sourceId: minted.invoiceId,
        downPayment: "2000.0000",
        count: 4,
        startDate: "2026-07-01",
        frequency: "MONTHLY",
        actorId: IN_ACTOR,
      });
      const activated = await plans.activatePlan(created.plan.id, IN_ACTOR);
      return { planId: activated.id, itemId: minted.itemId, invoiceId: minted.invoiceId };
    });

    // A REAL posted receipt of 4,500 against the invoice (down 2,000 + L1).
    const receipt1 = await withTenant(TENANT_IN, async () => {
      const created = await receipts.create({
        cashAccountId: fixture.bankId,
        partnerId: fixture.partnerId,
        method: "BANK",
        payerName: "Customer A",
        currencyCode: "SAR",
        amount: "4500.0000",
        exchangeRate: null,
        valueDate: "2026-07-05",
        reference: null,
        description: "down + first installment",
        descriptionAr: null,
        actorId: IN_ACTOR,
      });
      await treasuryAllocations.setAllocations({
        docType: "receipt",
        docId: created.id,
        allocations: [{ openItemId: world.itemId, amount: "4500.0000" }],
        actorId: IN_ACTOR,
      });
      const posted = await receipts.post(created.id, IN_ACTOR);
      return { id: created.id, docNo: posted.docNo };
    });

    // Recompute: the down-payment slice is excluded; L1 flips PAID.
    const planRow = (await withTenant(TENANT_IN, () => plans.getPlan(world.planId))).plan;
    const first = await withTenant(TENANT_IN, () => installments.recomputePlanCollections(planRow));
    const linesAfterFirst = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    expect(linesAfterFirst.map((line) => [line.seq, line.status, n4(line.collectedAmount)])).toEqual([
      [1, "PAID", "2500.0000"],
      [2, "PENDING", "0.0000"],
      [3, "PENDING", "0.0000"],
      [4, "PENDING", "0.0000"],
    ]);
    expect(linesAfterFirst[0]!.receiptRefs).toEqual([
      {
        receiptId: receipt1.id,
        receiptNo: receipt1.docNo,
        amount: "2500.0000",
        valueDate: "2026-07-05",
      },
    ]);
    expect(first.allDone).toBe(false);

    // INV-016 tie: Σ line collections ≤ settled (2,500 ≤ 4,500).
    const settled = (await withTenant(TENANT_IN, () =>
      treasury.findOpenItemById(world.itemId),
    ))!.settledAmount;
    const collected = linesAfterFirst.reduce(
      (acc, line) => new Decimal(acc).plus(line.collectedAmount),
      new Decimal("0"),
    );
    expect(collected.toDecimalPlaces(4).toFixed(4)).toBe("2500.0000");
    expect(new Decimal(collected).lessThanOrEqualTo(new Decimal(settled))).toBe(true);

    // WAIVE line 2 with a reason — sticky under every recompute.
    const linesBeforeWaive = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    const waived = await withTenant(TENANT_IN, () =>
      installments.waiveLine({ lineId: linesBeforeWaive[1]!.id, reason: "goodwill gesture", actorId: IN_ACTOR }),
    );
    expect(waived.status).toBe("WAIVED");
    expect(waived.waiveReason).toBe("goodwill gesture");

    // A second receipt of 2,500: the WAIVED line is skipped — the stream
    // flows into line 3 (never the waived line 2).
    await withTenant(TENANT_IN, async () => {
      const created = await receipts.create({
        cashAccountId: fixture.bankId,
        partnerId: fixture.partnerId,
        method: "BANK",
        payerName: "Customer A",
        currencyCode: "SAR",
        amount: "2500.0000",
        exchangeRate: null,
        valueDate: "2026-08-05",
        reference: null,
        description: "third installment",
        descriptionAr: null,
        actorId: IN_ACTOR,
      });
      await treasuryAllocations.setAllocations({
        docType: "receipt",
        docId: created.id,
        allocations: [{ openItemId: world.itemId, amount: "2500.0000" }],
        actorId: IN_ACTOR,
      });
      await receipts.post(created.id, IN_ACTOR);
    });
    await withTenant(TENANT_IN, () => installments.recomputePlanCollections(planRow));
    const final = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    // L3 lands 2,500 of its 2,500 — fully collected ⇒ PAID (the same flip
    // rule the first assertion pins for L1; a line at collected == amount is
    // never left PENDING).
    expect(final.map((line) => [line.seq, line.status, n4(line.collectedAmount)])).toEqual([
      [1, "PAID", "2500.0000"],
      [2, "WAIVED", "0.0000"],
      [3, "PAID", "2500.0000"],
      [4, "PENDING", "0.0000"],
    ]);
    expect(final[1]!.waivedAt).not.toBeNull();
    expect(final[1]!.collectedAmount).toBe("0.0000");
  });
});
