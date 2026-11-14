import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as mfgStore from "../../modules/manufacturing/infrastructure/manufacturing.store";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  mrpEngine,
  mpsSrv,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";
import * as planning from "../../modules/manufacturing/infrastructure/planning.store";

/**
 * PHASE-043 audit item 2 — the SCOPE CLOSURE, the substitution wiring, and
 * the single-level explosion (three defects, one chain).
 *
 * The independent audit's reproduction (each confirmed by code reading
 * FIRST, then practically here — pre-fix all three tests failed):
 *
 * 1. THE SCOPE CLOSURE: the engine's walk visited ONLY the scope items —
 *    `deriveScopeItems` (REGENERATIVE) requires an INDEPENDENT planning
 *    signal (stock / MPS / firm sales / an open MO as FG / a co-product
 *    output of an open MO), and a NET_CHANGE scope is whatever the operator
 *    listed. But the make orders' BOM explosion pushes demand onto
 *    COMPONENTS regardless of their signal state — a component outside the
 *    scope received demand the walk never consumed: the demand vanished
 *    with no suggestion, in BOTH run modes. The fix EXPANDS the scope to
 *    the planning closure (transitive components + substitutes + co-product
 *    outputs) — the operator never enumerates components by hand (the
 *    multi-level standard M-07/M-08/M-09/M-11).
 *
 * 2. THE SUBSTITUTION WIRING: the pre-fix substitution block ran on the
 *    PARENT item and filtered the parent's demand terms by
 *    `term.parentItemId ∈ the parent's OWN components` — a key that can
 *    never match (a term's parentItemId is its DEMANDING parent, never a
 *    component of the term holder), so engine-level substitution NEVER
 *    fired (only the pure kernel was tested). The fix keys the shift on
 *    the COMPONENT: its uncovered explosion demand from a substitutable
 *    parent line shifts to the substitutes (priority order).
 *
 * 3. THE DOUBLE EXPLOSION (unmasked by the closure fix): explodeDemand's
 *    default walk recurses into non-phantom components with their own
 *    recipes (the pure-kernel transitive contract) — while the engine's
 *    leveled walk ALSO explodes each manufactured component at its own
 *    turn. A manufactured intermediate's components were demanded TWICE
 *    (at the root's release bucket AND at the intermediate's own release
 *    bucket). The scope bug had masked it (the dropped components were
 *    never planned at all). The engine now explodes SINGLE-LEVEL
 *    (phantom-flattened); the transitive default stays for the kernel's
 *    property tests.
 *
 * Also fixed on the way (found by this spec being the FIRST DB-level
 * caller of the substitution writer): replaceBomSubstitutions rendered
 * `${row.note}` with an undefined note as EMPTY SQL TEXT (the
 * THEN-undefined rendering hazard family) — the insert is now
 * null-coalesced.
 *
 * Chain under test (the components deliberately SIGNAL-LESS — no stock, no
 * MPS, no sales, no open MO):
 *
 *   scFg   (MPS 10 @ 2026-03-10, LT 2, BOM: scMid ×1 + the scCopro
 *           CO_PRODUCT output 0.5/unit)
 *   scMid  (BOM: scRaw ×2 — the substitution line, scSub priority 1 —
 *           and scPlain ×1; LT 3)
 *   scRaw  (purchased, LT 3, zero stock pre-T3 → the M-09 law shifts the
 *           UNCOVERED portion to the substitute)
 *   scSub  (purchased, LT 3 — the substitute)
 *   scPlain (purchased, LT 3 — the no-substitution control)
 *   scCopro (the co-product — supply-only member)
 *
 * Expected multi-level plan: scFg MO 10 due 03-10 release 03-08 →
 * scMid BOM_EXPLOSION 10 @ 03-08 → scMid MO 10 due 03-08 release 03-05 →
 * scRaw BOM_EXPLOSION 20 @ 03-05 (fully substituted while stockless →
 * scSub SUBSTITUTION 20 → PO 20 due 03-05 release 03-02) and scPlain
 * BOM_EXPLOSION 10 @ 03-05 → PO 10; the scCopro CO_PRODUCT supply 5
 * (0.5 × 10) rides the run snapshot. With 8 of scRaw stocked (T3): the
 * uncovered 12 shifts to scSub (PO 12), scRaw nets to zero, scPlain
 * unchanged.
 */
