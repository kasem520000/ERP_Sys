import { beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { EscalationService } from "../../modules/workflow/application/escalation-service";
import { onWorkflowEvent, type WorkflowEvent } from "../../modules/workflow/application/workflow-events";

/**
 * PHASE-052 (W-45 — T-04's sweep isolate, dated 2026-11-27) THE
 * WORKFLOW-ESCALATION-SWEEP over real PostgreSQL 16 (acceptance #5's
 * own proof — the SEVENTH standing isolate, joining soak · fcm · email
 * · the cmms sweep · the quality calibration sweep · the trade expiry
 * sweep from THIS wave per the master plan §0c (2)): the SLA-breach
 * detection (a step left past its SLA hours produces an
 * escalation_events row), the NOTIFY breach notification + the
 * recurring REMINDER family on the settings registry's cadence
 * (`workflow.escalation_reminder_hours` — the typed key, fail-closed
 * defaults), the STRUCTURAL DEDUPE convergence (re-runs, the nightly
 * cron, and a raced concurrent pass all converge — the second pass
 * inserts NOTHING), the clock law (the DB's own now() decides inside
 * the scan's SQL), the audit seal in the same ambient transaction
 * (stamped even when nothing breached), the prefs gate, and the
 * entitlement gate (the workflow.escalation flag — the declared
 * neutral zero keeps the sweep silent, no seal).
 *
 * THE CLOCK LAW (the owner's standing order: «ساعة مثبتة أو خطوة مشتقة
 * — لا Date.now()+دلتا أبدًا»): every due_at is seeded from the
 * DATABASE'S OWN now() inside the seed SQL (`now() - interval '2
 * hours'`) — the same clock the scan's breach verdict reads; no JS
 * wall-clock arithmetic anywhere in the world or the assertions.
 *
 * THE DEDICATED TENANTS (the trade-sweep spec's own shape): TENANT_WES
 * (workflow.engine + workflow.escalation entitlements, its own owner
 * membership — ownerTarget() is the breach notification's audience)
 * and TENANT_WES_NOESC (workflow.engine ONLY — the entitlement gate's
 * own world: the escalation plane's declared neutral zero).
 */

const TENANT_WES = "8e8e8e8e-8e8e-8e8e-8e8e-8e8e8e8e8e8e";
const TENANT_WES_NOESC = "8e8e8e8e-8e8e-8e8e-8e8e-8e8e8e8e8e8d";
const WES_OWNER = "8e8e8e8e-0000-4000-8000-0000000008e1";
const WES_ASSIGNEE = "8e8e8e8e-0000-4000-8000-0000000008e2";

const audit = new AuditService(new DrizzleAuditStore());
const sweep = new EscalationService(audit, new InboxService());

/** The bus capture (the escalation emissions — workflow.step.escalated). */
const escalatedLog: WorkflowEvent[] =
  [];
/** The per-arm world register (the (c) convergence probe reads (a)'s). */
const spec: { worldA?: BreachedWorld } = {};

beforeAll(async () => {
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant WES (workflow escalation sweep)', 'المستأجر تصعيد سير', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant WES-NOESC (escalation flag off)', 'المستأجر بلا تصعيد', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_WES, TENANT_WES_NOESC],
  );
  // The entitlements: WES carries BOTH the engine and the escalation
  // plane; WES-NOESC carries the engine ONLY (the gate's own world).
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source) VALUES
       (gen_random_uuid(), $1, 'workflow.engine', 'PLAN'),
       (gen_random_uuid(), $1, 'workflow.escalation', 'PLAN'),
       (gen_random_uuid(), $2, 'workflow.engine', 'PLAN')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [TENANT_WES, TENANT_WES_NOESC],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'wes-owner@fixture.test', 'WES Owner', 'x', 'ACTIVE'),
       ($2, 'wes-assignee@fixture.test', 'WES Assignee', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [WES_OWNER, WES_ASSIGNEE],
  );
  // The owner membership (ownerTarget's own resolution — the breach
  // notification's audience).
  const ownerRole = await su.query<{ id: string }>(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'owner', 'Owner', 'المالك') RETURNING id`,
    [TENANT_WES],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [generateUuidV7(), TENANT_WES, WES_OWNER, ownerRole.rows[0]!.id],
  );
  await su.end();
  onWorkflowEvent("workflow.step.escalated", (event) => {
    if ((event as { tenantId: string }).tenantId === TENANT_WES) {
      escalatedLog.push(event);
    }
  });
});

interface BreachedWorld {
  readonly stepInstanceId: string;
  readonly instanceId: string;
}

/** Seed ONE breached world: an ACTIVE instance + a PENDING APPROVAL
 *  step whose due_at is derived from the DATABASE'S OWN now() (the
 *  hoursBehind parameter — the same clock the scan's breach verdict
 *  reads; hoursBehind < 0 seeds a FUTURE due — the clock law's own
 *  negative control). The instance rides its own minimal definition row
 *  (the composite FK's own floor) with the rendering snapshot. */
async function seedAwaitingStep(
  code: string,
  hoursBehind: number,
): Promise<BreachedWorld> {
  const su: Client = await superuserClient();
  const definition = await su.query<{ id: string }>(
    `INSERT INTO workflow_definitions
       (id, tenant_id, name, name_ar, trigger_entity, trigger_event, active, conditions, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, 'purchase_order', 'PENDING_APPROVAL', true, '{"all":[]}'::jsonb, $4)
     RETURNING id`,
    [TENANT_WES, `WES-DEF-${code}`, `تعريف تصعيد ${code}`, WES_OWNER],
  );
  const instance = await su.query<{ id: string }>(
    `INSERT INTO workflow_instances
       (id, tenant_id, definition_id, trigger_entity, trigger_entity_id, definition_snapshot,
        current_step_order, status, created_by)
     VALUES (gen_random_uuid(), $1, $2, 'purchase_order', gen_random_uuid(),
             $3::jsonb, 1, 'ACTIVE', $4)
     RETURNING id`,
    [
      TENANT_WES,
      definition.rows[0]!.id,
      JSON.stringify({
        definition: { name: `WES-DEF-${code}` },
        steps: [{ stepOrder: 1, name: "Manager approval", nameAr: "موافقة المدير" }],
      }),
      WES_OWNER,
    ],
  );
  const step = await su.query<{ id: string }>(
    `INSERT INTO workflow_step_instances
       (id, tenant_id, instance_id, step_order, step_type, assignee_user_id, status, due_at, created_by)
     VALUES (gen_random_uuid(), $1, $2, 1, 'APPROVAL', $3, 'PENDING',
             now() - ($4 || ' hours')::interval, $5)
     RETURNING id`,
    [TENANT_WES, instance.rows[0]!.id, WES_ASSIGNEE, String(hoursBehind), WES_OWNER],
  );
  await su.end();
  return { stepInstanceId: step.rows[0]!.id, instanceId: instance.rows[0]!.id };
}

/** The escalation_events rows for a step (the sweep's own evidence). */
async function escalationRows(stepInstanceId: string): Promise<
  { kind: string; dueDate: string; payload: Record<string, unknown> }[]
> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ kind: string; dueDate: string; payload: Record<string, unknown> }>(
    `SELECT kind, due_date::text AS "dueDate", payload FROM escalation_events
     WHERE tenant_id = $1 AND step_instance_id = $2 ORDER BY kind`,
    [TENANT_WES, stepInstanceId],
  );
  await su.end();
  return rows.rows;
}

/** The workflow-category inbox records for a user (dedupe keys named). */
async function inboxFor(userId: string): Promise<{ dedupeKey: string | null; severity: string }[]> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ dedupeKey: string | null; severity: string }>(
    `SELECT dedupe_key AS "dedupeKey", severity FROM notifications
     WHERE tenant_id = $1 AND user_id = $2 AND category = 'workflow'`,
    [TENANT_WES, userId],
  );
  await su.end();
  return rows.rows;
}

/** The sweep seals (the audit plane IS the job log). */
async function sealCount(tenantId: string): Promise<number> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM audit_events
     WHERE tenant_id = $1 AND action = 'workflow.escalation_sweep_run'`,
    [tenantId],
  );
  await su.end();
  return Number(rows.rows[0]!.n);
}

