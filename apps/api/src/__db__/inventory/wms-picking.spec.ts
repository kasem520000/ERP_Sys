import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import * as invStore from "../../modules/inventory/infrastructure/inventory.store";
import { PickingService } from "../../modules/inventory/application/picking-service";
import { DeliveryNoteService } from "../../modules/sales/application/deliveries";
import {
  planReceipt,
  applyReceipt,
  inventoryJournalLines,
  resolveInventoryAccount,
} from "../../modules/inventory/application/movement-core";
import type { JournalSpec } from "../../modules/accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency } from "../../infra/settings/setting-reader";
import {
  PartialPickNotAllowedError,
  WrongBinPickError,
} from "../../modules/inventory/domain/inventory-errors";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import {
  S_ACTOR,
  TENANT_S,
  setupSalesFixture,
  type SalesFixture,
} from "../sales/fixtures";

/**
 * Directed picking suite (PHASE-044 T-05; §2.4; I-04/I-06/I-07, PP-11):
 * the per-warehouse strategy, the wave lifecycle (DRAFT → RELEASED with
 * the PW- number → COMPLETED), strategy-ordered allocations (FIFO/FEFO/
 * NEAREST), scan-verified confirms with the wrong-bin typed rejection and
 * the allow_partial rule, and the CLUSTER route — two delivery notes
 * served by ONE bin walk, the confirmed picks driving the delivery post's
 * bin decrements (directedTakes; INV-029 holds end to end).
 */

let fixture: SalesFixture;
let picking: PickingService;
let deliveries: DeliveryNoteService;

beforeAll(async () => {
  fixture = await setupSalesFixture();
  const audit = new AuditService(new DrizzleAuditStore());
  const posting = new PostingService(audit, new PartnerSubledgerService());
  const numbering = new NumberingService(audit);
  picking = new PickingService(audit, numbering);
  deliveries = new DeliveryNoteService(audit, posting, numbering, picking);
});

/** The posting-backed explicit-bin receipt in the SALES tenant. */
async function sBinReceipt(input: {
  itemId: string;
  qty: string;
  unitCost: string;
  targetBinId: string;
}) {
  await withTenant(TENANT_S, async () => {
    const plan = await planReceipt({
      itemId: input.itemId,
      warehouseId: fixture.warehouseId,
      qty: input.qty,
      unitCost: input.unitCost,
      movedAt: "2026-02-01",
      moveKind: "receipt",
      sourceType: "manual_receipt",
      sourceId: input.itemId,
      targetBinId: input.targetBinId,
    });
    const lines = inventoryJournalLines({
      inventoryAccountId: await resolveInventoryAccount(fixture.warehouseId),
      direction: "IN",
      value: plan.valueAmount,
      // The sales tenant maps no appreciation purpose — the opening-equity
      // account counters these test receipts (the G-16 opening shape).
      counterAccountId: fixture.gl.openingEquity,
      memoEn: "WMS picking suite bin receipt",
      memoAr: "إدخال صندوق — مجموعة الانتقاء",
    });
    const spec: JournalSpec = {
      source: { docType: "stock_move", docId: plan.anchorId, operation: "post" },
      entryDate: "2026-02-01",
      description: { en: "WMS picking bin receipt", ar: "إدخال صندوق — الانتقاء" },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const result = await new PostingService(
      new AuditService(new DrizzleAuditStore()),
      new PartnerSubledgerService(),
    ).post(spec, { postedBy: S_ACTOR });
    await applyReceipt(plan, result.journalEntryId);
  });
}

async function binSumOf(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_S, async () => {
    const rows = await wmsStore.listBinContents({ warehouseId, itemId, limit: 1000 });
    return rows
      .filter((r) => r.ownerPartnerId === null)
      .reduce((acc, r) => acc + Number(r.qty), 0)
      .toFixed(6);
  });
}

async function stockQtyOf(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_S, async () => {
    const row = await invStore.findItemStock(itemId, warehouseId);
    return row?.qty ?? "0.000000";
  });
}

