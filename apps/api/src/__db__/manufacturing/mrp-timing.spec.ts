import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import {
  M_ACTOR,
  TENANT_M,
  mrpEngine,
  mrpSuggestions,
  mpsSrv,
  purchaseOrdersSvc,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";
import * as planning from "../../modules/manufacturing/infrastructure/planning.store";

/**
 * PHASE-043 audit item 7 — the planning timing and quantity laws.
 *
 * Three defects (each confirmed by code reading, then practically —
 * the timing spec runs pre-fix with every test failing):
 *
 * 1. THE HORIZON CLAMP: bucketIndexCovering clamps beyond-horizon dates
 *    into the LAST bucket — an open PO arriving after the horizon
 *    suppressed an in-horizon net requirement (the buyer never ordered:
 *    a stockout), and an MPS demand beyond the horizon generated
 *    in-horizon demand (misleading, too early). The boundary is now
 *    explicit: beyond-horizon signals are OUTSIDE the plan; undated
 *    SUPPLY never counts (the no-date-no-promise law — conservative
 *    netting never under-orders); undated DEMAND stays in the past-due
 *    fold (conservative the other way).
 *
 * 2. THE SURPLUS REUSE: every order of an item re-drew the SAME largest
 *    cross-warehouse surplus (a fountain, not a pool — double-spending
 *    the source stock: two orders of 10 on a surplus of 12 transferred
 *    20). The draw is now FINITE per source warehouse and an order
 *    SPLITS across multiple source warehouses when the largest surplus
 *    cannot cover it alone.
 *
 * 3. THE MIN(due_date) AGGREGATION: the in-flight netting folded the
 *    accepted-but-not-yet-open orders as SUM(qty) at MIN(due_date) —
 *    5 at day 10 + 5 at day 15 appeared as 10 available at day 10, so
 *    a day-10 demand of 10 looked covered and the engine under-ordered
 *    (a stockout at day 10). Each converted suggestion now lands at ITS
 *    own due date.
 *
 * All dates fixed against the explicit asOf (2026-03-01) — deterministic.
 */

const spec: { fixture?: MfgFixture; hz?: string; tr?: string; if?: string } = {};

async function ensureItem(sku: string, name: string): Promise<string> {
  const found = await itemsStore.findItemBySku(sku);
  if (found !== undefined) return found.id;
  const uoms = await itemsStore.listUoms();
  const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
  const created = await itemsStore.insertItem({
    sku,
    name,
    nameAr: null,
    kind: "STOCK",
    uomId: pcs.id,
    categoryId: null,
    taxCodeId: null,
    costingMethod: "WAC",
    trackBatch: true,
    trackSerial: false,
    trackImei: false,
    hasExpiry: true,
    shelfLifeDays: 365,
    reorderLevel: null,
    reorderQty: null,
    basePrice: null,
  });
  return created.id;
}

async function setPolicy(itemId: string): Promise<void> {
  await itemsStore.updateItemPlanningPolicy(itemId, {
    leadTimeDays: 0,
    safetyStockPolicy: "MANUAL",
    safetyStockQty: null,
    ssServiceLevelPct: null,
    ssLookbackDays: null,
    lotSizingRule: "LOT_FOR_LOT",
    fixedOrderQty: null,
    orderMultiple: null,
    periodSupplyBuckets: null,
    frozenFenceDays: 0,
    slushyFenceDays: 30,
  });
}

/** An MPS entry (the wall-clock fence rides the permission + reason —
 * the goldens' honest seeding path). */
async function mps(itemId: string, bucketStart: string, qty: string): Promise<void> {
  await mpsSrv.upsert({
    warehouseId: spec.fixture!.warehouseFg,
    itemId,
    bucketStart,
    qty,
    uomId: (await itemsStore.findItemById(itemId))!.uomId,
    status: "PLANNED",
    reason: "Timing spec fixture (043-audit item 7)",
    frozenEditPermission: true,
    actorId: M_ACTOR,
  });
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.hz = await ensureItem("M-TIM-HZ", "Timing — horizon boundary");
    spec.tr = await ensureItem("M-TIM-TR", "Timing — transfer surplus");
    spec.if = await ensureItem("M-TIM-IF", "Timing — in-flight netting");
    for (const id of [spec.hz!, spec.tr!, spec.if!]) await setPolicy(id);
  });
});

