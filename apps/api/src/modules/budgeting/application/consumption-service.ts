import { Injectable } from "@nestjs/common";

import { addExact, compareExact, multiplyExact, subExact } from "../../accounting/application/decimal-strings";
import {
  actualsForPeriods,
  findAccount,
  findBudgetById,
  listLines,
  listPeriodsOfYear,
  type ActualsRow,
  type BudgetLineRow,
} from "../infrastructure/budgeting.store";
import type { BudgetScope, ConsumptionKeyRow } from "./budgeting-types";

/**
 * The consumption read model (PHASE-028 T5 — the budget-vs-actual engine's
 * live side): per (dimension key × fiscal period) actuals read from the
 * GL, strictly read-only. The engine NEVER recomputes the GL, NEVER writes
 * journal tables (ADR-0007 monopoly preserved — grep-clean by
 * construction), and caches per ADR-0008 with a bounded TTL (60 s) +
 * explicit invalidation on import/activation events (stale entries are
 * labeled `stale: true`, never silently served as fresh — the PDC-calendar
 * discipline). Reports NEVER read this cache: the variance contracts
 * always compute fresh (as-of deterministic) over the SAME shared store
 * query `actualsForPeriods` — exported below for the reporting wave.
 *
 * Natural-direction convention (the variance sign, documented in
 * TABLES/budgeting.md): actual = debit − credit for ASSET/EXPENSE
 * accounts, credit − debit for LIABILITY/EQUITY/REVENUE. The store returns
 * raw debit/credit sums; this service applies the sign.
 */

/** CREDIT-natured account types (actual = credit − debit). */
const CREDIT_NATURED = new Set(["LIABILITY", "EQUITY", "REVENUE"]);

export function naturalDirectionActual(accountType: string, debit: string, credit: string): string {
  return CREDIT_NATURED.has(accountType) ? subExact(credit, debit) : subExact(debit, credit);
}

export interface ConsumptionPeriod {
  readonly fiscalPeriodId: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly rows: readonly ConsumptionKeyRow[];
}

export interface ConsumptionSnapshot {
  readonly budgetId: string;
  readonly scope: BudgetScope | null;
  readonly computedAt: string;
  readonly stale: boolean;
  readonly periods: readonly ConsumptionPeriod[];
}

/** The scope dimension of a budget line's key (its grouping id or null). */
function dimensionIdOf(
  scope: BudgetScope,
  line: { costCenterId: string | null; projectId: string | null; branchId: string | null },
): string | null {
  switch (scope) {
    case "COST_CENTERS":
      return line.costCenterId;
    case "PROJECTS":
      return line.projectId;
    case "BRANCHES":
      return line.branchId;
    case "ACCOUNTS":
      return null;
  }
}

/** In-memory ADR-0008 cache: budgetId → snapshot (TTL 60 s, stale labeled). */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, ConsumptionSnapshot>();

/** Explicit invalidation (import commit / activation / tests call this). */
export function invalidateConsumptionCache(): void {
  cache.clear();
}

/** Percent of budget used — display-grade 2dp string; null when budget = 0. */
export function percentUsed(budget: string, actualLike: string): string | null {
  if (compareExact(budget, "0") === 0) {
    return null;
  }
  return divide2dp(multiplyExact(actualLike, "100"), budget);
}

