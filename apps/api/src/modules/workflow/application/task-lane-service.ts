import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { InboxService } from "../../notifications/application/inbox-service";
import * as store from "../infrastructure/workflow.store";
import {
  WorkflowStepInstanceNotFoundError,
  WorkflowStepStateError,
} from "../domain/workflow-errors";
import { readDocumentFacts, WorkflowEngine } from "./workflow-engine";

/**
 * PHASE-052 (W-47 — T-08, dated 2026-11-27) THE TASKS LANE (D-11 — the
 * TASK step type end-to-end: NO SEVENTH TABLE, no crm coupling). The
 * tasks ARE the `workflow_step_instances` (type TASK) — the assignment
 * is the step's own assignee stamp (resolved at trigger time by the
 * engine's own rule fold), the due dates are the step's own `due_at`
 * (the SLA fold's own stamp), and THE COMPLETION WRITE-BACK IS THE
 * STEP'S OWN ACTED STAMP (the task's completion lands APPROVED with
 * acted_at/acted_by/comment — the same stamp law every act rides; the
 * pointer advances, the chain completes when the task was the last
 * step). The crm reminder-sweep precedent is NOT consumed (no
 * `crm_tasks` coupling — the workflow plane keeps its own rows; the
 * crm module untouched).
 *
 * THE TYPED LIST (the API's own list — the W-48 inbox's tasks lane
 * renders it): the PENDING TASK steps on ACTIVE chains assigned to the
 * caller (the assignee's own lane — the delegated-to-me widening is a
 * dated additive; the delegation plane resolves at act time, D-07's
 * own law). Each row carries the step's bilingual name (the immutable
 * snapshot's own member — the frozen source) + the document's own
 * rendering facts (the ENGINE'S OWN reader per row — never a parallel
 * read path; bounded by the lane's limit).
 *
 * THE COMPLETION (the write-back): the assignee (or their active
 * delegate — the engine's own actor law) completes the task; the act
 * routes through THE ENGINE'S OWN actOnCurrentStep path VERBATIM (the
 * G-67 floor, the delegation resolution, the actor law, the CAS
 * single-use stamp, the pointer walk, the notifications, the bus —
 * every floor the approve act rides; a task is a chain step, its
 * completion is the chain's own act). The TASK floor: the surface
 * completes TASK steps only (an APPROVAL step through the task surface
 * is the typed refusal — the wrong-surface act never lands), and only
 * the chain's CURRENT step (a future task cannot complete early — the
 * ladder law).
 *
 * THE ENTITLEMENT (the declared interpretation): the list probes the
 * `workflow.tasks` flag (0130 §5) and reads GRACEFULLY — the flag-off
 * tenant's lane is EMPTY (the plane does not exist for it; the same
 * graceful shape openChain carries for the engine flag); the
 * completion rides the ENGINE'S own flag floor (the act is the
 * chain's own — actOnCurrentStep's world). The HTTP plane's
 * @RequireFeature guards bind both (the tasks routes on workflow.tasks).
 */
