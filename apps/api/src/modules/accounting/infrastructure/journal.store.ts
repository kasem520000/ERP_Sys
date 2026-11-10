import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import type { PostingPlan } from "../domain/posting-engine/journal-spec";

/**
 * Journal store (PHASE-007 T7/T8): the ONLY code that writes
 * journal_entries/journal_lines (ADR-0007) — reached exclusively through
 * the posting application service; every statement runs inside the ambient
 * tenant transaction so the caller's UoW commits entry + lines + subledger
 * + audit atomically (POSTING_ENGINE §5; INV-003/006/013).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("journal access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface JournalEntryRow {
  id: string;
  entryNo: string | null;
  entryDate: string;
  fiscalPeriodId: string;
  currencyCode: string;
  exchangeRate: string;
  status: string;
  sourceType: string;
  sourceId: string | null;
  operation: string;
  reversalOfId: string | null;
  reversedById: string | null;
  description: string | null;
  descriptionAr: string | null;
  postReason: string | null;
  postedAt: string;
  postedBy: string | null;
}

export interface JournalLineRow {
  id: string;
  journalEntryId: string;
  lineNo: number;
  accountId: string;
  accountCode?: string;
  direction: string;
  amount: string;
  baseAmount: string;
  partnerId: string | null;
  itemId: string | null;
  costCenterId: string | null;
  taxCodeId: string | null;
  projectId: string | null;
  memo: string | null;
  memoAr: string | null;
}

const ENTRY_COLUMNS = sql`id, entry_no AS "entryNo", entry_date AS "entryDate",
  fiscal_period_id AS "fiscalPeriodId", currency_code AS "currencyCode", exchange_rate AS "exchangeRate",
  status, source_type AS "sourceType", source_id AS "sourceId", operation,
  reversal_of_id AS "reversalOfId", reversed_by_id AS "reversedById",
  description, description_ar AS "descriptionAr", post_reason AS "postReason",
  posted_at AS "postedAt", posted_by AS "postedBy"`;

const LINE_COLUMNS = sql`l.id, l.journal_entry_id AS "journalEntryId", l.line_no AS "lineNo",
  l.account_id AS "accountId", a.code AS "accountCode", l.direction, l.amount, l.base_amount AS "baseAmount",
  l.partner_id AS "partnerId", l.item_id AS "itemId", l.cost_center_id AS "costCenterId",
  l.tax_code_id AS "taxCodeId", l.project_id AS "projectId", l.memo, l.memo_ar AS "memoAr"`;

export async function findEntryById(id: string): Promise<JournalEntryRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ENTRY_COLUMNS} FROM journal_entries WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as JournalEntryRow[])[0];
}

export async function findEntryBySourceKey(
  sourceType: string,
  sourceId: string,
  operation: string,
): Promise<JournalEntryRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ENTRY_COLUMNS} FROM journal_entries
    WHERE source_type = ${sourceType} AND source_id = ${sourceId} AND operation = ${operation}
    LIMIT 1
  `);
  return (rows.rows as unknown as JournalEntryRow[])[0];
}

export async function listEntries(filter: {
  fromDate?: string;
  toDate?: string;
  status?: string;
  sourceType?: string;
  cursor?: string;
  limit: number;
}): Promise<{ rows: JournalEntryRow[]; nextCursor: string | null }> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ENTRY_COLUMNS} FROM journal_entries
    WHERE (${filter.fromDate ?? null}::date IS NULL OR entry_date >= ${filter.fromDate ?? null})
      AND (${filter.toDate ?? null}::date IS NULL OR entry_date <= ${filter.toDate ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.sourceType ?? null}::text IS NULL OR source_type = ${filter.sourceType ?? null})
    ORDER BY entry_date DESC, id
    LIMIT ${filter.limit + 1}
  `);
  const all = rows.rows as unknown as JournalEntryRow[];
  const page = all.slice(0, filter.limit);
  return { rows: page, nextCursor: page.length < filter.limit ? null : page[page.length - 1]!.id };
}

export async function listLines(entryId: string): Promise<JournalLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LINE_COLUMNS} FROM journal_lines l JOIN accounts a ON a.id = l.account_id
    WHERE l.journal_entry_id = ${entryId} ORDER BY l.line_no
  `);
  return rows.rows as unknown as JournalLineRow[];
}

/**
 * The engine's write phase (validation step 8): insert the POSTED entry +
 * lines. Idempotent by construction — the unique index
 * (tenant, source_type, source_id, operation) makes concurrent duplicates
 * fail with 23505, which the posting service turns into the stored result
 * (CC-01). Returns the stored entry_no.
 */
