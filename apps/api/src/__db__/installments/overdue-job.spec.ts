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
 * overdue-job.spec (PHASE-027 wave G — BR-049's date rules): the OVERDUE
 * state is JOB-DERIVED ONLY — the sweep flips DUE at due_date, OVERDUE
 * after grace, DEFAULTED after N consecutive; re-runs are idempotent by
 * rebuild (statuses + receipt_refs stable); close-on-residual-zero; and
 * the auto-charge policy leg posts the G-28 journals only when explicitly
 * ON (the default is OFF — explicit tenant action only).
 *
 * The "no manual status writer beyond WAIVED" property is asserted by its
 * practical proxy: every DUE/OVERDUE/DEFAULTED transition in this spec
 * arrives through runInstallmentsSweep (the service layer exposes no other
 * caller that writes line status), and the re-run leaves the states
 * byte-stable — a manual writer would have raced the rebuild.
 */

let fixture: InstallmentsFixture;

beforeAll(async () => {
  fixture = await setupInstallmentsFixture();
});

function n4(value: string | number | null | undefined): string {
  return new Decimal(String(value ?? "0")).toDecimalPlaces(4).toFixed(4);
}

/** Runs the daily sweep with an explicit today (the job's plain body). */
async function sweep(today: string): Promise<void> {
  const { runInstallmentsSweep } = await import("../../modules/installments/infrastructure/overdue.job");
  await runInstallmentsSweep(installments, today);
}

/** A fresh activated plan: `total`, down 2,000, 4 lines, MONTHLY from 07-01. */
async function newPlan(input: {
  total: string;
  invoiceNo: string;
  policy?: Record<string, unknown>;
}): Promise<{ planId: string; itemId: string; lineIds: string[] }> {
  return withTenant(TENANT_IN, async () => {
    const minted = await mintPostedInvoice({
      partnerId: fixture.partnerId,
      amount: input.total,
      invoiceNo: input.invoiceNo,
      invoiceDate: "2026-06-05",
    });
    const created = await plans.createPlan({
      sourceType: "sales_invoice",
      sourceId: minted.invoiceId,
      downPayment: "2000.0000",
      count: 4,
      startDate: "2026-07-01",
      frequency: "MONTHLY",
      lateFeePolicy: input.policy as never,
      actorId: IN_ACTOR,
    });
    const activated = await plans.activatePlan(created.plan.id, IN_ACTOR);
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const lines = await store.listLinesByPlan(activated.id);
    return {
      planId: activated.id,
      itemId: minted.itemId,
      lineIds: lines.map((line) => line.id),
    };
  });
}

/** Posts one real receipt allocated to the invoice item. */
async function postReceipt(itemId: string, amount: string, valueDate: string): Promise<void> {
  await withTenant(TENANT_IN, async () => {
    const created = await receipts.create({
      cashAccountId: fixture.bankId,
      partnerId: fixture.partnerId,
      method: "BANK",
      payerName: "Customer A",
      currencyCode: "SAR",
      amount,
      exchangeRate: null,
      valueDate,
      reference: null,
      description: "overdue-job fixture receipt",
      descriptionAr: null,
      actorId: IN_ACTOR,
    });
    await treasuryAllocations.setAllocations({
      docType: "receipt",
      docId: created.id,
      allocations: [{ openItemId: itemId, amount }],
      actorId: IN_ACTOR,
    });
    await receipts.post(created.id, IN_ACTOR);
  });
}

describe("the daily sweep — DUE, then OVERDUE after grace (job-derived only)", () => {
  it("flips DUE inside grace, OVERDUE past it; a re-run is idempotent", async () => {
    const world = await newPlan({ total: "12000.0000", invoiceNo: "IN-INV-JOB1" });
    const store = await import("../../modules/installments/infrastructure/installments.store");

    // 2026-07-03: line 1 (due 07-01) is 2 days late — inside the 7-day
    // grace ⇒ DUE; the rest are still future ⇒ untouched PENDING.
    await sweep("2026-07-03");
    let lines = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    expect(lines.map((line) => [line.seq, line.status])).toEqual([
      [1, "DUE"],
      [2, "PENDING"],
      [3, "PENDING"],
      [4, "PENDING"],
    ]);

    // 2026-07-10: 9 days late — past grace ⇒ OVERDUE.
    await sweep("2026-07-10");
    lines = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    expect(lines[0]!.status).toBe("OVERDUE");

    // The idempotent re-run: identical statuses, stable receipt_refs (the
    // rebuild is deterministic — a replay never duplicates or drifts).
    const before = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    await sweep("2026-07-10");
    const after = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    expect(after.map((line) => [line.seq, line.status, line.collectedAmount, line.receiptRefs])).toEqual(
      before.map((line) => [line.seq, line.status, line.collectedAmount, line.receiptRefs]),
    );
    // No late-fee journals fired (auto_charge defaults OFF).
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    for (const lineId of world.lineIds) {
      const entry = await withTenant(TENANT_IN, () =>
        journal.findEntryBySourceKey("installment_line", lineId, "late_fee"),
      );
      expect(entry).toBeUndefined();
    }
  });
});

describe("the DEFAULTED flip + dunning", () => {
  it("N consecutive overdue lines flip the plan DEFAULTED and raise the dunning inbox row", async () => {
    const world = await newPlan({ total: "12000.0000", invoiceNo: "IN-INV-JOB2" });
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const planBefore = (await withTenant(TENANT_IN, () => plans.getPlan(world.planId))).plan;
    expect(planBefore.status).toBe("ACTIVE");

    // 2026-10-15: all four lines are past due + grace ⇒ 4 consecutive ≥ 3.
    await sweep("2026-10-15");
    const planAfter = (await withTenant(TENANT_IN, () => plans.getPlan(world.planId))).plan;
    expect(planAfter.status).toBe("DEFAULTED");
    expect(planAfter.defaultedAt).not.toBeNull();
    const lines = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    expect(lines.every((line) => line.status === "OVERDUE")).toBe(true);

    // The dunning inbox row exists (category installments).
    const client = await su();
    const inbox = await client.query(
      `SELECT category, severity FROM notifications WHERE tenant_id = $1 AND dedupe_key = $2`,
      [TENANT_IN, `installments-defaulted:${world.planId}`],
    );
    await client.end();
    expect(inbox.rows).toEqual([{ category: "installments", severity: "warning" }]);

    // The idempotent re-run: statuses + refs stable, still DEFAULTED.
    const before = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    await sweep("2026-10-15");
    const after = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    expect(after.map((line) => [line.seq, line.status, line.receiptRefs])).toEqual(
      before.map((line) => [line.seq, line.status, line.receiptRefs]),
    );
  });
});

describe("close-on-residual-zero", () => {
  it("collecting everything closes the plan on the sweep's tail", async () => {
    const world = await newPlan({ total: "12000.0000", invoiceNo: "IN-INV-JOB3" });
    // Collect the full 12,000: the down slice 2,000 + 4 × 2,500 lines.
    await postReceipt(world.itemId, "12000.0000", "2026-07-05");
    const planRow = (await withTenant(TENANT_IN, () => plans.getPlan(world.planId))).plan;
    const recompute = await withTenant(TENANT_IN, () => installments.recomputePlanCollections(planRow));
    expect(recompute.allDone).toBe(true);
    await sweep("2026-07-06");
    const planAfter = (await withTenant(TENANT_IN, () => plans.getPlan(world.planId))).plan;
    expect(planAfter.status).toBe("CLOSED");
    expect(planAfter.closedAt).not.toBeNull();
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const lines = await withTenant(TENANT_IN, () => store.listLinesByPlan(world.planId));
    expect(lines.every((line) => line.status === "PAID")).toBe(true);
    expect(lines.every((line) => n4(line.collectedAmount) === "2500.0000")).toBe(true);
  });
});

describe("the auto-charge policy leg (G-28 via the sweep)", () => {
  it("auto_charge ON posts the G-28 journals; the default OFF posts none", async () => {
    // ON: grace 0, cap 7 — the sweep charges as part of the daily job.
    const on = await newPlan({
      total: "12000.0000",
      invoiceNo: "IN-INV-JOB4",
      policy: { rate: "0.0200", cap: "7.0000", grace_days: 0, auto_charge: true },
    });
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    await sweep("2026-07-02");
    const onLines = await withTenant(TENANT_IN, () => store.listLinesByPlan(on.planId));
    expect(onLines[0]!.status).toBe("OVERDUE");
    expect(onLines[0]!.lateFeeEntryId).not.toBeNull();
    expect(n4(onLines[0]!.lateFeeAmount ?? "0")).toBe("7.0000");
    const entry = await withTenant(TENANT_IN, () =>
      journal.findEntryBySourceKey("installment_line", onLines[0]!.id, "late_fee"),
    );
    expect(entry).toBeDefined();
    const lines = await withTenant(TENANT_IN, () => journal.listLines(entry!.id));
    expect(lines.map((line) => [line.accountId, line.direction, n4(line.amount)])).toEqual([
      [fixture.accountIds.arControl, "DEBIT", "7.0000"],
      [fixture.accountIds.lateFeeIncome, "CREDIT", "7.0000"],
    ]);

    // OFF (the default): the JOB1 plan's lines never carry a fee journal —
    // already asserted in the first describe; the explicit OFF probe here
    // re-checks a fresh default plan over the same sweep date.
    const off = await newPlan({ total: "12000.0000", invoiceNo: "IN-INV-JOB5" });
    await sweep("2026-07-02");
    const offLines = await withTenant(TENANT_IN, () => store.listLinesByPlan(off.planId));
    for (const line of offLines) {
      expect(line.lateFeeEntryId).toBeNull();
      const entry2 = await withTenant(TENANT_IN, () =>
        journal.findEntryBySourceKey("installment_line", line.id, "late_fee"),
      );
      expect(entry2).toBeUndefined();
    }
  });
});
