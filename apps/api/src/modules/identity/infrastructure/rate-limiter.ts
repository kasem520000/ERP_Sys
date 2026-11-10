import {
  PER_ACCOUNT_RESET_MAX_ATTEMPTS,
  PER_ACCOUNT_RESET_WINDOW_MS,
  PER_IP_LOGIN_MAX_ATTEMPTS,
  PER_IP_LOGIN_WINDOW_MS,
  PER_IP_RESET_MAX_ATTEMPTS,
  PER_IP_RESET_WINDOW_MS,
  systemClock,
  type Clock,
} from "../domain/session-policy";
import { RateLimitedError } from "../domain/identity-errors";

/**
 * Per-IP sliding-window rate limiter (AUTHENTICATION §5.1; R-03/R-08):
 * in-memory counters on the hot path — deliberately cheap (PHASE-003 §6:
 * "no DB write on the hot path beyond failed attempts"). Multi-instance
 * deployments move the counter to the shared plane with the first scale-out
 * phase; the interface is the contract, the Map is the PHASE-003 substrate.
 * Headers/case toggles cannot reset a window (R-08): the key is the exact
 * remote IP string as seen by the server.
 */

interface Window {
  attempts: number[];
}

/** Non-throwing consume result (PHASE-024 R-04/R-05): the decision, not the error. */
export interface RateLimitDecision {
  /** false once the window is saturated (this attempt was recorded anyway). */
  readonly allowed: boolean;
  /** The window ceiling (X-RateLimit-Limit). */
  readonly limit: number;
  /** Budget left AFTER this attempt (X-RateLimit-Remaining; 0 when saturated). */
  readonly remaining: number;
  /** Whole seconds until the window frees (only meaningful when saturated). */
  readonly retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly maxAttempts: number = PER_IP_LOGIN_MAX_ATTEMPTS,
    private readonly windowMs: number = PER_IP_LOGIN_WINDOW_MS,
  ) {}

  /**
   * Record one attempt and return the decision (PHASE-024): callers that
   * must keep a uniform response shape (R-05 reset request) or set quota
   * headers (R-04 tenant burst) branch on `allowed` instead of catching.
   */
  attempt(key: string): RateLimitDecision {
    const now = this.clock.now().getTime();
    const window = this.windows.get(key) ?? { attempts: [] };
    window.attempts = window.attempts.filter((at) => now - at < this.windowMs);
    window.attempts.push(now);
    this.windows.set(key, window);
    if (window.attempts.length > this.maxAttempts) {
      const remainingMs = window.attempts[0]! + this.windowMs - now;
      // Round UP to whole seconds (never retry early), exact integers —
      // the house `| 0` floor idiom on the (ms + 999) / 1000 ceil:
      // integer arithmetic only, no floating-point rounding.
      const ceilSeconds = ((remainingMs + 999) / 1000) | 0;
      return {
        allowed: false,
        limit: this.maxAttempts,
        remaining: 0,
        retryAfterSeconds: ceilSeconds < 1 ? 1 : ceilSeconds,
      };
    }
    return {
      allowed: true,
      limit: this.maxAttempts,
      remaining: this.maxAttempts - window.attempts.length,
      retryAfterSeconds: 0,
    };
  }

  /**
   * Record one attempt for the key and throw 429 (+Retry-After) once the
   * window is saturated. Callers invoke this BEFORE any DB work so the
   * cheap rejection dominates (R-06 principle at the login surface).
   */
  consume(key: string): void {
    const decision = this.attempt(key);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.retryAfterSeconds);
    }
  }

  /** Successful logins clear the IP window (fresh budget, no penalty carry). */
  reset(key: string): void {
    this.windows.delete(key);
  }
}

/** Login-surface limiter (R-03). */
export function loginRateLimiter(clock: Clock = systemClock): RateLimiter {
  return new RateLimiter(clock, PER_IP_LOGIN_MAX_ATTEMPTS, PER_IP_LOGIN_WINDOW_MS);
}

/** Password-reset-request limiter (R-05: no email bombing). */
export function resetRateLimiter(clock: Clock = systemClock): RateLimiter {
  return new RateLimiter(clock, PER_IP_RESET_MAX_ATTEMPTS, PER_IP_RESET_WINDOW_MS);
}

/** Per-ACCOUNT reset-request limiter (R-05: distributed-IP flood leg). */
export function resetAccountRateLimiter(clock: Clock = systemClock): RateLimiter {
  return new RateLimiter(
    clock,
    PER_ACCOUNT_RESET_MAX_ATTEMPTS,
    PER_ACCOUNT_RESET_WINDOW_MS,
  );
}

/** R-04: per-tenant API burst window (10 s sliding). */
export const TENANT_BURST_WINDOW_MS = 10_000;

/**
 * R-04 default burst ceiling per 10 s window. Sized for the test suite's
 * sequential single-tenant traffic (the db suite never trips it by
 * accident); production tuning (plan-tier quotas, real traffic shapes) is
 * an ops decision, not a code change — set TENANT_RATE_LIMIT_MAX.
 */
export const TENANT_BURST_MAX_DEFAULT = 1000;

/**
 * Env-tunable ceiling, read at limiter CONSTRUCTION (factory call), not at
 * module load — tests set the env and call `tenantRateLimiter()` to get a
 * low-capacity limiter deterministically. Unset/empty/garbage → default.
 */
export function tenantRateLimitMax(): number {
  const parsed = Number(process.env.TENANT_RATE_LIMIT_MAX ?? "");
  if (!Number.isFinite(parsed) || parsed < 1) {
    return TENANT_BURST_MAX_DEFAULT;
  }
  return parsed | 0;
}

/** Per-tenant API burst limiter (R-04). */
export function tenantRateLimiter(clock: Clock = systemClock): RateLimiter {
  return new RateLimiter(clock, tenantRateLimitMax(), TENANT_BURST_WINDOW_MS);
}

/**
 * The counters are shared across every authentication surface (R-07):
 * API, BFF, and password-reset all funnel through these singletons.
 */
export const LOGIN_LIMITER = loginRateLimiter();
export const RESET_LIMITER = resetRateLimiter();
export const RESET_ACCOUNT_LIMITER = resetAccountRateLimiter();

/**
 * R-04: the per-tenant API burst budget — one shared counter keyed by
 * tenant id (isolation by construction), consumed by
 * TenantRateLimitMiddleware before any tenant-scoped work.
 */
export const TENANT_LIMITER = tenantRateLimiter();
