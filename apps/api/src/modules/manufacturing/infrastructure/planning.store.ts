import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-043 planning store (migrations 0074…0079): the ONLY writer of the
 * planning family — mps_entries, the BOM planning satellites
 * (bom_substitutions / bom_outputs / bill_of_resources — the DELETE grant
 * carries the DRAFT full-replace + the ACTIVE-BOR overlay replace), the
 * MRP engine family (mrp_runs / mrp_demand_lines / mrp_supply_lines /
 * mrp_suggestions — status lifecycles, no deletes: superseded rows stay
 * as audit trail), and the tolling pair (contract_mfg_orders /
 * contract_mfg_moves). Every statement runs in the caller's ambient tenant
 * UoW (INV-018 discipline).
 *
 * Cross-module READS (items, item_stock, bin_contents, stock_reservations,
 * sales_orders/lines, purchase_orders/lines, goods_receipt_lines,
 * production_orders, stock_transfers, item_batches, warehouses) are
 * read-only SELECTs on published tables — the sanctioned §6 read
 * precedent (the same ambient-tx shape manufacturing.store exposes); the
 * planning store never writes another module's rows. The two document-side
 * link stamps live with their owning stores (purchasing.store/
 * sales.store) — the one-writer law.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("planning access requires an ambient tenant scope");
  }
  return context.tx;
}

function newId(): string {
  return generateUuidV7();
}

// == lot-sizing catalog (the global read-only rules — 0078) =========================

export interface LotSizingRuleRow {
  code: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  paramRequired: string | null;
}

export async function listLotSizingRules(): Promise<LotSizingRuleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT code, name, name_ar AS "nameAr", description, description_ar AS "descriptionAr",
           param_required AS "paramRequired"
    FROM lot_sizing_rules ORDER BY code
  `);
  return rows.rows as unknown as LotSizingRuleRow[];
}

// == item planning policies (the items columns — read-only here) =====================

/** The planning-policy projection of an item (the 0074 columns + the
 * tracking facts the supply qualification consumes). */
export interface ItemPlanningRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  baseUomId: string;
  kind: string;
  status: string;
  trackBatch: boolean;
  hasExpiry: boolean;
  shelfLifeDays: number | null;
  leadTimeDays: number | null;
  safetyStockPolicy: string;
  safetyStockQty: string | null;
  ssServiceLevelPct: string | null;
  ssLookbackDays: number | null;
  lotSizingRule: string;
  fixedOrderQty: string | null;
  orderMultiple: string | null;
  periodSupplyBuckets: number | null;
  frozenFenceDays: number;
  slushyFenceDays: number;
}

const ITEM_PLANNING_COLUMNS = sql`i.id, i.sku, i.name, i.name_ar AS "nameAr", i.uom_id AS "baseUomId",
  i.kind, i.status, i.track_batch AS "trackBatch", i.has_expiry AS "hasExpiry",
  i.shelf_life_days AS "shelfLifeDays", i.lead_time_days AS "leadTimeDays",
  i.safety_stock_policy AS "safetyStockPolicy", i.safety_stock_qty::text AS "safetyStockQty",
  i.ss_service_level_pct::text AS "ssServiceLevelPct", i.ss_lookback_days AS "ssLookbackDays",
  i.lot_sizing_rule AS "lotSizingRule", i.fixed_order_qty::text AS "fixedOrderQty",
  i.order_multiple::text AS "orderMultiple", i.period_supply_buckets AS "periodSupplyBuckets",
  i.frozen_fence_days AS "frozenFenceDays", i.slushy_fence_days AS "slushyFenceDays"`;

export async function findItemPlanning(itemId: string): Promise<ItemPlanningRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ITEM_PLANNING_COLUMNS} FROM items i
    WHERE i.id = ${itemId} AND i.deleted_at IS NULL LIMIT 1
  `);
  return (rows.rows as unknown as ItemPlanningRow[])[0];
}

/** The AUTO safety-stock look-back: daily SHIPPED sales quantities per
 * item+warehouse over the window (delivered goods — the demand that
 * actually left; deterministically ordered). */
export async function listDailySalesDemands(
  itemId: string,
  warehouseId: string,
  lookbackDays: number,
  asOf: string,
): Promise<string[]> {
  const rows = await tenantTx().execute(sql`
    SELECT d.moved_at::date::text AS day, SUM(d.qty)::text AS qty
    FROM stock_moves d
    JOIN delivery_notes dn ON dn.id = d.source_id AND d.source_type = 'delivery_note'
    WHERE d.item_id = ${itemId} AND d.warehouse_id = ${warehouseId}
      AND d.direction = 'OUT' AND d.moved_at::date <= ${asOf}::date
      AND d.moved_at::date > (${asOf}::date - ${lookbackDays})
    GROUP BY 1 ORDER BY 1
  `);
  return (rows.rows as unknown as { day: string; qty: string }[]).map((row) => row.qty);
}

// == MPS entries (0074) ==============================================================

export interface MpsEntryRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  warehouseId: string;
  itemId: string;
  bucketStart: string;
  qty: string;
  uomId: string;
  status: string;
  lastEditReason: string | null;
  note: string | null;
  noteAr: string | null;
}

const MPS_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", warehouse_id AS "warehouseId", item_id AS "itemId",
  bucket_start::text AS "bucketStart", qty::text AS "qty", uom_id AS "uomId",
  status, last_edit_reason AS "lastEditReason", note, note_ar AS "noteAr"`;

export async function findMpsEntryById(id: string): Promise<MpsEntryRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MPS_COLUMNS} FROM mps_entries WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as MpsEntryRow[])[0];
}

export async function findMpsEntryBySlot(input: {
  warehouseId: string;
  itemId: string;
  bucketStart: string;
}): Promise<MpsEntryRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MPS_COLUMNS} FROM mps_entries
    WHERE warehouse_id = ${input.warehouseId} AND item_id = ${input.itemId}
      AND bucket_start = ${input.bucketStart} LIMIT 1
  `);
  return (rows.rows as unknown as MpsEntryRow[])[0];
}

export async function listMpsEntries(filter: {
  warehouseId?: string;
  itemId?: string;
  from?: string;
  to?: string;
  limit: number;
}): Promise<MpsEntryRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MPS_COLUMNS} FROM mps_entries
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
      AND (${filter.from ?? null}::date IS NULL OR bucket_start >= ${filter.from ?? null}::date)
      AND (${filter.to ?? null}::date IS NULL OR bucket_start <= ${filter.to ?? null}::date)
    ORDER BY bucket_start, item_id LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as MpsEntryRow[];
}

/** Upsert one slot (the unique (tenant, warehouse, item, bucket_start)):
 * an existing row updates qty/status/reason; a new one inserts. Returns
 * the final row. */
