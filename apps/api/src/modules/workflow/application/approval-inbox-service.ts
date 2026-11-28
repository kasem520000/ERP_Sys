import { sql } from "drizzle-orm";

import { WorkflowEngine, readDocumentFacts } from "./workflow-engine";
import type { WorkflowStepVerdict } from "../domain/instance-state-machine";
import {
  WorkflowInputInvalidError,
  WorkflowStepInstanceNotFoundError,
  WorkflowStepStateError,
} from "../domain/workflow-errors";
import * as store from "../infrastructure/workflow.store";
import { resolveEffectiveActor } from "../infrastructure/delegation-service";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-052 (W-48 — T-11 + T-12, dated 2026-11-28) THE APPROVALS INBOX
 * SERVICE + THE TIMELINE READ (the web plane's own backend):
 *
 * THE INBOX (T-11 — the PENDING work with the aging indicators and the
 * quick actions): the caller's OWN current APPROVAL steps (the
 * pointer's own steps on ACTIVE chains — only the current step is
 * actable, the act path's own shape) PLUS THE DELEGATION LANE (D-07's
 * read side): the steps assigned to absent users whose ACTIVE
 * in-scope windows route to the CALLER as the resolution chain's
 * TERMINAL (the actor law's own allowed actor — the inbox never lists
 * a step its reader cannot act on; the candidate rows resolve through
 * the SAME resolveEffectiveActor the act path itself runs, so the
 * listed rows and the actable rows are the same set by construction).
 *
 * THE AGING LAW (the engine-output law): `ageHours` and `overdue` are
 * computed INSIDE THE SQL at the DB's own now() — the board renders
 * them VERBATIM (zero client-side recomputation, zero JS wall clocks;
 * the escalation sweep's own clock discipline, the W-45 law).
 *
 * THE QUICK ACTION (the act): the inbox's approve/reject routes
 * through THE ENGINE'S OWN actOnCurrentStep path VERBATIM — the G-67
 * floor, the delegation resolution, the actor law, the CAS single-use
 * stamp, the pointer walk, the notifications, the bus (every floor
 * the deep-link act rides — never a parallel act path; the W-47
 * deep-link service's own law).
 *
 * THE TIMELINE (T-12 — PP-17): the document's chain (the ACTIVE
 * instance if one lives, else the latest terminal one — the frozen
 * history renders VERBATIM) with the full step history (state,
 * assignee, delegated_to, acted_at, comment) and the document's own
 * rendering facts (the engine's reader — the timeline Card embeds on
 * the bound detail pages). A document with NO chain is the honest
 * 200-with-null read (the unbound doc type's own state — never a 404
 * noise on the detail pages).
 */

/** The inbox row — the aging figures the SQL computed (VERBATIM to the
 * board) + the step's bilingual name (the snapshot's frozen member) +
 * the document's own rendering facts (the engine's reader). The
 * delegated lane's rows carry the absent assignee (`routedFromUserId`). */
export interface WorkflowApprovalView {
  readonly stepInstanceId: string;
  readonly instanceId: string;
  readonly triggerEntity: string;
  readonly documentId: string;
  readonly stepOrder: number;
  readonly stepName: string;
  readonly stepNameAr: string;
  readonly dueAt: string | null;
  readonly assignedAt: string;
  readonly overdue: boolean;
  readonly ageHours: number;
  readonly documentNo: string | null;
  readonly amountBase: string;
  readonly currency: string;
  readonly routedFromUserId: string | null;
}

/** The quick action's outcome (the act path's own shape — the same
 * figures the deep-link act returns). */
export interface ApprovalActOutcome {
  readonly action: "approve" | "reject";
  readonly stepInstanceId: string;
  readonly completed: boolean;
  readonly remaining: number;
  readonly currentStepOrder: number | null;
  readonly completedSteps: number;
}

/** The timeline read — the document's chain with the FULL step history
 * (PP-17: state, assignee, delegated_to, acted_at, comment — the frozen
 * history VERBATIM) + the document's own rendering facts. */
export interface WorkflowTimelineView {
  readonly document: {
    readonly docNo: string | null;
    readonly amountBase: string;
    readonly currency: string;
    readonly status: string;
  };
  readonly instance: {
    readonly id: string;
    readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
    readonly currentStepOrder: number | null;
    readonly completedAt: string | null;
    readonly definitionName: string;
    readonly definitionNameAr: string;
  } | null;
  readonly steps: readonly {
    readonly id: string;
    readonly stepOrder: number;
    readonly stepType: "APPROVAL" | "NOTIFICATION" | "TASK";
    readonly assigneeUserId: string;
    readonly status: "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED" | "DELEGATED";
    readonly delegatedTo: string | null;
    readonly actedAt: string | null;
    readonly actedBy: string | null;
    readonly comment: string | null;
    readonly dueAt: string | null;
  }[];
}

export class WorkflowApprovalInboxService {
  constructor(private readonly engine: WorkflowEngine) {}

  /** THE TYPED LIST — my PENDING work: the current APPROVAL steps
   * assigned to me + the delegation lane (the absent assignees' steps
   * whose resolution terminal is me). Aging-first (the tasks lane's
   * own order law). */
  async listMyApprovals(input: {
    readonly userId: string;
    readonly limit?: number;
  }): Promise<readonly WorkflowApprovalView[]> {
    requireTenantContext();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const mine = await store.findPendingApprovalsForUser(input.userId, limit);
    const views: WorkflowApprovalView[] = [];
    for (const row of mine) {
      const view = await this.toView(row, null);
      if (view !== null) {
        views.push(view);
      }
    }
    // THE DELEGATION LANE (D-07): the absent assignees whose active
    // windows route to ME (the terminal of their resolution chains) —
    // the candidates resolve through the SAME act-path resolution, so
    // the lane lists exactly the rows the caller can act on.
    const candidates = await this.delegationCandidates(input.userId, limit);
    for (const row of candidates) {
      const view = await this.toView(row, row.assigneeUserId);
      if (view !== null) {
        views.push(view);
      }
    }
    // The merged aging-first order (due first, then the oldest chains).
    views.sort((a, b) => {
      const aDue = a.dueAt ?? "9999";
      const bDue = b.dueAt ?? "9999";
      if (aDue !== bDue) {
        return aDue < bDue ? -1 : 1;
      }
      return a.assignedAt < b.assignedAt ? -1 : a.assignedAt > b.assignedAt ? 1 : 0;
    });
    return views.slice(0, limit);
  }

  /** THE QUICK ACTION — approve/reject with the comment: the engine's
   * own act path VERBATIM (the G-67 floor, the delegation resolution,
   * the actor law, the CAS stamp, the pointer walk, the bus). The
   * surface floors: the step exists, is an APPROVAL step, and is the
   * chain's CURRENT step (the ladder law — a future step never acts). */
  async actOnStep(input: {
    readonly stepInstanceId: string;
    readonly actorId: string;
    readonly verdict: WorkflowStepVerdict;
    readonly comment: string | null;
  }): Promise<ApprovalActOutcome> {
    requireTenantContext();
    const step = await store.findStepInstanceById(input.stepInstanceId);
    if (step === undefined) {
      throw new WorkflowStepInstanceNotFoundError({ stepInstanceId: input.stepInstanceId });
    }
    if (step.stepType !== "APPROVAL") {
      throw new WorkflowStepStateError({
        stepInstanceId: step.id,
        from: step.status,
        to: input.verdict === "APPROVE" ? "APPROVED" : "REJECTED",
        reason: `the step is a ${step.stepType} step — the inbox's quick actions act on APPROVAL steps (the task surface carries the TASK completion)`,
      });
    }
    const instance = await store.findInstanceById(step.instanceId);
    if (instance === undefined) {
      throw new WorkflowStepInstanceNotFoundError({ stepInstanceId: input.stepInstanceId });
    }
    if (instance.status !== "ACTIVE" || instance.currentStepOrder !== step.stepOrder) {
      throw new WorkflowStepStateError({
        stepInstanceId: step.id,
        from: step.status,
        to: input.verdict === "APPROVE" ? "APPROVED" : "REJECTED",
        reason: `the step is not the chain's current step (instance ${instance.status}, pointer at ${instance.currentStepOrder ?? "none"}) — the ladder law`,
      });
    }
    const facts = await readDocumentFacts(
      instance.triggerEntity as Parameters<typeof readDocumentFacts>[0],
      instance.triggerEntityId,
    );
    const outcome = await this.engine.actOnCurrentStep({
      instance,
      actorId: input.actorId,
      verdict: input.verdict,
      comment: input.comment,
      facts,
    });
    return {
      action: input.verdict === "APPROVE" ? "approve" : "reject",
      stepInstanceId: step.id,
      completed: outcome.completed,
      remaining: outcome.remaining,
      currentStepOrder: outcome.currentStepOrder,
      completedSteps: outcome.completedSteps,
    };
  }

  /** THE TIMELINE READ (T-12 — PP-17): the document's chain with the
   * full step history + the document's own rendering facts (the
   * engine's reader). A document with no chain is the honest
   * instance-null read (the detail page's own "no chain" state). */
  async readTimeline(input: {
    readonly triggerEntity: string;
    readonly documentId: string;
  }): Promise<WorkflowTimelineView> {
    requireTenantContext();
    let facts: { docNo: string | null; amountBase: string; currency: string; status: string } = {
      docNo: null,
      amountBase: "0.0000",
      currency: "BASE",
      status: "UNKNOWN",
    };
    try {
      facts = await readDocumentFacts(
        input.triggerEntity as Parameters<typeof readDocumentFacts>[0],
        input.documentId,
      );
    } catch {
      // a document the reader cannot resolve renders with the neutral
      // figures (the frozen history still renders — PP-17's own law)
    }
    const instance = await store.findLatestInstanceForDocument(input.triggerEntity, input.documentId);
    if (instance === undefined) {
      return { document: facts, instance: null, steps: [] };
    }
    const snapshot = instance.definitionSnapshot as {
      definition?: { name?: string; nameAr?: string };
    };
    const steps = await store.findStepInstancesForInstance(instance.id);
    return {
      document: facts,
      instance: {
        id: instance.id,
        status: instance.status,
        currentStepOrder: instance.currentStepOrder,
        completedAt: instance.completedAt,
        definitionName: snapshot?.definition?.name ?? "—",
        definitionNameAr: snapshot?.definition?.nameAr ?? "—",
      },
      steps: steps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        stepType: step.stepType,
        assigneeUserId: step.assigneeUserId,
        status: step.status,
        delegatedTo: step.delegatedTo,
        actedAt: step.actedAt,
        actedBy: step.actedBy,
        comment: step.comment,
        dueAt: step.dueAt,
      })),
    };
  }

  /** The delegation lane's candidates: the users whose ACTIVE windows
   * point (transitively) to the caller as the resolution TERMINAL —
   * the candidate steps resolve through the SAME act-path resolution
   * (the listed set IS the actable set by construction). */
  private async delegationCandidates(
    userId: string,
    limit: number,
  ): Promise<readonly store.PendingApprovalRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("the approvals inbox requires an ambient tenant scope");
    }
    // MY INBOUND WINDOWS' from-users (the direct candidates); the
    // transitive chains resolve per candidate step below (the same
    // resolveEffectiveActor the act path runs).
    const windowRows = await context.tx.execute(sql`
      SELECT DISTINCT from_user_id AS "fromUserId"
      FROM delegations
      WHERE to_user_id = ${userId}
        AND starts_at <= now() AND now() < ends_at
    `);
    const fromUsers = (windowRows.rows as unknown as { fromUserId: string }[]).map(
      (row) => row.fromUserId,
    );
    if (fromUsers.length === 0) {
      return [];
    }
    const candidates = await store.findPendingApprovalsForUsers(fromUsers, limit);
    const routed: store.PendingApprovalRow[] = [];
    for (const row of candidates) {
      // exclude my own rows (already in the direct lane) — the direct
      // assignee is always the allowed actor, the lane never duplicates
      if (row.assigneeUserId === userId) {
        continue;
      }
      const resolution = await resolveEffectiveActor({
        triggerEntity: row.triggerEntity,
        assigneeUserId: row.assigneeUserId,
      });
      if (resolution.effectiveActorId === userId) {
        routed.push(row);
      }
    }
    return routed;
  }

  /** The row → view enrichment: the step's bilingual name from the
   * immutable snapshot + the document's own rendering facts (the
   * engine's reader per row, bounded — the task-lane precedent). */
  private async toView(
    row: store.PendingApprovalRow,
    routedFromUserId: string | null,
  ): Promise<WorkflowApprovalView | null> {
    const instance = await store.findInstanceById(row.instanceId);
    if (instance === undefined) {
      return null;
    }
    const snapshot = instance.definitionSnapshot as {
      steps?: readonly { stepOrder: number; name: string; nameAr: string }[];
    };
    const meta = snapshot?.steps?.find((step) => step.stepOrder === row.stepOrder);
    let docNo: string | null = null;
    let amountBase = "0.0000";
    let currency = "BASE";
    try {
      const facts = await readDocumentFacts(
        row.triggerEntity as Parameters<typeof readDocumentFacts>[0],
        row.triggerEntityId,
      );
      docNo = facts.docNo;
      amountBase = facts.amountBase;
      currency = facts.currency;
    } catch {
      // the frozen history renders with the neutral figures
    }
    return {
      stepInstanceId: row.stepInstanceId,
      instanceId: row.instanceId,
      triggerEntity: row.triggerEntity,
      documentId: row.triggerEntityId,
      stepOrder: row.stepOrder,
      stepName: meta?.name ?? `Step ${row.stepOrder}`,
      stepNameAr: meta?.nameAr ?? `خطوة ${row.stepOrder}`,
      dueAt: row.dueAt,
      assignedAt: row.assignedAt,
      overdue: row.overdue,
      ageHours: row.ageHours,
      documentNo: docNo,
      amountBase,
      currency,
      routedFromUserId,
    };
  }
}

/** The typed trigger-entity guard for the controller's zod vocabulary
 * (the closed registry — D-05's ruling (ج)). */
export function isWorkflowTriggerEntity(value: string): boolean {
  return (
    value === "manual_journal" ||
    value === "purchase_order" ||
    value === "change_order" ||
    value === "duty_drawback_claim"
  );
}

/** The input-invalid wrap for the controller's typed floors (the
 * trigger entity + the document id). */
export function workflowTriggerRefusal(field: string, reason: string): WorkflowInputInvalidError {
  return new WorkflowInputInvalidError({ field, reason });
}
