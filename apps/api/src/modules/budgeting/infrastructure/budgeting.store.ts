import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import type { BudgetScope, BudgetStatus } from "../application/budgeting-types";

/**
 * Budgeting store (PHASE-028 T2/T3): the ONLY writer of `budgets` +
 * `budget_lines` (the version register and the period grid). Every
 * statement runs in the caller's ambient tenant UoW so a failure anywhere
 * rolls the whole business operation back.
 *
 * THE LEDGER IS NEVER WRITTEN HERE (DR-004 — budgets are not ledger
 * documents; ADR-0007 — the posting engine exclusively owns
 * journal_entries/journal_lines): this store has no INSERT/UPDATE/DELETE
 * against any journal/cash table, and the module's read surface
 * (consumption) is SELECT-only. The negative ledger proof in the rules
 * suite greps this file by construction.
 *
 * Cross-module READ refs (sanctioned read-only): fiscal_years /
 * fiscal_periods / accounts / cost_centers / projects / branches
 * (dimension validation), journal_lines + journal_entries + the
 * branch-carrying source documents (the consumption engine's shared query
 * — see consumption-service.ts).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("budgeting access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- the version register ----------------------------------------------------------

export interface BudgetRow {
  id: string;
  code: string;
  fiscalYearId: string;
  scope: BudgetScope;
  name: string;
  nameAr: string | null;
  revisionNo: number;
  status: BudgetStatus;
  supersedesId: string | null;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface BudgetSqlRow {
  id: string;
  code: string;
  fiscal_year_id: string;
  scope: BudgetScope;
  name: string;
  name_ar: string | null;
  revision_no: number;
  status: BudgetStatus;
  supersedes_id: string | null;
  submitted_at: string | null;
  submitted_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  activated_at: string | null;
  activated_by: string | null;
  closed_at: string | null;
  closed_by: string | null;
  note: string | null;
  note_ar: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

function mapBudget(row: BudgetSqlRow): BudgetRow {
  return {
    id: row.id,
    code: row.code,
    fiscalYearId: row.fiscal_year_id,
    scope: row.scope,
    name: row.name,
    nameAr: row.name_ar,
    revisionNo: Number(row.revision_no),
    status: row.status,
    supersedesId: row.supersedes_id,
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    activatedAt: row.activated_at,
    activatedBy: row.activated_by,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
    note: row.note,
    noteAr: row.note_ar,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
  };
}

const BUDGET_COLUMNS = sql`id, code, fiscal_year_id, scope, name, name_ar, revision_no,
  status, supersedes_id, submitted_at, submitted_by, approved_at, approved_by,
  activated_at, activated_by, closed_at, closed_by, note, note_ar,
  created_by, created_at, updated_at, version`;

export interface CreateBudgetInput {
  fiscalYearId: string;
  scope: BudgetScope;
  name: string;
  nameAr?: string | null;
  revisionNo?: number;
  supersedesId?: string | null;
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}

/**
 * Insert a budget version, minting the tenant-scoped code
 * `BUD-<yearStart>-<seq>` (DATA_DICTIONARY §12 — no official numbers: a
 * budget is planning data, not a document, ADR-0006). The sequence is
 * per-(tenant, fiscal year, scope), parsed from the existing codes and
 * bumped under a `FOR UPDATE` lock on the (year, scope) register rows so
 * concurrent creators serialize (RLS ambient scopes the lock to the
 * tenant).
 */
