import { DomainError } from "@erp/domain-core";

/**
 * PHASE-020 · sync module domain errors (MASTER-PLAN §4; SYNC_PROTOCOL §3;
 * CONFLICT_RESOLUTION §2/§3). Codes are stable API contracts (ERROR_MODEL
 * §4) — the HTTP layer maps each to its status; codes double as the
 * per-item push rejection reasons (SYNC_REJECTION_REASONS ⊇ these codes).
 *
 * These cover the request-level (whole-batch) failure states; per-item
 * business rejections travel as mapped PushItemResult entries, never as
 * thrown errors across the controller boundary. The 016 pos-errors stay
 * the source for the narrow POS slice (PosDeviceNotFoundError etc.) — the
 * classes below are the generalized additions (MASTER-PLAN §1.6).
 */

/** Malformed batch/command envelope (HTTP 400). The 016 sibling is
 * PosSyncCommandInvalidError (SYNC_COMMAND_INVALID, same code); this class
 * is the sync-module-owned spelling for v2 call sites. */
export class SyncCommandInvalidError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("SYNC_COMMAND_INVALID", message, details);
  }
}

/** Device revoked before any command executes (HTTP 403; SYNC_PROTOCOL §1.5
 * — pushes rejected BEFORE execution; C-06 zero effects). */
export class SyncDeviceRevokedError extends DomainError {
  constructor(deviceId: string) {
    super("DEVICE_REVOKED", `device ${deviceId} is revoked — pushes are rejected before execution`);
  }
}

/** Tenant suspended (HTTP 403; MULTI_TENANCY §3.6 — all devices of the
 * tenant are suspended with it; C-14). */
export class SyncTenantSuspendedError extends DomainError {
  constructor(tenantId: string) {
    super(
      "TENANT_SUSPENDED",
      `tenant ${tenantId} is suspended — sync is paused until it is restored`,
    );
  }
}

/** Unsupported contract version on the v2 gate (HTTP 422 on /sync/status;
 * per-item CONTRACT_VERSION_UNSUPPORTED on the push channel — C-08). */
export class SyncContractUnsupportedError extends DomainError {
  constructor(version: string) {
    super(
      "CONTRACT_VERSION_UNSUPPORTED",
      `contract version ${version} is not supported (supported: current + grace list)`,
      { version },
    );
  }
}

/** Rate limited (HTTP 429 request-level spelling; the push channel renders
 * it as per-item DEFERRED {reason: "RATE_LIMITED", retryAfterMs}). */
export class SyncRateLimitedError extends DomainError {
  constructor(retryAfterMs: number) {
    super(
      "RATE_LIMITED",
      `push rate limit exceeded — retry after ${retryAfterMs}ms`,
      { retryAfterMs },
    );
  }
}

/** The entity is not in the device class's feed group (MASTER-PLAN §5.1 —
 * 404-equivalent, no existence leak across classes: the error is identical
 * for "not in your class" and "does not exist"). */
export class SyncEntityNotPulledError extends DomainError {
  constructor(entityType: string, deviceClass: string) {
    super(
      "SYNC_ENTITY_NOT_PULLED",
      `entity type ${entityType} is not pulled by device class ${deviceClass}`,
      { entityType },
    );
  }
}