export async function insertPostedEntry(input: {
  plan: PostingPlan;
  entryNo: string;
  postedBy: string | null;
  reversalOfId: string | null;
}): Promise<JournalEntryRow> {
  const spec = input.plan.spec;
  const rows = await tenantTx().execute(sql`
    INSERT INTO journal_entries (id, tenant_id, entry_no, entry_date, fiscal_period_id, currency_code,
                                 exchange_rate, status, source_type, source_id, operation,
                                 reversal_of_id, description, description_ar, post_reason, posted_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.entryNo}, ${spec.entryDate},
            ${input.plan.fiscalPeriodId}, ${spec.currency}, ${input.plan.exchangeRate}, 'POSTED',
            ${spec.source.docType}, ${spec.source.docId}, ${spec.source.operation}, ${input.reversalOfId},
            ${spec.description?.en ?? null}, ${spec.description?.ar ?? null},
            ${spec.softCloseReason ?? null}, ${input.postedBy})
    RETURNING ${ENTRY_COLUMNS}
  `);
  const entry = (rows.rows as unknown as JournalEntryRow[])[0]!;
  for (const line of input.plan.lines) {
    await insertLine(entry.id, line);
  }
  return entry;
}

async function insertLine(
  entryId: string,
  line: PostingPlan["lines"][number],
): Promise<JournalLineRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO journal_lines (id, tenant_id, journal_entry_id, line_no, account_id, direction,
                               amount, base_amount, partner_id, item_id, cost_center_id, tax_code_id,
                               project_id, memo, memo_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${entryId}, ${line.lineNo}, ${line.accountId},
            ${line.direction}, ${line.amount}, ${line.baseAmount}, ${line.partnerId ?? null},
            ${line.itemId ?? null}, ${line.costCenterId ?? null}, ${line.taxCodeId ?? null},
            ${line.projectId ?? null}, ${line.memo?.en ?? null}, ${line.memo?.ar ?? null})
    RETURNING id, journal_entry_id AS "journalEntryId", line_no AS "lineNo", account_id AS "accountId",
              direction, amount, base_amount AS "baseAmount", partner_id AS "partnerId",
              item_id AS "itemId", cost_center_id AS "costCenterId", tax_code_id AS "taxCodeId",
              project_id AS "projectId", memo, memo_ar AS "memoAr"
  `);
  return (rows.rows as unknown as JournalLineRow[])[0]!;
}

/** The sanctioned reversal link (INV-014): original POSTED → REVERSED. */
export async function markEntryReversed(originalId: string, reversalId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE journal_entries SET status = 'REVERSED', reversed_by_id = ${reversalId},
                              version = version + 1, updated_at = now()
    WHERE id = ${originalId} AND status = 'POSTED' AND reversed_by_id IS NULL
  `);
}

// -- partner subledger rows (partners module api; same transaction) -----------

