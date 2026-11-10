import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { createHash, generateKeyPairSync, sign as ed25519Sign, type KeyObject } from "node:crypto";

import { generateUuidV7 } from "@erp/domain-core";
import { sql } from "drizzle-orm";

import { SYNC_CONTRACT_VERSION } from "@erp/contracts";

import { appClient, ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { DeviceRegistryService } from "../../modules/sync/application/device-registry-service";
import {
  DeviceAttestationFailedError,
  DeviceAttestationUnavailableError,
  DeviceNotFoundError,
} from "../../modules/sync/application/device-registry-service";
import {
  DeviceRefreshInvalidError,
  DeviceRevokedError,
  issueRefreshToken,
  rotateRefreshToken,
  verifyAccessToken,
} from "../../modules/sync/application/device-tokens";
import { ReconciliationService } from "../../modules/sync/application/reconciliation-service";
import { DevicesController } from "../../modules/sync/presentation/devices.controller";

/**
 * PHASE-020 T2-c db evidence (MASTER-PLAN §9; SECURITY_AND_DEVICE_MANAGEMENT
 * §1–§4; ADR-0015 §3): the device registry + credential plane —
 *
 * 1. registration: the devices row (class → platform mapping, trust flags,
 *    attestation nonce, sha256-at-rest enrollment secret) + audit;
 * 2. attestation-lite round-trip (ed25519 over the nonce, DER + raw key
 *    import paths, retryable wrong signature — nonce NOT rotated);
 * 3. refresh rotation: happy chain (predecessor_id), then REUSE of the
 *    rotated token → device revoked + reuse alarm + chain dead (M-05);
 * 4. expired token → typed invalid, device NOT revoked;
 * 5. revoke: kill switch + idempotent second revoke + chain death;
 * 6. flagTrust/expireData (the admin plane);
 * 7. list/get with per-device cursor state + touch watermarks;
 * 8. reconciliation: the queue journey (revoke → pending ops → reassign
 *    drafts → dismiss — "close the queue to zero");
 * 9. the PUBLIC refresh route's tenant derivation + the reuse kill switch
 *    surviving the failure response (withTenant rollback re-apply).
 *
 * Dedicated tenant 23232323 (SAR), verified unused across the repo. Device
 * ids are generated per run (never fixed). Typed failures are asserted
 * INSIDE the withTenant scope so the unit of work still commits — the reuse
 * revocation must persist past the throw.
 */

const TENANT_DEVICES = "23232323-2323-2323-2323-232323232323";
const ADMIN = "23232323-0000-4000-8000-000000004001";
const USER2 = "23232323-0000-4000-8000-000000004002";

const audit = new AuditService(new DrizzleAuditStore());
const registry = new DeviceRegistryService(audit);
const reconciliation = new ReconciliationService(audit);
const controller = new DevicesController(registry);

/** The tenant-scoped app client (RLS world) for read assertions. */
async function tenantClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_DEVICES]);
  return client;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function ed25519KeyMaterial() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return {
    privateKey,
    derBase64: der.toString("base64"),
    rawBase64: der.subarray(12).toString("base64"), // strip the 12-byte SPKI header
  };
}

function signNonce(nonce: string, privateKey: KeyObject): string {
  return ed25519Sign(null, Buffer.from(nonce, "utf8"), privateKey).toString("base64");
}

