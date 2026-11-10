import type PgBoss from "pg-boss";

import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import { ZatcaPhase1Service } from "../application/zatca/zatca-phase1-service";
import { ownTenantName } from "../../../infra/settings/setting-reader";

/**
 * PHASE-037 T-08 · the ZATCA chain backfill sweep (pg-boss, ADR-0008 —
 * the installments sweep shape): per ACTIVE tenant, stamp the POSTED
 * invoices that pre-date a device's chain, in ISSUANCE order
 * (posted_at, created_at, id — the deterministic tie-breaker, phase §7
 * risk 3), bounded per run (the resumable workset; the next run picks
 * up exactly where this one stopped).
 *
 * Idempotency: the workset reads `icv IS NULL` rows only — a stamped
 * row is never touched again, so a re-run (or the daily cron after an
 * interactive run) is a no-op (the negative ledger proof: ZERO
 * journal-row changes — the backfill stamps columns on the invoice row,
 * it NEVER posts, never touches journal_entries).
 *
 * Manual surface: the controller routes run the same service methods
 * (dry-run plan first — the job never surprises an operator).
 */

export const ZATCA_BACKFILL_QUEUE = "zatca.backfill-sweep";
export const ZATCA_BACKFILL_CRON = "15 3 * * *";
/** The per-tenant-per-run bound (bounded jobs, resumable). */
const BACKFILL_BOUND = 500;

export async function runZatcaBackfillSweep(
  zatca: ZatcaPhase1Service,
  limit = BACKFILL_BOUND,
): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async () => {
      const devices = await zatca.listDevices({ limit: 1 });
      const device = devices[0];
      if (device === undefined) {
        // Stamping is opt-in per device — a tenant with no EIAS device
        // has no chain to backfill (the BR-060 guard is the one that
        // speaks for KSA-VAT simplified invoices, not the sweep).
        return;
      }
      const tenantName = await ownTenantName();
      await zatca
        .backfillRun({
          deviceId: device.id,
          limit,
          sellerName: tenantName.nameAr?.trim() || tenantName.name,
          actorId: null,
        })
        .catch(() => undefined);
    });
  }
}

export async function registerZatcaBackfillJob(
  boss: PgBoss,
  zatca: ZatcaPhase1Service,
): Promise<void> {
  try {
    await boss.createQueue(ZATCA_BACKFILL_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(ZATCA_BACKFILL_QUEUE, async () => {
    await runZatcaBackfillSweep(zatca);
  });
  await boss.schedule(ZATCA_BACKFILL_QUEUE, ZATCA_BACKFILL_CRON, { system: true }).catch(
    () => undefined,
  );
}
