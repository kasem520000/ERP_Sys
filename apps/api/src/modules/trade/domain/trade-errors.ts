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

// ── the transport + tracking plane (T-09 + T-13 — 0120/0122) ───────────────

export class BlRecordNotFoundError extends DomainError {
  constructor(details: { blId: string }) {
    super(
      "BL_RECORD_NOT_FOUND",
      `bill of lading ${details.blId} does not exist in this tenant`,
      details,
    );
  }
}

/** The (tenant, bl_no) natural key is unique (the 0120 uq) — the
 * service refuses BY NAME before the DB floor. */
export class BlDuplicateError extends DomainError {
  constructor(details: { blNo: string }) {
    super(
      "BL_DUPLICATE",
      `a bill of lading numbered ${details.blNo} already exists in this tenant (the (tenant, bl_no) key is unique — uq_bills_of_lading_tenant_no)`,
      details,
    );
  }
}

export class PackingListRecordNotFoundError extends DomainError {
  constructor(details: { plId: string }) {
    super(
      "PACKING_LIST_RECORD_NOT_FOUND",
      `packing list ${details.plId} does not exist in this tenant`,
      details,
    );
  }
}

export class PackingListDuplicateError extends DomainError {
  constructor(details: { plNo: string }) {
    super(
      "PACKING_LIST_DUPLICATE",
      `a packing list numbered ${details.plNo} already exists in this tenant (the (tenant, pl_no) key is unique — uq_packing_lists_tenant_no)`,
      details,
    );
  }
}

/** The transport documents' input floor (the 0120 CHECK shapes — the
 * multimodal doc types, the bilingual names, the container refs, the
 * pack lines' physical law) re-surfaced typed. */
export class TransportInputInvalidError extends DomainError {
  constructor(details: { field: string; reason: string }) {
    super(
      "TRANSPORT_INPUT_INVALID",
      `the transport document write is invalid at ${details.field}: ${details.reason}`,
      details,
    );
  }
}

/** The tracking event's own floor (T-13 — the milestone vocabulary
 * (D-14's unknown-event typed refusal) + the event shapes + the
 * declaration link's typed 404 face). */
export class TrackingEventInvalidError extends DomainError {
  constructor(details: { field: string; reason: string }) {
    super(
      "TRACKING_EVENT_INVALID",
      `the tracking event is refused at ${details.field}: ${details.reason}`,
      details,
    );
  }
}

/** The event's declaration-link probe (the typed 404 — the read-only
 * documented contract; the declarations ENGINE is W-37's own wave). */
export class DeclarationLinkNotFoundError extends DomainError {
  constructor(details: { declarationId: string; blId: string }) {
    super(
      "DECLARATION_LINK_NOT_FOUND",
      `customs declaration ${details.declarationId} (linked by the event on B/L ${details.blId}) does not exist in this tenant`,
      details,
    );
  }
}

// ── the customs plane (T-10 — the declarations + lines + the G-65 flow) ─────

export class DeclarationRecordNotFoundError extends DomainError {
  constructor(details: { declarationId: string }) {
    super(
      "DECLARATION_RECORD_NOT_FOUND",
      `customs declaration ${details.declarationId} does not exist in this tenant`,
      details,
    );
  }
}

/** The (tenant, declaration_no) natural key is unique (the 0121 uq) —
 * the service refuses BY NAME before the DB floor. */
export class DeclarationDuplicateError extends DomainError {
  constructor(details: { declarationNo: string }) {
    super(
      "DECLARATION_DUPLICATE",
      `a declaration numbered ${details.declarationNo} already exists in this tenant (the (tenant, declaration_no) key is unique — uq_customs_declarations_tenant_no)`,
      details,
    );
  }
}

/** THE LADDER'S OWN REFUSAL (the 0121 stamp law's fold — DRAFT →
 * SUBMITTED → ACCEPTED → COMPLETED | CANCELLED; the typed refusal
 * names the register and the illegal move's reason: the empty-lines
 * floor at submission, the stamp law's monotone evidence). */
export class DeclarationStateError extends DomainError {
  constructor(details: {
    declarationId: string;
    declarationNo: string;
    from: string;
    to: string;
    reason: string;
  }) {
    super(
      "DECLARATION_STATE",
      `declaration ${details.declarationNo} is ${details.from} — ${details.reason} (the move to ${details.to} is refused)`,
      details,
    );
  }
}

/** The declaration's line-shape floor (the 0121 CHECKs' caller-side
 * face: the HS code pattern, the amounts' non-negativity — the FOLD's
 * verdict rendered VERBATIM, D-06's own demand). */
export class DeclarationLineInvalidError extends DomainError {
  constructor(details: { field: string; reason: string }) {
    super(
      "DECLARATION_LINE_INVALID",
      `the declaration line is refused at ${details.field}: ${details.reason}`,
      details,
    );
  }
}

/**
 * INV-036'S COMPLETENESS REFUSALS (D-07's own wordings — the honest
 * interpretation: a customs-duty landed-cost allocation on an import
 * receipt REQUIRES a COMPLETED declaration reference): the typed
 * refusal names the receipt and the declaration's own state, with
 * ZERO residue (the refused allocation stays a draft, nothing posts).
 * The reservation law rides the wording: INV-036 exactly, no invented
 * identifier.
 */
