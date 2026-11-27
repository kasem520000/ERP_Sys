import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-052 (W-44 — T-03, dated 2026-11-27) THE WORKFLOW STORE (the
 * trade-store precedent: plain SQL over the ambient tenant scope — the
 * engine's own reads/writes; the tables are W-43's 0127/0128 shapes;
 * RLS is the safety net, the composite (id, tenant_id) FKs the
 * tenant-pair law).
 *
 * THE AUDIT-FIRST LAW (red line §6.3): every transition records its
 * workflow.* audit action through this store's appendAudit — the same
 * audit_events shape the DrizzleAuditStore writes, with the REAL actor
 * (the POLICY_ACTOR sentinel never an audit actor, BR-005's own law).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("workflow store access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the definition register (0127) ───────────────────────────────────

export interface WorkflowDefinitionRow {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string;
  readonly triggerEntity: string;
  readonly triggerEvent: string;
  readonly active: boolean;
  readonly conditions: unknown;
  readonly originPolicyId: string | null;
}

export interface WorkflowStepRow {
  readonly id: string;
  readonly definitionId: string;
  readonly stepOrder: number;
  readonly stepType: "APPROVAL" | "NOTIFICATION" | "TASK";
  readonly assigneeRule: "ROLE" | "USER" | "FIELD" | "FORMULA";
  readonly assigneeValue: string;
  readonly conditions: unknown;
  readonly slaHours: number | null;
  readonly name: string;
  readonly nameAr: string;
}

/** The active definitions for a trigger, DETERMINISTICALLY ordered
 * (created_at, name, id) — the first whose entry conditions hold wins
 * (the documented gateway contract; a tenant controls precedence by
 * creation time then name, and the pick is stable across replays —
 * the id tiebreak keeps same-timestamp same-name rows stable too). */
export async function findActiveDefinitionsForTrigger(
  triggerEntity: string,
  triggerEvent: string,
): Promise<readonly WorkflowDefinitionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, name, name_ar AS "nameAr", trigger_entity AS "triggerEntity",
           trigger_event AS "triggerEvent", active, conditions, origin_policy_id AS "originPolicyId"
    FROM workflow_definitions
    WHERE trigger_entity = ${triggerEntity} AND trigger_event = ${triggerEvent} AND active
    ORDER BY created_at, name, id
  `);
  return rows.rows as unknown as WorkflowDefinitionRow[];
}

/** The definition's ordered steps (the snapshot's source). */
export async function findStepsForDefinition(
  definitionId: string,
): Promise<readonly WorkflowStepRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, definition_id AS "definitionId", step_order AS "stepOrder", step_type AS "stepType",
           assignee_rule AS "assigneeRule", assignee_value AS "assigneeValue", conditions,
           sla_hours AS "slaHours", name, name_ar AS "nameAr"
    FROM workflow_steps
    WHERE definition_id = ${definitionId}
    ORDER BY step_order
  `);
  return rows.rows as unknown as WorkflowStepRow[];
}

// ── the instances + step instances (0128) ────────────────────────────

export interface WorkflowInstanceRow {
  readonly id: string;
  readonly definitionId: string;
  readonly triggerEntity: string;
  readonly triggerEntityId: string;
  readonly definitionSnapshot: unknown;
  readonly currentStepOrder: number | null;
  readonly status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  readonly completedAt: string | null;
}

export interface WorkflowStepInstanceRow {
  readonly id: string;
  readonly instanceId: string;
  readonly stepOrder: number;
  readonly stepType: "APPROVAL" | "NOTIFICATION" | "TASK";
  readonly assigneeUserId: string;
  readonly status: "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED" | "DELEGATED";
  readonly delegatedTo: string | null;
  readonly actedAt: string | null;
  readonly actedBy: string | null;
  readonly comment: string | null;
  readonly dueAt: string | null;
}

/** The ACTIVE instance for a document, if any (the ONE-ACTIVE-CHAIN
 * law's partial unique guarantees at most one). */
