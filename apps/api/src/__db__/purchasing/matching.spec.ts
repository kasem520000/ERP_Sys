import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as pStore from "../../modules/purchasing/infrastructure/purchasing.store";
import {
  P_ACCOUNTANT,
  P_ACTOR,
  P_BUYER,
  P_JAN,
  TENANT_P,
  goodsReceipts,
  purchaseOrders,
  setupPurchasingFixture,
  supplierInvoices,
  type PurchasingFixture,
} from "./fixtures";

/**
 * PHASE-011 three-way matching + duplicate-invoice tests (BR-009/BR-011;
 * ACCOUNTING_TESTS §2; the phase §6 failure paths): the tolerance matrix
 * (exact default, 2% loosened — the BR-009 worked example), partial
 * receipt (GRN 98/100 → invoice 100 → quantity exception on the 2-unit
 * gap), match-before-approval enforcement (posting without a recorded
 * outcome is rejected), tolerance override, and the duplicate-invoice
 * semantics ((supplier, number, amount) blocks / (supplier, number)
 * different amount warns).
 */

let fixture: PurchasingFixture;

beforeAll(async () => {
  fixture = await setupPurchasingFixture();
});

async function chain(input: { qty: string; unitPrice: string; invoiceQty: string; invoicePrice: string }) {
  const order = await withTenant(TENANT_P, () =>
    purchaseOrders.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      orderDate: P_JAN,
      expectedDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      note: null,
      noteAr: null,
      requestId: null,
      revisionOfId: null,
      actorId: P_BUYER,
      lines: [
        { itemId: fixture.items.wac, qty: input.qty, unitPrice: input.unitPrice, taxCodeId: null, requestLineId: null, note: null },
      ],
    }),
  );
  await withTenant(TENANT_P, () => purchaseOrders.issue(order.id, P_BUYER));
  const orderLines = await withTenant(TENANT_P, () => pStore.listPurchaseOrderLines(order.id));
  const grn = await withTenant(TENANT_P, () =>
    goodsReceipts.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      poId: order.id,
      warehouseId: fixture.warehouseId,
      receiptDate: P_JAN,
      poLessReason: null,
      note: null,
      noteAr: null,
      actorId: P_ACTOR,
      lines: [
        {
          poLineId: orderLines[0]!.id,
          itemId: fixture.items.wac,
          qty: input.qty,
          unitCost: input.unitPrice,
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
  const grnLines = await withTenant(TENANT_P, () => pStore.listGoodsReceiptLines(grn.id));
  const invoice = await withTenant(TENANT_P, () =>
    supplierInvoices.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      invoiceNo: `SUP-MATCH-${Date.now()}-${(Math.random() * 10000) | 0}`,
      invoiceDate: P_JAN,
      dueDate: "2026-02-14",
      currencyCode: "SAR",
      exchangeRate: null,
      poId: order.id,
      note: null,
      noteAr: null,
      actorId: P_ACCOUNTANT,
      lines: [
        {
          grnLineId: grnLines[0]!.id,
          itemId: fixture.items.wac,
          accountId: null,
          description: null,
          descriptionAr: null,
          qty: input.invoiceQty,
          unitPrice: input.invoicePrice,
          taxCodeId: null,
          vatRecoverable: null,
          note: null,
        },
      ],
    }),
  );
  return { order, grn, invoice, grnLineId: grnLines[0]!.id };
}

