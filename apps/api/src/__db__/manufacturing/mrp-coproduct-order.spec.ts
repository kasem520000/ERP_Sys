import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as planning from "../../modules/manufacturing/infrastructure/planning.store";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  mpsSrv,
  mrpEngine,
  setupMfgFixture,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-043 audit round 2, item 4 — the CO-PRODUCT planning ORDER.
 *
 * The audit's finding (code-reading, reproduced here): the engine's
 * leveling knew only the BOM-component and substitution edges — a
 * CO-PRODUCT output carried NO leveling edge to its producer, so the
 * walk order between the main product and its co-product was decided
 * by LLC ties broken on the ITEM ID STRING:
 *   - a co-product WITHOUT its own BOM sits at LLC 0 — it ALWAYS
 *     planned BEFORE its producer (LLC ≥ 1), so its independent demand
 *     generated a full coverage suggestion (a purchase order) and the
 *     producer's make order then pushed the co-product supply INTO A
 *     WALK THAT HAD ALREADY FINISHED — double-planning the same goods;
 *   - a co-product WITH its own BOM sits at the SAME LLC as a
 *     single-level producer — the string tie-break decided, so the plan
 *     CHANGED with the items' id creation order (position-dependent
 *     correctness — the audit's id-swap).
 *
 * THE LAW (implemented + asserted): the leveling graph gains the
 * OUTPUT edge (producer → co-product): a co-product's planning always
 * nets AFTER every producer whose BOM outputs it — the inbound from
 * THIS RUN's production suggestions is counted BEFORE its own coverage
 * suggestion is issued, deterministically, in BOTH id orders. A
 * co-product with its own BOM and components is a full planning member
 * (a closure member since the item-2 fix): its demand beyond the
 * co-supply drives its own make order and its components' explosion —
 * never silently dropped, never over-planned.
 */

interface Pair {
  main: string;
  co: string;
  raw: string;
  craw: string;
}

const spec: {
  fixture?: MfgFixture;
  pairs?: { p1: Pair; p2: Pair; p3: Pair; p4: Pair; p5: Pair };
} = {};

async function ensureItem(sku: string, name: string): Promise<string> {
  const found = await itemsStore.findItemBySku(sku);
  if (found !== undefined) return found.id;
  const uoms = await itemsStore.listUoms();
  const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
  const created = await itemsStore.insertItem({
    sku,
    name,
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
    shelfLifeDays: 365,
    reorderLevel: null,
    reorderQty: null,
    basePrice: null,
  });
  return created.id;
}

async function setPolicy(itemId: string, leadTimeDays: number): Promise<void> {
  await itemsStore.updateItemPlanningPolicy(itemId, {
    leadTimeDays,
    safetyStockPolicy: "MANUAL",
    safetyStockQty: null,
    ssServiceLevelPct: null,
    ssLookbackDays: null,
    lotSizingRule: "LOT_FOR_LOT",
    fixedOrderQty: null,
    orderMultiple: null,
    periodSupplyBuckets: null,
    frozenFenceDays: 0,
    slushyFenceDays: 30,
  });
}

async function seedMps(itemId: string, bucketStart: string, qty: string): Promise<void> {
  await mpsSrv.upsert({
    warehouseId: spec.fixture!.warehouseFg,
    itemId,
    bucketStart,
    qty,
    uomId: (await itemsStore.findItemById(itemId))!.uomId,
    status: "PLANNED",
    reason: "Co-product order spec (the audit item-4 reproduction)",
    frozenEditPermission: true,
    actorId: M_ACTOR,
  });
}

/** The pair's BOMs + policies (the items are pre-created — the id
 * creation order is fixed by the caller, the audit's id-swap axis:
 * uuid v7 is time-ordered, so the FIRST-created id sorts FIRST). */
