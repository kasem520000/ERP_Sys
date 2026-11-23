import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { QualityCalibrationSweepService } from "../../modules/quality/application/quality-calibration-sweep-service";
import { CalibrationSweepThresholdsInvalidError } from "../../modules/quality/domain/quality-errors";
import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { setupQualityFixture } from "./fixtures";

/**
 * PHASE-050 (W-26 — T-08, 2026-11-23) — the quality-calibration-due sweep +
 * its settings surface pinned over real PostgreSQL 16 (the plan §4's own
 * isolate — THE FIFTH standing isolate, joining soak · fcm · email · the
 * cmms sweep from THIS wave per the master plan §0c (2); acceptance #8's
 * sweep arms): the 30/7/0-day alerts bound to instrument assets, the
 * LATEST calibration record's due date the sweep's own anchor, the
 * DEDUPE structural (the per-cycle day axis — a re-calibrated instrument
 * re-alerts in its NEXT cycle, re-runs/the nightly cron/races all
 * converge within one), the latest-wins read (a superseded due date
 * never alerts), and the settings surface (the typed write · the custom
 * ladder governs · the garbage row fails-closed to [30,7,0] · the
 * registry's refusal re-surfaced under the wave's own name).
 *
 * THE CLOCK LAW (the owner's standing order: «ساعة مثبتة أو خطوة مشتقة —
 * لا Date.now()+دلتا أبدًا»): the test worlds derive their due dates from
 * the DATABASE'S OWN CURRENT_DATE in the seed SQL — the same clock the
 * probe reads AND the same clock the assertions derive their expected
 * dates from (dueDateOf below runs `SELECT (CURRENT_DATE + N)` — the
 * derived step on BOTH sides of every assertion); no JS wall-clock
 * arithmetic anywhere.
 *
 * THE DEDICATED TENANT (the cmms sweep spec's TENANT_SW shape): a fresh
 * TENANT_QSW with its own owner membership — ownerTarget() is the
 * sweep's notification target, and the dedicated tenant keeps the
 * notification counts clean of the shared tenant's traffic.
 */

const audit = new AuditService(new DrizzleAuditStore());
const sweep = new QualityCalibrationSweepService(audit, new InboxService());

/** THE DEDICATED SWEEP TENANT + its owner. */
const TENANT_QSW = "5a6a5a6a-5a5a-5a5a-5a5a-5a5a5a5a5a6a";
const QSW_OWNER = "5a6a5a6a-0000-4000-8000-0000000005a6";

const spec: { world?: { branchId: string; categoryId: string } } = {};

/**
 * The expected due date at a day-offset — read from the DATABASE'S OWN
 * clock (the derived step on the assertion's side; memoized per offset
 * so one connection serves every arm).
 */
const dueDateCache = new Map<number, string>();
async function dueDateOf(days: number): Promise<string> {
  const cached = dueDateCache.get(days);
  if (cached !== undefined) return cached;
  const su: Client = await superuserClient();
  const rows = await su.query<{ d: string }>(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [days]);
  await su.end();
  const value = rows.rows[0]!.d;
  dueDateCache.set(days, value);
  return value;
}

/**
 * Seed one instrument asset + its calibration record at a day-offset
 * (the derived step: due_date = CURRENT_DATE + N inside the seed SQL —
 * the same clock the probe reads).
 */
