import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { MaintenanceWorkOrderService } from "../../modules/fixed_assets/application/maintenance-work-order-service";
import {
  CmmsAssetNotOperableError,
  CmmsCostLineUnpricedError,
  CmmsPartsShortfallError,
  CmmsRateSnapshotError,
  CmmsStepsOpenError,
  CmmsWorkOrderCompletedError,
  CmmsWorkOrderStateError,
  CmmsWorkOrderZeroTotalError,
} from "../../modules/fixed_assets/domain/cmms-errors";
import { reconcileWorkOrderCosts } from "../../modules/fixed_assets/domain/cmms-plan-math";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import {
  CM_ACTOR,
  TENANT_CMMS,
  ensureCmmsG59World,
  freshAsset,
  numbering,
  posting,
  type CmmsG59World,
} from "./fixtures";

/**
 * PHASE-049 (W-17 — T-05 + T-06) — the work-order engine pinned over
 * real PostgreSQL 16 (the plan §4's `cmms-workorders.db.spec`):
 *
 * - THE MACHINE (D-03): the legal ladder walks REQUESTED → PLANNED →
 *   IN_PROGRESS ↔ ON_HOLD → COMPLETED one CAS per move; every illegal
 *   transition refuses BY NAME (WORK_ORDER_STATE_ERROR carrying both
 *   ends — the skip, the regression, the move out of the terminal
 *   COMPLETED; never a raw constraint whisper).
 * - THE COST COLLECTORS (D-03/D-05): the labor snapshot pricing (hours ×
 *   rate, ONE half-up 4dp rounding — the pure fold), the UNPRICED line
 *   (rate omitted), the pricing of an unpriced line (NULL→value), the
 *   frozen snapshot (re-pricing refuses BY NAME), the parts
 *   line-creation floor (the named shortfall — D-05's first half), and
 *   the post-completion freeze (every touch refuses BY NAME).
 * - THE COMPLETION GATE (BR-098): open steps refuse (the count + the
 *   titles), unpriced lines refuse (every offending line), the
 *   zero-total law refuses (the fused machine's own consequence).
 * - THE G-59 ACT (D-04/D-05 — the owner's merged four-conditions
 *   ruling): D-04's worked example end to end — labor 2.5h × 480 = 1,200
 *   + parts 20 × 40 = 800 + external 500 → DR MAINTENANCE_EXPENSE 2,500
 *   · CR INVENTORY 800 · CR LABOR_CLEARING 1,200 · CR EXTERNAL_ACCRUAL
 *   500 — ONE entry, the parts issued through the REAL WMS path in the
 *   SAME transaction (the stock decremented 100 → 80, the move sourced
 *   maintenance_work_order), the asset's cost and accumulated
 *   depreciation UNTOUCHED, INV-034 balanced BY CONSTRUCTION (the fold's
 *   verdict), the single-use stamp + the journal link in the same
 *   guarded UPDATE, and the replay the typed refusal.
 * - THE ALL-OR-NOTHING ARM (the ruling's second condition): an
 *   unmapped MAINTENANCE_EXPENSE purpose makes the posting fail — the
 *   whole act rolls back (the order stays IN_PROGRESS, the stock intact,
 *   zero journal rows — together-or-nothing).
 */

const audit = new AuditService(new DrizzleAuditStore());
const orders = new MaintenanceWorkOrderService(audit, posting, numbering);

let world: CmmsG59World;

/** Canonical decimal comparison (the DB returns numerics at their full
 * column scale — "500.0000"/"480.000000" — the spec compares VALUES). */
function expectDec(actual: string | null | undefined, expected: string): void {
  expect(actual === null || actual === undefined ? null : new Decimal(actual).toString()).toBe(
    new Decimal(expected).toString(),
  );
}

beforeAll(async () => {
  world = await ensureCmmsG59World();
});

/** The full legal walk to IN_PROGRESS on a fresh world. */
async function startOrder(code: string, problem = "Won't start"): Promise<string> {
  const asset = await freshAsset(code);
  const created = await orders.create({
    assetId: asset,
    problem,
    actorId: CM_ACTOR,
  });
  await orders.plan(created.id, CM_ACTOR);
  await orders.start(created.id, CM_ACTOR);
  return created.id;
}

/** The journal lines a work order's G-59 entry posted (direction + account
 * code + amount, by the INV-013 source key). */
