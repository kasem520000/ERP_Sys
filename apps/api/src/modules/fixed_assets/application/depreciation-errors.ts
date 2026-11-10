import { DomainError } from "@erp/domain-core";

/**
 * PHASE-026 T6/T7 depreciation-run domain errors (P26-B owns this file).
 * Codes are stable API contracts (ERROR_MODEL §4) — the HTTP layer maps each
 * to its status; A7-sensitive not-founds render identically for
 * unknown-vs-foreign ids (no existence disclosure). Money travels as
 * canonical decimal strings (ADR-0009).
 *
 * Status map the orchestrator must register in infra/http/error.filter.ts:
 * - DEPRECIATION_RUN_NOT_FOUND ............ 404
 * - DEPRECIATION_RUN_PERIOD_TAKEN ......... 409
 * - DEPRECIATION_RUN_NOT_POSTABLE ......... 409
 * - DEPRECIATION_ASSEMBLY_CANCELLED ....... 409
 * - PERIOD_LOCKED (PeriodLockedForRunError)  422 (mirrors PostingError PERIOD_LOCKED)
 * - DEPRECIATION_ASSEMBLY_REJECTED ........ 422
 * - UOP_UNITS_REQUIRED .................... 422
 * - NBV_FLOOR_VIOLATION ................... 422
 * - DEPRECIATION_ASSET_INVALID ............ 422
 *
 * Asset lookups on the workspace path throw P26-A's AssetNotFoundError
 * (ASSET_NOT_FOUND, domain/fixed-assets-errors.ts — already filter-mapped
 * by their wave) — imported, not redefined here.
 */

// -- runs / lifecycle --------------------------------------------------------------

export class DepreciationRunNotFoundError extends DomainError {
  constructor(id: string) {
    super("DEPRECIATION_RUN_NOT_FOUND", `depreciation run ${id} does not exist in this tenant`, {
      runId: id,
    });
  }
}

/** One run per (tenant, fiscal period) — uq_depreciation_runs_tenant_period. */
export class RunAlreadyExistsError extends DomainError {
  constructor(details: { fiscalPeriodId: string; existingRunId: string; status: string }) {
    super(
      "DEPRECIATION_RUN_PERIOD_TAKEN",
      `a depreciation run already exists for fiscal period ${details.fiscalPeriodId} ` +
        `(run ${details.existingRunId}, status ${details.status}) — one run per period (BR-042); ` +
        `re-assemble the DRAFT or reverse the POSTED run instead`,
      details,
    );
  }
}

/** Wrong-state run operations: post a non-assembled run, recompute a POSTED run, … */
export class RunNotPostableError extends DomainError {
  constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super("DEPRECIATION_RUN_NOT_POSTABLE", message, details);
  }
}

/**
 * Period lock (INV-011): the run's fiscal period is LOCKED, or SOFT_CLOSED
 * without a soft-close reason (PC-02 — the engine demands the reason; the
 * permission check is the HTTP layer's duty). Wraps the engine's
 * PERIOD_LOCKED code so the failure pack shape matches POSTING_ENGINE §3.
 */
export class PeriodLockedForRunError extends DomainError {
  constructor(details: {
    runId: string;
    fiscalPeriodId: string;
    periodName: string;
    status: string;
  }) {
    super(
      "PERIOD_LOCKED",
      `fiscal period ${details.periodName} is ${details.status} — depreciation ` +
        `run ${details.runId} cannot post there (INV-011; POSTING_ENGINE §3 PERIOD_LOCKED)`,
      details,
    );
  }
}

// -- assembly (T6) -----------------------------------------------------------------

/** One per-asset rejection reason (BR-041 gaps, data guards, bad units). */
export interface AssetRejection {
  assetId: string;
  code: string;
  reason: string;
}

/**
 * The assembly refuses to build a run whose participating assets are invalid
 * (BR-041 category gaps, non-positive life, UoP without estimated units,
 * over-depreciated accumulated, malformed units input). Collects ALL
 * per-asset reasons — a run must never silently skip an asset.
 */
export class AssemblyValidationError extends DomainError {
  readonly rejections: readonly AssetRejection[];
  constructor(rejections: readonly AssetRejection[]) {
    super(
      "DEPRECIATION_ASSEMBLY_REJECTED",
      `depreciation assembly rejected: ${rejections.length} asset-level problem(s) — ` +
        rejections.map((r) => `${r.code}(${r.assetId})`).join(", "),
      { rejections },
    );
    this.rejections = rejections;
  }
}

/**
 * UNITS_OF_PRODUCTION assets need explicit manual usage per run line
 * (DR-002 — no metering); the workspace UI collects units and re-assembles.
 */
export class UoPUnitsRequiredError extends DomainError {
  readonly assets: readonly { assetId: string; code: string; totalEstimatedUnits: string }[];
  constructor(assets: readonly { assetId: string; code: string; totalEstimatedUnits: string }[]) {
    super(
      "UOP_UNITS_REQUIRED",
      `UNITS_OF_PRODUCTION assets require explicit period units before assembly — ` +
        `${assets.length} asset(s) missing usage: ${assets.map((a) => a.code).join(", ")}`,
      { assets },
    );
    this.assets = assets;
  }
}

/**
 * NBV floor breach (INV-023 defensive guard): accumulated depreciation
 * already exceeds cost − salvage for an asset entering assembly — the data
 * is corrupt (writers enforce the floor), so the assembly fails loudly
 * instead of fabricating a negative-amount line.
 */
export class NbvFloorViolationError extends DomainError {
  constructor(details: { assetId: string; code: string; accumulated: string; base: string }) {
    super(
      "NBV_FLOOR_VIOLATION",
      `asset ${details.code} accumulated ${details.accumulated} exceeds its depreciable ` +
        `base ${details.base} (INV-023) — the register is inconsistent with the floor invariant`,
      details,
    );
  }
}

/** The bounded assembly job was cancelled between chunks (ADR-0008). */
export class AssemblyCancelledError extends DomainError {
  constructor(runId: string) {
    super(
      "DEPRECIATION_ASSEMBLY_CANCELLED",
      `depreciation run ${runId} assembly was cancelled — the whole assembly ` +
        `rolled back (zero residue); the run stays DRAFT`,
      { runId },
    );
  }
}

// -- workspace edit path ------------------------------------------------------------

/**
 * A participating asset's depreciation data is invalid for computation
 * (unknown method, non-positive life, UoP without positive estimated
 * units, negative/malformed period units). The schema CHECK constraints
 * (migration 0037) make most of these unreachable — this is the loud
 * defense-in-depth guard so the kernel never fabricates math.
 */
export class DepreciationAssetInvalidError extends DomainError {
  constructor(details: { assetId: string; code: string; problem: string }) {
    super(
      "DEPRECIATION_ASSET_INVALID",
      `asset ${details.code} cannot depreciate: ${details.problem}`,
      details,
    );
  }
}
