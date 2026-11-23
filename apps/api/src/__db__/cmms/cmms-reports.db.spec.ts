import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { MaintenanceWorkOrderService } from "../../modules/fixed_assets/application/maintenance-work-order-service";
import { MaintenancePlanService } from "../../modules/fixed_assets/application/maintenance-plan-service";
import { AssetMetersService } from "../../modules/fixed_assets/application/asset-meters-service";
import { AssetExpirySweepService } from "../../modules/fixed_assets/application/asset-expiry-sweep-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import { registrySnapshot } from "../../modules/reporting/registry/runtime";
import { REPORT_CONTRACTS } from "../../modules/reporting/registry";
import { ALL_KNOWN_PERMISSIONS, fullContext, newRunService } from "../reporting/fixtures";
import { superuserClient } from "../test-db";
import {
  CM_ACTOR,
  TENANT_CMMS,
  TENANT_CMMS_RLS,
  ensureCmmsG59World,
  freshAsset,
  freshPartsWorld,
  type CmmsG59World,
} from "./fixtures";

/**
 * PHASE-049 (W-22 — T-16, dated 2026-11-22) · `cmms-reports.db.spec` —
 * the four CMMS report contracts over the real engines (the
 * projects-reports pattern, the talent-reports precedent): every arm
 * runs the contract through the REAL RunService on the CMMS world and
 * pins THE ENGINE-VERBATIM LAW (zero parallel computation — every
 * rendered figure re-checked against the engine's own direct output),
 * the INV-034 live tie's PASS/FAIL posture (the poisoned own world —
 * a real one-penny adjustment entry the source lines cannot explain),
 * the backlog's honest shape (the DB-derived day counts, the completed
 * orders never entering), the readings log's shape, the fleet
 * register's single binding, the deny paths (one per contract), the
 * tenant-isolation floor, and the registry's own four rows.
 *
 * The worlds (the per-arm-world law): RP-COST (the coherent completed
 * order — labor 2.5h × 480 + parts 20 × 40 + external 500 = 2,500) ·
 * RP-POISON (the INV-034 failure world — a completed order at 100 +
 * ONE real maintenance-sourced penny) · RP-BACKLOG (the overdue plan
 * + the future plan + the inactive plan + the aged open order) ·
 * RP-METERS (the hours meter with the three sources' readings) ·
 * RP-FLEET (the four chips + the designated KM odometer).
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const orders = new MaintenanceWorkOrderService(audit, posting, numbering);
const plans = new MaintenancePlanService(audit, numbering);
const meters = new AssetMetersService(audit, plans);
const sweep = new AssetExpirySweepService(audit, new InboxService());

let world: CmmsG59World;
/** The spec's OWN parts world (the per-arm-world law — never the W-17
 * spec's shared stock). */
let parts: { itemId: string; warehouseId: string };
let dbToday = "";
let costAssetId = "";
let costOrderId = "";
let poisonAssetId = "";
let poisonOrderNo = "";
let backlogAssetId = "";
let backlogOrderId = "";
let backlogOrderNo = "";
const backlogPlanName = "RP-BACKLOG overdue plan";
const futurePlanName = "RP-BACKLOG future plan";
const inactivePlanName = "RP-BACKLOG inactive plan";
let metersAssetId = "";
let hoursMeterId = "";
let fleetAssetId = "";
let fleetCode = "";

function expectDec(actual: string | null | undefined, expected: string): void {
  expect(actual === null || actual === undefined ? null : new Decimal(actual).toString()).toBe(
    new Decimal(expected).toString(),
  );
}

/** Run one report contract through the REAL RunService. */
async function runReport(reportKey: string, params: Record<string, unknown>) {
  const outcome = await withTenant(TENANT_CMMS, () =>
    newRunService().run({
      reportKey,
      params,
      ctx: fullContext(TENANT_CMMS),
    }),
  );
  expect(outcome.status).toBe("SUCCEEDED");
  return outcome.result!;
}

/** The full legal walk to IN_PROGRESS on a fresh asset. */
async function startOrder(assetId: string, problem: string): Promise<string> {
  const created = await orders.create({ assetId, problem, actorId: CM_ACTOR });
  await orders.plan(created.id, CM_ACTOR);
  await orders.start(created.id, CM_ACTOR);
  return created.id;
}

