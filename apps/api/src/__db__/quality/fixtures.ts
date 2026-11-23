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

// ── W-26: the calibration worlds (the per-arm instrument fixtures) ─────────────

/**
 * A FRESH INSTRUMENT ASSET per arm (the per-arm-world law — the CAPA G-63
 * arms and the calibration register's arms never share a mutable
 * instrument): a fresh asset on the QL tenant through the same category +
 * branch the base fixture seeds (D-08: the instrument IS an asset — the
 * binding target).
 */
export async function freshQualityInstrument(code: string): Promise<string> {
  const base = await setupQualityFixture();
  const su: Client = await superuserClient();
  const asset = await su.query<{ id: string }>(
    `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id, branch_id,
        acquisition_date, cost, useful_life_months, status, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6,
        '2025-06-01', 9000, 60, 'ACTIVE', $7)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [
      TENANT_QUALITY,
      `QL-INST-${code}`,
      `The ${code} instrument`,
      `جهاز ${code}`,
      base.categoryId,
      base.branchId,
      QL_ACTOR,
    ],
  );
  await su.end();
  return asset.rows[0]!.id;
}

// ── W-25: the posting world (the G-62 substrate + the service singletons) ───

import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { StockService } from "../../modules/inventory/application/stock-service";

/** The service singletons (the cmms fixtures' shape — direct construction,
 * no Nest container; the specs run inside withTenant). */
const audit = new AuditService(new DrizzleAuditStore());
export const posting = new PostingService(audit, new PartnerSubledgerService());
export const numbering = new NumberingService(audit);
const periods = new PeriodService(audit);
export { periods };
export const stock = new StockService(audit, posting);

export interface QualityPostingWorld {
  /** QL-WH — the default warehouse (the INVENTORY purpose's own account,
   * the provisioned CoA's 1140). */
  warehouseId: string;
  /** QL-WH-B — the override warehouse (its OWN inventory account 1141 —
   * the per-warehouse credit split's own subject). */
  warehouseBId: string;
  warehouseBAccountId: string;
  /** The provisioned CoA's INVENTORY account (1140) — the default leg. */
  inventoryAccountId: string;
}

let postingWorld: QualityPostingWorld | undefined;

/**
 * THE G-62 POSTING WORLD (idempotent — the cmms G-59 world's shape): the
 * QL tenant gets the FULL CoA template instantiation (provisionCoaTemplate
 * — every standing purpose mapping included: INVENTORY 1140 ·
 * INVENTORY_SHRINKAGE 5110 · INVENTORY_APPRECIATION …) + FY2026-QL's OPEN
 * periods (today's postings resolve) + the two warehouses: QL-WH on the
 * INVENTORY purpose's default resolution and QL-WH-B carrying the EXPLICIT
 * per-warehouse inventory_account_id override (a second account 1141
 * created through the tenancy surface) — G-62's per-account credit split
 * has its own substrate.
 */
export async function ensureQualityPostingWorld(): Promise<QualityPostingWorld> {
  if (postingWorld !== undefined) return postingWorld;
  await setupQualityFixture();
  await withTenant(TENANT_QUALITY, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    await periods.createYear(QL_ACTOR, {
      name: "FY2026-QL",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    // The second inventory account (the per-warehouse override's own —
    // created through the tenant's own runtime surface, never a raw poke).
    const inventory = await tenancy.findAccountByCode("1140");
    if ((await tenancy.findAccountByCode("1141")) === undefined) {
      await tenancy.insertAccount({
        code: "1141",
        name: "Inventory — Secondary warehouse",
        nameAr: "المخزون — المستودع الثانوي",
        type: "ASSET",
        parentId: inventory === undefined ? null : inventory.parentId,
        isPostable: true,
      });
    }
    // THE 0008 FAIL-CLOSED GAP the template leaves unmarked (the inventory
    // fixtures' own tenant-setup step): INVENTORY_APPRECIATION → the 4920
    // REVENUE host under 4000 — the world's COUNT_GAIN receipts post
    // through the REAL engine (the receipt's own counter purpose).
    if ((await tenancy.findActivePurpose("INVENTORY_APPRECIATION")) === undefined) {
      let appreciation = await tenancy.findAccountByCode("4920");
      if (appreciation === undefined) {
        const parent = await tenancy.findAccountByCode("4000");
        appreciation = await tenancy.insertAccount({
          code: "4920",
          name: "Inventory appreciation",
          nameAr: "زيادة قيمة المخزون",
          type: "REVENUE",
          parentId: parent === undefined ? null : parent.id,
          isPostable: true,
        });
      }
      await tenancy.insertAccountPurpose({
        purposeKey: "INVENTORY_APPRECIATION",
        accountId: appreciation.id,
        activeFrom: "2025-12-01",
      });
    }
  });
  const base = await setupQualityFixture();
  const su: Client = await superuserClient();
  const inventoryAccount = await su.query<{ id: string }>(
    `SELECT id FROM accounts WHERE tenant_id = $1 AND code = '1140' LIMIT 1`,
    [TENANT_QUALITY],
  );
  const secondAccount = await su.query<{ id: string }>(
    `SELECT id FROM accounts WHERE tenant_id = $1 AND code = '1141' LIMIT 1`,
    [TENANT_QUALITY],
  );
  const warehouseA = await su.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, code, name, name_ar, branch_id)
     VALUES (gen_random_uuid(), $1, 'QL-WH', 'Quality Main Warehouse', 'مستودع الجودة الرئيسي', $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY, base.branchId],
  );
  const warehouseB = await su.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, code, name, name_ar, branch_id, inventory_account_id)
     VALUES (gen_random_uuid(), $1, 'QL-WH-B', 'Quality Second Warehouse', 'مستودع الجودة الثانوي', $2, $3)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name,
       inventory_account_id = EXCLUDED.inventory_account_id
     RETURNING id`,
    [TENANT_QUALITY, base.branchId, secondAccount.rows[0]!.id],
  );
  await su.end();
  postingWorld = {
    warehouseId: warehouseA.rows[0]!.id,
    warehouseBId: warehouseB.rows[0]!.id,
    warehouseBAccountId: secondAccount.rows[0]!.id,
    inventoryAccountId: inventoryAccount.rows[0]!.id,
  };
  return postingWorld;
}

