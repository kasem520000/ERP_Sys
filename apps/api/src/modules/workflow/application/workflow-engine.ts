import { sql } from "drizzle-orm";

import { multiplyExact } from "../../accounting/application/decimal-strings";
import { findValuesForEntity } from "../../configuration/infrastructure/custom-fields.store";
import { isCustomFieldEntity } from "../../configuration/domain/custom-fields-schema";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { InboxService } from "../../notifications/application/inbox-service";
import * as store from "../infrastructure/workflow.store";
import type { WorkflowStepInstanceRow } from "../infrastructure/workflow.store";
import {
  actOnStep,
  advancePointer,
  type InstanceShape,
  type StepInstanceShape,
  type WorkflowStepVerdict,
} from "../domain/instance-state-machine";
import {
  evaluateConditions,
  type WorkflowDocumentContext,
} from "../domain/condition-evaluator";
import type { WorkflowTriggerEntity } from "../domain/condition-evaluator";

export type { WorkflowTriggerEntity };
import {
  WorkflowAssigneeUnresolvableError,
  WorkflowInputInvalidError,
  WorkflowInstanceImmutableError,
  WorkflowStepAlreadyActedError,
} from "../domain/workflow-errors";
import { publishWorkflowEvent } from "./workflow-events";
import { assertNotSelfApproval } from "../domain/delegation-graph";
import { resolveEffectiveActor } from "../infrastructure/delegation-service";

/**
 * PHASE-052 (W-44 — T-03, dated 2026-11-27) THE WORKFLOW ENGINE CORE
 * (D-05/D-06/D-10/D-13 — the trigger resolution, the instance/step
 * state machine, the assignee notifications, the event bus). The pure
 * folds (W-43's domain layer) render every move; this engine is the
 * IO shell around them — the trade-engine precedent's own shape.
 *
 * THE GATEWAY CONTRACT (D-05 — the trade-order-gate pattern, the
 * documented plain-function surface in infrastructure/workflow-
 * gateway.ts): the four exemplar surfaces' own submit/approve/reject/
 * cancel acts call INTO the engine; the engine NEVER imports a bound
 * module (zero module coupling — the document facts arrive through
 * this file's own SQL over the ambient tenant scope).
 *
 * THE GATING LAW (red line §6.3 — the chains GATE the existing
 * submit/approve verdicts, they never replace them):
 *   - at submit: the chain OPENS alongside the module's own
 *     PENDING_APPROVAL/SUBMITTED transition (the vocabulary mapping
 *     law — each doc type's OWN submit-transition status);
 *   - at the module's approve act: the gateway routes the approval
 *     INTO the chain — the CURRENT step's assignee's act lands on the
 *     step instance; the module's own APPROVED transition proceeds
 *     ONLY when the chain COMPLETED (the final step's approval); a
 *     mid-chain approval leaves the document in its awaiting status
 *     (the typed WORKFLOW_CHAIN_STEPS_REMAIN refusal tells the module
 *     the verdict is not yet due);
 *   - at the module's reject act: the gateway records the rejection on
 *     the current step, the chain COMPLETES (the rejection is a
 *     terminal verdict — the remaining steps stand as the frozen
 *     history the timeline renders), the module's own rejection
 *     proceeds;
 *   - at the module's cancellation-class act: the chain CANCELS (the
 *     engine mirrors the module's verdict, never invents one).
 *
 * LEDGER-FREE BY DESIGN: the engine writes no journal entry, stamps
 * no posting — the movements/postings stay their modules' own.
 */

/** The workflow engine's own entitlement probe — the base unit flag
 * (0130 §5: business + enterprise compose it; the starter tenant's
 * declared neutral zero means NO engine, the legacy path
 * byte-identical — the compatibility mode's own reading). */
