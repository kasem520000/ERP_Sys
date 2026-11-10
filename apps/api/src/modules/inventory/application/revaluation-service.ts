import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/inventory.store";
import { ItemNotFoundError } from "../domain/inventory-errors";

/**
 * Inventory revaluation service (PHASE-011 T10 — the sanctioned seam the
 * purchasing module's landed costs consume; INVENTORY_ACCOUNTING §3):
 * revalues the on-hand WAC average / FIFO layers by an EXACT amount and
 * writes the corresponding revaluation move row (the method-switch
 * pattern: an `adjust` move carrying the value delta with the journal
 * link) so the INV-010 movement trail stays exact — inventory exclusively
 * owns its tables (MODULE_BOUNDARIES); purchasing never writes stock
 * rows itself.
 *
 * The caller (purchasing's landed-cost posting) supplies per-(item,
 * warehouse) deltas that were already posted on the GL side in the SAME
 * transaction; this service applies the substrate re-base + trail rows
 * with the journal id — one transaction, INV-018 discipline.
 */

@Injectable()
export class RevaluationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * Apply a landed-cost revalue: WAC items' avg_cost moves up by
   * (amount / on-hand qty); FIFO layers' unit_cost rises so Σ layer value
   * increases by exactly `amount` (allocated oldest-first by remaining
   * qty); the adjust move row carries the value + journal link.
   */
  async applyLandedCostRevalue(input: {
    itemId: string;
    warehouseId: string;
    /** Exact 4-dp value to add to the on-hand valuation (> 0). */
    amount: string;
    journalEntryId: string;
    movedAt: string;
    sourceType: string;
    sourceId: string;
    actorId: string | null;
  }): Promise<{ moveId: string }> {
    const item = await store.findItemForInventory(input.itemId);
    if (item === undefined) throw new ItemNotFoundError(input.itemId);
    const onHand = await store.findItemStock(input.itemId, input.warehouseId);
    const qty = onHand?.qty ?? "0";
    const amount = new Decimal(input.amount);
    if (amount.lte(0)) {
      throw new Error("landed-cost revalue amount must be positive");
    }

    // Substrate re-base.
    if (item.costingMethod === "WAC") {
      const currentAvg = new Decimal(onHand?.avgCost ?? "0");
      const newAvg = currentAvg.plus(amount.div(new Decimal(qty)))
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
      await store.upsertItemStock({
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        qty,
        avgCost: newAvg.toFixed(6),
      });
    } else {
      // FIFO: raise layer unit costs oldest-first until the layers' value
      // grows by exactly `amount` (per-layer 6-dp half-up, remainder to the
      // last layer so Σ is exact).
      const layers = await store.listLiveLayers(input.itemId, input.warehouseId);
      let remaining = amount;
      const updates: { layerId: string; unitCost: string }[] = [];
      for (const layer of layers) {
        if (remaining.lte(0)) break;
        const layerQty = new Decimal(layer.remainingQty);
        if (layerQty.lte(0)) continue;
        const perUnit = Decimal.min(remaining.div(layerQty), remaining);
        const newCost = new Decimal(layer.unitCost).plus(
          perUnit.toDecimalPlaces(6, Decimal.ROUND_HALF_UP),
        );
        updates.push({ layerId: layer.id, unitCost: newCost.toFixed(6) });
        remaining = remaining.minus(perUnit.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).times(layerQty));
      }
      if (remaining.gt(new Decimal("0.0001")) && updates.length > 0) {
        // Rounding remainder onto the last layer (Σ exact).
        const last = updates[updates.length - 1]!;
        const lastLayer = layers.find((l) => l.id === last.layerId)!;
        const lastQty = new Decimal(lastLayer.remainingQty);
        const bump = remaining.div(lastQty).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
        last.unitCost = new Decimal(last.unitCost).plus(bump).toFixed(6);
      }
      for (const update of updates) {
        await store.updateLayerUnitCost(update.layerId, update.unitCost);
      }
    }

    // The trail move row (value-only adjust — qty is informational).
    const moveId = generateUuidV7();
    await store.insertStockMove({
      id: moveId,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      direction: "IN",
      moveKind: "adjust",
      qty,
      unitCost: "0.000000",
      valueAmount: amount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      batchId: null,
      serialId: null,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      movedAt: input.movedAt,
      reason: "LANDED_COST",
      memo: `Landed cost ${input.sourceId}`,
      memoAr: `تكلفة إضافية ${input.sourceId}`,
      postedJournalId: input.journalEntryId,
    });
    await this.audit.record({
      action: "inventory.landed_cost_revalue_applied",
      entityType: "item",
      entityId: input.itemId,
      actorId: input.actorId ?? undefined,
      after: {
        warehouseId: input.warehouseId,
        amount: input.amount,
        journalEntryId: input.journalEntryId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
    });
    return { moveId };
  }
}
