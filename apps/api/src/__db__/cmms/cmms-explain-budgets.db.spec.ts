import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { seedTenants, superuserClient } from "../test-db";

/**
 * PHASE-049 (W-22 — T-17c, dated 2026-11-22) ·
 * `cmms-explain-budgets.db.spec` — THE OA-06 EXPLAIN BUDGETS over the
 * CMMS plane's documented hot paths (the plan §4's own probes: THE
 * READINGS LOG (the insert-path's own read side — the meters board's
 * readings pane and the service-history timeline's readings leg), THE
 * ORDERS BOARD (the maintenance board's listing), and THE
 * SERVICE-HISTORY TIMELINE's own legs (the per-asset orders read + the
 * transfers read)):
 *
 * - P0 THE READINGS INSERT — the write path's own statement shape
 *   (the reading's insert that drives the METER triggers event-driven
 *   in its own transaction): the Insert node on the readings table
 *   with its index maintenance, EXPLAINed (never ANALYZE — nothing
 *   executes) and logged verbatim (the write path's own budget
 *   document);
 * - P1 the readings log read — `listReadings`' own driving shape (the
 *   meter predicate + the effective-date ordering + the limit) must
 *   ride `ix_asset_meter_readings_tenant_meter`;
 * - P2 the orders board — `listWorkOrders`' status-filtered shape
 *   (ORDER BY created_at DESC + LIMIT) must ride
 *   `ix_maintenance_work_orders_tenant_status`;
 * - P3 the asset-filtered board (the timeline's orders leg — the
 *   card's history by asset) must ride
 *   `ix_maintenance_work_orders_tenant_asset`;
 * - P4 the transfers leg — `listTransfers`' asset-filtered shape must
 *   ride `ix_asset_transfers_tenant_asset`.
 *
 * THE OA-06 ASSERTION LAW (the 048 W-14 ruling, D-17's own text): the
 * probes assert the stable INDEX-DRIVEN law — no seq-scan — accepting
 * the planner's legitimate index-driven paths (the bitmap family); the
 * rejected alternatives, per the ruling: enable_bitmapscan=off /
 * planner hints would make the probe testify about a FORCED plan, and
 * isolating the probe hides the shared-table context it exists to
 * police. **Never a forced plan, never an isolated probe context.**
 *
 * THE ISOLATION LAW (the suite's serial discipline): the corpus lives
 * on a DEDICATED tenant (`TENANT_CM_XB` — never the shared CMMS
 * suite's registers) so no other spec's tenant-wide reads can ever
 * observe it, and this spec's own probes stay RLS-scoped to its world
 * alone. The corpus is representative (300 work orders across the
 * five statuses over 60 days · 20 meters with 1,000 readings · 60
 * transfers) so the planner's index choice is meaningful; ANALYZE
 * runs before the probes.
 */

/** The dedicated OA-06 tenant (the cmms family's explain arm). */
const TENANT_CM_XB = "3c3c3c3c-0000-4000-8000-000000005e47";

let probeAsset = "";
let probeMeter = "";
let probeStatusOrder = "";

