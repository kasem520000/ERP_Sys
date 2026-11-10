import { DomainError } from "@erp/domain-core";

/**
 * PHASE-017 T3 job-card domain errors (the sales-module workshop document
 * — PHASE-017 §2 item 2, lifecycle per industry-workflows.md (b)). Codes
 * are stable API contracts (ERROR_MODEL §4) — the HTTP layer maps each to
 * its status; A7-sensitive not-founds render identically for unknown-vs-
 * foreign ids. Money/qty/hours travel as canonical decimal strings
 * (ADR-0009).
 */

/** Unknown or foreign card id (A7: no existence disclosure). */
export class JobCardNotFoundError extends DomainError {
  constructor(id: string) {
    super("JOB_CARD_NOT_FOUND", `job card ${id} does not exist in this tenant`);
  }
}

/** Illegal lifecycle transition (DRAFT → IN_PROGRESS → COMPLETED → INVOICED). */
export class JobCardStateError extends DomainError {
  constructor(message: string) {
    super("JOB_CARD_STATE", message);
  }
}

/** Line-level violation: wrong line type for the item kind, bad qty/hours. */
export class JobCardLineError extends DomainError {
  constructor(message: string) {
    super("JOB_CARD_LINE_INVALID", message);
  }
}

/**
 * The card can never leave the live chain from its current state (parts
 * already issued, or an invoice exists) — corrections are credit notes
 * (industry-workflows.md (b) step 8), never a cancel.
 */
export class JobCardNotCancelableError extends DomainError {
  constructor(message: string) {
    super("JOB_CARD_NOT_CANCELABLE", message);
  }
}

/** Header/actor-level input violation (empty reason, bad hours payload). */
export class JobCardInputInvalidError extends DomainError {
  constructor(message: string) {
    super("JOB_CARD_INPUT_INVALID", message);
  }
}

/**
 * A posting-policy action needs the job-card posting port (T4) and it is
 * not registered: `issue_immediate` approval and COMPLETED → INVOICED
 * invoicing both delegate ledger work to the port. The code is the
 * PHASE-017-specified contract for the 4-a boundary.
 */
export class JobCardPostingNotConfiguredError extends DomainError {
  constructor(message: string) {
    super("sales/job-card-posting-not-configured", message);
  }
}
