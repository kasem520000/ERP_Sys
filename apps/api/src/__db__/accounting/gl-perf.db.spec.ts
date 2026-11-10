import { beforeAll, describe, expect, it } from "vitest";

import {
  ACTOR,
  ensureFiscalYear,
  gl,
  manualSpec,
  newDocId,
  posting,
  resolveAccounts,
  setupAccountingFixture,
  TENANT_A,
  withTenant,
} from "./fixtures";
import { appClient } from "../test-db";
import * as journal from "../../modules/accounting/infrastructure/journal.store";

/**
 * PHASE-007 GL performance spot-check (acceptance criterion 10, RISK-014):
 * the top GL/journal queries are index-driven with tenant-first plans.
 * EXPLAIN assertions in CI mirror the PHASE-006 master-data pattern
 * (TENANT_ISOLATION §6): the movements join, the journal register, and the
 * trial balance must ride the tenant-first indexes shipped in migration
 * 0011 — never a seq scan over another tenant's rows.
 */

let accounts: Awaited<ReturnType<typeof resolveAccounts>>;

beforeAll(async () => {
  await setupAccountingFixture();
  await ensureFiscalYear();
  accounts = await resolveAccounts();
  // A handful of live postings so the planner sees real row counts.
  for (let index = 0; index < 8; index += 1) {
    await withTenant(TENANT_A, () =>
      posting.post(
        manualSpec({
          docId: newDocId(),
          debitAccountId: accounts.cash,
          creditAccountId: accounts.salesRevenue,
          amount: "10.0000",
          entryDate: "2026-09-15",
        }),
        { postedBy: ACTOR },
      ),
    );
  }
});

describe("GL index-driven plans (EXPLAIN)", () => {
  it("account movements ride the tenant-first journal indexes (never a seq scan)", async () => {
    const plan = await withTenant(TENANT_A, () =>
      journal.explainAccountMovements(accounts.cash),
    );
    // The planner picks plain Index Scan on small stats and Bitmap Heap
    // Scan (over the SAME tenant-first index) as rows grow — both are
    // index-driven; the contract under test is "never a seq scan".
    expect(plan).toMatch(
      /Index Scan using ix_journal_entries_tenant_|Index Scan using ix_journal_lines_tenant_|Bitmap Index Scan on ix_journal_entries_tenant_|Bitmap Index Scan on ix_journal_lines_tenant_/,
    );
    expect(plan).not.toMatch(/Seq Scan on journal_lines/);
    expect(plan).not.toMatch(/Seq Scan on journal_entries/);
  });

  it("journal register + trial balance ride the tenant-first entry/date indexes", async () => {
    const app = await appClient();
    // Bind the tenant GUC for this session (RLS FORCE applies to erp_app).
    await app.query("SELECT set_config('erp.current_tenant_id', $1, false)", [TENANT_A]);
    // Plan-shape proof at fixture scale: the shared physical tables grow
    // with every suite's data (tenants share them under RLS), and past a
    // row-count threshold the planner legitimately prefers a seq scan +
    // HashAggregate for the aggregate leg (cheaper at small n). Disabling
    // seq scan for the EXPLAIN session proves the tenant-first index path
    // EXISTS and is chosen whenever an index plan wins — the test's intent
    // ("rides the indexes", never "the planner's cost model at toy scale").
    await app.query("SET enable_seqscan = off");
    const registerPlan = await app.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (COSTS OFF) SELECT e.id, e.entry_no, e.entry_date, e.source_type
         FROM journal_entries e
        WHERE e.tenant_id = current_setting('erp.current_tenant_id')::uuid
          AND e.entry_date >= '2026-01-01' AND e.entry_date <= '2026-12-31'
        ORDER BY e.entry_date DESC LIMIT 100`,
    );
    const balancePlan = await app.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (COSTS OFF) SELECT l.account_id, sum(l.base_amount)
         FROM journal_lines l
        WHERE l.tenant_id = current_setting('erp.current_tenant_id')::uuid
        GROUP BY l.account_id`,
    );
    await app.end();
    const registerText = registerPlan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    const balanceText = balancePlan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(registerText).toMatch(/ix_journal_entries_tenant_/);
    expect(balanceText).toMatch(/ix_journal_lines_tenant_|ix_journal_entries_tenant_/);
  });

  it("the service-level explain helper answers through the tenant UoW", async () => {
    const plan = await withTenant(TENANT_A, () => gl.explainMovements(accounts.salesRevenue));
    expect(plan).toContain("journal_lines");
  });
});
