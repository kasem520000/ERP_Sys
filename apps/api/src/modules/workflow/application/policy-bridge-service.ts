import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import type { WorkflowAuditRecorder, WorkflowTriggerEntity } from "./workflow-engine";
import { submitTransitionStatusFor } from "./workflow-engine";
import { WorkflowInputInvalidError } from "../domain/workflow-errors";

/**
 * PHASE-052 (W-46 — T-05, dated 2026-11-27) THE APPROVAL_POLICIES
 * BRIDGE (D-12 — the conversion + the compatibility mode + the parity
 * proof). The one-time launch-boundary tool that maps the tenant's
 * standing `approval_policies` rows to the workflow engine's
 * definitions + steps (the `origin_policy_id` back-reference on every
 * converted row):
 *
 *   none            → NO definition (the doc type stays ungated — the
 *                     mapping record's honest "no chain needed" row;
 *                     the legacy path byte-identical, including the
 *                     `none` mode's own submit-time auto-approval).
 *   single-approver → a one-step APPROVAL chain on the owner-role
 *                     assignee rule (D-12 verbatim).
 *   two-step        → the two-step chain (the manual_journals
 *                     approval_step semantics verbatim: two approval
 *                     acts — rendered as the chain's own two steps).
 *   amount-threshold→ THE BRANCH PAIR: one definition whose step 2
 *                     carries the entry condition `amountBase >
 *                     threshold` (the W-44 conditional-chain idiom) —
 *                     ≤ threshold the one-step chain (the branch's
 *                     SKIPPED stamp at trigger time), > threshold the
 *                     two-step chain; the at-limit comparison law
 *                     preserved (the strictly-greater branch — the
 *                     BR-034 compareExact boundary).
 *
 * THE DECLARED INTERPRETATIONS (recorded here — the launch boundary's
 * own readings):
 *   - THE LATEST ACTIVE POLICY per doc type converts (the row gating
 *     documents at the conversion boundary — the policyFor reading's
 *     own pick); the older active versions stay as the policy history
 *     (SUPERSEDED — not converted; they never gate a new submission
 *     again; an in-flight document finishes under the OLD semantics
 *     through the compatibility mode — the instance is never
 *     retro-created, the launch-time boundary).
 *   - THE OWNER-ROLE ASSIGNEE RULE (D-12 verbatim): the converted
 *     chains gate on the owner role — the approver class narrows to
 *     the owner (or the owner's delegation chain, D-07); the parity
 *     holds for the owner-class verdicts; the narrowing is the
 *     declared mapping semantics, recorded in the mapping record.
 *   - THE AMOUNT-THRESHOLD SEMANTICS (D-12's declared mapping): the
 *     legacy > threshold REFUSAL (APPROVAL_LIMIT_EXCEEDED — the
 *     single-step system's honest "needs a higher authority") becomes
 *     the second approval level (the branch pair's second step) —
 *     the phase doc §2's own exemplar scenario shape; the ≤ threshold
 *     verdicts are byte-identical.
 *   - THE DOC-TYPE MAPPING (the closed vocabulary): the policies
 *     registry's `journal_entry` is the manual_journal trigger's own
 *     doc type (the only policy consumer in the codebase); a doc type
 *     outside the mapping takes NO definition (the legacy path
 *     byte-identical — the honest UNMAPPED_DOC_TYPE row).
 *   - THE COEXISTENCE: the converted definitions join the register;
 *     the engine's deterministic precedence law ((created_at, name,
 *     id) — the FIRST matching active definition) governs any
 *     coexistence with hand-made chains.
 *   - THE IDEMPOTENCE: the origin_policy_id probe — a re-run of the
 *     tool inserts NOTHING (every already-converted policy reads
 *     ALREADY_CONVERTED; the convergence law, never a read-check
 *     race — the unique (tenant, name) floor backs the insert).
 *
 * LEDGER-FREE BY DESIGN (red line §6.3): the bridge converts gating
 * configuration; it posts nothing.
 */

/** The doc-type mapping (the closed vocabulary — the policies
 *  registry's doc types → the workflow trigger registry's members). */
const POLICY_DOC_TYPE_TO_TRIGGER: Record<string, WorkflowTriggerEntity> = {
  journal_entry: "manual_journal",
};

/** One conversion record — the mapping table's own row (the W-51
 *  completion report's declared table source). */
