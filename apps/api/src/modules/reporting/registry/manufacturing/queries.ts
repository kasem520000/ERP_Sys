import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";

/**
 * PHASE-042 T-14 · the manufacturing-execution query surface for the four
 * report contracts (registry/manufacturing/*): work-center utilization (the
 * OEE daily view + the work-center identity), the downtime analysis (reason
 * breakdown + minutes + cost), the rework cost register (G-41 provenance),
 * and the cost-variance rollup (per-order setup/usage/rate + yield). All
 * read-only over the ambient tenant transaction (the registry query-service
 * convention — the communication phase's pattern verbatim).
 */

export interface WorkCenterUtilizationRow {
  workCenterId: string;
  code: string;
  name: string;
  /** PHASE-042 T-14a: the localized name (name_ar ?? name — the contract
   * renders per-run locale). */
  nameAr: string | null;
  day: string;
  plannedHours: string;
  actualHours: string;
  downtimeMinutes: number;
  scrapQty: string;
  completedOperations: number;
  skippedOperations: number;
  totalOperations: number;
}

export interface DowntimeAnalysisRow {
  downtimeId: string;
  code: string;
  workCenterId: string;
  reasonCode: string;
  startedAt: string;
  endedAt: string | null;
  durationMinutes: number;
  costAmount: string | null;
  orderId: string | null;
  orderNo: string | null;
  note: string | null;
}

export interface ReworkCostRow {
  reworkId: string;
  reworkNo: string | null;
  parentOrderId: string;
  parentOrderNo: string | null;
  itemSku: string;
  /** PHASE-042 T-14a: the defect reference (the register's provenance). */
  defectRef: string;
  qty: string;
  status: string;
  laborValue: string;
  overheadValue: string;
  reworkValue: string | null;
  completedAt: string | null;
}

export interface CostVarianceRow {
  orderId: string;
  orderNo: string | null;
  itemSku: string;
  status: string;
  completedAt: string | null;
  setupVariance: string;
  usageVariance: string;
  rateVariance: string;
  yieldVariance: string;
  operations: number;
}

export class ManufacturingExecutionQueriesService {
  /** The utilization rows: the daily OEE view joined to the work-center
   * identity, windowed by day, optionally narrowed to one center. */
  async workCenterUtilization(params: {
    workCenterId?: string;
    from: string;
    to: string;
  }): Promise<WorkCenterUtilizationRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("manufacturing report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT wc.id AS "workCenterId", wc.code, wc.name, wc.name_ar AS "nameAr",
             d.day::text AS day,
             d.planned_hours::text AS "plannedHours", d.actual_hours::text AS "actualHours",
             d.downtime_minutes AS "downtimeMinutes", d.scrap_qty::text AS "scrapQty",
             d.completed_operations AS "completedOperations",
             d.skipped_operations AS "skippedOperations",
             d.total_operations AS "totalOperations"
      FROM v_work_center_oee_daily d
      JOIN work_centers wc ON wc.id = d.work_center_id AND wc.tenant_id = d.tenant_id
      WHERE d.day >= ${params.from}::date AND d.day <= ${params.to}::date
        AND (${params.workCenterId ?? null}::uuid IS NULL OR d.work_center_id = ${params.workCenterId ?? null})
      ORDER BY wc.code, d.day
      LIMIT 5000`);
    return rows.rows as unknown as WorkCenterUtilizationRow[];
  }

  /** The downtime register: one row per record with the work-center code and
   * the linked order's number (NULL for center-level downtime). */
  async downtimeAnalysis(params: {
    workCenterId?: string;
    from: string;
    to: string;
  }): Promise<DowntimeAnalysisRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("manufacturing report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT dt.id AS "downtimeId", wc.code, dt.work_center_id AS "workCenterId",
             dt.reason_code AS "reasonCode", dt.started_at::text AS "startedAt",
             dt.ended_at::text AS "endedAt", dt.duration_minutes AS "durationMinutes",
             dt.cost_amount::text AS "costAmount", dt.order_id AS "orderId",
             po.order_no AS "orderNo", dt.note
      FROM downtime_records dt
      JOIN work_centers wc ON wc.id = dt.work_center_id AND wc.tenant_id = dt.tenant_id
      LEFT JOIN production_orders po ON po.id = dt.order_id AND po.tenant_id = dt.tenant_id
      WHERE dt.started_at >= ${params.from}::date
        AND dt.started_at < (${params.to}::date + 1)
        AND (${params.workCenterId ?? null}::uuid IS NULL OR dt.work_center_id = ${params.workCenterId ?? null})
      ORDER BY dt.started_at DESC
      LIMIT 5000`);
    return rows.rows as unknown as DowntimeAnalysisRow[];
  }

  /** The rework cost register: one row per rework order with the parent
   * order number and the G-41 value legs. */
  async reworkCost(params: { from: string; to: string }): Promise<ReworkCostRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("manufacturing report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT rw.id AS "reworkId", rw.rework_no AS "reworkNo", rw.parent_order_id AS "parentOrderId",
             po.order_no AS "parentOrderNo", i.sku AS "itemSku", rw.defect_ref AS "defectRef",
             rw.qty::text AS qty, rw.status,
             rw.labor_value::text AS "laborValue", rw.overhead_value::text AS "overheadValue",
             rw.rework_value::text AS "reworkValue", rw.completed_at::text AS "completedAt"
      FROM rework_orders rw
      JOIN production_orders po ON po.id = rw.parent_order_id AND po.tenant_id = rw.tenant_id
      JOIN items i ON i.id = rw.item_id AND i.tenant_id = rw.tenant_id
      WHERE rw.created_at >= ${params.from}::date
        AND rw.created_at < (${params.to}::date + 1)
      ORDER BY rw.created_at DESC
      LIMIT 5000`);
    return rows.rows as unknown as ReworkCostRow[];
  }

  /** The per-order variance rollup: Σ setup/usage/rate over the order's
   * operations + the order-level yield variance. */
  async costVariance(params: { from: string; to: string; itemId?: string }): Promise<CostVarianceRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("manufacturing report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT po.id AS "orderId", po.order_no AS "orderNo", i.sku AS "itemSku", po.status,
             po.completed_at::text AS "completedAt",
             COALESCE(SUM(op.setup_variance), 0)::text AS "setupVariance",
             COALESCE(SUM(op.usage_variance), 0)::text AS "usageVariance",
             COALESCE(SUM(op.rate_variance), 0)::text AS "rateVariance",
             po.yield_variance::text AS "yieldVariance",
             COUNT(op.id)::int AS operations
      FROM production_orders po
      JOIN items i ON i.id = po.item_id AND i.tenant_id = po.tenant_id
      LEFT JOIN production_order_operations op ON op.order_id = po.id AND op.tenant_id = po.tenant_id
      WHERE po.completed_at >= ${params.from}::date
        AND po.completed_at < (${params.to}::date + 1)
        AND (${params.itemId ?? null}::uuid IS NULL OR po.item_id = ${params.itemId ?? null})
      GROUP BY po.id, po.order_no, i.sku, po.status, po.completed_at, po.yield_variance
      ORDER BY po.completed_at DESC, po.id
      LIMIT 5000`);
    return rows.rows as unknown as CostVarianceRow[];
  }
}
