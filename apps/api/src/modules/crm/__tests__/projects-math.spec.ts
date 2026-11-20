import { describe, expect, it } from "vitest";

import {
  accruedThrough,
  allocateOverhead,
  type CurveCell,
  detectDependencyCycle,
  hourlyCostRate,
  inclusiveDays,
  monthlyEmployerCost,
  rollupWeightedPercent,
  wouldCreateParentCycle,
} from "../domain/projects-math";

/**
 * PHASE-048 (W-9) — the PURE engine math pinned at the unit layer,
 * FIRST (the plan §4's unit-first law: detectCycle · the weighted
 * rollup fold · the budget cost-curve interpolation — the 047
 * talent-math precedent). The DB-side behaviors (the tree over real
 * rows, the cycle refusals through the API, the node-by-node
 * reconciliation, the collectors + INV-033 to the cent) are pinned by
 * `src/__db__/projects/projects-wbs.db.spec.ts` +
 * `projects-budgets-actuals.db.spec.ts`.
 *
 * Every worked example below is hand-computed exact arithmetic — the
 * spec's job is to prove the LAWS, not to re-derive the inputs.
 */

describe("PHASE-048 W-9 — D-03: the dependency-cycle detector (detectCycle)", () => {
  it("(a) an edge back to the successor closes the loop — the path names it", () => {
    // B depends on A; adding "A depends on B" closes A→B→A.
    const cycle = detectDependencyCycle([{ taskId: "B", predecessorId: "A" }], {
      taskId: "A",
      predecessorId: "B",
    });
    expect(cycle).toEqual(["B", "A"]);
  });

  it("(b) a self-edge is an immediate cycle", () => {
    expect(detectDependencyCycle([], { taskId: "A", predecessorId: "A" })).toEqual(["A"]);
  });

  it("(c) a forward edge on an acyclic set is clean (null)", () => {
    // A ← B (B depends on A); C may depend on A — no loop.
    expect(
      detectDependencyCycle([{ taskId: "B", predecessorId: "A" }], {
        taskId: "C",
        predecessorId: "A",
      }),
    ).toBeNull();
    // A chain of three, extending the head — still clean.
    expect(
      detectDependencyCycle(
        [
          { taskId: "B", predecessorId: "A" },
          { taskId: "C", predecessorId: "B" },
        ],
        { taskId: "A", predecessorId: "D" },
      ),
    ).toBeNull();
  });

  it("(d) a diamond (two tasks sharing one predecessor) is NOT a cycle", () => {
    // B←A and C←A: A is the shared predecessor — the functional graph
    // has no loop (the 0100 single-predecessor law permits the shape).
    const edges = [
      { taskId: "B", predecessorId: "A" },
      { taskId: "C", predecessorId: "A" },
    ];
    expect(detectDependencyCycle(edges)).toBeNull();
  });

  it("(e) a pre-existing loop is detected even when the addition does not touch it", () => {
    // Corrupted substrate: A←B←C←A (a stored loop). Any walk entering
    // it must terminate with the cycle path (never an infinite walk).
    const edges = [
      { taskId: "A", predecessorId: "B" },
      { taskId: "B", predecessorId: "C" },
      { taskId: "C", predecessorId: "A" },
    ];
    const cycle = detectDependencyCycle(edges, { taskId: "D", predecessorId: "A" });
    expect(cycle).toEqual(["A", "B", "C", "A"]);
  });
});

