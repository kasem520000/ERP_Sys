import type PgBoss from "pg-boss";

import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../infra/db/client";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import { ScorecardService } from "../application/scorecards";

/**
 * PHASE-038 T-06 · the scorecard nightly sweep (pg-boss, ADR-0008 — the
 * ZATCA backfill-sweep shape): per ACTIVE tenant, recompute the
 * scorecards of the suppliers whose ratings are stale (older than the
 * window's end or missing entirely), bounded per run.
 *
 * Eligibility: only tenants with the purchasing.supplier_scorecards
 * feature ENTITLED get the sweep (the plan-grant read — the feature
 * catalog's plan keys live on the tenants' derived entitlements; the
 * sweep reads the plan feature_keys through the platform-plane query).
 *
 * Idempotency: recompute OVERWRITES the one-row-per-supplier store —
 * a re-run (or the nightly cron after an interactive run) converges on
 * the same fold; nothing accumulates, nothing double-posts (the
 * scorecard is evidence recomputation, never a ledger write).
 */

export const SCORECARD_SWEEP_QUEUE = "purchasing.scorecard-sweep";
export const SCORECARD_SWEEP_CRON = "40 2 * * *";
/** The per-tenant-per-run bound (bounded jobs). */
const SWEEP_BOUND = 200;

export async function runScorecardSweep(scorecards: ScorecardService, limit = SWEEP_BOUND): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async (tx) => {
      const entitled = await tenantHasScorecards(tx);
      if (!entitled) return;
      const stale = await staleScorecardSupplierIds(tx, limit);
      for (const supplierId of stale) {
        await scorecards
          .recompute({ supplierId, computedBy: null })
          .catch(() => undefined);
      }
    }).catch(() => undefined);
  }
}

/** The entitlement gate: the tenant's materialized entitlements carry
 * the feature key (PLAN/MANUAL — the tenancy store's table); read inside
 * the ambient tenant UoW (RLS-scoped like every tenant-plane read). */
async function tenantHasScorecards(tx: TenantDb): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'purchasing.supplier_scorecards'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

/** The stale workset: suppliers with no rating, or a rating whose window
 * ended before yesterday (the window moved past it). */
async function staleScorecardSupplierIds(tx: TenantDb, limit: number): Promise<string[]> {
  const rows = await tx.execute(sql`
    SELECT DISTINCT po.supplier_id AS id
    FROM purchase_orders po
    WHERE po.status IN ('ISSUED', 'CLOSED')
      AND (
        NOT EXISTS (SELECT 1 FROM supplier_ratings r WHERE r.supplier_id = po.supplier_id)
        OR EXISTS (
          SELECT 1 FROM supplier_ratings r2
          WHERE r2.supplier_id = po.supplier_id AND r2.window_end < CURRENT_DATE - 1)
      )
    LIMIT ${limit}
  `);
  return (rows.rows as unknown as { id: string }[]).map((row) => row.id);
}

export async function registerScorecardSweepJob(
  boss: PgBoss,
  scorecards: ScorecardService,
): Promise<void> {
  try {
    await boss.createQueue(SCORECARD_SWEEP_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(SCORECARD_SWEEP_QUEUE, async () => {
    await runScorecardSweep(scorecards);
  });
  await boss.schedule(SCORECARD_SWEEP_QUEUE, SCORECARD_SWEEP_CRON, { system: true }).catch(
    () => undefined,
  );
}
