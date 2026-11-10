import { DomainError } from "@erp/domain-core";

/**
 * PHASE-010 inventory module domain errors. Codes are stable API contracts
 * (ERROR_MODEL §4) — the HTTP layer maps each to its status; A7-sensitive
 * not-founds render identically for unknown-vs-foreign ids (no existence
 * disclosure). Quantities/costs travel as canonical decimal strings
 * (ADR-0009; 6-decimal internal cost precision, 4-decimal value_amount).
 */

// -- warehouses (T2) -----------------------------------------------------------

export class WarehouseNotFoundError extends DomainError {
  constructor(id: string) {
    super("WAREHOUSE_NOT_FOUND", `warehouse ${id} does not exist in this tenant`);
  }
}
export class WarehouseCodeExistsError extends DomainError {
  constructor(code: string) {
    super("WAREHOUSE_CODE_EXISTS", `warehouse code ${code} already exists`);
  }
}
export class WarehouseInactiveError extends DomainError {
  constructor(id: string) {
    super("WAREHOUSE_INACTIVE", `warehouse ${id} is deactivated and cannot receive stock operations`);
  }
}
export class WarehouseNotDeactivatableError extends DomainError {
  constructor(message: string) {
    super("WAREHOUSE_NOT_DEACTIVATABLE", message);
  }
}

// -- movements / valuation (T3–T5) ----------------------------------------------

export class ItemNotFoundError extends DomainError {
  constructor(id: string) {
    super("ITEM_NOT_FOUND", `item ${id} does not exist in this tenant`);
  }
}
export class ItemNotStockedError extends DomainError {
  constructor(id: string) {
    super("ITEM_NOT_STOCKED", `item ${id} is not a STOCK item (valuation applies to stock only)`);
  }
}
export class InvalidQuantityError extends DomainError {
  constructor(message: string) {
    super("INVALID_QUANTITY", message);
  }
}
export class InvalidCostError extends DomainError {
  constructor(message: string) {
    super("INVALID_COST", message);
  }
}
export class InsufficientStockError extends DomainError {
  constructor(details: {
    itemId: string;
    warehouseId: string;
    onHand: string;
    requested: string;
  }) {
    super(
      "INSUFFICIENT_STOCK",
      `issue of ${details.requested} exceeds on-hand ${details.onHand} (negative stock is disabled — BR-013)`,
      details,
    );
  }
}
export class CostingMethodInvalidError extends DomainError {
  constructor(message: string) {
    super("COSTING_METHOD_INVALID", message);
  }
}

// -- transfers (T7; G-15/BR-016) -------------------------------------------------

export class StockTransferNotFoundError extends DomainError {
  constructor(id: string) {
    super("STOCK_TRANSFER_NOT_FOUND", `stock transfer ${id} does not exist in this tenant`);
  }
}
export class StockTransferStateError extends DomainError {
  constructor(message: string) {
    super("STOCK_TRANSFER_STATE_INVALID", message);
  }
}
export class StockTransferEmptyError extends DomainError {
  constructor() {
    super("STOCK_TRANSFER_EMPTY", `a transfer needs at least one line`);
  }
}
export class StockTransferSameWarehouseError extends DomainError {
  constructor() {
    super("STOCK_TRANSFER_SAME_WAREHOUSE", `from and to warehouses must differ`);
  }
}

// -- counts (T8; BR-015) ----------------------------------------------------------

export class StockCountNotFoundError extends DomainError {
  constructor(id: string) {
    super("STOCK_COUNT_NOT_FOUND", `stock count ${id} does not exist in this tenant`);
  }
}
export class StockCountStateError extends DomainError {
  constructor(message: string) {
    super("STOCK_COUNT_STATE_INVALID", message);
  }
}
export class CountLineNotFoundError extends DomainError {
  constructor(countId: string, lineNo: number) {
    super("COUNT_LINE_NOT_FOUND", `count ${countId} has no line ${lineNo}`);
  }
}
export class CountVarianceToleranceError extends DomainError {
  constructor(details: { countId: string; overTolerance: number; tolerance: string }) {
    super(
      "COUNT_VARIANCE_TOLERANCE_EXCEEDED",
      `count ${details.countId} has ${details.overTolerance} lines above the tolerance ${details.tolerance} — recount or supervisor approval required (BR-015)`,
      details,
    );
  }
}

// -- tracking (T9; BR-017/BR-018) ---------------------------------------------------

