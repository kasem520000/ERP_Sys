import {
  WorkflowInstanceImmutableError,
  WorkflowStepAlreadyActedError,
  WorkflowStepStateError,
} from "./workflow-errors";

/**
 * PHASE-052 (W-43 — the unit-first law, 2026-11-27) THE INSTANCE/STEP
 * STATE MACHINE (D-13 — a PURE fold: no clock, no store; every instant
 * arrives as a fixed input, every stamp is derived data). The ladder's
 * own law (the 0128 declared interpretation's exact matrix —
 * ck_workflow_step_instances_act_shape is its structural face):
 *
 *   PENDING     — no act, no delegation (the assignee's own awaiting)
 *   DELEGATED   — the re-route recorded (delegated_to set), the act
 *                 NOT yet landed (the delegate's awaiting)
 *   APPROVED    — the act pair acted_at + acted_by (delegated_to stays
 *                 as the act's PROVENANCE when it came through a window)
 *   REJECTED    — the act pair (the same law)
 *   SKIPPED     — the skip stamp acted_at with NO actor (the branch's
 *                 own verdict, never a user act)
 *
 * THE TASK COMPLETION WRITE-BACK IS THE STEP'S OWN ACT PAIR (D-11 —
 * the TASK steps ARE workflow_step_instances, no seventh table).
 *
 * INV-037 (the terminal immutability floor — the reserved wording): a
 * terminal instance (COMPLETED/CANCELLED) refuses EVERY mutation — the
 * typed WORKFLOW_INSTANCE_IMMUTABLE refusal; the timeline renders the
 * terminal record VERBATIM (the frozen history, PP-17).
 *
 * THE CAS (D-09's replay law): the act is SINGLE-USE — the replayed
 * deep link (or any second act) meets a non-PENDING step and takes the
 * typed WORKFLOW_STEP_ALREADY_ACTED refusal. The acted_at stamp IS the
 * ledger (no token table).
 *
 * The engine (W-44) renders this fold; the store guard + the RED/GREEN
 * invariant pair are the proof pack's (W-50).
 */

export type WorkflowInstanceStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

export type WorkflowStepStatus = "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED" | "DELEGATED";

export type WorkflowStepVerdict = "APPROVE" | "REJECT";

/** The step instance's folded shape (the 0128 columns the fold moves). */
export interface StepInstanceShape {
  readonly stepInstanceId: string;
  readonly stepOrder: number;
  readonly stepType: "APPROVAL" | "NOTIFICATION" | "TASK";
  readonly assigneeUserId: string;
  readonly status: WorkflowStepStatus;
  readonly delegatedTo: string | null;
  readonly actedAt: string | null;
  readonly actedBy: string | null;
  readonly comment: string | null;
}

/** The instance's folded shape (the 0128 columns the fold moves). */
export interface InstanceShape {
  readonly instanceId: string;
  readonly status: WorkflowInstanceStatus;
  readonly currentStepOrder: number | null;
  readonly completedAt: string | null;
}

/** INV-037's own guard: the mutation floor every fold passes through.
 * An ACTIVE instance passes; a terminal instance takes the typed
 * refusal naming the instance, its terminal state, and its stamp. */
export function assertInstanceMutable(instance: InstanceShape): void {
  if (instance.status !== "ACTIVE") {
    throw new WorkflowInstanceImmutableError({
      instanceId: instance.instanceId,
      status: instance.status,
      completedAt: instance.completedAt ?? "",
    });
  }
}

/** THE ACT FOLD (the CAS single-use): approve/reject a PENDING or
 * DELEGATED step — the act pair lands TOGETHER (acted_at + acted_by),
 * the comment captured with the act, and delegated_to RETAINED as the
 * act's provenance when it came through a window. Any other status
 * takes the typed ALREADY_ACTED refusal (the replay law — the one-time
 * property is this stamp, never a token table). The TASK completion
 * write-back is this same fold (D-11). */
