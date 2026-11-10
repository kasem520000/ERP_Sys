import { randomBytes } from "node:crypto";

import { Inject } from "@nestjs/common";

import { childLogger } from "../../../infra/observability/logger";
import { withTenant } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import {
  InvalidTotpCodeError,
  NotFoundError,
} from "../domain/identity-errors";
import { currentTimestep, generateTotpSecret, otpauthUri, timestepStartInstant, verifyTotp } from "../domain/totp";
import { hashToken, tokenHashesMatch } from "../domain/tokens";
import { openSecret, sealSecret } from "../infrastructure/secret-envelope";
import * as store from "../infrastructure/identity.store";

/**
 * TOTP MFA service (ADR-0015 §4; AUTHENTICATION §3): enrollment starts
 * PENDING (secret encrypted, returned ONCE for the QR), `confirmed_at` is
 * set only after a valid code (acceptance 3); codes are one-time-use
 * (timestep tracking, M-06); recovery codes are hashed single-use (M-07)
 * with regeneration. User-enableable now; policy-mandatory arrives later.
 */

const log = childLogger({ module: "identity" });

const TOTP_ISSUER = "Universal Business ERP";

export interface EnrollmentResult {
  factorId: string;
  secret: string;
  otpauth: string;
}

export class MfaService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * Start (or restart) enrollment: clears stale PENDING factors, stores the
   * sealed secret, and returns the plaintext secret exactly once for the
   * authenticator QR.
   */
  async enroll(userId: string): Promise<EnrollmentResult> {
    await store.clearPendingMfaFactors(userId);
    const secret = generateTotpSecret();
    const row = await store.insertMfaFactor({
      userId,
      secretEnc: sealSecret(secret),
    });
    const user = await store.findUserById(userId);
    return {
      factorId: row.id,
      secret,
      otpauth: otpauthUri(secret, user?.email ?? userId, TOTP_ISSUER),
    };
  }

  /** Confirm enrollment with a valid code → factor becomes ACTIVE. */
  async verify(userId: string, code: string): Promise<void> {
    const factor = (await store.findMfaFactorsForUser(userId)).find(
      (f) => f.confirmedAt === null,
    );
    if (factor === undefined) {
      throw new NotFoundError("pending mfa enrollment");
    }
    const secret = openSecret(factor.secretEnc);
    const verification = verifyTotp(secret, code, Date.now());
    if (!verification.valid) {
      throw new InvalidTotpCodeError();
    }
    const at = timestepStartInstant(verification.matchedTimestep).toISOString();
    await store.confirmMfaFactor(factor.id, at);
    // PHASE-024: the proof happened — every live enrollment-bootstrap
    // session of this user unlocks together (passMfaGateForUser touches
    // only gated, non-revoked sessions).
    await store.passMfaGateForUser(userId);
    const memberships = await store.membershipOptions(userId);
    const target = memberships.find(
      (m) => m.membershipStatus === "ACTIVE" && m.tenantStatus === "ACTIVE",
    );
    if (target !== undefined) {
      await withTenant(target.tenantId, async () => {
        await this.audit.record({
          action: "mfa.enrolled",
          entityType: "mfa_factor",
          entityId: factor.id,
          actorId: userId,
        });
      });
    }
  }

  /** (Re)generate single-use recovery codes — returned once, hashed at rest. */
  async regenerateRecoveryCodes(userId: string): Promise<string[]> {
    const factor = (await store.findMfaFactorsForUser(userId)).find(
      (f) => f.confirmedAt !== null,
    );
    if (factor === undefined) {
      throw new NotFoundError("confirmed mfa factor");
    }
    const codes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex"));
    await store.setRecoveryCodes(factor.id, codes.map((code) => hashToken(code)));
    return codes;
  }

  /**
   * Verify a login recovery code (single-use): matching hash consumes the
   * slot. Timing-safe compare against each stored hash (small, fixed set).
   */
  async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const factor = (await store.findMfaFactorsForUser(userId)).find(
      (f) => f.confirmedAt !== null,
    );
    if (factor === undefined || factor.recoveryCodesHash === null) {
      return false;
    }
    const index = factor.recoveryCodesHash.findIndex((stored) =>
      tokenHashesMatch(stored, hashToken(code)),
    );
    if (index === -1) {
      return false;
    }
    const remaining = factor.recoveryCodesHash.filter((_, i) => i !== index);
    await store.setRecoveryCodes(factor.id, remaining);
    return true;
  }

  /** Disable MFA (requires a valid code — matches AUTHENTICATION §3 DELETE). */
  async disable(userId: string, code: string): Promise<void> {
    const factor = (await store.findMfaFactorsForUser(userId)).find(
      (f) => f.confirmedAt !== null,
    );
    if (factor === undefined) {
      throw new NotFoundError("confirmed mfa factor");
    }
    const secret = openSecret(factor.secretEnc);
    const lastStep =
      factor.lastUsedAt !== null
        ? currentTimestep(Date.parse(factor.lastUsedAt))
        : undefined;
    const verification = verifyTotp(secret, code, Date.now(), lastStep);
    const ok =
      verification.valid ||
      (await this.consumeRecoveryCode(userId, code));
    if (!ok) {
      throw new InvalidTotpCodeError();
    }
    await store.removeMfaFactor(factor.id);
    log.info({ user_id: userId }, "mfa factor disabled");
  }

  /**
   * Admin-assisted MFA reset (PHASE-024 T4; SECRETS_MANAGEMENT §3 S-05
   * emergency column; the seeded `identity.mfa.admin_reset` permission's
   * first route): removes EVERY factor of the target — confirmed AND
   * pending — so a locked-out user starts clean. The caller supplies the
   * acting admin (audited as the actor; the target rides entityId). If a
   * policy still mandates MFA for the target, their next login goes the
   * enrollment-bootstrap path — surfaced honestly in the result.
   */
  async adminReset(input: {
    adminId: string;
    targetUserId: string;
    tenantId: string;
  }): Promise<{ factorsRemoved: number }> {
    const target = await store.findUserById(input.targetUserId);
    if (target === undefined) {
      throw new NotFoundError("user");
    }
    const factorsRemoved = await store.clearMfaFactorsForUser(input.targetUserId);
    await withTenant(input.tenantId, async () => {
      await this.audit.record({
        action: "mfa.admin_reset",
        entityType: "user",
        entityId: input.targetUserId,
        actorId: input.adminId,
        after: { factors_removed: factorsRemoved },
      });
    });
    log.warn(
      { admin_id: input.adminId, target_user_id: input.targetUserId, factors_removed: factorsRemoved },
      "admin-assisted mfa reset",
    );
    return { factorsRemoved };
  }
}
