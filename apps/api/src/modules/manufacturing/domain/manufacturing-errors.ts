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

// -- PHASE-042: work centers (M-03/H-04) ---------------------------------------------

/** Unknown or foreign work-center id (A7: no existence disclosure). */
export class WorkCenterNotFoundError extends DomainError {
  constructor(id: string) {
    super("WORK_CENTER_NOT_FOUND", `work center ${id} does not exist in this tenant`);
  }
}
/** uq_work_centers_tenant_code — the code is taken (a concurrent create or a
 * duplicate master-data code; corrections are renames, never shadow rows). */
export class WorkCenterCodeConflictError extends DomainError {
  constructor(code: string) {
    super("WORK_CENTER_CODE_CONFLICT", `work center code ${code} is already in use in this tenant`, {
      code,
    });
  }
}
/** Work-center input violations (bad code shape, capacity outside (0, 24],
 * shifts outside 1..6, a negative rate, a malformed decimal). */
export class WorkCenterInputInvalidError extends DomainError {
  constructor(message: string) {
    super("WORK_CENTER_INPUT_INVALID", message);
  }
}
/** INACTIVE blocked: the center is referenced by an ACTIVE routing's
 * operations or by live (non-terminal) frozen operation rows. */
export class WorkCenterInUseError extends DomainError {
  constructor(details: { workCenterId: string; activeRoutingOperations: number; liveOperations: number }) {
    super(
      "WORK_CENTER_IN_USE",
      `work center ${details.workCenterId} is referenced by ${details.activeRoutingOperations} ACTIVE-routing operations and ${details.liveOperations} live order operations — deactivate the referencing routings / finish the operations first`,
      details,
    );
  }
}
/** A routing operation names a work center that is not ACTIVE (the freeze
 * would capture rates the floor cannot execute against). */
export class WorkCenterNotActiveError extends DomainError {
  constructor(workCenterId: string, status: string) {
    super("WORK_CENTER_NOT_ACTIVE", `work center ${workCenterId} is ${status} — routing operations require an ACTIVE work center`, {
      workCenterId,
      status,
    });
  }
}

// -- PHASE-042: routings (M-02) -------------------------------------------------------

/** Unknown or foreign routing id (A7: no existence disclosure). */
export class RoutingNotFoundError extends DomainError {
  constructor(id: string) {
    super("ROUTING_NOT_FOUND", `routing ${id} does not exist in this tenant`);
  }
}
/** Edit/activate attempted on a non-DRAFT routing where DRAFT is required. */
export class RoutingNotDraftError extends DomainError {
  constructor(message: string) {
    super("ROUTING_NOT_DRAFT", message);
  }
}
/** The one-active invariant: another ACTIVE routing exists for the item
 * (uq_routings_active_item — the 23505 race backstop). */
export class RoutingActiveExistsError extends DomainError {
  constructor(itemId: string, activeRoutingId: string | null) {
    super("ROUTING_ACTIVE_EXISTS", `item ${itemId} already has another ACTIVE routing (one active per item)`, {
      itemId,
      activeRoutingId,
    });
  }
}
/** uq_routings_tenant_item_version — the (item, version) slot is taken. */
export class RoutingVersionConflictError extends DomainError {
  constructor(itemId: string, versionNo: number) {
    super("ROUTING_VERSION_CONFLICT", `version ${versionNo} for item ${itemId} is already in use in this tenant`, {
      itemId,
      versionNo,
    });
  }
}
/** Routing-operation violations: duplicate/out-of-range sequences, negative
 * times, an unpaired rate override, a dangling work center. */
export class RoutingOperationInvalidError extends DomainError {
  constructor(message: string) {
    super("ROUTING_OPERATION_INVALID", message);
  }
}

// -- PHASE-042: order operations (M-02/M-17/M-18/M-13/M-19) ----------------------------

/** Unknown operation (order + sequence pair) — A7-shaped. */
export class OperationNotFoundError extends DomainError {
  constructor(orderId: string, sequence: number) {
    super("OPERATION_NOT_FOUND", `operation ${sequence} of production order ${orderId} does not exist in this tenant`);
  }
}
/** An off-machine operation transition (start on COMPLETED, pause on
 * PENDING, …); the legal idempotent replays are NOT this error. */
export class OperationStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("OPERATION_STATE", message, details);
  }
}
/** INV-028: an operation starts only after every lower-sequence operation is
 * COMPLETED or SKIPPED — the blocking sequence is in the details. */
export class OperationSequenceError extends DomainError {
  constructor(details: { orderId: string; sequence: number; blockedBy: number; blockedByStatus: string }) {
    super(
      "OPERATION_SEQUENCE",
      `operation ${details.sequence} of production order ${details.orderId} cannot start — operation ${details.blockedBy} is still ${details.blockedByStatus} (INV-028: the sequence gate)`,
      details,
    );
  }
}
/** A G-40 completion whose rounded credit legs cannot equal the WIP debit at
 * 4dp — honest fail-closed (fixtures use exactly-representable numbers). */
