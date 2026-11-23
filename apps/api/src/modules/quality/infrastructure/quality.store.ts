import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-050 (W-25 — T-05 + T-06, 2026-11-23) THE QUALITY STORE: the ONLY
 * writer of the W-25 plane's tables (quality_specifications ·
 * ncr_records — 0113/0114; the remaining ten quality tables belong to
 * the later waves' stores). Every statement runs in the caller's
 * ambient tenant UoW so a failure anywhere rolls the whole business
 * operation back (INV-018; the disposition act's all-or-nothing law —
 * the G-62 journal, the WMS write-off moves, and the single-use
 * disposition stamp commit together or not at all).
 * journal_entries/journal_lines are NEVER written here (ADR-0007 — the
 * posting engine exclusively owns them); stock_moves are written only
 * through the inventory movement core (planIssue/applyIssue — the REAL
 * WMS path, the G-60 discipline); the inspections module's rows are
 * READ ONLY through its own store (the mapping contract — zero
 * parallel computation).
 *
 * THE MACHINE'S CAS (the 0103/0105 stamp law, the 0114 floor's own
 * shape): every transition is ONE guarded UPDATE — the status pins
 * the from-state, the stamps land in the SAME statement, and zero rows
 * means the raced/stale move. The disposition's CAS additionally pins
 * disposition IS NULL (the single-use stamp, BR-102's floor) and
 * writes the journal link together with the disposition pair (the 0114
 * journal gate satisfied by the same statement that consumes the
 * stamp).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("quality access requires an ambient tenant scope");
  }
  return context.tx;
}

/** Typed query over the ambient tenant transaction (the existing stores'
 * `as unknown as` shape, one helper — the drizzle generic demands an
 * index signature our row interfaces deliberately lack). */
async function query<T>(statement: Parameters<TenantDb["execute"]>[0]): Promise<T[]> {
  const result = await tenantTx().execute(statement);
  return result.rows as unknown as T[];
}

// ── the specification rows (T-05 — the per-item parameter register) ─────────

