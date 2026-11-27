import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PurchaseOrderService } from "../../modules/purchasing/application/orders";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { WorkflowEngine } from "../../modules/workflow/application/workflow-engine";
import { onWorkflowEvent, type WorkflowEvent } from "../../modules/workflow/application/workflow-events";
import {
  bindWorkflowEngine,
  onDocumentCancelled,
  onDocumentSubmitted,
  recordApprovalThroughChain,
  recordRejectionThroughChain,
  unbindWorkflowEngine,
} from "../../modules/workflow/infrastructure/workflow-gateway";

/**
 * PHASE-052 (W-44 — T-03's DB spec, dated 2026-11-27) THE ENGINE
 * END-TO-END OVER THE FOUR BINDINGS (acceptance #2's own proof — the
 * master plan §3 W-44's exit bar): the seeded conditional-chain
 * scenario (a PO above 50,000 routes manager → finance → CEO; at or
 * below 50,000 it stops at the manager; a branch on a PHASE-036
 * custom field selects a different chain) + the four exemplar
 * bindings through the documented WorkflowGateway contract + the
 * definition snapshot capture at trigger time + the step ladder + the
 * assignee notifications + the bus emissions + the compatibility
 * mode (the flag-off and no-definition worlds).
 *
 * THE PO PATH RUNS THROUGH THE REAL MODULE SERVICE (the
 * PurchaseOrderService's own submit/approve acts — the true
 * end-to-end: the gateway's hooks the service carries); the other
 * three bindings run through the gateway's own functions over real
 * document rows (the journal in PENDING_APPROVAL, the change order
 * and the drawback claim in SUBMITTED — each doc type's OWN
 * submit-transition status, the vocabulary mapping law).
 *
 * THE DEDICATED TENANT (the trade-sweep spec's own shape): TENANT_WFE
 * with the workflow.engine entitlement + its own role/user plane
 * (owner · manager · finance · ceo · requester — one membership per
 * user, the uq_memberships_user_tenant law) + the master-data
 * substrate the document rows need (a branch, a supplier, a project)
 * + the PHASE-036 custom field the branch arm discriminates on.
 * TENANT_WORKFLOW_RLS (the W-43 fixture's boundary tenant, NO
 * entitlement) carries the flag-off arm's world.
 */

const TENANT_WFE = "9e9e9e9e-9e9e-9e9e-9e9e-9e9e9e9e9e9e";
const WFE_OWNER = "9e9e9e9e-0000-4000-8000-0000000009e1";
const WFE_MANAGER = "9e9e9e9e-0000-4000-8000-0000000009e2";
const WFE_FINANCE = "9e9e9e9e-0000-4000-8000-0000000009e3";
const WFE_CEO = "9e9e9e9e-0000-4000-8000-0000000009e4";
const WFE_CREATOR = "9e9e9e9e-0000-4000-8000-0000000009e5";

const audit = new AuditService(new DrizzleAuditStore());
const numbering = new NumberingService(audit);
const inbox = new InboxService();
const engine = new WorkflowEngine(audit, inbox);
const purchaseOrders = new PurchaseOrderService(audit, numbering);

/** The bus capture (the per-arm subscription window). */
const busLog: WorkflowEvent[] = [];
function startBusCapture(): () => void {
  const offs = ["workflow.instance.started", "workflow.step.assigned", "workflow.step.approved",
    "workflow.step.rejected", "workflow.instance.completed", "workflow.instance.cancelled"].map(
    (topic) =>
      onWorkflowEvent(topic as WorkflowEvent["type"], (event) => {
        if (requireTenant(event) === TENANT_WFE) {
          busLog.push(event);
        }
      }),
  );
  return () => {
    for (const off of offs) off();
  };
}
function requireTenant(event: WorkflowEvent): string {
  return (event as { tenantId: string }).tenantId;
}

/** THE FLAG-OFF TENANT (the declared neutral zero's own world): the
 *  same fixture's second tenant, NO workflow.engine entitlement — the
 *  engine's own probe stays silent for it. */
const TENANT_WFE_NOFLAG = "9e9e9e9e-9e9e-9e9e-9e9e-9e9e9e9e9e9d";

interface WfeWorld {
  branchId: string;
  supplierId: string;
  projectId: string;
  urgentFieldId: string;
  noflagBranchId: string;
  noflagSupplierId: string;
}

let world: WfeWorld | undefined;

