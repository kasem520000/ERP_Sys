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

// -- WMS (PHASE-044 T-03; INV-029/BR-072, I-01…I-25) ------------------------------------
//
// The WMS surface's typed failures. INV-029's discipline is fail-closed:
// a bin-level shortfall on an issue is a reconciliation violation, never
// a silent deepening of the drift (the nightly probe reports the rest).

export class ZoneNotFoundError extends DomainError {
  constructor(id: string) {
    super("ZONE_NOT_FOUND", `warehouse zone ${id} does not exist in this tenant`);
  }
}
export class ZoneCodeExistsError extends DomainError {
  constructor(code: string) {
    super("ZONE_CODE_EXISTS", `zone code ${code} already exists for this warehouse`);
  }
}
export class AisleNotFoundError extends DomainError {
  constructor(id: string) {
    super("AISLE_NOT_FOUND", `warehouse aisle ${id} does not exist in this tenant`);
  }
}
export class RackNotFoundError extends DomainError {
  constructor(id: string) {
    super("RACK_NOT_FOUND", `warehouse rack ${id} does not exist in this tenant`);
  }
}
export class BinNotFoundError extends DomainError {
  constructor(ref: string) {
    // A7: unknown-vs-foreign render identically (no existence disclosure).
    super("BIN_NOT_FOUND", `warehouse bin ${ref} does not exist in this tenant`);
  }
}
export class BinCodeExistsError extends DomainError {
  constructor(code: string) {
    super("BIN_CODE_EXISTS", `bin code ${code} already exists for this warehouse`);
  }
}
export class BinBarcodeExistsError extends DomainError {
  constructor(barcode: string) {
    super("BIN_BARCODE_EXISTS", `bin barcode ${barcode} already exists in this tenant`);
  }
}
export class BinWarehouseMismatchError extends DomainError {
  constructor(binId: string, warehouseId: string) {
    super(
      "BIN_WAREHOUSE_MISMATCH",
      `bin ${binId} does not belong to warehouse ${warehouseId}`,
    );
  }
}
/** BR-072 (§2.1 mixed-batch rule): a no-mixed-batches bin rejects a second batch. */
export class BinMixedBatchBlockedError extends DomainError {
  constructor(binId: string, existingBatchId: string) {
    super(
      "BIN_MIXED_BATCH_BLOCKED",
      `bin ${binId} disallows mixed batches and already holds batch ${existingBatchId}`,
    );
  }
}
export class BinContentNotFoundError extends DomainError {
  constructor(id: string) {
    super("BIN_CONTENT_NOT_FOUND", `bin_contents row ${id} does not exist in this tenant`);
  }
}
export class BinContentStateError extends DomainError {
  constructor(message: string) {
    super("BIN_CONTENT_STATE_INVALID", message);
  }
}
/**
 * INV-029 fail-closed floor: tenant-owned bin rows exist for the item but
 * cannot cover the issue (short, wrong status, or wrong bin) — the move is
 * refused rather than deepening the bins-vs-stock drift.
 */
export class BinContentsShortError extends DomainError {
  constructor(details: {
    itemId: string;
    warehouseId: string;
    binQty: string;
    requested: string;
  }) {
    super(
      "BIN_CONTENTS_SHORT",
      `bin contents hold ${details.binQty} of the item in this warehouse but ${details.requested} were requested (INV-029)`,
      details,
    );
  }
}
/** I-15: no uom_conversions row exists either way between the two units. */
export class UomConversionMissingError extends DomainError {
  constructor(fromUomId: string, toUomId: string) {
    super(
      "UOM_CONVERSION_MISSING",
      `no uom conversion exists between ${fromUomId} and ${toUomId} (I-15)`,
    );
  }
}
export class LpnNotFoundError extends DomainError {
  constructor(ref: string) {
    super("LPN_NOT_FOUND", `LPN ${ref} does not exist in this tenant`);
  }
}
export class LpnCodeExistsError extends DomainError {
  constructor(code: string) {
    super("LPN_CODE_EXISTS", `LPN code ${code} already exists in this tenant`);
  }
}
export class LpnClosedError extends DomainError {
  constructor(id: string) {
    super("LPN_CLOSED", `LPN ${id} is CLOSED — bind or move its contents first`);
  }
}

// -- directed putaway (PHASE-044 T-04; §2.3; I-03/PP-12) -------------------------------

