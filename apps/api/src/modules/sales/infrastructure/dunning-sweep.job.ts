import type PgBoss from "pg-boss";

import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../infra/db/client";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import type { DunningService } from "../application/dunning";

/**
 * PHASE-039 T-07 · the nightly dunning sweep (pg-boss, ADR-0008 — the
 * scorecard-sweep shape): per ACTIVE tenant, one BR-065 pass over the
 * overdue open items (letters advance ONE step per run, never skip or
 * regress) + the credit-review-due notifications (L1-10).
 *
 * Cron 45 2 * * * — deliberately BEFORE the warranty expiry sweep at 2:50
 * (the collections ladder surfaces first in the morning inbox; both are
 * independent, the ordering is operational hygiene only).
 *
 * Eligibility: only tenants with the sales.dunning feature ENTITLED get
 * the sweep (the plan-grant read inside the ambient tenant UoW — the
 * scorecard entitlement-gate precedent).
 *
 * Idempotency: the letters UNIQUE (tenant, invoice, step_no) is the
 * re-fire guard; the sweep is evidence/notification + (only via the
 * separate charge route) never a ledger write; the review-due dedupe key
 * (credit-review-due:{partnerId}:{asOf}) makes the nightly re-run a no-op.
 */

export const DUNNING_SWEEP_QUEUE = "sales.dunning-sweep";
export const DUNNING_SWEEP_CRON = "45 2 * * *";
/** The per-tenant-per-run bound (bounded jobs). */
const SWEEP_BOUND = 200;

export async function runDunningSweep(dunning: DunningService, limit = SWEEP_BOUND): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async (tx) => {
      const entitled = await tenantHasDunning(tx);
      if (!entitled) return;
      await dunning.runSweep({ limit }).catch(() => undefined);
      await dunning.runCreditReviewSweep({ limit }).catch(() => undefined);
    }).catch(() => undefined);
  }
}

/** The entitlement gate: the tenant's materialized entitlements carry the
 * feature key (PLAN/MANUAL — the tenancy store's table); read inside the
 * ambient tenant UoW (RLS-scoped like every tenant-plane read). */
async function tenantHasDunning(tx: TenantDb): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'sales.dunning'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

export async function registerDunningSweepJob(
  boss: PgBoss,
  dunning: DunningService,
): Promise<void> {
  try {
    await boss.createQueue(DUNNING_SWEEP_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(DUNNING_SWEEP_QUEUE, async () => {
    await runDunningSweep(dunning);
  });
  await boss
    .schedule(DUNNING_SWEEP_QUEUE, DUNNING_SWEEP_CRON, { system: true })
    .catch(() => undefined);
}
