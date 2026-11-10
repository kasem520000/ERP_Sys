import { DomainError } from "@erp/domain-core";

/**
 * PHASE-017 distribution module domain errors (T7/T8). Codes are stable API
 * contracts (ERROR_MODEL §4) — the HTTP layer maps each to its status;
 * A7-sensitive not-founds render identically for unknown-vs-foreign ids.
 *
 * Planning-only guard (CAPABILITY_MATRIX §2.4): routes and visits are
 * planning data — they NEVER post journals; PlanningDataError is the typed
 * rejection for composition/date inputs that would make the plan
 * unsound. Money values travel as canonical decimal strings (ADR-0009).
 */

// -- routes (T7; planning-only — drives no posting) -------------------------------

export class RouteNotFoundError extends DomainError {
  constructor(id: string) {
    super("ROUTE_NOT_FOUND", `route ${id} does not exist in this tenant`);
  }
}
export class RouteCodeDuplicateError extends DomainError {
  constructor(code: string) {
    super("ROUTE_CODE_TAKEN", `route code ${code} is already in use in this tenant`);
  }
}
/** The route-planning data itself is unsound (day pattern, composition,
 * weekday, or a dangling rep reference) — the plan is rejected before any
 * route_visits row exists. */
export class PlanningDataError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("ROUTE_PLANNING_INVALID", message, details);
  }
}

// -- visits (T7) ------------------------------------------------------------------

export class VisitNotFoundError extends DomainError {
  constructor(id: string) {
    super("VISIT_NOT_FOUND", `route visit ${id} does not exist in this tenant`);
  }
}
export class VisitStateError extends DomainError {
  constructor(message: string) {
    super("VISIT_STATE", message);
  }
}
/** A completion link referenced a document that does not exist in this
 * tenant (sales invoice / credit note / receipt). */
export class VisitDocumentNotFoundError extends DomainError {
  constructor(kind: "salesInvoiceId" | "creditNoteId" | "receiptId", id: string) {
    super(
      "VISIT_DOCUMENT_NOT_FOUND",
      `visit completion link ${kind} ${id} does not exist in this tenant`,
      { kind, id },
    );
  }
}

// -- vans / van stock (T8) --------------------------------------------------------

export class VanNotFoundError extends DomainError {
  constructor(id: string) {
    super("VAN_NOT_FOUND", `van warehouse ${id} does not exist (or is not a VAN-type warehouse)`);
  }
}
/** A van warehouse with this code already exists (uq_warehouses_tenant_code). */
export class VanCodeDuplicateError extends DomainError {
  constructor(code: string) {
    super("VAN_CODE_TAKEN", `warehouse code ${code} is already in use in this tenant`);
  }
}
/** The rep↔van binding is invalid: unknown/inactive rep, or the rep is
 * already bound to another van (uq_warehouses_tenant_rep — one van per rep). */
export class VanRepBindingError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("VAN_REP_BINDING", message, details);
  }
}
/** A van load-out / unload / receive operation is structurally invalid
 * (inactive van, source ≡ destination, empty lines, transfer not addressed
 * to a van). The stock transfer itself stays owned by TransferService. */
export class LoadOutError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("VAN_LOAD_OUT", message, details);
  }
}

// -- rep settlements (T10; STL- documents; BR-021 variance always posts) ------------

export class SettlementNotFoundError extends DomainError {
  constructor(id: string) {
    super("SETTLEMENT_NOT_FOUND", `rep settlement ${id} does not exist in this tenant`);
  }
}
/** A settlement lifecycle/state violation: wrong-status transition, invalid
 * input at open (unknown/inactive rep, non-CASH account, negative amounts),
 * a deposit shape that cannot post, or a re-post of an already-POSTED
 * settlement (typed rejection — corrections are new documents). */
export class SettlementStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SETTLEMENT_STATE", message, details);
  }
}
/** A non-zero variance was counted without a reason — BR-021 documents
 * every variance (ck_rep_settlements_variance_reason enforces it too). */