export interface QualitySpecRow {
  id: string;
  itemId: string;
  parameter: string;
  parameterAr: string | null;
  unit: string | null;
  targetValue: string;
  ucl: string | null;
  lcl: string | null;
  isActive: boolean;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const SPEC_COLUMNS = sql`id, item_id AS "itemId", parameter, parameter_ar AS "parameterAr",
  unit, target_value AS "targetValue", ucl, lcl, is_active AS "isActive",
  note, note_ar AS "noteAr", version, created_at::text AS "createdAt",
  updated_at::text AS "updatedAt"`;

export interface InsertQualitySpecInput {
  itemId: string;
  parameter: string;
  parameterAr: string | null;
  unit: string | null;
  targetValue: string;
  ucl: string | null;
  lcl: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertQualitySpec(input: InsertQualitySpecInput): Promise<QualitySpecRow> {
  const rows = await query<QualitySpecRow>(sql`
    INSERT INTO quality_specifications
      (id, tenant_id, created_by, item_id, parameter, parameter_ar, unit,
       target_value, ucl, lcl, note, note_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.actorId},
            ${input.itemId}, ${input.parameter}, ${input.parameterAr}, ${input.unit},
            ${input.targetValue}, ${input.ucl}, ${input.lcl}, ${input.note}, ${input.noteAr})
    RETURNING ${SPEC_COLUMNS}`);
  return rows[0]!;
}

export async function findQualitySpecById(id: string): Promise<QualitySpecRow | undefined> {
  const rows = await query<QualitySpecRow>(sql`
    SELECT ${SPEC_COLUMNS} FROM quality_specifications WHERE id = ${id}`);
  return rows[0];
}

/** The natural-key read (the duplicate refusal's typed pre-check). */
export async function findQualitySpecByParameter(
  itemId: string,
  parameter: string,
): Promise<QualitySpecRow | undefined> {
  const rows = await query<QualitySpecRow>(sql`
    SELECT ${SPEC_COLUMNS} FROM quality_specifications
    WHERE item_id = ${itemId} AND parameter = ${parameter}`);
  return rows[0];
}

export async function listQualitySpecs(filter: {
  itemId?: string;
  activeOnly?: boolean;
  limit: number;
}): Promise<QualitySpecRow[]> {
  const rows = await query<QualitySpecRow>(sql`
    SELECT ${SPEC_COLUMNS} FROM quality_specifications
    WHERE (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
      AND (${filter.activeOnly ?? false} = false OR is_active = true)
    ORDER BY created_at, id
    LIMIT ${Math.min(filter.limit, 500)}`);
  return rows;
}

export interface UpdateQualitySpecInput {
  id: string;
  parameterAr?: string | null;
  unit?: string | null;
  targetValue?: string;
  ucl?: string | null;
  lcl?: string | null;
  isActive?: boolean;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

/** The PATCH idiom (the updateAssetCategory/updateAsset precedent): the
 * nullable columns merge with `!== undefined` so an explicit null
 * CLEARS (the tolerance ends are clearable — an unset tolerance is
 * UNTOLERATED, never a fabricated limit); the service re-checks the
 * merged band against the no-fabrication floor before calling. */
export async function updateQualitySpec(
  input: UpdateQualitySpecInput,
): Promise<QualitySpecRow | undefined> {
  const current = await findQualitySpecById(input.id);
  if (current === undefined) return undefined;
  const next = {
    parameterAr: input.parameterAr !== undefined ? input.parameterAr : current.parameterAr,
    unit: input.unit !== undefined ? input.unit : current.unit,
    targetValue: input.targetValue ?? current.targetValue,
    ucl: input.ucl !== undefined ? input.ucl : current.ucl,
    lcl: input.lcl !== undefined ? input.lcl : current.lcl,
    isActive: input.isActive ?? current.isActive,
    note: input.note !== undefined ? input.note : current.note,
    noteAr: input.noteAr !== undefined ? input.noteAr : current.noteAr,
  };
  const rows = await query<QualitySpecRow>(sql`
    UPDATE quality_specifications SET
      parameter_ar = ${next.parameterAr},
      unit = ${next.unit},
      target_value = ${next.targetValue},
      ucl = ${next.ucl},
      lcl = ${next.lcl},
      is_active = ${next.isActive},
      note = ${next.note},
      note_ar = ${next.noteAr},
      updated_by = ${input.actorId},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.id}
    RETURNING ${SPEC_COLUMNS}`);
  return rows[0];
}

export async function deleteQualitySpec(id: string): Promise<boolean> {
  const rows = await query<{ id: string }>(sql`
    DELETE FROM quality_specifications WHERE id = ${id} RETURNING id`);
  return rows.length > 0;
}

// ── the NCR rows (T-06 — the non-conformance register) ───────────────────────

export interface NcrRow {
  id: string;
  ncrNo: string;
  source: string;
  severity: string;
  itemId: string;
  batchId: string | null;
  inspectionId: string | null;
  partnerId: string | null;
  problem: string;
  problemAr: string | null;
  affectedQty: string;
  status: string;
  disposition: string | null;
  dispositionAt: string | null;
  closedAt: string | null;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const NCR_COLUMNS = sql`id, ncr_no AS "ncrNo", source, severity, item_id AS "itemId",
  batch_id AS "batchId", inspection_id AS "inspectionId", partner_id AS "partnerId",
  problem, problem_ar AS "problemAr", affected_qty AS "affectedQty", status,
  disposition, disposition_at::text AS "dispositionAt", closed_at::text AS "closedAt",
  journal_entry_id AS "journalEntryId", note, note_ar AS "noteAr",
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export interface InsertNcrInput {
  ncrNo: string;
  source: string;
  severity: string;
  itemId: string;
  batchId: string | null;
  inspectionId: string | null;
  partnerId: string | null;
  problem: string;
  problemAr: string | null;
  affectedQty: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertNcr(input: InsertNcrInput): Promise<NcrRow> {
  const rows = await query<NcrRow>(sql`
    INSERT INTO ncr_records
      (id, tenant_id, created_by, ncr_no, source, severity, item_id, batch_id,
       inspection_id, partner_id, problem, problem_ar, affected_qty, note, note_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.actorId},
            ${input.ncrNo}, ${input.source}, ${input.severity}, ${input.itemId},
            ${input.batchId}, ${input.inspectionId}, ${input.partnerId},
            ${input.problem}, ${input.problemAr}, ${input.affectedQty},
            ${input.note}, ${input.noteAr})
    RETURNING ${NCR_COLUMNS}`);
  return rows[0]!;
}

export async function findNcrById(id: string): Promise<NcrRow | undefined> {
  const rows = await query<NcrRow>(sql`
    SELECT ${NCR_COLUMNS} FROM ncr_records WHERE id = ${id}`);
  return rows[0];
}

export async function listNcrs(filter: {
  status?: string;
  itemId?: string;
  batchId?: string;
  source?: string;
  limit: number;
}): Promise<NcrRow[]> {
  const rows = await query<NcrRow>(sql`
    SELECT ${NCR_COLUMNS} FROM ncr_records
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
      AND (${filter.batchId ?? null}::uuid IS NULL OR batch_id = ${filter.batchId ?? null})
      AND (${filter.source ?? null}::text IS NULL OR source = ${filter.source ?? null})
    ORDER BY created_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
  return rows;
}

/**
 * THE DISPOSITION CAS (BR-102's floor + the single-use stamp): the one
 * guarded UPDATE that consumes the OPEN state and lands the
 * disposition pair together with the journal link (the 0114 journal
 * gate — a SCRAP's journal and ONLY a SCRAP's — is satisfied by the
 * same statement). Zero rows = the raced/stale move (the service
 * re-reads and refuses with the record's own state).
 */
export async function stampNcrDisposition(input: {
  id: string;
  disposition: string;
  dispositionAt: string;
  journalEntryId: string | null;
  actorId: string | null;
}): Promise<NcrRow | undefined> {
  const rows = await query<NcrRow>(sql`
    UPDATE ncr_records SET
      status = 'DISPOSITIONED',
      disposition = ${input.disposition},
      disposition_at = ${input.dispositionAt},
      journal_entry_id = ${input.journalEntryId},
      updated_by = ${input.actorId},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.id}
      AND status = 'OPEN'
      AND disposition IS NULL
      AND disposition_at IS NULL
      AND closed_at IS NULL
      AND journal_entry_id IS NULL
    RETURNING ${NCR_COLUMNS}`);
  return rows[0];
}

/** THE CLOSE CAS (BR-102's ladder top): DISPOSITIONED → CLOSED, the
 * closed_at stamp landing in the same statement; the disposition pair
 * is pinned by the from-state itself. */
export async function stampNcrClosed(input: {
  id: string;
  closedAt: string;
  actorId: string | null;
}): Promise<NcrRow | undefined> {
  const rows = await query<NcrRow>(sql`
    UPDATE ncr_records SET
      status = 'CLOSED',
      closed_at = ${input.closedAt},
      updated_by = ${input.actorId},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.id}
      AND status = 'DISPOSITIONED'
      AND disposition IS NOT NULL
      AND disposition_at IS NOT NULL
      AND closed_at IS NULL
    RETURNING ${NCR_COLUMNS}`);
  return rows[0];
}

// ── G-62's stock read (the per-warehouse on-hand mirror) ─────────────────────

export interface BatchWarehouseOnHand {
  warehouseId: string;
  onHand: string;
}

/**
 * The batch's live on-hand per warehouse — the SAME semantics as the
 * inventory store's own `batchOnHand` (Σ IN − Σ OUT over the
 * append-only stock_moves ledger), grouped by warehouse for the G-62
 * write-off's deterministic coverage order (warehouse_id ASC — the
 * fold is order-free, the coverage is not). The manufacturing store's
 * own `qcBatchOnHand` is the direct precedent for a sibling module
 * mirroring this read; the inventory engine's ledger rows remain the
 * single source of truth (this reads, never writes).
 */
export async function batchOnHandByWarehouse(batchId: string): Promise<BatchWarehouseOnHand[]> {
  const rows = await query<BatchWarehouseOnHand>(sql`
    SELECT warehouse_id AS "warehouseId",
           COALESCE(SUM(CASE WHEN direction = 'IN' THEN qty ELSE -qty END), 0)::text AS "onHand"
    FROM stock_moves
    WHERE batch_id = ${batchId}
    GROUP BY warehouse_id
    HAVING COALESCE(SUM(CASE WHEN direction = 'IN' THEN qty ELSE -qty END), 0) > 0
    ORDER BY warehouse_id`);
  return rows;
}

// ── the CAPA rows (T-07 — the corrective/preventive action register) ──────────

/** The actions array's canonical cell (the domain fold's own shape — the
 * jsonb stored verbatim, camelCase keys, nulls explicit). */
export interface CapaActionRow {
  title: string;
  ownerEmployeeId: string | null;
  dueDate: string | null;
  completedAt: string | null;
}

export interface CapaRow {
  id: string;
  capaNo: string;
  ncrId: string | null;
  title: string;
  ownerEmployeeId: string | null;
  rootCause: string | null;
  rootCauseAt: string | null;
  actions: CapaActionRow[];
  dueDate: string | null;
  status: string;
  effectiveness: Record<string, unknown> | null;
  externalCost: string;
  journalEntryId: string | null;
  closedAt: string | null;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const CAPA_COLUMNS = sql`id, capa_no AS "capaNo", ncr_id AS "ncrId", title,
  owner_employee_id AS "ownerEmployeeId", root_cause AS "rootCause",
  root_cause_at::text AS "rootCauseAt", actions, due_date::text AS "dueDate", status,
  effectiveness, external_cost::text AS "externalCost",
  journal_entry_id AS "journalEntryId", closed_at::text AS "closedAt",
  note, note_ar AS "noteAr", version, created_at::text AS "createdAt",
  updated_at::text AS "updatedAt"`;

export interface InsertCapaInput {
  capaNo: string;
  ncrId: string | null;
  title: string;
  ownerEmployeeId: string | null;
  dueDate: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertCapa(input: InsertCapaInput): Promise<CapaRow> {
  const rows = await query<CapaRow>(sql`
    INSERT INTO capa_records
      (id, tenant_id, created_by, capa_no, ncr_id, title, owner_employee_id,
       due_date, note, note_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.actorId},
            ${input.capaNo}, ${input.ncrId}, ${input.title}, ${input.ownerEmployeeId},
            ${input.dueDate}, ${input.note}, ${input.noteAr})
    RETURNING ${CAPA_COLUMNS}`);
  return rows[0]!;
}

export async function findCapaById(id: string): Promise<CapaRow | undefined> {
  const rows = await query<CapaRow>(sql`
    SELECT ${CAPA_COLUMNS} FROM capa_records WHERE id = ${id}`);
  return rows[0];
}

export async function listCapas(filter: {
  status?: string;
  ncrId?: string;
  limit: number;
}): Promise<CapaRow[]> {
  const rows = await query<CapaRow>(sql`
    SELECT ${CAPA_COLUMNS} FROM capa_records
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.ncrId ?? null}::uuid IS NULL OR ncr_id = ${filter.ncrId ?? null})
    ORDER BY created_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
  return rows;
}

/**
 * THE ROOT-CAUSE CAS (the start act — the declared W-26 interpretation):
 * recording the root-cause analysis moves OPEN → IN_PROGRESS in the same
 * statement that lands the pair (the 0105 stamp-law shape); at
 * IN_PROGRESS the act re-records (the analysis evolved — root_cause_at
 * refreshed, the honest stamp of its last revision). Zero rows = the
 * record is CLOSED (the service re-reads and refuses with the record's
 * own state).
 */
export async function stampCapaRootCause(input: {
  id: string;
  rootCause: string;
  rootCauseAt: string;
  actorId: string | null;
}): Promise<CapaRow | undefined> {
  const rows = await query<CapaRow>(sql`
    UPDATE capa_records SET
      status = 'IN_PROGRESS',
      root_cause = ${input.rootCause},
      root_cause_at = ${input.rootCauseAt},
      updated_by = ${input.actorId},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.id}
      AND status IN ('OPEN', 'IN_PROGRESS')
      AND closed_at IS NULL
    RETURNING ${CAPA_COLUMNS}`);
  return rows[0];
}

/** THE ACTIONS CAS (the array replaces wholesale — the fold validated
 * the canonical shape at the service floor; OPEN and IN_PROGRESS both
 * carry the plan). */
export async function stampCapaActions(input: {
  id: string;
  actions: CapaActionRow[];
  actorId: string | null;
}): Promise<CapaRow | undefined> {
  const rows = await query<CapaRow>(sql`
    UPDATE capa_records SET
      actions = ${JSON.stringify(input.actions)}::jsonb,
      updated_by = ${input.actorId},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.id}
      AND status IN ('OPEN', 'IN_PROGRESS')
      AND closed_at IS NULL
    RETURNING ${CAPA_COLUMNS}`);
  return rows[0];
}

/**
 * THE SINGLE-USE EXTERNAL-COST CAS (the G-63 stamp — INV-013's sibling
 * discipline): pins status = 'IN_PROGRESS' (the 0114 journal gate's own
 * allowance) AND journal_entry_id IS NULL AND external_cost = 0 (the
 * single-use stamp), landing the cost together with the journal link in
 * ONE statement. Zero rows = the raced/stale move (OPEN, already
 * stamped, or CLOSED — the service re-reads and refuses with the
 * record's own state; the ambient transaction rolls the posting back
 * with it — zero residue, INV-018).
 */
export async function stampCapaExternalCost(input: {
  id: string;
  externalCost: string;
  journalEntryId: string;
  actorId: string | null;
}): Promise<CapaRow | undefined> {
  const rows = await query<CapaRow>(sql`
    UPDATE capa_records SET
      external_cost = ${input.externalCost},
      journal_entry_id = ${input.journalEntryId},
      updated_by = ${input.actorId},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.id}
      AND status = 'IN_PROGRESS'
      AND journal_entry_id IS NULL
      AND external_cost = 0
      AND closed_at IS NULL
    RETURNING ${CAPA_COLUMNS}`);
  return rows[0];
}

/** THE CLOSE CAS (BR-103's own stamp — the 0114 floor satisfied by the
 * same statement that consumes the state): IN_PROGRESS → CLOSED, the
 * effectiveness record and closed_at landing together. */
export async function stampCapaClosed(input: {
  id: string;
  effectiveness: Record<string, unknown>;
  closedAt: string;
  actorId: string | null;
}): Promise<CapaRow | undefined> {
  const rows = await query<CapaRow>(sql`
    UPDATE capa_records SET
      status = 'CLOSED',
      effectiveness = ${JSON.stringify(input.effectiveness)}::jsonb,
      closed_at = ${input.closedAt},
      updated_by = ${input.actorId},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.id}
      AND status = 'IN_PROGRESS'
      AND effectiveness IS NULL
      AND closed_at IS NULL
    RETURNING ${CAPA_COLUMNS}`);
  return rows[0];
}

// ── the calibration rows (T-08 — the instrument-asset register) ───────────────

export interface CalibrationRow {
  id: string;
  calibrationNo: string;
  assetId: string;
  standardUsed: string;
  result: string;
  calibratedAt: string;
  dueDate: string;
  providerId: string | null;
  certificateRef: string | null;
  externalCost: string;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const CALIBRATION_COLUMNS = sql`id, calibration_no AS "calibrationNo",
  asset_id AS "assetId", standard_used AS "standardUsed", result,
  calibrated_at::text AS "calibratedAt", due_date::text AS "dueDate",
  provider_id AS "providerId", certificate_ref AS "certificateRef",
  external_cost::text AS "externalCost", journal_entry_id AS "journalEntryId",
  note, note_ar AS "noteAr", version, created_at::text AS "createdAt",
  updated_at::text AS "updatedAt"`;

export interface InsertCalibrationInput {
  /** Pre-generated (uuidv7): the G-63 source key names the record BEFORE
   * the row exists — the posting and the insert share the id in the SAME
   * ambient transaction (a failure anywhere rolls both back, INV-018). */
  id: string;
  calibrationNo: string;
  assetId: string;
  standardUsed: string;
  result: string;
  calibratedAt: string;
  dueDate: string;
  providerId: string | null;
  certificateRef: string | null;
  externalCost: string;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertCalibration(input: InsertCalibrationInput): Promise<CalibrationRow> {
  const rows = await query<CalibrationRow>(sql`
    INSERT INTO calibration_records
      (id, tenant_id, created_by, calibration_no, asset_id, standard_used,
       result, calibrated_at, due_date, provider_id, certificate_ref,
       external_cost, journal_entry_id, note, note_ar)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.actorId},
            ${input.calibrationNo}, ${input.assetId}, ${input.standardUsed},
            ${input.result}, ${input.calibratedAt}, ${input.dueDate},
            ${input.providerId}, ${input.certificateRef}, ${input.externalCost},
            ${input.journalEntryId}, ${input.note}, ${input.noteAr})
    RETURNING ${CALIBRATION_COLUMNS}`);
  return rows[0]!;
}

export async function findCalibrationById(id: string): Promise<CalibrationRow | undefined> {
  const rows = await query<CalibrationRow>(sql`
    SELECT ${CALIBRATION_COLUMNS} FROM calibration_records WHERE id = ${id}`);
  return rows[0];
}

/** The instrument's own history (D-08: the register IS the service-history
 * timeline's calibration leg — the asset card's read feeds from these
 * rows, the newest first). */
export async function listCalibrations(filter: {
  assetId?: string;
  limit: number;
}): Promise<CalibrationRow[]> {
  const rows = await query<CalibrationRow>(sql`
    SELECT ${CALIBRATION_COLUMNS} FROM calibration_records
    WHERE (${filter.assetId ?? null}::uuid IS NULL OR asset_id = ${filter.assetId ?? null})
    ORDER BY calibrated_at DESC, created_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
  return rows;
}

