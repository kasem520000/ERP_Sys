import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Manufacturing store (PHASE-018 T38a): the ONLY writer of the
 * manufacturing-owned `bills_of_materials` + `bom_lines` tables (migration
 * 0026; drizzle exports `billsOfMaterials`/`bomLines`). Every statement runs
 * in the caller's ambient tenant UoW so a failure anywhere rolls the whole
 * business operation back (INV-018 discipline). The BOM slice never posts a
 * journal — recipe maintenance is planning data (CAPABILITY_MATRIX §2.4
 * shape); only production orders (T38b) reach the posting engine.
 *
 * `bom_lines` is the one manufacturing table carrying a DELETE grant for the
 * DRAFT full-replace (0026 grant model — replaceBomLines is DELETE+INSERT,
 * unlike job-card lines which tombstone for the same effect).
 *
 * Cross-module reads (items, uoms) are read-only SELECTs on published tables
 * — the sanctioned §6 read precedent (the same ambient-tx shape
 * inventory.store exposes); manufacturing never writes another module's rows.
 *
 * Organization: bom header → bom lines → cross-module reads → production
 * orders (T38b appends its order slice at the bottom banner below, keeping
 * this file the single manufacturing-owned writer).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("manufacturing access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- bom headers (T38a) ------------------------------------------------------------

export interface BomRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  itemId: string;
  versionNo: number;
  status: string;
  outputUomId: string;
  yieldPct: string;
  effectiveFrom: string | null;
  note: string | null;
  noteAr: string | null;
  activatedAt: string | null;
  archivedAt: string | null;
}

const BOM_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", item_id AS "itemId", version_no AS "versionNo", status,
  output_uom_id AS "outputUomId", yield_pct::text AS "yieldPct",
  effective_from::text AS "effectiveFrom", note, note_ar AS "noteAr",
  activated_at::text AS "activatedAt", archived_at::text AS "archivedAt"`;

/**
 * A component line as the store persists it (the service normalizes decimals
 * first). `uomId` is always the component item's base uom — the service fills
 * it from the validation read (per line: components may differ in base unit).
 */
export interface BomLineInsert {
  /** Preserved id on a DRAFT full-replace (PUT); omitted → generated. */
  id?: string | null;
  componentItemId: string;
  uomId: string;
  qtyPerOutput: string;
  scrapPct: string;
  note: string | null;
  noteAr: string | null;
}

export interface BomLineRow {
  id: string;
  bomId: string;
  lineNo: number;
  componentItemId: string;
  uomId: string;
  qtyPerOutput: string;
  scrapPct: string;
  note: string | null;
  noteAr: string | null;
}

export async function insertBom(input: {
  itemId: string;
  versionNo: number;
  status: string;
  outputUomId: string;
  yieldPct: string;
  effectiveFrom: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  lines: readonly BomLineInsert[];
}): Promise<BomRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO bills_of_materials (id, tenant_id, created_by, item_id, version_no, status,
                                    output_uom_id, yield_pct, effective_from, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.itemId}, ${input.versionNo},
            ${input.status}, ${input.outputUomId}, ${input.yieldPct}, ${input.effectiveFrom},
            ${input.note}, ${input.noteAr})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await insertBomLine({
      bomId: id,
      lineNo,
      componentItemId: line.componentItemId,
      uomId: line.uomId,
      qtyPerOutput: line.qtyPerOutput,
      scrapPct: line.scrapPct,
      note: line.note,
      noteAr: line.noteAr,
      preservedId: line.id ?? null,
    });
  }
  return (await findBomById(id))!;
}

export async function findBomById(id: string): Promise<BomRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BOM_COLUMNS} FROM bills_of_materials WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as BomRow[])[0];
}

export async function listBoms(filter: {
  itemId?: string;
  status?: string;
  limit: number;
}): Promise<BomRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BOM_COLUMNS} FROM bills_of_materials
    WHERE (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY item_id, version_no DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as BomRow[];
}

/** Every version of one item's recipe, oldest first (version monotonically climbs). */
export async function listBomsForItem(itemId: string): Promise<BomRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BOM_COLUMNS} FROM bills_of_materials
    WHERE item_id = ${itemId}
    ORDER BY version_no
  `);
  return rows.rows as unknown as BomRow[];
}

/** The item's ACTIVE version (the partial unique index guarantees ≤ 1; the
 * ORDER BY is the belt-and-braces deterministic pick). */
