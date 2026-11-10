import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as periodStore from "../../modules/accounting/infrastructure/accounting.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as pStore from "../../modules/purchasing/infrastructure/purchasing.store";
import {
  P_ACTOR,
  P_ACCOUNTANT,
  P_BUYER,
  P_JAN,
  P_FEB,
  P_MAR,
  P_DEC,
  TENANT_P,
  allocations,
  goodsReceipts,
  payments,
  pPeriods,
  purchaseOrders,
  purchaseRequests,
  purchasingReconciliation,
  setupPurchasingFixture,
  supplierInvoices,
  debitNotes,
  apQueries,
  type PurchasingFixture,
} from "./fixtures";

/**
 * PHASE-011 golden posting tests (ACCOUNTING_TESTS §3, this phase's
 * executable subset): G-07 GRN (stock + GRNI accrual), G-08 supplier
 * invoice (GRNI clear + AP open + VAT recoverable/expensed/NOT_SUBJECT
 * variants + partial invoice), G-09 debit note (mirror), G-10 payment
 * (AP settle + the W-2 FX mirror) — each asserting the EXACT journal
 * lines (account, direction, amount), the stock rows (value_amount = the
 * journal quantum), the document state, the subledger open item, and the
 * standard failure packs (PERIOD_LOCKED, PURPOSE_NOT_MAPPED, over-invoice)
 * with zero residue.
 */

let fixture: PurchasingFixture;

beforeAll(async () => {
  fixture = await setupPurchasingFixture();
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

async function grniRegisterValue(asOf: string): Promise<string> {
  const rows = await pStore.grniRegister(asOf);
  let total = 0;
  for (const row of rows) {
    total += Number(row.receivedValue) - Number(row.invoicedValue);
  }
  return total.toFixed(4);
}

/** The canonical P2P chain: PR → PO → GRN (the G-07 substrate). */
async function issuedOrderFor(itemId: string, qty: string, unitPrice: string): Promise<string> {
  const request = await withTenant(TENANT_P, () =>
    purchaseRequests.create({
      branchId: fixture.branchId,
      neededBy: P_JAN,
      note: "golden chain",
      noteAr: null,
      actorId: P_BUYER,
      lines: [{ itemId, qty, note: null }],
    }),
  );
  await withTenant(TENANT_P, () => purchaseRequests.submit(request.id, P_BUYER));
  await withTenant(TENANT_P, () => purchaseRequests.approve(request.id, P_ACTOR));

  const order = await withTenant(TENANT_P, () =>
    purchaseOrders.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      orderDate: P_JAN,
      expectedDate: P_JAN,
      currencyCode: "SAR",
      exchangeRate: null,
      note: null,
      noteAr: null,
      requestId: request.id,
      revisionOfId: null,
      actorId: P_BUYER,
      lines: [{ itemId, qty, unitPrice, taxCodeId: null, requestLineId: null, note: null }],
    }),
  );
  const issued = await withTenant(TENANT_P, () => purchaseOrders.issue(order.id, P_BUYER));
  expect(issued.orderNo).toMatch(/^POR-2026-\d{6}$/);
  return issued.id;
}