export class WorkflowTaskLaneService {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly inbox: InboxService,
  ) {}

  /** THE TYPED LIST — the caller's own pending tasks (the PENDING TASK
   * steps on ACTIVE chains assigned to them), each with the step's
   * bilingual name (the snapshot's frozen member) and the document's
   * own rendering facts (the engine's reader, bounded). */
  async listMyTasks(input: {
    readonly userId: string;
    readonly limit?: number;
  }): Promise<readonly WorkflowTaskView[]> {
    requireTenantContext();
    if (!(await tenantHasTasksPlane())) {
      // The graceful gate: the flag-off tenant's lane is EMPTY (the
      // plane does not exist — openChain's own shape for the engine
      // flag).
      return [];
    }
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);
    const rows = await store.findPendingTasksForUser(input.userId, limit);
    const views: WorkflowTaskView[] = [];
    for (const row of rows) {
      const instance = await store.findInstanceById(row.instanceId);
      if (instance === undefined) {
        continue;
      }
      const snapshot = instance.definitionSnapshot as {
        steps?: readonly { stepOrder: number; name: string; nameAr: string }[];
      };
      const meta = snapshot?.steps?.find((step) => step.stepOrder === row.stepOrder);
      // THE ENGINE'S OWN READER per row (never a parallel read path);
      // a document row the facts reader cannot resolve (the honest
      // edge: a doc deleted under a live chain — RLS permitting) is
      // skipped, never a crash of the lane.
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
      views.push({
        taskStepId: row.stepInstanceId,
        instanceId: row.instanceId,
        triggerEntity: row.triggerEntity,
        documentId: row.triggerEntityId,
        stepOrder: row.stepOrder,
        stepName: meta?.name ?? `Task ${row.stepOrder}`,
        stepNameAr: meta?.nameAr ?? `مهمة ${row.stepOrder}`,
        dueAt: row.dueAt,
        assignedAt: row.assignedAt,
        documentNo: docNo,
        amountBase,
        currency,
      });
    }
    return views;
  }

  /** THE COMPLETION WRITE-BACK (D-11's own law): the task's completion
   * is the step's own ACTED stamp — the act routes through the
   * engine's own path (the G-67 floor, the actor law, the CAS stamp,
   * the pointer walk, the bus). The TASK floors first: the step must
   * BE a TASK (the wrong-surface refusal) and the chain's CURRENT step
   * (the ladder law — a future task cannot complete early). */
  async completeTask(input: {
    readonly taskStepId: string;
    readonly actorId: string;
    readonly comment: string | null;
  }): Promise<TaskCompletionOutcome> {
    requireTenantContext();
    const step = await store.findStepInstanceById(input.taskStepId);
    if (step === undefined) {
      throw new WorkflowStepInstanceNotFoundError({ stepInstanceId: input.taskStepId });
    }
    if (step.stepType !== "TASK") {
      throw new WorkflowStepStateError({
        stepInstanceId: step.id,
        from: step.status,
        to: "APPROVED",
        reason: `the step is a ${step.stepType} step — the task surface completes TASK steps only (the approval surface carries the approve/reject acts)`,
      });
    }
    const instance = await store.findInstanceById(step.instanceId);
    if (instance === undefined) {
      throw new WorkflowStepInstanceNotFoundError({ stepInstanceId: input.taskStepId });
    }
    if (instance.status !== "ACTIVE" || instance.currentStepOrder !== step.stepOrder) {
      throw new WorkflowStepStateError({
        stepInstanceId: step.id,
        from: step.status,
        to: "APPROVED",
        reason: `the task is not the chain's current step (instance ${instance.status}, pointer at ${instance.currentStepOrder ?? "none"}) — a future task cannot complete early (the ladder law)`,
      });
    }
    if (step.status !== "PENDING" && step.status !== "DELEGATED") {
      throw new WorkflowStepStateError({
        stepInstanceId: step.id,
        from: step.status,
        to: "APPROVED",
        reason: "the task was already completed (the completion is single-use — the acted_at stamp is the ledger)",
      });
    }
    const facts = await readDocumentFacts(
      instance.triggerEntity as Parameters<typeof readDocumentFacts>[0],
      instance.triggerEntityId,
    );
    const outcome = await this.engine.actOnCurrentStep({
      instance,
      actorId: input.actorId,
      verdict: "APPROVE",
      comment: input.comment,
      facts,
    });
    // THE LANE'S OWN NOTIFICATION (the completion's receipt): the
    // completed task's receipt to the actor — one inbox record, the
    // dedupe key the step's own axis (the receipt never double-lands).
    await this.inbox.record({
      category: "workflow",
      severity: "info",
      title: {
        en: `Task completed — step ${step.stepOrder}`,
        ar: `مهمة مكتملة — الخطوة ${step.stepOrder}`,
      },
      body: {
        en: `You completed task step ${step.stepOrder} on the chain for ${instance.triggerEntity} ${facts.docNo ?? instance.triggerEntityId.slice(0, 8)}. ${outcome.completed ? "The chain reached its completion on this act." : `The chain advanced (next step ${outcome.currentStepOrder}).`}`,
        ar: `أكملت خطوة المهمة ${step.stepOrder} على سلسلة ${instance.triggerEntity} ${facts.docNo ?? instance.triggerEntityId.slice(0, 8)}. ${outcome.completed ? "وصلت السلسلة إلى اكتمالها بهذا الإجراء." : `تقدَّمت السلسلة (الخطوة التالية ${outcome.currentStepOrder}).`}`,
      },
      actionLabel: { ar: "مراجعة المستند", en: "Review document" },
      actionUrl: docDetailPath(instance.triggerEntity, instance.triggerEntityId),
      dedupeKey: `workflow:task-done:${step.id}`,
      userId: input.actorId,
    });
    return {
      taskStepId: step.id,
      completed: outcome.completed,
      remaining: outcome.remaining,
      currentStepOrder: outcome.currentStepOrder,
    };
  }
}

/** The typed list's own row (the API's typed contract — the W-48
 * inbox's tasks lane renders this shape). */
export interface WorkflowTaskView {
  readonly taskStepId: string;
  readonly instanceId: string;
  readonly triggerEntity: string;
  readonly documentId: string;
  readonly stepOrder: number;
  readonly stepName: string;
  readonly stepNameAr: string;
  readonly dueAt: string | null;
  readonly assignedAt: string;
  readonly documentNo: string | null;
  readonly amountBase: string;
  readonly currency: string;
}

/** The completion's outcome (the engine's own verdict shape + the
 * task's own members). */
export interface TaskCompletionOutcome {
  readonly taskStepId: string;
  readonly completed: boolean;
  readonly remaining: number;
  readonly currentStepOrder: number | null;
}

/** The tasks plane's own entitlement probe (the graceful direction —
 * the flag-off tenant's lane is empty; the 0130 §5 composable unit). */
async function tenantHasTasksPlane(): Promise<boolean> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the tasks lane requires an ambient tenant scope");
  }
  const rows = await context.tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'workflow.tasks'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

/** The doc detail path (the engine's own routing law — the local copy). */
function docDetailPath(triggerEntity: string, documentId: string): string {
  switch (triggerEntity) {
    case "manual_journal":
      return `/accounting/journals?doc=${documentId}`;
    case "purchase_order":
      return `/purchasing/orders?doc=${documentId}`;
    case "change_order":
      return `/projects/contracting?doc=${documentId}`;
    case "duty_drawback_claim":
      return `/trade/drawbacks?doc=${documentId}`;
    default:
      return `/`;
  }
}
