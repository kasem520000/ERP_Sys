import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import {
  BudgetStateError,
  ChangeOrderInputInvalidError,
  ChangeOrderStateError,
} from "../../modules/crm/domain/projects-errors";
import { ChangeOrderService } from "../../modules/crm/application/change-order-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import * as gateStore from "../../modules/crm/infrastructure/change-order.store";
import {
  actuals,
  budgets,
  ensureP1BudgetWorld,
  ensurePjwAccount,
  ensureProjectByCode,
  mapPjwPurpose,
  PJW_ACTOR,
  pjw,
  seedRetentionCustomer,
  TENANT_PJW,
  wbs,
} from "./fixtures";

/**
 * PHASE-048 (W-10 — T-09) — the change-order approval gate pinned over
 * real PostgreSQL 16 (the plan §4's `projects-change-orders.db.spec` —
 * acceptance #5): change orders stay INERT until approved (BR-094);
 * approval applies G-58's delta EXACTLY ONCE (the engine posting with
 * its INV-013 source key + the single-use stamp + the ceiling
 * recompute) — and the postings never touch the GL project dimension
 * (INV-033 stays green by construction).
 *
 * THE DEDICATED WORLD (P6 "PJW-PRJ-CO"): a dated leaf task + the
 * approved budget PB-CO (one MATERIAL line, 1,000.0000 over January) +
 * the CUSTOMER retention register row (5,000.0000 SAR, hold 10%) —
 *   CO-A +500.0000 (schedule +10)   → approved, DR WIP · CR REVISE
 *   CO-B −200.0000                  → approved, the reversed pair
 *   CO-C +9999.0000                 → DRAFT, inert
 *   CO-D +500.0000                  → SUBMITTED → REJECTED, inert
 *   CO-E 0.0000 (scope-only)        → approved, NO journal (the honest
 *                                     shape), the stamp still consumed
 *   Σ approved deltas = +300.0000 → the ceiling: 5,000 → 5,300 ·
 *   BAC 1,000 → 1,300 · count 3 · schedule +10.
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const changeOrders = new ChangeOrderService(audit, posting);

let coProjectId = "";
let wipAccountId = "";
let reviseAccountId = "";

beforeAll(async () => {
  await ensureP1BudgetWorld();
  coProjectId = await ensureProjectByCode("PJW-PRJ-CO", "Change-order gate project");
  // The G-58 posting pair's fixture homes (the 0077 parenting
  // precedent — new leaves under existing groups; the MAPPING itself
  // lands inside arm (a), AFTER the unmapped-refusal proof).
  wipAccountId = await ensurePjwAccount({
    code: "1160",
    name: "Contract work in progress",
    nameAr: "أعمال العقد تحت التنفيذ",
    type: "ASSET",
    parentCode: "1100",
  });
  reviseAccountId = await ensurePjwAccount({
    code: "2150",
    name: "Contract revision reserve",
    nameAr: "احتياطي تعديلات العقد",
    type: "LIABILITY",
    parentCode: "2100",
  });
  await withTenant(TENANT_PJW, async () => {
    const tasks = await wbs.tree(coProjectId);
    if (tasks.length === 0) {
      await wbs.createTask({
        projectId: coProjectId,
        parentTaskId: null,
        predecessorTaskId: null,
        wbsCode: "CO-T",
        name: "Gate task",
        nameAr: "مهمة البوابة",
        isMilestone: false,
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        weight: null,
        percentComplete: "25.00",
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
    }
    const existing = await budgets.listBudgets(coProjectId);
    if (!existing.some((row) => row.name === "PB-CO")) {
      const draft = await budgets.createBudget({
        projectId: coProjectId,
        name: "PB-CO",
        nameAr: null,
        note: null,
        actorId: PJW_ACTOR,
      });
      await budgets.replaceLines(
        draft.id,
        [
          {
            costType: "MATERIAL",
            wbsTaskId: null,
            periodStart: "2026-01-01",
            periodEnd: "2026-01-31",
            plannedAmount: "1000.0000",
            note: null,
          },
        ],
        PJW_ACTOR,
      );
      await budgets.approve(draft.id, PJW_ACTOR);
    }
  });
  await seedRetentionCustomer({
    projectId: coProjectId,
    contractValue: "5000.0000",
    currencyCode: "SAR",
    holdPercent: "10.00",
  });
  // ORDER-ROBUSTNESS (the family chunk's file order is not guaranteed):
  // a sibling spec (the EVM re-baseline arm) may have mapped the G-58
  // pair before this file runs — supersede any standing mapping so arm
  // (a)'s unmapped-refusal phase proves its law regardless of order
  // (the supersede-then-map shape is the tenant's own runtime surface;
  // activeTo = the mapping's own activeFrom honors the 0007 window
  // CHECK for any stored from-date).
  await withTenant(TENANT_PJW, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    for (const key of ["CONTRACT_WIP", "CONTRACT_REVISE"]) {
      const active = await tenancy.findActivePurpose(key);
      if (active !== undefined) {
        await accounting.supersedePurpose(active.id, active.activeFrom);
      }
    }
  });
});

/** The journal lines a change order's G-58 entry posted (direction +
 * account code, by the INV-013 source key). */