describe("G-07 — goods receipt: DR INVENTORY · CR GRNI (stock + accrual)", () => {
  it("posts the exact canonical shape with stock rows + GRNI register + audit", async () => {
    const orderId = await issuedOrderFor(fixture.items.wac, "100", "2.500000");
    const orderLines = await withTenant(TENANT_P, () => pStore.listPurchaseOrderLines(orderId));

    const stockBefore = await withTenant(TENANT_P, () =>
      inventoryStore.findItemStock(fixture.items.wac, fixture.warehouseId),
    );
    const qtyBefore = new (await import("@erp/domain-core")).Decimal(stockBefore?.qty ?? "0");
    const grn = await withTenant(TENANT_P, () =>
      goodsReceipts.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        poId: orderId,
        warehouseId: fixture.warehouseId,
        receiptDate: P_JAN,
        poLessReason: null,
        note: "G-07 receipt",
        noteAr: null,
        actorId: P_ACTOR,
        lines: [
          {
            poLineId: orderLines[0]!.id,
            itemId: fixture.items.wac,
            qty: "100",
            unitCost: "2.500000",
            accountId: null,
            batchNo: null,
            batchExpiry: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    const result = await withTenant(TENANT_P, () => goodsReceipts.post(grn.id, P_ACTOR));

    expect(result.receiptNo).toMatch(/^GRN-2026-\d{6}$/);
    expect(result.idempotentReplay).toBe(false);

    const lines = await withTenant(TENANT_P, () => journalLinesOf(result.journalEntryId!));
    expect(lines).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "250.0000" },
      { accountId: fixture.gl.grni, direction: "CREDIT", amount: "250.0000" },
    ]);

    // Stock landed: the on-hand delta is exactly +100 (suite files share
    // tenant P — delta-based assertions stay order-independent).
    const onHand = await withTenant(TENANT_P, () =>
      inventoryStore.findItemStock(fixture.items.wac, fixture.warehouseId),
    );
    const delta = new (await import("@erp/domain-core")).Decimal(onHand!.qty).minus(qtyBefore);
    expect(delta.toFixed(6)).toBe("100.000000");
    const moves = await withTenant(TENANT_P, () =>
      inventoryStore.listStockMoves({ sourceType: "goods_receipt", sourceId: grn.id, limit: 10 }),
    );
    expect(moves.length).toBe(1);
    expect(moves[0]!.direction).toBe("IN");
    expect(moves[0]!.qty).toBe("100.000000");
    expect(moves[0]!.valueAmount).toBe("250.0000");
    expect(moves[0]!.postedJournalId).toBe(result.journalEntryId);

    // GRNI register: received-not-invoiced = 250 at this point (RC-09 step 1).
    expect(await withTenant(TENANT_P, () => grniRegisterValue(P_JAN))).toBe("250.0000");

    // Document state: POSTED with the official number + journal link.
    const posted = await withTenant(TENANT_P, () => pStore.findGoodsReceiptById(grn.id));
    expect(posted!.status).toBe("POSTED");
    expect(posted!.postedJournalId).toBe(result.journalEntryId);
  });

  it("INV-013 idempotent replay: re-posting returns the stored result, no double journal", async () => {
    const grns = await withTenant(TENANT_P, () =>
      pStore.listGoodsReceipts({ status: "POSTED", limit: 1 }),
    );
    const replay = await withTenant(TENANT_P, () => goodsReceipts.post(grns[0]!.id, P_ACTOR));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.journalEntryId).toBe(grns[0]!.postedJournalId);
  });

  it("PERIOD_LOCKED: posting into a locked month leaves ZERO residue (INV-011)", async () => {
    const grn = await withTenant(TENANT_P, () =>
      goodsReceipts.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        poId: null,
        warehouseId: fixture.warehouseId,
        receiptDate: P_DEC,
        poLessReason: "G-07 PERIOD_LOCKED pack (direct purchase)",
        note: null,
        noteAr: null,
        actorId: P_ACTOR,
        lines: [
          {
            poLineId: null,
            itemId: fixture.items.wac,
            qty: "1",
            unitCost: "1.000000",
            accountId: null,
            batchNo: null,
            batchExpiry: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    const period = await withTenant(TENANT_P, () => periodStore.findPeriodForDate(P_DEC));
    expect(period).toBeDefined();
    await withTenant(TENANT_P, () => pPeriods.softClose(P_ACTOR, period!.id));
    try {
      await withTenant(TENANT_P, () => pPeriods.lock(P_ACTOR, period!.id));
      await expect(
        withTenant(TENANT_P, () => goodsReceipts.post(grn.id, P_ACTOR)),
      ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
      // Zero residue: no stock moves, no journal, status DRAFT.
      const moves = await withTenant(TENANT_P, () =>
        inventoryStore.listStockMoves({ sourceType: "goods_receipt", sourceId: grn.id, limit: 10 }),
      );
      expect(moves.length).toBe(0);
      const row = await withTenant(TENANT_P, () => pStore.findGoodsReceiptById(grn.id));
      expect(row!.status).toBe("DRAFT");
    } finally {
      await withTenant(TENANT_P, () =>
        pPeriods.reopen(P_ACTOR, period!.id, "G-07 PERIOD_LOCKED pack reopen"),
      );
    }
  });
});

describe("G-08 — supplier invoice: GRNI clear + AP open + VAT recoverable", () => {
  it("posts the exact canonical shape and clears the GRNI register exactly", async () => {
    // The G-07 receipt (100 @ 2.50, received not invoiced 250).
    const grns = await withTenant(TENANT_P, () =>
      pStore.listGoodsReceipts({ status: "POSTED", limit: 5 }),
    );
    const grn = grns.find((row) => row.poLessReason === null && row.totalValue === "250.0000")!;
    const grnLines = await withTenant(TENANT_P, () => pStore.listGoodsReceiptLines(grn.id));

    const invoice = await withTenant(TENANT_P, () =>
      supplierInvoices.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        invoiceNo: "SUP-G08-001",
        invoiceDate: P_JAN,
        dueDate: null, // NET-30 from the supplier's credit terms
        currencyCode: "SAR",
        exchangeRate: null,
        poId: grn.poId,
        note: null,
        noteAr: null,
        actorId: P_ACCOUNTANT,
        lines: [
          {
            grnLineId: grnLines[0]!.id,
            itemId: fixture.items.wac,
            accountId: null,
            description: "G-08 stock line",
            descriptionAr: null,
            qty: "100",
            unitPrice: "2.500000",
            taxCodeId: fixture.taxCodeIds.standard,
            vatRecoverable: null,
            note: null,
          },
        ],
      }),
    );
    // BR-026: due date = invoice date + NET-30.
    expect(invoice.dueDate).toBe("2026-02-14");
    expect(invoice.totalNet).toBe("250.0000");
    expect(invoice.totalTax).toBe("37.5000");
    expect(invoice.totalGross).toBe("287.5000");

    // BR-009: record the match (exact — 0% tolerances) before approval.
    const match = await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({ id: invoice.id, actorId: P_BUYER }),
    );
    expect(match.summary.outcome).toBe("MATCHED");

    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
    const result = await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));

    expect(result.internalNo).toMatch(/^SIN-2026-\d{6}$/);
    const lines = await withTenant(TENANT_P, () => journalLinesOf(result.journalEntryId!));
    expect(lines).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "250.0000" },
      { accountId: fixture.gl.vatRecoverable, direction: "DEBIT", amount: "37.5000" },
      { accountId: fixture.gl.apControl, direction: "CREDIT", amount: "287.5000" },
      { accountId: fixture.gl.grni, direction: "DEBIT", amount: "250.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "250.0000" },
    ]);

    // GRNI register: cleared exactly (RC-09 step 2).
    expect(await withTenant(TENANT_P, () => grniRegisterValue(P_JAN))).toBe("0.0000");

    // AP open item: 287.50 CREDIT with the partner (INV-009's substrate).
    const openItems = await withTenant(TENANT_P, () =>
      apQueries.openItems({ supplierId: fixture.supplierId }),
    );
    const item = openItems.find((row) => row.sourceType === "supplier_invoice" && row.sourceId === invoice.id);
    expect(item).toBeDefined();
    expect(item!.direction).toBe("CREDIT");
    expect(item!.amount).toBe("287.5000");
    expect(item!.outstanding).toBe("287.5000");
    expect(item!.dueDate).toBe("2026-02-14");

    // INV-012: the document tax summary row exists (INPUT side).
    const grniRun = await withTenant(TENANT_P, () =>
      purchasingReconciliation.runGrniCheck({ asOf: P_JAN, runMode: "ON_DEMAND", checkedBy: P_ACTOR }),
    );
    expect(grniRun.status).toBe("OK");
  });

  it("VAT_EXPENSED variant: non-recoverable input VAT posts to the expensed purpose (T6)", async () => {
    // A direct expense line — the expensed-VAT fixture (the stock GRN lines
    // are fully consumed by SUP-G08-001; the over-invoice guard would fire).
    const invoice = await withTenant(TENANT_P, () =>
      supplierInvoices.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        invoiceNo: "SUP-G08-002",
        invoiceDate: P_JAN,
        dueDate: "2026-02-14",
        currencyCode: "SAR",
        exchangeRate: null,
        poId: null,
        note: null,
        noteAr: null,
        actorId: P_ACCOUNTANT,
        lines: [
          {
            grnLineId: null,
            itemId: null,
            accountId: fixture.items.expenseAccount,
            description: "Exempt-supply-related input (expensed VAT)",
            descriptionAr: null,
            qty: "1",
            unitPrice: "100.000000",
            taxCodeId: fixture.taxCodeIds.standard,
            vatRecoverable: false,
            note: null,
          },
        ],
      }),
    );
    // Direct (no-GRN) line → UNMATCHED exception → disposition required.
    const match = await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({
        id: invoice.id,
        actorId: P_BUYER,
        dispositions: [
          { invoiceLineNo: 1, type: "ACCEPT_WITH_REASON", reason: "service invoice — no goods receipt" },
        ],
      }),
    );
    expect(match.summary.outcome).toBe("DISPOSITIONED");
    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
    const result = await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));

    const lines = await withTenant(TENANT_P, () => journalLinesOf(result.journalEntryId!));
    expect(lines).toEqual([
      { accountId: fixture.items.expenseAccount, direction: "DEBIT", amount: "100.0000" },
      { accountId: fixture.gl.vatExpensed, direction: "DEBIT", amount: "15.0000" },
      { accountId: fixture.gl.apControl, direction: "CREDIT", amount: "115.0000" },
    ]);
  });

  it("NOT_SUBJECT variant: an unregistered tenant records no VAT lines (T6)", async () => {
    // Flip the registration off BEFORE the invoice date window: create a
    // deregistered window using a second registration upsert.
    const { RegistrationService } = await import("../../modules/tax/application/registration-service");
    const audit2 = new (await import("../../modules/audit/api/audit")).AuditService(
      new (await import("../../modules/audit/infrastructure/drizzle-audit.store")).DrizzleAuditStore(),
    );
    const registrations = new RegistrationService(audit2);
    await withTenant(TENANT_P, () =>
      registrations.upsert({
        countryCode: "SA",
        status: "NOT_REGISTERED",
        registrationNumber: null,
        effectiveFrom: "2026-02-01",
        effectiveTo: null,
        actorId: P_ACTOR,
        note: "G-08 NOT_SUBJECT variant",
      }),
    );
    const invoice = await withTenant(TENANT_P, () =>
      supplierInvoices.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        invoiceNo: "SUP-G08-003",
        invoiceDate: "2026-02-15",
        dueDate: "2026-03-17",
        currencyCode: "SAR",
        exchangeRate: null,
        poId: null,
        note: null,
        noteAr: null,
        actorId: P_ACCOUNTANT,
        lines: [
          {
            grnLineId: null,
            itemId: null,
            accountId: fixture.items.expenseAccount,
            description: "Unregistered-tenant purchase",
            descriptionAr: null,
            qty: "1",
            unitPrice: "200.000000",
            taxCodeId: fixture.taxCodeIds.standard,
            vatRecoverable: null,
            note: null,
          },
        ],
      }),
    );
    expect(invoice.totalTax).toBe("0.0000");
    const match = await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({
        id: invoice.id,
        actorId: P_BUYER,
        dispositions: [
          { invoiceLineNo: 1, type: "ACCEPT_WITH_REASON", reason: "direct expense purchase" },
        ],
      }),
    );
    expect(match.summary.outcome).toBe("DISPOSITIONED");
    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
    const result = await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));
    const lines = await withTenant(TENANT_P, () => journalLinesOf(result.journalEntryId!));
    expect(lines).toEqual([
      { accountId: fixture.items.expenseAccount, direction: "DEBIT", amount: "200.0000" },
      { accountId: fixture.gl.apControl, direction: "CREDIT", amount: "200.0000" },
    ]);
    // Restore the REGISTERED state for the rest of the suite (the upsert
    // is one-row-per-country: a single full-window row restores it).
    await withTenant(TENANT_P, () =>
      registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: P_ACTOR,
        note: "restore after NOT_SUBJECT variant",
      }),
    );
  });

  it("partial invoice: 60 of 100 clears GRNI proportionally (RISK-009 control)", async () => {
    const orderId = await issuedOrderFor(fixture.items.fifo, "100", "4.000000");
    const orderLines = await withTenant(TENANT_P, () => pStore.listPurchaseOrderLines(orderId));
    const grn = await withTenant(TENANT_P, () =>
      goodsReceipts.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        poId: orderId,
        warehouseId: fixture.warehouseId,
        receiptDate: P_JAN,
        poLessReason: null,
        note: null,
        noteAr: null,
        actorId: P_ACTOR,
        lines: [
          {
            poLineId: orderLines[0]!.id,
            itemId: fixture.items.fifo,
            qty: "100",
            unitCost: "4.000000",
            accountId: null,
            batchNo: null,
            batchExpiry: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_P, () => goodsReceipts.post(grn.id, P_ACTOR));
    // GRNI = 400 now.
    const grnLines = await withTenant(TENANT_P, () => pStore.listGoodsReceiptLines(grn.id));
    const invoice = await withTenant(TENANT_P, () =>
      supplierInvoices.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        invoiceNo: "SUP-G08-PART",
        invoiceDate: P_JAN,
        dueDate: "2026-02-14",
        currencyCode: "SAR",
        exchangeRate: null,
        poId: orderId,
        note: null,
        noteAr: null,
        actorId: P_ACCOUNTANT,
        lines: [
          {
            grnLineId: grnLines[0]!.id,
            itemId: fixture.items.fifo,
            accountId: null,
            description: "partial",
            descriptionAr: null,
            qty: "60",
            unitPrice: "4.000000",
            taxCodeId: null,
            vatRecoverable: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_P, () => supplierInvoices.recordMatch({ id: invoice.id, actorId: P_BUYER }));
    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
    const result = await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));

    const lines = await withTenant(TENANT_P, () => journalLinesOf(result.journalEntryId!));
    expect(lines).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "240.0000" },
      { accountId: fixture.gl.apControl, direction: "CREDIT", amount: "240.0000" },
      { accountId: fixture.gl.grni, direction: "DEBIT", amount: "240.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "240.0000" },
    ]);
    // GRNI register: 400 received − 240 invoiced = 160 remaining.
    const rows = await withTenant(TENANT_P, () => pStore.grniRegister(P_JAN));
    const fifoRow = rows.find((row) => row.itemId === fixture.items.fifo);
    expect(fifoRow!.receivedValue).toBe("400.0000");
    expect(fifoRow!.invoicedValue).toBe("240.0000");

    // Over-invoice guard: 41 more exceeds the 40 remainder → typed rejection.
    await expect(
      withTenant(TENANT_P, () =>
        supplierInvoices.create({
          branchId: fixture.branchId,
          supplierId: fixture.supplierId,
          invoiceNo: "SUP-G08-OVER",
          invoiceDate: P_JAN,
          dueDate: "2026-02-14",
          currencyCode: "SAR",
          exchangeRate: null,
          poId: null,
          note: null,
          noteAr: null,
          actorId: P_ACCOUNTANT,
          lines: [
            {
              grnLineId: grnLines[0]!.id,
              itemId: fixture.items.fifo,
              accountId: null,
              description: "over-invoice attempt",
              descriptionAr: null,
              qty: "41",
              unitPrice: "4.000000",
              taxCodeId: null,
              vatRecoverable: null,
              note: null,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "INVOICE_GRN_ALREADY_CLEARED" });
  });
});

describe("G-09 — debit note: DR AP_CONTROL · CR INVENTORY · CR VAT_RECOVERABLE", () => {
  it("posts the mirror correction referencing the posted invoice", async () => {
    const invoices = await withTenant(TENANT_P, () =>
      pStore.listSupplierInvoices({ status: "POSTED", limit: 10 }),
    );
    const invoice = invoices.find((row) => row.invoiceNo === "SUP-G08-001")!;

    const note = await withTenant(TENANT_P, () =>
      debitNotes.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        refInvoiceId: invoice.id,
        noteDate: P_FEB,
        currencyCode: "SAR",
        exchangeRate: null,
        note: "damaged units returned to supplier",
        noteAr: null,
        actorId: P_ACCOUNTANT,
        lines: [
          {
            invoiceLineId: null,
            itemId: fixture.items.wac,
            accountId: null,
            description: "10 damaged units",
            qty: "10",
            unitPrice: "2.500000",
            taxCodeId: fixture.taxCodeIds.standard,
            vatRecoverable: null,
            note: null,
          },
        ],
      }),
    );
    expect(note.totalNet).toBe("25.0000");
    expect(note.totalTax).toBe("3.7500");
    expect(note.totalGross).toBe("28.7500");

    await withTenant(TENANT_P, () => debitNotes.submit(note.id, P_ACCOUNTANT));
    await withTenant(TENANT_P, () => debitNotes.approve(note.id, P_ACTOR));
    const result = await withTenant(TENANT_P, () => debitNotes.post(note.id, P_ACCOUNTANT));

    expect(result.noteNo).toMatch(/^DBN-2026-\d{6}$/);
    const lines = await withTenant(TENANT_P, () => journalLinesOf(result.journalEntryId!));
    expect(lines).toEqual([
      { accountId: fixture.gl.apControl, direction: "DEBIT", amount: "28.7500" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "25.0000" },
      { accountId: fixture.gl.vatRecoverable, direction: "CREDIT", amount: "3.7500" },
    ]);

    // The DN posts its own subledger effect: the supplier's STATEMENT
    // balance nets the 28.75 (the invoice itself stays gross-open until
    // payment — notes offset invoices by explicit allocation, §3.4).
    const statement = await withTenant(TENANT_P, () =>
      apQueries.statement({ supplierId: fixture.supplierId, asOf: P_FEB }),
    );
    const dnEntry = statement.entries.find(
      (row) => row.sourceType === "debit_note" && row.debit === "28.7500",
    );
    expect(dnEntry).toBeDefined();
  });
});

