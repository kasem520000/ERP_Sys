import { Injectable } from "@nestjs/common";

import { sql } from "drizzle-orm";

import { addExact, compareExact, subExact } from "../../../accounting/application/decimal-strings";
import * as journal from "../../../accounting/infrastructure/journal.store";
import { requireTenantContext } from "../../../../infra/db/tenant-context";

/**
 * PHASE-029 wave C · the payroll report queries (REPORT_CATALOG §payroll
 * rows — the queries behind `payroll.register`, `payroll.cost-summary`
 * and `payroll.eos-provision`): reporting-facing, read-only, executed
 * inside the ambient tenant transaction exactly like the PHASE-027/028
 * precedents (ADR-0011 — read-only over the PUBLISHED payroll tables +
 * the accounting journal store for the GL tie side; this surface never
 * writes).
 *
 * ── PII law (the strictest in the platform) ─────────────────────────────
 *
 * Employee rows surface ONLY code + display names — never national_id,
 * never bank fields (the register/cost/eos aggregates carry money, not
 * identity detail; the employee-detail drill requires the restricted
 * payroll.employees.view permission at the CONTRACT level, and this query
 * layer never emits PII columns at all).
 *
 * ── The ledger ties (block-on-fail) ────────────────────────────────────
 *
 * register:     Σ per-employee lines (gross/deductions/net) == the run row
 *               totals (INV-025) AND the run's journal exists un-reversed
 *               with total debit == gross + employer + eos (the G-29
 *               shape's cost side — an INDEPENDENT code path: the journal
 *               store's own rows, not the run register's folds).
 * cost-summary: per period, Σ run-line cost (gross + employer + eos) ==
 *               the journal's payroll_run-sourced entry debit total for
 *               that period (the same independent-path discipline).
 * eos:          Σ un-extinguished balances == the EOS_PROVISION purpose
 *               account's natural-direction GL balance (LIABILITY:
 *               credit − debit) — the register-vs-ledger fold.
 */

function tenantTx() {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("payroll report queries require an ambient tenant scope");
  }
  return context.tx;
}

export interface RegisterEmployeeRow {
  readonly employeeId: string;
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly employeeNameAr: string | null;
  readonly gross: string;
  readonly deductions: string;
  readonly net: string;
  readonly employerContributions: string;
  readonly eosAccrual: string;
}

export interface RegisterTieSides {
  readonly runTotals: { gross: string; deductions: string; net: string; employer: string; eos: string };
  readonly lineSums: { gross: string; deductions: string; net: string };
  readonly journalDebitTotal: string | null;
  readonly journalReversed: boolean;
  readonly ok: boolean;
}

