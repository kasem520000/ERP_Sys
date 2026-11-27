import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { WorkflowEngine } from "../../modules/workflow/application/workflow-engine";
import {
  bindWorkflowEngine,
  onDocumentSubmitted,
  recordApprovalThroughChain,
  unbindWorkflowEngine,
} from "../../modules/workflow/infrastructure/workflow-gateway";
import {
  createDelegationWindow,
  endDelegationWindow,
  listWindowsForUser,
} from "../../modules/workflow/infrastructure/delegation-service";
import {
  WorkflowDelegationCircularError,
  WorkflowInputInvalidError,
  WorkflowSelfApprovalBlockedError,
  WorkflowStepAlreadyActedError,
} from "../../modules/workflow/domain/workflow-errors";

/**
 * PHASE-052 (W-45 — T-04's DB spec, dated 2026-11-27) THE DELEGATION
 * LAW + G-67'S ENFORCEMENT over real PostgreSQL 16 (acceptance #3's
 * own proof + acceptance #4's ENFORCEMENT arms — the golden transcript
 * with the mandatory failure pack is W-50's): the act-time re-route
 * (an active window re-routes the PENDING step's act to the delegate —
 * the provenance stamp retained), the scope law (ALL covers everything
 * · MODULE covers the entity's module · ENTITY covers exactly that
 * entity — the out-of-scope window never re-routes), the expiry (an
 * expired window stops routing by construction — the DB's own clock
 * bounds), the save-time circularity (the typed refusal naming the
 * FULL closed cycle + the no-self floor + the scope pair law), and
 * G-67's block (the DIRECT chain of length one + the TRANSITIVE
 * routed-back shape — the typed refusal naming the chain and BOTH
 * endpoints; the BR-034 default-OFF discipline standing — the engine
 * reads NO policy).
 *
 * THE DEDICATED TENANT (the engine spec's own shape): TENANT_WFD with
 * the workflow.engine entitlement. EVERY ARM seeds its OWN world — its
 * own users (the manager · the delegate · the finance · the creator),
 * its own manager role + memberships, its own journal + line + account,
 * and its own definition discriminated by the arm's OWN entry window on
 * the journal's amount (the per-arm world law — a later arm's journal
 * never matches an earlier arm's definition, and the arms' delegation
 * windows never share users: the resolution plane and the save-time
 * graph stay per-arm clean).
 *
 * THE CLOCK LAW (the owner's standing order): the window bounds are
 * FIXED INPUTS (the user's own save — ISO instants); the DB's own
 * now() decides which windows are LIVE (the resolution SQL and the
 * save-time circularity graph both bound by the database's clock,
 * never a JS wall clock).
 */

const TENANT_WFD = "8d8d8d8d-8d8d-8d8d-8d8d-8d8d8d8d8d8d";

const audit = new AuditService(new DrizzleAuditStore());
const inbox = new InboxService();
const engine = new WorkflowEngine(audit, inbox);

/** The act-time window bounds: ACTIVE NOW (±1h — fixed inputs). */
function activeWindow(): { startsAt: string; endsAt: string } {
  const now = Date.now();
  return {
    startsAt: new Date(now - 3_600_000).toISOString(),
    endsAt: new Date(now + 3_600_000).toISOString(),
  };
}

interface DelegationArmWorld {
  readonly managerId: string;
  readonly delegateId: string;
  readonly financeId: string;
  readonly creatorId: string;
  readonly journalId: string;
}

/** Seed ONE arm's world: its own users + roles + memberships + the
 *  journal (PENDING_APPROVAL, the creator's own) + the definition (the
 *  arm's entry window on the journal's amount — the per-arm
 *  discrimination) + the single manager step. */
