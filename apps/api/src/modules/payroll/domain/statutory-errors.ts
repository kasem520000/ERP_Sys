import { DomainError } from "@erp/domain-core";

/**
 * PHASE-046 statutory-compliance domain errors (W-2, T-03/T-04/T-06 —
 * the payroll-native taxonomy's statutory extension; PHASE-006 error
 * taxonomy: stable codes, HTTP mapping registered in-phase in
 * error.filter.ts per the SF-027-001 lesson). Codes follow the
 * payroll-errors precedent: typed 404s never disclose foreign existence
 * (A7 — RLS makes unknown and foreign ids indistinguishable); lifecycle
 * conflicts 409; validation/fail-closed refusals 422.
 *
 * BR-085 — THE VERIFICATION GATE: a REQUIRES_VERIFICATION row is a typed
 * refusal, never a guessed rate (the BR-055 no-fabrication law extended
 * to statutory facts). BR-087 — the EOSB delta-only true-up. D-02 — the
 * NULL-nationality fail-closed law.
 */

// -- 404 not-found (A7 parity: unknown == foreign) --------------------------------

/** Foreign/unknown statutory profile id — typed 404. */
export class StatutoryProfileNotFoundError extends DomainError {
  constructor(id: string) {
    super("STATUTORY_PROFILE_NOT_FOUND", `Statutory profile ${id} not found`, { id });
  }
}

/** Foreign/unknown PIT bracket row id — typed 404. */
export class PitBracketNotFoundError extends DomainError {
  constructor(id: string) {
    super("PIT_BRACKET_NOT_FOUND", `PIT bracket ${id} not found`, { id });
  }
}

/** Foreign/unknown EOSB rule id — typed 404. */
export class EosbRuleNotFoundError extends DomainError {
  constructor(id: string) {
    super("EOSB_RULE_NOT_FOUND", `EOSB rule ${id} not found`, { id });
  }
}

/** Foreign/unknown EOSB calculation id — typed 404. */
export class EosbCalculationNotFoundError extends DomainError {
  constructor(id: string) {
    super("EOSB_CALCULATION_NOT_FOUND", `EOSB calculation ${id} not found`, { id });
  }
}

// -- 422 fail-closed refusals (BR-085 + the resolution laws) ----------------------

/** A REQUIRES_VERIFICATION row refused the computation — BR-085's typed
 * gate (never a guessed rate). Carries the row's jurisdiction + code and
 * the honest blocked-state surface. */
export class StatutoryRequiresVerificationError extends DomainError {
  constructor(details: {
    jurisdictionCode: string;
    code: string;
    kind: "CONTRIBUTION_PROFILE" | "PIT_BRACKET" | "EOSB_RULE";
    reviewNote?: string | null;
  }) {
    super(
      "STATUTORY_REQUIRES_VERIFICATION",
      `Statutory ${details.kind.toLowerCase().replace(/_/g, " ")} ${details.jurisdictionCode}/${details.code} requires verification before it can price (BR-085)${details.reviewNote ? `: ${details.reviewNote}` : ""}`,
      details,
    );
  }
}

/** The bracket SET is inconsistent (a floor above a ceiling, a gap, an
 * overlap, or the set-level allowance fields disagree inside one
 * (jurisdiction, effective window) group — D-03's SET-CONSISTENT law). */
export class PitBracketSetInvalidError extends DomainError {
  constructor(details: { jurisdictionCode: string; code: string; reason: string }) {
    super(
      "PIT_BRACKET_SET_INVALID",
      `PIT bracket set ${details.jurisdictionCode}/${details.code} is invalid: ${details.reason}`,
      details,
    );
  }
}

/** No EOSB rule matches the calculation request (no tier covers the
 * service years, or the contract-type/effective filters exclude every
 * row) — fail-closed, never a guessed tier. */
export class EosbNoRuleError extends DomainError {
  constructor(details: {
    jurisdictionCode: string;
    serviceYears: string;
    contractType?: string | null;
    onDate: string;
  }) {
    super(
      "EOSB_NO_RULE",
      `No EOSB rule covers ${details.serviceYears} service years in ${details.jurisdictionCode} on ${details.onDate}${details.contractType ? ` (contract ${details.contractType})` : ""}`,
      details,
    );
  }
}

/** The employee's nationality is NULL (D-02's fail-closed law): the
 * CITIZEN/NON_CITIZEN split cannot be resolved — NO statutory lines and
 * the explicit warning; this error is the service-level refusal shape
 * for callers that demand a hard stop (the run surfaces the warning
 * instead; both never price a guessed rate). */
export class StatutoryNationalityUnresolvedError extends DomainError {
  constructor(details: { employeeId: string; jurisdictionCode: string }) {
    super(
      "STATUTORY_NATIONALITY_UNRESOLVED",
      `Employee ${details.employeeId} carries no nationality — the ${details.jurisdictionCode} citizen/non-citizen split cannot be resolved (D-02 fail-closed; set employees.nationality)`,
      details,
    );
  }
}

/** An EOSB true-up was requested in a shape the law refuses (e.g. a
 * TERMINATION true-up for an ACTIVE employee, or a period true-up
 * against a settled employee — BR-087's guards). */
export class EosbTrueUpInvalidError extends DomainError {
  constructor(details: { employeeId: string; kind: string; reason: string }) {
    super(
      "EOSB_TRUE_UP_INVALID",
      `EOSB ${details.kind} true-up for employee ${details.employeeId} refused: ${details.reason}`,
      details,
    );
  }
}

// -- 409 lifecycle conflicts ------------------------------------------------------

/** The verify CAS conflict — the row is already VERIFIED (one verify per
 * row; the loser of a concurrent verify pair gets the typed 409). */
export class StatutoryAlreadyVerifiedError extends DomainError {
  constructor(details: { id: string; code: string; verifiedBy: string | null }) {
    super(
      "STATUTORY_ALREADY_VERIFIED",
      `Statutory profile ${details.code} is already verified${details.verifiedBy ? ` (by ${details.verifiedBy})` : ""}`,
      details,
    );
  }
}

/** The SoD law (D-10): the verifier may not be the row's last editor —
 * the separation-of-duties refusal. */
export class StatutoryVerifySoDError extends DomainError {
  constructor(details: { id: string; actorId: string; lastEditedBy: string | null }) {
    super(
      "STATUTORY_VERIFY_SOD",
      `Actor ${details.actorId} cannot verify a row they last edited (SoD — the verifier ≠ the last editor, D-10)`,
      details,
    );
  }
}
