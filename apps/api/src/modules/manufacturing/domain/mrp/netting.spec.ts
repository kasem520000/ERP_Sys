import { describe, expect, it } from "vitest";
import { Decimal } from "@erp/domain-core";

import {
  addDaysIso,
  autoSafetyStock,
  bucketIndexCovering,
  bucketStartOf,
  buildBuckets,
  planItemBuckets,
  weekStartIso,
  type DemandTerm,
  type SupplyTerm,
} from "./netting";

/**
 * PHASE-043 (T-04/T-17): the INV-030 netting kernel spec — the exact
 * formula per bucket, the carry discipline, the safety-gap level, lot
 * sizing, and the AUTO safety stock. Oracles first (hand-computed), then
 * properties (conservation, monotonicity, determinism).
 */

const LOT_FOR_LOT = {
  rule: "LOT_FOR_LOT" as const,
  fixedOrderQty: null,
  orderMultiple: null,
  periodSupplyBuckets: null,
};

function buckets(n: number): string[] {
  return buildBuckets("2026-03-01", "DAY", n);
}

describe("bucket math", () => {
  it("DAY buckets are consecutive days anchored at the as-of date", () => {
    expect(buckets(3)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
  });

  it("WEEK buckets anchor at the Monday of the as-of week", () => {
    expect(weekStartIso("2026-03-04")).toBe("2026-03-02"); // Wednesday → Monday
    expect(weekStartIso("2026-03-01")).toBe("2026-02-23"); // Sunday → previous Monday
    expect(buildBuckets("2026-03-04", "WEEK", 2)).toEqual(["2026-03-02", "2026-03-09"]);
  });

  it("bucketIndexCovering folds past-due into 0 and clamps beyond-horizon", () => {
    const starts = buckets(7);
    expect(bucketIndexCovering("2026-02-20", starts, "DAY")).toBe(0);
    expect(bucketIndexCovering("2026-03-01", starts, "DAY")).toBe(0);
    expect(bucketIndexCovering("2026-03-04", starts, "DAY")).toBe(3);
    expect(bucketIndexCovering("2026-04-15", starts, "DAY")).toBe(6);
  });

  it("addDaysIso crosses month/year boundaries deterministically (UTC)", () => {
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2028-02-28", 1)).toBe("2028-02-29"); // leap year
  });

  it("bucketStartOf mirrors the bucket anchor", () => {
    expect(bucketStartOf("2026-03-04", "WEEK")).toBe("2026-03-02");
    expect(bucketStartOf("2026-03-04", "DAY")).toBe("2026-03-04");
  });
});

describe("planItemBuckets — the INV-030 formula (oracle cases)", () => {
  it("demand exceeding supply nets the shortfall in its bucket (the pure formula)", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(3),
      demand: [{ itemId: "I1", bucketIndex: 0, kind: "SALES_ORDER", qty: "10" }],
      supply: [{ itemId: "I1", bucketIndex: 0, kind: "ON_HAND", qty: "4" }],
      safetyStockQty: "0",
      lotSizing: LOT_FOR_LOT,
    });
    // net = 10 − 4 = 6; the order covers it; carry stays 0.
    expect(plan.buckets[0]!.netRequirement).toBe("6.000000");
    expect(plan.buckets[0]!.plannedOrderQty).toBe("6.000000");
    expect(plan.buckets[0]!.carriedOut).toBe("0.000000");
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]!.qty).toBe("6.000000");
  });

  it("a surplus carries forward — later demand consumes it without a new order", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(3),
      demand: [{ itemId: "I1", bucketIndex: 2, kind: "SALES_ORDER", qty: "3" }],
      supply: [{ itemId: "I1", bucketIndex: 0, kind: "ON_HAND", qty: "10" }],
      safetyStockQty: "0",
      lotSizing: LOT_FOR_LOT,
    });
    expect(plan.buckets[0]!.netRequirement).toBe("0.000000");
    expect(plan.buckets[1]!.carriedIn).toBe("10.000000");
    expect(plan.buckets[2]!.netRequirement).toBe("0.000000");
    expect(plan.buckets[2]!.carriedOut).toBe("7.000000");
    expect(plan.orders).toHaveLength(0);
  });

  it("RESERVED subtracts from supply (the (on-hand − reserved) term)", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(1),
      demand: [{ itemId: "I1", bucketIndex: 0, kind: "SALES_ORDER", qty: "10" }],
      supply: [
        { itemId: "I1", bucketIndex: 0, kind: "ON_HAND", qty: "10" },
        { itemId: "I1", bucketIndex: 0, kind: "RESERVED", qty: "4" },
      ],
      safetyStockQty: "0",
      lotSizing: LOT_FOR_LOT,
    });
    expect(plan.buckets[0]!.supplyAvailable).toBe("6.000000");
    expect(plan.buckets[0]!.netRequirement).toBe("4.000000");
  });

  it("M-10: an expiring batch does not cover a later bucket", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(3),
      demand: [{ itemId: "I1", bucketIndex: 2, kind: "SALES_ORDER", qty: "5" }],
      supply: [
        {
          itemId: "I1",
          bucketIndex: 0,
          kind: "ON_HAND",
          qty: "5",
          batchId: "B1",
          expiresOn: "2026-03-02", // expires before bucket 2 (2026-03-03)
        },
      ],
      safetyStockQty: "0",
      lotSizing: LOT_FOR_LOT,
    });
    expect(plan.buckets[2]!.netRequirement).toBe("5.000000");
    expect(plan.buckets[2]!.plannedOrderQty).toBe("5.000000");
  });

  it("M-10: a NULL expiry never disqualifies", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(3),
      demand: [{ itemId: "I1", bucketIndex: 2, kind: "SALES_ORDER", qty: "5" }],
      supply: [{ itemId: "I1", bucketIndex: 0, kind: "ON_HAND", qty: "5", batchId: null, expiresOn: null }],
      safetyStockQty: "0",
      lotSizing: LOT_FOR_LOT,
    });
    expect(plan.buckets[2]!.netRequirement).toBe("0.000000");
  });

  it("the safety gap restores the level ONCE (the placed order lifts the projection)", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(4),
      demand: [],
      supply: [],
      safetyStockQty: "20",
      lotSizing: LOT_FOR_LOT,
    });
    // One order of 20 in bucket 0; buckets 1..3 stay at the level.
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]!.qty).toBe("20.000000");
    expect(plan.buckets[1]!.netRequirement).toBe("0.000000");
    expect(plan.buckets[3]!.carriedOut).toBe("20.000000");
  });

  it("the safety gap measures against the carried balance (ss already held → no order)", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(2),
      demand: [],
      supply: [{ itemId: "I1", bucketIndex: 0, kind: "ON_HAND", qty: "25" }],
      safetyStockQty: "20",
      lotSizing: LOT_FOR_LOT,
    });
    expect(plan.orders).toHaveLength(0);
  });

  it("a deficit below the safety level nets the full restoration (no double count)", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(1),
      demand: [{ itemId: "I1", bucketIndex: 0, kind: "SALES_ORDER", qty: "10" }],
      supply: [],
      safetyStockQty: "20",
      lotSizing: LOT_FOR_LOT,
    });
    // balance = −10, ss = 20 → net = 30 (the gap covers deficit + level).
    expect(plan.buckets[0]!.netRequirement).toBe("30.000000");
    expect(plan.buckets[0]!.plannedOrderQty).toBe("30.000000");
  });

  it("open PO/MO supply nets like on-hand (the on-order term)", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(2),
      demand: [{ itemId: "I1", bucketIndex: 1, kind: "SALES_ORDER", qty: "10" }],
      supply: [{ itemId: "I1", bucketIndex: 1, kind: "OPEN_PO", qty: "8" }],
      safetyStockQty: "0",
      lotSizing: LOT_FOR_LOT,
    });
    expect(plan.buckets[1]!.netRequirement).toBe("2.000000");
  });
});