async function seedInstrument(input: {
  code: string;
  dueDays: number;
  calibratedDaysAgo?: number;
  status?: string;
}): Promise<string> {
  const world = spec.world!;
  const su: Client = await superuserClient();
  const asset = await su.query<{ id: string }>(
    `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id, branch_id,
        acquisition_date, cost, useful_life_months, status, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, '2025-06-01', 9000, 60, $7, $8)
     ON CONFLICT (tenant_id, code) DO UPDATE SET status = EXCLUDED.status
     RETURNING id`,
    [
      TENANT_QSW,
      input.code,
      `Instrument ${input.code}`,
      `جهاز ${input.code}`,
      world.categoryId,
      world.branchId,
      input.status ?? "ACTIVE",
      QSW_OWNER,
    ],
  );
  await su.query(
    `INSERT INTO calibration_records (id, tenant_id, created_by, calibration_no, asset_id,
        standard_used, result, calibrated_at, due_date)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ISO standard', 'PASS',
        (CURRENT_DATE - $5::int), (CURRENT_DATE + $6::int))`,
    [
      TENANT_QSW,
      QSW_OWNER,
      // The FULL uuid in the number: uuidv7's first 8 chars are a
      // millisecond timestamp — two seeds inside the same millisecond
      // would collide on the (tenant, no) unique. Full entropy never.
      `CAL-QSW-${input.code}-${generateUuidV7()}`,
      asset.rows[0]!.id,
      input.calibratedDaysAgo ?? 365,
      input.dueDays,
    ],
  );
  await su.end();
  return asset.rows[0]!.id;
}

async function sweepNotifications(): Promise<
  { dedupeKey: string; category: string; severity: string }[]
> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ dedupeKey: string; category: string; severity: string }>(
    `SELECT dedupe_key AS "dedupeKey", category, severity FROM notifications
      WHERE tenant_id = $1 AND category = 'quality' ORDER BY dedupe_key`,
    [TENANT_QSW],
  );
  await su.end();
  return rows.rows;
}

async function sweepSealCount(): Promise<number> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_events
      WHERE tenant_id = $1 AND action = 'quality.calibration_sweep_run'`,
    [TENANT_QSW],
  );
  await su.end();
  return Number(rows.rows[0]!.n);
}

beforeAll(async () => {
  await setupQualityFixture();
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant QSW (calibration sweep)', 'المستأجر ق-ك', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_QSW],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'qsw-owner@fixture.test', 'QSW Owner', 'x', 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [QSW_OWNER],
  );
  // The owner membership (the sweep's in-app target — ownerTarget()).
  const ownerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
    [roleId, TENANT_QSW],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
    [roleId, TENANT_QSW, ownerTemplate.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_QSW, QSW_OWNER, roleId],
  );
  // The tenant's substrate: a branch + the instruments category.
  const branch = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'BR-QSW', 'QSW Branch', 'فرع المعايرة')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QSW],
  );
  const category = await su.query<{ id: string }>(
    `INSERT INTO asset_categories (id, tenant_id, code, name, name_ar,
        useful_life_months_default, created_by)
     VALUES (gen_random_uuid(), $1, 'CAT-QSW', 'QSW Instruments', 'أجهزة المعايرة', 60, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QSW, QSW_OWNER],
  );
  await su.end();
  spec.world = {
    branchId: branch.rows[0]!.id,
    categoryId: category.rows[0]!.id,
  };
});

