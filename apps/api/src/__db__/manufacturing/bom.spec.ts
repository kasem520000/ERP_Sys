import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";
import { withTenant } from "../../infra/db/tenant-context";
import * as store from "../../modules/manufacturing/infrastructure/manufacturing.store";
import { M_ACTOR, TENANT_M, boms, setupMfgFixture, type MfgFixture } from "./fixtures";

/**
 * BOM spec (PHASE-018 T38a; MASTER-PLAN §3/§7/§9): the version lifecycle
 * (DRAFT → ACTIVE → ARCHIVED, one ACTIVE per item, monotonic versionNo), the
 * typed validation rejections, and the multi-level explosion property pack —
 * determinism, composition exactness (composed level-by-level === single
 * pass, pinned to EXACT 6dp strings on the golden two-level fixture), cycle
 * detection, the 16-level depth cap, and the not-found shapes.
 *
 * Service-level on purpose (the distribution specs are service-level; HTTP
 * mounting of routes #1–7 is proven by billing/readonly-sweep — the swept
 * state-changing routes return the typed 403 exactly when the controller is
 * mounted). Spec-owned items only: the golden §8 substrate (flour/yeast/
 * packaging/dough/bread + the two ACTIVE BOMs) is never mutated here — later
 * files in the shared-db run (T38b's golden chain) depend on it.
 *
 * T38b owns the version-binding proof (an order keeps its released version
 * despite a newer BOM activating) — deliberately not tested here.
 */

let fixture: MfgFixture;
let pcs = "";

/** Idempotent spec-owned item (the golden five stay untouched). */
async function ensureSpecItem(
  sku: string,
  name: string,
  extra: { kind?: string; shelfLifeDays?: number } = {},
): Promise<string> {
  return withTenant(TENANT_M, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const found = await itemsStore.findItemBySku(sku);
    if (found !== undefined) return found.id;
    if (pcs === "") {
      const uoms = await itemsStore.listUoms();
      pcs = (uoms.find((u) => u.code === "PCS") ?? uoms[0]!).id;
    }
    // ck_items_tracking_stock_kind: tracking flags ride STOCK items only —
    // SERVICE items carry none (the non-STOCK FG rejection fixture).
    const stock = (extra.kind ?? "STOCK") === "STOCK";
    const created = await itemsStore.insertItem({
      sku,
      name,
      nameAr: null,
      kind: extra.kind ?? "STOCK",
      uomId: pcs,
      categoryId: null,
      taxCodeId: null,
      costingMethod: "WAC",
      trackBatch: stock,
      trackSerial: false,
      trackImei: false,
      hasExpiry: stock,
      shelfLifeDays: stock ? (extra.shelfLifeDays ?? 30) : null,
      reorderLevel: null,
      reorderQty: null,
      basePrice: null,
    });
    return created.id;
  });
}

/** Create + activate a spec-owned recipe in one step (yield 100 default). */
async function activateRecipe(
  fgItemId: string,
  lines: { componentItemId: string; qtyPerOutput: string; scrapPct?: string }[],
  options: { yieldPct?: string } = {},
): Promise<store.BomRow> {
  const draft = await withTenant(TENANT_M, () =>
    boms.create({
      itemId: fgItemId,
      outputUomId: pcs,
      yieldPct: options.yieldPct ?? "100.0000",
      note: null,
      noteAr: null,
      actorId: M_ACTOR,
      lines: lines.map((line) => ({
        componentItemId: line.componentItemId,
        qtyPerOutput: line.qtyPerOutput,
        scrapPct: line.scrapPct ?? "0",
        note: null,
        noteAr: null,
      })),
    }),
  );
  return withTenant(TENANT_M, () => boms.activate(draft.id, { actorId: M_ACTOR }));
}

beforeAll(async () => {
  fixture = await setupMfgFixture();
  pcs = await withTenant(TENANT_M, async () => {
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await itemsStore.listUoms();
    return (uoms.find((u) => u.code === "PCS") ?? uoms[0]!).id;
  });
});

