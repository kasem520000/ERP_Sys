import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";

/**
 * PHASE-043 T-16 · the planning query surface for the two report contracts
 * (registry/manufacturing/*): the MRP exceptions view (the data-readiness
 * defects + the residual shortages + the fence-locked suggestions — the
 * garbage-in mitigation's report leg) and the ATP/CTP position register
 * (per item × warehouse with the BR-080 exclusion evidence — quarantined /
 * reserved / consignment-owned stock NEVER promises, the columns are the
 * audit trail of what was excluded). All read-only over the ambient tenant
 * transaction (the registry query-service convention — the 042 pattern
 * verbatim).
 */

export interface PlanningExceptionRow {
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  /** The defect class — the run screen's data-readiness panel mirrors these. */
  exceptionKind: "MISSING_LEAD_TIME" | "MISSING_SAFETY_OPERANDS" | "PHANTOM_WITHOUT_RECIPE" | "UNCOVERED_RESIDUAL" | "FROZEN_FENCE_SUGGESTION";
  detail: string;
  runId: string | null;
}

export interface AtpPositionRow {
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  warehouseId: string;
  warehouseCode: string;
  /** item_stock qty (includes quarantine bins; excludes consignment). */
  onHand: string;
  /** QUARANTINE/HOLD bin quantity — NEVER promises (BR-080). */
  quarantined: string;
  /** ACTIVE non-expired reservations — NEVER promises (BR-080). */
  reserved: string;
  /** Owner-partner (consignment) bin quantity — NEVER promises (BR-076/
   * BR-080; reported here because it is VISIBLE but not promiseable). */
  consignmentOwned: string;
  /** on-hand − quarantined − reserved, floored at 0. */
  available: string;
  /** Inbound supply arriving on/before as_of: open POs + open MOs
   * (pending qty) + inbound transfers + MPS production ≤ as_of. */
  inbound: string;
  /** available + inbound (the CTP at as_of). */
  ctp: string;
}

