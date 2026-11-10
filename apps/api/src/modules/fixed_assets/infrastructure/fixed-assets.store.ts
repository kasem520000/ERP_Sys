import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Fixed-assets store (PHASE-026): the ONLY writer of the six module tables
 * (asset_categories, assets, depreciation_runs, depreciation_lines 🔒,
 * asset_disposals, asset_revaluations). Every statement runs in the caller's
 * ambient tenant UoW so a failure anywhere rolls the whole business
 * operation back (INV-018 discipline). journal_entries/journal_lines are
 * NEVER written here (ADR-0007 — the posting engine exclusively owns them);
 * depreciation_lines is append-only (SELECT/INSERT grants + the
 * erp.depreciation_lines_guard trigger — this store exposes insert/list only,
 * with the single DRAFT-assembly reset exception below).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("fixed_assets access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- asset categories (T2) ---------------------------------------------------------

export interface AssetCategoryRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  usefulLifeMonthsDefault: number;
  depreciationMethodDefault: string;
  assetPurposeKey: string;
  accumDepreciationPurposeKey: string;
  expensePurposeKey: string;
  active: boolean;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const CATEGORY_SELECT = sql`
  SELECT id, code, name, name_ar AS "nameAr",
    useful_life_months_default AS "usefulLifeMonthsDefault",
    depreciation_method_default AS "depreciationMethodDefault",
    asset_purpose_key AS "assetPurposeKey",
    accum_depreciation_purpose_key AS "accumDepreciationPurposeKey",
    expense_purpose_key AS "expensePurposeKey", active, note, note_ar AS "noteAr",
    created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM asset_categories`;

export async function insertAssetCategory(input: {
  code: string;
  name: string;
  nameAr: string;
  usefulLifeMonthsDefault: number;
  depreciationMethodDefault: string;
  assetPurposeKey: string;
  accumDepreciationPurposeKey: string;
  expensePurposeKey: string;
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}): Promise<AssetCategoryRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO asset_categories (id, tenant_id, created_by, code, name, name_ar,
      useful_life_months_default, depreciation_method_default, asset_purpose_key,
      accum_depreciation_purpose_key, expense_purpose_key, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.code},
      ${input.name}, ${input.nameAr}, ${input.usefulLifeMonthsDefault},
      ${input.depreciationMethodDefault}, ${input.assetPurposeKey},
      ${input.accumDepreciationPurposeKey}, ${input.expensePurposeKey},
      ${input.note ?? null}, ${input.noteAr ?? null})
    RETURNING id, code, name, name_ar AS "nameAr",
      useful_life_months_default AS "usefulLifeMonthsDefault",
      depreciation_method_default AS "depreciationMethodDefault",
      asset_purpose_key AS "assetPurposeKey",
      accum_depreciation_purpose_key AS "accumDepreciationPurposeKey",
      expense_purpose_key AS "expensePurposeKey", active, note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as AssetCategoryRow[])[0]!;
}

