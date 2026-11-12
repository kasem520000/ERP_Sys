import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import {
  PutawayRuleInvalidError,
  WrongBinPutawayError,
} from "../../modules/inventory/domain/inventory-errors";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { PutawayService } from "../../modules/inventory/application/putaway-service";
import type { AuditService } from "../../modules/audit/api/audit";
import {
  I_ACTOR,
  I_JAN,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  stock,
  wmsBinReceipt,
  type InventoryFixture,
} from "./fixtures";
import * as store from "../../modules/inventory/infrastructure/inventory.store";

/**
 * Directed putaway suite (PHASE-044 T-04; §2.3; I-03, PP-12): the rule
 * engine (priority-ordered, first match wins), the goods-receipt task
 * generation, the scan-confirmed structural move (bins move, item_stock
 * never), the wrong-bin typed rejection with zero residue, the idempotent
 * replay, and the fixed-format bin label (PP-12 — BIN-LABEL-V1).
 */

let putaway: PutawayService;
let fixture: InventoryFixture;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  putaway = new PutawayService(new AuditService(new DrizzleAuditStore()) as AuditService);
});

async function binSum(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_I, async () => {
    const rows = await wmsStore.listBinContents({ warehouseId, itemId, limit: 1000 });
    return rows
      .filter((r) => r.ownerPartnerId === null)
      .reduce((acc, r) => acc + Number(r.qty), 0)
      .toFixed(6);
  });
}

async function stockQty(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_I, async () => {
    const row = await store.findItemStock(itemId, warehouseId);
    return row?.qty ?? "0.000000";
  });
}

