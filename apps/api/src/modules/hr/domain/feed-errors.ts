import { DomainError } from "@erp/domain-core";

/**
 * PHASE-045 (T-10 — the payroll variable feeds) domain errors. The
 * family follows the T-03…T-09 contracts: stable codes, A7-sensitive
 * not-founds (fiscal_periods is tenant-RLS'd — a foreign tenant's
 * period is indistinguishable from an unknown id), and the feed shape
 * laws surfaced as typed refusals.
 */

/** The named pay period does not exist in this tenant (404 — A7 parity). */
export class FeedPeriodNotFoundError extends DomainError {
  constructor(id: string) {
    super("FEED_PERIOD_NOT_FOUND", `pay period ${id} does not exist in this tenant`);
  }
}

/** The feed query shape is invalid (an inverted range, a bad limit —
 * 422 family). */
export class FeedInvalidError extends DomainError {
  constructor(message: string) {
    super("FEED_INVALID", message);
  }
}
