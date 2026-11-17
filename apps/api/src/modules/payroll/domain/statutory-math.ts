import { Decimal } from "@erp/domain-core";

import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";

/**
 * PHASE-046 (W-2) — THE PURE STATUTORY MATH (the `attendance-classification`
 * precedent: no clock, no store, no I/O — the unit spec pins every law).
 *
 * Everything operates on canonical 4-dp decimal STRINGS (ADR-0009 — no
 * binary floating point anywhere near money); the only rounding points are
 * explicit and half-up at the money scale (the G-40 discipline — rounding
 * residuals are carried in the breakdowns, never absorbed):
 *
 *   THE WAGE-BASE FOLD (D-01): the contributory wage base is the sum of
 *   the structure component values whose key ∈ the row's contributory_keys
 *   (DATA, never hard-coded — the KSA law: basic + HOUSING).
 *
 *   THE CLAMP LAW (D-01): each row clamps the base into [base_min,
 *   base_max] (NULL = unbounded) BEFORE the rate applies — GOSI's dual
 *   caps are the pinned worked example: base 50,000 → pension at 45,000,
 *   SANED at 15,000.
 *
 *   THE CONTRIBUTION LAW: amount = rate% × clamped base, half-up 4dp —
 *   one rounding point, exact inputs (INV-032's exactness).
 *
 *   THE APPLIES-TO LAW (D-01/D-02): CITIZEN rows match only nationals of
 *   the tenant's jurisdiction; NON_CITIZEN the complement; ALL everyone —
 *   and a NULL nationality matches NOTHING (fail-closed — never a guessed
 *   rate; the caller surfaces the explicit warning).
 *
 *   THE PIT MARGINAL FOLD (D-03): tax = Σ over the bracket slices a rate
 *   covers, each slice amount rounded half-up 4dp and summed exactly; the
 *   breakdown carries every slice + the residual so the total is
 *   reconstructable to the last half-unit.
 *
 *   THE EXEMPTION RESOLUTION (D-03): taxable = max(0, gross − personal
 *   allowance − dependents × per-dependent − other), the set defaults
 *   overridden per employee, absent = the defaults (never a fabricated
 *   value).
 *
 *   THE EOSB TIER FOLD (D-04): service years distribute over the tier
 *   rows (from_years inclusive, to_years exclusive — the KSA seed's
 *   0–5 × 15 + >5 × 30 shape); days = Σ years-in-tier × days_per_year,
 *   each tier's days rounded half-up 4dp; entitlement = Σ tier days/30 ×
 *   eosBase, each tier rounded half-up 4dp (7 years × eosBase 9,000 →
 *   75 + 60 = 135 days → 5×(15/30×9,000) + 2×(30/30×9,000) = 40,500.0000).
 */