/**
 * A FRESH SCRAP WORLD per arm (the per-arm-world law, the cmms
 * freshPartsWorld precedent): a BATCH-TRACKED item + its own batch + its
 * own warehouse + REAL stock on the batch — the receipt through the
 * inventory module's OWN manualReceipt (the engine's receipt: the
 * stock_moves rows + the item_stock position + the WAC valuation all
 * land through the REAL path, so G-62's on-hand floor and the write-off
 * valuation read the ledger's own rows). The pinned figures ride the
 * G-13 golden's own: 100 × 2.500000 (the write-off of 5 = 12.5000).
 */
export async function freshQualityScrapWorld(code: string): Promise<{
  itemId: string;
  batchId: string;
  warehouseId: string;
}> {
  await ensureQualityPostingWorld();
  const su: Client = await superuserClient();
  const item = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method,
        base_price, track_batch)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 45, true)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY, `QL-SCRAP-${code}`, `The ${code} scrap item`, `صنف الإعدام ${code}`],
  );
  const warehouse = await su.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, code, name, name_ar, branch_id)
     VALUES (gen_random_uuid(), $1, $2, $3, $4,
        (SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-QL' LIMIT 1))
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY, `QL-WH-${code}`, `The ${code} warehouse`, `مستودع ${code}`],
  );
  const batch = await su.query<{ id: string }>(
    `INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date)
     VALUES (gen_random_uuid(), $1, $2, $3, '2027-06-30')
     RETURNING id`,
    [TENANT_QUALITY, item.rows[0]!.id, `QL-B-${code}`],
  );
  await su.end();
  await withTenant(TENANT_QUALITY, () =>
    stock.manualReceipt({
      itemId: item.rows[0]!.id,
      warehouseId: warehouse.rows[0]!.id,
      qty: "100",
      unitCost: "2.500000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-02-01",
      batchId: batch.rows[0]!.id,
      note: `The ${code} scrap world's opening stock`,
      noteAr: `مخزون عالم الإعدام ${code} الافتتاحي`,
      actorId: QL_ACTOR,
    }),
  );
  return {
    itemId: item.rows[0]!.id,
    batchId: batch.rows[0]!.id,
    warehouseId: warehouse.rows[0]!.id,
  };
}

// ── W-27: the supplier-score world (the delivery evidence through the
// REAL purchasing services + the REAL posting engine — the 038 window
// read's own law verbatim) ────────────────────────────────────────────────────

import { PurchaseOrderService } from "../../modules/purchasing/application/orders";
import { GoodsReceiptService } from "../../modules/purchasing/application/goods-receipts";
import { PutawayService } from "../../modules/inventory/application/putaway-service";
import { insertInspection } from "../../modules/manufacturing/infrastructure/manufacturing.store";

/** The service singletons the supplier world drives (the direct-
 * construction precedent; every journal through the REAL engine). */
const putaway = new PutawayService(audit);
export const purchaseOrders = new PurchaseOrderService(audit, numbering);
export const goodsReceipts = new GoodsReceiptService(audit, posting, numbering, putaway);

export interface SupplierQualityWorld {
  supplierId: string;
  itemId: string;
  warehouseId: string;
  branchId: string;
}

