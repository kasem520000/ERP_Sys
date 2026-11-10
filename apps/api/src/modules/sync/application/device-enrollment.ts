import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";

import { AuditService } from "../../audit/api/audit";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";
import { DeviceNotFoundError } from "./device-registry-service";
import {
  DeviceRefreshInvalidError,
  DeviceRevokedError,
  issueAccessToken,
  issueRefreshToken,
} from "./device-tokens";

/**
 * PHASE-021 · the enrollment bootstrap exchange (T3; DR-P21-01 — MASTER-PLAN
 * §1 item 2, the ONLY server-side change of the phase; SECURITY_AND_DEVICE_MANAGEMENT
 * §2/§3; ADR-0015 §3; SYNC_PROTOCOL §1.4).
 *
 * PHASE-020 shipped register returning the one-time `enrollmentSecret`
 * (sha256 at rest in `devices.device_key_hash`) and `POST /devices/:id/refresh`,
 * which can only ROTATE an existing token — DR-P20-03 explicitly deferred the
 * first-refresh bootstrap for native enrollment to 021. This is that wiring:
 * verify the enrollment secret against the stored hash, CLEAR the hash
 * (one-time — migration 0032 made the column nullable for exactly this), and
 * mint the device's FIRST refresh token via `issueRefreshToken` (no
 * predecessor — the chain's root) plus a fresh 15-min access token.
 *
 * Failure taxonomy mirrors rotateRefreshToken exactly (no existence leaks, no
 * new error classes): unknown device → DeviceNotFoundError (the A7-parity
 * not-found shape the controller also uses); wrong secret, expired-proof
 * (hash already NULL) or a lost race on the conditional clear →
 * DeviceRefreshInvalidError — the SAME class refresh uses, so a wrong-secret
 * probe on an existing device is indistinguishable from an unknown device to
 * anyone without the row; revoked device → DeviceRevokedError (the kill
 * switch working, not theft — no reuse alarm, nothing to re-apply: unlike
 * refresh, the enroll path never revokes anything, so a withTenant rollback
 * cannot lose state).
 *
 * Runs entirely on the ambient `withTenant` unit of work (devices is
 * service-mediated — no RLS, the 016 terminal-enrollment pattern); the audit
 * row carries expiries only, never secret material (SECURITY §8).
 */

// -- audit (module-level singleton; same construction every spec uses) -----------

const audit = new AuditService(new DrizzleAuditStore());

/** The credential pair the enrollment exchange mints (the RefreshRotation
 * shape — field-for-field what POST /devices/:id/refresh returns, so the
 * native client treats bootstrap and rotation identically). */
export interface EnrollmentResult {
  /** The device's FIRST refresh token (30-day window, chain root). */
  refreshToken: string;
  /** A fresh 15-min device access token (HS256 JWT, memory-only client-side). */
  accessToken: string;
  /** The access token's expiry (the client schedules its next exchange). */
  expiresAt: string;
  /** The refresh token's 30-day absolute window (observability only). */
  refreshTokenExpiresAt: string;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Exchange the one-time enrollment secret for the device's first credential
 * pair (DR-P21-01). Rules, in order (mirroring rotateRefreshToken):
 * 1. device row missing → DeviceNotFoundError;
 * 2. device revoked → DeviceRevokedError (no new tokens after revocation);
 * 3. hash already NULL (proof consumed) → DeviceRefreshInvalidError — the
 *    same "invalid or already used" shape a wrong secret gets;
 * 4. conditional clear `UPDATE ... WHERE device_key_hash = sha256(secret)`
 *    hits 0 rows → wrong secret OR a concurrent double-spend (exactly one
 *    in-flight enrollment wins; the loser reads a NULL hash next time);
 * 5. otherwise: clear the hash, mint the chain-root refresh token + the
 *    access token, audit `device.enrolled`, return the pair.
 */
export async function enrollDeviceWithSecret(input: {
  deviceId: string;
  enrollmentSecret: string;
}): Promise<EnrollmentResult> {
  const tx = requireTenantContext().tx!;

  const found = await tx.execute(sql`
    SELECT user_id AS "userId", device_key_hash AS "deviceKeyHash",
           capabilities, revoked_at AS "revokedAt"
    FROM devices WHERE id = ${input.deviceId} LIMIT 1
  `);
  const device = found.rows[0] as
    | {
        userId: string;
        deviceKeyHash: string | null;
        capabilities: unknown;
        revokedAt: Date | null;
      }
    | undefined;
  if (device === undefined) {
    throw new DeviceNotFoundError(input.deviceId);
  }
  if (device.revokedAt !== null) {
    // The same guard + shape rotateRefreshToken uses — the kill switch is
    // working, not theft: no alarm, and (unlike the refresh reuse path)
    // nothing was revoked here, so a caller rollback loses nothing.
    throw new DeviceRevokedError(input.deviceId, "no new tokens are minted after revocation");
  }
  if (device.deviceKeyHash === null) {
    // The proof was already consumed — one-time by design; identical shape
    // to a wrong secret (no existence or state leak).
    throw new DeviceRefreshInvalidError("enrollment secret invalid or already used");
  }

  // Consume the one-time proof. The conditional UPDATE closes the
  // concurrent double-spend race (the rotateRefreshToken used_at pattern):
  // the hash rides the WHERE clause, so two in-flight enrollments with the
  // same secret — exactly one wins, the loser gets 0 rows here.
  const consumed = await tx.execute(sql`
    UPDATE devices
    SET device_key_hash = NULL, updated_at = now(), version = version + 1
    WHERE id = ${input.deviceId} AND device_key_hash = ${sha256Hex(input.enrollmentSecret)}
    RETURNING id
  `);
  if (consumed.rows.length === 0) {
    // Wrong secret, or the proof was consumed between our SELECT and here.
    throw new DeviceRefreshInvalidError("enrollment secret invalid or already used");
  }

  // Mint the chain root (no predecessor — this IS the first refresh token)
  // + the fresh access token, exactly as a rotation would.
  const refresh = await issueRefreshToken(tx, input.deviceId);
  const capabilities = Array.isArray(device.capabilities)
    ? (device.capabilities as string[])
    : undefined;
  const access = issueAccessToken({
    userId: device.userId,
    deviceId: input.deviceId,
    capabilities,
  });

  await audit.record({
    action: "device.enrolled",
    entityType: "device",
    entityId: input.deviceId,
    actorId: device.userId,
    deviceId: input.deviceId,
    // SECURITY §8: device + expiries only — never any secret material.
    after: { accessTokenExpiresAt: access.expiresAt, refreshTokenExpiresAt: refresh.expiresAt },
  });

  return {
    refreshToken: refresh.token,
    accessToken: access.token,
    expiresAt: access.expiresAt,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}
