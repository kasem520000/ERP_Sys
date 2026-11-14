import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { PurchaseOrderService } from "../../purchasing/application/orders";
import { TransferService } from "../../inventory/application/transfer-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/planning.store";
import * as mfgStore from "../infrastructure/manufacturing.store";
import { ProductionOrderService } from "./production-order-service";
import {
  MrpConversionConflictError,
  MrpConversionPrerequisiteError,
  MrpDismissReasonRequiredError,
  MrpSuggestionNotFoundError,
  MrpSuggestionStateError,
} from "../domain/manufacturing-errors";

/**
 * MRP suggestions service (PHASE-043 T-05; H-03/M-01/M-24): the
 * suggestion lifecycle — SUGGESTED → ACCEPTED (the one-click conversion)
 * / DISMISSED (a reason is required) / SUPERSEDED (the re-run coverage
 * netting, owned by the engine). Acceptance is IDEMPOTENT (INV-030 /
 * BR-079): exactly one document per suggestion — the retry returns the
 * ORIGINAL conversion result, never a second document; the
 * uq_mrp_suggestions_converted_doc partial unique index is the DB anchor
 * and every conversion writes the bidirectional link (the document-side
 * stamp through the OWNING service — purchasing's
 * linkMrpSuggestion / manufacturing's own patch arm / inventory's
 * linkMrpSuggestion — plus the suggestion-side converted_doc_type/id).
 *
 * The conversion path per type (acceptance criterion 4 — no duplicated
 * document-creation logic):
 *   PURCHASE_ORDER  → PurchaseOrderService.create (the PHASE-038 path —
 *                     the AwardService.award precedent), supplier = the
 *                     deterministic approved-sourcing pick, price resolved
 *                     by the create path itself, expectedDate = the
 *                     suggestion due date).
 *   PRODUCTION_ORDER→ ProductionOrderService.create (the BOM pre-bound
 *                     from the suggestion's snapshot bomId — the routing
 *                     binds at release per the 042 dual-mode), then the
 *                     DRAFT order carries mrp_suggestion_id.
 *   TRANSFER        → TransferService.create (a DRAFT transfer from the
 *                     suggestion's from-warehouse; dispatch/receive stay
 *                     the operator's explicit steps).
 */

/** The conversion's result — the idempotent replay returns the stored
 * shape (recomputed from the rows, no second document). */