async function tenantHasWorkflowEngine(): Promise<boolean> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the workflow engine requires an ambient tenant scope");
  }
  const rows = await context.tx.execute(sql`
    SELECT 1 FROM entitlements
    WHERE tenant_id = erp.current_tenant_id()
      AND feature_key = 'workflow.engine'
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

// ── the document facts (the context assembly — D-06's own readers) ──

/** The per-entity submit-transition status (the vocabulary mapping
 * law — D-05: each doc type's OWN submit-transition status, never a
 * parallel vocabulary). */
export function submitTransitionStatusFor(
  triggerEntity: WorkflowTriggerEntity,
): "PENDING_APPROVAL" | "SUBMITTED" {
  switch (triggerEntity) {
    case "manual_journal":
    case "purchase_order":
      return "PENDING_APPROVAL";
    case "change_order":
    case "duty_drawback_claim":
      return "SUBMITTED";
  }
}

/** The document facts the notification payloads render (the doc's own
 * number; null where the module does not number before approval). */
export interface DocumentFacts {
  readonly docNo: string | null;
  readonly amountBase: string;
  readonly currency: string;
  readonly status: string;
  readonly createdBy: string | null;
  readonly native: Readonly<Record<string, string | number | boolean | null>>;
}

const CANONICAL_4DP = /^-?(0|[1-9][0-9]*)(\.[0-9]{1,4})?$/;

/** Canonicalize a numeric(19,4) string to the exact 4-dp shape (pg
 * returns the stored scale; the evaluator demands the canonical
 * string — ADR-0009's own law). */
function toCanonical4dp(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "0.0000";
  }
  const trimmed = value.trim();
  if (!CANONICAL_4DP.test(trimmed)) {
    throw new WorkflowInputInvalidError({
      field: "amountBase",
      reason: `the document amount is not the canonical numeric shape (got ${JSON.stringify(value)})`,
    });
  }
  const [intPart, fracPart = ""] = trimmed.split(".");
  return `${intPart}.${(fracPart + "0000").slice(0, 4)}`;
}

/** The four exemplar surfaces' own rows — the engine's direct reads
 * (zero module imports; the tables are the modules' own, read through
 * the ambient tenant scope with RLS as the safety net). The declared
 * interpretations:
 *   - manual_journal: the TOTAL BASE amount = Σ(line.amount ×
 *     exchange_rate) — the journal service's own totalBaseAmount law;
 *   - purchase_order: the base-converted gross (currency = base →
 *     gross; else gross × exchange_rate) — the BR-010 requiresApproval
 *     math verbatim;
 *   - change_order: price_delta (the base-currency figure by 0102's
 *     own design);
 *   - duty_drawback_claim: claimed_amount — THE CLAIM'S OWN FIGURE in
 *     the claim's currency (the currency is a NATIVE field the branch
 *     conditions discriminate on; the engine never fabricates an FX
 *     conversion — no rate column exists on the claim, the treasury
 *     revaluation plane is 053's). */
export async function readDocumentFacts(
  triggerEntity: WorkflowTriggerEntity,
  documentId: string,
): Promise<DocumentFacts> {
  const tx = requireTenantContext().tx!;
  switch (triggerEntity) {
    case "manual_journal": {
      const rows = await tx.execute(sql`
        SELECT j.currency_code AS currency, j.status, j.created_by AS "createdBy",
               j.entry_date AS "entryDate",
               COALESCE((SELECT SUM(l.amount * COALESCE(j.exchange_rate, 1))
                         FROM manual_journal_lines l
                         WHERE l.manual_journal_id = j.id AND l.tenant_id = j.tenant_id), 0)::text AS amount
        FROM manual_journals j
        WHERE j.id = ${documentId}
        LIMIT 1
      `);
      const row = (rows.rows as unknown as {
        currency: string; status: string; createdBy: string | null; entryDate: string; amount: string;
      }[])[0];
      if (row === undefined) {
        throw new WorkflowInputInvalidError({
          field: "documentId",
          reason: `manual journal ${documentId} not found (the chain trigger needs the document's own row)`,
        });
      }
      return {
        docNo: null,
        amountBase: toCanonical4dp(row.amount),
        currency: row.currency,
        status: row.status,
        createdBy: row.createdBy,
        native: { entryDate: row.entryDate, currency: row.currency, status: row.status },
      };
    }
    case "purchase_order": {
      const base = await ownTenantBaseCurrency();
      const rows = await tx.execute(sql`
        SELECT p.order_no AS "orderNo", p.currency_code AS currency, p.status,
               p.created_by AS "createdBy", p.order_date AS "orderDate", p.branch_id AS "branchId",
               p.total_gross::text AS "totalGross", p.exchange_rate::text AS "exchangeRate"
        FROM purchase_orders p
        WHERE p.id = ${documentId}
        LIMIT 1
      `);
      const row = (rows.rows as unknown as {
        orderNo: string | null; currency: string; status: string; createdBy: string | null;
        orderDate: string; branchId: string | null; totalGross: string; exchangeRate: string | null;
      }[])[0];
      if (row === undefined) {
        throw new WorkflowInputInvalidError({
          field: "documentId",
          reason: `purchase order ${documentId} not found (the chain trigger needs the document's own row)`,
        });
      }
      const amountBase =
        row.currency === base
          ? row.totalGross
          : multiplyExact(row.totalGross, row.exchangeRate ?? "1");
      return {
        docNo: row.orderNo,
        amountBase: toCanonical4dp(amountBase),
        currency: row.currency,
        status: row.status,
        createdBy: row.createdBy,
        native: {
          orderNo: row.orderNo, orderDate: row.orderDate, branchId: row.branchId,
          currency: row.currency, status: row.status,
        },
      };
    }
    case "change_order": {
      const rows = await tx.execute(sql`
        SELECT c.co_no AS "coNo", c.status, c.created_by AS "createdBy", c.project_id AS "projectId",
               c.price_delta::text AS "priceDelta"
        FROM change_orders c
        WHERE c.id = ${documentId}
        LIMIT 1
      `);
      const row = (rows.rows as unknown as {
        coNo: string | null; status: string; createdBy: string | null; projectId: string; priceDelta: string;
      }[])[0];
      if (row === undefined) {
        throw new WorkflowInputInvalidError({
          field: "documentId",
          reason: `change order ${documentId} not found (the chain trigger needs the document's own row)`,
        });
      }
      return {
        docNo: row.coNo,
        amountBase: toCanonical4dp(row.priceDelta),
        currency: "BASE",
        status: row.status,
        createdBy: row.createdBy,
        native: { coNo: row.coNo, projectId: row.projectId, status: row.status },
      };
    }
    case "duty_drawback_claim": {
      const rows = await tx.execute(sql`
        SELECT d.claim_no AS "claimNo", d.currency, d.status, d.created_by AS "createdBy",
               d.claimed_amount::text AS "claimedAmount"
        FROM duty_drawback_claims d
        WHERE d.id = ${documentId}
        LIMIT 1
      `);
      const row = (rows.rows as unknown as {
        claimNo: string; currency: string; status: string; createdBy: string | null; claimedAmount: string;
      }[])[0];
      if (row === undefined) {
        throw new WorkflowInputInvalidError({
          field: "documentId",
          reason: `duty drawback claim ${documentId} not found (the chain trigger needs the document's own row)`,
        });
      }
      return {
        docNo: row.claimNo,
        amountBase: toCanonical4dp(row.claimedAmount),
        currency: row.currency,
        status: row.status,
        createdBy: row.createdBy,
        native: { claimNo: row.claimNo, currency: row.currency, status: row.status },
      };
    }
  }
}