export class BatchNotFoundError extends DomainError {
  constructor(id: string) {
    super("BATCH_NOT_FOUND", `batch ${id} does not exist in this tenant`);
  }
}
export class BatchRequiredError extends DomainError {
  constructor(itemId: string) {
    super("BATCH_REQUIRED", `item ${itemId} is batch-tracked — the batch is required on receive/issue`);
  }
}
export class BatchExistsError extends DomainError {
  constructor(itemId: string, batchNo: string) {
    super("BATCH_ALREADY_EXISTS", `batch ${batchNo} already exists for item ${itemId}`);
  }
}
export class SerialNotFoundError extends DomainError {
  constructor(idOrNo: string) {
    super("SERIAL_NOT_FOUND", `serial ${idOrNo} does not exist in this tenant`);
  }
}
export class SerialRequiredError extends DomainError {
  constructor(itemId: string) {
    super("SERIAL_REQUIRED", `item ${itemId} is serial-tracked — specific serials are required on receive/issue`);
  }
}
export class SerialNotInStockError extends DomainError {
  constructor(serialNo: string, status: string) {
    super("SERIAL_NOT_IN_STOCK", `serial ${serialNo} is ${status} — only in_stock units can be issued`);
  }
}
export class SerialReturnBindingError extends DomainError {
  constructor(serialNo: string) {
    super(
      "SERIAL_RETURN_BINDING_INVALID",
      `returns must reference the originally sold unit (BR-018) — serial ${serialNo} has no sale to return`,
    );
  }
}
export class SerialExistsError extends DomainError {
  constructor(itemId: string, serialNo: string) {
    super("SERIAL_ALREADY_EXISTS", `serial ${serialNo} already exists for item ${itemId}`);
  }
}
export class BatchNotOnHandError extends DomainError {
  constructor(details: { batchNo: string; onHand: string; requested: string }) {
    super(
      "BATCH_INSUFFICIENT_STOCK",
      `batch ${details.batchNo} has ${details.onHand} on hand — issue of ${details.requested} exceeds it`,
      details,
    );
  }
}

// -- manufacturing quarantine / provenance (PHASE-018; internal-only
// inventory surface called by the manufacturing module inside its own
// transaction — no routes of its own) -----------------------------------------

export class BatchQuarantinedError extends DomainError {
  constructor(batchNo: string) {
    super(
      "BATCH_QUARANTINED",
      `batch ${batchNo} is QUARANTINED (QC hold) — release the quarantine before issuing it`,
    );
  }
}
export class BatchNotActiveError extends DomainError {
  constructor(id: string, status: string) {
    super(
      "BATCH_NOT_ACTIVE",
      `batch ${id} is ${status} — only an ACTIVE batch can be quarantined`,
    );
  }
}
export class BatchNotQuarantinedError extends DomainError {
  constructor(id: string, status: string) {
    super(
      "BATCH_NOT_QUARANTINED",
      `batch ${id} is ${status} — only a QUARANTINED batch can be released`,
    );
  }
}
export class BatchProvenanceConflictError extends DomainError {
  constructor(details: { batchId: string; linkedTo: string; requested: string }) {
    super(
      "BATCH_PROVENANCE_CONFLICT",
      `batch ${details.batchId} is already linked to production order ${details.linkedTo} — produced-batch provenance is set once (requested ${details.requested})`,
      details,
    );
  }
}
export class WarehouseRoleInvalidError extends DomainError {
  constructor(role: string) {
    super("WAREHOUSE_ROLE_INVALID", `warehouse role must be RAW, WIP, FG or null — got ${role}`);
  }
}

// -- adjustments (G-13/G-14) --------------------------------------------------------

export class StockAdjustmentNotFoundError extends DomainError {
  constructor(id: string) {
    super("STOCK_ADJUSTMENT_NOT_FOUND", `stock adjustment ${id} does not exist in this tenant`);
  }
}
export class StockAdjustmentStateError extends DomainError {
  constructor(message: string) {
    super("STOCK_ADJUSTMENT_STATE_INVALID", message);
  }
}

// -- method switch (T13; INV-017/BR-014) ---------------------------------------------

export class MethodSwitchInvalidError extends DomainError {
  constructor(message: string) {
    super("METHOD_SWITCH_INVALID", message);
  }
}
export class MethodSwitchInFlightError extends DomainError {
  constructor(itemId: string) {
    super(
      "METHOD_SWITCH_IN_FLIGHT",
      `item ${itemId} has in-flight transactions (IN_TRANSIT transfers or open counts) — switch is refused (BR-014)`,
    );
  }
}
export class MethodSwitchSameError extends DomainError {
  constructor(itemId: string, method: string) {
    super("METHOD_SWITCH_SAME", `item ${itemId} already costs with ${method}`);
  }
}

// -- reservations / availability (T10) --------------------------------------------------

export class ReservationNotFoundError extends DomainError {
  constructor(id: string) {
    super("RESERVATION_NOT_FOUND", `reservation ${id} does not exist in this tenant`);
  }
}
export class ReservationStateError extends DomainError {
  constructor(message: string) {
    super("RESERVATION_STATE_INVALID", message);
  }
}
