import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as periodStore from "../../modules/accounting/infrastructure/accounting.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as mfgStore from "../../modules/manufacturing/infrastructure/manufacturing.store";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  orders,
  periods,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-018 T38b — the production-order lifecycle spec (service-level, like
 * job-cards.spec): the state matrix, cancel rules, release numbering + BOM
 * version binding, the §5 variance review (the T3 hook), INV-013 idempotent
 * replays, PERIOD_LOCKED with zero residue + INV-020 reopen, and the FEFO
 * proposal hook. Runs on the shared manufacturing fixture's tenant M — every
 * pack uses SPEC-OWNED items/orders (M-VAR / M-VB / M-FEFO), never the §8
 * golden chain (the costing spec's asserts are chain-scoped, so the DB-suite
 * file order — which vitest does not sort — cannot break either file; the
 * March lock below always reopens in finally).
 *
 * INV-013 note (by design): consume and scrap are DISTINCT business events —
 * each call posts under a unique source operation (`consume_<seq>` /
 * `scrap_<seq>` = countProductionConsumptions/Scraps + 1), so service-level
 * replay of "the same" consume is NOT an idempotency case (it is a second
 * consumption); HTTP-level retries are the global Idempotency-Key guard's
 * job. The idempotent lifecycle anchors tested below are release-on-RELEASED
 * (no second number) and complete-on-COMPLETED (the stored result).
 */

let fixture: MfgFixture;
/** Spec-owned items (never the golden five). */
const specItems: { variance: string; versioned: string; fefo: string } = {
  variance: "",
  versioned: "",
  fefo: "",
};
/** The completed variance-review order — the INV-013 pack replays it. */
let varianceOrderId = "";
let varianceCompletion: Awaited<ReturnType<typeof orders.complete>> | undefined;

beforeAll(async () => {
  fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, shelfLifeDays: number) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertItem({
        sku,
        name: `${sku} (orders spec)`,
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: true,
        trackSerial: false,
        trackImei: false,
        hasExpiry: true,
        shelfLifeDays,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
      return created.id;
    };
    specItems.variance = await ensureItem("M-VAR", 30);
    specItems.versioned = await ensureItem("M-VB", 30);
    specItems.fefo = await ensureItem("M-FEFO", 30);

    // Clean recipes: flour 0.1 per output at yield 100 (planned 100 → flour
    // plan 10.000000 — the variance pack's arithmetic anchor).
    for (const [itemKey, sku] of [
      [specItems.variance, "M-VAR"],
      [specItems.versioned, "M-VB"],
      [specItems.fefo, "M-FEFO"],
    ] as const) {
      const active = await mfgStore.findActiveBom(itemKey);
      if (active !== undefined) continue;
      const draft = await boms.create({
        itemId: itemKey,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: `${sku} v1 (orders spec)`,
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: fixture.items.flour, qtyPerOutput: "0.100000", scrapPct: "0" }],
      });
      await boms.activate(draft.id, { effectiveFrom: "2026-01-05", actorId: M_ACTOR });
    }
  });
});

// -- helpers -------------------------------------------------------------------