export async function insertBudget(input: CreateBudgetInput): Promise<BudgetRow> {
  const tx = tenantTx();
  const tenantId = requireTenantContext().tenantId;
  // Serialize concurrent code minting for this (year, scope).
  await tx.execute(sql`
    SELECT id FROM budgets
    WHERE fiscal_year_id = ${input.fiscalYearId} AND scope = ${input.scope}
    FOR UPDATE
  `);
  const year = await tx.execute(sql`
    SELECT start_date FROM fiscal_years WHERE id = ${input.fiscalYearId} LIMIT 1
  `);
  const yearStart = (year.rows as unknown as { start_date: string }[])[0]?.start_date;
  const year4 = yearStart === undefined ? "0000" : yearStart.slice(0, 4);
  const maxSeq = await tx.execute(sql`
    SELECT COALESCE(MAX((regexp_replace(code, '^BUD-[0-9]{4}-', ''))::int), 0) AS seq
    FROM budgets
    WHERE fiscal_year_id = ${input.fiscalYearId} AND scope = ${input.scope}
  `);
  const nextSeq = Number((maxSeq.rows as unknown as { seq: number }[])[0]?.seq ?? 0) + 1;
  const id = generateUuidV7();
  const rows = await tx.execute(sql`
    INSERT INTO budgets (id, tenant_id, created_by, code, fiscal_year_id, scope, name,
      name_ar, revision_no, status, supersedes_id, note, note_ar)
    VALUES (${id}, ${tenantId}, ${input.createdBy}, ${`BUD-${year4}-${nextSeq}`},
      ${input.fiscalYearId}, ${input.scope}, ${input.name}, ${input.nameAr ?? null},
      ${input.revisionNo ?? 1}, 'DRAFT', ${input.supersedesId ?? null},
      ${input.note ?? null}, ${input.noteAr ?? null})
    RETURNING ${BUDGET_COLUMNS}
  `);
  return mapBudget((rows.rows as unknown as BudgetSqlRow[])[0]!);
}

export async function findBudgetById(id: string): Promise<BudgetRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BUDGET_COLUMNS} FROM budgets WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as BudgetSqlRow[])[0] === undefined
    ? undefined
    : mapBudget((rows.rows as unknown as BudgetSqlRow[])[0]!);
}

export async function listBudgets(filter: {
  fiscalYearId?: string;
  scope?: BudgetScope;
  status?: BudgetStatus;
}): Promise<BudgetRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BUDGET_COLUMNS} FROM budgets
    WHERE (${filter.fiscalYearId ?? null}::uuid IS NULL OR fiscal_year_id = ${filter.fiscalYearId ?? null})
      AND (${filter.scope ?? null}::text IS NULL OR scope = ${filter.scope ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC, id
  `);
  return (rows.rows as unknown as BudgetSqlRow[]).map(mapBudget);
}

export interface BudgetStatusPatch {
  status?: BudgetStatus;
  submittedAt?: string | null;
  submittedBy?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  activatedAt?: string | null;
  activatedBy?: string | null;
  closedAt?: string | null;
  closedBy?: string | null;
}

export async function updateBudgetStatus(
  id: string,
  patch: BudgetStatusPatch,
): Promise<BudgetRow> {
  const rows = await tenantTx().execute(sql`
    UPDATE budgets SET
      status = COALESCE(${patch.status ?? null}::text, status),
      submitted_at = COALESCE(${patch.submittedAt ?? null}::timestamptz, submitted_at),
      submitted_by = COALESCE(${patch.submittedBy ?? null}::uuid, submitted_by),
      approved_at = COALESCE(${patch.approvedAt ?? null}::timestamptz, approved_at),
      approved_by = COALESCE(${patch.approvedBy ?? null}::uuid, approved_by),
      activated_at = COALESCE(${patch.activatedAt ?? null}::timestamptz, activated_at),
      activated_by = COALESCE(${patch.activatedBy ?? null}::uuid, activated_by),
      closed_at = COALESCE(${patch.closedAt ?? null}::timestamptz, closed_at),
      closed_by = COALESCE(${patch.closedBy ?? null}::uuid, closed_by),
      updated_at = now(),
      version = version + 1
    WHERE id = ${id}
    RETURNING ${BUDGET_COLUMNS}
  `);
  const row = (rows.rows as unknown as BudgetSqlRow[])[0];
  if (row === undefined) {
    throw new Error(`budget ${id} vanished mid-transition (ambient tenant scope)`);
  }
  return mapBudget(row);
}

/**
 * The supersede flip (BR-050): the ACTIVE predecessor moves to REVISED at
 * the successor's activation — atomically ordered BEFORE the successor's
 * own ACTIVE flip so the partial unique `uq_budgets_one_active` stays
 * satisfied throughout (the 027 shape-CHECK lesson).
 */
export async function flipPredecessorToRevised(
  predecessorId: string,
  at: string,
  by: string | null,
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE budgets SET status = 'REVISED', updated_at = now(), version = version + 1
    WHERE id = ${predecessorId} AND status = 'ACTIVE'
  `);
  void at;
  void by;
}

