import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { withTenant } from "../../infra/db/tenant-context";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import type { EmailService } from "../../modules/notifications/application/email-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import {
  I_ACTOR,
  TENANT_I,
  ensureInventoryItem,
  inventoryAppClient,
  reservations,
  setupInventoryFixture,
  stock,
  warehouses,
  type InventoryFixture,
} from "./fixtures";
import { ReorderService } from "../../modules/inventory/application/reorder-service";

/**
 * Operations suite (PHASE-010 §2.13/§2.14/§6): soft reservations + the
 * availability service (BR-016 netting), the reorder job's once-per-window
 * discipline (BR-019), the A7 spoofing parity (cross-tenant warehouses
 * render identically + writes leave zero residue), the CC-04 stock-issue
 * race (two concurrent issues of the last units — one wins), and the
 * T-01 movement-ledger perf smoke on a seeded 100k-move tenant.
 */

let fixture: InventoryFixture;
let opsItem: string;
let reorderService: ReorderService;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  opsItem = await ensureInventoryItem("INV-V-OPS", "Operations item");
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  reorderService = new ReorderService(
    new AuditService(new DrizzleAuditStore()),
    {} as EmailService,
    new InboxService(),
  );
});

describe("soft reservations + availability (§2.13; BR-016)", () => {
  it("nets active reservations out of on-hand; expired rows stop netting after the sweep", async () => {
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: opsItem,
        warehouseId: fixture.warehouseMain,
        qty: "100",
        unitCost: "1.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: I_ACTOR,
      }),
    );
    // Reserve 30 (active) — availability = 70.
    const active = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: opsItem,
        warehouseId: fixture.warehouseMain,
        qty: "30",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "cart hold",
        actorId: I_ACTOR,
      }),
    );
    let availability = await withTenant(TENANT_I, () =>
      stock.availability({ itemId: opsItem, warehouseId: fixture.warehouseMain }),
    );
    expect(availability.onHandQty).toBe("100.000000");
    expect(availability.reservedQty).toBe("30.000000");
    expect(availability.availableQty).toBe("70.000000");

    // Consume the reservation (the whole row — consumption is binary in
    // the MVP seam; partial splits arrive with PHASE-015's policies).
    await withTenant(TENANT_I, () => reservations.consume(active.id, I_ACTOR));
    availability = await withTenant(TENANT_I, () =>
      stock.availability({ itemId: opsItem, warehouseId: fixture.warehouseMain }),
    );
    expect(availability.reservedQty).toBe("0");

    // An EXPIRED reservation never nets (expires_at in the past).
    const expired = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: opsItem,
        warehouseId: fixture.warehouseMain,
        qty: "5",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: "2020-01-01T00:00:00Z",
        note: "lapsed hold",
        actorId: I_ACTOR,
      }),
    );
    availability = await withTenant(TENANT_I, () =>
      stock.availability({ itemId: opsItem, warehouseId: fixture.warehouseMain }),
    );
    expect(availability.reservedQty).toBe("0"); // the lapsed row ignored

    // The sweep flips it to RELEASED (the pool stays honest).
    const swept = await withTenant(TENANT_I, () => reservations.sweepExpired(I_ACTOR));
    expect(swept.released).toBeGreaterThanOrEqual(1);
    const row = await withTenant(TENANT_I, () => reservations.find(expired.id));
    expect(row.status).toBe("RELEASED");

    // Release semantics: soft only — on-hand never changes.
    const before = await withTenant(TENANT_I, () =>
      store.findItemStock(opsItem, fixture.warehouseMain),
    );
    const releasable = await withTenant(TENANT_I, () =>
      reservations.create({
        itemId: opsItem,
        warehouseId: fixture.warehouseMain,
        qty: "7",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "release probe",
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => reservations.release(releasable.id, I_ACTOR));
    availability = await withTenant(TENANT_I, () =>
      stock.availability({ itemId: opsItem, warehouseId: fixture.warehouseMain }),
    );
    expect(availability.reservedQty).toBe("0");
    expect(availability.onHandQty).toBe(before!.qty);
  });

  it("BR-016: IN_TRANSIT stock is visible but never available (the availability read)", async () => {
    const { transfers } = await import("./fixtures");
    const inFlight = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: fixture.warehouseMain,
        toWarehouseId: fixture.warehouseSecond,
        lines: [{ itemId: opsItem, qty: "10" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => transfers.dispatch(inFlight.id, I_ACTOR));
    const source = await withTenant(TENANT_I, () =>
      stock.availability({ itemId: opsItem, warehouseId: fixture.warehouseMain }),
    );
    const dest = await withTenant(TENANT_I, () =>
      stock.availability({ itemId: opsItem, warehouseId: fixture.warehouseSecond }),
    );
    // Source on-hand is down (the goods physically left); destination sees
    // the in-transit qty but its on-hand/available stay 0 — never sellable.
    expect(source.onHandQty).toBe("90.000000");
    expect(dest.inTransitQty).toBe("10.000000");
    expect(dest.onHandQty).toBe("0.000000");
    expect(dest.availableQty).toBe("0.000000");
    await withTenant(TENANT_I, () => transfers.receive(inFlight.id, I_ACTOR));
  });
});

