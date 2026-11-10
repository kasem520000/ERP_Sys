import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  addMonths,
  computeMonthlyAmount,
  monthIndexOf,
  monthStartOf,
  round4,
  type AssetMathInput,
} from "./depreciation-service";
import { UoPUnitsRequiredError } from "./depreciation-errors";

/**
 * PHASE-026 T6 — the INV-023 property battery (PURE UNIT: no DB, no store —
 * the kernel only). PHASE-026 §6: "final-period residual absorption makes
 * Σ = cost − salvage exactly (property tests, half-up per ADR-0009)" across
 * a method mix (SL, DB, UoP); BR-043: accumulated NEVER exceeds the base.
 *
 * Money is generated from INTEGER minor units (10⁻⁴) so every fixture value
 * is exact — no binary float ever touches an amount (ADR-0009; Math.* is
 * banned by the floating-math lint rule). Register-realistic ranges: cost
 * 1.0000..10,000,000.0000, salvage strictly below cost (base ≥ 0.0001),
 * life 1..600 months (schema CHECK caps at 1200).
 */

const ACQUISITION = "2026-01-15"; // golden fixture: acquired mid-January 2026
const ACQUISITION_MONTH = "2026-01-01";

function assetOf(overrides: Partial<AssetMathInput> = {}): AssetMathInput {
  return {
    id: "asset-1",
    code: "A-001",
    acquisitionDate: ACQUISITION,
    cost: "12000.0000",
    salvageValue: "0.0000",
    usefulLifeMonths: 60,
    depreciationMethod: "STRAIGHT_LINE",
    totalEstimatedUnits: null,
    ...overrides,
  };
}

/** Exact 4dp money from integer minor units (halala-style). */
function money(minorUnits: number): string {
  return new Decimal(minorUnits).div(10_000).toFixed(4);
}

/** (cost, salvage < cost, life) tuples — salvage depends on cost via chain. */
const assetTupleArb = fc.integer({ min: 10_000, max: 100_000_000_000 }).chain((costMinor) =>
  fc.record({
    costMinor: fc.constant(costMinor),
    salvageMinor: fc.integer({ min: 0, max: costMinor - 1 }),
    life: fc.integer({ min: 1, max: 600 }),
  }),
);

interface SimResult {
  total: Decimal;
  amounts: string[];
  flipMonth: number;
}

/** Drive the kernel over the asset's whole life window, month by month. */
function simulateLife(
  asset: AssetMathInput,
  unitsByMonth: string[] | undefined,
  totalUnits: string | undefined,
): SimResult {
  const base = new Decimal(asset.cost).minus(new Decimal(asset.salvageValue));
  let accumulated = new Decimal(0);
  const amounts: string[] = [];
  let flipMonth = 0;
  const months = unitsByMonth === undefined ? asset.usefulLifeMonths : unitsByMonth.length;
  for (let m = 1; m <= months; m += 1) {
    const context = {
      periodStartDate: addMonths(ACQUISITION_MONTH, m),
      ...(totalUnits !== undefined && unitsByMonth !== undefined
        ? {
            cumulativeUnitsBefore: unitsByMonth
              .slice(0, m - 1)
              .reduce((acc, u) => acc.plus(new Decimal(u)), new Decimal(0))
              .toFixed(6),
          }
        : {}),
    };
    const result = computeMonthlyAmount(
      asset,
      accumulated.toFixed(4),
      unitsByMonth === undefined ? undefined : (unitsByMonth[m - 1] ?? "0"),
      context,
    );
    // BR-043 floor: never above the remaining headroom, never negative.
    expect(new Decimal(result.amount).lte(base.minus(accumulated))).toBe(true);
    expect(result.amount[0] !== "-").toBe(true);
    if (accumulated.gte(base) && flipMonth === 0) {
      // The month that landed exactly on the floor must have flipped.
      expect(result.flipsFullyDepreciated).toBe(true);
    }
    if (result.flipsFullyDepreciated && flipMonth === 0) flipMonth = m;
    if (flipMonth > 0 && flipMonth < m) {
      // INV-023 "drops out of runs": after the floor, every month is 0.0000.
      expect(result.amount).toBe("0.0000");
    }
    accumulated = accumulated.plus(new Decimal(result.amount));
    amounts.push(result.amount);
  }
  return { total: accumulated, amounts, flipMonth };
}