export async function countActiveByYearScope(
  fiscalYearId: string,
  scope: BudgetScope,
): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT COUNT(*)::int AS n FROM budgets
    WHERE fiscal_year_id = ${fiscalYearId} AND scope = ${scope} AND status = 'ACTIVE'
  `);
  return Number((rows.rows as unknown as { n: number }[])[0]?.n ?? 0);
}

export async function activeBudgetsForTenant(): Promise<BudgetRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BUDGET_COLUMNS} FROM budgets WHERE status = 'ACTIVE' ORDER BY code
  `);
  return (rows.rows as unknown as BudgetSqlRow[]).map(mapBudget);
}

// -- the period grid ---------------------------------------------------------------

export interface BudgetLineRow {
  id: string;
  budgetId: string;
  fiscalPeriodId: string;
  accountId: string;
  costCenterId: string | null;
  projectId: string | null;
  branchId: string | null;
  amount: string;
}

interface BudgetLineSqlRow {
  id: string;
  budget_id: string;
  fiscal_period_id: string;
  account_id: string;
  cost_center_id: string | null;
  project_id: string | null;
  branch_id: string | null;
  amount: string;
}

function mapLine(row: BudgetLineSqlRow): BudgetLineRow {
  return {
    id: row.id,
    budgetId: row.budget_id,
    fiscalPeriodId: row.fiscal_period_id,
    accountId: row.account_id,
    costCenterId: row.cost_center_id,
    projectId: row.project_id,
    branchId: row.branch_id,
    amount: row.amount,
  };
}

export interface LineInsert {
  fiscalPeriodId: string;
  accountId: string;
  costCenterId?: string | null;
  projectId?: string | null;
  branchId?: string | null;
  amount: string;
}

/**
 * The DRAFT bulk replace: DELETE the budget's lines then INSERT the whole
 * grid (one ambient transaction — the caller validated DRAFT status
 * first; the service never deletes a non-DRAFT parent's lines).
 */
export async function replaceLines(
  budgetId: string,
  lines: readonly LineInsert[],
  createdBy: string | null = null,
): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`DELETE FROM budget_lines WHERE budget_id = ${budgetId}`);
  await insertLines(budgetId, lines, createdBy);
}

/** Batch insert grid lines (the supersede copy + the import commit path). */
export async function insertLines(
  budgetId: string,
  lines: readonly LineInsert[],
  createdBy: string | null = null,
): Promise<void> {
  if (lines.length === 0) {
    return;
  }
  const tenantId = requireTenantContext().tenantId;
  const chunks: LineInsert[][] = [];
  const CHUNK = 500;
  for (let i = 0; i < lines.length; i += CHUNK) {
    chunks.push(lines.slice(i, i + CHUNK));
  }
  for (const chunk of chunks) {
    const values = chunk.map(
      (line) => sql`(${generateUuidV7()}, ${tenantId}, ${createdBy}, ${budgetId},
        ${line.fiscalPeriodId}, ${line.accountId}, ${line.costCenterId ?? null},
        ${line.projectId ?? null}, ${line.branchId ?? null}, ${line.amount})`,
    );
    await tenantTx().execute(sql`
      INSERT INTO budget_lines (id, tenant_id, created_by, budget_id, fiscal_period_id,
        account_id, cost_center_id, project_id, branch_id, amount)
      VALUES ${sql.join(values, sql`, `)}
    `);
  }
}

export async function listLines(budgetId: string): Promise<BudgetLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, budget_id, fiscal_period_id, account_id, cost_center_id, project_id,
      branch_id, amount
    FROM budget_lines WHERE budget_id = ${budgetId}
    ORDER BY fiscal_period_id, account_id
  `);
  return (rows.rows as unknown as BudgetLineSqlRow[]).map(mapLine);
}

/** Per-period budget totals of one budget (the grid footer / consumption). */
export async function sumLinesByBudget(
  budgetId: string,
): Promise<{ fiscalPeriodId: string; total: string }[]> {
  const rows = await tenantTx().execute(sql`
    SELECT fiscal_period_id, SUM(amount)::text AS total
    FROM budget_lines WHERE budget_id = ${budgetId}
    GROUP BY fiscal_period_id
  `);
  return (rows.rows as unknown as { fiscal_period_id: string; total: string }[]).map((row) => ({
    fiscalPeriodId: row.fiscal_period_id,
    total: row.total,
  }));
}

/** Register-list aggregate: line count + year total per budget. */
export async function listBudgetSummaries(): Promise<
  { budgetId: string; lineCount: number; yearTotal: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT b.id AS budget_id, COUNT(l.id)::int AS line_count,
      COALESCE(SUM(l.amount), 0)::text AS year_total
    FROM budgets b LEFT JOIN budget_lines l ON l.budget_id = b.id
    GROUP BY b.id
  `);
  return (rows.rows as unknown as { budget_id: string; line_count: number; year_total: string }[]).map(
    (row) => ({
      budgetId: row.budget_id,
      lineCount: Number(row.line_count),
      yearTotal: row.year_total,
    }),
  );
}

