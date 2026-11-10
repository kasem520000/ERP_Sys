import { DomainError } from "@erp/domain-core";

/**
 * PHASE-017 commission domain errors (T7-a). Codes are stable API contracts
 * (ERROR_MODEL §4) — the HTTP layer maps each to its status. Money/rates
 * travel as canonical decimal strings (ADR-0009). Purpose-resolution
 * failures at post time are the posting engine's own PURPOSE_NOT_MAPPED —
 * deliberately NOT duplicated here.
 */

export class CommissionRunNotFoundError extends DomainError {
  constructor(id: string) {
    super("COMMISSION_RUN_NOT_FOUND", `commission run ${id} does not exist in this tenant`);
  }
}

/** Wrong-state run transitions: re-post (INV-013), cancel of a POSTED run,
 * recompute of a non-DRAFT run, posting without computed lines/amount. */
export class CommissionRunStateError extends DomainError {
  constructor(message: string) {
    super("COMMISSION_RUN_STATE", message);
  }
}

/** Rule-shape rejections: rate bounds, NONE with a rate, tier bands
 * malformed/overlapping/unordered/missing the open band. */
export class CommissionRuleInvalidError extends DomainError {
  constructor(message: string) {
    super("COMMISSION_RULE_INVALID", message);
  }
}
