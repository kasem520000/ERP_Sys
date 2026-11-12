import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Cycle-count store (PHASE-044 T-07, migration 0069): the schedules, the
 * generated count documents + lines, and the ABC classifications. Every
 * statement runs in the caller's ambient tenant UoW; the variance POSTS
 * ride the movement core (planIssue/planReceipt with CYCLE_COUNT_*
 * reasons — the G-13/G-14 reuse note) so INV-029's same-transaction law
 * holds at approval; this store never writes item_stock itself.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("cycle-count access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- schedules (§2.6) ------------------------------------------------------------

export interface CycleCountScheduleRow {
  id: string;
  warehouseId: string;
  warehouseCode: string | null;
  name: string;
  classADays: number;
  classBDays: number;
  classCDays: number;
  approvalThreshold: string;
  blind: boolean;
  isActive: boolean;
  lastRunAt: string | null;
  note: string | null;
}

export async function listSchedules(filter: {
  warehouseId?: string;
  activeOnly?: boolean;
  limit: number;
}): Promise<CycleCountScheduleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
      s.name, s.class_a_days AS "classADays", s.class_b_days AS "classBDays",
      s.class_c_days AS "classCDays", s.approval_threshold::text AS "approvalThreshold",
      s.blind, s.is_active AS "isActive", s.last_run_at AS "lastRunAt", s.note
    FROM cycle_count_schedules s
    LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = s.tenant_id
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR s.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.activeOnly ?? false}::boolean = false OR s.is_active)
    ORDER BY s.created_at DESC
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as CycleCountScheduleRow[];
}

export async function findScheduleById(id: string): Promise<CycleCountScheduleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
      s.name, s.class_a_days AS "classADays", s.class_b_days AS "classBDays",
      s.class_c_days AS "classCDays", s.approval_threshold::text AS "approvalThreshold",
      s.blind, s.is_active AS "isActive", s.last_run_at AS "lastRunAt", s.note
    FROM cycle_count_schedules s
    LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = s.tenant_id
    WHERE s.id = ${id}
    LIMIT 1
  `);
  return (rows.rows as unknown as CycleCountScheduleRow[])[0];
}

export async function insertSchedule(input: {
  warehouseId: string;
  name: string;
  classADays: number;
  classBDays: number;
  classCDays: number;
  approvalThreshold: string;
  blind: boolean;
  note: string | null;
  createdBy: string | null;
}): Promise<CycleCountScheduleRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO cycle_count_schedules (id, tenant_id, warehouse_id, name, class_a_days,
      class_b_days, class_c_days, approval_threshold, blind, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.warehouseId}, ${input.name},
      ${input.classADays}, ${input.classBDays}, ${input.classCDays},
      ${input.approvalThreshold}::numeric, ${input.blind}, ${input.note}, ${input.createdBy})
  `);
  return (await findScheduleById(id))!;
}

