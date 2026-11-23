import { evaluateTolerance, type ToleranceBand, type ToleranceVerdict } from "./spec-tolerance";

/**
 * PHASE-050 (W-27 — T-11, 2026-11-23) THE COA GATE FOLD — BR-104's PURE
 * three-shape law (D-11): the certificate of analysis is blocked unless
 * EVERY parameter is within tolerance or carries an ACCEPTED-DEVIATION
 * NCR reference. THIS fold composes the tolerance fold — the module's
 * ONLY evaluator (W-25's law) — and never re-derives a verdict; the
 * service validates the NCR references against the register's own rows
 * (the ACCEPT disposition, the item match) and hands the fold the
 * pre-validated set, so the fold stays pure and the evidence chain
 * single-sourced.
 *
 * THE THREE SHAPES (BR-104's own law, each named in the refusal):
 *   1. WITHIN (or UNBANDED — recorded, never judged, the no-fabrication
 *      law) → the parameter PASSES; an unbanded parameter's value is
 *      recorded on the certificate with its verdict, never fabricated
 *      into a limit.
 *   2. OUTSIDE without an accepted-deviation reference → the parameter
 *      FAILS, and the refusal names the parameter, the measured value,
 *      and the breached limit (BOTH figures — the phase doc's wording).
 *   3. OUTSIDE with an accepted-deviation NCR reference → the parameter
 *      passes as DEVIATION_ACCEPTED, the NCR recorded on the frozen
 *      snapshot entry (the acceptance's own provenance).
 *
 * THE COVERAGE LAW (the certificate's own floor): every ACTIVE spec of
 * the item is measured exactly once — a missing parameter, a foreign
 * spec id, or a duplicate measurement blocks the certificate with the
 * offending parameters named. A certificate never skips a parameter and
 * never averages two measurements into one.
 *
 * THE FROZEN SNAPSHOT: the fold's entries ARE the snapshot the service
 * stores verbatim (each entry: the spec's own band + the measured value
 * + the tolerance verdict + the gate verdict + the NCR reference where
 * one was consumed) — the print reads this array VERBATIM (the W-13
 * print law: never recomputed).
 */

/** The per-parameter gate verdict (BR-104's three shapes + the
 * coverage-law verdicts the service surfaces as typed refusals). */
export type CoaGateVerdict =
  | "PASS"
  | "PASS_UNBANDED"
  | "PASS_DEVIATION_ACCEPTED"
  | "FAIL_OUTSIDE";

/** One frozen-snapshot entry — the certificate's own record. */
export interface CoaGateEntry {
  specId: string;
  parameter: string;
  parameterAr: string | null;
  unit: string | null;
  targetValue: string;
  ucl: string | null;
  lcl: string | null;
  /** The measured value, verbatim as provided. */
  value: string;
  /** The tolerance fold's own verdict (the ONLY evaluator). */
  toleranceVerdict: ToleranceVerdict;
  /** BR-104's gate verdict for this parameter. */
  gate: CoaGateVerdict;
  /** The breached limit when the parameter is outside (the refusal's
   * second figure — the measured value is the first). */
  breachedLimit: string | null;
  /** The accepted-deviation NCR consumed (shape 3's provenance). */
  ncrId: string | null;
}

export interface CoaSpecInput {
  id: string;
  parameter: string;
  parameterAr: string | null;
  unit: string | null;
  targetValue: string;
  ucl: string | null;
  lcl: string | null;
}

export interface CoaMeasuredInput {
  specId: string;
  value: string;
  /** The accepted-deviation NCR reference (validated by the service). */
  ncrId?: string | null;
}

export interface CoaGateResult {
  /** The frozen snapshot entries (spec order — the register's own). */
  entries: CoaGateEntry[];
  /** True when the certificate is blocked (any failure or coverage
   * breach) — the service throws the typed refusal on this flag. */
  blocked: boolean;
  /** The first failing parameter (BR-104's refusal names it with both
   * figures) — null when the block is a coverage breach or none. */
  firstFailure: { parameter: string; value: string; breachedLimit: string } | null;
  /** Coverage-law breaches, named: parameters with no measurement. */
  missing: string[];
  /** Measured spec ids that are not the item's active specs. */
  foreign: string[];
  /** Spec ids measured more than once. */
  duplicates: string[];
}

/**
 * THE FOLD: the item's active specs + the measured values + the
 * pre-validated accepted-deviation NCR set → the frozen snapshot and
 * the gate verdict. Total and deterministic (the register's own order;
 * a foreign/duplicate measurement never reorders anything).
 */
export function coaGateFold(
  specs: readonly CoaSpecInput[],
  measured: readonly CoaMeasuredInput[],
  acceptedDeviationNcrs: ReadonlySet<string>,
): CoaGateResult {
  const byId = new Map<string, CoaSpecInput>();
  for (const spec of specs) byId.set(spec.id, spec);

  const missing: string[] = [];
  const foreign: string[] = [];
  const duplicates: string[] = [];
  const measuredById = new Map<string, CoaMeasuredInput>();
  for (const item of measured) {
    if (!byId.has(item.specId)) {
      if (!foreign.includes(item.specId)) foreign.push(item.specId);
      continue;
    }
    if (measuredById.has(item.specId)) {
      if (!duplicates.includes(item.specId)) duplicates.push(item.specId);
      continue;
    }
    measuredById.set(item.specId, item);
  }

  const entries: CoaGateEntry[] = [];
  let firstFailure: CoaGateResult["firstFailure"] = null;
  for (const spec of specs) {
    const item = measuredById.get(spec.id);
    if (item === undefined) {
      missing.push(spec.parameter);
      continue;
    }
    const band: ToleranceBand = {
      targetValue: spec.targetValue,
      ucl: spec.ucl,
      lcl: spec.lcl,
    };
    const verdict = evaluateTolerance(band, item.value);
    // The breached limit (the tolerance fold's deterministic tie-break:
    // a real band's breach is one-sided by construction).
    const breachedLimit =
      verdict === "ABOVE_UCL" ? spec.ucl : verdict === "BELOW_LCL" ? spec.lcl : null;
    let gate: CoaGateVerdict;
    let ncrId: string | null = null;
    if (verdict === "WITHIN") {
      gate = "PASS";
    } else if (verdict === "UNBANDED") {
      gate = "PASS_UNBANDED";
    } else if (item.ncrId !== undefined && item.ncrId !== null && acceptedDeviationNcrs.has(item.ncrId)) {
      gate = "PASS_DEVIATION_ACCEPTED";
      ncrId = item.ncrId;
    } else {
      gate = "FAIL_OUTSIDE";
      if (firstFailure === null) {
        firstFailure = {
          parameter: spec.parameter,
          value: item.value,
          breachedLimit: breachedLimit ?? "unbanded",
        };
      }
    }
    entries.push({
      specId: spec.id,
      parameter: spec.parameter,
      parameterAr: spec.parameterAr,
      unit: spec.unit,
      targetValue: spec.targetValue,
      ucl: spec.ucl,
      lcl: spec.lcl,
      value: item.value,
      toleranceVerdict: verdict,
      gate,
      breachedLimit,
      ncrId,
    });
  }

  const blocked =
    firstFailure !== null || missing.length > 0 || foreign.length > 0 || duplicates.length > 0;
  return { entries, blocked, firstFailure, missing, foreign, duplicates };
}
