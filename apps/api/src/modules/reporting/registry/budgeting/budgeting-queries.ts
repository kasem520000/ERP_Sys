import { Injectable } from "@nestjs/common";

import { addExact, compareExact, subExact } from "../../../accounting/application/decimal-strings";
import * as journal from "../../../accounting/infrastructure/journal.store";
import {
  actualsForPeriods,
  findAccount,
  findBudgetById,
  listBudgets,
  listLines,
  listPeriodsOfYear,
  type ActualsRow,
  type BudgetRow,
} from "../../../budgeting/infrastructure/budgeting.store";
import { scopeDimension, type BudgetScope } from "../../../budgeting/application/budgeting-types";

/**
 * PHASE-028 wave C · the budgeting report queries (REPORT_CATALOG §9 rows
 * 236–237 — the queries behind `budgeting.budget-vs-actual` and
 * `budgeting.variance-analysis`): reporting-facing, read-only, executed
 * inside the ambient tenant transaction exactly like the PHASE-027 notes
 * precedent (ADR-0011 — read-only over the PUBLISHED budgeting tables +
 * the accounting journal store for the GL side; this surface never
 * writes, and budgeting is structurally ledger-incapable, DR-004).
 *
 * ── The variance algebra (BR-050 comparability + ADR-0009) ──────────────
 *
 * The ACTIVE (or explicitly picked) budget version is the baseline;
 * actuals are the natural-direction GL movements per (dimension key ×
 * fiscal period) from the shared `actualsForPeriods` read:
 *   variance    = actual − budget             (exact, 4dp)
 *   variancePct = (actual − budget) / budget × 100 (4dp — the phase §6
 *   worked example: budget 1,000.00, actual 750.00 ⇒ −250.00 / −25.00%;
 *   null when budget = 0 — never a fabricated ∞).
 *
 * ── The ledger tie (`budget-ledger-tie`, block-on-fail) ────────────────
 *
 * Per (fiscal period, account): the dimension-grouped actuals must fold
 * back EXACTLY to the accounting module's own trial-balance movements for
 * the same window (journal.trialBalances({fromDate, toDate}) — an
 * INDEPENDENT code path from the budgeting query, so aggregation drift in
 * the dimension grouping or the BRANCHES source-document LATERAL surfaces
 * as a blocked export, never a silently wrong number). Tolerance 0;
 * whole-tenant (display filters never narrow the ledger check — the
 * maturity-calendar precedent).
 */

export interface VarianceRow {
  readonly key: string;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly accountNameAr: string | null;
  readonly dimensionId: string | null;
  readonly fiscalPeriodId: string;
  readonly periodName: string;
  readonly periodNameAr: string | null;
  readonly budget: string;
  readonly actual: string;
  readonly variance: string;
  readonly variancePct: string | null;
}

export interface VariancePeriodTotal {
  readonly fiscalPeriodId: string;
  readonly periodName: string;
  readonly periodNameAr: string | null;
  readonly budget: string;
  readonly actual: string;
  readonly variance: string;
}

export interface LedgerTieSides {
  /** Per (period, account): the dimension-grouped fold vs the trial balance. */
  readonly rows: {
    fiscalPeriodId: string;
    accountId: string;
    groupedDebit: string;
    groupedCredit: string;
    glDebit: string;
    glCredit: string;
  }[];
  readonly ok: boolean;
}

/** Resolve the target budget: explicit id, else the ACTIVE of (year, scope). */
export async function resolveBudget(input: {
  budgetId?: string | null;
  fiscalYearId?: string | null;
  scope?: BudgetScope | null;
}): Promise<BudgetRow> {
  if (input.budgetId !== undefined && input.budgetId !== null && input.budgetId !== "") {
    const budget = await findBudgetById(input.budgetId);
    if (budget === undefined) {
      throw new Error(`budget ${input.budgetId} not found (own tenant)`);
    }
    return budget;
  }
  if (input.fiscalYearId !== undefined && input.fiscalYearId !== null && input.scope !== undefined && input.scope !== null) {
    const rows = await listBudgets({
      fiscalYearId: input.fiscalYearId,
      scope: input.scope,
      status: "ACTIVE",
    });
    const budget = rows[0];
    if (budget === undefined) {
      throw new Error(
        `no ACTIVE budget for fiscal year ${input.fiscalYearId} scope ${input.scope}`,
      );
    }
    return budget;
  }
  throw new Error("budgetId or (fiscalYearId + scope) is required");
}

