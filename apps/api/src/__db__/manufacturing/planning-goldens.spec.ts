import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as salesStore from "../../modules/sales/infrastructure/sales.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as mfgStore from "../../modules/manufacturing/infrastructure/manufacturing.store";
import {
  BomAllocationInvalidError,
  MpsFrozenFenceEditError,
  MpsFrozenReasonRequiredError,
  MrpDismissReasonRequiredError,
  MtoLinkInvalidError,
  TollingStateError,
} from "../../modules/manufacturing/domain/manufacturing-errors";
import {
  M_ACTOR,
  TENANT_M,
  atpSrv,
  boms,
  borSrv,
  mpsSrv,
  mrpEngine,
  mrpSuggestions,
  orders,
  reservationPolicy,
  setupMfgFixture,
  stock,
  tollingSrv,
  tracking,
  workCenters,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-043 golden suites (T-17): G-47 (the co/by-product joint
 * allocation), G-48 (the contract-manufacturing tolling round trip), and
 * G-49 (the MTO completion at actual cost with the reservation chain) —
 * each with its failure pack — plus the BR-078…080 guards and the
 * db-level INV-030 proofs (the idempotent conversion, the exact netting
 * on a seeded fixture, the coverage netting on re-run).
 *
 * The spec owns its items/BOMs (the orders.spec discipline — never the
 * §8 golden chain rows); the fixture's M-RAW/M-FG stores, seeded material
 * batches, and GL purposes carry the posting legs.
 */

async function journalLinesOf(entryId: string): Promise<
  { accountId: string; direction: string; amount: string }[]
> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction,
    amount: line.amount,
  }));
}

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
    hasExpiry: false,
    shelfLifeDays: null,
    reorderLevel: null,
    reorderQty: null,
    basePrice: null,
  });
  return created.id;
}

interface SpecItems {
  coFg: string;
  coMat: string;
  coOut: string;
  tolFg: string;
  tolMat: string;
  mtoFg: string;
  mtoMat: string;
  mrpFg: string;
  mrpMat: string;
}

const spec: { fixture?: MfgFixture; items?: SpecItems } = {};

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.items = {
      coFg: await ensureItem("M-CO-FG", "Co-product golden FG"),
      coMat: await ensureItem("M-CO-MAT", "Co-product golden material"),
      coOut: await ensureItem("M-CO-OUT", "Co-product golden output"),
      tolFg: await ensureItem("M-TOL-FG", "Tolling golden FG"),
      tolMat: await ensureItem("M-TOL-MAT", "Tolling golden material"),
      mtoFg: await ensureItem("M-MTO-FG", "MTO golden FG"),
      mtoMat: await ensureItem("M-MTO-MAT", "MTO golden material"),
      mrpFg: await ensureItem("M-MRP-FG", "MRP golden FG"),
      mrpMat: await ensureItem("M-MRP-MAT", "MRP golden material"),
    };
  });
});

/** One manual material receipt into M-RAW (the fixture's own seeding path). */
async function seedMaterial(itemId: string, qty: string, unitCost: string, batchNo: string): Promise<void> {
  await stock.manualReceipt({
    itemId,
    warehouseId: spec.fixture!.warehouseRaw,
    qty,
    unitCost,
    reason: "COUNT_GAIN",
    counterAccountId: null,
    valueDate: "2026-03-01",
    batchNo,
    batchExpiry: "2027-01-01",
    actorId: M_ACTOR,
  });
}

// =====================================================================================
// G-47 — the co/by-product joint allocation
// =====================================================================================

