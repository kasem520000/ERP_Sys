import { Decimal } from "@erp/domain-core";

import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { findPeriodById } from "../../accounting/infrastructure/accounting.store";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import {
  EosBasisRequiredError,
  LoanDeductionCapError,
  RunEmptyError,
  RunImmutableError,
  RunNotFoundError,
  RunPeriodExistsError,
  StructureNotActiveError,
} from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import type { ComponentRow, LoanLineRow, RunRow } from "../infrastructure/payroll.store";
/**
 * Run calculation service (PHASE-029 T4): the per-employee computation
 * from the frozen ACTIVE structure. Calculation order is FIXED and
 * documented (phase §5 T4): basic → PERCENT_OF_BASIC → PERCENT_OF_GROSS →
 * FIXED, half-up at each component (ADR-0009 — Decimal toDecimalPlaces;
 * no Math.* anywhere).
 *
 * PERCENT_OF_GROSS components resolve against the earnings accumulated
 * BEFORE them in the fixed order (the phase's worked example: basic 8,000
 * + housing 2,000 FIXED ⇒ gross 10,000 — a percent-of-gross component
 * placed after housing reads 10,000).
 *
 * Loan deductions (BR-054): Σ this period's PENDING loan lines ≤ cap % of
 * the pre-loan net — the service CLAMPS oldest-first with an explicit
 * warning in the result (never silently; strict mode throws the typed
 * LoanDeductionCapError). The net floor is zero by construction.
 *
 * EOS accrual (BR-055): Σ is_eos_base earning values × the tenant's
 * accrual basis (days per service year) / 30 per month — computed from the
 * SNAPSHOT values, one value per employee, posted inside the run journal
 * (G-29's EOS legs). Disabled tenants (default) accrue 0.0000 and skip
 * the legs entirely. Enabling without a basis is a typed rejection.
 *
 * The written lines freeze component_snapshot (BR-052) — posted history
 * never depends on later structure edits. The write phase folds the run
 * totals from the SAME line values it writes (INV-025 by construction).
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
}

export interface CalculationWarnings {
  /** BR-054 clamps: loan deductions capped to the percent of net. */
  loanClamps: { employeeCode: string; loanId: string; scheduled: string; clampedTo: string }[];
  /** Employees skipped (no ACTIVE structure assigned — explicit, never silent). */
  skippedEmployees: { code: string; reason: string }[];
}

@Injectable()
export class RunCalculationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

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
   * ids-only payloads, no PII in jobs per TENANT_ISOLATION §3). DRAFT-only:
   * recalculating wipes the DRAFT's lines first (the guard trigger's
   * sanctioned reset) and re-inserts fresh.
   */
  async calculate(
    runId: string,
    options: { actorId: string | null; strictCap?: boolean },
  ): Promise<{ run: RunRow; lines: CalculatedLine[]; warnings: CalculationWarnings }> {
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

    const warnings: CalculationWarnings = { loanClamps: [], skippedEmployees: [] };

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
      calculated.push(
        this.calculateEmployee({
          employee,
          structure: cached.structure,
          components: cached.components,
          loanLines: myLoanLines,
          eosEnabled,
          eosBasisDays: eosBasisDays ?? 0,
          capPercent,
          warnings,
          strictCap: options.strictCap === true,
        }),
      );
    }

    if (calculated.length === 0) {
      throw new RunEmptyError(runId);
    }

    // Write phase (one ambient transaction): reset the DRAFT lines, insert
    // fresh, fold the totals, stamp the run (INV-025 by construction —
    // Σ lines == totals, net = gross − deductions at BOTH levels).
    await store.deleteRunLines(runId);
    let gross = "0.0000";
    let deductions = "0.0000";
    let net = "0.0000";
    let employer = "0.0000";
    let eos = "0.0000";
    for (const line of calculated) {
      const lineDeductions = addExact(line.employeeDeductions, line.loanDeductionsTotal);
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
        deductionsAmount: lineDeductions,
        netAmount: lineNet,
        employerContributions: line.employerContributions,
        eosAccrual: line.eosAccrual,
        costCenterId: line.employee.costCenterId,
        projectId: line.employee.projectId,
        branchId: line.employee.branchId,
      });
      gross = addExact(gross, line.gross);
      deductions = addExact(deductions, lineDeductions);
      net = addExact(net, lineNet);
      employer = addExact(employer, line.employerContributions);
      eos = addExact(eos, line.eosAccrual);
    }
    const updated = await store.updateRun(runId, {
      grossTotal: gross,
      deductionsTotal: deductions,
      netTotal: net,
      employerContributionsTotal: employer,
      eosAccrualTotal: eos,
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
      },
    });
    return { run: updated, lines: calculated, warnings };
  }

  /**
   * The per-employee fold (the FIXED order: basic → %-basic → %-gross →
   * fixed; earnings first, then deductions against the final gross).
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
  }): CalculatedLine {
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

    // Loan deductions (BR-054): Σ this employee's PENDING lines ≤ cap % of
    // the pre-loan net — clamp oldest-first with the explicit warning.
    const preLoanNet = subExact(gross, employeeDeductions);
    const cap = percentOf(preLoanNet, input.capPercent);
    let scheduled = "0.0000";
    for (const line of input.loanLines) {
      scheduled = addExact(scheduled, line.amount);
    }
    let loanDeductions: { loanId: string; lineId: string; amount: string }[] = [];
    if (compareExact(scheduled, "0.0000") > 0) {
      if (compareExact(scheduled, cap) > 0) {
        if (input.strictCap) {
          throw new LoanDeductionCapError({
            loanId: input.loanLines[0]?.loanId ?? "?",
            scheduled,
            cap,
            capPercent: input.capPercent,
          });
        }
        // CLAMP (the documented default): allocate the cap oldest-first;
        // the remainder stays PENDING for later periods (never dropped).
        let remaining = cap;
        loanDeductions = [];
        for (const line of input.loanLines) {
          if (compareExact(remaining, "0.0000") <= 0) break;
          const take = compareExact(line.amount, remaining) <= 0 ? line.amount : remaining;
          loanDeductions.push({ loanId: line.loanId, lineId: line.id, amount: take });
          remaining = subExact(remaining, take);
        }
        input.warnings.loanClamps.push({
          employeeCode: employee.code,
          loanId: input.loanLines[0]?.loanId ?? "?",
          scheduled,
          clampedTo: cap,
        });
      } else {
        loanDeductions = input.loanLines.map((line) => ({
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
      loanDeductions,
      loanDeductionsTotal,
      net: subExact(preLoanNet, loanDeductionsTotal),
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

/**
 * The FIXED calculation order (phase §5 T4): basic(0) → PERCENT_OF_BASIC(1)
 * → PERCENT_OF_GROSS(2) → FIXED(3).
 */
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