export class PlanningQueriesService {
  /**
   * The MRP exceptions view: per ACTIVE stock item in the warehouse scope —
   * the policy defects (NULL lead time, an AUTO safety policy whose
   * operands are incomplete, phantom lines whose item has no ACTIVE recipe)
   * + the latest COMPLETED run's residuals and frozen-fence suggestions.
   */
  async planningExceptions(params: { warehouseId?: string; runId?: string }): Promise<PlanningExceptionRow[]> {
    requireTenantContext();
    const rows: PlanningExceptionRow[] = [];

    // 1. Policy defects over every ACTIVE STOCK item (the planning corpus).
    const scope = params.warehouseId !== undefined ? sql`AND EXISTS (SELECT 1 FROM item_stock s WHERE s.item_id = i.id AND s.warehouse_id = ${params.warehouseId})` : sql``;
    const items = await this.tx().execute(sql`
      SELECT i.id, i.sku, i.name, i.name_ar AS "nameAr", i.lead_time_days AS "leadTimeDays",
        i.safety_stock_policy AS "safetyStockPolicy", i.safety_stock_qty::text AS "safetyStockQty",
        i.ss_service_level_pct::text AS "ssServiceLevelPct", i.ss_lookback_days AS "ssLookbackDays",
        i.lot_sizing_rule AS "lotSizingRule", i.fixed_order_qty::text AS "fixedOrderQty",
        i.order_multiple::text AS "orderMultiple", i.period_supply_buckets AS "periodSupplyBuckets"
      FROM items i
      WHERE i.kind = 'STOCK' AND i.status = 'ACTIVE' AND i.deleted_at IS NULL ${scope}
      ORDER BY i.sku
    `);
    for (const item of items.rows as unknown as {
      id: string;
      sku: string;
      name: string;
      nameAr: string | null;
      leadTimeDays: number | null;
      safetyStockPolicy: string;
      safetyStockQty: string | null;
      ssServiceLevelPct: string | null;
      ssLookbackDays: number | null;
      lotSizingRule: string;
      fixedOrderQty: string | null;
      orderMultiple: string | null;
      periodSupplyBuckets: number | null;
    }[]) {
      if (item.leadTimeDays === null) {
        rows.push({
          itemId: item.id,
          sku: item.sku,
          itemName: item.name,
          itemNameAr: item.nameAr,
          exceptionKind: "MISSING_LEAD_TIME",
          detail: "no lead_time_days — release dates collapse onto due dates; set the policy on the item card",
          runId: null,
        });
      }
      if (item.safetyStockPolicy === "AUTO" && (item.ssServiceLevelPct === null || item.ssLookbackDays === null)) {
        rows.push({
          itemId: item.id,
          sku: item.sku,
          itemName: item.name,
          itemNameAr: item.nameAr,
          exceptionKind: "MISSING_SAFETY_OPERANDS",
          detail: "AUTO safety stock without its service level / look-back operands — the run plans without a safety target",
          runId: null,
        });
      }
      if (
        (item.lotSizingRule === "FIXED_ORDER_QTY" && item.fixedOrderQty === null) ||
        (item.lotSizingRule === "ORDER_MULTIPLE" && item.orderMultiple === null) ||
        (item.lotSizingRule === "PERIOD_SUPPLY" && item.periodSupplyBuckets === null)
      ) {
        rows.push({
          itemId: item.id,
          sku: item.sku,
          itemName: item.name,
          itemNameAr: item.nameAr,
          exceptionKind: "MISSING_SAFETY_OPERANDS",
          detail: `lot sizing ${item.lotSizingRule} without its operand — the run falls back to LOT_FOR_LOT`,
          runId: null,
        });
      }
    }

    // 2. Phantom lines whose component has NO ACTIVE recipe (the explosion
    // cannot flatten into nothing — the honest defect).
    const phantoms = await this.tx().execute(sql`
      SELECT l.component_item_id AS "componentItemId", i.sku, i.name, i.name_ar AS "nameAr"
      FROM bom_lines l
      JOIN bills_of_materials b ON b.id = l.bom_id AND b.tenant_id = erp.current_tenant_id()
      JOIN items i ON i.id = l.component_item_id AND i.tenant_id = erp.current_tenant_id()
      WHERE l.phantom_flag = true AND b.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1 FROM bills_of_materials b2
          WHERE b2.item_id = l.component_item_id AND b2.tenant_id = erp.current_tenant_id() AND b2.status = 'ACTIVE'
        )
      ORDER BY i.sku
    `);
    for (const phantom of phantoms.rows as unknown as { componentItemId: string; sku: string; name: string; nameAr: string | null }[]) {
      rows.push({
        itemId: phantom.componentItemId,
        sku: phantom.sku,
        itemName: phantom.name,
        itemNameAr: phantom.nameAr,
        exceptionKind: "PHANTOM_WITHOUT_RECIPE",
        detail: "a phantom component with no ACTIVE recipe — the explosion demands the phantom itself instead of flattening",
        runId: null,
      });
    }

    // 3. The run-scoped residuals + frozen-fence suggestions (the latest
    // COMPLETED run for the warehouse unless an explicit runId).
    let runId = params.runId ?? null;
    if (runId === null) {
      const runRows = await this.tx().execute(sql`
        SELECT id FROM mrp_runs
        WHERE status = 'COMPLETED'
          ${params.warehouseId !== undefined ? sql`AND warehouse_id = ${params.warehouseId}` : sql``}
        ORDER BY completed_at DESC LIMIT 1
      `);
      runId = (runRows.rows as unknown as { id: string }[])[0]?.id ?? null;
    }
    if (runId !== null) {
      const residuals = await this.tx().execute(sql`
        SELECT d.item_id AS "itemId", i.sku, i.name, i.name_ar AS "nameAr", d.bucket_index AS "bucketIndex",
          SUM(d.qty)::text AS qty
        FROM mrp_demand_lines d
        JOIN items i ON i.id = d.item_id AND i.tenant_id = erp.current_tenant_id()
        WHERE d.run_id = ${runId}
        GROUP BY d.item_id, i.sku, i.name, i.name_ar, d.bucket_index
      `);
      const supplies = await this.tx().execute(sql`
        SELECT s.item_id AS "itemId", s.bucket_index AS "bucketIndex", SUM(s.qty)::text AS qty
        FROM mrp_supply_lines s WHERE s.run_id = ${runId}
        GROUP BY s.item_id, s.bucket_index
      `);
      const supplyKey = new Map<string, string>();
      for (const row of supplies.rows as unknown as { itemId: string; bucketIndex: number; qty: string }[]) {
        supplyKey.set(`${row.itemId}:${row.bucketIndex}`, row.qty);
      }
      for (const row of residuals.rows as unknown as { itemId: string; sku: string; name: string; nameAr: string | null; bucketIndex: number; qty: string }[]) {
        const supply = supplyKey.get(`${row.itemId}:${row.bucketIndex}`) ?? "0";
        const demand = Number(row.qty);
        const supplyQty = Number(supply);
        // A residual exists when the bucket's supply cannot cover its
        // demand (the netting walk already produced the suggestions; this
        // is the exception VIEW over the same evidence).
        if (supplyQty < demand) {
          rows.push({
            itemId: row.itemId,
            sku: row.sku,
            itemName: row.name,
            itemNameAr: row.nameAr,
            exceptionKind: "UNCOVERED_RESIDUAL",
            detail: `bucket ${row.bucketIndex}: demand ${demand.toFixed(3)} vs supply ${supplyQty.toFixed(3)} — the uncovered remainder (suggestions may cover part; the board decides)`,
            runId,
          });
        }
      }
      const frozen = await this.tx().execute(sql`
        SELECT s.item_id AS "itemId", i.sku, i.name, i.name_ar AS "nameAr", s.qty::text AS qty,
          s.due_date::text AS "dueDate", s.suggestion_type AS "suggestionType"
        FROM mrp_suggestions s
        JOIN items i ON i.id = s.item_id AND i.tenant_id = erp.current_tenant_id()
        WHERE s.run_id = ${runId} AND s.frozen_fence = true AND s.status = 'SUGGESTED'
        ORDER BY i.sku
      `);
      for (const row of frozen.rows as unknown as { itemId: string; sku: string; name: string; nameAr: string | null; qty: string; dueDate: string; suggestionType: string }[]) {
        rows.push({
          itemId: row.itemId,
          sku: row.sku,
          itemName: row.name,
          itemNameAr: row.nameAr,
          exceptionKind: "FROZEN_FENCE_SUGGESTION",
          detail: `a ${row.suggestionType} suggestion of ${row.qty} due ${row.dueDate} sits inside the frozen fence — the MPS is the authority there (accept deliberately or move the MPS)`,
          runId,
        });
      }
    }
    return rows;
  }

