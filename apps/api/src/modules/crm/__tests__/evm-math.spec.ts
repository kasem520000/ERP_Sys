import { describe, expect, it } from "vitest";

import {
  EvCeilingExceededError,
} from "../domain/projects-errors";
import {
  aggregateWeightedPercent,
  costPerformanceIndex,
  earnedValue,
  earnedValueFromAggregate,
  forecastAtCompletion,
  ias23Split,
  ias23Window,
  rateToExactString,
  schedulePerformanceIndex,
} from "../domain/evm-math";

/**
 * PHASE-048 (W-10 — the plan §4's unit-first law): the PURE EVM + IAS-23
 * folds proven BEFORE any consumer lands — every example HAND-COMPUTED
 * (the W-9 lesson: the scale algebra is where the bugs live, so each
 * arm states its arithmetic).
 *
 * THE HAND-COMPUTED WORLD (the W-9 fixture's P1 tree — the db spec's
 * shared world): leaves A(weight 60.0000, 50.00%) · B1(30.0000, 80.00%)
 * · B2(10.0000, 20.00%) · M(null→1.0000, 100.00%) →
 *   weightedPctSum = 60×50 + 30×80 + 10×20 + 1×100 = 5,700 (%·weight)
 *                  = 5,700,000,000 minor-6
 *   weightSum     = 101.0000 = 1,010,000 minor-4
 *   percent       = 5,700/101 = 56.4356…% → 56.44 (the 2-dp display)
 *   EV(BAC 4100)  = 4100 × 5700/101/100 = 23,370,000/10,100
 *                 = 2313.86138…% → 2313.8614 (ONE rounding at money).
 */

const P1_NODES = [
  { id: "r", parentTaskId: null, weight: null, percentComplete: "0.00" },
  { id: "a", parentTaskId: "r", weight: "60.0000", percentComplete: "50.00" },
  { id: "b", parentTaskId: "r", weight: "40.0000", percentComplete: "0.00" },
  { id: "b1", parentTaskId: "b", weight: "30.0000", percentComplete: "80.00" },
  { id: "b2", parentTaskId: "b", weight: "10.0000", percentComplete: "20.00" },
  { id: "m", parentTaskId: null, weight: null, percentComplete: "100.00" },
];

describe("W-10 evm-math — aggregateWeightedPercent (BR-095's super-root corollary)", () => {
  it("(a) the P1 world: the exact sums, the 56.44 display, six leaves", () => {
    const aggregate = aggregateWeightedPercent(P1_NODES)!;
    // Σ(weight × leaf pct): 60×50 + 30×80 + 10×20 + 1×100 = 5,700 at
    // minor-6 (weight minor4 × pct minor2).
    expect(aggregate.weightedPctSum).toBe("5700.000000");
    // Σ weights: 60 + 30 + 10 + 1 = 101.0000 (the NULL weight folds as 1).
    expect(aggregate.weightSum).toBe("101.0000");
    // 5,700/101 = 56.4356…% → the 2-dp display rounds half-up to 56.44.
    expect(aggregate.percent).toBe("56.44");
    expect(aggregate.leafCount).toBe(4); // A, B1, B2, M — the leaves only
  });

  it("(b) the parents' own reports NEVER enter the fold (r/b carry 0.00)", () => {
    // r and b report 0.00 — if their own reports counted, the aggregate
    // would drop; the fold reads the leaves only (D-03's law).
    const aggregate = aggregateWeightedPercent(P1_NODES)!;
    expect(aggregate.percent).toBe("56.44");
    // The proof: strip the parents entirely — the same fold.
    const leavesOnly = P1_NODES.filter((node) => ["a", "b1", "b2", "m"].includes(node.id));
    const leavesAggregate = aggregateWeightedPercent(
      leavesOnly.map((node) => ({ ...node, parentTaskId: null })),
    )!;
    expect(leavesAggregate.weightedPctSum).toBe(aggregate.weightedPctSum);
    expect(leavesAggregate.weightSum).toBe(aggregate.weightSum);
  });

  it("(c) the empty tree is null — the caller's honest zero, never a fabricated percent", () => {
    expect(aggregateWeightedPercent([])).toBeNull();
  });

  it("(d) the degenerate all-explicit-zero-weight tree folds as the equal-share mean", () => {
    const degenerate = [
      { id: "x", parentTaskId: null, weight: "0.0000", percentComplete: "40.00" },
      { id: "y", parentTaskId: null, weight: "0.0000", percentComplete: "60.00" },
    ];
    const aggregate = aggregateWeightedPercent(degenerate)!;
    // (40 + 60)/2 = 50.00 — the equal-share mean, never a fabricated 0.00.
    expect(aggregate.percent).toBe("50.00");
    expect(aggregate.weightSum).toBe("0.0000");
    expect(aggregate.weightedPctSum).toBe("0.000000");
  });

  it("(e) the single-leaf root folds itself (the milestone-only tree)", () => {
    const solo = [{ id: "m", parentTaskId: null, weight: null, percentComplete: "100.00" }];
    const aggregate = aggregateWeightedPercent(solo)!;
    expect(aggregate.percent).toBe("100.00");
    expect(aggregate.weightSum).toBe("1.0000");
    // 1.0000 (minor4 10,000) × 100.00 (minor2 10,000) = 10^8 at minor-6
    // = 100.000000 — the percent-weight unit (1 × 100).
    expect(aggregate.weightedPctSum).toBe("100.000000");
  });
});