export async function findActiveInstanceForDocument(
  triggerEntity: string,
  triggerEntityId: string,
): Promise<WorkflowInstanceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, definition_id AS "definitionId", trigger_entity AS "triggerEntity",
           trigger_entity_id AS "triggerEntityId", definition_snapshot AS "definitionSnapshot",
           current_step_order AS "currentStepOrder", status, completed_at AS "completedAt"
    FROM workflow_instances
    WHERE trigger_entity = ${triggerEntity} AND trigger_entity_id = ${triggerEntityId}
      AND status = 'ACTIVE'
    LIMIT 1
  `);
  return (rows.rows as unknown as WorkflowInstanceRow[])[0];
}

export async function findInstanceById(
  instanceId: string,
): Promise<WorkflowInstanceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, definition_id AS "definitionId", trigger_entity AS "triggerEntity",
           trigger_entity_id AS "triggerEntityId", definition_snapshot AS "definitionSnapshot",
           current_step_order AS "currentStepOrder", status, completed_at AS "completedAt"
    FROM workflow_instances
    WHERE id = ${instanceId}
    LIMIT 1
  `);
  return (rows.rows as unknown as WorkflowInstanceRow[])[0];
}

export async function findStepInstanceById(
  stepInstanceId: string,
): Promise<WorkflowStepInstanceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, instance_id AS "instanceId", step_order AS "stepOrder", step_type AS "stepType",
           assignee_user_id AS "assigneeUserId", status, delegated_to AS "delegatedTo",
           acted_at AS "actedAt", acted_by AS "actedBy", comment, due_at AS "dueAt"
    FROM workflow_step_instances
    WHERE id = ${stepInstanceId}
    LIMIT 1
  `);
  return (rows.rows as unknown as WorkflowStepInstanceRow[])[0];
}

export async function findStepInstancesForInstance(
  instanceId: string,
): Promise<readonly WorkflowStepInstanceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, instance_id AS "instanceId", step_order AS "stepOrder", step_type AS "stepType",
           assignee_user_id AS "assigneeUserId", status, delegated_to AS "delegatedTo",
           acted_at AS "actedAt", acted_by AS "actedBy", comment, due_at AS "dueAt"
    FROM workflow_step_instances
    WHERE instance_id = ${instanceId}
    ORDER BY step_order
  `);
  return rows.rows as unknown as WorkflowStepInstanceRow[];
}

/** The instance creation — the immutable definition snapshot captured
 * at trigger time (a definition edited after trigger NEVER rewrites a
 * live instance; the snapshot is the frozen source). */
export async function insertWorkflowInstance(input: {
  definitionId: string;
  triggerEntity: string;
  triggerEntityId: string;
  definitionSnapshot: Record<string, unknown>;
  currentStepOrder: number | null;
  createdBy: string | null;
}): Promise<WorkflowInstanceRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO workflow_instances (
      id, tenant_id, definition_id, trigger_entity, trigger_entity_id,
      definition_snapshot, current_step_order, status, created_by
    ) VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${input.definitionId},
      ${input.triggerEntity}, ${input.triggerEntityId},
      ${JSON.stringify(input.definitionSnapshot)}::jsonb,
      ${input.currentStepOrder}, 'ACTIVE', ${input.createdBy}
    )
    RETURNING id, definition_id AS "definitionId", trigger_entity AS "triggerEntity",
      trigger_entity_id AS "triggerEntityId", definition_snapshot AS "definitionSnapshot",
      current_step_order AS "currentStepOrder", status, completed_at AS "completedAt"
  `);
  return (rows.rows as unknown as WorkflowInstanceRow[])[0]!;
}

export interface InsertStepInstanceInput {
  readonly instanceId: string;
  readonly stepOrder: number;
  readonly stepType: "APPROVAL" | "NOTIFICATION" | "TASK";
  readonly assigneeUserId: string;
  readonly status: "PENDING" | "SKIPPED";
  readonly dueAt: string | null;
  /** The SKIPPED stamp's own acted_at (the branch/notification verdict
   * — no actor, the 0128 stamp law). */
  readonly skipStampedAt: string | null;
  readonly skipComment: string | null;
}

export async function insertWorkflowStepInstance(
  input: InsertStepInstanceInput,
): Promise<WorkflowStepInstanceRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO workflow_step_instances (
      id, tenant_id, instance_id, step_order, step_type, assignee_user_id,
      status, acted_at, comment, due_at
    ) VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${input.instanceId},
      ${input.stepOrder}, ${input.stepType}, ${input.assigneeUserId},
      ${input.status}, ${input.skipStampedAt}, ${input.skipComment}, ${input.dueAt}
    )
    RETURNING id, instance_id AS "instanceId", step_order AS "stepOrder", step_type AS "stepType",
      assignee_user_id AS "assigneeUserId", status, delegated_to AS "delegatedTo",
      acted_at AS "actedAt", acted_by AS "actedBy", comment, due_at AS "dueAt"
  `);
  return (rows.rows as unknown as WorkflowStepInstanceRow[])[0]!;
}

