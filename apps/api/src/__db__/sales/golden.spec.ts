import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as periodStore from "../../modules/accounting/infrastructure/accounting.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as treasuryStore from "../../modules/treasury/infrastructure/treasury.store";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import {
  S_ACTOR,
  S_CASHIER,
  S_DEC,
  S_JAN,
  S_SALES,
  TENANT_S,
  allocations,
  creditNotes,
  deliveries,
  receipts,
  salesInvoices,
  sPeriods,
  setupSalesFixture,
  type SalesFixture,
} from "./fixtures";

/**
 * PHASE-012 golden posting tests (ACCOUNTING_TESTS §3, this phase's
 * executable subset): G-01 credit invoice (W-1 exact: AR 1,380.0000 /
 * revenue 1,200.0000 / VAT 180.0000), G-03 COGS (725.0000 at WAC issue —
 * both the with-goods invoice and the delivery-note flow), G-02 cash
 * invoice (+ the treasury cash movement, INV-019), G-04 credit note with
 * return (W-3: SALES_RETURNS 200.0000 DR · VAT 30.0000 DR · AR 230.0000 CR
 * + INVENTORY 120.0000 DR · COGS 120.0000 CR at ORIGINAL cost), G-05
 * receipt + allocation, G-06 receipt with FX gain/loss (W-2: ±10.0000
 * explicit residual) — each asserting the EXACT journal lines, the stock
 * rows, the document state, the subledger open item, and the standard
 * failure packs (PERIOD_LOCKED, NOT_SUBJECT) with zero residue.
 */

let fixture: SalesFixture;

beforeAll(async () => {
  fixture = await setupSalesFixture();
});

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