describe("G-47 co/by-product completion (joint allocation)", () => {
  it("golden: Σ allocated = actual WIP consumed exactly, per-BOM percentages", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      // Material stock: 20 units @ 10 → the order consumes 20 → WIP 200.
      await seedMaterial(s.coMat, "20", "10.000000", "M-CO-M1");

      // The BOM: main 60% + one CO_PRODUCT output 40% (qty 0.5 per main unit).
      const draft = await boms.create({
        itemId: s.coFg,
        outputUomId: (await itemsStore.findItemById(s.coFg))!.uomId,
        yieldPct: "100.0000",
        mainAllocationPct: "60.0000",
        note: "G-47 golden BOM",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: s.coMat, qtyPerOutput: "2.000000", scrapPct: "0" }],
      });
      await boms.replaceOutputs(
        draft.id,
        [
          {
            itemId: s.coOut,
            outputKind: "CO_PRODUCT",
            allocationPct: "40.0000",
            qtyPerOutput: "0.500000",
            uomId: (await itemsStore.findItemById(s.coOut))!.uomId,
            note: null,
          },
        ],
        M_ACTOR,
      );
      const active = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
      expect(active.mainAllocationPct).toBe("60.0000");

      const order = await orders.create({
        branchId: f.branchId,
        itemId: s.coFg,
        bomId: active.id,
        plannedQty: "10",
        plannedDate: "2026-03-02",
        materialsWarehouseId: f.warehouseRaw,
        fgWarehouseId: f.warehouseFg,
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "G-47 golden order",
        noteAr: null,
        actorId: M_ACTOR,
      });
      await orders.release(order.id, M_ACTOR);
      await orders.start(order.id, M_ACTOR);
      await orders.consume(order.id, {
        lines: [{ itemId: s.coMat, qty: "20" }],
        consumedAt: "2026-03-02",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      });

      const result = await orders.complete(order.id, {
        actualQty: "10",
        completedAt: "2026-03-03",
        actorId: M_ACTOR,
      });
      expect(result.order.status).toBe("COMPLETED");
      // The joint allocation: fgValue 200 = main 120 (60%) + output 80 (40%).
      expect(result.fgValue).toBe("200.0000");
      expect(result.journalEntryId).not.toBeNull();
      // The journal: DR FG-inventory 120 (main) · DR FG-inventory 80 (co)
      // · CR WIP 200 — Σ allocated == the WIP consumed EXACTLY.
      expect(await journalLinesOf(result.journalEntryId!)).toEqual([
        { accountId: f.gl.inventory, direction: "DEBIT", amount: "120.0000" },
        { accountId: f.gl.inventory, direction: "DEBIT", amount: "80.0000" },
        { accountId: f.gl.wip, direction: "CREDIT", amount: "200.0000" },
      ]);
      // Per-order WIP nets to EXACTLY zero at completion.
      expect(await mfgStore.sumOrderWip(order.id)).toBe("0.0000");
      // The co-product landed as its own stock: 5 units of M-CO-OUT at
      // M-FG (0.5 per main unit × 10) at its allocated cost (80/5 = 16).
      const coAvailability = await stock.availability({ itemId: s.coOut, warehouseId: f.warehouseFg });
      expect(coAvailability.onHandQty).toBe("5.000000");
      expect(coAvailability.avgCost).toBe("16.000000");
    });
  });

  it("failure pack: main + Σ outputs ≠ 100 is the typed BOM_ALLOCATION_INVALID at activation", async () => {
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const draft = await boms.create({
        itemId: s.coFg,
        outputUomId: (await itemsStore.findItemById(s.coFg))!.uomId,
        yieldPct: "100.0000",
        mainAllocationPct: "50.0000", // 50 + 40 = 90 ≠ 100
        note: "G-47 failure pack",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: s.coMat, qtyPerOutput: "2.000000", scrapPct: "0" }],
      });
      await boms.replaceOutputs(
        draft.id,
        [
          {
            itemId: s.coOut,
            outputKind: "CO_PRODUCT",
            allocationPct: "40.0000",
            qtyPerOutput: "0.500000",
            uomId: (await itemsStore.findItemById(s.coOut))!.uomId,
            note: null,
          },
        ],
        M_ACTOR,
      );
      const attempt = boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
      await expect(attempt).rejects.toBeInstanceOf(BomAllocationInvalidError);
      // Zero residue: the DRAFT never activated.
      expect((await boms.find(draft.id)).status).toBe("DRAFT");
    });
  });
});

// =====================================================================================
// G-48 — the contract-manufacturing tolling round trip
// =====================================================================================