export async function findActiveBom(itemId: string): Promise<BomRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BOM_COLUMNS} FROM bills_of_materials
    WHERE item_id = ${itemId} AND status = 'ACTIVE'
    ORDER BY version_no DESC
    LIMIT 1
  `);
  return (rows.rows as unknown as BomRow[])[0];
}

/**
 * The single header mutation point (status transitions + DRAFT field
 * patches). Absent values leave the column untouched (COALESCE semantics);
 * activated_at/archived_at stamp via CASE on the target status exactly once,
 * with the transition (patchJobCard pattern).
 */
export async function patchBom(input: {
  id: string;
  status?: string;
  outputUomId?: string;
  yieldPct?: string;
  effectiveFrom?: string | null;
  note?: string | null;
  noteAr?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE bills_of_materials SET
      status = COALESCE(${input.status ?? null}, status),
      output_uom_id = COALESCE(${input.outputUomId ?? null}, output_uom_id),
      yield_pct = COALESCE(${input.yieldPct ?? null}, yield_pct),
      effective_from = CASE WHEN ${input.effectiveFrom === undefined} THEN effective_from
                            ELSE ${input.effectiveFrom ?? null} END,
      note = CASE WHEN ${input.note === undefined} THEN note ELSE ${input.note ?? null} END,
      note_ar = CASE WHEN ${input.noteAr === undefined} THEN note_ar ELSE ${input.noteAr ?? null} END,
      activated_at = CASE WHEN ${input.status ?? null} = 'ACTIVE' THEN now() ELSE activated_at END,
      archived_at = CASE WHEN ${input.status ?? null} = 'ARCHIVED' THEN now() ELSE archived_at END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- bom lines (T38a; DELETE granted — the DRAFT full-replace) ----------------------

const BOM_LINE_COLUMNS = sql`id, bom_id AS "bomId", line_no AS "lineNo",
  component_item_id AS "componentItemId", uom_id AS "uomId",
  qty_per_output::text AS "qtyPerOutput", scrap_pct::text AS "scrapPct",
  note, note_ar AS "noteAr"`;

export async function listBomLines(bomId: string): Promise<BomLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BOM_LINE_COLUMNS} FROM bom_lines
    WHERE bom_id = ${bomId} ORDER BY line_no
  `);
  return rows.rows as unknown as BomLineRow[];
}

export async function findBomLineById(id: string): Promise<BomLineRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BOM_LINE_COLUMNS} FROM bom_lines WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as BomLineRow[])[0];
}

async function insertBomLine(
  line: {
    bomId: string;
    lineNo: number;
    componentItemId: string;
    uomId: string;
    qtyPerOutput: string;
    scrapPct: string;
    note: string | null;
    noteAr: string | null;
    preservedId: string | null;
  },
): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO bom_lines (id, tenant_id, bom_id, line_no, component_item_id, uom_id,
                           qty_per_output, scrap_pct, note, note_ar)
    VALUES (${line.preservedId ?? generateUuidV7()}, erp.current_tenant_id(), ${line.bomId},
            ${line.lineNo}, ${line.componentItemId}, ${line.uomId}, ${line.qtyPerOutput},
            ${line.scrapPct}, ${line.note}, ${line.noteAr})
  `);
}

/**
 * DRAFT full-replace (PUT :id): the provided array IS the live line set —
 * lines carrying an `id` keep that row id; lines without ids insert; the
 * previous set is DELETEd first (the 0026 DELETE grant exists for exactly
 * this — the job-card tombstone dance is unnecessary here).
 */
export async function replaceBomLines(bomId: string, lines: readonly BomLineInsert[]): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`DELETE FROM bom_lines WHERE bom_id = ${bomId}`);
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    await insertBomLine({
      bomId,
      lineNo,
      componentItemId: line.componentItemId,
      uomId: line.uomId,
      qtyPerOutput: line.qtyPerOutput,
      scrapPct: line.scrapPct,
      note: line.note,
      noteAr: line.noteAr,
      preservedId: line.id ?? null,
    });
  }
}

// -- cross-module reads (published tables; read-only §6 precedent) ------------------

/** The FG/component validation read: kind/status/base-uom in one row. */
export interface BomItemRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  kind: string;
  status: string;
  deletedAt: string | null;
  baseUomId: string;
}

export async function findItemForBom(id: string): Promise<BomItemRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT i.id, i.sku, i.name, i.name_ar AS "nameAr", i.kind, i.status,
           i.deleted_at::text AS "deletedAt", i.uom_id AS "baseUomId"
    FROM items i WHERE i.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as BomItemRow[])[0];
}

// ---------------------------------------------------------------------------
// Production orders + lines + consumptions + scraps (T38b): the order slice
// of this store appends BELOW this banner (same section style, one file per
// PHASE-018 handoff — see agent-ctx/T38a-3a-bom.md). T38a ships only the BOM
// surface above; no order statement exists yet.
// ---------------------------------------------------------------------------

// -- production orders (T38b; DRAFT → RELEASED → IN_PROGRESS → COMPLETED/CANCELLED) --

export interface ProductionOrderRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  branchId: string;
  /** NULL until release reserves + binds the PRD number (INV-021). */
  orderNo: string | null;
  status: string;
  /** The BOM version bound at release (input bomId ?? the item's ACTIVE). */
  bomId: string | null;
  itemId: string;
  uomId: string;
  plannedQty: string;
  plannedDate: string | null;
  actualQty: string;
  materialsWarehouseId: string;
  fgWarehouseId: string;
  laborRate: string;
  overheadRate: string;
  costCenterId: string | null;
  yieldSnapshot: string | null;
  fgBatchId: string | null;
  fgJournalId: string | null;
  fgValue: string;
  wipCreditValue: string;
  laborValue: string;
  overheadValue: string;
  note: string | null;
  noteAr: string | null;
  cancelReason: string | null;
  releasedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

const ORDER_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", branch_id AS "branchId", order_no AS "orderNo", status,
  bom_id AS "bomId", item_id AS "itemId", uom_id AS "uomId", planned_qty::text AS "plannedQty",
  planned_date::text AS "plannedDate", actual_qty::text AS "actualQty",
  materials_warehouse_id AS "materialsWarehouseId", fg_warehouse_id AS "fgWarehouseId",
  labor_rate::text AS "laborRate", overhead_rate::text AS "overheadRate",
  cost_center_id AS "costCenterId", yield_snapshot::text AS "yieldSnapshot",
  fg_batch_id AS "fgBatchId", fg_journal_id AS "fgJournalId", fg_value::text AS "fgValue",
  wip_credit_value::text AS "wipCreditValue", labor_value::text AS "laborValue",
  overhead_value::text AS "overheadValue", note, note_ar AS "noteAr",
  cancel_reason AS "cancelReason", released_at::text AS "releasedAt",
  started_at::text AS "startedAt", completed_at::text AS "completedAt",
  cancelled_at::text AS "cancelledAt"`;

