import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { Decimal, generateUuidV7 } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { AssetExpirySweepService } from "../../modules/fixed_assets/application/asset-expiry-sweep-service";
import * as store from "../../modules/fixed_assets/infrastructure/cmms.store";
import { CmmsSweepThresholdsInvalidError } from "../../modules/fixed_assets/domain/cmms-errors";
import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { setupCmmsFixture } from "./fixtures";

/**
 * PHASE-049 (W-19 — T-12) — the asset-expiry sweep + its settings surface +
 * the fleet-light register pinned over real PostgreSQL 16 (the plan §4's
 * `cmms-expiry-sweep.db.spec` — acceptance #8: the 30/7/0-day alerts for
 * warranty, insurance, license — and inspection where tracked —
 * DEDUPLICATED; evidence in the job log (the audit seal) and the
 * notification records).
 *
 * THE CLOCK LAW (the owner's W-19 order: «ساعة مثبتة أو خطوة مشتقة — لا
 * Date.now()+دلتا أبدًا»): the test worlds derive their expiry dates from
 * the DATABASE'S OWN CURRENT_DATE in the seed SQL — the same clock the
 * probes read; no JS wall-clock arithmetic anywhere (the derived step on
 * both sides of the assertion).
 *
 * THE DEDICATED TENANT (the hr sweep spec's TENANT_HS shape): a fresh
 * TENANT_SW with its own owner membership — ownerTarget() is the sweep's
 * notification target, and the dedicated tenant keeps the notification
 * counts clean of the shared tenant's traffic.
 */

const audit = new AuditService(new DrizzleAuditStore());
const sweep = new AssetExpirySweepService(audit, new InboxService());

/** THE DEDICATED SWEEP TENANT + its owner (the reorder-inapp shape). */
const TENANT_SW = "5d5d5d5d-5d5d-5d5d-5d5d-5d5d5d5d5d5a";
const SW_OWNER = "5d5d5d5d-0000-4000-8000-0000000005d5";

interface SwWorld {
  branchId: string;
  categoryId: string;
  vehicleCategoryId: string;
}

const spec: { world?: SwWorld } = {};

/** Seed one asset on the dedicated tenant at a day-offset per class. */
async function seedSweepAsset(
  input: {
    code: string;
    warrantyDays?: number | null;
    insuranceDays?: number | null;
    licenseDays?: number | null;
    inspectionDays?: number | null;
    status?: string;
    category?: "main" | "vehicle";
  },
): Promise<string> {
  const world = spec.world!;
  const su: Client = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id,
        acquisition_date, cost, useful_life_months, branch_id, created_by, status,
        warranty_expiry, insurance_expiry, license_expiry, inspection_expiry)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '2026-01-15', 100000, 60, $6, $7,
        $8,
        (CURRENT_DATE + $9::int)::date, (CURRENT_DATE + $10::int)::date,
        (CURRENT_DATE + $11::int)::date, (CURRENT_DATE + $12::int)::date)
     ON CONFLICT (tenant_id, code) DO UPDATE SET
        warranty_expiry = EXCLUDED.warranty_expiry,
        insurance_expiry = EXCLUDED.insurance_expiry,
        license_expiry = EXCLUDED.license_expiry,
        inspection_expiry = EXCLUDED.inspection_expiry,
        status = EXCLUDED.status
     RETURNING id`,
    [
      TENANT_SW,
      input.code,
      `Asset ${input.code}`,
      `أصل ${input.code}`,
      input.category === "vehicle" ? world.vehicleCategoryId : world.categoryId,
      world.branchId,
      SW_OWNER,
      input.status ?? "ACTIVE",
      input.warrantyDays ?? null,
      input.insuranceDays ?? null,
      input.licenseDays ?? null,
      input.inspectionDays ?? null,
    ],
  );
  await su.end();
  return rows.rows[0]!.id;
}

async function sweepNotifications(): Promise<
  { dedupeKey: string; category: string; severity: string }[]
> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ dedupeKey: string; category: string; severity: string }>(
    `SELECT dedupe_key AS "dedupeKey", category, severity FROM notifications
      WHERE tenant_id = $1 AND category = 'assets' ORDER BY dedupe_key`,
    [TENANT_SW],
  );
  await su.end();
  return rows.rows;
}

async function sweepSealCount(): Promise<number> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_events
      WHERE tenant_id = $1 AND action = 'assets.expiry_sweep_run'`,
    [TENANT_SW],
  );
  await su.end();
  return Number(rows.rows[0]!.n);
}

