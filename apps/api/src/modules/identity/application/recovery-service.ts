import { createHmac, timingSafeEqual } from "node:crypto";

import { childLogger } from "../../../infra/observability/logger";
import { withTenant } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { checkPasswordPolicy } from "../domain/password-policy";
import { PASSWORD_RESET_TOKEN_TTL_MS } from "../domain/session-policy";
import { InvalidResetTokenError, NotFoundError } from "../domain/identity-errors";
import { hashToken } from "../domain/tokens";
import * as store from "../infrastructure/identity.store";
import { RESET_ACCOUNT_LIMITER, RESET_LIMITER } from "../infrastructure/rate-limiter";
import { keyMaterialForTokens } from "../infrastructure/reset-token-key";
import { PasswordService } from "./password-service";
import { SessionService } from "./session-service";

/**
 * Account recovery (ADR-0015 §6; AUTHENTICATION §4): email-based,
 * single-use, short-lived (30 min) reset links, bound to the account,
 * audited; consumption revokes every session of the user (forced re-login).
 *
 * Storage design (documented deviation, PHASE-003): the phase's authorized
 * table set (9 tables) contains no `password_resets` table, so the token is
 * STATELESS — an HMAC over (userId, passwordVersion, expiry). Single-use is
 * enforced by binding the token to the user's `version` column: consume
 * bumps the version, so any replay computes against a stale binding and is
 * rejected (M-08). Comparison is timing-safe; nothing token-shaped is
 * persisted server-side until the audited consume.
 */

const log = childLogger({ module: "identity" });

export interface ResetRequestResult {
  /** Always true — the response is uniform to prevent account enumeration. */
  accepted: true;
}

export interface RecoveryDeps {
  readonly password: PasswordService;
  readonly sessions: SessionService;
  readonly audit: AuditService;
  /** Send the reset email (best-effort; never blocks the 200 shape). */
  readonly sendResetEmail: (userId: string, email: string, locale: string, token: string) => Promise<void>;
}

export class RecoveryService {
  constructor(private readonly deps: RecoveryDeps) {}

  /** Step 1 — always 200 (no oracle), rate-limited per IP (R-05). */
  async requestReset(email: string, ip?: string): Promise<ResetRequestResult> {
    RESET_LIMITER.consume(`reset:${ip ?? "unknown"}`);
    const normalized = email.trim().toLowerCase();
    const user = await store.findUserByEmail(normalized);
    if (user === undefined) {
      log.info({ email_domain: normalized.split("@")[1] }, "reset requested for unknown email");
      return { accepted: true };
    }
    // PHASE-024 (R-05 per-ACCOUNT leg, 3/h): the distributed-IP complement
    // to the per-IP window above. Saturated → the uniform 200 SURVIVES (the
    // user-existence oracle discipline) but the email is SKIPPED — no
    // bombing. The warn line (hashed discriminator, never the raw id) is
    // the suppression trail; the audit keeps recording because the request
    // genuinely happened. No token is signed — nothing to deliver.
    const account = RESET_ACCOUNT_LIMITER.attempt(`reset-account:${user.id}`);
    if (!account.allowed) {
      log.warn(
        { account_hash: hashToken(user.id) },
        "reset email suppressed (per-account flood limit R-05)",
      );
      await this.auditResetRequested(user.id);
      return { accepted: true };
    }
    const token = this.signResetToken(user.id, user.version, Date.now() + PASSWORD_RESET_TOKEN_TTL_MS);
    await this.auditResetRequested(user.id);
    await this.deps.sendResetEmail(user.id, user.email, user.locale, token).catch(
      (error: unknown) => {
        log.warn({ err: error, user_id: user.id }, "reset email failed (non-blocking)");
      },
    );
    return { accepted: true };
  }