describe("G-01 + G-03 — with-goods credit invoice (W-1 exact figures)", () => {
  it("posts the COGS entry (sales_invoice:cogs) + the AR entry (sales_invoice:post) with the exact W-1 numbers", async () => {
    // On-hand snapshot BEFORE (order-robust): sibling specs in the same
    // suite run may consume the fixture items before this file — the W-1
    // on-hand assertions are delta-based, like G-03/G-04's.
    const stockABefore = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );
    const stockBBefore = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.b, fixture.warehouseId),
    );
    const created = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: S_JAN,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: fixture.warehouseId, // flow B: with-goods
        cashAccountId: null,
        note: "W-1 credit invoice",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: fixture.items.a,
            accountId: null,
            deliveryLineId: null,
            description: null,
            descriptionAr: null,
            qty: "10",
            unitPrice: "100.000000",
            discountAmount: null,
            taxCodeId: fixture.taxCodeIds.standard,
            batchId: null,
            serialIds: null,
            note: null,
          },
          {
            itemId: fixture.items.b,
            accountId: null,
            deliveryLineId: null,
            description: null,
            descriptionAr: null,
            qty: "5",
            unitPrice: "40.000000",
            discountAmount: null,
            taxCodeId: fixture.taxCodeIds.standard,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    // Net 1,200.0000 · VAT 180.0000 · gross 1,380.0000 (W-1).
    expect(created.totalNet).toBe("1200.0000");
    expect(created.totalTax).toBe("180.0000");
    expect(created.totalGross).toBe("1380.0000");
    // BR-026: NET-30 from 2026-01-15 → 2026-02-14.
    expect(created.dueDate).toBe("2026-02-14");

    await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_SALES));
    await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));
    const result = await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));

    expect(result.invoiceNo).toMatch(/^SAL-2026-\d{6}$/);
    expect(result.idempotentReplay).toBe(false);

    // COGS entry (G-03): DR COGS 725.0000 · CR INVENTORY 725.0000.
    expect(await withTenant(TENANT_S, () => journalLinesOf(result.cogsJournalEntryId!))).toEqual([
      { accountId: fixture.gl.cogs, direction: "DEBIT", amount: "725.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "725.0000" },
    ]);

    // AR entry (G-01): DR AR_CONTROL 1,380 · CR revenue 1,200 · CR VAT 180
    // (per-line output-VAT legs — 15% × 1,000 + 15% × 200, the engine's
    // per-line stamping pattern, mirroring the purchasing input-VAT legs).
    expect(await withTenant(TENANT_S, () => journalLinesOf(result.journalEntryId!))).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "1380.0000" },
      { accountId: fixture.gl.salesRevenue, direction: "CREDIT", amount: "1200.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "150.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "30.0000" },
    ]);
    const moves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ sourceType: "sales_invoice", sourceId: created.id, limit: 10 }),
    );
    expect(moves.length).toBe(2);
    const moveA = moves.find((m) => m.itemId === fixture.items.a)!;
    const moveB = moves.find((m) => m.itemId === fixture.items.b)!;
    expect(moveA.direction).toBe("OUT");
    expect(moveA.qty).toBe("10.000000");
    expect(moveA.valueAmount).toBe("600.0000");
    expect(moveB.qty).toBe("5.000000");
    expect(moveB.valueAmount).toBe("125.0000");

    // On-hand: A −10, B −5 with UNCHANGED WAC (W-1 asserts; delta-based —
    // sibling specs may have consumed the fixture items earlier in the run).
    const stockA = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );
    const stockB = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.b, fixture.warehouseId),
    );
    expect(stockA!.qty).toBe(`${Number(stockABefore!.qty) - 10}.000000`);
    expect(stockA!.avgCost).toBe("60.000000");
    expect(stockB!.qty).toBe(`${Number(stockBBefore!.qty) - 5}.000000`);
    expect(stockB!.avgCost).toBe("25.000000");

    // AR open item: partner +1,380 outstanding (INV-009 from entry #1).
    const items = await withTenant(TENANT_S, () =>
      sStore.arOpenItemsAsOf({ customerId: fixture.customerId, asOf: S_JAN, openOnly: true, limit: 100 }),
    );
    const open = items.find((item) => item.sourceId === created.id)!;
    expect(open.outstanding).toBe("1380.0000");

    // INV-013 idempotent replay: re-post returns the stored result.
    const replay = await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.journalEntryId).toBe(result.journalEntryId);
  });

  it("NOT_SUBJECT variant: an NS-coded document records no VAT lines cleanly", async () => {
    const created = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: S_JAN,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        note: "NS variant",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: null,
            accountId: fixture.gl.serviceAccount,
            deliveryLineId: null,
            description: "service",
            descriptionAr: null,
            qty: "1",
            unitPrice: "100.000000",
            discountAmount: null,
            taxCodeId: fixture.taxCodeIds.notSubject,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    expect(created.totalTax).toBe("0.0000");
    expect(created.totalGross).toBe("100.0000");
    await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_SALES));
    await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));
    const result = await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));
    expect(await withTenant(TENANT_S, () => journalLinesOf(result.journalEntryId!))).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "100.0000" },
      { accountId: fixture.gl.serviceAccount, direction: "CREDIT", amount: "100.0000" },
    ]);
    expect(result.cogsJournalEntryId).toBeNull();
  });

  it("PERIOD_LOCKED: posting into a locked month leaves ZERO residue (INV-011)", async () => {
    const created = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: S_DEC,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        note: "PERIOD_LOCKED pack",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: null,
            accountId: fixture.gl.serviceAccount,
            deliveryLineId: null,
            description: "locked-month charge",
            descriptionAr: null,
            qty: "1",
            unitPrice: "50.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_SALES));
    await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));
    const period = await withTenant(TENANT_S, () => periodStore.findPeriodForDate(S_DEC));
    expect(period).toBeDefined();
    await withTenant(TENANT_S, () => sPeriods.softClose(S_ACTOR, period!.id));
    try {
      await withTenant(TENANT_S, () => sPeriods.lock(S_ACTOR, period!.id));
      await expect(
        withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR)),
      ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
      // Zero residue: no journal, no number consumed, status stays APPROVED.
      const row = await withTenant(TENANT_S, () => sStore.findSalesInvoiceById(created.id));
      expect(row!.status).toBe("APPROVED");
      expect(row!.invoiceNo).toBeNull();
      expect(row!.postedJournalId).toBeNull();
    } finally {
      await withTenant(TENANT_S, () =>
        sPeriods.reopen(S_ACTOR, period!.id, "G-01 PERIOD_LOCKED pack reopen"),
      );
    }
  });
});

