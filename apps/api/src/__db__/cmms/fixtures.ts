import type { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";

/**
 * PHASE-049 (W-16, the foundation wave) — the CMMS suite's LEAN fixture
 * (the hr fixtures' shape, T-03): the dedicated tenant CM + the C_ACTOR
 * user + the 044 register substrate (a branch, an asset category) the
 * schema-floor spec's per-arm worlds build on. Every test world (asset,
 * meter, plan, order) is created PER ARM with its own unique code — the
 * owner's «أذرع الرفض كلٌّ على عالمه» law: a rejection arm never shares
 * mutable rows with another arm; the heavy service worlds (work orders,
 * plans, meters, spares, transfers) land with their W-17/W-18 waves.
 */

export const TENANT_CMMS = "3c3c3c3c-3c3c-3c3c-3c3c-3c3c3c3c3c3c";
/** THE ISOLATED BOUNDARY TENANT (the hr fixtures' TENANT_H_RLS shape):
 * the tenant-boundary arms never assume a SHARED tenant — the empty-world
 * assertion answers on THIS dedicated tenant, empty BY CONSTRUCTION. */
export const TENANT_CMMS_RLS = "3c3c3c3c-3c3c-3c3c-3c3c-3c3c3c3c3c3d";
export const CM_ACTOR = "3c3c3c3c-0000-4000-8000-0000000003c1";

export interface CmmsFixture {
  branchId: string;
  categoryId: string;
}

let fixture: CmmsFixture | undefined;

export async function setupCmmsFixture(): Promise<CmmsFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const suClient: Client = await superuserClient();
  await seedTenants(suClient as never);
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant CM (cmms)', 'المستأجر سم', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant CM-RLS (cmms boundary)', 'المستأجر سم للفصل', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_CMMS, TENANT_CMMS_RLS],
  );
  await suClient.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'cmms-actor@fixture.test', 'CMMS Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [CM_ACTOR],
  );
  const branch = await suClient.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'BR-CM', 'CMMS Branch', 'فرع الصيانة')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_CMMS],
  );
  const category = await suClient.query<{ id: string }>(
    `INSERT INTO asset_categories (id, tenant_id, code, name, name_ar,
        useful_life_months_default, created_by)
     VALUES (gen_random_uuid(), $1, 'CAT-CM', 'CMMS Equipment', 'معدات الصيانة', 60, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_CMMS, CM_ACTOR],
  );
  await suClient.end();

  fixture = {
    branchId: branch.rows[0]!.id,
    categoryId: category.rows[0]!.id,
  };
  return fixture;
}

/**
 * A FRESH ASSET WORLD per arm (the owner's per-arm-world law): every
 * rejection arm builds its own asset — unique code, its own meters/plans/
 * orders — so no arm's residue can influence another's assertions.
 */
export async function freshAsset(
  code: string,
  overrides: { parentAssetId?: string; costCenterId?: string } = {},
): Promise<string> {
  const base = await setupCmmsFixture();
  const su: Client = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id,
        acquisition_date, cost, useful_life_months, branch_id, created_by,
        warranty_expiry, parent_asset_id, cost_center_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, '2026-01-15', 100000, 60, $6, $7,
        '2027-01-15', $8, $9)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [
      TENANT_CMMS,
      code,
      `Asset ${code}`,
      `أصل ${code}`,
      base.categoryId,
      base.branchId,
      CM_ACTOR,
      overrides.parentAssetId ?? null,
      overrides.costCenterId ?? null,
    ],
  );
  await su.end();
  return rows.rows[0]!.id;
}

export { appClient, closeDb, superuserClient, withTenant };
