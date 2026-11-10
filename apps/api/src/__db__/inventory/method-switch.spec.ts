import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import {
  I_ACTOR,
  TENANT_I,
  ensureInventoryItem,
  methodSwitcher,
  setupInventoryFixture,
  stock,
  transfers,
  type InventoryFixture,
} from "./fixtures";

/**
 * INV-017 method-switch suite (PHASE-010 §2.6/§6; BR-014): an item never
 * mixes methods; switching requires no in-flight transactions and
 * produces a DATED REVALUATION posting when the basis changes at the
 * money quantum; retroactive restatement is structurally impossible
 * (append-only moves) — history queries return the ORIGINAL issue costs.
 * Self-contained on dedicated items.
 */

let fixture: InventoryFixture;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
});

describe("INV-017 — method lock + dated revaluation switch", () => {
  it("FIFO→WAC with a basis drift posts the revaluation journal; past issues unchanged", async () => {
    // Layers engineered for a 4dp drift: 3000 units across 1.111111 and
    // 2.222222 → Σ = 5555.555; blended avg (6dp) = 1.851852 → 3000×avg
    // = 5555.556 → delta = +0.0001 (appreciation, G-14-shaped).
    const fifoItem = await ensureInventoryItem("INV-V-MS-F2W", "Switch FIFO→WAC item", {
      costingMethod: "FIFO",
    });
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: fifoItem,
        warehouseId: fixture.warehouseMain,
        qty: "1000",
        unitCost: "1.111111",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: fifoItem,
        warehouseId: fixture.warehouseMain,
        qty: "2000",
        unitCost: "2.222222",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-06",
        actorId: I_ACTOR,
      }),
    );
    // A historical issue to protect (INV-017: its stored cost must never
    // change): 100 @ 1.111111 = 111.1111.
    const historical = await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: fifoItem,
        warehouseId: fixture.warehouseMain,
        qty: "100",
        reason: "OTHER",
        counterAccountId: fixture.glCogs,
        valueDate: "2026-01-07",
        actorId: I_ACTOR,
      }),
    );
    expect(historical.valueAmount).toBe("111.1111");

    const preview = await withTenant(TENANT_I, () =>
      methodSwitcher.preview({ itemId: fifoItem, targetMethod: "WAC" }),
    );
    // The 6dp blended average vs the exact layer sum leaves a rounding
    // drift at the money quantum — with these layers it lands negative
    // (shrinkage-shaped): DR SHRINKAGE · CR INVENTORY.
    expect(preview.journalShape).toMatchObject({
      debit: "INVENTORY_SHRINKAGE",
      credit: "INVENTORY",
    });

    const result = await withTenant(TENANT_I, () =>
      methodSwitcher.switch({
        itemId: fifoItem,
        targetMethod: "WAC",
        switchDate: "2026-01-10",
        actorId: I_ACTOR,
      }),
    );
    expect(result.costingMethod).toBe("WAC");
    // The dated revaluation posting: DR SHRINKAGE · CR INVENTORY for the
    // drift (the 6dp average basis vs the exact layer sum).
    expect(result.journalEntryId).not.toBeNull();
    const lines = await withTenant(TENANT_I, () =>
      journal.listLines(result.journalEntryId!),
    );
    expect(lines.length).toBe(2);
    expect(lines[0]!.accountId).toBe(fixture.glShrinkage);
    expect(lines[0]!.direction).toBe("DEBIT");
    expect(lines[1]!.accountId).toBe(fixture.glInventory);
    expect(lines[1]!.direction).toBe("CREDIT");
    expect(lines[0]!.amount).toBe(lines[1]!.amount);

    // The revaluation move row exists (adjust kind, METHOD_SWITCH reason).
    const revalMoves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "method_switch", sourceId: fifoItem, limit: 10 }),
    );
    expect(revalMoves.length).toBe(1);
    expect(revalMoves[0]!.reason).toBe("METHOD_SWITCH");
    expect(revalMoves[0]!.postedJournalId).toBe(result.journalEntryId);

    // Past issues unchanged: the historical issue still prices 111.1111
    // (the revaluation move is a separate adjust row — never a rewrite).
    const historyMoves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ itemId: fifoItem, direction: "OUT", limit: 10 }),
    );
    const historicalIssue = historyMoves.find((move) => move.movedAt === "2026-01-07");
    expect(historicalIssue!.valueAmount).toBe("111.1111");
    expect(historicalIssue!.qty).toBe("100.000000");

    // The item's method is WAC now (issues price at the blended average).
    const issueAfter = await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: fifoItem,
        warehouseId: fixture.warehouseMain,
        qty: "1",
        reason: "OTHER",
        counterAccountId: fixture.glCogs,
        valueDate: "2026-01-11",
        actorId: I_ACTOR,
      }),
    );
    const onHand = await withTenant(TENANT_I, () =>
      store.findItemStock(fifoItem, fixture.warehouseMain),
    );
    expect(onHand!.qty).toBe("2899.000000");
    expect(issueAfter.valueAmount).toBe(
      new (await import("@erp/domain-core")).Decimal(onHand!.avgCost).toFixed(4),
    );
    // Re-switching to the same method is refused (BR-014 lock).
    await expect(
      withTenant(TENANT_I, () =>
        methodSwitcher.switch({
          itemId: fifoItem,
          targetMethod: "WAC",
          switchDate: "2026-01-12",
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "METHOD_SWITCH_SAME" });
  });

  it("WAC→FIFO re-bases layers at book value with NO journal (delta 0 by construction)", async () => {
    const wacItem = await ensureInventoryItem("INV-V-MS-W2F", "Switch WAC→FIFO item");
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: wacItem,
        warehouseId: fixture.warehouseMain,
        qty: "50",
        unitCost: "3.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: I_ACTOR,
      }),
    );
    const before = await withTenant(TENANT_I, () =>
      store.findItemStock(wacItem, fixture.warehouseMain),
    );
    const result = await withTenant(TENANT_I, () =>
      methodSwitcher.switch({
        itemId: wacItem,
        targetMethod: "FIFO",
        switchDate: "2026-01-10",
        actorId: I_ACTOR,
      }),
    );
    // Book value preserved → delta rounds below the money quantum → the
    // documented zero-revaluation switch (no journal, full audit).
    expect(result.revaluationDelta).toBe("0.0000");
    expect(result.journalEntryId).toBeNull();
    const after = await withTenant(TENANT_I, () =>
      store.findItemStock(wacItem, fixture.warehouseMain),
    );
    expect(after!.qty).toBe(before!.qty);
    expect(after!.avgCost).toBe(before!.avgCost);
    // The substrate re-based: ONE live layer at the average cost, no
    // synthetic move rows (the money trail is untouched).
    const layers = await withTenant(TENANT_I, () =>
      store.listLiveLayers(wacItem, fixture.warehouseMain),
    );
    expect(layers.length).toBe(1);
    expect(layers[0]!.remainingQty).toBe("50.000000");
    expect(layers[0]!.unitCost).toBe("3.000000");
    const revalMoves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "method_switch", sourceId: wacItem, limit: 10 }),
    );
    expect(revalMoves.length).toBe(0);
    // FIFO issues now consume the re-based layer.
    const issue = await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: wacItem,
        warehouseId: fixture.warehouseMain,
        qty: "10",
        reason: "OTHER",
        counterAccountId: fixture.glCogs,
        valueDate: "2026-01-11",
        actorId: I_ACTOR,
      }),
    );
    expect(issue.valueAmount).toBe("30.0000");
  });

  it("in-flight transactions refuse the switch (BR-014 no-open-transactions)", async () => {
    const wacItem = await ensureInventoryItem("INV-V-MS-FLIGHT", "Switch in-flight item");
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: wacItem,
        warehouseId: fixture.warehouseMain,
        qty: "20",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: I_ACTOR,
      }),
    );
    // An IN_TRANSIT transfer line holding the item.
    const created = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: fixture.warehouseMain,
        toWarehouseId: fixture.warehouseSecond,
        lines: [{ itemId: wacItem, qty: "5" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => transfers.dispatch(created.id, I_ACTOR));
    await expect(
      withTenant(TENANT_I, () =>
        methodSwitcher.switch({
          itemId: wacItem,
          targetMethod: "FIFO",
          switchDate: "2026-01-10",
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "METHOD_SWITCH_IN_FLIGHT" });
    // Settle the transfer, then the switch passes.
    await withTenant(TENANT_I, () => transfers.receive(created.id, I_ACTOR));
    const result = await withTenant(TENANT_I, () =>
      methodSwitcher.switch({
        itemId: wacItem,
        targetMethod: "FIFO",
        switchDate: "2026-01-12",
        actorId: I_ACTOR,
      }),
    );
    expect(result.costingMethod).toBe("FIFO");
  });
});
