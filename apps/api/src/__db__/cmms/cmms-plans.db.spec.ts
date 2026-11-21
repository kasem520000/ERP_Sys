import { beforeAll, describe, expect, it } from "vitest";
import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { MaintenancePlanService } from "../../modules/fixed_assets/application/maintenance-plan-service";
import { MaintenanceWorkOrderService } from "../../modules/fixed_assets/application/maintenance-work-order-service";
import {
  CmmsAssetNotOperableError,
  CmmsInputInvalidError,
  CmmsPlanTriggerShapeError,
  CmmsPlanWindowOpenError,
} from "../../modules/fixed_assets/domain/cmms-errors";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import {
  CM_ACTOR,
  TENANT_CMMS,
  ensureCmmsG59World,
  freshAsset,
  numbering,
  posting,
  superuserClient,
  type CmmsG59World,
} from "./fixtures";

/**
 * PHASE-049 (W-17 — T-07) — the plans API pinned over real PostgreSQL 16
 * (the plan §4's `cmms-plans.db.spec` — acceptance #5's calendar side +
 * BR-097 + the carry-over):
 *
 * - THE CALENDAR WALK: a due plan generates (the order enters at PLANNED
 *   with the checklist carried), the next_due advances by the STRICT
 *   CADENCE (next_due + interval — never today + interval), and a
 *   not-due evaluation skips BY NAME (PLAN_NOT_DUE).
 * - BR-097's SINGLE-OPEN WINDOW: while the generated order is open, a
 *   due evaluation skips BY NAME (PLAN_WINDOW_OPEN) and the forced
 *   generation refuses BY NAME; completing the order RE-ARMS the window
 *   (the next evaluation generates).
 * - THE CARRY-OVER: only the ACTIVE tasks are carried, with the
 *   seq/title/instruction SNAPSHOT (a later plan edit never rewrites the
 *   generated order's steps); a task with carried steps refuses the
 *   delete BY NAME (deactivate instead).
 * - THE METER THRESHOLD (the pure fold over the service — the readings
 *   API itself is W-18's): the authoring baseline (the meter's position
 *   at plan definition), the threshold crossing, and THE BACK-DATED
 *   NO-DOUBLE-TRIGGER LAW (the anchor is the GENERATION's own reading
 *   stamp — a later-inserted earlier-dated reading evaluates at its own
 *   position; a back-dated-but-higher reading re-evaluates FROM THE
 *   ANCHOR; a window already generated never re-arms).
 * - THE XOR TRIGGER SHAPE: every malformed authoring refuses BY NAME
 *   (PLAN_TRIGGER_SHAPE — the 0105 CHECK's typed first line), and the
 *   trigger kind is the plan's identity (no silent kind swap).
 * - D-01's authoring guard extends to plans (a disposed asset opens no
 *   plan — ASSET_NOT_OPERABLE by name).
 */

const audit = new AuditService(new DrizzleAuditStore());
const plans = new MaintenancePlanService(audit, numbering);
const orders = new MaintenanceWorkOrderService(audit, posting, numbering);

let world: CmmsG59World;

/** Canonical decimal comparison (the DB returns numerics at their full
 * column scale — the spec compares VALUES). */
function expectDec(actual: string | null | undefined, expected: string): void {
  expect(actual === null || actual === undefined ? null : new Decimal(actual).toString()).toBe(
    new Decimal(expected).toString(),
  );
}

beforeAll(async () => {
  world = await ensureCmmsG59World();
});

/** A meter + (optionally) readings, per arm — the fresh-world law. The
 * `assetCode` is the SAME code the arm's freshAsset carries. */