export async function findAssetCategoryById(id: string): Promise<AssetCategoryRow | undefined> {
  const rows = await tenantTx().execute(sql`${CATEGORY_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as AssetCategoryRow[])[0];
}

export async function findAssetCategoryByCode(code: string): Promise<AssetCategoryRow | undefined> {
  const rows = await tenantTx().execute(sql`${CATEGORY_SELECT} WHERE code = ${code} LIMIT 1`);
  return (rows.rows as unknown as AssetCategoryRow[])[0];
}

export async function listAssetCategories(filter: {
  activeOnly?: boolean;
}): Promise<AssetCategoryRow[]> {
  const rows = await tenantTx().execute(sql`
    ${CATEGORY_SELECT}
    WHERE ${filter.activeOnly === true ? sql`active = true` : sql`TRUE`}
    ORDER BY code
  `);
  return rows.rows as unknown as AssetCategoryRow[];
}

export async function updateAssetCategory(
  id: string,
  patch: {
    name?: string;
    nameAr?: string;
    usefulLifeMonthsDefault?: number;
    depreciationMethodDefault?: string;
    assetPurposeKey?: string;
    accumDepreciationPurposeKey?: string;
    expensePurposeKey?: string;
    active?: boolean;
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<AssetCategoryRow | undefined> {
  const current = await findAssetCategoryById(id);
  if (current === undefined) return undefined;
  const next = {
    name: patch.name ?? current.name,
    nameAr: patch.nameAr ?? current.nameAr,
    usefulLifeMonthsDefault: patch.usefulLifeMonthsDefault ?? current.usefulLifeMonthsDefault,
    depreciationMethodDefault: patch.depreciationMethodDefault ?? current.depreciationMethodDefault,
    assetPurposeKey: patch.assetPurposeKey ?? current.assetPurposeKey,
    accumDepreciationPurposeKey:
      patch.accumDepreciationPurposeKey ?? current.accumDepreciationPurposeKey,
    expensePurposeKey: patch.expensePurposeKey ?? current.expensePurposeKey,
    active: patch.active ?? current.active,
    note: patch.note !== undefined ? patch.note : current.note,
    noteAr: patch.noteAr !== undefined ? patch.noteAr : current.noteAr,
  };
  const rows = await tenantTx().execute(sql`
    UPDATE asset_categories SET name = ${next.name}, name_ar = ${next.nameAr},
      useful_life_months_default = ${next.usefulLifeMonthsDefault},
      depreciation_method_default = ${next.depreciationMethodDefault},
      asset_purpose_key = ${next.assetPurposeKey},
      accum_depreciation_purpose_key = ${next.accumDepreciationPurposeKey},
      expense_purpose_key = ${next.expensePurposeKey}, active = ${next.active},
      note = ${next.note}, note_ar = ${next.noteAr},
      updated_at = now(), version = version + 1
    WHERE id = ${id}
    RETURNING id, code, name, name_ar AS "nameAr",
      useful_life_months_default AS "usefulLifeMonthsDefault",
      depreciation_method_default AS "depreciationMethodDefault",
      asset_purpose_key AS "assetPurposeKey",
      accum_depreciation_purpose_key AS "accumDepreciationPurposeKey",
      expense_purpose_key AS "expensePurposeKey", active, note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as AssetCategoryRow[])[0];
}

/** In-use guard (INV-015): asset count referencing the category. */
export async function countAssetsByCategory(categoryId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM assets WHERE category_id = ${categoryId}
  `);
  return (rows.rows as unknown as { n: number }[])[0]?.n ?? 0;
}

// -- assets (T3) --------------------------------------------------------------------

export interface AssetRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  categoryId: string;
  acquisitionDate: string;
  cost: string;
  salvageValue: string;
  openingAccumulated: string;
  usefulLifeMonths: number;
  depreciationMethod: string;
  totalEstimatedUnits: string | null;
  branchId: string;
  custodianUserId: string | null;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
  note: string | null;
  noteAr: string | null;
  disposedAt: string | null;
  writtenOffAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const ASSET_SELECT = sql`
  SELECT id, code, name, name_ar AS "nameAr", category_id AS "categoryId",
    acquisition_date AS "acquisitionDate", cost, salvage_value AS "salvageValue",
    opening_accumulated AS "openingAccumulated", useful_life_months AS "usefulLifeMonths",
    depreciation_method AS "depreciationMethod",
    total_estimated_units AS "totalEstimatedUnits", branch_id AS "branchId",
    custodian_user_id AS "custodianUserId", status, source_type AS "sourceType",
    source_id AS "sourceId", note, note_ar AS "noteAr", disposed_at AS "disposedAt",
    written_off_at AS "writtenOffAt", created_by AS "createdBy",
    created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM assets`;

export async function insertAsset(input: {
  code: string;
  name: string;
  nameAr: string;
  categoryId: string;
  acquisitionDate: string;
  cost: string;
  salvageValue: string;
  openingAccumulated: string;
  usefulLifeMonths: number;
  depreciationMethod: string;
  totalEstimatedUnits: string | null;
  branchId: string;
  custodianUserId: string | null;
  status?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}): Promise<AssetRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO assets (id, tenant_id, created_by, code, name, name_ar, category_id,
      acquisition_date, cost, salvage_value, opening_accumulated, useful_life_months,
      depreciation_method, total_estimated_units, branch_id, custodian_user_id, status,
      source_type, source_id, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.code},
      ${input.name}, ${input.nameAr}, ${input.categoryId}, ${input.acquisitionDate},
      ${input.cost}, ${input.salvageValue}, ${input.openingAccumulated},
      ${input.usefulLifeMonths}, ${input.depreciationMethod}, ${input.totalEstimatedUnits},
      ${input.branchId}, ${input.custodianUserId}, ${input.status ?? "ACTIVE"},
      ${input.sourceType ?? null}, ${input.sourceId ?? null},
      ${input.note ?? null}, ${input.noteAr ?? null})
    RETURNING ${sql.raw("id, code, name, name_ar AS \"nameAr\", category_id AS \"categoryId\", acquisition_date AS \"acquisitionDate\", cost, salvage_value AS \"salvageValue\", opening_accumulated AS \"openingAccumulated\", useful_life_months AS \"usefulLifeMonths\", depreciation_method AS \"depreciationMethod\", total_estimated_units AS \"totalEstimatedUnits\", branch_id AS \"branchId\", custodian_user_id AS \"custodianUserId\", status, source_type AS \"sourceType\", source_id AS \"sourceId\", note, note_ar AS \"noteAr\", disposed_at AS \"disposedAt\", written_off_at AS \"writtenOffAt\", created_by AS \"createdBy\", created_at AS \"createdAt\", updated_at AS \"updatedAt\", version")}
  `);
  return (rows.rows as unknown as AssetRow[])[0]!;
}

