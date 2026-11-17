import type PgBoss from "pg-boss";

import { withTenant } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";
import { FeedService } from "../../hr/application/feed-service";
import { PitEngine } from "../application/pit-engine";
import { RunCalculationService } from "../application/run-calculation-service";
import { StatutoryProfileService } from "../application/statutory-profile-service";

/**
 * The payroll run-calculation job (PHASE-029 T4; ADR-0008 — the bounded
 * job the phase pins): `payroll.run.calculate` — the controller enqueues
 * it with an IDS-ONLY payload ({ runId } — no PII in jobs/queues per
 * TENANT_ISOLATION §3); the worker drives the calculation service inside
 * the run's tenant scope. Bounded: one run per job; failures surface in
 * the job's retry metadata (pg-boss dead-letter), never a partial run —
 * the calculation resets + re-inserts whole inside one ambient UoW.
 *
 * PHASE-046 (W-3) — THE PAYLOAD COMPATIBILITY CHECK (the plan's own
 * item): the queue contract is UNCHANGED — `{ tenantId, runId }`
 * ids-only, no new field; the statutory/variable arms the calculation
 * now performs resolve from the run's own period + the tenant's
 * settings at execution time (never from the queue). Only the worker's
 * CONSTRUCTION grew with the service's dependencies (the statutory
 * profile service, the PIT engine, the feed service — the same
 * ids-only boundary).
 *
 * Registered tolerant at boot (degrade-the-feature-never-the-platform).
 */

export const PAYROLL_CALCULATION_QUEUE = "payroll.run.calculate";

export async function registerPayrollJobs(boss: PgBoss): Promise<void> {
  try {
    await boss.createQueue(PAYROLL_CALCULATION_QUEUE);
  } catch {
    // already created (the notes-job precedent: never fail boot on a queue)
  }
  await boss.work(PAYROLL_CALCULATION_QUEUE, async (payload: unknown) => {
    const data = payload as { tenantId?: string; runId?: string };
    if (typeof data?.tenantId !== "string" || typeof data?.runId !== "string") {
      return;
    }
    const audit = new AuditService(new DrizzleAuditStore());
    const calculation = new RunCalculationService(
      audit,
      new StatutoryProfileService(audit),
      new PitEngine(audit),
      new FeedService(audit),
    );
    await withTenant(data.tenantId, async () => {
      await calculation.calculate(data.runId!, { actorId: null });
    });
  });
}

/** Enqueue helper (ids-only payload — the PII law). */
export async function enqueueRunCalculation(
  boss: PgBoss,
  input: { tenantId: string; runId: string },
): Promise<void> {
  await boss.send(PAYROLL_CALCULATION_QUEUE, input);
}
