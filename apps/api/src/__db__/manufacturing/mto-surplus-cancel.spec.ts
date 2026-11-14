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
 * PHASE-043 audit round 2, item 1 — the MTO SURPLUS and the order-side
 * terminations (the follow-up to the item-4 settlement fix, which proved
 * the per-delivery partial consume but left THREE leaks the audit
 * reproduced by reading the settlement + the cancel/close paths):
 *
 * (a) THE SURPLUS: a linked MO completing MORE than the sales line
 *     (production 12 for a line of 10) holds the full 12 under the
 *     PRODUCTION_ORDER reservation; the full 10-unit delivery retires
 *     exactly 10 (MTO-first) and the surplus 2 STAYED ACTIVE forever —
 *     the line had nothing left to ship, so no future delivery would
 *     ever consume them (the linkSalesOrder comment claimed "the surplus
 *     flows to free stock"; it did not).
 * (b) CANCEL/CLOSE after completion: releaseOrderReservations released
 *     only the LINES' OWN reservations — the PRODUCTION_ORDER holders
 *     feeding those lines were never touched, so cancelling (or closing)
 *     a completed-but-undelivered MTO order leaked the ENTIRE made-for-
 *     order stock out of availability.
 * (c) THE MIXED CASE: a line with its OWN sales reservation whose
 *     shipment was covered MTO-first — the own reservation was never
 *     touched (toRetire exhausted) and leaked ACTIVE after the line
 *     fully delivered.
 *
 * THE SETTLEMENT CONTRACT (implemented + asserted here):
 *   1. Per DELIVERED line, the shipped qty retires coverage MTO-first
 *      (the linked MOs' ACTIVE PRODUCTION_ORDER reservations, oldest MO
 *      first), then the line's OWN sales reservation — PARTIAL by qty
 *      (the item-4 law, unchanged).
 *   2. THE FULLY-DELIVERED FINALIZATION: when a delivery completes the
 *      line (cumulative POSTED delivered qty ≥ the line qty), every
 *      reservation still feeding it RETIRES — the MTO surplus (an
 *      over-producing MO's excess over the line) and the line's OWN
 *      reservation remainder (the MTO stock shipped in its place) flip
 *      RELEASED: the surplus flows to FREE stock (available again to
 *      any holder), never a leaked ACTIVE row.
 *   3. THE ORDER-SIDE TERMINATIONS: cancel and close release BOTH the
 *      lines' own reservations AND the MTO reservations feeding their
 *      lines — a cancelled/closed order ships nothing more; the
 *      made-for-order stock returns to the free pool (the stock itself
 *      stays on-hand for disposition).
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

interface ChainItems {
  fg: string;
  mat: string;
}

const spec: {
  fixture?: MfgFixture;
  items?: ChainItems;
  bomIds?: Map<string, string>;
  fgIds?: Record<string, string>;
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

/** One chain: an ISSUED sales order with ONE FG line (optionally with its
 * OWN reservation against pre-seeded stock) + one or more linked,
 * COMPLETED MOs of the given qtys — per-scenario FG items keep the
 * pre-fix leaked ACTIVE rows isolated (the honest per-scenario evidence). */
async function chain(input: {
  fgItemId: string;
  lineQty: string;
  moQtys: readonly string[];
  reserveOwn?: { seedStock: string };
}): Promise<{
  salesOrderId: string;
  customerId: string;
  fgLineId: string;
  moIds: string[];
  ownReservationId: string | null;
}> {
  const f = spec.fixture!;
  const totalMo = input.moQtys.reduce((sum, q) => sum.plus(new Decimal(q)), new Decimal(0));
  // The material for every MO's consumption…
  await stock.manualReceipt({
    itemId: spec.items!.mat,
    warehouseId: f.warehouseRaw,
    qty: totalMo.toFixed(0),
    unitCost: "4.000000",
    reason: "COUNT_GAIN",
    counterAccountId: null,
    valueDate: "2026-03-01",
    batchNo: `M-SU-MAT-${Date.now() % 100000}`,
    batchExpiry: "2027-01-01",
    actorId: M_ACTOR,
  });
  // …and the pre-seeded FG stock backing the line's OWN reservation.
  if (input.reserveOwn !== undefined) {
    await stock.manualReceipt({
      itemId: input.fgItemId,
      warehouseId: f.warehouseFg,
      qty: input.reserveOwn.seedStock,
      unitCost: "4.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-03-01",
      batchNo: `M-SU-OWN-${Date.now() % 100000}`,
      batchExpiry: "2027-01-01",
      actorId: M_ACTOR,
    });
  }
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
    note: "MTO surplus/cancel chain",
    noteAr: null,
    actorId: null,
    totalNet: new Decimal(input.lineQty).times(10).toFixed(4),
    totalTax: "0.0000",
    totalGross: new Decimal(input.lineQty).times(10).toFixed(4),
    lines: [
      {
        itemId: input.fgItemId,
        description: "MTO surplus/cancel FG line",
        descriptionAr: null,
        qty: input.lineQty,
        unitPrice: "10.000000",
        discountAmount: "0.000000",
        taxCodeId: f.taxCodeIds.notSubject,
        netAmount: new Decimal(input.lineQty).times(10).toFixed(4),
        taxAmount: "0.0000",
        note: null,
      },
    ],
  });
  if (input.reserveOwn !== undefined) {
    const own = await reservations.create({
      itemId: input.fgItemId,
      warehouseId: f.warehouseFg,
      qty: input.lineQty,
      holderType: "SALES_ORDER",
      holderId: salesOrder.id,
      expiresAt: null,
      note: "surplus spec — the line's own coverage",
      actorId: M_ACTOR,
    });
    await salesStore.setOrderLineReservation(
      (await salesStore.listSalesOrderLines(salesOrder.id))[0]!.id,
      own.id,
    );
  }
  await salesOrdersSvc.submit(salesOrder.id, M_ACTOR);
  await salesOrdersSvc.approve(salesOrder.id, M_ACTOR);
  await salesOrdersSvc.issue(salesOrder.id, M_ACTOR);
  const fgLine = (await salesStore.listSalesOrderLines(salesOrder.id))[0]!;

  const moIds: string[] = [];
  for (const qty of input.moQtys) {
    const order = await orders.create({
      branchId: f.branchId,
      itemId: input.fgItemId,
      bomId: spec.bomIds!.get(input.fgItemId)!,
      plannedQty: qty,
      plannedDate: "2026-03-18",
      materialsWarehouseId: f.warehouseRaw,
      fgWarehouseId: f.warehouseFg,
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: "MTO surplus/cancel order",
      noteAr: null,
      actorId: M_ACTOR,
    });
    await orders.linkSalesOrder(order.id, { salesOrderLineId: fgLine.id, actorId: M_ACTOR });
    await orders.release(order.id, M_ACTOR);
    await orders.start(order.id, M_ACTOR);
    await orders.consume(order.id, {
      lines: [{ itemId: spec.items!.mat, qty }],
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
    moIds.push(order.id);
  }
  const ownReservationId = input.reserveOwn !== undefined
    ? ((await salesStore.listSalesOrderLines(salesOrder.id))[0]!.reservationId)
    : null;
  return {
    salesOrderId: salesOrder.id,
    customerId: salesOrder.customerId,
    fgLineId: fgLine.id,
    moIds,
    ownReservationId,
  };
}

async function deliver(input: {
  salesOrderId: string;
  customerId: string;
  fgLineId: string;
  fgItemId: string;
  qty: string;
  date: string;
}): Promise<void> {
  const f = spec.fixture!;
  const note = await deliveries.create({
    branchId: f.branchId,
    customerId: input.customerId,
    salesRepId: null,
    orderId: input.salesOrderId,
    warehouseId: f.warehouseFg,
    deliveryDate: input.date,
    currencyCode: "SAR",
    note: "MTO surplus/cancel delivery",
    noteAr: null,
    actorId: M_ACTOR,
    lines: [
      {
        orderLineId: input.fgLineId,
        itemId: input.fgItemId,
        qty: input.qty,
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
  await deliveries.post(note.id, M_ACTOR);
}

/** The reservation-state census for one FG item at the FG warehouse. */
async function census(fgItemId: string): Promise<{
  active: { id: string; qty: string; holderType: string; holderId: string | null }[];
  released: { id: string; qty: string; holderType: string; holderId: string | null }[];
  consumed: { id: string; qty: string; holderType: string; holderId: string | null }[];
}> {
  const f = spec.fixture!;
  const read = async (status: string) =>
    (await invStore.listReservations({
      itemId: fgItemId,
      warehouseId: f.warehouseFg,
      status,
      limit: 100,
    })) as {
      id: string;
      qty: string;
      holderType: string;
      holderId: string | null;
    }[];
  return { active: await read("ACTIVE"), released: await read("RELEASED"), consumed: await read("CONSUMED") };
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    const mat = await ensureItem("M-SU-MAT", "MTO surplus material");
    spec.items = { fg: "", mat };
    spec.bomIds = new Map<string, string>();
    spec.fgIds = {};
    // Five per-scenario FG items (one ACTIVE BOM each — the
    // one-ACTIVE-per-item law; isolated leak evidence pre-fix).
    for (const [suffix, name] of [
      ["1", "MTO surplus — over-produced MO"],
      ["2", "MTO surplus — multiple MOs"],
      ["3", "MTO surplus — cancel after completion"],
      ["4", "MTO surplus — partial delivery then cancel"],
      ["5", "MTO surplus — the close twin"],
      ["6", "MTO surplus — the mixed own+MTO case"],
    ] as const) {
      const fg = await ensureItem(`M-SU-FG-${suffix}`, name);
      const draft = await boms.create({
        itemId: fg,
        outputUomId: (await itemsStore.findItemById(fg))!.uomId,
        yieldPct: "100.0000",
        mainAllocationPct: "100.0000",
        note: "MTO surplus BOM",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: mat, qtyPerOutput: "1.000000", scrapPct: "0" }],
      });
      const active = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
      spec.bomIds.set(fg, active.id);
      spec.fgIds![suffix] = fg;
    }
  });
});

describe("PHASE-043 audit round 2, item 1 — the MTO surplus and the order-side terminations", () => {
  it("the SURPLUS: SO line 10, MTO MO 12, deliver 10 — the surplus 2 flips RELEASED (free stock), zero ACTIVE, the availability recovers it", async () => {
    const f = spec.fixture!;
    const fg = spec.fgIds!["1"]!;
    const c = await withTenant(TENANT_M, () =>
      chain({ fgItemId: fg, lineQty: "10", moQtys: ["12"] }),
    );

    // The completion holds the ACTUAL 12 under the MTO reservation.
    const before = await withTenant(TENANT_M, () => census(fg));
    expect(before.active).toHaveLength(1);
    expect(before.active[0]!.holderType).toBe("PRODUCTION_ORDER");
    expect(before.active[0]!.qty).toBe("12.000000");

    await withTenant(TENANT_M, () =>
      deliver({
        salesOrderId: c.salesOrderId,
        customerId: c.customerId,
        fgLineId: c.fgLineId,
        fgItemId: fg,
        qty: "10",
        date: "2026-03-17",
      }),
    );

    // THE SURPLUS LAW: zero ACTIVE — the row that covered the shipment
    // stays ACTIVE at the surplus 2 after the partial settle, then the
    // fully-delivered finalization RELEASES it (never a leaked holder;
    // the row keeps its historical qty 12).
    const after = await withTenant(TENANT_M, () => census(fg));
    expect(after.active).toHaveLength(0);
    expect(after.consumed).toHaveLength(0);
    expect(after.released).toHaveLength(1);
    expect(after.released[0]!.holderType).toBe("PRODUCTION_ORDER");
    expect(after.released[0]!.qty).toBe("2.000000"); // the SURPLUS (12 − the 10 shipped)

    // FREE-STOCK PROOF: the 2 surplus units are available to any holder
    // again (the reservation pool is empty; the availability equals the
    // on-hand 2).
    const availability = await withTenant(TENANT_M, () =>
      invStore.reservationAvailability(fg, f.warehouseFg),
    );
    expect(availability!.available).toBe("2.000000");
    expect(Number(availability!.reserved)).toBe(0);
    // And a fresh holder may reserve them (the freedom is real, not just
    // a number): reserve 2 OK, a 3rd unit fails closed.
    const taken = await withTenant(TENANT_M, () =>
      reservations.create({
        itemId: fg,
        warehouseId: f.warehouseFg,
        qty: "2",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "the freed surplus, re-taken by another holder",
        actorId: M_ACTOR,
      }),
    );
    expect(taken.qty).toBe("2.000000");
    await withTenant(TENANT_M, async () => {
      await reservations.release(taken.id, M_ACTOR); // leave the pool clean for the suite
    });
  });

  it("MULTIPLE MOs for one line (6+6): the partial settles oldest-first, the repeat delivery finishes the line, the final surplus RELEASES", async () => {
    const fg = spec.fgIds!["2"]!;
    const c = await withTenant(TENANT_M, () =>
      chain({ fgItemId: fg, lineQty: "10", moQtys: ["6", "6"] }),
    );

    // Both MOs hold their own 6.
    const before = await withTenant(TENANT_M, () => census(fg));
    expect(before.active).toHaveLength(2);
    expect(before.active.map((row) => row.qty)).toEqual(["6.000000", "6.000000"]);

    // Deliver 4: the OLDEST MO settles first (ACTIVE at 2), the younger
    // MO untouched (ACTIVE at 6).
    await withTenant(TENANT_M, () =>
      deliver({
        salesOrderId: c.salesOrderId,
        customerId: c.customerId,
        fgLineId: c.fgLineId,
        fgItemId: fg,
        qty: "4",
        date: "2026-03-17",
      }),
    );
    const afterFirst = await withTenant(TENANT_M, () => census(fg));
    expect(afterFirst.active).toHaveLength(2);
    const oldest = afterFirst.active.find((row) => row.holderId === c.moIds[0])!;
    const youngest = afterFirst.active.find((row) => row.holderId === c.moIds[1])!;
    expect(oldest.qty).toBe("2.000000");
    expect(youngest.qty).toBe("6.000000");

    // The repeat 6 finishes the line (10/10): the oldest's remaining 2
    // consume (CONSUMED at its historical 6), the youngest's 4 consume
    // leaving its surplus 2… which the finalization RELEASES — zero
    // ACTIVE, exactly one CONSUMED (the oldest) and one RELEASED (the
    // youngest's surplus).
    await withTenant(TENANT_M, () =>
      deliver({
        salesOrderId: c.salesOrderId,
        customerId: c.customerId,
        fgLineId: c.fgLineId,
        fgItemId: fg,
        qty: "6",
        date: "2026-03-18",
      }),
    );
    const afterSecond = await withTenant(TENANT_M, () => census(fg));
    expect(afterSecond.active).toHaveLength(0);
    expect(afterSecond.consumed.map((row) => row.holderId)).toEqual([c.moIds[0]]);
    expect(afterSecond.released).toHaveLength(1);
    expect(afterSecond.released[0]!.holderId).toBe(c.moIds[1]);
  });

  it("CANCEL after completion, before delivery: the MTO reservation RELEASES (the made-for-order stock returns to the free pool)", async () => {
    const f = spec.fixture!;
    const fg = spec.fgIds!["3"]!;
    const c = await withTenant(TENANT_M, () =>
      chain({ fgItemId: fg, lineQty: "10", moQtys: ["12"] }),
    );

    const before = await withTenant(TENANT_M, () => census(fg));
    expect(before.active).toHaveLength(1);
    expect(before.active[0]!.qty).toBe("12.000000");

    await withTenant(TENANT_M, () =>
      salesOrdersSvc.cancel(c.salesOrderId, "customer cancelled before shipment", M_ACTOR),
    );

    // The order ships nothing more: the WHOLE 12 releases — free stock.
    const after = await withTenant(TENANT_M, () => census(fg));
    expect(after.active).toHaveLength(0);
    expect(after.released).toHaveLength(1);
    expect(after.released[0]!.holderType).toBe("PRODUCTION_ORDER");
    const availability = await withTenant(TENANT_M, () =>
      invStore.reservationAvailability(fg, f.warehouseFg),
    );
    expect(availability!.available).toBe("12.000000");
    expect(Number(availability!.reserved)).toBe(0);
  });

  it("PARTIAL delivery then CANCEL (and the CLOSE twin): the remaining MTO coverage releases, the already-shipped part stays consumed", async () => {
    const fg = spec.fgIds!["4"]!;
    const c = await withTenant(TENANT_M, () =>
      chain({ fgItemId: fg, lineQty: "10", moQtys: ["12"] }),
    );

    await withTenant(TENANT_M, () =>
      deliver({
        salesOrderId: c.salesOrderId,
        customerId: c.customerId,
        fgLineId: c.fgLineId,
        fgItemId: fg,
        qty: "4",
        date: "2026-03-17",
      }),
    );
    const afterPartial = await withTenant(TENANT_M, () => census(fg));
    expect(afterPartial.active).toHaveLength(1);
    expect(afterPartial.active[0]!.qty).toBe("8.000000");

    await withTenant(TENANT_M, () =>
      salesOrdersSvc.cancel(c.salesOrderId, "cancelled after partial delivery", M_ACTOR),
    );
    const afterCancel = await withTenant(TENANT_M, () => census(fg));
    expect(afterCancel.active).toHaveLength(0);
    expect(afterCancel.released).toHaveLength(1);
    expect(afterCancel.released[0]!.qty).toBe("8.000000"); // the remaining 12 − 4 shipped

    // The CLOSE twin: same shape through close() (ISSUED → CLOSED).
    const fgClose = spec.fgIds!["5"]!;
    const c2 = await withTenant(TENANT_M, () =>
      chain({
        fgItemId: fgClose,
        lineQty: "10",
        moQtys: ["10"],
        reserveOwn: { seedStock: "10" },
      }),
    );
    await withTenant(TENANT_M, () =>
      deliver({
        salesOrderId: c2.salesOrderId,
        customerId: c2.customerId,
        fgLineId: c2.fgLineId,
        fgItemId: fgClose,
        qty: "4",
        date: "2026-03-17",
      }),
    );
    // Both the MTO 10 and the line's OWN 10 sit ACTIVE pre-close.
    const beforeClose = await withTenant(TENANT_M, () => census(fgClose));
    expect(beforeClose.active).toHaveLength(2);
    await withTenant(TENANT_M, () => salesOrdersSvc.close(c2.salesOrderId, M_ACTOR));
    const afterClose = await withTenant(TENANT_M, () => census(fgClose));
    expect(afterClose.active).toHaveLength(0);
    expect(afterClose.released).toHaveLength(2); // the MTO remainder 6 + the own 10
  });

  it("THE MIXED CASE: the line's OWN reservation + MTO covering the shipment — the full delivery consumes the MTO stock, then BOTH remainders release (zero ACTIVE)", async () => {
    const f = spec.fixture!;
    const fg = spec.fgIds!["6"]!;
    const c = await withTenant(TENANT_M, () =>
      chain({
        fgItemId: fg,
        lineQty: "10",
        moQtys: ["12"],
        reserveOwn: { seedStock: "10" },
      }),
    );

    // Pre-delivery: the MTO 12 + the line's OWN 10 (backed by the
    // pre-seeded stock + the 12 the MO just landed = 22 on hand).
    const before = await withTenant(TENANT_M, () => census(fg));
    expect(before.active).toHaveLength(2);
    expect(
      before.active.filter((row) => row.holderType === "PRODUCTION_ORDER").map((row) => row.qty),
    ).toEqual(["12.000000"]);
    expect(
      before.active.filter((row) => row.holderType === "SALES_ORDER").map((row) => row.qty),
    ).toEqual(["10.000000"]);

    await withTenant(TENANT_M, () =>
      deliver({
        salesOrderId: c.salesOrderId,
        customerId: c.customerId,
        fgLineId: c.fgLineId,
        fgItemId: fg,
        qty: "10",
        date: "2026-03-19",
      }),
    );

    // The shipment settles MTO-first (10 of the 12); the line is fully
    // delivered → the finalization retires BOTH remainders: the MTO
    // surplus 2 AND the line's own 10 (its stock never ships).
    const after = await withTenant(TENANT_M, () => census(fg));
    expect(after.active).toHaveLength(0);
    expect(after.released.map((row) => row.holderType).sort()).toEqual(
      ["PRODUCTION_ORDER", "SALES_ORDER"],
    );
    // The order line's reservation link cleared with the release.
    const lineAfter = (await withTenant(TENANT_M, () =>
      salesStore.listSalesOrderLines(c.salesOrderId),
    ))[0]!;
    expect(lineAfter.reservationId).toBeNull();
    // FREE-STOCK PROOF: on-hand 12 (2 surplus + 10 never-shipped own
    // stock), the pool empty.
    const availability = await withTenant(TENANT_M, () =>
      invStore.reservationAvailability(fg, f.warehouseFg),
    );
    expect(availability!.available).toBe("12.000000");
    expect(Number(availability!.reserved)).toBe(0);
  });
});