export async function upsertMpsEntry(input: {
  warehouseId: string;
  itemId: string;
  bucketStart: string;
  qty: string;
  uomId: string;
  status: string;
  lastEditReason: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<MpsEntryRow> {
  const tx = tenantTx();
  const id = newId();
  await tx.execute(sql`
    INSERT INTO mps_entries (id, tenant_id, created_by, warehouse_id, item_id, bucket_start,
                             qty, uom_id, status, last_edit_reason, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.warehouseId}, ${input.itemId},
            ${input.bucketStart}, ${input.qty}, ${input.uomId}, ${input.status},
            ${input.lastEditReason}, ${input.note}, ${input.noteAr})
    ON CONFLICT (tenant_id, warehouse_id, item_id, bucket_start) DO UPDATE SET
      qty = EXCLUDED.qty, uom_id = EXCLUDED.uom_id, status = EXCLUDED.status,
      last_edit_reason = EXCLUDED.last_edit_reason,
      note = CASE WHEN EXCLUDED.note IS NULL THEN mps_entries.note ELSE EXCLUDED.note END,
      note_ar = CASE WHEN EXCLUDED.note_ar IS NULL THEN mps_entries.note_ar ELSE EXCLUDED.note_ar END,
      version = mps_entries.version + 1, updated_at = now()
  `);
  const found = await findMpsEntryBySlot({
    warehouseId: input.warehouseId,
    itemId: input.itemId,
    bucketStart: input.bucketStart,
  });
  return found!;
}

// == BOM planning satellites (0075) ==================================================

export interface BomSubstitutionRow {
  id: string;
  bomLineId: string;
  componentItemId: string;
  substituteItemId: string;
  priority: number;
  note: string | null;
}

const BOM_SUBSTITUTION_COLUMNS = sql`s.id, s.bom_line_id AS "bomLineId",
  l.component_item_id AS "componentItemId", s.substitute_item_id AS "substituteItemId",
  s.priority, s.note`;

/** Substitutions of one BOM's lines, priority-ascending. */
export async function listBomSubstitutions(bomId: string): Promise<BomSubstitutionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BOM_SUBSTITUTION_COLUMNS} FROM bom_substitutions s
    JOIN bom_lines l ON l.id = s.bom_line_id
    WHERE l.bom_id = ${bomId} ORDER BY l.line_no, s.priority
  `);
  return rows.rows as unknown as BomSubstitutionRow[];
}

/** Full-replace the substitutions of a BOM (DELETE+INSERT — the DRAFT
 * full-replace discipline; the delete grant rides 0075). */
export async function replaceBomSubstitutions(
  bomId: string,
  rows: readonly {
    bomLineId: string;
    substituteItemId: string;
    priority: number;
    note: string | null;
  }[],
): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    DELETE FROM bom_substitutions s USING bom_lines l
    WHERE s.bom_line_id = l.id AND l.bom_id = ${bomId}
  `);
  for (const row of rows) {
    await tx.execute(sql`
      INSERT INTO bom_substitutions (id, tenant_id, bom_line_id, substitute_item_id, priority, note, created_by)
      VALUES (${newId()}, erp.current_tenant_id(), ${row.bomLineId}, ${row.substituteItemId},
              ${row.priority}, ${row.note ?? null}, NULL)
    `);
  }
}

export interface BomOutputRow {
  id: string;
  bomId: string;
  itemId: string;
  outputKind: string;
  allocationPct: string;
  qtyPerOutput: string;
  uomId: string;
  note: string | null;
}

const BOM_OUTPUT_COLUMNS = sql`id, bom_id AS "bomId", item_id AS "itemId",
  output_kind AS "outputKind", allocation_pct::text AS "allocationPct",
  qty_per_output::text AS "qtyPerOutput", uom_id AS "uomId", note`;

export async function listBomOutputs(bomId: string): Promise<BomOutputRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BOM_OUTPUT_COLUMNS} FROM bom_outputs WHERE bom_id = ${bomId} ORDER BY item_id
  `);
  return rows.rows as unknown as BomOutputRow[];
}

/** Full-replace the outputs of a BOM (DELETE+INSERT). */
export async function replaceBomOutputs(
  bomId: string,
  rows: readonly {
    itemId: string;
    outputKind: string;
    allocationPct: string;
    qtyPerOutput: string;
    uomId: string;
    note: string | null;
  }[],
): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`DELETE FROM bom_outputs WHERE bom_id = ${bomId}`);
  for (const row of rows) {
    await tx.execute(sql`
      INSERT INTO bom_outputs (id, tenant_id, bom_id, item_id, output_kind, allocation_pct,
                               qty_per_output, uom_id, note, created_by)
      VALUES (${newId()}, erp.current_tenant_id(), ${bomId}, ${row.itemId}, ${row.outputKind},
              ${row.allocationPct}, ${row.qtyPerOutput}, ${row.uomId}, ${row.note}, NULL)
    `);
  }
}

export interface BorRow {
  id: string;
  bomId: string;
  lineNo: number;
  resourceKind: string;
  workCenterId: string | null;
  itemId: string | null;
  consumptionFactor: string;
  note: string | null;
}

const BOR_COLUMNS = sql`id, bom_id AS "bomId", line_no AS "lineNo", resource_kind AS "resourceKind",
  work_center_id AS "workCenterId", item_id AS "itemId",
  consumption_factor::text AS "consumptionFactor", note`;

export async function listBillOfResources(bomId: string): Promise<BorRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BOR_COLUMNS} FROM bill_of_resources WHERE bom_id = ${bomId} ORDER BY line_no
  `);
  return rows.rows as unknown as BorRow[];
}

/** Full-replace the BOR of a BOM (DELETE+INSERT — editable on DRAFT and
 * ACTIVE BOMs alike: the overlay the rough-cut check reads at planning
 * time, 0075's note). */
export async function replaceBillOfResources(
  bomId: string,
  rows: readonly {
    lineNo: number;
    resourceKind: string;
    workCenterId: string | null;
    itemId: string | null;
    consumptionFactor: string;
    note: string | null;
  }[],
): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`DELETE FROM bill_of_resources WHERE bom_id = ${bomId}`);
  for (const row of rows) {
    await tx.execute(sql`
      INSERT INTO bill_of_resources (id, tenant_id, bom_id, line_no, resource_kind, work_center_id,
                                     item_id, consumption_factor, note, created_by)
      VALUES (${newId()}, erp.current_tenant_id(), ${bomId}, ${row.lineNo}, ${row.resourceKind},
              ${row.workCenterId}, ${row.itemId}, ${row.consumptionFactor}, ${row.note}, NULL)
    `);
  }
}

// == the BOM graph (the engine's ACTIVE-version read) ================================

/** One ACTIVE BOM node with its lines (the phantom flag riding). */
export interface GraphBom {
  bomId: string;
  itemId: string;
  yieldPct: string;
  lines: {
    lineId: string;
    componentItemId: string;
    qtyPerOutput: string;
    scrapPct: string;
    phantomFlag: boolean;
  }[];
}

/** Every ACTIVE BOM with its lines — the engine loads the graph once and
 * hands it to the pure kernel (deterministic: item_id, line_no order). */
