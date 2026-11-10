import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { closeDb } from "../infra/db/client";
import { AuditService } from "../modules/audit/application/audit.service";
import { DrizzleAuditStore } from "../modules/audit/infrastructure/drizzle-audit.store";
import { FilesService } from "../modules/files/api/files";
import { S3FilesStore } from "../modules/files/infrastructure/s3-files.store";
import { SupportAccessService } from "../modules/tenancy/application/support-access-service";
import { LifecycleService } from "../modules/tenancy/application/lifecycle-service";
import { OffboardingService } from "../modules/tenancy/application/offboarding/offboarding-service";
import {
  runPurgeSweep,
} from "../modules/tenancy/application/offboarding/purge-service";
import * as offboardingStore from "../modules/tenancy/infrastructure/offboarding.store";
import { PasswordService } from "../modules/identity/application/password-service";
import * as identityStore from "../modules/identity/infrastructure/identity.store";

/**
 * PHASE-024 T11 — the offboarding purge staging drill, executed end-to-end
 * (DATA_PROTECTION §4 steps 1–8; Journey H1–H6): request (typed-name
 * confirmation + read-only grace) → export (manifest with sha256 checksums
 * + entity counts) → two-person execution (suspend + the 90-day retention
 * window) → the DAILY PURGE SWEEP on the migration-scope connection →
 * verification (0 tenant-owned rows, storage prefix empty) → the deletion
 * certificate → audit anonymization → restore impossible. Plus the two
 * documented branches: cancel-during-grace (H4) and the legal-hold block.
 *
 * The purge runs EXACTLY as production would: a dedicated connection on the
 * migrate credential with the 0036 purge-path RLS policies + the audit
 * guard's purge-mode GUC — never the app pool.
 */

const PLAN_BUSINESS = "30000000-0000-4000-8000-000000000002";
const PASSWORD = "offboarding-drill-pass-9";

const audit = new AuditService(new DrizzleAuditStore());
const files = new FilesService(new S3FilesStore());
const support = new SupportAccessService(audit);
const lifecycle = new LifecycleService(audit, support);
const offboarding = new OffboardingService({ audit, files, lifecycle });
const password = new PasswordService();

let migrateUrl: string;

let tenantA: string; // the full purge path
let tenantB: string; // the cancel-during-grace path
let tenantC: string; // the legal-hold block path
let ownerAId: string;
let ownerAEmail: string;
let adminId: string;

async function seedTenant(name: string): Promise<string> {
  const su = await superuserClient();
  const tenantId = generateUuidV7();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES ($1, $2, $2, 'SAR', 'SA', 'Asia/Riyadh')`,
    [tenantId, name],
  );
  await su.query(
    `INSERT INTO subscriptions (id, tenant_id, plan_id, period_start, period_end)
     VALUES ($1, $2, $3, '2026-01-01', '2026-12-31')`,
    [generateUuidV7(), tenantId, PLAN_BUSINESS],
  );
  // A branch + a partner + an audit row: tenant-owned data the purge must
  // remove (and the certificate must count).
  await su.query(
    `INSERT INTO branches (id, tenant_id, code, name) VALUES ($1, $2, 'MAIN', $3)`,
    [generateUuidV7(), tenantId, `Branch ${name}`],
  );
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES ($1, $2, 'CUSTOMER', $3, $4)`,
    [generateUuidV7(), tenantId, "P-1", `Partner ${name}`],
  );
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name) VALUES ($1, $2, 'owner', $3)`,
    [generateUuidV7(), tenantId, `Role ${name}`],
  );
  await su.end();
  return tenantId;
}

async function seedOwner(tenantId: string, email: string): Promise<string> {
  const hash = await password.hashFromNewPassword(PASSWORD);
  const user = await identityStore.insertUser({
    email,
    fullName: "Offboarding Owner",
    passwordHash: hash,
    status: "ACTIVE",
  });
  const su = await superuserClient();
  const role = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`,
    [tenantId],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES ($1, $2, $3, $4)`,
    [generateUuidV7(), tenantId, user.id, role.rows[0]!.id],
  );
  await su.end();
  return user.id;
}

async function auditCount(tenantId: string, action: string): Promise<number> {
  const su = await superuserClient();
  const result = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = $2`,
    [tenantId, action],
  );
  await su.end();
  return result.rows[0]?.n ?? 0;
}