export class OperationCostRoundingError extends DomainError {
  constructor(details: { debit: string; credits: string }) {
    super(
      "OPERATION_COST_ROUNDING",
      `operation conversion credits ${details.credits} do not equal the WIP debit ${details.debit} at 4dp — completion refuses a rounding residue`,
      details,
    );
  }
}
/** Skip SoD: the approver must be a real (ACTIVE) user distinct from the
 * scanning actor — self-approval is blocked (the BR-034 house pattern). */
export class SelfApprovalBlockedError extends DomainError {
  constructor(approverId: string) {
    super(
      "SELF_APPROVAL_BLOCKED",
      `the skip approver ${approverId} must be a distinct active user — the actor cannot approve their own skip`,
      { approverId },
    );
  }
}
/** The approver id names no real user (unknown or foreign — A7-shaped). */
export class ApproverNotFoundError extends DomainError {
  constructor(approverId: string) {
    super("APPROVER_NOT_FOUND", `the skip approver ${approverId} is not a user in this tenant`);
  }
}
/** Operation scrap qty > 0 without a reason code (the service gate; the DB
 * ck_production_order_operations_scrap CHECK is the floor). */
export class OperationScrapReasonRequiredError extends DomainError {
  constructor(sequence: number) {
    super(
      "OPERATION_SCRAP_REASON_REQUIRED",
      `operation ${sequence} scraped units without a reason code — statistical scrap always explains itself`,
      { sequence },
    );
  }
}
/** A routing-bound order cannot complete while any operation is
 * PENDING/SETUP/RUNNING/PAUSED (SKIPPED counts as resolved). */
export class OperationsIncompleteError extends DomainError {
  constructor(orderId: string, liveOperations: number) {
    super(
      "OPERATIONS_INCOMPLETE",
      `production order ${orderId} still has ${liveOperations} live operations (PENDING/SETUP/RUNNING/PAUSED) — finish or skip them before completing the order`,
      { orderId, liveOperations },
    );
  }
}
/** The shop-floor scan code is malformed (M-17: OP:<orderId>:<seq>:<action>). */
export class ScanCodeFormatError extends DomainError {
  constructor(code: string) {
    super("SCAN_CODE_FORMAT", `scan code must be OP:<orderId>:<sequence>:<start|pause|resume|complete> — got ${code}`);
  }
}

// -- PHASE-042: rework orders (M-14) ---------------------------------------------------

/** Unknown or foreign rework-order id (A7: no existence disclosure). */
export class ReworkOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("REWORK_ORDER_NOT_FOUND", `rework order ${id} does not exist in this tenant`);
  }
}
/** An off-lifecycle rework transition (release on RELEASED, complete on
 * DRAFT, cancel on COMPLETED, …); legal idempotent replays are not this. */
export class ReworkOrderStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("REWORK_ORDER_STATE", message, details);
  }
}
/** The rework item must be the parent order's item (the simple v1 rule —
 * component rework rides stock issues, not rework orders). */
export class ReworkItemMismatchError extends DomainError {
  constructor(parentItemId: string, itemId: string) {
    super(
      "REWORK_ITEM_MISMATCH",
      `the rework item must equal the parent order's item (${parentItemId}) — got ${itemId}`,
      { parentItemId, itemId },
    );
  }
}
/** Completion with zero conversion value — ck_rework_orders_completion
 * requires rework_value > 0: a rework that cost nothing did not happen. */
export class ReworkCostZeroError extends DomainError {
  constructor(id: string) {
    super("REWORK_COST_ZERO", `rework order ${id} completed with a zero conversion value — a rework that cost nothing did not happen`, {
      id,
    });
  }
}

// -- PHASE-042: downtime records (M-15) ------------------------------------------------

/** Unknown or foreign downtime-record id (A7: no existence disclosure). */
export class DowntimeRecordNotFoundError extends DomainError {
  constructor(id: string) {
    super("DOWNTIME_RECORD_NOT_FOUND", `downtime record ${id} does not exist in this tenant`);
  }
}
/** Downtime input violations (reason outside the closed vocabulary, duration
 * outside 0..1440, ended-before-started, a malformed timestamp, an unpaired
 * order/operation link). */
export class DowntimeInputInvalidError extends DomainError {
  constructor(message: string) {
    super("DOWNTIME_INPUT_INVALID", message);
  }
}
/** Close attempted on an already-closed record (the log is append-shaped —
 * corrections are new records, never rewrites of a closed window). */
