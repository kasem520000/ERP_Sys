import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Consolidation store (PHASE-034 T2/T3): the ONLY writer of the four
 * consolidation tables (register §C), and the owner-tenant-plane reader for
 * everything the module needs inside its OWN scope (groups, members,
 * eliminations, runs, the parent's elimination journals, the owner's dated
 * exchange rates). Every statement runs in the caller's ambient tenant UoW
 * (the OWNER tenant's plane) so a failure anywhere rolls the whole business
 * operation back. journal_entries/journal_lines are NEVER written here
 * (ADR-0007 — the posting engine exclusively owns them); MEMBER books are
 * never read here either — the cross-tenant member reads go through the
 * audited platform-plane reader function (reader-service.ts), never this
 * store (RISK-016: the reader must be the ONLY cross-tenant path).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("consolidation access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- groups ---------------------------------------------------------------------------

export interface GroupRow {
  id: string;
  name: string;
  nameAr: string;
  baseCurrency: string;
  fxTranslationMethod: "CLOSING_RATE" | "TEMPORARY";
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const GROUP_SELECT = sql`
  SELECT id, name, name_ar AS "nameAr", base_currency AS "baseCurrency",
    fx_translation_method AS "fxTranslationMethod", status, note, note_ar AS "noteAr",
    created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM consolidation_groups`;

export async function insertGroup(input: {
  name: string;
  nameAr: string;
  baseCurrency: string;
  fxTranslationMethod: "CLOSING_RATE" | "TEMPORARY";
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}): Promise<GroupRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO consolidation_groups (id, tenant_id, created_by, name, name_ar,
      base_currency, fx_translation_method, status, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.name},
      ${input.nameAr}, ${input.baseCurrency}, ${input.fxTranslationMethod}, 'ACTIVE',
      ${input.note ?? null}, ${input.noteAr ?? null})
    RETURNING id, name, name_ar AS "nameAr", base_currency AS "baseCurrency",
      fx_translation_method AS "fxTranslationMethod", status, note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version`);
  return (rows.rows as unknown as GroupRow[])[0]!;
}

export async function findGroupById(id: string): Promise<GroupRow | undefined> {
  const rows = await tenantTx().execute(sql`${GROUP_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as GroupRow[])[0];
}

export async function listGroups(): Promise<GroupRow[]> {
  const rows = await tenantTx().execute(
    sql`${GROUP_SELECT} ORDER BY created_at DESC, id DESC`,
  );
  return rows.rows as unknown as GroupRow[];
}

export async function updateGroup(
  id: string,
  patch: {
    name?: string;
    nameAr?: string;
    fxTranslationMethod?: "CLOSING_RATE" | "TEMPORARY";
    status?: string;
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<GroupRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE consolidation_groups SET
      name = COALESCE(${patch.name ?? null}, name),
      name_ar = COALESCE(${patch.nameAr ?? null}, name_ar),
      fx_translation_method = COALESCE(${patch.fxTranslationMethod ?? null}, fx_translation_method),
      status = COALESCE(${patch.status ?? null}, status),
      note = ${patch.note === undefined ? null : patch.note},
      note_ar = ${patch.noteAr === undefined ? null : patch.noteAr},
      updated_at = now(), version = version + 1
    WHERE id = ${id}
    RETURNING id, name, name_ar AS "nameAr", base_currency AS "baseCurrency",
      fx_translation_method AS "fxTranslationMethod", status, note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version`);
  return (rows.rows as unknown as GroupRow[])[0];
}

// -- membership -------------------------------------------------------------------------

export interface GroupMemberRow {
  id: string;
  groupId: string;
  memberTenantId: string;
  ownershipPercent: string;
  includeFrom: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

const MEMBER_SELECT = sql`
  SELECT id, group_id AS "groupId", member_tenant_id AS "memberTenantId",
    ownership_percent::text AS "ownershipPercent", include_from::text AS "includeFrom",
    status, note, note_ar AS "noteAr", created_by AS "createdBy",
    created_at AS "createdAt"
  FROM group_entities`;

export async function insertGroupMember(input: {
  groupId: string;
  memberTenantId: string;
  ownershipPercent: string;
  includeFrom?: string | null;
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}): Promise<GroupMemberRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO group_entities (id, tenant_id, created_by, group_id, member_tenant_id,
      ownership_percent, include_from, status, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.groupId},
      ${input.memberTenantId}, ${input.ownershipPercent}, ${input.includeFrom ?? null},
      'ACTIVE', ${input.note ?? null}, ${input.noteAr ?? null})
    ON CONFLICT (group_id, member_tenant_id) DO UPDATE
      SET status = 'ACTIVE', ownership_percent = EXCLUDED.ownership_percent,
        include_from = EXCLUDED.include_from, note = EXCLUDED.note, note_ar = EXCLUDED.note_ar,
        updated_at = now(), version = group_entities.version + 1
    RETURNING id, group_id AS "groupId", member_tenant_id AS "memberTenantId",
      ownership_percent::text AS "ownershipPercent", include_from::text AS "includeFrom",
      status, note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt"`);
  return (rows.rows as unknown as GroupMemberRow[])[0]!;
}

export async function findGroupMember(
  groupId: string,
  memberTenantId: string,
): Promise<GroupMemberRow | undefined> {
  const rows = await tenantTx().execute(
    sql`${MEMBER_SELECT} WHERE group_id = ${groupId} AND member_tenant_id = ${memberTenantId} LIMIT 1`,
  );
  return (rows.rows as unknown as GroupMemberRow[])[0];
}

export async function listGroupMembers(groupId: string): Promise<GroupMemberRow[]> {
  const rows = await tenantTx().execute(
    sql`${MEMBER_SELECT} WHERE group_id = ${groupId} ORDER BY created_at ASC, id ASC`,
  );
  return rows.rows as unknown as GroupMemberRow[];
}

export async function listActiveGroupMembers(groupId: string): Promise<GroupMemberRow[]> {
  const rows = await tenantTx().execute(
    sql`${MEMBER_SELECT} WHERE group_id = ${groupId} AND status = 'ACTIVE' ORDER BY created_at ASC, id ASC`,
  );
  return rows.rows as unknown as GroupMemberRow[];
}

export async function updateGroupMember(
  id: string,
  patch: {
    ownershipPercent?: string;
    includeFrom?: string | null;
    status?: string;
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<GroupMemberRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE group_entities SET
      ownership_percent = COALESCE(${patch.ownershipPercent ?? null}, ownership_percent),
      include_from = ${patch.includeFrom === undefined ? null : patch.includeFrom},
      status = COALESCE(${patch.status ?? null}, status),
      note = ${patch.note === undefined ? null : patch.note},
      note_ar = ${patch.noteAr === undefined ? null : patch.noteAr},
      updated_at = now(), version = version + 1
    WHERE id = ${id}
    RETURNING id, group_id AS "groupId", member_tenant_id AS "memberTenantId",
      ownership_percent::text AS "ownershipPercent", include_from::text AS "includeFrom",
      status, note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt"`);
  return (rows.rows as unknown as GroupMemberRow[])[0];
}

// -- eliminations -------------------------------------------------------------------------

export interface EliminationRow {
  id: string;
  groupId: string;
  fiscalPeriodId: string;
  eliminationNo: string | null;
  kind: "INTERCOMPANY" | "INVESTMENT_EQUITY";
  description: string;
  memberATenantId: string | null;
  memberBTenantId: string | null;
  lines: unknown;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryIds: unknown;
  reversalOf: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const ELIMINATION_SELECT = sql`
  SELECT id, group_id AS "groupId", fiscal_period_id AS "fiscalPeriodId",
    elimination_no AS "eliminationNo", kind, description,
    member_a_tenant_id AS "memberATenantId", member_b_tenant_id AS "memberBTenantId",
    lines, status, approved_by AS "approvedBy", approved_at AS "approvedAt",
    posted_at AS "postedAt", posted_by AS "postedBy", journal_entry_ids AS "journalEntryIds",
    reversal_of AS "reversalOf", note, note_ar AS "noteAr",
    created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM elimination_entries`;

export async function insertElimination(input: {
  groupId: string;
  fiscalPeriodId: string;
  kind: "INTERCOMPANY" | "INVESTMENT_EQUITY";
  description: string;
  memberATenantId?: string | null;
  memberBTenantId?: string | null;
  lines: unknown;
  reversalOf?: string | null;
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}): Promise<EliminationRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO elimination_entries (id, tenant_id, created_by, group_id, fiscal_period_id,
      kind, description, member_a_tenant_id, member_b_tenant_id, lines, status,
      journal_entry_ids, reversal_of, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.groupId},
      ${input.fiscalPeriodId}, ${input.kind}, ${input.description},
      ${input.memberATenantId ?? null}, ${input.memberBTenantId ?? null},
      ${JSON.stringify(input.lines)}::jsonb, 'DRAFT', '[]'::jsonb,
      ${input.reversalOf ?? null}, ${input.note ?? null}, ${input.noteAr ?? null})
    RETURNING id, group_id AS "groupId", fiscal_period_id AS "fiscalPeriodId",
      elimination_no AS "eliminationNo", kind, description,
      member_a_tenant_id AS "memberATenantId", member_b_tenant_id AS "memberBTenantId",
      lines, status, approved_by AS "approvedBy", approved_at AS "approvedAt",
      posted_at AS "postedAt", posted_by AS "postedBy", journal_entry_ids AS "journalEntryIds",
      reversal_of AS "reversalOf", note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version`);
  return (rows.rows as unknown as EliminationRow[])[0]!;
}

export async function findEliminationById(id: string): Promise<EliminationRow | undefined> {
  const rows = await tenantTx().execute(
    sql`${ELIMINATION_SELECT} WHERE id = ${id} LIMIT 1`,
  );
  return (rows.rows as unknown as EliminationRow[])[0];
}

export interface ListEliminationsFilter {
  groupId?: string;
  fiscalPeriodId?: string;
  status?: string;
}

export async function listEliminations(
  filter: ListEliminationsFilter,
): Promise<EliminationRow[]> {
  const rows = await tenantTx().execute(sql`
    ${ELIMINATION_SELECT}
    WHERE (${filter.groupId ?? null}::uuid IS NULL OR group_id = ${filter.groupId ?? null})
      AND (${filter.fiscalPeriodId ?? null}::uuid IS NULL OR fiscal_period_id = ${filter.fiscalPeriodId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC, id DESC`);
  return rows.rows as unknown as EliminationRow[];
}

export async function updateElimination(
  id: string,
  patch: {
    lines?: unknown;
    description?: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    status?: string;
    eliminationNo?: string | null;
    postedAt?: string | null;
    postedBy?: string | null;
    journalEntryIds?: unknown;
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<EliminationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE elimination_entries SET
      lines = COALESCE(${patch.lines === undefined ? null : JSON.stringify(patch.lines)}::jsonb, lines),
      description = COALESCE(${patch.description ?? null}, description),
      approved_by = ${patch.approvedBy === undefined ? null : patch.approvedBy},
      approved_at = ${patch.approvedAt === undefined ? null : patch.approvedAt},
      status = COALESCE(${patch.status ?? null}, status),
      elimination_no = COALESCE(${patch.eliminationNo ?? null}, elimination_no),
      posted_at = ${patch.postedAt === undefined ? null : patch.postedAt},
      posted_by = ${patch.postedBy === undefined ? null : patch.postedBy},
      journal_entry_ids = COALESCE(${patch.journalEntryIds === undefined ? null : JSON.stringify(patch.journalEntryIds)}::jsonb, journal_entry_ids),
      note = ${patch.note === undefined ? null : patch.note},
      note_ar = ${patch.noteAr === undefined ? null : patch.noteAr},
      updated_at = now(), version = version + 1
    WHERE id = ${id}
    RETURNING id, group_id AS "groupId", fiscal_period_id AS "fiscalPeriodId",
      elimination_no AS "eliminationNo", kind, description,
      member_a_tenant_id AS "memberATenantId", member_b_tenant_id AS "memberBTenantId",
      lines, status, approved_by AS "approvedBy", approved_at AS "approvedAt",
      posted_at AS "postedAt", posted_by AS "postedBy", journal_entry_ids AS "journalEntryIds",
      reversal_of AS "reversalOf", note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version`);
  return (rows.rows as unknown as EliminationRow[])[0];
}

// -- the parent's elimination journal effects (owner scope — never member books) --------

export interface EliminationJournalEffectRow {
  eliminationId: string;
  accountCode: string;
  accountType: string;
  purposeKey: string | null;
  debit: string;
  credit: string;
}

/** The posted elimination journals' LINE EFFECTS in the PARENT's books,
 * aggregated per (elimination, account) — the snapshot's elimination set
 * substrate. Runs entirely inside the owner's own tenant scope (the parent
 * IS this tenant — no cross-tenant read). */
export async function readEliminationEffects(
  eliminationIds: readonly string[],
): Promise<EliminationJournalEffectRow[]> {
  if (eliminationIds.length === 0) {
    return [];
  }
  const idList = sql.join(
    eliminationIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await tenantTx().execute(sql`
    SELECT je.source_id AS "eliminationId", a.code AS "accountCode", a.type AS "accountType",
      ap.purpose_key AS "purposeKey",
      COALESCE(SUM(CASE WHEN jl.direction = 'DEBIT' THEN jl.amount ELSE 0 END), 0)::text AS debit,
      COALESCE(SUM(CASE WHEN jl.direction = 'CREDIT' THEN jl.amount ELSE 0 END), 0)::text AS credit
    FROM journal_entries je
    JOIN journal_lines jl ON jl.journal_entry_id = je.id
    JOIN accounts a ON a.id = jl.account_id
    LEFT JOIN account_purposes ap ON ap.account_id = a.id AND ap.active_to IS NULL
    WHERE je.source_type = 'consolidation_elimination'
      AND je.status = 'POSTED'
      AND je.operation = 'post'
      AND je.source_id IN (${idList})
    GROUP BY je.source_id, a.code, a.type, ap.purpose_key
    ORDER BY a.code`);
  return rows.rows as unknown as EliminationJournalEffectRow[];
}

// -- runs -----------------------------------------------------------------------------------

export interface RunRow {
  id: string;
  groupId: string;
  fiscalPeriodId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  snapshotVersion: number;
  snapshot: unknown;
  jobId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  errorDetail: unknown;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const RUN_SELECT = sql`
  SELECT id, group_id AS "groupId", fiscal_period_id AS "fiscalPeriodId", status,
    snapshot_version AS "snapshotVersion", snapshot, job_id AS "jobId",
    started_at AS "startedAt", completed_at AS "completedAt",
    error_code AS "errorCode", error_detail AS "errorDetail", note,
    created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM consolidation_runs`;

export async function insertRun(input: {
  groupId: string;
  fiscalPeriodId: string;
  createdBy: string | null;
}): Promise<RunRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO consolidation_runs (id, tenant_id, created_by, group_id, fiscal_period_id,
      status, snapshot_version, snapshot)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.groupId},
      ${input.fiscalPeriodId}, 'QUEUED', 1, NULL)
    RETURNING id, group_id AS "groupId", fiscal_period_id AS "fiscalPeriodId", status,
      snapshot_version AS "snapshotVersion", snapshot, job_id AS "jobId",
      started_at AS "startedAt", completed_at AS "completedAt",
      error_code AS "errorCode", error_detail AS "errorDetail", note,
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version`);
  return (rows.rows as unknown as RunRow[])[0]!;
}

export async function findRunById(id: string): Promise<RunRow | undefined> {
  const rows = await tenantTx().execute(sql`${RUN_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as RunRow[])[0];
}

export async function listRuns(filter: {
  groupId?: string;
  status?: string;
}): Promise<RunRow[]> {
  const rows = await tenantTx().execute(sql`
    ${RUN_SELECT}
    WHERE (${filter.groupId ?? null}::uuid IS NULL OR group_id = ${filter.groupId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC, id DESC`);
  return rows.rows as unknown as RunRow[];
}

export async function findLatestCompletedRun(
  groupId: string,
  fiscalPeriodId: string,
): Promise<RunRow | undefined> {
  const rows = await tenantTx().execute(sql`
    ${RUN_SELECT}
    WHERE group_id = ${groupId} AND fiscal_period_id = ${fiscalPeriodId}
      AND status = 'COMPLETED'
    ORDER BY completed_at DESC, id DESC
    LIMIT 1`);
  return (rows.rows as unknown as RunRow[])[0];
}

export async function updateRun(
  id: string,
  patch: {
    status?: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
    jobId?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    snapshot?: unknown;
    snapshotVersion?: number;
    errorCode?: string | null;
    errorDetail?: unknown;
  },
): Promise<RunRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE consolidation_runs SET
      status = COALESCE(${patch.status ?? null}, status),
      job_id = ${patch.jobId === undefined ? null : patch.jobId},
      started_at = ${patch.startedAt === undefined ? null : patch.startedAt},
      completed_at = ${patch.completedAt === undefined ? null : patch.completedAt},
      snapshot = ${patch.snapshot === undefined ? null : JSON.stringify(patch.snapshot)}::jsonb,
      snapshot_version = COALESCE(${patch.snapshotVersion ?? null}, snapshot_version),
      error_code = ${patch.errorCode === undefined ? null : patch.errorCode},
      error_detail = ${patch.errorDetail === undefined ? null : JSON.stringify(patch.errorDetail)}::jsonb,
      updated_at = now(), version = version + 1
    WHERE id = ${id}
    RETURNING id, group_id AS "groupId", fiscal_period_id AS "fiscalPeriodId", status,
      snapshot_version AS "snapshotVersion", snapshot, job_id AS "jobId",
      started_at AS "startedAt", completed_at AS "completedAt",
      error_code AS "errorCode", error_detail AS "errorDetail", note,
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version`);
  return (rows.rows as unknown as RunRow[])[0];
}

// -- the owner's own fiscal period + dated rates (tenant scope — no cross-tenant reads) ---

export interface OwnerPeriodRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

export async function findOwnerPeriod(id: string): Promise<OwnerPeriodRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, name, start_date::text AS "startDate", end_date::text AS "endDate", status
    FROM fiscal_periods WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as OwnerPeriodRow[])[0];
}

export interface StoredRateRow {
  currencyCode: string;
  rateDate: string;
  rate: string;
}

/** The owner's dated stored rates for a currency set, at-or-before a date —
 * the INV-008 translation substrate (latest stored ≤ date, exactly as
 * stored; never interpolated). */
export async function listOwnerRates(
  currencies: readonly string[],
  onOrBefore: string,
): Promise<StoredRateRow[]> {
  if (currencies.length === 0) {
    return [];
  }
  const currencyList = sql.join(
    currencies.map((currency) => sql`${currency}`),
    sql`, `,
  );
  const rows = await tenantTx().execute(sql`
    SELECT DISTINCT ON (currency_code) currency_code AS "currencyCode",
      rate_date::text AS "rateDate", rate::text AS rate
    FROM exchange_rates
    WHERE currency_code IN (${currencyList}) AND rate_date <= ${onOrBefore}
    ORDER BY currency_code, rate_date DESC`);
  return rows.rows as unknown as StoredRateRow[];
}

export async function tenantBaseCurrency(): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT t.base_currency AS "baseCurrency" FROM tenants t
    WHERE t.id = ${requireTenantContext().tenantId}`);
  return (rows.rows as unknown as { baseCurrency: string }[])[0]?.baseCurrency ?? "SAR";
}

