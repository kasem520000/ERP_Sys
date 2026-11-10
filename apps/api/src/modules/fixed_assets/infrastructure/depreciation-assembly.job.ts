import type PgBoss from "pg-boss";

import { getBoss } from "../../../infra/jobs/boss";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { childLogger } from "../../../infra/observability/logger";
import {
  DepreciationRunNotFoundError,
  RunAlreadyExistsError,
  RunNotPostableError,
  AssemblyCancelledError,
} from "../application/depreciation-errors";
import {
  DEPRECIATION_ASSEMBLY_CHUNK,
  DepreciationService,
  isUniqueViolation,
  type AssembleRunResult,
} from "../application/depreciation-service";
import {
  findDepreciationRunByPeriod,
  findDepreciationRunById,
  insertDepreciationRun,
  updateDepreciationRun,
} from "./fixed-assets.store";

/**
 * PHASE-026 T6 — the depreciation-run assembly as a bounded pg-boss job
 * (ADR-0008; PHASE-026 §6 "run assembly is a bounded pg-boss job — 10k-asset
 * tenant assembles in one chunked job (p95 < 30 s target, cancelable,
 * idempotent per period)").
 *
 * Shape (mirrors the PHASE-023 tax/submissions/jobs.ts registration pattern
 * and the PHASE-013 reporting module's tenant-scoped job payloads):
 *
 * - ONE queue, `fixed-assets.depreciation.assembly` — on-demand (no cron);
 * - payloads are tenant-scoped (`tenantId` + `runId` + `fiscalPeriodId`) —
 *   the handler re-establishes tenant scope via `withTenant` (ADR-0008 §5);
 * - bounded: the service processes assets in CHUNK-sized batches (500) with
 *   one bounded INSERT statement per batch, and probes the cancel flag
 *   between batches — a cancel throws inside the withTenant transaction so
 *   the WHOLE assembly rolls back (zero residue; the run stays DRAFT);
 * - cancelable: `cancelAssembly(runId)` marks the in-process cancel flag and
 *   best-effort cancels the queued job (`boss.cancel` only reaches jobs that
 *   have not started; an in-flight job stops at the next chunk probe);
 * - idempotent per period: the run/period state machine is the idempotency
 *   boundary (uq_depreciation_runs_tenant_period + DRAFT reset/recompute).
 *   Duplicate queued jobs converge: assembly is deterministic, the loser of
 *   the (run, asset) unique-index race retries into reset+recompute of an
 *   identical line set. No singletonKey is used — it would ALSO suppress a
 *   legitimate quick re-assembly after the workspace edits UoP units.
 *
 * Honest boundary: the cancel flag is process-local (single API+worker
 * deployment shape; the queue-cancel covers queued jobs cluster-wide). The
 * 10k-asset bounded-run proof runs at sandbox scale — production wall-time
 * stays the standing infra-gated pattern (PHASE-025 waiver discipline,
 * master-plan honest marker).
 */

const log = childLogger({ module: "fixed-assets-depreciation-jobs" });

/** On-demand queue (ADR-0008): one job = one period assembly. */
export const DEPRECIATION_ASSEMBLY_QUEUE = "fixed-assets.depreciation.assembly";

export interface DepreciationAssemblyJobPayload {
  tenantId: string;
  runId: string;
  fiscalPeriodId: string;
  actorId: string | null;
  unitsByAssetId?: Record<string, string>;
}

// -- cancel flag (checked by the service once per CHUNK) ------------------------------

const cancelledAssemblies = new Set<string>();

/** Marks the run's assembly cancelled (in-process flag + queued-job cancel). */
export async function cancelAssembly(runId: string): Promise<boolean> {
  const run = await findDepreciationRunById(runId);
  if (run === undefined) throw new DepreciationRunNotFoundError(runId);
  if (run.status !== "DRAFT") {
    throw new RunNotPostableError(
      `run ${runId} is ${run.status} — only a DRAFT assembly can be cancelled`,
      { runId, status: run.status },
    );
  }
  cancelledAssemblies.add(runId);
  if (run.assemblyJobId !== null) {
    // Best-effort: only queued (not yet active) jobs are cancellable by the
    // queue; an in-flight job stops at its next chunk probe.
    await getBoss()
      .cancel(DEPRECIATION_ASSEMBLY_QUEUE, run.assemblyJobId)
      .catch(() => undefined);
  }
  return true;
}

export function isAssemblyCancelled(runId: string): boolean {
  return cancelledAssemblies.has(runId);
}

// -- enqueue -------------------------------------------------------------------------

/**
 * Enqueue the bounded assembly job for an EXISTING DRAFT run. Runs inside
 * the caller's ambient tenant transaction (the HTTP UoW) — the queue write
 * commits independently on the boss connection; if the caller's transaction
 * later rolls back, the handler's create-or-reuse converges (see header).
 */
export async function enqueueAssembly(
  runId: string,
  actorId: string | null,
  extras?: { unitsByAssetId?: Record<string, string> },
): Promise<string | null> {
  const { tenantId } = requireTenantContext();
  const run = await findDepreciationRunById(runId);
  if (run === undefined) throw new DepreciationRunNotFoundError(runId);
  if (run.status !== "DRAFT") {
    throw new RunNotPostableError(
      `run ${runId} is ${run.status} — only a DRAFT run can be assembled`,
      { runId, status: run.status },
    );
  }
  const payload: DepreciationAssemblyJobPayload = {
    tenantId,
    runId,
    fiscalPeriodId: run.fiscalPeriodId,
    actorId,
    ...(extras?.unitsByAssetId !== undefined ? { unitsByAssetId: extras.unitsByAssetId } : {}),
  };
  const jobId = await getBoss().send(DEPRECIATION_ASSEMBLY_QUEUE, payload, {
    // Bounded job policy (ADR-0008): the queue-level retry rides on the
    // convergent re-assembly semantics; expiry bounds a wedged 10k pass.
    retryLimit: 2,
    retryBackoff: true,
    expireInMinutes: 15,
  });
  if (jobId !== null) {
    await updateDepreciationRun(runId, { assemblyJobId: jobId });
  }
  return jobId;
}

