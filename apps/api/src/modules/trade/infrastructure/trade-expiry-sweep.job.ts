import type PgBoss from "pg-boss";

import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../infra/db/client";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import type { TradeExpirySweepService } from "../application/trade-expiry-sweep-service";

/**
 * PHASE-051 (W-34 — T-06, D-09) · the trade-expiry sweep (pg-boss,
 * ADR-0008 — the 0111/calibration shape, the 051 sibling): per ACTIVE
 * tenant, walk the configured threshold ladder's disjoint bands over the
 * live instruments' expiry dates and emit the structurally-deduped
 * inbox notifications (category 'trade' — the 0123-widened domain,
 * severity info at the ≥ 30-day bands / warning below — the S-15
 * ladder), with the discrepancy family riding the same bands; the
 * ladder's own terminus (the ISSUED → EXPIRED transition, the DB's own
 * clock) runs FIRST in the same per-tenant pass. The run's seal (the
 * audit record `trade.lc_expiry_sweep_run`) lands after the pass
 * succeeded, in the same ambient transaction — the audit plane IS the
 * job log (the acceptance's evidence).
 *
 * THE QUEUE NAME is the phase doc's own verbatim
 * `trade-expiry-sweep` (the D-09 naming; it deviates from the
 * {module}.{job} dotted convention deliberately — the
 * quality-calibration-due precedent's own deviation class).
 *
 * THE CLOCK LAW (the owner's standing order): every date derives from
 * the database's own CURRENT_DATE inside the probes' SQL — the derived
 * step; NO Date.now()+delta anywhere in the sweep's path.
 *
 * NO ARMING, NO DOUBLE LAUNCH: the sweep never pre-creates notification
 * state; the dedupe is STRUCTURAL (uq_notifications_dedupe on
 * (tenant_id, dedupe_key) — D-09's own axes `trade:lc:{lcId}:
 * {threshold}:{expiryDate}`, the day axis the EXPIRY DATE the alert
 * names), so re-runs, the nightly cron, and a raced concurrent pass all
 * converge; an amended instrument's new expiry date forms new keys and
 * its next cycle alerts again. The job registers once (the module's
 * onModuleInit — the queue + the named schedule are idempotent; a
 * second registration is the catch-and-continue
 * degrade-the-feature-never-the-platform shape).
 *
 * Eligibility: tenants entitled to the `trade` feature flag (the trade
 * plane's composable unit — 0122 §5c; a tenant without the flag has no
 * trade plane to sweep; the plan-grant read runs inside the ambient
 * tenant UoW, the cmms/quality entitlement-gate precedent).
 *
 * Schedule: daily 05:00 UTC — the nightly ladder's free window after
 * the hr sweep (04:15), the asset sweep (04:30) and the quality
 * calibration sweep (04:45), before the CRM task reminders sweep
 * (05:30). THE SWEEP JOINS THE STANDING ISOLATE SET FROM THIS WAVE (the
 * master plan §0c (2) — the SIXTH isolate: soak · fcm · email · the
 * cmms sweep · the quality calibration sweep · this).
 */

export const TRADE_EXPIRY_SWEEP_QUEUE = "trade-expiry-sweep";
export const TRADE_EXPIRY_SWEEP_CRON = "0 5 * * *";

export async function runTradeExpirySweep(
  sweep: TradeExpirySweepService,
): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async (tx) => {
      const entitled = await tenantHasTradePlane(tx);
      if (!entitled) return;
      await sweep.runSweep().catch(() => undefined);
    }).catch(() => undefined);
  }
}

/** The entitlement gate: the trade plane's own feature flag (business +
 * enterprise carry it; the three trade-carrying industry templates
 * compose it by default — 0122 §5c; starter stays at the declared
 * neutral zero). */
async function tenantHasTradePlane(tx: TenantDb): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'trade'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

export async function registerTradeExpiryJob(
  boss: PgBoss,
  sweep: TradeExpirySweepService,
): Promise<void> {
  try {
    await boss.createQueue(TRADE_EXPIRY_SWEEP_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(TRADE_EXPIRY_SWEEP_QUEUE, async () => {
    await runTradeExpirySweep(sweep);
  });
  await boss
    .schedule(TRADE_EXPIRY_SWEEP_QUEUE, TRADE_EXPIRY_SWEEP_CRON, { system: true })
    .catch(() => undefined);
}
