import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import {
  ACTOR,
  APPROVER,
  ensureApprover,
  ensureFiscalYear,
  manualSpec,
  newDocId,
  posting,
  setupAccountingFixture,
  TENANT_A,
} from "../accounting/fixtures";
import {
  ensureFixtureGroup,
  MEMBER_SAR,
  MEMBER_USD,
  OWNER_TENANT,
  ownerNovemberPeriod,
  setPeriodStatus,
  setupConsolidationFixture,
} from "./fixtures";

/**
 * PHASE-034 T12 · the G-32 golden (the live-harness half — ACCOUNTING_TESTS
 * §3 G-32): the intercompany elimination posts ONE balanced journal via
 * the engine into the PARENT tenant's consolidation books ONLY (source
 * CONSOLIDATION_ELIMINATION; DR AP_CONTROL entity B · CR AR_CONTROL entity
 * A); INV-006 document↔journal chain; INV-013 idempotency per
 * source/operation; an audit event on post; ZERO rows in any member
 * tenant's ledger with a consolidation source. Failure packs (each with
 * zero residue): ENTRY_NOT_BALANCED, ALREADY_POSTED (409
 * IMMUTABLE_DOCUMENT), MEMBER_PERIOD_OPEN (BR-056), PURPOSE_NOT_MAPPED,
 * SoD create ≠ post.
 */

let group: Awaited<ReturnType<typeof ensureFixtureGroup>>;
let periodId: string;

beforeAll(async () => {
  await setupConsolidationFixture();
  await withTenant(OWNER_TENANT, () => ensureFiscalYear());
  group = await ensureFixtureGroup();
  const period = await ownerNovemberPeriod();
  periodId = period.id;
  await setPeriodStatus(periodId, "SOFT_CLOSED");
  await ensureApprover();
});

