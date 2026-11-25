/**
 * PHASE-051 (W-38 — T-12, 2026-11-25) THE DRAWBACK WORKFLOW FOLD (L-12,
 * D-12 — the plan's own unit-first law, the pure layer FIRST with the
 * property tests beside it, then the service that renders its verdicts
 * VERBATIM — zero parallel computation):
 *
 *   THE LADDER (the 0121 §5 stamp law's own fold): DRAFT → SUBMITTED →
 *   UNDER_REVIEW → APPROVED | REJECTED; APPROVED → PAID. REJECTED and
 *   PAID are TERMINAL: no move leaves them (the register is the audit
 *   trail — S/I/U, NO DELETE). The evidence links ride the DRAFT rung
 *   ONLY (the `link` act) — once submitted, the claim's proof of export
 *   is the customs authority's own record.
 *
 *   THE EVIDENCE GATE (BR-108 — D-12's own wording): the claim's
 *   submission REQUIRES the linked export evidence — the export
 *   declaration OR the export bill of lading; a claim past DRAFT
 *   without either is refused (the typed DRAWBACK_EVIDENCE_REQUIRED
 *   naming the claim + the missing evidence — the 0121 §5
 *   ck_duty_drawback_claims_evidence floor's caller-side face).
 *
 *   THE NO-GL SHAPE (D-12 — the honest boundary, the 050 note-20
 *   non-ledger-document law): the claim itself carries NO GL entry by
 *   design — the workflow records the claimed amounts and the status
 *   ladder ONLY; the refund money lands when treasury records it (053's
 *   surface). The `pay` act is a registry stamp, NEVER a posting.
 *
 *   THE STAMP LAWS (the 0121 XOR floors' own reading): submitted_at
 *   exists only past SUBMITTED (monotone evidence that never
 *   un-stamps); decided_at only on the decided rungs
 *   (APPROVED/REJECTED/PAID). The DRAFT-only exit: a submitted claim is
 *   inside the customs channel — its exits are the authority's own
 *   verdicts (approve/reject), never a cancellation.
 *
 *   PURE: no clock, no store, no SQL — the service renders this
 *   module's verdicts VERBATIM.
 */

/** The 0121 §5 status vocabulary (ck_duty_drawback_claims_status' list). */
export const DRAWBACK_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "PAID",
] as const;
export type DrawbackStatus = (typeof DRAWBACK_STATUSES)[number];

/** The lifecycle acts the service exposes (the fold's move vocabulary). */
export const DRAWBACK_MOVES = ["link", "submit", "review", "approve", "reject", "pay"] as const;
export type DrawbackMove = (typeof DRAWBACK_MOVES)[number];

/** The verdict shape every act renders (the lc-lifecycle precedent). */
export interface DrawbackMoveVerdict {
  readonly allowed: boolean;
  readonly to: DrawbackStatus | null;
  readonly reason: string | null;
}

/**
 * THE MOVE MATRIX — the total fold (every status × move carries a
 * verdict; the property test walks the full product). `link` rides the
 * DRAFT rung only; `submit` DRAFT (BR-108's gate fires at the service,
 * the fold carries the ladder's own face); `review` SUBMITTED;
 * `approve`/`reject` UNDER_REVIEW; `pay` APPROVED. REJECTED and PAID
 * are terminal.
 */
export function nextDrawbackMove(
  status: DrawbackStatus,
  move: DrawbackMove,
): DrawbackMoveVerdict {
  if (move === "link") {
    if (status === "DRAFT") {
      return { allowed: true, to: "DRAFT", reason: null };
    }
    return {
      allowed: false,
      to: null,
      reason: `the claim is ${status} — the evidence links ride the DRAFT rung only (once submitted, the proof of export is the customs authority's own record)`,
    };
  }
  if (move === "submit") {
    if (status === "DRAFT") {
      return { allowed: true, to: "SUBMITTED", reason: null };
    }
    return {
      allowed: false,
      to: null,
      reason: `the claim is ${status} — only a DRAFT claim submits to the customs authority (the submitted_at stamp is monotone evidence that never un-stamps)`,
    };
  }
  if (move === "review") {
    if (status === "SUBMITTED") {
      return { allowed: true, to: "UNDER_REVIEW", reason: null };
    }
    return {
      allowed: false,
      to: null,
      reason: `the claim is ${status} — only a SUBMITTED claim enters the review (the customs officer's queue)`,
    };
  }
  if (move === "approve") {
    if (status === "UNDER_REVIEW") {
      return { allowed: true, to: "APPROVED", reason: null };
    }
    return {
      allowed: false,
      to: null,
      reason: `the claim is ${status} — only the review's verdict approves (UNDER_REVIEW is the rung)`,
    };
  }
  if (move === "reject") {
    if (status === "UNDER_REVIEW") {
      return { allowed: true, to: "REJECTED", reason: null };
    }
    return {
      allowed: false,
      to: null,
      reason: `the claim is ${status} — only the review's verdict rejects (UNDER_REVIEW is the rung)`,
    };
  }
  if (move === "pay") {
    if (status === "APPROVED") {
      return { allowed: true, to: "PAID", reason: null };
    }
    return {
      allowed: false,
      to: null,
      reason: `the claim is ${status} — only an APPROVED claim pays (the refund's own rung; the money itself lands through the treasury's discipline, 053's surface)`,
    };
  }
  return { allowed: false, to: null, reason: `unknown move "${move}"` };
}

/**
 * BR-108'S EVIDENCE GATE (D-12's own wording): the claim's submission
 * requires the linked export evidence — the export declaration OR the
 * export bill of lading. The verdict: satisfied only when at least one
 * link is present; the typed refusal's reason names the claim's own
 * missing evidence (the service re-throws it typed).
 */
export function drawbackEvidenceSatisfied(input: {
  exportDeclarationId: string | null;
  exportBillOfLadingId: string | null;
}): { satisfied: boolean; reason: string | null } {
  if (input.exportDeclarationId !== null || input.exportBillOfLadingId !== null) {
    return { satisfied: true, reason: null };
  }
  return {
    satisfied: false,
    reason:
      "the claim carries no proof of export — link the export declaration or the export bill of lading first (BR-108's export-evidence gate: the claim's own evidence of export)",
  };
}

/** The export-evidence shape verdict (the claim's register's own
 * law): the export declaration's evidence link must reference an
 * EXPORT-type declaration (an IMPORT or TRANSIT declaration is not
 * proof of export — the typed refusal). PURE over the declared type. */
export function isExportDeclarationType(declarationType: string): boolean {
  return declarationType === "EXPORT";
}
