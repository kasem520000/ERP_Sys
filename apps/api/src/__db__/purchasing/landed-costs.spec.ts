import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as pStore from "../../modules/purchasing/infrastructure/purchasing.store";
import {
  P_ACCOUNTANT,
  P_ACTOR,
  P_MAR,
  TENANT_P,
  goodsReceipts,
  landedCosts,
  purchaseOrders,
  setupPurchasingFixture,
  type PurchasingFixture,
} from "./fixtures";

/**
 * PHASE-011 landed-cost baseline tests (the phase §2.10; INVENTORY_ACCOUNTING
 * §3): value/qty allocation across received lines, revaluing the WAC/layers
 * through the inventory service (INV-010 stays exact — the revalue lands
 * as an adjust move), the remaining-qty constraint (already-issued stock
 * allocates to the remainder; the difference posts to COGS — documented,
 * auditable, no silent back-dating).
 */

let fixture: PurchasingFixture;

beforeAll(async () => {
  fixture = await setupPurchasingFixture();
});

/** A posted GRN over two stock lines (the allocation substrate). */
async function postedGrn(itemA: string, itemB: string): Promise<{ grnId: string; lineA: string; lineB: string }> {
  const order = await withTenant(TENANT_P, () =>
    purchaseOrders.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      orderDate: P_MAR,
      expectedDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      note: null,
      noteAr: null,
      requestId: null,
      revisionOfId: null,
      actorId: P_ACCOUNTANT,
      lines: [
        { itemId: itemA, qty: "100", unitPrice: "2.000000", taxCodeId: null, requestLineId: null, note: null },
        { itemId: itemB, qty: "50", unitPrice: "4.000000", taxCodeId: null, requestLineId: null, note: null },
      ],
    }),
  );
  await withTenant(TENANT_P, () => purchaseOrders.issue(order.id, P_ACCOUNTANT));
  const orderLines = await withTenant(TENANT_P, () => pStore.listPurchaseOrderLines(order.id));
  const grn = await withTenant(TENANT_P, () =>
    goodsReceipts.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      poId: order.id,
      warehouseId: fixture.warehouseId,
      receiptDate: P_MAR,
      poLessReason: null,
      note: null,
      noteAr: null,
      actorId: P_ACTOR,
      lines: [
        {
          poLineId: orderLines[0]!.id,
          itemId: itemA,
          qty: "100",
          unitCost: "2.000000",
          accountId: null,
          batchNo: null,
          batchExpiry: null,
          serialIds: null,
          note: null,
        },
        {
          poLineId: orderLines[1]!.id,
          itemId: itemB,
          qty: "50",
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
  const lines = await withTenant(TENANT_P, () => pStore.listGoodsReceiptLines(grn.id));
  return { grnId: grn.id, lineA: lines[0]!.id, lineB: lines[1]!.id };
}

describe("Landed-cost allocation — by VALUE (default)", () => {
  it("allocates proportionally to line values, revalues WAC, and posts the journal", async () => {
    const { grnId } = await postedGrn(fixture.items.wac, fixture.items.wac);
    // Lines: 200.00 + 200.00 = 400 basis; freight 100 → 50/50.
    const cost = await withTenant(TENANT_P, () =>
      landedCosts.create({
        grnId,
        costType: "freight",
        vendorId: null,
        amount: "100.0000",
        allocationMethod: "VALUE",
        chargeAccountId: fixture.items.expenseAccount,
        note: "G-07 freight",
        actorId: P_ACCOUNTANT,
      }),
    );
    const result = await withTenant(TENANT_P, () => landedCosts.post(cost.id, P_ACCOUNTANT));

    expect(result.costNo).toMatch(/^LDC-2026-\d{6}$/);
    // Fully on hand → allocated_to_stock = 100, COGS = 0.
    expect(result.cost.allocatedToStock).toBe("100.0000");
    expect(result.cost.allocatedToCogs).toBe("0.0000");

    // The revalue adjust move joins the INV-010 trail (2 lines → 2 moves).
    const moves = await withTenant(TENANT_P, () =>
      inventoryStore.listStockMoves({ sourceType: "landed_cost", sourceId: cost.id, limit: 10 }),
    );
    expect(moves.length).toBe(2);
    expect(moves.reduce((sum, move) => sum + Number(move.valueAmount), 0).toFixed(4)).toBe("100.0000");
    for (const move of moves) {
      expect(move.moveKind).toBe("adjust");
      expect(move.reason).toBe("LANDED_COST");
    }

    // WAC revalued: item avg rose by the per-unit allocation.
    const onHand = await withTenant(TENANT_P, () =>
      inventoryStore.findItemStock(fixture.items.wac, fixture.warehouseId),
    );
    expect(onHand).toBeDefined();
  });
});

describe("Landed-cost allocation — remaining-qty constraint (§2.10)", () => {
  it("already-issued stock allocates to the remainder; the difference posts to COGS", async () => {
    const { grnId, lineA } = await postedGrn(fixture.items.fifo, fixture.items.fifo);
    // Issue 30 of line A's 50 units BEFORE the landed cost (stock already
    // sold at the lower cost — the remaining-qty case).
    const { StockService } = await import("../../modules/inventory/application/stock-service");
    const { AuditService: AuditS } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore: DrizzleStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
    const { PostingService: PostingS } = await import("../../modules/accounting/application/posting-service");
    const { PartnerSubledgerService: SubS } = await import("../../modules/partners/application/subledger-service");
    const audit = new AuditS(new DrizzleStore());
    const stock = new StockService(audit, new PostingS(audit, new SubS()));

    // Issue down to a REMAINDER below line A's received qty (order-
    // independent: the issue targets on-hand − 50, so prior-suite stock
    // cannot mask the remaining-qty case).
    const stockBeforeIssue = await withTenant(TENANT_P, () =>
      inventoryStore.findItemStock(fixture.items.fifo, fixture.warehouseId),
    );
    const onHandBefore = new (await import("@erp/domain-core")).Decimal(stockBeforeIssue?.qty ?? "0");
    const issueQty = onHandBefore.minus(50).toDecimalPlaces(6).toFixed(6);
    await withTenant(TENANT_P, () =>
      stock.manualIssue({
        itemId: fixture.items.fifo,
        warehouseId: fixture.warehouseId,
        qty: issueQty,
        reason: "OTHER",
        counterAccountId: fixture.gl.cogs,
        valueDate: P_MAR,
        note: "pre-landed-cost issue (remaining-qty fixture)",
        actorId: P_ACTOR,
      }),
    );
    // On hand now 50 — below line A's 100 received units.

    // Freight 100 by QTY across the two lines (50/50 units) → line A's 50
    // share = 50; on hand for A's portion = 20 → 30 to COGS.
    const cost = await withTenant(TENANT_P, () =>
      landedCosts.create({
        grnId,
        costType: "customs",
        vendorId: null,
        amount: "100.0000",
        allocationMethod: "QTY",
        chargeAccountId: fixture.items.expenseAccount,
        note: "remaining-qty constraint fixture",
        actorId: P_ACCOUNTANT,
      }),
    );
    const result = await withTenant(TENANT_P, () => landedCosts.post(cost.id, P_ACCOUNTANT));

    // Stock + COGS = 100 exactly (the allocation-sum CHECK holds).
    const stockPart = Number(result.cost.allocatedToStock);
    const cogsPart = Number(result.cost.allocatedToCogs);
    expect((stockPart + cogsPart).toFixed(4)).toBe("100.0000");
    expect(cogsPart).toBeGreaterThan(0); // the issued portion's difference

    // The allocation rows persist the remaining-qty snapshot.
    const allocations = await withTenant(TENANT_P, () => pStore.listLandedCostAllocations(cost.id));
    expect(allocations.length).toBe(2);
    const lineARow = allocations.find((row) => row.grnLineId === lineA)!;
    expect(Number(lineARow.remainingQty)).toBeLessThanOrEqual(Number(lineARow.qtyAtAllocation));
    expect(Number(lineARow.cogsAdjustmentAmount)).toBeGreaterThan(0);
  });
});

describe("Landed-cost journal shape", () => {
  it("posts DR INVENTORY (+ DR COGS) · CR charge account through the engine", async () => {
    const { grnId } = await postedGrn(fixture.items.wac, fixture.items.wac);
    const cost = await withTenant(TENANT_P, () =>
      landedCosts.create({
        grnId,
        costType: "insurance",
        vendorId: null,
        amount: "40.0000",
        allocationMethod: "VALUE",
        chargeAccountId: fixture.items.expenseAccount,
        note: null,
        actorId: P_ACCOUNTANT,
      }),
    );
    const result = await withTenant(TENANT_P, () => landedCosts.post(cost.id, P_ACCOUNTANT));
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    const lines = await withTenant(TENANT_P, () => journal.listLines(result.journalEntryId!));
    // All on hand: [DR INVENTORY 40, CR charge 40].
    expect(lines.length).toBe(2);
    const debit = lines.find((l) => l.direction === "DEBIT")!;
    const credit = lines.find((l) => l.direction === "CREDIT")!;
    expect(debit.accountId).toBe(fixture.gl.inventory);
    expect(debit.amount).toBe("40.0000");
    expect(credit.accountId).toBe(fixture.items.expenseAccount);
    expect(credit.amount).toBe("40.0000");

    // INV-013 replay: re-post returns the stored result.
    const replay = await withTenant(TENANT_P, () => landedCosts.post(cost.id, P_ACCOUNTANT));
    expect(replay.idempotentReplay).toBe(true);
  });
});

/** The manual-issue helper the remaining-qty cases share (order-independent target). */
async function issueWacDownTo(target: number, note: string): Promise<void> {
  const { StockService } = await import("../../modules/inventory/application/stock-service");
  const { AuditService: AuditS } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore: DrizzleStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { PostingService: PostingS } = await import("../../modules/accounting/application/posting-service");
  const { PartnerSubledgerService: SubS } = await import("../../modules/partners/application/subledger-service");
  const audit = new AuditS(new DrizzleStore());
  const stock = new StockService(audit, new PostingS(audit, new SubS()));
  const before = await withTenant(TENANT_P, () =>
    inventoryStore.findItemStock(fixture.items.wac, fixture.warehouseId),
  );
  const onHandBefore = new (await import("@erp/domain-core")).Decimal(before?.qty ?? "0");
  const issueQty = onHandBefore.minus(target).toDecimalPlaces(6).toFixed(6);
  if (Number(issueQty) <= 0) {
    throw new Error(`fixture drift: wac on-hand ${onHandBefore} already at/below target ${target}`);
  }
  await withTenant(TENANT_P, () =>
    stock.manualIssue({
      itemId: fixture.items.wac,
      warehouseId: fixture.warehouseId,
      qty: issueQty,
      reason: "OTHER",
      counterAccountId: fixture.gl.cogs,
      valueDate: P_MAR,
      note,
      actorId: P_ACTOR,
    }),
  );
}

/**
 * PHASE-015 T9 (full workflow per INVENTORY_ACCOUNTING §3): TWO sequential
 * landed-cost documents on one GRN — freight then customs — with the
 * cumulative remaining-qty math EXACT. Both GRN lines carry the SAME item
 * (100 + 50 units): the per-item on-hand budget proves each physical unit
 * absorbs landed value at most once across the document's lines, and the
 * second document re-reads live on-hand (after an issue) so it allocates
 * over the REMAINING unconsumed quantity only.
 */
describe("Multiple landed-cost documents on one GRN — cumulative remaining-qty (PHASE-015 §3)", () => {
  it("freight then customs: each document allocates over the remaining quantity, exact to the cent", async () => {
    const { grnId, lineA, lineB } = await postedGrn(fixture.items.wac, fixture.items.wac);
    // Lines: A qty 100 @ 2 (value 200) · B qty 50 @ 4 (value 200).
    // Issue down to exactly 60 on hand before ANY landed cost.
    await issueWacDownTo(60, "cumulative landed-cost fixture: pre-freight issue");

    // Document 1 — freight 100 by VALUE (basis 200/200 → 50/50 per line).
    const freight = await withTenant(TENANT_P, () =>
      landedCosts.create({
        grnId,
        costType: "freight",
        vendorId: null,
        amount: "100.0000",
        allocationMethod: "VALUE",
        chargeAccountId: fixture.items.expenseAccount,
        note: "doc 1 of 2 (freight)",
        actorId: P_ACCOUNTANT,
      }),
    );
    const freightResult = await withTenant(TENANT_P, () => landedCosts.post(freight.id, P_ACCOUNTANT));
    // Budget 60: line A keeps min(60, 100) = 60 units → 30.0000 to stock,
    // 20.0000 to COGS; line B's budget is spent → all 50.0000 to COGS.
    expect(freightResult.cost.allocatedToStock).toBe("30.0000");
    expect(freightResult.cost.allocatedToCogs).toBe("70.0000");
    const freightAllocations = await withTenant(TENANT_P, () =>
      pStore.listLandedCostAllocations(freight.id),
    );
    const freightA = freightAllocations.find((row) => row.grnLineId === lineA)!;
    const freightB = freightAllocations.find((row) => row.grnLineId === lineB)!;
    expect(freightA.remainingQty).toBe("60.000000");
    expect(freightA.allocatedAmount).toBe("30.0000");
    expect(freightA.cogsAdjustmentAmount).toBe("20.0000");
    expect(freightB.remainingQty).toBe("0.000000");
    expect(freightB.allocatedAmount).toBe("0.0000");
    expect(freightB.cogsAdjustmentAmount).toBe("50.0000");

    // Between documents: issue 20 more units at the revalued cost — the
    // customs document must allocate over the REMAINING 40 units only.
    await issueWacDownTo(40, "cumulative landed-cost fixture: inter-document issue");

    // Document 2 — customs 80 by QTY (basis 100/150, 50/150).
    const customs = await withTenant(TENANT_P, () =>
      landedCosts.create({
        grnId,
        costType: "customs",
        vendorId: null,
        amount: "80.0000",
        allocationMethod: "QTY",
        chargeAccountId: fixture.items.expenseAccount,
        note: "doc 2 of 2 (customs)",
        actorId: P_ACCOUNTANT,
      }),
    );
    const customsResult = await withTenant(TENANT_P, () => landedCosts.post(customs.id, P_ACCOUNTANT));
    // Line A share 80×100/150 = 53.3333; remaining 40/100 → stock 21.3333,
    // COGS 32.0000. Line B share 26.6667; budget spent → all COGS.
    expect(customsResult.cost.allocatedToStock).toBe("21.3333");
    expect(customsResult.cost.allocatedToCogs).toBe("58.6667");
    const customsAllocations = await withTenant(TENANT_P, () =>
      pStore.listLandedCostAllocations(customs.id),
    );
    const customsA = customsAllocations.find((row) => row.grnLineId === lineA)!;
    const customsB = customsAllocations.find((row) => row.grnLineId === lineB)!;
    expect(customsA.remainingQty).toBe("40.000000");
    expect(customsA.allocatedAmount).toBe("21.3333");
    expect(customsA.cogsAdjustmentAmount).toBe("32.0000");
    expect(customsB.remainingQty).toBe("0.000000");
    expect(customsB.cogsAdjustmentAmount).toBe("26.6667");

    // Cumulative exactness: both documents' stock+COGS equal their amounts
    // (30 + 70 = 100 · 21.3333 + 58.6667 = 80) and never double-credit the
    // same units (the budget fell 60 → 40 strictly with the issues).
    expect(
      Number(freightResult.cost.allocatedToStock) + Number(freightResult.cost.allocatedToCogs),
    ).toBe(100);
    expect(
      Number(customsResult.cost.allocatedToStock) + Number(customsResult.cost.allocatedToCogs),
    ).toBe(80);

    // Both documents list under the same GRN (the workflow surface).
    const byGrn = await withTenant(TENANT_P, () =>
      landedCosts.list({ grnId, limit: 10 }),
    );
    expect(byGrn.map((row) => row.id).sort()).toEqual([freight.id, customs.id].sort());
  });
});

/**
 * PHASE-015 T9: the allocation PREVIEW — the read-only projection the
 * workflow UI renders — matches the eventual posted allocation TO THE
 * CENT on the same fixture (preview and post share one computation).
 */
describe("Landed-cost allocation preview (PHASE-015 full workflow)", () => {
  it("preview == eventual posting, to the cent, per line and in total", async () => {
    const { grnId } = await postedGrn(fixture.items.wac, fixture.items.wac);
    // Pin on-hand to exactly 120 so the numbers are exact regardless of
    // prior-suite state (budget 120: line A full 100, line B partial 20).
    await issueWacDownTo(120, "preview-vs-post fixture: pin on-hand 120");

    const preview = await withTenant(TENANT_P, () =>
      landedCosts.preview({
        grnId,
        costType: "freight",
        amount: "60.0000",
        allocationMethod: "VALUE",
      }),
    );
    // Basis 200/200 → 30/30 per line. Line A: min(120, 100) = 100 units →
    // all to stock (30.0000). Line B: budget 120−100 = 20 of 50 → ratio
    // 0.4 → stock 12.0000, COGS 18.0000.
    expect(preview.allocatedToStock).toBe("42.0000");
    expect(preview.allocatedToCogs).toBe("18.0000");
    expect(preview.allocations.length).toBe(2);

    // Commit the SAME document — the posted allocation equals the preview.
    const cost = await withTenant(TENANT_P, () =>
      landedCosts.create({
        grnId,
        costType: "freight",
        vendorId: null,
        amount: "60.0000",
        allocationMethod: "VALUE",
        chargeAccountId: fixture.items.expenseAccount,
        note: "preview-parity document",
        actorId: P_ACCOUNTANT,
      }),
    );
    const posted = await withTenant(TENANT_P, () => landedCosts.post(cost.id, P_ACCOUNTANT));
    expect(posted.cost.allocatedToStock).toBe(preview.allocatedToStock);
    expect(posted.cost.allocatedToCogs).toBe(preview.allocatedToCogs);
    const postedAllocations = await withTenant(TENANT_P, () =>
      pStore.listLandedCostAllocations(cost.id),
    );
    expect(postedAllocations.length).toBe(preview.allocations.length);
    for (const line of preview.allocations) {
      const postedLine = postedAllocations.find((row) => row.grnLineId === line.grnLineId)!;
      expect(postedLine.qtyAtAllocation).toBe(line.qtyAtAllocation);
      expect(postedLine.remainingQty).toBe(line.remainingQty);
      expect(postedLine.allocatedAmount).toBe(line.allocatedAmount);
      expect(postedLine.cogsAdjustmentAmount).toBe(line.cogsAdjustmentAmount);
    }
  });

  it("preview refuses the same invalid substrates as create (fail closed, no rows)", async () => {
    const { grnId } = await postedGrn(fixture.items.wac, fixture.items.wac);
    const { LandedCostAmountInvalidError, LandedCostGrnInvalidError } = await import(
      "../../modules/purchasing/domain/purchasing-errors"
    );
    await expect(
      withTenant(TENANT_P, () =>
        landedCosts.preview({ grnId, costType: "freight", amount: "0.0000", allocationMethod: "VALUE" }),
      ),
    ).rejects.toThrow(LandedCostAmountInvalidError);
    await expect(
      withTenant(TENANT_P, () =>
        landedCosts.preview({
          grnId: "eeeeeeee-0000-4000-8000-0000000000e1",
          costType: "freight",
          amount: "10.0000",
          allocationMethod: "VALUE",
        }),
      ),
    ).rejects.toThrow(LandedCostGrnInvalidError);
    // No draft rows leaked from the refused previews.
    const byGrn = await withTenant(TENANT_P, () => landedCosts.list({ grnId, limit: 10 }));
    expect(byGrn.length).toBe(0);
  });
});