export async function loadActiveBomGraph(): Promise<GraphBom[]> {
  const rows = await tenantTx().execute(sql`
    SELECT b.id AS "bomId", b.item_id AS "itemId", b.yield_pct::text AS "yieldPct",
           b.item_id || ':' || l.id AS "lineKey",
           l.id AS "lineId", l.component_item_id AS "componentItemId",
           l.qty_per_output::text AS "qtyPerOutput", l.scrap_pct::text AS "scrapPct",
           l.phantom_flag AS "phantomFlag"
    FROM bills_of_materials b JOIN bom_lines l ON l.bom_id = b.id
    WHERE b.status = 'ACTIVE'
    ORDER BY b.item_id, l.line_no
  `);
  const byBom = new Map<string, GraphBom>();
  for (const row of rows.rows as unknown as (GraphBom & {
    lineKey: string;
    lineId: string;
    componentItemId: string;
    qtyPerOutput: string;
    scrapPct: string;
    phantomFlag: boolean;
  })[]) {
    let node = byBom.get(row.bomId);
    if (node === undefined) {
      node = { bomId: row.bomId, itemId: row.itemId, yieldPct: row.yieldPct, lines: [] };
      byBom.set(row.bomId, node);
    }
    node.lines.push({
      lineId: row.lineId,
      componentItemId: row.componentItemId,
      qtyPerOutput: row.qtyPerOutput,
      scrapPct: row.scrapPct,
      phantomFlag: row.phantomFlag,
    });
  }
  return [...byBom.values()].sort((a, b) => (a.itemId < b.itemId ? -1 : 1));
}

/** Substitutions for a set of BOM line ids (line-id keyed). */
export async function loadSubstitutionsForLines(
  lineIds: readonly string[],
): Promise<Map<string, { substituteItemId: string; priority: number }[]>> {
  const out = new Map<string, { substituteItemId: string; priority: number }[]>();
  if (lineIds.length === 0) return out;
  const rows = await tenantTx().execute(sql`
    SELECT bom_line_id AS "bomLineId", substitute_item_id AS "substituteItemId", priority
    FROM bom_substitutions WHERE bom_line_id = ANY(${sql.raw(`ARRAY[${lineIds.map((id) => `'${id}'`).join(",")}]::uuid[]`)})
    ORDER BY bom_line_id, priority
  `);
  for (const row of rows.rows as unknown as {
    bomLineId: string;
    substituteItemId: string;
    priority: number;
  }[]) {
    const list = out.get(row.bomLineId) ?? [];
    list.push({ substituteItemId: row.substituteItemId, priority: row.priority });
    out.set(row.bomLineId, list);
  }
  return out;
}

// == MRP runs (0076) =================================================================

export interface MrpRunRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  runMode: string;
  bucketSize: string;
  horizonBuckets: number;
  warehouseId: string;
  asOfDate: string;
  scopeItemIds: string[];
  params: Record<string, unknown>;
  stats: Record<string, unknown> | null;
  errorCode: string | null;
  startedAt: string;
  completedAt: string | null;
  createdBy: string | null;
}

const MRP_RUN_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  status, run_mode AS "runMode", bucket_size AS "bucketSize", horizon_buckets AS "horizonBuckets",
  warehouse_id AS "warehouseId", as_of_date::text AS "asOfDate",
  scope_item_ids AS "scopeItemIds", params, stats, error_code AS "errorCode",
  started_at::text AS "startedAt", completed_at::text AS "completedAt", created_by AS "createdBy"`;

export async function insertMrpRun(input: {
  runMode: string;
  bucketSize: string;
  horizonBuckets: number;
  warehouseId: string;
  asOfDate: string;
  scopeItemIds: string[];
  params: Record<string, unknown>;
  actorId: string | null;
}): Promise<MrpRunRow> {
  const id = newId();
  await tenantTx().execute(sql`
    INSERT INTO mrp_runs (id, tenant_id, status, run_mode, bucket_size, horizon_buckets,
                          warehouse_id, as_of_date, scope_item_ids, params, created_by)
    VALUES (${id}, erp.current_tenant_id(), 'RUNNING', ${input.runMode}, ${input.bucketSize},
            ${input.horizonBuckets}, ${input.warehouseId}, ${input.asOfDate},
            ${JSON.stringify(input.scopeItemIds)}::jsonb, ${JSON.stringify(input.params)}::jsonb,
            ${input.actorId})
  `);
  return (await findMrpRunById(id))!;
}

export async function findMrpRunById(id: string): Promise<MrpRunRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MRP_RUN_COLUMNS} FROM mrp_runs WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as MrpRunRow[])[0];
}

export async function listMrpRuns(filter: {
  warehouseId?: string;
  status?: string;
  limit: number;
}): Promise<MrpRunRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MRP_RUN_COLUMNS} FROM mrp_runs
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as MrpRunRow[];
}

export async function patchMrpRun(input: {
  id: string;
  status?: string;
  stats?: Record<string, unknown>;
  errorCode?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE mrp_runs SET
      status = COALESCE(${input.status ?? null}, status),
      stats = CASE WHEN ${input.stats === undefined} THEN stats
                   ELSE ${input.stats === undefined ? null : JSON.stringify(input.stats)}::jsonb END,
      error_code = CASE WHEN ${input.errorCode === undefined} THEN error_code ELSE ${input.errorCode ?? null} END,
      completed_at = CASE WHEN ${input.status ?? null} IN ('COMPLETED', 'FAILED') THEN now()
                          ELSE completed_at END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// == MRP demand/supply lines (0076) ==================================================

export interface MrpDemandLineInsert {
  runId: string;
  warehouseId: string;
  itemId: string;
  bucketIndex: number;
  bucketStart: string;
  demandKind: string;
  qty: string;
  salesOrderLineId?: string | null;
  mpsEntryId?: string | null;
  parentItemId?: string | null;
  substitutedItemId?: string | null;
  substitutes?: unknown;
  note?: string | null;
}

export async function insertMrpDemandLines(rows: readonly MrpDemandLineInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const tx = tenantTx();
  for (const row of rows) {
    await tx.execute(sql`
      INSERT INTO mrp_demand_lines (id, tenant_id, run_id, warehouse_id, item_id, bucket_index,
                                    bucket_start, demand_kind, qty, sales_order_line_id, mps_entry_id,
                                    parent_item_id, substituted_item_id, substitutes, note)
      VALUES (${newId()}, erp.current_tenant_id(), ${row.runId}, ${row.warehouseId}, ${row.itemId},
              ${row.bucketIndex}, ${row.bucketStart}, ${row.demandKind}, ${row.qty},
              ${row.salesOrderLineId ?? null}, ${row.mpsEntryId ?? null}, ${row.parentItemId ?? null},
              ${row.substitutedItemId ?? null}, ${JSON.stringify(row.substitutes ?? [])}::jsonb,
              ${row.note ?? null})
      ON CONFLICT (tenant_id, run_id, item_id, bucket_index, demand_kind, parent_item_id) DO UPDATE SET
        qty = EXCLUDED.qty, version = mrp_demand_lines.version + 1, updated_at = now()
    `);
  }
}

export interface MrpDemandLineRow {
  id: string;
  runId: string;
  warehouseId: string;
  itemId: string;
  bucketIndex: number;
  bucketStart: string;
  demandKind: string;
  qty: string;
  salesOrderLineId: string | null;
  mpsEntryId: string | null;
  parentItemId: string | null;
  substitutedItemId: string | null;
  substitutes: unknown;
  note: string | null;
}

const MRP_DEMAND_COLUMNS = sql`id, run_id AS "runId", warehouse_id AS "warehouseId", item_id AS "itemId",
  bucket_index AS "bucketIndex", bucket_start::text AS "bucketStart", demand_kind AS "demandKind",
  qty::text AS "qty", sales_order_line_id AS "salesOrderLineId", mps_entry_id AS "mpsEntryId",
  parent_item_id AS "parentItemId", substituted_item_id AS "substitutedItemId", substitutes, note`;

export async function listMrpDemandLines(filter: {
  runId: string;
  itemId?: string;
}): Promise<MrpDemandLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MRP_DEMAND_COLUMNS} FROM mrp_demand_lines
    WHERE run_id = ${filter.runId}
      AND (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
    ORDER BY item_id, bucket_index, demand_kind
  `);
  return rows.rows as unknown as MrpDemandLineRow[];
}

