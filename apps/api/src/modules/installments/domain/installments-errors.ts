import { DomainError } from "@erp/domain-core";

/**
 * Installments-module domain errors (PHASE-027; the fixed_assets error
 * taxonomy pattern — typed 404s for spoof parity (A7), 409 lifecycle
 * conflicts, 422 validation).
 */

// -- 404 not-found (A7 parity: unknown == foreign) --------------------------------

export class PlanNotFoundError extends DomainError {
  constructor(id: string) {
    super("PLAN_NOT_FOUND", `Installment plan ${id} not found`, { id });
  }
}

export class LineNotFoundError extends DomainError {
  constructor(id: string) {
    super("LINE_NOT_FOUND", `Installment line ${id} not found`, { id });
  }
}

/** Foreign/unsuitable source document — typed 404 (the S-04 spoof row). */
export class PlanSourceInvalidError extends DomainError {
  constructor(details: { sourceType: string; sourceId: string; reason: string }) {
    super(
      "PLAN_SOURCE_INVALID",
      `Source ${details.sourceType} ${details.sourceId} is not plannable: ${details.reason}`,
      details,
    );
  }
}

// -- 409 lifecycle conflicts ------------------------------------------------------

/** BR-048: the schedule is immutable after activation. */
export class ScheduleImmutableError extends DomainError {
  constructor(planId: string) {
    super(
      "SCHEDULE_IMMUTABLE",
      `Plan ${planId} is activated — the schedule is immutable (BR-048); corrections are waivers/audited plan close, never silent edits`,
      { planId },
    );
  }
}

/** A live plan already exists for the source document (uq surfaced typed). */
export class PlanSourceTakenError extends DomainError {
  constructor(details: { sourceType: string; sourceId: string }) {
    super(
      "PLAN_SOURCE_TAKEN",
      `A plan already exists for ${details.sourceType} ${details.sourceId} (one plan per source document)`,
      details,
    );
  }
}

// -- 422 validation ---------------------------------------------------------------

/** BR-048: activation requires plan total == source document total. */
export class PlanTotalMismatchError extends DomainError {
  constructor(details: { planId: string; planTotal: string; sourceTotal: string }) {
    super(
      "PLAN_TOTAL_MISMATCH",
      `Plan total ${details.planTotal} must equal the source document total ${details.sourceTotal} (BR-048)`,
      details,
    );
  }
}

/** The computed schedule cannot exist (non-positive last line etc.). */
export class ScheduleInvalidError extends DomainError {
  constructor(details: { reason: string }) {
    super("SCHEDULE_INVALID", `The computed schedule is invalid: ${details.reason}`, details);
  }
}

/** Source documents must be base-currency in this phase (honest deferral). */
export class PlanSourceCurrencyUnsupportedError extends DomainError {
  constructor(details: { sourceType: string; currency: string; base: string }) {
    super(
      "PLAN_SOURCE_CURRENCY_UNSUPPORTED",
      `Plans over ${details.sourceType} documents are base-currency only in this phase (got ${details.currency}, base ${details.base}) — foreign-currency plans are a documented follow-up`,
      details,
    );
  }
}

/** The late-fee policy shape (BR-049). */
export class LateFeePolicyInvalidError extends DomainError {
  constructor(details: { reason: string }) {
    super("LATE_FEE_POLICY_INVALID", `Invalid late-fee policy: ${details.reason}`, details);
  }
}

/** A late fee is only chargeable on an OVERDUE, uncharged line. */
export class LateFeeNotChargeableError extends DomainError {
  constructor(details: { lineId: string; status: string; alreadyCharged: boolean }) {
    super(
      "LATE_FEE_NOT_CHARGEABLE",
      `Line ${details.lineId} is ${details.status}${details.alreadyCharged ? " and already charged" : ""} — late fees post only on OVERDUE uncharged lines (G-28)`,
      details,
    );
  }
}

/** BR-049: the waive reason is required. */
export class WaiveReasonRequiredError extends DomainError {
  constructor(lineId: string) {
    super("WAIVE_REASON_REQUIRED", `Waiving line ${lineId} requires a reason`, { lineId });
  }
}
