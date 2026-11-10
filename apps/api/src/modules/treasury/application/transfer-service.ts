import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import type { JournalSpec, JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import * as accountingStore from "../../accounting/infrastructure/accounting.store";
import * as store from "../infrastructure/treasury.store";
import {
  CashAccountCurrencyMismatchError,
  TreasuryDocumentStateError,
  TransferNotFoundError,
} from "../domain/treasury-errors";
import {
  TREASURY_NUMBER_FORMATS,
  baseCurrency,
  moneyCompare,
  moneyMultiply,
  moneySub,
  requireActiveAccountInCurrency,
  requirePositiveAmount,
  resolveDocumentRate,
} from "./document-support";
import { PettyCashGuard } from "./petty-cash-service";

/**
 * Transfer service (PHASE-008 T7; G-12): account↔account transfers with
 * bank charges — DRAFT → POSTED (approval states available for BR-034
 * policies on doc_type 'cash_transfer'). Posting shape (§2.5):
 *
 *   DR CASH(dest) (A−F) · [DR BANK_CHARGES F] · CR CASH(src) A
 *
 * Two cash movements (OUT A from source, IN (A−F) to destination); INV-019
 * holds on both sides by construction (movement bases equal the lines').
 * The reimbursement cycle of a petty fund is a transfer INTO it (BR-020
 * balance cap enforced here).
 */
@Injectable()
export class TransferService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
    private readonly pettyCash: PettyCashGuard,
  ) {}

  async list(filter: { status?: string; fromDate?: string; toDate?: string; limit: number }) {
    return store.listTransfers(filter);
  }

  async find(id: string) {
    const transfer = await store.findTransferById(id);
    if (transfer === undefined) throw new TransferNotFoundError(id);
    return transfer;
  }

  async create(input: {
    fromAccountId: string;
    toAccountId: string;
    currencyCode: string;
    amount: string;
    feeAmount: string;
    exchangeRate: string | null;
    valueDate: string;
    reference: string | null;
    description: string | null;
    descriptionAr: string | null;
    actorId: string | null;
    overridePettyLimit?: boolean;
  }) {
    const amount = requirePositiveAmount(input.amount, "transfer amount");
    const fee = input.feeAmount === "" || input.feeAmount === null ? "0.0000" : input.feeAmount;
    if (moneyCompare(fee, "0.0000") < 0) {
      throw new TreasuryDocumentStateError("fee cannot be negative");
    }
    if (moneyCompare(fee, amount) >= 0) {
      throw new TreasuryDocumentStateError("fee must be smaller than the transferred amount");
    }
    const from = requireActiveAccountInCurrency(
      await store.findCashAccountById(input.fromAccountId),
      input.currencyCode,
    );
    const to = requireActiveAccountInCurrency(
      await store.findCashAccountById(input.toAccountId),
      input.currencyCode,
    );
    if (from.currencyCode !== to.currencyCode) {
      throw new CashAccountCurrencyMismatchError({
        accountCurrency: from.currencyCode,
        documentCurrency: to.currencyCode,
      });
    }
    // BR-020: a transfer INTO a petty fund is a reimbursement — balance cap.
    await this.pettyCash.assertBalanceCap({
      account: to,
      inflowAmount: moneySub(amount, fee),
      override: input.overridePettyLimit === true,
      actorId: input.actorId,
    });
    void (await resolveDocumentRate({
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
    }));
    const { overridePettyLimit: _override, ...rest } = input;
    void _override;
    const created = await store.insertTransfer({ ...rest, amount, feeAmount: fee, createdBy: input.actorId });
    await this.audit.record({
      action: "treasury.cash_transfer_created",
      entityType: "cash_transfer",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { amount, fee, from: from.name, to: to.name, valueDate: input.valueDate },
    });
    return created;
  }

  async submit(id: string, actorId: string | null) {
    const transfer = await this.find(id);
    if (transfer.status !== "DRAFT") {
      throw new TreasuryDocumentStateError(`transfer ${id} is ${transfer.status} — only DRAFT transfers can submit`);
    }
    await store.updateTransferStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const transfer = await this.find(id);
    if (transfer.status !== "PENDING_APPROVAL") {
      throw new TreasuryDocumentStateError(
        `transfer ${id} is ${transfer.status} — only PENDING_APPROVAL transfers can be approved`,
      );
    }
    await store.updateTransferStatus({ id, status: "APPROVED", actorId });
    await this.audit.record({
      action: "treasury.cash_transfer_approved",
      entityType: "cash_transfer",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  async post(id: string, actorId: string | null) {
    const transfer = await this.find(id);
    if (transfer.status !== "DRAFT" && transfer.status !== "APPROVED") {
      throw new TreasuryDocumentStateError(
        `transfer ${id} is ${transfer.status} — only DRAFT (no policy) or APPROVED transfers can post`,
      );
    }
    const policy = await accountingStore.findActivePolicy("cash_transfer", transfer.valueDate);
    if (policy !== undefined && policy.policy.mode === "single-approver" && transfer.status === "DRAFT") {
      throw new TreasuryDocumentStateError(
        `transfer ${id} requires approval first (active policy since ${policy.appliesFrom})`,
      );
    }
    const from = requireActiveAccountInCurrency(
      await store.findCashAccountById(transfer.fromAccountId),
      transfer.currencyCode,
    );
    const to = requireActiveAccountInCurrency(
      await store.findCashAccountById(transfer.toAccountId),
      transfer.currencyCode,
    );
    const r1 = await resolveDocumentRate({
      currencyCode: transfer.currencyCode,
      exchangeRate: transfer.exchangeRate,
    });
    const received = moneySub(transfer.amount, transfer.feeAmount);

    const lines: JournalLineSpec[] = [
      {
        accountId: to.accountId,
        direction: "DEBIT",
        amount: received,
        memo: { en: `Transfer in from ${from.name}`, ar: `تحويل وارد من ${from.name}` },
      },
    ];
    if (moneyCompare(transfer.feeAmount, "0.0000") !== 0) {
      lines.push({
        purpose: "BANK_CHARGES",
        direction: "DEBIT",
        amount: transfer.feeAmount,
        memo: { en: "Bank charges on transfer", ar: "مصاريف بنكية على التحويل" },
      });
    }
    lines.push({
      accountId: from.accountId,
      direction: "CREDIT",
      amount: transfer.amount,
      memo: { en: `Transfer out to ${to.name}`, ar: `تحويل صادر إلى ${to.name}` },
    });

    const spec: JournalSpec = {
      source: { docType: "cash_transfer", docId: transfer.id, operation: "post" },
      entryDate: transfer.valueDate,
      description: {
        en: transfer.description ?? `Cash transfer ${from.name} → ${to.name}`,
        ar: transfer.descriptionAr ?? `تحويل نقدي ${from.name} ← ${to.name}`,
      },
      currency: transfer.currencyCode,
      exchangeRate: transfer.currencyCode === (await baseCurrency()) ? undefined : r1,
      lines,
    };

    const result = await this.posting.post(spec, { postedBy: actorId });
    if (result.idempotentReplay) {
      const current = await store.findTransferById(transfer.id);
      return {
        transferNo: current?.transferNo ?? "",
        journalEntryId: result.journalEntryId,
        idempotentReplay: true,
      };
    }

    const acquired = await this.numbering.reserve({
      docType: TREASURY_NUMBER_FORMATS.cash_transfer.docType,
      branchId: null,
      periodKey: transfer.valueDate.slice(0, 4),
      format: TREASURY_NUMBER_FORMATS.cash_transfer.format,
      prefix: TREASURY_NUMBER_FORMATS.cash_transfer.prefix,
      year: transfer.valueDate.slice(0, 4),
    });

    // Two movements (INV-019 both sides; bases equal the journal lines').
    await store.insertCashMovement({
      cashAccountId: from.id,
      direction: "OUT",
      amount: transfer.amount,
      currencyCode: transfer.currencyCode,
      exchangeRate: r1,
      baseAmount: moneyMultiply(transfer.amount, r1),
      sourceType: "cash_transfer",
      sourceId: transfer.id,
      valueDate: transfer.valueDate,
      memo: `transfer to ${to.name}`,
    });
    await store.insertCashMovement({
      cashAccountId: to.id,
      direction: "IN",
      amount: received,
      currencyCode: transfer.currencyCode,
      exchangeRate: r1,
      baseAmount: moneyMultiply(received, r1),
      sourceType: "cash_transfer",
      sourceId: transfer.id,
      valueDate: transfer.valueDate,
      memo: `transfer from ${from.name}`,
    });

    await store.updateTransferStatus({
      id: transfer.id,
      status: "POSTED",
      transferNo: acquired.number,
      postedJournalId: result.journalEntryId,
      actorId,
    });
    await this.audit.record({
      action: "treasury.cash_transfer_posted",
      entityType: "cash_transfer",
      entityId: transfer.id,
      actorId: actorId ?? undefined,
      after: {
        transferNo: acquired.number,
        journalEntryId: result.journalEntryId,
        amount: transfer.amount,
        fee: transfer.feeAmount,
        from: from.id,
        to: to.id,
      },
    });
    return { transferNo: acquired.number, journalEntryId: result.journalEntryId, idempotentReplay: false };
  }

  async cancel(input: { id: string; reason: string; actorId: string | null }) {
    const transfer = await this.find(input.id);
    if (transfer.status === "POSTED") {
      throw new TreasuryDocumentStateError("posted transfers are immutable (INV-014: reversal-only)");
    }
    await store.cancelTransfer({ id: input.id, actorId: input.actorId, reason: input.reason });
    await this.audit.record({
      action: "treasury.cash_transfer_cancelled",
      entityType: "cash_transfer",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      before: { status: transfer.status },
      after: { status: "CANCELLED", reason: input.reason },
    });
    return this.find(input.id);
  }

  /** Reimbursement cycle (§2.4): a transfer into the petty fund, capped. */
  async reimburse(input: {
    fromAccountId: string;
    pettyAccountId: string;
    amount: string;
    valueDate: string;
    actorId: string | null;
    overridePettyLimit?: boolean;
  }) {
    return this.create({
      fromAccountId: input.fromAccountId,
      toAccountId: input.pettyAccountId,
      currencyCode: (await store.findCashAccountById(input.pettyAccountId))!.currencyCode,
      amount: input.amount,
      feeAmount: "0.0000",
      exchangeRate: null,
      valueDate: input.valueDate,
      reference: "petty-cash reimbursement",
      description: "Petty cash reimbursement",
      descriptionAr: "تغذية الصندوق النقدي الصغير",
      actorId: input.actorId,
      overridePettyLimit: input.overridePettyLimit,
    });
  }
}