/** THE TRIGGER-ENTITY → 036-ENTITY-TYPE MAPPING (the declared
 * interpretation, W-44): the trigger registry's members are SINGULAR
 * (manual_journal, purchase_order — D-05's own vocabulary) while the
 * PHASE-036 entity registry keys are the table-plural forms
 * (purchase_orders). The mapping is explicit and closed — an entity
 * with no 036 registration reads NO custom fields (the readers are
 * never called for unregistered types; the branch conditions on
 * customFields.<key> see null for every key, the no-fabrication law). */
const TRIGGER_ENTITY_TO_036: Partial<Record<WorkflowTriggerEntity, string>> = {
  purchase_order: "purchase_orders",
};

/** The custom-field arm of the context — the PHASE-036 readers
 * VERBATIM (zero parallel computation): only the REGISTERED 036
 * entities read (purchase_orders today); the departmentId context is
 * the document's `department` custom field when the tenant defines
 * one (the platform carries no departments table — the custom-field
 * plane is the department's own substrate). */
async function readCustomFieldContext(
  triggerEntity: WorkflowTriggerEntity,
  documentId: string,
): Promise<{ customFields: Record<string, string | number | boolean | null>; departmentId: string | null }> {
  const entityType = TRIGGER_ENTITY_TO_036[triggerEntity];
  if (entityType === undefined || !isCustomFieldEntity(entityType)) {
    return { customFields: {}, departmentId: null };
  }
  const values = await findValuesForEntity(entityType, documentId);
  const customFields: Record<string, string | number | boolean | null> = {};
  for (const value of values) {
    const scalar =
      value.valueText ?? (value.valueNumber !== null ? Number(value.valueNumber) : null) ?? value.valueBoolean;
    customFields[value.fieldKey] = scalar === undefined ? null : scalar;
  }
  return { customFields, departmentId: (customFields["department"] as string | null) ?? null };
}

/** Assemble the D-06 document context ONCE per trigger (the evaluator
 * never re-reads anything). */
async function assembleDocumentContext(
  triggerEntity: WorkflowTriggerEntity,
  documentId: string,
): Promise<{ context: WorkflowDocumentContext; facts: DocumentFacts }> {
  const [facts, custom] = await Promise.all([
    readDocumentFacts(triggerEntity, documentId),
    readCustomFieldContext(triggerEntity, documentId),
  ]);
  return {
    context: {
      docType: triggerEntity,
      amountBase: facts.amountBase,
      departmentId: custom.departmentId,
      customFields: custom.customFields,
      native: { ...facts.native },
    },
    facts,
  };
}

// ── the assignee resolution (BR-055's family law: the engine never
//    invents an assignee — an unresolvable rule is a typed refusal,
//    fail-closed, never a fallback to the creator) ────────────────────

async function resolveAssignee(
  rule: "ROLE" | "USER" | "FIELD" | "FORMULA",
  value: string,
  facts: DocumentFacts,
  context: WorkflowDocumentContext,
): Promise<string> {
  switch (rule) {
    case "ROLE": {
      const holder = await store.findFirstActiveHolderOfRole(value);
      if (holder === undefined) {
        throw new WorkflowAssigneeUnresolvableError({
          rule,
          value,
          reason: `no ACTIVE membership holds the role key "${value}" in this tenant`,
        });
      }
      return holder;
    }
    case "USER": {
      if (!(await store.userHasActiveMembership(value))) {
        throw new WorkflowAssigneeUnresolvableError({
          rule,
          value,
          reason: `user ${value} holds no ACTIVE membership in this tenant`,
        });
      }
      return value;
    }
    case "FIELD": {
      // The document-derived field: the reference names a context field
      // (customFields.<key> / native.<key>) whose value is the assignee's
      // USER ID — the document names its own approver.
      let raw: string | number | boolean | null = null;
      if (value.startsWith("customFields.")) {
        raw = context.customFields[value.slice("customFields.".length)] ?? null;
      } else if (value.startsWith("native.")) {
        raw = context.native[value.slice("native.".length)] ?? null;
      } else {
        throw new WorkflowAssigneeUnresolvableError({
          rule,
          value,
          reason: "the FIELD rule names customFields.<fieldKey> or native.<key> (the document field carrying the assignee's user id)",
        });
      }
      if (typeof raw !== "string" || raw.length === 0) {
        throw new WorkflowAssigneeUnresolvableError({
          rule,
          value,
          reason: "the document field is unset or not a user id (the engine never invents an assignee)",
        });
      }
      if (!(await store.userHasActiveMembership(raw))) {
        throw new WorkflowAssigneeUnresolvableError({
          rule,
          value,
          reason: `the document field names user ${raw} who holds no ACTIVE membership in this tenant`,
        });
      }
      return raw;
    }
    case "FORMULA": {
      // THE CLOSED FORMULA VOCABULARY (the declared interpretation,
      // W-44 — the platform carries no employee-manager hierarchy, so
      // the phase doc's "owner's manager" class resolves through what
      // EXISTS; widenings are dated additive):
      //   document.creator — the submitted document's creator;
      //   tenant.owner     — the tenant's owner user.
      if (value === "document.creator") {
        if (facts.createdBy === null) {
          throw new WorkflowAssigneeUnresolvableError({
            rule, value,
            reason: "the document carries no creator (a system-seeded row)",
          });
        }
        return facts.createdBy;
      }
      if (value === "tenant.owner") {
        const owner = await store.findTenantOwnerUserId();
        if (owner === undefined) {
          throw new WorkflowAssigneeUnresolvableError({
            rule, value,
            reason: "the tenant carries no active owner membership",
          });
        }
        return owner;
      }
      throw new WorkflowAssigneeUnresolvableError({
        rule,
        value,
        reason: "the FORMULA vocabulary is document.creator | tenant.owner (widenings are dated additive)",
      });
    }
  }
}

