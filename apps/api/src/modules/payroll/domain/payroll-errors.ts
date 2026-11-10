import { DomainError } from "@erp/domain-core";

/**
 * Payroll-module domain errors (PHASE-029; PHASE-006 error taxonomy —
 * stable codes, HTTP mapping registered in-phase in error.filter.ts per
 * the SF-027-001 lesson). Codes follow the notes/budgeting precedent:
 * typed 404s never disclose foreign existence (A7 — RLS makes unknown and
 * foreign ids indistinguishable); lifecycle conflicts 409; validation 422.
 *
 * Reused accounting/treasury errors (already HTTP-registered):
 * FiscalPeriodNotFoundError / PeriodLockedError (posting), the PostingError
 * family (PURPOSE_NOT_MAPPED, PERIOD_LOCKED, ALREADY_POSTED,
 * ENTRY_NOT_BALANCED, PAYROLL_ACCOUNT_ENGINE_ONLY — the BR-053 guard).
 * This file owns the payroll-native taxonomy only.
 */

// -- 404 not-found (A7 parity: unknown == foreign) --------------------------------

/** Foreign/unknown employee id — typed 404 (the spoof battery asserts this shape). */
export class EmployeeNotFoundError extends DomainError {
  constructor(id: string) {
    super("EMPLOYEE_NOT_FOUND", `Employee ${id} not found`, { id });
  }
}

/** Foreign/unknown salary structure id — typed 404. */
export class StructureNotFoundError extends DomainError {
  constructor(id: string) {
    super("SALARY_STRUCTURE_NOT_FOUND", `Salary structure ${id} not found`, { id });
  }
}

/** Foreign/unknown component id — typed 404. */
export class ComponentNotFoundError extends DomainError {
  constructor(id: string) {
    super("SALARY_COMPONENT_NOT_FOUND", `Salary component ${id} not found`, { id });
  }
}

/** Foreign/unknown run id — typed 404. */
export class RunNotFoundError extends DomainError {
  constructor(id: string) {
    super("PAYROLL_RUN_NOT_FOUND", `Payroll run ${id} not found`, { id });
  }
}

/** Foreign/unknown loan id — typed 404. */
export class LoanNotFoundError extends DomainError {
  constructor(id: string) {
    super("EMPLOYEE_LOAN_NOT_FOUND", `Employee loan ${id} not found`, { id });
  }
}

/** Foreign/unknown loan line id — typed 404. */
export class LoanLineNotFoundError extends DomainError {
  constructor(id: string) {
    super("EMPLOYEE_LOAN_LINE_NOT_FOUND", `Employee loan line ${id} not found`, { id });
  }
}

/** Foreign/unknown GL account on a component — typed 404 (S-04). */
export class ComponentAccountNotFoundError extends DomainError {
  constructor(id: string) {
    super("ACCOUNT_NOT_FOUND", `Account ${id} not found`, { id });
  }
}

// -- 409 lifecycle conflicts ------------------------------------------------------

/** Illegal lifecycle transition (runs DRAFT → PENDING_APPROVAL → POSTED; employees; loans). */
export class PayrollStateError extends DomainError {
  constructor(details: { entity: string; id: string; from: string; to: string; reason?: string }) {
    super(
      "PAYROLL_STATE_INVALID",
      `${details.entity} ${details.id} cannot move ${details.from} → ${details.to}${details.reason ? `: ${details.reason}` : ""}`,
      details,
    );
  }
}

/**
 * SoD (AUTHORIZATION_MATRIX §4 row payroll.runs.approve): the run's creator
 * never approves it — the approval stamp requires a distinct approver.
 */
export class RunSelfApprovalError extends DomainError {
  constructor(details: { runId: string; actorId: string }) {
    super(
      "PAYROLL_RUN_SELF_APPROVAL",
      `Actor ${details.actorId} created run ${details.runId} — self-approval is blocked (SoD, AUTHORIZATION_MATRIX §4)`,
      details,
    );
  }
}

/**
 * Any mutation of a POSTED run (or its lines) — 409 IMMUTABLE_DOCUMENT
 * (INV-003-style reversal-only corrections; the DB guard trigger is the
 * backstop for lines).
 */
export class RunImmutableError extends DomainError {
  constructor(details: { runId: string; status: string; action: string }) {
    super(
      "IMMUTABLE_DOCUMENT",
      `Run ${details.runId} is ${details.status} — ${details.action} is prohibited (reversal is the only correction path)`,
      details,
    );
  }
}

/** A second live (non-DRAFT) run for the same period (the monthly-run law). */
export class RunPeriodExistsError extends DomainError {
  constructor(details: { fiscalPeriodId: string; existingRunId: string }) {
    super(
      "PAYROLL_RUN_PERIOD_EXISTS",
      `A live run already exists for period ${details.fiscalPeriodId} (${details.existingRunId}) — one run per period`,
      details,
    );
  }
}

/** Editing components of a structure that a run already consumed (BR-052). */
export class StructureInUseError extends DomainError {
  constructor(details: { structureId: string; runId: string }) {
    super(
      "SALARY_STRUCTURE_IN_USE",
      `Structure ${details.structureId} is frozen — run ${details.runId} already snapshots it (BR-052: version it, never edit in place)`,
      details,
    );
  }
}

