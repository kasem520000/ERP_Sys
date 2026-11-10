import { and, eq, inArray, notInArray, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import * as schema from "../../../db/schema";
import { getDb, type TenantDb } from "../../../infra/db/client";
import {
  ambientAnyTx,
  ambientPlatformContext,
  requireTenantContext,
  withTenant,
} from "../../../infra/db/tenant-context";

/**
 * Tenancy data access (PHASE-004; DEPENDENCY_RULES §1 infrastructure
 * layer): pure storage, no business rules. Access planes mirror the RLS
 * design:
 * - GLOBAL reference tables (countries, currencies, industry templates,
 *   CoA template, plans) read through the app pool — no RLS by design;
 * - TENANT-owned tables (branches, settings, subscriptions, entitlements,
 *   support sessions, accounts) run inside the ambient tenant transaction
 *   (withTenant / withTenantOnTx);
 * - PLATFORM tables (tenants) via the ambient platform transaction
 *   (withPlatformScope);
 * - the pre-GUC entitlement projection (migration 0006) for the
 *   enforcement guard.
 */

const db = () => getDb();

/** Ambient tenant transaction (services run inside withTenant/withTenantOnTx). */
function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("tenancy access requires an ambient tenant scope");
  }
  return context.tx;
}

/** Ambient platform transaction (console services run inside withPlatformScope). */
function platformTx(): TenantDb {
  const context = ambientPlatformContext();
  if (context === undefined || context.tx === undefined) {
    throw new Error("platform-plane tenancy access requires an ambient platform scope");
  }
  return context.tx;
}

// ---------------------------------------------------------------------------
// Global reference tables

export interface CountryRow {
  code: string;
  name: string;
  nameAr: string;
  defaultLocale: string;
  currencyCode: string;
  dateFormat: string;
  timeZone: string;
  isActive: boolean;
}

export async function listCountries(): Promise<CountryRow[]> {
  const rows = await db().select().from(schema.countries).orderBy(schema.countries.code);
  return rows as CountryRow[];
}

export async function findCountry(code: string): Promise<CountryRow | undefined> {
  const rows = await db()
    .select()
    .from(schema.countries)
    .where(eq(schema.countries.code, code.toUpperCase()))
    .limit(1);
  return (rows as CountryRow[])[0];
}

export interface CurrencyRow {
  code: string;
  name: string;
  nameAr: string;
  minorUnits: number;
  symbol: string | null;
  isActive: boolean;
}

export async function listCurrencies(): Promise<CurrencyRow[]> {
  const rows = await db().select().from(schema.currencies).orderBy(schema.currencies.code);
  return rows as CurrencyRow[];
}

export async function findCurrency(code: string): Promise<CurrencyRow | undefined> {
  const rows = await db()
    .select()
    .from(schema.currencies)
    .where(eq(schema.currencies.code, code.toUpperCase()))
    .limit(1);
  return (rows as CurrencyRow[])[0];
}

export interface IndustryTemplateRow {
  key: string;
  name: string;
  nameAr: string;
  version: string;
  manifest: unknown;
}

export async function listIndustryTemplates(): Promise<IndustryTemplateRow[]> {
  const rows = await db()
    .select({
      key: schema.industryTemplates.key,
      name: schema.industryTemplates.name,
      nameAr: schema.industryTemplates.nameAr,
      version: schema.industryTemplates.version,
      manifest: schema.industryTemplates.manifest,
    })
    .from(schema.industryTemplates)
    .where(eq(schema.industryTemplates.isActive, true))
    .orderBy(schema.industryTemplates.key);
  return rows as IndustryTemplateRow[];
}

export interface CoaTemplateRow {
  code: string;
  name: string;
  nameAr: string;
  type: string;
  isGroup: boolean;
  parentCode: string | null;
  purposeKey: string | null;
}

