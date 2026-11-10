import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";

import { DomainError, generateUuidV7 } from "@erp/domain-core";

import { requireTenantContext, type TenantDb } from "../../../infra/db/tenant-context";

import { AuditService } from "../../audit/api/audit";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";
import { keyMaterialForTokens } from "../../identity/infrastructure/reset-token-key";

/**
 * PHASE-020 · the scoped device credential plane (T4; MASTER-PLAN §1.4/§9;
 * SECURITY_AND_DEVICE_MANAGEMENT §3–§4; ADR-0015 §3; SYNC_PROTOCOL §1.4).
 *
 * Two tokens, two lifetimes:
 * - Access token: a 15-min signed JWT with claims {sub, deviceId,
 *   capabilities}. There is NO pre-existing JWT machinery in the repo (the
 *   identity module issues opaque server-side session rows — ADR-0015 §2,
 *   "JWT never in browser"); native clients are the one plane that wants a
 *   self-contained bearer, so this mints a standard HS256 JWT signed with the
 *   identity module's `keyMaterialForTokens()` secret (the same envelope that
 *   signs reset links and sync cursors — one identity secret, three
 *   derivations). Verification is stateless via `verifyAccessToken`.
 * - Refresh token: a rotating one-time-use secret (32 random bytes,
 *   base64url) bound to the device; ONLY its SHA-256 is stored
 *   (`device_refresh_tokens.token_hash`, the sessions pattern from 0003).
 *   Every exchange marks the presented token `used_at` and mints a successor
 *   linked by `predecessor_id`. Presenting an already-used token is THEFT:
 *   the device is revoked, the whole chain dies, and the reuse alarm is
 *   audited (the M-05 kill switch). Chain history is never deleted — it IS
 *   the reuse audit trail (migration 0029 grants: no DELETE).
 *
 * All mutations run on the ambient `withTenant` transaction. NOTE for
 * callers: the reuse path throws AFTER revoking — if the caller's unit of
 * work rolls back on the throw (withTenant does), the revocation is lost;
 * `reapplyRefreshReuseRevocation` re-applies it idempotently in its own
 * committed scope (the DevicesController refresh route does exactly this).
 */

// -- typed errors ----------------------------------------------------------------

/** The presented refresh token is unknown, expired, or its chain is dead. */
export class DeviceRefreshInvalidError extends DomainError {
  constructor(message: string) {
    super("DEVICE_REFRESH_INVALID", message);
  }
}

/** Reuse of a rotated token (theft signal) or exchange on a revoked device —
 * the device is revoked either way; no new tokens are minted. */
export class DeviceRevokedError extends DomainError {
  constructor(deviceId: string, reason: string) {
    super("DEVICE_REVOKED", `device ${deviceId} is revoked — ${reason}`);
  }
}

// -- lifetimes -------------------------------------------------------------------

/** Access tokens live 15 minutes (ADR-0015 §3; SECURITY §3). */
export const ACCESS_TOKEN_TTL_SECONDS = 900;

/** Refresh tokens live 30 days absolute (rotation mints a fresh window). */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// -- hashing (the sessions pattern: sha256 hex at rest) ---------------------------

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// -- audit (module-level singleton; same construction every spec uses) -----------

const audit = new AuditService(new DrizzleAuditStore());

// -- access tokens (15-min HS256 JWT) ---------------------------------------------

export interface DeviceAccessTokenClaims {
  sub: string;
  deviceId: string;
  capabilities?: string[];
  iat: number;
  exp: number;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: string;
}

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/** Mint a 15-min device access token: standard three-segment HS256 JWT,
 * claims {sub, deviceId, capabilities?, iat, exp}. */