export interface MrpSupplyLineInsert {
  runId: string;
  warehouseId: string;
  itemId: string;
  bucketIndex: number;
  bucketStart: string;
  supplyKind: string;
  qty: string;
  batchId?: string | null;
  expiresOn?: string | null;
  purchaseOrderId?: string | null;
  productionOrderId?: string | null;
  stockTransferId?: string | null;
  note?: string | null;
}

export async function insertMrpSupplyLines(rows: readonly MrpSupplyLineInsert[]): Promise<void> {
  if (rows.length === 0) return;
  const tx = tenantTx();
  for (const row of rows) {
    await tx.execute(sql`
      INSERT INTO mrp_supply_lines (id, tenant_id, run_id, warehouse_id, item_id, bucket_index,
                                    bucket_start, supply_kind, qty, batch_id, expires_on,
                                    purchase_order_id, production_order_id, stock_transfer_id, note)
      VALUES (${newId()}, erp.current_tenant_id(), ${row.runId}, ${row.warehouseId}, ${row.itemId},
              ${row.bucketIndex}, ${row.bucketStart}, ${row.supplyKind}, ${row.qty},
              ${row.batchId ?? null}, ${row.expiresOn ?? null}, ${row.purchaseOrderId ?? null},
              ${row.productionOrderId ?? null}, ${row.stockTransferId ?? null}, ${row.note ?? null})
    `);
  }
}

export interface MrpSupplyLineRow {
  id: string;
  runId: string;
  warehouseId: string;
  itemId: string;
  bucketIndex: number;
  bucketStart: string;
  supplyKind: string;
  qty: string;
  batchId: string | null;
  expiresOn: string | null;
  purchaseOrderId: string | null;
  productionOrderId: string | null;
  stockTransferId: string | null;
  note: string | null;
}

const MRP_SUPPLY_COLUMNS = sql`id, run_id AS "runId", warehouse_id AS "warehouseId", item_id AS "itemId",
  bucket_index AS "bucketIndex", bucket_start::text AS "bucketStart", supply_kind AS "supplyKind",
  qty::text AS "qty", batch_id AS "batchId", expires_on::text AS "expiresOn",
  purchase_order_id AS "purchaseOrderId", production_order_id AS "productionOrderId",
  stock_transfer_id AS "stockTransferId", note`;

export async function listMrpSupplyLines(filter: {
  runId: string;
  itemId?: string;
}): Promise<MrpSupplyLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MRP_SUPPLY_COLUMNS} FROM mrp_supply_lines
    WHERE run_id = ${filter.runId}
      AND (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
    ORDER BY item_id, bucket_index, supply_kind
  `);
  return rows.rows as unknown as MrpSupplyLineRow[];
}

// == MRP suggestions (0076) ==========================================================

export interface MrpSuggestionRow {
  id: string;
  runId: string;
  itemId: string;
  warehouseId: string;
  fromWarehouseId: string | null;
  suggestionType: string;
  qty: string;
  uomId: string | null;
  dueDate: string;
  releaseDate: string;
  frozenFence: boolean;
  status: string;
  substitutedItemId: string | null;
  bomId: string | null;
  netting: Record<string, unknown>;
  dismissedReason: string | null;
  convertedDocType: string | null;
  convertedDocId: string | null;
  acceptedAt: string | null;
  acceptedBy: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
  supersededAt: string | null;
  supersededByRunId: string | null;
  createdAt: string;
}

const MRP_SUGGESTION_COLUMNS = sql`id, run_id AS "runId", item_id AS "itemId",
  warehouse_id AS "warehouseId", from_warehouse_id AS "fromWarehouseId",
  suggestion_type AS "suggestionType", qty::text AS "qty", uom_id AS "uomId",
  due_date::text AS "dueDate", release_date::text AS "releaseDate", frozen_fence AS "frozenFence",
  status, substituted_item_id AS "substitutedItemId", bom_id AS "bomId", netting,
  dismissed_reason AS "dismissedReason", converted_doc_type AS "convertedDocType",
  converted_doc_id AS "convertedDocId", accepted_at::text AS "acceptedAt",
  accepted_by AS "acceptedBy", dismissed_at::text AS "dismissedAt", dismissed_by AS "dismissedBy",
  superseded_at::text AS "supersededAt", superseded_by_run_id AS "supersededByRunId",
  created_at::text AS "createdAt"`;

export async function findMrpSuggestionById(id: string): Promise<MrpSuggestionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MRP_SUGGESTION_COLUMNS} FROM mrp_suggestions WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as MrpSuggestionRow[])[0];
}

/**
 * The LOCKED read (the 043-audit item-3 fix): SELECT … FOR UPDATE inside
 * the caller's ambient UoW. The suggestion-conversion races (accept vs
 * accept, accept vs dismiss, accept vs the re-run supersede) serialize on
 * this lock: the second transaction blocks at the read until the first
 * commits, then sees the post-commit state (an ACCEPTED row replays its
 * stored document — INV-030's idempotent law — instead of creating a
 * second one; a DISMISSED/SUPERSEDED row is the typed state error). The
 * unique index on the converted document is the doc→suggestion anchor
 * (ONE document claimed by ONE suggestion) — it does NOT by itself
 * prevent two different documents for one suggestion; the lock and the
 * status guard do.
 */
export async function findMrpSuggestionByIdForUpdate(
  id: string,
): Promise<MrpSuggestionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MRP_SUGGESTION_COLUMNS} FROM mrp_suggestions WHERE id = ${id}
    LIMIT 1 FOR UPDATE
  `);
  return (rows.rows as unknown as MrpSuggestionRow[])[0];
}

export async function listMrpSuggestions(filter: {
  runId?: string;
  warehouseId?: string;
  itemId?: string;
  status?: string;
  suggestionType?: string;
  limit: number;
}): Promise<MrpSuggestionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MRP_SUGGESTION_COLUMNS} FROM mrp_suggestions
    WHERE (${filter.runId ?? null}::uuid IS NULL OR run_id = ${filter.runId ?? null})
      AND (${filter.warehouseId ?? null}::uuid IS NULL OR warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.suggestionType ?? null}::text IS NULL OR suggestion_type = ${filter.suggestionType ?? null})
    ORDER BY due_date, item_id LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as MrpSuggestionRow[];
}

