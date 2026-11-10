import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";
import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import * as store from "../infrastructure/inventory.store";
import {
  ItemNotFoundError,
  MethodSwitchInFlightError,
  MethodSwitchSameError,
} from "../domain/inventory-errors";
import { inventoryJournalLines, resolveInventoryAccount } from "./movement-core";

/**
 * Per-item method-lock + method-switch with dated revaluation
 * (PHASE-010 T13; INV-017; BR-014; INVENTORY_ACCOUNTING §1).
 *
 * An item NEVER mixes methods: every movement reads items.costing_method
 * at transaction time. Switching is a first-class, audited operation:
 *
 *  1. no in-flight transactions for the item (IN_TRANSIT transfers,
 *     open counts) — fail-closed otherwise;
 *  2. a DATED REVALUATION posting — the on-hand value under the new
 *     method vs the old books the delta: appreciation (DR INVENTORY ·
 *     CR INVENTORY_APPRECIATION) or shrinkage (DR INVENTORY_SHRINKAGE ·
 *     CR INVENTORY);
 *  3. the cost substrate re-bases: FIFO→WAC sets avg_cost = Σ remaining
 *     layer value / qty; WAC→FIFO creates ONE layer at avg_cost for
 *     every warehouse holding the item.
 *
 * NEVER retroactive restatement (INV-017): historical moves and issues
 * keep their exact stored costs — the append-only ledger guarantees it
 * structurally, and history queries return the original values.
 */
