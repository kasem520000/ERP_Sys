import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Inventory store (PHASE-010): the ONLY writer of stock_moves (INV-010's
 * append-only substrate — reached exclusively through the inventory
 * application services, which write it inside the same ambient transaction
 * as the posting-engine journal; ADR-0007: this module never touches GL
 * tables). Every statement runs in the caller's tenant UoW so a failure
 * anywhere rolls the whole business operation back (§6 INV-018: one
 * journal + its stock rows + one source document, atomically).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("inventory access requires an ambient tenant scope");
  }
  return context.tx;
}

/** Ambient tenant handle for sanctioned cross-module reads (§6 patterns). */
export function inventoryTx(): TenantDb {
  return tenantTx();
}

// -- warehouses --------------------------------------------------------------------

export interface WarehouseRow {
  id: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  code: string;
  name: string;
  nameAr: string | null;
  inventoryAccountId: string | null;
  inventoryAccountCode: string | null;
  isActive: boolean;
  note: string | null;
  role: string | null;
}

const WAREHOUSE_COLUMNS = sql`w.id, w.branch_id AS "branchId", b.code AS "branchCode",
  b.name AS "branchName", w.code, w.name, w.name_ar AS "nameAr",
  w.inventory_account_id AS "inventoryAccountId", a.code AS "inventoryAccountCode",
  w.is_active AS "isActive", w.note, w.role`;
const WAREHOUSE_FROM = sql`warehouses w
  LEFT JOIN branches b ON b.id = w.branch_id AND b.tenant_id = w.tenant_id
  LEFT JOIN accounts a ON a.id = w.inventory_account_id AND a.tenant_id = w.tenant_id`;

export async function listWarehouses(filter: {
  activeOnly?: boolean;
  branchId?: string;
  limit: number;
}): Promise<WarehouseRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${WAREHOUSE_COLUMNS} FROM ${WAREHOUSE_FROM}
    WHERE (${filter.activeOnly ?? false}::boolean IS FALSE OR w.is_active)
      AND (${filter.branchId ?? null}::uuid IS NULL OR w.branch_id = ${filter.branchId ?? null})
    ORDER BY w.code
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as WarehouseRow[];
}

export async function findWarehouseById(id: string): Promise<WarehouseRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${WAREHOUSE_COLUMNS} FROM ${WAREHOUSE_FROM} WHERE w.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as WarehouseRow[])[0];
}

export async function findWarehouseByCode(code: string): Promise<WarehouseRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${WAREHOUSE_COLUMNS} FROM ${WAREHOUSE_FROM} WHERE w.code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as WarehouseRow[])[0];
}

export async function insertWarehouse(input: {
  branchId: string;
  code: string;
  name: string;
  nameAr: string | null;
  inventoryAccountId: string | null;
  note: string | null;
  /** PHASE-018 (migration 0026): the RAW/WIP/FG convention tag (nullable). */
  role: string | null;
  createdBy: string | null;
}): Promise<WarehouseRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO warehouses (id, tenant_id, branch_id, code, name, name_ar,
                            inventory_account_id, note, role, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.code}, ${input.name},
            ${input.nameAr}, ${input.inventoryAccountId}, ${input.note}, ${input.role}, ${input.createdBy})
    RETURNING id
  `);
  void rows;
  return (await findWarehouseById(id))!;
}

export async function updateWarehouse(
  id: string,
  patch: {
    name?: string;
    nameAr?: string | null;
    inventoryAccountId?: string | null;
    note?: string | null;
    /** PHASE-018: undefined = untouched; null = cleared. */
    role?: string | null;
  },
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE warehouses SET
      name = COALESCE(${patch.name ?? null}, name),
      name_ar = COALESCE(${patch.nameAr ?? null}, name_ar),
      inventory_account_id = CASE WHEN ${patch.inventoryAccountId === undefined}
        THEN inventory_account_id ELSE ${patch.inventoryAccountId ?? null} END,
      note = COALESCE(${patch.note ?? null}, note),
      role = CASE WHEN ${patch.role === undefined} THEN role ELSE ${patch.role ?? null} END,
      updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

export async function deactivateWarehouse(
  id: string,
  actorId: string | null,
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE warehouses SET is_active = false, deactivated_at = now(),
      deactivated_by = ${actorId}, updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

export async function reactivateWarehouse(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE warehouses SET is_active = true, deactivated_at = NULL, deactivated_by = NULL,
      updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

// -- item_warehouse_settings ---------------------------------------------------------

export interface ItemWarehouseSettingRow {
  id: string;
  itemId: string;
  warehouseId: string;
  reorderLevel: string;
  minQty: string;
  lastReorderAlertedAt: string | null;
}

export async function upsertItemWarehouseSetting(input: {
  itemId: string;
  warehouseId: string;
  reorderLevel: string;
  minQty: string;
  createdBy: string | null;
}): Promise<ItemWarehouseSettingRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO item_warehouse_settings (id, tenant_id, item_id, warehouse_id,
                                         reorder_level, min_qty, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.itemId}, ${input.warehouseId},
            ${input.reorderLevel}, ${input.minQty}, ${input.createdBy})
    ON CONFLICT (tenant_id, item_id, warehouse_id) DO UPDATE SET
      reorder_level = EXCLUDED.reorder_level, min_qty = EXCLUDED.min_qty,
      updated_at = now(), version = item_warehouse_settings.version + 1
    RETURNING id, item_id AS "itemId", warehouse_id AS "warehouseId",
      reorder_level AS "reorderLevel", min_qty AS "minQty",
      last_reorder_alerted_at AS "lastReorderAlertedAt"
  `);
  return (rows.rows as unknown as ItemWarehouseSettingRow[])[0]!;
}

export async function listReorderCandidates(): Promise<
  {
    itemId: string;
    itemSku: string;
    itemName: string;
    warehouseId: string;
    warehouseCode: string;
    reorderLevel: string;
    minQty: string;
    qtyOnHand: string;
    settingId: string;
    lastReorderAlertedAt: string | null;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT s.item_id AS "itemId", i.sku AS "itemSku", i.name AS "itemName",
      s.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
      s.reorder_level AS "reorderLevel", s.min_qty AS "minQty",
      COALESCE(st.qty, '0') AS "qtyOnHand", s.id AS "settingId",
      s.last_reorder_alerted_at AS "lastReorderAlertedAt"
    FROM item_warehouse_settings s
    JOIN items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
    JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = s.tenant_id
    LEFT JOIN item_stock st ON st.item_id = s.item_id AND st.warehouse_id = s.warehouse_id
      AND st.tenant_id = s.tenant_id
    WHERE w.is_active AND s.reorder_level > 0
      AND COALESCE(st.qty, '0') <= s.reorder_level
  `);
  return rows.rows as unknown as {
    itemId: string;
    itemSku: string;
    itemName: string;
    warehouseId: string;
    warehouseCode: string;
    reorderLevel: string;
    minQty: string;
    qtyOnHand: string;
    settingId: string;
    lastReorderAlertedAt: string | null;
  }[];
}

export async function markReorderAlerted(settingId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE item_warehouse_settings SET last_reorder_alerted_at = now(),
      updated_at = now(), version = version + 1
    WHERE id = ${settingId}
  `);
}

