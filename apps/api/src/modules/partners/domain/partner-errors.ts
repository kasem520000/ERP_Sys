import { DomainError } from "@erp/domain-core";

/**
 * Partners error registry (ERROR_MODEL §4: module-scoped codes are contracts).
 * HTTP mapping in the exception filter: 404 not-found, 409 natural-key
 * conflicts, 422 rule violations.
 */

export class PartnerNotFoundError extends DomainError {
  constructor(id: string) {
    super("PARTNER_NOT_FOUND", `partner ${id} does not exist in this tenant`);
  }
}

export class PartnerCodeTakenError extends DomainError {
  constructor(code: string) {
    super("PARTNER_CODE_TAKEN", `partner code ${code} is already used in this tenant`);
  }
}

/** BR-025: kind changes only while the partner has no postings. */
export class PartnerKindChangeForbiddenError extends DomainError {
  constructor() {
    super(
      "PARTNER_KIND_IMMUTABLE",
      "partner kind changes are only allowed while the partner has no postings (BR-025)",
    );
  }
}

export class PartnerArchivedError extends DomainError {
  constructor(id: string) {
    super("PARTNER_ARCHIVED", `partner ${id} is archived`);
  }
}

export class PartnerInvalidTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super("INVALID_TRANSITION", `cannot move partner from ${from} to ${to}`);
  }
}

// -- credit terms (BR-026: changes affect new documents only) --------------

export class CreditTermsNotFoundError extends DomainError {
  constructor(id: string) {
    super("CREDIT_TERMS_NOT_FOUND", `credit terms ${id} do not exist in this tenant`);
  }
}

export class CreditTermsCodeTakenError extends DomainError {
  constructor(code: string) {
    super("CREDIT_TERMS_CODE_TAKEN", `credit terms code ${code} is already used in this tenant`);
  }
}

export class SystemCreditTermsImmutableError extends DomainError {
  constructor(code: string) {
    super(
      "SYSTEM_CREDIT_TERMS_IMMUTABLE",
      `credit terms ${code} are a system seed row — extend with a custom code instead`,
    );
  }
}

/** S-04: foreign-tenant price-list references stay indistinguishable from
 * unknown ids (no existence disclosure; stable code shared with items). */
export class PriceListNotFoundError extends DomainError {
  constructor(id: string) {
    super("PRICE_LIST_NOT_FOUND", `price list ${id} does not exist in this tenant`);
  }
}

// -- opening-balance drafts (PHASE-006 §2.5; status DRAFT only) -------------

export class OpeningBalanceDraftError extends DomainError {
  constructor(message: string) {
    super("OPENING_BALANCE_INVALID", message);
  }
}

export class OpeningBalanceDraftExistsError extends DomainError {
  constructor(target: string) {
    super(
      "OPENING_BALANCE_DUPLICATE",
      `a DRAFT opening balance already exists for ${target} — one draft per target`,
    );
  }
}

// -- attachments (U-01…U-07; shared with items) ------------------------------

export class AttachmentOwnerNotFoundError extends DomainError {
  constructor(ownerType: string, ownerId: string) {
    super("ATTACHMENT_OWNER_NOT_FOUND", `attachment owner ${ownerType} ${ownerId} does not exist`);
  }
}

export class AttachmentNotFoundError extends DomainError {
  constructor(id: string) {
    super("ATTACHMENT_NOT_FOUND", `attachment ${id} does not exist in this tenant`);
  }
}
