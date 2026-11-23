/**
 * PHASE-050 (W-28 — T-13, 2026-11-23) THE HOLD-BLOCKING FOLD — the PURE
 * layer first (the unit-first law, the plan §4's own arm: "the
 * hold-blocking fold (the batch/key resolution, the disposition-link
 * release rule)"). INV-035 + BR-101 — D-07: ONE shared blocking
 * validation service is the ONLY gate; this fold is its decision surface
 * so the typed refusals carry their reasons BEFORE any slice is valued
 * or applied. The 0116 floor (uq_batch_quality_holds_tenant_batch_active
 * · ck_batch_quality_holds_release_shape) remains the authority; this
 * fold never re-derives the DB's law — it selects the refusal target
 * deterministically and guards BR-101's release shape at the service
 * floor.
 */

/** The hold statuses (0114's sibling vocabulary — 0116's
 * ck_batch_quality_holds_status). */
export type HoldStatus = "ACTIVE" | "RELEASED";

/** One gate-read hold row (the store's own projection — VERBATIM). */
export interface GateHoldRow {
  id: string;
  batchId: string;
  reason: string;
  heldAt: string;
}

/**
 * THE REFUSAL-TARGET FOLD — deterministic: among the batches the plan
 * resolved, the gate names the held batch with the LOWEST id order
 * (batchId ASC, then hold id ASC as the tiebreak — the partial unique
 * makes ties impossible, the belt-and-suspenders law). The input order
 * of `batchIds` NEVER changes the verdict's target (the property test
 * walks every permutation) — the caller's slice order is not evidence.
 */
export function heldBatchTarget(
  batchIds: readonly string[],
  holds: readonly GateHoldRow[],
): GateHoldRow | null {
  const held = new Map<string, GateHoldRow>();
  for (const hold of holds) {
    const existing = held.get(hold.batchId);
    if (existing === undefined || hold.id < existing.id) {
      held.set(hold.batchId, hold);
    }
  }
  const relevant = holds.filter(
    (hold) => batchIds.includes(hold.batchId) && hold === held.get(hold.batchId),
  );
  if (relevant.length === 0) return null;
  relevant.sort((a, b) =>
    a.batchId === b.batchId ? (a.id < b.id ? -1 : 1) : a.batchId < b.batchId ? -1 : 1,
  );
  return relevant[0]!;
}

/**
 * BR-101's RELEASE FOLD — release requires the disposition-linked
 * record: the hold's own ncr link (the ncr whose disposition justifies
 * the release) + the release note. The DB CHECK
 * (ck_batch_quality_holds_release_shape) enforces the pair on the
 * RELEASED path; this fold refuses at the service floor so the caller
 * gets the typed refusal BEFORE the CAS, naming what is missing.
 */
export type HoldReleaseRefusal = "NOT_ACTIVE" | "DISPOSITION_LINK_REQUIRED";

export function holdReleaseGate(input: {
  status: HoldStatus;
  ncrId: string | null;
  releaseNote: string | null;
}): { allowed: true } | { allowed: false; refusal: HoldReleaseRefusal; reason: string } {
  if (input.status !== "ACTIVE") {
    return {
      allowed: false,
      refusal: "NOT_ACTIVE",
      reason: "the hold is already RELEASED — the register is evidence, no move reopens it",
    };
  }
  if (input.ncrId === null) {
    return {
      allowed: false,
      refusal: "DISPOSITION_LINK_REQUIRED",
      reason:
        "BR-101 — release requires the disposition-linked record (the ncr whose disposition justifies the release)",
    };
  }
  if (input.releaseNote === null || input.releaseNote.trim().length === 0) {
    return {
      allowed: false,
      refusal: "DISPOSITION_LINK_REQUIRED",
      reason: "BR-101 — the release carries its release note (the justification record)",
    };
  }
  return { allowed: true };
}
