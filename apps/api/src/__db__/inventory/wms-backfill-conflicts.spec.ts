import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { withTenant, type TenantDb } from "../../infra/db/tenant-context";
import { WmsService } from "../../modules/inventory/application/wms.service";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import {
  I_ACTOR,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  tracking,
  type InventoryFixture,
} from "./fixtures";

/**
 * PHASE-044 post-closure audit fix, wave 3 — the BATCH-BALANCE CONFLICT
 * HIDING (the owner's review of a8db23e, point 2):
 *
 * `listBatchDistribution` clamps a batch's negative ledger-vs-bins
 * difference to zero (`GREATEST(ledger − bins, 0)`), and the classification
 * loop skipped the clamped rows SILENTLY. The owner's case — batch A
 * ledger 5 / bins 8, batch B ledger 2 / bins 0, item_stock 10 — made the
 * live pass write 2 for B, classify the position WRITABLE (Σ bins 10 ==
 * item_stock), and the aggregate probe went GREEN: batch A's per-batch
 * disagreement (bins holding 3 units the ledger never moved) vanished
 * from the only recurring detector. Pre-fix reproduced by the
 * stash-and-run proof (the WRITABLE + probe-green assertions of test 1
 * fail on the a8db23e service); the fixed pass names every conflicting
 * batch, refuses the totals-matching WRITABLE, writes NOTHING, and keeps
 * the position whole to the nightly probe.
 *
 * The serialized path carries the exact analogue (an over-placed serial
 * whose provable sibling exactly covers the shortfall) — the same guard,
 * test-proven here. A position whose residue > 0 keeps the probe visible
 * anyway: its proven writes stay legitimate (PARTIAL_UNATTRIBUTED, the
 * TBF-S-0004 precedent) — also test-proven here.
 *
 * SUITE HYGIENE (the tracked-backfill spec precedent): the seeded ledger
 * legs are ORPHANS by design (pre-WMS moves without journals) and are
 * removed at the spec's end through the documented superuser window so
 * the sibling suites' tenant-wide folds (INV-010, the T-11 completeness
 * property) stay clean. The bin/item_stock residue (the conflict the
 * tests assert stays visible) is money-neutral for those folds and
 * remains — the wms-inv029/wms-budgets per-SKU filter precedent.
 */
let fixture: InventoryFixture;
let wms: WmsService;

const SKU_CONFLICT = "INV-BFC-A"; // the owner's A/B case (test 1-4)
const SKU_PARTIAL = "INV-BFC-PARTIAL"; // conflict + residue > 0 (test 5)
const SKU_SERIAL = "INV-BFC-SER"; // the serialized analogue (test 6)
const SKU_HEALTHY = "INV-BFC-OK"; // the healthy WRITABLE guard (test 7)

let conflictItem = "";
let partialItem = "";
let serialItem = "";
let healthyItem = "";

