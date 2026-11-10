import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { type TenantDb } from "../../../../infra/db/client";
import * as journal from "../../../accounting/infrastructure/journal.store";

/**
 * PHASE-018 T40 · the manufacturing report queries (industries/reports/README
 * PHASE-018 rows — the queries behind `manufacturing.production_cost`,
 * `manufacturing.batch_genealogy` and `manufacturing.qc_inspection_log`):
 * reporting-facing, read-only, executed inside the ambient tenant
 * transaction exactly like the PHASE-015/017 industry-queries precedents
 * (ADR-0011 — module-owned query surfaces; the reporting service locator
 * constructs them directly).
 *
 * Money discipline (ADR-0009): every monetary figure is the exact 4-decimal
 * quantum the posting chain already carries (consumption values, scrap
 * values, the order's absorbed labor/overhead/fg figures) — no parallel
 * math, tolerance 0. Quantities are the canonical 6-decimal strings. The
 * per-order WIP balance is the sumOrderWip formula ALL-TIME (Σ consumptions
 * − Σ scraps − wip_credit_value), the same identity the §11 reconciliation
 * reconciles.
 *
 * The genealogy walk mirrors the manufacturing module's GenealogyService
 * semantics (MASTER-PLAN §10: iterative BFS, expand-once visited set on
 * batch ids, one edge per consumption row, 16-level cap that stops without
 * error) but does its OWN raw-SQL walk over the published tables — the
 * module's service returns doc IDS ONLY by design (§10 decision), and this
 * reporting surface enriches the sales edges with the customer document
 * numbers (sales_invoices.invoice_no / delivery_notes.delivery_no) while
 * keeping the reporting→published-tables read-only direction (it never
 * imports the manufacturing module).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("manufacturing report query requires an ambient tenant scope");
  }
  return context.tx;
}

function idsScopeSql(
  ids: readonly string[] | null | undefined,
  column: string,
): ReturnType<typeof sql> {
  if (ids === null || ids === undefined || ids.length === 0) {
    return sql`TRUE`;
  }
  return sql`${sql.raw(column)} IN (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

// -- manufacturing.production_cost ---------------------------------------------------

/** One production order's planned-vs-actual cost row (the report's grain). */
export interface ProductionCostReportRow {
  orderId: string;
  orderNo: string | null;
  status: string;
  sku: string;
  itemName: string | null;
  plannedQty: string;
  actualQty: string;
  /** actualQty ÷ plannedQty × 100 (4dp). */
  yieldPct: string;
  /** Σ production_order_lines.planned_qty (the frozen explosion snapshot). */
  plannedComponentsQty: string;
  /** Σ production_order_lines.actual_qty. */
  consumedQty: string;
  /** Count of order lines flagged over_plan (the §5 variance review). */
  overPlanLines: number;
  /** Σ production_consumptions.value in the window (4dp). */
  consumedValue: string;
  /** Σ production_scraps.value in the window (4dp). */
  scrapValue: string;
  /** Count of in-window scraps. */
  scrapCount: number;
  /** planned_qty × labor_rate (4dp). */
  plannedLaborValue: string;
  /** planned_qty × overhead_rate (4dp). */
  plannedOverheadValue: string;
  /** The absorbed actual labor (order row). */
  laborValue: string;
  /** The absorbed actual overhead (order row). */
  overheadValue: string;
  /** The completion's FG value (order row). */
  fgValue: string;
  /** Σ consumptions − Σ scraps − wip_credit_value, ALL-TIME (sumOrderWip). */
  wipBalance: string;
}

// -- manufacturing.batch_genealogy ---------------------------------------------------

/** The queried batch's identity header (null when the batch is unknown). */
export interface GenealogyReportBatch {
  batchId: string;
  batchNo: string;
  sku: string;
  status: string;
  expiryDate: string | null;
}

/**
 * One recall edge, flat across the three kinds: MATERIAL (upstream — a
 * material batch consumed by the producing order at that depth), PRODUCED
 * (downstream — an order that consumed a batch in the walk and the FG batch
 * it produced), SOLD (downstream — a customer-facing sale off a batch in
 * the walk, enriched with the document number).
 */
