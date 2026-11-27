import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { InboxService } from "../../notifications/application/inbox-service";
import * as store from "../infrastructure/workflow.store";
import {
  dueDateAxis,
  normalizeReminderHours,
  reminderDue,
} from "../domain/sla-fold";
import { publishWorkflowEvent } from "./workflow-events";
import type { WorkflowAuditRecorder } from "./workflow-engine";

/**
 * PHASE-052 (W-45 — T-04, dated 2026-11-27) THE ESCALATION SERVICE (D-08
 * — the SLA-breach engine behind the `workflow-escalation-sweep`, the
 * SEVENTH standing isolate). The 0111/calibration/trade pattern's 052
 * extension, the trade-expiry-sweep precedent verbatim:
 *
 *   THE CLOCK LAW (the owner's standing order: «ساعة مثبتة أو خطوة مشتقة
 *   — لا Date.now()+دلتا أبدًا»): the DATABASE'S OWN now() decides the
 *   breach INSIDE the scan's SQL (`si.due_at < now()`) and rides every
 *   row as its own `dbNow` — the sweep's reminder thresholds derive from
 *   THAT value + the row's due_at (the fixed inputs), never from a JS
 *   wall clock; the pure folds (W-43's sla-fold) carry instants only.
 *
 *   THE STRUCTURAL DEDUPE (the 0111/0123 axes law — the 0129 floor's
 *   uq_escalation_events_dedupe on (tenant_id, step_instance_id, kind,
 *   due_date)): the insert rides ON CONFLICT DO NOTHING — the index IS
 *   the idempotence, never a read-check race. Re-runs, the nightly
 *   cron, and a raced concurrent pass all CONVERGE within a cycle: one
 *   event per step + kind + due-date, EVER (the day axis the DUE DATE,
 *   never the current day).
 *
 *   THE ACTION VOCABULARY (the declared interpretation, recorded here —
 *   the honest boundary): the 0129 CHECK floor carries all four kinds
 *   (REASSIGN / ADD_LEVEL / NOTIFY / REMINDER) but the W-45 sweep emits
 *   NOTIFY + REMINDER only — a REASSIGN/ADD_LEVEL action needs an
 *   escalation-target/level configuration the 0127 step shape does not
 *   carry (`sla_hours` is the step's whole escalation substrate; the
 *   engine never invents an assignee — BR-055's family law), so the
 *   sweep refuses to fabricate a reassignment target. Widenings are
 *   dated additive (the web plane's editor surface, W-48+).
 *
 *   THE AUDIENCES (the declared interpretation): the NOTIFY escalation
 *   (the breach itself) reaches the TENANT OWNER — the escalation
 *   audience, the accountable plane (the trade sweep's ownerTarget
 *   precedent); the REMINDER family (the recurring cadence) reaches the
 *   BREACHED STEP'S ASSIGNEE — the aging nudge to act (the absence
 *   answer is the delegation plane, D-07; the reminder still lands).
 *
 *   THE RECURRING REMINDERS (the declared interpretation — the cadence's
 *   own shape): ONE escalation_events REMINDER row per breached step
 *   (the structural floor — the due-date axis is fixed per step), which
 *   lands when the EARLIEST cadence member crosses; the RECURRING
 *   surface is the INBOX family — one reminder record per CROSSED
 *   cadence member, each its own dedupe key
 *   (`workflow:sla:{stepInstanceId}:REMINDER:{hours}:{dueDate}`), so a
 *   cadence [1, 72] fires the assignee two reminders on their own
 *   crossings across the sweep's nightly runs and every pass converges.
 *
 *   THE SETTINGS SURFACE (acceptance #5's own dependency): the cadence
 *   reads stored ∪ registry default through the platform's
 *   effective-setting reader (`workflow.escalation_reminder_hours` —
 *   the typed key, registered at the SETTINGS_REGISTRY in the SAME
 *   increment), then the pure normalize fold (fail-closed to the
 *   documented [24] — a tenant who registers garbage never silently
 *   disables the reminders; the coercion class refused entirely).
 *
 *   THE SEAL (الأختام بعد النجاح في المعاملة نفسها): the run's audit
 *   record — `workflow.escalation_sweep_run` carrying the outcome —
 *   lands ONLY after the whole per-tenant pass succeeded, in the SAME
 *   ambient transaction (the audit plane IS the job log; stamped even
 *   when nothing breached: the run happened).
 *
 *   THE ENTITLEMENT GATE (D-08): the `workflow.escalation` flag (0130
 *   §5 — business + enterprise compose it; the starter tenant's
 *   declared neutral zero means NO escalation plane, the sweep silent
 *   for it by construction).
 */

const SETTING_KEY = "workflow.escalation_reminder_hours";
/** The per-pass scan bound (bounded jobs — the cmms precedent's 500). */
const SCAN_BOUND = 500;

