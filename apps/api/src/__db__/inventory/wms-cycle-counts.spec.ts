import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import { CycleCountService } from "../../modules/inventory/application/cycle-count-service";
import {
  AbcThresholdError,
  CycleCountThresholdError,
} from "../../modules/inventory/domain/inventory-errors";
import type { AuditService } from "../../modules/audit/api/audit";
import {
  I_ACTOR,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  stock,
  type InventoryFixture,
} from "./fixtures";

/**
 * Cycle-counting + ABC suite (PHASE-044 T-07; §2.6/§2.7, I-08/I-09/I-20):
 * the ABC recompute's Pareto walk over the consumption window, the
 * schedule's frequency-gated document generation (A-first, due-items
 * only, no empty documents), the bin-aware count lifecycle, BR-075's
 * approval threshold, and the G-13/G-14 variance posting with
 * CYCLE_COUNT_LOSS / CYCLE_COUNT_GAIN reasons riding the movement core
 * (INV-029 holds at approval).
 *
 * Timeline note: the consumption window is 90 days over a system clock
 * of 2026-11-12; the sibling suites' moves all sit at ≤ 2026-03-10, so
 * this suite's 2026-10/2026-11 moves are the ONLY consumption in the
 * window — the Pareto shares are fully deterministic.
 */

let fixture: InventoryFixture;
let cycleCounts: CycleCountService;

const D_RECEIPT = "2026-10-01";
const D_ISSUE = "2026-11-01";

let itemA1 = "";
let itemA2 = "";
let itemB1 = "";
let itemC1 = "";
let itemZero = "";
let scheduleId = "";

beforeAll(async () => {
  fixture = await setupInventoryFixture();
  const { AuditService } = await import("../../modules/audit/api/audit");
  const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
  const { PostingService } = await import("../../modules/accounting/application/posting-service");
  const { NumberingService } = await import("../../modules/accounting/application/numbering-service");
  const { PartnerSubledgerService } = await import("../../modules/partners/application/subledger-service");
  const audit = new AuditService(new DrizzleAuditStore()) as AuditService;
  cycleCounts = new CycleCountService(
    audit,
    new PostingService(audit, new PartnerSubledgerService()),
    new NumberingService(audit),
  );

  itemA1 = await ensureInventoryItem("INV-ABC-A1", "ABC heavy consumer");
  itemA2 = await ensureInventoryItem("INV-ABC-A2", "ABC second consumer");
  itemB1 = await ensureInventoryItem("INV-ABC-B1", "ABC mid consumer");
  itemC1 = await ensureInventoryItem("INV-ABC-C1", "ABC tail consumer");
  itemZero = await ensureInventoryItem("INV-ABC-Z", "ABC zero consumer");

  const wh = fixture.warehouseMain;
  const seed = async (itemId: string, issueQty: string | null) => {
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId,
        warehouseId: wh,
        qty: "1000",
        unitCost: "20.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: D_RECEIPT,
        actorId: I_ACTOR,
      }),
    );
    if (issueQty !== null) {
      await withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId,
          warehouseId: wh,
          qty: issueQty,
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: D_ISSUE,
          actorId: I_ACTOR,
        }),
      );
    }
  };
  // Consumption over the window: 8000 + 7000 + 3800 + 1200 = 20000 (my
  // items dominate the window's total; the shares sit OFF the exact
  // 0.80/0.95 boundaries so sibling specs' same-window consumption —
  // the quarantine dispositions' ~87, later phases' settlement legs —
  // cannot flip a class: C1 stays C while extra consumption stays under
  // ~1000, B1 stays B unconditionally, the A pair likewise).
  await seed(itemA1, "400");
  await seed(itemA2, "350");
  await seed(itemB1, "190");
  await seed(itemC1, "60");
  await seed(itemZero, null);
});

