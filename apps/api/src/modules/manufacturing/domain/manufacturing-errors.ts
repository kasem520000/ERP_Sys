import { DomainError } from "@erp/domain-core";

/**
 * PHASE-018 manufacturing module domain errors (T38a — the BOM slice; T38b
 * appends the production-order set below). Codes are stable API contracts
 * (ERROR_MODEL §4) — the HTTP layer maps each to its status; A7-sensitive
 * not-founds render identically for unknown-vs-foreign ids.
 *
 * The BOM slice is recipe maintenance (no journal of its own — the BOM never
 * posts; only production orders do, through the centralized engine). Values
 * travel as canonical decimal strings (ADR-0009): quantities 19,6, scrap/
 * yield percentages 7,4.
 */

// -- bills of materials (T38a; versioned recipes) ----------------------------------

/** Unknown or foreign BOM id (A7: no existence disclosure). */
export class BomNotFoundError extends DomainError {
  constructor(id: string) {
    super("BOM_NOT_FOUND", `bill of materials ${id} does not exist in this tenant`);
  }
}
/** uq_bills_of_materials_tenant_item_version — the (item, version) pair is
 * taken (a monotonic allocation race; corrections are new versions). */
export class BomVersionConflictError extends DomainError {
  constructor(itemId: string, versionNo: number) {
    super("BOM_VERSION_CONFLICT", `version ${versionNo} for item ${itemId} is already in use in this tenant`, {
      itemId,
      versionNo,
    });
  }
}
/** Edit/activate attempted on a non-DRAFT version where DRAFT is required
 * (the full-replace PUT and the activate transition). */
export class BomNotDraftError extends DomainError {
  constructor(message: string) {
    super("BOM_NOT_DRAFT", message);
  }
}
/** Archive attempted on a non-ACTIVE version (only ACTIVE versions archive). */
export class BomNotActiveError extends DomainError {
  constructor(message: string) {
    super("BOM_NOT_ACTIVE", message);
  }
}
/** The one-active invariant: another ACTIVE version exists for the item
 * (uq_bills_of_materials_active_item — the 23505 race backstop). */
export class BomActiveExistsError extends DomainError {
  constructor(itemId: string, activeBomId: string | null) {
    super("BOM_ACTIVE_EXISTS", `item ${itemId} already has another ACTIVE version (one active per item)`, {
      itemId,
      activeBomId,
    });
  }
}
/** Component-line violation: bad qty/scrap, a dangling component, a
 * duplicate component, or a line id that belongs to another BOM. */
export class BomLineInvalidError extends DomainError {
  constructor(message: string) {
    super("BOM_LINE_INVALID", message);
  }
}
/** The multi-level explosion walked back onto an item already on the
 * current chain — circular recipes are rejected (MASTER-PLAN §3). */
export class BomCycleError extends DomainError {
  constructor(chain: readonly string[]) {
    super("BOM_CYCLE", "the recipe chain revisits an item — circular bills of materials", {
      chain: [...chain],
    });
  }
}
/** The explosion exceeded the 16-level depth cap (MASTER-PLAN §3). */
export class BomTooDeepError extends DomainError {
  constructor(maxDepth: number) {
    super("BOM_TOO_DEEP", `explosion exceeds the ${maxDepth}-level depth cap`, { maxDepth });
  }
}
/** FG or component item must be STOCK kind (no service/recipe references). */
export class BomItemNotStockError extends DomainError {
  constructor(message: string) {
    super("BOM_ITEM_NOT_STOCK", message);
  }
}
/** A version lists its own FG item as a component. */
export class BomSelfReferenceError extends DomainError {
  constructor(itemId: string) {
    super("BOM_SELF_REFERENCE", `item ${itemId} cannot be a component of its own bill of materials`, { itemId });
  }
}
/** yield_pct outside (0, 100] — stored numeric(7,4), accepted ≤ 4dp. */
export class BomYieldInvalidError extends DomainError {
  constructor(value: string) {
    super("BOM_YIELD_INVALID", `yield must be 0 < yield ≤ 100 (≤ 4dp): ${value}`, { value });
  }
}
/** output_uom_id must equal the FG item's base uom (no conversion seam in
 * PHASE-018 — quantities are in the item's base unit). */
export class BomUomMismatchError extends DomainError {
  constructor(message: string) {
    super("BOM_UOM_MISMATCH", message);
  }
}

