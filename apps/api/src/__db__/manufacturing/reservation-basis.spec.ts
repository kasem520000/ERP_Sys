import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as invStore from "../../modules/inventory/infrastructure/inventory.store";
import * as salesStore from "../../modules/sales/infrastructure/sales.store";
import { DeliveryNoteService } from "../../modules/sales/application/deliveries";
import { SalesOrderService } from "../../modules/sales/application/orders";
import { AtpService } from "../../modules/manufacturing/application/atp-service";
import { PickingService } from "../../modules/inventory/application/picking-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { ConsignmentService } from "../../modules/inventory/application/consignment-service";
import { ReservationPolicyError } from "../../modules/manufacturing/domain/manufacturing-errors";
import { ReservationQtyExceedsAvailableError } from "../../modules/inventory/domain/inventory-errors";
import {
  M_ACTOR,
  TENANT_M,
  atpSrv,
  boms,
  orders,
  reservationPolicy,
  reservations,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-043 audit round 2, item 2 — the reservation BASIS across every
 * creation path, the batch-state honesty, and the soft-model declaration.
 *
 * The audit's findings (code-reading; each is proven or refuted HERE on
 * the live DB):
 * (a) reserveForHolder (the POLICY engine — the MTO completion's own
 *     reservation path) verified against RAW bin rows only: an UNBINNED
 *     balance (the pre-WMS shape the creation choke point's fallback
 *     accepts, and that ATP + the MRP engine count) was INVISIBLE to it
 *     — the same stock, three different answers.
 * (b) The walk's exclusion set missed the BATCH-level state: a
 *     QUARANTINED or WRITTEN_OFF batch's bin rows stay AVAILABLE, so a
 *     reservation could hold stock ATP refuses to promise
 *     (listQualifiedOnHand excludes ib.status <> 'ACTIVE'), and an
 *     EXPIRED batch (never written off) counted as pickable everywhere.
 * (c) THE SOFT-MODEL PROOF: the MTO "hard reservation" language — can
 *     another order's DELIVERY physically consume MTO-reserved stock?
 *     The answer is asserted verbatim below (it can — the reservation is
 *     an ATP/availability hold, never a physical pick lock), and the
 *     concurrency dichotomy (reserve vs a concurrent issue) is pinned.
 * (d) Consignment rows never enter the basis on ANY path (BR-076).
 *
 * THE UNIFIED BASIS (implemented + asserted): every reservation creation
 * path — ReservationService.create (the choke point), the policy engine's
 * reserveForHolder, the MTO completion riding it — draws on the SAME
 * pool: pickable bins (AVAILABLE, tenant-owned, batch ACTIVE and not
 * expired) + the unbinned fallback (item_stock − every bin row) − the
 * ACTIVE non-expired reserved pool. That is the same truth ATP nets
 * (the BR-080 fold) and the MRP engine seeds — one answer everywhere.
 */

const specAudit = new AuditService(new DrizzleAuditStore());
const specPosting = new PostingService(specAudit, new PartnerSubledgerService());
const specNumbering = new NumberingService(specAudit);
const deliveries = new DeliveryNoteService(
  specAudit,
  specPosting,
  specNumbering,
  new PickingService(specAudit, specNumbering),
);
const salesOrdersSvc = new SalesOrderService(specAudit, specNumbering, new AtpService());
const consignment = new ConsignmentService(specAudit, specPosting);

const spec: {
  fixture?: MfgFixture;
  mat?: string;
  bomId?: string;
  mtoFg?: string;
  thiefFg?: string;
  raceFg?: string;
} = {};

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

