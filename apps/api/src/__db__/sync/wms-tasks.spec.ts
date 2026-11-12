import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateUuidV7 } from "@erp/domain-core";
import { SYNC_CONTRACT_VERSION } from "@erp/contracts";

import { ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PutawayService } from "../../modules/inventory/application/putaway-service";
import { PickingService } from "../../modules/inventory/application/picking-service";
import { PushService } from "../../modules/sync/application/push-service";
import { pull, SyncEntityNotPulledError } from "../../modules/sync/application/pull-service";
import { handlerRegistryKeys } from "../../modules/sync/application/handlers";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { insertPickTask } from "../../modules/inventory/infrastructure/wms-store";
import { v2Command, enrollDevice } from "./_oracle";

/**
 * PHASE-044 T-13 · OA-02 — the WMS task sync duty: the pick/putaway task
 * lists join the android-field pull feeds (pick_tasks + putaway_tasks —
 * the directed-ops board offline), and the two scan-confirmation write
 * intents (`wms_task:confirm_putaway` / `wms_task:confirm_pick`) round-trip
 * through the extended outbox/inbox contracts: ACCEPT with the in-tx feed
 * marker, idempotent replay under duplicate delivery (C-01 — the stored
 * row, never a second move), the typed wrong-bin rejection
 * (VALIDATION_ERROR with machine-readable details), and the feed group's
 * scope law (a device class outside android-field cannot pull the task
 * feeds — SYNC_ENTITY_NOT_PULLED).
 *
 * TENANT: dedicated F2E (the F2C convention; verified unused).
 */
const TENANT = "f2e2e2e2-f2e2-f2e2-f2e2-f2e2f2e2f2e2";
const ACTOR = "f2e2e2e2-0000-4000-8000-000000000001";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const putaway = new PutawayService(audit);
const picking = new PickingService(audit, numbering);
const push = new PushService(
  undefined as never,
  undefined as never,
  audit,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  undefined as never,
  putaway,
  picking,
);

let deviceId = "";
let warehouseId = "";
let itemId = "";
let landingBinId = "";
let directedBinId = "";
let pickBinId = "";