async function freshMeter(
  assetCode: string,
  meterName: string,
  readings: readonly { value: string; effectiveDate: string }[] = [],
): Promise<string> {
  const su = await superuserClient();
  const meter = await su.query<{ id: string }>(
    `INSERT INTO asset_meters (id, tenant_id, asset_id, name, type, unit, last_value)
     VALUES (gen_random_uuid(), $1,
       (SELECT id FROM assets WHERE tenant_id = $1 AND code = $2 LIMIT 1),
       $3, 'KM', 'km', $4)
     ON CONFLICT (tenant_id, asset_id, name) DO UPDATE SET last_value = EXCLUDED.last_value
     RETURNING id`,
    [TENANT_CMMS, assetCode, meterName, readings.at(-1)?.value ?? "0"],
  );
  for (const reading of readings) {
    await su.query(
      `INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'MANUAL')`,
      [TENANT_CMMS, meter.rows[0]!.id, reading.value, reading.effectiveDate],
    );
  }
  await su.end();
  return meter.rows[0]!.id;
}

describe("PHASE-049 W-17 — the plans register (D-08: the XOR shape law, refused BY NAME)", () => {
  it("a CALENDAR plan needs its full pair; a meter or threshold on it refuses (the XOR)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-REG-A");
      const missingPair = await plans
        .create({
          assetId: asset,
          name: "Missing pair",
          triggerType: "CALENDAR",
          nextDueDate: "2026-03-01",
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(missingPair).toBeInstanceOf(CmmsPlanTriggerShapeError);
      expect((missingPair as CmmsPlanTriggerShapeError).code).toBe("PLAN_TRIGGER_SHAPE");

      const meter = await freshMeter("PL-REG-A", "Meter A");
      const withMeter = await plans
        .create({
          assetId: asset,
          name: "Calendar with meter",
          triggerType: "CALENDAR",
          intervalDays: 30,
          nextDueDate: "2026-03-01",
          meterId: meter,
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(withMeter).toBeInstanceOf(CmmsPlanTriggerShapeError);
    });
  });

  it("a METER plan needs its meter + threshold; a calendar pair on it refuses (the XOR)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-REG-B");
      const meter = await freshMeter("PL-REG-B", "Meter B");
      const missingThreshold = await plans
        .create({ assetId: asset, name: "No threshold", triggerType: "METER", meterId: meter, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(missingThreshold).toBeInstanceOf(CmmsPlanTriggerShapeError);

      const withCalendar = await plans
        .create({
          assetId: asset,
          name: "Meter with calendar",
          triggerType: "METER",
          meterId: meter,
          thresholdDelta: "5000",
          intervalDays: 30,
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(withCalendar).toBeInstanceOf(CmmsPlanTriggerShapeError);
    });
  });

  it("the trigger kind is the plan's identity — a shape-breaking patch refuses BY NAME", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-REG-C");
      const plan = await plans.create({
        assetId: asset,
        name: "The identity law",
        triggerType: "CALENDAR",
        intervalDays: 30,
        nextDueDate: "2026-03-01",
        actorId: CM_ACTOR,
      });
      // A threshold on a CALENDAR plan — the post-patch shape refuses.
      const badPatch = await plans
        .patch({ planId: plan.id, thresholdDelta: "5000", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(badPatch).toBeInstanceOf(CmmsPlanTriggerShapeError);

      // The honest patch works (the cadence edit keeps the shape).
      const goodPatch = await plans.patch({ planId: plan.id, intervalDays: 45, actorId: CM_ACTOR });
      expect(goodPatch.intervalDays).toBe(45);
    });
  });

  it("D-01's authoring guard: a DISPOSED asset opens no plan — ASSET_NOT_OPERABLE by name", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-REG-D");
      const su = await superuserClient();
      await su.query(`UPDATE assets SET status = 'WRITTEN_OFF' WHERE tenant_id = $1 AND id = $2`, [
        TENANT_CMMS,
        asset,
      ]);
      await su.end();
      const refusal = await plans
        .create({
          assetId: asset,
          name: "Too late",
          triggerType: "CALENDAR",
          intervalDays: 30,
          nextDueDate: "2026-03-01",
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(CmmsAssetNotOperableError);
    });
  });
});

