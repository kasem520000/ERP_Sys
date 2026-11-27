import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { superuserClient } from "../test-db";
import {
  TENANT_WORKFLOW,
  WF_ACTOR,
  WF_USER_ASSIGNEE,
  WF_USER_DELEGATE,
  freshWorkflowDefinition,
  freshWorkflowInstance,
  freshWorkflowStepInstance,
  setupWorkflowFixture,
} from "./fixtures";

/**
 * PHASE-052 (W-43 — T-01 + T-02, the foundation wave) — the workflow
 * family's FIRST spec (the trade-schema precedent: the `__db__/workflow/`
 * directory opens with the migrations' own structural laws; the service
 * specs land with their W-44…W-47 waves). What this spec pins over real
 * PostgreSQL 16 (the plan §6's foundation arms — acceptance #1's own
 * substrate):
 *
 * - the definitions register: THE CLOSED TRIGGER REGISTRY (the four
 *   exemplar surfaces, the owner's ruling (ج)) + the vocabulary mapping
 *   law (PENDING_APPROVAL / SUBMITTED) + the name shapes + the
 *   (tenant, name) uniqueness + the entry conditions' shallow
 *   group-object floor;
 * - the ordered steps: the W-10 scope note's three-member type
 *   vocabulary + the four-member assignee-rule vocabulary + the 1-based
 *   ordering floor + the per-step SLA floor + the (tenant, definition,
 *   order) uniqueness + the definition composite FK (the tenant-pair
 *   law 23503);
 * - the instances: the same closed trigger registry + the status
 *   vocabulary + THE POINTER LAW (NOT NULL exactly on ACTIVE) +
 *   INV-037's TERMINAL STAMP FLOOR (the terminal state and its
 *   completed_at TOGETHER) + THE SNAPSHOT FLOOR (a json object) + ONE
 *   ACTIVE CHAIN PER DOCUMENT (the partial unique — the second ACTIVE
 *   chain on the same doc refused; the terminal history + a NEW ACTIVE
 *   chain legal) + the definition composite FK;
 * - the step instances: THE LADDER'S STAMP LAW (the 0128 declared
 *   interpretation's exact matrix — every illegal combination refused
 *   BY NAME: PENDING carries no act and no delegation · DELEGATED
 *   carries the re-route and no act · APPROVED/REJECTED carry the act
 *   pair · SKIPPED carries the skip stamp with NO actor) + the status
 *   and type vocabularies + the (tenant, instance, order) uniqueness +
 *   the instance composite FK;
 * - the delegation windows: THE NO-SELF FLOOR + THE SCOPE PAIR LAW
 *   (ALL ⇔ no value; MODULE/ENTITY ⇔ exactly one) + the scope
 *   vocabulary + THE WINDOW LAW (strictly positive);
 * - the escalation events: the action vocabulary + THE STRUCTURAL
 *   DEDUPE (one event per step + kind + day, EVER — the 0111/0123 axes
 *   law) + the payload floor + the step-instance composite FK;
 * - THE 0130 BRIDGE SUBSTRATE + THE GRANTS BLOCK: the origin_policy_id
 *   composite FK (a nonexistent policy row refuses 23503) + the NINE
 *   workflow.* keys live (the drift 357 → 366's own census — the
 *   ruling (ب): workflow.*, never platform.workflow.*) + the owner
 *   template holds all nine + the accountant's finance-read key + THE
 *   FIVE FEATURE FLAGS on business + enterprise with STARTER AT THE
 *   DECLARED NEUTRAL ZERO (D-04).
 *
 * THE OWNER'S PER-ARM-WORLD LAW («أذرع الرفض كلٌّ على عالمه»): every
 * rejection arm builds its OWN world — a fresh definition/instance with
 * a unique natural key; no arm shares mutable rows with another.
 */

interface PgError {
  code?: string;
  constraint?: string;
}

async function expectConstraint(
  run: () => Promise<unknown>,
  constraint: string,
  pgCode: "23514" | "23505" | "23503",
): Promise<void> {
  let caught: PgError | undefined;
  try {
    await run();
  } catch (error) {
    caught = error as PgError;
  }
  expect(caught, `expected ${constraint} to refuse the row`).toBeTruthy();
  expect(caught?.code).toBe(pgCode);
  expect(caught?.constraint).toBe(constraint);
}

let su: Client;

beforeAll(async () => {
  await setupWorkflowFixture();
  su = await superuserClient();
});