export class DeclarationRequiredError extends DomainError {
  constructor(details: { grnId: string; costType: string }) {
    super(
      "DECLARATION_REQUIRED",
      `the ${details.costType} landed-cost allocation on goods receipt ${details.grnId} requires a COMPLETED customs declaration reference (INV-036 — declaration completeness): no declaration references this receipt`,
      details,
    );
  }
}

export class DeclarationIncompleteError extends DomainError {
  constructor(details: { grnId: string; declarationId: string; declarationNo: string; status: string }) {
    super(
      "DECLARATION_INCOMPLETE",
      `the customs landed-cost allocation on goods receipt ${details.grnId} requires a COMPLETED customs declaration reference (INV-036 — declaration completeness): declaration ${details.declarationNo} is ${details.status}`,
      details,
    );
  }
}

/** The line-level tie's exactness laws (D-06 — «every allocated duty
 * tied to its declaration line»; the tie map's resolution demands:
 * every declaration line item-bearing, one line per item, the GRN's
 * stock lines covered). The declared interpretation #5, recorded at
 * the claim sites. */
export class DeclarationLineTieInvalidError extends DomainError {
  constructor(details: { declarationNo: string; reason: string }) {
    super(
      "DECLARATION_LINE_TIE_INVALID",
      `the declaration ${details.declarationNo}'s line-level tie is refused: ${details.reason} (INV-036's own demand — every allocated duty tied to its declaration line)`,
      details,
    );
  }
}

/** G-65's own shape at the completion act: the landed-cost charge
 * account is the purpose-mapped CUSTOMS_DUTY_PAYABLE — fail-closed
 * until mapped (the 0122 §8 marker standing; the D-06 wording). */
export class CustomsPurposeNotMappedError extends DomainError {
  constructor(details: { declarationNo: string }) {
    super(
      "CUSTOMS_PURPOSE_NOT_MAPPED",
      `the customs duty payable account is not mapped for this tenant (declaration ${details.declarationNo}) — G-65's CR leg resolves the purpose-mapped CUSTOMS_DUTY_PAYABLE, fail-closed until mapped (map the 0122 §8 marker 2145 to an account)`,
      details,
    );
  }
}

/** The exactly-once source law (the 0125 partial unique's caller-side
 * face — ONE customs landed-cost document per declaration, ever:
 * INV-036's single-use at the relational floor). */
export class DeclarationLandedCostDuplicateError extends DomainError {
  constructor(details: { declarationNo: string; landedCostId: string }) {
    super(
      "DECLARATION_LANDED_COST_DUPLICATE",
      `declaration ${details.declarationNo} already sources customs landed-cost document ${details.landedCostId} (one customs landed cost per declaration, ever — uq_landed_costs_tenant_declaration, the INV-013-equivalent exactly-once)`,
      details,
    );
  }
}

// ── the HS registry plane (T-10 — the tenant-extensible starter set) ────────

export class HsCodeRecordNotFoundError extends DomainError {
  constructor(details: { hsCode: string }) {
    super(
      "HS_CODE_RECORD_NOT_FOUND",
      `HS code ${details.hsCode} does not exist in this tenant's registry`,
      details,
    );
  }
}

/** The (tenant, hs_code) natural key is unique (the 0121 uq) — the
 * tenant-addition write refuses BY NAME before the DB floor. */
export class HsCodeDuplicateError extends DomainError {
  constructor(details: { hsCode: string }) {
    super(
      "HS_CODE_DUPLICATE",
      `an HS code ${details.hsCode} already exists in this tenant's registry (the (tenant, hs_code) key is unique — uq_hs_code_registry_tenant_code)`,
      details,
    );
  }
}

/** The registry write's own floor (the 0121 CHECK shapes — the code
 * pattern and the bilingual name floors, re-surfaced typed). */
export class HsCodeInvalidError extends DomainError {
  constructor(details: { field: string; reason: string }) {
    super("HS_CODE_INVALID", `the HS registry write is refused at ${details.field}: ${details.reason}`, details);
  }
}

/** The code is the row's identity — a PATCH never rewrites it (the
 * register's audit-trail law, the 0121 uq's own reading). */
export class HsCodeFrozenError extends DomainError {
  constructor(details: { hsCode: string; attempted: string }) {
    super(
      "HS_CODE_FROZEN",
      `an HS code is its identity — ${details.hsCode} cannot become ${details.attempted} (create a new row and retire the old one)`,
      details,
    );
  }
}

// ── the bonded plane (T-11 — G-66/BR-107, the 0121 §4 register) ─────────────

export class BondedMoveRecordNotFoundError extends DomainError {
  constructor(details: { moveId: string }) {
    super(
      "BONDED_MOVE_RECORD_NOT_FOUND",
      `bonded warehouse move ${details.moveId} does not exist in this tenant`,
      details,
    );
  }
}

/** The (tenant, move_no) natural key is unique (the 0121 uq) — the
 * service refuses BY NAME before the DB floor. */
