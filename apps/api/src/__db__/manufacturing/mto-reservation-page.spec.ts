import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as invStore from "../../modules/inventory/infrastructure/inventory.store";
import * as salesStore from "../../modules/sales/infrastructure/sales.store";
import { SalesOrderService } from "../../modules/sales/application/orders";
import { AtpService } from "../../modules/manufacturing/application/atp-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
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
 * PHASE-043 audit round 3 — the RESERVATION QUERY LIMITS (the owner's
 * unproven observation, proven here on the live DB first).
 *
 * The finding (code reading, then practically): the MTO settlement fold
 * `listActiveMtoReservationsForSalesLine` — the ONE input of the delivery
 * settlement (step 5a), the fully-delivered finalization (5c), and the
 * order-side terminations (cancel/close) — composed TWO PAGINATED reads:
 *   - listProductionOrders(salesOrderLineId, limit 100) — OLDEST-first;
 *   - invStore.listReservations(itemId, warehouse, ACTIVE, limit 500) —
 *     CLAMPED TO 200 BY THE STORE, NEWEST-first.
 * A busy item's MTO holder therefore fell off EITHER page, and the fold
 * returned NOTHING for it: the settlement retired nothing, the cancel
 * released nothing — the holder leaked ACTIVE forever, permanently
 * netting availability (the round-2 item-1 leak family, resurrected
 * through the pagination door).
 *
 * THE TWO ARMS (both pre-fix proofs, both deterministic — each withTenant
 * block is ONE transaction, and PostgreSQL now() is the TRANSACTION-START
 * timestamp, so rows created in SEPARATE sequential transactions carry
 * strictly increasing created_at):
 *
 * (a) THE 200-RESERVATION PAGE: the MTO holder (created at the MO's
 *     completion) + 201 NEWER manual reservations at the same
 *     (item, warehouse) — the newest-200 page holds only manual rows;
 *     the holder is invisible to the fold; the order's CANCEL releases
 *     nothing for it.
 *
 * (b) THE 100-MO PAGE: 100 filler DRAFT MOs linked to the line (the
 *     oldest 100 — the ASC page keeps THEM) + the victim MO completed
 *     LAST (the 101st, strictly newer) — the victim never enters the
 *     fold's MO set; its holder is filtered out by holderId; the CANCEL
 *     releases nothing for it.
 *
 * THE LAW (implemented): ONE EXACT JOIN — listActiveMtoHolderReservationsForLine
 * (the manufacturing store): every ACTIVE PRODUCTION_ORDER-holder
 * reservation whose production order is linked to the line, oldest MO
 * first, NO LIMIT, NO page: a line's MTO chain is business-bounded, and
 * the settlement must see ALL of it.
 */

const specAudit = new AuditService(new DrizzleAuditStore());
const specNumbering = new NumberingService(specAudit);
const salesOrdersSvc = new SalesOrderService(specAudit, specNumbering, new AtpService());

interface PageItems {
  mat: string;
  a: string; // arm (a) — the 200-reservation page
  b: string; // arm (b) — the 100-MO page
}

const spec: {
  fixture?: MfgFixture;
  items?: PageItems;
  bomIds?: Map<string, string>;
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

/** A BOM (mat ×1) for one FG item — the arm's chains release against it. */
async function ensureBom(fgItemId: string, matItemId: string): Promise<string> {
  const draft = await boms.create({
    itemId: fgItemId,
    outputUomId: (await itemsStore.findItemById(fgItemId))!.uomId,
    yieldPct: "100.0000",
    mainAllocationPct: "100.0000",
    note: `MTO reservation-page BOM ${Date.now() % 100000}`,
    noteAr: null,
    actorId: M_ACTOR,
    lines: [{ componentItemId: matItemId, qtyPerOutput: "1.000000", scrapPct: "0" }],
  });
  const active = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
  return active.id;
}

/** An ISSUED sales order with ONE FG line (qty) — the arm's dying order. */
async function issuedOrder(fgItemId: string, qty: string): Promise<{
  salesOrderId: string;
  fgLineId: string;
}> {
  const f = spec.fixture!;
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
    note: "MTO reservation-page order",
    noteAr: null,
    actorId: null,
    totalNet: new Decimal(qty).times(10).toFixed(4),
    totalTax: "0.0000",
    totalGross: new Decimal(qty).times(10).toFixed(4),
    lines: [
      {
        itemId: fgItemId,
        description: "reservation-page FG line",
        descriptionAr: null,
        qty,
        unitPrice: "10.000000",
        discountAmount: "0.000000",
        taxCodeId: f.taxCodeIds.notSubject,
        netAmount: new Decimal(qty).times(10).toFixed(4),
        taxAmount: "0.0000",
        note: null,
      },
    ],
  });
  await salesOrdersSvc.submit(salesOrder.id, M_ACTOR);
  await salesOrdersSvc.approve(salesOrder.id, M_ACTOR);
  await salesOrdersSvc.issue(salesOrder.id, M_ACTOR);
  const line = (await salesStore.listSalesOrderLines(salesOrder.id))[0]!;
  return { salesOrderId: salesOrder.id, fgLineId: line.id };
}