export async function insertProductionOrder(input: {
  branchId: string;
  itemId: string;
  uomId: string;
  plannedQty: string;
  plannedDate: string | null;
  materialsWarehouseId: string;
  fgWarehouseId: string;
  laborRate: string;
  overheadRate: string;
  costCenterId: string | null;
  bomId: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<ProductionOrderRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO production_orders (id, tenant_id, created_by, branch_id, item_id, uom_id,
                                   planned_qty, planned_date, materials_warehouse_id,
                                   fg_warehouse_id, labor_rate, overhead_rate, cost_center_id,
                                   bom_id, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.branchId}, ${input.itemId},
            ${input.uomId}, ${input.plannedQty}, ${input.plannedDate}, ${input.materialsWarehouseId},
            ${input.fgWarehouseId}, ${input.laborRate}, ${input.overheadRate}, ${input.costCenterId},
            ${input.bomId}, ${input.note}, ${input.noteAr})
  `);
  return (await findProductionOrderById(id))!;
}

export async function findProductionOrderById(id: string): Promise<ProductionOrderRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ORDER_COLUMNS} FROM production_orders WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ProductionOrderRow[])[0];
}

export async function listProductionOrders(filter: {
  status?: string;
  itemId?: string;
  limit: number;
}): Promise<ProductionOrderRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ORDER_COLUMNS} FROM production_orders
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.itemId ?? null}::uuid IS NULL OR item_id = ${filter.itemId ?? null})
    ORDER BY created_at, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ProductionOrderRow[];
}

/**
 * The single order-header mutation point. Absent values leave the column
 * untouched (COALESCE semantics — the patchJobCard pattern); the lifecycle
 * timestamps stamp via CASE on the target status exactly once, with an
 * explicit-override arm for the deterministic completion date (the golden
 * chain pins completed_at to the input date, never now()).
 */
export async function patchProductionOrder(input: {
  id: string;
  status?: string;
  orderNo?: string;
  bomId?: string;
  yieldSnapshot?: string;
  actualQty?: string;
  fgBatchId?: string | null;
  fgJournalId?: string | null;
  fgValue?: string;
  wipCreditValue?: string;
  laborValue?: string;
  overheadValue?: string;
  cancelReason?: string;
  plannedQty?: string;
  plannedDate?: string | null;
  materialsWarehouseId?: string;
  fgWarehouseId?: string;
  laborRate?: string;
  overheadRate?: string;
  costCenterId?: string | null;
  itemId?: string;
  uomId?: string;
  note?: string | null;
  noteAr?: string | null;
  /** Explicit timestamptz override (ISO date) — wins over the CASE stamp. */
  completedAt?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE production_orders SET
      status = COALESCE(${input.status ?? null}, status),
      order_no = COALESCE(${input.orderNo ?? null}, order_no),
      bom_id = COALESCE(${input.bomId ?? null}, bom_id),
      yield_snapshot = COALESCE(${input.yieldSnapshot ?? null}, yield_snapshot),
      actual_qty = COALESCE(${input.actualQty ?? null}, actual_qty),
      fg_batch_id = COALESCE(${input.fgBatchId ?? null}, fg_batch_id),
      fg_journal_id = COALESCE(${input.fgJournalId ?? null}, fg_journal_id),
      fg_value = COALESCE(${input.fgValue ?? null}, fg_value),
      wip_credit_value = COALESCE(${input.wipCreditValue ?? null}, wip_credit_value),
      labor_value = COALESCE(${input.laborValue ?? null}, labor_value),
      overhead_value = COALESCE(${input.overheadValue ?? null}, overhead_value),
      cancel_reason = COALESCE(${input.cancelReason ?? null}, cancel_reason),
      planned_qty = COALESCE(${input.plannedQty ?? null}, planned_qty),
      planned_date = CASE WHEN ${input.plannedDate === undefined} THEN planned_date
                          ELSE ${input.plannedDate ?? null} END,
      materials_warehouse_id = COALESCE(${input.materialsWarehouseId ?? null}, materials_warehouse_id),
      fg_warehouse_id = COALESCE(${input.fgWarehouseId ?? null}, fg_warehouse_id),
      labor_rate = COALESCE(${input.laborRate ?? null}, labor_rate),
      overhead_rate = COALESCE(${input.overheadRate ?? null}, overhead_rate),
      cost_center_id = COALESCE(${input.costCenterId ?? null}, cost_center_id),
      item_id = COALESCE(${input.itemId ?? null}, item_id),
      uom_id = COALESCE(${input.uomId ?? null}, uom_id),
      note = CASE WHEN ${input.note === undefined} THEN note ELSE ${input.note ?? null} END,
      note_ar = CASE WHEN ${input.noteAr === undefined} THEN note_ar ELSE ${input.noteAr ?? null} END,
      released_at = CASE WHEN ${input.status ?? null} = 'RELEASED' THEN now() ELSE released_at END,
      started_at = CASE WHEN ${input.status ?? null} = 'IN_PROGRESS' THEN now() ELSE started_at END,
      completed_at = CASE WHEN ${input.completedAt !== undefined} THEN ${input.completedAt ?? null}::timestamptz
                          WHEN ${input.status ?? null} = 'COMPLETED' THEN now()
                          ELSE completed_at END,
      cancelled_at = CASE WHEN ${input.status ?? null} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- production order lines (T38b; the release-frozen level-1 snapshot) -------------

export interface ProductionOrderLineRow {
  id: string;
  orderId: string;
  lineNo: number;
  componentItemId: string;
  uomId: string;
  plannedQty: string;
  scrapPct: string;
  actualQty: string;
  overPlan: boolean;
  note: string | null;
  noteAr: string | null;
}

const ORDER_LINE_COLUMNS = sql`id, order_id AS "orderId", line_no AS "lineNo",
  component_item_id AS "componentItemId", uom_id AS "uomId", planned_qty::text AS "plannedQty",
  scrap_pct::text AS "scrapPct", actual_qty::text AS "actualQty", over_plan AS "overPlan",
  note, note_ar AS "noteAr"`;

export interface ProductionOrderLineInsert {
  componentItemId: string;
  uomId: string;
  plannedQty: string;
  scrapPct: string;
  note: string | null;
  noteAr: string | null;
}

/** The release snapshot: level-1 explosion lines, line_no 1..n in BOM order. */
export async function insertProductionOrderLines(
  orderId: string,
  lines: readonly ProductionOrderLineInsert[],
): Promise<void> {
  const tx = tenantTx();
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO production_order_lines (id, tenant_id, order_id, line_no, component_item_id,
                                          uom_id, planned_qty, scrap_pct, note, note_ar)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${orderId}, ${lineNo},
              ${line.componentItemId}, ${line.uomId}, ${line.plannedQty}, ${line.scrapPct},
              ${line.note}, ${line.noteAr})
    `);
  }
}

