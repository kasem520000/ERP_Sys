import { DomainError } from "@erp/domain-core";

/**
 * PHASE-007 accounting module domain errors (non-engine surfaces: CoA,
 * calendar, rates, journals, approvals, GL, numbering, close, checklist).
 * Codes are stable API contracts (ERROR_MODEL §4) — the HTTP layer maps
 * each to its status; A7-sensitive not-founds render identically for
 * unknown-vs-foreign ids (no existence disclosure).
 */

// -- CoA (T3) ----------------------------------------------------------------

export class AccountNotFoundError extends DomainError {
  constructor(id: string) {
    super("ACCOUNT_NOT_FOUND", `account ${id} does not exist in this tenant`);
  }
}
export class AccountCodeTakenError extends DomainError {
  constructor(code: string) {
    super("ACCOUNT_CODE_TAKEN", `account code ${code} is already in use`);
  }
}
export class AccountCycleError extends DomainError {
  constructor() {
    super("ACCOUNT_CYCLE", "account parent chain would form a cycle");
  }
}
export class AccountTypeMismatchError extends DomainError {
  constructor(parentType: string, childType: string) {
    super("ACCOUNT_TYPE_MISMATCH", `parent type ${parentType} cannot host child type ${childType} (V3 homogeneous tree)`);
  }
}
export class AccountHasChildrenError extends DomainError {
  constructor(id: string) {
    super("ACCOUNT_HAS_CHILDREN", `account ${id} has children and cannot be deleted (INV-015)`);
  }
}
export class AccountHasPostingsError extends DomainError {
  constructor(id: string) {
    super("ACCOUNT_HAS_POSTINGS", `account ${id} has postings and cannot be deleted (INV-015)`);
  }
}
export class AccountArchivedError extends DomainError {
  constructor(id: string) {
    super("ACCOUNT_ARCHIVED", `account ${id} is archived`);
  }
}
export class AccountMappedToPurposeError extends DomainError {
  constructor(id: string) {
    super("ACCOUNT_MAPPED_TO_PURPOSE", `account ${id} is mapped to a required purpose and cannot be archived (INV-015)`);
  }
}
export class AccountTypeLockedError extends DomainError {
  constructor(id: string) {
    super("ACCOUNT_TYPE_LOCKED", `account ${id} has postings — its type cannot change (V2)`);
  }
}
export class PurposeAlreadyMappedError extends DomainError {
  constructor(purposeKey: string) {
    super("PURPOSE_ALREADY_MAPPED", `purpose ${purposeKey} already has an active mapping (V1 — supersede first)`);
  }
}

// -- fiscal calendar (T4) ------------------------------------------------------

export class FiscalYearNotFoundError extends DomainError {
  constructor(id: string) {
    super("FISCAL_YEAR_NOT_FOUND", `fiscal year ${id} does not exist in this tenant`);
  }
}
export class FiscalYearExistsError extends DomainError {
  constructor(name: string) {
    super("FISCAL_YEAR_EXISTS", `fiscal year ${name} already exists`);
  }
}
export class FiscalYearOverlapError extends DomainError {
  constructor(name: string) {
    super("FISCAL_YEAR_OVERLAP", `fiscal year ${name} overlaps an existing year's REGULAR periods`);
  }
}
export class PeriodNotFoundError extends DomainError {
  constructor(id: string) {
    super("PERIOD_NOT_FOUND", `fiscal period ${id} does not exist in this tenant`);
  }
}
export class PeriodStateError extends DomainError {
  constructor(message: string) {
    super("PERIOD_STATE_INVALID", message);
  }
}
export class PeriodReopenReasonRequiredError extends DomainError {
  constructor() {
    super("REOPEN_REASON_REQUIRED", "reopening a period requires a reason (INV-020)");
  }
}
export class SoftCloseReasonRequiredError extends DomainError {
  constructor() {
    super("SOFT_CLOSE_REASON_REQUIRED", "posting into a soft-closed period requires a reason (PC-02)");
  }
}

// -- FX (T5) ------------------------------------------------------------------

export class ExchangeRateInvalidError extends DomainError {
  constructor(message: string) {
    super("EXCHANGE_RATE_INVALID", message);
  }
}

// -- manual journals / approvals (T9/T11) ---------------------------------------

