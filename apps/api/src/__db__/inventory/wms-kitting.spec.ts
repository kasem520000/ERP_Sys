import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { WmsService } from "../../modules/inventory/application/wms.service";
import { KittingService } from "../../modules/inventory/application/kitting-service";
import {
  CrossDockBinNotDockError,
  CrossDockQtyExceededError,
  WarehouseKitStateError,
} from "../../modules/inventory/domain/inventory-errors";
import type { AuditService } from "../../modules/audit/api/audit";
import {
  I_ACTOR,
  I_JAN,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  stock,
  type InventoryFixture,
} from "./fixtures";

/**
 * Kitting + cross-docking suite (PHASE-044 T-10; §2.10/§2.11, I-12/I-13):
 * the G-45 roll-up (components issue with KIT_CONSUMPTION, the kit
 * receipts at Σ component costs EXACTLY, same-account by construction —
 * NO journal, the D-4 law; INV-029 holds on every leg) and the dock-side
 * bypass (DOCK-zone-only landing, the I-12 in-transit exactness check
 * over the cumulative docked qty per link).
 */

let fixture: InventoryFixture;
let kitting: KittingService;
let wms: WmsService;
let dockBinId = "";
let pickingBinId = "";

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { PostingService } = await import("../../modules/accounting/application/posting-service");
  const { NumberingService } = await import("../../modules/accounting/application/numbering-service");
  const { PartnerSubledgerService } = await import("../../modules/partners/application/subledger-service");
  const { InboxService } = await import("../../modules/notifications/application/inbox-service");
  const audit = new AuditService(new DrizzleAuditStore()) as AuditService;
  kitting = new KittingService(
    audit,
    new PostingService(audit, new PartnerSubledgerService()),
    new NumberingService(audit),
  );
  wms = new WmsService(audit, new InboxService());

  // A DOCK-zone bin + a PICKING-zone bin under a T-10 rack.
  await withTenant(TENANT_I, async () => {
    const zones = await wmsStore.listZones({ warehouseId: fixture.warehouseMain, limit: 200 });
    let dockZone = zones.find((z) => z.code === "T10-DOCK");
    if (dockZone === undefined) {
      dockZone = await wms.createZone({
        warehouseId: fixture.warehouseMain,
        code: "T10-DOCK",
        name: "T-10 dock",
        nameAr: null,
        zoneType: "DOCK",
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      });
    }
    let pickZone = zones.find((z) => z.code === "T10-PICK");
    if (pickZone === undefined) {
      pickZone = await wms.createZone({
        warehouseId: fixture.warehouseMain,
        code: "T10-PICK",
        name: "T-10 pick face",
        nameAr: null,
        zoneType: "PICKING",
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      });
    }
    const dockAisle =
      (await wmsStore.listAisles(dockZone.id))[0] ??
      (await wms.createAisle({ zoneId: dockZone.id, code: "T10-DA", name: "T10-DA", nameAr: null, actorId: I_ACTOR }));
    const dockRack =
      (await wmsStore.listRacks(dockAisle.id))[0] ??
      (await wms.createRack({ aisleId: dockAisle.id, code: "T10-DR", name: "T10-DR", nameAr: null, actorId: I_ACTOR }));
    const pickAisle =
      (await wmsStore.listAisles(pickZone.id))[0] ??
      (await wms.createAisle({ zoneId: pickZone.id, code: "T10-PA", name: "T10-PA", nameAr: null, actorId: I_ACTOR }));
    const pickRack =
      (await wmsStore.listRacks(pickAisle.id))[0] ??
      (await wms.createRack({ aisleId: pickAisle.id, code: "T10-PR", name: "T10-PR", nameAr: null, actorId: I_ACTOR }));
    const existingBins = await wmsStore.listBins({ warehouseId: fixture.warehouseMain, limit: 1000 });
    const dockBin =
      existingBins.find((b) => b.code === "T10-DOCK-01") ??
      (await wms.createBin({
        warehouseId: fixture.warehouseMain,
        rackId: dockRack.id,
        code: "T10-DOCK-01",
        barcode: "BIN-T10-DOCK-01",
        name: "T-10 dock face",
        nameAr: null,
        pickSequence: null,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      }));
    dockBinId = dockBin.id;
    const pickBin =
      existingBins.find((b) => b.code === "T10-PICK-01") ??
      (await wms.createBin({
        warehouseId: fixture.warehouseMain,
        rackId: pickRack.id,
        code: "T10-PICK-01",
        barcode: "BIN-T10-PICK-01",
        name: "T-10 pick face",
        nameAr: null,
        pickSequence: 1,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        actorId: I_ACTOR,
      }));
    pickingBinId = pickBin.id;
  });
});

