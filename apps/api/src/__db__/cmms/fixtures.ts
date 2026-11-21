import type { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";

/**
 * PHASE-049 (W-16, the foundation wave) — the CMMS suite's LEAN fixture
 * (the hr fixtures' shape, T-03): the dedicated tenant CM + the C_ACTOR
 * user + the 044 register substrate (a branch, an asset category) the
 * schema-floor spec's per-arm worlds build on. Every test world (asset,
 * meter, plan, order) is created PER ARM with its own unique code — the
 * owner's «أذرع الرفض كلٌّ على عالمه» law: a rejection arm never shares
 * mutable rows with another arm; the heavy service worlds (work orders,
 * plans, meters, spares, transfers) land with their W-17/W-18 waves.
 *
 * W-17 extends the family with THE G-59 WORLD (the posting-engine
 * substrate — the projects fixtures' shape): the onboarding-shaped CoA
 * instantiation (provisionCoaTemplate materializes the 0108 §4 markers
 * MAINTENANCE_EXPENSE 5310 · LABOR_CLEARING 2138 · EXTERNAL_ACCRUAL
 * 2137 + the standing INVENTORY purpose), FY2026's OPEN periods, the
 * technician employee (the HR read), the supplier partner, and the
 * parts arm's stock (the item + the warehouse + the WAC position —
 * D-04's worked example: 20 × 40 = 800).
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

// ── W-17: the G-59 world (the posting substrate + the service singletons) ──

/** The service singletons (the projects fixtures' shape — direct
 * construction, no Nest container; the specs run inside withTenant). */
const audit = new AuditService(new DrizzleAuditStore());
export const posting = new PostingService(audit, new PartnerSubledgerService());
export const numbering = new NumberingService(audit);
const periods = new PeriodService(audit);
export { periods };

export interface CmmsG59World {
  technicianEmployeeId: string;
  supplierPartnerId: string;
  itemId: string;
  warehouseId: string;
}

let g59World: CmmsG59World | undefined;

/**
 * THE G-59 WORLD (idempotent — the projects fixtures' shape): the CoA
 * template instantiation (the 0108 §4 markers included), FY2026's OPEN
 * periods (today's postings resolve), the technician, the supplier, and
 * the parts stock (100 × 40 WAC — D-04's worked example issues 20 × 40
 * = 800).
 */
export async function ensureCmmsG59World(): Promise<CmmsG59World> {
  if (g59World !== undefined) return g59World;
  const base = await setupCmmsFixture();
  await withTenant(TENANT_CMMS, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    // FY2026's OPEN REGULAR periods (today's postings resolve; the
    // service is itself idempotent on the name).
    await periods.createYear(CM_ACTOR, {
      name: "FY2026-CM",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
  });
  const su: Client = await superuserClient();
  // The technician (the HR read — the labor leg's subject).
  const employee = await su.query<{ id: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type,
        basic_salary, branch_id)
     VALUES (gen_random_uuid(), $1, 'CM-TECH', 'CM Technician', 'فني الصيانة', '2025-01-01',
        'FULL_TIME', 6000,
        (SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-CM' LIMIT 1))
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_CMMS],
  );
  // The supplier partner (the external leg's subject).
  const partner = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'SUPPLIER', 'CM-SUP', 'CM Calibration Co', 'شركة المعايرة')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_CMMS],
  );
  // The parts arm's stock: the item (WAC, plain — no batch/serial), the
  // warehouse (on the fixture branch), the on-hand position 100 × 40.
  const warehouse = await su.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, code, name, name_ar, branch_id)
     VALUES (gen_random_uuid(), $1, 'CM-WH', 'CM Main Warehouse', 'مستودع الصيانة', $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_CMMS, base.branchId],
  );
  const item = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method,
        base_price)
     VALUES (gen_random_uuid(), $1, 'CM-PART', 'CM Filter Kit', 'طقم فلاتر', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 45)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_CMMS],
  );
  await su.query(
    `INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
     VALUES (gen_random_uuid(), $1, $2, $3, 100, 40)
     ON CONFLICT (tenant_id, item_id, warehouse_id)
     DO UPDATE SET qty = EXCLUDED.qty, avg_cost = EXCLUDED.avg_cost`,
    [TENANT_CMMS, item.rows[0]!.id, warehouse.rows[0]!.id],
  );
  await su.end();
  g59World = {
    technicianEmployeeId: employee.rows[0]!.id,
    supplierPartnerId: partner.rows[0]!.id,
    itemId: item.rows[0]!.id,
    warehouseId: warehouse.rows[0]!.id,
  };
  return g59World;
}
