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
 * PHASE-044 post-closure audit fix, wave 2 — the CONCURRENCY and
 * PROOF-STRICTNESS evidence for the tracked-item bin backfill:
 *
 * 1. THE MIGRATION-VS-MOVEMENT RACE (the wave's top priority): the advisory
 *    backfill lock only serialized backfill-vs-backfill; inventory movements
 *    serialize on the item_stock ROW lock (CC-04). A movement committing
 *    between the backfill's shortage read and its post-write verification
 *    made the verification compare a FRESH fold against the STALE
 *    row.stockQty — either a spurious whole-tenant rollback (a receipt) or,
 *    worse, an oversubscribed fold that SHIPPED silently (a binless issue).
 *    The live pass now joins the movement protocol (item_stock FOR UPDATE
 *    per candidate position, one canonical order, fresh re-derive) — proven
 *    here with REAL movement UoWs interleaved with REAL backfill passes.
 *
 * 2. SERIAL LOCATION PROOF STRICTNESS: a serial netted TWICE at this
 *    warehouse (netAtWarehouse 2 with netTotal 1 or 0 — conflicting
 *    cross-warehouse balances) is a NAMED CONFLICT, never a "provable"
 *    placement; and a serial whose only bin row is a ZERO-qty history row
 *    still needs its current balance migrated (row existence alone is not
 *    placement) — the upsert lands on the existing slot with NO duplicated
 *    row and NO hidden conflict.
 *
 * 3. PARTIAL MIGRATION vs THE BINLESS GRACE: landing the proven rows of a
 *    PARTIAL_UNATTRIBUTED item ENDS the binless grace for that (warehouse,
 *    item) — the unproven residue units become BLOCKED at the bin gate
 *    (BinContentsShortError) until resolved per runbook §5. Test-proven
 *    BEFORE the pass (the phantom serial issues binless) and AFTER (the
 *    phantom is blocked; the proven serial still spends through its bin
 *    row) — never a fabricated placement, never a hidden shortage.
 *
 * SUITE HYGIENE (the wms-tracked-backfill.spec precedent): every scenario
 * seeds its own corpus INSIDE its test (an earlier live pass would
 * otherwise consume a later scenario's shortfall — the tracked spec's
 * concurrency-item precedent), and the seeded ORPHAN legs (moves without
 * journals, no serial_movements pairs) are removed at the spec's end
 * through the documented superuser tooling so the sibling suites'
 * tenant-wide folds — the T-11 serialized-move completeness property
 * especially — stay clean. The SERVICE-posted moves (through
 * manualIssue/manualReceipt) stay: each carries its balanced journal and
 * its serial_movements row, fold-consistent by construction. The residue
 * drift itself (the unproven shortfall the tests assert stays visible) is
 * money-neutral for those folds and remains — the wms-inv029/wms-budgets
 * per-SKU filter precedent.
 */
let fixture: InventoryFixture;
let wms: WmsService;

/** A raw legacy item_stock position (the pre-WMS shape: stock, NO bins). */
async function seedLegacyPosition(sku: string, name: string, qty: number): Promise<string> {
  const itemId = await ensureInventoryItem(sku, name);
  await withTenant(TENANT_I, async (tx) => {
    await tx.execute(sql`
      INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
      VALUES (gen_random_uuid(), erp.current_tenant_id(), ${itemId}, ${fixture.warehouseMain}, ${qty}, 1.000000)
      ON CONFLICT DO NOTHING`);
  });
  return itemId;
}

/** A filler corpus of untracked legacy positions. The RACE tests need the
 * pass to be MID-FLIGHT (between its shortage read and its per-item writes)
 * when the movement commits — a single-item pass is over before any real
 * movement UoW can interleave, on the fixed and the pre-fix code alike.
 * FILLER positions make the pass span hundreds of statements; the racing
 * item's SKU sorts LAST (…ZZZ…) so its write happens at the pass's tail,
 * squarely inside the window. (The fixed pass converges in EVERY
 * interleaving — movement-first or pass-first — which is exactly the
 * protocol's claim; the pre-fix pass shipped the stale row.stockQty.) */
async function seedFillerCorpus(prefix: string, count: number): Promise<void> {
  const fillerIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    fillerIds.push(
      await ensureInventoryItem(`${prefix}-${String(i).padStart(3, "0")}`, `BFR filler ${prefix} ${i}`),
    );
  }
  await withTenant(TENANT_I, async (tx) => {
    for (const itemId of fillerIds) {
      await tx.execute(sql`
        INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${itemId}, ${fixture.warehouseMain}, 3, 1.000000)
        ON CONFLICT DO NOTHING`);
    }
  });
}

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  wms = new WmsService(new AuditService(new DrizzleAuditStore()), new InboxService());
});