// ── the calibration sweep's probe + settings (T-08 — the 0111 pattern) ───────

export interface CalibrationDueRow {
  assetId: string;
  code: string;
  name: string;
  nameAr: string | null;
  dueDate: string;
}

/**
 * ONE banded probe (the scanExpiringAssets sibling): every ACTIVE
 * instrument whose LATEST calibration record's due date falls in the
 * band. THE LATEST-FIRST LAW (the honest shape the W-26 sweep spec's
 * per-cycle arm caught RED before any push): the per-instrument
 * DISTINCT ON collapse happens BEFORE the band filter — the re-calibrated
 * instrument's CURRENT obligation is its newest due date (a +300
 * re-calibration never lets the superseded +15 row alert); the band then
 * applies to the LATEST due date alone. THE DERIVED STEP (the clock
 * law): the band edges resolve against the database's own CURRENT_DATE
 * inside the statement — the same clock the fold's day-values mirror;
 * no Date.now()+delta anywhere in JS. The outer ORDER BY keeps the
 * deterministic read order.
 */
export async function scanCalibrationDue(input: {
  band: { threshold: number; fromDays: number | null; toDays: number };
  limit: number;
}): Promise<CalibrationDueRow[]> {
  return query<CalibrationDueRow>(sql`
    SELECT latest."assetId" AS "assetId", latest.code, latest.name,
      latest."nameAr" AS "nameAr", latest."dueDateValue"::text AS "dueDate"
    FROM (
      SELECT DISTINCT ON (a.id)
        a.id AS "assetId", a.code, a.name, a.name_ar AS "nameAr",
        cr.due_date AS "dueDateValue"
      FROM calibration_records cr
      JOIN assets a ON a.id = cr.asset_id AND a.tenant_id = cr.tenant_id
      WHERE a.status = 'ACTIVE'
      ORDER BY a.id, cr.calibrated_at DESC, cr.created_at DESC, cr.id DESC
    ) latest
    WHERE latest."dueDateValue" <= (CURRENT_DATE + ${input.band.toDays}::int)
      AND (${input.band.fromDays ?? null}::int IS NULL
        OR latest."dueDateValue" > (CURRENT_DATE + ${input.band.fromDays ?? null}::int))
    ORDER BY latest."dueDateValue", latest."assetId"
    LIMIT ${input.limit}`);
}