export async function listCoaTemplate(): Promise<CoaTemplateRow[]> {
  const rows = await db().select().from(schema.chartOfAccountsTemplate);
  return (rows as CoaTemplateRow[]).sort((left, right) => left.code.localeCompare(right.code));
}

export interface PlanRow {
  id: string;
  key: string;
  name: string;
  nameAr: string;
  priceAmount: string;
  currencyCode: string;
  billingPeriod: string;
  limits: unknown;
  featureKeys: string[];
  isActive: boolean;
  /** PHASE-024 (migration 0036): the plan-level MFA policy. */
  mfaRequiredRoleKeys: string[];
}

export async function findPlanById(id: string): Promise<PlanRow | undefined> {
  // RLS: plans reads are tenant-GUC or platform-GUC paths — resolve the
  // ambient scope tx when one exists (console/registration flows).
  const handle = ambientAnyTx() ?? db();
  const rows = await handle.select().from(schema.plans).where(eq(schema.plans.id, id)).limit(1);
  return (rows as PlanRow[])[0];
}

export async function findPlanByKey(key: string): Promise<PlanRow | undefined> {
  // RLS: plans reads are tenant-GUC or platform-GUC paths — resolve the
  // ambient scope tx when one exists (console/registration flows).
  const handle = ambientAnyTx() ?? db();
  const rows = await handle
    .select()
    .from(schema.plans)
    .where(and(eq(schema.plans.key, key), eq(schema.plans.isActive, true)))
    .limit(1);
  return (rows as PlanRow[])[0];
}

// ---------------------------------------------------------------------------
// tenants (platform plane)

export interface TenantProfileRow {
  id: string;
  name: string;
  nameAr: string | null;
  status: string;
  baseCurrency: string;
  countryCode: string;
  timezone: string;
  industryTemplateKey: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const TENANT_COLUMNS = sql`id, name, name_ar AS "nameAr", status, base_currency AS "baseCurrency",
  country_code AS "countryCode", timezone, industry_template_key AS "industryTemplateKey",
  deleted_at AS "deletedAt", created_at AS "createdAt", updated_at AS "updatedAt", version`;

/** Cross-tenant list/search under the platform GUC (keyset on created_at/id). */
export async function platformListTenants(input: {
  query?: string;
  cursor?: { createdAt: string; id: string };
  limit: number;
}): Promise<TenantProfileRow[]> {
  const tx = platformTx();
  const like = input.query !== undefined ? `%${input.query.toLowerCase()}%` : null;
  const searchClause =
    like === null
      ? sql`true`
      : sql`(lower(name) LIKE ${like} OR lower(coalesce(name_ar, '')) LIKE ${like})`;
  const cursorClause =
    input.cursor === undefined
      ? sql`true`
      : sql`(created_at, id) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id}::uuid)`;
  const rows = await tx.execute(sql`
    SELECT ${TENANT_COLUMNS} FROM tenants
    WHERE ${searchClause} AND ${cursorClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ${input.limit + 1}
  `);
  const all = rows.rows as unknown as TenantProfileRow[];
  return all.slice(0, input.limit);
}

export async function platformGetTenant(id: string): Promise<TenantProfileRow | undefined> {
  const tx = platformTx();
  const rows = await tx.execute(sql`
    SELECT ${TENANT_COLUMNS} FROM tenants WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TenantProfileRow[])[0];
}

/** Own-tenant profile read inside the ambient tenant scope. */
export async function getOwnTenant(): Promise<TenantProfileRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${TENANT_COLUMNS} FROM tenants LIMIT 1
  `);
  const row = (rows.rows as unknown as TenantProfileRow[])[0];
  if (row === undefined) {
    throw new Error("tenant row not visible in the ambient tenant scope");
  }
  return row;
}

export interface InsertTenantInput {
  name: string;
  nameAr: string | null;
  baseCurrency: string;
  countryCode: string;
  timezone: string;
  industryTemplateKey: string | null;
}

/** Platform-plane registration insert (platform GUC on the platform tx). */
export async function insertTenant(input: InsertTenantInput): Promise<TenantProfileRow> {
  const tx = platformTx();
  const rows = await tx.execute(sql`
    INSERT INTO tenants (id, name, name_ar, status, base_currency, country_code, timezone, industry_template_key)
    VALUES (${generateUuidV7()}, ${input.name}, ${input.nameAr}, 'ACTIVE', ${input.baseCurrency},
            ${input.countryCode}, ${input.timezone}, ${input.industryTemplateKey})
    RETURNING ${TENANT_COLUMNS}
  `);
  return (rows.rows as unknown as TenantProfileRow[])[0]!;
}

export async function updateTenantProfile(input: {
  name?: string;
  nameAr?: string | null;
  timezone?: string;
}): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    UPDATE tenants SET
      name = coalesce(${input.name ?? null}, name),
      name_ar = coalesce(${input.nameAr ?? null}, name_ar),
      timezone = coalesce(${input.timezone ?? null}, timezone),
      updated_at = now(), version = version + 1
    WHERE id = erp.current_tenant_id()
  `);
}

/** Lifecycle transition under the platform GUC; returns the new row or null. */
export async function platformTransitionTenant(
  id: string,
  to: "SUSPENDED" | "ACTIVE",
  from: "ACTIVE" | "SUSPENDED",
): Promise<TenantProfileRow | null> {
  const tx = platformTx();
  const rows = await tx.execute(sql`
    UPDATE tenants SET status = ${to}, updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = ${from}
    RETURNING ${TENANT_COLUMNS}
  `);
  return (rows.rows as unknown as TenantProfileRow[])[0] ?? null;
}

// ---------------------------------------------------------------------------
// branches (tenant plane)

export interface BranchRow {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  nameAr: string | null;
  address: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export async function listBranches(branchScope: readonly string[] | null): Promise<BranchRow[]> {
  const tx = tenantTx();
  const scoped = branchScope !== null && branchScope.length > 0 ? branchScope : null;
  const rows = await tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", code, name, name_ar AS "nameAr", address,
           is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt", version
    FROM branches
    WHERE (${scoped}::uuid[] IS NULL OR id = ANY(${scoped}::uuid[]))
    ORDER BY code
  `);
  return rows.rows as unknown as BranchRow[];
}

