import { beforeAll, describe, expect, it, vi } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import {
  I_ACTOR,
  TENANT_I,
  ensureInventoryItem,
  inventoryReconciliation,
  setupInventoryFixture,
  stock,
  type InventoryFixture,
} from "./fixtures";

/**
 * Valuation-through-the-ledger suite (PHASE-010 §6): the pure engines'
 * properties proven against the PERSISTED rows — WAC blends through real
 * receipts/issues, FIFO multi-layer consumption order, layer conservation
 * (Σ remaining = on-hand exactly), BR-013's negative-stock policy (off by
 * default; when enabled issues price at the last known average), and the
 * INV-018 atomicity crash-injection (a mid-transaction abort leaves
 * NEITHER the journal nor the move rows).
 *
 * Self-contained: dedicated items (INV-V-*) so the suite stays
 * deterministic regardless of spec file order.
 */

let fixture: InventoryFixture;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
});

describe("FIFO through the real services", () => {
  it("consumes layers oldest-first across a multi-layer issue (oracle: 10@1 + 5@2 = 20)", async () => {
    const fifo = await ensureInventoryItem("INV-V-FIFO", "Valuation FIFO item", {
      costingMethod: "FIFO",
    });
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: fifo,
        warehouseId: fixture.warehouseMain,
        qty: "10",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-20",
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: fifo,
        warehouseId: fixture.warehouseMain,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-02-20",
        actorId: I_ACTOR,
      }),
    );
    const issue = await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: fifo,
        warehouseId: fixture.warehouseMain,
        qty: "15",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-03-01",
        actorId: I_ACTOR,
      }),
    );
    // Oracle: 10 @ 1.00 + 5 @ 2.00 = 20.0000 — oldest first, always.
    expect(issue.valueAmount).toBe("20.0000");

    // Conservation: Σ live layer qty == on-hand exactly (5 remains).
    const onHand = await withTenant(TENANT_I, () =>
      store.findItemStock(fifo, fixture.warehouseMain),
    );
    const layers = await withTenant(TENANT_I, () =>
      store.listAllLayers(fifo, fixture.warehouseMain),
    );
    const liveQty = layers
      .filter((layer) => Number(layer.remainingQty) > 0)
      .reduce((sum, layer) => sum + Number(layer.remainingQty), 0);
    expect(liveQty.toFixed(6)).toBe(onHand!.qty);
    expect(onHand!.qty).toBe("5.000000");
    expect(layers.filter((layer) => Number(layer.remainingQty) === 0).length).toBe(1);

    // INV-010 stays green through the whole sequence.
    const check = await withTenant(TENANT_I, () =>
      inventoryReconciliation.runStockCheck({
        asOf: "2026-03-10",
        runMode: "ON_DEMAND",
        checkedBy: I_ACTOR,
      }),
    );
    expect(check.status).toBe("OK");
  });

  it("a second issue consumes the next layers in order (remaining 5 @ 2.00)", async () => {
    const fifo = await ensureInventoryItem("INV-V-FIFO", "Valuation FIFO item", {
      costingMethod: "FIFO",
    });
    const issue = await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: fifo,
        warehouseId: fixture.warehouseMain,
        qty: "3",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-03-02",
        actorId: I_ACTOR,
      }),
    );
    // 3 @ 2.00 = 6.0000 (the 1.00 layer is fully consumed first).
    expect(issue.valueAmount).toBe("6.0000");
  });
});

describe("WAC through the real services", () => {
  it("blends receipts and prices issues at the current average (issue never mutates it)", async () => {
    const wac = await ensureInventoryItem("INV-V-WAC", "Valuation WAC item");
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: wac,
        warehouseId: fixture.warehouseMain,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: wac,
        warehouseId: fixture.warehouseMain,
        qty: "10",
        unitCost: "4.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-10",
        actorId: I_ACTOR,
      }),
    );
    let onHand = await withTenant(TENANT_I, () =>
      store.findItemStock(wac, fixture.warehouseMain),
    );
    expect(onHand!.qty).toBe("20.000000");
    expect(onHand!.avgCost).toBe("3.000000"); // (10×2 + 10×4) / 20

    const issue = await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: wac,
        warehouseId: fixture.warehouseMain,
        qty: "2",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-01-15",
        actorId: I_ACTOR,
      }),
    );
    // 2 × 3.00 = 6.0000.
    expect(issue.valueAmount).toBe("6.0000");
    onHand = await withTenant(TENANT_I, () =>
      store.findItemStock(wac, fixture.warehouseMain),
    );
    expect(onHand!.avgCost).toBe("3.000000"); // issues never mutate WAC
  });
});