describe("§2.11 — warehouse kitting: the G-45 roll-up (kit = Σ components exactly, no journal)", () => {
  it("posts a kit: components issue KIT_CONSUMPTION, the kit receipts at Σ costs, NO journal, INV-029 intact", async () => {
    const kitItem = await ensureInventoryItem("INV-KIT-1", "Kit bundle item");
    const compA = await ensureInventoryItem("INV-KIT-1A", "Kit component A");
    const compB = await ensureInventoryItem("INV-KIT-1B", "Kit component B");
    const wh = fixture.warehouseMain;
    // Components on hand: A 100 @ 3, B 100 @ 5 (explicit bins).
    for (const [item, cost] of [
      [compA, "3.000000"],
      [compB, "5.000000"],
    ] as const) {
      await withTenant(TENANT_I, () =>
        stock.manualReceipt({
          itemId: item,
          warehouseId: wh,
          qty: "100",
          unitCost: cost,
          reason: "COUNT_GAIN",
          counterAccountId: null,
          valueDate: I_JAN,
          targetBinId: pickingBinId,
          actorId: I_ACTOR,
        }),
      );
    }

    const order = await withTenant(TENANT_I, () =>
      kitting.createKitOrder({
        warehouseId: wh,
        kitItemId: kitItem,
        qty: "10",
        lines: [
          { componentItemId: compA, qty: "20", fromBinId: pickingBinId },
          { componentItemId: compB, qty: "30", fromBinId: pickingBinId },
        ],
        note: "weekend bundle",
        actorId: I_ACTOR,
      }),
    );
    expect(order.status).toBe("DRAFT");

    const posted = await withTenant(TENANT_I, () =>
      kitting.postKitOrder({ id: order.id, actorId: I_ACTOR }),
    );
    // Σ components = 20×3 + 30×5 = 210 for 10 kits → 21.000000 per kit.
    expect(posted.totalComponentCost).toBe("210.0000");
    expect(posted.kitUnitCost).toBe("21.000000");
    expect(posted.kitNo).toMatch(/^WK-\d{4}-\d{6}$/);

    // The moves: 2 component issues + 1 kit receipt, ALL journal-less
    // (same-account by construction — the D-4 law) with the right reasons.
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "warehouse_kit", sourceId: order.id, limit: 10 }),
    );
    expect(moves).toHaveLength(3);
    const outA = moves.find((m) => m.itemId === compA && m.direction === "OUT");
    const outB = moves.find((m) => m.itemId === compB && m.direction === "OUT");
    const kitIn = moves.find((m) => m.itemId === kitItem && m.direction === "IN");
    expect(outA?.reason).toBe("KIT_CONSUMPTION");
    expect(outA?.qty).toBe("20.000000");
    expect(outB?.reason).toBe("KIT_CONSUMPTION");
    expect(kitIn?.reason).toBe("KIT_ASSEMBLY");
    expect(kitIn?.qty).toBe("10.000000");
    expect(kitIn?.unitCost).toBe("21.000000");
    expect(moves.every((m) => m.postedJournalId === null)).toBe(true);

    // INV-029 on every touched item: bins = stock.
    for (const item of [compA, compB, kitItem]) {
      const rows = await withTenant(TENANT_I, () =>
        wmsStore.listBinContents({ warehouseId: wh, itemId: item, limit: 20 }),
      );
      const binTotal = rows
        .filter((r) => r.ownerPartnerId === null)
        .reduce((sum, r) => sum + Number(r.qty), 0);
      const stockRow = await withTenant(TENANT_I, () => store.findItemStock(item, wh));
      expect(binTotal).toBeCloseTo(Number(stockRow?.qty ?? 0), 6);
    }
    // The components left their bin; the kit landed at the DEFAULT bin.
    const compARows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: pickingBinId, itemId: compA, limit: 10 }),
    );
    expect(Number(compARows[0]!.qty)).toBe(80);
    const defaultBin = await withTenant(TENANT_I, () => wmsStore.findDefaultBin(wh));
    const kitRows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: defaultBin!.id, itemId: kitItem, limit: 10 }),
    );
    expect(Number(kitRows[0]!.qty)).toBe(10);

    // The order carries its evidence (POSTED = number + stamp + cost).
    const row = await withTenant(TENANT_I, () => kitting.findKitOrder(order.id));
    expect(row.status).toBe("POSTED");
    expect(row.kitNo).toBe(posted.kitNo);
    expect(row.totalComponentCost).toBe("210.0000");
  });

  it("a short component bin is the typed rejection with zero residue; a self-consuming kit is rejected", async () => {
    const kitItem = await ensureInventoryItem("INV-KIT-2", "Kit short item");
    const comp = await ensureInventoryItem("INV-KIT-2A", "Kit short component");
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: comp,
        warehouseId: fixture.warehouseMain,
        qty: "5",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        targetBinId: pickingBinId,
        actorId: I_ACTOR,
      }),
    );
    const order = await withTenant(TENANT_I, () =>
      kitting.createKitOrder({
        warehouseId: fixture.warehouseMain,
        kitItemId: kitItem,
        qty: "2",
        lines: [{ componentItemId: comp, qty: "10", fromBinId: pickingBinId }],
        note: null,
        actorId: I_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_I, () => kitting.postKitOrder({ id: order.id, actorId: I_ACTOR })),
    ).rejects.toThrow(/holds 5/);
    // Zero residue: nothing posted, nothing moved.
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "warehouse_kit", sourceId: order.id, limit: 10 }),
    );
    expect(moves).toHaveLength(0);
    const still = await withTenant(TENANT_I, () => kitting.findKitOrder(order.id));
    expect(still.status).toBe("DRAFT");

    await expect(
      withTenant(TENANT_I, () =>
        kitting.createKitOrder({
          warehouseId: fixture.warehouseMain,
          kitItemId: kitItem,
          qty: "1",
          lines: [{ componentItemId: kitItem, qty: "1", fromBinId: null }],
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(WarehouseKitStateError);
  });
});

