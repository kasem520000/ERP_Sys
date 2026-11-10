import { DomainError } from "@erp/domain-core";

/**
 * PHASE-019 CRM module domain errors (T45 — the leads + tasks/activities
 * slice; T46/T48 append the contract + service-order sets below). Codes are
 * stable API contracts (ERROR_MODEL §4) — the HTTP layer maps each to its
 * status; A7-sensitive not-founds render identically for unknown-vs-foreign
 * ids. Leads are NOT legal documents (no numbering, no ledger effects —
 * MASTER-PLAN §2); tasks/activities are operational rows only.
 */

// -- leads (T45; the NEW → QUALIFIED → CONVERTED/LOST intake pipeline) ----

/** Unknown or foreign lead id (A7: no existence disclosure). */
export class LeadNotFoundError extends DomainError {
  constructor(id: string) {
    super("LEAD_NOT_FOUND", `lead ${id} does not exist in this tenant`);
  }
}
/** Lead-level input validation (name shape, a malformed enum, a missing
 * owner, …) — the 422 policy class for the lead slice. */
export class LeadInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("LEAD_INPUT_INVALID", message, details);
  }
}
/**
 * The immutability guard: a CONVERTED lead is frozen forever (further
 * PUT/qualify/lose/convert → this typed error — MASTER-PLAN §2), and the
 * guarded operations require NEW/QUALIFIED (a LOST lead hitting the guard
 * carries an honest LOST message; the code stays the stable contract).
 */
export class LeadConvertedError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("LEAD_CONVERTED", message, details);
  }
}
/** LOST requires a reason (1..200 chars — the ck_leads_lost_reason_shape
 * mirror at the service layer so the message is actionable). */
export class LeadLostReasonRequiredError extends DomainError {
  constructor() {
    super(
      "LEAD_LOST_REASON_REQUIRED",
      "losing a lead requires a reason (1..200 characters)",
    );
  }
}
/** MERGE-mode conversion without a resolvable target partner: partnerId
 * absent (the zod union usually catches this first) or the target does not
 * exist in this tenant (A7: unknown-vs-foreign identical). */
export class LeadMergeTargetRequiredError extends DomainError {
  constructor(partnerId: string) {
    super(
      "LEAD_MERGE_TARGET_REQUIRED",
      `merge conversion requires an existing target partner — partner ${partnerId} is not usable in this tenant`,
      { partnerId },
    );
  }
}

// -- tasks + activities (T45; future work + the logged-past timeline) -----

/** Unknown or foreign task id (A7: no existence disclosure). */
export class TaskNotFoundError extends DomainError {
  constructor(id: string) {
    super("TASK_NOT_FOUND", `task ${id} does not exist in this tenant`);
  }
}
/**
 * An off-lifecycle task transition (PUT on a terminal task, complete on
 * CANCELLED, cancel on DONE). The legal replays (INV-013) are NOT this
 * error: complete-on-DONE and cancel-on-CANCELLED are no-ops returning the
 * stored row.
 */
export class TaskStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("TASK_STATE", message, details);
  }
}
/** Task-level input validation (title shape, a dangling related target, a
 * malformed date, …) — the 422 policy class for the task slice. */
export class TaskInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("TASK_INPUT_INVALID", message, details);
  }
}
/** Activity-level input validation (kind/related enums, summary shape,
 * occurredAt, durationMinutes < 0, a dangling related target, …). */
export class ActivityInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("ACTIVITY_INPUT_INVALID", message, details);
  }
}

// -- service contracts + schedule + advances (T46; MASTER-PLAN §4) ----------

/**
 * PHASE-019 T46 — the contract/schedule/advance/time slice. Contracts are
 * NOT legal documents until activation (CT- number at ACTIVATION — the
 * BR-029 boundary); the contract itself posts NOTHING (CAPABILITY_MATRIX
 * §2.8) except the policy-gated advance reclass (§1 row 4). Codes are the
 * stable API contracts (ERROR_MODEL §4); A7-sensitive not-founds render
 * identically for unknown-vs-foreign ids.
 */

/** Unknown or foreign service-contract id (A7: no existence disclosure). */
export class ContractNotFoundError extends DomainError {
  constructor(id: string) {
    super("CONTRACT_NOT_FOUND", `service contract ${id} does not exist in this tenant`);
  }
}
/**
 * Off-lifecycle contract transitions (PUT/activate on non-DRAFT, cancel on
 * terminal states, renew on non-ACTIVE, tagging an advance on a non-ACTIVE
 * contract). The legal replays are NOT this error (INV-013).
 */
export class ContractStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CONTRACT_STATE", message, details);
  }
}
/**
 * Contract-level input validation: malformed shapes, a non-customer
 * partner, a fee model the tenant's `crm.contract_billing_mode` policy does
 * not allow, a milestone line without a resolvable fee item (§18 lesson 1 —
 * the stored-grid default resolution is the fix), a non-base currency (v1).
 */
