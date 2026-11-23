import { Decimal } from "@erp/domain-core";

/**
 * PHASE-050 (W-25 — T-05, 2026-11-23) THE SPECIFICATION TOLERANCE FOLD —
 * the PURE arithmetic of the quality specifications (the unit-first
 * law; the plan §4's unit list). This fold is THE ONLY tolerance
 * evaluator in the module: the inspection-result mapping contract
 * reads it, the future COA gate (BR-104, W-27) reads it, and nothing
 * re-derives a verdict anywhere (zero parallel computation).
 *
 * THE NO-FABRICATION LAW (0113's own floor): an unset tolerance end is
 * UNTOLERATED — never a fabricated limit. A parameter with neither
 * UCL nor LCL evaluates UNBANDED (the value is recorded, never judged);
 * a one-sided band judges only its set side; a real band judges both
 * sides with INCLUSIVE limits (the value ON the limit is WITHIN — the
 * tolerance band is the closed interval [LCL, UCL]).
 */

export type ToleranceVerdict = "UNBANDED" | "WITHIN" | "ABOVE_UCL" | "BELOW_LCL";

export interface ToleranceBand {
  /** The parameter's target value (the recorded aim, never a limit). */
  targetValue: string;
  /** Upper control limit — nullable (the no-fabrication law). */
  ucl: string | null;
  /** Lower control limit — nullable (the no-fabrication law). */
  lcl: string | null;
}

export const TOLERANCE_VERDICTS: readonly ToleranceVerdict[] = [
  "UNBANDED",
  "WITHIN",
  "ABOVE_UCL",
  "BELOW_LCL",
];

/** The fold: a measured value against a band. Total and order-free —
 * the UCL check runs first so a two-sided breach reports ABOVE_UCL
 * (the deterministic tie-break; a value cannot breach both sides of a
 * real band by construction). */
export function evaluateTolerance(band: ToleranceBand, value: string): ToleranceVerdict {
  const measured = new Decimal(value);
  if (band.ucl !== null && measured.greaterThan(new Decimal(band.ucl))) {
    return "ABOVE_UCL";
  }
  if (band.lcl !== null && measured.lessThan(new Decimal(band.lcl))) {
    return "BELOW_LCL";
  }
  if (band.ucl === null && band.lcl === null) {
    return "UNBANDED";
  }
  return "WITHIN";
}

/**
 * The band's own shape verdict (the create/update floor — the service
 * refuses a point or inverted band BEFORE the 0113 CHECK so the caller
 * gets the parameter and both figures; the DB floor remains the
 * authority of last resort).
 */
export function bandShapeValid(band: { ucl: string | null; lcl: string | null }): boolean {
  if (band.ucl === null || band.lcl === null) return true; // unset/one-sided: legal
  return new Decimal(band.ucl).greaterThan(new Decimal(band.lcl));
}
