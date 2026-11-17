import { describe, expect, it } from "vitest";

import {
  emptyVariableBreakdown,
  emptyVariableWarnings,
  lateRatePerMinute,
  overtimeEarning,
  overtimeHourlyRate,
  priceVariableLine,
  absenceDailyRate,
  type VariableFeedFacts,
  type VariableKnobs,
} from "../domain/variable-lines";
import { foldStatutorySummary } from "../domain/statutory-math";

/**
 * PHASE-046 (W-3, T-07) — the pure variable-line math's unit specs (the
 * `attendance-classification` precedent: no clock, no store, no I/O —
 * pinned BEFORE the run integration consumes them), on the plan's own
 * worked numbers (§4 variable-lines):
 *
 * - OVERTIME: basic 9,000, divisor 8 → hourly 37.5000; 4.50 multiplied
 *   hours → 168.7500 earning;
 * - THE UNPRICED STATE: the divisor unset → the amount stays 0.0000 +
 *   the explicit warning (never a fabricated rate);
 * - ABSENCE: 2 days × 300.0000 = 600.0000 — OFF by default, ON when
 *   configured;
 * - LATE: 60 min × 0.6250 = 37.5000 — gated; ON without the divisor is
 *   the same UNPRICED law;
 * - MISSING_PUNCH: informational only — its own count, never folded;
 * - THE CLAMP: the gated deductions never push the pre-loan net below
 *   zero (the loan precedent, explicit warning);
 * - THE SUMMARY FOLD: per (code, kind) the exact Σ shares, first-seen
 *   order, remitted starting at 0.0000.
 */

const NO_FACTS: VariableFeedFacts = {
  multipliedHours: "0.00",
  absenceDays: 0,
  missingPunchDays: 0,
  lateMinutes: 0,
  leaveBalances: [],
};

const KNOBS_OFF: VariableKnobs = {
  overtimeHoursPerDay: null,
  absenceDeduction: "off",
  lateDeduction: "off",
};

function factsOf(patch: Partial<VariableFeedFacts>): VariableFeedFacts {
  return { ...NO_FACTS, ...patch };
}

