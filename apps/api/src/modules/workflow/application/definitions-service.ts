import { sql } from "drizzle-orm";

import type { WorkflowAuditRecorder } from "./workflow-engine";
import { submitTransitionStatusFor } from "./workflow-engine";
import { validateWorkflowDefinitionInput } from "../domain/definition-input";
import type { DefinitionInput } from "../domain/definition-input";
export type { DefinitionInput } from "../domain/definition-input";
import * as store from "../infrastructure/workflow.store";
import { WorkflowInputInvalidError } from "../domain/workflow-errors";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-052 (W-48 — T-10, dated 2026-11-28) THE DEFINITIONS SERVICE (the
 * chain editor's own backend): the list/create/update over the
 * definition register (0127) — the form-first editor's writes land
 * through the PURE VALIDATION FOLD FIRST (the definition-input fold —
 * the save-time structural face of the D-06 tree; a malformed chain is
 * the typed refusal BEFORE it ever gates a document), then the store's
 * ambient-transaction writes (the definition + its steps together; an
 * edit NEVER touches a live instance — the snapshots are frozen,
 * D-02's own law), and THE AUDIT-FIRST LAW at every write
 * (workflow.definition_created / workflow.definition_updated — the
 * same ambient seal the engine's transitions carry).
 *
 * THE LIFECYCLE LAW (0127 §3's own evidence discipline): definitions
 * are NEVER deleted — deactivation via the active flag is the path
 * (the register is audited configuration; the immutable snapshots
 * make every historical definition the timeline's own frozen source).
 * The trigger entity + event are IMMUTABLE after create (the mapping
 * law: a definition bound to a document type never re-binds — a new
 * binding is a new definition).
 */

/** The editor's list row: the definition + its ordered steps (the
 * composed read — the register the form-first editor renders). */
export interface WorkflowDefinitionView {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string;
  readonly triggerEntity: string;
  readonly triggerEvent: string;
  readonly active: boolean;
  readonly conditions: unknown;
  readonly originPolicyId: string | null;
  readonly steps: readonly {
    readonly id: string;
    readonly stepOrder: number;
    readonly stepType: "APPROVAL" | "NOTIFICATION" | "TASK";
    readonly assigneeRule: "ROLE" | "USER" | "FIELD" | "FORMULA";
    readonly assigneeValue: string;
    readonly conditions: unknown;
    readonly slaHours: number | null;
    readonly name: string;
    readonly nameAr: string;
  }[];
}

export class WorkflowDefinitionsService {
  constructor(private readonly audit: WorkflowAuditRecorder) {}

  /** THE EDITOR'S LIST — every definition (active AND inactive) with
   * its ordered steps, composed in one pass. */
  async list(): Promise<readonly WorkflowDefinitionView[]> {
    requireTenantContext();
    const [definitions, steps] = await Promise.all([
      store.listWorkflowDefinitions(),
      store.listWorkflowSteps(),
    ]);
    const byDefinition = new Map<string, store.WorkflowStepRow[]>();
    for (const step of steps) {
      const bucket = byDefinition.get(step.definitionId);
      if (bucket === undefined) {
        byDefinition.set(step.definitionId, [step]);
      } else {
        bucket.push(step);
      }
    }
    return definitions.map((definition) => ({
      id: definition.id,
      name: definition.name,
      nameAr: definition.nameAr,
      triggerEntity: definition.triggerEntity,
      triggerEvent: definition.triggerEvent,
      active: definition.active,
      conditions: definition.conditions,
      originPolicyId: definition.originPolicyId,
      steps: (byDefinition.get(definition.id) ?? []).map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        stepType: step.stepType,
        assigneeRule: step.assigneeRule,
        assigneeValue: step.assigneeValue,
        conditions: step.conditions,
        slaHours: step.slaHours,
        name: step.name,
        nameAr: step.nameAr,
      })),
    }));
  }

  /** THE CREATE — the validation fold FIRST (the typed refusals naming
   * the field/condition BY PATH), then the ambient write + the audit
   * seal. The duplicate name is the DB's own UNIQUE floor (the typed
   * wrap, never a raw 23505 leak). */
  async create(input: {
    readonly actorId: string;
    readonly body: DefinitionInput;
  }): Promise<WorkflowDefinitionView> {
    requireTenantContext();
    const validated = validateWorkflowDefinitionInput(input.body, submitTransitionStatusFor);
    let row: store.WorkflowDefinitionRow;
    try {
      row = await store.insertWorkflowDefinition({
        name: validated.name,
        nameAr: validated.nameAr,
        triggerEntity: validated.triggerEntity,
        triggerEvent: validated.triggerEvent,
        active: validated.active,
        conditions: validated.conditions,
        actorId: input.actorId,
        steps: validated.steps,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("uq_workflow_definitions_tenant_name")) {
        throw new WorkflowInputInvalidError({
          field: "name",
          reason: `a definition named "${validated.name}" already exists (the register's names are unique per tenant)`,
        });
      }
      throw error;
    }
    await this.audit.record({
      action: "workflow.definition_created",
      entityType: "workflow_definition",
      entityId: row.id,
      actorId: input.actorId,
      after: {
        name: row.name,
        triggerEntity: row.triggerEntity,
        triggerEvent: row.triggerEvent,
        active: row.active,
        steps: validated.steps.length,
      },
    });
    const steps = await store.findStepsForDefinition(row.id);
    return toView(row, steps);
  }

  /** THE UPDATE — the same fold over the editor's new body; the
   * trigger entity + event are IMMUTABLE (a re-bind is a new
   * definition — the typed refusal names the field); the steps are
   * REPLACED in the same ambient transaction; the audit seal carries
   * the change's own shape. */
  async update(input: {
    readonly actorId: string;
    readonly definitionId: string;
    readonly body: DefinitionInput;
  }): Promise<WorkflowDefinitionView> {
    requireTenantContext();
    const existing = await store.listWorkflowDefinitions();
    const before = existing.find((definition) => definition.id === input.definitionId);
    if (before === undefined) {
      throw new WorkflowInputInvalidError({
        field: "definitionId",
        reason: `the definition ${input.definitionId} does not exist (deactivation is the path — definitions are never deleted)`,
      });
    }
    if (before.triggerEntity !== input.body.triggerEntity) {
      throw new WorkflowInputInvalidError({
        field: "triggerEntity",
        reason: `the trigger binding is immutable after create (the definition binds ${before.triggerEntity}; a new binding is a new definition)`,
      });
    }
    const validated = validateWorkflowDefinitionInput(input.body, submitTransitionStatusFor);
    if (validated.triggerEvent !== before.triggerEvent) {
      // Cannot happen (the event is derived from the immutable entity) —
      // the guard is the literal-truth floor, never a silent pass.
      throw new WorkflowInputInvalidError({
        field: "triggerEntity",
        reason: "the derived trigger event moved under an immutable binding (the derived mapping law)",
      });
    }
    let row: store.WorkflowDefinitionRow | undefined;
    try {
      row = await store.updateWorkflowDefinition(input.definitionId, {
        name: validated.name,
        nameAr: validated.nameAr,
        active: validated.active,
        conditions: validated.conditions,
        actorId: input.actorId,
        steps: validated.steps,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes("uq_workflow_definitions_tenant_name")) {
        throw new WorkflowInputInvalidError({
          field: "name",
          reason: `a definition named "${validated.name}" already exists (the register's names are unique per tenant)`,
        });
      }
      throw error;
    }
    if (row === undefined) {
      throw new WorkflowInputInvalidError({
        field: "definitionId",
        reason: `the definition ${input.definitionId} does not exist (it may have been deactivated underfoot)`,
      });
    }
    await this.audit.record({
      action: "workflow.definition_updated",
      entityType: "workflow_definition",
      entityId: row.id,
      actorId: input.actorId,
      before: { name: before.name, active: before.active },
      after: {
        name: row.name,
        active: row.active,
        steps: validated.steps.length,
      },
    });
    const steps = await store.findStepsForDefinition(row.id);
    return toView(row, steps);
  }
}

function toView(
  row: store.WorkflowDefinitionRow,
  steps: readonly store.WorkflowStepRow[],
): WorkflowDefinitionView {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.nameAr,
    triggerEntity: row.triggerEntity,
    triggerEvent: row.triggerEvent,
    active: row.active,
    conditions: row.conditions,
    originPolicyId: row.originPolicyId,
    steps: steps.map((step) => ({
      id: step.id,
      stepOrder: step.stepOrder,
      stepType: step.stepType,
      assigneeRule: step.assigneeRule,
      assigneeValue: step.assigneeValue,
      conditions: step.conditions,
      slaHours: step.slaHours,
      name: step.name,
      nameAr: step.nameAr,
    })),
  };
}

/** The engine-flag probe (the graceful direction — the definitions
 * plane rides the composable `workflow.definitions` unit, 0130 §5; the
 * controller's @RequireFeature is the enforcement face, this read the
 * service's own honest gate for direct callers). */
export async function tenantHasDefinitionsPlane(): Promise<boolean> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the definitions service requires an ambient tenant scope");
  }
  const probed = await context.tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'workflow.definitions'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (probed.rows as unknown as unknown[]).length > 0;
}
