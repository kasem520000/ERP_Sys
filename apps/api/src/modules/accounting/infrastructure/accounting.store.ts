import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Accounting store — CoA / calendar / rates / dimensions / policies /
 * numbering (PHASE-007 T3/T4/T5/T11/T13; DEPENDENCY_RULES §1 infrastructure
 * layer): pure storage inside the ambient tenant transaction; RLS confines
 * every statement (A1–A10 green). Journal-table writes live in
 * journal.store.ts (the posting engine's exclusive surface).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("accounting access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- accounts + purposes (T3) ---------------------------------------------------

export interface AccountRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  type: string;
  parentId: string | null;
  isPostable: boolean;
  currencyCode: string | null;
  status: string;
}

const ACCOUNT_COLUMNS = sql`id, code, name, name_ar AS "nameAr", type, parent_id AS "parentId",
  is_postable AS "isPostable", currency_code AS "currencyCode", status`;

export async function listAccounts(filter?: {
  type?: string;
  status?: string;
  q?: string;
}): Promise<AccountRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ACCOUNT_COLUMNS} FROM accounts
    WHERE (${filter?.type ?? null}::text IS NULL OR type = ${filter?.type ?? null})
      AND (${filter?.status ?? null}::text IS NULL OR status = ${filter?.status ?? null})
      AND (${filter?.q ?? null}::text IS NULL OR code ILIKE ${"%" + (filter?.q ?? "") + "%"}
           OR name ILIKE ${"%" + (filter?.q ?? "") + "%"} OR name_ar ILIKE ${"%" + (filter?.q ?? "") + "%"})
    ORDER BY code
  `);
  return rows.rows as unknown as AccountRow[];
}

export async function findAccountById(id: string): Promise<AccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as AccountRow[])[0];
}

export async function findAccountByCode(code: string): Promise<AccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as AccountRow[])[0];
}

export async function insertAccount(input: {
  code: string;
  name: string;
  nameAr: string | null;
  type: string;
  parentId: string | null;
  currencyCode: string | null;
  isPostable: boolean;
}): Promise<AccountRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, parent_id, is_postable, currency_code)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name}, ${input.nameAr ?? null},
            ${input.type}, ${input.parentId ?? null}, ${input.isPostable}, ${input.currencyCode ?? null})
    RETURNING ${ACCOUNT_COLUMNS}
  `);
  return (rows.rows as unknown as AccountRow[])[0]!;
}

export async function updateAccount(
  id: string,
  patch: {
    name?: string;
    nameAr?: string | null;
    parentId?: string | null;
    currencyCode?: string | null;
    code?: string;
    isPostable?: boolean;
    version?: number;
  },
): Promise<AccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE accounts SET
      name = COALESCE(${patch.name ?? null}, name),
      name_ar = CASE WHEN ${patch.nameAr ?? null}::text IS NULL THEN name_ar ELSE ${patch.nameAr ?? null} END,
      parent_id = CASE WHEN ${patch.parentId ?? null}::uuid IS NULL THEN parent_id ELSE ${patch.parentId ?? null} END,
      currency_code = CASE WHEN ${patch.currencyCode ?? null}::char(3) IS NULL THEN currency_code ELSE ${patch.currencyCode ?? null} END,
      code = COALESCE(${patch.code ?? null}, code),
      is_postable = COALESCE(${patch.isPostable ?? null}, is_postable),
      version = version + 1, updated_at = now()
    WHERE id = ${id} AND (${patch.version ?? null}::int IS NULL OR version = ${patch.version ?? null})
    RETURNING ${ACCOUNT_COLUMNS}
  `);
  return (rows.rows as unknown as AccountRow[])[0];
}

export async function setAccountStatus(
  id: string,
  status: "ACTIVE" | "ARCHIVED",
): Promise<AccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE accounts SET status = ${status}, version = version + 1, updated_at = now()
    WHERE id = ${id} RETURNING ${ACCOUNT_COLUMNS}
  `);
  return (rows.rows as unknown as AccountRow[])[0];
}

export async function countChildAccounts(id: string): Promise<number> {
  const rows = await tenantTx().execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM accounts WHERE parent_id = ${id}`,
  );
  return rows.rows[0]?.n ?? 0;
}

export async function countAccountLines(id: string): Promise<number> {
  const rows = await tenantTx().execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM journal_lines WHERE account_id = ${id}`,
  );
  return rows.rows[0]?.n ?? 0;
}