export function issueAccessToken(input: {
  userId: string;
  deviceId: string;
  capabilities?: string[];
}): IssuedAccessToken {
  const iat = (Date.now() / 1000) | 0; // ToInt32 unix seconds (login-service precedent)
  const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
  const payload: DeviceAccessTokenClaims = {
    sub: input.userId,
    deviceId: input.deviceId,
    ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
    iat,
    exp,
  };
  const encodedHeader = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const encodedPayload = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", keyMaterialForTokens())
    .update(signingInput)
    .digest("base64url");
  return {
    token: `${signingInput}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

/** Verify a device access token: signature (timing-safe) + expiry. Returns
 * undefined on any tamper/shape/expiry failure — never throws (the sync data
 * plane maps that to its DEVICE_REVOKED / UNAUTHENTICATED shapes). */
export function verifyAccessToken(token: string): DeviceAccessTokenClaims | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];
  const expected = createHmac("sha256", keyMaterialForTokens())
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  const given = Buffer.from(signature, "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return undefined;
  }
  let claims: DeviceAccessTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as DeviceAccessTokenClaims;
  } catch {
    return undefined;
  }
  if (typeof claims.sub !== "string" || typeof claims.deviceId !== "string") {
    return undefined;
  }
  if (typeof claims.exp !== "number" || claims.exp <= ((Date.now() / 1000) | 0)) {
    return undefined;
  }
  return claims;
}

// -- refresh tokens (rotating one-time-use chain) ----------------------------------

export interface IssuedRefreshToken {
  token: string;
  expiresAt: string;
}

/**
 * Mint a refresh token for the device: raw 32-byte url-safe secret returned
 * ONCE, sha256 at rest, 30-day absolute expiry. `predecessorId` links a
 * rotation successor to its consumed predecessor (the chain audit trail).
 */
export async function issueRefreshToken(
  tx: TenantDb,
  deviceId: string,
  predecessorId?: string,
): Promise<IssuedRefreshToken> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
  await tx.execute(sql`
    INSERT INTO device_refresh_tokens (id, device_id, token_hash, predecessor_id, expires_at)
    VALUES (${generateUuidV7()}, ${deviceId}, ${sha256Hex(token)}, ${predecessorId ?? null}, ${expiresAt})
  `);
  return { token, expiresAt };
}

export interface RefreshRotation {
  accessToken: string;
  refreshToken: string;
  /** The 15-min access-token expiry — the client schedules its next
   * exchange against this (SECURITY §3 table). */
  expiresAt: string;
  /** The successor refresh token's 30-day absolute window (server-side
   * concern; carried for observability). */
  refreshTokenExpiresAt: string;
}

/**
 * Exchange a refresh token for a fresh pair (SYNC_PROTOCOL §1.4). Rules, in
 * order (MASTER-PLAN §9):
 * 1. hash lookup misses or the row is expired → typed invalid;
 * 2. the row was already used → REUSE: revoke the device + kill the whole
 *    chain + audit `device.refresh_token_reuse_detected` (M-05) + throw
 *    DeviceRevokedError;
 * 3. the row (chain) is revoked → typed invalid;
 * 4. the device row itself is revoked → DeviceRevokedError (no alarm — that
 *    is the kill switch working, not theft);
 * 5. otherwise: mark used_at, mint the successor (predecessor_id chain),
 *    audit `device.token_rotated` (no secret material), return the pair +
 *    a fresh 15-min access token.
 *
 * Runs entirely on the ambient transaction. See the header note about the
 * throw-vs-rollback interplay on the reuse path.
 */
export async function rotateRefreshToken(input: {
  deviceId: string;
  token: string;
}): Promise<RefreshRotation> {
  const tx = requireTenantContext().tx!;

  const found = await tx.execute(sql`
    SELECT id, device_id AS "deviceId", expires_at AS "expiresAt", used_at AS "usedAt",
           revoked_at AS "revokedAt"
    FROM device_refresh_tokens
    WHERE token_hash = ${sha256Hex(input.token)}
    LIMIT 1
  `);
  const row = found.rows[0] as
    | { id: string; deviceId: string; expiresAt: string; usedAt: Date | null; revokedAt: Date | null }
    | undefined;
  if (row === undefined) {
    throw new DeviceRefreshInvalidError("refresh token not recognized");
  }
  if (Date.parse(row.expiresAt) <= Date.now()) {
    throw new DeviceRefreshInvalidError("refresh token expired");
  }
  if (row.usedAt !== null) {
    // REUSE of a rotated token — the theft signal. Kill switch fires NOW.
    await revokeForRefreshReuse(tx, input.deviceId);
    throw new DeviceRevokedError(
      input.deviceId,
      "refresh-token reuse detected — the device was revoked and the reuse was audited",
    );
  }
  if (row.revokedAt !== null) {
    throw new DeviceRefreshInvalidError("the refresh chain was revoked (device revoked or reuse kill switch)");
  }

  // The device row gates minting (belt & braces — revoke() also kills the
  // chain, this covers a device revoked without its chain).
  const deviceRows = await tx.execute(sql`
    SELECT user_id AS "userId", capabilities, revoked_at AS "revokedAt"
    FROM devices WHERE id = ${row.deviceId} LIMIT 1
  `);
  const device = deviceRows.rows[0] as
    | { userId: string; capabilities: unknown; revokedAt: Date | null }
    | undefined;
  if (device === undefined) {
    throw new DeviceRefreshInvalidError("device row missing for the refresh chain");
  }
  if (device.revokedAt !== null) {
    throw new DeviceRevokedError(input.deviceId, "no new tokens are minted after revocation");
  }

  // Consume the presented token. The conditional UPDATE closes the
  // concurrent double-spend race: two in-flight requests presenting the same
  // token — exactly one wins, the loser reads a used row next time; if the
  // row was consumed between our SELECT and here, this is reuse too.
  const consumed = await tx.execute(sql`
    UPDATE device_refresh_tokens SET used_at = now()
    WHERE id = ${row.id} AND used_at IS NULL
    RETURNING id
  `);
  if (consumed.rows.length === 0) {
    await revokeForRefreshReuse(tx, input.deviceId);
    throw new DeviceRevokedError(
      input.deviceId,
      "refresh-token reuse detected — the device was revoked and the reuse was audited",
    );
  }

  // Mint the successor + the fresh access token.
  const successor = await issueRefreshToken(tx, row.deviceId, row.id);
  const capabilities = Array.isArray(device.capabilities)
    ? (device.capabilities as string[])
    : undefined;
  const access = issueAccessToken({
    userId: device.userId,
    deviceId: row.deviceId,
    capabilities,
  });

  await audit.record({
    action: "device.token_rotated",
    entityType: "device",
    entityId: row.deviceId,
    actorId: device.userId,
    deviceId: row.deviceId,
    // SECURITY §8: device, timestamp — never any secret material.
    after: { accessTokenExpiresAt: access.expiresAt, refreshTokenExpiresAt: successor.expiresAt },
  });

  return {
    accessToken: access.token,
    refreshToken: successor.token,
    expiresAt: access.expiresAt,
    refreshTokenExpiresAt: successor.expiresAt,
  };
}

/**
 * The reuse kill switch, shared by the in-rotation path and the controller's
 * post-rollback re-apply: revoke the device, revoke the whole chain, audit
 * the alarm. Idempotent — when the device was already revoked this is a
 * no-op that skips the audit (no duplicate alarms).
 */
async function revokeForRefreshReuse(tx: TenantDb, deviceId: string): Promise<void> {
  const updated = await tx.execute(sql`
    UPDATE devices SET revoked_at = now(), updated_at = now(), version = version + 1
    WHERE id = ${deviceId} AND revoked_at IS NULL
    RETURNING revoked_at AS "revokedAt", user_id AS "userId"
  `);
  if (updated.rows.length === 0) {
    return; // already revoked — idempotent, no double alarm
  }
  const { revokedAt, userId } = updated.rows[0] as unknown as { revokedAt: Date; userId: string };
  await tx.execute(sql`
    UPDATE device_refresh_tokens SET revoked_at = now()
    WHERE device_id = ${deviceId} AND revoked_at IS NULL
  `);
  await audit.record({
    action: "device.refresh_token_reuse_detected",
    entityType: "device",
    entityId: deviceId,
    actorId: userId,
    deviceId,
    after: { deviceId, reuseDetectedAt: revokedAt, revoked: true },
  });
}

/**
 * Re-apply the reuse revocation in its own committed scope. `withTenant`
 * rolls the whole unit of work back when `rotateRefreshToken` throws
 * DeviceRevokedError — without this the kill switch would be lost with the
 * rollback. Safe to call repeatedly: it no-ops once the device is revoked.
 */
export async function reapplyRefreshReuseRevocation(input: { deviceId: string }): Promise<void> {
  const tx = requireTenantContext().tx!;
  await revokeForRefreshReuse(tx, input.deviceId);
}