afterAll(async () => {
  // The orphan seeded legs of the two tracked-item scenarios (proof +
  // flip): no journals, no serial_movements pairs — removed through the
  // documented superuser window (the tracked-backfill spec's afterAll
  // precedent) so the T-11 completeness property stays clean.
  const su = await (await import("../test-db")).superuserClient();
  await su.query(`ALTER TABLE stock_moves DISABLE TRIGGER trg_stock_moves_guard`);
  await su.query(
    `DELETE FROM stock_moves WHERE tenant_id = $1 AND posted_journal_id IS NULL
       AND item_id IN (SELECT id FROM items WHERE tenant_id = $1
                        AND sku IN ('INV-BFR-PROOF', 'INV-BFR-FLIP'))`,
    [TENANT_I],
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

describe("PHASE-044 audit fix wave 2 — the migration-vs-movement race (the advisory lock vs the item_stock row lock)", () => {
  it("a binless ISSUE committing while the pass is mid-flight: the plan re-derives FRESH under the position lock (never the stale row.stockQty)", async () => {
    const wh = fixture.warehouseMain;
    // The corpus: 120 filler positions plus the racing item — its SKU sorts
    // LAST, so the pass writes it at the tail. The movement UoW starts
    // ~120ms in and commits while the pass is mid-flight: pre-fix, the
    // pass then wrote the STALE 30 against the post-issue stock 25 and its
    // verification — comparing the fresh fold to the stale stock —
    // accepted the oversubscription silently (fold 30 ≠ stock 25,
    // INV-029 broken). The fixed pass holds the position locks: whichever
    // side wins the lock, the outcome converges on the exact fold.
    await seedFillerCorpus("INV-BFR-F-ISSUE", 120);
    const raceItem = await seedLegacyPosition("INV-BFR-ZZZ-RACE-ISSUE", "BFR race (issue) item", 30);
    const outcome = await Promise.allSettled([
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return withTenant(TENANT_I, () =>
          stock.manualIssue({
            itemId: raceItem,
            warehouseId: wh,
            qty: "5",
            reason: "DAMAGE",
            counterAccountId: null,
            valueDate: I_FEB,
            actorId: I_ACTOR,
          }),
        );
      })(),
      withTenant(TENANT_I, () => wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR })),
    ]);
    expect(outcome[0]!.status).toBe("fulfilled"); // the issue committed
    expect(outcome[1]!.status).toBe("fulfilled"); // the pass converged
    if (outcome[1]!.status !== "fulfilled" || outcome[0]!.status !== "fulfilled") {
      throw new Error("the race rendezvous failed");
    }
    // The FRESH numbers, never the stale snapshot: 25 units left the
    // position in total and the fold is EXACT against the live position
    // (pre-fix this measured 30 — the oversubscribed fold).
    expect(await binSum(wh, raceItem)).toBe("25.000000");
    expect(await stockQty(wh, raceItem)).toBe("25.000000");
    const pass = outcome[1]!.value;
    const row = pass.report.find((r) => r.itemSku === "INV-BFR-ZZZ-RACE-ISSUE");
    expect(row).toBeDefined();
    expect(row!.classification).toBe("WRITABLE");
  });

  it("a RECEIPT committing while the pass is mid-flight: no spurious rollback — the fold lands exact on the post-receipt position", async () => {
    const wh = fixture.warehouseMain;
    // The same mid-flight corpus with the receipt side (a WIDER window —
    // 200 fillers — because a receipt UoW posts its journal before it
    // commits, landing its commit later than an issue's): the movement
    // adds stock AND bins in one transaction (the same-transaction law),
    // so the position's shortfall is unchanged (30) — but the pre-fix
    // verification (fresh fold 35 vs STALE stock 30) threw
    // BinContentStateError and rolled the whole tenant UoW back. The fixed
    // pass re-derives under the lock: fold 35 == stock 35, exact, no
    // rollback.
    await seedFillerCorpus("INV-BFR-F-RECEIPT", 200);
    const raceItem = await seedLegacyPosition("INV-BFR-ZZZ-RACE-RECEIPT", "BFR race (receipt) item", 30);
    const outcome = await Promise.allSettled([
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        return withTenant(TENANT_I, () =>
          stock.manualReceipt({
            itemId: raceItem,
            warehouseId: wh,
            qty: "5",
            unitCost: "1.000000",
            reason: "COUNT_GAIN",
            counterAccountId: null,
            valueDate: I_FEB,
            actorId: I_ACTOR,
          }),
        );
      })(),
      withTenant(TENANT_I, () => wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR })),
    ]);
    expect(outcome[0]!.status).toBe("fulfilled");
    expect(outcome[1]!.status).toBe("fulfilled"); // no spurious rollback
    expect(await binSum(wh, raceItem)).toBe("35.000000");
    expect(await stockQty(wh, raceItem)).toBe("35.000000");
    // Idempotence after the race: a calm re-run leaves nothing to do for
    // this position (healed — not even a residue row in the report).
    const calm = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    expect(calm.report.some((r) => r.itemSku === "INV-BFR-ZZZ-RACE-RECEIPT")).toBe(false);
  });

  it("a movement QUEUING behind the pass waits, then issues from the HEALED bins (binless → binned, no drift)", async () => {
    const wh = fixture.warehouseMain;
    // The deterministic rendezvous: the pass's pre-pass locks positions in
    // canonical (warehouseId, itemId) order. The GATE item sorts AFTER the
    // TARGET (uuid ascending), so the pass holds TARGET's row when it parks
    // on a superuser-held lock on GATE — and a movement for TARGET (started
    // while the pass is parked) queues on the pass's own row lock.
    // Releasing the gate lets the pass commit first; the movement then
    // unblocks and its binless check — which runs AFTER its position lock —
    // must see the healed bin rows and take the BINNED path
    // (source_bin_id stamped), never a binless write over a binned
    // position.
    const gateA = await seedLegacyPosition("INV-BFR-GATE-A", "BFR gate item A", 20);
    const gateB = await seedLegacyPosition("INV-BFR-GATE-B", "BFR gate item B", 20);
    const sortedPair = [gateA, gateB].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const target = sortedPair[0]!; // sorts FIRST canonically — locked by the pass
    const gate = sortedPair[1]!; // sorts LAST — the superuser-parked gate
    const su = await (await import("../test-db")).superuserClient();
    try {
      // Hold the GATE position row (sorts last — the pass parks on it).
      await su.query("BEGIN");
      await su.query(
        `SELECT id FROM item_stock WHERE tenant_id = $1 AND item_id = $2 AND warehouse_id = $3 FOR UPDATE`,
        [TENANT_I, gate, wh],
      );
      // Start the pass — it locks TARGET, then parks on GATE.
      const passPromise = withTenant(TENANT_I, () =>
        wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300)); // the pass is parked
      // The movement for TARGET queues on the pass's row lock.
      const movementPromise = withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId: target,
          warehouseId: wh,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: I_FEB,
          actorId: I_ACTOR,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 200)); // the movement is parked
      // Release the gate: the pass commits, the movement unblocks onto the
      // healed bins.
      await su.query("COMMIT");
      const pass = await passPromise;
      const move = await movementPromise;
      expect(pass.dryRun).toBe(false);
      expect(move).toBeDefined();
      // The movement took the BINNED path: its move row carries the bin it
      // issued from (a binless issue stamps source_bin_id NULL).
      const moveRow = await withTenant(TENANT_I, async (tx) => {
        const rows = await tx.execute<{ source_bin_id: string | null }>(sql`
          SELECT source_bin_id FROM stock_moves
          WHERE tenant_id = erp.current_tenant_id() AND item_id = ${target}
            AND direction = 'OUT' AND posted_journal_id IS NOT NULL
          ORDER BY moved_at DESC LIMIT 1`);
        return rows.rows[0];
      });
      expect(moveRow).toBeDefined();
      expect(moveRow!.source_bin_id).not.toBeNull();
      // The fold stayed exact through the whole rendezvous.
      expect(await binSum(wh, target)).toBe("15.000000");
      expect(await stockQty(wh, target)).toBe("15.000000");
      expect(await binSum(wh, gate)).toBe("20.000000");
      expect(await stockQty(wh, gate)).toBe("20.000000");
    } finally {
      await su.query("ROLLBACK").catch(() => undefined);
      await su.end();
    }
  });
});

