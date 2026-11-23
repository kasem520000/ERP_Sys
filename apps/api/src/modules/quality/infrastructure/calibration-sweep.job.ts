import type PgBoss from "pg-boss";

import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../infra/db/client";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import type { QualityCalibrationSweepService } from "../application/quality-calibration-sweep-service";

/**
 * PHASE-050 (W-26 — T-08, D-08) · the quality-calibration-due sweep
 * (pg-boss, ADR-0008 — the asset-expiry-sweep shape, the 049 precedent):
 * per ACTIVE tenant, walk the configured threshold ladder's disjoint
 * bands over the instruments' LATEST calibration due dates and emit the
 * structurally-deduped inbox notifications (category 'quality' — the
 * 0118-widened domain, severity info at the ≥ 30-day bands / warning
 * below — the S-15 ladder). The run's seal (the audit record
 * `quality.calibration_sweep_run`) lands after the pass succeeded, in
 * the same ambient transaction — the audit plane IS the job log
 * (acceptance #8's evidence).
 *
 * THE QUEUE NAME is the phase doc's own verbatim
 * `quality-calibration-due` (the D-10 verbatim-name law's W-26 sibling:
 * both the phase doc §4 and the master plan §3 name it exactly this; it
 * deviates from the {module}.{job} dotted convention deliberately).
 *
 * THE CLOCK LAW (the owner's standing order): every date derives from
 * the database's own CURRENT_DATE inside the probe's SQL — the derived
 * step; NO Date.now()+delta anywhere in the sweep's path.
 *
 * NO ARMING, NO DOUBLE LAUNCH: the sweep never pre-creates state; the
 * dedupe is STRUCTURAL (uq_notifications_dedupe on (tenant_id,
 * dedupe_key) — D-08's own axes `quality:calibration:{assetId}:
 * {threshold}:{dueDate}`, the day axis the DUE DATE the alert names),
 * so re-runs, the nightly cron, and a raced concurrent pass all
 * converge; a re-calibrated instrument's next cycle re-alerts through
 * its new due-date axis. The job registers once (the module's
 * onModuleInit — the queue + the named schedule are idempotent; a
 * second registration is the catch-and-continue
 * degrade-the-feature-never-the-platform shape).
 *
 * Eligibility: tenants entitled to the `quality` feature flag (the QMS
 * plane's composable unit — 0116 §5b; a tenant without the flag has no
 * quality plane to sweep; the plan-grant read runs inside the ambient
 * tenant UoW, the cmms entitlement-gate precedent).
 *
 * Schedule: daily 04:45 UTC — the nightly ladder's free window after
 * the hr sweep (04:15) and the asset sweep (04:30), before the early
 * reservations/bin-reconcile/cycle-count cluster re-arms. THE SWEEP
 * JOINS THE STANDING ISOLATE SET FROM THIS WAVE (the master plan §0c
 * (2) — the fifth isolate: soak · fcm · email · the cmms sweep · this).
 */

export const QUALITY_CALIBRATION_SWEEP_QUEUE = "quality-calibration-due";
export const QUALITY_CALIBRATION_SWEEP_CRON = "45 4 * * *";

export async function runQualityCalibrationSweep(
  sweep: QualityCalibrationSweepService,
): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async (tx) => {
      const entitled = await tenantHasQualityPlane(tx);
      if (!entitled) return;
      await sweep.runSweep().catch(() => undefined);
    }).catch(() => undefined);
  }
}

/** The entitlement gate: the QMS plane's own feature flag (business +
 * enterprise carry it; the four quality-carrying industry templates
 * compose it by default — 0116 §5b/§5c; starter stays at the declared
 * neutral zero). */
async function tenantHasQualityPlane(tx: TenantDb): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'quality'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

export async function registerQualityCalibrationJob(
  boss: PgBoss,
  sweep: QualityCalibrationSweepService,
): Promise<void> {
  try {
    await boss.createQueue(QUALITY_CALIBRATION_SWEEP_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(QUALITY_CALIBRATION_SWEEP_QUEUE, async () => {
    await runQualityCalibrationSweep(sweep);
  });
  await boss
    .schedule(QUALITY_CALIBRATION_SWEEP_QUEUE, QUALITY_CALIBRATION_SWEEP_CRON, { system: true })
    .catch(() => undefined);
}