// -- dimension read refs (own-tenant existence — RLS keeps foreign opaque) ----------

export interface FiscalPeriodInfo {
  id: string;
  fiscalYearId: string;
  name: string;
  nameAr: string | null;
  kind: string;
  startDate: string;
  endDate: string;
  status: string;
}

export async function listPeriodsOfYear(fiscalYearId: string): Promise<FiscalPeriodInfo[]> {
  // REGULAR months only — the OPENING/CLOSING/ADJUSTMENT system periods of
  // the fiscal calendar (G-16's posting windows) are not planning columns;
  // the grid adapts to the tenant's actual REGULAR period count.
  const rows = await tenantTx().execute(sql`
    SELECT id, fiscal_year_id, name, kind, start_date, end_date, status
    FROM fiscal_periods
    WHERE fiscal_year_id = ${fiscalYearId} AND kind = 'REGULAR'
    ORDER BY start_date
  `);
  return (rows.rows as unknown as Record<string, string | null>[]).map((row) => ({
    id: row.id as string,
    fiscalYearId: row.fiscal_year_id as string,
    name: row.name as string,
    nameAr: null,
    kind: row.kind as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    status: row.status as string,
  }));
}

export interface AccountInfo {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: string;
  isPostable: boolean;
}

export async function findAccount(id: string): Promise<AccountInfo | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar, type, is_postable FROM accounts WHERE id = ${id} LIMIT 1
  `);
  const row = (rows.rows as unknown as Record<string, unknown>[])[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    nameAr: (row.name_ar as string | null) ?? null,
    type: row.type as string,
    isPostable: Boolean(row.is_postable),
  };
}

export async function findAccountByCode(code: string): Promise<AccountInfo | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar, type, is_postable FROM accounts WHERE code = ${code} LIMIT 1
  `);
  const row = (rows.rows as unknown as Record<string, unknown>[])[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    nameAr: (row.name_ar as string | null) ?? null,
    type: row.type as string,
    isPostable: Boolean(row.is_postable),
  };
}

export interface FiscalYearInfo {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

export async function findFiscalYear(id: string): Promise<FiscalYearInfo | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, name, start_date, end_date, status FROM fiscal_years WHERE id = ${id} LIMIT 1
  `);
  const row = (rows.rows as unknown as Record<string, unknown>[])[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id as string,
    name: row.name as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    status: row.status as string,
  };
}

export interface DimensionInfo {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
}

export async function findCostCenter(id: string): Promise<DimensionInfo | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar FROM cost_centers WHERE id = ${id} LIMIT 1
  `);
  return dimensionOf(rows);
}

export async function findProject(id: string): Promise<DimensionInfo | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar FROM projects WHERE id = ${id} LIMIT 1
  `);
  return dimensionOf(rows);
}

export async function findBranch(id: string): Promise<DimensionInfo | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar FROM branches WHERE id = ${id} LIMIT 1
  `);
  return dimensionOf(rows);
}

function dimensionOf(rows: { rows: unknown }): DimensionInfo | undefined {
  const row = (rows.rows as unknown as Record<string, unknown>[])[0];
  if (row === undefined) {
    return undefined;
  }
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    nameAr: (row.name_ar as string | null) ?? null,
  };
}

// -- the GL consumption read model (SELECT-only — the variance substrate) -----------

export type ActualsDimension = "ACCOUNTS" | "COST_CENTERS" | "PROJECTS" | "BRANCHES";

export interface ActualsRow {
  fiscalPeriodId: string;
  accountId: string;
  /** The grouping dimension key (cost center / project / branch id); NULL
   * for ACCOUNTS grouping, and NULL under BRANCHES grouping for lines whose
   * entry carries no branch-attributable source (the honest unattributed
   * bucket — summed, never dropped). */
  dimensionId: string | null;
  debit: string;
  credit: string;
}