async function wirePair(input: { tag: string; coHasBom: boolean }): Promise<Pair> {
  const main = await ensureItem(`M-CP-${input.tag}-MAIN`, `Co-product order main ${input.tag}`);
  const co = await ensureItem(`M-CP-${input.tag}-CO`, `Co-product order co ${input.tag}`);
  const raw = await ensureItem(`M-CP-${input.tag}-RAW`, `Co-product order raw ${input.tag}`);
  const craw = await ensureItem(`M-CP-${input.tag}-CRAW`, `Co-product order co-raw ${input.tag}`);

  await setPolicy(main, 2);
  await setPolicy(raw, 3);
  if (input.coHasBom) await setPolicy(co, 3);

  // The producer's BOM: raw ×1 + the co-product output ×1 (the G-47
  // 60/40 joint-allocation discipline).
  const mainDraft = await boms.create({
    itemId: main,
    outputUomId: (await itemsStore.findItemById(main))!.uomId,
    yieldPct: "100.0000",
    mainAllocationPct: "60.0000",
    note: `Co-product order main BOM ${input.tag}`,
    noteAr: null,
    actorId: M_ACTOR,
    lines: [{ componentItemId: raw, qtyPerOutput: "1.000000", scrapPct: "0" }],
  });
  await boms.replaceOutputs(
    mainDraft.id,
    [
      {
        itemId: co,
        outputKind: "CO_PRODUCT",
        allocationPct: "40.0000",
        qtyPerOutput: "1.000000",
        uomId: (await itemsStore.findItemById(co))!.uomId,
        note: null,
      },
    ],
    M_ACTOR,
  );
  await boms.activate(mainDraft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });

  // The co-product's own BOM (craw ×1) when the scenario wants it.
  if (input.coHasBom) {
    const coDraft = await boms.create({
      itemId: co,
      outputUomId: (await itemsStore.findItemById(co))!.uomId,
      yieldPct: "100.0000",
      mainAllocationPct: "100.0000",
      note: `Co-product order co BOM ${input.tag}`,
      noteAr: null,
      actorId: M_ACTOR,
      lines: [{ componentItemId: craw, qtyPerOutput: "1.000000", scrapPct: "0" }],
    });
    await boms.activate(coDraft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
  }
  return { main, co, raw, craw };
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    // P1 — co WITHOUT its own BOM, the CO id created FIRST (co < main:
    // the string tie-break at LLC 0 puts the co-product's walk BEFORE
    // its producer's — the always-broken ordering pre-fix).
    await ensureItem("M-CP-P1-CO", "Co-product order co P1 (id-first)");
    await ensureItem("M-CP-P1-MAIN", "Co-product order main P1");
    await ensureItem("M-CP-P1-RAW", "Co-product order raw P1");
    await ensureItem("M-CP-P1-CRAW", "Co-product order co-raw P1");
    const p1 = await wirePair({ tag: "P1", coHasBom: false });

    // P2 — co WITH its own BOM; the MAIN id is created FIRST (main <
    // co on the string tie-break).
    await ensureItem("M-CP-P2-MAIN", "Co-product order main P2 (id-first)");
    await ensureItem("M-CP-P2-CO", "Co-product order co P2");
    await ensureItem("M-CP-P2-RAW", "Co-product order raw P2");
    await ensureItem("M-CP-P2-CRAW", "Co-product order co-raw P2");
    const p2 = await wirePair({ tag: "P2", coHasBom: true });

    // P3 — the SWAP: the CO id is created FIRST (co < main).
    await ensureItem("M-CP-P3-CO", "Co-product order co P3 (id-first)");
    await ensureItem("M-CP-P3-MAIN", "Co-product order main P3");
    await ensureItem("M-CP-P3-RAW", "Co-product order raw P3");
    await ensureItem("M-CP-P3-CRAW", "Co-product order co-raw P3");
    const p3 = await wirePair({ tag: "P3", coHasBom: true });

    // P4 — the beyond-co-supply pair (its own items: the id-swap tests'
    // MPS rows persist in the shared tenant, so this scenario must not
    // inherit their demand).
    await ensureItem("M-CP-P4-CO", "Co-product order co P4 (id-first)");
    await ensureItem("M-CP-P4-MAIN", "Co-product order main P4");
    await ensureItem("M-CP-P4-RAW", "Co-product order raw P4");
    await ensureItem("M-CP-P4-CRAW", "Co-product order co-raw P4");
    const p4 = await wirePair({ tag: "P4", coHasBom: true });

    // P5 — the SCOPE-EXPANSION pair (the round-3 edge): the operator
    // scopes the PRODUCER ALONE; the co-product's own demand and its
    // own recipe must still plan (its own items, same isolation rule).
    await ensureItem("M-CP-P5-CO", "Co-product order co P5 (id-first)");
    await ensureItem("M-CP-P5-MAIN", "Co-product order main P5");
    await ensureItem("M-CP-P5-RAW", "Co-product order raw P5");
    await ensureItem("M-CP-P5-CRAW", "Co-product order co-raw P5");
    const p5 = await wirePair({ tag: "P5", coHasBom: true });

    spec.pairs = { p1, p2, p3, p4, p5 };

    // The id-order assertion inputs (the swap the audit demanded).
    expect(p2.main < p2.co).toBe(true); // P2: main id first
    expect(p3.co < p3.main).toBe(true); // P3: co id first (the swap)
  });
});

