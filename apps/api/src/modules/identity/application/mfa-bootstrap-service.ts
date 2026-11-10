import { childLogger } from "../../../infra/observability/logger";
import { withTenant } from "../../../infra/db/tenant-context";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { AuditService } from "../../audit/api/audit";
import { PasswordService } from "./password-service";
import { SessionService } from "./session-service";
import * as store from "../infrastructure/identity.store";
import { LOGIN_LIMITER } from "../infrastructure/rate-limiter";
import {
  LOCKOUT_DURATION_MS,
  LOCKOUT_THRESHOLD,
  progressiveDelayMs,
  systemClock,
  type Clock,
} from "../domain/session-policy";
import {
  mfaRequiredForRole,
  resolveMfaRequiredRoles,
  type MfaTenantPolicy,
} from "../domain/mfa-policy";
import {
  AccountLockedError,
  InvalidCredentialsError,
  MfaBootstrapNotEligibleError,
  UnauthenticatedError,
} from "../domain/identity-errors";

/**
 * MFA enrollment bootstrap (PHASE-024 T4; ADR-0015 §4 enforcement): the
 * deadlock-breaker. A policy-mandated user with no confirmed factor cannot
 * log in (423 MFA_REQUIRED / enrollmentRequired) and cannot enroll either
 * (enrollment needs a session). This endpoint re-verifies the FULL login
 * discipline — per-IP limiter (the SAME `login:` budget as login: R-07),
 * per-user counters, lockout, argon2id, active-membership — then issues a
 * 15-minute session with `mfa_gate_passed = false` that the session
 * middleware restricts to the MFA endpoints. Nothing else unlocks until
 * the TOTP confirmation flips the gate (MfaService.verify).
 *
 * Eligibility is enforced server-side: the bootstrap exists ONLY for
 * users whose policy mandates MFA in their active tenant and who have no
 * confirmed factor — anyone else gets a 409 (a restricted session is never
 * handed to a user who could have a full one).
 */

const log = childLogger({ module: "identity" });

export interface MfaBootstrapResult {
  token: string;
  sessionId: string;
  expiresAt: string;
  mfaEnrollmentRequired: true;
  user: { id: string; email: string; fullName: string; locale: string };
}

export interface MfaBootstrapDeps {
  readonly clock?: Clock;
  readonly password: PasswordService;
  readonly sessions: SessionService;
  readonly audit: AuditService;
}

export class MfaBootstrapService {
  constructor(private readonly deps: MfaBootstrapDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  private readonly clock: Clock;

  async bootstrap(input: { email: string; password: string; ip?: string }): Promise<MfaBootstrapResult> {
    const ip = input.ip ?? "unknown";
    LOGIN_LIMITER.consume(`login:${ip}`);
    const email = input.email.trim().toLowerCase();

    const user = await store.findUserByEmail(email);
    if (user === undefined) {
      // No oracle: the same shape as a wrong password (login parity).
      log.warn({ email_hash: hashForLog(email) }, "bootstrap attempt for unknown email");
      throw new InvalidCredentialsError();
    }

    if (user.lockedUntil !== null && Date.parse(user.lockedUntil) > this.clock.now().getTime()) {
      const remainingMs = Date.parse(user.lockedUntil) - this.clock.now().getTime();
      const retryAfterSeconds = Math.max(1, (remainingMs + 999) / 1000 | 0);
      throw new AccountLockedError(retryAfterSeconds);
    }

    const passwordOk = await this.deps.password.verify(user.passwordHash, input.password);
    if (!passwordOk) {
      // The SAME durable counters as login (R-07 surface parity): a
      // bootstrap spray is a login spray.
      const failedCount = await store.markLoginFailure(user.id);
      if (failedCount >= LOCKOUT_THRESHOLD) {
        const lockedUntil = new Date(
          this.clock.now().getTime() + LOCKOUT_DURATION_MS,
        ).toISOString();
        await store.lockUser(user.id, lockedUntil);
        log.warn({ user_id: user.id }, "temporary lockout engaged (bootstrap path, R-07)" );
      }
      const delay = progressiveDelayMs(failedCount);
      if (delay > 0) {
        await this.clock.sleep(delay);
      }
      throw new InvalidCredentialsError();
    }

    const memberships = await store.membershipOptions(user.id);
    const activeOnes = memberships.filter(
      (m) => m.membershipStatus === "ACTIVE" && m.tenantStatus === "ACTIVE",
    );
    if (activeOnes.length === 0) {
      throw new UnauthenticatedError();
    }
    const tenant = activeOnes[0]!;

    // Eligibility: policy mandates MFA for the user's role AND no confirmed
    // factor (a confirmed factor means the normal login code path applies).
    const requiredRoles = await withTenant(tenant.tenantId, async () => {
      const planKeys = await store.findPlanMfaRequiredRoleKeys(tenant.tenantId);
      const tenantPolicy = await readEffectiveSetting<MfaTenantPolicy>(
        "identity.mfa.policy",
      );
      return resolveMfaRequiredRoles({ planRequiredRoleKeys: planKeys, tenantPolicy });
    });
    const mandated = mfaRequiredForRole(tenant.roleKey, requiredRoles);
    const confirmed = (await store.findMfaFactorsForUser(user.id)).find(
      (factor) => factor.confirmedAt !== null,
    );
    if (!mandated || confirmed !== undefined) {
      throw new MfaBootstrapNotEligibleError();
    }

    const issued = await withTenant(tenant.tenantId, async () => {
      const session = await this.deps.sessions.issue({
        userId: user.id,
        activeTenantId: tenant.tenantId,
        ip: input.ip,
        mfaGatePassed: false,
      });
      await this.deps.audit.record({
        action: "mfa.bootstrap_started",
        entityType: "user",
        entityId: user.id,
        actorId: user.id,
        after: { session_id: session.sessionId, ip: input.ip ?? null },
      });
      return session;
    });

    log.info({ user_id: user.id }, "mfa enrollment bootstrap session issued");

    return {
      token: issued.token,
      sessionId: issued.sessionId,
      expiresAt: issued.expiresAt,
      mfaEnrollmentRequired: true,
      user: { id: user.id, email: user.email, fullName: user.fullName, locale: user.locale },
    };
  }
}

/** Stable per-email log discriminator without storing raw addresses in logs. */
import { createHash } from "node:crypto";
function hashForLog(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 12);
}