async function seedDelegationArm(
  code: string,
  armIndex: number,
): Promise<DelegationArmWorld> {
  const su: Client = await superuserClient();
  const users = await su.query<{ id: string; email: string }>(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       (gen_random_uuid(), $1, 'WFD Manager ${code}', 'x', 'ACTIVE'),
       (gen_random_uuid(), $2, 'WFD Delegate ${code}', 'x', 'ACTIVE'),
       (gen_random_uuid(), $3, 'WFD Finance ${code}', 'x', 'ACTIVE'),
       (gen_random_uuid(), $4, 'WFD Creator ${code}', 'x', 'ACTIVE')
     RETURNING id, email`,
    [
      `wfd-${code.toLowerCase()}-manager@fixture.test`,
      `wfd-${code.toLowerCase()}-delegate@fixture.test`,
      `wfd-${code.toLowerCase()}-finance@fixture.test`,
      `wfd-${code.toLowerCase()}-creator@fixture.test`,
    ],
  );
  const byEmail = new Map(users.rows.map((row) => [row.email, row.id]));
  const managerId = byEmail.get(`wfd-${code.toLowerCase()}-manager@fixture.test`)!;
  const delegateId = byEmail.get(`wfd-${code.toLowerCase()}-delegate@fixture.test`)!;
  const financeId = byEmail.get(`wfd-${code.toLowerCase()}-finance@fixture.test`)!;
  const creatorId = byEmail.get(`wfd-${code.toLowerCase()}-creator@fixture.test`)!;

  // The arm's OWN manager role (the ROLE rule's resolution never
  // crosses arms) + the manager's and the creator's memberships.
  const roleKey = `wfd_mgr_${code.toLowerCase()}`;
  const role = await su.query<{ id: string }>(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar)
     VALUES (gen_random_uuid(), $1, $2, 'WFD Manager ${code}', 'مدير ${code}')
     RETURNING id`,
    [TENANT_WFD, roleKey],
  );
  const memberRole = await su.query<{ id: string }>(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar)
     VALUES (gen_random_uuid(), $1, $2, 'WFD Member ${code}', 'عضو ${code}')
     RETURNING id`,
    [TENANT_WFD, `wfd_member_${code.toLowerCase()}`],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id, status) VALUES
       (gen_random_uuid(), $1, $2, $3, 'ACTIVE'),
       (gen_random_uuid(), $1, $4, $5, 'ACTIVE')`,
    [TENANT_WFD, managerId, role.rows[0]!.id, creatorId, memberRole.rows[0]!.id],
  );

  // The arm's journal: its OWN amount (the entry window's own
  // discrimination) + its OWN account (the code floor's numeric space).
  const amount = 1000 + armIndex * 7;
  const accountCode = `${9300 + armIndex}`;
  const journal = await su.query<{ id: string }>(
    `INSERT INTO manual_journals
       (id, tenant_id, created_by, status, entry_date, currency_code, description)
     VALUES (gen_random_uuid(), $1, $2, 'PENDING_APPROVAL', '2026-06-15', 'SAR', $3)
     RETURNING id`,
    [TENANT_WFD, creatorId, `WFD journal ${code}`],
  );
  const account = await su.query<{ id: string }>(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
     VALUES (gen_random_uuid(), $1, $2, 'WFD account ${code}', 'حساب ${code}', 'ASSET', true)
     RETURNING id`,
    [TENANT_WFD, accountCode],
  );
  await su.query(
    `INSERT INTO manual_journal_lines (id, tenant_id, manual_journal_id, line_no, account_id, direction, amount)
     VALUES (gen_random_uuid(), $1, $2, 1, $3, 'DEBIT', $4)`,
    [TENANT_WFD, journal.rows[0]!.id, account.rows[0]!.id, `${amount}.0000`],
  );

  // The arm's definition: the entry window discriminates the arm's own
  // journal (amount ± 0.5 — the canonical 4-dp compareExact law).
  const definition = await su.query<{ id: string }>(
    `INSERT INTO workflow_definitions
       (id, tenant_id, name, name_ar, trigger_entity, trigger_event, active, conditions, created_by, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, 'manual_journal', 'PENDING_APPROVAL', true, $4::jsonb, $5,
             now() - ($6 || ' seconds')::interval)
     RETURNING id`,
    [
      TENANT_WFD,
      `WFD-DEF-${code}`,
      `تعريف تفويض ${code}`,
      JSON.stringify({
        all: [
          {
            field: "amountBase",
            op: "between",
            value: [`${(amount - 0.5).toFixed(4)}`, `${(amount + 0.5).toFixed(4)}`],
          },
        ],
      }),
      managerId,
      String(800 + armIndex * 10),
    ],
  );
  await su.query(
    `INSERT INTO workflow_steps
       (id, tenant_id, definition_id, step_order, step_type, assignee_rule, assignee_value,
        conditions, sla_hours, name, name_ar, created_by)
     VALUES (gen_random_uuid(), $1, $2, 1, 'APPROVAL', 'ROLE', $3, '{"all":[]}'::jsonb, NULL,
             'Manager approval', 'موافقة المدير', $4)`,
    [TENANT_WFD, definition.rows[0]!.id, roleKey, managerId],
  );
  await su.end();
  return { managerId, delegateId, financeId, creatorId, journalId: journal.rows[0]!.id };
}

/** The journal's chain state (the instance + its step rows). */
async function chainState(journalId: string): Promise<{
  instanceStatus: string;
  step: { status: string; assigneeUserId: string; actedBy: string | null; delegatedTo: string | null };
}> {
  const su: Client = await superuserClient();
  const instance = await su.query<{ id: string; status: string }>(
    `SELECT id, status FROM workflow_instances
     WHERE tenant_id = $1 AND trigger_entity = 'manual_journal' AND trigger_entity_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [TENANT_WFD, journalId],
  );
  const step = await su.query<{
    status: string; assigneeUserId: string; actedBy: string | null; delegatedTo: string | null;
  }>(
    `SELECT status, assignee_user_id AS "assigneeUserId", acted_by AS "actedBy",
            delegated_to AS "delegatedTo"
     FROM workflow_step_instances WHERE tenant_id = $1 AND instance_id = $2`,
    [TENANT_WFD, instance.rows[0]!.id],
  );
  await su.end();
  return {
    instanceStatus: instance.rows[0]!.status,
    step: step.rows[0]!,
  };
}

