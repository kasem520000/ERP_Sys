import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as inventoryStore from "../../modules/inventory/infrastructure/inventory.store";
import * as mfgStore from "../../modules/manufacturing/infrastructure/manufacturing.store";
import {
  StandardCostInvalidError,
  StandardCostMissingError,
} from "../../modules/manufacturing/domain/manufacturing-errors";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  goodsReceipts,
  mfgAppClient,
  orders,
  routingsSrv,
  setupMfgFixture,
  standardCosts,
  stock,
  workCenters,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-042 T-15 (L2-12/M-19 + the PPV-at-receipt hook) — the standard
 * costing evidence: MANUAL drafts (the total is the typed sum, never a
 * fourth number), the one-ACTIVE-per-item activation (v2 archives v1), the
 * ck_item_standard_costs_total CHECK floor, the BOM+routing ROLL-UP (exact
 * material/labor/overhead strings, the fail-closed missing-component guard),
 * the release-time std_unit_cost stamp (+ NULL in the dual mode), the
 * order-level yield variance, PPV AT RECEIPT (standard items plan at the
 * standard total with the variance leg on the same G-07 journal; DR when
 * the receipt cost more, CR when less; non-standard items keep the legacy
 * WAC shape byte-identical), and the stock REVALUATION on activation (the
 * exact journal; the no-stock no-op).
 *
 * Spec-owned items (M-STD-*) — never the §8 chain. The GRN items are
 * deliberately untracked (a tracked item requires a batch on receive).
 */

let fixture: MfgFixture;
let grniAccountId = "";
const TODAY = () => new Date().toISOString().slice(0, 10);
const items: Record<"component" | "parent" | "plain" | "ppv" | "reval" | "revalEmpty" | "missingParent" | "missing", string> = {
  component: "",
  parent: "",
  plain: "",
  ppv: "",
  reval: "",
  revalEmpty: "",
  missingParent: "",
  missing: "",
};
let routingId = "";