describe("PHASE-043 audit round 2, item 4 — the co-product plans AFTER its producer (deterministically, in BOTH id orders)", () => {
  it("a co-product WITHOUT its own BOM: demand on BOTH — the producer's make order feeds the co-product supply BEFORE its coverage suggestion is issued (no purchase for the covered qty)", async () => {
    const f = spec.fixture!;
    const p = spec.pairs!.p1;
    await withTenant(TENANT_M, async () => {
      await seedMps(p.main, "2026-03-10", "10");
      await seedMps(p.co, "2026-03-10", "10");

      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 30,
        runMode: "NET_CHANGE",
        scopeItemIds: [p.main, p.co],
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");

      const live = (itemId: string) =>
        result.suggestions.filter((row) => row.itemId === itemId && row.status === "SUGGESTED");

      // The producer: MO 10, due 03-10, release 03-08 (LT 2).
      const mainSug = live(p.main);
      expect(mainSug).toHaveLength(1);
      expect(mainSug[0]!.suggestionType).toBe("PRODUCTION_ORDER");
      expect(Number(mainSug[0]!.qty)).toBe(10);
      expect(mainSug[0]!.dueDate).toBe("2026-03-10");
      expect(mainSug[0]!.releaseDate).toBe("2026-03-08");

      // THE LAW: the co-product's 10-unit demand is covered by the
      // producer's output (the co-supply 10 lands at the same due
      // bucket) — NO coverage suggestion for the covered qty (pre-fix:
      // a PURCHASE_ORDER 10 — the co-product's walk had already
      // finished when the supply landed).
      expect(live(p.co)).toHaveLength(0);

      // The producer's own component: PO 10 due 03-08 (the explosion at
      // the release bucket), release 03-05 (LT 3).
      const rawSug = live(p.raw);
      expect(rawSug).toHaveLength(1);
      expect(rawSug[0]!.suggestionType).toBe("PURCHASE_ORDER");
      expect(Number(rawSug[0]!.qty)).toBe(10);
      expect(rawSug[0]!.dueDate).toBe("2026-03-08");
      expect(rawSug[0]!.releaseDate).toBe("2026-03-05");

      // The evidence: the co-product's supply line IS the run's own
      // planned output (the M-11 netting the snapshot records).
      const coSupply = (await planning.listMrpSupplyLines({ runId: result.run.id })).filter(
        (row) => row.itemId === p.co,
      );
      expect(coSupply.map((row) => [row.supplyKind, row.qty])).toContainEqual([
        "CO_PRODUCT",
        "10.000000",
      ]);
      // And the co-product's MPS demand row is in the snapshot (the
      // demand was NETTED, never dropped).
      const coDemand = (await planning.listMrpDemandLines({ runId: result.run.id })).filter(
        (row) => row.itemId === p.co,
      );
      expect(coDemand.map((row) => [row.demandKind, row.qty])).toContainEqual([
        "MPS",
        "10.000000",
      ]);
    });
  });

  it("the ID-SWAP: a co-product WITH its own BOM — BOTH creation orders produce the SAME plan (the co-supply counts first; the co-product's own demand never double-plans)", async () => {
    const f = spec.fixture!;
    const p2 = spec.pairs!.p2; // main id < co id
    const p3 = spec.pairs!.p3; // co id < main id (the swap)
    await withTenant(TENANT_M, async () => {
      for (const p of [p2, p3]) {
        await seedMps(p.main, "2026-03-10", "10");
        await seedMps(p.co, "2026-03-10", "10");
      }

      const shapes: string[] = [];
      for (const p of [p2, p3]) {
        const result = await mrpEngine.run({
          warehouseId: f.warehouseFg,
          bucketSize: "DAY",
          horizonBuckets: 30,
          runMode: "NET_CHANGE",
          scopeItemIds: [p.main, p.co],
          asOfDate: "2026-03-01",
          actorId: M_ACTOR,
        });
        expect(result.run.status).toBe("COMPLETED");
        const live = (itemId: string) =>
          result.suggestions.filter((row) => row.itemId === itemId && row.status === "SUGGESTED");

        // The producer: MO 10 — in BOTH id orders.
        expect(live(p.main)).toHaveLength(1);
        expect(live(p.main)[0]!.suggestionType).toBe("PRODUCTION_ORDER");
        expect(Number(live(p.main)[0]!.qty)).toBe(10);
        // THE LAW: the co-product nets its demand against the producer's
        // output FIRST — no coverage suggestion for it (pre-fix the id
        // order decided: the pair whose CO id sorted first planned the
        // co-product BEFORE its producer and issued a make order 10 +
        // its components' explosion — over-planned by the whole
        // co-output).
        expect(live(p.co)).toHaveLength(0);
        // The co-product's own components: NO demand was pushed (its
        // net hit zero — the components never explode).
        expect(live(p.craw)).toHaveLength(0);
        // The producer's raw: PO 10 as always.
        expect(live(p.raw)).toHaveLength(1);
        expect(Number(live(p.raw)[0]!.qty)).toBe(10);

        shapes.push(
          [
            live(p.main).map((s) => `${s.suggestionType}:${Number(s.qty)}`).join(","),
            live(p.co).map((s) => `${s.suggestionType}:${Number(s.qty)}`).join(","),
            live(p.craw).map((s) => `${s.suggestionType}:${Number(s.qty)}`).join(","),
            live(p.raw).map((s) => `${s.suggestionType}:${Number(s.qty)}`).join(","),
          ].join("|"),
        );
      }
      // POSITION-INDEPENDENCE: the two id orders produced the IDENTICAL
      // plan shape.
      expect(shapes[0]).toBe(shapes[1]);
      expect(shapes[0]).toBe("PRODUCTION_ORDER:10|||PURCHASE_ORDER:10");
    });
  });

  it("a co-product WITH its own BOM and demand BEYOND the co-supply: the uncovered remainder drives its OWN make order and its components' explosion — never silently dropped, never over-planned", async () => {
    const f = spec.fixture!;
    const p = spec.pairs!.p4; // its own pair (the id-swap MPS rows persist)
    await withTenant(TENANT_M, async () => {
      // The producer's 10 (MPS @ 03-10) feeds the co-supply 10 at the
      // same bucket; the co-product carries an ADDITIONAL 14-unit demand
      // two days later (@ 03-12).
      await seedMps(p.main, "2026-03-10", "10");
      await seedMps(p.co, "2026-03-12", "14");

      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 30,
        runMode: "NET_CHANGE",
        scopeItemIds: [p.main, p.co],
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");
      const live = (itemId: string) =>
        result.suggestions.filter((row) => row.itemId === itemId && row.status === "SUGGESTED");

      // The producer: MO 10 (unchanged).
      expect(live(p.main)).toHaveLength(1);
      expect(Number(live(p.main)[0]!.qty)).toBe(10);
      // The co-product: exactly the uncovered 4 (14 − the co-supply 10)
      // — its OWN make order at ITS due date 03-12 (never the full 14:
      // the co-supply counts; never 0: the demand beyond it is not
      // dropped).
      const coSug = live(p.co);
      expect(coSug).toHaveLength(1);
      expect(coSug[0]!.suggestionType).toBe("PRODUCTION_ORDER");
      expect(Number(coSug[0]!.qty)).toBe(4);
      expect(coSug[0]!.dueDate).toBe("2026-03-12");
      // …and its component explodes for exactly the 4 (the co-product's
      // BOM is a full planning member — the snapshot carries the
      // BOM_EXPLOSION row).
      const crawSug = live(p.craw);
      expect(crawSug).toHaveLength(1);
      expect(Number(crawSug[0]!.qty)).toBe(4);
      const crawDemand = (await planning.listMrpDemandLines({ runId: result.run.id })).filter(
        (row) => row.itemId === p.craw,
      );
      expect(crawDemand.map((row) => [row.demandKind, row.qty, row.parentItemId])).toContainEqual([
        "BOM_EXPLOSION",
        "4.000000",
        p.co,
      ]);
    });
  });

  it("THE SCOPE EXPANSION (the round-3 edge): the operator scopes the PRODUCER ALONE — the closure carries the co-product AND its own recipe's members; the co-product's uncovered demand plans (make 4) and its component explodes (PO 4), never silently dropped", async () => {
    const f = spec.fixture!;
    const p = spec.pairs!.p5; // its own pair (the other tests' MPS rows persist)
    await withTenant(TENANT_M, async () => {
      // The producer's 10 (MPS @ 03-10) feeds the co-supply 10 at the
      // same bucket; the co-product carries an ADDITIONAL 14-unit demand
      // @ 03-12 — the P4 shape, but the run is scoped to the MAIN only.
      await seedMps(p.main, "2026-03-10", "10");
      await seedMps(p.co, "2026-03-12", "14");

      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 30,
        runMode: "NET_CHANGE",
        scopeItemIds: [p.main], // THE ROUND-3 CASE: the producer alone
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");

      // The closure EXPANDED the operator's request (the item-2 law,
      // now through the OUTPUT edge too): the co-product AND its own
      // recipe's raw are planning members; the params keep the request.
      expect(result.run.scopeItemIds).toEqual(
        expect.arrayContaining([p.main, p.co, p.raw, p.craw]),
      );
      expect(result.run.params.requestedItemIds).toEqual([p.main]);

      const live = (itemId: string) =>
        result.suggestions.filter((row) => row.itemId === itemId && row.status === "SUGGESTED");

      // The producer: MO 10 (unchanged).
      expect(live(p.main)).toHaveLength(1);
      expect(live(p.main)[0]!.suggestionType).toBe("PRODUCTION_ORDER");
      expect(Number(live(p.main)[0]!.qty)).toBe(10);
      // The producer's raw: PO 10 (the explosion at the release bucket).
      expect(live(p.raw)).toHaveLength(1);
      expect(Number(live(p.raw)[0]!.qty)).toBe(10);
      // THE LAW (the round-3 scope expansion): the co-product's own MPS
      // demand (14) is a closure member's demand — netted against the
      // run's own co-supply (10) → its OWN make order for exactly the
      // uncovered 4 at ITS due date 03-12. Pre-fix the suggestion itself
      // existed (the closure carried the co as a supply-only member)
      // but its component's demand vanished — the silent drop.
      const coSug = live(p.co);
      expect(coSug).toHaveLength(1);
      expect(coSug[0]!.suggestionType).toBe("PRODUCTION_ORDER");
      expect(Number(coSug[0]!.qty)).toBe(4);
      expect(coSug[0]!.dueDate).toBe("2026-03-12");
      // …and the co-product's OWN component explodes for exactly the 4
      // (its recipe is a full planning member of the expanded closure —
      // pre-fix craw never joined the closure and its demand was pushed
      // onto a walk that never visited it: PO 4 was the EXPECTATION,
      // EMPTY was the reality).
      const crawSug = live(p.craw);
      expect(crawSug).toHaveLength(1);
      expect(crawSug[0]!.suggestionType).toBe("PURCHASE_ORDER");
      expect(Number(crawSug[0]!.qty)).toBe(4);
      // The evidence: the co-supply line and the craw explosion demand
      // row (parent = the CO, not the main) both ride the snapshot.
      const coSupply = (await planning.listMrpSupplyLines({ runId: result.run.id })).filter(
        (row) => row.itemId === p.co,
      );
      expect(coSupply.map((row) => [row.supplyKind, row.qty])).toContainEqual([
        "CO_PRODUCT",
        "10.000000",
      ]);
      const crawDemand = (await planning.listMrpDemandLines({ runId: result.run.id })).filter(
        (row) => row.itemId === p.craw,
      );
      expect(crawDemand.map((row) => [row.demandKind, row.qty, row.parentItemId])).toContainEqual([
        "BOM_EXPLOSION",
        "4.000000",
        p.co,
      ]);
    });
  });
});