export async function findAssetById(id: string): Promise<AssetRow | undefined> {
  const rows = await tenantTx().execute(sql`${ASSET_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as AssetRow[])[0];
}

export async function findAssetByCode(code: string): Promise<AssetRow | undefined> {
  const rows = await tenantTx().execute(sql`${ASSET_SELECT} WHERE code = ${code} LIMIT 1`);
  return (rows.rows as unknown as AssetRow[])[0];
}

export interface AssetListFilter {
  search?: string;
  categoryId?: string;
  branchId?: string;
  status?: string;
  custodianUserId?: string;
  limit?: number;
  offset?: number;
}

export async function listAssets(filter: AssetListFilter): Promise<AssetRow[]> {
  const clauses = [sql`TRUE`];
  if (filter.search !== undefined && filter.search !== "") {
    const like = `%${filter.search}%`;
    clauses.push(sql`(code ILIKE ${like} OR name ILIKE ${like} OR name_ar ILIKE ${like})`);
  }
  if (filter.categoryId !== undefined) clauses.push(sql`category_id = ${filter.categoryId}`);
  if (filter.branchId !== undefined) clauses.push(sql`branch_id = ${filter.branchId}`);
  if (filter.status !== undefined) clauses.push(sql`status = ${filter.status}`);
  if (filter.custodianUserId !== undefined)
    clauses.push(sql`custodian_user_id = ${filter.custodianUserId}`);
  const where = sql.join(clauses, sql` AND `);
  const rows = await tenantTx().execute(sql`
    ${ASSET_SELECT} WHERE ${where}
    ORDER BY code LIMIT ${filter.limit ?? 50} OFFSET ${filter.offset ?? 0}
  `);
  return rows.rows as unknown as AssetRow[];
}

export async function updateAsset(
  id: string,
  patch: {
    name?: string;
    nameAr?: string;
    custodianUserId?: string | null;
    branchId?: string;
    status?: string;
    note?: string | null;
    noteAr?: string | null;
    disposedAt?: string | null;
    writtenOffAt?: string | null;
    sourceType?: string | null;
    sourceId?: string | null;
  },
): Promise<AssetRow | undefined> {
  const sets = [sql`updated_at = now(), version = version + 1`];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.nameAr !== undefined) sets.push(sql`name_ar = ${patch.nameAr}`);
  if (patch.custodianUserId !== undefined)
    sets.push(sql`custodian_user_id = ${patch.custodianUserId}`);
  if (patch.branchId !== undefined) sets.push(sql`branch_id = ${patch.branchId}`);
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.note !== undefined) sets.push(sql`note = ${patch.note}`);
  if (patch.noteAr !== undefined) sets.push(sql`note_ar = ${patch.noteAr}`);
  if (patch.disposedAt !== undefined) sets.push(sql`disposed_at = ${patch.disposedAt}`);
  if (patch.writtenOffAt !== undefined) sets.push(sql`written_off_at = ${patch.writtenOffAt}`);
  if (patch.sourceType !== undefined) sets.push(sql`source_type = ${patch.sourceType}`);
  if (patch.sourceId !== undefined) sets.push(sql`source_id = ${patch.sourceId}`);
  const rows = await tenantTx().execute(sql`
    UPDATE assets SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
    RETURNING ${sql.raw("id, code, name, name_ar AS \"nameAr\", category_id AS \"categoryId\", acquisition_date AS \"acquisitionDate\", cost, salvage_value AS \"salvageValue\", opening_accumulated AS \"openingAccumulated\", useful_life_months AS \"usefulLifeMonths\", depreciation_method AS \"depreciationMethod\", total_estimated_units AS \"totalEstimatedUnits\", branch_id AS \"branchId\", custodian_user_id AS \"custodianUserId\", status, source_type AS \"sourceType\", source_id AS \"sourceId\", note, note_ar AS \"noteAr\", disposed_at AS \"disposedAt\", written_off_at AS \"writtenOffAt\", created_by AS \"createdBy\", created_at AS \"createdAt\", updated_at AS \"updatedAt\", version")}
  `);
  return (rows.rows as unknown as AssetRow[])[0];
}

/**
 * NBV read model (INV-023 substrate): accumulated depreciation =
 * opening_accumulated + Σ period_amount of lines belonging to runs that are
 * POSTED and NOT reversed (the reversal counter-entry nets the GL; the lines
 * stay for audit but drop out of the live accumulated).
 */
export async function assetAccumulated(assetId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT (COALESCE(a.opening_accumulated, 0) + COALESCE((
      SELECT SUM(dl.period_amount) FROM depreciation_lines dl
      JOIN depreciation_runs r ON r.id = dl.run_id
      WHERE dl.asset_id = ${assetId} AND r.status = 'POSTED' AND r.reversed_at IS NULL
    ), 0))::text AS accum
    FROM assets a WHERE a.id = ${assetId}
  `);
  return (rows.rows as unknown as { accum: string }[])[0]?.accum ?? "0";
}