describe("PHASE-048 W-9 — D-03: the parent-chain move guard", () => {
  it("(a) re-parenting under a descendant refuses (the loop closes)", () => {
    // X → A → Y (Y is X's descendant): moving X under Y would loop.
    const parentOf = new Map<string, string | null>([
      ["X", null],
      ["A", "X"],
      ["Y", "A"],
    ]);
    expect(wouldCreateParentCycle("X", "Y", parentOf)).toBe(true);
  });

  it("(b) re-parenting under an unrelated root is clean", () => {
    const parentOf = new Map<string, string | null>([
      ["X", "A"],
      ["A", null],
      ["Z", null],
    ]);
    expect(wouldCreateParentCycle("X", "Z", parentOf)).toBe(false);
  });

  it("(c) a corrupted pre-existing loop refuses the move (fail-closed)", () => {
    // P → Q → P (a corrupted chain that does not involve the mover):
    // the walk hits the seen-set and refuses — never an infinite loop.
    const parentOf = new Map<string, string | null>([
      ["P", "Q"],
      ["Q", "P"],
      ["M", null],
    ]);
    expect(wouldCreateParentCycle("M", "P", parentOf)).toBe(true);
  });
});

describe("PHASE-048 W-9 — BR-095: the weighted rollup fold (leaf-recomputed)", () => {
  it("(a) the hand-computed tree — every node node-by-node reconcilable", () => {
    // R = (60×50 + 30×80 + 10×20) / 100 = 56.00
    // B = (30×80 + 10×20) / 40 = 65.00 — the parent folds ONLY leaves
    const nodes = [
      { id: "R", parentTaskId: null, weight: null, percentComplete: "10.00" },
      { id: "A", parentTaskId: "R", weight: "60.0000", percentComplete: "50.00" },
      { id: "B", parentTaskId: "R", weight: "40.0000", percentComplete: "0.00" },
      { id: "B1", parentTaskId: "B", weight: "30.0000", percentComplete: "80.00" },
      { id: "B2", parentTaskId: "B", weight: "10.0000", percentComplete: "20.00" },
    ];
    const rollup = rollupWeightedPercent(nodes);
    expect(rollup.get("R")?.rolledPercent).toBe("56.00");
    expect(rollup.get("B")?.rolledPercent).toBe("65.00");
    expect(rollup.get("A")?.rolledPercent).toBe("50.00");
    expect(rollup.get("B1")?.rolledPercent).toBe("80.00");
    expect(rollup.get("B2")?.rolledPercent).toBe("20.00");
    // The subtree metadata: R's leaves = A + B1 + B2 (the parent's own
    // report NEVER enters the fold — D-03).
    expect(rollup.get("R")?.leafCount).toBe(3);
    expect(rollup.get("R")?.weightSum).toBe("100.0000");
    expect(rollup.get("B")?.leafCount).toBe(2);
  });

  it("(b) the NULL weight is the equal-share neutral (the plain mean)", () => {
    const nodes = [
      { id: "C", parentTaskId: null, weight: null, percentComplete: "0.00" },
      { id: "C1", parentTaskId: "C", weight: null, percentComplete: "40.00" },
      { id: "C2", parentTaskId: "C", weight: null, percentComplete: "80.00" },
    ];
    expect(rollupWeightedPercent(nodes).get("C")?.rolledPercent).toBe("60.00");
  });

  it("(c) the degenerate all-zero-weight subtree folds as the equal-share mean", () => {
    const nodes = [
      { id: "D", parentTaskId: null, weight: null, percentComplete: "0.00" },
      { id: "D1", parentTaskId: "D", weight: "0.0000", percentComplete: "10.00" },
      { id: "D2", parentTaskId: "D", weight: "0.0000", percentComplete: "30.00" },
    ];
    expect(rollupWeightedPercent(nodes).get("D")?.rolledPercent).toBe("20.00");
  });

  it("(d) ONE half-up rounding point at the total — 55/3 = 18.33", () => {
    const nodes = [
      { id: "E", parentTaskId: null, weight: null, percentComplete: "0.00" },
      { id: "E1", parentTaskId: "E", weight: "1.0000", percentComplete: "10.00" },
      { id: "E2", parentTaskId: "E", weight: "1.0000", percentComplete: "20.00" },
      { id: "E3", parentTaskId: "E", weight: "1.0000", percentComplete: "25.00" },
    ];
    expect(rollupWeightedPercent(nodes).get("E")?.rolledPercent).toBe("18.33");
  });

  it("(e) the exact tie rounds half-UP: (10.00 + 10.01)/2 = 10.005 → 10.01", () => {
    const nodes = [
      { id: "F", parentTaskId: null, weight: null, percentComplete: "0.00" },
      { id: "F1", parentTaskId: "F", weight: "1.0000", percentComplete: "10.00" },
      { id: "F2", parentTaskId: "F", weight: "1.0000", percentComplete: "10.01" },
    ];
    expect(rollupWeightedPercent(nodes).get("F")?.rolledPercent).toBe("10.01");
  });

  it("(f) a single-node tree: the root IS the leaf — its own report stands", () => {
    const nodes = [{ id: "SOLO", parentTaskId: null, weight: null, percentComplete: "42.50" }];
    const rollup = rollupWeightedPercent(nodes);
    expect(rollup.get("SOLO")?.rolledPercent).toBe("42.50");
    expect(rollup.get("SOLO")?.leafCount).toBe(1);
  });
});

