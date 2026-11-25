import { DomainError } from "@erp/domain-core";

/**
 * PHASE-051 (W-34 — T-05 + T-06, 2026-11-25) THE TRADE TYPED-REFUSAL
 * TAXONOMY (the quality-errors precedent: stable UPPER_SNAKE codes are
 * the API contract, the message is display-only, the details payload is
 * machine-readable). The reservation law rides every class: the codes
 * name G-64's floors and BR-105's ladder exactly as the phase doc's own
 * wording; no identifier outside the 051 reservations (G-64…G-66 ·
 * INV-036 · BR-105…BR-108) is invented anywhere.
 *
 * The HTTP face (the PHASE-045 T-03 lesson applied at the FIRST trade
 * increment): the not-found classes register as 404 and the lifecycle
 * conflicts as 409 in error.filter.ts's domainStatus chain in the SAME
 * increment that ships the routes — never the 422 fall-through drift.
 */

/** The service-level input floor (the QualityInputInvalidError
 * precedent — the controller's zod parse errors surface as
 * VALIDATION_ERROR; this class guards the invariants the zod shape
 * cannot express). */
export class TradeInputInvalidError extends DomainError {
  constructor(details: { field: string; reason: string }) {
    super("TRADE_INPUT_INVALID", `trade input invalid at ${details.field}: ${details.reason}`, details);
  }
}

// ── the LC plane (T-05 — the lifecycle + G-64's floors) ─────────────────────

export class LcRecordNotFoundError extends DomainError {
  constructor(details: { lcId: string }) {
    super("LC_RECORD_NOT_FOUND", `letter of credit ${details.lcId} does not exist in this tenant`, details);
  }
}

/** The (tenant, lc_no) natural key is unique (the 0119 uq) — the service
 * refuses BY NAME before the DB floor (the typed pre-check law; the
 * 23505 never surfaces raw). */
export class LcDuplicateError extends DomainError {
  constructor(details: { lcNo: string }) {
    super(
      "LC_DUPLICATE",
      `an LC numbered ${details.lcNo} already exists in this tenant (the (tenant, lc_no) key is unique — uq_letters_of_credit_tenant_no)`,
      details,
    );
  }
}

/** THE LADDER'S OWN REFUSAL (the ncr-lifecycle verdict rendered VERBATIM
 * — the typed refusal names the record and the illegal move's reason). */
export class LcStateError extends DomainError {
  constructor(details: {
    lcId: string;
    lcNo: string;
    from: string;
    to: string;
    reason: string;
  }) {
    super(
      "LC_STATE",
      `LC ${details.lcNo} is ${details.from} — ${details.reason} (the move to ${details.to} is refused)`,
      details,
    );
  }
}

/** G-64's margin shape at the act (D-05): the margin deposit requires an
 * explicit bank account at issuance; the cancellation of a margined
 * instrument refuses (the margin's exit is the retirement pair). */
export class LcMarginShapeError extends DomainError {
  constructor(details: { lcId: string; lcNo: string; reason: string; marginAmount?: string }) {
    super(
      "LC_MARGIN_SHAPE",
      `LC ${details.lcNo}: ${details.reason}${
        details.marginAmount === undefined ? "" : ` (margin ${details.marginAmount})`
      } — G-64's own shape (D-05)`,
      details,
    );
  }
}

/** The tenant's chosen bank account at the act — the ACTIVE account in
 * the LC's own currency (the treasury discipline's floor, the
 * cash-account family's trade face). */
export class LcBankAccountInvalidError extends DomainError {
  constructor(details: { lcId: string; bankAccountId: string; reason: string }) {
    super(
      "LC_BANK_ACCOUNT_INVALID",
      `bank account ${details.bankAccountId} is invalid for LC ${details.lcId}: ${details.reason}`,
      details,
    );
  }
}

/** The typed-change law's refusal (the 0119 floors, rendered at the
 * act — the refusal names the missing shape). */
export class LcAmendmentInvalidError extends DomainError {
  constructor(details: { lcId: string; reason: string }) {
    super("LC_AMENDMENT_INVALID", `the amendment on LC ${details.lcId} is refused: ${details.reason}`, details);
  }
}

/** The checklist monotone law's refusal (the 0119 floors' fold — the
 * refusal names the document and the regressing stamp). */
export class LcChecklistStateError extends DomainError {
  constructor(details: { lcId: string; docType: string; reason: string }) {
    super(
      "LC_CHECKLIST_STATE",
      `the checklist write on LC ${details.lcId} document "${details.docType}" is refused: ${details.reason}`,
      details,
    );
  }
}

/** The checklist's own natural key (the 0119 uq per (tenant, lc, doc
 * type)) — the duplicate refused BY NAME. */
export class LcDocumentDuplicateError extends DomainError {
  constructor(details: { lcId: string; docType: string }) {
    super(
      "LC_DOCUMENT_DUPLICATE",
      `LC ${details.lcId} already carries a "${details.docType}" checklist row (the (tenant, lc, doc_type) key is unique — uq_lc_documents_tenant_lc_type)`,
      details,
    );
  }
}

// ── the sweep plane (T-06 — BR-105's settings surface) ─────────────────────

/** The thresholds write's typed refusal (the zod refusal re-surfaced
 * under the wave's own name — the calibration precedent). */
export class LcSweepThresholdsInvalidError extends DomainError {
  constructor(details: { message: string }) {
    super(
      "LC_SWEEP_THRESHOLDS_INVALID",
      `the trade LC expiry sweep thresholds are invalid: ${details.message}`,
      details,
    );
  }
}

