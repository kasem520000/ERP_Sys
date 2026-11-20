import { describe, expect, it } from "vitest";

import {
  advanceApplicationPlan,
  billingCeilingCheck,
  certificateAmounts,
  releaseGatesSatisfied,
  sumMoney4,
} from "../domain/contracting-math";

/**
 * PHASE-048 (W-11 — the plan §4's unit-first law): the PURE contracting
 * folds proven BEFORE any consumer lands — every example HAND-COMPUTED
 * (the W-9/W-10 lesson: the scale algebra is where the bugs live, so
 * each arm states its arithmetic).
 *
 * THE SCALE ALGEBRA (BR-092's fold): gross_m4 × hold_m2 sits at scale
 * 10⁶; retention_m4 = round(gross_m4 × hold_m2 / 10⁴) — ONE half-up
 * rounding; net = gross − retention EXACT, so the 0103 arithmetic floor
 * `retention + net = gross` holds BY CONSTRUCTION.
 *   10,000.0000 × 10.00% = 1,000.0000 exactly
 *    9,999.9999 ×  7.50% = 749.99999925 → 750.0000 (half-up at 4-dp)
 *       33.3333 × 33.33% = 11.10998889… → 11.1100
 */

describe("PHASE-048 W-11 — the pure contracting folds (unit-first)", () => {
  // -- BR-092: certificateAmounts (the % from the contract) ------------------

  it("the exact fold: gross 10,000 × hold 10.00% → retention 1,000 / net 9,000 (the fixture's own sub-certificate shape)", () => {
    const amounts = certificateAmounts("10000.0000", "10.00");
    expect(amounts.retention).toBe("1000.0000");
    expect(amounts.net).toBe("9000.0000");
    // the arithmetic floor by construction
    expect(sumMoney4([amounts.retention, amounts.net])).toBe("10000.0000");
  });

  it("the half-up rounding: 9,999.9999 × 7.50% = 749.99999925 → retention 750.0000 / net 9,249.9999", () => {
    const amounts = certificateAmounts("9999.9999", "7.50");
    expect(amounts.retention).toBe("750.0000");
    expect(amounts.net).toBe("9249.9999");
    expect(sumMoney4([amounts.retention, amounts.net])).toBe("9999.9999");
  });

  it("the fractional percent: 33.3333 × 33.33% = 11.10998889… → retention 11.1100 / net 22.2233 (ONE rounding, half-up — the first-run hand-slip corrected at the claim site: 333,333 × 3,333 = 1,110,998,889; /10⁴ → 111,099.8889 → 111,100)", () => {
    const amounts = certificateAmounts("33.3333", "33.33");
    expect(amounts.retention).toBe("11.1100");
    expect(amounts.net).toBe("22.2233");
    expect(sumMoney4([amounts.retention, amounts.net])).toBe("33.3333");
  });

  it("the boundary percents: hold 0 retains nothing (net = gross); hold 100 retains everything (net = 0)", () => {
    expect(certificateAmounts("1234.5678", "0.00")).toEqual({
      retention: "0.0000",
      net: "1234.5678",
    });
    expect(certificateAmounts("1234.5678", "100.00")).toEqual({
      retention: "1234.5678",
      net: "0.0000",
    });
  });

  it("the out-of-band percents refuse (never a fabricated fold): negative or > 100", () => {
    expect(() => certificateAmounts("100.0000", "-1.00")).toThrow(/holdPercent/);
    expect(() => certificateAmounts("100.0000", "100.01")).toThrow(/holdPercent/);
    expect(() => certificateAmounts("-1.0000", "10.00")).toThrow(/gross/);
  });

  // -- sumMoney4 (the ceiling's Σ) -------------------------------------------

  it("the exact sum: 0 + 90,000 + 10,000.0005 = 100,000.0005 (no rounding — the inputs are already 4-dp)", () => {
    expect(sumMoney4(["0.0000", "90000.0000", "10000.0005"])).toBe("100000.0005");
    expect(sumMoney4([])).toBe("0.0000");
  });

  // -- BR-093: billingCeilingCheck (the typed refusal's figures) -------------

  it("within the ceiling: 90,000 billed + 10,000 this = 100,000 = the ceiling (the boundary is LEGAL)", () => {
    const verdict = billingCeilingCheck("90000.0000", "10000.0000", "100000.0000");
    expect(verdict.exceeded).toBe(false);
    expect(verdict.cumulativeAfter).toBe("100000.0000");
    expect(verdict.overage).toBe("0.0000");
  });

  it("the excess carries its exact figure — 90,000 + 15,000 vs 100,000 → overage 5,000 (never a silent truncation)", () => {
    const verdict = billingCeilingCheck("90000.0000", "15000.0000", "100000.0000");
    expect(verdict.exceeded).toBe(true);
    expect(verdict.cumulativeAfter).toBe("105000.0000");
    expect(verdict.overage).toBe("5000.0000");
  });

  it("the sub-cent excess still refuses: 99,999.9999 + 0.0002 vs 100,000 → overage 0.0001", () => {
    const verdict = billingCeilingCheck("99999.9999", "0.0002", "100000.0000");
    expect(verdict.exceeded).toBe(true);
    expect(verdict.overage).toBe("0.0001");
  });

  it("a change-order-reduced ceiling bites: 90,000 + 10,000 vs 99,999.9999 → overage 0.0001 (the deltas are SIGNED)", () => {
    const verdict = billingCeilingCheck("90000.0000", "10000.0000", "99999.9999");
    expect(verdict.exceeded).toBe(true);
    expect(verdict.overage).toBe("0.0001");
  });

  // -- the advance amortization plan (the G-33 mirror) ------------------------

  it("the oldest-first fold: A(20,000; applied 5,000) + B(8,000; applied 0), amount 12,000 → A takes all 12,000", () => {
    const plan = advanceApplicationPlan(
      [
        { id: "A", gross: "20000.0000", applied: "5000.0000" },
        { id: "B", gross: "8000.0000", applied: "0.0000" },
      ],
      "12000.0000",
    );
    expect(plan.slices).toEqual([{ id: "A", apply: "12000.0000" }]);
    expect(plan.totalApplied).toBe("12000.0000");
    expect(plan.unapplied).toBe("0.0000");
  });

  it("the spill: amount 20,000 → A's remaining 15,000 then B's 5,000 (oldest first, never beyond any remaining)", () => {
    const plan = advanceApplicationPlan(
      [
        { id: "A", gross: "20000.0000", applied: "5000.0000" },
        { id: "B", gross: "8000.0000", applied: "0.0000" },
      ],
      "20000.0000",
    );
    expect(plan.slices).toEqual([
      { id: "A", apply: "15000.0000" },
      { id: "B", apply: "5000.0000" },
    ]);
    expect(plan.totalApplied).toBe("20000.0000");
    expect(plan.unapplied).toBe("0.0000");
  });

  it("the exhausted advances: amount 30,000 → A 15,000 + B 8,000 = 23,000 applied, 7,000 unapplied (the honest residual)", () => {
    const plan = advanceApplicationPlan(
      [
        { id: "A", gross: "20000.0000", applied: "5000.0000" },
        { id: "B", gross: "8000.0000", applied: "0.0000" },
      ],
      "30000.0000",
    );
    expect(plan.slices).toEqual([
      { id: "A", apply: "15000.0000" },
      { id: "B", apply: "8000.0000" },
    ]);
    expect(plan.totalApplied).toBe("23000.0000");
    expect(plan.unapplied).toBe("7000.0000");
  });

  it("no advances (or all fully applied) applies NOTHING — the honest shape, no fabricated slices", () => {
    expect(advanceApplicationPlan([], "5000.0000")).toEqual({
      slices: [],
      totalApplied: "0.0000",
      unapplied: "5000.0000",
    });
    const exhausted = advanceApplicationPlan(
      [{ id: "A", gross: "100.0000", applied: "100.0000" }],
      "5000.0000",
    );
    expect(exhausted.slices).toEqual([]);
    expect(exhausted.totalApplied).toBe("0.0000");
  });

  // -- G-56: the release gates (the documented schedule law) ------------------

  it("the taking-over gate: a missing date blocks; a future date blocks; an elapsed date passes", () => {
    expect(releaseGatesSatisfied({ today: "2026-06-15", takingOverDate: null, defectLiabilityDate: null }))
      .toEqual({ satisfied: false, blocker: "TAKING_OVER_MISSING" });
    expect(releaseGatesSatisfied({ today: "2026-06-15", takingOverDate: "2026-07-01", defectLiabilityDate: null }))
      .toEqual({ satisfied: false, blocker: "TAKING_OVER_NOT_ELAPSED" });
    expect(releaseGatesSatisfied({ today: "2026-06-15", takingOverDate: "2026-06-15", defectLiabilityDate: null }))
      .toEqual({ satisfied: true, blocker: null });
  });

  it("the defect-liability gate: a contracted DLP must ALSO be elapsed; the boundary date passes; no DLP contracted → the taking-over alone", () => {
    expect(releaseGatesSatisfied({ today: "2026-06-15", takingOverDate: "2026-06-01", defectLiabilityDate: "2027-06-01" }))
      .toEqual({ satisfied: false, blocker: "DEFECT_LIABILITY_NOT_ELAPSED" });
    expect(releaseGatesSatisfied({ today: "2027-06-01", takingOverDate: "2026-06-01", defectLiabilityDate: "2027-06-01" }))
      .toEqual({ satisfied: true, blocker: null });
    expect(releaseGatesSatisfied({ today: "2026-06-02", takingOverDate: "2026-06-01", defectLiabilityDate: null }))
      .toEqual({ satisfied: true, blocker: null });
  });
});
