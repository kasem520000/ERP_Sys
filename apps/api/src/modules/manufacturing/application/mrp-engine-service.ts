import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { requireActiveWarehouse } from "../../inventory/application/movement-core";
import * as store from "../infrastructure/planning.store";
import {
  computeLowLevelCodes,
  explodeDemand,
  resolveSubstitutions,
  type BomGraph,
  type BomGraphNode,
  type BomSubstitute,
  type SubstitutionSplit,
} from "../domain/mrp/explosion";
import {
  autoSafetyStock,
  bucketIndexCovering,
  buildBuckets,
  planItemBuckets,
  type DemandTerm,
  type LotSizingInput,
  type SupplyTerm,
} from "../domain/mrp/netting";
import { MrpRunInputInvalidError, MrpRunNotFoundError } from "../domain/manufacturing-errors";

/**
 * MRP engine service (PHASE-043 T-04; H-03/M-01/M-07…M-11): the
 * deterministic, explanation-first net-requirements run. One run =
 * one (warehouse, parameters) snapshot: the FULL parameter set is stored
 * on the run row (replayable determinism — same data + same params ⇒ the
 * same plan), the demand/supply lines ARE the input evidence, and every
 * suggestion carries its per-bucket netting drill-down (the jsonb column
 * is this service's `netting` payload).
 *
 * THE NETTING (INV-030 — the pure kernel in domain/mrp/netting.ts):
 *   net = (MPS + unreserved firm sales + safety gap)
 *        − (qualified on-hand − reserved)
 *        − (open POs + open MOs + inbound transfers)
 *   + in-flight converted suggestions (SUGGESTED_RECEIPT — re-runs never
 *     re-suggest an accepted-but-not-yet-open order: the no-double-order
 *     law) + co/by-product receipts from open MOs and this run's own
 *     planned orders (M-11 netting).
 *
 * The leveling: items process by ascending LOW-LEVEL CODE over the BOM
 * graph UNION the substitution edges (primary → substitute — a
 * substitute's planning demand originates at the primary's netting, so it
 * always nets after it). Phantom flattening (M-08) and substitution
 * resolution (M-09) live in the pure kernel; this service orchestrates
 * the reads, the per-item re-plan when substitution shifts demand, and
 * the snapshot writes.
 *
 * Determinism notes (the module README's law): REGENERATIVE derives the
 * scope (every STOCK item with ANY planning signal at the warehouse);
 * NET_CHANGE requires the explicit item list — both compute the SAME
 * plan for their scope (the honest net-change contract: the scope is the
 * difference, not the algorithm). Execution is synchronous within the
 * caller's UoW (the run row carries its own lifecycle for the audit
 * trail); the depth cap + the memoized kernel bound the walk.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export interface RunMrpInput {
  warehouseId: string;
  bucketSize: "DAY" | "WEEK";
  horizonBuckets: number;
  runMode: "REGENERATIVE" | "NET_CHANGE";
  /** NET_CHANGE: required (1..200 items). REGENERATIVE: ignored (derived). */
  scopeItemIds?: readonly string[];
  /** When true, shortfalls prefer an inter-warehouse TRANSFER suggestion
   * (from the largest static surplus) over producing/buying. Default
   * false — the conservative ordering-first default. */
  allowTransfers?: boolean;
  asOfDate?: string | null;
  actorId: string | null;
}

export interface RunMrpResult {
  run: store.MrpRunRow;
  suggestions: store.MrpSuggestionRow[];
}

/** The effective safety-stock qty for one item (MANUAL value or the AUTO
 * computation over the look-back demand — M-01's deterministic z×σ×√LT). */
async function effectiveSafetyStock(
  item: store.ItemPlanningRow,
  warehouseId: string,
  asOf: string,
): Promise<string> {
  if (item.safetyStockPolicy === "AUTO") {
    const daily = await store.listDailySalesDemands(
      item.id,
      warehouseId,
      item.ssLookbackDays ?? 90,
      asOf,
    );
    return autoSafetyStock({
      serviceLevelPct: item.ssServiceLevelPct ?? "95",
      dailyDemands: daily,
      leadTimeDays: item.leadTimeDays ?? 0,
    });
  }
  return item.safetyStockQty ?? "0";
}

