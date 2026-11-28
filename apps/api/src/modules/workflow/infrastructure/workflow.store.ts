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

/** PHASE-052 (W-48 — T-10, dated 2026-11-28) THE EDITOR'S OWN LIST:
 * every definition of the tenant (active AND inactive — the register
 * the chain editor renders), DETERMINISTICALLY ordered, with its
 * steps assembled in ONE pass (the two queries composed in the
 * service — the same rows the snapshot captures at trigger time). */
export async function listWorkflowDefinitions(): Promise<readonly WorkflowDefinitionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, name, name_ar AS "nameAr", trigger_entity AS "triggerEntity",
           trigger_event AS "triggerEvent", active, conditions, origin_policy_id AS "originPolicyId"
    FROM workflow_definitions
    ORDER BY trigger_entity, created_at, name, id
  `);
  return rows.rows as unknown as WorkflowDefinitionRow[];
}

/** The editor's list WITH the steps (the composed read — the steps
 * ordered per definition; the definitions carry their steps by id). */
export async function listWorkflowSteps(): Promise<readonly WorkflowStepRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, definition_id AS "definitionId", step_order AS "stepOrder", step_type AS "stepType",
           assignee_rule AS "assigneeRule", assignee_value AS "assigneeValue", conditions,
           sla_hours AS "slaHours", name, name_ar AS "nameAr"
    FROM workflow_steps
    ORDER BY definition_id, step_order
  `);
  return rows.rows as unknown as WorkflowStepRow[];
}

export interface WriteDefinitionInput {
  readonly name: string;
  readonly nameAr: string;
  readonly triggerEntity: string;
  readonly triggerEvent: string;
  readonly active: boolean;
  readonly conditions: unknown;
  readonly actorId: string;
  readonly steps: readonly {
    stepOrder: number;
    stepType: string;
    assigneeRule: string;
    assigneeValue: string;
    conditions: unknown;
    slaHours: number | null;
    name: string;
    nameAr: string;
  }[];
}

/** The editor's CREATE (the validated fold's write shape — the steps
 * inserted in the SAME ambient transaction; the definition is the
 * immutable per-instance snapshot's SOURCE, never a live template:
 * an edit after trigger never rewrites a live instance). */