describe("W-10 evm-math — earnedValue (the per-node fold + THE EV CEILING)", () => {
  it("(a) 50.00% × 4100.0000 = 2050.0000 (the scale algebra: minor4 × minor2 / 10^4)", () => {
    expect(earnedValue("4100.0000", "50.00")).toBe("2050.0000");
  });

  it("(b) 12.35% × 999.9999 = 123.5000 (the half-up rounding arm)", () => {
    // 999.9999 × 12.35/100 = 123.49998765 → 123.5000 (the 5th decimal
    // digit 8 ≥ 5 rounds the 4th up: 123.4999|8765 → 123.5000).
    expect(earnedValue("999.9999", "12.35")).toBe("123.5000");
  });

  it("(c) the BOUNDARY: 100.00% earns EXACTLY the budget — legal, never more", () => {
    expect(earnedValue("4100.0000", "100.00")).toBe("4100.0000");
  });

  it("(d) THE CEILING REFUSAL: a percent above the budget's own ratio refuses typed", () => {
    // 100.01% × 4100 = 4100.41 > 4100 — the typed refusal (acceptance
    // #4's enforcement arm; the stored percents are CHECK-banded ≤ 100,
    // so this arm proves the fold's own defensive law).
    expect(() => earnedValue("4100.0000", "100.01")).toThrow(EvCeilingExceededError);
  });

  it("(e) the zero budget earns zero (a node without planned cells)", () => {
    expect(earnedValue("0.0000", "80.00")).toBe("0.0000");
  });
});

describe("W-10 evm-math — earnedValueFromAggregate (the structural project EV)", () => {
  it("(a) the P1 world: 4100 × 5700/101/100 = 2313.8614 (ONE rounding at money)", () => {
    const aggregate = aggregateWeightedPercent(P1_NODES)!;
    // 4100 × 56.435643…% = 2313.861386…% → 2313.8614 — computed from the
    // EXACT ratio (5,700,000,000/1,010,000), never the 56.44 display
    // (which would fabricate 2314.04 — the double-rounding trap).
    expect(earnedValueFromAggregate("4100.0000", aggregate)).toBe("2313.8614");
  });

  it("(b) the boundary: BAC at 100% earns exactly BAC", () => {
    const full = aggregateWeightedPercent([
      { id: "x", parentTaskId: null, weight: null, percentComplete: "100.00" },
    ])!;
    expect(earnedValueFromAggregate("4100.0000", full)).toBe("4100.0000");
  });

  it("(c) THE CEILING REFUSAL: the aggregate above the budget refuses typed", () => {
    // A corrupted world (percent reports above what any CHECK-banded
    // tree could produce) — the fold still refuses: 5700% of 4100.
    const corrupted = {
      weightedPctSum: "570000.000000",
      weightSum: "101.0000",
      percent: "5700.00",
      leafCount: 4,
    };
    expect(() => earnedValueFromAggregate("4100.0000", corrupted)).toThrow(EvCeilingExceededError);
  });

  it("(d) the degenerate equal-share aggregate rides the display percent (one rounding)", () => {
    const degenerate = aggregateWeightedPercent([
      { id: "x", parentTaskId: null, weight: "0.0000", percentComplete: "50.00" },
    ])!;
    expect(earnedValueFromAggregate("2000.0000", degenerate)).toBe("1000.0000");
  });
});