export async function listProductionOrderLines(orderId: string): Promise<ProductionOrderLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ORDER_LINE_COLUMNS} FROM production_order_lines
    WHERE order_id = ${orderId} ORDER BY line_no
  `);
  return rows.rows as unknown as ProductionOrderLineRow[];
}

/** Line mutation: cumulative actual_qty + the one-time over_plan flag. */
export async function patchProductionOrderLine(input: {
  id: string;
  actualQty?: string;
  overPlan?: boolean;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE production_order_lines SET
      actual_qty = COALESCE(${input.actualQty ?? null}, actual_qty),
      over_plan = COALESCE(${input.overPlan ?? null}, over_plan),
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- production consumptions (T38b; one row per consumed slice) ----------------------

export interface ProductionConsumptionRow {
  id: string;
  orderId: string;
  itemId: string;
  batchId: string | null;
  qty: string;
  unitCost: string;
  value: string;
  journalId: string | null;
  consumedAt: string;
  note: string | null;
  noteAr: string | null;
}

const CONSUMPTION_COLUMNS = sql`id, order_id AS "orderId", item_id AS "itemId",
  batch_id AS "batchId", qty::text AS "qty", unit_cost::text AS "unitCost", value::text AS "value",
  journal_id AS "journalId", consumed_at::text AS "consumedAt", note, note_ar AS "noteAr"`;

export async function insertProductionConsumptions(
  rows: readonly {
    orderId: string;
    itemId: string;
    batchId: string | null;
    qty: string;
    unitCost: string;
    value: string;
    journalId: string | null;
    consumedAt: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }[],
): Promise<void> {
  const tx = tenantTx();
  for (const row of rows) {
    await tx.execute(sql`
      INSERT INTO production_consumptions (id, tenant_id, created_by, order_id, item_id, batch_id,
                                            qty, unit_cost, value, journal_id, consumed_at, note, note_ar)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${row.actorId}, ${row.orderId},
              ${row.itemId}, ${row.batchId}, ${row.qty}, ${row.unitCost}, ${row.value},
              ${row.journalId}, ${row.consumedAt}::timestamptz, ${row.note}, ${row.noteAr})
    `);
  }
}

export async function listProductionConsumptions(orderId: string): Promise<ProductionConsumptionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CONSUMPTION_COLUMNS} FROM production_consumptions
    WHERE order_id = ${orderId} ORDER BY created_at, id
  `);
  return rows.rows as unknown as ProductionConsumptionRow[];
}