beforeAll(async () => {
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant WFE (workflow engine)', 'المستأجر محرك سير', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_WFE],
  );
  // THE ENGINE ENTITLEMENT (the base-unit flag — the PLAN source).
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES ($1, $2, 'workflow.engine', 'PLAN')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [generateUuidV7(), TENANT_WFE],
  );
  // THE USER PLANE.
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'wfe-owner@fixture.test', 'WFE Owner', 'x', 'ACTIVE'),
       ($2, 'wfe-manager@fixture.test', 'WFE Manager', 'x', 'ACTIVE'),
       ($3, 'wfe-finance@fixture.test', 'WFE Finance', 'x', 'ACTIVE'),
       ($4, 'wfe-ceo@fixture.test', 'WFE CEO', 'x', 'ACTIVE'),
       ($5, 'wfe-creator@fixture.test', 'WFE Creator', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [WFE_OWNER, WFE_MANAGER, WFE_FINANCE, WFE_CEO, WFE_CREATOR],
  );
  const roles = await su.query<{ key: string; id: string }>(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar) VALUES
       (gen_random_uuid(), $1, 'owner', 'Owner', 'المالك'),
       (gen_random_uuid(), $1, 'manager', 'Manager', 'المدير'),
       (gen_random_uuid(), $1, 'finance', 'Finance', 'المالية'),
       (gen_random_uuid(), $1, 'ceo', 'CEO', 'الرئيس التنفيذي'),
       (gen_random_uuid(), $1, 'requester', 'Requester', 'طالب الشراء')
     RETURNING key, id`,
    [TENANT_WFE],
  );
  const roleIds = new Map(roles.rows.map((row) => [row.key, row.id]));
  const memberRows: [string, string, string][] = [
    [WFE_OWNER, roleIds.get("owner")!, generateUuidV7()],
    [WFE_MANAGER, roleIds.get("manager")!, generateUuidV7()],
    [WFE_FINANCE, roleIds.get("finance")!, generateUuidV7()],
    [WFE_CEO, roleIds.get("ceo")!, generateUuidV7()],
    [WFE_CREATOR, roleIds.get("requester")!, generateUuidV7()],
  ];
  for (const [userId, roleId, membershipId] of memberRows) {
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, tenant_id) DO NOTHING`,
      [membershipId, TENANT_WFE, userId, roleId],
    );
  }
  // THE MASTER-DATA SUBSTRATE (a branch + a supplier + a project).
  const branch = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name) VALUES
       (gen_random_uuid(), $1, 'WFE-HQ', 'WFE HQ') RETURNING id`,
    [TENANT_WFE],
  );
  const supplier = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       (gen_random_uuid(), $1, 'SUPPLIER', 'WFE-SUP', 'WFE Supplier') RETURNING id`,
    [TENANT_WFE],
  );
  const project = await su.query<{ id: string }>(
    `INSERT INTO projects (id, tenant_id, code, name) VALUES
       (gen_random_uuid(), $1, 'WFE-PRJ', 'WFE Project') RETURNING id`,
    [TENANT_WFE],
  );
  // THE FLAG-OFF TENANT's own master-data substrate.
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant WFE-NOFLAG (workflow engine off)', 'المستأجر بلا محرك', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_WFE_NOFLAG],
  );
  const noflagBranch = await su.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name) VALUES
       (gen_random_uuid(), $1, 'WFE-NF', 'WFE No-flag HQ') RETURNING id`,
    [TENANT_WFE_NOFLAG],
  );
  const noflagSupplier = await su.query<{ id: string }>(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       (gen_random_uuid(), $1, 'SUPPLIER', 'WFE-NF-SUP', 'WFE No-flag Supplier') RETURNING id`,
    [TENANT_WFE_NOFLAG],
  );
  // THE PHASE-036 CUSTOM FIELD the branch arm discriminates on.
  const field = await su.query<{ id: string }>(
    `INSERT INTO custom_field_definitions
       (id, tenant_id, entity_type, key, label, label_ar, data_type, status)
     VALUES (gen_random_uuid(), $1, 'purchase_orders', 'urgent', 'Urgent', 'عاجل', 'BOOLEAN', 'ACTIVE')
     RETURNING id`,
    [TENANT_WFE],
  );
  world = {
    branchId: branch.rows[0]!.id,
    supplierId: supplier.rows[0]!.id,
    projectId: project.rows[0]!.id,
    urgentFieldId: field.rows[0]!.id,
    noflagBranchId: noflagBranch.rows[0]!.id,
    noflagSupplierId: noflagSupplier.rows[0]!.id,
  };
  await su.end();
  bindWorkflowEngine(engine);
});

afterAll(() => {
  unbindWorkflowEngine();
});

// ── the world builders (every arm its own world — the per-arm law) ────

interface SeedDefinitionInput {
  code: string;
  /** The deterministic precedence stamp (earlier = higher). */
  createdOffsetSeconds: number;
  triggerEntity?: string;
  triggerEvent?: string;
  conditions?: unknown;
}

async function seedDefinition(input: SeedDefinitionInput): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO workflow_definitions
       (id, tenant_id, name, name_ar, trigger_entity, trigger_event, active, conditions, created_by, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, $6::jsonb, $7,
             now() - ($8 || ' seconds')::interval)
     RETURNING id`,
    [
      TENANT_WFE,
      `WFE-DEF-${input.code}`,
      `تعريف ${input.code}`,
      input.triggerEntity ?? "purchase_order",
      input.triggerEvent ?? "PENDING_APPROVAL",
      JSON.stringify(input.conditions ?? { all: [] }),
      WFE_OWNER,
      String(input.createdOffsetSeconds),
    ],
  );
  await su.end();
  return row.rows[0]!.id;
}

interface SeedStepInput {
  definitionId: string;
  stepOrder: number;
  stepType?: "APPROVAL" | "NOTIFICATION" | "TASK";
  assigneeRule?: "ROLE" | "USER" | "FIELD" | "FORMULA";
  assigneeValue?: string;
  conditions?: unknown;
  slaHours?: number | null;
  name?: string;
}

async function seedStep(input: SeedStepInput): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO workflow_steps
       (id, tenant_id, definition_id, step_order, step_type, assignee_rule, assignee_value,
        conditions, sla_hours, name, name_ar, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)`,
    [
      TENANT_WFE,
      input.definitionId,
      input.stepOrder,
      input.stepType ?? "APPROVAL",
      input.assigneeRule ?? "ROLE",
      input.assigneeValue ?? "manager",
      JSON.stringify(input.conditions ?? { all: [] }),
      input.slaHours ?? null,
      input.name ?? `Step ${input.stepOrder}`,
      `الخطوة ${input.stepOrder}`,
      WFE_OWNER,
    ],
  );
  await su.end();
}

