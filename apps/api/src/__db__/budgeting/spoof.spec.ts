import { beforeAll, describe, expect, it } from "vitest";

import {
  B_ACTOR,
  FOREIGN_FIXTURE_IDS,
  TENANT_BUD,
  TENANT_BUD_FOREIGN,
  grid,
  setupBudgetingFixture,
  su,
  versions,
  withTenant,
  type BudgetingFixture,
} from "./fixtures";

/**
 * PHASE-028 wave E spoof suite (SECURITY_TEST_PLAN §2 — the S-04 row; the
 * notes spoof precedent): foreign fiscal-year / period / account /
 * cost-center / project / branch / budget ids in budgeting payloads are
 * rejected with typed 404-shape errors and ZERO partial creation — the
 * budget row and its lines roll back together, and every lookup is
 * tenant-scoped so a foreign id is indistinguishable from an unknown one
 * (A7 — RLS makes them the same answer).
 *
 * The foreign world is REAL (a fiscal year + period + postable account +
 * cost center + project + branch + a DRAFT budget with one line, all
 * inside TENANT_BUD_FOREIGN), so the residue probes can assert the
 * foreign tenant's register never changes under attacks aimed from the
 * own tenant.
 */

const UNKNOWN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let fixture: BudgetingFixture;

beforeAll(async () => {
  fixture = await setupBudgetingFixture();
});

/** Count rows the attack must NOT have created (superuser, tenant-scoped). */
async function countRows(sql: string, params: unknown[]): Promise<number> {
  const client = await su();
  const result = await client.query<{ n: number }>(sql, params);
  await client.end();
  return result.rows[0]?.n ?? 0;
}

/** Residue surfaces inside the FOREIGN tenant (must stay untouched). */
async function foreignResidue(): Promise<Record<string, number>> {
  const client = await su();
  const count = async (table: string): Promise<number> => {
    const result = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [TENANT_BUD_FOREIGN],
    );
    return result.rows[0]?.n ?? 0;
  };
  const snapshot = {
    budgets: await count("budgets"),
    lines: await count("budget_lines"),
    years: await count("fiscal_years"),
    accounts: await count("accounts"),
  };
  await client.end();
  return snapshot;
}