// ── the assignee notifications (the inbox leg — the `workflow`
//    category, 0131's own writer) ─────────────────────────────────────

const DOC_LABELS: Record<WorkflowTriggerEntity, { en: string; ar: string }> = {
  manual_journal: { en: "Journal entry", ar: "قيد يومية" },
  purchase_order: { en: "Purchase order", ar: "أمر شراء" },
  change_order: { en: "Change order", ar: "أمر تغيير" },
  duty_drawback_claim: { en: "Duty drawback claim", ar: "طلب استرداد رسوم" },
};

function docDetailPath(triggerEntity: WorkflowTriggerEntity, documentId: string): string {
  switch (triggerEntity) {
    case "manual_journal":
      return `/accounting/journals?doc=${documentId}`;
    case "purchase_order":
      return `/purchasing/orders?doc=${documentId}`;
    case "change_order":
      return `/projects/contracting?doc=${documentId}`;
    case "duty_drawback_claim":
      return `/trade/drawbacks?doc=${documentId}`;
  }
}

/** One inbox record for the current step's assignee (the approval
 * request — the document's number + amount + the step's bilingual
 * name; the dedupe key the per-step-per-assignment axis). */
async function notifyAssignee(input: {
  inbox: InboxService;
  emailLeg: WorkflowEmailLeg | null | undefined;
  triggerEntity: WorkflowTriggerEntity;
  documentId: string;
  facts: DocumentFacts;
  stepName: string;
  stepNameAr: string;
  stepOrder: number;
  assigneeUserId: string;
  stepInstanceId: string;
  instanceId: string;
}): Promise<void> {
  const label = DOC_LABELS[input.triggerEntity];
  const docRef = input.facts.docNo ?? input.documentId.slice(0, 8);
  await input.inbox.record({
    category: "workflow",
    severity: "info",
    title: {
      en: `${label.en} awaiting your approval — step ${input.stepOrder}: ${input.stepName}`,
      ar: `${label.ar} بانتظار موافقتك — الخطوة ${input.stepOrder}: ${input.stepNameAr}`,
    },
    body: {
      en: `${label.en} ${docRef} (${input.facts.amountBase} ${input.facts.currency}) reached approval step ${input.stepOrder} (${input.stepName}) and is assigned to you. Approve or reject it from the document's approval surface.`,
      ar: `${label.ar} ${docRef} (${input.facts.amountBase} ${input.facts.currency}) وصل إلى خطوة الموافقة ${input.stepOrder} (${input.stepNameAr}) وهي مكلَّفة إليك. وافق عليها أو ارفضها من سطح الموافقة على المستند.`,
    },
    actionLabel: { ar: "مراجعة المستند", en: "Review document" },
    actionUrl: docDetailPath(input.triggerEntity, input.documentId),
    dedupeKey: `workflow:assign:${input.instanceId}:${input.stepOrder}`,
    userId: input.assigneeUserId,
  });
  if (input.emailLeg !== null && input.emailLeg !== undefined) {
    await input.emailLeg.enqueueStepAssignedMail({
      assigneeUserId: input.assigneeUserId,
      docLabelEn: label.en,
      docLabelAr: label.ar,
      docNo: input.facts.docNo ?? input.documentId.slice(0, 8),
      amountBase: input.facts.amountBase,
      currency: input.facts.currency,
      stepName: input.stepName,
      stepNameAr: input.stepNameAr,
      stepInstanceId: input.stepInstanceId,
      docUrl: docDetailPath(input.triggerEntity, input.documentId),
    });
  }
}

// ── the engine ───────────────────────────────────────────────────────

/** The chain-open outcome the gateway reports to the bound module:
 *  - chainOpened: false → NO active definition matched (the legacy
 *    path byte-identical — the compatibility mode);
 *  - chainOpened: true → the chain opened; the module's own
 *    submit-transition stands (the vocabulary mapping law). */
export interface ChainOpenOutcome {
  readonly chainOpened: boolean;
  readonly instanceId?: string;
}

/** The audit-recorder contract (the AuditService's own input shape —
 * the structural type keeps the engine constructible in the specs
 * with `new AuditService(new DrizzleAuditStore())`). */
export interface WorkflowAuditRecorder {
  record(event: {
    action: string;
    entityType: string;
    entityId: string;
    actorId?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  }): Promise<void>;
}

/** The email-leg contract (the 041 hub's template mail — the module
 * wires this to the EmailService; the specs may omit it: the inbox
 * leg alone is the engine's own floor, the email leg rides the
 * module's envelope). */