export interface MrpSuggestionInsert {
  runId: string;
  itemId: string;
  warehouseId: string;
  fromWarehouseId: string | null;
  suggestionType: string;
  qty: string;
  uomId: string | null;
  dueDate: string;
  releaseDate: string;
  frozenFence: boolean;
  substitutedItemId: string | null;
  bomId: string | null;
  netting: Record<string, unknown>;
  actorId: string | null;
}

export async function insertMrpSuggestions(
  rows: readonly MrpSuggestionInsert[],
): Promise<MrpSuggestionRow[]> {
  const tx = tenantTx();
  const ids: string[] = [];
  for (const row of rows) {
    const id = newId();
    ids.push(id);
    await tx.execute(sql`
      INSERT INTO mrp_suggestions (id, tenant_id, run_id, item_id, warehouse_id, from_warehouse_id,
                                   suggestion_type, qty, uom_id, due_date, release_date, frozen_fence,
                                   substituted_item_id, bom_id, netting, created_by)
      VALUES (${id}, erp.current_tenant_id(), ${row.runId}, ${row.itemId}, ${row.warehouseId},
              ${row.fromWarehouseId}, ${row.suggestionType}, ${row.qty}, ${row.uomId}, ${row.dueDate},
              ${row.releaseDate}, ${row.frozenFence}, ${row.substitutedItemId}, ${row.bomId},
              ${JSON.stringify(row.netting)}::jsonb, ${row.actorId})
    `);
  }
  const found: MrpSuggestionRow[] = [];
  for (const id of ids) found.push((await findMrpSuggestionById(id))!);
  return found;
}

export async function patchMrpSuggestion(input: {
  id: string;
  status?: string;
  dismissedReason?: string | null;
  dismissedAt?: boolean;
  dismissedBy?: string | null;
  acceptedAt?: boolean;
  acceptedBy?: string | null;
  convertedDocType?: string | null;
  convertedDocId?: string | null;
  supersededAt?: boolean;
  supersededByRunId?: string | null;
  /** The optimistic guard (the 043-audit item-3 fix): the update only
   * lands while the row still carries this status; 0 rows updated → the
   * caller re-reads and replays/errors per the post-state. Belt-and-
   * braces behind the FOR UPDATE lock. */
  requireStatus?: string;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE mrp_suggestions SET
      status = COALESCE(${input.status ?? null}, status),
      dismissed_reason = CASE WHEN ${input.dismissedReason === undefined} THEN dismissed_reason
                              ELSE ${input.dismissedReason ?? null} END,
      converted_doc_type = CASE WHEN ${input.convertedDocType === undefined} THEN converted_doc_type
                                ELSE ${input.convertedDocType ?? null} END,
      converted_doc_id = CASE WHEN ${input.convertedDocId === undefined} THEN converted_doc_id
                              ELSE ${input.convertedDocId ?? null} END,
      dismissed_at = CASE WHEN ${input.dismissedAt === true} THEN now() ELSE dismissed_at END,
      dismissed_by = CASE WHEN ${input.dismissedBy === undefined || input.dismissedBy === null}
                          THEN dismissed_by ELSE ${input.dismissedBy ?? null} END,
      accepted_at = CASE WHEN ${input.acceptedAt === true} THEN now() ELSE accepted_at END,
      accepted_by = CASE WHEN ${input.acceptedBy === undefined || input.acceptedBy === null}
                         THEN accepted_by ELSE ${input.acceptedBy ?? null} END,
      superseded_at = CASE WHEN ${input.supersededAt === true} THEN now() ELSE superseded_at END,
      superseded_by_run_id = CASE WHEN ${input.supersededByRunId === undefined} THEN superseded_by_run_id
                                  ELSE ${input.supersededByRunId ?? null} END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
      AND (${input.requireStatus ?? null}::text IS NULL OR status = ${input.requireStatus ?? null})
    RETURNING id
  `);
  return (rows.rows as unknown as { id: string }[]).length > 0;
}

/** The re-run coverage netting: supersede every still-SUGGESTED
 * suggestion of the given (item, warehouse) pairs — the new run's
 * suggestions replace them (audit trail preserved; BR-079 lifecycle). */
export async function supersedeSuggestionsForItems(input: {
  itemWarehousePairs: readonly { itemId: string; warehouseId: string }[];
  supersededByRunId: string;
}): Promise<number> {
  if (input.itemWarehousePairs.length === 0) return 0;
  const rows = await tenantTx().execute(sql`
    UPDATE mrp_suggestions SET status = 'SUPERSEDED', superseded_at = now(),
                               superseded_by_run_id = ${input.supersededByRunId},
                               version = version + 1, updated_at = now()
    WHERE status = 'SUGGESTED' AND (item_id, warehouse_id) IN
      (${sql.join(
        input.itemWarehousePairs.map((pair) => sql`(${pair.itemId}, ${pair.warehouseId})`),
        sql`, `,
      )})
    RETURNING id
  `);
  return rows.rows.length;
}

// == the engine's supply/demand reads (cross-module SELECTs — the §6 precedent) =======

/** Firm sales demand: APPROVED/ISSUED sales orders at the warehouse with
 * UNRESERVED lines (reserved lines hold their stock through the
 * reservation — demanding them again would double-count; the INV-030
 * formula nets reservations on the supply side). */
export interface FirmSalesDemandRow {
  itemId: string;
  salesOrderLineId: string;
  demandDate: string;
  qty: string;
}

export async function listFirmSalesDemand(warehouseId: string): Promise<FirmSalesDemandRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.item_id AS "itemId", l.id AS "salesOrderLineId",
           COALESCE(o.expected_date, o.order_date)::text AS "demandDate", l.qty::text AS "qty"
    FROM sales_orders o JOIN sales_order_lines l ON l.order_id = o.id
    WHERE o.warehouse_id = ${warehouseId} AND o.status IN ('APPROVED', 'ISSUED')
      AND l.reservation_id IS NULL
    ORDER BY "demandDate", l.item_id
  `);
  return rows.rows as unknown as FirmSalesDemandRow[];
}

/** Open purchase-order supply: submitted-or-beyond POs of the warehouse's
 * BRANCH (POs carry no warehouse — the branch attribution is the
 * documented deterministic rule), net of goods-receipt quantities. */
export interface OpenPoSupplyRow {
  itemId: string;
  purchaseOrderId: string;
  expectedDate: string | null;
  remainingQty: string;
}