describe("BR-019 — reorder monitoring (alert, not autopilot)", () => {
  it("fires the below-reorder digest exactly once per 24h window per item-warehouse", async () => {
    // On-hand 100 → set the reorder level above it (150).
    await withTenant(TENANT_I, () =>
      warehouses.upsertItemSetting({
        itemId: opsItem,
        warehouseId: fixture.warehouseMain,
        reorderLevel: "150",
        minQty: "10",
        actorId: I_ACTOR,
      }),
    );
    const first = await withTenant(TENANT_I, () =>
      reorderService.runNightlyScan({ runMode: "NIGHTLY", checkedBy: I_ACTOR }),
    );
    expect(first.alerted).toBeGreaterThanOrEqual(1);

    // The audit event carries the item list (the durable surface).
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
    const events = await withTenant(TENANT_I, () =>
      new AuditService(new DrizzleAuditStore()).list({
        entityType: "item_warehouse_setting",
        limit: 20,
      }),
    );
    expect(
      events.filter((event) => event.action === "inventory.stock_below_reorder").length,
    ).toBeGreaterThanOrEqual(1);

    // Re-run inside the window: the dedupe stamp holds (exactly once).
    const second = await withTenant(TENANT_I, () =>
      reorderService.runNightlyScan({ runMode: "ON_DEMAND", checkedBy: I_ACTOR }),
    );
    expect(second.alerted).toBe(0);
    expect(second.withinWindow).toBeGreaterThanOrEqual(1);

    // The reorder job creates NO purchase orders (BR-019: alert only,
    // never autopilot). PHASE-011 note: the assertion is row-based now —
    // the purchasing tables ship with the module; tenant I (inventory
    // suite) holds zero PO rows, and the scan added none.
    const su = await (await import("../test-db")).superuserClient();
    const orders = await su.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM purchase_orders WHERE tenant_id = $1`,
      ["55555555-5555-5555-5555-555555555555"],
    );
    expect(orders.rows[0]!.n).toBe("0");
    await su.end();
  });
});

describe("A7 spoofing — cross-tenant references render identically, writes leave nothing", () => {
  let tenantAApp: Client;

  beforeAll(async () => {
    tenantAApp = await inventoryAppClient();
  });

  it("cross-branch/tenant warehouse references are 404-shaped with zero residue", async () => {
    // Under tenant I's scope, probe a FOREIGN warehouse (the isolation
    // fixtures' tenant-A row) — the id must behave exactly like an
    // unknown uuid (no existence leak).
    const foreignWarehouse = "f0f0f0f0-1000-4000-8000-000000000001";
    const unknown = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const readForeign = await withTenant(TENANT_I, () =>
      store.findWarehouseById(foreignWarehouse).catch((error: { code?: string }) => error.code),
    );
    const readUnknown = await withTenant(TENANT_I, () =>
      store.findWarehouseById(unknown).catch((error: { code?: string }) => error.code),
    );
    expect(readForeign).toBeUndefined();
    expect(readUnknown).toBeUndefined();

    // A move attempt against the foreign warehouse writes NOTHING.
    const before = await withTenant(TENANT_I, () => store.countStockMoves());
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualReceipt({
          itemId: opsItem,
          warehouseId: foreignWarehouse,
          qty: "1",
          unitCost: "1.000000",
          reason: "COUNT_GAIN",
          counterAccountId: null,
          valueDate: "2026-01-20",
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "WAREHOUSE_NOT_FOUND" });
    const after = await withTenant(TENANT_I, () => store.countStockMoves());
    expect(after).toBe(before);

    // The raw RLS probe: the app role sees 0 foreign warehouse rows.
    const probe = await tenantAApp.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM warehouses WHERE id = $1`,
      [foreignWarehouse],
    );
    expect(probe.rows[0]?.n).toBe(0);
  });
});

