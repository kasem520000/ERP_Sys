import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { JournalService } from "../../modules/accounting/application/journal-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { WorkflowEngine, type WorkflowEmailLeg } from "../../modules/workflow/application/workflow-engine";
import { WorkflowDeepLinkService } from "../../modules/workflow/application/deep-link-service";
import { WorkflowTaskLaneService } from "../../modules/workflow/application/task-lane-service";
import { WorkflowAlertAdapter } from "../../modules/workflow/application/rules-alerts";
import {
  bindWorkflowEngine,
  onDocumentSubmitted,
  unbindWorkflowEngine,
} from "../../modules/workflow/infrastructure/workflow-gateway";
import { encodeWorkflowActionToken } from "../../modules/workflow/domain/action-token";
import { onWorkflowEvent, type WorkflowEvent } from "../../modules/workflow/application/workflow-events";
import {
  WorkflowInputInvalidError,
  WorkflowStepAlreadyActedError,
  WorkflowStepStateError,
  WorkflowTokenActorMismatchError,
  WorkflowTokenExpiredError,
} from "../../modules/workflow/domain/workflow-errors";

/**
 * PHASE-052 (W-47 — T-06 + T-08 + T-07's rules half, dated 2026-11-27)
 * THE DEEP LINKS + THE TASKS LANE + THE RULES ALERTS over real
 * PostgreSQL 16 (acceptance #6's own proof + the task arms + the alert
 * arms — the master plan §3 W-47's exit bar):
 *
 * THE DEEP LINKS (D-09 — the acceptance #6 spine): the one-time act
 * through the email's own token (the CAPTURING LEG carries the exact
 * tokens the 041 mail renders — the end-to-end: the link the assignee
 * receives is the link that works) + THE COMPLETION LANDING (the
 * module's approve act after the deep-link completion takes the
 * POST-COMPLETION RE-ENTRY — the document lands APPROVED, the legacy
 * policy path never re-gates a chain-approved document) + the replay
 * refusal (the CAS single-use — the acted_at stamp is the ledger) +
 * the expiry refusal (the claim's own deadline, the DB's own clock) +
 * the actor-mismatch refusal (the link's bound user vs the session) +
 * the tamper refusal (the typed input class) + the reject link (the
 * terminal REJECTED verdict, the frozen tail) + the comment capture +
 * the preview (the act page's own read).
 *
 * THE TASKS LANE (D-11 — no seventh table): the typed list (the
 * caller's own PENDING TASK steps, due-first, the other user's tasks
 * never in my lane) + the completion write-back (the step's own ACTED
 * stamp, the chain completes, the receipt) + the non-task refusal +
 * the actor law + the graceful gate (the tasks-flag-off tenant's lane
 * is empty).
 *
 * THE RULES ALERTS (UX-13 — the bus consumers, never a parallel
 * evaluation path): the threshold alert (the configured rule on the
 * ENGINE'S OWN context — the same figure the chain's entry conditions
 * saw) + the below-threshold silence + the no-rules default (the
 * settings-less tenant) + the garbage rule skipped (the chain still
 * opens — the catch-and-continue) + the creator audience.
 *
 * THE DEDICATED TENANTS (the engine spec's own shape): TENANT_WFX
 * (workflow.engine + workflow.tasks entitlements + the alert-rules
 * settings row + the owner user for the owner audience) and
 * TENANT_WFX_GATE (workflow.engine ONLY — the tasks-flag-off + the
 * settings-less worlds). EVERY ARM seeds its OWN world — its own
 * users, its own member role, its own journal + account + line, and
 * its own definition discriminated by the arm's OWN entry window on
 * the journal's amount (the per-arm world law). The amount space: the
 * deep-link/task arms 1000 + i*7 (never matching the alert rules'
 * windows); the alert arms 3000/3001 (the high-value rule), 900 (the
 * silence), 1500 (the creator audience).
 */

const TENANT_WFX = "b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b501";
const TENANT_WFX_GATE = "b5b5b5b5-b5b5-b5b5-b5b5-b5b5b5b5b50d";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const journals = new JournalService(audit, posting);
const inbox = new InboxService();

/** THE CAPTURING LEG — the exact tokens the 041 mail would render (the
 * end-to-end proof: the link the assignee receives is the link that
 * works). */