function divide2dp(numerator: string, denominator: string): string {
  const negN = numerator.startsWith("-");
  const negD = denominator.startsWith("-");
  const n = negN ? numerator.slice(1) : numerator;
  const d = negD ? denominator.slice(1) : denominator;
  const neg = negN !== negD;
  const [nInt, nFrac = ""] = n.split(".");
  const [dInt, dFrac = ""] = d.split(".");
  const SCALE = 12;
  const N = BigInt(nInt + nFrac.padEnd(SCALE, "0"));
  const D = BigInt(dInt + dFrac.padEnd(SCALE, "0"));
  if (D === 0n) {
    return "0.00";
  }
  const q = (N * 100n) / D; // already 2dp-scaled
  const negative = neg && q !== 0n;
  const s = q.toString().padStart(3, "0");
  return `${negative ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

/** Shared fold key: (period, account, scope dimension). */
function keyOf(periodId: string, accountId: string, dimensionId: string | null): string {
  return `${periodId}|${accountId}|${dimensionId ?? ""}`;
}

@Injectable()
export class ConsumptionService {
  /**
   * The live per-period consumption read for the grid banners
   * (`GET /budgets/:id/consumption`). Cached per budget (TTL 60 s, stale
   * labeled); reports compute fresh over the same shared query.
   */
  async consumptionForBudget(budgetId: string): Promise<ConsumptionSnapshot> {
    const cached = cache.get(budgetId);
    const now = Date.now();
    if (
      cached !== undefined &&
      now - Date.parse(cached.computedAt) < CACHE_TTL_MS
    ) {
      return { ...cached, stale: false };
    }
    const snapshot = await this.computeSnapshot(budgetId);
    cache.set(budgetId, snapshot);
    return { ...snapshot, stale: now - Date.parse(snapshot.computedAt) >= CACHE_TTL_MS };
  }

  /** Fresh (uncached) computation — the reports/import/refresh path. */
  async computeSnapshot(budgetId: string): Promise<ConsumptionSnapshot> {
    const budget = await findBudgetById(budgetId);
    if (budget === undefined) {
      return {
        budgetId,
        scope: null,
        computedAt: new Date().toISOString(),
        stale: false,
        periods: [],
      };
    }
    const periods = await listPeriodsOfYear(budget.fiscalYearId);
    const lines = await listLines(budgetId);
    const actuals = await actualsForPeriods(budget.fiscalYearId, budget.scope);

    // Budget-side fold: (period, account, dimension) → exact sum.
    const budgetFold = new Map<string, string>();
    for (const line of lines) {
      const key = keyOf(line.fiscalPeriodId, line.accountId, dimensionIdOf(budget.scope, line));
      budgetFold.set(key, addExact(budgetFold.get(key) ?? "0", line.amount));
    }

    // Account types for the natural-direction sign (one read per account).
    const accountTypes = new Map<string, string>();
    for (const accountId of new Set(lines.map((line) => line.accountId))) {
      const account = await findAccount(accountId);
      accountTypes.set(accountId, account?.type ?? "EXPENSE");
    }

    // Actuals keyed the same way (dimension-grouped by the store query).
    const actualsByKey = new Map<string, string>();
    for (const row of actuals) {
      const type = accountTypes.get(row.accountId);
      if (type === undefined) {
        // The account carries no budget line this period — the variance
        // report still ties whole-tenant; the banner shows budget keys only.
        continue;
      }
      const key = keyOf(row.fiscalPeriodId, row.accountId, row.dimensionId);
      const actual = naturalDirectionActual(type, row.debit, row.credit);
      actualsByKey.set(key, addExact(actualsByKey.get(key) ?? "0", actual));
    }

    const periodsOut: ConsumptionPeriod[] = periods.map((period) => {
      const rows: ConsumptionKeyRow[] = [];
      const seenKeys = new Set<string>();
      for (const line of lines) {
        if (line.fiscalPeriodId !== period.id) {
          continue;
        }
        const dimensionId = dimensionIdOf(budget.scope, line);
        const key = keyOf(period.id, line.accountId, dimensionId);
        if (seenKeys.has(key)) {
          continue;
        }
        seenKeys.add(key);
        const budgetAmount = budgetFold.get(key) ?? "0";
        rows.push({
          accountId: line.accountId,
          costCenterId: line.costCenterId,
          projectId: line.projectId,
          branchId: line.branchId,
          budget: budgetAmount,
          actual: actualsByKey.get(key) ?? "0",
          thresholdBudget: budgetAmount,
        });
      }
      return {
        fiscalPeriodId: period.id,
        name: period.name,
        nameAr: period.nameAr,
        startDate: period.startDate,
        endDate: period.endDate,
        rows,
      };
    });
    return {
      budgetId,
      scope: budget.scope,
      computedAt: new Date().toISOString(),
      stale: false,
      periods: periodsOut,
    };
  }
}

/** Re-exported for the reporting wave (the shared read surface). */
export { actualsForPeriods, type ActualsRow, type BudgetLineRow };
