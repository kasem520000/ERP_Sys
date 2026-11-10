import { withTenant } from "../../infra/db/tenant-context";
import {
  ACTOR,
  ensureFiscalYear,
  setupAccountingFixture,
  TENANT_A,
} from "../accounting/fixtures";
import { superuserClient } from "../test-db";

/**
 * PHASE-034 · the consolidation DB fixtures: the fixture GROUP — the OWNER
 * tenant (TENANT_A, SAR base — the accounting fixture's own tenant, so the
 * parent's consolidation books and periods reuse its provisioned CoA) +
 * TWO MEMBER tenants provisioned like tenants (one USD-base member — the
 * FX translation leg; one SAR-base member — the pass-through leg). The
 * owner is itself a group member (ADR-0018: "the owner is itself typically
 * a member").
 *
 * The members get their own fiscal years + the G-32 substrate (AR_CONTROL /
 * AP_CONTROL purposes), and the OWNER's exchange_rates gain the dated USD
 * rate (INV-008 — the translation substrate). Everything is idempotent
 * (lookups before inserts) so suite order never matters.
 */

export const OWNER_TENANT = TENANT_A;
export const MEMBER_USD = "44444444-4444-4444-4444-444444444441";
export const MEMBER_SAR = "44444444-4444-4444-4444-444444444442";
export const MEMBER_ACTOR = "aaaaaaaa-0000-4000-8000-00000000004a";

/** The dated stored rate for USD→SAR at the fixture period end (INV-008). */
export const USD_RATE = "3.75000000";
/** The fixture period (closed for the run scenarios). */
export const PERIOD_MONTH = "2026-11";

export async function setupConsolidationFixture(): Promise<void> {
  await setupAccountingFixture();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Group Member A (USD)', 'الشركة العضو أ', 'USD', 'US', 'UTC'),
       ($2, 'Group Member B (SAR)', 'الشركة العضو ب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [MEMBER_USD, MEMBER_SAR],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'consolidation-actor@fixture.test', 'Consolidation Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [MEMBER_ACTOR],
  );
  // The OWNER's dated USD rate (the translation substrate — the owner
  // reads its own exchange_rates through the ordinary tenant-scoped path).
  await su.query(
    `INSERT INTO exchange_rates (id, tenant_id, currency_code, rate_date, rate, source)
     VALUES (gen_random_uuid(), $1, 'USD', '2026-11-30', $2, 'MANUAL')
     ON CONFLICT (tenant_id, currency_code, rate_date) DO UPDATE SET rate = EXCLUDED.rate`,
    [OWNER_TENANT, USD_RATE],
  );
  await su.end();

  // Member provisioning: the CoA template + the purposes each member's
  // intercompany side needs (the G-32 substrate) + their own fiscal years.
  for (const member of [MEMBER_USD, MEMBER_SAR]) {
    await withTenant(member, async () => {
      const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose } = await import(
        "../../modules/tenancy/infrastructure/tenancy.store"
      );
      await seedMasterDataBasics();
      await provisionCoaTemplate();
      const { findAccountByCode, findActivePurpose } = await import(
        "../../modules/accounting/infrastructure/accounting.store"
      );
      for (const [purposeKey, code] of [
        ["CASH", "1111"],
        ["AR_CONTROL", "1130"],
        ["AP_CONTROL", "2130"],
        ["SALES_REVENUE", "4100"],
      ] as const) {
        if ((await findActivePurpose(purposeKey)) !== undefined) continue;
        const account = await findAccountByCode(code);
        if (account === undefined) throw new Error(`member fixture account ${code} missing`);
        await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2026-01-01" });
      }
    });
    await withTenant(member, async () => {
      const { PeriodService } = await import("../../modules/accounting/application/period-service");
      const { AuditService } = await import("../../modules/audit/api/audit");
      const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
      const periods = new PeriodService(new AuditService(new DrizzleAuditStore()));
      const years = await periods.listYears();
      if (!years.some((year) => year.name === "FY2026")) {
        await periods.createYear(MEMBER_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
      }
    });
  }
}

/** The fixture group (owner + the two members) — idempotent, name-pinned. */
export async function ensureFixtureGroup(): Promise<{
  groupId: string;
  ownerId: string;
  memberAId: string;
  memberBId: string;
}> {
  const store = await import("../../modules/consolidation/infrastructure/consolidation.store");
  let groupId: string | undefined;
  await withTenant(OWNER_TENANT, async () => {
    const rows = await store.listGroups();
    let group = rows.find((row) => row.name === "Gulf Trading Group");
    if (group === undefined) {
      group = await store.insertGroup({
        name: "Gulf Trading Group",
        nameAr: "مجموعة الخليج التجارية",
        baseCurrency: "SAR",
        fxTranslationMethod: "CLOSING_RATE",
        createdBy: ACTOR,
      });
    }
    groupId = group.id;
    for (const [memberTenantId, ownership, includeFrom] of [
      [OWNER_TENANT, "100.0000", null],
      [MEMBER_USD, "100.0000", null],
      [MEMBER_SAR, "80.0000", "2026-01-01"],
    ] as const) {
      if ((await store.findGroupMember(group!.id, memberTenantId)) !== undefined) continue;
      await store.insertGroupMember({
        groupId: group!.id,
        memberTenantId,
        ownershipPercent: ownership,
        includeFrom,
        createdBy: ACTOR,
      });
    }
  });
  if (groupId === undefined) throw new Error("fixture group missing");
  return { groupId, ownerId: OWNER_TENANT, memberAId: MEMBER_USD, memberBId: MEMBER_SAR };
}

/** The owner's November period row (by tenant + month, status included). */
export async function ownerNovemberPeriod(): Promise<{ id: string; status: string; endDate: string }> {
  const su = await superuserClient();
  const result = await su.query(
    `SELECT id, status, end_date::text AS "endDate" FROM fiscal_periods
     WHERE tenant_id = $1 AND start_date <= '2026-11-30' AND end_date >= '2026-11-01'
     ORDER BY start_date LIMIT 1`,
    [OWNER_TENANT],
  );
  await su.end();
  const row = result.rows[0] as { id: string; status: string; endDate: string } | undefined;
  if (row === undefined) throw new Error("owner November period missing — ensureFiscalYear first");
  return row;
}

/** A member's November period row (same lookup, member-scoped). */
export async function memberNovemberPeriod(memberTenantId: string): Promise<{ id: string; status: string }> {
  const su = await superuserClient();
  const result = await su.query(
    `SELECT id, status FROM fiscal_periods
     WHERE tenant_id = $1 AND start_date <= '2026-11-30' AND end_date >= '2026-11-01'
     ORDER BY start_date LIMIT 1`,
    [memberTenantId],
  );
  await su.end();
  const row = result.rows[0] as { id: string; status: string } | undefined;
  if (row === undefined) throw new Error("member November period missing");
  return row;
}

/** Set a period's status directly (the scenario lever — su scope). */
export async function setPeriodStatus(periodId: string, status: string): Promise<void> {
  const su = await superuserClient();
  await su.query(`UPDATE fiscal_periods SET status = $2 WHERE id = $1`, [periodId, status]);
  await su.end();
}

void ensureFiscalYear;
