import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

import { Decimal } from "@erp/domain-core";

import * as journalStore from "../../modules/accounting/infrastructure/journal.store";
import {
  B_ACTOR,
  B_APPROVER,
  TENANT_BUD,
  bPosting,
  consumption,
  grid,
  guard,
  imports,
  setupBudgetingFixture,
  su,
  versions,
  withTenant,
  workflow,
  type BudgetingFixture,
} from "./fixtures";
import { buildGridXlsx, parseGridXlsxAsync } from "../../modules/budgeting/infrastructure/xlsx-grid-adapter";
import { ledgerTie, varianceRows } from "../../modules/reporting/registry/budgeting/budgeting-queries";
import { invalidateConsumptionCache } from "../../modules/budgeting/application/consumption-service";

/**
 * budgeting-rules.spec (PHASE-028 wave E — BUSINESS_RULES §8 rows
 * BR-050/BR-051 + the phase §6 verification matrix): the budgeting
 * business rules exercised against real PostgreSQL through the module
 * services exactly as production code paths run — no direct register
 * inserts — and the NEGATIVE LEDGER PROOF: budgets post nothing, ever.
 *
 * State flow (DB specs share the file's world — the order is deliberate):
 * the lifecycle test creates ACTIVE #1 (12 × 1,000.00 on COGS); the
 * variance/controls/tie suites read that world; the supersede test then
 * produces ACTIVE #2 (period 4 raised to 1,250.00) and flips #1 to
 * REVISED; the immutability suite closes ACTIVE #2 (readable forever).
 *
 * - BR-050: exactly one ACTIVE version per (fiscal year, scope) — the DB
 *   partial unique rejects a second ACTIVE insert AND the service flips
 *   the predecessor to REVISED atomically at activation (supersede-never-
 *   edit); non-DRAFT budgets are immutable (409 IMMUTABLE_DOCUMENT).
 * - BR-051: controls are ADVISORY by default (an over-budget draft-save
 *   evaluation succeeds with exactly one warning); ENFORCE_DRAFT blocks
 *   the DRAFT save with the typed, audited BUDGET_EXCEEDED reason.
 * - The variance worked example (phase §6): budget 12,000.00 over 12
 *   periods (1,000.00 each), actual 750.00 in period 4 ⇒ variance
 *   −250.00, variance % −25.0000.
 * - The ledger tie: green over the real GL world; seeded drift (a skewed
 *   trial-balance read) flips it to FAIL.
 * - Import/export: XLSX round-trip preserves every line; the dry-run
 *   reports per-row typed errors with ZERO writes.
 * - The negative ledger proof: journal_entries/journal_lines counts are
 *   byte-identical before/after the FULL budgeting operation set, and the
 *   fixture's PostingService.post spy records ZERO submissions during it
 *   (budgeting is structurally ledger-incapable — DR-004).
 */

let fixture: BudgetingFixture;
let journalCountBefore: { entries: number; lines: number };
const postSpy = vi.spyOn(bPosting, "post");

beforeAll(async () => {
  fixture = await setupBudgetingFixture();
  // The negative-ledger snapshot: taken AFTER the GL world mints (the
  // fixture's own posting), BEFORE any budgeting operation.
  const client = await su();
  const entries = await client.query(
    "SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = $1",
    [TENANT_BUD],
  );
  const lines = await client.query(
    "SELECT COUNT(*)::int AS n FROM journal_lines WHERE tenant_id = $1",
    [TENANT_BUD],
  );
  await client.end();
  journalCountBefore = {
    entries: entries.rows[0]!.n as number,
    lines: lines.rows[0]!.n as number,
  };
  expect(journalCountBefore.entries).toBeGreaterThanOrEqual(3);
  postSpy.mockClear();
});

afterAll(async () => {
  postSpy.mockRestore();
});

// -- spec helpers ----------------------------------------------------------------------

/** Canonical 4dp normalization for pg numeric text reads. */
function n4(value: string | number | null | undefined): string {
  return new Decimal(String(value ?? "0")).toDecimalPlaces(4).toFixed(4);
}

let suffixCounter = 0;
function generateSuffix(): string {
  suffixCounter += 1;
  return `R${suffixCounter}`;
}

/** A fresh DRAFT ACCOUNTS-scope budget with the worked-example grid
 * (12 periods × 1,000.00 on COGS). */
