import { describe, expect, it } from "vitest";

import type { JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import {
  computeRevaluationLines,
  revaluationAccumRestatement,
  revaluationOldAccumulated,
  sumDirection,
} from "./current-basis";
import { computeDisposalLines } from "./disposal-service";
import { registerExpectedSides } from "./fixed-assets-reconciliation";

/**
 * PHASE-026 P26-C PURE UNIT suite (no DB — the embedded-PG gate is
 * orchestrator-only): the G-23 disposal line algebra for all four document
 * shapes (gain sale, loss sale, zero-proceeds SCRAP of a fully-depreciated
 * asset, SCRAP with proceeds), the BR-044 revaluation mirror in BOTH
 * directions (plus the zero-delta pure reclass), and the RC-10 register-fold
 * algebra — every case asserted BALANCED with exact decimal strings (no
 * Math.*, ADR-0009). These are the line-builder contracts the DB golden
 * suite (G-23 fixtures, ACCOUNTING_TESTS §3) re-asserts end-to-end.
 */

function assertBalanced(lines: readonly JournalLineSpec[]): void {
  const debits = sumDirection(lines, "DEBIT");
  const credits = sumDirection(lines, "CREDIT");
  expect(compareExact(debits, credits)).toBe(0);
  expect(debits).toBe(credits);
}

function assertEngineShape(lines: readonly JournalLineSpec[]): void {
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    // The engine contract: amount > 0, purpose-keyed, direction binary.
    expect(compareExact(line.amount, "0")).toBeGreaterThan(0);
    expect(line.amount.startsWith("-")).toBe(false);
    expect(line.purpose).toBeDefined();
    expect(line.direction === "DEBIT" || line.direction === "CREDIT").toBe(true);
  }
}

function legs(lines: readonly JournalLineSpec[]): string[] {
  return lines.map((line) => `${line.direction} ${line.purpose} ${line.amount}`);
}

const DISPOSAL_BASE = {
  cashPurposeKey: "CASH",
  assetPurposeKey: "FIXED_ASSET",
  accumDepreciationPurposeKey: "ACCUM_DEPRECIATION",
} as const;