export interface WorkflowEmailLeg {
  enqueueStepAssignedMail(input: {
    assigneeUserId: string;
    docLabelEn: string;
    docLabelAr: string;
    docNo: string;
    amountBase: string;
    currency: string;
    stepName: string;
    stepNameAr: string;
    stepInstanceId: string;
    docUrl: string;
  }): Promise<void>;
}

export class WorkflowEngine {
  constructor(
    private readonly audit: WorkflowAuditRecorder,
    private readonly inbox: InboxService,
    private readonly emailLeg?: WorkflowEmailLeg | null,
  ) {}

  /** THE TRIGGER RESOLUTION (the submit hook's core): the entitlement
   * probe → the active definitions (deterministic order) → the FIRST
   * whose entry conditions hold (D-06, fail-closed) → the immutable
   * snapshot capture → the instance + step instances (the branch
   * evaluation's SKIPPED stamps, the assignee resolution, the SLA
   * due) → the notifications + the bus. */
  async openChain(input: {
    triggerEntity: WorkflowTriggerEntity;
    documentId: string;
    actorId: string | null;
  }): Promise<ChainOpenOutcome> {
    if (!(await tenantHasWorkflowEngine())) {
      return { chainOpened: false };
    }
    const { context, facts } = await assembleDocumentContext(input.triggerEntity, input.documentId);
    const definitions = await store.findActiveDefinitionsForTrigger(
      input.triggerEntity,
      submitTransitionStatusFor(input.triggerEntity),
    );
    let chosen: store.WorkflowDefinitionRow | undefined;
    for (const definition of definitions) {
      if (evaluateConditions(definition.conditions, context)) {
        chosen = definition;
        break;
      }
    }
    if (chosen === undefined) {
      return { chainOpened: false };
    }
    const steps = await store.findStepsForDefinition(chosen.id);
    if (steps.length === 0) {
      return { chainOpened: false };
    }

    // THE IMMUTABLE SNAPSHOT — the definition + its ordered steps,
    // captured at trigger time (a definition edited after trigger
    // NEVER rewrites a live instance).
    const snapshot = {
      definition: {
        id: chosen.id, name: chosen.name, nameAr: chosen.nameAr,
        triggerEntity: chosen.triggerEntity, triggerEvent: chosen.triggerEvent,
        conditions: chosen.conditions, originPolicyId: chosen.originPolicyId,
      },
      steps: steps.map((step) => ({
        stepOrder: step.stepOrder, stepType: step.stepType, name: step.name, nameAr: step.nameAr,
        assigneeRule: step.assigneeRule, assigneeValue: step.assigneeValue,
        conditions: step.conditions, slaHours: step.slaHours,
      })),
    };

    const now = new Date();
    const firstPending = steps.find(
      (step) => evaluateConditions(step.conditions, context),
    );
    const instance = await store.insertWorkflowInstance({
      definitionId: chosen.id,
      triggerEntity: input.triggerEntity,
      triggerEntityId: input.documentId,
      definitionSnapshot: snapshot,
      currentStepOrder: firstPending?.stepOrder ?? null,
      createdBy: input.actorId,
    });

    // The step instances: the branch-excluded steps take the SKIPPED
    // stamp (the branch's own verdict, no actor); the NOTIFICATION
    // steps fire-and-advance (the declared interpretation); the rest
    // resolve their assignees (fail-closed) and land PENDING with
    // their SLA due.
    let firstAssigned: { step: store.WorkflowStepRow; row: WorkflowStepInstanceRow } | null = null;
    for (const step of steps) {
      const branchHolds = evaluateConditions(step.conditions, context);
      if (!branchHolds) {
        await store.insertWorkflowStepInstance({
          instanceId: instance.id,
          stepOrder: step.stepOrder,
          stepType: step.stepType,
          assigneeUserId: await this.placeholderAssignee(step),
          status: "SKIPPED",
          dueAt: null,
          skipStampedAt: now.toISOString(),
          skipComment: "excluded by the step's branch conditions (the branch's own verdict — no actor)",
        });
        continue;
      }
      const assignee = await resolveAssignee(step.assigneeRule, step.assigneeValue, facts, context);
      const dueAt =
        step.slaHours === null
          ? null
          : new Date(now.getTime() + step.slaHours * 3_600_000).toISOString();
      const row = await store.insertWorkflowStepInstance({
        instanceId: instance.id,
        stepOrder: step.stepOrder,
        stepType: step.stepType,
        assigneeUserId: assignee,
        status: "PENDING",
        dueAt,
        skipStampedAt: null,
        skipComment: null,
      });
      if (firstAssigned === null && step.stepOrder === firstPending?.stepOrder) {
        firstAssigned = { step, row };
      }
    }

    // THE BUS FIRST (the lifecycle order: instance.started precedes
    // every step.assigned — the emission order is the event contract's
    // own shape, the 055 handoff surface's documented sequence).
    await this.audit.record({
      action: "workflow.chain_opened",
      entityType: input.triggerEntity,
      entityId: input.documentId,
      actorId: input.actorId ?? undefined,
      after: { instanceId: instance.id, definition: chosen.name, steps: steps.length },
    });
    const tenantId = requireTenantContext().tenantId;
    publishWorkflowEvent({
      type: "workflow.instance.started",
      tenantId, instanceId: instance.id,
      triggerEntity: input.triggerEntity, triggerEntityId: input.documentId,
      definitionId: chosen.id,
    });

    // THE FIRE-AND-ADVANCE for a NOTIFICATION first step (the declared
    // interpretation): its inbox record lands, the step takes the
    // engine's own SKIPPED stamp, the pointer moves to the next
    // actionable step.
    let currentStepOrder = firstPending?.stepOrder ?? null;
    if (firstAssigned !== null && firstAssigned.step.stepType === "NOTIFICATION") {
      await notifyAssignee({
        inbox: this.inbox,
        emailLeg: this.emailLeg,
        triggerEntity: input.triggerEntity,
        documentId: input.documentId,
        facts,
        stepName: firstAssigned.step.name,
        stepNameAr: firstAssigned.step.nameAr,
        stepOrder: firstAssigned.step.stepOrder,
        assigneeUserId: firstAssigned.row.assigneeUserId,
        stepInstanceId: firstAssigned.row.id,
        instanceId: instance.id,
      });
      await store.stampNotificationStepFired({
        stepInstanceId: firstAssigned.row.id,
        firedAt: now.toISOString(),
        comment: "notification delivered (the engine's own progression — no user act required)",
      });
      const stepRows = await store.findStepInstancesForInstance(instance.id);
      currentStepOrder = advancePointer(
        stepRows.map(toStepShape),
        firstAssigned.step.stepOrder,
      );
      if (currentStepOrder === null) {
        // A pure-NOTIFICATION chain: it completes at open (the pointer
        // walked past its only step) — the document's own verdict path
        // stands ungated (the chain's job was the notification).
        await store.stampInstanceTerminal({
          instanceId: instance.id,
          status: "COMPLETED",
          completedAt: now.toISOString(),
        });
      } else {
        await store.updateInstancePointer({ instanceId: instance.id, currentStepOrder });
        await this.announceAssignment(instance.id, input.triggerEntity, input.documentId, facts, snapshot, stepRows);
      }
    } else if (firstAssigned !== null) {
      await this.announceAssignment(instance.id, input.triggerEntity, input.documentId, facts, snapshot, await store.findStepInstancesForInstance(instance.id));
    }
    return { chainOpened: true, instanceId: instance.id };
  }