export class PutawayRuleInvalidError extends DomainError {
  constructor(message: string) {
    super("PUTAWAY_RULE_INVALID", message);
  }
}
export class PutawayRuleNotFoundError extends DomainError {
  constructor(id: string) {
    super("PUTAWAY_RULE_NOT_FOUND", `putaway rule ${id} does not exist in this tenant`);
  }
}
export class PutawayTaskNotFoundError extends DomainError {
  constructor(id: string) {
    super("PUTAWAY_TASK_NOT_FOUND", `task ${id} does not exist in this tenant`);
  }
}
export class PutawayTaskStateError extends DomainError {
  constructor(message: string) {
    super("PUTAWAY_TASK_STATE_INVALID", message);
  }
}
/** PP-12/§6.3: the scanned bin is not the task's directed target. */
export class WrongBinPutawayError extends DomainError {
  constructor(scanned: string, expectedBinCode: string) {
    super(
      "WRONG_BIN_PUTAWAY",
      `scanned bin ${scanned} is not the directed target ${expectedBinCode}`,
      { scanned, expectedBinCode },
    );
  }
}

// -- directed picking (PHASE-044 T-05; §2.4; I-04/I-06/I-07/PP-11) ---------------------

export class PickWaveNotFoundError extends DomainError {
  constructor(id: string) {
    super("PICK_WAVE_NOT_FOUND", `pick wave ${id} does not exist in this tenant`);
  }
}
export class PickWaveStateError extends DomainError {
  constructor(message: string) {
    super("PICK_WAVE_STATE_INVALID", message);
  }
}
export class PickWaveEmptyError extends DomainError {
  constructor(warehouseId: string) {
    super("PICK_WAVE_EMPTY", `no open deliverable lines found for the wave in warehouse ${warehouseId}`);
  }
}
export class PickTaskNotFoundError extends DomainError {
  constructor(id: string) {
    super("PICK_TASK_NOT_FOUND", `pick task ${id} does not exist in this tenant`);
  }
}
export class PickTaskStateError extends DomainError {
  constructor(message: string) {
    super("PICK_TASK_STATE_INVALID", message);
  }
}
/** PP-11/§6.4: the scanned bin is not the task's allocated source. */
export class WrongBinPickError extends DomainError {
  constructor(scanned: string, expectedBinCode: string) {
    super(
      "WRONG_BIN_PICK",
      `scanned bin ${scanned} is not the allocated source ${expectedBinCode}`,
      { scanned, expectedBinCode },
    );
  }
}
/** §2.4: the warehouse strategy disallows short picks. */
export class PartialPickNotAllowedError extends DomainError {
  constructor(warehouseId: string) {
    super(
      "PARTIAL_PICK_NOT_ALLOWED",
      `warehouse ${warehouseId}'s pick strategy disallows partial picks — confirm the full qty`,
    );
  }
}

// -- cycle counting + ABC (PHASE-044 T-07; §2.6/§2.7; I-08/I-09/I-20) -------------------

export class CycleCountScheduleNotFoundError extends DomainError {
  constructor(id: string) {
    super("CYCLE_COUNT_SCHEDULE_NOT_FOUND", `cycle-count schedule ${id} does not exist in this tenant`);
  }
}
export class CycleCountScheduleStateError extends DomainError {
  constructor(message: string) {
    super("CYCLE_COUNT_SCHEDULE_STATE_INVALID", message);
  }
}
export class CycleCountDocumentNotFoundError extends DomainError {
  constructor(id: string) {
    super("CYCLE_COUNT_DOCUMENT_NOT_FOUND", `cycle-count document ${id} does not exist in this tenant`);
  }
}
export class CycleCountDocumentStateError extends DomainError {
  constructor(message: string) {
    super("CYCLE_COUNT_DOCUMENT_STATE_INVALID", message);
  }
}
export class CycleCountLineNotFoundError extends DomainError {
  constructor(documentId: string, lineNo: number) {
    super("CYCLE_COUNT_LINE_NOT_FOUND", `cycle-count document ${documentId} has no line ${lineNo}`);
  }
}
/** BR-075: a line's |value impact| exceeds the schedule's approval
 * threshold — a supervisor approval (or a recount) is required. */
export class CycleCountThresholdError extends DomainError {
  constructor(details: { documentId: string; overThreshold: number; threshold: string }) {
    super(
      "CYCLE_COUNT_THRESHOLD_EXCEEDED",
      `cycle-count document ${details.documentId} has ${details.overThreshold} lines above the approval threshold ${details.threshold} — recount or supervisor approval required (BR-075)`,
      details,
    );
  }
}
/** §2.7: the ABC split thresholds must satisfy 0 < aPct < bPct ≤ 1. */
export class AbcThresholdError extends DomainError {
  constructor(aPct: string, bPct: string) {
    super("ABC_THRESHOLD_INVALID", `ABC thresholds must satisfy 0 < aPct < bPct ≤ 1: ${aPct}/${bPct}`);
  }
}