describe("INV-023 — STRAIGHT_LINE: Σ over the life = cost − salvage EXACTLY", () => {
  it("absorbs the final-period residual across randomized (cost, salvage, life) tuples", () => {
    fc.assert(
      fc.property(assetTupleArb, ({ costMinor, salvageMinor, life }) => {
        const asset = assetOf({
          cost: money(costMinor),
          salvageValue: money(salvageMinor),
          usefulLifeMonths: life,
          depreciationMethod: "STRAIGHT_LINE",
        });
        const base = new Decimal(asset.cost).minus(new Decimal(asset.salvageValue));
        const sim = simulateLife(asset, undefined, undefined);
        expect(sim.total.toFixed(4)).toBe(base.toFixed(4)); // EXACT equality
        expect(sim.flipMonth).toBeGreaterThan(0); // the floor was reached
      }),
      { numRuns: 120 },
    );
  });

  it("golden: 12,000 / 0 salvage / 60 months acquired 2026-01-15 → 200.0000 every month, Σ = 12,000", () => {
    const asset = assetOf({
      cost: "12000.0000",
      salvageValue: "0.0000",
      usefulLifeMonths: 60,
      depreciationMethod: "STRAIGHT_LINE",
    });
    const sim = simulateLife(asset, undefined, undefined);
    for (const amount of sim.amounts) expect(amount).toBe("200.0000");
    expect(sim.amounts).toHaveLength(60);
    expect(sim.total.toFixed(4)).toBe("12000.0000");
  });

  it("golden: cost 1000.0001 / 0 salvage / 36 months → 27.7778 × 35 then 27.7771 residual, Σ = 1000.0001", () => {
    const asset = assetOf({
      cost: "1000.0001",
      salvageValue: "0.0000",
      usefulLifeMonths: 36,
      depreciationMethod: "STRAIGHT_LINE",
    });
    const sim = simulateLife(asset, undefined, undefined);
    expect(sim.amounts[0]).toBe("27.7778");
    expect(sim.amounts[34]).toBe("27.7778");
    expect(sim.amounts[35]).toBe("27.7771"); // the absorbed residual
    expect(sim.total.toFixed(4)).toBe("1000.0001");
  });

  it("golden: salvage floor — 1,000 / 900 salvage / 12 months → Σ = 100.0000 exactly", () => {
    const asset = assetOf({
      cost: "1000.0000",
      salvageValue: "900.0000",
      usefulLifeMonths: 12,
      depreciationMethod: "STRAIGHT_LINE",
    });
    const sim = simulateLife(asset, undefined, undefined);
    expect(sim.amounts[0]).toBe("8.3333");
    expect(sim.total.toFixed(4)).toBe("100.0000"); // cost − salvage, exactly
  });
});