describe("CC-04 — the stock-issue race on the last units", () => {
  it("two concurrent issues of the last units: one wins, one fails INSUFFICIENT_STOCK", async () => {
    const raceItem = await ensureInventoryItem("INV-V-RACE", "CC-04 race item");
    // Position: exactly 10 units.
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: raceItem,
        warehouseId: fixture.warehouseMain,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: I_ACTOR,
      }),
    );

    // Two concurrent FULL manualIssue flows (plan→post→apply in one
    // transaction each): the item_stock row lock serializes them — the
    // winner commits 10→2, the loser re-reads the post-commit on-hand and
    // fails INSUFFICIENT_STOCK with zero residue (CC-04).
    const outcome = await Promise.allSettled([
      withTenant(TENANT_I, async () => {
        // Hold the position lock a beat so the racer queues behind it.
        await store.lockItemStock(raceItem, fixture.warehouseMain);
        await new Promise((resolve) => setTimeout(resolve, 300));
        return stock.manualIssue({
          itemId: raceItem,
          warehouseId: fixture.warehouseMain,
          qty: "8",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-01-06",
          actorId: I_ACTOR,
        });
      }),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return withTenant(TENANT_I, () =>
          stock.manualIssue({
            itemId: raceItem,
            warehouseId: fixture.warehouseMain,
            qty: "8",
            reason: "DAMAGE",
            counterAccountId: null,
            valueDate: "2026-01-06",
            actorId: I_ACTOR,
          }),
        );
      })(),
    ]);
    const settled = outcome.map((entry) =>
      entry.status === "fulfilled" ? "WIN" : ((entry.reason as { code?: string }).code ?? "ERR"),
    );
    expect(settled.filter((result) => result === "WIN").length).toBe(1);
    expect(settled.filter((result) => result === "INSUFFICIENT_STOCK").length).toBe(1);

    // The winner's apply landed exactly once: on-hand 10 − 8 = 2, one
    // journal, zero double-spend.
    const onHand = await withTenant(TENANT_I, () =>
      store.findItemStock(raceItem, fixture.warehouseMain),
    );
    expect(onHand!.qty).toBe("2.000000");
    const raceMoves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ itemId: raceItem, direction: "OUT", limit: 10 }),
    );
    expect(raceMoves.length).toBe(1);
  });
});