// -- items (read-only cross-module reads; the items module owns writes) --------------

export interface ItemReadRow {
  id: string;
  sku: string;
  name: string;
  nameAr: string | null;
  kind: string;
  status: string;
  costingMethod: "WAC" | "FIFO";
  trackBatch: boolean;
  trackSerial: boolean;
  trackImei: boolean;
  hasExpiry: boolean;
  /** PHASE-018 (migration 0026): FG batch expiry = completion + shelf life. */
  shelfLifeDays: number | null;
}

export async function findItemForInventory(id: string): Promise<ItemReadRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, sku, name, name_ar AS "nameAr", kind, status,
      costing_method AS "costingMethod", track_batch AS "trackBatch",
      track_serial AS "trackSerial", track_imei AS "trackImei", has_expiry AS "hasExpiry",
      shelf_life_days AS "shelfLifeDays"
    FROM items WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ItemReadRow[])[0];
}

export async function updateItemCostingMethod(id: string, method: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE items SET costing_method = ${method}, updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

// -- item_stock (the transactionally-maintained read model) --------------------------

export interface ItemStockRow {
  id: string;
  itemId: string;
  warehouseId: string;
  qty: string;
  avgCost: string;
}

export async function findItemStock(
  itemId: string,
  warehouseId: string,
): Promise<ItemStockRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, item_id AS "itemId", warehouse_id AS "warehouseId", qty, avg_cost AS "avgCost"
    FROM item_stock WHERE item_id = ${itemId} AND warehouse_id = ${warehouseId} LIMIT 1
  `);
  return (rows.rows as unknown as ItemStockRow[])[0];
}

export async function upsertItemStock(input: {
  itemId: string;
  warehouseId: string;
  qty: string;
  avgCost: string;
}): Promise<ItemStockRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.itemId}, ${input.warehouseId},
            ${input.qty}, ${input.avgCost})
    ON CONFLICT (tenant_id, item_id, warehouse_id) DO UPDATE SET
      qty = EXCLUDED.qty, avg_cost = EXCLUDED.avg_cost,
      updated_at = now(), version = item_stock.version + 1
    RETURNING id, item_id AS "itemId", warehouse_id AS "warehouseId", qty, avg_cost AS "avgCost"
  `);
  return (rows.rows as unknown as ItemStockRow[])[0]!;
}

export interface StockOnHandRow {
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  warehouseId: string;
  warehouseCode: string;
  qty: string;
  avgCost: string;
  negative: boolean;
}

export async function listStockOnHand(filter: {
  warehouseId?: string;
  itemId?: string;
  q?: string;
  limit: number;
}): Promise<StockOnHandRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT st.item_id AS "itemId", i.sku, i.name AS "itemName", i.name_ar AS "itemNameAr",
      st.warehouse_id AS "warehouseId", w.code AS "warehouseCode", st.qty,
      st.avg_cost AS "avgCost", (st.qty < 0) AS negative
    FROM item_stock st
    JOIN items i ON i.id = st.item_id AND i.tenant_id = st.tenant_id
    JOIN warehouses w ON w.id = st.warehouse_id AND w.tenant_id = st.tenant_id
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR st.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.itemId ?? null}::uuid IS NULL OR st.item_id = ${filter.itemId ?? null})
      AND (${filter.q ?? null}::text IS NULL OR i.name ILIKE '%' || ${filter.q ?? ""} || '%'
           OR i.name_ar ILIKE '%' || ${filter.q ?? ""} || '%' OR i.sku ILIKE '%' || ${filter.q ?? ""} || '%')
    ORDER BY i.sku, w.code
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as StockOnHandRow[];
}

// -- stock_moves (append-only 🔒) ------------------------------------------------------

export interface StockMoveRow {
  id: string;
  itemId: string;
  sku: string;
  itemName: string;
  warehouseId: string;
  warehouseCode: string;
  direction: "IN" | "OUT";
  moveKind: string;
  qty: string;
  unitCost: string;
  valueAmount: string;
  batchId: string | null;
  batchNo: string | null;
  serialId: string | null;
  serialNo: string | null;
  sourceType: string;
  sourceId: string;
  movedAt: string;
  reason: string | null;
  memo: string | null;
  memoAr: string | null;
  postedJournalId: string | null;
  createdAt: string;
}

export async function insertStockMove(input: {
  id: string;
  itemId: string;
  warehouseId: string;
  direction: "IN" | "OUT";
  moveKind: "receipt" | "issue" | "transfer_in" | "transfer_out" | "adjust";
  qty: string;
  unitCost: string;
  valueAmount: string;
  batchId: string | null;
  serialId: string | null;
  sourceType: string;
  sourceId: string;
  movedAt: string;
  reason: string | null;
  memo: string | null;
  memoAr: string | null;
  postedJournalId: string | null;
}): Promise<string> {
  await tenantTx().execute(sql`
    INSERT INTO stock_moves (id, tenant_id, item_id, warehouse_id, direction, move_kind,
                             qty, unit_cost, value_amount, batch_id, serial_id, source_type,
                             source_id, moved_at, reason, memo, memo_ar, posted_journal_id)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.itemId}, ${input.warehouseId},
            ${input.direction}, ${input.moveKind}, ${input.qty}, ${input.unitCost},
            ${input.valueAmount}, ${input.batchId}, ${input.serialId}, ${input.sourceType},
            ${input.sourceId}, ${input.movedAt}, ${input.reason}, ${input.memo},
            ${input.memoAr}, ${input.postedJournalId})
  `);
  return input.id;
}

export async function listStockMoves(filter: {
  warehouseId?: string;
  itemId?: string;
  direction?: string;
  moveKind?: string;
  fromDate?: string;
  toDate?: string;
  sourceType?: string;
  sourceId?: string;
  limit: number;
}): Promise<StockMoveRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT m.id, m.item_id AS "itemId", i.sku, i.name AS "itemName",
      m.warehouse_id AS "warehouseId", w.code AS "warehouseCode", m.direction,
      m.move_kind AS "moveKind", m.qty, m.unit_cost AS "unitCost",
      m.value_amount AS "valueAmount", m.batch_id AS "batchId", b.batch_no AS "batchNo",
      m.serial_id AS "serialId", s.serial_no AS "serialNo", m.source_type AS "sourceType",
      m.source_id AS "sourceId", m.moved_at AS "movedAt", m.reason, m.memo, m.memo_ar AS "memoAr",
      m.posted_journal_id AS "postedJournalId", m.created_at AS "createdAt"
    FROM stock_moves m
    JOIN items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
    JOIN warehouses w ON w.id = m.warehouse_id AND w.tenant_id = m.tenant_id
    LEFT JOIN item_batches b ON b.id = m.batch_id AND b.tenant_id = m.tenant_id
    LEFT JOIN item_serials s ON s.id = m.serial_id AND s.tenant_id = m.tenant_id
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR m.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.itemId ?? null}::uuid IS NULL OR m.item_id = ${filter.itemId ?? null})
      AND (${filter.direction ?? null}::text IS NULL OR m.direction = ${filter.direction ?? null})
      AND (${filter.moveKind ?? null}::text IS NULL OR m.move_kind = ${filter.moveKind ?? null})
      AND (${filter.fromDate ?? null}::date IS NULL OR m.moved_at >= ${filter.fromDate ?? null})
      AND (${filter.toDate ?? null}::date IS NULL OR m.moved_at <= ${filter.toDate ?? null})
      AND (${filter.sourceType ?? null}::text IS NULL OR m.source_type = ${filter.sourceType ?? null})
      AND (${filter.sourceId ?? null}::uuid IS NULL OR m.source_id = ${filter.sourceId ?? null})
    ORDER BY m.moved_at DESC, m.created_at DESC
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as StockMoveRow[];
}

