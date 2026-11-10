import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as periodStore from "../../modules/accounting/infrastructure/accounting.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import * as jobCardsStore from "../../modules/sales/infrastructure/job-cards.store";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { CreditNoteService } from "../../modules/sales/application/credit-notes";
import { ReservationService } from "../../modules/inventory/application/reservation-service";
import { JobCardService, type JobCardLineInput } from "../../modules/sales/job-cards/application/job-card-service";
import { JobCardPosting } from "../../modules/sales/job-cards/application/posting/job-card-posting";
import {
  S_ACTOR,
  TENANT_S,
  sPeriods,
  setupSalesFixture,
  type SalesFixture,
} from "./fixtures";

/**
 * PHASE-017 T4-a golden posting packs (the phase §6 required set, DB-backed
 * on the real sales fixture — real services, real PostingService, real
 * movement core; zero direct GL/stock writes):
 *
 *  1. `reserve` golden — approve holds JOB_CARD reservations (no ledger),
 *     the completion invoice is a with-goods CREDIT invoice whose own post
 *     issues stock: settlement = DR AR 368.0000 · CR SALES_REVENUE 200.0000
 *     (parts) · CR SERVICE_REVENUE 120.0000 (labor — the two revenue
 *     natures) · CR VAT_PAYABLE 30.0000 + 18.0000, plus the COGS journal
 *     DR COGS 120.0000 · CR INVENTORY 120.0000 (2 × WAC 60) — the holds
 *     consumed at invoice, the card INVOICED, job_card_id + vehicle_id on
 *     the invoice, SAL- number.
 *  2. `issue_immediate` golden — the COGS journal posts AT APPROVAL
 *     (job_card:issue_parts) and the completion invoice is revenue-only:
 *     exactly ONE COGS journal over the card's whole life, no reservation
 *     ever exists, stock moves sourced `job_card`, per-line issue snapshots
 *     copied onto the invoice lines (W-3), and re-running the port's issue
 *     is a no-op (INV-013).
 *  3. Warranty credit note — DR SALES_RETURNS 100.0000 · DR VAT 15.0000 ·
 *     CR AR 115.0000 + the stock re-entry DR INVENTORY 60.0000 · CR COGS
 *     60.0000 at the ORIGINAL issue cost; the note carries job_card_id.
 *  4. PERIOD_LOCKED — invoicing into a locked month leaves ZERO residue
 *     (no journal, no invoice row, no stock move, holds still ACTIVE).
 *  5. Insufficient stock at issue_immediate approval — typed
 *     INSUFFICIENT_STOCK, the atomic approve rolls the card back to DRAFT.
 *
 * Fixture numbers (exact): parts 2 × 100 = 200 + 15% VAT 30; labor 1.5 h ×
 * 80 = 120 + 15% VAT 18; AR 368.0000; COGS 2 × 60 = 120.0000 (item A's WAC
 * from the W-1 opening stock). Dates ride today (the honest invoice date);
 * the PERIOD_LOCKED pack locks today's period and reopens in finally.
 */

let fixture: SalesFixture;
let service: JobCardService;
let port: JobCardPosting;
let laborItemId = "";
let vehicleId = "";

beforeAll(async () => {
  fixture = await setupSalesFixture();
  const audit = new AuditService(new DrizzleAuditStore());
  const posting = new PostingService(audit, new PartnerSubledgerService());
  const numbering = new NumberingService(audit);
  const resolver = new TaxResolverService();
  const invoices = new SalesInvoiceService(audit, posting, numbering, resolver);
  const creditNotes = new CreditNoteService(audit, posting, numbering, resolver);
  const reservations = new ReservationService(audit);
  port = new JobCardPosting(posting, invoices, creditNotes, reservations);
  service = new JobCardService(audit, numbering);
  service.setPostingPort(port);

  await withTenant(TENANT_S, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const existingLabor = await itemsStore.findItemBySku("S-LABOR");
    if (existingLabor !== undefined) {
      laborItemId = existingLabor.id;
    } else {
      const created = await itemsStore.insertItem({
        sku: "S-LABOR",
        name: "Workshop labor",
        nameAr: "أجور العمل",
        kind: "SERVICE",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: "80.000000",
      });
      laborItemId = created.id;
    }

    const vehiclesStore = await import("../../modules/partners/infrastructure/vehicles.store");
    const vehicle = await vehiclesStore.insertVehicle({
      partnerId: fixture.customerId,
      make: "Toyota",
      model: "Land Cruiser",
      modelYear: 2021,
      chassisNo: "T4ATEST0000000001",
      plateNo: "T4A-1234",
      color: null,
      engineNo: null,
      odometerKm: "125000",
      odometerAt: null,
      note: null,
      noteAr: null,
      createdBy: S_ACTOR,
    });
    vehicleId = vehicle.id;
  });
});