export class BondedMoveDuplicateError extends DomainError {
  constructor(details: { moveNo: string }) {
    super(
      "BONDED_MOVE_DUPLICATE",
      `a bonded warehouse move numbered ${details.moveNo} already exists in this tenant (the (tenant, move_no) key is unique — uq_bonded_warehouse_moves_tenant_no)`,
      details,
    );
  }
}

/** THE LADDER'S OWN REFUSAL (the 0121 execution stamp law — DRAFT →
 * EXECUTED, terminal; the typed refusal names the register and the
 * illegal move's reason: the line floors, the in-bond shape's own
 * laws, the release's source law). */
export class BondedMoveStateError extends DomainError {
  constructor(details: {
    moveId: string;
    moveNo: string;
    from: string;
    to: string;
    reason: string;
  }) {
    super(
      "BONDED_MOVE_STATE",
      `bonded move ${details.moveNo} is ${details.from} — ${details.reason} (the move to ${details.to} is refused)`,
      details,
    );
  }
}

/** The bonded lines' shape floor (the 0121 CHECKs' caller-side face:
 * the lines array's shape, the item/qty floors, the same-item pairs). */
export class BondedLineInvalidError extends DomainError {
  constructor(details: { field: string; reason: string }) {
    super(
      "BONDED_LINE_INVALID",
      `the bonded move line is refused at ${details.field}: ${details.reason}`,
      details,
    );
  }
}

/**
 * G-66's OWN STRUCTURAL FACE — THE SHARED GATE'S TYPED REFUSAL (D-08:
 * «the duty-suspended stock is BLOCKED from customer issue while
 * suspended»; the reservations law — NO new invariant identifier is
 * minted for the block: the restriction is G-66's own reserved
 * wording's structural face). The refusal names the stock + the bond
 * (the position, the suspended quantity, the bond ledger's own
 * figures).
 */
export class BondedStockSuspendedError extends DomainError {
  constructor(details: {
    itemId: string;
    warehouseId: string;
    suspendedQty: string;
    onHand: string;
  }) {
    super(
      "BONDED_STOCK_SUSPENDED",
      `item ${details.itemId} at warehouse ${details.warehouseId} carries ${details.suspendedQty} duty-suspended units in the customs bond (G-66 — the position is blocked from issue while suspended; on-hand ${details.onHand}) — release the bond first (the release recognizes the duty, BR-107)`,
      details,
    );
  }
}

/** BR-107's release-shape laws (D-08/D-11: the release-only trigger,
 * the declaration link, the exactly-once replay, the fail-closed
 * purpose). */
export class BondedReleaseShapeError extends DomainError {
  constructor(details: { moveNo: string; reason: string }) {
    super(
      "BONDED_RELEASE_SHAPE",
      `the release ${details.moveNo} is refused: ${details.reason} (BR-107 — the release recognizes the duty exactly once)`,
      details,
    );
  }
}

// ── the drawback plane (T-12 — BR-108, the 0121 §5 register) ────────────────

export class DrawbackClaimRecordNotFoundError extends DomainError {
  constructor(details: { claimId: string }) {
    super(
      "DRAWBACK_CLAIM_RECORD_NOT_FOUND",
      `duty drawback claim ${details.claimId} does not exist in this tenant`,
      details,
    );
  }
}

/** The (tenant, claim_no) natural key is unique (the 0121 uq) — the
 * service refuses BY NAME before the DB floor. */
export class DrawbackClaimDuplicateError extends DomainError {
  constructor(details: { claimNo: string }) {
    super(
      "DRAWBACK_CLAIM_DUPLICATE",
      `a drawback claim numbered ${details.claimNo} already exists in this tenant (the (tenant, claim_no) key is unique — uq_duty_drawback_claims_tenant_no)`,
      details,
    );
  }
}

/** THE WORKFLOW'S OWN REFUSAL (the 0121 stamp laws' fold — DRAFT →
 * SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED, APPROVED → PAID;
 * the typed refusal names the claim and the illegal move's reason). */
export class DrawbackClaimStateError extends DomainError {
  constructor(details: {
    claimId: string;
    claimNo: string;
    from: string;
    to: string;
    reason: string;
  }) {
    super(
      "DRAWBACK_CLAIM_STATE",
      `drawback claim ${details.claimNo} is ${details.from} — ${details.reason} (the move to ${details.to} is refused)`,
      details,
    );
  }
}

/**
 * BR-108'S EXPORT-EVIDENCE GATE (D-12's own wording): the claim's
 * submission requires the linked export evidence — the export
 * declaration OR the export bill of lading; the typed refusal names
 * the claim + the missing evidence (the 0121 evidence floor's
 * caller-side face).
 */
export class DrawbackEvidenceRequiredError extends DomainError {
  constructor(details: { claimNo: string }) {
    super(
      "DRAWBACK_EVIDENCE_REQUIRED",
      `drawback claim ${details.claimNo} cannot submit without linked export evidence (BR-108): link the export declaration or the export bill of lading first (the claim's own proof of export)`,
      details,
    );
  }
}