beforeAll(async () => {
  await setupCmmsFixture();
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant SW (asset sweep)', 'المستأجر د-س', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_SW],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'sw-owner@fixture.test', 'SW Owner', 'x', 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [SW_OWNER],
  );
  // The owner membership (the sweep's in-app target — ownerTarget()).
  const ownerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
    [roleId, TENANT_SW],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
    [roleId, TENANT_SW, ownerTemplate.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_SW, SW_OWNER, roleId],
  );
  // The tenant's substrate: a branch + the main + the vehicle categories
  // (the fleet register's grouping arm).
  const branch = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'BR-SW', 'SW Branch', 'فرع المسح')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_SW],
  );
  const category = await su.query<{ id: string }>(
    `INSERT INTO asset_categories (id, tenant_id, code, name, name_ar,
        useful_life_months_default, created_by)
     VALUES (gen_random_uuid(), $1, 'CAT-SW', 'SW Equipment', 'معدات', 60, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_SW, SW_OWNER],
  );
  const vehicleCategory = await su.query<{ id: string }>(
    `INSERT INTO asset_categories (id, tenant_id, code, name, name_ar,
        useful_life_months_default, created_by)
     VALUES (gen_random_uuid(), $1, 'CAT-VEH', 'SW Vehicles', 'مركبات', 84, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_SW, SW_OWNER],
  );
  await su.end();
  spec.world = {
    branchId: branch.rows[0]!.id,
    categoryId: category.rows[0]!.id,
    vehicleCategoryId: vehicleCategory.rows[0]!.id,
  };
});