/** NBV = cost − accumulated (never below salvage — INV-023 enforced by writers). */
export async function assetNbv(assetId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT (a.cost - COALESCE(a.opening_accumulated, 0) - COALESCE((
      SELECT SUM(dl.period_amount) FROM depreciation_lines dl
      JOIN depreciation_runs r ON r.id = dl.run_id
      WHERE dl.asset_id = ${assetId} AND r.status = 'POSTED' AND r.reversed_at IS NULL
    ), 0))::text AS nbv
    FROM assets a WHERE a.id = ${assetId}
  `);
  return (rows.rows as unknown as { nbv: string }[])[0]?.nbv ?? "0";
}

/** Depreciable base = cost − salvage (the INV-023 ceiling). */
export function depreciableBase(asset: AssetRow): string {
  const base = Number(asset.cost) - Number(asset.salvageValue);
  return base.toFixed(4);
}

// -- depreciation runs (T6/T7) ------------------------------------------------------

export interface DepreciationRunRow {
  id: string;
  fiscalPeriodId: string;
  status: string;
  assetCount: number;
  totalAmount: string;
  assemblyJobId: string | null;
  assembledAt: string | null;
  assembledBy: string | null;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryId: string | null;
  reversalJournalEntryId: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const RUN_SELECT = sql`
  SELECT id, fiscal_period_id AS "fiscalPeriodId", status,
    asset_count AS "assetCount", total_amount AS "totalAmount",
    assembly_job_id AS "assemblyJobId", assembled_at AS "assembledAt",
    assembled_by AS "assembledBy", posted_at AS "postedAt", posted_by AS "postedBy",
    journal_entry_id AS "journalEntryId",
    reversal_journal_entry_id AS "reversalJournalEntryId", reversed_at AS "reversedAt",
    reversal_reason AS "reversalReason", note, note_ar AS "noteAr",
    created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM depreciation_runs`;

export async function insertDepreciationRun(input: {
  fiscalPeriodId: string;
  createdBy: string | null;
  note?: string | null;
  noteAr?: string | null;
}): Promise<DepreciationRunRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO depreciation_runs (id, tenant_id, created_by, fiscal_period_id, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy},
      ${input.fiscalPeriodId}, ${input.note ?? null}, ${input.noteAr ?? null})
    RETURNING id, fiscal_period_id AS "fiscalPeriodId", status,
      asset_count AS "assetCount", total_amount AS "totalAmount",
      assembly_job_id AS "assemblyJobId", assembled_at AS "assembledAt",
      assembled_by AS "assembledBy", posted_at AS "postedAt", posted_by AS "postedBy",
      journal_entry_id AS "journalEntryId",
      reversal_journal_entry_id AS "reversalJournalEntryId", reversed_at AS "reversedAt",
      reversal_reason AS "reversalReason", note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as DepreciationRunRow[])[0]!;
}

export async function findDepreciationRunById(id: string): Promise<DepreciationRunRow | undefined> {
  const rows = await tenantTx().execute(sql`${RUN_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as DepreciationRunRow[])[0];
}

