import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import { findCashAccountById, insertCashMovement } from "../../treasury/infrastructure/treasury.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import * as store from "../infrastructure/purchasing.store";
import * as collab from "../infrastructure/collaboration.store";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import {
  discountAmount,
  isWithinDiscountWindow,
  netAfterDiscount,
} from "./sourcing-math";
import {
  AdvanceStateError,
  DiscountPaymentInvalidError,
  DiscountTermsNotApprovedError,
  DiscountTermsNotFoundError,
  DiscountWindowExpiredError,
  EarlyDiscountIncomeAccountUnmappedError,
  SupplierAdvanceAccountUnmappedError,
  SupplierAdvanceNotFoundError,
} from "../domain/sourcing-errors";

/**
 * Supplier advances + early-payment discounts (PHASE-038 T-08; P-12/
 * P-13): the two NEW journal goldens, numbering continuing from G-32 —
 *
 *   G-33 supplier advance (JOURNAL_RULES §7): the DISBURSEMENT leg
 *     DR ADVANCES_TO_SUPPLIERS (the tenant-mapped control —
 *     purchasing.supplier_advance_control_account; fail-closed when
 *     unmapped, the payroll loan-account precedent) · CR CASH/BANK, with
 *     the treasury money movement recorded through the treasury store API
 *     (the payroll G-30 payout pattern; INV-019 exact); the APPLICATION
 *     leg nets the supplier's subledger (DR AP_CONTROL partner · CR the
 *     same control) under source operation "apply".
 *   G-34 early-payment discount capture: after a treasury payment lands
 *     INSIDE the terms' window on an approved (SoD) terms row —
 *     DR AP_CONTROL (the discount share, partner-stamped) · CR the
 *     tenant-mapped discount-income account
 *     (purchasing.early_discount_income_account; fail-closed when
 *     unmapped).
 *
 * SoD: an advance approves only by someone other than its creator
 * (SelfApprovalBlockedError); discount terms approve the same way, and a
 * capture posts only against APPROVED terms. INV-013 idempotency keys
 * every journal (source {docType, docId, operation}); the engine's
 * replay path converges on the stored entry.
 */

export const SUPPLIER_ADVANCE_NUMBER_FORMAT = {
  prefix: "ADV",
  format: "ADV-{YYYY}-{SEQ:6}",
  docType: "supplier_advance",
} as const;

const AMOUNT_RE = /^\d+\.\d{4}$/;