// -- helpers -------------------------------------------------------------------

interface Line {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<Line[]> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

async function countJournals(): Promise<number> {
  return withTenant(TENANT_S, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM journal_entries`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

async function countInvoicesForCard(cardId: string): Promise<number> {
  return withTenant(TENANT_S, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM sales_invoices WHERE job_card_id = ${cardId}`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

async function stockOf(itemId: string): Promise<{ qty: string; avgCost: string }> {
  const row = await withTenant(TENANT_S, () =>
    inventoryStore.findItemStock(itemId, fixture.warehouseId),
  );
  if (row === undefined) throw new Error(`no stock row for ${itemId}`);
  return { qty: row.qty, avgCost: row.avgCost };
}

async function movesFor(sourceType: string, sourceId: string) {
  const moves = await withTenant(TENANT_S, () =>
    inventoryStore.listStockMoves({ sourceType, sourceId, limit: 50 }),
  );
  return moves.filter((move) => move.sourceId === sourceId);
}

const defaultLines = (): JobCardLineInput[] => [
  {
    lineType: "PARTS",
    itemId: fixture.items.a,
    qty: "2",
    unitPrice: "100",
    estimatedHours: null,
    discountAmount: null,
    taxCodeId: fixture.taxCodeIds.standard,
    description: "brake pads",
    descriptionAr: "فرامل",
    note: null,
  },
  {
    lineType: "LABOR",
    itemId: laborItemId,
    qty: "1",
    unitPrice: "80",
    estimatedHours: "1.5",
    discountAmount: null,
    taxCodeId: fixture.taxCodeIds.standard,
    description: "replace pads",
    descriptionAr: null,
    note: null,
  },
];

async function createCard(mode: "reserve" | "issue_immediate", qty = "2") {
  const lines = defaultLines();
  lines[0] = { ...lines[0]!, qty };
  return withTenant(TENANT_S, () =>
    service.create({
      branchId: fixture.branchId,
      customerId: fixture.customerId,
      vehicleId,
      warehouseId: fixture.warehouseId,
      partsIssueMode: mode,
      complaints: "brake noise",
      complaintsAr: null,
      odometerKm: "125000.5",
      checkedInAt: null,
      note: null,
      noteAr: null,
      actorId: S_ACTOR,
      lines,
    }),
  );
}

const TODAY = () => new Date().toISOString().slice(0, 10);

// -- the golden set ---------------------------------------------------------------

describe("PHASE-017 T4-a job-card posting goldens", () => {
  it("reserve mode: approval holds (no ledger), the completion invoice posts both journals with the two revenue natures, and consumes the holds", async () => {
    const journalsAtStart = await countJournals();
    const stockBefore = await stockOf(fixture.items.a);

    // 1. Approval under `reserve`: one JOB_CARD-held availability hold per
    //    PARTS line, ZERO ledger rows (no journal before INVOICED).
    const card = await createCard("reserve");
    expect(card.cardNo).toMatch(/^JC-\d{4}-\d{5}$/);
    const approved = await withTenant(TENANT_S, () => service.approve(card.id, { actorId: S_ACTOR }));
    expect(approved.status).toBe("IN_PROGRESS");
    const approvedLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    const parts = approvedLines.find((line) => line.lineType === "PARTS")!;
    const labor = approvedLines.find((line) => line.lineType === "LABOR")!;
    expect(parts.status).toBe("RESERVED");
    expect(parts.reservationId).not.toBeNull();
    expect(labor.status).toBe("PENDING"); // labor is never reserved
    const reservation = await withTenant(TENANT_S, () =>
      inventoryStore.findReservationById(parts.reservationId!),
    );
    expect(reservation?.holderType).toBe("JOB_CARD");
    expect(reservation?.holderId).toBe(card.id);
    expect(reservation?.status).toBe("ACTIVE");
    expect(await countJournals()).toBe(journalsAtStart);
    expect((await stockOf(fixture.items.a)).qty).toBe(stockBefore.qty); // hold ≠ movement

    // 2. Completion + the real invoice path (service → port).
    await withTenant(TENANT_S, () => service.complete(card.id, { actorId: S_ACTOR }));
    const invoiced = await withTenant(TENANT_S, () => service.invoice(card.id, { actorId: S_ACTOR }));
    expect(invoiced.status).toBe("INVOICED");
    expect(invoiced.invoiceId).not.toBeNull();

    // 3. The card lines: INVOICED + invoice_line_id linked by the port.
    const invoicedLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    expect(invoicedLines.every((line) => line.status === "INVOICED")).toBe(true);
    expect(invoicedLines.every((line) => line.invoiceLineId !== null)).toBe(true);

    // 4. The invoice row: with-goods CREDIT, provenance pair, SAL- number.
    const invoice = await withTenant(TENANT_S, () => sStore.findSalesInvoiceById(invoiced.invoiceId!));
    expect(invoice!.status).toBe("POSTED");
    expect(invoice!.kind).toBe("CREDIT");
    expect(invoice!.warehouseId).toBe(fixture.warehouseId);
    expect(invoice!.jobCardId).toBe(card.id);
    expect(invoice!.vehicleId).toBe(vehicleId);
    expect(invoice!.invoiceNo).toMatch(/^SAL-\d{4}-\d{6}$/);
    // Exact totals: parts 200 + labor 120 net; 15% VAT 30 + 18; gross 368.
    expect(invoice!.totalNet).toBe("320.0000");
    expect(invoice!.totalTax).toBe("48.0000");
    expect(invoice!.totalGross).toBe("368.0000");

    // 5. Settlement journal EXACTLY: DR AR 368 · CR SALES_REVENUE 200 (parts)
    //    · CR SERVICE_REVENUE 120 (labor — the second revenue nature) ·
    //    CR VAT 30 + 18 (per line, in line order).
    expect(await withTenant(TENANT_S, () => journalLinesOf(invoice!.postedJournalId!))).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "368.0000" },
      { accountId: fixture.gl.salesRevenue, direction: "CREDIT", amount: "200.0000" },
      { accountId: fixture.gl.serviceRevenue, direction: "CREDIT", amount: "120.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "30.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "18.0000" },
    ]);

    // 6. COGS journal EXACTLY: DR COGS 120 (2 × WAC 60) · CR INVENTORY 120.
    expect(await withTenant(TENANT_S, () => journalLinesOf(invoice!.postedCogsJournalId!))).toEqual([
      { accountId: fixture.gl.cogs, direction: "DEBIT", amount: "120.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "120.0000" },
    ]);

    // 7. The invoice's own stock issue (flow B): one OUT move at WAC 60.
    const moves = await movesFor("sales_invoice", invoice!.id);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.direction).toBe("OUT");
    expect(moves[0]!.qty).toBe("2.000000");
    expect(moves[0]!.valueAmount).toBe("120.0000");
    const invoiceLines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(invoice!.id));
    expect(invoiceLines).toHaveLength(2);
    const partsInvoiceLine = invoiceLines.find((line) => line.itemId === fixture.items.a)!;
    expect(partsInvoiceLine.issueUnitCost).toBe("60.000000");
    expect(partsInvoiceLine.issueValue).toBe("120.0000");
    // The port's card-line ↔ invoice-line mapping: ids line up 1:1.
    expect(new Set(invoicedLines.map((line) => line.invoiceLineId))).toEqual(
      new Set(invoiceLines.map((line) => line.id)),
    );

    // 8. The holds are CONSUMED at invoice (released from availability,
    //    consumed — never re-issued; the physical issue was the invoice's).
    const consumed = await withTenant(TENANT_S, () =>
      inventoryStore.findReservationById(parts.reservationId!),
    );
    expect(consumed?.status).toBe("CONSUMED");

    // 9. Stock: on-hand −2, WAC unchanged (issues never move the average).
    const stockAfter = await stockOf(fixture.items.a);
    expect(stockAfter.qty).toBe(`${Number(stockBefore.qty) - 2}.000000`);
    expect(stockAfter.avgCost).toBe(stockBefore.avgCost);

    // 10. Exactly two journals over the whole card life (settlement + COGS).
    expect(await countJournals()).toBe(journalsAtStart + 2);
  });