export class JournalDraftNotFoundError extends DomainError {
  constructor(id: string) {
    super("JOURNAL_DRAFT_NOT_FOUND", `manual journal ${id} does not exist in this tenant`);
  }
}
export class JournalStateError extends DomainError {
  constructor(message: string) {
    super("JOURNAL_STATE_INVALID", message);
  }
}
export class JournalUnbalancedError extends DomainError {
  constructor() {
    super("ENTRY_NOT_BALANCED", "draft lines must balance before submission");
  }
}
export class SelfApprovalBlockedError extends DomainError {
  constructor() {
    super("SELF_APPROVAL_BLOCKED", "the creator cannot approve their own document (SoD, BR-034 — allow_self_approval is OFF)");
  }
}
export class ApprovalLimitExceededError extends DomainError {
  constructor(details: { total: string; limit: string }) {
    super(
      "APPROVAL_LIMIT_EXCEEDED",
      `document total ${details.total} exceeds the approver's base-currency limit ${details.limit} (BR-034)`,
      details,
    );
  }
}
export class ApprovalPolicyInvalidError extends DomainError {
  constructor(message: string) {
    super("APPROVAL_POLICY_INVALID", message);
  }
}
export class ApprovalsPendingError extends DomainError {
  constructor() {
    super("APPROVAL_PENDING", "document is awaiting approval and cannot proceed");
  }
}

// -- recurring (T10) -----------------------------------------------------------

export class RecurringJournalNotFoundError extends DomainError {
  constructor(id: string) {
    super("RECURRING_JOURNAL_NOT_FOUND", `recurring journal ${id} does not exist in this tenant`);
  }
}
export class RecurringTemplateInvalidError extends DomainError {
  constructor(message: string) {
    super("RECURRING_TEMPLATE_INVALID", message);
  }
}

// -- GL / drill-down (T12) ------------------------------------------------------

export class GlAccountNotFoundError extends DomainError {
  constructor(id: string) {
    super("GL_ACCOUNT_NOT_FOUND", `account ${id} does not exist in this tenant`);
  }
}

// -- opening balances / year-end (T14/T15) --------------------------------------

export class OpeningBalanceNotPostableError extends DomainError {
  constructor(message: string) {
    super("OPENING_BALANCE_NOT_POSTABLE", message);
  }
}
export class YearEndCloseError extends DomainError {
  constructor(message: string) {
    super("YEAR_END_CLOSE_INVALID", message);
  }
}
export class FxRevaluationDisabledError extends DomainError {
  constructor() {
    super("FX_REVALUATION_DISABLED", "FX revaluation is disabled for this tenant (BR-036 — accounting.fx_revaluation_enabled)");
  }
}
export class FxRevaluationError extends DomainError {
  constructor(message: string) {
    super("FX_REVALUATION_INVALID", message);
  }
}

// -- numbering (T13) ------------------------------------------------------------

export class NumberingFormatInvalidError extends DomainError {
  constructor(message: string) {
    super("NUMBERING_FORMAT_INVALID", message);
  }
}
export class NumberAlreadyVoidedError extends DomainError {
  constructor(number: string) {
    super("NUMBER_ALREADY_VOIDED", `official number ${number} is already voided`);
  }
}

// -- reconciliation / checklist (T16) --------------------------------------------

export class ReconciliationBrokenError extends DomainError {
  constructor(details: { kind: string; diffCount: number }) {
    super(
      "RECONCILIATION_BROKEN",
      `core reconciliation ${details.kind} is BROKEN (${details.diffCount} diffs) — period cannot lock (PC-04)`,
      details,
    );
  }
}
export class ChecklistNotSatisfiedError extends DomainError {
  constructor(message: string) {
    super("CHECKLIST_NOT_SATISFIED", message);
  }
}

// -- projects (PHASE-019 §8, T44) -------------------------------------------------
// The controller surface of the projects dimension: resource not-found on
// PATCH (the module's 404 shape — A7 parity, no existence disclosure) and
// the tenant-unique natural key on POST (the code-taken 409 family —
// PartnerCodeTakenError/TierCodeDuplicateError pattern; the DB constraint
// uq_projects_tenant_code stays the source of truth, surfaced typed).
// The ENGINE's stamp validation (PROJECT_NOT_FOUND/PROJECT_CLOSED as
// PostingError codes at post time) is a different, T42-shipped plane.

export class ProjectNotFoundError extends DomainError {
  constructor(id: string) {
    super("PROJECT_NOT_FOUND", `project ${id} does not exist in this tenant`);
  }
}
export class ProjectCodeTakenError extends DomainError {
  constructor(code: string) {
    super("PROJECT_CODE_TAKEN", `project code ${code} is already in use`);
  }
}

export const ACCOUNTING_NOT_FOUND_ERRORS: readonly (new (...args: never[]) => DomainError)[] = [
  AccountNotFoundError,
  FiscalYearNotFoundError,
  PeriodNotFoundError,
  JournalDraftNotFoundError,
  RecurringJournalNotFoundError,
  GlAccountNotFoundError,
  ProjectNotFoundError,
];