export async function insertPartnerSubledgerRow(input: {
  partnerId: string;
  journalEntryId: string;
  journalLineId: string;
  entryDate: string;
  direction: string;
  amount: string;
  baseAmount: string;
  currencyCode: string;
  sourceType: string;
  sourceId: string | null;
  memo: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO partner_subledger_entries (id, tenant_id, partner_id, journal_entry_id, journal_line_id,
                                           entry_date, direction, amount, base_amount, currency_code,
                                           source_type, source_id, memo)
    VALUES (${id}, erp.current_tenant_id(), ${input.partnerId}, ${input.journalEntryId},
            ${input.journalLineId}, ${input.entryDate}, ${input.direction}, ${input.amount},
            ${input.baseAmount}, ${input.currencyCode}, ${input.sourceType}, ${input.sourceId}, ${input.memo})
  `);
  return id;
}

/** AR/AP control balance (base) — the reconciliation's control side. */
export async function controlAccountBalance(accountId: string): Promise<string> {
  const rows = await tenantTx().execute<{ balance: string }>(sql`
    SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE -base_amount END), 0)::text AS balance
    FROM journal_lines WHERE account_id = ${accountId}
  `);
  return rows.rows[0]?.balance ?? "0";
}

/** Partner subledger balance (base) — the reconciliation's subledger side. */
export async function partnerSubledgerBalance(partnerIds: readonly string[]): Promise<string> {
  if (partnerIds.length === 0) return "0";
  const idList = sql.join(
    partnerIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await tenantTx().execute<{ balance: string }>(sql`
    SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE -base_amount END), 0)::text AS balance
    FROM partner_subledger_entries
    WHERE partner_id IN (${idList})
  `);
  return rows.rows[0]?.balance ?? "0";
}

export async function listPartnersWithSubledger(): Promise<
  { partnerId: string; balance: string }[]
> {
  const rows = await tenantTx().execute<{ partnerId: string; balance: string }>(sql`
    SELECT partner_id AS "partnerId",
           SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE -base_amount END)::text AS balance
    FROM partner_subledger_entries GROUP BY partner_id
  `);
  return rows.rows;
}

// -- opening-balance document state (T14 seam) ---------------------------------

export async function markOpeningDocsPosted(input: {
  docIds: readonly string[];
  journalEntryId: string;
}): Promise<void> {
  if (input.docIds.length === 0) return;
  const idList = sql.join(
    input.docIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  await tenantTx().execute(sql`
    UPDATE opening_balance_docs SET status = 'POSTED', posted_journal_id = ${input.journalEntryId},
                                    posted_at = now(), version = version + 1, updated_at = now()
    WHERE id IN (${idList})
  `);
}

// -- GL queries (T12) ------------------------------------------------------------

export interface GlMovementRow {
  journalEntryId: string;
  entryNo: string | null;
  entryDate: string;
  lineNo: number;
  direction: string;
  amount: string;
  baseAmount: string;
  memo: string | null;
  partnerId: string | null;
  itemId: string | null;
  costCenterId: string | null;
  /** PHASE-019 (§8): the projects dimension stamp on the movement feed
   * (the GL browser's project column — mirrors costCenterId). */
  projectId: string | null;
  balanceAfter?: string;
}

export async function accountMovements(input: {
  accountId: string;
  fromDate?: string;
  toDate?: string;
  limit: number;
  /** PHASE-019 (§8): restrict the feed to one project's lines (NULL = all). */
  projectId?: string;
}): Promise<GlMovementRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.journal_entry_id AS "journalEntryId", e.entry_no AS "entryNo", e.entry_date AS "entryDate",
           l.line_no AS "lineNo", l.direction, l.amount, l.base_amount AS "baseAmount",
           l.memo, l.partner_id AS "partnerId", l.item_id AS "itemId", l.cost_center_id AS "costCenterId",
           l.project_id AS "projectId"
    FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE l.account_id = ${input.accountId}
      AND (${input.fromDate ?? null}::date IS NULL OR e.entry_date >= ${input.fromDate ?? null})
      AND (${input.toDate ?? null}::date IS NULL OR e.entry_date <= ${input.toDate ?? null})
      AND (${input.projectId ?? null}::uuid IS NULL OR l.project_id = ${input.projectId ?? null})
    ORDER BY e.entry_date, e.id, l.line_no
    LIMIT ${input.limit}
  `);
  return rows.rows as unknown as GlMovementRow[];
}

export interface AccountBalanceRow {
  accountId: string;
  code: string;
  name: string;
  nameAr: string;
  type: string;
  debit: string;
  credit: string;
  balance: string;
}

export async function trialBalances(input: {
  fromDate?: string;
  toDate?: string;
  /** PHASE-019 (§8): restrict the window to one project's lines (NULL = all)
   * — project-filtered totals equal the unfiltered slice sums by
   * construction (the same journal_lines rows, sliced). */
  projectId?: string;
}): Promise<AccountBalanceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT a.id AS "accountId", a.code, a.name, a.name_ar AS "nameAr", a.type,
           COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE 0 END), 0)::text AS debit,
           COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.base_amount ELSE 0 END), 0)::text AS credit,
           COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0)::text AS balance
    FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
      AND (${input.projectId ?? null}::uuid IS NULL OR l.project_id = ${input.projectId ?? null})
      AND EXISTS (
        SELECT 1 FROM journal_entries e
        WHERE e.id = l.journal_entry_id
          AND (${input.fromDate ?? null}::date IS NULL OR e.entry_date >= ${input.fromDate ?? null})
          AND (${input.toDate ?? null}::date IS NULL OR e.entry_date <= ${input.toDate ?? null})
      )
    WHERE a.is_postable
    GROUP BY a.id, a.code, a.name, a.name_ar, a.type
    HAVING COUNT(l.id) > 0
    ORDER BY a.code
  `);
  return rows.rows as unknown as AccountBalanceRow[];
}

export interface JournalRegisterRow {
  id: string;
  entryNo: string | null;
  entryDate: string;
  description: string | null;
  sourceType: string;
  status: string;
  currencyCode: string;
  totalDebit: string;
  totalCredit: string;
}

export async function journalRegister(input: {
  fromDate?: string;
  toDate?: string;
  sourceType?: string;
  limit: number;
  /** PHASE-019 (§8): restrict the register to entries carrying at least
   * one line of the project — the totals then sum ONLY that project's
   * lines within each entry (NULL = the unfiltered register). */
  projectId?: string;
}): Promise<JournalRegisterRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT e.id, e.entry_no AS "entryNo", e.entry_date AS "entryDate", e.description,
           e.source_type AS "sourceType", e.status, e.currency_code AS "currencyCode",
           COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount ELSE 0 END), 0)::text AS "totalDebit",
           COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.amount ELSE 0 END), 0)::text AS "totalCredit"
    FROM journal_entries e LEFT JOIN journal_lines l ON l.journal_entry_id = e.id
      AND (${input.projectId ?? null}::uuid IS NULL OR l.project_id = ${input.projectId ?? null})
    WHERE (${input.fromDate ?? null}::date IS NULL OR e.entry_date >= ${input.fromDate ?? null})
      AND (${input.toDate ?? null}::date IS NULL OR e.entry_date <= ${input.toDate ?? null})
      AND (${input.sourceType ?? null}::text IS NULL OR e.source_type = ${input.sourceType ?? null})
      AND (
        ${input.projectId ?? null}::uuid IS NULL
        OR EXISTS (
          SELECT 1 FROM journal_lines pl
          WHERE pl.journal_entry_id = e.id AND pl.project_id = ${input.projectId ?? null}
        )
      )
    GROUP BY e.id ORDER BY e.entry_date DESC, e.id DESC
    LIMIT ${input.limit}
  `);
  return rows.rows as unknown as JournalRegisterRow[];
}

