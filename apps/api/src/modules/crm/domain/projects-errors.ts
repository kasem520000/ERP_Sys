import { DomainError } from "@erp/domain-core";

/**
 * PHASE-048 (W-9 — Projects & Contracting: the WBS + budgets + actuals
 * engines) domain errors (T-05 + T-06 + T-07 — the plan §3). Codes are
 * stable API contracts (ERROR_MODEL §4) — the HTTP layer maps each to
 * its status; A7-sensitive not-founds render identically for
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
