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
  clearMfgSetting,
  orders,
  setMfgSetting,
  setupMfgFixture,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-018 T38b — THE golden costing pack (MASTER-PLAN §8, binding): the
 * §8 chain's five journals pinned line-by-line, the per-order WIP netting to
 * EXACTLY zero, the produced batches' provenance/expiry, the post-sale stock
 * positions, the expiry-policy override, and the stock-move provenance.
 * Everything ran inside setupMfgFixture with the pinned March-2026 dates, so
 * this spec READS the chain (service-level, real PostingService journals —
 * nothing here posts except the L5 policy pack's own small orders).
 *
 * Shared-suite discipline: the manufacturing spec files share tenant M in one
 * sequential DB run and vitest does NOT guarantee their order, so every
 * assert here is scoped to the chain's OWN rows (its journals, its moves,
 * its orders) — the absolute on-hand goldens ride the pristine
 * `chain.chainBalances` snapshot captured inside setupMfgFixture the moment
 * the chain completed (the sales-fixture delta technique).
 */

let fixture: MfgFixture;

beforeAll(async () => {
  fixture = await setupMfgFixture();
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

async function movesFor(sourceType: string, sourceId: string) {
  const moves = await withTenant(TENANT_M, () =>
    inventoryStore.listStockMoves({ sourceType, sourceId, limit: 50 }),
  );
  return moves.filter((move) => move.sourceId === sourceId);
}

/** Signed balance of one GL account over a SPECIFIC entry set (base
 * currency) — the interference-proof form for shared-tenant suites. */
async function glBalanceOfEntries(accountId: string, entryIds: readonly string[]): Promise<string> {
  return withTenant(TENANT_M, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute<{ balance: string }>(sql`
      SELECT COALESCE(sum(CASE l.direction WHEN 'DEBIT' THEN l.amount ELSE -l.amount END), 0)
        ::numeric(19,4)::text AS balance
      FROM journal_lines l
      WHERE l.account_id = ${accountId}
        AND l.journal_entry_id IN (${sql.join(
          entryIds.map((entryId) => sql`${entryId}`),
          sql`, `,
        )})
    `);
    return rows.rows[0]!.balance;
  });
}

// -- the golden set ---------------------------------------------------------------

describe("PHASE-018 T38b golden costing chain (§8)", () => {
  it("J1 — dough consumption journal EXACTLY: DR WIP 8875.0000 · CR INVENTORY 8875.0000 (source production_order:consume_1)", async () => {
    const chain = fixture.chain;
    const entry = await withTenant(TENANT_M, () => journal.findEntryById(chain.doughConsumeJournalId));
    expect(entry).toBeDefined();
    expect(entry!.entryNo).toMatch(/^JE-\d{4}-\d{6}$/); // entryNo present
    expect(await withTenant(TENANT_M, () => journalLinesOf(chain.doughConsumeJournalId))).toEqual([
      { accountId: fixture.gl.wip, direction: "DEBIT", amount: "8875.0000" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "8875.0000" },
    ]);
    // The source key is findable — the INV-013 anchor (flour 637.5×10 + yeast 125×20).
    const bySource = await withTenant(TENANT_M, () =>
      journal.findEntryBySourceKey("production_order", chain.doughOrder.id, "consume_1"),
    );
    expect(bySource).toBeDefined();
    expect(bySource!.id).toBe(chain.doughConsumeJournalId);
  });

  it("J2 — dough scrap journal EXACTLY: DR PRODUCTION_SCRAP 443.7500 · CR WIP 443.7500; reason BURNT on the row", async () => {
    const chain = fixture.chain;
    expect(await withTenant(TENANT_M, () => journalLinesOf(chain.doughScrapJournalId))).toEqual([
      { accountId: fixture.gl.productionScrap, direction: "DEBIT", amount: "443.7500" },
      { accountId: fixture.gl.wip, direction: "CREDIT", amount: "443.7500" },
    ]);
    const scraps = await withTenant(TENANT_M, () => mfgStore.listProductionScraps(chain.doughOrder.id));
    expect(scraps).toHaveLength(1);
    expect(scraps[0]!.reasonCode).toBe("BURNT");
    expect(scraps[0]!.qty).toBe("50.000000");
    expect(scraps[0]!.value).toBe("443.7500");
    expect(scraps[0]!.journalId).toBe(chain.doughScrapJournalId);
    // WIP basis after the scrap, before the completion credit: ΣC − ΣS =
    // 8875 − 443.75 = 8431.2500 (the J3 credit — computed from both lists,
    // the mid-life form; sumOrderWip itself nets to zero once completed).
    const consumptions = await withTenant(TENANT_M, () =>
      mfgStore.listProductionConsumptions(chain.doughOrder.id),
    );
    const consumed = consumptions.reduce((sum, row) => sum + Number(row.value), 0);
    const scrapped = scraps.reduce((sum, row) => sum + Number(row.value), 0);
    expect((consumed - scrapped).toFixed(4)).toBe("8431.2500");
  });

  it("J3 — dough completion EXACTLY: DR INVENTORY 8431.2500 · CR WIP 8431.2500 (no labor/overhead lines); produced batch @ 8.875000, expiry +2d, provenance set", async () => {
    const chain = fixture.chain;
    const lines = await withTenant(TENANT_M, () => journalLinesOf(chain.doughCompleteJournalId));
    expect(lines).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "8431.2500" },
      { accountId: fixture.gl.wip, direction: "CREDIT", amount: "8431.2500" },
    ]);
    expect(lines).toHaveLength(2); // labor/overhead ABSENT — the rates are 0

    // The produced batch: number = order number, expiry = 2026-03-03 + 2d,
    // produced-by provenance, ACTIVE (the QC gate is off on this chain).
    const batch = await withTenant(TENANT_M, () => inventoryStore.findBatchById(chain.doughBatchId));
    expect(batch).toBeDefined();
    expect(batch!.batchNo).toBe(chain.doughOrder.orderNo);
    expect(batch!.expiryDate).toBe("2026-03-05");
    expect(batch!.productionOrderId).toBe(chain.doughOrder.id);
    expect(batch!.status).toBe("ACTIVE");

    // The FG receipt move: 950 into M-RAW at unit 8.875000 = 8431.2500.
    const receiptMoves = (await movesFor("production_order", chain.doughOrder.id)).filter(
      (move) => move.direction === "IN",
    );
    expect(receiptMoves).toHaveLength(1);
    expect(receiptMoves[0]!.qty).toBe("950.000000");
    expect(receiptMoves[0]!.unitCost).toBe("8.875000");
    expect(receiptMoves[0]!.valueAmount).toBe("8431.2500");
    expect(receiptMoves[0]!.batchId).toBe(chain.doughBatchId);
    // Dough WAC at M-RAW is the produced unit cost (single-lot receipt) —
    // pinned at the pristine post-chain snapshot (shared-suite discipline).
    expect(fixture.chain.chainBalances.doughRaw.avgCost).toBe("8.875000");

    // Order stamps: the completion summary recomputed off the row.
    expect(chain.doughOrder.status).toBe("COMPLETED");
    expect(chain.doughOrder.fgValue).toBe("8431.2500");
    expect(chain.doughOrder.wipCreditValue).toBe("8431.2500");
    expect(chain.doughOrder.laborValue).toBe("0.0000");
    expect(chain.doughOrder.overheadValue).toBe("0.0000");
    expect(chain.doughOrder.fgJournalId).toBe(chain.doughCompleteJournalId);
    expect(chain.doughOrder.fgBatchId).toBe(chain.doughBatchId);
  });

  it("J4 — bread consumption EXACTLY: DR WIP 8554.6875 · CR INVENTORY 8554.6875; slices dough 937.5 @ 8.875 (the produced batch) + packaging 234.375 @ 1", async () => {
    const chain = fixture.chain;
    expect(await withTenant(TENANT_M, () => journalLinesOf(chain.breadConsumeJournalId))).toEqual([
      { accountId: fixture.gl.wip, direction: "DEBIT", amount: "8554.6875" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "8554.6875" },
    ]);
    const consumptions = await withTenant(TENANT_M, () =>
      mfgStore.listProductionConsumptions(chain.breadOrder.id),
    );
    expect(consumptions).toHaveLength(2);
    const doughRow = consumptions.find((row) => row.itemId === fixture.items.dough)!;
    const packRow = consumptions.find((row) => row.itemId === fixture.items.pack)!;
    // The genealogy edge: the dough slice consumed the PRODUCED batch.
    expect(doughRow.batchId).toBe(chain.doughBatchId);
    expect(doughRow.qty).toBe("937.500000");
    expect(doughRow.unitCost).toBe("8.875000");
    expect(doughRow.value).toBe("8320.3125");
    expect(packRow.batchId).toBe(chain.packagingBatchId);
    expect(packRow.qty).toBe("234.375000");
    expect(packRow.unitCost).toBe("1.000000");
    expect(packRow.value).toBe("234.3750");
    expect(consumptions.every((row) => row.journalId === chain.breadConsumeJournalId)).toBe(true);
  });

  it("J5 — bread completion EXACTLY (the multi-credit journal): DR INVENTORY 9117.1875 · CR WIP 8554.6875 · CR LABOR 375.0000 · CR OVERHEAD 187.5000, in order; balanced; bread @ 12.156250", async () => {
    const chain = fixture.chain;
    const lines = await withTenant(TENANT_M, () => journal.listLines(chain.breadCompleteJournalId));
    expect(
      lines.map((line) => ({
        accountId: line.accountId,
        direction: line.direction as "DEBIT" | "CREDIT",
        amount: line.amount,
      })),
    ).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "9117.1875" },
      { accountId: fixture.gl.wip, direction: "CREDIT", amount: "8554.6875" },
      { accountId: fixture.gl.productionLabor, direction: "CREDIT", amount: "375.0000" },
      { accountId: fixture.gl.productionOverhead, direction: "CREDIT", amount: "187.5000" },
    ]);
    // INV-001/002 balanced — engine-enforced; assert doc + base amounts equal
    // (SAR base, rate 1: baseAmount mirrors amount line-for-line).
    const debit = lines
      .filter((line) => line.direction === "DEBIT")
      .reduce((sum, line) => sum + Number(line.amount), 0);
    const credit = lines
      .filter((line) => line.direction === "CREDIT")
      .reduce((sum, line) => sum + Number(line.amount), 0);
    expect(debit.toFixed(4)).toBe(credit.toFixed(4));
    expect(lines.every((line) => line.baseAmount === line.amount)).toBe(true);

    // The produced bread batch: unit cost 12.156250 (9117.1875 / 750),
    // expiry 2026-03-05 + 5d, produced-by provenance.
    const batch = await withTenant(TENANT_M, () => inventoryStore.findBatchById(chain.breadBatchId));
    expect(batch!.batchNo).toBe(chain.breadOrder.orderNo);
    expect(batch!.expiryDate).toBe("2026-03-10");
    expect(batch!.productionOrderId).toBe(chain.breadOrder.id);
    const receiptMoves = (await movesFor("production_order", chain.breadOrder.id)).filter(
      (move) => move.direction === "IN",
    );
    expect(receiptMoves).toHaveLength(1);
    expect(receiptMoves[0]!.qty).toBe("750.000000");
    expect(receiptMoves[0]!.unitCost).toBe("12.156250");
    expect(receiptMoves[0]!.valueAmount).toBe("9117.1875");
    expect(fixture.chain.chainBalances.breadFg.avgCost).toBe("12.156250");

    // Order stamps — the full cost breakdown on the row.
    expect(chain.breadOrder.fgValue).toBe("9117.1875");
    expect(chain.breadOrder.wipCreditValue).toBe("8554.6875");
    expect(chain.breadOrder.laborValue).toBe("375.0000");
    expect(chain.breadOrder.overheadValue).toBe("187.5000");
    expect(chain.breadOrder.actualQty).toBe("750.000000");
  });

  it("WIP nets to EXACTLY zero per order — sumOrderWip 0.0000 and the chain's WIP journal legs net to 0", async () => {
    const chain = fixture.chain;
    expect(await withTenant(TENANT_M, () => mfgStore.sumOrderWip(chain.doughOrder.id))).toBe("0.0000");
    expect(await withTenant(TENANT_M, () => mfgStore.sumOrderWip(chain.breadOrder.id))).toBe("0.0000");
    // The WIP-purpose account (1160) over the five chain journals: DR 8875 +
    // 8554.6875 (consumptions) − CR 443.75 (scrap) − CR 8431.25 − CR
    // 8554.6875 (completions) = EXACTLY 0 (scoped to the chain's entries —
    // the shared tenant may carry other in-flight orders' WIP).
    const chainJournals = [
      chain.doughConsumeJournalId,
      chain.doughScrapJournalId,
      chain.doughCompleteJournalId,
      chain.breadConsumeJournalId,
      chain.breadCompleteJournalId,
    ];
    expect(await glBalanceOfEntries(fixture.gl.wip, chainJournals)).toBe("0.0000");
  });

  it("stock on-hands after the chain + the sale (the pristine §8 snapshot): dough 12.5, packaging 765.625, flour 1362.5, yeast 875, bread 650 @ 12.15625; the sale's COGS 1215.6250 exact", async () => {
    const chain = fixture.chain;
    // Captured inside setupMfgFixture the moment the chain completed — the
    // exact §8 absolutes (later packs in the shared suite draw from the same
    // pools, so live reads would be order-dependent; the moves test below
    // pins the chain's own ledger independently).
    expect(chain.chainBalances.doughRaw).toEqual({ qty: "12.500000", avgCost: "8.875000" });
    expect(chain.chainBalances.packRaw).toEqual({ qty: "765.625000", avgCost: "1.000000" });
    expect(chain.chainBalances.flourRaw).toEqual({ qty: "1362.500000", avgCost: "10.000000" });
    expect(chain.chainBalances.yeastRaw).toEqual({ qty: "875.000000", avgCost: "20.000000" });
    // Bread in M-FG: 750 produced − 100 sold = 650, WAC unchanged by the issue.
    expect(chain.chainBalances.breadFg).toEqual({ qty: "650.000000", avgCost: "12.156250" });

    // The sale's COGS journal EXACTLY: 100 × 12.15625 = 1215.6250.
    expect(chain.saleCogsJournalId).not.toBeNull();
    expect(await withTenant(TENANT_M, () => journalLinesOf(chain.saleCogsJournalId!))).toEqual([
      { accountId: fixture.gl.cogs, direction: "DEBIT", amount: "1215.6250" },
      { accountId: fixture.gl.inventory, direction: "CREDIT", amount: "1215.6250" },
    ]);
    const saleMoves = await movesFor("sales_invoice", chain.saleInvoiceId);
    expect(saleMoves).toHaveLength(1);
    expect(saleMoves[0]!.qty).toBe("100.000000");
    expect(saleMoves[0]!.unitCost).toBe("12.156250");
    expect(saleMoves[0]!.valueAmount).toBe("1215.6250");
    expect(saleMoves[0]!.batchId).toBe(chain.breadBatchId);
  });

  it("L5 expiry override — fg_batch_expiry_from_shelf_life OFF leaves the FG batch expiry NULL (ON derives completedAt + shelf life)", async () => {
    // A small non-expiry-tracked FG item that CARRIES a shelf life: the policy
    // decides whether the produced batch gets completedAt + shelf_life_days.
    const itemId = await withTenant(TENANT_M, async () => {
      const itemsStore = await import("../../modules/items/infrastructure/items.store");
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      const existing = await itemsStore.findItemBySku("M-BASIC");
      if (existing !== undefined) return existing.id;
      const created = await itemsStore.insertItem({
        sku: "M-BASIC",
        name: "Basic mix (spec)",
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: true,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        shelfLifeDays: 7,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
      return created.id;
    });
    await withTenant(TENANT_M, async () => {
      const active = await mfgStore.findActiveBom(itemId);
      if (active === undefined) {
        const draft = await boms.create({
          itemId,
          outputUomId: (await mfgStore.findItemForProduction(itemId))!.baseUomId,
          yieldPct: "100.0000",
          note: "M-BASIC v1 (costing spec)",
          noteAr: null,
          actorId: M_ACTOR,
          lines: [{ componentItemId: fixture.items.flour, qtyPerOutput: "0.050000", scrapPct: "0" }],
        });
        await boms.activate(draft.id, { effectiveFrom: "2026-01-05", actorId: M_ACTOR });
      }
    });

    const runOrder = async (completedAt: string) =>
      withTenant(TENANT_M, async () => {
        const created = await orders.create({
          branchId: fixture.branchId,
          itemId,
          bomId: null,
          plannedQty: "20",
          plannedDate: null,
          materialsWarehouseId: fixture.warehouseRaw,
          fgWarehouseId: fixture.warehouseFg,
          laborRate: "0",
          overheadRate: "0",
          costCenterId: null,
          note: null,
          noteAr: null,
          actorId: M_ACTOR,
        });
        await orders.release(created.id, M_ACTOR);
        await orders.start(created.id, M_ACTOR);
        await orders.consume(created.id, {
          lines: [{ itemId: fixture.items.flour, qty: "1", batchId: null }],
          consumedAt: "2026-03-07",
          note: null,
          noteAr: null,
          actorId: M_ACTOR,
        });
        return orders.complete(created.id, { actualQty: "20", batchNo: null, completedAt, actorId: M_ACTOR });
      });

    try {
      await setMfgSetting("manufacturing.fg_batch_expiry_from_shelf_life", false);
      const policyOff = await runOrder("2026-03-08");
      expect(policyOff.batchId).not.toBeNull();
      const offBatch = await withTenant(TENANT_M, () =>
        inventoryStore.findBatchById(policyOff.batchId!),
      );
      expect(offBatch!.expiryDate).toBeNull(); // policy off — no derivation

      // Control (policy back ON): the same item derives completedAt + 7d.
      await clearMfgSetting("manufacturing.fg_batch_expiry_from_shelf_life");
      const policyOn = await runOrder("2026-03-09");
      const onBatch = await withTenant(TENANT_M, () =>
        inventoryStore.findBatchById(policyOn.batchId!),
      );
      expect(onBatch!.expiryDate).toBe("2026-03-16");
    } finally {
      await clearMfgSetting("manufacturing.fg_batch_expiry_from_shelf_life");
    }
  });

  it("stock moves — every chain move is journal-linked and sourced production_order", async () => {
    const chain = fixture.chain;
    for (const order of [chain.doughOrder, chain.breadOrder]) {
      const moves = await movesFor("production_order", order.id);
      expect(moves.length).toBe(3); // 2 consume slices OUT + 1 FG receipt IN
      expect(moves.every((move) => move.sourceType === "production_order")).toBe(true);
      expect(moves.every((move) => move.postedJournalId !== null)).toBe(true);
      expect(moves.filter((move) => move.direction === "OUT")).toHaveLength(2);
      expect(moves.filter((move) => move.direction === "IN")).toHaveLength(1);
    }
    // And the March period stayed open (no pack here locks it — order
    // independence for the later specs).
    const march = await withTenant(TENANT_M, () => periodStore.findPeriodForDate("2026-03-02"));
    expect(march!.status).toBe("OPEN");
  });
});
