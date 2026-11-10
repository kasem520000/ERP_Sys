import { Injectable } from "@nestjs/common";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { addExact, compareExact, multiplyExact } from "../../accounting/application/decimal-strings";
import { BudgetExceededError, type BudgetExceededKey } from "../domain/budgeting-errors";
import { scopeDimension, type BudgetScope } from "./budgeting-types";
import {
  activeBudgetsForTenant,
  findAccount,
  listLines,
  listPeriodsOfYear,
  actualsForPeriods,
  type BudgetRow,
} from "../infrastructure/budgeting.store";
import { naturalDirectionActual } from "./consumption-service";

/**
 * The advisory control guard (PHASE-028 T6 — BR-051, DR-004 option A):
 * evaluates a DRAFT-stage document save's projected period consumption
 * against the ACTIVE budgets and either WARNS (the default — ADVISORY:
 * exactly one notification + a banner payload; the save proceeds) or
 * BLOCKS (the explicit `budgeting.controls.mode = ENFORCE_DRAFT` tenant
 * policy: a typed, audited `BUDGET_EXCEEDED` reason on the document — the
 * block lives on the document flow ONLY, never on the engine).
 *
 * THE LEDGER IS NEVER BLOCKED BY BUDGETS — not by default, not by policy;
 * posted documents are never warned at or after posting (the honesty note
 * is binding). There is NO code path from this guard into the posting
 * pipeline (DR-004: `PostingEngine.post` has no budget call site at all).
 *
 * Zero-overhead discipline (the phase §Performance note): tenants without
 * ACTIVE budgets return `{ mode: "OFF" }` after at most one cached index
 * read — the active-budget index refreshes at most once per minute per
 * tenant (the PDC-calendar Map pattern).
 */

export interface ControlLine {
  readonly accountId: string;
  readonly costCenterId?: string | null;
  readonly projectId?: string | null;
  readonly branchId?: string | null;
  /** The projected period consumption this draft save adds (4dp string). */
  readonly projectedAmount: string;
}

export interface ControlWarning {
  readonly accountId: string;
  readonly periodId: string;
  readonly budgetId: string;
  readonly budgetAmount: string;
  readonly actualAmount: string;
  readonly projectedAmount: string;
  readonly percentUsed: string;
}

export interface ControlEvaluation {
  readonly mode: "OFF" | "ADVISORY" | "ENFORCE_DRAFT";
  readonly warnings: readonly ControlWarning[];
}

/** The in-memory active-budget index (refresh ≤ 1/min per tenant). */
const activeIndex = new Map<string, { at: number; budgets: BudgetRow[] }>();
const INDEX_TTL_MS = 60_000;

export function invalidateActiveBudgetIndex(): void {
  activeIndex.clear();
}

@Injectable()
export class ControlGuard {
  constructor(
    private readonly audit: AuditService,
    private readonly inbox: InboxService,
  ) {}

  /**
   * The declared-edge guard API (DEPENDENCY_RULES §2 — trade-document
   * DRAFT-save flows MAY call this when `budgeting.controls` is entitled):
   * evaluates the document's projected consumption per affected dimension
   * key against the ACTIVE budget of the matching scope.
   */
  async evaluateDraftSave(input: {
    actorId: string | null;
    documentRef: { type: string; id: string; label: string };
    fiscalPeriodId: string;
    lines: readonly ControlLine[];
  }): Promise<ControlEvaluation> {
    const budgets = await this.activeBudgets();
    if (budgets.length === 0) {
      return { mode: "OFF", warnings: [] };
    }
    const mode = await readEffectiveSetting<"ADVISORY" | "ENFORCE_DRAFT">(
      "budgeting.controls.mode",
    );
    const thresholdPercent = await readEffectiveSetting<number>(
      "budgeting.controls.warn_threshold_percent",
    );
    const warnings: ControlWarning[] = [];
    const exceeded: BudgetExceededKey[] = [];
    for (const line of input.lines) {
      if (compareExact(line.projectedAmount, "0") === 0) {
        continue;
      }
      const match = matchBudget(budgets, line);
      if (match === undefined) {
        continue;
      }
      const evaluation = await this.evaluateLine(match, line, input.fiscalPeriodId, thresholdPercent);
      if (evaluation === undefined) {
        continue;
      }
      if (mode === "ENFORCE_DRAFT") {
        exceeded.push(evaluation.key);
      } else {
        warnings.push(evaluation.warning);
      }
    }
    if (mode === "ENFORCE_DRAFT" && exceeded.length > 0) {
      // The typed, visible, AUDITED reason on the document flow (BR-051).
      await this.audit.record({
        action: "budgeting.control_block",
        entityType: input.documentRef.type,
        entityId: input.documentRef.id,
        actorId: input.actorId ?? undefined,
        after: { reason: "BUDGET_EXCEEDED", keys: exceeded },
      });
      throw new BudgetExceededError(exceeded);
    }
    if (warnings.length > 0) {
      // ADVISORY: exactly ONE notification (dedupeKey discipline) + the
      // banner payload the caller renders — the save itself proceeds.
      const worst = warnings.reduce((a, b) =>
        compareExact(a.percentUsed, b.percentUsed) >= 0 ? a : b,
      );
      await this.inbox.record({
        category: "budgeting",
        severity: "warning",
        title: {
          ar: "تجاوز الموازنة التقديري",
          en: "Over budget warning",
        },
        body: {
          ar: `المستند «${input.documentRef.label}» يتجاوز حد الموازنة للفترة (نسبة الاستهلاك ${worst.percentUsed}%) — رقابة استشارية (BR-051): الحفظ proceeds ولن يُمنع أي ترحيل`,
          en: `Document "${input.documentRef.label}" is over the period budget (used ${worst.percentUsed}%) — advisory control (BR-051): the save proceeds and nothing is ever blocked at posting`,
        },
        dedupeKey: `budget-warn:${input.documentRef.type}:${input.documentRef.id}:${input.fiscalPeriodId}`,
      });
      await this.audit.record({
        action: "budgeting.control_warning_emitted",
        entityType: input.documentRef.type,
        entityId: input.documentRef.id,
        actorId: input.actorId ?? undefined,
        after: { warnings },
      });
    }
    return { mode, warnings };
  }

