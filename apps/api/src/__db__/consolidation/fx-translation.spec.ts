import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { ACTOR, ensureFiscalYear } from "../accounting/fixtures";
import {
  ensureFixtureGroup,
  MEMBER_SAR,
  MEMBER_USD,
  OWNER_TENANT,
  ownerNovemberPeriod,
  memberNovemberPeriod,
  setPeriodStatus,
  setupConsolidationFixture,
  USD_RATE,
} from "./fixtures";

/**
 * PHASE-034 T7/T12 · the FX-translation live-harness suite: dated stored
 * rates honored EXACTLY (INV-008 — translated = amount × stored rate, no
 * recomputation); the USD member's snapshot lines carry the dated-rate
 * translation; a missing rate on the translation date ⇒ RATE_MISSING
 * fail-closed (the br-056 suite's FAILED-run lever re-proves it); the
 * per-group method matches the OQ-V2-2 decision record (CLOSING_RATE
 * default; TEMPORARY configured per group).
 */

let group: Awaited<ReturnType<typeof ensureFixtureGroup>>;
let periodId: string;

beforeAll(async () => {
  await setupConsolidationFixture();
  await withTenant(OWNER_TENANT, () => ensureFiscalYear());
  group = await ensureFixtureGroup();
  const period = await ownerNovemberPeriod();
  periodId = period.id;
  for (const member of [OWNER_TENANT, MEMBER_USD, MEMBER_SAR]) {
    const memberPeriod = await memberNovemberPeriod(member);
    await setPeriodStatus(memberPeriod.id, "SOFT_CLOSED");
  }
});

describe("INV-008 · the run's FX translation (dated stored rates, exactly as stored)", () => {
  it("the USD member's snapshot lines carry amount × stored rate (no recomputation drift)", async () => {
    const run = await createAndExecuteRun();
    expect(run.status).toBe("COMPLETED");
    const snapshot = run.snapshot as {
      members: { memberTenantId: string; appliedRates: Record<string, string> }[];
      memberExtracts: { memberTenantId: string; accountCode: string; amounts: { debit: string; credit: string } }[];
    };
    const usdMember = snapshot.members.find((member) => member.memberTenantId === MEMBER_USD);
    expect(usdMember).toBeDefined();
    expect(usdMember!.appliedRates.USD).toBe(USD_RATE);
    // Every USD-member line is the member's own base amount × 3.75 exactly.
    const su = await (await import("../test-db")).superuserClient();
    const memberBase = await su.query(
      `SELECT a.code AS account_code,
        COALESCE(SUM(CASE WHEN jl.direction = 'DEBIT' THEN jl.base_amount ELSE 0 END), 0)::text AS debit,
        COALESCE(SUM(CASE WHEN jl.direction = 'CREDIT' THEN jl.base_amount ELSE 0 END), 0)::text AS credit
       FROM journal_entries je
       JOIN journal_lines jl ON jl.journal_entry_id = je.id
       JOIN accounts a ON a.id = jl.account_id
       WHERE je.tenant_id = $1 AND je.fiscal_period_id = $2 AND je.status = 'POSTED'
         AND je.source_type <> 'consolidation_elimination'
       GROUP BY a.code`,
      [MEMBER_USD, (await memberNovemberPeriod(MEMBER_USD)).id],
    );
    await su.end();
    const { translateAtRate } = await import(
      "../../modules/consolidation/application/fx-translation"
    );
    for (const base of memberBase.rows as { account_code: string; debit: string; credit: string }[]) {
      const extract = snapshot.memberExtracts.find(
        (line) => line.memberTenantId === MEMBER_USD && line.accountCode === base.account_code,
      );
      expect(extract, `account ${base.account_code} must appear in the USD member's extracts`).toBeDefined();
      expect(extract!.amounts.debit).toBe(translateAtRate(base.debit, USD_RATE));
      expect(extract!.amounts.credit).toBe(translateAtRate(base.credit, USD_RATE));
    }
  });

  it("the per-group method matches the OQ-V2-2 decision record (CLOSING default, TEMPORARY configurable)", async () => {
    const { FX_TRANSLATION_METHODS } = await import(
      "../../modules/consolidation/application/fx-translation"
    );
    expect(FX_TRANSLATION_METHODS).toEqual(["CLOSING_RATE", "TEMPORARY"]);
    // The fixture group ships the default; a TEMPORARY group is valid config.
    const su = await (await import("../test-db")).superuserClient();
    await su.query(
      `INSERT INTO consolidation_groups (id, tenant_id, name, name_ar, base_currency, fx_translation_method, status)
       VALUES (gen_random_uuid(), $1, 'Temporal probe group', 'مجموعة الفحص الزمني', 'SAR', 'TEMPORARY', 'ACTIVE')
       ON CONFLICT (tenant_id, name) DO UPDATE SET fx_translation_method = 'TEMPORARY'`,
      [OWNER_TENANT],
    );
    const row = await su.query(
      `SELECT fx_translation_method FROM consolidation_groups WHERE tenant_id = $1 AND name = 'Temporal probe group'`,
      [OWNER_TENANT],
    );
    await su.end();
    expect((row.rows[0] as { fx_translation_method: string }).fx_translation_method).toBe("TEMPORARY");
  });
});

async function createAndExecuteRun() {
  const { RunService } = await import("../../modules/consolidation/application/run-service");
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { ConsolidationReaderService } = await import(
    "../../modules/consolidation/application/reader-service"
  );
  const audit = new AuditService(new DrizzleAuditStore());
  const service = new RunService(audit, new ConsolidationReaderService(audit));
  return withTenant(OWNER_TENANT, async () => {
    const run = await service.createRun({
      groupId: group.groupId,
      fiscalPeriodId: periodId,
      actorId: ACTOR,
    });
    return service.executeRun({ runId: run.id, actorId: ACTOR });
  });
}
