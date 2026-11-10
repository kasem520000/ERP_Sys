import { DomainError } from "@erp/domain-core";

/**
 * Notes-module domain errors (PHASE-027; PHASE-006 error taxonomy — stable
 * codes, bilingual where user-facing, HTTP mapping in the global filter's
 * domainStatus — registered in-phase, see error.filter.ts). Codes follow the
 * fixed_assets precedent: typed 404s never disclose foreign existence (A7 —
 * RLS makes unknown and foreign ids indistinguishable); lifecycle conflicts
 * 409; validation 422.
 */

// -- 404 not-found (A7 parity: unknown == foreign) --------------------------------

/** Foreign/unknown note id — typed 404 (spoof battery asserts this shape). */
export class NoteNotFoundError extends DomainError {
  constructor(id: string) {
    super("NOTE_NOT_FOUND", `Note ${id} not found`, { id });
  }
}

/** Foreign/unknown partner — typed 404 (the fixed_assets PARTNER_NOT_FOUND mirror). */
export class NotePartnerNotFoundError extends DomainError {
  constructor(id: string) {
    super("PARTNER_NOT_FOUND", `Partner ${id} not found`, { id });
  }
}

/** Foreign/unknown/unsuitable source invoice — typed 404 (S-04 spoof row). */
export class NoteSourceInvalidError extends DomainError {
  constructor(details: {
    sourceType: string;
    sourceId: string;
    reason: string;
  }) {
    super(
      "NOTE_SOURCE_INVALID",
      `Source ${details.sourceType} ${details.sourceId} is not a settleable document: ${details.reason}`,
      details,
    );
  }
}

/** Foreign/unknown treasury cash account — typed 404. */
export class NoteCashAccountNotFoundError extends DomainError {
  constructor(id: string) {
    super("CASH_ACCOUNT_NOT_FOUND", `Cash account ${id} not found`, { id });
  }
}

// -- 409 lifecycle conflicts ------------------------------------------------------

/**
 * Duplicate resolution attempt (the same money event twice — INV-013
 * flavor): the note already carries the target status of THIS event; the
 * engine-level idempotent replay converges, the state machine blocks the
 * second business action.
 */
export class NoteAlreadyResolvedError extends DomainError {
  constructor(details: { noteId: string; eventKind: string; status: string }) {
    super(
      "ALREADY_POSTED",
      `Note ${details.noteId} is already ${details.status} — the ${details.eventKind} event already ran (INV-013)`,
      details,
    );
  }
}

// -- 422 validation ---------------------------------------------------------------

/** Illegal custody transition (BR-047 machine + phase §6 failure pack). */
export class InvalidCustodyTransitionError extends DomainError {
  constructor(details: { noteId: string; eventKind: string; from: string; direction: string }) {
    super(
      "INVALID_CUSTODY_TRANSITION",
      `Event ${details.eventKind} is not legal from status ${details.from} (direction ${details.direction})`,
      details,
    );
  }
}

/** BR-046: the dishonor reason is required. */
export class DishonorReasonRequiredError extends DomainError {
  constructor(noteId: string) {
    super(
      "DISHONOR_REASON_REQUIRED",
      `Dishonor of note ${noteId} requires a reason (BR-046)`,
      { noteId },
    );
  }
}

/**
 * A foreign note's rate must equal the open item's original stored rate
 * (INV-008): the note settles the item at the item's rate; FX movement
 * accrues to collection (G-25) — never recomputed at receipt.
 */
export class NoteRateMismatchError extends DomainError {
  constructor(details: { noteId: string; noteRate: string; itemRate: string }) {
    super(
      "NOTE_RATE_MISMATCH",
      `Note ${details.noteId} (rate ${details.noteRate}) must match the open item's original stored rate ${details.itemRate} (INV-008 — settle at the item rate; FX accrues at collection)`,
      details,
    );
  }
}

/** The note currency must equal the source invoice currency. */
export class NoteCurrencyMismatchError extends DomainError {
  constructor(details: { noteCurrency: string; itemCurrency: string }) {
    super(
      "NOTE_CURRENCY_MISMATCH",
      `Note currency ${details.noteCurrency} must match the source item currency ${details.itemCurrency}`,
      details,
    );
  }
}

/** A money leg needs a treasury cash account (stored at DEPOSIT or passed). */
export class NoteAccountRequiredError extends DomainError {
  constructor(details: { noteId: string; action: string }) {
    super(
      "NOTE_ACCOUNT_REQUIRED",
      `Action ${details.action} on note ${details.noteId} requires a treasury cash account (pass cashAccountId or deposit first)`,
      details,
    );
  }
}

/** Discount fee bounds (fee ≥ 0, fee ≤ note amount; proceeds ≥ 0). */
export class NoteFeeInvalidError extends DomainError {
  constructor(details: { noteId: string; fee: string; amount: string }) {
    super(
      "NOTE_FEE_INVALID",
      `Fee ${details.fee} on note ${details.noteId} is invalid (0 ≤ fee ≤ ${details.amount})`,
      details,
    );
  }
}

/**
 * Discounting is base-currency-only in this phase (the phase doc pins the
 * G-discount shape without FX semantics — collect or return a foreign note
 * instead; honest deferral, documented in JOURNAL_RULES §7).
 */
export class NoteDiscountCurrencyUnsupportedError extends DomainError {
  constructor(details: { noteId: string; currency: string; base: string }) {
    super(
      "NOTE_DISCOUNT_CURRENCY_UNSUPPORTED",
      `Discounting a ${details.currency} note is not supported in this phase (base ${details.base} only) — collect at maturity or return it`,
      details,
    );
  }
}

/** Substantive fields are immutable after create (reclassify is metadata-only). */
export class NoteFieldsImmutableError extends DomainError {
  constructor(details: { noteId: string; fields: string[] }) {
    super(
      "NOTE_FIELDS_IMMUTABLE",
      `Fields ${details.fields.join(", ")} on note ${details.noteId} are immutable after create (RECLASSIFY covers metadata only — number/issuing bank/maturity/notes)`,
      details,
    );
  }
}

/** A money leg's cash account currency must match the note currency. */
export class NoteAccountCurrencyMismatchError extends DomainError {
  constructor(details: { noteId: string; noteCurrency: string; accountCurrency: string }) {
    super(
      "NOTE_ACCOUNT_CURRENCY_MISMATCH",
      `Note ${details.noteId} currency ${details.noteCurrency} must match the cash account currency ${details.accountCurrency}`,
      details,
    );
  }
}
