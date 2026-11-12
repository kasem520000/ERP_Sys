import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as mfgStore from "../../modules/manufacturing/infrastructure/manufacturing.store";
import {
  ApproverNotFoundError,
  OperationScrapReasonRequiredError,
  OperationSequenceError,
  OperationStateError,
  SelfApprovalBlockedError,
} from "../../modules/manufacturing/domain/manufacturing-errors";
import {
  M_ACTOR,
  M_QC,
  TENANT_M,
  boms,
  mfgAppClient,
  orders,
  routingsSrv,
  setupMfgFixture,
  shopFloor,
  workCenters,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-042 T-15 (M-02/M-17/M-18/M-13) — the routing-execution evidence:
 * the release-time freeze (routing times + work-center rates, per-op rate
 * overrides winning), the INV-028 sequence gate, the G-40 operation
 * completion posting (exact journal lines + the frozen variance columns),
 * the INV-013 idempotent replay (ONE journal per `op_<seq>`), the skip SoD
 * (reason + a distinct approver — the BR-034 house pattern), the
 * current_operation cursor, the routing-less dual mode, pause/resume, and
 * the statistical-scrap reason floor (the typed service guard + the
 * ck_production_order_operations_scrap CHECK floor via a raw insert).
 *
 * Shared-suite discipline (the orders.spec rule): SPEC-OWNED item (M-RTG),
 * work centers (M-RTG-MIX / M-RTG-ZERO) and routings — never the §8 golden
 * chain. G-40 posts land at today (an OPEN month of FY2026 — December stays
 * reserved for the PERIOD_LOCKED packs).
 */

let fixture: MfgFixture;
let specItemId = "";
let mixCenterId = "";
let zeroCenterId = "";
let routingId = "";

/** A two-operation routing on the spec item: op 10 inherits the MIX center
 * rates (fixed 15 / var 25), op 20 overrides (fixed 10 / var 30). */
const OP_10 = { setupTime: "0.500000", runTime: "0.100000" } as const;
const OP_20 = { setupTime: "1.000000", runTime: "0.200000" } as const;

beforeAll(async () => {
  fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const found = await itemsStore.findItemBySku("M-RTG");
    specItemId =
      found?.id ??
      (
        await itemsStore.insertItem({
          sku: "M-RTG",
          name: "Routed spec item (routing-execution)",
          nameAr: null,
          kind: "STOCK",
          uomId: pcs.id,
          categoryId: null,
          taxCodeId: null,
          costingMethod: "WAC",
          trackBatch: true,
          trackSerial: false,
          trackImei: false,
          hasExpiry: true,
          shelfLifeDays: 30,
          reorderLevel: null,
          reorderQty: null,
          basePrice: null,
        })
      ).id;

    // The clean recipe (the orders.spec shape): flour 0.1 per output, yield
    // 100 — release plans 10 per 100 planned; nothing is consumed here (the
    // operations run on RELEASED/IN_PROGRESS orders, completion of the
    // ORDER belongs to the standard-costing spec).
    if ((await mfgStore.findActiveBom(specItemId)) === undefined) {
      const draft = await boms.create({
        itemId: specItemId,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: "M-RTG v1 (routing-execution spec)",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: fixture.items.flour, qtyPerOutput: "0.100000", scrapPct: "0" }],
      });
      await boms.activate(draft.id, { effectiveFrom: "2026-01-05", actorId: M_ACTOR });
    }

    const existingCenters = await workCenters.list({ limit: 50 });
    mixCenterId =
      existingCenters.find((center) => center.code === "M-RTG-MIX")?.id ??
      (
        await workCenters.create({
          code: "M-RTG-MIX",
          name: "Routing-execution mixer",
          nameAr: "خلاط تنفيذ المسار",
          description: null,
          capacityPerShift: "8",
          shiftsPerDay: 2,
          fixedCostRate: "15.000000",
          varCostRate: "25.000000",
          costCenterId: null,
          actorId: M_ACTOR,
        })
      ).id;
    zeroCenterId =
      existingCenters.find((center) => center.code === "M-RTG-ZERO")?.id ??
      (
        await workCenters.create({
          code: "M-RTG-ZERO",
          name: "Routing-execution uncosted center",
          nameAr: null,
          description: null,
          capacityPerShift: "8",
          shiftsPerDay: 1,
          fixedCostRate: "0",
          varCostRate: "0",
          costCenterId: null,
          actorId: M_ACTOR,
        })
      ).id;

    const existingRouting = await mfgStore.findActiveRouting(specItemId);
    if (existingRouting === undefined) {
      const draft = await routingsSrv.createDraft({
        itemId: specItemId,
        outputUomId: pcs.id,
        note: "M-RTG routing v1 (two ops)",
        noteAr: null,
        actorId: M_ACTOR,
        operations: [
          {
            sequence: 10,
            workCenterId: mixCenterId,
            setupTime: OP_10.setupTime,
            runTime: OP_10.runTime,
            fixedCostRate: null,
            varCostRate: null,
            description: "Mix (inherits center rates)",
            descriptionAr: null,
          },
          {
            sequence: 20,
            workCenterId: mixCenterId,
            setupTime: OP_20.setupTime,
            runTime: OP_20.runTime,
            fixedCostRate: "10.000000",
            varCostRate: "30.000000",
            description: "Bake (rate overrides)",
            descriptionAr: null,
          },
        ],
      });
      routingId = (await routingsSrv.activate(draft.id, { actorId: M_ACTOR })).id;
    } else {
      routingId = existingRouting.id;
    }
  });
});