export async function findBranchById(id: string): Promise<BranchRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", code, name, name_ar AS "nameAr", address,
           is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt", version
    FROM branches WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as BranchRow[])[0];
}

export async function findBranchByCode(code: string): Promise<BranchRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", code, name, name_ar AS "nameAr", address,
           is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt", version
    FROM branches WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as BranchRow[])[0];
}

export interface InsertBranchInput {
  code: string;
  name: string;
  nameAr: string | null;
  address: unknown;
}

export async function insertBranch(input: InsertBranchInput): Promise<BranchRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO branches (id, tenant_id, code, name, name_ar, address)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name},
            ${input.nameAr}, ${input.address === null ? null : JSON.stringify(input.address)}::jsonb)
    RETURNING id, tenant_id AS "tenantId", code, name, name_ar AS "nameAr", address,
              is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as BranchRow[])[0]!;
}

export async function updateBranch(
  id: string,
  patch: { name?: string; nameAr?: string | null; address?: unknown; isActive?: boolean },
): Promise<BranchRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    UPDATE branches SET
      name = coalesce(${patch.name ?? null}, name),
      name_ar = coalesce(${patch.nameAr ?? null}, name_ar),
      address = coalesce(${patch.address === undefined ? null : JSON.stringify(patch.address)}::jsonb, address),
      is_active = coalesce(${patch.isActive ?? null}, is_active),
      updated_at = now(), version = version + 1
    WHERE id = ${id}
    RETURNING id, tenant_id AS "tenantId", code, name, name_ar AS "nameAr", address,
              is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as BranchRow[])[0];
}

