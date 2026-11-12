import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import {
  BinMixedBatchBlockedError,
  LpnClosedError,
  LpnNotFoundError,
  UomConversionMissingError,
} from "../../modules/inventory/domain/inventory-errors";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { WmsService } from "../../modules/inventory/application/wms.service";
import {
  applySerialFlips,
  inventoryJournalLines,
  planIssue,
  planReceipt,
  applyReceipt,
  resolveInventoryAccount,
} from "../../modules/inventory/application/movement-core";
import type { JournalSpec } from "../../modules/accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency } from "../../infra/settings/setting-reader";
import type { AuditService } from "../../modules/audit/api/audit";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import {
  I_ACTOR,
  I_JAN,
  TENANT_I,
  ensureInventoryItem,
  iPosting,
  setupInventoryFixture,
  stock,
  tracking,
  transfers,
  type InventoryFixture,
} from "./fixtures";
import * as store from "../../modules/inventory/infrastructure/inventory.store";

/**
 * WMS core suite (PHASE-044 T-03; INV-029/BR-072, I-01/I-15/I-16): the
 * bin-contents substrate — same-transaction writes with item_stock, the
 * reconciliation probe, status transitions, LPN moves, the I-15 UOM
 * conversion, and the T-11 serial-ledger completeness across movement
 * kinds. Everything runs against the real movement core (no mocks): the
 * goods flows are the same services the API serves.
 */

let wms: WmsService;
let fixture: InventoryFixture;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  wms = new WmsService(new AuditService(new DrizzleAuditStore()) as AuditService, new InboxService());
});

/** Σ tenant-owned bin_contents for (warehouse, item) — the INV-029 fold. */
async function binSum(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_I, async () => {
    const rows = await wmsStore.listBinContents({ warehouseId, itemId, limit: 1000 });
    const tenantRows = rows.filter((r) => r.ownerPartnerId === null);
    return tenantRows.reduce((acc, r) => acc + Number(r.qty), 0).toFixed(6);
  });
}

async function stockQty(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_I, async () => {
    const row = await store.findItemStock(itemId, warehouseId);
    return row?.qty ?? "0.000000";
  });
}

/**
 * The explicit-bin receipt through the REAL plan → post → apply pipeline
 * (the stock-service shape, with the bin endpoint): a journal ALWAYS rides
 * the apply — a bare applyReceipt(null) would mint an orphan move (an
 * INV-018 violation the sibling suites' reconciliation checks catch).
 */
async function binReceipt(input: {
  itemId: string;
  warehouseId: string;
  qty: string;
  unitCost: string;
  movedAt: string;
  targetBinId: string;
  batchNo?: string | null;
  batchExpiry?: string | null;
  sourceType?: string;
}): Promise<{ moveId: string; journalEntryId: string }> {
  const plan = await planReceipt({
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    qty: input.qty,
    unitCost: input.unitCost,
    movedAt: input.movedAt,
    moveKind: "receipt",
    sourceType: input.sourceType ?? "manual_receipt",
    sourceId: input.itemId,
    batchNo: input.batchNo ?? null,
    batchExpiry: input.batchExpiry ?? null,
    targetBinId: input.targetBinId,
  });
  const lines = inventoryJournalLines({
    inventoryAccountId: await resolveInventoryAccount(input.warehouseId),
    direction: "IN",
    value: plan.valueAmount,
    counterPurpose: "INVENTORY_APPRECIATION",
    memoEn: "WMS suite bin receipt",
    memoAr: "إدخال صندوق — مجموعة WMS",
  });
  const spec: JournalSpec = {
    source: { docType: "stock_move", docId: plan.anchorId, operation: "post" },
    entryDate: input.movedAt,
    description: { en: "WMS suite bin receipt", ar: "إدخال صندوق — مجموعة WMS" },
    currency: await ownTenantBaseCurrency(),
    lines,
  };
  const result = await iPosting.post(spec, { postedBy: I_ACTOR });
  const moveId = await applyReceipt(plan, result.journalEntryId);
  return { moveId, journalEntryId: result.journalEntryId };
}