  /** The placeholder assignee for a branch-SKIPPED step (assignee_user_id
   * is NOT NULL at the floor): the rule's value resolves best-effort —
   * a ROLE/USER/FIELD/FORMULA that does not resolve at trigger time is
   * NOT a failure for an excluded step (the branch already excluded
   * it; the row is the frozen history) — the tenant owner stands in,
   * and an ownerless tenant takes the typed refusal (never a fabricated
   * uuid). */
  private async placeholderAssignee(step: store.WorkflowStepRow): Promise<string> {
    try {
      return await resolveAssignee(step.assigneeRule, step.assigneeValue, {
        docNo: null, amountBase: "0.0000", currency: "BASE", status: "SKIPPED", createdBy: null,
        native: {},
      }, {
        docType: "purchase_order", amountBase: "0.0000", departmentId: null, customFields: {}, native: {},
      });
    } catch {
      const owner = await store.findTenantOwnerUserId();
      if (owner === undefined) {
        throw new WorkflowAssigneeUnresolvableError({
          rule: step.assigneeRule, value: step.assigneeValue,
          reason: "the branch-excluded step's rule does not resolve AND the tenant carries no owner to stand in (the assignee column is NOT NULL at the floor)",
        });
      }
      return owner;
    }
  }

  /** The current step's assignment announcement — the inbox record +
  * the bus event (the pointer just reached this step). */
  private async announceAssignment(
    instanceId: string,
    triggerEntity: WorkflowTriggerEntity,
    documentId: string,
    facts: DocumentFacts,
    snapshot: { steps: readonly { stepOrder: number; name: string; nameAr: string }[] },
    stepRows: readonly WorkflowStepInstanceRow[],
  ): Promise<void> {
    const instance = await store.findInstanceById(instanceId);
    if (instance === undefined || instance.status !== "ACTIVE" || instance.currentStepOrder === null) {
      return;
    }
    const current = stepRows.find((row) => row.stepOrder === instance.currentStepOrder);
    if (current === undefined || current.status !== "PENDING") {
      return;
    }
    const stepMeta = snapshot.steps.find((step) => step.stepOrder === current.stepOrder);
    await notifyAssignee({
      inbox: this.inbox,
      emailLeg: this.emailLeg,
      triggerEntity, documentId, facts,
      stepName: stepMeta?.name ?? `Step ${current.stepOrder}`,
      stepNameAr: stepMeta?.nameAr ?? `الخطوة ${current.stepOrder}`,
      stepOrder: current.stepOrder,
      assigneeUserId: current.assigneeUserId,
      stepInstanceId: current.id,
      instanceId,
    });
    const tenantId = requireTenantContext().tenantId;
    publishWorkflowEvent({
      type: "workflow.step.assigned",
      tenantId, instanceId,
      stepInstanceId: current.id, stepOrder: current.stepOrder,
      assigneeUserId: current.assigneeUserId,
    });
  }