export async function insertWorkflowDefinition(
  input: WriteDefinitionInput,
): Promise<WorkflowDefinitionRow> {
  const definitionId = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO workflow_definitions
      (id, tenant_id, name, name_ar, trigger_entity, trigger_event, active, conditions, created_by)
    VALUES (
      ${definitionId}, erp.current_tenant_id(), ${input.name}, ${input.nameAr},
      ${input.triggerEntity}, ${input.triggerEvent}, ${input.active},
      ${JSON.stringify(input.conditions)}::jsonb, ${input.actorId}
    )
  `);
  await insertWorkflowSteps(definitionId, input.steps, input.actorId);
  const row = await findDefinitionById(definitionId);
  if (row === undefined) {
    throw new Error("workflow definition insert did not land (the ambient transaction rolled back)");
  }
  return row;
}

/** The editor's UPDATE: the definition row + the steps REPLACED in
 * the same ambient transaction (the (tenant, definition, step_order)
 * uniqueness is the replace's own floor — delete-then-insert keeps the
 * order contiguous; an edit NEVER touches a live instance — the
 * snapshots are frozen, D-02's own law). Deactivation is the path:
 * definitions are NEVER deleted (the evidence discipline, 0127 §3). */
export async function updateWorkflowDefinition(
  definitionId: string,
  input: Omit<WriteDefinitionInput, "triggerEntity" | "triggerEvent">,
): Promise<WorkflowDefinitionRow | undefined> {
  const updated = await tenantTx().execute(sql`
    UPDATE workflow_definitions SET
      name = ${input.name}, name_ar = ${input.nameAr}, active = ${input.active},
      conditions = ${JSON.stringify(input.conditions)}::jsonb,
      updated_by = ${input.actorId}, updated_at = now(), version = version + 1
    WHERE id = ${definitionId}
    RETURNING id, name, name_ar AS "nameAr", trigger_entity AS "triggerEntity",
              trigger_event AS "triggerEvent", active, conditions, origin_policy_id AS "originPolicyId"
  `);
  const row = (updated.rows as unknown as WorkflowDefinitionRow[])[0];
  if (row === undefined) {
    return undefined;
  }
  await tenantTx().execute(sql`
    DELETE FROM workflow_steps WHERE definition_id = ${definitionId}
  `);
  await insertWorkflowSteps(definitionId, input.steps, input.actorId);
  return row;
}

async function insertWorkflowSteps(
  definitionId: string,
  steps: WriteDefinitionInput["steps"],
  actorId: string,
): Promise<void> {
  for (const step of steps) {
    await tenantTx().execute(sql`
      INSERT INTO workflow_steps
        (id, tenant_id, definition_id, step_order, step_type, assignee_rule, assignee_value,
         conditions, sla_hours, name, name_ar, created_by)
      VALUES (
        ${generateUuidV7()}, erp.current_tenant_id(), ${definitionId}, ${step.stepOrder},
        ${step.stepType}, ${step.assigneeRule}, ${step.assigneeValue},
        ${JSON.stringify(step.conditions)}::jsonb, ${step.slaHours},
        ${step.name}, ${step.nameAr}, ${actorId}
      )
    `);
  }
}

async function findDefinitionById(definitionId: string): Promise<WorkflowDefinitionRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, name, name_ar AS "nameAr", trigger_entity AS "triggerEntity",
           trigger_event AS "triggerEvent", active, conditions, origin_policy_id AS "originPolicyId"
    FROM workflow_definitions
    WHERE id = ${definitionId}
    LIMIT 1
  `);
  return (rows.rows as unknown as WorkflowDefinitionRow[])[0];
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

/** PHASE-052 (W-47 — T-06's completion half, dated 2026-11-27) THE
 * POST-COMPLETION RE-ENTRY'S OWN READ: the latest COMPLETED chain for
 * a document whose verdict was APPROVED (no REJECTED step instance on
 * the chain — the rejection's terminal verdict is the REJECTED step
 * itself; the frozen PENDING tail of a rejection never reads as an
 * approval), carrying the chain's APPROVED step count (the bridge's
 * approval_step parity figure — the same countApprovedSteps law). This
 * is the DEEP-LINK COMPLETION'S landing: a chain completed outside the
 * module's own act (the email/mobile link's act) leaves the document
 * awaiting; the module's next approve act reads THIS row and lands its
 * own transition DIRECTLY (the W-46 completion law extended to the
 * act surfaces beyond the module's own — the legacy policy path never
 * re-gates a chain-approved document). */
