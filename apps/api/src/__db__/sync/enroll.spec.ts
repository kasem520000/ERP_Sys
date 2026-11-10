import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { generateKeyPairSync, sign as ed25519Sign, type KeyObject } from "node:crypto";

import { generateUuidV7 } from "@erp/domain-core";

import { SYNC_CONTRACT_VERSION, PERMISSIONS_ENTITY_TYPE } from "@erp/contracts";

import { appClient, ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { DeviceRegistryService, DeviceNotFoundError } from "../../modules/sync/application/device-registry-service";
import { enrollDeviceWithSecret } from "../../modules/sync/application/device-enrollment";
import {
  DeviceRefreshInvalidError,
  DeviceRevokedError,
  rotateRefreshToken,
  verifyAccessToken,
} from "../../modules/sync/application/device-tokens";
import { pull as pullService } from "../../modules/sync/application/pull-service";
import { DevicesController } from "../../modules/sync/presentation/devices.controller";

/**
 * PHASE-021 T3 db evidence (DR-P21-01 — MASTER-PLAN §1 item 2 + §4;
 * SECURITY_AND_DEVICE_MANAGEMENT §2/§3; ADR-0015 §3): the enrollment
 * bootstrap exchange — the deferred first-refresh wiring DR-P20-03 promised:
 *
 * 1. register → enroll: the FIRST credential pair mints (verifyAccessToken
 *    round-trip + rotateRefreshToken chain continuation), the one-time
 *    device_key_hash is CLEARED (NULL) on success;
 * 2. one-time proof: the second enroll with the same secret → typed
 *    DeviceRefreshInvalidError (no existence/state leak);
 * 3. wrong secret on an existing device → DeviceRefreshInvalidError (NOT
 *    the 404 shape — indistinguishable from an unknown device);
 * 4. enroll on a REVOKED device → DeviceRevokedError (the kill switch is
 *    authoritative; no new tokens minted — device-security.spec parity);
 * 5. the audit row `device.enrolled` (device + expiries only, no secrets);
 * 6. the full desktop journey: register (with key) → attest → enroll →
 *    the access token verifies with the device claims → a real pull
 *    (items + the permissions snapshot) serves the enrolled device.
 *
 * Dedicated tenant 41414141 (verified unused across the repo — the master
 * plan's TENANT_DESKTOP 21212121 is already taken by push/policies specs,
 * so this file keeps the no-cross-file-state convention). Device ids are
 * generated per run (never fixed). Typed failures are asserted INSIDE the
 * withTenant scope (the devices.spec pattern).
 */

const TENANT_ENROLL = "41414141-4141-4141-4141-414141414141";
const ADMIN = "41414141-0000-4000-8000-000000004101";
const USER2 = "41414141-0000-4000-8000-000000004102";

const audit = new AuditService(new DrizzleAuditStore());
const registry = new DeviceRegistryService(audit);
const controller = new DevicesController(registry);

/** The tenant-scoped app client (RLS world) for read assertions. */
async function tenantClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_ENROLL]);
  return client;
}