  /** THE ACT SERVICE (the gateway's verdict path + the inbox/deep-link
   * surfaces' own act): approve/reject the CURRENT step — the state
   * machine fold renders the move; the pointer advances (firing
   * NOTIFICATION steps along the way); the chain COMPLETES on the
   * final approval or any rejection; the next assignee is notified.
   * Returns the chain's live state for the gateway's contract
   * (completedSteps — the APPROVED step count at the terminal verdict,
   * the bridge's approval_step parity figure, W-46). */
  async actOnCurrentStep(input: {
    instance: store.WorkflowInstanceRow;
    actorId: string;
    verdict: WorkflowStepVerdict;
    comment: string | null;
    facts: DocumentFacts;
  }): Promise<{ completed: boolean; remaining: number; currentStepOrder: number | null; completedSteps: number }> {
    const instance = input.instance;
    if (instance.status !== "ACTIVE" || instance.currentStepOrder === null) {
      throw new WorkflowInstanceImmutableError({
        instanceId: instance.id, status: instance.status, completedAt: instance.completedAt ?? "",
      });
    }
    const stepRows = await store.findStepInstancesForInstance(instance.id);
    const current = stepRows.find((row) => row.stepOrder === instance.currentStepOrder);
    if (current === undefined) {
      throw new WorkflowInputInvalidError({
        field: "currentStepOrder",
        reason: `instance ${instance.id} points at step ${instance.currentStepOrder} which has no row (the frozen history is inconsistent)`,
      });
    }
    // THE DELEGATION RESOLUTION (W-45, D-07 — the act-time law): the
    // assignee's ACTIVE in-scope windows at the moment of the act
    // re-route the step — the effective actor is the resolution chain's
    // terminal (the DB's own clock bounds the windows; the expired ones
    // never enter the edge set, so they stop routing by construction).
    const delegation = await resolveEffectiveActor({
      triggerEntity: instance.triggerEntity,
      assigneeUserId: current.assigneeUserId,
    });
    // G-67 (THE GOLDEN — the reserved wording): an actor cannot approve
    // their OWN document through a delegation chain — directly or
    // transitively. The EFFECTIVE actor (the resolution chain's
    // terminal) is checked against the document's creator; the typed
    // block names the chain and BOTH endpoints. The BR-034 default-OFF
    // discipline stands: allowSelfApproval never flips without an
    // explicit tenant decision record (the bridge's own surface, W-46 —
    // the engine reads NO policy, the standing default is OFF).
    if (input.facts.createdBy !== null) {
      assertNotSelfApproval({
        documentCreatorId: input.facts.createdBy,
        stepAssigneeId: current.assigneeUserId,
        edges: delegation.edges,
        allowSelfApproval: false,
      });
    }
    // THE ACTOR LAW (the W-44 floor, widened by the delegation plane):
    // the acting user is the assignee himself OR the resolution chain's
    // terminal (the delegate exercising the absent user's authority);
    // every other user is refused (the typed refusal names the assignee).
    const actedThroughDelegate =
      input.actorId !== current.assigneeUserId ? input.actorId : null;
    if (input.actorId !== current.assigneeUserId && input.actorId !== delegation.effectiveActorId) {
      throw new WorkflowStepAlreadyActedError({
        stepInstanceId: current.id,
        status: `assigned to ${current.assigneeUserId} (routed to ${delegation.effectiveActorId}; not the acting user)`,
      });
    }
    const now = new Date();
    const acted = actOnStep(toStepShape(current), {
      actorId: input.actorId ?? undefined,
      at: now.toISOString(),
      verdict: input.verdict,
      comment: input.comment ?? undefined,
    });
    const stamped = await store.stampStepActed({
      stepInstanceId: current.id,
      status: acted.status as "APPROVED" | "REJECTED",
      actedAt: now.toISOString(),
      actedBy: input.actorId,
      comment: acted.comment,
      actedThroughDelegate: actedThroughDelegate,
    });
    if (stamped === undefined) {
      throw new WorkflowStepAlreadyActedError({ stepInstanceId: current.id, status: current.status });
    }

    const tenantId = requireTenantContext().tenantId;
    publishWorkflowEvent({
      type: input.verdict === "APPROVE" ? "workflow.step.approved" : "workflow.step.rejected",
      tenantId, instanceId: instance.id, stepInstanceId: current.id,
      stepOrder: current.stepOrder, actorId: input.actorId ?? undefined,
    });
    await this.audit.record({
      action: input.verdict === "APPROVE" ? "workflow.step_approved" : "workflow.step_rejected",
      entityType: instance.triggerEntity,
      entityId: instance.triggerEntityId,
      actorId: input.actorId ?? undefined,
      before: { stepOrder: current.stepOrder, status: current.status },
      after: { stepOrder: current.stepOrder, status: acted.status, comment: input.comment },
    });

    // THE TERMINAL VERDICTS: a REJECTION completes the chain (the
    // remaining steps stand as the frozen history); the final APPROVAL
    // completes it when the pointer runs past the last actionable step.
    if (input.verdict === "REJECT") {
      await store.stampInstanceTerminal({
        instanceId: instance.id, status: "COMPLETED", completedAt: now.toISOString(),
      });
      publishWorkflowEvent({
        type: "workflow.instance.completed", tenantId, instanceId: instance.id,
        triggerEntity: instance.triggerEntity, triggerEntityId: instance.triggerEntityId,
        verdict: "REJECTED",
      });
      await this.audit.record({
        action: "workflow.chain_completed",
        entityType: instance.triggerEntity,
        entityId: instance.triggerEntityId,
        actorId: input.actorId ?? undefined,
        after: { instanceId: instance.id, verdict: "REJECTED" },
      });
      return {
        completed: true,
        remaining: 0,
        currentStepOrder: null,
        completedSteps: await countApprovedSteps(instance.id),
      };
    }

    // THE POINTER WALK: advance past the acted step, firing NOTIFICATION
    // steps as the pointer reaches them (fire-and-advance).
    let pointer: number | null = current.stepOrder;
    const stepRowsNow = await store.findStepInstancesForInstance(instance.id);
    pointer = advancePointer(stepRowsNow.map(toStepShape), current.stepOrder);
    while (pointer !== null) {
      const row = stepRowsNow.find((candidate) => candidate.stepOrder === pointer);
      if (row === undefined) {
        break;
      }
      if (row.stepType === "NOTIFICATION" && row.status === "PENDING") {
        const snapshot = instance.definitionSnapshot as {
          steps: readonly { stepOrder: number; name: string; nameAr: string }[];
        };
        const meta = snapshot.steps.find((step) => step.stepOrder === row.stepOrder);
        await notifyAssignee({
          inbox: this.inbox,
          emailLeg: this.emailLeg,
          triggerEntity: instance.triggerEntity as WorkflowTriggerEntity,
          documentId: instance.triggerEntityId,
          facts: input.facts,
          stepName: meta?.name ?? `Step ${row.stepOrder}`,
          stepNameAr: meta?.nameAr ?? `الخطوة ${row.stepOrder}`,
          stepOrder: row.stepOrder,
          assigneeUserId: row.assigneeUserId,
          stepInstanceId: row.id,
          instanceId: instance.id,
        });
        await store.stampNotificationStepFired({
          stepInstanceId: row.id,
          firedAt: now.toISOString(),
          comment: "notification delivered (the engine's own progression — no user act required)",
        });
        pointer = advancePointer((await store.findStepInstancesForInstance(instance.id)).map(toStepShape), row.stepOrder);
        continue;
      }
      break;
    }

    if (pointer === null) {
      await store.stampInstanceTerminal({
        instanceId: instance.id, status: "COMPLETED", completedAt: now.toISOString(),
      });
      publishWorkflowEvent({
        type: "workflow.instance.completed", tenantId, instanceId: instance.id,
        triggerEntity: instance.triggerEntity, triggerEntityId: instance.triggerEntityId,
        verdict: "APPROVED",
      });
      await this.audit.record({
        action: "workflow.chain_completed",
        entityType: instance.triggerEntity,
        entityId: instance.triggerEntityId,
        actorId: input.actorId ?? undefined,
        after: { instanceId: instance.id, verdict: "APPROVED" },
      });
      return {
        completed: true,
        remaining: 0,
        currentStepOrder: null,
        completedSteps: await countApprovedSteps(instance.id),
      };
    }

    await store.updateInstancePointer({ instanceId: instance.id, currentStepOrder: pointer });
    const remaining = (await store.findStepInstancesForInstance(instance.id)).filter(
      (row) => row.stepOrder >= pointer && row.status === "PENDING",
    ).length;
    await this.announceAssignment(
      instance.id,
      instance.triggerEntity as WorkflowTriggerEntity,
      instance.triggerEntityId,
      input.facts,
      instance.definitionSnapshot as { steps: readonly { stepOrder: number; name: string; nameAr: string }[] },
      await store.findStepInstancesForInstance(instance.id),
    );
    return { completed: false, remaining, currentStepOrder: pointer, completedSteps: 0 };
  }