export class SettlementVarianceReasonRequiredError extends DomainError {
  constructor(details: {
    variance: string;
    direction: "SHORTAGE" | "SURPLUS";
    tolerance: string;
    withinTolerance: boolean;
  }) {
    super(
      "SETTLEMENT_VARIANCE_REASON_REQUIRED",
      `settlement variance ${details.variance} (${details.direction}) requires a varianceReason`,
      details,
    );
  }
}
/** The settlement cannot post without a separate approver — the variance is
 * beyond the tenant tolerance, or an active single-approver policy on
 * rep_settlement forces the hop (BR-021/BR-034). */
export class SettlementApprovalRequiredError extends DomainError {
  constructor(details: { variance: string; tolerance: string; policyRequired: boolean }) {
    super(
      "SETTLEMENT_APPROVAL_REQUIRED",
      "the settlement needs approval before posting (beyond-tolerance variance or an active approval policy)",
      details,
    );
  }
}
/** The rep's day still holds DRAFT/PENDING_APPROVAL documents — the
 * settlement cannot close over unsynced/pending work (§2 item 7). */
export class SettlementPendingDocumentsError extends DomainError {
  constructor(counts: { salesInvoices: number; creditNotes: number; receipts: number }) {
    super(
      "SETTLEMENT_PENDING_DOCUMENTS",
      "the rep's day still has draft/pending documents — post or cancel them before settling",
      counts,
    );
  }
}
/** BR-034: the settlement's creator cannot also approve it. */
export class SettlementSelfApprovalError extends DomainError {
  constructor(id: string) {
    super(
      "SETTLEMENT_SELF_APPROVAL",
      `settlement ${id} cannot be approved by its creator (BR-034: creator ≠ approver)`,
    );
  }
}
/** The rep's day is locked: a live (non-CANCELLED) settlement already exists
 * for (rep, date) — uq_rep_settlements_rep_day — or the settlement is
 * POSTED and immutable (corrections are new documents). */
export class SettlementDayLockedError extends DomainError {
  constructor(details: {
    salesRepId: string;
    settlementDate: string;
    settlementId?: string;
    status?: string;
  }) {
    super(
      "SETTLEMENT_DAY_LOCKED",
      `the rep's day ${details.settlementDate} is already settled${details.status === "POSTED" ? " and POSTED (immutable — corrections are new documents)" : ""}`,
      details,
    );
  }
}

// -- customer tiers (T11; BR-003 tier price lists) ---------------------------------

export class TierNotFoundError extends DomainError {
  constructor(id: string) {
    super("TIER_NOT_FOUND", `customer tier ${id} does not exist in this tenant`);
  }
}
/** uq_customer_tiers_tenant_code — tier codes are tenant-unique. */
export class TierCodeDuplicateError extends DomainError {
  constructor(code: string) {
    super("TIER_CODE_TAKEN", `customer tier code ${code} is already in use in this tenant`);
  }
}
/** A tier's price-list reference is unusable: unknown list, wrong kind
 * (only SALE lists price customers), or the list is inactive. */
export class TierPriceListInvalidError extends DomainError {
  constructor(message: string) {
    super("TIER_PRICE_LIST_INVALID", message);
  }
}
/** Tier input beyond the price-list reference is unsound (discount cap
 * outside 0..100, negative visit frequency) — the typed rejection that
 * keeps TierPriceListInvalidError price-list-shaped. */
export class TierInvalidError extends DomainError {
  constructor(message: string) {
    super("TIER_INVALID", message);
  }
}

// -- free goods rules (T11; BR-008 zero-price FOC lines) ---------------------------

export class FreeGoodsRuleNotFoundError extends DomainError {
  constructor(id: string) {
    super("FREE_GOODS_RULE_NOT_FOUND", `free-goods rule ${id} does not exist in this tenant`);
  }
}
/** uq_free_goods_rules_tenant_code — rule codes are tenant-unique. */
export class FreeGoodsRuleCodeDuplicateError extends DomainError {
  constructor(code: string) {
    super("FREE_GOODS_RULE_CODE_TAKEN", `free-goods rule code ${code} is already in use in this tenant`);
  }
}
/** The rule data itself is unsound: buy/get quantities ≤ 0, dangling item
 * or tier references, an inverted validity window, an unusable max-free
 * cap, or a missing/oversized reason code (BR-008 requires the reason). */
export class FreeGoodsRuleInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("FREE_GOODS_RULE_INVALID", message, details);
  }
}
