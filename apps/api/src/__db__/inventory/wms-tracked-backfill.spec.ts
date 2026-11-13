import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { sql } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import { WmsService } from "../../modules/inventory/application/wms.service";
import * as wmsStore from "../../modules/inventory/infrastructure/wms-store";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import {
  I_ACTOR,
  I_FEB,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  stock,
  tracking,
  type InventoryFixture,
} from "./fixtures";

/**
 * PHASE-044 post-closure audit fix — the tracked-item backfill evidence:
 * legacy stock on BATCH-TRACKED and SERIALIZED items must be DISTRIBUTED
 * from the proven sources of truth (the stock_moves ledger per
 * (batch, warehouse) / per serial), reconciled against the (warehouse,
 * item) total BEFORE any write — never a blind NULL-dimension row that the
 * pick allocation walk cannot spend.
 *
 * The audit's demanded coverage, one continuous corpus on tenant I:
 * - batch-tracked distribution + spending after the migration (explicit
 *   batch AND FEFO — the bin rows match the issue slices),
 * - serialized distribution (one row per provable unit) + spending after
 *   the migration (the named-unit issue finds its rows),
 * - PARTIAL_UNATTRIBUTED residue (stock without ledger proof) is never
 *   written and never hidden: the probe keeps reporting it,
 * - NON_RECONCILABLE (the ledger claims MORE than item_stock): nothing is
 *   written for the item,
 * - dry-run writes nothing (and reports the planned per-batch/serial
 *   writes), the re-run writes nothing new, and two CONCURRENT runs
 *   converge on the advisory lock (exactly one write, fold exact).
 */

let fixture: InventoryFixture;
let wms: WmsService;

const SKU_BATCH = "INV-TBF-BATCH";
const SKU_SERIAL = "INV-TBF-SER";
const SKU_NON_RECON = "INV-TBF-NONRECON";
const SKU_CONCURRENT = "INV-TBF-CONC";