async function mintDraftBudget(): Promise<string> {
  const budget = await versions.create(
    {
      fiscalYearId: fixture.fiscalYearId,
      scope: "ACCOUNTS",
      name: `Rules budget ${generateSuffix()}`,
      nameAr: "موازنة القواعد",
    },
    B_ACTOR,
  );
  await grid.replaceGrid(
    budget.id,
    Object.values(fixture.periodIds).map((periodId) => ({
      fiscalPeriodId: periodId,
      accountId: fixture.cogsAccountId,
      amount: "1000.0000",
    })),
    B_ACTOR,
  );
  return budget.id;
}

/** The ACTIVE ACCOUNTS-scope budget of the fixture year. */
async function activeAccountsBudget(): Promise<string> {
  const actives = (await versions.list({ status: "ACTIVE", scope: "ACCOUNTS" })).filter(
    (row) => row.fiscalYearId === fixture.fiscalYearId,
  );
  expect(actives).toHaveLength(1);
  return actives[0]!.id;
}

// -- BR-050: the version machine --------------------------------------------------------

describe("BR-050 — one ACTIVE per (fiscal year, scope); revisions supersede, never edit", () => {
  it("the full lifecycle: create → grid → submit → approve (distinct approver) → activate", async () => {
    await withTenant(TENANT_BUD, async () => {
      const budgetId = await mintDraftBudget();
      const submitted = await workflow.submit(budgetId, B_ACTOR);
      expect(submitted.status).toBe("PENDING_APPROVAL");
      expect(submitted.submittedBy).toBe(B_ACTOR);
      const approved = await workflow.approve(budgetId, B_APPROVER);
      expect(approved.status).toBe("PENDING_APPROVAL");
      expect(approved.approvedAt).not.toBeNull();
      const activated = await workflow.activate(budgetId, B_APPROVER);
      expect(activated.status).toBe("ACTIVE");
      expect(activated.activatedAt).not.toBeNull();
    });
  });

  it("self-approval is blocked (SoD — AUTHORIZATION_MATRIX §4 row budgeting.budgets.approve) with zero residue", async () => {
    await withTenant(TENANT_BUD, async () => {
      const budgetId = await mintDraftBudget();
      await workflow.submit(budgetId, B_ACTOR);
      await expect(workflow.approve(budgetId, B_ACTOR)).rejects.toMatchObject({
        code: "BUDGET_SELF_APPROVAL",
      });
      const budget = await versions.get(budgetId);
      expect(budget.budget.approvedAt).toBeNull();
    });
  });

  it("activation without an approval stamp is refused (the two-step gate)", async () => {
    await withTenant(TENANT_BUD, async () => {
      const budgetId = await mintDraftBudget();
      await workflow.submit(budgetId, B_ACTOR);
      await expect(workflow.activate(budgetId, B_APPROVER)).rejects.toMatchObject({
        code: "BUDGET_NOT_APPROVED",
      });
    });
  });

  it("a second ORIGINAL activation against the existing ACTIVE is a typed 409 (service level)", async () => {
    await withTenant(TENANT_BUD, async () => {
      const budgetId = await mintDraftBudget();
      await workflow.submit(budgetId, B_ACTOR);
      await workflow.approve(budgetId, B_APPROVER);
      await expect(workflow.activate(budgetId, B_APPROVER)).rejects.toMatchObject({
        code: "BUDGET_ACTIVE_EXISTS",
      });
    });
  });

  it("the DB partial unique rejects a second ACTIVE row outright (BR-050's race backstop)", async () => {
    const client = await su();
    await expect(
      client.query(
        `INSERT INTO budgets (id, tenant_id, code, fiscal_year_id, scope, name, revision_no, status, activated_at, activated_by)
         VALUES (gen_random_uuid(), $1, 'BUD-2026-99', $2, 'ACCOUNTS', 'Second active', 1, 'ACTIVE', now(), $3)`,
        [TENANT_BUD, fixture.fiscalYearId, B_APPROVER],
      ),
    ).rejects.toThrow(/uq_budgets_one_active/);
    await client.end();
  });

  it("period-out-of-year and scope-dimension shape rejections leave zero residue", async () => {
    await withTenant(TENANT_BUD, async () => {
      const budgetId = await mintDraftBudget();
      await expect(
        grid.replaceGrid(
          budgetId,
          [
            {
              // A foreign fiscal period (the S-04 world) — typed rejection.
              fiscalPeriodId: "e8e8e8e8-0000-4000-8000-000000000002",
              accountId: fixture.cogsAccountId,
              amount: "1.0000",
            },
          ],
          B_ACTOR,
        ),
      ).rejects.toMatchObject({ code: "BUDGET_PERIOD_MISMATCH" });
      await expect(
        grid.replaceGrid(
          budgetId,
          [
            {
              // ACCOUNTS-scope line carrying a cost center — shape rejection.
              fiscalPeriodId: fixture.periodIds["FY2026-01"]!,
              accountId: fixture.cogsAccountId,
              costCenterId: fixture.costCenterId,
              amount: "1.0000",
            },
          ],
          B_ACTOR,
        ),
      ).rejects.toMatchObject({ code: "BUDGET_SCOPE_DIMENSION" });
      const after = await grid.getGrid(budgetId);
      expect(after.lines).toHaveLength(12);
      expect(n4(after.totals.year)).toBe("12000.0000");
    });
  });
});