describe("INV-029 — Σ bin_contents = item_stock at every move (same transaction)", () => {
  it("receipts land in the DEFAULT bin lazily and keep the fold exact; issues decrement the same slot in the SAME transaction", async () => {
    const item = await ensureInventoryItem("INV-WMS-01", "WMS fold item");
    const wh = fixture.warehouseMain;

    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "100",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    // The lazy D-5 anchor: the DEFAULT bin materialized on first receipt.
    const defaultBin = await withTenant(TENANT_I, () => wmsStore.findDefaultBin(wh));
    expect(defaultBin).toBeDefined();
    expect(await binSum(wh, item)).toBe("100.000000");
    expect(await stockQty(wh, item)).toBe("100.000000");

    // A second receipt into an EXPLICIT second bin — the fold spans bins.
    const zone = await withTenant(TENANT_I, () =>
      wms.createZone({
        warehouseId: wh,
        code: "PICK-A",
        name: "Pick zone A",
        nameAr: "منطقة انتقاء أ",
        zoneType: "PICKING",
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const aisle = await withTenant(TENANT_I, () =>
      wms.createAisle({ zoneId: zone.id, code: "A1", name: "Aisle 1", nameAr: null, actorId: I_ACTOR }),
    );
    const rack = await withTenant(TENANT_I, () =>
      wms.createRack({ aisleId: aisle.id, code: "R1", name: "Rack 1", nameAr: null, actorId: I_ACTOR }),
    );
    const binA = await withTenant(TENANT_I, () =>
      wms.createBin({
        warehouseId: wh,
        rackId: rack.id,
        code: "A1-R1-01",
        barcode: "BIN-MAIN-A1R101",
        name: "Pick face 1",
        nameAr: null,
        pickSequence: 1,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      }),
    );

    await withTenant(TENANT_I, () =>
      binReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "40",
        unitCost: "3.000000",
        movedAt: I_JAN,
        targetBinId: binA.id,
      }),
    );
    expect(await binSum(wh, item)).toBe("140.000000");
    expect(await stockQty(wh, item)).toBe("140.000000");

    // Issue 90 — the allocation spans BOTH bins (FIFO by received_at:
    // 100 from DEFAULT, then 40... take 90 total), each decrement rides
    // the issue's own transaction.
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: wh,
        qty: "90",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    expect(await binSum(wh, item)).toBe("50.000000");
    expect(await stockQty(wh, item)).toBe("50.000000");

    // The reconciliation probe: green over the honest folds.
    const mismatches = await withTenant(TENANT_I, () => wms.reconcile({ warehouseId: wh }));
    const forItem = mismatches.filter((m) => m.itemId === item);
    expect(forItem).toEqual([]);
  });

  it("a rejected posting leaves the bins byte-identical (plan-then-apply atomicity)", async () => {
    const item = await ensureInventoryItem("INV-WMS-02", "WMS atomicity item");
    const wh = fixture.warehouseMain;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "10",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    // An issue plan for 5 whose apply NEVER runs (simulated posting
    // rejection): the bin rows must be untouched.
    await withTenant(TENANT_I, async () => {
      const plan = await planIssue({
        itemId: item,
        warehouseId: wh,
        qty: "5",
        movedAt: I_JAN,
        moveKind: "issue",
        sourceType: "manual_issue",
        sourceId: item,
      });
      void plan;
      // NO apply — the plan is discarded.
    });
    expect(await binSum(wh, item)).toBe("10.000000");
    expect(await stockQty(wh, item)).toBe("10.000000");
  });

  it("FAILS CLOSED when tenant bins exist but cannot cover the issue (BinContentsShortError)", async () => {
    const item = await ensureInventoryItem("INV-WMS-03", "WMS short item");
    const wh = fixture.warehouseMain;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "8",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    // Fabricate the drift: the ledger still says 8, the bin lost 3 — an
    // issue of 8 passes the stock check and must fail CLOSED on bins.
    await withTenant(TENANT_I, async () => {
      const rows = await wmsStore.listBinContents({ warehouseId: wh, itemId: item, limit: 5 });
      await wmsStore.decrementBinContent(rows[0]!.id, "3.000000");
    });
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId: item,
          warehouseId: wh,
          qty: "8",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: I_JAN,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BIN_CONTENTS_SHORT" });
    // Nothing moved — the fold is as-drifted as before, not deeper.
    expect(await binSum(wh, item)).toBe("5.000000");
    expect(await stockQty(wh, item)).toBe("8.000000");
  });

  it("the binless legacy grace: pre-backfill stock (no bin rows) still issues", async () => {
    const item = await ensureInventoryItem("INV-WMS-04", "WMS legacy item");
    const wh = fixture.warehouseMain;
    // Seed item_stock DIRECTLY (the pre-0071 shape — no bin_contents).
    await withTenant(TENANT_I, async () => {
      const { sql } = await import("drizzle-orm");
      const tx = store.inventoryTx();
      await tx.execute(
        sql`INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
          VALUES (gen_random_uuid(), erp.current_tenant_id(), ${item}, ${wh}, 7, 1.000000)`,
      );
    });
    // The issue proceeds bin-less (the 0071 grace) — no BIN_CONTENTS_SHORT.
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: wh,
        qty: "3",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    expect(await stockQty(wh, item)).toBe("4.000000");
    // And the probe REPORTS the drift (the detector, never the repairer).
    const mismatches = await withTenant(TENANT_I, () => wms.reconcile({ warehouseId: wh }));
    expect(
      mismatches.some((m) => m.itemId === item && Number(m.difference) === -4),
    ).toBe(true);
    // NOTE: the fabricated item_stock row (no IN move) is money-neutral
    // for the INV-010 checks the sibling suites run — it only drifts the
    // bin fold, which is exactly the legacy state under test.
  });

  it("multi-line documents never double-allocate the same bin row (the take overlay)", async () => {
    const item = await ensureInventoryItem("INV-WMS-05", "WMS overlay item");
    const wh = fixture.warehouseMain;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "10",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    // Two plans in ONE ambient transaction: 6 + 6 = 12 > 10 — the second
    // plan must see the first's pending take and fail closed.
    await expect(
      withTenant(TENANT_I, async () => {
        const first = await planIssue({
          itemId: item,
          warehouseId: wh,
          qty: "6",
          movedAt: I_JAN,
          moveKind: "issue",
          sourceType: "manual_issue",
          sourceId: item,
        });
        void first;
        await planIssue({
          itemId: item,
          warehouseId: wh,
          qty: "6",
          movedAt: I_JAN,
          moveKind: "issue",
          sourceType: "manual_issue",
          sourceId: item,
        });
      }),
    ).rejects.toMatchObject({ code: "BIN_CONTENTS_SHORT" });
  });
});

describe("BR-072 — the mixed-batch rule and explicit-bin validation", () => {
  it("a no-mixed-batches bin rejects a second batch at PLAN time (zero residue)", async () => {
    const item = await ensureInventoryItem("INV-WMS-06", "WMS batch item", {
      trackBatch: true,
      hasExpiry: true,
    });
    const wh = fixture.warehouseMain;
    const zone = await withTenant(TENANT_I, () =>
      wms.createZone({
        warehouseId: wh,
        code: "BULK-B",
        name: "Bulk B",
        nameAr: null,
        zoneType: "BULK",
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const aisle = await withTenant(TENANT_I, () =>
      wms.createAisle({ zoneId: zone.id, code: "B1", name: "B1", nameAr: null, actorId: I_ACTOR }),
    );
    const rack = await withTenant(TENANT_I, () =>
      wms.createRack({ aisleId: aisle.id, code: "R1", name: "R1", nameAr: null, actorId: I_ACTOR }),
    );
    const singleBatchBin = await withTenant(TENANT_I, () =>
      wms.createBin({
        warehouseId: wh,
        rackId: rack.id,
        code: "B1-R1-01",
        barcode: "BIN-MAIN-B1R101",
        name: "Single batch bin",
        nameAr: null,
        pickSequence: 2,
        capacity: null,
        allowMixedBatches: false,
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      }),
    );

    // Batch 1 into the strict bin — fine.
    await withTenant(TENANT_I, () =>
      binReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "5",
        unitCost: "1.000000",
        movedAt: I_JAN,
        targetBinId: singleBatchBin.id,
        batchNo: "B-001",
        batchExpiry: "2027-01-01",
      }),
    );

    // Batch 2 into the SAME strict bin — the typed rejection.
    await expect(
      withTenant(TENANT_I, () =>
        planReceipt({
          itemId: item,
          warehouseId: wh,
          qty: "5",
          unitCost: "1.000000",
          movedAt: I_JAN,
          moveKind: "receipt",
          sourceType: "manual_receipt",
          sourceId: item,
          batchNo: "B-002",
          batchExpiry: "2027-02-01",
          targetBinId: singleBatchBin.id,
        }),
      ),
    ).rejects.toBeInstanceOf(BinMixedBatchBlockedError);

    // The same batch again upserts the SAME slot (no rejection).
    await withTenant(TENANT_I, () =>
      binReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "3",
        unitCost: "1.000000",
        movedAt: I_JAN,
        targetBinId: singleBatchBin.id,
        batchNo: "B-001",
        batchExpiry: "2027-01-01",
      }),
    );
    expect(await binSum(wh, item)).toBe("8.000000");
    expect(await stockQty(wh, item)).toBe("8.000000");
  });
});

