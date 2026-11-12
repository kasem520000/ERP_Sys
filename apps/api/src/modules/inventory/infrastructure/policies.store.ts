import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Policies/jobs store (PHASE-044 T-12, migration 0070): the transfer
 * pricing policies (I-23), the transit exceptions (I-22), the inventory
 * alert jobs registration (I-17/I-21/I-25), and the two alert scans'
 * query shapes. Every statement runs in the caller's ambient tenant UoW.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("policies access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- transfer pricing policies (I-23, G-46) ---------------------------------------------

export interface TransferPricingPolicyRow {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  mode: "MARKUP" | "FIXED";
  markupPct: string | null;
  fixedPrice: string | null;
  note: string | null;
}

export async function findTransferPricingPolicy(
  fromWarehouseId: string,
  toWarehouseId: string,
): Promise<TransferPricingPolicyRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, from_warehouse_id AS "fromWarehouseId", to_warehouse_id AS "toWarehouseId",
      mode, markup_pct::text AS "markupPct", fixed_price::text AS "fixedPrice", note
    FROM transfer_pricing_policies
    WHERE from_warehouse_id = ${fromWarehouseId} AND to_warehouse_id = ${toWarehouseId}
    LIMIT 1
  `);
  return (rows.rows as unknown as TransferPricingPolicyRow[])[0];
}

export async function upsertTransferPricingPolicy(input: {
  fromWarehouseId: string;
  toWarehouseId: string;
  mode: "MARKUP" | "FIXED";
  markupPct: string | null;
  fixedPrice: string | null;
  note: string | null;
  createdBy: string | null;
}): Promise<TransferPricingPolicyRow> {
  await tenantTx().execute(sql`
    INSERT INTO transfer_pricing_policies (id, tenant_id, from_warehouse_id, to_warehouse_id,
      mode, markup_pct, fixed_price, note, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.fromWarehouseId},
      ${input.toWarehouseId}, ${input.mode}, ${input.markupPct}::numeric, ${input.fixedPrice}::numeric,
      ${input.note}, ${input.createdBy})
    ON CONFLICT ("tenant_id", "from_warehouse_id", "to_warehouse_id") DO UPDATE SET
      mode = EXCLUDED.mode, markup_pct = EXCLUDED.markup_pct, fixed_price = EXCLUDED.fixed_price,
      note = EXCLUDED.note, updated_at = now(), version = transfer_pricing_policies.version + 1
  `);
  return (await findTransferPricingPolicy(input.fromWarehouseId, input.toWarehouseId))!;
}

export async function listTransferPricingPolicies(limit: number): Promise<TransferPricingPolicyRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, from_warehouse_id AS "fromWarehouseId", to_warehouse_id AS "toWarehouseId",
      mode, markup_pct::text AS "markupPct", fixed_price::text AS "fixedPrice", note
    FROM transfer_pricing_policies
    ORDER BY created_at DESC
    LIMIT ${Math.min(limit, 200)}
  `);
  return rows.rows as unknown as TransferPricingPolicyRow[];
}

// -- transit exceptions (I-22) -----------------------------------------------------------

export interface TransitExceptionRow {
  id: string;
  transferId: string;
  lineNo: number;
  exceptionKind: "DAMAGE" | "MISSING";
  qty: string;
  journalId: string | null;
  resolvedAt: string | null;
  note: string | null;
}

export async function insertTransitException(input: {
  /** The caller-minted id (the journal's exactly-once docId — minted
   * BEFORE the post so the row and its journal share the key). */
  id: string;
  transferId: string;
  lineNo: number;
  exceptionKind: "DAMAGE" | "MISSING";
  qty: string;
  journalId: string | null;
  note: string | null;
  createdBy: string | null;
}): Promise<string> {
  await tenantTx().execute(sql`
    INSERT INTO transit_exceptions (id, tenant_id, transfer_id, line_no, exception_kind, qty,
      journal_id, resolved_at, note, created_by)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.transferId}, ${input.lineNo},
      ${input.exceptionKind}, ${input.qty}::numeric, ${input.journalId},
      CASE WHEN ${input.journalId}::uuid IS NULL THEN NULL ELSE now() END, ${input.note}, ${input.createdBy})
  `);
  return input.id;
}

export async function listTransitExceptions(transferId: string): Promise<TransitExceptionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, transfer_id AS "transferId", line_no AS "lineNo", exception_kind AS "exceptionKind",
      qty::text AS qty, journal_id AS "journalId", resolved_at AS "resolvedAt", note
    FROM transit_exceptions WHERE transfer_id = ${transferId} ORDER BY line_no
  `);
  return rows.rows as unknown as TransitExceptionRow[];
}

// -- the alert jobs registration + scans (I-17/I-21/I-25) ---------------------------------

export interface AlertJobRow {
  id: string;
  jobKind: "SHELF_LIFE" | "SLOW_MOVEMENT";
  shelfLifeDays: number;
  slowMovementDays: number;
  isActive: boolean;
  lastRunAt: string | null;
  lastFlagged: number;
}

export async function findAlertJob(jobKind: "SHELF_LIFE" | "SLOW_MOVEMENT"): Promise<AlertJobRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, job_kind AS "jobKind", shelf_life_days AS "shelfLifeDays",
      slow_movement_days AS "slowMovementDays", is_active AS "isActive",
      last_run_at AS "lastRunAt", last_flagged AS "lastFlagged"
    FROM inventory_alert_jobs WHERE job_kind = ${jobKind} LIMIT 1
  `);
  return (rows.rows as unknown as AlertJobRow[])[0];
}

