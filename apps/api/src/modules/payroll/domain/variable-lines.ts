import { Decimal } from "@erp/domain-core";

import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";

/**
 * PHASE-046 (W-3, T-07 — D-08) — THE PURE VARIABLE-LINE MATH (the
 * `attendance-classification` precedent: no clock, no store, no I/O —
 * the unit spec pins every law BEFORE the run integration consumes it).
 *
 * The run consumes the feed ONCE through the service boundary
 * (FeedService.variableFeed — the handoff contract; BR-084's read-only
 * law enforced in its SQL) and lands the period's facts as variable
 * lines. Every knob is OFF/NULL by default (BR-055 — no fabricated
 * rate, no fabricated deduction):
 *
 *   OVERTIME EARNING = totalMultipliedHours × hourly rate, where the
 *   hourly rate = basic / 30 / hoursPerDay (the tenant's
 *   payroll.variable.overtime_hours_per_day — NO default: while unset
 *   the line lands UNPRICED, the amount stays 0.0000, and the explicit
 *   run warning fires — never a guessed divisor);
 *
 *   ABSENCE DEDUCTION = absenceDays × basic / 30, GATED by
 *   payroll.variable.absence_deduction (enum off/on, default off);
 *
 *   LATE DEDUCTION = lateMinutes × (basic / 30 / hoursPerDay / 60),
 *   GATED by payroll.variable.late_deduction (default off) and by the
 *   SAME divisor (unset ⇒ unpriced, the identical fail-closed law);
 *
 *   MISSING_PUNCH is INFORMATIONAL ONLY — its own count in the
 *   breakdown, NEVER folded into absence or any deduction (the T-10
 *   law);
 *
 *   The leave balance cells ride the breakdown as the feed's snapshot
 *   (the encashment path is G-51, untouched — no new machinery, the
 *   run never encashes).
 *
 * Every money value is a canonical 4dp half-up string (ADR-0009); each
 * rate and each product is its own explicit rounding point, recorded
 * in the breakdown (the G-40 discipline — reconstructable to the last
 * half-unit).
 */

