import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";

import { requireTenantContext, type TenantContext } from "../../../../infra/db/tenant-context";

/**
 * PHASE-052 (W-49 — T-14, dated 2026-11-28) · the workflow query surface
 * for the two workflow report contracts (registry/workflow/):
 * `workflow.pending-approvals` · `workflow.sla-aging` — the registry
 * query-service convention (the 042 manufacturing / 044 WMS / 048
 * projects / 049 CMMS / 050 quality / 051 trade pattern verbatim):
 * read-only over the ambient tenant transaction, composing the
 * workflow module's OWN reads VERBATIM (the inbox's pointer-step
 * APPROVAL query with the aging figures the DB's own clock computes —
 * the W-48 inbox law; the escalation plane's awaiting-steps + events
 * reads — the W-45 sweep's own shapes), zero parallel computation.
 *
 * THE CLOCK LAW (the escalation sweep's own, W-45): every aging figure
 * — the age hours, the over-due hours, the breach verdicts — is
 * computed INSIDE the SQL at the database's own now(), never a JS wall
 * clock (no Date.now() anywhere in this file).
 */

/** One pending-approvals row: the inbox's own figures at the TENANT
 * register's breadth (the report is the manager's view: every pending
 * current APPROVAL step with its assignee, its age at the DB's own
 * clock, and the document drill facts). */
export interface WorkflowPendingApprovalsRow {
  readonly stepInstanceId: string;
  readonly instanceId: string;
  readonly triggerEntity: string;
  readonly documentId: string;
  readonly stepOrder: number;
  readonly stepName: string;
  readonly stepNameAr: string;
  readonly assigneeUserId: string;
  readonly assigneeName: string | null;
  readonly dueAt: string | null;
  readonly assignedAt: string;
  readonly overdue: boolean;
  readonly ageHours: number;
  readonly documentNo: string | null;
  readonly amountBase: string;
  readonly currency: string;
}

/** One SLA-aging row: the escalation plane's own figures — every
 * awaiting step that carries an SLA (due_at not null), with the hours
 * over due at the DB's own clock, the escalation events' own counts
 * (the NOTIFY/REMINDER stamps the sweep wrote), and the document
 * drill facts. */
export interface WorkflowSlaAgingRow {
  readonly stepInstanceId: string;
  readonly instanceId: string;
  readonly triggerEntity: string;
  readonly documentId: string;
  readonly stepOrder: number;
  readonly stepType: string;
  readonly stepName: string;
  readonly stepNameAr: string;
  readonly assigneeUserId: string;
  readonly assigneeName: string | null;
  readonly dueAt: string;
  readonly assignedAt: string;
  readonly breached: boolean;
  readonly hoursOverDue: number;
  readonly escalationEvents: number;
  readonly documentNo: string | null;
}

/** The step-instance + instance join the two queries share (the
 * pointer-step APPROVAL law for the inbox; the SLA-bearing awaiting
 * steps for the aging) with the assignee's display name and the
 * snapshot's own bilingual step names (the frozen source — PP-17's
 * own law: the chain renders AS IT WAS). */
const STEP_INSTANCE_SELECT = sql`
  si.id AS "stepInstanceId", si.instance_id AS "instanceId",
  wi.trigger_entity AS "triggerEntity", wi.trigger_entity_id AS "documentId",
  si.step_order AS "stepOrder", si.step_type AS "stepType",
  si.assignee_user_id AS "assigneeUserId",
  u.full_name AS "assigneeName",
  si.due_at::text AS "dueAt",
  wi.created_at::text AS "assignedAt",
  wi.definition_snapshot->'steps' AS "snapshotSteps"
`;

function snapshotStepName(
  snapshotSteps: unknown,
  stepOrder: number,
): { name: string; nameAr: string } {
  if (!Array.isArray(snapshotSteps)) {
    return { name: `Step ${stepOrder}`, nameAr: `خطوة ${stepOrder}` };
  }
  const meta = snapshotSteps.find(
    (step) =>
      typeof step === "object" && step !== null && (step as { stepOrder?: unknown }).stepOrder === stepOrder,
  ) as { name?: string; nameAr?: string } | undefined;
  return {
    name: meta?.name ?? `Step ${stepOrder}`,
    nameAr: meta?.nameAr ?? `خطوة ${stepOrder}`,
  };
}

