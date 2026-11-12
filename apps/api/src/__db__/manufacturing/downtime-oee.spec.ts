import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TENANT_A, appClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as mfgStore from "../../modules/manufacturing/infrastructure/manufacturing.store";
import {
  DowntimeAlreadyClosedError,
  DowntimeInputInvalidError,
} from "../../modules/manufacturing/domain/manufacturing-errors";
import {
  M_ACTOR,
  M_QC,
  TENANT_M,
  boms,
  clearMfgSetting,
  downtime,
  mfgAppClient,
  orders,
  routingsSrv,
  setMfgSetting,
  setupMfgFixture,
  shopFloor,
  workCenters,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-042 T-15 (M-15/M-16/BR-070) — the downtime + OEE evidence: the open
 * log shape (ended/cost/journal NULL), the default record-only close
 * (BR-070's "off" policy), the policy flip to "post" making a NEW close
 * post G-42 (DR DOWNTIME_EXPENSE · CR PRODUCTION_OVERHEAD — idle capacity
 * absorbed against applied overhead) with cost_amount stamped, the duration
 * window floors (typed + the ck_downtime_records_duration CHECK), the two
 * OEE views (daily exact folds + the month rollup) read as erp_app under
 * the tenant GUC, and RLS through the security_invoker views.
 *
 * The policy setting is flipped ON inside the suite (the qc.spec L5 seam)
 * and restored in afterAll — tenant M keeps its platform default "off".
 */

let fixture: MfgFixture;
let specItemId = "";
let centerId = "";
/** The DEDICATED OEE-fold center (isolation from the shared center's
 * earlier downtime records — hoisted: the period + RLS tests read it). */
let oeeCenterId = "";
const TODAY = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const found = await itemsStore.findItemBySku("M-DTN");
    specItemId =
      found?.id ??
      (
        await itemsStore.insertItem({
          sku: "M-DTN",
          name: "Downtime spec item (downtime-oee)",
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
        note: "M-DTN v1 (downtime spec)",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: fixture.items.flour, qtyPerOutput: "0.010000", scrapPct: "0" }],
      });
      await boms.activate(draft.id, { effectiveFrom: "2026-01-05", actorId: M_ACTOR });
    }

    const centers = await workCenters.list({ limit: 50 });
    const center =
      centers.find((row) => row.code === "M-DTN-CNV") ??
      (await workCenters.create({
        code: "M-DTN-CNV",
        name: "Downtime spec conversion center",
        nameAr: null,
        description: null,
        capacityPerShift: "8",
        shiftsPerDay: 2,
        fixedCostRate: "30.000000",
        varCostRate: "30.000000",
        costCenterId: null,
        actorId: M_ACTOR,
      }));
    centerId = center.id;

    const existingRouting = await mfgStore.findActiveRouting(specItemId);
    if (existingRouting === undefined) {
      const draft = await routingsSrv.createDraft({
        itemId: specItemId,
        outputUomId: pcs.id,
        note: "M-DTN routing v1 (two ops)",
        noteAr: null,
        actorId: M_ACTOR,
        operations: [
          {
            sequence: 10,
            workCenterId: centerId,
            setupTime: "1.000000",
            runTime: "0.500000",
            fixedCostRate: null,
            varCostRate: null,
            description: "First step",
            descriptionAr: null,
          },
          {
            sequence: 20,
            workCenterId: centerId,
            setupTime: "0.500000",
            runTime: "0.500000",
            fixedCostRate: null,
            varCostRate: null,
            description: "Second step",
            descriptionAr: null,
          },
        ],
      });
      await routingsSrv.activate(draft.id, { actorId: M_ACTOR });
    } else {
      // The existing ACTIVE routing already covers the item — the release
      // path resolves it on its own.
    }
  });
});

