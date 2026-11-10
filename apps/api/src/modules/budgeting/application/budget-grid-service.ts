import { Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { AccountNotFoundError, ProjectNotFoundError } from "../../accounting/domain/accounting-errors";
import { addExact } from "../../accounting/application/decimal-strings";
import {
  BudgetImmutableError,
  BudgetDuplicateLineError,
  BudgetCostCenterNotFoundError,
  BudgetBranchNotFoundError,
  BudgetLineLimitError,
  BudgetPeriodMismatchError,
  BudgetScopeDimensionError,
  BudgetNotFoundError,
} from "../domain/budgeting-errors";
import {
  scopeDimension,
  type BudgetLineInput,
  type ConsumptionKeyRow,
} from "./budgeting-types";
import {
  findAccount,
  findBudgetById,
  findCostCenter,
  findProject,
  findBranch,
  listLines,
  listPeriodsOfYear,
  replaceLines,
  type BudgetLineRow,
  type BudgetRow,
  type FiscalPeriodInfo,
} from "../infrastructure/budgeting.store";
import { ConsumptionService } from "./consumption-service";
import { buildGridXlsx } from "../infrastructure/xlsx-grid-adapter";

/**
 * The budget grid service (PHASE-028 T3): the period-column bulk surface —
 * one row per (dimension key × fiscal period), DRAFT-only mutable (409
 * IMMUTABLE_DOCUMENT on non-DRAFT parents, the phase §4 contract), with
 * scope-dimension consistency, period∈year validation, exact-4dp amounts,
 * and live row/period/year totals. Export renders the XLSX grid (the
 * module's own data — the PHASE-013 pipeline serves report exports only).
 */

const MAX_LINES = 20_000;
const AMOUNT_RE = /^\d+(\.\d{1,4})?$/;

export interface GridTotals {
  readonly year: string;
  readonly perPeriod: Readonly<Record<string, string>>;
}

export interface GridAccountView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly type: string;
  readonly isPostable: boolean;
}

export interface GridLineView extends BudgetLineRow {
  readonly account: GridAccountView | null;
}

export interface BudgetGrid {
  readonly budget: BudgetRow;
  readonly periods: readonly FiscalPeriodInfo[];
  readonly lines: readonly GridLineView[];
  readonly totals: GridTotals;
}

@Injectable()
export class BudgetGridService {
  constructor(
    private readonly audit: AuditService,
    private readonly consumptionService: ConsumptionService,
  ) {}

