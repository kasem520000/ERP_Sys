/**
 * PHASE-050 (W-25 — T-06, 2026-11-23) THE NCR LIFECYCLE FOLD — the PURE
 * layer first where the decision logic exists (the unit-first law, the
 * plan §4's own unit list: "the NCR/CAPA lifecycle folds (the closure
 * gates' refusal shapes)"). The fold encodes BR-102's closure gate and
 * G-62's journal scope exactly as the 0114 floor stamps them — never a
 * parallel machine: the DB CHECKs (ck_ncr_records_disposition_gate ·
 * ck_ncr_records_journal_gated) remain the authority; this fold is the
 * service's own decision surface so the typed refusals carry their
 * reasons BEFORE the DB floor ever fires.
 */

export type NcrStatus = "OPEN" | "DISPOSITIONED" | "CLOSED";

/** The closed disposition vocabulary (0114's ck_ncr_records_disposition). */
export type NcrDisposition = "REWORK" | "SCRAP" | "ACCEPT" | "RETURN_TO_SUPPLIER";

/** The closed source vocabulary (0114's ck_ncr_records_source). */
export type NcrSource = "INSPECTION" | "PRODUCTION" | "COMPLAINT" | "SUPPLIER";

export const NCR_STATUSES: readonly NcrStatus[] = ["OPEN", "DISPOSITIONED", "CLOSED"];
export const NCR_DISPOSITIONS: readonly NcrDisposition[] = [
  "REWORK",
  "SCRAP",
  "ACCEPT",
  "RETURN_TO_SUPPLIER",
];
export const NCR_SOURCES: readonly NcrSource[] = [
  "INSPECTION",
  "PRODUCTION",
  "COMPLAINT",
  "SUPPLIER",
];

/** The lifecycle moves the service exposes (one guarded CAS each — the
 * 0105 stamp-law shape the 0114 floor stamps). */
export type NcrMove = "disposition" | "close";

/** The refusal shapes (the fold's own verdict vocabulary — each maps to
 * exactly one typed error in quality-errors.ts, never a raw string). */
export type NcrMoveRefusal =
  /** BR-102: a close attempt on an OPEN record — the disposition pair
   * must land first. */
  | "DISPOSITION_REQUIRED"
  /** A disposition attempt on an already-dispositioned record (the
   * single-use disposition stamp — INV-013's sibling discipline). */
  | "ALREADY_DISPOSITIONED"
  /** Any move on a CLOSED record — the register is evidence. */
  | "ALREADY_CLOSED";

export interface NcrMoveVerdict {
  allowed: boolean;
  refusal?: NcrMoveRefusal;
  /** The refusal's reason line (carried to the typed error verbatim). */
  reason?: string;
}

/**
 * The lifecycle verdict for a move from a state. The ladder:
 * OPEN →(disposition)→ DISPOSITIONED →(close)→ CLOSED. Every other
 * cell is refused with its named reason — the fold is total (every
 * status × move cell is decided; the property test walks the full
 * matrix).
 */
export function nextNcrMove(status: NcrStatus, move: NcrMove): NcrMoveVerdict {
  if (status === "CLOSED") {
    return {
      allowed: false,
      refusal: "ALREADY_CLOSED",
      reason: "the record is CLOSED — the register is evidence, no move reopens it",
    };
  }
  if (move === "disposition") {
    if (status === "OPEN") return { allowed: true };
    return {
      allowed: false,
      refusal: "ALREADY_DISPOSITIONED",
      reason: "the disposition stamp is single-use — the record already carries its disposition",
    };
  }
  // move === "close" on OPEN | DISPOSITIONED
  if (status === "DISPOSITIONED") return { allowed: true };
  return {
    allowed: false,
    refusal: "DISPOSITION_REQUIRED",
    reason: "BR-102 — no NCR closes without a disposition",
  };
}

/**
 * G-62's journal scope (D-05 + ck_ncr_records_journal_gated, the
 * declared W-25 interpretation — the wave README's interpretation
 * table): ONLY the SCRAP disposition of a BATCH-referencing NCR posts
 * the inventory write-off (the batch's own stock is the value source —
 * "the affected quantity's own value"); a batch-less SCRAP (e.g. a
 * SUPPLIER NCR on goods never booked under a batch of this record)
 * stamps the disposition with NO journal — the 0114 gate's own NULL
 * allowance, the recorded honest shape; REWORK/ACCEPT/
 * RETURN_TO_SUPPLIER carry NO GL entry in every case (D-05's recorded
 * honest shape; the return-to-supplier rides the 044 supplier-returns
 * path when consumed).
 */
export function scrapJournalScope(input: {
  disposition: NcrDisposition;
  hasBatch: boolean;
}): "POSTS_WRITE_OFF" | "NO_JOURNAL" {
  if (input.disposition === "SCRAP" && input.hasBatch) return "POSTS_WRITE_OFF";
  return "NO_JOURNAL";
}

/**
 * The source-shape fold (0114's ck_ncr_records_source_shape at the
 * service floor): an INSPECTION-sourced NCR carries its inspection; a
 * SUPPLIER- or COMPLAINT-sourced NCR carries its partner; PRODUCTION
 * carries the batch when known. The service refuses the shape BEFORE
 * the insert so the caller gets the typed refusal, not a raw 23514.
 */
export function ncrSourceShapeValid(input: {
  source: NcrSource;
  hasInspection: boolean;
  hasPartner: boolean;
}): boolean {
  if (input.source === "INSPECTION") return input.hasInspection;
  if (input.source === "SUPPLIER" || input.source === "COMPLAINT") return input.hasPartner;
  return true; // PRODUCTION — the batch is optional ("carries the batch when known")
}
