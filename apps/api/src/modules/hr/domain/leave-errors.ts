import { DomainError } from "@erp/domain-core";

/**
 * PHASE-045 (T-07 — the leave engine) domain errors: the type shape
 * family, the request lifecycle conflicts, INV-031's balance law at
 * the approve boundary, and the accrual/rollover run guards. Codes are
 * stable API contracts; A7-sensitive not-founds render identically for
 * unknown-vs-foreign ids.
 */

export class LeaveTypeNotFoundError extends DomainError {
  constructor(id: string) {
    super("LEAVE_TYPE_NOT_FOUND", `leave type ${id} does not exist in this tenant`);
  }
}
export class LeaveTypeInvalidError extends DomainError {
  constructor(message: string) {
    super("LEAVE_TYPE_INVALID", message);
  }
}
export class LeaveTypeInactiveError extends DomainError {
  constructor(id: string) {
    super("LEAVE_TYPE_INACTIVE", `leave type ${id} is inactive — reactivate it before requesting leave under it (HR-02)`);
  }
}
export class LeaveRequestNotFoundError extends DomainError {
  constructor(id: string) {
    super("LEAVE_REQUEST_NOT_FOUND", `leave request ${id} does not exist in this tenant`);
  }
}
export class LeaveRequestInvalidError extends DomainError {
  constructor(message: string) {
    super("LEAVE_REQUEST_INVALID", message);
  }
}
/** The lifecycle: only a PENDING request can be decided or cancelled
 * (the simple-approval chain — PHASE-052 is the upgrade path). */
export class LeaveRequestDecidedError extends DomainError {
  constructor(id: string, status: string) {
    super(
      "LEAVE_REQUEST_DECIDED",
      `leave request ${id} is already ${status} — only a PENDING request can be decided or cancelled`,
    );
  }
}
/** INV-031 at the approve boundary: used never exceeds entitlement +
 * carried-forward at any moment — the typed refusal BEFORE the
 * decrement (never a negative remaining). */
export class LeaveBalanceInsufficientError extends DomainError {
  constructor(message: string) {
    super("LEAVE_BALANCE_INSUFFICIENT", message);
  }
}
/** An employee cannot be on two leaves at once: a PENDING-or-APPROVED
 * span never overlaps another (typed before any write). */
export class LeaveSpanOverlapError extends DomainError {
  constructor(message: string) {
    super("LEAVE_SPAN_OVERLAP", message);
  }
}
/** The accrual/rollover run guards (the run's shape + the INV-031
 * preservation when a recompute would LOWER an entitlement below the
 * already-used days). */
export class LeaveAccrualInvalidError extends DomainError {
  constructor(message: string) {
    super("LEAVE_ACCRUAL_INVALID", message);
  }
}