export interface EscalationSweepOutcome {
  /** The effective cadence (fail-closed to the documented [24]). */
  readonly cadence: readonly number[];
  /** The breached awaiting steps the scan found. */
  readonly breached: number;
  /** The escalation_events rows that landed (NOTIFY + REMINDER, both
   * deduped — a converged pass inserts nothing). */
  readonly escalated: number;
  /** The inbox records that landed (the owner's breach notification +
   * the assignee reminders — the inbox's own structural dedupe). */
  readonly notified: number;
}

export class EscalationService {
  constructor(
    private readonly audit: WorkflowAuditRecorder,
    private readonly inbox: InboxService,
  ) {}

  /**
   * ONE per-tenant pass (the ambient tenant's own transaction — the job
   * wraps this in withTenant; the spec drives it the same way): (1) the
   * entitlement probe; (2) the cadence read (stored ∪ registry default,
   * the pure normalize fold — fail-closed); (3) the breach scan (the
   * DB's own clock inside the SQL); (4) per breached step — the NOTIFY
   * row + the owner's inbox record, then the REMINDER plane (the row at
   * the first cadence crossing + one inbox reminder per crossed member);
   * (5) THE SEAL.
   */
  async runEscalationSweep(input?: { scanBound?: number }): Promise<EscalationSweepOutcome> {
    if (!(await tenantHasEscalationPlane())) {
      // The entitlement gate: no escalation flag, no plane — the pass
      // still returns (the job's catch-and-continue never needed here;
      // the seal does NOT land for an unentitled tenant — there was no
      // run to seal, the trade-sweep gate precedent's own shape).
      return { cadence: [], breached: 0, escalated: 0, notified: 0 };
    }
    const bound = Math.min(Math.max(input?.scanBound ?? SCAN_BOUND, 1), 5_000);
    const stored = await readEffectiveSetting<readonly unknown[]>(SETTING_KEY);
    const cadence = normalizeReminderHours(Array.isArray(stored) ? stored : []);

    // The owner target + prefs gate, ONCE per pass (the trade-sweep
    // precedent's shape: absent prefs rows mean in-app on; an owner with
    // in-app off skips the breach record but the escalation rows and the
    // assignee reminders still land and the run still seals).
    const target = await this.inbox.ownerTarget();
    const ownerPrefs =
      target === null ? null : await this.inbox.prefsFor(target.userId, "workflow");

    let breached = 0;
    let escalated = 0;
    let notified = 0;
    for (const step of await store.scanBreachedSteps(bound)) {
      breached += 1;
      const dueDate = dueDateAxis(step.dueAt);
      const label = docLabel(step.triggerEntity);
      const stepName = snapshotStepName(step.definitionSnapshot, step.stepOrder);

      // (4a) THE NOTIFY ROW — the breach itself, one per step EVER (the
      // structural floor); the bus rides the landing (workflow.step.
      // escalated — D-10's own topic, the 055 handoff surface).
      const notifyRow = await store.insertEscalationEvent({
        stepInstanceId: step.stepInstanceId,
        kind: "NOTIFY",
        dueDate,
        payload: {
          triggerEntity: step.triggerEntity,
          triggerEntityId: step.triggerEntityId,
          instanceId: step.instanceId,
          stepOrder: step.stepOrder,
          assigneeUserId: step.assigneeUserId,
          dueAt: step.dueAt,
          audience: "tenant.owner",
        },
      });
      if (notifyRow !== undefined) {
        escalated += 1;
        const tenantId = requireTenantContext().tenantId;
        publishWorkflowEvent({
          type: "workflow.step.escalated",
          tenantId,
          instanceId: step.instanceId,
          stepInstanceId: step.stepInstanceId,
          stepOrder: step.stepOrder,
          kind: "NOTIFY",
        });
      }
      if (target !== null && ownerPrefs !== null && ownerPrefs.inApp) {
        const recorded = await this.inbox.record({
          category: "workflow",
          severity: "warning",
          title: {
            en: `Approval step past its SLA — ${label.en} step ${step.stepOrder}`,
            ar: `خطوة موافقة تجاوزت مدتها — ${label.ar} الخطوة ${step.stepOrder}`,
          },
          body: {
            en: `${label.en} step ${step.stepOrder} (${stepName.en}) is past its SLA (due ${step.dueAt}) and still awaiting ${step.assigneeUserId}. The chain will not advance until the step is acted on.`,
            ar: `${label.ar} الخطوة ${step.stepOrder} (${stepName.ar}) تجاوزت مدتها المحددة (الاستحقاق ${step.dueAt}) وما زالت بانتظار ${step.assigneeUserId}. لن تتقدم السلسلة قبل التصرف في الخطوة.`,
          },
          actionLabel: { ar: "مراجعة المستند", en: "Review document" },
          actionUrl: docDetailPath(step.triggerEntity, step.triggerEntityId),
          dedupeKey: `workflow:sla:${step.stepInstanceId}:NOTIFY:${dueDate}`,
          userId: target.userId,
        });
        if (recorded.inserted) notified += 1;
      }

      // (4b) THE REMINDER PLANE — the recurring cadence: the row lands
      // at the FIRST crossing (one per step EVER — the structural
      // floor), then one inbox reminder per CROSSED cadence member (the
      // recurring surface, each its own dedupe key — the members cross
      // on their own nights and every pass converges).
      const assigneePrefs = await this.inbox.prefsFor(step.assigneeUserId, "workflow");
      if (reminderDue(step.dueAt, step.dbNow, cadence)) {
        const crossed = cadence.filter(
          (hours) =>
            new Date(step.dbNow).getTime() >=
            new Date(step.dueAt).getTime() + hours * 3_600_000,
        );
        const reminderRow = await store.insertEscalationEvent({
          stepInstanceId: step.stepInstanceId,
          kind: "REMINDER",
          dueDate,
          payload: {
            cadence,
            crossed,
            triggerEntity: step.triggerEntity,
            instanceId: step.instanceId,
            stepOrder: step.stepOrder,
            assigneeUserId: step.assigneeUserId,
            dueAt: step.dueAt,
          },
        });
        if (reminderRow !== undefined) escalated += 1;
        if (assigneePrefs.inApp) {
          for (const hours of crossed) {
            const recorded = await this.inbox.record({
              category: "workflow",
              severity: "warning",
              title: {
                en: `Reminder — ${label.en} step ${step.stepOrder} awaits you (${hours}h past SLA)`,
                ar: `تذكير — ${label.ar} الخطوة ${step.stepOrder} بانتظارك (${hours} ساعة بعد المدة)`,
              },
              body: {
                en: `${label.en} step ${step.stepOrder} (${stepName.en}) is still awaiting your action — ${hours} hour(s) past its SLA (due ${step.dueAt}).`,
                ar: `${label.ar} الخطوة ${step.stepOrder} (${stepName.ar}) ما زالت بانتظار تصرفك — ${hours} ساعة بعد المدة المحددة (الاستحقاق ${step.dueAt}).`,
              },
              actionLabel: { ar: "مراجعة المستند", en: "Review document" },
              actionUrl: docDetailPath(step.triggerEntity, step.triggerEntityId),
              dedupeKey: `workflow:sla:${step.stepInstanceId}:REMINDER:${hours}:${dueDate}`,
              userId: step.assigneeUserId,
            });
            if (recorded.inserted) notified += 1;
          }
        }
      }
    }

    // (5) THE SEAL — after the whole pass succeeded, in the SAME ambient
    // transaction (a failure rolls everything back together).
    await this.audit.record({
      action: "workflow.escalation_sweep_run",
      entityType: "workflow_escalation_sweep",
      entityId: requireTenantContext().tenantId,
      after: { cadence, breached, escalated, notified },
    });
    return { cadence, breached, escalated, notified };
  }
}

