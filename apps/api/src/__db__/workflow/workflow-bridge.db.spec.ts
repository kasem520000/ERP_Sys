import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { JournalService } from "../../modules/accounting/application/journal-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { WorkflowEngine } from "../../modules/workflow/application/workflow-engine";
import { PolicyBridgeService } from "../../modules/workflow/application/policy-bridge-service";
import {
  bindWorkflowEngine,
  unbindWorkflowEngine,
} from "../../modules/workflow/infrastructure/workflow-gateway";

/**
 * PHASE-052 (W-46 — T-05's DB spec, dated 2026-11-27) THE
 * APPROVAL_POLICIES BRIDGE over real PostgreSQL 16 (acceptance #9's
 * own proof): the four-mode mapping (D-12 — none → the honest
 * no-chain row · single-approver → the one-step chain · two-step →
 * the two-step chain · amount-threshold → the branch pair · the
 * origin_policy_id back-reference) + THE PARITY TEST (the documents
 * gated before/after the conversion — the same verdicts, the same
 * stamps: the REAL JournalService's own acts on both sides) + THE
 * COMPATIBILITY MODE (the in-flight documents finish under the old
 * semantics — the launch-time boundary, the instance never
 * retro-created · the unmapped doc types + the superseded versions +
 * the unentitled tenant keep the legacy path byte-identical) + THE
 * IDEMPOTENCE (the re-run converts nothing).
 *
 * THE DECLARED SEMANTIC DELTAS (D-12's approved mapping, disclosed at
 * every claim site): (1) the owner-role assignee rule — the approver
 * class narrows to the owner (the chain's actor law; the legacy
 * allowed any non-creator); (2) the amount-threshold > threshold
 * documents — the legacy REFUSAL (APPROVAL_LIMIT_EXCEEDED, the
 * single-step system's honest "needs a higher authority") becomes the
 * SECOND APPROVAL LEVEL (the branch pair's second step — the phase
 * doc §2's own exemplar scenario shape); the ≤ threshold verdicts are
 * identical.
 *
 * THE MODE-PER-TENANT DESIGN (the per-arm world law at the tenant
 * level): every mode's world is its OWN tenant (the policies are
 * per-(doc_type, applies_from) — one tenant converts ONE latest
 * journal_entry policy; the parity arms never share a register).
 */

const TENANT_WFB1 = "8c8c8c8c-8c8c-8c8c-8c8c-8c8c8c8c8c01";
const TENANT_WFB2 = "8c8c8c8c-8c8c-8c8c-8c8c-8c8c8c8c8c02";
const TENANT_WFB3 = "8c8c8c8c-8c8c-8c8c-8c8c-8c8c8c8c8c03";
const TENANT_WFB4 = "8c8c8c8c-8c8c-8c8c-8c8c-8c8c8c8c8c04";
const TENANT_WFB5 = "8c8c8c8c-8c8c-8c8c-8c8c-8c8c8c8c8c05";
const TENANT_WFB_NOENG = "8c8c8c8c-8c8c-8c8c-8c8c-8c8c8c8c8c0d";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const journals = new JournalService(audit, posting);
const engine = new WorkflowEngine(audit, new InboxService());
const bridge = new PolicyBridgeService(audit);

interface BridgeTenantWorld {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly creatorId: string;
  readonly memberId: string;
}

/** Seed ONE mode's tenant world: the tenant + the engine entitlement
 *  (except the gate's own tenant) + the owner/creator user plane + the
 *  owner role + memberships. */
async function seedBridgeTenant(
  tenantId: string,
  code: string,
  withEngine: boolean,
): Promise<BridgeTenantWorld> {
  const su: Client = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant WFB ${code}', 'المستأجر جسر ${code}', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [tenantId],
  );
  if (withEngine) {
    await su.query(
      `INSERT INTO entitlements (id, tenant_id, feature_key, source)
       VALUES (gen_random_uuid(), $1, 'workflow.engine', 'PLAN')
       ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
      [tenantId],
    );
  }
  const ownerId = generateUuidV7();
  const creatorId = generateUuidV7();
  const memberId = generateUuidV7();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, $2, 'WFB Owner ${code}', 'x', 'ACTIVE'),
       ($3, $4, 'WFB Creator ${code}', 'x', 'ACTIVE'),
       ($5, $6, 'WFB Member ${code}', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ownerId, `wfb-${code.toLowerCase()}-owner@fixture.test`, creatorId, `wfb-${code.toLowerCase()}-creator@fixture.test`, memberId, `wfb-${code.toLowerCase()}-member@fixture.test`],
  );
  const role = await su.query<{ id: string }>(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'owner', 'Owner', 'المالك') RETURNING id`,
    [tenantId],
  );
  const memberRole = await su.query<{ id: string }>(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar)
     VALUES (gen_random_uuid(), $1, $2, 'WFB Member ${code}', 'عضو ${code}') RETURNING id`,
    [tenantId, `wfb_member_${code.toLowerCase()}`],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES
       ($1, $2, $3, $4), ($5, $2, $6, $7), ($8, $2, $9, $7)
     ON CONFLICT (user_id, tenant_id) DO NOTHING`,
    [generateUuidV7(), tenantId, ownerId, role.rows[0]!.id, generateUuidV7(), creatorId, memberRole.rows[0]!.id, generateUuidV7(), memberId],
  );
  await su.end();
  return { tenantId, ownerId, creatorId, memberId };
}