// -- helpers ---------------------------------------------------------------------

interface Line {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<Line[]> {
  const lines = await withTenant(TENANT_M, () => journal.listLines(entryId));
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

function createSpecOrder(plannedQty = "100") {
  return withTenant(TENANT_M, () =>
    orders.create({
      branchId: fixture.branchId,
      itemId: specItemId,
      bomId: null,
      plannedQty,
      plannedDate: null,
      materialsWarehouseId: fixture.warehouseRaw,
      fgWarehouseId: fixture.warehouseFg,
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: "routing-execution spec order",
      noteAr: null,
      actorId: M_ACTOR,
    }),
  );
}

/** A released + started order auto-bound to the spec item's ACTIVE routing. */
async function releasedStartedOrder() {
  const order = await createSpecOrder();
  await withTenant(TENANT_M, () => orders.release(order.id, M_ACTOR));
  await withTenant(TENANT_M, () => orders.start(order.id, M_ACTOR));
  return order.id;
}

// -- the packs --------------------------------------------------------------------

describe("PHASE-042 · routing execution (freeze, sequence gate, G-40, skip SoD)", () => {
  it("release with an explicit routingId freezes one PENDING op row per routing operation — routing times, center rates, and the op-level overrides win", async () => {
    const order = await createSpecOrder();
    const released = await withTenant(TENANT_M, () =>
      orders.release(order.id, M_ACTOR, { routingId }),
    );
    expect(released.routingId).toBe(routingId);
    expect(released.currentOperation).toBeNull();
    expect(released.stdUnitCost).toBeNull(); // no ACTIVE standard — the dual mode

    const operations = await withTenant(TENANT_M, () =>
      mfgStore.listProductionOrderOperations(order.id),
    );
    expect(operations).toHaveLength(2);
    const [op10, op20] = operations;
    expect(op10!.status).toBe("PENDING");
    expect(op10!.workCenterId).toBe(mixCenterId);
    expect(op10!.stdSetupTime).toBe("0.500000");
    expect(op10!.stdRunTime).toBe("0.100000");
    // No overrides → the MIX center's rates (fixed 15 / var 25).
    expect(op10!.stdFixedRate).toBe("15.000000");
    expect(op10!.stdVarRate).toBe("25.000000");
    // Op 20 overrides win over the center rates.
    expect(op20!.stdSetupTime).toBe("1.000000");
    expect(op20!.stdRunTime).toBe("0.200000");
    expect(op20!.stdFixedRate).toBe("10.000000");
    expect(op20!.stdVarRate).toBe("30.000000");
  });

  it("INV-028 — starting op 20 while op 10 is PENDING is the typed OperationSequenceError", async () => {
    const orderId = await releasedStartedOrder();
    await expect(withTenant(TENANT_M, () => shopFloor.startOp(orderId, 20, M_ACTOR))).rejects.toBeInstanceOf(
      OperationSequenceError,
    );
    await expect(withTenant(TENANT_M, () => shopFloor.startOp(orderId, 20, M_ACTOR))).rejects.toMatchObject({
      code: "OPERATION_SEQUENCE",
      details: { blockedBy: 10, blockedByStatus: "PENDING" },
    });
  });

  it("completeOp posts G-40 EXACTLY (DR WIP = conversion total · CR LABOR = var-rate leg · CR OVERHEAD = fixed-rate leg) and stamps the frozen variances", async () => {
    const orderId = await releasedStartedOrder();
    await withTenant(TENANT_M, () => shopFloor.startOp(orderId, 10, M_ACTOR));
    const result = await withTenant(TENANT_M, () =>
      shopFloor.completeOp(orderId, 10, {
        actualSetupTime: "1",
        actualRunTime: "2",
        scrapQty: null,
        scrapReasonCode: null,
        actorId: M_ACTOR,
      }),
    );
    expect(result.journalEntryId).not.toBeNull();
    // Conversion 3h × (var 25 / fixed 15): labor 75.0000, overhead 45.0000,
    // the WIP debit their typed sum 120.0000.
    expect(await withTenant(TENANT_M, () => journalLinesOf(result.journalEntryId!))).toEqual([
      { accountId: fixture.gl.wip, direction: "DEBIT", amount: "120.0000" },
      { accountId: fixture.gl.productionLabor, direction: "CREDIT", amount: "75.0000" },
      { accountId: fixture.gl.productionOverhead, direction: "CREDIT", amount: "45.0000" },
    ]);
    const op = await withTenant(TENANT_M, () => mfgStore.findProductionOrderOperation(orderId, 10));
    expect(op!.status).toBe("COMPLETED");
    expect(op!.actualSetupTime).toBe("1.000000");
    expect(op!.actualRunTime).toBe("2.000000");
    // setup_variance = (1 − 0.5) × (15 + 25) = 20.0000;
    // usage_variance = (2 − 0.1 × 100) × 25 = −200.0000 (the running
    // actualQty is 0, so the basis is plannedQty 100);
    // rate_variance = 0 in v1.
    expect(op!.setupVariance).toBe("20.0000");
    expect(op!.usageVariance).toBe("-200.0000");
    expect(op!.rateVariance).toBe("0.0000");
    expect(op!.journalId).toBe(result.journalEntryId);
  });

  it("INV-013 — completing an op twice returns the stored row with ONE journal (operation op_10) and stable values", async () => {
    const orderId = await releasedStartedOrder();
    await withTenant(TENANT_M, () => shopFloor.startOp(orderId, 10, M_ACTOR));
    const first = await withTenant(TENANT_M, () =>
      shopFloor.completeOp(orderId, 10, {
        actualSetupTime: "1",
        actualRunTime: "2",
        scrapQty: null,
        scrapReasonCode: null,
        actorId: M_ACTOR,
      }),
    );
    const second = await withTenant(TENANT_M, () =>
      shopFloor.completeOp(orderId, 10, {
        actualSetupTime: "9",
        actualRunTime: "9",
        scrapQty: null,
        scrapReasonCode: null,
        actorId: M_ACTOR,
      }),
    );
    expect(second.journalEntryId).toBe(first.journalEntryId);
    expect(second.operation.actualSetupTime).toBe(first.operation.actualSetupTime);
    expect(second.operation.actualRunTime).toBe(first.operation.actualRunTime);
    // Exactly ONE journal under the (production_order, order, op_10) key.
    const bySource = await withTenant(TENANT_M, () =>
      journal.findEntryBySourceKey("production_order", orderId, "op_10"),
    );
    expect(bySource!.id).toBe(first.journalEntryId);
    const rows = await withTenant(TENANT_M, async () => {
      const { sql } = await import("drizzle-orm");
      const { requireTenantContext } = await import("../../infra/db/tenant-context");
      const result = await requireTenantContext().tx!.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM journal_entries
        WHERE source_type = 'production_order' AND source_id = ${orderId} AND operation = 'op_10'`);
      return result.rows[0]!.n;
    });
    expect(rows).toBe(1);
  });

  it("skip SoD — a reason is required, the approver must be a distinct ACTIVE user (same-user → SelfApprovalBlockedError), and the skip unblocks the next op", async () => {
    const orderId = await releasedStartedOrder();
    // Missing reason.
    await expect(
      withTenant(TENANT_M, () =>
        shopFloor.skipOp(orderId, 10, { reason: "   ", approvedBy: M_QC, actorId: M_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "OPERATION_STATE" });
    // Self-approval (BR-034 house pattern).
    await expect(
      withTenant(TENANT_M, () =>
        shopFloor.skipOp(orderId, 10, { reason: "not needed", approvedBy: M_ACTOR, actorId: M_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(SelfApprovalBlockedError);
    // Unknown approver.
    await expect(
      withTenant(TENANT_M, () =>
        shopFloor.skipOp(orderId, 10, {
          reason: "not needed",
          approvedBy: "11111111-1111-1111-1111-111111111111",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ApproverNotFoundError);
    // The legal skip: a distinct ACTIVE approver, op 10 still PENDING.
    const skipped = await withTenant(TENANT_M, () =>
      shopFloor.skipOp(orderId, 10, { reason: "outsourced this step", approvedBy: M_QC, actorId: M_ACTOR }),
    );
    expect(skipped.status).toBe("SKIPPED");
    expect(skipped.skipReason).toBe("outsourced this step");
    expect(skipped.skipApprovedBy).toBe(M_QC);
    // SKIPPED satisfies the sequence gate: op 20 starts.
    const started = await withTenant(TENANT_M, () => shopFloor.startOp(orderId, 20, M_ACTOR));
    expect(started.status).toBe("RUNNING");
  });

  it("current_operation advances to the next sequence and stays at the last sequence when the routing is done", async () => {
    const orderId = await releasedStartedOrder();
    await withTenant(TENANT_M, () => shopFloor.startOp(orderId, 10, M_ACTOR));
    let order = await withTenant(TENANT_M, () => orders.find(orderId));
    expect(order.currentOperation).toBe(10);
    await withTenant(TENANT_M, () =>
      shopFloor.completeOp(orderId, 10, {
        actualSetupTime: "0",
        actualRunTime: "1",
        scrapQty: null,
        scrapReasonCode: null,
        actorId: M_ACTOR,
      }),
    );
    order = await withTenant(TENANT_M, () => orders.find(orderId));
    expect(order.currentOperation).toBe(20);
    await withTenant(TENANT_M, () => shopFloor.startOp(orderId, 20, M_ACTOR));
    await withTenant(TENANT_M, () =>
      shopFloor.completeOp(orderId, 20, {
        actualSetupTime: "0",
        actualRunTime: "1",
        scrapQty: null,
        scrapReasonCode: null,
        actorId: M_ACTOR,
      }),
    );
    order = await withTenant(TENANT_M, () => orders.find(orderId));
    // No non-terminal operation remains → the cursor stays at the last one.
    expect(order.currentOperation).toBe(20);
  });

  it("routing-less release (routingId: null on an item WITH an ACTIVE routing) keeps the legacy shape — no op rows, stdUnitCost NULL", async () => {
    const order = await createSpecOrder();
    const released = await withTenant(TENANT_M, () =>
      orders.release(order.id, M_ACTOR, { routingId: null }),
    );
    expect(released.routingId).toBeNull();
    expect(released.currentOperation).toBeNull();
    expect(released.stdUnitCost).toBeNull();
    const operations = await withTenant(TENANT_M, () =>
      mfgStore.listProductionOrderOperations(order.id),
    );
    expect(operations).toHaveLength(0);
  });

  it("pause/resume — RUNNING pauses, PAUSED resumes, replays are no-ops, and pausing a PENDING op is the typed state error", async () => {
    const orderId = await releasedStartedOrder();
    await withTenant(TENANT_M, () => shopFloor.startOp(orderId, 10, M_ACTOR));
    const paused = await withTenant(TENANT_M, () => shopFloor.pauseOp(orderId, 10, M_ACTOR));
    expect(paused.status).toBe("PAUSED");
    // Idempotent pause replay.
    const pausedAgain = await withTenant(TENANT_M, () => shopFloor.pauseOp(orderId, 10, M_ACTOR));
    expect(pausedAgain.status).toBe("PAUSED");
    const resumed = await withTenant(TENANT_M, () => shopFloor.resumeOp(orderId, 10, M_ACTOR));
    expect(resumed.status).toBe("RUNNING");
    // Resume-on-RUNNING is the idempotent no-op.
    const resumedAgain = await withTenant(TENANT_M, () => shopFloor.resumeOp(orderId, 10, M_ACTOR));
    expect(resumedAgain.status).toBe("RUNNING");
    // Pausing a PENDING op (op 20) is the typed error.
    await expect(withTenant(TENANT_M, () => shopFloor.pauseOp(orderId, 20, M_ACTOR))).rejects.toBeInstanceOf(
      OperationStateError,
    );
    // Completing a PENDING op (op 20) is the typed error too.
    await expect(
      withTenant(TENANT_M, () =>
        shopFloor.completeOp(orderId, 20, {
          actualSetupTime: "0",
          actualRunTime: "0",
          scrapQty: null,
          scrapReasonCode: null,
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(OperationStateError);
  });

  it("statistical scrap — qty > 0 without a reason is the typed OperationScrapReasonRequiredError (with a reason it lands on the row)", async () => {
    const orderId = await releasedStartedOrder();
    await withTenant(TENANT_M, () => shopFloor.startOp(orderId, 10, M_ACTOR));
    await expect(
      withTenant(TENANT_M, () =>
        shopFloor.completeOp(orderId, 10, {
          actualSetupTime: "0",
          actualRunTime: "1",
          scrapQty: "5",
          scrapReasonCode: null,
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(OperationScrapReasonRequiredError);
    const done = await withTenant(TENANT_M, () =>
      shopFloor.completeOp(orderId, 10, {
        actualSetupTime: "0",
        actualRunTime: "1",
        scrapQty: "5",
        scrapReasonCode: "CRACKED",
        actorId: M_ACTOR,
      }),
    );
    expect(done.operation.scrapQty).toBe("5.000000");
    expect(done.operation.scrapReasonCode).toBe("CRACKED");
  });

  it("the ck_production_order_operations_scrap CHECK floor — a raw insert of scrap without a reason is 23514", async () => {
    const orderId = await releasedStartedOrder();
    const client = await mfgAppClient();
    let code = "";
    try {
      await client.query(
        `INSERT INTO production_order_operations
           (id, tenant_id, order_id, routing_id, sequence, work_center_id, status,
            std_setup_time, std_run_time, std_fixed_rate, std_var_rate, scrap_qty, scrap_reason_code)
         VALUES (gen_random_uuid(), erp.current_tenant_id(), $1, $2, 30, $3, 'PENDING',
                 0, 0, 0, 0, 5, NULL)`,
        [orderId, routingId, mixCenterId],
      );
    } catch (error) {
      code = (error as { code?: string }).code ?? "";
    }
    await client.end();
    expect(code).toBe("23514");
  });

  it("an entirely uncosted operation (both rates 0) records its times WITHOUT a journal", async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await withTenant(TENANT_M, () => itemsStore.listUoms());
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    // A one-op routing on the uncosted center, explicit-bound.
    const draft = await withTenant(TENANT_M, () =>
      routingsSrv.createDraft({
        itemId: specItemId,
        outputUomId: pcs.id,
        note: "M-RTG zero-rate routing",
        noteAr: null,
        actorId: M_ACTOR,
        operations: [
          {
            sequence: 10,
            workCenterId: zeroCenterId,
            setupTime: "1.000000",
            runTime: "1.000000",
            fixedCostRate: null,
            varCostRate: null,
            description: "Uncosted step",
            descriptionAr: null,
          },
        ],
      }),
    );
    const order = await createSpecOrder("10");
    await withTenant(TENANT_M, () => orders.release(order.id, M_ACTOR, { routingId: draft.id }));
    await withTenant(TENANT_M, () => orders.start(order.id, M_ACTOR));
    await withTenant(TENANT_M, () => shopFloor.startOp(order.id, 10, M_ACTOR));
    const result = await withTenant(TENANT_M, () =>
      shopFloor.completeOp(order.id, 10, {
        actualSetupTime: "2",
        actualRunTime: "3",
        scrapQty: null,
        scrapReasonCode: null,
        actorId: M_ACTOR,
      }),
    );
    expect(result.journalEntryId).toBeNull();
    expect(result.operation.status).toBe("COMPLETED");
    expect(result.operation.actualSetupTime).toBe("2.000000");
    expect(result.operation.actualRunTime).toBe("3.000000");
    const bySource = await withTenant(TENANT_M, () =>
      journal.findEntryBySourceKey("production_order", order.id, "op_10"),
    );
    expect(bySource).toBeUndefined();
  });
});