/** Canonical 4dp half-up. */
function money(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** The frozen variable breakdown (D-05's `variable_breakdown` jsonb —
 * the feed's period facts + the applied rates, the as-of snapshot the
 * run froze; register corrections after calculate surface in the NEXT
 * period's run, documented in the catalog row). */
export interface VariableBreakdown {
  /** Σ the feeding entries' multiplied hours (the feed's exact
   * numeric(12,2) sum — informational; the pricing applies below). */
  readonly multipliedHours: string;
  /** basic / 30 / hoursPerDay, half-up 4dp — NULL while the tenant
   * divisor is unset (the UNPRICED state, never a fabricated rate). */
  readonly overtimeHourlyRate: string | null;
  /** multipliedHours × hourlyRate, half-up 4dp (0.0000 while unpriced). */
  readonly overtimeAmount: string;
  /** The derivation's ABSENT day count (the feed's verdict). */
  readonly absenceDays: number;
  /** basic / 30, half-up 4dp — the per-day dock rate (recorded when the
   * gate is on; the days are recorded either way). */
  readonly absenceDailyRate: string | null;
  /** absenceDays × basic/30, half-up 4dp (0.0000 while the gate is off). */
  readonly absenceAmount: string;
  /** Σ the derivation's LATE minutes (the exact minute facts). */
  readonly lateMinutes: number;
  /** basic / 30 / hoursPerDay / 60, half-up 4dp — NULL while the divisor
   * is unset or the gate is off (never a fabricated rate). */
  readonly lateRatePerMinute: string | null;
  /** lateMinutes × the per-minute rate, half-up 4dp. */
  readonly lateAmount: string;
  /** MISSING_PUNCH days — INFORMATIONAL ONLY (its own count, never
   * folded into absence or any deduction — the T-10 law). */
  readonly missingPunchDays: number;
  /** The feed's leave-balance snapshot cells at period close (rows, not
   * views — the encashment path is G-51, untouched; the run never
   * encashes, never writes the leave registers). */
  readonly leaveBalances: readonly {
    leaveTypeCode: string;
    year: number;
    entitlementDays: string;
    usedDays: string;
    carriedForwardDays: string;
    remainingDays: string;
  }[];
}

/** The knobs the run read once (BR-055 — OFF/NULL by default). */
export interface VariableKnobs {
  /** payroll.variable.overtime_hours_per_day — int 1…24, NO default. */
  readonly overtimeHoursPerDay: number | null;
  /** payroll.variable.absence_deduction — "off" | "on" (default off). */
  readonly absenceDeduction: "off" | "on";
  /** payroll.variable.late_deduction — "off" | "on" (default off). */
  readonly lateDeduction: "off" | "on";
}

/** The feed's per-employee facts the fold consumes (the service
 * boundary's row — only the fields the pricing needs). */
export interface VariableFeedFacts {
  readonly multipliedHours: string;
  readonly absenceDays: number;
  readonly missingPunchDays: number;
  readonly lateMinutes: number;
  readonly leaveBalances: readonly {
    leaveTypeCode: string;
    year: number;
    entitlementDays: string;
    usedDays: string;
    carriedForwardDays: string;
    remainingDays: string;
  }[];
}

/** The empty breakdown (an employee with no feeding facts — the run
 * still freezes the shape; zero sections are not noise). */
export function emptyVariableBreakdown(): VariableBreakdown {
  return {
    multipliedHours: "0.00",
    overtimeHourlyRate: null,
    overtimeAmount: "0.0000",
    absenceDays: 0,
    absenceDailyRate: null,
    absenceAmount: "0.0000",
    lateMinutes: 0,
    lateRatePerMinute: null,
    lateAmount: "0.0000",
    missingPunchDays: 0,
    leaveBalances: [],
  };
}

/** The overtime hourly rate: basic / 30 / hoursPerDay, half-up 4dp. */
export function overtimeHourlyRate(basic: string, hoursPerDay: number): string {
  return money(
    new Decimal(basic).div(new Decimal(30)).div(new Decimal(hoursPerDay)).toFixed(4),
  );
}

/** The overtime earning: multipliedHours × hourlyRate, half-up 4dp. */
export function overtimeEarning(multipliedHours: string, hourlyRate: string): string {
  return money(new Decimal(multipliedHours).times(new Decimal(hourlyRate)).toFixed(4));
}

/** The absence per-day dock rate: basic / 30, half-up 4dp. */
export function absenceDailyRate(basic: string): string {
  return money(new Decimal(basic).div(new Decimal(30)).toFixed(4));
}

/** The absence deduction: absenceDays × basic/30, half-up 4dp. */
export function absenceDeduction(absenceDays: number, basic: string): string {
  return money(new Decimal(absenceDays).times(new Decimal(absenceDailyRate(basic))).toFixed(4));
}

/** The late per-minute rate: basic / 30 / hoursPerDay / 60, half-up 4dp. */
export function lateRatePerMinute(basic: string, hoursPerDay: number): string {
  return money(
    new Decimal(basic)
      .div(new Decimal(30))
      .div(new Decimal(hoursPerDay))
      .div(new Decimal(60))
      .toFixed(4),
  );
}

/** The late deduction: lateMinutes × the per-minute rate, half-up 4dp. */
export function lateDeduction(lateMinutes: number, basic: string, hoursPerDay: number): string {
  return money(
    new Decimal(lateMinutes).times(new Decimal(lateRatePerMinute(basic, hoursPerDay))).toFixed(4),
  );
}

/** The warnings the variable fold surfaces (explicit, never silent). */
export interface VariableWarnings {
  /** The overtime line landed UNPRICED — the tenant divisor is unset
   * (never a fabricated rate; set payroll.variable.overtime_hours_per_day). */
  readonly unpricedOvertime: { employeeCode: string; multipliedHours: string }[];
  /** The late gate is ON but the divisor is unset — the late line stays
   * unpriced (the identical fail-closed law, the identical fix). */
  readonly unpricedLate: { employeeCode: string; lateMinutes: number }[];
  /** A gated variable deduction clamped so the line's net stays ≥ 0
   * (the loan-clamp precedent — explicit, never a silent dock). */
  readonly variableClamps: {
    employeeCode: string;
    kind: "ABSENCE" | "LATE";
    scheduled: string;
    clampedTo: string;
  }[];
}

export function emptyVariableWarnings(): VariableWarnings {
  return { unpricedOvertime: [], unpricedLate: [], variableClamps: [] };
}

/** The priced variable line: the breakdown + the earning/deduction
 * amounts. Pure — the caller (the run calculation) supplies the facts
 * and the knobs, the fold prices exactly and clamps the GATED
 * deductions (never the law's statutory amounts) so the pre-loan net
 * stays ≥ 0. */
export function priceVariableLine(input: {
  employeeCode: string;
  basic: string;
  facts: VariableFeedFacts;
  knobs: VariableKnobs;
  /** The deductions already owed before the variable gates (the
   * structure deductions + the statutory employee share + PIT) — the
   * clamps keep gross − prior − variable ≥ 0. */
  priorDeductions: string;
  gross: string;
  warnings: VariableWarnings;
}): { breakdown: VariableBreakdown; overtimeAmount: string; absenceAmount: string; lateAmount: string } {
  const { facts, knobs } = input;

  // Overtime: the earning rides the gross side (unclamped — an earning
  // cannot make net negative); UNPRICED while the divisor is unset.
  let otRate: string | null = null;
  let overtimeAmount = "0.0000";
  if (compareExact(facts.multipliedHours, "0.00") > 0) {
    if (knobs.overtimeHoursPerDay === null) {
      input.warnings.unpricedOvertime.push({
        employeeCode: input.employeeCode,
        multipliedHours: facts.multipliedHours,
      });
    } else {
      otRate = overtimeHourlyRate(input.basic, knobs.overtimeHoursPerDay);
      overtimeAmount = overtimeEarning(facts.multipliedHours, otRate);
    }
  }

  // The gated deductions clamp against the remaining net (the loan
  // precedent: explicit, absence docks before late).
  const grossPlusOvertime = addExact(input.gross, overtimeAmount);
  let remaining = subExact(grossPlusOvertime, input.priorDeductions);
  if (compareExact(remaining, "0.0000") < 0) {
    remaining = "0.0000";
  }

  let absRate: string | null = null;
  let absenceAmount = "0.0000";
  if (facts.absenceDays > 0 && knobs.absenceDeduction === "on") {
    absRate = absenceDailyRate(input.basic);
    const scheduled = absenceDeduction(facts.absenceDays, input.basic);
    absenceAmount = compareExact(scheduled, remaining) <= 0 ? scheduled : remaining;
    if (compareExact(absenceAmount, scheduled) !== 0) {
      input.warnings.variableClamps.push({
        employeeCode: input.employeeCode,
        kind: "ABSENCE",
        scheduled,
        clampedTo: absenceAmount,
      });
    }
    remaining = subExact(remaining, absenceAmount);
  }

  let lateRate: string | null = null;
  let lateAmount = "0.0000";
  if (facts.lateMinutes > 0 && knobs.lateDeduction === "on") {
    if (knobs.overtimeHoursPerDay === null) {
      // The same divisor, the same fail-closed law: ON without a divisor
      // is UNPRICED — never a fabricated rate, never a silent dock.
      input.warnings.unpricedLate.push({
        employeeCode: input.employeeCode,
        lateMinutes: facts.lateMinutes,
      });
    } else {
      lateRate = lateRatePerMinute(input.basic, knobs.overtimeHoursPerDay);
      const scheduled = lateDeduction(facts.lateMinutes, input.basic, knobs.overtimeHoursPerDay);
      lateAmount = compareExact(scheduled, remaining) <= 0 ? scheduled : remaining;
      if (compareExact(lateAmount, scheduled) !== 0) {
        input.warnings.variableClamps.push({
          employeeCode: input.employeeCode,
          kind: "LATE",
          scheduled,
          clampedTo: lateAmount,
        });
      }
    }
  }

  return {
    breakdown: {
      multipliedHours: facts.multipliedHours,
      overtimeHourlyRate: otRate,
      overtimeAmount,
      absenceDays: facts.absenceDays,
      absenceDailyRate: absRate,
      absenceAmount,
      lateMinutes: facts.lateMinutes,
      lateRatePerMinute: lateRate,
      lateAmount,
      missingPunchDays: facts.missingPunchDays, // informational only — never folded
      leaveBalances: facts.leaveBalances,
    },
    overtimeAmount,
    absenceAmount,
    lateAmount,
  };
}