interface CapturedAssignment {
  readonly assigneeUserId: string;
  readonly stepInstanceId: string;
  readonly approveToken: string;
  readonly rejectToken: string;
  readonly tokenDeadline: string;
  readonly docNo: string;
  readonly amountBase: string;
}
const captured: CapturedAssignment[] = [];
const capturingLeg: WorkflowEmailLeg = {
  async enqueueStepAssignedMail(input): Promise<void> {
    captured.push({
      assigneeUserId: input.assigneeUserId,
      stepInstanceId: input.stepInstanceId,
      approveToken: input.approveToken,
      rejectToken: input.rejectToken,
      tokenDeadline: input.tokenDeadline,
      docNo: input.docNo,
      amountBase: input.amountBase,
    });
  },
};

const engine = new WorkflowEngine(audit, inbox, capturingLeg);
const deepLinks = new WorkflowDeepLinkService(engine);
const taskLane = new WorkflowTaskLaneService(engine, inbox);
const alerts = new WorkflowAlertAdapter(inbox);

interface ArmWorld {
  readonly approverId: string;
  readonly otherId: string;
  readonly creatorId: string;
  readonly journalId: string;
  readonly amount: number;
  readonly stepInstanceId: string;
}

/** Seed ONE arm's world: its own users + member role + memberships +
 *  the journal (PENDING_APPROVAL, the creator's own) + the definition
 *  (the arm's entry window on the amount) + the single step (the
 *  opts' shape: APPROVAL (the deep-link arms) or TASK (the lane arms),
 *  the USER rule on the approver — the opts' OWN approver when the arm
 *  shares a lane user with an earlier world). Returns the world + opens
 *  the chain (the step instance id + the captured email tokens). */