// -- the variance worked example (phase §6) ----------------------------------------------

describe("the variance engine — the −25.00% worked example (read-only, as-of)", () => {
  it("budget 1,000.00 in period 4 vs actual 750.00 ⇒ variance −250.00 / −25.0000%", async () => {
    await withTenant(TENANT_BUD, async () => {
      const budgetId = await activeAccountsBudget();
      const { rows } = await varianceRows({ budgetId, asOf: "2026-12-31" });
      const period4 = rows.find((row) => row.fiscalPeriodId === fixture.periodIds["FY2026-04"]);
      expect(period4).toBeDefined();
      expect(n4(period4!.budget)).toBe("1000.0000");
      expect(n4(period4!.actual)).toBe("750.0000");
      expect(n4(period4!.variance)).toBe("-250.0000");
      expect(period4!.variancePct).toBe("-25.0000");
      // As-of determinism: the same (budget, asOf) → identical rows.
      const again = await varianceRows({ budgetId, asOf: "2026-12-31" });
      expect(again.rows).toEqual(rows);
      // The as-of bound: period 5's 200.00 lands only at asOf ≥ its date.
      const cut = await varianceRows({ budgetId, asOf: "2026-04-30" });
      const period5 = cut.rows.find((row) => row.fiscalPeriodId === fixture.periodIds["FY2026-05"]);
      expect(period5).toBeDefined();
      expect(n4(period5!.actual)).toBe("0.0000");
    });
  });

  it("consumption banners read live per period with cache invalidation", async () => {
    await withTenant(TENANT_BUD, async () => {
      const budgetId = await activeAccountsBudget();
      invalidateConsumptionCache();
      const snapshot = await consumption.consumptionForBudget(budgetId);
      expect(snapshot.periods).toHaveLength(12);
      const period4 = snapshot.periods.find(
        (period) => period.fiscalPeriodId === fixture.periodIds["FY2026-04"],
      );
      expect(period4).toBeDefined();
      expect(period4!.rows).toHaveLength(1);
      expect(n4(period4!.rows[0]!.budget)).toBe("1000.0000");
      expect(n4(period4!.rows[0]!.actual)).toBe("750.0000");
      const cached = await consumption.consumptionForBudget(budgetId);
      expect(cached.computedAt).toBe(snapshot.computedAt);
      invalidateConsumptionCache();
      const fresh = await consumption.consumptionForBudget(budgetId);
      expect(fresh.computedAt).not.toBe(snapshot.computedAt);
    });
  });
});

// -- BR-051: advisory-by-default controls -------------------------------------------------

