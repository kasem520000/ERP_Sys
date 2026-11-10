import { createHash, createPublicKey, randomBytes, verify as ed25519Verify } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { DomainError, generateUuidV7 } from "@erp/domain-core";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { effectivePermissions } from "../../identity/api/identity";

/**
 * PHASE-020 · device registry service (T3; MASTER-PLAN §9;
 * SECURITY_AND_DEVICE_MANAGEMENT §1–§4; ADR-0015 §3).
 *
 * The generalized registry over the PHASE-003 `devices` table (widened by
 * migrations 0024 + 0029): registration with the enrollment-secret proof +
 * attestation-lite challenge, the admin trust plane (flag/expire), and the
 * revocation kill switch. `devices` stays service-mediated (PHASE-003 §4:
 * no tenant_id, no RLS) — every statement runs on the ambient `withTenant`
 * transaction like the 016 terminal enrollment, and the RLS'd sync-state
 * joins (sync_cursors, inbox_commands) ride the same tenant GUC.
 *
 * Attestation-lite (SECURITY §2.2): the server issues a 32-hex nonce at
 * registration when a public key is presented; the device signs the nonce
 * with its ed25519 private key and `attest` verifies the signature over the
 * nonce (UTF-8 bytes). A wrong signature is a typed retryable failure — the
 * nonce is NOT rotated (the device may retry); success flips
 * trust_flags.attested. The public key is stored base64 and accepted both as
 * raw 32-byte ed25519 material and as DER SPKI.
 */

// -- typed errors (pos-errors pattern; codes are stable contracts) -------------

/** Unknown device id — A7 parity: identical shape for unknown vs foreign ids. */
export class DeviceNotFoundError extends DomainError {
  constructor(deviceId: string) {
    super("DEVICE_NOT_FOUND", `device ${deviceId} is not registered`);
  }
}

/** Attest requested but the device carries no challenge substrate (no key
 * registered / no nonce issued / already attested). */
export class DeviceAttestationUnavailableError extends DomainError {
  constructor(deviceId: string, reason: string) {
    super(
      "DEVICE_ATTESTATION_UNAVAILABLE",
      `device ${deviceId} cannot attest: ${reason}`,
    );
  }
}

/** Signature verification failed — retryable; the nonce is NOT rotated. */
export class DeviceAttestationFailedError extends DomainError {
  constructor(deviceId: string) {
    super(
      "ATTESTATION_FAILED",
      `attestation signature rejected for device ${deviceId} — the nonce is not rotated, retry with a valid signature`,
    );
  }
}

/**
 * PHASE-022 T-P22-3-b · DR-P22-05a (2-b's Deviation 2 closed): the
 * personal-class partner link is refused — wrong device class, an
 * unknown/cross-tenant/non-customer/inactive partner, or a registering
 * identity that neither is a CONTACT of that partner nor holds the
 * devices admin plane. ONE typed shape for every refusal (no existence
 * or cross-tenant probing: the partner row is read under the ambient
 * tenant RLS, so a foreign id is indistinguishable from an unknown one).
 */
export class DevicePartnerLinkError extends DomainError {
  constructor(reason: string) {
    super(
      "DEVICE_PARTNER_LINK_FORBIDDEN",
      `linked partner refused: ${reason}`,
    );
  }
}

// -- platform mapping (devices.platform stays the 003 column; device_class is
// the 020 discriminator — MASTER-PLAN §3) --------------------------------------

const DEVICE_PLATFORMS = ["DESKTOP", "ANDROID", "pos-terminal"] as const;

const PLATFORM_BY_CLASS: Record<string, string> = {
  "pos-terminal": "pos-terminal",
  "tauri-desktop": "DESKTOP",
  "android-field": "ANDROID",
  "android-personal": "ANDROID",
};