let supplierWorldBootstrapped = false;

/**
 * THE GRNI MAPPING (the purchasing fixtures' own tenant-setup step — the
 * §2 purpose without a §3 template marker, the PHASE-007 fail-closed gap
 * recorded): the QL tenant's 2130 (Deferred revenue in the current
 * template) carries the GRNI purpose for the delivery evidence's own
 * postings. Idempotent.
 */
async function ensureQualityGrniMapping(): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  if ((await tenancy.findActivePurpose("GRNI")) === undefined) {
    const accrued = await tenancy.findAccountByCode("2130");
    if (accrued === undefined) {
      throw new Error("the QL world's 2130 account is missing (the posting world must boot first)");
    }
    await tenancy.insertAccountPurpose({
      purposeKey: "GRNI",
      accountId: accrued.id,
      activeFrom: "2025-12-01",
    });
  }
}

/** The current month's first day (the rolling fold's calendar grain —
 * the seeded evidence lands INSIDE the window the specs recompute). */
export function currentMonthStart(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * A FRESH SUPPLIER per arm (the per-arm-world law): a SUPPLIER-kind
 * partner on the QL tenant + the world's standing ids. The first call
 * boots the GRNI mapping (idempotent).
 */
export async function freshQualitySupplier(code: string): Promise<SupplierQualityWorld> {
  const base = await setupQualityFixture();
  const postingWorld = await ensureQualityPostingWorld();
  if (!supplierWorldBootstrapped) {
    await withTenant(TENANT_QUALITY, ensureQualityGrniMapping);
    supplierWorldBootstrapped = true;
  }
  const su: Client = await superuserClient();
  const supplier = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'SUPPLIER', $2, $3, $4)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_QUALITY, `QL-SUP-${code}`, `QL Supplier ${code}`, `مورد ${code}`],
  );
  await su.end();
  return {
    supplierId: supplier.rows[0]!.id,
    itemId: base.itemId,
    warehouseId: postingWorld.warehouseId,
    branchId: base.branchId,
  };
}

/**
 * ONE POSTED DELIVERY: PO (expected date) → issued → GRN (receipt date)
 * → POSTED — every step through the REAL services, the journal through
 * the REAL posting engine (G-07's own path). Optionally a FAIL
 * inspection on the receipt (the incoming-lot rejection — the
 * manufacturing store's own write surface, the FAIL disposition the
 * 0026 CHECK's own demand).
 */
export async function seedSupplierDelivery(input: {
  world: SupplierQualityWorld;
  code: string;
  orderDate: string;
  expectedDate: string | null;
  receiptDate: string;
  failInspection?: boolean;
}): Promise<{ poId: string; grnId: string; inspectionId: string | null }> {
  const { world } = input;
  const order = await withTenant(TENANT_QUALITY, () =>
    purchaseOrders.create({
      branchId: world.branchId,
      supplierId: world.supplierId,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate,
      currencyCode: "SAR",
      exchangeRate: null,
      note: null,
      noteAr: null,
      actorId: QL_ACTOR,
      lines: [
        {
          itemId: world.itemId,
          qty: "10",
          unitPrice: "10.000000",
          taxCodeId: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT_QUALITY, () => purchaseOrders.issue(order.id, QL_ACTOR));
  const orderLines = await withTenant(TENANT_QUALITY, () => purchaseOrders.findWithLines(order.id));
  const receipt = await withTenant(TENANT_QUALITY, () =>
    goodsReceipts.create({
      branchId: world.branchId,
      supplierId: world.supplierId,
      poId: order.id,
      warehouseId: world.warehouseId,
      receiptDate: input.receiptDate,
      poLessReason: null,
      note: null,
      noteAr: null,
      actorId: QL_ACTOR,
      lines: [
        {
          poLineId: orderLines.lines[0]!.id,
          itemId: world.itemId,
          qty: "10",
          unitCost: "10.000000",
          accountId: null,
          batchNo: null,
          batchExpiry: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT_QUALITY, () => goodsReceipts.post(receipt.id, QL_ACTOR));
  let inspectionId: string | null = null;
  if (input.failInspection === true) {
    const inspection = await withTenant(TENANT_QUALITY, () =>
      insertInspection({
        targetType: "goods_receipt",
        orderId: null,
        grnId: receipt.id,
        fgBatchId: null,
        result: "FAIL",
        sampled: true,
        sampleSize: 5,
        disposition: "RETURN_TO_SUPPLIER",
        inspectedAt: `${input.receiptDate}T10:00:00.000Z`,
        note: `Incoming lot rejection ${input.code}`,
        noteAr: null,
        actorId: QL_ACTOR,
      }),
    );
    inspectionId = inspection.id;
  }
  return { poId: order.id, grnId: receipt.id, inspectionId };
}
