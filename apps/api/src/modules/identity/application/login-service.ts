import { AuditService } from "../../audit/api/audit";
import { childLogger } from "../../../infra/observability/logger";
import { withTenant } from "../../../infra/db/tenant-context";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { PasswordService } from "./password-service";
import { SessionService } from "./session-service";
import { MfaService } from "./mfa-service";
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
  MfaRequiredError,
  UnauthenticatedError,
} from "../domain/identity-errors";
import { verifyTotp, timestepStartInstant, currentTimestep as totpStepOf } from "../domain/totp";
import { openSecret } from "../infrastructure/secret-envelope";

/**
 * Login flow (ADR-0015 §1/§5; AUTHENTICATION §5): per-IP limit → credential
 * verify (argon2id) → per-user progressive lockout → TOTP challenge →
 * session issuance. Failure responses are shape- and timing-uniform (no
 * user-existence oracle); lockouts surface the SAME 401 shape with only a
 * retryAfterSeconds detail (§5.2). All counters live in one place so the
 * API/BFF/reset surfaces share them (R-07).
 */

const log = childLogger({ module: "identity" });

export interface LoginInput {
  email: string;
  password: string;
  mfaCode?: string;
  ip?: string;
}

export interface LoginResult {
  token: string;
  sessionId: string;
  expiresAt: string;
  user: { id: string; email: string; fullName: string; locale: string };
  memberships: readonly {
    tenantId: string;
    tenantName: string;
    tenantNameAr: string | null;
    roleKey: string;
    roleName: string;
    roleNameAr: string | null;
    active: boolean;
  }[];
}

export interface LoginDeps {
  readonly clock?: Clock;
  readonly password: PasswordService;
  readonly sessions: SessionService;
  readonly audit: AuditService;
  readonly mfa: MfaService;
  /** Email the login notification (new-infrastructure signal). */
  readonly notifyLogin: (userId: string, email: string, locale: string) => Promise<void>;
}

