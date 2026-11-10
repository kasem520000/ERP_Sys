import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/treasury.store";
import {
  AllocationExceedsDocumentError,
  OpenItemCurrencyMismatchError,
  OpenItemNotFoundError,
  OpenItemPartnerMismatchError,
  OpenItemSideInvalidError,
  ReceiptNotFoundError,
  PaymentNotFoundError,
  TreasuryDocumentStateError,
} from "../domain/treasury-errors";
import { moneyAdd, moneyCompare, moneySub } from "./document-support";

/**
 * Allocation service (PHASE-008 T4; INV-016; BR-027; CC-02): partner
 * allocations for receipts and payments. FIFO suggestion by default with
 * manual override before posting; partial allocations; unallocated
 * remainders stay explicit on-account open items (the receipt's own
 * control line). Set-time validation gives the UI immediate typed
 * feedback; the AUTHORITATIVE bound enforcement runs at posting time under
 * the open-item row lock (fx-settlement.validateAllocationsUnderLock —
 * CC-02) — never trust a draft-time snapshot.
 */
@Injectable()
export class AllocationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** FIFO suggestion (§2.3): oldest open items first, capped at the amount. */
  async suggest(input: { partnerId: string; side: "AR" | "AP"; amount: string }) {
    return store.fifoSuggestion(input);
  }

  /** The partner's open items (AR receivables / AP payables). */
  async openItems(input: { partnerId?: string; side: "AR" | "AP"; limit?: number }) {
    return store.listOpenItems({
      partnerId: input.partnerId,
      side: input.side,
      openOnly: true,
      limit: input.limit ?? 200,
    });
  }

  async listForDoc(docType: "receipt" | "payment", docId: string) {
    await this.requireDoc(docType, docId);
    return store.listAllocationsForDoc(docType, docId);
  }

  /**
   * Replace the DRAFT document's allocation rows (manual override path).
   * Soft validation only — authoritative INV-016 enforcement is at post.
   */
  async setAllocations(input: {
    docType: "receipt" | "payment";
    docId: string;
    allocations: readonly { openItemId: string; amount: string }[];
    actorId: string | null;
  }): Promise<void> {
    const doc = await this.requireDoc(input.docType, input.docId);
    if (doc.status !== "DRAFT" && doc.status !== "PENDING_APPROVAL") {
      throw new TreasuryDocumentStateError(
        `${input.docType} ${input.docId} is ${doc.status} — allocations are immutable once POSTED (INV-014: reversal-only correction)`,
      );
    }
    // Soft bounds (fast feedback): Σ ≤ document amount, per-item shape.
    let allocated = "0.0000";
    for (const allocation of input.allocations) {
      allocated = moneyAdd(allocated, allocation.amount);
    }
    if (moneyCompare(allocated, doc.amount) > 0) {
      throw new AllocationExceedsDocumentError({ allocated, amount: doc.amount });
    }
    for (const allocation of input.allocations) {
      const item = await store.findOpenItemById(allocation.openItemId);
      if (item === undefined) throw new OpenItemNotFoundError(allocation.openItemId);
      if (item.partnerId !== doc.partnerId) {
        throw new OpenItemPartnerMismatchError({
          openItemPartnerId: item.partnerId,
          documentPartnerId: doc.partnerId,
        });
      }
      if (item.currencyCode !== doc.currencyCode) {
        throw new OpenItemCurrencyMismatchError({
          openItemCurrency: item.currencyCode,
          documentCurrency: doc.currencyCode,
        });
      }
      if (input.docType === "receipt" && item.direction !== "DEBIT") {
        throw new OpenItemSideInvalidError({ documentType: "receipt", requiredSide: "AR receivable" });
      }
      if (input.docType === "payment" && item.direction !== "CREDIT") {
        throw new OpenItemSideInvalidError({ documentType: "payment", requiredSide: "AP payable" });
      }
    }
    await store.replaceDraftAllocations({
      docType: input.docType,
      docId: input.docId,
      allocations: input.allocations,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: `treasury.${input.docType}_allocations_set`,
      entityType: input.docType,
      entityId: input.docId,
      actorId: input.actorId ?? undefined,
      after: { rows: input.allocations.length, allocated },
    });
  }

  /** Effective settled amount per open item (posted allocations only). */
  async settledForOpenItem(openItemId: string): Promise<string> {
    const item = await store.findOpenItemById(openItemId);
    if (item === undefined) throw new OpenItemNotFoundError(openItemId);
    return item.settledAmount;
  }

  /** On-account remainder of a document (BR-027 — explicit, never netted). */
  async onAccountRemainder(docType: "receipt" | "payment", docId: string): Promise<string> {
    const doc = await this.requireDoc(docType, docId);
    return moneySub(doc.amount, doc.allocatedAmount);
  }

  private async requireDoc(docType: "receipt" | "payment", docId: string) {
    const doc =
      docType === "receipt"
        ? await store.findReceiptById(docId)
        : await store.findPaymentById(docId);
    if (doc === undefined) {
      throw docType === "receipt"
        ? new ReceiptNotFoundError(docId)
        : new PaymentNotFoundError(docId);
    }
    return doc;
  }
}
