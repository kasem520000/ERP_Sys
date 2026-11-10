import type PgBoss from "pg-boss";

import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import { InboxService } from "../../notifications/application/inbox-service";
import { compareExact } from "../../accounting/application/decimal-strings";
import { percentUsed, ConsumptionService } from "../application/consumption-service";
import { listBudgets } from "./budgeting.store";

/**
 * The budgeting daily job (PHASE-028 T6; ADR-0008 — the pdc-calendar
 * registration shape): `budgeting.controls.sweep` (cron 50 2 * * *) — per
 * ACTIVE tenant, per ACTIVE budget: recompute the period consumption and
 * emit the at/over-threshold warning (category budgeting) idempotently
 * (dedupeKey `budget-sweep:<budgetId>:<periodId>` — the
 * uq_notifications_dedupe once-per-event discipline). Zero partial state:
 * the sweep only notifies, never mutates budgets (and never touches the
 * ledger — the module is structurally ledger-incapable).
 */

export const CONTROL_EVALUATION_SWEEP_QUEUE = "budgeting.controls.sweep";
export const CONTROL_EVALUATION_SWEEP_CRON = "50 2 * * *";

/** The sweep body (plain-callable so specs drive it WITHOUT pg-boss). */
export async function runControlEvaluationSweep(
  inbox: InboxService,
  consumption: ConsumptionService,
): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async () => {
      const budgets = await listBudgets({ status: "ACTIVE" });
      for (const budget of budgets) {
        const snapshot = await consumption.computeSnapshot(budget.id);
        for (const period of snapshot.periods) {
          for (const row of period.rows) {
            if (compareExact(row.budget, "0") === 0) {
              continue;
            }
            if (compareExact(row.actual, row.budget) < 0) {
              continue;
            }
            const percent = percentUsed(row.budget, row.actual) ?? "0.00";
            await inbox.record({
              category: "budgeting",
              severity: "warning",
              title: {
                ar: "استهلاك الموازنة عند الحد أو فوقه",
                en: "Budget consumption at/over threshold",
              },
              body: {
                ar: `الموازنة ${budget.code}: الفترة ${period.name} استهلكت ${percent}% من الخط (BR-051 — رقابة استشارية)`,
                en: `Budget ${budget.code}: period ${period.name} used ${percent}% of the line (BR-051 — advisory)`,
              },
              dedupeKey: `budget-sweep:${budget.id}:${period.fiscalPeriodId}`,
            });
          }
        }
      }
    });
  }
}

/** Module boot registration (degrade-the-feature-never-the-platform). */
export async function registerBudgetingJobs(
  boss: PgBoss,
  inbox: InboxService,
  consumption: ConsumptionService,
): Promise<void> {
  await createQueueTolerant(boss, CONTROL_EVALUATION_SWEEP_QUEUE);
  await boss.work(CONTROL_EVALUATION_SWEEP_QUEUE, async () => {
    await runControlEvaluationSweep(inbox, consumption);
  });
  await boss
    .schedule(CONTROL_EVALUATION_SWEEP_QUEUE, CONTROL_EVALUATION_SWEEP_CRON, { system: true })
    .catch(() => undefined);
}

async function createQueueTolerant(boss: PgBoss, queue: string): Promise<void> {
  try {
    await boss.createQueue(queue);
  } catch {
    // already created (the notes-job precedent: never fail boot on a queue)
  }
}
