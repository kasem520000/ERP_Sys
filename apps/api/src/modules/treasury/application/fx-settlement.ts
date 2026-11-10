import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import * as accountingStore from "../../accounting/infrastructure/accounting.store";
import * as store from "../infrastructure/treasury.store";
import {
  AllocationExceedsDocumentError,
  AllocationExceedsOpenItemError,
  OpenItemCurrencyMismatchError,
  OpenItemNotFoundError,
  OpenItemPartnerMismatchError,
  OpenItemSideInvalidError,
  TreasuryDocumentStateError,
} from "../domain/treasury-errors";
import {
  TREASURY_NUMBER_FORMATS,
  baseCurrency,
  moneyAbs,
  moneyAdd,
  moneyCompare,
  moneyMultiply,
  moneySub,
  resolveDocumentRate,
} from "./document-support";

/**
 * Settlement core (PHASE-008 T3/T5; G-05/G-06/G-10; INV-008/016/019): the
 * shared engine for receipts (money-in) and payments (money-out).
 *
 * Posting shape — receipts post in the TENANT BASE currency with explicit
 * base line amounts (the engine's single-rate conversion cannot express
 * "control at the original stored rate r₀ while cash settles at today's
 * r₁"; base-amount lines with rate 1 express it exactly, and INV-008's
 * determinism is honored per line):
 *
 *   receipt:  DR CASH(amount×r₁) · CR AR_CONTROL(Σ alloc×r₀) ·
 *             CR AR_CONTROL(on-account × r₁) · [CR FX_GAIN | DR FX_LOSS]
 *   payment:  DR AP_CONTROL(Σ alloc×r₀) · DR AP_CONTROL(on-account × r₁) ·
 *             [DR FX_LOSS | CR FX_GAIN] · CR CASH(amount×r₁)
 *
 * The residual is the explicit FX difference (JOURNAL_RULES §4.2) — never
 * dropped or absorbed. Allocations settle PHASE-007 partner subledger open
 * items under a row lock (CC-02): Σ allocations ≤ document amount AND ≤
 * open-item outstanding, or the typed INV-016 rejection with zero residue
 * (the caller's whole transaction rolls back).
 */

export interface SettlementAllocationInput {
  readonly allocations: readonly { openItemId: string; amount: string }[];
}

export interface SettlementPostResult {
  docNo: string;
  journalEntryId: string;
  journalEntryNo: string | null;
  idempotentReplay: boolean;
  allocatedAmount: string;
  fxGainLoss: string;
}

@Injectable()
export class SettlementCore {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * Validate allocations (INV-016, CC-02): every open item is row-locked,
   * recomputed AFTER the lock, and must belong to the document partner on
   * the correct control side in the document currency. Returns the
   * per-allocation original base amounts (alloc × r₀ — INV-008).
   */
  async validateAllocationsUnderLock(input: {
    docType: "receipt" | "payment";
    partnerId: string;
    currencyCode: string;
    amount: string;
    allocations: readonly { openItemId: string; amount: string }[];
  }): Promise<{ allocatedAmount: string; allocatedBase: string }> {
    if (input.allocations.length === 0) return { allocatedAmount: "0.0000", allocatedBase: "0.0000" };
    // (1) Document-level bound first (no locks needed to reject).
    let allocated = "0.0000";
    for (const allocation of input.allocations) {
      allocated = moneyAdd(allocated, allocation.amount);
    }
    if (moneyCompare(allocated, input.amount) > 0) {
      throw new AllocationExceedsDocumentError({ allocated, amount: input.amount });
    }
    // (2) Per-open-item bounds under the CC-02 row lock.
    let allocatedBase = "0.0000";
    for (const allocation of input.allocations) {
      const item = await this.loadOpenItem(allocation.openItemId);
      const settled = await store.lockOpenItemAndSumPostedAllocations(item.id);
      const outstanding = moneySub(item.amount, settled);
      if (moneyCompare(allocation.amount, outstanding) > 0) {
        throw new AllocationExceedsOpenItemError({
          openItemId: item.id,
          allocated: allocation.amount,
          outstanding,
        });
      }
      await this.assertItemMatchesDocument(item, input);
      allocatedBase = moneyAdd(allocatedBase, moneyMultiply(allocation.amount, item.exchangeRate));
    }
    return { allocatedAmount: allocated, allocatedBase };
  }

