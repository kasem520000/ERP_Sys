import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7, Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as periodStore from "../../modules/accounting/infrastructure/accounting.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import { resolveInventoryAccount } from "../../modules/inventory/application/movement-core";
import * as mfgStore from "../../modules/manufacturing/infrastructure/manufacturing.store";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  clearMfgSetting,
  inspections,
  orders,
  periods,
  setMfgSetting,
  setupMfgFixture,
  stock,
  tracking,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-018 T39 — the QC gate spec (MASTER-PLAN §1 row 4 + §4): the
 * gate-required chain (manufacturing.qc_gate = "required" for the spec's own
 * five orders, restored in afterAll) — completion holds the FG batch
 * QUARANTINED (FEFO/availability exclude it, explicit-batch issues reject
 * BATCH_QUARANTINED), PASS releases with NO journal, FAIL+REWORK stays held,
 * FAIL+ACCEPT is the audited operator override, and FAIL+SCRAP is the
 * qc_scrap flow: the whole quarantined on-hand leaves the FG warehouse with
 * the journal DR PRODUCTION_SCRAP · CR the FG inventory account, the batch
 * STAYING QUARANTINED at zero on-hand. Plus the PERIOD_LOCKED zero-residue
 * pack, the GRN-target record-only pack, and the typed validation rejections.
 *
 * Shared-suite discipline (tenant M, sequential run, vitest order NOT
 * guaranteed): every assert is scoped to the spec's OWN rows — the spec-owned
 * M-QC-* items/orders/batches, never the §8 golden chain — and ALL activity
 * is dated APRIL 2026 (never January: wip-recon pins orders === 0 at asOf
 * 2026-01-31; never March: the golden chain + the drift windows live there).
 * The qc_gate setting is restored and April is reopened OPEN in afterAll (the
 * PERIOD_LOCKED pack also reopens in its own finally).
 *
 * GRN seeding note (the wip-recon drift-seeding precedent): the goods-receipt
 * target is a minimal DRAFT row inserted via superuser SQL — a REFERENTIAL
 * target the record-only inspection never mutates; purchasing's posting
 * surfaces stay untouched from here (the app role cannot insert goods_receipts
 * out-of-band, and this spec must not drive the full GRN posting path).
 */

let fixture: MfgFixture;
const specAudit = new AuditService(new DrizzleAuditStore());

/** Spec-owned items (never the golden five). */
const qcItems: { cocoa: string; box: string; cake: string } = { cocoa: "", box: "", cake: "" };
/** The seeded material batches (QC-C1 cocoa / QC-B1 box) — batch ids. */
const qcBatches: { cocoa: string; box: string } = { cocoa: "", box: "" };
/** QC-1's COMPLETED order id — the validation pack's order target. */
let qc1OrderId = "";

beforeAll(async () => {
  fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, shelfLifeDays: number) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertItem({
        sku,
        name: `${sku} (qc spec)`,
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
        shelfLifeDays,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
      return created.id;
    };
    qcItems.cocoa = await ensureItem("M-QC-COCOA", 120);
    qcItems.box = await ensureItem("M-QC-BOX", 365);
    qcItems.cake = await ensureItem("M-QC-CAKE", 3);

    // Material stock into M-RAW — the tracking.spec batch-capable seed path.
    await stock.manualReceipt({
      itemId: qcItems.cocoa,
      warehouseId: fixture.warehouseRaw,
      qty: "500",
      unitCost: "4.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-04-01",
      batchNo: "QC-C1",
      batchExpiry: "2026-08-01",
      actorId: M_ACTOR,
    });
    await stock.manualReceipt({
      itemId: qcItems.box,
      warehouseId: fixture.warehouseRaw,
      qty: "500",
      unitCost: "2.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-04-01",
      batchNo: "QC-B1",
      batchExpiry: "2027-04-01",
      actorId: M_ACTOR,
    });
    for (const [key, itemId, batchNo] of [
      ["cocoa", qcItems.cocoa, "QC-C1"],
      ["box", qcItems.box, "QC-B1"],
    ] as const) {
      const rows = await tracking.listBatches({ itemId, limit: 10 });
      const batch = rows.find((row) => row.batchNo === batchNo);
      if (batch === undefined) throw new Error(`qc spec batch ${batchNo} missing`);
      qcBatches[key] = batch.id;
    }

    // The cake recipe: yield 100 — cocoa 0.2 / box 0.1 per output (gross =
    // planned × qty at yield 100, scrap 0), so the packs' arithmetic is exact.
    const active = await mfgStore.findActiveBom(qcItems.cake);
    if (active === undefined) {
      const draft = await boms.create({
        itemId: qcItems.cake,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: "Cake v1 (qc spec)",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [
          { componentItemId: qcItems.cocoa, qtyPerOutput: "0.200000", scrapPct: "0" },
          { componentItemId: qcItems.box, qtyPerOutput: "0.100000", scrapPct: "0" },
        ],
      });
      await boms.activate(draft.id, { effectiveFrom: "2026-04-01", actorId: M_ACTOR });
    }
  });
  // The gate goes ON before any gate order is created (the L5 probe).
  await setMfgSetting("manufacturing.qc_gate", "required");
});