@Injectable()
export class MrpEngineService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- reads -------------------------------------------------------------------------

  async findRun(id: string): Promise<store.MrpRunRow> {
    const run = await store.findMrpRunById(id);
    if (run === undefined) throw new MrpRunNotFoundError(id);
    return run;
  }

  async listRuns(filter: { warehouseId?: string; limit: number }): Promise<store.MrpRunRow[]> {
    return store.listMrpRuns(filter);
  }

  async getRunDetail(id: string): Promise<{
    run: store.MrpRunRow;
    demandLines: store.MrpDemandLineRow[];
    supplyLines: store.MrpSupplyLineRow[];
    suggestions: store.MrpSuggestionRow[];
  }> {
    const run = await this.findRun(id);
    return {
      run,
      demandLines: await store.listMrpDemandLines({ runId: id }),
      supplyLines: await store.listMrpSupplyLines({ runId: id }),
      suggestions: await store.listMrpSuggestions({ runId: id, limit: 500 }),
    };
  }

  // -- the run -----------------------------------------------------------------------

  async run(input: RunMrpInput): Promise<RunMrpResult> {
    // 1. Validate the parameters (fail-closed BEFORE any row is written).
    await requireActiveWarehouse(input.warehouseId);
    if (input.horizonBuckets < 1 || input.horizonBuckets > 366) {
      throw new MrpRunInputInvalidError(`horizonBuckets must be 1..366 — got ${input.horizonBuckets}`);
    }
    const asOf = input.asOfDate ?? today();
    if (!DATE_RE.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
      throw new MrpRunInputInvalidError(`asOfDate must be an ISO date (YYYY-MM-DD): ${asOf}`);
    }
    let scopeItemIds: string[];
    if (input.runMode === "NET_CHANGE") {
      if (input.scopeItemIds === undefined || input.scopeItemIds.length < 1 || input.scopeItemIds.length > 200) {
        throw new MrpRunInputInvalidError(
          "NET_CHANGE runs require an explicit scope of 1..200 item ids (the honest net-change contract: the scope is the difference, not the algorithm)",
        );
      }
      scopeItemIds = [...new Set(input.scopeItemIds)];
    } else {
      scopeItemIds = await store.deriveScopeItems(input.warehouseId);
    }
    const params = {
      warehouseId: input.warehouseId,
      bucketSize: input.bucketSize,
      horizonBuckets: input.horizonBuckets,
      runMode: input.runMode,
      scopeItemIds,
      allowTransfers: input.allowTransfers === true,
      asOfDate: asOf,
    };

    // 2. The run row (RUNNING — the honest lifecycle marker; the same UoW
    //    flips it COMPLETED/FAILED at the end, so a crash rolls the whole
    //    run back — no half-written plans, ever).
    const run = await store.insertMrpRun({
      runMode: input.runMode,
      bucketSize: input.bucketSize,
      horizonBuckets: input.horizonBuckets,
      warehouseId: input.warehouseId,
      asOfDate: asOf,
      scopeItemIds,
      params,
      actorId: input.actorId,
    });

    try {
      const suggestions = await this.executeRun(run, params, input.actorId);
      await store.patchMrpRun({
        id: run.id,
        status: "COMPLETED",
        stats: {
          items: scopeItemIds.length,
          suggestions: suggestions.length,
          byType: suggestions.reduce<Record<string, number>>((acc, s) => {
            acc[s.suggestionType] = (acc[s.suggestionType] ?? 0) + 1;
            return acc;
          }, {}),
        },
      });
      await this.audit.record({
        action: "manufacturing.mrp.run_completed",
        entityType: "mrp_run",
        entityId: run.id,
        actorId: input.actorId ?? undefined,
        after: { ...params, suggestions: suggestions.length },
      });
      return { run: (await store.findMrpRunById(run.id))!, suggestions };
    } catch (error) {
      // The typed failure record: the run row survives with its error code
      // ONLY when the UoW itself is not rolled back (a constraint violation
      // rolls everything — the honest fail-closed).
      const code = error instanceof Error ? error.name : "MRP_RUN_FAILED";
      await store.patchMrpRun({ id: run.id, status: "FAILED", errorCode: code });
      throw error;
    }
  }

  /** The engine body — reads, levels, nets, writes. */
  private async executeRun(
    run: store.MrpRunRow,
    params: {
      warehouseId: string;
      bucketSize: "DAY" | "WEEK";
      horizonBuckets: number;
      runMode: string;
      scopeItemIds: string[];
      allowTransfers: boolean;
      asOfDate: string;
    },
    actorId: string | null,
  ): Promise<store.MrpSuggestionRow[]> {
    const { warehouseId, bucketSize, asOfDate } = params;
    const bucketStarts = buildBuckets(asOfDate, bucketSize, params.horizonBuckets);
    const bucketOf = (date: string | null): number =>
      date === null ? 0 : bucketIndexCovering(date, bucketStarts, bucketSize);

    // -- the reads (one pass; the snapshots ride these exact rows) -----
    const planningItems = new Map<string, store.ItemPlanningRow>();
    for (const itemId of params.scopeItemIds) {
      const item = await store.findItemPlanning(itemId);
      if (item !== undefined) planningItems.set(itemId, item);
    }
    const graphRows = await store.loadActiveBomGraph();
    const graphNodes = new Map<string, BomGraphNode>();
    const graph: BomGraph = { nodes: graphNodes };
    for (const node of graphRows) graphNodes.set(node.itemId, node);
    const lineIds = graphRows.flatMap((node) => node.lines.map((line) => line.lineId));
    const substitutionRows = await store.loadSubstitutionsForLines(lineIds);
    /** parentItem → (component line id → ordered substitutes). */
    const substitutionsByLine = new Map<string, readonly BomSubstitute[]>(
      [...substitutionRows.entries()].map(([lineId, list]) => [
        lineId,
        list.map((row) => ({ substituteItemId: row.substituteItemId, priority: row.priority })),
      ]),
    );
    const mpsEntries = await store.listMpsEntries({
      warehouseId,
      from: bucketStarts[0]!,
      limit: 5000,
    });
    const firmSales = await store.listFirmSalesDemand(warehouseId);
    const qualifiedOnHand = await store.listQualifiedOnHand(warehouseId);
    const reservations = await store.listActiveReservations(warehouseId);
    const openPos = await store.listOpenPoSupply(warehouseId);
    const openMos = await store.listOpenMoSupply(warehouseId);
    const inbound = await store.listInboundTransfers(warehouseId);
    const coProducts = await store.listCoProductSupply(warehouseId);
    const inFlight = await store.listInFlightConvertedSuggestions(warehouseId);

    // -- the leveling (low-level codes over BOM ∪ substitution edges) --
    // The leveling graph: the BOM edges (parent → component) UNION the
    // substitution edges hanging off the PRIMARY COMPONENT (primary →
    // substitute — NOT off the parent: the substitute's planning demand
    // originates at the primary's netting, so its low-level code must
    // exceed the primary's, which a sibling edge cannot guarantee).
    const llcEdges = new Map<string, { lines: { componentItemId: string }[] }>();
    for (const node of graphRows) {
      llcEdges.set(node.itemId, {
        lines: node.lines.map((line) => ({ componentItemId: line.componentItemId })),
      });
    }
    for (const node of graphRows) {
      for (const line of node.lines) {
        for (const sub of substitutionRows.get(line.lineId) ?? []) {
          const primary = llcEdges.get(line.componentItemId);
          if (primary !== undefined) {
            primary.lines.push({ componentItemId: sub.substituteItemId });
          } else {
            llcEdges.set(line.componentItemId, { lines: [{ componentItemId: sub.substituteItemId }] });
          }
        }
      }
    }
    const llc = computeLowLevelCodes({ nodes: llcEdges });
    // Scope items absent from the graph carry llc 0 (leaves).
    const orderedItems = [...planningItems.keys()].sort((a, b) => {
      const la = llc.get(a) ?? 0;
      const lb = llc.get(b) ?? 0;
      return la !== lb ? la - lb : a < b ? -1 : 1;
    });

    // -- the per-item terms (direct demand + static supply) ------------
    const demandByItem = new Map<string, DemandTerm[]>();
    const supplyByItem = new Map<string, SupplyTerm[]>();
    const pushDemand = (itemId: string, term: DemandTerm): void => {
      const list = demandByItem.get(itemId) ?? [];
      list.push(term);
      demandByItem.set(itemId, list);
    };
    const pushSupply = (itemId: string, term: SupplyTerm): void => {
      const list = supplyByItem.get(itemId) ?? [];
      list.push(term);
      supplyByItem.set(itemId, list);
    };

    for (const entry of mpsEntries) {
      if (!planningItems.has(entry.itemId)) continue;
      pushDemand(entry.itemId, {
        itemId: entry.itemId,
        bucketIndex: bucketOf(entry.bucketStart),
        kind: "MPS",
        qty: entry.qty,
        mpsEntryId: entry.id,
      });
    }
    for (const line of firmSales) {
      if (!planningItems.has(line.itemId)) continue;
      pushDemand(line.itemId, {
        itemId: line.itemId,
        bucketIndex: bucketOf(line.demandDate),
        kind: "SALES_ORDER",
        qty: line.qty,
        salesOrderLineId: line.salesOrderLineId,
      });
    }
    for (const row of qualifiedOnHand) {
      if (!planningItems.has(row.itemId)) continue;
      pushSupply(row.itemId, {
        itemId: row.itemId,
        bucketIndex: 0,
        kind: "ON_HAND",
        qty: row.qty,
        batchId: row.batchId,
        expiresOn: row.expiresOn,
      });
    }
    for (const row of reservations) {
      if (!planningItems.has(row.itemId)) continue;
      pushSupply(row.itemId, { itemId: row.itemId, bucketIndex: 0, kind: "RESERVED", qty: row.qty });
    }
    for (const row of openPos) {
      if (!planningItems.has(row.itemId)) continue;
      pushSupply(row.itemId, {
        itemId: row.itemId,
        bucketIndex: bucketOf(row.expectedDate),
        kind: "OPEN_PO",
        qty: row.remainingQty,
        purchaseOrderId: row.purchaseOrderId,
      });
    }
    for (const row of openMos) {
      if (!planningItems.has(row.itemId)) continue;
      pushSupply(row.itemId, {
        itemId: row.itemId,
        bucketIndex: bucketOf(row.plannedDate),
        kind: "OPEN_MO",
        qty: row.remainingQty,
        productionOrderId: row.productionOrderId,
      });
    }
    for (const row of inbound) {
      if (!planningItems.has(row.itemId)) continue;
      pushSupply(row.itemId, {
        itemId: row.itemId,
        bucketIndex: 0,
        kind: "INBOUND_TRANSFER",
        qty: row.qty,
        stockTransferId: row.stockTransferId,
      });
    }
    for (const row of coProducts) {
      if (!planningItems.has(row.itemId)) continue;
      pushSupply(row.itemId, {
        itemId: row.itemId,
        bucketIndex: bucketOf(row.plannedDate),
        kind: "CO_PRODUCT",
        qty: row.qty,
        productionOrderId: row.productionOrderId,
      });
    }
    for (const row of inFlight) {
      if (!planningItems.has(row.itemId)) continue;
      pushSupply(row.itemId, {
        itemId: row.itemId,
        bucketIndex: bucketOf(row.dueDate),
        kind: "SUGGESTED_RECEIPT",
        qty: row.qty,
      });
    }

    // -- the sequential leveled walk ------------------------------------
    const demandLineInserts: store.MrpDemandLineInsert[] = [];
    const supplyLineInserts: store.MrpSupplyLineInsert[] = [];
    const suggestionInserts: store.MrpSuggestionInsert[] = [];

    for (const itemId of orderedItems) {
      const item = planningItems.get(itemId)!;
      const safety = await effectiveSafetyStock(item, warehouseId, asOfDate);
      const lotSizing: LotSizingInput = {
        rule: (["LOT_FOR_LOT", "FIXED_ORDER_QTY", "ORDER_MULTIPLE", "PERIOD_SUPPLY"] as const).includes(
          item.lotSizingRule as LotSizingInput["rule"],
        )
          ? (item.lotSizingRule as LotSizingInput["rule"])
          : "LOT_FOR_LOT",
        fixedOrderQty: item.fixedOrderQty,
        orderMultiple: item.orderMultiple,
        periodSupplyBuckets: item.periodSupplyBuckets,
      };

      // Substitution (M-09): plan with the full demand, then shift the
      // uncovered substitutable portion to the substitutes (priority
      // order) and RE-PLAN — the substitute rows land on the substitutes'
      // demand (they net later: the substitution edge in the leveling).
      let demand = [...(demandByItem.get(itemId) ?? [])];
      let plan = planItemBuckets({
        itemId,
        bucketStarts,
        demand,
        supply: supplyByItem.get(itemId) ?? [],
        safetyStockQty: safety,
        lotSizing,
      });
      const substitutionShifts: {
        substituteItemId: string;
        qty: string;
        recipeItemId: string;
        parentItemId: string | null;
        bucketIndex: number;
      }[] = [];
      const node = graphNodes.get(itemId);
      if (node !== undefined) {
        // Which demand terms trace to substitutable parent lines?
        const substitutable = new Map<string, readonly BomSubstitute[]>();
        for (const line of node.lines) {
          const subs = substitutionsByLine.get(line.lineId);
          if (subs !== undefined && subs.length > 0) substitutable.set(line.componentItemId, subs);
        }
        if (substitutable.size > 0) {
          let mutated = false;
          for (let index = 0; index < plan.buckets.length; index += 1) {
            const bucket = plan.buckets[index]!;
            if (new Decimal(bucket.netRequirement).lessThanOrEqualTo(0)) continue;
            let netRemaining = new Decimal(bucket.netRequirement);
            const candidates = demand
              .filter((term) => term.bucketIndex === index && substitutable.has(term.parentItemId ?? ""))
              .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : (a.parentItemId ?? "") < (b.parentItemId ?? "") ? -1 : 1));
            for (const term of candidates) {
              if (netRemaining.lessThanOrEqualTo(0)) break;
              const substitutes = substitutable.get(term.parentItemId!)!;
              const uncovered = Decimal.min(netRemaining, new Decimal(term.qty));
              const split = resolveSubstitutions({
                lineGrossQty: term.qty,
                uncoveredQty: uncovered.toFixed(6),
                substitutes,
              });
              if (split === undefined) continue;
              // Reduce this term by the substituted amount; the legs land
              // on the substitutes' demand.
              const shifted = new Decimal(term.qty).minus(new Decimal(split.primaryQty));
              if (shifted.lessThanOrEqualTo(0)) continue;
              term.qty = split.primaryQty;
              mutated = true;
              netRemaining = netRemaining.minus(shifted);
              for (const leg of split.substituteLegs) {
                substitutionShifts.push({
                  substituteItemId: leg.substituteItemId,
                  qty: leg.qty,
                  recipeItemId: itemId,
                  parentItemId: term.parentItemId ?? null,
                  bucketIndex: index,
                });
              }
            }
          }
          if (mutated) {
            demand = demand.filter((term) => new Decimal(term.qty).greaterThan(0));
            plan = planItemBuckets({
              itemId,
              bucketStarts,
              demand,
              supply: supplyByItem.get(itemId) ?? [],
              safetyStockQty: safety,
              lotSizing,
            });
          }
        }
      }

      // Snapshot the item's buckets (demand lines incl. the safety rows;
      // supply lines per term).
      for (const bucket of plan.buckets) {
        for (const term of bucket.demand) {
          if (new Decimal(term.qty).lessThanOrEqualTo(0)) continue;
          demandLineInserts.push({
            runId: run.id,
            warehouseId,
            itemId,
            bucketIndex: bucket.bucketIndex,
            bucketStart: bucket.bucketStart,
            demandKind: term.kind,
            qty: term.qty,
            salesOrderLineId: term.salesOrderLineId ?? null,
            mpsEntryId: term.mpsEntryId ?? null,
            parentItemId: term.parentItemId ?? null,
            substitutedItemId: term.substitutedItemId ?? null,
            substitutes: term.substitutes ?? [],
          });
        }
        for (const term of bucket.supply) {
          supplyLineInserts.push({
            runId: run.id,
            warehouseId,
            itemId,
            bucketIndex: bucket.bucketIndex,
            bucketStart: bucket.bucketStart,
            supplyKind: term.kind,
            qty: term.qty,
            batchId: term.batchId ?? null,
            expiresOn: term.expiresOn ?? null,
            purchaseOrderId: term.purchaseOrderId ?? null,
            productionOrderId: term.productionOrderId ?? null,
            stockTransferId: term.stockTransferId ?? null,
          });
        }
      }

      // The substitution demand rows ride the substitutes' terms.
      for (const shift of substitutionShifts) {
        pushDemand(shift.substituteItemId, {
          itemId: shift.substituteItemId,
          bucketIndex: shift.bucketIndex,
          kind: "SUBSTITUTION",
          qty: shift.qty,
          substitutedItemId: shift.recipeItemId,
          parentItemId: shift.parentItemId,
        });
      }

      // The orders → suggestions (+ explosion + co-product supply).
      const surplusCache = params.allowTransfers ? await store.listWarehouseSurpluses(itemId) : [];
      for (const order of plan.orders) {
        const dueDate = order.bucketStart;
        const leadTime = item.leadTimeDays;
        const releaseDate = leadTime === null ? dueDate : addDaysIso(dueDate, -leadTime);
        // The frozen fence: the due date lands inside the item's fence
        // window from as-of (BR-078's planning-side mirror — the flag rides
        // the suggestion; the MPS edit discipline is the service's own).
        const frozenFence = dueDate <= addDaysIso(asOfDate, item.frozenFenceDays);
        const nettingDrillDown = {
          formula: "(MPS + unreserved firm sales + safety gap) − (qualified on-hand − reserved) − (open POs + open MOs + inbound transfers) + in-flight suggestions",
          bucket: { index: order.bucketIndex, start: order.bucketStart },
          net: order.net,
          orderQty: order.qty,
          lotSizing,
          safetyStockQty: safety,
          leadTimeDays: leadTime,
          missingLeadTime: leadTime === null,
          bucketDetail: plan.buckets[order.bucketIndex]!,
        };

        let remainingQty = new Decimal(order.qty);
        if (params.allowTransfers && surplusCache.length > 0) {
          const top = surplusCache[0]!;
          const transferQty = Decimal.min(remainingQty, new Decimal(top.surplusQty));
          if (transferQty.greaterThan(0)) {
            suggestionInserts.push({
              runId: run.id,
              itemId,
              warehouseId,
              fromWarehouseId: top.warehouseId,
              suggestionType: "TRANSFER",
              qty: transferQty.toFixed(6),
              uomId: item.baseUomId,
              dueDate,
              releaseDate,
              frozenFence,
              substitutedItemId: null,
              bomId: null,
              netting: nettingDrillDown,
              actorId,
            });
            remainingQty = remainingQty.minus(transferQty);
          }
        }
        if (remainingQty.greaterThan(0)) {
          const isMake = node !== undefined;
          suggestionInserts.push({
            runId: run.id,
            itemId,
            warehouseId,
            fromWarehouseId: null,
            suggestionType: isMake ? "PRODUCTION_ORDER" : "PURCHASE_ORDER",
            qty: remainingQty.toFixed(6),
            uomId: item.baseUomId,
            dueDate,
            releaseDate,
            frozenFence,
            substitutedItemId: null,
            bomId: isMake ? node.bomId : null,
            netting: nettingDrillDown,
            actorId,
          });
          // The make order's explosion demand (M-07/M-08) lands at the
          // order's RELEASE bucket (the parent starts consuming then);
          // the outputs' co-product supply (M-11) lands at the due bucket.
          if (isMake) {
            const releaseBucket = leadTime === null
              ? order.bucketIndex
              : bucketOf(releaseDate);
            const exploded = explodeDemand({
              graph,
              rootItemId: itemId,
              rootQty: remainingQty.toFixed(6),
              resolvedSubstitutions: new Map<string, SubstitutionSplit>(),
            });
            for (const demand of exploded) {
              pushDemand(demand.itemId, {
                itemId: demand.itemId,
                bucketIndex: releaseBucket,
                kind: "BOM_EXPLOSION",
                qty: demand.qty,
                parentItemId: demand.parentItemId,
                substitutes: demand.viaPhantoms.length > 0 ? { viaPhantoms: demand.viaPhantoms } : [],
              });
            }
            const outputs = await store.listBomOutputs(node.bomId);
            for (const output of outputs) {
              if (!planningItems.has(output.itemId)) continue;
              pushSupply(output.itemId, {
                itemId: output.itemId,
                bucketIndex: order.bucketIndex,
                kind: "CO_PRODUCT",
                qty: new Decimal(output.qtyPerOutput).times(remainingQty).toFixed(6),
              });
            }
          }
        }
      }
    }

    // -- the writes: supersede the stale, write the new ------------------
    await store.supersedeSuggestionsForItems({
      itemWarehousePairs: params.scopeItemIds.map((itemId) => ({ itemId, warehouseId })),
      supersededByRunId: run.id,
    });
    if (demandLineInserts.length > 0) await store.insertMrpDemandLines(demandLineInserts);
    if (supplyLineInserts.length > 0) await store.insertMrpSupplyLines(supplyLineInserts);
    const created = await store.insertMrpSuggestions(suggestionInserts);
    return created;
  }
}
