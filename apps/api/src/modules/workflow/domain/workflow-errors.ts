import { DomainError } from "@erp/domain-core";

/**
 * PHASE-052 (W-43 — T-01's unit-first half, 2026-11-27) THE WORKFLOW
 * TYPED-REFUSAL TAXONOMY (the trade-errors precedent: stable
 * UPPER_SNAKE codes are the API contract, the message is display-only,
 * the details payload is machine-readable). The reservation law rides
 * every class: the codes name G-67's floor and INV-037's floor exactly
 * as the ID_LEDGER's reserved wordings; NO identifier outside the 052
 * reservations (G-67 · INV-037 — NO BR this phase) is invented anywhere.
 *
 * The HTTP face lands with the W-44…W-47 service waves (the PHASE-045
 * T-03 lesson: the not-found classes register as 404 and the lifecycle
 * conflicts as 409 in error.filter.ts's domainStatus chain in the SAME
 * increment that ships the routes — never the 422 fall-through drift).
 * The pure folds themselves throw ONLY the classes below — the store
 * and the controllers wrap, never widen.
 */

/** The service-level input floor (the TradeInputInvalidError
 * precedent — the controller's zod parse errors surface as
 * VALIDATION_ERROR; this class guards the invariants the zod shape
 * cannot express). */
export class WorkflowInputInvalidError extends DomainError {
  constructor(details: { field: string; reason: string }) {
    super("WORKFLOW_INPUT_INVALID", `workflow input invalid at ${details.field}: ${details.reason}`, details);
  }
}

// ── the condition evaluator (D-06 — every malformed condition a typed
//    refusal naming the condition BY PATH, never a silent pass) ──────

/** A malformed condition group or operand — the refusal names the
 * condition's JSON PATH exactly (the fail-closed law: a tenant who
 * saves garbage conditions never gets a silent pass-through chain). */
export class WorkflowConditionInvalidError extends DomainError {
  constructor(details: { path: string; reason: string }) {
    super(
      "WORKFLOW_CONDITION_INVALID",
      `workflow condition invalid at ${details.path}: ${details.reason}`,
      details,
    );
  }
}

// ── the ladder + the CAS (D-13/D-09 — the step state machine) ────────

/** The single-use CAS refusal (D-09's replay law): a replayed deep
 * link — or any second act — meets a non-PENDING step and takes THIS
 * typed refusal. The one-time property is the step instance's OWN
 * acted_at stamp, never a token table. */
export class WorkflowStepAlreadyActedError extends DomainError {
  constructor(details: { stepInstanceId: string; status: string }) {
    super(
      "WORKFLOW_STEP_ALREADY_ACTED",
      `workflow step ${details.stepInstanceId} is ${details.status} — the act is single-use (the acted_at stamp is the ledger)`,
      details,
    );
  }
}

/** The ladder's illegal move (the ncr-lifecycle verdict shape: the
 * typed refusal names the record, the illegal move, and the reason). */
export class WorkflowStepStateError extends DomainError {
  constructor(details: { stepInstanceId: string; from: string; to: string; reason: string }) {
    super(
      "WORKFLOW_STEP_STATE",
      `workflow step ${details.stepInstanceId} cannot move ${details.from} → ${details.to}: ${details.reason}`,
      details,
    );
  }
}

// ── INV-037 (the terminal immutability floor — the reserved wording) ──

/** INV-037's own refusal: a terminal workflow instance
 * (COMPLETED/CANCELLED) refuses EVERY mutation — the frozen history the
 * timeline renders VERBATIM (PP-17's own audit checkbox). The service
 * layer's floor; the store guard and the RED/GREEN invariant pair are
 * the proof pack's (W-50). */
export class WorkflowInstanceImmutableError extends DomainError {
  constructor(details: { instanceId: string; status: string; completedAt: string }) {
    super(
      "WORKFLOW_INSTANCE_IMMUTABLE",
      `workflow instance ${details.instanceId} is ${details.status} (completed ${details.completedAt}) — terminal instances are immutable (INV-037)`,
      details,
    );
  }
}

// ── the delegation law + G-67 (D-07 — the reserved wording) ──────────

/** The circularity refusal (D-07): a window that would create a cycle
 * is rejected AT SAVE — the typed refusal names the chain the candidate
 * would close. The trivial cycle (from === to) is the DB floor's own
 * (ck_delegations_no_self); the transitive closure is this fold's. */
export class WorkflowDelegationCircularError extends DomainError {
  constructor(details: { chain: readonly string[] }) {
    super(
      "WORKFLOW_DELEGATION_CIRCULAR",
      `the delegation window would close a circular chain: ${details.chain.join(" → ")}`,
      details,
    );
  }
}

/** G-67's own refusal (the golden): an actor cannot approve their own
 * document through a delegation chain — directly or transitively. The
 * EFFECTIVE actor (the resolution chain's terminal) is checked against
 * the document's creator; the block names the chain and BOTH endpoints.
 * The BR-034 SoD default-OFF discipline stands: `allowSelfApproval`
 * never flips without an explicit tenant decision record. */
export class WorkflowSelfApprovalBlockedError extends DomainError {
  constructor(details: {
    documentCreatorId: string;
    actorId: string;
    chain: readonly string[];
  }) {
    super(
      "WORKFLOW_SELF_APPROVAL_BLOCKED",
      `the actor ${details.actorId} cannot approve their own document through the delegation chain ${details.chain.join(" → ")} — the chain's terminal (the effective actor) is the document's creator ${details.documentCreatorId} (G-67)`,
      details,
    );
  }
}

/** BR-055's family law: the engine never invents an assignee — an
 * unresolvable assignee rule is a typed refusal (fail-closed, never a
 * fallback to the creator). */
export class WorkflowAssigneeUnresolvableError extends DomainError {
  constructor(details: { rule: string; value: string; reason: string }) {
    super(
      "WORKFLOW_ASSIGNEE_UNRESOLVABLE",
      `the assignee rule ${details.rule} (${details.value}) does not resolve: ${details.reason} — the engine never invents an assignee`,
      details,
    );
  }
}

// ── the deep-link law (D-09 — the typed refusals) ─────────────────────

/** The token's expiry: the claim's OWN deadline (never a stored TTL —
 * the stateless law). */
export class WorkflowTokenExpiredError extends DomainError {
  constructor(details: { deadline: string; now: string }) {
    super("WORKFLOW_TOKEN_EXPIRED", `the workflow action link expired at ${details.deadline}`, details);
  }
}

/** The wrong actor: the link is bound to user + instance + action —
 * never the raw session, never a bearer-free act. */
export class WorkflowTokenActorMismatchError extends DomainError {
  constructor(details: { expectedUserId: string; actualUserId: string }) {
    super(
      "WORKFLOW_TOKEN_ACTOR_MISMATCH",
      `the workflow action link is bound to user ${details.expectedUserId}, not ${details.actualUserId}`,
      details,
    );
  }
}

// ── the lookup floor (W-47 — the routes' own 404 class; the PHASE-045
//    T-03 lesson: the not-found classes register in error.filter.ts's
//    domainStatus chain in the SAME increment that ships the routes) ──

/** The step instance the act/task surface targets does not exist (or
 * belongs to another tenant — the A7 parity: identical shape for
 * unknown-vs-foreign ids, no existence disclosure). */
export class WorkflowStepInstanceNotFoundError extends DomainError {
  constructor(details: { stepInstanceId: string }) {
    super(
      "WORKFLOW_STEP_INSTANCE_NOT_FOUND",
      `workflow step instance ${details.stepInstanceId} not found`,
      details,
    );
  }
}
