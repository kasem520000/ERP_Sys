import { describe, expect, it } from "vitest";

import {
  TOLERANCE_VERDICTS,
  bandShapeValid,
  evaluateTolerance,
  type ToleranceBand,
} from "./spec-tolerance";

/**
 * PHASE-050 (W-25 — T-05, 2026-11-23) THE TOLERANCE FOLD'S PROPERTY
 * TESTS (the unit-first law): the pinned reference values walk every
 * verdict shape — the no-fabrication law (UNBANDED), the one-sided
 * bands, the closed-interval boundaries (the value ON the limit is
 * WITHIN), the inverted-band refusal shape, and the decimal exactness
 * (6-dp values compare exactly, never through a float).
 */

const BAND = (targetValue: string, ucl: string | null, lcl: string | null): ToleranceBand => ({
  targetValue,
  ucl,
  lcl,
});

describe("evaluateTolerance — the no-fabrication law", () => {
  it("a parameter with NO tolerance ends is UNBANDED — the value is recorded, never judged", () => {
    expect(evaluateTolerance(BAND("10.000000", null, null), "999.000000")).toBe("UNBANDED");
    expect(evaluateTolerance(BAND("10.000000", null, null), "0.000001")).toBe("UNBANDED");
  });

  it("the target itself evaluates WITHIN under every band shape", () => {
    expect(evaluateTolerance(BAND("10.000000", "10.500000", "9.500000"), "10.000000")).toBe(
      "WITHIN",
    );
    expect(evaluateTolerance(BAND("10.000000", "10.500000", null), "10.000000")).toBe("WITHIN");
    expect(evaluateTolerance(BAND("10.000000", null, "9.500000"), "10.000000")).toBe("WITHIN");
  });
});

describe("evaluateTolerance — the closed interval [LCL, UCL] (inclusive limits)", () => {
  it("the value ON the upper limit is WITHIN (the limit itself is tolerated)", () => {
    expect(evaluateTolerance(BAND("10.000000", "10.500000", "9.500000"), "10.500000")).toBe(
      "WITHIN",
    );
  });

  it("the value ON the lower limit is WITHIN", () => {
    expect(evaluateTolerance(BAND("10.000000", "10.500000", "9.500000"), "9.500000")).toBe(
      "WITHIN",
    );
  });

  it("one unit-in-the-last-place above the UCL is ABOVE_UCL (6-dp exactness)", () => {
    expect(evaluateTolerance(BAND("10.000000", "10.500000", "9.500000"), "10.500001")).toBe(
      "ABOVE_UCL",
    );
  });

  it("one unit-in-the-last-place below the LCL is BELOW_LCL", () => {
    expect(evaluateTolerance(BAND("10.000000", "10.500000", "9.500000"), "9.499999")).toBe(
      "BELOW_LCL",
    );
  });
});

describe("evaluateTolerance — the one-sided bands", () => {
  it("a UCL-only band judges only the upper side (no fabricated lower limit)", () => {
    expect(evaluateTolerance(BAND("10.000000", "10.500000", null), "0.000000")).toBe("WITHIN");
    expect(evaluateTolerance(BAND("10.000000", "10.500000", null), "10.500001")).toBe(
      "ABOVE_UCL",
    );
  });

  it("an LCL-only band judges only the lower side (no fabricated upper limit)", () => {
    expect(evaluateTolerance(BAND("10.000000", null, "9.500000"), "1000.000000")).toBe(
      "WITHIN",
    );
    expect(evaluateTolerance(BAND("10.000000", null, "9.500000"), "9.499999")).toBe(
      "BELOW_LCL",
    );
  });

  it("negative measured values and limits are exact (the sign is never special-cased)", () => {
    expect(evaluateTolerance(BAND("-10.000000", "-9.500000", "-10.500000"), "-10.500001")).toBe(
      "BELOW_LCL",
    );
    expect(evaluateTolerance(BAND("-10.000000", "-9.500000", "-10.500000"), "-9.500000")).toBe(
      "WITHIN",
    );
  });
});

describe("evaluateTolerance — the verdict vocabulary", () => {
  it("the verdict set is closed and pinned", () => {
    expect(TOLERANCE_VERDICTS).toEqual(["UNBANDED", "WITHIN", "ABOVE_UCL", "BELOW_LCL"]);
  });
});

describe("bandShapeValid — the create/update floor", () => {
  it("unset and one-sided bands are legal (the no-fabrication law's own allowance)", () => {
    expect(bandShapeValid({ ucl: null, lcl: null })).toBe(true);
    expect(bandShapeValid({ ucl: "10.500000", lcl: null })).toBe(true);
    expect(bandShapeValid({ ucl: null, lcl: "9.500000" })).toBe(true);
  });

  it("a real band is legal", () => {
    expect(bandShapeValid({ ucl: "10.500000", lcl: "9.500000" })).toBe(true);
  });

  it("a point band is refused (UCL = LCL — the 0113 floor's own wording)", () => {
    expect(bandShapeValid({ ucl: "10.000000", lcl: "10.000000" })).toBe(false);
  });

  it("an inverted band is refused", () => {
    expect(bandShapeValid({ ucl: "9.500000", lcl: "10.500000" })).toBe(false);
  });
});