  private async loadOpenItem(id: string): Promise<store.OpenItemRow> {
    const item = await store.findOpenItemById(id);
    if (item === undefined) throw new OpenItemNotFoundError(id);
    return item;
  }

  private async assertItemMatchesDocument(
    item: store.OpenItemRow,
    input: { docType: "receipt" | "payment"; partnerId: string; currencyCode: string },
  ): Promise<void> {
    if (item.partnerId !== input.partnerId) {
      throw new OpenItemPartnerMismatchError({
        openItemPartnerId: item.partnerId,
        documentPartnerId: input.partnerId,
      });
    }
    if (item.currencyCode !== input.currencyCode) {
      throw new OpenItemCurrencyMismatchError({
        openItemCurrency: item.currencyCode,
        documentCurrency: input.currencyCode,
      });
    }
    const control = await resolveControlAccounts();
    if (input.docType === "receipt") {
      // Receipts settle AR receivables: DEBIT rows on the AR control account.
      if (item.controlAccountId !== control.arControlAccountId || item.direction !== "DEBIT") {
        throw new OpenItemSideInvalidError({ documentType: "receipt", requiredSide: "AR receivable" });
      }
    } else {
      if (item.controlAccountId !== control.apControlAccountId || item.direction !== "CREDIT") {
        throw new OpenItemSideInvalidError({ documentType: "payment", requiredSide: "AP payable" });
      }
    }
  }

