import type PgBoss from "pg-boss";

import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../infra/db/client";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import type { TalentAlertsService } from "../application/talent-alerts-service";

/**
 * PHASE-047 (W-3 — T-09, D-06) · the hr expiry sweep (pg-boss,
 * ADR-0008 — the warranty-expiry-sweep shape): per ACTIVE tenant,
 * walk the configured threshold ladder's disjoint bands over the four
 * probes (documents, certifications, probation end, review-due) and
 * emit the BR-091-deduped inbox notifications (category 'hr',
 * severity info at the ≥ 30-day bands / warning below — the S-15
 * ladder).
 *
 * THE QUEUE NAME is the phase doc's own verbatim `hr-expiry-sweep`
 * (docs/implementation/phases/PHASE-047.md §4 Jobs + the plan's D-06
 * — pinned there before this file existed; it deviates from the
 * {module}.{job} dotted convention deliberately, both sources naming
 * it exactly this).
 *
 * Eligibility: tenants entitled to ANY of the four talent feature
 * flags (hr.performance / hr.recruitment / hr.training / hr.org —
 * matrix §3.25's composable units; a tenant without the talent plane
 * has no talent registers to sweep). The plan-grant read runs inside
 * the ambient tenant UoW (the warranty entitlement-gate precedent).
 *
 * Idempotency: the per-(kind, employee, document, threshold) dedupe
 * key plus the disjoint bands make re-runs and the nightly cron
 * converge — nothing accumulates, and the sweep is evidence/
 * notification only, never a ledger write (D-05) and never a talent
 * row write (D-06's "never a repair, only the alert").
 *
 * Schedule: daily 04:15 UTC — the nightly ladder's free window after
 * the inventory family (02:30 shelf-life, 02:40 scorecard, 02:45
 * dunning, 02:50 warranty, 03:00 slow-movement) and the reservations
 * (01:15)/bin-reconcile (01:45)/cycle-count (02:15) runs.
 */

export const HR_EXPIRY_SWEEP_QUEUE = "hr-expiry-sweep";
export const HR_EXPIRY_SWEEP_CRON = "15 4 * * *";

export async function runHrExpirySweep(alerts: TalentAlertsService): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async (tx) => {
      const entitled = await tenantHasTalentPlane(tx);
      if (!entitled) return;
      await alerts.runExpirySweep().catch(() => undefined);
    }).catch(() => undefined);
  }
}

/** The entitlement gate: ANY of the four talent flags (the plan's
 * composable units — the four people-carrying industry templates and
 * the business/enterprise plans compose them together by default, so
 * in practice the gate reads "the talent plane is on"). */
async function tenantHasTalentPlane(tx: TenantDb): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key IN ('hr.performance', 'hr.recruitment', 'hr.training', 'hr.org')
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

export async function registerHrExpiryJob(
  boss: PgBoss,
  alerts: TalentAlertsService,
): Promise<void> {
  try {
    await boss.createQueue(HR_EXPIRY_SWEEP_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(HR_EXPIRY_SWEEP_QUEUE, async () => {
    await runHrExpirySweep(alerts);
  });
  await boss
    .schedule(HR_EXPIRY_SWEEP_QUEUE, HR_EXPIRY_SWEEP_CRON, { system: true })
    .catch(() => undefined);
}