describe("§2.10 — cross-docking: the dock-side bypass with the in-transit exactness check", () => {
  it("lands ONLY in DOCK bins; docks cumulatively up to the linked demand; the surplus is the typed rejection", async () => {
    const item = await ensureInventoryItem("INV-XD-1", "Cross-dock item");
    const wh = fixture.warehouseMain;

    // A non-DOCK bin is the typed rejection (the bypass is the dock face).
    await expect(
      withTenant(TENANT_I, () =>
        kitting.crossDockReceipt({
          warehouseId: wh,
          dockBinId: pickingBinId,
          itemId: item,
          qty: "5",
          unitCost: "4.000000",
          linkId: "00000000-0000-4000-8000-0000000000d1",
          expectedQty: "10",
          batchId: null,
          batchNo: null,
          batchExpiry: null,
          serialIds: null,
          valueDate: I_JAN,
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(CrossDockBinNotDockError);

    // First dock: 6 of a 10-unit outbound line.
    const first = await withTenant(TENANT_I, () =>
      kitting.crossDockReceipt({
        warehouseId: wh,
        dockBinId,
        itemId: item,
        qty: "6",
        unitCost: "4.000000",
        linkId: "00000000-0000-4000-8000-0000000000d1",
        expectedQty: "10",
        batchId: null,
        batchNo: null,
        batchExpiry: null,
        serialIds: null,
        valueDate: I_JAN,
        note: "direct to the outbound",
        actorId: I_ACTOR,
      }),
    );
    expect(first.cumulativeDocked).toBe("6.000000");
    expect(first.journalEntryId).toBeTruthy();

    // The docked stock is AVAILABLE at the dock bin (pickable).
    const docked = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: dockBinId, itemId: item, limit: 10 }),
    );
    expect(docked[0]!.status).toBe("AVAILABLE");
    expect(docked[0]!.qty).toBe("6.000000");
    const available = await withTenant(TENANT_I, () =>
      wmsStore.availableQtyByBin({ warehouseId: wh, itemId: item }),
    );
    expect(available.some((row) => row.binId === dockBinId)).toBe(true);

    // The move carries the link + the CROSS_DOCK reason.
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "cross_dock", itemId: item, limit: 10 }),
    );
    expect(moves[0]?.reason).toBe("CROSS_DOCK");
    expect(moves[0]?.targetBinId).toBe(dockBinId);

    // The exactness ceiling: docking 5 more would exceed 10.
    await expect(
      withTenant(TENANT_I, () =>
        kitting.crossDockReceipt({
          warehouseId: wh,
          dockBinId,
          itemId: item,
          qty: "5",
          unitCost: "4.000000",
          linkId: "00000000-0000-4000-8000-0000000000d1",
          expectedQty: "10",
          batchId: null,
          batchNo: null,
          batchExpiry: null,
          serialIds: null,
          valueDate: I_JAN,
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(CrossDockQtyExceededError);

    // The exact fill: 4 more lands exactly at the ceiling.
    const second = await withTenant(TENANT_I, () =>
      kitting.crossDockReceipt({
        warehouseId: wh,
        dockBinId,
        itemId: item,
        qty: "4",
        unitCost: "4.000000",
        linkId: "00000000-0000-4000-8000-0000000000d1",
        expectedQty: "10",
        batchId: null,
        batchNo: null,
        batchExpiry: null,
        serialIds: null,
        valueDate: I_JAN,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    expect(second.cumulativeDocked).toBe("10.000000");
    // INV-029: bins = stock (the dock receipts are ordinary receipts).
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: item, limit: 20 }),
    );
    const binTotal = rows
      .filter((r) => r.ownerPartnerId === null)
      .reduce((sum, r) => sum + Number(r.qty), 0);
    const stockRow = await withTenant(TENANT_I, () => store.findItemStock(item, wh));
    expect(binTotal).toBeCloseTo(Number(stockRow?.qty ?? 0), 6);
  });
});
