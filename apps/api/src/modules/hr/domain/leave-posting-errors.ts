import { DomainError } from "@erp/domain-core";

/**
 * PHASE-045 (T-11 — the goldens G-50/G-51: the period-end leave-accrual
 * posting + the leave encashment settlement) domain errors. The family
 * follows the T-03…T-10 contracts: stable codes, A7-sensitive
 * not-founds (the fiscal period + the leave type + the employee ride
 * RLS), and the golden laws surfaced as typed refusals BEFORE any
 * write.
 */

/** G-50's policy gate: the tenant has not enabled the accrual posting
 * (the BR-055 no-fabricated-defaults discipline — the balances carry
 * the days, never an invented ledger effect; 422 family). */
export class LeaveAccrualPostingDisabledError extends DomainError {
  constructor() {
    super(
      "LEAVE_ACCRUAL_POSTING_DISABLED",
      "the leave-accrual posting is disabled — enable the hr.leave_accrual_posting policy ('post') first (the BR-055 discipline: no fabricated ledger effect)",
    );
  }
}

/** The accrual posting's period law: only a MONTHLY fiscal period (its
 * start and end inside one calendar month) can carry the monthly
 * accrual slice (422 family). */
export class LeaveAccrualPeriodInvalidError extends DomainError {
  constructor(message: string) {
    super("LEAVE_ACCRUAL_PERIOD_INVALID", message);
  }
}

/** The encashment's balance law (INV-031 at the encash boundary): days
 * above the remaining balance are the typed refusal BEFORE any write —
 * never a negative remaining (422 family). */
export class LeaveEncashmentInsufficientError extends DomainError {
  constructor(details: {
    employeeCode: string;
    remainingDays: string;
    requestedDays: string;
  }) {
    super(
      "LEAVE_ENCASHMENT_INSUFFICIENT",
      `employee ${details.employeeCode} has ${details.remainingDays} remaining days — the encashment of ${details.requestedDays} days is refused (INV-031)`,
    );
  }
}

/** The encashment's shape laws (a non-positive days/amount floor, a
 * terminated employee — the honest lifecycle; 422 family). */
export class LeaveEncashmentInvalidError extends DomainError {
  constructor(message: string) {
    super("LEAVE_ENCASHMENT_INVALID", message);
  }
}
