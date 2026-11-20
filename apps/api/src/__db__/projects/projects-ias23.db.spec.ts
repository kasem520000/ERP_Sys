import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import {
  BudgetStateError,
  Ias23AlreadyPostedError,
  Ias23AsOfInFutureError,
  Ias23InputInvalidError,
  Ias23NothingToCapitalizeError,
  Ias23RateUnverifiedError,
  Ias23WindowUndefinedError,
} from "../../modules/crm/domain/projects-errors";
import { Ias23Service } from "../../modules/crm/application/ias23-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import {
  actuals,
  budgets,
  ensureP1BudgetWorld,
  ensurePjwAccount,
  ensureProjectByCode,
  mapPjwPurpose,
  PJW_ACTOR,
  pjw,
  setPjwSetting,
  TENANT_PJW,
  wbs,
} from "./fixtures";

/**
 * PHASE-048 (W-10 — the D-11 engine) — the IAS 23 borrowing-costs
 * capitalization pinned over real PostgreSQL 16 (the plan §4's spec —
 * the W-10 exit arm): REQUIRES_VERIFICATION (the planted register's
 * typed refusal — unset, malformed, unverified), the WBS-schedule
 * window, the per-line split with the DOCUMENTED STOP RULES (the start
 * law, the completion law, the elapsed/never-future law), the posting
 * through the REAL engine (fail-closed until the pair maps, then DR
 * the qualifying asset · CR the borrowing costs at Σ capitalized), the
 * single-use POSTED stamp, and INV-033 untouched (no project stamp).
 *
 * THE DEDICATED WORLD (P5 "PJW-PRJ-IAS"): ONE task 2026-03-01..06-30
 * (the qualifying window) + the approved budget's five cells at
 * 10/day: (i) Jan 310 — out of scope · (ii) Feb 1–Mar 31 590 — the
 * straddling start (eligible 310, capitalized 15.5000, expensed
 * 14.0000) · (iii) Apr 300 — in window (15.0000) · (iv) May 1–Jul 31
 * 920 — the straddling end (eligible 610, 30.5000, expensed 15.5000)
 * · (v) Aug 310 — out of scope.
 *   at asOf 2026-12-31 (the projection): Σ expenditures 1,810 ·
 *   eligible 1,220 · capitalized 61.0000 · expensed 29.5000 — exactly
 *   1,810 × 0.05 = 90.5000 split by the stop rules.
 *   at asOf 2026-06-30 (the posting basis): Σ expenditures 1,500 ·
 *   eligible 1,220 · capitalized 61.0000 · expensed 14.0000.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const ias23 = new Ias23Service(audit, posting);

let iasProjectId = "";
let draftBudgetProjectId = "";
let cipAccountId = "";
let borrowingAccountId = "";

const VALID_REGISTER = {
  rate: 0.05,
  source_evidence: "The weighted-average borrowing register — the 2026 facility schedule, p.3 (tenant-entered with evidence)",
  verified: true,
};

beforeAll(async () => {
  await ensureP1BudgetWorld();
  iasProjectId = await ensureProjectByCode("PJW-PRJ-IAS", "IAS 23 stop-rules project");
  draftBudgetProjectId = await ensureProjectByCode("PJW-PRJ-IAS2", "IAS 23 draft-budget project");
  cipAccountId = await ensurePjwAccount({
    code: "1310",
    name: "Construction in progress (IAS 23)",
    nameAr: "أصول تحت الإنشاء (IAS 23)",
    type: "ASSET",
    parentCode: "1300",
  });
  borrowingAccountId = await ensurePjwAccount({
    code: "5260",
    name: "Borrowing costs (IAS 23)",
    nameAr: "تكاليف الاقتراض (IAS 23)",
    type: "EXPENSE",
    parentCode: "5000",
  });

  await withTenant(TENANT_PJW, async () => {
    // P5: ONE dated task (the window Mar 1 – Jun 30).
    if ((await wbs.tree(iasProjectId)).length === 0) {
      await wbs.createTask({
        projectId: iasProjectId,
        parentTaskId: null,
        predecessorTaskId: null,
        wbsCode: "W",
        name: "The qualifying construction window",
        nameAr: "نافذة الإنشاء المؤهلة",
        isMilestone: false,
        startDate: "2026-03-01",
        endDate: "2026-06-30",
        weight: null,
        percentComplete: "0.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
    }
    if (!(await budgets.listBudgets(iasProjectId)).some((row) => row.name === "PB-IAS")) {
      const draft = await budgets.createBudget({
        projectId: iasProjectId,
        name: "PB-IAS",
        nameAr: null,
        note: null,
        actorId: PJW_ACTOR,
      });
      await budgets.replaceLines(
        draft.id,
        [
          { costType: "LABOR", wbsTaskId: null, periodStart: "2026-01-01", periodEnd: "2026-01-31", plannedAmount: "310.0000", note: null },
          { costType: "LABOR", wbsTaskId: null, periodStart: "2026-02-01", periodEnd: "2026-03-31", plannedAmount: "590.0000", note: null },
          { costType: "LABOR", wbsTaskId: null, periodStart: "2026-04-01", periodEnd: "2026-04-30", plannedAmount: "300.0000", note: null },
          { costType: "LABOR", wbsTaskId: null, periodStart: "2026-05-01", periodEnd: "2026-07-31", plannedAmount: "920.0000", note: null },
          { costType: "LABOR", wbsTaskId: null, periodStart: "2026-08-01", periodEnd: "2026-08-31", plannedAmount: "310.0000", note: null },
        ],
        PJW_ACTOR,
      );
      await budgets.approve(draft.id, PJW_ACTOR);
    }
    // P7: ONE dated task + a DRAFT budget (never approved — the
    // approved-alone law's arm).
    if ((await wbs.tree(draftBudgetProjectId)).length === 0) {
      await wbs.createTask({
        projectId: draftBudgetProjectId,
        parentTaskId: null,
        predecessorTaskId: null,
        wbsCode: "D",
        name: "Draft-budget task",
        nameAr: "مهمة موازنة مسودة",
        isMilestone: false,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        weight: null,
        percentComplete: "0.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
    }
    if (!(await budgets.listBudgets(draftBudgetProjectId)).some((row) => row.name === "PB-IAS2")) {
      await budgets.createBudget({
        projectId: draftBudgetProjectId,
        name: "PB-IAS2",
        nameAr: null,
        note: null,
        actorId: PJW_ACTOR,
      });
    }
  });
});

describe("PHASE-048 W-10 — the D-11 engine: REQUIRES_VERIFICATION (the W-10 exit arm)", () => {
  it("(a) the register's three refusals: unset, malformed, unverified — never a fabricated rate", async () => {
    const fixture = pjw();
    // Unset.
    await setPjwSetting("projects.ias23_capitalization_rate", null);
    await expect(
      withTenant(TENANT_PJW, () => ias23.preview(fixture.project1Id, "2026-06-30")),
    ).rejects.toBeInstanceOf(Ias23RateUnverifiedError);
    // Malformed (the evidence missing) + unverified (verified: false).
    await setPjwSetting("projects.ias23_capitalization_rate", {
      rate: 0.05,
      source_evidence: "",
      verified: true,
    });
    await expect(
      withTenant(TENANT_PJW, () => ias23.preview(fixture.project1Id, "2026-06-30")),
    ).rejects.toBeInstanceOf(Ias23RateUnverifiedError);
    await setPjwSetting("projects.ias23_capitalization_rate", {
      rate: 0.05,
      source_evidence: "some schedule",
      verified: false,
    });
    await expect(
      withTenant(TENANT_PJW, () => ias23.preview(fixture.project1Id, "2026-06-30")),
    ).rejects.toBeInstanceOf(Ias23RateUnverifiedError);
    await expect(
      withTenant(TENANT_PJW, () =>
        ias23.capitalize(fixture.project1Id, "2026-06-30", PJW_ACTOR),
      ),
    ).rejects.toBeInstanceOf(Ias23RateUnverifiedError);
    // The valid register lands.
    await setPjwSetting("projects.ias23_capitalization_rate", VALID_REGISTER);
  });
});

describe("PHASE-048 W-10 — the D-11 engine: the window, the split, the stop rules", () => {
  it("(b) the P1 preview: the whole-window world — eligible = expenditures, capitalized 205.0000", async () => {
    const fixture = pjw();
    await withTenant(TENANT_PJW, async () => {
      const preview = await ias23.preview(fixture.project1Id, "2026-06-30");
      // The window: P1's schedule span (R: Jan 1 – Dec 31).
      expect(preview.window).toEqual({ start: "2026-01-01", end: "2026-12-31" });
      expect(preview.projection).toBe(false);
      expect(preview.register.rate).toBe("0.050000");
      // Both approved lines sit fully inside the window.
      expect(preview.lines).toHaveLength(2);
      expect(preview.outOfScope).toHaveLength(0);
      expect(preview.totals).toEqual({
        expenditures: "4100.0000",
        eligible: "4100.0000",
        ineligible: "0.0000",
        capitalized: "205.0000",
        expensed: "0.0000",
      });
    });
  });

  it("(c) THE POSTING: fail-closed until the pair maps, then DR the qualifying asset · CR the borrowing costs — all-or-nothing", async () => {
    const fixture = pjw();
    // The unmapped refusal (the 038/0077 discipline) — and NOTHING
    // written (the atomicity).
    const refusal = await withTenant(TENANT_PJW, () =>
      ias23.capitalize(fixture.project1Id, "2026-06-30", PJW_ACTOR),
    ).catch((error: unknown) => error);
    expect((refusal as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");
    await withTenant(TENANT_PJW, async () => {
      const rows = await ias23.listCapitalizations(fixture.project1Id);
      expect(rows).toHaveLength(0);
    });

    // The mapping lands; the posting succeeds.
    await mapPjwPurpose("IAS23_QUALIFYING_ASSET", cipAccountId);
    await mapPjwPurpose("IAS23_BORROWING_COST", borrowingAccountId);
    const result = await withTenant(TENANT_PJW, () =>
      ias23.capitalize(fixture.project1Id, "2026-06-30", PJW_ACTOR),
    );
    expect(result.journalEntryId).toBeTruthy();
    expect(result.totals.capitalized).toBe("205.0000");
    // The entry's shape: DR 1310 · CR 5260 at Σ capitalized.
    await withTenant(TENANT_PJW, async () => {
      const lines = await requireTenantContext().tx!.execute<{
        direction: string;
        code: string;
        amount: string;
      }>(sql`
        SELECT jl.direction, a.code, jl.base_amount::text AS amount
        FROM journal_lines jl
        JOIN journal_entries je ON je.id = jl.journal_entry_id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.source_type = 'ias_capitalization' AND je.source_id = ${fixture.project1Id}
          AND je.operation = 'post_20260101'
        ORDER BY jl.line_no
      `);
      expect(lines.rows).toEqual([
        { direction: "DEBIT", code: "1310", amount: "205.0000" },
        { direction: "CREDIT", code: "5260", amount: "205.0000" },
      ]);
      // The scope rows: POSTED, the rate snapshot, the slices.
      const rows = await ias23.listCapitalizations(fixture.project1Id);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.status).toBe("POSTED");
        expect(row.postedAt).not.toBeNull();
        expect(row.rateSnapshot).toBe("0.050000");
        expect(row.windowStart).toBe("2026-01-01");
      }
      const labor = rows.find((row) => row.capitalizedAmount === "155.0000");
      const material = rows.find((row) => row.capitalizedAmount === "50.0000");
      expect(labor?.expendituresAmount).toBe("3100.0000");
      expect(material?.expendituresAmount).toBe("1000.0000");
    });
  });

  it("(d) THE SINGLE-USE STAMP: re-capitalizing the same slices refuses typed", async () => {
    const fixture = pjw();
    await expect(
      withTenant(TENANT_PJW, () => ias23.capitalize(fixture.project1Id, "2026-06-30", PJW_ACTOR)),
    ).rejects.toBeInstanceOf(Ias23AlreadyPostedError);
    // Exactly one entry for the source key (INV-013's convergence).
    await withTenant(TENANT_PJW, async () => {
      const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM journal_entries
        WHERE source_type = 'ias_capitalization' AND source_id = ${fixture.project1Id}
      `);
      expect(rows.rows[0]?.n).toBe(1);
    });
  });

  it("(e) INV-033 STAYS GREEN: the capitalization posts no project stamp", async () => {
    const fixture = pjw();
    await withTenant(TENANT_PJW, async () => {
      const report = await actuals.inv033(fixture.project1Id);
      expect(report.acTotal).toBe("10945.3125");
      expect(report.residual).toBe("0.0000");
    });
  });

  it("(f) THE STOP RULES on the dedicated world (the projection at 2026-12-31): the start + completion laws split 1,810 × 5% = 90.5000 into 61.0000 + 29.5000", async () => {
    await withTenant(TENANT_PJW, async () => {
      const preview = await ias23.preview(iasProjectId, "2026-12-31");
      expect(preview.window).toEqual({ start: "2026-03-01", end: "2026-06-30" });
      expect(preview.projection).toBe(true); // beyond today — a projection
      // The two out-of-scope cells are LISTED, never zeroed.
      expect(preview.outOfScope).toHaveLength(2);
      expect(preview.lines).toHaveLength(3);
      const byAmount = (planned: string) =>
        preview.lines.find((line) => line.plannedAmount === planned)!;
      // (ii) Feb 1–Mar 31 590: the straddling start — February expenses,
      // March capitalizes (310 = 31 days × 10).
      const straddleStart = byAmount("590.0000");
      expect(straddleStart.slice).toMatchObject({
        sliceStart: "2026-03-01",
        sliceEnd: "2026-03-31",
        expenditures: "590.0000",
        eligible: "310.0000",
        ineligible: "280.0000",
        capitalized: "15.5000",
        expensed: "14.0000",
      });
      // (iii) Apr 300: fully in window.
      expect(byAmount("300.0000").slice).toMatchObject({
        eligible: "300.0000",
        capitalized: "15.0000",
        expensed: "0.0000",
      });
      // (iv) May 1–Jul 31 920: the straddling end — May+Jun (61 days)
      // capitalizes 610, July's 310 expenses.
      const straddleEnd = byAmount("920.0000");
      expect(straddleEnd.slice).toMatchObject({
        sliceStart: "2026-05-01",
        sliceEnd: "2026-06-30",
        expenditures: "920.0000",
        eligible: "610.0000",
        ineligible: "310.0000",
        capitalized: "30.5000",
        expensed: "15.5000",
      });
      // The totals: 1,810 × 0.05 = 90.5000 = 61.0000 + 29.5000.
      expect(preview.totals).toEqual({
        expenditures: "1810.0000",
        eligible: "1220.0000",
        ineligible: "590.0000",
        capitalized: "61.0000",
        expensed: "29.5000",
      });
    });
  });

  it("(g) THE ELAPSED LAW (the projection at 2026-04-15): only the accrual through asOf counts", async () => {
    await withTenant(TENANT_PJW, async () => {
      const preview = await ias23.preview(iasProjectId, "2026-04-15");
      const byAmount = (planned: string) =>
        preview.lines.find((line) => line.plannedAmount === planned)!;
      // (ii) fully elapsed: 590 / 310.
      expect(byAmount("590.0000").slice.eligible).toBe("310.0000");
      // (iii) half through April: 150 of 300.
      expect(byAmount("300.0000").slice.expenditures).toBe("150.0000");
      expect(byAmount("300.0000").slice.eligible).toBe("150.0000");
      expect(byAmount("300.0000").slice.capitalized).toBe("7.5000");
      // (iv) not started: the honest zero row (in scope, nothing yet).
      expect(byAmount("920.0000").slice.expenditures).toBe("0.0000");
      expect(preview.totals).toEqual({
        expenditures: "740.0000",
        eligible: "460.0000",
        ineligible: "280.0000",
        capitalized: "23.0000",
        expensed: "14.0000",
      });
    });
  });

  it("(h) THE NEVER-FUTURE STOP RULE + the elapsed posting basis: 2026-12-31 refuses; 2026-06-30 posts 61.0000", async () => {
    const future = await withTenant(TENANT_PJW, () =>
      ias23.capitalize(iasProjectId, "2026-12-31", PJW_ACTOR),
    ).catch((error: unknown) => error);
    expect(future).toBeInstanceOf(Ias23AsOfInFutureError);

    const result = await withTenant(TENANT_PJW, () =>
      ias23.capitalize(iasProjectId, "2026-06-30", PJW_ACTOR),
    );
    expect(result.totals.capitalized).toBe("61.0000");
    expect(result.totals.expensed).toBe("14.0000");
    expect(result.rows).toHaveLength(3);
    // The single-use stamp on the dedicated world too.
    await expect(
      withTenant(TENANT_PJW, () => ias23.capitalize(iasProjectId, "2026-06-30", PJW_ACTOR)),
    ).rejects.toBeInstanceOf(Ias23AlreadyPostedError);
  });

  it("(i) THE NOTHING-TO-CAPITALIZE refusal: before the window starts, everything is expensed and nothing posts", async () => {
    await expect(
      withTenant(TENANT_PJW, () => ias23.capitalize(iasProjectId, "2026-02-15", PJW_ACTOR)),
    ).rejects.toBeInstanceOf(Ias23NothingToCapitalizeError);
  });

  it("(j) the window + budget laws: no dated task → the window refusal; no APPROVED budget → the curve law's own refusal", async () => {
    const fixture = pjw();
    await withTenant(TENANT_PJW, async () => {
      // P-CLS carries no WBS task at all.
      await expect(ias23.preview(fixture.projectClsId, "2026-06-30")).rejects.toBeInstanceOf(
        Ias23WindowUndefinedError,
      );
      // The draft-budget project: a dated task but no APPROVED budget.
      await expect(ias23.preview(draftBudgetProjectId, "2026-06-30")).rejects.toBeInstanceOf(
        BudgetStateError,
      );
      // The input shapes.
      await expect(ias23.preview("not-a-uuid", "2026-06-30")).rejects.toBeInstanceOf(
        Ias23InputInvalidError,
      );
      await expect(ias23.preview(iasProjectId, "2026-13-45")).rejects.toBeInstanceOf(
        Ias23InputInvalidError,
      );
    });
  });
});