// ---------------------------------------------------------------------------
// tenant_settings (tenant plane)

export interface SettingRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

export async function listSettings(): Promise<SettingRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT key, value, updated_at AS "updatedAt" FROM tenant_settings ORDER BY key
  `);
  return rows.rows as unknown as SettingRow[];
}

export async function findSetting(key: string): Promise<SettingRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT key, value, updated_at AS "updatedAt" FROM tenant_settings WHERE key = ${key} LIMIT 1
  `);
  return (rows.rows as unknown as SettingRow[])[0];
}

export async function upsertSetting(
  key: string,
  value: unknown,
  updatedBy: string | null,
): Promise<SettingRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${key}, ${JSON.stringify(value)}::jsonb, ${updatedBy})
    ON CONFLICT (tenant_id, key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
          updated_at = now(), version = tenant_settings.version + 1
    RETURNING key, value, updated_at AS "updatedAt"
  `);
  return (rows.rows as unknown as SettingRow[])[0]!;
}

/** Idempotent default write at provisioning (no version bump when unchanged). */
export async function upsertSettingDefault(
  key: string,
  value: unknown,
  updatedBy: string | null,
): Promise<{ created: boolean }> {
  const existing = await findSetting(key);
  if (existing !== undefined) {
    return { created: false };
  }
  await upsertSetting(key, value, updatedBy);
  return { created: true };
}

// ---------------------------------------------------------------------------
// subscriptions + entitlements (tenant plane)

export interface SubscriptionRow {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  providerRef: string | null;
}

export async function currentSubscription(): Promise<SubscriptionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", plan_id AS "planId", status,
           period_start AS "periodStart", period_end AS "periodEnd", provider_ref AS "providerRef"
    FROM subscriptions WHERE status <> 'CANCELLED' ORDER BY created_at DESC LIMIT 1
  `);
  return (rows.rows as unknown as SubscriptionRow[])[0];
}

export async function insertSubscription(input: {
  planId: string;
  periodStart: string;
  periodEnd: string;
  providerRef: string | null;
}): Promise<SubscriptionRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO subscriptions (id, tenant_id, plan_id, status, period_start, period_end, provider_ref)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.planId}, 'ACTIVE',
            ${input.periodStart}, ${input.periodEnd}, ${input.providerRef})
    RETURNING id, tenant_id AS "tenantId", plan_id AS "planId", status,
              period_start AS "periodStart", period_end AS "periodEnd", provider_ref AS "providerRef"
  `);
  return (rows.rows as unknown as SubscriptionRow[])[0]!;
}

/** Latest ACTIVE subscription row supersedes older ones (manual assignment). */
export async function supersedeSubscriptions(): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    UPDATE subscriptions SET status = 'CANCELLED', updated_at = now(), version = version + 1
    WHERE status = 'ACTIVE'
  `);
}

export interface EntitlementRow {
  id: string;
  tenantId: string;
  featureKey: string;
  source: string;
  expiresAt: string | null;
}

const ENTITLEMENT_COLUMNS = sql`id, tenant_id AS "tenantId", feature_key AS "featureKey",
  source, expires_at AS "expiresAt"`;

export async function listEntitlements(): Promise<EntitlementRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${ENTITLEMENT_COLUMNS} FROM entitlements ORDER BY feature_key
  `);
  return rows.rows as unknown as EntitlementRow[];
}

export async function listActiveEntitlements(): Promise<EntitlementRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${ENTITLEMENT_COLUMNS} FROM entitlements
    WHERE expires_at IS NULL OR expires_at > now()
    ORDER BY feature_key
  `);
  return rows.rows as unknown as EntitlementRow[];
}