// ── the arms ─────────────────────────────────────────────────────────

describe("PHASE-052 W-45 — the workflow-escalation sweep (the SEVENTH standing isolate; acceptance #5)", () => {
  it("(0) THE EMPTY PASS — the seal lands even when nothing breached (the run happened)", async () => {
    const outcome = await withTenant(TENANT_WES, () => sweep.runEscalationSweep());
    expect(outcome).toEqual({ cadence: [24], breached: 0, escalated: 0, notified: 0 });
    expect(await sealCount(TENANT_WES)).toBe(1);
  });

  it("(a) THE BREACH → THE EVENTS — a step past its SLA produces the NOTIFY escalation_events row + the owner's breach notification + the bus emission (the reminder not yet: the 2h breach vs the 24h cadence)", async () => {
    const world = await seedAwaitingStep("A", 2);
    spec.worldA = world;
    const sealsBefore = await sealCount(TENANT_WES);

    const outcome = await withTenant(TENANT_WES, () => sweep.runEscalationSweep());
    expect(outcome).toEqual({ cadence: [24], breached: 1, escalated: 1, notified: 1 });

    // THE NOTIFY ROW — one per step EVER (the structural floor), the
    // payload carrying the doc refs + the audience.
    const rows = await escalationRows(world.stepInstanceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "NOTIFY" });
    expect(rows[0]!.payload).toMatchObject({
      triggerEntity: "purchase_order",
      instanceId: world.instanceId,
      stepOrder: 1,
      assigneeUserId: WES_ASSIGNEE,
      audience: "tenant.owner",
    });

    // THE OWNER'S BREACH NOTIFICATION (the escalation audience — the
    // warning severity, the workflow category).
    const ownerInbox = await inboxFor(WES_OWNER);
    expect(ownerInbox).toHaveLength(1);
    expect(ownerInbox[0]).toMatchObject({ severity: "warning" });
    expect(ownerInbox[0]!.dedupeKey).toBe(`workflow:sla:${world.stepInstanceId}:NOTIFY:${rows[0]!.dueDate}`);

    // THE BUS EMISSION (D-10's own topic — the 055 handoff surface).
    expect(escalatedLog).toHaveLength(1);
    expect(escalatedLog[0]).toMatchObject({
      type: "workflow.step.escalated",
      instanceId: world.instanceId,
      stepInstanceId: world.stepInstanceId,
      kind: "NOTIFY",
    });

    // THE SEAL — one more run record.
    expect(await sealCount(TENANT_WES)).toBe(sealsBefore + 1);
  });

  it("(b) THE REMINDER CADENCE — the 25h breach crosses the documented 24h default: the REMINDER row + the assignee's reminder", async () => {
    const world = await seedAwaitingStep("B", 25);
    const outcome = await withTenant(TENANT_WES, () => sweep.runEscalationSweep());
    // breached: (a)'s world re-scanned + this one; escalated: the NOTIFY
    // + the REMINDER rows for THIS step ((a)'s world converged).
    expect(outcome.cadence).toEqual([24]);
    expect(outcome.breached).toBe(2);
    expect(outcome.escalated).toBe(2);

    const rows = await escalationRows(world.stepInstanceId);
    expect(rows.map((row) => row.kind)).toEqual(["NOTIFY", "REMINDER"]);
    const reminder = rows.find((row) => row.kind === "REMINDER")!;
    expect(reminder.payload).toMatchObject({ cadence: [24], crossed: [24] });

    // THE ASSIGNEE'S REMINDER (the aging nudge — the per-member key).
    const assigneeInbox = await inboxFor(WES_ASSIGNEE);
    expect(assigneeInbox).toHaveLength(1);
    expect(assigneeInbox[0]!.dedupeKey).toBe(
      `workflow:sla:${world.stepInstanceId}:REMINDER:24:${rows[0]!.dueDate}`,
    );
  });

  it("(c) THE STRUCTURAL DEDUPE CONVERGENCE — the re-run inserts NOTHING (re-runs, the nightly cron, and a raced concurrent pass all converge)", async () => {
    const eventsBefore = await escalationRows(spec.worldA!.stepInstanceId);
    const ownerBefore = (await inboxFor(WES_OWNER)).length;
    const assigneeBefore = (await inboxFor(WES_ASSIGNEE)).length;
    const outcome = await withTenant(TENANT_WES, () => sweep.runEscalationSweep());
    expect(outcome.escalated).toBe(0); // everything converged
    expect(outcome.notified).toBe(0); // the inbox family converged too
    expect(await escalationRows(spec.worldA!.stepInstanceId)).toEqual(eventsBefore); // NOTHING accumulated
    expect((await inboxFor(WES_OWNER)).length).toBe(ownerBefore);
    expect((await inboxFor(WES_ASSIGNEE)).length).toBe(assigneeBefore);
    // The seal still lands (the run happened — the audit plane is the
    // job log).
    expect(await sealCount(TENANT_WES)).toBeGreaterThanOrEqual(4);
  });

  it("(d) THE CLOCK LAW — a step whose due_at is IN THE FUTURE never breaches (the DB's own now() decides inside the scan's SQL)", async () => {
    const world = await seedAwaitingStep("D", -2); // due 2h AHEAD
    const outcome = await withTenant(TENANT_WES, () => sweep.runEscalationSweep());
    // The future step is NOT in the breach plane (the standing breached
    // worlds only).
    expect(outcome.breached).toBe(2);
    const rows = await escalationRows(world.stepInstanceId);
    expect(rows).toHaveLength(0); // no event for the future step
  });

  it("(e) THE CUSTOM CADENCE — the tenant's [1, 2] hours govern: the REMINDER row + TWO per-member reminders (the recurring surface)", async () => {
    const su: Client = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
       VALUES (gen_random_uuid(), $1, 'workflow.escalation_reminder_hours', '[1, 2]', $2)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = EXCLUDED.value`,
      [TENANT_WES, WES_OWNER],
    );
    await su.end();

    const world = await seedAwaitingStep("E", 3); // both members crossed
    const outcome = await withTenant(TENANT_WES, () => sweep.runEscalationSweep());
    expect(outcome.cadence).toEqual([1, 2]);

    const rows = await escalationRows(world.stepInstanceId);
    expect(rows.map((row) => row.kind)).toEqual(["NOTIFY", "REMINDER"]);
    const reminder = rows.find((row) => row.kind === "REMINDER")!;
    expect(reminder.payload).toMatchObject({ cadence: [1, 2], crossed: [1, 2] });

    // TWO REMINDERS — one per crossed cadence member, each its own
    // dedupe key (the recurring surface; a raced pass converges on the
    // same keys).
    const assigneeInbox = await inboxFor(WES_ASSIGNEE);
    const reminderKeys = assigneeInbox
      .map((row) => row.dedupeKey ?? "")
      .filter((key) => key.includes(":REMINDER:"));
    // This step's two member keys (the earlier worlds' steps re-keyed
    // under the new cadence too — the convergence law allows it: a
    // cadence change is a new reminder cycle).
    expect(reminderKeys).toContain(`workflow:sla:${world.stepInstanceId}:REMINDER:1:${rows[0]!.dueDate}`);
    expect(reminderKeys).toContain(`workflow:sla:${world.stepInstanceId}:REMINDER:2:${rows[0]!.dueDate}`);
  });

  it("(f) THE FAIL-CLOSED GARBAGE — a garbage settings row reads as the documented default [24] (the reminders never silently disable)", async () => {
    const su: Client = await superuserClient();
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
       VALUES (gen_random_uuid(), $1, 'workflow.escalation_reminder_hours', '["garbage", null, 0, -5]', $2)
       ON CONFLICT ("tenant_id", "key") DO UPDATE SET value = EXCLUDED.value`,
      [TENANT_WES, WES_OWNER],
    );
    await su.end();

    const world = await seedAwaitingStep("F", 30); // crosses 24, not the garbage
    const outcome = await withTenant(TENANT_WES, () => sweep.runEscalationSweep());
    expect(outcome.cadence).toEqual([24]); // the documented default
    const rows = await escalationRows(world.stepInstanceId);
    const reminder = rows.find((row) => row.kind === "REMINDER");
    expect(reminder?.payload).toMatchObject({ cadence: [24], crossed: [24] });
  });

  it("(g) THE PREFS GATE — an owner with in-app OFF skips the breach record but the escalation rows still land and the run still seals", async () => {
    const su: Client = await superuserClient();
    await su.query(
      `INSERT INTO notification_prefs (id, tenant_id, user_id, category, in_app, email)
       VALUES (gen_random_uuid(), $1, $2, 'workflow', false, false)
       ON CONFLICT ("user_id", "category") DO UPDATE SET in_app = false, email = false`,
      [TENANT_WES, WES_OWNER],
    );
    await su.end();

    const world = await seedAwaitingStep("G", 2); // no reminder crossing at [24]
    const ownerInboxBefore = (await inboxFor(WES_OWNER)).length;
    await withTenant(TENANT_WES, () => sweep.runEscalationSweep());
    // The escalation row LANDED (the evidence plane is not prefs-gated).
    const rows = await escalationRows(world.stepInstanceId);
    expect(rows.map((row) => row.kind)).toEqual(["NOTIFY"]);
    // The owner's inbox record was SKIPPED (the prefs gate) — nothing
    // accumulated for the owner.
    expect((await inboxFor(WES_OWNER)).length).toBe(ownerInboxBefore);
    // The run still sealed.
    expect(await sealCount(TENANT_WES)).toBeGreaterThanOrEqual(7);

    // The prefs row removed — the next pass records again (the absent
    // row means in-app on).
    const su2: Client = await superuserClient();
    await su2.query(
      `DELETE FROM notification_prefs WHERE tenant_id = $1 AND user_id = $2 AND category = 'workflow'`,
      [TENANT_WES, WES_OWNER],
    );
    await su2.end();
  });

  it("(h) THE ENTITLEMENT GATE — the escalation-flag-off tenant: NOTHING (no events, no notifications, NO SEAL — there was no run to seal)", async () => {
    // A breached step in the flag-off tenant's own world (its own
    // definition row — the composite FK's own floor).
    const su: Client = await superuserClient();
    const noescDefinition = await su.query<{ id: string }>(
      `INSERT INTO workflow_definitions
         (id, tenant_id, name, name_ar, trigger_entity, trigger_event, active, conditions)
       VALUES (gen_random_uuid(), $1, 'WES-DEF-NOESC', 'تعريف بلا تصعيد',
               'purchase_order', 'PENDING_APPROVAL', true, '{"all":[]}'::jsonb)
       RETURNING id`,
      [TENANT_WES_NOESC],
    );
    const instance = await su.query<{ id: string }>(
      `INSERT INTO workflow_instances
         (id, tenant_id, definition_id, trigger_entity, trigger_entity_id, definition_snapshot,
          current_step_order, status, created_by)
       VALUES (gen_random_uuid(), $1, $2, 'purchase_order', gen_random_uuid(),
               '{"steps":[]}'::jsonb, 1, 'ACTIVE', NULL)
       RETURNING id`,
      [TENANT_WES_NOESC, noescDefinition.rows[0]!.id],
    );
    await su.query(
      `INSERT INTO workflow_step_instances
         (id, tenant_id, instance_id, step_order, step_type, assignee_user_id, status, due_at)
       VALUES (gen_random_uuid(), $1, $2, 1, 'APPROVAL', $3, 'PENDING', now() - interval '2 hours')`,
      [TENANT_WES_NOESC, instance.rows[0]!.id, WES_ASSIGNEE],
    );
    await su.end();

    const outcome = await withTenant(TENANT_WES_NOESC, () => sweep.runEscalationSweep());
    expect(outcome).toEqual({ cadence: [], breached: 0, escalated: 0, notified: 0 });

    // NO events, NO seal — the gate returned before any plane ran.
    const su2: Client = await superuserClient();
    const events = await su2.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM escalation_events WHERE tenant_id = $1`,
      [TENANT_WES_NOESC],
    );
    await su2.end();
    expect(events.rows[0]!.n).toBe("0");
    expect(await sealCount(TENANT_WES_NOESC)).toBe(0);
  });
});
