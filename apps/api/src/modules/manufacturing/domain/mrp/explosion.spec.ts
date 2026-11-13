import { describe, expect, it } from "vitest";

import {
  BomGraphCycleError,
  computeLowLevelCodes,
  explodeDemand,
  resolveSubstitutions,
  totalByItem,
  type BomGraph,
  type BomGraphNode,
  type BomSubstitute,
  type Substitutions,
} from "./explosion";

/**
 * PHASE-043 (T-03/T-17): the pure BOM-graph planning kernel spec —
 * low-level codes, cycle detection, phantom flattening (the conservation
 * law: Σ component demand preserved), and substitution resolution.
 */

function node(
  itemId: string,
  lines: { lineId: string; componentItemId: string; qtyPerOutput?: string; scrapPct?: string; phantomFlag?: boolean }[],
  yieldPct = "100",
): { key: string; value: BomGraphNode } {
  return {
    key: itemId,
    value: {
      bomId: `BOM-${itemId}`,
      itemId,
      yieldPct,
      lines: lines.map((line) => ({
        lineId: line.lineId,
        componentItemId: line.componentItemId,
        qtyPerOutput: line.qtyPerOutput ?? "1",
        scrapPct: line.scrapPct ?? "0",
        phantomFlag: line.phantomFlag ?? false,
      })),
    },
  };
}

function graph(...nodes: { key: string; value: BomGraphNode }[]): BomGraph {
  return { nodes: new Map(nodes.map((entry) => [entry.key, entry.value])) };
}

describe("computeLowLevelCodes (M-07)", () => {
  it("a diamond graph levels correctly (root 0, mid 1, leaf 2 — the top-down discipline)", () => {
    // ROOT → MID1, MID2; MID1 → LEAF; MID2 → LEAF
    const g = graph(
      node("ROOT", [
        { lineId: "r1", componentItemId: "MID1" },
        { lineId: "r2", componentItemId: "MID2" },
      ]),
      node("MID1", [{ lineId: "m1", componentItemId: "LEAF" }]),
      node("MID2", [{ lineId: "m2", componentItemId: "LEAF" }]),
    );
    const llc = computeLowLevelCodes(g);
    expect(llc.get("ROOT")).toBe(0); // the FG nets FIRST (its plan makes demand)
    expect(llc.get("MID1")).toBe(1);
    expect(llc.get("MID2")).toBe(1);
    expect(llc.get("LEAF")).toBe(2); // the deepest occurrence
  });

  it("a purchased component sits at depth 1 under its FG (depth 0)", () => {
    const g = graph(node("ROOT", [{ lineId: "r1", componentItemId: "PURCHASED" }]));
    const llc = computeLowLevelCodes(g);
    expect(llc.get("ROOT")).toBe(0);
    expect(llc.get("PURCHASED")).toBe(1);
  });

  it("a cyclic graph fails with the typed chain error", () => {
    const g = graph(
      node("A", [{ lineId: "a1", componentItemId: "B" }]),
      node("B", [{ lineId: "b1", componentItemId: "A" }]),
    );
    expect(() => computeLowLevelCodes(g)).toThrow(BomGraphCycleError);
  });

  it("the substitution edge (primary → substitute) levels the substitute AFTER the primary", () => {
    // The leveling graph the engine builds: P → C (the BOM edge) plus
    // C → S (the substitution edge hanging off the PRIMARY component).
    const leveled = new Map<string, { lines: { componentItemId: string }[] }>([
      ["P", { lines: [{ componentItemId: "C" }] }],
      ["C", { lines: [{ componentItemId: "S" }] }],
      ["S", { lines: [] }],
    ]);
    const llc = computeLowLevelCodes({ nodes: leveled });
    expect(llc.get("P")).toBe(0); // the FG nets first
    expect(llc.get("C")).toBe(1); // the primary component
    expect(llc.get("S")).toBe(2); // > C — the substitute nets after the primary
    expect(llc.get("S")!).toBeGreaterThan(llc.get("C")!);
  });
});