/** THE ACT STAMP (the CAS single-use): the step's APPROVED/REJECTED
 * landing — the act pair together, the comment captured, the
 * delegated_to provenance retained. The WHERE clause is the replay
 * law's own structural face: a non-PENDING/DELEGATED row matches ZERO
 * rows and the typed refusal fires (the caller re-reads to name the
 * status). */
export async function stampStepActed(input: {
  stepInstanceId: string;
  status: "APPROVED" | "REJECTED";
  actedAt: string;
  actedBy: string;
  comment: string | null;
  /** THE DELEGATION PROVENANCE (D-07): the delegate's user id when the
   *  act came through an active window (the APPROVED/REJECTED rung
   *  retains the route's own history; null when the assignee acted
   *  directly — the stamp law's own shape). */
  actedThroughDelegate?: string | null;
}): Promise<WorkflowStepInstanceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE workflow_step_instances
    SET status = ${input.status}, acted_at = ${input.actedAt}::timestamptz,
        acted_by = ${input.actedBy}, comment = ${input.comment},
        delegated_to = ${input.actedThroughDelegate ?? null}, updated_at = now()
    WHERE id = ${input.stepInstanceId} AND status IN ('PENDING', 'DELEGATED')
    RETURNING id, instance_id AS "instanceId", step_order AS "stepOrder", step_type AS "stepType",
      assignee_user_id AS "assigneeUserId", status, delegated_to AS "delegatedTo",
      acted_at AS "actedAt", acted_by AS "actedBy", comment, due_at AS "dueAt"
  `);
  return (rows.rows as unknown as WorkflowStepInstanceRow[])[0];
}

/** THE NOTIFICATION STEP'S FIRE-AND-ADVANCE STAMP (the declared
 * interpretation, W-44): a NOTIFICATION step completes by the engine's
 * own progression — the SKIPPED rung with the fire time and NO actor
 * (the 0128 stamp law's own shape: acted_at set, acted_by NULL; the
 * step TYPE is the discriminator the timeline renders — the
 * branch-excluded APPROVAL/TASK step and the fired NOTIFICATION step
 * share the no-user-act rung, each for its own documented reason). */
export async function stampNotificationStepFired(input: {
  stepInstanceId: string;
  firedAt: string;
  comment: string | null;
}): Promise<WorkflowStepInstanceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE workflow_step_instances
    SET status = 'SKIPPED', acted_at = ${input.firedAt}::timestamptz,
        acted_by = NULL, comment = ${input.comment}, updated_at = now()
    WHERE id = ${input.stepInstanceId} AND step_type = 'NOTIFICATION' AND status = 'PENDING'
    RETURNING id, instance_id AS "instanceId", step_order AS "stepOrder", step_type AS "stepType",
      assignee_user_id AS "assigneeUserId", status, delegated_to AS "delegatedTo",
      acted_at AS "actedAt", acted_by AS "actedBy", comment, due_at AS "dueAt"
  `);
  return (rows.rows as unknown as WorkflowStepInstanceRow[])[0];
}

/** The pointer move (the advance law: NULL at the terminal states —
 * the CHECK constraint's own floor). */
