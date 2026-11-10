/**
 * Budgeting shared types (PHASE-028; DATA_DICTIONARY §9 enums —
 * `budget_scope` and `budget_status`): scope is a filter, not a fork — the
 * four scopes share one engine and one report set; the scope decides only
 * which optional dimension key the grid groups by.
 */

export type BudgetScope = "ACCOUNTS" | "COST_CENTERS" | "PROJECTS" | "BRANCHES";

export type BudgetStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "REVISED" | "CLOSED";

export const BUDGET_SCOPES: readonly BudgetScope[] = [
  "ACCOUNTS",
  "COST_CENTERS",
  "PROJECTS",
  "BRANCHES",
];

/** The legal lifecycle transitions (BR-050 — the frozen machine). */
export const BUDGET_TRANSITIONS: Readonly<Record<BudgetStatus, readonly BudgetStatus[]>> =
  Object.freeze({
    DRAFT: ["PENDING_APPROVAL"],
    PENDING_APPROVAL: ["ACTIVE"],
    ACTIVE: ["REVISED", "CLOSED"],
    REVISED: ["CLOSED"],
    CLOSED: [],
  });

/** Which optional dimension a scope REQUIRES on its lines (null = none). */
export function scopeDimension(scope: BudgetScope):
  | "costCenterId"
  | "projectId"
  | "branchId"
  | null {
  switch (scope) {
    case "COST_CENTERS":
      return "costCenterId";
    case "PROJECTS":
      return "projectId";
    case "BRANCHES":
      return "branchId";
    case "ACCOUNTS":
      return null;
  }
}

/** One grid line as submitted by the API (amount = canonical 4dp string). */
export interface BudgetLineInput {
  readonly fiscalPeriodId: string;
  readonly accountId: string;
  readonly costCenterId?: string | null;
  readonly projectId?: string | null;
  readonly branchId?: string | null;
  readonly amount: string;
}

/** One consumption banner key: the budget side vs the GL-derived actual. */
export interface ConsumptionKeyRow {
  readonly accountId: string;
  readonly costCenterId: string | null;
  readonly projectId: string | null;
  readonly branchId: string | null;
  readonly budget: string;
  readonly actual: string;
  readonly thresholdBudget: string;
}