  /**
   * Post a receipt or payment through the engine (validation 1–8 + the
   * single write phase), then write the movement + flip the document — all
   * inside the caller's ambient transaction (INV-019 by construction: the
   * movement's base equals the cash line's base).
   */
  async postSettlement(input: {
    docType: "receipt" | "payment";
    doc: store.TreasuryDocRow;
    account: store.CashAccountRow;
    actorId: string | null;
  }): Promise<SettlementPostResult> {
    const { doc, docType } = input;
    if (doc.status !== "DRAFT" && doc.status !== "APPROVED" && doc.status !== "POSTED") {
      throw new TreasuryDocumentStateError(
        `${docType} ${doc.id} is ${doc.status} — only DRAFT (no policy), APPROVED, or POSTED (idempotent replay) documents can post`,
      );
    }
    // Optional BR-034 policy: an active policy forces the approval hop.
    const policy = await accountingStore.findActivePolicy(docType, doc.valueDate);
    if (policy !== undefined && policy.policy.mode === "single-approver" && doc.status === "DRAFT") {
      throw new TreasuryDocumentStateError(
        `${docType} ${doc.id} requires approval first (active ${policy.policy.mode} policy since ${policy.appliesFrom})`,
      );
    }

    const base = await baseCurrency();
    const r1 = await resolveDocumentRate({ currencyCode: doc.currencyCode, exchangeRate: doc.exchangeRate });
    const allocations = await store.listAllocationsForDoc(docType, doc.id);
    const { allocatedAmount, allocatedBase } = await this.validateAllocationsUnderLock({
      docType,
      partnerId: doc.partnerId,
      currencyCode: doc.currencyCode,
      amount: doc.amount,
      allocations,
    });

    // Cash leg (base): the movement's base equals this line's amount — INV-019.
    const cashBase = moneyMultiply(doc.amount, r1);
    const onAccount = moneySub(doc.amount, allocatedAmount);
    const onAccountBase = moneyMultiply(onAccount, r1);
    const controlBase = moneyAdd(allocatedBase, onAccountBase);
    // residual = cash − control: >0 gains on receipts / loses on payments.
    const residual = moneySub(cashBase, controlBase);

    const controlPurpose = docType === "receipt" ? "AR_CONTROL" : "AP_CONTROL";
    const isReceipt = docType === "receipt";
    const cashLine: JournalLineSpec = {
      accountId: input.account.accountId,
      direction: isReceipt ? "DEBIT" : "CREDIT",
      amount: cashBase,
      memo: {
        en: `${isReceipt ? "Receipt" : "Payment"} ${doc.currencyCode} ${doc.amount} @ ${r1}`,
        ar: `${isReceipt ? "سند قبض" : "سند صرف"} ${doc.currencyCode} ${doc.amount} @ ${r1}`,
      },
    };
    const controlLines: JournalLineSpec[] = [];
    if (moneyCompare(allocatedBase, "0.0000") !== 0) {
      controlLines.push({
        purpose: controlPurpose,
        direction: isReceipt ? "CREDIT" : "DEBIT",
        amount: allocatedBase,
        partnerId: doc.partnerId,
        memo: { en: "Settlement of open items (original stored rate, INV-008)", ar: "تسوية بنود مفتوحة (بسعر الصرف الأصلي)" },
      });
    }
    if (moneyCompare(onAccountBase, "0.0000") !== 0) {
      controlLines.push({
        purpose: controlPurpose,
        direction: isReceipt ? "CREDIT" : "DEBIT",
        amount: onAccountBase,
        partnerId: doc.partnerId,
        memo: { en: "On-account (unallocated — BR-027)", ar: "على الحساب (غير مخصص — BR-027)" },
      });
    }
    const residualLines: JournalLineSpec[] = [];
    if (moneyCompare(residual, "0.0000") !== 0) {
      const isGain = isReceipt ? moneyCompare(residual, "0.0000") > 0 : moneyCompare(residual, "0.0000") < 0;
      residualLines.push({
        purpose: isGain ? "FX_GAIN" : "FX_LOSS",
        direction: isGain ? "CREDIT" : "DEBIT",
        amount: moneyAbs(residual),
        memo: { en: "Realized FX difference at settlement", ar: "فرق عملة محقق عند التسوية" },
      });
    }
    // Canonical golden orders: G-05/G-06 put CASH first; G-10 puts the
    // control side first (ACCOUNTING_TESTS §3 line shapes).
    const lines: JournalLineSpec[] = isReceipt
      ? [cashLine, ...controlLines, ...residualLines]
      : [...controlLines, ...residualLines, cashLine];

    const spec: JournalSpec = {
      source: { docType, docId: doc.id, operation: "post" },
      entryDate: doc.valueDate,
      description: {
        en: doc.description ?? `${docType === "receipt" ? "Receipt" : "Payment"} on ${doc.valueDate}`,
        ar: doc.descriptionAr ?? `${docType === "receipt" ? "سند قبض" : "سند صرف"} بتاريخ ${doc.valueDate}`,
      },
      currency: base,
      lines,
    };

    const result = await this.posting.post(spec, { postedBy: input.actorId });

    if (result.idempotentReplay) {
      // INV-013 replay: the stored result is the truth — never re-write.
      const current = docType === "receipt"
        ? await store.findReceiptById(doc.id)
        : await store.findPaymentById(doc.id);
      return {
        docNo: current?.docNo ?? "",
        journalEntryId: result.journalEntryId,
        journalEntryNo: result.entryNo,
        idempotentReplay: true,
        allocatedAmount: current?.allocatedAmount ?? "0.0000",
        fxGainLoss: current?.fxGainLoss ?? "0.0000",
      };
    }

    // Official number (INV-021) — acquired after validation, inside the tx.
    const numberFormat = TREASURY_NUMBER_FORMATS[docType];
    const acquired = await this.numbering.reserve({
      docType: numberFormat.docType,
      branchId: null,
      periodKey: doc.valueDate.slice(0, 4),
      format: numberFormat.format,
      prefix: numberFormat.prefix,
      year: doc.valueDate.slice(0, 4),
    });

    // The movement: same transaction as the journal (INV-019's substrate).
    await store.insertCashMovement({
      cashAccountId: input.account.id,
      direction: docType === "receipt" ? "IN" : "OUT",
      amount: doc.amount,
      currencyCode: doc.currencyCode,
      exchangeRate: r1,
      baseAmount: cashBase,
      sourceType: docType,
      sourceId: doc.id,
      valueDate: doc.valueDate,
      memo: doc.description,
      memoAr: doc.descriptionAr,
    });

    const fxSigned = docType === "receipt" ? residual : moneySub("0.0000", residual);
    if (docType === "receipt") {
      await store.updateReceiptStatus({
        id: doc.id,
        status: "POSTED",
        docNo: acquired.number,
        postedJournalId: result.journalEntryId,
        allocatedAmount,
        fxGainLoss: fxSigned,
        actorId: input.actorId,
      });
    } else {
      await store.updatePaymentStatus({
        id: doc.id,
        status: "POSTED",
        docNo: acquired.number,
        postedJournalId: result.journalEntryId,
        allocatedAmount,
        fxGainLoss: fxSigned,
        actorId: input.actorId,
      });
    }

    await this.audit.record({
      action: `treasury.${docType}_posted`,
      entityType: docType,
      entityId: doc.id,
      actorId: input.actorId ?? undefined,
      after: {
        docNo: acquired.number,
        journalEntryId: result.journalEntryId,
        amount: doc.amount,
        currency: doc.currencyCode,
        rate: r1,
        allocatedAmount,
        fxGainLoss: fxSigned,
        cashAccountId: input.account.id,
      },
    });

    return {
      docNo: acquired.number,
      journalEntryId: result.journalEntryId,
      journalEntryNo: result.entryNo,
      idempotentReplay: false,
      allocatedAmount,
      fxGainLoss: fxSigned,
    };
  }