export interface ConversionResult {
  suggestion: store.MrpSuggestionRow;
  documentType: "purchase_order" | "production_order" | "stock_transfer";
  documentId: string;
  /** The replay flag: true when accept() found the conversion already
   * done (INV-030 — the retry is a read, not a write). */
  replay: boolean;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class MrpSuggestionsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PurchaseOrderService) private readonly purchaseOrders: PurchaseOrderService,
    @Inject(ProductionOrderService) private readonly productionOrders: ProductionOrderService,
    @Inject(TransferService) private readonly transfers: TransferService,
  ) {}

  // -- reads -------------------------------------------------------------------------

  async find(id: string): Promise<store.MrpSuggestionRow> {
    const suggestion = await store.findMrpSuggestionById(id);
    if (suggestion === undefined) throw new MrpSuggestionNotFoundError(id);
    return suggestion;
  }

  async list(filter: {
    runId?: string;
    warehouseId?: string;
    itemId?: string;
    status?: string;
    suggestionType?: string;
    limit: number;
  }): Promise<store.MrpSuggestionRow[]> {
    return store.listMrpSuggestions(filter);
  }

  // -- dismissal (BR-079: the reason is not optional) ----------------------------------

  async dismiss(id: string, reason: string, actorId: string | null): Promise<store.MrpSuggestionRow> {
    // The LOCKED read (the 043-audit item-3 fix): accept-vs-dismiss races
    // serialize here — the loser sees the winner's post-commit state.
    const suggestion = await store.findMrpSuggestionByIdForUpdate(id);
    if (suggestion === undefined) {
      throw new MrpSuggestionNotFoundError(id);
    }
    if (suggestion.status !== "SUGGESTED") {
      throw new MrpSuggestionStateError(id, suggestion.status, "dismiss");
    }
    const trimmed = reason.trim();
    if (trimmed.length < 1 || trimmed.length > 300) {
      throw new MrpDismissReasonRequiredError();
    }
    const updated = await store.patchMrpSuggestion({
      id,
      status: "DISMISSED",
      dismissedReason: trimmed,
      dismissedAt: true,
      dismissedBy: actorId,
      requireStatus: "SUGGESTED",
    });
    if (!updated) {
      // The state moved under us (cannot happen under the lock — the
      // honest belt-and-braces): re-read and surface the typed state.
      throw new MrpSuggestionStateError(id, (await this.find(id)).status, "dismiss");
    }
    await this.audit.record({
      action: "manufacturing.mrp.suggestion_dismissed",
      entityType: "mrp_suggestion",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason: trimmed },
    });
    return this.find(id);
  }

  // -- acceptance (INV-030: idempotent, exactly one document) --------------------------

  async accept(id: string, actorId: string | null): Promise<ConversionResult> {
    // The LOCKED read (the 043-audit item-3 fix): two concurrent accepts
    // serialize on the row lock — the second blocks until the first
    // commits, then reads the post-commit state and REPLAYS the stored
    // conversion (INV-030's idempotent law) instead of creating a second
    // document. Pre-fix, both transactions read SUGGESTED, both created a
    // document, and the last patch overwrote the link — two documents,
    // one orphaned, no error (the unique index only anchors the
    // doc→suggestion direction: ONE document claimed by ONE suggestion;
    // it never prevented two DIFFERENT documents for one suggestion).
    const suggestion = await store.findMrpSuggestionByIdForUpdate(id);
    if (suggestion === undefined) {
      throw new MrpSuggestionNotFoundError(id);
    }

    // INV-030 idempotent replay: an ACCEPTED suggestion returns its stored
    // conversion — the document link is honored as-is (a vanished document
    // is the typed conflict, never a silent second create).
    if (suggestion.status === "ACCEPTED") {
      if (suggestion.convertedDocType === null || suggestion.convertedDocId === null) {
        throw new MrpConversionConflictError(
          `suggestion ${id} is ACCEPTED but carries no converted document link — the conversion record is inconsistent`,
          { suggestionId: id },
        );
      }
      return {
        suggestion,
        documentType: suggestion.convertedDocType as ConversionResult["documentType"],
        documentId: suggestion.convertedDocId,
        replay: true,
      };
    }
    if (suggestion.status !== "SUGGESTED") {
      throw new MrpSuggestionStateError(id, suggestion.status, "accept");
    }

    // The conversion — each leg through its owning service.
    let documentId: string;
    switch (suggestion.suggestionType) {
      case "PURCHASE_ORDER": {
        documentId = await this.convertToPurchaseOrder(suggestion, actorId);
        break;
      }
      case "PRODUCTION_ORDER": {
        documentId = await this.convertToProductionOrder(suggestion, actorId);
        break;
      }
      case "TRANSFER": {
        documentId = await this.convertToTransfer(suggestion, actorId);
        break;
      }
      default:
        throw new MrpConversionConflictError(
          `suggestion ${id} carries an unknown type ${suggestion.suggestionType}`,
          { suggestionId: id, suggestionType: suggestion.suggestionType },
        );
    }

    // The suggestion-side link. The serialization is the ROW LOCK above
    // (this whole method rides the caller's one UoW — the document
    // creation and the link commit or roll back TOGETHER); the guarded
    // update (status still SUGGESTED) and the partial unique index
    // (uq_mrp_suggestions_converted_doc — the doc→suggestion anchor:
    // one document claimed by one suggestion) are the belt-and-braces.
    // The 23505 catch stays for any residual path.
    let linked: boolean;
    try {
      linked = await store.patchMrpSuggestion({
        id,
        status: "ACCEPTED",
        convertedDocType:
          suggestion.suggestionType === "PURCHASE_ORDER"
            ? "purchase_order"
            : suggestion.suggestionType === "PRODUCTION_ORDER"
              ? "production_order"
              : "stock_transfer",
        convertedDocId: documentId,
        acceptedAt: true,
        acceptedBy: actorId,
        requireStatus: "SUGGESTED",
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new MrpConversionConflictError(
          `suggestion ${id} was already converted (a concurrent accept won the link) — reload the board`,
          { suggestionId: id },
        );
      }
      throw error;
    }
    if (!linked) {
      // The state moved under us (cannot happen under the lock — the
      // belt-and-braces): the document creation rolls back with this
      // throw (one UoW), and the honest error is the post-state.
      const after = await store.findMrpSuggestionById(id);
      if (after !== undefined && after.status === "ACCEPTED" && after.convertedDocId !== null) {
        return {
          suggestion: after,
          documentType: after.convertedDocType as ConversionResult["documentType"],
          documentId: after.convertedDocId,
          replay: true,
        };
      }
      throw new MrpSuggestionStateError(id, after?.status ?? "UNKNOWN", "accept");
    }
    await this.audit.record({
      action: "manufacturing.mrp.suggestion_accepted",
      entityType: "mrp_suggestion",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { documentId, suggestionType: suggestion.suggestionType, qty: suggestion.qty },
    });
    return {
      suggestion: await this.find(id),
      documentType:
        suggestion.suggestionType === "PURCHASE_ORDER"
          ? "purchase_order"
          : suggestion.suggestionType === "PRODUCTION_ORDER"
            ? "production_order"
            : "stock_transfer",
      documentId,
      replay: false,
    };
  }

  // -- the conversion legs (each through the owning service) ---------------------------

  private async convertToPurchaseOrder(
    suggestion: store.MrpSuggestionRow,
    actorId: string | null,
  ): Promise<string> {
    const supplierId = await this.purchaseOrders.findApprovedSupplierForItem(suggestion.itemId);
    if (supplierId === undefined) {
      throw new MrpConversionPrerequisiteError(
        `item ${suggestion.itemId} has no APPROVED sourcing row — a PURCHASE conversion needs the approved-vendor list (maintain it on the sourcing screen, or dismiss the suggestion with a reason)`,
        { suggestionId: suggestion.id, itemId: suggestion.itemId },
      );
    }
    const { requireActiveWarehouse } = await import("../../inventory/application/movement-core");
    const warehouse = await requireActiveWarehouse(suggestion.warehouseId);
    const created = await this.purchaseOrders.create({
      branchId: warehouse.branchId,
      supplierId,
      orderDate: today(),
      expectedDate: suggestion.dueDate,
      currencyCode: await ownTenantBaseCurrency(),
      exchangeRate: null,
      note: `MRP suggestion ${suggestion.id} — converted purchase order`,
      noteAr: `اقتراح تخطيط ${suggestion.id} — أمر شراء مُحوَّل`,
      actorId,
      lines: [
        {
          itemId: suggestion.itemId,
          qty: suggestion.qty,
          unitPrice: null, // the 038 create path resolves the price (list → base cost → MANUAL)
          taxCodeId: null,
          note: `MRP run ${suggestion.runId} — due ${suggestion.dueDate}`,
        },
      ],
    });
    await this.purchaseOrders.linkMrpSuggestion(created.id, suggestion.id);
    return created.id;
  }

  private async convertToProductionOrder(
    suggestion: store.MrpSuggestionRow,
    actorId: string | null,
  ): Promise<string> {
    const item = await store.findItemPlanning(suggestion.itemId);
    if (item === undefined) {
      throw new MrpConversionPrerequisiteError(
        `item ${suggestion.itemId} no longer exists — the suggestion is stale (dismiss it with a reason)`,
        { suggestionId: suggestion.id, itemId: suggestion.itemId },
      );
    }
    const created = await this.productionOrders.create({
      branchId: await this.warehouseBranchId(suggestion.warehouseId),
      itemId: suggestion.itemId,
      bomId: suggestion.bomId,
      plannedQty: suggestion.qty,
      plannedDate: suggestion.dueDate,
      materialsWarehouseId: suggestion.warehouseId,
      fgWarehouseId: suggestion.warehouseId,
      note: `MRP suggestion ${suggestion.id} — converted production order`,
      noteAr: `اقتراح تخطيط ${suggestion.id} — أمر إنتاج مُحوَّل`,
      actorId,
    });
    await mfgStore.patchProductionOrder({ id: created.id, mrpSuggestionId: suggestion.id });
    return created.id;
  }

  private async convertToTransfer(
    suggestion: store.MrpSuggestionRow,
    actorId: string | null,
  ): Promise<string> {
    if (suggestion.fromWarehouseId === null) {
      throw new MrpConversionPrerequisiteError(
        `suggestion ${suggestion.id} is a TRANSFER without a from-warehouse — the suggestion is inconsistent`,
        { suggestionId: suggestion.id },
      );
    }
    const created = await this.transfers.create({
      fromWarehouseId: suggestion.fromWarehouseId,
      toWarehouseId: suggestion.warehouseId,
      lines: [{ itemId: suggestion.itemId, qty: suggestion.qty }],
      note: `MRP suggestion ${suggestion.id} — converted transfer`,
      noteAr: `اقتراح تخطيط ${suggestion.id} — تحويل مخزني مُحوَّل`,
      actorId,
    });
    await this.transfers.linkMrpSuggestion(created.id, suggestion.id);
    return created.id;
  }

  private async warehouseBranchId(warehouseId: string): Promise<string> {
    const { requireActiveWarehouse } = await import("../../inventory/application/movement-core");
    const warehouse = await requireActiveWarehouse(warehouseId);
    return warehouse.branchId;
  }
}

/** 23505 = unique_violation (PostgreSQL SQLSTATE); unwraps driver causes. */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}