beforeAll(async () => {
  fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    // The GRNI purpose (the purchasing fixture's explicit map — tenant M's
    // belt-and-braces does not include it and the PPV receipts need it).
    const { findAccountByCode, findActivePurpose } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const { insertAccountPurpose } = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const existingGrni = await findActivePurpose("GRNI");
    if (existingGrni === undefined) {
      const account = await findAccountByCode("2130");
      if (account === undefined) throw new Error("fixture account 2130 (GRNI) missing");
      await insertAccountPurpose({ purposeKey: "GRNI", accountId: account.id, activeFrom: "2025-12-01" });
      grniAccountId = account.id;
    } else {
      grniAccountId = existingGrni.accountId;
    }

    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, trackBatch: boolean) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      return (
        await itemsStore.insertItem({
          sku,
          name: `${sku} (standard-costing spec)`,
          nameAr: null,
          kind: "STOCK",
          uomId: pcs.id,
          categoryId: null,
          taxCodeId: null,
          costingMethod: "WAC",
          trackBatch,
          trackSerial: false,
          trackImei: false,
          hasExpiry: trackBatch,
          shelfLifeDays: trackBatch ? 30 : null,
          reorderLevel: null,
          reorderQty: null,
          basePrice: null,
        })
      ).id;
    };
    items.component = await ensureItem("M-STD-C", true);
    items.parent = await ensureItem("M-STD-P", true);
    items.plain = await ensureItem("M-STD-N", false);
    items.ppv = await ensureItem("M-STD-PPV", false);
    items.reval = await ensureItem("M-STD-R", true);
    items.revalEmpty = await ensureItem("M-STD-R2", true);
    items.missingParent = await ensureItem("M-STD-X2", true);
    items.missing = await ensureItem("M-STD-X", true);

    // Every order-capable item that is NOT the roll-up parent gets a tiny
    // flour recipe (release requires an ACTIVE BOM; the yield-variance
    // order on the PARENT consumes its planned COMPONENT below).
    const ensureFlourBom = async (itemId: string, sku: string) => {
      if ((await mfgStore.findActiveBom(itemId)) !== undefined) return;
      const draft = await boms.create({
        itemId,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: `${sku} v1 (standard-costing spec)`,
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: fixture.items.flour, qtyPerOutput: "0.010000", scrapPct: "0" }],
      });
      await boms.activate(draft.id, { effectiveFrom: "2026-01-05", actorId: M_ACTOR });
    };
    for (const [key, sku] of [
      ["plain", "M-STD-N"],
      ["reval", "M-STD-R"],
      ["revalEmpty", "M-STD-R2"],
    ] as const) {
      await ensureFlourBom(items[key], sku);
    }

    // The roll-up substrate: parent ← component (2 per output, 10% scrap,
    // 80% yield) — gross = 2 × 1.1 ÷ 0.8 = 2.75 per unit (the parent's ONLY
    // BOM — its orders plan the component).
    if ((await mfgStore.findActiveBom(items.parent))?.note !== "M-STD-P roll-up BOM v1") {
      const draft = await boms.create({
        itemId: items.parent,
        outputUomId: pcs.id,
        yieldPct: "80.0000",
        note: "M-STD-P roll-up BOM v1",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: items.component, qtyPerOutput: "2.000000", scrapPct: "10.0000" }],
      });
      await boms.activate(draft.id, { effectiveFrom: "2026-01-05", actorId: M_ACTOR });
    }
    // The fail-closed BOM: one standard component + one standard-less.
    if ((await mfgStore.findActiveBom(items.missingParent))?.note !== "M-STD-X2 missing-standard BOM v1") {
      const draft = await boms.create({
        itemId: items.missingParent,
        outputUomId: pcs.id,
        yieldPct: "100.0000",
        note: "M-STD-X2 missing-standard BOM v1",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [
          { componentItemId: items.component, qtyPerOutput: "1.000000", scrapPct: "0" },
          { componentItemId: items.missing, qtyPerOutput: "1.000000", scrapPct: "0" },
        ],
      });
      await boms.activate(draft.id, { effectiveFrom: "2026-01-05", actorId: M_ACTOR });
    }

    // The roll-up routing on the parent: one op, overrides fixed 10 / var 20
    // (per-unit time = setup 0.5 + run 1.0 = 1.5h).
    const centers = await workCenters.list({ limit: 50 });
    const center =
      centers.find((row) => row.code === "M-STD-CNV") ??
      (await workCenters.create({
        code: "M-STD-CNV",
        name: "Standard-costing spec center",
        nameAr: null,
        description: null,
        capacityPerShift: "8",
        shiftsPerDay: 1,
        fixedCostRate: "0",
        varCostRate: "0",
        costCenterId: null,
        actorId: M_ACTOR,
      }));
    if ((await mfgStore.findActiveRouting(items.parent)) === undefined) {
      const draft = await routingsSrv.createDraft({
        itemId: items.parent,
        outputUomId: pcs.id,
        note: "M-STD-P routing v1",
        noteAr: null,
        actorId: M_ACTOR,
        operations: [
          {
            sequence: 10,
            workCenterId: center.id,
            setupTime: "0.500000",
            runTime: "1.000000",
            fixedCostRate: "10.000000",
            varCostRate: "20.000000",
            description: "Convert",
            descriptionAr: null,
          },
        ],
      });
      routingId = (await routingsSrv.activate(draft.id, { actorId: M_ACTOR })).id;
    } else {
      routingId = (await mfgStore.findActiveRouting(items.parent))!.id;
    }

    // The component's ACTIVE manual standard: total 10.000000 — and the
    // component stock the parent's orders consume (one batch, FEFO trivial).
    if ((await standardCosts.getActive(items.component)) === null) {
      const draft = await standardCosts.createDraft({
        itemId: items.component,
        materialCost: "10",
        laborCost: "0",
        overheadCost: "0",
        overheadSubSplits: null,
        effectiveFrom: null,
        note: "component standard v1",
        noteAr: null,
        actorId: M_ACTOR,
      });
      await standardCosts.activate(draft.id, { actorId: M_ACTOR });
    }
    const componentStock = await inventoryStore.findItemStock(items.component, fixture.warehouseRaw);
    if (componentStock === undefined || componentStock.qty === "0.000000") {
      await stock.manualReceipt({
        itemId: items.component,
        warehouseId: fixture.warehouseRaw,
        qty: "100",
        unitCost: "10.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: TODAY(),
        batchNo: "M-STD-C1",
        batchExpiry: "2027-06-30",
        actorId: M_ACTOR,
      });
    }
  });
});