export async function findDepreciationRunByPeriod(
  fiscalPeriodId: string,
): Promise<DepreciationRunRow | undefined> {
  const rows = await tenantTx().execute(
    sql`${RUN_SELECT} WHERE fiscal_period_id = ${fiscalPeriodId} LIMIT 1`,
  );
  return (rows.rows as unknown as DepreciationRunRow[])[0];
}

export async function listDepreciationRuns(filter: {
  status?: string;
  limit?: number;
}): Promise<DepreciationRunRow[]> {
  const where = filter.status !== undefined ? sql`status = ${filter.status}` : sql`TRUE`;
  const rows = await tenantTx().execute(sql`
    ${RUN_SELECT} WHERE ${where} ORDER BY created_at DESC LIMIT ${filter.limit ?? 50}
  `);
  return rows.rows as unknown as DepreciationRunRow[];
}

export async function updateDepreciationRun(
  id: string,
  patch: {
    status?: string;
    assetCount?: number;
    totalAmount?: string;
    assemblyJobId?: string | null;
    assembledAt?: string | null;
    assembledBy?: string | null;
    postedAt?: string | null;
    postedBy?: string | null;
    journalEntryId?: string | null;
    reversalJournalEntryId?: string | null;
    reversedAt?: string | null;
    reversalReason?: string | null;
  },
): Promise<DepreciationRunRow | undefined> {
  const sets = [sql`updated_at = now(), version = version + 1`];
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.assetCount !== undefined) sets.push(sql`asset_count = ${patch.assetCount}`);
  if (patch.totalAmount !== undefined) sets.push(sql`total_amount = ${patch.totalAmount}`);
  if (patch.assemblyJobId !== undefined) sets.push(sql`assembly_job_id = ${patch.assemblyJobId}`);
  if (patch.assembledAt !== undefined) sets.push(sql`assembled_at = ${patch.assembledAt}`);
  if (patch.assembledBy !== undefined) sets.push(sql`assembled_by = ${patch.assembledBy}`);
  if (patch.postedAt !== undefined) sets.push(sql`posted_at = ${patch.postedAt}`);
  if (patch.postedBy !== undefined) sets.push(sql`posted_by = ${patch.postedBy}`);
  if (patch.journalEntryId !== undefined) sets.push(sql`journal_entry_id = ${patch.journalEntryId}`);
  if (patch.reversalJournalEntryId !== undefined)
    sets.push(sql`reversal_journal_entry_id = ${patch.reversalJournalEntryId}`);
  if (patch.reversedAt !== undefined) sets.push(sql`reversed_at = ${patch.reversedAt}`);
  if (patch.reversalReason !== undefined)
    sets.push(sql`reversal_reason = ${patch.reversalReason}`);
  const rows = await tenantTx().execute(sql`
    UPDATE depreciation_runs SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
    RETURNING id, fiscal_period_id AS "fiscalPeriodId", status,
      asset_count AS "assetCount", total_amount AS "totalAmount",
      assembly_job_id AS "assemblyJobId", assembled_at AS "assembledAt",
      assembled_by AS "assembledBy", posted_at AS "postedAt", posted_by AS "postedBy",
      journal_entry_id AS "journalEntryId",
      reversal_journal_entry_id AS "reversalJournalEntryId", reversed_at AS "reversedAt",
      reversal_reason AS "reversalReason", note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as DepreciationRunRow[])[0];
}

// -- depreciation lines 🔒 (T6 — append-only: insert + list ONLY) -------------------

export interface DepreciationLineRow {
  id: string;
  runId: string;
  assetId: string;
  lineNo: number;
  periodUnits: string | null;
  periodAmount: string;
  accumulatedAmount: string;
  createdBy: string | null;
  createdAt: string;
}

export const LINE_SELECT = sql`
  SELECT id, run_id AS "runId", asset_id AS "assetId", line_no AS "lineNo",
    period_units AS "periodUnits", period_amount AS "periodAmount",
    accumulated_amount AS "accumulatedAmount", created_by AS "createdBy",
    created_at AS "createdAt"
  FROM depreciation_lines`;

export async function insertDepreciationLines(
  lines: Array<{
    runId: string;
    assetId: string;
    lineNo: number;
    periodUnits: string | null;
    periodAmount: string;
    accumulatedAmount: string;
    createdBy: string | null;
  }>,
): Promise<DepreciationLineRow[]> {
  if (lines.length === 0) return [];
  const tenantId = requireTenantContext().tenantId;
  const values = lines.map(
    (l) => sql`(${generateUuidV7()}, ${tenantId}, ${l.createdBy}, ${l.runId}, ${l.assetId},
      ${l.lineNo}, ${l.periodUnits}, ${l.periodAmount}, ${l.accumulatedAmount})`,
  );
  const rows = await tenantTx().execute(sql`
    INSERT INTO depreciation_lines (id, tenant_id, created_by, run_id, asset_id, line_no,
      period_units, period_amount, accumulated_amount)
    VALUES ${sql.join(values, sql`, `)}
    RETURNING id, run_id AS "runId", asset_id AS "assetId", line_no AS "lineNo",
      period_units AS "periodUnits", period_amount AS "periodAmount",
      accumulated_amount AS "accumulatedAmount", created_by AS "createdBy",
      created_at AS "createdAt"
  `);
  return rows.rows as unknown as DepreciationLineRow[];
}

export async function listDepreciationLinesByRun(
  runId: string,
): Promise<DepreciationLineRow[]> {
  const rows = await tenantTx().execute(sql`
    ${LINE_SELECT} WHERE run_id = ${runId} ORDER BY line_no
  `);
  return rows.rows as unknown as DepreciationLineRow[];
}

export async function listDepreciationLinesByAsset(
  assetId: string,
): Promise<Array<DepreciationLineRow & { runStatus: string; reversedAt: string | null }>> {
  const rows = await tenantTx().execute(sql`
    SELECT dl.id, dl.run_id AS "runId", dl.asset_id AS "assetId", dl.line_no AS "lineNo",
      dl.period_units AS "periodUnits", dl.period_amount AS "periodAmount",
      dl.accumulated_amount AS "accumulatedAmount", dl.created_by AS "createdBy",
      dl.created_at AS "createdAt", r.status AS "runStatus", r.reversed_at AS "reversedAt"
    FROM depreciation_lines dl JOIN depreciation_runs r ON r.id = dl.run_id
    WHERE dl.asset_id = ${assetId} ORDER BY dl.created_at, dl.line_no
  `);
  return rows.rows as unknown as Array<DepreciationLineRow & {
    runStatus: string;
    reversedAt: string | null;
  }>;
}

/**
 * Reset a DRAFT run's assembly lines (re-assembly). Append-only discipline:
 * the erp.depreciation_lines_guard trigger owns the policy — DELETE passes
 * ONLY for lines of a run still in DRAFT (unpublished assembly, not history
 * yet); posted-run lines are immutable (the trigger raises INV-003
 * regardless of grants, and the service never calls this for a non-DRAFT
 * run — double enforcement).
 */
export async function resetDraftRunLines(runId: string): Promise<number> {
  const del = await tenantTx().execute(sql`
    DELETE FROM depreciation_lines dl
    WHERE dl.run_id = ${runId}
      AND EXISTS (SELECT 1 FROM depreciation_runs r
                  WHERE r.id = dl.run_id AND r.status = 'DRAFT')
  `);
  return del.rowCount ?? 0;
}

// -- asset disposals (T9) -------------------------------------------------------------

export interface AssetDisposalRow {
  id: string;
  assetId: string;
  disposalNo: string | null;
  kind: string;
  disposalDate: string;
  proceeds: string;
  netBookValue: string;
  accumulatedSnapshot: string;
  gainLoss: string;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const DISPOSAL_SELECT = sql`
  SELECT id, asset_id AS "assetId", disposal_no AS "disposalNo", kind,
    disposal_date AS "disposalDate", proceeds, net_book_value AS "netBookValue",
    accumulated_snapshot AS "accumulatedSnapshot", gain_loss AS "gainLoss", status,
    approved_by AS "approvedBy", approved_at AS "approvedAt", posted_at AS "postedAt",
    posted_by AS "postedBy", journal_entry_id AS "journalEntryId", note,
    note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt",
    updated_at AS "updatedAt", version
  FROM asset_disposals`;

export async function insertAssetDisposal(input: {
  assetId: string;
  kind: string;
  disposalDate: string;
  proceeds: string;
  netBookValue: string;
  accumulatedSnapshot: string;
  gainLoss: string;
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}): Promise<AssetDisposalRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO asset_disposals (id, tenant_id, created_by, asset_id, kind, disposal_date,
      proceeds, net_book_value, accumulated_snapshot, gain_loss, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.assetId},
      ${input.kind}, ${input.disposalDate}, ${input.proceeds}, ${input.netBookValue},
      ${input.accumulatedSnapshot}, ${input.gainLoss}, ${input.note ?? null}, ${input.noteAr ?? null})
    RETURNING id, asset_id AS "assetId", disposal_no AS "disposalNo", kind,
      disposal_date AS "disposalDate", proceeds, net_book_value AS "netBookValue",
      accumulated_snapshot AS "accumulatedSnapshot", gain_loss AS "gainLoss", status,
      approved_by AS "approvedBy", approved_at AS "approvedAt", posted_at AS "postedAt",
      posted_by AS "postedBy", journal_entry_id AS "journalEntryId", note,
      note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt",
      updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as AssetDisposalRow[])[0]!;
}

export async function findAssetDisposalById(id: string): Promise<AssetDisposalRow | undefined> {
  const rows = await tenantTx().execute(sql`${DISPOSAL_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as AssetDisposalRow[])[0];
}

