import { DomainError } from "@erp/domain-core";

/**
 * PHASE-026 fixed_assets LIFECYCLE errors (T8 revaluation + T9 disposal —
 * the P26-C slice). Codes are stable API contracts (ERROR_MODEL §4) — the
 * HTTP layer maps each to its status. This file owns ONLY the lifecycle
 * tail; register/category/capitalization errors live in
 * `../domain/fixed-assets-errors.ts` (P26-A) and are IMPORTED, never
 * redefined. Money travels as canonical decimal strings (ADR-0009); no
 * Math.* anywhere.
 *
 * SoD note (AUTHORIZATION_MATRIX §4): the disposal approve key
 * (`fixed_assets.disposals.approve`) is on the §4 segregation list — the
 * approver must be a second user; the service-level guard below
 * (SELF_APPROVAL_BLOCKED) is the backstop behind the permission check.
 */

// -- revaluations (T8 — BR-044) ------------------------------------------------------

export class RevaluationNotFoundError extends DomainError {
  constructor(id: string) {
    super("REVALUATION_NOT_FOUND", `asset revaluation ${id} does not exist in this tenant`);
  }
}

/** One live DRAFT per asset (service-enforced — migration 0037 comment). */
export class LiveDraftConflictError extends DomainError {
  constructor(details: { assetId: string; draftId: string }) {
    super(
      "REVALUATION_DRAFT_EXISTS",
      `asset ${details.assetId} already carries a live DRAFT revaluation (${details.draftId}) — one live DRAFT per asset; post it before drafting another`,
      details,
    );
  }
}

/** The revaluation cannot move DRAFT → POSTED (already posted / nothing to post). */
export class RevaluationNotPostableError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("REVALUATION_NOT_POSTABLE", message, details);
  }
}

// -- disposals (T9 — G-23, BR-043) ---------------------------------------------------

export class DisposalNotFoundError extends DomainError {
  constructor(id: string) {
    super("DISPOSAL_NOT_FOUND", `asset disposal ${id} does not exist in this tenant`);
  }
}

/**
 * G-23 posting requires the second-user approval FIRST
 * (AUTHORIZATION_MATRIX §4; the mirror of the journal-approval
 * RunNotApprovedError pattern in accounting).
 */
export class DisposalNotApprovedError extends DomainError {
  constructor(details: { disposalId: string }) {
    super(
      "DISPOSAL_NOT_APPROVED",
      `disposal ${details.disposalId} is not approved — G-23 posting requires a second-user approval first (fixed_assets.disposals.approve, SoD AUTHORIZATION_MATRIX §4)`,
      details,
    );
  }
}

/**
 * SoD backstop (mirrors accounting's SelfApprovalBlockedError, code kept
 * identical): the disposal creator can never approve their own document.
 */
export class SelfApprovalBlockedError extends DomainError {
  constructor() {
    super(
      "SELF_APPROVAL_BLOCKED",
      "the creator cannot approve their own disposal (SoD, AUTHORIZATION_MATRIX §4 — the disposal approver must be a second user)",
    );
  }
}

/**
 * INV-023 "exactly once": disposal only from ACTIVE/FULLY_DEPRECIATED, and
 * an asset with ANY existing disposal row (DRAFT or POSTED — there is no
 * rejected state) can never be disposed again. Fires both on the asset
 * status gate and the existing-disposal gate.
 */
export class DisposedAssetReuseError extends DomainError {
  constructor(details: { assetId: string; status: string; existingDisposalId?: string }) {
    super(
      "DISPOSED_ASSET_REUSE",
      `asset ${details.assetId} is ${details.status} — disposal happens exactly once and only from ACTIVE/FULLY_DEPRECIATED (INV-023)${
        details.existingDisposalId !== undefined
          ? `; existing disposal document ${details.existingDisposalId}`
          : ""
      }`,
      details,
    );
  }
}

/**
 * SCRAP proceeds = 0 is an EXPLICIT entry, never a silent default: the API
 * requires the `proceeds` field on every disposal, and a SALE must carry
 * proceeds > 0 (a zero-proceeds disposal is a SCRAP with an explicit 0).
 */
export class ScrapProceedsRequiredError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SCRAP_PROCEEDS_REQUIRED", message, details);
  }
}

/** Illegal disposal state transitions (posted immutability, double approve). */
export class DisposalStateError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("DISPOSAL_STATE_INVALID", message, details);
  }
}

/** Structural lifecycle-input validation (kind/date/reason shape). Money-shape
 * failures reuse INVALID_AMOUNT (P26-A's InvalidAssetInputError) for the
 * failure-pack class parity. */
export class LifecycleInputInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("FIXED_ASSET_LIFECYCLE_INPUT_INVALID", message, details);
  }
}