/** Seed ONE policy row (the accounting register's own shape). */
async function seedPolicy(
  tenantId: string,
  docType: string,
  mode: string,
  threshold: string | null,
  appliesFrom: string,
): Promise<string> {
  const su: Client = await superuserClient();
  const row = await su.query<{ id: string }>(
    `INSERT INTO approval_policies (id, tenant_id, doc_type, policy, applies_from)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb, $4) RETURNING id`,
    [tenantId, docType, JSON.stringify({ mode, threshold, allowSelfApproval: false }), appliesFrom],
  );
  await su.end();
  return row.rows[0]!.id;
}

/** Seed ONE DRAFT balanced journal (the real tables; the service's own
 *  submit act moves it) — the amount on ONE debit + credit pair. */
async function seedDraftJournal(
  tenantId: string,
  code: string,
  creatorId: string,
  amount: string,
): Promise<string> {
  const su: Client = await superuserClient();
  accountSeq += 1;
  const journal = await su.query<{ id: string }>(
    `INSERT INTO manual_journals
       (id, tenant_id, created_by, status, entry_date, currency_code, description)
     VALUES (gen_random_uuid(), $1, $2, 'DRAFT', '2026-06-15', 'SAR', $3)
     RETURNING id`,
    [tenantId, creatorId, `WFB journal ${code}`],
  );
  const debit = await su.query<{ id: string }>(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
     VALUES (gen_random_uuid(), $1, $2, 'WFB cash', 'حساب نقدية', 'ASSET', true) RETURNING id`,
    [tenantId, String(91000 + accountSeq)],
  );
  const credit = await su.query<{ id: string }>(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable)
     VALUES (gen_random_uuid(), $1, $2, 'WFB equity', 'حساب رأس المال', 'EQUITY', true) RETURNING id`,
    [tenantId, String(92000 + accountSeq)],
  );
  await su.query(
    `INSERT INTO manual_journal_lines (id, tenant_id, manual_journal_id, line_no, account_id, direction, amount) VALUES
       (gen_random_uuid(), $1, $2, 1, $3, 'DEBIT', $4),
       (gen_random_uuid(), $1, $2, 2, $5, 'CREDIT', $4)`,
    [tenantId, journal.rows[0]!.id, debit.rows[0]!.id, amount, credit.rows[0]!.id],
  );
  await su.end();
  return journal.rows[0]!.id;
}

/** The tenant's converted definitions + their steps (the mapping's own
 *  structural assertions). */
async function convertedDefinitions(tenantId: string): Promise<
  {
    id: string;
    name: string;
    originPolicyId: string;
    triggerEntity: string;
    steps: { stepOrder: number; assigneeRule: string; assigneeValue: string; conditions: unknown }[];
  }[]
> {
  const su: Client = await superuserClient();
  const defs = await su.query<{
    id: string; name: string; originPolicyId: string; triggerEntity: string;
  }>(
    `SELECT id, name, origin_policy_id AS "originPolicyId", trigger_entity AS "triggerEntity"
     FROM workflow_definitions WHERE tenant_id = $1 ORDER BY name`,
    [tenantId],
  );
  const result = [];
  for (const def of defs.rows) {
    const steps = await su.query<{
      stepOrder: number; assigneeRule: string; assigneeValue: string; conditions: unknown;
    }>(
      `SELECT step_order AS "stepOrder", assignee_rule AS "assigneeRule",
              assignee_value AS "assigneeValue", conditions
       FROM workflow_steps WHERE tenant_id = $1 AND definition_id = $2 ORDER BY step_order`,
      [tenantId, def.id],
    );
    result.push({ ...def, steps: steps.rows });
  }
  await su.end();
  return result;
}