export type GenealogyReportRow =
  | {
      kind: "MATERIAL";
      /** Hops from the queried batch (1 = the producing order's inputs). */
      level: number;
      batchNo: string;
      sku: string;
      qty: string;
      /** The consuming order (the producing order of the batch at that depth). */
      orderNo: string | null;
      /** The material batch's own producing order (null when purchased). */
      producedByOrderNo: string | null;
      docNo: null;
      docDate: null;
    }
  | {
      kind: "PRODUCED";
      /** Hops from the queried batch (1 = an order that consumed it directly). */
      level: number;
      /** The produced FG batch (null until the consuming order completed). */
      batchNo: string | null;
      /** The FG item's sku (null with the batch). */
      sku: string | null;
      /** Qty consumed from the source batch (6dp). */
      qty: string;
      /** The producing order. */
      orderNo: string | null;
      producedByOrderNo: null;
      docNo: null;
      docDate: null;
    }
  | {
      kind: "SOLD";
      /** Hops from the queried batch (1 = the queried batch itself sold). */
      level: number;
      /** The sold batch. */
      batchNo: string;
      sku: string;
      /** The move qty (6dp). */
      qty: string;
      orderNo: null;
      producedByOrderNo: null;
      /** The customer document number (invoice_no / delivery_no). */
      docNo: string | null;
      /** The move's calendar date. */
      docDate: string;
    };

// -- manufacturing.qc_inspection_log -------------------------------------------------

/** One inspection row joined with its target documents and FG batch. */
export interface QcInspectionLogRow {
  inspectionId: string;
  inspectedAt: string;
  targetType: string;
  orderNo: string | null;
  grnNo: string | null;
  fgBatchNo: string | null;
  result: string;
  sampled: boolean;
  sampleSize: number | null;
  disposition: string | null;
  note: string | null;
}