/** Seed ONE batch (ACTIVE) with its ledger IN leg (an orphan pre-WMS move). */
async function seedBatch(
  tx: TenantDb,
  itemId: string,
  batchNo: string,
  qty: number,
  wh: string,
): Promise<string> {
  await tx.execute(sql`
    INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date, status)
    VALUES (gen_random_uuid(), erp.current_tenant_id(), ${itemId}, ${batchNo}, '2026-09-30', 'ACTIVE')
    ON CONFLICT DO NOTHING`);
  const b = await tx.execute<{ id: string }>(sql`
    SELECT id FROM item_batches
    WHERE tenant_id = erp.current_tenant_id() AND item_id = ${itemId} AND batch_no = ${batchNo}
    LIMIT 1`);
  const batchId = b.rows[0]!.id;
  await tx.execute(sql`
    INSERT INTO stock_moves
      (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
       value_amount, batch_id, source_type, source_id, moved_at)
    VALUES (gen_random_uuid(), erp.current_tenant_id(), ${itemId}, ${wh}, 'IN', 'receipt',
            ${qty}, 1.000000, ${qty.toFixed(1)}, ${batchId}, 'manual_receipt', ${itemId}, '2026-01-05')`);
  return batchId;
}

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  wms = new WmsService(new AuditService(new DrizzleAuditStore()), new InboxService());
  const wh = fixture.warehouseMain;

  // -- THE OWNER'S CASE (tests 1-4): item_stock 10 over two ledger-proven
  // batches — A ledger 5 with a seeded 8-unit tenant bin row (bins EXCEED
  // the ledger: the per-batch source conflict), B ledger 2 with no bins.
  // The position's aggregate shortfall: 10 − 8 = 2, exactly B's ledger —
  // the totals-matching trap.
  conflictItem = await ensureInventoryItem(SKU_CONFLICT, "BFC conflict item", { trackBatch: true });
  await withTenant(TENANT_I, async (tx) => {
    const batchA = await seedBatch(tx, conflictItem, "BFC-A", 5, wh);
    await seedBatch(tx, conflictItem, "BFC-B", 2, wh);
    const defaultBin = await wmsStore.ensureDefaultBin(wh);
    await tx.execute(sql`
      INSERT INTO bin_contents
        (id, tenant_id, bin_id, warehouse_id, item_id, batch_id, serial_id,
         lpn_id, owner_partner_id, status, qty, uom_id, received_at, note, created_by)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${defaultBin.id}, ${wh}, ${conflictItem},
              ${batchA}, NULL, NULL, NULL, 'AVAILABLE', 8, NULL, now(),
              'BFC seeded conflicting batch surplus (bins 8 vs ledger 5)', NULL)
      ON CONFLICT DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${conflictItem}, ${wh}, 10, 1.000000)
      ON CONFLICT DO NOTHING`);
  });

  // -- CONFLICT + RESIDUE (test 5): item_stock 20, A ledger 5 / bins 8,
  // B ledger 2 / bins 0 — the shortfall 12 exceeds the proven 2, so the
  // residue keeps the probe visible: B's write stays legitimate.
  partialItem = await ensureInventoryItem(SKU_PARTIAL, "BFC partial-conflict item", {
    trackBatch: true,
  });
  await withTenant(TENANT_I, async (tx) => {
    const batchA = await seedBatch(tx, partialItem, "BFC-PA", 5, wh);
    await seedBatch(tx, partialItem, "BFC-PB", 2, wh);
    const defaultBin = await wmsStore.ensureDefaultBin(wh);
    await tx.execute(sql`
      INSERT INTO bin_contents
        (id, tenant_id, bin_id, warehouse_id, item_id, batch_id, serial_id,
         lpn_id, owner_partner_id, status, qty, uom_id, received_at, note, created_by)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${defaultBin.id}, ${wh}, ${partialItem},
              ${batchA}, NULL, NULL, NULL, 'AVAILABLE', 8, NULL, now(),
              'BFC seeded conflicting batch surplus (partial case)', NULL)
      ON CONFLICT DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${partialItem}, ${wh}, 20, 1.000000)
      ON CONFLICT DO NOTHING`);
  });

  // -- THE SERIALIZED ANALOGUE (test 6): item_stock 3, one serial seeded
  // with a qty-2 bin row (over-placed — a single-unit serial in two slots'
  // worth of quantity) plus one clean provable serial: the provable unit
  // exactly covers the 1-unit aggregate shortfall (3 − 2) — the
  // totals-matching trap, serial edition.
  serialItem = await ensureInventoryItem(SKU_SERIAL, "BFC serial item", { trackSerial: true });
  await withTenant(TENANT_I, async (tx) => {
    const register = async (serialNo: string): Promise<string> =>
      (
        await withTenant(TENANT_I, () =>
          tracking.registerSerial({ itemId: serialItem, serialNo, imei: null, actorId: I_ACTOR }),
        )
      ).id;
    const overPlaced = await register("BFC-S-OVERPLACED");
    const clean = await register("BFC-S-CLEAN");
    await tx.execute(sql`
      INSERT INTO stock_moves
        (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
         value_amount, serial_id, source_type, source_id, moved_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${serialItem}, ${wh}, 'IN', 'receipt',
              1, 10.000000, 10.0, ${overPlaced}, 'manual_receipt', ${serialItem}, '2026-01-02'),
             (gen_random_uuid(), erp.current_tenant_id(), ${serialItem}, ${wh}, 'IN', 'receipt',
              1, 10.000000, 10.0, ${clean}, 'manual_receipt', ${serialItem}, '2026-01-03')`);
    const defaultBin = await wmsStore.ensureDefaultBin(wh);
    await tx.execute(sql`
      INSERT INTO bin_contents
        (id, tenant_id, bin_id, warehouse_id, item_id, batch_id, serial_id,
         lpn_id, owner_partner_id, status, qty, uom_id, received_at, note, created_by)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${defaultBin.id}, ${wh}, ${serialItem},
              NULL, ${overPlaced}, NULL, NULL, 'AVAILABLE', 2, NULL, now(),
              'BFC seeded over-placed serial (qty 2 on one slot)', NULL)
      ON CONFLICT DO NOTHING`);
    await tx.execute(sql`
      INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${serialItem}, ${wh}, 3, 10.000000)
      ON CONFLICT DO NOTHING`);
  });
  // The HEALTHY case (test 7) is seeded INSIDE its test — an earlier
  // live pass would otherwise consume its shortfall first (the
  // tracked-backfill spec's concurrency-item precedent).
});