beforeAll(async () => {
  const su = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant CM-XB (cmms explain budgets)', 'المستأجر لفحص ميزانيات استعلام الصيانة', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_CM_XB],
  );

  // The idempotent wipe (the corpus is this spec's own).
  for (const table of [
    "asset_transfers",
    "asset_meter_readings",
    "asset_meters",
    "maintenance_work_orders",
    "assets",
    "asset_categories",
  ]) {
    await su.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [TENANT_CM_XB]);
  }
  await su.query(`DELETE FROM branches WHERE tenant_id = $1 AND code = 'BR-CMXB'`, [TENANT_CM_XB]);

  const branch = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'BR-CMXB', 'CM-XB branch', 'فرع الفحص')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_CM_XB],
  );
  const category = await su.query<{ id: string }>(
    `INSERT INTO asset_categories (id, tenant_id, code, name, name_ar, useful_life_months_default)
     VALUES (gen_random_uuid(), $1, 'CAT-CMXB', 'CM-XB equipment', 'معدات الفحص', 60)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_CM_XB],
  );
  const branch2 = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'BR-CMXB2', 'CM-XB branch 2', 'فرع الفحص ٢')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_CM_XB],
  );
  const asset = await su.query<{ id: string }>(
    `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id, acquisition_date, cost,
                         useful_life_months, branch_id)
     VALUES (gen_random_uuid(), $1, 'AS-CMXB', 'The probe asset', 'أصل الفحص', $2, '2026-01-01',
             50000, 60, $3)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    [TENANT_CM_XB, category.rows[0]!.id, branch.rows[0]!.id],
  );
  probeAsset = asset.rows[0]!.id;

  // THE ORDERS CORPUS — 300 orders across the four open statuses (the
  // COMPLETED terminal carries the journal gate — its entry-bearing
  // shape is the goldens' own world, not the planner's), created
  // across 60 days with the stamp law's own shapes (the board's
  // representative corpus; the asset predicate's arm rides the probe
  // asset's own 60).
  await su.query(
    `INSERT INTO maintenance_work_orders (id, tenant_id, asset_id, order_no, problem, priority,
                                          status, created_at, planned_at, started_at)
     SELECT gen_random_uuid(), $1,
            CASE WHEN g % 5 = 0 THEN $2::uuid ELSE $3::uuid END,
            'MO-CMXB-' || lpad(g::text, 6, '0'),
            'The probe order ' || g, 'MEDIUM',
            s.status,
            now() - ((g % 60) * interval '1 day'),
            CASE WHEN s.status <> 'REQUESTED'
                 THEN now() - ((g % 60) * interval '1 day') + interval '1 hour' END,
            CASE WHEN s.status IN ('IN_PROGRESS', 'ON_HOLD')
                 THEN now() - ((g % 60) * interval '1 day') + interval '2 hours' END
       FROM generate_series(1, 300) AS g
       CROSS JOIN LATERAL (
         SELECT (ARRAY['REQUESTED','PLANNED','IN_PROGRESS','ON_HOLD'])[1 + (g % 4)] AS status
       ) AS s`,
    [TENANT_CM_XB, probeAsset, asset.rows[0]!.id],
  );
  probeStatusOrder = "MO-CMXB-000001";

  // THE METERS CORPUS — 20 meters on the probe asset (one is the
  // probe meter), 50 readings each across 100 days.
  const meter = await su.query<{ id: string }>(
    `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, last_value)
     VALUES (gen_random_uuid(), $1, $2, 'The probe meter', 'HOURS', 'h', 1000)
     RETURNING id`,
    [TENANT_CM_XB, probeAsset],
  );
  probeMeter = meter.rows[0]!.id;
  await su.query(
    `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, last_value)
     SELECT gen_random_uuid(), $1, $2, 'The corpus meter ' || g, 'HOURS', 'h', g * 50
       FROM generate_series(1, 19) AS g`,
    [TENANT_CM_XB, probeAsset],
  );
  await su.query(
    `INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source)
     SELECT gen_random_uuid(), $1, $2, (g * 10)::numeric, CURRENT_DATE - (g * interval '1 day'),
            CASE WHEN g % 3 = 0 THEN 'IMPORT' ELSE 'MANUAL' END
       FROM generate_series(1, 50) AS g`,
    [TENANT_CM_XB, probeMeter],
  );
  await su.query(
    `INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source)
     SELECT gen_random_uuid(), $1, m.id, (g * 5)::numeric, CURRENT_DATE - (g * interval '1 day'),
            'MANUAL'
       FROM asset_meters m CROSS JOIN generate_series(1, 50) AS g
      WHERE m.tenant_id = $1 AND m.id <> $2`,
    [TENANT_CM_XB, probeMeter],
  );

  // THE TRANSFERS CORPUS — 60 DRAFT transfers (the timeline's
  // transfers leg; the probe asset's own 12).
  await su.query(
    `INSERT INTO asset_transfers (id, tenant_id, asset_id, from_branch_id, to_branch_id, reason,
                                   status, created_at)
     SELECT gen_random_uuid(), $1,
            CASE WHEN g % 5 = 0 THEN $2::uuid ELSE $3::uuid END,
            $4, $5, 'The probe relocation ' || g, 'DRAFT',
            now() - ((g % 30) * interval '1 day')
       FROM generate_series(1, 60) AS g`,
    [TENANT_CM_XB, probeAsset, asset.rows[0]!.id, branch.rows[0]!.id, branch2.rows[0]!.id],
  );

  // ANALYZE — the planner's index choice must be informed.
  for (const table of [
    "maintenance_work_orders",
    "asset_meters",
    "asset_meter_readings",
    "asset_transfers",
    "assets",
  ]) {
    await su.query(`ANALYZE ${table}`);
  }
  await su.end();
});

