import { DomainError } from "@erp/domain-core";

/**
 * PHASE-045 (T-14 — the employee self-service tabs) domain errors. The
 * family follows the T-03…T-11 contracts: a stable code, one law per
 * error, typed refusals BEFORE any write. The self-service plane's ONE
 * law of its own: the acting user's employee scope is resolved from the
 * bridge — NEVER from a client-supplied id (the isolation law); a user
 * with no link is nobody's employee here (the field workforce / a pure
 * back-office user), and every scoped surface answers that state with
 * the same typed refusal.
 */

/** The acting user carries no employee link in the ambient tenant —
 * the self-service plane is empty BY IDENTITY (not an error the user
 * can fix here; the honest empty state the page renders as "no
 * employee file is linked to your account"). 422 family (a state
 * precondition, the BRIDGE_USER_NOT_MEMBER precedent — never a
 * not-found: the summary route renders this as `employee: null`
 * instead, and the scoped routes refuse typed). */
export class SelfNotLinkedError extends DomainError {
  constructor() {
    super(
      "HR_SELF_NOT_LINKED",
      "no employee file is linked to your account in this tenant — the self-service surfaces resolve YOUR employee via the identity bridge (ask HR to link your user)",
    );
  }
}