describe("INV-023 — DECLINING_BALANCE: floor-capped decay, residual absorbed", () => {
  it("rate = 12 / useful_life_months on opening NBV (DR-002 default); Σ = base exactly", () => {
    fc.assert(
      fc.property(assetTupleArb, ({ costMinor, salvageMinor, life }) => {
        const asset = assetOf({
          cost: money(costMinor),
          salvageValue: money(salvageMinor),
          usefulLifeMonths: life,
          depreciationMethod: "DECLINING_BALANCE",
        });
        const base = new Decimal(asset.cost).minus(new Decimal(asset.salvageValue));
        const sim = simulateLife(asset, undefined, undefined);
        expect(sim.total.toFixed(4)).toBe(base.toFixed(4)); // EXACT
        expect(sim.flipMonth).toBeGreaterThan(0); // the floor was reached
      }),
      { numRuns: 120 },
    );
  });

  it("golden: 12,000 / 2,000 salvage / 48 months → rate 0.25, month 1 = 3,000.0000", () => {
    const asset = assetOf({
      cost: "12000.0000",
      salvageValue: "2000.0000",
      usefulLifeMonths: 48,
      depreciationMethod: "DECLINING_BALANCE",
    });
    const first = computeMonthlyAmount(asset, "0.0000", undefined, {
      periodStartDate: "2026-02-01",
    });
    expect(first.amount).toBe("3000.0000"); // 12,000 × (12/48)
    expect(first.flipsFullyDepreciated).toBe(false); // headroom 10,000 remains
    const sim = simulateLife(asset, undefined, undefined);
    expect(sim.total.toFixed(4)).toBe("10000.0000"); // cost − salvage exactly
  });

  it("an asset already at the floor returns 0.0000 and flips (drops out of runs)", () => {
    const asset = assetOf({
      cost: "1000.0000",
      salvageValue: "200.0000",
      usefulLifeMonths: 36,
      depreciationMethod: "DECLINING_BALANCE",
    });
    const atFloor = computeMonthlyAmount(asset, "800.0000", undefined, {
      periodStartDate: "2027-01-01",
    });
    expect(atFloor).toEqual({
      amount: "0.0000",
      flipsFullyDepreciated: true,
      isFinalPeriod: false,
    });
  });
});

describe("INV-023 — UNITS_OF_PRODUCTION: manual usage, capped + absorbed", () => {
  it("Σ = base exactly when consumed units reach total_estimated_units", () => {
    fc.assert(
      fc.property(
        assetTupleArb,
        fc.integer({ min: 1, max: 20_000 }), // total units
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 24 }), // weights
        ({ costMinor, salvageMinor, life }, totalUnits, weights) => {
          const asset = assetOf({
            cost: money(costMinor),
            salvageValue: money(salvageMinor),
            usefulLifeMonths: life,
            depreciationMethod: "UNITS_OF_PRODUCTION",
            totalEstimatedUnits: new Decimal(totalUnits).toFixed(6),
          });

          // Scale the weights into a unit plan whose cumulative consumption
          // lands on totalUnits at the last period (the last period takes
          // the remainder — decimal units are legal, numeric(19,6)).
          const weightSum = weights.reduce((a, b) => a + b, 0);
          const head = weights
            .slice(0, -1)
            .map((w) =>
              new Decimal(totalUnits)
                .times(w)
                .div(weightSum)
                .toDecimalPlaces(6, Decimal.ROUND_HALF_UP),
            );
          const consumed = head.reduce((acc, u) => acc.plus(u), new Decimal(0));
          const last = Decimal.max(new Decimal(0), new Decimal(totalUnits).minus(consumed));
          const unitsByMonth = [...head.map((u) => u.toFixed(6)), last.toFixed(6)];

          const base = new Decimal(asset.cost).minus(new Decimal(asset.salvageValue));
          const sim = simulateLife(asset, unitsByMonth, asset.totalEstimatedUnits ?? "0");
          expect(sim.total.toFixed(4)).toBe(base.toFixed(4)); // EXACT
          expect(sim.flipMonth).toBeGreaterThan(0); // the floor was reached
        },
      ),
      { numRuns: 120 },
    );
  });

  it("golden: 5,000 / 500 salvage / 1,000 units — 250 then 750 units absorb to Σ = 4,500", () => {
    const asset = assetOf({
      cost: "5000.0000",
      salvageValue: "500.0000",
      depreciationMethod: "UNITS_OF_PRODUCTION",
      totalEstimatedUnits: "1000.000000",
    });
    const first = computeMonthlyAmount(asset, "0.0000", "250.000000", {
      periodStartDate: "2026-02-01",
      cumulativeUnitsBefore: "0.000000",
    });
    expect(first.amount).toBe("1125.0000"); // 4,500 × 250/1000
    expect(first.isFinalPeriod).toBe(false);
    const second = computeMonthlyAmount(asset, "1125.0000", "750.000000", {
      periodStartDate: "2026-03-01",
      cumulativeUnitsBefore: "250.000000",
    });
    expect(second.isFinalPeriod).toBe(true); // 250 + 750 = 1,000 = total
    expect(second.amount).toBe("3375.0000"); // absorbed residual: 4,500 − 1,125
    expect(second.flipsFullyDepreciated).toBe(true);
  });

  it("zero usage is a valid period (amount 0.0000 — excluded from run lines)", () => {
    const asset = assetOf({
      cost: "5000.0000",
      salvageValue: "500.0000",
      depreciationMethod: "UNITS_OF_PRODUCTION",
      totalEstimatedUnits: "1000.000000",
    });
    const idle = computeMonthlyAmount(asset, "0.0000", "0.000000", {
      periodStartDate: "2026-02-01",
      cumulativeUnitsBefore: "0.000000",
    });
    expect(idle.amount).toBe("0.0000");
    expect(idle.flipsFullyDepreciated).toBe(false);
  });

  it("missing units fail closed (UOP_UNITS_REQUIRED)", () => {
    const asset = assetOf({
      depreciationMethod: "UNITS_OF_PRODUCTION",
      totalEstimatedUnits: "1000.000000",
    });
    expect(() => computeMonthlyAmount(asset, "0.0000")).toThrow(UoPUnitsRequiredError);
  });
});

