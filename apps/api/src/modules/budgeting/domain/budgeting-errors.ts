import { DomainError } from "@erp/domain-core";

/**
 * Budgeting-module domain errors (PHASE-028; PHASE-006 error taxonomy —
 * stable codes, bilingual where user-facing, HTTP mapping in the global
 * filter's domainStatus — registered in-phase, see error.filter.ts).
 * Codes follow the notes/fixed_assets precedent: typed 404s never disclose
 * foreign existence (A7 — RLS makes unknown and foreign ids
 * indistinguishable); lifecycle conflicts 409; validation 422.
 *
 * Reused accounting errors (the fixed_assets reuse precedent — already
 * HTTP-registered): FiscalYearNotFoundError / PeriodNotFoundError /
 * AccountNotFoundError / ProjectNotFoundError cover the dimension
 * not-founds; this file owns the budgeting-native taxonomy only.
 */

// -- 404 not-found (A7 parity: unknown == foreign) --------------------------------

/** Foreign/unknown budget id — typed 404 (spoof battery asserts this shape). */
export class BudgetNotFoundError extends DomainError {
  constructor(id: string) {
    super("BUDGET_NOT_FOUND", `Budget ${id} not found`, { id });
  }
}

/** Foreign/unknown cost center on a line — typed 404 (S-04 attack row). */
export class BudgetCostCenterNotFoundError extends DomainError {
  constructor(id: string) {
    super("COST_CENTER_NOT_FOUND", `Cost center ${id} not found`, { id });
  }
}

/** Foreign/unknown branch on a line — typed 404 (S-04 attack row). */
export class BudgetBranchNotFoundError extends DomainError {
  constructor(id: string) {
    super("BRANCH_NOT_FOUND", `Branch ${id} not found`, { id });
  }
}

// -- 409 lifecycle conflicts ------------------------------------------------------

/** Illegal lifecycle transition (the BR-050 machine). */
export class BudgetStateError extends DomainError {
  constructor(details: { budgetId: string; from: string; to: string; reason?: string }) {
    super(
      "BUDGET_STATE_INVALID",
      `Budget ${details.budgetId} cannot move ${details.from} → ${details.to}${details.reason ? `: ${details.reason}` : ""}`,
      details,
    );
  }
}

/**
 * SoD (AUTHORIZATION_MATRIX §4 row budgeting.budgets.approve — BR-034
 * family): the creator can never approve their own budget; the approval
 * stamp requires a distinct approver (the journal/fixed_assets precedent).
 */
export class BudgetSelfApprovalError extends DomainError {
  constructor(details: { budgetId: string; actorId: string }) {
    super(
      "BUDGET_SELF_APPROVAL",
      `Actor ${details.actorId} created budget ${details.budgetId} — self-approval is blocked (SoD, AUTHORIZATION_MATRIX §4)`,
      details,
    );
  }
}

/**
 * Line edits on a non-DRAFT budget (phase §4: 409 IMMUTABLE_DOCUMENT — the
 * exact code the contract pins). REVISED/CLOSED versions freeze rows at
 * the version level; ACTIVE budgets supersede, never edit.
 */
export class BudgetImmutableError extends DomainError {
  constructor(details: { budgetId: string; status: string }) {
    super(
      "IMMUTABLE_DOCUMENT",
      `Budget ${details.budgetId} is ${details.status} — only DRAFT budgets accept line edits (revise via supersede, BR-050)`,
      details,
    );
  }
}

/** Activation without a prior approval stamp (the two-step gate). */
export class BudgetNotApprovedError extends DomainError {
  constructor(details: { budgetId: string; status: string }) {
    super(
      "BUDGET_NOT_APPROVED",
      `Budget ${details.budgetId} is ${details.status} with no approval stamp — approve (a distinct approver) before activating`,
      details,
    );
  }
}

/**
 * A second ACTIVE version per (fiscal year, scope) at the service level
 * (BR-050). The DB partial unique `uq_budgets_one_active` is the race
 * backstop; this typed 409 is the honest service-level message.
 */
