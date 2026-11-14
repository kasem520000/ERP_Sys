import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

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
import { MtoLinkInvalidError } from "../../modules/manufacturing/domain/manufacturing-errors";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  orders,
  reservations,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-043 audit item 4 — the MTO chain from the SALES ORDER to the
 * DELIVERY (G-49 proved the reservation's creation; this spec proves its
 * LIFECYCLE: consumption at delivery, partial settles, the non-delivered
 * lines' coverage, the cancel path, and the link's business contract).
 *
 * The audit's findings (confirmed by code reading, then practically):
 * the delivery post released EVERY order line's OWN reservation on ANY
 * delivery of the order — a partial delivery un-reserved the
 * not-yet-shipped lines' stock — and NEVER touched the PRODUCTION_ORDER
 * holder reservations (G-49's chain): the MTO reservation leaked ACTIVE
 * forever, permanently reducing availability (reserved never promises,
 * forever). The comment at the completion claimed "the delivery consumes
 * the reservation" — intent that was never implemented (now it is).
 *
 * The delivery settlement contract (implemented + asserted here): the
 * SHIPPED qty retires coverage per DELIVERED line, MTO-first (the linked
 * MOs' ACTIVE PRODUCTION_ORDER reservations, oldest MO first), then the
 * line's OWN sales reservation — partial by qty (a remainder stays ACTIVE
 * for the still-undelivered portion); lines not in THIS delivery keep
 * their reservations untouched.
 *
 * The MTO link's business contract (made explicit in linkSalesOrder):
 * DRAFT-only + item match + THE SALES ORDER'S WAREHOUSE MUST EQUAL THE
 * ORDER'S FG WAREHOUSE (the batch lands where the delivery ships from);
 * the quantity is deliberately unconstrained at link time (several MOs
 * may feed one line; the reservation holds the ACTUAL completed qty).
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

interface SpecItems {
  lfFg: string;
  lfMat: string;
}

const spec: { fixture?: MfgFixture; items?: SpecItems; bomId?: string } = {};

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

/** The full MTO chain up to (but excluding) the delivery: an ISSUED sales
 * order with the FG line, a linked DRAFT MO released and completed for
 * `qty` — returns the order, its first line, and the MO. */
async function mtoChain(qty: string): Promise<{
  salesOrder: { id: string; customerId: string };
  fgLineId: string;
  otherLineId: string | null;
  orderId: string;
}> {
  const f = spec.fixture!;
  const s = spec.items!;
  // The material for the MO's consumption…
  await stock.manualReceipt({
    itemId: s.lfMat,
    warehouseId: f.warehouseRaw,
    qty: "50",
    unitCost: "4.000000",
    reason: "COUNT_GAIN",
    counterAccountId: null,
    valueDate: "2026-03-01",
    batchNo: `M-LF-MAT-${Date.now() % 100000}`,
    batchExpiry: "2027-01-01",
    actorId: M_ACTOR,
  });
  // …and 5 at the FG warehouse — the second line's OWN coverage draws on
  // it (the over-reservation guard requires real stock at the reserved
  // warehouse — the 043-audit item-5 law).
  await stock.manualReceipt({
    itemId: s.lfMat,
    warehouseId: f.warehouseFg,
    qty: "5",
    unitCost: "4.000000",
    reason: "COUNT_GAIN",
    counterAccountId: null,
    valueDate: "2026-03-01",
    batchNo: `M-LF-MAT-FG-${Date.now() % 100000}`,
    batchExpiry: "2027-01-01",
    actorId: M_ACTOR,
  });
  const salesOrder = await salesStore.insertSalesOrder({
    branchId: f.branchId,
    customerId: f.customerId,
    salesRepId: null,
    warehouseId: f.warehouseFg,
    quotationId: null,
    orderDate: "2026-03-01",
    expectedDate: "2026-03-20",
    currencyCode: "SAR",
    exchangeRate: null,
    note: "MTO lifecycle chain",
    noteAr: null,
    actorId: null,
    totalNet: new Decimal(qty).times(10).toFixed(4),
    totalTax: "0.0000",
    totalGross: new Decimal(qty).times(10).toFixed(4),
    lines: [
      {
        itemId: s.lfFg,
        description: "MTO lifecycle FG line",
        descriptionAr: null,
        qty,
        unitPrice: "10.000000",
        discountAmount: "0.000000",
        taxCodeId: f.taxCodeIds.notSubject,
        netAmount: new Decimal(qty).times(10).toFixed(4),
        taxAmount: "0.0000",
        note: null,
      },
      {
        itemId: s.lfMat,
        description: "MTO lifecycle second line (the non-delivered control)",
        descriptionAr: null,
        qty: "2",
        unitPrice: "5.000000",
        discountAmount: "0.000000",
        taxCodeId: f.taxCodeIds.notSubject,
        netAmount: "10.0000",
        taxAmount: "0.0000",
        note: null,
      },
    ],
  });
  await salesOrdersSvc.submit(salesOrder.id, M_ACTOR);
  await salesOrdersSvc.approve(salesOrder.id, M_ACTOR);
  await salesOrdersSvc.issue(salesOrder.id, M_ACTOR);
  const lines = await salesStore.listSalesOrderLines(salesOrder.id);
  const fgLine = lines.find((line) => line.itemId === s.lfFg)!;
  const otherLine = lines.find((line) => line.itemId === s.lfMat)!;

  const order = await orders.create({
    branchId: f.branchId,
    itemId: s.lfFg,
    bomId: spec.bomId!,
    plannedQty: qty,
    plannedDate: "2026-03-18",
    materialsWarehouseId: f.warehouseRaw,
    fgWarehouseId: f.warehouseFg,
    laborRate: "0",
    overheadRate: "0",
    costCenterId: null,
    note: "MTO lifecycle order",
    noteAr: null,
    actorId: M_ACTOR,
  });
  await orders.linkSalesOrder(order.id, { salesOrderLineId: fgLine.id, actorId: M_ACTOR });
  await orders.release(order.id, M_ACTOR);
  await orders.start(order.id, M_ACTOR);
  await orders.consume(order.id, {
    lines: [{ itemId: s.lfMat, qty }],
    consumedAt: "2026-03-15",
    note: null,
    noteAr: null,
    actorId: M_ACTOR,
  });
  const completed = await orders.complete(order.id, {
    actualQty: qty,
    completedAt: "2026-03-16",
    actorId: M_ACTOR,
  });
  expect(completed.order.status).toBe("COMPLETED");
  return {
    salesOrder: { id: salesOrder.id, customerId: salesOrder.customerId },
    fgLineId: fgLine.id,
    otherLineId: otherLine.id,
    orderId: order.id,
  };
}

/** ACTIVE reservations for the FG item at the FG warehouse. */
async function activeFgReservations(): Promise<invStore.ReservationRow[]> {
  const f = spec.fixture!;
  const s = spec.items!;
  return withTenant(TENANT_M, async () =>
    (await invStore.listReservations({
      itemId: s.lfFg,
      warehouseId: f.warehouseFg,
      status: "ACTIVE",
      limit: 100,
    })) as invStore.ReservationRow[],
  );
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.items = {
      lfFg: await ensureItem("M-LF-FG", "MTO lifecycle FG"),
      lfMat: await ensureItem("M-LF-MAT", "MTO lifecycle material"),
    };
    // ONE active BOM for lfFg (the one-ACTIVE-per-item law) — every chain
    // and the cancel-path order release against it.
    const draft = await boms.create({
      itemId: spec.items.lfFg,
      outputUomId: (await itemsStore.findItemById(spec.items.lfFg))!.uomId,
      yieldPct: "100.0000",
      mainAllocationPct: "100.0000",
      note: "MTO lifecycle BOM",
      noteAr: null,
      actorId: M_ACTOR,
      lines: [{ componentItemId: spec.items.lfMat, qtyPerOutput: "1.000000", scrapPct: "0" }],
    });
    const active = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
    spec.bomId = active.id;
  });
});

