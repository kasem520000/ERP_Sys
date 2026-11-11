import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as treasury from "../../modules/treasury/infrastructure/treasury.store";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import { ReturnsService } from "../../modules/sales/application/rma";
import {
  S_ACTOR,
  S_SALES,
  TENANT_S,
  clearSalesSetting,
  creditNotes,
  salesAppClient,
  salesInvoices,
  sCoa,
  setSalesSetting,
  setupSalesFixture,
  type SalesFixture,
} from "./fixtures";

/**
 * PHASE-039 · the customer-RMA DB suite (task 7-API-A; migration 0055): the
 * full operational lifecycle over real PostgreSQL through the app-role
 * services — every journal through PostingEngine.post, the completion credit
 * note through CreditNoteService itself (G-35 = its re-entry leg), G-36/G-37
 * direct — with the qty bound (invoiced − credited − open), SoD on approval,
 * the typed state machine, BR-064's exactly-once completion, and the
 * fail-closed scrap-account mapping all asserted with zero-residue checks.
 *
 * Runs on the shared sales tenant S (the family's single-lot W-1 seed; stock
 * asserts are delta-based like every sibling file). Deterministic dates sit
 * in FY2026-November — inside the default 14-day return window and outside
 * every PERIOD_LOCKED pack (March/December).
 */

const R_INVOICE_DATE = "2026-11-04";
const R_COMPLETE_DATE = "2026-11-10";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const inbox = new InboxService();
// The SAME CreditNoteService instance the sibling suites exercise — the RMA
// completion drives the real CN machinery (create → approve → post → re-entry).
const returns = new ReturnsService(audit, posting, numbering, creditNotes, inbox);

let fixture: SalesFixture;
let scrapLossAccountId = "";

interface ExpectedLine {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<ExpectedLine[]> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

/** A freshly POSTED with-goods invoice: item A ×3 @ 100, STD 15% — the RMA
 * substrate (W-3 snapshots the issue cost on the line at post time). */
async function postedStockInvoice(note: string): Promise<{
  invoiceId: string;
  lineId: string;
  issueUnitCost: string;
}> {
  const created = await withTenant(TENANT_S, () =>
    salesInvoices.create({
      branchId: fixture.branchId,
      customerId: fixture.customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: R_INVOICE_DATE,
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: fixture.warehouseId, // with-goods: G-01 + G-03 at post
      cashAccountId: null,
      note,
      noteAr: null,
      actorId: S_SALES,
      lines: [
        {
          itemId: fixture.items.a,
          accountId: null,
          deliveryLineId: null,
          description: "RMA substrate line",
          descriptionAr: null,
          qty: "3",
          unitPrice: "100.000000",
          discountAmount: null,
          taxCodeId: fixture.taxCodeIds.standard,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_SALES));
  await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));
  await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));
  const lines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(created.id));
  const line = lines.find((row) => row.itemId === fixture.items.a)!;
  return { invoiceId: created.id, lineId: line.id, issueUnitCost: line.issueUnitCost! };
}

/** The full pre-completion ladder: REQUESTED → APPROVED (SoD-clean) →
 * RECEIVED → INSPECTED with the given disposition. */
async function inspectedRma(
  invoice: { invoiceId: string; lineId: string },
  qty: string,
  disposition: "RESTOCK" | "SCRAP" | "REFUND",
): Promise<string> {
  const rma = await withTenant(TENANT_S, () =>
    returns.create({
      branchId: fixture.branchId,
      invoiceId: invoice.invoiceId,
      reasonCode: "DAMAGED",
      reason: "damaged in transit",
      reasonAr: "تالف أثناء النقل",
      note: null,
      noteAr: null,
      actorId: S_SALES,
      lines: [{ invoiceLineId: invoice.lineId, qty, note: null }],
    }),
  );
  await withTenant(TENANT_S, () => returns.approve(rma.id, S_ACTOR));
  await withTenant(TENANT_S, () => returns.receive(rma.id, S_ACTOR));
  await withTenant(TENANT_S, () =>
    returns.inspect({
      rmaId: rma.id,
      disposition,
      inspectionNote: "inspected per SOP-7",
      actorId: S_ACTOR,
    }),
  );
  return rma.id;
}