describe("PHASE-048 W-9 — D-04: the budget cost-curve interpolation", () => {
  const cell = (start: string, end: string, amount: string): CurveCell => ({
    periodStart: start,
    periodEnd: end,
    plannedAmount: amount,
  });

  it("(a) inclusiveDays: the window's own day counts", () => {
    expect(inclusiveDays("2026-01-01", "2026-01-10")).toBe(10);
    expect(inclusiveDays("2026-01-01", "2026-01-01")).toBe(1);
  });

  it("(b) the uniform spread — before/inside/past the window", () => {
    const cells = [cell("2026-01-01", "2026-01-10", "1000.0000")];
    expect(accruedThrough(cells, "2025-12-31")).toBe("0.0000"); // before
    expect(accruedThrough(cells, "2026-01-01")).toBe("100.0000"); // day 1 of 10
    expect(accruedThrough(cells, "2026-01-05")).toBe("500.0000"); // day 5 of 10
    expect(accruedThrough(cells, "2026-01-10")).toBe("1000.0000"); // the last day
    expect(accruedThrough(cells, "2026-02-01")).toBe("1000.0000"); // past
  });

  it("(c) the ONE-rounding-point law: two 100-over-3 cells at day 2 = 400/3 = 133.3333 (per-cell rounding would fabricate 133.3334)", () => {
    const cells = [
      cell("2026-01-01", "2026-01-03", "100.0000"),
      cell("2026-01-01", "2026-01-03", "100.0000"),
    ];
    expect(accruedThrough(cells, "2026-01-02")).toBe("133.3333");
  });

  it("(d) the LCM arm — 200/3 + 400/7 = 2600/21 = 123.8095", () => {
    const cells = [
      cell("2026-01-01", "2026-01-03", "100.0000"),
      cell("2026-01-01", "2026-01-07", "200.0000"),
    ];
    expect(accruedThrough(cells, "2026-01-02")).toBe("123.8095");
  });

  it("(e) non-overlapping windows accrue independently — 1600 at Jan 16, 4500 at Feb 14", () => {
    const cells = [
      cell("2026-01-01", "2026-01-31", "3100.0000"), // 100/day
      cell("2026-02-01", "2026-02-28", "2800.0000"), // 100/day
    ];
    expect(accruedThrough(cells, "2026-01-16")).toBe("1600.0000");
    // cell 1 complete (3100) + cell 2 at day 14 (1400) = 4500
    expect(accruedThrough(cells, "2026-02-14")).toBe("4500.0000");
  });
});