  it("issue_immediate mode: the COGS journal posts AT APPROVAL and the invoice is revenue-only — exactly ONE COGS journal over the card's life", async () => {
    const journalsAtStart = await countJournals();
    const stockBefore = await stockOf(fixture.items.a);

    // 1. Approval: the port issues parts NOW — one COGS journal
    //    (job_card:issue_parts), stock moves sourced `job_card`, per-line
    //    snapshots; NO reservation ever exists under this policy.
    const card = await createCard("issue_immediate");
    const approved = await withTenant(TENANT_S, () => service.approve(card.id, { actorId: S_ACTOR }));
    expect(approved.status).toBe("IN_PROGRESS");
    const approvedLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    const parts = approvedLines.find((line) => line.lineType === "PARTS")!;
    const labor = approvedLines.find((line) => line.lineType === "LABOR")!;
    expect(parts.status).toBe("ISSUED");
    expect(parts.issueJournalId).not.toBeNull();
    expect(parts.issueUnitCost).toBe("60.000000");
    expect(parts.issueValue).toBe("120.0000");
    expect(parts.reservationId).toBeNull(); // the reservation absence
    expect(labor.status).toBe("PENDING"); // LABOR lines untouched by the issue
    expect(labor.issueJournalId).toBeNull();

    const issueJournal = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("job_card", card.id, "issue_parts"),
    );
    expect(issueJournal).toBeDefined();
    expect(issueJournal!.id).toBe(parts.issueJournalId);
    expect(await withTenant(TENANT_S, () => journalLinesOf(issueJournal!.id))).toEqual([
      { accountId: fixture.gl.cogs, direction: "DEBIT", amount: "120.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "120.0000" },
    ]);
    const issueMoves = await movesFor("job_card", card.id);
    expect(issueMoves).toHaveLength(1);
    expect(issueMoves[0]!.direction).toBe("OUT");
    expect(issueMoves[0]!.qty).toBe("2.000000");
    expect(issueMoves[0]!.valueAmount).toBe("120.0000");
    const stockAfterApprove = await stockOf(fixture.items.a);
    expect(stockAfterApprove.qty).toBe(`${Number(stockBefore.qty) - 2}.000000`);
    expect(await countJournals()).toBe(journalsAtStart + 1);

    // 2. INV-013: re-running the port's issue is a no-op (all lines ISSUED).
    await withTenant(TENANT_S, () => port.issuePartsImmediate(card.id, S_ACTOR));
    expect(await countJournals()).toBe(journalsAtStart + 1);
    expect((await movesFor("job_card", card.id)).length).toBe(1);

    // 3. Completion + invoice: settlement ONLY — no second COGS journal.
    await withTenant(TENANT_S, () => service.complete(card.id, { actorId: S_ACTOR }));
    const invoiced = await withTenant(TENANT_S, () => service.invoice(card.id, { actorId: S_ACTOR }));
    expect(invoiced.status).toBe("INVOICED");
    const invoice = await withTenant(TENANT_S, () => sStore.findSalesInvoiceById(invoiced.invoiceId!));
    expect(invoice!.status).toBe("POSTED");
    expect(invoice!.warehouseId).toBeNull(); // revenue-only: no flow-B issue
    expect(invoice!.jobCardId).toBe(card.id);
    expect(invoice!.postedCogsJournalId).toBeNull();
    // No sales_invoice:cogs entry exists for this invoice at all.
    const cogsForInvoice = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("sales_invoice", invoice!.id, "cogs"),
    );
    expect(cogsForInvoice).toBeUndefined();
    // No stock moved at the invoice — only the approval moved it.
    expect(await movesFor("sales_invoice", invoice!.id)).toHaveLength(0);
    const stockAfterInvoice = await stockOf(fixture.items.a);
    expect(stockAfterInvoice.qty).toBe(stockAfterApprove.qty);

    // 4. The settlement journal — same exact shape as the reserve golden.
    expect(await withTenant(TENANT_S, () => journalLinesOf(invoice!.postedJournalId!))).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "368.0000" },
      { accountId: fixture.gl.salesRevenue, direction: "CREDIT", amount: "200.0000" },
      { accountId: fixture.gl.serviceRevenue, direction: "CREDIT", amount: "120.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "30.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "18.0000" },
    ]);

    // 5. The W-3 copy: the invoice PARTS line carries the card line's issue
    //    snapshot (the warranty re-entry cost source).
    const invoiceLines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(invoice!.id));
    const partsInvoiceLine = invoiceLines.find((line) => line.itemId === fixture.items.a)!;
    expect(partsInvoiceLine.issueUnitCost).toBe("60.000000");
    expect(partsInvoiceLine.issueValue).toBe("120.0000");

    // 6. Exactly TWO journals over the card's whole life — ONE of them COGS.
    expect(await countJournals()).toBe(journalsAtStart + 2);
    const cardLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    const issuedLine = cardLines.find((line) => line.lineType === "PARTS")!;
    expect(issuedLine.issueJournalId).toBe(issueJournal!.id); // unchanged by invoicing
    expect(issuedLine.status).toBe("INVOICED");
  });

  it("warranty credit note: mirrored journals + stock re-entry at the ORIGINAL issue cost, job_card_id on the note", async () => {
    const stockBefore = await stockOf(fixture.items.a);

    // A posted reserve-mode invoice to correct (fresh card, same numbers).
    const card = await createCard("reserve");
    await withTenant(TENANT_S, () => service.approve(card.id, { actorId: S_ACTOR }));
    await withTenant(TENANT_S, () => service.complete(card.id, { actorId: S_ACTOR }));
    const invoiced = await withTenant(TENANT_S, () => service.invoice(card.id, { actorId: S_ACTOR }));
    const invoice = await withTenant(TENANT_S, () => sStore.findSalesInvoiceById(invoiced.invoiceId!));
    const invoiceLines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(invoice!.id));
    const partsInvoiceLine = invoiceLines.find((line) => line.itemId === fixture.items.a)!;

    // One parts unit back under warranty (qty 1 of the 2 sold).
    const posted = await withTenant(TENANT_S, () =>
      port.warrantyCreditNote(card.id, {
        invoiceId: invoice!.id,
        lines: [{ invoiceLineId: partsInvoiceLine.id, qty: "1", reason: "defective under warranty" }],
        note: "warranty correction",
        actorId: S_ACTOR,
      }),
    );
    expect(posted.idempotentReplay).toBe(false);
    expect(posted.noteNo).toMatch(/^CRN-\d{4}-\d{6}$/);

    // The note row: POSTED, job_card_id provenance, exact mirrored totals.
    const note = await withTenant(TENANT_S, () => sStore.findCreditNoteById(posted.note.id));
    expect(note!.status).toBe("POSTED");
    expect(note!.jobCardId).toBe(card.id);
    expect(note!.totalNet).toBe("100.0000"); // 1 × 100
    expect(note!.totalTax).toBe("15.0000"); // 15%
    expect(note!.totalGross).toBe("115.0000");
    expect(note!.reentryValue).toBe("60.0000"); // 1 × original issue cost

    // Credit-note journal EXACTLY: DR SALES_RETURNS 100 · DR VAT 15 (the
    // mirrored output VAT) · CR AR 115.
    expect(await withTenant(TENANT_S, () => journalLinesOf(posted.journalEntryId!))).toEqual([
      { accountId: fixture.gl.salesReturns, direction: "DEBIT", amount: "100.0000" },
      { accountId: fixture.gl.vatPayable, direction: "DEBIT", amount: "15.0000" },
      { accountId: fixture.gl.arControl, direction: "CREDIT", amount: "115.0000" },
    ]);

    // Re-entry journal EXACTLY: DR INVENTORY 60 · CR COGS 60 — the ORIGINAL
    // issue cost (W-3), never a current-average recompute.
    const reentryJournal = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("credit_note", posted.note.id, "reentry"),
    );
    expect(reentryJournal).toBeDefined();
    expect(await withTenant(TENANT_S, () => journalLinesOf(reentryJournal!.id))).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "60.0000" },
      { accountId: fixture.gl.cogs, direction: "CREDIT", amount: "60.0000" },
    ]);

    // Stock re-entered: +1 on-hand at 60.000000 (avg unchanged — the
    // re-entry price IS the pool's average).
    const reentryMoves = await movesFor("credit_note", posted.note.id);
    expect(reentryMoves).toHaveLength(1);
    expect(reentryMoves[0]!.direction).toBe("IN");
    expect(reentryMoves[0]!.qty).toBe("1.000000");
    expect(reentryMoves[0]!.unitCost).toBe("60.000000");
    expect(reentryMoves[0]!.valueAmount).toBe("60.0000");
    const stockAfter = await stockOf(fixture.items.a);
    expect(stockAfter.qty).toBe(`${Number(stockBefore.qty) - 2 + 1}.000000`);
    expect(stockAfter.avgCost).toBe(stockBefore.avgCost);
  });

  it("PERIOD_LOCKED: invoicing into a locked month leaves ZERO residue (no journal, no invoice row, holds still ACTIVE)", async () => {
    const journalsAtStart = await countJournals();
    const stockBefore = await stockOf(fixture.items.a);

    const card = await createCard("reserve");
    await withTenant(TENANT_S, () => service.approve(card.id, { actorId: S_ACTOR }));
    await withTenant(TENANT_S, () => service.complete(card.id, { actorId: S_ACTOR }));
    const cardLines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    const parts = cardLines.find((line) => line.lineType === "PARTS")!;
    expect((await withTenant(TENANT_S, () => inventoryStore.findReservationById(parts.reservationId!)))?.status).toBe("ACTIVE");

    // Lock today's period (the port's invoice date is today).
    const period = await withTenant(TENANT_S, () => periodStore.findPeriodForDate(TODAY()));
    expect(period).toBeDefined();
    try {
      await withTenant(TENANT_S, () => sPeriods.softClose(S_ACTOR, period!.id));
      await withTenant(TENANT_S, () => sPeriods.lock(S_ACTOR, period!.id));
      await expect(
        withTenant(TENANT_S, () => service.invoice(card.id, { actorId: S_ACTOR })),
      ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });

      // Zero residue — the atomic UoW rolled the whole attempt back.
      expect(await countJournals()).toBe(journalsAtStart);
      expect(await countInvoicesForCard(card.id)).toBe(0);
      expect((await stockOf(fixture.items.a)).qty).toBe(stockBefore.qty);
      // The card never transitioned; the hold was never consumed.
      const stuck = await withTenant(TENANT_S, () => service.find(card.id));
      expect(stuck.status).toBe("COMPLETED");
      expect(stuck.invoiceId).toBeNull();
      const holds = await withTenant(TENANT_S, () =>
        jobCardsStore.listJobCardLines(card.id),
      );
      expect(holds.every((line) => line.invoiceLineId === null)).toBe(true);
      expect(
        (await withTenant(TENANT_S, () => inventoryStore.findReservationById(parts.reservationId!)))?.status,
      ).toBe("ACTIVE");
    } finally {
      await withTenant(TENANT_S, () =>
        sPeriods.reopen(S_ACTOR, period!.id, "T4-a PERIOD_LOCKED pack reopen"),
      );
    }
  });

  it("insufficient stock at issue_immediate approval: typed INSUFFICIENT_STOCK, the atomic approve leaves the card DRAFT", async () => {
    const journalsAtStart = await countJournals();
    const stockBefore = await stockOf(fixture.items.a);

    const card = await createCard("issue_immediate", "5000"); // ≫ on-hand
    await expect(
      withTenant(TENANT_S, () => service.approve(card.id, { actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });

    // The port throws inside the service's approve transaction → the whole
    // UoW rolls back: the card never left DRAFT, no journal, no move, no hold.
    const stuck = await withTenant(TENANT_S, () => service.find(card.id));
    expect(stuck.status).toBe("DRAFT");
    const lines = await withTenant(TENANT_S, () => jobCardsStore.listJobCardLines(card.id));
    expect(lines.every((line) => line.status === "PENDING")).toBe(true);
    expect(lines.every((line) => line.issueJournalId === null && line.reservationId === null)).toBe(true);
    expect(await countJournals()).toBe(journalsAtStart);
    expect(await movesFor("job_card", card.id)).toHaveLength(0);
    expect((await stockOf(fixture.items.a)).qty).toBe(stockBefore.qty);
  });
});