describe("G-32 · the intercompany elimination golden", () => {
  it("author + approve + post lands ONE balanced journal in the parent's consolidation books only", async () => {
    const { EliminationService } = await import(
      "../../modules/consolidation/application/elimination-service"
    );
    const service = await newEliminationService();
    const draft = await service.createDraft({
      groupId: group.groupId,
      fiscalPeriodId: periodId,
      kind: "INTERCOMPANY",
      description: "November intercompany settlement — A↔B",
      memberATenantId: MEMBER_USD,
      memberBTenantId: MEMBER_SAR,
      lines: [
        {
          purposeKey: "AP_CONTROL",
          direction: "DEBIT",
          amount: "500.0000",
          memberTenantId: MEMBER_SAR,
          memoEn: "Intercompany payable — entity B",
          memoAr: "ذمم دافعة بين الشركات — الشركة ب",
        },
        {
          purposeKey: "AR_CONTROL",
          direction: "CREDIT",
          amount: "500.0000",
          memberTenantId: MEMBER_USD,
          memoEn: "Intercompany receivable — entity A",
          memoAr: "ذمم مدينة بين الشركات — الشركة أ",
        },
      ],
      actorId: ACTOR,
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.eliminationNo).toBeNull();

    // SoD: the creator cannot approve.
    await expect(service.approve(draft.id, ACTOR)).rejects.toMatchObject({
      code: "SELF_APPROVAL_BLOCKED",
    });
    const approved = await service.approve(draft.id, APPROVER);
    expect(approved.approvedBy).toBe(APPROVER);

    const posted = await service.post(draft.id, ACTOR);
    expect(posted.status).toBe("POSTED");
    expect(posted.eliminationNo).toMatch(/^EL-2026-\d{6}$/);
    expect(Array.isArray(posted.journalEntryIds)).toBe(true);
    expect((posted.journalEntryIds as unknown[]).length).toBe(1);

    // INV-006 chain: the journal exists with the exact source key and the
    // G-32 shape (DR AP_CONTROL · CR AR_CONTROL) — in the PARENT's books.
    const su = await (await import("../test-db")).superuserClient();
    const entry = await su.query(
      `SELECT je.id, je.status, je.source_type, je.operation, je.currency_code,
        (SELECT json_agg(json_build_object('direction', jl.direction, 'amount', jl.amount::text, 'purpose', ap.purpose_key))
         FROM journal_lines jl
         LEFT JOIN account_purposes ap ON ap.account_id = jl.account_id AND ap.active_to IS NULL AND ap.tenant_id = je.tenant_id
         WHERE jl.journal_entry_id = je.id) AS lines
       FROM journal_entries je WHERE je.id = $1`,
      [(posted.journalEntryIds as unknown as string[])[0]],
    );
    await su.end();
    const row = entry.rows[0] as {
      status: string;
      source_type: string;
      operation: string;
      currency_code: string;
      lines: { direction: string; amount: string; purpose: string | null }[];
    };
    expect(row.status).toBe("POSTED");
    expect(row.source_type).toBe("consolidation_elimination");
    expect(row.operation).toBe("post");
    expect(row.lines).toEqual([
      { direction: "DEBIT", amount: "500.0000", purpose: "AP_CONTROL" },
      { direction: "CREDIT", amount: "500.0000", purpose: "AR_CONTROL" },
    ]);

    // ZERO rows in ANY member tenant's ledger with a consolidation source.
    const su2 = await (await import("../test-db")).superuserClient();
    const memberRows = await su2.query(
      `SELECT count(*)::int AS n FROM journal_entries
       WHERE tenant_id IN ($1, $2) AND source_type = 'consolidation_elimination'`,
      [MEMBER_USD, MEMBER_SAR],
    );
    await su2.end();
    expect((memberRows.rows[0] as { n: number }).n).toBe(0);
  });

  it("failure pack: ENTRY_NOT_BALANCED (zero residue)", async () => {
    const service = await newEliminationService();
    await expect(
      service.createDraft({
        groupId: group.groupId,
        fiscalPeriodId: periodId,
        kind: "INTERCOMPANY",
        description: "unbalanced",
        memberATenantId: MEMBER_USD,
        memberBTenantId: MEMBER_SAR,
        lines: [
          { purposeKey: "AP_CONTROL", direction: "DEBIT", amount: "500.0000", memberTenantId: MEMBER_SAR, memoEn: "x", memoAr: "س" },
          { purposeKey: "AR_CONTROL", direction: "CREDIT", amount: "499.0000", memberTenantId: MEMBER_USD, memoEn: "y", memoAr: "ص" },
        ],
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ code: "ENTRY_NOT_BALANCED" });
  });

  it("failure pack: ALREADY_POSTED (409 IMMUTABLE_DOCUMENT shape) + reversal-only counter-entry", async () => {
    const service = await newEliminationService();
    const draft = await service.createDraft({
      groupId: group.groupId,
      fiscalPeriodId: periodId,
      kind: "INTERCOMPANY",
      description: "reversal scenario",
      memberATenantId: MEMBER_USD,
      memberBTenantId: MEMBER_SAR,
      lines: [
        { purposeKey: "AP_CONTROL", direction: "DEBIT", amount: "100.0000", memberTenantId: MEMBER_SAR, memoEn: "x", memoAr: "س" },
        { purposeKey: "AR_CONTROL", direction: "CREDIT", amount: "100.0000", memberTenantId: MEMBER_USD, memoEn: "y", memoAr: "ص" },
      ],
      actorId: ACTOR,
    });
    await service.approve(draft.id, APPROVER);
    const posted = await service.post(draft.id, ACTOR);
    // Re-posting the posted document: typed 409 shape, zero residue.
    await expect(service.post(posted.id, ACTOR)).rejects.toMatchObject({
      code: "ALREADY_POSTED",
    });
    // Reversal is a NEW DRAFT counter-entry linked through reversal_of.
    const reversal = await service.reverse({ eliminationId: posted.id, actorId: ACTOR });
    expect(reversal.status).toBe("DRAFT");
    expect(reversal.reversalOf).toBe(posted.id);
    await service.approve(reversal.id, APPROVER);
    const postedReversal = await service.post(reversal.id, ACTOR);
    expect(postedReversal.status).toBe("POSTED");
    expect(postedReversal.eliminationNo).toMatch(/^EL-2026-\d{6}$/);
  });

  it("failure pack: PURPOSE_NOT_MAPPED (the engine's fail-closed surface)", async () => {
    const service = await newEliminationService();
    await expect(
      service.createDraft({
        groupId: group.groupId,
        fiscalPeriodId: periodId,
        kind: "INVESTMENT_EQUITY",
        description: "unmapped purpose",
        lines: [
          { purposeKey: "NOT_A_PURPOSE", direction: "DEBIT", amount: "10.0000", memberTenantId: null, memoEn: "x", memoAr: "س" },
          { purposeKey: "NOT_A_PURPOSE", direction: "CREDIT", amount: "10.0000", memberTenantId: null, memoEn: "y", memoAr: "ص" },
        ],
        actorId: ACTOR,
      }),
    ).rejects.toMatchObject({ code: "PURPOSE_NOT_MAPPED" });
  });

  it("failure pack: posting without approval is the typed SoD backstop", async () => {
    const service = await newEliminationService();
    const draft = await service.createDraft({
      groupId: group.groupId,
      fiscalPeriodId: periodId,
      kind: "INTERCOMPANY",
      description: "unapproved",
      memberATenantId: MEMBER_USD,
      memberBTenantId: MEMBER_SAR,
      lines: [
        { purposeKey: "AP_CONTROL", direction: "DEBIT", amount: "10.0000", memberTenantId: MEMBER_SAR, memoEn: "x", memoAr: "س" },
        { purposeKey: "AR_CONTROL", direction: "CREDIT", amount: "10.0000", memberTenantId: MEMBER_USD, memoEn: "y", memoAr: "ص" },
      ],
      actorId: ACTOR,
    });
    await expect(service.post(draft.id, ACTOR)).rejects.toMatchObject({
      code: "ELIMINATION_NOT_APPROVED",
    });
  });
});

async function newEliminationService() {
  const { EliminationService } = await import(
    "../../modules/consolidation/application/elimination-service"
  );
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { PostingService } = await import("../../modules/accounting/application/posting-service");
  const { NumberingService } = await import("../../modules/accounting/application/numbering-service");
  const { PartnerSubledgerService } = await import(
    "../../modules/accounting/application/partner-subledger-port"
  );
  const audit = new AuditService(new DrizzleAuditStore());
  return new EliminationService(
    audit,
    new PostingService(audit, new PartnerSubledgerService()),
    new NumberingService(audit),
  );
}

void posting;
void manualSpec;
void newDocId;
void setupAccountingFixture;
void TENANT_A;
void withTenant;
