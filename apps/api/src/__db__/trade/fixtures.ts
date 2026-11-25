import type { Client } from "pg";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";

/**
 * PHASE-051 (W-33, the foundation wave) — the trade suite's LEAN
 * fixture (the quality/cmms fixtures' shape, T-01…T-04): the dedicated
 * tenant TR + the TR_ACTOR user + the substrate the schema-floor spec's
 * per-arm worlds build on (the master-data basics, a branch, an item,
 * a supplier partner, an item batch, the two warehouses for the bonded
 * moves). Every test world (LC, amendment, checklist, collection,
 * incoterm, B/L, packing list, certificate, declaration, line, HS row,
 * bonded move, drawback claim, tracking event) is created PER ARM with
 * its own unique natural key — the owner's «أذرع الرفض كلٌّ على عالمه»
 * law: a rejection arm never shares mutable rows with another arm; the
 * heavy service worlds (the G-64 postings, the G-65 allocation, the
 * G-66 gate, the sweep) land with their W-34…W-38 waves.
 */

export const TENANT_TRADE = "7c7c7c7c-7c7c-7c7c-7c7c-7c7c7c7c7c7c";
/** THE ISOLATED BOUNDARY TENANT (the quality fixtures' shape): the
 * tenant-boundary arms never assume a SHARED tenant — the empty-world
 * assertion answers on THIS dedicated tenant, empty BY CONSTRUCTION. */
export const TENANT_TRADE_RLS = "7c7c7c7c-7c7c-7c7c-7c7c-7c7c7c7c7c7d";
export const TR_ACTOR = "7c7c7c7c-0000-4000-8000-0000000007c1";

export interface TradeFixture {
  branchId: string;
  itemId: string;
  supplierId: string;
  batchId: string;
  warehouseAId: string;
  warehouseBId: string;
}

let fixture: TradeFixture | undefined;

export async function setupTradeFixture(): Promise<TradeFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant TR (trade)', 'المستأجر تج', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant TR-RLS (trade boundary)', 'المستأجر تج للفصل', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_TRADE, TENANT_TRADE_RLS],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'trade-actor@fixture.test', 'Trade Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [TR_ACTOR],
  );
  await withTenant(TENANT_TRADE, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await tenancy.seedMasterDataBasics();
  });
  const branch = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'BR-TR', 'Trade Branch', 'فرع التجارة')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE],
  );
  const item = await su.query<{ id: string }>(
    `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, costing_method,
        base_price)
     VALUES (gen_random_uuid(), $1, 'TR-ITEM', 'TR Import Goods', 'صنف الاستيراد', 'STOCK',
        (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS' LIMIT 1), 'WAC', 45)
     ON CONFLICT (tenant_id, sku) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE],
  );
  const supplier = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'SUPPLIER', 'TR-SUP', 'Overseas Supplier', 'المورد الخارجي')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE],
  );
  const batch = await su.query<{ id: string }>(
    `INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date)
     VALUES (gen_random_uuid(), $1, $2, 'TR-B-001', '2027-06-30')
     ON CONFLICT (tenant_id, item_id, batch_no) DO UPDATE SET expiry_date = EXCLUDED.expiry_date
     RETURNING id`,
    [TENANT_TRADE, item.rows[0]!.id],
  );
  const warehouseA = await su.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
     VALUES (gen_random_uuid(), $1, $2, 'TR-BOND', 'Bonded Warehouse')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE, branch.rows[0]!.id],
  );
  const warehouseB = await su.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, branch_id, code, name)
     VALUES (gen_random_uuid(), $1, $2, 'TR-FREE', 'Free Circulation Warehouse')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_TRADE, branch.rows[0]!.id],
  );
  await su.end();

  fixture = {
    branchId: branch.rows[0]!.id,
    itemId: item.rows[0]!.id,
    supplierId: supplier.rows[0]!.id,
    batchId: batch.rows[0]!.id,
    warehouseAId: warehouseA.rows[0]!.id,
    warehouseBId: warehouseB.rows[0]!.id,
  };
  return fixture;
}

/** A fresh LC world per arm: its own LC row with a unique natural key. */
export async function freshTradeLc(
  code: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO letters_of_credit
       (id, tenant_id, lc_no, currency, amount, margin_amount, issuing_bank,
        beneficiary_name, applicant_name, expiry_date, status, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      TENANT_TRADE,
      overrides.lcNo ?? `LC-${code}`,
      overrides.currency ?? "USD",
      overrides.amount ?? 50000,
      overrides.marginAmount ?? 5000,
      overrides.issuingBank ?? "Bank Fixture",
      overrides.beneficiary ?? "Overseas Seller SARL",
      overrides.applicant ?? "TR Trading Co",
      overrides.expiryDate ?? "2027-06-30",
      overrides.status ?? "DRAFT",
      TR_ACTOR,
    ],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** A fresh B/L world per arm: its own bill of lading with a unique bl_no. */
export async function freshTradeBl(code: string): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO bills_of_lading
       (id, tenant_id, bl_no, doc_type, carrier_name, port_of_loading, port_of_discharge,
        shipment_status, created_by)
     VALUES (gen_random_uuid(), $1, $2, 'SEA', 'Fixture Carrier', 'Port Jeddah',
        'Port Rotterdam', 'BOOKED', $3)
     RETURNING id`,
    [TENANT_TRADE, `BL-${code}`, TR_ACTOR],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** A fresh declaration world per arm: its own declaration with a unique no. */