let batchItem = "";
let serialItem = "";
let nonReconItem = "";
let concurrentItem = "";
let batch1 = "";
let batch2 = "";
let serial1 = "";
let serial2 = "";
let serialSoldConflict = "";

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  wms = new WmsService(new AuditService(new DrizzleAuditStore()), new InboxService());
  const wh = fixture.warehouseMain;

  // -- The batch-tracked legacy shape: item_stock 100 over TWO ledger-proven
  // batches (40 + 20) plus 40 units of NULL-batch pre-tracking stock — the
  // raw pre-WMS rows (no bin_contents anywhere), the honest migration-era
  // residue. The ledger legs are the same rows batchOnHand/listFefoBatches
  // fold at runtime.
  batchItem = await ensureInventoryItem(SKU_BATCH, "TBF batch item", { trackBatch: true });
  await withTenant(TENANT_I, async (tx) => {
    await tx.execute(sql`
      INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${batchItem}, 'TBF-B1', '2026-03-31', 'ACTIVE'),
             (gen_random_uuid(), erp.current_tenant_id(), ${batchItem}, 'TBF-B2', '2026-06-30', 'ACTIVE')
      ON CONFLICT DO NOTHING`);
    const b = await tx.execute<{ id: string; no: string }>(sql`
      SELECT id, batch_no AS no FROM item_batches
      WHERE tenant_id = erp.current_tenant_id() AND item_id = ${batchItem}
      ORDER BY batch_no`);
    batch1 = b.rows[0]!.id;
    batch2 = b.rows[1]!.id;
    await tx.execute(sql`
      INSERT INTO stock_moves
        (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
         value_amount, batch_id, source_type, source_id, moved_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${batchItem}, ${wh}, 'IN', 'receipt',
              40, 2.500000, 100.0000, ${batch1}, 'manual_receipt', ${batchItem}, '2026-01-05'),
             (gen_random_uuid(), erp.current_tenant_id(), ${batchItem}, ${wh}, 'IN', 'receipt',
              20, 3.500000, 70.0000, ${batch2}, 'manual_receipt', ${batchItem}, '2026-01-06')`);
    await tx.execute(sql`
      INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${batchItem}, ${wh}, 100, 2.500000)
      ON CONFLICT DO NOTHING`);
  });

  // -- The serialized legacy shape: item_stock claims 3 units. Two serials
  // are ledger-provable in_stock at this warehouse; one is registered
  // in_stock with NO ledger legs (the phantom unit); one says sold in the
  // registry while its ledger leg is still +1 here (the conflicting
  // source). The backfill may only place the two provable units.
  serialItem = await ensureInventoryItem(SKU_SERIAL, "TBF serial item", { trackSerial: true });
  serial1 = (
    await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: serialItem, serialNo: "TBF-S-0001", imei: null, actorId: I_ACTOR }),
    )
  ).id;
  serial2 = (
    await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId: serialItem, serialNo: "TBF-S-0002", imei: null, actorId: I_ACTOR }),
    )
  ).id;
  // TBF-S-0003: registered in_stock with NO ledger legs — the phantom
  // unit item_stock claims but no evidence places (stays unplaced).
  await withTenant(TENANT_I, () =>
    tracking.registerSerial({ itemId: serialItem, serialNo: "TBF-S-0003", imei: null, actorId: I_ACTOR }),
  );
  await withTenant(TENANT_I, async (tx) => {
    const sold = await tx.execute<{ id: string }>(sql`
      INSERT INTO item_serials (id, tenant_id, item_id, serial_no, status, sold_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${serialItem}, 'TBF-S-0004', 'sold', '2026-01-20')
      RETURNING id`);
    serialSoldConflict = sold.rows[0]!.id;
    await tx.execute(sql`
      INSERT INTO stock_moves
        (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
         value_amount, serial_id, source_type, source_id, moved_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${serialItem}, ${wh}, 'IN', 'receipt',
              1, 10.000000, 10.0000, ${serial1}, 'manual_receipt', ${serialItem}, '2026-01-05'),
             (gen_random_uuid(), erp.current_tenant_id(), ${serialItem}, ${wh}, 'IN', 'receipt',
              1, 10.000000, 10.0000, ${serial2}, 'manual_receipt', ${serialItem}, '2026-01-06'),
             (gen_random_uuid(), erp.current_tenant_id(), ${serialItem}, ${wh}, 'IN', 'receipt',
              1, 10.000000, 10.0000, ${serialSoldConflict}, 'manual_receipt', ${serialItem}, '2026-01-07')`);
    await tx.execute(sql`
      INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${serialItem}, ${wh}, 3, 10.000000)
      ON CONFLICT DO NOTHING`);
  });

  // -- The NON_RECONCILABLE shape: the batch ledger claims 90 at this
  // warehouse while item_stock holds 50 (a NULL-batch OUT leg reduced the
  // position without touching the batch) — the sources disagree, so the
  // distribution is untrustworthy and NOTHING may be written.
  nonReconItem = await ensureInventoryItem(SKU_NON_RECON, "TBF non-reconcilable item", {
    trackBatch: true,
  });
  await withTenant(TENANT_I, async (tx) => {
    await tx.execute(sql`
      INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date, status)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${nonReconItem}, 'TBF-NR-1', '2026-09-30', 'ACTIVE')
      ON CONFLICT DO NOTHING`);
    const b = await tx.execute<{ id: string }>(sql`
      SELECT id FROM item_batches
      WHERE tenant_id = erp.current_tenant_id() AND item_id = ${nonReconItem} LIMIT 1`);
    const nrBatch = b.rows[0]!.id;
    await tx.execute(sql`
      INSERT INTO stock_moves
        (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
         value_amount, batch_id, source_type, source_id, moved_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${nonReconItem}, ${wh}, 'IN', 'receipt',
              90, 1.000000, 90.0000, ${nrBatch}, 'manual_receipt', ${nonReconItem}, '2026-01-05')`);
    await tx.execute(sql`
      INSERT INTO stock_moves
        (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
         value_amount, source_type, source_id, moved_at, reason)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${nonReconItem}, ${wh}, 'OUT', 'issue',
              40, 1.000000, 40.0000, 'manual_issue', ${nonReconItem}, '2026-01-08', 'DAMAGE')`);
    await tx.execute(sql`
      INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${nonReconItem}, ${wh}, 50, 1.000000)
      ON CONFLICT DO NOTHING`);
  });
});