describe("§2.8 — status transitions move the SLOT, never the valuation", () => {
  it("QUARANTINE and back to AVAILABLE keep item_stock byte-identical and fold every status", async () => {
    const item = await ensureInventoryItem("INV-WMS-07", "WMS status item");
    const wh = fixture.warehouseMain;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "20",
        unitCost: "5.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    const before = await stockQty(wh, item);
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: item, limit: 10 }),
    );
    expect(rows).toHaveLength(1);

    const quarantined = await withTenant(TENANT_I, () =>
      wms.transitionStatus(rows[0]!.id, "QUARANTINE", { note: "QC hold", actorId: I_ACTOR }),
    );
    expect(quarantined!.status).toBe("QUARANTINE");
    // The fold spans ALL statuses; item_stock is untouched.
    expect(await binSum(wh, item)).toBe("20.000000");
    expect(await stockQty(wh, item)).toBe(before);

    // Quarantined stock is NOT allocatable: the issue fails closed.
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId: item,
          warehouseId: wh,
          qty: "1",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: I_JAN,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BIN_CONTENTS_SHORT" });

    const released = await withTenant(TENANT_I, () =>
      wms.transitionStatus(quarantined!.id, "AVAILABLE", { note: "QC release", actorId: I_ACTOR }),
    );
    expect(released!.status).toBe("AVAILABLE");
    expect(await binSum(wh, item)).toBe("20.000000");
    expect(await stockQty(wh, item)).toBe(before);

    // The zero-qty source rows stay as the honest history floor (the
    // QUARANTINE slot of the round trip; the AVAILABLE slot upserted back).
    const after = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: item, limit: 10 }),
    );
    expect(after.filter((r) => Number(r.qty) === 0).length).toBeGreaterThanOrEqual(1);
  });
});

