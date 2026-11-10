import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import * as store from "../infrastructure/inventory.store";
import {
  InvalidQuantityError,
  ItemNotFoundError,
  SerialReturnBindingError,
  StockAdjustmentStateError,
} from "../domain/inventory-errors";
import {
  applyIssue,
  applyReceipt,
  inventoryJournalLines,
  planIssue,
  planReceipt,
  requireNonNegativeCost,
  requirePositiveQty,
  resolveInventoryAccount,
} from "./movement-core";

/**
 * Manual receipts/issues + the stock query surface (PHASE-010 §2.17/§2.15).
 *
 * Manual moves are reason-coded direct stock operations for operational
 * edge cases — NEVER a way around the posting engine: every move composes
 * its journal through PostingService.post inside the same transaction
 * (INV-018), with the counter-line fixed by the reason code:
 *
 *   RECEIPT reasons — CUSTOMER_RETURN → CR COGS (at the ORIGINAL issue
 *   cost per INVENTORY_ACCOUNTING §2 — the credit note pairs with it in
 *   PHASE-012), COUNT_GAIN → CR INVENTORY_APPRECIATION, OTHER → the
 *   caller's explicit postable counter account (the service never
 *   invents the economic counterparty).
 *
 *   ISSUE reasons — DAMAGE / EXPIRED / COUNT_LOSS → DR INVENTORY_
 *   SHRINKAGE (the expiry write-off posts here with reason EXPIRED),
 *   OTHER → explicit counter account.
 *
 * The availability service (§2.15) is the published read PHASE-011/012
 * consume: on-hand − active reservations, with in-transit visible but
 * never sellable/reservable (BR-016).
 */
