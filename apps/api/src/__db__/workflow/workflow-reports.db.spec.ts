import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import { registrySnapshot } from "../../modules/reporting/registry/runtime";
import { REPORT_CONTRACTS } from "../../modules/reporting/registry";
import { ALL_KNOWN_PERMISSIONS, fullContext, newRunService } from "../reporting/fixtures";
import { superuserClient } from "../test-db";
import {
  freshWorkflowDefinition,
  freshWorkflowInstance,
  freshWorkflowStep,
  freshWorkflowStepInstance,
  setupWorkflowFixture,
  TENANT_WORKFLOW,
  TENANT_WORKFLOW_RLS,
  WF_USER_ASSIGNEE,
  WF_USER_DELEGATE,
} from "./fixtures";

/**
 * PHASE-052 (W-49 — T-14, dated 2026-11-28) · `workflow-reports.db.spec`
 * — the two workflow report contracts over the real registers (the
 * trade-reports pattern): every arm runs the contract through the REAL
 * RunService on the workflow tenant's own worlds and pins THE
 * ENGINE-VERBATIM LAW (zero parallel computation — every rendered
 * figure re-checked against the engine's own reads), THE CLOCK LAW
 * (the age + the hours-over-due computed by the DB's own clock inside
 * the query), THE LADDER LAW (only the pointer's CURRENT steps list),
 * THE REPORT-NEVER-ALERTS LAW (the escalation events are the sweep's
 * own stamps — the report run never writes one), the deny paths (one
 * per contract), the tenant-isolation floor, and the registry's own
 * two rows.
 *
 * The worlds (the per-arm-world law «أذرع الرفض كلٌّ على عالمه»): RP-PA
 * (the pointer's PENDING APPROVAL step with a PAST due date — the
 * overdue verdict — + the FUTURE sibling that never lists + the TASK
 * sibling that never lists in the approvals register) · RP-SLA (the
 * breached step with the sweep's own escalation event + the
 * not-yet-due sibling).
 */

async function runReport(reportKey: string, params: Record<string, unknown>) {
  const outcome = await withTenant(TENANT_WORKFLOW, () =>
    newRunService().run({
      reportKey,
      params,
      ctx: fullContext(TENANT_WORKFLOW),
    }),
  );
  expect(outcome.status).toBe("SUCCEEDED");
  return outcome.result!;
}

let su: Client;

/** The DB's own clock figures the arms re-check against (never a JS
 * wall clock anywhere in the spec's assertions). */
async function dbAgeHours(instanceId: string): Promise<number> {
  const rows = await su.query<{ ageHours: number }>(
    `SELECT (EXTRACT(EPOCH FROM (now() - wi.created_at)) / 3600)::int AS "ageHours"
     FROM workflow_instances wi WHERE wi.id = $1`,
    [instanceId],
  );
  return rows.rows[0]!.ageHours;
}

async function dbHoursOverDue(stepInstanceId: string): Promise<number> {
  const rows = await su.query<{ hours: number }>(
    `SELECT GREATEST(0, (EXTRACT(EPOCH FROM (now() - si.due_at)) / 3600))::int AS hours
     FROM workflow_step_instances si WHERE si.id = $1`,
    [stepInstanceId],
  );
  return rows.rows[0]!.hours;
}

beforeAll(async () => {
  await setupWorkflowFixture();
  su = await superuserClient();
});