@Injectable()
export class PayrollQueriesService {
  /** The payroll register of one run (per-employee; ties to run + journal). */
  async register(input: { runId: string }): Promise<{
    run: {
      id: string;
      runNo: string | null;
      status: string;
      periodName: string;
      gross: string;
      deductions: string;
      net: string;
      employer: string;
      eos: string;
      paid: string;
      journalEntryId: string | null;
    };
    rows: RegisterEmployeeRow[];
    ties: RegisterTieSides;
  }> {
    const runRow = (
      await tenantTx().execute(sql`
        SELECT r.id, r.run_no, r.status, r.gross_total, r.deductions_total, r.net_total,
               r.paid_net_total, r.employer_contributions_total, r.eos_accrual_total,
               r.journal_entry_id, p.name AS period_name
        FROM payroll_runs r JOIN fiscal_periods p ON p.id = r.fiscal_period_id
        WHERE r.id = ${input.runId}
        LIMIT 1
      `)
    ).rows[0] as
      | {
          id: string;
          run_no: string | null;
          status: string;
          gross_total: string;
          deductions_total: string;
          net_total: string;
          paid_net_total: string;
          employer_contributions_total: string;
          eos_accrual_total: string;
          journal_entry_id: string | null;
          period_name: string;
        }
      | undefined;
    if (runRow === undefined) {
      throw new Error(`payroll run ${input.runId} not found (own tenant)`);
    }
    const lineRows = (
      await tenantTx().execute(sql`
        SELECT l.employee_id, e.code AS employee_code, e.name AS employee_name,
               e.name_ar AS employee_name_ar, l.gross_amount, l.deductions_amount, l.net_amount,
               l.employer_contributions, l.eos_accrual
        FROM payroll_run_lines l JOIN employees e ON e.id = l.employee_id
        WHERE l.run_id = ${input.runId}
        ORDER BY e.code
      `)
    ).rows as unknown as {
      employee_id: string;
      employee_code: string;
      employee_name: string;
      employee_name_ar: string | null;
      gross_amount: string;
      deductions_amount: string;
      net_amount: string;
      employer_contributions: string;
      eos_accrual: string;
    }[];

    const rows: RegisterEmployeeRow[] = lineRows.map((row) => ({
      employeeId: row.employee_id,
      employeeCode: row.employee_code,
      employeeName: row.employee_name,
      employeeNameAr: row.employee_name_ar,
      gross: row.gross_amount,
      deductions: row.deductions_amount,
      net: row.net_amount,
      employerContributions: row.employer_contributions,
      eosAccrual: row.eos_accrual,
    }));

    // INV-025 fold: Σ lines == run totals.
    let gross = "0.0000";
    let deductions = "0.0000";
    let net = "0.0000";
    for (const row of rows) {
      gross = addExact(gross, row.gross);
      deductions = addExact(deductions, row.deductions);
      net = addExact(net, row.net);
    }
    // The G-29 journal's cost side (independent path — journal store rows).
    let journalDebitTotal: string | null = null;
    let journalReversed = false;
    if (runRow.journal_entry_id !== null) {
      const entry = await journal.findEntryById(runRow.journal_entry_id);
      if (entry !== undefined) {
        journalReversed = entry.status === "REVERSED";
        const lines = await journal.listLines(entry.id);
        let debit = "0.0000";
        for (const line of lines) {
          if (line.direction === "DEBIT") {
            debit = addExact(debit, line.baseAmount);
          }
        }
        journalDebitTotal = debit;
      }
    }
    const costSide = addExact(
      addExact(runRow.gross_total, runRow.employer_contributions_total),
      runRow.eos_accrual_total,
    );
    const ties: RegisterTieSides = {
      runTotals: {
        gross: runRow.gross_total,
        deductions: runRow.deductions_total,
        net: runRow.net_total,
        employer: runRow.employer_contributions_total,
        eos: runRow.eos_accrual_total,
      },
      lineSums: { gross, deductions, net },
      journalDebitTotal,
      journalReversed,
      ok:
        compareExact(gross, runRow.gross_total) === 0 &&
        compareExact(deductions, runRow.deductions_total) === 0 &&
        compareExact(net, runRow.net_total) === 0 &&
        journalDebitTotal !== null &&
        compareExact(journalDebitTotal, costSide) === 0 &&
        !journalReversed,
    };
    return {
      run: {
        id: runRow.id,
        runNo: runRow.run_no,
        status: runRow.status,
        periodName: runRow.period_name,
        gross: runRow.gross_total,
        deductions: runRow.deductions_total,
        net: runRow.net_total,
        employer: runRow.employer_contributions_total,
        eos: runRow.eos_accrual_total,
        paid: runRow.paid_net_total,
        journalEntryId: runRow.journal_entry_id,
      },
      rows,
      ties,
    };
  }

