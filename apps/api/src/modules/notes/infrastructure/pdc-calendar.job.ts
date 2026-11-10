import type PgBoss from "pg-boss";

import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import {
  computePdcCalendar,
  replacePdcCalendarSnapshot,
} from "../application/pdc-calendar-queries";
import { NotesReconciliationService } from "../application/notes-reconciliation";

/**
 * The notes daily jobs (PHASE-027 T7/T12; ADR-0008 — the crm
 * task-reminders-sweep registration shape):
 *
 *  - `notes.pdc-calendar.sweep` (cron 20 2 * * *): per ACTIVE tenant,
 *    recompute the maturity-calendar snapshot and REPLACE the cached entry
 *    (idempotent: same data → same buckets — the pure fold is
 *    deterministic; a re-run never duplicates). Staleness labeling lives in
 *    the read model (isStale — never stale-silent).
 *  - `notes.reconciliation.sweep` (cron 30 2 * * *): per ACTIVE tenant, run
 *    the RC-11 check in NIGHTLY mode (register↔GL; BROKEN blocks the period
 *    LOCK via PC-04 — an improvement over the 026 shipped state, which had
 *    no scheduled leg for RC-10; recorded in the completion report).
 */

export const NOTES_CALENDAR_SWEEP_QUEUE = "notes.pdc-calendar.sweep";
export const NOTES_CALENDAR_SWEEP_CRON = "20 2 * * *";
export const NOTES_RECONCILIATION_SWEEP_QUEUE = "notes.reconciliation.sweep";
export const NOTES_RECONCILIATION_SWEEP_CRON = "30 2 * * *";

/** The calendar sweep body (plain-callable so specs drive it WITHOUT pg-boss). */
export async function runCalendarSweep(now?: string): Promise<void> {
  const asOf = (now ?? new Date().toISOString()).slice(0, 10);
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async () => {
      const snapshot = await computePdcCalendar({ tenantId, asOf, now });
      replacePdcCalendarSnapshot(snapshot);
    });
  }
}

/** The RC-11 nightly sweep body (plain-callable). */
export async function runNotesReconciliationSweep(
  reconciliation: NotesReconciliationService,
  asOf?: string,
): Promise<void> {
  const date = asOf ?? new Date().toISOString().slice(0, 10);
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async () => {
      await reconciliation.runNotesCheck({ asOf: date, runMode: "NIGHTLY", checkedBy: null });
    });
  }
}

/** Module boot registration (degrade-the-feature-never-the-platform). */
export async function registerNotesJobs(
  boss: PgBoss,
  reconciliation: NotesReconciliationService,
): Promise<void> {
  await createQueueTolerant(boss, NOTES_CALENDAR_SWEEP_QUEUE);
  await boss.work(NOTES_CALENDAR_SWEEP_QUEUE, async () => {
    await runCalendarSweep();
  });
  await boss.schedule(NOTES_CALENDAR_SWEEP_QUEUE, NOTES_CALENDAR_SWEEP_CRON, { system: true }).catch(() => undefined);

  await createQueueTolerant(boss, NOTES_RECONCILIATION_SWEEP_QUEUE);
  await boss.work(NOTES_RECONCILIATION_SWEEP_QUEUE, async () => {
    await runNotesReconciliationSweep(reconciliation);
  });
  await boss
    .schedule(NOTES_RECONCILIATION_SWEEP_QUEUE, NOTES_RECONCILIATION_SWEEP_CRON, { system: true })
    .catch(() => undefined);
}

async function createQueueTolerant(boss: PgBoss, queue: string): Promise<void> {
  try {
    await boss.createQueue(queue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
}