interface SeedPoInput {
  code: string;
  totalGross: string;
  urgent?: boolean;
}

/** A DRAFT purchase order row (the real table, the real tenant) — the
 *  module's own submit act moves it. */
async function seedDraftPo(input: SeedPoInput): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO purchase_orders
       (id, tenant_id, created_by, branch_id, supplier_id, order_date, currency_code,
        status, total_net, total_tax, total_gross)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, '2026-06-15', 'SAR', 'DRAFT', $5, '0', $5)
     RETURNING id`,
    [TENANT_WFE, WFE_CREATOR, world!.branchId, world!.supplierId, input.totalGross],
  );
  const poId = row.rows[0]!.id;
  if (input.urgent === true) {
    await su.query(
      `INSERT INTO custom_field_values (id, tenant_id, entity_type, entity_id, field_id, value_boolean)
       VALUES (gen_random_uuid(), $1, 'purchase_orders', $2, $3, true)`,
      [TENANT_WFE, poId, world!.urgentFieldId],
    );
  }
  await su.end();
  return poId;
}

/** A manual journal row already in PENDING_APPROVAL (the journal's own
 *  submit-transition status — the vocabulary mapping law). */
async function seedPendingJournal(code: string): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO manual_journals
       (id, tenant_id, created_by, status, entry_date, currency_code, description)
     VALUES (gen_random_uuid(), $1, $2, 'PENDING_APPROVAL', '2026-06-15', 'SAR', $3)
     RETURNING id`,
    [TENANT_WFE, WFE_CREATOR, `WFE journal ${code}`],
  );
  const journalId = row.rows[0]!.id;
  // The chart's own code floor: numeric, 1-8 digits (ck_accounts_code_
  // shape) — the per-arm natural key rides the numeric space.
  const accountCode = `${9100 + (code.charCodeAt(0) % 80)}`.padStart(4, "0");
  const account = await su.query<{ id: string }>(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
     VALUES (gen_random_uuid(), $1, $2, 'WFE journal cash', 'حساب نقدية', 'ASSET', true)
     RETURNING id`,
    [TENANT_WFE, accountCode],
  );
  await su.query(
    `INSERT INTO manual_journal_lines (id, tenant_id, manual_journal_id, line_no, account_id, direction, amount)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, 'DEBIT', '1000.0000')`,
    [TENANT_WFE, journalId, account.rows[0]!.id],
  );
  await su.end();
  return journalId;
}

/** A change order row already in SUBMITTED. */
async function seedSubmittedChangeOrder(code: string): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO change_orders
       (id, tenant_id, created_by, project_id, title, price_delta, status, submitted_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, '25000.0000', 'SUBMITTED', now())
     RETURNING id`,
    [TENANT_WFE, WFE_CREATOR, world!.projectId, `WFE CO ${code}`],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** A duty drawback claim row already in SUBMITTED (the evidence pair
 *  the 0121 CHECK floor demands for non-DRAFT claims: a customs
 *  declaration + a bill of lading, both minimal rows). */