/** Variance percent (4dp; null when budget = 0 — never a fabricated ∞). */
export function variancePct(budget: string, actual: string): string | null {
  if (compareExact(budget, "0") === 0) {
    return null;
  }
  const delta = subExact(actual, budget);
  const neg = delta.startsWith("-");
  const [dInt, dFrac = ""] = (neg ? delta.slice(1) : delta).split(".");
  const [bInt, bFrac = ""] = budget.split(".");
  const N = BigInt(dInt + dFrac.padEnd(12, "0")) * 1_000_000n;
  const D = BigInt(bInt + bFrac.padEnd(12, "0"));
  if (D === 0n) {
    return null;
  }
  const q = N / D;
  const negative = neg && q !== 0n;
  const s = q.toString().padStart(5, "0");
  return `${negative ? "-" : ""}${s.slice(0, -4)}.${s.slice(-4)}`;
}

/** The variance rows of one budget (as-of bounded, exact 4dp). */
export async function varianceRows(input: {
  budgetId: string;
  asOf: string;
}): Promise<{ rows: VarianceRow[]; periodTotals: VariancePeriodTotal[]; budget: BudgetRow }> {
  const budget = await findBudgetById(input.budgetId);
  if (budget === undefined) {
    throw new Error(`budget ${input.budgetId} not found (own tenant)`);
  }
  const periods = await listPeriodsOfYear(budget.fiscalYearId);
  const lines = await listLines(budget.id);
  const actuals = await actualsForPeriods(budget.fiscalYearId, budget.scope, input.asOf);

  // Budget fold per (period, account, dimension).
  const budgetFold = new Map<string, string>();
  for (const line of lines) {
    const dimension = scopeDimension(budget.scope);
    const dimensionId =
      dimension === null
        ? null
        : dimension === "costCenterId"
          ? line.costCenterId
          : dimension === "projectId"
            ? line.projectId
            : line.branchId;
    const key = `${line.fiscalPeriodId}|${line.accountId}|${dimensionId ?? ""}`;
    budgetFold.set(key, addExact(budgetFold.get(key) ?? "0", line.amount));
  }

  // Account metadata (code/name/nameAr/type for the natural-direction sign).
  const accounts = new Map<
    string,
    { code: string; name: string; nameAr: string | null; type: string }
  >();
  for (const accountId of new Set([
    ...lines.map((line) => line.accountId),
    ...actuals.map((row) => row.accountId),
  ])) {
    const account = await findAccount(accountId);
    accounts.set(
      accountId,
      account === undefined
        ? { code: "", name: "", nameAr: null, type: "EXPENSE" }
        : { code: account.code, name: account.name, nameAr: account.nameAr, type: account.type },
    );
  }

  const CREDIT_NATURED = new Set(["LIABILITY", "EQUITY", "REVENUE"]);
  const rows: VarianceRow[] = [];
  const seen = new Set<string>();
  const emit = (
    fiscalPeriodId: string,
    accountId: string,
    dimensionId: string | null,
    periodName: string,
    periodNameAr: string | null,
  ): void => {
    const key = `${fiscalPeriodId}|${accountId}|${dimensionId ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const account = accounts.get(accountId)!;
    const budgetAmount = budgetFold.get(key);
    if (budgetAmount === undefined) {
      // Variance rows live on budgeted keys only — actuals without a
      // baseline are the ledger's business, not variance.
      return;
    }
    const actualRow = actuals.find(
      (row) =>
        row.fiscalPeriodId === fiscalPeriodId &&
        row.accountId === accountId &&
        (row.dimensionId ?? "") === (dimensionId ?? ""),
    );
    const actual =
      actualRow === undefined
        ? "0"
        : CREDIT_NATURED.has(account.type)
          ? subExact(actualRow.credit, actualRow.debit)
          : subExact(actualRow.debit, actualRow.credit);
    rows.push({
      key,
      accountId,
      accountCode: account.code,
      accountName: account.name,
      accountNameAr: account.nameAr,
      dimensionId,
      fiscalPeriodId,
      periodName,
      periodNameAr,
      budget: budgetAmount,
      actual,
      variance: subExact(actual, budgetAmount),
      variancePct: variancePct(budgetAmount, actual),
    });
  };
  for (const line of lines) {
    const period = periods.find((candidate) => candidate.id === line.fiscalPeriodId);
    if (period === undefined) {
      continue;
    }
    const dimension = scopeDimension(budget.scope);
    emit(
      line.fiscalPeriodId,
      line.accountId,
      dimension === null
        ? null
        : dimension === "costCenterId"
          ? line.costCenterId
          : dimension === "projectId"
            ? line.projectId
            : line.branchId,
      period.name,
      period.nameAr,
    );
  }

  const periodTotals: VariancePeriodTotal[] = periods.map((period) => {
    let budgetSum = "0";
    let actualSum = "0";
    for (const row of rows) {
      if (row.fiscalPeriodId === period.id) {
        budgetSum = addExact(budgetSum, row.budget);
        actualSum = addExact(actualSum, row.actual);
      }
    }
    return {
      fiscalPeriodId: period.id,
      periodName: period.name,
      periodNameAr: period.nameAr,
      budget: budgetSum,
      actual: actualSum,
      variance: subExact(actualSum, budgetSum),
    };
  });
  return { rows, periodTotals, budget };
}

/**
 * The ledger tie (block-on-fail): per (period, account), the
 * dimension-grouped actuals fold (debit + credit separately) must equal
 * the accounting module's trial-balance movements for the same window —
 * tolerance 0, whole tenant.
 */
export async function ledgerTie(input: {
  fiscalYearId: string;
  scope: BudgetScope;
}): Promise<LedgerTieSides> {
  const periods = await listPeriodsOfYear(input.fiscalYearId);
  const grouped = await actualsForPeriods(input.fiscalYearId, input.scope, null);
  const rows: LedgerTieSides["rows"] = [];
  let ok = true;
  for (const period of periods) {
    // GL side: the accounting module's own read (independent code path).
    const balances = await journal.trialBalances({
      fromDate: period.startDate,
      toDate: period.endDate,
    });
    for (const balance of balances) {
      const groupedRows = grouped.filter(
        (row) => row.fiscalPeriodId === period.id && row.accountId === balance.accountId,
      );
      const groupedDebit = groupedRows.reduce((sum, row) => addExact(sum, row.debit), "0");
      const groupedCredit = groupedRows.reduce((sum, row) => addExact(sum, row.credit), "0");
      const debitOk = compareExact(groupedDebit, balance.debit) === 0;
      const creditOk = compareExact(groupedCredit, balance.credit) === 0;
      if (!debitOk || !creditOk) {
        ok = false;
      }
      rows.push({
        fiscalPeriodId: period.id,
        accountId: balance.accountId,
        groupedDebit,
        groupedCredit,
        glDebit: balance.debit,
        glCredit: balance.credit,
      });
    }
  }
  return { rows, ok };
}

@Injectable()
export class BudgetingQueriesService {
  /** The contract-facing surface (mirrors the notes queries service shape). */
  async budgetVsActual(input: {
    budgetId?: string | null;
    fiscalYearId?: string | null;
    scope?: BudgetScope | null;
    asOf: string;
  }): Promise<{ budget: BudgetRow; rows: VarianceRow[]; periodTotals: VariancePeriodTotal[] }> {
    const budget = await resolveBudget(input);
    const { rows, periodTotals } = await varianceRows({ budgetId: budget.id, asOf: input.asOf });
    return { budget, rows, periodTotals };
  }

  async varianceAnalysis(input: {
    budgetId?: string | null;
    fiscalYearId?: string | null;
    scope?: BudgetScope | null;
    asOf: string;
    thresholdPercent?: number;
  }): Promise<{
    budget: BudgetRow;
    rows: VarianceRow[];
    periodTotals: VariancePeriodTotal[];
    topOver: VarianceRow[];
    topUnder: VarianceRow[];
  }> {
    const budget = await resolveBudget(input);
    const { rows, periodTotals } = await varianceRows({ budgetId: budget.id, asOf: input.asOf });
    const byAbsDesc = (list: VarianceRow[]) =>
      [...list].sort((a, b) => {
        const absA = a.variance.startsWith("-") ? a.variance.slice(1) : a.variance;
        const absB = b.variance.startsWith("-") ? b.variance.slice(1) : b.variance;
        return compareExact(absB, absA);
      });
    const over = rows.filter((row) => compareExact(row.variance, "0") > 0);
    const under = rows.filter((row) => compareExact(row.variance, "0") < 0);
    void input.thresholdPercent;
    return {
      budget,
      rows,
      periodTotals,
      topOver: byAbsDesc(over).slice(0, 10),
      topUnder: byAbsDesc(under).slice(0, 10),
    };
  }

  async ledgerTieOf(input: {
    budgetId?: string | null;
    fiscalYearId?: string | null;
    scope?: BudgetScope | null;
  }): Promise<LedgerTieSides> {
    const budget = await resolveBudget(input);
    return ledgerTie({ fiscalYearId: budget.fiscalYearId, scope: budget.scope });
  }
}

export type { ActualsRow };
