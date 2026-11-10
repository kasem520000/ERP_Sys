import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import {
  I_ACTOR,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  stock,
  tracking,
  type InventoryFixture,
} from "./fixtures";

/**
 * Tracking suite (PHASE-010 §2.11/§2.12/§6; BR-017/BR-018): batch-required
 * enforcement on tracked items, FEFO issuing for has_expiry items
 * (earliest expiry first — INVENTORY_ACCOUNTING §5's costing–picking
 * decoupling keeps the costing math untouched), serial binding with the
 * original-cost return (BR-018), and the expiry write-off posting as
 * shrinkage with reason EXPIRED. Self-contained on dedicated items.
 */

let fixture: InventoryFixture;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
});

async function receivePerishable(
  itemId: string,
  qty: string,
  cost: string,
  batchNo: string,
  expiry: string,
  date: string,
): Promise<void> {
  await withTenant(TENANT_I, () =>
    stock.manualReceipt({
      itemId,
      warehouseId: fixture.warehouseMain,
      qty,
      unitCost: cost,
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: date,
      batchNo,
      batchExpiry: expiry,
      actorId: I_ACTOR,
    }),
  );
}

describe("BR-017 — batch/expiry tracking with FEFO issuing", () => {
  it("tracked items REQUIRE a batch on receive (fail closed)", async () => {
    const perishable = await ensureInventoryItem("INV-V-PERISH", "Perishable tracked item", {
      trackBatch: true,
      hasExpiry: true,
    });
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualReceipt({
          itemId: perishable,
          warehouseId: fixture.warehouseMain,
          qty: "5",
          unitCost: "1.000000",
          reason: "COUNT_GAIN",
          counterAccountId: null,
          valueDate: "2026-01-05",
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_REQUIRED" });
  });

  it("issues earliest-expiry batch first (FEFO), non-expiry items unaffected", async () => {
    const perishable = await ensureInventoryItem("INV-V-PERISH", "Perishable tracked item", {
      trackBatch: true,
      hasExpiry: true,
    });
    // Two batches: B-LATE expires 2027, B-EARLY expires 2026.
    await receivePerishable(perishable, "10", "1.000000", "B-LATE", "2027-06-30", "2026-01-05");
    await receivePerishable(perishable, "10", "2.000000", "B-EARLY", "2026-05-30", "2026-01-10");

    // FEFO: an issue without an explicit batch picks B-EARLY first.
    const issue = await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: perishable,
        warehouseId: fixture.warehouseMain,
        qty: "4",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-01-15",
        actorId: I_ACTOR,
      }),
    );
    // Costing–picking DECOUPLING (INVENTORY_ACCOUNTING §5): FEFO picks
    // the EARLY batch; the WAC item still prices at the blended average
    // (10@1 + 10@2)/20 = 1.50 → 4 × 1.50 = 6.0000.
    expect(issue.valueAmount).toBe("6.0000");
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ itemId: perishable, limit: 10 }),
    );
    const issueMoves = moves.filter((move) => move.direction === "OUT");
    expect(issueMoves.length).toBe(1);
    expect(issueMoves[0]!.batchNo).toBe("B-EARLY"); // the FEFO proof

    // Batch on-hand: EARLY has 6 left, LATE untouched at 10.
    const batches = await withTenant(TENANT_I, () =>
      tracking.listBatches({ itemId: perishable, limit: 10 }),
    );
    const early = batches.find((batch) => batch.batchNo === "B-EARLY")!;
    const late = batches.find((batch) => batch.batchNo === "B-LATE")!;
    expect(await withTenant(TENANT_I, () => store.batchOnHand(early.id))).toBe("6.000000");
    expect(await withTenant(TENANT_I, () => store.batchOnHand(late.id))).toBe("10.000000");
  });

  it("explicit-batch issues honor the caller's batch (with on-hand bounds)", async () => {
    const perishable = await ensureInventoryItem("INV-V-PERISH", "Perishable tracked item", {
      trackBatch: true,
      hasExpiry: true,
    });
    const batches = await withTenant(TENANT_I, () =>
      tracking.listBatches({ itemId: perishable, limit: 10 }),
    );
    const late = batches.find((batch) => batch.batchNo === "B-LATE")!;
    // 12 ≤ the total on-hand (14 — BR-013 passes) but > the LATE batch's
    // 10 → the batch bounds reject with the typed error.
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId: perishable,
          warehouseId: fixture.warehouseMain,
          qty: "12",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-01-16",
          batchId: late.id,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_INSUFFICIENT_STOCK" });
  });

  it("expiry write-off posts shrinkage with reason EXPIRED and zeroes the batch", async () => {
    const perishable = await ensureInventoryItem("INV-V-PERISH", "Perishable tracked item", {
      trackBatch: true,
      hasExpiry: true,
    });
    const batches = await withTenant(TENANT_I, () =>
      tracking.listBatches({ itemId: perishable, limit: 10 }),
    );
    const early = batches.find((batch) => batch.batchNo === "B-EARLY")!;
    const writeOff = await withTenant(TENANT_I, () =>
      tracking.writeOffExpiredBatch({
        batchId: early.id,
        warehouseId: fixture.warehouseMain,
        valueDate: "2026-06-01",
        actorId: I_ACTOR,
      }),
    );
    // 6 remaining, priced at the WAC average 1.50 → 9.0000 → DR
    // SHRINKAGE · CR INVENTORY (reason EXPIRED).
    expect(writeOff.qty).toBe("6.000000");
    const entry = await withTenant(TENANT_I, () =>
      journal.findEntryBySourceKey("stock_move", writeOff.moveId, "post"),
    );
    expect(entry).toBeDefined();
    const lines = await withTenant(TENANT_I, () => journal.listLines(entry!.id));
    expect(lines.map((line) => [line.direction, line.amount])).toEqual([
      ["DEBIT", "9.0000"],
      ["CREDIT", "9.0000"],
    ]);
    expect(lines[0]!.accountId).toBe(fixture.glShrinkage);
    const writeOffMoves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "manual_issue", itemId: perishable, limit: 50 }),
    );
    expect(
      writeOffMoves.some((move) => move.reason === "EXPIRED" && move.batchNo === "B-EARLY"),
    ).toBe(true);
    expect(await withTenant(TENANT_I, () => store.batchOnHand(early.id))).toBe("0.000000");
    const batchRow = await withTenant(TENANT_I, () => tracking.findBatch(early.id));
    expect(batchRow.status).toBe("WRITTEN_OFF");
  });
});

