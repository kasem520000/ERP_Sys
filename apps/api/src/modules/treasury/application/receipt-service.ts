import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { PartnerNotFoundError } from "../../partners/domain/partner-errors";
import * as store from "../infrastructure/treasury.store";
import { ReceiptNotFoundError, TreasuryDocumentStateError } from "../domain/treasury-errors";
import { requireActiveAccount, requirePositiveAmount, resolveDocumentRate } from "./document-support";
import { SettlementCore } from "./fx-settlement";

/**
 * Receipt service (PHASE-008 T3; G-05/G-06): money-in documents — DRAFT →
 * POSTED (DOCUMENT_LIFECYCLE §3: no approval by default; an active BR-034
 * policy on doc_type 'receipt' adds the PENDING_APPROVAL hop). Rate capture
 * at creation (r₁), official RCV numbers at posting (INV-021), settlements
 * with FX differences via the shared core (INV-008/016/019).
 */
@Injectable()
export class ReceiptService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly settlement: SettlementCore,
  ) {}

  async list(filter: {
    status?: string;
    partnerId?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
  }) {
    return store.listReceipts(filter);
  }

  async find(id: string) {
    const receipt = await store.findReceiptById(id);
    if (receipt === undefined) throw new ReceiptNotFoundError(id);
    return receipt;
  }

  async create(input: {
    cashAccountId: string;
    partnerId: string;
    method: string;
    payerName: string | null;
    currencyCode: string;
    amount: string;
    exchangeRate: string | null;
    valueDate: string;
    reference: string | null;
    description: string | null;
    descriptionAr: string | null;
    actorId: string | null;
  }) {
    const amount = requirePositiveAmount(input.amount, "receipt amount");
    requireActiveAccount(await store.findCashAccountById(input.cashAccountId));
    // A7/S-04: the partner must exist in THIS tenant — foreign/unknown ids
    // get the typed 404-shape with zero partial creation (the FK alone
    // would surface as an untyped 500).
    const partnersStore = await import("../../partners/infrastructure/partners.store");
    const partner = await partnersStore.findPartnerById(input.partnerId);
    if (partner === undefined) throw new PartnerNotFoundError(input.partnerId);
    void (await resolveDocumentRate({
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
    }));
    const created = await store.insertReceipt({
      cashAccountId: input.cashAccountId,
      partnerId: input.partnerId,
      method: input.method,
      payerName: input.payerName,
      currencyCode: input.currencyCode,
      amount,
      exchangeRate: input.exchangeRate,
      valueDate: input.valueDate,
      reference: input.reference,
      description: input.description,
      descriptionAr: input.descriptionAr,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "treasury.receipt_created",
      entityType: "receipt",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { amount, currency: input.currencyCode, partnerId: input.partnerId, valueDate: input.valueDate },
    });
    return created;
  }

  /** The optional BR-034 approval hop (policy-gated tenants only). */
  async submit(id: string, actorId: string | null) {
    const receipt = await this.find(id);
    if (receipt.status !== "DRAFT") {
      throw new TreasuryDocumentStateError(`receipt ${id} is ${receipt.status} — only DRAFT receipts can submit`);
    }
    await store.updateReceiptStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const receipt = await this.find(id);
    await this.settlement.approveDoc({
      docType: "receipt",
      doc: { id, status: receipt.status, createdBy: receipt.createdBy },
      actorId,
    });
    await store.updateReceiptStatus({ id, status: "APPROVED", actorId });
    await this.audit.record({
      action: "treasury.receipt_approved",
      entityType: "receipt",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  async post(id: string, actorId: string | null) {
    const receipt = await this.find(id);
    const account = requireActiveAccount(await store.findCashAccountById(receipt.cashAccountId));
    return this.settlement.postSettlement({ docType: "receipt", doc: receipt, account, actorId });
  }

  async reverse(input: { id: string; entryDate: string; reason: string; actorId: string | null }) {
    const receipt = await this.find(input.id);
    const account = requireActiveAccount(await store.findCashAccountById(receipt.cashAccountId));
    if (receipt.status !== "POSTED") {
      throw new TreasuryDocumentStateError(
        `only POSTED receipts can be reversed (got ${receipt.status}) — IMMUTABLE_DOCUMENT`,
      );
    }
    return this.settlement.reverseSettlement({
      docType: "receipt",
      doc: receipt,
      account,
      entryDate: input.entryDate,
      reason: input.reason,
      actorId: input.actorId,
    });
  }

  async cancel(input: { id: string; reason: string; actorId: string | null }) {
    const receipt = await this.find(input.id);
    if (receipt.status === "POSTED") {
      throw new TreasuryDocumentStateError(
        "posted receipts are immutable — cancel is reversal-only (INV-014)",
      );
    }
    await store.cancelReceipt({ id: input.id, actorId: input.actorId, reason: input.reason });
    await this.audit.record({
      action: "treasury.receipt_cancelled",
      entityType: "receipt",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      before: { status: receipt.status },
      after: { status: "CANCELLED", reason: input.reason },
    });
    return this.find(input.id);
  }
}
