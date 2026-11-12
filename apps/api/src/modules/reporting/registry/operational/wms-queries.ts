import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";

/**
 * PHASE-044 T-17 · the WMS intelligence query surface for the four report
 * contracts (registry/operational/wms.ts): the bin-contents register (with
 * the owner-partner and status visibility BR-076 demands), the cycle-count
 * variance register (the cycle_count_documents family — distinct from the
 * legacy stock_counts variance report), the ABC classification (the latest
 * generation), and the slow-movement intelligence view (the ABC-joined
 * no-outbound fold — the slotting-hint angle over the T-12 alert's shape).
 * All read-only over the ambient tenant transaction (the registry
 * query-service convention — the 042 manufacturing pattern verbatim).
 */

export interface WmsBinContentsReportRow {
  contentId: string;
  warehouseCode: string | null;
  binCode: string;
  zoneCode: string | null;
  itemSku: string | null;
  itemName: string | null;
  batchNo: string | null;
  serialNo: string | null;
  lpnCode: string | null;
  ownerPartnerName: string | null;
  status: string;
  qty: string;
}

export interface WmsCycleCountVarianceRow {
  documentId: string;
  countNo: string | null;
  warehouseCode: string | null;
  lineNo: number;
  itemSku: string | null;
  binCode: string | null;
  batchNo: string | null;
  systemQty: string;
  countedQty: string | null;
  varianceQty: string | null;
  valueImpact: string | null;
  reason: string | null;
  status: string;
  countedAt: string | null;
  postedJournalId: string | null;
}

export interface WmsAbcReportRow {
  itemId: string;
  itemSku: string | null;
  itemName: string | null;
  cls: string;
  consumptionValue: string;
  totalQtyOut: string;
  velocity: string;
  rankNo: number;
  windowDays: number;
  computedAt: string;
}

export interface WmsSlowMovementRow {
  itemId: string;
  itemSku: string | null;
  itemName: string | null;
  warehouseCode: string | null;
  onHand: string;
  lastOutAt: string | null;
  binCount: number;
  cls: string | null;
}