describe("G-48 tolling round trip (stock-at-processor)", () => {
  it("golden: issue → return → settle with the 1420 ledger balancing to EXACTLY zero", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      // Material: 100 units @ 10 at M-RAW.
      await seedMaterial(s.tolMat, "100", "10.000000", "M-TOL-M1");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const draft = await boms.create({
        itemId: s.tolFg,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: "G-48 tolling BOM",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: s.tolMat, qtyPerOutput: "1.000000", scrapPct: "0" }],
      });
      const active = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });

      // DRAFT order with the planned conversion fee.
      const order = await tollingSrv.create({
        processorPartnerId: f.supplierId,
        itemId: s.tolFg,
        bomId: active.id,
        warehouseId: f.warehouseRaw,
        plannedQty: "100",
        expectedReturnDate: "2026-03-10",
        conversionFee: "200.0000",
        note: "G-48 golden",
        noteAr: null,
        actorId: M_ACTOR,
      });
      expect(order.status).toBe("DRAFT");

      // ISSUE: 100 units of material (value 1000) + the fee PO (the 038
      // path — the tolling FG item rides the fee line).
      const issued = await tollingSrv.issue(order.id, {
        materials: [{ itemId: s.tolMat, qty: "100" }],
        feePo: { supplierId: f.supplierId, serviceItemId: s.tolFg },
        issuedAt: "2026-03-05",
        note: "G-48 issue",
        actorId: M_ACTOR,
      });
      expect(issued.order.status).toBe("ISSUED");
      expect(issued.order.tollingNo).toMatch(/^TLG-\d{4}-\d{5}$/);
      expect(issued.feePoId).not.toBeNull();
      expect(issued.moves).toHaveLength(1);
      expect(issued.moves[0]!.valueAmount).toBe("1000.0000");
      // J1: DR TOLLING_MATERIALS 1000 · CR INVENTORY 1000.
      expect(await journalLinesOf(issued.moves[0]!.journalId!)).toEqual([
        { accountId: f.gl.tollingMaterials, direction: "DEBIT", amount: "1000.0000" },
        { accountId: f.gl.inventory, direction: "CREDIT", amount: "1000.0000" },
      ]);

      // RETURN: 90 finished (materials share 900 + fee accrual 180) + the
      // explicit yield loss of the remaining 10 (100).
      const returned = await tollingSrv.return_(order.id, {
        finished: [{ qty: "90" }],
        returnedMaterials: [],
        yieldLoss: [{ itemId: s.tolMat, qty: "10", value: "100.0000" }],
        returnedAt: "2026-03-08",
        note: "G-48 return",
        actorId: M_ACTOR,
      });
      expect(returned.order.status).toBe("RETURNED");
      // J2 (the RETURN_FINISHED leg's journal — all return legs share it):
      // DR FG 1080 (900 materials + 180 fee) · CR 1420 900 · CR 2136 180
      // + DR 5126 100 · CR 1420 100 (the yield loss legs).
      const returnJournalId = returned.moves.find((m) => m.moveKind === "RETURN_FINISHED")!.journalId!;
      expect(await journalLinesOf(returnJournalId)).toEqual([
        { accountId: f.gl.inventory, direction: "DEBIT", amount: "1080.0000" },
        { accountId: f.gl.tollingMaterials, direction: "CREDIT", amount: "900.0000" },
        { accountId: f.gl.tollingConversionPayable, direction: "CREDIT", amount: "180.0000" },
        { accountId: f.gl.tollingYieldLoss, direction: "DEBIT", amount: "100.0000" },
        { accountId: f.gl.tollingMaterials, direction: "CREDIT", amount: "100.0000" },
      ]);

      // SETTLE: the stock-at-processor ledger balances to EXACTLY zero
      // (Σ issue 1000 = Σ return-finished 900 + Σ yield 100).
      const settled = await tollingSrv.settle(order.id, M_ACTOR);
      expect(settled.status).toBe("SETTLED");
      const ledger = await tollingSrv.get(order.id);
      expect(ledger.atProcessorBalance).toBe("0.0000");
    });
  });

  it("failure pack: settle with a residual is the typed TOLLING_STATE_INVALID naming it", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      await seedMaterial(s.tolMat, "50", "4.000000", "M-TOL-M2");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const draft = await boms.create({
        itemId: s.tolFg,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: "G-48 failure pack",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: s.tolMat, qtyPerOutput: "1.000000", scrapPct: "0" }],
      });
      const active = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
      const order = await tollingSrv.create({
        processorPartnerId: f.supplierId,
        itemId: s.tolFg,
        bomId: active.id,
        warehouseId: f.warehouseRaw,
        plannedQty: "50",
        expectedReturnDate: null,
        conversionFee: null,
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      });
      await tollingSrv.issue(order.id, {
        materials: [{ itemId: s.tolMat, qty: "50" }],
        feePo: null,
        issuedAt: "2026-03-05",
        note: null,
        actorId: M_ACTOR,
      });
      // Return only HALF the finished — 25 of 50 (share 100 of 200).
      await tollingSrv.return_(order.id, {
        finished: [{ qty: "25" }],
        returnedMaterials: [],
        yieldLoss: [],
        returnedAt: "2026-03-08",
        note: null,
        actorId: M_ACTOR,
      });
      // The settle gate: the residual (100) is named, never silently scrapped.
      const attempt = tollingSrv.settle(order.id, M_ACTOR);
      await expect(attempt).rejects.toBeInstanceOf(TollingStateError);
      await expect(attempt).rejects.toMatchObject({
        code: "TOLLING_STATE_INVALID",
        details: { residual: "100.0000" },
      });
      // Zero residue: still RETURNED (the operator posts the explicit
      // yield loss or a returned material to close it).
      expect((await tollingSrv.find(order.id)).status).toBe("RETURNED");
    });
  });
});

