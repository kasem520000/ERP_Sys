import { DomainError } from "@erp/domain-core";

/**
 * PHASE-048 (Projects & Contracting) domain errors (W-9: the WBS +
 * budgets + actuals engines T-05…T-07; W-10: the EVM engine T-08, the
 * change-order gate T-09, the IAS-23 service D-11 — the plan §3). Codes
 * are stable API contracts (ERROR_MODEL §4) — the HTTP layer maps each
 * to its status; A7-sensitive not-founds render identically for
 * unknown-vs-foreign ids. The projects substrate itself is accounting's
 * (D-01: extended, never replaced) — these are the ENGINE's refusals,
 * never the GL's.
 */

// -- T-05: the WBS tree (BR-095 / D-03) -------------------------------------

/** Unknown or foreign WBS task id (A7: no existence disclosure). */
export class WbsTaskNotFoundError extends DomainError {
  constructor(id: string) {
    super("WBS_TASK_NOT_FOUND", `WBS task ${id} does not exist in this tenant`);
  }
}

/** Unknown or foreign project id on the WBS plane (A7). */
export class ProjectPlaneNotFoundError extends DomainError {
  constructor(projectId: string) {
    super("PROJECT_PLANE_NOT_FOUND", `project ${projectId} does not exist in this tenant`);
  }
}

/** WBS-level input validation (codes, dates, weights, percents) — the
 * 422 policy class for the WBS slice. */
export class WbsInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("WBS_INPUT_INVALID", message, details);
  }
}

/**
 * D-03's cycle refusal — the dependency edge or the parent move would
 * close a loop. The details carry the cycle path (the ordered node ids)
 * so the refusal is actionable; the API is the ONLY move path, and this
 * guard fires BEFORE any write (the illegal state never saves).
 */
export class WbsCycleError extends DomainError {
  constructor(message: string, details: { cyclePath: readonly string[] }) {
    super("WBS_CYCLE", message, details);
  }
}

/** The cross-project contamination guard: a parent, a predecessor, or a
 * budget line's WBS node must belong to the SAME project as the row
 * being written (the composite tenant FK protects the tenant; the
 * engine protects the project boundary). */
export class WbsCrossProjectError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("WBS_CROSS_PROJECT", message, details);
  }
}

/** The children-first law: the parent/predecessor RESTRICT edges mean a
 * task with dependents or children cannot be deleted until they move
 * away first (the evidence order). */
export class WbsTaskInUseError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("WBS_TASK_IN_USE", message, details);
  }
}

// -- T-06: the budgets + allocations (D-04) ----------------------------------

/** Unknown or foreign budget id (A7). */
export class ProjectBudgetNotFoundError extends DomainError {
  constructor(id: string) {
    super("PROJECT_BUDGET_NOT_FOUND", `project budget ${id} does not exist in this tenant`);
  }
}

/** Budget-level input validation (names, windows, money shapes) — the
 * 422 policy class for the budget slice. */
export class BudgetInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("BUDGET_INPUT_INVALID", message, details);
  }
}

/** The lifecycle guard: DRAFT budgets accept line edits; APPROVED is
 * the variance truth (PV reads it alone — D-04); CLOSED is readable
 * history. A status conflict is the typed 409 (the 028 precedent). */
export class BudgetStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("BUDGET_STATE", message, details);
  }
}

/** Allocation-level input validation + the XOR target law (EMPLOYEE xor
 * ASSET — the 0101 CHECK's service-side mirror with the actionable
 * message). */
export class AllocationInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("ALLOCATION_INPUT_INVALID", message, details);
  }
}

/** Unknown or foreign allocation id (A7). */
export class AllocationNotFoundError extends DomainError {
  constructor(id: string) {
    super("ALLOCATION_NOT_FOUND", `project resource allocation ${id} does not exist in this tenant`);
  }
}

// -- T-07: the actual collectors + INV-033 (D-05) ----------------------------

/** Actuals-plane input validation (windows, asOf shapes). */
export class ActualsInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("ACTUALS_INPUT_INVALID", message, details);
  }
}

/**
 * INV-033 (the EVM consistency invariant — D-05's wording, the
 * INV-032(b) tolerance-0 spirit): the four-leg AC (labor + materials +
 * subcontract + allocated overhead) must reconcile to the GL project
 * dimension TO THE CENT. The typed reconciliation service REFUSES to
 * report at any residual — this error carries the per-leg breakdown and
 * the residual so the refusal is auditable and actionable.
 */
export class Inv033ReconciliationError extends DomainError {
  constructor(
    message: string,
    details: {
      projectId: string;
      labor: string;
      materials: string;
      subcontract: string;
      overheadAllocated: string;
      acTotal: string;
      glProjectDimension: string;
      residual: string;
    },
  ) {
    super("INV033_RECONCILIATION", message, details);
  }
}

