import { DomainError } from "@erp/domain-core";

/**
 * PHASE-008 treasury module domain errors. Codes are stable API contracts
 * (ERROR_MODEL §4) — the HTTP layer maps each to its status; A7-sensitive
 * not-founds render identically for unknown-vs-foreign ids (no existence
 * disclosure). Money values travel as canonical decimal strings (ADR-0009).
 */

// -- cash accounts (T2) ---------------------------------------------------------

export class CashAccountNotFoundError extends DomainError {
  constructor(id: string) {
    super("CASH_ACCOUNT_NOT_FOUND", `cash account ${id} does not exist in this tenant`);
  }
}
export class CashAccountAlreadyExistsError extends DomainError {
  constructor(message: string) {
    super("CASH_ACCOUNT_ALREADY_EXISTS", message);
  }
}
export class CashAccountClosedError extends DomainError {
  constructor(id: string) {
    super("CASH_ACCOUNT_CLOSED", `cash account ${id} is CLOSED and cannot receive new documents`);
  }
}
export class CashAccountNotCloseableError extends DomainError {
  constructor(message: string) {
    super("CASH_ACCOUNT_NOT_CLOSEABLE", message);
  }
}
export class CashAccountCurrencyMismatchError extends DomainError {
  constructor(details: { accountCurrency: string; documentCurrency: string }) {
    super(
      "CASH_ACCOUNT_CURRENCY_MISMATCH",
      `cash account currency ${details.accountCurrency} cannot receive ${details.documentCurrency} documents (INV-005)`,
      details,
    );
  }
}
export class CashAccountTypeInvalidError extends DomainError {
  constructor(message: string) {
    super("CASH_ACCOUNT_TYPE_INVALID", message);
  }
}
export class InvalidAmountError extends DomainError {
  constructor(message: string) {
    super("INVALID_AMOUNT", message);
  }
}

// -- receipts / payments (T3) ----------------------------------------------------

export class ReceiptNotFoundError extends DomainError {
  constructor(id: string) {
    super("RECEIPT_NOT_FOUND", `receipt ${id} does not exist in this tenant`);
  }
}
export class PaymentNotFoundError extends DomainError {
  constructor(id: string) {
    super("PAYMENT_NOT_FOUND", `payment ${id} does not exist in this tenant`);
  }
}
export class TransferNotFoundError extends DomainError {
  constructor(id: string) {
    super("CASH_TRANSFER_NOT_FOUND", `cash transfer ${id} does not exist in this tenant`);
  }
}
export class TreasuryDocumentStateError extends DomainError {
  constructor(message: string) {
    super("TREASURY_DOCUMENT_STATE_INVALID", message);
  }
}
export class TreasuryFxRateRequiredError extends DomainError {
  constructor(currency: string) {
    super("MISSING_FX_RATE", `an exchange rate is required for ${currency} documents`);
  }
}

// -- allocations (T4; INV-016) ---------------------------------------------------

export class AllocationExceedsDocumentError extends DomainError {
  constructor(details: { allocated: string; amount: string }) {
    super(
      "ALLOCATION_EXCEEDS_DOCUMENT",
      `allocations ${details.allocated} exceed the document amount ${details.amount} (INV-016)`,
      details,
    );
  }
}
export class AllocationExceedsOpenItemError extends DomainError {
  constructor(details: { openItemId: string; allocated: string; outstanding: string }) {
    super(
      "ALLOCATION_EXCEEDS_OPEN_ITEM",
      `allocation ${details.allocated} exceeds open item ${details.openItemId} outstanding ${details.outstanding} (INV-016)`,
      details,
    );
  }
}
export class OpenItemNotFoundError extends DomainError {
  constructor(id: string) {
    super("OPEN_ITEM_NOT_FOUND", `open item ${id} does not exist in this tenant`);
  }
}
export class OpenItemCurrencyMismatchError extends DomainError {
  constructor(details: { openItemCurrency: string; documentCurrency: string }) {
    super(
      "OPEN_ITEM_CURRENCY_MISMATCH",
      `open item currency ${details.openItemCurrency} differs from the document currency ${details.documentCurrency}`,
      details,
    );
  }
}
export class OpenItemPartnerMismatchError extends DomainError {
  constructor(details: { openItemPartnerId: string; documentPartnerId: string }) {
    super(
      "OPEN_ITEM_PARTNER_MISMATCH",
      `open item belongs to partner ${details.openItemPartnerId}, not the document partner ${details.documentPartnerId}`,
      details,
    );
  }
}
export class OpenItemSideInvalidError extends DomainError {
  constructor(details: { documentType: string; requiredSide: string }) {
    super(
      "OPEN_ITEM_SIDE_INVALID",
      `${details.documentType} documents allocate against ${details.requiredSide} open items only (AR receivables for receipts, AP payables for payments)`,
      details,
    );
  }
}

// -- petty cash (T6; BR-020) -----------------------------------------------------