export async function findEntitlement(featureKey: string): Promise<EntitlementRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${ENTITLEMENT_COLUMNS} FROM entitlements WHERE feature_key = ${featureKey} LIMIT 1
  `);
  return (rows.rows as unknown as EntitlementRow[])[0];
}

/**
 * Materialization upsert (SUBSCRIPTION §4): plan-source rows refresh;
 * MANUAL/PROMO/TRIAL rows (overrides) are NEVER overwritten while active —
 * manual wins (§9 precedence).
 */
export async function upsertPlanEntitlement(input: {
  featureKey: string;
  expiresAt: string | null;
}): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    INSERT INTO entitlements (id, tenant_id, feature_key, source, expires_at)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.featureKey}, 'PLAN', ${input.expiresAt})
    ON CONFLICT (tenant_id, feature_key) DO UPDATE
      SET source = 'PLAN', expires_at = EXCLUDED.expires_at, updated_at = now(),
          version = entitlements.version + 1
      WHERE entitlements.source <> 'MANUAL'
        AND (entitlements.expires_at IS NULL OR entitlements.expires_at > now())
  `);
}

export async function insertEntitlement(input: {
  featureKey: string;
  source: "MANUAL" | "PROMO" | "TRIAL" | "PLAN";
  expiresAt: string | null;
}): Promise<EntitlementRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO entitlements (id, tenant_id, feature_key, source, expires_at)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.featureKey},
            ${input.source}, ${input.expiresAt})
    ON CONFLICT (tenant_id, feature_key) DO UPDATE
      SET source = EXCLUDED.source, expires_at = EXCLUDED.expires_at,
          updated_at = now(), version = entitlements.version + 1
    RETURNING ${ENTITLEMENT_COLUMNS}
  `);
  return (rows.rows as unknown as EntitlementRow[])[0]!;
}

export async function deleteEntitlement(featureKey: string): Promise<EntitlementRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    DELETE FROM entitlements WHERE feature_key = ${featureKey}
    RETURNING ${ENTITLEMENT_COLUMNS}
  `);
  return (rows.rows as unknown as EntitlementRow[])[0];
}

/** Drop expired grants (lazy reaper during materialization/reads). */
export async function deleteExpiredEntitlements(): Promise<number> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    DELETE FROM entitlements WHERE expires_at IS NOT NULL AND expires_at <= now() RETURNING id
  `);
  return rows.rows.length;
}

/**
 * Re-materialization cleanup (SUBSCRIPTION §4 "transactionally with the
 * subscription record — never mid-state"): PLAN/TRIAL grants from the
 * replaced subscription whose keys are not in the new plan drop; MANUAL
 * and PROMO overrides survive (§9 precedence).
 */
export async function deleteStalePlanEntitlements(
  keepKeys: readonly string[],
): Promise<number> {
  const tx = tenantTx();
  const rows = await tx
    .delete(schema.entitlements)
    .where(
      and(
        inArray(schema.entitlements.source, ["PLAN", "TRIAL"]),
        notInArray(schema.entitlements.featureKey, [...keepKeys]),
      ),
    )
    .returning({ id: schema.entitlements.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Pre-GUC entitlement projection (migration 0006) — BR-039 guard input.

export async function tenantActiveEntitlements(
  tenantId: string,
): Promise<EntitlementRow[]> {
  const rows = await db().execute(
    sql`SELECT feature_key AS "featureKey", source, expires_at AS "expiresAt"
        FROM erp.tenant_active_entitlements(${tenantId}::uuid)`,
  );
  return rows.rows as unknown as EntitlementRow[];
}

// ---------------------------------------------------------------------------
// accounts + account_purposes (onboarding instantiation; tenant plane)

export interface AccountRow {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  nameAr: string;
  type: string;
  parentId: string | null;
  isPostable: boolean;
  status: string;
}

export async function listAccounts(): Promise<AccountRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", code, name, name_ar AS "nameAr", type,
           parent_id AS "parentId", is_postable AS "isPostable", status
    FROM accounts ORDER BY code
  `);
  return rows.rows as unknown as AccountRow[];
}