// -- helpers ---------------------------------------------------------------------

interface Line {
  accountId: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
}

async function journalLinesOf(entryId: string): Promise<Line[]> {
  const lines = await withTenant(TENANT_M, () => journal.listLines(entryId));
  return lines.map((line) => ({
    accountId: line.accountId,
    direction: line.direction as "DEBIT" | "CREDIT",
    amount: line.amount,
  }));
}

/** A PO-less GRN (the M fixture's supplier) + its posting. */
async function postedGrn(itemId: string, qty: string, unitCost: string) {
  const grn = await withTenant(TENANT_M, () =>
    goodsReceipts.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      poId: null,
      warehouseId: fixture.warehouseRaw,
      receiptDate: TODAY(),
      poLessReason: "standard-costing spec direct receipt",
      note: null,
      noteAr: null,
      actorId: M_ACTOR,
      lines: [
        {
          poLineId: null,
          itemId,
          qty,
          unitCost,
          accountId: null,
          batchNo: null,
          batchExpiry: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  return withTenant(TENANT_M, () => goodsReceipts.post(grn.id, M_ACTOR));
}

function createOrder(itemId: string, plannedQty: string) {
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
      note: "standard-costing spec order",
      noteAr: null,
      actorId: M_ACTOR,
    }),
  );
}

// -- the packs --------------------------------------------------------------------