/** One linked, COMPLETED MO (release → start → consume → complete) — the
 * holder's creation. Returns the MO id. */
async function completedLinkedMo(input: {
  fgItemId: string;
  bomId: string;
  fgLineId: string;
  qty: string;
}): Promise<string> {
  const f = spec.fixture!;
  const order = await orders.create({
    branchId: f.branchId,
    itemId: input.fgItemId,
    bomId: input.bomId,
    plannedQty: input.qty,
    plannedDate: "2026-03-18",
    materialsWarehouseId: f.warehouseRaw,
    fgWarehouseId: f.warehouseFg,
    laborRate: "0",
    overheadRate: "0",
    costCenterId: null,
    note: "MTO reservation-page order",
    noteAr: null,
    actorId: M_ACTOR,
  });
  await orders.linkSalesOrder(order.id, { salesOrderLineId: input.fgLineId, actorId: M_ACTOR });
  await orders.release(order.id, M_ACTOR);
  await orders.start(order.id, M_ACTOR);
  await orders.consume(order.id, {
    lines: [{ itemId: spec.items!.mat, qty: input.qty }],
    consumedAt: "2026-03-15",
    note: null,
    noteAr: null,
    actorId: M_ACTOR,
  });
  const completed = await orders.complete(order.id, {
    actualQty: input.qty,
    completedAt: "2026-03-16",
    actorId: M_ACTOR,
  });
  expect(completed.order.status).toBe("COMPLETED");
  return order.id;
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    const mat = await ensureItem("M-PG-MAT", "MTO reservation-page material");
    const a = await ensureItem("M-PG-A", "MTO reservation-page FG (the 200-page arm)");
    const b = await ensureItem("M-PG-B", "MTO reservation-page FG (the 100-MO arm)");
    spec.items = { mat, a, b };
    spec.bomIds = new Map<string, string>([
      [a, await ensureBom(a, mat)],
      [b, await ensureBom(b, mat)],
    ]);
    // The material for every arm's consumption (20 units covers both).
    await stock.manualReceipt({
      itemId: mat,
      warehouseId: spec.fixture!.warehouseRaw,
      qty: "20",
      unitCost: "4.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-03-01",
      batchNo: `M-PG-MAT-${Date.now() % 100000}`,
      batchExpiry: "2027-01-01",
      actorId: M_ACTOR,
    });
  });
});