export async function findAssetDisposalByAsset(
  assetId: string,
): Promise<AssetDisposalRow | undefined> {
  const rows = await tenantTx().execute(
    sql`${DISPOSAL_SELECT} WHERE asset_id = ${assetId} ORDER BY created_at DESC LIMIT 1`,
  );
  return (rows.rows as unknown as AssetDisposalRow[])[0];
}

export async function updateAssetDisposal(
  id: string,
  patch: {
    disposalNo?: string | null;
    status?: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    postedAt?: string | null;
    postedBy?: string | null;
    journalEntryId?: string | null;
  },
): Promise<AssetDisposalRow | undefined> {
  const sets = [sql`updated_at = now(), version = version + 1`];
  if (patch.disposalNo !== undefined) sets.push(sql`disposal_no = ${patch.disposalNo}`);
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.approvedBy !== undefined) sets.push(sql`approved_by = ${patch.approvedBy}`);
  if (patch.approvedAt !== undefined) sets.push(sql`approved_at = ${patch.approvedAt}`);
  if (patch.postedAt !== undefined) sets.push(sql`posted_at = ${patch.postedAt}`);
  if (patch.postedBy !== undefined) sets.push(sql`posted_by = ${patch.postedBy}`);
  if (patch.journalEntryId !== undefined)
    sets.push(sql`journal_entry_id = ${patch.journalEntryId}`);
  const rows = await tenantTx().execute(sql`
    UPDATE asset_disposals SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
    RETURNING id, asset_id AS "assetId", disposal_no AS "disposalNo", kind,
      disposal_date AS "disposalDate", proceeds, net_book_value AS "netBookValue",
      accumulated_snapshot AS "accumulatedSnapshot", gain_loss AS "gainLoss", status,
      approved_by AS "approvedBy", approved_at AS "approvedAt", posted_at AS "postedAt",
      posted_by AS "postedBy", journal_entry_id AS "journalEntryId", note,
      note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt",
      updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as AssetDisposalRow[])[0];
}

// -- asset revaluations (T8) -----------------------------------------------------------

export interface AssetRevaluationRow {
  id: string;
  assetId: string;
  revaluationDate: string;
  newGrossValue: string;
  newAccumulated: string;
  delta: string;
  status: string;
  reason: string;
  postedAt: string | null;
  postedBy: string | null;
  journalEntryId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export const REVALUATION_SELECT = sql`
  SELECT id, asset_id AS "assetId", revaluation_date AS "revaluationDate",
    new_gross_value AS "newGrossValue", new_accumulated AS "newAccumulated", delta,
    status, reason, posted_at AS "postedAt", posted_by AS "postedBy",
    journal_entry_id AS "journalEntryId", created_by AS "createdBy",
    created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM asset_revaluations`;

export async function insertAssetRevaluation(input: {
  assetId: string;
  revaluationDate: string;
  newGrossValue: string;
  newAccumulated: string;
  delta: string;
  reason: string;
  createdBy: string | null;
}): Promise<AssetRevaluationRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO asset_revaluations (id, tenant_id, created_by, asset_id, revaluation_date,
      new_gross_value, new_accumulated, delta, reason)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.assetId},
      ${input.revaluationDate}, ${input.newGrossValue}, ${input.newAccumulated},
      ${input.delta}, ${input.reason})
    RETURNING id, asset_id AS "assetId", revaluation_date AS "revaluationDate",
      new_gross_value AS "newGrossValue", new_accumulated AS "newAccumulated", delta,
      status, reason, posted_at AS "postedAt", posted_by AS "postedBy",
      journal_entry_id AS "journalEntryId", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as AssetRevaluationRow[])[0]!;
}

export async function findAssetRevaluationById(
  id: string,
): Promise<AssetRevaluationRow | undefined> {
  const rows = await tenantTx().execute(sql`${REVALUATION_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as AssetRevaluationRow[])[0];
}