async function g58Lines(changeOrderId: string): Promise<
  ReadonlyArray<{ direction: string; code: string; amount: string }>
> {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    code: string;
    amount: string;
  }>(sql`
    SELECT jl.direction, a.code, jl.base_amount::text AS amount
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.source_type = 'change_order' AND je.source_id = ${changeOrderId}
      AND je.operation = 'apply_effect'
    ORDER BY jl.line_no
  `);
  return rows.rows;
}

describe("PHASE-048 W-10 — T-09: the approval gate (BR-094 + G-58 + D-07)", () => {
  let coA = "";

  it("(a) THE GATE'S ATOMICITY: the unmapped pair refuses the approval AND rolls the verdict back; the mapping lands; the approval applies G-58 exactly once", async () => {
    // Phase 1 — the authoring (inert): create + submit.
    await withTenant(TENANT_PJW, async () => {
      const created = await changeOrders.create({
        projectId: coProjectId,
        coNo: "CO-A",
        title: "Additional retaining wall",
        titleAr: "جدار استنادي إضافي",
        scopeDelta: "Extra wall on the north side",
        scopeDeltaAr: null,
        priceDelta: "500.0000",
        scheduleDeltaDays: 10,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(created.status).toBe("DRAFT");
      coA = created.id;
      const submitted = await changeOrders.submit(coA, PJW_ACTOR);
      expect(submitted.status).toBe("SUBMITTED");
      expect(submitted.submittedAt).not.toBeNull();
      // The ceiling BEFORE approval: the order is INERT (BR-094).
      const before = await changeOrders.ceiling(coProjectId);
      expect(before.priceDeltaSum).toBe("0.0000");
      expect(before.approvedChangeOrders).toBe(0);
    });

    // Phase 2 — the unmapped refusal: the engine resolves the
    // contract-WIP/revise pair fail-closed PURPOSE_NOT_MAPPED (the
    // 038/0077 discipline — existing tenants map once).
    const refusal = await withTenant(TENANT_PJW, () =>
      changeOrders.approve(coA, PJW_ACTOR),
    ).catch((error: unknown) => error);
    expect((refusal as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");

    // Phase 3 — THE ROLLBACK PROOF: the failed posting rolled the whole
    // approval back — the order is STILL SUBMITTED, unstamped, no entry.
    await withTenant(TENANT_PJW, async () => {
      const after = await changeOrders.get(coA);
      expect(after.status).toBe("SUBMITTED");
      expect(after.approvedAt).toBeNull();
      expect(after.effectAppliedAt).toBeNull();
      expect(await g58Lines(coA)).toHaveLength(0);
    });

    // Phase 4 — the mapping lands (the tenant's own runtime surface),
    // and the approval NOW applies G-58 exactly once.
    await mapPjwPurpose("CONTRACT_WIP", wipAccountId);
    await mapPjwPurpose("CONTRACT_REVISE", reviseAccountId);
    const result = await withTenant(TENANT_PJW, () => changeOrders.approve(coA, PJW_ACTOR));
    expect(result.order.status).toBe("APPROVED");
    expect(result.order.approvedAt).not.toBeNull();
    expect(result.journalEntryId).toBeTruthy();
    expect(result.effectAppliedAt).not.toBeNull();
    // The entry's shape: |+500| DR the WIP · CR the revise (the
    // positive delta's direction law, D-18's G-58 wording).
    await withTenant(TENANT_PJW, async () => {
      expect(await g58Lines(coA)).toEqual([
        { direction: "DEBIT", code: "1160", amount: "500.0000" },
        { direction: "CREDIT", code: "2150", amount: "500.0000" },
      ]);
      // The ceiling NOW carries the delta — once.
      const ceiling = await changeOrders.ceiling(coProjectId);
      expect(ceiling.priceDeltaSum).toBe("500.0000");
      expect(ceiling.approvedChangeOrders).toBe(1);
      expect(ceiling.effectiveContractValue).toBe("5500.0000");
      expect(ceiling.budgetCeiling).toBe("1500.0000");
      expect(ceiling.scheduleDeltaDaysSum).toBe(10);
    });
  });

  it("(b) THE SINGLE-USE STAMP: a second approval is the typed refusal — still exactly ONE entry, the ceiling unmoved", async () => {
    const refusal = await withTenant(TENANT_PJW, () =>
      changeOrders.approve(coA, PJW_ACTOR),
    ).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ChangeOrderStateError);
    await withTenant(TENANT_PJW, async () => {
      // INV-013's own convergence: exactly one entry for the source key.
      expect(await g58Lines(coA)).toHaveLength(2); // one balanced pair
      const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM journal_entries
        WHERE source_type = 'change_order' AND source_id = ${coA} AND operation = 'apply_effect'
      `);
      expect(rows.rows[0]?.n).toBe(1);
      const ceiling = await changeOrders.ceiling(coProjectId);
      expect(ceiling.priceDeltaSum).toBe("500.0000");
      expect(ceiling.approvedChangeOrders).toBe(1);
      const order = await changeOrders.get(coA);
      expect(order.effectAppliedAt).not.toBeNull();
    });
  });

  it("(c) THE INERT LAW: DRAFT and REJECTED orders never enter any ceiling (BR-094)", async () => {
    await withTenant(TENANT_PJW, async () => {
      // A DRAFT order (never submitted).
      const draft = await changeOrders.create({
        projectId: coProjectId,
        coNo: "CO-C",
        title: "Gold-plated railings (draft, inert)",
        titleAr: null,
        scopeDelta: null,
        scopeDeltaAr: null,
        priceDelta: "9999.0000",
        scheduleDeltaDays: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      expect(draft.status).toBe("DRAFT");
      // A SUBMITTED → REJECTED order (the reason mandatory).
      const rejected = await changeOrders.create({
        projectId: coProjectId,
        coNo: "CO-D",
        title: "Rejected extras",
        titleAr: null,
        scopeDelta: null,
        scopeDeltaAr: null,
        priceDelta: "500.0000",
        scheduleDeltaDays: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await changeOrders.submit(rejected.id, PJW_ACTOR);
      const verdict = await changeOrders.reject(rejected.id, "Out of scope per the contract", PJW_ACTOR);
      expect(verdict.status).toBe("REJECTED");
      expect(verdict.rejectionReason).toBe("Out of scope per the contract");
      // Neither enters the ceiling.
      const ceiling = await changeOrders.ceiling(coProjectId);
      expect(ceiling.approvedChangeOrders).toBe(1);
      expect(ceiling.priceDeltaSum).toBe("500.0000");
      // The rejected order never posted.
      expect(await g58Lines(rejected.id)).toHaveLength(0);
      expect(await g58Lines(draft.id)).toHaveLength(0);
    });
  });

  it("(d) THE NEGATIVE DELTA: a credit-side order posts the REVERSED pair and reduces the ceilings", async () => {
    let coB = "";
    await withTenant(TENANT_PJW, async () => {
      const created = await changeOrders.create({
        projectId: coProjectId,
        coNo: "CO-B",
        title: "Omission — the deleted mezzanine",
        titleAr: null,
        scopeDelta: "Mezzanine deleted by the engineer",
        scopeDeltaAr: null,
        priceDelta: "-200.0000",
        scheduleDeltaDays: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      coB = created.id;
      await changeOrders.submit(coB, PJW_ACTOR);
      const result = await changeOrders.approve(coB, PJW_ACTOR);
      expect(result.order.status).toBe("APPROVED");
      expect(result.journalEntryId).toBeTruthy();
      // The reversed direction law: DR the revise · CR the WIP.
      expect(await g58Lines(coB)).toEqual([
        { direction: "DEBIT", code: "2150", amount: "200.0000" },
        { direction: "CREDIT", code: "1160", amount: "200.0000" },
      ]);
      // The ceiling: 500 − 200 = +300 net.
      const ceiling = await changeOrders.ceiling(coProjectId);
      expect(ceiling.priceDeltaSum).toBe("300.0000");
      expect(ceiling.approvedChangeOrders).toBe(2);
      expect(ceiling.effectiveContractValue).toBe("5300.0000");
      expect(ceiling.budgetCeiling).toBe("1300.0000");
    });
  });

  it("(e) THE ZERO-DELTA ORDER: a scope-only change posts NOTHING and still consumes its stamp (the honest shape)", async () => {
    await withTenant(TENANT_PJW, async () => {
      const created = await changeOrders.create({
        projectId: coProjectId,
        coNo: "CO-E",
        title: "Paint color change (no price effect)",
        titleAr: null,
        scopeDelta: "From beige to white",
        scopeDeltaAr: null,
        priceDelta: "0.0000",
        scheduleDeltaDays: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await changeOrders.submit(created.id, PJW_ACTOR);
      const result = await changeOrders.approve(created.id, PJW_ACTOR);
      expect(result.order.status).toBe("APPROVED");
      expect(result.journalEntryId).toBeNull(); // nothing to post
      expect(result.effectAppliedAt).not.toBeNull(); // the stamp still consumes
      // The ceiling: the zero delta counts as an approved order, moves nothing.
      const ceiling = await changeOrders.ceiling(coProjectId);
      expect(ceiling.approvedChangeOrders).toBe(3);
      expect(ceiling.priceDeltaSum).toBe("300.0000");
      expect(ceiling.effectiveContractValue).toBe("5300.0000");
      expect(ceiling.budgetCeiling).toBe("1300.0000");
      expect(ceiling.scheduleDeltaDaysSum).toBe(10);
    });
  });

  it("(f) INV-033 STAYS GREEN: the G-58 postings carry NO project stamp — the GL project dimension is the cost carry, untouched by the revaluations", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      const report = await actuals.inv033(fixture.project1Id);
      expect(report.acTotal).toBe("10945.3125");
      expect(report.residual).toBe("0.0000");
    });
  });

  it("(g) the lifecycle + shape refusals (the 045 simple-approval laws — the service-level arms; the SQL-error arm rides its own it below)", async () => {
    await withTenant(TENANT_PJW, async () => {
      // A DRAFT order cannot approve (the gate runs through SUBMITTED).
      const draft = await changeOrders.create({
        projectId: coProjectId,
        coNo: "CO-F",
        title: "Skip-the-queue attempt",
        titleAr: null,
        scopeDelta: null,
        scopeDeltaAr: null,
        priceDelta: "100.0000",
        scheduleDeltaDays: null,
        note: null,
        noteAr: null,
        actorId: PJW_ACTOR,
      });
      await expect(changeOrders.approve(draft.id, PJW_ACTOR)).rejects.toBeInstanceOf(
        ChangeOrderStateError,
      );
      // A SUBMITTED order cannot re-submit.
      await changeOrders.submit(draft.id, PJW_ACTOR);
      await expect(changeOrders.submit(draft.id, PJW_ACTOR)).rejects.toBeInstanceOf(
        ChangeOrderStateError,
      );
      // The rejection reason is mandatory (3…500).
      await expect(
        changeOrders.reject(draft.id, "no", PJW_ACTOR),
      ).rejects.toBeInstanceOf(ChangeOrderInputInvalidError);
      // A decided order cannot re-decide.
      await changeOrders.reject(draft.id, "Withdrawn by the requester", PJW_ACTOR);
      await expect(changeOrders.approve(draft.id, PJW_ACTOR)).rejects.toBeInstanceOf(
        ChangeOrderStateError,
      );
      // The zero schedule delta is 0102's own CHECK (non-zero or null).
      await expect(
        changeOrders.create({
          projectId: coProjectId,
          coNo: "CO-G",
          title: "Zero-day schedule",
          titleAr: null,
          scopeDelta: null,
          scopeDeltaAr: null,
          priceDelta: "1.0000",
          scheduleDeltaDays: 0,
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ChangeOrderInputInvalidError);
      // The malformed price delta (more than 4dp).
      await expect(
        changeOrders.create({
          projectId: coProjectId,
          coNo: "CO-H",
          title: "Too precise",
          titleAr: null,
          scopeDelta: null,
          scopeDeltaAr: null,
          priceDelta: "1.00001",
          scheduleDeltaDays: null,
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ).rejects.toBeInstanceOf(ChangeOrderInputInvalidError);
    });
  });

  it("(h) the duplicate co_no is the typed 23505 refusal (the SQL-error arm rides its own it — the W-9 lesson)", async () => {
    await expect(
      withTenant(TENANT_PJW, () =>
        changeOrders.create({
          projectId: coProjectId,
          coNo: "CO-A",
          title: "Duplicate number",
          titleAr: null,
          scopeDelta: null,
          scopeDeltaAr: null,
          priceDelta: "1.0000",
          scheduleDeltaDays: null,
          note: null,
          noteAr: null,
          actorId: PJW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ChangeOrderInputInvalidError);
  });

  it("(i) the ceiling's honest absences: no register row and no approved budget read null, never fabricated zeros", async () => {
    await withTenant(TENANT_PJW, async () => {
      const fixture = pjw();
      // P2 has neither a register row nor an approved budget.
      const ceiling = await changeOrders.ceiling(fixture.project2Id);
      expect(ceiling.contractBase).toBeNull();
      expect(ceiling.effectiveContractValue).toBeNull();
      expect(ceiling.approvedBudgetTotal).toBeNull();
      expect(ceiling.budgetCeiling).toBeNull();
      expect(ceiling.priceDeltaSum).toBe("0.0000");
      expect(ceiling.approvedChangeOrders).toBe(0);
      // The EVM side refuses on a budget-less project (the curve law).
      await expect(budgets.curve(fixture.project2Id, "2026-12-31")).rejects.toBeInstanceOf(
        BudgetStateError,
      );
      // The store's inert read: only APPROVED rows counted.
      const deltas = await gateStore.approvedDeltaSum(fixture.project2Id);
      expect(deltas.count).toBe(0);
    });
  });
});
