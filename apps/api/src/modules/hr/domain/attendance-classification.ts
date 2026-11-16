/**
 * PHASE-045 (the T-19 review round) — the capture-conflict
 * classification, ORDER-INDEPENDENT by construction.
 *
 * THE FINDING (2026-11-16, the T-19 full-suite run on the unified head):
 * the capture path classified a new session against the day's existing
 * rows in ONE pass over `listDerivationRows` — a query with NO ORDER BY,
 * so PostgreSQL's physical (heap) order decided which row the loop met
 * first. For the duplicate-punch candidate (the same check_in as a
 * committed session, e.g. 08:10 open-ended against a day holding
 * 08:10→12:00 + 13:00→16:00), a heap order that surfaced the 13:00
 * sibling FIRST made the loop throw SESSION_OVERLAP before it ever
 * reached the 08:10 row — the typed code for the 0081 dedupe floor
 * (ATTENDANCE_DUPLICATE_PUNCH) was order-dependent. The T-17 suite run
 * passed on a favorable heap order; the T-19 run reproduced the other
 * order — same code head, different physical layout.
 *
 * THE LAW: the exact-match (duplicate punch) decision runs over the
 * WHOLE day BEFORE any overlap comparison, so the typed code is a
 * function of the day's SESSION SET, never of the rows' physical order.
 * This mirrors the import path's proven floor shape
 * (ALREADY_IMPORTED before SESSION_OVERLAP — the two `find`s in
 * attendance-import-service) and keeps INV-031's refusal intact: a
 * duplicate is also refused, just under its SPECIFIC typed code.
 */

/** The day's session facts the classification needs — the derivation
 * row's interval arms (ms since epoch; null = the ABSENT synthesis
 * marker's (null, null) shape, which never conflicts). */
export interface SessionIntervalRow {
  checkInMs: number | null;
  checkOutMs: number | null;
}

export type CaptureConflict = "DUPLICATE_PUNCH" | "SESSION_OVERLAP";

/** Classify a candidate session `[checkInMs, checkOutMs]` (open-ended
 * when `checkOutMs` is null) against the day's existing sessions:
 *
 * - `"DUPLICATE_PUNCH"` — some existing row opens at EXACTLY
 *   `checkInMs` (the 0081 dedupe floor: the same employee + timestamp
 *   is ONE session). Decided first, over the whole set.
 * - `"SESSION_OVERLAP"` — some existing closed/open interval strictly
 *   straddles the candidate's interval (INV-031: attendance intervals
 *   never overlap per employee-day). A row with a null check_in (the
 *   ABSENT marker) never conflicts.
 * - `null` — the day accepts the candidate.
 *
 * Pure: no clock, no store, no I/O — the unit spec pins BOTH row
 * orders (the heap-order flake shape included). */
export function classifyCaptureConflict(
  dayRows: ReadonlyArray<SessionIntervalRow>,
  checkInMs: number,
  checkOutMs: number | null,
): CaptureConflict | null {
  // The dedupe floor first — the whole set, before any overlap math.
  if (dayRows.some((row) => row.checkInMs === checkInMs)) {
    return "DUPLICATE_PUNCH";
  }
  // Then INV-031 — row order cannot change a ∃-quantified refusal.
  for (const row of dayRows) {
    if (row.checkInMs === null) continue;
    const existingEnd = row.checkOutMs ?? Number.POSITIVE_INFINITY;
    const newEnd = checkOutMs ?? Number.POSITIVE_INFINITY;
    if (row.checkInMs < newEnd && checkInMs < existingEnd) {
      return "SESSION_OVERLAP";
    }
  }
  return null;
}