export interface PolicyConversionRecord {
  readonly policyId: string;
  readonly docType: string;
  readonly mode: string;
  readonly outcome:
    | "CONVERTED"
    | "NO_CHAIN_NEEDED"
    | "UNMAPPED_DOC_TYPE"
    | "SUPERSEDED"
    | "ALREADY_CONVERTED";
  readonly definitionId?: string;
  readonly steps?: number;
}

export interface PolicyConversionOutcome {
  readonly records: readonly PolicyConversionRecord[];
  readonly converted: number;
}

interface PolicyRow {
  readonly id: string;
  readonly docType: string;
  readonly policy: { mode?: string; threshold?: string | null; allowSelfApproval?: boolean };
  readonly appliesFrom: string;
  readonly isActive: boolean;
}

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the policy bridge requires an ambient tenant scope");
  }
  return context.tx;
}

/** THE THRESHOLD CANONICALIZATION (the policy's own shape → the
 * evaluator's canonical 4-dp operand): the policy write path validates
 * ^\d{1,15}(\.\d{1,4})?$ (the controller's zod); the bridge
 * re-canonicalizes the leading-zero class ("007" → "7.0000") and pads
 * the fraction; anything else is the typed refusal (fail-closed — a
 * malformed threshold never converts silently). */
function canonicalThreshold(raw: string): string {
  if (!/^\d{1,15}(\.\d{1,4})?$/.test(raw)) {
    throw new WorkflowInputInvalidError({
      field: "threshold",
      reason: `the amount-threshold policy's threshold must be the policy shape ^\\d{1,15}(\\.\\d{1,4})?$ (got ${JSON.stringify(raw)})`,
    });
  }
  const [int = "0", frac = ""] = raw.split(".");
  const intNorm = int.replace(/^0+(?=\d)/, "") || "0";
  return `${intNorm}.${(frac + "0000").slice(0, 4)}`;
}

export class PolicyBridgeService {
  constructor(private readonly audit: WorkflowAuditRecorder) {}