/**
 * THE shared actuals query (T5 — read-only, the ONE place the GL is read
 * for budget variance — the reporting contracts and the consumption
 * service both call this): per (fiscal period, account, scope dimension)
 * debit/credit sums over the posted journal lines whose entry_date falls
 * in the period, grouped by the budget's scope dimension:
 *  - ACCOUNTS: GROUP BY (period, account) — the whole-tenant ledger-tie
 *    basis (unfiltered);
 *  - COST_CENTERS / PROJECTS: journal_lines carry the dimension directly;
 *  - BRANCHES: the branch derives through the entry's SOURCE document
 *    (sales_invoices/supplier_invoices/credit_notes/debit_notes own
 *    branch_id) via a LATERAL fold — lines whose entry carries no
 *    branch-attributable source land in the NULL (unattributed) bucket,
 *    which the variance report renders explicitly (never silently
 *    dropped, never double-counted).
 * Natural-direction convention applied at the CONSUMER: actual =
 * debit−credit for ASSET/EXPENSE accounts, credit−debit for
 * LIABILITY/EQUITY/REVENUE.
 *
 * This function NEVER writes anything (grep-clean by construction — the
 * negative ledger proof).
 */
export async function actualsForPeriods(
  fiscalYearId: string,
  dimension: ActualsDimension = "ACCOUNTS",
  asOf?: string | null,
): Promise<ActualsRow[]> {
  const dimensionExpr =
    dimension === "COST_CENTERS"
      ? sql`l.cost_center_id`
      : dimension === "PROJECTS"
        ? sql`l.project_id`
        : dimension === "BRANCHES"
          ? sql`src.branch_id`
          : sql`NULL::uuid`;
  const branchJoin =
    dimension === "BRANCHES"
      ? sql`LEFT JOIN LATERAL (
            SELECT si.branch_id FROM journal_entries e2
              LEFT JOIN sales_invoices si ON e2.source_type = 'sales_invoice' AND si.id = e2.source_id
              LEFT JOIN supplier_invoices xi ON e2.source_type = 'supplier_invoice' AND xi.id = e2.source_id
              LEFT JOIN credit_notes cn ON e2.source_type = 'credit_note' AND cn.id = e2.source_id
              LEFT JOIN debit_notes dn ON e2.source_type = 'debit_note' AND dn.id = e2.source_id
            WHERE e2.id = l.journal_entry_id LIMIT 1
          ) src ON true`
      : sql``;
  const rows = await tenantTx().execute(sql`
    SELECT p.id AS fiscal_period_id, l.account_id, ${dimensionExpr} AS dimension_id,
      COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE 0 END), 0)::text AS debit,
      COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.base_amount ELSE 0 END), 0)::text AS credit
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    JOIN fiscal_periods p ON e.entry_date BETWEEN p.start_date AND p.end_date
    ${branchJoin}
    WHERE p.fiscal_year_id = ${fiscalYearId}
      AND (${asOf ?? null}::date IS NULL OR e.entry_date <= ${asOf ?? null})
    GROUP BY p.id, p.start_date, l.account_id, ${dimensionExpr}
    ORDER BY p.start_date, l.account_id
  `);
  return (
    rows.rows as unknown as {
      fiscal_period_id: string;
      account_id: string;
      dimension_id: string | null;
      debit: string;
      credit: string;
    }[]
  ).map((row) => ({
    fiscalPeriodId: row.fiscal_period_id,
    accountId: row.account_id,
    dimensionId: row.dimension_id,
    debit: row.debit,
    credit: row.credit,
  }));
}

/** Dimension lookups by tenant-scoped code (the import path). */
export async function findCostCenterByCode(code: string): Promise<DimensionInfo | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar FROM cost_centers WHERE code = ${code} LIMIT 1
  `);
  return dimensionOf(rows);
}

export async function findProjectByCode(code: string): Promise<DimensionInfo | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar FROM projects WHERE code = ${code} LIMIT 1
  `);
  return dimensionOf(rows);
}

export async function findBranchByCode(code: string): Promise<DimensionInfo | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar FROM branches WHERE code = ${code} LIMIT 1
  `);
  return dimensionOf(rows);
}
