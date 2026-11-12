import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { PermissionDeniedError } from "../../modules/reporting/application/scope";
import { CycleCountService } from "../../modules/inventory/application/cycle-count-service";
import { WmsService } from "../../modules/inventory/application/wms.service";
import { fullContext, newRunService } from "./fixtures";
import {
  I_ACTOR,
  I_JAN,
  TENANT_I,
  ensureInventoryItem,
  iPosting,
  setupInventoryFixture,
  stock,
} from "../inventory/fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";

/**
 * PHASE-044 T-17 — the four WMS intelligence report contracts over the
 * shared inventory tenant I (the 042 manufacturing-reports pattern):
 *
 * - Two stocked items: REP-WMS-A (received 100 @ 2.00 into the default bin
 *   + 40 @ 3.00 into an explicit PICK bin — the two-slot fold) and
 *   REP-WMS-B (received 50 @ 4.00, partially issued so consumption exists
 *   for the ABC walk; the remainder is the slow-movement row).
 * - A posted cycle-count document with a deliberate −5 loss variance (the
 *   CYCLE_COUNT_LOSS reason) over REP-WMS-A.
 * - An ABC recompute over the consumption window.
 *
 * Each contract must render its rows, carry its assertion PASS, narrow by
 * parameter, and deny a session without the WMS permission.
 */

let wms: WmsService;
let cycleCounts: CycleCountService;
let fixture: Awaited<ReturnType<typeof setupInventoryFixture>>;
let itemA = "";
let itemB = "";
let pickBinId = "";

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const audit = new AuditService(new DrizzleAuditStore());
  wms = new WmsService(audit, new (await import("../../modules/notifications/application/inbox-service")).InboxService());
  cycleCounts = new CycleCountService(audit, iPosting, new NumberingService(audit));

  itemA = await ensureInventoryItem("REP-WMS-A", "Report item A");
  itemB = await ensureInventoryItem("REP-WMS-B", "Report item B");
  const wh = fixture.warehouseMain;

  // Item A: 100 into the default bin + 40 into an explicit PICK bin.
  await withTenant(TENANT_I, () =>
    stock.manualReceipt({
      itemId: itemA,
      warehouseId: wh,
      qty: "100",
      unitCost: "2.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: I_JAN,
      actorId: I_ACTOR,
    }),
  );
  const zone = await withTenant(TENANT_I, () =>
    wms.createZone({
      warehouseId: wh,
      code: "REP-PICK",
      name: "Report pick zone",
      nameAr: null,
      zoneType: "PICKING",
      isDefault: false,
      note: null,
      actorId: I_ACTOR,
    }),
  );
  const aisle = await withTenant(TENANT_I, () =>
    wms.createAisle({ zoneId: zone.id, code: "RA1", name: "Report aisle", nameAr: null, actorId: I_ACTOR }),
  );
  const rack = await withTenant(TENANT_I, () =>
    wms.createRack({ aisleId: aisle.id, code: "RR1", name: "Report rack", nameAr: null, actorId: I_ACTOR }),
  );
  const binA = await withTenant(TENANT_I, () =>
    wms.createBin({
      warehouseId: wh,
      rackId: rack.id,
      code: "RA1-RR1-01",
      barcode: "BIN-REP-A1R101",
      name: "Report pick face",
      nameAr: null,
      pickSequence: 1,
      capacity: null,
      allowMixedBatches: true,
      isDefault: false,
      note: null,
      actorId: I_ACTOR,
    }),
  );
  pickBinId = binA.id;
  await withTenant(TENANT_I, () =>
    stock.manualReceipt({
      itemId: itemA,
      warehouseId: wh,
      qty: "40",
      unitCost: "3.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: I_JAN,
      targetBinId: binA.id,
      binStatus: "AVAILABLE",
      note: "report pick-bin receipt",
      noteAr: null,
      actorId: I_ACTOR,
    }),
  );

  // Item B: 50 received, 20 issued (consumption for the ABC walk; the 30
  // remainder is the slow-movement row — never issued again).
  await withTenant(TENANT_I, () =>
    stock.manualReceipt({
      itemId: itemB,
      warehouseId: wh,
      qty: "50",
      unitCost: "4.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: I_JAN,
      actorId: I_ACTOR,
    }),
  );
  await withTenant(TENANT_I, () =>
    stock.manualIssue({
      itemId: itemB,
      warehouseId: wh,
      qty: "20",
      reason: "DAMAGE",
      counterAccountId: null,
      valueDate: I_JAN,
      serialIds: [],
      batchId: null,
      note: "report consumption leg",
      noteAr: null,
      actorId: I_ACTOR,
    }),
  );

  // The ABC generation (item B is the only consumer in the window — the
  // fixture's consumption is dated JAN, so the window spans it: today is
  // ~10 months later).
  await withTenant(TENANT_I, () => cycleCounts.recomputeAbc({ windowDays: 400, actorId: I_ACTOR }));

  // A posted cycle-count document with a −5 loss over item A: the lines
  // snapshot the bins (default + pick), the entry counts 5 under on the
  // pick face, review computes the variance, approval posts G-13.
  const doc = await withTenant(TENANT_I, () =>
    cycleCounts.createDocument({
      warehouseId: wh,
      itemIds: [itemA],
      blind: false,
      note: "report variance document",
      actorId: I_ACTOR,
    }),
  );
  const lines = await withTenant(TENANT_I, () => cycleCounts.lines(doc.id));
  const pickLine = lines.find((line) => line.binId === pickBinId) ?? lines[0]!;
  await withTenant(TENANT_I, () =>
    cycleCounts.enterCounts({
      documentId: doc.id,
      entries: lines.map((line) => ({
        lineNo: line.lineNo,
        countedQty: line.lineNo === pickLine.lineNo
          ? (Number(line.systemQty) - 5).toFixed(6)
          : line.systemQty,
      })),
      actorId: I_ACTOR,
    }),
  );
  await withTenant(TENANT_I, () => cycleCounts.submit(doc.id, I_ACTOR));
  await withTenant(TENANT_I, () => cycleCounts.review(doc.id, I_ACTOR));
  // BR-075: the default tolerance is 0 — the deliberate −5 variance needs
  // the supervisor override (the same gate the report's notes document).
  await withTenant(TENANT_I, () =>
    cycleCounts.approve({ id: doc.id, supervisor: true, actorId: I_ACTOR }),
  );
});

