import type PgBoss from "pg-boss";

import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../infra/db/client";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import type { WarrantiesService } from "../application/warranties";

/**
 * PHASE-039 T-05 · the warranty expiry sweep (pg-boss, ADR-0008 — the
 * scorecard-sweep shape): per ACTIVE tenant, walk the 30/7/0-day windows
 * over the expiring ACTIVE warranties and emit the deduped inbox
 * notifications (category 'warranties', severity info at 30d / warning at
 * 7/0d — the S-15 ladder).
 *
 * Eligibility: only tenants with the sales.warranties feature ENTITLED get
 * the sweep (the plan-grant read inside the ambient tenant UoW — the
 * scorecard entitlement-gate precedent).
 *
 * Idempotency: the per-window dedupe key
 * (warranty-expiry:{id}:{window}) plus last_notified_at make re-runs and
 * the nightly cron converge — nothing accumulates, and the sweep is
 * evidence/notification only, never a ledger write.
 */

export const WARRANTY_EXPIRY_SWEEP_QUEUE = "sales.warranty-expiry-sweep";
export const WARRANTY_EXPIRY_SWEEP_CRON = "50 2 * * *";
/** The per-tenant-per-run bound (bounded jobs). */
const SWEEP_BOUND = 200;

export async function runWarrantyExpirySweep(
  warranties: WarrantiesService,
  limit = SWEEP_BOUND,
): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async (tx) => {
      const entitled = await tenantHasWarranties(tx);
      if (!entitled) return;
      await warranties
        .runExpirySweep({ withinDaysList: [30, 7, 0], limit })
        .catch(() => undefined);
    }).catch(() => undefined);
  }
}

/** The entitlement gate: the tenant's materialized entitlements carry the
 * feature key (PLAN/MANUAL — the tenancy store's table); read inside the
 * ambient tenant UoW (RLS-scoped like every tenant-plane read). */
async function tenantHasWarranties(tx: TenantDb): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'sales.warranties'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

export async function registerWarrantyExpiryJob(
  boss: PgBoss,
  warranties: WarrantiesService,
): Promise<void> {
  try {
    await boss.createQueue(WARRANTY_EXPIRY_SWEEP_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(WARRANTY_EXPIRY_SWEEP_QUEUE, async () => {
    await runWarrantyExpirySweep(warranties);
  });
  await boss
    .schedule(WARRANTY_EXPIRY_SWEEP_QUEUE, WARRANTY_EXPIRY_SWEEP_CRON, { system: true })
    .catch(() => undefined);
}