describe("G-23 disposal line algebra (computeDisposalLines)", () => {
  it("gain sale: DR CASH · DR ACCUM · CR FIXED_ASSET · CR ASSET_DISPOSAL_GAIN (residual)", () => {
    // cost 10000, accumulated 4000 ⇒ NBV 6000; sold for 8000 ⇒ gain 2000.
    const lines = computeDisposalLines({
      ...DISPOSAL_BASE,
      cost: "10000.0000",
      proceeds: "8000.0000",
      accumulatedSnapshot: "4000.0000",
      netBookValue: "6000.0000",
    });
    expect(legs(lines)).toEqual([
      "DEBIT CASH 8000.0000",
      "DEBIT ACCUM_DEPRECIATION 4000.0000",
      "CREDIT FIXED_ASSET 10000.0000",
      "CREDIT ASSET_DISPOSAL_GAIN 2000.0000",
    ]);
    assertBalanced(lines);
    assertEngineShape(lines);
    expect(lines.some((l) => l.purpose === "ASSET_DISPOSAL_LOSS")).toBe(false);
  });

  it("loss sale: the LOSS MIRROR is mandatory — DR ASSET_DISPOSAL_LOSS replaces the gain line", () => {
    // NBV 6000, sold for 5000 ⇒ loss 1000 (register §F mirror).
    const lines = computeDisposalLines({
      ...DISPOSAL_BASE,
      cost: "10000.0000",
      proceeds: "5000.0000",
      accumulatedSnapshot: "4000.0000",
      netBookValue: "6000.0000",
    });
    expect(legs(lines)).toEqual([
      "DEBIT CASH 5000.0000",
      "DEBIT ACCUM_DEPRECIATION 4000.0000",
      "CREDIT FIXED_ASSET 10000.0000",
      "DEBIT ASSET_DISPOSAL_LOSS 1000.0000",
    ]);
    assertBalanced(lines);
    assertEngineShape(lines);
    expect(lines.some((l) => l.purpose === "ASSET_DISPOSAL_GAIN")).toBe(false);
  });

  it("zero-proceeds SCRAP of a fully-depreciated asset: DR ACCUM · CR FIXED_ASSET only (cash and residual legs omitted at 0)", () => {
    // cost 10000, accumulated 10000 ⇒ NBV 0; scrapped for an explicit 0.
    const lines = computeDisposalLines({
      ...DISPOSAL_BASE,
      cost: "10000.0000",
      proceeds: "0.0000",
      accumulatedSnapshot: "10000.0000",
      netBookValue: "0.0000",
    });
    expect(legs(lines)).toEqual([
      "DEBIT ACCUM_DEPRECIATION 10000.0000",
      "CREDIT FIXED_ASSET 10000.0000",
    ]);
    assertBalanced(lines);
    assertEngineShape(lines);
  });

  it("SCRAP with proceeds (salvage sold for parts): cash leg posts and the loss mirror fires", () => {
    // cost 8000, accumulated 6000 ⇒ NBV 2000; scrapped for 1500 ⇒ loss 500.
    const lines = computeDisposalLines({
      ...DISPOSAL_BASE,
      cost: "8000.0000",
      proceeds: "1500.0000",
      accumulatedSnapshot: "6000.0000",
      netBookValue: "2000.0000",
    });
    expect(legs(lines)).toEqual([
      "DEBIT CASH 1500.0000",
      "DEBIT ACCUM_DEPRECIATION 6000.0000",
      "CREDIT FIXED_ASSET 8000.0000",
      "DEBIT ASSET_DISPOSAL_LOSS 500.0000",
    ]);
    assertBalanced(lines);
    assertEngineShape(lines);
  });

  it("break-even sale (proceeds = NBV): no gain, no loss — three legs only", () => {
    const lines = computeDisposalLines({
      ...DISPOSAL_BASE,
      cost: "9000.0000",
      proceeds: "6000.0000",
      accumulatedSnapshot: "3000.0000",
      netBookValue: "6000.0000",
    });
    expect(legs(lines)).toEqual([
      "DEBIT CASH 6000.0000",
      "DEBIT ACCUM_DEPRECIATION 3000.0000",
      "CREDIT FIXED_ASSET 9000.0000",
    ]);
    assertBalanced(lines);
  });

  it("is balanced by construction across a spread of shapes (property-style sweep)", () => {
    // NBV = cost − accum invariant held; proceeds swept across the range.
    const cases = [
      ["10000.0000", "0.0000", "10000.0000", "0.0000"],
      ["10000.0000", "2500.0000", "2500.0000", "7500.0000"],
      ["10000.0000", "9999.9999", "9999.9999", "0.0001"],
      ["1.0000", "1.0000", "0.0000", "1.0000"],
      ["12345.6789", "4567.8901", "4567.8901", "7777.7888"],
    ] as const;
    for (const [cost, proceeds, accum, nbv] of cases) {
      // Fixture honesty: NBV = cost − accumulated (the frozen invariant).
      expect(compareExact(nbv, subExact(cost, accum))).toBe(0);
      assertBalanced(
        computeDisposalLines({
          ...DISPOSAL_BASE,
          cost,
          proceeds,
          accumulatedSnapshot: accum,
          netBookValue: nbv,
        }),
      );
      assertEngineShape(
        computeDisposalLines({
          ...DISPOSAL_BASE,
          cost,
          proceeds,
          accumulatedSnapshot: accum,
          netBookValue: nbv,
        }),
      );
    }
  });
});