afterAll(async () => {
  // The seeded orphan legs (no journals, no serial_movements pairs) leave
  // through the documented superuser window — the tracked-backfill spec's
  // afterAll precedent — so the sibling suites' tenant-wide folds stay
  // clean. The bin/item_stock residue (the asserted-visible conflicts)
  // is money-neutral and remains.
  const su = await (await import("../test-db")).superuserClient();
  await su.query(`ALTER TABLE stock_moves DISABLE TRIGGER trg_stock_moves_guard`);
  await su.query(
    `DELETE FROM stock_moves WHERE tenant_id = $1 AND posted_journal_id IS NULL
       AND item_id IN ($2, $3, $4, $5)`,
    [TENANT_I, conflictItem, partialItem, serialItem, healthyItem],
  );
  await su.query(`ALTER TABLE stock_moves ENABLE TRIGGER trg_stock_moves_guard`);
  await su.end();
});

/** Σ tenant-owned bin_contents for (warehouse, item) — the INV-029 fold. */
async function binSum(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_I, async () => {
    const fold = await wmsStore.foldTenantBinQty(warehouseId, itemId);
    return fold.toFixed(6);
  });
}

async function stockQty(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_I, async () => {
    const row = await store.findItemStock(itemId, warehouseId);
    return row?.qty ?? "0.000000";
  });
}