const worlds: Record<string, BridgeTenantWorld> = {};

/** The per-journal account code sequence (the unique (tenant, code)
 *  floor — a global counter keeps every arm's cash/equity pair unique
 *  within its tenant). */
let accountSeq = 0;

beforeAll(async () => {
  ensureTestDb();
  const su: Client = await superuserClient();
  await seedTenants(su as never);
  await su.end();
  worlds.wfb1 = await seedBridgeTenant(TENANT_WFB1, "S1", true);
  worlds.wfb2 = await seedBridgeTenant(TENANT_WFB2, "S2", true);
  worlds.wfb3 = await seedBridgeTenant(TENANT_WFB3, "S3", true);
  worlds.wfb4 = await seedBridgeTenant(TENANT_WFB4, "S4", true);
  worlds.wfb5 = await seedBridgeTenant(TENANT_WFB5, "S5", true);
  worlds.noeng = await seedBridgeTenant(TENANT_WFB_NOENG, "NG", false);
  bindWorkflowEngine(engine);
});

afterAll(() => {
  unbindWorkflowEngine();
});

// ── the arms ─────────────────────────────────────────────────────────

describe("PHASE-052 W-46 — the approval_policies bridge (the four-mode mapping + the parity + the compatibility mode; acceptance #9)", () => {
  it("(a) THE SINGLE-APPROVER PARITY — the same verdicts and stamps before/after the conversion (one act by the owner, approval_step 1); the SoD block parity; the origin back-reference", async () => {
    const w = worlds.wfb1!;
    const policyId = await seedPolicy(TENANT_WFB1, "journal_entry", "single-approver", null, "2026-01-01");

    // BEFORE — the legacy gate: one act by the owner → APPROVED.
    const before = await seedDraftJournal(TENANT_WFB1, "A1", w.creatorId, "1000.0000");
    await withTenant(TENANT_WFB1, () => journals.submit(w.creatorId, before));
    const beforeApproved = await withTenant(TENANT_WFB1, () => journals.approve(w.ownerId, before));
    expect(beforeApproved.status).toBe("APPROVED");
    expect(beforeApproved.approvalStep).toBe(1);
    // THE SoD PARITY (the BEFORE side) — the owner creates their OWN
    // journal: the legacy SoD blocks the owner's approval.
    const beforeSod = await seedDraftJournal(TENANT_WFB1, "A2", w.ownerId, "1000.0000");
    await withTenant(TENANT_WFB1, () => journals.submit(w.ownerId, beforeSod));
    const refused = await withTenant(TENANT_WFB1, () =>
      journals.approve(w.ownerId, beforeSod).catch((error: unknown) => error),
    );
    expect(String((refused as Error).constructor.name)).toContain("SelfApproval");

    // THE CONVERSION — the one-step chain on the owner-role rule.
    const outcome = await withTenant(TENANT_WFB1, () => bridge.convertPolicies({ actorId: w.ownerId }));
    expect(outcome.converted).toBe(1);
    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]).toMatchObject({
      policyId, docType: "journal_entry", mode: "single-approver",
      outcome: "CONVERTED", steps: 1,
    });
    const defs = await convertedDefinitions(TENANT_WFB1);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.originPolicyId).toBe(policyId);
    expect(defs[0]!.triggerEntity).toBe("manual_journal");
    expect(defs[0]!.steps).toHaveLength(1);
    expect(defs[0]!.steps[0]).toMatchObject({ stepOrder: 1, assigneeRule: "ROLE", assigneeValue: "owner" });

    // AFTER — the chain gate: the SAME one act by the owner → APPROVED
    // (the completion law; approval_step carries the chain's figure).
    const after = await seedDraftJournal(TENANT_WFB1, "A3", w.creatorId, "1000.0000");
    await withTenant(TENANT_WFB1, () => journals.submit(w.creatorId, after));
    const afterRow = await withTenant(TENANT_WFB1, () => journals.approve(w.ownerId, after));
    expect(afterRow.status).toBe("APPROVED");
    expect(afterRow.approvalStep).toBe(1);
    // THE SoD PARITY (the AFTER side) — the owner's OWN journal through
    // the chain: G-67's block (the chain's terminal — the owner-role
    // assignee — IS the document's creator).
    const afterSod = await seedDraftJournal(TENANT_WFB1, "A4", w.ownerId, "1000.0000");
    await withTenant(TENANT_WFB1, () => journals.submit(w.ownerId, afterSod));
    const blocked = await withTenant(TENANT_WFB1, () =>
      journals.approve(w.ownerId, afterSod).catch((error: unknown) => error),
    );
    expect(String((blocked as Error).constructor.name)).toContain("SelfApproval");
    expect((blocked as { code?: string }).code).toBe("WORKFLOW_SELF_APPROVAL_BLOCKED");
    // THE APPROVER-CLASS NARROWING (the declared delta, D-12's own
    // mapping): a THIRD user (neither the creator nor the owner) — the
    // legacy allowed their approval; the converted chain refuses (the
    // actor law — the chain's assignee is the owner alone).
    const narrowing = await seedDraftJournal(TENANT_WFB1, "A5", w.creatorId, "1000.0000");
    await withTenant(TENANT_WFB1, () => journals.submit(w.creatorId, narrowing));
    const actorRefused = await withTenant(TENANT_WFB1, () =>
      journals.approve(w.memberId, narrowing).catch((error: unknown) => error),
    );
    expect((actorRefused as { code?: string }).code).toBe("WORKFLOW_STEP_ALREADY_ACTED");
    // The owner still completes it (the chain's own class).
    const narrowedDone = await withTenant(TENANT_WFB1, () => journals.approve(w.ownerId, narrowing));
    expect(narrowedDone.status).toBe("APPROVED");
  });

  it("(b) THE TWO-STEP PARITY — two acts before, two acts after (the W-44 fall-through's latent double-gate corrected: NEVER four acts); approval_step 2 both sides", async () => {
    const w = worlds.wfb2!;
    await seedPolicy(TENANT_WFB2, "journal_entry", "two-step", null, "2026-01-01");

    // BEFORE — the legacy ladder: two acts → APPROVED, approval_step 2.
    const before = await seedDraftJournal(TENANT_WFB2, "B1", w.creatorId, "2000.0000");
    await withTenant(TENANT_WFB2, () => journals.submit(w.creatorId, before));
    const step1 = await withTenant(TENANT_WFB2, () => journals.approve(w.ownerId, before));
    expect(step1.status).toBe("PENDING_APPROVAL");
    expect(step1.approvalStep).toBe(1);
    const step2 = await withTenant(TENANT_WFB2, () => journals.approve(w.ownerId, before));
    expect(step2.status).toBe("APPROVED");
    expect(step2.approvalStep).toBe(2);

    // THE CONVERSION — the two-step chain.
    await withTenant(TENANT_WFB2, () => bridge.convertPolicies({ actorId: w.ownerId }));

    // AFTER — the chain's two acts: the mid-chain skip, then the
    // completion law (approval_step 2 = the chain's figure).
    const after = await seedDraftJournal(TENANT_WFB2, "B2", w.creatorId, "2000.0000");
    await withTenant(TENANT_WFB2, () => journals.submit(w.creatorId, after));
    const chainStep1 = await withTenant(TENANT_WFB2, () => journals.approve(w.ownerId, after));
    expect(chainStep1.status).toBe("PENDING_APPROVAL");
    const chainStep2 = await withTenant(TENANT_WFB2, () => journals.approve(w.ownerId, after));
    expect(chainStep2.status).toBe("APPROVED");
    expect(chainStep2.approvalStep).toBe(2);
  });

  it("(c) THE AMOUNT-THRESHOLD BRANCH PAIR — ≤ threshold the one-step chain (the branch's SKIPPED stamp), > threshold the two-step chain (the declared mapping: the second level instead of the legacy refusal); the at-limit law", async () => {
    const w = worlds.wfb3!;
    await seedPolicy(TENANT_WFB3, "journal_entry", "amount-threshold", "10000.0000", "2026-01-01");

    // BEFORE — the legacy: ≤ threshold one act → APPROVED; > threshold
    // the REFUSAL (the honest delta's BEFORE side — the single-step
    // system's "needs a higher authority"). NOTE the journal's amount
    // law: totalBaseAmount sums EVERY line (DEBIT + CREDIT — the W-44
    // facts law verbatim), so a balanced pair at X per line reads 2X.
    const beforeSmall = await seedDraftJournal(TENANT_WFB3, "C1", w.creatorId, "2500.0000");
    await withTenant(TENANT_WFB3, () => journals.submit(w.creatorId, beforeSmall));
    const smallApproved = await withTenant(TENANT_WFB3, () => journals.approve(w.ownerId, beforeSmall));
    expect(smallApproved.status).toBe("APPROVED");
    const beforeBig = await seedDraftJournal(TENANT_WFB3, "C2", w.creatorId, "10000.0000");
    await withTenant(TENANT_WFB3, () => journals.submit(w.creatorId, beforeBig));
    const legacyRefusal = await withTenant(TENANT_WFB3, () =>
      journals.approve(w.ownerId, beforeBig).catch((error: unknown) => error),
    );
    expect(String((legacyRefusal as Error).constructor.name)).toContain("ApprovalLimit");

    // THE CONVERSION — the branch pair (step 2 carries amountBase >
    // threshold — the W-44 conditional-chain idiom).
    await withTenant(TENANT_WFB3, () => bridge.convertPolicies({ actorId: w.ownerId }));
    const defs = await convertedDefinitions(TENANT_WFB3);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.steps).toHaveLength(2);
    expect(defs[0]!.steps[1]).toMatchObject({ stepOrder: 2 });
    expect(defs[0]!.steps[1]!.conditions).toEqual({
      all: [{ field: "amountBase", op: "gt", value: "10000.0000" }],
    });

    // AFTER — the small journal (total 5000): the one-step chain (the
    // branch SKIPPED at trigger time), one act → APPROVED, approval_step 1.
    const afterSmall = await seedDraftJournal(TENANT_WFB3, "C3", w.creatorId, "2500.0000");
    await withTenant(TENANT_WFB3, () => journals.submit(w.creatorId, afterSmall));
    const smallAfter = await withTenant(TENANT_WFB3, () => journals.approve(w.ownerId, afterSmall));
    expect(smallAfter.status).toBe("APPROVED");
    expect(smallAfter.approvalStep).toBe(1);

    // THE AT-LIMIT LAW — the total EXACTLY at the threshold (5000 per
    // line × 2 = 10000): the gt branch is false, the one-step chain (≤
    // passes — the BR-034 boundary).
    const atLimit = await seedDraftJournal(TENANT_WFB3, "C4", w.creatorId, "5000.0000");
    await withTenant(TENANT_WFB3, () => journals.submit(w.creatorId, atLimit));
    const atLimitRow = await withTenant(TENANT_WFB3, () => journals.approve(w.ownerId, atLimit));
    expect(atLimitRow.status).toBe("APPROVED");
    expect(atLimitRow.approvalStep).toBe(1);

    // THE BIG JOURNAL (total 20000 > 10000) — the declared mapping: the
    // second approval level (two acts → APPROVED, approval_step 2)
    // instead of the refusal.
    const afterBig = await seedDraftJournal(TENANT_WFB3, "C5", w.creatorId, "10000.0000");
    await withTenant(TENANT_WFB3, () => journals.submit(w.creatorId, afterBig));
    const bigStep1 = await withTenant(TENANT_WFB3, () => journals.approve(w.ownerId, afterBig));
    expect(bigStep1.status).toBe("PENDING_APPROVAL");
    const bigStep2 = await withTenant(TENANT_WFB3, () => journals.approve(w.ownerId, afterBig));
    expect(bigStep2.status).toBe("APPROVED");
    expect(bigStep2.approvalStep).toBe(2);
  });

  it("(d) THE NONE MODE + THE SUPERSEDED VERSION + THE UNMAPPED DOC TYPE — the honest rows: no definition lands, the legacy path byte-identical (the none auto-approval)", async () => {
    const w = worlds.wfb4!;
    const olderPolicy = await seedPolicy(TENANT_WFB4, "journal_entry", "single-approver", null, "2026-01-01");
    const nonePolicy = await seedPolicy(TENANT_WFB4, "journal_entry", "none", null, "2026-06-01");
    const unmapped = await seedPolicy(TENANT_WFB4, "expense_report", "single-approver", null, "2026-01-01");

    const outcome = await withTenant(TENANT_WFB4, () => bridge.convertPolicies({ actorId: w.ownerId }));
    expect(outcome.converted).toBe(0);
    const byId = new Map(outcome.records.map((record) => [record.policyId, record]));
    expect(byId.get(nonePolicy)).toMatchObject({ outcome: "NO_CHAIN_NEEDED", mode: "none" });
    expect(byId.get(olderPolicy)).toMatchObject({ outcome: "SUPERSEDED", mode: "single-approver" });
    expect(byId.get(unmapped)).toMatchObject({ outcome: "UNMAPPED_DOC_TYPE", docType: "expense_report" });
    expect(await convertedDefinitions(TENANT_WFB4)).toHaveLength(0);

    // THE NONE AUTO-APPROVAL — byte-identical after the conversion (no
    // chain, the submit-time APPROVED — the none mode's own path).
    const none = await seedDraftJournal(TENANT_WFB4, "D1", w.creatorId, "1000.0000");
    const autoApproved = await withTenant(TENANT_WFB4, () => journals.submit(w.creatorId, none));
    expect(autoApproved.status).toBe("APPROVED");
  });

  it("(e) THE IN-FLIGHT COMPLETION — a document submitted BEFORE the conversion finishes under the OLD semantics (the launch-time boundary: the instance is never retro-created); a document submitted AFTER gates under the chain", async () => {
    const w = worlds.wfb5!;
    await seedPolicy(TENANT_WFB5, "journal_entry", "two-step", null, "2026-01-01");

    // The in-flight document: submitted under the old semantics.
    const inFlight = await seedDraftJournal(TENANT_WFB5, "E1", w.creatorId, "3000.0000");
    await withTenant(TENANT_WFB5, () => journals.submit(w.creatorId, inFlight));

    // THE CONVERSION (the launch boundary).
    await withTenant(TENANT_WFB5, () => bridge.convertPolicies({ actorId: w.ownerId }));

    // The in-flight document completes under the OLD semantics — no
    // chain instance was created for it (never retro-created); the
    // legacy two-step ladder carries it.
    const su: Client = await superuserClient();
    const instances = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM workflow_instances
       WHERE tenant_id = $1 AND trigger_entity_id = $2`,
      [TENANT_WFB5, inFlight],
    );
    expect(instances.rows[0]!.n).toBe("0");
    await su.end();
    const legacy1 = await withTenant(TENANT_WFB5, () => journals.approve(w.ownerId, inFlight));
    expect(legacy1.status).toBe("PENDING_APPROVAL");
    expect(legacy1.approvalStep).toBe(1);
    const legacy2 = await withTenant(TENANT_WFB5, () => journals.approve(w.ownerId, inFlight));
    expect(legacy2.status).toBe("APPROVED");
    expect(legacy2.approvalStep).toBe(2);

    // A document submitted AFTER the boundary gates under the chain.
    const after = await seedDraftJournal(TENANT_WFB5, "E2", w.creatorId, "3000.0000");
    await withTenant(TENANT_WFB5, () => journals.submit(w.creatorId, after));
    const su2: Client = await superuserClient();
    const afterInstances = await su2.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM workflow_instances
       WHERE tenant_id = $1 AND trigger_entity_id = $2 AND status = 'ACTIVE'`,
      [TENANT_WFB5, after],
    );
    expect(afterInstances.rows[0]!.n).toBe("1");
    await su2.end();
  });

  it("(f) THE ENTITLEMENT GATE — the engine-off tenant: the bridge is silent (no records, no definitions) and the legacy path is permanent", async () => {
    const w = worlds.noeng!;
    await seedPolicy(TENANT_WFB_NOENG, "journal_entry", "single-approver", null, "2026-01-01");

    const outcome = await withTenant(TENANT_WFB_NOENG, () =>
      bridge.convertPolicies({ actorId: w.ownerId }),
    );
    expect(outcome).toEqual({ records: [], converted: 0 });
    expect(await convertedDefinitions(TENANT_WFB_NOENG)).toHaveLength(0);

    // The legacy path carries the approvals permanently.
    const journalId = await seedDraftJournal(TENANT_WFB_NOENG, "F1", w.creatorId, "1000.0000");
    await withTenant(TENANT_WFB_NOENG, () => journals.submit(w.creatorId, journalId));
    const approved = await withTenant(TENANT_WFB_NOENG, () => journals.approve(w.ownerId, journalId));
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvalStep).toBe(1);
  });

  it("(g) THE IDEMPOTENCE — the re-run converts NOTHING (every record ALREADY_CONVERTED, no new definitions)", async () => {
    const w = worlds.wfb1!;
    const before = (await convertedDefinitions(TENANT_WFB1)).length;
    const outcome = await withTenant(TENANT_WFB1, () => bridge.convertPolicies({ actorId: w.ownerId }));
    expect(outcome.converted).toBe(0);
    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]!.outcome).toBe("ALREADY_CONVERTED");
    expect(await convertedDefinitions(TENANT_WFB1)).toHaveLength(before);
  });
});
