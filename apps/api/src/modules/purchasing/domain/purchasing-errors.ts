import { DomainError } from "@erp/domain-core";

/**
 * PHASE-011 purchasing module domain errors. Codes are stable API contracts
 * (ERROR_MODEL §4) — the HTTP layer maps each to its status; A7-sensitive
 * not-founds render identically for unknown-vs-foreign ids (no existence
 * disclosure). Money travels as canonical decimal strings (ADR-0009).
 */

// -- documents / lifecycle -------------------------------------------------------

export class PurchaseRequestNotFoundError extends DomainError {
  constructor(id: string) {
    super("PURCHASE_REQUEST_NOT_FOUND", `purchase request ${id} does not exist in this tenant`);
  }
}
export class PurchaseOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("PURCHASE_ORDER_NOT_FOUND", `purchase order ${id} does not exist in this tenant`);
  }
}
export class GoodsReceiptNotFoundError extends DomainError {
  constructor(id: string) {
    super("GOODS_RECEIPT_NOT_FOUND", `goods receipt ${id} does not exist in this tenant`);
  }
}
export class SupplierInvoiceNotFoundError extends DomainError {
  constructor(id: string) {
    super("SUPPLIER_INVOICE_NOT_FOUND", `supplier invoice ${id} does not exist in this tenant`);
  }
}
export class DebitNoteNotFoundError extends DomainError {
  constructor(id: string) {
    super("DEBIT_NOTE_NOT_FOUND", `debit note ${id} does not exist in this tenant`);
  }
}
export class LandedCostNotFoundError extends DomainError {
  constructor(id: string) {
    super("LANDED_COST_NOT_FOUND", `landed cost ${id} does not exist in this tenant`);
  }
}
export class PurchasingDocumentStateError extends DomainError {
  constructor(message: string) {
    super("PURCHASING_DOCUMENT_STATE", message);
  }
}
export class EmptyDocumentError extends DomainError {
  constructor(docType: string) {
    super("EMPTY_DOCUMENT", `${docType} must carry at least one line`);
  }
}
export class SupplierNotFoundError extends DomainError {
  constructor(id: string) {
    super("SUPPLIER_NOT_FOUND", `supplier ${id} does not exist in this tenant`);
  }
}
export class PartnerNotSupplierError extends DomainError {
  constructor(id: string) {
    super("PARTNER_NOT_SUPPLIER", `partner ${id} is not a supplier (kind must include 'supplier')`);
  }
}

// -- purchase orders (BR-010 thresholds, revisions) -------------------------------

export class OrderLineInvalidError extends DomainError {
  constructor(message: string) {
    super("ORDER_LINE_INVALID", message);
  }
}
export class PoNotIssuedError extends DomainError {
  constructor(id: string) {
    super(
      "PO_NOT_ISSUED",
      `purchase order ${id} is not ISSUED — receipts reference issued orders only`,
    );
  }
}
export class PoNotOpenError extends DomainError {
  constructor(id: string) {
    super("PO_NOT_OPEN", `purchase order ${id} is not open for this operation (ISSUED only)`);
  }
}
export class PoRevisionParentInvalidError extends DomainError {
  constructor(message: string) {
    super("PO_REVISION_PARENT_INVALID", message);
  }
}
export class GrnExceedsPoLineError extends DomainError {
  constructor(details: { poLineId: string; ordered: string; alreadyReceived: string; requested: string }) {
    super(
      "GRN_EXCEEDS_PO_LINE",
      `receipt of ${details.requested} exceeds PO line ${details.poLineId}: ordered ${details.ordered}, already received ${details.alreadyReceived}`,
    );
  }
}
export class GrnLineWithoutPoError extends DomainError {
  constructor(details: { poId: string; lineNo: number }) {
    super(
      "GRN_LINE_WITHOUT_PO",
      `GRN line ${details.lineNo} references a PO line but the receipt has no PO (${details.poId} given on another line?) — PO-linked and PO-less lines cannot mix`,
    );
  }
}

// -- goods receipts (BR-012 PO-less policy) ---------------------------------------