describe("BR-009 — three-way matching tolerance matrix", () => {
  it("exact (0% default): matching triple passes clean", async () => {
    const { invoice } = await chain({ qty: "100", unitPrice: "50.000000", invoiceQty: "100", invoicePrice: "50.000000" });
    const match = await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({ id: invoice.id, actorId: P_BUYER }),
    );
    expect(match.summary.outcome).toBe("MATCHED");
    expect(match.lines[0]!.outcome).toBe("MATCHED");
    expect(match.tolerances).toEqual({ qtyPct: "0", pricePct: "0" });
    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
  });

  it("price variance 2% with 0% tolerance → EXCEPTION; disposition unblocks approval (the worked example)", async () => {
    const { invoice } = await chain({ qty: "1", unitPrice: "50.000000", invoiceQty: "1", invoicePrice: "51.000000" });
    const preview = await withTenant(TENANT_P, () => supplierInvoices.matchPreview(invoice.id, P_BUYER));
    expect(preview.lines[0]!.outcome).toBe("PRICE_EXCEPTION");
    expect(preview.lines[0]!.priceVariancePct).toBe("2.0000");
    expect(preview.summary.outcome).toBe("EXCEPTION");

    // Record the exception (no disposition) — approval is blocked (BR-009).
    const recorded = await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({ id: invoice.id, actorId: P_BUYER }),
    );
    expect(recorded.summary.outcome).toBe("EXCEPTION");
    await expect(
      withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR)),
    ).rejects.toMatchObject({ code: "MATCH_EXCEPTION_UNDISPOSED" });

    const disposed = await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({
        id: invoice.id,
        actorId: P_BUYER,
        dispositions: [
          { invoiceLineNo: 1, type: "ACCEPT_WITH_REASON", reason: "supplier confirmed new price (BR-009 worked example)" },
        ],
      }),
    );
    expect(disposed.summary.outcome).toBe("DISPOSITIONED");
    expect(disposed.lines[0]!.disposition!.type).toBe("ACCEPT_WITH_REASON");
    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));

    // The variance revalues the stock: invoice 51 vs provisional 50 → +1 DR
    // INVENTORY with the revaluation move (INV-010 exact).
    const result = await withTenant(TENANT_P, () => supplierInvoices.post(invoice.id, P_ACCOUNTANT));
    expect(result.idempotentReplay).toBe(false);
    const inventoryStore = await import("../../modules/inventory/infrastructure/inventory.store");
    const moves = await withTenant(TENANT_P, () =>
      inventoryStore.listStockMoves({ sourceType: "supplier_invoice", sourceId: invoice.id, limit: 10 }),
    );
    expect(moves.length).toBe(1);
    expect(moves[0]!.valueAmount).toBe("1.0000");
    expect(moves[0]!.moveKind).toBe("adjust");
    expect(moves[0]!.reason).toBe("INVOICE_REVALUE");
  });

  it("price variance 2% WITH 2% tolerance → auto-pass with the variance recorded", async () => {
    const { invoice } = await chain({ qty: "1", unitPrice: "50.000000", invoiceQty: "1", invoicePrice: "51.000000" });
    const match = await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({
        id: invoice.id,
        actorId: P_BUYER,
        tolerancesOverride: { qtyPct: "2", pricePct: "2" },
      }),
    );
    expect(match.overrideApplied).toBe(true);
    expect(match.lines[0]!.outcome).toBe("PRICE_VARIANCE_WITHIN_TOLERANCE");
    expect(match.lines[0]!.priceVariancePct).toBe("2.0000");
    expect(match.summary.outcome).toBe("MATCHED");
    await withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACTOR));
  });

  it("partial receipt: GRN 98/100, invoice 100 → quantity exception on the 2-unit gap", async () => {
    const order = await withTenant(TENANT_P, () =>
      purchaseOrders.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        orderDate: P_JAN,
        expectedDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        note: null,
        noteAr: null,
        requestId: null,
        revisionOfId: null,
        actorId: P_BUYER,
        lines: [
          { itemId: fixture.items.wac, qty: "100", unitPrice: "10.000000", taxCodeId: null, requestLineId: null, note: null },
        ],
      }),
    );
    await withTenant(TENANT_P, () => purchaseOrders.issue(order.id, P_BUYER));
    const orderLines = await withTenant(TENANT_P, () => pStore.listPurchaseOrderLines(order.id));
    const grn = await withTenant(TENANT_P, () =>
      goodsReceipts.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        poId: order.id,
        warehouseId: fixture.warehouseId,
        receiptDate: P_JAN,
        poLessReason: null,
        note: null,
        noteAr: null,
        actorId: P_ACTOR,
        lines: [
          {
            poLineId: orderLines[0]!.id,
            itemId: fixture.items.wac,
            qty: "98",
            unitCost: "10.000000",
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
    const grnLines = await withTenant(TENANT_P, () => pStore.listGoodsReceiptLines(grn.id));

    // The over-receipt guard blocks a GRN of the 2-unit remainder twice.
    await expect(
      withTenant(TENANT_P, () =>
        goodsReceipts.create({
          branchId: fixture.branchId,
          supplierId: fixture.supplierId,
          poId: order.id,
          warehouseId: fixture.warehouseId,
          receiptDate: P_JAN,
          poLessReason: null,
          note: null,
          noteAr: null,
          actorId: P_ACTOR,
          lines: [
            {
              poLineId: orderLines[0]!.id,
              itemId: fixture.items.wac,
              qty: "3",
              unitCost: "10.000000",
              accountId: null,
              batchNo: null,
              batchExpiry: null,
              serialIds: null,
              note: null,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "GRN_EXCEEDS_PO_LINE" });

    // Invoicing 100 against a 98 receipt → quantity exception (2-unit gap).
    const invoice = await withTenant(TENANT_P, () =>
      supplierInvoices.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        invoiceNo: `SUP-QTY-${Date.now()}`,
        invoiceDate: P_JAN,
        dueDate: "2026-02-14",
        currencyCode: "SAR",
        exchangeRate: null,
        poId: order.id,
        note: null,
        noteAr: null,
        actorId: P_ACCOUNTANT,
        lines: [
          {
            grnLineId: grnLines[0]!.id,
            itemId: fixture.items.wac,
            accountId: null,
            description: null,
            descriptionAr: null,
            qty: "100",
            unitPrice: "10.000000",
            taxCodeId: null,
            vatRecoverable: null,
            note: null,
          },
        ],
      }),
    );
    const match = await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({ id: invoice.id, actorId: P_BUYER }),
    );
    expect(match.lines[0]!.outcome).toBe("QTY_EXCEPTION");
    expect(match.lines[0]!.qtyVariancePct).toBe("2.0408");
    // Disposition: GRN amendment promised for the missing 2 units.
    const disposed = await withTenant(TENANT_P, () =>
      supplierInvoices.recordMatch({
        id: invoice.id,
        actorId: P_BUYER,
        dispositions: [{ invoiceLineNo: 1, type: "GRN_AMENDMENT", reason: "2 units in transit — amendment receipt follows" }],
      }),
    );
    expect(disposed.summary.outcome).toBe("DISPOSITIONED");
  });

  it("match-before-approval: posting without a recorded outcome is rejected (the service-level guard)", async () => {
    const { invoice } = await chain({ qty: "5", unitPrice: "10.000000", invoiceQty: "5", invoicePrice: "10.000000" });
    // No recordMatch call: approve refuses (BR-009 — no path bypasses it).
    await expect(
      withTenant(TENANT_P, () => supplierInvoices.approve(invoice.id, P_ACCOUNTANT)),
    ).rejects.toMatchObject({ code: "MATCH_OUTCOME_MISSING" });
    await withTenant(TENANT_P, () => supplierInvoices.cancel(invoice.id, "match-guard fixture", P_ACCOUNTANT));
  });
});