describe("Month convention (DR-002 default — next-month, golden fixtures)", () => {
  it("the acquisition month itself does NOT depreciate; the next month starts", () => {
    expect(monthIndexOf(ACQUISITION, "2026-01-01")).toBe(0); // not eligible
    expect(monthIndexOf(ACQUISITION, "2026-02-01")).toBe(1); // first eligible
    expect(monthIndexOf(ACQUISITION, "2026-12-01")).toBe(11);
    expect(monthIndexOf(ACQUISITION, "2031-01-01")).toBe(60); // life end (60m)
    expect(monthIndexOf("2026-03-10", "2026-02-01")).toBe(-1); // before acquisition
  });

  it("golden: 12,000 / 0 / 60 acquired 2026-01-15 — first run is 2026-02 at 200.0000", () => {
    const asset = assetOf({
      cost: "12000.0000",
      salvageValue: "0.0000",
      usefulLifeMonths: 60,
    });
    const january = computeMonthlyAmount(asset, "0.0000", undefined, {
      periodStartDate: "2026-01-01",
    });
    expect(january.amount).toBe("200.0000"); // formula — eligibility is the caller's rule
    const february = computeMonthlyAmount(asset, "0.0000", undefined, {
      periodStartDate: "2026-02-01",
    });
    expect(february.amount).toBe("200.0000");
  });

  it("month arithmetic: pure integer math, year rollovers and negatives", () => {
    expect(monthStartOf("2026-01-15")).toBe("2026-01-01");
    expect(monthStartOf("2026-12-31")).toBe("2026-12-01");
    expect(addMonths("2026-01-01", 60)).toBe("2031-01-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(addMonths("2026-03-01", 0)).toBe("2026-03-01");
  });
});

describe("Half-up rounding (ADR-0009) — monotone, bounded, no Math.*", () => {
  it("round4 is monotone non-decreasing on adjacent 4dp values", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000_000 }), (minor) => {
        const lo = new Decimal(minor).div(10_000);
        const hi = lo.plus(new Decimal("0.0001"));
        // Decimal compare — round4 returns canonical strings, never floats.
        expect(new Decimal(round4(lo)).lte(new Decimal(round4(hi)))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("round4 deviates from the exact value by at most half a unit (0.00005)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000_000_000 }), (subMinor) => {
        // 7dp input value (n / 10^7) — 3 more decimals than the money scale.
        const exact = new Decimal(subMinor).div(10_000_000);
        const rounded = new Decimal(round4(exact));
        const error = rounded.minus(exact).abs();
        expect(error.lte(new Decimal("0.00005"))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it("round4 rounds half UP at the boundary", () => {
    expect(round4(new Decimal("0.00005"))).toBe("0.0001");
    expect(round4(new Decimal("0.000049999"))).toBe("0.0000");
    expect(round4(new Decimal("1.23455"))).toBe("1.2346");
    expect(round4(new Decimal("1.234549"))).toBe("1.2345");
  });
});