// =====================================================================================
// G-49 — the MTO completion at actual cost with the reservation chain
// =====================================================================================

describe("G-49 MTO completion (the reservation chain)", () => {
  it("golden: the linked sales line's FG is hard-reserved at the MO's actual cost", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      // Material: 10 units @ 10.
      await seedMaterial(s.mtoMat, "10", "10.000000", "M-MTO-M1");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const draft = await boms.create({
        itemId: s.mtoFg,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: "G-49 MTO BOM",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: s.mtoMat, qtyPerOutput: "1.000000", scrapPct: "0" }],
      });
      const active = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });

      // The driving sales order + line (the sales store — the sales
      // module's own writer, called inside the ambient tenant UoW).
      const salesOrder = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-15",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "G-49 MTO demand",
        noteAr: null,
        actorId: M_ACTOR,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            itemId: s.mtoFg,
            description: "MTO golden line",
            descriptionAr: null,
            qty: "10",
            unitPrice: "10.000000",
            discountAmount: "0.000000",
            taxCodeId: f.taxCodeIds.notSubject,
            netAmount: "100.0000",
            taxAmount: "0.0000",
            note: null,
          },
        ],
      });
      const salesLine = (await salesStore.listSalesOrderLines(salesOrder.id))[0]!;

      // The MTO production order: create, link, release, run, complete.
      const order = await orders.create({
        branchId: f.branchId,
        itemId: s.mtoFg,
        bomId: active.id,
        plannedQty: "10",
        plannedDate: "2026-03-10",
        materialsWarehouseId: f.warehouseRaw,
        fgWarehouseId: f.warehouseFg,
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "G-49 golden MTO order",
        noteAr: null,
        actorId: M_ACTOR,
      });
      const linked = await orders.linkSalesOrder(order.id, {
        salesOrderLineId: salesLine.id,
        actorId: M_ACTOR,
      });
      expect(linked.salesOrderLineId).toBe(salesLine.id);

      await orders.release(order.id, M_ACTOR);
      await orders.start(order.id, M_ACTOR);
      await orders.consume(order.id, {
        lines: [{ itemId: s.mtoMat, qty: "10" }],
        consumedAt: "2026-03-10",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      });
      // Same-day completion (2026-03-10, the consume date): the WIP-GL green
      // path in wip-recon.spec.ts asserts an ABSOLUTE zero as of 2026-03-10 —
      // a completion dated after that as-of would leave this order's WIP in
      // flight inside the window (the file-order-independence contract there:
      // every in-window order must net WIP to exactly zero).
      const result = await orders.complete(order.id, {
        actualQty: "10",
        completedAt: "2026-03-10",
        actorId: M_ACTOR,
      });
      expect(result.order.status).toBe("COMPLETED");
      // The completion at ACTUAL cost: fgValue = the WIP consumed (100).
      expect(result.fgValue).toBe("100.0000");
      expect(result.batchId).not.toBeNull();

      // THE RESERVATION CHAIN: an ACTIVE PRODUCTION_ORDER reservation for
      // the actual quantity at the FG warehouse, held for THIS order.
      const reservationRows = await (
        await import("../../modules/inventory/infrastructure/inventory.store")
      ).listReservations({ itemId: s.mtoFg, warehouseId: f.warehouseFg, status: "ACTIVE", limit: 10 });
      const chain = reservationRows.find(
        (row) => row.holderType === "PRODUCTION_ORDER" && row.holderId === order.id,
      );
      expect(chain).toBeDefined();
      expect(chain!.qty).toBe("10.000000");

      // The FG batch carries the MO's actual cost (10 @ 10/unit) and the
      // completion routed the output to the linked sales delivery's
      // warehouse (the reservation chain's other end).
      const batch = await tracking.findBatch(result.batchId!);
      expect(batch.batchNo).toBe(result.batchNo);
      expect(result.order.fgWarehouseId).toBe(f.warehouseFg);
    });
  });

  it("failure pack: the MTO link rejects a line of another item (typed MTO_LINK_INVALID)", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const order = await orders.create({
        branchId: f.branchId,
        itemId: s.mtoFg,
        bomId: null,
        plannedQty: "5",
        plannedDate: null,
        materialsWarehouseId: f.warehouseRaw,
        fgWarehouseId: f.warehouseFg,
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "G-49 failure pack",
        noteAr: null,
        actorId: M_ACTOR,
      });
      // A sales line for a DIFFERENT item (flour).
      const salesOrder = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
        totalNet: "10.0000",
        totalTax: "0.0000",
        totalGross: "10.0000",
        lines: [
          {
            itemId: f.items.flour,
            description: null,
            descriptionAr: null,
            qty: "1",
            unitPrice: "10.000000",
            discountAmount: "0.000000",
            taxCodeId: f.taxCodeIds.notSubject,
            netAmount: "10.0000",
            taxAmount: "0.0000",
            note: null,
          },
        ],
      });
      const flourLine = (await salesStore.listSalesOrderLines(salesOrder.id))[0]!;
      const attempt = orders.linkSalesOrder(order.id, {
        salesOrderLineId: flourLine.id,
        actorId: M_ACTOR,
      });
      await expect(attempt).rejects.toBeInstanceOf(MtoLinkInvalidError);
      // Zero residue: the order carries no link.
      expect((await orders.find(order.id)).salesOrderLineId).toBeNull();
    });
  });
});

