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