async function receiveAtFg(itemId: string, qty: string, batchNo: string, expiry: string): Promise<void> {
  await stock.manualReceipt({
    itemId,
    warehouseId: spec.fixture!.warehouseFg,
    qty,
    unitCost: "4.000000",
    reason: "COUNT_GAIN",
    counterAccountId: null,
    valueDate: "2026-03-01",
    batchNo,
    batchExpiry: expiry,
    actorId: M_ACTOR,
  });
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.mat = await ensureItem("M-RB-MAT", "Reservation basis material");
    spec.mtoFg = await ensureItem("M-RB-MTO-FG", "Reservation basis — the MTO soft-model proof");
    spec.thiefFg = await ensureItem("M-RB-THIEF", "Reservation basis — the concurrent thief");
    const draft = await boms.create({
      itemId: spec.mtoFg,
      outputUomId: (await itemsStore.findItemById(spec.mtoFg))!.uomId,
      yieldPct: "100.0000",
      mainAllocationPct: "100.0000",
      note: "Reservation basis BOM",
      noteAr: null,
      actorId: M_ACTOR,
      lines: [{ componentItemId: spec.mat, qtyPerOutput: "1.000000", scrapPct: "0" }],
    });
    const active = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
    spec.bomId = active.id;
  });
});

describe("PHASE-043 audit round 2, item 2 — one reservation basis across every path", () => {
  it("(a) UNBINNED balance: reserveForHolder ITSELF accepts it (the MTO holder shape too) — the same answer as the choke point, ATP, and the engine", async () => {
    await withTenant(TENANT_M, async (tx) => {
      const unbinned = await ensureItem("M-RB-UNBIN", "Reservation basis unbinned item");
      // The pre-WMS shape: an item_stock row with NO bin_contents at all
      // (the ambient transaction's own handle — the overcommit-spec
      // pattern).
      await tx.execute(sql`
        INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${unbinned}, ${spec.fixture!.warehouseFg}, 10, 2.500000)
        ON CONFLICT DO NOTHING`);

      // The POLICY engine (the MTO completion's reservation path) accepts
      // the unbinned 10 — the unified basis (pre-fix: the bin-only walk
      // threw ReservationPolicyError — the same stock, a different answer
      // than the choke point, ATP, and the engine).
      const viaPolicy = await reservationPolicy.reserveForHolder({
        itemId: unbinned,
        warehouseId: spec.fixture!.warehouseFg,
        qty: "6",
        holderType: "PRODUCTION_ORDER", // the MTO completion's exact holder shape
        holderId: "11111111-2222-4333-8444-555555555555",
        note: "basis spec — the unbinned policy reserve",
        actorId: M_ACTOR,
      });
      expect(viaPolicy.reservationId).toBeDefined();
      // The allocation plan is the BIN-LEVEL portion (informational): the
      // unbinned coverage rides the availability, not the plan.
      expect(viaPolicy.allocationPlan).toHaveLength(0);

      // 6 more exceeds the unbinned 10 − 6: the SAME typed rejection the
      // choke point gives (one basis, one answer).
      await expect(
        reservationPolicy.reserveForHolder({
          itemId: unbinned,
          warehouseId: spec.fixture!.warehouseFg,
          qty: "6",
          holderType: "MANUAL",
          holderId: null,
          note: "basis spec — the over-draw must fail",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationPolicyError);

      // The honest pool reads identically on the choke point's surface.
      const availability = await invStore.reservationAvailability(
        unbinned,
        spec.fixture!.warehouseFg,
      );
      expect(availability).toMatchObject({
        pickableBins: "0", // raw SQL zero (COALESCE); the Decimal-formatted fields carry the scale
        unbinned: "10.000000",
        reserved: "6.000000",
        available: "4.000000",
      });
      // Clean the pool for the suite.
      const rows = await invStore.listReservations({
        itemId: unbinned,
        warehouseId: spec.fixture!.warehouseFg,
        status: "ACTIVE",
        limit: 10,
      });
      for (const row of rows) await reservations.release(row.id, M_ACTOR);
    });
  });

  it("(b) a QUARANTINED batch never backs a reservation — the same stock ATP refuses to promise", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      const item = await ensureItem("M-RB-QUAR", "Reservation basis quarantined-batch item");
      const batchNo = `M-RB-QUAR-${Date.now() % 100000}`;
      await receiveAtFg(item, "10", batchNo, "2027-01-01");
      const batch = (await invStore.findBatchByNo(item, batchNo))!;
      // The QC gate's batch-level hold (the bin row stays AVAILABLE — the
      // exact state the audit read).
      await invStore.markBatchQuarantined(batch.id);

      // ATP refuses to promise it (the BR-080 fold excludes the batch).
      const atp = await atpSrv.check({
        itemId: item,
        warehouseId: f.warehouseFg,
        qty: "5",
      });
      expect(atp.availableNow).toBe("0.000000");
      expect(atp.verdict).toBe("SHORT");

      // The reservation paths refuse it too (pre-fix: both ACCEPTED —
      // holding stock ATP never promises).
      await expect(
        reservationPolicy.reserveForHolder({
          itemId: item,
          warehouseId: f.warehouseFg,
          qty: "5",
          holderType: "MANUAL",
          holderId: null,
          note: "basis spec — the quarantined batch must not hold",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationPolicyError);
      await expect(
        reservations.create({
          itemId: item,
          warehouseId: f.warehouseFg,
          qty: "5",
          holderType: "MANUAL",
          holderId: null,
          expiresAt: null,
          note: "basis spec — the choke point refuses it too",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationQtyExceedsAvailableError);
    });
  });

  it("(b, the twin) an EXPIRED batch (never written off) never backs a reservation — on either path", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async (tx) => {
      const item = await ensureItem("M-RB-EXP", "Reservation basis expired-batch item");
      const batchNo = `M-RB-EXP-${Date.now() % 100000}`;
      await receiveAtFg(item, "10", batchNo, "2027-01-01");
      const batch = (await invStore.findBatchByNo(item, batchNo))!;
      // The lapse: the shelf date passed but nobody wrote the batch off
      // (seed-only mutation — the honest pre-write-off state).
      await tx.execute(sql`UPDATE item_batches SET expiry_date = '2020-01-01' WHERE id = ${batch.id}`);

      await expect(
        reservationPolicy.reserveForHolder({
          itemId: item,
          warehouseId: f.warehouseFg,
          qty: "5",
          holderType: "MANUAL",
          holderId: null,
          note: "basis spec — the expired batch must not hold",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationPolicyError);
      await expect(
        reservations.create({
          itemId: item,
          warehouseId: f.warehouseFg,
          qty: "5",
          holderType: "MANUAL",
          holderId: null,
          expiresAt: null,
          note: "basis spec — the choke point refuses it too",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationQtyExceedsAvailableError);
    });
  });

  it("(d) CONSIGNMENT stock never enters the basis on any path (BR-076 — the owner's rows never touch item_stock)", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      const item = await ensureItem("M-RB-CONS", "Reservation basis consignment item");
      // 80 units of the owner's stock at the default bin.
      await consignment.receive({
        itemId: item,
        warehouseId: f.warehouseFg,
        ownerPartnerId: f.supplierId,
        qty: "80",
        targetBinId: null,
        lpnId: null,
        batchId: null,
        batchNo: `M-RB-CONS-${Date.now() % 100000}`,
        batchExpiry: "2027-01-01",
        serialIds: null,
        note: "basis spec — the owner's replenishment",
        actorId: M_ACTOR,
      });
      // The owner's rows never touch item_stock → the unbinned fallback
      // never includes them either.
      const stockRow = await invStore.findItemStock(item, f.warehouseFg);
      expect(stockRow).toBeUndefined(); // NO tenant stock row exists at all

      // Both paths fail closed (typed): nothing promiseable exists.
      await expect(
        reservationPolicy.reserveForHolder({
          itemId: item,
          warehouseId: f.warehouseFg,
          qty: "5",
          holderType: "MANUAL",
          holderId: null,
          note: "basis spec — consignment never holds",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationPolicyError);
      await expect(
        reservations.create({
          itemId: item,
          warehouseId: f.warehouseFg,
          qty: "5",
          holderType: "MANUAL",
          holderId: null,
          expiresAt: null,
          note: "basis spec — the choke point refuses it too",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationQtyExceedsAvailableError);
    });
  });

  it("(c) THE SOFT-MODEL PROOF: another order's delivery PHYSICALLY CONSUMES the MTO-reserved stock — the reservation is an availability hold, never a pick lock", async () => {
    const f = spec.fixture!;
    const fg = spec.mtoFg!;
    await withTenant(TENANT_M, async () => {
      // The MTO chain: material → MO 10 → completion reserves the 10 FG.
      await stock.manualReceipt({
        itemId: spec.mat!,
        warehouseId: f.warehouseRaw,
        qty: "10",
        unitCost: "4.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-03-01",
        batchNo: `M-RB-MTO-MAT-${Date.now() % 100000}`,
        batchExpiry: "2027-01-01",
        actorId: M_ACTOR,
      });
      const mtoOrder = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-20",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "basis spec — the MTO order",
        noteAr: null,
        actorId: null,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            itemId: fg,
            description: "the MTO line",
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
      await salesOrdersSvc.submit(mtoOrder.id, M_ACTOR);
      await salesOrdersSvc.approve(mtoOrder.id, M_ACTOR);
      await salesOrdersSvc.issue(mtoOrder.id, M_ACTOR);
      const mtoLine = (await salesStore.listSalesOrderLines(mtoOrder.id))[0]!;
      const order = await orders.create({
        branchId: f.branchId,
        itemId: fg,
        bomId: spec.bomId!,
        plannedQty: "10",
        plannedDate: "2026-03-18",
        materialsWarehouseId: f.warehouseRaw,
        fgWarehouseId: f.warehouseFg,
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "basis spec — the MTO MO",
        noteAr: null,
        actorId: M_ACTOR,
      });
      await orders.linkSalesOrder(order.id, { salesOrderLineId: mtoLine.id, actorId: M_ACTOR });
      await orders.release(order.id, M_ACTOR);
      await orders.start(order.id, M_ACTOR);
      await orders.consume(order.id, {
        lines: [{ itemId: spec.mat!, qty: "10" }],
        consumedAt: "2026-03-15",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      });
      await orders.complete(order.id, { actualQty: "10", completedAt: "2026-03-16", actorId: M_ACTOR });

      // The MTO reservation holds all 10; ATP for anyone else: SHORT.
      const active = await invStore.listReservations({
        itemId: fg,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 10,
      });
      expect(active).toHaveLength(1);
      expect(active[0]!.holderType).toBe("PRODUCTION_ORDER");
      const atpHeld = await atpSrv.check({ itemId: fg, warehouseId: f.warehouseFg, qty: "10" });
      expect(atpHeld.verdict).toBe("SHORT");

      // ANOTHER customer's order ships the SAME stock: the delivery has
      // NO MTO link and no reservation — and it SUCCEEDS. This is the
      // asserted soft-model truth: the reservation NEVER blocks a
      // physical issue (planIssue checks on-hand only); it holds the
      // PROMISE pool, not the goods. The "hard reservation" language was
      // wrong and is corrected in the docs (this spec is the proof).
      const thief = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-20",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "basis spec — the unlinked thief order",
        noteAr: null,
        actorId: null,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            itemId: fg,
            description: "the thief line",
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
      await salesOrdersSvc.submit(thief.id, M_ACTOR);
      await salesOrdersSvc.approve(thief.id, M_ACTOR);
      await salesOrdersSvc.issue(thief.id, M_ACTOR);
      const thiefLine = (await salesStore.listSalesOrderLines(thief.id))[0]!;
      const note = await deliveries.create({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        orderId: thief.id,
        warehouseId: f.warehouseFg,
        deliveryDate: "2026-03-17",
        currencyCode: "SAR",
        note: "the physical-consumption proof",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [
          {
            orderLineId: thiefLine.id,
            itemId: fg,
            qty: "10",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: null,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      });
      await deliveries.post(note.id, M_ACTOR); // SUCCEEDS — the soft truth

      // The post-state: the goods are GONE (on-hand 0), the MTO
      // reservation STILL holds its (now unbacked) 10 — the honest soft
      // state the docs must declare; the MTO order's own shipment would
      // now fail with InsufficientStock (the exposure, named).
      const stockRow = await invStore.findItemStock(fg, f.warehouseFg);
      expect(stockRow!.qty).toBe("0.000000");
      const stillActive = await invStore.listReservations({
        itemId: fg,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 10,
      });
      expect(stillActive).toHaveLength(1);
      expect(stillActive[0]!.qty).toBe("10.000000");
      // Cancel the robbed MTO order: the settlement releases the
      // unbacked holder (no leak) — the order-side termination law.
      await salesOrdersSvc.cancel(mtoOrder.id, "the stock was consumed by another order", M_ACTOR);
      const afterCancel = await invStore.listReservations({
        itemId: fg,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 10,
      });
      expect(afterCancel).toHaveLength(0);
    });
  });

  it("(c, the race) CONCURRENT reserve vs a concurrent delivery issue: the item_stock lock serializes them — no double-spend of the physical stock, the loser fails closed", async () => {
    const f = spec.fixture!;
    const fg = spec.thiefFg!;
    // Phase 1 (its own COMMITTED UoW — the racing readers must SEE the
    // stock and the note): seed the 10 units + create the DRAFT
    // delivery of 6.
    const note = await withTenant(TENANT_M, async () => {
      await receiveAtFg(fg, "10", `M-RB-RACE-${Date.now() % 100000}`, "2027-01-01");
      return deliveries.create({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        orderId: null,
        warehouseId: f.warehouseFg,
        deliveryDate: "2026-03-17",
        currencyCode: "SAR",
        note: "the concurrency proof — the issue leg",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: fg,
            qty: "6",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: null,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      });
    });

    // Phase 2 — the race, at the TOP level (the overcommit-spec
    // pattern: one COMMITTED UoW per racing promise, never nested
    // inside an open ambient transaction): a direct delivery post of 6
    // vs a policy reserve of 6. Both paths lock the SAME item_stock row
    // (planIssue's CC-04 lock and the choke point's lockItemStockRow):
    // exactly one order of commit exists, and each side re-reads the
    // truth inside its lock.
    const settled = await Promise.allSettled([
      withTenant(TENANT_M, () => deliveries.post(note.id, M_ACTOR)),
      withTenant(TENANT_M, () =>
        reservationPolicy.reserveForHolder({
          itemId: fg,
          warehouseId: f.warehouseFg,
          qty: "6",
          holderType: "MANUAL",
          holderId: null,
          note: "the concurrency proof — the reserve leg",
          actorId: M_ACTOR,
        }),
      ),
    ]);

    await withTenant(TENANT_M, async () => {
      // THE DICHOTOMY (both arms are internally consistent — the test
      // accepts whichever the lock order produced and asserts its exact
      // invariants). The DELIVERY always fulfills (an issue checks
      // ON-HAND only — 10 ≥ 6 in either lock order); the RESERVE's fate
      // is the serialization: if the delivery's commit landed first, the
      // reserve re-read the pool inside its lock and failed CLOSED with
      // the typed error; if the reserve locked and committed first, it
      // holds 6 of the 10 — and the delivery still ships 6 (the SOFT
      // model: the reservation holds the promise pool, not the goods) —
      // the declared, visible over-commit exposure (stock 4, pool 6).
      expect(settled[0]!.status).toBe("fulfilled");
      const stockRow = await invStore.findItemStock(fg, f.warehouseFg);
      expect(stockRow!.qty).toBe("4.000000"); // 10 − the shipped 6, ALWAYS
      const active = await invStore.listReservations({
        itemId: fg,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 10,
      });
      if (settled[1]!.status === "rejected") {
        // The delivery committed first: the reserve failed CLOSED — with
        // the policy error when its early check read the post-commit
        // pool, or with the CHOKE POINT's ReservationQtyExceedsAvailableError
        // when the early check raced a pre-commit snapshot and the
        // item_stock row lock caught the truth (the serialization's
        // design — the loser never writes). Either way: typed, never a
        // silent over-book; pool empty.
        expect(
          settled[1]!.reason instanceof ReservationPolicyError ||
            settled[1]!.reason instanceof ReservationQtyExceedsAvailableError,
        ).toBe(true);
        expect(active).toHaveLength(0);
      } else {
        // The reserve committed first: the pool holds its 6 — drawn on
        // stock that then physically shipped (the soft-model exposure,
        // asserted and declared — never a silent one).
        expect(settled[1]!.status).toBe("fulfilled");
        expect(active).toHaveLength(1);
        expect(active[0]!.qty).toBe("6.000000");
        for (const row of active) await reservations.release(row.id, M_ACTOR);
      }
      // EITHER WAY: the physical stock never went negative and no
      // reservation ever exceeded the availability at its serialization
      // point (the loser never wrote).
      expect(Number(stockRow!.qty)).toBeGreaterThanOrEqual(0);
    });
  });
});