export async function accountHasActivePurpose(id: string): Promise<boolean> {
  const rows = await tenantTx().execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM account_purposes WHERE account_id = ${id} AND active_to IS NULL`,
  );
  return (rows.rows[0]?.n ?? 0) > 0;
}

export async function pathOfParents(accountId: string): Promise<string[]> {
  // Recursive parent walk (cycle detection input) — bounded by the tree.
  const rows = await tenantTx().execute<{ id: string }>(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id FROM accounts WHERE id = ${accountId}
      UNION ALL
      SELECT a.id, a.parent_id FROM accounts a
      JOIN ancestors an ON a.id = an.parent_id
    )
    SELECT id FROM ancestors
  `);
  return rows.rows.map((row) => row.id);
}

export interface PurposeRow {
  id: string;
  purposeKey: string;
  accountId: string;
  accountCode?: string;
  activeFrom: string;
  activeTo: string | null;
}

export async function listPurposes(): Promise<PurposeRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT p.id, p.purpose_key AS "purposeKey", p.account_id AS "accountId",
           a.code AS "accountCode", p.active_from AS "activeFrom", p.active_to AS "activeTo"
    FROM account_purposes p JOIN accounts a ON a.id = p.account_id
    ORDER BY p.purpose_key
  `);
  return rows.rows as unknown as PurposeRow[];
}

export async function findActivePurpose(purposeKey: string): Promise<PurposeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT p.id, p.purpose_key AS "purposeKey", p.account_id AS "accountId",
           a.code AS "accountCode", p.active_from AS "activeFrom", p.active_to AS "activeTo"
    FROM account_purposes p JOIN accounts a ON a.id = p.account_id
    WHERE p.purpose_key = ${purposeKey} AND p.active_to IS NULL LIMIT 1
  `);
  return (rows.rows as unknown as PurposeRow[])[0];
}

export async function mapPurpose(input: {
  purposeKey: string;
  accountId: string;
  activeFrom: string;
}): Promise<PurposeRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO account_purposes (id, tenant_id, purpose_key, account_id, active_from)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.purposeKey}, ${input.accountId}, ${input.activeFrom})
    RETURNING id, purpose_key AS "purposeKey", account_id AS "accountId", active_from AS "activeFrom", active_to AS "activeTo"
  `);
  return (rows.rows as unknown as PurposeRow[])[0]!;
}

export async function supersedePurpose(purposeRowId: string, activeTo: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE account_purposes SET active_to = ${activeTo}, version = version + 1, updated_at = now()
    WHERE id = ${purposeRowId}
  `);
}

// -- fiscal years + periods (T4) -------------------------------------------------

export interface FiscalYearRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

export async function listFiscalYears(): Promise<FiscalYearRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, name, start_date AS "startDate", end_date AS "endDate", status
    FROM fiscal_years ORDER BY start_date
  `);
  return rows.rows as unknown as FiscalYearRow[];
}

export async function findFiscalYearById(id: string): Promise<FiscalYearRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, name, start_date AS "startDate", end_date AS "endDate", status
    FROM fiscal_years WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as FiscalYearRow[])[0];
}

export async function findFiscalYearByName(name: string): Promise<FiscalYearRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, name, start_date AS "startDate", end_date AS "endDate", status
    FROM fiscal_years WHERE name = ${name} LIMIT 1
  `);
  return (rows.rows as unknown as FiscalYearRow[])[0];
}

export async function insertFiscalYear(input: {
  name: string;
  startDate: string;
  endDate: string;
}): Promise<FiscalYearRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.name}, ${input.startDate}, ${input.endDate})
    RETURNING id, name, start_date AS "startDate", end_date AS "endDate", status
  `);
  return (rows.rows as unknown as FiscalYearRow[])[0]!;
}

export async function setFiscalYearStatus(id: string, status: "OPEN" | "CLOSED"): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE fiscal_years SET status = ${status}, version = version + 1, updated_at = now() WHERE id = ${id}
  `);
}