describe("PHASE-043 audit item 7 — the planning timing and quantity laws", () => {
  it("the horizon boundary: a beyond-horizon PO never suppresses an in-horizon net; a beyond-horizon MPS never generates in-horizon demand", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // In-horizon demand: 10 @ 2026-03-05 (a 14-day horizon from
      // 03-01 covers through 03-14).
      await mps(spec.hz!, "2026-03-05", "10");
      // A covering PO of 50 arriving BEYOND the horizon (03-30).
      const po = await purchaseOrdersSvc.create({
        branchId: f.branchId,
        supplierId: f.supplierId,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-30",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "Timing — the beyond-horizon PO",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ itemId: spec.hz!, qty: "50", unitPrice: null, taxCodeId: null, note: null }],
      });
      await purchaseOrdersSvc.submit(po.id, M_ACTOR);
      // A beyond-horizon MPS demand (03-25 — 25 buckets out, the horizon
      // is 14): must NOT generate an in-horizon suggestion.
      await mps(spec.hz!, "2026-03-25", "7");

      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 14,
        runMode: "NET_CHANGE",
        scopeItemIds: [spec.hz!],
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");
      const live = result.suggestions.filter((row) => row.status === "SUGGESTED");
      // Exactly ONE order: the 10 @ 03-05 — the beyond-horizon PO did
      // NOT suppress it (pre-fix: the PO clamped into the last bucket,
      // the net looked covered, and NOTHING was suggested — a stockout).
      expect(live).toHaveLength(1);
      expect(live[0]!.suggestionType).toBe("PURCHASE_ORDER");
      expect(Number(live[0]!.qty)).toBe(10);
      expect(live[0]!.dueDate).toBe("2026-03-05");
      // The beyond-horizon MPS generated NO demand line inside the run
      // (pre-fix: it clamped into the last bucket — misleading demand).
      const demandLines = (await planning.listMrpDemandLines({ runId: result.run.id })).filter(
        (row) => row.itemId === spec.hz!,
      );
      expect(demandLines.map((row) => [row.demandKind, row.qty])).toEqual([["MPS", "10.000000"]]);
      // The beyond-horizon PO is NOT a supply line of this run.
      const supplyLines = (await planning.listMrpSupplyLines({ runId: result.run.id })).filter(
        (row) => row.itemId === spec.hz!,
      );
      expect(supplyLines.filter((row) => row.supplyKind === "OPEN_PO")).toHaveLength(0);
    });
  });

  it("the FINITE surplus draw: two orders on a 12-unit surplus transfer 12 total (split across the orders), the remainder is bought — never double-spent", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // 12 units of surplus at the RAW warehouse (the other warehouse).
      await stock.manualReceipt({
        itemId: spec.tr!,
        warehouseId: f.warehouseRaw,
        qty: "12",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-03-01",
        batchNo: `M-TIM-TR-SRC-${Date.now() % 100000}`,
        batchExpiry: "2027-01-01",
        actorId: M_ACTOR,
      });
      // Two in-horizon demands: 10 @ 03-05 and 10 @ 03-10.
      await mps(spec.tr!, "2026-03-05", "10");
      await mps(spec.tr!, "2026-03-10", "10");

      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 14,
        runMode: "NET_CHANGE",
        scopeItemIds: [spec.tr!],
        allowTransfers: true,
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");
      const live = result.suggestions.filter((row) => row.status === "SUGGESTED");
      const transfers = live.filter((row) => row.suggestionType === "TRANSFER");
      const buys = live.filter((row) => row.suggestionType === "PURCHASE_ORDER");
      // The transfers draw EXACTLY the 12-unit surplus (10 for the first
      // order, 2 for the second — pre-fix BOTH orders drew 10 each: 20
      // transferred off a 12-unit surplus).
      expect(transfers.map((row) => Number(row.qty)).sort((a, b) => b - a)).toEqual([10, 2]);
      expect(
        transfers.reduce((sum, row) => sum + Number(row.qty), 0),
      ).toBe(12);
      // The second order's remainder (8) is bought.
      expect(buys).toHaveLength(1);
      expect(Number(buys[0]!.qty)).toBe(8);
      expect(buys[0]!.dueDate).toBe("2026-03-10");
    });
  });

  it("the in-flight netting lands EACH accepted order at ITS OWN due date (no MIN(due_date) aggregation — the later qty is never early)", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // Two accepted PRODUCTION_ORDER suggestions (their DRAFT MOs are
      // the in-flight supply): 5 due 03-05 and 5 due 03-15.
      const run1 = await planning.insertMrpRun({
        runMode: "NET_CHANGE",
        bucketSize: "DAY",
        horizonBuckets: 30,
        warehouseId: f.warehouseFg,
        asOfDate: "2026-03-01",
        scopeItemIds: [spec.if!],
        params: {},
        actorId: M_ACTOR,
      });
      await planning.patchMrpRun({ id: run1.id, status: "COMPLETED" });
      const [first, second] = await planning.insertMrpSuggestions([
        {
          runId: run1.id,
          itemId: spec.if!,
          warehouseId: f.warehouseFg,
          fromWarehouseId: null,
          suggestionType: "PRODUCTION_ORDER",
          qty: "5",
          uomId: null,
          dueDate: "2026-03-05",
          releaseDate: "2026-03-05",
          frozenFence: false,
          substitutedItemId: null,
          bomId: null,
          netting: {},
          actorId: M_ACTOR,
        },
        {
          runId: run1.id,
          itemId: spec.if!,
          warehouseId: f.warehouseFg,
          fromWarehouseId: null,
          suggestionType: "PRODUCTION_ORDER",
          qty: "5",
          uomId: null,
          dueDate: "2026-03-15",
          releaseDate: "2026-03-15",
          frozenFence: false,
          substitutedItemId: null,
          bomId: null,
          netting: {},
          actorId: M_ACTOR,
        },
      ]);
      const acceptedFirst = await mrpSuggestions.accept(first!.id, M_ACTOR);
      expect(acceptedFirst.replay).toBe(false);
      const acceptedSecond = await mrpSuggestions.accept(second!.id, M_ACTOR);
      expect(acceptedSecond.replay).toBe(false);

      // The demand: 10 @ 03-10. The in-flight supply: 5 lands 03-05, the
      // other 5 lands 03-15 — only 5 covers the 03-10 demand.
      await mps(spec.if!, "2026-03-10", "10");

      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 30,
        runMode: "NET_CHANGE",
        scopeItemIds: [spec.if!],
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");
      // The in-flight legs land at their OWN dates (the evidence).
      const supplyLines = (await planning.listMrpSupplyLines({ runId: result.run.id })).filter(
        (row) => row.itemId === spec.if! && row.supplyKind === "SUGGESTED_RECEIPT",
      );
      expect(supplyLines.map((row) => [row.qty, row.bucketStart])).toEqual([
        ["5.000000", "2026-03-05"],
        ["5.000000", "2026-03-15"],
      ]);
      // The net at 03-10: 10 demanded − 5 landed = 5 to buy (pre-fix: the
      // MIN fold showed 10 available at 03-05 — the demand looked covered
      // and NOTHING was suggested: a stockout at 03-10).
      const live = result.suggestions.filter((row) => row.status === "SUGGESTED");
      expect(live).toHaveLength(1);
      expect(live[0]!.suggestionType).toBe("PURCHASE_ORDER");
      expect(Number(live[0]!.qty)).toBe(5);
      expect(live[0]!.dueDate).toBe("2026-03-10");
    });
  });
});
