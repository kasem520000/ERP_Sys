import { Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { FiscalYearNotFoundError } from "../../accounting/domain/accounting-errors";
import { BudgetNotFoundError, BudgetStateError } from "../domain/budgeting-errors";
import { BUDGET_TRANSITIONS, type BudgetScope, type BudgetStatus } from "./budgeting-types";
import {
  findBudgetById,
  findFiscalYear,
  insertBudget,
  listBudgetSummaries,
  listBudgets,
  listLines,
  updateBudgetStatus,
  type BudgetRow,
} from "../infrastructure/budgeting.store";

/**
 * The budget version service (PHASE-028 T2 — BR-050): create + read +
 * close. The lifecycle moves (submit/approve/activate/supersede) live in
 * approval-workflow.ts (T4); this service owns the register surface.
 * Budgets are tenant-scoped natural keys (BUD-<year>-<seq>, DATA_DICTIONARY
 * §12) — no official numbers: a budget is planning data, not a document
 * (ADR-0006).
 */

export interface BudgetSummaryRow extends BudgetRow {
  readonly lineCount: number;
  readonly yearTotal: string;
}

@Injectable()
export class BudgetVersionService {
  constructor(private readonly audit: AuditService) {}

  /** Create a DRAFT version (multiple drafts may coexist with an ACTIVE —
   * revisions start as DRAFT; activation is the exclusive gate). */
  async create(
    input: {
      fiscalYearId: string;
      scope: BudgetScope;
      name: string;
      nameAr?: string | null;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<BudgetRow> {
    if (input.name.length < 1 || input.name.length > 200) {
      throw new BudgetStateError({
        budgetId: "(new)",
        from: "—",
        to: "DRAFT",
        reason: "name must be 1..200 characters",
      });
    }
    const year = await findFiscalYear(input.fiscalYearId);
    if (year === undefined) {
      throw new FiscalYearNotFoundError(input.fiscalYearId);
    }
    const budget = await insertBudget({ ...input, createdBy: actorId });
    await this.audit.record({
      action: "budgeting.budget_created",
      entityType: "budget",
      entityId: budget.id,
      actorId: actorId ?? undefined,
      after: { code: budget.code, scope: budget.scope, fiscalYearId: budget.fiscalYearId },
    });
    return budget;
  }

  /** The detail read: budget + summary + the supersede chain (cap 50). */
  async get(id: string): Promise<{ budget: BudgetRow; lineCount: number; chain: BudgetRow[] }> {
    const budget = await findBudgetById(id);
    if (budget === undefined) {
      throw new BudgetNotFoundError(id);
    }
    const lines = await listLines(id);
    const chain: BudgetRow[] = [];
    let current = budget;
    for (let depth = 0; depth < 50 && current.supersedesId !== null; depth += 1) {
      const predecessor = await findBudgetById(current.supersedesId);
      if (predecessor === undefined) {
        break;
      }
      chain.push(predecessor);
      current = predecessor;
    }
    return { budget, lineCount: lines.length, chain };
  }

  /** The register list with per-budget line count + year total. */
  async list(filter: {
    fiscalYearId?: string;
    scope?: BudgetScope;
    status?: BudgetStatus;
  }): Promise<BudgetSummaryRow[]> {
    const rows = await listBudgets(filter);
    const summaries = new Map(
      (await listBudgetSummaries()).map((row) => [row.budgetId, row] as const),
    );
    return rows.map((row) => {
      const summary = summaries.get(row.id);
      return {
        ...row,
        lineCount: summary?.lineCount ?? 0,
        yearTotal: summary?.yearTotal ?? "0",
      };
    });
  }

  /** Close (year-end or manual): ACTIVE|REVISED → CLOSED; readable forever. */
  async close(id: string, actorId: string | null): Promise<BudgetRow> {
    const budget = await findBudgetById(id);
    if (budget === undefined) {
      throw new BudgetNotFoundError(id);
    }
    this.assertTransition(budget.status, "CLOSED", id);
    const closed = await updateBudgetStatus(id, {
      status: "CLOSED",
      closedAt: new Date().toISOString(),
      closedBy: actorId,
    });
    await this.audit.record({
      action: "budgeting.budget_closed",
      entityType: "budget",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: budget.status },
      after: { status: "CLOSED", closedAt: closed.closedAt },
    });
    return closed;
  }

  /** The legal-transition gate (the frozen BR-050 machine). */
  private assertTransition(from: BudgetStatus, to: BudgetStatus, budgetId: string): void {
    if (!BUDGET_TRANSITIONS[from].includes(to)) {
      throw new BudgetStateError({ budgetId, from, to });
    }
  }
}