export async function upsertAlertJob(input: {
  jobKind: "SHELF_LIFE" | "SLOW_MOVEMENT";
  shelfLifeDays: number;
  slowMovementDays: number;
  isActive: boolean;
  note: string | null;
  createdBy: string | null;
}): Promise<AlertJobRow> {
  await tenantTx().execute(sql`
    INSERT INTO inventory_alert_jobs (id, tenant_id, job_kind, shelf_life_days, slow_movement_days,
      is_active, note, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.jobKind}, ${input.shelfLifeDays},
      ${input.slowMovementDays}, ${input.isActive}, ${input.note}, ${input.createdBy})
    ON CONFLICT ("tenant_id", "job_kind") DO UPDATE SET
      shelf_life_days = EXCLUDED.shelf_life_days, slow_movement_days = EXCLUDED.slow_movement_days,
      is_active = EXCLUDED.is_active, note = EXCLUDED.note, updated_at = now(),
      version = inventory_alert_jobs.version + 1
  `);
  return (await findAlertJob(input.jobKind))!;
}

export async function stampAlertRun(input: { jobKind: "SHELF_LIFE" | "SLOW_MOVEMENT"; flagged: number }) {
  await tenantTx().execute(sql`
    UPDATE inventory_alert_jobs SET last_run_at = now(), last_flagged = ${input.flagged},
      updated_at = now(), version = version + 1
    WHERE job_kind = ${input.jobKind}
  `);
}

/** The shelf-life scan: batches expiring within N days that still carry
 * on-hand (Σ IN − Σ OUT over stock_moves > 0 — the batch on-hand law). */
export async function scanExpiringBatches(withinDays: number): Promise<
  { batchId: string; itemId: string; itemSku: string | null; batchNo: string; expiryDate: string; onHand: string }[]
> {
  const rows = await tenantTx().execute(sql`
    WITH onhand AS (
      SELECT batch_id, SUM(CASE WHEN direction = 'IN' THEN qty ELSE -qty END) AS on_hand
      FROM stock_moves WHERE batch_id IS NOT NULL
      GROUP BY batch_id HAVING SUM(CASE WHEN direction = 'IN' THEN qty ELSE -qty END) > 0
    )
    SELECT b.id AS "batchId", b.item_id AS "itemId", i.sku AS "itemSku", b.batch_no AS "batchNo",
      b.expiry_date::text AS "expiryDate", o.on_hand::text AS "onHand"
    FROM item_batches b
    JOIN onhand o ON o.batch_id = b.id
    LEFT JOIN items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
    WHERE b.expiry_date IS NOT NULL
      AND b.expiry_date <= (now() + (${withinDays}::text || ' days')::interval)::date
    ORDER BY b.expiry_date
    LIMIT 500
  `);
  return rows.rows as unknown as {
    batchId: string;
    itemId: string;
    itemSku: string | null;
    batchNo: string;
    expiryDate: string;
    onHand: string;
  }[];
}

/** The slow-movement scan: stocked items with NO outbound consumption in
 * the window (the stale-stock law — on-hand > 0 and the newest OUT move
 * older than N days, or none at all). */
export async function scanSlowMovingItems(windowDays: number): Promise<
  { itemId: string; itemSku: string | null; onHand: string; lastOutAt: string | null }[]
> {
  const rows = await tenantTx().execute(sql`
    WITH last_out AS (
      SELECT item_id, MAX(moved_at) AS last_out_at
      FROM stock_moves WHERE direction = 'OUT' AND move_kind IN ('issue', 'adjust')
      GROUP BY item_id
    )
    SELECT s.item_id AS "itemId", i.sku AS "itemSku", SUM(s.qty)::text AS "onHand",
      lo.last_out_at::text AS "lastOutAt"
    FROM item_stock s
    LEFT JOIN last_out lo ON lo.item_id = s.item_id
    LEFT JOIN items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
    WHERE s.qty > 0
      AND (lo.last_out_at IS NULL OR lo.last_out_at < (now() - (${windowDays}::text || ' days')::interval)::date)
    GROUP BY s.item_id, i.sku, lo.last_out_at
    ORDER BY lo.last_out_at NULLS FIRST
    LIMIT 500
  `);
  return rows.rows as unknown as { itemId: string; itemSku: string | null; onHand: string; lastOutAt: string | null }[];
}