export interface FiscalPeriodRow {
  id: string;
  fiscalYearId: string;
  name: string;
  kind: string;
  startDate: string;
  endDate: string;
  status: string;
  closedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

const PERIOD_COLUMNS = sql`id, fiscal_year_id AS "fiscalYearId", name, kind, start_date AS "startDate",
  end_date AS "endDate", status, closed_at AS "closedAt", reopened_at AS "reopenedAt", reopen_reason AS "reopenReason"`;

export async function listPeriods(fiscalYearId?: string): Promise<FiscalPeriodRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PERIOD_COLUMNS} FROM fiscal_periods
    WHERE (${fiscalYearId ?? null}::uuid IS NULL OR fiscal_year_id = ${fiscalYearId ?? null})
    ORDER BY start_date
  `);
  return rows.rows as unknown as FiscalPeriodRow[];
}

export async function findPeriodById(id: string): Promise<FiscalPeriodRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PERIOD_COLUMNS} FROM fiscal_periods WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as FiscalPeriodRow[])[0];
}

/** Date → period resolution: REGULAR wins over special windows (documented). */
export async function findPeriodForDate(entryDate: string): Promise<FiscalPeriodRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PERIOD_COLUMNS} FROM fiscal_periods
    WHERE start_date <= ${entryDate} AND end_date >= ${entryDate}
    ORDER BY (kind = 'REGULAR') DESC, kind
    LIMIT 1
  `);
  return (rows.rows as unknown as FiscalPeriodRow[])[0];
}

export async function insertPeriod(input: {
  fiscalYearId: string;
  name: string;
  kind: "REGULAR" | "OPENING" | "CLOSING";
  startDate: string;
  endDate: string;
}): Promise<FiscalPeriodRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.fiscalYearId}, ${input.name},
            ${input.kind}, ${input.startDate}, ${input.endDate})
    RETURNING ${PERIOD_COLUMNS}
  `);
  return (rows.rows as unknown as FiscalPeriodRow[])[0]!;
}

export async function setPeriodStatus(
  id: string,
  status: "OPEN" | "SOFT_CLOSED" | "LOCKED",
  actorId: string | null,
): Promise<FiscalPeriodRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE fiscal_periods SET
      status = ${status},
      closed_at = CASE WHEN ${status} = 'OPEN' THEN NULL ELSE now() END,
      closed_by = CASE WHEN ${status} = 'OPEN' THEN NULL ELSE ${actorId ?? null}::uuid END,
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING ${PERIOD_COLUMNS}
  `);
  return (rows.rows as unknown as FiscalPeriodRow[])[0];
}

export async function recordPeriodReopen(
  id: string,
  actorId: string,
  reason: string,
): Promise<FiscalPeriodRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE fiscal_periods SET
      status = 'OPEN', reopened_at = now(), reopened_by = ${actorId}::uuid, reopen_reason = ${reason},
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING ${PERIOD_COLUMNS}
  `);
  return (rows.rows as unknown as FiscalPeriodRow[])[0];
}

// -- exchange rates (T5) ----------------------------------------------------------

export interface ExchangeRateRow {
  id: string;
  currencyCode: string;
  rateDate: string;
  rate: string;
  source: string;
}

export async function listExchangeRates(filter?: {
  currencyCode?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<ExchangeRateRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, currency_code AS "currencyCode", rate_date AS "rateDate", rate, source
    FROM exchange_rates
    WHERE (${filter?.currencyCode ?? null}::char(3) IS NULL OR currency_code = ${filter?.currencyCode ?? null})
      AND (${filter?.fromDate ?? null}::date IS NULL OR rate_date >= ${filter?.fromDate ?? null})
      AND (${filter?.toDate ?? null}::date IS NULL OR rate_date <= ${filter?.toDate ?? null})
    ORDER BY currency_code, rate_date DESC
  `);
  return rows.rows as unknown as ExchangeRateRow[];
}

