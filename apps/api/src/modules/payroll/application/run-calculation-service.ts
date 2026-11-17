import { Decimal } from "@erp/domain-core";

import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { findPeriodById } from "../../accounting/infrastructure/accounting.store";
import { readEffectiveSetting, ownTenantCountryCode } from "../../../infra/settings/setting-reader";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { lockPayrollRun } from "../../hr/infrastructure/atomic";
import { FeedService } from "../../hr/application/feed-service";
import {
  EosBasisRequiredError,
  LoanDeductionCapError,
  RunEmptyError,
  RunImmutableError,
  RunNotFoundError,
  RunPeriodExistsError,
  StructureNotActiveError,
} from "../domain/payroll-errors";
import {
  foldStatutorySummary,
  type StatutoryAccrualInput,
  type StatutoryBreakdownEntry,
  type StatutorySummaryRow,
} from "../domain/statutory-math";
import {
  emptyVariableWarnings,
  priceVariableLine,
  type VariableBreakdown,
  type VariableKnobs,
  type VariableWarnings,
} from "../domain/variable-lines";
import { PitEngine } from "./pit-engine";
import { StatutoryProfileService } from "./statutory-profile-service";
import * as store from "../infrastructure/payroll.store";
import type { ComponentRow, LoanLineRow, RunRow } from "../infrastructure/payroll.store";
/**
 * Run calculation service (PHASE-029 T4): the per-employee computation
 * from the frozen ACTIVE structure. Calculation order is FIXED and
 * documented (phase §5 T4): basic → PERCENT_OF_BASIC → PERCENT_OF_GROSS →
 * FIXED, half-up at each component (ADR-0009 — Decimal toDecimalPlaces;
 * no Math.* anywhere).
 *
 * PHASE-046 (W-3, T-05+T-07) — THE STATUTORY + VARIABLE EXTENSION: the
 * calculation now prices the statutory arms (the profile service's
 * applies-to resolution + the PIT engine) and the variable lines (the
 * feed called ONCE through the service boundary — the handoff
 * contract), freezing the breakdowns on the lines (D-05's extension
 * columns; INV-025's fold extends by construction):
 *
 *   gross            = the structure fold + the overtime EARNING;
 *   deductions       = structure deductions + the STATUTORY EMPLOYEE
 *                      SHARE + PIT + the GATED variable deductions
 *                      (absence/late — OFF by default, BR-055);
 *   employer column  = structure employer contributions + the STATUTORY
 *                      EMPLOYER SHARE (G-53's amount);
 *   net              = gross − deductions (the CHECKs unwidened — the
 *                      new columns are breakdowns of the folded totals).
 *
 * THE LAWS:
 * - D-09 THE RUN GATE: calculate takes `payroll.run|{runId}` BEFORE the
 *   status read — the DRAFT reset (the sanctioned line DELETE) and the
 *   fresh insert are one window under the lock, so a concurrent
 *   calculate/post/remittance pair serializes (the reset never eats a
 *   posted run; two resets collapse to one line set — the T-17 duel).
 * - D-02 FAIL-CLOSED: a NULL nationality prices NO statutory lines and
 *   surfaces the explicit `unpricedNationality` warning — never a
 *   guessed rate; D-07's no-profile state (no live rows for the
 *   tenant's jurisdiction) is the run-level `noStatutoryProfile` note.
 * - BR-085: a REQUIRES_VERIFICATION row that WOULD have matched refuses
 *   the WHOLE calculation typed (audited in the service's own UoW —
 *   zero residue: no lines are touched, the DRAFT run stays empty).
 * - D-08: the feed is called ONCE per run; the overtime divisor is a
 *   tenant setting with NO default — unset ⇒ the UNPRICED line + the
 *   explicit warning (never a fabricated rate); the gated deductions
 *   clamp so the pre-loan net stays ≥ 0 (the loan precedent, warned);
 *   MISSING_PUNCH is informational only (the T-10 law); the leave
 *   snapshot rides the breakdown read-only (the encashment path is
 *   G-51, untouched — the run never encashes).
 * - BR-054's cap basis is the PRE-LOAN net — all non-loan deductions
 *   (structure + statutory employee share + PIT + gated variable) land
 *   before the loan clamp; the 029-era shapes are unchanged when the
 *   new arms are zero (the additive-only law).
 *
 * PERCENT_OF_GROSS components resolve against the earnings accumulated
 * BEFORE them in the fixed order; loan deductions clamp oldest-first
 * (BR-054); EOS accrual rides the structure snapshot (BR-055 — basic +
 * is_eos_base allowances, never the variable earnings). The written
 * lines freeze component_snapshot (BR-052) — posted history never
 * depends on later structure edits. The write phase folds the run
 * totals from the SAME line values it writes (INV-025 by construction)
 * and the `statutory_summary` from the frozen breakdowns (D-05 — the
 * remittance liability tracking; `remitted` starts at zero: a DRAFT run
 * has never settled).
 */