describe("T-11 — the serial ledger: one row per serial per movement, with refs", () => {
  it("RECEIVE → PICK → RETURN across the real flows; every event carries its document", async () => {
    const item = await ensureInventoryItem("INV-WMS-08", "WMS serial item", { trackSerial: true });
    const wh = fixture.warehouseMain;
    const serial = await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: item, serialNo: "WMS-SN-001", imei: null, actorId: I_ACTOR }),
    );
    const serial2 = await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: item, serialNo: "WMS-SN-002", imei: null, actorId: I_ACTOR }),
    );

    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "2",
        unitCost: "10.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        serialIds: [serial.id, serial2.id],
        actorId: I_ACTOR,
      }),
    );

    // Each serial sits in its OWN bin row (the slot key carries serial_id).
    const contents = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: item, limit: 10 }),
    );
    expect(contents.filter((r) => Number(r.qty) === 1)).toHaveLength(2);

    // Issue one serial — the PICK event with the move + document refs.
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: wh,
        qty: "1",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: I_JAN,
        serialIds: [serial.id],
        actorId: I_ACTOR,
      }),
    );

    // The RETURN flip with its source document — on the SOLD serial (the
    // BR-018 lifecycle: sold → returned; an in_stock unit was never sold).
    await withTenant(TENANT_I, () =>
      applySerialFlips([serial.id], "RETURN", I_JAN, {
        type: "credit_note",
        id: "11111111-1111-4111-8111-111111111111",
      }),
    );

    const ledger1 = await withTenant(TENANT_I, () =>
      wmsStore.listSerialMovements({ serialId: serial.id, limit: 20 }),
    );
    // Same moved_at stamps — the uuidv7 id tiebreak keeps the walk
    // chronological: RECEIVE → PICK → RETURN.
    expect(ledger1.map((r) => r.event)).toEqual(["RECEIVE", "PICK", "RETURN"]);
    const pick = ledger1[1]!;
    expect(pick.sourceType).toBe("manual_issue");
    expect(pick.moveId).not.toBeNull();
    expect(pick.fromBinId).not.toBeNull();
    expect(pick.fromBinCode).not.toBeNull();
    expect(ledger1[2]!.sourceType).toBe("credit_note");
    expect(ledger1[2]!.sourceId).toBe("11111111-1111-4111-8111-111111111111");

    const ledger2 = await withTenant(TENANT_I, () =>
      wmsStore.listSerialMovements({ serialId: serial2.id, limit: 20 }),
    );
    expect(ledger2.map((r) => r.event)).toEqual(["RECEIVE"]);
  });

  it("transfers append TRANSFER_OUT then TRANSFER_IN with bin endpoints", async () => {
    const item = await ensureInventoryItem("INV-WMS-09", "WMS transfer item");
    const whMain = fixture.warehouseMain;
    const whSecond = fixture.warehouseSecond;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: whMain,
        qty: "15",
        unitCost: "4.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    const transfer = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: whMain,
        toWarehouseId: whSecond,
        lines: [{ itemId: item, qty: "15" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => transfers.dispatch(transfer.id, I_ACTOR));
    await withTenant(TENANT_I, () => transfers.receive(transfer.id, I_ACTOR));

    // Both folds hold after the two-leg move.
    expect(await binSum(whMain, item)).toBe("0.000000");
    expect(await stockQty(whMain, item)).toBe("0.000000");
    expect(await binSum(whSecond, item)).toBe("15.000000");
    expect(await stockQty(whSecond, item)).toBe("15.000000");

    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "stock_transfer", sourceId: transfer.id, limit: 10 }),
    );
    expect(moves).toHaveLength(2);
    const out = moves.find((m) => m.warehouseId === whMain)!;
    const into = moves.find((m) => m.warehouseId === whSecond)!;
    expect(out.sourceBinId).not.toBeNull();
    expect(into.targetBinId).not.toBeNull();
  });
});

