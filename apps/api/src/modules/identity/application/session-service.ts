import { generateOpaqueToken, hashToken } from "../domain/tokens";
import {
  MFA_ENROLLMENT_SESSION_IDLE_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  systemClock,
  type Clock,
} from "../domain/session-policy";
import { TenantContextRequiredError, UnauthenticatedError } from "../domain/identity-errors";
import * as store from "../infrastructure/identity.store";
import { membershipOptions, type MembershipOption } from "../infrastructure/identity.store";

/**
 * Session service (ADR-0015 §2; AUTHENTICATION §1): opaque server-side
 * sessions — rotating ids, hashed at rest, absolute timeout 12 h from issue,
 * idle timeout 30 min from last_seen, per-user server-side revocation.
 * Validation is the ONLY place a presented token becomes an identity, and
 * every rule here is fail-closed (revoked → dead even inside the window).
 */

export interface IssuedSession {
  token: string;
  sessionId: string;
  expiresAt: string;
}

export interface SessionValidation {
  sessionId: string;
  userId: string;
  activeTenantId: string | null;
  /** True when the sliding window moved — caller persists last_seen. */
  touched: boolean;
  /** PHASE-024: false on the enrollment-bootstrap session (route-gated). */
  mfaGatePassed: boolean;
}

export class SessionService {
  constructor(private readonly clock: Clock = systemClock) {}

  /**
   * Issue a fresh session bound to the user's active tenant choice. The
   * token exists exactly once in plaintext: the login response. Everything
   * else stores the SHA-256 hash.
   *
   * PHASE-024: `mfaGatePassed: false` issues the enrollment-bootstrap
   * session (15-minute idle window — MFA_ENROLLMENT_SESSION_IDLE_MS); the
   * session middleware restricts it to the MFA endpoints until a valid
   * TOTP confirmation flips the gate.
   */
  async issue(input: {
    userId: string;
    activeTenantId: string | null;
    ip?: string;
    mfaGatePassed?: boolean;
  }): Promise<IssuedSession> {
    const token = generateOpaqueToken();
    const idleMs = input.mfaGatePassed === false
      ? MFA_ENROLLMENT_SESSION_IDLE_MS
      : SESSION_IDLE_TIMEOUT_MS;
    const expiresAt = new Date(this.clock.now().getTime() + idleMs);
    const row = await store.insertSession({
      userId: input.userId,
      tokenHash: hashToken(token),
      activeTenantId: input.activeTenantId,
      expiresAt: expiresAt.toISOString(),
      ip: input.ip,
      mfaGatePassed: input.mfaGatePassed ?? true,
    });
    return { token, sessionId: row.id, expiresAt: row.expiresAt };
  }

  /**
   * Validate a presented token: exists → not revoked → inside both windows
   * (M-01 idle / M-02 absolute). Revocation and expiry are
   * indistinguishable to the caller (single UNAUTHENTICATED shape).
   */
  async validate(token: string): Promise<SessionValidation> {
    const row = await store.findSessionByTokenHash(hashToken(token));
    if (row === undefined || row.revokedAt !== null) {
      throw new UnauthenticatedError();
    }
    const now = this.clock.now();
    if (now.getTime() >= Date.parse(row.expiresAt)) {
      throw new UnauthenticatedError(); // idle window elapsed (M-01)
    }
    const absoluteDeadline = Date.parse(row.createdAt) + SESSION_ABSOLUTE_TIMEOUT_MS;
    if (now.getTime() >= absoluteDeadline) {
      throw new UnauthenticatedError(); // absolute timeout (M-02)
    }
    return {
      sessionId: row.id,
      userId: row.userId,
      activeTenantId: row.activeTenantId,
      touched: true,
      mfaGatePassed: row.mfaGatePassed,
    };
  }

  /**
   * Rotate (M-04): issue a replacement and revoke the old row in one step.
   * The old token dies with the transaction; the absolute window is
   * inherited by re-anchoring created_at to the ORIGINAL issue instant.
   */
  async rotate(oldToken: string): Promise<IssuedSession> {
    const row = await store.findSessionByTokenHash(hashToken(oldToken));
    if (row === undefined) {
      throw new UnauthenticatedError();
    }
    const token = generateOpaqueToken();
    // PHASE-024: rotation inherits the enrollment gate (and its short idle
    // window) — a bootstrap session can never rotate itself into a full
    // session; only a valid TOTP confirmation flips the gate.
    const idleMs = row.mfaGatePassed === false
      ? MFA_ENROLLMENT_SESSION_IDLE_MS
      : SESSION_IDLE_TIMEOUT_MS;
    const expiresAt = new Date(this.clock.now().getTime() + idleMs);
    await store.revokeSession(row.id);
    const next = await store.insertSession({
      userId: row.userId,
      tokenHash: hashToken(token),
      activeTenantId: row.activeTenantId,
      expiresAt: expiresAt.toISOString(),
      ip: row.ip ?? undefined,
      mfaGatePassed: row.mfaGatePassed,
    });
    // Re-anchor the absolute window to the original issue instant so
    // rotation cannot extend lifetime beyond 12 h from first login (M-02).
    await store.anchorSessionCreatedAt(next.id, row.createdAt);
    return { token, sessionId: next.id, expiresAt: next.expiresAt };
  }

  /** Revoke by id (self logout or owner revoking another user — M-10). */
  async revokeById(sessionId: string): Promise<void> {
    await store.revokeSession(sessionId);
  }

  /** Revoke every live session of a user (password reset consume, logout-all). */
  async revokeAllForUser(userId: string): Promise<void> {
    await store.revokeAllSessionsForUser(userId);
  }

  async listForUser(userId: string): Promise<readonly store.SessionRow[]> {
    return store.listSessionsForUser(userId);
  }

  async listForTenant(tenantId: string): Promise<readonly store.SessionRow[]> {
    return store.listSessionsForTenant(tenantId);
  }

  /** Membership options of the authenticated user (definer projection). */
  async membershipOptions(userId: string): Promise<readonly MembershipOption[]> {
    return membershipOptions(userId);
  }

  /**
   * Resolve the ACTIVE tenant scope for a validated session: the session's
   * active_tenant_id must map to an ACTIVE membership of an ACTIVE tenant
   * (ADR-0005: context from session → membership, never client input; a
   * stale convenience value is re-derived, never trusted).
   */
  async requireActiveTenantScope(userId: string): Promise<MembershipOption> {
    const options = await membershipOptions(userId);
    const active = options.find(
      (option) =>
        option.membershipStatus === "ACTIVE" &&
        option.tenantStatus === "ACTIVE" &&
        option.tenantId !== null,
    );
    if (active === undefined) {
      throw new TenantContextRequiredError();
    }
    return active;
  }
}
