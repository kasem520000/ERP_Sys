import { Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  BudgetActiveExistsError,
  BudgetImmutableError,
  BudgetNotFoundError,
  BudgetNotApprovedError,
  BudgetSelfApprovalError,
  BudgetStateError,
} from "../domain/budgeting-errors";
import { BUDGET_TRANSITIONS, type BudgetStatus } from "./budgeting-types";
import { invalidateConsumptionCache } from "./consumption-service";
import {
  countActiveByYearScope,
  findBudgetById,
  flipPredecessorToRevised,
  insertBudget,
  insertLines,
  listBudgets,
  listLines,
  updateBudgetStatus,
  type BudgetRow,
} from "../infrastructure/budgeting.store";

/**
 * The budget approval workflow (PHASE-028 T4 — BR-050 + SoD):
 * DRAFT → PENDING_APPROVAL (submit) → approve (SoD: the creator never
 * approves — AUTHORIZATION_MATRIX §4 row `budgeting.budgets.approve`; the
 * stamp lands while status is STILL PENDING_APPROVAL — the DB shape CHECK
 * encodes the one-directional implication) → ACTIVE (activate; the
 * superseded predecessor flips to REVISED atomically FIRST so the BR-050
 * partial unique stays satisfied) → CLOSED. Supersede creates a fresh DRAFT
 * with the predecessor's lines copied (revisions supersede, never edit).
 * Every transition is audited.
 */

@Injectable()
export class ApprovalWorkflow {
  constructor(private readonly audit: AuditService) {}

  /** DRAFT → PENDING_APPROVAL (the two-step gate's first step). */
  async submit(budgetId: string, actorId: string | null): Promise<BudgetRow> {
    const budget = await this.load(budgetId);
    this.assertTransition(budget.status, "PENDING_APPROVAL", budgetId);
    const submitted = await updateBudgetStatus(budgetId, {
      status: "PENDING_APPROVAL",
      submittedAt: new Date().toISOString(),
      submittedBy: actorId,
    });
    await this.audit.record({
      action: "budgeting.budget_submitted",
      entityType: "budget",
      entityId: budgetId,
      actorId: actorId ?? undefined,
      before: { status: budget.status },
      after: { status: "PENDING_APPROVAL", submittedAt: submitted.submittedAt },
    });
    return submitted;
  }

  /**
   * Approve (SoD): stamps approved_at/by while the status STAYS
   * PENDING_APPROVAL — activation is the separate, audited step (the
   * ck_budgets_approved_shape one-directional lesson from the 027 CHECK
   * discipline).
   */
  async approve(budgetId: string, actorId: string): Promise<BudgetRow> {
    const budget = await this.load(budgetId);
    if (budget.status !== "PENDING_APPROVAL") {
      throw new BudgetStateError({
        budgetId,
        from: budget.status,
        to: "(approved)",
        reason: "only PENDING_APPROVAL budgets accept an approval stamp",
      });
    }
    if (budget.createdBy !== null && budget.createdBy === actorId) {
      throw new BudgetSelfApprovalError({ budgetId, actorId });
    }
    if (budget.approvedAt !== null) {
      throw new BudgetStateError({
        budgetId,
        from: budget.status,
        to: "(approved)",
        reason: "already approved — activate next",
      });
    }
    const approved = await updateBudgetStatus(budgetId, {
      approvedAt: new Date().toISOString(),
      approvedBy: actorId,
    });
    await this.audit.record({
      action: "budgeting.budget_approved",
      entityType: "budget",
      entityId: budgetId,
      actorId,
      before: { status: budget.status, approvedAt: null },
      after: { status: approved.status, approvedAt: approved.approvedAt },
    });
    return approved;
  }

