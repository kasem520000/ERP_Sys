import { requireTenantContext } from "../../../infra/db/tenant-context";
import {
  readDocumentFacts,
  submitTransitionStatusFor,
  WorkflowEngine,
  type WorkflowTriggerEntity,
} from "../application/workflow-engine";
import * as store from "./workflow.store";

/**
 * PHASE-052 (W-44 — T-03, dated 2026-11-27) THE WORKFLOW GATEWAY (D-05
 * — the documented contract the four exemplar surfaces consume; the
 * trade-order-gate pattern VERBATIM: a plain-function module boundary
 * on the ambient tenant scope, zero DI ceremony, zero module coupling
 * — accounting/purchasing/crm/trade import THESE functions, never the
 * WorkflowModule; the engine instance is bound once at boot by the
 * WorkflowModule and directly by the DB specs).
 *
 * THE CONTRACT (the four functions the bound surfaces call):
 *
 *   onDocumentSubmitted — after the module's OWN submit transition
 *     (the vocabulary mapping law: PENDING_APPROVAL for journals/POs,
 *     SUBMITTED for the change orders and the drawback claims): opens
 *     the chain when an active definition's entry conditions hold.
 *     Returns { chainOpened } — the module's own transition stands
 *     either way.
 *
 *   recordApprovalThroughChain — at the module's approve act: with a
 *     live chain, the approval routes INTO the current step (the
 *     actor must be the step's assignee); the returned verdict tells
 *     the module whether its own APPROVED transition is due (the
 *     chain COMPLETED on this act) or the document stays in its
 *     awaiting status (WORKFLOW_CHAIN_STEPS_REMAIN — the typed
 *     refusal the module rethrows for the API surface).
 *
 *   recordRejectionThroughChain — at the module's reject act: the
 *     rejection lands on the current step, the chain COMPLETES (a
 *     rejection is a terminal verdict), the module's own rejection
 *     proceeds.
 *
 *   onDocumentCancelled — at the module's cancellation-class act: the
 *     ACTIVE chain cancels (the engine mirrors the module's verdict,
 *     never invents one).
 *
 * LEDGER-FREE (red line §6.3): the gateway gates the existing
 * verdicts; it posts nothing, stamps nothing.
 */

/** The engine binding (the WorkflowModule's onModuleInit + the specs'
 * direct construction; unbound means NO engine — every gateway
 * function degrades to the legacy path, the compatibility mode's own
 * floor). */
let ENGINE: WorkflowEngine | null = null;

export function bindWorkflowEngine(engine: WorkflowEngine): void {
  ENGINE = engine;
}

/** The spec-isolation surface: unbind (every gateway function degrades
 * to the legacy path — the DB suite's single-process discipline keeps
 * the binding scoped to the specs that need it). */
export function unbindWorkflowEngine(): void {
  ENGINE = null;
}

/** The bound engine (the specs' access surface). */
export function boundWorkflowEngine(): WorkflowEngine | null {
  return ENGINE;
}

/** THE SUBMIT HOOK — after the module's own submit transition. Opens
 * the chain when an active definition matches; silent (the legacy
 * path byte-identical) when none does, the flag is off, or the engine
 * is unbound. NEVER throws for the no-chain paths — the module's own
 * transition has already landed. */
export async function onDocumentSubmitted(input: {
  triggerEntity: WorkflowTriggerEntity;
  documentId: string;
  actorId: string | null;
}): Promise<{ chainOpened: boolean; instanceId?: string }> {
  if (ENGINE === null) {
    return { chainOpened: false };
  }
  // FAIL-CLOSED: the openChain contract itself returns { chainOpened:
  // false } for the flag-off and no-definition paths; every OTHER
  // failure (an unresolvable assignee, a malformed condition) is a
  // typed refusal the module surfaces — the chain that cannot open
  // NEVER silently ungates the document.
  return await ENGINE.openChain(input);
}