  /** THE ONE-TIME CONVERSION (the launch boundary's own tool): reads
   * the tenant's standing policies, maps the latest active row per doc
   * type through D-12's mapping, and lands the definitions + steps
   * with the origin_policy_id back-reference. Idempotent by
   * construction (a re-run converts nothing). */
  async convertPolicies(input: { actorId: string | null }): Promise<PolicyConversionOutcome> {
    if (!(await tenantHasWorkflowEngine())) {
      // The entitlement gate: no engine, no bridge — the policies keep
      // gating through the legacy path (the compatibility mode's own
      // permanent face for an unentitled tenant).
      return { records: [], converted: 0 };
    }
    const tx = tenantTx();

    // The standing policies (per doc type, applies_from DESC — the
    // latest first) + the already-converted set (the idempotence
    // probe over the origin back-references).
    const policyRows = await tx.execute(sql`
      SELECT id, doc_type AS "docType", policy, applies_from AS "appliesFrom", is_active AS "isActive"
      FROM approval_policies
      WHERE is_active
      ORDER BY doc_type, applies_from DESC, created_at DESC
    `);
    const policies = policyRows.rows as unknown as PolicyRow[];
    const convertedRows = await tx.execute(sql`
      SELECT origin_policy_id AS "originPolicyId" FROM workflow_definitions
      WHERE origin_policy_id IS NOT NULL
    `);
    const alreadyConverted = new Set(
      (convertedRows.rows as unknown as { originPolicyId: string }[]).map(
        (row) => row.originPolicyId,
      ),
    );

    const records: PolicyConversionRecord[] = [];
    const seenDocTypes = new Set<string>();
    for (const policy of policies) {
      // THE LATEST ACTIVE ROW per doc type is the one that gates (the
      // policyFor reading's own pick); the older actives are the
      // policy history (SUPERSEDED — never converted).
      const latest = !seenDocTypes.has(policy.docType);
      seenDocTypes.add(policy.docType);
      if (alreadyConverted.has(policy.id)) {
        records.push({
          policyId: policy.id, docType: policy.docType,
          mode: String(policy.policy?.mode ?? "unknown"), outcome: "ALREADY_CONVERTED",
        });
        continue;
      }
      if (!latest) {
        records.push({
          policyId: policy.id, docType: policy.docType,
          mode: String(policy.policy?.mode ?? "unknown"), outcome: "SUPERSEDED",
        });
        continue;
      }
      const trigger = POLICY_DOC_TYPE_TO_TRIGGER[policy.docType];
      if (trigger === undefined) {
        records.push({
          policyId: policy.id, docType: policy.docType,
          mode: String(policy.policy?.mode ?? "unknown"), outcome: "UNMAPPED_DOC_TYPE",
        });
        continue;
      }
      const mode = policy.policy?.mode;
      if (mode === "none") {
        // The honest no-chain row: the doc type stays ungated (the
        // legacy path byte-identical — including the none mode's own
        // submit-time auto-approval).
        records.push({
          policyId: policy.id, docType: policy.docType, mode, outcome: "NO_CHAIN_NEEDED",
        });
        continue;
      }
      if (mode !== "single-approver" && mode !== "two-step" && mode !== "amount-threshold") {
        throw new WorkflowInputInvalidError({
          field: "policy.mode",
          reason: `the policy ${policy.id} carries an unknown mode ${JSON.stringify(mode)} (the vocabulary is none · single-approver · two-step · amount-threshold)`,
        });
      }

      // THE DEFINITION (the branch pair's step conditions per D-12).
      const threshold =
        mode === "amount-threshold" ? canonicalThreshold(String(policy.policy?.threshold ?? "")) : null;
      if (mode === "amount-threshold" && threshold === null) {
        throw new WorkflowInputInvalidError({
          field: "policy.threshold",
          reason: `the amount-threshold policy ${policy.id} carries no threshold (the branch pair needs the boundary)`,
        });
      }
      const definitionId = generateUuidV7();
      const definitionName = `Policy bridge — ${policy.docType} (${mode}) [${policy.id.slice(0, 8)}]`;
      await tx.execute(sql`
        INSERT INTO workflow_definitions
          (id, tenant_id, name, name_ar, trigger_entity, trigger_event, active, conditions,
           origin_policy_id, created_by)
        VALUES (
          ${definitionId}, erp.current_tenant_id(), ${definitionName},
          ${`جسر السياسات — ${policy.docType} (${mode})`},
          ${trigger}, ${submitTransitionStatusFor(trigger)}, true, '{"all":[]}'::jsonb,
          ${policy.id}, ${input.actorId}
        )
      `);

      // THE EQUIVALENT STEPS (D-12's mapping — the owner-role assignee
      // rule; the amount-threshold's step 2 carries the branch
      // condition `amountBase > threshold`, the at-limit law).
      const stepCount = mode === "single-approver" ? 1 : 2;
      for (let stepOrder = 1; stepOrder <= stepCount; stepOrder += 1) {
        const isBranchStep = mode === "amount-threshold" && stepOrder === 2;
        const conditions = isBranchStep
          ? JSON.stringify({ all: [{ field: "amountBase", op: "gt", value: threshold }] })
          : '{"all":[]}';
        const name =
          stepOrder === 1
            ? { en: "Owner approval", ar: "موافقة المالك" }
            : mode === "amount-threshold"
              ? { en: "Second-level approval (above threshold)", ar: "موافقة المستوى الثاني (فوق الحد)" }
              : { en: "Owner approval — step 2", ar: "موافقة المالك — الخطوة الثانية" };
        await tx.execute(sql`
          INSERT INTO workflow_steps
            (id, tenant_id, definition_id, step_order, step_type, assignee_rule, assignee_value,
             conditions, sla_hours, name, name_ar, created_by)
          VALUES (
            ${generateUuidV7()}, erp.current_tenant_id(), ${definitionId}, ${stepOrder},
            'APPROVAL', 'ROLE', 'owner', ${conditions}::jsonb, NULL,
            ${name.en}, ${name.ar}, ${input.actorId}
          )
        `);
      }
      records.push({
        policyId: policy.id, docType: policy.docType, mode,
        outcome: "CONVERTED", definitionId, steps: stepCount,
      });
    }

    // THE SEAL — the conversion's own audit record (the mapping
    // record's provenance; the launch boundary's own stamp).
    const converted = records.filter((record) => record.outcome === "CONVERTED").length;
    await this.audit.record({
      action: "workflow.policies_converted",
      entityType: "workflow_policy_bridge",
      entityId: requireTenantContext().tenantId,
      actorId: input.actorId ?? undefined,
      after: { policies: records.length, converted },
    });
    return { records, converted };
  }
}

/** The bridge's own entitlement probe (the engine's base unit — an
 * unentitled tenant keeps the legacy path permanently; the bridge is
 * silent for it). */
async function tenantHasWorkflowEngine(): Promise<boolean> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("the policy bridge requires an ambient tenant scope");
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
