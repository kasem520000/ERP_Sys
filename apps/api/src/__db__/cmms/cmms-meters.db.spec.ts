import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AssetMetersService } from "../../modules/fixed_assets/application/asset-meters-service";
import { MaintenancePlanService } from "../../modules/fixed_assets/application/maintenance-plan-service";
import { MaintenanceWorkOrderService } from "../../modules/fixed_assets/application/maintenance-work-order-service";
import {
  CmmsMeterRegressionError,
  CmmsOdometerAlreadyDesignatedError,
  CmmsOdometerNotKmError,
  CmmsReadingJobLinkError,
  CmmsReadingWorkOrderNotFoundError,
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
} from "./fixtures";

/**
 * PHASE-049 (W-18 — T-08) — the meters + readings pinned over real
 * PostgreSQL 16 (the plan §4's `cmms-meters.db.spec`) — the owner's
 * order: «كتابة R-10 بالإسناد الواحد ودلتا المرساة ورفض مُنمّط ولا
 * تسليح للنوافذ المولَّدة»:
 *
 * - R-10's write-path arms (the W-17 reading declared them W-18's): the
 *   KM-only odometer law (ODOMETER_NOT_KM) and the ONE-per-asset
 *   designation (ODOMETER_ALREADY_DESIGNATED carrying the standing one)
 *   — at authoring AND at the designation patch.
 * - THE MONOTONIC LAW (D-07): a reading below the snapshot refuses BY
 *   NAME with BOTH values; a back-dated-but-HIGHER reading is LEGAL and
 *   moves the snapshot (the max recompute).
 * - THE JOB-LINK XOR + the declared interpretation: the JOB source
 *   carries exactly a work-order link, and the linked order is a
 *   COMPLETED one (the completion-time technician entry; a mid-job
 *   reading is the MANUAL source).
 * - THE EVENT-DRIVEN EVALUATION (the W-17 plans spec's deferred proof —
 *   «the event-driven per-insert proof is W-18's wiring»): the reading's
 *   OWN transaction evaluates the ACTIVE METER plans bound to the meter;
 *   the crossing reading GENERATES (the anchor moves to the GENERATION's
 *   own stamp); a further reading that does not cross FROM THE NEW
 *   ANCHOR skips BY NAME (PLAN_NOT_DUE — NO ARMING: the reading never
 *   moved the anchor); a due reading while the window is open skips BY
 *   NAME (PLAN_WINDOW_OPEN — the report carries the skip, never an
 *   exception); a CALENDAR plan on the same asset is never evaluated by
 *   the meter's event.
 */

const audit = new AuditService(new DrizzleAuditStore());
const plans = new MaintenancePlanService(audit, numbering);
const orders = new MaintenanceWorkOrderService(audit, posting, numbering);
const meters = new AssetMetersService(audit, plans);

beforeAll(async () => {
  await ensureCmmsG59World();
});

function expectDec(actual: string | null | undefined, expected: string): void {
  expect(actual === null || actual === undefined ? null : new Decimal(actual).toString()).toBe(
    new Decimal(expected).toString(),
  );
}

describe("PHASE-049 W-18 — R-10's write-path arms (the typed translations of 0106's floors)", () => {
  it("the odometer designation is the KM-type meter's — a HOURS meter refuses BY NAME (at authoring AND at the patch)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("MTR-R10-HOURS");
      const refused = await meters
        .createMeter({
          assetId: asset,
          name: "Engine hours",
          type: "HOURS",
          unit: "h",
          isOdometer: true,
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CmmsOdometerNotKmError);

      const meter = await meters.createMeter({
        assetId: asset,
        name: "Engine hours",
        type: "HOURS",
        unit: "h",
        actorId: CM_ACTOR,
      });
      expect(meter.isOdometer).toBe(false);
      const patchRefused = await meters
        .patchMeter({ meterId: meter.id, isOdometer: true, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(patchRefused).toBeInstanceOf(CmmsOdometerNotKmError);
    });
  });

  it("ONE odometer per asset — the second designation refuses BY NAME carrying the standing one (at authoring AND at the patch)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("MTR-R10-ONE");
      const first = await meters.createMeter({
        assetId: asset,
        name: "Main odometer",
        type: "KM",
        unit: "km",
        isOdometer: true,
        actorId: CM_ACTOR,
      });
      expect(first.isOdometer).toBe(true);

      const second = await meters
        .createMeter({
          assetId: asset,
          name: "Trip odometer",
          type: "KM",
          unit: "km",
          isOdometer: true,
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(second).toBeInstanceOf(CmmsOdometerAlreadyDesignatedError);
      expect((second as CmmsOdometerAlreadyDesignatedError).details).toMatchObject({
        existingMeterId: first.id,
      });

      // The honest flow: undesignate the standing one, then designate the
      // other KM meter (the single designation moves, never multiplies).
      const other = await meters.createMeter({
        assetId: asset,
        name: "Trip odometer",
        type: "KM",
        unit: "km",
        actorId: CM_ACTOR,
      });
      await meters.patchMeter({ meterId: first.id, isOdometer: false, actorId: CM_ACTOR });
      const moved = await meters.patchMeter({ meterId: other.id, isOdometer: true, actorId: CM_ACTOR });
      expect(moved.isOdometer).toBe(true);
    });
  });
});

