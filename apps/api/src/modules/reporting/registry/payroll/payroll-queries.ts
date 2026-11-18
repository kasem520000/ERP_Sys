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
 * eos:          Σ per-employee STANDING balances (the 029 balance + the
 *               accumulated G-54 true-up deltas — the ruled option-(A)
 *               fold, 2026-11-18) == the EOS_PROVISION purpose account's
 *               natural-direction GL balance (LIABILITY: credit − debit)
 *               — the register-vs-ledger fold, tying in every world.
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
   * the cash settlement stamp, the released residual, the accumulated
   * G-54 true-up delta, and the STANDING balance; the GL tie folds the
   * EOS_PROVISION purpose account's natural-direction balance against
   * Σ standing balances.
   *
   * [RULED OPTION (A) — DELIVERED 2026-11-18 (the owner's W-9 verification
   * dispatch; this standalone maintenance wave): the register side folds
   * the accumulated G-54 true-up deltas — the standing model
   * (eosbLiability's law), so the tie holds in every world: unsettled
   * employees carry accrued + Σ deltas; settled employees carry Σ deltas
   * (the G-31 extinguished their 029 balance at the run-line fold).
   * Block-on-fail retained. Before this fold the register side was the
   * 029-era Σ un-extinguished balances, which predated the G-54 legs — on
   * a true-ups tenant the tie FAILED and the SAFE-direction block engaged
   * (the W-3/W-6 design point, recorded at the contract site).]
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
      trueUp: string;
      balance: string;
    }[];
    ties: { registerBalance: string; glBalance: string; ok: boolean };
  }> {
    // The row universe is the GL's whole provision surface (the standing
    // model's law): employees with POSTED-run EOS accruals ∪ settled
    // employees ∪ employees with EOSB computation evidence — a
    // true-ups-only employee (no accruals, never settled) carries Σ deltas
    // that ARE part of the GL the tie must account for.
    const employeeRows = (
      await tenantTx().execute(sql`
        SELECT e.id, e.code, e.name, e.name_ar, e.status, e.eos_settled_amount
        FROM employees e
        WHERE EXISTS (
          SELECT 1 FROM payroll_run_lines l
          JOIN payroll_runs r ON r.id = l.run_id
          WHERE l.employee_id = e.id AND r.status = 'POSTED' AND l.eos_accrual > 0
        ) OR e.eos_settled_amount IS NOT NULL
           OR EXISTS (SELECT 1 FROM eosb_calculations c WHERE c.employee_id = e.id)
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
          SELECT COALESCE(SUM(l.eos_accrual), 0.0000::numeric(19,4))::text AS accrued
          FROM payroll_run_lines l JOIN payroll_runs r ON r.id = l.run_id
          WHERE l.employee_id = ${employee.id} AND r.status = 'POSTED'
        `)
      ).rows as unknown as { accrued: string }[];
      accruals.set(employee.id, rows[0]?.accrued ?? "0.0000");
    }
    const trueUps = new Map<string, string>();
    for (const employee of employeeRows) {
      // The accumulated G-54 true-up delta. The 4dp NUMERIC LITERAL default
      // (never a bare 0): a no-row aggregate renders "0.0000" — the money
      // convention — a case the pre-fold universe never rendered (every
      // row then carried accruals or a settlement).
      const rows = (
        await tenantTx().execute(sql`
          SELECT COALESCE(SUM(delta), 0.0000::numeric(19,4))::text AS true_up
          FROM eosb_calculations WHERE employee_id = ${employee.id}
        `)
      ).rows as unknown as { true_up: string }[];
      trueUps.set(employee.id, rows[0]?.true_up ?? "0.0000");
    }
    const rows = employeeRows.map((employee) => {
      const accrued = accruals.get(employee.id) ?? "0.0000";
      const settled = employee.eos_settled_amount;
      const trueUp = trueUps.get(employee.id) ?? "0.0000";
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
        // The ruled option-(A) fold: the STANDING balance = the 029 balance
        // (accrued while unsettled, 0 after the terminal settlement) + the
        // accumulated G-54 true-up deltas — the standing model's law.
        trueUp,
        balance: addExact(settled === null ? accrued : "0.0000", trueUp),
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

  /**
   * PHASE-046 (W-6, T-13 — D-12) · `payroll.statutory-summary`: the per
   * (period × profile row) statutory fold over POSTED runs in a date
   * window — base totals, the employee/employer shares, the capped-count,
   * and the frozen `statutory_summary` liability (accrued vs remitted —
   * the remittance-ready report companion). The PIT surfaces as its own
   * row per period (kind PIT, code PIT — the summary's own shape).
   *
   * The tie folds THREE independent representations of the same money
   * (INV-032(b)): the line COLUMNS (statutory_employee_share et al.), the
   * run TOTALS (statutory_employee_total et al.), and the jsonb BREAKDOWN
   * re-fold (jsonb_array_elements over the frozen per-row evidence) —
   * plus the summary's accrued (which must equal Σ employee + Σ employer
   * + Σ PIT). Any drift between the three surfaces FAILS the tie and
   * blocks the export (never a silently wrong number).
   */
  async statutorySummary(input: { fromDate: string; toDate: string }): Promise<{
    rows: {
      key: string;
      periodName: string;
      code: string;
      kind: "CONTRIBUTION" | "PIT";
      baseTotal: string;
      employeeShare: string;
      employerShare: string;
      cappedCount: number;
      accrued: string;
      remitted: string;
    }[];
    ties: {
      periods: {
        periodName: string;
        lineEmployee: string;
        runEmployee: string;
        foldEmployee: string;
        lineEmployer: string;
        runEmployer: string;
        foldEmployer: string;
        linePit: string;
        runPit: string;
        summaryAccrued: string;
        summaryRemitted: string;
      }[];
      ok: boolean;
    };
  }> {
    const windowClause = sql`r.status = 'POSTED'
          AND p.start_date >= ${input.fromDate} AND p.start_date <= ${input.toDate}`;

    // (1) The per-(period × code) contribution fold — from the frozen
    // per-line breakdown jsonb (THE row-level INV-032(a) evidence: each
    // entry carries its own base, clampedBase, rates, and amounts).
    const contributionRows = (
      await tenantTx().execute(sql`
        SELECT p.name AS period_name, entry->>'code' AS code,
               COALESCE(SUM((entry->>'base')::numeric), 0)::numeric(19,4)::text AS base_total,
               COALESCE(SUM((entry->>'employeeAmount')::numeric), 0)::numeric(19,4)::text AS employee_share,
               COALESCE(SUM((entry->>'employerAmount')::numeric), 0)::numeric(19,4)::text AS employer_share,
               COUNT(*) FILTER (WHERE entry->>'clampedBy' IS NOT NULL)::int AS capped_count
        FROM payroll_run_lines l
        JOIN payroll_runs r ON r.id = l.run_id
        JOIN fiscal_periods p ON p.id = r.fiscal_period_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.statutory_breakdown, '[]'::jsonb)) AS entry
        WHERE ${windowClause} AND entry->>'kind' = 'CONTRIBUTION'
        GROUP BY p.name, entry->>'code'
        ORDER BY p.name, entry->>'code'
      `)
    ).rows as unknown as {
      period_name: string;
      code: string;
      base_total: string;
      employee_share: string;
      employer_share: string;
      capped_count: number;
    }[];

    // (2) The PIT row per period — from the line column (the breakdown
    // carries no PIT entry; the summary's PIT row is the frozen fold).
    const pitRows = (
      await tenantTx().execute(sql`
        SELECT p.name AS period_name, COALESCE(SUM(l.pit_withheld), 0)::text AS pit
        FROM payroll_run_lines l
        JOIN payroll_runs r ON r.id = l.run_id
        JOIN fiscal_periods p ON p.id = r.fiscal_period_id
        WHERE ${windowClause}
        GROUP BY p.name
        ORDER BY p.name
      `)
    ).rows as unknown as { period_name: string; pit: string }[];

    // (3) The frozen statutory_summary liability per (period × code).
    const summaryRows = (
      await tenantTx().execute(sql`
        SELECT p.name AS period_name, s->>'code' AS code, s->>'kind' AS kind,
               COALESCE(SUM((s->>'accrued')::numeric), 0)::numeric(19,4)::text AS accrued,
               COALESCE(SUM((s->>'remitted')::numeric), 0)::numeric(19,4)::text AS remitted
        FROM payroll_runs r
        JOIN fiscal_periods p ON p.id = r.fiscal_period_id
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.statutory_summary, '[]'::jsonb)) AS s
        WHERE ${windowClause}
        GROUP BY p.name, s->>'code', s->>'kind'
        ORDER BY p.name, s->>'code'
      `)
    ).rows as unknown as {
      period_name: string;
      code: string;
      kind: string;
      accrued: string;
      remitted: string;
    }[];

    const summaryByPeriodCode = new Map(
      summaryRows.map((row) => [`${row.period_name}|${row.kind}|${row.code}`, row]),
    );
    const pitByPeriod = new Map(pitRows.map((row) => [row.period_name, row.pit]));

    const rows: {
      key: string;
      periodName: string;
      code: string;
      kind: "CONTRIBUTION" | "PIT";
      baseTotal: string;
      employeeShare: string;
      employerShare: string;
      cappedCount: number;
      accrued: string;
      remitted: string;
    }[] = [];
    for (const row of contributionRows) {
      const summary = summaryByPeriodCode.get(`${row.period_name}|CONTRIBUTION|${row.code}`);
      rows.push({
        key: `${row.period_name}|${row.code}`,
        periodName: row.period_name,
        code: row.code,
        kind: "CONTRIBUTION",
        baseTotal: row.base_total,
        employeeShare: row.employee_share,
        employerShare: row.employer_share,
        cappedCount: row.capped_count,
        accrued: summary?.accrued ?? "0",
        remitted: summary?.remitted ?? "0",
      });
    }
    for (const [periodName, pit] of pitByPeriod) {
      if (compareExact(pit, "0") === 0) continue; // no withheld PIT ⇒ no row
      const summary = summaryByPeriodCode.get(`${periodName}|PIT|PIT`);
      rows.push({
        key: `${periodName}|PIT`,
        periodName,
        code: "PIT",
        kind: "PIT",
        baseTotal: "0.0000",
        employeeShare: pit,
        employerShare: "0.0000",
        cappedCount: 0,
        accrued: summary?.accrued ?? pit,
        remitted: summary?.remitted ?? "0.0000",
      });
    }
    rows.sort((a, b) =>
      a.periodName === b.periodName ? a.code.localeCompare(b.code) : a.periodName.localeCompare(b.periodName),
    );

    // (4) THE THREE-WAY TIE (INV-032(b), block-on-fail): per period, the
    // line columns vs the run totals vs the independent jsonb re-fold —
    // and the summary's accrued (Σ employee + Σ employer + Σ PIT).
    const runTotals = new Map(
      (
        (
          await tenantTx().execute(sql`
          SELECT p.name AS period_name,
                 COALESCE(SUM(r.statutory_employee_total), 0)::text AS employee,
                 COALESCE(SUM(r.statutory_employer_total), 0)::text AS employer,
                 COALESCE(SUM(r.pit_total), 0)::text AS pit
          FROM payroll_runs r
          JOIN fiscal_periods p ON p.id = r.fiscal_period_id
          WHERE ${windowClause}
          GROUP BY p.name ORDER BY p.name
        `)
        ).rows as unknown as { period_name: string; employee: string; employer: string; pit: string }[]
      ).map((row) => [row.period_name, row] as const),
    );
    const lineTotals = new Map(
      (
        (
          await tenantTx().execute(sql`
          SELECT p.name AS period_name,
                 COALESCE(SUM(l.statutory_employee_share), 0)::text AS employee,
                 COALESCE(SUM(l.statutory_employer_share), 0)::text AS employer,
                 COALESCE(SUM(l.pit_withheld), 0)::text AS pit
          FROM payroll_run_lines l
          JOIN payroll_runs r ON r.id = l.run_id
          JOIN fiscal_periods p ON p.id = r.fiscal_period_id
          WHERE ${windowClause}
          GROUP BY p.name ORDER BY p.name
        `)
        ).rows as unknown as { period_name: string; employee: string; employer: string; pit: string }[]
      ).map((row) => [row.period_name, row] as const),
    );
    const foldTotals = new Map(
      (
        (
          await tenantTx().execute(sql`
          SELECT p.name AS period_name,
                 COALESCE(SUM((entry->>'employeeAmount')::numeric), 0)::numeric(19,4)::text AS employee,
                 COALESCE(SUM((entry->>'employerAmount')::numeric), 0)::numeric(19,4)::text AS employer
          FROM payroll_run_lines l
          JOIN payroll_runs r ON r.id = l.run_id
          JOIN fiscal_periods p ON p.id = r.fiscal_period_id
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.statutory_breakdown, '[]'::jsonb)) AS entry
          WHERE ${windowClause}
          GROUP BY p.name ORDER BY p.name
        `)
        ).rows as unknown as { period_name: string; employer: string; employee: string }[]
      ).map((row) => [row.period_name, row] as const),
    );
    const summaryTotals = new Map(
      (
        (
          await tenantTx().execute(sql`
          SELECT p.name AS period_name,
                 COALESCE(SUM((s->>'accrued')::numeric), 0)::numeric(19,4)::text AS accrued,
                 COALESCE(SUM((s->>'remitted')::numeric), 0)::numeric(19,4)::text AS remitted
          FROM payroll_runs r
          JOIN fiscal_periods p ON p.id = r.fiscal_period_id
          CROSS JOIN LATERAL jsonb_array_elements(COALESCE(r.statutory_summary, '[]'::jsonb)) AS s
          WHERE ${windowClause}
          GROUP BY p.name ORDER BY p.name
        `)
        ).rows as unknown as { period_name: string; accrued: string; remitted: string }[]
      ).map((row) => [row.period_name, row] as const),
    );

    const periodNames = new Set<string>([
      ...runTotals.keys(),
      ...lineTotals.keys(),
      ...foldTotals.keys(),
      ...summaryTotals.keys(),
    ]);
    const ties = {
      periods: [...periodNames].sort().map((periodName) => ({
        periodName,
        lineEmployee: lineTotals.get(periodName)?.employee ?? "0.0000",
        runEmployee: runTotals.get(periodName)?.employee ?? "0.0000",
        foldEmployee: foldTotals.get(periodName)?.employee ?? "0.0000",
        lineEmployer: lineTotals.get(periodName)?.employer ?? "0.0000",
        runEmployer: runTotals.get(periodName)?.employer ?? "0.0000",
        foldEmployer: foldTotals.get(periodName)?.employer ?? "0.0000",
        linePit: lineTotals.get(periodName)?.pit ?? "0.0000",
        runPit: runTotals.get(periodName)?.pit ?? "0.0000",
        summaryAccrued: summaryTotals.get(periodName)?.accrued ?? "0.0000",
        summaryRemitted: summaryTotals.get(periodName)?.remitted ?? "0.0000",
      })),
      ok: true,
    };
    ties.ok = ties.periods.every(
      (period) =>
        compareExact(period.lineEmployee, period.runEmployee) === 0 &&
        compareExact(period.lineEmployee, period.foldEmployee) === 0 &&
        compareExact(period.lineEmployer, period.runEmployer) === 0 &&
        compareExact(period.lineEmployer, period.foldEmployer) === 0 &&
        compareExact(period.linePit, period.runPit) === 0 &&
        compareExact(
          period.summaryAccrued,
          addExact(period.lineEmployee, addExact(period.lineEmployer, period.linePit)),
        ) === 0,
    );
    return { rows, ties };
  }

  /**
   * PHASE-046 (W-6, T-13 — D-12) · `payroll.eosb-liability`: the
   * per-employee EOSB liability view — service years, the tier-fold days,
   * the computed entitlement, the STANDING provision (the 029 balance +
   * the accumulated G-54 true-up deltas — BR-087's model), the settled
   * cash, and the latest delta — over every employee carrying EOSB
   * computation evidence.
   *
   * The tie (`eosb-provision-tie`, block-on-fail): Σ per-employee
   * standing provisions == the EOS_PROVISION purpose account's
   * natural-direction GL balance (LIABILITY: credit − debit) — the GL
   * includes the G-54 legs by construction, and the standing model is
   * exactly the register side that ties: unsettled employees carry
   * accrued + Σ deltas; settled employees carry Σ deltas only (the G-31
   * extinguished their 029 balance at the run-line fold). The 029-era
   * `payroll.eos-provision` report's register fold predates the G-54
   * legs — see the dated note on that contract (the W-3/W-6 design
   * point recorded for the owner).
   */
  async eosbLiability(): Promise<{
    rows: {
      employeeId: string;
      employeeCode: string;
      employeeName: string;
      employeeNameAr: string | null;
      status: string;
      kind: string;
      serviceYears: string;
      tierDays: string;
      entitlement: string;
      standing: string;
      settled: string | null;
      lastDelta: string;
      calculationCount: number;
    }[];
    ties: { registerBalance: string; glBalance: string; ok: boolean };
  }> {
    // The row universe is the GL's whole provision surface: employees
    // with EOSB computation evidence ∪ employees with POSTED-run EOS
    // accruals ∪ settled employees. An accrued-but-never-trued-up
    // employee carries NO computation row (the honest "—" state — the
    // 029 provision without the 046 computation) but their balance IS
    // part of the GL the tie must account for, so they render with the
    // 029-only standing and no entitlement — the reconciliation gap the
    // true-up exists to close, visible at the report level.
    const employeeRows = (
      await tenantTx().execute(sql`
        SELECT e.id, e.code, e.name, e.name_ar, e.status, e.eos_settled_amount
        FROM employees e
        WHERE EXISTS (SELECT 1 FROM eosb_calculations c WHERE c.employee_id = e.id)
           OR EXISTS (
             SELECT 1 FROM payroll_run_lines l
             JOIN payroll_runs r ON r.id = l.run_id
             WHERE l.employee_id = e.id AND r.status = 'POSTED' AND l.eos_accrual > 0
           )
           OR e.eos_settled_amount IS NOT NULL
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

    const rows: {
      employeeId: string;
      employeeCode: string;
      employeeName: string;
      employeeNameAr: string | null;
      status: string;
      kind: string;
      serviceYears: string;
      tierDays: string;
      entitlement: string;
      standing: string;
      settled: string | null;
      lastDelta: string;
      calculationCount: number;
    }[] = [];
    for (const employee of employeeRows) {
      // The 029 balance: Σ eos_accrual over POSTED-run lines while
      // unsettled, 0 after the terminal settlement (balanceFor's law).
      const accruedRow = (
        await tenantTx().execute(sql`
          SELECT COALESCE(SUM(l.eos_accrual), 0)::text AS accrued
          FROM payroll_run_lines l JOIN payroll_runs r ON r.id = l.run_id
          WHERE l.employee_id = ${employee.id} AND r.status = 'POSTED'
        `)
      ).rows[0] as { accrued: string };
      const balance =
        employee.eos_settled_amount === null ? accruedRow.accrued : "0.0000";
      const calcRows = (
        await tenantTx().execute(sql`
          SELECT kind, service_years::text AS service_years, tier_breakdown,
                 entitlement_amount::text AS entitlement, delta::text AS delta
          FROM eosb_calculations WHERE employee_id = ${employee.id}
          ORDER BY created_at DESC
        `)
      ).rows as unknown as {
        kind: string;
        service_years: string;
        tier_breakdown: { days?: string }[] | null;
        entitlement: string;
        delta: string;
      }[];
      let deltaSum = "0.0000";
      for (const calc of calcRows) {
        deltaSum = addExact(deltaSum, calc.delta);
      }
      const standing = addExact(balance, deltaSum);
      if (calcRows.length === 0) {
        // The 029-only row: provision accruals (or a settlement) with NO
        // 046 computation — the honest never-true-d-up state (entitlement
        // "—", no tier fold, no delta). The standing is the 029 balance.
        rows.push({
          employeeId: employee.id,
          employeeCode: employee.code,
          employeeName: employee.name,
          employeeNameAr: employee.name_ar,
          status: employee.status,
          kind: "ACCRUED_ONLY",
          serviceYears: "—",
          tierDays: "—",
          entitlement: "—",
          standing,
          settled: employee.eos_settled_amount,
          lastDelta: "—",
          calculationCount: 0,
        });
        continue;
      }
      const latest = calcRows[0]!;
      let tierDays = "0.0000";
      if (Array.isArray(latest.tier_breakdown)) {
        for (const share of latest.tier_breakdown) {
          if (typeof share.days === "string") {
            tierDays = addExact(tierDays, share.days);
          }
        }
      }
      rows.push({
        employeeId: employee.id,
        employeeCode: employee.code,
        employeeName: employee.name,
        employeeNameAr: employee.name_ar,
        status: employee.status,
        kind: latest.kind,
        serviceYears: latest.service_years,
        tierDays,
        entitlement: latest.entitlement,
        standing,
        settled: employee.eos_settled_amount,
        lastDelta: latest.delta,
        calculationCount: calcRows.length,
      });
    }

    let registerBalance = "0.0000";
    for (const row of rows) {
      registerBalance = addExact(registerBalance, row.standing);
    }
    // The GL side: the EOS_PROVISION purpose account's natural balance —
    // the SAME independent fold the 029 report ties against (the G-54
    // legs included by construction; the standing model is the side that
    // accounts for them).
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