async function seedSubmittedDrawback(code: string): Promise<string> {
  const su = await superuserClient();
  const bl = await su.query<{ id: string }>(
    `INSERT INTO bills_of_lading (id, tenant_id, bl_no, doc_type, carrier_name)
     VALUES (gen_random_uuid(), $1, $2, 'SEA', 'WFE Carrier') RETURNING id`,
    [TENANT_WFE, `WFE-BL-${code}`],
  );
  const declaration = await su.query<{ id: string }>(
    `INSERT INTO customs_declarations (id, tenant_id, declaration_no, declaration_type, customs_office, currency)
     VALUES (gen_random_uuid(), $1, $2, 'IMPORT', 'WFE Office', 'SAR') RETURNING id`,
    [TENANT_WFE, `WFE-CD-${code}`],
  );
  const row = await su.query<{ id: string }>(
    `INSERT INTO duty_drawback_claims
       (id, tenant_id, created_by, claim_no, claimed_amount, currency, status,
        submitted_at, export_declaration_id, export_bill_of_lading_id)
     VALUES (gen_random_uuid(), $1, $2, $3, '12000.0000', 'SAR', 'SUBMITTED', now(), $4, $5)
     RETURNING id`,
    [TENANT_WFE, WFE_CREATOR, `WFE-DB-${code}`, declaration.rows[0]!.id, bl.rows[0]!.id],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** The three-step PO chain (manager → finance[>50k] → ceo[>50k]) — the
 *  acceptance scenario's own definition. EVERY ARM seeds its own copy
 *  under a UNIQUE name + its own entry window (the per-arm world law:
 *  a later arm's PO never matches an earlier arm's chain — the arms
 *  share the tenant, never the definitions). */
async function seedPoApprovalChain(
  code: string,
  window: [string, string],
): Promise<string> {
  const definitionId = await seedDefinition({
    code,
    createdOffsetSeconds: 600,
    conditions: {
      all: [{ field: "amountBase", op: "between", value: window }],
    },
  });
  await seedStep({ definitionId, stepOrder: 1, assigneeValue: "manager", name: "Manager approval" });
  await seedStep({
    definitionId, stepOrder: 2, assigneeValue: "finance", name: "Finance approval",
    conditions: { all: [{ field: "amountBase", op: "gt", value: "50000.0000" }] },
  });
  await seedStep({
    definitionId, stepOrder: 3, assigneeValue: "ceo", name: "CEO approval",
    conditions: { all: [{ field: "amountBase", op: "gt", value: "50000.0000" }] },
    slaHours: 24,
  });
  return definitionId;
}

async function instanceRows(triggerEntity: string, docId: string): Promise<{
  instance: { id: string; status: string; currentStepOrder: number | null; snapshotSteps: number };
  steps: { stepOrder: number; status: string; assigneeUserId: string; actedBy: string | null; dueAt: string | null }[];
}> {
  const su = await superuserClient();
  const instance = await su.query<{
    id: string; status: string; currentStepOrder: number | null;
    snapshotSteps: number;
  }>(
    `SELECT id, status, current_step_order AS "currentStepOrder",
            jsonb_array_length(definition_snapshot->'steps') AS "snapshotSteps"
     FROM workflow_instances
     WHERE tenant_id = $1 AND trigger_entity = $2 AND trigger_entity_id = $3
     ORDER BY created_at DESC LIMIT 1`,
    [TENANT_WFE, triggerEntity, docId],
  );
  const steps = await su.query<{
    stepOrder: number; status: string; assigneeUserId: string; actedBy: string | null; dueAt: string | null;
  }>(
    `SELECT step_order AS "stepOrder", status, assignee_user_id AS "assigneeUserId",
            acted_by AS "actedBy", due_at AS "dueAt"
     FROM workflow_step_instances
     WHERE tenant_id = $1 AND instance_id = $2
     ORDER BY step_order`,
    [TENANT_WFE, instance.rows[0]!.id],
  );
  await su.end();
  return { instance: instance.rows[0]!, steps: steps.rows };
}

async function docStatus(table: string, docId: string): Promise<string> {
  const su = await superuserClient();
  const row = await su.query<{ status: string }>(
    `SELECT status FROM ${table} WHERE tenant_id = $1 AND id = $2`,
    [TENANT_WFE, docId],
  );
  await su.end();
  return row.rows[0]!.status;
}

// ── the arms ─────────────────────────────────────────────────────────

describe("PHASE-052 W-44 — the engine end-to-end over the four bindings", () => {
  it("(a) THE CONDITIONAL-CHAIN SCENARIO — a PO above 50,000 opens the three-step chain (manager → finance → CEO) through the REAL module service", async () => {
    await seedPoApprovalChain("A-CHAIN", ["79000.0000", "81000.0000"]);
    const poId = await seedDraftPo({ code: "A", totalGross: "80000.0000" });

    const stopBus = startBusCapture();
    busLog.length = 0;
    // THE REAL SUBMIT ACT — the module's own transition + the gateway's hook.
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(poId, WFE_CREATOR));
    stopBus();

    // The document is in its OWN submit-transition status (the vocabulary
    // mapping law — never a parallel vocabulary).
    expect(await docStatus("purchase_orders", poId)).toBe("PENDING_APPROVAL");
    // The chain opened: three PENDING steps, the pointer at the manager's.
    const { instance, steps } = await instanceRows("purchase_order", poId);
    expect(instance.status).toBe("ACTIVE");
    expect(instance.currentStepOrder).toBe(1);
    expect(instance.snapshotSteps).toBe(3);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ stepOrder: 1, status: "PENDING", assigneeUserId: WFE_MANAGER });
    expect(steps[1]).toMatchObject({ stepOrder: 2, status: "PENDING", assigneeUserId: WFE_FINANCE });
    expect(steps[2]).toMatchObject({ stepOrder: 3, status: "PENDING", assigneeUserId: WFE_CEO });
    // THE SLA DUE (the ceo step's own 24h floor).
    expect(steps[2]!.dueAt).not.toBeNull();
    // THE BUS (instance.started + step.assigned for the first step).
    expect(busLog.map((event) => event.type)).toEqual([
      "workflow.instance.started",
      "workflow.step.assigned",
    ]);
    // THE ASSIGNEE'S INBOX RECORD (the `workflow` category, 0131's writer).
    const su = await superuserClient();
    const inboxRows = await su.query<{ user_id: string; category: string }>(
      `SELECT user_id, category FROM notifications
       WHERE tenant_id = $1 AND user_id = $2 AND category = 'workflow'`,
      [TENANT_WFE, WFE_MANAGER],
    );
    await su.end();
    expect(inboxRows.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("(b) the small PO — at or below 50,000 the chain stops at the manager (the branch SKIPPED stamps land at trigger time)", async () => {
    await seedPoApprovalChain("B-CHAIN", ["29000.0000", "31000.0000"]);
    const poId = await seedDraftPo({ code: "B", totalGross: "30000.0000" });

    await withTenant(TENANT_WFE, () => purchaseOrders.submit(poId, WFE_CREATOR));

    const { instance, steps } = await instanceRows("purchase_order", poId);
    expect(instance.status).toBe("ACTIVE");
    expect(instance.currentStepOrder).toBe(1);
    // THE BRANCH'S OWN VERDICT: steps 2 and 3 SKIPPED at trigger time
    // (no actor — the 0128 stamp law).
    expect(steps[0]).toMatchObject({ stepOrder: 1, status: "PENDING" });
    expect(steps[1]).toMatchObject({ stepOrder: 2, status: "SKIPPED", actedBy: null });
    expect(steps[2]).toMatchObject({ stepOrder: 3, status: "SKIPPED", actedBy: null });

    // THE MANAGER'S SINGLE APPROVAL completes the chain AND the document
    // (the module's own APPROVED transition — one act, both effects).
    const approved = await withTenant(TENANT_WFE, () =>
      purchaseOrders.approve(poId, WFE_MANAGER),
    );
    expect(approved.status).toBe("APPROVED");
    const after = await instanceRows("purchase_order", poId);
    expect(after.instance.status).toBe("COMPLETED");
    expect(after.steps[0]).toMatchObject({ status: "APPROVED", actedBy: WFE_MANAGER });
  });

  it("(c) the full ladder — the mid-chain approvals LAND on the chain (the module skips its transition); the final approval completes the chain and the document", async () => {
    await seedPoApprovalChain("C-CHAIN", ["74000.0000", "76000.0000"]);
    const poId = await seedDraftPo({ code: "C", totalGross: "75000.0000" });
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(poId, WFE_CREATOR));

    // THE MANAGER'S APPROVAL — mid-chain: the approval LANDS on the
    // chain (the step stamp commits with the act's own envelope) and
    // the document stays in its awaiting status (the module skips its
    // transition — the mid-chain shape, one atomic act).
    const midManager = await withTenant(TENANT_WFE, () =>
      purchaseOrders.approve(poId, WFE_MANAGER),
    );
    expect(midManager.status).toBe("PENDING_APPROVAL");
    let state = await instanceRows("purchase_order", poId);
    expect(state.instance.currentStepOrder).toBe(2);
    expect(state.steps[0]).toMatchObject({ status: "APPROVED", actedBy: WFE_MANAGER });

    // THE FINANCE APPROVAL — still mid-chain.
    const midFinance = await withTenant(TENANT_WFE, () =>
      purchaseOrders.approve(poId, WFE_FINANCE),
    );
    expect(midFinance.status).toBe("PENDING_APPROVAL");
    state = await instanceRows("purchase_order", poId);
    expect(state.instance.currentStepOrder).toBe(3);

    // THE CEO APPROVAL — the chain completes, the document approves.
    const stopBus = startBusCapture();
    busLog.length = 0;
    const approved = await withTenant(TENANT_WFE, () => purchaseOrders.approve(poId, WFE_CEO));
    stopBus();
    expect(approved.status).toBe("APPROVED");
    state = await instanceRows("purchase_order", poId);
    expect(state.instance.status).toBe("COMPLETED");
    expect(state.instance.currentStepOrder).toBeNull();
    expect(state.steps[2]).toMatchObject({ status: "APPROVED", actedBy: WFE_CEO });
    expect(busLog.map((event) => event.type)).toEqual([
      "workflow.step.approved",
      "workflow.instance.completed",
    ]);
  });

  it("(d) THE ACTOR LAW — a non-assignee's approval is refused (the current step's assignee alone acts)", async () => {
    await seedPoApprovalChain("D-CHAIN", ["89000.0000", "91000.0000"]);
    const poId = await seedDraftPo({ code: "D", totalGross: "90000.0000" });
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(poId, WFE_CREATOR));

    // The CEO (step 3's assignee) cannot act step 1 (the manager's).
    await expect(
      withTenant(TENANT_WFE, () => purchaseOrders.approve(poId, WFE_CEO)),
    ).rejects.toMatchObject({ code: "WORKFLOW_STEP_ALREADY_ACTED" });
    expect(await docStatus("purchase_orders", poId)).toBe("PENDING_APPROVAL");
    const state = await instanceRows("purchase_order", poId);
    expect(state.steps.every((step) => step.status === "PENDING")).toBe(true);
  });

  it("(e) THE CUSTOM-FIELD BRANCH — a PHASE-036 custom field selects a different chain (the 036 readers VERBATIM, zero parallel computation)", async () => {
    // The urgent chain (created EARLIER — the deterministic precedence):
    // one CEO step; entry conditions on the customFields.urgent branch.
    const urgentDef = await seedDefinition({
      code: "PO-URGENT",
      createdOffsetSeconds: 900,
      conditions: {
        all: [
          { field: "customFields.urgent", op: "eq", value: true },
          { field: "amountBase", op: "between", value: ["19000.0000", "21000.0000"] },
        ],
      },
    });
    await seedStep({ definitionId: urgentDef, stepOrder: 1, assigneeValue: "ceo", name: "CEO direct" });
    // The standard chain (later): the manager two-step (the same window,
    // the urgent field FALSE/UNSET — the entry ordering picks the urgent
    // chain first for urgent POs, this one for the rest).
    const standardDef = await seedDefinition({
      code: "PO-STANDARD",
      createdOffsetSeconds: 800,
      conditions: {
        all: [{ field: "amountBase", op: "between", value: ["19000.0000", "21000.0000"] }],
      },
    });
    await seedStep({ definitionId: standardDef, stepOrder: 1, assigneeValue: "manager" });
    await seedStep({ definitionId: standardDef, stepOrder: 2, assigneeValue: "finance" });

    // The urgent PO (the custom field TRUE) → the CEO-direct chain.
    const urgentPo = await seedDraftPo({ code: "E1", totalGross: "20000.0000", urgent: true });
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(urgentPo, WFE_CREATOR));
    let state = await instanceRows("purchase_order", urgentPo);
    expect(state.instance.snapshotSteps).toBe(1);
    expect(state.steps[0]).toMatchObject({ status: "PENDING", assigneeUserId: WFE_CEO });

    // The standard PO (the custom field unset) → the manager chain.
    const standardPo = await seedDraftPo({ code: "E2", totalGross: "20000.0000" });
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(standardPo, WFE_CREATOR));
    state = await instanceRows("purchase_order", standardPo);
    expect(state.instance.snapshotSteps).toBe(2);
    expect(state.steps[0]).toMatchObject({ status: "PENDING", assigneeUserId: WFE_MANAGER });
  });

  it("(f) THE JOURNAL BINDING — the gateway opens the chain on PENDING_APPROVAL and the approval act walks the ladder to completion", async () => {
    const defId = await seedDefinition({
      code: "JRN-CHAIN",
      createdOffsetSeconds: 700,
      triggerEntity: "manual_journal",
      triggerEvent: "PENDING_APPROVAL",
    });
    await seedStep({ definitionId: defId, stepOrder: 1, assigneeValue: "manager" });
    await seedStep({ definitionId: defId, stepOrder: 2, assigneeValue: "finance" });

    const journalId = await seedPendingJournal("F");
    const opened = await withTenant(TENANT_WFE, () =>
      onDocumentSubmitted({ triggerEntity: "manual_journal", documentId: journalId, actorId: WFE_CREATOR }),
    );
    expect(opened.chainOpened).toBe(true);

    // The module's approve path (the same gateway function the journal
    // service calls): the manager's approval lands mid-chain (the
    // mid-chain shape — the verdict reports the remaining steps).
    const midChain = await withTenant(TENANT_WFE, () =>
      recordApprovalThroughChain({
        triggerEntity: "manual_journal", documentId: journalId, actorId: WFE_MANAGER,
      }),
    );
    expect(midChain).toMatchObject({ chainOpened: true, completed: false });
    expect(midChain.remaining).toBe(1);
    // The finance approval completes the chain.
    const verdict = await withTenant(TENANT_WFE, () =>
      recordApprovalThroughChain({
        triggerEntity: "manual_journal", documentId: journalId, actorId: WFE_FINANCE,
      }),
    );
    expect(verdict).toEqual({ chainOpened: true, completed: true, completedSteps: 2 });
    const state = await instanceRows("manual_journal", journalId);
    expect(state.instance.status).toBe("COMPLETED");
    expect(state.steps.map((step) => step.status)).toEqual(["APPROVED", "APPROVED"]);
  });

  it("(g) THE CHANGE-ORDER BINDING — the SUBMITTED ladder + the rejection path (a rejection is a terminal verdict)", async () => {
    const defId = await seedDefinition({
      code: "CO-CHAIN",
      createdOffsetSeconds: 600,
      triggerEntity: "change_order",
      triggerEvent: "SUBMITTED",
    });
    await seedStep({ definitionId: defId, stepOrder: 1, assigneeValue: "manager" });
    await seedStep({ definitionId: defId, stepOrder: 2, assigneeValue: "ceo" });

    const coId = await seedSubmittedChangeOrder("G");
    const opened = await withTenant(TENANT_WFE, () =>
      onDocumentSubmitted({ triggerEntity: "change_order", documentId: coId, actorId: WFE_CREATOR }),
    );
    expect(opened.chainOpened).toBe(true);

    // THE REJECTION (the manager rejects at step 1): the chain COMPLETES
    // with the rejection — the remaining step stands as the frozen
    // history the timeline renders.
    const stopBus = startBusCapture();
    busLog.length = 0;
    const verdict = await withTenant(TENANT_WFE, () =>
      recordRejectionThroughChain({
        triggerEntity: "change_order", documentId: coId, actorId: WFE_MANAGER, comment: "out of scope",
      }),
    );
    stopBus();
    // THE REJECTION VERDICT carries no completedSteps (the approve
    // hook's own parity figure — the rejection is terminal, its frozen
    // history is the timeline's record).
    expect(verdict).toEqual({ chainOpened: true, completed: true });
    const state = await instanceRows("change_order", coId);
    expect(state.instance.status).toBe("COMPLETED");
    expect(state.steps[0]).toMatchObject({ status: "REJECTED", actedBy: WFE_MANAGER });
    expect(state.steps[1]).toMatchObject({ status: "PENDING" });
    expect(busLog.map((event) => event.type)).toEqual([
      "workflow.step.rejected",
      "workflow.instance.completed",
    ]);
  });

  it("(h) THE DRAWBACK BINDING — the register's own ready-made ladder opens its chain and completes on approval", async () => {
    const defId = await seedDefinition({
      code: "DB-CHAIN",
      createdOffsetSeconds: 500,
      triggerEntity: "duty_drawback_claim",
      triggerEvent: "SUBMITTED",
    });
    await seedStep({ definitionId: defId, stepOrder: 1, assigneeValue: "finance" });

    const claimId = await seedSubmittedDrawback("H");
    const opened = await withTenant(TENANT_WFE, () =>
      onDocumentSubmitted({
        triggerEntity: "duty_drawback_claim", documentId: claimId, actorId: WFE_CREATOR,
      }),
    );
    expect(opened.chainOpened).toBe(true);
    const verdict = await withTenant(TENANT_WFE, () =>
      recordApprovalThroughChain({
        triggerEntity: "duty_drawback_claim", documentId: claimId, actorId: WFE_FINANCE,
      }),
    );
    expect(verdict.completed).toBe(true);
    const state = await instanceRows("duty_drawback_claim", claimId);
    expect(state.instance.status).toBe("COMPLETED");
  });

  it("(i) THE NOTIFICATION STEP'S FIRE-AND-ADVANCE — the engine's own progression stamp (no user act) walks the pointer past it", async () => {
    const defId = await seedDefinition({
      code: "NOTIF-CHAIN",
      createdOffsetSeconds: 400,
      conditions: { all: [{ field: "amountBase", op: "between", value: ["59000.0000", "61000.0000"] }] },
    });
    await seedStep({ definitionId: defId, stepOrder: 1, assigneeValue: "manager" });
    await seedStep({
      definitionId: defId, stepOrder: 2, stepType: "NOTIFICATION", assigneeValue: "owner",
      name: "Notify the owner",
    });
    await seedStep({ definitionId: defId, stepOrder: 3, assigneeValue: "ceo" });

    const poId = await seedDraftPo({ code: "I", totalGross: "60000.0000" });
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(poId, WFE_CREATOR));

    // The manager's approval walks the pointer: the NOTIFICATION step
    // fires (the SKIPPED stamp, no actor, the inbox record to the owner)
    // and the pointer lands on the CEO step (the mid-chain resolution —
    // the document stays awaiting the CEO).
    const midChain = await withTenant(TENANT_WFE, () =>
      purchaseOrders.approve(poId, WFE_MANAGER),
    );
    expect(midChain.status).toBe("PENDING_APPROVAL");
    const state = await instanceRows("purchase_order", poId);
    expect(state.instance.currentStepOrder).toBe(3);
    expect(state.steps[1]).toMatchObject({
      stepOrder: 2, status: "SKIPPED", actedBy: null, assigneeUserId: WFE_OWNER,
    });
    // The owner's inbox record landed (the notification's own writer).
    const su = await superuserClient();
    const ownerInbox = await su.query<{ category: string }>(
      `SELECT category FROM notifications
       WHERE tenant_id = $1 AND user_id = $2 AND category = 'workflow'`,
      [TENANT_WFE, WFE_OWNER],
    );
    await su.end();
    expect(ownerInbox.rows.length).toBeGreaterThanOrEqual(1);
  });

  it("(j) THE SNAPSHOT LAW — a definition edited after trigger NEVER rewrites a live instance", async () => {
    const defId = await seedDefinition({
      code: "SNAP-CHAIN",
      createdOffsetSeconds: 300,
      conditions: { all: [{ field: "amountBase", op: "between", value: ["9900.0000", "10100.0000"] }] },
    });
    await seedStep({ definitionId: defId, stepOrder: 1, assigneeValue: "manager" });
    await seedStep({ definitionId: defId, stepOrder: 2, assigneeValue: "finance" });

    const poId = await seedDraftPo({ code: "J", totalGross: "10000.0000" });
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(poId, WFE_CREATOR));

    // The definition CHANGES after the trigger (a third step + a rename).
    const su = await superuserClient();
    await su.query(
      `INSERT INTO workflow_steps
         (id, tenant_id, definition_id, step_order, step_type, assignee_rule, assignee_value,
          conditions, name, name_ar, created_by)
       VALUES (gen_random_uuid(), $1, $2, 3, 'APPROVAL', 'ROLE', 'ceo', '{"all":[]}'::jsonb,
               'Late CEO step', 'خطوة متأخرة', $3)`,
      [TENANT_WFE, defId, WFE_OWNER],
    );
    await su.query(
      `UPDATE workflow_definitions SET name = 'SNAP-CHAIN (edited)' WHERE id = $1`,
      [defId],
    );
    await su.end();

    // The live instance keeps its TWO-step snapshot — the edited
    // definition never rewrites it.
    const state = await instanceRows("purchase_order", poId);
    expect(state.instance.snapshotSteps).toBe(2);
    expect(state.steps).toHaveLength(2);
    // A NEW document opens on the EDITED definition (three steps).
    const po2 = await seedDraftPo({ code: "J2", totalGross: "10000.0000" });
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(po2, WFE_CREATOR));
    const state2 = await instanceRows("purchase_order", po2);
    expect(state2.instance.snapshotSteps).toBe(3);
  });

  it("(k) THE CANCELLATION MIRROR — the module's cancellation cancels the ACTIVE chain", async () => {
    const defId = await seedDefinition({
      code: "CANCEL-CHAIN",
      createdOffsetSeconds: 200,
      triggerEntity: "manual_journal",
      triggerEvent: "PENDING_APPROVAL",
    });
    await seedStep({ definitionId: defId, stepOrder: 1, assigneeValue: "manager" });

    const journalId = await seedPendingJournal("K");
    await withTenant(TENANT_WFE, () =>
      onDocumentSubmitted({ triggerEntity: "manual_journal", documentId: journalId, actorId: WFE_CREATOR }),
    );
    const stopBus = startBusCapture();
    busLog.length = 0;
    await withTenant(TENANT_WFE, () =>
      onDocumentCancelled({
        triggerEntity: "manual_journal", documentId: journalId, actorId: WFE_CREATOR, reason: "obsolete",
      }),
    );
    stopBus();
    const state = await instanceRows("manual_journal", journalId);
    expect(state.instance.status).toBe("CANCELLED");
    expect(busLog.map((event) => event.type)).toEqual(["workflow.instance.cancelled"]);

    // INV-037's floor at the service layer: the terminal instance refuses
    // every further act (the typed WORKFLOW_INSTANCE_IMMUTABLE refusal).
    await expect(
      withTenant(TENANT_WFE, () =>
        recordApprovalThroughChain({
          triggerEntity: "manual_journal", documentId: journalId, actorId: WFE_MANAGER,
        }),
      ),
    ).resolves.toEqual({ chainOpened: false, completed: false });
  });

  it("(l) THE COMPATIBILITY MODE — no matching definition or the flag off: the legacy path, no chain (byte-identical)", async () => {
    // (l1) A definition whose entry conditions DO NOT match (the amount
    // floor above the document): no chain, the module path untouched.
    const defId = await seedDefinition({
      code: "NOMATCH-CHAIN",
      createdOffsetSeconds: 100,
      conditions: { all: [{ field: "amountBase", op: "gt", value: "500000.0000" }] },
    });
    await seedStep({ definitionId: defId, stepOrder: 1, assigneeValue: "ceo" });

    const poId = await seedDraftPo({ code: "L1", totalGross: "5000.0000" });
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(poId, WFE_CREATOR));
    const su = await superuserClient();
    const chains = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM workflow_instances
       WHERE tenant_id = $1 AND trigger_entity_id = $2`,
      [TENANT_WFE, poId],
    );
    await su.end();
    expect(chains.rows[0]!.n).toBe(0);
    // The module's own approve act runs the LEGACY path (no chain gate):
    // the manager approves the document directly.
    const approved = await withTenant(TENANT_WFE, () => purchaseOrders.approve(poId, WFE_MANAGER));
    expect(approved.status).toBe("APPROVED");
  });

  it("(m) THE FLAG-OFF TENANT — the entitlement probe keeps the engine off (the declared neutral zero's own reading)", async () => {
    // The no-flag tenant's own DRAFT PO (its OWN branch + supplier): no
    // entitlement, no chain — the module's own submit/approve path runs
    // untouched.
    const su = await superuserClient();
    const row = await su.query<{ id: string }>(
      `INSERT INTO purchase_orders
         (id, tenant_id, branch_id, supplier_id, order_date, currency_code,
          status, total_net, total_tax, total_gross)
       VALUES (gen_random_uuid(), $1, $2, $3, '2026-06-15', 'SAR', 'DRAFT', '5000.0000', '0', '5000.0000')
       RETURNING id`,
      [TENANT_WFE_NOFLAG, world!.noflagBranchId, world!.noflagSupplierId],
    );
    const poId = row.rows[0]!.id;
    await su.end();

    const opened = await withTenant(TENANT_WFE_NOFLAG, () =>
      onDocumentSubmitted({ triggerEntity: "purchase_order", documentId: poId, actorId: WFE_CREATOR }),
    );
    expect(opened.chainOpened).toBe(false);
    // And the module's own submit + approve run the LEGACY path on that
    // tenant (no chain, no gate — the compatibility mode's flag-off
    // face: the manager approves the document directly).
    await withTenant(TENANT_WFE_NOFLAG, () => purchaseOrders.submit(poId, WFE_CREATOR));
    const approved = await withTenant(TENANT_WFE_NOFLAG, () =>
      purchaseOrders.approve(poId, WFE_MANAGER),
    );
    expect(approved.status).toBe("APPROVED");
  });

  it("(n) THE FORMULA VOCABULARY — document.creator and tenant.owner resolve through the declared closed formulas", async () => {
    const defId = await seedDefinition({
      code: "FORMULA-CHAIN",
      createdOffsetSeconds: 90,
      conditions: { all: [{ field: "amountBase", op: "between", value: ["3900.0000", "4100.0000"] }] },
    });
    await seedStep({
      definitionId: defId, stepOrder: 1, assigneeRule: "FORMULA", assigneeValue: "document.creator",
    });
    await seedStep({
      definitionId: defId, stepOrder: 2, assigneeRule: "FORMULA", assigneeValue: "tenant.owner",
    });

    const poId = await seedDraftPo({ code: "N", totalGross: "4000.0000" });
    await withTenant(TENANT_WFE, () => purchaseOrders.submit(poId, WFE_CREATOR));
    const state = await instanceRows("purchase_order", poId);
    expect(state.steps[0]).toMatchObject({ assigneeUserId: WFE_CREATOR });
    expect(state.steps[1]).toMatchObject({ assigneeUserId: WFE_OWNER });
  });

  it("(o) THE UNRESOLVABLE ASSIGNEE — the typed refusal, fail-closed (the engine never invents an assignee)", async () => {
    const defId = await seedDefinition({
      code: "UNRESOLVABLE-CHAIN",
      createdOffsetSeconds: 80,
      conditions: { all: [{ field: "amountBase", op: "between", value: ["3400.0000", "3600.0000"] }] },
    });
    await seedStep({
      definitionId: defId, stepOrder: 1, assigneeRule: "ROLE", assigneeValue: "nonexistent_role",
    });

    const poId = await seedDraftPo({ code: "O", totalGross: "3500.0000" });
    // The submit act itself surfaces the typed refusal — a chain that
    // cannot open NEVER silently ungates the document (the module's own
    // transition rolled back with it: the withTenant envelope).
    await expect(
      withTenant(TENANT_WFE, () => purchaseOrders.submit(poId, WFE_CREATOR)),
    ).rejects.toMatchObject({ code: "WORKFLOW_ASSIGNEE_UNRESOLVABLE" });
    const su = await superuserClient();
    const status = await su.query<{ status: string }>(
      `SELECT status FROM purchase_orders WHERE tenant_id = $1 AND id = $2`,
      [TENANT_WFE, poId],
    );
    const chains = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM workflow_instances
       WHERE tenant_id = $1 AND trigger_entity_id = $2`,
      [TENANT_WFE, poId],
    );
    await su.end();
    // ZERO RESIDUE (the ambient transaction rolled the whole submit back).
    expect(status.rows[0]!.status).toBe("DRAFT");
    expect(chains.rows[0]!.n).toBe(0);
  });
});