describe("PHASE-018 T38a — BOM version lifecycle (one ACTIVE per item)", () => {
  it("creates DRAFT v1, then v2 (versionNo monotonic); activate v2 archives v1; archive v2 leaves none ACTIVE", async () => {
    const fg = await ensureSpecItem("M-SPEC-FG1", "Spec FG one");
    const comp1 = await ensureSpecItem("M-SPEC-C1", "Spec component one");
    const comp2 = await ensureSpecItem("M-SPEC-C2", "Spec component two");

    const v1 = await withTenant(TENANT_M, () =>
      boms.create({
        itemId: fg,
        outputUomId: pcs,
        yieldPct: "90.0000",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: comp1, qtyPerOutput: "2.000000", scrapPct: "0" }],
      }),
    );
    expect(v1.versionNo).toBe(1);
    expect(v1.status).toBe("DRAFT");

    // A second version while v1 is still DRAFT: versionNo 2 (max across ALL
    // versions — DRAFT included).
    const v2 = await withTenant(TENANT_M, () =>
      boms.create({
        itemId: fg,
        outputUomId: pcs,
        yieldPct: "95.0000",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
        lines: [
          { componentItemId: comp1, qtyPerOutput: "1.000000", scrapPct: "0" },
          { componentItemId: comp2, qtyPerOutput: "0.500000", scrapPct: "0" },
        ],
      }),
    );
    expect(v2.versionNo).toBe(2);

    // DRAFT edit full-replaces the line set (one preserved id + one new; the
    // first line's id survives, the dropped comp2 line is gone).
    const withLines = await withTenant(TENANT_M, () => boms.findWithLines(v2.id));
    const keptLineId = withLines.lines[0]!.id;
    const updated = await withTenant(TENANT_M, () =>
      boms.update(v2.id, {
        lines: [
          { id: keptLineId, componentItemId: comp1, qtyPerOutput: "3.000000", scrapPct: "1.5000" },
          { componentItemId: comp2, qtyPerOutput: "0.250000", scrapPct: "0" },
        ],
        actorId: M_ACTOR,
      }),
    );
    expect(updated.status).toBe("DRAFT");
    const replaced = await withTenant(TENANT_M, () => boms.findWithLines(v2.id));
    expect(replaced.lines.map((line) => line.qtyPerOutput)).toEqual(["3.000000", "0.250000"]);
    expect(replaced.lines.map((line) => line.scrapPct)).toEqual(["1.5000", "0.0000"]);
    expect(replaced.lines[0]!.id).toBe(keptLineId); // preserved id on the full-replace

    // Activate v1 first, then v2 — v2's activation archives v1 in the same call.
    await withTenant(TENANT_M, () => boms.activate(v1.id, { effectiveFrom: "2026-02-01", actorId: M_ACTOR }));
    const active1 = await withTenant(TENANT_M, () => store.findActiveBom(fg));
    expect(active1?.id).toBe(v1.id);
    expect(active1?.effectiveFrom).toBe("2026-02-01");

    const activated2 = await withTenant(TENANT_M, () => boms.activate(v2.id, { actorId: M_ACTOR }));
    expect(activated2.status).toBe("ACTIVE");
    expect(activated2.effectiveFrom).not.toBeNull();
    const archived1 = await withTenant(TENANT_M, () => boms.find(v1.id));
    expect(archived1.status).toBe("ARCHIVED");
    expect(archived1.archivedAt).not.toBeNull();
    const active2 = await withTenant(TENANT_M, () => store.findActiveBom(fg));
    expect(active2?.id).toBe(v2.id); // one-active
    const versions = await withTenant(TENANT_M, () => store.listBomsForItem(fg));
    expect(versions.filter((row) => row.status === "ACTIVE")).toHaveLength(1);

    // Archive v2 → none ACTIVE; a fresh version climbs to 3 (monotonic).
    await withTenant(TENANT_M, () => boms.archive(v2.id, { actorId: M_ACTOR }));
    expect(await withTenant(TENANT_M, () => store.findActiveBom(fg))).toBeUndefined();
    const v3 = await withTenant(TENANT_M, () =>
      boms.create({
        itemId: fg,
        outputUomId: pcs,
        yieldPct: "100.0000",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: comp1, qtyPerOutput: "1.000000", scrapPct: "0" }],
      }),
    );
    expect(v3.versionNo).toBe(3);
    // Archive of a non-ACTIVE version is the typed 409 shape.
    await expect(
      withTenant(TENANT_M, () => boms.archive(v2.id, { actorId: M_ACTOR })),
    ).rejects.toMatchObject({ code: "BOM_NOT_ACTIVE" });
  });

  it("records the bom audit events (entityType 'bom')", async () => {
    const { AuditService } = await import("../../modules/audit/api/audit");
    const { DrizzleAuditStore } = await import("../../modules/audit/infrastructure/drizzle-audit.store");
    const audit = new AuditService(new DrizzleAuditStore());
    const events = await withTenant(TENANT_M, () => audit.list({ entityType: "bom", limit: 500 }));
    const actions = new Set(events.map((event) => event.action));
    expect(actions.has("manufacturing.bom.created")).toBe(true);
    expect(actions.has("manufacturing.bom.activated")).toBe(true);
    expect(actions.has("manufacturing.bom.archived")).toBe(true);
    const doughActivation = events.find(
      (event) => event.action === "manufacturing.bom.activated" && event.entityId === fixture.boms.dough.id,
    );
    expect(doughActivation).toBeDefined();
  });
});