@Injectable()
export class ManufacturingQueriesService {
  /**
   * `manufacturing.production_cost`: per-order planned-vs-actual rows for
   * every production order with ANY activity in the window (a consumption
   * or a scrap in window, or completed_at in window — the
   * listOrderWipBalances activity definition), optional status filter,
   * optional branch scope. The money columns are the exact posted quanta;
   * the WIP balance is the ALL-TIME sumOrderWip identity (exactly zero for
   * every completed order — the per-order net the completion journal
   * guarantees).
   */
  async productionCost(input: {
    fromDate: string;
    toDate: string;
    status?: string | null;
    branchIds?: readonly string[] | null;
  }): Promise<ProductionCostReportRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT o.id AS "orderId", o.order_no AS "orderNo", o.status,
             i.sku, i.name AS "itemName",
             o.planned_qty::text AS "plannedQty", o.actual_qty::text AS "actualQty",
             (o.actual_qty / o.planned_qty * 100)::numeric(19,4)::text AS "yieldPct",
             COALESCE(planned.total_qty, 0)::numeric(19,6)::text AS "plannedComponentsQty",
             COALESCE(actual.total_qty, 0)::numeric(19,6)::text AS "consumedQty",
             COALESCE(overplan.n, 0)::int AS "overPlanLines",
             COALESCE(cons.value, 0)::numeric(19,4)::text AS "consumedValue",
             COALESCE(scr.value, 0)::numeric(19,4)::text AS "scrapValue",
             COALESCE(scr.n, 0)::int AS "scrapCount",
             (o.planned_qty * o.labor_rate)::numeric(19,4)::text AS "plannedLaborValue",
             (o.planned_qty * o.overhead_rate)::numeric(19,4)::text AS "plannedOverheadValue",
             o.labor_value::text AS "laborValue", o.overhead_value::text AS "overheadValue",
             o.fg_value::text AS "fgValue",
             (COALESCE(consAll.value, 0) - COALESCE(scrAll.value, 0) - o.wip_credit_value)
               ::numeric(19,4)::text AS "wipBalance"
      FROM production_orders o
      JOIN items i ON i.id = o.item_id AND i.tenant_id = o.tenant_id
      LEFT JOIN LATERAL (
        SELECT sum(planned_qty) AS total_qty FROM production_order_lines
        WHERE order_id = o.id
      ) planned ON true
      LEFT JOIN LATERAL (
        SELECT sum(actual_qty) AS total_qty FROM production_order_lines
        WHERE order_id = o.id
      ) actual ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n FROM production_order_lines
        WHERE order_id = o.id AND over_plan
      ) overplan ON true
      LEFT JOIN LATERAL (
        SELECT sum(value) AS value FROM production_consumptions
        WHERE order_id = o.id AND consumed_at::date BETWEEN ${input.fromDate} AND ${input.toDate}
      ) cons ON true
      LEFT JOIN LATERAL (
        SELECT sum(value) AS value, count(*)::int AS n FROM production_scraps
        WHERE order_id = o.id AND scrapped_at::date BETWEEN ${input.fromDate} AND ${input.toDate}
      ) scr ON true
      LEFT JOIN LATERAL (
        SELECT sum(value) AS value FROM production_consumptions
        WHERE order_id = o.id
      ) consAll ON true
      LEFT JOIN LATERAL (
        SELECT sum(value) AS value FROM production_scraps
        WHERE order_id = o.id
      ) scrAll ON true
      WHERE (
        EXISTS (SELECT 1 FROM production_consumptions c
                WHERE c.order_id = o.id AND c.consumed_at::date BETWEEN ${input.fromDate} AND ${input.toDate})
        OR EXISTS (SELECT 1 FROM production_scraps s
                   WHERE s.order_id = o.id AND s.scrapped_at::date BETWEEN ${input.fromDate} AND ${input.toDate})
        OR (o.completed_at IS NOT NULL AND o.completed_at::date BETWEEN ${input.fromDate} AND ${input.toDate})
      )
        AND (${input.status ?? null}::text IS NULL OR o.status = ${input.status ?? null})
        AND ${idsScopeSql(input.branchIds, "o.branch_id")}
      ORDER BY o.order_no
      LIMIT 500
    `);
    return rows.rows as unknown as ProductionCostReportRow[];
  }

  /**
   * The `production-materials-gl-tie`: register side (Σ consumed-materials
   * value in the window) vs GL side (Σ DEBITS on the WIP-purpose accounts of
   * the production consume journals in the window — source
   * production_order:consume_<seq>, POSTED). One journal per consume call,
   * its WIP debit exactly the call's total value, so the tie catches any
   * drift at tolerance 0 (the commissionsTotalTie pattern: no WIP account
   * mapped → the GL side is an honest 0.0000).
   */
  async productionCostGlTie(input: {
    fromDate: string;
    toDate: string;
    branchIds?: readonly string[] | null;
  }): Promise<{ registerSide: string; glSide: string }> {
    const registerRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(c.value), 0)::numeric(19,4)::text AS total
      FROM production_consumptions c
      JOIN production_orders o ON o.id = c.order_id AND o.tenant_id = c.tenant_id
      WHERE c.consumed_at::date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${idsScopeSql(input.branchIds, "o.branch_id")}
    `);
    const wipAccounts = await journal.accountsForPurposes(["WIP"]);
    let gl = "0.0000";
    if (wipAccounts.length > 0) {
      const glRows = await tenantTx().execute(sql`
        SELECT COALESCE(SUM(l.amount), 0)::numeric(19,4)::text AS total
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
        WHERE e.source_type = 'production_order' AND e.operation LIKE 'consume\\_%'
          AND e.status = 'POSTED'
          AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND l.direction = 'DEBIT'
          AND l.account_id IN (${sql.join(
            wipAccounts.map((a) => sql`${a.accountId}`),
            sql`, `,
          )})
      `);
      gl = (glRows.rows[0] as { total: string }).total;
    }
    return {
      registerSide: (registerRows.rows[0] as { total: string }).total,
      glSide: gl,
    };
  }

  /**
   * `manufacturing.batch_genealogy`: the recall walk WITH DOC NUMBERS for
   * one batch — upstream MATERIAL edges (the producing order's inputs,
   * recursing through produced material batches), downstream PRODUCED edges
   * (the orders that consumed a batch in the walk, with the FG batch each
   * produced) and downstream SOLD edges (customer-facing sales off any
   * batch in the walk, enriched with sales_invoices.invoice_no /
   * delivery_notes.delivery_no — the MASTER-PLAN §10 decision: the module's
   * walk returns ids only; THIS surface adds the doc numbers).
   *
   * Walk semantics mirror the GenealogyService: iterative BFS, level =
   * HOPS, expand-once visited set on batch ids, one edge per consumption
   * row, 16-level depth cap (stops, never errors). An unknown batch is NOT
   * an error here — the walk returns { batch: null, rows: [] } and the
   * contract surfaces the miss as an empty result with a note (a recall
   * search miss is not a 500; the typed GenealogyBatchNotFoundError stays
   * manufacturing-owned).
   */
  async batchGenealogy(input: {
    batchId: string;
  }): Promise<{ batch: GenealogyReportBatch | null; rows: GenealogyReportRow[] }> {
    const batchRows = await tenantTx().execute(sql`
      SELECT b.id AS "batchId", b.batch_no AS "batchNo", i.sku, b.status,
             b.expiry_date::text AS "expiryDate", b.production_order_id AS "productionOrderId"
      FROM item_batches b
      JOIN items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
      WHERE b.id = ${input.batchId} LIMIT 1
    `);
    const batch = (batchRows.rows as unknown as {
      batchId: string;
      batchNo: string;
      sku: string;
      status: string;
      expiryDate: string | null;
      productionOrderId: string | null;
    }[])[0];
    if (batch === undefined) {
      return { batch: null, rows: [] };
    }

    const rows: GenealogyReportRow[] = [];

    // -- upstream (MATERIAL): the producing order's batch-bound inputs, -----
    // -- recursing through material batches that were themselves produced --
    if (batch.productionOrderId !== null) {
      const expandedBatches = new Set<string>([input.batchId]);
      let frontier: { orderId: string; level: number }[] = [
        { orderId: batch.productionOrderId, level: 1 },
      ];
      while (frontier.length > 0) {
        const levelByOrder = new Map(frontier.map((entry) => [entry.orderId, entry.level]));
        const frontierOrderIds = [...levelByOrder.keys()];
        const consumptions = await consumptionsByOrderIds(frontierOrderIds);
        const producingOrderIds = [
          ...new Set(
            consumptions
              .map((edge) => edge.productionOrderId)
              .filter((id): id is string => id !== null),
          ),
        ];
        const orderNoById = await orderNosByIds([
          ...new Set([...frontierOrderIds, ...producingOrderIds]),
        ]);
        const next: { orderId: string; level: number }[] = [];
        for (const edge of consumptions) {
          const level = levelByOrder.get(edge.orderId) ?? 1;
          rows.push({
            kind: "MATERIAL",
            level,
            batchNo: edge.batchNo,
            sku: edge.sku,
            qty: edge.qty,
            orderNo: orderNoById.get(edge.orderId) ?? null,
            producedByOrderNo:
              edge.productionOrderId !== null
                ? (orderNoById.get(edge.productionOrderId) ?? null)
                : null,
            docNo: null,
            docDate: null,
          });
          if (
            edge.productionOrderId !== null &&
            !expandedBatches.has(edge.batchId) &&
            level < MAX_GENEALOGY_DEPTH
          ) {
            expandedBatches.add(edge.batchId);
            next.push({ orderId: edge.productionOrderId, level: level + 1 });
          }
        }
        frontier = next;
      }
    }

    // -- downstream (PRODUCED + SOLD): the consuming orders' FG batches ----
    // -- (recursing) and the sales edges off every batch in the walk -------
    const batchLabelById = new Map<string, { batchNo: string; sku: string }>([
      [batch.batchId, { batchNo: batch.batchNo, sku: batch.sku }],
    ]);
    const visited = new Set<string>([input.batchId]);
    let frontier: { batchId: string; depth: number }[] = [{ batchId: input.batchId, depth: 0 }];
    while (frontier.length > 0) {
      const depthByBatch = new Map(frontier.map((entry) => [entry.batchId, entry.depth]));
      const frontierBatchIds = [...depthByBatch.keys()];
      const consumptions = await consumptionsByBatchIds(frontierBatchIds);
      const saleEdges = await salesEdgesByBatchIds(frontierBatchIds);
      const orderIds = [...new Set(consumptions.map((edge) => edge.orderId))];
      const orderById = await ordersByIds(orderIds);
      const fgBatchIds = [
        ...new Set(
          [...orderById.values()]
            .map((order) => order.fgBatchId)
            .filter((id): id is string => id !== null),
        ),
      ];
      for (const fgBatch of await batchesByIds(fgBatchIds)) {
        batchLabelById.set(fgBatch.batchId, { batchNo: fgBatch.batchNo, sku: fgBatch.sku });
      }

      for (const edge of consumptions) {
        const order = orderById.get(edge.orderId);
        const fgBatch = order?.fgBatchId != null ? batchLabelById.get(order.fgBatchId) : undefined;
        rows.push({
          kind: "PRODUCED",
          level: (depthByBatch.get(edge.batchId) ?? 0) + 1,
          batchNo: fgBatch?.batchNo ?? null,
          sku: fgBatch?.sku ?? null,
          qty: edge.qty,
          orderNo: order?.orderNo ?? null,
          producedByOrderNo: null,
          docNo: null,
          docDate: null,
        });
      }
      for (const edge of saleEdges) {
        rows.push({
          kind: "SOLD",
          level: (depthByBatch.get(edge.batchId) ?? 0) + 1,
          batchNo: batchLabelById.get(edge.batchId)?.batchNo ?? "",
          sku: batchLabelById.get(edge.batchId)?.sku ?? "",
          qty: edge.qty,
          orderNo: null,
          producedByOrderNo: null,
          docNo: edge.sourceType === "sales_invoice" ? edge.invoiceNo : edge.deliveryNo,
          docDate: edge.docDate,
        });
      }

      // The consuming orders' FG batches join the next frontier (expand-once
      // visited set + the depth cap).
      const next: { batchId: string; depth: number }[] = [];
      for (const edge of consumptions) {
        const order = orderById.get(edge.orderId);
        if (order === undefined || order.fgBatchId === null) continue;
        if (visited.has(order.fgBatchId)) continue;
        const depth = depthByBatch.get(edge.batchId) ?? 0;
        if (depth + 1 > MAX_GENEALOGY_DEPTH) continue;
        visited.add(order.fgBatchId);
        next.push({ batchId: order.fgBatchId, depth: depth + 1 });
      }
      frontier = next;
    }

    // Kind asc (MATERIAL < PRODUCED < SOLD), then level, then batchNo — the
    // brief's stable recall ordering.
    rows.sort((a, b) => {
      if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      if (a.level !== b.level) return a.level - b.level;
      const aNo = a.batchNo ?? "";
      const bNo = b.batchNo ?? "";
      return aNo < bNo ? -1 : aNo > bNo ? 1 : 0;
    });
    return {
      batch: {
        batchId: batch.batchId,
        batchNo: batch.batchNo,
        sku: batch.sku,
        status: batch.status,
        expiryDate: batch.expiryDate,
      },
      rows,
    };
  }

  /**
   * `manufacturing.qc_inspection_log`: one row per inspection whose
   * inspected_at date falls in the window, joined with the target documents
   * (the production order's PRD number / the goods receipt's number) and
   * the FG batch the inspection decided over. Operational QC register — no
   * GL assertion (the README rule-2 note).
   */
  async qcInspectionLog(input: {
    fromDate: string;
    toDate: string;
  }): Promise<QcInspectionLogRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT ins.id AS "inspectionId", ins.inspected_at::date::text AS "inspectedAt",
             ins.target_type AS "targetType",
             po.order_no AS "orderNo", gr.receipt_no AS "grnNo", b.batch_no AS "fgBatchNo",
             ins.result, ins.sampled, ins.sample_size AS "sampleSize",
             ins.disposition, ins.note
      FROM inspections ins
      LEFT JOIN production_orders po ON po.id = ins.order_id AND po.tenant_id = ins.tenant_id
      LEFT JOIN goods_receipts gr ON gr.id = ins.grn_id AND gr.tenant_id = ins.tenant_id
      LEFT JOIN item_batches b ON b.id = ins.fg_batch_id AND b.tenant_id = ins.tenant_id
      WHERE ins.inspected_at::date BETWEEN ${input.fromDate} AND ${input.toDate}
      ORDER BY ins.inspected_at, ins.created_at
      LIMIT 500
    `);
    return rows.rows as unknown as QcInspectionLogRow[];
  }
}

/** The recall walk's depth cap (the GenealogyService precedent — stops, no error). */
const MAX_GENEALOGY_DEPTH = 16;

/** The recall kind ordering: MATERIAL first, then PRODUCED, then SOLD. */
const KIND_ORDER: Record<GenealogyReportRow["kind"], number> = {
  MATERIAL: 0,
  PRODUCED: 1,
  SOLD: 2,
};

// -- the genealogy walk's batched reads (level-granular, mirroring the
// -- manufacturing store's genealogy section shapes) --------------------------

/** Upstream edges: a set of orders' batch-bound consumptions with the
 * material batch identity + its producing order. */
async function consumptionsByOrderIds(
  orderIds: readonly string[],
): Promise<
  { orderId: string; batchId: string; batchNo: string; sku: string; productionOrderId: string | null; qty: string }[]
> {
  if (orderIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT c.order_id AS "orderId", c.batch_id AS "batchId", c.qty::text AS qty,
           mb.batch_no AS "batchNo", mi.sku, mb.production_order_id AS "productionOrderId"
    FROM production_consumptions c
    JOIN item_batches mb ON mb.id = c.batch_id AND mb.tenant_id = c.tenant_id
    JOIN items mi ON mi.id = mb.item_id AND mi.tenant_id = mb.tenant_id
    WHERE c.order_id IN (${sql.join(
      orderIds.map((id) => sql`${id}`),
      sql`, `,
    )}) AND c.batch_id IS NOT NULL
    ORDER BY c.order_id, c.batch_id
  `);
  return rows.rows as unknown as {
    orderId: string;
    batchId: string;
    batchNo: string;
    sku: string;
    productionOrderId: string | null;
    qty: string;
  }[];
}