/** The tenant's own base currency (the engine's own base-conversion
 * law — the PO's amountBase rides the same CASE the engine's
 * readDocumentFacts computes, the rate applied only when the PO's own
 * currency differs). */
async function ownTenantBaseCurrency(tx: NonNullable<TenantContext["tx"]>): Promise<string> {
  const rows = await tx.execute(sql`
    SELECT base_currency AS "baseCurrency" FROM tenants
    WHERE id = erp.current_tenant_id() LIMIT 1
  `);
  return ((rows.rows as unknown as { baseCurrency: string }[])[0]?.baseCurrency) ?? "SAR";
}

/** The document drill facts per entity (the engine's own reader law —
 * the same per-entity doc numbers and amount derivations the inbox
 * reads: the journal's lines-sum with the journal's own rate, the PO's
 * gross with the rate only when its currency differs from the base,
 * the change order's price delta in BASE, the claim's own currency).
 * Never recomputed beyond the engine's own formulas. */
async function documentBriefs(
  tx: NonNullable<TenantContext["tx"]>,
  rows: readonly { triggerEntity: string; documentId: string }[],
): Promise<Map<string, { documentNo: string | null; amountBase: string; currency: string }>> {
  const map = new Map<string, { documentNo: string | null; amountBase: string; currency: string }>();
  const journals = rows.filter((row) => row.triggerEntity === "manual_journal");
  const orders = rows.filter((row) => row.triggerEntity === "purchase_order");
  const changes = rows.filter((row) => row.triggerEntity === "change_order");
  const drawbacks = rows.filter((row) => row.triggerEntity === "duty_drawback_claim");
  if (journals.length > 0) {
    const result = await tx.execute(sql`
      SELECT j.id, j.currency_code AS currency,
             COALESCE((SELECT SUM(l.amount * COALESCE(j.exchange_rate, 1))
                       FROM manual_journal_lines l
                       WHERE l.manual_journal_id = j.id AND l.tenant_id = j.tenant_id), 0)::numeric(18,4)::text AS "amountBase"
      FROM manual_journals j WHERE j.id IN (${sql.join(journals.map((r) => sql`${r.documentId}`), sql`, `)})
    `);
    for (const row of result.rows as unknown as { id: string; amountBase: string; currency: string }[]) {
      map.set(`manual_journal:${row.id}`, { documentNo: null, amountBase: row.amountBase, currency: row.currency });
    }
  }
  if (orders.length > 0) {
    const base = await ownTenantBaseCurrency(tx);
    const result = await tx.execute(sql`
      SELECT p.id, p.order_no AS "documentNo", p.currency_code AS currency,
             CASE WHEN p.currency_code = ${base} THEN p.total_gross
                  ELSE p.total_gross * COALESCE(p.exchange_rate, 1) END::numeric(18,4)::text AS "amountBase"
      FROM purchase_orders p WHERE p.id IN (${sql.join(orders.map((r) => sql`${r.documentId}`), sql`, `)})
    `);
    for (const row of result.rows as unknown as { id: string; documentNo: string; amountBase: string; currency: string }[]) {
      map.set(`purchase_order:${row.id}`, { documentNo: row.documentNo, amountBase: row.amountBase, currency: row.currency });
    }
  }
  if (changes.length > 0) {
    const result = await tx.execute(sql`
      SELECT c.id, c.co_no AS "documentNo", c.price_delta::numeric(18,4)::text AS "amountBase", 'BASE' AS currency
      FROM change_orders c WHERE c.id IN (${sql.join(changes.map((r) => sql`${r.documentId}`), sql`, `)})
    `);
    for (const row of result.rows as unknown as { id: string; documentNo: string; amountBase: string; currency: string }[]) {
      map.set(`change_order:${row.id}`, { documentNo: row.documentNo, amountBase: row.amountBase, currency: row.currency });
    }
  }
  if (drawbacks.length > 0) {
    const result = await tx.execute(sql`
      SELECT k.id, k.claim_no AS "documentNo", k.claimed_amount::numeric(18,4)::text AS "amountBase", k.currency
      FROM duty_drawback_claims k WHERE k.id IN (${sql.join(drawbacks.map((r) => sql`${r.documentId}`), sql`, `)})
    `);
    for (const row of result.rows as unknown as { id: string; documentNo: string; amountBase: string; currency: string }[]) {
      map.set(`duty_drawback_claim:${row.id}`, { documentNo: row.documentNo, amountBase: row.amountBase, currency: row.currency });
    }
  }
  return map;
}

