import { DomainError } from "@erp/domain-core";

/**
 * PHASE-012 sales module domain errors. Codes are stable API contracts
 * (ERROR_MODEL §4) — the HTTP layer maps each to its status; A7-sensitive
 * not-founds render identically for unknown-vs-foreign ids (no existence
 * disclosure). Money travels as canonical decimal strings (ADR-0009).
 */

// -- documents / lifecycle -------------------------------------------------------

export class QuotationNotFoundError extends DomainError {
  constructor(id: string) {
    super("QUOTATION_NOT_FOUND", `quotation ${id} does not exist in this tenant`);
  }
}
export class SalesOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("SALES_ORDER_NOT_FOUND", `sales order ${id} does not exist in this tenant`);
  }
}
export class DeliveryNoteNotFoundError extends DomainError {
  constructor(id: string) {
    super("DELIVERY_NOTE_NOT_FOUND", `delivery note ${id} does not exist in this tenant`);
  }
}
export class SalesInvoiceNotFoundError extends DomainError {
  constructor(id: string) {
    super("SALES_INVOICE_NOT_FOUND", `sales invoice ${id} does not exist in this tenant`);
  }
}
export class CreditNoteNotFoundError extends DomainError {
  constructor(id: string) {
    super("CREDIT_NOTE_NOT_FOUND", `credit note ${id} does not exist in this tenant`);
  }
}
export class SalesRepNotFoundError extends DomainError {
  constructor(id: string) {
    super("SALES_REP_NOT_FOUND", `sales rep ${id} does not exist in this tenant`);
  }
}
export class SalesDocumentStateError extends DomainError {
  constructor(message: string) {
    super("SALES_DOCUMENT_STATE", message);
  }
}
export class EmptyDocumentError extends DomainError {
  constructor(docType: string) {
    super("EMPTY_DOCUMENT", `${docType} must carry at least one line`);
  }
}
export class CustomerNotFoundError extends DomainError {
  constructor(id: string) {
    super("CUSTOMER_NOT_FOUND", `customer ${id} does not exist in this tenant`);
  }
}
export class PartnerNotCustomerError extends DomainError {
  constructor(id: string) {
    super("PARTNER_NOT_CUSTOMER", `partner ${id} is not a customer (kind must include 'customer')`);
  }
}

// -- quotations (BR-006) ------------------------------------------------------------

export class QuotationExpiredError extends DomainError {
  constructor(details: { id: string; validUntil: string }) {
    super(
      "QUOTATION_EXPIRED",
      `quotation ${details.id} expired on ${details.validUntil} — an expired quote cannot be accepted or converted (BR-006); re-issue as a new quotation`,
    );
  }
}

// -- sales orders (thresholds, reservations) ----------------------------------------

export class OrderLineInvalidError extends DomainError {
  constructor(message: string) {
    super("ORDER_LINE_INVALID", message);
  }
}
export class ReservationInvalidError extends DomainError {
  constructor(message: string) {
    super("RESERVATION_INVALID", message);
  }
}

// -- delivery notes / invoices (BR-007, stock interplay) -----------------------------

export class DeliveryLineInvalidError extends DomainError {
  constructor(message: string) {
    super("DELIVERY_LINE_INVALID", message);
  }
}
export class InvoiceLineInvalidError extends DomainError {
  constructor(message: string) {
    super("INVOICE_LINE_INVALID", message);
  }
}
export class DeliveryAlreadyInvoicedError extends DomainError {
  constructor(details: { deliveryLineId: string; delivered: string; alreadyInvoiced: string; requested: string }) {
    super(
      "DELIVERY_ALREADY_INVOICED",
      `delivery line ${details.deliveryLineId} delivered ${details.delivered} with ${details.alreadyInvoiced} already invoiced — invoice qty ${details.requested} exceeds the remainder`,
    );
  }
}
export class PriceChangedError extends DomainError {
  constructor(details: { itemId: string; resolved: string; provided: string }) {
    super(
      "PRICE_CHANGED",
      `item ${details.itemId} resolves to unit price ${details.resolved} but the document carries ${details.provided} — the draft references a stale price (re-open to recompute)`,
      // PHASE-020 C-09b: the offline client renders the current price
      // (CONFLICT_RESOLUTION §3 — resolved vs provided in details).
      { itemId: details.itemId, resolved: details.resolved, provided: details.provided },
    );
  }
}
export class ItemInactiveError extends DomainError {
  constructor(itemId: string) {
    super("ITEM_INACTIVE", `item ${itemId} is inactive and cannot receive sales documents`);
  }
}

// -- credit notes (BR-004) ------------------------------------------------------------

export class CreditNoteRefInvalidError extends DomainError {
  constructor(message: string) {
    super("CREDIT_NOTE_REF_INVALID", message);
  }
}
export class ReturnWindowExceededError extends DomainError {
  constructor(details: { invoiceId: string; invoiceDate: string; noteDate: string; windowDays: number }) {
    super(
      "RETURN_WINDOW_EXCEEDED",
      `invoice ${details.invoiceId} was posted ${details.invoiceDate}; the return dated ${details.noteDate} is outside the ${details.windowDays}-day return window (BR-004) — set sales.return_window_days = 0 to disable date checks (the reference requirement never disables)`,
    );
  }
}
export class CreditNoteExceedsInvoiceError extends DomainError {
  constructor(details: { invoiceId: string; outstanding: string; requested: string }) {
    super(
      "CREDIT_NOTE_EXCEEDS_INVOICE",
      `credit note of ${details.requested} exceeds the outstanding ${details.outstanding} on invoice ${details.invoiceId} (INV-016) — the remainder would float as an unallocated credit; issue a standalone credit note only when policy-flagged`,
    );
  }
}

// -- credit limits (BR-001) -----------------------------------------------------------

export class CreditLimitExceededError extends DomainError {
  constructor(details: {
    partnerId: string;
    openBalance: string;
    documentAmount: string;
    limit: string | null;
    overdueCount: number;
    posture: string;
    math: string;
  }) {
    super(
      "CREDIT_LIMIT_EXCEEDED",
      `credit limit exceeded for partner ${details.partnerId}: open ${details.openBalance} + this document ${details.documentAmount} vs limit ${details.limit ?? "none"} (${details.math}); overdue invoices: ${details.overdueCount}; posture ${details.posture} (BR-001) — override requires sales.credit_check.override`,
    );
  }
}

// -- receipts / re-allocations (INV-016, BR-027) --------------------------------------

export class ReallocationSourceInvalidError extends DomainError {
  constructor(message: string) {
    super("REALLOCATION_SOURCE_INVALID", message);
  }
}
export class ReallocationTargetInvalidError extends DomainError {
  constructor(message: string) {
    super("REALLOCATION_TARGET_INVALID", message);
  }
}
export class ReallocationAmountInvalidError extends DomainError {
  constructor(message: string) {
    super("REALLOCATION_AMOUNT_INVALID", message);
  }
}

// -- AR queries (aging/statement) ------------------------------------------------------

export class ArQueryInvalidError extends DomainError {
  constructor(message: string) {
    super("AR_QUERY_INVALID", message);
  }
}