/** Downstream edges: the orders that consumed a set of batches. */
async function consumptionsByBatchIds(
  batchIds: readonly string[],
): Promise<{ orderId: string; batchId: string; qty: string }[]> {
  if (batchIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT order_id AS "orderId", batch_id AS "batchId", qty::text AS qty
    FROM production_consumptions
    WHERE batch_id IN (${sql.join(
      batchIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    ORDER BY order_id, batch_id
  `);
  return rows.rows as unknown as { orderId: string; batchId: string; qty: string }[];
}

/** Order numbers for a set of order ids. */
async function orderNosByIds(orderIds: readonly string[]): Promise<Map<string, string | null>> {
  if (orderIds.length === 0) return new Map();
  const rows = await tenantTx().execute(sql`
    SELECT id, order_no AS "orderNo" FROM production_orders
    WHERE id IN (${sql.join(
      orderIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return new Map(
    (rows.rows as unknown as { id: string; orderNo: string | null }[]).map((row) => [
      row.id,
      row.orderNo,
    ]),
  );
}

/** The consuming orders' identity (orderNo + FG batch binding). */
async function ordersByIds(
  orderIds: readonly string[],
): Promise<Map<string, { orderNo: string | null; fgBatchId: string | null }>> {
  if (orderIds.length === 0) return new Map();
  const rows = await tenantTx().execute(sql`
    SELECT id, order_no AS "orderNo", fg_batch_id AS "fgBatchId" FROM production_orders
    WHERE id IN (${sql.join(
      orderIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return new Map(
    (rows.rows as unknown as { id: string; orderNo: string | null; fgBatchId: string | null }[]).map(
      (row) => [row.id, { orderNo: row.orderNo, fgBatchId: row.fgBatchId }],
    ),
  );
}

/** Batch labels (batchNo + sku) for a set of batch ids. */
async function batchesByIds(
  batchIds: readonly string[],
): Promise<{ batchId: string; batchNo: string; sku: string }[]> {
  if (batchIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT b.id AS "batchId", b.batch_no AS "batchNo", i.sku
    FROM item_batches b
    JOIN items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
    WHERE b.id IN (${sql.join(
      batchIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return rows.rows as unknown as { batchId: string; batchNo: string; sku: string }[];
}

/** Sales edges off a set of batches, enriched with the customer document
 * numbers (sales_invoices.invoice_no / delivery_notes.delivery_no — the §10
 * doc-number enrichment) and the move's calendar date. */
async function salesEdgesByBatchIds(
  batchIds: readonly string[],
): Promise<
  {
    batchId: string;
    sourceType: string;
    invoiceNo: string | null;
    deliveryNo: string | null;
    docDate: string;
    qty: string;
  }[]
> {
  if (batchIds.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT m.batch_id AS "batchId", m.source_type AS "sourceType",
           si.invoice_no AS "invoiceNo", dn.delivery_no AS "deliveryNo",
           m.moved_at::date::text AS "docDate", m.qty::text AS qty
    FROM stock_moves m
    LEFT JOIN sales_invoices si
      ON si.id = m.source_id AND si.tenant_id = m.tenant_id AND m.source_type = 'sales_invoice'
    LEFT JOIN delivery_notes dn
      ON dn.id = m.source_id AND dn.tenant_id = m.tenant_id AND m.source_type = 'delivery_note'
    WHERE m.batch_id IN (${sql.join(
      batchIds.map((id) => sql`${id}`),
      sql`, `,
    )}) AND m.source_type IN ('sales_invoice', 'delivery_note') AND m.direction = 'OUT'
    ORDER BY m.moved_at, m.id
  `);
  return rows.rows as unknown as {
    batchId: string;
    sourceType: string;
    invoiceNo: string | null;
    deliveryNo: string | null;
    docDate: string;
    qty: string;
  }[];
}
