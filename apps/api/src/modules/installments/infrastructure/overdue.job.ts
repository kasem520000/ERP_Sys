import type PgBoss from "pg-boss";

import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import {
  InstallmentCollectionService,
} from "../application/collection-service";
import { listPlans, listLinesByPlan, type InstallmentPlanRow } from "../infrastructure/installments.store";

/**
 * The installments daily sweep (PHASE-027 T9; ADR-0008 — the crm
 * registration shape): per ACTIVE tenant → per ACTIVE/DEFAULTED plan —
 *
 *   1. recompute collections from the source document's posted allocations
 *      (idempotent by rebuild; no manual status writes exist);
 *   2. apply the date rules (DUE at due_date, OVERDUE after grace) + the
 *      DEFAULTED consecutive flip + dunning + close-on-residual-zero;
 *   3. auto-charge late fees where the policy says so (G-28 via the same
 *      service the manual endpoint uses — INV-013 once per line).
 */
export const INSTALLMENTS_SWEEP_QUEUE = "installments.daily-sweep";
export const INSTALLMENTS_SWEEP_CRON = "40 2 * * *";

export async function runInstallmentsSweep(
  collections: InstallmentCollectionService,
  today?: string,
): Promise<void> {
  const date = today ?? new Date().toISOString().slice(0, 10);
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async () => {
      const plans = await listPlans({ status: "ACTIVE", limit: 10_000 });
      const defaulted = await listPlans({ status: "DEFAULTED", limit: 10_000 });
      const live: InstallmentPlanRow[] = [...plans, ...defaulted];
      for (const plan of live) {
        const { changedLines } = await collections.recomputePlanCollections(plan);
        void changedLines;
        const lines = await listLinesByPlan(plan.id);
        await collections.applyPlanPolicyOutcome(plan, lines, date);
        // Auto-charge (policy default OFF — explicit tenant action only).
        // P27-G fix: re-read the lines AFTER applyPlanPolicyOutcome — the
        // date-rule pass above is what flips PENDING/DUE → OVERDUE in the DB,
        // so the pre-fetch `lines` array still carries the stale statuses and
        // the loop below would skip every line it exists to charge (found by
        // the sweep's auto_charge spec).
        if (plan.lateFeePolicy.auto_charge) {
          const linesAfterPolicy = await listLinesByPlan(plan.id);
          for (const line of linesAfterPolicy) {
            if (line.status === "OVERDUE" && line.lateFeeEntryId === null) {
              await collections.chargeLateFee({ lineId: line.id, actorId: null }).catch(() => undefined);
            }
          }
        }
      }
    });
  }
}

export async function registerInstallmentsJobs(
  boss: PgBoss,
  collections: InstallmentCollectionService,
): Promise<void> {
  try {
    await boss.createQueue(INSTALLMENTS_SWEEP_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(INSTALLMENTS_SWEEP_QUEUE, async () => {
    await runInstallmentsSweep(collections);
  });
  await boss.schedule(INSTALLMENTS_SWEEP_QUEUE, INSTALLMENTS_SWEEP_CRON, { system: true }).catch(() => undefined);
}