beforeAll(async () => {
  fixture = await setupSalesFixture();
  // The tenant-mapped scrap-loss account (G-36) — a dedicated root postable
  // row, unmapped by default (the fail-closed pack flips the setting later).
  await withTenant(TENANT_S, async () => {
    let scrap = await accountingStore.findAccountByCode("5190");
    if (scrap === undefined) {
      scrap = await sCoa.create(S_ACTOR, {
        code: "5190",
        name: "Scrap loss (returns)",
        nameAr: "خسائر الإتلاف (المرتجعات)",
        type: "EXPENSE",
        parentId: null,
        currencyCode: null,
        isGroup: false,
      });
    }
    scrapLossAccountId = scrap.id;
  });
});

afterAll(async () => {
  // Leave the shared tenant on its registry defaults.
  await clearSalesSetting("sales.scrap_loss_account");
});

// -- (a) the lifecycle: REQUESTED → APPROVED (SoD) → RECEIVED → INSPECTED → RESTOCKED ---

describe("PHASE-039 customer RMAs — the full lifecycle to RESTOCKED (G-35)", () => {
  it("walks the ladder with SoD, completes with the credit note + its re-entry leg, and replays typed (BR-064)", async () => {
    const invoice = await postedStockInvoice("RMA lifecycle invoice");

    const rma = await withTenant(TENANT_S, () =>
      returns.create({
        branchId: fixture.branchId,
        invoiceId: invoice.invoiceId,
        reasonCode: "DAMAGED",
        reason: "damaged in transit",
        reasonAr: "تالف أثناء النقل",
        note: null,
        noteAr: null,
        actorId: S_SALES,
        lines: [{ invoiceLineId: invoice.lineId, qty: "2", note: null }],
      }),
    );
    expect(rma.status).toBe("REQUESTED");
    expect(rma.partnerId).toBe(fixture.customerId);
    expect(rma.currencyCode).toBe("SAR");
    // The price snapshot: 2 × 100 at 4dp (tax resolves at the credit note).
    expect(rma.totalNet).toBe("200.0000");
    expect(rma.totalGross).toBe("200.0000");
    expect(rma.lines).toHaveLength(1);
    expect(rma.lines[0]).toMatchObject({
      invoiceLineId: invoice.lineId,
      qty: "2.000000",
      unitPrice: "100.0000",
    });

    // SoD: the creator can never approve.
    await expect(
      withTenant(TENANT_S, () => returns.approve(rma.id, S_SALES)),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL_BLOCKED" });

    const approved = await withTenant(TENANT_S, () => returns.approve(rma.id, S_ACTOR));
    expect(approved.status).toBe("APPROVED");
    expect(approved.rmaNo).toMatch(/^RMA-2026-\d{6}$/);
    expect(approved.approvedBy).toBe(S_ACTOR);

    const received = await withTenant(TENANT_S, () => returns.receive(rma.id, S_ACTOR));
    expect(received.status).toBe("RECEIVED");
    expect(received.receivedAt).not.toBeNull();

    const inspected = await withTenant(TENANT_S, () =>
      returns.inspect({
        rmaId: rma.id,
        disposition: "RESTOCK",
        inspectionNote: "resalable",
        actorId: S_ACTOR,
      }),
    );
    expect(inspected.status).toBe("INSPECTED");
    expect(inspected.disposition).toBe("RESTOCK");

    const stockBefore = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );

    const completed = await withTenant(TENANT_S, () =>
      returns.complete({ rmaId: rma.id, entryDate: R_COMPLETE_DATE, actorId: S_ACTOR }),
    );
    expect(completed.status).toBe("RESTOCKED");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.completedBy).toBe(S_ACTOR);
    expect(completed.creditNoteId).not.toBeNull();
    expect(completed.postedJournalId).not.toBeNull();
    expect(completed.entryNo).not.toBeNull();

    // The completion credit note exists, POSTED against the same invoice.
    const note = await withTenant(TENANT_S, () => creditNotes.find(completed.creditNoteId!));
    expect(note.status).toBe("POSTED");
    expect(note.noteNo).toMatch(/^CRN-2026-\d{6}$/);
    expect(note.invoiceId).toBe(invoice.invoiceId);
    expect(note.totalNet).toBe("200.0000");
    expect(note.totalTax).toBe("30.0000");
    expect(note.totalGross).toBe("230.0000");

    // G-35: the CN's OWN re-entry leg re-shelves at the ORIGINAL issue cost
    // (W-3 — the invoice line's snapshot, never a current-average recompute).
    const expectedReentry = new Decimal("2")
      .times(new Decimal(invoice.issueUnitCost))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    const reentry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("credit_note", note.id, "reentry"),
    );
    expect(reentry).toBeDefined();
    expect(await withTenant(TENANT_S, () => journalLinesOf(reentry!.id))).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: expectedReentry },
      { accountId: fixture.gl.cogs, direction: "CREDIT", amount: expectedReentry },
    ]);
    const moves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ sourceType: "credit_note", sourceId: note.id, limit: 10 }),
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]!.direction).toBe("IN");
    expect(moves[0]!.qty).toBe("2.000000");
    expect(moves[0]!.unitCost).toBe(invoice.issueUnitCost);

    // On-hand back +2 (delta-based — sibling files share the lot).
    const stockAfter = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );
    expect(new Decimal(stockAfter!.qty).minus(new Decimal(stockBefore!.qty)).toFixed(6)).toBe(
      "2.000000",
    );

    // The terminal stamps carry the CN's own journal (RESTOCK's disposition
    // journal IS the credit note).
    const cnEntry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("credit_note", note.id, "post"),
    );
    expect(cnEntry).toBeDefined();
    expect(completed.postedJournalId).toBe(cnEntry!.id);
    expect(completed.entryNo).toBe(cnEntry!.entryNo);

    // BR-064 exactly-once: a replay of the terminal completion is typed.
    await expect(
      withTenant(TENANT_S, () =>
        returns.complete({ rmaId: rma.id, entryDate: R_COMPLETE_DATE, actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({
      code: "RMA_STATE_INVALID",
      details: { current: "RESTOCKED", attempted: "complete" },
    });

    // The collections notification landed once (dedupe key per RMA).
    const client = await salesAppClient();
    const notif = await client.query(
      `SELECT category, severity FROM notifications WHERE dedupe_key = $1`,
      [`rma-completed:${rma.id}`],
    );
    await client.end();
    expect(notif.rows).toHaveLength(1);
    expect(notif.rows[0]).toMatchObject({ category: "collections", severity: "info" });
  });
});

