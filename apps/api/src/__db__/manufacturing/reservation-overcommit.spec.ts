import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import {
  ReservationQtyExceedsAvailableError,
} from "../../modules/inventory/domain/inventory-errors";
import {
  M_ACTOR,
  TENANT_M,
  reservationPolicy,
  reservations,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-043 audit item 5 — the over-reservation guard.
 *
 * The audit's finding (confirmed by code reading, then practically):
 * reserveForHolder verified against RAW bin quantities — the ACTIVE
 * reservation pool already drawn against the same stock was never
 * subtracted, and nothing serialized two concurrent reserves — so stock
 * 10 could be reserved 6 + 6 (12 on 10). The manual controller route was
 * worse: the raw ReservationService.create carried NO availability check
 * at all. Unbinned stock (item_stock rows with no bin_contents) was
 * invisible to the policy walk entirely.
 *
 * THE FIX — the single creation choke point: every reservation creation
 * (the policy engine, the manual route, the MTO completion) rides
 * ReservationService.create, which now locks the item_stock row FIRST
 * (concurrent reserves of the same stock serialize there), then reads
 * the reserved pool INSIDE the lock and fails closed with the typed
 * ReservationQtyExceedsAvailableError when the new reservation would
 * take the pool beyond: pickable bins + the unbinned fallback − the
 * ACTIVE non-expired pool. The policy engine's early walk subtracts the
 * pool too (the honest strategy message); the choke point enforces the
 * invariant either way.
 */

const spec: { fixture?: MfgFixture; item?: string } = {};

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

/** Seed `qty` units at the FG warehouse (bin-distributed — the lazy
 * DEFAULT-bin materialization, so the pickable walk sees them). */
async function seedAtFg(itemId: string, qty: string, batchNo: string): Promise<void> {
  await stock.manualReceipt({
    itemId,
    warehouseId: spec.fixture!.warehouseFg,
    qty,
    unitCost: "2.000000",
    reason: "COUNT_GAIN",
    counterAccountId: null,
    valueDate: "2026-03-01",
    batchNo,
    batchExpiry: "2027-01-01",
    actorId: M_ACTOR,
  });
}

/** The ACTIVE reserved pool for the item at the FG warehouse — read
 * through the CALLER's ambient transaction (never a nested one: a nested
 * withTenant opens its own connection and cannot see the caller's
 * uncommitted writes). */
async function activePool(itemId: string): Promise<string> {
  const invStore = await import("../../modules/inventory/infrastructure/inventory.store");
  return invStore.reservedQty(itemId, spec.fixture!.warehouseFg);
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.item = await ensureItem("M-OVR-ITEM", "Over-reservation guard item");
  });
});