export async function listOpenPoSupply(warehouseId: string): Promise<OpenPoSupplyRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.item_id AS "itemId", o.id AS "purchaseOrderId",
           o.expected_date::text AS "expectedDate",
           (l.qty - COALESCE(r.received, 0))::text AS "remainingQty"
    FROM purchase_orders o
    JOIN purchase_order_lines l ON l.order_id = o.id
    JOIN warehouses w ON w.id = ${warehouseId} AND o.branch_id = w.branch_id
    LEFT JOIN (
      SELECT grl.po_line_id AS po_line_id, SUM(grl.qty) AS received
      FROM goods_receipt_lines grl JOIN goods_receipts gr ON gr.id = grl.receipt_id
      WHERE gr.status <> 'CANCELLED'
      GROUP BY grl.po_line_id
    ) r ON r.po_line_id = l.id
    WHERE o.status IN ('PENDING_APPROVAL', 'APPROVED', 'ISSUED')
      AND (l.qty - COALESCE(r.received, 0)) > 0
    ORDER BY o.expected_date, l.item_id
  `);
  return rows.rows as unknown as OpenPoSupplyRow[];
}

/** Open production-order supply: RELEASED/IN_PROGRESS orders whose FG
 * lands in this warehouse, remaining = planned − actual (COMPLETED orders
 * are already on-hand). */
export interface OpenMoSupplyRow {
  itemId: string;
  productionOrderId: string;
  plannedDate: string | null;
  remainingQty: string;
}

export async function listOpenMoSupply(warehouseId: string): Promise<OpenMoSupplyRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT p.item_id AS "itemId", p.id AS "productionOrderId",
           p.planned_date::text AS "plannedDate",
           (p.planned_qty - COALESCE(p.actual_qty, 0))::text AS "remainingQty"
    FROM production_orders p
    WHERE p.fg_warehouse_id = ${warehouseId} AND p.status IN ('RELEASED', 'IN_PROGRESS')
      AND (p.planned_qty - COALESCE(p.actual_qty, 0)) > 0
    ORDER BY p.planned_date, p.item_id
  `);
  return rows.rows as unknown as OpenMoSupplyRow[];
}

/** Inbound transfers: IN_TRANSIT toward the warehouse (the to-side). */
export interface InboundTransferRow {
  itemId: string;
  stockTransferId: string;
  qty: string;
}

export async function listInboundTransfers(warehouseId: string): Promise<InboundTransferRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.item_id AS "itemId", t.id AS "stockTransferId", l.qty::text AS "qty"
    FROM stock_transfers t JOIN stock_transfer_lines l ON l.transfer_id = t.id
    WHERE t.to_warehouse_id = ${warehouseId} AND t.status = 'IN_TRANSIT'
    ORDER BY l.item_id
  `);
  return rows.rows as unknown as InboundTransferRow[];
}

/** Co/by-product supply from open MOs: each open MO's BOM outputs × the
 * remaining main quantity (M-11 netting — planned co-products are supply
 * for the co-product item at the MO's planned date). */
export interface CoProductSupplyRow {
  itemId: string;
  productionOrderId: string;
  plannedDate: string | null;
  qty: string;
}

export async function listCoProductSupply(warehouseId: string): Promise<CoProductSupplyRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT bo.item_id AS "itemId", p.id AS "productionOrderId", p.planned_date::text AS "plannedDate",
           (bo.qty_per_output * (p.planned_qty - COALESCE(p.actual_qty, 0)))::text AS "qty"
    FROM production_orders p
    JOIN bills_of_materials b ON b.id = p.bom_id
    JOIN bom_outputs bo ON bo.bom_id = b.id
    WHERE p.fg_warehouse_id = ${warehouseId} AND p.status IN ('RELEASED', 'IN_PROGRESS')
      AND (p.planned_qty - COALESCE(p.actual_qty, 0)) > 0
    ORDER BY p.planned_date, bo.item_id
  `);
  return rows.rows as unknown as CoProductSupplyRow[];
}

/** Qualified on-hand per batch (the M-10 basis): AVAILABLE, tenant-owned
 * bin rows grouped per batch with the batch expiry riding; non-ACTIVE
 * batches (quarantined/written-off) never cover. For items with no binned
 * rows the fallback line (batch NULL) = item_stock − the binned tenant-
 * owned portion — documented in the engine service. */
export interface QualifiedOnHandRow {
  itemId: string;
  batchId: string | null;
  expiresOn: string | null;
  qty: string;
}

export async function listQualifiedOnHand(warehouseId: string): Promise<QualifiedOnHandRow[]> {
  const rows = await tenantTx().execute(sql`
    WITH binned AS (
      SELECT bc.item_id, bc.batch_id, ib.expiry_date::text AS expires_on, SUM(bc.qty) AS qty
      FROM bin_contents bc
      LEFT JOIN item_batches ib ON ib.id = bc.batch_id
      WHERE bc.warehouse_id = ${warehouseId} AND bc.owner_partner_id IS NULL
        AND bc.status = 'AVAILABLE' AND bc.qty > 0
        AND (bc.batch_id IS NULL OR ib.status = 'ACTIVE')
      GROUP BY bc.item_id, bc.batch_id, ib.expiry_date
    ),
    binned_total AS (
      SELECT bc.item_id, SUM(bc.qty) AS qty
      FROM bin_contents bc
      WHERE bc.warehouse_id = ${warehouseId} AND bc.owner_partner_id IS NULL
      GROUP BY bc.item_id
    )
    SELECT binned.item_id AS "itemId", binned.batch_id AS "batchId", binned.expires_on AS "expiresOn",
           binned.qty::text AS "qty"
    FROM binned
    UNION ALL
    SELECT s.item_id AS "itemId", NULL::uuid AS "batchId", NULL::text AS "expiresOn",
           GREATEST(s.qty - COALESCE(t.qty, 0), 0)::text AS "qty"
    FROM item_stock s
    LEFT JOIN binned_total t ON t.item_id = s.item_id
    WHERE s.warehouse_id = ${warehouseId}
      AND GREATEST(s.qty - COALESCE(t.qty, 0), 0) > 0
      AND NOT EXISTS (SELECT 1 FROM binned WHERE binned.item_id = s.item_id AND binned.batch_id IS NULL)
    ORDER BY "itemId", "batchId"
  `);
  return rows.rows as unknown as QualifiedOnHandRow[];
}

/** ACTIVE, non-expired reservations per (item, warehouse) — the RESERVED
 * supply rows (the netting subtracts them: the formula's (on-hand −
 * reserved) term). */
export async function listActiveReservations(warehouseId: string): Promise<
  { itemId: string; qty: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT item_id AS "itemId", SUM(qty)::text AS "qty"
    FROM stock_reservations
    WHERE warehouse_id = ${warehouseId} AND status = 'ACTIVE'
      AND (expires_at IS NULL OR expires_at > now())
    GROUP BY item_id ORDER BY item_id
  `);
  return rows.rows as unknown as { itemId: string; qty: string }[];
}

/** In-flight converted suggestions whose documents are NOT yet open
 * supply (PO/MO/transfer still DRAFT) — the SUGGESTED_RECEIPT coverage
 * netting rows (re-runs must not re-suggest an accepted-but-not-yet-open
 * order — INV-030's no-double-order law). */
export async function listInFlightConvertedSuggestions(warehouseId: string): Promise<
  { itemId: string; qty: string; suggestionType: string; dueDate: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT s.item_id AS "itemId", SUM(s.qty)::text AS "qty", s.suggestion_type AS "suggestionType",
           MIN(s.due_date)::text AS "dueDate"
    FROM mrp_suggestions s
    LEFT JOIN purchase_orders po ON po.id = s.converted_doc_id AND s.converted_doc_type = 'purchase_order'
    LEFT JOIN production_orders mo ON mo.id = s.converted_doc_id AND s.converted_doc_type = 'production_order'
    LEFT JOIN stock_transfers tr ON tr.id = s.converted_doc_id AND s.converted_doc_type = 'stock_transfer'
    WHERE s.warehouse_id = ${warehouseId} AND s.status = 'ACCEPTED'
      AND ( (s.converted_doc_type = 'purchase_order' AND po.status = 'DRAFT')
         OR (s.converted_doc_type = 'production_order' AND mo.status = 'DRAFT')
         OR (s.converted_doc_type = 'stock_transfer' AND tr.status = 'DRAFT') )
    GROUP BY s.item_id, s.suggestion_type ORDER BY s.item_id
  `);
  return rows.rows as unknown as { itemId: string; qty: string; suggestionType: string; dueDate: string }[];
}