export interface CalibrationSweepSettingsRow {
  key: string;
  value: readonly unknown[];
  updatedAt: string;
}

/** The sweep's stored thresholds read (the SAME single settings home the
 * generic tenancy surface writes — tenant_settings' structural unique on
 * (tenant, key) is the one-row-per-key floor). */
export async function findCalibrationSweepSetting(): Promise<
  CalibrationSweepSettingsRow | undefined
> {
  const rows = await query<CalibrationSweepSettingsRow>(sql`
    SELECT key, value, updated_at::text AS "updatedAt"
    FROM tenant_settings WHERE key = 'quality.calibration_sweep_thresholds' LIMIT 1`);
  return rows[0];
}

/** The thresholds write — the SAME row, the SAME invalidation event the
 * generic surface emits (the upsertSweepSetting precedent verbatim; ZERO
 * parallel accounting). */
export async function upsertCalibrationSweepSetting(input: {
  value: readonly number[];
  actorId: string | null;
}): Promise<void> {
  await query<{ key: string }>(sql`
    INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
    VALUES (${generateUuidV7()}, ${requireTenantContext().tenantId},
            'quality.calibration_sweep_thresholds',
            ${JSON.stringify(input.value)}::jsonb, ${input.actorId})
    ON CONFLICT ("tenant_id", "key") DO UPDATE SET
      value = EXCLUDED.value, updated_at = now(),
      version = tenant_settings.version + 1, updated_by = EXCLUDED.updated_by`);
}

/** The sweep's LAST-RUN SEAL read (the audit plane IS the job log — the
 * latest audit record of the run action, no parallel stats row). */
export async function lastCalibrationSweepRun(): Promise<
  { at: string; outcome: { windows: number[]; flagged: number; notified: number } } | undefined
> {
  const rows = await query<{
    at: string;
    after: { windows: number[]; flagged: number; notified: number };
  }>(sql`
    SELECT at::text AS at, after
    FROM audit_events
    WHERE action = 'quality.calibration_sweep_run'
    ORDER BY at DESC LIMIT 1`);
  const row = rows[0];
  return row === undefined ? undefined : { at: row.at, outcome: row.after };
}

// ── the SPC measurement rows (T-09 — the per-parameter sample store, W-27) ───

export interface SpcMeasurementRow {
  id: string;
  specId: string;
  value: string;
  sampledAt: string;
  source: string;
  batchId: string | null;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// The 0113 sample store's own shape: a single note column (no note_ar
// — the measurements are operational rows, not the bilingual master
// data; the 0113 CHECK's own domain).
const SPC_COLUMNS = sql`id, spec_id AS "specId", value::text AS "value",
  sampled_at::text AS "sampledAt", source, batch_id AS "batchId",
  note, version, created_at::text AS "createdAt",
  updated_at::text AS "updatedAt"`;

export interface InsertSpcMeasurementInput {
  specId: string;
  value: string;
  sampledAt: string;
  source: string;
  batchId: string | null;
  note: string | null;
  actorId: string | null;
}

/** The sample store's ONLY writer. Evidence discipline: no DELETE (the
 * 0113 grants) — the measurements are the chart's history; corrections
 * are new samples, never rewrites. */
export async function insertSpcMeasurement(
  input: InsertSpcMeasurementInput,
): Promise<SpcMeasurementRow> {
  const rows = await query<SpcMeasurementRow>(sql`
    INSERT INTO spc_measurements
      (id, tenant_id, created_by, spec_id, value, sampled_at, source, batch_id, note)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.actorId},
            ${input.specId}, ${input.value}, ${input.sampledAt}::timestamptz,
            ${input.source}, ${input.batchId}, ${input.note})
    RETURNING ${SPC_COLUMNS}`);
  return rows[0]!;
}

/** The chart read's own cap: the NEWEST `limit` samples (sampled_at DESC,
 * id DESC — the deterministic tie-break), newest-first; the service
 * reverses to time order before feeding the PURE module. */
export async function listSpcMeasurements(filter: {
  specId: string;
  limit: number;
}): Promise<SpcMeasurementRow[]> {
  const rows = await query<SpcMeasurementRow>(sql`
    SELECT ${SPC_COLUMNS} FROM spc_measurements
    WHERE spec_id = ${filter.specId}
    ORDER BY sampled_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
  return rows;
}

/** The batch's own provenance read (a W-28/W-29 consumer surface; kept
 * beside the family it reads). */
export async function listSpcMeasurementsByBatch(filter: {
  batchId: string;
  limit: number;
}): Promise<SpcMeasurementRow[]> {
  const rows = await query<SpcMeasurementRow>(sql`
    SELECT ${SPC_COLUMNS} FROM spc_measurements
    WHERE batch_id = ${filter.batchId}
    ORDER BY sampled_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
  return rows;
}

// ── the supplier quality score rows (T-10 — the rolling fold, W-27) ──────────

export interface SupplierQualityScoreRow {
  id: string;
  partnerId: string;
  periodStart: string;
  ncrCount: number;
  rejectionCount: number;
  onTimeDeliveries: number;
  totalDeliveries: number;
  score: string;
  computedAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const SQS_COLUMNS = sql`id, partner_id AS "partnerId", period_start::text AS "periodStart",
  ncr_count AS "ncrCount", rejection_count AS "rejectionCount",
  on_time_deliveries AS "onTimeDeliveries", total_deliveries AS "totalDeliveries",
  score::text AS "score", computed_at::text AS "computedAt",
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

/** THE ROLLING UPSERT: one row per (tenant, partner, period_start) — the
 * recompute OVERWRITES in place (the window moves, the fold re-runs; the
 * natural key's own law, the 038 scorecard's ONE-row-per-supplier
 * precedent at period grain). Rebuildable derived data: the 0115 grants
 * carry DELETE by design (this store never exercises it). */
export async function upsertSupplierQualityScore(input: {
  partnerId: string;
  periodStart: string;
  ncrCount: number;
  rejectionCount: number;
  onTimeDeliveries: number;
  totalDeliveries: number;
  score: string;
  actorId: string | null;
}): Promise<SupplierQualityScoreRow> {
  const rows = await query<SupplierQualityScoreRow>(sql`
    INSERT INTO supplier_quality_scores
      (id, tenant_id, created_by, partner_id, period_start, ncr_count, rejection_count,
       on_time_deliveries, total_deliveries, score, computed_at)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.actorId},
            ${input.partnerId}, ${input.periodStart}::date, ${input.ncrCount},
            ${input.rejectionCount}, ${input.onTimeDeliveries}, ${input.totalDeliveries},
            ${input.score}, now())
    ON CONFLICT ("tenant_id", "partner_id", "period_start") DO UPDATE SET
      ncr_count = EXCLUDED.ncr_count,
      rejection_count = EXCLUDED.rejection_count,
      on_time_deliveries = EXCLUDED.on_time_deliveries,
      total_deliveries = EXCLUDED.total_deliveries,
      score = EXCLUDED.score,
      computed_at = now(),
      updated_by = EXCLUDED.created_by,
      updated_at = now(),
      version = supplier_quality_scores.version + 1
    RETURNING ${SQS_COLUMNS}`);
  return rows[0]!;
}

export async function listSupplierQualityScores(filter: {
  partnerId?: string;
  limit: number;
}): Promise<SupplierQualityScoreRow[]> {
  const rows = await query<SupplierQualityScoreRow>(sql`
    SELECT ${SQS_COLUMNS} FROM supplier_quality_scores
    WHERE (${filter.partnerId ?? null}::uuid IS NULL OR partner_id = ${filter.partnerId ?? null})
    ORDER BY period_start DESC, partner_id
    LIMIT ${Math.min(filter.limit, 500)}`);
  return rows;
}

/** THE DOCUMENTED 038 FEED READ (D-13): the consumer's own door — the
 * latest periods for ONE supplier, read VERBATIM (the consumer reads,
 * never re-computes). */
export async function findSupplierQualityFeed(
  partnerId: string,
  limit: number,
): Promise<SupplierQualityScoreRow[]> {
  const rows = await query<SupplierQualityScoreRow>(sql`
    SELECT ${SQS_COLUMNS} FROM supplier_quality_scores
    WHERE partner_id = ${partnerId}
    ORDER BY period_start DESC
    LIMIT ${Math.min(limit, 24)}`);
  return rows;
}

// ── the supplier fold's evidence reads (the owning engines' rows) ────────────

/** The period's SUPPLIER-source NCR count (the module's OWN register —
 * the fold's defect input, one of its two legs). */
export async function countSupplierNcrs(input: {
  partnerId: string;
  periodStart: string;
  periodEndExclusive: string;
}): Promise<number> {
  const rows = await query<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM ncr_records
    WHERE source = 'SUPPLIER' AND partner_id = ${input.partnerId}
      AND (created_at AT TIME ZONE 'UTC')::date >= ${input.periodStart}::date
      AND (created_at AT TIME ZONE 'UTC')::date < ${input.periodEndExclusive}::date`);
  return rows[0]!.n;
}

