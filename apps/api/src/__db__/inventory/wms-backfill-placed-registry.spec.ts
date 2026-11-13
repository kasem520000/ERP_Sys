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
 * PHASE-044 post-closure audit fix, wave 5 — the PLACED-SERIAL REGISTRY
 * CONFLICT HIDING (the wave-4 §5 recorded limitation, corrected by the
 * owner's review): `classifyShortfall`'s placed branch (wms.service.ts
 * 730–744) checked the bin rows and the ledger corroboration and then
 * SKIPPED the serial without ever examining `registryStatus` — the
 * registry-vs-ledger conflict was named only on the UNPLACED (provable)
 * branch. The owner's case: serial A in a bin with qty 1, its ledger
 * netting +1 here and +1 across all warehouses (the placement fully
 * corroborated), but its `item_serials` status `sold`; serial B clean
 * (`in_stock`, ledger +1 here, never placed); `item_stock` 2, Σ bins 1.
 * The position STARTS as an APPARENT DEFICIT in the nightly probe (bins 1
 * vs stock 2); the pre-fix pass classified B provable, wrote its unit,
 * Σ bins landed on 2 == `item_stock`, and the probe went GREEN — serial
 * A's registry conflict (a sold unit occupying a bin the ledger still
 * calls in stock) vanished from the only recurring detector. The wave-4
 * §5 note had wrongly said "the probe cannot see such a position anyway
 * (bins == ledger ⇒ no shortfall row)" — true only when Σ bins ALREADY
 * equals `item_stock`; with an unplaced sibling the migration itself
 * ERASES a visible deficit, exactly the hiding the wave-3/wave-4 guards
 * exist to forbid.
 *
 * THE FIX: a serial whose bin rows place it (here or at another
 * warehouse) while its registry status is anything other than `in_stock`
 * is a NAMED conflict — the registry-status conflict for the placed
 * serial — feeding the wave-3 totals-matching guard (residue 0 + a named
 * conflict ⇒ NON_RECONCILABLE, nothing written, the full shortfall stays
 * visible to the probe). The other registry contradiction shapes are
 * reviewed under the SAME logic (the owner's directive, no probe
 * redesign): `returned` on a placed serial (the third registry status)
 * is named identically; the UNPLACED registry mismatch keeps its
 * pre-existing wave-3 note; a registry `in_stock` with a zero ledger net
 * claims nothing and places nothing (not a hiding vector — the residue
 * keeps the probe honest), so it stays unnamed by design.
 *
 * SUITE HYGIENE (the wave-3/wave-4 spec precedent): the seeded orphan
 * legs are removed at the spec's end through the documented superuser
 * window; the bin/item_stock residue (the asserted-visible conflicts and
 * the asserted-healed healthy fold) is money-neutral for the sibling
 * folds and remains.
 */
let fixture: InventoryFixture;
let wms: WmsService;

const SKU_PLR = "INV-PLR-A"; // the owner's placed-registry case (tests 1-3)
const SKU_RET = "INV-PLR-RET"; // the returned-status variant (test 4)
const SKU_PARTIAL = "INV-PLR-PARTIAL"; // registry conflict + residue > 0 (test 5)
const SKU_OK = "INV-PLR-OK"; // the healthy WRITABLE counterpart (test 6)
const SKU_UNPLACED = "INV-PLR-UNPLACED"; // the unplaced-mismatch control (test 7)

let plrItem = "";
let retItem = "";
let partialItem = "";
let okItem = "";
let unplacedItem = "";

/** Register one serial and return its id (registry rows start in_stock). */
async function registerSerial(itemId: string, serialNo: string): Promise<string> {
  return (
    await withTenant(TENANT_I, () =>
      tracking.registerSerial({ itemId, serialNo, imei: null, actorId: I_ACTOR }),
    )
  ).id;
}

/** Register one serial and flip its registry status (sold/returned need
 * their binding dates — the ck_item_serials_*_shape constraints). */