describe("PHASE-043 audit item 4 — the MTO chain from sales order to delivery", () => {
  it("the full chain: completion reserves, the delivery CONSUMES the MTO reservation — no leaked ACTIVE holder, the non-delivered line keeps its coverage", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    const chain = await withTenant(TENANT_M, () => mtoChain("10"));

    // The line's OWN sales reservation for the second line (the
    // non-delivered control): reserve 2 of lfMat at the FG warehouse.
    const ownReservation = await withTenant(TENANT_M, () =>
      reservations.create({
        itemId: s.lfMat,
        warehouseId: f.warehouseFg,
        qty: "2",
        holderType: "SALES_ORDER",
        holderId: chain.salesOrder.id,
        expiresAt: null,
        note: "lifecycle — the second line's own coverage",
        actorId: M_ACTOR,
      }),
    );
    await withTenant(TENANT_M, () =>
      salesStore.setOrderLineReservation(chain.otherLineId!, ownReservation.id),
    );

    // The completion created the MTO reservation (G-49's chain).
    const beforeDelivery = await activeFgReservations();
    const mto = beforeDelivery.find(
      (row) => row.holderType === "PRODUCTION_ORDER" && row.holderId === chain.orderId,
    );
    expect(mto).toBeDefined();
    expect(mto!.qty).toBe("10.000000");

    // The delivery: ships the FG line ONLY (the second line stays).
    const delivery = await withTenant(TENANT_M, () =>
      deliveries.create({
        branchId: f.branchId,
        customerId: chain.salesOrder.customerId,
        salesRepId: null,
        orderId: chain.salesOrder.id,
        warehouseId: f.warehouseFg,
        deliveryDate: "2026-03-17",
        currencyCode: "SAR",
        note: "MTO lifecycle delivery",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [
          {
            orderLineId: chain.fgLineId,
            itemId: s.lfFg,
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
      }),
    );
    await withTenant(TENANT_M, () => deliveries.post(delivery.id, M_ACTOR));

    // THE LIFECYCLE PROOF: the MTO reservation is CONSUMED (never a
    // leaked ACTIVE holder reducing availability forever).
    const afterFg = await activeFgReservations();
    expect(afterFg).toHaveLength(0);
    const consumed = await withTenant(TENANT_M, () =>
      invStore.listReservations({
        itemId: s.lfFg,
        warehouseId: f.warehouseFg,
        status: "CONSUMED",
        limit: 100,
      }),
    );
    const consumedMto = consumed.find((row) => row.holderId === chain.orderId);
    expect(consumedMto).toBeDefined();

    // The stock physically moved: the FG on-hand at the delivery
    // warehouse is 0 (10 completed, 10 shipped).
    const onHand = await withTenant(TENANT_M, async () => {
      const rows = await (
        await import("../../modules/manufacturing/infrastructure/planning.store")
      ).listQualifiedOnHand(f.warehouseFg);
      return rows.find((row) => row.itemId === s.lfFg)?.qty ?? "0.000000";
    });
    expect(onHand).toBe("0.000000");

    // The NON-DELIVERED line keeps its own coverage: still ACTIVE, the
    // order line's link unchanged (pre-fix ANY delivery of the order
    // released EVERY line's reservation).
    const ownAfter = await withTenant(TENANT_M, () =>
      invStore.listReservations({
        itemId: s.lfMat,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 100,
      }),
    );
    expect(ownAfter.map((row) => [row.id, row.qty])).toContainEqual([
      ownReservation.id,
      "2.000000",
    ]);
    const otherLineAfter = (await withTenant(TENANT_M, () =>
      salesStore.listSalesOrderLines(chain.salesOrder.id),
    )).find((line) => line.id === chain.otherLineId)!;
    expect(otherLineAfter.reservationId).toBe(ownReservation.id);
  });

  it("partial delivery: the MTO reservation settles PARTIALLY (the remainder stays ACTIVE at the exact remaining qty), the repeat delivery consumes the rest", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    const chain = await withTenant(TENANT_M, () => mtoChain("10"));

    // Deliver 4 of 10.
    const first = await withTenant(TENANT_M, () =>
      deliveries.create({
        branchId: f.branchId,
        customerId: chain.salesOrder.customerId,
        salesRepId: null,
        orderId: chain.salesOrder.id,
        warehouseId: f.warehouseFg,
        deliveryDate: "2026-03-17",
        currencyCode: "SAR",
        note: "MTO lifecycle partial delivery",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [
          {
            orderLineId: chain.fgLineId,
            itemId: s.lfFg,
            qty: "4",
            unitPrice: "10.000000",
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
    await withTenant(TENANT_M, () => deliveries.post(first.id, M_ACTOR));

    // The MTO reservation: ACTIVE at the exact remaining 6 (the correct
    // remaining reserved qty for the partially delivered line).
    const afterFirst = await activeFgReservations();
    const mtoAfterFirst = afterFirst.find((row) => row.holderId === chain.orderId);
    expect(mtoAfterFirst).toBeDefined();
    expect(mtoAfterFirst!.qty).toBe("6.000000");

    // The repeat delivery ships the remaining 6 → CONSUMED, stock 0.
    const second = await withTenant(TENANT_M, () =>
      deliveries.create({
        branchId: f.branchId,
        customerId: chain.salesOrder.customerId,
        salesRepId: null,
        orderId: chain.salesOrder.id,
        warehouseId: f.warehouseFg,
        deliveryDate: "2026-03-18",
        currencyCode: "SAR",
        note: "MTO lifecycle repeat delivery",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [
          {
            orderLineId: chain.fgLineId,
            itemId: s.lfFg,
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
      }),
    );
    await withTenant(TENANT_M, () => deliveries.post(second.id, M_ACTOR));
    const afterSecond = await activeFgReservations();
    expect(afterSecond).toHaveLength(0);
    const onHand = await withTenant(TENANT_M, async () => {
      const rows = await (
        await import("../../modules/manufacturing/infrastructure/planning.store")
      ).listQualifiedOnHand(f.warehouseFg);
      return rows.find((row) => row.itemId === s.lfFg)?.qty ?? "0.000000";
    });
    expect(onHand).toBe("0.000000");
  });

  it("the link's business contract: a warehouse mismatch is the typed rejection (the batch must land where the delivery ships from)", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const salesOrder = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-20",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "MTO warehouse-contract order",
        noteAr: null,
        actorId: M_ACTOR,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            itemId: s.lfFg,
            description: "warehouse contract line",
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
      const line = (await salesStore.listSalesOrderLines(salesOrder.id))[0]!;
      const order = await orders.create({
        branchId: f.branchId,
        itemId: s.lfFg,
        bomId: null,
        plannedQty: "10",
        plannedDate: null,
        materialsWarehouseId: f.warehouseRaw,
        fgWarehouseId: f.warehouseRaw, // ≠ the order's warehouseFg
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "warehouse mismatch order",
        noteAr: null,
        actorId: M_ACTOR,
      });
      await expect(
        orders.linkSalesOrder(order.id, { salesOrderLineId: line.id, actorId: M_ACTOR }),
      ).rejects.toBeInstanceOf(MtoLinkInvalidError);
    });
  });

  it("cancel before completion: no reservation was ever created (the holder exists only from completion) — the cancel is clean", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const salesOrder = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-20",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "MTO cancel-path order",
        noteAr: null,
        actorId: M_ACTOR,
        totalNet: "50.0000",
        totalTax: "0.0000",
        totalGross: "50.0000",
        lines: [
          {
            itemId: s.lfFg,
            description: "cancel path line",
            descriptionAr: null,
            qty: "5",
            unitPrice: "10.000000",
            discountAmount: "0.000000",
            taxCodeId: f.taxCodeIds.notSubject,
            netAmount: "50.0000",
            taxAmount: "0.0000",
            note: null,
          },
        ],
      });
      const line = (await salesStore.listSalesOrderLines(salesOrder.id))[0]!;
      const order = await orders.create({
        branchId: f.branchId,
        itemId: s.lfFg,
        bomId: spec.bomId!,
        plannedQty: "5",
        plannedDate: null,
        materialsWarehouseId: f.warehouseRaw,
        fgWarehouseId: f.warehouseFg,
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "cancel path order",
        noteAr: null,
        actorId: M_ACTOR,
      });
      await orders.linkSalesOrder(order.id, { salesOrderLineId: line.id, actorId: M_ACTOR });
      await orders.release(order.id, M_ACTOR);
      const cancelled = await orders.cancel(order.id, {
        reason: "the customer cancelled (lifecycle spec)",
        actorId: M_ACTOR,
      });
      expect(cancelled.status).toBe("CANCELLED");
      // No PRODUCTION_ORDER reservation exists for the cancelled MO.
      const active = await invStore.listReservations({
        itemId: s.lfFg,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 100,
      });
      expect(active.filter((row) => row.holderId === order.id)).toHaveLength(0);
    });
  });

  it("THE DEAD-LINE GUARD (the round-3 probe): the SALES ORDER cancels while the MO is in progress — the completion creates NO holder for the dead line (the made-for-order stock lands FREE; pre-fix the holder leaked ACTIVE forever: no delivery can post for a cancelled order and the cancel's release had already run)", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      // A DEDICATED FG item + BOM (the surplus spec's per-scenario
      // isolation — the availability assertions answer for THIS item
      // alone).
      const deadFg = await ensureItem(
        `M-LF-DEAD-${Date.now() % 100000}`,
        "MTO dead-line FG (round-3 probe)",
      );
      const draft = await boms.create({
        itemId: deadFg,
        outputUomId: (await itemsStore.findItemById(deadFg))!.uomId,
        yieldPct: "100.0000",
        mainAllocationPct: "100.0000",
        note: "MTO dead-line BOM (round-3 probe)",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: s.lfMat, qtyPerOutput: "1.000000", scrapPct: "0" }],
      });
      const activeBom = await boms.activate(draft.id, {
        effectiveFrom: "2026-03-01",
        actorId: M_ACTOR,
      });
      // The material for the MO's consumption.
      await stock.manualReceipt({
        itemId: s.lfMat,
        warehouseId: f.warehouseRaw,
        qty: "10",
        unitCost: "4.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-03-01",
        batchNo: `M-LF-DEAD-MAT-${Date.now() % 100000}`,
        batchExpiry: "2027-01-01",
        actorId: M_ACTOR,
      });

      const salesOrder = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-20",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "MTO dead-line order (round-3 probe)",
        noteAr: null,
        actorId: null,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            itemId: deadFg,
            description: "dead-line FG line",
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
      await salesOrdersSvc.submit(salesOrder.id, M_ACTOR);
      await salesOrdersSvc.approve(salesOrder.id, M_ACTOR);
      await salesOrdersSvc.issue(salesOrder.id, M_ACTOR);
      const line = (await salesStore.listSalesOrderLines(salesOrder.id))[0]!;

      const order = await orders.create({
        branchId: f.branchId,
        itemId: deadFg,
        bomId: activeBom.id,
        plannedQty: "10",
        plannedDate: "2026-03-18",
        materialsWarehouseId: f.warehouseRaw,
        fgWarehouseId: f.warehouseFg,
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "MTO dead-line order (round-3 probe)",
        noteAr: null,
        actorId: M_ACTOR,
      });
      await orders.linkSalesOrder(order.id, { salesOrderLineId: line.id, actorId: M_ACTOR });
      await orders.release(order.id, M_ACTOR);
      await orders.start(order.id, M_ACTOR);
      await orders.consume(order.id, {
        lines: [{ itemId: s.lfMat, qty: "10" }],
        consumedAt: "2026-03-15",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      });

      // THE ORDER DIES while the MO is in progress. The cancel's release
      // runs — and finds NO holder to release (holders exist only from
      // completion): clean, BY CONSTRUCTION, at this instant.
      const cancelled = await salesOrdersSvc.cancel(
        salesOrder.id,
        "the customer walked away (round-3 probe)",
        M_ACTOR,
      );
      expect(cancelled.status).toBe("CANCELLED");
      const beforeCompletion = (await invStore.listReservations({
        itemId: deadFg,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 100,
      })) as invStore.ReservationRow[];
      expect(beforeCompletion).toHaveLength(0);

      // The MO completes for the dead line.
      const completed = await orders.complete(order.id, {
        actualQty: "10",
        completedAt: "2026-03-16",
        actorId: M_ACTOR,
      });
      expect(completed.order.status).toBe("COMPLETED");

      // THE LAW: NO holder for the dead line — the made-for-order stock
      // lands FREE. Pre-fix: the completion reserved 10 under the
      // PRODUCTION_ORDER holder for a CANCELLED line, and NOBODY could
      // ever settle it (no delivery can post for a cancelled order; the
      // cancel's release had already run before the holder existed) —
      // an ACTIVE row netting availability FOREVER.
      const after = (await invStore.listReservations({
        itemId: deadFg,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 100,
      })) as invStore.ReservationRow[];
      expect(after).toHaveLength(0);
      // The produced 10 are FREE stock: availability recovers them all.
      const availability = await invStore.reservationAvailability(deadFg, f.warehouseFg);
      expect(Number(availability.available)).toBe(10);

      // The control: the COMPLETION itself was never blocked by the dead
      // link (the MO's own lifecycle is the production side's business —
      // the goods exist; only the dead line's HOLD is refused).
      expect(completed.order.actualQty).toBe("10.000000");
      expect(completed.order.fgBatchId).not.toBeNull();
    });
  });
});