// =====================================================================================
// BR-078/079/080 guards + the db-level INV-030 proofs
// =====================================================================================

describe("BR-078 MPS frozen-fence guards", () => {
  it("an in-fence edit without the permission is the typed rejection; with it, a reason is still required", async () => {
    const s = spec.items!;
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      // Give the item a 7-day fence through the items writer.
      const itemsModule = await import("../../modules/items/infrastructure/items.store");
      await itemsModule.updateItemPlanningPolicy(s.mrpFg, {
        leadTimeDays: null,
        safetyStockPolicy: "MANUAL",
        safetyStockQty: null,
        ssServiceLevelPct: null,
        ssLookbackDays: null,
        lotSizingRule: "LOT_FOR_LOT",
        fixedOrderQty: null,
        orderMultiple: null,
        periodSupplyBuckets: null,
        frozenFenceDays: 7,
        slushyFenceDays: 30,
      });
      const today = new Date().toISOString().slice(0, 10);
      // No permission → the typed fence rejection.
      await expect(
        mpsSrv.upsert({
          warehouseId: f.warehouseFg,
          itemId: s.mrpFg,
          bucketStart: today,
          qty: "10",
          uomId: pcs.id,
          frozenEditPermission: false,
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(MpsFrozenFenceEditError);
      // The permission WITHOUT a reason → the reason rejection (BR-078's
      // unconditional discipline inside the fence).
      await expect(
        mpsSrv.upsert({
          warehouseId: f.warehouseFg,
          itemId: s.mrpFg,
          bucketStart: today,
          qty: "10",
          uomId: pcs.id,
          frozenEditPermission: true,
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(MpsFrozenReasonRequiredError);
      // The permission AND the reason → the row lands with the reason riding it.
      const entry = await mpsSrv.upsert({
        warehouseId: f.warehouseFg,
        itemId: s.mrpFg,
        bucketStart: today,
        qty: "10",
        uomId: pcs.id,
        reason: "Committed customer order (BR-078 guard)",
        frozenEditPermission: true,
        actorId: M_ACTOR,
      });
      expect(entry.lastEditReason).toBe("Committed customer order (BR-078 guard)");
      // An out-of-fence bucket needs neither.
      const outOfFence = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const free = await mpsSrv.upsert({
        warehouseId: f.warehouseFg,
        itemId: s.mrpFg,
        bucketStart: outOfFence,
        qty: "5",
        uomId: pcs.id,
        frozenEditPermission: false,
        actorId: M_ACTOR,
      });
      expect(free.qty).toBe("5.000000");
    });
  });
});

describe("BR-079 suggestion lifecycle guards", () => {
  it("dismissal without a reason is the typed rejection (the reason is not optional)", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const planning = await import("../../modules/manufacturing/infrastructure/planning.store");
      const run = await planning.insertMrpRun({
        runMode: "NET_CHANGE",
        bucketSize: "DAY",
        horizonBuckets: 7,
        warehouseId: f.warehouseFg,
        asOfDate: "2026-03-01",
        scopeItemIds: [s.mrpMat],
        params: {},
        actorId: M_ACTOR,
      });
      await planning.patchMrpRun({ id: run.id, status: "COMPLETED" });
      const [suggestion] = await planning.insertMrpSuggestions([
        {
          runId: run.id,
          itemId: s.mrpMat,
          warehouseId: f.warehouseFg,
          fromWarehouseId: null,
          suggestionType: "PURCHASE_ORDER",
          qty: "5",
          uomId: null,
          dueDate: "2026-03-10",
          releaseDate: "2026-03-05",
          frozenFence: false,
          substitutedItemId: null,
          bomId: null,
          netting: {},
          actorId: M_ACTOR,
        },
      ]);
      expect(suggestion).toBeDefined();
      await expect(mrpSuggestions.dismiss(suggestion!.id, "   ", M_ACTOR)).rejects.toBeInstanceOf(
        MrpDismissReasonRequiredError,
      );
      const dismissed = await mrpSuggestions.dismiss(suggestion!.id, "Not needed (BR-079 guard)", M_ACTOR);
      expect(dismissed.status).toBe("DISMISSED");
      expect(dismissed.dismissedReason).toBe("Not needed (BR-079 guard)");
    });
  });
});

describe("BR-080 ATP hard exclusions", () => {
  it("the promiseable basis excludes reserved stock (the hard rule)", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      // Seed: 10 units at M-FG via a manual receipt (bin-backed, AVAILABLE).
      await stock.manualReceipt({
        itemId: s.mrpMat,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-03-01",
        batchNo: "M-B080-A",
        batchExpiry: "2027-01-01",
        actorId: M_ACTOR,
      });
      const ok = await atpSrv.check({ itemId: s.mrpMat, warehouseId: f.warehouseFg, qty: "10" });
      expect(ok.verdict).toBe("OK");
      expect(ok.availableNow).toBe("10.000000");

      // RESERVED subtracts: a manual reservation of 6 → promiseable 4.
      const reserved = await reservationPolicy.reserveForHolder({
        itemId: s.mrpMat,
        warehouseId: f.warehouseFg,
        qty: "6",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "BR-080 guard reservation",
        actorId: M_ACTOR,
      });
      expect(reserved.strategy).toBe("FIFO");
      const afterReserve = await atpSrv.check({ itemId: s.mrpMat, warehouseId: f.warehouseFg, qty: "5" });
      expect(afterReserve.verdict).toBe("SHORT");
      expect(afterReserve.availableNow).toBe("4.000000");
    });
  });
});

