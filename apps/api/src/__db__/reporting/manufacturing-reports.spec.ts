import { beforeAll, describe, expect, it } from "vitest";

import { superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { TrackingService } from "../../modules/inventory/application/tracking-service";
import { ReservationService } from "../../modules/inventory/application/reservation-service";
import { ReservationPolicyService } from "../../modules/manufacturing/application/reservation-policy-service";
import { BomService } from "../../modules/manufacturing/application/bom-service";
import { ProductionOrderService } from "../../modules/manufacturing/application/production-order-service";
import { OperationExecutionService } from "../../modules/manufacturing/application/operation-execution-service";
import { ReworkService } from "../../modules/manufacturing/application/rework-service";
import { DowntimeService } from "../../modules/manufacturing/application/downtime-service";
import { StandardCostService } from "../../modules/manufacturing/application/standard-cost-service";
import { RoutingService } from "../../modules/manufacturing/application/routing-service";
import { WorkCenterService } from "../../modules/manufacturing/application/work-center-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { fullContext, newRunService } from "./fixtures";

/**
 * PHASE-042 T-14/T-15 — the four manufacturing-execution report contracts
 * over a dedicated, fully-journaled tenant R42 (the industry-018 pattern):
 *
 * - Work center R42-MIX (fixed 15 / var 25) with a two-op ACTIVE routing on
 *   R42-FG: op 10 (setup 1h, run 0.5h — center rates), op 20 (setup 0.5h,
 *   run 0.5h — overrides fixed 10 / var 30).
 * - Order A (planned 100, rates 0, std_unit_cost 10.000000): op 10 COMPLETED
 *   with 1h + 1h (G-40: DR WIP 80.0000 · CR LABOR 50.0000 · CR OVERHEAD
 *   30.0000), op 20 started then SKIPPED (SoD-approved), R42-M consumed
 *   5 @ 4 (DR WIP 20.0000), completed 50 → yield variance (100 − 50) × 10
 *   = 500.0000 (fgValue 100.0000 @ 2.000000/unit).
 * - Downtime: 30 closed minutes on R42-MIX today (record-only — the
 *   platform-default policy).
 * - Rework on Order A (qty 2 over the same routing — the time-weighted
 *   blend 12.857143/27.142857), completed 1h + 2h → G-41: labor 81.4286,
 *   overhead 38.5714, rework value 120.0000 (the blend reproduces the
 *   per-op cost exactly at 4dp).
 *
 * The OEE day then folds EXACTLY: planned 2.5h, actual 2.0h, downtime 30
 * minutes → availability 80.0000, performance 80.0000, quality 50.0000,
 * OEE 32.0000 — and every report narrows, denies, and stays tenant-scoped.
 */

/** Dedicated PHASE-042 reporting tenant (owns its book end to end). */
export const TENANT_R42 = "42424242-4242-4242-4242-424242424242";
/** The bare isolation-probe tenant (no book at all). */
const TENANT_R42_PROBE = "43434343-4343-4343-4343-434343434343";
/** The skip approver (BR-034 SoD: the actor never approves their own skip). */
const R42_APPROVER = "5b5b5b5b-0000-4000-8000-0000000005b1";
/** The reporting actor (R_ACTOR — the shared fixture user). */
const R42_ACTOR = "3f3f3f3f-0000-4000-8000-00000000003f";

const TODAY = () => new Date().toISOString().slice(0, 10);

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const periods = new PeriodService(audit);
const coa = new CoaService(audit);
const warehouses = new WarehouseService(audit);
const stock = new StockService(audit, posting);
const tracking = new TrackingService(audit, stock);
const boms = new BomService(audit);
const shopFloor = new OperationExecutionService(audit, posting);
const orders = new ProductionOrderService(
  audit,
  numbering,
  boms,
  posting,
  tracking,
  new InboxService(),
  new ResolveEffectiveConfigService(new ConfigRepository()),
  shopFloor,
  new ReservationPolicyService(audit, new ReservationService(audit)),
);
const workCenters = new WorkCenterService(audit);
const routingsSrv = new RoutingService(audit);
const rework = new ReworkService(audit, numbering, posting);
const downtime = new DowntimeService(audit, posting, new ResolveEffectiveConfigService(new ConfigRepository()));
const standardCosts = new StandardCostService(audit, posting);

interface R42Fixture {
  branchId: string;
  warehouseRawId: string;
  warehouseFgId: string;
  componentItemId: string;
  fgItemId: string;
  workCenterId: string;
  routingId: string;
  orderAId: string;
  orderANo: string | null;
  reworkNo: string | null;
}

let fixture: R42Fixture | undefined;

beforeAll(async () => {
  if (fixture !== undefined) return;
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant R42 (manufacturing reporting 042)', 'المستأجر ر-٤٢', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant R42-probe (empty)', 'المستأجر ر-٤٢-فارغ', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_R42, TENANT_R42_PROBE],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'reporting-actor@fixture.test', 'Reporting Actor', 'x', 'ACTIVE'),
            ($2, 'r42-approver@fixture.test', 'R42 Approver', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [R42_ACTOR, R42_APPROVER],
  );
  await su.end();

  fixture = await withTenant(TENANT_R42, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose, listBranches, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    const byCode = async (code: string) => {
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account;
    };
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await byCode(code);
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
      return account.id;
    };
    await mapPurpose("INVENTORY", "1140");
    await mapPurpose("WIP", "1160");
    await mapPurpose("PRODUCTION_SCRAP", "5120");
    await mapPurpose("PRODUCTION_LABOR", "5410");
    await mapPurpose("PRODUCTION_OVERHEAD", "5420");
    await mapPurpose("REWORK_EXPENSE", "5125");
    // The COUNT_GAIN seed path's counter leg (4920 — create-if-missing, the
    // R18 belt-and-braces).
    let appreciation = await findAccountByCode("4920");
    if (appreciation === undefined) {
      appreciation = await coa.create(R42_ACTOR, {
        code: "4920",
        name: "Inventory appreciation",
        nameAr: "زيادة قيمة المخزون",
        type: "REVENUE",
        parentId: (await byCode("4000")).id,
        currencyCode: null,
        isGroup: false,
      });
    }
    if ((await findActivePurpose("INVENTORY_APPRECIATION")) === undefined) {
      await insertAccountPurpose({
        purposeKey: "INVENTORY_APPRECIATION",
        accountId: appreciation.id,
        activeFrom: "2025-12-01",
      });
    }

    const year = TODAY().slice(0, 4);
    if ((await findFiscalYearByName(`FY${year}`)) === undefined) {
      await periods.createYear(R42_ACTOR, {
        name: `FY${year}`,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
      });
    }

    const branches = await listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    const existingWarehouses = await warehouses.list({ limit: 20, activeOnly: false });
    const rawStore =
      existingWarehouses.find((w) => w.code === "R42-RAW") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "R42-RAW",
        name: "R42 raw materials store",
        nameAr: "مخزن مواد ر-٤٢",
        inventoryAccountId: null,
        note: null,
        role: "RAW",
        actorId: R42_ACTOR,
      }));
    const fgStore =
      existingWarehouses.find((w) => w.code === "R42-FG") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "R42-FG",
        name: "R42 finished goods store",
        nameAr: "مخزن تام ر-٤٢",
        inventoryAccountId: null,
        note: null,
        role: "FG",
        actorId: R42_ACTOR,
      }));

    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, name: string, nameAr: string | null) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      return (
        await itemsStore.insertItem({
          sku,
          name,
          nameAr,
          kind: "STOCK",
          uomId: pcs.id,
          categoryId: null,
          taxCodeId: null,
          costingMethod: "WAC",
          trackBatch: true,
          trackSerial: false,
          trackImei: false,
          hasExpiry: true,
          shelfLifeDays: 60,
          reorderLevel: null,
          reorderQty: null,
          basePrice: null,
        })
      ).id;
    };
    const componentItemId = await ensureItem("R42-M", "R42 component", "مكوّن ر-٤٢");
    const fgItemId = await ensureItem("R42-FG", "R42 finished good", "منتج ر-٤٢");

    // The recipe: component 0.05 per output, yield 100 (plan for 100 → 5).
    if ((await boms.list({ itemId: fgItemId, limit: 5 })).length === 0) {
      const draft = await boms.create({
        itemId: fgItemId,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: "R42-FG v1",
        noteAr: null,
        actorId: R42_ACTOR,
        lines: [{ componentItemId, qtyPerOutput: "0.050000", scrapPct: "0" }],
      });
      await boms.activate(draft.id, { effectiveFrom: "2026-01-01", actorId: R42_ACTOR });
    }

    // The frozen per-unit standard: total 10.000000.
    if ((await standardCosts.getActive(fgItemId)) === null) {
      const draft = await standardCosts.createDraft({
        itemId: fgItemId,
        materialCost: "10",
        laborCost: "0",
        overheadCost: "0",
        overheadSubSplits: null,
        effectiveFrom: null,
        note: "R42-FG standard v1",
        noteAr: null,
        actorId: R42_ACTOR,
      });
      await standardCosts.activate(draft.id, { actorId: R42_ACTOR });
    }

    // Component stock: 50 @ 4 (one batch, FEFO trivial).
    await stock.manualReceipt({
      itemId: componentItemId,
      warehouseId: rawStore.id,
      qty: "50",
      unitCost: "4.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: TODAY(),
      batchNo: "R42-M1",
      batchExpiry: "2027-06-30",
      actorId: R42_ACTOR,
    });

    // The work center + the two-op ACTIVE routing.
    const centers = await workCenters.list({ limit: 20 });
    const center =
      centers.find((row) => row.code === "R42-MIX") ??
      (await workCenters.create({
        code: "R42-MIX",
        name: "R42 mixer",
        nameAr: "خلاط ر-٤٢",
        description: null,
        capacityPerShift: "8",
        shiftsPerDay: 2,
        fixedCostRate: "15.000000",
        varCostRate: "25.000000",
        costCenterId: null,
        actorId: R42_ACTOR,
      }));
    let routingId = (await (await import("../../modules/manufacturing/infrastructure/manufacturing.store")).findActiveRouting(fgItemId))?.id ?? "";
    if (routingId === "") {
      const draft = await routingsSrv.createDraft({
        itemId: fgItemId,
        outputUomId: pcs.id,
        note: "R42-FG routing v1",
        noteAr: null,
        actorId: R42_ACTOR,
        operations: [
          {
            sequence: 10,
            workCenterId: center.id,
            setupTime: "1.000000",
            runTime: "0.500000",
            fixedCostRate: null,
            varCostRate: null,
            description: "Mix",
            descriptionAr: "خلط",
          },
          {
            sequence: 20,
            workCenterId: center.id,
            setupTime: "0.500000",
            runTime: "0.500000",
            fixedCostRate: "10.000000",
            varCostRate: "30.000000",
            description: "Bake",
            descriptionAr: "خبز",
          },
        ],
      });
      routingId = (await routingsSrv.activate(draft.id, { actorId: R42_ACTOR })).id;
    }

    // Order A: the full execution chain (auto-binds the ACTIVE routing +
    // stamps std_unit_cost 10.000000).
    const order = await orders.create({
      branchId: mainBranch.id,
      itemId: fgItemId,
      bomId: null,
      plannedQty: "100",
      plannedDate: null,
      materialsWarehouseId: rawStore.id,
      fgWarehouseId: fgStore.id,
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: "R42 order A (reports book)",
      noteAr: null,
      actorId: R42_ACTOR,
    });
    await orders.release(order.id, R42_ACTOR);
    await orders.start(order.id, R42_ACTOR);
    await shopFloor.startOp(order.id, 10, R42_ACTOR);
    await shopFloor.completeOp(order.id, 10, {
      actualSetupTime: "1",
      actualRunTime: "1",
      scrapQty: null,
      scrapReasonCode: null,
      actorId: R42_ACTOR,
    });
    await shopFloor.startOp(order.id, 20, R42_ACTOR);
    await shopFloor.skipOp(order.id, 20, {
      reason: "oven maintenance window — batch released after mixing",
      approvedBy: R42_APPROVER,
      actorId: R42_ACTOR,
    });
    await orders.consume(order.id, {
      lines: [{ itemId: componentItemId, qty: "5", batchId: null }],
      consumedAt: TODAY(),
      note: "R42 order A consumption",
      noteAr: null,
      actorId: R42_ACTOR,
    });
    const done = await orders.complete(order.id, {
      actualQty: "50",
      batchNo: null,
      completedAt: TODAY(),
      actorId: R42_ACTOR,
    });

    // The rework over the completed parent (the blend 12.857143/27.142857;
    // completion 1h + 2h → 81.4286 / 38.5714 / 120.0000).
    const reworkOrder = await rework.create({
      parentOrderId: done.order.id,
      batchId: null,
      defectRef: "DEF-R42-001",
      qty: "2",
      routingId,
      defectReasonCode: "COSMETIC",
      note: "R42 rework (reports book)",
      noteAr: null,
      actorId: R42_ACTOR,
    });
    await rework.release(reworkOrder.id, R42_ACTOR);
    await rework.start(reworkOrder.id, R42_ACTOR);
    const reworkDone = await rework.complete(reworkOrder.id, {
      actualSetupTime: "1",
      actualRunTime: "2",
      actorId: R42_ACTOR,
    });

    // The 30 closed downtime minutes (record-only — the default policy).
    await downtime.log({
      workCenterId: center.id,
      reasonCode: "BREAKDOWN",
      startedAt: `${TODAY()}T08:00:00Z`,
      durationMinutes: 30,
      endedAt: `${TODAY()}T08:30:00Z`,
      orderId: null,
      operationSequence: null,
      note: "the OEE availability input",
      actorId: R42_ACTOR,
    });

    return {
      branchId: mainBranch.id,
      warehouseRawId: rawStore.id,
      warehouseFgId: fgStore.id,
      componentItemId,
      fgItemId,
      workCenterId: center.id,
      routingId,
      orderAId: done.order.id,
      orderANo: done.order.orderNo,
      reworkNo: reworkDone.rework.reworkNo,
    };
  });
});

