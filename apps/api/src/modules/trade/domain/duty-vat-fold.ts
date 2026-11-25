import { Decimal } from "@erp/domain-core";

/**
 * PHASE-051 (W-37 — T-10, 2026-11-25) THE DUTY/VAT LINE FOLD (L-07/L-08,
 * D-06 — the plan's own unit-first law, the pure layer FIRST with the
 * property tests beside it, then the service that renders its output
 * VERBATIM — zero parallel computation):
 *
 *   THE LINE MATH (the 0121 §2 comment's own demand: «the line math is
 *   W-37's pure fold (the Decimal discipline — ADR-0009)»): duty_amount
 *   = customs_value × duty_rate, computed on Decimal (NEVER a float),
 *   rounded to the ledger's own 4dp (ROUND_HALF_UP — the posting
 *   engine's canonical scale). The import VAT is the tenant's own
 *   figure on the line (its own computation discipline lives with the
 *   jurisdiction packs — REQUIRES_VERIFICATION, D-16's own law; the
 *   fold never invents it).
 *
 *   THE NO-HARDCODED-RATES LAW (the 0121 CHECK's caller-side face):
 *   the rates and amounts are the TENANT'S OWN DATA — a zero rate is
 *   the explicit tenant statement (EXW/free), never a fabricated
 *   default; a negative or non-finite figure is the typed refusal
 *   (the DB CHECK is the authority of last resort, the fold's verdict
 *   is the caller's).
 *
 *   THE TOTALS (the G-65 amount's own source — D-06: the completed
 *   declaration's duties and import VAT flow into the landed-cost
 *   allocation): Σ customs_value · Σ duty_amount · Σ import_vat · the
 *   LANDED AMOUNT = Σ (duty_amount + import_vat) — the amount the
 *   completion act passes to the REAL LandedCostService (sourced from
 *   the declaration's OWN lines, never recomputed anywhere else).
 *
 *   THE EXACT-Σ LAW: the totals are the Decimal sum of the per-line
 *   figures EXACTLY (no re-rounding of the total beyond each line's
 *   own 4dp — the lines are the truth; the landed amount's 4dp shape
 *   is the sum of 4dp figures, exact by construction).
 *
 *   PURE: no clock, no store, no SQL — the service renders this
 *   module's verdicts and totals VERBATIM (the completion act's
 *   landed-cost amount and the line writes carry the fold's own
 *   output).
 */

/** The fold's line input (the service's own write shape — the 0121
 * columns' caller-side face). */
export interface DutyVatLineInput {
  readonly customsValue: string;
  readonly dutyRate: string;
  readonly importVat: string;
}

/** The fold's line verdict — the computed duty amount + the typed
 * refusal verdict for the malformed shapes (the reason names the
 * field; the service re-throws it typed). */
export interface DutyVatLineVerdict {
  readonly dutyAmount: string | null;
  readonly reason: string | null;
}

/** Parse a Decimal safely — null on the unparseable shape (the fold
 * NEVER throws; DecimalError is itself a verdict, the caller's). */
function parseDecimal(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/** The fold's line math: duty_amount = customs_value × duty_rate on
 * Decimal, 4dp ROUND_HALF_UP (the ledger's canonical scale — the
 * posting engine's own). A zero rate is the explicit tenant statement
 * (EXX/free — duty 0); the malformed shapes carry the typed reason
 * (the fold NEVER throws — the verdict is the caller's). */
export function computeLineDuty(input: DutyVatLineInput): DutyVatLineVerdict {
  const value = parseDecimal(input.customsValue);
  if (value === null || value.isNegative()) {
    return {
      dutyAmount: null,
      reason: `customsValue must be a non-negative finite decimal (the customs value), got "${input.customsValue}" (the 0121 no-hardcoded-rates law)`,
    };
  }
  const rate = parseDecimal(input.dutyRate);
  if (rate === null || rate.isNegative()) {
    return {
      dutyAmount: null,
      reason: `dutyRate must be a non-negative finite decimal — the rates are the tenant's own data (a zero rate is the explicit EXX/free statement), got "${input.dutyRate}"`,
    };
  }
  const vat = parseDecimal(input.importVat);
  if (vat === null || vat.isNegative()) {
    return {
      dutyAmount: null,
      reason: `importVat must be a non-negative finite decimal (the tenant's own figure — REQUIRES_VERIFICATION, never invented), got "${input.importVat}"`,
    };
  }
  const duty = value.times(rate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return { dutyAmount: duty.toFixed(4), reason: null };
}

/** The fold's per-line computed shape (the service's write input —
 * every figure rendered VERBATIM from the fold). */
export interface ComputedDutyVatLine extends DutyVatLineInput {
  readonly dutyAmount: string;
}

/** The declaration's own totals (the G-65 amount's source — D-06's
 * exact wording: «sourced from the declaration's OWN lines»). */
export interface DutyVatTotals {
  readonly totalCustomsValue: string;
  readonly totalDuty: string;
  readonly totalImportVat: string;
  /** THE LANDED AMOUNT — Σ (duty_amount + import_vat): the amount the
   * completion act passes to the REAL LandedCostService. */
  readonly totalLandedAmount: string;
}

/** Σ over the computed lines — the Decimal sums EXACT (each line's own
 * figures at 4dp; the totals never re-rounded beyond the lines). */
export function computeDeclarationTotals(lines: readonly ComputedDutyVatLine[]): DutyVatTotals {
  let value = new Decimal(0);
  let duty = new Decimal(0);
  let vat = new Decimal(0);
  for (const line of lines) {
    value = value.plus(new Decimal(line.customsValue));
    duty = duty.plus(new Decimal(line.dutyAmount));
    vat = vat.plus(new Decimal(line.importVat));
  }
  const landed = duty.plus(vat);
  return {
    totalCustomsValue: value.toFixed(4),
    totalDuty: duty.toFixed(4),
    totalImportVat: vat.toFixed(4),
    totalLandedAmount: landed.toFixed(4),
  };
}

/** True when the line shapes pass the fold's floors (the service's
 * typed pre-check — the 0121 CHECK's caller-side face). */
export function isDutyVatLineValid(input: DutyVatLineInput): boolean {
  return computeLineDuty(input).dutyAmount !== null;
}