export async function countStockMoves(): Promise<number> {
  const rows = await tenantTx().execute(sql`SELECT count(*)::int AS n FROM stock_moves`);
  return (rows.rows as unknown as { n: number }[])[0]!.n;
}

/**
 * Lock the position row (CC-04): SELECT … FOR UPDATE inside the ambient
 * transaction so concurrent issues of the last units serialize — the
 * loser re-reads the post-winner onHand and fails INSUFFICIENT_STOCK with
 * zero residue. Missing rows insert a zero placeholder first (a lockable
 * anchor) inside the same transaction.
 */
export async function lockItemStock(
  itemId: string,
  warehouseId: string,
): Promise<ItemStockRow | undefined> {
  const tx = tenantTx();
  await tx.execute(sql`
    INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${itemId}, ${warehouseId}, 0, 0)
    ON CONFLICT (tenant_id, item_id, warehouse_id) DO NOTHING
  `);
  const rows = await tx.execute(sql`
    SELECT id, item_id AS "itemId", warehouse_id AS "warehouseId", qty, avg_cost AS "avgCost"
    FROM item_stock WHERE item_id = ${itemId} AND warehouse_id = ${warehouseId}
    FOR UPDATE
  `);
  return (rows.rows as unknown as ItemStockRow[])[0];
}

// -- stock_layers (FIFO) ----------------------------------------------------------------

export interface LayerRow {
  id: string;
  remainingQty: string;
  unitCost: string;
  receivedAt: string;
}

export async function listLiveLayers(
  itemId: string,
  warehouseId: string,
): Promise<LayerRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, remaining_qty AS "remainingQty", unit_cost AS "unitCost", received_at AS "receivedAt"
    FROM stock_layers
    WHERE item_id = ${itemId} AND warehouse_id = ${warehouseId} AND remaining_qty > 0
    ORDER BY received_at, created_at
  `);
  return rows.rows as unknown as LayerRow[];
}

export async function listAllLayers(itemId: string, warehouseId: string): Promise<LayerRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, remaining_qty AS "remainingQty", unit_cost AS "unitCost", received_at AS "receivedAt"
    FROM stock_layers
    WHERE item_id = ${itemId} AND warehouse_id = ${warehouseId}
    ORDER BY received_at, created_at
  `);
  return rows.rows as unknown as LayerRow[];
}

/**
 * Layer unit-cost revalue (PHASE-011 T10 — the landed-cost seam): raises a
 * FIFO layer's unit_cost in place (the layer's remaining value grows; the
 * trail move row carries the delta — never a silent back-date, the journal
 * + move land in the same transaction).
 */
export async function updateLayerUnitCost(layerId: string, unitCost: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE stock_layers SET unit_cost = ${unitCost}, updated_at = now()
    WHERE id = ${layerId}
  `);
}

export async function insertLayer(input: {
  id: string;
  itemId: string;
  warehouseId: string;
  remainingQty: string;
  unitCost: string;
  sourceMoveId: string | null;
  receivedAt: string;
}): Promise<string> {
  await tenantTx().execute(sql`
    INSERT INTO stock_layers (id, tenant_id, item_id, warehouse_id, remaining_qty,
                              unit_cost, source_move_id, received_at)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.itemId}, ${input.warehouseId},
            ${input.remainingQty}, ${input.unitCost}, ${input.sourceMoveId}, ${input.receivedAt})
  `);
  return input.id;
}

export async function decrementLayer(layerId: string, consumeQty: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE stock_layers SET remaining_qty = remaining_qty - ${consumeQty}, updated_at = now()
    WHERE id = ${layerId} AND remaining_qty >= ${consumeQty}
  `);
}

export async function updateLayerCost(layerId: string, unitCost: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE stock_layers SET unit_cost = ${unitCost}, updated_at = now()
    WHERE id = ${layerId}
  `);
}

// -- transfers ---------------------------------------------------------------------------

export interface TransferRow {
  id: string;
  transferNo: string | null;
  fromWarehouseId: string;
  fromWarehouseCode: string;
  toWarehouseId: string;
  toWarehouseCode: string;
  status: "DRAFT" | "IN_TRANSIT" | "POSTED" | "CANCELLED";
  dispatchDate: string | null;
  receiveDate: string | null;
  postedJournalId: string | null;
  note: string | null;
  noteAr: string | null;
  lineCount: number;
}

const TRANSFER_COLUMNS = sql`t.id, t.transfer_no AS "transferNo",
  t.from_warehouse_id AS "fromWarehouseId", fw.code AS "fromWarehouseCode",
  t.to_warehouse_id AS "toWarehouseId", tw.code AS "toWarehouseCode", t.status,
  t.dispatch_date AS "dispatchDate", t.receive_date AS "receiveDate",
  t.posted_journal_id AS "postedJournalId", t.note, t.note_ar AS "noteAr",
  COALESCE(l.cnt, 0) AS "lineCount"`;
const TRANSFER_FROM = sql`stock_transfers t
  JOIN warehouses fw ON fw.id = t.from_warehouse_id AND fw.tenant_id = t.tenant_id
  JOIN warehouses tw ON tw.id = t.to_warehouse_id AND tw.tenant_id = t.tenant_id
  LEFT JOIN (SELECT transfer_id, count(*) AS cnt FROM stock_transfer_lines GROUP BY transfer_id) l
    ON l.transfer_id = t.id`;

export async function listTransfers(filter: {
  status?: string;
  warehouseId?: string;
  limit: number;
}): Promise<TransferRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TRANSFER_COLUMNS} FROM ${TRANSFER_FROM}
    WHERE (${filter.status ?? null}::text IS NULL OR t.status = ${filter.status ?? null})
      AND (${filter.warehouseId ?? null}::uuid IS NULL OR t.from_warehouse_id = ${filter.warehouseId ?? null}
           OR t.to_warehouse_id = ${filter.warehouseId ?? null})
    ORDER BY t.created_at DESC
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as TransferRow[];
}

export async function findTransferById(id: string): Promise<TransferRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TRANSFER_COLUMNS} FROM ${TRANSFER_FROM} WHERE t.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TransferRow[])[0];
}

export interface TransferLineRow {
  id: string;
  lineNo: number;
  itemId: string;
  sku: string;
  itemName: string;
  qty: string;
}

export async function listTransferLines(transferId: string): Promise<TransferLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.line_no AS "lineNo", l.item_id AS "itemId", i.sku, i.name AS "itemName", l.qty
    FROM stock_transfer_lines l
    JOIN items i ON i.id = l.item_id AND i.tenant_id = l.tenant_id
    WHERE l.transfer_id = ${transferId}
    ORDER BY l.line_no
  `);
  return rows.rows as unknown as TransferLineRow[];
}