/** The escalation plane's own entitlement probe — the `workflow.
 * escalation` composable unit (0130 §5; the engine flag alone is NOT
 * enough: the escalation plane is its own declared unit, business +
 * enterprise compose both; the starter tenant's declared neutral zero
 * keeps the sweep silent). */
async function tenantHasEscalationPlane(): Promise<boolean> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the escalation service requires an ambient tenant scope");
  }
  const rows = await context.tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'workflow.escalation'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

/** The doc-type label pair (the engine's own DOC_LABELS — the local
 * copy keeps this service self-contained over the closed registry). */
function docLabel(triggerEntity: string): { en: string; ar: string } {
  switch (triggerEntity) {
    case "manual_journal":
      return { en: "Journal entry", ar: "قيد يومية" };
    case "purchase_order":
      return { en: "Purchase order", ar: "أمر شراء" };
    case "change_order":
      return { en: "Change order", ar: "أمر تغيير" };
    case "duty_drawback_claim":
      return { en: "Duty drawback claim", ar: "طلب استرداد رسوم" };
    default:
      return { en: triggerEntity, ar: triggerEntity };
  }
}

/** The step's bilingual name from the immutable snapshot (the frozen
 * source — the definition edited after trigger never rewrites the
 * live instance's rendering facts). */
function snapshotStepName(
  snapshot: unknown,
  stepOrder: number,
): { en: string; ar: string } {
  const steps = (snapshot as { steps?: readonly { stepOrder: number; name: string; nameAr: string }[] })
    ?.steps;
  const meta = steps?.find((step) => step.stepOrder === stepOrder);
  return meta === undefined
    ? { en: `Step ${stepOrder}`, ar: `الخطوة ${stepOrder}` }
    : { en: meta.name, ar: meta.nameAr };
}

/** The doc detail path (the engine's own routing law — the local copy). */
function docDetailPath(triggerEntity: string, documentId: string): string {
  switch (triggerEntity) {
    case "manual_journal":
      return `/accounting/journals?doc=${documentId}`;
    case "purchase_order":
      return `/purchasing/orders?doc=${documentId}`;
    case "change_order":
      return `/projects/contracting?doc=${documentId}`;
    case "duty_drawback_claim":
      return `/trade/drawbacks?doc=${documentId}`;
    default:
      return `/`;
  }
}