/**
 * The controller-facing entry (POST /depreciation-runs/assemble): create-or-
 * reuse the DRAFT run for the period (409 on a non-DRAFT run — one run per
 * period, BR-042), then hand the bounded job the work. Returns immediately;
 * the workspace polls the run.
 */
export async function startAssembly(input: {
  fiscalPeriodId: string;
  actorId: string | null;
  unitsByAssetId?: Record<string, string>;
}): Promise<{ runId: string; jobId: string | null; reusedDraft: boolean }> {
  const existing = await findDepreciationRunByPeriod(input.fiscalPeriodId);
  if (existing !== undefined && existing.status !== "DRAFT") {
    throw new RunAlreadyExistsError({
      fiscalPeriodId: input.fiscalPeriodId,
      existingRunId: existing.id,
      status: existing.status,
    });
  }
  let runId: string;
  let reusedDraft: boolean;
  if (existing !== undefined) {
    runId = existing.id;
    reusedDraft = true;
  } else {
    try {
      const created = await insertDepreciationRun({
        fiscalPeriodId: input.fiscalPeriodId,
        createdBy: input.actorId,
      });
      runId = created.id;
      reusedDraft = false;
    } catch (error) {
      // Concurrent startAssembly lost the one-run-per-period race: converge
      // on the winner (409 only when the winner's run is not re-assemblable).
      if (!isUniqueViolation(error)) throw error;
      const racer = await findDepreciationRunByPeriod(input.fiscalPeriodId);
      if (racer === undefined) throw error;
      if (racer.status !== "DRAFT") {
        throw new RunAlreadyExistsError({
          fiscalPeriodId: input.fiscalPeriodId,
          existingRunId: racer.id,
          status: racer.status,
        });
      }
      runId = racer.id;
      reusedDraft = true;
    }
  }
  const jobId = await enqueueAssembly(runId, input.actorId, {
    unitsByAssetId: input.unitsByAssetId,
  });
  return { runId, jobId, reusedDraft };
}

// -- handler -------------------------------------------------------------------------

/**
 * The job body, plain-callable (specs drive it WITHOUT pg-boss — the
 * maintenance-jobs precedent). Runs the whole assembly in ONE tenant
 * transaction: chunk probes + any failure roll everything back.
 * AssemblyCancelledError propagates — the queue handler (and only it)
 * translates a cancel into a clean job completion.
 */
export async function runAssemblyJob(
  payload: DepreciationAssemblyJobPayload,
): Promise<AssembleRunResult> {
  if (isAssemblyCancelled(payload.runId)) {
    cancelledAssemblies.delete(payload.runId);
    log.info({ action: "depreciation-assembly-cancelled-before-start", runId: payload.runId });
    throw new AssemblyCancelledError(payload.runId);
  }
  return withTenant(payload.tenantId, async () => {
    const service = new DepreciationService();
    return service.assembleRun(
      {
        fiscalPeriodId: payload.fiscalPeriodId,
        actorId: payload.actorId,
        ...(payload.unitsByAssetId !== undefined ? { unitsByAssetId: payload.unitsByAssetId } : {}),
      },
      {
        shouldCancel: () => isAssemblyCancelled(payload.runId),
      },
    );
  });
}

// -- module registration (PHASE-023 pattern) ------------------------------------------

/**
 * Register the assembly queue + worker (fixed_assets module onModuleInit).
 * Serial createQueue (the boss wrapper serializes boot races); registration
 * failure degrades the async assembly path, never module boot — the caller
 * catches (circuit-breaker discipline; the posting path is untouched).
 */
export async function registerDepreciationJobs(boss: PgBoss): Promise<void> {
  try {
    await boss.createQueue(DEPRECIATION_ASSEMBLY_QUEUE, {
      name: DEPRECIATION_ASSEMBLY_QUEUE,
      retryLimit: 2,
      retryBackoff: true,
      expireInMinutes: 15,
      retentionHours: 24,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) {
      throw error;
    }
  }
  await boss.work<DepreciationAssemblyJobPayload>(DEPRECIATION_ASSEMBLY_QUEUE, async (jobs) => {
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      if (job === undefined) continue;
      try {
        await runAssemblyJob(job.data);
        log.info(
          {
            action: "depreciation-assembly-job-complete",
            runId: job.data.runId,
            chunk: DEPRECIATION_ASSEMBLY_CHUNK,
          },
          "depreciation assembly job complete",
        );
      } catch (error) {
        if (error instanceof AssemblyCancelledError) {
          // Cancelled ≠ failed: complete the job (the run stays DRAFT with
          // zero residue — the rollback did its job).
          log.info(
            { action: "depreciation-assembly-job-cancelled", runId: job.data.runId },
            "depreciation assembly job cancelled — zero residue",
          );
          continue;
        }
        log.error(
          { action: "depreciation-assembly-job-failed", runId: job.data.runId, err: error },
          "depreciation assembly job failed (feature degrades, platform unaffected)",
        );
        throw error;
      }
    }
  });
}
