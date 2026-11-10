import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import { fifoConsume, fifoOnHand, fifoValuation, type FifoLayer } from "./fifo";
import { cost6, money4, valueAmount, wacIssue, wacReceive } from "./wac";

/**
 * Valuation property suite (PHASE-010 §6; ACCOUNTING_TESTS §4 rows 3–4):
 * WAC and FIFO against oracle datasets + fast-check properties.
 *
 * WAC bounds: the new average is strictly within [min, max] of the costs
 * seen; qtyOnHand × avg = valuation total within 6-decimal rounding;
 * issue-then-receipt never mutates past issue costs. FIFO: consumption
 * order is oldest-first always; Σ layer qty = on-hand exactly; valuation
 * = Σ layer qty × cost (INV-010's quantity side).
 */

const POSITIVE_QTY = () =>
  fc
    .tuple(fc.nat({ max: 100000 }), fc.nat({ max: 6 }))
    .map(([units, dp]) => `${units}.${String(dp).padEnd(6, "0")}`);

describe("WAC engine — oracle datasets", () => {
  it("INVENTORY_ACCOUNTING §1 worked example: 10 @ 2.00, receive 10 @ 3.00 → avg 2.500000", () => {
    const first = wacReceive("0", "0", "10", "2.00");
    expect(first.avgCost).toBe("2.000000");
    expect(first.valueAmount).toBe("20.0000");
    const second = wacReceive("10", first.avgCost, "10", "3.00");
    expect(second.avgCost).toBe("2.500000");
    expect(second.valueAmount).toBe("30.0000");
  });

  it("issues price at the current average and never mutate it", () => {
    const issue = wacIssue("2.500000", "4");
    expect(issue.valueAmount).toBe("10.0000");
    expect(issue.unitCost).toBe("2.500000");
  });

  it("6-decimal internal precision: thirds stay exact at the 6dp scale", () => {
    const r = wacReceive("0", "0", "3", "0.3333333");
    // 3 units at 0.3333333 → avg 0.333333 (half-up at 6dp), value 0.9999999 → 1.0000
    expect(r.avgCost).toBe("0.333333");
    expect(r.valueAmount).toBe("1.0000");
  });

  it("value_amount rounds half-up at the 4dp money quantum", () => {
    expect(valueAmount("3", "0.3333333")).toBe("1.0000");
    expect(valueAmount("1", "0.00005")).toBe("0.0001");
    expect(valueAmount("1", "0.00004")).toBe("0.0000");
  });
});