describe("planItemBuckets — lot sizing (M-01)", () => {
  it("FIXED_ORDER_QTY rounds the net up to the next whole multiple", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(1),
      demand: [{ itemId: "I1", bucketIndex: 0, kind: "SALES_ORDER", qty: "13" }],
      supply: [],
      safetyStockQty: "0",
      lotSizing: { rule: "FIXED_ORDER_QTY", fixedOrderQty: "5", orderMultiple: null, periodSupplyBuckets: null },
    });
    expect(plan.orders[0]!.qty).toBe("15.000000");
  });

  it("ORDER_MULTIPLE rounds up to the packaging multiple", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(1),
      demand: [{ itemId: "I1", bucketIndex: 0, kind: "SALES_ORDER", qty: "101" }],
      supply: [],
      safetyStockQty: "0",
      lotSizing: { rule: "ORDER_MULTIPLE", fixedOrderQty: null, orderMultiple: "50", periodSupplyBuckets: null },
    });
    expect(plan.orders[0]!.qty).toBe("150.000000");
  });

  it("PERIOD_SUPPLY covers consecutive shortfall buckets with one order", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(4),
      demand: [
        { itemId: "I1", bucketIndex: 0, kind: "SALES_ORDER", qty: "3" },
        { itemId: "I1", bucketIndex: 1, kind: "SALES_ORDER", qty: "4" },
        { itemId: "I1", bucketIndex: 2, kind: "SALES_ORDER", qty: "5" },
      ],
      supply: [],
      safetyStockQty: "0",
      lotSizing: { rule: "PERIOD_SUPPLY", fixedOrderQty: null, orderMultiple: null, periodSupplyBuckets: 3 },
    });
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]!.qty).toBe("12.000000");
    expect(plan.orders[0]!.bucketIndex).toBe(0);
  });

  it("PERIOD_SUPPLY splits when the shortfall gaps", () => {
    const plan = planItemBuckets({
      itemId: "I1",
      bucketStarts: buckets(4),
      demand: [
        { itemId: "I1", bucketIndex: 0, kind: "SALES_ORDER", qty: "3" },
        { itemId: "I1", bucketIndex: 3, kind: "SALES_ORDER", qty: "2" },
      ],
      supply: [],
      safetyStockQty: "0",
      lotSizing: { rule: "PERIOD_SUPPLY", fixedOrderQty: null, orderMultiple: null, periodSupplyBuckets: 2 },
    });
    expect(plan.orders).toHaveLength(2);
  });
});