/** Raw ed25519 (32-byte) keys are stored/transported without the SPKI
 * header; on verify they are re-wrapped with the fixed ed25519 prefix. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function importEd25519(storedBase64: string) {
  const raw = Buffer.from(storedBase64, "base64");
  const der = raw.length === 32 ? Buffer.concat([ED25519_SPKI_PREFIX, raw]) : raw;
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

// -- the service ----------------------------------------------------------------

@Injectable()
export class DeviceRegistryService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * Register a device (SECURITY §2). The enrollment secret is generated
   * server-side: 32 random bytes hex-encoded, stored ONLY as its SHA-256 in
   * `device_key_hash` (the 003/016 shape), returned ONCE in the result. It is
   * the enrollment proof — NOT the refresh token (the credential plane lives
   * in device-tokens.ts). Attestation nonce is issued only when a public key
   * is presented; platform attestation (best-effort, SECURITY §2.2) is
   * recorded in trust_flags as provided/absent.
   *
   * PHASE-022 T-P22-3-b · DR-P22-05a: `linkedPartnerId` — the personal-account
   * scope (devices.linked_partner_id, migration 0033; the pull service's
   * personal feeds key on it). Authorized server-side IN THIS TRANSACTION:
   * accepted for deviceClass "android-personal" ONLY, and the registering
   * identity must be linked to the partner — a partner_contacts row whose
   * email matches the identity's email (the customer-portal link) — or hold
   * the devices admin plane (`identity.devices.manage`). The partner must be
   * an ACTIVE CUSTOMER of the registering tenant (RLS-scoped read: a
   * cross-tenant id finds no row). The payload id is never trusted blind.
   */
  async register(input: {
    actorId: string;
    tenantId: string;
    deviceName: string;
    deviceClass: "pos-terminal" | "tauri-desktop" | "android-field" | "android-personal";
    platform?: string;
    platformVersion?: string;
    appVersion?: string;
    contractVersion?: string;
    deviceKeyPublic?: string;
    capabilities?: string[];
    platformAttestation?: string;
    linkedPartnerId?: string;
    /** The registering identity's email (the partner-contact link key;
     * absent only on legacy internal calls that never carry a link — a
     * missing email can never prove a contact link, so the admin plane
     * remains the only authorization path). */
    actorEmail?: string;
  }): Promise<{
    device: RegisteredDevice;
    attestationNonce: string | null;
    enrollmentSecret: string;
  }> {
    const tx = requireTenantContext().tx!;
    const platform =
      input.platform !== undefined &&
      (DEVICE_PLATFORMS as readonly string[]).includes(input.platform)
        ? input.platform
        : PLATFORM_BY_CLASS[input.deviceClass]!;

    // DR-P22-05a — the partner link: class gate + server-side authorization
    // (same unit of work as the INSERT; a refusal rolls back nothing because
    // nothing was written yet).
    let linkedPartnerId: string | null = null;
    let linkedPartnerAuthorizedBy: "contact" | "admin" | null = null;
    if (input.linkedPartnerId !== undefined) {
      if (input.deviceClass !== "android-personal") {
        throw new DevicePartnerLinkError(
          "only android-personal devices may carry a linked partner",
        );
      }
      // RLS-scoped (partners + partner_contacts are tenant tables; the
      // ambient withTenant GUC applies): a foreign/unknown partner id is
      // simply absent — the SAME typed refusal, no cross-tenant probing.
      // A missing actorEmail degrades to the empty string — it can never
      // match a contact row, so only the admin plane could authorize.
      const actorEmail = input.actorEmail ?? "";
      const found = await tx.execute(sql`
        SELECT p.id, p.kind, p.status,
          EXISTS (
            SELECT 1 FROM partner_contacts pc
             WHERE pc.partner_id = p.id
               AND pc.tenant_id = p.tenant_id
               AND lower(pc.email) = lower(${actorEmail})
               AND ${actorEmail} <> ''
          ) AS "isContact"
        FROM partners p
        WHERE p.id = ${input.linkedPartnerId}
        LIMIT 1
      `);
      const partner = found.rows[0] as
        | { id: string; kind: string; status: string; isContact: boolean }
        | undefined;
      if (
        partner === undefined ||
        partner.kind !== "CUSTOMER" ||
        partner.status !== "ACTIVE"
      ) {
        throw new DevicePartnerLinkError(
          "the partner is not an active customer of this tenant",
        );
      }
      const admin = (
        await effectivePermissions(input.actorId, input.tenantId)
      ).has("identity.devices.manage");
      if (!partner.isContact && !admin) {
        throw new DevicePartnerLinkError(
          "the registering identity is neither a contact of the partner nor a devices admin",
        );
      }
      linkedPartnerId = partner.id;
      linkedPartnerAuthorizedBy = partner.isContact ? "contact" : "admin";
    }

    const deviceId = generateUuidV7();
    // Enrollment proof: raw secret returned once, sha256 at rest (uq index).
    const enrollmentSecret = randomBytes(32).toString("hex");
    const keyHash = createHash("sha256").update(enrollmentSecret).digest("hex");
    const nonce =
      input.deviceKeyPublic !== undefined ? randomBytes(16).toString("hex") : null;
    const trustFlags = {
      platformAttestation: input.platformAttestation !== undefined ? "provided" : "absent",
    };
    const capabilitiesJson = input.capabilities ?? [];

    const inserted = await tx.execute(sql`
      INSERT INTO devices (
        id, user_id, platform, name, device_key_hash, capabilities, device_class,
        contract_version, attestation_public_key, attestation_nonce, trust_flags,
        last_seen_at, linked_partner_id
      ) VALUES (
        ${deviceId}, ${input.actorId}, ${platform}, ${input.deviceName}, ${keyHash},
        ${JSON.stringify(capabilitiesJson)}::jsonb, ${input.deviceClass},
        ${input.contractVersion ?? null}, ${input.deviceKeyPublic ?? null}, ${nonce},
        ${JSON.stringify(trustFlags)}::jsonb, now(), ${linkedPartnerId}
      )
      RETURNING id, user_id AS "userId", platform, name,
        device_class AS "deviceClass", contract_version AS "contractVersion",
        attestation_public_key AS "attestationPublicKey", attestation_nonce AS "attestationNonce",
        attested_at AS "attestedAt", trust_flags AS "trustFlags", revoked_at AS "revokedAt",
        data_expires_at AS "dataExpiresAt", last_seen_at AS "lastSeenAt",
        last_pull_at AS "lastPullAt", last_push_at AS "lastPushAt",
        capabilities AS "capabilities", created_at AS "createdAt"
    `);
    const device = inserted.rows[0] as unknown as RegisteredDevice;

    await this.audit.record({
      action: "device.registered",
      entityType: "device",
      entityId: deviceId,
      actorId: input.actorId,
      after: {
        tenantId: input.tenantId,
        deviceName: input.deviceName,
        deviceClass: input.deviceClass,
        platform,
        // Carried on the audit trail only — the devices table has no
        // platform_version/app_version columns (0029 widened everything the
        // registry needs; client build metadata lives here).
        platformVersion: input.platformVersion ?? null,
        appVersion: input.appVersion ?? null,
        contractVersion: input.contractVersion ?? null,
        capabilities: capabilitiesJson,
        attestationNonce: nonce,
        attestation: input.deviceKeyPublic !== undefined ? "challenge-issued" : "none",
        platformAttestation: trustFlags.platformAttestation,
        // DR-P22-05a: the authorized partner link rides the audit trail
        // (the authorization BASIS is recorded — contact vs admin plane).
        linkedPartnerId,
        linkedPartnerAuthorizedBy,
        // Key fingerprint only — never the key material (SECURITY §8).
        keyFingerprint:
          input.deviceKeyPublic !== undefined
            ? createHash("sha256").update(input.deviceKeyPublic).digest("hex").slice(0, 16)
            : null,
      },
    });

    return { device, attestationNonce: nonce, enrollmentSecret };
  }

  /**
   * Attest possession of the registered private key (SECURITY §2.2): verify
   * the ed25519 signature over the issued nonce. Wrong signature → typed
   * ATTESTATION_FAILED (retryable — the nonce is NOT rotated). Success sets
   * attested_at + trust_flags.attested. Already attested or no substrate →
   * typed unavailable (one-shot challenge; re-challenge is a 021 concern).
   */
  async attest(input: { deviceId: string; signature: string }): Promise<{
    attestedAt: Date;
    trustFlags: Record<string, unknown>;
  }> {
    const tx = requireTenantContext().tx!;
    const found = await tx.execute(sql`
      SELECT attestation_public_key AS "attestationPublicKey",
             attestation_nonce AS "attestationNonce",
             attested_at AS "attestedAt"
      FROM devices WHERE id = ${input.deviceId} LIMIT 1
    `);
    const device = found.rows[0] as
      | { attestationPublicKey: string | null; attestationNonce: string | null; attestedAt: Date | null }
      | undefined;
    if (device === undefined) {
      throw new DeviceNotFoundError(input.deviceId);
    }
    if (device.attestedAt !== null) {
      throw new DeviceAttestationUnavailableError(input.deviceId, "already attested");
    }
    if (device.attestationPublicKey === null || device.attestationNonce === null) {
      throw new DeviceAttestationUnavailableError(
        input.deviceId,
        "no public key / nonce was issued at registration",
      );
    }

    const publicKey = importEd25519(device.attestationPublicKey);
    const ok = ed25519Verify(
      null,
      Buffer.from(device.attestationNonce, "utf8"),
      publicKey,
      Buffer.from(input.signature, "base64"),
    );
    if (!ok) {
      // Retryable by design: the nonce stays as-is so the device can sign again.
      throw new DeviceAttestationFailedError(input.deviceId);
    }

    const updated = await tx.execute(sql`
      UPDATE devices
      SET attested_at = now(), updated_at = now(), version = version + 1,
          trust_flags = jsonb_set(trust_flags, '{attested}', 'true')
      WHERE id = ${input.deviceId}
      RETURNING attested_at AS "attestedAt", trust_flags AS "trustFlags"
    `);
    const row = updated.rows[0] as unknown as { attestedAt: Date; trustFlags: Record<string, unknown> };

    await this.audit.record({
      action: "device.attested",
      entityType: "device",
      entityId: input.deviceId,
      deviceId: input.deviceId,
      after: { attestedAt: row.attestedAt, trustFlags: row.trustFlags },
    });
    return { attestedAt: row.attestedAt, trustFlags: row.trustFlags };
  }

  /**
   * Revoke a device (SECURITY §4 — the kill switch): devices.revoked_at +
   * the whole refresh chain (device_refresh_tokens.revoked_at) + the push
   * tokens (device_push_tokens — PHASE-022 DR-P22-07a, cleared in the same
   * UoW). Idempotent — an already-revoked device is a no-op that returns
   * the existing timestamp (no second audit row). In-flight grace = the
   * ≤15-min access-token lifetime; no new tokens are minted afterwards
   * (device-tokens enforces).
   */
  async revoke(input: {
    deviceId: string;
    actorId: string;
    reason?: string;
    admin: boolean;
  }): Promise<{ revokedAt: Date }> {
    const tx = requireTenantContext().tx!;
    const found = await tx.execute(sql`
      SELECT revoked_at AS "revokedAt" FROM devices WHERE id = ${input.deviceId} LIMIT 1
    `);
    const device = found.rows[0] as { revokedAt: Date | null } | undefined;
    if (device === undefined) {
      throw new DeviceNotFoundError(input.deviceId);
    }
    if (device.revokedAt !== null) {
      return { revokedAt: device.revokedAt }; // idempotent no-op
    }

    const updated = await tx.execute(sql`
      UPDATE devices SET revoked_at = now(), updated_at = now(), version = version + 1
      WHERE id = ${input.deviceId} AND revoked_at IS NULL
      RETURNING revoked_at AS "revokedAt"
    `);
    const revokedAt = (updated.rows[0] as unknown as { revokedAt: Date }).revokedAt;

    // Kill the credential chain in the same UoW (no DELETE anywhere — the
    // chain history is the reuse audit trail; migration 0029 grants).
    await tx.execute(sql`
      UPDATE device_refresh_tokens SET revoked_at = now()
      WHERE device_id = ${input.deviceId} AND revoked_at IS NULL
    `);

    // PHASE-022 · DR-P22-07a: revocation clears the push tokens (the kill
    // switch is final — a cleared token is gone; the FK CASCADE only covers
    // device-row deletes, which never happen). Same UoW, same audit row.
    const clearedTokens = await tx.execute(sql`
      DELETE FROM device_push_tokens WHERE device_id = ${input.deviceId}
    `);

    await this.audit.record({
      action: "device.revoked",
      entityType: "device",
      entityId: input.deviceId,
      actorId: input.actorId,
      deviceId: input.deviceId,
      after: {
        reason: input.reason ?? null,
        admin: input.admin,
        revokedAt,
        pushTokensCleared: clearedTokens.rowCount ?? 0,
      },
    });
    return { revokedAt };
  }

  /** Merge trust flags (jsonb ||) — the admin plane (jailbreak/root posture,
   * SECURITY §7). Audited with the flag payload. */
  async flagTrust(input: {
    deviceId: string;
    actorId: string;
    flags: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const tx = requireTenantContext().tx!;
    const updated = await tx.execute(sql`
      UPDATE devices
      SET trust_flags = trust_flags || ${JSON.stringify(input.flags)}::jsonb,
          updated_at = now(), version = version + 1
      WHERE id = ${input.deviceId}
      RETURNING trust_flags AS "trustFlags"
    `);
    const row = updated.rows[0] as unknown as { trustFlags: Record<string, unknown> } | undefined;
    if (row === undefined) {
      throw new DeviceNotFoundError(input.deviceId);
    }
    await this.audit.record({
      action: "device.trust_flagged",
      entityType: "device",
      entityId: input.deviceId,
      actorId: input.actorId,
      deviceId: input.deviceId,
      after: { flags: input.flags, trustFlags: row.trustFlags },
    });
    return row.trustFlags;
  }

  /** Set the remote data-expiry watermark (the lost-device remote wipe
   * directive — SECURITY §6.2; sync-core refuses local reads past it, the
   * 021 consumer). */
  async expireData(input: {
    deviceId: string;
    actorId: string;
    expiresAt: string | null;
  }): Promise<{ dataExpiresAt: Date | null }> {
    const tx = requireTenantContext().tx!;
    const updated = await tx.execute(sql`
      UPDATE devices
      SET data_expires_at = ${input.expiresAt === null ? null : new Date(input.expiresAt)},
          updated_at = now(), version = version + 1
      WHERE id = ${input.deviceId}
      RETURNING data_expires_at AS "dataExpiresAt"
    `);
    const row = updated.rows[0] as unknown as { dataExpiresAt: Date | null } | undefined;
    if (row === undefined) {
      throw new DeviceNotFoundError(input.deviceId);
    }
    await this.audit.record({
      action: "device.data_expired",
      entityType: "device",
      entityId: input.deviceId,
      actorId: input.actorId,
      deviceId: input.deviceId,
      after: { dataExpiresAt: row.dataExpiresAt },
    });
    return { dataExpiresAt: row.dataExpiresAt };
  }

  /**
   * The registry table (web `/platform/devices`): devices of users with an
   * ACTIVE membership in the ambient tenant (devices is global and
   * service-mediated — the membership join is the only tenant boundary
   * available), joined with per-device sync state. sync_cursors and
   * inbox_commands are tenant-RLS'd so the aggregates run inside the same
   * tenant scope.
   */
  async list(_input: { tenantId: string }): Promise<DeviceListRow[]> {
    // The ambient tenant scope is authoritative (RLS filters the joins); the
    // tenantId param rides the signature for caller symmetry with the other
    // registry methods.
    const tx = requireTenantContext().tx!;
    const devices = await tx.execute(sql`
      SELECT d.id, d.name, d.platform, d.user_id AS "userId",
        d.device_class AS "deviceClass", d.contract_version AS "contractVersion",
        (d.attested_at IS NOT NULL) AS attested,
        d.trust_flags AS "trustFlags", d.revoked_at AS "revokedAt",
        d.data_expires_at AS "dataExpiresAt", d.last_seen_at AS "lastSeenAt",
        d.last_pull_at AS "lastPullAt", d.last_push_at AS "lastPushAt"
      FROM devices d
      JOIN memberships m ON m.user_id = d.user_id
      WHERE m.status = 'ACTIVE'
      ORDER BY d.created_at DESC
    `);
    const cursors = await tx.execute(sql`
      SELECT device_id AS "deviceId", count(*)::int AS entities, max(last_seq) AS "maxSeq"
      FROM sync_cursors GROUP BY device_id
    `);
    const inbox = await tx.execute(sql`
      SELECT device_id AS "deviceId", count(*)::int AS pending
      FROM inbox_commands GROUP BY device_id
    `);
    const cursorByDevice = new Map(
      (cursors.rows as unknown as { deviceId: string; entities: number }[]).map((r) => [r.deviceId, r.entities]),
    );
    const inboxByDevice = new Map(
      (inbox.rows as unknown as { deviceId: string; pending: number }[]).map((r) => [r.deviceId, r.pending]),
    );
    return (devices.rows as unknown as DeviceListRow[]).map((row) => ({
      ...row,
      cursorEntities: cursorByDevice.get(row.id) ?? 0,
      pendingCommands: inboxByDevice.get(row.id) ?? 0,
    }));
  }

  /** The detail view: the device row + its per-entity cursor state
   * (entity_type, last_seq, acknowledged_at — the drawer's sync state). */
  async get(input: { deviceId: string }): Promise<{
    device: DeviceDetailRow;
    cursors: { entityType: string; lastSeq: number; acknowledgedAt: Date | null }[];
  }> {
    const tx = requireTenantContext().tx!;
    const found = await tx.execute(sql`
      SELECT d.id, d.name, d.platform, d.user_id AS "userId",
        d.device_class AS "deviceClass", d.contract_version AS "contractVersion",
        d.attestation_public_key AS "attestationPublicKey", d.attestation_nonce AS "attestationNonce",
        d.attested_at AS "attestedAt", (d.attested_at IS NOT NULL) AS attested,
        d.trust_flags AS "trustFlags", d.revoked_at AS "revokedAt",
        d.data_expires_at AS "dataExpiresAt", d.last_seen_at AS "lastSeenAt",
        d.last_pull_at AS "lastPullAt", d.last_push_at AS "lastPushAt",
        d.capabilities AS "capabilities", d.created_at AS "createdAt"
      FROM devices d WHERE d.id = ${input.deviceId} LIMIT 1
    `);
    const device = found.rows[0] as unknown as DeviceDetailRow | undefined;
    if (device === undefined) {
      throw new DeviceNotFoundError(input.deviceId);
    }
    const cursors = await tx.execute(sql`
      SELECT entity_type AS "entityType", last_seq::int AS "lastSeq",
             acknowledged_at AS "acknowledgedAt"
      FROM sync_cursors WHERE device_id = ${input.deviceId} ORDER BY entity_type
    `);
    return {
      device,
      cursors: cursors.rows as unknown as {
        entityType: string;
        lastSeq: number;
        acknowledgedAt: Date | null;
      }[],
    };
  }

  /** Outbox-lag watermarks (MASTER-PLAN §12 gauges) — idempotent, no audit. */
  async touchPull(deviceId: string): Promise<void> {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`UPDATE devices SET last_pull_at = now() WHERE id = ${deviceId}`);
  }

  async touchPush(deviceId: string): Promise<void> {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`UPDATE devices SET last_push_at = now() WHERE id = ${deviceId}`);
  }
}