describe("PHASE-043 audit item 5 — the over-reservation guard (one choke point, locked)", () => {
  it("sequential 10/6/6 through the POLICY ENGINE: the second 6 fails closed — the pool never exceeds the stock", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      await seedAtFg(spec.item!, "10", `M-OVR-A-${Date.now() % 100000}`);
      // Reserve 6 — fine (pickable 10 − reserved 0 = 10 ≥ 6).
      const first = await reservationPolicy.reserveForHolder({
        itemId: spec.item!,
        warehouseId: f.warehouseFg,
        qty: "6",
        holderType: "SALES_ORDER",
        holderId: null,
        note: "overcommit — first 6",
        actorId: M_ACTOR,
      });
      expect(first.strategy).toBe("FIFO");
      // Reserve 6 MORE on the same 10 — the pool (6) + 6 > 10: the typed
      // rejection, never a second reservation.
      await expect(
        reservationPolicy.reserveForHolder({
          itemId: spec.item!,
          warehouseId: f.warehouseFg,
          qty: "6",
          holderType: "SALES_ORDER",
          holderId: null,
          note: "overcommit — the second 6 must fail",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(Error);
      // The pool is exactly 6 — not 12.
      expect(await activePool(spec.item!)).toBe("6.000000");
    });
  });

  it("sequential 10/6/6 through the RAW service (the manual controller route): the same typed guard", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // A fresh item so the pools never mix (the previous test's 6 still
      // holds on the first item).
      const second = await ensureItem("M-OVR-ITEM2", "Over-reservation guard item 2");
      await seedAtFg(second, "10", `M-OVR-B-${Date.now() % 100000}`);
      await reservations.create({
        itemId: second,
        warehouseId: f.warehouseFg,
        qty: "6",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "manual route — first 6",
        actorId: M_ACTOR,
      });
      await expect(
        reservations.create({
          itemId: second,
          warehouseId: f.warehouseFg,
          qty: "6",
          holderType: "MANUAL",
          holderId: null,
          expiresAt: null,
          note: "manual route — the second 6 must fail",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationQtyExceedsAvailableError);
      // The remaining 4 IS reservable — the guard fails closed on the
      // excess, never on the legitimate remainder.
      await reservations.create({
        itemId: second,
        warehouseId: f.warehouseFg,
        qty: "4",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "manual route — the exact remainder",
        actorId: M_ACTOR,
      });
    });
  });

  it("CONCURRENT reserves serialize on the item_stock lock: exactly one 6 wins, the loser fails closed, the pool stays at 6", async () => {
    const f = spec.fixture!;
    const third = await withTenant(TENANT_M, () =>
      ensureItem("M-OVR-ITEM3", "Over-reservation guard item 3"),
    );
    await withTenant(TENANT_M, async () => {
      await seedAtFg(third, "10", `M-OVR-C-${Date.now() % 100000}`);
    });
    const settled = await Promise.allSettled([
      withTenant(TENANT_M, () =>
        reservationPolicy.reserveForHolder({
          itemId: third,
          warehouseId: f.warehouseFg,
          qty: "6",
          holderType: "SALES_ORDER",
          holderId: null,
          note: "concurrent A",
          actorId: M_ACTOR,
        }),
      ),
      withTenant(TENANT_M, () =>
        reservationPolicy.reserveForHolder({
          itemId: third,
          warehouseId: f.warehouseFg,
          qty: "6",
          holderType: "SALES_ORDER",
          holderId: null,
          note: "concurrent B",
          actorId: M_ACTOR,
        }),
      ),
    ]);
    const outcomes = settled.map((s) => s.status).sort();
    expect(outcomes).toEqual(["fulfilled", "rejected"]);
    // The pool is exactly 6 — the loser's insert rolled back with its
    // throw (one UoW), never a 12-on-10 over-book.
    const pool = await withTenant(TENANT_M, async () => {
      const invStore = await import("../../modules/inventory/infrastructure/inventory.store");
      return invStore.reservedQty(third, f.warehouseFg);
    });
    expect(pool).toBe("6.000000");
  });

  it("UNBINNED stock counts: an item_stock row with NO bin_contents reserves through the fallback (and over-books fail there too)", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async (tx) => {
      const unbinned = await ensureItem("M-OVR-UNBIN", "Over-reservation unbinned item");
      // The pre-WMS shape: an item_stock row with no bin_contents at all
      // (the ambient transaction's own handle — the backfill-spec pattern).
      await tx.execute(sql`
        INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${unbinned}, ${f.warehouseFg}, 10, 2.500000)
        ON CONFLICT DO NOTHING`);
      // The raw walk sees NO bins — the unbinned fallback carries the 10.
      const first = await reservations.create({
        itemId: unbinned,
        warehouseId: f.warehouseFg,
        qty: "6",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "unbinned — first 6",
        actorId: M_ACTOR,
      });
      expect(first.qty).toBe("6.000000");
      // 6 more exceeds the unbinned 10 − 6: the typed rejection.
      await expect(
        reservations.create({
          itemId: unbinned,
          warehouseId: f.warehouseFg,
          qty: "6",
          holderType: "MANUAL",
          holderId: null,
          expiresAt: null,
          note: "unbinned — the second 6 must fail",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationQtyExceedsAvailableError);
    });
  });

  it("no stock row at all: the typed rejection (nothing was ever received there — nothing to reserve)", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      const empty = await ensureItem("M-OVR-EMPTY", "Over-reservation empty item");
      await expect(
        reservations.create({
          itemId: empty,
          warehouseId: f.warehouseFg,
          qty: "1",
          holderType: "MANUAL",
          holderId: null,
          expiresAt: null,
          note: "empty — must fail",
          actorId: M_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ReservationQtyExceedsAvailableError);
    });
  });
});
