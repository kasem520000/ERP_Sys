import type PgBoss from "pg-boss";

import { getBoss } from "../../../infra/jobs/boss";
import { requireTenantContext, withTenant } from "../../../infra/db/tenant-context";
import { childLogger } from "../../../infra/observability/logger";
import { AuditService } from "../../audit/api/audit";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";
import { ConsolidationReaderService } from "../application/reader-service";
import { RunService } from "../application/run-service";

/**
 * PHASE-034 T6 — the consolidation run as a bounded pg-boss job (ADR-0008;
 * mirrors the PHASE-026 depreciation-assembly registration pattern):
 *
 * - ONE queue, `consolidation.run.execute` — on-demand (no cron);
 * - payloads are tenant-scoped (`tenantId` + `runId` + `actorId`) — the
 *   handler re-establishes tenant scope via `withTenant` (the OWNER
 *   tenant's plane; ADR-0008 §5);
 * - bounded: the run reads each member through the audited reader
 *   (per-read audit rows batch-composed in the same UoW) and completes in
 *   ONE transaction per run — the snapshot lands atomically with COMPLETED
 *   or the run FAILS with zero partial snapshot (the state machine is the
 *   idempotency boundary; a retried FAILED job re-executes cleanly);
 * - the read set is bounded by CLOSED member periods (BR-056 — the reader
 *   function re-verifies) and indexed `(tenant, period, account)`.
 *
 * Honest boundary: the queue is on-demand with pg-boss's own retry
 * (retryLimit 2, backoff); a FAILED run stays inspectable (typed
 * error_code/error_detail) and re-consolidation is always a NEW run.
 */
const log = childLogger({ module: "consolidation-run-jobs" });

/** On-demand queue (ADR-0008): one job = one run execution. */
export const CONSOLIDATION_RUN_QUEUE = "consolidation.run.execute";

export interface ConsolidationRunJobPayload {
  tenantId: string;
  runId: string;
  actorId: string | null;
}

/** Register the run queue + worker (module onModuleInit). */
export async function registerConsolidationJobs(boss: PgBoss): Promise<void> {
  try {
    await boss.createQueue(CONSOLIDATION_RUN_QUEUE, {
      name: CONSOLIDATION_RUN_QUEUE,
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
  await boss.work<ConsolidationRunJobPayload>(CONSOLIDATION_RUN_QUEUE, async (jobs) => {
    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      if (job === undefined) continue;
      try {
        const result = await runExecutionJob(job.data);
        log.info(
          {
            action: "consolidation-run-job-complete",
            runId: job.data.runId,
            status: result.status,
          },
          "consolidation run job complete",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(
          { action: "consolidation-run-job-error", runId: job.data.runId, message },
          "consolidation run job failed",
        );
        // The run row itself already carries the typed FAILED state (the
        // service's own catch); surface the job failure to pg-boss.
        throw error;
      }
    }
  });
}

/** The job body: re-establish the OWNER tenant scope, execute the run. */
export async function runExecutionJob(
  payload: ConsolidationRunJobPayload,
): Promise<{ runId: string; status: string }> {
  return withTenant(payload.tenantId, async () => {
    void requireTenantContext();
    const service = new RunService(
      // The job runs outside the DI container (the depreciation precedent):
      // the reader + audit compose through the service's constructor seams.
      new AuditService(new DrizzleAuditStore()),
      new ConsolidationReaderService(new AuditService(new DrizzleAuditStore())),
    );
    const run = await service.executeRun({ runId: payload.runId, actorId: payload.actorId });
    return { runId: run.id, status: run.status };
  });
}

/** Enqueue helper (the run service's controller path calls this). */
export async function enqueueRunExecution(
  tenantId: string,
  runId: string,
  actorId: string | null,
): Promise<string | undefined> {
  const boss = getBoss();
  const jobId = await boss.send(
    CONSOLIDATION_RUN_QUEUE,
    { tenantId, runId, actorId } satisfies ConsolidationRunJobPayload,
    { singletonKey: `consolidation-run:${runId}` },
  );
  return typeof jobId === "string" ? jobId : undefined;
}