  private async activeBudgets(): Promise<BudgetRow[]> {
    const tenantId = requireTenantId();
    const cached = activeIndex.get(tenantId);
    if (cached !== undefined && Date.now() - cached.at < INDEX_TTL_MS) {
      return cached.budgets;
    }
    const budgets = await activeBudgetsForTenant();
    activeIndex.set(tenantId, { at: Date.now(), budgets });
    return budgets;
  }

  private async evaluateLine(
    budget: BudgetRow,
    line: ControlLine,
    fiscalPeriodId: string,
    thresholdPercent: number,
  ): Promise<{ warning: ControlWarning; key: BudgetExceededKey } | undefined> {
    const lines = await listLines(budget.id);
    const periodIds = new Set((await listPeriodsOfYear(budget.fiscalYearId)).map((p) => p.id));
    if (!periodIds.has(fiscalPeriodId)) {
      return undefined;
    }
    const required = scopeDimension(budget.scope);
    const dimensionMatches =
      required === null
        ? line.costCenterId == null && line.projectId == null && line.branchId == null
        : required === "costCenterId"
          ? line.costCenterId !== null && line.costCenterId !== undefined
          : required === "projectId"
            ? line.projectId !== null && line.projectId !== undefined
            : line.branchId !== null && line.branchId !== undefined;
    if (!dimensionMatches) {
      return undefined;
    }
    // The budget side for THIS (account, dimension, period) key.
    const budgetAmount = lines
      .filter(
        (candidate) =>
          candidate.fiscalPeriodId === fiscalPeriodId &&
          candidate.accountId === line.accountId &&
          dimensionKey(budget.scope, candidate) === dimensionKeyOfLine(budget.scope, line),
      )
      .reduce((sum, candidate) => addExact(sum, candidate.amount), "0");
    if (compareExact(budgetAmount, "0") === 0) {
      return undefined;
    }
    // The actual side (GL read-only, dimension-grouped shared query).
    const account = await findAccount(line.accountId);
    const actuals = await actualsForPeriods(budget.fiscalYearId, budget.scope);
    const actualRow = actuals.find(
      (row) =>
        row.fiscalPeriodId === fiscalPeriodId &&
        row.accountId === line.accountId &&
        (row.dimensionId ?? "") === (dimensionKeyOfLine(budget.scope, line) ?? ""),
    );
    const type = account?.type ?? "EXPENSE";
    const actual =
      actualRow === undefined ? "0" : naturalDirectionActual(type, actualRow.debit, actualRow.credit);
    const projected = addExact(actual, line.projectedAmount);
    const threshold = multiplyExact(budgetAmount, String(thresholdPercent / 100));
    if (compareExact(projected, threshold) < 0) {
      return undefined;
    }
    const percent = percentOf(budgetAmount, projected);
    return {
      warning: {
        accountId: line.accountId,
        periodId: fiscalPeriodId,
        budgetId: budget.id,
        budgetAmount,
        actualAmount: actual,
        projectedAmount: projected,
        percentUsed: percent,
      },
      key: {
        accountId: line.accountId,
        periodId: fiscalPeriodId,
        budgetAmount,
        actualAmount: actual,
        projectedAmount: projected,
        percentUsed: percent,
      },
    };
  }
}

/** The dimension key of a stored budget line (its scope grouping id). */
function dimensionKey(
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

function dimensionKeyOfLine(scope: BudgetScope, line: ControlLine): string | null {
  return dimensionKey(scope, {
    costCenterId: line.costCenterId ?? null,
    projectId: line.projectId ?? null,
    branchId: line.branchId ?? null,
  });
}

/** The scope whose ACTIVE budget matches this line's dimensions. */
function matchBudget(budgets: readonly BudgetRow[], line: ControlLine): BudgetRow | undefined {
  return budgets.find((budget) => {
    const required = scopeDimension(budget.scope);
    if (required === null) {
      return line.costCenterId == null && line.projectId == null && line.branchId == null;
    }
    const value =
      required === "costCenterId"
        ? line.costCenterId
        : required === "projectId"
          ? line.projectId
          : line.branchId;
    return value !== null && value !== undefined;
  });
}

function percentOf(budget: string, actualLike: string): string {
  // (actual / budget) × 100 — 2dp display-grade (the consumption helper
  // convention), integer long division (ADR-0009 display discipline).
  const neg = actualLike.startsWith("-");
  const [aInt, aFrac = ""] = (neg ? actualLike.slice(1) : actualLike).split(".");
  const [bInt, bFrac = ""] = budget.split(".");
  const SCALE = 12n;
  const N = BigInt(aInt + aFrac.padEnd(12, "0")) * 100n;
  const D = BigInt(bInt + bFrac.padEnd(12, "0"));
  if (D === 0n) {
    return "0.00";
  }
  const q = N / D;
  const negative = neg && q !== 0n;
  const s = q.toString().padStart(3, "0");
  void SCALE;
  return `${negative ? "-" : ""}${s.slice(0, -2)}.${s.slice(-2)}`;
}

function requireTenantId(): string {
  return requireTenantContext().tenantId;
}