describe("PHASE-049 W-17 — THE CALENDAR WALK (D-08 + BR-097: acceptance #5's calendar side)", () => {
  it("a due plan generates: PLANNED entry + the carried checklist + the STRICT CADENCE re-arm", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-CAL-A");
      const plan = await plans.create({
        assetId: asset,
        name: "Monthly service",
        nameAr: "خدمة شهرية",
        triggerType: "CALENDAR",
        intervalDays: 30,
        nextDueDate: "2026-03-01",
        actorId: CM_ACTOR,
      });
      await plans.addTask({ planId: plan.id, seq: 1, title: "Inspect belts", instruction: "Check tension", actorId: CM_ACTOR });
      await plans.addTask({ planId: plan.id, seq: 2, title: "Replace filter", actorId: CM_ACTOR });
      // An INACTIVE task — never carried.
      const inactive = await plans.addTask({ planId: plan.id, seq: 3, title: "Old step", actorId: CM_ACTOR });
      await plans.patchTask({ planId: plan.id, taskId: inactive.id, isActive: false, actorId: CM_ACTOR });

      // Due (today ≥ next_due, inclusive) → generates.
      const generated = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-03-01" });
      expect(generated.generated).toBe(true);
      expect(generated.orderNo).toMatch(/^MO-\d{4}-\d{6}$/);

      // THE CARRY-OVER: the order entered at PLANNED with the plan link
      // and exactly the ACTIVE tasks (the snapshot copies).
      const order = await orders.get(generated.orderId!);
      expect(order.status).toBe("PLANNED");
      expect(order.planId).toBe(plan.id);
      expect(order.plannedAt).not.toBeNull();
      expect(order.problem).toBe("Preventive: Monthly service");
      const steps = await orders.listSteps(order.id);
      expect(steps.map((step) => step.seq)).toEqual([1, 2]);
      expect(steps[0]!.title).toBe("Inspect belts");
      expect(steps[0]!.instruction).toBe("Check tension");
      expect(steps.map((step) => step.result)).toEqual([null, null]);

      // THE STRICT CADENCE: next_due = 2026-03-01 + 30 = 2026-03-31 —
      // NOT today + 30 (2026-03-31 happens to equal it here; the next
      // arm proves the law against a late generation).
      const after = await plans.get(plan.id);
      expect(after.nextDueDate).toBe("2026-03-31");
      expect(after.lastGeneratedAt).not.toBeNull();

      // A not-due evaluation skips BY NAME.
      const skip = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-03-20" });
      expect(skip.generated).toBe(false);
      expect(skip.skipReason).toBe("PLAN_NOT_DUE");
    });
  });

  it("BR-097's single-open window: the named skip while open, the re-arm after completion", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-CAL-B");
      const plan = await plans.create({
        assetId: asset,
        name: "Window law",
        triggerType: "CALENDAR",
        intervalDays: 30,
        nextDueDate: "2026-01-01",
        actorId: CM_ACTOR,
      });

      // Late generation (today 2026-01-10 for a 2026-01-01 due) — the
      // strict cadence re-arms at 2026-01-31, NOT 2026-02-09.
      const first = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-01-10" });
      expect(first.generated).toBe(true);
      expect((await plans.get(plan.id)).nextDueDate).toBe("2026-01-31");

      // The window opens again (today past the re-armed due) while the
      // generated order is STILL OPEN → the NAMED skip.
      const skipped = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-15" });
      expect(skipped).toMatchObject({ generated: false, skipReason: "PLAN_WINDOW_OPEN" });

      // The FORCED generation refuses BY NAME (never a silent skip).
      const forced = await plans
        .forceGenerate({ planId: plan.id, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(forced).toBeInstanceOf(CmmsPlanWindowOpenError);
      expect((forced as CmmsPlanWindowOpenError).code).toBe("PLAN_WINDOW_OPEN");

      // Complete the open order (the machine walk: start → a priced
      // line → complete) — the window RE-ARMS.
      await orders.start(first.orderId!, CM_ACTOR);
      await orders.addLine({
        workOrderId: first.orderId!,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "120",
        description: "Service bill",
        actorId: CM_ACTOR,
      });
      await orders.complete({ workOrderId: first.orderId!, actorId: CM_ACTOR });

      const reArmed = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-15" });
      expect(reArmed.generated).toBe(true);
      expect((await plans.get(plan.id)).nextDueDate).toBe("2026-03-02"); // 2026-01-31 + 30
    });
  });

  it("an INACTIVE plan skips BY NAME — PLAN_INACTIVE (the sweep never touches it)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-CAL-C");
      const plan = await plans.create({
        assetId: asset,
        name: "Inactive law",
        triggerType: "CALENDAR",
        intervalDays: 30,
        nextDueDate: "2026-01-01",
        actorId: CM_ACTOR,
      });
      await plans.patch({ planId: plan.id, isActive: false, actorId: CM_ACTOR });
      const skip = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-06-01" });
      expect(skip).toMatchObject({ generated: false, skipReason: "PLAN_INACTIVE" });
    });
  });

  it("the checklist task with CARRIED steps refuses the delete BY NAME (deactivate instead)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-CAL-D");
      const plan = await plans.create({
        assetId: asset,
        name: "Template law",
        triggerType: "CALENDAR",
        intervalDays: 30,
        nextDueDate: "2026-01-01",
        actorId: CM_ACTOR,
      });
      const task = await plans.addTask({ planId: plan.id, seq: 1, title: "Step with history", actorId: CM_ACTOR });
      const generated = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-01" });
      expect(generated.generated).toBe(true);

      const refusal = await plans
        .removeTask({ planId: plan.id, taskId: task.id, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(refusal).toBeInstanceOf(CmmsInputInvalidError);
      expect((refusal as CmmsInputInvalidError).message).toContain("carried step");

      // The honest edit: deactivate (future generations skip it).
      await plans.patchTask({ planId: plan.id, taskId: task.id, isActive: false, actorId: CM_ACTOR });
      const tasks = await plans.listTasks(plan.id);
      expect(tasks.find((row) => row.id === task.id)?.isActive).toBe(false);
    });
  });
});