  /** The DRAFT-only bulk replace (the workspace save + import commit path). */
  async replaceGrid(
    budgetId: string,
    lines: readonly BudgetLineInput[],
    actorId: string | null,
  ): Promise<{ lineCount: number; totals: GridTotals }> {
    const budget = await findBudgetById(budgetId);
    if (budget === undefined) {
      throw new BudgetNotFoundError(budgetId);
    }
    if (budget.status !== "DRAFT") {
      throw new BudgetImmutableError({ budgetId, status: budget.status });
    }
    if (lines.length > MAX_LINES) {
      throw new BudgetLineLimitError({ lineCount: lines.length, max: MAX_LINES });
    }
    const periods = await listPeriodsOfYear(budget.fiscalYearId);
    const periodIds = new Set(periods.map((period) => period.id));
    const requiredDimension = scopeDimension(budget.scope);
    const seenKeys = new Set<string>();
    const validated: {
      fiscalPeriodId: string;
      accountId: string;
      costCenterId: string | null;
      projectId: string | null;
      branchId: string | null;
      amount: string;
    }[] = [];
    const accountCache = new Map<string, GridAccountView>();
    for (const line of lines) {
      if (!periodIds.has(line.fiscalPeriodId)) {
        throw new BudgetPeriodMismatchError({
          budgetId,
          fiscalYearId: budget.fiscalYearId,
          fiscalPeriodId: line.fiscalPeriodId,
        });
      }
      if (!AMOUNT_RE.test(line.amount)) {
        throw new BudgetScopeDimensionError({
          scope: budget.scope,
          reason: `amount ${line.amount} is not a non-negative decimal (≤ 4dp, ADR-0009)`,
        });
      }
      const account = accountCache.get(line.accountId) ?? (await findAccount(line.accountId));
      if (account === undefined || !account.isPostable) {
        throw new AccountNotFoundError(line.accountId);
      }
      accountCache.set(line.accountId, account);
      // Scope-dimension consistency: exactly the scope's dimension key set.
      const dims = {
        costCenterId: line.costCenterId ?? null,
        projectId: line.projectId ?? null,
        branchId: line.branchId ?? null,
      };
      if (requiredDimension === null) {
        if (dims.costCenterId !== null || dims.projectId !== null || dims.branchId !== null) {
          throw new BudgetScopeDimensionError({
            scope: budget.scope,
            reason: "ACCOUNTS-scope lines carry no cost-center/project/branch dimension",
          });
        }
      } else {
        const setCount = [dims.costCenterId, dims.projectId, dims.branchId].filter(
          (value) => value !== null,
        ).length;
        if (setCount !== 1 || dims[requiredDimension] === null) {
          throw new BudgetScopeDimensionError({
            scope: budget.scope,
            reason: `exactly the ${requiredDimension} dimension is required on every line`,
          });
        }
        if (requiredDimension === "costCenterId") {
          const cc = await findCostCenter(dims.costCenterId!);
          if (cc === undefined) {
            throw new BudgetCostCenterNotFoundError(dims.costCenterId!);
          }
        } else if (requiredDimension === "projectId") {
          const project = await findProject(dims.projectId!);
          if (project === undefined) {
            throw new ProjectNotFoundError(dims.projectId!);
          }
        } else if (requiredDimension === "branchId") {
          const branch = await findBranch(dims.branchId!);
          if (branch === undefined) {
            throw new BudgetBranchNotFoundError(dims.branchId!);
          }
        }
      }
      const key = `${line.fiscalPeriodId}|${line.accountId}|${dims.costCenterId ?? ""}|${dims.projectId ?? ""}|${dims.branchId ?? ""}`;
      if (seenKeys.has(key)) {
        throw new BudgetDuplicateLineError({
          fiscalPeriodId: line.fiscalPeriodId,
          accountId: line.accountId,
          key,
        });
      }
      seenKeys.add(key);
      validated.push({ ...line, ...dims });
    }
    const before = await listLines(budgetId);
    await replaceLines(budgetId, validated, actorId);
    const totals = await this.totalsOf(budgetId, periods);
    await this.audit.record({
      action: "budgeting.grid_replaced",
      entityType: "budget",
      entityId: budgetId,
      actorId: actorId ?? undefined,
      before: { lineCount: before.length },
      after: { lineCount: validated.length, yearTotal: totals.year },
    });
    return { lineCount: validated.length, totals };
  }

  /** The workspace read: budget + periods + enriched lines + live totals. */
  async getGrid(budgetId: string): Promise<BudgetGrid> {
    const budget = await findBudgetById(budgetId);
    if (budget === undefined) {
      throw new BudgetNotFoundError(budgetId);
    }
    const periods = await listPeriodsOfYear(budget.fiscalYearId);
    const lines = await listLines(budgetId);
    const accountCache = new Map<string, GridAccountView | null>();
    const views: GridLineView[] = [];
    for (const line of lines) {
      if (!accountCache.has(line.accountId)) {
        const found = await findAccount(line.accountId);
        accountCache.set(
          line.accountId,
          found === undefined
            ? null
            : {
                id: found.id,
                code: found.code,
                name: found.name,
                nameAr: found.nameAr,
                type: found.type,
                isPostable: found.isPostable,
              },
        );
      }
      const account = accountCache.get(line.accountId) ?? null;
      views.push({ ...line, account });
    }
    const totals = this.foldTotals(lines, periods);
    return { budget, periods, lines: views, totals };
  }