@Injectable()
export class StockService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  // -- queries -----------------------------------------------------------------

  async onHand(filter: { warehouseId?: string; itemId?: string; q?: string; limit: number }) {
    return store.listStockOnHand(filter);
  }

  async moves(filter: {
    warehouseId?: string;
    itemId?: string;
    direction?: string;
    moveKind?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
  }) {
    return store.listStockMoves(filter);
  }

  /** Availability (§2.15): on-hand, reserved, in-transit, quarantined
   * (PHASE-018 — the QC hold nets out of available), available. */
  async availability(input: { itemId: string; warehouseId: string }) {
    const stock = await store.findItemStock(input.itemId, input.warehouseId);
    const reserved = await store.reservedQty(input.itemId, input.warehouseId);
    const quarantined = await store.quarantinedQty(input.itemId, input.warehouseId);
    const inTransitRows = await store.listInTransit(input.warehouseId);
    const inTransitQty = inTransitRows
      .filter((row) => row.itemId === input.itemId)
      .reduce((sum, row) => sum.plus(new Decimal(row.qty)), new Decimal(0));
    const onHand = stock?.qty ?? "0.000000";
    const available = new Decimal(onHand)
      .minus(new Decimal(reserved))
      .minus(new Decimal(quarantined))
      .toFixed(6);
    return {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      onHandQty: onHand,
      avgCost: stock?.avgCost ?? "0.000000",
      reservedQty: reserved,
      inTransitQty: inTransitQty.toFixed(6),
      quarantinedQty: new Decimal(quarantined).toFixed(6),
      availableQty: available,
    };
  }

  // -- manual receipts (§2.17) ---------------------------------------------------

  async manualReceipt(input: {
    itemId: string;
    warehouseId: string;
    qty: string;
    unitCost: string | null;
    reason: "CUSTOMER_RETURN" | "COUNT_GAIN" | "OTHER";
    counterAccountId: string | null;
    valueDate: string;
    serialId?: string | null;
    serialIds?: string[];
    batchId?: string | null;
    batchNo?: string | null;
    batchExpiry?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }) {
    requirePositiveQty(input.qty, "receipt qty");
    const item = await store.findItemForInventory(input.itemId);
    if (item === undefined) throw new ItemNotFoundError(input.itemId);

    // Unit cost: explicit, else the ORIGINAL issue cost for a bound
    // customer return (INVENTORY_ACCOUNTING §2 — returns re-enter at
    // original cost), else the current valuation (gain-style receipts).
    let unitCost =
      input.unitCost !== null
        ? requireNonNegativeCost(input.unitCost, "unit cost")
        : null;
    if (unitCost === null) {
      if (input.reason === "CUSTOMER_RETURN" && (input.serialId ?? null) !== null) {
        const original = await store.findSerialIssueMove(input.serialId!);
        if (original === undefined) throw new SerialReturnBindingError(input.serialId!);
        unitCost = original.unitCost;
      } else {
        const stock = await store.findItemStock(input.itemId, input.warehouseId);
        unitCost = stock?.avgCost ?? "0.000000";
        if (unitCost === "0.000000") {
          throw new InvalidQuantityError(
            "a receipt needs an explicit unitCost when the position has no known valuation",
          );
        }
      }
    }
    if (input.reason === "OTHER" && (input.counterAccountId ?? null) === null) {
      throw new StockAdjustmentStateError("reason OTHER requires an explicit counter account");
    }

    // PLAN (no writes): valuation + batch/serial binding under the lock.
    const plan = await planReceipt({
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      qty: input.qty,
      unitCost,
      movedAt: input.valueDate,
      moveKind: "receipt",
      sourceType: "manual_receipt",
      sourceId: input.itemId,
      reason: input.reason,
      batchId: input.batchId ?? null,
      batchNo: input.batchNo ?? null,
      batchExpiry: input.batchExpiry ?? null,
      serialIds:
        input.serialIds ??
        (input.serialId !== null && input.serialId !== undefined ? [input.serialId] : undefined),
      memo: input.note ?? null,
      memoAr: input.noteAr ?? null,
    });

    // POST: the economic effect first (ADR-0007) — idempotency on the
    // move's own id.
    const inventoryAccount = await resolveInventoryAccount(input.warehouseId);
    const counterPurpose =
      input.reason === "CUSTOMER_RETURN"
        ? "COGS"
        : input.reason === "COUNT_GAIN"
          ? "INVENTORY_APPRECIATION"
          : undefined;
    const lines = inventoryJournalLines({
      inventoryAccountId: inventoryAccount,
      direction: "IN",
      value: plan.valueAmount,
      counterPurpose,
      counterAccountId: input.reason === "OTHER" ? input.counterAccountId! : undefined,
      memoEn: `Stock receipt — ${item.sku}`,
      memoAr: `إدخال مخزون — ${item.sku}`,
    });
    const spec: JournalSpec = {
      source: { docType: "stock_move", docId: plan.anchorId, operation: "post" },
      entryDate: input.valueDate,
      description: {
        en: `Manual stock receipt — ${item.sku} (${input.reason})`,
        ar: `إدخال مخزون يدوي — ${item.sku} (${input.reason})`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    // APPLY: the move rows carry the journal id at INSERT (append-only).
    const moveId = await applyReceipt(plan, result.journalEntryId);
    if (plan.serialIds.length > 0 && input.reason === "CUSTOMER_RETURN") {
      // The sold unit re-shelves: in_stock again, sale history intact in
      // the move ledger (BR-018's original-cost lookup reads it).
      for (const serialId of plan.serialIds) {
        await store.markSerialInStock(serialId);
      }
    }
    await this.audit.record({
      action: "inventory.manual_receipt_posted",
      entityType: "stock_move",
      entityId: moveId,
      actorId: input.actorId ?? undefined,
      after: {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        qty: input.qty,
        unitCost,
        reason: input.reason,
        journalEntryId: result.journalEntryId,
      },
    });
    return {
      moveId,
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      valueAmount: plan.valueAmount,
    };
  }

  // -- manual issues (§2.17) ------------------------------------------------------

  async manualIssue(input: {
    itemId: string;
    warehouseId: string;
    qty: string;
    reason: "DAMAGE" | "EXPIRED" | "COUNT_LOSS" | "OTHER";
    counterAccountId: string | null;
    valueDate: string;
    serialIds?: string[];
    batchId?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }) {
    requirePositiveQty(input.qty, "issue qty");
    const item = await store.findItemForInventory(input.itemId);
    if (item === undefined) throw new ItemNotFoundError(input.itemId);
    if (input.reason === "OTHER" && (input.counterAccountId ?? null) === null) {
      throw new StockAdjustmentStateError("reason OTHER requires an explicit counter account");
    }

    // PLAN (no writes): FEFO/serial picking + valuation under the lock.
    const plan = await planIssue({
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      qty: input.qty,
      movedAt: input.valueDate,
      moveKind: "issue",
      sourceType: "manual_issue",
      sourceId: input.itemId,
      reason: input.reason,
      batchId: input.batchId ?? null,
      serialIds: input.serialIds,
      memo: input.note ?? null,
      memoAr: input.noteAr ?? null,
    });

    // POST: the economic effect first.
    const inventoryAccount = await resolveInventoryAccount(input.warehouseId);
    const counterPurpose = input.reason === "OTHER" ? undefined : "INVENTORY_SHRINKAGE";
    const lines = inventoryJournalLines({
      inventoryAccountId: inventoryAccount,
      direction: "OUT",
      value: plan.valueAmount,
      counterPurpose,
      counterAccountId: input.reason === "OTHER" ? input.counterAccountId! : undefined,
      memoEn: `Stock issue — ${item.sku} (${input.reason})`,
      memoAr: `إخراج مخزون — ${item.sku} (${input.reason})`,
    });
    const spec: JournalSpec = {
      source: { docType: "stock_move", docId: plan.anchorId, operation: "post" },
      entryDate: input.valueDate,
      description: {
        en: `Manual stock issue — ${item.sku} (${input.reason})`,
        ar: `إخراج مخزون يدوي — ${item.sku} (${input.reason})`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    // APPLY: move rows + serial flips with the journal id at INSERT.
    const moveIds = await applyIssue(plan, result.journalEntryId);
    await this.audit.record({
      action: "inventory.manual_issue_posted",
      entityType: "stock_move",
      entityId: moveIds[0] ?? "",
      actorId: input.actorId ?? undefined,
      after: {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        qty: input.qty,
        reason: input.reason,
        journalEntryId: result.journalEntryId,
      },
    });
    return {
      moveId: plan.anchorId,
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      valueAmount: plan.valueAmount,
    };
  }
}