export async function findAccountByCode(code: string): Promise<AccountRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", code, name, name_ar AS "nameAr", type,
           parent_id AS "parentId", is_postable AS "isPostable", status
    FROM accounts WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as AccountRow[])[0];
}

export async function insertAccount(input: {
  code: string;
  name: string;
  nameAr: string;
  type: string;
  parentId: string | null;
  isPostable: boolean;
}): Promise<AccountRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, parent_id, is_postable)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name},
            ${input.nameAr}, ${input.type}, ${input.parentId}, ${input.isPostable})
    RETURNING id, tenant_id AS "tenantId", code, name, name_ar AS "nameAr", type,
              parent_id AS "parentId", is_postable AS "isPostable", status
  `);
  return (rows.rows as unknown as AccountRow[])[0]!;
}

export interface AccountPurposeRow {
  id: string;
  tenantId: string;
  purposeKey: string;
  accountId: string;
  activeFrom: string;
  activeTo: string | null;
}

export async function listAccountPurposes(): Promise<AccountPurposeRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", purpose_key AS "purposeKey", account_id AS "accountId",
           active_from AS "activeFrom", active_to AS "activeTo"
    FROM account_purposes ORDER BY purpose_key
  `);
  return rows.rows as unknown as AccountPurposeRow[];
}

export async function findActivePurpose(purposeKey: string): Promise<AccountPurposeRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT id, tenant_id AS "tenantId", purpose_key AS "purposeKey", account_id AS "accountId",
           active_from AS "activeFrom", active_to AS "activeTo"
    FROM account_purposes WHERE purpose_key = ${purposeKey} AND active_to IS NULL LIMIT 1
  `);
  return (rows.rows as unknown as AccountPurposeRow[])[0];
}

export async function insertAccountPurpose(input: {
  purposeKey: string;
  accountId: string;
  activeFrom: string;
}): Promise<AccountPurposeRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO account_purposes (id, tenant_id, purpose_key, account_id, active_from)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.purposeKey},
            ${input.accountId}, ${input.activeFrom})
    RETURNING id, tenant_id AS "tenantId", purpose_key AS "purposeKey", account_id AS "accountId",
              active_from AS "activeFrom", active_to AS "activeTo"
  `);
  return (rows.rows as unknown as AccountPurposeRow[])[0]!;
}

// ---------------------------------------------------------------------------
// support sessions (matrix §7; tenant plane via per-operation scoping)

export interface SupportSessionRow {
  id: string;
  tenantId: string;
  platformUserId: string;
  optIn: boolean;
  ticketRef: string | null;
  reason: string;
  openedAt: string;
  expiresAt: string;
  closedAt: string | null;
  closedBy: string | null;
  status: string;
}

const SUPPORT_COLUMNS = sql`id, tenant_id AS "tenantId", platform_user_id AS "platformUserId",
  opt_in AS "optIn", ticket_ref AS "ticketRef", reason, opened_at AS "openedAt",
  expires_at AS "expiresAt", closed_at AS "closedAt", closed_by AS "closedBy", status`;