describe("PHASE-049 W-18 — the readings log (D-07: the monotonic law + the JOB-link XOR)", () => {
  it("a reading below the snapshot refuses BY NAME with BOTH values; the meter starts at position zero", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("MTR-MONO");
      const meter = await meters.createMeter({
        assetId: asset,
        name: "Odometer",
        type: "KM",
        unit: "km",
        isOdometer: true,
        actorId: CM_ACTOR,
      });
      expectDec(meter.lastValue, "0");

      const first = await meters.recordReading({
        meterId: meter.id,
        value: "95000",
        effectiveDate: "2026-06-01",
        actorId: CM_ACTOR,
      });
      expectDec(first.reading.value, "95000");
      expectDec(first.meter.lastValue, "95000");

      const regression = await meters
        .recordReading({
          meterId: meter.id,
          value: "90000",
          effectiveDate: "2026-06-10",
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(regression).toBeInstanceOf(CmmsMeterRegressionError);
      const regressionDetails = (regression as CmmsMeterRegressionError).details as {
        snapshotValue: string;
        readingValue: string;
      };
      expectDec(regressionDetails.snapshotValue, "95000");
      expectDec(regressionDetails.readingValue, "90000");

      // A back-dated-but-HIGHER reading is LEGAL and moves the snapshot
      // (D-07's effective-date semantics — the max recompute).
      const backDated = await meters.recordReading({
        meterId: meter.id,
        value: "96000",
        effectiveDate: "2026-05-15",
        actorId: CM_ACTOR,
      });
      expectDec(backDated.meter.lastValue, "96000");
      // The log keeps both readings, the effective-date order rules.
      const log = await meters.listReadings(meter.id);
      expect(log).toHaveLength(2);
      expect(log[0]!.effectiveDate).toBe("2026-06-01");
    });
  });

  it("the JOB-link XOR + the declared interpretation: a JOB reading links a COMPLETED work order exactly; MANUAL/IMPORT never carry a link", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("MTR-JOB");
      const meter = await meters.createMeter({
        assetId: asset,
        name: "Odometer",
        type: "KM",
        unit: "km",
        actorId: CM_ACTOR,
      });

      // JOB without a link refuses BY NAME.
      const noLink = await meters
        .recordReading({
          meterId: meter.id,
          value: "100",
          effectiveDate: "2026-06-01",
          source: "JOB",
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(noLink).toBeInstanceOf(CmmsReadingJobLinkError);

      // MANUAL with a link refuses BY NAME (the XOR's other side).
      const order = await orders.create({ assetId: asset, problem: "Service", actorId: CM_ACTOR });
      const manualWithLink = await meters
        .recordReading({
          meterId: meter.id,
          value: "100",
          effectiveDate: "2026-06-01",
          source: "MANUAL",
          workOrderId: order.id,
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(manualWithLink).toBeInstanceOf(CmmsReadingJobLinkError);

      // A bogus order id refuses BY NAME.
      const bogus = await meters
        .recordReading({
          meterId: meter.id,
          value: "100",
          effectiveDate: "2026-06-01",
          source: "JOB",
          workOrderId: "00000000-0000-4000-8000-0000000000ff",
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(bogus).toBeInstanceOf(CmmsReadingWorkOrderNotFoundError);

      // A JOB reading on a NON-completed order refuses (the declared
      // interpretation: the completion-time entry is the JOB source).
      const inProgress = await meters
        .recordReading({
          meterId: meter.id,
          value: "100",
          effectiveDate: "2026-06-01",
          source: "JOB",
          workOrderId: order.id,
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(inProgress).toBeInstanceOf(CmmsReadingJobLinkError);
      expect((inProgress as CmmsReadingJobLinkError).details).toMatchObject({
        workOrderStatus: "REQUESTED",
      });

      // The honest JOB shape: complete the order first (the real machine),
      // then the reading lands.
      await orders.plan(order.id, CM_ACTOR);
      await orders.start(order.id, CM_ACTOR);
      await orders.addLine({
        workOrderId: order.id,
        legType: "LABOR",
        employeeId: (await ensureCmmsG59World()).technicianEmployeeId,
        hours: "1",
        unitRate: "10",
        actorId: CM_ACTOR,
      });
      await orders.complete({ workOrderId: order.id, solution: "Done", actorId: CM_ACTOR });

      const jobReading = await meters.recordReading({
        meterId: meter.id,
        value: "100",
        effectiveDate: "2026-06-02",
        source: "JOB",
        workOrderId: order.id,
        actorId: CM_ACTOR,
      });
      expect(jobReading.reading.source).toBe("JOB");
      expect(jobReading.reading.workOrderId).toBe(order.id);
    });
  });
});

describe("PHASE-049 W-18 — THE EVENT-DRIVEN EVALUATION (the reading's own transaction; no arming of generated windows)", () => {
  it("the crossing reading GENERATES in the reading's own transaction (the anchor moves to the GENERATION's stamp); the not-crossing follow-up skips BY NAME — NO ARMING", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("MTR-EVENT");
      const meter = await meters.createMeter({
        assetId: asset,
        name: "Odometer",
        type: "KM",
        unit: "km",
        actorId: CM_ACTOR,
      });
      // The plan: 5,000 km windows; authored at 10,000 (the baseline).
      await meters.recordReading({
        meterId: meter.id,
        value: "10000",
        effectiveDate: "2026-06-01",
        actorId: CM_ACTOR,
      });
      const plan = await plans.create({
        assetId: asset,
        name: "Oil change",
        triggerType: "METER",
        meterId: meter.id,
        thresholdDelta: "5000",
        actorId: CM_ACTOR,
      });

      // The crossing reading: 15,200 − 10,000 = 5,200 ≥ 5,000 → GENERATES.
      const crossing = await meters.recordReading({
        meterId: meter.id,
        value: "15200",
        effectiveDate: "2026-06-10",
        actorId: CM_ACTOR,
      });
      expect(crossing.evaluations).toHaveLength(1);
      expect(crossing.evaluations[0]).toMatchObject({ planId: plan.id, generated: true });
      expect(crossing.evaluations[0]!.orderId).toBeTruthy();

      // The anchor moved to the GENERATION's own stamp (15,200) — the
      // plan row itself proves it (NO ARMING: it was the GENERATION that
      // moved the anchor, never the reading by itself). The in-tx read.
      const tx = requireTenantContext().tx!;
      const planRows = await tx.execute<{ last_anchor_value: string }>(sql`
        SELECT last_anchor_value::text AS last_anchor_value FROM maintenance_plans
        WHERE id = ${plan.id}`);
      expectDec((planRows.rows as unknown as { last_anchor_value: string }[])[0]!.last_anchor_value, "15200");

      // A further reading that does not cross FROM THE NEW ANCHOR skips
      // BY NAME (PLAN_NOT_DUE): 18,000 − 15,200 = 2,800 < 5,000.
      const notDue = await meters.recordReading({
        meterId: meter.id,
        value: "18000",
        effectiveDate: "2026-06-20",
        actorId: CM_ACTOR,
      });
      expect(notDue.evaluations[0]).toMatchObject({
        planId: plan.id,
        generated: false,
        skipReason: "PLAN_NOT_DUE",
      });

      // A DUE reading while the window is open skips BY NAME
      // (PLAN_WINDOW_OPEN — the report carries the skip, never an
      // exception): 20,300 − 15,200 = 5,100 ≥ 5,000.
      const windowOpen = await meters.recordReading({
        meterId: meter.id,
        value: "20300",
        effectiveDate: "2026-06-25",
        actorId: CM_ACTOR,
      });
      expect(windowOpen.evaluations[0]).toMatchObject({
        planId: plan.id,
        generated: false,
        skipReason: "PLAN_WINDOW_OPEN",
      });

      // The anchor NEVER moved past the generation's own stamp (the two
      // later readings armed nothing).
      const planRows2 = await requireTenantContext().tx!.execute<{ last_anchor_value: string }>(sql`
        SELECT last_anchor_value::text AS last_anchor_value FROM maintenance_plans
        WHERE id = ${plan.id}`);
      expectDec((planRows2.rows as unknown as { last_anchor_value: string }[])[0]!.last_anchor_value, "15200");
    });
  });

  it("the event evaluates ONLY the plans bound to the meter — a CALENDAR plan on the same asset is never touched", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshAsset("MTR-EVENT-CAL");
      const meter = await meters.createMeter({
        assetId: asset,
        name: "Odometer",
        type: "KM",
        unit: "km",
        actorId: CM_ACTOR,
      });
      const meterPlan = await plans.create({
        assetId: asset,
        name: "Meter windows",
        triggerType: "METER",
        meterId: meter.id,
        thresholdDelta: "5000",
        actorId: CM_ACTOR,
      });
      const calendarPlan = await plans.create({
        assetId: asset,
        name: "Calendar windows",
        triggerType: "CALENDAR",
        intervalDays: 30,
        nextDueDate: "2026-01-01",
        actorId: CM_ACTOR,
      });

      const result = await meters.recordReading({
        meterId: meter.id,
        value: "6000",
        effectiveDate: "2026-06-01",
        actorId: CM_ACTOR,
      });
      const evaluated = result.evaluations.map((verdict) => verdict.planId);
      expect(evaluated).toEqual([meterPlan.id]);
      expect(evaluated).not.toContain(calendarPlan.id);
      expect(result.evaluations[0]).toMatchObject({ generated: true });
    });
  });
});
