import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { TimeEntryService } from "../../modules/crm/application/time-entry-service";
import {
  BudgetInputInvalidError,
  BudgetStateError,
  Inv033ReconciliationError,
  WbsCrossProjectError,
} from "../../modules/crm/domain/projects-errors";
import {
  actuals,
  budgets,
  mintJournal,
  PJW_ACTOR,
  pjw,
  seedIssueMove,
  seedSubCertificate,
  setPjwSetting,
  setupProjectsFixture,
  TENANT_PJW,
} from "./fixtures";

/**
 * PHASE-048 (W-9 — T-06 + T-07) — the budget cost curve + the four
 * actual collectors + INV-033 pinned over real PostgreSQL 16 (the plan
 * §4's `projects-budgets-actuals.db.spec` — acceptance #3): the
 * coherent four-leg world on P1 (each leg its own source, each GL side
 * minted through the REAL PostingService), the cost curve's exact
 * interpolation, the vs-actual rollup by type and by node, the honest
 * degraded/unpriced states, and the typed reconciliation that REFUSES
 * at any residual — to the cent.
 *
 * THE HAND-COMPUTED WORLD (the fixtures' coherent P1):
 *   LABOR  820.3125   = (10h + 2.5h) × 65.625000 — the 13,650.0000
 *                       monthly employer cost ÷ the 208-hour divisor
 *   MAT.     500.0000 = the WMS issue move (posting-stamped)
 *   SUB    9,000.0000 = the APPROVED certificate's net
 *   OVH      625.0000 = 1,000.0000 pool × 12.5/20 labor-hours share
 *   AC    10,945.3125 = the GL project dimension's net carry exactly.
 */

const resolveConfig = new ResolveEffectiveConfigService(new ConfigRepository());
const timeEntries = new TimeEntryService(new AuditService(new DrizzleAuditStore()), resolveConfig);

const LABOR_TOTAL = "820.3125";
const AC_TOTAL = "10945.3125";