  /** Step 2 — single-use consume: validates, sets the password, revokes sessions. */
  async consumeReset(token: string, newPassword: string): Promise<void> {
    checkPasswordPolicy(newPassword);
    const payload = this.verifyResetToken(token);
    const user = await store.findUserById(payload.userId);
    if (user === undefined) {
      throw new InvalidResetTokenError();
    }
    if (user.version !== payload.passwordVersion) {
      // Already consumed or changed since issue (M-08 replay).
      throw new InvalidResetTokenError();
    }
    const passwordHash = await this.deps.password.hashFromNewPassword(newPassword);
    await store.updateUserRow(user.id, {
      passwordHash,
      version: user.version + 1,
      status: user.status === "LOCKED" ? "ACTIVE" : user.status,
      lockedUntil: null,
      failedLoginCount: 0,
    });
    await this.deps.sessions.revokeAllForUser(user.id);
    await this.auditPasswordReset(user.id);
    log.info({ user_id: user.id }, "password reset consumed; all sessions revoked");
  }

  /** Authenticated change: verify current, set next, revoke OTHER sessions. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionId: string,
  ): Promise<void> {
    checkPasswordPolicy(newPassword);
    const user = await store.findUserById(userId);
    if (user === undefined) {
      throw new NotFoundError("user");
    }
    const ok = await this.deps.password.verify(user.passwordHash, currentPassword);
    if (!ok) {
      throw new InvalidResetTokenError();
    }
    const passwordHash = await this.deps.password.hashFromNewPassword(newPassword);
    await store.updateUserRow(userId, {
      passwordHash,
      version: user.version + 1,
    });
    const live = await store.listSessionsForUser(userId);
    for (const session of live) {
      if (session.id !== keepSessionId && session.revokedAt === null) {
        await store.revokeSession(session.id);
      }
    }
    await this.auditPasswordReset(userId);
  }

  // -- token shape: base64url(payload).base64url(hmac) ----------------------

  private signResetToken(userId: string, passwordVersion: number, expiresAtMs: number): string {
    const payload = Buffer.from(
      JSON.stringify({ u: userId, v: passwordVersion, e: expiresAtMs }),
      "utf8",
    ).toString("base64url");
    const signature = createHmac("sha256", keyMaterialForTokens()).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private verifyResetToken(token: string): { userId: string; passwordVersion: number; expiresAtMs: number } {
    const parts = token.split(".");
    if (parts.length !== 2) {
      throw new InvalidResetTokenError();
    }
    const [payloadB64, signatureB64] = parts as [string, string];
    const expected = createHmac("sha256", keyMaterialForTokens()).update(payloadB64).digest();
    const presented = Buffer.from(signatureB64, "base64url");
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      throw new InvalidResetTokenError();
    }
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      u: string;
      v: number;
      e: number;
    };
    if (typeof decoded.u !== "string" || typeof decoded.v !== "number" || typeof decoded.e !== "number") {
      throw new InvalidResetTokenError();
    }
    if (Date.now() >= decoded.e) {
      throw new InvalidResetTokenError(); // expired (M-08)
    }
    return { userId: decoded.u, passwordVersion: decoded.v, expiresAtMs: decoded.e };
  }

  private async auditResetRequested(userId: string): Promise<void> {
    try {
      const options = await store.membershipOptions(userId);
      const target = options.find(
        (m) => m.membershipStatus === "ACTIVE" && m.tenantStatus === "ACTIVE",
      );
      if (target === undefined) {
        return; // platform-scope audit widens in PHASE-004 (documented)
      }
      await withTenant(target.tenantId, async () => {
        await this.deps.audit.record({
          action: "password.reset_requested",
          entityType: "user",
          entityId: userId,
          actorId: userId,
        });
      });
    } catch (error) {
      log.warn({ err: error }, "reset_requested audit write failed (non-blocking)");
    }
  }

  private async auditPasswordReset(userId: string): Promise<void> {
    try {
      const options = await store.membershipOptions(userId);
      const target = options.find(
        (m) => m.membershipStatus === "ACTIVE" && m.tenantStatus === "ACTIVE",
      );
      if (target === undefined) {
        return;
      }
      await withTenant(target.tenantId, async () => {
        await this.deps.audit.record({
          action: "password.reset",
          entityType: "user",
          entityId: userId,
          actorId: userId,
        });
      });
    } catch (error) {
      log.warn({ err: error }, "password reset audit write failed (non-blocking)");
    }
  }
}