/** Operating on an ARCHIVED structure (runs require ACTIVE — BR-052). */
export class StructureNotActiveError extends DomainError {
  constructor(details: { structureId: string; status: string }) {
    super(
      "SALARY_STRUCTURE_NOT_ACTIVE",
      `Structure ${details.structureId} is ${details.status} — runs require an ACTIVE structure (BR-052)`,
      details,
    );
  }
}

/** Loan schedule mutations after disbursement (schedule immutable). */
export class LoanScheduleImmutableError extends DomainError {
  constructor(details: { loanId: string; action: string }) {
    super(
      "IMMUTABLE_DOCUMENT",
      `Loan ${details.loanId}'s schedule is immutable after disbursement — ${details.action} is prohibited`,
      details,
    );
  }
}

// -- 422 validation ---------------------------------------------------------------

/** A structure currency ≠ the tenant base currency (typed — the G-29 base discipline). */
export class StructureCurrencyError extends DomainError {
  constructor(details: { structureId: string; currency: string; base: string }) {
    super(
      "SALARY_STRUCTURE_CURRENCY",
      `Structure ${details.structureId} is denominated ${details.currency} but the tenant base is ${details.base} — payroll posts base-denominated only`,
      details,
    );
  }
}

/** An employee without a structure entered a run calculation. */
export class EmployeeStructureMissingError extends DomainError {
  constructor(details: { employeeId: string; code: string }) {
    super(
      "EMPLOYEE_STRUCTURE_MISSING",
      `Employee ${details.code} carries no ACTIVE salary structure — assign one before calculating the run`,
      details,
    );
  }
}

/** A component whose kind/calc combination is unusable (DEFENSIVE — the DB CHECK owns the shape). */
export class ComponentShapeError extends DomainError {
  constructor(details: { structureId: string; key: string; reason: string }) {
    super(
      "SALARY_COMPONENT_SHAPE",
      `Component ${details.key} is invalid: ${details.reason}`,
      details,
    );
  }
}

/**
 * BR-054: the loan deduction would exceed the cap percent of net AND the
 * clamp is refused (run-calculation clamps by default with a warning; the
 * typed error surfaces when the caller demands strictness).
 */
export class LoanDeductionCapError extends DomainError {
  constructor(details: { loanId: string; scheduled: string; cap: string; capPercent: number }) {
    super(
      "LOAN_DEDUCTION_CAP_EXCEEDED",
      `Loan ${details.loanId} schedules ${details.scheduled} but the cap is ${details.cap} (${details.capPercent}% of net — BR-054)`,
      details,
    );
  }
}

/**
 * The tenant loan control account is unmapped (policy key
 * payroll.loans.control_account_id NULL — no canonical purpose exists by
 * design; the tenant maps their own account).
 */
export class LoanAccountUnmappedError extends DomainError {
  constructor() {
    super(
      "LOAN_ACCOUNT_UNMAPPED",
      "The employee-loan control account is unmapped — set payroll.loans.control_account_id to a postable account first",
      {},
    );
  }
}

/** EOS accrual enabled without an explicit basis (BR-055 — no default ships). */
export class EosBasisRequiredError extends DomainError {
  constructor() {
    super(
      "EOS_BASIS_REQUIRED",
      "payroll.eos.enabled is on but payroll.eos.accrual_days_per_service_year is unset — an explicit tenant basis is required (BR-055: no jurisdiction rates ship)",
      {},
    );
  }
}

/** Settling above the employee's provision balance (the G-31 mirror case). */
export class EosSettlementExceedsBalanceError extends DomainError {
  constructor(details: { employeeId: string; settled: string; balance: string }) {
    super(
      "EOS_SETTLEMENT_EXCEEDS_BALANCE",
      `EOS settlement ${details.settled} exceeds employee ${details.employeeId}'s provision balance ${details.balance}`,
      details,
    );
  }
}

/** Payout above the run's unpaid net remainder. */
export class PayoutExceedsRunError extends DomainError {
  constructor(details: { runId: string; requested: string; outstanding: string }) {
    super(
      "PAYROLL_PAYOUT_EXCEEDS_RUN",
      `Payout ${details.requested} exceeds run ${details.runId}'s outstanding net ${details.outstanding}`,
      details,
    );
  }
}

/** Terminating/reactivating/suspending an employee in an illegal state. */
export class EmployeeStatusError extends DomainError {
  constructor(details: { employeeId: string; from: string; to: string; reason?: string }) {
    super(
      "EMPLOYEE_STATE_INVALID",
      `Employee ${details.employeeId} cannot move ${details.from} → ${details.to}${details.reason ? `: ${details.reason}` : ""}`,
      details,
    );
  }
}

/** Duplicate tenant-scoped natural code (employee/structure/loan). */
export class PayrollCodeConflictError extends DomainError {
  constructor(details: { entity: string; code: string }) {
    super(
      "PAYROLL_CODE_CONFLICT",
      `Code ${details.code} is already used by another ${details.entity} in this tenant`,
      details,
    );
  }
}

/** Calculating a run whose population is empty (no eligible employees). */
export class RunEmptyError extends DomainError {
  constructor(runId: string) {
    super(
      "PAYROLL_RUN_EMPTY",
      `Run ${runId} has no eligible employees (ACTIVE + structure-assigned) — nothing to calculate`,
      { runId },
    );
  }
}