/** The period's incoming-lot rejections: goods-receipt-target inspections
 * with result FAIL, joined to the receipts' own supplier (the
 * manufacturing module's inspections + the purchasing module's receipts
 * — the OWNING engines' rows, read here, never re-computed). */
export async function countSupplierRejections(input: {
  partnerId: string;
  periodStart: string;
  periodEndExclusive: string;
}): Promise<number> {
  const rows = await query<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM inspections i
    JOIN goods_receipts g ON g.id = i.grn_id AND g.tenant_id = i.tenant_id
    WHERE i.target_type = 'goods_receipt' AND i.result = 'FAIL'
      AND g.supplier_id = ${input.partnerId}
      AND (i.inspected_at AT TIME ZONE 'UTC')::date >= ${input.periodStart}::date
      AND (i.inspected_at AT TIME ZONE 'UTC')::date < ${input.periodEndExclusive}::date`);
  return rows[0]!.n;
}

/** The period's delivery performance — THE 038 WINDOW READ'S OWN LAW
 * VERBATIM (collaboration.store readScorecardWindow): the POSTED receipts
 * joined to their purchase orders, on-time = receipt_date ≤ the PO's
 * expected date (a receipt with no expected date is on time by
 * COALESCE's own grace — the delivered law, mirrored not re-derived). */
export async function readSupplierDeliveryWindow(input: {
  partnerId: string;
  periodStart: string;
  periodEndExclusive: string;
}): Promise<{ total: number; onTime: number }> {
  const rows = await query<{ total: number; onTime: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (
             WHERE g.receipt_date <= COALESCE(po.expected_date, g.receipt_date))::int AS "onTime"
    FROM goods_receipts g
    JOIN purchase_orders po ON po.id = g.po_id AND po.tenant_id = g.tenant_id
    WHERE g.supplier_id = ${input.partnerId}
      AND g.status = 'POSTED'
      AND g.receipt_date >= ${input.periodStart}::date
      AND g.receipt_date < ${input.periodEndExclusive}::date`);
  return rows[0]!;
}

// ── the COA document rows (T-11 — the generated certificate, W-27) ───────────

/** The frozen snapshot entry's stored shape (the pure fold's CoaGateEntry
 * serialized verbatim — camelCase keys, nulls explicit, the W-25 actions
 * array's own discipline). */
export type CoaParameters = ReadonlyArray<Record<string, unknown>>;

export interface CoaDocumentRow {
  id: string;
  docNo: string;
  docType: string;
  itemId: string;
  batchId: string | null;
  inspectionId: string | null;
  parameters: CoaParameters;
  issuedAt: string;
  issuedBy: string | null;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const COA_COLUMNS = sql`id, doc_no AS "docNo", doc_type AS "docType", item_id AS "itemId",
  batch_id AS "batchId", inspection_id AS "inspectionId", parameters,
  issued_at::text AS "issuedAt", issued_by AS "issuedBy", note, note_ar AS "noteAr",
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export interface InsertCoaDocumentInput {
  docNo: string;
  docType: string;
  itemId: string;
  batchId: string | null;
  inspectionId: string | null;
  parameters: CoaParameters;
  issuedAt: string;
  issuedBy: string | null;
  note: string | null;
  noteAr: string | null;
}

/** The certificate's ONLY writer — the frozen snapshot lands verbatim
 * (BR-104's own record); evidence discipline: S/I/U, NO DELETE (an
 * issued certificate is immutable history — the print law's own frozen
 * input). */
export async function insertCoaDocument(
  input: InsertCoaDocumentInput,
): Promise<CoaDocumentRow> {
  const rows = await query<CoaDocumentRow>(sql`
    INSERT INTO coa_documents
      (id, tenant_id, doc_no, doc_type, item_id, batch_id, inspection_id,
       parameters, issued_at, issued_by, note, note_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.docNo}, ${input.docType},
            ${input.itemId}, ${input.batchId}, ${input.inspectionId},
            ${JSON.stringify(input.parameters)}::jsonb, ${input.issuedAt}::timestamptz,
            ${input.issuedBy}, ${input.note}, ${input.noteAr})
    RETURNING ${COA_COLUMNS}`);
  return rows[0]!;
}

export async function findCoaDocumentById(id: string): Promise<CoaDocumentRow | undefined> {
  const rows = await query<CoaDocumentRow>(sql`
    SELECT ${COA_COLUMNS} FROM coa_documents WHERE id = ${id}`);
  return rows[0];
}

export async function listCoaDocuments(filter: {
  itemId?: string;
  batchId?: string;
  limit: number;
}): Promise<CoaDocumentRow[]> {
  const rows = await query<CoaDocumentRow>(sql`
    SELECT ${COA_COLUMNS} FROM coa_documents
    WHERE (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
      AND (${filter.batchId ?? null}::uuid IS NULL OR batch_id = ${filter.batchId ?? null})
    ORDER BY issued_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
  return rows;
}

// ── PHASE-050 (W-28 — T-13) the batch quality holds (INV-035 + BR-101 —
// D-07: the shared blocking validation service is the ONLY gate; this
// store's read feeds it, and every write is the register's own CAS) ──────────