function ed25519KeyMaterial() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return { privateKey, derBase64: der.toString("base64") };
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
    [TENANT_ENROLL, action, entityId ?? null],
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
       ($1, 'T41414141 Enroll (P21)', 'مستأجر التسجيل', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_ENROLL],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'enroll-admin@fixture.test', 'Enroll Admin', 'x', 'ACTIVE'),
       ($2, 'enroll-user@fixture.test', 'Enroll Second User', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ADMIN, USER2],
  );
  // One tenant role cloned from the system `owner` template — the 0005
  // cross-join already grants it every non-platform key (sync.devices.* —
  // register needs no manual grants; the devices.spec fixture shape).
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'enroll_owner', 'Enroll Owner', 'مالك التسجيل', false)
     ON CONFLICT (id) DO NOTHING`,
    [roleId, TENANT_ENROLL],
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
      [roleId, TENANT_ENROLL, template.rows[0].id],
    );
  }
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [generateUuidV7(), TENANT_ENROLL, ADMIN, roleId],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [generateUuidV7(), TENANT_ENROLL, USER2, roleId],
  );
  await su.end();
});

afterAll(async () => {
  await closeDb();
});

describe("enrollment bootstrap (DR-P21-01; MASTER-PLAN §1 item 2 + §4)", () => {
  it("register → enroll: the FIRST credential pair (verify + rotate round-trip) + the one-time hash cleared", async () => {
    const registered = await withTenant(TENANT_ENROLL, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_ENROLL,
        deviceName: "Enroll device 1",
        deviceClass: "tauri-desktop",
        contractVersion: SYNC_CONTRACT_VERSION,
        capabilities: ["drafts"],
      }),
    );
    const deviceId = registered.device.id;
    expect(registered.enrollmentSecret).toMatch(/^[0-9a-f]{64}$/);

    // The hash is present BEFORE the exchange (sha256 at rest).
    const before = await tenantClient();
    const hashRow = await before.query<{ device_key_hash: string | null }>(
      `SELECT device_key_hash FROM devices WHERE id = $1`,
      [deviceId],
    );
    expect(hashRow.rows[0]!.device_key_hash).not.toBeNull();
    await before.end();

    const enrolled = await withTenant(TENANT_ENROLL, () =>
      enrollDeviceWithSecret({ deviceId, enrollmentSecret: registered.enrollmentSecret }),
    );

    // The pair: shape + a verifying access token bound to the device.
    expect(enrolled.accessToken).toBeTruthy();
    expect(enrolled.refreshToken).not.toBe(registered.enrollmentSecret); // a DIFFERENT credential
    expect(Date.parse(enrolled.expiresAt)).toBeGreaterThan(Date.now());
    expect(Date.parse(enrolled.refreshTokenExpiresAt)).toBeGreaterThan(Date.now());
    const claims = verifyAccessToken(enrolled.accessToken);
    expect(claims).toMatchObject({
      sub: ADMIN,
      deviceId,
      capabilities: ["drafts"],
    });
    expect(claims!.exp).toBeGreaterThan((Date.now() / 1000) | 0);

    // The enrolled refresh token ROTATES like any chain member (the
    // round-trip DR-P20-03 deferred — enroll IS the chain root).
    const rotated = await withTenant(TENANT_ENROLL, () =>
      rotateRefreshToken({ deviceId, token: enrolled.refreshToken }),
    );
    expect(rotated.refreshToken).not.toBe(enrolled.refreshToken);
    expect(verifyAccessToken(rotated.accessToken)).toMatchObject({ sub: ADMIN, deviceId });
    const client = await tenantClient();
    const chain = await client.query<{ predecessor_id: string | null; used_at: Date | null }>(
      `SELECT predecessor_id, used_at FROM device_refresh_tokens
        WHERE device_id = $1 ORDER BY issued_at`,
      [deviceId],
    );
    expect(chain.rows).toHaveLength(2); // enroll root + the rotation successor
    expect(chain.rows[0]!.predecessor_id).toBeNull(); // the root has no predecessor
    expect(chain.rows[1]!.predecessor_id).not.toBeNull(); // linked by the rotation
    expect(chain.rows[0]!.used_at).not.toBeNull(); // consumed by the rotation

    // ONE-TIME: the proof is consumed — device_key_hash is NULL after success.
    const after = await client.query<{ device_key_hash: string | null }>(
      `SELECT device_key_hash FROM devices WHERE id = $1`,
      [deviceId],
    );
    expect(after.rows[0]!.device_key_hash).toBeNull();
    await client.end();
  });

  it("one-time proof: the second enroll with the same secret → DeviceRefreshInvalidError (no leak)", async () => {
    const registered = await withTenant(TENANT_ENROLL, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_ENROLL,
        deviceName: "Enroll device 2 (replay)",
        deviceClass: "tauri-desktop",
      }),
    );
    const deviceId = registered.device.id;

    const first = await withTenant(TENANT_ENROLL, () =>
      enrollDeviceWithSecret({ deviceId, enrollmentSecret: registered.enrollmentSecret }),
    );
    expect(verifyAccessToken(first.accessToken)).toMatchObject({ deviceId });

    // Replay: same secret, second exchange → the typed invalid (the same
    // class refresh uses — never a 404, never a new pair).
    await withTenant(TENANT_ENROLL, async () => {
      await expect(
        enrollDeviceWithSecret({ deviceId, enrollmentSecret: registered.enrollmentSecret }),
      ).rejects.toBeInstanceOf(DeviceRefreshInvalidError);
    });

    // The controller path behaves identically (the PUBLIC route shape).
    await expect(
      controller.enroll(deviceId, { enrollmentSecret: registered.enrollmentSecret }),
    ).rejects.toBeInstanceOf(DeviceRefreshInvalidError);

    // Exactly ONE refresh token exists — the replay minted nothing.
    const client = await tenantClient();
    const chain = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM device_refresh_tokens WHERE device_id = $1`,
      [deviceId],
    );
    expect(chain.rows[0]!.count).toBe("1");
    await client.end();
  });

  it("wrong secret on an existing device → DeviceRefreshInvalidError (never the 404 shape)", async () => {
    const registered = await withTenant(TENANT_ENROLL, () =>
      registry.register({
        actorId: USER2,
        tenantId: TENANT_ENROLL,
        deviceName: "Enroll device 3 (wrong secret)",
        deviceClass: "tauri-desktop",
      }),
    );
    const deviceId = registered.device.id;
    const wrongSecret = `${"0".repeat(63)}1`; // 64-hex-shaped, never issued

    await withTenant(TENANT_ENROLL, async () => {
      await expect(
        enrollDeviceWithSecret({ deviceId, enrollmentSecret: wrongSecret }),
      ).rejects.toBeInstanceOf(DeviceRefreshInvalidError);
    });
    // The route-level shape: same typed error, no existence leak.
    await expect(controller.enroll(deviceId, { enrollmentSecret: wrongSecret })).rejects.toBeInstanceOf(
      DeviceRefreshInvalidError,
    );

    // The proof is NOT consumed by a failed attempt — the right secret
    // still enrolls (retry-after-typo works; the hash survived).
    const enrolled = await withTenant(TENANT_ENROLL, () =>
      enrollDeviceWithSecret({ deviceId, enrollmentSecret: registered.enrollmentSecret }),
    );
    expect(verifyAccessToken(enrolled.accessToken)).toMatchObject({ sub: USER2, deviceId });

    // Unknown device → the not-found shape (A7 parity with refresh).
    await expect(
      controller.enroll(generateUuidV7(), { enrollmentSecret: wrongSecret }),
    ).rejects.toBeInstanceOf(DeviceNotFoundError);
  });

  it("enroll on a REVOKED device → DeviceRevokedError (the kill switch is authoritative)", async () => {
    const registered = await withTenant(TENANT_ENROLL, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_ENROLL,
        deviceName: "Enroll device 4 (revoked)",
        deviceClass: "tauri-desktop",
      }),
    );
    const deviceId = registered.device.id;

    await withTenant(TENANT_ENROLL, () =>
      registry.revoke({ deviceId, actorId: ADMIN, reason: "lost desktop", admin: true }),
    );

    // Service path: no new tokens after revocation (rotateRefreshToken's
    // exact guard + shape — device-security.spec parity).
    await withTenant(TENANT_ENROLL, async () => {
      await expect(
        enrollDeviceWithSecret({ deviceId, enrollmentSecret: registered.enrollmentSecret }),
      ).rejects.toBeInstanceOf(DeviceRevokedError);
    });
    // Route path: identical.
    await expect(
      controller.enroll(deviceId, { enrollmentSecret: registered.enrollmentSecret }),
    ).rejects.toBeInstanceOf(DeviceRevokedError);

    // Nothing was minted and no enroll audit exists for the revoked device.
    const client = await tenantClient();
    const chain = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM device_refresh_tokens WHERE device_id = $1`,
      [deviceId],
    );
    expect(chain.rows[0]!.count).toBe("0");
    await client.end();
    const events = await auditEvents("device.enrolled", deviceId);
    expect(events).toHaveLength(0);
  });

  it("audit: device.enrolled written once per enrollment (device + expiries, never secrets)", async () => {
    const registered = await withTenant(TENANT_ENROLL, () =>
      registry.register({
        actorId: USER2,
        tenantId: TENANT_ENROLL,
        deviceName: "Enroll device 5 (audit)",
        deviceClass: "tauri-desktop",
        capabilities: ["drafts"],
      }),
    );
    const deviceId = registered.device.id;

    const enrolled = await withTenant(TENANT_ENROLL, () =>
      enrollDeviceWithSecret({ deviceId, enrollmentSecret: registered.enrollmentSecret }),
    );

    const events = await auditEvents("device.enrolled", deviceId);
    expect(events).toHaveLength(1);
    expect(events[0]!.entityId).toBe(deviceId);
    expect(events[0]!.actorId).toBe(USER2); // the device's user (the registry pattern)
    expect(events[0]!.after).toMatchObject({
      accessTokenExpiresAt: enrolled.expiresAt,
      refreshTokenExpiresAt: enrolled.refreshTokenExpiresAt,
    });
    // SECURITY §8: no secret material on the audit trail.
    const serialized = JSON.stringify(events[0]!.after);
    expect(serialized).not.toContain(enrolled.refreshToken);
    expect(serialized).not.toContain(enrolled.accessToken);
    expect(serialized).not.toContain(registered.enrollmentSecret);
  });

  it("full journey: register (with key) → attest → enroll → the access token works for sync calls", async () => {
    const key = ed25519KeyMaterial();
    const registered = await withTenant(TENANT_ENROLL, () =>
      registry.register({
        actorId: ADMIN,
        tenantId: TENANT_ENROLL,
        deviceName: "Enroll device 6 (journey)",
        deviceClass: "tauri-desktop",
        contractVersion: SYNC_CONTRACT_VERSION,
        deviceKeyPublic: key.derBase64,
        capabilities: ["drafts"],
      }),
    );
    const deviceId = registered.device.id;

    // The optional attestation-lite step (register issued the challenge).
    const attested = await withTenant(TENANT_ENROLL, () =>
      registry.attest({
        deviceId,
        signature: signNonce(registered.attestationNonce!, key.privateKey),
      }),
    );
    expect(attested.attestedAt).not.toBeNull();

    // The enroll exchange (the controller route — no session, no ambient
    // tenant scope; the route derives device → user → membership → scope).
    const response = await controller.enroll(deviceId, {
      enrollmentSecret: registered.enrollmentSecret,
    });
    expect(response.data.refreshToken).toBeTruthy();
    const claims = verifyAccessToken(response.data.accessToken);
    expect(claims).toMatchObject({ sub: ADMIN, deviceId, capabilities: ["drafts"] });

    // Light sync check: the enrolled device pulls its feed group + the
    // permissions snapshot (the desktop journey's first cycle).
    const items = await withTenant(TENANT_ENROLL, () =>
      pullService({ entityType: "items", cursor: null, deviceId }),
    );
    expect(items.entityType).toBe("items");
    expect(items.contractVersion).toBe(SYNC_CONTRACT_VERSION);
    const permissions = await withTenant(TENANT_ENROLL, () =>
      pullService({ entityType: PERMISSIONS_ENTITY_TYPE, cursor: null, deviceId }),
    );
    expect(permissions.entityType).toBe(PERMISSIONS_ENTITY_TYPE);
    expect(permissions.changes.length).toBeGreaterThan(0); // the bootstrap snapshot row
    expect((permissions.changes[0]!.payload as { permissions?: string[] }).permissions).toEqual(
      expect.arrayContaining(["sync.devices.register"]),
    );

    // The proof is consumed at the end of the journey too.
    const client = await tenantClient();
    const hash = await client.query<{ device_key_hash: string | null }>(
      `SELECT device_key_hash FROM devices WHERE id = $1`,
      [deviceId],
    );
    expect(hash.rows[0]!.device_key_hash).toBeNull();
    await client.end();
  });
});