export async function updateSchedule(
  id: string,
  patch: {
    classADays?: number;
    classBDays?: number;
    classCDays?: number;
    approvalThreshold?: string;
    blind?: boolean;
    isActive?: boolean;
    note?: string | null;
  },
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE cycle_count_schedules SET
      class_a_days = COALESCE(${patch.classADays ?? null}, class_a_days),
      class_b_days = COALESCE(${patch.classBDays ?? null}, class_b_days),
      class_c_days = COALESCE(${patch.classCDays ?? null}, class_c_days),
      approval_threshold = COALESCE(${patch.approvalThreshold ?? null}::numeric, approval_threshold),
      blind = COALESCE(${patch.blind ?? null}, blind),
      is_active = COALESCE(${patch.isActive ?? null}, is_active),
      note = COALESCE(${patch.note ?? null}, note),
      updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

export async function touchScheduleRun(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE cycle_count_schedules SET last_run_at = now(), updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

// -- count documents + lines (§2.6) -------------------------------------------------

export interface CycleCountDocumentRow {
  id: string;
  countNo: string | null;
  scheduleId: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  status: string;
  snapshotAt: string;
  countDate: string | null;
  blind: boolean;
  varianceLossValue: string | null;
  varianceGainValue: string | null;
  supervisorOverride: boolean;
  countedBy: string | null;
  approvedBy: string | null;
  postedJournalId: string | null;
  note: string | null;
}

const DOC_COLUMNS = sql`d.id, d.count_no AS "countNo", d.schedule_id AS "scheduleId",
  d.warehouse_id AS "warehouseId", w.code AS "warehouseCode", d.status,
  d.snapshot_at AS "snapshotAt", d.count_date AS "countDate", d.blind,
  d.variance_loss_value::text AS "varianceLossValue",
  d.variance_gain_value::text AS "varianceGainValue",
  d.supervisor_override AS "supervisorOverride", d.counted_by AS "countedBy",
  d.approved_by AS "approvedBy", d.posted_journal_id AS "postedJournalId", d.note`;
const DOC_FROM = sql`cycle_count_documents d
  LEFT JOIN warehouses w ON w.id = d.warehouse_id AND w.tenant_id = d.tenant_id`;

export async function listCountDocuments(filter: {
  warehouseId?: string;
  scheduleId?: string;
  status?: string;
  limit: number;
}): Promise<CycleCountDocumentRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${DOC_COLUMNS} FROM ${DOC_FROM}
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR d.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.scheduleId ?? null}::uuid IS NULL OR d.schedule_id = ${filter.scheduleId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR d.status = ${filter.status ?? null})
    ORDER BY d.created_at DESC
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as CycleCountDocumentRow[];
}

export async function findCountDocumentById(id: string): Promise<CycleCountDocumentRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${DOC_COLUMNS} FROM ${DOC_FROM} WHERE d.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CycleCountDocumentRow[])[0];
}

export async function insertCountDocument(input: {
  scheduleId: string | null;
  warehouseId: string;
  blind: boolean;
  note: string | null;
  createdBy: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO cycle_count_documents (id, tenant_id, schedule_id, warehouse_id, status,
      snapshot_at, blind, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.scheduleId}, ${input.warehouseId},
      'DRAFT', now(), ${input.blind}, ${input.note}, ${input.createdBy})
  `);
  return id;
}

export interface CycleCountLineRow {
  id: string;
  documentId: string;
  lineNo: number;
  itemId: string;
  itemSku: string | null;
  binId: string | null;
  binCode: string | null;
  batchId: string | null;
  batchNo: string | null;
  systemQty: string;
  countedQty: string | null;
  recounted: boolean;
  recountNote: string | null;
  valueImpact: string | null;
  reason: string | null;
}

export async function insertCountLine(input: {
  documentId: string;
  lineNo: number;
  itemId: string;
  binId: string | null;
  batchId: string | null;
  systemQty: string;
  createdBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO cycle_count_lines (id, tenant_id, document_id, line_no, item_id, bin_id,
      batch_id, system_qty, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.documentId}, ${input.lineNo},
      ${input.itemId}, ${input.binId}, ${input.batchId}, ${input.systemQty}::numeric, ${input.createdBy})
  `);
}

export async function listCountLines(documentId: string): Promise<CycleCountLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.document_id AS "documentId", l.line_no AS "lineNo", l.item_id AS "itemId",
      i.sku AS "itemSku", l.bin_id AS "binId", b.code AS "binCode", l.batch_id AS "batchId",
      bt.batch_no AS "batchNo", l.system_qty::text AS "systemQty", l.counted_qty::text AS "countedQty",
      l.recounted, l.recount_note AS "recountNote", l.value_impact::text AS "valueImpact", l.reason
    FROM cycle_count_lines l
    LEFT JOIN items i ON i.id = l.item_id AND i.tenant_id = l.tenant_id
    LEFT JOIN warehouse_bins b ON b.id = l.bin_id AND b.tenant_id = l.tenant_id
    LEFT JOIN item_batches bt ON bt.id = l.batch_id AND bt.tenant_id = l.tenant_id
    WHERE l.document_id = ${documentId}
    ORDER BY l.line_no
  `);
  return rows.rows as unknown as CycleCountLineRow[];
}

export async function setCountedQty(input: {
  documentId: string;
  lineNo: number;
  countedQty: string;
  recounted: boolean;
  recountNote: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE cycle_count_lines
    SET counted_qty = ${input.countedQty}::numeric, recounted = ${input.recounted},
        recount_note = ${input.recountNote}, updated_at = now(), version = version + 1
    WHERE document_id = ${input.documentId} AND line_no = ${input.lineNo}
  `);
}