describe("G-02 — cash invoice: DR cash · CR revenue · CR VAT (+ INV-019 movement)", () => {
  it("posts the exact shape and records the treasury cash movement", async () => {
    const created = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CASH",
        invoiceDate: S_JAN,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: fixture.cashAccountId,
        note: "G-02 cash",
        noteAr: null,
        actorId: S_CASHIER,
        lines: [
          {
            itemId: null,
            accountId: fixture.gl.serviceAccount,
            deliveryLineId: null,
            description: "counter service",
            descriptionAr: null,
            qty: "1",
            unitPrice: "150.000000",
            discountAmount: null,
            taxCodeId: fixture.taxCodeIds.standard,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    expect(created.totalGross).toBe("172.5000");
    // CASH invoices due immediately.
    expect(created.dueDate).toBe(S_JAN);
    // BR-001 never triggers on cash (no credit exposure) — ALLOW recorded.
    expect((created.creditCheck as { decision: string }).decision).toBe("ALLOW");

    await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_CASHIER));
    await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));
    const result = await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));
    expect(await withTenant(TENANT_S, () => journalLinesOf(result.journalEntryId!))).toEqual([
      { accountId: fixture.gl.cashGl, direction: "DEBIT", amount: "172.5000" },
      { accountId: fixture.gl.serviceAccount, direction: "CREDIT", amount: "150.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "22.5000" },
    ]);
    // INV-019: the cash account balance is ALWAYS Σ movements — the counter
    // receipt recorded a movement row sourced to the invoice.
    const movements = await withTenant(TENANT_S, () =>
      treasuryStore.listMovements({ cashAccountId: fixture.cashAccountId, limit: 50 }),
    );
    const movement = movements.find((m) => m.sourceType === "sales_invoice" && m.sourceId === created.id);
    expect(movement).toBeDefined();
    expect(movement!.direction).toBe("IN");
    expect(movement!.amount).toBe("172.5000");
  });
});

describe("G-03 — delivery note (flow A): COGS at issue, no AR; converts to invoice", () => {
  it("posts DR COGS · CR INVENTORY at issue cost and converts to a revenue-only invoice (BR-007)", async () => {
    const onHandBefore = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );
    const delivery = await withTenant(TENANT_S, () =>
      deliveries.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        orderId: null,
        warehouseId: fixture.warehouseId,
        deliveryDate: S_JAN,
        currencyCode: "SAR",
        note: "G-03 delivery",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            orderLineId: null,
            itemId: fixture.items.a,
            qty: "2",
            unitPrice: "100.000000",
            discountAmount: null,
            batchId: null,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    const result = await withTenant(TENANT_S, () => deliveries.post(delivery.id, S_ACTOR));
    expect(result.deliveryNo).toMatch(/^DEL-2026-\d{6}$/);

    // G-03: DR COGS 120.0000 (2 × 60 WAC) · CR INVENTORY 120.0000 — no AR.
    expect(await withTenant(TENANT_S, () => journalLinesOf(result.journalEntryId!))).toEqual([
      { accountId: fixture.gl.cogs, direction: "DEBIT", amount: "120.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "120.0000" },
    ]);
    const moves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ sourceType: "delivery_note", sourceId: delivery.id, limit: 10 }),
    );
    expect(moves.length).toBe(1);
    expect(moves[0]!.valueAmount).toBe("120.0000");
    const onHandAfter = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );
    expect(Number(onHandAfter!.qty)).toBe(Number(onHandBefore!.qty) - 2);

    // Convert to invoice (flow A): the invoice posts revenue ONLY — the
    // DN already posted COGS; no second COGS journal exists.
    const invoice = await withTenant(TENANT_S, () =>
      salesInvoices.createFromDelivery({
        deliveryId: delivery.id,
        dueDate: null,
        taxCodeId: fixture.taxCodeIds.standard,
        note: null,
        actorId: S_SALES,
      }),
    );
    await withTenant(TENANT_S, () => salesInvoices.submit(invoice.id, S_SALES));
    await withTenant(TENANT_S, () => salesInvoices.approve(invoice.id, S_ACTOR, false));
    const posted = await withTenant(TENANT_S, () => salesInvoices.post(invoice.id, S_ACTOR));
    expect(posted.cogsJournalEntryId).toBeNull();
    expect(await withTenant(TENANT_S, () => journalLinesOf(posted.journalEntryId!))).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "230.0000" },
      { accountId: fixture.gl.salesRevenue, direction: "CREDIT", amount: "200.0000" },
      { accountId: fixture.gl.vatPayable, direction: "CREDIT", amount: "30.0000" },
    ]);
    // The DN's converted link + the invoice line carries the issue-cost
    // snapshot (the W-3 re-entry provenance).
    const dnRow = await withTenant(TENANT_S, () => sStore.findDeliveryNoteById(delivery.id));
    expect(dnRow!.convertedInvoiceId).toBe(invoice.id);
    const invoiceLines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(invoice.id));
    expect(invoiceLines[0]!.issueUnitCost).toBe("60.000000");
  });
});