beforeAll(async () => {
  const fixture = await setupProjectsFixture();
  await withTenant(TENANT_PJW, async () => {
    // ORDER-ROBUSTNESS (added at W-10, disclosed in its gate doc): the
    // family's file order is not guaranteed — the W-10 specs'
    // `ensureP1BudgetWorld` fixture helper builds THIS SAME world when
    // they run first, and the unconditional seed below would then
    // double-mint the entries/journals and break the coherent arms.
    // The probe (the W-9 entry's own narrative) skips the seed when the
    // world already stands — the ARMS below stay byte-identical.
    const probe = await requireTenantContext().tx!.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM crm_time_entries te
          WHERE te.wbs_task_id = ${fixture.tasks.a} AND te.narrative = 'Ten hours on A'`,
    );
    if ((probe.rows[0]?.n ?? 0) > 0) return;
    // ── LABOR: the approved-class WBS-dimensioned entries ─────────────
    // 10h on A + 2.5h on B1 (P1) + 7.5h on P2's task (the driver share).
    await timeEntries.create({
      entryDate: "2026-03-02",
      hours: "10",
      feeItemId: fixture.feeItemId,
      projectId: fixture.project1Id,
      contractId: null,
      feeEarnerUserId: fixture.feeEarnerUserId,
      wbsTaskId: fixture.tasks.a,
      unitRate: "250",
      narrative: "Ten hours on A",
      billable: true,
      actorId: PJW_ACTOR,
    });
    await timeEntries.create({
      entryDate: "2026-03-03",
      hours: "2.5",
      feeItemId: fixture.feeItemId,
      projectId: fixture.project1Id,
      contractId: null,
      feeEarnerUserId: fixture.feeEarnerUserId,
      wbsTaskId: fixture.tasks.b1,
      unitRate: "250",
      narrative: "Two and a half hours on B1",
      billable: true,
      actorId: PJW_ACTOR,
    });
    await timeEntries.create({
      entryDate: "2026-03-03",
      hours: "7.5",
      feeItemId: fixture.feeItemId,
      projectId: fixture.project2Id,
      contractId: null,
      feeEarnerUserId: fixture.feeEarnerUserId,
      wbsTaskId: fixture.tasks.foreign,
      unitRate: "250",
      narrative: "P2 driver hours",
      billable: true,
      actorId: PJW_ACTOR,
    });
    // The weekly review (2026-03-02 is a Monday): the week's DRAFT
    // entries flip APPROVED in one batch.
    await timeEntries.reviewTimesheet({ weekStart: "2026-03-02", actorId: PJW_ACTOR });

    // ── MATERIALS: the issue posting (project-stamped) + the move ─────
    const materialsJournal = await mintJournal({
      debitAccountId: fixture.projectCostAccountId,
      creditAccountId: fixture.apControlAccountId,
      amount: "500.0000",
      entryDate: "2026-03-05",
      projectId: fixture.project1Id,
      partnerId: fixture.supplierPartnerId,
      description: "P1 materials issue",
    });
    await seedIssueMove({ journalEntryId: materialsJournal, valueAmount: "500.0000", movedAt: "2026-03-05" });

    // ── SUBCONTRACT: the APPROVED certificate's net (9,000) ───────────
    await seedSubCertificate({
      projectId: fixture.project1Id,
      grossValue: "10000.0000",
      retentionWithheld: "1000.0000",
      netPayable: "9000.0000",
      certificateDate: "2026-03-08",
    });
    await mintJournal({
      debitAccountId: fixture.projectCostAccountId,
      creditAccountId: fixture.apControlAccountId,
      amount: "9000.0000",
      entryDate: "2026-03-08",
      projectId: fixture.project1Id,
      partnerId: fixture.supplierPartnerId,
      description: "P1 subcontract certificate (net)",
    });

    // ── OVERHEAD: the pool (NO project stamp — indirect by nature) + ──
    // the allocation posting (project-stamped DR / CR the CLEARING
    // account — never the pool: the pool read stays stable).
    await mintJournal({
      debitAccountId: fixture.overheadPoolAccountId,
      creditAccountId: fixture.apControlAccountId,
      amount: "1000.0000",
      entryDate: "2026-03-10",
      projectId: null,
      partnerId: fixture.supplierPartnerId,
      description: "The overhead pool (indirect — unprojected)",
    });
    await mintJournal({
      debitAccountId: fixture.projectCostAccountId,
      creditAccountId: fixture.overheadClearAccountId,
      amount: "625.0000",
      entryDate: "2026-03-10",
      projectId: fixture.project1Id,
      description: "P1 overhead allocation (12.5/20 share)",
    });

    // ── LABOR's GL side: the valuation's posting ──────────────────────
    await mintJournal({
      debitAccountId: fixture.projectCostAccountId,
      creditAccountId: fixture.apControlAccountId,
      amount: LABOR_TOTAL,
      entryDate: "2026-03-12",
      projectId: fixture.project1Id,
      partnerId: fixture.supplierPartnerId,
      description: "P1 labor cost (time × rate)",
    });

    // ── THE BUDGET: PB-1 on P1 — LABOR on A 3,100 over January (100/day)
    // + MATERIAL project-level 1,000 over 01-01..01-10 — then APPROVED.
    const draft = await budgets.createBudget({
      projectId: fixture.project1Id,
      name: "PB-1",
      nameAr: null,
      note: null,
      actorId: PJW_ACTOR,
    });
    await budgets.replaceLines(
      draft.id,
      [
        {
          costType: "LABOR",
          wbsTaskId: fixture.tasks.a,
          periodStart: "2026-01-01",
          periodEnd: "2026-01-31",
          plannedAmount: "3100.0000",
          note: null,
        },
        {
          costType: "MATERIAL",
          wbsTaskId: null,
          periodStart: "2026-01-01",
          periodEnd: "2026-01-10",
          plannedAmount: "1000.0000",
          note: null,
        },
      ],
      PJW_ACTOR,
    );
    await budgets.approve(draft.id, PJW_ACTOR);
  });
});

describe("PHASE-048 W-9 — T-07: the four actual collectors (D-05)", () => {
  it("(a) the coherent world — every leg reads its own source exactly", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const breakdown = await actuals.breakdown(fixture.project1Id);
      // LABOR: the payroll-derived rate snapshot + the node breakdown.
      expect(breakdown.labor.total).toBe(LABOR_TOTAL);
      expect(breakdown.labor.entries).toBe(2);
      expect(breakdown.labor.unpriced.count).toBe(0);
      expect(breakdown.labor.rateCard).toEqual([
        {
          employeeId: fixture.employeeId,
          monthlyEmployerCost: "13650.0000",
          hourlyRate: "65.625000",
        },
      ]);
      expect(breakdown.labor.byNode).toEqual([
        { wbsTaskId: fixture.tasks.a, hours: "10.000000", amount: "656.2500" },
        { wbsTaskId: fixture.tasks.b1, hours: "2.500000", amount: "164.0625" },
      ]);
      // MATERIALS: the WMS issue move valued at the move's own value.
      expect(breakdown.materials.total).toBe("500.0000");
      expect(breakdown.materials.moves).toBe(1);
      expect(breakdown.materials.degraded).toBe(false);
      // SUBCONTRACT: the APPROVED certificate's NET.
      expect(breakdown.subcontract.total).toBe("9000.0000");
      expect(breakdown.subcontract.certificates).toHaveLength(1);
      expect(breakdown.subcontract.certificates[0]?.netPayable).toBe("9000.0000");
      // OVERHEAD: the configured distributor fold.
      expect(breakdown.overhead.allocated).toBe("625.0000");
      expect(breakdown.overhead.pool).toBe("1000.0000");
      expect(breakdown.overhead.share).toBe("0.625000");
      expect(breakdown.overhead.driver).toBe("LABOR_HOURS");
      expect(breakdown.overhead.degraded).toBe(false);
      expect(breakdown.overhead.projectsSharingThePool).toBe(2);
      // AC — the four-leg total.
      expect(breakdown.acTotal).toBe(AC_TOTAL);
    });
  });

  it("(b) the honest zero: a project with no tied sources degrades, never fabricates", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const breakdown = await actuals.breakdown(fixture.projectClsId);
      expect(breakdown.labor.total).toBe("0.0000");
      expect(breakdown.labor.unpriced.count).toBe(0);
      expect(breakdown.materials.total).toBe("0.0000");
      expect(breakdown.materials.degraded).toBe(true);
      expect(breakdown.subcontract.total).toBe("0.0000");
      // The distributor is tenant-wide: P-CLS carries no driver share —
      // the honest zero allocation (not in the driver set).
      expect(breakdown.overhead.allocated).toBe("0.0000");
      expect(breakdown.acTotal).toBe("0.0000");
    });
  });

  it("(c) the UNPRICED arm: the unset divisor lands entries unpriced with the explicit warning — never a fabricated rate", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      await setPjwSetting("projects.labor_standard_monthly_hours", null);
      const breakdown = await actuals.breakdown(fixture.project1Id);
      expect(breakdown.labor.total).toBe("0.0000");
      expect(breakdown.labor.unpriced.count).toBe(2);
      expect(breakdown.labor.unpriced.hours).toBe("12.500000");
      expect(breakdown.labor.unpriced.reasons[0]).toContain(
        "projects.labor_standard_monthly_hours",
      );
      // The INV-033 side REFUSES in this world (the labor leg left the
      // reconciliation) — the typed refusal names the residual.
      await expect(actuals.inv033(fixture.project1Id)).rejects.toBeInstanceOf(
        Inv033ReconciliationError,
      );
      // Restore — the world reconciles again.
      await setPjwSetting("projects.labor_standard_monthly_hours", 208);
      const report = await actuals.inv033(fixture.project1Id);
      expect(report.residual).toBe("0.0000");
    });
  });

  it("(d) the degraded overhead: the unset distributor is the honest zero + the refusal", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      await setPjwSetting("projects.overhead_distributor", null);
      const breakdown = await actuals.breakdown(fixture.project1Id);
      expect(breakdown.overhead.allocated).toBe("0.0000");
      expect(breakdown.overhead.degraded).toBe(true);
      expect(breakdown.overhead.driver).toBeNull();
      await expect(actuals.inv033(fixture.project1Id)).rejects.toBeInstanceOf(
        Inv033ReconciliationError,
      );
      // Restore.
      await setPjwSetting("projects.overhead_distributor", {
        driver: "LABOR_HOURS",
        pool_account_ids: [fixture.overheadPoolAccountId],
      });
    });
  });
});

describe("PHASE-048 W-9 — T-07: INV-033 (acceptance #3 — to the cent)", () => {
  it("(a) the coherent world reconciles exactly — the report carries every leg", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const report = await actuals.inv033(fixture.project1Id);
      expect(report.labor).toBe(LABOR_TOTAL);
      expect(report.materials).toBe("500.0000");
      expect(report.subcontract).toBe("9000.0000");
      expect(report.overheadAllocated).toBe("625.0000");
      expect(report.acTotal).toBe(AC_TOTAL);
      expect(report.glProjectDimension.net).toBe(AC_TOTAL);
      expect(report.residual).toBe("0.0000");
    });
  });

  it("(b) a project with legs but NO GL side refuses typed (P2's world)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // P2: 7.5h labor (492.1875) + the 375.0000 overhead share, no GL.
      await expect(actuals.inv033(fixture.project2Id)).rejects.toBeInstanceOf(
        Inv033ReconciliationError,
      );
    });
  });

  it("(c) an unexplained GL penny refuses — the refusal carries the full breakdown", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const extra = await mintJournal({
        debitAccountId: fixture.projectCostAccountId,
        creditAccountId: fixture.overheadClearAccountId,
        amount: "1.0000",
        entryDate: "2026-03-20",
        projectId: fixture.project1Id,
        description: "The unexplained GL penny (the refusal arm)",
      });
      expect(extra).toBeTruthy();
      const refusal = await actuals.inv033(fixture.project1Id).catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(Inv033ReconciliationError);
      const details = (refusal as Inv033ReconciliationError).details as Record<string, string>;
      expect(details.acTotal).toBe(AC_TOTAL);
      expect(details.glProjectDimension).toBe("10946.3125");
      expect(details.residual).toBe("-1.0000");
      // Reverse the penny (the project-stamped CREDIT side subtracts
      // from the dimension's net carry — the stampCredit shape) — the
      // world reconciles again for the later arms.
      await mintJournal({
        debitAccountId: fixture.overheadClearAccountId,
        creditAccountId: fixture.projectCostAccountId,
        amount: "1.0000",
        entryDate: "2026-03-21",
        projectId: fixture.project1Id,
        stampCredit: true,
        description: "The penny's reversal",
      });
      const report = await actuals.inv033(fixture.project1Id);
      expect(report.residual).toBe("0.0000");
    });
  });
});

describe("PHASE-048 W-9 — T-06: the budget lifecycle + the cost curve (D-04)", () => {
  // NOTE (the shared-transaction discipline): each `it` opens its own
  // withTenant transaction; a SQL-level refusal (the 23505 the cell law
  // surfaces) poisons ITS OWN transaction only — the SQL-error arms ride
  // alone and never share a transaction with the arms that follow.

  it("(a) the cell law: a duplicate cell is the typed refusal (the 0101 partial uniques)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const draft = await budgets.createBudget({
        projectId: fixture.projectClsId,
        name: "PB-CLS",
        nameAr: null,
        note: null,
        actorId: PJW_ACTOR,
      });
      await expect(
        budgets.replaceLines(
          draft.id,
          [
            { costType: "LABOR", wbsTaskId: null, periodStart: "2026-02-01", periodEnd: "2026-02-28", plannedAmount: "100.0000", note: null },
            { costType: "LABOR", wbsTaskId: null, periodStart: "2026-02-01", periodEnd: "2026-03-15", plannedAmount: "200.0000", note: null },
          ],
          PJW_ACTOR,
        ),
      ).rejects.toBeInstanceOf(BudgetInputInvalidError);
    });
  });

  it("(b) the cross-project line is the typed refusal", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const draft = await budgets.createBudget({
        projectId: fixture.projectClsId,
        name: "PB-CLS-X",
        nameAr: null,
        note: null,
        actorId: PJW_ACTOR,
      });
      await expect(
        budgets.replaceLines(
          draft.id,
          [
            { costType: "LABOR", wbsTaskId: fixture.tasks.a, periodStart: "2026-02-01", periodEnd: "2026-02-28", plannedAmount: "100.0000", note: null },
          ],
          PJW_ACTOR,
        ),
      ).rejects.toBeInstanceOf(WbsCrossProjectError);
    });
  });

  it("(c) the lifecycle: the DRAFT replace → approve (one-approved) → the non-DRAFT refusal → close → the curve refusal", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const draft = await budgets.createBudget({
        projectId: fixture.projectClsId,
        name: "PB-CLS-3",
        nameAr: null,
        note: null,
        actorId: PJW_ACTOR,
      });
      // A clean replace works.
      const lines = await budgets.replaceLines(
        draft.id,
        [{ costType: "OVERHEAD", wbsTaskId: null, periodStart: "2026-02-01", periodEnd: "2026-02-28", plannedAmount: "100.0000", note: null }],
        PJW_ACTOR,
      );
      expect(lines).toHaveLength(1);
      // The non-DRAFT replace refuses (approve first).
      await budgets.approve(draft.id, PJW_ACTOR);
      await expect(
        budgets.replaceLines(draft.id, [], PJW_ACTOR),
      ).rejects.toBeInstanceOf(BudgetStateError);
      // The ONE-APPROVED law: a second budget cannot approve while one stands.
      const second = await budgets.createBudget({
        projectId: fixture.projectClsId,
        name: "PB-CLS-4",
        nameAr: null,
        note: null,
        actorId: PJW_ACTOR,
      });
      await expect(budgets.approve(second.id, PJW_ACTOR)).rejects.toBeInstanceOf(BudgetStateError);
      // CLOSED is readable history; the curve then refuses (no APPROVED).
      const closed = await budgets.close(draft.id, PJW_ACTOR);
      expect(closed.status).toBe("CLOSED");
      await expect(budgets.curve(fixture.projectClsId, "2026-12-31")).rejects.toBeInstanceOf(
        BudgetStateError,
      );
    });
  });

  it("(d) the cost curve: the APPROVED one alone, the exact interpolation (the pure fold over real rows)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // At 2026-01-16: LABOR 3,100 × 16/31 = 1,600.0000 (100/day);
      // MATERIAL 1,000 complete (window ended 01-10).
      const curve = await budgets.curve(fixture.project1Id, "2026-01-16");
      expect(curve.budgetId).toBeTruthy();
      expect(curve.totalPlanned).toBe("4100.0000");
      expect(curve.accruedByType).toEqual([
        { costType: "LABOR", accrued: "1600.0000" },
        { costType: "MATERIAL", accrued: "1000.0000" },
        { costType: "SUBCONTRACT", accrued: "0.0000" },
        { costType: "OVERHEAD", accrued: "0.0000" },
      ]);
      expect(curve.accruedTotal).toBe("2600.0000");
      // Before any window: the honest zero.
      const early = await budgets.curve(fixture.project1Id, "2025-12-31");
      expect(early.accruedTotal).toBe("0.0000");
      // Past every window: the full plan.
      const late = await budgets.curve(fixture.project1Id, "2026-12-31");
      expect(late.accruedTotal).toBe("4100.0000");
    });
  });

  it("(e) the vs-actual rollup: by cost type and by WBS node", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const vs = await budgets.vsActual(fixture.project1Id, "2026-12-31");
      expect(vs.byType).toEqual([
        { costType: "LABOR", planned: "3100.0000", actual: LABOR_TOTAL, variance: "2279.6875" },
        { costType: "MATERIAL", planned: "1000.0000", actual: "500.0000", variance: "500.0000" },
        { costType: "SUBCONTRACT", planned: "0.0000", actual: "9000.0000", variance: "-9000.0000" },
        { costType: "OVERHEAD", planned: "0.0000", actual: "625.0000", variance: "-625.0000" },
      ]);
      // The node arm: the labor leg is node-dimensioned (the only
      // node-dimensioned pair — D-04/D-05).
      expect(vs.byNode).toEqual([
        { wbsTaskId: fixture.tasks.a, plannedLabor: "3100.0000", actualLabor: "656.2500", variance: "2443.7500" },
        { wbsTaskId: fixture.tasks.b1, plannedLabor: "0.0000", actualLabor: "164.0625", variance: "-164.0625" },
      ]);
      expect(vs.totals).toEqual({
        planned: "4100.0000",
        actual: AC_TOTAL,
        variance: "-6845.3125",
      });
    });
  });
});

describe("PHASE-048 W-9 — T-06: the over-allocation WARNING (0101's read-side law)", () => {
  it("(a) overlapping windows over 100% WARN on read — the writes themselves NEVER refuse", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // 60% on P1 + 50% on P2 overlapping on exactly 2026-03-15 — both
      // writes succeed (the 0101 law: the warning is NEVER a write
      // refusal).
      const onP1 = await budgets.createAllocation({
        projectId: fixture.project1Id,
        wbsTaskId: fixture.tasks.a,
        resourceKind: "EMPLOYEE",
        employeeId: fixture.employeeId,
        assetId: null,
        startDate: "2026-03-01",
        endDate: "2026-03-15",
        allocationPercent: "60.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      const onP2 = await budgets.createAllocation({
        projectId: fixture.project2Id,
        wbsTaskId: null,
        resourceKind: "EMPLOYEE",
        employeeId: fixture.employeeId,
        assetId: null,
        startDate: "2026-03-15",
        endDate: "2026-04-15",
        allocationPercent: "50.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(onP1.allocationPercent).toBe("60.00");
      expect(onP2.allocationPercent).toBe("50.00");
      // The warning read on P1: the sweep spans ALL the tenant's
      // projects for the same employee (one calendar, one pool).
      const warnings = await budgets.overAllocationWarnings(fixture.project1Id);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toEqual({
        resourceKind: "EMPLOYEE",
        resourceId: fixture.employeeId,
        onDate: "2026-03-15",
        totalPercent: "110.00",
        allocationIds: expect.arrayContaining([onP1.id, onP2.id]),
      });
      expect(warnings[0]?.allocationIds).toHaveLength(2);
      // A non-overlapping third allocation adds no warning.
      await budgets.createAllocation({
        projectId: fixture.project1Id,
        wbsTaskId: null,
        resourceKind: "EMPLOYEE",
        employeeId: fixture.employeeId,
        assetId: null,
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        allocationPercent: "80.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      const after = await budgets.overAllocationWarnings(fixture.project1Id);
      expect(after).toHaveLength(1); // only the March overlap
      // The delete cleans the overlap away.
      await budgets.deleteAllocation(onP2.id, PJW_ACTOR);
      const cleaned = await budgets.overAllocationWarnings(fixture.project1Id);
      expect(cleaned).toHaveLength(0);
    });
  });
});
