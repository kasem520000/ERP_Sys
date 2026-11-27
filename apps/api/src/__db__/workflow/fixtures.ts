import type { Client } from "pg";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";

/**
 * PHASE-052 (W-43, the foundation wave) — the workflow family's LEAN
 * fixture (the trade/cmms fixtures' shape, T-01 + T-02): the dedicated
 * tenant WF + the WF-RLS boundary tenant + the WF_ACTOR user. The
 * workflow cluster's own substrate is DELIBERATELY MINIMAL — the six
 * tables carry NO FK to the bound documents (the polymorphic doc
 * pointer is a bare (trigger_entity, trigger_entity_id) pair, the
 * closed registry at the CHECK floor) and NO FK to users (the assignee
 * and the delegation endpoints are uuid columns, the identity plane's
 * own resolution) — so the fixture needs only the tenants; every test
 * world (definition, step, instance, step instance, delegation window,
 * escalation event) is created PER ARM with its own unique natural key
 * — the owner's «أذرع الرفض كلٌّ على عالمه» law: a rejection arm never
 * shares mutable rows with another arm; the heavy service worlds (the
 * W-44 engine's four bindings, the W-45 resolution, the G-67 golden
 * transcript, the INV-037 invariant pair) land with their waves.
 */

export const TENANT_WORKFLOW = "8f8f8f8f-8f8f-8f8f-8f8f-8f8f8f8f8f8f";
/** THE ISOLATED BOUNDARY TENANT (the trade fixtures' shape): the
 * tenant-boundary arms never assume a SHARED tenant — the empty-world
 * assertion answers on THIS dedicated tenant, empty BY CONSTRUCTION. */
export const TENANT_WORKFLOW_RLS = "8f8f8f8f-8f8f-8f8f-8f8f-8f8f8f8f8f8d";
export const WF_ACTOR = "8f8f8f8f-0000-4000-8000-0000000008f1";

/** The user-plane fixtures (the assignee / the delegate / the creator —
 * no FK, the identity plane's own resolution at the service waves). */
export const WF_USER_ASSIGNEE = "8f8f8f8f-0000-4000-8000-0000000001a1";
export const WF_USER_DELEGATE = "8f8f8f8f-0000-4000-8000-0000000001a2";
export const WF_USER_CREATOR = "8f8f8f8f-0000-4000-8000-0000000001a3";

export interface WorkflowFixture {
  readonly tenantId: string;
}

let fixture: WorkflowFixture | undefined;

export async function setupWorkflowFixture(): Promise<WorkflowFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant WF (workflow)', 'المستأجر سير', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant WF-RLS (workflow boundary)', 'المستأجر سير للفصل', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_WORKFLOW, TENANT_WORKFLOW_RLS],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'wf-actor@fixture.test', 'Workflow Actor', 'x', 'ACTIVE'),
       ($2, 'wf-assignee@fixture.test', 'Workflow Assignee', 'x', 'ACTIVE'),
       ($3, 'wf-delegate@fixture.test', 'Workflow Delegate', 'x', 'ACTIVE'),
       ($4, 'wf-creator@fixture.test', 'Workflow Creator', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [WF_ACTOR, WF_USER_ASSIGNEE, WF_USER_DELEGATE, WF_USER_CREATOR],
  );
  await su.end();
  fixture = { tenantId: TENANT_WORKFLOW };
  return fixture;
}

/** A fresh definition world per arm: its own definition row with a
 * unique (tenant, name) natural key. */
export async function freshWorkflowDefinition(
  code: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO workflow_definitions
       (id, tenant_id, name, name_ar, trigger_entity, trigger_event, active, conditions,
        created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING id`,
    [
      TENANT_WORKFLOW,
      overrides.name ?? `WF-DEF-${code}`,
      overrides.nameAr ?? `تعريف سير ${code}`,
      overrides.triggerEntity ?? "purchase_order",
      overrides.triggerEvent ?? "PENDING_APPROVAL",
      overrides.active ?? true,
      JSON.stringify(overrides.conditions ?? { all: [] }),
      WF_ACTOR,
    ],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** A fresh step world per arm: its own step row on its own definition
 * (a unique name keeps the worlds disjoint). */
export async function freshWorkflowStep(
  code: string,
  definitionId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO workflow_steps
       (id, tenant_id, definition_id, step_order, step_type, assignee_rule, assignee_value,
        conditions, sla_hours, name, name_ar, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
     RETURNING id`,
    [
      TENANT_WORKFLOW,
      definitionId,
      overrides.stepOrder ?? 1,
      overrides.stepType ?? "APPROVAL",
      overrides.assigneeRule ?? "ROLE",
      overrides.assigneeValue ?? "owner",
      JSON.stringify(overrides.conditions ?? { all: [] }),
      overrides.slaHours ?? null,
      overrides.name ?? `Step ${code}`,
      overrides.nameAr ?? `خطوة ${code}`,
      WF_ACTOR,
    ],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** A fresh instance world per arm: its own instance row on its own
 * definition, pointing at its own document (the per-arm world law —
 * the polymorphic doc pointer defaults to a fresh uuid; the arms that
 * need a SHARED doc pass it explicitly). */
export async function freshWorkflowInstance(
  code: string,
  definitionId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO workflow_instances
       (id, tenant_id, definition_id, trigger_entity, trigger_entity_id, definition_snapshot,
        current_step_order, status, completed_at, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4::uuid, $5::jsonb, $6, $7, $8, $9)
     RETURNING id`,
    [
      TENANT_WORKFLOW,
      definitionId,
      overrides.triggerEntity ?? "purchase_order",
      overrides.triggerEntityId ?? crypto.randomUUID(),
      JSON.stringify(overrides.snapshot ?? { steps: [], arm: code }),
      overrides.currentStepOrder ?? 1,
      overrides.status ?? "ACTIVE",
      overrides.completedAt ?? null,
      WF_ACTOR,
    ],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** A fresh step-instance world per arm: its own row on its own
 * instance. */
export async function freshWorkflowStepInstance(
  instanceId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO workflow_step_instances
       (id, tenant_id, instance_id, step_order, step_type, assignee_user_id, status,
        delegated_to, acted_at, acted_by, comment, due_at, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id`,
    [
      TENANT_WORKFLOW,
      instanceId,
      overrides.stepOrder ?? 1,
      overrides.stepType ?? "APPROVAL",
      overrides.assigneeUserId ?? WF_USER_ASSIGNEE,
      overrides.status ?? "PENDING",
      overrides.delegatedTo ?? null,
      overrides.actedAt ?? null,
      overrides.actedBy ?? null,
      overrides.comment ?? null,
      overrides.dueAt ?? null,
      WF_ACTOR,
    ],
  );
  await su.end();
  return row.rows[0]!.id;
}