export async function countProductionConsumptions(orderId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM production_consumptions WHERE order_id = ${orderId}
  `);
  return (rows.rows as unknown as { n: number }[])[0]!.n;
}

/**
 * The order's running WIP balance as a canonical 4dp string:
 * Σ consumptions.value − Σ scraps.value − orders.wip_credit_value — the
 * running materials balance while IN_PROGRESS (wip_credit is 0), and
 * EXACTLY zero once completed (the completion journal credited WIP by
 * wip_credit_value). This is also the T38b-ii reconciliation's per-order
 * subledger side (MASTER-PLAN §11) — the seam is left clean for it.
 */
export async function sumOrderWip(orderId: string): Promise<string> {
  const rows = await tenantTx().execute<{ balance: string }>(sql`
    SELECT (COALESCE((SELECT sum(value) FROM production_consumptions WHERE order_id = ${orderId}), 0)
          - COALESCE((SELECT sum(value) FROM production_scraps WHERE order_id = ${orderId}), 0)
          - COALESCE((SELECT wip_credit_value FROM production_orders WHERE id = ${orderId}), 0))
           ::numeric(19,4)::text AS balance
  `);
  return rows.rows[0]!.balance;
}

// -- production scraps (T38b; reason-coded pre-completion WIP scrap) -----------------

export interface ProductionScrapRow {
  id: string;
  orderId: string;
  reasonCode: string;
  qty: string;
  value: string;
  journalId: string | null;
  scrappedAt: string;
  note: string | null;
  noteAr: string | null;
}

const SCRAP_COLUMNS = sql`id, order_id AS "orderId", reason_code AS "reasonCode",
  qty::text AS "qty", value::text AS "value", journal_id AS "journalId",
  scrapped_at::text AS "scrappedAt", note, note_ar AS "noteAr"`;

export async function insertProductionScrap(input: {
  orderId: string;
  reasonCode: string;
  qty: string;
  value: string;
  journalId: string | null;
  scrappedAt: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<ProductionScrapRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO production_scraps (id, tenant_id, created_by, order_id, reason_code, qty, value,
                                   journal_id, scrapped_at, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.orderId}, ${input.reasonCode},
            ${input.qty}, ${input.value}, ${input.journalId}, ${input.scrappedAt}::timestamptz,
            ${input.note}, ${input.noteAr})
  `);
  return (await findProductionScrapById(id))!;
}