async function registerSerialAs(
  itemId: string,
  serialNo: string,
  status: "sold" | "returned",
): Promise<string> {
  const id = await registerSerial(itemId, serialNo);
  await withTenant(TENANT_I, async (tx) => {
    if (status === "sold") {
      await tx.execute(sql`
        UPDATE item_serials SET status = 'sold', sold_at = '2026-01-20'
        WHERE id = ${id}`);
    } else {
      await tx.execute(sql`
        UPDATE item_serials SET status = 'returned', sold_at = '2026-01-18', returned_at = '2026-01-22'
        WHERE id = ${id}`);
    }
  });
  return id;
}

/** Seed ONE orphan pre-WMS receipt leg for a serial (+1 at the warehouse). */
async function seedSerialLeg(
  tx: TenantDb,
  itemId: string,
  serialId: string,
  wh: string,
  movedAt: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO stock_moves
      (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
       value_amount, serial_id, source_type, source_id, moved_at)
    VALUES (gen_random_uuid(), erp.current_tenant_id(), ${itemId}, ${wh}, 'IN', 'receipt',
            1, 10.000000, 10.0, ${serialId}, 'manual_receipt', ${itemId}, ${movedAt})`);
}

/** Seed one tenant-owned AVAILABLE bin row PLACING a serial at a bin. */
async function seedPlacedBinRow(
  tx: TenantDb,
  input: { binId: string; wh: string; itemId: string; serialId: string; note: string },
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO bin_contents
      (id, tenant_id, bin_id, warehouse_id, item_id, batch_id, serial_id,
       lpn_id, owner_partner_id, status, qty, uom_id, received_at, note, created_by)
    VALUES (gen_random_uuid(), erp.current_tenant_id(), ${input.binId}, ${input.wh}, ${input.itemId},
            NULL, ${input.serialId}, NULL, NULL, 'AVAILABLE', 1, NULL, now(), ${input.note}, NULL)
    ON CONFLICT DO NOTHING`);
}

async function seedStock(tx: TenantDb, itemId: string, wh: string, qty: number): Promise<void> {
  await tx.execute(sql`
    INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
    VALUES (gen_random_uuid(), erp.current_tenant_id(), ${itemId}, ${wh}, ${qty}, 10.000000)
    ON CONFLICT DO NOTHING`);
}

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  wms = new WmsService(new AuditService(new DrizzleAuditStore()), new InboxService());
  const wh = fixture.warehouseMain;

  // -- THE OWNER'S CASE (tests 1-3): serial A PLACED by a bin row with its
  // ledger corroborating the placement EXACTLY (+1 here, +1 across all
  // warehouses) but its registry status `sold`; serial B clean and provable
  // (in_stock, ledger +1 here, never placed). item_stock 2, Σ bins 1 — the
  // shortfall (1) is EXACTLY B: the totals-matching trap, registry edition.
  // Healing it (placing B) lands Σ bins on 2 == item_stock and hides A's
  // registry conflict from the nightly probe.
  plrItem = await ensureInventoryItem(SKU_PLR, "PLR placed-registry item", { trackSerial: true });
  await withTenant(TENANT_I, async (tx) => {
    const placedA = await registerSerialAs(plrItem, "PLR-S-PLACED", "sold");
    const cleanB = await registerSerial(plrItem, "PLR-S-CLEAN");
    await seedSerialLeg(tx, plrItem, placedA, wh, "2026-01-05");
    await seedSerialLeg(tx, plrItem, cleanB, wh, "2026-01-06");
    const defaultBin = await wmsStore.ensureDefaultBin(wh);
    await seedPlacedBinRow(tx, {
      binId: defaultBin.id,
      wh,
      itemId: plrItem,
      serialId: placedA,
      note: "PLR seeded placed serial with a sold registry status",
    });
    await seedStock(tx, plrItem, wh, 2);
  });
});