describe("the rule engine (§2.3; I-03)", () => {
  it("validates the condition vocabulary and the exactly-one-target law fail-closed", async () => {
    await expect(
      withTenant(TENANT_I, () =>
        putaway.createRule({
          priority: 500,
          name: "bad key",
          condition: { nope: true },
          targetZoneType: "BULK",
          targetBinId: null,
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(PutawayRuleInvalidError);
    await expect(
      withTenant(TENANT_I, () =>
        putaway.createRule({
          priority: 501,
          name: "both targets",
          condition: {},
          targetZoneType: "BULK",
          targetBinId: "00000000-0000-4000-8000-000000000001",
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(PutawayRuleInvalidError);
    await expect(
      withTenant(TENANT_I, () =>
        putaway.createRule({
          priority: 502,
          name: "no target",
          condition: {},
          targetZoneType: null,
          targetBinId: null,
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(PutawayRuleInvalidError);
  });

  it("first match wins by priority; a zone-type target resolves the EMPTIEST bin; no match → null", async () => {
    const item = await ensureInventoryItem("INV-PUT-01", "Putaway engine item");
    const wh = fixture.warehouseMain;
    // The BULK zone with two bins; one already holds stock (the emptier wins).
    await withTenant(TENANT_I, () =>
      putaway.createRule({
        priority: 10,
        name: "bulk default",
        condition: {},
        targetZoneType: "BULK",
        targetBinId: null,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const wmsZone = await withTenant(TENANT_I, () =>
      wmsStore.insertZone({
        warehouseId: wh,
        code: "BULK-P",
        name: "Bulk P",
        nameAr: null,
        zoneType: "BULK",
        isDefault: false,
        note: null,
        createdBy: I_ACTOR,
      }),
    );
    const aisle = await withTenant(TENANT_I, () =>
      wmsStore.insertAisle({ zoneId: wmsZone.id, code: "P1", name: "P1", nameAr: null, createdBy: I_ACTOR }),
    );
    const rack = await withTenant(TENANT_I, () =>
      wmsStore.insertRack({ aisleId: aisle.id, code: "R1", name: "R1", nameAr: null, createdBy: I_ACTOR }),
    );
    const emptyBin = await withTenant(TENANT_I, () =>
      wmsStore.insertBin({
        warehouseId: wh,
        rackId: rack.id,
        code: "P1-R1-02",
        barcode: "BIN-MAIN-BULK02",
        name: "Empty bulk",
        nameAr: null,
        pickSequence: 2,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        createdBy: I_ACTOR,
      }),
    );
    const usedBin = await withTenant(TENANT_I, () =>
      wmsStore.insertBin({
        warehouseId: wh,
        rackId: rack.id,
        code: "P1-R1-01",
        barcode: "BIN-MAIN-BULK01",
        name: "Used bulk",
        nameAr: null,
        pickSequence: 1,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        createdBy: I_ACTOR,
      }),
    );
    // 5 units of ANOTHER item into usedBin through the REAL posting
    // pipeline (no orphan moves — the INV-018 discipline).
    const other = await ensureInventoryItem("INV-PUT-01X", "Bulk occupant");
    await wmsBinReceipt({
      itemId: other,
      warehouseId: wh,
      qty: "5",
      unitCost: "1.000000",
      movedAt: I_JAN,
      targetBinId: usedBin.id,
    });

    const suggestion = await withTenant(TENANT_I, () =>
      putaway.suggestBin({ warehouseId: wh, itemId: item, qty: "10" }),
    );
    // The catch-all rule (priority 10) targets BULK → the EMPTIEST bin wins
    // over the lower pick_sequence bin that already holds stock.
    expect(suggestion!.bin.id).toBe(emptyBin.id);

    // A HIGHER-priority (lower number) skuPrefix rule wins over it.
    await withTenant(TENANT_I, () =>
      putaway.createRule({
        priority: 5,
        name: "put items",
        condition: { skuPrefix: "INV-PUT" },
        targetZoneType: null,
        targetBinId: usedBin.id,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const second = await withTenant(TENANT_I, () =>
      putaway.suggestBin({ warehouseId: wh, itemId: item, qty: "10" }),
    );
    expect(second!.bin.id).toBe(usedBin.id);

    // Deactivate it → the catch-all serves again.
    const rules = await withTenant(TENANT_I, () => putaway.listRules(true));
    const prefixRule = rules.find((r) => r.name === "put items")!;
    await withTenant(TENANT_I, () => putaway.updateRule(prefixRule.id, { isActive: false }, I_ACTOR));
    const third = await withTenant(TENANT_I, () =>
      putaway.suggestBin({ warehouseId: wh, itemId: item, qty: "10" }),
    );
    expect(third!.bin.id).toBe(emptyBin.id);

    // Cleanup: deactivate the catch-all too — the later suites' "no rule
    // matches" case must not see it (rules are tenant-global).
    await withTenant(TENANT_I, () =>
      putaway.updateRule(rules.find((r) => r.name === "bulk default")!.id, { isActive: false }, I_ACTOR),
    );
  });
});

describe("receipt task generation + scan confirm (§6.3; PP-11/PP-12)", () => {
  it("a receipt generates PUTAWAY tasks from rules; the confirm moves the SLOT (item_stock never moves); the label is the fixed format", async () => {
    const item = await ensureInventoryItem("INV-PUT-02", "Putaway task item");
    const wh = fixture.warehouseMain;
    // Receipt 12 into the DEFAULT bin (the landing anchor).
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "12",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    const landing = (await withTenant(TENANT_I, () => wmsStore.findDefaultBin(wh)))!;

    // A dedicated pick face for THIS suite (self-contained — no dependency
    // on another spec's location tree).
    const zone = await withTenant(TENANT_I, () =>
      wmsStore.insertZone({
        warehouseId: wh,
        code: "PICK-PUT",
        name: "Pick PUT",
        nameAr: null,
        zoneType: "PICKING",
        isDefault: false,
        note: null,
        createdBy: I_ACTOR,
      }),
    );
    const aisle = await withTenant(TENANT_I, () =>
      wmsStore.insertAisle({ zoneId: zone.id, code: "PU1", name: "PU1", nameAr: null, createdBy: I_ACTOR }),
    );
    const rack = await withTenant(TENANT_I, () =>
      wmsStore.insertRack({ aisleId: aisle.id, code: "R1", name: "R1", nameAr: null, createdBy: I_ACTOR }),
    );
    const target = await withTenant(TENANT_I, () =>
      wmsStore.insertBin({
        warehouseId: wh,
        rackId: rack.id,
        code: "PU1-R1-01",
        barcode: "BIN-MAIN-PU0101",
        name: "Putaway face",
        nameAr: null,
        pickSequence: 4,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        createdBy: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () =>
      putaway.createRule({
        priority: 3,
        name: "put-02 to pick face",
        condition: { skuPrefix: "INV-PUT-02" },
        targetZoneType: null,
        targetBinId: target.id,
        note: null,
        actorId: I_ACTOR,
      }),
    );

    const tasks = await withTenant(TENANT_I, () =>
      putaway.generateTasksForReceipt({
        warehouseId: wh,
        lines: [
          {
            itemId: item,
            qty: "12",
            batchId: null,
            lpnId: null,
            sourceType: "goods_receipt",
            sourceId: "11111111-2222-4111-8111-111111111112",
            sourceLineNo: 1,
          },
        ],
        actorId: I_ACTOR,
      }),
    );
    expect(tasks).toHaveLength(1);
    const task = tasks[0]!;
    expect(task.taskKind).toBe("PUTAWAY");
    expect(task.status).toBe("PENDING");
    expect(task.fromBinId).toBe(landing.id);
    expect(task.toBinId).toBe(target.id);
    expect(task.qty).toBe("12.000000");

    // A wrong-bin scan: the typed rejection, ZERO residue.
    await expect(
      withTenant(TENANT_I, () =>
        putaway.confirm({ taskId: task.id, scannedBarcode: "BIN-MAIN-BULK01", actorId: I_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(WrongBinPutawayError);
    const stillPending = await withTenant(TENANT_I, () => wmsStore.findPickTaskById(task.id));
    expect(stillPending!.status).toBe("PENDING");

    // The correct scan: the structural move + completion + label.
    const stockBefore = await stockQty(wh, item);
    const { task: done, label } = await withTenant(TENANT_I, () =>
      putaway.confirm({ taskId: task.id, scannedBarcode: "BIN-MAIN-PU0101", actorId: I_ACTOR }),
    );
    expect(done.status).toBe("COMPLETED");
    expect(done.scanVerified).toBe(true);
    expect(done.qtyDone).toBe("12.000000");
    expect(done.completedAt).not.toBeNull();
    // item_stock NEVER moved (the structural-move law).
    expect(await stockQty(wh, item)).toBe(stockBefore);
    expect(await binSum(wh, item)).toBe("12.000000");
    const atTarget = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: target.id, itemId: item, limit: 5 }),
    );
    expect(atTarget[0]!.qty).toBe("12.000000");

    // PP-12: the fixed-format label.
    expect(label.labelFormat).toBe("BIN-LABEL-V1");
    expect(label.bin.barcode).toBe("BIN-MAIN-PU0101");
    expect(label.item.sku).toBe("INV-PUT-02");
    expect(label.qty).toBe("12.000000");

    // Idempotent replay: the stored row, never a second move.
    const replay = await withTenant(TENANT_I, () =>
      putaway.confirm({ taskId: task.id, scannedBarcode: "BIN-MAIN-PU0101", actorId: I_ACTOR }),
    );
    expect(replay.task.id).toBe(done.id);
    expect(replay.task.completedAt).toBe(done.completedAt);
    const atTargetAfter = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: target.id, itemId: item, limit: 5 }),
    );
    expect(atTargetAfter[0]!.qty).toBe("12.000000");

    // receiptLabels: one label per generated task of the receipt.
    const labels = await withTenant(TENANT_I, () =>
      putaway.receiptLabels("goods_receipt", "11111111-2222-4111-8111-111111111112"),
    );
    expect(labels).toHaveLength(1);
    expect(labels[0]!.taskId).toBe(task.id);
  });

  it("a line with NO matching rule generates NO task (the stock is already home)", async () => {
    const item = await ensureInventoryItem("INV-PUT-03", "No-rule item");
    const wh = fixture.warehouseMain;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "3",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: I_JAN,
        actorId: I_ACTOR,
      }),
    );
    const tasks = await withTenant(TENANT_I, () =>
      putaway.generateTasksForReceipt({
        warehouseId: wh,
        lines: [
          {
            itemId: item,
            qty: "3",
            batchId: null,
            lpnId: null,
            sourceType: "goods_receipt",
            sourceId: "11111111-2222-4111-8111-111111111113",
            sourceLineNo: 1,
          },
        ],
        actorId: I_ACTOR,
      }),
    );
    expect(tasks).toHaveLength(0);
  });
});
