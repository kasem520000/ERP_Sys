import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Kitting store (PHASE-044 T-10, migration 0070): the warehouse kit
 * orders + lines — light kit assembly from bins WITHOUT a production
 * order. The economic legs ride the movement core (the G-45 roll-up:
 * components issue, the kit receipts at Σ component costs EXACTLY,
 * same-account by construction — no journal); this store owns only the
 * document rows.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("kitting access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface WarehouseKitOrderRow {
  id: string;
  kitNo: string | null;
  warehouseId: string;
  warehouseCode: string | null;
  kitItemId: string;
  kitItemSku: string | null;
  qty: string;
  status: string;
  totalComponentCost: string | null;
  postedAt: string | null;
  postedBy: string | null;
  note: string | null;
}

export interface WarehouseKitLineRow {
  id: string;
  orderId: string;
  lineNo: number;
  componentItemId: string;
  componentSku: string | null;
  qty: string;
  unitCost: string | null;
  valueAmount: string | null;
  fromBinId: string | null;
}

export async function listKitOrders(filter: {
  warehouseId?: string;
  status?: string;
  limit: number;
}): Promise<WarehouseKitOrderRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT o.id, o.kit_no AS "kitNo", o.warehouse_id AS "warehouseId",
      w.code AS "warehouseCode", o.kit_item_id AS "kitItemId", i.sku AS "kitItemSku",
      o.qty::text AS qty, o.status, o.total_component_cost::text AS "totalComponentCost",
      o.posted_at AS "postedAt", o.posted_by AS "postedBy", o.note
    FROM warehouse_kit_orders o
    LEFT JOIN warehouses w ON w.id = o.warehouse_id AND w.tenant_id = o.tenant_id
    LEFT JOIN items i ON i.id = o.kit_item_id AND i.tenant_id = o.tenant_id
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR o.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR o.status = ${filter.status ?? null})
    ORDER BY o.created_at DESC
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as WarehouseKitOrderRow[];
}

export async function findKitOrderById(id: string): Promise<WarehouseKitOrderRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT o.id, o.kit_no AS "kitNo", o.warehouse_id AS "warehouseId",
      w.code AS "warehouseCode", o.kit_item_id AS "kitItemId", i.sku AS "kitItemSku",
      o.qty::text AS qty, o.status, o.total_component_cost::text AS "totalComponentCost",
      o.posted_at AS "postedAt", o.posted_by AS "postedBy", o.note
    FROM warehouse_kit_orders o
    LEFT JOIN warehouses w ON w.id = o.warehouse_id AND w.tenant_id = o.tenant_id
    LEFT JOIN items i ON i.id = o.kit_item_id AND i.tenant_id = o.tenant_id
    WHERE o.id = ${id}
    LIMIT 1
  `);
  return (rows.rows as unknown as WarehouseKitOrderRow[])[0];
}

export async function insertKitOrder(input: {
  warehouseId: string;
  kitItemId: string;
  qty: string;
  note: string | null;
  createdBy: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO warehouse_kit_orders (id, tenant_id, warehouse_id, kit_item_id, qty, status, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.warehouseId}, ${input.kitItemId},
      ${input.qty}::numeric, 'DRAFT', ${input.note}, ${input.createdBy})
  `);
  return id;
}

export async function insertKitLine(input: {
  orderId: string;
  lineNo: number;
  componentItemId: string;
  qty: string;
  fromBinId: string | null;
  createdBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO warehouse_kit_lines (id, tenant_id, order_id, line_no, component_item_id, qty, from_bin_id, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.orderId}, ${input.lineNo},
      ${input.componentItemId}, ${input.qty}::numeric, ${input.fromBinId}, ${input.createdBy})
  `);
}

export async function listKitLines(orderId: string): Promise<WarehouseKitLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.order_id AS "orderId", l.line_no AS "lineNo",
      l.component_item_id AS "componentItemId", i.sku AS "componentSku",
      l.qty::text AS qty, l.unit_cost::text AS "unitCost", l.value_amount::text AS "valueAmount",
      l.from_bin_id AS "fromBinId"
    FROM warehouse_kit_lines l
    LEFT JOIN items i ON i.id = l.component_item_id AND i.tenant_id = l.tenant_id
    WHERE l.order_id = ${orderId}
    ORDER BY l.line_no
  `);
  return rows.rows as unknown as WarehouseKitLineRow[];
}

export async function setKitLineValues(input: {
  orderId: string;
  lineNo: number;
  unitCost: string;
  valueAmount: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE warehouse_kit_lines
    SET unit_cost = ${input.unitCost}::numeric, value_amount = ${input.valueAmount}::numeric,
        updated_at = now(), version = version + 1
    WHERE order_id = ${input.orderId} AND line_no = ${input.lineNo}
  `);
}

export async function markKitPosted(input: {
  id: string;
  kitNo: string;
  totalComponentCost: string;
  postedBy: string | null;
}): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE warehouse_kit_orders SET status = 'POSTED', kit_no = ${input.kitNo},
      total_component_cost = ${input.totalComponentCost}::numeric, posted_at = now(),
      posted_by = ${input.postedBy}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'DRAFT'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

export async function cancelKitOrder(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE warehouse_kit_orders SET status = 'CANCELLED', updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'DRAFT'
    RETURNING id
  `);
  return rows.rows.length > 0;
}