  /** THE CANCELLATION MIRROR (the module's own cancellation-class
   * verdict): the ACTIVE chain cancels — the engine mirrors the
   * module, never invents one; the pending steps stand as the frozen
   * history. */
  async cancelChain(input: {
    triggerEntity: WorkflowTriggerEntity;
    documentId: string;
    actorId: string | null;
    reason: string;
  }): Promise<void> {
    if (!(await tenantHasWorkflowEngine())) {
      return;
    }
    const instance = await store.findActiveInstanceForDocument(input.triggerEntity, input.documentId);
    if (instance === undefined) {
      return;
    }
    const now = new Date();
    await store.stampInstanceTerminal({
      instanceId: instance.id, status: "CANCELLED", completedAt: now.toISOString(),
    });
    await this.audit.record({
      action: "workflow.chain_cancelled",
      entityType: input.triggerEntity,
      entityId: input.documentId,
      actorId: input.actorId ?? undefined,
      after: { instanceId: instance.id, reason: input.reason },
    });
    publishWorkflowEvent({
      type: "workflow.instance.cancelled",
      tenantId: requireTenantContext().tenantId,
      instanceId: instance.id,
      triggerEntity: input.triggerEntity,
      triggerEntityId: input.documentId,
    });
  }
}

/** The step-instance row → the fold's own shape. */
function toStepShape(row: WorkflowStepInstanceRow): StepInstanceShape {
  return {
    stepInstanceId: row.id,
    stepOrder: row.stepOrder,
    stepType: row.stepType,
    assigneeUserId: row.assigneeUserId,
    status: row.status,
    delegatedTo: row.delegatedTo,
    actedAt: row.actedAt,
    actedBy: row.actedBy,
    comment: row.comment,
  };
}

/** The chain's APPROVED step count at a terminal verdict (the bridge's
 * approval_step parity figure, W-46 — the actionable steps that were
 * acted with an approval; the SKIPPED branch stamps never count, the
 * frozen PENDING tail of a rejection never counts). */
async function countApprovedSteps(instanceId: string): Promise<number> {
  const rows = await store.findStepInstancesForInstance(instanceId);
  return rows.filter((row) => row.status === "APPROVED").length;
}

/** The instance row → the fold's own shape (the completion fold's
 * input). */
export function toInstanceShape(row: store.WorkflowInstanceRow): InstanceShape {
  return {
    instanceId: row.id,
    status: row.status,
    currentStepOrder: row.currentStepOrder,
    completedAt: row.completedAt,
  };
}