// -- helpers ---------------------------------------------------------------------

function runReport(reportKey: string, params: Record<string, unknown>) {
  return withTenant(TENANT_R42, () =>
    newRunService().run({
      reportKey,
      params: { locale: "en", ...params },
      ctx: fullContext(TENANT_R42),
    }),
  );
}

const WINDOW = () => ({ dateFrom: TODAY(), dateTo: TODAY() });

// -- the packs --------------------------------------------------------------------

describe("PHASE-042 · the four manufacturing-execution report contracts (registry rows 92–95)", () => {
  it("manufacturing.work-center-utilization renders the seeded day with the exact OEE legs", async () => {
    const outcome = await runReport("manufacturing.work-center-utilization", { ...WINDOW() });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    const row = result.rows.find((entry) => entry.key === `${fixture!.workCenterId}:${TODAY()}`);
    expect(row, `expected today's row for the R42 center among ${result.rows.map((r) => r.key)}`).toBeDefined();
    expect(row!.values).toMatchObject({
      code: "R42-MIX",
      name: "R42 mixer",
      day: TODAY(),
      plannedHours: "2.500000",
      actualHours: "2.000000",
      downtimeMinutes: "30",
      completedOperations: "1",
      skippedOperations: "1",
      availabilityPct: "80.0000", // (150 − 30) / 150 × 100
      performancePct: "80.0000", // 2.0 / 2.5 × 100
      qualityPct: "50.0000", // 1 / 2 × 100
      oeePct: "32.0000", // 80 × 80 × 50 / 10000
    });
    const availability = result.assertions.find((assertion) => assertion.id === "oee-availability-window");
    const legsShape = result.assertions.find((assertion) => assertion.id === "oee-legs-shape");
    expect(availability?.status).toBe("PASS");
    expect(legsShape?.status).toBe("PASS");
  });

  it("the workCenterId filter narrows to the requested center; a foreign uuid and an out-of-window range return nothing", async () => {
    const narrowed = await runReport("manufacturing.work-center-utilization", {
      ...WINDOW(),
      workCenterId: fixture!.workCenterId,
    });
    expect(narrowed.result!.rows.map((row) => row.values.code)).toEqual(["R42-MIX"]);
    const foreign = await runReport("manufacturing.work-center-utilization", {
      ...WINDOW(),
      workCenterId: "11111111-2222-4333-8444-555555555555",
    });
    expect(foreign.result!.rows).toHaveLength(0);
    const excluded = await runReport("manufacturing.work-center-utilization", {
      dateFrom: "2020-01-01",
      dateTo: "2020-12-31",
    });
    expect(excluded.result!.rows).toHaveLength(0);
  });

  it("a session without manufacturing.oee.read is denied before params bind (both OEE contracts)", async () => {
    const deniedCtx = fullContext(TENANT_R42, {
      permissions: new Set(["reporting.reports.run", "manufacturing.costing.read"]),
    });
    for (const reportKey of [
      "manufacturing.work-center-utilization",
      "manufacturing.downtime-analysis",
    ]) {
      await expect(
        withTenant(TENANT_R42, () =>
          newRunService().run({
            reportKey,
            params: { ...WINDOW(), locale: "en" },
            ctx: deniedCtx,
          }),
        ),
      ).rejects.toThrowError(PermissionDeniedError);
    }
  });

  it("manufacturing.downtime-analysis groups by (center, reason) — minutes, records, and the record-only cost", async () => {
    const outcome = await runReport("manufacturing.downtime-analysis", { ...WINDOW() });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.values).toMatchObject({
      code: "R42-MIX",
      reasonCode: "BREAKDOWN",
      records: "1",
      minutes: "30",
      costAmount: "0.0000", // the default policy closes record-only
      costedRecords: "0",
    });
    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("downtime-minutes-total")).toBe("30.0000");
    expect(totals.get("downtime-cost-total")).toBe("0.0000");
    const shape = result.assertions.find((assertion) => assertion.id === "downtime-window-shape");
    expect(shape?.status).toBe("PASS");
    // The window excludes: 2020 sees nothing.
    const excluded = await runReport("manufacturing.downtime-analysis", {
      dateFrom: "2020-01-01",
      dateTo: "2020-12-31",
    });
    expect(excluded.result!.rows).toHaveLength(0);
  });

  it("manufacturing.rework-cost renders the register row (RW- number, parent PRD number, defect ref, exact G-41 legs)", async () => {
    const outcome = await runReport("manufacturing.rework-cost", { ...WINDOW() });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.values).toMatchObject({
      reworkNo: fixture!.reworkNo,
      parentOrderNo: fixture!.orderANo,
      itemSku: "R42-FG",
      defectRef: "DEF-R42-001",
      qty: "2.000000",
      status: "COMPLETED",
      laborValue: "81.4286", // 3h × the blended var 27.142857
      overheadValue: "38.5714", // 3h × the blended fixed 12.857143
      reworkValue: "120.0000",
    });
    const valueShape = result.assertions.find((assertion) => assertion.id === "rework-value-shape");
    expect(valueShape?.status).toBe("PASS");
    // An out-of-window range excludes the rework (created today).
    const excluded = await runReport("manufacturing.rework-cost", {
      dateFrom: "2020-01-01",
      dateTo: "2020-12-31",
    });
    expect(excluded.result!.rows).toHaveLength(0);
  });

  it("manufacturing.rework-cost totals are the exact 4dp sums of the money columns", async () => {
    const outcome = await runReport("manufacturing.rework-cost", { ...WINDOW() });
    const totals = new Map(outcome.result!.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("rework-labor-total")).toBe("81.4286");
    expect(totals.get("rework-overhead-total")).toBe("38.5714");
    expect(totals.get("rework-value-total")).toBe("120.0000");
  });

  it("manufacturing.cost-variance rolls the order's operation folds + the order-level yield variance", async () => {
    const outcome = await runReport("manufacturing.cost-variance", { ...WINDOW() });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    const row = result.rows.find((entry) => entry.values.orderNo === fixture!.orderANo);
    expect(row, `expected order A's variance row among ${result.rows.map((r) => r.key)}`).toBeDefined();
    expect(row!.values).toMatchObject({
      itemSku: "R42-FG",
      status: "COMPLETED",
      setupVariance: "0.0000", // actual setup 1 == std setup 1
      usageVariance: "-1225.0000", // (1 − 0.5 × 100) × 25 at op completion
      rateVariance: "0.0000",
      yieldVariance: "500.0000", // (100 − 50) × std 10
      operations: "2",
    });
    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("setup-variance-total")).toBe("0.0000");
    expect(totals.get("usage-variance-total")).toBe("-1225.0000");
    expect(totals.get("rate-variance-total")).toBe("0.0000");
    expect(totals.get("yield-variance-total")).toBe("500.0000");
    const shape = result.assertions.find((assertion) => assertion.id === "variance-decimal-shape");
    expect(shape?.status).toBe("PASS");
  });

  it("the itemId filter narrows cost-variance; a session without manufacturing.costing.read is denied", async () => {
    const narrowed = await runReport("manufacturing.cost-variance", {
      ...WINDOW(),
      itemId: fixture!.fgItemId,
    });
    expect(narrowed.result!.rows.map((row) => row.values.itemSku)).toEqual(["R42-FG"]);
    const foreign = await runReport("manufacturing.cost-variance", {
      ...WINDOW(),
      itemId: fixture!.componentItemId,
    });
    expect(foreign.result!.rows).toHaveLength(0); // the component has no completed order
    const deniedCtx = fullContext(TENANT_R42, {
      permissions: new Set(["reporting.reports.run", "manufacturing.oee.read"]),
    });
    await expect(
      withTenant(TENANT_R42, () =>
        newRunService().run({
          reportKey: "manufacturing.cost-variance",
          params: { ...WINDOW(), locale: "en" },
          ctx: deniedCtx,
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
  });

  it("tenant isolation — the empty probe tenant sees zero rows on every contract (RLS through the views and tables)", async () => {
    for (const reportKey of [
      "manufacturing.work-center-utilization",
      "manufacturing.downtime-analysis",
      "manufacturing.rework-cost",
      "manufacturing.cost-variance",
    ]) {
      const outcome = await withTenant(TENANT_R42_PROBE, () =>
        newRunService().run({
          reportKey,
          params: { ...WINDOW(), locale: "en" },
          ctx: fullContext(TENANT_R42_PROBE),
        }),
      );
      expect(outcome.status, reportKey).toBe("SUCCEEDED");
      expect(outcome.result!.rows, reportKey).toHaveLength(0);
    }
  });
});