/** Σ tenant-owned bin_contents for (warehouse, item) — the INV-029 fold. */
async function binSum(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_I, async () => {
    const rows = await wmsStore.listBinContents({ warehouseId, itemId, limit: 1000 });
    return rows
      .filter((row) => row.ownerPartnerId === null)
      .reduce((acc, row) => acc + Number(row.qty), 0)
      .toFixed(6);
  });
}

/**
 * SUITE HYGIENE (the recon.spec RC-05 cleanup precedent): the seeded
 * legacy rows are ORPHANS by design — moves without journals (the pre-WMS
 * shape under test) and serial moves without serial_movements rows. They
 * are removed at the spec's end through the documented superuser tooling
 * (guard trigger disabled for the moment of the fixture cleanup) so the
 * sibling suites' tenant-wide folds — INV-010 (RC-04/RC-05, golden G-16,
 * the counts/valuation packs) and the T-11 serial-ledger completeness
 * property — stay clean over the shared tenant. The SERVICE-posted moves
 * (through manualIssue) stay: each carries its balanced journal and its
 * serial_movements row, so they are fold-consistent by construction. The
 * item_stock/bin_contents residue (the unproven shortfall the test asserts
 * stays visible) is money-neutral for those folds and remains.
 */
afterAll(async () => {
  const su = await (await import("../test-db")).superuserClient();
  await su.query(`ALTER TABLE stock_moves DISABLE TRIGGER trg_stock_moves_guard`);
  await su.query(
    `DELETE FROM stock_moves WHERE tenant_id = $1 AND posted_journal_id IS NULL
       AND item_id IN ($2, $3, $4)`,
    [TENANT_I, batchItem, serialItem, nonReconItem],
  );
  await su.query(`ALTER TABLE stock_moves ENABLE TRIGGER trg_stock_moves_guard`);
  await su.end();
});

async function stockQty(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_I, async () => {
    const row = await store.findItemStock(itemId, warehouseId);
    return row?.qty ?? "0.000000";
  });
}