  /**
   * The cost summary: run-line cost (gross + employer + eos) grouped by
   * (cost center × project × period); the GL tie folds the journal's
   * payroll_run-sourced debit lines per period (independent path).
   */
  async costSummary(input: { fromDate: string; toDate: string }): Promise<{
    rows: {
      key: string;
      costCenterId: string | null;
      costCenterCode: string | null;
      projectId: string | null;
      projectCode: string | null;
      fiscalPeriodId: string;
      periodName: string;
      gross: string;
      employer: string;
      eos: string;
      cost: string;
      net: string;
    }[];
    ties: { rows: { periodName: string; runCost: string; glDebit: string }[]; ok: boolean };
  }> {
    const lineRows = (
      await tenantTx().execute(sql`
        SELECT l.cost_center_id, l.project_id, r.fiscal_period_id, p.name AS period_name,
               SUM(l.gross_amount)::text AS gross, SUM(l.employer_contributions)::text AS employer,
               SUM(l.eos_accrual)::text AS eos, SUM(l.net_amount)::text AS net
        FROM payroll_run_lines l
        JOIN payroll_runs r ON r.id = l.run_id
        JOIN fiscal_periods p ON p.id = r.fiscal_period_id
        WHERE r.status = 'POSTED'
          AND p.start_date >= ${input.fromDate} AND p.start_date <= ${input.toDate}
        GROUP BY l.cost_center_id, l.project_id, r.fiscal_period_id, p.name
        ORDER BY p.name, l.cost_center_id NULLS LAST, l.project_id NULLS LAST
      `)
    ).rows as unknown as {
      cost_center_id: string | null;
      project_id: string | null;
      fiscal_period_id: string;
      period_name: string;
      gross: string;
      employer: string;
      eos: string;
      net: string;
    }[];
    const costCenters = new Map<string, string>();
    const projects = new Map<string, string>();
    for (const row of lineRows) {
      if (row.cost_center_id !== null && !costCenters.has(row.cost_center_id)) {
        const found = (
          await tenantTx().execute(sql`
            SELECT code FROM cost_centers WHERE id = ${row.cost_center_id} LIMIT 1
          `)
        ).rows[0] as { code: string } | undefined;
        costCenters.set(row.cost_center_id, found?.code ?? "");
      }
      if (row.project_id !== null && !projects.has(row.project_id)) {
        const found = (
          await tenantTx().execute(sql`
            SELECT code FROM projects WHERE id = ${row.project_id} LIMIT 1
          `)
        ).rows[0] as { code: string } | undefined;
        projects.set(row.project_id, found?.code ?? "");
      }
    }
    const rows = lineRows.map((row) => {
      const cost = addExact(addExact(row.gross, row.employer), row.eos);
      return {
        key: `${row.fiscal_period_id}|${row.cost_center_id ?? ""}|${row.project_id ?? ""}`,
        costCenterId: row.cost_center_id,
        costCenterCode: row.cost_center_id === null ? null : costCenters.get(row.cost_center_id) ?? "",
        projectId: row.project_id,
        projectCode: row.project_id === null ? null : projects.get(row.project_id) ?? "",
        fiscalPeriodId: row.fiscal_period_id,
        periodName: row.period_name,
        gross: row.gross,
        employer: row.employer,
        eos: row.eos,
        cost,
        net: row.net,
      };
    });

    // The GL tie: per period, the journal's payroll_run-sourced debit total.
    const glRows = (
      await tenantTx().execute(sql`
        SELECT p.name AS period_name,
               COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE 0 END), 0)::text AS debit
        FROM journal_entries e
        JOIN journal_lines l ON l.journal_entry_id = e.id
        JOIN fiscal_periods p ON p.id = e.fiscal_period_id
        WHERE e.source_type = 'payroll_run' AND e.operation = 'post'
          AND p.start_date >= ${input.fromDate} AND p.start_date <= ${input.toDate}
        GROUP BY p.name
        ORDER BY p.name
      `)
    ).rows as unknown as { period_name: string; debit: string }[];
    const runPerPeriod = new Map<string, string>();
    for (const row of rows) {
      runPerPeriod.set(row.periodName, addExact(runPerPeriod.get(row.periodName) ?? "0", row.cost));
    }
    const tieRows = glRows.map((gl) => ({
      periodName: gl.period_name,
      runCost: runPerPeriod.get(gl.period_name) ?? "0",
      glDebit: gl.debit,
    }));
    for (const [periodName, runCost] of runPerPeriod) {
      if (!glRows.some((gl) => gl.period_name === periodName)) {
        tieRows.push({ periodName, runCost, glDebit: "0" });
      }
    }
    const ties = {
      rows: tieRows,
      ok: tieRows.every((row) => compareExact(row.runCost, row.glDebit) === 0),
    };
    return { rows, ties };
  }

