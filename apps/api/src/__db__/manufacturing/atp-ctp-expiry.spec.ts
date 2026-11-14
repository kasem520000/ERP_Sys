import { beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as invStore from "../../modules/inventory/infrastructure/inventory.store";
import {
  M_ACTOR,
  TENANT_M,
  atpSrv,
  purchaseOrdersSvc,
  reservations,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-043 audit round 2, item 3 — the CTP coverage vs the BATCH
 * EXPIRY at every candidate date.
 *
 * The audit's finding (code-reading, reproduced here): the CTP walk
 * computed the shortfall against `availableNow` — the basis expiry-
 * filtered at the REQUESTED date — and then walked the dated legs
 * FORWARD, so a batch VALID AT THE REQUESTED DATE but EXPIRED BY A
 * LATER CANDIDATE DATE kept backing the promise: a demand of 20 with
 * 10 on hand (alive at the request, dead a few days later) plus an
 * inbound 10 produced the suggested date of the inbound — a date at
 * which only 10 units exist. The promise was a false one.
 *
 * THE LAW (implemented + asserted): coverage is computed PER CANDIDATE
 * DATE — at each dated leg's arrival date, the basis is expiry-aware
 * against THAT date (a batch dead by then never counts) plus the legs
 * arriving on/before it. The verdict at the requested date and the
 * `availableNow` field keep their meanings (the basis at the EFFECTIVE
 * REQUESTED date — documented as such: it is NOT "free stock today";
 * a batch alive today but dead by the promise date never appears in
 * it), the CTP suggestion never precedes the as-of date (a late open
 * PO's informative landing is floored to today — a promise never
 * back-dates, law 5's mirror), and reservations reduce the basis at
 * EVERY candidate date (the pool never frees by date).
 */

const spec: {
  fixture?: MfgFixture;
  a?: string;
  b?: string;
  c?: string;
  d?: string;
  e?: string;
  f?: string;
} = {};

function day(offset: number): string {
  return new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
    hasExpiry: true,
    shelfLifeDays: 365,
    reorderLevel: null,
    reorderQty: null,
    basePrice: null,
  });
  return created.id;
}

async function openPo(itemId: string, qty: string, expectedDate: string): Promise<void> {
  const f = spec.fixture!;
  const po = await purchaseOrdersSvc.create({
    branchId: f.branchId,
    supplierId: f.supplierId,
    orderDate: day(-10),
    expectedDate,
    currencyCode: "SAR",
    exchangeRate: null,
    note: "CTP expiry spec — the dated leg",
    noteAr: null,
    actorId: M_ACTOR,
    lines: [{ itemId, qty, unitPrice: null, taxCodeId: null, note: null }],
  });
  await purchaseOrdersSvc.submit(po.id, M_ACTOR);
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.a = await ensureItem("M-CE-A", "CTP expiry — the dying batch vs the inbound");
    spec.b = await ensureItem("M-CE-B", "CTP expiry — the late open PO");
    spec.c = await ensureItem("M-CE-C", "CTP expiry — the reserved pool");
    spec.d = await ensureItem("M-CE-D", "CTP expiry — the availableNow semantics");
    spec.e = await ensureItem("M-CE-E", "CTP expiry — the floor's coverage (the dead batch vs the floored date)");
    spec.f = await ensureItem("M-CE-F", "CTP expiry — the floor's coverage (the walk past the dead candidate)");
  });
});

