import { DomainError } from "@erp/domain-core";

/**
 * PHASE-045 (T-09 — the employee ↔ user identity bridge, HR-13) domain
 * errors. The family follows the T-03…T-08 contracts: stable codes,
 * A7-sensitive not-founds (identical shape for unknown-vs-foreign ids —
 * the employees read rides RLS, so a foreign tenant's employee is
 * indistinguishable from an unknown one; the USERS table is global, but
 * the same 404 shape applies — no existence disclosure beyond the
 * actor's own tenant surface), and the bridge laws surfaced as typed
 * refusals BEFORE any write.
 */

/** The user id named by the link does not exist (404 — A7 parity). */
export class BridgeUserNotFoundError extends DomainError {
  constructor(id: string) {
    super("BRIDGE_USER_NOT_FOUND", `user ${id} does not exist`);
  }
}

/** The user exists but holds no ACTIVE membership in the acting tenant —
 * a link would be an orphan (the user could never reach the tenant's HR
 * surface); refused BEFORE any write (422 family — the shape class, not
 * a lifecycle conflict). */
export class BridgeUserNotMemberError extends DomainError {
  constructor(userId: string) {
    super(
      "BRIDGE_USER_NOT_MEMBER",
      `user ${userId} is not an active member of this tenant — link only tenant members (HR-13)`,
    );
  }
}

/** The employee already carries a link, or the user is already linked to
 * another employee in this tenant (the 0085 partial-UNIQUE floor) — one
 * employee ↔ one user at any moment; the audited unlink is the only way
 * to move a link (409 — the lifecycle conflict). */
export class BridgeAlreadyLinkedError extends DomainError {
  constructor(message: string) {
    super("BRIDGE_ALREADY_LINKED", message);
  }
}

/** An unlink on an employee that carries no link (409 — the same
 * lifecycle-conflict class: the bridge state is explicit, never
 * idempotently silent). */
export class BridgeNotLinkedError extends DomainError {
  constructor(employeeId: string) {
    super("BRIDGE_NOT_LINKED", `employee ${employeeId} carries no user link`);
  }
}

/** The link shape itself is invalid (a TERMINATED employee — the honest
 * lifecycle: TERMINATED is terminal and a terminated employee has no
 * self-service future; 422 family). */
export class BridgeInvalidError extends DomainError {
  constructor(message: string) {
    super("BRIDGE_INVALID", message);
  }
}
