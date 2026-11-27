import {
  WorkflowDelegationCircularError,
  WorkflowSelfApprovalBlockedError,
} from "./workflow-errors";

/**
 * PHASE-052 (W-43 — the unit-first law, 2026-11-27) THE DELEGATION
 * GRAPH FOLD (D-07 — a PURE fold: the windows arrive as edges, the
 * walk is transitive-closure math; no store, no clock — the act-time
 * resolution passes its OWN filtered edges).
 *
 * THE CIRCULARITY LAW: a window that would create a cycle is rejected
 * AT SAVE — `assertAcyclic(existingEdges, candidate)` walks the
 * transitive closure from the candidate's `to` looking for its own
 * `from`; the typed refusal names the FULL closed chain the candidate
 * would close (C → A → B → C). The trivial cycle (from === to) is the
 * DB floor's own (ck_delegations_no_self); this fold is the
 * transitive law's own.
 *
 * THE RESOLUTION CHAIN (D-07's act-time law): a PENDING step's
 * assignee resolves through the ACTIVE windows at the moment of the
 * act — the assignee's window re-routes to the delegate, the
 * delegate's own window re-routes again; `effectiveActor(edges,
 * assigneeId)` walks that chain to its TERMINAL (the user whose
 * authority the eventual act exercises — the only user who may act
 * while the windows stand; expired windows never enter the edge set,
 * so they stop routing by construction).
 *
 * G-67 (the golden — the reserved wording): an actor cannot approve
 * their OWN document through a delegation chain — directly or
 * transitively: the EFFECTIVE actor (the resolution chain's terminal)
 * is checked against the document's creator; the block names the chain
 * and BOTH endpoints (the effective actor and the creator). The
 * DIRECT case is the chain of length one (the step's assignee is the
 * creator himself, no windows); the TRANSITIVE case is another user's
 * window legitimately naming the creator as the delegate — the chain
 * X → C routes the act back to the creator, making him his own
 * document's approver through the chain. The BR-034 SoD default-OFF
 * discipline stands: `allowSelfApproval` never flips without an
 * explicit tenant decision record.
 *
 * NOTE the honest boundary (the two laws' own division): the
 * save-time circularity law keeps the GRAPH acyclic; G-67 keeps the
 * ACT off the creator — the two overlap on the routed-back cycle (a
 * graph cycle is refused at save, so the routed-back shape G-67
 * catches is the NON-cyclic one: another user's window legitimately
 * naming the creator as the delegate).
 */

/** One absence window's graph edge: from_user → to_user (the scope and
 * the window bounds are the RESOLUTION plane's own — the W-45 fold's;
 * this fold walks the pure user graph). */
export interface DelegationEdge {
  readonly fromUserId: string;
  readonly toUserId: string;
}

/** Assert the candidate window keeps the graph ACYCLIC (the save-time
 * law): walks the transitive closure from the candidate's `to`; a
 * path back to the candidate's `from` is the typed circular refusal
 * naming the FULL closed cycle, candidate's from first AND last
 * (C → A → B → C). The trivial cycle is refused the same way (the DB
 * floor's own class, defended here for the pure caller). */
export function assertAcyclic(
  existingEdges: readonly DelegationEdge[],
  candidate: DelegationEdge,
): void {
  const chain = walkTo(existingEdges, candidate.toUserId, candidate.fromUserId);
  if (chain !== null) {
    throw new WorkflowDelegationCircularError({
      chain: [candidate.fromUserId, ...chain, candidate.fromUserId],
    });
  }
}

/** The transitive-closure walk: from `start`, follow the edges; return
 * the chain (inclusive of `start`, EXCLUSIVE of the reached `target`)
 * when `target` is reachable, null when not. Terminates on revisit
 * (the defensive cycle guard — a saved graph is acyclic by
 * construction; a corrupt one refuses rather than loops). */