async function seedArmWorld(
  code: string,
  armIndex: number,
  opts: {
    readonly tenantId?: string;
    readonly amount?: number;
    readonly stepType?: "APPROVAL" | "TASK";
    readonly slaHours?: number | null;
    readonly approverId?: string;
  } = {},
): Promise<ArmWorld> {
  const tenantId = opts.tenantId ?? TENANT_WFX;
  const amount = opts.amount ?? 1000 + armIndex * 7;
  const stepType = opts.stepType ?? "APPROVAL";
  const slaHours = opts.slaHours === undefined ? null : opts.slaHours;
  const su: Client = await superuserClient();
  const users = await su.query<{ id: string; email: string }>(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       (gen_random_uuid(), $1, 'WFX Approver ${code}', 'x', 'ACTIVE'),
       (gen_random_uuid(), $2, 'WFX Other ${code}', 'x', 'ACTIVE'),
       (gen_random_uuid(), $3, 'WFX Creator ${code}', 'x', 'ACTIVE')
     RETURNING id, email`,
    [
      `wfx-${code.toLowerCase()}-approver@fixture.test`,
      `wfx-${code.toLowerCase()}-other@fixture.test`,
      `wfx-${code.toLowerCase()}-creator@fixture.test`,
    ],
  );
  const byEmail = new Map(users.rows.map((row) => [row.email, row.id]));
  const approverId = byEmail.get(`wfx-${code.toLowerCase()}-approver@fixture.test`)!;
  const otherId = byEmail.get(`wfx-${code.toLowerCase()}-other@fixture.test`)!;
  const creatorId = byEmail.get(`wfx-${code.toLowerCase()}-creator@fixture.test`)!;

  const role = await su.query<{ id: string }>(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar)
     VALUES (gen_random_uuid(), $1, $2, 'WFX Member ${code}', 'عضو ${code}')
     RETURNING id`,
    [tenantId, `wfx_member_${code.toLowerCase()}`],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id, status) VALUES
       (gen_random_uuid(), $1, $2, $3, 'ACTIVE'),
       (gen_random_uuid(), $1, $4, $3, 'ACTIVE'),
       (gen_random_uuid(), $1, $5, $3, 'ACTIVE')`,
    [tenantId, approverId, role.rows[0]!.id, otherId, creatorId],
  );

  const journal = await su.query<{ id: string }>(
    `INSERT INTO manual_journals
       (id, tenant_id, created_by, status, entry_date, currency_code, description)
     VALUES (gen_random_uuid(), $1, $2, 'PENDING_APPROVAL', '2026-06-15', 'SAR', $3)
     RETURNING id`,
    [tenantId, creatorId, `WFX journal ${code}`],
  );
  const account = await su.query<{ id: string }>(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
     VALUES (gen_random_uuid(), $1, $2, 'WFX account ${code}', 'حساب ${code}', 'ASSET', true)
     RETURNING id`,
    [tenantId, `${9400 + armIndex}`],
  );
  await su.query(
    `INSERT INTO manual_journal_lines (id, tenant_id, manual_journal_id, line_no, account_id, direction, amount)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, 'DEBIT', $4)`,
    [tenantId, journal.rows[0]!.id, account.rows[0]!.id, `${amount}.0000`],
  );

  const definition = await su.query<{ id: string }>(
    `INSERT INTO workflow_definitions
       (id, tenant_id, name, name_ar, trigger_entity, trigger_event, active, conditions, created_by, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'manual_journal', 'PENDING_APPROVAL', true, $4::jsonb, $5,
             now() - ($6 || ' seconds')::interval)
     RETURNING id`,
    [
      tenantId,
      `WFX-DEF-${code}`,
      `تعريف ${code}`,
      JSON.stringify({
        all: [
          {
            field: "amountBase",
            op: "between",
            value: [`${(amount - 0.5).toFixed(4)}`, `${(amount + 0.5).toFixed(4)}`],
          },
        ],
      }),
      creatorId,
      String(900 + armIndex * 10),
    ],
  );
  await su.query(
    `INSERT INTO workflow_steps
       (id, tenant_id, definition_id, step_order, step_type, assignee_rule, assignee_value,
        conditions, sla_hours, name, name_ar, created_by)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, 'USER', $4, '{"all":[]}'::jsonb, $5,
             $6, $7, $8)`,
    [
      tenantId,
      definition.rows[0]!.id,
      stepType,
      opts.approverId ?? approverId,
      slaHours,
      stepType === "TASK" ? `Prepare ${code}` : `Approval ${code}`,
      stepType === "TASK" ? `تجهيز ${code}` : `موافقة ${code}`,
      creatorId,
    ],
  );
  await su.end();

  // Open the chain (the submit hook's shape) and capture the step
  // instance + the email tokens.
  await withTenant(tenantId, async () => {
    await onDocumentSubmitted({
      triggerEntity: "manual_journal",
      documentId: journal.rows[0]!.id,
      actorId: creatorId,
    });
    await alerts.drain();
  });
  const su2: Client = await superuserClient();
  const step = await su2.query<{ id: string }>(
    `SELECT si.id FROM workflow_step_instances si
     JOIN workflow_instances wi ON wi.id = si.instance_id AND wi.tenant_id = si.tenant_id
     WHERE si.tenant_id = $1 AND wi.trigger_entity = 'manual_journal'
       AND wi.trigger_entity_id = $2 AND si.step_order = 1`,
    [tenantId, journal.rows[0]!.id],
  );
  await su2.end();
  return {
    approverId,
    otherId,
    creatorId,
    journalId: journal.rows[0]!.id,
    amount,
    stepInstanceId: step.rows[0]!.id,
  };
}