// -- (b) the quantity bound: invoiced − credited − open-RMA ----------------------------

describe("PHASE-039 customer RMAs — the availability bound", () => {
  it("rejects above the invoiced qty, folds open RMAs, and passes at exactly the boundary", async () => {
    const invoice = await postedStockInvoice("RMA bounding invoice"); // 3 invoiced

    // Above the invoiced qty → typed with the fold's numbers.
    await expect(
      withTenant(TENANT_S, () =>
        returns.create({
          branchId: fixture.branchId,
          invoiceId: invoice.invoiceId,
          reasonCode: "DEFECTIVE",
          reason: null,
          reasonAr: null,
          note: null,
          noteAr: null,
          actorId: S_SALES,
          lines: [{ invoiceLineId: invoice.lineId, qty: "4", note: null }],
        }),
      ),
    ).rejects.toMatchObject({
      code: "RMA_QTY_EXCEEDS_INVOICED",
      details: { lineId: invoice.lineId, qty: "4", available: "3.000000" },
    });

    // An OPEN (REQUESTED) RMA claims 2 → only 1 stays available.
    await withTenant(TENANT_S, () =>
      returns.create({
        branchId: fixture.branchId,
        invoiceId: invoice.invoiceId,
        reasonCode: "DEFECTIVE",
        reason: null,
        reasonAr: null,
        note: null,
        noteAr: null,
        actorId: S_SALES,
        lines: [{ invoiceLineId: invoice.lineId, qty: "2", note: null }],
      }),
    );
    await expect(
      withTenant(TENANT_S, () =>
        returns.create({
          branchId: fixture.branchId,
          invoiceId: invoice.invoiceId,
          reasonCode: "DEFECTIVE",
          reason: null,
          reasonAr: null,
          note: null,
          noteAr: null,
          actorId: S_SALES,
          lines: [{ invoiceLineId: invoice.lineId, qty: "2", note: null }],
        }),
      ),
    ).rejects.toMatchObject({
      code: "RMA_QTY_EXCEEDS_INVOICED",
      details: { lineId: invoice.lineId, qty: "2", available: "1.000000" },
    });

    // Exactly the remaining qty passes (the boundary is inclusive).
    const boundary = await withTenant(TENANT_S, () =>
      returns.create({
        branchId: fixture.branchId,
        invoiceId: invoice.invoiceId,
        reasonCode: "DEFECTIVE",
        reason: null,
        reasonAr: null,
        note: null,
        noteAr: null,
        actorId: S_SALES,
        lines: [{ invoiceLineId: invoice.lineId, qty: "1", note: null }],
      }),
    );
    expect(boundary.status).toBe("REQUESTED");
  });
});

