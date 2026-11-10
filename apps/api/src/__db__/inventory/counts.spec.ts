import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as periodStore from "../../modules/accounting/infrastructure/accounting.store";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import {
  I_ACTOR,
  I_COUNTER,
  I_SUPERVISOR,
  TENANT_I,
  counts,
  ensureInventoryItem,
  iPeriods,
  setupInventoryFixture,
  stock,
  type InventoryFixture,
} from "./fixtures";

/**
 * Stock-count workspace suite (PHASE-010 §2.10/§6; BR-015; Journey D):
 * DRAFT → COUNTED → VARIANCE_REVIEW → POSTED with the frozen snapshot,
 * blind mode, post-snapshot movement surfacing, the tolerance gate
 * (recount or supervisor), G-13/G-14 adjustment posting, and INV-011's
 * locked-period rejection. Self-contained on a dedicated item.
 */

let fixture: InventoryFixture;
let countItemId: string;

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  countItemId = await ensureInventoryItem("INV-V-COUNT", "Count workspace item");
});

describe("Journey D — the blind count flow end-to-end", () => {
  it("snapshot → entry → submit → variance review → approve posts the adjustment", async () => {
    // Setup: 30 @ 4.00 on hand.
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: countItemId,
        warehouseId: fixture.warehouseMain,
        qty: "30",
        unitCost: "4.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-01-05",
        actorId: I_ACTOR,
      }),
    );

    // 1. Create the session: snapshot frozen NOW, blind on.
    const created = await withTenant(TENANT_I, () =>
      counts.create({
        warehouseId: fixture.warehouseMain,
        blind: true,
        itemIds: [countItemId],
        note: "Journey D",
        noteAr: "رحلة جرد",
        actorId: I_COUNTER,
      }),
    );
    expect(created.status).toBe("DRAFT");
    expect(created.blind).toBe(true);
    const lines = await withTenant(TENANT_I, () => counts.lines(created.id));
    expect(lines.length).toBe(1);
    expect(lines[0]!.systemQty).toBe("30.000000"); // frozen at creation

    // 2. Enter the counted qty (blind: the counter surface never shows
    //    systemQty — the API keeps it server-side either way).
    await withTenant(TENANT_I, () =>
      counts.enterCounts({
        countId: created.id,
        entries: [{ lineNo: 1, countedQty: "28" }],
        actorId: I_COUNTER,
      }),
    );
    // Post-snapshot movement BEFORE submission — must surface in review.
    await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: countItemId,
        warehouseId: fixture.warehouseMain,
        qty: "1",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-01-06",
        actorId: I_ACTOR,
      }),
    );

    // 3. Submit → COUNTED.
    const submitted = await withTenant(TENANT_I, () =>
      counts.submit(created.id, I_COUNTER),
    );
    expect(submitted.status).toBe("COUNTED");

    // 4. Variance review: −2 @ 4.00 = −8.0000 impact, movements listed.
    const reviewed = await withTenant(TENANT_I, () => counts.review(created.id, I_COUNTER));
    expect(reviewed.status).toBe("VARIANCE_REVIEW");
    expect(reviewed.variance).toEqual({
      lossLines: 1,
      gainLines: 0,
      lossValue: "8.0000",
      gainValue: "0.0000",
    });
    const reviewLines = await withTenant(TENANT_I, () => counts.lines(created.id));
    expect(reviewLines[0]!.valueImpact).toBe("-8.0000");
    const postSnapshot = await withTenant(TENANT_I, () =>
      counts.postSnapshotMovements(created.id),
    );
    expect(postSnapshot.length).toBe(1); // the DAMAGE issue after the snapshot
    expect(postSnapshot[0]!.direction).toBe("OUT");

    // 5. Approve (BR-015: |−8| > tolerance 0 → supervisor flag needed).
    await expect(
      withTenant(TENANT_I, () =>
        counts.approve({ id: created.id, supervisor: false, actorId: I_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "COUNT_VARIANCE_TOLERANCE_EXCEEDED" });
    const approved = await withTenant(TENANT_I, () =>
      counts.approve({ id: created.id, supervisor: true, actorId: I_SUPERVISOR }),
    );
    expect(approved.countNo).toMatch(/^CNT-20\d{2}-\d{6}$/);
    // G-13 shape: 2 × 4.00 = 8.0000 loss.
    expect(approved.lossValue).toBe("8.0000");
    expect(approved.gainValue).toBe("0.0000");

    // The adjustment journal: DR SHRINKAGE 8.0000 · CR INVENTORY 8.0000.
    const entry = await withTenant(TENANT_I, () =>
      journal.findEntryBySourceKey("stock_count", created.id, "post"),
    );
    expect(entry).toBeDefined();
    const journalLines = await withTenant(TENANT_I, () => journal.listLines(entry!.id));
    expect(journalLines.map((line) => [line.accountId, line.direction, line.amount])).toEqual([
      [fixture.glShrinkage, "DEBIT", "8.0000"],
      [fixture.glInventory, "CREDIT", "8.0000"],
    ]);
    // The move rows: −2 OUT at count posting, journal-linked.
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "stock_count", sourceId: created.id, limit: 10 }),
    );
    expect(moves.length).toBe(1);
    expect(moves[0]!.direction).toBe("OUT");
    expect(moves[0]!.reason).toBe("COUNT_LOSS");
    expect(moves[0]!.postedJournalId).toBe(entry!.id);
    // Read model: 30 − 1 (damage) − 2 (count) = 27.
    const onHand = await withTenant(TENANT_I, () =>
      store.findItemStock(countItemId, fixture.warehouseMain),
    );
    expect(onHand!.qty).toBe("27.000000");
  });

  it("recount satisfies the tolerance without a supervisor (BR-015's second counter)", async () => {
    // Fresh count on the same item: 27 on hand.
    const created = await withTenant(TENANT_I, () =>
      counts.create({
        warehouseId: fixture.warehouseMain,
        blind: false,
        itemIds: [countItemId],
        note: null,
        noteAr: null,
        actorId: I_COUNTER,
      }),
    );
    await withTenant(TENANT_I, () =>
      counts.enterCounts({
        countId: created.id,
        entries: [{ lineNo: 1, countedQty: "24" }],
        actorId: I_COUNTER,
      }),
    );
    await withTenant(TENANT_I, () => counts.submit(created.id, I_COUNTER));
    await withTenant(TENANT_I, () => counts.review(created.id, I_COUNTER));
    await expect(
      withTenant(TENANT_I, () =>
        counts.approve({ id: created.id, supervisor: false, actorId: I_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "COUNT_VARIANCE_TOLERANCE_EXCEEDED" });
    // A recounted line posts with plain approval.
    await withTenant(TENANT_I, () =>
      counts.recountLine({
        countId: created.id,
        lineNo: 1,
        countedQty: "25",
        recountNote: "second counter confirmed shelf B",
        actorId: I_COUNTER,
      }),
    );
    const approved = await withTenant(TENANT_I, () =>
      counts.approve({ id: created.id, supervisor: false, actorId: I_ACTOR }),
    );
    expect(approved.countNo).toMatch(/^CNT-/);
  });

  it("INV-011: approving into a LOCKED period is rejected with zero residue", async () => {
    // A count whose approval would post TODAY — lock today's month first.
    const created = await withTenant(TENANT_I, () =>
      counts.create({
        warehouseId: fixture.warehouseMain,
        blind: false,
        itemIds: [countItemId],
        note: null,
        noteAr: null,
        actorId: I_COUNTER,
      }),
    );
    await withTenant(TENANT_I, () =>
      counts.enterCounts({
        countId: created.id,
        entries: [{ lineNo: 1, countedQty: "20" }],
        actorId: I_COUNTER,
      }),
    );
    await withTenant(TENANT_I, () => counts.submit(created.id, I_COUNTER));
    await withTenant(TENANT_I, () => counts.review(created.id, I_COUNTER));

    const today = new Date().toISOString().slice(0, 10);
    const period = await withTenant(TENANT_I, () => periodStore.findPeriodForDate(today));
    await withTenant(TENANT_I, () => iPeriods.softClose(I_ACTOR, period!.id));
    try {
      await withTenant(TENANT_I, () => iPeriods.lock(I_ACTOR, period!.id));
      await expect(
        withTenant(TENANT_I, () =>
          counts.approve({ id: created.id, supervisor: true, actorId: I_ACTOR }),
        ),
      ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
      // Zero residue: no moves, no journal, session still VARIANCE_REVIEW.
      const moves = await withTenant(TENANT_I, () =>
        store.listStockMoves({ sourceType: "stock_count", sourceId: created.id, limit: 10 }),
      );
      expect(moves.length).toBe(0);
      const entry = await withTenant(TENANT_I, () =>
        journal.findEntryBySourceKey("stock_count", created.id, "post"),
      );
      expect(entry).toBeUndefined();
      const row = await withTenant(TENANT_I, () => store.findCountById(created.id));
      expect(row!.status).toBe("VARIANCE_REVIEW");
    } finally {
      await withTenant(TENANT_I, () =>
        iPeriods.reopen(I_ACTOR, period!.id, "test reopen after INV-011 pack"),
      );
    }
  });

  it("state machine: only DRAFT accepts entry/cancel; only COUNTED reviews", async () => {
    const created = await withTenant(TENANT_I, () =>
      counts.create({
        warehouseId: fixture.warehouseMain,
        blind: false,
        itemIds: [countItemId],
        note: null,
        noteAr: null,
        actorId: I_COUNTER,
      }),
    );
    await expect(
      withTenant(TENANT_I, () => counts.review(created.id, I_COUNTER)),
    ).rejects.toMatchObject({ code: "STOCK_COUNT_STATE_INVALID" });
    await withTenant(TENANT_I, () => counts.cancel(created.id, I_COUNTER));
    const row = await withTenant(TENANT_I, () => store.findCountById(created.id));
    expect(row!.status).toBe("CANCELLED");
    await expect(
      withTenant(TENANT_I, () =>
        counts.enterCounts({
          countId: created.id,
          entries: [{ lineNo: 1, countedQty: "1" }],
          actorId: I_COUNTER,
        }),
      ),
    ).rejects.toMatchObject({ code: "STOCK_COUNT_STATE_INVALID" });
  });
});