/** The journal's chain state (the instance + its step rows). */
async function chainState(
  tenantId: string,
  journalId: string,
): Promise<{
  instanceStatus: string;
  steps: readonly {
    status: string; actedAt: string | null; actedBy: string | null; comment: string | null;
  }[];
}> {
  const su: Client = await superuserClient();
  const instance = await su.query<{ id: string; status: string }>(
    `SELECT id, status FROM workflow_instances
     WHERE tenant_id = $1 AND trigger_entity = 'manual_journal' AND trigger_entity_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, journalId],
  );
  const steps = await su.query<{
    status: string; actedAt: string | null; actedBy: string | null; comment: string | null;
  }>(
    `SELECT status, acted_at::text AS "actedAt", acted_by AS "actedBy", comment
     FROM workflow_step_instances WHERE tenant_id = $1 AND instance_id = $2 ORDER BY step_order`,
    [tenantId, instance.rows[0]!.id],
  );
  await su.end();
  return { instanceStatus: instance.rows[0]!.status, steps: steps.rows };
}

/** The workflow-category inbox rows for a user (the alerts + the
 * assignments + the receipts — the assert's own read). */
async function inboxRows(
  tenantId: string,
  userId: string,
  dedupePrefix: string,
): Promise<readonly { title: string; body: string; dedupeKey: string }[]> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ title: string; body: string; dedupeKey: string }>(
    `SELECT title->>'en' AS title, body->>'en' AS body, dedupe_key AS "dedupeKey"
     FROM notifications
     WHERE tenant_id = $1 AND user_id = $2 AND dedupe_key LIKE $3
     ORDER BY created_at`,
    [tenantId, userId, `${dedupePrefix}%`],
  );
  await su.end();
  return rows.rows;
}

beforeAll(async () => {
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant WFX (workflow links/tasks/alerts)', 'المستأجر روابط سير', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant WFX-GATE (engine only)', 'المستأجر سير المحرك فقط', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_WFX, TENANT_WFX_GATE],
  );
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source) VALUES
       (gen_random_uuid(), $1, 'workflow.engine', 'PLAN'),
       (gen_random_uuid(), $1, 'workflow.tasks', 'PLAN'),
       (gen_random_uuid(), $2, 'workflow.engine', 'PLAN')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [TENANT_WFX, TENANT_WFX_GATE],
  );
  // THE WFX OWNER (the alerts' owner audience — the escalation sweep's
  // own audience precedent: the 'owner' role's first ACTIVE membership).
  // The roles' unique floor is PARTIAL ((tenant_id, key) WHERE tenant_id
  // IS NOT NULL) — the insert-if-absent shape (no ON CONFLICT target).
  const ownerRole = await su.query<{ id: string }>(
    `WITH ins AS (
       INSERT INTO roles (id, tenant_id, key, name, name_ar)
       SELECT gen_random_uuid(), $1, 'owner', 'WFX Owner', 'مالك سير'
       WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id = $1 AND key = 'owner')
       RETURNING id
     )
     SELECT id FROM ins
     UNION ALL
     SELECT id FROM roles WHERE tenant_id = $1 AND key = 'owner'
     LIMIT 1`,
    [TENANT_WFX],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ('b5b5b5b5-0000-4000-8000-000000000b01', 'wfx-owner@fixture.test', 'WFX Owner', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id, status) VALUES
       (gen_random_uuid(), $1, 'b5b5b5b5-0000-4000-8000-000000000b01', $2, 'ACTIVE')
     ON CONFLICT DO NOTHING`,
    [TENANT_WFX, ownerRole.rows[0]!.id],
  );
  // THE ALERT-RULES SETTINGS ROW (the configured rules — the envelope
  // passes the zod shape; the garbage rule's conditions fail the D-06
  // fold at evaluation time: the fail-closed skip this spec proves).
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
       (gen_random_uuid(), $1, 'workflow.alert_rules', $2::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [
      TENANT_WFX,
      JSON.stringify([
        {
          name: "High value",
          conditions: { all: [{ field: "amountBase", op: "gt", value: "2000.0000" }] },
          audience: "owner",
          severity: "warning",
        },
        {
          name: "Exact 1500",
          conditions: { all: [{ field: "amountBase", op: "eq", value: "1500.0000" }] },
          audience: "creator",
          severity: "info",
        },
        {
          name: "Garbage rule",
          conditions: { garbage: true },
          audience: "owner",
          severity: "warning",
        },
      ]),
    ],
  );
  await su.end();
  bindWorkflowEngine(engine);
});

let unsubscribeAlerts: (() => void) | undefined;

beforeAll(() => {
  unsubscribeAlerts = alerts.subscribe();
});

afterAll(() => {
  unsubscribeAlerts?.();
  unbindWorkflowEngine();
});

// ── the deep-link arms (acceptance #6) ───────────────────────────────