describe("§2.7 — the ABC recompute: the Pareto walk over consumption", () => {
  it("classifies A/A/B/C on the 80/95 cumulative walk; zero-consumption lands C; velocity = qty/day", async () => {
    const result = await withTenant(TENANT_I, () =>
      cycleCounts.recomputeAbc({ windowDays: 90, actorId: I_ACTOR }),
    );
    expect(result.windowDays).toBe(90);
    expect(Number(result.totalConsumption)).toBeGreaterThanOrEqual(20000);

    const rows = await withTenant(TENANT_I, () => cycleCounts.listAbc({}));
    const byItem = new Map(rows.map((row) => [row.itemId, row]));
    expect(byItem.get(itemA1)?.cls).toBe("A"); // 8000/20000 = 0.40 ≤ 0.80
    expect(byItem.get(itemA2)?.cls).toBe("A"); // 15000/20000 = 0.75 ≤ 0.80
    expect(byItem.get(itemB1)?.cls).toBe("B"); // 18800/20000 = 0.94 ≤ 0.95
    expect(byItem.get(itemC1)?.cls).toBe("C"); // 20000/20000 > 0.95
    expect(byItem.get(itemZero)?.cls).toBe("C"); // zero consumption
    // The rank + velocity math (A1: rank 1, 400/90 per day).
    expect(byItem.get(itemA1)?.rankNo).toBe(1);
    expect(byItem.get(itemA1)?.velocity).toBe("4.444444");
    expect(byItem.get(itemA1)?.consumptionValue).toBe("8000.0000");
  });

  it("a recompute demotes the previous generation — one LATEST row per item (the partial floor)", async () => {
    await withTenant(TENANT_I, () => cycleCounts.recomputeAbc({ windowDays: 90, actorId: I_ACTOR }));
    const rows = await withTenant(TENANT_I, () => cycleCounts.listAbc({}));
    const latest = rows.filter((row) => row.itemId === itemA1);
    expect(latest).toHaveLength(1);
    // The demoted generation stays queryable history (is_latest = false).
    const db = await import("../../modules/inventory/infrastructure/cycle-count.store");
    const history = await withTenant(TENANT_I, () =>
      db.consumptionByItem(90),
    );
    expect(history.find((row) => row.itemId === itemA1)?.consumptionValue).toBe("8000.0000");
  });

  it("rejects an inverted split (AbcThresholdError, §2.7)", async () => {
    await expect(
      withTenant(TENANT_I, () =>
        cycleCounts.recomputeAbc({ windowDays: 90, aPct: "0.95", bPct: "0.90", actorId: I_ACTOR }),
      ),
    ).rejects.toThrow(AbcThresholdError);
  });
});