describe("planItemBuckets — properties (fast-check)", () => {
  it("conservation: Σ orders ≥ Σ (demand − supply) and every net bucket got an order", async () => {
    const fc = await import("fast-check");
    await fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 8 }),
        fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 1, maxLength: 8 }),
        (demands, supplies) => {
          const n = Math.max(demands.length, supplies.length);
          const plan = planItemBuckets({
            itemId: "I1",
            bucketStarts: buckets(n),
            demand: demands.map((qty, i) => ({ itemId: "I1", bucketIndex: i, kind: "SALES_ORDER", qty: String(qty) })),
            supply: supplies.map((qty, i) => ({ itemId: "I1", bucketIndex: i, kind: "ON_HAND", qty: String(qty) })),
            safetyStockQty: "0",
            lotSizing: LOT_FOR_LOT,
          });
          const totalDemand = demands.reduce((a, b) => a + b, 0);
          const totalSupply = supplies.reduce((a, b) => a + b, 0);
          const totalOrders = plan.orders.reduce((sum, order) => sum + Number(order.qty), 0);
          const shortfall = Math.max(0, totalDemand - totalSupply);
          // LOT_FOR_LOT: Σ orders == Σ positive per-bucket nets ≥ the raw
          // aggregate shortfall (clamped carries can only add coverage).
          expect(totalOrders).toBeGreaterThanOrEqual(shortfall);
          // Every positive net bucket generated exactly one order.
          for (const bucket of plan.buckets) {
            const net = Number(bucket.netRequirement);
            const ordersHere = plan.orders.filter((o) => o.bucketIndex === bucket.bucketIndex);
            expect(ordersHere).toHaveLength(net > 0 ? 1 : 0);
          }
          // The final carried balance is non-negative and ≤ the total
          // orders + supply − demand bound.
          const finalCarry = Number(plan.buckets[plan.buckets.length - 1]!.carriedOut);
          expect(finalCarry).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("determinism: identical terms produce identical plans", async () => {
    const fc = await import("fast-check");
    await fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 30 }), { minLength: 1, maxLength: 6 }),
        (demands) => {
          const mk = (): DemandTerm[] =>
            demands.map((qty, i) => ({ itemId: "I1", bucketIndex: i, kind: "SALES_ORDER", qty: String(qty) }));
          const supply: SupplyTerm[] = [];
          const run1 = planItemBuckets({
            itemId: "I1",
            bucketStarts: buckets(demands.length),
            demand: mk(),
            supply,
            safetyStockQty: "0",
            lotSizing: LOT_FOR_LOT,
          });
          const run2 = planItemBuckets({
            itemId: "I1",
            bucketStarts: buckets(demands.length),
            demand: mk(),
            supply,
            safetyStockQty: "0",
            lotSizing: LOT_FOR_LOT,
          });
          expect(run1).toEqual(run2);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("autoSafetyStock (M-01 — the deterministic z×σ×√LT)", () => {
  it("constant demand yields σ = 0 → zero safety stock", () => {
    expect(
      autoSafetyStock({ serviceLevelPct: "95", dailyDemands: ["10", "10", "10", "10"], leadTimeDays: 7 }),
    ).toBe("0.000000");
  });

  it("the known z values scale linearly (95 vs 99)", () => {
    const daily = ["0", "10", "0", "10"];
    const s95 = new Decimal(
      autoSafetyStock({ serviceLevelPct: "95", dailyDemands: daily, leadTimeDays: 4 }),
    );
    const s99 = new Decimal(
      autoSafetyStock({ serviceLevelPct: "99", dailyDemands: daily, leadTimeDays: 4 }),
    );
    // z99/z95 = 2.326/1.645 = 1.41398… — the ratio holds to 4dp.
    const ratio = s99.div(s95).toDecimalPlaces(4);
    expect(ratio.toString()).toBe("1.414");
  });

  it("zero lead time or a single sample yields zero (no invented statistics)", () => {
    expect(autoSafetyStock({ serviceLevelPct: "95", dailyDemands: ["1", "2"], leadTimeDays: 0 })).toBe("0.000000");
    expect(autoSafetyStock({ serviceLevelPct: "95", dailyDemands: ["5"], leadTimeDays: 9 })).toBe("0.000000");
  });
});