describe("W-10 evm-math — the performance indices (the honest-null law)", () => {
  it("(a) CPI 2050/10945.3125 = 0.187295 (6-dp, hand-divided)", () => {
    // 20,500,000/109,453,125 (minor4) = 0.18729478…% → 0.187295 (the
    // 7th digit 7 rounds the 6th up).
    expect(costPerformanceIndex("2050.0000", "10945.3125")).toBe("0.187295");
  });

  it("(b) CPI 1/3 = 0.333333 and 2/3 = 0.666667 (the half-up index rounding)", () => {
    expect(costPerformanceIndex("1.0000", "3.0000")).toBe("0.333333");
    expect(costPerformanceIndex("2.0000", "3.0000")).toBe("0.666667");
  });

  it("(c) AC = 0 → CPI null (an honest absence, never a fabricated ∞ or 0)", () => {
    expect(costPerformanceIndex("500.0000", "0.0000")).toBeNull();
  });

  it("(d) EV = 0 with AC > 0 → CPI 0.000000 (an honest zero, never null)", () => {
    expect(costPerformanceIndex("0.0000", "1000.0000")).toBe("0.000000");
  });

  it("(e) SPI 2313.8614/2600 = 0.889947 (the P1 world at Jan 16)", () => {
    // 23,138,614/26,000,000 = 0.8899466…% → 0.889947 (the 7th digit 6
    // rounds the 6th up).
    expect(schedulePerformanceIndex("2313.8614", "2600.0000")).toBe("0.889947");
  });

  it("(f) PV = 0 → SPI null", () => {
    expect(schedulePerformanceIndex("500.0000", "0.0000")).toBeNull();
  });
});

describe("W-10 evm-math — forecastAtCompletion (the documented fallback law)", () => {
  it("(a) CPI_BASED: BAC 10000, EV 2000, AC 2500 → CPI 0.8, ETC 8000, EAC 10500", () => {
    // ETC = (10000 − 2000) × 2500/2000 = 8000×1.25 = 10000.0000;
    // EAC = 2500 + 10000 = 12500.0000. (The exact form — never the
    // rounded index.)
    const forecast = forecastAtCompletion("10000.0000", "2000.0000", "2500.0000");
    expect(forecast.method).toBe("CPI_BASED");
    expect(forecast.etc).toBe("10000.0000");
    expect(forecast.eac).toBe("12500.0000");
  });

  it("(b) CPI_BASED rounding: BAC 1500, EV 900, AC 300 → ETC 200, EAC 500 (exact)", () => {
    const forecast = forecastAtCompletion("1500.0000", "900.0000", "300.0000");
    expect(forecast.method).toBe("CPI_BASED");
    expect(forecast.etc).toBe("200.0000");
    expect(forecast.eac).toBe("500.0000");
  });

  it("(c) REMAINDER: AC = 0 → ETC = BAC − EV at budget cost, EAC = ETC", () => {
    const forecast = forecastAtCompletion("4100.0000", "2313.8614", "0.0000");
    expect(forecast.method).toBe("REMAINDER");
    expect(forecast.etc).toBe("1786.1386");
    expect(forecast.eac).toBe("1786.1386");
  });

  it("(d) REMAINDER: EV = 0 with AC > 0 (CPI = 0) → the remaining work at budget cost", () => {
    const forecast = forecastAtCompletion("10000.0000", "0.0000", "1000.0000");
    expect(forecast.method).toBe("REMAINDER");
    expect(forecast.etc).toBe("10000.0000");
    expect(forecast.eac).toBe("11000.0000");
  });

  it("(e) complete: EV = BAC → ETC 0, EAC = AC", () => {
    const forecast = forecastAtCompletion("4100.0000", "4100.0000", "5000.0000");
    expect(forecast.etc).toBe("0.0000");
    expect(forecast.eac).toBe("5000.0000");
  });

  it("(f) the defensive ceiling: EV > BAC refuses typed (the same law)", () => {
    expect(() => forecastAtCompletion("1000.0000", "1000.0001", "500.0000")).toThrow(
      EvCeilingExceededError,
    );
  });
});