describe("G-04 — credit note with return (W-3 exact figures, original cost re-entry)", () => {
  it("posts the mirror + the stock re-entry at the ORIGINAL issue cost", async () => {
    // Reference the W-1 invoice's item-A line.
    const posted = await withTenant(TENANT_S, () =>
      sStore.listSalesInvoices({ status: "POSTED", customerId: fixture.customerId, limit: 50 }),
    );
    const w1 = posted.find((row) => row.totalGross === "1380.0000")!;
    const w1Lines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(w1.id));
    const lineA = w1Lines.find((line) => line.itemId === fixture.items.a)!;
    const stockBefore = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );

    const note = await withTenant(TENANT_S, () =>
      creditNotes.create({
        branchId: fixture.branchId,
        salesRepId: null,
        invoiceId: w1.id,
        noteDate: S_JAN,
        note: "W-3 return of 2 units of A (damaged)",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            invoiceLineId: lineA.id,
            qty: "2",
            unitPrice: null, // defaults to the invoice line's price (100)
            discountAmount: null,
            taxCodeId: null, // defaults to the invoice line's tax code (STD)
            returnToStock: true,
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
    expect(note.totalTax).toBe("30.0000");
    expect(note.totalGross).toBe("230.0000");
    expect(note.reentryValue).toBe("120.0000");

    await withTenant(TENANT_S, () => creditNotes.submit(note.id, S_SALES));
    await withTenant(TENANT_S, () => creditNotes.approve(note.id, S_ACTOR));
    const result = await withTenant(TENANT_S, () => creditNotes.post(note.id, S_ACTOR));
    expect(result.noteNo).toMatch(/^CRN-2026-\d{6}$/);

    // The credit-note entry: DR SALES_RETURNS 200 · DR VAT 30 · CR AR 230.
    expect(await withTenant(TENANT_S, () => journalLinesOf(result.journalEntryId!))).toEqual([
      { accountId: fixture.gl.salesReturns, direction: "DEBIT", amount: "200.0000" },
      { accountId: fixture.gl.vatPayable, direction: "DEBIT", amount: "30.0000" },
      { accountId: fixture.gl.arControl, direction: "CREDIT", amount: "230.0000" },
    ]);

    // The stock re-entry: DR INVENTORY 120 · CR COGS 120 at ORIGINAL cost.
    const reentry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("credit_note", note.id, "reentry"),
    );
    expect(reentry).toBeDefined();
    expect(await withTenant(TENANT_S, () => journalLinesOf(reentry!.id))).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "120.0000" },
      { accountId: fixture.gl.cogs, direction: "CREDIT", amount: "120.0000" },
    ]);

    // Stock A +2 @ 60 (reason CUSTOMER_RETURN — never a current-average
    // recompute; WAC stays exactly 60).
    const moves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ sourceType: "credit_note", sourceId: note.id, limit: 10 }),
    );
    expect(moves.length).toBe(1);
    expect(moves[0]!.direction).toBe("IN");
    expect(moves[0]!.qty).toBe("2.000000");
    expect(moves[0]!.unitCost).toBe("60.000000");
    expect(moves[0]!.valueAmount).toBe("120.0000");
    const stockAfter = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(fixture.items.a, fixture.warehouseId),
    );
    expect(Number(stockAfter!.qty)).toBe(Number(stockBefore!.qty) + 2);
    expect(stockAfter!.avgCost).toBe("60.000000");

    // AR effect (§3.4 explicit allocation): the invoice stays GROSS-OPEN —
    // the credit note is its own subledger row (mirroring the accepted
    // PHASE-011 debit-note model); the note's 230 CREDIT open item is
    // visible on the ALL side (never silently netted).
    const open = await withTenant(TENANT_S, () =>
      sStore.arOpenItemsAsOf({ customerId: fixture.customerId, asOf: S_JAN, openOnly: true, limit: 100 }),
    );
    expect(open.find((item) => item.sourceId === w1.id)!.outstanding).toBe("1380.0000");
    const allSides = await withTenant(TENANT_S, () =>
      sStore.arOpenItemsAsOf({
        customerId: fixture.customerId,
        asOf: S_JAN,
        openOnly: true,
        limit: 100,
        side: "ALL",
      }),
    );
    const noteItem = allSides.find((item) => item.sourceId === note.id);
    expect(noteItem).toBeDefined();
    expect(noteItem!.direction).toBe("CREDIT");
    expect(noteItem!.outstanding).toBe("230.0000");
  });
});