export async function insertTransfer(input: {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO stock_transfers (id, tenant_id, from_warehouse_id, to_warehouse_id, note,
                                 note_ar, created_by)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.fromWarehouseId}, ${input.toWarehouseId},
            ${input.note}, ${input.noteAr}, ${input.createdBy})
  `);
}

export async function insertTransferLine(input: {
  transferId: string;
  lineNo: number;
  itemId: string;
  qty: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO stock_transfer_lines (id, tenant_id, transfer_id, line_no, item_id, qty)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.transferId}, ${input.lineNo},
            ${input.itemId}, ${input.qty})
  `);
}

/** Conditional dispatch flip — the two-leg idempotency anchor (exactly-once). */
export async function markTransferDispatched(input: {
  id: string;
  transferNo: string;
  dispatchDate: string;
  dispatchedBy: string | null;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_transfers SET status = 'IN_TRANSIT', transfer_no = ${input.transferNo},
      dispatch_date = ${input.dispatchDate}, dispatched_by = ${input.dispatchedBy},
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'DRAFT'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

/** Conditional receive flip — POSTED exactly once. */
export async function markTransferReceived(input: {
  id: string;
  receiveDate: string;
  receivedBy: string | null;
  postedJournalId: string | null;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_transfers SET status = 'POSTED', receive_date = ${input.receiveDate},
      received_by = ${input.receivedBy},
      posted_journal_id = COALESCE(${input.postedJournalId}, posted_journal_id),
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'IN_TRANSIT'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function cancelTransfer(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_transfers SET status = 'CANCELLED', updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'DRAFT' RETURNING id
  `);
  return rows.rows.length > 0;
}

/** Record the G-15 journal on the transfer header (distinct-accounts case). */
export async function markTransferJournal(id: string, journalEntryId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE stock_transfers SET posted_journal_id = ${journalEntryId},
      updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

/**
 * In-transit quantities per item-warehouse (BR-016 netting source):
 * the INBOUND view — what is on a truck TOWARD the given warehouse
 * (visible, never sellable/reservable until received).
 */
export async function listInTransit(warehouseId?: string): Promise<
  { itemId: string; warehouseId: string; qty: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT l.item_id AS "itemId", t.to_warehouse_id AS "warehouseId", l.qty
    FROM stock_transfers t
    JOIN stock_transfer_lines l ON l.transfer_id = t.id AND l.tenant_id = t.tenant_id
    WHERE t.status = 'IN_TRANSIT'
      AND (${warehouseId ?? null}::uuid IS NULL OR t.to_warehouse_id = ${warehouseId ?? null})
  `);
  return rows.rows as unknown as { itemId: string; warehouseId: string; qty: string }[];
}

// -- adjustments ---------------------------------------------------------------------------

export interface AdjustmentRow {
  id: string;
  adjustmentNo: string | null;
  warehouseId: string;
  warehouseCode: string;
  itemId: string;
  sku: string;
  itemName: string;
  reason: string;
  deltaQty: string;
  unitCost: string | null;
  counterAccountId: string | null;
  status: "DRAFT" | "POSTED" | "CANCELLED";
  postingDate: string | null;
  postedJournalId: string | null;
  note: string | null;
  noteAr: string | null;
}

const ADJUSTMENT_COLUMNS = sql`a.id, a.adjustment_no AS "adjustmentNo", a.warehouse_id AS "warehouseId",
  w.code AS "warehouseCode", a.item_id AS "itemId", i.sku, i.name AS "itemName", a.reason,
  a.delta_qty AS "deltaQty", a.unit_cost AS "unitCost", a.counter_account_id AS "counterAccountId",
  a.status, a.posting_date AS "postingDate", a.posted_journal_id AS "postedJournalId",
  a.note, a.note_ar AS "noteAr"`;
const ADJUSTMENT_FROM = sql`stock_adjustments a
  JOIN warehouses w ON w.id = a.warehouse_id AND w.tenant_id = a.tenant_id
  JOIN items i ON i.id = a.item_id AND i.tenant_id = a.tenant_id`;

export async function listAdjustments(filter: {
  status?: string;
  warehouseId?: string;
  limit: number;
}): Promise<AdjustmentRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ADJUSTMENT_COLUMNS} FROM ${ADJUSTMENT_FROM}
    WHERE (${filter.status ?? null}::text IS NULL OR a.status = ${filter.status ?? null})
      AND (${filter.warehouseId ?? null}::uuid IS NULL OR a.warehouse_id = ${filter.warehouseId ?? null})
    ORDER BY a.created_at DESC
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as AdjustmentRow[];
}

export async function findAdjustmentById(id: string): Promise<AdjustmentRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ADJUSTMENT_COLUMNS} FROM ${ADJUSTMENT_FROM} WHERE a.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as AdjustmentRow[])[0];
}

export async function insertAdjustment(input: {
  id: string;
  warehouseId: string;
  itemId: string;
  reason: string;
  deltaQty: string;
  unitCost: string | null;
  counterAccountId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO stock_adjustments (id, tenant_id, warehouse_id, item_id, reason, delta_qty,
                                   unit_cost, counter_account_id, note, note_ar, created_by)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.warehouseId}, ${input.itemId},
            ${input.reason}, ${input.deltaQty}, ${input.unitCost}, ${input.counterAccountId},
            ${input.note}, ${input.noteAr}, ${input.createdBy})
  `);
}

export async function markAdjustmentPosted(input: {
  id: string;
  adjustmentNo: string;
  postingDate: string;
  postedBy: string | null;
  postedJournalId: string;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_adjustments SET status = 'POSTED', adjustment_no = ${input.adjustmentNo},
      posting_date = ${input.postingDate}, posted_by = ${input.postedBy}, posted_at = now(),
      posted_journal_id = ${input.postedJournalId}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'DRAFT' RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function cancelAdjustment(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_adjustments SET status = 'CANCELLED', updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'DRAFT' RETURNING id
  `);
  return rows.rows.length > 0;
}

// -- batches / serials ------------------------------------------------------------------------

export interface BatchRow {
  id: string;
  itemId: string;
  sku: string;
  batchNo: string;
  expiryDate: string | null;
  sourceRef: string | null;
  status: string;
  /** PHASE-018 (migration 0026): the producing order (set once at completion). */
  productionOrderId: string | null;
}

