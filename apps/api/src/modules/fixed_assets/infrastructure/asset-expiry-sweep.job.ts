import type PgBoss from "pg-boss";

import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../infra/db/client";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import type { AssetExpirySweepService } from "../application/asset-expiry-sweep-service";

/**
 * PHASE-049 (W-19 — T-12, D-10) · the asset expiry sweep (pg-boss,
 * ADR-0008 — the hr-expiry-sweep shape, the 047 precedent): per ACTIVE
 * tenant, walk the configured threshold ladder's disjoint bands over the
 * FOUR expiry classes (warranty, insurance, license — and inspection
 * where a tenant tracks it, the R-10 fleet-light fourth) and emit the
 * structurally-deduped inbox notifications (category 'assets', severity
 * info at the ≥ 30-day bands / warning below — the S-15 ladder). The
 * run's seal (the audit record `assets.expiry_sweep_run`) lands after
 * the pass succeeded, in the same ambient transaction — the audit plane
 * IS the job log (acceptance #8's evidence).
 *
 * THE QUEUE NAME is the plan/phase doc's own verbatim `asset-expiry-sweep`
 * (D-10: "the daily `asset-expiry-sweep` pg-boss job"; the hr precedent's
 * own verbatim-name law — it deviates from the {module}.{job} dotted
 * convention deliberately, both sources naming it exactly this).
 *
 * THE CLOCK LAW (the owner's W-19 order): every date derives from the
 * database's own CURRENT_DATE inside the probes' SQL — the derived step;
 * NO Date.now()+delta anywhere in the sweep's path.
 *
 * NO ARMING, NO DOUBLE LAUNCH: the sweep never pre-creates state; the
 * dedupe is STRUCTURAL (uq_notifications_dedupe on (tenant_id,
 * dedupe_key) — the key `assets:{class}:{assetId}:{threshold}`), so
 * re-runs, the nightly cron, and a raced concurrent pass all converge.
 * The job registers once (the module's onModuleInit — the queue + the
 * named schedule are idempotent; a second registration is the
 * catch-and-continue degrade-the-feature-never-the-platform shape).
 *
 * Eligibility: tenants entitled to the `assets.maintenance` feature flag
 * (the CMMS plane's composable unit — 0108 §2; a tenant without the flag
 * has no maintenance plane to sweep; the plan-grant read runs inside the
 * ambient tenant UoW, the warranty entitlement-gate precedent).
 *
 * Schedule: daily 04:30 UTC — the nightly ladder's free window after the
 * hr sweep (04:15) and the inventory family (02:30–03:00), before the
 * reservations/bin-reconcile/cycle-count early cluster re-arms.
 */

export const ASSET_EXPIRY_SWEEP_QUEUE = "asset-expiry-sweep";
export const ASSET_EXPIRY_SWEEP_CRON = "30 4 * * *";

export async function runAssetExpirySweep(sweep: AssetExpirySweepService): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async (tx) => {
      const entitled = await tenantHasMaintenancePlane(tx);
      if (!entitled) return;
      await sweep.runSweep().catch(() => undefined);
    }).catch(() => undefined);
  }
}

/** The entitlement gate: the CMMS plane's own feature flag (business +
 * enterprise carry it; the four CMMS-carrying industry templates compose
 * it by default — 0108 §2/§3; starter stays at the declared neutral
 * zero). */
async function tenantHasMaintenancePlane(tx: TenantDb): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'assets.maintenance'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

export async function registerAssetExpiryJob(
  boss: PgBoss,
  sweep: AssetExpirySweepService,
): Promise<void> {
  try {
    await boss.createQueue(ASSET_EXPIRY_SWEEP_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(ASSET_EXPIRY_SWEEP_QUEUE, async () => {
    await runAssetExpirySweep(sweep);
  });
  await boss
    .schedule(ASSET_EXPIRY_SWEEP_QUEUE, ASSET_EXPIRY_SWEEP_CRON, { system: true })
    .catch(() => undefined);
}