export class DowntimeAlreadyClosedError extends DomainError {
  constructor(id: string) {
    super("DOWNTIME_ALREADY_CLOSED", `downtime record ${id} is already closed — corrections are a new record`);
  }
}

// -- PHASE-042: item standard costs (L2-12) --------------------------------------------

/** Unknown or foreign standard-cost id (A7: no existence disclosure). */
export class StandardCostNotFoundError extends DomainError {
  constructor(id: string) {
    super("STANDARD_COST_NOT_FOUND", `item standard cost ${id} does not exist in this tenant`);
  }
}
/** Edit/activate attempted on a non-DRAFT standard where DRAFT is required. */
export class StandardCostNotDraftError extends DomainError {
  constructor(message: string) {
    super("STANDARD_COST_NOT_DRAFT", message);
  }
}
/** The one-active invariant: another ACTIVE standard exists for the item
 * (uq_item_standard_costs_active_item — the 23505 race backstop). */
export class StandardCostActiveExistsError extends DomainError {
  constructor(itemId: string, activeId: string | null) {
    super("STANDARD_COST_ACTIVE_EXISTS", `item ${itemId} already has another ACTIVE standard (one active per item)`, {
      itemId,
      activeId,
    });
  }
}
/** uq_item_standard_costs_tenant_item_version — the slot is taken. */
export class StandardCostVersionConflictError extends DomainError {
  constructor(itemId: string, versionNo: number) {
    super("STANDARD_COST_VERSION_CONFLICT", `version ${versionNo} for item ${itemId} is already in use in this tenant`, {
      itemId,
      versionNo,
    });
  }
}
/** Standard-cost input violations (a negative cost, a malformed decimal, a
 * sub-split shape violation, sub-splits that do not sum to the overhead). */
export class StandardCostInvalidError extends DomainError {
  constructor(message: string) {
    super("STANDARD_COST_INVALID", message);
  }
}
/** rollUp fail-closed: a level-1 BOM component carries no ACTIVE standard —
 * the named components must roll first (the low-level code discipline). */
export class StandardCostMissingError extends DomainError {
  constructor(componentItemIds: readonly string[]) {
    super(
      "STANDARD_COST_MISSING",
      `components ${componentItemIds.join(", ")} have no ACTIVE standard cost — roll them up before the parent`,
      { componentItemIds: [...componentItemIds] },
    );
  }
}
/** An explicit revaluation over stocked warehouses whose delta nets to zero
 * — a zero-value journal cannot post (new standard == old standard). */
export class StandardRevaluationZeroError extends DomainError {
  constructor(itemId: string) {
    super(
      "STANDARD_REVALUATION_ZERO",
      `the revaluation of item ${itemId} nets to zero (the new standard equals the previous ACTIVE standard) — nothing to revalue`,
      { itemId },
    );
  }
}

// -- PHASE-043 — MRP & Planning (the planning slice) --------------------------------
//
// The planning family (MRP runs, suggestions, MPS, BOR, ATP, tolling) is
// planning data — no run or suggestion posts a journal (the budgeting
// precedent; JOURNAL_RULES §7 note). Only the conversion legs reach real
// documents (PO/MO/transfer through their owning services) and only the
// tolling legs + the co/by-product completion post (G-48/G-47).

/** Unknown or foreign MRP run id (A7: no existence disclosure). */
export class MrpRunNotFoundError extends DomainError {
  constructor(id: string) {
    super("MRP_RUN_NOT_FOUND", `MRP run ${id} does not exist in this tenant`);
  }
}
/** Unknown or foreign MRP suggestion id (A7). */
export class MrpSuggestionNotFoundError extends DomainError {
  constructor(id: string) {
    super("MRP_SUGGESTION_NOT_FOUND", `MRP suggestion ${id} does not exist in this tenant`);
  }
}
/** A suggestion lifecycle violation: accept/dismiss on a non-SUGGESTED row
 * (ACCEPTED/DISMISSED/SUPERSEDED are terminal — BR-079). */
export class MrpSuggestionStateError extends DomainError {
  constructor(id: string, status: string, action: string) {
    super("MRP_SUGGESTION_STATE_INVALID", `suggestion ${id} is ${status} — ${action} is only legal on SUGGESTED rows`, {
      suggestionId: id,
      status,
      action,
    });
  }
}
/** A run-parameter violation (bad horizon, bucket, scope, or dates). */
export class MrpRunInputInvalidError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("MRP_RUN_INPUT_INVALID", message, details);
  }
}
/** Dismissal requires a reason of 1..300 chars (BR-079). */
export class MrpDismissReasonRequiredError extends DomainError {
  constructor() {
    super("MRP_DISMISS_REASON_REQUIRED", "dismissing a suggestion requires a reason of 1..300 characters");
  }
}
/** The idempotent conversion failed: the suggestion already carries its
 * document (INV-030 — the retry must return the ORIGINAL, so this fires
 * only when the stored link cannot be honored, e.g. the document vanished). */