  /** The ATP/CTP position register (BR-080's evidence columns). */
  async atpPositions(params: { warehouseId?: string; itemId?: string }): Promise<AtpPositionRow[]> {
    requireTenantContext();
    const itemFilter = params.itemId !== undefined ? sql`AND i.id = ${params.itemId}` : sql``;
    const whFilter = params.warehouseId !== undefined ? sql`AND s.warehouse_id = ${params.warehouseId}` : sql``;
    const rows = await this.tx().execute(sql`
      SELECT i.id AS "itemId", i.sku, i.name, i.name_ar AS "nameAr",
        s.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
        s.qty::text AS on_hand,
        COALESCE(q.na, 0)::text AS quarantined,
        COALESCE(r.reserved, 0)::text AS reserved,
        COALESCE(c.owner, 0)::text AS "consignmentOwned",
        COALESCE(ib.inbound, 0)::text AS inbound
      FROM item_stock s
      JOIN items i ON i.id = s.item_id AND i.tenant_id = erp.current_tenant_id()
        AND i.status = 'ACTIVE' AND i.deleted_at IS NULL ${itemFilter}
      JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = erp.current_tenant_id()
      LEFT JOIN (
        SELECT item_id, warehouse_id, SUM(qty) AS na FROM bin_contents
        WHERE owner_partner_id IS NULL AND status IN ('QUARANTINE', 'HOLD')
        GROUP BY item_id, warehouse_id
      ) q ON q.item_id = s.item_id AND q.warehouse_id = s.warehouse_id
      LEFT JOIN (
        SELECT item_id, warehouse_id, SUM(qty) AS owner FROM bin_contents
        WHERE owner_partner_id IS NOT NULL AND status = 'AVAILABLE'
        GROUP BY item_id, warehouse_id
      ) c ON c.item_id = s.item_id AND c.warehouse_id = s.warehouse_id
      LEFT JOIN (
        SELECT item_id, warehouse_id, SUM(qty) AS reserved FROM stock_reservations
        WHERE status = 'ACTIVE' AND qty > 0 AND (expires_at IS NULL OR expires_at > now())
        GROUP BY item_id, warehouse_id
      ) r ON r.item_id = s.item_id AND r.warehouse_id = s.warehouse_id
      LEFT JOIN (
        SELECT x.item_id, x.warehouse_id, SUM(x.qty) AS inbound FROM (
          SELECT pol.item_id, po.expected_date AS arrive_date, NULL::uuid AS warehouse_id, pol.qty AS qty
          FROM purchase_orders po
          JOIN purchase_order_lines pol ON pol.order_id = po.id AND pol.tenant_id = po.tenant_id
          WHERE po.status = 'ISSUED' AND po.expected_date IS NOT NULL
          UNION ALL
          SELECT po.item_id, po.planned_date AS arrive_date, po.fg_warehouse_id, GREATEST(po.planned_qty - po.actual_qty, 0)
          FROM production_orders po
          WHERE po.status IN ('RELEASED', 'IN_PROGRESS') AND po.planned_date IS NOT NULL
          UNION ALL
          SELECT stl.item_id, CURRENT_DATE AS arrive_date, st.to_warehouse_id, stl.qty
          FROM stock_transfers st
          JOIN stock_transfer_lines stl ON stl.transfer_id = st.id AND stl.tenant_id = st.tenant_id
          WHERE st.status = 'IN_TRANSIT'
          UNION ALL
          SELECT m.item_id, m.bucket_start AS arrive_date, m.warehouse_id, m.qty
          FROM mps_entries m WHERE m.status <> 'CANCELLED'
        ) x
        WHERE x.arrive_date <= CURRENT_DATE
        GROUP BY x.item_id, x.warehouse_id
      ) ib ON ib.item_id = s.item_id AND ib.warehouse_id = s.warehouse_id
      WHERE s.qty > 0 ${whFilter}
      ORDER BY i.sku, w.code
    `);
    const out: AtpPositionRow[] = [];
    for (const row of rows.rows as unknown as {
      itemId: string;
      sku: string;
      name: string;
      nameAr: string | null;
      warehouseId: string;
      warehouseCode: string;
      on_hand: string;
      quarantined: string;
      reserved: string;
      consignmentOwned: string;
      inbound: string;
    }[]) {
      const onHand = Number(row.on_hand);
      const quarantined = Number(row.quarantined);
      const reserved = Number(row.reserved);
      const inbound = Number(row.inbound);
      const available = Math.max(onHand - quarantined - reserved, 0);
      out.push({
        itemId: row.itemId,
        sku: row.sku,
        itemName: row.name,
        itemNameAr: row.nameAr,
        warehouseId: row.warehouseId,
        warehouseCode: row.warehouseCode,
        onHand: onHand.toFixed(6),
        quarantined: quarantined.toFixed(6),
        reserved: reserved.toFixed(6),
        consignmentOwned: Number(row.consignmentOwned).toFixed(6),
        available: available.toFixed(6),
        inbound: inbound.toFixed(6),
        ctp: (available + inbound).toFixed(6),
      });
    }
    return out;
  }

  private tx() {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("the planning report queries require an ambient tenant scope");
    }
    return context.tx;
  }
}