describe("PHASE-049 W-19 — the asset-expiry sweep (D-10: the four classes, the disjoint bands, the structural dedupe)", () => {
  it("the default ladder fires each class's CURRENT band once: 30/7/0 with the S-15 severities; outside-the-widest and departed assets never alert", async () => {
    const assetWarranty30 = await seedSweepAsset({ code: "SW-W30", warrantyDays: 20 }); // (7,30]
    const assetInsurance7 = await seedSweepAsset({ code: "SW-I7", insuranceDays: 3 }); // (0,7]
    const assetLicense0 = await seedSweepAsset({ code: "SW-L0", licenseDays: -2 }); // expired — the open floor
    const assetInspection30 = await seedSweepAsset({ code: "SW-N30", inspectionDays: 20 }); // the R-10 fourth
    await seedSweepAsset({ code: "SW-FAR", warrantyDays: 60 }); // outside the widest — never
    await seedSweepAsset({ code: "SW-GONE", warrantyDays: 20, status: "DISPOSED" }); // departed — never

    const outcome = await withTenant(TENANT_SW, () => sweep.runSweep());
    expect(outcome.windows).toEqual([30, 7, 0]);
    expect(outcome.perClass).toEqual({ warranty: 1, insurance: 1, license: 1, inspection: 1 });
    expect(outcome.flagged).toBe(4);
    expect(outcome.notified).toBe(4);

    const records = await sweepNotifications();
    expect(records.map((row) => row.dedupeKey).sort()).toEqual(
      [
        `assets:warranty:${assetWarranty30}:30`,
        `assets:insurance:${assetInsurance7}:7`,
        `assets:license:${assetLicense0}:0`,
        `assets:inspection:${assetInspection30}:30`,
      ].sort(),
    );
    const severityByKey = new Map(records.map((row) => [row.dedupeKey, row.severity]));
    expect(severityByKey.get(`assets:warranty:${assetWarranty30}:30`)).toBe("info");
    expect(severityByKey.get(`assets:insurance:${assetInsurance7}:7`)).toBe("warning");
    expect(severityByKey.get(`assets:license:${assetLicense0}:0`)).toBe("warning");
    for (const row of records) {
      expect(row.category).toBe("assets"); // the 0111-widened domain
    }

    // THE SEAL (the job log): the audit record carries the outcome.
    expect(await sweepSealCount()).toBe(1);
  });

  it("THE DEDUPE (the structural once-per-pass): the re-run converges — flagged counts again, ZERO new notifications, no accumulation", async () => {
    const outcome = await withTenant(TENANT_SW, () => sweep.runSweep());
    expect(outcome.flagged).toBe(4); // the flags still count (the run happened)
    expect(outcome.notified).toBe(0); // the dedupe keys already consumed
    const records = await sweepNotifications();
    expect(records).toHaveLength(4); // nothing accumulated
    expect(await sweepSealCount()).toBe(2); // every pass seals (the job log's own law)
  });

  it("THE SETTINGS SURFACE (the first 049 settings keys): the typed write lands the SAME row the generic surface writes; the custom ladder governs the next pass; garbage at the fold reads as the documented default (fail-closed)", async () => {
    // The typed write: the normalized ladder lands.
    const written = await withTenant(TENANT_SW, () =>
      sweep.writeThresholds({ thresholds: [25, 25, 10], actorId: SW_OWNER }),
    );
    expect(written.thresholds).toEqual([25, 10]); // dedup + descending — the pure fold
    const config = await withTenant(TENANT_SW, () => sweep.effectiveConfig());
    expect(config.stored).toBe(true);
    expect(config.thresholds).toEqual([25, 10]);
    expect(config.default).toEqual([30, 7, 0]);

    // The custom ladder governs: the +20 asset (inside 25) fires the 25
    // band now; the +28 stays outside.
    await seedSweepAsset({ code: "SW-CUSTOM-IN", warrantyDays: 20 });
    await seedSweepAsset({ code: "SW-CUSTOM-OUT", warrantyDays: 28 });
    const outcome = await withTenant(TENANT_SW, () => sweep.runSweep());
    expect(outcome.windows).toEqual([25, 10]);
    // warranty now: SW-W30 (+20, in 25) + SW-CUSTOM-IN (+20, in 25) — two
    // hits; SW-CUSTOM-OUT (+28) outside; the prior bands' keys consumed.
    expect(outcome.perClass.warranty).toBe(2);

    // The registry schema's refusal surfaces under the wave's own name.
    const refused = await withTenant(TENANT_SW, () =>
      sweep
        .writeThresholds({ thresholds: [30, -7, 1.5], actorId: SW_OWNER })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(CmmsSweepThresholdsInvalidError);

    // The fail-closed fold: a garbage row seeded RAW (bypassing the typed
    // write) still reads as the documented default — never a disable.
    const su: Client = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
       VALUES (gen_random_uuid(), $1, 'assets.expiry_sweep_thresholds', '["garbage", null, -5]', $2)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = EXCLUDED.value`,
      [TENANT_SW, SW_OWNER],
    );
    await su.end();
    const afterGarbage = await withTenant(TENANT_SW, () => sweep.effectiveConfig());
    expect(afterGarbage.thresholds).toEqual([30, 7, 0]);
  });

  it("THE FLEET-LIGHT REGISTER (R-10): the four chips with SQL-derived days + the odometer binding; ACTIVE only; the category filter is the caller's", async () => {
    // A vehicle-class asset with the odometer binding.
    const vehicleId = await seedSweepAsset({
      code: "SW-TRUCK-1",
      category: "vehicle",
      licenseDays: 15,
      insuranceDays: -1,
    });
    await withTenant(TENANT_SW, async () => {
      await store.insertMeter({
        assetId: vehicleId,
        name: "Odometer",
        nameAr: "عداد المسافة",
        type: "KM",
        unit: "km",
        isOdometer: true,
        lastValue: "88000",
        note: null,
        noteAr: null,
        createdBy: SW_OWNER,
      });
    });

    await withTenant(TENANT_SW, async () => {
      const rows = await sweep.fleetLight({});
      const truck = rows.find((row) => row.code === "SW-TRUCK-1");
      expect(truck).toBeDefined();
      expect(truck!.odometerMeterId).not.toBeNull();
      // The numeric column's text form carries its scale (88000.000000) —
      // the decimal-aware comparison, the spares spec's expectDec shape.
      expect(new Decimal(truck!.odometerValue ?? "0").toString()).toBe("88000");
      expect(truck!.odometerUnit).toBe("km");
      expect(truck!.licenseDays).toBe(15);
      expect(truck!.insuranceDays).toBe(-1); // expired — the chip carries the truth
      expect(truck!.categoryCode).toBe("CAT-VEH");
      // The departed asset never rows the register.
      expect(rows.find((row) => row.code === "SW-GONE")).toBeUndefined();
      // The category filter is the caller's (the vehicle-class grouping).
      const vehiclesOnly = await sweep.fleetLight({
        categoryIds: [spec.world!.vehicleCategoryId],
      });
      expect(vehiclesOnly.every((row) => row.categoryCode === "CAT-VEH")).toBe(true);
      expect(vehiclesOnly.find((row) => row.code === "SW-W30")).toBeUndefined();
    });
  });
});
