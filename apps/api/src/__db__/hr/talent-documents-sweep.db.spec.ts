import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { TalentAlertsService } from "../../modules/hr/application/talent-alerts-service";
import { TalentOrgService } from "../../modules/hr/application/talent-org-service";
import { TalentPerformanceService } from "../../modules/hr/application/talent-performance-service";
import { TalentTrainingService } from "../../modules/hr/application/talent-training-service";
import { findAlertJob } from "../../modules/hr/infrastructure/talent-alerts.store";
import {
  EmployeeDocumentNotFoundError,
  TalentInvalidError,
} from "../../modules/hr/domain/talent-errors";
import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { H_ACTOR, setupHrFixture } from "./fixtures";

/**
 * PHASE-047 (W-3 — T-09) — the employee documents register + the
 * hr-expiry-sweep pinned over real PostgreSQL 16 (the plan §4's
 * `talent-documents-sweep.db.spec`): acceptance #5 — the sweep fires
 * at 30/7/0 for documents, certifications, probation end and review
 * due, DEDUPLICATED per employee per document per threshold pass
 * (BR-091 — proven by the re-run), evidence in the notification
 * records; the fail-open probation law (NULL = no alert ever
 * fabricated); the 044-pattern config row (defaults / custom
 * thresholds / the explicit off switch / the stamped run stats).
 *
 * THE DEDICATED TENANT (the reorder-inapp precedent): a fresh
 * TENANT_HS with its own owner membership — ownerTarget() is the
 * sweep's notification target, and the dedicated tenant keeps the
 * notification counts clean of the shared tenant H's traffic. Every
 * assertion is SCOPED to this run's seeded row ids (the dedupe keys
 * are once-ever by law — a re-run of the file seeds fresh rows and
 * derives fresh keys; the counts stay exact).
 */

const audit = new AuditService(new DrizzleAuditStore());
const alertsSvc = new TalentAlertsService(audit, new InboxService());
const orgSvc = new TalentOrgService(audit);
const performanceSvc = new TalentPerformanceService(audit);
const trainingSvc = new TalentTrainingService(audit);

/** THE DEDICATED SWEEP TENANT + its owner (the reorder-inapp shape). */
const TENANT_HS = "7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a5a";
const HS_OWNER = "7a7a7a7a-0000-4000-8000-0000000007a5";

const spec: { employeeId?: string; nullProbationEmployeeId?: string } = {};