export interface BatchQualityHoldRow {
  id: string;
  batchId: string;
  reason: string;
  ncrId: string | null;
  status: "ACTIVE" | "RELEASED";
  heldAt: string;
  releasedAt: string | null;
  releaseNote: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

const HOLD_COLUMNS = sql`id, batch_id AS "batchId", reason, ncr_id AS "ncrId",
  status, held_at AS "heldAt", released_at AS "releasedAt",
  release_note AS "releaseNote", note, note_ar AS "noteAr",
  created_by AS "createdBy", created_at AS "createdAt"`;

export interface InsertBatchQualityHoldInput {
  batchId: string;
  reason: string;
  ncrId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}

export async function insertBatchQualityHold(
  input: InsertBatchQualityHoldInput,
): Promise<BatchQualityHoldRow> {
  const rows = await query<BatchQualityHoldRow>(sql`
    INSERT INTO batch_quality_holds
      (id, tenant_id, created_by, batch_id, reason, ncr_id, note, note_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.createdBy},
            ${input.batchId}, ${input.reason}, ${input.ncrId}, ${input.note}, ${input.noteAr})
    RETURNING ${HOLD_COLUMNS}`);
  return rows[0]!;
}

/** The one-active-per-batch read (the partial unique's own single row —
 * the gate's read stays single-row by construction). */
export async function findActiveHoldByBatch(
  batchId: string,
): Promise<BatchQualityHoldRow | undefined> {
  const rows = await query<BatchQualityHoldRow>(sql`
    SELECT ${HOLD_COLUMNS} FROM batch_quality_holds
    WHERE batch_id = ${batchId} AND status = 'ACTIVE'
    LIMIT 1`);
  return rows[0];
}

/** THE GATE READ (D-07): every ACTIVE hold over the plan's resolved
 * batches — ONE statement, the partial unique index's own access path
 * (uq_batch_quality_holds_tenant_batch_active). */
export async function findActiveHoldsByBatches(
  batchIds: readonly string[],
): Promise<BatchQualityHoldRow[]> {
  if (batchIds.length === 0) return [];
  const list = sql.join(
    batchIds.map((batchId) => sql`${batchId}`),
    sql`, `,
  );
  return query<BatchQualityHoldRow>(sql`
    SELECT ${HOLD_COLUMNS} FROM batch_quality_holds
    WHERE status = 'ACTIVE' AND batch_id IN (${list})`);
}

export async function findBatchQualityHoldById(
  id: string,
): Promise<BatchQualityHoldRow | undefined> {
  const rows = await query<BatchQualityHoldRow>(sql`
    SELECT ${HOLD_COLUMNS} FROM batch_quality_holds WHERE id = ${id}`);
  return rows[0];
}

export async function listBatchQualityHolds(filter: {
  batchId?: string;
  status?: "ACTIVE" | "RELEASED";
  limit: number;
}): Promise<BatchQualityHoldRow[]> {
  return query<BatchQualityHoldRow>(sql`
    SELECT ${HOLD_COLUMNS} FROM batch_quality_holds
    WHERE (${filter.batchId ?? null}::uuid IS NULL OR batch_id = ${filter.batchId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY held_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
}

/** BR-101's release CAS: the status pins ACTIVE, the release pair lands
 * in the SAME statement (the ck_release_shape floor satisfied by the
 * same statement that consumes the stamp); zero rows = the raced/stale
 * move. */
export async function releaseBatchQualityHold(input: {
  id: string;
  releaseNote: string;
  updatedBy: string | null;
}): Promise<BatchQualityHoldRow | undefined> {
  const rows = await query<BatchQualityHoldRow>(sql`
    UPDATE batch_quality_holds
    SET status = 'RELEASED', released_at = now(), release_note = ${input.releaseNote},
        updated_by = ${input.updatedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'ACTIVE'
    RETURNING ${HOLD_COLUMNS}`);
  return rows[0];
}

// ── PHASE-050 (W-28 — T-12) the complaints (Q-08 — the intake, the NCR
// link, the resolution pair; 0114's own table) ────────────────────────────────

export interface ComplaintRow {
  id: string;
  complaintNo: string;
  channel: string;
  severity: string;
  customerId: string;
  itemId: string | null;
  batchId: string | null;
  ncrId: string | null;
  subject: string;
  details: string | null;
  detailsAr: string | null;
  status: string;
  resolution: string | null;
  resolvedAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

const COMPLAINT_COLUMNS = sql`id, complaint_no AS "complaintNo", channel, severity,
  customer_id AS "customerId", item_id AS "itemId", batch_id AS "batchId",
  ncr_id AS "ncrId", subject, details, details_ar AS "detailsAr", status,
  resolution, resolved_at AS "resolvedAt", note, note_ar AS "noteAr",
  created_by AS "createdBy", created_at AS "createdAt"`;

export interface InsertComplaintInput {
  complaintNo: string;
  channel: string;
  severity: string;
  customerId: string;
  itemId: string | null;
  batchId: string | null;
  subject: string;
  details: string | null;
  detailsAr: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}

export async function insertComplaint(input: InsertComplaintInput): Promise<ComplaintRow> {
  const rows = await query<ComplaintRow>(sql`
    INSERT INTO complaints
      (id, tenant_id, created_by, complaint_no, channel, severity, customer_id,
       item_id, batch_id, subject, details, details_ar, note, note_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.createdBy},
            ${input.complaintNo}, ${input.channel}, ${input.severity}, ${input.customerId},
            ${input.itemId}, ${input.batchId}, ${input.subject}, ${input.details},
            ${input.detailsAr}, ${input.note}, ${input.noteAr})
    RETURNING ${COMPLAINT_COLUMNS}`);
  return rows[0]!;
}

export async function findComplaintById(id: string): Promise<ComplaintRow | undefined> {
  const rows = await query<ComplaintRow>(sql`
    SELECT ${COMPLAINT_COLUMNS} FROM complaints WHERE id = ${id}`);
  return rows[0];
}

export async function listComplaints(filter: {
  status?: string;
  customerId?: string;
  ncrId?: string;
  limit: number;
}): Promise<ComplaintRow[]> {
  return query<ComplaintRow>(sql`
    SELECT ${COMPLAINT_COLUMNS} FROM complaints
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.customerId ?? null}::uuid IS NULL OR customer_id = ${filter.customerId ?? null})
      AND (${filter.ncrId ?? null}::uuid IS NULL OR ncr_id = ${filter.ncrId ?? null})
    ORDER BY created_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
}

/** The triage CAS: NEW pins the from-state; the NCR link may land in the
 * SAME statement (the triage act carries the first link — the fold's
 * own window). */
export async function stampComplaintTriage(input: {
  id: string;
  ncrId: string | null;
  updatedBy: string | null;
}): Promise<ComplaintRow | undefined> {
  const rows = await query<ComplaintRow>(sql`
    UPDATE complaints
    SET status = 'TRIAGED', ncr_id = ${input.ncrId},
        updated_by = ${input.updatedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'NEW'
    RETURNING ${COMPLAINT_COLUMNS}`);
  return rows[0];
}

/** The link CAS: the window pins TRIAGED/IN_PROGRESS; the link is the
 * triage's own correction while the window stands. */
export async function linkComplaintNcr(input: {
  id: string;
  ncrId: string;
  updatedBy: string | null;
}): Promise<ComplaintRow | undefined> {
  const rows = await query<ComplaintRow>(sql`
    UPDATE complaints
    SET ncr_id = ${input.ncrId},
        updated_by = ${input.updatedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status IN ('TRIAGED', 'IN_PROGRESS') AND ncr_id IS NULL
    RETURNING ${COMPLAINT_COLUMNS}`);
  return rows[0];
}

export async function stampComplaintProgress(input: {
  id: string;
  updatedBy: string | null;
}): Promise<ComplaintRow | undefined> {
  const rows = await query<ComplaintRow>(sql`
    UPDATE complaints
    SET status = 'IN_PROGRESS',
        updated_by = ${input.updatedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'TRIAGED'
    RETURNING ${COMPLAINT_COLUMNS}`);
  return rows[0];
}

/** The resolution CAS: the pair lands together (ck_complaints_resolved_
 * shape satisfied by the same statement). */
export async function stampComplaintResolution(input: {
  id: string;
  resolution: string;
  updatedBy: string | null;
}): Promise<ComplaintRow | undefined> {
  const rows = await query<ComplaintRow>(sql`
    UPDATE complaints
    SET status = 'RESOLVED', resolution = ${input.resolution}, resolved_at = now(),
        updated_by = ${input.updatedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'IN_PROGRESS'
    RETURNING ${COMPLAINT_COLUMNS}`);
  return rows[0];
}

export async function stampComplaintClosed(input: {
  id: string;
  updatedBy: string | null;
}): Promise<ComplaintRow | undefined> {
  const rows = await query<ComplaintRow>(sql`
    UPDATE complaints
    SET status = 'CLOSED',
        updated_by = ${input.updatedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'RESOLVED'
    RETURNING ${COMPLAINT_COLUMNS}`);
  return rows[0];
}

// ── PHASE-050 (W-28 — T-14) the recall registry (Q-09/Q-12 — the drill's
// RECORD; the drill's live query is the service over the EXISTING
// genealogy + sales-edge reads, D-14) ─────────────────────────────────────────