/** Canonical 4dp half-up (the run-calculation `money` precedent). */
function money(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

// -- the wage-base fold (D-01) -----------------------------------------------------

/** One structure component's priced value as the fold sees it. */
export interface ContributoryComponentValue {
  readonly key: string;
  readonly amount: string;
}

/** The contributory wage base: Σ amounts of the components whose key ∈
 * contributoryKeys (exact; an empty key set folds 0.0000 — the row then
 * contributes nothing unless base_min lifts it, the honest DATA shape). */
export function foldWageBase(
  components: readonly ContributoryComponentValue[],
  contributoryKeys: readonly string[],
): string {
  const wanted = new Set(contributoryKeys);
  let base = "0.0000";
  for (const component of components) {
    if (wanted.has(component.key)) {
      base = addExact(base, component.amount);
    }
  }
  return base;
}

// -- the clamp law (D-01) ----------------------------------------------------------

export interface ClampResult {
  /** The clamped base the rate applies to. */
  readonly clamped: string;
  /** Which bound engaged (null = the raw base was already in range). */
  readonly clampedBy: "MIN" | "MAX" | null;
}

/** Clamp the wage base into [baseMin, baseMax] (null = unbounded). */
export function clampBase(base: string, baseMin: string | null, baseMax: string | null): ClampResult {
  if (baseMin !== null && compareExact(base, baseMin) < 0) {
    return { clamped: baseMin, clampedBy: "MIN" };
  }
  if (baseMax !== null && compareExact(base, baseMax) > 0) {
    return { clamped: baseMax, clampedBy: "MAX" };
  }
  return { clamped: base, clampedBy: null };
}

// -- the contribution law ----------------------------------------------------------

/** rate% × clamped base, half-up 4dp — the one rounding point. */
export function contributionAmount(ratePercent: string, clampedBase: string): string {
  return money(
    new Decimal(clampedBase).times(new Decimal(ratePercent)).div(new Decimal(100)).toFixed(4),
  );
}

// -- the applies-to law (D-01/D-02) ------------------------------------------------

export type AppliesTo = "ALL" | "CITIZEN" | "NON_CITIZEN";

/** Does the row apply to this employee? NULL nationality matches NOTHING
 * (fail-closed — D-02: no guessed arm, the caller surfaces the warning). */
export function matchesAppliesTo(
  appliesTo: AppliesTo,
  nationality: string | null,
  tenantCountryCode: string,
): boolean {
  if (nationality === null || nationality === undefined) {
    return false;
  }
  if (appliesTo === "CITIZEN") {
    return nationality === tenantCountryCode;
  }
  if (appliesTo === "NON_CITIZEN") {
    return nationality !== tenantCountryCode;
  }
  return true;
}

// -- the PIT marginal fold (D-03) --------------------------------------------------

/** One bracket row as the fold sees it (floor inclusive, ceiling NULL =
 * the open top). */
export interface PitBracket {
  readonly floor: string;
  readonly ceiling: string | null;
  readonly rate: string;
}

/** One computed slice in the fold's breakdown (reconstructable to the
 * last half-unit — the G-40 discipline). */
export interface PitSlice {
  readonly floor: string;
  readonly ceiling: string | null;
  readonly rate: string;
  /** The taxable income that fell inside this bracket (≤ the slice width). */
  readonly slice: string;
  /** rate% × slice, half-up 4dp. */
  readonly amount: string;
}

export interface PitFoldResult {
  readonly tax: string;
  readonly slices: readonly PitSlice[];
  /** Σ slice amounts — equals `tax` exactly (no absorbed residual). */
  readonly sliceTotal: string;
}

/** The marginal fold: taxable income distributes bottom-up over the
 * sorted brackets; each slice's amount rounds half-up 4dp and the total
 * is the exact sum of the rounded slices (INV-032's exactness — the
 * rounding is per-slice explicit, never re-rounded at the end). */
export function foldPitBrackets(taxable: string, brackets: readonly PitBracket[]): PitFoldResult {
  const sorted = [...brackets].sort((a, b) => compareExact(a.floor, b.floor));
  let remaining = taxable;
  let total = "0.0000";
  const slices: PitSlice[] = [];
  for (const bracket of sorted) {
    if (compareExact(remaining, "0.0000") <= 0) {
      break;
    }
    const width =
      bracket.ceiling === null
        ? remaining
        : compareExact(remaining, subExact(bracket.ceiling, bracket.floor)) <= 0
          ? remaining
          : subExact(bracket.ceiling, bracket.floor);
    if (compareExact(width, "0.0000") <= 0) {
      continue;
    }
    const amount = money(
      new Decimal(width).times(new Decimal(bracket.rate)).div(new Decimal(100)).toFixed(4),
    );
    slices.push({ floor: bracket.floor, ceiling: bracket.ceiling, rate: bracket.rate, slice: width, amount });
    total = addExact(total, amount);
    remaining = subExact(remaining, width);
  }
  return { tax: total, slices, sliceTotal: total };
}

// -- the exemption resolution (D-03) ------------------------------------------------

export interface ExemptionInputs {
  readonly gross: string;
  /** The bracket set's defaults (personal_allowance_default, per_dependent_allowance). */
  readonly personalAllowanceDefault: string;
  readonly perDependentAllowance: string;
  /** The employee's overrides (employees.pit_exemptions jsonb — absent
   * fields fall back to the set defaults; never a fabricated value). */
  readonly override?: { personalAllowance?: string; dependents?: string; other?: string } | null;
}

export interface ExemptionResult {
  readonly personalAllowance: string;
  readonly dependents: string;
  readonly perDependentAllowance: string;
  readonly dependentAllowance: string;
  readonly other: string;
  readonly totalExemptions: string;
  readonly taxable: string;
}

/** taxable = max(0, gross − personal − dependents × per-dependent −
 * other), floored at 0 — the overrides replace the set defaults field by
 * field (absent = the default). */
export function resolveExemptions(input: ExemptionInputs): ExemptionResult {
  const personalAllowance = input.override?.personalAllowance ?? input.personalAllowanceDefault;
  const dependents = input.override?.dependents ?? "0";
  const other = input.override?.other ?? "0.0000";
  const dependentAllowance = money(
    new Decimal(dependents).times(new Decimal(input.perDependentAllowance)).toFixed(4),
  );
  const totalExemptions = addExact(addExact(personalAllowance, dependentAllowance), other);
  const rawTaxable = subExact(input.gross, totalExemptions);
  const taxable = compareExact(rawTaxable, "0.0000") < 0 ? "0.0000" : rawTaxable;
  return {
    personalAllowance,
    dependents,
    perDependentAllowance: input.perDependentAllowance,
    dependentAllowance,
    other,
    totalExemptions,
    taxable,
  };
}

// -- the EOSB tier fold (D-04) -------------------------------------------------------

/** One tier row as the fold sees it (from_years inclusive, to_years NULL
 * = the open top; the KSA seed: 0–5 × 15 days, >5 × 30 days). */
export interface EosbTier {
  readonly fromYears: string;
  readonly toYears: string | null;
  readonly daysPerYear: string;
}

/** One tier's computed share in the breakdown. */
export interface EosbTierShare {
  readonly fromYears: string;
  readonly toYears: string | null;
  readonly daysPerYear: string;
  /** The service years that fell inside this tier. */
  readonly yearsInTier: string;
  /** yearsInTier × daysPerYear, half-up 4dp. */
  readonly days: string;
  /** days / 30 × eosBase, half-up 4dp (the per-tier rounding point). */
  readonly amount: string;
}

export interface EosbFoldResult {
  /** Σ tier days (exact sum of the rounded per-tier days). */
  readonly days: string;
  /** Σ tier amounts (exact sum of the rounded per-tier amounts). */
  readonly entitlement: string;
  readonly breakdown: readonly EosbTierShare[];
}

/** The per-service-year fold: serviceYears distribute bottom-up over the
 * sorted tiers; each tier's days and amount round half-up 4dp and the
 * totals are the exact sums of the rounded parts (the rounding is
 * per-tier explicit — INV-032(c)'s exactness). The eosBase is the 029
 * concept (basic + is_eos_base allowances) frozen in the calculation
 * snapshot. */
export function foldEosbTiers(
  serviceYears: string,
  eosBase: string,
  tiers: readonly EosbTier[],
): EosbFoldResult {
  const sorted = [...tiers].sort((a, b) => compareExact(a.fromYears, b.fromYears));
  let remaining = serviceYears;
  let days = "0.0000";
  let entitlement = "0.0000";
  const breakdown: EosbTierShare[] = [];
  for (const tier of sorted) {
    if (compareExact(remaining, "0.0000") <= 0) {
      break;
    }
    const width =
      tier.toYears === null
        ? remaining
        : compareExact(remaining, subExact(tier.toYears, tier.fromYears)) <= 0
          ? remaining
          : subExact(tier.toYears, tier.fromYears);
    if (compareExact(width, "0.0000") <= 0) {
      continue;
    }
    const tierDays = money(
      new Decimal(width).times(new Decimal(tier.daysPerYear)).toFixed(4),
    );
    const amount = money(
      new Decimal(tierDays).div(new Decimal(30)).times(new Decimal(eosBase)).toFixed(4),
    );
    breakdown.push({
      fromYears: tier.fromYears,
      toYears: tier.toYears,
      daysPerYear: tier.daysPerYear,
      yearsInTier: width,
      days: tierDays,
      amount,
    });
    days = addExact(days, tierDays);
    entitlement = addExact(entitlement, amount);
    remaining = subExact(remaining, width);
  }
  return { days, entitlement, breakdown };
}

/** The true-up delta (BR-087): entitlement − provision, signed, 4dp exact
 * (positive accrues, negative releases, zero posts nothing). */
export function trueUpDelta(entitlement: string, provisionBalance: string): string {
  return subExact(entitlement, provisionBalance);
}

/** Service years between two dates, half-up 2dp (the calculation
 * snapshot's service_years — the tier fold's input). */
export function serviceYearsBetween(fromDate: string, toDate: string): string {
  const from = new Date(`${fromDate}T00:00:00Z`).getTime();
  const to = new Date(`${toDate}T00:00:00Z`).getTime();
  const years = (to - from) / (365.25 * 24 * 60 * 60 * 1000);
  return new Decimal(years).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

// -- the statutory breakdown + the summary fold (W-3, D-05/D-06) ----------------------

/** One frozen per-profile-row entry in a line's `statutory_breakdown`
 * (the INV-032(a) evidence: rate × clamped base == the row's share,
 * exact 4dp — reconstructable to the last half-unit). */
export interface StatutoryBreakdownEntry {
  /** The profile row's code (GOSI-PENSION / GOSI-SANED / GOSI-OH / …). */
  readonly code: string;
  readonly kind: "CONTRIBUTION" | "PIT";
  readonly appliesTo?: AppliesTo;
  /** The contributory wage base BEFORE the row's clamp. */
  readonly base?: string;
  /** The base AFTER the row's [base_min, base_max] clamp. */
  readonly clampedBase?: string;
  /** Which bound engaged (null = the raw base was in range). */
  readonly clampedBy?: "MIN" | "MAX" | null;
  readonly employeeRate?: string;
  readonly employerRate?: string;
  readonly employeeAmount: string;
  readonly employerAmount: string;
}

/** One `statutory_summary` row on the run (D-05): the per-profile-row
 * remittance liability tracking — accrued at calculate (frozen with the
 * lines), advanced by the settlement (G-52's remittance leg). */
export interface StatutorySummaryRow {
  readonly code: string;
  readonly kind: "CONTRIBUTION" | "PIT";
  /** Σ (employee + employer) share over the run's lines (the PIT row:
   * Σ pitWithheld) — the DEDUCTIONS_PAYABLE liability the run posted. */
  readonly accrued: string;
  /** Σ settled through the remittance machinery — advances inside the
   * run gate; accrued − remitted is the outstanding liability. */
  readonly remitted: string;
}

/** The per-row accruals the fold consumes (one per line × profile row
 * — the frozen breakdown entries + the line's PIT total). */
export interface StatutoryAccrualInput {
  readonly code: string;
  readonly kind: "CONTRIBUTION" | "PIT";
  /** The row's employee + employer amounts (for the PIT row: the
   * withheld total rides employeeAmount; employerAmount "0.0000"). */
  readonly employeeAmount: string;
  readonly employerAmount: string;
}

/** Fold the run's `statutory_summary` from the frozen line breakdowns
 * (D-05): per (code, kind) the exact Σ (employee + employer) shares,
 * first-seen order preserved (deterministic — the same lines always
 * fold the same summary); `remitted` starts at 0.0000 (a DRAFT run has
 * never settled — the remittance requires POSTED, and every recalc
 * resets the lines and re-folds the summary). */
export function foldStatutorySummary(
  accruals: readonly StatutoryAccrualInput[],
): StatutorySummaryRow[] {
  const order: { code: string; kind: "CONTRIBUTION" | "PIT" }[] = [];
  const byKey = new Map<string, StatutorySummaryRow>();
  for (const accrual of accruals) {
    const key = `${accrual.kind}|${accrual.code}`;
    const existing = byKey.get(key);
    if (existing === undefined) {
      order.push({ code: accrual.code, kind: accrual.kind });
      byKey.set(key, {
        code: accrual.code,
        kind: accrual.kind,
        accrued: addExact(accrual.employeeAmount, accrual.employerAmount),
        remitted: "0.0000",
      });
    } else {
      byKey.set(key, {
        ...existing,
        accrued: addExact(
          existing.accrued,
          addExact(accrual.employeeAmount, accrual.employerAmount),
        ),
      });
    }
  }
  return order.map(({ code, kind }) => byKey.get(`${kind}|${code}`)!);
}