const BATCH_COLUMNS = sql`b.id, b.item_id AS "itemId", i.sku, b.batch_no AS "batchNo",
  b.expiry_date AS "expiryDate", b.source_ref AS "sourceRef", b.status,
  b.production_order_id AS "productionOrderId"`;

export async function listBatches(filter: {
  itemId?: string;
  expiredOnly?: boolean;
  limit: number;
}): Promise<BatchRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BATCH_COLUMNS}
    FROM item_batches b
    JOIN items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
    WHERE (${filter.itemId ?? null}::uuid IS NULL OR b.item_id = ${filter.itemId ?? null})
      AND (${filter.expiredOnly ?? false}::boolean IS FALSE OR b.expiry_date <= CURRENT_DATE)
    ORDER BY b.batch_no
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as BatchRow[];
}

export async function findBatchById(id: string): Promise<BatchRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BATCH_COLUMNS}
    FROM item_batches b JOIN items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
    WHERE b.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as BatchRow[])[0];
}

export async function findBatchByNo(itemId: string, batchNo: string): Promise<BatchRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BATCH_COLUMNS}
    FROM item_batches b JOIN items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
    WHERE b.item_id = ${itemId} AND b.batch_no = ${batchNo} LIMIT 1
  `);
  return (rows.rows as unknown as BatchRow[])[0];
}

export async function insertBatch(input: {
  id: string;
  itemId: string;
  batchNo: string;
  expiryDate: string | null;
  sourceRef: string | null;
  createdBy: string | null;
}): Promise<string> {
  await tenantTx().execute(sql`
    INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date, source_ref, created_by)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.itemId}, ${input.batchNo},
            ${input.expiryDate}, ${input.sourceRef}, ${input.createdBy})
  `);
  return input.id;
}

export async function markBatchWrittenOff(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE item_batches SET status = 'WRITTEN_OFF', updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

// -- PHASE-018 (migration 0026): the QC quarantine holds + produced-batch
// provenance. Internal-only surface (the manufacturing module calls these
// inside its own transaction); no HTTP routes.

/** ACTIVE → QUARANTINED (the QC gate holds completed FG batches). */
export async function markBatchQuarantined(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE item_batches SET status = 'QUARANTINED', updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

/** QUARANTINED → ACTIVE (inspection PASS + ACCEPT; no journal). */
export async function markBatchQuarantineReleased(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE item_batches SET status = 'ACTIVE', updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

/** Set item_batches.production_order_id where NULL (produced-batch
 * provenance — set once at completion, never re-pointed). */
export async function linkBatchProduction(
  batchId: string,
  productionOrderId: string,
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE item_batches SET production_order_id = ${productionOrderId},
      updated_at = now(), version = version + 1
    WHERE id = ${batchId} AND production_order_id IS NULL
  `);
}

/** Batch on-hand: Σ IN − Σ OUT over stock_moves (the append-only ledger IS the truth). */
export async function batchOnHand(batchId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN qty ELSE -qty END), 0)::text AS q
    FROM stock_moves WHERE batch_id = ${batchId}
  `);
  return (rows.rows as unknown as { q: string }[])[0]!.q;
}

/** FEFO candidates: live batches with on-hand, earliest expiry first (BR-017). */
export async function listFefoBatches(itemId: string): Promise<
  { id: string; batchNo: string; expiryDate: string | null; onHand: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT b.id, b.batch_no AS "batchNo", b.expiry_date AS "expiryDate", COALESCE(o.on_hand, '0') AS "onHand"
    FROM item_batches b
    LEFT JOIN (
      SELECT batch_id, SUM(CASE WHEN direction = 'IN' THEN qty ELSE -qty END) AS on_hand
      FROM stock_moves WHERE batch_id IS NOT NULL GROUP BY batch_id
    ) o ON o.batch_id = b.id
    WHERE b.item_id = ${itemId} AND b.status = 'ACTIVE' AND COALESCE(o.on_hand, '0') > 0
    ORDER BY b.expiry_date NULLS LAST, b.created_at
  `);
  return rows.rows as unknown as { id: string; batchNo: string; expiryDate: string | null; onHand: string }[];
}

export interface SerialRow {
  id: string;
  itemId: string;
  sku: string;
  serialNo: string;
  imei: string | null;
  status: "in_stock" | "sold" | "returned";
  currentOwner: string | null;
  soldAt: string | null;
  returnedAt: string | null;
}

export async function listSerials(filter: {
  itemId?: string;
  status?: string;
  limit: number;
}): Promise<SerialRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.item_id AS "itemId", i.sku, s.serial_no AS "serialNo", s.imei, s.status,
      s.current_owner AS "currentOwner", s.sold_at AS "soldAt", s.returned_at AS "returnedAt"
    FROM item_serials s
    JOIN items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
    WHERE (${filter.itemId ?? null}::uuid IS NULL OR s.item_id = ${filter.itemId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR s.status = ${filter.status ?? null})
    ORDER BY s.serial_no
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as SerialRow[];
}

export async function findSerialById(id: string): Promise<SerialRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.item_id AS "itemId", i.sku, s.serial_no AS "serialNo", s.imei, s.status,
      s.current_owner AS "currentOwner", s.sold_at AS "soldAt", s.returned_at AS "returnedAt"
    FROM item_serials s JOIN items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
    WHERE s.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SerialRow[])[0];
}