describe("PHASE-044 audit fix — the tracked-item backfill (dry-run → live → spend → residue)", () => {
  it("DRY-RUN reports the per-batch/per-serial distribution and the residue classifications WITHOUT writing", async () => {
    const wh = fixture.warehouseMain;
    const dry = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: true, actorId: I_ACTOR }),
    );
    expect(dry.dryRun).toBe(true);
    expect(dry.rows).toBe(0);

    const batchRow = dry.report.find((row) => row.itemSku === SKU_BATCH);
    expect(batchRow).toBeDefined();
    expect(batchRow!.tracking).toBe("BATCH");
    expect(batchRow!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(batchRow!.residueQty).toBe("40.000000");
    // The planned writes name BOTH ledger-proven batches.
    expect(batchRow!.plannedWrites).toEqual([
      { batchNo: "TBF-B1", serialNo: null, qty: "40.000000" },
      { batchNo: "TBF-B2", serialNo: null, qty: "20.000000" },
    ]);

    const serialRow = dry.report.find((row) => row.itemSku === SKU_SERIAL);
    expect(serialRow).toBeDefined();
    expect(serialRow!.tracking).toBe("SERIAL");
    expect(serialRow!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(serialRow!.residueQty).toBe("1.000000");
    expect(serialRow!.plannedWrites).toEqual([
      { batchNo: null, serialNo: "TBF-S-0001", qty: "1.000000" },
      { batchNo: null, serialNo: "TBF-S-0002", qty: "1.000000" },
    ]);
    // The conflicting registry/ledger serial is NAMED in the notes.
    expect(serialRow!.notes.some((note) => note.includes("TBF-S-0004"))).toBe(true);

    const nonReconRow = dry.report.find((row) => row.itemSku === SKU_NON_RECON);
    expect(nonReconRow).toBeDefined();
    expect(nonReconRow!.classification).toBe("NON_RECONCILABLE");
    expect(nonReconRow!.plannedWrites).toEqual([]);

    // NOTHING was written for any of them.
    for (const item of [batchItem, serialItem, nonReconItem]) {
      expect(await binSum(wh, item)).toBe("0.000000");
    }
  });

  it("the LIVE pass distributes batch stock per the ledger and spending WORKS after the migration (explicit batch + FEFO)", async () => {
    const wh = fixture.warehouseMain;
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    expect(live.dryRun).toBe(false);
    const batchRow = live.report.find((row) => row.itemSku === SKU_BATCH);
    expect(batchRow!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(live.partialItems).toBeGreaterThanOrEqual(2);
    expect(live.nonReconcilableItems).toBeGreaterThanOrEqual(1);

    // The default bin carries the two BATCH-DIMENSIONED rows — the fix's
    // core assertion: a tracked row names its batch (never NULL dims).
    const defaultBin = await withTenant(TENANT_I, () => wmsStore.ensureDefaultBin(wh));
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: defaultBin.id, itemId: batchItem, limit: 10 }),
    );
    const b1 = rows.find((row) => row.batchNo === "TBF-B1");
    const b2 = rows.find((row) => row.batchNo === "TBF-B2");
    expect(b1).toBeDefined();
    expect(b1!.qty).toBe("40.000000");
    expect(b1!.status).toBe("AVAILABLE");
    expect(b1!.ownerPartnerId).toBeNull();
    expect(b2).toBeDefined();
    expect(b2!.qty).toBe("20.000000");
    // No NULL-dimension row was invented for the unproven 40.
    expect(rows.some((row) => row.batchId === null)).toBe(false);
    expect(await binSum(wh, batchItem)).toBe("60.000000");

    // SPENDING after the migration: an explicit-batch issue of the whole
    // B1 batch succeeds — pre-fix this threw BinContentsShortError because
    // the backfill row had no batch dimension for the slice to match.
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: batchItem,
        warehouseId: wh,
        qty: "40",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: I_FEB,
        batchId: batch1,
        actorId: I_ACTOR,
      }),
    );
    expect(await binSum(wh, batchItem)).toBe("20.000000");
    expect(await stockQty(wh, batchItem)).toBe("60.000000");

    // FEFO issue (no explicit batch): the slice takes B2 (the only batch
    // with on-hand) and the bin walk finds its row.
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: batchItem,
        warehouseId: wh,
        qty: "10",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: I_FEB,
        actorId: I_ACTOR,
      }),
    );
    expect(await binSum(wh, batchItem)).toBe("10.000000");
    expect(await stockQty(wh, batchItem)).toBe("50.000000");
  });

  it("the serialized distribution names each provable unit and spending WORKS after the migration", async () => {
    const wh = fixture.warehouseMain;
    const defaultBin = await withTenant(TENANT_I, () => wmsStore.ensureDefaultBin(wh));
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: defaultBin.id, itemId: serialItem, limit: 10 }),
    );
    // One row per provable serial — qty 1, serial dimension set, batch
    // NULL (the serialized slice shape), the phantom and the sold-conflict
    // serials NEVER placed.
    expect(rows).toHaveLength(2);
    const placed = new Set(rows.map((row) => row.serialNo));
    expect(placed).toEqual(new Set(["TBF-S-0001", "TBF-S-0002"]));
    for (const row of rows) {
      expect(row.qty).toBe("1.000000");
      expect(row.batchId).toBeNull();
      expect(row.status).toBe("AVAILABLE");
    }

    // SPENDING after the migration: the named-unit issue finds its rows —
    // pre-fix this threw BinContentsShortError (NULL serial dims).
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: serialItem,
        warehouseId: wh,
        qty: "2",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: I_FEB,
        serialIds: [serial1, serial2],
        actorId: I_ACTOR,
      }),
    );
    expect(await binSum(wh, serialItem)).toBe("0.000000");
    expect(await stockQty(wh, serialItem)).toBe("1.000000");
  });

  it("unproven residue is never written and never silenced: the probe keeps reporting both cases", async () => {
    const wh = fixture.warehouseMain;
    // Batch item: bins 10 vs stock 50 — the 40-unit residue stays visible.
    expect(await binSum(wh, batchItem)).toBe("10.000000");
    expect(await stockQty(wh, batchItem)).toBe("50.000000");
    // Serial item: bins 0 vs stock 1 — the phantom unit stays visible.
    expect(await stockQty(wh, serialItem)).toBe("1.000000");
    // Non-reconcilable: NOTHING was ever written.
    expect(await binSum(wh, nonReconItem)).toBe("0.000000");
    expect(await stockQty(wh, nonReconItem)).toBe("50.000000");

    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter(
      (row) => row.itemSku === SKU_BATCH || row.itemSku === SKU_SERIAL || row.itemSku === SKU_NON_RECON,
    );
    expect(mine).toHaveLength(3);
    const bySku = new Map(mine.map((row) => [row.itemSku, row]));
    // Numeric compares: the probe's ::text fold prints integer "0" when no
    // bin row exists and "0.000000" when zero-qty rows remain.
    expect(Number(bySku.get(SKU_BATCH)!.binQty)).toBe(10);
    expect(Number(bySku.get(SKU_BATCH)!.stockQty)).toBe(50);
    expect(Number(bySku.get(SKU_SERIAL)!.binQty)).toBe(0);
    expect(Number(bySku.get(SKU_SERIAL)!.stockQty)).toBe(1);
    expect(Number(bySku.get(SKU_NON_RECON)!.binQty)).toBe(0);
    expect(Number(bySku.get(SKU_NON_RECON)!.stockQty)).toBe(50);
  });

  it("the re-run writes nothing new (the proven parts are already placed; the residue is not inventable)", async () => {
    const wh = fixture.warehouseMain;
    const before = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: batchItem, limit: 100 }),
    );
    const second = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const batchRow = second.report.find((row) => row.itemSku === SKU_BATCH);
    expect(batchRow).toBeDefined();
    expect(batchRow!.plannedWrites).toEqual([]);
    expect(batchRow!.residueQty).toBe("40.000000");
    const after = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: batchItem, limit: 100 }),
    );
    expect(after).toEqual(before);
    expect(await binSum(wh, nonReconItem)).toBe("0.000000");
  });

  it("two CONCURRENT runs converge on the advisory lock — exactly one write, the fold exact", async () => {
    const wh = fixture.warehouseMain;
    // The concurrency shape is seeded HERE (not in beforeAll) so the
    // earlier live passes cannot consume it first: plain untracked legacy
    // stock, no bins.
    concurrentItem = await ensureInventoryItem(SKU_CONCURRENT, "TBF concurrency item");
    await withTenant(TENANT_I, async (tx) => {
      await tx.execute(sql`
        INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${concurrentItem}, ${wh}, 30, 1.000000)
        ON CONFLICT DO NOTHING`);
    });
    expect(await binSum(wh, concurrentItem)).toBe("0.000000");
    // Two parallel tenant UoWs computing the same shortfall: the loser
    // blocks on the advisory lock, re-reads the healed fold, writes nothing.
    const results = await Promise.all([
      withTenant(TENANT_I, () => wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR })),
      withTenant(TENANT_I, () => wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR })),
    ]);
    // Exactly one of the two wrote the 30-unit row.
    const writers = results.filter((r) =>
      r.report.some((row) => row.itemSku === SKU_CONCURRENT && row.classification === "WRITABLE"),
    );
    expect(writers).toHaveLength(1);
    const defaultBin = await withTenant(TENANT_I, () => wmsStore.ensureDefaultBin(wh));
    const rows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ binId: defaultBin.id, itemId: concurrentItem, limit: 10 }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.qty).toBe("30.000000");
    expect(await binSum(wh, concurrentItem)).toBe("30.000000");
    expect(await stockQty(wh, concurrentItem)).toBe("30.000000");
  });

  it("the live pass audits the classification summary (partial + non-reconcilable counts)", async () => {
    // The audit row of the FIRST live pass carries the honest counts —
    // queried through the app role on the tenant's own audit trail.
    const rows = await withTenant(TENANT_I, async (tx) => {
      const result = await tx.execute<{
        action: string;
        after: { partialItems?: number; nonReconcilableItems?: number };
      }>(sql`
        SELECT action, after FROM audit_events
        WHERE tenant_id = erp.current_tenant_id()
          AND action = 'inventory.wms_bins_backfilled'
          AND after->>'partialItems' IS NOT NULL
        ORDER BY at DESC LIMIT 1`);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.after.partialItems).toBeGreaterThanOrEqual(2);
    expect(rows[0]!.after.nonReconcilableItems).toBeGreaterThanOrEqual(1);
  });
});
