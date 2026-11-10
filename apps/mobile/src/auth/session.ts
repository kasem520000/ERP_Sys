import type { AccessTokenProvider } from "../sync/transport";

/**
 * PHASE-022 · the memory-only device access-token manager (T2-b;
 * MASTER-PLAN §1 DR-P22-09 + §7; SECURITY_AND_DEVICE_MANAGEMENT §3;
 * ADR-0015 §3) — the `@erp/desktop` `auth/session.ts` ported onto the
 * mobile runtime (the desktop class, byte-for-byte in behavior, plus
 * the mobile-specific scheduling hook + transport adapter below).
 *
 * The server mints 15-minute device access tokens
 * (`ACCESS_TOKEN_TTL_SECONDS = 900` on the API side — the assumption
 * baked into the refresh margin below) and rotates the one-time-use
 * refresh token on EVERY exchange. This class owns exactly one concern:
 * keep a current access token in MEMORY (never the SecureStore, never
 * the SQLite store, never logs — SECURITY §3) and refresh it silently
 * 60 s before expiry.
 *
 * Rotation-failure contract (the D-01 hook): when an exchange fails
 * (the server answers the typed DEVICE_REFRESH_INVALID — over HTTP a
 * 401 whose body carries the code; reuse of a rotated token means
 * THEFT and revokes the device server-side, or DEVICE_REVOKED — 403),
 * the session clears its state, emits `onRotationFailure`, and
 * rethrows; the D-01 consumer (device/registration.ts's revoke flow →
 * 2-a's purgeOnRevocation) stops syncing, purges local tenant data,
 * wipes the vault, and requires re-login.
 *
 * Concurrency: the refresh is serialized by an in-flight mutex — two
 * simultaneous `silentRefreshIfDue()` calls share ONE exchange. This is
 * not an optimization: presenting the same one-time-use refresh token
 * twice concurrently is EXACTLY the reuse signal that revokes the
 * device (the M-05 kill switch), so the mutex is a correctness
 * requirement.
 */

/** Refresh this long before expiry (the desktop constant: "silently at
 * expiry−60 s"). The server's access-token TTL is 15 min
 * (ACCESS_TOKEN_TTL_SECONDS = 900); the margin leaves a full minute of
 * overlap for in-flight requests using the previous token. */
export const ACCESS_TOKEN_REFRESH_MARGIN_MS = 60_000;

/** The refresh-failure classification surfaced to the D-01 hook. */
export interface RotationFailure {
  /** What failed: the exchange itself (reuse/revocation/network — the
   * error is carried along), or the absence of any stored credential
   * (no refresh token in the vault — the device was never enrolled, or
   * its credentials were already purged by a previous D-01 path). */
  kind: "ROTATION_FAILED" | "NO_CREDENTIAL";
  /** The underlying exchange error (null on NO_CREDENTIAL). */
  error: unknown;
  /** Always true today: a failed rotation cannot be recovered in place
   * — the D-01 path (purge + re-enroll) is the only way forward.
   * Carried as a field so the hook signature stays stable if a
   * retryable class is ever added. */
  requiresReEnrollment: boolean;
}

/** One successful exchange (the POST /devices/:id/refresh envelope
 * minus the successor refresh token — the session never needs it: the
 * `refresh` closure OWNS persisting the rotated token to the vault,
 * see refresh.ts's rotateDeviceRefreshToken). */
export interface SessionRefreshResult {
  accessToken: string;
  /** ISO timestamp — the access token's 15-minute expiry. */
  expiresAt: string;
  /** The successor refresh token's 30-day absolute window (observability). */
  refreshTokenExpiresAt: string;
}

export interface MobileSessionOptions {
  /** Read the current refresh token from the vault (null = absent). */
  getRefreshToken: () => Promise<string | null>;
  /**
   * Exchange a refresh token for a fresh access token (POST
   * /api/v1/devices/:id/refresh). CONTRACT: the server rotates the
   * one-time-use refresh token on every call — this closure MUST write
   * the successor token to the vault (or whatever durable store it
   * fronts) BEFORE resolving. A closure that forgets dooms the NEXT
   * exchange to present a consumed token — reuse detection revokes the
   * device (M-05) and this session surfaces it through
   * onRotationFailure. `rotateDeviceRefreshToken` (refresh.ts)
   * implements the contract.
   */
  refresh: (refreshToken: string) => Promise<SessionRefreshResult>;
  /** Injectable clock (epoch ms) — tests drive the −60 s boundary. */
  clock?: () => number;
  /** The D-01 hook: invoked exactly once per failed exchange, after
   * the in-memory state was cleared. The session rethrows the exchange
   * error afterwards; the hook owns the purge/re-login UX. */
  onRotationFailure?: (failure: RotationFailure) => void;
}

/** The memory-only access-token manager. One instance per enrolled
 * device (the native App holds exactly one). */