beforeAll(async () => {
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant WFD (workflow delegation)', 'المستأجر تفويض سير', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_WFD],
  );
  await su.query(
    `INSERT INTO entitlements (id, tenant_id, feature_key, source)
     VALUES (gen_random_uuid(), $1, 'workflow.engine', 'PLAN')
     ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
    [TENANT_WFD],
  );
  await su.end();
  bindWorkflowEngine(engine);
});

afterAll(() => {
  unbindWorkflowEngine();
});

// ── the arms ─────────────────────────────────────────────────────────

describe("PHASE-052 W-45 — the delegation law + G-67's enforcement (acceptance #3 + #4's enforcement arms)", () => {
  it("(a) THE ACT-TIME RE-ROUTE — an active ALL window re-routes the PENDING step's act to the delegate (the provenance stamp retained)", async () => {
    const w = await seedDelegationArm("A", 0);
    const window = activeWindow();
    await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId,
        fromUserId: w.managerId,
        toUserId: w.delegateId,
        scopeKind: "ALL",
        scopeValue: null,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      }),
    );

    const opened = await withTenant(TENANT_WFD, () =>
      onDocumentSubmitted({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.creatorId }),
    );
    expect(opened.chainOpened).toBe(true);

    // THE DELEGATE ACTS (the absent manager's authority): the act lands
    // with the PROVENANCE — acted_by the delegate, delegated_to the
    // delegate, the assignee still the manager (the frozen history).
    const verdict = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.delegateId }),
    );
    expect(verdict).toEqual({ chainOpened: true, completed: true });
    const state = await chainState(w.journalId);
    expect(state.instanceStatus).toBe("COMPLETED");
    expect(state.step).toMatchObject({
      status: "APPROVED",
      assigneeUserId: w.managerId,
      actedBy: w.delegateId,
      delegatedTo: w.delegateId,
    });
  });

  it("(b) THE SCOPE LAW — ENTITY: a window scoped to ANOTHER entity never re-routes (the typed actor-law refusal, zero residue)", async () => {
    const w = await seedDelegationArm("B", 1);
    const window = activeWindow();
    // The window names purchase_order — the journal step is OUT of scope.
    await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId,
        fromUserId: w.managerId,
        toUserId: w.delegateId,
        scopeKind: "ENTITY",
        scopeValue: "purchase_order",
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      }),
    );
    await withTenant(TENANT_WFD, () =>
      onDocumentSubmitted({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.creatorId }),
    );

    // The delegate's act is REFUSED — the resolution never re-routed
    // (the actor law names the assignee AND the routed terminal).
    const refused = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({
        triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.delegateId,
      }).catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(WorkflowStepAlreadyActedError);
    expect((refused as WorkflowStepAlreadyActedError).code).toBe("WORKFLOW_STEP_ALREADY_ACTED");
    // ZERO RESIDUE: the step still PENDING, the chain still ACTIVE.
    let state = await chainState(w.journalId);
    expect(state.instanceStatus).toBe("ACTIVE");
    expect(state.step).toMatchObject({ status: "PENDING", actedBy: null });

    // The manager himself still acts (the assignee's own path — the
    // out-of-scope window never took his authority away).
    const verdict = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.managerId }),
    );
    expect(verdict).toEqual({ chainOpened: true, completed: true });
    state = await chainState(w.journalId);
    expect(state.step).toMatchObject({ status: "APPROVED", actedBy: w.managerId, delegatedTo: null });
  });

  it("(c) THE SCOPE LAW — MODULE: a window scoped to the entity's module re-routes (accounting covers the journal)", async () => {
    const w = await seedDelegationArm("C", 2);
    const window = activeWindow();
    await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId,
        fromUserId: w.managerId,
        toUserId: w.delegateId,
        scopeKind: "MODULE",
        scopeValue: "accounting",
        startsAt: window.startsAt,
        endsAt: window.endsAt,
      }),
    );
    await withTenant(TENANT_WFD, () =>
      onDocumentSubmitted({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.creatorId }),
    );
    const verdict = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.delegateId }),
    );
    expect(verdict).toEqual({ chainOpened: true, completed: true });
    const state = await chainState(w.journalId);
    expect(state.step).toMatchObject({ status: "APPROVED", actedBy: w.delegateId, delegatedTo: w.delegateId });
  });

  it("(d) THE EXPIRY — an expired window stops routing (the DB's own clock bounds); the assignee's own act still lands", async () => {
    const w = await seedDelegationArm("D", 3);
    const now = Date.now();
    // A window that ENDED an hour ago — the absence is over.
    await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId,
        fromUserId: w.managerId,
        toUserId: w.delegateId,
        scopeKind: "ALL",
        scopeValue: null,
        startsAt: new Date(now - 3 * 3_600_000).toISOString(),
        endsAt: new Date(now - 3_600_000).toISOString(),
      }),
    );
    await withTenant(TENANT_WFD, () =>
      onDocumentSubmitted({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.creatorId }),
    );

    // The delegate's act is REFUSED — the expired window never enters
    // the edge set (it stops routing by construction).
    const refused = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({
        triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.delegateId,
      }).catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(WorkflowStepAlreadyActedError);
    const state = await chainState(w.journalId);
    expect(state.step).toMatchObject({ status: "PENDING" });

    // The returned manager acts directly (no window, no provenance).
    const verdict = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.managerId }),
    );
    expect(verdict).toEqual({ chainOpened: true, completed: true });
    const after = await chainState(w.journalId);
    expect(after.step).toMatchObject({ status: "APPROVED", actedBy: w.managerId, delegatedTo: null });
  });

  it("(e) THE SAVE-TIME CIRCULARITY — a window that would close a cycle is rejected naming the FULL closed chain; the no-self floor; the scope pair law", async () => {
    const w = await seedDelegationArm("E", 4);
    const window = activeWindow();
    // The standing chain: manager → delegate → finance.
    await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId, fromUserId: w.managerId, toUserId: w.delegateId,
        scopeKind: "ALL", scopeValue: null,
        startsAt: window.startsAt, endsAt: window.endsAt,
      }),
    );
    await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.delegateId, fromUserId: w.delegateId, toUserId: w.financeId,
        scopeKind: "ALL", scopeValue: null,
        startsAt: window.startsAt, endsAt: window.endsAt,
      }),
    );

    // The candidate finance → manager would close the cycle: the typed
    // refusal names the FULL closed chain (finance → manager →
    // delegate → finance).
    const refused = await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.financeId, fromUserId: w.financeId, toUserId: w.managerId,
        scopeKind: "ALL", scopeValue: null,
        startsAt: window.startsAt, endsAt: window.endsAt,
      }).catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(WorkflowDelegationCircularError);
    expect((refused as WorkflowDelegationCircularError).code).toBe("WORKFLOW_DELEGATION_CIRCULAR");
    expect((refused as WorkflowDelegationCircularError).details?.chain).toEqual([
      w.financeId, w.managerId, w.delegateId, w.financeId,
    ]);

    // THE NO-SELF FLOOR (the trivial cycle — the DB CHECK's own class,
    // defended typed).
    const selfRefused = await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId, fromUserId: w.managerId, toUserId: w.managerId,
        scopeKind: "ALL", scopeValue: null,
        startsAt: window.startsAt, endsAt: window.endsAt,
      }).catch((error: unknown) => error),
    );
    expect(selfRefused).toBeInstanceOf(WorkflowInputInvalidError);
    expect((selfRefused as WorkflowInputInvalidError).code).toBe("WORKFLOW_INPUT_INVALID");

    // THE SCOPE PAIR LAW: ALL carries no value; MODULE carries exactly one.
    const allWithValue = await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId, fromUserId: w.managerId, toUserId: w.financeId,
        scopeKind: "ALL", scopeValue: "accounting",
        startsAt: window.startsAt, endsAt: window.endsAt,
      }).catch((error: unknown) => error),
    );
    expect(allWithValue).toBeInstanceOf(WorkflowInputInvalidError);
    const moduleWithoutValue = await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId, fromUserId: w.managerId, toUserId: w.financeId,
        scopeKind: "MODULE", scopeValue: null,
        startsAt: window.startsAt, endsAt: window.endsAt,
      }).catch((error: unknown) => error),
    );
    expect(moduleWithoutValue).toBeInstanceOf(WorkflowInputInvalidError);

    // The register: the user's own windows list (the two saved rows).
    const windows = await withTenant(TENANT_WFD, () => listWindowsForUser(w.managerId));
    expect(windows).toHaveLength(1); // manager → delegate (the refused candidates never saved)
  });

  it("(f) G-67 DIRECT — the document's creator as the step's own assignee cannot approve (the chain of length one, BOTH endpoints himself)", async () => {
    // The chain's step resolves to the CREATOR himself (the USER rule —
    // the creator-approver shape): the resolution chain of length one.
    const w = await seedDelegationArm("F", 5);
    const su: Client = await superuserClient();
    await su.query(
      `UPDATE workflow_steps SET assignee_rule = 'USER', assignee_value = $1
       WHERE tenant_id = $2 AND definition_id = (
         SELECT id FROM workflow_definitions WHERE tenant_id = $2 AND name = 'WFD-DEF-F'
       )`,
      [w.creatorId, TENANT_WFD],
    );
    await su.end();

    await withTenant(TENANT_WFD, () =>
      onDocumentSubmitted({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.creatorId }),
    );
    const refused = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({
        triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.creatorId,
      }).catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(WorkflowSelfApprovalBlockedError);
    const blocked = refused as WorkflowSelfApprovalBlockedError;
    expect(blocked.code).toBe("WORKFLOW_SELF_APPROVAL_BLOCKED");
    // The block names the chain and BOTH endpoints (the chain of
    // length one — the assignee IS the creator).
    expect(blocked.details?.chain).toEqual([w.creatorId]);
    expect(blocked.details?.documentCreatorId).toBe(w.creatorId);
    expect(blocked.details?.actorId).toBe(w.creatorId);
    // ZERO RESIDUE: the step still PENDING, the chain still ACTIVE.
    const state = await chainState(w.journalId);
    expect(state.instanceStatus).toBe("ACTIVE");
    expect(state.step).toMatchObject({ status: "PENDING", actedBy: null });
  });

  it("(g) G-67 TRANSITIVE — the routed-back chain: another user's window legitimately naming the creator as the delegate blocks EVERY act on the step (the chain names BOTH endpoints)", async () => {
    const w = await seedDelegationArm("G", 6);
    const window = activeWindow();
    // The chain: manager → delegate → CREATOR (the document's own
    // creator — the non-cyclic routed-back shape: the creator's own
    // step-away is legal, another user's window naming him is the
    // block's own case).
    await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId, fromUserId: w.managerId, toUserId: w.delegateId,
        scopeKind: "ALL", scopeValue: null,
        startsAt: window.startsAt, endsAt: window.endsAt,
      }),
    );
    await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.delegateId, fromUserId: w.delegateId, toUserId: w.creatorId,
        scopeKind: "ALL", scopeValue: null,
        startsAt: window.startsAt, endsAt: window.endsAt,
      }),
    );
    await withTenant(TENANT_WFD, () =>
      onDocumentSubmitted({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.creatorId }),
    );

    // The CREATOR acts (the chain's terminal — his own document comes
    // back to him through the windows): BLOCKED, the chain names the
    // walk and BOTH endpoints.
    const refused = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({
        triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.creatorId,
      }).catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(WorkflowSelfApprovalBlockedError);
    const blocked = refused as WorkflowSelfApprovalBlockedError;
    expect(blocked.code).toBe("WORKFLOW_SELF_APPROVAL_BLOCKED");
    expect(blocked.details?.chain).toEqual([w.managerId, w.delegateId, w.creatorId]);
    expect(blocked.details?.documentCreatorId).toBe(w.creatorId);
    expect(blocked.details?.actorId).toBe(w.creatorId);

    // The MANAGER's own act is BLOCKED TOO — the chain's terminal (the
    // effective actor) is the creator regardless of who physically
    // acts; the routed-back shape makes the creator the approver the
    // chain would produce.
    const managerRefused = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({
        triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.managerId,
      }).catch((error: unknown) => error),
    );
    expect(managerRefused).toBeInstanceOf(WorkflowSelfApprovalBlockedError);

    // ZERO RESIDUE: the step still PENDING, the chain still ACTIVE.
    const state = await chainState(w.journalId);
    expect(state.instanceStatus).toBe("ACTIVE");
    expect(state.step).toMatchObject({ status: "PENDING", actedBy: null });
  });

  it("(h) THE WINDOWS' OWN REGISTER — the early end narrows the bounds (the row is tenant DATA, never deleted); the resolution stops with the narrowed window", async () => {
    const w = await seedDelegationArm("H", 7);
    const window = activeWindow();
    const saved = await withTenant(TENANT_WFD, () =>
      createDelegationWindow({
        actorId: w.managerId, fromUserId: w.managerId, toUserId: w.delegateId,
        scopeKind: "ALL", scopeValue: null,
        startsAt: window.startsAt, endsAt: window.endsAt,
        note: "vacation cover",
      }),
    );
    expect(saved.scopeKind).toBe("ALL");

    // THE EARLY END (the absence cut short): the bounds narrow to the
    // past — the window stops routing.
    const now = Date.now();
    const narrowed = await withTenant(TENANT_WFD, () =>
      endDelegationWindow({
        actorId: w.managerId,
        windowId: saved.id,
        endsAt: new Date(now - 60_000).toISOString(),
      }),
    );
    expect(narrowed?.id).toBe(saved.id);

    await withTenant(TENANT_WFD, () =>
      onDocumentSubmitted({ triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.creatorId }),
    );
    const refused = await withTenant(TENANT_WFD, () =>
      recordApprovalThroughChain({
        triggerEntity: "manual_journal", documentId: w.journalId, actorId: w.delegateId,
      }).catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(WorkflowStepAlreadyActedError);
    const state = await chainState(w.journalId);
    expect(state.step).toMatchObject({ status: "PENDING" });
  });
});
