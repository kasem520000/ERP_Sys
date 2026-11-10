import { DomainError } from "@erp/domain-core";

/**
 * PHASE-034 · consolidation module domain errors (PHASE-006 error taxonomy —
 * stable codes, bilingual where user-facing, HTTP mapping in the global
 * filter's domainStatus). Codes follow the notes/fixed_assets precedent:
 * typed 404s never disclose foreign existence (A7 — RLS makes unknown and
 * foreign ids indistinguishable); lifecycle conflicts 409
 * (IMMUTABLE_DOCUMENT); validation 422; the BR-056 pre-check rejection and
 * the INV-008 RATE_MISSING / INV-026 ASSERTION_FAILED surfaces are the
 * phase's own typed additions (fail-closed, never warnings).
 */

// -- 404 not-found (A7 parity: unknown == foreign) --------------------------------

/** Foreign/unknown group id — typed 404 (spoof battery asserts this shape). */
export class GroupNotFoundError extends DomainError {
  constructor(groupId: string) {
    super("GROUP_NOT_FOUND", `Consolidation group ${groupId} not found`, { groupId });
  }
}

/** Group exists in ANOTHER tenant's plane — same typed 404 (never 403: the
 * owner-scoped query makes unknown and foreign indistinguishable). */
export class GroupNotOwnedError extends DomainError {
  constructor(groupId: string) {
    super("GROUP_NOT_FOUND", `Consolidation group ${groupId} not found`, { groupId });
  }
}

/** Foreign/unknown elimination id — typed 404. */
export class EliminationNotFoundError extends DomainError {
  constructor(eliminationId: string) {
    super("ELIMINATION_NOT_FOUND", `Elimination ${eliminationId} not found`, { eliminationId });
  }
}

/** Foreign/unknown run id — typed 404. */
export class RunNotFoundError extends DomainError {
  constructor(runId: string) {
    super("RUN_NOT_FOUND", `Consolidation run ${runId} not found`, { runId });
  }
}

// -- 422 configuration validation -------------------------------------------------

/** A group must be ACTIVE to take eliminations/runs (archived = history). */
export class GroupNotActiveError extends DomainError {
  constructor(details: { groupId: string; status: string }) {
    super(
      "GROUP_NOT_ACTIVE",
      `Consolidation group ${details.groupId} is ${details.status} — not usable`,
      details,
    );
  }
}

/** The member is not an ACTIVE member of the group (or include_from window). */
export class MemberNotInGroupError extends DomainError {
  constructor(details: { groupId: string; memberTenantId: string }) {
    super(
      "MEMBER_NOT_IN_GROUP",
      `Tenant ${details.memberTenantId} is not an ACTIVE member of group ${details.groupId}`,
      details,
    );
  }
}

/** Duplicate membership (uq_group_entities_group_member service-side shape). */
export class DuplicateMemberError extends DomainError {
  constructor(details: { groupId: string; memberTenantId: string }) {
    super(
      "DUPLICATE_MEMBER",
      `Tenant ${details.memberTenantId} is already a member of group ${details.groupId}`,
      details,
    );
  }
}

/** ownership_percent ∈ (0, 100] per DATA_DICTIONARY §6 numeric(7,4). */
export class OwnershipPercentInvalidError extends DomainError {
  constructor(ownershipPercent: string) {
    super(
      "OWNERSHIP_PERCENT_INVALID",
      `ownership_percent must be in (0, 100] — got ${ownershipPercent}`,
      { ownershipPercent },
    );
  }
}

// -- BR-056 + FX fail-closed (the phase's own typed surfaces) ---------------------

/** BR-056 — the typed pre-check rejection (rejected, never warned). */
export class MemberPeriodOpenError extends DomainError {
  constructor(details: {
    groupId: string;
    memberTenantId: string;
    fiscalPeriodId: string;
    periodName?: string;
  }) {
    super(
      "MEMBER_PERIOD_OPEN",
      `Member ${details.memberTenantId} has an OPEN fiscal period for the run period — ` +
        `BR-056 requires closed member periods`,
      details,
    );
  }
}