export async function findProductionScrapById(id: string): Promise<ProductionScrapRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SCRAP_COLUMNS} FROM production_scraps WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ProductionScrapRow[])[0];
}

export async function listProductionScraps(orderId: string): Promise<ProductionScrapRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SCRAP_COLUMNS} FROM production_scraps
    WHERE order_id = ${orderId} ORDER BY created_at, id
  `);
  return rows.rows as unknown as ProductionScrapRow[];
}

export async function countProductionScraps(orderId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM production_scraps WHERE order_id = ${orderId}
  `);
  return (rows.rows as unknown as { n: number }[])[0]!.n;
}

// -- cross-module reads for the order slice (published items; read-only) -------------

/** The production FG/component read: kind/status/base-uom + the tracking and
 * shelf-life flags the completion flow needs (batch binding, expiry). */
export interface ProductionItemRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  kind: string;
  status: string;
  deletedAt: string | null;
  baseUomId: string;
  costingMethod: string;
  trackBatch: boolean;
  trackSerial: boolean;
  hasExpiry: boolean;
  shelfLifeDays: number | null;
}

export async function findItemForProduction(id: string): Promise<ProductionItemRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT i.id, i.sku, i.name, i.name_ar AS "nameAr", i.kind, i.status,
           i.deleted_at::text AS "deletedAt", i.uom_id AS "baseUomId",
           i.costing_method AS "costingMethod", i.track_batch AS "trackBatch",
           i.track_serial AS "trackSerial", i.has_expiry AS "hasExpiry",
           i.shelf_life_days AS "shelfLifeDays"
    FROM items i WHERE i.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ProductionItemRow[])[0];
}

// -- WIP reconciliation (T38b-ii; INV-010 extension, MASTER-PLAN §11) ------------------
//
// Read-only GL/subledger probes for ManufacturingReconciliationService.
// The control side reads journal_lines truth through the same as-of shape
// the inventory store's glBalanceAsOf uses (the proven INV-010 read); the
// subledger side is the per-order WIP balance (sumOrderWip's as-of variant —
// the completion credit only counts once completed_at is inside the window).

/** GL base balance as-of on one account (inventory's glBalanceAsOf read,
 * mirrored for the WIP control side — journal_lines truth, DEBIT − CREDIT). */
export async function wipGlBalanceAsOf(accountId: string, asOf: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0)::text AS balance
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE l.account_id = ${accountId}
      AND e.entry_date <= ${asOf}
  `);
  return (rows.rows as unknown as { balance: string }[])[0]!.balance;
}

export interface OrderWipBalanceRow {
  orderId: string;
  orderNo: string | null;
  status: string;
  /** Canonical 4dp: Σ in-window consumptions − Σ in-window scraps −
   * (completed in window ? wip_credit_value : 0). */
  balance: string;
}

/**
 * The subledger side: every production order with ANY activity in the
 * as-of window (a consumption, a scrap, or a completion) with its exact
 * in-window WIP balance. Orders with no in-window activity contribute
 * nothing on either side and are excluded from the count.
 */
export async function listOrderWipBalances(asOf: string): Promise<OrderWipBalanceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT o.id AS "orderId", o.order_no AS "orderNo", o.status,
      (COALESCE((SELECT sum(c.value) FROM production_consumptions c
                 WHERE c.order_id = o.id AND c.consumed_at::date <= ${asOf}), 0)
       - COALESCE((SELECT sum(s.value) FROM production_scraps s
                   WHERE s.order_id = o.id AND s.scrapped_at::date <= ${asOf}), 0)
       - CASE WHEN o.completed_at IS NOT NULL AND o.completed_at::date <= ${asOf}
              THEN o.wip_credit_value ELSE 0 END)::numeric(19,4)::text AS balance
    FROM production_orders o
    WHERE EXISTS (SELECT 1 FROM production_consumptions c
                  WHERE c.order_id = o.id AND c.consumed_at::date <= ${asOf})
       OR EXISTS (SELECT 1 FROM production_scraps s
                  WHERE s.order_id = o.id AND s.scrapped_at::date <= ${asOf})
       OR (o.completed_at IS NOT NULL AND o.completed_at::date <= ${asOf})
    ORDER BY o.created_at, o.id
  `);
  return rows.rows as unknown as OrderWipBalanceRow[];
}

export interface WipOrphanJournalRow {
  journalId: string;
  entryNo: string | null;
  sourceType: string;
  sourceId: string | null;
  entryDate: string;
  /** The entry's signed effect on the WIP account(s) (DEBIT − CREDIT). */
  wipNet: string;
}