/** EXPLAIN evidence helper: confirm the tenant-first indexes drive GL queries. */
export async function explainAccountMovements(accountId: string): Promise<string> {
  const rows = await tenantTx().execute<{ "QUERY PLAN": string }>(sql`
    EXPLAIN (COSTS OFF)
    SELECT * FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE l.account_id = ${accountId} AND e.entry_date >= '2026-01-01' AND e.entry_date <= '2026-12-31'
  `);
  return rows.rows.map((row) => row["QUERY PLAN"]).join("\n");
}

// -- reconciliation runs (T16) ------------------------------------------------------

export interface ReconciliationRunRow {
  id: string;
  kind: string;
  asOf: string;
  status: string;
  controlBalance: string;
  subledgerBalance: string;
  diffCount: number;
  diff: unknown;
  runMode: string;
}

export async function insertReconciliationRun(input: {
  kind: string;
  asOf: string;
  status: "OK" | "BROKEN";
  controlBalance: string;
  subledgerBalance: string;
  diffCount: number;
  diff: unknown;
  runMode: "NIGHTLY" | "ON_DEMAND";
  checkedBy: string | null;
}): Promise<ReconciliationRunRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO reconciliation_runs (id, tenant_id, kind, as_of, status, control_balance, subledger_balance,
                                     diff_count, diff, run_mode, checked_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.kind}, ${input.asOf}, ${input.status},
            ${input.controlBalance}, ${input.subledgerBalance}, ${input.diffCount},
            ${JSON.stringify(input.diff ?? null)}::jsonb, ${input.runMode}, ${input.checkedBy})
    RETURNING id, kind, as_of AS "asOf", status, control_balance AS "controlBalance",
              subledger_balance AS "subledgerBalance", diff_count AS "diffCount", diff,
              run_mode AS "runMode"
  `);
  return (rows.rows as unknown as ReconciliationRunRow[])[0]!;
}

export async function latestReconciliationRuns(asOf: string): Promise<ReconciliationRunRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT DISTINCT ON (kind) id, kind, as_of AS "asOf", status, control_balance AS "controlBalance",
           subledger_balance AS "subledgerBalance", diff_count AS "diffCount", diff, run_mode AS "runMode"
    FROM reconciliation_runs WHERE as_of <= ${asOf}
    ORDER BY kind, as_of DESC, created_at DESC
  `);
  return rows.rows as unknown as ReconciliationRunRow[];
}

// -- manual journal drafts (T9; the document layer feeding the engine) ---------

export interface ManualJournalRow {
  id: string;
  status: string;
  entryDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  rateSource: string;
  description: string | null;
  descriptionAr: string | null;
  reference: string | null;
  recurrenceId: string | null;
  templateId: string | null;
  postedJournalId: string | null;
  approvalStep: number;
  createdBy: string | null;
  approvedBy: string | null;
  cancelledReason: string | null;
}

export interface ManualJournalLineInput {
  lineNo: number;
  accountId: string;
  direction: string;
  amount: string;
  partnerId: string | null;
  itemId: string | null;
  costCenterId: string | null;
  taxCodeId: string | null;
  /** PHASE-019 (§8): the projects dimension stamp on the DRAFT substrate
   * (persisted to manual_journal_lines.project_id; the consumer wiring —
   * zod per line + buildSpec — lands with T44). Optional here so existing
   * callers compile unchanged; absent stamps travel as NULL. */
  projectId?: string | null;
  memo: string | null;
  memoAr: string | null;
}

export interface ManualJournalLine extends ManualJournalLineInput {
  id: string;
  manualJournalId: string;
  /** Stored stamp (NULL when the line carries none). */
  projectId: string | null;
}