export class PoLessGrnForbiddenError extends DomainError {
  constructor() {
    super(
      "PO_LESS_GRN_FORBIDDEN",
      "goods receipts without a purchase order are forbidden by the purchasing.allow_po_less_grn policy (BR-012) — create a PO first",
    );
  }
}
export class PoLessReasonRequiredError extends DomainError {
  constructor() {
    super(
      "PO_LESS_REASON_REQUIRED",
      "PO-less goods receipts require an explicit reason (BR-012)",
    );
  }
}
export class GrnLineTargetInvalidError extends DomainError {
  constructor(message: string) {
    super("GRN_LINE_TARGET_INVALID", message);
  }
}

// -- three-way matching (BR-009) ---------------------------------------------------

export class MatchOutcomeMissingError extends DomainError {
  constructor(invoiceId: string) {
    super(
      "MATCH_OUTCOME_MISSING",
      `supplier invoice ${invoiceId} has no recorded match outcome — run the three-way match and record dispositions before approval/posting (BR-009)`,
    );
  }
}
export class MatchExceptionUndisposedError extends DomainError {
  constructor(details: { invoiceId: string; exceptions: number }) {
    super(
      "MATCH_EXCEPTION_UNDISPOSED",
      `supplier invoice ${details.invoiceId} carries ${details.exceptions} above-tolerance match exception(s) without buyer disposition — approve is blocked until each has an explicit disposition (BR-009)`,
    );
  }
}
export class MatchDispositionInvalidError extends DomainError {
  constructor(message: string) {
    super("MATCH_DISPOSITION_INVALID", message);
  }
}
export class MatchRequiresLinesError extends DomainError {
  constructor(message: string) {
    super("MATCH_REQUIRES_LINES", message);
  }
}

// -- supplier invoices (BR-011 duplicates, G-08 posting) ---------------------------

export class DuplicateSupplierInvoiceError extends DomainError {
  constructor(details: { supplierId: string; invoiceNo: string; amount: string; existingId: string }) {
    super(
      "DUPLICATE_SUPPLIER_INVOICE",
      `supplier invoice (${details.invoiceNo}, ${details.amount}) already exists for this supplier (document ${details.existingId}) — BR-011 blocks the duplicate entry`,
    );
  }
}
export class InvoiceLineTargetInvalidError extends DomainError {
  constructor(message: string) {
    super("INVOICE_LINE_TARGET_INVALID", message);
  }
}
export class InvoiceGrnSupplierMismatchError extends DomainError {
  constructor(details: { invoiceSupplier: string; grnSupplier: string }) {
    super(
      "INVOICE_GRN_SUPPLIER_MISMATCH",
      `GRN line belongs to supplier ${details.grnSupplier} but the invoice is for ${details.invoiceSupplier}`,
    );
  }
}
export class InvoiceGrnAlreadyClearedError extends DomainError {
  constructor(details: { grnLineId: string; received: string; alreadyInvoiced: string; requested: string }) {
    super(
      "INVOICE_GRN_ALREADY_CLEARED",
      `GRN line ${details.grnLineId} received ${details.received} with ${details.alreadyInvoiced} already invoiced — invoice qty ${details.requested} exceeds the remainder`,
    );
  }
}

// -- debit notes (G-09) --------------------------------------------------------------

export class DebitNoteRefInvalidError extends DomainError {
  constructor(message: string) {
    super("DEBIT_NOTE_REF_INVALID", message);
  }
}

// -- payments / re-allocations (INV-016, BR-027) -----------------------------------

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

// -- landed costs (§2.10 baseline) ---------------------------------------------------

export class LandedCostGrnInvalidError extends DomainError {
  constructor(message: string) {
    super("LANDED_COST_GRN_INVALID", message);
  }
}
export class LandedCostAmountInvalidError extends DomainError {
  constructor(message: string) {
    super("LANDED_COST_AMOUNT_INVALID", message);
  }
}

// -- AP queries (aging/statement/GRNI) ----------------------------------------------

export class ApQueryInvalidError extends DomainError {
  constructor(message: string) {
    super("AP_QUERY_INVALID", message);
  }
}
