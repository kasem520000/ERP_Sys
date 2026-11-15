import { DomainError } from "@erp/domain-core";

/**
 * PHASE-045 (T-03 — HR Core: shifts + the roster grid + the rotation
 * pattern generator) domain errors. Codes are stable API contracts
 * (ERROR_MODEL §4 — the HTTP layer maps each to its status; A7-sensitive
 * not-founds render identically for unknown-vs-foreign ids: RLS makes
 * them indistinguishable at the store, and the typed errors here never
 * disclose a foreign id's existence).
 */

export class ShiftNotFoundError extends DomainError {
  constructor(id: string) {
    super("SHIFT_NOT_FOUND", `shift ${id} does not exist in this tenant`);
  }
}
export class ShiftCodeTakenError extends DomainError {
  constructor(code: string) {
    super(
      "SHIFT_CODE_TAKEN",
      `shift code ${code} is already used in this tenant — shift codes are unique (HR-04)`,
    );
  }
}
export class ShiftInvalidError extends DomainError {
  constructor(message: string) {
    super("SHIFT_INVALID", message);
  }
}
export class ShiftInactiveError extends DomainError {
  constructor(id: string) {
    super(
      "SHIFT_INACTIVE",
      `shift ${id} is inactive — reactivate it before rostering it (HR-04)`,
    );
  }
}
export class EmployeeNotFoundError extends DomainError {
  constructor(id: string) {
    super("HR_EMPLOYEE_NOT_FOUND", `employee ${id} does not exist in this tenant`);
  }
}
export class RosterCellInvalidError extends DomainError {
  constructor(message: string) {
    super("ROSTER_CELL_INVALID", message);
  }
}
export class RotationInvalidError extends DomainError {
  constructor(message: string) {
    super("ROTATION_INVALID", message);
  }
}

/**
 * PHASE-045 (T-04 — the attendance service) domain errors. The family
 * follows the T-03 contracts: stable codes, A7-sensitive not-founds
 * (identical shape for unknown-vs-foreign ids — RLS makes them
 * indistinguishable at the store), and the INV-031/BR-082 laws surfaced
 * as typed refusals BEFORE any write.
 */
export class AttendanceRecordInvalidError extends DomainError {
  constructor(message: string) {
    super("ATTENDANCE_RECORD_INVALID", message);
  }
}
export class AttendanceRecordNotFoundError extends DomainError {
  constructor(id: string) {
    super("ATTENDANCE_RECORD_NOT_FOUND", `attendance record ${id} does not exist in this tenant`);
  }
}
/** INV-031 (attendance exactness): intervals never overlap per
 * employee-day — the guarded single-writer path (the service boundary)
 * refuses an overlapping session before any write. */
export class AttendanceSessionOverlapError extends DomainError {
  constructor(message: string) {
    super("ATTENDANCE_SESSION_OVERLAP", message);
  }
}
/** The 0081 dedupe floor (UNIQUE tenant + employee + work_date +
 * check_in), surfaced typed — the same employee + timestamp is ONE
 * session, never two rows. */
export class AttendanceDuplicatePunchError extends DomainError {
  constructor(message: string) {
    super("ATTENDANCE_DUPLICATE_PUNCH", message);
  }
}
/** BR-082 (the immutability window): a committed punch is never edited —
 * check_in is immutable from creation, check_out may be filled EXACTLY
 * ONCE (completing the session) and is immutable after; corrections
 * arrive as NEW rows (the import's quarantine discipline), never as
 * edits of committed punch fields. */
export class AttendanceImmutableError extends DomainError {
  constructor(message: string) {
    super("ATTENDANCE_IMMUTABLE", message);
  }
}
