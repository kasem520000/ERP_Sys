import type PgBoss from "pg-boss";

import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../infra/db/client";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { withTenant } from "../../../infra/db/tenant-context";
import type { EscalationService } from "../application/escalation-service";

/**
 * PHASE-052 (W-45 — T-04, D-08) · the workflow-escalation sweep (pg-boss,
 * ADR-0008 — the trade-expiry-sweep shape, the 052 sibling): per ACTIVE
 * tenant, scan the awaiting step instances past their SLA (the DB's own
 * clock decides inside the scan's SQL) and land the structurally-deduped
 * escalation_events rows (the NOTIFY breach + the recurring REMINDER
 * family on the settings registry's cadence) with the owner-target
 * breach notification and the assignee reminders through the inbox. The
 * run's seal (the audit record `workflow.escalation_sweep_run`) lands
 * after the pass succeeded, in the same ambient transaction — the audit
 * plane IS the job log (the acceptance's evidence).
 *
 * THE QUEUE NAME is the phase doc's own verbatim
 * `workflow-escalation-sweep` (D-08's naming; it deviates from the
 * {module}.{job} dotted convention deliberately — the
 * trade-expiry-sweep precedent's own deviation class).
 *
 * THE CLOCK LAW (the owner's standing order: «ساعة مثبتة أو خطوة مشتقة
 * — لا Date.now()+دلتا أبدًا»): every instant derives from the
 * DATABASE'S OWN now() inside the scan's SQL — the breach verdict
 * (`si.due_at < now()`) and the reminder thresholds (the scan's own
 * dbNow + the row's fixed due_at) never touch a JS wall clock.
 *
 * NO ARMING, NO DOUBLE LAUNCH: the sweep never pre-creates escalation
 * state; the dedupe is STRUCTURAL (uq_escalation_events_dedupe on
 * (tenant_id, step_instance_id, kind, due_date) — D-08's own axes
 * `workflow:sla:{stepInstanceId}:{kind}:{dueDate}`, the day axis the
 * DUE DATE the event names), so re-runs, the nightly cron, and a raced
 * concurrent pass all converge; the inbox family rides its own
 * per-member keys (`workflow:sla:{stepInstanceId}:REMINDER:{hours}:
 * {dueDate}`). The job registers once (the module's onModuleInit — the
 * queue + the named schedule are idempotent; a second registration is
 * the catch-and-continue degrade-the-feature-never-the-platform shape).
 *
 * Eligibility: tenants entitled to the `workflow.escalation` feature
 * flag (0130 §5 — the escalation plane's own composable unit; the
 * engine flag alone is NOT enough; a tenant without the flag has no
 * escalation plane to sweep; the plan-grant read runs inside the
 * ambient tenant UoW, the cmms/quality/trade entitlement-gate
 * precedent).
 *
 * Schedule: daily 05:45 UTC — the nightly ladder's free window after
 * the CRM task reminders sweep (05:30), the trade expiry sweep (05:00),
 * the hr sweep (04:15), the asset sweep (04:30) and the quality
 * calibration sweep (04:45). THE SWEEP JOINS THE STANDING ISOLATE SET
 * FROM THIS WAVE (the master plan §0c (2) — the SEVENTH isolate: soak
 * · fcm · email · the cmms sweep · the quality calibration sweep · the
 * trade expiry sweep · this).
 */

export const WORKFLOW_ESCALATION_SWEEP_QUEUE = "workflow-escalation-sweep";
export const WORKFLOW_ESCALATION_SWEEP_CRON = "45 5 * * *";

export async function runWorkflowEscalationSweep(
  sweep: EscalationService,
): Promise<void> {
  for (const tenantId of await listActiveTenantIds()) {
    await withTenant(tenantId, async (tx) => {
      const entitled = await tenantHasEscalationPlane(tx);
      if (!entitled) return;
      await sweep.runEscalationSweep().catch(() => undefined);
    }).catch(() => undefined);
  }
}

/** The entitlement gate: the escalation plane's own feature flag (the
 * 0130 §5 composable unit — business + enterprise compose it on top of
 * the engine flag; the starter tenant stays at the declared neutral
 * zero). */
async function tenantHasEscalationPlane(tx: TenantDb): Promise<boolean> {
  const rows = await tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'workflow.escalation'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

export async function registerWorkflowEscalationJob(
  boss: PgBoss,
  sweep: EscalationService,
): Promise<void> {
  try {
    await boss.createQueue(WORKFLOW_ESCALATION_SWEEP_QUEUE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/exist/i.test(message)) throw error;
  }
  await boss.work(WORKFLOW_ESCALATION_SWEEP_QUEUE, async () => {
    await runWorkflowEscalationSweep(sweep);
  });
  await boss
    .schedule(WORKFLOW_ESCALATION_SWEEP_QUEUE, WORKFLOW_ESCALATION_SWEEP_CRON, {
      system: true,
    })
    .catch(() => undefined);
}