describe("PHASE-043 audit round 2, item 3 — expiry-aware coverage at EVERY candidate date", () => {
  it("the audit's exact case: demand 20, 10 valid at the requested date but EXPIRED before the inbound of 10 — the suggested date is the date the FULL 20 exist, never the inbound covered by the dead batch", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // 10 units in a batch dying at day(5); an inbound 10 at day(10);
      // a second inbound 12 at day(15).
      await stock.manualReceipt({
        itemId: spec.a!,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(0),
        batchNo: `M-CE-A-DYING-${Date.now() % 100000}`,
        batchExpiry: day(5),
        actorId: M_ACTOR,
      });
      await openPo(spec.a!, "10", day(10));
      await openPo(spec.a!, "12", day(15));

      // Requested 20 at day(3): the basis at day(3) is the dying 10;
      // the coverage 10 < 20 → SHORT.
      const result = await atpSrv.check({
        itemId: spec.a!,
        warehouseId: f.warehouseFg,
        qty: "20",
        date: day(3),
      });
      expect(result.verdict).toBe("SHORT");
      expect(result.availableNow).toBe("10.000000"); // the basis at the requested date
      // THE LAW: at day(10) the batch is DEAD — only the inbound 10
      // exist there (10 < 20, NOT covered); at day(15) the cumulative
      // 10 + 12 = 22 ≥ 20 → the honest suggested date (pre-fix: the
      // walk answered day(10) — counting the dead batch as covering).
      expect(result.suggestedDate).toBe(day(15));
      // The evidence legs stay visible in date order.
      expect(result.incoming.map((leg) => [leg.kind, leg.date, leg.qty])).toEqual([
        ["OPEN_PO", day(10), "10.000000"],
        ["OPEN_PO", day(15), "12.000000"],
      ]);

      // The control: a request of 20 at day(15) is OK outright (both
      // legs land in time — and at day(15) the dead batch rightly
      // counts for nothing; the earliest FULL-coverage date is day(15)
      // itself: 10 + 12 = 22, the day(10) leg alone holds only 10).
      const at15 = await atpSrv.check({
        itemId: spec.a!,
        warehouseId: f.warehouseFg,
        qty: "20",
        date: day(15),
      });
      expect(at15.verdict).toBe("OK");
      expect(at15.suggestedDate).toBe(day(15)); // the earliest full coverage
    });
  });

  it("a LATE open PO (expected in the past, still open): it still backs the promise (it is dated supply), but the suggested date never back-dates — floored to the as-of date", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // No stock; the only supply is an open PO that was expected 3 days
      // ago and still has not landed.
      await openPo(spec.b!, "10", day(-3));

      const result = await atpSrv.check({
        itemId: spec.b!,
        warehouseId: f.warehouseFg,
        qty: "10",
        date: day(7),
      });
      // The dated leg arrives (nominally) before the requested date →
      // the coverage holds → OK (the leg's lateness is the buyer's
      // exception evidence, visible in the incoming list).
      expect(result.verdict).toBe("OK");
      expect(result.availableNow).toBe("0.000000");
      // THE FLOOR: the informative landing date is the LATE day(-3) — a
      // promise never back-dates, so the suggestion is TODAY (pre-fix:
      // the suggestion was the past date itself).
      expect(result.suggestedDate).toBe(day(0));
    });
  });

  it("RESERVATIONS reduce the basis at EVERY candidate date (the pool never frees by date)", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      await stock.manualReceipt({
        itemId: spec.c!,
        warehouseId: f.warehouseFg,
        qty: "20",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(0),
        batchNo: `M-CE-C-${Date.now() % 100000}`,
        batchExpiry: day(300),
        actorId: M_ACTOR,
      });
      const held = await reservations.create({
        itemId: spec.c!,
        warehouseId: f.warehouseFg,
        qty: "12",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "CTP expiry spec — the held pool",
        actorId: M_ACTOR,
      });

      // 10 promised later: the basis is 20 − 12 = 8 at ANY date → SHORT,
      // no suggested date (nothing incoming).
      const short = await atpSrv.check({
        itemId: spec.c!,
        warehouseId: f.warehouseFg,
        qty: "10",
        date: day(30),
      });
      expect(short.verdict).toBe("SHORT");
      expect(short.availableNow).toBe("8.000000");
      expect(short.suggestedDate).toBeNull();

      // The exact remainder 8 promises fine.
      const exact = await atpSrv.check({
        itemId: spec.c!,
        warehouseId: f.warehouseFg,
        qty: "8",
        date: day(30),
      });
      expect(exact.verdict).toBe("OK");

      await reservations.release(held.id, M_ACTOR); // clean the pool
    });
  });

  it("the availableNow SEMANTICS (documented law): it is the promiseable basis at the EFFECTIVE REQUESTED DATE — expiry-aware against THAT date, not 'free stock today'", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // Two batches: 10 dying at day(5), 10 alive through day(300).
      await stock.manualReceipt({
        itemId: spec.d!,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(0),
        batchNo: `M-CE-D-NEAR-${Date.now() % 100000}`,
        batchExpiry: day(5),
        actorId: M_ACTOR,
      });
      await stock.manualReceipt({
        itemId: spec.d!,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(0),
        batchNo: `M-CE-D-FAR-${Date.now() % 100000}`,
        batchExpiry: day(300),
        actorId: M_ACTOR,
      });

      // Promised at day(3): BOTH batches back it — the basis is 20.
      const near = await atpSrv.check({
        itemId: spec.d!,
        warehouseId: f.warehouseFg,
        qty: "15",
        date: day(3),
      });
      expect(near.availableNow).toBe("20.000000");
      expect(near.verdict).toBe("OK");

      // Promised at day(10): the near batch is dead by THEN — the basis
      // is 10 (NOT today's 20 — the field answers for the PROMISE DATE;
      // 15 units cannot promise).
      const later = await atpSrv.check({
        itemId: spec.d!,
        warehouseId: f.warehouseFg,
        qty: "15",
        date: day(10),
      });
      expect(later.availableNow).toBe("10.000000");
      expect(later.verdict).toBe("SHORT");
    });
  });

  it("THE FLOOR'S COVERAGE (the round-3 edge): a batch dead BEFORE the as-of date + a LATE inbound — the candidate is judged at the FLOORED date (today), where the batch is already dead: today is never the suggestion, and the walk continues to the first date the FULL qty actually exists", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async (tx) => {
      // E — the minimal case: 10 in a batch that died YESTERDAY (before
      // the as-of date), the only supply a LATE open PO of 10 expected
      // the day before — a RAW candidate date at which the batch was
      // still alive (10 + 10 = 20 covered). Demand 20.
      const eBatchNo = `M-CE-E-${Date.now() % 100000}`;
      await stock.manualReceipt({
        itemId: spec.e!,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(-3),
        batchNo: eBatchNo,
        batchExpiry: day(300),
        actorId: M_ACTOR,
      });
      const eBatch = (await invStore.findBatchByNo(spec.e!, eBatchNo))!;
      // The lapse (seed-only mutation — the reservation-basis spec's
      // honest pre-write-off state): the shelf date passed yesterday.
      await tx.execute(sql`UPDATE item_batches SET expiry_date = ${day(-1)} WHERE id = ${eBatch.id}`);
      await openPo(spec.e!, "10", day(-2));

      const result = await atpSrv.check({
        itemId: spec.e!,
        warehouseId: f.warehouseFg,
        qty: "20",
        date: day(7),
      });
      // At the requested date the basis is 0 — the batch is dead at
      // every date ≥ today → SHORT.
      expect(result.verdict).toBe("SHORT");
      expect(result.availableNow).toBe("0.000000");
      // THE LAW (the round-3 fix): the RAW candidate date (day(-2), the
      // late PO's landing) saw the batch ALIVE — 10 + 10 = 20 ≥ 20 — so
      // pre-fix the walk named it and the floor stamped TODAY as the
      // suggestion: a date at which only the late 10 exist (the batch
      // died yesterday — 10 < 20, a false promise). The coverage is
      // judged at the FLOORED date: today covers 10 < 20 → the candidate
      // is REFUSED, and with no further supply there is NO suggested
      // date (the honest "the horizon cannot cover it").
      expect(result.suggestedDate).toBeNull();
      expect(result.incoming.map((leg) => [leg.kind, leg.date, leg.qty])).toEqual([
        ["OPEN_PO", day(-2), "10.000000"],
      ]);

      // F — the walk-past variant: the SAME dead batch + the SAME late
      // 10, plus a FUTURE inbound 12 at day(15). The walk refuses the
      // dead floored candidate and lands on the first date the FULL 20
      // exist (10 + 12 = 22 at day(15)) — never today, never day(-2).
      const fBatchNo = `M-CE-F-${Date.now() % 100000}`;
      await stock.manualReceipt({
        itemId: spec.f!,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(-3),
        batchNo: fBatchNo,
        batchExpiry: day(300),
        actorId: M_ACTOR,
      });
      const fBatch = (await invStore.findBatchByNo(spec.f!, fBatchNo))!;
      await tx.execute(sql`UPDATE item_batches SET expiry_date = ${day(-1)} WHERE id = ${fBatch.id}`);
      await openPo(spec.f!, "10", day(-2));
      await openPo(spec.f!, "12", day(15));

      const walk = await atpSrv.check({
        itemId: spec.f!,
        warehouseId: f.warehouseFg,
        qty: "20",
        date: day(7),
      });
      expect(walk.verdict).toBe("SHORT");
      expect(walk.availableNow).toBe("0.000000");
      // At today (the floored first candidate) only 10 exist → refused;
      // at day(15) the cumulative 10 + 12 = 22 ≥ 20 → the honest date.
      expect(walk.suggestedDate).toBe(day(15));
      expect(walk.incoming.map((leg) => [leg.kind, leg.date, leg.qty])).toEqual([
        ["OPEN_PO", day(-2), "10.000000"],
        ["OPEN_PO", day(15), "12.000000"],
      ]);
    });
  });
});
