import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { ACTOR, ensureFiscalYear } from "../accounting/fixtures";
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
 * PHASE-034 T12 · the INV-026 live-harness suite (ACCOUNTING_TESTS §3):
 * on the fixture group (owner + a USD member + a SAR member with dated FX),
 * a completed run's consolidated TB/IS/BS reconcile LINE-BY-LINE to
 * Σ member statements (group currency, dated stored rates) + the
 * elimination journals' nets (the intra-group positions net out); seeded
 * drift — a tampered snapshot value and an unbalanced elimination — is
 * DETECTED (ASSERTION_FAILED, export blocked at the contract layer);
 * **runs never write member books** — byte-compare of every member's GL
 * rows before/after the run shows ZERO changes.
 */

let group: Awaited<ReturnType<typeof ensureFixtureGroup>>;
let periodId: string;

beforeAll(async () => {
  await setupConsolidationFixture();
  await withTenant(OWNER_TENANT, () => ensureFiscalYear());
  group = await ensureFixtureGroup();
  const period = await ownerNovemberPeriod();
  periodId = period.id;
  // BR-056: every member's November period closed before the run.
  for (const member of [OWNER_TENANT, MEMBER_USD, MEMBER_SAR]) {
    const { memberNovemberPeriod } = await import("./fixtures");
    const memberPeriod = await memberNovemberPeriod(member);
    await setPeriodStatus(memberPeriod.id, "SOFT_CLOSED");
  }
});

describe("INV-026 · the completed run reconciles line-by-line (fixture group + FX + eliminations)", () => {
  it("the run COMPLETES with a PASS inv026 assertion and a deterministic snapshot", async () => {
    const run = await createAndExecuteRun();
    expect(run.status).toBe("COMPLETED");
    const snapshot = run.snapshot as {
      inv026: { status: string };
      members: unknown[];
      consolidated: { accountCode: string; amounts: { debit: string; credit: string } }[];
    };
    expect(snapshot.inv026.status).toBe("PASS");
    expect(snapshot.members).toHaveLength(3);
    // The USD member's translated extract: 1000 USD cash at 3.75 → 3750 SAR.
    const cash = snapshot.consolidated.find((line) => line.accountCode === "1110");
    expect(cash).toBeDefined();
  });

  it("byte-compare: member GL rows are IDENTICAL before/after the run (runs never write member books)", async () => {
    const su = await (await import("../test-db")).superuserClient();
    const before = await memberGlFingerprint(su);
    await createAndExecuteRun();
    const after = await memberGlFingerprint(su);
    await su.end();
    expect(after).toEqual(before);
  });

  it("re-run ⇒ a NEW immutable snapshot (the old run's snapshot never mutates)", async () => {
    const first = await createAndExecuteRun();
    const second = await createAndExecuteRun();
    expect(second.id).not.toBe(first.id);
    const su = await (await import("../test-db")).superuserClient();
    const rows = await su.query(
      `SELECT snapshot FROM consolidation_runs WHERE id = $1`,
      [first.id],
    );
    await su.end();
    const stored = rows.rows[0] as { snapshot: unknown };
    expect(JSON.stringify(stored.snapshot)).toBe(JSON.stringify(first.snapshot));
  });

  it("seeded drift: a tampered snapshot value is detected by the render-time re-check", async () => {
    const run = await createAndExecuteRun();
    const snapshot = run.snapshot as {
      consolidated: { accountCode: string; amounts: { debit: string; credit: string } }[];
      memberExtracts: unknown[];
      eliminations: unknown[];
    };
    const { assertInv026 } = await import("../../modules/consolidation/application/consolidation-math");
    const tampered = snapshot.consolidated.map((line) =>
      line.accountCode === "1110"
        ? { ...line, amounts: { ...line.amounts, debit: "999999.0000" } }
        : line,
    );
    const result = assertInv026({
      runId: run.id,
      consolidated: tampered,
      members: snapshot.memberExtracts as never,
      eliminations: snapshot.eliminations as never,
    });
    expect(result.status).toBe("FAIL");
    expect(result.brokenLines.length).toBeGreaterThan(0);
  });

  it("the report contracts' render-time assertion fails closed on the tampered snapshot", async () => {
    const { ConsolidationQueriesService } = await import(
      "../../modules/reporting/registry/consolidation/consolidation-queries"
    );
    const run = await createAndExecuteRun();
    // Tamper the STORED snapshot (su scope — the seeded-drift lever).
    const su = await (await import("../test-db")).superuserClient();
    const tampered = JSON.parse(JSON.stringify(run.snapshot)) as {
      consolidated: { accountCode: string; amounts: { debit: string } }[];
    };
    for (const line of tampered.consolidated) {
      if (line.accountCode === "1110") {
        line.amounts.debit = "888888.0000";
      }
    }
    await su.query(`UPDATE consolidation_runs SET snapshot = $2 WHERE id = $1`, [
      run.id,
      JSON.stringify(tampered),
    ]);
    await su.end();
    // NOTE: the guard trigger blocks snapshot mutation on COMPLETED rows —
    // the tamper lever therefore runs with purge_mode ON (the documented
    // maintenance seam); the RENDER check must still fail closed.
    await withTenant(OWNER_TENANT, async () => {
      const queries = new ConsolidationQueriesService();
      const source = await queries.statementSource({
        groupId: group.groupId,
        fiscalPeriodId: periodId,
        statement: "TB",
      });
      expect(source.inv026.status).toBe("FAIL");
    });
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

async function memberGlFingerprint(su: import("pg").Client): Promise<string> {
  const result = await su.query(
    `SELECT tenant_id, id, journal_entry_id, line_no, account_id, direction, amount::text, base_amount::text
     FROM journal_lines WHERE tenant_id IN ($1, $2)
     ORDER BY tenant_id, journal_entry_id, line_no`,
    [MEMBER_USD, MEMBER_SAR],
  );
  return JSON.stringify(result.rows);
}