export async function findCompletedApprovedInstanceForDocument(
  triggerEntity: string,
  triggerEntityId: string,
): Promise<{ instanceId: string; completedSteps: number } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT wi.id AS "instanceId",
           (SELECT COUNT(*) FROM workflow_step_instances si
             WHERE si.instance_id = wi.id AND si.tenant_id = wi.tenant_id
               AND si.status = 'APPROVED')::int AS "completedSteps",
           (SELECT COUNT(*) FROM workflow_step_instances si
             WHERE si.instance_id = wi.id AND si.tenant_id = wi.tenant_id
               AND si.status = 'REJECTED')::int AS "rejectedSteps"
    FROM workflow_instances wi
    WHERE wi.trigger_entity = ${triggerEntity} AND wi.trigger_entity_id = ${triggerEntityId}
      AND wi.status = 'COMPLETED'
    ORDER BY wi.completed_at DESC, wi.created_at DESC
    LIMIT 1
  `);
  const row = (rows.rows as unknown as { instanceId: string; completedSteps: number; rejectedSteps: number }[])[0];
  if (row === undefined || row.rejectedSteps > 0) {
    return undefined;
  }
  return { instanceId: row.instanceId, completedSteps: row.completedSteps };
}

/** PHASE-052 (W-48 — T-12, dated 2026-11-28) THE TIMELINE'S OWN READ:
 * the document's chain — the ACTIVE instance if one lives, else the
 * latest terminal one (the frozen history renders VERBATIM — PP-17:
 * the terminal record is the timeline's own immutable source, INV-
 * 037's floor; a document with no chain returns undefined and the
 * timeline renders its honest no-chain state). */
export async function findLatestInstanceForDocument(
  triggerEntity: string,
  triggerEntityId: string,
): Promise<WorkflowInstanceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, definition_id AS "definitionId", trigger_entity AS "triggerEntity",
           trigger_entity_id AS "triggerEntityId", definition_snapshot AS "definitionSnapshot",
           current_step_order AS "currentStepOrder", status, completed_at AS "completedAt"
    FROM workflow_instances
    WHERE trigger_entity = ${triggerEntity} AND trigger_entity_id = ${triggerEntityId}
    ORDER BY (status = 'ACTIVE') DESC, completed_at DESC NULLS LAST, created_at DESC
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

/** PHASE-052 (W-47 — T-06, the clock law): the DATABASE'S OWN now() —
 * the deep-link expiry check's clock (never a JS wall clock; the same
 * law the breach scan carries inside its SQL). */
export async function readDbNow(): Promise<string> {
  const rows = await tenantTx().execute(sql`SELECT now()::text AS "dbNow"`);
  return (rows.rows as unknown as { dbNow: string }[])[0]!.dbNow;
}

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

// ── the escalation plane (0129 — D-08's sweep substrate) ─────────────

/** PHASE-052 (W-47 — T-08, D-11) THE TASKS LANE'S OWN QUERY: the
 * PENDING TASK step instances on ACTIVE chains assigned to the user —
 * the tasks ARE the step instances (no seventh table), the list is a
 * query over them (the typed list the API carries; the W-48 inbox's
 * tasks lane renders). Ordered by the due instant then the instance's
 * own creation (the aging-first law — the most urgent work first; the
 * undated tasks after the dated ones, then the oldest chains first). */
export interface PendingTaskRow {
  readonly stepInstanceId: string;
  readonly instanceId: string;
  readonly stepOrder: number;
  readonly triggerEntity: string;
  readonly triggerEntityId: string;
  readonly dueAt: string | null;
  readonly assignedAt: string;
}

export async function findPendingTasksForUser(
  userId: string,
  limit: number,
): Promise<readonly PendingTaskRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT si.id AS "stepInstanceId", si.instance_id AS "instanceId",
           si.step_order AS "stepOrder",
           wi.trigger_entity AS "triggerEntity", wi.trigger_entity_id AS "triggerEntityId",
           si.due_at::text AS "dueAt",
           wi.created_at::text AS "assignedAt"
    FROM workflow_step_instances si
    JOIN workflow_instances wi
      ON wi.id = si.instance_id AND wi.tenant_id = si.tenant_id
    WHERE si.tenant_id = erp.current_tenant_id()
      AND si.assignee_user_id = ${userId}
      AND si.step_type = 'TASK'
      AND si.status = 'PENDING'
      AND wi.status = 'ACTIVE'
    ORDER BY si.due_at ASC NULLS LAST, wi.created_at ASC, si.step_order ASC
    LIMIT ${limit}
  `);
  return rows.rows as unknown as PendingTaskRow[];
}

