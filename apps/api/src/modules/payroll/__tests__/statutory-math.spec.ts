import { describe, expect, it } from "vitest";

import {
  clampBase,
  contributionAmount,
  foldEosbTiers,
  foldPitBrackets,
  foldWageBase,
  matchesAppliesTo,
  resolveExemptions,
  serviceYearsBetween,
  trueUpDelta,
} from "../domain/statutory-math";

/**
 * PHASE-046 (W-2) — the pure statutory engines' unit specs (the
 * `attendance-classification` precedent: no clock, no store, no I/O).
 * Every law the DB specs rely on is pinned HERE first, on the plan's own
 * worked numbers:
 *
 * - THE GOSI WORKED EXAMPLE (the owner's corrected schedule): Saudi
 *   employee basic 10,000 + housing 2,000 → wage base 12,000 → pension
 *   1,080.0000/1,080.0000 + SANED 90.0000/90.0000 = employee 1,170.0000 /
 *   employer 1,170.0000 + OH 240.0000 employer-only (employer total
 *   1,410.0000); the non-Saudi arm OH-only.
 * - THE DUAL-CAP CLAMP: base 50,000 → pension at 45,000, SANED at 15,000,
 *   OH at 45,000.
 * - THE PIT WORKED EXAMPLE: brackets 0–10k @0% · 10–30k @10% · 30k+ @20%,
 *   allowance 5,000, per-dependent 1,000: gross 40,000 → taxable 35,000
 *   → 3,000.0000; +2 dependents → 2,600.0000.
 * - THE EOSB TIER FOLD: 7 years × eosBase 9,000 → 5×15 + 2×30 = 135 days
 *   → 40,500.0000 (the per-tier rounding explicit).
 * - D-02: NULL nationality matches NOTHING (fail-closed).
 */

const KSA_TIERS = [
  { fromYears: "0.00", toYears: "5.00", daysPerYear: "15.00" },
  { fromYears: "5.00", toYears: null, daysPerYear: "30.00" },
] as const;

describe("the wage-base fold (D-01)", () => {
  it("folds only the contributory keys — the KSA law: basic + HOUSING", () => {
    const components = [
      { key: "BASIC", amount: "10000.0000" },
      { key: "HOUSING", amount: "2000.0000" },
      { key: "TRANSPORT", amount: "500.0000" },
      { key: "GOSI-EE", amount: "1170.0000" },
    ];
    expect(foldWageBase(components, ["BASIC", "HOUSING"])).toBe("12000.0000");
    expect(foldWageBase(components, ["BASIC"])).toBe("10000.0000");
    expect(foldWageBase(components, [])).toBe("0.0000");
  });
});

describe("the clamp law (D-01 — the dual-cap worked example)", () => {
  it("base 12,000 is inside every GOSI cap — no clamp", () => {
    expect(clampBase("12000.0000", "1500.0000", "45000.0000")).toEqual({
      clamped: "12000.0000",
      clampedBy: null,
    });
  });

  it("base 50,000 clamps at the caps: pension/OH 45,000, SANED 15,000", () => {
    expect(clampBase("50000.0000", "1500.0000", "45000.0000")).toEqual({
      clamped: "45000.0000",
      clampedBy: "MAX",
    });
    expect(clampBase("50000.0000", "1500.0000", "15000.0000")).toEqual({
      clamped: "15000.0000",
      clampedBy: "MAX",
    });
  });

  it("a base below base_min lifts to the floor (the honest minimum wage base)", () => {
    expect(clampBase("900.0000", "1500.0000", "45000.0000")).toEqual({
      clamped: "1500.0000",
      clampedBy: "MIN",
    });
  });

  it("NULL bounds never clamp", () => {
    expect(clampBase("999999.0000", null, null)).toEqual({
      clamped: "999999.0000",
      clampedBy: null,
    });
  });
});