export async function insertSupportSession(input: {
  platformUserId: string;
  optIn: boolean;
  ticketRef: string | null;
  reason: string;
  expiresAt: string;
}): Promise<SupportSessionRow> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    INSERT INTO support_sessions (id, tenant_id, platform_user_id, opt_in, ticket_ref, reason, expires_at)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.platformUserId},
            ${input.optIn}, ${input.ticketRef}, ${input.reason}, ${input.expiresAt})
    RETURNING ${SUPPORT_COLUMNS}
  `);
  return (rows.rows as unknown as SupportSessionRow[])[0]!;
}

export async function findSupportSession(id: string): Promise<SupportSessionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${SUPPORT_COLUMNS} FROM support_sessions WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SupportSessionRow[])[0];
}

/**
 * PHASE-024 T12: the support sessions that opened inside the window,
 * discovered CROSS-TENANT from the platform-widened audit trail
 * (support.session.opened rows) and then fetched through each target
 * tenant's own scope (ADR-0005 per-operation scoping — support_sessions
 * itself carries the STRICT macro, never a blanket platform GUC).
 */
export async function supportSessionWindowIndex(
  fromAt: string,
  toAt: string,
): Promise<{ sessionId: string; tenantId: string }[]> {
  const tx = platformTx();
  const rows = await tx.execute(sql`
    SELECT DISTINCT entity_id AS "sessionId", tenant_id AS "tenantId"
    FROM audit_events
    WHERE action = 'support.session.opened'
      AND at >= ${fromAt}::timestamptz AND at <= ${toAt}::timestamptz
      AND tenant_id IS NOT NULL
  `);
  return rows.rows as unknown as { sessionId: string; tenantId: string }[];
}

/** PHASE-024 T12: fetch specific session rows inside the TARGET tenant scope. */
export async function findSupportSessionsByIds(
  tenantId: string,
  sessionIds: string[],
): Promise<SupportSessionRow[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  return withTenant(tenantId, async (tx) => {
    // Query-builder binding (the setRecoveryCodes lesson: raw array
    // parameters arrive as tuples/records — inArray binds correctly).
    const rows = await tx
      .select()
      .from(schema.supportSessions)
      .where(inArray(schema.supportSessions.id, sessionIds));
    return rows as unknown as SupportSessionRow[];
  });
}

/** PHASE-024 T12: proxied-read counts per support session over the window. */
export async function supportActionCounts(
  fromAt: string,
  toAt: string,
): Promise<{ sessionId: string; count: number }[]> {
  const tx = platformTx();
  const rows = await tx.execute(sql`
    SELECT entity_id AS "sessionId", count(*)::int AS count
    FROM audit_events
    WHERE action = 'support.session.action'
      AND at >= ${fromAt}::timestamptz AND at <= ${toAt}::timestamptz
    GROUP BY entity_id
  `);
  return rows.rows as unknown as { sessionId: string; count: number }[];
}

export async function listSupportSessions(): Promise<SupportSessionRow[]> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    SELECT ${SUPPORT_COLUMNS} FROM support_sessions ORDER BY opened_at DESC
  `);
  return rows.rows as unknown as SupportSessionRow[];
}

export async function transitionSupportSession(
  id: string,
  to: "CLOSED" | "TERMINATED" | "EXPIRED",
  closedBy: string | null,
): Promise<SupportSessionRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.execute(sql`
    UPDATE support_sessions
      SET status = ${to}, closed_at = now(), closed_by = ${closedBy},
          updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'ACTIVE'
    RETURNING ${SUPPORT_COLUMNS}
  `);
  return (rows.rows as unknown as SupportSessionRow[])[0];
}

// ---------------------------------------------------------------------------
// PHASE-006 master-data basics (migration 0009 contract): the onboarding
// instantiator for NEW tenants — the same canonical set the migration
// backfills for tenants existing at migration time (8 common units, the
// universal kg↔g pair, NET-7/15/30/60). Idempotent per natural key.