  /**
   * Reversal (INV-014): the engine's mirror flips every line; treasury adds
   * the compensating movement so INV-019 stays exact. Correction is
   * reversal-only — posted documents never edit (409 IMMUTABLE_DOCUMENT).
   */
  async reverseSettlement(input: {
    docType: "receipt" | "payment";
    doc: store.TreasuryDocRow;
    account: store.CashAccountRow;
    entryDate: string;
    reason: string;
    actorId: string | null;
  }): Promise<{ journalEntryId: string; reversalMovementId: string }> {
    const { doc, docType } = input;
    if (doc.status !== "POSTED" || doc.postedJournalId === null) {
      throw new TreasuryDocumentStateError(
        `only POSTED ${docType} documents can be reversed (got ${doc.status})`,
      );
    }
    const rate = await resolveDocumentRate({
      currencyCode: doc.currencyCode,
      exchangeRate: doc.exchangeRate,
    });
    const cashBase = moneyMultiply(doc.amount, rate);
    const result = await this.posting.reverse(
      { originalEntryId: doc.postedJournalId, entryDate: input.entryDate, reason: input.reason },
      { reversedBy: input.actorId },
    );
    const movement = await store.insertCashMovement({
      cashAccountId: input.account.id,
      direction: docType === "receipt" ? "OUT" : "IN",
      amount: doc.amount,
      currencyCode: doc.currencyCode,
      exchangeRate: rate,
      baseAmount: cashBase,
      sourceType: docType,
      sourceId: doc.id,
      valueDate: input.entryDate,
      memo: `reversal: ${input.reason}`,
    });
    await this.audit.record({
      action: `treasury.${docType}_reversed`,
      entityType: docType,
      entityId: doc.id,
      actorId: input.actorId ?? undefined,
      before: { status: "POSTED", docNo: doc.docNo },
      after: { reversalJournalEntryId: result.journalEntryId, reason: input.reason },
    });
    return { journalEntryId: result.journalEntryId, reversalMovementId: movement.id };
  }

  /** The SoD-guarded approve hop for policy-enabled tenants (BR-034 default). */
  async approveDoc(input: {
    docType: "receipt" | "payment" | "cash_transfer";
    doc: { id: string; status: string; createdBy: string | null };
    actorId: string | null;
  }): Promise<void> {
    if (input.doc.status !== "PENDING_APPROVAL") {
      throw new TreasuryDocumentStateError(
        `${input.docType} ${input.doc.id} is ${input.doc.status} — only PENDING_APPROVAL documents can be approved`,
      );
    }
    if (input.doc.createdBy !== null && input.doc.createdBy === input.actorId) {
      throw new SelfApprovalBlockedError();
    }
  }
}

async function resolveControlAccounts(): Promise<{ arControlAccountId: string; apControlAccountId: string }> {
  const [arRow, apRow] = await Promise.all([
    accountingStore.findActivePurpose("AR_CONTROL"),
    accountingStore.findActivePurpose("AP_CONTROL"),
  ]);
  return {
    arControlAccountId: arRow?.accountId ?? "00000000-0000-0000-0000-000000000000",
    apControlAccountId: apRow?.accountId ?? "00000000-0000-0000-0000-000000000000",
  };
}