describe("the contribution law (4dp half-up, one rounding point)", () => {
  it("the GOSI worked example on base 12,000", () => {
    expect(contributionAmount("9.0000", "12000.0000")).toBe("1080.0000"); // pension ×2
    expect(contributionAmount("0.7500", "12000.0000")).toBe("90.0000"); // SANED ×2
    expect(contributionAmount("2.0000", "12000.0000")).toBe("240.0000"); // OH employer-only
  });

  it("the clamped arms on base 50,000", () => {
    expect(contributionAmount("9.0000", "45000.0000")).toBe("4050.0000");
    expect(contributionAmount("0.7500", "15000.0000")).toBe("112.5000");
    expect(contributionAmount("2.0000", "45000.0000")).toBe("900.0000");
  });

  it("rounds half-up at 4dp (9% of 1,000.005 → 90.0005 — the exact half steps up)", () => {
    expect(contributionAmount("9.0000", "1000.0050")).toBe("90.0005"); // 90.00045 → 90.0005
  });
});

describe("the applies-to law (D-01/D-02 — NULL fails closed)", () => {
  it("CITIZEN matches only the tenant jurisdiction's nationals", () => {
    expect(matchesAppliesTo("CITIZEN", "SA", "SA")).toBe(true);
    expect(matchesAppliesTo("CITIZEN", "AE", "SA")).toBe(false);
  });

  it("NON_CITIZEN matches the complement", () => {
    expect(matchesAppliesTo("NON_CITIZEN", "AE", "SA")).toBe(true);
    expect(matchesAppliesTo("NON_CITIZEN", "SA", "SA")).toBe(false);
  });

  it("ALL matches every NON-NULL nationality — and NULL matches nothing (fail-closed)", () => {
    expect(matchesAppliesTo("ALL", "SA", "SA")).toBe(true);
    expect(matchesAppliesTo("ALL", "EG", "SA")).toBe(true);
    expect(matchesAppliesTo("ALL", null, "SA")).toBe(false);
    expect(matchesAppliesTo("CITIZEN", null, "SA")).toBe(false);
    expect(matchesAppliesTo("NON_CITIZEN", null, "SA")).toBe(false);
  });
});

describe("the exemption resolution (D-03)", () => {
  it("the worked example: gross 40,000, allowance 5,000 → taxable 35,000", () => {
    const result = resolveExemptions({
      gross: "40000.0000",
      personalAllowanceDefault: "5000.0000",
      perDependentAllowance: "1000.0000",
    });
    expect(result.taxable).toBe("35000.0000");
    expect(result.totalExemptions).toBe("5000.0000");
  });

  it("+2 dependents → taxable 33,000", () => {
    const result = resolveExemptions({
      gross: "40000.0000",
      personalAllowanceDefault: "5000.0000",
      perDependentAllowance: "1000.0000",
      override: { dependents: "2" },
    });
    expect(result.dependentAllowance).toBe("2000.0000");
    expect(result.taxable).toBe("33000.0000");
  });

  it("the employee override replaces the personal allowance; absent fields keep the defaults", () => {
    const result = resolveExemptions({
      gross: "40000.0000",
      personalAllowanceDefault: "5000.0000",
      perDependentAllowance: "1000.0000",
      override: { personalAllowance: "8000.0000" },
    });
    expect(result.personalAllowance).toBe("8000.0000");
    expect(result.dependents).toBe("0");
    expect(result.taxable).toBe("32000.0000");
  });

  it("the 'other' override stacks and the taxable floors at zero", () => {
    const result = resolveExemptions({
      gross: "4000.0000",
      personalAllowanceDefault: "5000.0000",
      perDependentAllowance: "1000.0000",
      override: { other: "500.0000" },
    });
    expect(result.taxable).toBe("0.0000");
    expect(result.totalExemptions).toBe("5500.0000");
  });
});