/** INV-008 fail-closed translation gap (the OQ-V2-2 decision's typed error). */
export class RateMissingError extends DomainError {
  constructor(details: { currency: string; rateDate: string; groupId: string }) {
    super(
      "RATE_MISSING",
      `No stored rate for ${details.currency} at ${details.rateDate} — translation fails closed`,
      details,
    );
  }
}

/** A stored rate must be > 0 (INV-008). */
export class RateInvalidError extends DomainError {
  constructor(details: { currency: string; rate: string; rateDate: string }) {
    super(
      "RATE_INVALID",
      `Stored rate for ${details.currency} at ${details.rateDate} must be > 0 — got ${details.rate}`,
      details,
    );
  }
}

// -- elimination lifecycle (the G-32 failure pack) --------------------------------

/** Unbalanced elimination — 422, zero residue. */
export class EliminationNotBalancedError extends DomainError {
  constructor(details: { eliminationId: string; debitTotal: string; creditTotal: string }) {
    super(
      "ENTRY_NOT_BALANCED",
      `Elimination ${details.eliminationId} is unbalanced (DR ${details.debitTotal} ≠ CR ${details.creditTotal})`,
      details,
    );
  }
}

/** Already-posted elimination — 409 IMMUTABLE_DOCUMENT (INV-003 posture). */
export class EliminationAlreadyPostedError extends DomainError {
  constructor(details: { eliminationId: string; status: string }) {
    super(
      "ALREADY_POSTED",
      `Elimination ${details.eliminationId} is already ${details.status} — posted documents are immutable`,
      details,
    );
  }
}

/** The §4 SoD gate: approval (second user) before post. */
export class EliminationNotApprovedError extends DomainError {
  constructor(details: { eliminationId: string; status: string }) {
    super(
      "ELIMINATION_NOT_APPROVED",
      `Elimination ${details.eliminationId} must be approved before posting (SoD §4)`,
      details,
    );
  }
}

/** SoD: the creator cannot approve (creator ≠ approver). */
export class SelfApprovalBlockedError extends DomainError {
  constructor(details: { eliminationId: string; actorId: string }) {
    super(
      "SELF_APPROVAL_BLOCKED",
      "The elimination creator cannot approve it (SoD creator ≠ approver — §4)",
      details,
    );
  }
}

/** The engine's PURPOSE_NOT_MAPPED re-raised with the elimination surface. */
export class EliminationPurposeNotMappedError extends DomainError {
  constructor(details: { purposeKey: string; surface: string }) {
    super(
      "PURPOSE_NOT_MAPPED",
      `Purpose ${details.purposeKey} is not mapped to an active account (${details.surface})`,
      details,
    );
  }
}

// -- runs & snapshots --------------------------------------------------------------

/** Statements read COMPLETED snapshots only — never live member books. */
export class RunNotCompleteError extends DomainError {
  constructor(details: { runId: string; status: string }) {
    super(
      "RUN_NOT_COMPLETE",
      `Consolidation run ${details.runId} is ${details.status} — statements read COMPLETED snapshots only`,
      details,
    );
  }
}

/** A COMPLETED run without a snapshot is a corrupt state (CHECK-enforced). */
export class SnapshotMissingError extends DomainError {
  constructor(runId: string) {
    super("SNAPSHOT_MISSING", `Consolidation run ${runId} carries no snapshot`, { runId });
  }
}

/** INV-026 assertion failure on statement derivation (block-export). */
export class ConsolidationDriftError extends DomainError {
  constructor(details: { runId: string; assertion: string; left: string; right: string }) {
    super(
      "ASSERTION_FAILED",
      `INV-026 drift on run ${details.runId} (${details.assertion}): consolidated ${details.left} ≠ Σ members − eliminations ${details.right}`,
      details,
    );
  }
}

/** The reader function re-validated and refused (membership/period) — the
 * typed mapping of the SQL rejection at the service seam. */
export class ReaderRejectedError extends DomainError {
  constructor(details: { groupId: string; memberTenantId: string; reason: string }) {
    super(
      "READER_REJECTED",
      `The consolidation reader rejected the request: ${details.reason}`,
      details,
    );
  }
}