const MANUAL_COLUMNS = sql`id, status, entry_date AS "entryDate", currency_code AS "currencyCode",
  exchange_rate AS "exchangeRate", rate_source AS "rateSource", description, description_ar AS "descriptionAr",
  reference, recurrence_id AS "recurrenceId", template_id AS "templateId",
  posted_journal_id AS "postedJournalId", approval_step AS "approvalStep", created_by AS "createdBy",
  approved_by AS "approvedBy", cancel_reason AS "cancelledReason"`;

export async function findManualJournalById(id: string): Promise<ManualJournalRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MANUAL_COLUMNS} FROM manual_journals WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ManualJournalRow[])[0];
}

export async function listManualJournals(filter: {
  status?: string;
  recurrenceId?: string;
  entryDateFrom?: string;
  entryDateTo?: string;
  limit: number;
}): Promise<ManualJournalRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MANUAL_COLUMNS} FROM manual_journals
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.recurrenceId ?? null}::uuid IS NULL OR recurrence_id = ${filter.recurrenceId ?? null})
      AND (${filter.entryDateFrom ?? null}::date IS NULL OR entry_date >= ${filter.entryDateFrom ?? null})
      AND (${filter.entryDateTo ?? null}::date IS NULL OR entry_date <= ${filter.entryDateTo ?? null})
    ORDER BY entry_date DESC, created_at DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ManualJournalRow[];
}

export async function insertManualJournal(input: {
  createdBy: string | null;
  entryDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  rateSource: string;
  description: string | null;
  descriptionAr: string | null;
  reference: string | null;
  recurrenceId: string | null;
  templateId: string | null;
}): Promise<ManualJournalRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO manual_journals (id, tenant_id, created_by, status, entry_date, currency_code,
                                 exchange_rate, rate_source, description, description_ar, reference,
                                 recurrence_id, template_id)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.createdBy ?? null}, 'DRAFT', ${input.entryDate},
            ${input.currencyCode}, ${input.exchangeRate ?? null}, ${input.rateSource}, ${input.description ?? null},
            ${input.descriptionAr ?? null}, ${input.reference ?? null}, ${input.recurrenceId ?? null}, ${input.templateId ?? null})
    RETURNING ${MANUAL_COLUMNS}
  `);
  return (rows.rows as unknown as ManualJournalRow[])[0]!;
}

export async function updateManualJournal(
  id: string,
  patch: {
    entryDate?: string;
    exchangeRate?: string | null;
    rateSource?: string;
    description?: string | null;
    descriptionAr?: string | null;
    reference?: string | null;
  },
): Promise<ManualJournalRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE manual_journals SET
      entry_date = COALESCE(${patch.entryDate ?? null}, entry_date),
      exchange_rate = CASE WHEN ${patch.exchangeRate ?? null}::numeric IS NULL THEN exchange_rate ELSE ${patch.exchangeRate ?? null} END,
      rate_source = COALESCE(${patch.rateSource ?? null}, rate_source),
      description = CASE WHEN ${patch.description ?? null}::text IS NULL THEN description ELSE ${patch.description ?? null} END,
      description_ar = CASE WHEN ${patch.descriptionAr ?? null}::text IS NULL THEN description_ar ELSE ${patch.descriptionAr ?? null} END,
      reference = CASE WHEN ${patch.reference ?? null}::text IS NULL THEN reference ELSE ${patch.reference ?? null} END,
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING ${MANUAL_COLUMNS}
  `);
  return (rows.rows as unknown as ManualJournalRow[])[0];
}

