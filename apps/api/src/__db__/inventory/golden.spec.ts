import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as periodStore from "../../modules/accounting/infrastructure/accounting.store";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import {
  I_ACTOR,
  I_MAR,
  I_OPENING_DATE,
  TENANT_I,
  adjustments,
  inventoryReconciliation,
  iPeriods,
  openingStock,
  setupInventoryFixture,
  stock,
  transfers,
  type InventoryFixture,
} from "./fixtures";

/**
 * PHASE-010 golden posting tests (ACCOUNTING_TESTS §3, this phase's
 * executable subset): G-13 adjustment loss, G-14 adjustment gain, G-15
 * transfer between valuation accounts (+ the policy-none same-account
 * case), G-16 opening stock leg — each asserting the EXACT journal lines
 * (account, direction, amount), the stock-move rows (value_amount =
 * the journal quantum), the document state, and an audit event — plus the
 * standard failure pack per golden (PERIOD_LOCKED, PURPOSE_NOT_MAPPED,
 * ALREADY_POSTED, INSUFFICIENT_STOCK) with zero residue.
 */

let fixture: InventoryFixture;
const audit = new AuditService(new DrizzleAuditStore());

beforeAll(async () => {
  fixture = await setupInventoryFixture();
});

interface ExpectedLine {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<ExpectedLine[]> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

async function zeroResidueFor(sourceType: string, sourceId: string): Promise<void> {
  const moves = await store.listStockMoves({ sourceType, sourceId, limit: 10 });
  expect(moves.length).toBe(0);
}

describe("G-13 — stock adjustment loss: DR INVENTORY_SHRINKAGE · CR INVENTORY", () => {
  it("posts the exact canonical shape with move rows + audit + official number", async () => {
    // Setup: receive 100 @ 2.50 in MAIN (idempotent per suite timeline).
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: fixture.items.wac,
        warehouseId: fixture.warehouseMain,
        qty: "100",
        unitCost: "2.500000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-15",
        actorId: I_ACTOR,
      }),
    );

    const created = await withTenant(TENANT_I, () =>
      adjustments.create({
        warehouseId: fixture.warehouseMain,
        itemId: fixture.items.wac,
        reason: "DAMAGE",
        deltaQty: "-5",
        unitCost: null,
        counterAccountId: null,
        note: "G-13 damage",
        noteAr: "تالف G-13",
        actorId: I_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_I, () => adjustments.post(created.id, I_ACTOR));

    expect(result.adjustmentNo).toMatch(/^TRA-20\d{2}-\d{6}$/);
    expect(result.idempotentReplay).toBe(false);
    // The move row (below) proves 5 × 2.50 = 12.5000 exactly. expect(result.entryNo).toMatch(/^JE-/);

    const lines = await withTenant(TENANT_I, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.glShrinkage, direction: "DEBIT", amount: "12.5000" },
      { accountId: fixture.glInventory, direction: "CREDIT", amount: "12.5000" },
    ]);

    // The move row: OUT, adjust kind, journal-linked, value 12.5000.
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "stock_adjustment", sourceId: created.id, limit: 10 }),
    );
    expect(moves.length).toBe(1);
    expect(moves[0]!.direction).toBe("OUT");
    expect(moves[0]!.moveKind).toBe("adjust");
    expect(moves[0]!.valueAmount).toBe("12.5000");
    expect(moves[0]!.postedJournalId).toBe(result.journalEntryId);
    expect(moves[0]!.reason).toBe("DAMAGE");

    // Read model: 100 − 5 = 95 @ avg 2.50 (issues never mutate the average).
    const onHand = await withTenant(TENANT_I, () =>
      store.findItemStock(fixture.items.wac, fixture.warehouseMain),
    );
    expect(onHand!.qty).toBe("95.000000");
    expect(onHand!.avgCost).toBe("2.500000");

    // Audit event.
    const events = await withTenant(TENANT_I, () =>
      audit.list({ entityType: "stock_adjustment", entityId: created.id, limit: 10 }),
    );
    expect(events.some((event) => event.action === "inventory.adjustment_posted")).toBe(true);
  });

  it("ALREADY_POSTED: replaying the post converges (INV-013) without a second journal", async () => {
    const list = await withTenant(TENANT_I, () =>
      adjustments.list({ status: "POSTED", limit: 5 }),
    );
    const posted = list[0]!;
    const replay = await withTenant(TENANT_I, () => adjustments.post(posted.id, I_ACTOR));
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.journalEntryId).toBe(posted.postedJournalId);
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "stock_adjustment", sourceId: posted.id, limit: 10 }),
    );
    expect(moves.length).toBe(1);
  });

  it("PERIOD_LOCKED: posting into a locked month leaves ZERO residue (INV-011)", async () => {
    const created = await withTenant(TENANT_I, () =>
      adjustments.create({
        warehouseId: fixture.warehouseMain,
        itemId: fixture.items.wac,
        reason: "DAMAGE",
        deltaQty: "-1",
        unitCost: null,
        counterAccountId: null,
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    // Lock the CURRENT month (the adjustment posts at today's date).
    const today = new Date().toISOString().slice(0, 10);
    const period = await withTenant(TENANT_I, () => periodStore.findPeriodForDate(today));
    expect(period).toBeDefined();
    await withTenant(TENANT_I, () => iPeriods.softClose(I_ACTOR, period!.id));
    try {
      await withTenant(TENANT_I, () => iPeriods.lock(I_ACTOR, period!.id));
      await expect(
        withTenant(TENANT_I, () => adjustments.post(created.id, I_ACTOR)),
      ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
      await withTenant(TENANT_I, () => zeroResidueFor("stock_adjustment", created.id));
      const row = await withTenant(TENANT_I, () => store.findAdjustmentById(created.id));
      expect(row!.status).toBe("DRAFT");
      const onHand = await withTenant(TENANT_I, () =>
        store.findItemStock(fixture.items.wac, fixture.warehouseMain),
      );
      expect(onHand!.qty).toBe("95.000000");
    } finally {
      await withTenant(TENANT_I, () =>
        iPeriods.reopen(I_ACTOR, period!.id, "test reopen after PERIOD_LOCKED pack"),
      );
    }
  });
});

describe("G-14 — stock adjustment gain: DR INVENTORY · CR INVENTORY_APPRECIATION", () => {
  it("posts the exact canonical shape (count-gain style)", async () => {
    const created = await withTenant(TENANT_I, () =>
      adjustments.create({
        warehouseId: fixture.warehouseMain,
        itemId: fixture.items.wac,
        reason: "COUNT_GAIN",
        deltaQty: "3",
        unitCost: null,
        counterAccountId: null,
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_I, () => adjustments.post(created.id, I_ACTOR));
    const gainMoves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "stock_adjustment", sourceId: created.id, limit: 10 }),
    );
    // 3 × 2.50 = 7.5000 exactly (the gain move is the proof).
    expect(gainMoves[0]!.valueAmount).toBe("7.5000");
    const lines = await withTenant(TENANT_I, () => journalLinesOf(result.journalEntryId));
    expect(lines).toEqual([
      { accountId: fixture.glInventory, direction: "DEBIT", amount: "7.5000" },
      { accountId: fixture.glAppreciation, direction: "CREDIT", amount: "7.5000" },
    ]);
    const onHand = await withTenant(TENANT_I, () =>
      store.findItemStock(fixture.items.wac, fixture.warehouseMain),
    );
    expect(onHand!.qty).toBe("98.000000");
  });

  it("PURPOSE_NOT_MAPPED: unmapped appreciation purpose fails closed with zero residue", async () => {
    const { findActivePurpose, supersedePurpose } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const mapping = await withTenant(TENANT_I, () => findActivePurpose("INVENTORY_APPRECIATION"));
    expect(mapping).toBeDefined();
    await withTenant(TENANT_I, () =>
      supersedePurpose(mapping!.id, new Date().toISOString().slice(0, 10)),
    );
    try {
      const created = await withTenant(TENANT_I, () =>
        adjustments.create({
          warehouseId: fixture.warehouseMain,
          itemId: fixture.items.wac,
          reason: "COUNT_GAIN",
          deltaQty: "1",
          unitCost: null,
          counterAccountId: null,
          note: null,
          noteAr: null,
          actorId: I_ACTOR,
        }),
      );
      await expect(
        withTenant(TENANT_I, () => adjustments.post(created.id, I_ACTOR)),
      ).rejects.toMatchObject({ code: "PURPOSE_NOT_MAPPED" });
      await withTenant(TENANT_I, () => zeroResidueFor("stock_adjustment", created.id));
      const row = await withTenant(TENANT_I, () => store.findAdjustmentById(created.id));
      expect(row!.status).toBe("DRAFT");
    } finally {
      const { insertAccountPurpose } = await import(
        "../../modules/tenancy/infrastructure/tenancy.store"
      );
      await withTenant(TENANT_I, () =>
        insertAccountPurpose({
          purposeKey: "INVENTORY_APPRECIATION",
          accountId: mapping!.accountId,
          activeFrom: new Date().toISOString().slice(0, 10),
        }),
      );
    }
  });
});

describe("G-15 — stock transfer between valuation accounts", () => {
  it("journals DR dest · CR src when the warehouses map distinct accounts", async () => {
    const created = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: fixture.warehouseMain,
        toWarehouseId: fixture.warehouseSecond,
        lines: [{ itemId: fixture.items.wac, qty: "10" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    const dispatched = await withTenant(TENANT_I, () => transfers.dispatch(created.id, I_ACTOR));
    expect(dispatched.status).toBe("IN_TRANSIT");
    expect(dispatched.transferNo).toMatch(/^TRN-20\d{2}-\d{6}$/);
    expect(dispatched.postedJournalId).not.toBeNull();

    const lines = await withTenant(TENANT_I, () => journalLinesOf(dispatched.postedJournalId!));
    // 10 × 2.50 = 25.0000.
    expect(lines).toEqual([
      { accountId: fixture.glInventorySecond, direction: "DEBIT", amount: "25.0000" },
      { accountId: fixture.glInventory, direction: "CREDIT", amount: "25.0000" },
    ]);

    // BR-016: IN_TRANSIT stock is visible but not sellable/reservable.
    const sourceAvailability = await withTenant(TENANT_I, () =>
      stock.availability({ itemId: fixture.items.wac, warehouseId: fixture.warehouseMain }),
    );
    expect(sourceAvailability.onHandQty).toBe("88.000000"); // 98 − 10 dispatched
    const destAvailability = await withTenant(TENANT_I, () =>
      stock.availability({ itemId: fixture.items.wac, warehouseId: fixture.warehouseSecond }),
    );
    expect(destAvailability.onHandQty).toBe("0.000000"); // not yet received

    const received = await withTenant(TENANT_I, () => transfers.receive(created.id, I_ACTOR));
    expect(received.status).toBe("POSTED");
    const destOnHand = await withTenant(TENANT_I, () =>
      store.findItemStock(fixture.items.wac, fixture.warehouseSecond),
    );
    expect(destOnHand!.qty).toBe("10.000000");
    expect(destOnHand!.avgCost).toBe("2.500000"); // carried cost preserved

    // Two legs in the ledger: OUT at source + IN at destination, both
    // journal-linked, both carrying the SAME value (conservation).
    const legs = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "stock_transfer", sourceId: created.id, limit: 10 }),
    );
    expect(legs.length).toBe(2);
    expect(legs.filter((leg) => leg.moveKind === "transfer_out").length).toBe(1);
    expect(legs.filter((leg) => leg.moveKind === "transfer_in").length).toBe(1);
    expect(legs.every((leg) => leg.postedJournalId === dispatched.postedJournalId)).toBe(true);
    expect(legs.map((leg) => leg.valueAmount)).toEqual(["25.0000", "25.0000"]);
  });

  it("policy-none: same-account transfers post NO journal (asserted explicitly)", async () => {
    const tenancyStore = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { warehouses: warehouseService } = await import("./fixtures");
    const branches = await withTenant(TENANT_I, () => tenancyStore.listBranches(null));
    const mainBranch = branches.find((b) => b.code === "MAIN")!;
    // A same-account sibling: no override → the same tenant INVENTORY purpose.
    // Idempotent per code (recon.spec's annex owns the same sibling — suite
    // order must not matter).
    const third =
      (await withTenant(TENANT_I, () => warehouseService.list({ limit: 50 }))).find(
        (w) => w.code === "MAIN-WH2",
      ) ??
      (await withTenant(TENANT_I, () =>
        warehouseService.create({
          branchId: mainBranch.id,
          code: "MAIN-WH2",
          name: "Main warehouse annex",
          nameAr: "ملحق المستودع",
          inventoryAccountId: null,
          note: null,
          actorId: I_ACTOR,
        }),
      ));
    const created = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: fixture.warehouseMain,
        toWarehouseId: third.id,
        lines: [{ itemId: fixture.items.wac, qty: "5" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    const dispatched = await withTenant(TENANT_I, () => transfers.dispatch(created.id, I_ACTOR));
    expect(dispatched.status).toBe("IN_TRANSIT");
    // THE policy-none assertion: NO journal exists for this transfer.
    expect(dispatched.postedJournalId).toBeNull();
    const entry = await withTenant(TENANT_I, () =>
      journal.findEntryBySourceKey("stock_transfer", created.id, "post"),
    );
    expect(entry).toBeUndefined();

    await withTenant(TENANT_I, () => transfers.receive(created.id, I_ACTOR));
    const legs = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "stock_transfer", sourceId: created.id, limit: 10 }),
    );
    expect(legs.length).toBe(2);
    // The moves carry posted_journal_id NULL — the documented policy-none
    // shape (the legs cancel inside the shared account).
    expect(legs.every((leg) => leg.postedJournalId === null)).toBe(true);
  });

  it("INSUFFICIENT_STOCK: dispatch beyond on-hand fails with zero residue (BR-013 default off)", async () => {
    const created = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: fixture.warehouseMain,
        toWarehouseId: fixture.warehouseSecond,
        lines: [{ itemId: fixture.items.wac, qty: "1000000" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_I, () => transfers.dispatch(created.id, I_ACTOR)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    await withTenant(TENANT_I, () => zeroResidueFor("stock_transfer", created.id));
    const row = await withTenant(TENANT_I, () => store.findTransferById(created.id));
    expect(row!.status).toBe("DRAFT");
  });
});

describe("G-16 — opening stock leg: DR INVENTORY · CR OPENING_EQUITY (OPENING period)", () => {
  it("posts the PHASE-006 drafts with per-item layers + INV-010 green from entry #1", async () => {
    // Seed two STOCK drafts once (idempotent): FIFO 40 @ 3.00, WAC 60 @ 3.00.
    const su = await (await import("../test-db")).superuserClient();
    await su.query(
      `INSERT INTO opening_balance_docs (id, tenant_id, kind, item_id, qty, unit_cost, currency_code, status)
       VALUES
         ('9a9a9a9a-0000-4000-8000-000000000001', $1, 'STOCK', $2, 40, 3.000000, 'SAR', 'DRAFT'),
         ('9a9a9a9a-0000-4000-8000-000000000002', $1, 'STOCK', $3, 60, 3.000000, 'SAR', 'DRAFT')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_I, fixture.items.fifo, fixture.items.wac],
    );
    await su.end();

    const result = await withTenant(TENANT_I, () =>
      openingStock.post({ warehouseId: fixture.warehouseMain, actorId: I_ACTOR }),
    );
    expect(result.idempotentReplay).toBe(false);
    // 40 @ 3.00 (FIFO) + 60 @ 3.00 (WAC) = 300.0000.
    expect(result.total).toBe("300.0000");
    expect(result.items).toBe(2);

    const entry = await withTenant(TENANT_I, () =>
      journal.findEntryBySourceKey("opening_stock", fixture.warehouseMain, "post"),
    );
    expect(entry).toBeDefined();
    expect(entry!.entryDate).toBe(I_OPENING_DATE);
    const lines = await withTenant(TENANT_I, () => journalLinesOf(entry!.id));
    // Per-item detail order follows the drafts' created_at (a tie inside
    // the seeding statement) — the golden asserts the SET of item lines
    // + the exact balancing equity line.
    expect(lines).toHaveLength(3);
    const debitLines = lines.filter((line) => line.direction === "DEBIT");
    expect(debitLines.map((line) => line.amount).sort()).toEqual(["120.0000", "180.0000"]);
    expect(debitLines.every((line) => line.accountId === fixture.glInventory)).toBe(true);
    const equity = lines.find((line) => line.direction === "CREDIT");
    expect(equity).toEqual({
      accountId: fixture.glOpeningEquity,
      direction: "CREDIT",
      amount: "300.0000",
    });

    // Per-item layers (FIFO item) + WAC read model + OPENING-dated moves.
    const fifoOnHand = await withTenant(TENANT_I, () =>
      store.findItemStock(fixture.items.fifo, fixture.warehouseMain),
    );
    expect(fifoOnHand!.qty).toBe("40.000000");
    const layers = await withTenant(TENANT_I, () =>
      store.listAllLayers(fixture.items.fifo, fixture.warehouseMain),
    );
    expect(layers.length).toBe(1);
    expect(layers[0]!.remainingQty).toBe("40.000000");
    expect(layers[0]!.unitCost).toBe("3.000000");
    const wacOnHand = await withTenant(TENANT_I, () =>
      store.findItemStock(fixture.items.wac, fixture.warehouseMain),
    );
    expect(wacOnHand!.qty).toBe("143.000000"); // 98 − 10 (G-15) − 5 (policy-none) + 60 opening
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "opening_balance_doc", limit: 10 }),
    );
    expect(moves.length).toBe(2);
    expect(moves.every((move) => move.movedAt === I_OPENING_DATE)).toBe(true);
    expect(moves.every((move) => move.postedJournalId === entry!.id)).toBe(true);

    // INV-010 holds from entry #1 (as-of after every fixture activity).
    const check = await withTenant(TENANT_I, () =>
      inventoryReconciliation.runStockCheck({
        asOf: I_MAR,
        runMode: "ON_DEMAND",
        checkedBy: I_ACTOR,
      }),
    );
    expect(check.status).toBe("OK");

    // Idempotent replay: same warehouse → the same journal; the drafts are
    // POSTED so a second warehouse fails closed (G-16's per-warehouse key).
    const replay = await withTenant(TENANT_I, () =>
      openingStock.post({ warehouseId: fixture.warehouseMain, actorId: I_ACTOR }),
    );
    expect(replay.idempotentReplay).toBe(true);
    await expect(
      withTenant(TENANT_I, () =>
        openingStock.post({ warehouseId: fixture.warehouseSecond, actorId: I_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "STOCK_ADJUSTMENT_STATE_INVALID" });
  });
});