// -- production orders (T38b — the lifecycle + posting slice) ----------------------

/**
 * Unknown or foreign production-order id (A7: no existence disclosure). The
 * lifecycle (MASTER-PLAN §2): DRAFT → RELEASED (number + BOM bind + level-1
 * snapshot) → IN_PROGRESS → COMPLETED / CANCELLED — illegal transitions are
 * this typed error.
 */
export class ProductionOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("PRODUCTION_ORDER_NOT_FOUND", `production order ${id} does not exist in this tenant`);
  }
}
/** An off-lifecycle transition (e.g. start on DRAFT, consume on RELEASED,
 * release on IN_PROGRESS, cancel on COMPLETED). The legal replays (INV-013)
 * are NOT this error: release-on-RELEASED is a no-op and complete-on-
 * COMPLETED returns the stored result. */
export class ProductionOrderStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("PRODUCTION_ORDER_STATE", message, details);
  }
}
/** The FG item of a production order must be a STOCK item (services are
 * never manufactured). */
export class ProductionOrderItemNotStockError extends DomainError {
  constructor(message: string) {
    super("PRODUCTION_ORDER_ITEM_NOT_STOCK", message);
  }
}
/** Release requires a resolvable BOM version: no explicit bomId on the
 * order and no ACTIVE version for the item (MASTER-PLAN §2). */
export class BomRequiredError extends DomainError {
  constructor(itemId: string) {
    super("BOM_REQUIRED", `item ${itemId} has no active bill of materials to release against — create/activate one or pass an explicit bomId`, {
      itemId,
    });
  }
}
/** A consume line references an item that is not one of the order's planned
 * components (the release-frozen level-1 snapshot is the only legal issue
 * set — corrections are adjusted consumptions of planned components). */
export class ConsumptionNotPlannedError extends DomainError {
  constructor(orderId: string, itemId: string) {
    super(
      "CONSUMPTION_NOT_PLANNED",
      `item ${itemId} is not a planned component of production order ${orderId} — only released components can be consumed`,
      { orderId, itemId },
    );
  }
}
/** Policy manufacturing.scrap_reason_required is on and the scrap call
 * carried no reason code. */
export class ScrapReasonRequiredError extends DomainError {
  constructor() {
    super(
      "SCRAP_REASON_REQUIRED",
      "a scrap reason code (1..40 chars) is required by the tenant's scrap policy (manufacturing.scrap_reason_required)",
    );
  }
}
/** The scrap value exceeds the order's running WIP balance (Σ consumptions −
 * Σ scraps — service-enforced; the DDL has no cross-table check). */
export class ScrapExceedsWipError extends DomainError {
  constructor(details: { balance: string; requested: string }) {
    super(
      "SCRAP_EXCEEDS_WIP",
      `scrap value ${details.requested} exceeds the order's WIP balance ${details.balance}`,
      { balance: details.balance, requested: details.requested },
    );
  }
}
/** Completion requires at least one consumption row (no empty production —
 * the FG value would have no materials basis). */
export class CompleteWithoutConsumptionError extends DomainError {
  constructor(orderId: string) {
    super(
      "COMPLETE_WITHOUT_CONSUMPTION",
      `production order ${orderId} has no consumption rows — consume materials before completing`,
      { orderId },
    );
  }
}
/** round4(unitCost × actualQty) ≠ fgValue — the completion's unit cost
 * cannot represent the FG value at 6dp without residue (honest fail-closed;
 * fixtures use exactly-divisible numbers). */
export class ProductionCostRoundingError extends DomainError {
  constructor(details: { fgValue: string; unitCost: string; qty: string }) {
    super(
      "PRODUCTION_COST_ROUNDING",
      `unit cost ${details.unitCost} × qty ${details.qty} does not reproduce the FG value ${details.fgValue} at 4dp — completion refuses a rounding residue`,
      details,
    );
  }
}
/** The FG item tracks expiry, the shelf-life policy is on, but the item
 * carries no shelf_life_days to derive the batch expiry from. */
export class FgShelfLifeRequiredError extends DomainError {
  constructor(itemId: string, completedAt: string) {
    super(
      "FG_SHELF_LIFE_REQUIRED",
      `item ${itemId} tracks expiry and the fg_batch_expiry_from_shelf_life policy is on, but the item carries no shelf_life_days — the FG batch expiry cannot be derived (completed ${completedAt})`,
      { itemId, completedAt },
    );
  }
}
/** Cancel was attempted after consumption rows exist — corrections are
 * adjusted consumptions, never cancels (MASTER-PLAN §2). */
