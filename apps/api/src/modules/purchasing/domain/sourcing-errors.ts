import { DomainError } from "@erp/domain-core";

/**
 * PHASE-038 procurement sourcing & supplier-collaboration domain errors.
 * Codes are stable API contracts (ERROR_MODEL §4) — the HTTP layer maps
 * each to its status; A7-sensitive not-founds render identically for
 * unknown-vs-foreign ids (no existence disclosure). Money travels as
 * canonical decimal strings (ADR-0009).
 */

// -- RFQ lifecycle (BR-063) -------------------------------------------------------

export class RfqNotFoundError extends DomainError {
  constructor(id: string) {
    super("RFQ_NOT_FOUND", `RFQ ${id} does not exist in this tenant`);
  }
}
export class RfqStateError extends DomainError {
  constructor(message: string) {
    super("RFQ_STATE", message);
  }
}
export class RfqDuePassedError extends DomainError {
  constructor(details: { rfqId: string; dueAt: string }) {
    super(
      "RFQ_DUE_PASSED",
      `RFQ ${details.rfqId} closed for responses at ${details.dueAt} — the due date has passed`,
    );
  }
}
export class SupplierNotInvitedError extends DomainError {
  constructor(details: { rfqId: string; supplierId: string }) {
    super(
      "SUPPLIER_NOT_INVITED",
      `supplier ${details.supplierId} is not on the invited list of RFQ ${details.rfqId} (INVITED mode)`,
    );
  }
}

// -- quotes ------------------------------------------------------------------------

export class SupplierQuoteNotFoundError extends DomainError {
  constructor(id: string) {
    super("SUPPLIER_QUOTE_NOT_FOUND", `supplier quote ${id} does not exist in this tenant`);
  }
}
export class QuoteLineInvalidError extends DomainError {
  constructor(message: string) {
    super("QUOTE_LINE_INVALID", message);
  }
}
export class QuoteCurrencyMismatchError extends DomainError {
  constructor(details: { rfqCurrency: string; quoteCurrency: string }) {
    super(
      "QUOTE_CURRENCY_MISMATCH",
      `quote currency ${details.quoteCurrency} does not match the RFQ currency ${details.rfqCurrency}`,
    );
  }
}

// -- comparison / award (BR-062 3-bid rule) ----------------------------------------

export class ComparisonNotFoundError extends DomainError {
  constructor(id: string) {
    super("COMPARISON_NOT_FOUND", `quote comparison ${id} does not exist in this tenant`);
  }
}
export class ComparisonStateError extends DomainError {
  constructor(message: string) {
    super("COMPARISON_STATE", message);
  }
}
export class AwardDecisionInvalidError extends DomainError {
  constructor(message: string) {
    super("AWARD_DECISION_INVALID", message);
  }
}
export class ThreeBidRuleViolatedError extends DomainError {
  constructor(details: { minQuotes: number; received: number }) {
    super(
      "THREE_BID_RULE_VIOLATED",
      `BR-062: the award needs at least ${details.minQuotes} submitted quotes — ${details.received} received (the 3-bid policy is ENFORCED for this tenant)`,
    );
  }
}
export class NoQuotesToCompareError extends DomainError {
  constructor(rfqId: string) {
    super("NO_QUOTES_TO_COMPARE", `RFQ ${rfqId} has no submitted quotes to compare`);
  }
}

// -- blanket agreements (P-03) -------------------------------------------------------

export class BlanketOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("BLANKET_ORDER_NOT_FOUND", `blanket order ${id} does not exist in this tenant`);
  }
}
export class BlanketStateError extends DomainError {
  constructor(message: string) {
    super("BLANKET_STATE", message);
  }
}
export class BlanketExpiredError extends DomainError {
  constructor(details: { blanketId: string; validTo: string }) {
    super(
      "BLANKET_EXPIRED",
      `blanket order ${details.blanketId} expired on ${details.validTo} — no further releases`,
    );
  }
}
export class BlanketOverReleaseError extends DomainError {
  constructor(details: {
    blanketId: string;
    requested: string;
    remaining: string;
    maxCommitment: string;
  }) {
    super(
      "BLANKET_OVER_RELEASE",
      `release of ${details.requested} exceeds the remaining commitment of blanket ${details.blanketId}: released + requested > max ${details.maxCommitment} (remaining ${details.remaining})`,
    );
  }
}
export class BlanketReleaseLineInvalidError extends DomainError {
  constructor(message: string) {
    super("BLANKET_RELEASE_LINE_INVALID", message);
  }
}

// -- scorecards + approved lists (P-04) ----------------------------------------------