export async function updateInstancePointer(input: {
  instanceId: string;
  currentStepOrder: number | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE workflow_instances
    SET current_step_order = ${input.currentStepOrder}, updated_at = now()
    WHERE id = ${input.instanceId}
  `);
}

/** The terminal stamp — COMPLETED or CANCELLED, the completed_at
 * landing TOGETHER (INV-037's floor); the WHERE status = 'ACTIVE' is
 * the immutability's structural face (a terminal row matches ZERO rows
 * and the typed refusal fires — the caller re-reads to name it). */
export async function stampInstanceTerminal(input: {
  instanceId: string;
  status: "COMPLETED" | "CANCELLED";
  completedAt: string;
}): Promise<WorkflowInstanceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE workflow_instances
    SET status = ${input.status}, current_step_order = NULL,
        completed_at = ${input.completedAt}::timestamptz, updated_at = now()
    WHERE id = ${input.instanceId} AND status = 'ACTIVE'
    RETURNING id, definition_id AS "definitionId", trigger_entity AS "triggerEntity",
      trigger_entity_id AS "triggerEntityId", definition_snapshot AS "definitionSnapshot",
      current_step_order AS "currentStepOrder", status, completed_at AS "completedAt"
  `);
  return (rows.rows as unknown as WorkflowInstanceRow[])[0];
}

// ── the assignee resolution reads ────────────────────────────────────

/** The FIRST ACTIVE membership holder of a role key — the
 * DETERMINISTIC pick (created_at, id), captured at trigger time (the
 * snapshot law: a later membership change never rewrites a live
 * instance). ONE membership per user per tenant (uq_memberships_user_
 * tenant) — the holder IS the role's active member. */
export async function findFirstActiveHolderOfRole(
  roleKey: string,
): Promise<string | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT m.user_id AS "userId"
    FROM memberships m
    JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
    WHERE m.tenant_id = erp.current_tenant_id() AND m.status = 'ACTIVE'
      AND r.key = ${roleKey} AND r.is_system = false
    ORDER BY m.created_at, m.id
    LIMIT 1
  `);
  return (rows.rows as unknown as { userId: string }[])[0]?.userId;
}

/** The ACTIVE membership check for a user id (the USER rule's own
 * floor: an unknown or revoked membership is a typed refusal — the
 * engine never invents an assignee). */
export async function userHasActiveMembership(userId: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    SELECT 1 FROM memberships
    WHERE tenant_id = erp.current_tenant_id() AND user_id = ${userId} AND status = 'ACTIVE'
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

/** The tenant owner's user id (the FORMULA `tenant.owner` resolution —
 * the tenant's own 'owner' role's first ACTIVE membership; the
 * ownerTarget precedent's exact join shape: the tenant-cloned owner
 * role carries is_system = false, the system template stays
 * tenant_id NULL and never joins a membership). */
export async function findTenantOwnerUserId(): Promise<string | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT m.user_id AS "userId"
    FROM memberships m
    JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
    WHERE m.tenant_id = erp.current_tenant_id() AND m.status = 'ACTIVE'
      AND r.key = 'owner'
    ORDER BY m.created_at, m.id
    LIMIT 1
  `);
  return (rows.rows as unknown as { userId: string }[])[0]?.userId;
}

// ── the audit-first law ──────────────────────────────────────────────

/** Append one audit_events row through the ambient tenant transaction
 * (the DrizzleAuditStore's own shape; the REAL actor only — BR-005:
 * the policy-actor sentinel is never an audit actor). */
export async function appendWorkflowAuditEvent(input: {
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  const context = requireTenantContext();
  await tenantTx().execute(sql`
    INSERT INTO audit_events (
      id, tenant_id, actor_id, action, entity_type, entity_id,
      before, after, correlation_id, device_id, via_platform_admin
    ) VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${input.actorId},
      ${input.action}, ${input.entityType}, ${input.entityId},
      ${input.before === undefined || input.before === null ? null : JSON.stringify(input.before)}::jsonb,
      ${input.after === undefined || input.after === null ? null : JSON.stringify(input.after)}::jsonb,
      ${context.correlationId ?? null}, NULL, false
    )
  `);
}
