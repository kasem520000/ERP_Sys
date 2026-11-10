import { DomainError } from "@erp/domain-core";

/**
 * PHASE-013 reporting error model (PHASE-013 §4 "Errors typed per
 * ERROR_MODEL incl. FORBIDDEN_AT_RUN, ASSERTION_FAILED,
 * FEATURE_NOT_ENTITLED"): the registry, runner, and export paths raise
 * typed domain errors; the ErrorModelFilter maps them onto HTTP codes
 * (403/404/409/422) with the bilingual message surface the web renders.
 */

/** A queued run whose grant was revoked before execution (no TOCTOU leaks). */
export class ForbiddenAtRunError extends DomainError {
  constructor(reportKey: string) {
    super(
      "FORBIDDEN_AT_RUN",
      `report run ${reportKey} was forbidden at execution time (permission revoked)`,
      { reportKey },
    );
  }
}

/** Export/print of an assertion-failed result (server-side block). */
export class AssertionFailedExportBlockedError extends DomainError {
  constructor(reportKey: string, failedIds: readonly string[]) {
    super("ASSERTION_FAILED", `report ${reportKey} failed reconciliation checks; export blocked`, {
      reportKey,
      failedIds,
    });
  }
}

/** Unknown report id / registry miss (404-shaped — no existence probing). */
export class ReportNotFoundError extends DomainError {
  constructor(reportKey: string) {
    super("NOT_FOUND", `report ${reportKey} is not registered`, { reportKey });
  }
}

/** Run row miss or cross-tenant access (404-shaped, A-series isolation). */
export class ReportRunNotFoundError extends DomainError {
  constructor(runId: string) {
    super("NOT_FOUND", `report run ${runId} was not found`, { runId });
  }
}

/** Malformed contract detected at boot (fail startup — registry rule). */
export class ContractValidationError extends DomainError {
  constructor(contractId: string, reason: string) {
    super("CONTRACT_INVALID", `report contract ${contractId} failed validation: ${reason}`, {
      contractId,
      reason,
    });
  }
}

/** Params failed the contract's zod schema (422 policy shape). */
export class ReportParamsInvalidError extends DomainError {
  constructor(reportKey: string, issues: readonly string[]) {
    super("PARAMS_INVALID", `report ${reportKey} parameters invalid`, { reportKey, issues });
  }
}

/** Contract version mismatch: stale client must refresh (REPORT_CONTRACT §5.1). */
export class ContractVersionMismatchError extends DomainError {
  constructor(reportKey: string, expected: number, received: number) {
    super(
      "CONTRACT_VERSION_MISMATCH",
      `report ${reportKey} contract version ${received} is stale (registry is at ${expected})`,
      { reportKey, expected, received },
    );
  }
}