async function auditEvents(
  action: string,
  entityId?: string,
): Promise<{ entityId: string; actorId: string | null; after: Record<string, unknown> | null }[]> {
  const client = await tenantClient();
  const result = await client.query(
    `SELECT entity_id AS "entityId", actor_id AS "actorId", after
       FROM audit_events
      WHERE tenant_id = $1 AND action = $2 AND ($3::uuid IS NULL OR entity_id = $3)
      ORDER BY at`,
    [TENANT_DEVICES, action, entityId ?? null],
  );
  await client.end();
  return result.rows.map((row) => ({
    entityId: row.entityId,
    actorId: row.actorId,
    after: row.after === null ? null : (JSON.parse(JSON.stringify(row.after)) as Record<string, unknown>),
  }));
}

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'T2323 Devices (sync)', 'مستأجر الأجهزة', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_DEVICES],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'dev-admin@fixture.test', 'Devices Admin', 'x', 'ACTIVE'),
       ($2, 'dev-user@fixture.test', 'Devices Second User', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ADMIN, USER2],
  );
  // One tenant role cloned from the system `owner` template — the 0005
  // cross-join already grants it every non-platform key, including
  // sync.devices.register/revoke + identity.devices.manage (no manual grants).
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'devices_owner', 'Devices Owner', 'مالك الأجهزة', false)
     ON CONFLICT (id) DO NOTHING`,
    [roleId, TENANT_DEVICES],
  );
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner' LIMIT 1`,
  );
  if (template.rows[0] !== undefined) {
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp
        WHERE rp.role_id = $3
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, TENANT_DEVICES, template.rows[0].id],
    );
  }
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [generateUuidV7(), TENANT_DEVICES, ADMIN, roleId],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [generateUuidV7(), TENANT_DEVICES, USER2, roleId],
  );
  // The sales-invoice FK targets for the reassignment fixture (§8).
  await su.query(
    `INSERT INTO branches (id, tenant_id, code, name) VALUES ($1, $2, 'MAIN', 'Main branch')
     ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_DEVICES],
  );
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES ($1, $2, 'CUSTOMER', 'DEV-0001', 'Devices Fixture Customer')
     ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_DEVICES],
  );
  await su.end();
});

afterAll(async () => {
  await closeDb();
});

describe("device registry + credentials (MASTER-PLAN §9)", () => {
  let derDeviceId: string; // test 2 — the DER-key attestation device
  let derPrivateKey: KeyObject; // the fixture key that registered it (test 1)
  let rotationDeviceId: string; // test 3 — the rotation/reuse device
  let revokedDeviceId: string; // test 5 — the revoke device
  let adminDeviceId: string; // test 6 — the flag/expire device
  let cursorDeviceId: string; // test 7 — the list/get device
  let lostDeviceId: string; // test 8 — the reconciliation device A
  let takeoverDeviceId: string; // test 8 — device B (drafts takeover)
  let controllerDeviceId: string; // test 9 — the controller refresh device
  let branchId = "";
  let partnerId = "";
  let draftInvoiceId = "";
  let approvedInvoiceId = "";

  it("register: the devices row (class→platform, trust flags, nonce) + sha256-at-rest enrollment secret + audit", async () => {
    const key = ed25519KeyMaterial();
    derPrivateKey = key.privateKey;
    const result = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Van tablet 1",
        deviceClass: "android-field",
        platformVersion: "14",
        appVersion: "1.2.0",
        contractVersion: SYNC_CONTRACT_VERSION,
        deviceKeyPublic: key.derBase64,
        capabilities: ["pos"],
        platformAttestation: "play-integrity:valid",
      }),
    );
    derDeviceId = result.device.id;

    expect(result.device.deviceClass).toBe("android-field");
    expect(result.device.platform).toBe("ANDROID"); // mapped from the class (platform absent)
    expect(result.device.contractVersion).toBe(SYNC_CONTRACT_VERSION);
    expect(result.device.trustFlags).toEqual({ platformAttestation: "provided" });
    expect(result.attestationNonce).toMatch(/^[0-9a-f]{32}$/);
    expect(result.enrollmentSecret).toMatch(/^[0-9a-f]{64}$/);

    // The RLS-world row: sha256 at rest (the sessions pattern), UQ key hash.
    const client = await tenantClient();
    const rows = await client.query<{
      device_key_hash: string;
      attestation_public_key: string | null;
      attestation_nonce: string | null;
      attested_at: Date | null;
      revoked_at: Date | null;
      trust_flags: { platformAttestation: string };
      capabilities: unknown;
    }>(
      `SELECT device_key_hash, attestation_public_key, attestation_nonce, attested_at,
              revoked_at, trust_flags, capabilities
         FROM devices WHERE id = $1`,
      [derDeviceId],
    );
    await client.end();
    expect(rows.rows).toHaveLength(1);
    const row = rows.rows[0]!;
    expect(row.device_key_hash).toBe(sha256Hex(result.enrollmentSecret));
    expect(row.attestation_public_key).toBe(key.derBase64);
    expect(row.attestation_nonce).toBe(result.attestationNonce);
    expect(row.attested_at).toBeNull();
    expect(row.revoked_at).toBeNull();
    expect(row.trust_flags.platformAttestation).toBe("provided");
    expect(row.capabilities).toEqual(["pos"]);

    const events = await auditEvents("device.registered", derDeviceId);
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBe(ADMIN);
    expect(events[0]!.after).toMatchObject({
      deviceClass: "android-field",
      platform: "ANDROID",
      contractVersion: SYNC_CONTRACT_VERSION,
      attestationNonce: result.attestationNonce,
      platformAttestation: "provided",
    });

    // Explicit platform wins over the class mapping; pos-terminal maps to the
    // third 003/024 CHECK value.
    const explicit = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Boss desktop",
        deviceClass: "android-personal",
        platform: "DESKTOP",
      }),
    );
    expect(explicit.device.platform).toBe("DESKTOP");
    const posTerminal = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Cash desk 1",
        deviceClass: "pos-terminal",
      }),
    );
    expect(posTerminal.device.platform).toBe("pos-terminal");
    expect(posTerminal.attestationNonce).toBeNull(); // no key → no challenge
    expect(posTerminal.device.trustFlags).toEqual({ platformAttestation: "absent" });
  });

  it("attestation-lite: ed25519 round-trip (DER + raw import), retryable failure, no-substrate typed error", async () => {
    const client = await tenantClient();
    const stored = await client.query<{ attestation_nonce: string; attestation_public_key: string }>(
      `SELECT attestation_nonce, attestation_public_key FROM devices WHERE id = $1`,
      [derDeviceId],
    );
    const nonce = stored.rows[0]!.attestation_nonce;

    // 1. Wrong signature (a different keypair signs): typed failure, attested_at
    //    stays null, the nonce is NOT rotated.
    const otherKey = ed25519KeyMaterial();
    const forged = signNonce(nonce, otherKey.privateKey);
    await withTenant(TENANT_DEVICES, async () => {
      await expect(
        registry.attest({ deviceId: derDeviceId, signature: forged }),
      ).rejects.toBeInstanceOf(DeviceAttestationFailedError);
    });
    const afterFail = await client.query<{ attested_at: Date | null; attestation_nonce: string }>(
      `SELECT attested_at, attestation_nonce FROM devices WHERE id = $1`,
      [derDeviceId],
    );
    expect(afterFail.rows[0]!.attested_at).toBeNull();
    expect(afterFail.rows[0]!.attestation_nonce).toBe(nonce); // retryable — not rotated

    // 2. The correct signature through the DER path → attested + audited.
    const attested = await withTenant(TENANT_DEVICES, () =>
      registry.attest({ deviceId: derDeviceId, signature: signNonce(nonce, derPrivateKey) }),
    );
    expect(attested.attestedAt).not.toBeNull();
    expect(attested.trustFlags).toMatchObject({ attested: true, platformAttestation: "provided" });
    const attestedEvents = await auditEvents("device.attested", derDeviceId);
    expect(attestedEvents).toHaveLength(1);

    // 3. Re-attest (already attested) → typed unavailable — one-shot challenge.
    await withTenant(TENANT_DEVICES, async () => {
      await expect(
        registry.attest({ deviceId: derDeviceId, signature: signNonce(nonce, derPrivateKey) }),
      ).rejects.toBeInstanceOf(DeviceAttestationUnavailableError);
    });

    // 4. The raw 32-byte import path: a second device registered with the
    //    stripped key material signs successfully.
    const rawKey = ed25519KeyMaterial();
    const rawDevice = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Raw key device",
        deviceClass: "tauri-desktop",
        deviceKeyPublic: rawKey.rawBase64,
      }),
    );
    const rawResult = await withTenant(TENANT_DEVICES, () =>
      registry.attest({
        deviceId: rawDevice.device.id,
        signature: signNonce(rawDevice.attestationNonce!, rawKey.privateKey),
      }),
    );
    expect(rawResult.attestedAt).not.toBeNull();
    expect(rawResult.trustFlags).toMatchObject({ attested: true });
    const rawEvents = await auditEvents("device.attested", rawDevice.device.id);
    expect(rawEvents).toHaveLength(1);

    // 5. No substrate (registered without a key) → typed unavailable.
    const plain = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Keyless device",
        deviceClass: "android-field",
      }),
    );
    await withTenant(TENANT_DEVICES, async () => {
      await expect(
        registry.attest({ deviceId: plain.device.id, signature: "AAAAAAAA" }),
      ).rejects.toBeInstanceOf(DeviceAttestationUnavailableError);
    });

    // 6. Unknown device → the not-found shape (A7 parity).
    await withTenant(TENANT_DEVICES, async () => {
      await expect(
        registry.attest({ deviceId: generateUuidV7(), signature: "AAAAAAAA" }),
      ).rejects.toBeInstanceOf(DeviceNotFoundError);
    });
    await client.end();
  });

  it("refresh rotation: happy chain → predecessor_id; REUSE of the rotated token → revocation + alarm (M-05)", async () => {
    const registered = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Rotation device",
        deviceClass: "tauri-desktop",
        contractVersion: SYNC_CONTRACT_VERSION,
        capabilities: ["pos", "drafts"],
      }),
    );
    rotationDeviceId = registered.device.id;

    const first = await withTenant(TENANT_DEVICES, (tx) =>
      issueRefreshToken(tx, rotationDeviceId),
    );

    // Happy rotation: fresh pair, usable access token, chain link.
    const rotated = await withTenant(TENANT_DEVICES, () =>
      rotateRefreshToken({ deviceId: rotationDeviceId, token: first.token }),
    );
    const claims = verifyAccessToken(rotated.accessToken);
    expect(claims).toMatchObject({
      sub: ADMIN,
      deviceId: rotationDeviceId,
      capabilities: ["pos", "drafts"],
    });
    expect(claims!.exp).toBeGreaterThan((Date.now() / 1000) | 0);
    expect(Date.parse(rotated.expiresAt)).toBeGreaterThan(Date.now());
    // Tampered tokens never verify.
    expect(verifyAccessToken(`${rotated.accessToken.slice(0, -4)}AAAA`)).toBeUndefined();
    expect(verifyAccessToken("not-a-jwt")).toBeUndefined();

    const client = await tenantClient();
    const chain = await client.query<{
      id: string;
      predecessor_id: string | null;
      used_at: Date | null;
      revoked_at: Date | null;
    }>(
      `SELECT id, predecessor_id, used_at, revoked_at FROM device_refresh_tokens
        WHERE device_id = $1 ORDER BY issued_at`,
      [rotationDeviceId],
    );
    expect(chain.rows).toHaveLength(2);
    expect(chain.rows[0]!.used_at).not.toBeNull(); // consumed
    expect(chain.rows[1]!.predecessor_id).toBe(chain.rows[0]!.id); // successor link
    expect(chain.rows[1]!.used_at).toBeNull();
    const rotatedEvents = await auditEvents("device.token_rotated", rotationDeviceId);
    expect(rotatedEvents).toHaveLength(1);

    // REUSE: present the consumed token again — the rejection is consumed
    // INSIDE the scope so the kill switch commits.
    await withTenant(TENANT_DEVICES, async () => {
      await expect(
        rotateRefreshToken({ deviceId: rotationDeviceId, token: first.token }),
      ).rejects.toBeInstanceOf(DeviceRevokedError);
    });
    const revoked = await client.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM devices WHERE id = $1`,
      [rotationDeviceId],
    );
    expect(revoked.rows[0]!.revoked_at).not.toBeNull(); // the device row is dead
    const reuseEvents = await auditEvents("device.refresh_token_reuse_detected", rotationDeviceId);
    expect(reuseEvents).toHaveLength(1);
    expect(reuseEvents[0]!.after).toMatchObject({ deviceId: rotationDeviceId, revoked: true });

    // The whole chain died with it; subsequent exchanges fail.
    const deadChain = await client.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM device_refresh_tokens WHERE device_id = $1`,
      [rotationDeviceId],
    );
    for (const row of deadChain.rows) {
      expect(row.revoked_at).not.toBeNull();
    }
    await withTenant(TENANT_DEVICES, async () => {
      await expect(
        rotateRefreshToken({ deviceId: rotationDeviceId, token: rotated.refreshToken }),
      ).rejects.toBeInstanceOf(DeviceRefreshInvalidError);
    });
    await client.end();
  });

  it("rotation with an expired token: typed invalid, device NOT revoked (no theft alarm)", async () => {
    const registered = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: USER2,
        tenantId: TENANT_DEVICES,
        deviceName: "Expired token device",
        deviceClass: "android-field",
      }),
    );
    const deviceId = registered.device.id;
    const token = await withTenant(TENANT_DEVICES, (tx) => issueRefreshToken(tx, deviceId));

    // Force the expiry past the window (the 30d TTL shortened to yesterday).
    // ck_device_refresh_tokens_window requires expires_at > issued_at on every
    // write, so issued_at moves back with it (2 days ago > yesterday).
    await withTenant(TENANT_DEVICES, async (tx) => {
      await tx.execute(sql`
        UPDATE device_refresh_tokens
        SET expires_at = now() - interval '1 day', issued_at = now() - interval '2 day'
        WHERE device_id = ${deviceId}
      `);
    });
    await withTenant(TENANT_DEVICES, async () => {
      await expect(
        rotateRefreshToken({ deviceId, token: token.token }),
      ).rejects.toBeInstanceOf(DeviceRefreshInvalidError);
    });
    const client = await tenantClient();
    const device = await client.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM devices WHERE id = $1`,
      [deviceId],
    );
    expect(device.rows[0]!.revoked_at).toBeNull(); // expiry ≠ theft
    const reuseEvents = await auditEvents("device.refresh_token_reuse_detected", deviceId);
    expect(reuseEvents).toHaveLength(0);
    await client.end();
  });

  it("revoke: kill switch + chain death; idempotent second revoke (no second audit)", async () => {
    const registered = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Revoke device",
        deviceClass: "pos-terminal",
      }),
    );
    revokedDeviceId = registered.device.id;
    const token = await withTenant(TENANT_DEVICES, (tx) =>
      issueRefreshToken(tx, revokedDeviceId),
    );

    const revoked = await withTenant(TENANT_DEVICES, () =>
      registry.revoke({
        deviceId: revokedDeviceId,
        actorId: ADMIN,
        reason: "lost in the field",
        admin: true,
      }),
    );
    expect(revoked.revokedAt).not.toBeNull();

    const client = await tenantClient();
    const chain = await client.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM device_refresh_tokens WHERE device_id = $1`,
      [revokedDeviceId],
    );
    expect(chain.rows[0]!.revoked_at).not.toBeNull(); // the chain died with it
    const events = await auditEvents("device.revoked", revokedDeviceId);
    expect(events).toHaveLength(1);
    expect(events[0]!.after).toMatchObject({ reason: "lost in the field", admin: true });

    // Idempotent: same timestamp, no second audit row.
    const again = await withTenant(TENANT_DEVICES, () =>
      registry.revoke({ deviceId: revokedDeviceId, actorId: ADMIN, admin: true }),
    );
    expect(again.revokedAt).toEqual(revoked.revokedAt);
    const eventsAfter = await auditEvents("device.revoked", revokedDeviceId);
    expect(eventsAfter).toHaveLength(1);

    // Exchange on the dead chain fails.
    await withTenant(TENANT_DEVICES, async () => {
      await expect(
        rotateRefreshToken({ deviceId: revokedDeviceId, token: token.token }),
      ).rejects.toBeInstanceOf(DeviceRefreshInvalidError);
    });
    await client.end();
  });

  it("flagTrust/expireData: jsonb merge + the remote data-expiry watermark, audited", async () => {
    const registered = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Admin plane device",
        deviceClass: "tauri-desktop",
      }),
    );
    adminDeviceId = registered.device.id;

    const flags = await withTenant(TENANT_DEVICES, () =>
      registry.flagTrust({
        deviceId: adminDeviceId,
        actorId: ADMIN,
        flags: { jailbreak: "suspected", flaggedAt: "2026-11-04T10:00:00Z" },
      }),
    );
    expect(flags).toMatchObject({
      jailbreak: "suspected",
      platformAttestation: "absent", // merged, existing keys preserved
    });
    const flaggedEvents = await auditEvents("device.trust_flagged", adminDeviceId);
    expect(flaggedEvents).toHaveLength(1);
    expect(flaggedEvents[0]!.after).toMatchObject({
      flags: { jailbreak: "suspected" },
    });

    const expired = await withTenant(TENANT_DEVICES, () =>
      registry.expireData({
        deviceId: adminDeviceId,
        actorId: ADMIN,
        expiresAt: "2027-01-01T00:00:00.000Z",
      }),
    );
    expect(expired.dataExpiresAt).not.toBeNull();
    const client = await tenantClient();
    const row = await client.query<{ data_expires_at: Date | null; trust_flags: Record<string, unknown> }>(
      `SELECT data_expires_at, trust_flags FROM devices WHERE id = $1`,
      [adminDeviceId],
    );
    expect(row.rows[0]!.data_expires_at).not.toBeNull();
    expect(row.rows[0]!.trust_flags).toMatchObject({ jailbreak: "suspected" });
    await client.end();
    const expiredEvents = await auditEvents("device.data_expired", adminDeviceId);
    expect(expiredEvents).toHaveLength(1);
  });

  it("list/get: per-device cursor state (RLS world) + the touch watermarks", async () => {
    const registered = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Cursor device",
        deviceClass: "tauri-desktop",
      }),
    );
    cursorDeviceId = registered.device.id;

    // A cursor + an inbox record ride the tenant-RLS tables (app world).
    await withTenant(TENANT_DEVICES, async (tx) => {
      await tx.execute(sql`
        INSERT INTO sync_cursors (id, tenant_id, device_id, entity_type, last_seq, acknowledged_at)
        VALUES (${generateUuidV7()}, ${TENANT_DEVICES}, ${cursorDeviceId}, 'items', ${42}, now())
      `);
      await tx.execute(sql`
        INSERT INTO inbox_commands (id, tenant_id, device_id, command_id, idempotency_key,
            entity_type, intent, status, result, processed_at)
        VALUES (${generateUuidV7()}, ${TENANT_DEVICES}, ${cursorDeviceId}, 'cmd-cursor-1',
            'idem-cursor-1', 'sales_invoice', 'create_draft', 'ACCEPTED',
            '{"ok": true}'::jsonb, now())
      `);
    });

    await withTenant(TENANT_DEVICES, () => registry.touchPull(cursorDeviceId));
    await withTenant(TENANT_DEVICES, () => registry.touchPush(cursorDeviceId));

    const rows = await withTenant(TENANT_DEVICES, () =>
      registry.list({ tenantId: TENANT_DEVICES }),
    );
    const row = rows.find((entry) => entry.id === cursorDeviceId);
    expect(row).toBeDefined();
    expect(row!.cursorEntities).toBeGreaterThanOrEqual(1);
    expect(row!.pendingCommands).toBe(1);
    expect(row!.lastPullAt).not.toBeNull();
    expect(row!.lastPushAt).not.toBeNull();
    expect(row!.deviceClass).toBe("tauri-desktop");
    expect(row!.attested).toBe(false);

    const detail = await withTenant(TENANT_DEVICES, () =>
      registry.get({ deviceId: cursorDeviceId }),
    );
    expect(detail.device.id).toBe(cursorDeviceId);
    expect(detail.cursors.map((cursor) => cursor.entityType)).toContain("items");
    expect(detail.cursors.find((cursor) => cursor.entityType === "items")!.lastSeq).toBe(42);

    // Unknown device id → the not-found shape.
    await withTenant(TENANT_DEVICES, async () => {
      await expect(registry.get({ deviceId: generateUuidV7() })).rejects.toBeInstanceOf(
        DeviceNotFoundError,
      );
    });
  });

  it("reconciliation: queue → reassign drafts → dismiss (close the queue to zero)", async () => {
    const client = await tenantClient();
    const branch = await client.query<{ id: string }>(
      `SELECT id FROM branches WHERE tenant_id = $1 AND code = 'MAIN' LIMIT 1`,
      [TENANT_DEVICES],
    );
    branchId = branch.rows[0]!.id;
    const partner = await client.query<{ id: string }>(
      `SELECT id FROM partners WHERE tenant_id = $1 AND code = 'DEV-0001' LIMIT 1`,
      [TENANT_DEVICES],
    );
    partnerId = partner.rows[0]!.id;
    await client.end();

    // Two devices: the lost one (A) and the takeover one (B).
    const lost = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: USER2,
        tenantId: TENANT_DEVICES,
        deviceName: "Lost field device",
        deviceClass: "android-field",
      }),
    );
    lostDeviceId = lost.device.id;
    const takeover = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Takeover device",
        deviceClass: "tauri-desktop",
      }),
    );
    takeoverDeviceId = takeover.device.id;

    // One DRAFT (moves) + one APPROVED (stays — only drafts are reassignable).
    const su = await superuserClient();
    draftInvoiceId = generateUuidV7();
    approvedInvoiceId = generateUuidV7();
    await su.query(
      `INSERT INTO sales_invoices (id, tenant_id, branch_id, customer_id, kind, invoice_date, due_date, currency_code, status, owner_device_id)
       VALUES ($1, $2, $3, $4, 'CREDIT', '2027-01-10', '2027-02-09', 'SAR', 'DRAFT', $5),
              ($6, $2, $3, $4, 'CREDIT', '2027-01-11', '2027-02-10', 'SAR', 'APPROVED', $5)`,
      [draftInvoiceId, TENANT_DEVICES, branchId, partnerId, lostDeviceId, approvedInvoiceId],
    );
    await su.end();

    // Revoke A → it lands on the queue with the draft it still owns.
    await withTenant(TENANT_DEVICES, () =>
      registry.revoke({ deviceId: lostDeviceId, actorId: ADMIN, reason: "lost", admin: true }),
    );
    const queue = await withTenant(TENANT_DEVICES, () => reconciliation.pendingOperations());
    const queued = queue.find((entry) => entry.deviceId === lostDeviceId);
    expect(queued).toBeDefined();
    expect(queued!.ownedDrafts).toBe(1);
    expect(queued!.pendingCommands).toBe(0);
    expect(queued!.oldestPendingAt).toBeNull();

    // An un-acked command record keeps the device on the queue.
    await withTenant(TENANT_DEVICES, async (tx) => {
      await tx.execute(sql`
        INSERT INTO inbox_commands (id, tenant_id, device_id, command_id, idempotency_key,
            entity_type, intent, status, result, processed_at)
        VALUES (${generateUuidV7()}, ${TENANT_DEVICES}, ${lostDeviceId}, 'cmd-lost-1',
            'idem-lost-1', 'sales_invoice', 'create_draft', 'ACCEPTED',
            '{"ok": true}'::jsonb, now())
      `);
    });
    const queue2 = await withTenant(TENANT_DEVICES, () => reconciliation.pendingOperations());
    const queued2 = queue2.find((entry) => entry.deviceId === lostDeviceId)!;
    expect(queued2.pendingCommands).toBe(1);
    expect(queued2.oldestPendingAt).not.toBeNull();

    // Reassign the drafts A→B: the DRAFT moves, the APPROVED stays.
    const moved = await withTenant(TENANT_DEVICES, () =>
      reconciliation.reassignDrafts({
        actorId: ADMIN,
        fromDeviceId: lostDeviceId,
        toDeviceId: takeoverDeviceId,
      }),
    );
    expect(moved.count).toBe(1);
    const after = await tenantClient();
    const owners = await after.query<{ id: string; owner_device_id: string | null; status: string }>(
      `SELECT id, owner_device_id, status FROM sales_invoices WHERE id = ANY($1::uuid[])`,
      [[draftInvoiceId, approvedInvoiceId]],
    );
    const draft = owners.rows.find((row) => row.id === draftInvoiceId)!;
    const approved = owners.rows.find((row) => row.id === approvedInvoiceId)!;
    expect(draft.owner_device_id).toBe(takeoverDeviceId);
    expect(approved.owner_device_id).toBe(lostDeviceId); // never reassigned
    const reassignedEvents = await auditEvents("sync.draft_reassigned", lostDeviceId);
    expect(reassignedEvents).toHaveLength(1);
    expect(reassignedEvents[0]!.after).toMatchObject({
      fromDeviceId: lostDeviceId,
      toDeviceId: takeoverDeviceId,
      count: 1,
    });

    // The un-acked command keeps A on the queue until a human dismisses it.
    const queue3 = await withTenant(TENANT_DEVICES, () => reconciliation.pendingOperations());
    expect(queue3.find((entry) => entry.deviceId === lostDeviceId)).toBeDefined();

    await withTenant(TENANT_DEVICES, () =>
      reconciliation.dismissDevice({ actorId: ADMIN, deviceId: lostDeviceId }),
    );
    const queue4 = await withTenant(TENANT_DEVICES, () => reconciliation.pendingOperations());
    expect(queue4.find((entry) => entry.deviceId === lostDeviceId)).toBeUndefined();
    const flags = await after.query<{ trust_flags: Record<string, unknown> }>(
      `SELECT trust_flags FROM devices WHERE id = $1`,
      [lostDeviceId],
    );
    expect(flags.rows[0]!.trust_flags).toMatchObject({ reconciliation_dismissed: true });
    const dismissedEvents = await auditEvents("sync.reconciliation_dismissed", lostDeviceId);
    expect(dismissedEvents).toHaveLength(1);
    await after.end();
  });

  it("the public refresh route: tenant derivation + the kill switch surviving the failure response", async () => {
    const key = ed25519KeyMaterial();
    const registered = await withTenant(TENANT_DEVICES, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_DEVICES,
        deviceName: "Controller refresh device",
        deviceClass: "tauri-desktop",
        deviceKeyPublic: key.derBase64,
        capabilities: ["drafts"],
      }),
    );
    controllerDeviceId = registered.device.id;
    const token = await withTenant(TENANT_DEVICES, (tx) =>
      issueRefreshToken(tx, controllerDeviceId),
    );

    // Happy path through the controller (no session, no ambient tenant scope
    // — the route derives device → user → ACTIVE membership → withTenant).
    const rotated = await controller.refresh(controllerDeviceId, {
      refreshToken: token.token,
    });
    const claims = verifyAccessToken(rotated.data.accessToken);
    expect(claims).toMatchObject({
      sub: ADMIN,
      deviceId: controllerDeviceId,
      capabilities: ["drafts"],
    });
    expect(rotated.data.refreshToken).not.toBe(token.token);

    // REUSE through the controller: the response fails AND the kill switch
    // survives — the rotation transaction rolled back with the throw, the
    // controller re-applied the revocation in its own committed scope.
    await expect(
      controller.refresh(controllerDeviceId, { refreshToken: token.token }),
    ).rejects.toBeInstanceOf(DeviceRevokedError);

    const client = await tenantClient();
    const device = await client.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM devices WHERE id = $1`,
      [controllerDeviceId],
    );
    expect(device.rows[0]!.revoked_at).not.toBeNull(); // committed, not rolled back
    const reuseEvents = await auditEvents("device.refresh_token_reuse_detected", controllerDeviceId);
    expect(reuseEvents).toHaveLength(1);
    const rotatedEvents = await auditEvents("device.token_rotated", controllerDeviceId);
    expect(rotatedEvents).toHaveLength(1); // exactly the happy path — no double rows

    // Unknown device through the route → the not-found shape.
    await expect(
      controller.refresh(generateUuidV7(), { refreshToken: token.token }),
    ).rejects.toBeInstanceOf(DeviceNotFoundError);
    await client.end();
  });
});