describe("W-10 evm-math — ias23Window (the WBS schedule law)", () => {
  it("(a) min start / max end over the dated tasks; the undated are excluded", () => {
    const window = ias23Window([
      { startDate: "2026-01-01", endDate: "2026-06-30" },
      { startDate: "2026-03-01", endDate: "2026-12-15" },
      { startDate: null, endDate: null },
      { startDate: "2026-02-01", endDate: null },
    ])!;
    expect(window).toEqual({ start: "2026-01-01", end: "2026-12-15" });
  });

  it("(b) no dated task → null (the caller's typed refusal)", () => {
    expect(ias23Window([{ startDate: null, endDate: null }])).toBeNull();
    expect(ias23Window([])).toBeNull();
  });
});

describe("W-10 evm-math — ias23Split (the documented stop rules, hand-computed)", () => {
  // THE HAND-COMPUTED CELL: 1,200 over 2026-02-01..04-30 (89 days —
  // Feb 28 + Mar 31 + Apr 30), 10/day; the window 2026-03-01..12-15;
  // the rate 0.05; asOf 2026-12-31.
  const CELL = { periodStart: "2026-02-01", periodEnd: "2026-04-30", plannedAmount: "1200.0000" };
  const WINDOW = { start: "2026-03-01", end: "2026-12-15" };

  it("(a) the straddling start: eligible 822.4719 (61/89 of 1200), the costs split exactly", () => {
    const split = ias23Split(CELL, WINDOW, "0.050000", "2026-12-31")!;
    expect(split.sliceStart).toBe("2026-03-01");
    expect(split.sliceEnd).toBe("2026-04-30");
    // expenditures: the whole line through Dec 31 = 1200 (past its end).
    expect(split.expenditures).toBe("1200.0000");
    // eligible: 1200 × 61/89 = 73,200/89 = 822.4719…% → 822.4719.
    expect(split.eligible).toBe("822.4719");
    // ineligible: 1200 − 822.4719 = 377.5281 (February's accrual).
    expect(split.ineligible).toBe("377.5281");
    // capitalized: 822.4719 × 0.05 = 41.12359…% → 41.1236.
    expect(split.capitalized).toBe("41.1236");
    // expensed: 377.5281 × 0.05 = 18.87640…% → 18.8764.
    expect(split.expensed).toBe("18.8764");
    // THE 0103 CHECK'S LAW: capitalized + expensed ≤ expenditures — and
    // here their sum is the exact 1200 × 0.05 = 60.0000.
    expect(Number(split.capitalized) + Number(split.expensed)).toBeLessThanOrEqual(
      Number(split.expenditures),
    );
  });

  it("(b) the elapsed law: asOf 2026-03-31 caps both folds inside the elapsed days", () => {
    const split = ias23Split(CELL, WINDOW, "0.050000", "2026-03-31")!;
    // expenditures: 1200 × 59/89 (Feb 28 + Mar 31) = 70,800/89 = 795.5056.
    expect(split.expenditures).toBe("795.5056");
    // eligible: 1200 × 31/89 = 37,200/89 = 417.9775 (Mar only).
    expect(split.eligible).toBe("417.9775");
    expect(split.ineligible).toBe("377.5281");
    // capitalized: 417.9775 × 0.05 = 20.89887…% → 20.8989.
    expect(split.capitalized).toBe("20.8989");
    // expensed: February's 377.5281 × 0.05 = 18.8764.
    expect(split.expensed).toBe("18.8764");
  });

  it("(c) the start law: asOf before the window → eligible 0, ALL attributable costs expensed", () => {
    const split = ias23Split(CELL, WINDOW, "0.050000", "2026-02-15")!;
    // expenditures: 1200 × 15/89 = 18,000/89 = 202.2471…% → 202.2472.
    expect(split.expenditures).toBe("202.2472");
    expect(split.eligible).toBe("0.0000");
    expect(split.ineligible).toBe("202.2472");
    expect(split.capitalized).toBe("0.0000");
    // expensed: 202.2472 × 0.05 = 10.1123…% → 10.1124.
    expect(split.expensed).toBe("10.1124");
  });

  it("(d) the completion law: a window ending mid-line expenses the tail", () => {
    const earlyWindow = { start: "2026-01-01", end: "2026-02-28" };
    const split = ias23Split(CELL, earlyWindow, "0.050000", "2026-12-31")!;
    // The slice is Feb 1..28: eligible = 1200 × 28/89 = 377.5281.
    expect(split.sliceStart).toBe("2026-02-01");
    expect(split.sliceEnd).toBe("2026-02-28");
    expect(split.eligible).toBe("377.5281");
    expect(split.ineligible).toBe("822.4719");
    expect(split.capitalized).toBe("18.8764");
    expect(split.expensed).toBe("41.1236");
  });

  it("(e) out of scope: a line entirely past the window returns null (listed, never zeroed)", () => {
    const after = { periodStart: "2027-01-01", periodEnd: "2027-01-31", plannedAmount: "310.0000" };
    expect(ias23Split(after, WINDOW, "0.050000", "2027-12-31")).toBeNull();
    // And one entirely BEFORE the window likewise.
    const before = { periodStart: "2025-01-01", periodEnd: "2025-01-31", plannedAmount: "310.0000" };
    expect(ias23Split(before, WINDOW, "0.050000", "2027-12-31")).toBeNull();
  });

  it("(f) rate 1.000000 splits exactly (capitalized = eligible, expensed = ineligible)", () => {
    const split = ias23Split(CELL, WINDOW, "1.000000", "2026-12-31")!;
    expect(split.capitalized).toBe(split.eligible);
    expect(split.expensed).toBe(split.ineligible);
    expect(Number(split.capitalized) + Number(split.expensed)).toBe(Number(split.expenditures));
  });

  it("(g) the constraint law: capitalized + expensed ≤ expenditures across the rate band", () => {
    for (const rate of ["0.000000", "0.050000", "0.333333", "0.999999", "1.000000"]) {
      const split = ias23Split(CELL, WINDOW, rate, "2026-03-31")!;
      expect(Number(split.capitalized) + Number(split.expensed)).toBeLessThanOrEqual(
        Number(split.expenditures),
      );
      expect(Number(split.capitalized)).toBeLessThanOrEqual(Number(split.eligible));
      expect(Number(split.expensed)).toBeLessThanOrEqual(Number(split.ineligible));
    }
  });
});

describe("W-10 evm-math — rateToExactString (the single float boundary)", () => {
  it("(a) the canonical rates convert to the exact 6-dp strings", () => {
    expect(rateToExactString(0.05)).toBe("0.050000");
    expect(rateToExactString(0)).toBe("0.000000");
    expect(rateToExactString(1)).toBe("1.000000");
    expect(rateToExactString(0.0475)).toBe("0.047500");
  });

  it("(b) the out-of-band shapes return null (the caller's refusal)", () => {
    expect(rateToExactString(-0.01)).toBeNull();
    expect(rateToExactString(1.01)).toBeNull();
    expect(rateToExactString(Number.NaN)).toBeNull();
    expect(rateToExactString(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