// -- row shapes ------------------------------------------------------------------

export interface RegisteredDevice {
  id: string;
  userId: string;
  platform: string;
  name: string;
  deviceClass: string;
  contractVersion: string | null;
  attestationPublicKey: string | null;
  attestationNonce: string | null;
  attestedAt: Date | null;
  trustFlags: Record<string, unknown>;
  revokedAt: Date | null;
  dataExpiresAt: Date | null;
  lastSeenAt: Date | null;
  lastPullAt: Date | null;
  lastPushAt: Date | null;
  capabilities: unknown;
  createdAt: Date;
}

export interface DeviceListRow {
  id: string;
  name: string | null;
  userId: string;
  platform: string;
  deviceClass: string | null;
  contractVersion: string | null;
  attested: boolean;
  trustFlags: Record<string, unknown>;
  revokedAt: Date | null;
  dataExpiresAt: Date | null;
  lastSeenAt: Date | null;
  lastPullAt: Date | null;
  lastPushAt: Date | null;
  cursorEntities: number;
  pendingCommands: number;
}

export interface DeviceDetailRow {
  id: string;
  name: string | null;
  userId: string;
  platform: string;
  deviceClass: string | null;
  contractVersion: string | null;
  attestationPublicKey: string | null;
  attestationNonce: string | null;
  attestedAt: Date | null;
  attested: boolean;
  trustFlags: Record<string, unknown>;
  revokedAt: Date | null;
  dataExpiresAt: Date | null;
  lastSeenAt: Date | null;
  lastPullAt: Date | null;
  lastPushAt: Date | null;
  capabilities: unknown;
  createdAt: Date;
}
