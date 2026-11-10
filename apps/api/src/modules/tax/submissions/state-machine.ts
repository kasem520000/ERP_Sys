/**
 * PHASE-023 T1 — the e-invoicing submission state machine
 * (E_INVOICING_ARCHITECTURE §2): the registry's lifecycle is adapter-neutral
 * and ILLEGAL TRANSITIONS ARE REJECTED IN CODE, not just convention —
 * acceptance by an authority is exactly what the registry says, and nothing
 * else may move a row (directive §12).
 *
 * Lifecycle (per document × adapter):
 *
 *   PENDING → GENERATED → SIGNED → SUBMITTED → ACCEPTED → REPORTED
 *                                             ↘ REJECTED → (new submission)
 *   Any live-retry state ↘ FAILED (dead-letter after capped retries; a FAILED
 *   row never silently resurrects — a NEW submission row is the retry unit
 *   for user-actioned cases, the retry loop only continues while the row is
 *   in a live state.)
 *
 * - SIGNED applies only where the regime signs (the adapter declares it);
 *   unsigned regimes hop GENERATED → SUBMITTED directly.
 * - REJECTED is terminal for the ROW: reason codes surface for user action;
 *   resubmission after fixing the document creates a new row chained via
 *   `retry_of_submission_id` (history is append-only).
 * - REPORTED applies to reporting-mode flows (E_INVOICING §2) — the
 *   ACCEPTED → REPORTED hop records the reporting acknowledgement.
 */

/** The registry lifecycle states (DATA_DICTIONARY einvoice_submission_status). */
export type SubmissionStatus =
  | "PENDING"
  | "GENERATED"
  | "SIGNED"
  | "SUBMITTED"
  | "ACCEPTED"
  | "REJECTED"
  | "REPORTED"
  | "FAILED";

export const SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  "PENDING",
  "GENERATED",
  "SIGNED",
  "SUBMITTED",
  "ACCEPTED",
  "REJECTED",
  "REPORTED",
  "FAILED",
] as const;

/** Live states the retry sweep visits (partial index ix_einvoicing_submissions_retry). */
export const RETRYABLE_STATUSES: readonly SubmissionStatus[] = [
  "PENDING",
  "GENERATED",
  "SIGNED",
  "SUBMITTED",
] as const;

/** Terminal states — a row here never transitions again (history is append-only). */
export const TERMINAL_STATUSES: readonly SubmissionStatus[] = [
  "ACCEPTED",
  "REJECTED",
  "REPORTED",
  "FAILED",
] as const;

/**
 * The legal transition table. Keys: `FROM`, values: allowed `TO` states.
 * Mirrors E_INVOICING §2 exactly:
 * - PENDING → GENERATED (payload built); PENDING → FAILED (build failure).
 * - GENERATED → SIGNED (signing regimes); GENERATED → SUBMITTED (unsigned);
 *   GENERATED → FAILED.
 * - SIGNED → SUBMITTED; SIGNED → FAILED.
 * - SUBMITTED → ACCEPTED | REJECTED | FAILED (authority unreachable after
 *   capped retries).
 * - ACCEPTED → REPORTED (reporting-mode acknowledgement); ACCEPTED is
 *   otherwise terminal.
 * - Self-transitions on the live states (PENDING/GENERATED/SIGNED/SUBMITTED)
 *   record ATTEMPT bookkeeping (retries, poll re-checks) — an attempt is
 *   not a state change; the state machine comment in E_INVOICING §2.
 * - REJECTED / REPORTED / FAILED: terminal (resubmission = a NEW row).
 */
const LEGAL_TRANSITIONS: Readonly<Record<SubmissionStatus, readonly SubmissionStatus[]>> = {
  PENDING: ["PENDING", "GENERATED", "FAILED"],
  GENERATED: ["GENERATED", "SIGNED", "SUBMITTED", "FAILED"],
  SIGNED: ["SIGNED", "SUBMITTED", "FAILED"],
  SUBMITTED: ["SUBMITTED", "ACCEPTED", "REJECTED", "FAILED"],
  ACCEPTED: ["REPORTED"],
  REJECTED: [],
  REPORTED: [],
  FAILED: [],
};

/** Is `from → to` a legal registry transition? */
export function isLegalTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Assert a transition, returning a typed error payload when illegal. */
export function assertLegalTransition(
  from: SubmissionStatus,
  to: SubmissionStatus,
): { ok: true } | { ok: false; from: SubmissionStatus; attempted: SubmissionStatus; legal: readonly SubmissionStatus[] } {
  if (isLegalTransition(from, to)) {
    return { ok: true };
  }
  return { ok: false, from, attempted: to, legal: LEGAL_TRANSITIONS[from] ?? [] };
}

/**
 * Retry policy (E_INVOICING §2 — exponential, capped): the sweep computes
 * `next_attempt_at = now + backoff(attempts)` where backoff doubles from
 * the base up to the cap. Dead-letter: after MAX_ATTEMPTS attempts in a
 * live-retry state the row transitions FAILED and the dead-letter
 * notification fires (einvoicing.submission.failed → notifications).
 */
export const RETRY_BASE_DELAY_MS = 30_000;
export const RETRY_MAX_DELAY_MS = 30 * 60_000;
export const RETRY_MAX_ATTEMPTS = 8;

/** Exponential backoff with cap (deterministic; the sweep passes `now`). */
export function backoffDelayMs(attemptsSoFar: number): number {
  const exp = RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attemptsSoFar - 1);
  return Math.min(exp, RETRY_MAX_DELAY_MS);
}

/** Would another attempt exceed the dead-letter threshold? */
export function isDeadLetter(attemptsSoFar: number): boolean {
  return attemptsSoFar >= RETRY_MAX_ATTEMPTS;
}