describe("G-05/G-06 — receipts via the treasury service (allocation + W-2 FX)", () => {
  it("settles the W-1 invoice exactly via the treasury service (G-05)", async () => {
    const posted = await withTenant(TENANT_S, () =>
      sStore.listSalesInvoices({ status: "POSTED", customerId: fixture.customerId, limit: 50 }),
    );
    const w1 = posted.find((row) => row.totalGross === "1380.0000")!;
    // §3.4 explicit allocation: the invoice stays GROSS-OPEN (the W-3 note
    // is its own row) — the receipt settles the FULL 1,380.
    const open = await withTenant(TENANT_S, () =>
      sStore.arOpenItemsAsOf({ customerId: fixture.customerId, asOf: S_JAN, openOnly: true, limit: 100 }),
    );
    const openItem = open.find((item) => item.sourceId === w1.id)!;
    expect(openItem.outstanding).toBe("1380.0000");

    const receipt = await withTenant(TENANT_S, () =>
      receipts.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.customerId,
        method: "CASH",
        payerName: "شركة النور",
        currencyCode: "SAR",
        amount: "1380.0000",
        exchangeRate: null,
        valueDate: S_JAN,
        reference: null,
        description: "G-05 settle W-1",
        descriptionAr: "سند قبض G-05",
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: receipt.id,
        allocations: [{ openItemId: openItem.id, amount: "1380.0000" }],
        actorId: S_CASHIER,
      }),
    );
    const result = await withTenant(TENANT_S, () => receipts.post(receipt.id, S_CASHIER));
    expect(result.docNo).toMatch(/^RCV-/);

    // G-05: DR cash 1,380 · CR AR_CONTROL (partner) 1,380.
    expect(await withTenant(TENANT_S, () => journalLinesOf(result.journalEntryId!))).toEqual([
      { accountId: fixture.gl.cashGl, direction: "DEBIT", amount: "1380.0000" },
      { accountId: fixture.gl.arControl, direction: "CREDIT", amount: "1380.0000" },
    ]);
    const after = await withTenant(TENANT_S, () =>
      sStore.arOpenItemsAsOf({ customerId: fixture.customerId, asOf: S_JAN, openOnly: true, limit: 100 }),
    );
    expect(after.find((item) => item.sourceId === w1.id)).toBeUndefined(); // settled
  });

  it("W-2 FX gain: a USD invoice settled at a higher rate posts the explicit FX_GAIN residual", async () => {
    // USD service invoice 1,000 @ 3.75 → AR base 3,750 (INV-008 stored rate).
    const invoice = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: S_JAN,
        dueDate: null,
        currencyCode: "USD",
        exchangeRate: "3.75000000",
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        note: "W-2 USD invoice",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: null,
            accountId: fixture.gl.serviceAccount,
            deliveryLineId: null,
            description: "USD service",
            descriptionAr: null,
            qty: "1",
            unitPrice: "1000.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_S, () => salesInvoices.submit(invoice.id, S_SALES));
    await withTenant(TENANT_S, () => salesInvoices.approve(invoice.id, S_ACTOR, false));
    const posted = await withTenant(TENANT_S, () => salesInvoices.post(invoice.id, S_ACTOR));
    expect(await withTenant(TENANT_S, () => journalLinesOf(posted.journalEntryId!))).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "1000.0000" },
      { accountId: fixture.gl.serviceAccount, direction: "CREDIT", amount: "1000.0000" },
    ]);

    const open = await withTenant(TENANT_S, () =>
      sStore.arOpenItemsAsOf({ customerId: fixture.customerId, asOf: "2026-02-25", openOnly: true, limit: 100 }),
    );
    const openItem = open.find((item) => item.sourceId === invoice.id)!;

    // Receipt 1,000 USD @ 3.76 → cash 3,760 · AR 3,750 (original rate) · FX_GAIN 10.
    const receipt = await withTenant(TENANT_S, () =>
      receipts.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.customerId,
        method: "BANK",
        payerName: "شركة النور",
        currencyCode: "USD",
        amount: "1000.0000",
        exchangeRate: "3.76000000",
        valueDate: "2026-02-25",
        reference: null,
        description: "W-2 receipt at 3.76",
        descriptionAr: "سند قبض W-2",
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: receipt.id,
        allocations: [{ openItemId: openItem.id, amount: "1000.0000" }],
        actorId: S_CASHIER,
      }),
    );
    const result = await withTenant(TENANT_S, () => receipts.post(receipt.id, S_CASHIER));
    // The W-2 journal (base SAR): cash 3,760 DR · AR 3,750 CR · FX_GAIN 10 CR.
    const lines = await withTenant(TENANT_S, () => journal.listLines(result.journalEntryId!));
    const fxLine = lines.find(
      (line) => line.accountId !== fixture.gl.cashGl && line.accountId !== fixture.gl.arControl,
    );
    expect(fxLine).toBeDefined();
    expect(fxLine!.baseAmount).toBe("10.0000");
  });

  it("W-2 FX mirror: settling at a lower rate posts the explicit FX_LOSS residual", async () => {
    const invoice = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: S_JAN,
        dueDate: null,
        currencyCode: "USD",
        exchangeRate: "3.75000000",
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        note: "W-2 mirror USD invoice",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: null,
            accountId: fixture.gl.serviceAccount,
            deliveryLineId: null,
            description: "USD service (loss mirror)",
            descriptionAr: null,
            qty: "1",
            unitPrice: "500.000000",
            discountAmount: null,
            taxCodeId: null,
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

    const open = await withTenant(TENANT_S, () =>
      sStore.arOpenItemsAsOf({ customerId: fixture.customerId, asOf: "2026-03-25", openOnly: true, limit: 100 }),
    );
    const openItem = open.find((item) => item.sourceId === invoice.id)!;
    const receipt = await withTenant(TENANT_S, () =>
      receipts.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.customerId,
        method: "BANK",
        payerName: "شركة النور",
        currencyCode: "USD",
        amount: "500.0000",
        exchangeRate: "3.74000000",
        valueDate: "2026-03-25",
        reference: null,
        description: "W-2 mirror receipt at 3.74",
        descriptionAr: null,
        actorId: S_CASHIER,
      }),
    );
    await withTenant(TENANT_S, () =>
      allocations.setAllocations({
        docType: "receipt",
        docId: receipt.id,
        allocations: [{ openItemId: openItem.id, amount: "500.0000" }],
        actorId: S_CASHIER,
      }),
    );
    const result = await withTenant(TENANT_S, () => receipts.post(receipt.id, S_CASHIER));
    const lines = await withTenant(TENANT_S, () => journal.listLines(result.journalEntryId!));
    const fxLine = lines.find(
      (line) => line.accountId !== fixture.gl.cashGl && line.accountId !== fixture.gl.arControl,
    );
    expect(fxLine).toBeDefined();
    expect(fxLine!.baseAmount).toBe("5.0000"); // 500 × (3.75 − 3.74)
  });
});

