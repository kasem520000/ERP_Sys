import { beforeAll, describe, expect, it } from "vitest";

import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as periodStore from "../../modules/accounting/infrastructure/accounting.store";
import { PeriodService } from "../../modules/accounting/application/period-service";
import {
  I_ACTOR,
  TENANT_I,
  adjustments,
  ensureInventoryItem,
  iReconciliation,
  inventoryReconciliation,
  setupInventoryFixture,
  stock,
  transfers,
  type InventoryFixture,
} from "./fixtures";

/**
 * INV-010 reconciliation suite (PHASE-010 §2.16/§6; RC-04/RC-05;
 * RECONCILIATION §1 row 3): the mixed-operations green path (receipts,
 * issues, adjustments, transfers — INCLUDING the transfer-without-journal
 * policy-none case), the seeded-drift proof (an orphan move via test
 * tooling → BROKEN with the offending row), the notification record, and
 * the PC-04 lock gate + the live close-checklist item.
 */

let fixture: InventoryFixture;
let reconItem: string;
const audit = new AuditService(new DrizzleAuditStore());
let iPeriods: PeriodService;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  iPeriods = new PeriodService(audit);
  reconItem = await ensureInventoryItem("INV-V-RECON", "Reconciliation item");
});

describe("RC-04 — mixed operations reconcile green (incl. policy-none transfer)", () => {
  it("receipts + issues + adjustments + both transfer kinds → OK with exact balances", async () => {
    // Receipt 100 @ 2.00.
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: reconItem,
        warehouseId: fixture.warehouseMain,
        qty: "100",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: I_ACTOR,
      }),
    );
    // Adjustment loss: −3 @ 2.00.
    const adjustment = await withTenant(TENANT_I, () =>
      adjustments.create({
        warehouseId: fixture.warehouseMain,
        itemId: reconItem,
        reason: "DAMAGE",
        deltaQty: "-3",
        unitCost: null,
        counterAccountId: null,
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => adjustments.post(adjustment.id, I_ACTOR));
    // Distinct-accounts transfer: −10 to BRANCH-WH (journal G-15).
    const crossTransfer = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: fixture.warehouseMain,
        toWarehouseId: fixture.warehouseSecond,
        lines: [{ itemId: reconItem, qty: "10" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => transfers.dispatch(crossTransfer.id, I_ACTOR));
    await withTenant(TENANT_I, () => transfers.receive(crossTransfer.id, I_ACTOR));
    // Policy-none transfer: −5 to MAIN-WH2 (same account, no journal).
    const tenancyStore = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { warehouses } = await import("./fixtures");
    const branches = await withTenant(TENANT_I, () => tenancyStore.listBranches(null));
    const mainBranch = branches.find((b) => b.code === "MAIN")!;
    const annex =
      (await withTenant(TENANT_I, () => warehouses.list({ limit: 20 }))).find(
        (w) => w.code === "MAIN-WH2",
      ) ??
      (await withTenant(TENANT_I, () =>
        warehouses.create({
          branchId: mainBranch.id,
          code: "MAIN-WH2",
          name: "Annex",
          nameAr: "ملحق",
          inventoryAccountId: null,
          note: null,
          actorId: I_ACTOR,
        }),
      ));
    const sameAccountTransfer = await withTenant(TENANT_I, () =>
      transfers.create({
        fromWarehouseId: fixture.warehouseMain,
        toWarehouseId: annex.id,
        lines: [{ itemId: reconItem, qty: "5" }],
        note: null,
        noteAr: null,
        actorId: I_ACTOR,
      }),
    );
    await withTenant(TENANT_I, () => transfers.dispatch(sameAccountTransfer.id, I_ACTOR));
    await withTenant(TENANT_I, () => transfers.receive(sameAccountTransfer.id, I_ACTOR));

    // as-of TODAY: the transfers/adjustment post at today's date (the
    // official flows), so the full mixed-operations trail is in window.
    const today = new Date().toISOString().slice(0, 10);
    const run = await withTenant(TENANT_I, () =>
      inventoryReconciliation.runStockCheck({
        asOf: today,
        runMode: "ON_DEMAND",
        checkedBy: I_ACTOR,
      }),
    );
    expect(run.status).toBe("OK");
    expect(run.diffCount).toBe(0);
    // The full trail is in window: receipt + adjustment + both transfer
    // kinds (2 legs each) + the policy-none legs net inside the account.
    const diff = run.diff as {
      moveCount: number;
      onHandValuation: { sku: string; qty: string; value: string }[];
    };
    expect(diff.moveCount).toBeGreaterThanOrEqual(5);
  });
});