/** PHASE-052 (W-48 — T-11, dated 2026-11-28) THE APPROVALS INBOX'S OWN
 * QUERY: the CURRENT (the pointer's own) PENDING APPROVAL steps on
 * ACTIVE chains — the inbox's PENDING work with THE AGING FIGURES THE
 * DB'S OWN CLOCK COMPUTES (the engine-output law: `ageHours` and
 * `overdue` are computed inside the SQL at now(), rendered VERBATIM by
 * the board — zero client-side recomputation, zero JS wall clocks).
 * The pointer floor is the act path's own shape (only the current step
 * is actable — a future step never lists); the aging-first order is
 * the tasks lane's own law. */
export interface PendingApprovalRow {
  readonly stepInstanceId: string;
  readonly instanceId: string;
  readonly stepOrder: number;
  readonly triggerEntity: string;
  readonly triggerEntityId: string;
  readonly assigneeUserId: string;
  readonly dueAt: string | null;
  readonly assignedAt: string;
  readonly overdue: boolean;
  readonly ageHours: number;
}

export async function findPendingApprovalsForUser(
  userId: string,
  limit: number,
): Promise<readonly PendingApprovalRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT si.id AS "stepInstanceId", si.instance_id AS "instanceId",
           si.step_order AS "stepOrder",
           wi.trigger_entity AS "triggerEntity", wi.trigger_entity_id AS "triggerEntityId",
           si.assignee_user_id AS "assigneeUserId",
           si.due_at::text AS "dueAt",
           wi.created_at::text AS "assignedAt",
           (si.due_at IS NOT NULL AND si.due_at < now()) AS "overdue",
           (EXTRACT(EPOCH FROM (now() - wi.created_at)) / 3600)::int AS "ageHours"
    FROM workflow_step_instances si
    JOIN workflow_instances wi
      ON wi.id = si.instance_id AND wi.tenant_id = si.tenant_id
    WHERE si.tenant_id = erp.current_tenant_id()
      AND si.assignee_user_id = ${userId}
      AND si.step_type = 'APPROVAL'
      AND si.status = 'PENDING'
      AND wi.status = 'ACTIVE'
      AND wi.current_step_order = si.step_order
    ORDER BY si.due_at ASC NULLS LAST, wi.created_at ASC, si.step_order ASC
    LIMIT ${limit}
  `);
  return rows.rows as unknown as PendingApprovalRow[];
}

/** The DELEGATION LANE'S CANDIDATES (W-48 — D-07's own read side): the
 * CURRENT PENDING APPROVAL steps assigned to the given users (the
 * absent assignees whose active windows may route to the caller) —
 * the SERVICE resolves each candidate through the delegation chain
 * and keeps only the rows whose EFFECTIVE ACTOR is the caller (the
 * actor law's terminal — the inbox never lists a step its reader
 * cannot act on). */
export async function findPendingApprovalsForUsers(
  userIds: readonly string[],
  limit: number,
): Promise<readonly PendingApprovalRow[]> {
  if (userIds.length === 0) {
    return [];
  }
  const rows = await tenantTx().execute(sql`
    SELECT si.id AS "stepInstanceId", si.instance_id AS "instanceId",
           si.step_order AS "stepOrder",
           wi.trigger_entity AS "triggerEntity", wi.trigger_entity_id AS "triggerEntityId",
           si.assignee_user_id AS "assigneeUserId",
           si.due_at::text AS "dueAt",
           wi.created_at::text AS "assignedAt",
           (si.due_at IS NOT NULL AND si.due_at < now()) AS "overdue",
           (EXTRACT(EPOCH FROM (now() - wi.created_at)) / 3600)::int AS "ageHours"
    FROM workflow_step_instances si
    JOIN workflow_instances wi
      ON wi.id = si.instance_id AND wi.tenant_id = si.tenant_id
    WHERE si.tenant_id = erp.current_tenant_id()
      AND si.assignee_user_id IN (${sql.join(
        userIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      AND si.step_type = 'APPROVAL'
      AND si.status = 'PENDING'
      AND wi.status = 'ACTIVE'
      AND wi.current_step_order = si.step_order
    ORDER BY si.due_at ASC NULLS LAST, wi.created_at ASC, si.step_order ASC
    LIMIT ${limit}
  `);
  return rows.rows as unknown as PendingApprovalRow[];
}

/** One breached awaiting step, with the instance's own rendering facts
 * (the sweep's per-step world — the notification payload's own
 * material, joined ONCE per scan; the DB's OWN CLOCK decides the
 * breach inside the SQL, never a JS wall clock). */
export interface BreachedStepRow {
  readonly stepInstanceId: string;
  readonly instanceId: string;
  readonly stepOrder: number;
  readonly stepType: "APPROVAL" | "NOTIFICATION" | "TASK";
  readonly assigneeUserId: string;
  readonly dueAt: string;
  readonly triggerEntity: string;
  readonly triggerEntityId: string;
  readonly definitionSnapshot: unknown;
  /** The DB's own now() at the scan — the sweep's clock, read ONCE per
   * row by the same statement that decides the breach (the derived
   * step rides the same statement; the reminder thresholds derive
   * from THIS value + the row's due_at, never from Date.now()). */
  readonly dbNow: string;
}

/** THE BREACH SCAN (D-08 — the clock law verbatim): the awaiting
 * PENDING/DELEGATED step instances with a due_at the DATABASE'S OWN
 * CLOCK has passed, on ACTIVE chains only (a terminal instance's
 * frozen history never escalates — INV-037's own reading), bounded
 * per pass (the cmms precedent's 500), riding the 0128 partial index
 * ix_workflow_step_instances_tenant_due. */
export async function scanBreachedSteps(
  bound: number,
): Promise<readonly BreachedStepRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT si.id AS "stepInstanceId", si.instance_id AS "instanceId",
           si.step_order AS "stepOrder", si.step_type AS "stepType",
           si.assignee_user_id AS "assigneeUserId",
           si.due_at::text AS "dueAt",
           wi.trigger_entity AS "triggerEntity", wi.trigger_entity_id AS "triggerEntityId",
           wi.definition_snapshot AS "definitionSnapshot",
           now()::text AS "dbNow"
    FROM workflow_step_instances si
    JOIN workflow_instances wi
      ON wi.id = si.instance_id AND wi.tenant_id = si.tenant_id
    WHERE si.status IN ('PENDING', 'DELEGATED')
      AND si.due_at IS NOT NULL
      AND si.due_at < now()
      AND wi.status = 'ACTIVE'
    ORDER BY si.due_at, si.id
    LIMIT ${bound}
  `);
  return rows.rows as unknown as BreachedStepRow[];
}

/** One escalation_events row (the append-only sweep evidence — 0129 §2).
 * THE STRUCTURAL DEDUPE IS THE INDEX (the 0111/0123 axes law —
 * uq_escalation_events_dedupe on (tenant_id, step_instance_id, kind,
 * due_date)): the insert rides ON CONFLICT DO NOTHING, so re-runs, the
 * nightly cron, and a raced concurrent pass all CONVERGE — the second
 * pass inserts NOTHING and returns undefined (never a read-check
 * race). The caller hands the dedupe axis's own members; the row's
 * payload carries the action's own record. */
export async function insertEscalationEvent(input: {
  stepInstanceId: string;
  kind: "REASSIGN" | "ADD_LEVEL" | "NOTIFY" | "REMINDER";
  dueDate: string;
  payload: Record<string, unknown>;
}): Promise<{ id: string } | undefined> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO escalation_events (
      id, tenant_id, step_instance_id, kind, due_date, payload
    ) VALUES (
      ${generateUuidV7()}, erp.current_tenant_id(), ${input.stepInstanceId},
      ${input.kind}, ${input.dueDate}::date,
      ${JSON.stringify(input.payload)}::jsonb
    )
    ON CONFLICT (tenant_id, step_instance_id, kind, due_date) DO NOTHING
    RETURNING id
  `);
  return (rows.rows as unknown as { id: string }[])[0];
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