async function g59Lines(orderId: string): Promise<
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
    WHERE je.source_type = 'maintenance_work_order' AND je.source_id = ${orderId}
      AND je.operation = 'complete'
    ORDER BY jl.line_no
  `);
  return rows.rows;
}

describe("PHASE-049 W-17 — the machine (D-03: the ladder, one CAS per move)", () => {
  it("the legal ladder walks REQUESTED → PLANNED → IN_PROGRESS ↔ ON_HOLD → COMPLETED", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("WO-MACH-A");
      const created = await orders.create({ assetId: asset, problem: "Ladder walk", actorId: CM_ACTOR });
      expect(created.status).toBe("REQUESTED");
      expect(created.orderNo).toMatch(/^MO-\d{4}-\d{6}$/);

      const planned = await orders.plan(created.id, CM_ACTOR);
      expect(planned.status).toBe("PLANNED");
      expect(planned.plannedAt).not.toBeNull();
      expect(planned.startedAt).toBeNull();

      const started = await orders.start(created.id, CM_ACTOR);
      expect(started.status).toBe("IN_PROGRESS");
      expect(started.startedAt).not.toBeNull();

      const held = await orders.hold(created.id, CM_ACTOR);
      expect(held.status).toBe("ON_HOLD");
      // The pause keeps the start stamp (the single clock's own law).
      expect(held.startedAt).toBe(started.startedAt);

      const resumed = await orders.resume(created.id, CM_ACTOR);
      expect(resumed.status).toBe("IN_PROGRESS");

      // A fresh pause → then COMPLETED from ON_HOLD (the phase doc's own
      // sequence: ... IN_PROGRESS ↔ ON_HOLD → COMPLETED).
      await orders.hold(created.id, CM_ACTOR);
      const priced = await orders.addLine({
        workOrderId: created.id,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "500",
        description: "External calibration",
        actorId: CM_ACTOR,
      });
      expect(priced.amount !== null && priced.amount !== undefined).toBe(true);
      expectDec(priced.amount, "500");
      const completed = await orders.complete({
        workOrderId: created.id,
        solution: "Fixed",
        actorId: CM_ACTOR,
      });
      expect(completed.order.status).toBe("COMPLETED");
      expect(completed.order.completedAt).not.toBeNull();
      expect(completed.order.journalEntryId).not.toBeNull();
      expectDec(completed.order.externalTotal, "500");
    });
  });

  it("every ILLEGAL transition refuses BY NAME — WORK_ORDER_STATE_ERROR with both ends", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("WO-MACH-B");
      const created = await orders.create({ assetId: asset, problem: "Refusals", actorId: CM_ACTOR });
      const orderId = created.id;

      // The skip: REQUESTED → IN_PROGRESS.
      const skip = await orders.start(orderId, CM_ACTOR).catch((error: unknown) => error);
      expect(skip).toBeInstanceOf(CmmsWorkOrderStateError);
      expect((skip as CmmsWorkOrderStateError).code).toBe("WORK_ORDER_STATE_ERROR");
      expect((skip as CmmsWorkOrderStateError).details).toMatchObject({
        from: "REQUESTED",
        to: "IN_PROGRESS",
      });

      // The pause on the unstarted plane (the pause exists on the started
      // plane only — the service_visits precedent).
      const earlyHold = await orders.hold(orderId, CM_ACTOR).catch((error: unknown) => error);
      expect(earlyHold).toBeInstanceOf(CmmsWorkOrderStateError);

      await orders.plan(orderId, CM_ACTOR);
      // The regression: PLANNED → REQUESTED has no route — the resume
      // refuses (only ON_HOLD resumes).
      const regression = await orders.resume(orderId, CM_ACTOR).catch((error: unknown) => error);
      expect(regression).toBeInstanceOf(CmmsWorkOrderStateError);

      // The completed terminal state: complete the world, then every move
      // refuses (the freeze, not the ladder — the named WORK_ORDER_COMPLETED).
      await orders.start(orderId, CM_ACTOR);
      await orders.addLine({
        workOrderId: orderId,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "100",
        description: "Bill",
        actorId: CM_ACTOR,
      });
      await orders.complete({ workOrderId: orderId, actorId: CM_ACTOR });
      const after = await orders.plan(orderId, CM_ACTOR).catch((error: unknown) => error);
      expect(after).toBeInstanceOf(CmmsWorkOrderCompletedError);
      expect((after as CmmsWorkOrderCompletedError).code).toBe("WORK_ORDER_COMPLETED");
    });
  });

  it("D-01's authoring guard: a DISPOSED asset opens no work order — ASSET_NOT_OPERABLE by name", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("WO-MACH-C");
      const su = await (await import("./fixtures")).superuserClient();
      await su.query(`UPDATE assets SET status = 'DISPOSED' WHERE tenant_id = $1 AND id = $2`, [
        TENANT_CMMS,
        asset,
      ]);
      await su.end();
      const refusal = await orders
        .create({ assetId: asset, problem: "Too late", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(CmmsAssetNotOperableError);
      expect((refusal as CmmsAssetNotOperableError).code).toBe("ASSET_NOT_OPERABLE");
    });
  });
});

describe("PHASE-049 W-17 — the cost collectors (D-03/D-05)", () => {
  it("the LABOR snapshot pricing: amount = hours × rate with ONE half-up 4dp rounding (the pure fold)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const orderId = await startOrder("WO-COST-A");
      const line = await orders.addLine({
        workOrderId: orderId,
        legType: "LABOR",
        employeeId: world.technicianEmployeeId,
        hours: "2.5",
        unitRate: "480",
        actorId: CM_ACTOR,
      });
      // 2.5h × 480 = 1,200 exactly (D-04's worked example's labor leg).
      expectDec(line.amount, "1200");
      expectDec(line.unitRate, "480");
    });
  });

  it("the UNPRICED labor line (rate omitted) + the NULL→value pricing + the FROZEN snapshot", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const orderId = await startOrder("WO-COST-B");
      const unpriced = await orders.addLine({
        workOrderId: orderId,
        legType: "LABOR",
        employeeId: world.technicianEmployeeId,
        hours: "3",
        actorId: CM_ACTOR,
      });
      expect(unpriced.amount).toBeNull();
      expect(unpriced.unitRate).toBeNull();

      // BR-098's unpriced gate refuses the completion naming the line.
      const gated = await orders
        .complete({ workOrderId: orderId, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(gated).toBeInstanceOf(CmmsCostLineUnpricedError);
      expect((gated as CmmsCostLineUnpricedError).code).toBe("COST_LINE_UNPRICED");
      expect((gated as CmmsCostLineUnpricedError).details).toMatchObject({
        unpriced: [{ lineNo: 1, legType: "LABOR" }],
      });

      // The NULL→value pricing (the only legal re-price).
      const priced = await orders.priceLine({
        workOrderId: orderId,
        lineId: unpriced.id,
        unitRate: "400",
        actorId: CM_ACTOR,
      });
      expectDec(priced.amount, "1200");

      // The snapshot is FROZEN once priced — re-pricing refuses BY NAME.
      const frozen = await orders
        .priceLine({ workOrderId: orderId, lineId: unpriced.id, unitRate: "500", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(frozen).toBeInstanceOf(CmmsRateSnapshotError);
      expect((frozen as CmmsRateSnapshotError).code).toBe("COST_RATE_SNAPSHOT");
    });
  });

  it("D-05's line-creation floor: the parts shortfall refuses BY NAME (never a silent backorder)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const orderId = await startOrder("WO-COST-C");
      const refusal = await orders
        .addLine({
          workOrderId: orderId,
          legType: "PARTS",
          itemId: world.itemId,
          warehouseId: world.warehouseId,
          qty: "150",
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(CmmsPartsShortfallError);
      expect((refusal as CmmsPartsShortfallError).code).toBe("PARTS_SHORTFALL");
      expectDec((refusal as CmmsPartsShortfallError).details?.onHand as string, "100");
      expectDec((refusal as CmmsPartsShortfallError).details?.requested as string, "150");
    });
  });

  it("the parts claims accumulate: the SECOND line sees the first's claim (the cumulative floor)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const orderId = await startOrder("WO-COST-D");
      await orders.addLine({
        workOrderId: orderId,
        legType: "PARTS",
        itemId: world.itemId,
        warehouseId: world.warehouseId,
        qty: "80",
        actorId: CM_ACTOR,
      });
      // 80 claimed of 100 — a second 30-claim exceeds the cumulative 110.
      const refusal = await orders
        .addLine({
          workOrderId: orderId,
          legType: "PARTS",
          itemId: world.itemId,
          warehouseId: world.warehouseId,
          qty: "30",
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(CmmsPartsShortfallError);
      expectDec((refusal as CmmsPartsShortfallError).details?.requested as string, "110");
    });
  });

  it("the line removal works while open (the working surface) and refuses after COMPLETION by name", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const orderId = await startOrder("WO-COST-E");
      const line = await orders.addLine({
        workOrderId: orderId,
        legType: "PARTS",
        itemId: world.itemId,
        warehouseId: world.warehouseId,
        qty: "5",
        actorId: CM_ACTOR,
      });
      await orders.removeLine({ workOrderId: orderId, lineId: line.id, actorId: CM_ACTOR });
      const after = await orders.listLines(orderId);
      expect(after).toHaveLength(0);

      // Complete with an external line, then every touch refuses.
      await orders.addLine({
        workOrderId: orderId,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "50",
        description: "Bill",
        actorId: CM_ACTOR,
      });
      await orders.complete({ workOrderId: orderId, actorId: CM_ACTOR });
      const frozen = await orders
        .addLine({
          workOrderId: orderId,
          legType: "EXTERNAL",
          partnerId: world.supplierPartnerId,
          amount: "10",
          description: "Late bill",
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(frozen).toBeInstanceOf(CmmsWorkOrderCompletedError);
    });
  });
});

describe("PHASE-049 W-17 — THE G-59 ACT (T-06 — D-04/D-05, the merged four-conditions ruling)", () => {
  it("D-04's worked example end to end — the fused entry + the WMS issue + the untouched asset", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const orderId = await startOrder("WO-G59-A", "Quarterly service");
      const labor = await orders.addLine({
        workOrderId: orderId,
        legType: "LABOR",
        employeeId: world.technicianEmployeeId,
        hours: "2.5",
        unitRate: "480",
        actorId: CM_ACTOR,
      });
      expectDec(labor.amount, "1200");
      const parts = await orders.addLine({
        workOrderId: orderId,
        legType: "PARTS",
        itemId: world.itemId,
        warehouseId: world.warehouseId,
        qty: "20",
        actorId: CM_ACTOR,
      });
      const external = await orders.addLine({
        workOrderId: orderId,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "500",
        description: "Calibration service",
        actorId: CM_ACTOR,
      });

      const result = await orders.complete({ workOrderId: orderId, solution: "Serviced", actorId: CM_ACTOR });

      // The fused G-59 entry — D-04's exact worked example.
      const lines = await g59Lines(orderId);
      expect(lines).toEqual([
        { direction: "DEBIT", code: "5310", amount: "2500.0000" }, // MAINTENANCE_EXPENSE
        { direction: "CREDIT", code: "1140", amount: "800.0000" }, // INVENTORY (the issue's own value — 0008's template marker)
        { direction: "CREDIT", code: "2138", amount: "1200.0000" }, // LABOR_CLEARING
        { direction: "CREDIT", code: "2137", amount: "500.0000" }, // EXTERNAL_ACCRUAL
      ]);

      // The totals + the stamps (one guarded UPDATE).
      expectDec(result.order.laborTotal, "1200");
      expectDec(result.order.partsTotal, "800");
      expectDec(result.order.externalTotal, "500");
      expect(result.order.journalEntryId).not.toBeNull();

      // INV-034 balanced BY CONSTRUCTION — the fold's witness.
      expect(result.reconciliation.balanced).toBe(true);
      expect(result.reconciliation.sourceTotal).toBe("2500");
      expect(result.reconciliation.difference).toBe("0");

      // G-60's discipline — THE SECOND WITNESS: the stock decremented
      // through the REAL WMS path (100 → 80), the move sourced to the
      // order, the per-line issue stamps landed.
      const tx = requireTenantContext().tx!;
      const stock = await tx.execute<{ qty: string }>(sql`
        SELECT qty::text AS qty FROM item_stock
        WHERE item_id = ${world.itemId} AND warehouse_id = ${world.warehouseId}`);
      expectDec(stock.rows[0]!.qty, "80");
      const moves = await tx.execute<{ source_type: string; qty: string; value_amount: string; posted_journal_id: string }>(sql`
        SELECT source_type, qty::text AS qty, value_amount::text AS value_amount, posted_journal_id
        FROM stock_moves WHERE source_type = 'maintenance_work_order' AND source_id = ${orderId}`);
      expect(moves.rows).toHaveLength(1);
      expect(moves.rows[0]!.qty).toBe("20.000000");
      expect(moves.rows[0]!.value_amount).toBe("800.0000");
      expect(moves.rows[0]!.posted_journal_id).toBe(result.journalEntryId);
      const stampedParts = (await orders.listLines(orderId)).find((line) => line.legType === "PARTS");
      expectDec(stampedParts?.amount, "800");
      expectDec(stampedParts?.issueUnitCost, "40");
      expect(stampedParts?.issuedAt).not.toBeNull();
      void parts;
      void external;

      // THE ASSET IS UNTOUCHED (D-04's own law): cost and accumulated
      // depreciation stand exactly where they were.
      const assetRow = await tx.execute<{ cost: string; opening_accumulated: string; status: string }>(sql`
        SELECT cost::text AS cost, opening_accumulated::text AS opening_accumulated, status
        FROM assets WHERE id = ${result.order.assetId}`);
      expectDec(assetRow.rows[0]!.cost, "100000");
      expectDec(assetRow.rows[0]!.opening_accumulated, "0");

      // The reconciliation fold over the STORED figures (the reports'
      // read): GL 2,500 == labor 1,200 + parts 800 + external 500.
      const stored = reconcileWorkOrderCosts({
        laborTotal: result.order.laborTotal,
        partsTotal: result.order.partsTotal,
        externalTotal: result.order.externalTotal,
        glExpenseDebit: "2500",
      });
      expect(stored.balanced).toBe(true);
    });
  });

  it("BR-098's open-step gate: the refusal carries the open count and the titles", async () => {
    await withTenant(TENANT_CMMS, async () => {
      // A generated world: the plan + its checklist + the carried steps
      // (the plans service's generation — T-07's spec proves the full
      // walk; here the carried rows land directly through the store).
      const asset = await freshAsset("WO-G59-B");
      const created = await orders.create({ assetId: asset, problem: "With checklist", actorId: CM_ACTOR });
      await orders.plan(created.id, CM_ACTOR);
      await orders.start(created.id, CM_ACTOR);
      await orders.addLine({
        workOrderId: created.id,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "100",
        description: "Bill",
        actorId: CM_ACTOR,
      });
      // A carried step (the 0109 substrate — the source task rides the
      // schema spec's plan; here a plan + task + carried step).
      const store = await import("../../modules/fixed_assets/infrastructure/cmms.store");
      const plan = await store.insertPlan({
        assetId: asset,
        name: "Step-gate plan",
        nameAr: null,
        description: null,
        descriptionAr: null,
        triggerType: "CALENDAR",
        intervalDays: 30,
        nextDueDate: "2026-03-01",
        meterId: null,
        thresholdDelta: null,
        lastAnchorValue: null,
        note: null,
        noteAr: null,
        createdBy: CM_ACTOR,
      });
      const task = await store.insertPlanTask({
        planId: plan.id,
        seq: 1,
        title: "Inspect belts",
        titleAr: null,
        instruction: null,
        instructionAr: null,
        createdBy: CM_ACTOR,
      });
      await store.insertOrderSteps([
        {
          workOrderId: created.id,
          sourceTaskId: task.id,
          seq: 1,
          title: "Inspect belts",
          titleAr: null,
          instruction: null,
          instructionAr: null,
          createdBy: CM_ACTOR,
        },
      ]);

      const refusal = await orders
        .complete({ workOrderId: created.id, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(CmmsStepsOpenError);
      expect((refusal as CmmsStepsOpenError).code).toBe("WORK_ORDER_STEPS_OPEN");
      expect((refusal as CmmsStepsOpenError).details).toMatchObject({
        openCount: 1,
        openSteps: [{ seq: 1, title: "Inspect belts" }],
      });

      // Record the result — the gate opens, the completion stands.
      const steps = await orders.listSteps(created.id);
      await orders.recordStep({
        workOrderId: created.id,
        stepId: steps[0]!.id,
        result: "PASS",
        actorId: CM_ACTOR,
      });
      const done = await orders.complete({ workOrderId: created.id, actorId: CM_ACTOR });
      expect(done.order.status).toBe("COMPLETED");
    });
  });

  it("the zero-total law: a costless completion refuses BY NAME (the fused machine's own consequence)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const orderId = await startOrder("WO-G59-C", "Visual inspection only");
      const refusal = await orders
        .complete({ workOrderId: orderId, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(CmmsWorkOrderZeroTotalError);
      expect((refusal as CmmsWorkOrderZeroTotalError).code).toBe("WORK_ORDER_ZERO_TOTAL");
    });
  });

  it("THE ALL-OR-NOTHING ARM (the ruling's second condition): a posting failure rolls the WHOLE act back — zero residue", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const orderId = await startOrder("WO-G59-D", "The rollback arm");
      await orders.addLine({
        workOrderId: orderId,
        legType: "LABOR",
        employeeId: world.technicianEmployeeId,
        hours: "1",
        unitRate: "100",
        actorId: CM_ACTOR,
      });
      await orders.addLine({
        workOrderId: orderId,
        legType: "PARTS",
        itemId: world.itemId,
        warehouseId: world.warehouseId,
        qty: "10",
        actorId: CM_ACTOR,
      });

      // Unmap MAINTENANCE_EXPENSE (the tenant's own runtime surface —
      // supersede the standing mapping; the engine refuses fail-closed
      // PURPOSE_NOT_MAPPED — the 038/0077 discipline).
      const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
      const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
      const active = await tenancy.findActivePurpose("MAINTENANCE_EXPENSE");
      expect(active).toBeDefined();
      await accounting.supersedePurpose(active!.id, active!.activeFrom);

      const stockBefore = await requireTenantContext().tx!.execute<{ qty: string }>(sql`
        SELECT qty::text AS qty FROM item_stock
        WHERE item_id = ${world.itemId} AND warehouse_id = ${world.warehouseId}`);

      const refusal = await orders
        .complete({ workOrderId: orderId, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect((refusal as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");

      // ZERO RESIDUE: the order still IN_PROGRESS, the stock intact, no
      // journal rows, no issue stamps — together-or-nothing.
      const after = await orders.get(orderId);
      expect(after.status).toBe("IN_PROGRESS");
      expect(after.completedAt).toBeNull();
      expect(after.journalEntryId).toBeNull();
      const stockAfter = await requireTenantContext().tx!.execute<{ qty: string }>(sql`
        SELECT qty::text AS qty FROM item_stock
        WHERE item_id = ${world.itemId} AND warehouse_id = ${world.warehouseId}`);
      expect(stockAfter.rows[0]!.qty).toBe(stockBefore.rows[0]!.qty);
      const journals = await requireTenantContext().tx!.execute<{ n: string }>(sql`
        SELECT COUNT(*)::text AS n FROM journal_entries
        WHERE source_type = 'maintenance_work_order' AND source_id = ${orderId}`);
      expect(journals.rows[0]!.n).toBe("0");
      const moves = await requireTenantContext().tx!.execute<{ n: string }>(sql`
        SELECT COUNT(*)::text AS n FROM stock_moves
        WHERE source_type = 'maintenance_work_order' AND source_id = ${orderId}`);
      expect(moves.rows[0]!.n).toBe("0");

      // Re-map the purpose — the SAME order now completes cleanly (the
      // tenant's own runtime repair path; the act is retryable).
      await tenancy.insertAccountPurpose({
        purposeKey: "MAINTENANCE_EXPENSE",
        accountId: active!.accountId,
        activeFrom: new Date().toISOString().slice(0, 10),
      });
      const done = await orders.complete({ workOrderId: orderId, actorId: CM_ACTOR });
      expect(done.order.status).toBe("COMPLETED");
      expect(done.reconciliation.balanced).toBe(true);
    });
  });

  it("the replay is the typed refusal (the single-use stamp; INV-013's document-side twin)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const orderId = await startOrder("WO-G59-E", "The replay arm");
      await orders.addLine({
        workOrderId: orderId,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "75",
        description: "Bill",
        actorId: CM_ACTOR,
      });
      const first = await orders.complete({ workOrderId: orderId, actorId: CM_ACTOR });
      expect(first.order.status).toBe("COMPLETED");

      const replay = await orders
        .complete({ workOrderId: orderId, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(replay).toBeInstanceOf(CmmsWorkOrderCompletedError);
      // EXACTLY ONE entry stands (INV-013's source key).
      const entries = await requireTenantContext().tx!.execute<{ n: string }>(sql`
        SELECT COUNT(*)::text AS n FROM journal_entries
        WHERE source_type = 'maintenance_work_order' AND source_id = ${orderId}`);
      expect(entries.rows[0]!.n).toBe("1");
    });
  });
});
