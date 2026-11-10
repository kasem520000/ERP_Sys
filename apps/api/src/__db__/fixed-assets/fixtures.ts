import { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { CategoryService } from "../../modules/fixed_assets/application/category-service";
import { AssetService } from "../../modules/fixed_assets/application/asset-service";
import { CapitalizationService } from "../../modules/fixed_assets/application/capitalization-service";
import { DepreciationService } from "../../modules/fixed_assets/application/depreciation-service";
import { RunService } from "../../modules/fixed_assets/application/run-service";
import { RevaluationService } from "../../modules/fixed_assets/application/revaluation-service";
import { DisposalService } from "../../modules/fixed_assets/application/disposal-service";

/**
 * PHASE-026 fixed-assets db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production code
 * paths run — every journal flows through PostingService.post (ADR-0007),
 * every register write through the fixed_assets services; nothing inserts
 * GL or register rows directly.
 *
 * Dedicated tenant F (SAR base): the accounting/treasury suites own their
 * tenants' exact-code assertions, so fixed assets consumes its own isolated
 * tenant with the onboarding-shaped CoA substrate (migration 0037's template
 * rows: 1210 FIXED_ASSET, 1220 ACCUM_DEPRECIATION, 3210 REVALUATION_RESERVE,
 * 4910 ASSET_DISPOSAL_GAIN, 5300 DEPRECIATION_EXPENSE, 5910
 * ASSET_DISPOSAL_LOSS — provisioned tenants resolve every FA purpose from
 * day one). A second, minimal tenant (the S-04 spoof target) carries the
 * FOREIGN fixtures the attack suite probes with — ids that exist in the
 * database but belong to another tenant, so the attacks distinguish
 * RLS-scoped lookups from FK leakage (the treasury spoof precedent).
 */

export const F_ACTOR = "aaaaaaaa-0000-4000-8000-0000000000fa";
export const F_APPROVER = "aaaaaaaa-0000-4000-8000-0000000000fb";
export const F_FOREIGN_ACTOR = "aaaaaaaa-0000-4000-8000-0000000000fc";
export const TENANT_F = "6a6a6a6a-6a6a-6a6a-6a6a-6a6a6a6a6a6a";
// PHASE-029 regression hardening: the spoof-target tenant originally rode
// 6b6b6b6b — colliding with crm/time.spec's TENANT_T. The spoof fixture
// seeds that tenant with a raw FY2026 (January period ONLY), so whenever
// the size-sorted file order ran the fixed-assets spoof spec BEFORE
// crm/time.spec, time.spec's findFiscalYearByName("FY2026") guard skipped
// its own 12-month createYear and the billing preview's March lookup
// returned periodStatus NONE (an order-dependent flake). The spoof target
// now owns 7e7e7e7e — verified unused across the whole __db__ tree; the
// spoof ids stay foreign-by-RLS regardless of the specific tenant id.
export const TENANT_F_FOREIGN = "7e7e7e7e-7e7e-7e7e-7e7e-7e7e7e7e7e7e";

/** Deterministic fixed ids for the FOREIGN tenant's S-04 attack targets. */
export const FOREIGN_FIXTURE_IDS = {
  branch: "fb0b0b0b-0000-4000-8000-000000000001",
  category: "fb1b1b1b-0000-4000-8000-000000000001",
  asset: "fb2b2b2b-0000-4000-8000-000000000001",
  fiscalYear: "fb3b3b3b-0000-4000-8000-000000000001",
  fiscalPeriod: "fb4b4b4b-0000-4000-8000-000000000001",
} as const;

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);

export const periods = new PeriodService(audit);
export const categories = new CategoryService(audit);
export const assets = new AssetService(audit);
export const capitalization = new CapitalizationService(audit, posting);
export const depreciation = new DepreciationService();
export const runs = new RunService(audit, posting);
export const revaluations = new RevaluationService(audit, posting);
export const disposals = new DisposalService(audit, posting, numbering);

export { withTenant, appClient, superuserClient, seedTenants, ensureTestDb, closeDb };
export type { Client };

/** Deterministic dates over the fixture timeline (FY2026 of tenant F). */
export const F_JAN = "2026-01-15";
export const F_DISPOSAL_DATE = "2026-05-15";
export const F_REV_DATE = "2026-05-20";