describe("BR-044 revaluation line algebra (computeRevaluationLines)", () => {
  const REVAL_BASE = {
    assetPurposeKey: "FIXED_ASSET",
    accumDepreciationPurposeKey: "ACCUM_DEPRECIATION",
    reservePurposeKey: "REVALUATION_RESERVE",
    cost: "10000.0000",
  } as const;

  it("upward revaluation: DR FIXED_ASSET (gross delta) · CR REVALUATION_RESERVE (delta)", () => {
    // cost 10000, accum 4000 ⇒ NBV 6000; new basis 12000/4000 ⇒ delta 2000.
    const lines = computeRevaluationLines({
      ...REVAL_BASE,
      newGrossValue: "12000.0000",
      newAccumulated: "4000.0000",
      delta: "2000.0000",
    });
    expect(legs(lines)).toEqual([
      "DEBIT FIXED_ASSET 2000.0000",
      "CREDIT REVALUATION_RESERVE 2000.0000",
    ]);
    assertBalanced(lines);
    assertEngineShape(lines);
  });

  it("upward revaluation with accum restatement DOWN: the full three-way mirror", () => {
    // new basis 12000/3000 ⇒ newNBV 9000, delta 3000; g = 2000, r = −1000.
    const lines = computeRevaluationLines({
      ...REVAL_BASE,
      newGrossValue: "12000.0000",
      newAccumulated: "3000.0000",
      delta: "3000.0000",
    });
    expect(legs(lines)).toEqual([
      "DEBIT FIXED_ASSET 2000.0000",
      "DEBIT ACCUM_DEPRECIATION 1000.0000",
      "CREDIT REVALUATION_RESERVE 3000.0000",
    ]);
    assertBalanced(lines);
    // oldAccum reconstructed from the frozen delta: 3000 − (2000 − 3000) = 4000.
    expect(
      revaluationOldAccumulated("10000.0000", "12000.0000", "3000.0000", "3000.0000"),
    ).toBe("4000.0000");
  });

  it("downward revaluation: CR FIXED_ASSET · DR REVALUATION_RESERVE", () => {
    // new basis 9000/4000 ⇒ newNBV 5000, delta −1000; g = −1000, r = 0.
    const lines = computeRevaluationLines({
      ...REVAL_BASE,
      newGrossValue: "9000.0000",
      newAccumulated: "4000.0000",
      delta: "-1000.0000",
    });
    expect(legs(lines)).toEqual([
      "CREDIT FIXED_ASSET 1000.0000",
      "DEBIT REVALUATION_RESERVE 1000.0000",
    ]);
    assertBalanced(lines);
    assertEngineShape(lines);
  });

  it("downward revaluation with accum restatement UP: three-way mirror in the other direction", () => {
    // new basis 9000/5000 ⇒ newNBV 4000, delta −2000; g = −1000, r = +1000
    // (accum INCREASES 4000 → 5000 ⇒ CR — the accum account is credit-normal).
    const lines = computeRevaluationLines({
      ...REVAL_BASE,
      newGrossValue: "9000.0000",
      newAccumulated: "5000.0000",
      delta: "-2000.0000",
    });
    expect(legs(lines)).toEqual([
      "CREDIT FIXED_ASSET 1000.0000",
      "CREDIT ACCUM_DEPRECIATION 1000.0000",
      "DEBIT REVALUATION_RESERVE 2000.0000",
    ]);
    assertBalanced(lines);
  });

  it("zero-delta pure reclass: the two mirror legs post, the reserve line is SKIPPED (never a zero line)", () => {
    // new basis 11000/5000 ⇒ newNBV 6000 = oldNBV ⇒ delta 0; g = 1000 = r.
    const lines = computeRevaluationLines({
      ...REVAL_BASE,
      newGrossValue: "11000.0000",
      newAccumulated: "5000.0000",
      delta: "0.0000",
    });
    expect(legs(lines)).toEqual([
      "DEBIT FIXED_ASSET 1000.0000",
      "CREDIT ACCUM_DEPRECIATION 1000.0000",
    ]);
    expect(lines.some((l) => l.purpose === "REVALUATION_RESERVE")).toBe(false);
    assertBalanced(lines);
    assertEngineShape(lines);
  });

  it("a full no-op basis yields ZERO lines (the service rejects it — a revaluation must move something)", () => {
    const lines = computeRevaluationLines({
      ...REVAL_BASE,
      newGrossValue: "10000.0000",
      newAccumulated: "4000.0000",
      delta: "0.0000",
    });
    expect(lines).toEqual([]);
  });

  it("the algebra identity g = r + delta holds for every direction (signed, exact)", () => {
    const cases = [
      { newGross: "12000.0000", delta: "2000.0000" },
      { newGross: "12000.0000", delta: "3000.0000" },
      { newGross: "9000.0000", delta: "-1000.0000" },
      { newGross: "9000.0000", delta: "-2000.0000" },
      { newGross: "11000.0000", delta: "0.0000" },
    ];
    for (const c of cases) {
      const g = addExact(c.newGross, "-10000.0000");
      const r = revaluationAccumRestatement("10000.0000", c.newGross, c.delta);
      expect(compareExact(g, addExact(r, c.delta))).toBe(0);
      // …so the built lines are balanced by construction:
      assertBalanced(
        computeRevaluationLines({
          ...REVAL_BASE,
          newGrossValue: c.newGross,
          newAccumulated: "4000.0000",
          delta: c.delta,
        }),
      );
    }
  });
});