describe("WAC engine — properties", () => {
  it("new average is within [min, max] of the blended costs", () => {
    fc.assert(
      fc.property(POSITIVE_QTY(), POSITIVE_QTY(), POSITIVE_QTY(), (onHand, inQty, cost) => {
        const avg = new Decimal("2.000000");
        const next = wacReceive(onHand, avg.toFixed(6), inQty, cost);
        const blended = new Decimal(cost);
        const low = Decimal.min(avg, blended);
        const high = Decimal.max(avg, blended);
        expect(new Decimal(next.avgCost).gte(low.minus("0.000001"))).toBe(true);
        expect(new Decimal(next.avgCost).lte(high.plus("0.000001"))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("conservation: on-hand value after receipt = prior value + receipt value (6dp avg rounding bounds)", () => {
    fc.assert(
      fc.property(POSITIVE_QTY(), POSITIVE_QTY(), POSITIVE_QTY(), (onHand, inQty, cost) => {
        const oldAvg = "1.750000";
        const before = new Decimal(onHand).times(new Decimal(oldAvg));
        const r = wacReceive(onHand, oldAvg, inQty, cost);
        const totalQty = new Decimal(onHand).plus(new Decimal(inQty));
        const after = totalQty.times(new Decimal(r.avgCost));
        // The 6dp average rounding bounds the drift: |Δ| ≤ totalQty × 5e-7
        // + the 4dp money quantum — both scale with the magnitudes involved.
        const tolerance = Decimal.max(
          new Decimal("0.0001"),
          totalQty.times(new Decimal("0.00000051")),
        );
        expect(
          after.minus(before).minus(new Decimal(r.valueAmount)).abs().lte(tolerance),
        ).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("issue-then-receipt never mutates past issue costs (INV-017 shape)", () => {
    const a = wacReceive("0", "0", "10", "2");
    const issue = wacIssue(a.avgCost, "4");
    expect(issue.unitCost).toBe(a.avgCost);
    const b = wacReceive("6", a.avgCost, "10", "3");
    expect(b.avgCost).not.toBe(a.avgCost); // the average moved on…
    const oldIssue = wacIssue(a.avgCost, "4"); // …but historical cost math is reproducible
    expect(oldIssue.unitCost).toBe(issue.unitCost);
  });
});

describe("FIFO engine — oracle datasets", () => {
  it("oldest-first: 10@1 + 10@2, issue 15 → 10×1 + 5×2 = 20.0000", () => {
    const layers: FifoLayer[] = [
      { id: "l1", remainingQty: "10", unitCost: "1.000000" },
      { id: "l2", remainingQty: "10", unitCost: "2.000000" },
    ];
    const result = fifoConsume(layers, "15");
    expect(result.consumptions).toEqual([
      { layerId: "l1", qty: "10.000000" },
      { layerId: "l2", qty: "5.000000" },
    ]);
    expect(result.valueAmount).toBe("20.0000");
    expect(result.unitCost).toBe("1.333333");
  });

  it("Σ layer qty = on-hand exactly (zeroed rows included)", () => {
    const layers: FifoLayer[] = [
      { id: "l1", remainingQty: "0", unitCost: "1.000000" },
      { id: "l2", remainingQty: "7.250000", unitCost: "2.000000" },
    ];
    expect(fifoOnHand(layers)).toBe("7.250000");
    expect(fifoValuation(layers)).toBe("14.5000");
  });
});

describe("FIFO engine — properties", () => {
  const layerList = fc
    .array(
      fc.record({
        id: fc.uuid(),
        remainingQty: POSITIVE_QTY(),
        unitCost: POSITIVE_QTY(),
      }),
      { minLength: 1, maxLength: 12 },
    )
    .map((layers) => layers.map((l, i) => ({ ...l, id: `l${i}` })));

  it("consumption order is oldest-first ALWAYS (slice prefixes)", () => {
    fc.assert(
      fc.property(layerList, (layers) => {
        const onHand = new Decimal(fifoOnHand(layers));
        if (onHand.lte(0)) return true;
        const qty = Decimal.min(onHand, new Decimal("1.5")).toFixed(6);
        const result = fifoConsume(layers, qty);
        const touched = new Set(result.consumptions.map((c) => c.layerId));
        // every touched layer index < every untouched non-empty layer index
        const touchedIdx = layers.filter((l) => touched.has(l.id)).map((l) => layers.indexOf(l));
        const untouchedIdx = layers
          .filter((l) => !touched.has(l.id) && new Decimal(l.remainingQty).gt(0))
          .map((l) => layers.indexOf(l));
        for (const t of touchedIdx) {
          for (const u of untouchedIdx) {
            if (t > u) return false;
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it("Σ layer qty = on-hand exactly and layers never go negative", () => {
    fc.assert(
      fc.property(layerList, (layers) => {
        const onHand = new Decimal(fifoOnHand(layers));
        if (onHand.lte(0)) return true;
        const qty = onHand.toFixed(6);
        const result = fifoConsume(layers, qty);
        const byId = new Map(result.consumptions.map((c) => [c.layerId, new Decimal(c.qty)]));
        let sum = new Decimal(0);
        for (const layer of layers) {
          const take = byId.get(layer.id) ?? new Decimal(0);
          const next = new Decimal(layer.remainingQty).minus(take);
          if (next.lt(0)) return false; // never negative
          sum = sum.plus(next);
        }
        return sum.toFixed(6) === "0.000000"; // fully consumed → on-hand exactly zero
      }),
      { numRuns: 200 },
    );
  });

  it("valuation = Σ layer qty × cost exactly (INV-010 quantity side)", () => {
    fc.assert(
      fc.property(layerList, (layers) => {
        const expected = layers.reduce(
          (sum, layer) =>
            sum.plus(new Decimal(layer.remainingQty).times(new Decimal(layer.unitCost))),
          new Decimal(0),
        );
        expect(new Decimal(fifoValuation(layers)).eq(money4(expected))).toBe(true);
        expect(fifoValuation(layers)).toBe(
          expected.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        );
        void cost6;
      }),
      { numRuns: 200 },
    );
  });
});