async function insertDefinition(row: Record<string, unknown>): Promise<unknown> {
  return su.query(
    `INSERT INTO workflow_definitions
       (id, tenant_id, name, name_ar, trigger_entity, trigger_event, active, conditions,
        origin_policy_id, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
    [
      TENANT_WORKFLOW,
      row.name,
      row.nameAr ?? "تعريف",
      row.triggerEntity ?? "purchase_order",
      row.triggerEvent ?? "PENDING_APPROVAL",
      row.active ?? true,
      JSON.stringify(row.conditions ?? { all: [] }),
      row.originPolicyId ?? null,
      WF_ACTOR,
    ],
  );
}

async function insertStep(definitionId: string, row: Record<string, unknown>): Promise<unknown> {
  return su.query(
    `INSERT INTO workflow_steps
       (id, tenant_id, definition_id, step_order, step_type, assignee_rule, assignee_value,
        conditions, sla_hours, name, name_ar, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
    [
      TENANT_WORKFLOW,
      definitionId,
      row.stepOrder ?? 1,
      row.stepType ?? "APPROVAL",
      row.assigneeRule ?? "ROLE",
      row.assigneeValue ?? "owner",
      JSON.stringify(row.conditions ?? { all: [] }),
      row.slaHours ?? null,
      row.name ?? "Step",
      row.nameAr ?? "خطوة",
      WF_ACTOR,
    ],
  );
}

async function insertInstance(row: Record<string, unknown>): Promise<unknown> {
  // "in" guards — an EXPLICIT null (the terminal pointer, the absent
  // stamp) must survive the helper's defaults, never fall through ??
  // (the null-coalescing class the arms below exist to pin).
  const currentStepOrder = "currentStepOrder" in row ? row.currentStepOrder : 1;
  const completedAt = "completedAt" in row ? row.completedAt : null;
  return su.query(
    `INSERT INTO workflow_instances
       (id, tenant_id, definition_id, trigger_entity, trigger_entity_id, definition_snapshot,
        current_step_order, status, completed_at, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::uuid, $5::jsonb, $6, $7, $8, $9)`,
    [
      TENANT_WORKFLOW,
      row.definitionId,
      row.triggerEntity ?? "purchase_order",
      row.triggerEntityId ?? crypto.randomUUID(),
      JSON.stringify(row.snapshot ?? { steps: [] }),
      currentStepOrder,
      row.status ?? "ACTIVE",
      completedAt,
      WF_ACTOR,
    ],
  );
}

async function insertStepInstance(
  instanceId: string,
  row: Record<string, unknown>,
): Promise<unknown> {
  return su.query(
    `INSERT INTO workflow_step_instances
       (id, tenant_id, instance_id, step_order, step_type, assignee_user_id, status,
        delegated_to, acted_at, acted_by, comment, due_at, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::uuid, $8, $9::uuid, $10, $11, $12)`,
    [
      TENANT_WORKFLOW,
      instanceId,
      row.stepOrder ?? 1,
      row.stepType ?? "APPROVAL",
      row.assigneeUserId ?? WF_USER_ASSIGNEE,
      row.status ?? "PENDING",
      row.delegatedTo ?? null,
      row.actedAt ?? null,
      row.actedBy ?? null,
      row.comment ?? null,
      row.dueAt ?? null,
      WF_ACTOR,
    ],
  );
}

async function insertDelegation(row: Record<string, unknown>): Promise<unknown> {
  return su.query(
    `INSERT INTO delegations
       (id, tenant_id, from_user_id, to_user_id, scope_kind, scope_value, starts_at, ends_at,
        note, created_by)
     VALUES (gen_random_uuid(), $1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9)`,
    [
      TENANT_WORKFLOW,
      row.fromUserId ?? WF_USER_ASSIGNEE,
      row.toUserId ?? WF_USER_DELEGATE,
      row.scopeKind ?? "ALL",
      row.scopeValue ?? null,
      row.startsAt ?? "2026-11-27T08:00:00Z",
      row.endsAt ?? "2026-11-28T08:00:00Z",
      row.note ?? null,
      WF_ACTOR,
    ],
  );
}

async function insertEscalation(row: Record<string, unknown>): Promise<unknown> {
  return su.query(
    `INSERT INTO escalation_events
       (id, tenant_id, step_instance_id, kind, due_date, payload, note, created_by)
     VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4::date, $5::jsonb, $6, $7)`,
    [
      TENANT_WORKFLOW,
      row.stepInstanceId,
      row.kind ?? "REMINDER",
      row.dueDate ?? "2026-11-27",
      JSON.stringify(row.payload ?? {}),
      row.note ?? null,
      WF_ACTOR,
    ],
  );
}

describe("PHASE-052 W-43 — the definitions register (0127, D-02/D-05)", () => {
  it("the legal shapes: all FOUR exemplar surfaces with their mapping-law events; the active default; the conditions default", async () => {
    await insertDefinition({ name: "WF-L1", triggerEntity: "manual_journal", triggerEvent: "PENDING_APPROVAL" });
    await insertDefinition({ name: "WF-L2", triggerEntity: "purchase_order", triggerEvent: "PENDING_APPROVAL" });
    await insertDefinition({ name: "WF-L3", triggerEntity: "change_order", triggerEvent: "SUBMITTED" });
    await insertDefinition({ name: "WF-L4", triggerEntity: "duty_drawback_claim", triggerEvent: "SUBMITTED" });
    const defaults = await su.query<{ active: boolean; conditions: string }>(
      `SELECT active, conditions::text AS conditions FROM workflow_definitions WHERE name = 'WF-L1'`,
    );
    expect(defaults.rows[0]?.active).toBe(true);
    expect(JSON.parse(defaults.rows[0]?.conditions ?? "{}")).toEqual({ all: [] });
  });

  it("THE CLOSED TRIGGER REGISTRY: a fifth surface refused BY NAME (the out-of-scope prohibition's structural face)", async () => {
    await expectConstraint(
      () => insertDefinition({ name: "WF-BAD-ENTITY", triggerEntity: "sales_invoice" }),
      "ck_workflow_definitions_trigger_entity",
      "23514",
    );
  });

  it("the vocabulary mapping law: the event vocabulary closed — an alien submit status refused BY NAME", async () => {
    await expectConstraint(
      () => insertDefinition({ name: "WF-BAD-EVENT", triggerEvent: "APPROVED" }),
      "ck_workflow_definitions_trigger_event",
      "23514",
    );
  });

  it("the name shapes: newlines refused; the (tenant, name) uniqueness", async () => {
    await insertDefinition({ name: "WF-NAME-1" });
    await expectConstraint(
      () => insertDefinition({ name: "WF-NAME-BAD\nSECOND-LINE" }),
      "ck_workflow_definitions_name_shape",
      "23514",
    );
    await expectConstraint(
      () => insertDefinition({ name: "WF-NAME-1" }),
      "uq_workflow_definitions_tenant_name",
      "23505",
    );
  });

  it("the entry conditions' shallow floor: a non-object refused BY NAME (the deep typed refusals are the pure fold's own)", async () => {
    await expectConstraint(
      () => insertDefinition({ name: "WF-BAD-COND", conditions: ["not", "an", "object"] }),
      "ck_workflow_definitions_conditions_shape",
      "23514",
    );
    await expectConstraint(
      () => insertDefinition({ name: "WF-BAD-COND-2", conditions: "all" }),
      "ck_workflow_definitions_conditions_shape",
      "23514",
    );
  });
});

describe("PHASE-052 W-43 — the ordered steps (0127, D-02/D-14)", () => {
  it("the legal shapes: the three step types × the four assignee rules; the nullable SLA; the ordered chain", async () => {
    const definitionId = await freshWorkflowDefinition("STEPS");
    const orders = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    let next = 0;
    for (const stepType of ["APPROVAL", "NOTIFICATION", "TASK"] as const) {
      await insertStep(definitionId, {
        name: `S-${stepType}`,
        stepType,
        stepOrder: orders[next++],
      });
    }
    for (const rule of ["ROLE", "USER", "FIELD", "FORMULA"] as const) {
      await insertStep(definitionId, { name: `R-${rule}`, assigneeRule: rule, stepOrder: orders[next++] });
      await insertStep(definitionId, { name: `R2-${rule}`, assigneeRule: rule, stepOrder: orders[next++], slaHours: 48 });
    }
  });

  it("THE W-10 SCOPE NOTE at the floor: a fourth step type refused BY NAME (free-form custom actions OUT — DR-052-02)", async () => {
    const definitionId = await freshWorkflowDefinition("TYPE");
    await expectConstraint(
      () => insertStep(definitionId, { name: "S-CUSTOM", stepType: "CUSTOM_ACTION" }),
      "ck_workflow_steps_type",
      "23514",
    );
  });

  it("the assignee-rule vocabulary closed — a fifth rule refused BY NAME", async () => {
    const definitionId = await freshWorkflowDefinition("RULE");
    await expectConstraint(
      () => insertStep(definitionId, { name: "S-TEAM", assigneeRule: "TEAM" }),
      "ck_workflow_steps_assignee_rule",
      "23514",
    );
  });

  it("the ordering floor: 1-based (a zero order refused); the SLA floor: whole hours ≥ 1 (a zero refused)", async () => {
    const definitionId = await freshWorkflowDefinition("ORDER");
    await expectConstraint(
      () => insertStep(definitionId, { name: "S-ZERO", stepOrder: 0 }),
      "ck_workflow_steps_order",
      "23514",
    );
    const slaDefinition = await freshWorkflowDefinition("SLA");
    await expectConstraint(
      () => insertStep(slaDefinition, { name: "S-SLA-0", slaHours: 0 }),
      "ck_workflow_steps_sla_hours",
      "23514",
    );
  });

  it("the (tenant, definition, order) uniqueness — the visual ordering's own floor", async () => {
    const definitionId = await freshWorkflowDefinition("UNIQ");
    await insertStep(definitionId, { name: "S-FIRST", stepOrder: 1 });
    await expectConstraint(
      () => insertStep(definitionId, { name: "S-CLASH", stepOrder: 1 }),
      "uq_workflow_steps_tenant_definition_order",
      "23505",
    );
  });

  it("the definition composite FK: a foreign-tenant definition refuses 23503 (the tenant-pair law)", async () => {
    const foreignDefinition = await su.query<{ id: string }>(
      `INSERT INTO workflow_definitions
         (id, tenant_id, name, name_ar, trigger_entity, trigger_event)
       VALUES (gen_random_uuid(), '8f8f8f8f-8f8f-8f8f-8f8f-8f8f8f8f8f8d',
         'WF-FOREIGN-DEF', 'تعريف أجنبي', 'purchase_order', 'PENDING_APPROVAL')
       RETURNING id`,
    );
    await expectConstraint(
      () =>
        insertStep(foreignDefinition.rows[0]!.id, {
          name: "S-CROSS",
          assigneeValue: "owner",
        }),
      "fk_workflow_steps_definition",
      "23503",
    );
  });

  it("the assignee-value shape: the hostile characters refused BY NAME", async () => {
    const definitionId = await freshWorkflowDefinition("VALUE");
    await expectConstraint(
      () => insertStep(definitionId, { name: "S-BAD-VAL", assigneeValue: "owner'; DROP TABLE users; --" }),
      "ck_workflow_steps_assignee_value_shape",
      "23514",
    );
  });
});

describe("PHASE-052 W-43 — the instances (0128, D-02/D-13 — INV-037's floor)", () => {
  it("the legal shapes: ACTIVE with its pointer; COMPLETED and CANCELLED with the stamp and the NULL pointer", async () => {
    const activeDefinition = await freshWorkflowDefinition("INS-A");
    await insertInstance({ definitionId: activeDefinition, name: "INS-L-A" });
    const doneDefinition = await freshWorkflowDefinition("INS-C");
    await insertInstance({
      definitionId: doneDefinition,
      status: "COMPLETED",
      currentStepOrder: null,
      completedAt: "2026-11-27T12:00:00Z",
    });
    const cancelledDefinition = await freshWorkflowDefinition("INS-X");
    await insertInstance({
      definitionId: cancelledDefinition,
      status: "CANCELLED",
      currentStepOrder: null,
      completedAt: "2026-11-27T12:00:00Z",
    });
  });

  it("the status vocabulary closed — an alien status refused (the ENUMERATING SHAPE CHECK's own closure; the dedicated status CHECK is the redundant second floor — the subsumption disclosed)", async () => {
    // THE SUBSUMPTION DISCLOSURE (the F1 law): an alien status can
    // NEVER satisfy the pointer/terminal shape checks — their branches
    // enumerate the LEGAL statuses themselves, so the alien is refused
    // by whichever enumerating check the engine reports first (the
    // shape check's own name); ck_workflow_instances_status is the
    // belt-and-braces floor that fires when the shapes are otherwise
    // satisfiable. The vocabulary is closed EITHER WAY — 23514.
    const definitionId = await freshWorkflowDefinition("INS-STAT");
    await expectConstraint(
      () => insertInstance({ definitionId, status: "PENDING" }),
      "ck_workflow_instances_pointer_shape",
      "23514",
    );
  });

  it("the trigger registry floor on the instances: a fifth surface refused BY NAME", async () => {
    const definitionId = await freshWorkflowDefinition("INS-ENT");
    await expectConstraint(
      () => insertInstance({ definitionId, triggerEntity: "goods_receipt" }),
      "ck_workflow_instances_trigger_entity",
      "23514",
    );
  });

  it("THE POINTER LAW: ACTIVE without its pointer refused; a terminal WITH a pointer refused", async () => {
    const nullPointerDefinition = await freshWorkflowDefinition("INS-PTR-1");
    await expectConstraint(
      () => insertInstance({ definitionId: nullPointerDefinition, currentStepOrder: null }),
      "ck_workflow_instances_pointer_shape",
      "23514",
    );
    const terminalPointerDefinition = await freshWorkflowDefinition("INS-PTR-2");
    await expectConstraint(
      () =>
        insertInstance({
          definitionId: terminalPointerDefinition,
          status: "COMPLETED",
          currentStepOrder: 2,
          completedAt: "2026-11-27T12:00:00Z",
        }),
      "ck_workflow_instances_pointer_shape",
      "23514",
    );
  });

  it("INV-037's TERMINAL STAMP FLOOR: the terminal state and its stamp TOGETHER — a terminal without completed_at refused; ACTIVE with a stamp refused", async () => {
    const noStampDefinition = await freshWorkflowDefinition("INS-STAMP-1");
    await expectConstraint(
      () =>
        insertInstance({
          definitionId: noStampDefinition,
          status: "COMPLETED",
          currentStepOrder: null,
          completedAt: null,
        }),
      "ck_workflow_instances_terminal_shape",
      "23514",
    );
    const earlyStampDefinition = await freshWorkflowDefinition("INS-STAMP-2");
    await expectConstraint(
      () =>
        insertInstance({
          definitionId: earlyStampDefinition,
          status: "ACTIVE",
          completedAt: "2026-11-27T12:00:00Z",
        }),
      "ck_workflow_instances_terminal_shape",
      "23514",
    );
  });

  it("THE SNAPSHOT FLOOR: the immutable definition capture is a json object — an array refused BY NAME", async () => {
    const definitionId = await freshWorkflowDefinition("INS-SNAP");
    await expectConstraint(
      () => insertInstance({ definitionId, snapshot: ["not", "an", "object"] }),
      "ck_workflow_instances_snapshot_shape",
      "23514",
    );
  });

  it("ONE ACTIVE CHAIN PER DOCUMENT: the second ACTIVE chain on the same doc refused; the terminal history + a NEW ACTIVE chain legal (the re-submission law)", async () => {
    const definitionId = await freshWorkflowDefinition("INS-ONE");
    const docId = crypto.randomUUID();
    await insertInstance({ definitionId, triggerEntityId: docId });
    await expectConstraint(
      () => insertInstance({ definitionId, triggerEntityId: docId }),
      "uq_workflow_instances_live_doc",
      "23505",
    );
    // the terminal instance stands as the frozen history; a re-submitted
    // document opens a NEW chain, never rewrites a terminal one
    const otherDocDefinition = await freshWorkflowDefinition("INS-ONE-B");
    const otherDoc = crypto.randomUUID();
    await insertInstance({
      definitionId: otherDocDefinition,
      triggerEntityId: otherDoc,
      status: "COMPLETED",
      currentStepOrder: null,
      completedAt: "2026-11-27T12:00:00Z",
    });
    await insertInstance({ definitionId: otherDocDefinition, triggerEntityId: otherDoc });
    // and a DIFFERENT document's ACTIVE chain coexists (the partial
    // unique never blocks cross-document chains)
    await insertInstance({ definitionId: otherDocDefinition });
  });

  it("the definition composite FK: a foreign-tenant definition refuses 23503", async () => {
    const foreignDefinition = await su.query<{ id: string }>(
      `INSERT INTO workflow_definitions
         (id, tenant_id, name, name_ar, trigger_entity, trigger_event)
       VALUES (gen_random_uuid(), '8f8f8f8f-8f8f-8f8f-8f8f-8f8f8f8f8f8d',
         'WF-FOREIGN-DEF-2', 'تعريف أجنبي ٢', 'purchase_order', 'PENDING_APPROVAL')
       RETURNING id`,
    );
    await expectConstraint(
      () => insertInstance({ definitionId: foreignDefinition.rows[0]!.id }),
      "fk_workflow_instances_definition",
      "23503",
    );
  });
});

describe("PHASE-052 W-43 — the step instances + THE LADDER'S STAMP LAW (0128, D-11/D-13, PP-17)", () => {
  it("the legal shapes: every rung in its own world — PENDING bare · DELEGATED the re-route · APPROVED/REJECTED the act pair · SKIPPED the no-actor stamp", async () => {
    const pendingInstance = await freshWorkflowInstance("LAD-P", await freshWorkflowDefinition("LAD-P"));
    await insertStepInstance(pendingInstance, { status: "PENDING" });

    const delegatedInstance = await freshWorkflowInstance("LAD-D", await freshWorkflowDefinition("LAD-D"));
    await insertStepInstance(delegatedInstance, {
      status: "DELEGATED",
      delegatedTo: WF_USER_DELEGATE,
    });

    const approvedInstance = await freshWorkflowInstance("LAD-A", await freshWorkflowDefinition("LAD-A"));
    await insertStepInstance(approvedInstance, {
      status: "APPROVED",
      actedAt: "2026-11-27T09:00:00Z",
      actedBy: WF_USER_ASSIGNEE,
      comment: "LGTM",
    });
    // the act through a window RETAINS the provenance (delegated_to stays)
    const approvedViaWindowInstance = await freshWorkflowInstance("LAD-AW", await freshWorkflowDefinition("LAD-AW"));
    await insertStepInstance(approvedViaWindowInstance, {
      status: "APPROVED",
      delegatedTo: WF_USER_DELEGATE,
      actedAt: "2026-11-27T09:00:00Z",
      actedBy: WF_USER_DELEGATE,
    });

    const rejectedInstance = await freshWorkflowInstance("LAD-R", await freshWorkflowDefinition("LAD-R"));
    await insertStepInstance(rejectedInstance, {
      status: "REJECTED",
      actedAt: "2026-11-27T09:00:00Z",
      actedBy: WF_USER_ASSIGNEE,
      comment: "nope",
    });

    const skippedInstance = await freshWorkflowInstance("LAD-S", await freshWorkflowDefinition("LAD-S"));
    await insertStepInstance(skippedInstance, {
      status: "SKIPPED",
      actedAt: "2026-11-27T09:30:00Z",
    });
  });

  it("PENDING carries no act and no delegation — every violation refused BY NAME", async () => {
    const withActInstance = await freshWorkflowInstance("PND-1", await freshWorkflowDefinition("PND-1"));
    await expectConstraint(
      () =>
        insertStepInstance(withActInstance, {
          status: "PENDING",
          actedAt: "2026-11-27T09:00:00Z",
        }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
    const withActorInstance = await freshWorkflowInstance("PND-2", await freshWorkflowDefinition("PND-2"));
    await expectConstraint(
      () => insertStepInstance(withActorInstance, { status: "PENDING", actedBy: WF_USER_ASSIGNEE }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
    const withDelegateInstance = await freshWorkflowInstance("PND-3", await freshWorkflowDefinition("PND-3"));
    await expectConstraint(
      () => insertStepInstance(withDelegateInstance, { status: "PENDING", delegatedTo: WF_USER_DELEGATE }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
  });

  it("DELEGATED records the re-route and NEVER the act — a delegate-less or acted DELEGATED refused BY NAME", async () => {
    const noDelegateInstance = await freshWorkflowInstance("DLG-1", await freshWorkflowDefinition("DLG-1"));
    await expectConstraint(
      () => insertStepInstance(noDelegateInstance, { status: "DELEGATED" }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
    const actedInstance = await freshWorkflowInstance("DLG-2", await freshWorkflowDefinition("DLG-2"));
    await expectConstraint(
      () =>
        insertStepInstance(actedInstance, {
          status: "DELEGATED",
          delegatedTo: WF_USER_DELEGATE,
          actedAt: "2026-11-27T09:00:00Z",
          actedBy: WF_USER_DELEGATE,
        }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
  });

  it("APPROVED/REJECTED carry the act pair TOGETHER — the half-pairs refused BY NAME", async () => {
    const noActorInstance = await freshWorkflowInstance("ACT-1", await freshWorkflowDefinition("ACT-1"));
    await expectConstraint(
      () => insertStepInstance(noActorInstance, { status: "APPROVED", actedAt: "2026-11-27T09:00:00Z" }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
    const noStampInstance = await freshWorkflowInstance("ACT-2", await freshWorkflowDefinition("ACT-2"));
    await expectConstraint(
      () => insertStepInstance(noStampInstance, { status: "REJECTED", actedBy: WF_USER_ASSIGNEE }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
  });

  it("SKIPPED carries the skip stamp with NO actor and NO delegation — the user-act shapes refused BY NAME", async () => {
    const withActorInstance = await freshWorkflowInstance("SKP-1", await freshWorkflowDefinition("SKP-1"));
    await expectConstraint(
      () =>
        insertStepInstance(withActorInstance, {
          status: "SKIPPED",
          actedAt: "2026-11-27T09:00:00Z",
          actedBy: WF_USER_ASSIGNEE,
        }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
    const withDelegateInstance = await freshWorkflowInstance("SKP-2", await freshWorkflowDefinition("SKP-2"));
    await expectConstraint(
      () =>
        insertStepInstance(withDelegateInstance, {
          status: "SKIPPED",
          actedAt: "2026-11-27T09:00:00Z",
          delegatedTo: WF_USER_DELEGATE,
        }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
    const bareInstance = await freshWorkflowInstance("SKP-3", await freshWorkflowDefinition("SKP-3"));
    await expectConstraint(
      () => insertStepInstance(bareInstance, { status: "SKIPPED" }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
  });

  it("the status and type vocabularies closed — alien values refused (the act-shape check's own status enumeration; the subsumption disclosed)", async () => {
    // THE SUBSUMPTION DISCLOSURE (the F1 law — the instances' own
    // twin): an alien step status can never satisfy the act-shape
    // check's enumerated branches; the dedicated status CHECK is the
    // redundant second floor. The TYPE vocabulary fires its OWN name
    // (no other check enumerates the types).
    const statusInstance = await freshWorkflowInstance("VOC-1", await freshWorkflowDefinition("VOC-1"));
    await expectConstraint(
      () => insertStepInstance(statusInstance, { status: "DONE" }),
      "ck_workflow_step_instances_act_shape",
      "23514",
    );
    const typeInstance = await freshWorkflowInstance("VOC-2", await freshWorkflowDefinition("VOC-2"));
    await expectConstraint(
      () => insertStepInstance(typeInstance, { stepType: "ESCALATION" }),
      "ck_workflow_step_instances_type",
      "23514",
    );
  });

  it("the (tenant, instance, order) uniqueness + the instance composite FK (the tenant-pair law 23503)", async () => {
    const instance = await freshWorkflowInstance("UNI", await freshWorkflowDefinition("UNI"));
    await insertStepInstance(instance, { stepOrder: 1 });
    await expectConstraint(
      () => insertStepInstance(instance, { stepOrder: 1 }),
      "uq_workflow_step_instances_tenant_instance_order",
      "23505",
    );
    await expectConstraint(
      () => insertStepInstance("8f8f8f8f-0000-4000-8000-0000000000ff", { stepOrder: 1 }),
      "fk_workflow_step_instances_instance",
      "23503",
    );
  });
});

describe("PHASE-052 W-43 — the delegation windows (0129, D-07)", () => {
  it("the legal shapes: ALL with no value; MODULE and ENTITY with exactly one; the bilingual note", async () => {
    await insertDelegation({ scopeKind: "ALL" });
    await insertDelegation({ scopeKind: "MODULE", scopeValue: "purchasing" });
    await insertDelegation({ scopeKind: "ENTITY", scopeValue: "purchase_order", note: "PO cover", noteAr: null });
  });

  it("THE NO-SELF FLOOR: from === to refused BY NAME (the G-67 graph walk's own seed law)", async () => {
    await expectConstraint(
      () => insertDelegation({ fromUserId: WF_USER_ASSIGNEE, toUserId: WF_USER_ASSIGNEE }),
      "ck_delegations_no_self",
      "23514",
    );
  });

  it("THE SCOPE PAIR LAW: ALL with a value refused; MODULE without its value refused", async () => {
    await expectConstraint(
      () => insertDelegation({ scopeKind: "ALL", scopeValue: "purchasing" }),
      "ck_delegations_scope_shape",
      "23514",
    );
    await expectConstraint(
      () => insertDelegation({ scopeKind: "MODULE", scopeValue: null }),
      "ck_delegations_scope_shape",
      "23514",
    );
  });

  it("the scope vocabulary closed — an alien kind refused BY NAME", async () => {
    await expectConstraint(
      () => insertDelegation({ scopeKind: "DEPARTMENT" }),
      "ck_delegations_scope_kind",
      "23514",
    );
  });

  it("THE WINDOW LAW: an empty or inverted window is never an absence — refused BY NAME", async () => {
    await expectConstraint(
      () =>
        insertDelegation({
          startsAt: "2026-11-28T08:00:00Z",
          endsAt: "2026-11-27T08:00:00Z",
        }),
      "ck_delegations_window",
      "23514",
    );
    await expectConstraint(
      () =>
        insertDelegation({
          startsAt: "2026-11-27T08:00:00Z",
          endsAt: "2026-11-27T08:00:00Z",
        }),
      "ck_delegations_window",
      "23514",
    );
  });
});

describe("PHASE-052 W-43 — the escalation events + THE STRUCTURAL DEDUPE (0129, D-08)", () => {
  it("the legal shapes: the four kinds with their action payloads", async () => {
    const stepInstance = await freshWorkflowStepInstance(
      await freshWorkflowInstance("ESC", await freshWorkflowDefinition("ESC")),
    );
    for (const kind of ["REASSIGN", "ADD_LEVEL", "NOTIFY", "REMINDER"] as const) {
      await insertEscalation({ stepInstanceId: stepInstance, kind, payload: { from: "u1", to: "u2" } });
    }
  });

  it("the action vocabulary closed — an alien kind refused BY NAME", async () => {
    const stepInstance = await freshWorkflowStepInstance(
      await freshWorkflowInstance("ESV", await freshWorkflowDefinition("ESV")),
    );
    await expectConstraint(
      () => insertEscalation({ stepInstanceId: stepInstance, kind: "ESCALATE" }),
      "ck_escalation_events_kind",
      "23514",
    );
  });

  it("THE STRUCTURAL DEDUPE: one event per step + kind + day, EVER — the duplicate refused; a different kind or day legal", async () => {
    const stepInstance = await freshWorkflowStepInstance(
      await freshWorkflowInstance("ESD", await freshWorkflowDefinition("ESD")),
    );
    await insertEscalation({ stepInstanceId: stepInstance, kind: "REMINDER", dueDate: "2026-11-27" });
    await expectConstraint(
      () => insertEscalation({ stepInstanceId: stepInstance, kind: "REMINDER", dueDate: "2026-11-27" }),
      "uq_escalation_events_dedupe",
      "23505",
    );
    // a different kind on the same day: a DIFFERENT event
    await insertEscalation({ stepInstanceId: stepInstance, kind: "NOTIFY", dueDate: "2026-11-27" });
    // the same kind on a different day axis: a DIFFERENT event (a new
    // due date is a new breach cycle's own axis)
    await insertEscalation({ stepInstanceId: stepInstance, kind: "REMINDER", dueDate: "2026-11-28" });
  });

  it("the payload floor: a json object — an array refused BY NAME", async () => {
    const stepInstance = await freshWorkflowStepInstance(
      await freshWorkflowInstance("ESP", await freshWorkflowDefinition("ESP")),
    );
    await expectConstraint(
      () => insertEscalation({ stepInstanceId: stepInstance, payload: ["not", "an", "object"] }),
      "ck_escalation_events_payload_shape",
      "23514",
    );
  });

  it("the step-instance composite FK: a foreign step instance refuses 23503", async () => {
    await expectConstraint(
      () => insertEscalation({ stepInstanceId: "8f8f8f8f-0000-4000-8000-0000000000fe" }),
      "fk_escalation_events_step_instance",
      "23503",
    );
  });
});

describe("PHASE-052 W-43 — THE 0130 BRIDGE SUBSTRATE + THE GRANTS BLOCK (the census)", () => {
  it("the origin_policy_id composite FK: a nonexistent approval_policies row refuses 23503 (the back-reference's own floor)", async () => {
    await expectConstraint(
      () =>
        insertDefinition({
          name: "WF-BRIDGE-BAD",
          originPolicyId: "8f8f8f8f-0000-4000-8000-0000000000fd",
        }),
      "fk_workflow_definitions_origin_policy",
      "23503",
    );
  });

  it("THE NINE KEYS LIVE (the ruling (ب): workflow.*, never platform.workflow.* — the drift 357 → 366's own census)", async () => {
    const keys = await su.query<{ key: string }>(
      `SELECT key FROM permissions WHERE key LIKE 'workflow.%' ORDER BY key`,
    );
    expect(keys.rows.map((row) => row.key)).toEqual([
      "workflow.approve",
      "workflow.definitions.manage",
      "workflow.delegate",
      "workflow.delegations.manage",
      "workflow.escalation.manage",
      "workflow.history.view",
      "workflow.inbox.act",
      "workflow.settings.admin",
      "workflow.tasks.manage",
    ]);
    const platformNamespaced = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM permissions WHERE key LIKE 'platform.workflow.%'`,
    );
    expect(platformNamespaced.rows[0]?.n).toBe("0");
  });

  it("the role grants: the owner template holds all nine; the accountant the ONE finance-read key", async () => {
    const ownerKeys = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n
       FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.key = 'owner' AND r.tenant_id IS NULL
         AND rp.permission_id LIKE 'workflow.%'`,
    );
    expect(ownerKeys.rows[0]?.n).toBe("9");
    const accountantKeys = await su.query<{ key: string }>(
      `SELECT rp.permission_id AS key
       FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
       WHERE r.key = 'accountant' AND r.tenant_id IS NULL
         AND rp.permission_id LIKE 'workflow.%'`,
    );
    expect(accountantKeys.rows.map((row) => row.key)).toEqual(["workflow.history.view"]);
  });

  it("THE FIVE FEATURE FLAGS: business + enterprise carry them; STARTER AT THE DECLARED NEUTRAL ZERO (D-04)", async () => {
    const plans = await su.query<{ key: string; feature_keys: string[] }>(
      `SELECT key, feature_keys FROM plans WHERE key IN ('starter', 'business', 'enterprise')`,
    );
    const byPlan = new Map(plans.rows.map((row) => [row.key, row.feature_keys]));
    const expected = [
      "workflow.engine",
      "workflow.definitions",
      "workflow.delegation",
      "workflow.escalation",
      "workflow.tasks",
    ];
    for (const planKey of ["business", "enterprise"] as const) {
      const keys = byPlan.get(planKey) ?? [];
      for (const flag of expected) {
        expect(keys, `${planKey} carries ${flag}`).toContain(flag);
      }
    }
    const starter = byPlan.get("starter") ?? [];
    expect(starter.filter((key) => key.startsWith("workflow."))).toEqual([]);
  });
});