afterAll(async () => {
  // The seeded orphan legs (no journals, no serial_movements rows) leave
  // through the documented superuser window — the wave-3/wave-4 spec
  // precedent — so the sibling suites' tenant-wide folds (INV-010 and the
  // T-11 serial-ledger completeness property) stay clean. The
  // bin/item_stock residue (the asserted-visible conflicts and the
  // asserted-healed healthy fold) is money-neutral and remains.
  const su = await (await import("../test-db")).superuserClient();
  await su.query(`ALTER TABLE stock_moves DISABLE TRIGGER trg_stock_moves_guard`);
  await su.query(
    `DELETE FROM stock_moves WHERE tenant_id = $1 AND posted_journal_id IS NULL
       AND item_id IN ($2, $3, $4, $5, $6)`,
    [TENANT_I, plrItem, retItem, partialItem, okItem, unplacedItem],
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

describe("post-044 audit wave 5 — the placed-serial registry conflict hiding (A placed+sold, B clean, stock 2)", () => {
  it("the owner's case is NON_RECONCILABLE — the registry-status conflict for the placed serial NAMED, never a totals-matching WRITABLE", async () => {
    // The aggregate trap: shortfall 1 == B's provable 1, and A (the placed
    // serial whose registry says sold) was corroborated by BOTH other
    // sources (bins place it, ledger nets +1) — the pre-fix pass pushed no
    // note for A, classified the position WRITABLE, and planned B's unit.
    // The fix names A's registry contradiction so the guard refuses.
    const dry = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: true, actorId: I_ACTOR }),
    );
    const row = dry.report.find((r) => r.itemSku === SKU_PLR);
    expect(row).toBeDefined();
    expect(row!.tracking).toBe("SERIAL");
    expect(row!.classification).toBe("NON_RECONCILABLE");
    expect(row!.plannedWrites).toEqual([]);
    // The FULL shortfall stays as the residue (the position stays whole).
    expect(row!.residueQty).toBe("1.000000");
    // The conflict is NAMED with its exact shape: the bin rows place A,
    // the ledger corroborates, but the registry status is sold.
    const notes = row!.notes.join("\n");
    expect(notes).toContain("PLR-S-PLACED");
    expect(notes).toContain("bin rows place 1.000000 unit(s) here");
    expect(notes).toContain("registry status is sold");
    expect(notes).toContain("the registry-status conflict for a placed serial");
    // And the report explains the refusal (never a silent skip).
    expect(notes).toContain("HIDE the named conflict(s)");
  });

  it("the LIVE pass writes NOTHING — B's unit is NOT landed, the probe keeps the visible deficit", async () => {
    const wh = fixture.warehouseMain;
    // The pre-fix pass placed B (Σ bins 2 == item_stock 2) and the
    // position VANISHED from the nightly probe — a visible deficit ERASED
    // by the migration while A's sold-in-a-bin conflict stayed invisible
    // forever. The fixed pass writes nothing: the deficit stays visible.
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const liveRow = live.report.find((r) => r.itemSku === SKU_PLR);
    expect(liveRow).toBeDefined();
    expect(liveRow!.classification).toBe("NON_RECONCILABLE");
    expect(await binSum(wh, plrItem)).toBe("1.000000"); // unchanged — A only
    expect(await stockQty(wh, plrItem)).toBe("2.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_PLR);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(1);
    expect(Number(mine[0]!.stockQty)).toBe(2);
  });

  it("the RE-RUN is stable: still NON_RECONCILABLE, nothing new written (idempotent refusal)", async () => {
    const wh = fixture.warehouseMain;
    const before = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: plrItem, limit: 100 }),
    );
    const second = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = second.report.find((r) => r.itemSku === SKU_PLR);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("NON_RECONCILABLE");
    expect(row!.plannedWrites).toEqual([]);
    expect(row!.residueQty).toBe("1.000000");
    const after = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: wh, itemId: plrItem, limit: 100 }),
    );
    expect(after).toEqual(before);
    expect(await binSum(wh, plrItem)).toBe("1.000000");
  });

  it("the RETURNED registry status is treated with the SAME logic — named, refused, visible", async () => {
    const wh = fixture.warehouseMain;
    // `item_serials` carries THREE statuses (in_stock/sold/returned —
    // migration 0015). The returned shape (sold_at + returned_at set, the
    // unit re-entered at original cost) contradicts a bin placement
    // exactly like sold does: named, never healed around.
    retItem = await ensureInventoryItem(SKU_RET, "PLR returned-registry item", {
      trackSerial: true,
    });
    await withTenant(TENANT_I, async (tx) => {
      const placedA = await registerSerialAs(retItem, "PLR-R-PLACED", "returned");
      const cleanB = await registerSerial(retItem, "PLR-R-CLEAN");
      await seedSerialLeg(tx, retItem, placedA, wh, "2026-01-05");
      await seedSerialLeg(tx, retItem, cleanB, wh, "2026-01-06");
      const defaultBin = await wmsStore.ensureDefaultBin(wh);
      await seedPlacedBinRow(tx, {
        binId: defaultBin.id,
        wh,
        itemId: retItem,
        serialId: placedA,
        note: "PLR seeded placed serial with a returned registry status",
      });
      await seedStock(tx, retItem, wh, 2);
    });
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_RET);
    expect(row).toBeDefined();
    expect(row!.tracking).toBe("SERIAL");
    expect(row!.classification).toBe("NON_RECONCILABLE");
    expect(row!.plannedWrites).toEqual([]);
    expect(row!.residueQty).toBe("1.000000");
    const notes = row!.notes.join("\n");
    expect(notes).toContain("PLR-R-PLACED");
    expect(notes).toContain("registry status is returned");
    expect(notes).toContain("the registry-status conflict for a placed serial");
    expect(await binSum(wh, retItem)).toBe("1.000000"); // unchanged
    expect(await stockQty(wh, retItem)).toBe("2.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_RET);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(1);
    expect(Number(mine[0]!.stockQty)).toBe(2);
  });

  it("registry conflict + residue > 0 stays PARTIAL_UNATTRIBUTED: the PROVEN serial is written, the conflict NAMED, the residue visible", async () => {
    const wh = fixture.warehouseMain;
    // stock 3, A placed+sold (ledger 1, corroborated), B clean (ledger 1,
    // provable), C registered in_stock with NO legs (the phantom unit):
    // shortfall 2, proven 1 (B), residue 1 — the probe keeps showing the
    // position, so B's placement is legitimate and must still happen (the
    // TBF-S-0004 precedent — the guard only forbids the HIDING write; the
    // new registry note must not over-block it).
    partialItem = await ensureInventoryItem(SKU_PARTIAL, "PLR partial item", {
      trackSerial: true,
    });
    await withTenant(TENANT_I, async (tx) => {
      const placedA = await registerSerialAs(partialItem, "PLR-P-PLACED", "sold");
      const cleanB = await registerSerial(partialItem, "PLR-P-CLEAN");
      await registerSerial(partialItem, "PLR-P-PHANTOM");
      await seedSerialLeg(tx, partialItem, placedA, wh, "2026-01-05");
      await seedSerialLeg(tx, partialItem, cleanB, wh, "2026-01-06");
      const defaultBin = await wmsStore.ensureDefaultBin(wh);
      await seedPlacedBinRow(tx, {
        binId: defaultBin.id,
        wh,
        itemId: partialItem,
        serialId: placedA,
        note: "PLR seeded placed serial (partial case)",
      });
      await seedStock(tx, partialItem, wh, 3);
    });
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_PARTIAL);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(row!.residueQty).toBe("1.000000");
    const notes = row!.notes.join("\n");
    expect(notes).toContain("PLR-P-PLACED");
    expect(notes).toContain("registry status is sold");
    // B's unit landed on the default bin — the proven write.
    expect(await binSum(wh, partialItem)).toBe("2.000000"); // 1 (A) + 1 (B)
    expect(await stockQty(wh, partialItem)).toBe("3.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_PARTIAL);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(2);
    expect(Number(mine[0]!.stockQty)).toBe(3);
  });

  it("the guard never over-blocks: a HEALTHY placed serial (registry in_stock) still heals WRITABLE and the probe clears", async () => {
    const wh = fixture.warehouseMain;
    // The healthy counterpart of the owner's case: A placed with its
    // registry AGREEING (in_stock) and the ledger corroborating; B clean
    // and provable. stock 2, Σ bins 1 — placing B lands the fold exactly
    // (2 == 2) with EVERY source agreeing: the legitimate heal, the probe
    // row clears. (Seeded HERE — an earlier live pass would consume it.)
    okItem = await ensureInventoryItem(SKU_OK, "PLR healthy item", { trackSerial: true });
    await withTenant(TENANT_I, async (tx) => {
      const placedA = await registerSerial(okItem, "PLR-OK-PLACED");
      const cleanB = await registerSerial(okItem, "PLR-OK-CLEAN");
      await seedSerialLeg(tx, okItem, placedA, wh, "2026-01-05");
      await seedSerialLeg(tx, okItem, cleanB, wh, "2026-01-06");
      const defaultBin = await wmsStore.ensureDefaultBin(wh);
      await seedPlacedBinRow(tx, {
        binId: defaultBin.id,
        wh,
        itemId: okItem,
        serialId: placedA,
        note: "PLR seeded placed serial with an agreeing registry",
      });
      await seedStock(tx, okItem, wh, 2);
    });
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_OK);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("WRITABLE");
    expect(row!.residueQty).toBe("0.000000");
    expect(await binSum(wh, okItem)).toBe("2.000000");
    expect(await stockQty(wh, okItem)).toBe("2.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    expect(probe.some((r) => r.itemSku === SKU_OK)).toBe(false);
  });

  it("the UNPLACED registry mismatch keeps its pre-existing note — the same logic, no regression (the wave-3 path)", async () => {
    const wh = fixture.warehouseMain;
    // The control for "the other registry contradiction shapes": an
    // UNPLACED serial whose ledger nets +1 here while its registry says
    // sold has been named since wave 3 (the provable branch's registry
    // check). With a clean sibling and a residue > 0 the clean unit is
    // still placed (PARTIAL_UNATTRIBUTED), the mismatch named — the wave-5
    // fix changes nothing here (test-proven, not just read).
    unplacedItem = await ensureInventoryItem(SKU_UNPLACED, "PLR unplaced-mismatch item", {
      trackSerial: true,
    });
    await withTenant(TENANT_I, async (tx) => {
      const soldX = await registerSerialAs(unplacedItem, "PLR-U-SOLD", "sold");
      const cleanY = await registerSerial(unplacedItem, "PLR-U-CLEAN");
      await seedSerialLeg(tx, unplacedItem, soldX, wh, "2026-01-05");
      await seedSerialLeg(tx, unplacedItem, cleanY, wh, "2026-01-06");
      await seedStock(tx, unplacedItem, wh, 2);
    });
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === SKU_UNPLACED);
    expect(row).toBeDefined();
    expect(row!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(row!.residueQty).toBe("1.000000");
    const notes = row!.notes.join("\n");
    expect(notes).toContain("PLR-U-SOLD");
    expect(notes).toContain("ledger says in stock but registry status is sold");
    // The clean sibling Y landed — the proven write under a visible residue.
    expect(await binSum(wh, unplacedItem)).toBe("1.000000");
    expect(await stockQty(wh, unplacedItem)).toBe("2.000000");
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === SKU_UNPLACED);
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(1);
    expect(Number(mine[0]!.stockQty)).toBe(2);
  });
});
