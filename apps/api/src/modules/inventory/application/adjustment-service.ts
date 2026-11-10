import { Inject, Injectable } from "@nestjs/common";
import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import * as store from "../infrastructure/inventory.store";
import {
  StockAdjustmentNotFoundError,
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
 * Manual stock adjustments (PHASE-010 §4 API /inventory/adjustments + /post;
 * golden sources `stock_adjustment:post`): DRAFT → POSTED reason-coded
 * documents. delta_qty is SIGNED — negative = loss (G-13: DR
 * INVENTORY_SHRINKAGE · CR INVENTORY), positive = gain (G-14: DR INVENTORY
 * · CR INVENTORY_APPRECIATION); reason OTHER requires the caller's
 * explicit postable counter account. The posting is approval-separated
 * by permission (inventory.adjustments.post is a risky, audited key —
 * matrix §3.5) and lands in the OPENING period's successor periods per
 * the engine's INV-011 gate.
 */
@Injectable()
export class AdjustmentService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; warehouseId?: string; limit: number }) {
    return store.listAdjustments(filter);
  }

  async find(id: string) {
    const adjustment = await store.findAdjustmentById(id);
    if (adjustment === undefined) throw new StockAdjustmentNotFoundError(id);
    return adjustment;
  }

  async create(input: {
    warehouseId: string;
    itemId: string;
    reason: "DAMAGE" | "EXPIRED" | "COUNT_LOSS" | "COUNT_GAIN" | "OTHER";
    deltaQty: string;
    unitCost: string | null;
    counterAccountId: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    requirePositiveQty(
      input.deltaQty.startsWith("-") ? input.deltaQty.slice(1) : input.deltaQty,
      "adjustment delta",
    );
    if (input.unitCost !== null) {
      requireNonNegativeCost(input.unitCost, "adjustment unit cost");
    }
    if (input.reason === "OTHER" && (input.counterAccountId ?? null) === null) {
      throw new StockAdjustmentStateError("reason OTHER requires an explicit counter account");
    }
    const id = generateUuidV7();
    await store.insertAdjustment({
      id,
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      reason: input.reason,
      deltaQty: input.deltaQty,
      unitCost: input.unitCost,
      counterAccountId: input.counterAccountId,
      note: input.note,
      noteAr: input.noteAr,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.adjustment_created",
      entityType: "stock_adjustment",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        warehouseId: input.warehouseId,
        itemId: input.itemId,
        reason: input.reason,
        deltaQty: input.deltaQty,
      },
    });
    return this.find(id);
  }

  async post(id: string, actorId: string | null) {
    const adjustment = await this.find(id);
    if (adjustment.status !== "DRAFT" && adjustment.status !== "POSTED") {
      throw new StockAdjustmentStateError(`adjustment ${id} is ${adjustment.status} — only DRAFT posts`);
    }
    const isGain = Number(adjustment.deltaQty) > 0;
    const qty = adjustment.deltaQty.replace("-", "");
    const postingDate = today();

    // PLAN (no writes): the movement + its exact journal quantum.
    const plan = isGain
      ? await planReceipt({
          itemId: adjustment.itemId,
          warehouseId: adjustment.warehouseId,
          qty,
          unitCost:
            adjustment.unitCost ??
            (await currentValuation(adjustment.itemId, adjustment.warehouseId)),
          movedAt: postingDate,
          moveKind: "adjust",
          sourceType: "stock_adjustment",
          sourceId: adjustment.id,
          reason: adjustment.reason,
          memo: adjustment.note ?? null,
          memoAr: adjustment.noteAr ?? null,
        })
      : await planIssue({
          itemId: adjustment.itemId,
          warehouseId: adjustment.warehouseId,
          qty,
          movedAt: postingDate,
          moveKind: "adjust",
          sourceType: "stock_adjustment",
          sourceId: adjustment.id,
          reason: adjustment.reason,
          memo: adjustment.note ?? null,
          memoAr: adjustment.noteAr ?? null,
        });

    // POST (G-13/G-14): the economic effect through the engine.
    const inventoryAccount = await resolveInventoryAccount(adjustment.warehouseId);
    const counterPurpose =
      adjustment.reason === "OTHER"
        ? undefined
        : isGain
          ? "INVENTORY_APPRECIATION"
          : "INVENTORY_SHRINKAGE";
    const lines = inventoryJournalLines({
      inventoryAccountId: inventoryAccount,
      direction: isGain ? "IN" : "OUT",
      value: plan.valueAmount,
      counterPurpose,
      counterAccountId: adjustment.reason === "OTHER" ? adjustment.counterAccountId! : undefined,
      memoEn: `Stock adjustment — ${adjustment.sku} (${adjustment.reason})`,
      memoAr: `تسوية مخزون — ${adjustment.sku} (${adjustment.reason})`,
    });
    const spec: JournalSpec = {
      source: { docType: "stock_adjustment", docId: adjustment.id, operation: "post" },
      entryDate: postingDate,
      description: {
        en: `Stock adjustment ${adjustment.sku} ${adjustment.reason} ${adjustment.deltaQty}`,
        ar: `تسوية مخزون ${adjustment.sku} ${adjustment.reason} ${adjustment.deltaQty}`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });

    // APPLY: rows + number + state flip inside the same UoW.
    if (!result.idempotentReplay) {
      if (plan.kind === "RECEIPT") {
        await applyReceipt(plan, result.journalEntryId);
      } else {
        await applyIssue(plan, result.journalEntryId);
      }
      const acquired = await this.numbering.reserve({
        docType: "stock_adjustment",
        branchId: null,
        periodKey: postingDate.slice(0, 4),
        format: "TRA-{YYYY}-{SEQ:6}",
        prefix: "TRA",
        year: postingDate.slice(0, 4),
      });
      const flipped = await store.markAdjustmentPosted({
        id: adjustment.id,
        adjustmentNo: acquired.number,
        postingDate,
        postedBy: actorId,
        postedJournalId: result.journalEntryId,
      });
      if (!flipped) {
        throw new StockAdjustmentStateError(`adjustment ${id} state changed underfoot`);
      }
    }
    await this.audit.record({
      action: "inventory.adjustment_posted",
      entityType: "stock_adjustment",
      entityId: adjustment.id,
      actorId: actorId ?? undefined,
      after: {
        adjustmentNo: adjustment.adjustmentNo,
        journalEntryId: result.journalEntryId,
        valueAmount: plan.valueAmount,
      },
    });
    return {
      adjustmentNo: (await store.findAdjustmentById(id))?.adjustmentNo ?? null,
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      idempotentReplay: result.idempotentReplay,
    };
  }

  async cancel(id: string, actorId: string | null) {
    const adjustment = await this.find(id);
    if (adjustment.status !== "DRAFT") {
      throw new StockAdjustmentStateError(`only DRAFT adjustments cancel — ${id} is ${adjustment.status}`);
    }
    await store.cancelAdjustment(id);
    await this.audit.record({
      action: "inventory.adjustment_cancelled",
      entityType: "stock_adjustment",
      entityId: id,
      actorId: actorId ?? undefined,
    });
  }
}

async function currentValuation(itemId: string, warehouseId: string): Promise<string> {
  const stock = await store.findItemStock(itemId, warehouseId);
  return stock?.avgCost ?? "0.000000";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