describe("PHASE-043 audit round 3 — the reservation query limits (the settlement sees the WHOLE MTO chain, never a page)", () => {
  it("arm (a) — THE 200-RESERVATION PAGE: 201 newer manual reservations push the MTO holder off the newest-200 page; the order's CANCEL still releases it (pre-fix: the holder leaked ACTIVE forever)", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    // tx1 — the chain: the order, the linked completed MO (the holder
    // 10 ACTIVE), and the free stock the manuals will hold against.
    const { salesOrderId, fgLineId, holderId } = await withTenant(TENANT_M, async () => {
      const { salesOrderId, fgLineId } = await issuedOrder(s.a, "10");
      await stock.manualReceipt({
        itemId: s.a,
        warehouseId: f.warehouseFg,
        qty: "300",
        unitCost: "4.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-03-01",
        batchNo: `M-PG-A-FREE-${Date.now() % 100000}`,
        batchExpiry: "2027-01-01",
        actorId: M_ACTOR,
      });
      const moId = await completedLinkedMo({ fgItemId: s.a, bomId: spec.bomIds!.get(s.a)!, fgLineId, qty: "10" });
      const holder = (await invStore.listReservations({
        itemId: s.a,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 100,
      })).find((row) => row.holderType === "PRODUCTION_ORDER" && row.holderId === moId);
      expect(holder).toBeDefined();
      expect(holder!.qty).toBe("10.000000");
      return { salesOrderId, fgLineId, holderId: holder!.id };
    });

    // tx2 — 201 NEWER manual reservations of 1 unit each (a strictly
    // later transaction ⇒ strictly later created_at — deterministic).
    await withTenant(TENANT_M, async () => {
      for (let index = 0; index < 201; index += 1) {
        await reservations.create({
          itemId: s.a,
          warehouseId: f.warehouseFg,
          qty: "1",
          holderType: "MANUAL",
          holderId: null,
          expiresAt: null,
          note: `reservation-page arm (a) — the crowd ${index}`,
          actorId: M_ACTOR,
        });
      }
    });

    // tx3 — the mechanism made visible: the store's page (the fold's
    // pre-fix input) is CLAMPED to 200 newest-first and the holder —
    // the OLDEST ACTIVE row of the 202 — is NOT in it.
    await withTenant(TENANT_M, async () => {
      const page = await invStore.listReservations({
        itemId: s.a,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 500, // the fold's exact pre-fix call — clamped to 200
      });
      expect(page).toHaveLength(200);
      expect(page.some((row) => row.id === holderId)).toBe(false); // off the page
    });

    // tx4 — the CANCEL. THE LAW: the settlement sees the WHOLE chain —
    // the holder RELEASES and the made-for-order stock returns to the
    // free pool. Pre-fix: the fold's page held no PRODUCTION_ORDER row
    // for the line → nothing released → the holder stayed ACTIVE.
    await withTenant(TENANT_M, async () => {
      const cancelled = await salesOrdersSvc.cancel(
        salesOrderId,
        "the reservation-page arm (a) cancel",
        M_ACTOR,
      );
      expect(cancelled.status).toBe("CANCELLED");

      const holder = await reservations.find(holderId);
      expect(holder.status).toBe("RELEASED"); // pre-fix: 'ACTIVE' — the leak

      // The freed 10 recover in availability: 310 on hand (300 seeded +
      // 10 produced) − 201 held by the crowd = 109 (pre-fix: 99 — the
      // leaked 10 netted forever).
      const availability = await invStore.reservationAvailability(s.a, f.warehouseFg);
      expect(availability!.available).toBe("109.000000");
    });
  });

  it("arm (b) — THE 100-MO PAGE: 100 filler DRAFT MOs keep the victim MO off the oldest-100 page; the order's CANCEL still releases its holder (pre-fix: the victim's holder leaked ACTIVE forever)", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    // tx1 — the order + the 100 FILLER DRAFT MOs linked to its line (the
    // oldest 100 by created_at — the ASC page keeps exactly them).
    const { salesOrderId, fgLineId } = await withTenant(TENANT_M, async () => {
      const { salesOrderId, fgLineId } = await issuedOrder(s.b, "10");
      for (let index = 0; index < 100; index += 1) {
        const filler = await orders.create({
          branchId: f.branchId,
          itemId: s.b,
          bomId: spec.bomIds!.get(s.b)!,
          plannedQty: "1",
          plannedDate: "2026-03-25",
          materialsWarehouseId: f.warehouseRaw,
          fgWarehouseId: f.warehouseFg,
          laborRate: "0",
          overheadRate: "0",
          costCenterId: null,
          note: `reservation-page arm (b) — filler ${index}`,
          noteAr: null,
          actorId: M_ACTOR,
        });
        await orders.linkSalesOrder(filler.id, { salesOrderLineId: fgLineId, actorId: M_ACTOR });
      }
      return { salesOrderId, fgLineId };
    });

    // tx2 — the VICTIM MO, created LAST (a strictly later transaction ⇒
    // the 101st by created_at — beyond the oldest-100 page), completed:
    // its holder 10 is the line's only real coverage.
    const victimHolderId = await withTenant(TENANT_M, async () => {
      const moId = await completedLinkedMo({
        fgItemId: s.b,
        bomId: spec.bomIds!.get(s.b)!,
        fgLineId,
        qty: "10",
      });
      const holder = (await invStore.listReservations({
        itemId: s.b,
        warehouseId: f.warehouseFg,
        status: "ACTIVE",
        limit: 100,
      })).find((row) => row.holderType === "PRODUCTION_ORDER" && row.holderId === moId);
      expect(holder).toBeDefined();
      expect(holder!.qty).toBe("10.000000");
      return holder!.id;
    });

    // tx3 — the CANCEL. THE LAW: the exact read carries the victim's
    // holder regardless of the MO crowd — it RELEASES. Pre-fix: the
    // fold's MO set was the oldest-100 fillers; the victim's holderId
    // never matched → nothing released → ACTIVE forever.
    await withTenant(TENANT_M, async () => {
      const cancelled = await salesOrdersSvc.cancel(
        salesOrderId,
        "the reservation-page arm (b) cancel",
        M_ACTOR,
      );
      expect(cancelled.status).toBe("CANCELLED");

      const holder = await reservations.find(victimHolderId);
      expect(holder.status).toBe("RELEASED"); // pre-fix: 'ACTIVE' — the leak

      // The freed 10 recover: 10 produced on hand − 0 held = 10.
      const availability = await invStore.reservationAvailability(s.b, f.warehouseFg);
      expect(availability!.available).toBe("10.000000");
    });
  });
});