export async function upsertExchangeRate(input: {
  currencyCode: string;
  rateDate: string;
  rate: string;
  source: "MANUAL" | "IMPORTED";
}): Promise<ExchangeRateRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO exchange_rates (id, tenant_id, currency_code, rate_date, rate, source)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.currencyCode}, ${input.rateDate},
            ${input.rate}, ${input.source})
    ON CONFLICT ("tenant_id", "currency_code", "rate_date")
    DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, version = exchange_rates.version + 1,
                  updated_at = now()
    RETURNING id, currency_code AS "currencyCode", rate_date AS "rateDate", rate, source
  `);
  return (rows.rows as unknown as ExchangeRateRow[])[0]!;
}

/** Dated lookup: the latest row on or before `date` (CURRENCY_AND_PRECISION §5). */
export async function findRateForDate(
  currencyCode: string,
  date: string,
): Promise<ExchangeRateRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, currency_code AS "currencyCode", rate_date AS "rateDate", rate, source
    FROM exchange_rates
    WHERE currency_code = ${currencyCode} AND rate_date <= ${date}
    ORDER BY rate_date DESC LIMIT 1
  `);
  return (rows.rows as unknown as ExchangeRateRow[])[0];
}

// -- cost centers (§2.9) ------------------------------------------------------------

export interface CostCenterRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  isActive: boolean;
}

export async function listCostCenters(): Promise<CostCenterRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar AS "nameAr", parent_id AS "parentId", is_active AS "isActive"
    FROM cost_centers ORDER BY code
  `);
  return rows.rows as unknown as CostCenterRow[];
}

export async function findCostCenterById(id: string): Promise<CostCenterRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar AS "nameAr", parent_id AS "parentId", is_active AS "isActive"
    FROM cost_centers WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CostCenterRow[])[0];
}

export async function insertCostCenter(input: {
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
}): Promise<CostCenterRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO cost_centers (id, tenant_id, code, name, name_ar, parent_id)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name}, ${input.nameAr ?? null}, ${input.parentId ?? null})
    RETURNING id, code, name, name_ar AS "nameAr", parent_id AS "parentId", is_active AS "isActive"
  `);
  return (rows.rows as unknown as CostCenterRow[])[0]!;
}

export async function updateCostCenter(
  id: string,
  patch: { name?: string; nameAr?: string | null; isActive?: boolean },
): Promise<CostCenterRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE cost_centers SET
      name = COALESCE(${patch.name ?? null}, name),
      name_ar = CASE WHEN ${patch.nameAr ?? null}::text IS NULL THEN name_ar ELSE ${patch.nameAr ?? null} END,
      is_active = COALESCE(${patch.isActive ?? null}, is_active),
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING id, code, name, name_ar AS "nameAr", parent_id AS "parentId", is_active AS "isActive"
  `);
  return (rows.rows as unknown as CostCenterRow[])[0];
}

// -- projects (PHASE-019 §8) ----------------------------------------------------------
// The cost_centers clone verbatim (status OPEN|CLOSED replaces is_active —
// a CLOSED project rejects NEW journal-line stamps at the engine while
// posted history stays; no DELETE — the lifecycle is flip-only).

export interface ProjectRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  status: string;
}

export async function listProjects(): Promise<ProjectRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar AS "nameAr", parent_id AS "parentId", status
    FROM projects ORDER BY code
  `);
  return rows.rows as unknown as ProjectRow[];
}

export async function findProjectById(id: string): Promise<ProjectRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar AS "nameAr", parent_id AS "parentId", status
    FROM projects WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ProjectRow[])[0];
}

export async function insertProject(input: {
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
}): Promise<ProjectRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO projects (id, tenant_id, code, name, name_ar, parent_id)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name}, ${input.nameAr ?? null}, ${input.parentId ?? null})
    RETURNING id, code, name, name_ar AS "nameAr", parent_id AS "parentId", status
  `);
  return (rows.rows as unknown as ProjectRow[])[0]!;
}

export async function updateProject(
  id: string,
  patch: { name?: string; nameAr?: string | null; status?: "OPEN" | "CLOSED" },
): Promise<ProjectRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE projects SET
      name = COALESCE(${patch.name ?? null}, name),
      name_ar = CASE WHEN ${patch.nameAr ?? null}::text IS NULL THEN name_ar ELSE ${patch.nameAr ?? null} END,
      status = COALESCE(${patch.status ?? null}, status),
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING id, code, name, name_ar AS "nameAr", parent_id AS "parentId", status
  `);
  return (rows.rows as unknown as ProjectRow[])[0];
}

// -- recurring journals (T10) ---------------------------------------------------------

export interface RecurringJournalRow {
  id: string;
  name: string;
  template: unknown;
  schedule: string;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  lastRunAt: string | null;
  status: string;
}