  /** The XLSX grid export (module data — RTL view + tabular money). */
  async exportGrid(
    budgetId: string,
    locale: "ar" | "en",
  ): Promise<{ buffer: Buffer; filename: string }> {
    const grid = await this.getGrid(budgetId);
    const scope = grid.budget.scope;
    const dimensionLabels = new Map<string, string>();
    for (const line of grid.lines) {
      const dimensionId =
        scope === "COST_CENTERS"
          ? line.costCenterId
          : scope === "PROJECTS"
            ? line.projectId
            : scope === "BRANCHES"
              ? line.branchId
              : null;
      if (dimensionId !== null && !dimensionLabels.has(dimensionId)) {
        if (scope === "COST_CENTERS") {
          const cc = await findCostCenter(dimensionId);
          dimensionLabels.set(dimensionId, cc === undefined ? "" : `${cc.code} — ${cc.name}`);
        } else if (scope === "PROJECTS") {
          const project = await findProject(dimensionId);
          dimensionLabels.set(dimensionId, project === undefined ? "" : `${project.code} — ${project.name}`);
        } else if (scope === "BRANCHES") {
          const branch = await findBranch(dimensionId);
          dimensionLabels.set(dimensionId, branch === undefined ? "" : `${branch.code} — ${branch.name}`);
        }
      }
    }
    const buffer = await buildGridXlsx({
      budgetCode: grid.budget.code,
      budgetName: locale === "ar" ? grid.budget.nameAr ?? grid.budget.name : grid.budget.name,
      scope,
      locale,
      periods: grid.periods.map((period) => ({
        id: period.id,
        label: locale === "ar" ? period.nameAr ?? period.name : period.name,
      })),
      lineAmounts: grid.lines.map((line) => ({
        accountId: line.accountId,
        dimensionId:
          scope === "COST_CENTERS"
            ? line.costCenterId
            : scope === "PROJECTS"
              ? line.projectId
              : scope === "BRANCHES"
                ? line.branchId
                : null,
        fiscalPeriodId: line.fiscalPeriodId,
        amount: line.amount,
      })),
      accountLabels: grid.lines.map((line) => ({
        accountId: line.accountId,
        code: line.account?.code ?? "",
        name:
          locale === "ar"
            ? line.account?.nameAr ?? line.account?.name ?? ""
            : line.account?.name ?? "",
        dimensionLabel:
          (scope === "COST_CENTERS" && line.costCenterId !== null
            ? dimensionLabels.get(line.costCenterId)
            : scope === "PROJECTS" && line.projectId !== null
              ? dimensionLabels.get(line.projectId)
              : scope === "BRANCHES" && line.branchId !== null
                ? dimensionLabels.get(line.branchId)
                : null) ?? null,
      })),
    });
    return { buffer, filename: `budget-${grid.budget.code}-${locale}.xlsx` };
  }

  /** The live consumption banner read (cached per ADR-0008, TTL 60 s). */
  async consumption(budgetId: string): Promise<{
    budgetId: string;
    scope: string | null;
    computedAt: string;
    stale: boolean;
    periods: readonly {
      fiscalPeriodId: string;
      name: string;
      nameAr: string | null;
      rows: readonly ConsumptionKeyRow[];
    }[];
  }> {
    return this.consumptionService.consumptionForBudget(budgetId);
  }

  private async totalsOf(
    budgetId: string,
    periods: readonly FiscalPeriodInfo[],
  ): Promise<GridTotals> {
    return this.foldTotals(await listLines(budgetId), periods);
  }

  private foldTotals(
    lines: readonly BudgetLineRow[],
    periods: readonly FiscalPeriodInfo[],
  ): GridTotals {
    const perPeriod: Record<string, string> = {};
    for (const period of periods) {
      perPeriod[period.id] = "0";
    }
    let year = "0";
    for (const line of lines) {
      perPeriod[line.fiscalPeriodId] = addExact(perPeriod[line.fiscalPeriodId] ?? "0", line.amount);
      year = addExact(year, line.amount);
    }
    return { year, perPeriod };
  }
}