export class ContractInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CONTRACT_INPUT_INVALID", message, details);
  }
}
/** The term is invalid (end before start, malformed ISO dates). */
export class ContractTermInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("CONTRACT_TERM_INVALID", message, details);
  }
}
/** Unknown or foreign schedule-entry id (A7 parity). */
export class ScheduleEntryNotFoundError extends DomainError {
  constructor(id: string) {
    super("SCHEDULE_ENTRY_NOT_FOUND", `schedule entry ${id} does not exist in this tenant`);
  }
}
/**
 * The receipt cannot back the requested advance: not POSTED, a different
 * partner or currency than the contract, or the same (receipt, contract,
 * amount) is already HELD — the duplicate-tag guard.
 */
export class AdvanceStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("ADVANCE_STATE", message, details);
  }
}
/**
 * The receipt's unallocated on-account credit is smaller than the requested
 * advance (BR-027 — on-account is explicit, never netted; the treasury
 * onAccountRemainder formula minus already-tagged advances).
 */
export class AdvanceInsufficientOnAccountError extends DomainError {
  constructor(details: { receiptId: string; available: string; requested: string }) {
    super(
      "ADVANCE_INSUFFICIENT_ON_ACCOUNT",
      `receipt ${details.receiptId} has only ${details.available} of unallocated on-account credit — the ${details.requested} advance cannot be tagged`,
      details,
    );
  }
}

// -- time entries + timesheets (T46; MASTER-PLAN §6) ------------------------

/** Unknown or foreign time-entry id (A7 parity). */
export class TimeEntryNotFoundError extends DomainError {
  constructor(id: string) {
    super("TIME_ENTRY_NOT_FOUND", `time entry ${id} does not exist in this tenant`);
  }
}
/** Off-lifecycle timeslip transitions (edit on non-DRAFT, void on
 * BILLED/VOID — §6: only DRAFT/APPROVED entries void). */
export class TimeEntryStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("TIME_ENTRY_STATE", message, details);
  }
}
/**
 * Timeslip input validation: hours shape (positive, ≤ 6dp), a non-SERVICE
 * fee item (the job-card LABOR mirror), a missing manual rate when no
 * price-list price resolves (§6 determinism), a non-Monday weekStart.
 */
export class TimeEntryInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("TIME_ENTRY_INPUT_INVALID", message, details);
  }
}
/**
 * Policy `crm.time_entries_require_case` is ON and the timeslip carries no
 * projectId (§6 — the typed policy error; the project must also be OPEN,
 * which reuses the engine's PROJECT_CLOSED/PROJECT_NOT_FOUND).
 */
export class TimeEntryCaseRequiredError extends DomainError {
  constructor() {
    super(
      "TIME_ENTRY_CASE_REQUIRED",
      "this tenant requires a projectId (case) on every time entry (policy crm.time_entries_require_case)",
    );
  }
}
/** A weekly review whose window contains no DRAFT entries (§6). */
export class TimesheetEmptyError extends DomainError {
  constructor(weekStart: string) {
    super(
      "TIMESHEET_EMPTY",
      `the week of ${weekStart} has no DRAFT time entries to review`,
      { weekStart },
    );
  }
}

// -- service orders (T48; MASTER-PLAN §7 — the job-card generalization) ----

/**
 * PHASE-019 T48 — the service-order slice. The job-card error family mapped
 * onto the crm conventions (T45/T46): the five codes the task card lists.
 * The job-card family's separate NOT_CANCELABLE folds into STATE here (the
 * T46 precedent — unknown receipt → ADVANCE_STATE): a card that already has
 * an invoice or issued parts is off-lifecycle for a cancel, and the message
 * carries the credit-note honesty. Codes are stable API contracts
 * (ERROR_MODEL §4); A7-sensitive not-founds render identically for
 * unknown-vs-foreign ids.
 */

/** Unknown or foreign service-order id (A7: no existence disclosure). */
export class ServiceOrderNotFoundError extends DomainError {
  constructor(id: string) {
    super("SERVICE_ORDER_NOT_FOUND", `service order ${id} does not exist in this tenant`);
  }
}
/**
 * Off-lifecycle service-order transitions (approve on non-DRAFT, invoice on
 * non-COMPLETED, a DRAFT-only edit after approval) plus the never-cancelable
 * guard (invoiced or issued parts — corrections are credit notes, the
 * job-card step-8 posture).
 */
export class ServiceOrderStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SERVICE_ORDER_STATE", message, details);
  }
}
/**
 * Header-level input validation: an empty line set, a malformed
 * partsIssueMode, a non-ACTIVE (or unknown) contractId, bad decimal shapes.
 */
export class ServiceOrderInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SERVICE_ORDER_INPUT_INVALID", message, details);
  }
}
/**
 * Line-level violation: wrong line type for the item kind (SERVICE lines
 * need SERVICE items with estimatedHours > 0; PARTS lines need STOCK items
 * with qty > 0), a line that belongs to another order, hours on a PARTS
 * line.
 */
export class ServiceOrderLineError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SERVICE_ORDER_LINE_ERROR", message, details);
  }
}
/**
 * A posting-policy action needs the service-order posting port and it is
 * not registered: `issue_immediate` approval and COMPLETED → INVOICED
 * invoicing both delegate ledger work to the port (the job-card
 * JobCardPostingNotConfigured mirror). The module wires the port at
 * controller construction, so this is the unreachable-in-production belt.
 */
export class ServiceOrderPostingNotConfiguredError extends DomainError {
  constructor(message: string) {
    super("SERVICE_ORDER_POSTING_NOT_CONFIGURED", message);
  }
}