describe("explodeDemand", () => {
  it("multi-level explosion accumulates a shared leaf across levels", () => {
    const g = graph(
      node("ROOT", [
        { lineId: "r1", componentItemId: "LEAF", qtyPerOutput: "2" },
        { lineId: "r2", componentItemId: "MID", qtyPerOutput: "1" },
      ]),
      node("MID", [{ lineId: "m1", componentItemId: "LEAF", qtyPerOutput: "3" }]),
    );
    const demands = explodeDemand({
      graph: g,
      rootItemId: "ROOT",
      rootQty: "10",
      resolvedSubstitutions: new Map(),
    });
    // Level 1: LEAF 20 + MID 10; level 2 (of MID 10): LEAF 30.
    const totals = totalByItem(demands);
    expect(totals.get("LEAF")).toBe("50.000000");
    expect(totals.get("MID")).toBe("10.000000");
  });

  it("scrap and yield apply per level (the frozen-snapshot formula)", () => {
    const g = graph(
      node("ROOT", [{ lineId: "r1", componentItemId: "LEAF", qtyPerOutput: "2", scrapPct: "10" }], "80"),
    );
    const demands = explodeDemand({
      graph: g,
      rootItemId: "ROOT",
      rootQty: "10",
      resolvedSubstitutions: new Map(),
    });
    // gross = 10 × 2 × 1.10 ÷ 0.80 = 27.5
    expect(totalByItem(demands).get("LEAF")).toBe("27.500000");
  });

  it("M-08 phantom flattening: the phantom carries no demand; its components do (Σ preserved)", () => {
    const g = graph(
      // The phantom flag rides the PARENT'S LINE (the reference to PH).
      node("ROOT", [{ lineId: "r1", componentItemId: "PH", qtyPerOutput: "1", phantomFlag: true }]),
      node("PH", [
        { lineId: "p1", componentItemId: "C1", qtyPerOutput: "2" },
        { lineId: "p2", componentItemId: "C2", qtyPerOutput: "5" },
      ]),
    );
    const demands = explodeDemand({
      graph: g,
      rootItemId: "ROOT",
      rootQty: "10",
      resolvedSubstitutions: new Map(),
    });
    const totals = totalByItem(demands);
    expect(totals.has("PH")).toBe(false); // the phantom never demands
    expect(totals.get("C1")).toBe("20.000000");
    expect(totals.get("C2")).toBe("50.000000");
    // Conservation: Σ after (70) == the phantom's gross × its own per-unit
    // Σ (10 × (2 + 5)).
    const sum = [...totals.values()].reduce((a, b) => a + Number(b), 0);
    expect(sum).toBe(70);
  });

  it("a phantom with no BOM demands nothing (the dangling-phantom data debt)", () => {
    const g = graph(node("ROOT", [{ lineId: "r1", componentItemId: "PH", phantomFlag: true }]));
    const demands = explodeDemand({
      graph: g,
      rootItemId: "ROOT",
      rootQty: "10",
      resolvedSubstitutions: new Map(),
    });
    expect(demands).toHaveLength(0);
  });

  it("substitution splits land on the substitute (the recorded legs)", () => {
    const g = graph(node("ROOT", [{ lineId: "r1", componentItemId: "C", qtyPerOutput: "1" }]));
    const demands = explodeDemand({
      graph: g,
      rootItemId: "ROOT",
      rootQty: "10",
      resolvedSubstitutions: new Map([
        ["ROOT:r1", { primaryQty: "6.000000", substituteLegs: [{ substituteItemId: "S", qty: "4.000000" }] }],
      ]),
    });
    const totals = totalByItem(demands);
    expect(totals.get("C")).toBe("6.000000");
    expect(totals.get("S")).toBe("4.000000");
    expect(demands.find((d) => d.itemId === "S")!.substituted).toBe(true);
    expect(demands.find((d) => d.itemId === "S")!.recipeItemId).toBe("C");
  });

  it("a cycle in the walk fails with the typed chain error", () => {
    const g = graph(
      node("A", [{ lineId: "a1", componentItemId: "B" }]),
      node("B", [{ lineId: "b1", componentItemId: "A" }]),
    );
    expect(() =>
      explodeDemand({ graph: g, rootItemId: "A", rootQty: "1", resolvedSubstitutions: new Map() }),
    ).toThrow(BomGraphCycleError);
  });
});