// -- W-10 / T-08: the EVM engine (D-06) --------------------------------------

/** EVM-plane input validation (asOf shapes, budget ids). */
export class EvmInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("EVM_INPUT_INVALID", message, details);
  }
}

/**
 * THE EV CEILING REFUSAL (acceptance #4 / D-06): the earned value
 * never exceeds the approved budget at the scope it is earned against
 * — a node's EV against the node's planned cells, the project's EV
 * against BAC (the approved budget + the approved change-order deltas).
 * The boundary EV = budget is legal (100% complete earns exactly the
 * budget); any excess is the typed refusal carrying the figures.
 */
export class EvCeilingExceededError extends DomainError {
  constructor(
    message: string,
    details: { ev: string; budget: string; percent: string | null },
  ) {
    super("EV_CEILING_EXCEEDED", message, details);
  }
}

// -- W-10 / T-09: the change-order gate (BR-094 / G-58 / D-07) ----------------

/** Unknown or foreign change-order id (A7: no existence disclosure). */
export class ChangeOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("CHANGE_ORDER_NOT_FOUND", `change order ${id} does not exist in this tenant`);
  }
}

/** Change-order input validation (titles, the signed delta shapes,
 * the non-zero schedule delta, the rejection reason). */
export class ChangeOrderInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CHANGE_ORDER_INPUT_INVALID", message, details);
  }
}

/**
 * The gate's lifecycle law (BR-094): DRAFT → SUBMITTED → APPROVED /
 * REJECTED — a wrong-state transition, a raced CAS move, or an edit on
 * a decided order is the typed 409-class refusal (the 045
 * simple-approval shape; the order stays exactly as it was).
 */
export class ChangeOrderStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CHANGE_ORDER_STATE", message, details);
  }
}

/**
 * G-58's exactly-once stamp (D-07): the effect application is
 * SINGLE-USE — `effect_applied_at` is consumed exactly once; a second
 * application attempt is the typed refusal (INV-013's engine-level
 * idempotency converges retries; the stamp refuses re-application).
 */
export class ChangeOrderEffectAlreadyAppliedError extends DomainError {
  constructor(message: string, details: { changeOrderId: string; effectAppliedAt: string }) {
    super("CHANGE_ORDER_EFFECT_ALREADY_APPLIED", message, details);
  }
}

// -- W-10 / D-11: the IAS-23 capitalization service ---------------------------

/** IAS-23-plane input validation (asOf shapes, project ids). */
export class Ias23InputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_INPUT_INVALID", message, details);
  }
}

/**
 * THE RATE REGISTER'S LAW (D-11 / R-04 — REQUIRES_VERIFICATION): the
 * capitalization rate register (`projects.ias23_capitalization_rate`)
 * is tenant-entered WITH SOURCE EVIDENCE and the explicit verified
 * acknowledgement; while unset, malformed, or unverified the
 * capitalization computation AND the posting REFUSE — never a
 * fabricated rate (red line 5, the BR-055 family).
 */
export class Ias23RateUnverifiedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_RATE_UNVERIFIED", message, details);
  }
}

/**
 * The window law: a qualifying project carries at least one WBS task
 * with BOTH schedule dates — the window [min start, max end] is the
 * construction window; without it the capitalization refuses (never a
 * fabricated window).
 */
export class Ias23WindowUndefinedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_WINDOW_UNDEFINED", message, details);
  }
}

/**
 * The scope law: the capitalization rides the APPROVED budget's lines
 * (D-11) — a project with no APPROVED budget (or whose window overlaps
 * no line) has nothing to capitalize and the typed refusal names it.
 */
export class Ias23ScopeEmptyError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_SCOPE_EMPTY", message, details);
  }
}

/**
 * The never-future stop rule: the POSTING arm of the capitalization
 * covers ELAPSED expenditure only — asOf beyond today is the typed
 * refusal (the projection arm stays free: the preview computes at any
 * asOf and says so).
 */
export class Ias23AsOfInFutureError extends DomainError {
  constructor(message: string, details: { asOf: string; today: string }) {
    super("IAS23_AS_OF_IN_FUTURE", message, details);
  }
}

/**
 * The honest-empty posting refusal: a capitalization run whose total
 * capitalized amount is zero (every line's eligible accrual is zero —
 * the rate may be 0, the window may not have started) has nothing to
 * post and refuses rather than minting an empty entry.
 */
export class Ias23NothingToCapitalizeError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_NOTHING_TO_CAPITALIZE", message, details);
  }
}

/**
 * The single-use posting stamp: a window already POSTED (the
 * `ias23_capitalizations` rows carry status POSTED for this
 * budget-line/window slice) refuses re-capitalization — the history is
 * computation evidence (no delete, the 0103 law); a re-planned window
 * opens a NEW slice, never a re-post of the old one.
 */
export class Ias23AlreadyPostedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("IAS23_ALREADY_POSTED", message, details);
  }
}