export async function seedMasterDataBasics(): Promise<void> {
  const tx = platformOrTenantTx();
  const uomSeed: readonly [string, string, string][] = [
    ["PCS", "Piece", "قطعة"],
    ["KG", "Kilogram", "كيلوجرام"],
    ["G", "Gram", "جرام"],
    ["L", "Liter", "لتر"],
    ["BOX", "Box", "صندوق"],
    ["CTN", "Carton", "كرتونة"],
    ["M", "Meter", "متر"],
    ["HR", "Hour", "ساعة"],
  ];
  for (const [code, name, nameAr] of uomSeed) {
    await tx.execute(sql`
      INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${code}, ${name}, ${nameAr}, true)
      ON CONFLICT ("tenant_id", "code") DO NOTHING
    `);
  }
  const termsSeed: readonly [string, string, string, number][] = [
    ["NET-7", "Net 7 days", "صافي 7 أيام", 7],
    ["NET-15", "Net 15 days", "صافي 15 يومًا", 15],
    ["NET-30", "Net 30 days", "صافي 30 يومًا", 30],
    ["NET-60", "Net 60 days", "صافي 60 يومًا", 60],
  ];
  for (const [code, name, nameAr, days] of termsSeed) {
    await tx.execute(sql`
      INSERT INTO "credit_terms" ("id", "tenant_id", "code", "name", "name_ar", "days", "is_system")
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${code}, ${name}, ${nameAr}, ${days}, true)
      ON CONFLICT ("tenant_id", "code") DO NOTHING
    `);
  }
  // Universal conversion pair only (kg↔g) — box/carton factors stay
  // tenant-specific by design (SEEDS/README "uoms" row).
  await tx.execute(sql`
    INSERT INTO "uom_conversions" ("id", "tenant_id", "from_uom_id", "to_uom_id", "factor")
    SELECT ${generateUuidV7()}, erp.current_tenant_id(),
      (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = erp.current_tenant_id() AND u."code" = 'KG'),
      (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = erp.current_tenant_id() AND u."code" = 'G'), 1000
    ON CONFLICT ("tenant_id", "from_uom_id", "to_uom_id") DO NOTHING
  `);
  await tx.execute(sql`
    INSERT INTO "uom_conversions" ("id", "tenant_id", "from_uom_id", "to_uom_id", "factor")
    SELECT ${generateUuidV7()}, erp.current_tenant_id(),
      (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = erp.current_tenant_id() AND u."code" = 'G'),
      (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = erp.current_tenant_id() AND u."code" = 'KG'), 0.001
    ON CONFLICT ("tenant_id", "from_uom_id", "to_uom_id") DO NOTHING
  `);
}

/** Onboarding runs inside the tenant scope (withTenant) — same tx plane. */
function platformOrTenantTx(): TenantDb {
  const tenant = requireTenantContext();
  if (tenant.tx !== undefined) {
    return tenant.tx;
  }
  const platform = ambientPlatformContext();
  if (platform !== undefined && platform.tx !== undefined) {
    return platform.tx;
  }
  throw new Error("onboarding master-data seed requires an ambient tenant or platform scope");
}

/**
 * CoA template instantiation for fixture/provisioning callers outside the
 * full onboarding flow (PHASE-007 db suite; same idempotent shape as
 * onboarding steps 2–3: code-ordered parents-first insert + purpose
 * markers → 1:1 active mappings, V1).
 */
export async function provisionCoaTemplate(): Promise<{ accounts: number; purposes: number }> {
  const template = await listCoaTemplate();
  const idByCode = new Map<string, string>();
  let created = 0;
  for (const row of template) {
    const existing = await findAccountByCode(row.code);
    if (existing !== undefined) {
      idByCode.set(row.code, existing.id);
      continue;
    }
    const parent = row.parentCode !== null ? idByCode.get(row.parentCode) : null;
    const account = await insertAccount({
      code: row.code,
      name: row.name,
      nameAr: row.nameAr,
      type: row.type,
      parentId: parent ?? null,
      isPostable: !row.isGroup,
    });
    idByCode.set(row.code, account.id);
    created += 1;
  }
  const activeFrom = new Date().toISOString().slice(0, 10);
  let purposes = 0;
  for (const row of template) {
    if (row.purposeKey === null) continue;
    const existing = await findActivePurpose(row.purposeKey);
    if (existing !== undefined) continue;
    const accountId = idByCode.get(row.code);
    if (accountId === undefined) {
      throw new Error(`purpose marker ${row.purposeKey} has no instantiated account`);
    }
    await insertAccountPurpose({ purposeKey: row.purposeKey, accountId, activeFrom });
    purposes += 1;
  }
  return { accounts: created, purposes };
}