afterAll(async () => {
  // Order independence: restore the platform-default gate + leave April OPEN.
  await clearMfgSetting("manufacturing.qc_gate");
  await ensurePeriodOpen("2026-04-02", "qc.spec afterAll safety reopen");
});

// -- helpers -------------------------------------------------------------------

async function periodOf(date: string) {
  return withTenant(TENANT_M, () => periodStore.findPeriodForDate(date));
}

/** Order independence: never leave a period in a non-OPEN state behind. */
async function ensurePeriodOpen(date: string, reason: string) {
  const period = await periodOf(date);
  if (period === undefined) throw new Error(`no fiscal period covers ${date}`);
  const current = await withTenant(TENANT_M, () => periodStore.findPeriodById(period.id));
  if (current !== undefined && current.status !== "OPEN") {
    await withTenant(TENANT_M, () => periods.reopen(M_ACTOR, period.id, reason));
  }
}

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

/** The order's own journal count (source production_order + sourceId). */
async function countOrderJournals(orderId: string): Promise<number> {
  return withTenant(TENANT_M, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM journal_entries
      WHERE source_type = 'production_order' AND source_id = ${orderId}
    `);
    return rows.rows[0]!.n;
  });
}

/** Tenant M's whole journal count (the record-only packs' before/after). */
async function countAllJournals(): Promise<number> {
  return withTenant(TENANT_M, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM journal_entries
    `);
    return rows.rows[0]!.n;
  });
}

/**
 * One gate order end to end: create/release/start/consume BOTH components at
 * exact plan (cake v1: cocoa planned×0.2, box planned×0.1 at yield 100)/
 * complete — all inside April 2026, qc_gate required (set in beforeAll).
 */
async function runGateOrder(
  planned: string,
  opts: { laborRate: string; overheadRate: string; consumeDate: string; completeDate: string; actual: string },
) {
  return withTenant(TENANT_M, async () => {
    const cocoaQty = new Decimal(planned).times(0.2).toFixed(6);
    const boxQty = new Decimal(planned).times(0.1).toFixed(6);
    const created = await orders.create({
      branchId: fixture.branchId,
      itemId: qcItems.cake,
      bomId: null,
      plannedQty: planned,
      plannedDate: null,
      materialsWarehouseId: fixture.warehouseRaw,
      fgWarehouseId: fixture.warehouseFg,
      laborRate: opts.laborRate,
      overheadRate: opts.overheadRate,
      costCenterId: null,
      note: "qc spec gate order",
      noteAr: null,
      actorId: M_ACTOR,
    });
    await orders.release(created.id, M_ACTOR);
    await orders.start(created.id, M_ACTOR);
    await orders.consume(created.id, {
      lines: [
        { itemId: qcItems.cocoa, qty: cocoaQty, batchId: qcBatches.cocoa },
        { itemId: qcItems.box, qty: boxQty, batchId: qcBatches.box },
      ],
      consumedAt: opts.consumeDate,
      note: null,
      noteAr: null,
      actorId: M_ACTOR,
    });
    const done = await orders.complete(created.id, {
      actualQty: opts.actual,
      batchNo: null,
      completedAt: opts.completeDate,
      actorId: M_ACTOR,
    });
    return {
      order: done.order,
      batchId: done.batchId!,
      journalEntryId: done.journalEntryId!,
      fgValue: done.fgValue,
    };
  });
}