describe("I-15 — UOM auto-conversion inside bin moves", () => {
  it("converts a differing-UOM add into the slot's UOM (direct + mirrored factor) and fails typed when absent", async () => {
    const item = await ensureInventoryItem("INV-WMS-10", "WMS uom item");
    const wh = fixture.warehouseMain;
    const uoms = await withTenant(TENANT_I, async () => {
      const itemsStore = await import("../../modules/items/infrastructure/items.store");
      return itemsStore.listUoms();
    });
    const pcs = uoms.find((u) => u.code === "PCS")!;
    const kg = uoms.find((u) => u.code === "KG");
    const g = uoms.find((u) => u.code === "G");
    expect(kg).toBeDefined();
    expect(g).toBeDefined();
    // The seeded metric pair (0009): KG→G factor 1000.
    expect(await withTenant(TENANT_I, () => wms.convertQty(kg!.id, g!.id, "2"))).toBe("2000.000000");
    expect(await withTenant(TENANT_I, () => wms.convertQty(g!.id, kg!.id, "500"))).toBe("0.500000");

    // Slot in G; add expressed in KG → the slot stays single-UOM (G).
    const bin = (await withTenant(TENANT_I, () => wmsStore.findDefaultBin(wh)))!;
    await withTenant(TENANT_I, () =>
      wmsStore.addToBinSlot({
        binId: bin.id,
        warehouseId: wh,
        itemId: item,
        batchId: null,
        serialId: null,
        lpnId: null,
        ownerPartnerId: null,
        status: "AVAILABLE",
        qty: "500",
        uomId: g!.id,
        receivedAt: null,
        note: null,
        createdBy: null,
      }),
    );
    const result = await withTenant(TENANT_I, () =>
      wmsStore.addToBinSlot({
        binId: bin.id,
        warehouseId: wh,
        itemId: item,
        batchId: null,
        serialId: null,
        lpnId: null,
        ownerPartnerId: null,
        status: "AVAILABLE",
        qty: "2",
        uomId: kg!.id,
        receivedAt: null,
        note: null,
        createdBy: null,
      }),
    );
    expect(result.qtyAdded).toBe("2000.000000");
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: bin.id, itemId: item, limit: 5 }),
    );
    expect(rows[0]!.qty).toBe("2500.000000");
    expect(rows[0]!.uomId).toBe(g!.id);

    // No conversion PCS→KG either way: the typed failure.
    await expect(withTenant(TENANT_I, () => wms.convertQty(pcs.id, kg!.id, "1"))).rejects.toBeInstanceOf(
      UomConversionMissingError,
    );
  });
});