export class MobileSession {
  /** The constructor-resolved options (the clock is always present). */
  private readonly options: Omit<MobileSessionOptions, "clock"> & { clock: () => number };
  private accessTokenValue: string | null = null;
  private expiresAtMs: number | null = null;
  private inflight: Promise<string | null> | null = null;

  constructor(options: MobileSessionOptions) {
    // Default the clock BEFORE the spread: an explicit `clock: undefined`
    // must still land on the wall clock, never on a possibly-undefined call.
    const clock = options.clock ?? (() => Date.now());
    this.options = { ...options, clock };
  }

  /** The current access token, or null when none is held. Pure memory —
   * never triggers I/O; call silentRefreshIfDue() to (re)acquire. */
  current(): string | null {
    return this.accessTokenValue;
  }

  /** The held token's expiry (epoch ms), null when no token is held. */
  expiresAt(): number | null {
    return this.expiresAtMs;
  }

  /** Seed the memory token from an existing exchange result (the enroll
   * bootstrap returns a fresh 15-min access token — priming it here
   * avoids a redundant immediate refresh). Memory-only by construction. */
  prime(accessToken: string, expiresAt: string): void {
    this.accessTokenValue = accessToken;
    this.expiresAtMs = Date.parse(expiresAt);
  }

  /** True when no token is held or it is past expiry (the wall clock of
   * `clock()`). A token inside the last 60 s is NOT "expired" — but it
   * IS due for refresh (silentRefreshIfDue). */
  isExpired(): boolean {
    if (this.accessTokenValue === null || this.expiresAtMs === null) {
      return true;
    }
    return this.options.clock() >= this.expiresAtMs;
  }

  /**
   * The silent-refresh SCHEDULING hook: how many ms from `clock()`'s
   * now until the next silent refresh should fire (0 when already due;
   * null when no token is held — the caller refreshes immediately).
   * The native App wires a timer against this —
   * `setTimeout(() => void session.silentRefreshIfDue(), session.msUntilDue())`
   * — re-arming after every exchange (the desktop shell's pattern;
   * the timer itself lives outside this class so tests stay sync).
   */
  msUntilDue(): number | null {
    if (this.accessTokenValue === null || this.expiresAtMs === null) {
      return null;
    }
    return Math.max(0, this.expiresAtMs - ACCESS_TOKEN_REFRESH_MARGIN_MS - this.options.clock());
  }

  /**
   * Acquire a current access token, exchanging when due: no token held, or
   * now ≥ expiresAt − 60 s. Concurrent callers share ONE exchange (the
   * mutex — see the class header). Returns the token, or null when no
   * refresh token exists (never enrolled / already purged — D-01 state).
   * Rethrows exchange failures AFTER the onRotationFailure hook ran.
   */
  async silentRefreshIfDue(): Promise<string | null> {
    if (!this.isDue()) {
      return this.accessTokenValue;
    }
    if (this.inflight === null) {
      // The mutex is correctness, not performance: a second concurrent
      // exchange would present the same one-time-use token — instant
      // reuse-revocation. Everyone awaits the SAME promise.
      this.inflight = this.exchange().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Forget the in-memory token (logout / D-01 purge). Idempotent. */
  clear(): void {
    this.accessTokenValue = null;
    this.expiresAtMs = null;
  }

  private isDue(): boolean {
    if (this.accessTokenValue === null || this.expiresAtMs === null) {
      return true;
    }
    return this.options.clock() >= this.expiresAtMs - ACCESS_TOKEN_REFRESH_MARGIN_MS;
  }

  private async exchange(): Promise<string | null> {
    const refreshToken = await this.options.getRefreshToken();
    if (refreshToken === null || refreshToken === "") {
      // No credential at all — the D-01 end state (or never enrolled).
      this.clear();
      this.options.onRotationFailure?.({
        kind: "NO_CREDENTIAL",
        error: null,
        requiresReEnrollment: true,
      });
      return null;
    }
    try {
      const rotated = await this.options.refresh(refreshToken);
      this.accessTokenValue = rotated.accessToken;
      this.expiresAtMs = Date.parse(rotated.expiresAt);
      return rotated.accessToken;
    } catch (error) {
      // Reuse detection → revocation (D-01): clear every trace, emit the
      // hook, rethrow so the caller's cycle aborts loudly.
      this.clear();
      this.options.onRotationFailure?.({
        kind: "ROTATION_FAILED",
        error,
        requiresReEnrollment: true,
      });
      throw error;
    }
  }
}

/**
 * Adapt a {@link MobileSession} to 2-a's transport seam: the
 * `AccessTokenProvider` closure `mobileHttpTransport` reads FRESH on
 * every request (never cached — the fail-closed credential rule;
 * MEMORY-ONLY by construction, the session is the single source).
 */
export function accessTokenProvider(session: MobileSession): AccessTokenProvider {
  return () => session.current();
}
