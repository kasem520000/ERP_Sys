import type { Client } from "pg";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";

/**
 * PHASE-050 (W-24, the foundation wave) — the quality suite's LEAN
 * fixture (the cmms fixtures' shape, T-01…T-04): the dedicated tenant QL
 * + the QL_ACTOR user + the substrate the schema-floor spec's per-arm
 * worlds build on (the master-data basics for uoms, a branch, an asset
 * category + the INSTRUMENT asset — D-08's binding target, an item for
 * the specifications, a customer partner, an item batch for the
 * holds/recall/samples). Every test world (spec, NCR, CAPA, complaint,
 * calibration, COA, hold, recall, review, hazard) is created PER ARM
 * with its own unique natural key — the owner's «أذرع الرفض كلٌّ على
 * عالمه» law: a rejection arm never shares mutable rows with another
 * arm; the heavy service worlds (the G-62/G-63 postings, the sweep, the
 * blocking matrix) land with their W-25…W-28 waves.
 */

export const TENANT_QUALITY = "5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5a";
/** THE ISOLATED BOUNDARY TENANT (the cmms fixtures' TENANT_CMMS_RLS
 * shape): the tenant-boundary arms never assume a SHARED tenant — the
 * empty-world assertion answers on THIS dedicated tenant, empty BY
 * CONSTRUCTION. */
export const TENANT_QUALITY_RLS = "5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5b";
export const QL_ACTOR = "5a5a5a5a-0000-4000-8000-0000000005a1";

export interface QualityFixture {
  branchId: string;
  categoryId: string;
  instrumentAssetId: string;
  itemId: string;
  partnerId: string;
  batchId: string;
}

let fixture: QualityFixture | undefined;

export async function setupQualityFixture(): Promise<QualityFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant QL (quality)', 'المستأجر جو', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant QL-RLS (quality boundary)', 'المستأجر جو للفصل', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_QUALITY, TENANT_QUALITY_RLS],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'quality-actor@fixture.test', 'Quality Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [QL_ACTOR],
  );
  await withTenant(TENANT_QUALITY, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await tenancy.seedMasterDataBasics();
  });
  const branch = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'BR-QL', 'Quality Branch', 'فرع الجودة')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY],
  );
  const category = await su.query<{ id: string }>(
    `INSERT INTO asset_categories (id, tenant_id, code, name, name_ar,
        useful_life_months_default, created_by)
     VALUES (gen_random_uuid(), $1, 'CAT-QL', 'Quality Instruments', 'أجهزة القياس', 60, $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY, QL_ACTOR],
  );
  // THE INSTRUMENT ASSET (D-08 — the calibration binding's target: the
  // instrument IS an asset on the 049 surfaces).
  const asset = await su.query<{ id: string }>(
    `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id, branch_id,
        acquisition_date, cost, useful_life_months, status, created_by)
     VALUES (gen_random_uuid(), $1, 'QL-INST-1', 'Viscometer', 'مقياس اللزوجة', $2, $3,
        '2025-06-01', 18000, 60, 'ACTIVE', $4)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY, category.rows[0]!.id, branch.rows[0]!.id, QL_ACTOR],
  );
  const item = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method,
        base_price)
     VALUES (gen_random_uuid(), $1, 'QL-ITEM', 'QL Syrup Batch Item', 'صنف الشراب', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 45)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY],
  );
  const partner = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'CUSTOMER', 'QL-CUST', 'QL Customer Co', 'عميل الجودة')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY],
  );
  const batch = await su.query<{ id: string }>(
    `INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date)
     VALUES (gen_random_uuid(), $1, $2, 'QL-B-001', '2027-06-30')
     ON CONFLICT (tenant_id, item_id, batch_no) DO UPDATE SET expiry_date = EXCLUDED.expiry_date
     RETURNING id`,
    [TENANT_QUALITY, item.rows[0]!.id],
  );
  await su.end();

  fixture = {
    branchId: branch.rows[0]!.id,
    categoryId: category.rows[0]!.id,
    instrumentAssetId: asset.rows[0]!.id,
    itemId: item.rows[0]!.id,
    partnerId: partner.rows[0]!.id,
    batchId: batch.rows[0]!.id,
  };
  return fixture;
}

/** A FRESH ITEM per arm (the per-arm-world law's substrate for the
 * specifications/COA/NCR worlds — each arm's item carries its own specs,
 * so the (tenant, item, parameter) uniqueness never collides across
 * arms). */
export async function freshQualityItem(code: string): Promise<string> {
  await setupQualityFixture();
  const su: Client = await superuserClient();
  const item = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method,
        base_price)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 45)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY, `QL-ITEM-${code}`, `The ${code} item`, `صنف ${code}`],
  );
  await su.end();
  return item.rows[0]!.id;
}

/** A FRESH BATCH per arm (the holds/recall/samples worlds): a fresh item
 * + its own batch — the one-active-hold partial unique never collides
 * across arms. */
export async function freshQualityBatch(code: string): Promise<{
  itemId: string;
  batchId: string;
}> {
  const itemId = await freshQualityItem(code);
  const su: Client = await superuserClient();
  const batch = await su.query<{ id: string }>(
    `INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date)
     VALUES (gen_random_uuid(), $1, $2, $3, '2027-06-30')
     RETURNING id`,
    [TENANT_QUALITY, itemId, `QL-B-${code}`],
  );
  await su.end();
  return { itemId, batchId: batch.rows[0]!.id };
}