async function tenantTableCounts(tenantId: string): Promise<Record<string, number>> {
  const su = await superuserClient();
  const tables = await su.query<{ table_name: string }>(`
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id'
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'tenants'
  `);
  const counts: Record<string, number> = {};
  for (const row of tables.rows) {
    const count = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "${row.table_name}" WHERE tenant_id = $1`,
      [tenantId],
    );
    const n = count.rows[0]?.n ?? 0;
    if (n > 0) {
      counts[row.table_name] = n;
    }
  }
  await su.end();
  return counts;
}

beforeAll(() => {
  const state = ensureTestDb();
  migrateUrl = state.migrateUrl;
  reloadEnv();
});

afterAll(async () => {
  await closeDb();
});

describe("Journey H — offboarding end-to-end (the staging drill)", () => {
  it("H1: request with typed-name confirmation → read-only grace + audited", async () => {
    tenantA = await seedTenant("Purge Drill A");
    ownerAEmail = `offb-a-${generateUuidV7().slice(0, 8)}@fixture.test`;
    ownerAId = await seedOwner(tenantA, ownerAEmail);

    // Wrong confirmation name → refused.
    await expect(
      offboarding.request({ tenantId: tenantA, requestedBy: ownerAId, confirmName: "Purge Drill X" }),
    ).rejects.toMatchObject({ code: "tenancy/offboarding-confirmation" });

    const row = await offboarding.request({
      tenantId: tenantA,
      requestedBy: ownerAId,
      confirmName: "Purge Drill A",
    });
    expect(row.status).toBe("REQUESTED");
    expect(row.graceUntil).not.toBeNull();

    const su = await superuserClient();
    const subscription = await su.query<{ status: string }>(
      `SELECT status FROM subscriptions WHERE tenant_id = $1`,
      [tenantA],
    );
    await su.end();
    expect(subscription.rows[0]?.status).toBe("GRACE_READ_ONLY");
    expect(await auditCount(tenantA, "offboarding.requested")).toBe(1);
  });

  it("H2/H3: export → manifest with sha256 checksums + entity counts + signed URL", async () => {
    const result = await offboarding.triggerExport({ tenantId: tenantA, actorId: ownerAId });
    expect(result.manifestChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.downloadUrl).toContain("X-Amz-Signature");
    const partnerArtifact = result.artifacts.find(
      (artifact) => artifact.entity === "partners" && artifact.format === "csv",
    );
    expect(partnerArtifact).toBeDefined();
    expect(partnerArtifact!.rows).toBe(1);
    expect(partnerArtifact!.sha256).toMatch(/^[0-9a-f]{64}$/);
    // The stored artifact round-trips through the signed surface.
    const body = await files.readObject(tenantA, partnerArtifact!.key);
    expect(body.body.toString("utf8")).toContain("Partner Purge Drill A");

    const row = await offboardingStore.findLiveOffboarding(tenantA);
    expect(row?.status).toBe("EXPORTED");
    expect(row?.manifestChecksum).toBe(result.manifestChecksum);
    expect(await auditCount(tenantA, "export.generated")).toBe(1);
  });

  it("H4: two-person execution → SUSPENDED + retention window (90d placeholder)", async () => {
    const su = await superuserClient();
    adminId = (await su.query<{ id: string }>(`SELECT id FROM users LIMIT 1`)).rows[0]!.id;
    await su.end();

    const row = await offboarding.execute({ tenantId: tenantA, adminId });
    expect(row.status).toBe("EXECUTED");
    expect(row.retentionUntil).not.toBeNull();

    const tenant = await offboardingStore.findTenantForPlatform(tenantA);
    expect(tenant?.status).toBe("SUSPENDED");
  });

  it("H4 edge: cancel during grace restores ACTIVE (a second tenant)", async () => {
    tenantB = await seedTenant("Purge Drill B");
    const ownerBEmail = `offb-b-${generateUuidV7().slice(0, 8)}@fixture.test`;
    const ownerB = await seedOwner(tenantB, ownerBEmail);

    await offboarding.request({ tenantId: tenantB, requestedBy: ownerB, confirmName: "Purge Drill B" });
    await offboarding.cancel({ tenantId: tenantB, actorId: ownerB });

    const su = await superuserClient();
    const subscription = await su.query<{ status: string }>(
      `SELECT status FROM subscriptions WHERE tenant_id = $1`,
      [tenantB],
    );
    await su.end();
    expect(subscription.rows[0]?.status).toBe("ACTIVE");
    expect(await auditCount(tenantB, "tenant.restored")).toBe(1);
  });

  it("legal hold blocks the purge (audited) — a third tenant", async () => {
    tenantC = await seedTenant("Purge Drill C");
    const ownerCEmail = `offb-c-${generateUuidV7().slice(0, 8)}@fixture.test`;
    const ownerC = await seedOwner(tenantC, ownerCEmail);
    await offboarding.request({ tenantId: tenantC, requestedBy: ownerC, confirmName: "Purge Drill C" });
    await offboarding.execute({ tenantId: tenantC, adminId });
    await offboarding.setLegalHold({
      tenantId: tenantC,
      adminId,
      legalHold: true,
      reason: "investigation INC-1",
    });

    // Retention elapsed for BOTH C (blocked) and A (purged).
    const su = await superuserClient();
    await su.query(
      `UPDATE tenant_offboarding SET retention_until = now() - interval '1 day'
       WHERE tenant_id IN ($1, $2) AND status = 'EXECUTED'`,
      [tenantA, tenantC],
    );
    await su.end();
  });

  it("H5: the purge sweep — verification, certificate, anonymization, restore impossible", async () => {
    const result = await runPurgeSweep({ files, migrateUrl, now: new Date() });
    expect(result.checked).toBe(2);
    expect(result.purged).toBe(1);
    expect(result.blocked).toBe(1);

    // Verification: 0 tenant-owned rows for A.
    const counts = await tenantTableCounts(tenantA);
    expect(counts).toEqual({});

    // The tenants row: OFFBOARDED + soft-deleted (platform-owned, kept).
    const tenant = await offboardingStore.findTenantForPlatform(tenantA);
    expect(tenant?.status).toBe("OFFBOARDED");

    // Audit anonymization: A's rows survive with tenant_id NULL (the
    // action/entity forensics kept, the PII severed).
    const su = await superuserClient();
    const anon = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1`,
      [tenantA],
    );
    expect(anon.rows[0]?.n).toBe(0);
    const kept = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'offboarding.requested'
         AND entity_id = $1 AND tenant_id IS NULL`,
      [tenantA],
    );
    expect(kept.rows[0]?.n).toBe(1);

    // The deletion certificate (purged_tenants survives the purge).
    const certificate = await su.query<{ hashed_tenant_id: string; verification: unknown; audit_rows_anonymized: number }>(
      `SELECT hashed_tenant_id, verification, audit_rows_anonymized FROM purged_tenants
       WHERE tenant_id_at_purge = $1`,
      [tenantA],
    );
    expect(certificate.rows[0]).toBeDefined();
    expect(certificate.rows[0]!.hashed_tenant_id).toMatch(/^[0-9a-f]{64}$/);
    expect(certificate.rows[0]!.audit_rows_anonymized).toBeGreaterThan(0);

    // Storage prefix empty.
    expect(await files.listPrefix(`${tenantA}/`)).toEqual([]);

    // Sessions severed: the owner's login no longer resolves an active
    // membership (tenant OFFBOARDED) — restore is impossible.
    const { LoginService } = await import("../modules/identity/application/login-service");
    const { SessionService } = await import("../modules/identity/application/session-service");
    const { MfaService } = await import("../modules/identity/application/mfa-service");
    const login = new LoginService({
      password,
      sessions: new SessionService(),
      mfa: new MfaService(audit),
      audit,
      notifyLogin: async () => undefined,
    });
    await expect(
      login.login({ email: ownerAEmail, password: PASSWORD }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });

    // Platform audit: tenant.purged + offboarding.verified (tenant_id NULL
    // platform rows — they survive by construction).
    const purged = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'tenant.purged' AND entity_id = $1`,
      [tenantA],
    );
    expect(purged.rows[0]?.n).toBe(1);
    const blocked = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events WHERE action = 'offboarding.purge_blocked' AND entity_id = $1`,
      [tenantC],
    );
    expect(blocked.rows[0]?.n).toBe(1);
    await su.end();
  });

  it("idempotent for purged tenants; legal-hold tenants stay blocked (re-audited)", async () => {
    const result = await runPurgeSweep({ files, migrateUrl, now: new Date() });
    // A is gone (no row left to find); C stays EXECUTED under legal hold —
    // the sweep re-checks it every day and re-audits the block.
    expect(result.checked).toBe(1);
    expect(result.purged).toBe(0);
    expect(result.blocked).toBe(1);
  });
});