describe("the PIT marginal fold (D-03 — the worked example)", () => {
  const BRACKETS = [
    { floor: "0.0000", ceiling: "10000.0000", rate: "0.0000" },
    { floor: "10000.0000", ceiling: "30000.0000", rate: "10.0000" },
    { floor: "30000.0000", ceiling: null, rate: "20.0000" },
  ] as const;

  it("taxable 35,000 → 3,000.0000 (the zero band + 10% + 20% slices)", () => {
    const fold = foldPitBrackets("35000.0000", BRACKETS);
    expect(fold.tax).toBe("3000.0000");
    expect(fold.sliceTotal).toBe(fold.tax);
    expect(fold.slices).toHaveLength(3);
    expect(fold.slices[0]).toMatchObject({ slice: "10000.0000", amount: "0.0000" });
    expect(fold.slices[1]).toMatchObject({ slice: "20000.0000", amount: "2000.0000" });
    expect(fold.slices[2]).toMatchObject({ slice: "5000.0000", amount: "1000.0000" });
  });

  it("taxable 33,000 (the +2-dependents case) → 2,600.0000", () => {
    expect(foldPitBrackets("33000.0000", BRACKETS).tax).toBe("2600.0000");
  });

  it("the zero band alone (taxable 8,000) → zero tax, one slice", () => {
    const fold = foldPitBrackets("8000.0000", BRACKETS);
    expect(fold.tax).toBe("0.0000");
    expect(fold.slices).toHaveLength(1);
  });

  it("a rate that produces a half-unit rounds per-slice half-up and the total is the exact sum", () => {
    const fold = foldPitBrackets("11000.0000", [
      { floor: "0.0000", ceiling: "10000.0000", rate: "0.0000" },
      { floor: "10000.0000", ceiling: null, rate: "3.3333" },
    ]);
    // 1,000 × 3.3333% = 33.333 → 33.3330 (the only slice that prices)
    expect(fold.slices[1]!.amount).toBe("33.3330");
    expect(fold.tax).toBe("33.3330");
    expect(fold.sliceTotal).toBe(fold.tax);
  });
});

describe("the EOSB tier fold (D-04 — the KSA worked example)", () => {
  it("7 years × eosBase 9,000 → 135 days → 40,500.0000 (the per-tier rounding explicit)", () => {
    const fold = foldEosbTiers("7.00", "9000.0000", KSA_TIERS);
    expect(fold.days).toBe("135.0000");
    expect(fold.entitlement).toBe("40500.0000");
    expect(fold.breakdown).toHaveLength(2);
    expect(fold.breakdown[0]).toMatchObject({ yearsInTier: "5.0000", days: "75.0000", amount: "22500.0000" });
    expect(fold.breakdown[1]).toMatchObject({ yearsInTier: "2.0000", days: "60.0000", amount: "18000.0000" });
  });

  it("exactly 5 years stays in the first tier (to_years is exclusive)", () => {
    const fold = foldEosbTiers("5.00", "9000.0000", KSA_TIERS);
    expect(fold.days).toBe("75.0000");
    expect(fold.entitlement).toBe("22500.0000");
    expect(fold.breakdown).toHaveLength(1);
  });

  it("a fractional year folds proportionally per tier (2.50 years → 37.5 days)", () => {
    const fold = foldEosbTiers("2.50", "9000.0000", KSA_TIERS);
    expect(fold.days).toBe("37.5000");
    expect(fold.entitlement).toBe("11250.0000");
  });

  it("zero service years fold zero — the honest no-entitlement state", () => {
    const fold = foldEosbTiers("0.00", "9000.0000", KSA_TIERS);
    expect(fold.days).toBe("0.0000");
    expect(fold.entitlement).toBe("0.0000");
    expect(fold.breakdown).toHaveLength(0);
  });
});

describe("the true-up delta + the service-years lens (BR-087)", () => {
  it("the delta is signed and exact: entitlement − provision", () => {
    expect(trueUpDelta("40500.0000", "30000.0000")).toBe("10500.0000");
    expect(trueUpDelta("40500.0000", "45000.0000")).toBe("-4500.0000");
    expect(trueUpDelta("40500.0000", "40500.0000")).toBe("0.0000");
  });

  it("service years compute half-up at 2dp", () => {
    expect(serviceYearsBetween("2020-01-01", "2027-01-01")).toBe("7.00");
    expect(serviceYearsBetween("2020-01-01", "2026-01-01")).toBe("6.00");
  });
});