describe("PHASE-052 W-49 — the workflow report contracts over the real registers", () => {
  it("(a) THE PENDING-APPROVALS REGISTER — the engine-verbatim law + the clock law + the vocabulary", async () => {
    // RP-PA: the pointer's PENDING APPROVAL step with a PAST due date,
    // the snapshot's own bilingual names, the assignee's display name.
    const definitionId = await freshWorkflowDefinition("RP-PA");
    await freshWorkflowStep("RP-PA", definitionId, { stepOrder: 1 });
    await freshWorkflowStep("RP-PA2", definitionId, { stepOrder: 2 });
    const documentId = crypto.randomUUID();
    const instanceId = await freshWorkflowInstance("RP-PA", definitionId, {
      triggerEntity: "purchase_order",
      triggerEntityId: documentId,
      currentStepOrder: 1,
      snapshot: {
        definition: { id: definitionId, name: "RP chain", nameAr: "سلسلة RP" },
        steps: [
          { stepOrder: 1, stepType: "APPROVAL", name: "Manager approval", nameAr: "موافقة المدير" },
          { stepOrder: 2, stepType: "TASK", name: "Attach evidence", nameAr: "إرفاق الأدلة" },
        ],
      },
    });
    const currentStepId = await freshWorkflowStepInstance(instanceId, {
      stepOrder: 1,
      stepType: "APPROVAL",
      assigneeUserId: WF_USER_ASSIGNEE,
      status: "PENDING",
      dueAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString(), // breached 26h ago
    });
    // THE LADDER LAW: the future TASK sibling never lists (the pointer
    // is at 1; the TASK type is not the approvals register's own).
    await freshWorkflowStepInstance(instanceId, {
      stepOrder: 2,
      stepType: "TASK",
      assigneeUserId: WF_USER_DELEGATE,
      status: "PENDING",
    });

    const today = new Date().toISOString().slice(0, 10);
    const result = await runReport("workflow.pending-approvals", {
      dateFrom: today,
      dateTo: today,
      locale: "en",
    });
    const row = result.rows.find((r) => r.key === currentStepId);
    expect(row).toBeDefined();
    // The snapshot's own bilingual names (the frozen source — PP-17's law).
    expect(row!.values.stepName).toBe("Manager approval");
    // The assignee's display name (the users join's own resolution).
    expect(row!.values.assigneeName).toBe("Workflow Assignee");
    // THE CLOCK LAW: the age is the DB's own figure.
    expect(Number(row!.values.ageHours)).toBe(await dbAgeHours(instanceId));
    // The overdue verdict (the DB's own clock inside the query).
    expect(row!.values.overdue).toBe("OVERDUE");
    // The unresolvable document's honest neutral figures (a bare uuid
    // document — no purchase_orders row — renders the neutral brief).
    expect(row!.values.documentNo).toBe(documentId.slice(0, 8));
    expect(row!.values.amountBase).toBe("0.0000");
    // THE LADDER LAW: the future TASK sibling never lists.
    expect(result.rows.length).toBe(1);
    // The vocabulary assertion PASSES (the 0127 closed registry).
    const vocab = result.assertions.find((a) => a.id === "pending-approvals-trigger-vocabulary");
    expect(vocab!.status).toBe("PASS");
  });

  it("(b) THE OVERDUE-ONLY FILTER — the parameter narrows the register", async () => {
    // A fresh world: a not-yet-due PENDING APPROVAL step (the pointer's
    // own) — the overdueOnly filter excludes it; the plain run lists it.
    const definitionId = await freshWorkflowDefinition("RP-OF");
    const instanceId = await freshWorkflowInstance("RP-OF", definitionId, {
      currentStepOrder: 1,
      snapshot: {
        definition: { id: definitionId, name: "OF chain", nameAr: "سلسلة OF" },
        steps: [{ stepOrder: 1, stepType: "APPROVAL", name: "Review", nameAr: "مراجعة" }],
      },
    });
    const stepId = await freshWorkflowStepInstance(instanceId, {
      stepOrder: 1,
      stepType: "APPROVAL",
      assigneeUserId: WF_USER_ASSIGNEE,
      status: "PENDING",
      dueAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), // due in 48h — NOT overdue
    });
    const today = new Date().toISOString().slice(0, 10);
    const plain = await runReport("workflow.pending-approvals", {
      dateFrom: today,
      dateTo: today,
      locale: "en",
    });
    expect(plain.rows.some((r) => r.key === stepId)).toBe(true);
    const filtered = await runReport("workflow.pending-approvals", {
      dateFrom: today,
      dateTo: today,
      overdueOnly: true,
      locale: "en",
    });
    expect(filtered.rows.some((r) => r.key === stepId)).toBe(false);
  });

  it("(c) THE SLA-AGING REGISTER — the hours-over-due at the DB's own clock + the sweep's own event counts + the buckets", async () => {
    // RP-SLA: the breached step (due 30h ago) with the sweep's own
    // escalation event + the not-yet-due sibling (both carry SLAs).
    const definitionId = await freshWorkflowDefinition("RP-SLA");
    const instanceId = await freshWorkflowInstance("RP-SLA", definitionId, {
      currentStepOrder: 1,
      snapshot: {
        definition: { id: definitionId, name: "SLA chain", nameAr: "سلسلة المهل" },
        steps: [
          { stepOrder: 1, stepType: "APPROVAL", name: "Finance approval", nameAr: "موافقة المالية" },
        ],
      },
    });
    const breachedStepId = await freshWorkflowStepInstance(instanceId, {
      stepOrder: 1,
      stepType: "APPROVAL",
      assigneeUserId: WF_USER_ASSIGNEE,
      status: "PENDING",
      dueAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString(), // breached 30h ago
    });
    // The sweep's own escalation event (the structural-dedupe stamp —
    // written ONCE by the sweep, read here; the report NEVER writes).
    await su.query(
      `INSERT INTO escalation_events
         (id, tenant_id, step_instance_id, kind, due_date, payload)
       VALUES (gen_random_uuid(), $1, $2, 'NOTIFY', $3::date, '{"arm": "RP-SLA"}'::jsonb)`,
      [TENANT_WORKFLOW, breachedStepId, new Date().toISOString().slice(0, 10)],
    );
    // The not-yet-due sibling (its own instance — the per-arm world law).
    const siblingInstance = await freshWorkflowInstance("RP-SLA2", definitionId, {
      currentStepOrder: 1,
      snapshot: {
        definition: { id: definitionId, name: "SLA chain", nameAr: "سلسلة المهل" },
        steps: [{ stepOrder: 1, stepType: "TASK", name: "Prepare file", nameAr: "تجهيز الملف" }],
      },
    });
    await freshWorkflowStepInstance(siblingInstance, {
      stepOrder: 1,
      stepType: "TASK",
      assigneeUserId: WF_USER_DELEGATE,
      status: "PENDING",
      dueAt: new Date(Date.now() + 10 * 3600 * 1000).toISOString(), // due in 10h — awaiting
    });

    const today = new Date().toISOString().slice(0, 10);
    const result = await runReport("workflow.sla-aging", {
      dateFrom: today,
      dateTo: today,
      locale: "en",
    });
    const breached = result.rows.find((r) => r.key === breachedStepId);
    expect(breached).toBeDefined();
    expect(breached!.values.stepName).toBe("Finance approval");
    // THE CLOCK LAW: the hours-over-due is the DB's own figure.
    expect(Number(breached!.values.hoursOverDue)).toBe(await dbHoursOverDue(breachedStepId));
    expect(breached!.values.breached).toBe("BREACHED");
    // The sweep's own event count (the report reads, never writes).
    expect(breached!.values.escalationEvents).toBe("1");
    // The not-yet-due sibling renders AWAITING with zero events.
    const awaiting = result.rows.find((r) => r.values.breached === "AWAITING");
    expect(awaiting).toBeDefined();
    // THE REPORT-NEVER-ALERTS LAW: the run wrote NO escalation event.
    const events = await su.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM escalation_events
       WHERE tenant_id = $1 AND step_instance_id = $2`,
      [TENANT_WORKFLOW, breachedStepId],
    );
    expect(events.rows[0]!.count).toBe("1");
    // The buckets in the footer (arm (a)'s 26h breach + this arm's 30h
    // breach both sit in the 24–48h band — the worlds share the tenant).
    const totals = result.totals.find((t) => t.id === "rows");
    expect(totals!.label.en).toContain("24–48h: 2");
    // The step-type vocabulary assertion PASSES (the W-10 scope note).
    const vocab = result.assertions.find((a) => a.id === "sla-aging-step-type-vocabulary");
    expect(vocab!.status).toBe("PASS");
  });

  it("(d) THE DENY PATHS — one per contract (the §12 keys the routes ride)", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const withoutInbox = new Set(ALL_KNOWN_PERMISSIONS);
    withoutInbox.delete("workflow.inbox.act");
    await expect(
      withTenant(TENANT_WORKFLOW, () =>
        newRunService().run({
          reportKey: "workflow.pending-approvals",
          params: { dateFrom: today, dateTo: today, locale: "en" },
          ctx: fullContext(TENANT_WORKFLOW, { permissions: withoutInbox }),
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
    const withoutEscalation = new Set(ALL_KNOWN_PERMISSIONS);
    withoutEscalation.delete("workflow.escalation.manage");
    await expect(
      withTenant(TENANT_WORKFLOW, () =>
        newRunService().run({
          reportKey: "workflow.sla-aging",
          params: { dateFrom: today, dateTo: today, locale: "en" },
          ctx: fullContext(TENANT_WORKFLOW, { permissions: withoutEscalation }),
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
  });

  it("(e) THE TENANT-ISOLATION FLOOR — the boundary tenant's registers are empty by construction", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const approvals = await withTenant(TENANT_WORKFLOW_RLS, () =>
      newRunService().run({
        reportKey: "workflow.pending-approvals",
        params: { dateFrom: today, dateTo: today, locale: "en" },
        ctx: fullContext(TENANT_WORKFLOW_RLS),
      }),
    );
    expect(approvals.status).toBe("SUCCEEDED");
    expect(approvals.result!.rows).toHaveLength(0);
    const aging = await withTenant(TENANT_WORKFLOW_RLS, () =>
      newRunService().run({
        reportKey: "workflow.sla-aging",
        params: { dateFrom: today, dateTo: today, locale: "en" },
        ctx: fullContext(TENANT_WORKFLOW_RLS),
      }),
    );
    expect(aging.status).toBe("SUCCEEDED");
    expect(aging.result!.rows).toHaveLength(0);
  });

  it("(f) THE REGISTRY'S OWN TWO ROWS — the ids + the §12 permission keys", () => {
    const snapshot = registrySnapshot(REPORT_CONTRACTS);
    const pending = snapshot.find((row) => row.id === "workflow.pending-approvals");
    expect(pending).toBeDefined();
    expect(pending!.requiredPermission).toBe("workflow.inbox.act");
    expect(pending!.version).toBe(1);
    const aging = snapshot.find((row) => row.id === "workflow.sla-aging");
    expect(aging).toBeDefined();
    expect(aging!.requiredPermission).toBe("workflow.escalation.manage");
    expect(aging!.version).toBe(1);
  });
});