describe("PHASE-042 · standard costing (manual + roll-up + activation + PPV + revaluation)", () => {
  it("a MANUAL draft carries the typed sum as its total — and the overhead sub-splits must decompose the overhead exactly", async () => {
    const draft = await withTenant(TENANT_M, () =>
      standardCosts.createDraft({
        itemId: items.plain,
        materialCost: "10",
        laborCost: "3",
        overheadCost: "2",
        overheadSubSplits: [
          { key: "power", amount: "1.5" },
          { key: "depreciation", amount: "0.5" },
        ],
        effectiveFrom: null,
        note: "manual v1",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    expect(draft.status).toBe("DRAFT");
    expect(draft.source).toBe("MANUAL");
    expect(draft.totalCost).toBe("15.000000"); // never a hand-typed fourth number
    expect(draft.overheadSubSplits).toEqual([
      { key: "power", amount: "1.500000" },
      { key: "depreciation", amount: "0.500000" },
    ]);
    // Sub-splits off the overhead are the typed rejection.
    await expect(
      withTenant(TENANT_M, () =>
        standardCosts.createDraft({
          itemId: items.plain,
          materialCost: "10",
          laborCost: "3",
          overheadCost: "2",
          overheadSubSplits: [{ key: "power", amount: "1" }],
          effectiveFrom: null,
          note: null,
          noteAr: null,
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(StandardCostInvalidError);
  });

  it("activation keeps ONE ACTIVE per item — activating v2 archives v1 in the same call", async () => {
    const v1 = await withTenant(TENANT_M, () =>
      standardCosts.createDraft({
        itemId: items.ppv,
        materialCost: "10",
        laborCost: "0",
        overheadCost: "0",
        overheadSubSplits: null,
        effectiveFrom: null,
        note: "ppv standard v1",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    const activeV1 = await withTenant(TENANT_M, () =>
      standardCosts.activate(v1.id, { actorId: M_ACTOR }),
    );
    expect(activeV1.standard.status).toBe("ACTIVE");
    const v2 = await withTenant(TENANT_M, () =>
      standardCosts.createDraft({
        itemId: items.ppv,
        materialCost: "10",
        laborCost: "0",
        overheadCost: "0",
        overheadSubSplits: null,
        effectiveFrom: null,
        note: "ppv standard v2",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    const activeV2 = await withTenant(TENANT_M, () =>
      standardCosts.activate(v2.id, { actorId: M_ACTOR }),
    );
    expect(activeV2.standard.status).toBe("ACTIVE");
    const archivedV1 = await withTenant(TENANT_M, () => standardCosts.find(v1.id));
    expect(archivedV1.status).toBe("ARCHIVED");
    expect(archivedV1.archivedAt).not.toBeNull();
    const active = await withTenant(TENANT_M, () => standardCosts.getActive(items.ppv));
    expect(active!.id).toBe(v2.id);
    expect(active!.versionNo).toBe(v2.versionNo);
    expect(v2.versionNo).toBe(v1.versionNo + 1);
  });

  it("the ck_item_standard_costs_total CHECK floor — a raw insert whose total is not the typed sum is 23514", async () => {
    const client = await mfgAppClient();
    let code = "";
    try {
      await client.query(
        `INSERT INTO item_standard_costs
           (id, tenant_id, item_id, version_no, status, material_cost, labor_cost,
            overhead_cost, total_cost, overhead_sub_splits, source)
         VALUES (gen_random_uuid(), erp.current_tenant_id(), $1, 99, 'DRAFT',
                 10, 3, 2, 16, '[]'::jsonb, 'MANUAL')`,
        [items.plain],
      );
    } catch (error) {
      code = (error as { code?: string }).code ?? "";
    }
    await client.end();
    expect(code).toBe("23514");
  });

  it("rollUp explodes the ACTIVE BOM + routing EXACTLY — material = Σ gross × component total, labor/overhead = per-unit time × the overridden rates", async () => {
    const rolled = await withTenant(TENANT_M, () => standardCosts.rollUp(items.parent, { actorId: M_ACTOR }));
    // gross = 2 × (1 + 10/100) ÷ (80/100) = 2.75 → material 2.75 × 10.
    expect(rolled.materialCost).toBe("27.500000");
    // per-unit time = setup 0.5 + run 1.0 = 1.5h → labor 1.5 × 20, overhead 1.5 × 10.
    expect(rolled.laborCost).toBe("30.000000");
    expect(rolled.overheadCost).toBe("15.000000");
    expect(rolled.standard.totalCost).toBe("72.500000");
    expect(rolled.standard.source).toBe("ROLLED_UP");
    expect(rolled.standard.rolledUpAt).not.toBeNull();
    expect(rolled.standard.status).toBe("DRAFT");
    expect(routingId).not.toBe("");
  });

  it("a level-1 component without an ACTIVE standard fails closed naming the component (the low-level-code discipline)", async () => {
    const missingId = items.missing;
    await expect(withTenant(TENANT_M, () => standardCosts.rollUp(items.missingParent, { actorId: M_ACTOR })))
      .rejects.toBeInstanceOf(StandardCostMissingError);
    await expect(withTenant(TENANT_M, () => standardCosts.rollUp(items.missingParent, { actorId: M_ACTOR })))
      .rejects.toMatchObject({
        code: "STANDARD_COST_MISSING",
        details: { componentItemIds: [missingId] },
      });
  });

  it("release stamps std_unit_cost from the item's ACTIVE standard — and leaves it NULL when none exists (the dual mode)", async () => {
    // Activate the parent's rolled-up standard (the roll-up test's DRAFT).
    const activeParent = await withTenant(TENANT_M, () => standardCosts.getActive(items.parent));
    let totalCost = activeParent?.totalCost;
    if (activeParent === null) {
      const rolled = await withTenant(TENANT_M, () => standardCosts.rollUp(items.parent, { actorId: M_ACTOR }));
      const activated = await withTenant(TENANT_M, () =>
        standardCosts.activate(rolled.standard.id, { actorId: M_ACTOR }),
      );
      totalCost = activated.standard.totalCost;
    }
    expect(totalCost).toBe("72.500000");
    const standardized = await createOrder(items.parent, "100");
    const released = await withTenant(TENANT_M, () =>
      orders.release(standardized.id, M_ACTOR, { routingId: null }),
    );
    expect(released.stdUnitCost).toBe("72.500000");
    // The dual mode: an item with no ACTIVE standard keeps NULL.
    const plain = await createOrder(items.plain, "10");
    const releasedPlain = await withTenant(TENANT_M, () =>
      orders.release(plain.id, M_ACTOR, { routingId: null }),
    );
    expect(releasedPlain.stdUnitCost).toBeNull();
  });

  it("completion stamps yield_variance = (planned − actual) × std EXACTLY (positive = produced-less-than-planned = unfavorable)", async () => {
    const order = await createOrder(items.parent, "100");
    await withTenant(TENANT_M, () => orders.release(order.id, M_ACTOR, { routingId: null }));
    await withTenant(TENANT_M, () => orders.start(order.id, M_ACTOR));
    await withTenant(TENANT_M, () =>
      orders.consume(order.id, {
        lines: [{ itemId: items.component, qty: "1", batchId: null }],
        consumedAt: "2026-06-02",
        note: "standard-costing spec consumption",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    const done = await withTenant(TENANT_M, () =>
      orders.complete(order.id, {
        actualQty: "80",
        batchNo: null,
        completedAt: "2026-06-03",
        actorId: M_ACTOR,
      }),
    );
    // (100 − 80) × 72.500000 = 1450.0000 — unfavorable (less produced).
    expect(done.order.yieldVariance).toBe("1450.0000");
  });

  it("PPV AT RECEIPT (actual > standard) — the receipt journal carries inventory at STANDARD plus the DR PURCHASE_PRICE_VARIANCE leg for the delta, and the layers absorb at standard", async () => {
    // The PPV item's ACTIVE standard total is 10.000000 (v2 from the
    // activation test). Receive 100 @ 12 → inventory 1000, PPV +200, GRNI 1200.
    const posted = await postedGrn(items.ppv, "100", "12.000000");
    expect(posted.receipt.status).toBe("POSTED");
    expect(posted.journalEntryId).not.toBeNull();
    expect(await withTenant(TENANT_M, () => journalLinesOf(posted.journalEntryId!))).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "1000.0000" },
      { accountId: fixture.gl.purchasePriceVariance, direction: "DEBIT", amount: "200.0000" },
      { accountId: grniAccountId, direction: "CREDIT", amount: "1200.0000" },
    ]);
    // The WAC layers absorbed at the STANDARD (not the paid 12).
    const position = await withTenant(TENANT_M, () =>
      inventoryStore.findItemStock(items.ppv, fixture.warehouseRaw),
    );
    expect(position?.qty).toBe("100.000000");
    expect(position?.avgCost).toBe("10.000000");
  });

  it("PPV AT RECEIPT (actual < standard) — the variance leg flips to CREDIT for the delta", async () => {
    // Receive another 100 @ 9 → inventory still at standard 1000, GRNI 900,
    // the net variance −100 lands as CR PURCHASE_PRICE_VARIANCE.
    const posted = await postedGrn(items.ppv, "100", "9.000000");
    expect(await withTenant(TENANT_M, () => journalLinesOf(posted.journalEntryId!))).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "1000.0000" },
      { accountId: fixture.gl.purchasePriceVariance, direction: "CREDIT", amount: "100.0000" },
      { accountId: grniAccountId, direction: "CREDIT", amount: "900.0000" },
    ]);
  });

  it("a NON-standard item's receipt keeps the legacy shape byte-identical — two lines, no PPV leg, WAC at actual", async () => {
    const posted = await postedGrn(items.plain, "50", "2.000000");
    const lines = await withTenant(TENANT_M, () => journalLinesOf(posted.journalEntryId!));
    expect(lines).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "100.0000" },
      { accountId: grniAccountId, direction: "CREDIT", amount: "100.0000" },
    ]);
    expect(lines.some((line) => line.accountId === fixture.gl.purchasePriceVariance)).toBe(false);
    const position = await withTenant(TENANT_M, () =>
      inventoryStore.findItemStock(items.plain, fixture.warehouseRaw),
    );
    expect(position?.avgCost).toBe("2.000000"); // WAC at the ACTUAL cost
  });

  it("revaluation on activation — a higher standard over seeded stock posts DR inventory × (new − old) × qty / CR STANDARD_REVALUATION exactly", async () => {
    // v1 = 10 (activate over no stock — the first-activation no-op), then
    // seed 100 units, then activate v2 = 12 with revaluateStock.
    const v1 = await withTenant(TENANT_M, () =>
      standardCosts.createDraft({
        itemId: items.reval,
        materialCost: "10",
        laborCost: "0",
        overheadCost: "0",
        overheadSubSplits: null,
        effectiveFrom: null,
        note: "reval standard v1",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    const activatedV1 = await withTenant(TENANT_M, () =>
      standardCosts.activate(v1.id, { revaluateStock: true, actorId: M_ACTOR }),
    );
    expect(activatedV1.revaluationJournalId).toBeNull(); // first activation — nothing to revalue
    await withTenant(TENANT_M, () =>
      stock.manualReceipt({
        itemId: items.reval,
        warehouseId: fixture.warehouseRaw,
        qty: "100",
        unitCost: "10.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: TODAY(),
        batchNo: "M-STD-R1",
        batchExpiry: "2027-06-30",
        actorId: M_ACTOR,
      }),
    );
    const v2 = await withTenant(TENANT_M, () =>
      standardCosts.createDraft({
        itemId: items.reval,
        materialCost: "12",
        laborCost: "0",
        overheadCost: "0",
        overheadSubSplits: null,
        effectiveFrom: null,
        note: "reval standard v2",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    const activatedV2 = await withTenant(TENANT_M, () =>
      standardCosts.activate(v2.id, { revaluateStock: true, actorId: M_ACTOR }),
    );
    expect(activatedV2.revaluationJournalId).not.toBeNull();
    // (12 − 10) × 100 = 200.0000 up → DR inventory / CR STANDARD_REVALUATION.
    expect(await withTenant(TENANT_M, () => journalLinesOf(activatedV2.revaluationJournalId!))).toEqual([
      { accountId: fixture.gl.inventory, direction: "DEBIT", amount: "200.0000" },
      { accountId: fixture.gl.standardRevaluation, direction: "CREDIT", amount: "200.0000" },
    ]);
  });

  it("revaluation with NO stock is the documented no-op — no journal", async () => {
    const v1 = await withTenant(TENANT_M, () =>
      standardCosts.createDraft({
        itemId: items.revalEmpty,
        materialCost: "10",
        laborCost: "0",
        overheadCost: "0",
        overheadSubSplits: null,
        effectiveFrom: null,
        note: "reval-empty standard v1",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    await withTenant(TENANT_M, () => standardCosts.activate(v1.id, { actorId: M_ACTOR }));
    const v2 = await withTenant(TENANT_M, () =>
      standardCosts.createDraft({
        itemId: items.revalEmpty,
        materialCost: "12",
        laborCost: "0",
        overheadCost: "0",
        overheadSubSplits: null,
        effectiveFrom: null,
        note: "reval-empty standard v2",
        noteAr: null,
        actorId: M_ACTOR,
      }),
    );
    const activatedV2 = await withTenant(TENANT_M, () =>
      standardCosts.activate(v2.id, { revaluateStock: true, actorId: M_ACTOR }),
    );
    expect(activatedV2.revaluationJournalId).toBeNull(); // no stock ⇒ nothing participates
  });
});