/** The derived REGENERATIVE scope: STOCK items with ANY planning signal
 * at the warehouse (qualified on-hand, firm sales demand, MPS entries,
 * open PO/MO/transfer supply) — the union is the honest "everything this
 * warehouse plans". */
export async function deriveScopeItems(warehouseId: string): Promise<string[]> {
  const rows = await tenantTx().execute(sql`
    SELECT DISTINCT i.id
    FROM items i
    WHERE i.kind = 'STOCK' AND i.status = 'ACTIVE' AND i.deleted_at IS NULL
      AND (
        EXISTS (SELECT 1 FROM item_stock s WHERE s.item_id = i.id AND s.warehouse_id = ${warehouseId} AND s.qty <> 0)
        OR EXISTS (SELECT 1 FROM mps_entries m WHERE m.item_id = i.id AND m.warehouse_id = ${warehouseId})
        OR EXISTS (
          SELECT 1 FROM sales_orders o JOIN sales_order_lines l ON l.order_id = o.id
          WHERE o.warehouse_id = ${warehouseId} AND o.status IN ('APPROVED','ISSUED')
            AND l.item_id = i.id AND l.reservation_id IS NULL)
        OR EXISTS (
          SELECT 1 FROM production_orders p
          WHERE p.fg_warehouse_id = ${warehouseId} AND p.status IN ('RELEASED','IN_PROGRESS')
            AND p.item_id = i.id)
        OR EXISTS (SELECT 1 FROM bom_outputs bo JOIN bills_of_materials b ON b.id = bo.bom_id
                   JOIN production_orders p ON p.bom_id = b.id
                   WHERE p.fg_warehouse_id = ${warehouseId}
                     AND p.status IN ('RELEASED','IN_PROGRESS') AND bo.item_id = i.id)
      )
    ORDER BY i.id
  `);
  return (rows.rows as unknown as { id: string }[]).map((row) => row.id);
}

/** Cross-warehouse transfer candidacy: the SURPLUS at every other
 * warehouse (qualified AVAILABLE tenant-owned bins + the unbinned
 * fallback − ACTIVE reservations) for one item — the TRANSFER
 * suggestion's from-warehouse pick (the largest surplus wins). */
export async function listWarehouseSurpluses(itemId: string): Promise<
  { warehouseId: string; surplusQty: string }[]
> {
  const rows = await tenantTx().execute(sql`
    WITH binned AS (
      SELECT bc.warehouse_id, SUM(bc.qty) AS qty
      FROM bin_contents bc
      LEFT JOIN item_batches ib ON ib.id = bc.batch_id
      WHERE bc.item_id = ${itemId} AND bc.owner_partner_id IS NULL
        AND bc.status = 'AVAILABLE' AND bc.qty > 0
        AND (bc.batch_id IS NULL OR ib.status = 'ACTIVE')
      GROUP BY bc.warehouse_id
    ),
    binned_total AS (
      SELECT bc.warehouse_id, SUM(bc.qty) AS qty
      FROM bin_contents bc
      WHERE bc.item_id = ${itemId} AND bc.owner_partner_id IS NULL
      GROUP BY bc.warehouse_id
    ),
    available AS (
      SELECT w.id AS warehouse_id,
             COALESCE(b.qty, 0) + GREATEST(COALESCE(s.qty, 0) - COALESCE(t.qty, 0), 0) AS qty
      FROM warehouses w
      LEFT JOIN binned b ON b.warehouse_id = w.id
      LEFT JOIN binned_total t ON t.warehouse_id = w.id
      LEFT JOIN item_stock s ON s.item_id = ${itemId} AND s.warehouse_id = w.id
      WHERE w.is_active = true
    ),
    reserved AS (
      SELECT warehouse_id, SUM(qty) AS qty FROM stock_reservations
      WHERE item_id = ${itemId} AND status = 'ACTIVE'
        AND (expires_at IS NULL OR expires_at > now())
      GROUP BY warehouse_id
    )
    SELECT a.warehouse_id AS "warehouseId",
           GREATEST(a.qty - COALESCE(r.qty, 0), 0)::text AS "surplusQty"
    FROM available a LEFT JOIN reserved r ON r.warehouse_id = a.warehouse_id
    WHERE GREATEST(a.qty - COALESCE(r.qty, 0), 0) > 0
    ORDER BY "surplusQty" DESC, a.warehouse_id
  `);
  return rows.rows as unknown as { warehouseId: string; surplusQty: string }[];
}

/** One sales order line read (the MTO link validation — read-only on the
 * sales module's published table, the §6 precedent). */
export async function findSalesOrderLine(lineId: string): Promise<
  | {
      id: string;
      orderId: string;
      itemId: string;
      qty: string;
      reservationId: string | null;
      promisedDate: string | null;
      atpStatus: string | null;
      atpSuggestedDate: string | null;
    }
  | undefined
> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.order_id AS "orderId", l.item_id AS "itemId", l.qty::text AS "qty",
           l.reservation_id AS "reservationId", l.promised_date::text AS "promisedDate",
           l.atp_status AS "atpStatus", l.atp_suggested_date::text AS "atpSuggestedDate"
    FROM sales_order_lines l WHERE l.id = ${lineId} LIMIT 1
  `);
  return (rows.rows as unknown as {
    id: string;
    orderId: string;
    itemId: string;
    qty: string;
    reservationId: string | null;
    promisedDate: string | null;
    atpStatus: string | null;
    atpSuggestedDate: string | null;
  }[])[0];
}

// == tolling (0077) ==================================================================

export interface ContractMfgOrderRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  tollingNo: string | null;
  processorPartnerId: string;
  itemId: string;
  bomId: string;
  warehouseId: string;
  plannedQty: string;
  uomId: string;
  status: string;
  feePoId: string | null;
  conversionFee: string | null;
  expectedReturnDate: string | null;
  note: string | null;
  noteAr: string | null;
  issuedAt: string | null;
  returnedAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

const TOLLING_ORDER_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  tolling_no AS "tollingNo", processor_partner_id AS "processorPartnerId", item_id AS "itemId",
  bom_id AS "bomId", warehouse_id AS "warehouseId", planned_qty::text AS "plannedQty",
  uom_id AS "uomId", status, fee_po_id AS "feePoId", conversion_fee::text AS "conversionFee",
  expected_return_date::text AS "expectedReturnDate", note, note_ar AS "noteAr",
  issued_at::text AS "issuedAt", returned_at::text AS "returnedAt", settled_at::text AS "settledAt",
  cancelled_at::text AS "cancelledAt", cancel_reason AS "cancelReason"`;

