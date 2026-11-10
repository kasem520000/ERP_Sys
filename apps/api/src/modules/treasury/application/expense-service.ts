import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import type { JournalSpec, JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import { TaxResolverService } from "../../tax/application/tax-resolver-service";
import { expenseTaxLeg, recordDocumentTaxSummary } from "../../tax/application/posting-adapter";
import type { ResolvedLine } from "../../tax/domain/resolver";
import * as store from "../infrastructure/treasury.store";
import {
  ExpenseCategoryNotFoundError,
  ExpenseCategoryCodeTakenError,
  ExpenseNotFoundError,
  ExpenseReceiptRequiredError,
  ExpenseApprovalRequiredError,
  TreasuryDocumentStateError,
} from "../domain/treasury-errors";
import {
  TREASURY_NUMBER_FORMATS,
  baseCurrency,
  expenseReceiptThreshold,
  moneyCompare,
  moneyMultiply,
  requireActiveAccountInCurrency,
  requirePositiveAmount,
  resolveDocumentRate,
} from "./document-support";
import { PettyCashGuard } from "./petty-cash-service";

/**
 * Expense service (PHASE-008 T8; BR-023; G-11): bilingual categories
 * mapped to expense accounts with per-category approval policy; claims
 * with receipt attachments (files module) above the tenant threshold;
 * DRAFT → PENDING_APPROVAL → APPROVED → POSTED lifecycle. Payout posting
 * (PHASE-009 wires the reserved tax_code_id — NEXT_ACTION item 2):
 *
 *   DR EXPENSE(category account) N−t · [DR VAT_RECOVERABLE t — G-11 leg]
 *   · CR CASH/BANK/PETTY N
 *
 * The claim amount is the GROSS paid — input VAT extracts from it
 * (INCLUSIVE extraction). REVERSE_CHARGE adds the self-accounted pair
 * (DR VAT_RECOVERABLE t · CR VAT_PAYABLE t) with the payout staying net.
 * NOT_SUBJECT / zero-rated / exempt / out-of-scope: no VAT line (the
 * honest shapes — absence of VAT ≠ absence of obligations, §2.8). The
 * resolved snapshot + summary rows land in the INV-012 substrate inside
 * the same posting transaction.
 */
@Injectable()
export class ExpenseService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
    private readonly pettyCash: PettyCashGuard,
    private readonly taxResolver: TaxResolverService,
  ) {}

  // -- categories -------------------------------------------------------------

  async listCategories(includeInactive: boolean) {
    return store.listExpenseCategories(includeInactive);
  }

  async createCategory(input: {
    code: string;
    name: string;
    nameAr: string;
    accountId: string;
    approvalMode: "none" | "single-approver";
    actorId: string | null;
  }) {
    const existing = (await store.listExpenseCategories(true)).find((row) => row.code === input.code);
    if (existing !== undefined) throw new ExpenseCategoryCodeTakenError(input.code);
    const created = await store.insertExpenseCategory({ ...input, createdBy: input.actorId });
    await this.audit.record({
      action: "treasury.expense_category_created",
      entityType: "expense_category",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, accountCode: created.accountCode, approvalMode: created.approvalMode },
    });
    return created;
  }

  // -- claims -------------------------------------------------------------------

  async list(filter: {
    status?: string;
    categoryId?: string;
    fromDate?: string;
    toDate?: string;
    limit: number;
  }) {
    return store.listExpenses(filter);
  }

  async find(id: string) {
    const expense = await store.findExpenseById(id);
    if (expense === undefined) throw new ExpenseNotFoundError(id);
    return expense;
  }

  async create(input: {
    categoryId: string;
    cashAccountId: string;
    payeeName: string;
    currencyCode: string;
    amount: string;
    exchangeRate: string | null;
    taxCodeId: string | null;
    receiptFileId: string | null;
    valueDate: string;
    description: string | null;
    descriptionAr: string | null;
    actorId: string | null;
    overridePettyLimit?: boolean;
  }) {
    const amount = requirePositiveAmount(input.amount, "expense amount");
    const category = await store.findExpenseCategoryById(input.categoryId);
    if (category === undefined || !category.isActive) {
      throw new ExpenseCategoryNotFoundError(input.categoryId);
    }
    const account = requireActiveAccountInCurrency(
      await store.findCashAccountById(input.cashAccountId),
      input.currencyCode,
    );
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
    const created = await store.insertExpense({ ...rest, amount, createdBy: input.actorId });
    await this.audit.record({
      action: "treasury.expense_created",
      entityType: "expense",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { amount, category: category.code, payee: input.payeeName, valueDate: input.valueDate },
    });
    return created;
  }

  /**
   * BR-023 submit: the receipt attachment is mandatory at or above the
   * tenant threshold (default 0 = always). Categories with approval_mode
   * 'none' jump straight to APPROVED; single-approver waits for SoD-
   * guarded approval.
   */
  async submit(id: string, actorId: string | null) {
    const expense = await this.find(id);
    if (expense.status !== "DRAFT") {
      throw new TreasuryDocumentStateError(`expense ${id} is ${expense.status} — only DRAFT claims can submit`);
    }
    const threshold = await expenseReceiptThreshold();
    if (moneyCompare(expense.amount, threshold) >= 0 && expense.receiptFileId === null) {
      throw new ExpenseReceiptRequiredError(threshold);
    }
    const category = await store.findExpenseCategoryById(expense.categoryId);
    if (category === undefined) throw new ExpenseCategoryNotFoundError(expense.categoryId);
    const next = category.approvalMode === "none" ? "APPROVED" : "PENDING_APPROVAL";
    await store.updateExpenseStatus({ id, status: next, actorId });
    await this.audit.record({
      action: "treasury.expense_submitted",
      entityType: "expense",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { status: next, receiptAttached: expense.receiptFileId !== null, threshold },
    });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const expense = await this.find(id);
    if (expense.status !== "PENDING_APPROVAL") {
      throw new TreasuryDocumentStateError(
        `expense ${id} is ${expense.status} — only PENDING_APPROVAL claims can be approved`,
      );
    }
    if (expense.createdBy !== null && expense.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    await store.updateExpenseStatus({ id, status: "APPROVED", actorId });
    await this.audit.record({
      action: "treasury.expense_approved",
      entityType: "expense",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  /** G-11 payout posting (approval always required — BR-023). */
  async post(id: string, actorId: string | null) {
    const expense = await this.find(id);
    if (expense.status !== "APPROVED") {
      throw new ExpenseApprovalRequiredError();
    }
    const category = await store.findExpenseCategoryById(expense.categoryId);
    if (category === undefined) throw new ExpenseCategoryNotFoundError(expense.categoryId);
    const account = requireActiveAccountInCurrency(
      await store.findCashAccountById(expense.cashAccountId),
      expense.currencyCode,
    );
    const r1 = await resolveDocumentRate({
      currencyCode: expense.currencyCode,
      exchangeRate: expense.exchangeRate,
    });
    const base = await baseCurrency();
    const cashBase = moneyMultiply(expense.amount, r1);

    // PHASE-009 G-11 tax leg: resolve the claim's tax code (INCLUSIVE — the
    // payout is the gross) and compose the VAT purpose lines + summary rows.
    const resolved: ResolvedLine | null = expense.taxCodeId !== null
      ? await this.taxResolver.resolveOne({
          documentDate: expense.valueDate,
          pricingModeOverride: "INCLUSIVE",
          line: {
            amount: expense.amount,
            taxCodeId: expense.taxCodeId,
            currencyCode: expense.currencyCode,
          },
        })
      : null;
    const leg = resolved !== null ? expenseTaxLeg(resolved) : null;
    const netExpenseAmount = leg?.netExpenseAmount ?? expense.amount;

    // G-11: DR EXPENSE (gross − tax) · [VAT legs] · CR CASH gross. Posts in
    // the DOCUMENT currency via the engine's native FX path (single-rate
    // document — no r₀/r₁ split like settlements).
    const lines: JournalLineSpec[] = [
      {
        accountId: category.accountId,
        direction: "DEBIT",
        amount: netExpenseAmount,
        memo: { en: `Expense ${category.code} — ${expense.payeeName}`, ar: `مصروف ${category.code} — ${expense.payeeName}` },
      },
      ...(leg?.vatLines ?? []),
      {
        accountId: account.accountId,
        direction: "CREDIT",
        amount: expense.amount,
        memo: { en: `Payout from ${account.name}`, ar: `دفع من ${account.name}` },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "expense", docId: expense.id, operation: "post" },
      entryDate: expense.valueDate,
      description: {
        en: expense.description ?? `Expense ${category.code} for ${expense.payeeName}`,
        ar: expense.descriptionAr ?? `مصروف ${category.code} — ${expense.payeeName}`,
      },
      currency: expense.currencyCode,
      exchangeRate: expense.currencyCode === base ? undefined : r1,
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });
    if (result.idempotentReplay) {
      const current = await store.findExpenseById(expense.id);
      return { expenseNo: current?.expenseNo ?? "", journalEntryId: result.journalEntryId, idempotentReplay: true };
    }

    // INV-012 substrate: the document tax summaries land in the SAME
    // transaction as the journal + movement (append-only rows the VAT
    // return + RC-06/RC-07 checks read).
    if (resolved !== null && !resolved.notSubject) {
      await recordDocumentTaxSummary({
        sourceType: "expense",
        sourceId: expense.id,
        documentDate: expense.valueDate,
        fiscalPeriodId: null,
        direction: "INPUT",
        lines: [resolved],
      });
    }

    const acquired = await this.numbering.reserve({
      docType: TREASURY_NUMBER_FORMATS.expense.docType,
      branchId: null,
      periodKey: expense.valueDate.slice(0, 4),
      format: TREASURY_NUMBER_FORMATS.expense.format,
      prefix: TREASURY_NUMBER_FORMATS.expense.prefix,
      year: expense.valueDate.slice(0, 4),
    });

    await store.insertCashMovement({
      cashAccountId: account.id,
      direction: "OUT",
      amount: expense.amount,
      currencyCode: expense.currencyCode,
      exchangeRate: r1,
      baseAmount: cashBase,
      sourceType: "expense",
      sourceId: expense.id,
      valueDate: expense.valueDate,
      memo: `${category.code} — ${expense.payeeName}`,
    });

    await store.updateExpenseStatus({
      id: expense.id,
      status: "POSTED",
      expenseNo: acquired.number,
      postedJournalId: result.journalEntryId,
      actorId,
    });
    await this.audit.record({
      action: "treasury.expense_posted",
      entityType: "expense",
      entityId: expense.id,
      actorId: actorId ?? undefined,
      after: {
        expenseNo: acquired.number,
        journalEntryId: result.journalEntryId,
        amount: expense.amount,
        category: category.code,
        cashAccount: account.id,
      },
    });
    return { expenseNo: acquired.number, journalEntryId: result.journalEntryId, idempotentReplay: false };
  }

  async cancel(input: { id: string; reason: string; actorId: string | null }) {
    const expense = await this.find(input.id);
    if (expense.status === "POSTED") {
      throw new TreasuryDocumentStateError("posted expenses are immutable (INV-014: reversal-only)");
    }
    await store.cancelExpense({ id: input.id, actorId: input.actorId, reason: input.reason });
    await this.audit.record({
      action: "treasury.expense_cancelled",
      entityType: "expense",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      before: { status: expense.status },
      after: { status: "CANCELLED", reason: input.reason },
    });
    return this.find(input.id);
  }
}