  /**
   * The EOS provision report: per employee — accruals (POSTED-run lines),
   * the cash settlement stamp, the released residual, the balance; the GL
   * tie folds the EOS_PROVISION purpose account's natural-direction
   * balance against Σ un-extinguished balances.
   */
  async eosProvision(): Promise<{
    rows: {
      employeeId: string;
      employeeCode: string;
      employeeName: string;
      employeeNameAr: string | null;
      status: string;
      accrued: string;
      settled: string | null;
      released: string | null;
      balance: string;
    }[];
    ties: { registerBalance: string; glBalance: string; ok: boolean };
  }> {
    const employeeRows = (
      await tenantTx().execute(sql`
        SELECT e.id, e.code, e.name, e.name_ar, e.status, e.eos_settled_amount
        FROM employees e
        WHERE EXISTS (
          SELECT 1 FROM payroll_run_lines l
          JOIN payroll_runs r ON r.id = l.run_id
          WHERE l.employee_id = e.id AND r.status = 'POSTED' AND l.eos_accrual > 0
        ) OR e.eos_settled_amount IS NOT NULL
        ORDER BY e.code
      `)
    ).rows as unknown as {
      id: string;
      code: string;
      name: string;
      name_ar: string | null;
      status: string;
      eos_settled_amount: string | null;
    }[];
    const accruals = new Map<string, string>();
    for (const employee of employeeRows) {
      const rows = (
        await tenantTx().execute(sql`
          SELECT COALESCE(SUM(l.eos_accrual), 0)::text AS accrued
          FROM payroll_run_lines l JOIN payroll_runs r ON r.id = l.run_id
          WHERE l.employee_id = ${employee.id} AND r.status = 'POSTED'
        `)
      ).rows as unknown as { accrued: string }[];
      accruals.set(employee.id, rows[0]?.accrued ?? "0");
    }
    const rows = employeeRows.map((employee) => {
      const accrued = accruals.get(employee.id) ?? "0";
      const settled = employee.eos_settled_amount;
      return {
        employeeId: employee.id,
        employeeCode: employee.code,
        employeeName: employee.name,
        employeeNameAr: employee.name_ar,
        status: employee.status,
        accrued,
        settled,
        // A settled employee's extinguished total = the accrued balance at
        // settlement (the one-shot full-balance G-31); the residual above
        // the cash settled released to EOS_PROVISION_EXPENSE.
        released: settled === null ? null : subExact(accrued, settled),
        balance: settled === null ? accrued : "0.0000",
      };
    });
    let registerBalance = "0.0000";
    for (const row of rows) {
      registerBalance = addExact(registerBalance, row.balance);
    }
    // The GL side: the EOS_PROVISION purpose account's natural balance.
    const purposeRow = (
      await tenantTx().execute(sql`
        SELECT p.account_id,
               COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.base_amount ELSE -l.base_amount END), 0)::text AS balance
        FROM account_purposes p
        JOIN journal_lines l ON l.account_id = p.account_id
        WHERE p.purpose_key = 'EOS_PROVISION' AND p.active_to IS NULL
        GROUP BY p.account_id
        LIMIT 1
      `)
    ).rows[0] as { account_id: string; balance: string } | undefined;
    const glBalance = purposeRow?.balance ?? "0";
    return {
      rows,
      ties: {
        registerBalance,
        glBalance,
        ok: compareExact(registerBalance, glBalance) === 0,
      },
    };
  }
}