describe("BR-011 — duplicate supplier invoices", () => {
  it("(supplier, number, amount) triple → blocked (default)", async () => {
    const base = {
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
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
          description: "dup check",
          descriptionAr: null,
          qty: "1",
          unitPrice: "77.000000",
          taxCodeId: null,
          vatRecoverable: null,
          note: null,
        },
      ],
    } as const;
    const first = await withTenant(TENANT_P, () =>
      supplierInvoices.create({ ...base, invoiceNo: "SUP-DUP-001" }),
    );
    expect(first.duplicateWarning).toBeNull();
    await expect(
      withTenant(TENANT_P, () => supplierInvoices.create({ ...base, invoiceNo: "SUP-DUP-001" })),
    ).rejects.toMatchObject({ code: "DUPLICATE_SUPPLIER_INVOICE" });
  });

  it("(supplier, number) different amount → warns on the draft", async () => {
    const invoice = await withTenant(TENANT_P, () =>
      supplierInvoices.create({
        branchId: fixture.branchId,
        supplierId: fixture.supplierId,
        invoiceNo: "SUP-DUP-001",
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
            description: "same number, different amount",
            descriptionAr: null,
            qty: "1",
            unitPrice: "99.000000",
            taxCodeId: null,
            vatRecoverable: null,
            note: null,
          },
        ],
      }),
    );
    expect(invoice.duplicateWarning).toMatchObject({ kind: "number" });
    expect(invoice.duplicateWarning!.existingAmount).toBe("77.0000");
  });
});