describe("RC-10 register-fold algebra (registerExpectedSides)", () => {
  const CATEGORIES = [
    {
      id: "cat-veh",
      code: "VEH",
      assetPurposeKey: "FIXED_ASSET",
      accumDepreciationPurposeKey: "ACCUM_DEPRECIATION",
    },
  ];

  it("plain register: Σ cost on FIXED_ASSET, Σ (opening + posted lines) on ACCUM_DEPRECIATION — never from NBV", () => {
    const sides = registerExpectedSides({
      categories: CATEGORIES,
      assets: [
        { id: "a1", categoryId: "cat-veh", cost: "10000.0000", status: "ACTIVE", accumulated: "4000.0000" },
        { id: "a2", categoryId: "cat-veh", cost: "8000.0000", status: "FULLY_DEPRECIATED", accumulated: "8000.0000" },
      ],
      revaluations: [],
    });
    const fa = sides.find((s) => s.side === "FIXED_ASSET");
    const accum = sides.find((s) => s.side === "ACCUM_DEPRECIATION");
    expect(fa?.expected).toBe("18000.0000");
    expect(accum?.expected).toBe("12000.0000");
  });

  it("revalued asset: the FA side gains the gross delta, the accum side gains the restatement r = (newGross − cost) − delta", () => {
    const sides = registerExpectedSides({
      categories: CATEGORIES,
      assets: [
        { id: "a1", categoryId: "cat-veh", cost: "10000.0000", status: "ACTIVE", accumulated: "4000.0000" },
      ],
      revaluations: [{ assetId: "a1", newGrossValue: "12000.0000", delta: "2000.0000" }],
    });
    // FA = cost 10000 + g 2000; accum = 4000 + r (2000 − 2000 = 0).
    expect(sides.find((s) => s.side === "FIXED_ASSET")?.expected).toBe("12000.0000");
    expect(sides.find((s) => s.side === "ACCUM_DEPRECIATION")?.expected).toBe("4000.0000");
  });

  it("disposed asset: contributes ONLY its revaluation residue (the no-recycling policy)", () => {
    // a2: cost 8000 fully depreciated (accum 8000), revalued up (newGross
    // 9000, delta 1000 ⇒ g 1000, r 0), then disposed: the disposal journal
    // credited FA 8000 and debited accum 8000 — the residue {FA 1000,
    // ACCUM 0} stays on the GL against the reserve.
    const sides = registerExpectedSides({
      categories: CATEGORIES,
      assets: [
        { id: "a1", categoryId: "cat-veh", cost: "10000.0000", status: "ACTIVE", accumulated: "4000.0000" },
        { id: "a2", categoryId: "cat-veh", cost: "8000.0000", status: "DISPOSED", accumulated: "8000.0000" },
      ],
      revaluations: [{ assetId: "a2", newGrossValue: "9000.0000", delta: "1000.0000" }],
    });
    // FA = a1 10000 + a2 residue 1000; accum = a1 4000 + a2 residue 0.
    expect(sides.find((s) => s.side === "FIXED_ASSET")?.expected).toBe("11000.0000");
    expect(sides.find((s) => s.side === "ACCUM_DEPRECIATION")?.expected).toBe("4000.0000");
  });

  it("downward revaluation on a disposed asset leaves a NEGATIVE FA residue (signed accumulation)", () => {
    const sides = registerExpectedSides({
      categories: CATEGORIES,
      assets: [
        { id: "a2", categoryId: "cat-veh", cost: "8000.0000", status: "DISPOSED", accumulated: "8000.0000" },
      ],
      revaluations: [{ assetId: "a2", newGrossValue: "7000.0000", delta: "-1000.0000" }],
    });
    // g = −1000, r = −1000 − (−1000) = 0 ⇒ FA residue −1000, accum 0.
    expect(sides.find((s) => s.side === "FIXED_ASSET")?.expected).toBe("-1000.0000");
    expect(sides.find((s) => s.side === "ACCUM_DEPRECIATION")?.expected).toBe("0.0000");
  });

  it("categories sharing a purpose key aggregate into one side row (the GL is per account)", () => {
    const sides = registerExpectedSides({
      categories: [
        ...CATEGORIES,
        {
          id: "cat-it",
          code: "IT",
          assetPurposeKey: "FIXED_ASSET",
          accumDepreciationPurposeKey: "ACCUM_DEPRECIATION",
        },
      ],
      assets: [
        { id: "a1", categoryId: "cat-veh", cost: "10000.0000", status: "ACTIVE", accumulated: "4000.0000" },
        { id: "a3", categoryId: "cat-it", cost: "2000.0000", status: "ACTIVE", accumulated: "500.0000" },
      ],
      revaluations: [],
    });
    const fa = sides.find((s) => s.side === "FIXED_ASSET");
    expect(fa?.expected).toBe("12000.0000");
    expect(fa?.categories).toEqual(["IT", "VEH"]);
    expect(sides.find((s) => s.side === "ACCUM_DEPRECIATION")?.expected).toBe("4500.0000");
  });

  it("an empty register folds to zero sides (nothing to reconcile — the NOT_APPLICABLE branch)", () => {
    expect(
      registerExpectedSides({ categories: CATEGORIES, assets: [], revaluations: [] }),
    ).toEqual([]);
  });
});
