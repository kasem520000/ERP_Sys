import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as sStore from "../../modules/sales/infrastructure/sales.store";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { CompositeService, explodeForSale } from "../../modules/items/application/composite-service";
import { CompositeNotDefinedError } from "../../modules/items/domain/items-errors";
import {
  S_ACTOR,
  S_FEB,
  S_SALES,
  TENANT_S,
  salesInvoices,
  setupSalesFixture,
  type SalesFixture,
} from "./fixtures";

/**
 * PHASE-015 T9 golden posting — `items.composite_products`
 * (`combo_explosion_at_posting`, the restaurant manifest policy; the
 * FEATURE_CATALOG row: "Bundles and kits exploded into components at
 * issue"): 1 combo = 2×A + 3×B; selling 2 combos issues 4×A + 6×B at
 * their own WAC (COGS = Σ component issues through the normal inventory
 * issue path), the COMPOSITE line carries revenue only, and NO stock move
 * ever exists for the composite SKU. Also proves the fail-closed contract:
 * a composite with no definition refuses to post (typed error, zero
 * residue — INV-018's plan-then-write).
 */

let fixture: SalesFixture;
let componentA: string;
let componentB: string;
let combo: string;
let undefinedCombo: string;

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const stock = new StockService(audit, posting);
const composites = new CompositeService(audit);

beforeAll(async () => {
  fixture = await setupSalesFixture();
  await withTenant(TENANT_S, async () => {
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, kind: "STOCK" | "COMPOSITE") => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertItem({
        sku,
        name: `Composite fixture ${sku}`,
        nameAr: null,
        kind,
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
        basePrice: null,
      });
      return created.id;
    };
    componentA = await ensureItem("S-COMP-A", "STOCK");
    componentB = await ensureItem("S-COMP-B", "STOCK");
    combo = await ensureItem("S-COMBO", "COMPOSITE");
    undefinedCombo = await ensureItem("S-COMBO-UNDEF", "COMPOSITE");

    // 1 combo = 2×A + 3×B (the definition under test).
    await composites.setComponents(S_ACTOR, combo, [
      { componentItemId: componentA, qty: "2" },
      { componentItemId: componentB, qty: "3" },
    ]);

    // Known-cost substrate: A ×10 @ 30.00 · B ×20 @ 5.00 (WAC pinned) —
    // reason OTHER against the opening-equity account (the G-16 leg
    // shape; INVENTORY_APPRECIATION is not mapped in this tenant).
    await stock.manualReceipt({
      itemId: componentA,
      warehouseId: fixture.warehouseId,
      qty: "10",
      unitCost: "30.000000",
      reason: "OTHER",
      counterAccountId: fixture.gl.openingEquity,
      valueDate: S_FEB,
      note: "composite golden substrate A",
      actorId: S_ACTOR,
    });
    await stock.manualReceipt({
      itemId: componentB,
      warehouseId: fixture.warehouseId,
      qty: "20",
      unitCost: "5.000000",
      reason: "OTHER",
      counterAccountId: fixture.gl.openingEquity,
      valueDate: S_FEB,
      note: "composite golden substrate B",
      actorId: S_ACTOR,
    });
  });
});