export class WmsQueriesService {
  /** The INV-029 probe fold (the wms-store's detector read, verbatim):
   * every (warehouse, item) where Σ tenant-owned bin_contents ≠ item_stock. */
  async binStockTie(params: { warehouseId?: string }): Promise<
    { warehouseId: string; warehouseCode: string | null; itemId: string; itemSku: string | null; binQty: string; stockQty: string; difference: string }[]
  > {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("wms report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      WITH bins AS (
        SELECT warehouse_id, item_id, sum(qty) AS bin_qty
        FROM bin_contents WHERE owner_partner_id IS NULL
        GROUP BY warehouse_id, item_id
      ), stock AS (
        SELECT warehouse_id, item_id, qty AS stock_qty FROM item_stock
      )
      SELECT COALESCE(b.warehouse_id, s.warehouse_id) AS "warehouseId",
             w.code AS "warehouseCode",
             COALESCE(b.item_id, s.item_id) AS "itemId", i.sku AS "itemSku",
             COALESCE(b.bin_qty, 0)::text AS "binQty",
             COALESCE(s.stock_qty, 0)::text AS "stockQty",
             (COALESCE(b.bin_qty, 0) - COALESCE(s.stock_qty, 0))::text AS difference
      FROM bins b
      FULL OUTER JOIN stock s ON s.warehouse_id = b.warehouse_id AND s.item_id = b.item_id
      LEFT JOIN warehouses w ON w.id = COALESCE(b.warehouse_id, s.warehouse_id) AND w.tenant_id = erp.current_tenant_id()
      LEFT JOIN items i ON i.id = COALESCE(b.item_id, s.item_id) AND i.tenant_id = erp.current_tenant_id()
      WHERE (${params.warehouseId ?? null}::uuid IS NULL
               OR COALESCE(b.warehouse_id, s.warehouse_id) = ${params.warehouseId ?? null}::uuid)
        AND COALESCE(b.bin_qty, 0) <> COALESCE(s.stock_qty, 0)
      ORDER BY w.code, i.sku
      LIMIT 500`);
    return rows.rows as unknown as {
      warehouseId: string;
      warehouseCode: string | null;
      itemId: string;
      itemSku: string | null;
      binQty: string;
      stockQty: string;
      difference: string;
    }[];
  }

  /** The bin-contents register: one row per live bin_contents row with the
   * location identity, the status, and the owner (BR-076's visibility —
   * consignment rows appear WITH their owner, excluded from valuation
   * elsewhere, never hidden here). */
  async binContents(params: {
    warehouseId?: string;
    status?: "AVAILABLE" | "QUARANTINE" | "HOLD";
  }): Promise<WmsBinContentsReportRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("wms report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT bc.id AS "contentId", w.code AS "warehouseCode", b.code AS "binCode",
             z.code AS "zoneCode", i.sku AS "itemSku", i.name AS "itemName",
             bt.batch_no AS "batchNo", s.serial_no AS "serialNo", l.lpn_code AS "lpnCode",
             p.name AS "ownerPartnerName", bc.status, bc.qty::text AS qty
      FROM bin_contents bc
      JOIN warehouse_bins b ON b.id = bc.bin_id AND b.tenant_id = bc.tenant_id
      LEFT JOIN warehouse_aisles a ON a.id = b.rack_id AND a.tenant_id = bc.tenant_id
      LEFT JOIN warehouse_racks r ON r.id = b.rack_id AND r.tenant_id = bc.tenant_id
      LEFT JOIN warehouse_aisles a2 ON a2.id = r.aisle_id AND a2.tenant_id = bc.tenant_id
      LEFT JOIN warehouse_zones z ON z.id = a2.zone_id AND z.tenant_id = bc.tenant_id
      LEFT JOIN warehouses w ON w.id = bc.warehouse_id AND w.tenant_id = bc.tenant_id
      LEFT JOIN items i ON i.id = bc.item_id AND i.tenant_id = bc.tenant_id
      LEFT JOIN item_batches bt ON bt.id = bc.batch_id AND bt.tenant_id = bc.tenant_id
      LEFT JOIN item_serials s ON s.id = bc.serial_id AND s.tenant_id = bc.tenant_id
      LEFT JOIN lpns l ON l.id = bc.lpn_id AND l.tenant_id = bc.tenant_id
      LEFT JOIN partners p ON p.id = bc.owner_partner_id AND p.tenant_id = bc.tenant_id
      WHERE bc.qty > 0
        AND (${params.warehouseId ?? null}::uuid IS NULL OR bc.warehouse_id = ${params.warehouseId ?? null})
        AND (${params.status ?? null}::text IS NULL OR bc.status = ${params.status ?? null})
      ORDER BY w.code, b.code, i.sku
      LIMIT 5000`);
    return rows.rows as unknown as WmsBinContentsReportRow[];
  }

  /** The cycle-count variance register: the WMS cycle_count_documents ×
   * lines with per-line variance + value impact (the legacy
   * inventory.count-variance report reads stock_counts — this is the
   * §2.6 family). */
  async cycleCountVariance(params: {
    warehouseId?: string;
    postedOnly?: boolean;
  }): Promise<WmsCycleCountVarianceRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("wms report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT d.id AS "documentId", d.count_no AS "countNo", w.code AS "warehouseCode",
             ccl.line_no AS "lineNo", i.sku AS "itemSku", b.code AS "binCode",
             bt.batch_no AS "batchNo", ccl.system_qty::text AS "systemQty",
             ccl.counted_qty::text AS "countedQty",
             (ccl.counted_qty - ccl.system_qty)::text AS "varianceQty",
             ccl.value_impact::text AS "valueImpact", ccl.reason,
             d.status, ccl.updated_at::text AS "countedAt",
             d.posted_journal_id AS "postedJournalId"
      FROM cycle_count_documents d
      JOIN cycle_count_lines ccl ON ccl.document_id = d.id AND ccl.tenant_id = d.tenant_id
      LEFT JOIN warehouses w ON w.id = d.warehouse_id AND w.tenant_id = d.tenant_id
      LEFT JOIN items i ON i.id = ccl.item_id AND i.tenant_id = d.tenant_id
      LEFT JOIN warehouse_bins b ON b.id = ccl.bin_id AND b.tenant_id = d.tenant_id
      LEFT JOIN item_batches bt ON bt.id = ccl.batch_id AND bt.tenant_id = d.tenant_id
      WHERE (${params.warehouseId ?? null}::uuid IS NULL OR d.warehouse_id = ${params.warehouseId ?? null})
        AND (${params.postedOnly ?? false} = false OR d.status = 'POSTED')
      ORDER BY d.snapshot_at DESC, ccl.line_no
      LIMIT 5000`);
    return rows.rows as unknown as WmsCycleCountVarianceRow[];
  }

  /** The ABC classification register: the latest generation rows. */
  async abcClassification(params: { cls?: "A" | "B" | "C" }): Promise<WmsAbcReportRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("wms report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT a.item_id AS "itemId", i.sku AS "itemSku", i.name AS "itemName",
             a."class" AS cls, a.consumption_value::text AS "consumptionValue",
             a.total_qty_out::text AS "totalQtyOut", a.velocity::text AS "velocity",
             a.rank_no AS "rankNo", a.window_days AS "windowDays",
             a.computed_at::text AS "computedAt"
      FROM abc_classifications a
      LEFT JOIN items i ON i.id = a.item_id AND i.tenant_id = a.tenant_id
      WHERE a.is_latest AND (${params.cls ?? null}::text IS NULL OR a."class" = ${params.cls ?? null})
      ORDER BY a.rank_no
      LIMIT 5000`);
    return rows.rows as unknown as WmsAbcReportRow[];
  }

  /** The slow-movement intelligence view: stocked (warehouse, item) rows
   * with no outbound in the window, joined to the live bin spread and the
   * latest ABC class — the slotting-hint fold (C-class + idle + wide bin
   * spread = the consolidation candidates). */
  async slowMovement(params: { windowDays: number }): Promise<WmsSlowMovementRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("wms report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      WITH last_out AS (
        SELECT item_id, warehouse_id, MAX(moved_at) AS last_out_at
        FROM stock_moves WHERE direction = 'OUT' AND move_kind IN ('issue', 'adjust')
        GROUP BY item_id, warehouse_id
      )
      SELECT s.item_id AS "itemId", i.sku AS "itemSku", i.name AS "itemName",
             w.code AS "warehouseCode", s.qty::text AS "onHand",
             lo.last_out_at::text AS "lastOutAt",
             (SELECT COUNT(DISTINCT bc.bin_id) FROM bin_contents bc
               WHERE bc.warehouse_id = s.warehouse_id AND bc.item_id = s.item_id AND bc.qty > 0) AS "binCount",
             (SELECT a."class" FROM abc_classifications a
               WHERE a.item_id = s.item_id AND a.is_latest LIMIT 1) AS cls
      FROM item_stock s
      LEFT JOIN last_out lo ON lo.item_id = s.item_id AND lo.warehouse_id = s.warehouse_id
      LEFT JOIN items i ON i.id = s.item_id AND i.tenant_id = s.tenant_id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = s.tenant_id
      WHERE s.qty > 0
        AND (lo.last_out_at IS NULL OR lo.last_out_at < (now() - (${params.windowDays}::text || ' days')::interval))
      ORDER BY lo.last_out_at NULLS FIRST, i.sku
      LIMIT 5000`);
    return rows.rows as unknown as WmsSlowMovementRow[];
  }
}