describe("PHASE-046 W-3 — the pure variable-line math (D-08)", () => {
  it("(a) the rate laws — hourly 37.5000, absence-day 300.0000, late-minute 0.6250 (basic 9,000, divisor 8)", () => {
    expect(overtimeHourlyRate("9000.0000", 8)).toBe("37.5000");
    expect(absenceDailyRate("9000.0000")).toBe("300.0000");
    expect(lateRatePerMinute("9000.0000", 8)).toBe("0.6250");
  });

  it("(b) OVERTIME — 4.50 multiplied hours × 37.5000 = 168.7500 earning (the §4 worked number)", () => {
    expect(overtimeEarning("4.50", "37.5000")).toBe("168.7500");
    const warnings = emptyVariableWarnings();
    const priced = priceVariableLine({
      employeeCode: "EMP-OT",
      basic: "9000.0000",
      facts: factsOf({ multipliedHours: "4.50" }),
      knobs: { ...KNOBS_OFF, overtimeHoursPerDay: 8 },
      priorDeductions: "0.0000",
      gross: "9000.0000",
      warnings,
    });
    expect(priced.overtimeAmount).toBe("168.7500");
    expect(priced.breakdown.overtimeHourlyRate).toBe("37.5000");
    expect(priced.breakdown.multipliedHours).toBe("4.50");
    expect(warnings.unpricedOvertime).toHaveLength(0);
  });

  it("(c) THE UNPRICED STATE — the divisor unset ⇒ 0.0000 + the explicit warning, never a fabricated rate", () => {
    const warnings = emptyVariableWarnings();
    const priced = priceVariableLine({
      employeeCode: "EMP-OT",
      basic: "9000.0000",
      facts: factsOf({ multipliedHours: "4.50" }),
      knobs: KNOBS_OFF, // no divisor, both gates off — the shipped defaults
      priorDeductions: "0.0000",
      gross: "9000.0000",
      warnings,
    });
    expect(priced.overtimeAmount).toBe("0.0000");
    expect(priced.breakdown.overtimeHourlyRate).toBeNull();
    expect(warnings.unpricedOvertime).toHaveLength(1);
    expect(warnings.unpricedOvertime[0]).toMatchObject({
      employeeCode: "EMP-OT",
      multipliedHours: "4.50",
    });
  });

  it("(d) ABSENCE — OFF by default (the fact recorded, nothing docked); ON ⇒ 2 × 300.0000 = 600.0000", () => {
    const facts = factsOf({ absenceDays: 2 });
    const off = priceVariableLine({
      employeeCode: "EMP-ABS",
      basic: "9000.0000",
      facts,
      knobs: KNOBS_OFF,
      priorDeductions: "0.0000",
      gross: "9000.0000",
      warnings: emptyVariableWarnings(),
    });
    expect(off.absenceAmount).toBe("0.0000");
    expect(off.breakdown.absenceDays).toBe(2); // the fact rides the breakdown either way
    expect(off.breakdown.absenceDailyRate).toBeNull();

    const on = priceVariableLine({
      employeeCode: "EMP-ABS",
      basic: "9000.0000",
      facts,
      knobs: { ...KNOBS_OFF, absenceDeduction: "on" },
      priorDeductions: "0.0000",
      gross: "9000.0000",
      warnings: emptyVariableWarnings(),
    });
    expect(on.absenceAmount).toBe("600.0000");
    expect(on.breakdown.absenceDailyRate).toBe("300.0000");
  });

  it("(e) LATE — gated; 60 min × 0.6250 = 37.5000 when ON with the divisor; ON WITHOUT the divisor is the same UNPRICED law", () => {
    const facts = factsOf({ lateMinutes: 60 });
    const on = priceVariableLine({
      employeeCode: "EMP-LATE",
      basic: "9000.0000",
      facts,
      knobs: { ...KNOBS_OFF, overtimeHoursPerDay: 8, lateDeduction: "on" },
      priorDeductions: "0.0000",
      gross: "9000.0000",
      warnings: emptyVariableWarnings(),
    });
    expect(on.lateAmount).toBe("37.5000");
    expect(on.breakdown.lateRatePerMinute).toBe("0.6250");

    const unpriced = emptyVariableWarnings();
    const onNoDivisor = priceVariableLine({
      employeeCode: "EMP-LATE",
      basic: "9000.0000",
      facts,
      knobs: { ...KNOBS_OFF, lateDeduction: "on" }, // ON, divisor unset
      priorDeductions: "0.0000",
      gross: "9000.0000",
      warnings: unpriced,
    });
    expect(onNoDivisor.lateAmount).toBe("0.0000");
    expect(onNoDivisor.breakdown.lateRatePerMinute).toBeNull();
    expect(unpriced.unpricedLate).toHaveLength(1);
  });

  it("(f) MISSING_PUNCH — informational only: its own count in the breakdown, never a deduction", () => {
    const priced = priceVariableLine({
      employeeCode: "EMP-MP",
      basic: "9000.0000",
      facts: factsOf({ missingPunchDays: 3, absenceDays: 1 }),
      knobs: { ...KNOBS_OFF, absenceDeduction: "on" },
      priorDeductions: "0.0000",
      gross: "9000.0000",
      warnings: emptyVariableWarnings(),
    });
    expect(priced.breakdown.missingPunchDays).toBe(3);
    // ONLY the 1 ABSENT day docks (300.0000); the 3 MISSING_PUNCH days
    // never enter any amount (the T-10 law).
    expect(priced.absenceAmount).toBe("300.0000");
    expect(priced.lateAmount).toBe("0.0000");
    expect(priced.overtimeAmount).toBe("0.0000");
  });

  it("(g) THE CLAMP — the gated deductions never push the pre-loan net below zero (the explicit warning, never a silent over-dock)", () => {
    const warnings = emptyVariableWarnings();
    // Gross 900 − prior deductions 850 ⇒ 50 remaining, but 2 absent days
    // schedule 60.0000: the absence clamps to 50.0000 and the late gate
    // (also on, 60 min ⇒ 1.2500 scheduled) docks nothing further.
    const priced = priceVariableLine({
      employeeCode: "EMP-CLAMP",
      basic: "900.0000",
      facts: factsOf({ absenceDays: 2, lateMinutes: 60 }),
      knobs: { overtimeHoursPerDay: 8, absenceDeduction: "on", lateDeduction: "on" },
      priorDeductions: "850.0000",
      gross: "900.0000",
      warnings,
    });
    expect(priced.absenceAmount).toBe("50.0000");
    expect(priced.lateAmount).toBe("0.0000");
    expect(warnings.variableClamps).toHaveLength(2);
    expect(warnings.variableClamps[0]).toMatchObject({
      kind: "ABSENCE",
      scheduled: "60.0000",
      clampedTo: "50.0000",
    });
    expect(warnings.variableClamps[1]).toMatchObject({
      kind: "LATE",
      scheduled: "3.7500", // 60 × (900/30/8/60 = 0.0625)
      clampedTo: "0.0000",
    });
  });

  it("(h) the empty breakdown — an employee with no feeding facts still freezes the zero shape", () => {
    const empty = emptyVariableBreakdown();
    expect(empty.multipliedHours).toBe("0.00");
    expect(empty.overtimeAmount).toBe("0.0000");
    expect(empty.absenceAmount).toBe("0.0000");
    expect(empty.lateAmount).toBe("0.0000");
    expect(empty.leaveBalances).toEqual([]);
  });

  it("(i) THE SUMMARY FOLD — per (code, kind) exact Σ shares, first-seen order, remitted 0.0000; the PIT row rides the withheld total", () => {
    const summary = foldStatutorySummary([
      { code: "GOSI-PENSION", kind: "CONTRIBUTION", employeeAmount: "1080.0000", employerAmount: "1080.0000" },
      { code: "GOSI-SANED", kind: "CONTRIBUTION", employeeAmount: "90.0000", employerAmount: "90.0000" },
      { code: "GOSI-OH", kind: "CONTRIBUTION", employeeAmount: "0.0000", employerAmount: "240.0000" },
      { code: "GOSI-PENSION", kind: "CONTRIBUTION", employeeAmount: "405.0000", employerAmount: "405.0000" },
      { code: "PIT", kind: "PIT", employeeAmount: "3000.0000", employerAmount: "0.0000" },
    ]);
    expect(summary.map((row) => row.code)).toEqual([
      "GOSI-PENSION",
      "GOSI-SANED",
      "GOSI-OH",
      "PIT",
    ]);
    expect(summary[0]).toEqual({
      code: "GOSI-PENSION",
      kind: "CONTRIBUTION",
      accrued: "2970.0000", // 2,160 + 810 — the exact fold
      remitted: "0.0000",
    });
    expect(summary[1]!.accrued).toBe("180.0000");
    expect(summary[2]!.accrued).toBe("240.0000");
    expect(summary[3]).toEqual({
      code: "PIT",
      kind: "PIT",
      accrued: "3000.0000",
      remitted: "0.0000",
    });
    // Σ accrued over the CONTRIBUTION rows — the multi-line fold is the
    // point: two lines' GOSI-PENSION shares collapse into ONE summary row
    // (2,160 + 810 = 2,970), the exact-add law holding across repeats.
    const gosi = summary
      .filter((row) => row.kind === "CONTRIBUTION")
      .reduce((acc, row) => Number(acc) + Number(row.accrued), 0);
    expect(gosi).toBe(3390); // 2,970 + 180 + 240
  });
});