@Injectable()
export class SupplierAdvancesService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  // -- G-33: advances ----------------------------------------------------------------

  async list(filter: { supplierId?: string; status?: string; limit: number }) {
    return collab.listSupplierAdvances(filter);
  }

  async find(id: string) {
    const advance = await collab.findSupplierAdvanceById(id);
    if (advance === undefined) throw new SupplierAdvanceNotFoundError(id);
    return advance;
  }

  async create(input: {
    supplierId: string;
    currencyCode: string;
    amount: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    if (!AMOUNT_RE.test(input.amount) || new Decimal(input.amount).lte(0)) {
      throw new AdvanceStateError(
        `advance amount must be a positive canonical decimal (4dp): ${input.amount}`,
      );
    }
    const { requireSupplier } = await import("./orders");
    await requireSupplier(input.supplierId);
    const id = await collab.insertSupplierAdvance({ ...input, actorId: input.actorId });
    await this.audit.record({
      action: "purchasing.supplier_advance_created",
      entityType: "supplier_advance",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { supplierId: input.supplierId, amount: input.amount },
    });
    return this.find(id);
  }

  /** Approve: the SoD gate (creator ≠ approver) — DRAFT → APPROVED. */
  async approve(id: string, actorId: string | null) {
    const advance = await this.find(id);
    if (advance.status !== "DRAFT") {
      throw new AdvanceStateError(
        `advance ${id} is ${advance.status} — only DRAFT advances approve`,
      );
    }
    if (advance.createdBy !== null && advance.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    await collab.updateSupplierAdvance(id, {
      status: "APPROVED",
      approvedBy: actorId,
      approvedAt: new Date().toISOString(),
    });
    await this.audit.record({
      action: "purchasing.supplier_advance_approved",
      entityType: "supplier_advance",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  /**
   * Disburse: APPROVED → DISBURSED, posting G-33's disbursement leg
   * through the engine + the treasury money movement (fail-closed on the
   * unmapped control account — zero partial writes: the whole flow runs
   * in the ambient UoW, so any throw rolls everything back).
   */
  async disburse(input: { id: string; cashAccountId: string; entryDate?: string; actorId: string | null }) {
    const advance = await this.find(input.id);
    if (advance.status !== "APPROVED") {
      throw new AdvanceStateError(
        `advance ${input.id} is ${advance.status} — only APPROVED advances disburse`,
      );
    }
    const controlAccount = await readEffectiveSetting<string | null>(
      "purchasing.supplier_advance_control_account",
    );
    if (controlAccount === null || controlAccount === undefined) {
      throw new SupplierAdvanceAccountUnmappedError();
    }
    const cash = await findCashAccountById(input.cashAccountId);
    if (cash === undefined) {
      throw new AdvanceStateError(`cash account ${input.cashAccountId} does not exist in this tenant`);
    }
    const base = await ownTenantBaseCurrency();
    const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);

    const journalLines: JournalLineSpec[] = [
      {
        accountId: controlAccount,
        direction: "DEBIT",
        amount: advance.amount,
        memo: {
          en: `Supplier advance disbursement${advance.advanceNo === null ? "" : ` ${advance.advanceNo}`}`,
          ar: `صرف دفعة مقدمة للمورد`,
        },
      },
      {
        accountId: cash.accountId,
        direction: "CREDIT",
        amount: advance.amount,
        memo: { en: "Supplier advance cash leg (G-33)", ar: "الطرف النقدي للدفعة المقدمة (G-33)" },
      },
    ];

    const spec: JournalSpec = {
      source: { docType: "supplier_advance", docId: advance.id, operation: "post" },
      entryDate,
      description: {
        en: "Supplier advance disbursement (G-33)",
        ar: "صرف دفعة مقدمة للمورد (G-33)",
      },
      // The G-33 journal is BASE-denominated at rate 1 (the G-30 payout
      // discipline): advances disburse from the tenant's cash in base.
      currency: base,
      lines: journalLines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    // The treasury money movement (INV-019 exact — base == the cash line).
    await insertCashMovement({
      cashAccountId: cash.id,
      direction: "OUT",
      amount: advance.amount,
      currencyCode: base,
      exchangeRate: "1",
      baseAmount: advance.amount,
      sourceType: "supplier_advance",
      sourceId: advance.id,
      valueDate: entryDate,
      memo: "Supplier advance (G-33)",
      memoAr: "دفعة مقدمة للمورد (G-33)",
    });

    // The official number stamps at disbursement (the payroll PR- pattern).
    const year = entryDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: SUPPLIER_ADVANCE_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: SUPPLIER_ADVANCE_NUMBER_FORMAT.format,
      prefix: SUPPLIER_ADVANCE_NUMBER_FORMAT.prefix,
      year,
    });
    await collab.updateSupplierAdvance(advance.id, {
      status: "DISBURSED",
      advanceNo: acquired.number,
      cashAccountId: cash.id,
      entryDate,
      postedJournalId: result.journalEntryId,
      entryNo: result.entryNo,
      disbursedAt: new Date().toISOString(),
      disbursedBy: input.actorId,
    });
    await this.numbering.bind(SUPPLIER_ADVANCE_NUMBER_FORMAT.docType, acquired.number, advance.id);
    await this.audit.record({
      action: "purchasing.supplier_advance_disbursed",
      entityType: "supplier_advance",
      entityId: advance.id,
      actorId: input.actorId ?? undefined,
      after: {
        advanceNo: acquired.number,
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        amount: advance.amount,
      },
    });
    return this.find(advance.id);
  }

  /**
   * Apply: DISBURSED → (partially) applied — the application leg nets the
   * supplier's AP subledger (DR AP_CONTROL partner · CR the advance
   * control). CLOSED flips automatically when the advance is fully
   * applied.
   */
  async apply(input: { id: string; amount: string; entryDate?: string; actorId: string | null }) {
    const advance = await this.find(input.id);
    if (advance.status !== "DISBURSED") {
      throw new AdvanceStateError(
        `advance ${input.id} is ${advance.status} — only DISBURSED advances apply`,
      );
    }
    if (!AMOUNT_RE.test(input.amount) || new Decimal(input.amount).lte(0)) {
      throw new AdvanceStateError(
        `applied amount must be a positive canonical decimal (4dp): ${input.amount}`,
      );
    }
    const remaining = new Decimal(advance.amount).minus(new Decimal(advance.appliedAmount));
    if (new Decimal(input.amount).comparedTo(remaining) > 0) {
      throw new AdvanceStateError(
        `applied amount ${input.amount} exceeds the advance's remaining ${remaining.toFixed(4)}`,
      );
    }
    const controlAccount = await readEffectiveSetting<string | null>(
      "purchasing.supplier_advance_control_account",
    );
    if (controlAccount === null || controlAccount === undefined) {
      throw new SupplierAdvanceAccountUnmappedError();
    }
    const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);
    const spec: JournalSpec = {
      source: { docType: "supplier_advance", docId: advance.id, operation: "apply" },
      entryDate,
      description: {
        en: "Supplier advance application (G-33 apply)",
        ar: "تسوية دفعة مقدمة للمورد (G-33)",
      },
      currency: advance.currencyCode,
      lines: [
        {
          purpose: "AP_CONTROL",
          direction: "DEBIT",
          amount: input.amount,
          partnerId: advance.supplierId,
          memo: { en: "Supplier advance applied (G-33)", ar: "تسوية دفعة مقدمة (G-33)" },
        },
        {
          accountId: controlAccount,
          direction: "CREDIT",
          amount: input.amount,
          memo: { en: "Supplier advance control relief", ar: "تخفيف حساب الدفعات المقدمة" },
        },
      ],
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });
    const appliedAmount = new Decimal(advance.appliedAmount)
      .plus(new Decimal(input.amount))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    const fullyApplied = new Decimal(appliedAmount).comparedTo(new Decimal(advance.amount)) === 0;
    await collab.updateSupplierAdvance(advance.id, {
      appliedAmount,
      status: fullyApplied ? "CLOSED" : "DISBURSED",
    });
    await this.audit.record({
      action: "purchasing.supplier_advance_applied",
      entityType: "supplier_advance",
      entityId: advance.id,
      actorId: input.actorId ?? undefined,
      after: { appliedAmount, journalEntryId: result.journalEntryId, fullyApplied },
    });
    return this.find(advance.id);
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const advance = await this.find(id);
    if (advance.status === "DISBURSED" || advance.status === "CLOSED") {
      throw new AdvanceStateError(
        `advance ${id} is ${advance.status} — disbursed advances are ledger history (reversal lives in the engine)`,
      );
    }
    await collab.updateSupplierAdvance(id, { status: "CANCELLED", cancelReason: reason });
    await this.audit.record({
      action: "purchasing.supplier_advance_cancelled",
      entityType: "supplier_advance",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  // -- P-13/G-34: early-payment discount terms + capture ------------------------------

  async listTerms(limit: number) {
    return collab.listDiscountTerms(limit);
  }

  /** Upsert terms (re-upsert re-opens the SoD gate — approval resets). */
  async upsertTerms(input: {
    supplierId: string;
    discountPct: string;
    discountDays: number;
    minInvoiceAmount: string;
    note: string | null;
    actorId: string | null;
  }) {
    const pct = new Decimal(input.discountPct);
    if (pct.lte(0) || pct.gt(100)) {
      throw new DiscountPaymentInvalidError(`discount pct must be in (0, 100]: ${input.discountPct}`);
    }
    if (input.discountDays <= 0) {
      throw new DiscountPaymentInvalidError(`discount days must be positive: ${input.discountDays}`);
    }
    const { requireSupplier } = await import("./orders");
    await requireSupplier(input.supplierId);
    const id = await collab.upsertDiscountTerms({
      supplierId: input.supplierId,
      discountPct: input.discountPct,
      discountDays: input.discountDays,
      minInvoiceAmount: input.minInvoiceAmount,
      status: "ACTIVE",
      note: input.note,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "purchasing.discount_terms_upserted",
      entityType: "early_payment_discount_terms",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { supplierId: input.supplierId, discountPct: input.discountPct, discountDays: input.discountDays },
    });
    const terms = await collab.findDiscountTermsById(id);
    if (terms === undefined) throw new DiscountTermsNotFoundError(input.supplierId);
    return terms;
  }

  /** Approve terms (SoD: creator ≠ approver) — unlocks G-34 capture. */
  async approveTerms(id: string, actorId: string | null) {
    const terms = await collab.findDiscountTermsById(id);
    if (terms === undefined) throw new DiscountTermsNotFoundError("(terms)");
    if (terms.createdBy !== null && terms.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    await collab.approveDiscountTerms(id, actorId);
    await this.audit.record({
      action: "purchasing.discount_terms_approved",
      entityType: "early_payment_discount_terms",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    const updated = await collab.findDiscountTermsById(id);
    if (updated === undefined) throw new DiscountTermsNotFoundError("(terms)");
    return updated;
  }

  /**
   * Capture (G-34): the discount on an invoice whose treasury payment
   * landed inside the terms' window. Conditions (all fail-closed typed):
   * the invoice is POSTED; APPROVED terms exist for the supplier; the
   * payment exists, is POSTED, allocated onto this invoice's open item,
   * within the window, and covers the net-after-discount amount; the
   * discount posts DR AP_CONTROL (partner) · CR the mapped income
   * account. INV-013: one capture per invoice (source key (invoiceId,
   * "capture")).
   */
  async captureDiscount(input: {
    invoiceId: string;
    paymentId: string;
    entryDate?: string;
    actorId: string | null;
  }) {
    const invoice = await store.findSupplierInvoiceById(input.invoiceId);
    if (invoice === undefined) {
      throw new DiscountPaymentInvalidError(
        `supplier invoice ${input.invoiceId} does not exist in this tenant`,
      );
    }
    if (invoice.status !== "POSTED" || invoice.postedJournalId === null) {
      throw new DiscountPaymentInvalidError(
        `supplier invoice ${input.invoiceId} is ${invoice.status} — discounts capture on POSTED invoices only`,
      );
    }
    const terms = await collab.findDiscountTermsBySupplier(invoice.supplierId);
    if (terms === undefined) throw new DiscountTermsNotFoundError(invoice.supplierId);
    if (terms.status !== "ACTIVE" || terms.approvedBy === null || terms.approvedAt === null) {
      throw new DiscountTermsNotApprovedError(invoice.supplierId);
    }
    if (new Decimal(invoice.totalGross).lt(new Decimal(terms.minInvoiceAmount))) {
      throw new DiscountPaymentInvalidError(
        `invoice gross ${invoice.totalGross} is below the terms' minimum ${terms.minInvoiceAmount}`,
      );
    }
    const probe = await collab.readDiscountCaptureProbe({
      invoiceId: input.invoiceId,
      paymentId: input.paymentId,
    });
    if (probe.paymentStatus === null) {
      throw new DiscountPaymentInvalidError(
        `treasury payment ${input.paymentId} does not exist in this tenant`,
      );
    }
    if (probe.paymentStatus !== "POSTED") {
      throw new DiscountPaymentInvalidError(
        `treasury payment ${input.paymentId} is ${probe.paymentStatus} — discounts capture on POSTED payments only`,
      );
    }
    if (probe.invoicePostedJournalId === null) {
      throw new DiscountPaymentInvalidError(
        `supplier invoice ${input.invoiceId} carries no posted journal — nothing to net`,
      );
    }
    if (probe.allocatedAmount === null) {
      throw new DiscountPaymentInvalidError(
        `treasury payment ${input.paymentId} holds no allocation onto invoice ${input.invoiceId}'s open item`,
      );
    }
    if (probe.paymentDate === null || !isWithinDiscountWindow({
      invoiceDate: invoice.invoiceDate,
      discountDays: terms.discountDays,
      paymentDate: probe.paymentDate,
    })) {
      throw new DiscountWindowExpiredError({
        invoiceId: input.invoiceId,
        deadline: `${invoice.invoiceDate}+${terms.discountDays}d`,
      });
    }
    const discount = discountAmount(invoice.totalGross, terms.discountPct);
    const netExpected = netAfterDiscount(invoice.totalGross, discount);
    if (new Decimal(probe.allocatedAmount).comparedTo(new Decimal(netExpected)) < 0) {
      throw new DiscountPaymentInvalidError(
        `the payment's allocated ${probe.allocatedAmount} is below the net-after-discount ${netExpected} — pay net early, then capture (the honesty floor)`,
      );
    }
    const incomeAccount = await readEffectiveSetting<string | null>(
      "purchasing.early_discount_income_account",
    );
    if (incomeAccount === null || incomeAccount === undefined) {
      throw new EarlyDiscountIncomeAccountUnmappedError();
    }

    const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);
    const spec: JournalSpec = {
      source: { docType: "early_payment_discount", docId: input.invoiceId, operation: "capture" },
      entryDate,
      description: {
        en: `Early-payment discount capture — invoice ${invoice.invoiceNo ?? input.invoiceId} (G-34)`,
        ar: `احتساب خصم الدفع المبكر — فاتورة ${invoice.invoiceNo ?? input.invoiceId} (G-34)`,
      },
      reference: invoice.invoiceNo ?? undefined,
      currency: invoice.currencyCode,
      exchangeRate:
        invoice.exchangeRate !== null && invoice.currencyCode !== (await ownTenantBaseCurrency())
          ? invoice.exchangeRate
          : undefined,
      lines: [
        {
          purpose: "AP_CONTROL",
          direction: "DEBIT",
          amount: discount,
          partnerId: invoice.supplierId,
          memo: {
            en: `Early-payment discount (G-34) — invoice ${invoice.invoiceNo ?? input.invoiceId}`,
            ar: `خصم الدفع المبكر (G-34) — فاتورة ${invoice.invoiceNo ?? input.invoiceId}`,
          },
        },
        {
          accountId: incomeAccount,
          direction: "CREDIT",
          amount: discount,
          memo: { en: "Early-payment discount income (G-34)", ar: "إيراد خصم الدفع المبكر (G-34)" },
        },
      ],
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });
    await this.audit.record({
      action: "purchasing.early_discount_captured",
      entityType: "supplier_invoice",
      entityId: input.invoiceId,
      actorId: input.actorId ?? undefined,
      after: {
        paymentId: input.paymentId,
        discount,
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        termsId: terms.id,
      },
    });
    return {
      invoiceId: input.invoiceId,
      paymentId: input.paymentId,
      discount,
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      idempotentReplay: result.idempotentReplay,
    };
  }
}