const RECURRING_COLUMNS = sql`id, name, template, schedule, start_date AS "startDate", end_date AS "endDate",
  next_run_date AS "nextRunDate", last_run_at AS "lastRunAt", status`;

export async function listRecurringJournals(): Promise<RecurringJournalRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RECURRING_COLUMNS} FROM recurring_journals ORDER BY name
  `);
  return rows.rows as unknown as RecurringJournalRow[];
}

export async function findRecurringJournalById(id: string): Promise<RecurringJournalRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RECURRING_COLUMNS} FROM recurring_journals WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as RecurringJournalRow[])[0];
}

export async function insertRecurringJournal(input: {
  name: string;
  template: unknown;
  schedule: string;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
}): Promise<RecurringJournalRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO recurring_journals (id, tenant_id, name, template, schedule, start_date, end_date, next_run_date)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.name}, ${JSON.stringify(input.template)}::jsonb,
            ${input.schedule}, ${input.startDate}, ${input.endDate ?? null}, ${input.nextRunDate})
    RETURNING ${RECURRING_COLUMNS}
  `);
  return (rows.rows as unknown as RecurringJournalRow[])[0]!;
}

export async function updateRecurringJournal(
  id: string,
  patch: {
    name?: string;
    template?: unknown;
    schedule?: string;
    startDate?: string;
    endDate?: string | null;
    nextRunDate?: string;
    status?: string;
    lastRunAt?: string;
  },
): Promise<RecurringJournalRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE recurring_journals SET
      name = COALESCE(${patch.name ?? null}, name),
      template = CASE WHEN ${patch.template === undefined ? null : JSON.stringify(patch.template ?? null)}::jsonb IS NULL
                      THEN template ELSE ${patch.template === undefined ? null : JSON.stringify(patch.template ?? null)}::jsonb END,
      schedule = COALESCE(${patch.schedule ?? null}, schedule),
      start_date = COALESCE(${patch.startDate ?? null}, start_date),
      end_date = CASE WHEN ${patch.endDate ?? null}::date IS NULL THEN end_date ELSE ${patch.endDate ?? null} END,
      next_run_date = COALESCE(${patch.nextRunDate ?? null}, next_run_date),
      status = COALESCE(${patch.status ?? null}, status),
      last_run_at = COALESCE(${patch.lastRunAt ?? null}, last_run_at),
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING ${RECURRING_COLUMNS}
  `);
  return (rows.rows as unknown as RecurringJournalRow[])[0];
}

export async function findDueRecurringJournals(asOf: string): Promise<RecurringJournalRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RECURRING_COLUMNS} FROM recurring_journals
    WHERE status = 'ACTIVE' AND next_run_date <= ${asOf}
      AND (end_date IS NULL OR end_date >= next_run_date)
    ORDER BY next_run_date
  `);
  return rows.rows as unknown as RecurringJournalRow[];
}

// -- approval policies (T11) ------------------------------------------------------------

export interface ApprovalPolicyRow {
  id: string;
  docType: string;
  policy: {
    mode: "none" | "single-approver" | "two-step" | "amount-threshold";
    threshold?: string | null;
    allowSelfApproval?: boolean;
  };
  appliesFrom: string;
  isActive: boolean;
}

export async function findActivePolicy(
  docType: string,
  onDate: string,
): Promise<ApprovalPolicyRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, doc_type AS "docType", policy, applies_from AS "appliesFrom", is_active AS "isActive"
    FROM approval_policies
    WHERE doc_type = ${docType} AND is_active AND applies_from <= ${onDate}
    ORDER BY applies_from DESC LIMIT 1
  `);
  return (rows.rows as unknown as ApprovalPolicyRow[])[0];
}

export async function listApprovalPolicies(): Promise<ApprovalPolicyRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, doc_type AS "docType", policy, applies_from AS "appliesFrom", is_active AS "isActive"
    FROM approval_policies ORDER BY doc_type, applies_from DESC
  `);
  return rows.rows as unknown as ApprovalPolicyRow[];
}

export async function insertApprovalPolicy(input: {
  docType: string;
  policy: unknown;
  appliesFrom: string;
}): Promise<ApprovalPolicyRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO approval_policies (id, tenant_id, doc_type, policy, applies_from)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.docType ?? null},
            ${JSON.stringify(input.policy)}::jsonb, ${input.appliesFrom})
    RETURNING id, doc_type AS "docType", policy, applies_from AS "appliesFrom", is_active AS "isActive"
  `);
  return (rows.rows as unknown as ApprovalPolicyRow[])[0]!;
}

export async function deactivateApprovalPolicy(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE approval_policies SET is_active = false, version = version + 1, updated_at = now() WHERE id = ${id}
  `);
}