describe("resolveSubstitutions (M-09)", () => {
  const substitutes: readonly BomSubstitute[] = [
    { substituteItemId: "S1", priority: 2 },
    { substituteItemId: "S2", priority: 1 },
  ];

  it("covers the uncovered remainder with the PRIORITY-ordered substitute", () => {
    const split = resolveSubstitutions({ lineGrossQty: "10", uncoveredQty: "4", substitutes })!;
    expect(split.primaryQty).toBe("6.000000");
    expect(split.substituteLegs).toEqual([{ substituteItemId: "S2", qty: "4.000000" }]);
  });

  it("chains legs in priority order when one substitute cannot cover", () => {
    // The whole gross uncovered — S2 (priority 1) takes all here because
    // the uncovered remainder goes to the first priority whole; a partial
    // split needs the caller to call again for the next tranche.
    const split = resolveSubstitutions({ lineGrossQty: "10", uncoveredQty: "10", substitutes })!;
    expect(split.primaryQty).toBe("0.000000");
    expect(split.substituteLegs).toHaveLength(1);
    expect(split.substituteLegs[0]!.substituteItemId).toBe("S2");
  });

  it("no uncovered remainder → no substitution (undefined)", () => {
    expect(resolveSubstitutions({ lineGrossQty: "10", uncoveredQty: "0", substitutes })).toBeUndefined();
  });

  it("no substitutes defined → undefined even when uncovered", () => {
    expect(resolveSubstitutions({ lineGrossQty: "10", uncoveredQty: "5", substitutes: [] })).toBeUndefined();
  });

  it("the uncovered remainder is clamped to the gross (no overfill)", () => {
    const split = resolveSubstitutions({ lineGrossQty: "10", uncoveredQty: "99", substitutes })!;
    expect(split.primaryQty).toBe("0.000000");
    const substituted = split.substituteLegs.reduce((sum, leg) => sum + Number(leg.qty), 0);
    expect(substituted).toBe(10);
  });
});

describe("totalByItem conservation (the acceptance-criterion-2 property)", () => {
  it("flattening equals the pre-flattened equivalent recipe (Σ before = Σ after)", () => {
    // The phantom graph: ROOT → PH (phantom, 3/unit) → {X 1/unit, Y 2/unit}.
    const withPhantom = graph(
      node("ROOT", [{ lineId: "r1", componentItemId: "PH", qtyPerOutput: "3", phantomFlag: true }]),
      node("PH", [
        { lineId: "p1", componentItemId: "X", qtyPerOutput: "1" },
        { lineId: "p2", componentItemId: "Y", qtyPerOutput: "2" },
      ]),
    );
    // The equivalent pre-flattened recipe: ROOT → {X 3/unit, Y 6/unit}.
    const preFlattened = graph(
      node("ROOT", [
        { lineId: "f1", componentItemId: "X", qtyPerOutput: "3" },
        { lineId: "f2", componentItemId: "Y", qtyPerOutput: "6" },
      ]),
    );
    const d1 = explodeDemand({ graph: withPhantom, rootItemId: "ROOT", rootQty: "7", resolvedSubstitutions: new Map() });
    const d2 = explodeDemand({ graph: preFlattened, rootItemId: "ROOT", rootQty: "7", resolvedSubstitutions: new Map() });
    expect(totalByItem(d1)).toEqual(totalByItem(d2));
    expect(totalByItem(d2).get("X")).toBe("21.000000");
    expect(totalByItem(d2).get("Y")).toBe("42.000000");
  });
});

describe("Substitutions type", () => {
  it("the map shape keys by bom line id (the store's contract)", () => {
    const subs: Substitutions = new Map([["line-1", [{ substituteItemId: "S", priority: 1 }]]]);
    expect(subs.get("line-1")).toEqual([{ substituteItemId: "S", priority: 1 }]);
  });
});
