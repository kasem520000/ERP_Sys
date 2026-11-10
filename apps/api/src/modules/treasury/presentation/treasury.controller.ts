import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { AccountService } from "../application/account-service";
import { AllocationService } from "../application/allocation-service";
import { ReceiptService } from "../application/receipt-service";
import { PaymentService } from "../application/payment-service";
import { PettyCashGuard } from "../application/petty-cash-service";
import { TransferService } from "../application/transfer-service";
import { ExpenseService } from "../application/expense-service";
import { ShiftService } from "../application/shift-service";
import { StatementImportService } from "../application/statement-import-service";
import * as parked from "../parsers/parked-lines";
import { BankRecService } from "../application/bank-rec-service";
import { TreasuryReconciliationService } from "../application/treasury-reconciliation-service";

/**
 * Treasury routes (PHASE-008 §4; matrix §3.4): every route is permission-
 * guarded, Idempotency-Key'd by the global POST guard, and returns the
 * success envelope; foreign/unknown ids are 404-shaped (A7 — the not-found
 * errors render identically). Risky approve keys are approval-separated
 * (SoD enforced server-side in the services + audited).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const LIMIT = z.coerce.number().int().min(1).max(500).default(100);
const MONEY = z.string().regex(/^\d+(\.\d{1,8})?$/, "positive decimal");
const RATE = z.string().regex(/^\d+(\.\d{1,8})?$/, "positive rate").nullable().optional();
const UUID = z.string().uuid();
const METHOD = z.enum(["CASH", "BANK", "CHEQUE", "CARD", "TRANSFER"]);

const openAccountSchema = z.object({
  name: z.string().min(1).max(120),
  nameAr: z.string().min(1).max(160).nullable().optional(),
  type: z.enum(["CASH", "BANK", "PETTY"]),
  accountId: UUID,
  branchId: UUID.nullable().optional(),
  currencyCode: z.string().length(3),
});

const moneyDocSchema = z.object({
  cashAccountId: UUID,
  partnerId: UUID,
  method: METHOD,
  counterpartyName: z.string().min(1).max(160).nullable().optional(),
  currencyCode: z.string().length(3),
  amount: MONEY,
  exchangeRate: RATE,
  valueDate: DATE,
  reference: z.string().min(1).max(80).nullable().optional(),
  description: z.string().min(1).max(2000).nullable().optional(),
  descriptionAr: z.string().min(1).max(2000).nullable().optional(),
  overridePettyLimit: z.boolean().optional(),
});

const allocationsSchema = z.object({
  allocations: z
    .array(z.object({ openItemId: UUID, amount: MONEY }))
    .max(200),
});

const expenseCategorySchema = z.object({
  code: z.string().min(2).max(30),
  name: z.string().min(1).max(160),
  nameAr: z.string().min(1).max(160),
  accountId: UUID,
  approvalMode: z.enum(["none", "single-approver"]).default("single-approver"),
});

const expenseSchema = z.object({
  categoryId: UUID,
  cashAccountId: UUID,
  payeeName: z.string().min(1).max(160),
  currencyCode: z.string().length(3),
  amount: MONEY,
  exchangeRate: RATE,
  taxCodeId: UUID.nullable().optional(),
  receiptFileId: UUID.nullable().optional(),
  valueDate: DATE,
  description: z.string().min(1).max(2000).nullable().optional(),
  descriptionAr: z.string().min(1).max(2000).nullable().optional(),
  overridePettyLimit: z.boolean().optional(),
});

const transferSchema = z.object({
  fromAccountId: UUID,
  toAccountId: UUID,
  currencyCode: z.string().length(3),
  amount: MONEY,
  feeAmount: MONEY.default("0"),
  exchangeRate: RATE,
  valueDate: DATE,
  reference: z.string().min(1).max(80).nullable().optional(),
  description: z.string().min(1).max(2000).nullable().optional(),
  descriptionAr: z.string().min(1).max(2000).nullable().optional(),
  overridePettyLimit: z.boolean().optional(),
});

const reasonSchema = z.object({ reason: z.string().min(3).max(2000) });

const parkedResolveSchema = z.object({
  lineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date"),
  amount: z.string().regex(/^-?\d+(\.\d{1,8})?$/, "decimal string"),
  reference: z.string().min(1).max(120).nullish(),
  description: z.string().min(1).max(500).nullish(),
});

const parkedDiscardSchema = z.object({ note: z.string().min(3).max(500) });
const reverseSchema = z.object({ entryDate: DATE, reason: z.string().min(3).max(2000) });

const shiftOpenSchema = z.object({
  cashAccountId: UUID,
  openingAmount: MONEY.default("0"),
});

const shiftCaptureSchema = z.object({
  cashIn: MONEY.default("0"),
  cashOut: MONEY.default("0"),
});

const shiftCloseSchema = z.object({
  countedAmount: MONEY,
  reason: z.string().min(3).max(2000).optional(),
  supervisorId: UUID.optional(),
  supervisorPin: z.string().min(4).max(8).optional(),
});

const importSchema = z.object({
  cashAccountId: UUID,
  fileName: z.string().min(1).max(200),
  contentBase64: z.string().min(1),
  periodStart: DATE.optional(),
  periodEnd: DATE.optional(),
  adapterId: z.string().min(2).max(60).optional(),
  mapping: z
    .object({
      date: z.string().optional(),
      amount: z.string().optional(),
      reference: z.string().optional(),
      description: z.string().optional(),
      openingBalance: z.string().optional(),
      closingBalance: z.string().optional(),
    })
    .optional(),
});

const matchSchema = z.object({
  lineId: UUID,
  movementId: UUID.nullable(),
});

const cashCheckSchema = z.object({ asOf: DATE });

@Controller("api/v1/treasury")
export class TreasuryController {
  constructor(
    @Inject(AccountService) private readonly accounts: AccountService,
    @Inject(AllocationService) private readonly allocations: AllocationService,
    @Inject(ReceiptService) private readonly receipts: ReceiptService,
    @Inject(PaymentService) private readonly payments: PaymentService,
    @Inject(PettyCashGuard) private readonly pettyCash: PettyCashGuard,
    @Inject(TransferService) private readonly transfers: TransferService,
    @Inject(ExpenseService) private readonly expenses: ExpenseService,
    @Inject(ShiftService) private readonly shifts: ShiftService,
    @Inject(StatementImportService) private readonly statements: StatementImportService,
    @Inject(BankRecService) private readonly bankRec: BankRecService,
    @Inject(TreasuryReconciliationService)
    private readonly treasuryReconciliation: TreasuryReconciliationService,
  ) {}

  // -- cash accounts (§2.1) ------------------------------------------------------

  @Get("cash-accounts")
  @RequirePermissions("treasury.accounts.view")
  async listAccounts(
    @Query("type") type?: string,
    @Query("status") status?: string,
  ): Promise<unknown> {
    return envelope(await this.accounts.list({ type, status }));
  }

  @Post("cash-accounts")
  @RequirePermissions("treasury.accounts.manage")
  async openAccount(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = openAccountSchema.parse(body);
    return envelope(
      await this.accounts.open({
        name: input.name,
        nameAr: input.nameAr ?? null,
        type: input.type,
        accountId: input.accountId,
        branchId: input.branchId ?? null,
        currencyCode: input.currencyCode,
        actorId: identity.userId,
      }),
    );
  }

  @Get("cash-accounts/:id")
  @RequirePermissions("treasury.accounts.view")
  async findAccount(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.accounts.find(id));
  }

  @Post("cash-accounts/:id/close")
  @RequirePermissions("treasury.accounts.manage")
  @HttpCode(HttpStatus.OK)
  async closeAccount(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    return envelope(await this.accounts.close({ id, reason: input.reason, actorId: identity.userId }));
  }

  @Get("cash-accounts/:id/movements")
  @RequirePermissions("treasury.accounts.view")
  async accountMovements(
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return envelope(
      await this.accounts.movements({ id, fromDate: from, toDate: to, limit: LIMIT.parse(limit ?? undefined) }),
    );
  }

  @Get("petty-cash/:id")
  @RequirePermissions("treasury.petty_cash.manage")
  async pettyFund(@Param("id") id: string): Promise<unknown> {
    const overview = await this.pettyCash.fundOverview(id);
    return envelope(overview ?? { error: "not a petty account" });
  }

  // -- receipts (§2.3; G-05/G-06) ---------------------------------------------------

  @Get("receipts")
  @RequirePermissions("sales.receipts.view")
  async listReceipts(
    @Query("status") status?: string,
    @Query("partnerId") partnerId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return envelope(
      await this.receipts.list({
        status,
        partnerId,
        fromDate: from,
        toDate: to,
        limit: LIMIT.parse(limit ?? undefined),
      }),
    );
  }

  @Post("receipts")
  @RequirePermissions("sales.receipts.create")
  async createReceipt(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = moneyDocSchema.parse(body);
    return envelope(
      await this.receipts.create({
        cashAccountId: input.cashAccountId,
        partnerId: input.partnerId,
        method: input.method,
        payerName: input.counterpartyName ?? null,
        currencyCode: input.currencyCode,
        amount: input.amount,
        exchangeRate: input.exchangeRate ?? null,
        valueDate: input.valueDate,
        reference: input.reference ?? null,
        description: input.description ?? null,
        descriptionAr: input.descriptionAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("receipts/:id")
  @RequirePermissions("sales.receipts.view")
  async findReceipt(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.receipts.find(id));
  }

  @Post("receipts/:id/submit")
  @RequirePermissions("sales.receipts.create")
  @HttpCode(HttpStatus.OK)
  async submitReceipt(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.receipts.submit(id, identity.userId));
  }

  @Post("receipts/:id/approve")
  @RequirePermissions("sales.receipts.approve")
  @HttpCode(HttpStatus.OK)
  async approveReceipt(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.receipts.approve(id, identity.userId));
  }

  @Post("receipts/:id/post")
  @RequirePermissions("sales.receipts.approve")
  @HttpCode(HttpStatus.OK)
  async postReceipt(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.receipts.post(id, identity.userId));
  }

  @Post("receipts/:id/reverse")
  @RequirePermissions("sales.receipts.approve")
  @HttpCode(HttpStatus.OK)
  async reverseReceipt(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reverseSchema.parse(body);
    return envelope(
      await this.receipts.reverse({ id, entryDate: input.entryDate, reason: input.reason, actorId: identity.userId }),
    );
  }

  @Post("receipts/:id/cancel")
  @RequirePermissions("sales.receipts.create")
  @HttpCode(HttpStatus.OK)
  async cancelReceipt(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    return envelope(await this.receipts.cancel({ id, reason: input.reason, actorId: identity.userId }));
  }

  @Get("receipts/:id/allocations")
  @RequirePermissions("sales.receipts.view")
  async receiptAllocations(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.allocations.listForDoc("receipt", id));
  }

  @Put("receipts/:id/allocations")
  @RequirePermissions("sales.receipts.create")
  async setReceiptAllocations(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = allocationsSchema.parse(body);
    await this.allocations.setAllocations({
      docType: "receipt",
      docId: id,
      allocations: input.allocations,
      actorId: identity.userId,
    });
    return envelope(await this.allocations.listForDoc("receipt", id));
  }

  // -- payments (§2.3; G-10) ----------------------------------------------------------

  @Get("payments")
  @RequirePermissions("purchasing.payments.view")
  async listPayments(
    @Query("status") status?: string,
    @Query("partnerId") partnerId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return envelope(
      await this.payments.list({
        status,
        partnerId,
        fromDate: from,
        toDate: to,
        limit: LIMIT.parse(limit ?? undefined),
      }),
    );
  }

  @Post("payments")
  @RequirePermissions("purchasing.payments.create")
  async createPayment(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = moneyDocSchema.parse(body);
    return envelope(
      await this.payments.create({
        cashAccountId: input.cashAccountId,
        partnerId: input.partnerId,
        method: input.method,
        payeeName: input.counterpartyName ?? null,
        currencyCode: input.currencyCode,
        amount: input.amount,
        exchangeRate: input.exchangeRate ?? null,
        valueDate: input.valueDate,
        reference: input.reference ?? null,
        description: input.description ?? null,
        descriptionAr: input.descriptionAr ?? null,
        actorId: identity.userId,
        overridePettyLimit: input.overridePettyLimit,
      }),
    );
  }

  @Get("payments/:id")
  @RequirePermissions("purchasing.payments.view")
  async findPayment(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.payments.find(id));
  }

  @Post("payments/:id/submit")
  @RequirePermissions("purchasing.payments.create")
  @HttpCode(HttpStatus.OK)
  async submitPayment(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.payments.submit(id, identity.userId));
  }

  @Post("payments/:id/approve")
  @RequirePermissions("purchasing.payments.approve")
  @HttpCode(HttpStatus.OK)
  async approvePayment(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.payments.approve(id, identity.userId));
  }

  @Post("payments/:id/post")
  @RequirePermissions("purchasing.payments.approve")
  @HttpCode(HttpStatus.OK)
  async postPayment(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.payments.post(id, identity.userId));
  }

  @Post("payments/:id/reverse")
  @RequirePermissions("purchasing.payments.approve")
  @HttpCode(HttpStatus.OK)
  async reversePayment(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reverseSchema.parse(body);
    return envelope(
      await this.payments.reverse({ id, entryDate: input.entryDate, reason: input.reason, actorId: identity.userId }),
    );
  }

  @Post("payments/:id/cancel")
  @RequirePermissions("purchasing.payments.create")
  @HttpCode(HttpStatus.OK)
  async cancelPayment(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    return envelope(await this.payments.cancel({ id, reason: input.reason, actorId: identity.userId }));
  }

  @Get("payments/:id/allocations")
  @RequirePermissions("purchasing.payments.view")
  async paymentAllocations(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.allocations.listForDoc("payment", id));
  }

  @Put("payments/:id/allocations")
  @RequirePermissions("purchasing.payments.create")
  async setPaymentAllocations(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = allocationsSchema.parse(body);
    await this.allocations.setAllocations({
      docType: "payment",
      docId: id,
      allocations: input.allocations,
      actorId: identity.userId,
    });
    return envelope(await this.allocations.listForDoc("payment", id));
  }

  // -- open items + FIFO suggestion (§2.3) ----------------------------------------------

  @Get("open-items")
  @RequirePermissions("sales.receipts.view")
  async openItems(
    @Query("partnerId") partnerId?: string,
    @Query("side") side?: string,
  ): Promise<unknown> {
    return envelope(
      await this.allocations.openItems({
        partnerId,
        side: side === "AP" ? "AP" : "AR",
      }),
    );
  }

  @Get("allocations/suggest")
  @RequirePermissions("sales.receipts.view")
  async suggestAllocations(
    @Query("partnerId") partnerId: string,
    @Query("side") side?: string,
    @Query("amount") amount: string = "0",
  ): Promise<unknown> {
    return envelope(
      await this.allocations.suggest({
        partnerId,
        side: side === "AP" ? "AP" : "AR",
        amount,
      }),
    );
  }

  // -- expense categories + expenses (§2.6; BR-023) ---------------------------------------

  @Get("expense-categories")
  @RequirePermissions("treasury.expenses.view")
  async listCategories(@Query("includeInactive") includeInactive?: string): Promise<unknown> {
    return envelope(await this.expenses.listCategories(includeInactive === "true"));
  }

  @Post("expense-categories")
  @RequirePermissions("treasury.expenses.create")
  async createCategory(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = expenseCategorySchema.parse(body);
    return envelope(
      await this.expenses.createCategory({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr,
        accountId: input.accountId,
        approvalMode: input.approvalMode,
        actorId: identity.userId,
      }),
    );
  }

  @Get("expenses")
  @RequirePermissions("treasury.expenses.view")
  async listExpenses(
    @Query("status") status?: string,
    @Query("categoryId") categoryId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return envelope(
      await this.expenses.list({
        status,
        categoryId,
        fromDate: from,
        toDate: to,
        limit: LIMIT.parse(limit ?? undefined),
      }),
    );
  }

  @Post("expenses")
  @RequirePermissions("treasury.expenses.create")
  async createExpense(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = expenseSchema.parse(body);
    return envelope(
      await this.expenses.create({
        categoryId: input.categoryId,
        cashAccountId: input.cashAccountId,
        payeeName: input.payeeName,
        currencyCode: input.currencyCode,
        amount: input.amount,
        exchangeRate: input.exchangeRate ?? null,
        taxCodeId: input.taxCodeId ?? null,
        receiptFileId: input.receiptFileId ?? null,
        valueDate: input.valueDate,
        description: input.description ?? null,
        descriptionAr: input.descriptionAr ?? null,
        actorId: identity.userId,
        overridePettyLimit: input.overridePettyLimit,
      }),
    );
  }

  @Get("expenses/:id")
  @RequirePermissions("treasury.expenses.view")
  async findExpense(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.expenses.find(id));
  }

  @Post("expenses/:id/submit")
  @RequirePermissions("treasury.expenses.create")
  @HttpCode(HttpStatus.OK)
  async submitExpense(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.expenses.submit(id, identity.userId));
  }

  @Post("expenses/:id/approve")
  @RequirePermissions("treasury.expenses.approve")
  @HttpCode(HttpStatus.OK)
  async approveExpense(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.expenses.approve(id, identity.userId));
  }

  @Post("expenses/:id/post")
  @RequirePermissions("treasury.expenses.approve")
  @HttpCode(HttpStatus.OK)
  async postExpense(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.expenses.post(id, identity.userId));
  }

  @Post("expenses/:id/cancel")
  @RequirePermissions("treasury.expenses.create")
  @HttpCode(HttpStatus.OK)
  async cancelExpense(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    return envelope(await this.expenses.cancel({ id, reason: input.reason, actorId: identity.userId }));
  }

  // -- transfers (§2.5; G-12) ---------------------------------------------------------------

  @Get("cash-transfers")
  @RequirePermissions("treasury.transfers.create")
  async listTransfers(
    @Query("status") status?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return envelope(
      await this.transfers.list({
        status,
        fromDate: from,
        toDate: to,
        limit: LIMIT.parse(limit ?? undefined),
      }),
    );
  }

  @Post("cash-transfers")
  @RequirePermissions("treasury.transfers.create")
  async createTransfer(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = transferSchema.parse(body);
    return envelope(
      await this.transfers.create({
        fromAccountId: input.fromAccountId,
        toAccountId: input.toAccountId,
        currencyCode: input.currencyCode,
        amount: input.amount,
        feeAmount: input.feeAmount,
        exchangeRate: input.exchangeRate ?? null,
        valueDate: input.valueDate,
        reference: input.reference ?? null,
        description: input.description ?? null,
        descriptionAr: input.descriptionAr ?? null,
        actorId: identity.userId,
        overridePettyLimit: input.overridePettyLimit,
      }),
    );
  }

  @Get("cash-transfers/:id")
  @RequirePermissions("treasury.transfers.create")
  async findTransfer(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.transfers.find(id));
  }

  @Post("cash-transfers/:id/submit")
  @RequirePermissions("treasury.transfers.create")
  @HttpCode(HttpStatus.OK)
  async submitTransfer(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.transfers.submit(id, identity.userId));
  }

  @Post("cash-transfers/:id/approve")
  @RequirePermissions("treasury.transfers.approve")
  @HttpCode(HttpStatus.OK)
  async approveTransfer(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.transfers.approve(id, identity.userId));
  }

  @Post("cash-transfers/:id/post")
  @RequirePermissions("treasury.transfers.approve")
  @HttpCode(HttpStatus.OK)
  async postTransfer(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.transfers.post(id, identity.userId));
  }

  @Post("cash-transfers/:id/cancel")
  @RequirePermissions("treasury.transfers.create")
  @HttpCode(HttpStatus.OK)
  async cancelTransfer(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    return envelope(await this.transfers.cancel({ id, reason: input.reason, actorId: identity.userId }));
  }

  // -- shifts (§2.7; BR-021) -------------------------------------------------------------------

  @Get("shifts")
  @RequirePermissions("treasury.shifts.manage")
  async listShifts(@Query("status") status?: string, @Query("limit") limit?: string): Promise<unknown> {
    return envelope(await this.shifts.list({ status, limit: LIMIT.parse(limit ?? undefined) }));
  }

  @Post("shifts")
  @RequirePermissions("treasury.shifts.manage")
  async openShift(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = shiftOpenSchema.parse(body);
    return envelope(
      await this.shifts.open({
        cashAccountId: input.cashAccountId,
        openingAmount: input.openingAmount,
        actorId: identity.userId,
      }),
    );
  }

  @Get("shifts/:id")
  @RequirePermissions("treasury.shifts.manage")
  async findShift(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.shifts.find(id));
  }

  @Post("shifts/:id/capture")
  @RequirePermissions("treasury.shifts.manage")
  @HttpCode(HttpStatus.OK)
  async captureShift(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = shiftCaptureSchema.parse(body);
    return envelope(
      await this.shifts.capture({ id, cashIn: input.cashIn, cashOut: input.cashOut, actorId: identity.userId }),
    );
  }

  @Post("shifts/:id/close")
  @RequirePermissions("treasury.shifts.manage")
  @HttpCode(HttpStatus.OK)
  async closeShift(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = shiftCloseSchema.parse(body);
    return envelope(
      await this.shifts.close({
        id,
        countedAmount: input.countedAmount,
        reason: input.reason,
        supervisorId: input.supervisorId,
        supervisorPin: input.supervisorPin,
        actorId: identity.userId,
      }),
    );
  }

  @Post("shifts/:id/cancel")
  @RequirePermissions("treasury.shifts.manage")
  @HttpCode(HttpStatus.OK)
  async cancelShift(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reasonSchema.parse(body);
    return envelope(await this.shifts.cancel({ id, reason: input.reason, actorId: identity.userId }));
  }

  // -- bank statements + reconciliation (§2.8; BR-022) -------------------------------------------

  @Get("import-adapters")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  async listAdapters(): Promise<unknown> {
    return envelope(await this.statements.listAdapters());
  }

  @Get("bank-statements")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  async listStatements(
    @Query("cashAccountId") cashAccountId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return envelope(
      await this.statements.list({
        cashAccountId,
        status,
        limit: LIMIT.parse(limit ?? undefined),
      }),
    );
  }

  @Post("bank-statements/import")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  async importStatement(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = importSchema.parse(body);
    return envelope(await this.statements.import({ ...input, actorId: identity.userId }));
  }

  @Get("bank-statements/:id")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  async findStatement(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.statements.find(id));
  }

  @Get("bank-statements/:id/lines")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  async statementLines(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.statements.lines(id));
  }

  // -- PHASE-023 T7: parked lines (manual mapping — never guessed amounts) --------------------

  @Get("bank-statements/parked-lines")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  async parkedLines(
    @Query("statementId") statementId?: string,
    @Query("status") status?: string,
  ): Promise<unknown> {
    return envelope(await parked.listParkedLines({ statementId, status }));
  }

  @Post("bank-statements/parked-lines/:id/resolve")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  @HttpCode(HttpStatus.OK)
  async resolveParkedLine(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = parkedResolveSchema.parse(body);
    return envelope(
      await parked.resolveParkedLine({
        parkedLineId: id,
        lineDate: input.lineDate,
        amount: input.amount,
        reference: input.reference ?? null,
        description: input.description ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("bank-statements/parked-lines/:id/discard")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  @HttpCode(HttpStatus.OK)
  async discardParkedLine(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = parkedDiscardSchema.parse(body);
    return envelope(
      await parked.discardParkedLine({ parkedLineId: id, note: input.note, actorId: identity.userId }),
    );
  }

  @Post("bank-statements/:id/auto-match")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  @HttpCode(HttpStatus.OK)
  async autoMatch(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.bankRec.autoMatch({ statementId: id, actorId: identity.userId }));
  }

  @Post("bank-statements/:id/match")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  @HttpCode(HttpStatus.OK)
  async manualMatch(@Req() request: Request, @Param("id") _id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = matchSchema.parse(body);
    await this.bankRec.manualMatch({ lineId: input.lineId, movementId: input.movementId, actorId: identity.userId });
    return envelope({ matched: input.movementId !== null });
  }

  @Post("bank-statements/:id/reconcile")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  @HttpCode(HttpStatus.OK)
  async reconcile(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.bankRec.reconcile({ statementId: id, actorId: identity.userId }));
  }

  @Get("unmatched-aging")
  @RequirePermissions("treasury.bank_reconciliation.manage")
  async unmatchedAging(
    @Query("cashAccountId") cashAccountId?: string,
    @Query("asOf") asOf?: string,
  ): Promise<unknown> {
    if (cashAccountId === undefined) return envelope({ unmatchedLines: [], unmatchedMovements: [] });
    return envelope(await this.bankRec.unmatchedAging({ cashAccountId, asOf }));
  }

  // -- INV-019 reconciliation check (§2.10; RC-08/PC-04) ------------------------------------------

  @Post("reconciliation/cash-check")
  @RequirePermissions("treasury.accounts.view")
  @HttpCode(HttpStatus.OK)
  async runCashCheck(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = cashCheckSchema.parse(body);
    return envelope(
      await this.treasuryReconciliation.runCashCheck({
        asOf: input.asOf,
        runMode: "ON_DEMAND",
        checkedBy: identity.userId,
      }),
    );
  }
}