export interface RecallRegistryRow {
  id: string;
  recallNo: string;
  batchId: string;
  reason: string;
  status: "INITIATED" | "EXECUTED" | "CLOSED";
  initiatedAt: string;
  executedAt: string | null;
  closedAt: string | null;
  scope: unknown;
  affectedCustomers: unknown;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

const RECALL_COLUMNS = sql`id, recall_no AS "recallNo", batch_id AS "batchId", reason,
  status, initiated_at AS "initiatedAt", executed_at AS "executedAt",
  closed_at AS "closedAt", scope, affected_customers AS "affectedCustomers",
  note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt"`;

export interface InsertRecallInput {
  recallNo: string;
  batchId: string;
  reason: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}

export async function insertRecall(input: InsertRecallInput): Promise<RecallRegistryRow> {
  const rows = await query<RecallRegistryRow>(sql`
    INSERT INTO recall_registry
      (id, tenant_id, created_by, recall_no, batch_id, reason, note, note_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.createdBy},
            ${input.recallNo}, ${input.batchId}, ${input.reason}, ${input.note}, ${input.noteAr})
    RETURNING ${RECALL_COLUMNS}`);
  return rows[0]!;
}

export async function findRecallById(id: string): Promise<RecallRegistryRow | undefined> {
  const rows = await query<RecallRegistryRow>(sql`
    SELECT ${RECALL_COLUMNS} FROM recall_registry WHERE id = ${id}`);
  return rows[0];
}

export async function listRecalls(filter: {
  status?: string;
  batchId?: string;
  limit: number;
}): Promise<RecallRegistryRow[]> {
  return query<RecallRegistryRow>(sql`
    SELECT ${RECALL_COLUMNS} FROM recall_registry
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.batchId ?? null}::uuid IS NULL OR batch_id = ${filter.batchId ?? null})
    ORDER BY initiated_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
}

/** The execute CAS: INITIATED pins the from-state; the frozen snapshots
 * (scope + affected_customers) land in the SAME statement (the executed
 * paths' own record — single-use, never re-frozen). */
export async function stampRecallExecuted(input: {
  id: string;
  scope: unknown;
  affectedCustomers: unknown;
  updatedBy: string | null;
}): Promise<RecallRegistryRow | undefined> {
  const rows = await query<RecallRegistryRow>(sql`
    UPDATE recall_registry
    SET status = 'EXECUTED', executed_at = now(),
        scope = ${JSON.stringify(input.scope)}::jsonb,
        affected_customers = ${JSON.stringify(input.affectedCustomers)}::jsonb,
        updated_by = ${input.updatedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'INITIATED'
    RETURNING ${RECALL_COLUMNS}`);
  return rows[0];
}

export async function stampRecallClosed(input: {
  id: string;
  updatedBy: string | null;
}): Promise<RecallRegistryRow | undefined> {
  const rows = await query<RecallRegistryRow>(sql`
    UPDATE recall_registry
    SET status = 'CLOSED', closed_at = now(),
        updated_by = ${input.updatedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'EXECUTED'
    RETURNING ${RECALL_COLUMNS}`);
  return rows[0];
}

/** The drill's doc→customer lookup (the §10 boundary's own consumer —
 * the genealogy returns DOC IDS ONLY by design; the recall drill is the
 * consumer that resolves them): one statement over the two sales doc
 * tables joined to the partner register. */
export interface RecallDocCustomerRow {
  docType: "sales_invoice" | "delivery_note";
  docId: string;
  docNo: string | null;
  customerId: string;
  customerName: string;
  customerNameAr: string | null;
}

export async function listRecallDocCustomers(
  docs: readonly { docType: "sales_invoice" | "delivery_note"; docId: string }[],
): Promise<RecallDocCustomerRow[]> {
  const deliveryIds = docs.filter((doc) => doc.docType === "delivery_note").map((doc) => doc.docId);
  const invoiceIds = docs.filter((doc) => doc.docType === "sales_invoice").map((doc) => doc.docId);
  if (deliveryIds.length === 0 && invoiceIds.length === 0) return [];
  const deliveryArm =
    deliveryIds.length === 0
      ? sql``
      : sql`
    SELECT 'delivery_note' AS "docType", dn.id AS "docId", dn.delivery_no AS "docNo",
           dn.customer_id AS "customerId", p.name AS "customerName", p.name_ar AS "customerNameAr"
      FROM delivery_notes dn JOIN partners p ON p.id = dn.customer_id AND p.tenant_id = dn.tenant_id
     WHERE dn.id IN (${sql.join(
       deliveryIds.map((id) => sql`${id}`),
       sql`, `,
     )})`;
  const invoiceArm =
    invoiceIds.length === 0
      ? sql``
      : sql`
    SELECT 'sales_invoice' AS "docType", si.id AS "docId", si.invoice_no AS "docNo",
           si.customer_id AS "customerId", p.name AS "customerName", p.name_ar AS "customerNameAr"
      FROM sales_invoices si JOIN partners p ON p.id = si.customer_id AND p.tenant_id = si.tenant_id
     WHERE si.id IN (${sql.join(
       invoiceIds.map((id) => sql`${id}`),
       sql`, `,
     )})`;
  const statement =
    deliveryIds.length > 0 && invoiceIds.length > 0
      ? sql`${deliveryArm} UNION ALL ${invoiceArm}`
      : deliveryIds.length > 0
        ? deliveryArm
        : invoiceArm;
  return query<RecallDocCustomerRow>(statement);
}

// ── PHASE-050 (W-30 — T-16) the management review indicator-pack reads
// (D-15: the engines' own status counts, one GROUP BY each — the pack
// reads the OWNING registers, zero recomputation, and FREEZES the answer
// into the meeting row; a later state never moves a stored pack) ──────────

/** The grouped count row (the pack's own atom — status → n). */
export interface StatusCountRow {
  status: string;
  n: number;
}

/** The NCR register's own status counts (the 0114 ladder's own domain). */
export async function countNcrsByStatus(): Promise<Record<string, number>> {
  const rows = await query<StatusCountRow>(sql`
    SELECT status, count(*)::int AS n FROM ncr_records GROUP BY status ORDER BY status`);
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

/** The CAPA register's own status counts. */
export async function countCapasByStatus(): Promise<Record<string, number>> {
  const rows = await query<StatusCountRow>(sql`
    SELECT status, count(*)::int AS n FROM capa_records GROUP BY status ORDER BY status`);
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

/** The complaints register's own status counts (the 0114 ladder). */
export async function countComplaintsByStatus(): Promise<Record<string, number>> {
  const rows = await query<StatusCountRow>(sql`
    SELECT status, count(*)::int AS n FROM complaints GROUP BY status ORDER BY status`);
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

/**
 * The sample store's own volume (the HONEST CHEAP READ — declared W-30):
 * the SPC chart (X-bar/R, the out-of-control flags) is the PURE module's
 * computed output, never a stored column — a SQL count of "out-of-control
 * charts" would RECOMPUTE the fold inside the database (the D-12
 * parallel-computation ban). The pack therefore carries the samples count
 * here (the chart's own input volume, a stock simple count), while the
 * out-of-control chart count lands through the ENGINE'S OWN chart read at
 * the service floor (SpcService.chart — the spc-service docblock's own
 * "report pack W-30" consumer surface).
 */
export async function countSpcMeasurements(): Promise<number> {
  const rows = await query<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM spc_measurements`);
  return rows[0]!.n;
}

// ── PHASE-050 (W-30 — T-16) the management review rows (Q-10 — the
// meeting RECORD: the frozen indicator pack + the decisions; evidence
// discipline: S/I/U, NO DELETE — the register is the review's own
// evidence, no move rewrites a held meeting) ────────────────────────────────

/** The frozen indicator pack's stored shape (the engines' own counts at
 * the meeting — camelCase keys, frozen verbatim, never recomputed). */
export interface ReviewIndicatorPack {
  ncrsByStatus: Record<string, number>;
  capasByStatus: Record<string, number>;
  complaintsByStatus: Record<string, number>;
  spc: {
    activeSpecs: number;
    outOfControlCharts: number;
    measurements: number;
  };
}

export interface ManagementReviewRow {
  id: string;
  reviewNo: string;
  title: string;
  heldAt: string;
  attendees: string[];
  indicatorPack: ReviewIndicatorPack;
  decisions: string[];
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

const REVIEW_COLUMNS = sql`id, review_no AS "reviewNo", title, held_at AS "heldAt",
  attendees, indicator_pack AS "indicatorPack", decisions, note, note_ar AS "noteAr",
  created_by AS "createdBy", created_at AS "createdAt"`;

export interface InsertManagementReviewInput {
  reviewNo: string;
  title: string;
  heldAt: string;
  attendees: string[];
  indicatorPack: ReviewIndicatorPack;
  decisions: string[];
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}

/** The meeting record's ONLY writer — the indicator pack lands FROZEN
 * (the 0116 frozen-snapshot law: a later engine state never moves a
 * stored pack; the jsonb CHECKs' object/array shapes satisfied by the
 * same statement that lands them). */
export async function insertManagementReview(
  input: InsertManagementReviewInput,
): Promise<ManagementReviewRow> {
  const rows = await query<ManagementReviewRow>(sql`
    INSERT INTO quality_management_reviews
      (id, tenant_id, created_by, review_no, title, held_at, attendees,
       indicator_pack, decisions, note, note_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.createdBy},
            ${input.reviewNo}, ${input.title}, ${input.heldAt}::timestamptz,
            ${JSON.stringify(input.attendees)}::jsonb,
            ${JSON.stringify(input.indicatorPack)}::jsonb,
            ${JSON.stringify(input.decisions)}::jsonb, ${input.note}, ${input.noteAr})
    RETURNING ${REVIEW_COLUMNS}`);
  return rows[0]!;
}

export async function findManagementReviewById(
  id: string,
): Promise<ManagementReviewRow | undefined> {
  const rows = await query<ManagementReviewRow>(sql`
    SELECT ${REVIEW_COLUMNS} FROM quality_management_reviews WHERE id = ${id}`);
  return rows[0];
}

export async function listManagementReviews(filter: {
  limit: number;
}): Promise<ManagementReviewRow[]> {
  return query<ManagementReviewRow>(sql`
    SELECT ${REVIEW_COLUMNS} FROM quality_management_reviews
    ORDER BY held_at DESC, id DESC
    LIMIT ${Math.min(filter.limit, 500)}`);
}

// ── PHASE-050 (W-30 — T-16) the hazard register rows (Q-11 — the HACCP
// register; the tenant owns the critical-limits structure, the
// food-manufacturing template composes the surface — D-15; master data:
// the 0116 grants carry S/I/U/D by design, this store exercises S/I/U) ──────

export interface HazardRegisterRow {
  id: string;
  name: string;
  nameAr: string | null;
  hazard: string;
  hazardAr: string | null;
  category: string;
  processStep: string | null;
  itemId: string | null;
  isCcp: boolean;
  criticalLimit: string | null;
  criticalLimitAr: string | null;
  monitoringProcedure: string | null;
  correctiveAction: string | null;
  isActive: boolean;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const HAZARD_COLUMNS = sql`id, name, name_ar AS "nameAr", hazard, hazard_ar AS "hazardAr",
  category, process_step AS "processStep", item_id AS "itemId", is_ccp AS "isCcp",
  critical_limit AS "criticalLimit", critical_limit_ar AS "criticalLimitAr",
  monitoring_procedure AS "monitoringProcedure", corrective_action AS "correctiveAction",
  is_active AS "isActive", note, note_ar AS "noteAr", version,
  created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export interface InsertHazardRegisterInput {
  name: string;
  nameAr: string | null;
  hazard: string;
  hazardAr: string | null;
  category: string;
  processStep: string | null;
  itemId: string | null;
  isCcp: boolean;
  criticalLimit: string | null;
  criticalLimitAr: string | null;
  monitoringProcedure: string | null;
  correctiveAction: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertHazardRegister(
  input: InsertHazardRegisterInput,
): Promise<HazardRegisterRow> {
  const rows = await query<HazardRegisterRow>(sql`
    INSERT INTO hazard_registers
      (id, tenant_id, created_by, name, name_ar, hazard, hazard_ar, category,
       process_step, item_id, is_ccp, critical_limit, critical_limit_ar,
       monitoring_procedure, corrective_action, note, note_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.actorId},
            ${input.name}, ${input.nameAr}, ${input.hazard}, ${input.hazardAr},
            ${input.category}, ${input.processStep}, ${input.itemId}, ${input.isCcp},
            ${input.criticalLimit}, ${input.criticalLimitAr},
            ${input.monitoringProcedure}, ${input.correctiveAction},
            ${input.note}, ${input.noteAr})
    RETURNING ${HAZARD_COLUMNS}`);
  return rows[0]!;
}

export async function findHazardRegisterById(
  id: string,
): Promise<HazardRegisterRow | undefined> {
  const rows = await query<HazardRegisterRow>(sql`
    SELECT ${HAZARD_COLUMNS} FROM hazard_registers WHERE id = ${id}`);
  return rows[0];
}

/** The natural-key read (the (tenant, name) unique's typed pre-check). */
export async function findHazardRegisterByName(
  name: string,
): Promise<HazardRegisterRow | undefined> {
  const rows = await query<HazardRegisterRow>(sql`
    SELECT ${HAZARD_COLUMNS} FROM hazard_registers WHERE name = ${name}`);
  return rows[0];
}

export async function listHazardRegisters(filter: {
  itemId?: string;
  category?: string;
  activeOnly?: boolean;
  limit: number;
}): Promise<HazardRegisterRow[]> {
  return query<HazardRegisterRow>(sql`
    SELECT ${HAZARD_COLUMNS} FROM hazard_registers
    WHERE (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
      AND (${filter.category ?? null}::text IS NULL OR category = ${filter.category ?? null})
      AND (${filter.activeOnly ?? false} = false OR is_active = true)
    ORDER BY name
    LIMIT ${Math.min(filter.limit, 500)}`);
}

export interface UpdateHazardRegisterInput {
  id: string;
  hazard?: string;
  hazardAr?: string | null;
  processStep?: string | null;
  itemId?: string | null;
  isCcp?: boolean;
  criticalLimit?: string | null;
  criticalLimitAr?: string | null;
  monitoringProcedure?: string | null;
  correctiveAction?: string | null;
  isActive?: boolean;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

/**
 * THE PATCH + STATE CAS (the updateQualitySpec idiom + the register's own
 * state law): the nullable columns merge with `!== undefined` so an
 * explicit null CLEARS; the WHERE pins `is_active = true` — the row's own
 * state law (a RETIRED register row is frozen evidence: retiring is the
 * last write it accepts, the transition itself landing through this same
 * CAS as SET is_active = false). The name and the category are IMMUTABLE
 * (the register row's own identity — the natural key and the 0116
 * vocabulary's domain, the updateQualitySpec precedent's parameter law).
 * Zero rows = the retired row or the raced move (the service re-reads and
 * refuses with the row's own state).
 */
export async function updateHazardRegister(
  input: UpdateHazardRegisterInput,
): Promise<HazardRegisterRow | undefined> {
  const current = await findHazardRegisterById(input.id);
  if (current === undefined) return undefined;
  const next = {
    hazard: input.hazard ?? current.hazard,
    hazardAr: input.hazardAr !== undefined ? input.hazardAr : current.hazardAr,
    processStep: input.processStep !== undefined ? input.processStep : current.processStep,
    itemId: input.itemId !== undefined ? input.itemId : current.itemId,
    isCcp: input.isCcp ?? current.isCcp,
    criticalLimit:
      input.criticalLimit !== undefined ? input.criticalLimit : current.criticalLimit,
    criticalLimitAr:
      input.criticalLimitAr !== undefined ? input.criticalLimitAr : current.criticalLimitAr,
    monitoringProcedure:
      input.monitoringProcedure !== undefined
        ? input.monitoringProcedure
        : current.monitoringProcedure,
    correctiveAction:
      input.correctiveAction !== undefined ? input.correctiveAction : current.correctiveAction,
    isActive: input.isActive ?? current.isActive,
    note: input.note !== undefined ? input.note : current.note,
    noteAr: input.noteAr !== undefined ? input.noteAr : current.noteAr,
  };
  const rows = await query<HazardRegisterRow>(sql`
    UPDATE hazard_registers SET
      hazard = ${next.hazard},
      hazard_ar = ${next.hazardAr},
      process_step = ${next.processStep},
      item_id = ${next.itemId},
      is_ccp = ${next.isCcp},
      critical_limit = ${next.criticalLimit},
      critical_limit_ar = ${next.criticalLimitAr},
      monitoring_procedure = ${next.monitoringProcedure},
      corrective_action = ${next.correctiveAction},
      is_active = ${next.isActive},
      note = ${next.note},
      note_ar = ${next.noteAr},
      updated_by = ${input.actorId},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.id}
      AND is_active = true
    RETURNING ${HAZARD_COLUMNS}`);
  return rows[0];
}