interface SpecItems {
  scFg: string;
  scMid: string;
  scRaw: string;
  scSub: string;
  scPlain: string;
  scCopro: string;
}

const spec: { fixture?: MfgFixture; items?: SpecItems } = {};

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

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    const s: SpecItems = {
      scFg: await ensureItem("M-SC-FG", "Scope-closure FG"),
      scMid: await ensureItem("M-SC-MID", "Scope-closure intermediate"),
      scRaw: await ensureItem("M-SC-RAW", "Scope-closure raw"),
      scSub: await ensureItem("M-SC-SUB", "Scope-closure substitute"),
      scPlain: await ensureItem("M-SC-PLAIN", "Scope-closure plain component"),
      scCopro: await ensureItem("M-SC-CO", "Scope-closure co-product"),
    };
    spec.items = s;
    for (const [id, lt] of [
      [s.scFg, 2],
      [s.scMid, 3],
      [s.scRaw, 3],
      [s.scSub, 3],
      [s.scPlain, 3],
    ] as const) {
      await setPolicy(id, lt);
    }

    // scMid's BOM: scRaw ×2 (the substitution line → scSub, priority 1) +
    // scPlain ×1 (the no-substitution control).
    const midDraft = await boms.create({
      itemId: s.scMid,
      outputUomId: (await itemsStore.findItemById(s.scMid))!.uomId,
      yieldPct: "100.0000",
      mainAllocationPct: "100.0000",
      note: "Scope-closure mid BOM",
      noteAr: null,
      actorId: M_ACTOR,
      lines: [
        { componentItemId: s.scRaw, qtyPerOutput: "2.000000", scrapPct: "0" },
        { componentItemId: s.scPlain, qtyPerOutput: "1.000000", scrapPct: "0" },
      ],
    });
    const midLines = await mfgStore.listBomLines(midDraft.id);
    const rawLine = midLines.find((line) => line.componentItemId === s.scRaw)!;
    await boms.replaceSubstitutions(
      midDraft.id,
      [{ bomLineId: rawLine.id, substituteItemId: s.scSub, priority: 1 }],
      M_ACTOR,
    );
    await boms.activate(midDraft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });

    // scFg's BOM: scMid ×1 + the scCopro CO_PRODUCT output (0.5 per unit,
    // the G-47 60/40 allocation discipline).
    const fgDraft = await boms.create({
      itemId: s.scFg,
      outputUomId: (await itemsStore.findItemById(s.scFg))!.uomId,
      yieldPct: "100.0000",
      mainAllocationPct: "60.0000",
      note: "Scope-closure FG BOM",
      noteAr: null,
      actorId: M_ACTOR,
      lines: [{ componentItemId: s.scMid, qtyPerOutput: "1.000000", scrapPct: "0" }],
    });
    await boms.replaceOutputs(
      fgDraft.id,
      [
        {
          itemId: s.scCopro,
          outputKind: "CO_PRODUCT",
          allocationPct: "40.0000",
          qtyPerOutput: "0.500000",
          uomId: (await itemsStore.findItemById(s.scCopro))!.uomId,
          note: null,
        },
      ],
      M_ACTOR,
    );
    await boms.activate(fgDraft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });

    // The demand on scFg: MPS 10 @ 2026-03-10 (the bucket is in the past
    // relative to the wall clock — inside any fence — so the BR-078
    // permission + reason ride the seed; the fixture's honest path).
    await mpsSrv.upsert({
      warehouseId: spec.fixture!.warehouseFg,
      itemId: s.scFg,
      bucketStart: "2026-03-10",
      qty: "10",
      uomId: (await itemsStore.findItemById(s.scFg))!.uomId,
      status: "PLANNED",
      reason: "Scope-closure fixture (the audit item-2 reproduction)",
      frozenEditPermission: true,
      actorId: M_ACTOR,
    });
  });
});