describe("PHASE-050 W-26 — the quality-calibration-due sweep (D-08: the disjoint bands, the structural per-cycle dedupe)", () => {
  it("the default ladder fires each band once: 30/7/0 with the S-15 severities; outside-the-widest, departed instruments and superseded due dates never alert", async () => {
    const due30 = await seedInstrument({ code: "QSW-30", dueDays: 20 }); // (7,30] — the 30 band
    const due7 = await seedInstrument({ code: "QSW-7", dueDays: 3 }); // (0,7] — the 7 band
    const due0 = await seedInstrument({ code: "QSW-0", dueDays: -2 }); // overdue — the open floor
    await seedInstrument({ code: "QSW-FAR", dueDays: 60 }); // outside the widest — never
    await seedInstrument({ code: "QSW-GONE", dueDays: 20, status: "DISPOSED" }); // departed — never
    // The latest-wins read: an instrument re-calibrated TODAY with its
    // due date moved far — its older in-band record never alerts (the
    // LATEST calibration wins).
    await seedInstrument({ code: "QSW-RENEWED", dueDays: 200, calibratedDaysAgo: 0 });

    const outcome = await withTenant(TENANT_QSW, () => sweep.runSweep());
    expect(outcome.windows).toEqual([30, 7, 0]);
    expect(outcome.flagged).toBe(3);
    expect(outcome.notified).toBe(3);

    const [d20, d3, dm2] = await Promise.all([dueDateOf(20), dueDateOf(3), dueDateOf(-2)]);
    const records = await sweepNotifications();
    expect(records.map((row) => row.dedupeKey).sort()).toEqual(
      [
        `quality:calibration:${due30}:30:${d20}`,
        `quality:calibration:${due7}:7:${d3}`,
        `quality:calibration:${due0}:0:${dm2}`,
      ].sort(),
    );
    const severityByKey = new Map(records.map((row) => [row.dedupeKey, row.severity]));
    expect(severityByKey.get(`quality:calibration:${due30}:30:${d20}`)).toBe("info");
    expect(severityByKey.get(`quality:calibration:${due7}:7:${d3}`)).toBe("warning");
    expect(severityByKey.get(`quality:calibration:${due0}:0:${dm2}`)).toBe("warning");
    for (const row of records) {
      expect(row.category).toBe("quality"); // the 0118-widened domain
    }

    // THE SEAL (the job log): the audit record carries the outcome.
    expect(await sweepSealCount()).toBe(1);
  });

  it("THE DEDUPE (the structural once-per-pass): the re-run converges — flagged counts again, ZERO new notifications, no accumulation", async () => {
    const outcome = await withTenant(TENANT_QSW, () => sweep.runSweep());
    expect(outcome.flagged).toBe(3); // the flags still count (the run happened)
    expect(outcome.notified).toBe(0); // the dedupe keys already consumed
    const records = await sweepNotifications();
    expect(records).toHaveLength(3); // nothing accumulated
    expect(await sweepSealCount()).toBe(2); // every pass seals (the job log's own law)
  });

  it("THE PER-CYCLE RE-ALERT (D-08's day axis): a re-calibration moves the due date far → the instrument stops alerting; a subsequent near-dated cycle alerts AGAIN (the new due date forms NEW keys)", async () => {
    const cycleInstrument = await seedInstrument({ code: "QSW-CYCLE", dueDays: 15 });
    const [d15, d10] = await Promise.all([dueDateOf(15), dueDateOf(10)]);
    // The cycle-1 key fires at the 30 band.
    const first = await withTenant(TENANT_QSW, () => sweep.runSweep());
    expect(first.notified).toBe(1);
    expect(
      (await sweepNotifications()).some(
        (row) => row.dedupeKey === `quality:calibration:${cycleInstrument}:30:${d15}`,
      ),
    ).toBe(true);

    // The re-calibration: a NEW record with the due date moved far —
    // the LATEST record wins (calibrated YESTERDAY so the NEXT cycle's
    // record below is strictly newer — the probe's own tiebreak), the
    // instrument leaves the bands.
    const su: Client = await superuserClient();
    await su.query(
      `INSERT INTO calibration_records (id, tenant_id, created_by, calibration_no, asset_id,
          standard_used, result, calibrated_at, due_date)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'ISO standard', 'PASS',
          (CURRENT_DATE - 1), (CURRENT_DATE + 300))`,
      [TENANT_QSW, QSW_OWNER, `CAL-QSW-CYCLE-B-${generateUuidV7()}`, cycleInstrument],
    );
    await su.end();
    const afterRenewal = await withTenant(TENANT_QSW, () => sweep.runSweep());
    expect(afterRenewal.flagged).toBe(3); // the standing three — the renewed one is GONE
    expect(afterRenewal.notified).toBe(0);

    // The NEXT cycle: the due date approaches again (a near-dated
    // calibration, calibrated TODAY — strictly newer than yesterday's
    // re-calibration) — the NEW due date forms NEW keys and the
    // instrument alerts AGAIN (the cmms once-ever shape would have
    // gone silent).
    await seedInstrument({ code: "QSW-CYCLE", dueDays: 10, calibratedDaysAgo: 0 });
    const second = await withTenant(TENANT_QSW, () => sweep.runSweep());
    expect(second.notified).toBe(1);
    expect(
      (await sweepNotifications()).some(
        (row) => row.dedupeKey === `quality:calibration:${cycleInstrument}:30:${d10}`,
      ),
    ).toBe(true);
  });

  it("THE SETTINGS SURFACE (the first 050 settings keys): the typed write lands the SAME row the generic surface writes; the custom ladder governs the next pass; the garbage row fails-closed to the documented default; the refusal is the wave's own name", async () => {
    // The typed write: the normalized ladder lands.
    const written = await withTenant(TENANT_QSW, () =>
      sweep.writeThresholds({ thresholds: [25, 25, 10], actorId: QSW_OWNER }),
    );
    expect(written.thresholds).toEqual([25, 10]); // dedup + descending — the pure fold
    const config = await withTenant(TENANT_QSW, () => sweep.effectiveConfig());
    expect(config.stored).toBe(true);
    expect(config.thresholds).toEqual([25, 10]);
    expect(config.default).toEqual([30, 7, 0]);
    expect(config.lastRun).not.toBeNull(); // the audit plane is the job log

    // The custom ladder governs: the +20 instruments (inside 25) fire
    // the 25 band now; the +28 stays outside; the 10-band floor keeps
    // the tightest rows.
    await seedInstrument({ code: "QSW-CUSTOM-IN", dueDays: 20 });
    await seedInstrument({ code: "QSW-CUSTOM-OUT", dueDays: 28 });
    const outcome = await withTenant(TENANT_QSW, () => sweep.runSweep());
    expect(outcome.windows).toEqual([25, 10]);
    // The +20 pair (QSW-CUSTOM-IN + the standing QSW-30) fire at 25;
    // the +28 outside; the 10-band open floor catches the +3, the
    // overdue, and the renewal-cycle one (+10).
    expect(outcome.flagged).toBe(5);
    const [d20] = await Promise.all([dueDateOf(20)]);
    const customInId = await knownAsset("QSW-CUSTOM-IN");
    const records = await sweepNotifications();
    expect(
      records.some(
        (row) => row.dedupeKey === `quality:calibration:${customInId}:25:${d20}`,
      ),
    ).toBe(true);

    // The registry schema's refusal surfaces under the wave's own name.
    const refused = await withTenant(TENANT_QSW, () =>
      sweep
        .writeThresholds({ thresholds: [30, -7, 1.5], actorId: QSW_OWNER })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(CalibrationSweepThresholdsInvalidError);
    expect((refused as CalibrationSweepThresholdsInvalidError).code).toBe(
      "CALIBRATION_SWEEP_THRESHOLDS_INVALID",
    );

    // The fail-closed fold: a garbage row seeded RAW (bypassing the
    // typed write) still reads as the documented default — never a
    // disable.
    const su: Client = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
       VALUES (gen_random_uuid(), $1, 'quality.calibration_sweep_thresholds', '["garbage", null, -5]', $2)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = EXCLUDED.value`,
      [TENANT_QSW, QSW_OWNER],
    );
    await su.end();
    const afterGarbage = await withTenant(TENANT_QSW, () => sweep.effectiveConfig());
    expect(afterGarbage.thresholds).toEqual([30, 7, 0]);
  });
});

/** The instrument's asset id by code (the per-arm worlds' own handle). */
async function knownAsset(code: string): Promise<string> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `SELECT id FROM assets WHERE tenant_id = $1 AND code = $2`,
    [TENANT_QSW, code],
  );
  await su.end();
  return rows.rows[0]!.id;
}