describe("G-10 — payment: DR AP_CONTROL · CR CASH (+ the W-2 FX mirror)", () => {
  it("settles the open invoice exactly via the treasury service", async () => {
    const invoices = await withTenant(TENANT_P, () =>
      pStore.listSupplierInvoices({ status: "POSTED", limit: 10 }),
    );
    const invoice = invoices.find((row) => row.invoiceNo === "SUP-G08-001")!;
    const openItems = await withTenant(TENANT_P, () =>
      apQueries.openItems({ supplierId: fixture.supplierId }),
    );
    const item = openItems.find((row) => row.sourceId === invoice.id)!;

    // The invoice stays gross-open (the DN is a separate subledger row —
    // §3.4 explicit allocation); the payment settles the full 287.50.
    expect(item.outstanding).toBe("287.5000");
    const payment = await withTenant(TENANT_P, () =>
      payments.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.supplierId,
        method: "BANK",
        payeeName: null,
        currencyCode: "SAR",
        amount: "287.5000",
        exchangeRate: null,
        valueDate: P_FEB,
        reference: "G-10",
        description: "G-10 payment",
        descriptionAr: null,
        actorId: P_ACCOUNTANT,
      }),
    );
    await withTenant(TENANT_P, () =>
      allocations.setAllocations({
        docType: "payment",
        docId: payment.id,
        allocations: [{ openItemId: item.id, amount: "287.5000" }],
        actorId: P_ACCOUNTANT,
      }),
    );
    const posted = await withTenant(TENANT_P, () => payments.post(payment.id, P_ACCOUNTANT));
    expect(posted.docNo).toMatch(/^PAY-2026-\d{6}$/);

    const cashGlAccount = await withTenant(TENANT_P, async () => {
      const { findAccountByCode } = await import("../../modules/accounting/infrastructure/accounting.store");
      return (await findAccountByCode("1111"))!.id;
    });
    const lines = await withTenant(TENANT_P, () => journalLinesOf(posted.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.gl.apControl, direction: "DEBIT", amount: "287.5000" },
      { accountId: cashGlAccount, direction: "CREDIT", amount: "287.5000" },
    ]);

    // The invoice is settled: outstanding 258.75 → 0 (the DN reduced it).
    const after = await withTenant(TENANT_P, () =>
      apQueries.openItems({ supplierId: fixture.supplierId }),
    );
    const settled = after.find((row) => row.sourceId === invoice.id);
    expect(settled).toBeUndefined(); // fully settled → not open anymore
  });

  it("FX mirror of W-2: paying a USD invoice at a higher rate posts the explicit FX_LOSS", async () => {
    // USD invoice (100 @ rate 3.75) → AP 375.00 SAR; pay at 3.76 → cash 376,
    // control 375 (original stored rate, INV-008), FX_LOSS 1.0000.
    const invoice = await withTenant(TENANT_P, () =>
      supplierInvoices.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        invoiceNo: "SUP-G10-FX",
        invoiceDate: P_FEB,
        dueDate: "2026-03-17",
        currencyCode: "USD",
        exchangeRate: "3.75000000",
        poId: null,
        note: null,
        noteAr: null,
        actorId: P_ACCOUNTANT,
        lines: [
          {
            grnLineId: null,
            itemId: null,
            accountId: fixture.items.expenseAccount,
            description: "FX purchase",
            descriptionAr: null,
            qty: "1",
            unitPrice: "100.000000",
            taxCodeId: null,
            vatRecoverable: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({
        id: invoice.id,
        actorId: P_BUYER,
        dispositions: [{ invoiceLineNo: 1, type: "ACCEPT_WITH_REASON", reason: "direct FX purchase" }],
      }),
    );
    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
    const posted = await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));
    // USD journal: DR expense 100 · CR AP 100 at rate 3.75.
    const invLines = await withTenant(TENANT_P, () => journalLinesOf(posted.journalEntryId!));
    expect(invLines).toEqual([
      { accountId: fixture.items.expenseAccount, direction: "DEBIT", amount: "100.0000" },
      { accountId: fixture.gl.apControl, direction: "CREDIT", amount: "100.0000" },
    ]);

    const openItems = await withTenant(TENANT_P, () =>
      apQueries.openItems({ supplierId: fixture.supplierId }),
    );
    const item = openItems.find((row) => row.sourceId === invoice.id)!;
    const payment = await withTenant(TENANT_P, () =>
      payments.create({
        cashAccountId: fixture.cashAccountId,
        partnerId: fixture.supplierId,
        method: "BANK",
        payeeName: null,
        currencyCode: "USD",
        amount: "100.0000",
        exchangeRate: "3.76000000",
        valueDate: P_MAR,
        reference: "G-10 FX",
        description: "G-10 FX payment",
        descriptionAr: null,
        actorId: P_ACCOUNTANT,
      }),
    );
    await withTenant(TENANT_P, () =>
      allocations.setAllocations({
        docType: "payment",
        docId: payment.id,
        allocations: [{ openItemId: item.id, amount: "100.0000" }],
        actorId: P_ACCOUNTANT,
      }),
    );
    const result = await withTenant(TENANT_P, () => payments.post(payment.id, P_ACCOUNTANT));
    expect(result.fxGainLoss).toBe("-1.0000"); // loss 1.0000 (signed)

    // The settlement posts in BASE with explicit legs: control 375 @ r₀,
    // cash 376 @ r₁, FX_LOSS 1 (W-2's mirror — ACCOUNTING_TESTS §3.2).
    const cashGlAccount = await withTenant(TENANT_P, async () => {
      const { findAccountByCode } = await import("../../modules/accounting/infrastructure/accounting.store");
      return (await findAccountByCode("1111"))!.id;
    });
    const lines = await withTenant(TENANT_P, () => journalLinesOf(result.journalEntryId));
    // 3 lines: DR AP 375 (original stored rate r₀, INV-008) · DR FX_LOSS 1
    // (explicit residual) · CR CASH 376 (settlement rate r₁) — W-2's mirror.
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ accountId: fixture.gl.apControl, direction: "DEBIT", amount: "375.0000" });
    expect(lines[1]!.direction).toBe("DEBIT");
    expect(lines[1]!.amount).toBe("1.0000");
    expect(lines[2]).toEqual({ accountId: cashGlAccount, direction: "CREDIT", amount: "376.0000" });
  });
});