export async function findContractMfgOrderById(id: string): Promise<ContractMfgOrderRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TOLLING_ORDER_COLUMNS} FROM contract_mfg_orders WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ContractMfgOrderRow[])[0];
}

export async function listContractMfgOrders(filter: {
  status?: string;
  processorPartnerId?: string;
  limit: number;
}): Promise<ContractMfgOrderRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TOLLING_ORDER_COLUMNS} FROM contract_mfg_orders
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.processorPartnerId ?? null}::uuid IS NULL
           OR processor_partner_id = ${filter.processorPartnerId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ContractMfgOrderRow[];
}

export async function insertContractMfgOrder(input: {
  processorPartnerId: string;
  itemId: string;
  bomId: string;
  warehouseId: string;
  plannedQty: string;
  uomId: string;
  expectedReturnDate: string | null;
  conversionFee: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<ContractMfgOrderRow> {
  const id = newId();
  await tenantTx().execute(sql`
    INSERT INTO contract_mfg_orders (id, tenant_id, created_by, processor_partner_id, item_id,
                                     bom_id, warehouse_id, planned_qty, uom_id, conversion_fee,
                                     expected_return_date, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.processorPartnerId},
            ${input.itemId}, ${input.bomId}, ${input.warehouseId}, ${input.plannedQty}, ${input.uomId},
            ${input.conversionFee}, ${input.expectedReturnDate}, ${input.note}, ${input.noteAr})
  `);
  return (await findContractMfgOrderById(id))!;
}

export async function patchContractMfgOrder(input: {
  id: string;
  status?: string;
  tollingNo?: string | null;
  feePoId?: string | null;
  conversionFee?: string | null;
  issuedAt?: boolean;
  returnedAt?: boolean;
  settledAt?: boolean;
  cancelledAt?: boolean;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE contract_mfg_orders SET
      status = COALESCE(${input.status ?? null}, status),
      tolling_no = CASE WHEN ${input.tollingNo === undefined} THEN tolling_no ELSE ${input.tollingNo ?? null} END,
      fee_po_id = CASE WHEN ${input.feePoId === undefined} THEN fee_po_id ELSE ${input.feePoId ?? null} END,
      conversion_fee = CASE WHEN ${input.conversionFee === undefined} THEN conversion_fee
                            ELSE ${input.conversionFee ?? null} END,
      issued_at = CASE WHEN ${input.issuedAt === true} THEN now() ELSE issued_at END,
      returned_at = CASE WHEN ${input.returnedAt === true} THEN now() ELSE returned_at END,
      settled_at = CASE WHEN ${input.settledAt === true} THEN now() ELSE settled_at END,
      cancelled_at = CASE WHEN ${input.cancelledAt === true} THEN now() ELSE cancelled_at END,
      cancel_reason = CASE WHEN ${input.cancelReason === undefined} THEN cancel_reason
                           ELSE ${input.cancelReason ?? null} END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

export interface ContractMfgMoveRow {
  id: string;
  orderId: string;
  moveKind: string;
  itemId: string;
  qty: string;
  unitCost: string | null;
  valueAmount: string | null;
  batchId: string | null;
  stockMoveId: string | null;
  journalId: string | null;
  movedAt: string;
  note: string | null;
}

const TOLLING_MOVE_COLUMNS = sql`id, order_id AS "orderId", move_kind AS "moveKind", item_id AS "itemId",
  qty::text AS "qty", unit_cost::text AS "unitCost", value_amount::text AS "valueAmount",
  batch_id AS "batchId", stock_move_id AS "stockMoveId", journal_id AS "journalId",
  moved_at::text AS "movedAt", note`;

export async function insertContractMfgMove(input: {
  orderId: string;
  moveKind: string;
  itemId: string;
  qty: string;
  unitCost: string | null;
  valueAmount: string | null;
  batchId: string | null;
  stockMoveId: string | null;
  journalId: string | null;
  note: string | null;
  actorId: string | null;
}): Promise<ContractMfgMoveRow> {
  const id = newId();
  await tenantTx().execute(sql`
    INSERT INTO contract_mfg_moves (id, tenant_id, order_id, move_kind, item_id, qty, unit_cost,
                                    value_amount, batch_id, stock_move_id, journal_id, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.orderId}, ${input.moveKind}, ${input.itemId},
            ${input.qty}, ${input.unitCost}, ${input.valueAmount}, ${input.batchId}, ${input.stockMoveId},
            ${input.journalId}, ${input.note}, ${input.actorId})
  `);
  const rows = await tenantTx().execute(sql`
    SELECT ${TOLLING_MOVE_COLUMNS} FROM contract_mfg_moves WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ContractMfgMoveRow[])[0]!;
}

export async function listContractMfgMoves(orderId: string): Promise<ContractMfgMoveRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TOLLING_MOVE_COLUMNS} FROM contract_mfg_moves
    WHERE order_id = ${orderId} ORDER BY moved_at, id
  `);
  return rows.rows as unknown as ContractMfgMoveRow[];
}

/** The stock-at-processor value ledger: Σ by move kind (the settlement
 * invariant's terms — Σ ISSUE value = Σ RETURN_FINISHED + Σ
 * RETURN_MATERIAL + Σ YIELD_LOSS at G-48's settle gate). */
export async function sumContractMfgValues(orderId: string): Promise<
  Record<"ISSUE_TO_PROCESSOR" | "RETURN_FINISHED" | "RETURN_MATERIAL" | "YIELD_LOSS", string>
> {
  const rows = await tenantTx().execute(sql`
    SELECT move_kind AS kind, COALESCE(SUM(value_amount), 0)::text AS total
    FROM contract_mfg_moves WHERE order_id = ${orderId}
    GROUP BY move_kind
  `);
  const out = {
    ISSUE_TO_PROCESSOR: "0",
    RETURN_FINISHED: "0",
    RETURN_MATERIAL: "0",
    YIELD_LOSS: "0",
  } as Record<"ISSUE_TO_PROCESSOR" | "RETURN_FINISHED" | "RETURN_MATERIAL" | "YIELD_LOSS", string>;
  for (const row of rows.rows as unknown as { kind: string; total: string }[]) {
    if (row.kind in out) out[row.kind as keyof typeof out] = row.total;
  }
  return out;
}

/** The sales order header read for the MTO link's warehouse contract
 * (043-audit item 4) — the manufacturing-side mirror of
 * findSalesOrderLine: the planning module reads the sales surface through
 * its own thin, named queries (never the sales store). */
export async function findSalesOrderById(orderId: string): Promise<
  | { id: string; warehouseId: string; status: string; customerId: string }
  | undefined
> {
  const rows = await tenantTx().execute(sql`
    SELECT o.id, o.warehouse_id AS "warehouseId", o.status, o.customer_id AS "customerId"
    FROM sales_orders o WHERE o.id = ${orderId} LIMIT 1
  `);
  return (rows.rows as unknown as {
    id: string;
    warehouseId: string;
    status: string;
    customerId: string;
  }[])[0];
}