// ── the collections plane (T-07 — the D/P vs D/A register) ──────────────────

export class CollectionRecordNotFoundError extends DomainError {
  constructor(details: { collectionId: string }) {
    super(
      "COLLECTION_RECORD_NOT_FOUND",
      `documentary collection ${details.collectionId} does not exist in this tenant`,
      details,
    );
  }
}

/** The (tenant, collection_no) natural key is unique (the 0119 uq) —
 * the service refuses BY NAME before the DB floor. */
export class CollectionDuplicateError extends DomainError {
  constructor(details: { collectionNo: string }) {
    super(
      "COLLECTION_DUPLICATE",
      `a collection numbered ${details.collectionNo} already exists in this tenant (the (tenant, collection_no) key is unique — uq_documentary_collections_tenant_no)`,
      details,
    );
  }
}

/** THE LADDER'S OWN REFUSAL (the fold's verdict rendered VERBATIM —
 * the typed refusal names the register and the illegal move's reason:
 * the terms gate, the stamp law's OPEN-only exit, the terminals). */
export class CollectionStateError extends DomainError {
  constructor(details: {
    collectionId: string;
    collectionNo: string;
    from: string;
    to: string;
    reason: string;
  }) {
    super(
      "COLLECTION_STATE",
      `collection ${details.collectionNo} is ${details.from} — ${details.reason} (the move to ${details.to} is refused)`,
      details,
    );
  }
}

/** The usance floor's refusal at create (the 0119 constraint's own
 * fold — the refusal names the terms and the missing maturity). */
export class CollectionUsanceError extends DomainError {
  constructor(details: { termsType: string; reason: string }) {
    super(
      "COLLECTION_USANCE_INVALID",
      `the ${details.termsType} collection is refused: ${details.reason}`,
      details,
    );
  }
}

/** The settlement pair's refusal (the 0119 XOR floor at the act — the
 * settlement linkage is a pair; the reference names the treasury fact). */
export class CollectionSettlementInvalidError extends DomainError {
  constructor(details: { collectionId: string; reason: string }) {
    super(
      "COLLECTION_SETTLEMENT_INVALID",
      `the settlement on collection ${details.collectionId} is refused: ${details.reason}`,
      details,
    );
  }
}

// ── the incoterms plane (T-08 — the registry + BR-106's mandate) ────────────

export class IncotermRecordNotFoundError extends DomainError {
  constructor(details: { code: string }) {
    super(
      "INCOTERM_RECORD_NOT_FOUND",
      `incoterm ${details.code} does not exist in this tenant's registry`,
      details,
    );
  }
}

/** The (tenant, code) natural key is unique (the 0120 uq) — the
 * tenant-addition write refuses BY NAME before the DB floor. */
export class IncotermDuplicateError extends DomainError {
  constructor(details: { code: string }) {
    super(
      "INCOTERM_DUPLICATE",
      `an incoterm coded ${details.code} already exists in this tenant's registry (the (tenant, code) key is unique — uq_incoterms_tenant_code)`,
      details,
    );
  }
}

/** The registry write's own floor (the 0120 CHECK shapes — the code
 * pattern and the bilingual name floors, re-surfaced typed). */
export class IncotermInvalidError extends DomainError {
  constructor(details: { field: string; reason: string }) {
    super("INCOTERM_INVALID", `the incoterm write is refused at ${details.field}: ${details.reason}`, details);
  }
}

/** The code is the row's identity — a PATCH never rewrites it (the
 * register's audit-trail law, the 0120 uq's own reading). */
export class IncotermCodeFrozenError extends DomainError {
  constructor(details: { code: string; attempted: string }) {
    super(
      "INCOTERM_CODE_FROZEN",
      `an incoterm's code is its identity — ${details.code} cannot become ${details.attempted} (create a new row and retire the old one)`,
      details,
    );
  }
}

/** The inactive code's selection refusal (the selector's own floor —
 * a retired code never rides a new order; existing orders keep their
 * recorded selection, the snapshot semantics). */
export class IncotermInactiveError extends DomainError {
  constructor(details: { code: string }) {
    super(
      "INCOTERM_INACTIVE",
      `incoterm ${details.code} is retired in this tenant's registry — select an active term (existing orders keep their recorded selection)`,
      details,
    );
  }
}

/**
 * BR-106'S MANDATE REFUSAL (the typed refusal at the order's OWN
 * POSTING, naming the order + the missing field — D-10's own wording;
 * the trigger arms rendered VERBATIM from the fold's verdict). The
 * class is thrown by the shared order gate consumed by the purchasing
 * and sales issue acts (the documented contract) — the reservation
 * law rides the wording: BR-106 exactly, no invented identifier.
 */
export class OrderIncotermRequiredError extends DomainError {
  constructor(details: {
    docType: "purchase_order" | "sales_order";
    orderId: string;
    orderNo: string | null;
    currency: string;
    baseCurrency: string;
    tradeDirection: "IMPORT" | "EXPORT" | null;
    arms: readonly string[];
  }) {
    const number = details.orderNo ?? details.orderId;
    super(
      "ORDER_INCOTERM_REQUIRED",
      `${details.docType} ${number} must post WITH an incoterm (BR-106): ${details.arms.join("; ")} — the incotermCode field is missing (the selection rides the order's create; re-create the order with its incoterm)`,
      details,
    );
  }
}