export async function findSerialByNo(itemId: string, serialNo: string): Promise<SerialRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.item_id AS "itemId", i.sku, s.serial_no AS "serialNo", s.imei, s.status,
      s.current_owner AS "currentOwner", s.sold_at AS "soldAt", s.returned_at AS "returnedAt"
    FROM item_serials s JOIN items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
    WHERE s.item_id = ${itemId} AND s.serial_no = ${serialNo} LIMIT 1
  `);
  return (rows.rows as unknown as SerialRow[])[0];
}

export async function insertSerial(input: {
  id: string;
  itemId: string;
  serialNo: string;
  imei: string | null;
  createdBy: string | null;
}): Promise<string> {
  await tenantTx().execute(sql`
    INSERT INTO item_serials (id, tenant_id, item_id, serial_no, imei, created_by)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.itemId}, ${input.serialNo},
            ${input.imei}, ${input.createdBy})
  `);
  return input.id;
}

export async function markSerialSold(input: {
  id: string;
  soldAt: string;
  owner: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE item_serials SET status = 'sold', sold_at = ${input.soldAt},
      current_owner = ${input.owner}, updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

export async function markSerialReturned(input: {
  id: string;
  returnedAt: string;
  owner: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE item_serials SET status = 'returned', returned_at = ${input.returnedAt},
      current_owner = ${input.owner}, updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

export async function markSerialInStock(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE item_serials SET status = 'in_stock', current_owner = NULL, sold_at = NULL,
      returned_at = NULL, updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

/** The original sale move of a serial (BR-018 return-cost lookup). */
export async function findSerialIssueMove(serialId: string): Promise<
  { unitCost: string; movedAt: string; warehouseId: string } | undefined
> {
  const rows = await tenantTx().execute(sql`
    SELECT unit_cost AS "unitCost", moved_at AS "movedAt", warehouse_id AS "warehouseId"
    FROM stock_moves WHERE serial_id = ${serialId} AND direction = 'OUT'
    ORDER BY moved_at DESC, created_at DESC LIMIT 1
  `);
  return (rows.rows as unknown as { unitCost: string; movedAt: string; warehouseId: string }[])[0];
}

// -- counts ---------------------------------------------------------------------------------

export interface CountRow {
  id: string;
  countNo: string | null;
  warehouseId: string;
  warehouseCode: string;
  status: "DRAFT" | "COUNTED" | "VARIANCE_REVIEW" | "POSTED" | "CANCELLED";
  blind: boolean;
  snapshotAt: string;
  countedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  supervisorOverride: boolean;
  postingDate: string | null;
  postedJournalId: string | null;
  variance: CountVariance | null;
  note: string | null;
  noteAr: string | null;
  lineCount: number;
}

export interface CountVariance {
  lossLines: number;
  gainLines: number;
  lossValue: string;
  gainValue: string;
}

const COUNT_COLUMNS = sql`c.id, c.count_no AS "countNo", c.warehouse_id AS "warehouseId",
  w.code AS "warehouseCode", c.status, c.blind, c.snapshot_at AS "snapshotAt",
  c.counted_by AS "countedBy", c.submitted_at AS "submittedAt", c.approved_by AS "approvedBy",
  c.approved_at AS "approvedAt", c.supervisor_override AS "supervisorOverride",
  c.posting_date AS "postingDate", c.posted_journal_id AS "postedJournalId",
  c.variance, c.note, c.note_ar AS "noteAr", COALESCE(l.cnt, 0) AS "lineCount"`;
const COUNT_FROM = sql`stock_counts c
  JOIN warehouses w ON w.id = c.warehouse_id AND w.tenant_id = c.tenant_id
  LEFT JOIN (SELECT stock_count_id, count(*) AS cnt FROM stock_count_lines
             GROUP BY stock_count_id) l ON l.stock_count_id = c.id`;

export async function listCounts(filter: {
  status?: string;
  warehouseId?: string;
  limit: number;
}): Promise<CountRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${COUNT_COLUMNS} FROM ${COUNT_FROM}
    WHERE (${filter.status ?? null}::text IS NULL OR c.status = ${filter.status ?? null})
      AND (${filter.warehouseId ?? null}::uuid IS NULL OR c.warehouse_id = ${filter.warehouseId ?? null})
    ORDER BY c.created_at DESC
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as CountRow[];
}

export async function findCountById(id: string): Promise<CountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${COUNT_COLUMNS} FROM ${COUNT_FROM} WHERE c.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CountRow[])[0];
}

export async function insertCount(input: {
  id: string;
  warehouseId: string;
  blind: boolean;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  snapshotAt: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO stock_counts (id, tenant_id, warehouse_id, blind, note, note_ar, created_by,
                              snapshot_at)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.warehouseId}, ${input.blind},
            ${input.note}, ${input.noteAr}, ${input.createdBy}, ${input.snapshotAt}::timestamptz)
  `);
}

export interface CountLineRow {
  id: string;
  lineNo: number;
  itemId: string;
  sku: string;
  itemName: string;
  batchId: string | null;
  batchNo: string | null;
  systemQty: string;
  countedQty: string | null;
  recounted: boolean;
  recountNote: string | null;
  valueImpact: string | null;
}

export async function listCountLines(countId: string): Promise<CountLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.line_no AS "lineNo", l.item_id AS "itemId", i.sku, i.name AS "itemName",
      l.batch_id AS "batchId", b.batch_no AS "batchNo", l.system_qty AS "systemQty",
      l.counted_qty AS "countedQty", l.recounted, l.recount_note AS "recountNote",
      l.value_impact AS "valueImpact"
    FROM stock_count_lines l
    JOIN items i ON i.id = l.item_id AND i.tenant_id = l.tenant_id
    LEFT JOIN item_batches b ON b.id = l.batch_id AND b.tenant_id = l.tenant_id
    WHERE l.stock_count_id = ${countId}
    ORDER BY l.line_no
  `);
  return rows.rows as unknown as CountLineRow[];
}

export async function insertCountLine(input: {
  countId: string;
  lineNo: number;
  itemId: string;
  batchId: string | null;
  systemQty: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO stock_count_lines (id, tenant_id, stock_count_id, line_no, item_id, batch_id,
                                   system_qty)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.countId}, ${input.lineNo},
            ${input.itemId}, ${input.batchId}, ${input.systemQty})
  `);
}

/** Post-snapshot movements for variance review (phase §2.10). */
export async function listMovementsSince(
  countId: string,
  warehouseId: string,
  snapshotAt: string,
): Promise<
  { id: string; sku: string; direction: string; qty: string; movedAt: string; reason: string | null }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT m.id, i.sku, m.direction, m.qty, m.moved_at AS "movedAt", m.reason
    FROM stock_moves m
    JOIN stock_count_lines l ON l.item_id = m.item_id AND l.stock_count_id = ${countId}
    JOIN items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
    WHERE m.warehouse_id = ${warehouseId} AND m.created_at > ${snapshotAt}::timestamptz
    ORDER BY m.moved_at
  `);
  return rows.rows as unknown as {
    id: string;
    sku: string;
    direction: string;
    qty: string;
    movedAt: string;
    reason: string | null;
  }[];
}

export async function setCountedQty(input: {
  countId: string;
  lineNo: number;
  countedQty: string;
  recounted: boolean;
  recountNote: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE stock_count_lines SET counted_qty = ${input.countedQty},
      recounted = ${input.recounted}, recount_note = ${input.recountNote},
      updated_at = now(), version = version + 1
    WHERE stock_count_id = ${input.countId} AND line_no = ${input.lineNo}
  `);
}

export async function setValueImpacts(input: {
  countId: string;
  impacts: { lineNo: number; valueImpact: string }[];
}): Promise<void> {
  for (const impact of input.impacts) {
    await tenantTx().execute(sql`
      UPDATE stock_count_lines SET value_impact = ${impact.valueImpact},
        updated_at = now(), version = version + 1
      WHERE stock_count_id = ${input.countId} AND line_no = ${impact.lineNo}
    `);
  }
}