// -- (c) the typed state machine --------------------------------------------------------

describe("PHASE-039 customer RMAs — the typed lifecycle gate", () => {
  it("rejects every skip with RmaStateInvalidError and cancels only off REQUESTED/APPROVED", async () => {
    const invoice = await postedStockInvoice("RMA state-skip invoice");
    const rma = await withTenant(TENANT_S, () =>
      returns.create({
        branchId: fixture.branchId,
        invoiceId: invoice.invoiceId,
        reasonCode: "WRONG_ITEM",
        reason: null,
        reasonAr: null,
        note: null,
        noteAr: null,
        actorId: S_SALES,
        lines: [{ invoiceLineId: invoice.lineId, qty: "1", note: null }],
      }),
    );

    // Skips straight out of REQUESTED.
    await expect(
      withTenant(TENANT_S, () => returns.receive(rma.id, S_ACTOR)),
    ).rejects.toMatchObject({
      code: "RMA_STATE_INVALID",
      details: { current: "REQUESTED", attempted: "receive" },
    });
    await expect(
      withTenant(TENANT_S, () =>
        returns.inspect({ rmaId: rma.id, disposition: "RESTOCK", inspectionNote: null, actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "RMA_STATE_INVALID" });
    await expect(
      withTenant(TENANT_S, () => returns.complete({ rmaId: rma.id, actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "RMA_STATE_INVALID" });

    // A completion hop straight off APPROVED is a skip too.
    await withTenant(TENANT_S, () => returns.approve(rma.id, S_ACTOR));
    await expect(
      withTenant(TENANT_S, () => returns.complete({ rmaId: rma.id, actorId: S_ACTOR })),
    ).rejects.toMatchObject({
      code: "RMA_STATE_INVALID",
      details: { current: "APPROVED", attempted: "complete" },
    });

    // CANCELLED is legal off APPROVED; off RECEIVED it is typed.
    const cancelled = await withTenant(TENANT_S, () =>
      returns.cancel(rma.id, "customer withdrew the claim", S_ACTOR),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("customer withdrew the claim");

    const secondInvoice = await postedStockInvoice("RMA cancel-gate invoice");
    const rma2 = await inspectedRma(secondInvoice, "1", "RESTOCK");
    await expect(
      withTenant(TENANT_S, () => returns.cancel(rma2, "too late", S_ACTOR)),
    ).rejects.toMatchObject({ code: "RMA_STATE_INVALID" });
  });
});

// -- (d) SCRAP: the fail-closed G-36 mapping + the direct write-off ----------------------

describe("PHASE-039 customer RMAs — SCRAP (G-36, fail-closed scrap-loss mapping)", () => {
  it("stays INSPECTED with zero residue while unmapped, then completes once mapped", async () => {
    const invoice = await postedStockInvoice("RMA scrap invoice");
    const rmaId = await inspectedRma(invoice, "2", "SCRAP");

    // Unmapped: typed, fail-closed, zero residue — no CN, no journal, the
    // RMA stays INSPECTED (the whole completion runs in ONE ambient UoW).
    await clearSalesSetting("sales.scrap_loss_account");
    await expect(
      withTenant(TENANT_S, () =>
        returns.complete({ rmaId, entryDate: R_COMPLETE_DATE, actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "SCRAP_LOSS_ACCOUNT_UNMAPPED" });

    const stayed = await withTenant(TENANT_S, () => returns.find(rmaId));
    expect(stayed.status).toBe("INSPECTED");
    expect(stayed.creditNoteId).toBeNull();
    expect(stayed.postedJournalId).toBeNull();
    expect(stayed.completedAt).toBeNull();
    const strayNotes = await withTenant(TENANT_S, () =>
      creditNotes.list({ invoiceId: invoice.invoiceId, limit: 10 }),
    );
    expect(strayNotes).toHaveLength(0);

    // Mapped: completes SCRAPPED with the direct G-36 write-off.
    await setSalesSetting("sales.scrap_loss_account", scrapLossAccountId);
    const completed = await withTenant(TENANT_S, () =>
      returns.complete({ rmaId, entryDate: R_COMPLETE_DATE, actorId: S_ACTOR }),
    );
    expect(completed.status).toBe("SCRAPPED");
    expect(completed.completedAt).not.toBeNull();
    expect(completed.creditNoteId).not.toBeNull();

    // G-36: DR scrap-loss · CR COGS at Σ qty × ORIGINAL issue cost — the
    // goods never re-shelve.
    const expectedScrap = new Decimal("2")
      .times(new Decimal(invoice.issueUnitCost))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    const scrapEntry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("return_authorization", rmaId, "scrap"),
    );
    expect(scrapEntry).toBeDefined();
    expect(await withTenant(TENANT_S, () => journalLinesOf(scrapEntry!.id))).toEqual([
      { accountId: scrapLossAccountId, direction: "DEBIT", amount: expectedScrap },
      { accountId: fixture.gl.cogs, direction: "CREDIT", amount: expectedScrap },
    ]);
    expect(completed.postedJournalId).toBe(scrapEntry!.id);
    expect(completed.entryNo).toBe(scrapEntry!.entryNo);

    // The CN exists but its re-entry is SUPPRESSED (returnToStock false):
    // no reentry journal, no credit_note stock moves.
    const note = await withTenant(TENANT_S, () => creditNotes.find(completed.creditNoteId!));
    expect(note.status).toBe("POSTED");
    expect(note.reentryValue).toBe("0.0000");
    const reentry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("credit_note", note.id, "reentry"),
    );
    expect(reentry).toBeUndefined();
    const moves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ sourceType: "credit_note", sourceId: note.id, limit: 10 }),
    );
    expect(moves).toHaveLength(0);
  });
});

// -- (e) REFUND: the G-37 cash-out leg + the treasury movement ---------------------------

describe("PHASE-039 customer RMAs — REFUND (G-37, AR relief + cash out)", () => {
  it("requires the cash account, posts DR AR_CONTROL · CR cash, and records the treasury movement", async () => {
    const invoice = await postedStockInvoice("RMA refund invoice");
    const rmaId = await inspectedRma(invoice, "2", "REFUND");

    // A REFUND without the cash account is typed (fail-closed, zero residue).
    await expect(
      withTenant(TENANT_S, () =>
        returns.complete({ rmaId, entryDate: R_COMPLETE_DATE, actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "SALES_DOCUMENT_STATE" });
    const stayed = await withTenant(TENANT_S, () => returns.find(rmaId));
    expect(stayed.status).toBe("INSPECTED");

    const completed = await withTenant(TENANT_S, () =>
      returns.complete({
        rmaId,
        refundCashAccountId: fixture.cashAccountId,
        entryDate: R_COMPLETE_DATE,
        actorId: S_ACTOR,
      }),
    );
    expect(completed.status).toBe("REFUNDED");
    expect(completed.refundCashAccountId).toBe(fixture.cashAccountId);
    expect(completed.creditNoteId).not.toBeNull();

    // The CN posts first (DR SALES_RETURNS · DR VAT · CR AR), then G-37 pays
    // the customer out: DR AR_CONTROL (partner) · CR the refund cash account,
    // at the CN's gross.
    const refundEntry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("return_authorization", rmaId, "refund"),
    );
    expect(refundEntry).toBeDefined();
    expect(await withTenant(TENANT_S, () => journalLinesOf(refundEntry!.id))).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "230.0000" },
      { accountId: fixture.gl.cashGl, direction: "CREDIT", amount: "230.0000" },
    ]);
    expect(completed.postedJournalId).toBe(refundEntry!.id);
    expect(completed.entryNo).toBe(refundEntry!.entryNo);

    // The treasury money movement rides the G-33 pattern: base at rate 1,
    // source return_authorization (INV-019 + the source-side unique key make
    // it exactly-once).
    const movements = await withTenant(TENANT_S, () =>
      treasury.listMovements({
        cashAccountId: fixture.cashAccountId,
        fromDate: R_COMPLETE_DATE,
        toDate: R_COMPLETE_DATE,
        limit: 50,
      }),
    );
    const movement = movements.find(
      (row) => row.sourceType === "return_authorization" && row.sourceId === rmaId,
    );
    expect(movement).toBeDefined();
    expect(movement!.direction).toBe("OUT");
    expect(movement!.amount).toBe("230.0000");
    expect(movement!.exchangeRate).toBe("1.00000000");
    expect(movement!.baseAmount).toBe("230.0000");
    expect(movement!.currencyCode).toBe("SAR");

    // G-35 linkage survives on REFUND: the goods still re-shelve through the
    // CN's own re-entry leg.
    const reentry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("credit_note", completed.creditNoteId!, "reentry"),
    );
    expect(reentry).toBeDefined();
  });
});