export class LoginService {
  constructor(private readonly deps: LoginDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  private readonly clock: Clock;

  async login(input: LoginInput): Promise<LoginResult> {
    const ip = input.ip ?? "unknown";
    LOGIN_LIMITER.consume(`login:${ip}`);
    const email = input.email.trim().toLowerCase();

    const user = await store.findUserByEmail(email);
    if (user === undefined) {
      // Unknown email: same error shape as a wrong password (no oracle);
      // durable counters are user-scoped so there is nothing to bump yet —
      // the per-IP window above is the attacker's only observable budget.
      log.warn({ email_hash: hashForLog(email) }, "login attempt for unknown email");
      throw new InvalidCredentialsError();
    }

    if (user.lockedUntil !== null && Date.parse(user.lockedUntil) > this.clock.now().getTime()) {
      const remainingMs = Date.parse(user.lockedUntil) - this.clock.now().getTime();
      // Retry-After is whole seconds by contract: round UP (never retry
      // early) using exact integer arithmetic — no floating-point rounding
      // (ADR-0009 discipline applies to time bookkeeping the same way).
      const retryAfterSeconds = Math.max(1, (remainingMs + 999) / 1000 | 0);
      throw new AccountLockedError(retryAfterSeconds);
    }

    const passwordOk = await this.deps.password.verify(user.passwordHash, input.password);
    if (!passwordOk) {
      const failedCount = await store.markLoginFailure(user.id);
      await this.auditLoginFailed(user);
      if (failedCount >= LOCKOUT_THRESHOLD) {
        const lockedUntil = new Date(
          this.clock.now().getTime() + LOCKOUT_DURATION_MS,
        ).toISOString();
        await store.lockUser(user.id, lockedUntil);
        log.warn({ user_id: user.id }, "temporary lockout engaged (R-01)");
      }
      const delay = progressiveDelayMs(failedCount);
      if (delay > 0) {
        await this.clock.sleep(delay);
      }
      throw new InvalidCredentialsError();
    }

    // Credential proven — now the MFA gate and the tenant scope exist.
    const memberships = await store.membershipOptions(user.id);
    const activeOnes = memberships.filter(
      (m) => m.membershipStatus === "ACTIVE" && m.tenantStatus === "ACTIVE",
    );
    if (activeOnes.length === 0) {
      log.warn({ user_id: user.id }, "authenticated user has no active membership");
      throw new UnauthenticatedError();
    }
    const tenant = activeOnes[0]!;

    // PHASE-024 (ADR-0015 §4): policy-driven enforcement — resolve the
    // mandatory role keys for the login-selected tenant (plan list ∪/△ the
    // tenant override) BEFORE the factor check. A mandated role without a
    // confirmed factor is the enrollment bootstrap case (423 with
    // enrollmentRequired); a mandated role WITH a factor is the existing
    // code-challenge case.
    const requiredRoles = await withTenant(tenant.tenantId, async () => {
      const planKeys = await store.findPlanMfaRequiredRoleKeys(tenant.tenantId);
      const tenantPolicy = await readEffectiveSetting<MfaTenantPolicy>(
        "identity.mfa.policy",
      );
      return resolveMfaRequiredRoles({
        planRequiredRoleKeys: planKeys,
        tenantPolicy,
      });
    });
    const policyMandates = mfaRequiredForRole(tenant.roleKey, requiredRoles);

    const confirmed = (await store.findMfaFactorsForUser(user.id)).find(
      (factor) => factor.confirmedAt !== null,
    );
    if (confirmed === undefined && policyMandates) {
      // No factor yet + policy demands one: the user cannot produce a code.
      // The client exchanges credentials for the 15-minute enrollment
      // bootstrap session at POST /identity/mfa/bootstrap.
      log.info({ user_id: user.id }, "login refused: policy-mandated mfa enrollment required");
      throw new MfaRequiredError(true);
    }
    if (confirmed !== undefined) {
      if (input.mfaCode === undefined || input.mfaCode === "") {
        throw new MfaRequiredError();
      }
      const secret = openSecret(confirmed.secretEnc);
      const lastStep =
        confirmed.lastUsedAt !== null
          ? totpStepOf(Date.parse(confirmed.lastUsedAt))
          : undefined;
      const verification = verifyTotp(secret, input.mfaCode, this.clock.now().getTime(), lastStep);
      let codeOk = verification.valid;
      if (!codeOk) {
        // Recovery codes are the M-07 fallback at login: single-use,
        // hashed at rest, consumed atomically on success.
        codeOk = await this.deps.mfa.consumeRecoveryCode(user.id, input.mfaCode);
      }
      if (!codeOk) {
        // Replaying or wrong codes count as failures against the same
        // progressive-lockout counters (R-07 surface parity).
        const failedCount = await store.markLoginFailure(user.id);
        await this.auditLoginFailed(user);
        const delay = progressiveDelayMs(failedCount);
        if (delay > 0) {
          await this.clock.sleep(delay);
        }
        throw new MfaRequiredError();
      }
      await store.setMfaLastUsed(
        confirmed.id,
        timestepStartInstant(verification.matchedTimestep).toISOString(),
      );
    }

    // Issue inside the target tenant's scope: the session row + the audit
    // event share one transaction (withTenant UoW from PHASE-002).
    const issued = await withTenant(tenant.tenantId, async () => {
      const session = await this.deps.sessions.issue({
        userId: user.id,
        activeTenantId: tenant.tenantId,
        ip: input.ip,
      });
      await store.markLoginSuccess(user.id);
      await this.deps.audit.record({
        action: "user.login",
        entityType: "user",
        entityId: user.id,
        actorId: user.id,
        after: { ip: input.ip ?? null, session_id: session.sessionId },
      });
      return session;
    });

    LOGIN_LIMITER.reset(`login:${ip}`);
    await this.deps.notifyLogin(user.id, user.email, user.locale).catch((error: unknown) => {
      // Notification failure never blocks login (adapter resilience).
      log.warn({ err: error, user_id: user.id }, "login notification failed (non-blocking)");
    });

    return {
      token: issued.token,
      sessionId: issued.sessionId,
      expiresAt: issued.expiresAt,
      user: { id: user.id, email: user.email, fullName: user.fullName, locale: user.locale },
      memberships: activeOnes.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenantName,
        tenantNameAr: m.tenantNameAr,
        roleKey: m.roleKey,
        roleName: m.roleName,
        roleNameAr: m.roleNameAr,
        active: m.tenantId === tenant.tenantId,
      })),
    };
  }

  /** Tenant-scope the failed-attempt audit trail (unknown emails are log-only). */
  private async auditLoginFailed(user: store.UserRow): Promise<void> {
    try {
      const options = await store.membershipOptions(user.id);
      const target = options.find(
        (m) => m.membershipStatus === "ACTIVE" && m.tenantStatus === "ACTIVE",
      );
      if (target === undefined) {
        log.warn({ user_id: user.id }, "login_failed for user without active tenant — log-only");
        return;
      }
      await withTenant(target.tenantId, async () => {
        await this.deps.audit.record({
          action: "user.login_failed",
          entityType: "user",
          entityId: user.id,
          actorId: user.id,
          after: { failed_login_count: user.failedLoginCount + 1 },
        });
      });
      if (user.failedLoginCount + 1 >= LOCKOUT_THRESHOLD) {
        await withTenant(target.tenantId, async () => {
          await this.deps.audit.record({
            action: "user.locked",
            entityType: "user",
            entityId: user.id,
            actorId: user.id,
          });
        });
      }
    } catch (error) {
      log.warn({ err: error }, "login_failed audit write failed (non-blocking)");
    }
  }
}

/** Stable per-email log discriminator without storing raw addresses in logs. */
import { createHash } from "node:crypto";
function hashForLog(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 12);
}