describe("PHASE-044 audit fix wave 2 — the serial location proof strictness", () => {
  it("conflicting cross-warehouse balances are NAMED conflicts, never provable placements; a zero-qty history row neither blocks migration nor duplicates", async () => {
    const wh = fixture.warehouseMain;
    const wh2 = fixture.warehouseSecond;
    // The corpus: item_stock 5 with FIVE registered serials —
    //   CLEAN: one IN leg here (netHere 1 / netTotal 1) — provable.
    //   DUPHERE: two IN legs here + one OUT leg at WH2 — netHere 2 /
    //     netTotal 1: the pre-fix conditions did NOT enforce both == 1 and
    //     would have classified it proven (consuming one unit of shortfall
    //     while swallowing the conflict).
    //   NEGTOTAL: one IN leg here + one OUT leg at WH2 — netHere 1 /
    //     netTotal 0: the global ledger contradicts a unit here.
    //   ZEROBIN: one IN leg here (provable) + a seeded ZERO-qty history
    //     bin row on the default bin — placement BY QTY says "placed
    //     nowhere here" (row existence alone must NOT count as placement);
    //     the migration must land its unit on that very slot (0 → 1) with
    //     no duplicated row.
    //   PHANTOM: registered in_stock, no ledger legs — residue.
    const proofItem = await ensureInventoryItem("INV-BFR-PROOF", "BFR serial-proof item", {
      trackSerial: true,
    });
    const register = async (serialNo: string): Promise<string> =>
      (
        await withTenant(TENANT_I, () =>
          tracking.registerSerial({ itemId: proofItem, serialNo, imei: null, actorId: I_ACTOR }),
        )
      ).id;
    const serialClean = await register("BFR-P-CLEAN");
    const serialDupHere = await register("BFR-P-DUPHERE");
    const serialNegTotal = await register("BFR-P-NEGTOTAL");
    const serialZeroBin = await register("BFR-P-ZEROBIN");
    await register("BFR-P-PHANTOM");
    await withTenant(TENANT_I, async (tx) => {
      await tx.execute(sql`
        INSERT INTO stock_moves
          (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
           value_amount, serial_id, source_type, source_id, moved_at)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${proofItem}, ${wh}, 'IN', 'receipt',
                1, 10.000000, 10.0000, ${serialClean}, 'manual_receipt', ${proofItem}, '2026-01-02'),
               (gen_random_uuid(), erp.current_tenant_id(), ${proofItem}, ${wh}, 'IN', 'receipt',
                1, 10.000000, 10.0000, ${serialDupHere}, 'manual_receipt', ${proofItem}, '2026-01-02'),
               (gen_random_uuid(), erp.current_tenant_id(), ${proofItem}, ${wh}, 'IN', 'receipt',
                1, 10.000000, 10.0000, ${serialDupHere}, 'manual_receipt', ${proofItem}, '2026-01-03'),
               (gen_random_uuid(), erp.current_tenant_id(), ${proofItem}, ${wh2}, 'OUT', 'issue',
                1, 10.000000, 10.0000, ${serialDupHere}, 'manual_issue', ${proofItem}, '2026-01-04'),
               (gen_random_uuid(), erp.current_tenant_id(), ${proofItem}, ${wh}, 'IN', 'receipt',
                1, 10.000000, 10.0000, ${serialNegTotal}, 'manual_receipt', ${proofItem}, '2026-01-02'),
               (gen_random_uuid(), erp.current_tenant_id(), ${proofItem}, ${wh2}, 'OUT', 'issue',
                1, 10.000000, 10.0000, ${serialNegTotal}, 'manual_issue', ${proofItem}, '2026-01-04'),
               (gen_random_uuid(), erp.current_tenant_id(), ${proofItem}, ${wh}, 'IN', 'receipt',
                1, 10.000000, 10.0000, ${serialZeroBin}, 'manual_receipt', ${proofItem}, '2026-01-02')`);
      await tx.execute(sql`
        INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${proofItem}, ${wh}, 5, 10.000000)
        ON CONFLICT DO NOTHING`);
    });
    // The ZERO-qty history row rides the default bin (the upsert's target
    // slot — the "spent slot" floor that stays forever).
    const defaultBin = await withTenant(TENANT_I, () => wmsStore.ensureDefaultBin(wh));
    await withTenant(TENANT_I, async (tx) => {
      await tx.execute(sql`
        INSERT INTO bin_contents
          (id, tenant_id, bin_id, warehouse_id, item_id, batch_id, serial_id,
           lpn_id, owner_partner_id, status, qty, uom_id, received_at, note, created_by)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${defaultBin.id}, ${wh}, ${proofItem},
                NULL, ${serialZeroBin}, NULL, NULL, 'AVAILABLE', 0, NULL, now(),
                'BFR seeded zero-qty history floor', NULL)
        ON CONFLICT DO NOTHING`);
    });

    // DRY-RUN: only the two provable units are planned; the conflicting
    // shapes are NAMED with their exact contradiction — never a silent
    // drop, never classified proven.
    const dry = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: true, actorId: I_ACTOR }),
    );
    const row = dry.report.find((r) => r.itemSku === "INV-BFR-PROOF");
    expect(row).toBeDefined();
    expect(row!.tracking).toBe("SERIAL");
    expect(row!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(row!.plannedWrites.map((w) => w.serialNo).sort()).toEqual(["BFR-P-CLEAN", "BFR-P-ZEROBIN"]);
    const notes = row!.notes.join("\n");
    expect(notes).toContain("BFR-P-DUPHERE");
    expect(notes).toContain("counted more than once here");
    expect(notes).toContain("BFR-P-NEGTOTAL");
    expect(notes).toContain("legs elsewhere contradict a unit here");

    // LIVE: the fold lands on stock − residue (5 − 3 = 2).
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const liveRow = live.report.find((r) => r.itemSku === "INV-BFR-PROOF");
    expect(liveRow!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(liveRow!.residueQty).toBe("3.000000");
    expect(await binSum(wh, proofItem)).toBe("2.000000");
    expect(await stockQty(wh, proofItem)).toBe("5.000000");

    // ZEROBIN: its unit landed on the EXISTING zero-qty slot — one row,
    // qty now 1, no duplicated placement.
    const zeroRows = await withTenant(TENANT_I, async (tx) => {
      const rows = await tx.execute<{ qty: string }>(sql`
        SELECT qty::text AS qty FROM bin_contents
        WHERE tenant_id = erp.current_tenant_id() AND item_id = ${proofItem}
          AND serial_id = ${serialZeroBin} AND owner_partner_id IS NULL`);
      return rows.rows;
    });
    expect(zeroRows).toHaveLength(1);
    expect(zeroRows[0]!.qty).toBe("1.000000");

    // The residue stays visible to the probe (never hidden).
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === "INV-BFR-PROOF");
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(2);
    expect(Number(mine[0]!.stockQty)).toBe(5);
  });
});