// -- the gate-on packs -----------------------------------------------------------

describe("PHASE-018 T39 QC gate — completion holds, inspection decides", () => {
  it("QC-1 PASS path — completion holds the batch QUARANTINED (FEFO/availability/issue blocked); PASS releases with NO journal", async () => {
    const run = await runGateOrder("100", {
      laborRate: "0.100000",
      overheadRate: "0.050000",
      consumeDate: "2026-04-02",
      completeDate: "2026-04-03",
      actual: "100",
    });
    qc1OrderId = run.order.id;
    // Completion: the FG batch is held QUARANTINED, expiry = 04-03 + 3d.
    const batch = await withTenant(TENANT_M, () => tracking.findBatch(run.batchId));
    expect(batch.status).toBe("QUARANTINED");
    expect(batch.expiryDate).toBe("2026-04-06");
    expect(batch.productionOrderId).toBe(run.order.id);

    // The completion journal (materials 80 + 20 = 100, labor 10, overhead 5):
    // DR FG-INV 115.0000 · CR WIP 100.0000 · CR LABOR 10.0000 · CR OVERHEAD 5.0000.
    expect(run.order.fgValue).toBe("115.0000");
    expect(await withTenant(TENANT_M, () => journalLinesOf(run.journalEntryId))).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "115.0000" },
      { accountId: fixture.gl.wip, direction: "CREDIT", amount: "100.0000" },
      { accountId: fixture.gl.productionLabor, direction: "CREDIT", amount: "10.0000" },
      { accountId: fixture.gl.productionOverhead, direction: "CREDIT", amount: "5.0000" },
    ]);

    // Availability: on-hand 100, ALL of it quarantined, none available.
    const held = await withTenant(TENANT_M, () =>
      stock.availability({ itemId: qcItems.cake, warehouseId: fixture.warehouseFg }),
    );
    expect(held.onHandQty).toBe("100.000000");
    expect(held.quarantinedQty).toBe("100.000000");
    expect(held.availableQty).toBe("0.000000");

    // Sellability block: an explicit-batch issue off the held batch is the
    // typed 409 (the movement core's quarantine guard).
    await expect(
      withTenant(TENANT_M, () =>
        stock.manualIssue({
          itemId: qcItems.cake,
          warehouseId: fixture.warehouseFg,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-04-04",
          batchId: run.batchId,
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_QUARANTINED" });

    // Inspection PASS (sampled 10): releases the hold, NO journal, and the
    // row carries the batch + the sample.
    const journalsBefore = await countOrderJournals(run.order.id);
    const inspected = await withTenant(TENANT_M, () =>
      inspections.create({
        targetType: "production_order",
        orderId: run.order.id,
        result: "PASS",
        sampled: true,
        sampleSize: 10,
        inspectedAt: "2026-04-04",
        actorId: M_ACTOR,
      }),
    );
    expect(inspected.released).toBe(true);
    expect(inspected.scrapJournalEntryId).toBeNull();
    expect(inspected.inspection.fgBatchId).toBe(run.batchId);
    expect(inspected.inspection.sampled).toBe(true);
    expect(inspected.inspection.sampleSize).toBe(10);
    expect(inspected.inspection.result).toBe("PASS");
    const released = await withTenant(TENANT_M, () => tracking.findBatch(run.batchId));
    expect(released.status).toBe("ACTIVE");
    const after = await withTenant(TENANT_M, () =>
      stock.availability({ itemId: qcItems.cake, warehouseId: fixture.warehouseFg }),
    );
    expect(after.availableQty).toBe("100.000000"); // the hold nets back in
    expect(await countOrderJournals(run.order.id)).toBe(journalsBefore); // NO new journal

    // 409 pin: FAIL+SCRAP on the now-ACTIVE batch is QC_SCRAP_BATCH_NOT_QUARANTINED.
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: run.order.id,
          result: "FAIL",
          disposition: "SCRAP",
          inspectedAt: "2026-04-04",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "QC_SCRAP_BATCH_NOT_QUARANTINED" });
  });

  it("QC-2 FAIL+SCRAP — the qc_scrap flow: whole on-hand issued, DR PRODUCTION_SCRAP · CR FG inventory, batch STAYS QUARANTINED at zero, WIP untouched", async () => {
    const run = await runGateOrder("50", {
      laborRate: "0.100000",
      overheadRate: "0.050000",
      consumeDate: "2026-04-05",
      completeDate: "2026-04-06",
      actual: "50",
    });
    // Completion: fgValue 57.5000 (materials 40 + 10, labor 5, overhead 2.5),
    // unit cost 1.150000 (the FG receipt move), batch held with 50 on-hand.
    expect(run.order.fgValue).toBe("57.5000");
    const receiptMoves = (await withTenant(TENANT_M, () =>
      inventoryStore.listStockMoves({ sourceType: "production_order", sourceId: run.order.id, limit: 50 }),
    )).filter((move) => move.direction === "IN");
    expect(receiptMoves).toHaveLength(1);
    expect(receiptMoves[0]!.unitCost).toBe("1.150000");
    expect((await withTenant(TENANT_M, () => tracking.findBatch(run.batchId))).status).toBe("QUARANTINED");
    expect(await withTenant(TENANT_M, () => mfgStore.qcBatchOnHand(run.batchId))).toBe("50.000000");

    // FAIL+SCRAP (sampled 5): the whole quarantined hold leaves M-FG at the
    // cake WAC 1.15 (QC-1's 100 @ 1.15 + this order's 50 @ 1.15 → 172.5/150).
    const journalsBefore = await countOrderJournals(run.order.id);
    const scrapped = await withTenant(TENANT_M, () =>
      inspections.create({
        targetType: "production_order",
        orderId: run.order.id,
        result: "FAIL",
        sampled: true,
        sampleSize: 5,
        disposition: "SCRAP",
        inspectedAt: "2026-04-07",
        actorId: M_ACTOR,
      }),
    );
    expect(scrapped.scrapJournalEntryId).not.toBeNull();
    expect(scrapped.scrapQty).toBe("50.000000");
    expect(scrapped.scrapValue).toBe("57.5000");
    expect(scrapped.released).toBe(false);

    // Journal EXACTLY: DR PRODUCTION_SCRAP 57.5000 · CR the M-FG inventory
    // account 57.5000 (resolved by the same helper the service uses).
    const fgAccount = await withTenant(TENANT_M, () => resolveInventoryAccount(fixture.warehouseFg));
    expect(await withTenant(TENANT_M, () => journalLinesOf(scrapped.scrapJournalEntryId!))).toEqual([
      { accountId: fixture.gl.productionScrap, direction: "DEBIT", amount: "57.5000" },
      { accountId: fgAccount, direction: "CREDIT", amount: "57.5000" },
    ]);
    const bySource = await withTenant(TENANT_M, () =>
      journal.findEntryBySourceKey("production_order", run.order.id, "qc_scrap"),
    );
    expect(bySource!.id).toBe(scrapped.scrapJournalEntryId);
    expect(await countOrderJournals(run.order.id)).toBe(journalsBefore + 1);

    // ONE issue stock move off the held batch, sourced production_order.
    const scrapMoves = (await withTenant(TENANT_M, () =>
      inventoryStore.listStockMoves({ sourceType: "production_order", sourceId: run.order.id, limit: 50 }),
    )).filter((move) => move.batchId === run.batchId && move.direction === "OUT");
    expect(scrapMoves).toHaveLength(1);
    expect(scrapMoves[0]!.qty).toBe("50.000000");
    expect(scrapMoves[0]!.sourceType).toBe("production_order");
    expect(scrapMoves[0]!.sourceId).toBe(run.order.id);
    expect(scrapMoves[0]!.postedJournalId).toBe(scrapped.scrapJournalEntryId);

    // The batch: zero on-hand, STILL QUARANTINED (an emptied hold stays
    // visibly QC-failed); the order's WIP balance stays exactly zero.
    expect(await withTenant(TENANT_M, () => mfgStore.qcBatchOnHand(run.batchId))).toBe("0.000000");
    expect((await withTenant(TENANT_M, () => tracking.findBatch(run.batchId))).status).toBe("QUARANTINED");
    expect(await withTenant(TENANT_M, () => mfgStore.sumOrderWip(run.order.id))).toBe("0.0000");

    // Empty-batch pin: a second FAIL+SCRAP on the emptied hold.
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: run.order.id,
          result: "FAIL",
          disposition: "SCRAP",
          inspectedAt: "2026-04-07",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "QC_SCRAP_EMPTY_BATCH" });
  });

  it("QC-3 FAIL+REWORK stays held (no journal, no release); a later PASS releases", async () => {
    const run = await runGateOrder("20", {
      laborRate: "0",
      overheadRate: "0",
      consumeDate: "2026-04-08",
      completeDate: "2026-04-09",
      actual: "20",
    });
    const journalsBefore = await countOrderJournals(run.order.id);
    const rework = await withTenant(TENANT_M, () =>
      inspections.create({
        targetType: "production_order",
        orderId: run.order.id,
        result: "FAIL",
        disposition: "REWORK",
        inspectedAt: "2026-04-10",
        actorId: M_ACTOR,
      }),
    );
    expect(rework.released).toBe(false);
    expect(rework.scrapJournalEntryId).toBeNull();
    expect((await withTenant(TENANT_M, () => tracking.findBatch(run.batchId))).status).toBe("QUARANTINED");
    expect(await countOrderJournals(run.order.id)).toBe(journalsBefore); // record-only

    // After the rework, a PASS releases the (still-held) batch.
    const pass = await withTenant(TENANT_M, () =>
      inspections.create({
        targetType: "production_order",
        orderId: run.order.id,
        result: "PASS",
        inspectedAt: "2026-04-10",
        actorId: M_ACTOR,
      }),
    );
    expect(pass.released).toBe(true);
    expect((await withTenant(TENANT_M, () => tracking.findBatch(run.batchId))).status).toBe("ACTIVE");
  });

  it("QC-4 FAIL+ACCEPT is the audited operator override — releases the hold, inspection audit carries operatorOverride true", async () => {
    const run = await runGateOrder("20", {
      laborRate: "0",
      overheadRate: "0",
      consumeDate: "2026-04-10",
      completeDate: "2026-04-11",
      actual: "20",
    });
    const override = await withTenant(TENANT_M, () =>
      inspections.create({
        targetType: "production_order",
        orderId: run.order.id,
        result: "FAIL",
        disposition: "ACCEPT",
        inspectedAt: "2026-04-12",
        actorId: M_ACTOR,
      }),
    );
    expect(override.released).toBe(true);
    expect(override.scrapJournalEntryId).toBeNull();
    expect((await withTenant(TENANT_M, () => tracking.findBatch(run.batchId))).status).toBe("ACTIVE");

    // The audit row names the override explicitly (the bom.spec audit read).
    const events = await withTenant(TENANT_M, () =>
      specAudit.list({ entityType: "inspection", entityId: override.inspection.id, limit: 5 }),
    );
    const created = events.find((event) => event.action === "manufacturing.inspection.created");
    expect(created).toBeDefined();
    expect((created!.after as Record<string, unknown>).operatorOverride).toBe(true);
    expect((created!.after as Record<string, unknown>).released).toBe(true);
  });

  it("QC-5 PERIOD_LOCKED — FAIL+SCRAP into a locked month rejects with ZERO residue; INV-020 reopen re-enables it", async () => {
    const run = await runGateOrder("10", {
      laborRate: "0",
      overheadRate: "0",
      consumeDate: "2026-04-12",
      completeDate: "2026-04-13",
      actual: "10",
    });
    const journalsBefore = await countOrderJournals(run.order.id);
    const april = await periodOf("2026-04-02");
    expect(april).toBeDefined();

    try {
      await withTenant(TENANT_M, () => periods.softClose(M_ACTOR, april!.id));
      await withTenant(TENANT_M, () => periods.lock(M_ACTOR, april!.id));

      // The qc_scrap posting (entryDate 2026-04-14) hits the locked month:
      // the engine's PERIOD_LOCKED, thrown pre-write — the plan made no rows.
      await expect(
        withTenant(TENANT_M, () =>
          inspections.create({
            targetType: "production_order",
            orderId: run.order.id,
            result: "FAIL",
            disposition: "SCRAP",
            inspectedAt: "2026-04-14",
            actorId: M_ACTOR,
          }),
        ),
      ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
      // ZERO residue: no inspection row, no qc_scrap journal, the batch
      // untouched (still held, still 10 on-hand).
      expect(await withTenant(TENANT_M, () => inspections.list({ orderId: run.order.id, limit: 10 }))).toEqual([]);
      expect(await countOrderJournals(run.order.id)).toBe(journalsBefore);
      expect(await withTenant(TENANT_M, () => mfgStore.qcBatchOnHand(run.batchId))).toBe("10.000000");
      expect((await withTenant(TENANT_M, () => tracking.findBatch(run.batchId))).status).toBe("QUARANTINED");
    } finally {
      // Always leave April OPEN (the afterAll reopen is the belt-and-braces).
      const current = await periodOf("2026-04-02");
      if (current!.status !== "OPEN") {
        await withTenant(TENANT_M, () =>
          periods.reopen(M_ACTOR, current!.id, "qc.spec PERIOD_LOCKED pack finally-reopen"),
        );
      }
    }

    // INV-020 reopen → the SAME FAIL+SCRAP now posts (order independence).
    const scrapped = await withTenant(TENANT_M, () =>
      inspections.create({
        targetType: "production_order",
        orderId: run.order.id,
        result: "FAIL",
        disposition: "SCRAP",
        inspectedAt: "2026-04-14",
        actorId: M_ACTOR,
      }),
    );
    expect(scrapped.scrapQty).toBe("10.000000");
    expect(scrapped.scrapJournalEntryId).not.toBeNull();
    expect(await withTenant(TENANT_M, () => mfgStore.qcBatchOnHand(run.batchId))).toBe("0.000000");
    expect((await withTenant(TENANT_M, () => tracking.findBatch(run.batchId))).status).toBe("QUARANTINED");
  });

  it("GRN targets are record-only; the typed validation pack rejects every malformed shape", async () => {
    // The referential GRN target: a real supplier + a minimal DRAFT
    // goods_receipts row via superuser (the documented seeding exception —
    // see the header note). The record-only inspection never mutates it.
    const supplierId = await withTenant(TENANT_M, async () => {
      const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
      const existing = await partnersStore.findPartnerByCode("M-QC-S1");
      if (existing !== undefined) return existing.id;
      const created = await partnersStore.insertPartner({
        kind: "SUPPLIER",
        code: "M-QC-S1",
        name: "شركة مواد الحلويات",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      });
      return created.id;
    });
    const grnId = generateUuidV7();
    const su = await (await import("../test-db")).superuserClient();
    await su.query(
      `INSERT INTO goods_receipts (id, tenant_id, branch_id, supplier_id, warehouse_id,
                                    receipt_date, status, po_less_reason, note)
       VALUES ($1, $2, $3, $4, $5, '2026-04-01', 'DRAFT',
               'qc spec referential target', 'qc.spec DRAFT GRN — record-only inspection target')`,
      [grnId, TENANT_M, fixture.branchId, supplierId, fixture.warehouseRaw],
    );
    await su.end();

    // PASS on the GRN: record-only — a row, no batch, no release, no journal.
    const journalsBefore = await countAllJournals();
    const grnPass = await withTenant(TENANT_M, () =>
      inspections.create({
        targetType: "goods_receipt",
        grnId,
        result: "PASS",
        inspectedAt: "2026-04-02",
        actorId: M_ACTOR,
      }),
    );
    expect(grnPass.inspection.targetType).toBe("goods_receipt");
    expect(grnPass.inspection.grnId).toBe(grnId);
    expect(grnPass.inspection.orderId).toBeNull();
    expect(grnPass.inspection.fgBatchId).toBeNull();
    expect(grnPass.released).toBe(false);
    expect(grnPass.scrapJournalEntryId).toBeNull();
    expect(await countAllJournals()).toBe(journalsBefore); // record-only

    // FAIL + RETURN_TO_SUPPLIER on the GRN: record-only too (the return
    // itself is a purchasing flow — the inspection documents the decision).
    const rts = await withTenant(TENANT_M, () =>
      inspections.create({
        targetType: "goods_receipt",
        grnId,
        result: "FAIL",
        disposition: "RETURN_TO_SUPPLIER",
        inspectedAt: "2026-04-02",
        actorId: M_ACTOR,
      }),
    );
    expect(rts.released).toBe(false);
    expect(rts.scrapJournalEntryId).toBeNull();
    expect(rts.inspection.disposition).toBe("RETURN_TO_SUPPLIER");
    expect(await countAllJournals()).toBe(journalsBefore); // still record-only

    // The validation pack (typed codes; QC-1's COMPLETED order + a fresh
    // IN_PROGRESS order as the order targets).
    const unknownUuid = "12345678-1234-1234-1234-123456789012";
    const completedOrderId = qc1OrderId;
    const inProgress = await withTenant(TENANT_M, async () => {
      const created = await orders.create({
        branchId: fixture.branchId,
        itemId: qcItems.cake,
        bomId: null,
        plannedQty: "5",
        plannedDate: null,
        materialsWarehouseId: fixture.warehouseRaw,
        fgWarehouseId: fixture.warehouseFg,
        laborRate: "0",
        overheadRate: "0",
        costCenterId: null,
        note: "qc spec in-progress target (never completed)",
        noteAr: null,
        actorId: M_ACTOR,
      });
      await orders.release(created.id, M_ACTOR);
      await orders.start(created.id, M_ACTOR);
      return created.id;
    });

    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: unknownUuid,
          result: "PASS",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "PRODUCTION_ORDER_NOT_FOUND" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "goods_receipt",
          grnId: unknownUuid,
          result: "PASS",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_TARGET_NOT_FOUND" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: completedOrderId,
          result: "FAIL",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_DISPOSITION_REQUIRED" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: completedOrderId,
          result: "PASS",
          disposition: "SCRAP",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_DISPOSITION_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: completedOrderId,
          result: "PASS",
          disposition: "REWORK",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_DISPOSITION_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: completedOrderId,
          result: "FAIL",
          disposition: "RETURN_TO_SUPPLIER",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_DISPOSITION_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: null,
          result: "PASS",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_TARGET_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: completedOrderId,
          grnId,
          result: "PASS",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_TARGET_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "goods_receipt",
          grnId: null,
          result: "PASS",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_TARGET_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: inProgress,
          result: "PASS",
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_TARGET_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: completedOrderId,
          result: "PASS",
          sampled: true,
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_INPUT_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        inspections.create({
          targetType: "production_order",
          orderId: completedOrderId,
          result: "PASS",
          sampled: false,
          sampleSize: 5,
          inspectedAt: "2026-04-02",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSPECTION_INPUT_INVALID" });

    // The not-found read + the targeted list.
    await expect(withTenant(TENANT_M, () => inspections.find(unknownUuid))).rejects.toMatchObject({
      code: "INSPECTION_NOT_FOUND",
    });
    const grnRows = await withTenant(TENANT_M, () =>
      inspections.list({ targetType: "goods_receipt", limit: 10 }),
    );
    expect(grnRows).toHaveLength(2); // the PASS + the RETURN_TO_SUPPLIER rows
    expect(grnRows.every((row) => row.grnId === grnId)).toBe(true);
  });
});