export function actOnStep(
  step: StepInstanceShape,
  input: {
    readonly actorId: string;
    readonly at: string;
    readonly verdict: WorkflowStepVerdict;
    readonly comment?: string;
  },
): StepInstanceShape {
  if (step.status !== "PENDING" && step.status !== "DELEGATED") {
    throw new WorkflowStepAlreadyActedError({
      stepInstanceId: step.stepInstanceId,
      status: step.status,
    });
  }
  if (input.actorId.length === 0) {
    throw new WorkflowStepStateError({
      stepInstanceId: step.stepInstanceId,
      from: step.status,
      to: input.verdict === "APPROVE" ? "APPROVED" : "REJECTED",
      reason: "the act needs its actor",
    });
  }
  return {
    ...step,
    status: input.verdict === "APPROVE" ? "APPROVED" : "REJECTED",
    actedAt: input.at,
    actedBy: input.actorId,
    comment: input.comment ?? step.comment,
    // delegated_to STAYS as the provenance when the act came through a
    // window (the 0128 stamp law: APPROVED/REJECTED carry the act pair;
    // the delegation column keeps the route's own history).
    delegatedTo: step.delegatedTo,
  };
}

/** THE DELEGATION FOLD (D-07's re-route): a PENDING step records the
 * active window's delegate — the re-route recorded, the act NOT yet
 * landed (the DELEGATED rung's own declared shape: delegated_to set,
 * no act pair). Only from PENDING (a DELEGATED step re-routes through
 * the delegate's own windows at act time — the effective-actor walk's
 * own law, never a re-stamp here). */
export function delegateStep(
  step: StepInstanceShape,
  input: { readonly delegateUserId: string },
): StepInstanceShape {
  if (step.status !== "PENDING") {
    throw new WorkflowStepStateError({
      stepInstanceId: step.stepInstanceId,
      from: step.status,
      to: "DELEGATED",
      reason: "only a PENDING step records the absence re-route (a DELEGATED step re-routes at act time)",
    });
  }
  if (input.delegateUserId === step.assigneeUserId) {
    throw new WorkflowStepStateError({
      stepInstanceId: step.stepInstanceId,
      from: step.status,
      to: "DELEGATED",
      reason: "the delegate is the assignee (the no-self floor — ck_delegations_no_self's own law)",
    });
  }
  return { ...step, status: "DELEGATED", delegatedTo: input.delegateUserId };
}

/** THE SKIP FOLD (the branch's own verdict): the excluded step carries
 * the skip stamp with NO actor — acted_at set, acted_by NULL (never a
 * user act; the branch evaluation's own output, D-06). Only a step not
 * yet acted can be skipped. */
export function skipStep(
  step: StepInstanceShape,
  input: { readonly at: string },
): StepInstanceShape {
  if (step.status !== "PENDING") {
    throw new WorkflowStepStateError({
      stepInstanceId: step.stepInstanceId,
      from: step.status,
      to: "SKIPPED",
      reason: "only a step not yet acted can be skipped (the branch excludes ahead, never behind)",
    });
  }
  return { ...step, status: "SKIPPED", actedAt: input.at, actedBy: null };
}

/** THE POINTER FOLD: the next current-step order after `fromOrder`
 * over the snapshot's ordered steps — null when past the last (the
 * terminal signal the instance fold completes on). The branch
 * evaluation (which steps skip) is the evaluator's own; this fold
 * walks the snapshot's own order, skipping the SKIPPED rungs. */
export function advancePointer(
  steps: readonly StepInstanceShape[],
  fromOrder: number,
): number | null {
  const next = steps
    .filter((step) => step.stepOrder > fromOrder && step.status !== "SKIPPED")
    .sort((a, b) => a.stepOrder - b.stepOrder)[0];
  return next?.stepOrder ?? null;
}

/** THE COMPLETION FOLD: an ACTIVE instance completes — the pointer
 * NULLs, the completed_at stamp lands (INV-037's terminal floor: the
 * terminal state and its stamp TOGETHER, the 0128 CHECK's own law). A
 * terminal instance takes the typed immutable refusal. */
export function completeInstance(
  instance: InstanceShape,
  input: { readonly at: string },
): InstanceShape {
  assertInstanceMutable(instance);
  return {
    ...instance,
    status: "COMPLETED",
    currentStepOrder: null,
    completedAt: input.at,
  };
}

/** THE CANCELLATION FOLD: an ACTIVE instance cancels (the document's
 * own cancellation — the engine mirrors the module's verdict, never
 * invents one). The same terminal law. */
export function cancelInstance(
  instance: InstanceShape,
  input: { readonly at: string },
): InstanceShape {
  assertInstanceMutable(instance);
  return {
    ...instance,
    status: "CANCELLED",
    currentStepOrder: null,
    completedAt: input.at,
  };
}