/** One calculated employee line (pre-write). */
export interface CalculatedLine {
  employee: store.EmployeeRow;
  structure: { id: string; code: string; name: string };
  componentValues: { component: ComponentRow; computed: string }[];
  gross: string;
  employeeDeductions: string;
  employerContributions: string;
  eosAccrual: string;
  loanDeductions: { loanId: string; lineId: string; amount: string }[];
  loanDeductionsTotal: string;
  net: string;
  /** PHASE-046 (W-3): the statutory arm (the profile service's 4dp-exact
   *  resolution — zero rows when the employee matches none, D-02). */
  statutoryEmployeeShare: string;
  statutoryEmployerShare: string;
  statutoryBreakdown: StatutoryBreakdownEntry[];
  /** The PIT engine's withheld total + the frozen evidence (the snapshot
   *  carries the slices — the G-40 discipline). */
  pitWithheld: string;
  /** The variable arm (D-08): the amounts + the frozen breakdown. */
  variableOvertimeAmount: string;
  variableAbsenceAmount: string;
  variableLateAmount: string;
  variableBreakdown: VariableBreakdown;
}

export interface CalculationWarnings {
  /** BR-054 clamps: loan deductions capped to the percent of net. */
  loanClamps: { employeeCode: string; loanId: string; scheduled: string; clampedTo: string }[];
  /** Employees skipped (no ACTIVE structure assigned — explicit, never silent). */
  skippedEmployees: { code: string; reason: string }[];
  /** PHASE-046 (D-02): NULL nationality — no statutory lines priced
   *  (fail-closed; set employees.nationality). */
  unpricedNationality: { employeeCode: string; employeeId: string }[];
  /** PHASE-046 (D-07): the tenant's jurisdiction carries no live
   *  statutory rows — zero statutory lines, the honest no-profile state. */
  noStatutoryProfile: { jurisdictionCode: string }[];
  /** PHASE-046 (D-08): the variable fold's explicit warnings (the
   *  unpriced divisor states + the gated-deduction clamps). */
  variable: VariableWarnings;
}

