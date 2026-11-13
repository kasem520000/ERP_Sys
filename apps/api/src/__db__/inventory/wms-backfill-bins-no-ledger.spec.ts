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
 * PHASE-044 post-closure audit fix, wave 4 — the BINS-WITHOUT-LEDGER
 * CONFLICT HIDING (the wave-3 evidence §5's recorded limitation, corrected
 * by the owner's review): `listBatchDistribution`'s population was
 * LEDGER-DRIVEN (`FROM ledger l`), so a batch whose bins hold stock with
 * ZERO ledger legs at the warehouse was never listed — never named as a
 * per-batch conflict. The owner's case: batch A in bins 8 with NO ledger
 * movements, batch B ledger 2 / bins 0, item_stock 10 — the aggregate
 * shortfall is 2, exactly B's ledger; the pre-fix pass wrote 2 for B,
 * classified the position WRITABLE, Σ bins landed on 10 == item_stock, and
 * the nightly probe went GREEN: batch A's disagreement (bins claiming 8
 * units the ledger never moved) vanished from the only recurring detector
 * — HIDDEN, not merely unreported (the wave-3 §5 limitation wrongly said
 * the probe "keeps reporting the position until the shortfall is zero":
 * the backfill write itself TAKES it to zero).
 *
 * THE FIX (the union population): the batch comparison now spans the UNION
 * of the batches present in the LEDGER or the BOXES — a FULL OUTER JOIN of
 * the per-batch ledger fold against the tenant-owned bin fold (ownership:
 * `owner_partner_id IS NULL`, the probe's exact fold semantics; bin status:
 * ALL three statuses — the probe folds AVAILABLE/QUARANTINE/HOLD alike, so
 * a HOLD bins-only batch hides exactly like an AVAILABLE one; tenant: the
 * RLS scoping plus the `item_batches` tenant join, complete over the union
 * because both `stock_moves.batch_id` and `bin_contents.batch_id` carry
 * composite same-tenant RESTRICT FKs). A batch whose bins exceed its ledger
 * — legs or no legs — is a NAMED conflict, and the wave-3 totals-matching
 * guard (residue 0 + named conflict ⇒ NON_RECONCILABLE, nothing written)
 * keeps it visible to the probe forever.
 *
 * The serialized path carries the exact analogue at the CLASSIFICATION
 * level (its population was already registry-driven): a placed serial whose
 * ledger does not corroborate the placement (bin rows place 1 here while
 * the ledger nets 0 here / 0 across warehouses) was silently accepted as
 * "already placed" — now named, so a provable sibling can no longer cover
 * the aggregate and hide it. Test-proven here.
 *
 * SUITE HYGIENE (the wave-3 spec's precedent): the seeded orphan legs are
 * removed at the spec's end through the documented superuser window; the
 * bin/item_stock residue (the asserted-visible conflicts) is money-neutral
 * for the sibling folds and remains.
 */
let fixture: InventoryFixture;
let wms: WmsService;

const SKU_BNL = "INV-BNL-A"; // the owner's bins-without-ledger case (tests 1-4)
const SKU_SERIAL = "INV-BNL-SER"; // the serialized analogue (test 7)
const SKU_OK = "INV-BNL-OK"; // the healthy WRITABLE counterpart (test 5)
const SKU_PARTIAL = "INV-BNL-PARTIAL"; // bins-only conflict + residue > 0 (test 6)
const SKU_HOLD = "INV-BNL-HOLD"; // the bin-status consideration (test 8)
const SKU_CONSIG = "INV-BNL-CONSIG"; // the ownership consideration (test 9)

let bnlItem = "";
let serialItem = "";
let okItem = "";
let partialItem = "";
let holdItem = "";
let consigItem = "";

/** Seed ONE ACTIVE batch row WITHOUT any ledger leg (the no-movements shape). */
async function ensureBatchOnly(tx: TenantDb, itemId: string, batchNo: string): Promise<string> {
  await tx.execute(sql`
    INSERT INTO item_batches (id, tenant_id, item_id, batch_no, expiry_date, status)
    VALUES (gen_random_uuid(), erp.current_tenant_id(), ${itemId}, ${batchNo}, '2026-09-30', 'ACTIVE')
    ON CONFLICT DO NOTHING`);
  const b = await tx.execute<{ id: string }>(sql`
    SELECT id FROM item_batches
    WHERE tenant_id = erp.current_tenant_id() AND item_id = ${itemId} AND batch_no = ${batchNo}
    LIMIT 1`);
  return b.rows[0]!.id;
}

/** Seed ONE batch (ACTIVE) with its ledger IN leg (an orphan pre-WMS move). */
async function seedBatch(
  tx: TenantDb,
  itemId: string,
  batchNo: string,
  qty: number,
  wh: string,
): Promise<string> {
  const batchId = await ensureBatchOnly(tx, itemId, batchNo);
  await tx.execute(sql`
    INSERT INTO stock_moves
      (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
       value_amount, batch_id, source_type, source_id, moved_at)
    VALUES (gen_random_uuid(), erp.current_tenant_id(), ${itemId}, ${wh}, 'IN', 'receipt',
            ${qty}, 1.000000, ${qty.toFixed(1)}, ${batchId}, 'manual_receipt', ${itemId}, '2026-01-05')`);
  return batchId;
}

/** Seed one tenant-owned (or partner-owned) bin row for a batch. */
async function seedBinRow(
  tx: TenantDb,
  input: {
    binId: string;
    wh: string;
    itemId: string;
    batchId: string;
    qty: number;
    status?: string;
    ownerPartnerId?: string | null;
    note: string;
  },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO bin_contents
      (id, tenant_id, bin_id, warehouse_id, item_id, batch_id, serial_id,
       lpn_id, owner_partner_id, status, qty, uom_id, received_at, note, created_by)
    VALUES (gen_random_uuid(), erp.current_tenant_id(), ${input.binId}, ${input.wh}, ${input.itemId},
            ${input.batchId}, NULL, NULL, ${input.ownerPartnerId ?? null},
            ${input.status ?? "AVAILABLE"}, ${input.qty}, NULL, now(), ${input.note}, NULL)
    ON CONFLICT DO NOTHING`);
}

async function seedStock(tx: TenantDb, itemId: string, wh: string, qty: number): Promise<void> {
  await tx.execute(sql`
    INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
    VALUES (gen_random_uuid(), erp.current_tenant_id(), ${itemId}, ${wh}, ${qty}, 1.000000)
    ON CONFLICT DO NOTHING`);
}

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  wms = new WmsService(new AuditService(new DrizzleAuditStore()), new InboxService());
  const wh = fixture.warehouseMain;

  // -- THE OWNER'S CASE (tests 1-4): batch A sits in bins with EIGHT units
  // and NOT ONE ledger leg at the warehouse; batch B carries a clean ledger
  // 2 with no bins; item_stock 10. The aggregate shortfall (10 − 8 = 2) is
  // exactly B's ledger — the totals-matching trap, bins-without-ledger
  // edition: healing it hides A forever.
  bnlItem = await ensureInventoryItem(SKU_BNL, "BNL bins-no-ledger item", { trackBatch: true });
  await withTenant(TENANT_I, async (tx) => {
    const batchA = await ensureBatchOnly(tx, bnlItem, "BNL-A");
    await seedBatch(tx, bnlItem, "BNL-B", 2, wh);
    const defaultBin = await wmsStore.ensureDefaultBin(wh);
    await seedBinRow(tx, {
      binId: defaultBin.id,
      wh,
      itemId: bnlItem,
      batchId: batchA,
      qty: 8,
      note: "BNL seeded bins-only batch (8 units, zero ledger legs)",
    });
    await seedStock(tx, bnlItem, wh, 10);
  });

  // -- THE SERIALIZED ANALOGUE (test 7): serial X placed by a bin row with
  // NO ledger legs anywhere; serial Y clean and provable (ledger IN 1
  // here). item_stock 2, Σ bins 1 — the provable Y exactly covers the
  // shortfall: placing it hides X's uncorroborated placement.
  serialItem = await ensureInventoryItem(SKU_SERIAL, "BNL serial item", { trackSerial: true });
  await withTenant(TENANT_I, async (tx) => {
    const register = async (serialNo: string): Promise<string> =>
      (
        await withTenant(TENANT_I, () =>
          tracking.registerSerial({ itemId: serialItem, serialNo, imei: null, actorId: I_ACTOR }),
        )
      ).id;
    const phantom = await register("BNL-S-PHANTOM");
    const clean = await register("BNL-S-CLEAN");
    await tx.execute(sql`
      INSERT INTO stock_moves
        (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
         value_amount, serial_id, source_type, source_id, moved_at)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${serialItem}, ${wh}, 'IN', 'receipt',
              1, 10.000000, 10.0, ${clean}, 'manual_receipt', ${serialItem}, '2026-01-03')`);
    const defaultBin = await wmsStore.ensureDefaultBin(wh);
    await tx.execute(sql`
      INSERT INTO bin_contents
        (id, tenant_id, bin_id, warehouse_id, item_id, batch_id, serial_id,
         lpn_id, owner_partner_id, status, qty, uom_id, received_at, note, created_by)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${defaultBin.id}, ${wh}, ${serialItem},
              NULL, ${phantom}, NULL, NULL, 'AVAILABLE', 1, NULL, now(),
              'BNL seeded placed serial with zero ledger legs', NULL)
      ON CONFLICT DO NOTHING`);
    await seedStock(tx, serialItem, wh, 2);
  });
  // The healthy (test 5), partial (test 6), HOLD (test 8) and consignment
  // (test 9) items are seeded INSIDE their tests — an earlier live pass
  // would otherwise consume their shortfalls first (the wave-3 spec's
  // concurrency-item precedent).
});

afterAll(async () => {
  // The seeded orphan legs (no journals) leave through the documented
  // superuser window — the wave-3 spec's afterAll precedent — so the
  // sibling suites' tenant-wide folds stay clean. The bin/item_stock
  // residue (the asserted-visible conflicts) is money-neutral and remains.
  const su = await (await import("../test-db")).superuserClient();
  await su.query(`ALTER TABLE stock_moves DISABLE TRIGGER trg_stock_moves_guard`);
  await su.query(
    `DELETE FROM stock_moves WHERE tenant_id = $1 AND posted_journal_id IS NULL
       AND item_id IN ($2, $3, $4, $5, $6, $7)`,
    [TENANT_I, bnlItem, serialItem, okItem, partialItem, holdItem, consigItem],
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

describe("post-044 audit wave 4 — the bins-without-ledger hiding (A bins 8/no legs, B ledger 2/bins 0, stock 10)", () => {
  it("the owner's case is NON_RECONCILABLE — the union SEES the bins-only batch, the conflict NAMED, never a totals-matching WRITABLE", async () => {
    // The aggregate trap: shortfall 2 == B's ledger 2, and A (the
    // conflicting batch) has ZERO ledger legs — the pre-fix ledger-driven
    // population never listed A, so no conflict was named and the pass
    // wrote B's 2 as a clean WRITABLE. The union must list A and refuse.
    const dry = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: true, actorId: I_ACTOR }),
    );
    const row = dry.report.find((r) => r.itemSku === SKU_BNL);
    expect(row).toBeDefined();
    expect(row!.tracking).toBe("BATCH");
    expect(row!.classification).toBe("NON_RECONCILABLE");
    expect(row!.plannedWrites).toEqual([]);
    // The FULL shortfall stays as the residue (the position stays whole).
    expect(row!.residueQty).toBe("2.000000");
    // The conflict is NAMED with its exact shape: bins hold 8, NO ledger
    // movements for the batch at this warehouse.
    const notes = row!.notes.join("\n");
    expect(notes).toContain("BNL-A");
    expect(notes).toContain("bins hold 8");
    expect(notes).toContain("the ledger has NO movements for this batch at this warehouse");
    // And the report explains the refusal (never a silent skip).
    expect(notes).toContain("HIDE the named conflict(s)");
  });

  it("the LIVE pass writes NOTHING — B's pinned balance is NOT landed, the probe keeps the conflict visible", async () => {
    const wh = fixture.warehouseMain;
    // The pre-fix pass wrote 2 for B (Σ bins 10 == item_stock 10) and the
    // position vanished from the nightly probe while A's 8 phantom units
    // stayed invisible forever. The fixed pass writes nothing.
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const liveRow = live.report.find((r) => r.itemSku === SKU_BNL);
    expect(liveRow).toBeDefined();
    expect(liveRow!.classification).toBe("NON_RECONCILABLE");
    expect(await binSum(wh, bnlItem)).toBe("8.000000"); // unchanged
    expect(await stockQty(wh, bnlItem)).toBe("10.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_BNL);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(8);
    expect(Number(mine[0]!.stockQty)).toBe(10);
  });

  it("the RE-RUN is stable: still NON_RECONCILABLE, nothing new written (idempotent refusal)", async () => {
    const wh = fixture.warehouseMain;
    const before = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: bnlItem, limit: 100 }),
    );
    const second = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = second.report.find((r) => r.itemSku === SKU_BNL);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("NON_RECONCILABLE");
    expect(row!.plannedWrites).toEqual([]);
    expect(row!.residueQty).toBe("2.000000");
    const after = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: bnlItem, limit: 100 }),
    );
    expect(after).toEqual(before);
    expect(await binSum(wh, bnlItem)).toBe("8.000000");
  });

  it("two CONCURRENT live passes converge — both refuse, no partial write, the probe unchanged", async () => {
    const wh = fixture.warehouseMain;
    const results = await Promise.all([
      withTenant(TENANT_I, () => wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR })),
      withTenant(TENANT_I, () => wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR })),
    ]);
    for (const pass of results) {
      const row = pass.report.find((r) => r.itemSku === SKU_BNL);
      expect(row).toBeDefined();
      expect(row!.classification).toBe("NON_RECONCILABLE");
    }
    expect(await binSum(wh, bnlItem)).toBe("8.000000");
    expect(await stockQty(wh, bnlItem)).toBe("10.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    expect(probe.some((r) => r.itemSku === SKU_BNL)).toBe(true);
  });

  it("the guard never over-blocks: a HEALTHY batch position still lands WRITABLE and heals the fold", async () => {
    const wh = fixture.warehouseMain;
    // Seeded HERE (not in beforeAll) — an earlier live pass would consume
    // the healthy shortfall before this test could observe its WRITABLE
    // classification. One clean ACTIVE batch: ledger 10, no bins, stock 10.
    okItem = await ensureInventoryItem(SKU_OK, "BNL healthy item", { trackBatch: true });
    await withTenant(TENANT_I, async (tx) => {
      await seedBatch(tx, okItem, "BNL-OK", 10, wh);
      await seedStock(tx, okItem, wh, 10);
    });
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_OK);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("WRITABLE");
    expect(row!.residueQty).toBe("0.000000");
    expect(await binSum(wh, okItem)).toBe("10.000000");
    expect(await stockQty(wh, okItem)).toBe("10.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    expect(probe.some((r) => r.itemSku === SKU_OK)).toBe(false);
  });

  it("bins-only conflict + residue > 0 stays PARTIAL_UNATTRIBUTED: the PROVEN batch is written, the conflict NAMED, the residue visible", async () => {
    const wh = fixture.warehouseMain;
    // stock 20, A bins 8 / NO ledger legs (the union-named conflict), B
    // ledger 2 / bins 0 (proven): shortfall 12, proven 2, residue 10 — the
    // probe keeps showing the position, so B's write is legitimate and must
    // still happen (the TBF-S-0004 precedent — the guard only forbids the
    // HIDING write; the union's new note must not over-block it).
    partialItem = await ensureInventoryItem(SKU_PARTIAL, "BNL partial item", { trackBatch: true });
    await withTenant(TENANT_I, async (tx) => {
      const batchA = await ensureBatchOnly(tx, partialItem, "BNL-PA");
      await seedBatch(tx, partialItem, "BNL-PB", 2, wh);
      const defaultBin = await wmsStore.ensureDefaultBin(wh);
      await seedBinRow(tx, {
        binId: defaultBin.id,
        wh,
        itemId: partialItem,
        batchId: batchA,
        qty: 8,
        note: "BNL seeded bins-only batch (partial case)",
      });
      await seedStock(tx, partialItem, wh, 20);
    });
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_PARTIAL);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(row!.residueQty).toBe("10.000000");
    const notes = row!.notes.join("\n");
    expect(notes).toContain("BNL-PA");
    expect(notes).toContain("the ledger has NO movements for this batch at this warehouse");
    // B's 2 landed on the default bin — the proven write.
    expect(await binSum(wh, partialItem)).toBe("10.000000"); // 8 + 2
    expect(await stockQty(wh, partialItem)).toBe("20.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_PARTIAL);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(10);
    expect(Number(mine[0]!.stockQty)).toBe(20);
  });

  it("the SERIALIZED analogue: a placed serial with zero ledger legs — NON_RECONCILABLE, nothing placed, the probe keeps it visible", async () => {
    const wh = fixture.warehouseMain;
    // stock 2, bins 1 (the phantom serial's bin row): the shortfall is 1
    // and the clean serial is exactly 1 provable unit. Placing it would
    // land Σ bins on 2 == stock and hide the phantom placement — the same
    // refusal as the batch path (pre-fix this classified WRITABLE and
    // placed the unit with the phantom swallowed as "already placed").
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
    expect(notes).toContain("BNL-S-PHANTOM");
    expect(notes).toContain("bin rows place 1.000000 unit(s) here");
    expect(notes).toContain("the ledger nets 0 here");
    expect(notes).toContain("HIDE the named conflict(s)");
    expect(await binSum(wh, serialItem)).toBe("1.000000"); // unchanged
    expect(await stockQty(wh, serialItem)).toBe("2.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_SERIAL);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(1);
    expect(Number(mine[0]!.stockQty)).toBe(2);
  });

  it("the BIN-STATUS consideration: a bins-only batch in HOLD still counts — the probe folds all statuses, so the conflict is named", async () => {
    const wh = fixture.warehouseMain;
    // A HOLD bin row counts toward Σ bins exactly like an AVAILABLE one
    // (reconcileBins has no status filter) — a HOLD bins-only batch would
    // hide from the probe exactly like an AVAILABLE one, so the union's
    // bins fold spans all three statuses and names it too.
    holdItem = await ensureInventoryItem(SKU_HOLD, "BNL hold item", { trackBatch: true });
    await withTenant(TENANT_I, async (tx) => {
      const batchA = await ensureBatchOnly(tx, holdItem, "BNL-HA");
      await seedBatch(tx, holdItem, "BNL-HB", 2, wh);
      const defaultBin = await wmsStore.ensureDefaultBin(wh);
      await seedBinRow(tx, {
        binId: defaultBin.id,
        wh,
        itemId: holdItem,
        batchId: batchA,
        qty: 8,
        status: "HOLD",
        note: "BNL seeded bins-only batch in HOLD status",
      });
      await seedStock(tx, holdItem, wh, 10);
    });
    const dry = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: true, actorId: I_ACTOR }),
    );
    const row = dry.report.find((r) => r.itemSku === SKU_HOLD);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("NON_RECONCILABLE");
    expect(row!.plannedWrites).toEqual([]);
    const notes = row!.notes.join("\n");
    expect(notes).toContain("BNL-HA");
    expect(notes).toContain("bins hold 8");
    expect(notes).toContain("the ledger has NO movements for this batch at this warehouse");
    // And the live pass keeps the probe row (bins 8 vs stock 10).
    await withTenant(TENANT_I, () => wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }));
    expect(await binSum(wh, holdItem)).toBe("8.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_HOLD);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(8);
    expect(Number(mine[0]!.stockQty)).toBe(10);
  });

  it("the OWNERSHIP consideration: a partner-owned (consignment) bins-only row is NOT a conflict — the probe never counts it", async () => {
    const wh = fixture.warehouseMain;
    // A consignment row (owner_partner_id set) never enters the probe's
    // tenant-owned fold, so it must never enter the union's bins fold
    // either: a proven sibling healing the aggregate is legitimate, and
    // the consignment batch is not named (the union does not over-reach
    // into partner-owned stock).
    consigItem = await ensureInventoryItem(SKU_CONSIG, "BNL consignment item", {
      trackBatch: true,
    });
    await withTenant(TENANT_I, async (tx) => {
      const partner = await tx.execute<{ id: string }>(sql`
        INSERT INTO partners (id, tenant_id, code, name, kind)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), 'BNL-CONSIG-P', 'BNL consignment partner', 'SUPPLIER')
        RETURNING id`);
      const partnerId = partner.rows[0]!.id;
      const batchC = await ensureBatchOnly(tx, consigItem, "BNL-CC");
      await seedBatch(tx, consigItem, "BNL-CB", 2, wh);
      const defaultBin = await wmsStore.ensureDefaultBin(wh);
      await seedBinRow(tx, {
        binId: defaultBin.id,
        wh,
        itemId: consigItem,
        batchId: batchC,
        qty: 5,
        ownerPartnerId: partnerId,
        note: "BNL seeded partner-owned consignment row (excluded from the tenant fold)",
      });
      await seedStock(tx, consigItem, wh, 2);
    });
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_CONSIG);
    expect(row).toBeDefined();
    // Σ tenant-owned bins 0, stock 2, B's ledger 2 — WRITABLE: the
    // consignment row is invisible to both the probe and the union.
    expect(row!.classification).toBe("WRITABLE");
    expect(row!.residueQty).toBe("0.000000");
    expect(row!.notes.join("\n")).not.toContain("BNL-CC");
    expect(await binSum(wh, consigItem)).toBe("2.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    expect(probe.some((r) => r.itemSku === SKU_CONSIG)).toBe(false);
  });
});