/**
 * Orphan detail (the inventory movesWithoutJournal mirror): journal entries
 * touching the WIP account(s) whose source is NOT a production order — a GL
 * effect on WIP with no producing order behind it. Includes entry ids +
 * sources + the net WIP effect per entry.
 */
export async function listWipOrphanJournals(
  accountIds: readonly string[],
  asOf: string,
  limit: number,
): Promise<WipOrphanJournalRow[]> {
  if (accountIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT e.id AS "journalId", e.entry_no AS "entryNo", e.source_type AS "sourceType",
           e.source_id AS "sourceId", e.entry_date::text AS "entryDate",
           COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0)
             ::numeric(19,4)::text AS "wipNet"
    FROM journal_entries e
    JOIN journal_lines l ON l.journal_entry_id = e.id
    WHERE e.source_type <> 'production_order'
      AND e.entry_date <= ${asOf}
      AND l.account_id IN (${sql.join(
        accountIds.map((id) => sql`${id}`),
        sql`, `,
      )})
    GROUP BY e.id, e.entry_no, e.source_type, e.source_id, e.entry_date
    ORDER BY e.entry_date, e.id
    LIMIT ${limit}
  `);
  return rows.rows as unknown as WipOrphanJournalRow[];
}

// -- inspections (T39; QC pass/fail records — MASTER-PLAN §4) ------------------------
//
// The QC gate's write surface: one inspections row per pass/fail decision
// against a production order (its FG batch) or a goods receipt. The row is
// inserted LAST, after the side effects (a release or a qc_scrap that throws
// leaves no record). `goods_receipts` is read-only here (the §6 precedent —
// migration 0026 designed the composite FK for exactly this direction).

export interface InspectionRow {
  id: string;
  targetType: "production_order" | "goods_receipt";
  orderId: string | null;
  grnId: string | null;
  fgBatchId: string | null;
  result: "PASS" | "FAIL";
  sampled: boolean;
  sampleSize: number | null;
  disposition: "ACCEPT" | "SCRAP" | "REWORK" | "RETURN_TO_SUPPLIER" | null;
  inspectedAt: string;
  note: string | null;
  noteAr: string | null;
}

const INSPECTION_COLUMNS = sql`id, target_type AS "targetType", order_id AS "orderId",
  grn_id AS "grnId", fg_batch_id AS "fgBatchId", result, sampled, sample_size AS "sampleSize",
  disposition, inspected_at::text AS "inspectedAt", note, note_ar AS "noteAr"`;

export async function insertInspection(input: {
  targetType: string;
  orderId: string | null;
  grnId: string | null;
  fgBatchId: string | null;
  result: string;
  sampled: boolean;
  sampleSize: number | null;
  disposition: string | null;
  inspectedAt: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<InspectionRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO inspections (id, tenant_id, created_by, target_type, order_id, grn_id,
                             fg_batch_id, result, sampled, sample_size, disposition,
                             inspected_at, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.targetType}, ${input.orderId},
            ${input.grnId}, ${input.fgBatchId}, ${input.result}, ${input.sampled}, ${input.sampleSize},
            ${input.disposition}, ${input.inspectedAt}::timestamptz, ${input.note}, ${input.noteAr})
  `);
  return (await findInspectionById(id))!;
}

export async function findInspectionById(id: string): Promise<InspectionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${INSPECTION_COLUMNS} FROM inspections WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as InspectionRow[])[0];
}

export async function listInspections(filter: {
  targetType?: string;
  orderId?: string;
  limit: number;
}): Promise<InspectionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${INSPECTION_COLUMNS} FROM inspections
    WHERE (${filter.targetType ?? null}::text IS NULL OR target_type = ${filter.targetType ?? null})
      AND (${filter.orderId ?? null}::uuid IS NULL OR order_id = ${filter.orderId ?? null})
    ORDER BY created_at, id
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as InspectionRow[];
}

/** Inspections recorded against one FG batch (the batch-summary count). */
export async function countInspectionsByBatch(batchId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM inspections WHERE fg_batch_id = ${batchId}
  `);
  return (rows.rows as unknown as { n: number }[])[0]!.n;
}

/** Cross-module read-only existence check on goods_receipts (purchasing-
 * owned; the migration-0026 composite FK designed this direction). */
export async function findGrnForInspection(id: string): Promise<{ id: string } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id FROM goods_receipts WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as { id: string }[])[0];
}

/** Batch on-hand for the qc_scrap qty — the inventory store's batchOnHand
 * SQL mirrored 1:1 (Σ IN − Σ OUT over stock_moves; the append-only ledger
 * IS the truth). Read-only on the inventory-owned table. */
export async function qcBatchOnHand(batchId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN qty ELSE -qty END), 0)::text AS q
    FROM stock_moves WHERE batch_id = ${batchId}
  `);
  return (rows.rows as unknown as { q: string }[])[0]!.q;
}