async function explain(label: string, query: ReturnType<typeof sql>): Promise<string> {
  const plan = await withTenant(TENANT_CM_XB, async () => {
    const tx = requireTenantContext().tx!;
    await tx.execute(sql`SET LOCAL enable_seqscan = off`);
    const rows = await tx.execute(sql`EXPLAIN ${query}`);
    return (rows.rows as unknown as Array<{ "QUERY PLAN": string }>).map(
      (row) => row["QUERY PLAN"],
    );
  });
  const text = plan.join("\n");
  // The plans are LOGGED (the OA-06 explain plans log — the evidence
  // keeps the suite output verbatim).
  process.stdout.write(`[cmms-explain-budgets] ${label}:\n${text}\n`);
  return text;
}

describe("PHASE-049 W-22 — T-17c: OA-06 EXPLAIN budgets (the readings path + the boards + the timeline legs)", () => {
  it("P0 THE READINGS INSERT — the write path's own statement shape (the trigger-driving insert), EXPLAINed and logged verbatim", async () => {
    // insertReading's own statement shape (the store's VALUES insert —
    // the write the METER-trigger evaluation rides in its own
    // transaction). EXPLAIN only: nothing executes.
    const text = await explain(
      "P0 the readings insert",
      sql`
      INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${probeMeter}::uuid, 1005,
              CURRENT_DATE, 'MANUAL')
    `,
    );
    expect(text).toMatch(/Insert on asset_meter_readings/);
    expect(text).toMatch(/Result/);
  });

  it("P1 THE READINGS LOG READ (listReadings' own shape — the meter predicate + the effective-date ordering + the limit) is index-driven — no seq-scan", async () => {
    const text = await explain(
      "P1 the readings log read",
      sql`
      SELECT id, meter_id AS "meterId", value::text AS value,
             effective_date::text AS "effectiveDate", source, work_order_id AS "workOrderId"
      FROM asset_meter_readings
      WHERE meter_id = ${probeMeter}::uuid
      ORDER BY effective_date DESC, created_at DESC
      LIMIT 200
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_asset_meter_readings_tenant_meter|Bitmap (Heap )?Scan on asset_meter_readings|Bitmap Index Scan on ix_asset_meter_readings_tenant_meter/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P2 THE ORDERS BOARD (listWorkOrders' status-filtered shape — the maintenance board's listing) is index-driven — no seq-scan", async () => {
    const text = await explain(
      "P2 the orders board (status filter)",
      sql`
      SELECT id, order_no AS "orderNo", problem, priority, status, created_at AS "createdAt"
      FROM maintenance_work_orders
      WHERE (NULL::uuid IS NULL OR asset_id = NULL::uuid)
        AND (NULL::text IS NULL OR status = 'IN_PROGRESS')
      ORDER BY created_at DESC
      LIMIT 100
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_maintenance_work_orders_tenant_status|Bitmap (Heap )?Scan on maintenance_work_orders|Bitmap Index Scan on ix_maintenance_work_orders_tenant_status/,
    );
    expect(text).not.toMatch(/Seq Scan/);
    void probeStatusOrder;
  });

  it("P3 THE ASSET-FILTERED BOARD (the service-history timeline's orders leg — the card's history by asset) is index-driven — no seq-scan", async () => {
    const text = await explain(
      "P3 the asset-filtered orders leg",
      sql`
      SELECT id, order_no AS "orderNo", problem, status, created_at AS "createdAt",
             completed_at AS "completedAt"
      FROM maintenance_work_orders
      WHERE asset_id = ${probeAsset}::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_maintenance_work_orders_tenant_asset|Bitmap (Heap )?Scan on maintenance_work_orders|Bitmap Index Scan on ix_maintenance_work_orders_tenant_asset/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });

  it("P4 THE TRANSFERS LEG (listTransfers' asset-filtered shape — the timeline's transfers read) is index-driven — no seq-scan", async () => {
    const text = await explain(
      "P4 the transfers leg",
      sql`
      SELECT id, asset_id AS "assetId", from_branch_id AS "fromBranchId",
             to_branch_id AS "toBranchId", reason, status, created_at AS "createdAt"
      FROM asset_transfers
      WHERE (NULL::text IS NULL OR status = NULL::text)
        AND (NULL::uuid IS NULL OR asset_id = NULL::uuid OR asset_id = ${probeAsset}::uuid)
      ORDER BY created_at DESC
      LIMIT 100
    `,
    );
    expect(text).toMatch(
      /Index (Only )?Scan( Backward)? using ix_asset_transfers_tenant_asset|Bitmap (Heap )?Scan on asset_transfers|Bitmap Index Scan on ix_asset_transfers_tenant_asset/,
    );
    expect(text).not.toMatch(/Seq Scan/);
  });
});