// -- numbering store (T13, ADR-0006) -----------------------------------------------------

export interface AcquiredNumber {
  value: bigint;
  number: string;
}

/**
 * Atomic sequence acquire (CC-03): upsert-increment returns the consumed
 * value; 50 parallel acquirers serialize on the row update — no explicit
 * row lock, no deadlock. Runs inside the caller's transaction so a rollback
 * returns the value (no gaps on failure).
 */
export async function acquireNumber(input: {
  docType: string;
  branchId: string | null;
  periodKey: string | null;
  format: string;
  prefix: string;
  year: string | null;
}): Promise<AcquiredNumber> {
  const rows = await tenantTx().execute<{ next_value: string }>(sql`
    INSERT INTO numbering_sequences (id, tenant_id, doc_type, branch_id, period_key, next_value, format)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.docType}, ${input.branchId ?? null},
            ${input.periodKey ?? null}, 1, ${input.format})
    ON CONFLICT ("tenant_id", "doc_type",
                 COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),
                 COALESCE("period_key", ''))
    DO UPDATE SET next_value = numbering_sequences.next_value + 1, updated_at = now()
    RETURNING next_value
  `);
  const value = BigInt(rows.rows[0]!.next_value);
  const number = renderNumber(input.format, input.prefix, input.year, value);
  await tenantTx().execute(sql`
    INSERT INTO number_assignments (id, tenant_id, doc_type, branch_id, period_key, number, value)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.docType}, ${input.branchId ?? null},
            ${input.periodKey ?? null}, ${number}, ${value.toString()})
  `);
  return { value, number };
}

/** Attach the owning document to an assignment row (audit view). */
export async function bindNumberAssignment(
  docType: string,
  number: string,
  documentId: string,
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE number_assignments SET document_id = ${documentId}, updated_at = now()
    WHERE doc_type = ${docType} AND number = ${number}
  `);
}

/** Void: tombstone the assignment — the number stays reserved forever (INV-021). */
export async function voidNumber(
  docType: string,
  number: string,
  actorId: string,
): Promise<string | undefined> {
  const rows = await tenantTx().execute<{ id: string }>(sql`
    UPDATE number_assignments SET voided_at = now(), voided_by = ${actorId}::uuid, updated_at = now()
    WHERE doc_type = ${docType} AND number = ${number} AND voided_at IS NULL
    RETURNING id
  `);
  return rows.rows[0]?.id;
}

/** Render `JE-{YYYY}-{SEQ:6}`-family formats from a template. */
export function renderNumber(
  format: string,
  prefix: string,
  year: string | null,
  value: bigint,
): string {
  let rendered = format.replace("{PREFIX}", prefix);
  if (year !== null) {
    rendered = rendered.replace("{YYYY}", year);
  }
  rendered = rendered.replace(/\{SEQ:(\d+)\}/g, (_match, pad: string) =>
    value.toString().padStart(Number(pad), "0"),
  );
  return rendered;
}

// -- numbering audit view (T13) ---------------------------------------------------

export interface NumberAssignmentRow {
  id: string;
  docType: string;
  number: string;
  value: string;
  documentId: string | null;
  voidedAt: string | null;
}

export async function listNumberAssignments(filter: {
  docType?: string;
}): Promise<NumberAssignmentRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, doc_type AS "docType", number, value::text AS "value",
           document_id AS "documentId", voided_at AS "voidedAt"
    FROM number_assignments
    WHERE (${filter?.docType ?? null}::text IS NULL OR doc_type = ${filter?.docType ?? null})
    ORDER BY created_at DESC
    LIMIT 200
  `);
  return rows.rows as unknown as NumberAssignmentRow[];
}

/** Count the tenant's journal entries (the fixture idempotency probe). */
export async function countJournalEntries(): Promise<number> {
  const rows = await tenantTx().execute(
    sql`SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = erp.current_tenant_id()`,
  );
  return Number((rows.rows as unknown as { n: number }[])[0]?.n ?? 0);
}
