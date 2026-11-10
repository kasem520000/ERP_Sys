import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { PartnerNotFoundError } from "../../partners/domain/partner-errors";
import * as store from "../infrastructure/treasury.store";
import { PaymentNotFoundError, TreasuryDocumentStateError } from "../domain/treasury-errors";
import { requireActiveAccount, requirePositiveAmount, resolveDocumentRate } from "./document-support";
import { SettlementCore } from "./fx-settlement";
import { PettyCashGuard } from "./petty-cash-service";

/**
 * Payment service (PHASE-008 T3; G-10): the money-out mirror of receipts —
 * supplier/payee payments with allocation to AP open items, FX mirrors of
 * G-06 (DR FX_LOSS / CR FX_GAIN), and BR-020 petty-cash per-transaction
 * cap enforcement when the funding account is a PETTY fund.
 */
@Injectable()
export class PaymentService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly settlement: SettlementCore,
    private readonly pettyCash: PettyCashGuard,
  ) {}

  async list(filter: {
    status?: string;
    partnerId?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
  }) {
    return store.listPayments(filter);
  }

  async find(id: string) {
    const payment = await store.findPaymentById(id);
    if (payment === undefined) throw new PaymentNotFoundError(id);
    return payment;
  }

  async create(input: {
    cashAccountId: string;
    partnerId: string;
    method: string;
    payeeName: string | null;
    currencyCode: string;
    amount: string;
    exchangeRate: string | null;
    valueDate: string;
    reference: string | null;
    description: string | null;
    descriptionAr: string | null;
    actorId: string | null;
    overridePettyLimit?: boolean;
  }) {
    const amount = requirePositiveAmount(input.amount, "payment amount");
    const account = requireActiveAccount(await store.findCashAccountById(input.cashAccountId));
    // A7/S-04: partner must exist in THIS tenant (typed 404, zero residue).
    const partnersStore = await import("../../partners/infrastructure/partners.store");
    const partner = await partnersStore.findPartnerById(input.partnerId);
    if (partner === undefined) throw new PartnerNotFoundError(input.partnerId);
    void (await resolveDocumentRate({
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
    }));
    await this.pettyCash.assertSingleTxCap({
      account,
      amount,
      override: input.overridePettyLimit === true,
      actorId: input.actorId,
    });
    const { overridePettyLimit: _override, ...rest } = input;
    void _override;
    const created = await store.insertPayment({ ...rest, amount, createdBy: input.actorId });
    await this.audit.record({
      action: "treasury.payment_created",
      entityType: "payment",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { amount, currency: input.currencyCode, partnerId: input.partnerId, valueDate: input.valueDate },
    });
    return created;
  }

  async submit(id: string, actorId: string | null) {
    const payment = await this.find(id);
    if (payment.status !== "DRAFT") {
      throw new TreasuryDocumentStateError(`payment ${id} is ${payment.status} — only DRAFT payments can submit`);
    }
    await store.updatePaymentStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const payment = await this.find(id);
    await this.settlement.approveDoc({
      docType: "payment",
      doc: { id, status: payment.status, createdBy: payment.createdBy },
      actorId,
    });
    await store.updatePaymentStatus({ id, status: "APPROVED", actorId });
    await this.audit.record({
      action: "treasury.payment_approved",
      entityType: "payment",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  async post(id: string, actorId: string | null) {
    const payment = await this.find(id);
    const account = requireActiveAccount(await store.findCashAccountById(payment.cashAccountId));
    return this.settlement.postSettlement({ docType: "payment", doc: payment, account, actorId });
  }

  async reverse(input: { id: string; entryDate: string; reason: string; actorId: string | null }) {
    const payment = await this.find(input.id);
    const account = requireActiveAccount(await store.findCashAccountById(payment.cashAccountId));
    if (payment.status !== "POSTED") {
      throw new TreasuryDocumentStateError(
        `only POSTED payments can be reversed (got ${payment.status}) — IMMUTABLE_DOCUMENT`,
      );
    }
    return this.settlement.reverseSettlement({
      docType: "payment",
      doc: payment,
      account,
      entryDate: input.entryDate,
      reason: input.reason,
      actorId: input.actorId,
    });
  }

  async cancel(input: { id: string; reason: string; actorId: string | null }) {
    const payment = await this.find(input.id);
    if (payment.status === "POSTED") {
      throw new TreasuryDocumentStateError(
        "posted payments are immutable — cancel is reversal-only (INV-014)",
      );
    }
    await store.cancelPayment({ id: input.id, actorId: input.actorId, reason: input.reason });
    await this.audit.record({
      action: "treasury.payment_cancelled",
      entityType: "payment",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      before: { status: payment.status },
      after: { status: "CANCELLED", reason: input.reason },
    });
    return this.find(input.id);
  }
}