describe("BR-051 — controls are advisory by default; hard-block is the explicit ENFORCE_DRAFT policy", () => {
  it("ADVISORY (the default): an over-budget draft-save evaluation returns exactly one warning and never throws", async () => {
    let warningCount = 0;
    await withTenant(TENANT_BUD, async () => {
      const evaluation = await guard.evaluateDraftSave({
        actorId: B_ACTOR,
        documentRef: {
          type: "supplier_invoice",
          id: "cccccccc-0000-4000-8000-000000000001",
          label: "INV-100",
        },
        fiscalPeriodId: fixture.periodIds["FY2026-04"]!,
        lines: [
          {
            accountId: fixture.cogsAccountId,
            // 750 actual + 600 projected = 1,350 ≥ the 1,000 threshold.
            projectedAmount: "600.0000",
          },
        ],
      });
      expect(evaluation.mode).toBe("ADVISORY");
      expect(evaluation.warnings).toHaveLength(1);
      expect(evaluation.warnings[0]!.accountId).toBe(fixture.cogsAccountId);
      expect(n4(evaluation.warnings[0]!.projectedAmount)).toBe("1350.0000");
    });
    // The advisory notification landed exactly once (the ambient UoW has
    // committed by now — the su() read runs after withTenant closed).
    const client = await su();
    const notes = await client.query(
      "SELECT COUNT(*)::int AS n FROM notifications WHERE tenant_id = $1 AND category = 'budgeting'",
      [TENANT_BUD],
    );
    await client.end();
    warningCount = notes.rows[0]!.n as number;
    expect(warningCount).toBeGreaterThanOrEqual(1);
  });

  it("the explicit budgeting.controls.mode = ENFORCE_DRAFT policy blocks the DRAFT save with the typed audited reason", async () => {
    await withTenant(TENANT_BUD, async () => {
      const client = await su();
      await client.query(
        `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
           (gen_random_uuid(), $1, 'budgeting.controls.mode', '"ENFORCE_DRAFT"'::jsonb)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [TENANT_BUD],
      );
      await client.end();
      try {
        await expect(
          guard.evaluateDraftSave({
            actorId: B_ACTOR,
            documentRef: {
              type: "supplier_invoice",
              id: "cccccccc-0000-4000-8000-000000000002",
              label: "INV-101",
            },
            fiscalPeriodId: fixture.periodIds["FY2026-04"]!,
            lines: [
              {
                accountId: fixture.cogsAccountId,
                projectedAmount: "600.0000", // 1,350 ≥ 1,000 → BUDGET_EXCEEDED
              },
            ],
          }),
        ).rejects.toMatchObject({ code: "BUDGET_EXCEEDED" });
      } finally {
        const client3 = await su();
        await client3.query(
          "DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = 'budgeting.controls.mode'",
          [TENANT_BUD],
        );
        await client3.end();
      }
    });
    // The audited block reason landed on the document flow (the ambient
    // UoW committed — expect().rejects captured the throw, so withTenant
    // resolved normally and the audit row persisted).
    const client2 = await su();
    const blocks = await client2.query(
      "SELECT COUNT(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'budgeting.control_block'",
      [TENANT_BUD],
    );
    await client2.end();
    expect(blocks.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it("evaluations under budget return zero warnings (no noise)", async () => {
    await withTenant(TENANT_BUD, async () => {
      const evaluation = await guard.evaluateDraftSave({
        actorId: B_ACTOR,
        documentRef: {
          type: "supplier_invoice",
          id: "cccccccc-0000-4000-8000-000000000003",
          label: "INV-102",
        },
        fiscalPeriodId: fixture.periodIds["FY2026-04"]!,
        lines: [
          {
            accountId: fixture.cogsAccountId,
            // 750 + 100 = 850 < 1,000 — under budget.
            projectedAmount: "100.0000",
          },
        ],
      });
      expect(evaluation.mode).toBe("ADVISORY");
      expect(evaluation.warnings).toHaveLength(0);
    });
  });
});

// -- the ledger tie ------------------------------------------------------------------------

describe("the budget-ledger-tie assertion (block-on-fail substrate)", () => {
  it("is PASS over the real GL world (the dimension folds tie to the trial balance)", async () => {
    await withTenant(TENANT_BUD, async () => {
      const ties = await ledgerTie({ fiscalYearId: fixture.fiscalYearId, scope: "ACCOUNTS" });
      expect(ties.ok).toBe(true);
      expect(ties.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("flips to FAIL on seeded drift (a skewed trial-balance read surfaces, never silently passes)", async () => {
    await withTenant(TENANT_BUD, async () => {
      const original = journalStore.trialBalances;
      const spy = vi
        .spyOn(journalStore, "trialBalances")
        .mockImplementation(async (input: Parameters<typeof original>[0]) => {
          const real = await original(input);
          if (input.fromDate !== "2026-04-01") {
            return real;
          }
          // Seed the drift: the period-4 COGS debit side inflated by 1.0000.
          return real.map((row) =>
            row.accountId === fixture.cogsAccountId ? { ...row, debit: "751.0000" } : row,
          );
        });
      try {
        const ties = await ledgerTie({ fiscalYearId: fixture.fiscalYearId, scope: "ACCOUNTS" });
        expect(ties.ok).toBe(false);
        const broken = ties.rows.filter(
          (row) => row.groupedDebit !== row.glDebit || row.groupedCredit !== row.glCredit,
        );
        expect(broken.length).toBeGreaterThanOrEqual(1);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

// -- import/export round-trip ---------------------------------------------------------------

describe("XLSX grid import/export (T8)", () => {
  it("round-trips every line exactly (19,4) through build → parse", async () => {
    const buffer = await buildGridXlsx({
      budgetCode: "BUD-2026-1",
      budgetName: "Round trip",
      scope: "ACCOUNTS",
      locale: "en",
      periods: Array.from({ length: 12 }, (_, index) => ({
        id: `p${index + 1}`,
        label: `P${String(index + 1).padStart(2, "0")}`,
      })),
      lineAmounts: Array.from({ length: 12 }, (_, index) => ({
        accountId: "a1",
        dimensionId: null,
        fiscalPeriodId: `p${index + 1}`,
        amount: "1000.0000",
      })),
      accountLabels: [{ accountId: "a1", code: "5100", name: "COGS", dimensionLabel: null }],
    });
    expect(buffer.byteLength).toBeGreaterThan(0);
    const parsed = await parseGridXlsxAsync(buffer);
    expect(parsed.headers.length).toBeGreaterThanOrEqual(15); // 3 + 12 + total
    // One grid row (the 12 period lines of the same account × dimension
    // key) + the totals row.
    expect(parsed.rows.length).toBe(2);
    const first = parsed.rows[0]!;
    expect(first[0]).toBe("5100");
    expect(first[3]).toBe("1000");
    expect(first[15]).toBe("12000");
  });

  it("dry-run reports per-row typed errors with ZERO writes; commit rejects the bad file whole", async () => {
    await withTenant(TENANT_BUD, async () => {
      const budgetId = await mintDraftBudget();
      // A hand-built import file: one bad row (unknown account) + one good.
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Budget");
      sheet.addRow(["Account Code", "Account Name", "Dimension Code", "P01", "P02", "Total"]);
      sheet.addRow(["9999", "Unknown account", "", "100", "", "100"]);
      sheet.addRow(["5210", "Opex", "", "", "250.5", "250.5"]);
      const out = Buffer.from(await workbook.xlsx.writeBuffer());
      const report = await imports.dryRun(budgetId, out.toString("base64"));
      expect(report.rowCount).toBe(2);
      expect(report.errors).toHaveLength(1);
      expect(report.errors[0]!.rowNo).toBe(2);
      expect(report.errors[0]!.messageEn).toContain("not found");
      // Zero writes: the 12-line grid is untouched.
      const untouched = await grid.getGrid(budgetId);
      expect(untouched.lines).toHaveLength(12);
      // Commit with the bad file → the typed row error rejects everything.
      await expect(imports.commit(budgetId, out.toString("base64"), B_ACTOR)).rejects.toMatchObject({
        code: "BUDGET_IMPORT_ROW",
      });
    });
  });

  it("a clean import commits the grid whole (19,4 exact totals)", async () => {
    await withTenant(TENANT_BUD, async () => {
      const budgetId = await mintDraftBudget();
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Budget");
      sheet.addRow(["Account Code", "Account Name", "Dimension Code", "P01", "P02", "Total"]);
      sheet.addRow(["5210", "Opex", "", "100.5", "250.5", "351"]);
      const out = Buffer.from(await workbook.xlsx.writeBuffer());
      const result = await imports.commit(budgetId, out.toString("base64"), B_ACTOR);
      expect(result.lineCount).toBe(2);
      expect(n4(result.totals.year)).toBe("351.0000");
      expect(n4(result.totals.perPeriod[fixture.periodIds["FY2026-01"]!]!)).toBe("100.5000");
      expect(n4(result.totals.perPeriod[fixture.periodIds["FY2026-02"]!]!)).toBe("250.5000");
    });
  });
});

// -- supersede + immutability (state-advancing — runs after the read suites) ----------------

describe("BR-050 supersede chain — revisions supersede, never edit", () => {
  it("supersede creates a linked DRAFT with copied lines; activating it flips the predecessor to REVISED (atomic)", async () => {
    await withTenant(TENANT_BUD, async () => {
      const activeId = await activeAccountsBudget();
      const active = await versions.get(activeId);
      const draft = await workflow.supersede(activeId, B_ACTOR);
      expect(draft.status).toBe("DRAFT");
      expect(draft.supersedesId).toBe(activeId);
      expect(draft.revisionNo).toBe(active.budget.revisionNo + 1);
      const draftGrid = await grid.getGrid(draft.id);
      expect(draftGrid.lines).toHaveLength(12);
      expect(n4(draftGrid.totals.year)).toBe("12000.0000");
      // Raise one period and run the lifecycle.
      await grid.replaceGrid(
        draft.id,
        draftGrid.lines.map((line) =>
          line.fiscalPeriodId === fixture.periodIds["FY2026-04"]!
            ? { ...line, amount: "1250.0000" }
            : line,
        ),
        B_ACTOR,
      );
      await workflow.submit(draft.id, B_ACTOR);
      await workflow.approve(draft.id, B_APPROVER);
      const activated = await workflow.activate(draft.id, B_APPROVER);
      expect(activated.status).toBe("ACTIVE");
      const predecessor = await versions.get(activeId);
      expect(predecessor.budget.status).toBe("REVISED");
      expect(predecessor.budget.activatedAt).not.toBeNull();
      // Exactly one ACTIVE remains for (year, ACCOUNTS).
      await expect(activeAccountsBudget()).resolves.toBe(draft.id);
    });
  });

  it("non-DRAFT budgets reject line edits (409 IMMUTABLE_DOCUMENT) and closed budgets stay readable", async () => {
    await withTenant(TENANT_BUD, async () => {
      const activeId = await activeAccountsBudget();
      await expect(
        grid.replaceGrid(
          activeId,
          [
            {
              fiscalPeriodId: fixture.periodIds["FY2026-01"]!,
              accountId: fixture.cogsAccountId,
              amount: "1.0000",
            },
          ],
          B_ACTOR,
        ),
      ).rejects.toMatchObject({ code: "IMMUTABLE_DOCUMENT" });
      const closed = await versions.close(activeId, B_APPROVER);
      expect(closed.status).toBe("CLOSED");
      expect(closed.closedAt).not.toBeNull();
      const detail = await versions.get(activeId);
      expect(detail.budget.status).toBe("CLOSED");
      expect(detail.lineCount).toBe(12);
      await expect(grid.replaceGrid(activeId, [], B_ACTOR)).rejects.toMatchObject({
        code: "IMMUTABLE_DOCUMENT",
      });
    });
  });
});

// -- THE NEGATIVE LEDGER PROOF (the phase's binding honesty note) ---------------------------

describe("the negative ledger proof — budgets are not ledger documents (DR-004)", () => {
  it("journal_entries/journal_lines counts are byte-identical after the FULL budgeting operation set; zero JournalSpec submissions", async () => {
    const client = await su();
    const entries = await client.query(
      "SELECT COUNT(*)::int AS n FROM journal_entries WHERE tenant_id = $1",
      [TENANT_BUD],
    );
    const lines = await client.query(
      "SELECT COUNT(*)::int AS n FROM journal_lines WHERE tenant_id = $1",
      [TENANT_BUD],
    );
    await client.end();
    expect(entries.rows[0]!.n).toBe(journalCountBefore.entries);
    expect(lines.rows[0]!.n).toBe(journalCountBefore.lines);
    // The engine spy: ZERO PostingService.post submissions ran during the
    // budgeting operation set (the BR-050 machine + variance + controls +
    // the ENFORCE_DRAFT block + import/export + supersede/close).
    expect(postSpy).toHaveBeenCalledTimes(0);
  });

  it("the budgeting module is structurally ledger-incapable (no journal-table writes anywhere)", async () => {
    const fs = await import("node:fs");
    const store = fs.readFileSync("src/modules/budgeting/infrastructure/budgeting.store.ts", "utf8");
    expect(store).not.toMatch(/INSERT\s+INTO\s+journal_/i);
    expect(store).not.toMatch(/UPDATE\s+journal_/i);
    expect(store).not.toMatch(/DELETE\s+FROM\s+journal_/i);
    expect(store).not.toMatch(/INSERT\s+INTO\s+cash_movements/i);
  });
});