export async function listAssetRevaluationsByAsset(
  assetId: string,
): Promise<AssetRevaluationRow[]> {
  const rows = await tenantTx().execute(sql`
    ${REVALUATION_SELECT} WHERE asset_id = ${assetId} ORDER BY created_at DESC
  `);
  return rows.rows as unknown as AssetRevaluationRow[];
}

/** The live DRAFT for an asset (one at a time — service-enforced). */
export async function findLiveDraftRevaluation(
  assetId: string,
): Promise<AssetRevaluationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    ${REVALUATION_SELECT} WHERE asset_id = ${assetId} AND status = 'DRAFT'
    ORDER BY created_at DESC LIMIT 1
  `);
  return (rows.rows as unknown as AssetRevaluationRow[])[0];
}

/** The LAST POSTED revaluation — the current revalued basis (DR-002). */
export async function findLastPostedRevaluation(
  assetId: string,
): Promise<AssetRevaluationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    ${REVALUATION_SELECT} WHERE asset_id = ${assetId} AND status = 'POSTED'
    ORDER BY revaluation_date DESC, created_at DESC LIMIT 1
  `);
  return (rows.rows as unknown as AssetRevaluationRow[])[0];
}

export async function updateAssetRevaluation(
  id: string,
  patch: {
    status?: string;
    postedAt?: string | null;
    postedBy?: string | null;
    journalEntryId?: string | null;
  },
): Promise<AssetRevaluationRow | undefined> {
  const sets = [sql`updated_at = now(), version = version + 1`];
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.postedAt !== undefined) sets.push(sql`posted_at = ${patch.postedAt}`);
  if (patch.postedBy !== undefined) sets.push(sql`posted_by = ${patch.postedBy}`);
  if (patch.journalEntryId !== undefined)
    sets.push(sql`journal_entry_id = ${patch.journalEntryId}`);
  const rows = await tenantTx().execute(sql`
    UPDATE asset_revaluations SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
    RETURNING id, asset_id AS "assetId", revaluation_date AS "revaluationDate",
      new_gross_value AS "newGrossValue", new_accumulated AS "newAccumulated", delta,
      status, reason, posted_at AS "postedAt", posted_by AS "postedBy",
      journal_entry_id AS "journalEntryId", created_by AS "createdBy",
      created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as AssetRevaluationRow[])[0];
}