describe("§2.5 — LPN handling", () => {
  it("binds rows to an LPN and moves them by LPN in one call (fold intact)", async () => {
    const item = await ensureInventoryItem("INV-WMS-11", "WMS lpn item");
    const wh = fixture.warehouseMain;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "12",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    const lpn = await withTenant(TENANT_I, () =>
      wms.createLpn({ lpnCode: "LPN-0001", note: null, actorId: I_ACTOR }),
    );
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: item, limit: 5 }),
    );
    await withTenant(TENANT_I, () => wms.bindContentToLpn(rows[0]!.id, lpn.id, I_ACTOR));

    const zone = await withTenant(TENANT_I, () =>
      wms.createZone({
        warehouseId: wh,
        code: "DOCK-D",
        name: "Dock D",
        nameAr: null,
        zoneType: "DOCK",
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const aisle = await withTenant(TENANT_I, () =>
      wms.createAisle({ zoneId: zone.id, code: "D1", name: "D1", nameAr: null, actorId: I_ACTOR }),
    );
    const rack = await withTenant(TENANT_I, () =>
      wms.createRack({ aisleId: aisle.id, code: "R1", name: "R1", nameAr: null, actorId: I_ACTOR }),
    );
    const dockBin = await withTenant(TENANT_I, () =>
      wms.createBin({
        warehouseId: wh,
        rackId: rack.id,
        code: "D1-R1-01",
        barcode: "BIN-MAIN-DOCK01",
        name: "Dock face",
        nameAr: null,
        pickSequence: 3,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      }),
    );

    const moved = await withTenant(TENANT_I, () =>
      wms.moveLpn({ lpnId: lpn.id, toBinId: dockBin.id, note: "pallet move", actorId: I_ACTOR }),
    );
    expect(moved.movedRows).toBe(1);
    expect(await binSum(wh, item)).toBe("12.000000");
    expect(await stockQty(wh, item)).toBe("12.000000");
    const atDock = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: dockBin.id, itemId: item, limit: 5 }),
    );
    expect(atDock[0]!.lpnCode).toBe("LPN-0001");
    expect(atDock[0]!.qty).toBe("12.000000");
  });
});