// -- genealogy (T39; read-only recall walks — MASTER-PLAN §10) -----------------------
//
// Pure SELECTs for GenealogyService: batch identity (item_batches JOIN
// items — the inventory BATCH_COLUMNS shape subset), the producing-order and
// consumption edges over manufacturing-owned tables, and the sales edges off
// stock_moves (inventory-owned, read-only — §10 allows exactly this
// direction). Nothing in this section ever writes.

export interface GenealogyBatchRow {
  id: string;
  itemId: string;
  sku: string;
  batchNo: string;
  status: string;
  expiryDate: string | null;
  productionOrderId: string | null;
}

const GENEALOGY_BATCH_COLUMNS = sql`b.id, b.item_id AS "itemId", i.sku, b.batch_no AS "batchNo",
  b.status, b.expiry_date::text AS "expiryDate", b.production_order_id AS "productionOrderId"`;

export async function findBatchForGenealogy(batchId: string): Promise<GenealogyBatchRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${GENEALOGY_BATCH_COLUMNS}
    FROM item_batches b JOIN items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
    WHERE b.id = ${batchId} LIMIT 1
  `);
  return (rows.rows as unknown as GenealogyBatchRow[])[0];
}

export async function listGenealogyBatches(
  batchIds: readonly string[],
): Promise<GenealogyBatchRow[]> {
  if (batchIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT ${GENEALOGY_BATCH_COLUMNS}
    FROM item_batches b JOIN items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
    WHERE b.id IN (${sql.join(
      batchIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return rows.rows as unknown as GenealogyBatchRow[];
}

export async function listProductionOrdersByIds(
  orderIds: readonly string[],
): Promise<Pick<ProductionOrderRow, "id" | "orderNo" | "status" | "itemId" | "fgBatchId" | "fgWarehouseId">[]> {
  if (orderIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT id, order_no AS "orderNo", status, item_id AS "itemId",
           fg_batch_id AS "fgBatchId", fg_warehouse_id AS "fgWarehouseId"
    FROM production_orders
    WHERE id IN (${sql.join(
      orderIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return rows.rows as unknown as Pick<
    ProductionOrderRow,
    "id" | "orderNo" | "status" | "itemId" | "fgBatchId" | "fgWarehouseId"
  >[];
}

/** Upstream edges: a set of orders' batch-bound consumption rows. */
export async function listConsumptionsByOrderIds(
  orderIds: readonly string[],
): Promise<{ orderId: string; itemId: string; batchId: string | null; qty: string }[]> {
  if (orderIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT order_id AS "orderId", item_id AS "itemId", batch_id AS "batchId", qty::text AS qty
    FROM production_consumptions
    WHERE order_id IN (${sql.join(
      orderIds.map((id) => sql`${id}`),
      sql`, `,
    )}) AND batch_id IS NOT NULL
    ORDER BY order_id, batch_id
  `);
  return rows.rows as unknown as { orderId: string; itemId: string; batchId: string | null; qty: string }[];
}

/** Downstream edges: the orders that consumed a set of batches. */
export async function listConsumptionsByBatchIds(
  batchIds: readonly string[],
): Promise<{ orderId: string; batchId: string; itemId: string; qty: string }[]> {
  if (batchIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT order_id AS "orderId", batch_id AS "batchId", item_id AS "itemId", qty::text AS qty
    FROM production_consumptions
    WHERE batch_id IN (${sql.join(
      batchIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    ORDER BY order_id, batch_id
  `);
  return rows.rows as unknown as { orderId: string; batchId: string; itemId: string; qty: string }[];
}

/** Sales edges off the append-only move ledger (inventory-owned table,
 * read-only): every OUT move of the batches sourced from a sales invoice or
 * a delivery note — the recall's customer-facing legs. */
export async function listBatchSalesEdges(
  batchIds: readonly string[],
): Promise<{ batchId: string; sourceType: string; sourceId: string; movedAt: string; qty: string }[]> {
  if (batchIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT batch_id AS "batchId", source_type AS "sourceType", source_id AS "sourceId",
           moved_at::text AS "movedAt", qty::text AS qty
    FROM stock_moves
    WHERE batch_id IN (${sql.join(
      batchIds.map((id) => sql`${id}`),
      sql`, `,
    )}) AND source_type IN ('sales_invoice', 'delivery_note') AND direction = 'OUT'
    ORDER BY moved_at, id
  `);
  return rows.rows as unknown as { batchId: string; sourceType: string; sourceId: string; movedAt: string; qty: string }[];
}