  /**
   * Activate (BR-050's atomic exclusive flip): requires the approval stamp;
   * flips any existing ACTIVE predecessor (same year + scope) to REVISED
   * FIRST, then sets this budget ACTIVE — one ambient transaction, so the
   * partial unique `uq_budgets_one_active` holds throughout. When this
   * budget carries a supersedes_id, that row MUST be the flipped
   * predecessor (the chain stays honest).
   */
  async activate(budgetId: string, actorId: string | null): Promise<BudgetRow> {
    const budget = await this.load(budgetId);
    this.assertTransition(budget.status, "ACTIVE", budgetId);
    if (budget.approvedAt === null) {
      throw new BudgetNotApprovedError({ budgetId, status: budget.status });
    }
    const activeCount = await countActiveByYearScope(budget.fiscalYearId, budget.scope);
    const activeSibling =
      activeCount > 0 ? await findActiveSibling(budget.fiscalYearId, budget.scope) : undefined;
    if (activeSibling !== undefined && activeSibling.id === budgetId) {
      throw new BudgetStateError({
        budgetId,
        from: budget.status,
        to: "ACTIVE",
        reason: "already ACTIVE",
      });
    }
    if (budget.supersedesId !== null) {
      const predecessor = await findBudgetById(budget.supersedesId);
      if (
        predecessor === undefined ||
        predecessor.fiscalYearId !== budget.fiscalYearId ||
        predecessor.scope !== budget.scope ||
        predecessor.status !== "ACTIVE"
      ) {
        throw new BudgetStateError({
          budgetId,
          from: budget.status,
          to: "ACTIVE",
          reason: "the superseded predecessor must be the ACTIVE version of the same (year, scope)",
        });
      }
      if (activeSibling !== undefined && activeSibling.id !== predecessor.id) {
        throw new BudgetActiveExistsError({
          fiscalYearId: budget.fiscalYearId,
          scope: budget.scope,
          activeBudgetId: activeSibling.id,
        });
      }
    } else if (activeSibling !== undefined) {
      // Original (non-revision) activation against an existing ACTIVE — the
      // honest service-level 409 (the DB partial unique is the race backstop).
      throw new BudgetActiveExistsError({
        fiscalYearId: budget.fiscalYearId,
        scope: budget.scope,
        activeBudgetId: activeSibling.id,
      });
    }
    // The ordered flip: predecessor FIRST (the partial unique discipline).
    if (activeSibling !== undefined) {
      await flip(activeSibling.id);
    }
    const activated = await updateBudgetStatus(budgetId, {
      status: "ACTIVE",
      activatedAt: new Date().toISOString(),
      activatedBy: actorId,
    });
    invalidateConsumptionCache();
    await this.audit.record({
      action: "budgeting.budget_activated",
      entityType: "budget",
      entityId: budgetId,
      actorId: actorId ?? undefined,
      before: { status: budget.status },
      after: {
        status: "ACTIVE",
        activatedAt: activated.activatedAt,
        superseded: activeSibling === undefined ? null : { id: activeSibling.id, to: "REVISED" },
      },
    });
    return activated;
  }

  /**
   * Supersede (BR-050 revisions supersede, never edit): a new DRAFT with
   * supersedes_id = the ACTIVE budget, revision_no + 1, and ALL lines
   * copied — the accountant then edits the draft grid freely.
   */
  async supersede(budgetId: string, actorId: string | null): Promise<BudgetRow> {
    const budget = await this.load(budgetId);
    this.assertTransition(budget.status, "REVISED", budgetId);
    const lines = await listLines(budgetId);
    const revisionNo = budget.revisionNo + 1;
    const draft = await insertBudget({
      fiscalYearId: budget.fiscalYearId,
      scope: budget.scope,
      name: `${budget.name} (R${revisionNo})`,
      nameAr: budget.nameAr === null ? null : `${budget.nameAr} (ن${revisionNo})`,
      revisionNo,
      supersedesId: budget.id,
      note: budget.note,
      noteAr: budget.noteAr,
      createdBy: actorId,
    });
    await insertLines(
      draft.id,
      lines.map((line) => ({
        fiscalPeriodId: line.fiscalPeriodId,
        accountId: line.accountId,
        costCenterId: line.costCenterId,
        projectId: line.projectId,
        branchId: line.branchId,
        amount: line.amount,
      })),
      actorId,
    );
    await this.audit.record({
      action: "budgeting.budget_superseded_draft_created",
      entityType: "budget",
      entityId: draft.id,
      actorId: actorId ?? undefined,
      after: {
        code: draft.code,
        supersedesId: budget.id,
        revisionNo,
        copiedLines: lines.length,
      },
    });
    return draft;
  }

  private async load(budgetId: string): Promise<BudgetRow> {
    const budget = await findBudgetById(budgetId);
    if (budget === undefined) {
      throw new BudgetNotFoundError(budgetId);
    }
    return budget;
  }

  private assertTransition(from: BudgetStatus, to: BudgetStatus, budgetId: string): void {
    if (!BUDGET_TRANSITIONS[from].includes(to)) {
      throw new BudgetStateError({ budgetId, from, to });
    }
  }
}

/** The ACTIVE sibling of a (year, scope) — undefined when none. */
async function findActiveSibling(
  fiscalYearId: string,
  scope: BudgetRow["scope"],
): Promise<BudgetRow | undefined> {
  const rows = await listBudgets({ fiscalYearId, scope, status: "ACTIVE" });
  return rows[0];
}

async function flip(predecessorId: string): Promise<void> {
  await flipPredecessorToRevised(predecessorId, new Date().toISOString(), null);
}

/** DRAFT-only line-edit guard re-exported for the grid service's callers. */
export { BudgetImmutableError };
