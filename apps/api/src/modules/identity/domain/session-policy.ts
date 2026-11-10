/**
 * Session & lockout policy constants (ADR-0015 §1–2, AUTHENTICATION §6 —
 * binding parameters, not tunables; revisiting them is an ADR, not an env
 * var). Time is injected (`Clock`) so the abuse suites can drive the
 * windows deterministically without sleeping (M-01/M-02/R-01).
 */

export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 h
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 min
export const PASSWORD_RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 min
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000; // 72 h
/**
 * PHASE-024 (ADR-0015 §4 enforcement): the enrollment-bootstrap session's
 * idle window — 15 minutes to scan the QR and confirm one code. Short on
 * purpose: the session unlocks NOTHING but the MFA endpoints.
 */
export const MFA_ENROLLMENT_SESSION_IDLE_MS = 15 * 60 * 1000; // 15 min

/** Progressive lockout (AUTHENTICATION §5.2): delays then a temporary lock. */
export const LOCKOUT_THRESHOLD = 5; // failures before the temporary lock
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // temporary lock window
/**
 * Progressive pre-lock delays per consecutive failure (ms), capped at
 * 2500ms: 250, 1000, 2250, 2500, … — integer multiplication only (ADR-0009
 * discipline: no floating-point rounding anywhere).
 */
export function progressiveDelayMs(failedCount: number): number {
  if (failedCount < 2) {
    return 0;
  }
  const factor = (failedCount - 1) ** 2;
  return (factor < 10 ? factor : 10) * 250;
}

/** Per-IP credential-stuffing limits (R-03/R-08): sliding window. */
export const PER_IP_LOGIN_WINDOW_MS = 60 * 1000;
export const PER_IP_LOGIN_MAX_ATTEMPTS = 10;

export const PER_IP_RESET_WINDOW_MS = 60 * 60 * 1000;
export const PER_IP_RESET_MAX_ATTEMPTS = 5;

/**
 * PHASE-024 (R-05 second leg): per-ACCOUNT reset-request ceiling — the
 * distributed-IP complement to the per-IP window. Saturating it suppresses
 * the email (no bombing) while the uniform 200 survives (no oracle).
 */
export const PER_ACCOUNT_RESET_WINDOW_MS = 60 * 60 * 1000;
export const PER_ACCOUNT_RESET_MAX_ATTEMPTS = 3;

/** Injectable clock — deterministic window tests (M-01/M-02). */
export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};