describe("§2.6 — the schedule: frequency-gated generation + the count lifecycle", () => {
  it("creates the schedule (A ≤ B ≤ C days enforced)", async () => {
    const schedule = await withTenant(TENANT_I, () =>
      cycleCounts.createSchedule({
        warehouseId: fixture.warehouseMain,
        name: "MAIN cycle count",
        classADays: 30,
        classBDays: 90,
        classCDays: 180,
        approvalThreshold: "100.0000",
        blind: false,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    scheduleId = schedule.id;
    expect(schedule.approvalThreshold).toBe("100.0000");

    await expect(
      withTenant(TENANT_I, () =>
        cycleCounts.createSchedule({
          warehouseId: fixture.warehouseMain,
          name: "bad order",
          classADays: 90,
          classBDays: 30,
          classCDays: 180,
          approvalThreshold: "0",
          blind: false,
          note: null,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toThrow(/A ≤ B ≤ C/);
  });

  it("runSchedule generates a bin-aware DRAFT document of the due items (never counted = due)", async () => {
    const run = await withTenant(TENANT_I, () =>
      cycleCounts.runSchedule(scheduleId, { maxItems: 50, actorId: I_ACTOR }),
    );
    expect(run.documentId).toBeTruthy();
    expect(run.dueItems).toBeGreaterThanOrEqual(5);

    const doc = await withTenant(TENANT_I, () => cycleCounts.findDocument(run.documentId!));
    expect(doc.status).toBe("DRAFT");
    expect(doc.scheduleId).toBe(scheduleId);
    expect(doc.blind).toBe(false);

    const lines = await withTenant(TENANT_I, () => cycleCounts.lines(run.documentId!));
    const lineOf = (itemId: string) => lines.find((line) => line.itemId === itemId);
    // Every stocked item is due (never cycle-counted); my five are all in.
    expect(lineOf(itemA1)).toBeDefined();
    expect(lineOf(itemA2)).toBeDefined();
    expect(lineOf(itemB1)).toBeDefined();
    expect(lineOf(itemC1)).toBeDefined();
    expect(lineOf(itemZero)).toBeDefined();
    // The system snapshot = the live slot qty (A1 has 600 left on hand).
    expect(lineOf(itemA1)!.systemQty).toBe("600.000000");
    expect(lineOf(itemA1)!.binId).toBeTruthy();
  });

  it("the lifecycle: entry → submit → review → approve posts G-13/G-14 with CYCLE_COUNT reasons (INV-029 intact)", async () => {
    const docs = await withTenant(TENANT_I, () =>
      cycleCounts.listDocuments({ scheduleId, status: "DRAFT" }),
    );
    const doc = docs[0]!;
    const lines = await withTenant(TENANT_I, () => cycleCounts.lines(doc.id));

    // Enter: everything exact EXCEPT A1 (−3 loss) and ZERO (+2 gain).
    const entries = lines.map((line) => ({
      lineNo: line.lineNo,
      countedQty:
        line.itemId === itemA1
          ? new Decimal(line.systemQty).minus(3).toFixed(6)
          : line.itemId === itemZero
            ? new Decimal(line.systemQty).plus(2).toFixed(6)
            : line.systemQty,
    }));
    await withTenant(TENANT_I, () =>
      cycleCounts.enterCounts({ documentId: doc.id, entries, actorId: I_ACTOR }),
    );

    const submitted = await withTenant(TENANT_I, () => cycleCounts.submit(doc.id, I_ACTOR));
    expect(submitted.status).toBe("COUNTED");

    const reviewed = await withTenant(TENANT_I, () => cycleCounts.review(doc.id, I_ACTOR));
    expect(reviewed.status).toBe("VARIANCE_REVIEW");
    // A1: −3 × 20 = 60 loss; ZERO: +2 × 20 = 40 gain (avg cost 20).
    expect(reviewed.varianceLossValue).toBe("60.0000");
    expect(reviewed.varianceGainValue).toBe("40.0000");

    // The threshold (100) covers both impacts — no supervisor needed.
    const approved = await withTenant(TENANT_I, () =>
      cycleCounts.approve({ id: doc.id, supervisor: false, actorId: I_ACTOR }),
    );
    expect(approved.countNo).toMatch(/^CC-\d{4}-\d{6}$/);
    expect(approved.lossValue).toBe("60.0000");
    expect(approved.gainValue).toBe("40.0000");
    expect(approved.journalEntryId).toBeTruthy();

    // The journal: DR shrinkage 60 / CR inventory 60 + DR inventory 40 /
    // CR appreciation 40 — balanced (the G-13/G-14 shapes).
    const entry = await withTenant(TENANT_I, () =>
      journal.findEntryById(approved.journalEntryId!),
    );
    const lines2 = await withTenant(TENANT_I, () => journal.listLines(approved.journalEntryId!));
    const debit = lines2
      .filter((l) => l.direction === "DEBIT")
      .reduce((sum, l) => sum + Number(l.amount), 0);
    const credit = lines2
      .filter((l) => l.direction === "CREDIT")
      .reduce((sum, l) => sum + Number(l.amount), 0);
    expect(debit).toBeCloseTo(100, 4);
    expect(credit).toBeCloseTo(100, 4);
    expect(entry).toBeTruthy();

    // The moves carry the CYCLE_COUNT reasons + the document source.
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "cycle_count", sourceId: doc.id, limit: 10 }),
    );
    const loss = moves.find((m) => m.itemId === itemA1);
    const gain = moves.find((m) => m.itemId === itemZero);
    expect(loss?.reason).toBe("CYCLE_COUNT_LOSS");
    expect(loss?.qty).toBe("3.000000");
    expect(gain?.reason).toBe("CYCLE_COUNT_GAIN");
    expect(gain?.qty).toBe("2.000000");

    // INV-029 after the posting: A1 bins = 47 = item_stock.
    const wmsStore = await import("../../modules/inventory/infrastructure/wms-store");
    const binRows = await withTenant(TENANT_I, () =>
      wmsStore.listBinContents({ warehouseId: fixture.warehouseMain, itemId: itemA1, limit: 10 }),
    );
    const binTotal = binRows
      .filter((r) => r.ownerPartnerId === null)
      .reduce((sum, r) => sum + Number(r.qty), 0);
    const stockRow = await withTenant(TENANT_I, () =>
      store.findItemStock(itemA1, fixture.warehouseMain),
    );
    expect(binTotal).toBeCloseTo(597, 6);
    expect(Number(stockRow?.qty)).toBeCloseTo(597, 6);

    // The document carries its evidence (POSTED = number + date + journal).
    const posted = await withTenant(TENANT_I, () => cycleCounts.findDocument(doc.id));
    expect(posted.status).toBe("POSTED");
    expect(posted.countNo).toBe(approved.countNo);
    expect(posted.countDate).toBeTruthy();
    expect(posted.postedJournalId).toBe(approved.journalEntryId);
  });

  it("the frequency gate: freshly counted items are NOT due on the immediate re-run (no empty documents)", async () => {
    const run = await withTenant(TENANT_I, () =>
      cycleCounts.runSchedule(scheduleId, { maxItems: 50, actorId: I_ACTOR }),
    );
    expect(run.documentId).toBeNull();
    expect(run.dueItems).toBe(0);
    expect(run.lines).toBe(0);
  });
});

describe("BR-075 — the variance approval threshold", () => {
  it("an over-threshold variance needs a supervisor (or a recount); the recount path posts clean", async () => {
    const item = await ensureInventoryItem("INV-CC-THR", "Cycle count threshold item");
    const wh = fixture.warehouseMain;
    await withTenant(TENANT_I, () =>
      stock.manualReceipt({
        itemId: item,
        warehouseId: wh,
        qty: "100",
        unitCost: "10.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: D_RECEIPT,
        actorId: I_ACTOR,
      }),
    );
    const thrSchedule = await withTenant(TENANT_I, () =>
      cycleCounts.createSchedule({
        warehouseId: wh,
        name: "MAIN threshold 50",
        classADays: 30,
        classBDays: 90,
        classCDays: 180,
        approvalThreshold: "50.0000",
        blind: false,
        note: null,
        actorId: I_ACTOR,
      }),
    );
    const run = await withTenant(TENANT_I, () =>
      cycleCounts.runSchedule(thrSchedule.id, { maxItems: 200, actorId: I_ACTOR }),
    );
    expect(run.documentId).toBeTruthy();
    const lines = await withTenant(TENANT_I, () => cycleCounts.lines(run.documentId!));
    const thrLine = lines.find((line) => line.itemId === item)!;

    // Count everything exact except the threshold item: −10 units = −100
    // value — over the 50 threshold.
    const entries = lines.map((line) => ({
      lineNo: line.lineNo,
      countedQty:
        line.itemId === item ? new Decimal(line.systemQty).minus(10).toFixed(6) : line.systemQty,
    }));
    await withTenant(TENANT_I, () =>
      cycleCounts.enterCounts({ documentId: run.documentId!, entries, actorId: I_ACTOR }),
    );
    await withTenant(TENANT_I, () => cycleCounts.submit(run.documentId!, I_ACTOR));
    await withTenant(TENANT_I, () => cycleCounts.review(run.documentId!, I_ACTOR));

    // The gate: supervisor=false is the typed rejection (BR-075).
    await expect(
      withTenant(TENANT_I, () =>
        cycleCounts.approve({ id: run.documentId!, supervisor: false, actorId: I_ACTOR }),
      ),
    ).rejects.toThrow(CycleCountThresholdError);

    // The recount path: −5 units = −50 value — NOT over the (strict >)
    // threshold; approval passes without a supervisor.
    await withTenant(TENANT_I, () =>
      cycleCounts.recountLine({
        documentId: run.documentId!,
        lineNo: thrLine.lineNo,
        countedQty: new Decimal(thrLine.systemQty).minus(5).toFixed(6),
        recountNote: "second counter confirmed 5 units short",
        actorId: I_ACTOR,
      }),
    );
    const approved = await withTenant(TENANT_I, () =>
      cycleCounts.approve({ id: run.documentId!, supervisor: false, actorId: I_ACTOR }),
    );
    expect(approved.lossValue).toBe("50.0000");
    const moves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ sourceType: "cycle_count", sourceId: run.documentId!, limit: 10 }),
    );
    expect(moves.find((m) => m.itemId === item)?.reason).toBe("CYCLE_COUNT_LOSS");
  });
});