describe("PHASE-052 W-47 — the deep links + the tasks lane + the rules alerts", () => {
  it("(a) THE ONE-TIME ACT + THE COMPLETION LANDING — the email's own approve token acts once; the module's approve then lands the document through the POST-COMPLETION RE-ENTRY", async () => {
    const w = await seedArmWorld("A", 0);
    const token = captured.find((c) => c.stepInstanceId === w.stepInstanceId)!.approveToken;
    expect(token).toBeDefined();

    // THE BUS LISTENER (the instance.completed emission — the lifecycle
    // order the 055 handoff documents).
    const events: WorkflowEvent[] = [];
    const off = onWorkflowEvent("workflow.instance.completed", (event) => events.push(event));

    const outcome = await withTenant(TENANT_WFX, () =>
      deepLinks.actThroughToken({ token, actorId: w.approverId, comment: "Approved by email link" }),
    );
    off();

    // THE ACT'S OWN RECORD (acceptance #6's letter): one-time (the CAS
    // stamp), the actor, acted_at, the comment — the timeline's own row.
    expect(outcome).toMatchObject({
      action: "approve",
      stepInstanceId: w.stepInstanceId,
      completed: true,
      completedSteps: 1,
    });
    const state = await chainState(TENANT_WFX, w.journalId);
    expect(state.instanceStatus).toBe("COMPLETED");
    expect(state.steps[0]!.status).toBe("APPROVED");
    expect(state.steps[0]!.actedBy).toBe(w.approverId);
    expect(state.steps[0]!.actedAt).not.toBeNull();
    expect(state.steps[0]!.comment).toBe("Approved by email link");
    expect(events.map((event) => event.type)).toEqual(["workflow.instance.completed"]);

    // THE COMPLETION LANDING (the re-entry): the deep-link act completed
    // the chain OUTSIDE the module's own act — the module's approve act
    // (the REAL JournalService) reads the completed-approved chain and
    // lands the document's APPROVED transition DIRECTLY (approval_step
    // the chain's count — the W-46 completion law extended; the legacy
    // policy path never re-gates a chain-approved document).
    const approved = await withTenant(TENANT_WFX, () =>
      journals.approve(w.approverId, w.journalId, "final landing"),
    );
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvalStep).toBe(1);
  });

  it("(b) THE REPLAY REFUSAL — the same link again takes the typed ALREADY_ACTED (the CAS single-use; the acted_at stamp is the ledger)", async () => {
    const w = await seedArmWorld("B", 1);
    const token = captured.find((c) => c.stepInstanceId === w.stepInstanceId)!.approveToken;
    await withTenant(TENANT_WFX, () =>
      deepLinks.actThroughToken({ token, actorId: w.approverId, comment: null }),
    );
    try {
      await withTenant(TENANT_WFX, () =>
        deepLinks.actThroughToken({ token, actorId: w.approverId, comment: null }),
      );
      expect.unreachable("the replayed link must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowStepAlreadyActedError);
      expect((error as WorkflowStepAlreadyActedError).details?.stepInstanceId).toBe(w.stepInstanceId);
    }
  });

  it("(c) THE EXPIRY REFUSAL — a token past its claim's own deadline takes the typed EXPIRED (the DB's own clock)", async () => {
    const w = await seedArmWorld("C", 2);
    const expired = encodeWorkflowActionToken({
      userId: w.approverId,
      instanceId: await instanceIdOf(TENANT_WFX, w.journalId),
      stepInstanceId: w.stepInstanceId,
      action: "approve",
      deadline: "2020-01-01T00:00:00.000Z",
    });
    try {
      await withTenant(TENANT_WFX, () =>
        deepLinks.actThroughToken({ token: expired, actorId: w.approverId, comment: null }),
      );
      expect.unreachable("the expired link must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowTokenExpiredError);
      expect((error as WorkflowTokenExpiredError).details?.deadline).toBe("2020-01-01T00:00:00.000Z");
    }
  });

  it("(d) THE ACTOR MISMATCH REFUSAL — another user's session with the link takes the typed ACTOR_MISMATCH", async () => {
    const w = await seedArmWorld("D", 3);
    const token = captured.find((c) => c.stepInstanceId === w.stepInstanceId)!.approveToken;
    try {
      await withTenant(TENANT_WFX, () =>
        deepLinks.actThroughToken({ token, actorId: w.otherId, comment: null }),
      );
      expect.unreachable("the wrong actor must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowTokenActorMismatchError);
      const details = (error as WorkflowTokenActorMismatchError).details;
      expect(details?.expectedUserId).toBe(w.approverId);
      expect(details?.actualUserId).toBe(w.otherId);
    }
    // ZERO RESIDUE: the step stands PENDING (the refused act left nothing).
    const state = await chainState(TENANT_WFX, w.journalId);
    expect(state.steps[0]!.status).toBe("PENDING");
  });

  it("(e) THE TAMPER REFUSAL — a forged signature takes the typed input class (no partial parse, no lenient field)", async () => {
    const w = await seedArmWorld("E", 4);
    const token = captured.find((c) => c.stepInstanceId === w.stepInstanceId)!.approveToken;
    const flipped = `${token.slice(0, -2)}${token.slice(-1)}${token.slice(-2, -1)}`;
    try {
      await withTenant(TENANT_WFX, () =>
        deepLinks.actThroughToken({ token: flipped, actorId: w.approverId, comment: null }),
      );
      expect.unreachable("the tampered token must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowInputInvalidError);
      expect((error as WorkflowInputInvalidError).details?.field).toBe("token");
    }
  });

  it("(f) THE REJECT LINK — the reject token completes the chain with the terminal REJECTED verdict", async () => {
    const w = await seedArmWorld("F", 5);
    const token = captured.find((c) => c.stepInstanceId === w.stepInstanceId)!.rejectToken;
    const outcome = await withTenant(TENANT_WFX, () =>
      deepLinks.actThroughToken({ token, actorId: w.approverId, comment: "Rejected from email" }),
    );
    expect(outcome).toMatchObject({ action: "reject", completed: true });
    const state = await chainState(TENANT_WFX, w.journalId);
    expect(state.instanceStatus).toBe("COMPLETED");
    expect(state.steps[0]!.status).toBe("REJECTED");
    expect(state.steps[0]!.actedBy).toBe(w.approverId);
    expect(state.steps[0]!.comment).toBe("Rejected from email");
  });

  it("(g) THE PREVIEW — the act page's own read carries the rendering facts for a USABLE token", async () => {
    const w = await seedArmWorld("G", 6);
    const token = captured.find((c) => c.stepInstanceId === w.stepInstanceId)!.approveToken;
    const preview = await withTenant(TENANT_WFX, () =>
      deepLinks.previewToken({ token, actorId: w.approverId }),
    );
    expect(preview).toMatchObject({
      action: "approve",
      stepInstanceId: w.stepInstanceId,
      stepOrder: 1,
      awaiting: true,
      amountBase: `${w.amount}.0000`,
      currency: "SAR",
    });
    expect(preview.stepName).toContain("Approval G");
    expect(preview.deadline).toBe(
      captured.find((c) => c.stepInstanceId === w.stepInstanceId)!.tokenDeadline,
    );
  });

  // ── the tasks arms (D-11) ──────────────────────────────────────────

  it("(h) THE TYPED LIST — the caller's own PENDING TASK steps, due-first; the other user's tasks never in my lane", async () => {
    const mineSooner = await seedArmWorld("H1", 7, { stepType: "TASK", slaHours: 2 });
    const mineLater = await seedArmWorld("H2", 8, {
      stepType: "TASK",
      slaHours: 48,
      approverId: mineSooner.approverId, // the SAME lane user (two tasks in one lane)
    });
    const theirs = await seedArmWorld("H3", 9, { stepType: "TASK", slaHours: 1 });
    const lane = await withTenant(TENANT_WFX, () =>
      taskLane.listMyTasks({ userId: mineSooner.approverId, limit: 100 }),
    );
    const ids = lane.map((row) => row.taskStepId);
    expect(ids).toContain(mineSooner.stepInstanceId);
    expect(ids).toContain(mineLater.stepInstanceId);
    expect(ids).not.toContain(theirs.stepInstanceId);
    // THE DUE-FIRST ORDER (the aging-first law): the 2h task before the
    // 48h task.
    expect(ids.indexOf(mineSooner.stepInstanceId)).toBeLessThan(ids.indexOf(mineLater.stepInstanceId));
    const row = lane.find((candidate) => candidate.taskStepId === mineSooner.stepInstanceId)!;
    expect(row.dueAt).not.toBeNull();
    expect(row.amountBase).toBe(`${mineSooner.amount}.0000`);
    expect(row.stepName).toContain("Prepare H1");
  });

  it("(i) THE COMPLETION WRITE-BACK — the task's completion is the step's own ACTED stamp; the chain completes; the receipt lands", async () => {
    const w = await seedArmWorld("I", 10, { stepType: "TASK", slaHours: 24 });
    const outcome = await withTenant(TENANT_WFX, () =>
      taskLane.completeTask({
        taskStepId: w.stepInstanceId,
        actorId: w.approverId,
        comment: "Done — documents attached",
      }),
    );
    expect(outcome).toMatchObject({ taskStepId: w.stepInstanceId, completed: true, remaining: 0 });
    const state = await chainState(TENANT_WFX, w.journalId);
    expect(state.instanceStatus).toBe("COMPLETED");
    expect(state.steps[0]!.status).toBe("APPROVED");
    expect(state.steps[0]!.actedBy).toBe(w.approverId);
    expect(state.steps[0]!.actedAt).not.toBeNull();
    expect(state.steps[0]!.comment).toBe("Done — documents attached");
    // THE LANE EMPTIES (the completed task leaves the lane).
    const lane = await withTenant(TENANT_WFX, () =>
      taskLane.listMyTasks({ userId: w.approverId, limit: 100 }),
    );
    expect(lane.map((row) => row.taskStepId)).not.toContain(w.stepInstanceId);
    // THE RECEIPT (the completion's own inbox record — the step's axis).
    const receipts = await inboxRows(TENANT_WFX, w.approverId, `workflow:task-done:${w.stepInstanceId}`);
    expect(receipts.length).toBe(1);
  });

  it("(j) THE NON-TASK REFUSAL — an APPROVAL step through the task surface takes the typed wrong-surface refusal", async () => {
    const w = await seedArmWorld("J", 11); // APPROVAL step
    try {
      await withTenant(TENANT_WFX, () =>
        taskLane.completeTask({ taskStepId: w.stepInstanceId, actorId: w.approverId, comment: null }),
      );
      expect.unreachable("the approval step through the task surface must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowStepStateError);
      const reason = String((error as WorkflowStepStateError).message);
      expect(reason).toContain("APPROVAL");
    }
    // ZERO RESIDUE.
    const state = await chainState(TENANT_WFX, w.journalId);
    expect(state.steps[0]!.status).toBe("PENDING");
  });

  it("(k) THE ACTOR LAW — another user completing my task takes the engine's typed actor refusal", async () => {
    const w = await seedArmWorld("K", 12, { stepType: "TASK", slaHours: 24 });
    try {
      await withTenant(TENANT_WFX, () =>
        taskLane.completeTask({ taskStepId: w.stepInstanceId, actorId: w.otherId, comment: null }),
      );
      expect.unreachable("the wrong actor must refuse");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowStepAlreadyActedError);
      expect(String((error as WorkflowStepAlreadyActedError).message)).toContain("not the acting user");
    }
    const state = await chainState(TENANT_WFX, w.journalId);
    expect(state.steps[0]!.status).toBe("PENDING");
  });

  it("(l) THE GRACEFUL GATE — the tasks-flag-off tenant's lane is EMPTY (the plane does not exist for it)", async () => {
    const w = await seedArmWorld("L", 13, { tenantId: TENANT_WFX_GATE, stepType: "TASK", slaHours: 24 });
    const lane = await withTenant(TENANT_WFX_GATE, () =>
      taskLane.listMyTasks({ userId: w.approverId, limit: 100 }),
    );
    expect(lane).toEqual([]);
    // The chain itself lives (the engine flag is on — the task STEP
    // exists on the chain; the LANE is the gated plane).
    const state = await chainState(TENANT_WFX_GATE, w.journalId);
    expect(state.instanceStatus).toBe("ACTIVE");
    expect(state.steps[0]!.status).toBe("PENDING");
  });

  // ── the rules-alert arms (UX-13) ───────────────────────────────────

  it("(m) THE THRESHOLD ALERT — a configured amount rule above its threshold raises the owner's inbox alert (the engine's own context)", async () => {
    const w = await seedArmWorld("M", 20, { amount: 3000 });
    const instanceId = await instanceIdOf(TENANT_WFX, w.journalId);
    const ownerAlerts = await inboxRows(
      TENANT_WFX,
      "b5b5b5b5-0000-4000-8000-000000000b01",
      "workflow:alert:High value:",
    );
    const mine = ownerAlerts.filter((row) => row.dedupeKey.endsWith(instanceId));
    expect(mine.length).toBe(1);
    expect(mine[0]!.title).toContain("High value");
    expect(mine[0]!.body).toContain(`${w.amount}.0000`);
  });

  it("(n) THE BELOW-THRESHOLD SILENCE — the rule's conditions do not hold: no alert (the chain's own assignment notification only)", async () => {
    const w = await seedArmWorld("N", 21, { amount: 900 });
    const instanceId = await instanceIdOf(TENANT_WFX, w.journalId);
    const su: Client = await superuserClient();
    const any = await su.query(
      `SELECT 1 FROM notifications WHERE tenant_id = $1 AND dedupe_key LIKE $2 LIMIT 1`,
      [TENANT_WFX, `workflow:alert:%:${instanceId}`],
    );
    expect(any.rows.length).toBe(0);
    await su.end();
    // The chain itself opened (the assignment notification landed — the
    // alert plane silent, the chain unaffected).
    const state = await chainState(TENANT_WFX, w.journalId);
    expect(state.instanceStatus).toBe("ACTIVE");
    const assignments = await inboxRows(TENANT_WFX, w.approverId, "workflow:assign:");
    expect(assignments.length).toBeGreaterThanOrEqual(1);
  });

  it("(o) THE GARBAGE RULE SKIPPED — the malformed rule never alerts, never crashes the chain open (the catch-and-continue)", async () => {
    const w = await seedArmWorld("O", 22, { amount: 3001 });
    const instanceId = await instanceIdOf(TENANT_WFX, w.journalId);
    // The chain OPENED (the garbage rule crashed nothing).
    const state = await chainState(TENANT_WFX, w.journalId);
    expect(state.instanceStatus).toBe("ACTIVE");
    expect(state.steps[0]!.status).toBe("PENDING");
    // The good rule fired (the high-value alert — exactly one row for
    // this instance; the garbage rule produced NOTHING).
    const su: Client = await superuserClient();
    const alertsForInstance = await su.query(
      `SELECT dedupe_key FROM notifications WHERE tenant_id = $1 AND dedupe_key LIKE $2`,
      [TENANT_WFX, `workflow:alert:%:${instanceId}`],
    );
    expect(alertsForInstance.rows.length).toBe(1);
    expect(alertsForInstance.rows[0]!.dedupe_key).toContain("High value");
    await su.end();
  });

  it("(p) THE NO-RULES DEFAULT — the settings-less tenant's chains raise NO alerts (the opt-in default [])", async () => {
    const w = await seedArmWorld("P", 23, { tenantId: TENANT_WFX_GATE, amount: 3000 });
    const instanceId = await instanceIdOf(TENANT_WFX_GATE, w.journalId);
    const su: Client = await superuserClient();
    const any = await su.query(
      `SELECT 1 FROM notifications WHERE tenant_id = $1 AND dedupe_key LIKE $2 LIMIT 1`,
      [TENANT_WFX_GATE, `workflow:alert:%:${instanceId}`],
    );
    expect(any.rows.length).toBe(0);
    await su.end();
    const state = await chainState(TENANT_WFX_GATE, w.journalId);
    expect(state.instanceStatus).toBe("ACTIVE");
  });

  it("(q) THE CREATOR AUDIENCE — the creator-audience rule alerts the document's creator (the person waiting on the chain)", async () => {
    const w = await seedArmWorld("Q", 24, { amount: 1500 });
    const instanceId = await instanceIdOf(TENANT_WFX, w.journalId);
    const creatorAlerts = await inboxRows(TENANT_WFX, w.creatorId, "workflow:alert:Exact 1500:");
    const mine = creatorAlerts.filter((row) => row.dedupeKey.endsWith(instanceId));
    expect(mine.length).toBe(1);
    expect(mine[0]!.title).toContain("Exact 1500");
  });
});

/** The journal's latest workflow instance id (the alerts' dedupe axis). */
async function instanceIdOf(tenantId: string, journalId: string): Promise<string> {
  const su: Client = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `SELECT id FROM workflow_instances
     WHERE tenant_id = $1 AND trigger_entity = 'manual_journal' AND trigger_entity_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [tenantId, journalId],
  );
  await su.end();
  return rows.rows[0]!.id;
}