describe("PHASE-018 T38a — BOM validation rejections (typed codes)", () => {
  it("rejects a non-STOCK FG item (SERVICE on the fly)", async () => {
    const service = await ensureSpecItem("M-SPEC-SVC", "Spec service", { kind: "SERVICE" });
    const comp = await ensureSpecItem("M-SPEC-C1", "Spec component one");
    await expect(
      withTenant(TENANT_M, () =>
        boms.create({
          itemId: service,
          outputUomId: pcs,
          yieldPct: "100.0000",
          note: null,
          noteAr: null,
          actorId: M_ACTOR,
          lines: [{ componentItemId: comp, qtyPerOutput: "1.000000", scrapPct: "0" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "BOM_ITEM_NOT_STOCK" });
  });

  it("rejects self-reference, duplicates, qty 0 and scrap −1 on the lines", async () => {
    const fg = await ensureSpecItem("M-SPEC-FG1", "Spec FG one");
    const comp1 = await ensureSpecItem("M-SPEC-C1", "Spec component one");
    const base = {
      itemId: fg,
      outputUomId: pcs,
      note: null,
      noteAr: null,
      actorId: M_ACTOR,
    };
    await expect(
      withTenant(TENANT_M, () =>
        boms.create({
          ...base,
          yieldPct: "100.0000",
          lines: [{ componentItemId: fg, qtyPerOutput: "1.000000", scrapPct: "0" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "BOM_SELF_REFERENCE" });
    await expect(
      withTenant(TENANT_M, () =>
        boms.create({
          ...base,
          yieldPct: "100.0000",
          lines: [
            { componentItemId: comp1, qtyPerOutput: "1.000000", scrapPct: "0" },
            { componentItemId: comp1, qtyPerOutput: "2.000000", scrapPct: "0" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "BOM_LINE_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        boms.create({
          ...base,
          yieldPct: "100.0000",
          lines: [{ componentItemId: comp1, qtyPerOutput: "0", scrapPct: "0" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "BOM_LINE_INVALID" });
    await expect(
      withTenant(TENANT_M, () =>
        boms.create({
          ...base,
          yieldPct: "100.0000",
          lines: [{ componentItemId: comp1, qtyPerOutput: "1.000000", scrapPct: "-1" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "BOM_LINE_INVALID" });
    // output uom must equal the FG base uom (pcs) — a foreign uuid is the
    // typed mismatch (no conversion seam in PHASE-018).
    await expect(
      withTenant(TENANT_M, () =>
        boms.create({
          ...base,
          yieldPct: "100.0000",
          lines: [{ componentItemId: comp1, qtyPerOutput: "1.000000", scrapPct: "0" }],
          outputUomId: "00000000-0000-0000-0000-000000000001",
        }),
      ),
    ).rejects.toMatchObject({ code: "BOM_UOM_MISMATCH" });
  });

  it("rejects yield 0 and 100.0001; accepts the 100 boundary", async () => {
    const fg = await ensureSpecItem("M-SPEC-FG1", "Spec FG one");
    const comp1 = await ensureSpecItem("M-SPEC-C1", "Spec component one");
    const base = {
      itemId: fg,
      outputUomId: pcs,
      note: null,
      noteAr: null,
      actorId: M_ACTOR,
      lines: [{ componentItemId: comp1, qtyPerOutput: "1.000000", scrapPct: "0" }] as const,
    };
    await expect(withTenant(TENANT_M, () => boms.create({ ...base, yieldPct: "0" }))).rejects.toMatchObject({
      code: "BOM_YIELD_INVALID",
    });
    await expect(withTenant(TENANT_M, () => boms.create({ ...base, yieldPct: "100.0001" }))).rejects.toMatchObject({
      code: "BOM_YIELD_INVALID",
    });
    const boundary = await withTenant(TENANT_M, () => boms.create({ ...base, yieldPct: "100.0000" }));
    expect(boundary.status).toBe("DRAFT");
    expect(boundary.yieldPct).toBe("100.0000");
  });

  it("rejects edits and activation on non-DRAFT versions (409 shapes)", async () => {
    const fg = await ensureSpecItem("M-SPEC-FG2", "Spec FG two");
    const comp1 = await ensureSpecItem("M-SPEC-C1", "Spec component one");
    const live = await activateRecipe(fg, [{ componentItemId: comp1, qtyPerOutput: "1.000000" }]);
    await expect(
      withTenant(TENANT_M, () =>
        boms.update(live.id, { yieldPct: "50.0000", actorId: M_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "BOM_NOT_DRAFT" });
    await expect(
      withTenant(TENANT_M, () => boms.activate(live.id, { actorId: M_ACTOR })),
    ).rejects.toMatchObject({ code: "BOM_NOT_DRAFT" });
    // A foreign line id on the DRAFT full-replace is the 422 line shape.
    const draft = await withTenant(TENANT_M, () =>
      boms.create({
        itemId: fg,
        outputUomId: pcs,
        yieldPct: "100.0000",
        note: null,
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ componentItemId: comp1, qtyPerOutput: "1.000000", scrapPct: "0" }],
      }),
    );
    await expect(
      withTenant(TENANT_M, () =>
        boms.update(draft.id, {
          lines: [{ id: live.id, componentItemId: comp1, qtyPerOutput: "1.000000", scrapPct: "0" }],
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BOM_LINE_INVALID" });
    // Unknown bom id — the A7 404 shape.
    await expect(
      withTenant(TENANT_M, () => boms.find("11111111-1111-1111-1111-111111111111")),
    ).rejects.toMatchObject({ code: "BOM_NOT_FOUND" });
  });
});

describe("PHASE-018 T38a — explosion (MASTER-PLAN §3 property pack)", () => {
  it("is deterministic: two explosions deep-equal (implicit and explicit bomId)", async () => {
    const first = await withTenant(TENANT_M, () => boms.explode(fixture.items.bread, "750"));
    const second = await withTenant(TENANT_M, () => boms.explode(fixture.items.bread, "750"));
    expect(second).toEqual(first);
    const explicit = await withTenant(TENANT_M, () =>
      boms.explode(fixture.items.bread, "750", fixture.boms.bread.id),
    );
    expect(explicit).toEqual(first);
  });

  it("composes exactly: pinned 6dp strings, single-pass === composed, totals = Σ per level", async () => {
    const result = await withTenant(TENANT_M, () => boms.explode(fixture.items.bread, "750"));
    expect(result.item.id).toBe(fixture.items.bread);
    expect(result.item.sku).toBe("M-BREAD");
    expect(result.outputQty).toBe("750.000000");
    expect(result.levels.map((level) => level.level)).toEqual([1, 2]);

    // Level 1 (bread v1, yield 80): dough 750×1/0.8, packaging 750×0.25/0.8.
    const level1 = new Map(result.levels[0]!.items.map((entry) => [entry.itemId, entry]));
    expect(level1.get(fixture.items.dough)?.qty).toBe("937.500000");
    expect(level1.get(fixture.items.dough)?.viaSemiFinished).toBeNull();
    expect(level1.get(fixture.items.dough)?.yieldPct).toBe("80.0000");
    expect(level1.get(fixture.items.pack)?.qty).toBe("234.375000");
    expect(level1.get(fixture.items.pack)?.viaSemiFinished).toBeNull();

    // Level 2 (dough v1, yield 80; planned qty = dough gross 937.5):
    // flour 937.5×0.5×1.02/0.8, yeast 937.5×0.1/0.8.
    const level2 = new Map(result.levels[1]!.items.map((entry) => [entry.itemId, entry]));
    expect(level2.get(fixture.items.flour)?.qty).toBe("597.656250");
    expect(level2.get(fixture.items.flour)?.scrapPct).toBe("2.0000");
    expect(level2.get(fixture.items.flour)?.yieldPct).toBe("80.0000");
    expect(level2.get(fixture.items.flour)?.viaSemiFinished).toBe(fixture.items.dough);
    expect(level2.get(fixture.items.yeast)?.qty).toBe("117.187500");
    expect(level2.get(fixture.items.yeast)?.viaSemiFinished).toBe(fixture.items.dough);

    // Composition exactness: the single-pass closed form (bread yield then
    // dough recipe straight from the original 750) equals the composed
    // level-by-level walk — computed independently here with Decimal.
    const singlePass = (qtyPerOutput: string, scrap: string) =>
      new Decimal(750)
        .times(new Decimal(qtyPerOutput))
        .times(new Decimal(scrap).plus(100).div(100))
        .div(new Decimal(0.8))
        .div(new Decimal(0.8)) // dough's own yield, applied in the same pass
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        .toFixed(6);
    expect(level2.get(fixture.items.flour)?.qty).toBe(singlePass("0.5", "2"));
    expect(level2.get(fixture.items.yeast)?.qty).toBe(singlePass("0.1", "0"));

    // Totals = Σ per level (the accumulate rule), itemId-ascending.
    const totals = new Map(result.totals.map((entry) => [entry.itemId, entry.qty]));
    expect(totals.get(fixture.items.dough)).toBe("937.500000");
    expect(totals.get(fixture.items.pack)).toBe("234.375000");
    expect(totals.get(fixture.items.flour)).toBe("597.656250");
    expect(totals.get(fixture.items.yeast)).toBe("117.187500");
    const perLevelSum = new Map<string, Decimal>();
    for (const level of result.levels) {
      for (const entry of level.items) {
        perLevelSum.set(entry.itemId, (perLevelSum.get(entry.itemId) ?? new Decimal(0)).plus(new Decimal(entry.qty)));
      }
    }
    for (const total of result.totals) {
      expect(total.qty).toBe(perLevelSum.get(total.itemId)!.toFixed(6));
    }
    // Deterministic ordering: levels ascending, items/totals by itemId.
    const itemIds = result.totals.map((entry) => entry.itemId);
    expect([...itemIds].sort((a, b) => (a < b ? -1 : 1))).toEqual(itemIds);
    for (const level of result.levels) {
      const ids = level.items.map((entry) => entry.itemId);
      expect([...ids].sort((a, b) => (a < b ? -1 : 1))).toEqual(ids);
    }
  });

  it("detects cycles (A→B plus B→A) with the chain detail", async () => {
    const a = await ensureSpecItem("M-CYC-A", "Cycle item A");
    const b = await ensureSpecItem("M-CYC-B", "Cycle item B");
    await activateRecipe(a, [{ componentItemId: b, qtyPerOutput: "1.000000" }]);
    await activateRecipe(b, [{ componentItemId: a, qtyPerOutput: "1.000000" }]);
    await expect(withTenant(TENANT_M, () => boms.explode(a, "10"))).rejects.toMatchObject({
      code: "BOM_CYCLE",
      details: { chain: [a, b] },
    });
  });

  it("caps depth at 16 levels (level 16 walks; level 17 rejects)", async () => {
    // Chain c1 → c2 → … → c17 (16 levels); c17 has no BOM yet.
    const chain: string[] = [];
    for (let index = 1; index <= 17; index += 1) {
      chain.push(await ensureSpecItem(`M-DEP-${String(index).padStart(2, "0")}`, `Depth item ${index}`));
    }
    for (let index = 0; index < 16; index += 1) {
      await activateRecipe(chain[index]!, [{ componentItemId: chain[index + 1]!, qtyPerOutput: "1.000000" }]);
    }
    const deep = await withTenant(TENANT_M, () => boms.explode(chain[0]!, "1"));
    expect(deep.levels.map((level) => level.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(deep.levels[15]!.items[0]!.itemId).toBe(chain[16]!);
    // Extending the chain to 17 levels (c17 → c18) trips the cap.
    const c18 = await ensureSpecItem("M-DEP-18", "Depth item 18");
    await activateRecipe(chain[16]!, [{ componentItemId: c18, qtyPerOutput: "1.000000" }]);
    await expect(withTenant(TENANT_M, () => boms.explode(chain[0]!, "1"))).rejects.toMatchObject({
      code: "BOM_TOO_DEEP",
      details: { maxDepth: 16 },
    });
  });

  it("404s on unknown items and items with no ACTIVE version", async () => {
    await expect(
      withTenant(TENANT_M, () => boms.explode("12345678-1234-1234-1234-123456789012", "5")),
    ).rejects.toMatchObject({ code: "BOM_NOT_FOUND" });
    // flour is a raw material — no BOM of its own.
    await expect(withTenant(TENANT_M, () => boms.explode(fixture.items.flour, "100"))).rejects.toMatchObject({
      code: "BOM_NOT_FOUND",
    });
    // An explicit bomId belonging to another item is the same 404 shape.
    await expect(
      withTenant(TENANT_M, () => boms.explode(fixture.items.bread, "10", fixture.boms.dough.id)),
    ).rejects.toMatchObject({ code: "BOM_NOT_FOUND" });
  });
});