describe("PHASE-048 W-9 — D-05: the overhead distributor fold", () => {
  it("(a) the driver share splits the pool exactly", () => {
    const result = allocateOverhead("10000.0000", [
      { projectId: "P1", driverValue: "120.0000" },
      { projectId: "P2", driverValue: "80.0000" },
    ]);
    expect(result).toEqual([
      { projectId: "P1", allocated: "6000.0000", share: "0.600000" },
      { projectId: "P2", allocated: "4000.0000", share: "0.400000" },
    ]);
  });

  it("(b) the thirds: 100 over three equal drivers = 33.3333 each (half-up)", () => {
    const result = allocateOverhead("100.0000", [
      { projectId: "P1", driverValue: "1.0000" },
      { projectId: "P2", driverValue: "1.0000" },
      { projectId: "P3", driverValue: "1.0000" },
    ]);
    expect(result.map((entry) => entry.allocated)).toEqual(["33.3333", "33.3333", "33.3333"]);
  });

  it("(c) a zero pool or an all-zero driver set allocates honest zeros", () => {
    expect(allocateOverhead("0.0000", [{ projectId: "P1", driverValue: "10.0000" }])[0]?.allocated).toBe(
      "0.0000",
    );
    expect(
      allocateOverhead("500.0000", [
        { projectId: "P1", driverValue: "0.0000" },
        { projectId: "P2", driverValue: "0.0000" },
      ]).map((entry) => entry.allocated),
    ).toEqual(["0.0000", "0.0000"]);
  });

  it("(d) the exact tie at the money scale rounds half-UP per project", () => {
    // pool 1.0001 over two equal drivers: 0.50005 → 0.5001 each (the
    // documented per-project rounding point — the Σ may exceed the pool
    // by the rounding residue; the posting reads the SAME fold).
    const result = allocateOverhead("1.0001", [
      { projectId: "P1", driverValue: "1.0000" },
      { projectId: "P2", driverValue: "1.0000" },
    ]);
    expect(result.map((entry) => entry.allocated)).toEqual(["0.5001", "0.5001"]);
  });
});

describe("PHASE-048 W-9 — D-05/D-01: the payroll read-only rate fold", () => {
  it("(a) monthlyEmployerCost: basic + allowances + employer contributions in the documented order", () => {
    // basic 10,000 + FIXED allowance 2,000 → gross 12,000
    // + 10% of basic = 1,000 → gross 13,000
    // + 5% of gross-before-it (13,000) = 650 → total 13,650
    // the DEDUCTION 500 NEVER enters the employer cost.
    const cost = monthlyEmployerCost("10000.0000", [
      { kind: "EMPLOYER_CONTRIBUTION", calc: "PERCENT_OF_GROSS", amount: null, rate: "5.0000" },
      { kind: "ALLOWANCE", calc: "PERCENT_OF_BASIC", amount: null, rate: "10.0000" },
      { kind: "DEDUCTION", calc: "FIXED", amount: "500.0000", rate: null },
      { kind: "ALLOWANCE", calc: "FIXED", amount: "2000.0000", rate: null },
    ]);
    expect(cost).toBe("13650.0000");
  });

  it("(b) the bare basic: no components — the cost is the basic", () => {
    expect(monthlyEmployerCost("7500.0000", [])).toBe("7500.0000");
  });

  it("(c) hourlyCostRate: monthly ÷ standard hours, ONE rounding at the 6-dp rate", () => {
    expect(hourlyCostRate("13650.0000", 208)).toBe("65.625000"); // exact
    expect(hourlyCostRate("100.0000", 3)).toBe("33.333333"); // 100/3 → half-up
    expect(hourlyCostRate("0.0000", 208)).toBe("0.000000");
  });

  it("(d) hourlyCostRate refuses the absent/invalid divisor — null, never a fabricated rate", () => {
    expect(hourlyCostRate("13650.0000", null)).toBeNull();
    expect(hourlyCostRate("13650.0000", 0)).toBeNull();
    expect(hourlyCostRate("13650.0000", 745)).toBeNull();
    expect(hourlyCostRate("13650.0000", 208.5)).toBeNull();
  });
});