describe("T-01 — movement ledger + stock queries perf smoke (seeded 100k moves)", () => {
  it("indexed queries stay within the local smoke budget at 100k rows", async () => {
    const perfItem = await ensureInventoryItem("INV-V-PERF-000", "Perf smoke item 000");
    const su = await (await import("../test-db")).superuserClient();
    // Bulk-seed 100k moves over 100 items via a generate_series INSERT
    // (test tooling — the ledger is append-only; this mirrors a mature
    // multi-item tenant, ~1000 moves per item).
    await su.query(
      `CREATE TEMP TABLE perf_items AS
       SELECT id, (row_number() OVER ()) - 1 AS n
       FROM items WHERE tenant_id = $1 AND sku LIKE 'INV-V-PERF-%'`,
      [TENANT_I],
    );
    // 99 siblings so the per-item slice is selective (realistic shape).
    for (let n = 1; n <= 99; n += 1) {
      await su.query(
        `INSERT INTO items (id, tenant_id, sku, name, kind, uom_id, costing_method,
                            track_batch, track_serial, track_imei, has_expiry, status)
         SELECT gen_random_uuid(), $1, $2, $3, 'STOCK',
           (SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'PCS'),
           'WAC', false, false, false, false, 'ACTIVE'
         WHERE NOT EXISTS (SELECT 1 FROM items WHERE tenant_id = $1 AND sku = $2)`,
        [TENANT_I, `INV-V-PERF-${String(n).padStart(3, "0")}`, `Perf smoke item ${n}`],
      );
    }
    await su.query(
      `INSERT INTO perf_items SELECT id, (row_number() OVER ()) - 1 AS n
       FROM items WHERE tenant_id = $1 AND sku LIKE 'INV-V-PERF-%'`,
      [TENANT_I],
    );
    await su.query(
      `INSERT INTO stock_moves (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty,
                                unit_cost, value_amount, source_type, source_id, moved_at)
       SELECT gen_random_uuid(), $1, pi.id, $2,
              CASE WHEN g % 2 = 0 THEN 'IN' ELSE 'OUT' END,
              'receipt', 1, 1.000000, 1.0000, 'manual_receipt', gen_random_uuid(),
              (DATE '2026-01-01' + (g % 90))::date
       FROM generate_series(1, 100000) g
       JOIN perf_items pi ON pi.n = g % 100`,
      [TENANT_I, fixture.warehouseMain],
    );
    await su.query(
      `INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
       VALUES (gen_random_uuid(), $1, $2, $3, 1000, 1)
       ON CONFLICT (tenant_id, item_id, warehouse_id) DO NOTHING`,
      [TENANT_I, perfItem, fixture.warehouseMain],
    );
    // Fresh stats so the planner proves index selection honestly.
    await su.query(`ANALYZE stock_moves`);
    await su.end();

    const started = Date.now();
    const ledger = await withTenant(TENANT_I, () =>
      store.listStockMoves({ itemId: perfItem, warehouseId: fixture.warehouseMain, limit: 100 }),
    );
    const ledgerMs = Date.now() - started;
    expect(ledger.length).toBe(100);

    const stockStarted = Date.now();
    const onHand = await withTenant(TENANT_I, () =>
      store.listStockOnHand({ itemId: perfItem, limit: 10 }),
    );
    const stockMs = Date.now() - stockStarted;
    expect(onHand.length).toBe(1);

    // EXPLAIN-verified index use (§6: movement queries must use the
    // tenant-first composite at 100k moves).
    const app = await inventoryAppClient();
    const plan = await app.query<{ "QUERY PLAN": string }>(
      `EXPLAIN (FORMAT TEXT) SELECT id FROM stock_moves
       WHERE tenant_id = erp.current_tenant_id() AND item_id = $1 AND warehouse_id = $2
         AND moved_at <= '2026-12-31' LIMIT 100`,
      [perfItem, fixture.warehouseMain],
    );
    const planText = plan.rows.map((row) => Object.values(row)[0] ?? "").join("\n");
    expect(planText).toContain("ix_stock_moves_tenant_item_wh_date");

    // Local smoke budget (T-01 tier): generous absolute caps; the recorded
    // numbers go into the phase report as the honest local measurement.
    expect(ledgerMs).toBeLessThan(1500);
    expect(stockMs).toBeLessThan(500);

    // Suite-order discipline: the 100k seeded moves are UNJOURNALED test
    // tooling (superuser bulk-INSERT — the app role cannot bypass the
    // posting engine). Their as-of-truncated IN/OUT parity nets non-zero,
    // which would poison every later INV-010 check (RC-04/G-16), the
    // PC-04 lock gate, and any exact-balance assertion, whichever file
    // order vitest picks. Cleanup mirrors RC-05's documented repair path:
    // guard trigger disabled for the moment of the fixture removal, the
    // moves/stock/items removed, stats restored — tenant I left pristine.
    const suCleanup = await (await import("../test-db")).superuserClient();
    await suCleanup.query(`ALTER TABLE stock_moves DISABLE TRIGGER trg_stock_moves_guard`);
    await suCleanup.query(
      `DELETE FROM stock_moves WHERE tenant_id = $1 AND item_id IN
         (SELECT id FROM items WHERE tenant_id = $1 AND sku LIKE 'INV-V-PERF-%')`,
      [TENANT_I],
    );
    await suCleanup.query(`ALTER TABLE stock_moves ENABLE TRIGGER trg_stock_moves_guard`);
    await suCleanup.query(
      `DELETE FROM item_stock WHERE tenant_id = $1 AND item_id IN
         (SELECT id FROM items WHERE tenant_id = $1 AND sku LIKE 'INV-V-PERF-%')`,
      [TENANT_I],
    );
    await suCleanup.query(
      `DELETE FROM items WHERE tenant_id = $1 AND sku LIKE 'INV-V-PERF-%'`,
      [TENANT_I],
    );
    await suCleanup.query(`ANALYZE stock_moves`);
    await suCleanup.end();
  });
});
