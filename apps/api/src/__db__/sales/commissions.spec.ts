import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { CommissionService } from "../../modules/sales/commissions/application/commission-service";
import {
  CommissionRuleInvalidError,
  CommissionRunStateError,
} from "../../modules/sales/commissions/domain/commission-errors";
import { SalesRepNotFoundError } from "../../modules/sales/domain/sales-errors";
import { SalesRepService } from "../../modules/sales/application/reps";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import {
  S_ACTOR,
  S_CASHIER,
  S_FEB,
  S_JAN,
  S_SALES,
  TENANT_S,
  allocations,
  creditNotes,
  receipts,
  salesInvoices,
  setupSalesFixture,
  type SalesFixture,
} from "./fixtures";

/**
 * PHASE-017 T7-a commission packs (the phase §6 required set, DB-backed on
 * the real sales fixture): the accrual golden (DR COMMISSION_EXPENSE · CR
 * COMMISSION_ACCRUAL exactly at run post time, one journal per run, source
 * commission_run:accrual), INV-013 re-post idempotency, the reversed-sales
 * exclusion (posted invoice net − posted credit-note net), the tiered
 * portion math (1000×1% + 600×3% = 28), the COLLECTED basis (receipt
 * allocations attributed through the rep's invoices), rule validation
 * bounds, and the run state machine (DRAFT cancel; POSTED immutable —
 * corrections are journal reversals; zero-amount runs never post).
 */

let fixture: SalesFixture;
let commission: CommissionService;
let repA = "";
let repB = "";
let repC = "";

/** Jan window (the golden run) + Feb window (tiered/collected packs). */
const JAN = { from: "2026-01-01", to: "2026-01-31" };
const FEB = { from: "2026-02-01", to: "2026-02-28" };

beforeAll(async () => {
  fixture = await setupSalesFixture();
  const audit = new AuditService(new DrizzleAuditStore());
  const posting = new PostingService(audit, new PartnerSubledgerService());
  commission = new CommissionService(audit, posting);
  const reps = new SalesRepService(audit);

  await withTenant(TENANT_S, async () => {
    repA = (
      await reps.create({
        code: "S-REP-A",
        name: "Rep Alpha",
        nameAr: "المندوب أ",
        email: null,
        phone: null,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      })
    ).id;
    repB = (
      await reps.create({
        code: "S-REP-B",
        name: "Rep Beta",
        nameAr: "المندوب ب",
        email: null,
        phone: null,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      })
    ).id;
    repC = (
      await reps.create({
        code: "S-REP-C",
        name: "Rep Gamma",
        nameAr: "المندوب ج",
        email: null,
        phone: null,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      })
    ).id;

    // Rules: A flat 2% on invoiced sales; B flat 1% on COLLECTED sales
    // (excluded from INVOICED runs with a note); C tiered on invoiced sales.
    await commission.setRule(repA, { method: "PERCENTAGE", rate: "2", basis: "INVOICED" }, S_ACTOR);
    await commission.setRule(repB, { method: "PERCENTAGE", rate: "1", basis: "COLLECTED" }, S_ACTOR);
    await commission.setRule(
      repC,
      {
        method: "PERCENTAGE",
        basis: "INVOICED",
        tiers: [
          { upTo: "1000", rate: "1" },
          { upTo: null, rate: "3" },
        ],
      },
      S_ACTOR,
    );
  });
});