describe("composite explosion at sale posting (PHASE-015 T9 golden)", () => {
  it("sells 2 combos: components issue at their own WAC, the composite line carries revenue, the combo SKU never moves", async () => {
    const created = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: S_FEB,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: fixture.warehouseId, // flow B: with-goods → explosion
        cashAccountId: null,
        note: "composite golden",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: combo,
            accountId: null,
            deliveryLineId: null,
            description: "combo meal",
            descriptionAr: null,
            qty: "2",
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
    expect(created.totalNet).toBe("200.0000");
    expect(created.totalTax).toBe("0.0000");

    await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_SALES));
    await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));
    const result = await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));
    expect(result.idempotentReplay).toBe(false);

    // Component stock moves: exactly 4×A @ 30 (120.0000) + 6×B @ 5
    // (30.0000) — and NO move for the composite SKU.
    const moves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ sourceType: "sales_invoice", sourceId: created.id, limit: 10 }),
    );
    expect(moves.length).toBe(2);
    const moveA = moves.find((m) => m.itemId === componentA)!;
    const moveB = moves.find((m) => m.itemId === componentB)!;
    expect(moveA.direction).toBe("OUT");
    expect(moveA.qty).toBe("4.000000");
    expect(moveA.unitCost).toBe("30.000000");
    expect(moveA.valueAmount).toBe("120.0000");
    expect(moveB.qty).toBe("6.000000");
    expect(moveB.unitCost).toBe("5.000000");
    expect(moveB.valueAmount).toBe("30.0000");
    expect(moves.some((m) => m.itemId === combo)).toBe(false);
    // The combo SKU has NO stock ledger presence at all (any source).
    const comboMoves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ itemId: combo, limit: 50 }),
    );
    expect(comboMoves.length).toBe(0);

    // COGS journal (G-03 shape): DR COGS 150.0000 (Σ component issues) ·
    // CR INVENTORY 150.0000.
    const cogsLines = await withTenant(TENANT_S, () => journal.listLines(result.cogsJournalEntryId!));
    expect(cogsLines.map((l) => ({ accountId: l.accountId, direction: l.direction, amount: l.amount }))).toEqual([
      { accountId: fixture.gl.cogs, direction: "DEBIT", amount: "150.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "150.0000" },
    ]);

    // AR journal (G-01 shape, NS tax): DR AR 200.0000 · CR revenue
    // 200.0000 — revenue rides the COMPOSITE line.
    const arLines = await withTenant(TENANT_S, () => journal.listLines(result.journalEntryId!));
    expect(arLines.map((l) => ({ accountId: l.accountId, direction: l.direction, amount: l.amount }))).toEqual([
      { accountId: fixture.gl.arControl, direction: "DEBIT", amount: "200.0000" },
      { accountId: fixture.gl.salesRevenue, direction: "CREDIT", amount: "200.0000" },
    ]);

    // On-hand: A 10−4 = 6 (WAC unchanged 30) · B 20−6 = 14 (WAC 5).
    const stockA = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(componentA, fixture.warehouseId),
    );
    const stockB = await withTenant(TENANT_S, () =>
      inventoryStore.findItemStock(componentB, fixture.warehouseId),
    );
    expect(stockA!.qty).toBe("6.000000");
    expect(stockA!.avgCost).toBe("30.000000");
    expect(stockB!.qty).toBe("14.000000");
    expect(stockB!.avgCost).toBe("5.000000");

    // W-3 provenance on the composite line: issueUnitCost = Σ component
    // cost / combo qty (150 / 2 = 75), issueValue = 150.0000.
    const lines = await withTenant(TENANT_S, () => sStore.listSalesInvoiceLines(created.id));
    expect(lines.length).toBe(1);
    expect(lines[0]!.issueUnitCost).toBe("75.000000");
    expect(lines[0]!.issueValue).toBe("150.0000");

    // INV-013 replay: re-post returns the stored result.
    const replay = await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));
    expect(replay.idempotentReplay).toBe(true);
  });

  it("fails closed on a composite with NO definition (typed error, zero residue)", async () => {
    const created = await withTenant(TENANT_S, () =>
      salesInvoices.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        kind: "CREDIT",
        invoiceDate: S_FEB,
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: fixture.warehouseId,
        cashAccountId: null,
        note: "undefined composite",
        noteAr: null,
        actorId: S_SALES,
        lines: [
          {
            itemId: undefinedCombo,
            accountId: null,
            deliveryLineId: null,
            description: null,
            descriptionAr: null,
            qty: "1",
            unitPrice: "50.000000",
            discountAmount: null,
            taxCodeId: fixture.taxCodeIds.notSubject,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_SALES));
    await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));

    await expect(withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR))).rejects.toThrow(
      CompositeNotDefinedError,
    );
    // Zero residue (INV-018): no moves, no journals for the refused post.
    const moves = await withTenant(TENANT_S, () =>
      inventoryStore.listStockMoves({ sourceType: "sales_invoice", sourceId: created.id, limit: 10 }),
    );
    expect(moves.length).toBe(0);
    const invoice = await withTenant(TENANT_S, () => salesInvoices.find(created.id));
    expect(invoice.postedJournalId).toBeNull();
  });

  it("explodeForSale resolves the pure contract: definition × multiplier at 6dp", async () => {
    const demands = await withTenant(TENANT_S, () => explodeForSale(combo, "2"));
    // Ordered by component SKU: S-COMP-A (2×2=4) then S-COMP-B (3×2=6).
    expect(demands).toEqual([
      {
        componentItemId: componentA,
        componentSku: "S-COMP-A",
        qty: "4.000000",
        unitCostHint: null,
      },
      {
        componentItemId: componentB,
        componentSku: "S-COMP-B",
        qty: "6.000000",
        unitCostHint: null,
      },
    ]);
    await expect(withTenant(TENANT_S, () => explodeForSale(undefinedCombo, "1"))).rejects.toThrow(
      CompositeNotDefinedError,
    );
  });

  it("setComponents is an idempotent full replace (definition read back identical)", async () => {
    const again = await withTenant(TENANT_S, () =>
      composites.setComponents(S_ACTOR, combo, [
        { componentItemId: componentA, qty: "2" },
        { componentItemId: componentB, qty: "3" },
      ]),
    );
    const listed = await withTenant(TENANT_S, () => composites.listComponents(combo));
    expect(listed.length).toBe(2);
    expect(again.map((row) => [row.componentItemId, row.qty])).toEqual(
      listed.map((row) => [row.componentItemId, row.qty]),
    );
  });
});