export class BudgetActiveExistsError extends DomainError {
  constructor(details: { fiscalYearId: string; scope: string; activeBudgetId: string }) {
    super(
      "BUDGET_ACTIVE_EXISTS",
      `An ACTIVE budget already exists for fiscal year ${details.fiscalYearId} scope ${details.scope} (${details.activeBudgetId}) — supersede it, never activate a sibling (BR-050)`,
      details,
    );
  }
}

// -- 422 validation ---------------------------------------------------------------

/** A line's fiscal period does not belong to the budget's fiscal year. */
export class BudgetPeriodMismatchError extends DomainError {
  constructor(details: { budgetId: string; fiscalYearId: string; fiscalPeriodId: string }) {
    super(
      "BUDGET_PERIOD_MISMATCH",
      `Period ${details.fiscalPeriodId} does not belong to the budget's fiscal year ${details.fiscalYearId}`,
      details,
    );
  }
}

/**
 * Dimension keys inconsistent with the scope (scope is a filter, not a
 * fork — the grid groups by exactly one optional dimension per scope).
 */
export class BudgetScopeDimensionError extends DomainError {
  constructor(details: { scope: string; reason: string }) {
    super(
      "BUDGET_SCOPE_DIMENSION",
      `Line dimensions are inconsistent with scope ${details.scope}: ${details.reason}`,
      details,
    );
  }
}

/** Bulk grid replace over the 20,000-line bound (the U-07 row-cap pattern). */
export class BudgetLineLimitError extends DomainError {
  constructor(details: { lineCount: number; max: number }) {
    super(
      "BUDGET_LINE_LIMIT",
      `Grid carries ${details.lineCount} lines — over the ${details.max}-line bound (split the import per dimension)`,
      details,
    );
  }
}

/** Duplicate (period × dimension key) rows in one payload. */
export class BudgetDuplicateLineError extends DomainError {
  constructor(details: { fiscalPeriodId: string; accountId: string; key: string }) {
    super(
      "BUDGET_DUPLICATE_LINE",
      `Duplicate grid line for period ${details.fiscalPeriodId} account ${details.accountId} (${details.key}) — one row per period × dimension key`,
      details,
    );
  }
}

/** One offending key of a BR-051 evaluation (the typed block payload). */
export interface BudgetExceededKey {
  readonly accountId: string;
  readonly periodId: string;
  readonly budgetAmount: string;
  readonly actualAmount: string;
  readonly projectedAmount: string;
  readonly percentUsed: string;
}

/**
 * The BR-051 typed block reason (ENFORCE_DRAFT mode ONLY): the DRAFT-stage
 * save would push the period over budget. Audited on the document before
 * the throw — visible, typed, never an engine side-effect (DR-004).
 */
export class BudgetExceededError extends DomainError {
  constructor(readonly keys: readonly BudgetExceededKey[]) {
    super(
      "BUDGET_EXCEEDED",
      `Over budget on ${keys.length} period line(s) — the tenant policy is ENFORCE_DRAFT (BR-051; revise the budget or reduce the document)`,
      { keys },
    );
  }
}

/** Import over the 5,000-data-row bound (the U-07 pattern). */
export class BudgetImportRowLimitError extends DomainError {
  constructor(details: { rowCount: number; max: number }) {
    super(
      "BUDGET_IMPORT_ROW_LIMIT",
      `Import carries ${details.rowCount} data rows — over the ${details.max}-row bound`,
      details,
    );
  }
}

/** Import headers match neither the AR nor the EN fixture set. */
export class BudgetImportFormatError extends DomainError {
  constructor(details: { reason: string }) {
    super(
      "BUDGET_IMPORT_FORMAT",
      `Import file is not a budget grid: ${details.reason}`,
      details,
    );
  }
}

/** Per-row import error (dry-run report entries / commit rejection). */
export interface BudgetImportRowIssue {
  readonly rowNo: number;
  readonly messageAr: string;
  readonly messageEn: string;
}

/** Committing a grid whose dry-run rows carry errors. */
export class BudgetImportRowError extends DomainError {
  constructor(readonly issues: readonly BudgetImportRowIssue[]) {
    super(
      "BUDGET_IMPORT_ROW",
      `Import carries ${issues.length} invalid row(s) — fix them and re-run the dry-run`,
      { issues },
    );
  }
}