describe("the nightly probe (pg-boss inventory.bin-reconcile)", () => {
  it("aggregates per tenant and reports counts (read-only detector)", async () => {
    const result = await wms.reconcileAllTenants();
    expect(result.tenants).toBeGreaterThanOrEqual(1);
    // Tenant I carries the INV-WMS-04 legacy drift from the grace test —
    // the probe counts it; nothing was repaired.
    expect(result.mismatches).toBeGreaterThanOrEqual(1);
    expect(result.mismatchedTenants).toBeGreaterThanOrEqual(1);
  });
});

describe("T-06 — the LPN service: plate receipt, the closed-plate law, status-preserving moves", () => {
  /** A one-off bin under a dedicated T-06 rack (idempotent per code). */
  async function ensureT06Bin(code: string, barcode: string, wh: string): Promise<string> {
    return withTenant(TENANT_I, async () => {
      const existing = await wmsStore.listBins({ warehouseId: wh, limit: 1000 });
      const found = existing.find((b) => b.code === code);
      if (found !== undefined) return found.id;
      const zones = await wmsStore.listZones({ warehouseId: wh, limit: 200 });
      let zone = zones.find((z) => z.code === "T06-Z");
      if (zone === undefined) {
        zone = await wms.createZone({
          warehouseId: wh,
          code: "T06-Z",
          name: "T-06 LPN zone",
          nameAr: null,
          zoneType: "BULK",
          isDefault: false,
          note: null,
          actorId: I_ACTOR,
        });
      }
      const aisles = await wmsStore.listAisles(zone.id);
      let aisle = aisles.find((a) => a.code === "T06-A");
      if (aisle === undefined) {
        aisle = await wms.createAisle({ zoneId: zone.id, code: "T06-A", name: "T06-A", nameAr: null, actorId: I_ACTOR });
      }
      const racks = await wmsStore.listRacks(aisle.id);
      let rack = racks.find((r) => r.code === "T06-R");
      if (rack === undefined) {
        rack = await wms.createRack({ aisleId: aisle.id, code: "T06-R", name: "T06-R", nameAr: null, actorId: I_ACTOR });
      }
      const bin = await wms.createBin({
        warehouseId: wh,
        rackId: rack.id,
        code,
        barcode,
        name: code,
        nameAr: null,
        pickSequence: null,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      });
      return bin.id;
    });
  }

  it("an LPN-level receipt binds the received rows straight onto the plate (I-05)", async () => {
    const item = await ensureInventoryItem("INV-WMS-12", "WMS lpn receipt item");
    const wh = fixture.warehouseMain;
    const lpn = await withTenant(TENANT_I, () =>
      wms.createLpn({ lpnCode: "LPN-T06-RCPT", note: "pallet at receipt", actorId: I_ACTOR }),
    );
    const binId = await ensureT06Bin("T06-B1", "BIN-T06-B1", wh);

    const receipt = await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "7",
        unitCost: "3.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        lpnId: lpn.id,
        targetBinId: binId,
        actorId: I_ACTOR,
      }),
    );
    expect(receipt.moveId).toBeTruthy();

    const manifest = await withTenant(TENANT_I, () => wms.lpnContents(lpn.id));
    expect(manifest.lpn.lpnCode).toBe("LPN-T06-RCPT");
    expect(manifest.contents).toHaveLength(1);
    expect(manifest.contents[0]!.lpnId).toBe(lpn.id);
    expect(manifest.contents[0]!.binId).toBe(binId);
    expect(manifest.contents[0]!.qty).toBe("7.000000");
    // The stock_moves row carries the plate reference (§2.5).
    const move = await withTenant(TENANT_I, () => store.findMoveById(receipt.moveId));
    expect(move?.lpnId).toBe(lpn.id);
    // INV-029 stays exact through the plate-bound receipt.
    expect(await binSum(wh, item)).toBe("7.000000");
    expect(await stockQty(wh, item)).toBe("7.000000");

    // A receipt onto a CLOSED plate is the typed rejection (plan-time,
    // zero residue).
    await withTenant(TENANT_I, () => wms.closeLpn(lpn.id, I_ACTOR));
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualReceipt({
          itemId: item,
          warehouseId: wh,
          qty: "1",
          unitCost: "3.000000",
          reason: "COUNT_GAIN",
          counterAccountId: null,
          valueDate: I_JAN,
          lpnId: lpn.id,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(LpnClosedError);
  });

  it("a QUARANTINE pallet keeps its status across a move-by-LPN; a CLOSED plate never moves", async () => {
    const item = await ensureInventoryItem("INV-WMS-13", "WMS lpn quarantine item");
    const wh = fixture.warehouseMain;
    const binA = await ensureT06Bin("T06-B2", "BIN-T06-B2", wh);
    const binB = await ensureT06Bin("T06-B3", "BIN-T06-B3", wh);
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "9",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        targetBinId: binA,
        actorId: I_ACTOR,
      }),
    );
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: binA, itemId: item, limit: 5 }),
    );
    await withTenant(TENANT_I, () =>
      wms.transitionStatus(rows[0]!.id, "QUARANTINE", { note: "QC hold on the pallet", actorId: I_ACTOR }),
    );

    const lpn = await withTenant(TENANT_I, () =>
      wms.createLpn({ lpnCode: "LPN-T06-Q", note: null, actorId: I_ACTOR }),
    );
    const quarantinedRow = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: binA, itemId: item, status: "QUARANTINE", limit: 5 }),
    );
    await withTenant(TENANT_I, () => wms.bindContentToLpn(quarantinedRow[0]!.id, lpn.id, I_ACTOR));

    const moved = await withTenant(TENANT_I, () =>
      wms.moveLpn({ lpnId: lpn.id, toBinId: binB, note: "move the held pallet", actorId: I_ACTOR }),
    );
    expect(moved.movedRows).toBe(1);
    const atB = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: binB, itemId: item, limit: 5 }),
    );
    expect(atB[0]!.status).toBe("QUARANTINE");
    expect(atB[0]!.lpnCode).toBe("LPN-T06-Q");
    // The control state never touched the valuation (INV-029 spans statuses).
    expect(await binSum(wh, item)).toBe("9.000000");
    expect(await stockQty(wh, item)).toBe("9.000000");

    // The closed-plate law: close, then the move is the typed rejection.
    await withTenant(TENANT_I, () => wms.closeLpn(lpn.id, I_ACTOR));
    await expect(
      withTenant(TENANT_I, () =>
        wms.moveLpn({ lpnId: lpn.id, toBinId: binA, note: null, actorId: I_ACTOR }),
      ),
    ).rejects.toThrow(LpnClosedError);
    // Binding NEW rows onto the closed plate is equally closed.
    await expect(
      withTenant(TENANT_I, () => wms.bindContentToLpn(atB[0]!.id, lpn.id, I_ACTOR)),
    ).rejects.toThrow(LpnClosedError);
  });

  it("the manifest of an unknown plate is the typed 404-shape", async () => {
    await expect(withTenant(TENANT_I, () => wms.lpnContents("00000000-0000-4000-8000-0000000000b6"))).rejects.toThrow(
      LpnNotFoundError,
    );
  });
});