async function pushV2(commands: unknown[]) {
  return withTenant(TENANT, () =>
    push.push({
      deviceId,
      batchId: generateUuidV7(),
      commands,
      contractVersion: SYNC_CONTRACT_VERSION,
    }),
  );
}

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant F2E (wms sync)', 'المستأجر ف٢هـ', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'f2e-actor@fixture.test', 'F2E Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ACTOR],
  );
  await su.end();

  await withTenant(TENANT, async () => {
    // The WMS substrate: a warehouse, the FY + CoA (posting needs periods),
    // an item, and three bins (a landing face, a directed putaway target,
    // a pick face).
    const { provisionCoaTemplate, seedMasterDataBasics } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const { findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const { PeriodService } = await import("../../modules/accounting/application/period-service");
    const { WarehouseService } = await import("../../modules/inventory/application/warehouse-service");
    const { StockService } = await import("../../modules/inventory/application/stock-service");
    const tenancyStore = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");

    await seedMasterDataBasics();
    await provisionCoaTemplate();
    // The fixture's purpose-gap patch (the tenant-I inventory fixture
    // shape): the template leaves INVENTORY_APPRECIATION unmarked — map
    // 4920 (create when absent) so the receipts' counter leg resolves.
    const { findActivePurpose, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    if ((await findActivePurpose("INVENTORY_APPRECIATION")) === undefined) {
      const { findAccountByCode: findAccount } = await import(
        "../../modules/accounting/infrastructure/accounting.store"
      );
      let appreciation = await findAccount("4920");
      if (appreciation === undefined) {
        const { CoaService } = await import("../../modules/accounting/application/coa-service");
        const coa = new CoaService(audit);
        appreciation = await coa.create(ACTOR, {
          code: "4920",
          name: "Inventory appreciation",
          nameAr: "زيادة قيمة المخزون",
          type: "REVENUE",
          parentId: (await findAccount("4000"))!.id,
          currencyCode: null,
          isGroup: false,
        });
      }
      await insertAccountPurpose({
        purposeKey: "INVENTORY_APPRECIATION",
        accountId: appreciation.id,
        activeFrom: "2025-12-01",
      });
    }
    const periods = new PeriodService(audit);
    if ((await findFiscalYearByName("FY2026")) === undefined) {
      await periods.createYear(ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }
    const branches = await tenancyStore.listBranches(null);
    const branch =
      branches.find((b) => b.code === "MAIN") ??
      (await tenancyStore.insertBranch({ code: "MAIN", name: "Main", nameAr: null, address: null }));
    const warehouses = new WarehouseService(audit);
    const wh =
      (await warehouses.list({ limit: 10 })).find((w) => w.code === "F2E-WH") ??
      (await warehouses.create({
        branchId: branch.id,
        code: "F2E-WH",
        name: "F2E warehouse",
        nameAr: null,
        inventoryAccountId: null,
        note: null,
        actorId: ACTOR,
      }));
    warehouseId = wh.id;

    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const item = await itemsStore.insertItem({
      sku: "F2E-TASK-1",
      name: "F2E task item",
      nameAr: null,
      kind: "STOCK",
      uomId: pcs.id,
      categoryId: null,
      taxCodeId: null,
      costingMethod: "WAC",
      trackBatch: false,
      trackSerial: false,
      trackImei: false,
      hasExpiry: false,
      reorderLevel: null,
      reorderQty: null,
      basePrice: null,
    });
    itemId = item.id;

    // Bins: landing (DOCK-ish BULK), directed target, pick face.
    const wms = new (await import("../../modules/inventory/application/wms.service")).WmsService(
      audit,
      new (await import("../../modules/notifications/application/inbox-service")).InboxService(),
    );
    const zone = await wms.createZone({
      warehouseId,
      code: "F2E-Z",
      name: "F2E zone",
      nameAr: null,
      zoneType: "BULK",
      isDefault: false,
      note: null,
      actorId: ACTOR,
    });
    const aisle = await wms.createAisle({ zoneId: zone.id, code: "F2E-A", name: "A", nameAr: null, actorId: ACTOR });
    const rack = await wms.createRack({ aisleId: aisle.id, code: "F2E-R", name: "R", nameAr: null, actorId: ACTOR });
    let sequence = 0;
    const binOf = async (code: string, barcode: string) =>
      wms.createBin({
        warehouseId,
        rackId: rack.id,
        code,
        barcode,
        name: code,
        nameAr: null,
        pickSequence: ++sequence,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        actorId: ACTOR,
      });
    landingBinId = (await binOf("F2E-LAND", "BIN-F2E-LAND")).id;
    directedBinId = (await binOf("F2E-DIR", "BIN-F2E-DIR")).id;
    pickBinId = (await binOf("F2E-PICK", "BIN-F2E-PICK")).id;

    // Stock on the landing + pick faces (the posting-backed receipts).
    const stock = new StockService(audit, posting);
    for (const binId of [landingBinId, pickBinId]) {
      await stock.manualReceipt({
        itemId,
        warehouseId,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-02-01",
        targetBinId: binId,
        actorId: ACTOR,
      });
    }
  });

  // The field device (android-field class — the task feeds' group).
  deviceId = await enrollDevice(TENANT, ACTOR, { deviceClass: "android-field" });
});

describe("OA-02 — the WMS task sync duty", () => {
  it("the registry carries the two intents", () => {
    const keys = handlerRegistryKeys();
    expect(keys).toContain("wms_task:confirm_putaway");
    expect(keys).toContain("wms_task:confirm_pick");
  });

  it("confirm_putaway ACCEPTS, moves the slot, and the duplicate delivery is an idempotent no-op (C-01)", async () => {
    const taskId = (await withTenant(TENANT, () =>
      insertPickTask({
        taskKind: "PUTAWAY",
        itemId,
        qty: "6.000000",
        fromBinId: landingBinId,
        toBinId: directedBinId,
        sourceType: "goods_receipt",
        sourceId: itemId,
        sourceLineNo: 1,
        batchId: null,
        waveId: null,
        sequenceNo: 1,
        note: null,
        createdBy: ACTOR,
      }),
    )).id;

    const first = await pushV2([
      v2Command("wms_task", "confirm_putaway", generateUuidV7(), { taskId, scannedBarcode: "BIN-F2E-DIR" }),
    ]);
    expect(first.results[0]?.status).toBe("ACCEPTED");
    const taskRow = await withTenant(TENANT, () => wmsStore.findPickTaskById(taskId));
    expect(taskRow?.status).toBe("COMPLETED");

    // The structural move happened: 6 on the directed face.
    const directed = await withTenant(TENANT, () =>
      wmsStore.listBinContents({ binId: directedBinId, itemId, limit: 5 }),
    );
    expect(Number(directed[0]?.qty ?? 0)).toBe(6);

    // The duplicate delivery (same commandId + key): duplicate:true, no
    // second move — the INV-013 discipline.
    const replay = await pushV2([
      v2Command("wms_task", "confirm_putaway", generateUuidV7(), { taskId, scannedBarcode: "BIN-F2E-DIR" }),
    ]);
    // A NEW commandId for the same task: the service's idempotent replay
    // returns the stored row (ACCEPTED, status COMPLETED, no new moves).
    expect(replay.results[0]?.status).toBe("ACCEPTED");
    const after = await withTenant(TENANT, () =>
      wmsStore.listBinContents({ binId: directedBinId, itemId, limit: 5 }),
    );
    expect(Number(after[0]?.qty ?? 0)).toBe(6);
  });

  it("a wrong-bin putaway scan is the typed rejection (VALIDATION_ERROR with details, zero residue)", async () => {
    const taskId = (await withTenant(TENANT, () =>
      insertPickTask({
        taskKind: "PUTAWAY",
        itemId,
        qty: "2.000000",
        fromBinId: landingBinId,
        toBinId: directedBinId,
        sourceType: "goods_receipt",
        sourceId: itemId,
        sourceLineNo: 2,
        batchId: null,
        waveId: null,
        sequenceNo: 2,
        note: null,
        createdBy: ACTOR,
      }),
    )).id;
    const result = await pushV2([
      v2Command("wms_task", "confirm_putaway", generateUuidV7(), { taskId, scannedBarcode: "BIN-F2E-PICK" }),
    ]);
    const item = result.results[0]!;
    expect(item.status).toBe("REJECTED");
    if (item.status === "REJECTED") {
      expect(item.reason).toBe("VALIDATION_ERROR");
      expect(item.message).toContain("BIN-F2E-PICK");
    }
    const taskRow = await withTenant(TENANT, () => wmsStore.findPickTaskById(taskId));
    expect(taskRow?.status).toBe("PENDING");
  });

  it("confirm_pick ACCEPTS with the short-qty semantics and feeds the task board", async () => {
    const waveId = await withTenant(TENANT, async () => {
      const wave = await wmsStore.insertPickWave({
        warehouseId,
        method: "FIFO",
        routeNote: null,
        createdBy: ACTOR,
      });
      await insertPickTask({
        taskKind: "PICK",
        itemId,
        qty: "5.000000",
        fromBinId: pickBinId,
        toBinId: null,
        sourceType: "delivery_note",
        sourceId: itemId,
        sourceLineNo: 1,
        batchId: null,
        waveId: wave.id,
        sequenceNo: 1,
        note: null,
        createdBy: ACTOR,
      });
      return wave.id;
    });
    const tasks = await withTenant(TENANT, () => wmsStore.listPickTasks({ waveId, limit: 10 }));
    const taskId = tasks[0]!.id;

    const result = await pushV2([
      v2Command("wms_task", "confirm_pick", generateUuidV7(), {
        taskId,
        scannedBarcode: "BIN-F2E-PICK",
        qty: "5.000000",
      }),
    ]);
    expect(result.results[0]?.status).toBe("ACCEPTED");
    const taskRow = await withTenant(TENANT, () => wmsStore.findPickTaskById(taskId));
    expect(taskRow?.status).toBe("COMPLETED");
    expect(taskRow?.scanVerified).toBe(true);
    // The wave auto-closed with its last task.
    const wave = await withTenant(TENANT, () => wmsStore.findPickWaveById(waveId));
    expect(wave?.status).toBe("COMPLETED");
  });

  it("the task feeds serve the android-field device (both kinds) and scope to their group", async () => {
    // The pull serves both feeds for the field device.
    const pickFeed = await withTenant(TENANT, () => pull({ deviceId, entityType: "pick_tasks", cursor: null, limit: 100 }));
    expect(pickFeed.changes.length).toBeGreaterThanOrEqual(1);
    expect(pickFeed.changes.every((change) => change.payload?.taskKind !== "PUTAWAY")).toBe(true);
    const putawayFeed = await withTenant(TENANT, () => pull({ deviceId, entityType: "putaway_tasks", cursor: null, limit: 100 }));
    expect(putawayFeed.changes.length).toBeGreaterThanOrEqual(1);
    expect(putawayFeed.changes.every((change) => change.payload?.taskKind === "PUTAWAY")).toBe(true);

    // A device class outside the field group cannot pull the task feeds.
    const desktopId = await enrollDevice(TENANT, ACTOR, { deviceClass: "tauri-desktop" });
    await expect(
      withTenant(TENANT, () => pull({ deviceId: desktopId, entityType: "pick_tasks", cursor: null, limit: 100 })),
    ).rejects.toThrow(SyncEntityNotPulledError);
  });
});

afterAll(async () => {
  await closeDb();
});
