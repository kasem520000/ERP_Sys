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
