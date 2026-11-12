import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as mfgStore from "../../modules/manufacturing/infrastructure/manufacturing.store";
import { ReworkCostZeroError, ReworkOrderStateError } from "../../modules/manufacturing/domain/manufacturing-errors";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  orders,
  rework,
  routingsSrv,
  setupMfgFixture,
  workCenters,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-042 T-15 (M-14/BR-069) — the rework evidence: create validates the
 * COMPLETED parent, release reserves the RW- number + freezes the aggregate
 * standard, completion posts G-41 EXACTLY (DR REWORK_EXPENSE · CR
 * PRODUCTION_LABOR · CR PRODUCTION_OVERHEAD — never a parent-order leg),
 * BR-069 (the parent's value columns byte-identical before/after), the
 * zero-cost floor, the zero-effect cancel, and the INV-013 replay.
 *
 * Spec-owned item (M-RWK) + its own one-op routing — never the §8 chain.
 */

let fixture: MfgFixture;
let specItemId = "";
let completedParentId = "";
let reworkRoutingId = "";

beforeAll(async () => {
  fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const found = await itemsStore.findItemBySku("M-RWK");
    specItemId =
      found?.id ??
      (
        await itemsStore.insertItem({
          sku: "M-RWK",
          name: "Rework spec item (rework-costing)",
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

    if ((await mfgStore.findActiveBom(specItemId)) === undefined) {
      const draft = await boms.create({
        itemId: specItemId,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: "M-RWK v1 (rework spec)",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: fixture.items.flour, qtyPerOutput: "0.010000", scrapPct: "0" }],
      });
      await boms.activate(draft.id, { effectiveFrom: "2026-01-05", actorId: M_ACTOR });
    }

    // The rework routing: one op, rate overrides (fixed 10 / var 30) — the
    // aggregate freeze over qty 4: setup 1h + run 0.5h×4 = 3h at 30/10.
    const centers = await workCenters.list({ limit: 50 });
    const center =
      centers.find((row) => row.code === "M-RWK-CNV") ??
      (await workCenters.create({
        code: "M-RWK-CNV",
        name: "Rework spec conversion center",
        nameAr: null,
        description: null,
        capacityPerShift: "8",
        shiftsPerDay: 1,
        fixedCostRate: "0",
        varCostRate: "0",
        costCenterId: null,
        actorId: M_ACTOR,
      }));
    const routings = await routingsSrv.list({ itemId: specItemId, limit: 10 });
    const existing = routings.find((row) => row.note === "M-RWK rework routing v1");
    if (existing === undefined) {
      const draft = await routingsSrv.createDraft({
        itemId: specItemId,
        outputUomId: pcs.id,
        note: "M-RWK rework routing v1",
        noteAr: null,
        actorId: M_ACTOR,
        operations: [
          {
            sequence: 10,
            workCenterId: center.id,
            setupTime: "1.000000",
            runTime: "0.500000",
            fixedCostRate: "10.000000",
            varCostRate: "30.000000",
            description: "Rework step",
            descriptionAr: null,
          },
        ],
      });
      reworkRoutingId = draft.id; // DRAFT binds fine (the BOM precedent)
    } else {
      reworkRoutingId = existing.id;
    }

    // The COMPLETED parent order (routing-less — the flat dual mode; ops are
    // this spec's routing, the order itself is the plain legacy shape).
    const parent = await orders.create({
      branchId: fixture.branchId,
      itemId: specItemId,
      bomId: null,
      plannedQty: "100",
      plannedDate: null,
      materialsWarehouseId: fixture.warehouseRaw,
      fgWarehouseId: fixture.warehouseFg,
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: "rework spec parent order",
      noteAr: null,
      actorId: M_ACTOR,
    });
    await orders.release(parent.id, M_ACTOR, { routingId: null });
    await orders.start(parent.id, M_ACTOR);
    await orders.consume(parent.id, {
      lines: [{ itemId: fixture.items.flour, qty: "1", batchId: null }],
      consumedAt: "2026-05-02",
      note: "rework spec parent consumption",
      noteAr: null,
      actorId: M_ACTOR,
    });
    const done = await orders.complete(parent.id, {
      actualQty: "100",
      batchNo: null,
      completedAt: "2026-05-03",
      actorId: M_ACTOR,
    });
    completedParentId = done.order.id;
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

/** The default rework order over the completed parent (released + started). */
async function startedRework(routingId: string | null = reworkRoutingId) {
  const created = await withTenant(TENANT_M, () =>
    rework.create({
      parentOrderId: completedParentId,
      batchId: null,
      defectRef: "DEF-RWK-001",
      qty: "4",
      routingId,
      defectReasonCode: "COSMETIC",
      note: "rework spec order",
      noteAr: null,
      actorId: M_ACTOR,
    }),
  );
  await withTenant(TENANT_M, () => rework.release(created.id, M_ACTOR));
  await withTenant(TENANT_M, () => rework.start(created.id, M_ACTOR));
  return created.id;
}

// -- the packs --------------------------------------------------------------------

describe("PHASE-042 · rework orders (RW- numbering, G-41, BR-069)", () => {
  it("create validates the parent — a live (IN_PROGRESS) parent is the typed REWORK_ORDER_STATE", async () => {
    const liveParent = await withTenant(TENANT_M, () =>
      orders.create({
        branchId: fixture.branchId,
        itemId: specItemId,
        bomId: null,
        plannedQty: "10",
        plannedDate: null,
        materialsWarehouseId: fixture.warehouseRaw,
        fgWarehouseId: fixture.warehouseFg,
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "rework spec live parent",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    await withTenant(TENANT_M, () => orders.release(liveParent.id, M_ACTOR, { routingId: null }));
    await withTenant(TENANT_M, () => orders.start(liveParent.id, M_ACTOR));
    await expect(
      withTenant(TENANT_M, () =>
        rework.create({
          parentOrderId: liveParent.id,
          batchId: null,
          defectRef: "DEF-EARLY",
          qty: "1",
          routingId: null,
          defectReasonCode: null,
          note: null,
          noteAr: null,
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(ReworkOrderStateError);
  });

  it("release reserves the RW- number and freezes the routing aggregate (setup Σ + run×qty, the blended rates)", async () => {
    const created = await withTenant(TENANT_M, () =>
      rework.create({
        parentOrderId: completedParentId,
        batchId: null,
        defectRef: "DEF-RWK-002",
        qty: "4",
        routingId: reworkRoutingId,
        defectReasonCode: null,
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    expect(created.status).toBe("DRAFT");
    expect(created.reworkNo).toBeNull(); // NO number before release
    const released = await withTenant(TENANT_M, () => rework.release(created.id, M_ACTOR));
    expect(released.status).toBe("RELEASED");
    expect(released.reworkNo).toMatch(/^RW-\d{4}-\d{5}$/);
    // The aggregate freeze: std_setup = Σ setup = 1; std_run = run × qty =
    // 0.5 × 4 = 2; single-op blend keeps the op's overridden rates.
    expect(released.stdSetupTime).toBe("1.000000");
    expect(released.stdRunTime).toBe("2.000000");
    expect(released.stdFixedRate).toBe("10.000000");
    expect(released.stdVarRate).toBe("30.000000");
  });

  it("complete posts G-41 EXACTLY (DR REWORK_EXPENSE · CR PRODUCTION_LABOR · CR PRODUCTION_OVERHEAD) — no parent-order leg", async () => {
    const id = await startedRework();
    const result = await withTenant(TENANT_M, () =>
      rework.complete(id, { actualSetupTime: "1", actualRunTime: "2", actorId: M_ACTOR }),
    );
    // Conversion 3h × (var 30 / fixed 10): labor 90.0000, overhead 30.0000,
    // rework value their typed sum 120.0000.
    expect(result.rework.reworkValue).toBe("120.0000");
    expect(result.rework.laborValue).toBe("90.0000");
    expect(result.rework.overheadValue).toBe("30.0000");
    expect(await withTenant(TENANT_M, () => journalLinesOf(result.journalEntryId))).toEqual([
      { accountId: fixture.gl.reworkExpense, direction: "DEBIT", amount: "120.0000" },
      { accountId: fixture.gl.productionLabor, direction: "CREDIT", amount: "90.0000" },
      { accountId: fixture.gl.productionOverhead, direction: "CREDIT", amount: "30.0000" },
    ]);
    const bySource = await withTenant(TENANT_M, () =>
      journal.findEntryBySourceKey("rework_order", id, "complete"),
    );
    expect(bySource!.id).toBe(result.journalEntryId);
  });

  it("BR-069 — the parent order's fg/wip/labor/overhead value columns are byte-identical before and after the rework completion", async () => {
    const before = await withTenant(TENANT_M, () => orders.find(completedParentId));
    const id = await startedRework();
    await withTenant(TENANT_M, () =>
      rework.complete(id, { actualSetupTime: "2", actualRunTime: "1", actorId: M_ACTOR }),
    );
    const after = await withTenant(TENANT_M, () => orders.find(completedParentId));
    expect(after.fgValue).toBe(before.fgValue);
    expect(after.wipCreditValue).toBe(before.wipCreditValue);
    expect(after.laborValue).toBe(before.laborValue);
    expect(after.overheadValue).toBe(before.overheadValue);
    // The columns are exactly the pre-rework completion values (pinned, not
    // just equal-to-whatever-they-were): the parent consumed 1 flour @ 10.
    expect(after.fgValue).toBe("10.0000");
    expect(after.wipCreditValue).toBe("10.0000");
    expect(after.laborValue).toBe("0.0000");
    expect(after.overheadValue).toBe("0.0000");
  });

  it("a zero-conversion completion is the typed REWORK_COST_ZERO (a rework that cost nothing did not happen)", async () => {
    const id = await startedRework(null); // no routing → the zero freeze
    await expect(
      withTenant(TENANT_M, () =>
        rework.complete(id, { actualSetupTime: "0", actualRunTime: "0", actorId: M_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(ReworkCostZeroError);
  });

  it("cancel from IN_PROGRESS is pure state — zero journal rows under the rework source", async () => {
    const id = await startedRework();
    const cancelled = await withTenant(TENANT_M, () =>
      rework.cancel(id, { reason: "defect reclassified", actorId: M_ACTOR }),
    );
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelReason).toBe("defect reclassified");
    const bySource = await withTenant(TENANT_M, () =>
      journal.findEntryBySourceKey("rework_order", id, "complete"),
    );
    expect(bySource).toBeUndefined();
  });

  it("INV-013 — completing a COMPLETED rework replays the stored result (ONE journal, stable values)", async () => {
    const id = await startedRework();
    const first = await withTenant(TENANT_M, () =>
      rework.complete(id, { actualSetupTime: "1", actualRunTime: "2", actorId: M_ACTOR }),
    );
    const second = await withTenant(TENANT_M, () =>
      rework.complete(id, { actualSetupTime: "7", actualRunTime: "7", actorId: M_ACTOR }),
    );
    expect(second.journalEntryId).toBe(first.journalEntryId);
    expect(second.rework.reworkValue).toBe(first.rework.reworkValue);
    expect(second.rework.actualSetupTime).toBe(first.rework.actualSetupTime);
    const count = await withTenant(TENANT_M, async () => {
      const { sql } = await import("drizzle-orm");
      const { requireTenantContext } = await import("../../infra/db/tenant-context");
      const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM journal_entries
        WHERE source_type = 'rework_order' AND source_id = ${id}`);
      return rows.rows[0]!.n;
    });
    expect(count).toBe(1);
  });
});