export async function markCountSubmitted(input: {
  id: string;
  countedBy: string | null;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_counts SET status = 'COUNTED', counted_by = ${input.countedBy},
      submitted_at = now(), updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'DRAFT' RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function markCountUnderReview(input: {
  id: string;
  variance: CountVariance;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_counts SET status = 'VARIANCE_REVIEW', variance = ${JSON.stringify(input.variance)}::jsonb,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'COUNTED' RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function markCountPosted(input: {
  id: string;
  countNo: string;
  postingDate: string;
  approvedBy: string | null;
  supervisorOverride: boolean;
  postedJournalId: string | null;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_counts SET status = 'POSTED', count_no = ${input.countNo},
      posting_date = ${input.postingDate}, approved_by = ${input.approvedBy}, approved_at = now(),
      supervisor_override = ${input.supervisorOverride},
      posted_journal_id = ${input.postedJournalId}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'VARIANCE_REVIEW' RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function cancelCount(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_counts SET status = 'CANCELLED', updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'DRAFT' RETURNING id
  `);
  return rows.rows.length > 0;
}

/** Open (in-flight) counts touching an item — the INV-017 method-switch guard. */
export async function countOpenCountsForItem(itemId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM stock_count_lines l
    JOIN stock_counts c ON c.id = l.stock_count_id
    WHERE l.item_id = ${itemId} AND c.status IN ('DRAFT', 'COUNTED', 'VARIANCE_REVIEW')
  `);
  return (rows.rows as unknown as { n: number }[])[0]!.n;
}

export async function countInTransitTransfersForItem(itemId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM stock_transfer_lines l
    JOIN stock_transfers t ON t.id = l.transfer_id
    WHERE l.item_id = ${itemId} AND t.status = 'IN_TRANSIT'
  `);
  return (rows.rows as unknown as { n: number }[])[0]!.n;
}

// -- reservations / availability -----------------------------------------------------------

export interface ReservationRow {
  id: string;
  itemId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string;
  qty: string;
  holderType: string;
  holderId: string | null;
  expiresAt: string | null;
  status: "ACTIVE" | "RELEASED" | "CONSUMED";
  note: string | null;
}

export async function insertReservation(input: {
  id: string;
  itemId: string;
  warehouseId: string;
  qty: string;
  holderType: string;
  holderId: string | null;
  expiresAt: string | null;
  note: string | null;
  createdBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO stock_reservations (id, tenant_id, item_id, warehouse_id, qty, holder_type,
                                    holder_id, expires_at, note, created_by)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.itemId}, ${input.warehouseId},
            ${input.qty}, ${input.holderType}, ${input.holderId},
            ${input.expiresAt === null ? null : sql`${input.expiresAt}::timestamptz`},
            ${input.note}, ${input.createdBy})
  `);
}

export async function findReservationById(id: string): Promise<ReservationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT r.id, r.item_id AS "itemId", i.sku, r.warehouse_id AS "warehouseId",
      w.code AS "warehouseCode", r.qty, r.holder_type AS "holderType", r.holder_id AS "holderId",
      r.expires_at AS "expiresAt", r.status, r.note
    FROM stock_reservations r
    JOIN items i ON i.id = r.item_id AND i.tenant_id = r.tenant_id
    JOIN warehouses w ON w.id = r.warehouse_id AND w.tenant_id = r.tenant_id
    WHERE r.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ReservationRow[])[0];
}

export async function listReservations(filter: {
  itemId?: string;
  warehouseId?: string;
  status?: string;
  limit: number;
}): Promise<ReservationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT r.id, r.item_id AS "itemId", i.sku, r.warehouse_id AS "warehouseId",
      w.code AS "warehouseCode", r.qty, r.holder_type AS "holderType", r.holder_id AS "holderId",
      r.expires_at AS "expiresAt", r.status, r.note
    FROM stock_reservations r
    JOIN items i ON i.id = r.item_id AND i.tenant_id = r.tenant_id
    JOIN warehouses w ON w.id = r.warehouse_id AND w.tenant_id = r.tenant_id
    WHERE (${filter.itemId ?? null}::uuid IS NULL OR r.item_id = ${filter.itemId ?? null})
      AND (${filter.warehouseId ?? null}::uuid IS NULL OR r.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR r.status = ${filter.status ?? null})
    ORDER BY r.created_at DESC
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as ReservationRow[];
}

export async function releaseReservation(input: {
  id: string;
  releasedBy: string | null;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_reservations SET status = 'RELEASED', released_at = now(),
      released_by = ${input.releasedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'ACTIVE' RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function consumeReservation(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_reservations SET status = 'CONSUMED', consumed_at = now(),
      updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'ACTIVE' RETURNING id
  `);
  return rows.rows.length > 0;
}

/** Active (non-expired) reserved qty per item-warehouse — the availability net. */
export async function reservedQty(itemId: string, warehouseId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(qty), 0)::text AS q FROM stock_reservations
    WHERE item_id = ${itemId} AND warehouse_id = ${warehouseId} AND status = 'ACTIVE'
      AND (expires_at IS NULL OR expires_at > now())
  `);
  return (rows.rows as unknown as { q: string }[])[0]!.q;
}

/**
 * PHASE-018 (migration 0026): Σ on-hand of QUARANTINED batches for the item
 * in that warehouse (trackBatch items only — untracked items have no
 * batches, so the join is naturally empty). The availability read subtracts
 * it from availableQty.
 */
export async function quarantinedQty(itemId: string, warehouseId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN sm.direction = 'IN' THEN sm.qty ELSE -sm.qty END), 0)::text AS q
    FROM stock_moves sm
    JOIN item_batches b ON b.id = sm.batch_id AND b.tenant_id = sm.tenant_id
    WHERE sm.item_id = ${itemId} AND sm.warehouse_id = ${warehouseId}
      AND sm.batch_id IS NOT NULL AND b.status = 'QUARANTINED'
  `);
  return (rows.rows as unknown as { q: string }[])[0]!.q;
}

/**
 * Expiry sweep: flip lapsed ACTIVE rows to RELEASED (the availability net
 * ignores them either way) — returns the flipped ids so the audit anchors
 * on a real row, not a re-list race (PHASE-015 T9).
 */
export async function sweepExpiredReservations(): Promise<string[]> {
  const rows = await tenantTx().execute(sql`
    UPDATE stock_reservations SET status = 'RELEASED', released_at = now(),
      updated_at = now(), version = version + 1
    WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= now() RETURNING id
  `);
  return (rows.rows as unknown as { id: string }[]).map((row) => row.id);
}

// -- reconciliation (INV-010) ----------------------------------------------------------------

/**
 * The money trail per resolved GL account (INV-010's comparison basis):
 * Σ signed value_amount of the moves belonging to warehouses that map to
 * that account (override or the tenant INVENTORY purpose) PLUS the
 * pending IN legs of IN_TRANSIT transfers — the G-15 journal (when the
 * accounts differ) DRs the destination at dispatch while the IN move
 * rows only appear at receive, so the in-flight carried value must be
 * netted in. Exact in every lifecycle state (draft / in-transit same
 * account / in-transit distinct accounts / posted): transfer legs within
 * one account cancel; across accounts each side matches its journal.
 */
export async function stockValueByAccount(asOf?: string): Promise<
  { accountId: string; accountCode: string; movementValue: string; moveCount: number }[]
> {
  const rows = await tenantTx().execute(sql`
    WITH wh_accounts AS (
      SELECT w.id AS warehouse_id,
        COALESCE(w.inventory_account_id, p.account_id) AS account_id
      FROM warehouses w
      LEFT JOIN (
        SELECT account_id FROM account_purposes
        WHERE purpose_key = 'INVENTORY' AND active_to IS NULL LIMIT 1
      ) p ON true
    ),
    move_side AS (
      SELECT wa.account_id, SUM(CASE WHEN m.direction = 'IN' THEN m.value_amount ELSE -m.value_amount END) AS v,
        COUNT(m.id) AS cnt
      FROM stock_moves m
      JOIN wh_accounts wa ON wa.warehouse_id = m.warehouse_id
      WHERE (${asOf ?? null}::date IS NULL OR m.moved_at <= ${asOf ?? null})
      GROUP BY wa.account_id
    ),
    pending_in AS (
      SELECT wa.account_id, SUM(l.qty * COALESCE(leg.unit_cost, st.avg_cost, '0')) AS v
      FROM stock_transfers t
      JOIN stock_transfer_lines l ON l.transfer_id = t.id AND l.tenant_id = t.tenant_id
      JOIN wh_accounts wa ON wa.warehouse_id = t.to_warehouse_id
      LEFT JOIN LATERAL (
        SELECT SUM(m.value_amount) / NULLIF(SUM(m.qty), 0) AS unit_cost
        FROM stock_moves m
        WHERE m.source_type = 'stock_transfer' AND m.source_id = t.id
          AND m.warehouse_id = t.from_warehouse_id AND m.item_id = l.item_id
      ) leg ON true
      LEFT JOIN item_stock st ON st.item_id = l.item_id AND st.warehouse_id = t.from_warehouse_id
      WHERE t.status = 'IN_TRANSIT'
        AND (${asOf ?? null}::date IS NULL OR t.dispatch_date <= ${asOf ?? null})
      GROUP BY wa.account_id
    )
    SELECT a.id AS "accountId", a.code AS "accountCode",
      (COALESCE(m.v, 0) + COALESCE(p.v, 0))::text AS "movementValue",
      COALESCE(m.cnt, 0)::int AS "moveCount"
    FROM accounts a
    LEFT JOIN move_side m ON m.account_id = a.id
    LEFT JOIN pending_in p ON p.account_id = a.id
    WHERE m.account_id IS NOT NULL OR p.account_id IS NOT NULL
  `);
  return rows.rows as unknown as {
    accountId: string;
    accountCode: string;
    movementValue: string;
    moveCount: number;
  }[];
}

/** GL base balance as-of for the INV-010 comparison (journal_lines truth). */
export async function glBalanceAsOf(accountId: string, asOf?: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0)::text AS balance
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE l.account_id = ${accountId}
      AND (${asOf ?? null}::date IS NULL OR e.entry_date <= ${asOf ?? null})
  `);
  return (rows.rows as unknown as { balance: string }[])[0]!.balance;
}