@Injectable()
export class RunCalculationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly statutory: StatutoryProfileService,
    private readonly pit: PitEngine,
    private readonly feeds: FeedService,
  ) {}

  /** The register read (the controller's list surface). */
  async listRuns(filter: { fiscalYearId?: string; status?: store.RunStatus; limit?: number }) {
    return store.listRuns({
      fiscalYearId: filter.fiscalYearId,
      status: filter.status,
      limit: Math.min(filter.limit ?? 200, 500),
    });
  }

  /** The run detail read (run + lines). */
  async getRun(id: string): Promise<{ run: RunRow; lines: store.RunLineRow[] }> {
    const run = await store.findRunById(id);
    if (run === undefined) throw new RunNotFoundError(id);
    return { run, lines: await store.listRunLines(id) };
  }

  /** Create the DRAFT run shell (one live run per period — the monthly law). */
  async createRun(input: {
    fiscalPeriodId: string;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<RunRow> {
    const period = await findPeriodById(input.fiscalPeriodId);
    if (period === undefined || period.kind !== "REGULAR") {
      throw new RunNotFoundError(input.fiscalPeriodId);
    }
    const existing = await store.findLiveRunOfPeriod(input.fiscalPeriodId);
    if (existing !== undefined) {
      throw new RunPeriodExistsError({
        fiscalPeriodId: input.fiscalPeriodId,
        existingRunId: existing.id,
      });
    }
    const created = await store.insertRun({
      fiscalPeriodId: input.fiscalPeriodId,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "payroll.run_created",
      entityType: "payroll_run",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { fiscalPeriodId: input.fiscalPeriodId, status: "DRAFT" },
    });
    return created;
  }

  /**
   * The bounded calculation (phase §5 T4; the pg-boss job wraps this —
   * ids-only payloads, no PII in jobs per TENANT_ISOLATION §3; the W-3
   * extension adds NO payload field: the statutory/variable arms resolve
   * from the run's own period + the tenant's settings at execution
   * time). DRAFT-only: recalculating wipes the DRAFT's lines first (the
   * guard trigger's sanctioned reset) and re-inserts fresh — the whole
   * window under the run gate (D-09).
   */
  async calculate(
    runId: string,
    options: { actorId: string | null; strictCap?: boolean },
  ): Promise<{ run: RunRow; lines: CalculatedLine[]; warnings: CalculationWarnings }> {
    // D-09 THE RUN GATE — before the status read: the reset + the write
    // are one window; a concurrent calculate/post/remittance serializes.
    await lockPayrollRun(runId);

    const run = await store.findRunById(runId);
    if (run === undefined) throw new RunNotFoundError(runId);
    if (run.status !== "DRAFT") {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "re-calculation (only DRAFT runs recalculate)",
      });
    }
    const period = await findPeriodById(run.fiscalPeriodId);
    if (period === undefined) throw new RunNotFoundError(runId);

    // The EOS policy (BR-055): read once; enabled without a basis is a
    // typed rejection (never a silent zero).
    const eosEnabled = (await readEffectiveSetting<boolean>("payroll.eos.enabled")) ?? false;
    const eosBasisDays =
      await readEffectiveSetting<number | null>("payroll.eos.accrual_days_per_service_year");
    if (eosEnabled && (eosBasisDays === null || eosBasisDays === undefined)) {
      throw new EosBasisRequiredError();
    }
    const capPercent =
      (await readEffectiveSetting<number>("payroll.loans.max_deduction_percent")) ?? 25;

    // PHASE-046 (D-08) — the variable knobs, read ONCE (BR-055: OFF/NULL
    // by default — no fabricated rate, no fabricated deduction). The
    // divisor rides the raw tenant-settings surface with NO registry
    // default (the hr.overtime.weekend_days precedent): unset ⇒ the
    // UNPRICED line; a stored value that is not an integer 1…24 is
    // treated as unset (fail-closed, never a guessed divisor).
    const divisorSetting = await readEffectiveSetting<number | null>(
      "payroll.variable.overtime_hours_per_day",
    );
    const overtimeHoursPerDay =
      typeof divisorSetting === "number" && Number.isInteger(divisorSetting) &&
      divisorSetting >= 1 && divisorSetting <= 24
        ? divisorSetting
        : null;
    const knobs: VariableKnobs = {
      overtimeHoursPerDay,
      absenceDeduction:
        (await readEffectiveSetting<"off" | "on">("payroll.variable.absence_deduction")) ?? "off",
      lateDeduction:
        (await readEffectiveSetting<"off" | "on">("payroll.variable.late_deduction")) ?? "off",
    };

    // PHASE-046 (D-08) — THE FEED CALLED ONCE through the service
    // boundary (the handoff contract; BR-084's read-only law enforced in
    // its SQL — the registers are never read ad hoc, never written).
    const feed = await this.feeds.variableFeed({
      periodId: run.fiscalPeriodId,
      actorId: options.actorId,
    });
    const feedByEmployee = new Map<string, (typeof feed.employees)[number]>();
    for (const row of feed.employees) {
      feedByEmployee.set(row.employeeId, row);
    }

    // The jurisdiction anchor (the holiday-calendar law) + D-07's honest
    // no-profile state: no live rows for the tenant's jurisdiction ⇒
    // zero statutory lines + the explicit run-level note.
    const jurisdictionCode = await ownTenantCountryCode();
    const warnings: CalculationWarnings = {
      loanClamps: [],
      skippedEmployees: [],
      unpricedNationality: [],
      noStatutoryProfile: [],
      variable: emptyVariableWarnings(),
    };
    const profileSet = await this.statutory.resolveSet({
      jurisdictionCode,
      onDate: period.endDate,
    });
    if (profileSet.rows.length === 0) {
      warnings.noStatutoryProfile.push({ jurisdictionCode });
    }

    const employees = await store.listEmployees({ status: "ACTIVE", limit: 500 });
    const structureCache = new Map<
      string,
      { structure: store.StructureRow; components: ComponentRow[] }
    >();
    const loanLines = await store.listPendingLoanLinesForPeriod(run.fiscalPeriodId);
    const loansByLine = new Map<string, store.LoanRow>();
    for (const line of loanLines) {
      if (!loansByLine.has(line.loanId)) {
        const loan = await store.findLoanById(line.loanId);
        if (loan !== undefined && loan.status === "ACTIVE") {
          loansByLine.set(line.loanId, loan);
        }
      }
    }

    const calculated: CalculatedLine[] = [];
    for (const employee of employees) {
      if (employee.salaryStructureId === null) {
        warnings.skippedEmployees.push({
          code: employee.code,
          reason: "no salary structure assigned",
        });
        continue;
      }
      let cached = structureCache.get(employee.salaryStructureId);
      if (cached === undefined) {
        const structure = await store.findStructureById(employee.salaryStructureId);
        if (structure === undefined) {
          warnings.skippedEmployees.push({
            code: employee.code,
            reason: "assigned structure no longer exists",
          });
          continue;
        }
        if (structure.status !== "ACTIVE") {
          // BR-052: an ARCHIVED structure cannot enter a run — typed 409.
          throw new StructureNotActiveError({
            structureId: structure.id,
            status: structure.status,
          });
        }
        cached = { structure, components: await store.listComponents(structure.id) };
        structureCache.set(structure.id, cached);
      }
      const myLoanLines = loanLines.filter(
        (line) => loansByLine.get(line.loanId)?.employeeId === employee.id,
      );

      // (1) The structure fold (the 029 law, unchanged — the FIXED
      // order; PERCENT_OF_GROSS reads the earnings before it).
      const folded = this.calculateEmployee({
        employee,
        structure: cached.structure,
        components: cached.components,
        loanLines: myLoanLines,
        eosEnabled,
        eosBasisDays: eosBasisDays ?? 0,
        capPercent,
        warnings,
        strictCap: options.strictCap === true,
      });

      // (2) THE STATUTORY ARM (T-05): the applies-to resolution over the
      // effective-dated VERIFIED rows — the period's END date picks the
      // set; NULL nationality fails closed with the warning (D-02); a
      // matching REQUIRES_VERIFICATION row refuses the whole calculation
      // typed (BR-085 — the service audits its own refusal).
      const allowanceValues = folded.componentValues
        .filter(({ component }) => component.kind === "ALLOWANCE")
        .map(({ component, computed }) => ({ key: component.key, amount: computed }));
      const resolution = await this.statutory.resolveForEmployee({
        employeeId: employee.id,
        nationality: employee.nationality,
        basic: folded.employee.basicSalary,
        components: allowanceValues,
        onDate: period.endDate,
        jurisdictionCode,
      });
      for (const warning of resolution.warnings) {
        if (warning.code === "unpricedNationality") {
          warnings.unpricedNationality.push({
            employeeCode: employee.code,
            employeeId: employee.id,
          });
        }
      }
      const statutoryEmployeeShare = resolution.employeeTotal;
      const statutoryEmployerShare = resolution.employerTotal;
      const statutoryBreakdown: StatutoryBreakdownEntry[] = resolution.contributions.map(
        (row) => ({
          code: row.code,
          kind: "CONTRIBUTION" as const,
          appliesTo: row.appliesTo,
          base: row.wageBase,
          clampedBase: row.clampedBase,
          clampedBy: row.clampedBy,
          employeeRate: row.employeeRate,
          employerRate: row.employerRate,
          employeeAmount: row.employeeAmount,
          employerAmount: row.employerAmount,
        }),
      );

      // (3) THE VARIABLE ARM (T-07, D-08): the feed's facts priced by the
      // pure fold — the gated deductions clamp against the net remaining
      // after the structure deductions + the statutory employee share
      // (the loan precedent); MISSING_PUNCH stays informational.
      const feedRow = feedByEmployee.get(employee.id);
      const priced = priceVariableLine({
        employeeCode: employee.code,
        basic: folded.employee.basicSalary,
        facts: feedRow === undefined
          ? {
              multipliedHours: "0.00",
              absenceDays: 0,
              missingPunchDays: 0,
              lateMinutes: 0,
              leaveBalances: [],
            }
          : {
              multipliedHours: feedRow.overtime.totalMultipliedHours,
              absenceDays: feedRow.absenceDays,
              missingPunchDays: feedRow.missingPunchDays,
              lateMinutes: feedRow.lateMinutes,
              leaveBalances: feedRow.leaveBalances.map((cell) => ({
                leaveTypeCode: cell.leaveTypeCode,
                year: cell.year,
                entitlementDays: cell.entitlementDays,
                usedDays: cell.usedDays,
                carriedForwardDays: cell.carriedForwardDays,
                remainingDays: cell.remainingDays,
              })),
            },
        knobs,
        priorDeductions: addExact(folded.employeeDeductions, statutoryEmployeeShare),
        gross: folded.gross,
        warnings: warnings.variable,
      });

      // (4) THE PIT ARM (T-05): the marginal fold over the line's FULL
      // gross (the structure fold + the overtime earning) — the honest
      // no-bracket state computes zero (KSA); the exemptions override
      // per employee (D-03).
      const lineGross = addExact(folded.gross, priced.overtimeAmount);
      const pit = await this.pit.computeForEmployee({
        employeeId: employee.id,
        gross: lineGross,
        pitExemptions: employee.pitExemptions,
        onDate: period.endDate,
        jurisdictionCode,
      });

      // (5) THE INV-025 FOLD EXTENSION (D-05): the new deductions join
      // the line's deductions; the employer column gains the statutory
      // employer share; net = gross − deductions exactly. The loan cap's
      // basis is the pre-loan net — every non-loan deduction first (the
      // BR-054 law on the extended fold; the 029 shapes unchanged when
      // the new arms are zero).
      const nonLoanDeductions = addExact(
        addExact(folded.employeeDeductions, statutoryEmployeeShare),
        addExact(pit.tax, addExact(priced.absenceAmount, priced.lateAmount)),
      );
      const preLoanNet = subExact(lineGross, nonLoanDeductions);
      const capBasis = compareExact(preLoanNet, "0.0000") < 0 ? "0.0000" : preLoanNet;
      const cap = percentOf(capBasis, capPercent);
      let scheduled = "0.0000";
      for (const line of myLoanLines) {
        scheduled = addExact(scheduled, line.amount);
      }
      let loanDeductions: { loanId: string; lineId: string; amount: string }[] = [];
      if (compareExact(scheduled, "0.0000") > 0) {
        if (compareExact(scheduled, cap) > 0) {
          if (options.strictCap === true) {
            throw new LoanDeductionCapError({
              loanId: myLoanLines[0]?.loanId ?? "?",
              scheduled,
              cap,
              capPercent,
            });
          }
          // CLAMP (the documented default): allocate the cap oldest-first;
          // the remainder stays PENDING for later periods (never dropped).
          let remaining = cap;
          loanDeductions = [];
          for (const line of myLoanLines) {
            if (compareExact(remaining, "0.0000") <= 0) break;
            const take = compareExact(line.amount, remaining) <= 0 ? line.amount : remaining;
            loanDeductions.push({ loanId: line.loanId, lineId: line.id, amount: take });
            remaining = subExact(remaining, take);
          }
          warnings.loanClamps.push({
            employeeCode: employee.code,
            loanId: myLoanLines[0]?.loanId ?? "?",
            scheduled,
            clampedTo: cap,
          });
        } else {
          loanDeductions = myLoanLines.map((line) => ({
            loanId: line.loanId,
            lineId: line.id,
            amount: line.amount,
          }));
        }
      }
      let loanDeductionsTotal = "0.0000";
      for (const deduction of loanDeductions) {
        loanDeductionsTotal = addExact(loanDeductionsTotal, deduction.amount);
      }
      const deductionsAmount = addExact(nonLoanDeductions, loanDeductionsTotal);
      const net = subExact(lineGross, deductionsAmount);

      calculated.push({
        employee: folded.employee,
        structure: folded.structure,
        componentValues: folded.componentValues,
        gross: lineGross,
        employeeDeductions: folded.employeeDeductions,
        employerContributions: addExact(folded.employerContributions, statutoryEmployerShare),
        eosAccrual: folded.eosAccrual,
        loanDeductions,
        loanDeductionsTotal,
        net,
        statutoryEmployeeShare,
        statutoryEmployerShare,
        statutoryBreakdown,
        pitWithheld: pit.tax,
        variableOvertimeAmount: priced.overtimeAmount,
        variableAbsenceAmount: priced.absenceAmount,
        variableLateAmount: priced.lateAmount,
        variableBreakdown: priced.breakdown,
      });
    }

    if (calculated.length === 0) {
      throw new RunEmptyError(runId);
    }

    // Write phase (one ambient transaction, under the run gate): reset
    // the DRAFT lines, insert fresh, fold the totals, stamp the run
    // (INV-025 by construction — Σ lines == totals, net = gross −
    // deductions at BOTH levels; the statutory/variable columns are
    // breakdowns of the same fold, the CHECKs unwidened).
    await store.deleteRunLines(runId);
    let gross = "0.0000";
    let deductions = "0.0000";
    let net = "0.0000";
    let employer = "0.0000";
    let eos = "0.0000";
    let statutoryEmployee = "0.0000";
    let statutoryEmployer = "0.0000";
    let pitTotal = "0.0000";
    let variableOvertime = "0.0000";
    let variableAbsence = "0.0000";
    let variableLate = "0.0000";
    const accruals: StatutoryAccrualInput[] = [];
    for (const line of calculated) {
      const lineDeductions = addExact(
        addExact(line.employeeDeductions, line.statutoryEmployeeShare),
        addExact(
          line.pitWithheld,
          addExact(line.variableAbsenceAmount, line.variableLateAmount),
        ),
      );
      const lineNet = subExact(line.gross, lineDeductions);
      await store.insertRunLine({
        runId,
        employeeId: line.employee.id,
        componentSnapshot: {
          structure: line.structure,
          components: line.componentValues.map(({ component, computed }) => ({
            key: component.key,
            kind: component.kind,
            calc: component.calc,
            amount: component.amount,
            rate: component.rate,
            glAccountId: component.glAccountId,
            isEosBase: component.isEosBase,
            computed,
          })),
          loanDeductions: line.loanDeductions,
          eos: { enabled: eosEnabled, accrual: line.eosAccrual },
          basicSalary: line.employee.basicSalary,
        },
        grossAmount: line.gross,
        deductionsAmount: addExact(lineDeductions, line.loanDeductionsTotal),
        netAmount: subExact(lineNet, line.loanDeductionsTotal),
        employerContributions: line.employerContributions,
        eosAccrual: line.eosAccrual,
        statutoryEmployeeShare: line.statutoryEmployeeShare,
        statutoryEmployerShare: line.statutoryEmployerShare,
        pitWithheld: line.pitWithheld,
        variableOvertimeAmount: line.variableOvertimeAmount,
        variableAbsenceAmount: line.variableAbsenceAmount,
        variableLateAmount: line.variableLateAmount,
        statutoryBreakdown: line.statutoryBreakdown,
        variableBreakdown: line.variableBreakdown,
        costCenterId: line.employee.costCenterId,
        projectId: line.employee.projectId,
        branchId: line.employee.branchId,
      });
      gross = addExact(gross, line.gross);
      deductions = addExact(
        deductions,
        addExact(lineDeductions, line.loanDeductionsTotal),
      );
      net = addExact(net, subExact(lineNet, line.loanDeductionsTotal));
      employer = addExact(employer, line.employerContributions);
      eos = addExact(eos, line.eosAccrual);
      statutoryEmployee = addExact(statutoryEmployee, line.statutoryEmployeeShare);
      statutoryEmployer = addExact(statutoryEmployer, line.statutoryEmployerShare);
      pitTotal = addExact(pitTotal, line.pitWithheld);
      variableOvertime = addExact(variableOvertime, line.variableOvertimeAmount);
      variableAbsence = addExact(variableAbsence, line.variableAbsenceAmount);
      variableLate = addExact(variableLate, line.variableLateAmount);
      for (const entry of line.statutoryBreakdown) {
        accruals.push({
          code: entry.code,
          kind: "CONTRIBUTION",
          employeeAmount: entry.employeeAmount,
          employerAmount: entry.employerAmount,
        });
      }
      if (compareExact(line.pitWithheld, "0.0000") > 0) {
        accruals.push({
          code: "PIT",
          kind: "PIT",
          employeeAmount: line.pitWithheld,
          employerAmount: "0.0000",
        });
      }
    }
    // The remittance liability summary (D-05): folded from the frozen
    // breakdowns — per profile row {code, accrued, remitted: 0} (a DRAFT
    // run has never settled; every recalc re-folds it).
    const statutorySummary: StatutorySummaryRow[] = foldStatutorySummary(accruals);
    const updated = await store.updateRun(runId, {
      grossTotal: gross,
      deductionsTotal: deductions,
      netTotal: net,
      employerContributionsTotal: employer,
      eosAccrualTotal: eos,
      statutoryEmployeeTotal: statutoryEmployee,
      statutoryEmployerTotal: statutoryEmployer,
      pitTotal,
      variableOvertimeTotal: variableOvertime,
      variableAbsenceTotal: variableAbsence,
      variableLateTotal: variableLate,
      statutorySummary,
    });
    await this.audit.record({
      action: "payroll.run_calculated",
      entityType: "payroll_run",
      entityId: runId,
      actorId: options.actorId ?? undefined,
      after: {
        lineCount: calculated.length,
        gross,
        deductions,
        net,
        loanClamps: warnings.loanClamps.length,
        skipped: warnings.skippedEmployees.length,
        statutoryEmployee,
        statutoryEmployer,
        pit: pitTotal,
        variableOvertime,
        variableAbsence,
        variableLate,
        unpricedNationality: warnings.unpricedNationality.length,
        noStatutoryProfile: warnings.noStatutoryProfile.length > 0,
      },
    });
    return { run: updated, lines: calculated, warnings };
  }

  /**
   * The per-employee STRUCTURE fold (the 029 law, unchanged — the FIXED
   * order: basic → %-basic → %-gross → fixed; earnings first, then
   * deductions against the final gross). The PHASE-046 arms compose
   * AROUND this fold in `calculate` — the structure math itself is
   * byte-stable (the additive-only law; the 029 golden pack stays green
   * untouched).
   */
  private calculateEmployee(input: {
    employee: store.EmployeeRow;
    structure: store.StructureRow;
    components: ComponentRow[];
    loanLines: LoanLineRow[];
    eosEnabled: boolean;
    eosBasisDays: number;
    capPercent: number;
    warnings: CalculationWarnings;
    strictCap: boolean;
  }): {
    employee: store.EmployeeRow;
    structure: { id: string; code: string; name: string };
    componentValues: { component: ComponentRow; computed: string }[];
    gross: string;
    employeeDeductions: string;
    employerContributions: string;
    eosAccrual: string;
  } {
    const { employee, components } = input;
    const ordered = [...components].sort(
      (a, b) => componentOrder(a) - componentOrder(b) || a.seq - b.seq,
    );

    const basic = money(employee.basicSalary);
    let gross = basic;
    let employeeDeductions = "0.0000";
    let employerContributions = "0.0000";
    const componentValues: { component: ComponentRow; computed: string }[] = [];

    // Pass 1: earnings (basic + ALLOWANCE + EMPLOYER_CONTRIBUTION) —
    // PERCENT_OF_GROSS reads the earnings accumulated before it.
    for (const component of ordered.filter((c) => c.kind !== "DEDUCTION")) {
      const value = computeComponent(component, { basic, gross });
      componentValues.push({ component, computed: value });
      if (component.kind === "ALLOWANCE") {
        gross = addExact(gross, value);
      } else {
        employerContributions = addExact(employerContributions, value);
      }
    }
    // Pass 2: DEDUCTION components against the FINAL gross.
    for (const component of ordered.filter((c) => c.kind === "DEDUCTION")) {
      const value = computeComponent(component, { basic, gross });
      componentValues.push({ component, computed: value });
      employeeDeductions = addExact(employeeDeductions, value);
    }

    // EOS accrual (BR-055): (basic + Σ is_eos_base earning values) × the
    // tenant's basis days / 30 per month — the basic is ALWAYS in the base
    // (the phase's worked example: 8,000 × 3/30 = 800 with the housing
    // allowance flagged out of the base).
    let eosAccrual = "0.0000";
    if (input.eosEnabled) {
      let eosBase = basic;
      for (const { component, computed } of componentValues) {
        if (component.isEosBase && component.kind === "ALLOWANCE") {
          eosBase = addExact(eosBase, computed);
        }
      }
      eosAccrual = new Decimal(eosBase)
        .times(new Decimal(input.eosBasisDays))
        .div(new Decimal(30))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        .toFixed(4);
    }

    return {
      employee,
      structure: {
        id: input.structure.id,
        code: input.structure.code,
        name: input.structure.name,
      },
      componentValues,
      gross,
      employeeDeductions,
      employerContributions,
      eosAccrual,
    };
  }
}

/** Canonical 4dp string (never a JS number — ADR-0009). */
function money(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** value × percent / 100, half-up at 4dp. */
function percentOf(value: string, percent: number): string {
  return new Decimal(value)
    .times(new Decimal(percent))
    .div(new Decimal(100))
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);
}

/** The FIXED calculation order (phase §5 T4): basic(0) → PERCENT_OF_BASIC(1)
 * → PERCENT_OF_GROSS(2) → FIXED(3). */
function componentOrder(component: ComponentRow): number {
  if (component.calc === "PERCENT_OF_BASIC") return 1;
  if (component.calc === "PERCENT_OF_GROSS") return 2;
  return 3; // FIXED
}

function computeComponent(
  component: ComponentRow,
  basis: { basic: string; gross: string },
): string {
  if (component.calc === "FIXED") {
    return money(component.amount ?? "0");
  }
  const base = component.calc === "PERCENT_OF_BASIC" ? basis.basic : basis.gross;
  // rate is stored 7,4 — the product rounds half-up at the money scale.
  return new Decimal(base)
    .times(new Decimal(component.rate ?? "0"))
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);
}