export async function freshTradeDeclaration(
  code: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO customs_declarations
       (id, tenant_id, declaration_no, declaration_type, customs_office, status, currency,
        created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      TENANT_TRADE,
      overrides.declarationNo ?? `DEC-${code}`,
      overrides.declarationType ?? "IMPORT",
      overrides.customsOffice ?? "Jeddah Customs",
      overrides.status ?? "DRAFT",
      overrides.currency ?? "SAR",
      TR_ACTOR,
    ],
  );
  await su.end();
  return row.rows[0]!.id;
}

/**
 * PHASE-051 (W-34, the LC engine wave) — THE LC POSTING WORLD (the
 * quality fixtures' ensureQualityPostingWorld shape, T-05 + T-06): the
 * trade tenant's own accounting substrate for the G-64 journeys — the
 * CoA template instantiated (the 1180 LC_MARGIN_DEPOSIT marker + the
 * template's own BANK_CHARGES mapping ride the same provisioning), the
 * fiscal year FY-TR-FIX with its OPEN 2026-11 REGULAR period (the W-33
 * schema spec's own world, ensured idempotently here so the service
 * specs run in ANY order — the per-arm-world law), and THE TWO BANK
 * ACCOUNTS through the treasury store's own surface (the USD bank the
 * fixture LCs default to — the FX ride's own account — and the SAR
 * bank for the base-currency arms). The heavy service worlds' fixtures
 * (the G-65 allocation, the G-66 gate) extend this shape on their own
 * waves.
 */
export interface TradeLcPostingWorld {
  usdBankId: string;
  sarBankId: string;
  glUsdBankCode: string;
  glSarBankCode: string;
  marginAccountCode: string;
  bankChargesAccountCode: string;
}

let lcPostingWorld: TradeLcPostingWorld | undefined;

export async function ensureTradeLcPostingWorld(): Promise<TradeLcPostingWorld> {
  if (lcPostingWorld !== undefined) return lcPostingWorld;
  await setupTradeFixture();
  await withTenant(TENANT_TRADE, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
  });
  // The fiscal year + the OPEN 2026-11 REGULAR period (the W-33 schema
  // spec's own world, ensured idempotently — the service specs' acts
  // post inside THIS window; the ordering-independence law).
  const su: Client = await superuserClient();
  await su.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date, status)
     VALUES (gen_random_uuid(), $1, 'FY-TR-FIX', '2026-01-01', '2026-12-31', 'OPEN')
     ON CONFLICT DO NOTHING`,
    [TENANT_TRADE],
  );
  await su.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status)
     SELECT gen_random_uuid(), $1, fy.id, '2026-11', 'REGULAR', '2026-11-01', '2026-11-30', 'OPEN'
     FROM fiscal_years fy
     WHERE fy.tenant_id = $1 AND fy.name = 'FY-TR-FIX'
       AND NOT EXISTS (
         SELECT 1 FROM fiscal_periods fp
         WHERE fp.tenant_id = $1 AND fp.fiscal_year_id = fy.id AND fp.name = '2026-11')`,
    [TENANT_TRADE],
  );
  await su.end();
  // The bank accounts through the treasury store's own surface — the
  // template owns ONE bank GL (1121) and uq_cash_accounts_tenant_account
  // is one cash account per GL account, so the FX ride's own account
  // gets its own GL: 1122 (Bank — FX account) created through the
  // tenant's runtime surface (the 0008 group 1120's own child, the
  // quality fixture's second-inventory-account precedent). The SAR bank
  // rides the template's own 1121.
  const world = await withTenant(TENANT_TRADE, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const marginMapping = await tenancy.findActivePurpose("LC_MARGIN_DEPOSIT");
    const chargesMapping = await tenancy.findActivePurpose("BANK_CHARGES");
    const glSarBank = await tenancy.findAccountByCode("1121");
    const banksGroup = await tenancy.findAccountByCode("1120");
    const marginAccount =
      marginMapping === undefined ? undefined : await tenancy.findAccountByCode("1180");
    const chargesAccount =
      chargesMapping === undefined ? undefined : await tenancy.findAccountByCode("5240");
    if (
      marginMapping === undefined ||
      chargesMapping === undefined ||
      glSarBank === undefined ||
      banksGroup === undefined ||
      marginAccount === undefined ||
      chargesAccount === undefined
    ) {
      throw new Error("the trade LC posting world's CoA provisioning is incomplete");
    }
    let glUsdBank = await tenancy.findAccountByCode("1122");
    if (glUsdBank === undefined) {
      glUsdBank = await tenancy.insertAccount({
        code: "1122",
        name: "Bank — FX account",
        nameAr: "البنك — حساب العملات",
        type: "ASSET",
        parentId: banksGroup.id,
        isPostable: true,
      });
    }
    const existing = await treasury.listCashAccounts({ type: "BANK" });
    const usd = existing.find((row) => row.currencyCode === "USD");
    const sar = existing.find((row) => row.currencyCode === "SAR");
    const usdBank =
      usd ??
      (await treasury.insertCashAccount({
        name: "Trade Issuing Bank (USD)",
        nameAr: "بنك الإصدار (دولار)",
        type: "BANK",
        accountId: glUsdBank.id,
        branchId: null,
        currencyCode: "USD",
        createdBy: TR_ACTOR,
      }));
    const sarBank =
      sar ??
      (await treasury.insertCashAccount({
        name: "Trade Issuing Bank (SAR)",
        nameAr: "بنك الإصدار (ريال)",
        type: "BANK",
        accountId: glSarBank.id,
        branchId: null,
        currencyCode: "SAR",
        createdBy: TR_ACTOR,
      }));
    return {
      usdBankId: usdBank.id,
      sarBankId: sarBank.id,
      glUsdBankCode: glUsdBank.code,
      glSarBankCode: glSarBank.code,
      marginAccountCode: marginAccount.code,
      bankChargesAccountCode: chargesAccount.code,
    };
  });
  lcPostingWorld = world;
  return world;
}
