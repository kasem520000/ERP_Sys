import { DomainError } from "@erp/domain-core";

/**
 * Identity error registry (ERROR_MODEL §4: module-scoped codes are
 * contracts). HTTP mapping happens in the exception filter:
 * INVALID_CREDENTIALS → 401, MFA_REQUIRED → 423, ACCOUNT_LOCKED → 401 with
 * details.retryAfterSeconds (indistinguishable from credential failure —
 * AUTHENTICATION §5.2), RATE_LIMITED → 429 + Retry-After.
 */

export class InvalidCredentialsError extends DomainError {
  constructor() {
    super("INVALID_CREDENTIALS", "email or password is incorrect");
  }
}

export class AccountLockedError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super("UNAUTHENTICATED", "email or password is incorrect", {
      retryAfterSeconds,
    });
  }
}

export class RateLimitedError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super("RATE_LIMITED", "too many attempts — retry later", {
      retryAfterSeconds,
    });
  }
}

export class MfaRequiredError extends DomainError {
  /**
   * PHASE-024 (ADR-0015 §4 policy enforcement): `enrollmentRequired = true`
   * when the login was refused because POLICY mandates MFA for the user's
   * role and they have no confirmed factor yet — the client routes them to
   * the enrollment bootstrap instead of prompting for a code they cannot
   * have.
   */
  constructor(readonly enrollmentRequired = false) {
    super("MFA_REQUIRED", "a verification code from your authenticator is required", {
      enrollmentRequired,
    });
  }
}

/**
 * PHASE-024: an enrollment-bootstrap session (mfa_gate_passed = false)
 * attempted a route outside the MFA enrollment allowlist. 423 per the
 * MfaRequiredError contract — the session exists but stays locked to the
 * enrollment surface until a valid TOTP confirmation flips the gate.
 */
export class MfaEnrollmentRequiredError extends DomainError {
  constructor() {
    super(
      "MFA_ENROLLMENT_REQUIRED",
      "multi-factor enrollment must be completed before this session can proceed",
    );
  }
}

/**
 * PHASE-024: the enrollment bootstrap was called by a user whose policy
 * does NOT mandate MFA (or who already has a confirmed factor) — the
 * restricted session is never handed to a user who could have a full one.
 * 409: the request conflicts with the account's current state.
 */
export class MfaBootstrapNotEligibleError extends DomainError {
  constructor() {
    super(
      "MFA_BOOTSTRAP_NOT_ELIGIBLE",
      "multi-factor enrollment bootstrap is only available when your organization requires it and no authenticator is set up",
    );
  }
}

export class UnauthenticatedError extends DomainError {
  constructor() {
    super("UNAUTHENTICATED", "authentication is required");
  }
}

export class ForbiddenError extends DomainError {
  constructor(readonly permissionKey: string) {
    super("FORBIDDEN", "you do not have permission to perform this action", {
      permissionKey,
    });
  }
}

export class SessionRevokedError extends DomainError {
  constructor() {
    super("UNAUTHENTICATED", "session is no longer valid");
  }
}

export class TenantSuspendedError extends DomainError {
  constructor() {
    super("TENANT_SUSPENDED", "tenant is suspended — contact the platform operator");
  }
}

export class InvalidTotpCodeError extends DomainError {
  constructor() {
    super("VALIDATION_ERROR", "the verification code is not valid");
  }
}

export class InvalidResetTokenError extends DomainError {
  constructor() {
    super("VALIDATION_ERROR", "the reset link is invalid or has expired");
  }
}

export class InvitationNotAcceptableError extends DomainError {
  constructor(readonly reason: "expired" | "revoked" | "accepted") {
    super("VALIDATION_ERROR", "this invitation is no longer acceptable", { reason });
  }
}

export class NotFoundError extends DomainError {
  constructor(readonly resource: string) {
    super("NOT_FOUND", `${resource} not found`);
  }
}

export class StaleVersionError extends DomainError {
  constructor() {
    super("STALE_VERSION", "the resource changed — reload and retry");
  }
}

export class TenantContextRequiredError extends DomainError {
  constructor() {
    super("FORBIDDEN", "an active tenant membership is required");
  }
}
