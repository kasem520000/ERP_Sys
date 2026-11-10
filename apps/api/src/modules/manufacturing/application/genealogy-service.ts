import { Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import * as store from "../infrastructure/manufacturing.store";
import { GenealogyBatchNotFoundError } from "../domain/manufacturing-errors";

/**
 * Genealogy service (PHASE-018 T39; MASTER-PLAN §10): READ-ONLY recall
 * analytics over the produced-batch provenance graph — the upstream material
 * walk (a batch's producing order → that order's batch-bound consumptions →
 * recurse into material batches that were themselves produced) and the
 * downstream walk (orders that consumed the batch → their FG batches →
 * recurse, PLUS the customer-facing sales edges off the append-only move
 * ledger). It never writes, never audits, and never alters a posted
 * document (MODULE_BOUNDARIES): every edge is a SELECT over
 * item_batches/production_orders/production_consumptions (manufacturing +
 * inventory owned) and stock_moves (inventory-owned, read-only — §10 allows
 * exactly this direction).
 *
 * The reporting module's `manufacturing.batch_genealogy` report (T40)
 * enriches the sales edges with document numbers — this service returns
 * DOC IDS ONLY (the MASTER-PLAN §10 decision; keeps the core walk free of
 * sales/billing table reads).
 *
 * Level semantics = HOPS from the queried batch (level 1 = the immediate
 * edges). Both walks are iterative BFS with batched store calls per level,
 * an expand-once visited set on BATCH ids (a batch reached twice is still
 * EDGE'd every time — one edge per consumption row — but its producing
 * order is expanded only once, which also guards pathological cycles), and
 * a 16-level depth cap that simply stops walking deeper (no error — recall
 * breadth trumps depth; deeper provenance is out of scope).
 */

const MAX_DEPTH = 16;

export interface GenealogyBatchRef {
  batchId: string;
  batchNo: string;
  itemId: string;
  sku: string;
  status: string;
  expiryDate: string | null;
}

export interface UpstreamMaterialEdge {
  /** Hops from the queried batch (1 = the producing order's inputs). */
  level: number;
  batchId: string;
  batchNo: string;
  itemId: string;
  sku: string;
  qty: string;
  consumedByOrderId: string;
  consumedByOrderNo: string | null;
  /** The material batch's own producing order (null for purchased batches). */
  producedByOrderId: string | null;
  producedByOrderNo: string | null;
}

export interface GenealogyUpstreamResult {
  batch: GenealogyBatchRef;
  materials: UpstreamMaterialEdge[];
}

export interface DownstreamProductionEdge {
  /** Hops from the queried batch (1 = an order that consumed it directly). */
  level: number;
  fromBatchId: string;
  fromBatchNo: string | null;
  orderId: string;
  orderNo: string | null;
  orderStatus: string;
  fgBatchId: string | null;
  fgBatchNo: string | null;
  fgItemId: string | null;
  fgSku: string | null;
  qty: string;
}

export interface DownstreamSaleEdge {
  /** Hops from the queried batch (1 = sold straight off it). */
  level: number;
  batchId: string;
  docType: "sales_invoice" | "delivery_note";
  docId: string;
  docDate: string;
  qty: string;
}

export interface GenealogyDownstreamResult {
  batch: GenealogyBatchRef;
  productions: DownstreamProductionEdge[];
  sales: DownstreamSaleEdge[];
}

export interface GenealogyBatchSummary {
  batch: GenealogyBatchRef;
  producingOrderId: string | null;
  producingOrderNo: string | null;
  onHand: string;
  consumedByOrders: { orderId: string; orderNo: string | null; qty: string }[];
  salesCount: number;
  inspectionsCount: number;
}

@Injectable()
export class GenealogyService {
  // No constructor dependencies — pure store reads (every entry point throws
  // GenealogyBatchNotFoundError before touching anything else).

  async upstream(batchId: string): Promise<GenealogyUpstreamResult> {
    const row = await store.findBatchForGenealogy(batchId);
    if (row === undefined) throw new GenealogyBatchNotFoundError(batchId);

    const materials: UpstreamMaterialEdge[] = [];
    if (row.productionOrderId === null) {
      // A purchased batch (no producing order) has no upstream material
      // edges — the empty-result behavior for untracked/unproduced batches.
      return { batch: batchRef(row), materials };
    }

    // Frontier = ORDERS to expand with the level their consumption edges
    // carry. Level 1 = the queried batch's producing order's inputs.
    const expandedBatches = new Set<string>([batchId]);
    let frontier: { orderId: string; level: number }[] = [
      { orderId: row.productionOrderId, level: 1 },
    ];
    while (frontier.length > 0) {
      const levelByOrder = new Map(frontier.map((entry) => [entry.orderId, entry.level]));
      const frontierOrderIds = [...levelByOrder.keys()];
      const consumptions = await store.listConsumptionsByOrderIds(frontierOrderIds);
      const materialBatchIds = [
        ...new Set(
          consumptions.map((edge) => edge.batchId).filter((id): id is string => id !== null),
        ),
      ];
      const batchRows = await store.listGenealogyBatches(materialBatchIds);
      const batchById = new Map(batchRows.map((batch) => [batch.id, batch]));
      const producingOrderIds = [
        ...new Set(
          batchRows
            .map((batch) => batch.productionOrderId)
            .filter((id): id is string => id !== null),
        ),
      ];
      const orders = await store.listProductionOrdersByIds([
        ...new Set([...frontierOrderIds, ...producingOrderIds]),
      ]);
      const orderNoById = new Map(orders.map((order) => [order.id, order.orderNo]));

      const next: { orderId: string; level: number }[] = [];
      for (const edge of consumptions) {
        if (edge.batchId === null) continue; // belt-and-braces (SQL filters)
        const materialBatch = batchById.get(edge.batchId);
        if (materialBatch === undefined) continue;
        const level = levelByOrder.get(edge.orderId) ?? 1;
        materials.push({
          level,
          batchId: materialBatch.id,
          batchNo: materialBatch.batchNo,
          itemId: materialBatch.itemId,
          sku: materialBatch.sku,
          qty: edge.qty,
          consumedByOrderId: edge.orderId,
          consumedByOrderNo: orderNoById.get(edge.orderId) ?? null,
          producedByOrderId: materialBatch.productionOrderId,
          producedByOrderNo:
            materialBatch.productionOrderId !== null
              ? (orderNoById.get(materialBatch.productionOrderId) ?? null)
              : null,
        });
        const producerId = materialBatch.productionOrderId;
        if (producerId !== null && !expandedBatches.has(materialBatch.id) && level < MAX_DEPTH) {
          // Expand each material batch once (its producing order's inputs
          // become the next level); the visited set also breaks cycles.
          expandedBatches.add(materialBatch.id);
          next.push({ orderId: producerId, level: level + 1 });
        }
      }
      frontier = next;
    }

    materials.sort(
      (a, b) =>
        a.level - b.level ||
        (a.consumedByOrderId < b.consumedByOrderId ? -1 : a.consumedByOrderId > b.consumedByOrderId ? 1 : 0) ||
        (a.batchId < b.batchId ? -1 : 1),
    );
    return { batch: batchRef(row), materials };
  }

  async downstream(batchId: string): Promise<GenealogyDownstreamResult> {
    const row = await store.findBatchForGenealogy(batchId);
    if (row === undefined) throw new GenealogyBatchNotFoundError(batchId);

    const productions: DownstreamProductionEdge[] = [];
    const sales: DownstreamSaleEdge[] = [];
    const batchById = new Map<string, store.GenealogyBatchRow>([[row.id, row]]);
    const visited = new Set<string>([batchId]);
    // Frontier = batches with their depth (queried = 0); edges land at
    // depth + 1.
    let frontier: { batchId: string; depth: number }[] = [{ batchId, depth: 0 }];
    while (frontier.length > 0) {
      const depthByBatch = new Map(frontier.map((entry) => [entry.batchId, entry.depth]));
      const frontierBatchIds = [...depthByBatch.keys()];
      const consumptions = await store.listConsumptionsByBatchIds(frontierBatchIds);
      const saleEdges = await store.listBatchSalesEdges(frontierBatchIds);
      const orderIds = [...new Set(consumptions.map((edge) => edge.orderId))];
      const orders = await store.listProductionOrdersByIds(orderIds);
      const orderById = new Map(orders.map((order) => [order.id, order]));
      const fgBatchIds = [
        ...new Set(
          orders.map((order) => order.fgBatchId).filter((id): id is string => id !== null),
        ),
      ];
      for (const fgBatch of await store.listGenealogyBatches(fgBatchIds)) {
        batchById.set(fgBatch.id, fgBatch);
      }

      for (const edge of consumptions) {
        const order = orderById.get(edge.orderId);
        const fgBatch = order?.fgBatchId != null ? batchById.get(order.fgBatchId) : undefined;
        productions.push({
          level: (depthByBatch.get(edge.batchId) ?? 0) + 1,
          fromBatchId: edge.batchId,
          fromBatchNo: batchById.get(edge.batchId)?.batchNo ?? null,
          orderId: edge.orderId,
          orderNo: order?.orderNo ?? null,
          orderStatus: order?.status ?? "UNKNOWN",
          fgBatchId: order?.fgBatchId ?? null,
          fgBatchNo: fgBatch?.batchNo ?? null,
          fgItemId: order?.itemId ?? null,
          fgSku: fgBatch?.sku ?? null,
          qty: edge.qty,
        });
      }
      for (const edge of saleEdges) {
        sales.push({
          level: (depthByBatch.get(edge.batchId) ?? 0) + 1,
          batchId: edge.batchId,
          docType: edge.sourceType === "delivery_note" ? "delivery_note" : "sales_invoice",
          docId: edge.sourceId,
          docDate: edge.movedAt.slice(0, 10), // the calendar date of the move
          qty: edge.qty,
        });
      }

      // The consuming orders' FG batches join the next frontier (expand-once
      // visited set + the depth cap; a batch consumed by several orders is
      // walked past only the first time).
      const next: { batchId: string; depth: number }[] = [];
      for (const edge of consumptions) {
        const order = orderById.get(edge.orderId);
        if (order === undefined || order.fgBatchId === null) continue;
        if (visited.has(order.fgBatchId)) continue;
        const depth = depthByBatch.get(edge.batchId) ?? 0;
        if (depth + 1 > MAX_DEPTH) continue;
        visited.add(order.fgBatchId);
        next.push({ batchId: order.fgBatchId, depth: depth + 1 });
      }
      frontier = next;
    }

    productions.sort(
      (a, b) =>
        a.level - b.level ||
        (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0) ||
        (a.fromBatchId < b.fromBatchId ? -1 : 1),
    );
    sales.sort(
      (a, b) =>
        a.level - b.level ||
        (a.docDate < b.docDate ? -1 : a.docDate > b.docDate ? 1 : 0) ||
        (a.docId < b.docId ? -1 : 1),
    );
    return { batch: batchRef(row), productions, sales };
  }

  async batchSummary(batchId: string): Promise<GenealogyBatchSummary> {
    const row = await store.findBatchForGenealogy(batchId);
    if (row === undefined) throw new GenealogyBatchNotFoundError(batchId);

    let producingOrderId: string | null = null;
    let producingOrderNo: string | null = null;
    if (row.productionOrderId !== null) {
      const [producing] = await store.listProductionOrdersByIds([row.productionOrderId]);
      producingOrderId = producing?.id ?? row.productionOrderId;
      producingOrderNo = producing?.orderNo ?? null;
    }

    const onHand = await store.qcBatchOnHand(batchId);
    const consumptions = await store.listConsumptionsByBatchIds([batchId]);
    const qtyByOrder = new Map<string, Decimal>();
    for (const edge of consumptions) {
      qtyByOrder.set(
        edge.orderId,
        (qtyByOrder.get(edge.orderId) ?? new Decimal(0)).plus(new Decimal(edge.qty)),
      );
    }
    const orders = await store.listProductionOrdersByIds([...qtyByOrder.keys()]);
    const orderNoById = new Map(orders.map((order) => [order.id, order.orderNo]));
    const consumedByOrders = [...qtyByOrder.entries()]
      .map(([orderId, qty]) => ({
        orderId,
        orderNo: orderNoById.get(orderId) ?? null,
        qty: qty.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
      }))
      .sort((a, b) => (a.orderId < b.orderId ? -1 : a.orderId > b.orderId ? 1 : 0));

    const saleEdges = await store.listBatchSalesEdges([batchId]);
    const inspectionsCount = await store.countInspectionsByBatch(batchId);
    return {
      batch: batchRef(row),
      producingOrderId,
      producingOrderNo,
      onHand,
      consumedByOrders,
      salesCount: saleEdges.length,
      inspectionsCount,
    };
  }
}

function batchRef(row: store.GenealogyBatchRow): GenealogyBatchRef {
  return {
    batchId: row.id,
    batchNo: row.batchNo,
    itemId: row.itemId,
    sku: row.sku,
    status: row.status,
    expiryDate: row.expiryDate,
  };
}