describe("PHASE-043 audit item 2 — the scope closure (multi-level planning never drops demand)", () => {
  it("NET_CHANGE for the FG ALONE plans the whole chain: mid MO + substitute PO + plain PO + the co-product supply", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 30,
        runMode: "NET_CHANGE",
        scopeItemIds: [s.scFg],
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");
      // The run row records the CLOSURE (what was actually planned), not
      // just the operator's request — and the params keep the request.
      expect(result.run.scopeItemIds).toEqual(
        expect.arrayContaining([s.scFg, s.scMid, s.scRaw, s.scSub, s.scPlain, s.scCopro]),
      );
      expect(result.run.params.requestedItemIds).toEqual([s.scFg]);

      const live = (itemId: string) =>
        result.suggestions.filter((row) => row.itemId === itemId && row.status === "SUGGESTED");
      // scFg: MO 10, due 03-10, release 03-08 (LT 2).
      const fg = live(s.scFg);
      expect(fg).toHaveLength(1);
      expect(fg[0]!.suggestionType).toBe("PRODUCTION_ORDER");
      expect(Number(fg[0]!.qty)).toBe(10);
      expect(fg[0]!.dueDate).toBe("2026-03-10");
      expect(fg[0]!.releaseDate).toBe("2026-03-08");
      // scMid: MO 10 (the explosion demand 10 @ the FG's release bucket),
      // due 03-08, release 03-05 (LT 3).
      const mid = live(s.scMid);
      expect(mid).toHaveLength(1);
      expect(mid[0]!.suggestionType).toBe("PRODUCTION_ORDER");
      expect(Number(mid[0]!.qty)).toBe(10);
      expect(mid[0]!.dueDate).toBe("2026-03-08");
      expect(mid[0]!.releaseDate).toBe("2026-03-05");
      // scRaw is stockless and substitutable: the M-09 law shifts the
      // WHOLE uncovered 20 to the substitute — scRaw itself nets to zero.
      expect(live(s.scRaw)).toHaveLength(0);
      const sub = live(s.scSub);
      expect(sub).toHaveLength(1);
      expect(sub[0]!.suggestionType).toBe("PURCHASE_ORDER");
      expect(Number(sub[0]!.qty)).toBe(20);
      expect(sub[0]!.dueDate).toBe("2026-03-05");
      expect(sub[0]!.releaseDate).toBe("2026-03-02");
      // scPlain (the no-substitution control): PO 10, due 03-05, release
      // 03-02 — exactly ONE order for exactly ONE explosion demand (the
      // single-level law; pre-fix the double explosion demanded it twice).
      const plain = live(s.scPlain);
      expect(plain).toHaveLength(1);
      expect(plain[0]!.suggestionType).toBe("PURCHASE_ORDER");
      expect(Number(plain[0]!.qty)).toBe(10);
      expect(plain[0]!.dueDate).toBe("2026-03-05");
      expect(plain[0]!.releaseDate).toBe("2026-03-02");
      // The explosion demand rows are in the snapshot (the evidence trail).
      const midDemand = (await planning.listMrpDemandLines({ runId: result.run.id })).filter(
        (row) => row.itemId === s.scMid,
      );
      expect(midDemand.map((row) => [row.demandKind, row.qty, row.parentItemId])).toContainEqual([
        "BOM_EXPLOSION",
        "10.000000",
        s.scFg,
      ]);
      const rawDemand = (await planning.listMrpDemandLines({ runId: result.run.id })).filter(
        (row) => row.itemId === s.scRaw,
      );
      // Exactly ONE scRaw explosion row (the single-level law) — qty 0
      // retained with the FULL substitution lineage (where the 20 went —
      // the resolved-away demand record, never a silent drop).
      expect(rawDemand).toHaveLength(1);
      expect([
        rawDemand[0]!.demandKind,
        rawDemand[0]!.qty,
        rawDemand[0]!.parentItemId,
        rawDemand[0]!.substitutes,
      ]).toEqual(["BOM_EXPLOSION", "0.000000", s.scMid, [{ itemId: s.scSub, qty: "20.000000" }]]);
      // The substitute's SUBSTITUTION demand row names the primary.
      const subDemand = (await planning.listMrpDemandLines({ runId: result.run.id })).filter(
        (row) => row.itemId === s.scSub,
      );
      expect(subDemand.map((row) => [row.demandKind, row.qty, row.substitutedItemId])).toContainEqual([
        "SUBSTITUTION",
        "20.000000",
        s.scRaw,
      ]);
      // The co-product's supply rides the snapshot (0.5 × 10 = 5).
      const coproSupply = (await planning.listMrpSupplyLines({ runId: result.run.id })).filter(
        (row) => row.itemId === s.scCopro,
      );
      expect(coproSupply.map((row) => [row.supplyKind, row.qty])).toContainEqual([
        "CO_PRODUCT",
        "5.000000",
      ]);
    });
  });

  it("REGENERATIVE (signal-derived scope) plans the same chain — the closure covers the derived path too", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 30,
        runMode: "REGENERATIVE",
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");
      // The signal-derived scope contains scFg (MPS); the closure must add
      // the signal-less mid/raw/sub/plain/copro even though
      // deriveScopeItems skips them (no independent signal).
      expect(result.run.scopeItemIds).toEqual(
        expect.arrayContaining([s.scFg, s.scMid, s.scRaw, s.scSub, s.scPlain, s.scCopro]),
      );
      const live = (itemId: string) =>
        result.suggestions.filter((row) => row.itemId === itemId && row.status === "SUGGESTED");
      expect(live(s.scMid)).toHaveLength(1);
      expect(live(s.scMid)[0]!.suggestionType).toBe("PRODUCTION_ORDER");
      expect(Number(live(s.scMid)[0]!.qty)).toBe(10);
      expect(live(s.scSub)).toHaveLength(1);
      expect(Number(live(s.scSub)[0]!.qty)).toBe(20);
      expect(live(s.scPlain)).toHaveLength(1);
      expect(Number(live(s.scPlain)[0]!.qty)).toBe(10);
    });
  });

  it("substitution: partial raw stock shifts ONLY the UNCOVERED portion to the substitute", async () => {
    const f = spec.fixture!;
    const s = spec.items!;
    await withTenant(TENANT_M, async () => {
      // 8 units of scRaw at the planning warehouse — the remaining 12 of
      // the 20 demanded shift to scSub (priority 1 takes the remainder).
      await stock.manualReceipt({
        itemId: s.scRaw,
        warehouseId: f.warehouseFg,
        qty: "8",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-03-01",
        batchNo: "M-SC-R1",
        batchExpiry: "2027-01-01",
        actorId: M_ACTOR,
      });

      const result = await mrpEngine.run({
        warehouseId: f.warehouseFg,
        bucketSize: "DAY",
        horizonBuckets: 30,
        runMode: "REGENERATIVE",
        asOfDate: "2026-03-01",
        actorId: M_ACTOR,
      });
      expect(result.run.status).toBe("COMPLETED");
      const live = (itemId: string) =>
        result.suggestions.filter((row) => row.itemId === itemId && row.status === "SUGGESTED");
      // scRaw: the 8 on-hand covers the reduced primary portion — no order.
      expect(live(s.scRaw)).toHaveLength(0);
      // scSub: the shifted 12 lands as SUBSTITUTION demand → PO 12 —
      // exactly ONE order (pre-fix the double explosion produced two).
      const sub = live(s.scSub);
      expect(sub).toHaveLength(1);
      expect(sub[0]!.suggestionType).toBe("PURCHASE_ORDER");
      expect(Number(sub[0]!.qty)).toBe(12);
      expect(sub[0]!.dueDate).toBe("2026-03-05");
      // scPlain unaffected by the substitution: still PO 10.
      expect(live(s.scPlain)).toHaveLength(1);
      expect(Number(live(s.scPlain)[0]!.qty)).toBe(10);
      // The substitution demand row names the substituted primary.
      const subDemand = (await planning.listMrpDemandLines({ runId: result.run.id })).filter(
        (row) => row.itemId === s.scSub,
      );
      expect(subDemand.map((row) => [row.demandKind, row.qty, row.substitutedItemId])).toContainEqual([
        "SUBSTITUTION",
        "12.000000",
        s.scRaw,
      ]);
    });
  });
});