beforeAll(async () => {
  await setupHrFixture();
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant HS (hr sweep)', 'المستأجر هـ-س', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_HS],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'hs-owner@fixture.test', 'HS Owner', 'x', 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [HS_OWNER],
  );
  // The owner membership (the sweep's in-app target — ownerTarget()).
  const ownerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
    [roleId, TENANT_HS],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
    [roleId, TENANT_HS, ownerTemplate.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_HS, HS_OWNER, roleId],
  );
  // The cast: two employees — one WITH a probation_end (in the 7-day
  // band), one with NULL (the fail-open arm).
  const employees = await su.query<{ id: string; code: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, created_by) VALUES
       (gen_random_uuid(), $1, 'EMP-HS-1', 'Sweep Employee', 'موظف المسح', CURRENT_DATE - 90, 'FULL_TIME', 8500, $2),
       (gen_random_uuid(), $1, 'EMP-HS-2', 'No Probation', 'بلا تجربة', CURRENT_DATE - 90, 'FULL_TIME', 8500, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, code`,
    [TENANT_HS, H_ACTOR],
  );
  const byCode = new Map(employees.rows.map((row) => [row.code, row.id]));
  spec.employeeId = byCode.get("EMP-HS-1")!;
  spec.nullProbationEmployeeId = byCode.get("EMP-HS-2")!;
  // probation_end: +5 days (the (0,7] band); the second employee
  // stays NULL (the fail-open law). The substrate write is the SPEC's
  // raw seed (D-01: no 047 route writes the employees table; the
  // sweep only READS it).
  await su.query(
    `UPDATE employees SET probation_end = CURRENT_DATE + 5
     WHERE tenant_id = $1 AND code = 'EMP-HS-1'`,
    [TENANT_HS],
  );
  await su.end();
});

/** Seed one document at a day-offset (NULL = no expiry). */
async function seedDocument(employeeId: string, kind: string, expiresInDays: number | null, number_: string) {
  return withTenant(TENANT_HS, () =>
    orgSvc.createDocument({
      employeeId,
      kind,
      number: number_,
      issuedOn: "2025-01-01",
      expiresOn:
        expiresInDays === null
          ? null
          : new Date(Date.now() + expiresInDays * 86_400_000).toISOString().slice(0, 10),
      notes: null,
      actorId: H_ACTOR,
    }),
  );
}

interface NotificationRow {
  category: string;
  severity: string;
  title: { ar: string; en: string };
  body: { ar: string; en: string };
  dedupe_key: string | null;
  user_id: string | null;
}

/** The scoped notification read: this run's keys only. */
async function notificationsFor(dedupeKeys: readonly string[]): Promise<NotificationRow[]> {
  const su: Client = await superuserClient();
  const rows = await su.query<NotificationRow>(
    `SELECT category, severity, title, body, dedupe_key, user_id
     FROM notifications WHERE tenant_id = $1 AND dedupe_key = ANY($2::text[])`,
    [TENANT_HS, dedupeKeys],
  );
  await su.end();
  return rows.rows;
}

describe("PHASE-047 W-3 — (a) the employee document register (HR-10)", () => {
  it("(a1) creates/lists/patches/deletes with the typed validations (the kind enum, the inverted window, the unknown employee)", async () => {
    await expect(
      withTenant(TENANT_HS, () =>
        orgSvc.createDocument({
          employeeId: spec.employeeId!,
          kind: "RESIDENCE_PERMIT",
          number: null,
          issuedOn: null,
          expiresOn: null,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    await expect(
      withTenant(TENANT_HS, () =>
        orgSvc.createDocument({
          employeeId: spec.employeeId!,
          kind: "IQAMA",
          number: "IQ-778899",
          issuedOn: "2027-01-01",
          expiresOn: "2026-01-01",
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TalentInvalidError);
    await expect(
      withTenant(TENANT_HS, () =>
        orgSvc.createDocument({
          employeeId: "11111111-1111-4111-8111-111111111144",
          kind: "PASSPORT",
          number: null,
          issuedOn: null,
          expiresOn: null,
          notes: null,
          actorId: H_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(Error);
    const created = await withTenant(TENANT_HS, () =>
      orgSvc.createDocument({
        employeeId: spec.employeeId!,
        kind: "IQAMA",
        number: "IQ-990011",
        issuedOn: "2026-01-10",
        expiresOn: "2027-01-10",
        notes: null,
        actorId: H_ACTOR,
      }),
    );
    expect(created.kind).toBe("IQAMA");
    const patched = await withTenant(TENANT_HS, () =>
      orgSvc.patchDocument({ id: created.id, notes: "renewal in progress", actorId: H_ACTOR }),
    );
    expect(patched.notes).toBe("renewal in progress");
    const listed = await withTenant(TENANT_HS, () =>
      orgSvc.listDocuments({ employeeId: spec.employeeId! }),
    );
    expect(listed.some((row) => row.id === created.id)).toBe(true);
    const deleted = await withTenant(TENANT_HS, () =>
      orgSvc.deleteDocument(created.id, H_ACTOR),
    );
    expect(deleted.id).toBe(created.id);
    await expect(
      withTenant(TENANT_HS, () => orgSvc.deleteDocument(created.id, H_ACTOR)),
    ).rejects.toBeInstanceOf(EmployeeDocumentNotFoundError);
  });
});

describe("PHASE-047 W-3 — (b) THE SWEEP: the four probes at 30/7/0, BR-091's structural dedupe (acceptance #5)", () => {
  it("(b1) the document probe fires ONE alert per band with the exact dedupe keys, the severity ladder, and the honest titles — and the re-run adds NOTHING (dedupe proven)", async () => {
    // The bands' cast: +25 (the (7,30] band), +3 ((0,7]), +0 ((-∞,0]),
    // -10 (already expired — the 0-band's open floor), +60 (outside
    // every band), NULL (no window ever).
    const far = await seedDocument(spec.employeeId!, "PASSPORT", 25, "PP-111");
    const near = await seedDocument(spec.employeeId!, "IQAMA", 3, "IQ-222");
    const today = await seedDocument(spec.employeeId!, "VISA", 0, "VS-333");
    const expired = await seedDocument(spec.employeeId!, "CONTRACT", -10, "CT-444");
    const outside = await seedDocument(spec.employeeId!, "OTHER", 60, "OT-555");
    const noExpiry = await seedDocument(spec.employeeId!, "CERTIFICATE", null, "CR-666");

    // NO config row registers — the documented defaults 30/7/0 fire
    // (the 044 fail-closed law).
    const firstRun = await withTenant(TENANT_HS, () => alertsSvc.runExpirySweep());
    expect(firstRun.skippedInactive).toBe(false);
    expect(firstRun.windows).toEqual([30, 7, 0]);
    expect(firstRun.perKind["document-expiry"]).toBeGreaterThanOrEqual(4);

    const keys = [
      `hr:document-expiry:${spec.employeeId}:${far.id}:30`,
      `hr:document-expiry:${spec.employeeId}:${near.id}:7`,
      `hr:document-expiry:${spec.employeeId}:${today.id}:0`,
      `hr:document-expiry:${spec.employeeId}:${expired.id}:0`,
    ];
    const rows = await notificationsFor(keys);
    expect(rows).toHaveLength(4);
    const byKey = new Map(rows.map((row) => [row.dedupe_key, row]));
    // The severity ladder: info at the 30-day band, warning below.
    expect(byKey.get(keys[0]!)!.severity).toBe("info");
    expect(byKey.get(keys[1]!)!.severity).toBe("warning");
    expect(byKey.get(keys[2]!)!.severity).toBe("warning");
    // The honest title: the already-expired document says "expired",
    // the expiring-today one says "today".
    expect(byKey.get(keys[3]!)!.title.en).toContain("expired");
    expect(byKey.get(keys[2]!)!.title.en).toContain("today");
    // THE PII LAW: the document NUMBER never rides the payload.
    for (const row of rows) {
      expect(row.body.en).not.toContain("PP-111");
      expect(row.body.en).not.toContain("IQ-222");
      expect(row.body.en).not.toContain("VS-333");
      expect(row.body.en).not.toContain("CT-444");
    }
    // The owner targeting: every row carries the owner's user id and
    // the 'hr' category.
    for (const row of rows) {
      expect(row.user_id).toBe(HS_OWNER);
      expect(row.category).toBe("hr");
    }
    // The outside-band and NULL-expiry documents never alerted.
    const outsideRows = await notificationsFor([
      `hr:document-expiry:${spec.employeeId}:${outside.id}:30`,
      `hr:document-expiry:${spec.employeeId}:${noExpiry.id}:30`,
    ]);
    expect(outsideRows).toHaveLength(0);

    // THE RE-RUN (BR-091's structural proof): nothing new — the
    // uq_notifications_dedupe refuses every key a second time.
    const beforeCount = (await notificationsFor(keys)).length;
    const secondRun = await withTenant(TENANT_HS, () => alertsSvc.runExpirySweep());
    expect(secondRun.perKind["document-expiry"]).toBeGreaterThanOrEqual(4);
    const afterCount = (await notificationsFor(keys)).length;
    expect(afterCount).toBe(beforeCount);
    expect(secondRun.notified).toBe(0);
  });

  it("(b2) the certification probe (acceptance #4's feed: issuer and expiry intact); NULL expiry never alerts", async () => {
    const cert = await withTenant(TENANT_HS, () =>
      trainingSvc.registerCertification({
        employeeId: spec.employeeId!,
        name: "W-3 Sweep Cert",
        nameAr: null,
        issuer: "Sweep Issuer",
        issueDate: "2025-06-01",
        expiryDate: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
        certificateNumber: "SW-CERT-1",
        notes: null,
        actorId: H_ACTOR,
      }),
    );
    const nullCert = await withTenant(TENANT_HS, () =>
      trainingSvc.registerCertification({
        employeeId: spec.employeeId!,
        name: "W-3 No Expiry Cert",
        nameAr: null,
        issuer: "Sweep Issuer",
        issueDate: "2025-06-01",
        expiryDate: null,
        certificateNumber: "SW-CERT-2",
        notes: null,
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_HS, () => alertsSvc.runExpirySweep());
    const rows = await notificationsFor([
      `hr:certification-expiry:${spec.employeeId}:${cert.id}:30`,
      `hr:certification-expiry:${spec.employeeId}:${nullCert.id}:30`,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body.en).toContain("Sweep Cert");
    expect(rows[0]!.body.en).toContain("Sweep Issuer");
  });

  it("(b3) the probation probe rides the FAIL-OPEN substrate: NULL probation_end NEVER alerts (amendment A-1 — no alert fabricated)", async () => {
    await withTenant(TENANT_HS, () => alertsSvc.runExpirySweep());
    const rows = await notificationsFor([
      `hr:probation-end:${spec.employeeId}:-:7`,
      `hr:probation-end:${spec.nullProbationEmployeeId}:-:7`,
      `hr:probation-end:${spec.nullProbationEmployeeId}:-:30`,
    ]);
    // The tracked employee's +5-day probation fires the 7-band key
    // (with the documented dash placeholder); the NULL employee never
    // appears — no key, no fabricated alert.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupe_key).toBe(`hr:probation-end:${spec.employeeId}:-:7`);
    expect(rows[0]!.body.en).toContain("probation");
  });

  it("(b4) the review-due probe: the LIVE cycle's window fires; DRAFT never does; NULL due date never does", async () => {
    const liveCycle = await withTenant(TENANT_HS, () =>
      performanceSvc.createCycle({
        name: `W-3 sweep cycle ${Date.now() % 100000}`,
        nameAr: null,
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        reviewDueDate: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
        scopeOrgUnitIds: [],
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_HS, () => performanceSvc.transitionCycle(liveCycle.id, "activate", H_ACTOR));
    const draftCycle = await withTenant(TENANT_HS, () =>
      performanceSvc.createCycle({
        name: `W-3 draft cycle ${Date.now() % 100000}`,
        nameAr: null,
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        reviewDueDate: new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
        scopeOrgUnitIds: [],
        actorId: H_ACTOR,
      }),
    );
    const nullDueCycle = await withTenant(TENANT_HS, () =>
      performanceSvc.createCycle({
        name: `W-3 null-due cycle ${Date.now() % 100000}`,
        nameAr: null,
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        reviewDueDate: null,
        scopeOrgUnitIds: [],
        actorId: H_ACTOR,
      }),
    );
    await withTenant(TENANT_HS, () => performanceSvc.transitionCycle(nullDueCycle.id, "activate", H_ACTOR));
    await withTenant(TENANT_HS, () => alertsSvc.runExpirySweep());
    const rows = await notificationsFor([
      `hr:review-due:-:${liveCycle.id}:30`,
      `hr:review-due:-:${draftCycle.id}:30`,
      `hr:review-due:-:${nullDueCycle.id}:30`,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dedupe_key).toBe(`hr:review-due:-:${liveCycle.id}:30`);
    expect(rows[0]!.body.en).toContain(liveCycle.name);
  });
});

describe("PHASE-047 W-3 — (c) the config row: the 044 pattern (defaults, custom thresholds, the off switch, the stamped run stats)", () => {
  it("(c1) the custom thresholds re-band the sweep; the run stats stamp; the explicit off switch skips everything", async () => {
    // (b) proved the defaults fire with NO row registered. Now the
    // custom ladder [14]: a +10-day document falls in the single
    // (-∞,14] band and fires its :14 key.
    const within14 = await seedDocument(spec.employeeId!, "PASSPORT", 10, "PP-777");
    const job = await withTenant(TENANT_HS, () =>
      alertsSvc.upsertJob({ thresholds: [14], isActive: true, note: "W-3 custom", actorId: H_ACTOR }),
    );
    expect(job.thresholds).toEqual([14]);
    expect(job.isActive).toBe(true);
    const run = await withTenant(TENANT_HS, () => alertsSvc.runExpirySweep());
    expect(run.windows).toEqual([14]);
    const rows = await notificationsFor([
      `hr:document-expiry:${spec.employeeId}:${within14.id}:14`,
    ]);
    expect(rows).toHaveLength(1);
    // The run stats stamped on the config row.
    const stamped = await withTenant(TENANT_HS, () => findAlertJob("EXPIRY_SWEEP"));
    expect(stamped!.lastRunAt).not.toBeNull();
    expect(stamped!.lastFlagged).toBeGreaterThanOrEqual(1);
    // THE OFF SWITCH: is_active = false skips the whole pass — a
    // fresh in-band document never alerts (absent ≠ inactive, but an
    // explicit false is the tenant's decision).
    const suppressed = await seedDocument(spec.employeeId!, "IQAMA", 5, "IQ-888");
    await withTenant(TENANT_HS, () =>
      alertsSvc.upsertJob({ thresholds: [14], isActive: false, note: null, actorId: H_ACTOR }),
    );
    const skipped = await withTenant(TENANT_HS, () => alertsSvc.runExpirySweep());
    expect(skipped.skippedInactive).toBe(true);
    const suppressedRows = await notificationsFor([
      `hr:document-expiry:${spec.employeeId}:${suppressed.id}:14`,
    ]);
    expect(suppressedRows).toHaveLength(0);
    // The garbage upsert never disables the sweep: the fail-closed
    // normalize fires the documented defaults.
    const sanitized = await withTenant(TENANT_HS, () =>
      alertsSvc.upsertJob({ thresholds: [], isActive: true, note: null, actorId: H_ACTOR }),
    );
    expect(sanitized.thresholds).toEqual([30, 7, 0]);
  });
});
