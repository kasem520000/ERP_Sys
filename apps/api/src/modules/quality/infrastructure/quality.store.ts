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