export async function setManualJournalState(
  id: string,
  patch: {
    status?: string;
    approvalStep?: number;
    submittedBy?: string;
    approvedBy?: string;
    postedJournalId?: string;
    postedBy?: string;
    cancelledBy?: string;
    cancelReason?: string;
  },
): Promise<ManualJournalRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE manual_journals SET
      status = COALESCE(${patch.status ?? null}, status),
      approval_step = COALESCE(${patch.approvalStep ?? null}, approval_step),
      submitted_at = CASE WHEN ${patch.submittedBy ?? null}::uuid IS NULL THEN submitted_at ELSE now() END,
      submitted_by = CASE WHEN ${patch.submittedBy ?? null}::uuid IS NULL THEN submitted_by ELSE ${patch.submittedBy ?? null}::uuid END,
      approved_at = CASE WHEN ${patch.approvedBy ?? null}::uuid IS NULL THEN approved_at ELSE now() END,
      approved_by = CASE WHEN ${patch.approvedBy ?? null}::uuid IS NULL THEN approved_by ELSE ${patch.approvedBy ?? null}::uuid END,
      posted_at = CASE WHEN ${patch.postedJournalId ?? null}::uuid IS NULL THEN posted_at ELSE now() END,
      posted_journal_id = CASE WHEN ${patch.postedJournalId ?? null}::uuid IS NULL THEN posted_journal_id ELSE ${patch.postedJournalId ?? null}::uuid END,
      posted_by = CASE WHEN ${patch.postedBy ?? null}::uuid IS NULL THEN posted_by ELSE ${patch.postedBy ?? null}::uuid END,
      cancelled_at = CASE WHEN ${patch.cancelledBy ?? null}::uuid IS NULL THEN cancelled_at ELSE now() END,
      cancelled_by = CASE WHEN ${patch.cancelledBy ?? null}::uuid IS NULL THEN cancelled_by ELSE ${patch.cancelledBy ?? null}::uuid END,
      cancel_reason = CASE WHEN ${patch.cancelReason ?? null}::text IS NULL THEN cancel_reason ELSE ${patch.cancelReason ?? null} END,
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING ${MANUAL_COLUMNS}
  `);
  return (rows.rows as unknown as ManualJournalRow[])[0];
}

export async function replaceManualJournalLines(
  manualJournalId: string,
  lines: readonly ManualJournalLineInput[],
): Promise<void> {
  await tenantTx().execute(sql`DELETE FROM manual_journal_lines WHERE manual_journal_id = ${manualJournalId}`);
  for (const line of lines) {
    await tenantTx().execute(sql`
      INSERT INTO manual_journal_lines (id, tenant_id, manual_journal_id, line_no, account_id, direction,
                                        amount, partner_id, item_id, cost_center_id, tax_code_id,
                                        project_id, memo, memo_ar)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${manualJournalId}, ${line.lineNo},
              ${line.accountId}, ${line.direction}, ${line.amount}, ${line.partnerId}, ${line.itemId},
              ${line.costCenterId}, ${line.taxCodeId}, ${line.projectId ?? null}, ${line.memo}, ${line.memoAr})
    `);
  }
}

export async function listManualJournalLines(
  manualJournalId: string,
): Promise<ManualJournalLine[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, manual_journal_id AS "manualJournalId", line_no AS "lineNo", account_id AS "accountId",
           direction, amount, partner_id AS "partnerId", item_id AS "itemId",
           cost_center_id AS "costCenterId", tax_code_id AS "taxCodeId",
           project_id AS "projectId", memo, memo_ar AS "memoAr"
    FROM manual_journal_lines WHERE manual_journal_id = ${manualJournalId} ORDER BY line_no
  `);
  return rows.rows as unknown as ManualJournalLine[];
}

export async function deleteManualJournal(id: string): Promise<void> {
  await tenantTx().execute(sql`DELETE FROM manual_journals WHERE id = ${id}`);
}

/** Foreign-currency exposure per account (G-19 minimal revaluation input). */
export async function foreignCurrencyBalances(
  currencyCode: string,
): Promise<{ accountId: string; foreignBalance: string; baseBalance: string }[]> {
  const rows = await tenantTx().execute<{ accountId: string; foreignBalance: string; baseBalance: string }>(sql`
    SELECT l.account_id AS "accountId",
           SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount ELSE -l.amount END)::text AS "foreignBalance",
           SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END)::text AS "baseBalance"
    FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE e.currency_code = ${currencyCode}
    GROUP BY l.account_id
  `);
  return rows.rows;
}

/** Per-partner AR/AP subledger balance on ONE control account (RC diffs). */
export async function subledgerBalancesOnAccount(
  accountId: string,
): Promise<{ partnerId: string; balance: string }[]> {
  const rows = await tenantTx().execute<{ partnerId: string; balance: string }>(sql`
    SELECT s.partner_id AS "partnerId",
           SUM(CASE WHEN s.direction = 'DEBIT' THEN s.base_amount ELSE -s.base_amount END)::text AS balance
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    WHERE l.account_id = ${accountId}
    GROUP BY s.partner_id
  `);
  return rows.rows;
}

// ---------------------------------------------------------------------------
// PHASE-013 · statement query substrate (T6 — statement-queries.ts consumes
// these; FINANCIAL_REPORT_RULES §1–§5 are implemented one level up). All
// windows are (entry_date × posted_at)-scoped: the asOf cutoff freezes the
// posted-line history a run sees (§7 as-of determinism — a later-created
// pre-dated reversal is INVISIBLE to an earlier asOf).
// ---------------------------------------------------------------------------

export interface StatementWindowRow {
  accountId: string;
  code: string;
  name: string;
  nameAr: string;
  type: string;
  parentCode: string | null;
  purposeKeys: string[];
  openingSigned: string;
  periodSigned: string;
  periodDebit: string;
  periodCredit: string;
}

/**
 * The trial-balance window feed: per postable account, the signed opening
 * balance (before dateFrom), period movement (dateFrom..dateTo), and period
 * debit/credit flows — all under the asOf posted_at cutoff.
 */