export class OrderNotCancelableError extends DomainError {
  constructor(orderId: string, consumptionCount: number) {
    super(
      "ORDER_NOT_CANCELABLE",
      `production order ${orderId} has ${consumptionCount} consumption rows — a started order is corrected by adjusted consumptions, not cancelled`,
      { orderId, consumptionCount },
    );
  }
}
/** Order-level input validation (plannedQty ≤ 0, a malformed decimal, a
 * missing cancel reason, …) — the 422 policy class for the order slice. */
export class ProductionOrderInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("PRODUCTION_ORDER_INPUT_INVALID", message, details);
  }
}

// -- QC inspections (T39 — the §4 gate + dispositions slice) -----------------------

/** Unknown or foreign inspection id (A7: no existence disclosure). */
export class InspectionNotFoundError extends DomainError {
  constructor(id: string) {
    super("INSPECTION_NOT_FOUND", `inspection ${id} does not exist in this tenant`);
  }
}
/** Unknown or foreign goods-receipt target id (A7: unknown-vs-foreign
 * identical; unknown ORDER targets reuse ProductionOrderNotFoundError). */
export class InspectionTargetNotFoundError extends DomainError {
  constructor(grnId: string) {
    super("INSPECTION_TARGET_NOT_FOUND", `goods receipt ${grnId} does not exist in this tenant`);
  }
}
/** Target shape violations: a production_order target without (or beside) an
 * orderId, a goods_receipt target without a grnId, or a target order that is
 * not COMPLETED (inspections attach to completions — the FG batch exists
 * only once the order completed). */
export class InspectionTargetInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INSPECTION_TARGET_INVALID", message, details);
  }
}
/** Input-shape violations on the inspection itself (sampled/sampleSize
 * consistency, a malformed inspectedAt date). */
export class InspectionInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INSPECTION_INPUT_INVALID", message, details);
  }
}
/** FAIL requires a disposition (ACCEPT | SCRAP | REWORK |
 * RETURN_TO_SUPPLIER) — a failed inspection cannot be recorded without the
 * operator's decision on the goods. */
export class InspectionDispositionRequiredError extends DomainError {
  constructor() {
    super(
      "INSPECTION_DISPOSITION_REQUIRED",
      "a FAIL inspection requires a disposition (ACCEPT, SCRAP, REWORK or RETURN_TO_SUPPLIER)",
    );
  }
}
/** Disposition/result mismatches: PASS carrying a non-ACCEPT disposition, or
 * RETURN_TO_SUPPLIER on a production_order target (goods return to the
 * supplier only makes sense against a goods-receipt target). */
export class InspectionDispositionInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("INSPECTION_DISPOSITION_INVALID", message, details);
  }
}
/** FAIL+SCRAP requires the order's FG batch to be present AND held
 * QUARANTINED (the qc_scrap flow empties the quarantined hold — scrapping a
 * released/active batch is a manual stock issue, not this flow). */
export class QcScrapBatchNotQuarantinedError extends DomainError {
  constructor(details: { orderId: string; batchId: string | null; status: string | null }) {
    super(
      "QC_SCRAP_BATCH_NOT_QUARANTINED",
      `production order ${details.orderId} has no QUARANTINED finished-goods batch to scrap (batch ${details.batchId ?? "none"}, status ${details.status ?? "none"})`,
      details,
    );
  }
}
/** FAIL+SCRAP on a quarantined batch whose on-hand is already zero (the
 * batch was scrapped by an earlier inspection — nothing left to issue). */
export class QcScrapEmptyBatchError extends DomainError {
  constructor(details: { batchId: string; onHand: string }) {
    super(
      "QC_SCRAP_EMPTY_BATCH",
      `quarantined batch ${details.batchId} has no on-hand left to scrap (on-hand ${details.onHand})`,
      details,
    );
  }
}
/** Genealogy entry point: unknown or foreign batch id (A7: unknown-vs-
 * foreign identical — the recall walks never disclose existence). */
export class GenealogyBatchNotFoundError extends DomainError {
  constructor(batchId: string) {
    super("GENEALOGY_BATCH_NOT_FOUND", `batch ${batchId} does not exist in this tenant`);
  }
}