describe("S-04 — foreign references in budgeting payloads → typed rejection, zero partial creation", () => {
  it("creating a budget against a foreign fiscal year is rejected (404 FiscalYearNotFound); no budget row survives", async () => {
    const before = await foreignResidue();
    const budgetsBefore = await countRows(
      "SELECT count(*)::int AS n FROM budgets WHERE tenant_id = $1",
      [TENANT_BUD],
    );
    await expect(
      withTenant(TENANT_BUD, () =>
        versions.create(
          {
            fiscalYearId: FOREIGN_FIXTURE_IDS.fiscalYear,
            scope: "ACCOUNTS",
            name: "Spoof budget (foreign year)",
          },
          B_ACTOR,
        ),
      ),
    ).rejects.toMatchObject({ code: "FISCAL_YEAR_NOT_FOUND" });
    expect(
      await countRows("SELECT count(*)::int AS n FROM budgets WHERE tenant_id = $1", [TENANT_BUD]),
    ).toBe(budgetsBefore);
    expect(await foreignResidue()).toEqual(before);
  });

  it("grid lines carrying a foreign fiscal period are rejected (BUDGET_PERIOD_MISMATCH — RLS renders it out-of-year); zero partial creation", async () => {
    const before = await foreignResidue();
    await withTenant(TENANT_BUD, async () => {
      const budget = await versions.create(
        {
          fiscalYearId: fixture.fiscalYearId,
          scope: "ACCOUNTS",
          name: "Spoof budget (foreign period)",
        },
        B_ACTOR,
      );
      await expect(
        grid.replaceGrid(
          budget.id,
          [
            {
              fiscalPeriodId: FOREIGN_FIXTURE_IDS.period,
              accountId: fixture.cogsAccountId,
              amount: "100.0000",
            },
          ],
          B_ACTOR,
        ),
      ).rejects.toMatchObject({ code: "BUDGET_PERIOD_MISMATCH" });
      // Zero residue: no line rows landed for the fresh budget.
      const detail = await versions.get(budget.id);
      expect(detail.lineCount).toBe(0);
    });
    expect(await foreignResidue()).toEqual(before);
  });

  it("grid lines carrying a foreign account id are rejected (AccountNotFoundError); zero partial creation", async () => {
    const before = await foreignResidue();
    await withTenant(TENANT_BUD, async () => {
      const budget = await versions.create(
        {
          fiscalYearId: fixture.fiscalYearId,
          scope: "ACCOUNTS",
          name: "Spoof budget (foreign account)",
        },
        B_ACTOR,
      );
      await expect(
        grid.replaceGrid(
          budget.id,
          [
            {
              fiscalPeriodId: fixture.periodIds["FY2026-01"]!,
              accountId: FOREIGN_FIXTURE_IDS.account,
              amount: "100.0000",
            },
          ],
          B_ACTOR,
        ),
      ).rejects.toMatchObject({ code: "ACCOUNT_NOT_FOUND" });
      const detail = await versions.get(budget.id);
      expect(detail.lineCount).toBe(0);
    });
    expect(await foreignResidue()).toEqual(before);
  });

  it("scope-dimension lines carrying a foreign cost center are rejected (typed 404); zero partial creation", async () => {
    const before = await foreignResidue();
    await withTenant(TENANT_BUD, async () => {
      const budget = await versions.create(
        {
          fiscalYearId: fixture.fiscalYearId,
          scope: "COST_CENTERS",
          name: "Spoof budget (foreign cost center)",
        },
        B_ACTOR,
      );
      await expect(
        grid.replaceGrid(
          budget.id,
          [
            {
              fiscalPeriodId: fixture.periodIds["FY2026-01"]!,
              accountId: fixture.cogsAccountId,
              costCenterId: FOREIGN_FIXTURE_IDS.costCenter,
              amount: "100.0000",
            },
          ],
          B_ACTOR,
        ),
      ).rejects.toMatchObject({ code: "COST_CENTER_NOT_FOUND" });
      const detail = await versions.get(budget.id);
      expect(detail.lineCount).toBe(0);
    });
    expect(await foreignResidue()).toEqual(before);
  });

  it("scope-dimension lines carrying a foreign project are rejected (ProjectNotFoundError reuse); zero partial creation", async () => {
    const before = await foreignResidue();
    await withTenant(TENANT_BUD, async () => {
      const budget = await versions.create(
        {
          fiscalYearId: fixture.fiscalYearId,
          scope: "PROJECTS",
          name: "Spoof budget (foreign project)",
        },
        B_ACTOR,
      );
      await expect(
        grid.replaceGrid(
          budget.id,
          [
            {
              fiscalPeriodId: fixture.periodIds["FY2026-01"]!,
              accountId: fixture.cogsAccountId,
              projectId: FOREIGN_FIXTURE_IDS.project,
              amount: "100.0000",
            },
          ],
          B_ACTOR,
        ),
      ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
      const detail = await versions.get(budget.id);
      expect(detail.lineCount).toBe(0);
    });
    expect(await foreignResidue()).toEqual(before);
  });

  it("scope-dimension lines carrying a foreign branch are rejected (typed 404); zero partial creation", async () => {
    const before = await foreignResidue();
    await withTenant(TENANT_BUD, async () => {
      const budget = await versions.create(
        {
          fiscalYearId: fixture.fiscalYearId,
          scope: "BRANCHES",
          name: "Spoof budget (foreign branch)",
        },
        B_ACTOR,
      );
      await expect(
        grid.replaceGrid(
          budget.id,
          [
            {
              fiscalPeriodId: fixture.periodIds["FY2026-01"]!,
              accountId: fixture.cogsAccountId,
              branchId: FOREIGN_FIXTURE_IDS.branch,
              amount: "100.0000",
            },
          ],
          B_ACTOR,
        ),
      ).rejects.toMatchObject({ code: "BRANCH_NOT_FOUND" });
      const detail = await versions.get(budget.id);
      expect(detail.lineCount).toBe(0);
    });
    expect(await foreignResidue()).toEqual(before);
  });

  it("a foreign budget id reads as 404 exactly like an unknown id (A7 parity)", async () => {
    await withTenant(TENANT_BUD, async () => {
      await expect(versions.get(FOREIGN_FIXTURE_IDS.budget)).rejects.toMatchObject({
        code: "BUDGET_NOT_FOUND",
      });
      await expect(versions.get(UNKNOWN_ID)).rejects.toMatchObject({
        code: "BUDGET_NOT_FOUND",
      });
      await expect(grid.getGrid(FOREIGN_FIXTURE_IDS.budget)).rejects.toMatchObject({
        code: "BUDGET_NOT_FOUND",
      });
      await expect(grid.getGrid(UNKNOWN_ID)).rejects.toMatchObject({
        code: "BUDGET_NOT_FOUND",
      });
    });
    // The foreign budget row itself is untouched.
    const client = await su();
    const rows = await client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM budgets WHERE tenant_id = $1 AND id = $2",
      [TENANT_BUD_FOREIGN, FOREIGN_FIXTURE_IDS.budget],
    );
    await client.end();
    expect(rows.rows[0]?.n).toBe(1);
  });
});