beforeAll(async () => {
  world = await ensureCmmsG59World();
  parts = await freshPartsWorld("RP");
  const tx0 = await withTenant(TENANT_CMMS, async () =>
    requireTenantContext().tx!.execute<{ today: string }>(sql`SELECT CURRENT_DATE::text AS today`),
  );
  dbToday = tx0.rows[0]!.today;
  const pastDue = new Date(Date.parse(`${dbToday}T00:00:00Z`) - 45 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const futureDue = new Date(Date.parse(`${dbToday}T00:00:00Z`) + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // ── RP-COST: the coherent completed order (D-04's worked example) ──
  await withTenant(TENANT_CMMS, async () => {
    costAssetId = await freshAsset("RP-COST");
    costOrderId = await startOrder(costAssetId, "The reports coherent world");
    await orders.addLine({
      workOrderId: costOrderId,
      legType: "LABOR",
      employeeId: world.technicianEmployeeId,
      hours: "2.5",
      unitRate: "480",
      actorId: CM_ACTOR,
    });
    await orders.addLine({
      workOrderId: costOrderId,
      legType: "PARTS",
      itemId: parts.itemId,
      warehouseId: parts.warehouseId,
      qty: "20",
      actorId: CM_ACTOR,
    });
    await orders.addLine({
      workOrderId: costOrderId,
      legType: "EXTERNAL",
      partnerId: world.supplierPartnerId,
      amount: "500",
      description: "Calibration",
      actorId: CM_ACTOR,
    });
    const done = await orders.complete({
      workOrderId: costOrderId,
      solution: "Serviced",
      actorId: CM_ACTOR,
    });
    expect(done.reconciliation.balanced).toBe(true);
  });

  // ── RP-POISON: the INV-034 failure world — a completed order at 100
  // + ONE real maintenance-sourced penny the source lines cannot
  // explain (a manual adjustment entry through the REAL engine, the
  // INV-033 poisoned-penny shape). ──
  await withTenant(TENANT_CMMS, async () => {
    poisonAssetId = await freshAsset("RP-POISON");
    const orderId = await startOrder(poisonAssetId, "The INV-034 failure world");
    await orders.addLine({
      workOrderId: orderId,
      legType: "EXTERNAL",
      partnerId: world.supplierPartnerId,
      amount: "100",
      description: "Bill",
      actorId: CM_ACTOR,
    });
    const done = await orders.complete({ workOrderId: orderId, actorId: CM_ACTOR });
    poisonOrderNo = done.order.orderNo;

    // THE PENNY — a real adjustment entry sourced to the same order
    // (a different operation → a different INV-013 source key; the GL
    // dimension now says 100.01 while the order's own legs say 100).
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const expense = await tenancy.findActivePurpose("MAINTENANCE_EXPENSE");
    const accrual = await tenancy.findActivePurpose("EXTERNAL_ACCRUAL");
    expect(expense).toBeDefined();
    expect(accrual).toBeDefined();
    await posting.post(
      {
        source: { docType: "maintenance_work_order", docId: orderId, operation: "adjust" },
        entryDate: dbToday,
        description: {
          en: `Work order ${done.order.orderNo} — the INV-034 probe penny`,
          ar: `أمر صيانة ${done.order.orderNo} — قرش فحص INV-034`,
        },
        currency: "SAR",
        lines: [
          {
            accountId: expense!.accountId,
            direction: "DEBIT",
            amount: "0.01",
          },
          {
            accountId: accrual!.accountId,
            direction: "CREDIT",
            amount: "0.01",
          },
        ],
      },
      { postedBy: CM_ACTOR },
    );
  });

  // ── RP-BACKLOG: the overdue plan + the future plan + the inactive
  // plan + the aged open order ──
  await withTenant(TENANT_CMMS, async () => {
    backlogAssetId = await freshAsset("RP-BACKLOG");
    await plans.create({
      assetId: backlogAssetId,
      name: backlogPlanName,
      triggerType: "CALENDAR",
      intervalDays: 30,
      nextDueDate: pastDue,
      actorId: CM_ACTOR,
    });
    await plans.create({
      assetId: backlogAssetId,
      name: futurePlanName,
      triggerType: "CALENDAR",
      intervalDays: 30,
      nextDueDate: futureDue,
      actorId: CM_ACTOR,
    });
    const inactive = await plans.create({
      assetId: backlogAssetId,
      name: inactivePlanName,
      triggerType: "CALENDAR",
      intervalDays: 30,
      nextDueDate: pastDue,
      actorId: CM_ACTOR,
    });
    await plans.patch({ planId: inactive.id, isActive: false, actorId: CM_ACTOR });

    const created = await orders.create({
      assetId: backlogAssetId,
      problem: "The aged open order",
      actorId: CM_ACTOR,
    });
    backlogOrderNo = created.orderNo;
    backlogOrderId = created.id;
  });
  // Age it 10 days — AFTER the withTenant block committed (the
  // superuser connection cannot see an uncommitted withTenant row —
  // the W-19 audit-visibility lesson; the spec-owned row's own stamp,
  // the backdateStamps precedent).
  {
    const su = await superuserClient();
    const updated = await su.query(
      `UPDATE maintenance_work_orders SET created_at = now() - interval '10 days' WHERE id = $1`,
      [backlogOrderId],
    );
    expect(updated.rowCount).toBe(1);
    await su.end();
  }

  // ── RP-METERS: the hours meter + the three sources' readings (the
  // JOB reading linked to the coherent world's order) ──
  await withTenant(TENANT_CMMS, async () => {
    metersAssetId = await freshAsset("RP-METERS");
    const meter = await meters.createMeter({
      assetId: metersAssetId,
      name: "Engine hours",
      type: "HOURS",
      unit: "h",
      actorId: CM_ACTOR,
    });
    hoursMeterId = meter.id;
    await meters.recordReading({
      meterId: meter.id,
      value: "1000",
      effectiveDate: "2026-01-10",
      source: "MANUAL",
      actorId: CM_ACTOR,
    });
    await meters.recordReading({
      meterId: meter.id,
      value: "1040",
      effectiveDate: "2026-02-10",
      source: "IMPORT",
      actorId: CM_ACTOR,
    });
    await meters.recordReading({
      meterId: meter.id,
      value: "1060",
      effectiveDate: "2026-03-10",
      source: "JOB",
      workOrderId: costOrderId,
      actorId: CM_ACTOR,
    });
  });

  // ── RP-FLEET: the four chips + the designated KM odometer ──
  fleetAssetId = await freshAsset("RP-FLEET");
  fleetCode = "RP-FLEET";
  {
    const su = await superuserClient();
    await su.query(
      `UPDATE assets SET warranty_expiry = CURRENT_DATE + 60,
         insurance_expiry = CURRENT_DATE + 20, license_expiry = CURRENT_DATE + 5,
         inspection_expiry = CURRENT_DATE + 400
       WHERE tenant_id = $1 AND id = $2`,
      [TENANT_CMMS, fleetAssetId],
    );
    await su.end();
  }
  await withTenant(TENANT_CMMS, async () => {
    const odometer = await meters.createMeter({
      assetId: fleetAssetId,
      name: "Odometer",
      type: "KM",
      unit: "km",
      isOdometer: true,
      actorId: CM_ACTOR,
    });
    await meters.recordReading({
      meterId: odometer.id,
      value: "125000",
      effectiveDate: "2026-03-01",
      source: "MANUAL",
      actorId: CM_ACTOR,
    });
  });
});

describe("PHASE-049 W-22 — T-16: the four CMMS report contracts (the engine-verbatim law)", () => {
  it("(a) assets.maintenance-costs: the engine's own figures verbatim + the live INV-034 tie PASS", async () => {
    // The engine's own direct output (the verbatim reference).
    const engineRows = await withTenant(TENANT_CMMS, () =>
      orders.list({ assetId: costAssetId }),
    );
    expect(engineRows).toHaveLength(1);
    const report = await runReport("assets.maintenance-costs", {
      assetId: costAssetId,
      locale: "en",
    });

    expect(report.rows).toHaveLength(1);
    const row = report.rows[0]!;
    expect(row.values.orderNo).toBe(engineRows[0]!.orderNo);
    expect(row.values.labor).toBe(engineRows[0]!.laborTotal);
    expect(row.values.parts).toBe(engineRows[0]!.partsTotal);
    expect(row.values.external).toBe(engineRows[0]!.externalTotal);
    // The asset brief (the store's own card read).
    expect((row.values.asset as string).startsWith("RP-COST ·")).toBe(true);

    // The totals are the row's own sums (zero parallel computation).
    const totals = new Map(report.totals.map((total) => [total.id, total.amount]));
    expectDec(totals.get("laborTotal")!, "1200");
    expectDec(totals.get("partsTotal")!, "800");
    expectDec(totals.get("externalTotal")!, "500");
    expectDec(totals.get("grandTotal")!, "2500");
    expect(row.values.journal).toBe("مرحّل / posted");

    // The live INV-034 tie PASSes on the coherent world: the GL
    // witness equals the order's own source total.
    const tie = report.assertions.find((assertion) => assertion.id === "inv034-expense-tie");
    expect(tie?.status).toBe("PASS");
  });

  it("(b) assets.maintenance-costs: the INV-034 penny FAILS the tie and blocks the export (the poisoned own world)", async () => {
    const report = await runReport("assets.maintenance-costs", {
      assetId: poisonAssetId,
      locale: "en",
    });
    // The run SUCCEEDED (the assertion governs the EXPORT, not the run)
    // — and the tie carries the drifted figures in `compared`.
    expect(report.rows).toHaveLength(1);
    const tie = report.assertions.find((assertion) => assertion.id === "inv034-expense-tie");
    expect(tie?.status).toBe("FAIL");
    expect(tie?.compared).toEqual({ left: "100.0000", right: "100.0100" });
    expect(tie?.detail?.en).toContain(poisonOrderNo);
    expect(tie?.detail?.en).toContain("100.0100");
  });

  it("(c) assets.maintenance-backlog: the honest two sections with the DB-derived days — the completed never enter", async () => {
    const report = await runReport("assets.maintenance-backlog", { locale: "en" });

    // The overdue plan is present with its DB-derived days (45 ± 1 for
    // the seeded date's day boundary — the DB's own arithmetic).
    const planRow = report.rows.find((row) => row.values.ref === backlogPlanName);
    expect(planRow).toBeDefined();
    expect(planRow!.groupKey).toBe("overdue-plans");
    expect(Number(planRow!.values.days)).toBeGreaterThanOrEqual(44);
    expect(Number(planRow!.values.days)).toBeLessThanOrEqual(46);

    // The future plan and the inactive plan NEVER enter.
    expect(report.rows.find((row) => row.values.ref === futurePlanName)).toBeUndefined();
    expect(report.rows.find((row) => row.values.ref === inactivePlanName)).toBeUndefined();

    // The aged open order is present with its ~10-day age.
    const orderRow = report.rows.find((row) => row.values.ref === backlogOrderNo);
    expect(orderRow).toBeDefined();
    expect(orderRow!.groupKey).toBe("open-orders");
    expect(Number(orderRow!.values.days)).toBeGreaterThanOrEqual(9);
    expect(Number(orderRow!.values.days)).toBeLessThanOrEqual(11);

    // A COMPLETED order NEVER enters the backlog (the coherent world's
    // own order is completed and absent).
    const completedNos = new Set(
      (await withTenant(TENANT_CMMS, () => orders.list({ status: "COMPLETED" }))).map(
        (order) => order.orderNo,
      ),
    );
    for (const row of report.rows) {
      if (row.groupKey === "open-orders") {
        expect(completedNos.has(row.values.ref as string)).toBe(false);
      }
    }

    // The honest-shape assertion PASSes for the whole register.
    const shape = report.assertions.find((assertion) => assertion.id === "backlog-honest-shape");
    expect(shape?.status).toBe("PASS");
    // The DB-date anchor is declared in the totals.
    const anchor = report.totals.find((total) => total.id === "asOf");
    expect(anchor?.amount).toBe(dbToday);
  });

  it("(d) assets.meter-readings: the engine's log verbatim + the source vocabulary + the JOB link", async () => {
    // The engine's own direct output (the verbatim reference).
    const engineReadings = await withTenant(TENANT_CMMS, () => meters.listReadings(hoursMeterId));
    expect(engineReadings).toHaveLength(3);
    const report = await runReport("assets.meter-readings", {
      assetId: metersAssetId,
      locale: "en",
    });

    expect(report.rows).toHaveLength(3);
    const byDate = new Map(report.rows.map((row) => [row.values.effectiveDate as string, row]));
    expect(byDate.get("2026-01-10")?.values.source).toBe("MANUAL");
    expect(byDate.get("2026-02-10")?.values.source).toBe("IMPORT");
    const job = byDate.get("2026-03-10");
    expect(job?.values.source).toBe("JOB");
    expect(job?.values.workOrder).toBe("JOB");
    for (const reading of engineReadings) {
      const row = byDate.get(reading.effectiveDate);
      expect(row?.values.value).toBe(reading.value);
    }

    // The meter's own snapshot rides the group subtotal (the engine's
    // full-scale numeric string, verbatim).
    const group = report.groups.find((entry) => entry.key === hoursMeterId);
    expectDec(group?.subtotal?.value, "1060");
    // The shape check PASSes.
    const shape = report.assertions.find((assertion) => assertion.id === "readings-log-shape");
    expect(shape?.status).toBe("PASS");
  });

  it("(e) assets.expiry-register: R-10's engine read verbatim + the single odometer binding", async () => {
    // The engine's own direct output (the verbatim reference).
    const engineRows = await withTenant(TENANT_CMMS, () => sweep.fleetLight({}));
    const engineFleet = engineRows.find((row) => row.code === fleetCode);
    expect(engineFleet).toBeDefined();
    const report = await runReport("assets.expiry-register", { locale: "en" });

    const row = report.rows.find((entry) => entry.key === fleetAssetId);
    expect(row).toBeDefined();
    // The four chips with the DB-derived days (the engine's own
    // integers verbatim — 60/20/5/400 from the seeding).
    expect(row!.values.warranty).toBe(`${engineFleet!.warrantyExpiry} (60d)`);
    expect(row!.values.insurance).toBe(`${engineFleet!.insuranceExpiry} (20d)`);
    expect(row!.values.license).toBe(`${engineFleet!.licenseExpiry} (5d)`);
    expect(row!.values.inspection).toBe(`${engineFleet!.inspectionExpiry} (400d)`);
    // The odometer binding — the designated KM meter's own snapshot.
    expect(row!.values.odometer).toContain("125000");

    // The single-binding law PASSes (every asset exactly once).
    const binding = report.assertions.find(
      (assertion) => assertion.id === "fleet-odometer-single-binding",
    );
    expect(binding?.status).toBe("PASS");
    const keys = report.rows.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("(f) the deny paths: sessions without the module key are denied before params bind (one per contract)", async () => {
    const cases: Array<[string, string]> = [
      ["assets.maintenance-costs", "assets.maintenance.view"],
      ["assets.maintenance-backlog", "assets.maintenance.view"],
      ["assets.meter-readings", "assets.meters.view"],
      ["assets.expiry-register", "assets.expiry.view"],
    ];
    for (const [reportKey, key] of cases) {
      const denied = new Set([...ALL_KNOWN_PERMISSIONS].filter((entry) => entry !== key));
      const ctx = fullContext(TENANT_CMMS, { permissions: denied });
      await expect(
        withTenant(TENANT_CMMS, () =>
          newRunService().run({ reportKey, params: { locale: "en" }, ctx }),
        ),
      ).rejects.toThrowError(PermissionDeniedError);
    }
  });

  it("(g) the reports stay tenant-scoped (the isolation floor — the empty boundary tenant reads zero rows)", async () => {
    for (const [reportKey, params] of [
      ["assets.maintenance-costs", { locale: "en" }],
      ["assets.maintenance-backlog", { locale: "en" }],
      ["assets.meter-readings", { locale: "en" }],
      ["assets.expiry-register", { locale: "en" }],
    ] as const) {
      const outcome = await withTenant(TENANT_CMMS_RLS, () =>
        newRunService().run({
          reportKey,
          params: { ...params },
          ctx: fullContext(TENANT_CMMS_RLS),
        }),
      );
      expect(outcome.status).toBe("SUCCEEDED");
      expect(outcome.result!.rows).toHaveLength(0);
    }
  });

  it("(h) the registry carries the four rows on the module's own keys (the §12 convention)", () => {
    const snapshot = registrySnapshot([...REPORT_CONTRACTS]);
    expect(snapshot).toHaveLength(122); // PHASE-050 (W-30, T-17, dated 2026-11-23): 118 → 122 (+4 quality: ncr-register, capa-status, calibration-due, complaints-summary); PHASE-049 (W-22, T-16, dated 2026-11-22): 114 → 118 (+4 cmms: maintenance-costs, maintenance-backlog, meter-readings, expiry-register)
    const byId = new Map(snapshot.map((row) => [row.id, row]));
    expect(byId.get("assets.maintenance-costs")?.requiredPermission).toBe("assets.maintenance.view");
    expect(byId.get("assets.maintenance-backlog")?.requiredPermission).toBe("assets.maintenance.view");
    expect(byId.get("assets.meter-readings")?.requiredPermission).toBe("assets.meters.view");
    expect(byId.get("assets.expiry-register")?.requiredPermission).toBe("assets.expiry.view");
    // The bilingual titles (registry-bilingual, never dictionary keys).
    expect(byId.get("assets.maintenance-costs")?.title.ar).toBe("تكاليف الصيانة");
    expect(byId.get("assets.maintenance-costs")?.title.en).toBe("Maintenance Costs");
  });
});