describe("PHASE-049 W-17 — THE METER FOLD over the service (D-08: the anchor semantics)", () => {
  it("the authoring baseline + the threshold crossing + THE OPEN-WINDOW SKIP + the anchor law", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-MTR-A");
      // The meter stands at 10,000 (two readings in order).
      const meter = await freshMeter("PL-MTR-A", "Odometer", [
        { value: "9500", effectiveDate: "2026-01-05" },
        { value: "10000", effectiveDate: "2026-01-20" },
      ]);
      const plan = await plans.create({
        assetId: asset,
        name: "Every 5000 km",
        triggerType: "METER",
        meterId: meter,
        thresholdDelta: "5000",
        actorId: CM_ACTOR,
      });
      // THE AUTHORING BASELINE: the meter's position at definition (the
      // declared interpretation — the first window measures from here,
      // never an immediate trigger on the meter's history).
      expectDec(plan.lastAnchorValue, "10000");

      const addReading = async (value: string, effectiveDate: string): Promise<void> => {
        const su = await superuserClient();
        await su.query(
          `INSERT INTO asset_meter_readings (id, tenant_id, meter_id, value, effective_date, source)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'MANUAL')`,
          [TENANT_CMMS, meter, value, effectiveDate],
        );
        await su.end();
      };

      // Not due: 12,000 − 10,000 = 2,000 < 5,000.
      await addReading("12000", "2026-02-01");
      const notDue = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-02" });
      expect(notDue).toMatchObject({ generated: false, skipReason: "PLAN_NOT_DUE" });

      // Due at exactly the threshold (the 5,000th km IS the due km —
      // 15,000 − 10,000 = 5,000) → generates; THE ANCHOR MOVES to the
      // GENERATION's own reading stamp (15,000).
      await addReading("15000", "2026-02-10");
      const due = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-11" });
      expect(due.generated).toBe(true);
      expectDec((await plans.get(plan.id)).lastAnchorValue, "15000");

      // THE SAME READING NEVER RE-TRIGGERS: the anchor moved past it —
      // 15,000 − 15,000 = 0 < 5,000 (the first half of the
      // no-double-trigger law, proven on the explicit path).
      const sameReading = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-12" });
      expect(sameReading).toMatchObject({ generated: false, skipReason: "PLAN_NOT_DUE" });

      // A LATER reading crosses again (20,300 − 15,000 = 5,300 ≥ 5,000)
      // while the window is STILL OPEN → the NAMED SKIP (BR-097 holds on
      // the meter path exactly as on the calendar path).
      await addReading("20300", "2026-02-15");
      const openSkip = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-16" });
      expect(openSkip).toMatchObject({ generated: false, skipReason: "PLAN_WINDOW_OPEN" });

      // THE BACK-DATED READING (a later-inserted, earlier-dated 14,000):
      // the evaluation reads the log by EFFECTIVE DATE — the back-dated
      // row can never push the input backward, and once the window
      // re-arms the anchor (15,000) still measures it at its own
      // position (14,000 − 15,000 < 0 — the pure fold's law; the
      // event-driven proof on each insert is W-18's wiring).
      await addReading("14000", "2026-02-05");
      const afterBackDated = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-17" });
      expect(afterBackDated).toMatchObject({ generated: false, skipReason: "PLAN_WINDOW_OPEN" });

      // Complete the open order — the window RE-ARMS; the latest
      // effective reading is 20,300 → due → generates; the anchor moves
      // to 20,300 (the GENERATION's own stamp — the back-dated 14,000
      // sitting in the log never influenced anything).
      await orders.start(due.orderId!, CM_ACTOR);
      await orders.addLine({
        workOrderId: due.orderId!,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "90",
        description: "Bill",
        actorId: CM_ACTOR,
      });
      await orders.complete({ workOrderId: due.orderId!, actorId: CM_ACTOR });
      const reArmed = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-18" });
      expect(reArmed.generated).toBe(true);
      expectDec((await plans.get(plan.id)).lastAnchorValue, "20300");

      // And the new window measures from the NEW anchor: 20,300 − 20,300
      // = 0 → not due (the second half of the no-double-trigger law).
      const settled = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-02-19" });
      expect(settled).toMatchObject({ generated: false, skipReason: "PLAN_NOT_DUE" });
    });
  });

  it("a METER plan on a meter with NO readings skips BY NAME — METER_NO_READING", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-MTR-B");
      const meter = await freshMeter("PL-MTR-B", "Empty meter", []);
      const plan = await plans.create({
        assetId: asset,
        name: "No readings yet",
        triggerType: "METER",
        meterId: meter,
        thresholdDelta: "100",
        actorId: CM_ACTOR,
      });
      const skip = await plans.evaluate({ planId: plan.id, actorId: CM_ACTOR, today: "2026-03-01" });
      expect(skip).toMatchObject({ generated: false, skipReason: "METER_NO_READING" });
    });
  });
});

describe("PHASE-049 W-17 — the bulk sweep entry (the W-19 job's surface)", () => {
  it("evaluateAll reports every active plan with the NAMED skips (never a silent truncation)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("PL-SWEEP-A");
      const duePlan = await plans.create({
        assetId: asset,
        name: "Sweep due",
        triggerType: "CALENDAR",
        intervalDays: 90,
        nextDueDate: "2026-01-01",
        actorId: CM_ACTOR,
      });
      const futurePlan = await plans.create({
        assetId: asset,
        name: "Sweep future",
        triggerType: "CALENDAR",
        intervalDays: 90,
        nextDueDate: "2030-01-01",
        actorId: CM_ACTOR,
      });
      const results = await plans.evaluateAll({ actorId: CM_ACTOR, today: "2026-02-01" });
      const due = results.find((row) => row.planId === duePlan.id);
      const future = results.find((row) => row.planId === futurePlan.id);
      expect(due?.generated).toBe(true);
      expect(future).toMatchObject({ generated: false, skipReason: "PLAN_NOT_DUE" });
      // Every row carries its verdict — no silent skips in the report.
      for (const row of results) {
        expect(row.generated === true || row.skipReason !== undefined).toBe(true);
      }
    });
  });
});