describe("BR-013 — negative stock policy", () => {
  it("default OFF: crossing below zero fails INSUFFICIENT_STOCK with zero residue", async () => {
    const wac = await ensureInventoryItem("INV-V-WAC", "Valuation WAC item");
    const before = await withTenant(TENANT_I, () =>
      store.findItemStock(wac, fixture.warehouseMain),
    );
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId: wac,
          warehouseId: fixture.warehouseMain,
          qty: "1000000",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-03-05",
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    const after = await withTenant(TENANT_I, () =>
      store.findItemStock(wac, fixture.warehouseMain),
    );
    expect(after!.qty).toBe(before!.qty);
  });

  it("explicitly enabled: issues may go negative at the last known average (BR-013)", async () => {
    const wac = await ensureInventoryItem("INV-V-WAC", "Valuation WAC item");
    const { upsertSetting } = await import("../../modules/tenancy/infrastructure/tenancy.store");
    await withTenant(TENANT_I, () =>
      upsertSetting("inventory.allow_negative_stock", true, I_ACTOR),
    );
    try {
      const issue = await withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId: wac,
          warehouseId: fixture.warehouseMain,
          qty: "25",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-03-06",
          actorId: I_ACTOR,
        }),
      );
      // 18 on hand @ 3.00 → issue 25 → 25 × 3.00 = 75.0000 at the last
      // known average; the position ends at −7.
      expect(issue.valueAmount).toBe("75.0000");
      const onHand = await withTenant(TENANT_I, () =>
        store.findItemStock(wac, fixture.warehouseMain),
      );
      expect(onHand!.qty).toBe("-7.000000");
      expect(onHand!.avgCost).toBe("3.000000"); // last known average held
      // The ledger balance still holds: INV-010 green with the negative.
      const check = await withTenant(TENANT_I, () =>
        inventoryReconciliation.runStockCheck({
          asOf: "2026-03-10",
          runMode: "ON_DEMAND",
          checkedBy: I_ACTOR,
        }),
      );
      expect(check.status).toBe("OK");
    } finally {
      await withTenant(TENANT_I, () =>
        upsertSetting("inventory.allow_negative_stock", false, I_ACTOR),
      );
    }
  });
});

describe("INV-018 — atomicity crash injection", () => {
  it("an abort between POST and APPLY leaves NEITHER the journal nor the moves", async () => {
    const wac = await ensureInventoryItem("INV-V-CRASH", "Crash-injection item");
    const before = await withTenant(TENANT_I, () =>
      store.findItemStock(wac, fixture.warehouseMain),
    );
    const beforeCount = await withTenant(TENANT_I, () => store.countStockMoves());
    const entryProbe = await withTenant(TENANT_I, () =>
      journal.listEntries({ sourceType: "stock_move", limit: 500 }),
    );
    // Sabotage the apply boundary: insertStockMove throws AFTER the
    // engine posted — the WHOLE ambient transaction must roll back.
    const spy = vi
      .spyOn(store, "insertStockMove")
      .mockImplementation(() => Promise.reject(new Error("simulated crash mid-apply")));
    try {
      await expect(
        withTenant(TENANT_I, () =>
          stock.manualReceipt({
            itemId: wac,
            warehouseId: fixture.warehouseMain,
            qty: "1",
            unitCost: "9.000000",
            reason: "COUNT_GAIN",
            counterAccountId: null,
            valueDate: "2026-03-07",
            actorId: I_ACTOR,
          }),
        ),
      ).rejects.toThrow("simulated crash mid-apply");
    } finally {
      spy.mockRestore();
    }
    // NEITHER: no move rows, no journal entries, no read-model drift.
    const after = await withTenant(TENANT_I, () =>
      store.findItemStock(wac, fixture.warehouseMain),
    );
    const afterCount = await withTenant(TENANT_I, () => store.countStockMoves());
    const entryAfter = await withTenant(TENANT_I, () =>
      journal.listEntries({ sourceType: "stock_move", limit: 500 }),
    );
    expect(after?.qty ?? "0.000000").toBe(before?.qty ?? "0.000000");
    expect(afterCount).toBe(beforeCount);
    expect(entryAfter.rows.length).toBe(entryProbe.rows.length);
  });
});