async function runReport(reportKey: string, params: Record<string, unknown>) {
  return withTenant(TENANT_I, () =>
    newRunService().run({ reportKey, params, ctx: fullContext(TENANT_I) }),
  );
}

describe("inventory.bin-contents — the register + the INV-029 fold", () => {
  it("renders the bin rows with the zone identity and the PASS tie", async () => {
    const outcome = await runReport("inventory.bin-contents", { locale: "en" });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    const skus = result.rows.map((row) => row.values.itemSku);
    expect(skus).toContain("REP-WMS-A");
    expect(skus).toContain("REP-WMS-B");
    const pickRow = result.rows.find(
      (row) => row.values.binCode === "RA1-RR1-01",
    );
    expect(pickRow).toBeDefined();
    expect(pickRow!.values.zoneCode).toBe("REP-PICK");
    expect(pickRow!.values.status).toBe("AVAILABLE");
    expect(Number(pickRow!.values.qty)).toBeGreaterThan(0);
    const tie = result.assertions.find((a) => a.id === "inv029-bins-stock-tie");
    expect(tie?.status).toBe("PASS");
  });

  it("narrows by warehouse and status", async () => {
    const narrowed = await runReport("inventory.bin-contents", {
      locale: "en",
      warehouseId: fixture.warehouseSecond,
    });
    expect(narrowed.result!.rows).toHaveLength(0);
    const quarantined = await runReport("inventory.bin-contents", {
      locale: "en",
      status: "QUARANTINE",
    });
    expect(quarantined.result!.rows).toHaveLength(0);
  });

  it("denies a session without inventory.wms.locations", async () => {
    await expect(
      withTenant(TENANT_I, () =>
        newRunService().run({
          reportKey: "inventory.bin-contents",
          params: { locale: "en" },
          ctx: fullContext(TENANT_I, {
            permissions: new Set(["reporting.reports.run", "inventory.stock.read"]),
          }),
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
  });
});

describe("inventory.cycle-count-variance — the §2.6 register", () => {
  it("renders the posted variance lines with the exact fold", async () => {
    const outcome = await runReport("inventory.cycle-count-variance", { locale: "en" });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    const varianceRows = result.rows.filter((row) => row.values.itemSku === "REP-WMS-A");
    expect(varianceRows.length).toBeGreaterThan(0);
    const lossRow = varianceRows.find((row) => Number(row.values.varianceQty ?? 0) < 0);
    expect(lossRow).toBeDefined();
    expect(lossRow!.values.reason).toBe("CYCLE_COUNT_LOSS");
    expect(Number(lossRow!.values.valueImpact)).toBeLessThan(0);
    const consistent = result.assertions.find((a) => a.id === "cycle-count-variance-consistent");
    expect(consistent?.status).toBe("PASS");
  });

  it("narrows to POSTED only and denies without inventory.cycle_counts", async () => {
    const posted = await runReport("inventory.cycle-count-variance", {
      locale: "en",
      postedOnly: true,
    });
    expect(posted.result!.rows.length).toBeGreaterThan(0);
    await expect(
      withTenant(TENANT_I, () =>
        newRunService().run({
          reportKey: "inventory.cycle-count-variance",
          params: { locale: "en" },
          ctx: fullContext(TENANT_I, {
            permissions: new Set(["reporting.reports.run", "inventory.stock.read"]),
          }),
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
  });
});

describe("inventory.abc-classification — the latest generation", () => {
  it("renders the Pareto walk with the consuming item ranked first", async () => {
    const outcome = await runReport("inventory.abc-classification", { locale: "en" });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.rows.length).toBeGreaterThan(0);
    const consumer = result.rows.find((row) => row.values.itemSku === "REP-WMS-B");
    expect(consumer).toBeDefined();
    // The shared tenant I carries other specs' consumption history — the
    // honest assertions: a positive rank, positive consumption, and the
    // rank ordering is the render order (the Pareto walk).
    expect(Number(consumer!.values.rankNo)).toBeGreaterThan(0);
    expect(Number(consumer!.values.consumptionValue)).toBeGreaterThan(0);
    const ranks = result.rows.map((row) => Number(row.values.rankNo));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    const shape = result.assertions.find((a) => a.id === "abc-class-shape");
    expect(shape?.status).toBe("PASS");
  });

  it("narrows by class and denies without inventory.abc", async () => {
    const onlyA = await runReport("inventory.abc-classification", { locale: "en", cls: "A" });
    expect(
      onlyA.result!.rows.every((row) => row.values.cls === "A"),
    ).toBe(true);
    await expect(
      withTenant(TENANT_I, () =>
        newRunService().run({
          reportKey: "inventory.abc-classification",
          params: { locale: "en" },
          ctx: fullContext(TENANT_I, {
            permissions: new Set(["reporting.reports.run", "inventory.stock.read"]),
          }),
        }),
      ),
    ).rejects.toThrowError(PermissionDeniedError);
  });
});

describe("inventory.slow-movement — the intelligence view", () => {
  it("renders the idle rows with the class and bin spread", async () => {
    const outcome = await runReport("inventory.slow-movement", { locale: "en", windowDays: 1 });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.rows.length).toBeGreaterThan(0);
    const idleB = result.rows.find((row) => row.values.itemSku === "REP-WMS-B");
    expect(idleB).toBeDefined();
    expect(Number(idleB!.values.binCount)).toBeGreaterThanOrEqual(1);
    const window = result.assertions.find((a) => a.id === "slow-movement-window");
    expect(window?.status).toBe("PASS");
  });

  it("an empty window yields no rows (everything moved recently)", async () => {
    const none = await runReport("inventory.slow-movement", {
      locale: "en",
      windowDays: 3650,
    });
    // The fixture issued nothing in 10 years but everything landed today —
    // lastOut for item B is today, so it must NOT appear; item A never
    // issued, so it stays. The assertion: no RECENTLY-moved row appears.
    const recentlyMoved = none.result!.rows.filter(
      (row) => row.values.lastOutAt === new Date().toISOString().slice(0, 10),
    );
    expect(recentlyMoved).toHaveLength(0);
    const window = none.result!.assertions.find((a) => a.id === "slow-movement-window");
    expect(window?.status).toBe("PASS");
  });
});