/** GL account ids behind the six fixed-assets purposes (posting asserts). */
export interface FixedAssetsAccountIds {
  fixedAsset: string;
  accumDepreciation: string;
  depreciationExpense: string;
  revaluationReserve: string;
  disposalGain: string;
  disposalLoss: string;
  cash: string;
  openingEquity: string;
}

export interface FixedAssetsFixture {
  fiscalYearId: string;
  /** periodId by period name ("2026-01" … "2026-12"), all OPEN. */
  periodIds: Record<string, string>;
  branchId: string;
  /** the fully-mapped VEH category (all three purposes resolve). */
  vehicleCategoryId: string;
  accountIds: FixedAssetsAccountIds;
}

let fixture: FixedAssetsFixture | undefined;

/** Boots the suite db + tenant F's fixed-assets substrate (idempotent). */
export async function setupFixedAssetsFixture(): Promise<FixedAssetsFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const su = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant F (fixed assets)', 'المستأجر ف', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant F-foreign (spoof target)', 'المستأجر ف-أجنبي', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_F, TENANT_F_FOREIGN],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'fa-actor@fixture.test', 'FA Actor', 'x', 'ACTIVE'),
       ($2, 'fa-approver@fixture.test', 'FA Approver', 'x', 'ACTIVE'),
       ($3, 'fa-foreign@fixture.test', 'FA Foreign', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [F_ACTOR, F_APPROVER, F_FOREIGN_ACTOR],
  );
  // Memberships: actor + approver in tenant F; the foreign actor ONLY in the
  // foreign tenant (the custodian spoof probe — the user exists globally but
  // holds no tenant-F membership, so the A7 lookup must 404 it). The
  // memberships FK is COMPOSITE (role_id, tenant_id), so each tenant needs a
  // tenant-scoped role cloned from the system template (the identity-http
  // seeding pattern) — system templates (tenant_id NULL) never bind directly.
  const cloneTemplateRole = async (
    roleId: string,
    tenantId: string,
    templateKey: string,
    roleKey: string,
  ): Promise<void> => {
    const template = await su.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id IS NULL AND key = $1 LIMIT 1`,
      [templateKey],
    );
    await su.query(
      `INSERT INTO roles (id, tenant_id, key, name, name_ar)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [roleId, tenantId, roleKey, templateKey, "دور"],
    );
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp WHERE rp.role_id = $3
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, tenantId, template.rows[0]!.id],
    );
  };
  const roleOwnerF = "aaaaaaaa-2222-4222-8222-2222222222fa";
  const roleAccountantF = "aaaaaaaa-2222-4222-8222-2222222222fb";
  const roleOwnerForeign = "aaaaaaaa-2222-4222-8222-2222222222fc";
  await cloneTemplateRole(roleOwnerF, TENANT_F, "owner", "fa_owner");
  await cloneTemplateRole(roleAccountantF, TENANT_F, "accountant", "fa_accountant");
  await cloneTemplateRole(roleOwnerForeign, TENANT_F_FOREIGN, "owner", "fa_owner");
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    ["aaaaaaaa-1111-4111-8111-1111111111fa", TENANT_F, F_ACTOR, roleOwnerF],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    ["aaaaaaaa-1111-4111-8111-1111111111fb", TENANT_F, F_APPROVER, roleAccountantF],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    ["aaaaaaaa-1111-4111-8111-1111111111fc", TENANT_F_FOREIGN, F_FOREIGN_ACTOR, roleOwnerForeign],
  );

  // The FOREIGN tenant's S-04 attack targets (isolation-suite seeding style:
  // minimal FK-consistent rows, never posted anywhere — they exist only to
  // be aimed at from tenant F).
  await su.query(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES ($1, $2, 'MAIN', 'Foreign branch', 'فرع أجنبي')
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.branch, TENANT_F_FOREIGN],
  );
  await su.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date)
     VALUES ($1, $2, 'FY2026', '2026-01-01', '2026-12-31')
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.fiscalYear, TENANT_F_FOREIGN],
  );
  await su.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date)
     VALUES ($1, $2, $3, '2026-01', 'REGULAR', '2026-01-01', '2026-01-31')
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.fiscalPeriod, TENANT_F_FOREIGN, FOREIGN_FIXTURE_IDS.fiscalYear],
  );
  await su.query(
    `INSERT INTO asset_categories (id, tenant_id, code, name, name_ar,
        useful_life_months_default, depreciation_method_default, asset_purpose_key,
        accum_depreciation_purpose_key, expense_purpose_key, active)
     VALUES ($1, $2, 'F-VEH', 'Foreign vehicles', 'مركبات أجنبية',
        60, 'STRAIGHT_LINE', 'FIXED_ASSET', 'ACCUM_DEPRECIATION', 'DEPRECIATION_EXPENSE', true)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.category, TENANT_F_FOREIGN],
  );
  await su.query(
    `INSERT INTO assets (id, tenant_id, code, name, name_ar, category_id, acquisition_date,
        cost, salvage_value, opening_accumulated, useful_life_months, depreciation_method,
        branch_id, custodian_user_id, status)
     VALUES ($1, $2, 'F-FOREIGN-001', 'Foreign asset', 'أصل أجنبي', $3, '2026-01-05',
        12000, 0, 0, 60, 'STRAIGHT_LINE', $4, $5, 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [
      FOREIGN_FIXTURE_IDS.asset,
      TENANT_F_FOREIGN,
      FOREIGN_FIXTURE_IDS.category,
      FOREIGN_FIXTURE_IDS.branch,
      F_FOREIGN_ACTOR,
    ],
  );
  await su.end();

  const accountIds = {} as FixedAssetsAccountIds;
  const periodIds: Record<string, string> = {};
  let fiscalYearId = "";
  let branchId = "";
  let vehicleCategoryId = "";

  await withTenant(TENANT_F, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose, listBranches, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { findAccountByCode, findActivePurpose, findFiscalYearByName, listPeriods } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate();
    // Belt-and-braces purpose mapping (the manufacturing-fixture precedent —
    // fail-closed consumers need the mapping present regardless of the
    // provisioning order): the six v2.0 FA purposes (0037 template markers
    // 1210/1220/3210/4910/5300/5910) + the G-21 funding legs.
    const byCode = async (code: string) => {
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account;
    };
    const mapPurpose = async (purposeKey: string, code: string): Promise<string> => {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await byCode(code);
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
      return account.id;
    };
    accountIds.fixedAsset = await mapPurpose("FIXED_ASSET", "1210");
    accountIds.accumDepreciation = await mapPurpose("ACCUM_DEPRECIATION", "1220");
    accountIds.revaluationReserve = await mapPurpose("REVALUATION_RESERVE", "3210");
    accountIds.disposalGain = await mapPurpose("ASSET_DISPOSAL_GAIN", "4910");
    accountIds.depreciationExpense = await mapPurpose("DEPRECIATION_EXPENSE", "5300");
    accountIds.disposalLoss = await mapPurpose("ASSET_DISPOSAL_LOSS", "5910");
    accountIds.cash = await mapPurpose("CASH", "1111");
    accountIds.openingEquity = await mapPurpose("OPENING_EQUITY", "3100");

    // Fiscal year spanning the whole fixed-assets timeline.
    const existingYear = await findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (await periods.createYear(F_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;
    for (const period of await listPeriods(fiscalYearId)) {
      periodIds[period.name] = period.id;
    }

    // Branch + the mapped VEH category (BR-041 green by construction).
    const branches = await listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    branchId = mainBranch.id;

    const existingCategory = (await categories.list({})).find((row) => row.code === "F-VEH");
    vehicleCategoryId =
      existingCategory?.id ??
      (
        await categories.create({
          code: "F-VEH",
          name: "Vehicles (F)",
          nameAr: "مركبات (ف)",
          usefulLifeMonthsDefault: 60,
          depreciationMethodDefault: "STRAIGHT_LINE",
          assetPurposeKey: "FIXED_ASSET",
          accumDepreciationPurposeKey: "ACCUM_DEPRECIATION",
          expensePurposeKey: "DEPRECIATION_EXPENSE",
          note: null,
          noteAr: null,
          actorId: F_ACTOR,
        })
      ).id;
  });

  fixture = { fiscalYearId, periodIds, branchId, vehicleCategoryId, accountIds };
  return fixture;
}

/** Fresh superuser client bound at call time. */
export async function su(): Promise<Client> {
  return superuserClient();
}
