import { DomainError } from "@erp/domain-core";

/**
 * PHASE-009 tax module domain errors. Codes are stable API contracts
 * (ERROR_MODEL §4) — the HTTP layer maps each to its status; A7-sensitive
 * not-founds render identically for unknown-vs-foreign ids (no existence
 * disclosure). Money values travel as canonical decimal strings (ADR-0009).
 */

// -- tax codes (T5) --------------------------------------------------------------

export class TaxCodeNotFoundError extends DomainError {
  constructor(id: string) {
    super("TAX_CODE_NOT_FOUND", `tax code ${id} does not exist in this tenant`);
  }
}
export class TaxCodeTakenError extends DomainError {
  constructor(details: { code: string; countryCode: string }) {
    super(
      "TAX_CODE_TAKEN",
      `tax code ${details.code} already exists for jurisdiction ${details.countryCode}`,
      details,
    );
  }
}
export class TaxCodeArchivedError extends DomainError {
  constructor(id: string) {
    super("TAX_CODE_ARCHIVED", `tax code ${id} is ARCHIVED and cannot be assigned to new documents`);
  }
}
export class TaxCodeInUseError extends DomainError {
  constructor(details: { id: string; items: number; categories: number }) {
    super(
      "TAX_CODE_IN_USE",
      `tax code ${details.id} is referenced by ${details.items} item(s) and ${details.categories} category(ies) — reassign them first`,
      details,
    );
  }
}
export class TaxCodeStatusInvalidError extends DomainError {
  constructor(message: string) {
    super("TAX_CODE_STATUS_INVALID", message);
  }
}

// -- registrations (T4) ----------------------------------------------------------

export class JurisdictionNotFoundError extends DomainError {
  constructor(countryCode: string) {
    super("JURISDICTION_NOT_FOUND", `jurisdiction pack ${countryCode} is not seeded`);
  }
}
export class RegistrationNumberRequiredError extends DomainError {
  constructor(countryCode: string) {
    super(
      "REGISTRATION_NUMBER_REQUIRED",
      `a registration number is required while ${countryCode} status is REGISTERED`,
    );
  }
}
export class RegistrationNumberNotAllowedError extends DomainError {
  constructor(countryCode: string) {
    super(
      "REGISTRATION_NUMBER_NOT_ALLOWED",
      `a registration number is only valid while ${countryCode} status is REGISTERED`,
    );
  }
}
export class RegistrationDeregisteredShapeError extends DomainError {
  constructor(message: string) {
    super("REGISTRATION_DEREGISTERED_SHAPE_INVALID", message);
  }
}

// -- resolution (T3) --------------------------------------------------------------

/** The fail-closed boundary error: no asserted rate covers the document date. */
export class NoRateForDateError extends DomainError {
  constructor(details: { countryCode: string; treatment: string; documentDate: string }) {
    super(
      "NO_RATE_FOR_DATE",
      `no seeded rate row covers ${details.treatment} in ${details.countryCode} at ${details.documentDate} — the compliance file records no rate for that window (fail-closed, never guessed)`,
      details,
    );
  }
}
export class TaxLineInvalidError extends DomainError {
  constructor(message: string) {
    super("TAX_LINE_INVALID", message);
  }
}
export class PricingModeInvalidError extends DomainError {
  constructor(message: string) {
    super("PRICING_MODE_INVALID", message);
  }
}
export class CurrencyMinorUnitsUnknownError extends DomainError {
  constructor(currencyCode: string) {
    super(
      "CURRENCY_MINOR_UNITS_UNKNOWN",
      `currency ${currencyCode} has no seeded minor-unit precision (ADR-0009 rounding needs it)`,
    );
  }
}

// -- VAT returns (T9) -------------------------------------------------------------

export class VatReturnNotFoundError extends DomainError {
  constructor(id: string) {
    super("VAT_RETURN_NOT_FOUND", `VAT return ${id} does not exist in this tenant`);
  }
}
export class VatReturnWindowTakenError extends DomainError {
  constructor(details: { countryCode: string; periodStart: string; periodEnd: string }) {
    super(
      "VAT_RETURN_WINDOW_TAKEN",
      `a return for ${details.countryCode} ${details.periodStart}..${details.periodEnd} already exists`,
      details,
    );
  }
}
export class VatReturnCrossCheckFailedError extends DomainError {
  constructor(details: { outputDiff: string; inputDiff: string; expensedDiff: string }) {
    super(
      "VAT_RETURN_CROSS_CHECK_FAILED",
      `INV-012 cross-check failed — output diff ${details.outputDiff}, input diff ${details.inputDiff}, expensed diff ${details.expensedDiff}; ready-to-file is blocked until both sides agree`,
      details,
    );
  }
}
export class VatReturnStateError extends DomainError {
  constructor(message: string) {
    super("VAT_RETURN_STATE_INVALID", message);
  }
}
export class VatReturnAlreadyFiledError extends DomainError {
  constructor(id: string) {
    super("VAT_RETURN_ALREADY_FILED", `VAT return ${id} is FILED and immutable (audit preserves the filing metadata)`);
  }
}

// -- packs (T13) -------------------------------------------------------------------

export class PackBindingInvalidError extends DomainError {
  constructor(message: string) {
    super("PACK_BINDING_INVALID", message);
  }
}

// -- e-invoicing (T10) --------------------------------------------------------------

/** RISK-005: unverified regimes refuse submission — explicit stub behavior. */
export class UnverifiedRegimeError extends DomainError {
  constructor(details: { countryCode: string; adapterId: string; verificationStatus: string }) {
    super(
      "UNVERIFIED_REGIME",
      `e-invoicing submission refused: the ${details.countryCode} regime facts are ${details.verificationStatus} — adapters refuse until the compliance-matrix verification completes (RISK-005; PHASE-023)`,
      details,
    );
  }
}
export class EInvoicingSubmissionNotFoundError extends DomainError {
  constructor(id: string) {
    super("E_INVOICING_SUBMISSION_NOT_FOUND", `e-invoicing submission ${id} does not exist in this tenant`);
  }
}
export class EInvoicingStateError extends DomainError {
  constructor(message: string) {
    super("E_INVOICING_STATE_INVALID", message);
  }
}
export class AdapterNotFoundError extends DomainError {
  constructor(adapterId: string) {
    super("ADAPTER_NOT_FOUND", `no e-invoicing adapter registered under id ${adapterId}`);
  }
}
