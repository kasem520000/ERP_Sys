import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { BudgetStateError, EvmInputInvalidError } from "../../modules/crm/domain/projects-errors";
import {
  costPerformanceIndex,
  forecastAtCompletion,
  schedulePerformanceIndex,
} from "../../modules/crm/domain/evm-math";
import { EvmService } from "../../modules/crm/application/evm-service";
import { ChangeOrderService } from "../../modules/crm/application/change-order-service";
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
  mintJournal,
  PJW_ACTOR,
  pjw,
  seedIssueMove,
  seedProgressCertificate,
  superuserClient,
  TENANT_PJW,
  wbs,
} from "./fixtures";

/**
 * PHASE-048 (W-10 — T-08) — the EVM engine pinned over real PostgreSQL
 * 16 (the plan §4's `projects-evm.db.spec` — acceptance #4): PV
 * exclusively from the APPROVED curve, the TWO EV disciplines with
 * their delta as the management signal, AC from T-07's output alone,
 * CPI/SPI/ETC/EAC per project and per node, the EV ceiling at every
 * scope (the boundary legal), and BAC's re-baseline through the change
 * -order gate (G-58).
 *
 * THE DEDICATED WORLD (P4 "PJW-PRJ-EVM", every figure hand-computed):
 * the tree T → L1 (weight 50, 40%) + L2 (weight 50, 80%) → the
 * aggregate percent 60.00 EXACT; the approved budget LABOR-on-L1
 * 1,000.0000 (Jan 1–10, 100/day) + MATERIAL 500.0000 (Jan 1–10) =
 * 1,500.0000; ONE materials issue (the project-stamped posting 300 +
 * the tied move — no time entries on P4, so the tenant-wide
 * LABOR_HOURS overhead shares of P1/P2 stay EXACTLY as the W-9 world
 * pinned them); the APPROVED progress certificate at 50%.
 *   at asOf 2026-01-05: PV 750.0000 (500 + 250) · EV 900.0000 (60% ×
 *   1,500) · AC 300.0000 · CPI 3.000000 · SPI 1.200000 · ETC 200.0000
 *   · EAC 500.0000 · node L1: planned 1,000 · PV 500 · EV 400 · the
 *   certificate EV 750.0000 (50% × 1,500) · delta +150.0000.
 *   after the +250 change order (arm d): BAC 1,750 · EV 1,050 · the
 *   certificate EV 875 — the gate is the only re-planning path.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const evm = new EvmService(budgets, actuals);
const changeOrders = new ChangeOrderService(audit, posting);

let evmProjectId = "";

beforeAll(async () => {
  await ensureP1BudgetWorld();
  evmProjectId = await ensureProjectByCode("PJW-PRJ-EVM", "EVM clean-numbers project");
  await withTenant(TENANT_PJW, async () => {
    const fixture = pjw();
    let tree = await wbs.tree(evmProjectId);
    if (tree.length === 0) {
      const root = await wbs.createTask({
        projectId: evmProjectId,
        parentTaskId: null,
        predecessorTaskId: null,
        wbsCode: "T",
        name: "EVM root",
        nameAr: "جذر القياس",
        isMilestone: false,
        startDate: "2026-01-01",
        endDate: "2026-06-30",
        weight: null,
        percentComplete: "0.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await wbs.createTask({
        projectId: evmProjectId,
        parentTaskId: root.id,
        predecessorTaskId: null,
        wbsCode: "T.L1",
        name: "Leaf one",
        nameAr: "الورقة الأولى",
        isMilestone: false,
        startDate: "2026-01-01",
        endDate: "2026-03-31",
        weight: "50.0000",
        percentComplete: "40.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await wbs.createTask({
        projectId: evmProjectId,
        parentTaskId: root.id,
        predecessorTaskId: null,
        wbsCode: "T.L2",
        name: "Leaf two",
        nameAr: "الورقة الثانية",
        isMilestone: false,
        startDate: "2026-02-01",
        endDate: "2026-06-30",
        weight: "50.0000",
        percentComplete: "80.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      tree = await wbs.tree(evmProjectId);
    }
    const l1 = (await wbs.rollup(evmProjectId)).nodes.find(
      (node) => node.wbsCode === "T.L1",
    )!;
    const budgetRows = await budgets.listBudgets(evmProjectId);
    if (!budgetRows.some((row) => row.name === "PB-EVM")) {
      const draft = await budgets.createBudget({
        projectId: evmProjectId,
        name: "PB-EVM",
        nameAr: null,
        note: null,
        actorId: PJW_ACTOR,
      });
      await budgets.replaceLines(
        draft.id,
        [
          {
            costType: "LABOR",
            wbsTaskId: l1.id,
            periodStart: "2026-01-01",
            periodEnd: "2026-01-10",
            plannedAmount: "1000.0000",
            note: null,
          },
          {
            costType: "MATERIAL",
            wbsTaskId: null,
            periodStart: "2026-01-01",
            periodEnd: "2026-01-10",
            plannedAmount: "500.0000",
            note: null,
          },
        ],
        PJW_ACTOR,
      );
      await budgets.approve(draft.id, PJW_ACTOR);
    }
    // The materials leg: ONE project-stamped issue (300) + the tied
    // move. No time entries on P4 — the overhead driver's shares stay
    // exactly the W-9 world's (P1 12.5/20, P2 7.5/20).
    if ((await requireMovesCount(evmProjectId)) === 0) {
      const journal = await mintJournal({
        debitAccountId: fixture.projectCostAccountId,
        creditAccountId: fixture.apControlAccountId,
        amount: "300.0000",
        entryDate: "2026-01-05",
        projectId: evmProjectId,
        partnerId: fixture.supplierPartnerId,
        description: "P4 materials issue",
      });
      await seedIssueMove({ journalEntryId: journal, valueAmount: "300.0000", movedAt: "2026-01-05" });
    }
  });
});

async function requireMovesCount(projectId: string): Promise<number> {
  const su = await superuserClient();
  const rows = await su.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM stock_moves sm
     WHERE sm.tenant_id = $1 AND sm.direction = 'OUT' AND sm.move_kind = 'issue'
       AND EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.journal_entry_id = sm.posted_journal_id AND jl.project_id = $2)`,
    [TENANT_PJW, projectId],
  );
  await su.end();
  return rows.rows[0]?.n ?? 0;
}

describe("PHASE-048 W-10 — T-08: the EVM snapshot (D-06 — acceptance #4)", () => {
  it("(a) the clean world at 2026-01-05: PV from the approved curve, the structural EV, AC from T-07, the indices, the forecast — NO certificate yet", async () => {
    await withTenant(TENANT_PJW, async () => {
      const snapshot = await evm.snapshot(evmProjectId, "2026-01-05");
      // The budget block: the approved curve + zero deltas.
      expect(snapshot.budget).toEqual({
        budgetId: snapshot.budget.budgetId, // opaque
        approvedTotal: "1500.0000",
        approvedChangeOrders: 0,
        priceDeltaSum: "0.0000",
        bac: "1500.0000",
      });
      // PV — the approved curve's accrual (100/day × 5 days on both cells).
      expect(snapshot.pv).toBe("750.0000");
      // The structural discipline: 60.00% × 1,500 = 900 EXACT.
      expect(snapshot.ev.structural.percent).toBe("60.00");
      expect(snapshot.ev.structural.value).toBe("900.0000");
      // No certificate yet — the discipline is absent, never a zero.
      expect(snapshot.ev.certificate).toBeNull();
      expect(snapshot.ev.delta).toBeNull();
      expect(snapshot.ev.signal).toBe("NO_CERTIFICATE");
      // AC — the T-07 breakdown's own total (the materials leg alone).
      expect(snapshot.ac.total).toBe("300.0000");
      expect(snapshot.ac.materials).toBe("300.0000");
      expect(snapshot.ac.labor).toBe("0.0000");
      expect(snapshot.ac.overhead).toBe("0.0000");
      const breakdown = await actuals.breakdown(evmProjectId);
      expect(snapshot.ac.total).toBe(breakdown.acTotal); // the same fold
      // The indices.
      expect(snapshot.indices.cpi).toBe("3.000000");
      expect(snapshot.indices.spi).toBe("1.200000");
      // The forecast — CPI_BASED: (1500−900)×300/900 = 200.
      expect(snapshot.forecast).toEqual({ etc: "200.0000", eac: "500.0000", method: "CPI_BASED" });
      // The node arm: L1 only (L2 carries no cells and no labor — the
      // honest exclusion).
      expect(snapshot.nodes).toHaveLength(1);
      expect(snapshot.nodes[0]).toMatchObject({
        wbsCode: "T.L1",
        planned: "1000.0000",
        pv: "500.0000",
        rolledPercent: "40.00",
        ev: "400.0000",
        acLabor: "0.0000",
        cpi: null,
        spi: "0.800000",
      });
      // The disclosures: the unbudgeted-leaf cut + the labor-only node AC.
      expect(snapshot.disclosures.join(" ")).toContain("two honest cuts");
      expect(snapshot.disclosures.join(" ")).toContain("LABOR leg only");
    });
  });

  it("(b) the certificate discipline lands: the APPROVED certificate's cumulative percent × BAC, the delta the management signal", async () => {
    await seedProgressCertificate({
      projectId: evmProjectId,
      certificateDate: "2026-01-05",
      kind: "PROGRESS",
      cumulativePercent: "50.00",
      grossValue: "750.0000",
      retentionAmount: "75.0000",
      netValue: "675.0000",
    });
    await withTenant(TENANT_PJW, async () => {
      const snapshot = await evm.snapshot(evmProjectId, "2026-01-05");
      expect(snapshot.ev.certificate).not.toBeNull();
      expect(snapshot.ev.certificate?.cumulativePercent).toBe("50.00");
      expect(snapshot.ev.certificate?.value).toBe("750.0000"); // 50% × 1,500
      // The delta: 900 − 750 = +150 — the structural report runs ahead.
      expect(snapshot.ev.delta).toBe("150.0000");
      expect(snapshot.ev.signal).toBe("STRUCTURAL_AHEAD");
    });
  });

  it("(c) the shared P1 world at 2026-01-16: every figure hand-computed against the W-9 coherent world", async () => {
    const fixture = pjw();
    await seedProgressCertificate({
      projectId: fixture.project1Id,
      certificateDate: "2026-01-16",
      kind: "PROGRESS",
      cumulativePercent: "55.00",
      grossValue: "2255.0000",
      retentionAmount: "225.5000",
      netValue: "2029.5000",
    });
    await withTenant(TENANT_PJW, async () => {
      const snapshot = await evm.snapshot(fixture.project1Id, "2026-01-16");
      // PV — the W-9 curve's own pinned interpolation (1,600 + 1,000).
      expect(snapshot.pv).toBe("2600.0000");
      // BAC — the approved total, no COs on P1.
      expect(snapshot.budget.bac).toBe("4100.0000");
      expect(snapshot.budget.approvedTotal).toBe("4100.0000");
      // The structural EV: the exact 5,700/101 ratio × 4,100 = 2,313.8614
      // (ONE rounding at money — never the 56.44 display's 2,314.04).
      expect(snapshot.ev.structural.percent).toBe("56.44");
      expect(snapshot.ev.structural.value).toBe("2313.8614");
      // The certificate EV: 55% × 4,100.
      expect(snapshot.ev.certificate?.value).toBe("2255.0000");
      expect(snapshot.ev.delta).toBe("58.8614");
      expect(snapshot.ev.signal).toBe("STRUCTURAL_AHEAD");
      // AC — the T-07 output ALONE (the W-9 pinned AC).
      expect(snapshot.ac.total).toBe("10945.3125");
      const breakdown = await actuals.breakdown(fixture.project1Id);
      expect(snapshot.ac.total).toBe(breakdown.acTotal);
      // The indices + the forecast ride the pure folds over the pinned
      // inputs (the unit spec owns the arithmetic).
      expect(snapshot.indices.cpi).toBe(costPerformanceIndex("2313.8614", "10945.3125"));
      expect(snapshot.indices.spi).toBe(schedulePerformanceIndex("2313.8614", "2600.0000"));
      expect(snapshot.forecast).toEqual(forecastAtCompletion("4100.0000", "2313.8614", "10945.3125"));
      // The node arm — the W-9 byNode shape (A budgeted, B1 labor-only).
      expect(snapshot.nodes).toHaveLength(2);
      expect(snapshot.nodes[0]).toMatchObject({
        wbsCode: "R.A",
        planned: "3100.0000",
        pv: "1600.0000",
        rolledPercent: "50.00",
        ev: "1550.0000",
        acLabor: "656.2500",
      });
      expect(snapshot.nodes[1]).toMatchObject({
        wbsCode: "R.B.1",
        planned: "0.0000",
        pv: "0.0000",
        rolledPercent: "80.00",
        ev: "0.0000",
        acLabor: "164.0625",
      });
    });
  });

  it("(d) THE RE-BASELINE: an approved change order moves BAC exactly once — and the EVM's BAC equals the gate's own ceiling read", async () => {
    // The G-58 pair maps (idempotent — the CO spec mapped it in the
    // family run; a standalone run maps it here).
    const wip = await ensurePjwAccount({
      code: "1160",
      name: "Contract work in progress",
      nameAr: "أعمال العقد تحت التنفيذ",
      type: "ASSET",
      parentCode: "1100",
    });
    const revise = await ensurePjwAccount({
      code: "2150",
      name: "Contract revision reserve",
      nameAr: "احتياطي تعديلات العقد",
      type: "LIABILITY",
      parentCode: "2100",
    });
    await mapPjwPurpose("CONTRACT_WIP", wip);
    await mapPjwPurpose("CONTRACT_REVISE", revise);

    await withTenant(TENANT_PJW, async () => {
      const created = await changeOrders.create({
        projectId: evmProjectId,
        coNo: "CO-EVM-1",
        title: "Extra scope — the EVM re-baseline probe",
        titleAr: null,
        scopeDelta: null,
        scopeDeltaAr: null,
        priceDelta: "250.0000",
        scheduleDeltaDays: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await changeOrders.submit(created.id, PJW_ACTOR);
      const result = await changeOrders.approve(created.id, PJW_ACTOR);
      expect(result.journalEntryId).toBeTruthy();
    });

    await withTenant(TENANT_PJW, async () => {
      const snapshot = await evm.snapshot(evmProjectId, "2026-01-05");
      // BAC re-baselined: 1,500 + 250 — the gate is the only path.
      expect(snapshot.budget.approvedTotal).toBe("1500.0000");
      expect(snapshot.budget.priceDeltaSum).toBe("250.0000");
      expect(snapshot.budget.approvedChangeOrders).toBe(1);
      expect(snapshot.budget.bac).toBe("1750.0000");
      // Both EV disciplines re-baseline against the NEW BAC.
      expect(snapshot.ev.structural.value).toBe("1050.0000"); // 60% × 1,750
      expect(snapshot.ev.certificate?.value).toBe("875.0000"); // 50% × 1,750
      expect(snapshot.ev.delta).toBe("175.0000");
      // The forecast at the new BAC: (1750−1050)×300/1050 = 200 exact.
      expect(snapshot.forecast).toEqual({ etc: "200.0000", eac: "500.0000", method: "CPI_BASED" });
      // THE TIE: the EVM's BAC is the gate's own ceiling read.
      const ceiling = await changeOrders.ceiling(evmProjectId);
      expect(ceiling.budgetCeiling).toBe("1750.0000");
      expect(ceiling.budgetCeiling).toBe(snapshot.budget.bac);
    });
  });

  it("(e) THE EV CEILING'S BOUNDARY: a 100% node earns EXACTLY its planned cells — legal, never more", async () => {
    await withTenant(TENANT_PJW, async () => {
      const nodes = (await wbs.rollup(evmProjectId)).nodes;
      const l1 = nodes.find((node) => node.wbsCode === "T.L1")!;
      await wbs.updateTask(l1.id, {
        percentComplete: "100.00",
        actorId: PJW_ACTOR,
      });
      const snapshot = await evm.snapshot(evmProjectId, "2026-01-05");
      const node = snapshot.nodes.find((row) => row.wbsCode === "T.L1")!;
      expect(node.rolledPercent).toBe("100.00");
      expect(node.ev).toBe("1000.0000"); // = planned — the boundary
      expect(node.ev).toBe(node.planned);
      // The project percent: (50×100 + 50×80)/100 = 90.00.
      expect(snapshot.ev.structural.percent).toBe("90.00");
      expect(snapshot.ev.structural.value).toBe("1575.0000"); // 90% × 1,750
    });
  });

  it("(f) the refusals: no APPROVED budget → the curve law's typed refusal; the input shapes", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // P2 holds no APPROVED budget — PV refuses (the approved curve
      // ALONE, D-04's own law through the EVM read).
      await expect(evm.snapshot(fixture.project2Id, "2026-01-16")).rejects.toBeInstanceOf(
        BudgetStateError,
      );
      await expect(evm.snapshot("not-a-uuid", "2026-01-16")).rejects.toBeInstanceOf(
        EvmInputInvalidError,
      );
      await expect(evm.snapshot(fixture.project1Id, "2026-13-45")).rejects.toBeInstanceOf(
        EvmInputInvalidError,
      );
    });
  });

  it("(g) INV-033 stays green on the EVM world too (the materials posting ties the GL dimension)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const report = await actuals.inv033(evmProjectId);
      expect(report.acTotal).toBe("300.0000");
      expect(report.glProjectDimension.net).toBe("300.0000");
      expect(report.residual).toBe("0.0000");
    });
  });
});