export async function setValueImpacts(input: {
  documentId: string;
  impacts: { lineNo: number; valueImpact: string; reason: string | null }[];
}): Promise<void> {
  for (const impact of input.impacts) {
    await tenantTx().execute(sql`
      UPDATE cycle_count_lines
      SET value_impact = ${impact.valueImpact}::numeric, reason = ${impact.reason},
          updated_at = now(), version = version + 1
      WHERE document_id = ${input.documentId} AND line_no = ${impact.lineNo}
    `);
  }
}

export async function markDocumentSubmitted(id: string, countedBy: string | null): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE cycle_count_documents SET status = 'COUNTED', counted_by = ${countedBy},
      updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'DRAFT'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function markDocumentUnderReview(input: {
  id: string;
  lossValue: string;
  gainValue: string;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE cycle_count_documents SET status = 'VARIANCE_REVIEW',
      variance_loss_value = ${input.lossValue}::numeric, variance_gain_value = ${input.gainValue}::numeric,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'COUNTED'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

/** A recount inside VARIANCE_REVIEW refreshes the loss/gain totals in
 * place (the status itself never moves). */
export async function refreshDocumentVariance(input: {
  id: string;
  lossValue: string;
  gainValue: string;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE cycle_count_documents SET
      variance_loss_value = ${input.lossValue}::numeric, variance_gain_value = ${input.gainValue}::numeric,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'VARIANCE_REVIEW'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function markDocumentPosted(input: {
  id: string;
  countNo: string;
  countDate: string;
  approvedBy: string | null;
  supervisorOverride: boolean;
  postedJournalId: string | null;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE cycle_count_documents SET status = 'POSTED', count_no = ${input.countNo},
      count_date = ${input.countDate}::date, approved_by = ${input.approvedBy},
      supervisor_override = ${input.supervisorOverride},
      posted_journal_id = ${input.postedJournalId}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'VARIANCE_REVIEW'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function cancelDocument(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE cycle_count_documents SET status = 'CANCELLED', updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'DRAFT'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

// -- ABC classifications (§2.7) ------------------------------------------------------

export interface AbcWindowRow {
  itemId: string;
  consumptionValue: string;
  totalQtyOut: string;
}

/** The consumption aggregate over the lookback window: OUT moves of kind
 * issue/adjust (picks, shrinkage, damage — transfers stay INSIDE the
 * company and never count as consumption). */
export async function consumptionByItem(windowDays: number): Promise<AbcWindowRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT m.item_id AS "itemId",
      SUM(m.value_amount)::text AS "consumptionValue",
      SUM(m.qty)::text AS "totalQtyOut"
    FROM stock_moves m
    JOIN items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
    WHERE m.direction = 'OUT' AND m.move_kind IN ('issue', 'adjust')
      AND i.kind = 'STOCK'
      AND m.moved_at >= now() - (${windowDays}::text || ' days')::interval
    GROUP BY m.item_id
    ORDER BY SUM(m.value_amount) DESC
  `);
  return rows.rows as unknown as AbcWindowRow[];
}

/** Every STOCK item of the tenant (zero-consumption items classify as C). */
export async function listStockItemIds(): Promise<string[]> {
  const rows = await tenantTx().execute<{ id: string }>(sql`
    SELECT id FROM items WHERE kind = 'STOCK' ORDER BY created_at, id
  `);
  return rows.rows.map((row) => row.id);
}

export async function demoteLatestClassifications(): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE abc_classifications SET is_latest = false, updated_at = now(), version = version + 1
    WHERE is_latest
  `);
}

export async function insertAbcRows(
  rows: {
    id: string;
    itemId: string;
    computedAt: string;
    windowDays: number;
    cls: string;
    consumptionValue: string;
    totalQtyOut: string;
    velocity: string;
    rankNo: number;
  }[],
  createdBy: string | null,
): Promise<void> {
  for (const row of rows) {
    await tenantTx().execute(sql`
      INSERT INTO abc_classifications (id, tenant_id, item_id, computed_at, window_days,
        "class", consumption_value, total_qty_out, velocity, rank_no, is_latest, created_by)
      VALUES (${row.id}, erp.current_tenant_id(), ${row.itemId}, ${row.computedAt}::timestamptz,
        ${row.windowDays}, ${row.cls}, ${row.consumptionValue}::numeric, ${row.totalQtyOut}::numeric,
        ${row.velocity}::numeric, ${row.rankNo}, true, ${createdBy})
    `);
  }
}

export interface AbcLatestRow {
  id: string;
  itemId: string;
  itemSku: string | null;
  windowDays: number;
  cls: string;
  consumptionValue: string;
  totalQtyOut: string;
  velocity: string;
  rankNo: number;
  computedAt: string;
}

export async function listLatestAbc(filter: { cls?: string; limit: number }): Promise<AbcLatestRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT a.id, a.item_id AS "itemId", i.sku AS "itemSku", a.window_days AS "windowDays",
      a."class" AS cls, a.consumption_value::text AS "consumptionValue",
      a.total_qty_out::text AS "totalQtyOut", a.velocity::text AS "velocity",
      a.rank_no AS "rankNo", a.computed_at AS "computedAt"
    FROM abc_classifications a
    LEFT JOIN items i ON i.id = a.item_id AND i.tenant_id = a.tenant_id
    WHERE a.is_latest AND (${filter.cls ?? null}::text IS NULL OR a."class" = ${filter.cls ?? null})
    ORDER BY a.rank_no
    LIMIT ${Math.min(filter.limit, 1000)}
  `);
  return rows.rows as unknown as AbcLatestRow[];
}

// -- the schedule run's due-date inputs ----------------------------------------------

/** The warehouse's stocked items (item_stock rows — the binless legacy
 * items ride here too; their count line lands bin-less). */
export async function stockedItemIds(warehouseId: string): Promise<{ itemId: string; qty: string }[]> {
  const rows = await tenantTx().execute(sql`
    SELECT item_id AS "itemId", qty::text AS qty FROM item_stock
    WHERE warehouse_id = ${warehouseId} AND qty > 0
    ORDER BY item_id
  `);
  return rows.rows as unknown as { itemId: string; qty: string }[];
}

/** Per (warehouse, item): the newest count_date among POSTED cycle-count
 * documents' lines (NULL = never counted in that warehouse). */
export async function lastCountedDates(
  warehouseId: string,
  itemIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (itemIds.length === 0) return result;
  // drizzle binds a raw JS array as ONE flattened param — the ARRAY[]
  // constructor with individually-bound literals is the injection-safe
  // shape (the wms-store precedent).
  const idArray = sql`ARRAY[${sql.join(
    itemIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;
  const rows = await tenantTx().execute<{ item_id: string; last_date: string | null }>(sql`
    SELECT l.item_id, MAX(d.count_date)::text AS last_date
    FROM cycle_count_lines l
    JOIN cycle_count_documents d ON d.id = l.document_id AND d.tenant_id = l.tenant_id
    WHERE d.warehouse_id = ${warehouseId} AND d.status = 'POSTED'
      AND l.item_id = ANY(${idArray})
    GROUP BY l.item_id
  `);
  for (const row of rows.rows as unknown as { item_id: string; last_date: string | null }[]) {
    if (row.last_date !== null) result.set(row.item_id, row.last_date);
  }
  return result;
}

/** The live (bin, batch) slots of an item in a warehouse — the count
 * sheet's line substrate (tenant-owned rows only; consignment stock is
 * the owner's, BR-076 — never on the tenant's count sheet). */
export async function binSlotsOfItem(
  warehouseId: string,
  itemId: string,
): Promise<{ binId: string; batchId: string | null; qty: string }[]> {
  const rows = await tenantTx().execute(sql`
    SELECT bin_id AS "binId", batch_id AS "batchId", SUM(qty)::text AS qty
    FROM bin_contents
    WHERE warehouse_id = ${warehouseId} AND item_id = ${itemId}
      AND owner_partner_id IS NULL AND qty > 0
    GROUP BY bin_id, batch_id
    ORDER BY bin_id, batch_id NULLS FIRST
  `);
  return rows.rows as unknown as { binId: string; batchId: string | null; qty: string }[];
}
