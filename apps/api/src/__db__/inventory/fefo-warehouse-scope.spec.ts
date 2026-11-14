import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as store from "../../modules/inventory/infrastructure/inventory.store";
import {
  I_ACTOR,
  TENANT_I,
  ensureInventoryItem,
  setupInventoryFixture,
  stock,
  tracking,
  type InventoryFixture,
} from "./fixtures";

/**
 * THE FEFO WAREHOUSE-SCOPE REGRESSION (the 045/043 joint review round,
 * 2026-11-15 — the independent review's finding on a88a898): FEFO batch
 * selection was computed on the ITEM'S TOTAL BALANCE ACROSS WAREHOUSES,
 * not on the ISSUING WAREHOUSE'S OWN STOCK.
 *
 * The defect (the reviewer's reproduction): the issuing warehouse holds
 * 10 units of a local batch, ANOTHER warehouse holds 5 units of an
 * EARLIER-EXPIRING batch of the same item. An issue of 10 at the
 * issuing warehouse planned its slices from the cross-warehouse FEFO
 * list — the foreign, earlier-expiring batch ranked FIRST — so the
 * plan either DIED at the bin allocation (BinContentsShortError: the
 * foreign batch has NO bin rows at the issuing warehouse) or, in the
 * binless legacy mode, RECORDED stock_moves at the issuing warehouse
 * AGAINST A BATCH THAT DOES NOT EXIST THERE. This is exactly why
 * mto-lifecycle failed inside the full bundle while passing standalone
 * (the bundle's shared DB carries earlier runs' batches of the fixed
 * SKU items at the sister warehouse; standalone's fresh DB does not).
 *
 * THE FIXED LAW (BR-017 read warehouse-locally): batch selection —
 * FEFO auto-pick AND the explicit-batch on-hand bound — is computed on
 * the ISSUING WAREHOUSE'S OWN ledger fold (Σ IN − Σ OUT of
 * stock_moves AT that warehouse), never on the item's cross-warehouse
 * total. A batch with no local stock is never picked, never counted,
 * and never written.
 */

let fixture: InventoryFixture;
let seq = 0;

function stamp(label: string): string {
  seq += 1;
  return `${label}-${Date.now() % 100000}-${seq}`;
}

async function receive(
  itemId: string,
  warehouseId: string,
  qty: string,
  batchNo: string,
  expiry: string,
): Promise<void> {
  await withTenant(TENANT_I, () =>
    stock.manualReceipt({
      itemId,
      warehouseId,
      qty,
      unitCost: "2.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-01-05",
      batchNo,
      batchExpiry: expiry,
      actorId: I_ACTOR,
    }),
  );
}

beforeAll(async () => {
  fixture = await setupInventoryFixture();
});

