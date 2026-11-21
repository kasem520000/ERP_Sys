import { describe, expect, it } from "vitest";

import {
  calendarDue,
  generationDecision,
  laborLineAmount,
  meterDelta,
  meterDue,
  netBookValue,
  nextCalendarDue,
  reconcileWorkOrderCosts,
  sumAmounts,
} from "./cmms-plan-math";

/**
 * PHASE-049 (W-17 — T-05a) — the PURE layer's spec, written BEFORE any
 * consumer exists (the unit-first law, the 047/048 precedent: this file
 * pins the plan-evaluation arithmetic the T-05/T-06/T-07 services will
 * import — zero parallel computation allowed downstream). Every law here
 * is the master plan's own: the calendar strict cadence (D-08), the
 * meter anchor semantics + the back-dated no-double-trigger (D-08 +
 * acceptance #5), BR-097's named skips, the labor snapshot arithmetic
 * (D-03), and the INV-034 per-leg reconciliation fold (D-04's worked
 * example: labor 1,200 + parts 800 + external 500 → DR 2,500).
 */
describe("PHASE-049 W-17 — the calendar fold (D-08)", () => {
  it("due is inclusive: the due day IS the trigger day", () => {
    expect(calendarDue("2026-03-01", "2026-03-01")).toBe(true);
    expect(calendarDue("2026-03-02", "2026-03-01")).toBe(true);
    expect(calendarDue("2026-02-28", "2026-03-01")).toBe(false);
  });

  it("the strict cadence re-arms from the plan's own anchor, never the wall clock", () => {
    // A 30-day plan due 2026-03-01 that generated LATE (on 2026-03-10)
    // re-arms at 2026-03-31 — not at today+30 (2026-04-09).
    expect(nextCalendarDue("2026-03-01", 30)).toBe("2026-03-31");
    expect(nextCalendarDue("2026-03-01", 30)).not.toBe("2026-04-09");
    // The rhythm keeps over month and year boundaries.
    expect(nextCalendarDue("2026-01-31", 1)).toBe("2026-02-01");
    expect(nextCalendarDue("2026-12-31", 90)).toBe("2027-03-31");
    // Leap year: 2028-02-28 + 1 = 2028-02-29 (the real calendar, UTC days).
    expect(nextCalendarDue("2028-02-28", 1)).toBe("2028-02-29");
    expect(nextCalendarDue("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("interval bounds mirror the 0105 CHECK (1…3650)", () => {
    expect(() => nextCalendarDue("2026-03-01", 0)).toThrow(/intervalDays/);
    expect(() => nextCalendarDue("2026-03-01", 3651)).toThrow(/intervalDays/);
    expect(() => nextCalendarDue("2026-03-01", 30.5)).toThrow(/intervalDays/);
    // 3,650 days spans three leap days (2028/2032/2036) → 2036-02-27
    // (independently verified against Python's date arithmetic at write
    // time — the F1 discipline: the expectation checked, not assumed).
    expect(nextCalendarDue("2026-03-01", 3650)).toBe("2036-02-27");
  });

  it("non-dates refuse (the pure fold never sees a malformed day)", () => {
    expect(() => calendarDue("2026-13-01", "2026-03-01")).toThrow(/calendar date/);
    expect(() => calendarDue("2026-02-30", "2026-03-01")).toThrow(/real calendar date/);
    expect(() => nextCalendarDue("2026-03-1", 30)).toThrow(/ISO calendar date/);
  });
});

describe("PHASE-049 W-17 — the meter fold (D-08: the anchor semantics)", () => {
  it("delta measures from the GENERATION's own reading stamp", () => {
    expect(meterDelta("15200", "10000")).toBe("5200");
    expect(meterDelta("10000", "10000")).toBe("0");
  });

  it("a null anchor is the baseline zero (one arithmetic shape)", () => {
    expect(meterDelta("15200", null)).toBe("15200");
    expect(meterDelta("0", null)).toBe("0");
  });

  it("due is inclusive at exactly the threshold — the 5,000th km IS the due km", () => {
    expect(meterDue("15000", "10000", "5000")).toBe(true);
    expect(meterDue("14999.999999", "10000", "5000")).toBe(false);
    expect(meterDue("16000", "10000", "5000")).toBe(true);
  });

  it("the 6-dp meter quantum is exact (no float slippage)", () => {
    expect(meterDelta("10000.000001", "10000")).toBe("0.000001");
    expect(meterDue("10000.000001", "10000", "0.000001")).toBe(true);
  });

  it("THE BACK-DATED NO-DOUBLE-TRIGGER LAW: a window already generated never re-arms", () => {
    // The plan generated at 15,200 (the anchor moved there). A LATER-
    // INSERTED but BACK-DATED 14,000 reading evaluates at its own
    // position: 14,000 − 15,200 < 0 → never due (acceptance #5's arm).
    expect(meterDue("14000", "15200", "5000")).toBe(false);
    // A back-dated-but-HIGHER 16,000 reading re-evaluates FROM THE
    // ANCHOR (800 < 5,000) — still not due; the next window opens at
    // 20,200.
    expect(meterDue("16000", "15200", "5000")).toBe(false);
    expect(meterDue("20200", "15200", "5000")).toBe(true);
  });

  it("a non-positive threshold refuses (the 0105 CHECK's own law)", () => {
    expect(() => meterDue("15000", "10000", "0")).toThrow(/threshold/);
    expect(() => meterDue("15000", "10000", "-1")).toThrow(/threshold/);
  });
});

describe("PHASE-049 W-17 — BR-097's generation decision fold (the named skips)", () => {
  it("only a due plan with a closed window generates", () => {
    expect(generationDecision({ due: true, openWindow: false })).toEqual({ generate: true });
  });

  it("a due plan with an OPEN window skips BY NAME — PLAN_WINDOW_OPEN, never silent", () => {
    const skip = generationDecision({ due: true, openWindow: true });
    expect(skip.generate).toBe(false);
    expect(skip.skipReason).toBe("PLAN_WINDOW_OPEN");
  });

  it("a not-due plan skips BY NAME — PLAN_NOT_DUE (the window state is irrelevant)", () => {
    expect(generationDecision({ due: false, openWindow: true })).toEqual({
      generate: false,
      skipReason: "PLAN_NOT_DUE",
    });
    expect(generationDecision({ due: false, openWindow: false })).toEqual({
      generate: false,
      skipReason: "PLAN_NOT_DUE",
    });
  });
});

describe("PHASE-049 W-17 — the cost collectors (D-03: the snapshot arithmetic)", () => {
  it("labor = hours × rate with ONE half-up rounding at the 4-dp quantum", () => {
    // The D-04 worked example's labor leg: 2.5h × 480.00 = 1,200.0000.
    expect(laborLineAmount("2.5", "480.00")).toBe("1200");
    // 6dp hours × 6dp rate → exact 12dp product → half-up 4dp.
    expect(laborLineAmount("1.666667", "720.000000")).toBe("1200.0002");
    expect(laborLineAmount("3.141592", "100")).toBe("314.1592");
    // The rounding boundary: .00005 rounds UP (half-up, never banker's).
    expect(laborLineAmount("1.000005", "10")).toBe("10.0001");
  });

  it("hours must be positive; the rate may be zero only as an explicit zero", () => {
    expect(() => laborLineAmount("0", "480")).toThrow(/hours/);
    expect(() => laborLineAmount("-1", "480")).toThrow(/hours/);
    expect(laborLineAmount("2", "0")).toBe("0");
  });

  it("the totals fold is an exact 4-dp sum", () => {
    expect(sumAmounts(["1200", "800", "500"])).toBe("2500");
    expect(sumAmounts([])).toBe("0");
    expect(sumAmounts(["0.0001", "0.0002", "0.0003"])).toBe("0.0006");
  });
});

describe("PHASE-049 W-17 — the INV-034 reconciliation fold (the per-leg breakdown)", () => {
  it("D-04's worked example balances to the cent by construction", () => {
    // labor 1,200 + parts 800 + external 500 → DR MAINTENANCE_EXPENSE 2,500.
    const verdict = reconcileWorkOrderCosts({
      laborTotal: "1200",
      partsTotal: "800",
      externalTotal: "500",
      glExpenseDebit: "2500",
    });
    expect(verdict.balanced).toBe(true);
    expect(verdict.sourceTotal).toBe("2500");
    expect(verdict.difference).toBe("0");
    expect(verdict).toMatchObject({
      labor: "1200",
      parts: "800",
      external: "500",
      glExpenseDebit: "2500",
    });
  });

  it("a one-cent break is UNBALANCED and the difference is exact and named", () => {
    const verdict = reconcileWorkOrderCosts({
      laborTotal: "1200.0001",
      partsTotal: "800",
      externalTotal: "500",
      glExpenseDebit: "2500",
    });
    expect(verdict.balanced).toBe(false);
    expect(verdict.difference).toBe("-0.0001");
    expect(verdict.sourceTotal).toBe("2500.0001");
  });

  it("the zero-cost order reconciles at zero (an empty order completes with a zero G-59 — the honest shape is W-22's golden)", () => {
    const verdict = reconcileWorkOrderCosts({
      laborTotal: "0",
      partsTotal: "0",
      externalTotal: "0",
      glExpenseDebit: "0",
    });
    expect(verdict.balanced).toBe(true);
  });
});

describe("PHASE-049 W-18 — the NBV fold (D-06, G-61's reclassification amount)", () => {
  it("NBV = cost − accumulated at the exact 4-dp quantum (the fixture asset: 100,000 − 25,000 = 75,000)", () => {
    expect(netBookValue("100000", "25000")).toBe("75000");
  });

  it("a fully depreciated asset carries NBV 0 (the zero-NBV transfer's own shape — the approval flips the branch with no entry)", () => {
    expect(netBookValue("100000", "100000")).toBe("0");
    expect(netBookValue("0", "0")).toBe("0");
  });

  it("the 4-dp exactness holds (no float, no rounding — the scaled-integer core)", () => {
    expect(netBookValue("100.0001", "0.0001")).toBe("100");
    expect(netBookValue("1000000", "333333.3333")).toBe("666666.6667");
  });

  it("accumulated exceeding cost refuses (the register's own floor — never a negative NBV)", () => {
    expect(() => netBookValue("1000", "1000.0001")).toThrow(/exceeds cost/);
    expect(() => netBookValue("100", "-1")).toThrow(/non-negative/);
  });
});