export class PettyCashLimitExceededError extends DomainError {
  constructor(details: { cap: "single_tx_limit" | "max_balance"; value: string; limit: string }) {
    super(
      "PETTY_CASH_LIMIT_EXCEEDED",
      `petty cash ${details.cap} ${details.value} exceeds the configured ${details.limit} (BR-020 — reimburse, split, or record an accountant override)`,
      details,
    );
  }
}

// -- expenses (T8; BR-023) --------------------------------------------------------

export class ExpenseCategoryNotFoundError extends DomainError {
  constructor(id: string) {
    super("EXPENSE_CATEGORY_NOT_FOUND", `expense category ${id} does not exist in this tenant`);
  }
}
export class ExpenseCategoryCodeTakenError extends DomainError {
  constructor(code: string) {
    super("EXPENSE_CATEGORY_CODE_TAKEN", `expense category code ${code} is already in use`);
  }
}
export class ExpenseNotFoundError extends DomainError {
  constructor(id: string) {
    super("EXPENSE_NOT_FOUND", `expense ${id} does not exist in this tenant`);
  }
}
export class ExpenseReceiptRequiredError extends DomainError {
  constructor(threshold: string) {
    super(
      "EXPENSE_RECEIPT_REQUIRED",
      `a receipt attachment is required at or above the tenant threshold ${threshold} (BR-023)`,
    );
  }
}
export class ExpenseApprovalRequiredError extends DomainError {
  constructor() {
    super("EXPENSE_APPROVAL_REQUIRED", "expense must be approved before payout posting (BR-023)");
  }
}

// -- shifts (T9; BR-021) ----------------------------------------------------------

export class ShiftNotFoundError extends DomainError {
  constructor(id: string) {
    super("SHIFT_NOT_FOUND", `cashier shift ${id} does not exist in this tenant`);
  }
}
export class ShiftAlreadyOpenError extends DomainError {
  constructor(accountId: string) {
    super("SHIFT_ALREADY_OPEN", `cash account ${accountId} already has an OPEN shift`);
  }
}
export class ShiftSupervisorRequiredError extends DomainError {
  constructor(details: { difference: string; tolerance: string }) {
    super(
      "SHIFT_SUPERVISOR_REQUIRED",
      `shift difference ${details.difference} exceeds the tolerance ${details.tolerance} — a supervisor id + PIN + reason are required (BR-021)`,
      details,
    );
  }
}
export class ShiftSupervisorPinInvalidError extends DomainError {
  constructor() {
    super("SHIFT_SUPERVISOR_PIN_INVALID", "the supervisor PIN is not set or does not match (BR-021)");
  }
}
export class ShiftReasonRequiredError extends DomainError {
  constructor() {
    super("SHIFT_REASON_REQUIRED", "closing a shift with any difference requires a reason (BR-021)");
  }
}

// -- bank statements / reconciliation (T10/T11; BR-022) ----------------------------

export class StatementTooLargeError extends DomainError {
  constructor(count: number, cap: number) {
    super("STATEMENT_TOO_LARGE", `statement has ${count} rows; the import cap is ${cap} rows (bounded import, U-07)`);
  }
}
export class StatementFormatInvalidError extends DomainError {
  constructor(message: string) {
    super("STATEMENT_FORMAT_INVALID", message);
  }
}
export class StatementNotFoundError extends DomainError {
  constructor(id: string) {
    super("STATEMENT_NOT_FOUND", `bank statement ${id} does not exist in this tenant`);
  }
}
export class StatementLineNotFoundError extends DomainError {
  constructor(id: string) {
    super("STATEMENT_LINE_NOT_FOUND", `bank statement line ${id} does not exist in this tenant`);
  }
}
export class StatementAlreadyReconciledError extends DomainError {
  constructor(id: string) {
    super("STATEMENT_ALREADY_RECONCILED", `bank statement ${id} is already RECONCILED — the period is locked for this account (BR-022)`);
  }
}
export class BankRecPeriodLockedError extends DomainError {
  constructor(details: { accountId: string; date: string }) {
    super(
      "BANK_REC_PERIOD_LOCKED",
      `date ${details.date} falls in a RECONCILED statement period for this account (BR-022 — locked)`,
      details,
    );
  }
}
export class MovementNotFoundError extends DomainError {
  constructor(id: string) {
    super("CASH_MOVEMENT_NOT_FOUND", `cash movement ${id} does not exist in this tenant`);
  }
}
export class MovementAlreadyMatchedError extends DomainError {
  constructor(id: string) {
    super("MOVEMENT_ALREADY_MATCHED", `cash movement ${id} is already matched to another statement line`);
  }
}

export const TREASURY_NOT_FOUND_ERRORS: readonly (new (...args: never[]) => DomainError)[] = [
  CashAccountNotFoundError,
  ReceiptNotFoundError,
  PaymentNotFoundError,
  TransferNotFoundError,
  OpenItemNotFoundError,
  ExpenseCategoryNotFoundError,
  ExpenseNotFoundError,
  ShiftNotFoundError,
  StatementNotFoundError,
  StatementLineNotFoundError,
  MovementNotFoundError,
];