describe("FEFO batch selection is computed on the ISSUING WAREHOUSE's stock, never the cross-warehouse balance", () => {
  it("THE CROSS-WAREHOUSE TRAP: 10 local (later expiry) + 5 in another warehouse (earlier expiry) — an issue of 10 at the local warehouse takes ALL 10 from the LOCAL batch (no BinContentsShortError, no move recorded against the foreign batch)", async () => {
    // A DEDICATED item (the surplus-spec per-scenario isolation law —
    // the fixed-SKU items are exactly what made the bundle flaky).
    const item = await ensureInventoryItem(
      stamp("INV-FEFO-XWH"),
      "FEFO warehouse-scope probe item",
      { trackBatch: true, hasExpiry: true },
    );

    // 10 units of the LOCAL batch at the ISSUING warehouse — the LATER
    // expiry (2027-12-31).
    const localBatchNo = stamp("F-LOCAL");
    await receive(item, fixture.warehouseMain, "10", localBatchNo, "2027-12-31");
    // 5 units of the FOREIGN batch at the SISTER warehouse — the
    // EARLIER expiry (2026-06-30): the cross-warehouse FEFO list ranks
    // it FIRST (BR-017's earliest-expiry order).
    const foreignBatchNo = stamp("F-FOREIGN");
    await receive(item, fixture.warehouseSecond, "5", foreignBatchNo, "2026-06-30");

    // The issue under test: 10 (exactly the LOCAL stock) at the MAIN
    // warehouse, no explicit batch. Pre-fix the plan died with
    // BIN_CONTENTS_SHORT (the 5-unit foreign slice found no bins at
    // the main warehouse); post-fix it resolves entirely from the
    // local batch.
    const issue = await withTenant(TENANT_I, () =>
      stock.manualIssue({
        itemId: item,
        warehouseId: fixture.warehouseMain,
        qty: "10",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-01-15",
        actorId: I_ACTOR,
      }),
    );
    expect(issue.moveId).toBeDefined();

    // THE SLICE PROOF: every OUT move AT THE ISSUING WAREHOUSE
    // references the LOCAL batch — never the foreign one (the
    // "no issue recorded against a batch that does not exist locally"
    // arm of the law; the binless mode's failure was exactly this).
    const mainMoves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ warehouseId: fixture.warehouseMain, itemId: item, limit: 50 }),
    );
    const mainOuts = mainMoves.filter((move) => move.direction === "OUT");
    expect(mainOuts.length).toBeGreaterThan(0);
    expect(
      mainOuts.reduce((sum, move) => sum + Number(move.qty), 0),
    ).toBe(10);
    for (const move of mainOuts) {
      expect(move.batchNo).toBe(localBatchNo);
    }
    expect(mainMoves.some((move) => move.batchNo === foreignBatchNo)).toBe(false);

    // The batch balances: the LOCAL batch is exhausted, the FOREIGN
    // batch keeps its 5 — untouched at its own warehouse.
    const batches = await withTenant(TENANT_I, () =>
      tracking.listBatches({ itemId: item, limit: 10 }),
    );
    const local = batches.find((batch) => batch.batchNo === localBatchNo)!;
    const foreign = batches.find((batch) => batch.batchNo === foreignBatchNo)!;
    expect(await withTenant(TENANT_I, () => store.batchOnHand(local.id))).toBe("0.000000");
    expect(await withTenant(TENANT_I, () => store.batchOnHand(foreign.id))).toBe("5.000000");
    // The warehouse-scoped view: the foreign batch has ZERO at the
    // issuing warehouse (the fixed fold), the local batch zero after
    // the issue.
    expect(
      await withTenant(TENANT_I, () => store.batchOnHand(foreign.id, fixture.warehouseMain)),
    ).toBe("0.000000");
    expect(
      await withTenant(TENANT_I, () => store.batchOnHand(local.id, fixture.warehouseMain)),
    ).toBe("0.000000");
    // The sister warehouse still holds the foreign 5.
    expect(
      await withTenant(TENANT_I, () => store.batchOnHand(foreign.id, fixture.warehouseSecond)),
    ).toBe("5.000000");
  });

  it("THE EXPLICIT-BATCH BOUND IS WAREHOUSE-LOCAL TOO: naming the foreign batch (5 across warehouses, 0 at the issuing one) is the typed BATCH_INSUFFICIENT_STOCK — never a cross-warehouse issue", async () => {
    const item = await ensureInventoryItem(
      stamp("INV-FEFO-XWH"),
      "FEFO warehouse-scope probe item",
      { trackBatch: true, hasExpiry: true },
    );
    const localBatchNo = stamp("F-LOCAL");
    const foreignBatchNo = stamp("F-FOREIGN");
    await receive(item, fixture.warehouseMain, "10", localBatchNo, "2027-12-31");
    await receive(item, fixture.warehouseSecond, "5", foreignBatchNo, "2026-06-30");
    const batches = await withTenant(TENANT_I, () =>
      tracking.listBatches({ itemId: item, limit: 10 }),
    );
    const foreign = batches.find((batch) => batch.batchNo === foreignBatchNo)!;

    // 3 ≤ the foreign batch's CROSS-WAREHOUSE total (5) — pre-fix the
    // on-hand bound passed and the issue planned a slice from a batch
    // with NO local stock (the BinContentsShortError / the foreign
    // move record). Post-fix the bound is the LOCAL fold: 0 at the
    // issuing warehouse → the typed rejection.
    await expect(
      withTenant(TENANT_I, () =>
        stock.manualIssue({
          itemId: item,
          warehouseId: fixture.warehouseMain,
          qty: "3",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-01-16",
          batchId: foreign.id,
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_INSUFFICIENT_STOCK" });

    // And nothing was written at the issuing warehouse for the foreign
    // batch (the typed rejection leaves zero residue).
    const mainMoves = await withTenant(TENANT_I, () =>
      store.listStockMoves({ warehouseId: fixture.warehouseMain, itemId: item, limit: 50 }),
    );
    expect(mainMoves.some((move) => move.batchNo === foreignBatchNo)).toBe(false);

    // The expiry write-off rides the same warehouse-local bound: a
    // write-off of the foreign batch AT THE MAIN WAREHOUSE (where it
    // has nothing — 0 in the warehouse-scoped fold) is the typed
    // rejection; the 5 at the sister warehouse stay on the books for
    // THEIR own disposition.
    await expect(
      withTenant(TENANT_I, () =>
        tracking.writeOffExpiredBatch({
          batchId: foreign.id,
          warehouseId: fixture.warehouseMain,
          valueDate: "2026-07-01",
          actorId: I_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_INSUFFICIENT_STOCK" });
  });
});