function walkTo(
  edges: readonly DelegationEdge[],
  start: string,
  target: string,
): string[] | null {
  const chain: string[] = [start];
  const visited = new Set<string>([start]);
  let frontier = start;
  for (;;) {
    if (frontier === target) {
      return chain.slice(0, -1); // exclusive of the target — the caller closes the cycle
    }
    const next = edges.find((edge) => edge.fromUserId === frontier);
    if (next === undefined) {
      return null;
    }
    if (visited.has(next.toUserId)) {
      // A pre-existing cycle among the standing edges: the graph is
      // corrupt (the save-time law should have refused it) — refuse
      // with the partial chain rather than loop.
      throw new WorkflowDelegationCircularError({ chain: [...chain, next.toUserId] });
    }
    visited.add(next.toUserId);
    chain.push(next.toUserId);
    frontier = next.toUserId;
  }
}

/** The walked resolution chain: the assignee followed by every window
 * hop to the terminal (the effective actor last). */
export interface EffectiveActorResult {
  /** The resolution chain's TERMINAL — the user whose authority the
   * act exercises (the assignee himself when no window applies). */
  readonly effectiveActorId: string;
  /** The full walked chain, assignee first, terminal last. */
  readonly chain: readonly string[];
}

/** THE EFFECTIVE-ACTOR WALK (the resolution chain's own transitive
 * closure): from the step's assignee through the ACTIVE windows to
 * the chain's terminal. One window per user in the edge set (the
 * active window at act time is the RESOLUTION plane's own selection —
 * the W-45 fold passes the already-filtered edges; this fold walks
 * what it is given). */
export function effectiveActor(
  edges: readonly DelegationEdge[],
  assigneeId: string,
): EffectiveActorResult {
  const chain: string[] = [assigneeId];
  const visited = new Set<string>([assigneeId]);
  let current = assigneeId;
  for (;;) {
    const next = edges.find((edge) => edge.fromUserId === current);
    if (next === undefined) {
      return { effectiveActorId: current, chain };
    }
    if (visited.has(next.toUserId)) {
      throw new WorkflowDelegationCircularError({ chain: [...chain, next.toUserId] });
    }
    visited.add(next.toUserId);
    chain.push(next.toUserId);
    current = next.toUserId;
  }
}

/** G-67's own block (the golden): the actor cannot approve their own
 * document — directly or through a delegation chain. The resolution
 * chain's TERMINAL (the effective actor — the user the act exercises)
 * is checked against the document's creator; the block names the chain
 * and BOTH endpoints. The direct case is the chain of length one (the
 * step's assignee is the creator himself); the transitive case is the
 * chain another user's window routes back to the creator. The creator
 * delegating HIS OWN step AWAY is legal (the delegate approves — the
 * terminal is not the creator). `allowSelfApproval` is the BR-034
 * default-OFF escape: the caller passes the tenant's own RECORDED
 * decision (never a fallback; the flip without the decision record is
 * the violation this fold exists to refuse). */
export function assertNotSelfApproval(input: {
  readonly documentCreatorId: string;
  /** The step's own assignee — the resolution chain's head. */
  readonly stepAssigneeId: string;
  /** The ACTIVE windows at the moment of the act (the resolution
   * plane's already-filtered set). */
  readonly edges: readonly DelegationEdge[];
  /** The tenant's recorded decision (BR-034's allow_self_approval —
   * default OFF; pass true ONLY from the recorded row). */
  readonly allowSelfApproval?: boolean;
}): void {
  if (input.allowSelfApproval === true) {
    return; // the explicit tenant decision record — never a default
  }
  const walk = effectiveActor(input.edges, input.stepAssigneeId);
  if (walk.effectiveActorId === input.documentCreatorId) {
    throw new WorkflowSelfApprovalBlockedError({
      documentCreatorId: input.documentCreatorId,
      actorId: walk.effectiveActorId,
      chain: walk.chain,
    });
  }
}