/** A fully-posted NS-tax CREDIT service invoice attributed to a rep. */
async function postedRepInvoice(
  note: string,
  net: string,
  salesRepId: string,
  invoiceDate: string,
): Promise<string> {
  const invoice = await withTenant(TENANT_S, () =>
    salesInvoices.create({
      branchId: fixture.branchId,
      customerId: fixture.customerId,
      salesRepId,
      kind: "CREDIT",
      invoiceDate,
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: null,
      note,
      noteAr: null,
      actorId: S_SALES,
      lines: [
        {
          itemId: null,
          accountId: fixture.gl.serviceAccount,
          deliveryLineId: null,
          description: "commission fixture charge",
          descriptionAr: null,
          qty: "1",
          unitPrice: `${net}.000000`,
          discountAmount: null,
          taxCodeId: fixture.taxCodeIds.notSubject,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT_S, () => salesInvoices.submit(invoice.id, S_SALES));
  await withTenant(TENANT_S, () => salesInvoices.approve(invoice.id, S_ACTOR, false));
  await withTenant(TENANT_S, () => salesInvoices.post(invoice.id, S_ACTOR));
  return invoice.id;
}

describe("T7-a · accrual golden — INVOICED run posts DR COMMISSION_EXPENSE · CR COMMISSION_ACCRUAL at run time", () => {
  let runId = "";
  let journalEntryId = "";

  it("seeds rep A's Jan sales: 3 posted invoices (1800) − 1 posted credit note (200) → base 1600", async () => {
    const invA1 = await postedRepInvoice("T7-a rep A invoice 1", "1000", repA, S_JAN);
    await postedRepInvoice("T7-a rep A invoice 2", "500", repA, S_JAN);
    await postedRepInvoice("T7-a rep A invoice 3", "300", repA, S_JAN);

    // The reversal channel: a POSTED credit note (−200) attributed to rep A.
    const lines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(invA1));
    const note = await withTenant(TENANT_S, () =>
      creditNotes.create({
        branchId: fixture.branchId,
        salesRepId: repA,
        invoiceId: invA1,
        noteDate: S_JAN,
        note: "T7-a credited 200 against invoice 1",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            invoiceLineId: lines[0]!.id,
            qty: "1",
            unitPrice: "200.000000",
            discountAmount: null,
            taxCodeId: null,
            returnToStock: false,
            batchId: null,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    expect(note.totalNet).toBe("200.0000");
    await withTenant(TENANT_S, () => creditNotes.submit(note.id, S_SALES));
    await withTenant(TENANT_S, () => creditNotes.approve(note.id, S_ACTOR));
    await withTenant(TENANT_S, () => creditNotes.post(note.id, S_ACTOR));
  });

  it("create (create+compute) shapes the lines: rep A 1600 × 2% = 32; rep B excluded with a detail note; rep C no activity", async () => {
    const created = await withTenant(TENANT_S, () =>
      commission.createRun({
        periodFrom: JAN.from,
        periodTo: JAN.to,
        basis: "INVOICED",
        note: "T7-a golden run",
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    runId = created.id;
    expect(created.status).toBe("DRAFT");
    expect(created.computedAt).not.toBeNull();
    expect(created.totalBase).toBe("1600.0000");
    expect(created.totalCommission).toBe("32.0000");

    const lineA = created.lines.find((line) => line.salesRepId === repA)!;
    expect(lineA.repCode).toBe("S-REP-A");
    expect(lineA.baseAmount).toBe("1600.0000");
    expect(lineA.rateApplied).toBe("2.0000");
    expect(lineA.commissionAmount).toBe("32.0000");
    expect(lineA.payoutStatus).toBe("ACCRUED");
    expect(lineA.paymentId).toBeNull();
    // The honest posted, non-reversed base: invoiced 1800 − credited 200.
    expect(lineA.detail).toMatchObject({
      excluded: false,
      method: "FLAT",
      invoicedNet: "1800.0000",
      creditedNet: "200.0000",
      collectedNet: "0.0000",
    });

    // Run-level basis: rep B's COLLECTED rule is excluded from an INVOICED
    // run — a zero note-line explains the absence on the statement.
    const lineB = created.lines.find((line) => line.salesRepId === repB)!;
    expect(lineB.baseAmount).toBe("0.0000");
    expect(lineB.commissionAmount).toBe("0.0000");
    expect(lineB.detail).toMatchObject({
      excluded: true,
      reason: "BASIS_MISMATCH",
      ruleBasis: "COLLECTED",
      runBasis: "INVOICED",
    });

    // Rep C has no January activity — zero base, no line.
    expect(created.lines.find((line) => line.salesRepId === repC)).toBeUndefined();
  });

  it("post accrues ONE journal: DR 5250 expense 32 (memo rep A) · CR 2150 accrual 32; run flips POSTED", async () => {
    const posted = await withTenant(TENANT_S, () => commission.post(runId, S_ACTOR));
    journalEntryId = posted.journalEntryId;
    expect(posted.idempotentReplay).toBe(false);
    expect(posted.entryNo).toMatch(/^JE-2026-\d{6}$/);

    // The EXACT golden journal (purposes resolved to the fixture accounts).
    const lines = await withTenant(TENANT_S, () => journal.listLines(journalEntryId));
    expect(
      lines.map((line) => ({ accountId: line.accountId, direction: line.direction, amount: line.amount, memo: line.memo })),
    ).toEqual([
      {
        accountId: fixture.gl.commissionExpense,
        direction: "DEBIT",
        amount: "32.0000",
        memo: "Commission — Rep Alpha (S-REP-A)",
      },
      {
        accountId: fixture.gl.commissionAccrual,
        direction: "CREDIT",
        amount: "32.0000",
        memo: `Commission accrual — run ${runId} (2026-01-01..2026-01-31, INVOICED)`,
      },
    ]);

    // One journal per run, source-keyed commission_run:accrual, balanced by
    // construction (Σ DR = Σ CR = 32) — the engine's own check is the backstop.
    const entry = await withTenant(TENANT_S, () => journal.findEntryBySourceKey("commission_run", runId, "accrual"));
    expect(entry).toBeDefined();
    expect(entry!.id).toBe(journalEntryId);
    expect(entry!.sourceType).toBe("commission_run");
    expect(entry!.operation).toBe("accrual");
    expect(entry!.status).toBe("POSTED");
    expect(entry!.entryDate).toBe("2026-01-31"); // accrual dated at period end (matching principle)

    // The run's POSTED shape + persisted lines.
    const after = await withTenant(TENANT_S, () => commission.findWithLines(runId));
    expect(after.status).toBe("POSTED");
    expect(after.journalEntryId).toBe(journalEntryId);
    expect(after.postedAt).not.toBeNull();
    expect(after.postedBy).toBe(S_ACTOR);
    expect(after.totalBase).toBe("1600.0000");
    expect(after.totalCommission).toBe("32.0000");
    const lineA = after.lines.find((line) => line.salesRepId === repA)!;
    expect(lineA.commissionAmount).toBe("32.0000");
    expect(lineA.payoutStatus).toBe("ACCRUED");
  });
});

describe("T7-a · INV-013 idempotency — a re-post creates no second accrual", () => {
  it("rejects the sequential re-post with the typed state error and the journal count is unchanged", async () => {
    const runs = await withTenant(TENANT_S, () => commission.list({ limit: 10 }));
    const postedRun = runs.find((run) => run.status === "POSTED")!;
    const before = await withTenant(TENANT_S, () =>
      journal.listEntries({ sourceType: "commission_run", limit: 100 }),
    );
    expect(before.rows.length).toBe(1);

    await expect(withTenant(TENANT_S, () => commission.post(postedRun.id, S_ACTOR))).rejects.toBeInstanceOf(
      CommissionRunStateError,
    );
    await expect(withTenant(TENANT_S, () => commission.post(postedRun.id, S_ACTOR))).rejects.toThrow(
      /already POSTED/,
    );

    const after = await withTenant(TENANT_S, () =>
      journal.listEntries({ sourceType: "commission_run", limit: 100 }),
    );
    expect(after.rows.length).toBe(1); // unchanged — exactly one accrual journal
  });
});

describe("T7-a · reversed-sales exclusion is structural (repeatable compute)", () => {
  it("a second run over the same window recomputes the SAME 1600 base (1800 − 200 credited) and cancels cleanly from DRAFT", async () => {
    const second = await withTenant(TENANT_S, () =>
      commission.createRun({
        periodFrom: JAN.from,
        periodTo: JAN.to,
        basis: "INVOICED",
        note: "T7-a repeat run",
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    const lineA = second.lines.find((line) => line.salesRepId === repA)!;
    expect(lineA.baseAmount).toBe("1600.0000");
    expect(lineA.detail).toMatchObject({ invoicedNet: "1800.0000", creditedNet: "200.0000" });
    expect(second.totalBase).toBe("1600.0000");
    expect(second.totalCommission).toBe("32.0000");

    const cancelled = await withTenant(TENANT_S, () =>
      commission.cancel(second.id, { reason: "superseded by the posted run", actorId: S_ACTOR }),
    );
    expect(cancelled.status).toBe("CANCELLED");
    await expect(
      withTenant(TENANT_S, () => commission.cancel(second.id, { reason: "again", actorId: S_ACTOR })),
    ).rejects.toBeInstanceOf(CommissionRunStateError);
  });
});

describe("T7-a · tiered portion math — bands apply to the base PORTION within them", () => {
  it("seeds rep C's February invoice (1600 net, INVOICED basis activity)", async () => {
    await postedRepInvoice("T7-a rep C invoice 1", "1600", repC, S_FEB);
  });

  it("rep C: tiers [≤1000 @1%, open @3%] on base 1600 → 1000×1% + 600×3% = 28 (effective rate 1.75)", async () => {
    const run = await withTenant(TENANT_S, () =>
      commission.createRun({
        periodFrom: FEB.from,
        periodTo: FEB.to,
        basis: "INVOICED",
        note: "T7-a tiered run",
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );

    // Seed check: rep C's February invoice IS this run's base.
    const lineC = run.lines.find((line) => line.salesRepId === repC)!;
    expect(lineC.baseAmount).toBe("1600.0000");
    expect(lineC.commissionAmount).toBe("28.0000");
    expect(lineC.rateApplied).toBe("1.7500"); // effective: 28 / 1600 × 100
    expect(lineC.detail).toMatchObject({
      method: "TIERED",
      invoicedNet: "1600.0000",
      creditedNet: "0.0000",
    });
    expect(lineC.detail!.bands).toEqual([
      { upTo: "1000.0000", rate: "1.0000", portion: "1000.0000", amount: "10.0000" },
      { upTo: null, rate: "3.0000", portion: "600.0000", amount: "18.0000" },
    ]);

    // Run-level basis mirror: rep B (COLLECTED rule) is excluded with a note.
    const lineB = run.lines.find((line) => line.salesRepId === repB)!;
    expect(lineB.detail).toMatchObject({ excluded: true, reason: "BASIS_MISMATCH" });
    // Rep A has no February sales — zero base, no line.
    expect(run.lines.find((line) => line.salesRepId === repA)).toBeUndefined();

    // The normalized rule round-trips through the store (4dp canonical bands).
    const rule = await withTenant(TENANT_S, () => commission.getRule(repC));
    expect(rule.method).toBe("PERCENTAGE");
    expect(rule.basis).toBe("INVOICED");
    expect(rule.rate).toBe("0.0000"); // tiered rules carry no flat rate
    expect(rule.tiers).toEqual([
      { upTo: "1000.0000", rate: "1.0000" },
      { upTo: null, rate: "3.0000" },
    ]);
  });
});

describe("T7-a · COLLECTED basis — the base is Σ receipt allocations against the rep's invoices", () => {
  it("seeds rep B's collected February cash: invoice 800 + posted receipt allocated 800", async () => {
    const invB1 = await postedRepInvoice("T7-a rep B invoice 1", "800", repB, S_FEB);
    const open = await withTenant(TENANT_S, () =>
      sStore.arOpenItemsAsOf({ customerId: fixture.customerId, asOf: "2026-02-20", openOnly: true, limit: 100 }),
    );
    const openItem = open.find((item) => item.sourceId === invB1)!;
    expect(openItem).toBeDefined();

    const receipt = await withTenant(TENANT_S, () =>
      receipts.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.customerId,
        method: "CASH",
        payerName: "شركة النور",
        currencyCode: "SAR",
        amount: "800.0000",
        exchangeRate: null,
        valueDate: S_FEB,
        reference: null,
        description: "T7-a collected-basis receipt",
        descriptionAr: null,
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: receipt.id,
        allocations: [{ openItemId: openItem.id, amount: "800.0000" }],
        actorId: S_CASHIER,
      }),
    );
    const posted = await withTenant(TENANT_S, () => receipts.post(receipt.id, S_CASHIER));
    expect(posted.docNo).toMatch(/^RCV-/);
  });

  it("the COLLECTED run earns rep B 800 × 1% = 8 and posts DR expense 8 · CR accrual 8", async () => {
    const run = await withTenant(TENANT_S, () =>
      commission.createRun({
        periodFrom: FEB.from,
        periodTo: FEB.to,
        basis: "COLLECTED",
        note: "T7-a collected run",
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );

    const lineB = run.lines.find((line) => line.salesRepId === repB)!;
    expect(lineB.baseAmount).toBe("800.0000");
    expect(lineB.rateApplied).toBe("1.0000");
    expect(lineB.commissionAmount).toBe("8.0000");
    expect(lineB.detail).toMatchObject({ collectedNet: "800.0000" });

    // The mirror exclusions: rep A and rep C hold INVOICED rules.
    const lineA = run.lines.find((line) => line.salesRepId === repA)!;
    expect(lineA.detail).toMatchObject({ excluded: true, reason: "BASIS_MISMATCH", runBasis: "COLLECTED" });
    expect(run.lines.find((line) => line.salesRepId === repC)!.detail).toMatchObject({ excluded: true });
    expect(run.totalBase).toBe("800.0000");
    expect(run.totalCommission).toBe("8.0000");

    const posted = await withTenant(TENANT_S, () => commission.post(run.id, S_ACTOR));
    const lines = await withTenant(TENANT_S, () => journal.listLines(posted.journalEntryId));
    expect(
      lines.map((line) => ({ accountId: line.accountId, direction: line.direction, amount: line.amount })),
    ).toEqual([
      { accountId: fixture.gl.commissionExpense, direction: "DEBIT", amount: "8.0000" },
      { accountId: fixture.gl.commissionAccrual, direction: "CREDIT", amount: "8.0000" },
    ]);
  });
});

describe("T7-a · rule validation + run state machine", () => {
  it("rejects rate bounds, NONE-with-rate, flat+tiers, and malformed/overlapping/unopened tier bands", async () => {
    await expect(
      withTenant(TENANT_S, () =>
        commission.setRule(repA, { method: "PERCENTAGE", rate: "150", basis: "INVOICED" }, S_ACTOR),
      ),
    ).rejects.toBeInstanceOf(CommissionRuleInvalidError);
    await expect(
      withTenant(TENANT_S, () => commission.setRule(repA, { method: "NONE", rate: "5" }, S_ACTOR)),
    ).rejects.toBeInstanceOf(CommissionRuleInvalidError);
    await expect(
      withTenant(TENANT_S, () =>
        commission.setRule(
          repA,
          {
            method: "PERCENTAGE",
            rate: "2",
            basis: "INVOICED",
            tiers: [
              { upTo: "1000", rate: "1" },
              { upTo: null, rate: "3" },
            ],
          },
          S_ACTOR,
        ),
      ),
    ).rejects.toBeInstanceOf(CommissionRuleInvalidError);
    // Unsorted bands (2000 then 1000) — overlapping/descending.
    await expect(
      withTenant(TENANT_S, () =>
        commission.setRule(
          repA,
          {
            method: "PERCENTAGE",
            basis: "INVOICED",
            tiers: [
              { upTo: "2000", rate: "1" },
              { upTo: "1000", rate: "3" },
              { upTo: null, rate: "3" },
            ],
          },
          S_ACTOR,
        ),
      ),
    ).rejects.toBeInstanceOf(CommissionRuleInvalidError);
    // No open band (last band bounded) — strands any base above it.
    await expect(
      withTenant(TENANT_S, () =>
        commission.setRule(
          repA,
          {
            method: "PERCENTAGE",
            basis: "INVOICED",
            tiers: [
              { upTo: "1000", rate: "1" },
              { upTo: "2000", rate: "3" },
            ],
          },
          S_ACTOR,
        ),
      ),
    ).rejects.toBeInstanceOf(CommissionRuleInvalidError);
    // Open band NOT last.
    await expect(
      withTenant(TENANT_S, () =>
        commission.setRule(
          repA,
          {
            method: "PERCENTAGE",
            basis: "INVOICED",
            tiers: [
              { upTo: null, rate: "1" },
              { upTo: "2000", rate: "3" },
            ],
          },
          S_ACTOR,
        ),
      ),
    ).rejects.toBeInstanceOf(CommissionRuleInvalidError);
    // Unknown rep — the A7-shaped not-found.
    await expect(
      withTenant(TENANT_S, () =>
        commission.setRule("00000000-0000-0000-0000-0000000000f7", { method: "NONE" }, S_ACTOR),
      ),
    ).rejects.toBeInstanceOf(SalesRepNotFoundError);
    await expect(
      withTenant(TENANT_S, () => commission.getRule("00000000-0000-0000-0000-0000000000f7")),
    ).rejects.toBeInstanceOf(SalesRepNotFoundError);
  });

  it("holds the state machine: POSTED never recomputes/cancels/posts; nothing-to-accrue never posts; unknown runs 404-shape", async () => {
    const postedRun = (await withTenant(TENANT_S, () => commission.list({ status: "POSTED", limit: 10 }))).find(
      (run) => run.periodFrom === JAN.from,
    )!;
    await expect(withTenant(TENANT_S, () => commission.compute(postedRun.id, S_ACTOR))).rejects.toBeInstanceOf(
      CommissionRunStateError,
    );
    await expect(
      withTenant(TENANT_S, () => commission.cancel(postedRun.id, { reason: "no", actorId: S_ACTOR })),
    ).rejects.toThrow(/immutable/);

    // A March run over an empty window: rep B's note-line only, nothing to
    // accrue — posting is a typed state error, and the DRAFT cancels fine.
    const empty = await withTenant(TENANT_S, () =>
      commission.createRun({
        periodFrom: "2026-03-01",
        periodTo: "2026-03-31",
        basis: "INVOICED",
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    expect(empty.totalCommission).toBe("0.0000");
    expect(empty.lines.every((line) => line.commissionAmount === "0.0000")).toBe(true);
    await expect(withTenant(TENANT_S, () => commission.post(empty.id, S_ACTOR))).rejects.toBeInstanceOf(
      CommissionRunStateError,
    );
    const cancelled = await withTenant(TENANT_S, () =>
      commission.cancel(empty.id, { reason: "empty window", actorId: S_ACTOR }),
    );
    expect(cancelled.status).toBe("CANCELLED");

    await expect(
      withTenant(TENANT_S, () => commission.find("00000000-0000-0000-0000-0000000000f9")),
    ).rejects.toThrow(/does not exist/);
  });
});