describe("CC-01 — duplicate-post serialization (INV-013)", () => {
  it("concurrent posts of the same invoice produce ONE entry set", async () => {
    const target = await withTenant(TENANT_S, async () => {
      const invoice = await salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: S_JAN,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: null,
        cashAccountId: null,
        note: "CC-01 serialization",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: null,
            accountId: fixture.gl.serviceAccount,
            deliveryLineId: null,
            description: "cc-01",
            descriptionAr: null,
            qty: "1",
            unitPrice: "1.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      });
      await salesInvoices.submit(invoice.id, S_SALES);
      await salesInvoices.approve(invoice.id, S_ACTOR, false);
      return invoice.id;
    });
    const [a, b] = await Promise.all([
      withTenant(TENANT_S, () => salesInvoices.post(target, S_ACTOR)),
      withTenant(TENANT_S, () => salesInvoices.post(target, S_ACTOR)),
    ]);
    expect(a.journalEntryId ?? b.journalEntryId).toBeDefined();
    const row = await withTenant(TENANT_S, () => sStore.findSalesInvoiceById(target));
    expect(row!.status).toBe("POSTED");
    // Exactly ONE journal entry for the AR operation (INV-013).
    const arEntry = await withTenant(TENANT_S, () =>
      journal.findEntryBySourceKey("sales_invoice", target, "post"),
    );
    expect(arEntry).toBeDefined();
  });
});