interface Line {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<Line[]> {
  const lines = await journal.listLines(entryId);
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

async function countJournals(): Promise<number> {
  return withTenant(TENANT_M, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM journal_entries`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

async function notificationCount(dedupeKey: string): Promise<number> {
  return withTenant(TENANT_M, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM notifications WHERE dedupe_key = ${dedupeKey}`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

async function prdNextValue(): Promise<string> {
  return withTenant(TENANT_M, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute<{ next_value: string }>(sql`
      SELECT next_value::text FROM numbering_sequences
      WHERE doc_type = 'production_order' AND branch_id = ${fixture.branchId}
      ORDER BY period_key DESC LIMIT 1
    `);
    return rows.rows[0]!.next_value;
  });
}

function createSpecOrder(itemId: string, plannedQty = "100") {
  return withTenant(TENANT_M, () =>
    orders.create({
      branchId: fixture.branchId,
      itemId,
      bomId: null,
      plannedQty,
      plannedDate: null,
      materialsWarehouseId: fixture.warehouseRaw,
      fgWarehouseId: fixture.warehouseFg,
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: null,
      noteAr: null,
      actorId: M_ACTOR,
    }),
  );
}

async function stockQtyOf(itemId: string, warehouseId: string): Promise<string> {
  const row = await withTenant(TENANT_M, () => inventoryStore.findItemStock(itemId, warehouseId));
  return row?.qty ?? "0.000000";
}

// -- the lifecycle packs ------------------------------------------------------------

describe("PHASE-018 T38b production-order lifecycle", () => {
  it("state matrix — every legal transition works; every illegal one is the typed PRODUCTION_ORDER_STATE", async () => {
    // Legal: DRAFT → update → RELEASED → IN_PROGRESS → consume → COMPLETED.
    const order = await createSpecOrder(specItems.variance);
    expect(order.status).toBe("DRAFT");
    expect(order.orderNo).toBeNull(); // NO number before release
    const updated = await withTenant(TENANT_M, () =>
      orders.update(order.id, { plannedQty: "100", actorId: M_ACTOR }),
    );
    expect(updated.status).toBe("DRAFT");
    const released = await withTenant(TENANT_M, () => orders.release(order.id, M_ACTOR));
    expect(released.status).toBe("RELEASED");
    expect(released.orderNo).toMatch(/^PRD-\d{4}-\d{5}$/);
    const started = await withTenant(TENANT_M, () => orders.start(order.id, M_ACTOR));
    expect(started.status).toBe("IN_PROGRESS");
    expect(started.startedAt).not.toBeNull();
    await withTenant(TENANT_M, () =>
      orders.consume(order.id, {
        lines: [{ itemId: fixture.items.flour, qty: "1", batchId: null }],
        consumedAt: "2026-04-02",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    const done = await withTenant(TENANT_M, () =>
      orders.complete(order.id, { actualQty: "100", batchNo: null, completedAt: "2026-04-02", actorId: M_ACTOR }),
    );
    expect(done.order.status).toBe("COMPLETED");
    expect(done.order.completedAt).not.toBeNull();

    // Illegal: release on IN_PROGRESS.
    const inProgress = await createSpecOrder(specItems.variance);
    await withTenant(TENANT_M, () => orders.release(inProgress.id, M_ACTOR));
    await withTenant(TENANT_M, () => orders.start(inProgress.id, M_ACTOR));
    await expect(withTenant(TENANT_M, () => orders.release(inProgress.id, M_ACTOR))).rejects.toMatchObject({
      code: "PRODUCTION_ORDER_STATE",
    });

    // Illegal: start on DRAFT / on COMPLETED (the chain's bread order).
    const draft = await createSpecOrder(specItems.variance);
    await expect(withTenant(TENANT_M, () => orders.start(draft.id, M_ACTOR))).rejects.toMatchObject({
      code: "PRODUCTION_ORDER_STATE",
    });
    await expect(
      withTenant(TENANT_M, () => orders.start(fixture.chain.breadOrder.id, M_ACTOR)),
    ).rejects.toMatchObject({ code: "PRODUCTION_ORDER_STATE" });

    // Illegal: consume on RELEASED.
    const releasedOnly = await createSpecOrder(specItems.variance);
    await withTenant(TENANT_M, () => orders.release(releasedOnly.id, M_ACTOR));
    await expect(
      withTenant(TENANT_M, () =>
        orders.consume(releasedOnly.id, {
          lines: [{ itemId: fixture.items.flour, qty: "1", batchId: null }],
          consumedAt: "2026-04-02",
          note: null,
          noteAr: null,
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "PRODUCTION_ORDER_STATE" });

    // Illegal: complete on RELEASED.
    await expect(
      withTenant(TENANT_M, () =>
        orders.complete(releasedOnly.id, { actualQty: "1", batchNo: null, completedAt: "2026-04-02", actorId: M_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "PRODUCTION_ORDER_STATE" });

    // Illegal: cancel on COMPLETED.
    await expect(
      withTenant(TENANT_M, () => orders.cancel(fixture.chain.breadOrder.id, { reason: "nope", actorId: M_ACTOR })),
    ).rejects.toMatchObject({ code: "PRODUCTION_ORDER_STATE" });

    // The typed guards the matrix relies on: not-found + non-STOCK FG.
    await expect(withTenant(TENANT_M, () => orders.find("11111111-1111-1111-1111-111111111111"))).rejects.toMatchObject(
      { code: "PRODUCTION_ORDER_NOT_FOUND" },
    );
  });

  it("cancel rules — DRAFT/RELEASED/IN_PROGRESS-with-zero-consumptions cancel; after consumption ORDER_NOT_CANCELABLE; reason required", async () => {
    // DRAFT cancel.
    const draftOrder = await createSpecOrder(specItems.variance);
    const cancelledDraft = await withTenant(TENANT_M, () =>
      orders.cancel(draftOrder.id, { reason: "planning change", actorId: M_ACTOR }),
    );
    expect(cancelledDraft.status).toBe("CANCELLED");
    expect(cancelledDraft.cancelReason).toBe("planning change");
    expect(cancelledDraft.cancelledAt).not.toBeNull();

    // RELEASED cancel.
    const releasedOrder = await createSpecOrder(specItems.variance);
    await withTenant(TENANT_M, () => orders.release(releasedOrder.id, M_ACTOR));
    const cancelledReleased = await withTenant(TENANT_M, () =>
      orders.cancel(releasedOrder.id, { reason: "released in error", actorId: M_ACTOR }),
    );
    expect(cancelledReleased.status).toBe("CANCELLED");

    // IN_PROGRESS with ZERO consumption rows cancels.
    const startedOrder = await createSpecOrder(specItems.variance);
    await withTenant(TENANT_M, () => orders.release(startedOrder.id, M_ACTOR));
    await withTenant(TENANT_M, () => orders.start(startedOrder.id, M_ACTOR));
    const cancelledStarted = await withTenant(TENANT_M, () =>
      orders.cancel(startedOrder.id, { reason: "batch abandoned before issue", actorId: M_ACTOR }),
    );
    expect(cancelledStarted.status).toBe("CANCELLED");

    // After ANY consumption → ORDER_NOT_CANCELABLE (corrections are
    // adjusted consumptions).
    const consumedOrder = await createSpecOrder(specItems.variance);
    await withTenant(TENANT_M, () => orders.release(consumedOrder.id, M_ACTOR));
    await withTenant(TENANT_M, () => orders.start(consumedOrder.id, M_ACTOR));
    await withTenant(TENANT_M, () =>
      orders.consume(consumedOrder.id, {
        lines: [{ itemId: fixture.items.flour, qty: "1", batchId: null }],
        consumedAt: "2026-04-02",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_M, () => orders.cancel(consumedOrder.id, { reason: "too late", actorId: M_ACTOR })),
    ).rejects.toMatchObject({ code: "ORDER_NOT_CANCELABLE" });

    // Reason required (1..500).
    const reasonless = await createSpecOrder(specItems.variance);
    await expect(
      withTenant(TENANT_M, () => orders.cancel(reasonless.id, { reason: "   ", actorId: M_ACTOR })),
    ).rejects.toMatchObject({ code: "PRODUCTION_ORDER_INPUT_INVALID" });
  });

  it("release — PRD-{YYYY}-{SEQ:5} numbers increment per branch; the BOM version BINDS at release (a later v2 never rewrites the order)", async () => {
    // Two sequential releases: the seq climbs by exactly 1.
    const first = await createSpecOrder(specItems.versioned);
    const second = await createSpecOrder(specItems.versioned);
    const firstReleased = await withTenant(TENANT_M, () => orders.release(first.id, M_ACTOR));
    const secondReleased = await withTenant(TENANT_M, () => orders.release(second.id, M_ACTOR));
    expect(firstReleased.orderNo).toMatch(/^PRD-\d{4}-\d{5}$/);
    expect(secondReleased.orderNo).toMatch(/^PRD-\d{4}-\d{5}$/);
    const seq = (orderNo: string) => Number(orderNo.split("-")[2]);
    expect(seq(secondReleased.orderNo!)).toBe(seq(firstReleased.orderNo!) + 1);

    // Version binding (the T1 hook): the released order keeps ITS version.
    const v1 = await withTenant(TENANT_M, () => mfgStore.findActiveBom(specItems.versioned));
    expect(v1).toBeDefined();
    const detail = await withTenant(TENANT_M, () => orders.get(first.id));
    expect(detail.order.bomId).toBe(v1!.id);
    expect(detail.order.yieldSnapshot).toBe("100.0000");
    const flourLine = detail.lines.find((line) => line.componentItemId === fixture.items.flour)!;
    expect(flourLine.plannedQty).toBe("10.000000"); // 100 × 0.1 / 1.0
    const boundBomId = detail.order.bomId;
    const boundLineId = flourLine.id;

    // Activate v2 for the same item (0.2 per output) — the RELEASED order's
    // snapshot is frozen: same bom_id, same lines.
    const v2 = await withTenant(TENANT_M, async () =>
      boms.create({
        itemId: specItems.versioned,
        outputUomId: (await mfgStore.findItemForProduction(specItems.versioned))!.baseUomId,
        yieldPct: "100.0000",
        note: "M-VB v2 (orders spec)",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: fixture.items.flour, qtyPerOutput: "0.200000", scrapPct: "0" }],
      }),
    );
    await withTenant(TENANT_M, () => boms.activate(v2.id, { effectiveFrom: "2026-04-01", actorId: M_ACTOR }));
    const reRead = await withTenant(TENANT_M, () => orders.get(first.id));
    expect(reRead.order.bomId).toBe(boundBomId);
    expect(reRead.lines.find((line) => line.id === boundLineId)!.plannedQty).toBe("10.000000");

    // A NEW order released after the v2 activation binds v2's math.
    const third = await createSpecOrder(specItems.versioned);
    const thirdReleased = await withTenant(TENANT_M, () => orders.release(third.id, M_ACTOR));
    expect(thirdReleased.bomId).toBe(v2.id);
    const thirdLines = await withTenant(TENANT_M, () => mfgStore.listProductionOrderLines(third.id));
    expect(thirdLines[0]!.plannedQty).toBe("20.000000"); // 100 × 0.2 / 1.0
  });

  it("variance review (§5) — within 5% no flag; beyond it over_plan + exactly ONE notification; further consumption is never blocked nor re-notified", async () => {
    const order = await createSpecOrder(specItems.variance); // flour plan 10.000000
    await withTenant(TENANT_M, () => orders.release(order.id, M_ACTOR));
    await withTenant(TENANT_M, () => orders.start(order.id, M_ACTOR));
    const dedupeKey = `mfg-consumption-variance:${order.id}:${fixture.items.flour}`;

    // 10.2 ≤ 10 × 1.05 — inside the threshold: no flag, no notification.
    await withTenant(TENANT_M, () =>
      orders.consume(order.id, {
        lines: [{ itemId: fixture.items.flour, qty: "10.2", batchId: null }],
        consumedAt: "2026-04-03",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    let lines = await withTenant(TENANT_M, () => mfgStore.listProductionOrderLines(order.id));
    expect(lines[0]!.actualQty).toBe("10.200000");
    expect(lines[0]!.overPlan).toBe(false);
    expect(await notificationCount(dedupeKey)).toBe(0);

    // +0.5 → cumulative 10.7 > 10.5: flag ONCE + exactly one notification,
    // and the consumption is NOT blocked.
    await withTenant(TENANT_M, () =>
      orders.consume(order.id, {
        lines: [{ itemId: fixture.items.flour, qty: "0.5", batchId: null }],
        consumedAt: "2026-04-03",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    lines = await withTenant(TENANT_M, () => mfgStore.listProductionOrderLines(order.id));
    expect(lines[0]!.actualQty).toBe("10.700000");
    expect(lines[0]!.overPlan).toBe(true);
    expect(await notificationCount(dedupeKey)).toBe(1);

    // A further consume still posts (never blocked) and does NOT duplicate
    // the notification (dedupeKey) nor re-flag.
    await withTenant(TENANT_M, () =>
      orders.consume(order.id, {
        lines: [{ itemId: fixture.items.flour, qty: "0.3", batchId: null }],
        consumedAt: "2026-04-03",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    lines = await withTenant(TENANT_M, () => mfgStore.listProductionOrderLines(order.id));
    expect(lines[0]!.actualQty).toBe("11.000000");
    expect(lines[0]!.overPlan).toBe(true);
    expect(await notificationCount(dedupeKey)).toBe(1);

    // Unplanned items are rejected with the typed 422.
    await expect(
      withTenant(TENANT_M, () =>
        orders.consume(order.id, {
          lines: [{ itemId: fixture.items.yeast, qty: "1", batchId: null }],
          consumedAt: "2026-04-03",
          note: null,
          noteAr: null,
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONSUMPTION_NOT_PLANNED" });

    // Complete it (11 flour @ 10 = 110; 11 × 10.000000 exact) — the
    // idempotency pack below replays this order.
    const done = await withTenant(TENANT_M, () =>
      orders.complete(order.id, { actualQty: "11", batchNo: null, completedAt: "2026-04-03", actorId: M_ACTOR }),
    );
    expect(done.fgValue).toBe("110.0000");
    varianceOrderId = order.id;
    varianceCompletion = done;
  });

  it("INV-013 — complete twice returns the SAME journal/batch with zero new journals; release twice advances the sequence once", async () => {
    const orderId = varianceOrderId;
    const first = varianceCompletion!;
    expect(orderId).not.toBe("");

    // Complete-on-COMPLETED: the stored result, recomputed off the row.
    const journalsBefore = await countJournals();
    const replay = await withTenant(TENANT_M, () =>
      orders.complete(orderId, { actualQty: "11", batchNo: null, completedAt: "2026-04-03", actorId: M_ACTOR }),
    );
    expect(replay.journalEntryId).toBe(first.journalEntryId);
    expect(replay.batchId).toBe(first.batchId);
    expect(replay.batchNo).toBe(first.batchNo);
    expect(replay.fgValue).toBe(first.fgValue);
    expect(await countJournals()).toBe(journalsBefore); // NO second journal
    const batches = await withTenant(TENANT_M, () =>
      inventoryStore.listBatches({ itemId: specItems.variance, limit: 50 }),
    );
    expect(batches.filter((batch) => batch.productionOrderId === orderId)).toHaveLength(1); // NO second batch

    // Release-on-RELEASED: a no-op that never touches the numbering row.
    const candidate = await createSpecOrder(specItems.variance);
    await withTenant(TENANT_M, () => orders.release(candidate.id, M_ACTOR));
    const before = await prdNextValue();
    const reReleased = await withTenant(TENANT_M, () => orders.release(candidate.id, M_ACTOR));
    expect(reReleased.status).toBe("RELEASED");
    expect(reReleased.orderNo).toMatch(/^PRD-\d{4}-\d{5}$/);
    expect(await prdNextValue()).toBe(before); // advanced ONCE (at the first release)
    // Cancel it — the released-but-unconsumed order leaves the lifecycle clean.
    await withTenant(TENANT_M, () => orders.cancel(candidate.id, { reason: "replay pack cleanup", actorId: M_ACTOR }));
  });

  it("PERIOD_LOCKED — consume/complete into a locked month throw the typed engine error with ZERO residue; reopen (INV-020) re-enables", async () => {
    const order = await createSpecOrder(specItems.variance, "10"); // flour plan 1.000000
    await withTenant(TENANT_M, () => orders.release(order.id, M_ACTOR));
    await withTenant(TENANT_M, () => orders.start(order.id, M_ACTOR));

    const journalsAtStart = await countJournals();
    const flourBefore = await stockQtyOf(fixture.items.flour, fixture.warehouseRaw);
    // The chain month (March 2026) — the period the golden chain posted into.
    const march = await withTenant(TENANT_M, () => periodStore.findPeriodForDate("2026-03-02"));
    expect(march).toBeDefined();

    try {
      await withTenant(TENANT_M, () => periods.softClose(M_ACTOR, march!.id));
      await withTenant(TENANT_M, () => periods.lock(M_ACTOR, march!.id));

      // Consume into the locked month: the engine's PERIOD_LOCKED (thrown
      // pre-write — the plans made no rows).
      await expect(
        withTenant(TENANT_M, () =>
          orders.consume(order.id, {
            lines: [{ itemId: fixture.items.flour, qty: "1", batchId: null }],
            consumedAt: "2026-03-02",
            note: null,
            noteAr: null,
            actorId: M_ACTOR,
          }),
        ),
      ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
      // ZERO residue: no journal, no consumption row, no stock move.
      expect(await countJournals()).toBe(journalsAtStart);
      expect(await withTenant(TENANT_M, () => mfgStore.countProductionConsumptions(order.id))).toBe(0);
      expect(await stockQtyOf(fixture.items.flour, fixture.warehouseRaw)).toBe(flourBefore);
      const stuck = await withTenant(TENANT_M, () => orders.find(order.id));
      expect(stuck.status).toBe("IN_PROGRESS");

      // An OPEN-month consume succeeds, then completing INTO the locked
      // month is PERIOD_LOCKED with zero residue too.
      await withTenant(TENANT_M, () =>
        orders.consume(order.id, {
          lines: [{ itemId: fixture.items.flour, qty: "1", batchId: null }],
          consumedAt: "2026-04-05",
          note: null,
          noteAr: null,
          actorId: M_ACTOR,
        }),
      );
      const journalsAfterOpenConsume = await countJournals();
      const breadStockBefore = await stockQtyOf(specItems.variance, fixture.warehouseFg);
      await expect(
        withTenant(TENANT_M, () =>
          orders.complete(order.id, { actualQty: "10", batchNo: null, completedAt: "2026-03-02", actorId: M_ACTOR }),
        ),
      ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
      expect(await countJournals()).toBe(journalsAfterOpenConsume); // no completion journal
      expect(await stockQtyOf(specItems.variance, fixture.warehouseFg)).toBe(breadStockBefore); // no FG receipt
      expect((await withTenant(TENANT_M, () => orders.find(order.id))).status).toBe("IN_PROGRESS");

      // INV-020 reopen → the completion now posts (order independence).
      await withTenant(TENANT_M, () => periods.reopen(M_ACTOR, march!.id, "T38b PERIOD_LOCKED pack reopen"));
      const done = await withTenant(TENANT_M, () =>
        orders.complete(order.id, { actualQty: "10", batchNo: null, completedAt: "2026-04-06", actorId: M_ACTOR }),
      );
      expect(done.order.status).toBe("COMPLETED");
      expect(done.fgValue).toBe("10.0000"); // 1 flour @ 10, rates 0
      expect(await countJournals()).toBe(journalsAfterOpenConsume + 1);
    } finally {
      // Always leave March OPEN for the later specs (QC/genealogy/reports).
      const current = await withTenant(TENANT_M, () => periodStore.findPeriodForDate("2026-03-02"));
      if (current!.status !== "OPEN") {
        await withTenant(TENANT_M, () =>
          periods.reopen(M_ACTOR, current!.id, "T38b PERIOD_LOCKED pack finally-reopen"),
        );
      }
    }
  });

  it("FEFO proposal — a batch-less consume on a multi-batch item picks the EARLIEST expiry (M-F1 before the later M-F2)", async () => {
    // A second flour batch with a LATER expiry (M-F1: 2026-07-15 → M-F2: 2026-09-20).
    await withTenant(TENANT_M, () =>
      stock.manualReceipt({
        itemId: fixture.items.flour,
        warehouseId: fixture.warehouseRaw,
        qty: "500",
        unitCost: "10.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-02-20",
        batchNo: "M-F2",
        batchExpiry: "2026-09-20",
        actorId: M_ACTOR,
      }),
    );
    const flourBatches = await withTenant(TENANT_M, () =>
      inventoryStore.listBatches({ itemId: fixture.items.flour, limit: 10 }),
    );
    expect(flourBatches.map((batch) => batch.batchNo).sort()).toEqual(["M-F1", "M-F2"]);

    const order = await createSpecOrder(specItems.fefo, "10"); // flour plan 1.000000
    await withTenant(TENANT_M, () => orders.release(order.id, M_ACTOR));
    await withTenant(TENANT_M, () => orders.start(order.id, M_ACTOR));
    const consumed = await withTenant(TENANT_M, () =>
      orders.consume(order.id, {
        lines: [{ itemId: fixture.items.flour, qty: "1", batchId: null }], // FEFO proposal
        consumedAt: "2026-04-07",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    // The slice landed on M-F1 — the earlier expiry wins the pick.
    expect(consumed.consumptions).toHaveLength(1);
    expect(consumed.consumptions[0]!.batchId).toBe(fixture.chain.flourBatchId);
    expect(consumed.consumptions[0]!.qty).toBe("1.000000");
    expect(consumed.consumptions[0]!.unitCost).toBe("10.000000");

    // The consumption journal is the standard pair, sourced consume_1.
    expect(await withTenant(TENANT_M, () => journalLinesOf(consumed.journalEntryId))).toEqual([
      { accountId: fixture.gl.wip, direction: "DEBIT", amount: "10.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "10.0000" },
    ]);
    const bySource = await withTenant(TENANT_M, () =>
      journal.findEntryBySourceKey("production_order", order.id, "consume_1"),
    );
    expect(bySource!.id).toBe(consumed.journalEntryId);
  });
});