export class MrpConversionConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("MRP_CONVERSION_CONFLICT", message, details);
  }
}
/** A conversion prerequisite failed (no approved supplier for a PURCHASE
 * conversion under the BLOCK gate; a missing from-warehouse for a
 * TRANSFER). */
export class MrpConversionPrerequisiteError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("MRP_CONVERSION_PREREQUISITE", message, details);
  }
}
/** MPS entry input violations (bad bucket/qty/status, a malformed slot). */
export class MpsEntryInvalidError extends DomainError {
  constructor(message: string) {
    super("MPS_ENTRY_INVALID", message);
  }
}
/** Unknown or foreign MPS entry id (A7). */
export class MpsEntryNotFoundError extends DomainError {
  constructor(id: string) {
    super("MPS_ENTRY_NOT_FOUND", `MPS entry ${id} does not exist in this tenant`);
  }
}
/** Editing an MPS entry inside the item's frozen fence without the
 * manufacturing.mps.frozen_edit permission — BR-078's typed rejection
 * (with the permission, a reason is still required). */
export class MpsFrozenFenceEditError extends DomainError {
  constructor(itemId: string, bucketStart: string, frozenDays: number) {
    super(
      "MPS_FROZEN_FENCE_EDIT",
      `bucket ${bucketStart} of item ${itemId} sits inside the frozen fence (${frozenDays} days) — the mps.frozen_edit permission is required`,
      { itemId, bucketStart, frozenDays },
    );
  }
}
/** A frozen-fence edit carried no reason (the permission was held, but the
 * reason discipline is unconditional inside the fence — BR-078). */
export class MpsFrozenReasonRequiredError extends DomainError {
  constructor() {
    super("MPS_FROZEN_REASON_REQUIRED", "edits inside the frozen fence require a reason of 1..300 characters");
  }
}
/** BOM activation with co/by-product outputs whose joint allocation does
 * not sum to exactly 100 (main + Σ outputs) — acceptance criterion 8's
 * typed rejection (G-47). */
export class BomAllocationInvalidError extends DomainError {
  constructor(bomId: string, mainPct: string, outputsTotal: string, grandTotal: string) {
    super(
      "BOM_ALLOCATION_INVALID",
      `BOM ${bomId}: main ${mainPct}% + outputs ${outputsTotal}% = ${grandTotal}% — the joint allocation must sum to exactly 100%`,
      { bomId, mainPct, outputsTotal, grandTotal },
    );
  }
}
/** A substitution row violation (bad priority, a dangling substitute, a
 * duplicate, self-substitution). */
export class BomSubstitutionInvalidError extends DomainError {
  constructor(message: string) {
    super("BOM_SUBSTITUTION_INVALID", message);
  }
}
/** A co/by-product output row violation (bad kind/percentage/qty/uom, a
 * duplicate output item, an output equal to the main item). */
export class BomOutputInvalidError extends DomainError {
  constructor(message: string) {
    super("BOM_OUTPUT_INVALID", message);
  }
}
/** A bill-of-resources row violation (bad kind/factor/line, a dangling
 * work center or item, both-or-neither resource refs). */
export class BorInvalidError extends DomainError {
  constructor(message: string) {
    super("BOR_INVALID", message);
  }
}
/** ATP/CTP input violations (a non-positive qty, a malformed date). */
export class AtpInputInvalidError extends DomainError {
  constructor(message: string) {
    super("ATP_INPUT_INVALID", message);
  }
}
/** Unknown or foreign tolling order id (A7). */
export class TollingOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("TOLLING_ORDER_NOT_FOUND", `contract manufacturing order ${id} does not exist in this tenant`);
  }
}
/** A tolling lifecycle violation (issue on ISSUED, return on DRAFT, settle
 * with an unbalanced ledger — the Σ issue = Σ return + Σ yield invariant,
 * acceptance criterion 7 / G-48). */
export class TollingStateError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("TOLLING_STATE_INVALID", message, details);
  }
}
/** A tolling input violation (bad qty/fee/dates, an empty material list). */
export class TollingInputInvalidError extends DomainError {
  constructor(message: string) {
    super("TOLLING_INPUT_INVALID", message);
  }
}
/** The MTO link shape violation (a link to a line of another item, a link
 * on a non-DRAFT order — M-22). */
export class MtoLinkInvalidError extends DomainError {
  constructor(message: string) {
    super("MTO_LINK_INVALID", message);
  }
}
/** The reservation policy engine's typed rejection (a policy that cannot
 * be honored: an unknown strategy, a non-positive target, an
 * over-reservation against available bins — I-14). */
export class ReservationPolicyError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("RESERVATION_POLICY_INVALID", message, details);
  }
}
