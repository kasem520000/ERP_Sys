import type PgBoss from "pg-boss";

import { withTenant } from "../../../infra/db/tenant-context";
import { AuditService } from "../../audit/api/audit";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";
import { RunCalculationService } from "../application/run-calculation-service";

/**
 * The payroll run-calculation job (PHASE-029 T4; ADR-0008 — the bounded
 * job the phase pins): `payroll.run.calculate` — the controller enqueues
 * it with an IDS-ONLY payload ({ runId } — no PII in jobs/queues per
 * TENANT_ISOLATION §3); the worker drives the calculation service inside
 * the run's tenant scope. Bounded: one run per job; failures surface in
 * the job's retry metadata (pg-boss dead-letter), never a partial run —
 * the calculation resets + re-inserts whole inside one ambient UoW.
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
    const calculation = new RunCalculationService(
      new AuditService(new DrizzleAuditStore()),
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