export async function statementAccountWindow(input: {
  fromDate: string;
  toDate: string;
  asOf: string | null;
}): Promise<StatementWindowRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT a.id AS "accountId", a.code, a.name, a.name_ar AS "nameAr", a.type,
           parent.code AS "parentCode",
           COALESCE(array_agg(DISTINCT p.purpose_key) FILTER (WHERE p.purpose_key IS NOT NULL), '{}') AS "purposeKeys",
           COALESCE(SUM(CASE WHEN e.entry_date < ${input.fromDate}
                 THEN CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END
                 ELSE 0 END), 0)::text AS "openingSigned",
           COALESCE(SUM(CASE WHEN e.entry_date >= ${input.fromDate} AND e.entry_date <= ${input.toDate}
                 THEN CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END
                 ELSE 0 END), 0)::text AS "periodSigned",
           COALESCE(SUM(CASE WHEN e.entry_date >= ${input.fromDate} AND e.entry_date <= ${input.toDate}
                 AND l.direction = 'DEBIT' THEN l.base_amount ELSE 0 END), 0)::text AS "periodDebit",
           COALESCE(SUM(CASE WHEN e.entry_date >= ${input.fromDate} AND e.entry_date <= ${input.toDate}
                 AND l.direction = 'CREDIT' THEN l.base_amount ELSE 0 END), 0)::text AS "periodCredit"
    FROM accounts a
    JOIN journal_lines l ON l.account_id = a.id
    JOIN journal_entries e ON e.id = l.journal_entry_id
    LEFT JOIN accounts parent ON parent.id = a.parent_id
    LEFT JOIN account_purposes p ON p.account_id = a.id AND p.active_to IS NULL
    WHERE a.is_postable
      AND (${input.asOf}::timestamptz IS NULL OR e.posted_at <= ${input.asOf}::timestamptz)
    GROUP BY a.id, a.code, a.name, a.name_ar, a.type, parent.code
    HAVING COUNT(l.id) > 0
    ORDER BY a.code
  `);
  return rows.rows as unknown as StatementWindowRow[];
}

/**
 * Signed balance of every postable account with lines up to an asOf date
 * (balance-sheet / cash-flow delta substrate; two calls = Δ).
 */
export async function accountBalancesAt(input: {
  asOfDate: string;
  asOf: string | null;
}): Promise<
  {
    accountId: string;
    code: string;
    name: string;
    nameAr: string;
    type: string;
    parentCode: string | null;
    purposeKeys: string[];
    signedBalance: string;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT a.id AS "accountId", a.code, a.name, a.name_ar AS "nameAr", a.type,
           parent.code AS "parentCode",
           COALESCE(array_agg(DISTINCT p.purpose_key) FILTER (WHERE p.purpose_key IS NOT NULL), '{}') AS "purposeKeys",
           COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0)::text AS "signedBalance"
    FROM accounts a
    JOIN journal_lines l ON l.account_id = a.id
    JOIN journal_entries e ON e.id = l.journal_entry_id
    LEFT JOIN accounts parent ON parent.id = a.parent_id
    LEFT JOIN account_purposes p ON p.account_id = a.id AND p.active_to IS NULL
    WHERE a.is_postable
      AND e.entry_date <= ${input.asOfDate}
      AND (${input.asOf}::timestamptz IS NULL OR e.posted_at <= ${input.asOf}::timestamptz)
    GROUP BY a.id, a.code, a.name, a.name_ar, a.type, parent.code
    HAVING COUNT(l.id) > 0
    ORDER BY a.code
  `);
  return rows.rows as unknown as {
    accountId: string;
    code: string;
    name: string;
    nameAr: string;
    type: string;
    parentCode: string | null;
    purposeKeys: string[];
    signedBalance: string;
  }[];
}

/** Accounts currently mapped to any of the given purposes (cash scope …). */
export async function accountsForPurposes(
  purposeKeys: readonly string[],
): Promise<{ accountId: string; code: string; purposeKey: string }[]> {
  if (purposeKeys.length === 0) {
    return [];
  }
  const rows = await tenantTx().execute(sql`
    SELECT p.account_id AS "accountId", a.code, p.purpose_key AS "purposeKey"
    FROM account_purposes p JOIN accounts a ON a.id = p.account_id
    WHERE p.active_to IS NULL
      AND p.purpose_key IN (${sql.join(
        purposeKeys.map((key) => sql`${key}`),
        sql`, `,
      )})
    ORDER BY a.code
  `);
  return rows.rows as unknown as { accountId: string; code: string; purposeKey: string }[];
}

export interface LedgerLineRow {
  entryId: string;
  entryNo: string;
  entryDate: string;
  sourceType: string;
  sourceId: string | null;
  description: string | null;
  descriptionAr: string | null;
  lineNo: number;
  direction: "DEBIT" | "CREDIT";
  accountId: string;
  accountCode: string;
  accountName: string;
  amount: string;
  baseAmount: string;
  currencyCode: string;
  exchangeRate: string;
  partnerId: string | null;
  memo: string | null;
  memoAr: string | null;
}