// -- the audited platform-plane reader (the ONLY cross-tenant read path) ----------------

export interface MemberGlRow {
  account_code: string;
  account_name: string;
  account_name_ar: string;
  account_type: string;
  purpose_key: string | null;
  currency: string;
  debit_total: string;
  credit_total: string;
  base_debit_total: string;
  base_credit_total: string;
  line_count: string;
}

/** Call the SECURITY DEFINER reader function (the per-query acquisition of
 * the platform-plane grant). Runs through the ambient tenant UoW — the
 * FUNCTION re-validates membership + include_from + the member's closed
 * period (BR-056) before returning one row. */
export async function callReaderMemberGl(
  groupId: string,
  memberTenantId: string,
  memberPeriodId: string,
): Promise<MemberGlRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT * FROM erp.consolidation_read_member_gl(
      ${groupId}::uuid, ${memberTenantId}::uuid, ${memberPeriodId}::uuid)`);
  return rows.rows as unknown as MemberGlRow[];
}

export interface MemberPeriodRow {
  period_id: string;
  period_name: string;
  start_date: string;
  end_date: string;
  status: string;
}

/** Call the reader's period-lookup leg (same SECURITY DEFINER envelope, same
 * membership validation): the MEMBER's fiscal periods intersecting a window
 * — the BR-056 pre-check's substrate (mapping the owner's period onto each
 * member's own calendar). */
export async function callReaderMemberPeriods(
  groupId: string,
  memberTenantId: string,
  windowStart: string,
  windowEnd: string,
): Promise<MemberPeriodRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT * FROM erp.consolidation_member_periods(
      ${groupId}::uuid, ${memberTenantId}::uuid,
      ${windowStart}::date, ${windowEnd}::date)`);
  return rows.rows as unknown as MemberPeriodRow[];
}

export interface MemberArApRow {
  partner_id: string;
  partner_code: string;
  partner_name: string;
  partner_name_ar: string | null;
  ar_balance: string;
  ap_balance: string;
}

/** Call the reader's intercompany suggestion leg: ONE member's per-partner
 * open AR/AP balances as-of (the authoring workspace's pairing surface —
 * human-confirmed; the automatic matching engine is out of scope). */
export async function callReaderMemberArAp(
  groupId: string,
  memberTenantId: string,
  asOf: string,
): Promise<MemberArApRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT * FROM erp.consolidation_read_member_ar_ap(
      ${groupId}::uuid, ${memberTenantId}::uuid, ${asOf}::date)`);
  return rows.rows as unknown as MemberArApRow[];
}