/** Offending moves for a BROKEN run: per-account diff detail with move ids. */
export async function movesWithoutJournal(limit: number): Promise<
  { id: string; sku: string; movedAt: string; valueAmount: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT m.id, i.sku, m.moved_at AS "movedAt", m.value_amount AS "valueAmount"
    FROM stock_moves m
    JOIN items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
    WHERE m.posted_journal_id IS NULL
      AND NOT (m.source_type = 'stock_transfer')
    ORDER BY m.moved_at
    LIMIT ${limit}
  `);
  return rows.rows as unknown as { id: string; sku: string; movedAt: string; valueAmount: string }[];
}

/** Orphan-journal detail: journals whose source claims stock but carry no move rows. */
export async function stockJournalsWithoutMoves(limit: number): Promise<
  { journalId: string; entryNo: string; sourceType: string; sourceId: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT e.id AS "journalId", e.entry_no AS "entryNo", e.source_type AS "sourceType",
      e.source_id AS "sourceId"
    FROM journal_entries e
    WHERE e.source_type IN ('stock_adjustment', 'stock_count', 'stock_transfer', 'opening_stock', 'method_switch')
      AND NOT EXISTS (
        SELECT 1 FROM stock_moves m
        WHERE m.posted_journal_id = e.id
      )
    ORDER BY e.entry_date
    LIMIT ${limit}
  `);
  return rows.rows as unknown as {
    journalId: string;
    entryNo: string;
    sourceType: string;
    sourceId: string;
  }[];
}

/** On-hand informational valuation (WAC avg + FIFO layers) — the run's detail payload. */
export async function onHandValuation(): Promise<
  { itemId: string; sku: string; warehouseId: string; qty: string; value: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT st.item_id AS "itemId", i.sku, st.warehouse_id AS "warehouseId", st.qty,
      CASE WHEN i.costing_method = 'WAC'
        THEN (st.qty * st.avg_cost)::numeric(19,4)
        ELSE COALESCE((
          SELECT SUM(l.remaining_qty * l.unit_cost)
          FROM stock_layers l
          WHERE l.item_id = st.item_id AND l.warehouse_id = st.warehouse_id
        ), 0)::numeric(19,4)
      END::text AS value
    FROM item_stock st
    JOIN items i ON i.id = st.item_id AND i.tenant_id = st.tenant_id
  `);
  return rows.rows as unknown as {
    itemId: string;
    sku: string;
    warehouseId: string;
    qty: string;
    value: string;
  }[];
}

// -- opening stock (PHASE-006 drafts) ----------------------------------------------------------

export async function listStockDrafts(): Promise<
  {
    id: string;
    itemId: string;
    qty: string;
    unitCost: string;
    currencyCode: string;
    note: string | null;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, item_id AS "itemId", qty, unit_cost AS "unitCost",
      currency_code AS "currencyCode", note
    FROM opening_balance_docs
    WHERE kind = 'STOCK' AND status = 'DRAFT'
    ORDER BY created_at
  `);
  return rows.rows as unknown as {
    id: string;
    itemId: string;
    qty: string;
    unitCost: string;
    currencyCode: string;
    note: string | null;
  }[];
}

export async function markOpeningDocPosted(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE opening_balance_docs SET status = 'POSTED', updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

// -- settings (BR-013/BR-015 policy reads; PHASE-004 registry) ------------------------------------

export async function readSetting(key: string): Promise<unknown> {
  const rows = await tenantTx().execute(sql`
    SELECT value FROM tenant_settings WHERE key = ${key} LIMIT 1
  `);
  return (rows.rows as unknown as { value: unknown }[])[0]?.value;
}

/** The OPENING period across all fiscal years (G-16 stock-leg target). */
export async function findOpeningPeriod(): Promise<
  { id: string; fiscalYearId: string; startDate: string; endDate: string; status: string } | undefined
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, fiscal_year_id AS "fiscalYearId", start_date AS "startDate",
      end_date AS "endDate", status
    FROM fiscal_periods WHERE kind = 'OPENING' AND status = 'OPEN'
    ORDER BY start_date LIMIT 1
  `);
  return (rows.rows as unknown as {
    id: string;
    fiscalYearId: string;
    startDate: string;
    endDate: string;
    status: string;
  }[])[0];
}