@Injectable()
export class MethodSwitchService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  /**
   * The revaluation preview (§2.6): what the journal WOULD look like —
   * pure read, no writes. Returns per-warehouse detail + the aggregate
   * delta lines.
   */
  async preview(input: { itemId: string; targetMethod: "WAC" | "FIFO" }) {
    const item = await this.requireSwitchable(input.itemId, input.targetMethod);
    const holdings = await this.holdings(item.id);
    const detail: {
      warehouseId: string;
      qty: string;
      currentValue: string;
      targetValue: string;
      delta: string;
    }[] = [];
    let totalDelta = new Decimal(0);
    for (const holding of holdings) {
      const current = await holdingValue(item.costingMethod, holding);
      // The target value is the RE-BASED substrate's book value (not the
      // empty-substrate zero): WAC→FIFO layers land at the current average
      // (delta 0 by construction); FIFO→WAC blends the layer average at 6dp
      // (delta = the rounding drift the revaluation posting captures).
      const target =
        input.targetMethod === "FIFO"
          ? current
          : await holdingValue("WAC", {
              ...holding,
              avgCost: await fifoLayerAverage(holding.itemId, holding.warehouseId),
            });
      const delta = new Decimal(target).minus(new Decimal(current));
      totalDelta = totalDelta.plus(delta);
      detail.push({
        warehouseId: holding.warehouseId,
        qty: holding.qty,
        currentValue: current,
        targetValue: target,
        delta: delta.toFixed(4),
      });
    }
    const delta = totalDelta.toFixed(4);
    return {
      itemId: item.id,
      sku: item.sku,
      currentMethod: item.costingMethod,
      targetMethod: input.targetMethod,
      detail,
      revaluationDelta: delta,
      journalShape:
        Number(delta) > 0
          ? { debit: "INVENTORY", credit: "INVENTORY_APPRECIATION", amount: delta }
          : Number(delta) < 0
            ? { debit: "INVENTORY_SHRINKAGE", credit: "INVENTORY", amount: new Decimal(delta).abs().toFixed(4) }
            : null,
    };
  }

  /** Execute the switch: revaluation journal + substrate re-base, atomically. */
  async switch(input: {
    itemId: string;
    targetMethod: "WAC" | "FIFO";
    switchDate: string;
    actorId: string | null;
  }) {
    const item = await this.requireSwitchable(input.itemId, input.targetMethod);
    const holdings = await this.holdings(item.id);
    const preview = await this.preview({ itemId: input.itemId, targetMethod: input.targetMethod });
    const delta = new Decimal(preview.revaluationDelta);

    let journalEntryId: string | null = null;
    if (!delta.isZero()) {
      const firstWarehouse = holdings[0];
      if (firstWarehouse === undefined) {
        throw new MethodSwitchInFlightError(input.itemId);
      }
      const total = delta.abs().toFixed(4);
      const inventoryAccount = await resolveInventoryAccount(firstWarehouse.warehouseId);
      const lines = inventoryJournalLines({
        inventoryAccountId: inventoryAccount,
        direction: delta.gt(0) ? "IN" : "OUT",
        value: total,
        counterPurpose: delta.gt(0) ? "INVENTORY_APPRECIATION" : "INVENTORY_SHRINKAGE",
        memoEn: `Valuation method switch — ${item.sku} (${item.costingMethod} → ${input.targetMethod})`,
        memoAr: `تغيير طريقة التقييم — ${item.sku} (${item.costingMethod} → ${input.targetMethod})`,
      });
      const spec: JournalSpec = {
        source: { docType: "method_switch", docId: input.itemId, operation: "post" },
        entryDate: input.switchDate,
        description: {
          en: `Valuation method switch ${item.sku}: ${item.costingMethod} → ${input.targetMethod}`,
          ar: `تغيير طريقة التقييم ${item.sku}: ${item.costingMethod} → ${input.targetMethod}`,
        },
        currency: await ownTenantBaseCurrency(),
        lines,
      };
      const result = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = result.journalEntryId;
      if (!result.idempotentReplay) {
        // The revaluation move row (adjust kind) carries the switch source
        // and the journal link — the INV-010 trail stays exact.
        await store.insertStockMove({
          id: generateUuidV7(),
          itemId: item.id,
          warehouseId: firstWarehouse.warehouseId,
          direction: delta.gt(0) ? "IN" : "OUT",
          moveKind: "adjust",
          qty: firstWarehouse.qty,
          unitCost: "0.000000",
          valueAmount: total,
          batchId: null,
          serialId: null,
          sourceType: "method_switch",
          sourceId: input.itemId,
          movedAt: input.switchDate,
          reason: "METHOD_SWITCH",
          memo: null,
          memoAr: null,
          postedJournalId: result.journalEntryId,
        });
      }
    }

    // Substrate re-base (idempotent replay safe: the method flip is the
    // convergence point — a replay finds the item already on the target).
    for (const holding of holdings) {
      if (input.targetMethod === "WAC") {
        // FIFO→WAC: one average from the remaining layers; layers zeroed.
        const avg = await fifoLayerAverage(holding.itemId, holding.warehouseId);
        await store.upsertItemStock({
          itemId: holding.itemId,
          warehouseId: holding.warehouseId,
          qty: holding.qty,
          avgCost: avg,
        });
        for (const layer of await store.listAllLayers(holding.itemId, holding.warehouseId)) {
          if (Number(layer.remainingQty) > 0) {
            await store.decrementLayer(layer.id, layer.remainingQty);
          }
        }
      } else {
        // WAC→FIFO: one layer at the current average per warehouse — the
        // re-base preserves book value by construction (the preview's
        // delta stays 0), so the layer carries source_move_id NULL (a
        // synthetic move here would DOUBLE-COUNT the INV-010 money trail;
        // the switch's audit event is the provenance).
        const existing = await store.listLiveLayers(holding.itemId, holding.warehouseId);
        if (existing.length === 0 && Number(holding.qty) > 0) {
          await store.insertLayer({
            id: generateUuidV7(),
            itemId: holding.itemId,
            warehouseId: holding.warehouseId,
            remainingQty: holding.qty,
            unitCost: holding.avgCost,
            sourceMoveId: null,
            receivedAt: input.switchDate,
          });
        }
        await store.upsertItemStock({
          itemId: holding.itemId,
          warehouseId: holding.warehouseId,
          qty: holding.qty,
          avgCost: holding.avgCost,
        });
      }
    }
    await store.updateItemCostingMethod(item.id, input.targetMethod);

    await this.audit.record({
      action: "inventory.method_switched",
      entityType: "item",
      entityId: item.id,
      actorId: input.actorId ?? undefined,
      before: { costingMethod: item.costingMethod },
      after: {
        costingMethod: input.targetMethod,
        revaluationDelta: preview.revaluationDelta,
        journalEntryId,
      },
    });
    return {
      itemId: item.id,
      costingMethod: input.targetMethod,
      revaluationDelta: preview.revaluationDelta,
      journalEntryId,
      detail: preview.detail,
    };
  }

  private async requireSwitchable(itemId: string, targetMethod: "WAC" | "FIFO") {
    const item = await store.findItemForInventory(itemId);
    if (item === undefined) throw new ItemNotFoundError(itemId);
    if (item.costingMethod === targetMethod) {
      throw new MethodSwitchSameError(itemId, targetMethod);
    }
    const openCounts = await store.countOpenCountsForItem(itemId);
    const inTransit = await store.countInTransitTransfersForItem(itemId);
    if (openCounts > 0 || inTransit > 0) {
      throw new MethodSwitchInFlightError(itemId);
    }
    return item;
  }

  /** Warehouses holding the item (qty ≠ 0). */
  private async holdings(itemId: string) {
    const rows = await store.listStockOnHand({ itemId, limit: 500 });
    return rows
      .filter((row) => Number(row.qty) !== 0)
      .map((row) => ({
        warehouseId: row.warehouseId,
        itemId: row.itemId,
        qty: row.qty,
        avgCost: row.avgCost,
      }));
  }
}

/** On-hand value under a method (the switch's comparison basis). */
async function holdingValue(
  method: "WAC" | "FIFO",
  holding: { itemId: string; warehouseId: string; qty: string; avgCost: string },
): Promise<string> {
  if (method === "WAC") {
    return new Decimal(holding.qty).times(new Decimal(holding.avgCost)).toFixed(4);
  }
  const layers = await store.listAllLayers(holding.itemId, holding.warehouseId);
  return layers
    .reduce((sum, l) => sum.plus(new Decimal(l.remainingQty).times(new Decimal(l.unitCost))), new Decimal(0))
    .toFixed(4);
}

/** The blended FIFO average (the new WAC avg on switch). */
async function fifoLayerAverage(itemId: string, warehouseId: string): Promise<string> {
  const layers = (await store.listAllLayers(itemId, warehouseId)).filter(
    (l) => Number(l.remainingQty) > 0,
  );
  const qty = layers.reduce((s, l) => s.plus(new Decimal(l.remainingQty)), new Decimal(0));
  if (qty.isZero()) return "0.000000";
  const value = layers.reduce(
    (s, l) => s.plus(new Decimal(l.remainingQty).times(new Decimal(l.unitCost))),
    new Decimal(0),
  );
  return value.div(qty).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}