describe("INV-030 db proofs", () => {
  it("the idempotent conversion — the retry returns the ORIGINAL document", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const planning = await import("../../modules/manufacturing/infrastructure/planning.store");
      const run = await planning.insertMrpRun({
        runMode: "NET_CHANGE",
        bucketSize: "DAY",
        horizonBuckets: 7,
        warehouseId: f.warehouseFg,
        asOfDate: "2026-03-01",
        scopeItemIds: [s.mrpFg],
        params: {},
        actorId: M_ACTOR,
      });
      await planning.patchMrpRun({ id: run.id, status: "COMPLETED" });
      const [suggestion] = await planning.insertMrpSuggestions([
        {
          runId: run.id,
          itemId: s.mrpFg,
          warehouseId: f.warehouseFg,
          fromWarehouseId: null,
          suggestionType: "PRODUCTION_ORDER",
          qty: "7",
          uomId: null,
          dueDate: "2026-03-20",
          releaseDate: "2026-03-13",
          frozenFence: false,
          substitutedItemId: null,
          bomId: null,
          netting: {},
          actorId: M_ACTOR,
        },
      ]);
      const first = await mrpSuggestions.accept(suggestion!.id, M_ACTOR);
      expect(first.replay).toBe(false);
      expect(first.documentType).toBe("production_order");
      // The MO carries the bidirectional link.
      const mo = await orders.find(first.documentId);
      expect(mo.mrpSuggestionId).toBe(suggestion!.id);
      // THE RETRY: the idempotent replay — the same document, no second.
      const retry = await mrpSuggestions.accept(suggestion!.id, M_ACTOR);
      expect(retry.replay).toBe(true);
      expect(retry.documentId).toBe(first.documentId);
      // Exactly one MO carries the suggestion link.
      const mos = await orders.list({ limit: 200 });
      const linked = mos.filter((row) => row.mrpSuggestionId === suggestion!.id);
      expect(linked).toHaveLength(1);
    });
  });

  it("the engine nets the seeded fixture exactly and the re-run supersedes", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const planning = await import("../../modules/manufacturing/infrastructure/planning.store");
      // Policy: lead time 5, LOT_FOR_LOT, no safety stock.
      const itemsModule = await import("../../modules/items/infrastructure/items.store");
      await itemsModule.updateItemPlanningPolicy(s.mrpMat, {
        leadTimeDays: 5,
        safetyStockPolicy: "MANUAL",
        safetyStockQty: "0",
        ssServiceLevelPct: null,
        ssLookbackDays: null,
        lotSizingRule: "LOT_FOR_LOT",
        fixedOrderQty: null,
        orderMultiple: null,
        periodSupplyBuckets: null,
        frozenFenceDays: 0,
        slushyFenceDays: 0,
      });
      // Firm demand for 20 on 2026-03-10 at M-FG (approved sales order).
      const salesOrder = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-10",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "INV-030 db proof",
        noteAr: null,
        actorId: M_ACTOR,
        totalNet: "40.0000",
        totalTax: "0.0000",
        totalGross: "40.0000",
        lines: [
          {
            itemId: s.mrpMat,
            description: null,
            descriptionAr: null,
            qty: "20",
            unitPrice: "2.000000",
            discountAmount: "0.000000",
            taxCodeId: f.taxCodeIds.notSubject,
            netAmount: "40.0000",
            taxAmount: "0.0000",
            note: null,
          },
        ],
      });
      await salesStore.updateSalesOrderStatus({
        id: salesOrder.id,
        status: "APPROVED",
        actorId: M_ACTOR,
      });

      // The run: 2026-03-01, 14 DAY buckets. The net expectation derives
      // from the SNAPSHOT rows themselves (the honest INV-030 oracle —
      // demand − (on-hand − reserved), whatever the earlier guards
      // seeded).
      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 14,
        runMode: "REGENERATIVE",
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");
      const run = result.run;
      const demandLines = (await planning.listMrpDemandLines({ runId: run.id })).filter(
        (row) => row.itemId === s.mrpMat,
      );
      const supplyLines = (await planning.listMrpSupplyLines({ runId: run.id })).filter(
        (row) => row.itemId === s.mrpMat,
      );
      const demand20 = demandLines
        .filter((row) => row.demandKind === "SALES_ORDER")
        .reduce((sum, row) => sum + Number(row.qty), 0);
      const onHand = supplyLines
        .filter((row) => row.supplyKind === "ON_HAND")
        .reduce((sum, row) => sum + Number(row.qty), 0);
      const reservedQty = supplyLines
        .filter((row) => row.supplyKind === "RESERVED")
        .reduce((sum, row) => sum + Number(row.qty), 0);
      expect(demand20).toBe(20);
      const expectedNet = demand20 - Math.max(0, onHand - reservedQty);
      // The snapshot rows carry the terms (the evidence).
      expect(demandLines.map((row) => [row.demandKind, row.qty])).toContainEqual([
        "SALES_ORDER",
        "20.000000",
      ]);
      expect(supplyLines.map((row) => [row.supplyKind, row.qty])).toContainEqual([
        "ON_HAND",
        "10.000000",
      ]);
      expect(supplyLines.map((row) => [row.supplyKind, row.qty])).toContainEqual([
        "RESERVED",
        "6.000000",
      ]);
      // The suggestion: PURCHASE_ORDER (no ACTIVE BOM on mrpMat), the
      // exact net, due 2026-03-10, release 2026-03-05 (lead time 5).
      const mine = result.suggestions.filter((row) => row.itemId === s.mrpMat);
      expect(mine).toHaveLength(1);
      expect(mine[0]!.suggestionType).toBe("PURCHASE_ORDER");
      expect(Number(mine[0]!.qty)).toBe(expectedNet);
      expect(mine[0]!.dueDate).toBe("2026-03-10");
      expect(mine[0]!.releaseDate).toBe("2026-03-05");

      // THE RE-RUN: the still-SUGGESTED row is superseded (exactly one
      // live suggestion per item+warehouse — the coverage netting).
      const rerun = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 14,
        runMode: "REGENERATIVE",
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      const mineAfter = (
        await planning.listMrpSuggestions({ warehouseId: f.warehouseFg, limit: 500 })
      ).filter((row) => row.itemId === s.mrpMat && row.status === "SUGGESTED");
      expect(mineAfter).toHaveLength(1);
      expect(mineAfter[0]!.runId).toBe(rerun.run.id);
      const superseded = (
        await planning.listMrpSuggestions({ warehouseId: f.warehouseFg, limit: 500 })
      ).find((row) => row.id === mine[0]!.id);
      expect(superseded!.status).toBe("SUPERSEDED");
      expect(superseded!.supersededByRunId).toBe(rerun.run.id);
    });
  });
});