describe("PHASE-044 audit fix wave 2 — PARTIAL migration vs the binless grace (test-proven, documented)", () => {
  it("the unproven residue: spendable binless BEFORE the pass, BLOCKED at the bin gate AFTER it — while the proven unit still spends through its bin row", async () => {
    const wh = fixture.warehouseMain;
    // The corpus: item_stock 3 — one provable serial (one IN leg here) and
    // TWO phantoms (registered in_stock, no ledger legs).
    const flipItem = await ensureInventoryItem("INV-BFR-FLIP", "BFR binless-flip item", {
      trackSerial: true,
    });
    const register = async (serialNo: string): Promise<string> =>
      (
        await withTenant(TENANT_I, () =>
          tracking.registerSerial({ itemId: flipItem, serialNo, imei: null, actorId: I_ACTOR }),
        )
      ).id;
    const flipProven = await register("BFR-F-PROVEN");
    const flipPhantom1 = await register("BFR-F-PHAN1");
    const flipPhantom2 = await register("BFR-F-PHAN2");
    await withTenant(TENANT_I, async (tx) => {
      await tx.execute(sql`
        INSERT INTO stock_moves
          (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty, unit_cost,
           value_amount, serial_id, source_type, source_id, moved_at)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${flipItem}, ${wh}, 'IN', 'receipt',
                1, 10.000000, 10.0000, ${flipProven}, 'manual_receipt', ${flipItem}, '2026-01-02')`);
      await tx.execute(sql`
        INSERT INTO item_stock (id, tenant_id, item_id, warehouse_id, qty, avg_cost)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), ${flipItem}, ${wh}, 3, 10.000000)
        ON CONFLICT DO NOTHING`);
    });

    // BEFORE the pass: no bin rows at all → the phantom serial issues
    // BINLESS (BR-018 named-unit satisfied; the grace's whole point) —
    // this is exactly the spendability the partial pass will end.
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: flipItem,
        warehouseId: wh,
        qty: "1",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: I_FEB,
        serialIds: [flipPhantom1],
        actorId: I_ACTOR,
      }),
    );
    expect(await stockQty(wh, flipItem)).toBe("2.000000");
    expect(await binSum(wh, flipItem)).toBe("0.000000");

    // The pass: the proven serial placed (its first bin row ENDS the
    // binless grace for the item), the phantom residue left unwritten —
    // never a fabricated placement to keep it spendable.
    const live = await withTenant(TENANT_I, () =>
      wms.backfillDefaultBins({ dryRun: false, actorId: I_ACTOR }),
    );
    const row = live.report.find((r) => r.itemSku === "INV-BFR-FLIP");
    expect(row).toBeDefined();
    expect(row!.classification).toBe("PARTIAL_UNATTRIBUTED");
    expect(row!.residueQty).toBe("1.000000");
    expect(row!.plannedWrites).toEqual([]);
    expect(await binSum(wh, flipItem)).toBe("1.000000");

    // AFTER the pass: the phantom residue is BLOCKED at the bin gate —
    // any tenant-owned bin row ends the grace, and no bin row carries the
    // phantom, so the named-unit allocation cannot cover it
    // (BinContentsShortError, fail-closed).
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId: flipItem,
          warehouseId: wh,
          qty: "1",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: I_FEB,
          serialIds: [flipPhantom2],
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BIN_CONTENTS_SHORT" });

    // The PROVEN unit still spends through its bin row (the named-unit
    // path over the migrated row).
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: flipItem,
        warehouseId: wh,
        qty: "1",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: I_FEB,
        serialIds: [flipProven],
        actorId: I_ACTOR,
      }),
    );
    expect(await binSum(wh, flipItem)).toBe("0.000000");
    expect(await stockQty(wh, flipItem)).toBe("1.000000");

    // The drift stays visible to the nightly probe (never hidden).
    const probe = await withTenant(TENANT_I, () => wmsStore.reconcileBins({ warehouseId: wh }));
    const mine = probe.filter((r) => r.itemSku === "INV-BFR-FLIP");
    expect(mine).toHaveLength(1);
    expect(Number(mine[0]!.binQty)).toBe(0);
    expect(Number(mine[0]!.stockQty)).toBe(1);
  });
});
