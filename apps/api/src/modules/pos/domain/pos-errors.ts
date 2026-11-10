import { DomainError } from "@erp/domain-core";

/**
 * PHASE-016 pos module domain errors. Codes are stable API contracts
 * (ERROR_MODEL §4) — the HTTP layer maps each to its status; A7-sensitive
 * not-founds render identically for unknown-vs-foreign ids. Money values
 * travel as canonical decimal strings (ADR-0009).
 */

// -- terminals (T2) -------------------------------------------------------------

export class PosTerminalNotFoundError extends DomainError {
  constructor(id: string) {
    super("POS_TERMINAL_NOT_FOUND", `POS terminal ${id} does not exist in this tenant`);
  }
}
export class PosTerminalCodeTakenError extends DomainError {
  constructor(code: string) {
    super("POS_TERMINAL_CODE_TAKEN", `terminal code ${code} is already registered`);
  }
}
export class PosTerminalInactiveError extends DomainError {
  constructor(id: string) {
    super(
      "POS_TERMINAL_INACTIVE",
      `POS terminal ${id} is INACTIVE — activate it before operating a shift on it`,
    );
  }
}
export class PosTerminalDeviceBoundError extends DomainError {
  constructor(message: string) {
    super("POS_TERMINAL_DEVICE_BOUND", message);
  }
}
export class PosTerminalTillInvalidError extends DomainError {
  constructor(message: string) {
    super("POS_TERMINAL_TILL_INVALID", message);
  }
}

// -- shifts (T3) ----------------------------------------------------------------

export class PosShiftOpenMismatchError extends DomainError {
  constructor(details: Record<string, unknown>) {
    super(
      "POS_SHIFT_OPEN_MISMATCH",
      "an open shift already exists on this terminal's till — one open shift per till (BR-021)",
      details,
    );
  }
}
export class PosShiftNotOnTerminalError extends DomainError {
  constructor(shiftId: string, terminalId: string) {
    super(
      "POS_SHIFT_NOT_ON_TERMINAL",
      `shift ${shiftId} is not the open shift on terminal ${terminalId}`,
    );
  }
}

// -- sale flow (T4/T5) -----------------------------------------------------------

export class PosTenderInvalidError extends DomainError {
  constructor(message: string) {
    super("POS_TENDER_INVALID", message);
  }
}
export class PosTenderOverflowError extends DomainError {
  constructor(details: { tendered: string; total: string }) {
    super(
      "POS_TENDER_OVERFLOW",
      "tender total exceeds the sale total — reduce a tender line or the change due grows past policy",
      details,
    );
  }
}
export class PosWalkInCustomerError extends DomainError {
  constructor(message: string) {
    super("POS_WALK_IN_CUSTOMER_ERROR", message);
  }
}
export class PosDiscountCeilingExceededError extends DomainError {
  constructor(details: Record<string, unknown>) {
    super(
      "POS_DISCOUNT_CEILING_EXCEEDED",
      "line/document discount exceeds the actor's BR-002 ceiling — a supervisor must approve or the discount shrinks",
      details,
    );
  }
}

// -- table service (T6) ----------------------------------------------------------

export class PosTableNotFoundError extends DomainError {
  constructor(id: string) {
    super("POS_TABLE_NOT_FOUND", `table ${id} does not exist in this tenant`);
  }
}
export class PosCheckNotFoundError extends DomainError {
  constructor(id: string) {
    super("POS_CHECK_NOT_FOUND", `guest check ${id} does not exist in this tenant`);
  }
}
export class PosCheckNotOpenError extends DomainError {
  constructor(id: string, status: string) {
    super("POS_CHECK_NOT_OPEN", `guest check ${id} is ${status} — only OPEN checks mutate`);
  }
}
export class PosCheckHasOpenTablesError extends DomainError {
  constructor(branchId: string) {
    super(
      "POS_CHECK_HAS_OPEN_TABLES",
      `branch ${branchId} still has open checks — settle or cancel them before closing the day (Z report)`,
    );
  }
}

// -- offline / sync (T7–T10; SYNC_PROTOCOL §11) -----------------------------------

export class PosDeviceRevokedError extends DomainError {
  constructor(deviceId: string) {
    super("DEVICE_REVOKED", `device ${deviceId} is revoked — pushes are rejected before execution`);
  }
}
export class PosDeviceNotFoundError extends DomainError {
  constructor(deviceId: string) {
    super("DEVICE_NOT_FOUND", `device ${deviceId} is not registered`);
  }
}
export class PosDeviceNotTerminalError extends DomainError {
  constructor(message: string) {
    super("DEVICE_NOT_POS_TERMINAL", message);
  }
}
export class PosSyncEntityInvalidError extends DomainError {
  constructor(entityType: string) {
    super(
      "SYNC_ENTITY_INVALID",
      `entity type ${entityType} is not part of the POS feed group (SYNC_PROTOCOL §11 boundary)`,
    );
  }
}
export class PosSyncCommandInvalidError extends DomainError {
  constructor(message: string) {
    super("SYNC_COMMAND_INVALID", message);
  }
}
export class PosOfflineSaleConflictError extends DomainError {
  constructor(
    readonly reason:
      | "PERIOD_LOCKED"
      | "PRICE_CHANGED"
      | "INSUFFICIENT_STOCK"
      | "CREDIT_LIMIT_EXCEEDED"
      | "VALIDATION_ERROR",
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(reason, message, details);
  }
}