/** The GL line feed for one account over a window (GL report rows). */
export async function accountLedgerLines(input: {
  accountId: string;
  fromDate: string;
  toDate: string;
  asOf: string | null;
  limit?: number;
}): Promise<LedgerLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT e.id AS "entryId", e.entry_no AS "entryNo", e.entry_date AS "entryDate",
           e.source_type AS "sourceType", e.source_id AS "sourceId",
           e.description, e.description_ar AS "descriptionAr",
           l.line_no AS "lineNo", l.direction, l.account_id AS "accountId",
           a.code AS "accountCode", a.name AS "accountName",
           l.amount::text AS "amount", l.base_amount::text AS "baseAmount",
           e.currency_code AS "currencyCode", e.exchange_rate::text AS "exchangeRate",
           l.partner_id AS "partnerId", l.memo, l.memo_ar AS "memoAr"
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE l.account_id = ${input.accountId}
      AND e.entry_date >= ${input.fromDate} AND e.entry_date <= ${input.toDate}
      AND (${input.asOf}::timestamptz IS NULL OR e.posted_at <= ${input.asOf}::timestamptz)
    ORDER BY e.entry_date, e.entry_no, l.line_no
    LIMIT ${input.limit ?? 5000}
  `);
  return rows.rows as unknown as LedgerLineRow[];
}

/** Entries in a window whose base legs do not balance (gl-entry-balance). */
export async function unbalancedEntries(input: {
  fromDate: string;
  toDate: string;
  asOf: string | null;
}): Promise<{ entryId: string; entryNo: string; net: string }[]> {
  const rows = await tenantTx().execute(sql`
    SELECT e.id AS "entryId", e.entry_no AS "entryNo",
           SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END)::text AS net
    FROM journal_entries e JOIN journal_lines l ON l.journal_entry_id = e.id
    WHERE e.entry_date >= ${input.fromDate} AND e.entry_date <= ${input.toDate}
      AND (${input.asOf}::timestamptz IS NULL OR e.posted_at <= ${input.asOf}::timestamptz)
    GROUP BY e.id, e.entry_no
    HAVING SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END) <> 0
  `);
  return rows.rows as unknown as { entryId: string; entryNo: string; net: string }[];
}

/** Cost-center breakdown (accounting.cost-centers report feed). */
export async function costCenterBreakdown(input: {
  fromDate: string;
  toDate: string;
}): Promise<
  {
    costCenterId: string | null;
    costCenterCode: string | null;
    costCenterName: string | null;
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT l.cost_center_id AS "costCenterId", cc.code AS "costCenterCode", cc.name AS "costCenterName",
           a.code AS "accountCode", a.name AS "accountName",
           COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE 0 END), 0)::text AS debit,
           COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.base_amount ELSE 0 END), 0)::text AS credit
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id
    LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id
    WHERE e.entry_date >= ${input.fromDate} AND e.entry_date <= ${input.toDate}
    GROUP BY l.cost_center_id, cc.code, cc.name, a.code, a.name
    ORDER BY cc.code NULLS LAST, a.code
  `);
  return rows.rows as unknown as {
    costCenterId: string | null;
    costCenterCode: string | null;
    costCenterName: string | null;
    accountCode: string;
    accountName: string;
    debit: string;
    credit: string;
  }[];
}

/** Lines on FX gain/loss accounts (treasury.fx-differences feed). */
export async function fxDifferenceLines(input: {
  fromDate: string;
  toDate: string;
}): Promise<
  {
    entryId: string;
    entryNo: string;
    entryDate: string;
    accountCode: string;
    direction: "DEBIT" | "CREDIT";
    baseAmount: string;
    currencyCode: string;
    description: string | null;
  }[]
> {
  const fxAccounts = await accountsForPurposes(["FX_GAIN", "FX_LOSS"]);
  if (fxAccounts.length === 0) {
    return [];
  }
  const ids = fxAccounts.map((row) => row.accountId);
  const rows = await tenantTx().execute(sql`
    SELECT e.id AS "entryId", e.entry_no AS "entryNo", e.entry_date AS "entryDate",
           a.code AS "accountCode", l.direction, l.base_amount::text AS "baseAmount",
           e.currency_code AS "currencyCode", e.description
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    JOIN accounts a ON a.id = l.account_id
    WHERE l.account_id IN (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})
      AND e.entry_date >= ${input.fromDate} AND e.entry_date <= ${input.toDate}
    ORDER BY e.entry_date, e.entry_no
  `);
  return rows.rows as unknown as {
    entryId: string;
    entryNo: string;
    entryDate: string;
    accountCode: string;
    direction: "DEBIT" | "CREDIT";
    baseAmount: string;
    currencyCode: string;
    description: string | null;
  }[];
}