describe("post-044 audit wave 3 — the batch-conflict hiding (A ledger 5/bins 8, B ledger 2/bins 0, stock 10)", () => {
  it("the owner's case is NON_RECONCILABLE — nothing written, the conflict NAMED, never a totals-matching WRITABLE", async () => {
    const wh = fixture.warehouseMain;
    // The aggregate trap: shortfall 2 == B's ledger 2. The pre-fix pass
    // wrote 2 for B and called the position WRITABLE; the fixed pass must
    // refuse — A's bins (8) contradict A's ledger (5), and healing the
    // aggregate would hide it.
    const dry = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: true, actorId: I_ACTOR }),
    );
    const row = dry.report.find((r) => r.itemSku === SKU_CONFLICT);
    expect(row).toBeDefined();
    expect(row!.tracking).toBe("BATCH");
    expect(row!.classification).toBe("NON_RECONCILABLE");
    expect(row!.plannedWrites).toEqual([]);
    // The FULL shortfall stays as the residue (the position stays whole).
    expect(row!.residueQty).toBe("2.000000");
    // The conflict is NAMED with the exact disagreement.
    const notes = row!.notes.join("\n");
    expect(notes).toContain("BFC-A");
    expect(notes).toContain("bins hold 8");
    expect(notes).toContain("ledger nets 5");
    // And the report explains the refusal (never a silent skip).
    expect(notes).toContain("HIDE the named conflict(s)");

    // The LIVE pass writes NOTHING for the position.
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const liveRow = live.report.find((r) => r.itemSku === SKU_CONFLICT);
    expect(liveRow!.classification).toBe("NON_RECONCILABLE");
    expect(await binSum(wh, conflictItem)).toBe("8.000000"); // unchanged
    expect(await stockQty(wh, conflictItem)).toBe("10.000000");
  });

  it("conflict discovery AFTER the migration: the probe keeps the position visible and the audit trail counts it", async () => {
    const wh = fixture.warehouseMain;
    // The nightly probe still lists the position (bins 8 vs stock 10) —
    // the pre-fix write made this probe row VANISH.
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_CONFLICT);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(8);
    expect(Number(mine[0]!.stockQty)).toBe(10);

    // The live pass's audit row counts the non-reconcilable position (the
    // operator's discovery surface alongside the probe).
    const rows = await withTenant(TENANT_I, async (tx) => {
      const result = await tx.execute<{
        after: { nonReconcilableItems?: number };
      }>(sql`
        SELECT after FROM audit_events
        WHERE tenant_id = erp.current_tenant_id()
          AND action = 'inventory.wms_bins_backfilled'
          AND after->>'nonReconcilableItems' IS NOT NULL
        ORDER BY at DESC LIMIT 1`);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after.nonReconcilableItems).toBeGreaterThanOrEqual(1);
  });

  it("the RE-RUN is stable: still NON_RECONCILABLE, nothing new written, the probe unchanged (idempotent refusal)", async () => {
    const wh = fixture.warehouseMain;
    const before = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: conflictItem, limit: 100 }),
    );
    const second = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = second.report.find((r) => r.itemSku === SKU_CONFLICT);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("NON_RECONCILABLE");
    expect(row!.plannedWrites).toEqual([]);
    expect(row!.residueQty).toBe("2.000000");
    const after = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: conflictItem, limit: 100 }),
    );
    expect(after).toEqual(before);
    expect(await binSum(wh, conflictItem)).toBe("8.000000");
  });

  it("two CONCURRENT live passes converge — both refuse, no partial write, the probe unchanged", async () => {
    const wh = fixture.warehouseMain;
    // The advisory lock serializes the two tenant passes; the loser
    // re-reads the same conflicted fold. Neither may write a part of the
    // position (a partial write would land Σ bins on item_stock and hide
    // the conflict exactly like the single-pass pre-fix shape).
    const results = await Promise.all([
      withTenant(TENANT_I, () => wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR })),
      withTenant(TENANT_I, () => wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR })),
    ]);
    for (const pass of results) {
      const row = pass.report.find((r) => r.itemSku === SKU_CONFLICT);
      expect(row).toBeDefined();
      expect(row!.classification).toBe("NON_RECONCILABLE");
    }
    expect(await binSum(wh, conflictItem)).toBe("8.000000");
    expect(await stockQty(wh, conflictItem)).toBe("10.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    expect(probe.some((r) => r.itemSku === SKU_CONFLICT)).toBe(true);
  });

  it("conflict + residue > 0 stays PARTIAL_UNATTRIBUTED: the PROVEN batch is written, the conflict NAMED, the residue visible", async () => {
    const wh = fixture.warehouseMain;
    // stock 20, A ledger 5/bins 8 (conflict), B ledger 2/bins 0 (proven):
    // shortfall 12, proven 2, residue 10 — the probe keeps showing the
    // position, so B's write is legitimate and must still happen (the
    // TBF-S-0004 precedent — the guard only forbids the Hiding write).
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_PARTIAL);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(row!.residueQty).toBe("10.000000");
    const notes = row!.notes.join("\n");
    expect(notes).toContain("BFC-PA");
    expect(notes).toContain("bins hold 8");
    expect(notes).toContain("ledger nets 5");
    // B's 2 landed on the default bin — the proven write.
    expect(await binSum(wh, partialItem)).toBe("10.000000"); // 8 + 2
    expect(await stockQty(wh, partialItem)).toBe("20.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_PARTIAL);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(10);
    expect(Number(mine[0]!.stockQty)).toBe(20);
  });

  it("the SERIALIZED analogue: an over-placed serial whose provable sibling exactly covers the shortfall — NON_RECONCILABLE, nothing placed, the probe keeps it visible", async () => {
    const wh = fixture.warehouseMain;
    // stock 3, bins 2 (the over-placed serial's qty-2 row): the shortfall
    // is 1 and the clean serial is exactly 1 provable unit. Placing it
    // would land Σ bins on 3 == stock and hide the over-placement — the
    // same refusal as the batch path (pre-fix this classified WRITABLE
    // and placed the unit with the conflict swallowed into the notes).
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_SERIAL);
    expect(row).toBeDefined();
    expect(row!.tracking).toBe("SERIAL");
    expect(row!.classification).toBe("NON_RECONCILABLE");
    expect(row!.plannedWrites).toEqual([]);
    expect(row!.residueQty).toBe("1.000000");
    const notes = row!.notes.join("\n");
    expect(notes).toContain("BFC-S-OVERPLACED");
    expect(notes).toContain("HIDE the named conflict(s)");
    expect(await binSum(wh, serialItem)).toBe("2.000000"); // unchanged
    expect(await stockQty(wh, serialItem)).toBe("3.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_SERIAL);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(2);
    expect(Number(mine[0]!.stockQty)).toBe(3);
  });

  it("the guard never over-blocks: a HEALTHY batch position still lands WRITABLE and heals the fold", async () => {
    const wh = fixture.warehouseMain;
    // Seeded HERE (not in beforeAll) — an earlier live pass would consume
    // the healthy shortfall before this test could observe its WRITABLE
    // classification (the tracked-backfill spec's concurrency-item
    // precedent). One clean ACTIVE batch: ledger 10, no bins, stock 10.
    healthyItem = await ensureInventoryItem(SKU_HEALTHY, "BFC healthy item", { trackBatch: true });
    await withTenant(TENANT_I, async (tx) => {
      await seedBatch(tx, healthyItem, "BFC-OK", 10, wh);
      await tx.execute(sql`
        INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${healthyItem}, ${wh}, 10, 1.000000)
        ON CONFLICT DO NOTHING`);
    });
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_HEALTHY);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("WRITABLE");
    expect(row!.residueQty).toBe("0.000000");
    expect(await binSum(wh, healthyItem)).toBe("10.000000");
    expect(await stockQty(wh, healthyItem)).toBe("10.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    expect(probe.some((r) => r.itemSku === SKU_HEALTHY)).toBe(false);
  });
});
