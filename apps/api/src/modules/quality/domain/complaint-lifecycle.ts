/**
 * PHASE-050 (W-28 — T-12, 2026-11-23) THE COMPLAINT LIFECYCLE FOLD — the
 * PURE layer first (the unit-first law; the ncr-lifecycle precedent's
 * shape). The fold encodes the 0114 complaints floor exactly
 * (ck_complaints_status · ck_complaints_resolved_shape) — never a
 * parallel machine: the DB CHECKs remain the authority; this fold is the
 * service's own decision surface so the typed refusals carry their
 * reasons BEFORE the DB floor ever fires. The NCR link window (the
 * plan's own wording: "triage, NCR link") is the fold's own law: the
 * link lands at TRIAGED or IN_PROGRESS only — a NEW complaint is not yet
 * triaged, a resolved one is evidence.
 */

export type ComplaintStatus = "NEW" | "TRIAGED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export const COMPLAINT_STATUSES: readonly ComplaintStatus[] = [
  "NEW",
  "TRIAGED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
];

/** The intake channel vocabulary (0114's ck_complaints_channel). */
export const COMPLAINT_CHANNELS = [
  "PHONE",
  "EMAIL",
  "WALK_IN",
  "PORTAL",
  "SOCIAL",
  "OTHER",
] as const;
export type ComplaintChannel = (typeof COMPLAINT_CHANNELS)[number];

/** The severity vocabulary (0114's ck_complaints_severity — the NCR
 * sibling). */
export const COMPLAINT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type ComplaintSeverity = (typeof COMPLAINT_SEVERITIES)[number];

/** The lifecycle moves the service exposes (one guarded CAS each — the
 * 0105 stamp-law shape the 0114 floor stamps). */
export type ComplaintMove = "triage" | "progress" | "resolve" | "close";

/** The refusal shapes (each maps to exactly one typed error's reason —
 * never a raw string). The ladder's own refusals name the rung the
 * record stands on, never a generic conflict. */
export type ComplaintMoveRefusal =
  /** A non-triage move on a NEW record. */
  | "NOT_NEW"
  /** A non-progress move on a TRIAGED record. */
  | "NOT_TRIAGED"
  /** A non-resolve move on an IN_PROGRESS record. */
  | "NOT_IN_PROGRESS"
  /** A non-close move on a RESOLVED record. */
  | "NOT_RESOLVED"
  /** Any move on a CLOSED record. */
  | "ALREADY_CLOSED";

export interface ComplaintMoveVerdict {
  allowed: boolean;
  refusal?: ComplaintMoveRefusal;
  reason?: string;
}

/**
 * The lifecycle verdict for a move from a state. The ladder:
 * NEW →(triage)→ TRIAGED →(progress)→ IN_PROGRESS →(resolve)→ RESOLVED
 * →(close)→ CLOSED. Every other cell is refused with its named reason —
 * the fold is total (the property test walks the full matrix).
 */
export function nextComplaintMove(
  status: ComplaintStatus,
  move: ComplaintMove,
): ComplaintMoveVerdict {
  if (status === "CLOSED") {
    return {
      allowed: false,
      refusal: "ALREADY_CLOSED",
      reason: "the complaint is CLOSED — the register is evidence, no move reopens it",
    };
  }
  if (status === "RESOLVED") {
    if (move === "close") return { allowed: true };
    return {
      allowed: false,
      refusal: "NOT_RESOLVED",
      reason: "the complaint is RESOLVED — only the close move remains",
    };
  }
  if (status === "IN_PROGRESS") {
    if (move === "resolve") return { allowed: true };
    return {
      allowed: false,
      refusal: "NOT_IN_PROGRESS",
      reason: "the complaint is IN_PROGRESS — the resolve move is next on this rung",
    };
  }
  if (status === "TRIAGED") {
    if (move === "progress") return { allowed: true };
    return {
      allowed: false,
      refusal: "NOT_TRIAGED",
      reason: "the complaint is TRIAGED — the progress move is next on this rung",
    };
  }
  // status === "NEW"
  if (move === "triage") return { allowed: true };
  return {
    allowed: false,
    refusal: "NOT_NEW",
    reason: "the complaint is NEW — it must be triaged before any later move",
  };
}

/**
 * The NCR-link window fold: the link lands at TRIAGED or IN_PROGRESS
 * only. A NEW complaint is not yet triaged (the triage act itself may
 * carry the link); a RESOLVED/CLOSED one is evidence. The link is
 * single-set (a re-link on the same window is the triage's own
 * correction — allowed while the window stands, refused after).
 */
export function complaintNcrLinkWindow(
  status: ComplaintStatus,
): { open: boolean; reason?: string } {
  if (status === "TRIAGED" || status === "IN_PROGRESS") return { open: true };
  if (status === "NEW") {
    return { open: false, reason: "the complaint is NEW — triage it before linking an NCR" };
  }
  return {
    open: false,
    reason: "the complaint is past its working window — the NCR link is evidence now",
  };
}

/**
 * The resolution-pair fold (ck_complaints_resolved_shape at the service
 * floor): the RESOLVED/CLOSED statuses carry exactly the resolution
 * pair (resolution text + resolved_at), never one without the other.
 */
export function complaintResolutionShapeValid(input: {
  status: ComplaintStatus;
  hasResolution: boolean;
  hasResolvedAt: boolean;
}): boolean {
  const resolved = input.status === "RESOLVED" || input.status === "CLOSED";
  if (resolved) return input.hasResolution && input.hasResolvedAt;
  return !input.hasResolution && !input.hasResolvedAt;
}