const NEUTRAL_BRIEF = { documentNo: null, amountBase: "0.0000", currency: "BASE" } as const;

@Injectable()
export class WorkflowReportQueriesService {
  /** THE PENDING-APPROVALS REGISTER — the inbox's own query at the
   * tenant's breadth: every CURRENT (the pointer's own) PENDING
   * APPROVAL step on ACTIVE chains, with the aging figures the DB's
   * own clock computes (ageHours · overdue) and the assignees' display
   * names. Ordered aging-first (the inbox's own law). */
  async pendingApprovals(filter: {
    from: string;
    to: string;
    overdueOnly?: boolean;
  }): Promise<readonly WorkflowPendingApprovalsRow[]> {
    const tx = this.requireTx();
    const overdueFilter: SQL = filter.overdueOnly
      ? sql` AND (si.due_at IS NOT NULL AND si.due_at < now())`
      : sql``;
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT ${STEP_INSTANCE_SELECT},
             (si.due_at IS NOT NULL AND si.due_at < now()) AS "overdue",
             (EXTRACT(EPOCH FROM (now() - wi.created_at)) / 3600)::int AS "ageHours"
      FROM workflow_step_instances si
      JOIN workflow_instances wi ON wi.id = si.instance_id AND wi.tenant_id = si.tenant_id
      LEFT JOIN users u ON u.id = si.assignee_user_id
      WHERE si.tenant_id = erp.current_tenant_id()
        AND si.step_type = 'APPROVAL'
        AND si.status = 'PENDING'
        AND wi.status = 'ACTIVE'
        AND wi.current_step_order = si.step_order
        AND wi.created_at >= ${filter.from}::date
        AND wi.created_at < (${filter.to}::date + 1)
        ${overdueFilter}
      ORDER BY si.due_at ASC NULLS LAST, wi.created_at ASC, si.step_order ASC
      LIMIT 2000
    `);
    const raw = rows.rows as unknown as {
      stepInstanceId: string;
      instanceId: string;
      triggerEntity: string;
      documentId: string;
      stepOrder: number;
      assigneeUserId: string;
      assigneeName: string | null;
      dueAt: string | null;
      assignedAt: string;
      overdue: boolean;
      ageHours: number;
      snapshotSteps: unknown;
    }[];
    const briefs = await documentBriefs(
      tx,
      raw.map((row) => ({ triggerEntity: row.triggerEntity, documentId: row.documentId })),
    );
    return raw.map((row) => {
      const names = snapshotStepName(row.snapshotSteps, row.stepOrder);
      const brief = briefs.get(`${row.triggerEntity}:${row.documentId}`) ?? NEUTRAL_BRIEF;
      return {
        stepInstanceId: row.stepInstanceId,
        instanceId: row.instanceId,
        triggerEntity: row.triggerEntity,
        documentId: row.documentId,
        stepOrder: row.stepOrder,
        stepName: names.name,
        stepNameAr: names.nameAr,
        assigneeUserId: row.assigneeUserId,
        assigneeName: row.assigneeName,
        dueAt: row.dueAt,
        assignedAt: row.assignedAt,
        overdue: row.overdue,
        ageHours: row.ageHours,
        documentNo: brief.documentNo,
        amountBase: brief.amountBase,
        currency: brief.currency,
      };
    });
  }

  /** THE SLA-AGING REGISTER — the escalation plane's own figures: every
   * awaiting step that carries an SLA (due_at not null) on ACTIVE
   * chains, with the hours over due at the DB's own clock, the breach
   * verdict, and the escalation events' own counts (the NOTIFY/REMINDER
   * stamps the sweep wrote — the events are the sweep's own records,
   * never recomputed here). Ordered most-over-due first. */
  async slaAging(filter: {
    from: string;
    to: string;
  }): Promise<readonly WorkflowSlaAgingRow[]> {
    const tx = this.requireTx();
    const rows = await tx.execute<Record<string, unknown>>(sql`
      SELECT ${STEP_INSTANCE_SELECT},
             (si.due_at < now()) AS "breached",
             GREATEST(0, (EXTRACT(EPOCH FROM (now() - si.due_at)) / 3600))::int AS "hoursOverDue",
             (SELECT COUNT(*) FROM escalation_events e
                WHERE e.step_instance_id = si.id AND e.tenant_id = si.tenant_id)::int AS "escalationEvents"
      FROM workflow_step_instances si
      JOIN workflow_instances wi ON wi.id = si.instance_id AND wi.tenant_id = si.tenant_id
      LEFT JOIN users u ON u.id = si.assignee_user_id
      WHERE si.tenant_id = erp.current_tenant_id()
        AND si.status = 'PENDING'
        AND si.due_at IS NOT NULL
        AND wi.status = 'ACTIVE'
        AND wi.created_at >= ${filter.from}::date
        AND wi.created_at < (${filter.to}::date + 1)
      ORDER BY si.due_at ASC, wi.created_at ASC, si.step_order ASC
      LIMIT 2000
    `);
    const raw = rows.rows as unknown as {
      stepInstanceId: string;
      instanceId: string;
      triggerEntity: string;
      documentId: string;
      stepOrder: number;
      stepType: string;
      assigneeUserId: string;
      assigneeName: string | null;
      dueAt: string;
      assignedAt: string;
      breached: boolean;
      hoursOverDue: number;
      escalationEvents: number;
      snapshotSteps: unknown;
    }[];
    const briefs = await documentBriefs(
      tx,
      raw.map((row) => ({ triggerEntity: row.triggerEntity, documentId: row.documentId })),
    );
    return raw.map((row) => {
      const names = snapshotStepName(row.snapshotSteps, row.stepOrder);
      const brief = briefs.get(`${row.triggerEntity}:${row.documentId}`) ?? NEUTRAL_BRIEF;
      return {
        stepInstanceId: row.stepInstanceId,
        instanceId: row.instanceId,
        triggerEntity: row.triggerEntity,
        documentId: row.documentId,
        stepOrder: row.stepOrder,
        stepType: row.stepType,
        stepName: names.name,
        stepNameAr: names.nameAr,
        assigneeUserId: row.assigneeUserId,
        assigneeName: row.assigneeName,
        dueAt: row.dueAt,
        assignedAt: row.assignedAt,
        breached: row.breached,
        hoursOverDue: row.hoursOverDue,
        escalationEvents: row.escalationEvents,
        documentNo: brief.documentNo,
      };
    });
  }

  private requireTx(): NonNullable<TenantContext["tx"]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("workflow report queries require an ambient tenant scope");
    }
    return context.tx;
  }
}

/** The vocabularies re-declared for the contracts' block-on-fail
 * assertions (the 0127/0128 CHECKs' own domains — a foreign value
 * means the register drifted from its floor and blocks the export). */
export const WORKFLOW_REPORT_VOCABULARIES = Object.freeze({
  triggerEntities: ["manual_journal", "purchase_order", "change_order", "duty_drawback_claim"] as const,
  stepTypes: ["APPROVAL", "NOTIFICATION", "TASK"] as const,
});
