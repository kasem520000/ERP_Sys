import { sql } from "drizzle-orm";

import { DomainError, generateUuidV7 } from "@erp/domain-core";
import { createHash } from "node:crypto";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";
import { DeviceNotFoundError } from "./device-registry-service";

/**
 * PHASE-022 · DR-P22-07 — the device-token opt-in surface's storage (the
 * device-tokens.ts module-function precedent; migration
 * 0034_device_push_tokens.sql). One active row per device (uq device_id);
 * a token never belongs to two devices (uq token — typed conflict at the
 * surface, the constraint is the belt). opted_in defaults FALSE: tokens
 * are per-device, opt-in explicit (integrations §3.5).
 *
 * Writes ride the ambient withTenant transaction (the devices-controller
 * interceptor wraps guarded routes) — device_push_tokens is
 * service-mediated (the device_refresh_tokens pattern), so the tenant GUC
 * is bookkeeping, not a gate. The audit trail carries a token FINGERPRINT
 * only — never the raw token (the keyFingerprint precedent).
 */

// -- typed errors (the pos-errors pattern; codes are stable contracts) -----

/** The token is already registered to ANOTHER device (uq token collision). */
export class DevicePushTokenConflictError extends DomainError {
  constructor(tokenFingerprint: string) {
    super(
      "DEVICE_PUSH_TOKEN_CONFLICT",
      `push token ${tokenFingerprint}… is already registered to another device`,
    );
  }
}

/** The device is revoked — its push token can no longer change. */
export class DevicePushTokenRevokedError extends DomainError {
  constructor(deviceId: string) {
    super(
      "DEVICE_PUSH_TOKEN_REVOKED",
      `device ${deviceId} is revoked — its push token can no longer change`,
    );
  }
}

// -- the surface -------------------------------------------------------------

/** The device-tokens.ts precedent: a module-level audit instance (the same
 * tenant transaction as the write — audit.record rides the ambient tx). */
const audit = new AuditService(new DrizzleAuditStore());

export interface UpsertPushTokenInput {
  readonly deviceId: string;
  /** The FCM device token (20–512 chars; shape is never guessed further). */
  readonly token: string;
  /** The device's notification locale (default 'ar' — resolved before the
   * channel call). */
  readonly locale: "ar" | "en";
  /** Default FALSE — explicit opt-in (§3.5: opt-in per device). */
  readonly optIn: boolean;
  readonly actorId: string;
}

export interface UpsertPushTokenResult {
  readonly deviceId: string;
  readonly optedIn: boolean;
  readonly locale: "ar" | "en";
  readonly updatedAt: Date;
  readonly version: number;
}

export function pushTokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

/**
 * Upsert the device's push token (PUT /api/v1/devices/:id/push-token).
 * The platform column mirrors the device row's platform at registration
 * time; version bumps on every update (the opt-in toggling shape).
 */
export async function upsertPushToken(
  input: UpsertPushTokenInput,
): Promise<UpsertPushTokenResult> {
  const tx = requireTenantContext().tx!;

  // Revoked devices never change their token (the kill switch is final).
  const deviceRow = await tx.execute(sql`
    SELECT revoked_at AS "revokedAt" FROM devices WHERE id = ${input.deviceId} LIMIT 1
  `);
  const device = (deviceRow.rows as unknown as { revokedAt: Date | null }[])[0];
  if (device === undefined) {
    throw new DeviceNotFoundError(input.deviceId);
  }
  if (device.revokedAt !== null) {
    throw new DevicePushTokenRevokedError(input.deviceId);
  }

  // Cross-device collision (uq token is the belt for the race window).
  const collision = await tx.execute(sql`
    SELECT device_id AS "deviceId" FROM device_push_tokens
    WHERE token = ${input.token} AND device_id <> ${input.deviceId} LIMIT 1
  `);
  if ((collision.rows as unknown[])[0] !== undefined) {
    throw new DevicePushTokenConflictError(pushTokenFingerprint(input.token));
  }

  let saved: UpsertPushTokenResult;
  try {
    const rows = await tx.execute(sql`
      INSERT INTO device_push_tokens
        (id, created_at, updated_at, device_id, token, platform, opted_in, locale)
      VALUES (
        ${generateUuidV7()}, now(), now(), ${input.deviceId}, ${input.token},
        COALESCE((SELECT platform FROM devices WHERE id = ${input.deviceId}), 'ANDROID'),
        ${input.optIn}, ${input.locale}
      )
      ON CONFLICT (device_id) DO UPDATE
        SET token = EXCLUDED.token,
            platform = EXCLUDED.platform,
            opted_in = EXCLUDED.opted_in,
            locale = EXCLUDED.locale,
            updated_at = now(),
            version = device_push_tokens.version + 1
      RETURNING opted_in AS "optedIn", locale, updated_at AS "updatedAt", version
    `);
    const row = (rows.rows as unknown as Omit<UpsertPushTokenResult, "deviceId">[])[0];
    if (row === undefined) {
      // The uq(token) belt caught a race the pre-check missed.
      throw new DevicePushTokenConflictError(pushTokenFingerprint(input.token));
    }
    saved = { deviceId: input.deviceId, ...row };
  } catch (error) {
    if (error instanceof Error && /uq_device_push_tokens_token/.test(error.message)) {
      throw new DevicePushTokenConflictError(pushTokenFingerprint(input.token));
    }
    throw error;
  }

  await audit.record({
    action: "device.push_token_upserted",
    entityType: "device",
    entityId: input.deviceId,
    actorId: input.actorId,
    deviceId: input.deviceId,
    // Fingerprint only — never the raw token (the keyFingerprint precedent).
    after: {
      optedIn: input.optIn,
      locale: input.locale,
      tokenFingerprint: pushTokenFingerprint(input.token),
    },
  });
  return saved;
}

/**
 * Revocation clears the tokens (the devices kill switch): the DELETE lives
 * inside DeviceRegistryService.revoke's unit of work (same tx, same audit
 * row — the “no-token-registered / device-revoked” refusals the push
 * orchestrator reports are the read-side mirror of this clear).
 */