/** The chain-verdict shape the approve/reject acts consume. */
export interface ChainVerdict {
  /** No live chain (or the engine is off): the module's own act
   * proceeds on the legacy path, byte-identical. */
  readonly chainOpened: boolean;
  /** The chain reached its terminal verdict ON THIS ACT — the
   * module's own transition is due. */
  readonly completed: boolean;
  /** THE MID-CHAIN SHAPE (chainOpened && !completed): the approval
   * LANDED on the chain's current step (committed with this act's own
   * envelope) and the document's own verdict is NOT yet due — the
   * module SKIPS its own transition and returns the current row (the
   * approval's proof is the chain's own step stamp + audit + timeline,
   * never a silent no-op: the act's atomicity keeps the step approval
   * and the document awaiting together, a thrown refusal here would
   * roll the step approval back with it). */
  readonly remaining?: number;
  readonly nextStepOrder?: number;
  /** THE COMPLETION'S OWN STEP ACCOUNTING (W-46 — the bridge's
   * approval_step parity figure): the chain's APPROVED step count at
   * the terminal verdict (the actionable steps that were acted; the
   * SKIPPED branch stamps never count). The bound module's own
   * transition may carry it where its legacy plane kept an approval
   * counter (the journal's approval_step — the parity figure). */
  readonly completedSteps?: number;
}

/** THE APPROVE HOOK — at the module's approve act. With a live chain:
 * the actor must be the current step's assignee; their approval lands
 * on the step instance (INSIDE this act's own envelope — the step
 * stamp and the awaiting document commit together). The verdict tells
 * the module which path runs next: `completed: true` → the module's
 * own APPROVED transition proceeds; `chainOpened && !completed` → the
 * module SKIPS its transition and returns the current row (the
 * mid-chain shape — see ChainVerdict). With NO live chain: the legacy
 * path. */
export async function recordApprovalThroughChain(input: {
  triggerEntity: WorkflowTriggerEntity;
  documentId: string;
  actorId: string | null;
  comment?: string | null;
}): Promise<ChainVerdict> {
  if (ENGINE === null || input.actorId === null) {
    return { chainOpened: false, completed: false };
  }
  const instance = await store.findActiveInstanceForDocument(
    input.triggerEntity,
    input.documentId,
  );
  if (instance === undefined) {
    return { chainOpened: false, completed: false };
  }
  const facts = await readDocumentFacts(input.triggerEntity, input.documentId);
  const outcome = await ENGINE.actOnCurrentStep({
    instance,
    actorId: input.actorId,
    verdict: "APPROVE",
    comment: input.comment ?? null,
    facts,
  });
  if (!outcome.completed) {
    return {
      chainOpened: true,
      completed: false,
      remaining: outcome.remaining,
      nextStepOrder: outcome.currentStepOrder ?? 0,
    };
  }
  return { chainOpened: true, completed: true, completedSteps: outcome.completedSteps };
}

/** THE REJECT HOOK — at the module's reject act. With a live chain:
 * the rejection lands on the current step (the actor must be its
 * assignee), the chain COMPLETES (a rejection is a terminal verdict),
 * the module's own rejection proceeds. With NO live chain: the legacy
 * path. */
export async function recordRejectionThroughChain(input: {
  triggerEntity: WorkflowTriggerEntity;
  documentId: string;
  actorId: string | null;
  comment?: string | null;
}): Promise<ChainVerdict> {
  if (ENGINE === null || input.actorId === null) {
    return { chainOpened: false, completed: false };
  }
  const instance = await store.findActiveInstanceForDocument(
    input.triggerEntity,
    input.documentId,
  );
  if (instance === undefined) {
    return { chainOpened: false, completed: false };
  }
  const facts = await readDocumentFacts(input.triggerEntity, input.documentId);
  await ENGINE.actOnCurrentStep({
    instance,
    actorId: input.actorId,
    verdict: "REJECT",
    comment: input.comment ?? null,
    facts,
  });
  return { chainOpened: true, completed: true };
}

/** THE CANCELLATION MIRROR — at the module's cancellation-class act
 * (the journal cancel, the document cancellations): the ACTIVE chain
 * cancels. Never blocks the module's own act (the mirror, never a
 * gate). */
export async function onDocumentCancelled(input: {
  triggerEntity: WorkflowTriggerEntity;
  documentId: string;
  actorId: string | null;
  reason: string;
}): Promise<void> {
  if (ENGINE === null) {
    return;
  }
  await ENGINE.cancelChain(input);
}

/** The vocabulary mapping surface (the bound modules' own reads — the
 * submit-transition status per doc type, D-05's law). */
export { submitTransitionStatusFor };

/** The trigger-entity type surface (the modules' own input typing). */
export type { WorkflowTriggerEntity };

/** The tenant scope guard (the gateway's own floor — every function
 * above runs inside the caller's withTenant envelope). */
export function assertGatewayTenantScope(): string {
  return requireTenantContext().tenantId;
}