// The rough-cut guard rides the same suite (M-25's warning-only law).
describe("BOR rough-cut check (M-25)", () => {
  it("overloads are warnings in the report, never blocked writes", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const draft = await boms.create({
        itemId: s.mrpFg,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: "BOR guard BOM",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: s.mrpMat, qtyPerOutput: "1.000000", scrapPct: "0" }],
      });
      const active = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
      // A work center (8h/shift × 1 shift = 8h/day) — ensure one exists.
      const centers = await mfgStore.listWorkCenters({ limit: 50 });
      const center =
        centers[0] ??
        (await workCenters.create({
          code: `WC-BOR-${Date.now() % 100000}`,
          name: "BOR rough-cut center",
          nameAr: null,
          description: null,
          capacityPerShift: "8.00",
          shiftsPerDay: 1,
          fixedCostRate: "0",
          varCostRate: "0",
          costCenterId: null,
          actorId: M_ACTOR,
        }));
      await borSrv.replace(
        active.id,
        [
          {
            resourceKind: "WORK_CENTER",
            workCenterId: center.id,
            itemId: null,
            consumptionFactor: "2.000000", // 2h per unit
            note: null,
          },
        ],
        M_ACTOR,
      );
      // 10 units × 2h = 20h vs 8h/day × 1 day = 8h → 250% overload.
      const check = await borSrv.roughCut({
        itemId: s.mrpFg,
        warehouseId: f.warehouseFg,
        proposedQty: "10",
        horizonDays: 1,
      });
      expect(check.overloads).toBe(1);
      expect(check.rows[0]!.overloaded).toBe(true);
      expect(check.rows[0]!.utilizationPct).toBe("250.00");
    });
  });
});