describe("BR-018 — serial/IMEI tracking with original-cost returns", () => {
  it("sale binds the specific unit; a return must reference the originally sold serial at its ORIGINAL cost", async () => {
    const device = await ensureInventoryItem("INV-V-DEVICE", "Serial device item", {
      trackSerial: true,
    });
    const sn1 = await withTenant(TENANT_I, () =>
      tracking.registerSerial({
        itemId: device,
        serialNo: "SN-V-001",
        imei: "356938035643809",
        actorId: I_ACTOR,
      }),
    );
    const sn2 = await withTenant(TENANT_I, () =>
      tracking.registerSerial({
        itemId: device,
        serialNo: "SN-V-002",
        imei: null,
        actorId: I_ACTOR,
      }),
    );

    // Receive TWO units — the two registered serials (qty must match).
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: device,
        warehouseId: fixture.warehouseMain,
        qty: "2",
        unitCost: "500.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        serialIds: [sn1.id, sn2.id],
        actorId: I_ACTOR,
      }),
    );

    // Issue (sell) unit SN-V-001 specifically.
    const sale = await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: device,
        warehouseId: fixture.warehouseMain,
        qty: "1",
        reason: "OTHER",
        counterAccountId: fixture.glCogs, // a documented COGS-shaped manual issue
        valueDate: "2026-01-10",
        serialIds: [sn1.id],
        actorId: I_ACTOR,
      }),
    );
    expect(sale.valueAmount).toBe("500.0000");
    const soldSerial = await withTenant(TENANT_I, () => tracking.findSerial(sn1.id));
    expect(soldSerial.status).toBe("sold");
    expect(soldSerial.soldAt).toBe("2026-01-10");

    // Only in_stock units can be issued (BR-018).
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId: device,
          warehouseId: fixture.warehouseMain,
          qty: "1",
          reason: "OTHER",
          counterAccountId: fixture.glCogs,
          valueDate: "2026-01-11",
          serialIds: [sn1.id],
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SERIAL_NOT_IN_STOCK" });

    // Receiving a NEW batch at a different cost…
    const sn3 = await withTenant(TENANT_I, () =>
      tracking.registerSerial({
        itemId: device,
        serialNo: "SN-V-003",
        imei: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: device,
        warehouseId: fixture.warehouseMain,
        qty: "1",
        unitCost: "700.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-12",
        serialIds: [sn3.id],
        actorId: I_ACTOR,
      }),
    );

    // …but the RETURN of SN-V-001 re-enters at the ORIGINAL issue cost
    // (500), not the current average — INVENTORY_ACCOUNTING §2.
    const returned = await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: device,
        warehouseId: fixture.warehouseMain,
        qty: "1",
        unitCost: null,
        reason: "CUSTOMER_RETURN",
        counterAccountId: null,
        valueDate: "2026-01-15",
        serialId: sn1.id,
        actorId: I_ACTOR,
      }),
    );
    expect(returned.valueAmount).toBe("500.0000");
    const reentered = await withTenant(TENANT_I, () => tracking.findSerial(sn1.id));
    expect(reentered.status).toBe("in_stock"); // ready for resale; history intact

    // The original-sale lookup (BR-018's binding surface).
    const saleInfo = await withTenant(TENANT_I, () => tracking.serialSale(sn1.id));
    expect(saleInfo.originalIssue?.unitCost).toBe("500.000000");

    // A return without a bound sale fails closed (BR-018).
    const sn4 = await withTenant(TENANT_I, () =>
      tracking.registerSerial({
        itemId: device,
        serialNo: "SN-V-004",
        imei: null,
        actorId: I_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualReceipt({
          itemId: device,
          warehouseId: fixture.warehouseMain,
          qty: "1",
          unitCost: null,
          reason: "CUSTOMER_RETURN",
          counterAccountId: null,
          valueDate: "2026-01-16",
          serialId: sn4.id,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SERIAL_RETURN_BINDING_INVALID" });
  });

  it("serial-tracked receipts REQUIRE matching serial counts", async () => {
    const device = await ensureInventoryItem("INV-V-DEVICE", "Serial device item", {
      trackSerial: true,
    });
    const sn = await withTenant(TENANT_I, () =>
      tracking.registerSerial({
        itemId: device,
        serialNo: "SN-V-009",
        imei: null,
        actorId: I_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualReceipt({
          itemId: device,
          warehouseId: fixture.warehouseMain,
          qty: "2",
          unitCost: "1.000000",
          reason: "COUNT_GAIN",
          counterAccountId: null,
          valueDate: "2026-01-05",
          serialIds: [sn.id],
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "SERIAL_REQUIRED" });
  });
});