afterAll(async () => {
  // Order independence: restore the platform-default record-only policy.
  await clearMfgSetting("manufacturing.downtime_posting");
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

function logOpenDowntime(startedAt: string) {
  return withTenant(TENANT_M, () =>
    downtime.log({
      workCenterId: centerId,
      reasonCode: "BREAKDOWN",
      startedAt,
      durationMinutes: 0,
      endedAt: null,
      orderId: null,
      operationSequence: null,
      note: "downtime-oee spec record",
      actorId: M_ACTOR,
    }),
  );
}

// -- the packs --------------------------------------------------------------------

describe("PHASE-042 · downtime records + the OEE views (BR-070 policy gate)", () => {
  it("log creates the OPEN record — ended/cost/journal all NULL, duration 0", async () => {
    const record = await logOpenDowntime(`${TODAY()}T08:00:00Z`);
    expect(record.endedAt).toBeNull();
    expect(record.durationMinutes).toBe(0);
    expect(record.costAmount).toBeNull();
    expect(record.journalId).toBeNull();
    expect(record.reasonCode).toBe("BREAKDOWN");
  });

  it("close under the default 'off' policy is record-only — ended + duration stamped, cost/journal still NULL, zero journals", async () => {
    const record = await logOpenDowntime(`${TODAY()}T09:00:00Z`);
    const closed = await withTenant(TENANT_M, () =>
      downtime.close(record.id, {
        endedAt: `${TODAY()}T09:45:00Z`,
        durationMinutes: 45,
        actorId: M_ACTOR,
      }),
    );
    expect(closed.endedAt).not.toBeNull();
    expect(closed.durationMinutes).toBe(45);
    expect(closed.costAmount).toBeNull(); // BR-070: record-only by default
    expect(closed.journalId).toBeNull();
    const bySource = await withTenant(TENANT_M, () =>
      journal.findEntryBySourceKey("downtime_record", record.id, "close"),
    );
    expect(bySource).toBeUndefined();
  });

  it("flipping manufacturing.downtime_posting='post' makes a NEW close post G-42 exactly (DR DOWNTIME_EXPENSE · CR PRODUCTION_OVERHEAD) with cost_amount stamped", async () => {
    await setMfgSetting("manufacturing.downtime_posting", "post");
    const record = await logOpenDowntime(`${TODAY()}T10:00:00Z`);
    const closed = await withTenant(TENANT_M, () =>
      downtime.close(record.id, {
        endedAt: `${TODAY()}T11:30:00Z`,
        durationMinutes: 90,
        actorId: M_ACTOR,
      }),
    );
    // 90 min = 1.5h × (fixed 30 + var 30) = 90.0000.
    expect(closed.costAmount).toBe("90.0000");
    expect(closed.journalId).not.toBeNull();
    expect(await withTenant(TENANT_M, () => journalLinesOf(closed.journalId!))).toEqual([
      { accountId: fixture.gl.downtimeExpense, direction: "DEBIT", amount: "90.0000" },
      { accountId: fixture.gl.productionOverhead, direction: "CREDIT", amount: "90.0000" },
    ]);
    const bySource = await withTenant(TENANT_M, () =>
      journal.findEntryBySourceKey("downtime_record", record.id, "close"),
    );
    expect(bySource!.id).toBe(closed.journalId);
  });

  it("the duration window floors — 1500 is the typed DOWNTIME_INPUT_INVALID, and a raw 2000-minute insert is 23514", async () => {
    await expect(
      withTenant(TENANT_M, () =>
        downtime.log({
          workCenterId: centerId,
          reasonCode: "OTHER",
          startedAt: `${TODAY()}T12:00:00Z`,
          durationMinutes: 1500,
          endedAt: null,
          orderId: null,
          operationSequence: null,
          note: null,
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(DowntimeInputInvalidError);
    const client = await mfgAppClient();
    let code = "";
    try {
      await client.query(
        `INSERT INTO downtime_records
           (id, tenant_id, work_center_id, reason_code, started_at, ended_at, duration_minutes)
         VALUES (gen_random_uuid(), erp.current_tenant_id(), $1, 'OTHER', now(), NULL, 2000)`,
        [centerId],
      );
    } catch (error) {
      code = (error as { code?: string }).code ?? "";
    }
    await client.end();
    expect(code).toBe("23514");
  });

  it("v_work_center_oee_daily folds the day EXACTLY (planned/actual hours, downtime minutes, completed/skipped ops) as erp_app under the tenant GUC", async () => {
    // Isolation (the sequential shared-tenant discipline): earlier tests in
    // this file logged downtime on the shared center TODAY — this fold gets
    // a DEDICATED work center + a DRAFT routing bound explicitly (the
    // uncosted-op precedent: explicit routingId binds any version), so the
    // view's day is exactly what this test seeds.
    const oeeCenter = await withTenant(TENANT_M, () =>
      workCenters.create({
        code: "WC-OEE-" + Date.now().toString(36),
        name: "OEE fold center",
        nameAr: null,
        description: null,
        capacityPerShift: "8",
        shiftsPerDay: 1,
        fixedCostRate: "0",
        varCostRate: "0",
        costCenterId: null,
        actorId: M_ACTOR,
      }),
    );
    oeeCenterId = oeeCenter.id;
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await withTenant(TENANT_M, () => itemsStore.listUoms());
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const oeeRouting = await withTenant(TENANT_M, () =>
      routingsSrv.createDraft({
        itemId: specItemId,
        outputUomId: pcs.id,
        note: "OEE fold routing",
        noteAr: null,
        actorId: M_ACTOR,
        operations: [
          { sequence: 10, workCenterId: oeeCenter.id, setupTime: "1.000000", runTime: "0.500000", fixedCostRate: null, varCostRate: null, description: "Fold step one", descriptionAr: null },
          { sequence: 20, workCenterId: oeeCenter.id, setupTime: "0.500000", runTime: "0.500000", fixedCostRate: null, varCostRate: null, description: "Fold step two", descriptionAr: null },
        ],
      }),
    );
    // Seed: one order on the dedicated routing — op 10 completed with
    // times, op 20 started then skipped (a skip that never started would
    // carry no started_at and stay out of the day's fold — the view's
    // WHERE), plus a 90-minute closed downtime record on the same
    // center/day.
    const order = await withTenant(TENANT_M, () =>
      orders.create({
        branchId: fixture.branchId,
        itemId: specItemId,
        bomId: null,
        plannedQty: "50",
        plannedDate: null,
        materialsWarehouseId: fixture.warehouseRaw,
        fgWarehouseId: fixture.warehouseFg,
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "downtime-oee spec order",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    await withTenant(TENANT_M, () =>
      orders.release(order.id, M_ACTOR, { routingId: oeeRouting.id }),
    );
    await withTenant(TENANT_M, () => orders.start(order.id, M_ACTOR));
    await withTenant(TENANT_M, () => shopFloor.startOp(order.id, 10, M_ACTOR));
    await withTenant(TENANT_M, () =>
      shopFloor.completeOp(order.id, 10, {
        actualSetupTime: "1",
        actualRunTime: "1",
        scrapQty: null,
        scrapReasonCode: null,
        actorId: M_ACTOR,
      }),
    );
    await withTenant(TENANT_M, () => shopFloor.startOp(order.id, 20, M_ACTOR));
    await withTenant(TENANT_M, () =>
      shopFloor.skipOp(order.id, 20, {
        reason: "batch released after step 10",
        approvedBy: M_QC,
        actorId: M_ACTOR,
      }),
    );
    await withTenant(TENANT_M, () =>
      downtime.log({
        workCenterId: oeeCenter.id,
        reasonCode: "MATERIAL_SHORTAGE",
        startedAt: new Date().toISOString(),
        durationMinutes: 90,
        endedAt: new Date().toISOString(),
        orderId: null,
        operationSequence: null,
        note: "the OEE availability input",
        actorId: M_ACTOR,
      }),
    );

    const client = await mfgAppClient();
    const daily = await client.query<{
      day: string;
      plannedHours: string;
      actualHours: string;
      downtimeMinutes: number;
      completed: number;
      skipped: number;
      total: number;
    }>(
      `SELECT day::text,
              planned_hours::text AS "plannedHours",
              actual_hours::text AS "actualHours",
              downtime_minutes::int AS "downtimeMinutes",
              completed_operations::int AS completed,
              skipped_operations::int AS skipped,
              total_operations::int AS total
         FROM v_work_center_oee_daily
        WHERE work_center_id = $1
        ORDER BY day`,
      [oeeCenterId],
    );
    await client.end();
    // The order's two ops ran today; the seeded record shares the day.
    const row = daily.rows.find((entry) => entry.day === TODAY());
    expect(row, `expected an OEE row for today among ${JSON.stringify(daily.rows)}`).toBeDefined();
    // planned = (1 + 0.5) + (0.5 + 0.5) = 2.5h (std times, per the view);
    // actual = 1 + 1 = 2h (the skipped op contributes its zero actuals);
    // downtime = 90; completed = 1; skipped = 1; total = 2.
    expect(row!.plannedHours).toBe("2.500000");
    expect(row!.actualHours).toBe("2.000000");
    expect(row!.downtimeMinutes).toBe(90);
    expect(row!.completed).toBe(1);
    expect(row!.skipped).toBe(1);
    expect(row!.total).toBe(2);
    // Exactly the one day for this center in this tenant.
    expect(daily.rows.filter((entry) => entry.day === TODAY())).toHaveLength(1);
  });

  it("v_work_center_oee_period rolls the month over the daily folds", async () => {
    const client = await mfgAppClient();
    const period = await client.query<{
      periodStart: string;
      plannedHours: string;
      actualHours: string;
      downtimeMinutes: number;
      completed: number;
      skipped: number;
      total: number;
    }>(
      `SELECT date_trunc('month', period_start)::date::text AS "periodStart",
              planned_hours::text AS "plannedHours",
              actual_hours::text AS "actualHours",
              downtime_minutes::int AS "downtimeMinutes",
              completed_operations::int AS completed,
              skipped_operations::int AS skipped,
              total_operations::int AS total
         FROM v_work_center_oee_period
        WHERE work_center_id = $1
        ORDER BY period_start`,
      [oeeCenterId],
    );
    await client.end();
    const month = `${TODAY().slice(0, 7)}-01`;
    const row = period.rows.find((entry) => entry.periodStart === month);
    expect(row, `expected a period row for ${month}`).toBeDefined();
    // The month's only day is the seeded one — the rollup equals the day.
    expect(row!.plannedHours).toBe("2.500000");
    expect(row!.actualHours).toBe("2.000000");
    expect(row!.downtimeMinutes).toBe(90);
    expect(row!.completed).toBe(1);
    expect(row!.skipped).toBe(1);
    expect(row!.total).toBe(2);
  });

  it("RLS rides through the security_invoker views — a second tenant's session sees none of this center's rows", async () => {
    const client = await appClient();
    await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_A]);
    const daily = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM v_work_center_oee_daily WHERE work_center_id = $1`,
      [oeeCenterId],
    );
    const period = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM v_work_center_oee_period WHERE work_center_id = $1`,
      [oeeCenterId],
    );
    await client.end();
    expect(daily.rows[0]!.n).toBe(0);
    expect(period.rows[0]!.n).toBe(0);
  });

  it("the log is append-shaped — closing an already-closed record is the typed DOWNTIME_ALREADY_CLOSED", async () => {
    const record = await withTenant(TENANT_M, () =>
      downtime.log({
        workCenterId: centerId,
        reasonCode: "CHANGEOVER",
        startedAt: `${TODAY()}T13:00:00Z`,
        durationMinutes: 15,
        endedAt: `${TODAY()}T13:15:00Z`,
        orderId: null,
        operationSequence: null,
        note: null,
        actorId: M_ACTOR,
      }),
    );
    expect(record.endedAt).not.toBeNull(); // created closed
    await expect(
      withTenant(TENANT_M, () =>
        downtime.close(record.id, {
          endedAt: `${TODAY()}T14:00:00Z`,
          durationMinutes: 60,
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(DowntimeAlreadyClosedError);
  });
});