export class SupplierRatingNotFoundError extends DomainError {
  constructor(supplierId: string) {
    super("SUPPLIER_RATING_NOT_FOUND", `no scorecard exists for supplier ${supplierId}`);
  }
}
export class ApprovedVendorRequiredError extends DomainError {
  constructor(details: { supplierId: string; itemId: string }) {
    super(
      "APPROVED_VENDOR_REQUIRED",
      `supplier ${details.supplierId} is not on the approved-vendor list for item ${details.itemId} (the approved_vendor_list BLOCK policy is active)`,
    );
  }
}

// -- advances + early-payment discounts (G-33/G-34) -----------------------------------

export class SupplierAdvanceNotFoundError extends DomainError {
  constructor(id: string) {
    super("SUPPLIER_ADVANCE_NOT_FOUND", `supplier advance ${id} does not exist in this tenant`);
  }
}
export class AdvanceStateError extends DomainError {
  constructor(message: string) {
    super("ADVANCE_STATE", message);
  }
}
export class SupplierAdvanceAccountUnmappedError extends DomainError {
  constructor() {
    super(
      "SUPPLIER_ADVANCE_ACCOUNT_UNMAPPED",
      "the supplier-advance control account is not mapped (set purchasing.supplier_advance_control_account) — G-33 fails closed, nothing posted",
    );
  }
}
export class EarlyDiscountIncomeAccountUnmappedError extends DomainError {
  constructor() {
    super(
      "EARLY_DISCOUNT_INCOME_ACCOUNT_UNMAPPED",
      "the early-payment discount income account is not mapped (set purchasing.early_discount_income_account) — G-34 fails closed, nothing posted",
    );
  }
}
export class DiscountTermsNotFoundError extends DomainError {
  constructor(supplierId: string) {
    super("DISCOUNT_TERMS_NOT_FOUND", `no early-payment discount terms exist for supplier ${supplierId}`);
  }
}
export class DiscountTermsNotApprovedError extends DomainError {
  constructor(supplierId: string) {
    super(
      "DISCOUNT_TERMS_NOT_APPROVED",
      `the early-payment discount terms of supplier ${supplierId} are not approved (SoD: creator ≠ approver) — no capture can post`,
    );
  }
}
export class DiscountWindowExpiredError extends DomainError {
  constructor(details: { invoiceId: string; deadline: string }) {
    super(
      "DISCOUNT_WINDOW_EXPIRED",
      `the early-payment discount window for invoice ${details.invoiceId} closed at ${details.deadline} — the payment missed the terms' discount_days`,
    );
  }
}
export class DiscountPaymentInvalidError extends DomainError {
  constructor(message: string) {
    super("DISCOUNT_PAYMENT_INVALID", message);
  }
}
export class DiscountAlreadyCapturedError extends DomainError {
  constructor(invoiceId: string) {
    super(
      "DISCOUNT_ALREADY_CAPTURED",
      `invoice ${invoiceId} already has a captured early-payment discount (INV-013 idempotency — one capture per invoice)`,
    );
  }
}

// -- CAPEX (P-10/P-15, the 028 guard) ---------------------------------------------------

export class CapexRequestNotFoundError extends DomainError {
  constructor(id: string) {
    super("CAPEX_REQUEST_NOT_FOUND", `CAPEX request ${id} does not exist in this tenant`);
  }
}
export class CapexStateError extends DomainError {
  constructor(message: string) {
    super("CAPEX_STATE", message);
  }
}

// -- tender intake (P-14/DF-52/DF-53) ----------------------------------------------------

export class TenderIntakeNotFoundError extends DomainError {
  constructor(id: string) {
    super("TENDER_INTAKE_NOT_FOUND", `tender intake ${id} does not exist in this tenant`);
  }
}

// -- supplier portal (P-05) ---------------------------------------------------------------

export class PortalTokenInvalidError extends DomainError {
  constructor() {
    // Deliberately shape-uniform: invalid, expired, revoked, and
    // unknown tokens render the SAME typed rejection (no oracle — the
    // login-uniformity discipline applied to the portal surface).
    super("PORTAL_TOKEN_INVALID", "the portal invitation token is invalid, expired, or revoked");
  }
}
export class PortalRateLimitedError extends DomainError {
  constructor(retryAfterSeconds: number) {
    super(
      "PORTAL_RATE_LIMITED",
      `too many portal attempts — retry after ${retryAfterSeconds}s`,
    );
  }
}
export class PortalSubmissionInvalidError extends DomainError {
  constructor(message: string) {
    super("PORTAL_SUBMISSION_INVALID", message);
  }
}