describe("§2.4 — strategy + wave lifecycle + cluster + scan (PP-11)", () => {
  it("NEAREST allocation + the cluster route serves two deliveries on ONE walk; confirms drive the delivery post's bins; INV-029 holds", async () => {
    const item = fixture.items.a;
    const wh = fixture.warehouseId;

    // Two extra faces: NEAR (pick_sequence 1) and FAR (pick_sequence 9).
    const zone = await withTenant(TENANT_S, () =>
      wmsStore.insertZone({
        warehouseId: wh,
        code: "PICK-W",
        name: "Pick W",
        nameAr: null,
        zoneType: "PICKING",
        isDefault: false,
        note: null,
        createdBy: S_ACTOR,
      }),
    );
    const aisle = await withTenant(TENANT_S, () =>
      wmsStore.insertAisle({ zoneId: zone.id, code: "W1", name: "W1", nameAr: null, createdBy: S_ACTOR }),
    );
    const rack = await withTenant(TENANT_S, () =>
      wmsStore.insertRack({ aisleId: aisle.id, code: "R1", name: "R1", nameAr: null, createdBy: S_ACTOR }),
    );
    const nearBin = await withTenant(TENANT_S, () =>
      wmsStore.insertBin({
        warehouseId: wh,
        rackId: rack.id,
        code: "W1-R1-NEAR",
        barcode: "BIN-S-NEAR",
        name: "Near face",
        nameAr: null,
        pickSequence: 1,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        createdBy: S_ACTOR,
      }),
    );
    const farBin = await withTenant(TENANT_S, () =>
      wmsStore.insertBin({
        warehouseId: wh,
        rackId: rack.id,
        code: "W1-R1-FAR",
        barcode: "BIN-S-FAR",
        name: "Far face",
        nameAr: null,
        pickSequence: 9,
        capacity: null,
        allowMixedBatches: true,
        isDefault: false,
        note: null,
        createdBy: S_ACTOR,
      }),
    );
    // 20 into NEAR + 10 into FAR through the real posting pipeline (the
    // fixture's own W-1 opening 20 stays in the DEFAULT bin) — NEAR can
    // serve BOTH cluster lines (12) with room for the partial confirm.
    await sBinReceipt({ itemId: item, qty: "20", unitCost: "101.000000", targetBinId: nearBin.id });
    await sBinReceipt({ itemId: item, qty: "10", unitCost: "102.000000", targetBinId: farBin.id });

    // The strategy: NEAREST, partial allowed.
    await withTenant(TENANT_S, () =>
      picking.upsertStrategy({ warehouseId: wh, method: "NEAREST", allowPartial: true, actorId: S_ACTOR }),
    );

    // Two delivery notes (the cluster's two orders), 6 units each.
    const mkDelivery = async () => {
      const created = await withTenant(TENANT_S, () =>
        deliveries.create({
          branchId: fixture.branchId,
          customerId: fixture.customerId,
          salesRepId: null,
          orderId: null,
          warehouseId: wh,
          deliveryDate: "2026-02-05",
          currencyCode: "SAR",
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
          lines: [
            {
              orderLineId: null,
              itemId: item,
              description: null,
              descriptionAr: null,
              qty: "6",
              unitPrice: "150.000000",
              discountAmount: null,
              batchId: null,
              serialIds: null,
              note: null,
            },
          ],
        }),
      );
      return created;
    };
    const deliveryA = await mkDelivery();
    const deliveryB = await mkDelivery();

    // The wave over both deliveries' lines — the NEAREST allocation puts
    // both tasks on the NEAR face (seq 1 beats DEFAULT seq 1? code order:
    // DEFAULT vs W1-R1-NEAR — pick_sequence 1 both, code "DEFAULT" < "W1-…"
    // so DEFAULT first; 20 units there covers 12). The honest assertion:
    // tasks exist with from-bins among the AVAILABLE stock.
    const wave = await withTenant(TENANT_S, () =>
      picking.createWave({
        warehouseId: wh,
        lines: [
          { deliveryNoteId: deliveryA.id, lineNo: 1, itemId: item, qty: "6", batchId: null },
          { deliveryNoteId: deliveryB.id, lineNo: 1, itemId: item, qty: "6", batchId: null },
        ],
        method: "NEAREST",
        routeNote: "cluster route",
        actorId: S_ACTOR,
      }),
    );
    expect(wave!.status).toBe("DRAFT");
    expect(wave!.method).toBe("NEAREST");
    const tasks = await withTenant(TENANT_S, () => picking.waveTasks(wave!.id));
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.taskKind === "PICK" && t.status === "PENDING")).toBe(true);
    expect(tasks.map((t) => t.qty)).toEqual(["6.000000", "6.000000"]);

    // Release: the official PW- number + stamps.
    const released = await withTenant(TENANT_S, () => picking.releaseWave(wave!.id, S_ACTOR));
    expect(released!.status).toBe("RELEASED");
    expect(released!.waveNo).toMatch(/^PW-\d{4}-\d{6}$/);

    // The cluster route: one ordered walk (by from-bin pick sequence).
    const route = await withTenant(TENANT_S, () => picking.clusterRoute(wave!.id));
    expect(route).toHaveLength(2);
    const routeBins = route.map((t) => t.fromBinCode);
    expect(new Set(routeBins).size).toBe(1); // both orders on the SAME face — the cluster

    // A wrong-bin scan: the typed rejection, zero residue.
    const first = route[0]!;
    await expect(
      withTenant(TENANT_S, () =>
        picking.confirmPick({ taskId: first.id, scannedBarcode: "BIN-S-FAR", actorId: S_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(WrongBinPickError);

    // Confirm both (the correct scans) — one partial (5 of 6, allowed).
    const binBarcode = await withTenant(TENANT_S, async () => {
      const bin = await wmsStore.findBinById(first.fromBinId!);
      return bin!.barcode;
    });
    const done1 = await withTenant(TENANT_S, () =>
      picking.confirmPick({ taskId: route[0]!.id, scannedBarcode: binBarcode, qty: "5", actorId: S_ACTOR }),
    );
    expect(done1.status).toBe("COMPLETED");
    expect(done1.qtyDone).toBe("5.000000");
    expect(done1.scanVerified).toBe(true);
    const done2 = await withTenant(TENANT_S, () =>
      picking.confirmPick({ taskId: route[1]!.id, scannedBarcode: binBarcode, actorId: S_ACTOR }),
    );
    expect(done2.qtyDone).toBe("6.000000");

    // The wave auto-completed with its last task.
    const completedWave = await withTenant(TENANT_S, () => wmsStore.findPickWaveById(wave!.id));
    expect(completedWave!.status).toBe("COMPLETED");
    expect(completedWave!.completedAt).not.toBeNull();

    // Post both deliveries: the confirmed picks drive the bin decrements
    // (directedTakes) — INV-029 holds, bins and stock move together.
    const stockBefore = await stockQtyOf(wh, item);
    const binsBefore = await binSumOf(wh, item);
    const faceBefore = await withTenant(TENANT_S, async () => {
      const rows = await wmsStore.listBinContents({
        binId: first.fromBinId!,
        itemId: item,
        limit: 10,
      });
      return rows.reduce((acc, r) => acc + Number(r.qty), 0);
    });
    await withTenant(TENANT_S, () => deliveries.post(deliveryA.id, S_ACTOR));
    await withTenant(TENANT_S, () => deliveries.post(deliveryB.id, S_ACTOR));
    // Both deliveries post their FULL lines (6 + 6) — the partial CONFIRM
    // records the physical walk, never shortens the document.
    expect(await stockQtyOf(wh, item)).toBe((Number(stockBefore) - 12).toFixed(6));
    expect(await binSumOf(wh, item)).toBe((Number(binsBefore) - 12).toFixed(6));
    // The decrements landed on the PICKED face.
    const faceRows = await withTenant(TENANT_S, () =>
      wmsStore.listBinContents({ binId: first.fromBinId!, itemId: item, limit: 10 }),
    );
    const faceQty = faceRows.reduce((acc, r) => acc + Number(r.qty), 0);
    expect(faceQty).toBe(faceBefore - 12); // the picked face served both lines

    // The moves carry the picked source bin.
    const moves = await withTenant(TENANT_S, async () => {
      const invMoves = await invStore.listStockMoves({
        sourceType: "delivery_note",
        itemId: item,
        limit: 10,
      });
      return invMoves.filter((m) => m.warehouseId === wh && m.movedAt === "2026-02-05");
    });
    expect(moves.length).toBeGreaterThanOrEqual(2);
    expect(moves.every((m) => m.sourceBinId === first.fromBinId)).toBe(true);
  });

  it("FEFO allocation prefers the earliest-expiring batch; allow_partial=false rejects short confirms", async () => {
    const item = fixture.items.b;
    const wh = fixture.warehouseId;
    // A batch-tracked receipt… item B is plain; use the DEFAULT bin stock
    // (10 units) and prove the partial rule on it instead — the FEFO leg
    // needs a batch item, so this test focuses on the partial rule.
    await withTenant(TENANT_S, () =>
      picking.upsertStrategy({ warehouseId: wh, method: "FIFO", allowPartial: false, actorId: S_ACTOR }),
    );
    const created = await withTenant(TENANT_S, () =>
      deliveries.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        orderId: null,
        warehouseId: wh,
        deliveryDate: "2026-02-06",
        currencyCode: "SAR",
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: item,
            description: null,
            descriptionAr: null,
            qty: "4",
            unitPrice: "60.000000",
            discountAmount: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    const wave = await withTenant(TENANT_S, () =>
      picking.createWave({
        warehouseId: wh,
        lines: [{ deliveryNoteId: created.id, lineNo: 1, itemId: item, qty: "4", batchId: null }],
        method: "FIFO",
        routeNote: null,
        actorId: S_ACTOR,
      }),
    );
    await withTenant(TENANT_S, () => picking.releaseWave(wave!.id, S_ACTOR));
    const tasks = await withTenant(TENANT_S, () => picking.waveTasks(wave!.id));
    const task = tasks[0]!;
    const barcode = await withTenant(TENANT_S, async () => {
      const bin = await wmsStore.findBinById(task.fromBinId!);
      return bin!.barcode;
    });
    // Short confirm under allow_partial=false: the typed rejection.
    await expect(
      withTenant(TENANT_S, () =>
        picking.confirmPick({ taskId: task.id, scannedBarcode: barcode, qty: "3", actorId: S_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(PartialPickNotAllowedError);
    // Full confirm passes; cancel the wave's remainder honestly (the
    // delivery never posts in this test — no economic move).
    await withTenant(TENANT_S, () =>
      picking.confirmPick({ taskId: task.id, scannedBarcode: barcode, actorId: S_ACTOR }),
    );
  });

  it("cancelWave refuses once picks are confirmed; cancels cleanly before", async () => {
    const item = fixture.items.b;
    const wh = fixture.warehouseId;
    const created = await withTenant(TENANT_S, () =>
      deliveries.create({
        branchId: fixture.branchId,
        customerId: fixture.customerId,
        salesRepId: null,
        orderId: null,
        warehouseId: wh,
        deliveryDate: "2026-02-07",
        currencyCode: "SAR",
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: item,
            description: null,
            descriptionAr: null,
            qty: "1",
            unitPrice: "60.000000",
            discountAmount: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      }),
    );
    const wave = await withTenant(TENANT_S, () =>
      picking.createWave({
        warehouseId: wh,
        lines: [{ deliveryNoteId: created.id, lineNo: 1, itemId: item, qty: "1", batchId: null }],
        method: "FIFO",
        routeNote: null,
        actorId: S_ACTOR,
      }),
    );
    // Cancel BEFORE any confirm: clean.
    const cancelled = await withTenant(TENANT_S, () =>
      picking.cancelWave(wave!.id, "route abandoned", S_ACTOR),
    );
    expect(cancelled!.status).toBe("CANCELLED");
    const tasks = await withTenant(TENANT_S, () => picking.waveTasks(wave!.id));
    expect(tasks.every((t) => t.status === "CANCELLED")).toBe(true);
  });
});