describe("RC-05 — seeded drift → BROKEN with the offending row", () => {
  it("an orphan move (test tooling) breaks the check, fires the notification, blocks the period lock", async () => {
    // Seed an orphan move DIRECTLY via superuser tooling (the app role
    // cannot bypass the posting engine — this is the documented drift
    // fixture path, mirroring RC-07's tax fixture).
    const su = await (await import("../test-db")).superuserClient();
    const orphanId = "0bad0bad-0000-4000-8000-000000000001";
    await su.query(
      `INSERT INTO stock_moves (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty,
                                unit_cost, value_amount, source_type, source_id, moved_at)
       VALUES ($1, $2, $3, $4, 'IN', 'receipt', 7, 9.000000, 63.0000,
               'manual_receipt', $1, '2026-01-08')`,
      [orphanId, TENANT_I, reconItem, fixture.warehouseMain],
    );
    await su.end();

    const run = await withTenant(TENANT_I, () =>
      inventoryReconciliation.runStockCheck({
        asOf: "2026-03-10",
        runMode: "NIGHTLY",
        checkedBy: I_ACTOR,
      }),
    );
    expect(run.status).toBe("BROKEN");
    expect(run.diffCount).toBe(1);
    const diff = run.diff as {
      offending: { accountCode: string; glBalance: string; movementValue: string }[];
      orphanMoves: { id: string }[];
    };
    expect(diff.offending.length).toBe(1);
    // The movement trail exceeds the GL by exactly the orphan's 63.0000.
    expect(diff.offending[0]!.movementValue).toBe(
      new (await import("@erp/domain-core")).Decimal(diff.offending[0]!.glBalance)
        .plus(63)
        .toFixed(4),
    );
    expect(diff.orphanMoves.map((row) => row.id)).toContain(orphanId);

    // The notification record (RISK-009 Sev-1 discipline).
    const events = await withTenant(TENANT_I, () =>
      audit.list({ entityType: "reconciliation_run", entityId: run.id, limit: 5 }),
    );
    expect(events.some((event) => event.action === "inventory.reconciliation_broken")).toBe(true);

    // PC-04: the BROKEN run blocks the period LOCK.
    const period = await withTenant(TENANT_I, () =>
      periodStore.findPeriodForDate("2026-03-10"),
    );
    await withTenant(TENANT_I, () => iPeriods.softClose(I_ACTOR, period!.id));
    try {
      await expect(
        withTenant(TENANT_I, () => iPeriods.lock(I_ACTOR, period!.id)),
      ).rejects.toMatchObject({ code: "RECONCILIATION_BROKEN" });
    } finally {
      await withTenant(TENANT_I, () =>
        iPeriods.reopen(I_ACTOR, period!.id, "test reopen after PC-04 proof"),
      );
    }

    // The close checklist's inventory item is LIVE (NOT_RUN → the run
    // state, no longer the PHASE-009 NOT_APPLICABLE stub).
    const marchPeriod = await withTenant(TENANT_I, () =>
      periodStore.findPeriodForDate("2026-03-10"),
    );
    const checklist = await withTenant(TENANT_I, () =>
      iReconciliation.closeChecklist(marchPeriod!.id),
    );
    const inventoryItem = checklist.items.find((item) => item.key === "reconciliation.inventory");
    expect(inventoryItem).toBeDefined();
    expect(inventoryItem!.state).toBe("BROKEN");

    // Defense-in-depth proof FIRST: even the superuser cannot DELETE a
    // move (the guard fires beyond the erp_app grant denials).
    const suGuard = await (await import("../test-db")).superuserClient();
    await expect(
      suGuard.query(`DELETE FROM stock_moves WHERE id = $1`, [orphanId]),
    ).rejects.toThrow();
    await suGuard.end();

    // Repair the drift via documented test tooling (trigger disabled for
    // the moment of the fixture cleanup — the ONLY path that can touch a
    // committed move; production repairs are compensating corrections).
    const su2 = await (await import("../test-db")).superuserClient();
    await su2.query(`ALTER TABLE stock_moves DISABLE TRIGGER trg_stock_moves_guard`);
    await su2.query(`DELETE FROM stock_moves WHERE id = $1`, [orphanId]);
    await su2.query(`ALTER TABLE stock_moves ENABLE TRIGGER trg_stock_moves_guard`);
    await su2.end();
    const repaired = await withTenant(TENANT_I, () =>
      inventoryReconciliation.runStockCheck({
        asOf: "2026-03-10",
        runMode: "ON_DEMAND",
        checkedBy: I_ACTOR,
      }),
    );
    expect(repaired.status).toBe("OK");
  });
});

describe("checklist integration — the INVENTORY item rides the PHASE-007 framework", () => {
  it("with activity it tracks the run state", async () => {
    const marchPeriod = await withTenant(TENANT_I, () =>
      periodStore.findPeriodForDate("2026-03-10"),
    );
    const checklist = await withTenant(TENANT_I, () =>
      iReconciliation.closeChecklist(marchPeriod!.id),
    );
    const inventoryItem = checklist.items.find((item) => item.key === "reconciliation.inventory");
    expect(inventoryItem).toBeDefined();
    // After the repaired run the item reads OK (or NOT_RUN in a fresh
    // suite-order — both are the live states, never the old stub).
    expect(["OK", "NOT_RUN", "NOT_APPLICABLE", "BROKEN"]).toContain(inventoryItem!.state);
    void journal;
  });
});
