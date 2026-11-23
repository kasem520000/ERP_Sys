import { describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  SPC_CONSTANTS,
  SPC_SUBGROUP_SIZE_MAX,
  SPC_SUBGROUP_SIZE_MIN,
  SpcInsufficientSamplesError,
  SpcSubgroupSizeInvalidError,
  computeXbarRChart,
} from "./spc-statistics";

/**
 * PHASE-050 (W-27 — T-09, 2026-11-23) THE SPC PROPERTY TESTS ON PINNED
 * REFERENCE DATASETS (D-12's unit-first law; acceptance #5's own arm —
 * the phase doc §7's "wrong control limits silently mislead" risk is
 * answered HERE, before any consumer exists): three pinned datasets
 * (A stable · B the X-chart mean shift · C the R-chart range spike)
 * whose every figure was computed INDEPENDENTLY by hand and pinned as
 * string literals — the fold must reproduce them EXACTLY (6dp,
 * ROUND_HALF_UP). The properties then walk the laws the datasets alone
 * cannot: the constants table's own shape, order-freedom within a
 * subgroup, the trailing-partial exclusion, the no-fabrication nulls,
 * the degenerate collapse with its inclusive-tie proof, and the
 * arithmetic against an independent JS-number oracle.
 */

const BAND = { ucl: "10.600000", lcl: "9.400000" };

// DATASET A (stable, n=5, 4 subgroups) — every subgroup hand-balanced:
//   s1 10.0 10.2 9.8 10.1 9.9 → x̄ 10.000000 · R 0.400000
//   s2 10.1 10.3 9.9 10.0 10.2 → x̄ 10.100000 · R 0.400000
//   s3 9.9 10.0 10.2 10.1 9.8  → x̄ 10.000000 · R 0.400000
//   s4 10.2 9.8 10.1 10.0 9.9  → x̄ 10.000000 · R 0.400000
// X̄̄ = 40.1/4 = 10.025000 · R̄ = 0.400000
// UCLx = 10.025 + 0.577×0.4 = 10.255800 · LCLx = 9.794200
// UCLr = 2.114×0.4 = 0.845600 · LCLr = 0.000000
// σ̂ = 0.4/2.326 = 0.171969 (6dp)
// Cp = 1.2/(6×0.4/2.326) = 1.2×2.326/2.4 = 1.163000 EXACT
// Cpk = min(0.575, 0.625)×2.326/1.2 = 0.575×2.326/1.2 = 1.114542 (6dp)
const DATASET_A = [
  "10.0", "10.2", "9.8", "10.1", "9.9",
  "10.1", "10.3", "9.9", "10.0", "10.2",
  "9.9", "10.0", "10.2", "10.1", "9.8",
  "10.2", "9.8", "10.1", "10.0", "9.9",
];

// DATASET B (the X-chart mean shift): dataset A + a 5th subgroup
//   s5 11.0 10.9 11.0 11.0 10.9 → x̄ 10.960000 · R 0.100000
// X̄̄ = 51.06/5 = 10.212000 · R̄ = 1.7/5 = 0.340000
// UCLx = 10.212 + 0.577×0.34 = 10.408180 → x̄₅ = 10.96 FLAGGED (X)
// UCLr = 2.114×0.34 = 0.718760 → r₅ = 0.1 NOT flagged (R)
// σ̂ = 0.34/2.326 = 0.146174 (6dp: 0.14617369…)
// Cp = 1.2×2.326/2.04 = 1.368235 (6dp: 1.36823529…)
// Cpk = min(10.6−10.212, 10.212−9.4)×2.326/1.02 = 0.388×2.326/1.02
//     = 0.902488/1.02 = 0.884792 (6dp: 0.88479215…)
const DATASET_B = [...DATASET_A, "11.0", "10.9", "11.0", "11.0", "10.9"];

// DATASET C (the R-chart range spike): dataset A + a 5th subgroup
//   s5 11.5 10.0 10.1 9.9 10.0 → x̄ 10.300000 · R 1.600000
// X̄̄ = 50.4/5 = 10.080000 · R̄ = 3.2/5 = 0.640000
// UCLx = 10.08 + 0.577×0.64 = 10.449280 → x̄₅ = 10.3 NOT flagged (X)
// UCLr = 2.114×0.64 = 1.352960 → r₅ = 1.6 FLAGGED (R)
const DATASET_C = [...DATASET_A, "11.5", "10.0", "10.1", "9.9", "10.0"];

describe("PHASE-050 W-27 — the SPC pure module on the pinned reference datasets", () => {
  it("DATASET A (stable): every published figure exactly the hand-computed pin", () => {
    const chart = computeXbarRChart({ values: DATASET_A, subgroupSize: 5, band: BAND });
    expect(chart.excludedCount).toBe(0);
    expect(chart.subgroups).toHaveLength(4);
    expect(chart.subgroups.map((group) => group.mean)).toEqual([
      "10.000000",
      "10.100000",
      "10.000000",
      "10.000000",
    ]);
    expect(chart.subgroups.map((group) => group.range)).toEqual([
      "0.400000",
      "0.400000",
      "0.400000",
      "0.400000",
    ]);
    expect(chart.grandMean).toBe("10.025000");
    expect(chart.rBar).toBe("0.400000");
    expect(chart.xChart).toEqual({ ucl: "10.255800", lcl: "9.794200" });
    expect(chart.rChart).toEqual({ ucl: "0.845600", lcl: "0.000000" });
    expect(chart.sigmaHat).toBe("0.171969");
    expect(chart.cp).toBe("1.163000");
    expect(chart.cpk).toBe("1.114542");
    expect(chart.outOfControl).toBe(false);
    expect(chart.subgroups.every((group) => !group.xOutOfControl && !group.rOutOfControl)).toBe(true);
  });

  it("DATASET B (the mean shift): the fifth subgroup flagged on the X chart only", () => {
    const chart = computeXbarRChart({ values: DATASET_B, subgroupSize: 5, band: BAND });
    expect(chart.grandMean).toBe("10.212000");
    expect(chart.rBar).toBe("0.340000");
    expect(chart.xChart).toEqual({ ucl: "10.408180", lcl: "10.015820" });
    expect(chart.rChart).toEqual({ ucl: "0.718760", lcl: "0.000000" });
    expect(chart.sigmaHat).toBe("0.146174");
    expect(chart.cp).toBe("1.368235");
    expect(chart.cpk).toBe("0.884792");
    expect(chart.subgroups[4]!.mean).toBe("10.960000");
    expect(chart.subgroups[4]!.xOutOfControl).toBe(true);
    expect(chart.subgroups[4]!.rOutOfControl).toBe(false);
    expect(chart.outOfControl).toBe(true);
  });

  it("DATASET C (the range spike): the fifth subgroup flagged on the R chart only", () => {
    const chart = computeXbarRChart({ values: DATASET_C, subgroupSize: 5, band: BAND });
    expect(chart.grandMean).toBe("10.080000");
    expect(chart.rBar).toBe("0.640000");
    expect(chart.xChart).toEqual({ ucl: "10.449280", lcl: "9.710720" });
    expect(chart.rChart).toEqual({ ucl: "1.352960", lcl: "0.000000" });
    expect(chart.subgroups[4]!.mean).toBe("10.300000");
    expect(chart.subgroups[4]!.range).toBe("1.600000");
    expect(chart.subgroups[4]!.xOutOfControl).toBe(false);
    expect(chart.subgroups[4]!.rOutOfControl).toBe(true);
    expect(chart.outOfControl).toBe(true);
  });

  it("the subgroup-size domain: sizes outside the pinned table are refused BY NAME", () => {
    expect(() => computeXbarRChart({ values: DATASET_A, subgroupSize: 1, band: BAND })).toThrow(
      SpcSubgroupSizeInvalidError,
    );
    expect(() => computeXbarRChart({ values: DATASET_A, subgroupSize: 11, band: BAND })).toThrow(
      SpcSubgroupSizeInvalidError,
    );
    try {
      computeXbarRChart({ values: DATASET_A, subgroupSize: 11, band: BAND });
    } catch (error) {
      expect((error as SpcSubgroupSizeInvalidError).details).toEqual({
        subgroupSize: 11,
        min: SPC_SUBGROUP_SIZE_MIN,
        max: SPC_SUBGROUP_SIZE_MAX,
      });
    }
  });

  it("fewer samples than one complete subgroup is the typed refusal carrying BOTH figures", () => {
    expect(() => computeXbarRChart({ values: DATASET_A.slice(0, 4), subgroupSize: 5, band: BAND })).toThrow(
      SpcInsufficientSamplesError,
    );
    try {
      computeXbarRChart({ values: ["1.0", "2.0"], subgroupSize: 5, band: BAND });
    } catch (error) {
      expect((error as SpcInsufficientSamplesError).details).toEqual({ have: 2, need: 5 });
    }
  });

  it("the trailing partial group is excluded and disclosed — the chart's figures are the complete groups' own", () => {
    const withPartial = [...DATASET_A, "13.7", "0.1"];
    const chart = computeXbarRChart({ values: withPartial, subgroupSize: 5, band: BAND });
    expect(chart.excludedCount).toBe(2);
    expect(chart.subgroups).toHaveLength(4);
    // The wild partial samples never touched the arithmetic:
    expect(chart.grandMean).toBe("10.025000");
    expect(chart.rBar).toBe("0.400000");
    expect(chart.cp).toBe("1.163000");
    expect(chart.outOfControl).toBe(false);
  });

  it("the no-fabrication law: a one-sided or unset band yields Cp = Cpk = null", () => {
    const oneSided = computeXbarRChart({
      values: DATASET_A,
      subgroupSize: 5,
      band: { ucl: "10.600000", lcl: null },
    });
    expect(oneSided.sigmaHat).toBe("0.171969");
    expect(oneSided.cp).toBeNull();
    expect(oneSided.cpk).toBeNull();
    const unbanded = computeXbarRChart({
      values: DATASET_A,
      subgroupSize: 5,
      band: { ucl: null, lcl: null },
    });
    expect(unbanded.cp).toBeNull();
    expect(unbanded.cpk).toBeNull();
    // The chart itself still publishes (UNBANDED is recorded, never
    // judged — the tolerance fold's own law).
    expect(unbanded.xChart.ucl).toBe("10.255800");
  });

  it("the degenerate R̄ = 0 collapse: sigma/cp/cpk null, no flag, and the INCLUSIVE TIE proven on the collapsed limits", () => {
    const collapsed = computeXbarRChart({
      values: Array.from({ length: 10 }, () => "7.5"),
      subgroupSize: 5,
      band: BAND,
    });
    expect(collapsed.subgroups).toHaveLength(2);
    expect(collapsed.grandMean).toBe("7.500000");
    expect(collapsed.rBar).toBe("0.000000");
    expect(collapsed.xChart).toEqual({ ucl: "7.500000", lcl: "7.500000" });
    expect(collapsed.rChart).toEqual({ ucl: "0.000000", lcl: "0.000000" });
    expect(collapsed.sigmaHat).toBeNull();
    expect(collapsed.cp).toBeNull();
    expect(collapsed.cpk).toBeNull();
    // Every mean sits exactly ON the collapsed limit — the closed
    // interval law: ON the limit is WITHIN, so no flag fires.
    expect(collapsed.outOfControl).toBe(false);
  });

  it("the symmetric-center identity: when X̄̄ sits at the band's center, Cp = Cpk exactly", () => {
    // Four subgroups, each 10.0 10.1 9.9 10.0 10.0 → x̄ 10.000000, R 0.200000
    // Cp = Cpk = 1.2×2.326/1.2 = 2.326000 EXACT (the d2 constant itself).
    const values = Array.from({ length: 4 }, () => ["10.0", "10.1", "9.9", "10.0", "10.0"]).flat();
    const chart = computeXbarRChart({ values, subgroupSize: 5, band: BAND });
    expect(chart.grandMean).toBe("10.000000");
    expect(chart.rBar).toBe("0.200000");
    expect(chart.cp).toBe("2.326000");
    expect(chart.cpk).toBe("2.326000");
  });

  it("ORDER-FREEDOM WITHIN A SUBGROUP (property ×50): permuting a subgroup's values never moves its mean or range", () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const base = DATASET_A.slice();
      // Permute the LAST subgroup (indices 15…19) deterministically by seed.
      const tail = base.splice(15, 5);
      const rotated = [...tail.slice(seed % 5), ...tail.slice(0, seed % 5)];
      const chart = computeXbarRChart({
        values: [...base, ...rotated],
        subgroupSize: 5,
        band: BAND,
      });
      expect(chart.subgroups[3]!.mean).toBe("10.000000");
      expect(chart.subgroups[3]!.range).toBe("0.400000");
      expect(chart.grandMean).toBe("10.025000");
    }
  });

  it("THE CONSTANTS TABLE'S OWN SHAPE (property): A₂ strictly decreasing · D₄ strictly decreasing · d₂ strictly increasing · D₃ zero exactly through n=6", () => {
    for (let n = SPC_SUBGROUP_SIZE_MIN + 1; n <= SPC_SUBGROUP_SIZE_MAX; n += 1) {
      const prev = SPC_CONSTANTS[n - 1]!;
      const current = SPC_CONSTANTS[n]!;
      expect(new Decimal(current.a2).lessThan(new Decimal(prev.a2))).toBe(true);
      expect(new Decimal(current.d4).lessThan(new Decimal(prev.d4))).toBe(true);
      expect(new Decimal(current.d2).greaterThan(new Decimal(prev.d2))).toBe(true);
    }
    for (let n = SPC_SUBGROUP_SIZE_MIN; n <= 6; n += 1) {
      expect(SPC_CONSTANTS[n]!.d3).toBe("0.000");
    }
    expect(new Decimal(SPC_CONSTANTS[7]!.d3).greaterThan(0)).toBe(true);
  });

  it("THE ARITHMETIC ORACLE (property ×100): means and ranges agree with an independent JS-number computation at 6dp", () => {
    let state = 987654321;
    const next = () => {
      // A deterministic xorshift — no Math.random flakiness in the battery.
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return Math.abs(state % 1000000) / 1000; // 0…999.999
    };
    for (let round = 0; round < 100; round += 1) {
      const n = 2 + (round % 9); // 2…10
      const groups = 1 + (round % 4);
      const values: string[] = [];
      const expectedMeans: number[] = [];
      const expectedRanges: number[] = [];
      for (let group = 0; group < groups; group += 1) {
        let sum = 0;
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (let sample = 0; sample < n; sample += 1) {
          const value = next();
          values.push(value.toFixed(6));
          sum += value;
          if (value < min) min = value;
          if (value > max) max = value;
        }
        expectedMeans.push(sum / n);
        expectedRanges.push(max - min);
      }
      const chart = computeXbarRChart({ values, subgroupSize: n, band: BAND });
      expect(chart.subgroups).toHaveLength(groups);
      expect(chart.excludedCount).toBe(0);
      for (let group = 0; group < groups; group += 1) {
        expect(Number(chart.subgroups[group]!.mean)).toBeCloseTo(expectedMeans[group]!, 5);
        expect(Number(chart.subgroups[group]!.range)).toBeCloseTo(expectedRanges[group]!, 5);
      }
      const grandMean = expectedMeans.reduce((a, b) => a + b, 0) / groups;
      expect(Number(chart.grandMean)).toBeCloseTo(grandMean, 5);
      const rBar = expectedRanges.reduce((a, b) => a + b, 0) / groups;
      expect(Number(chart.rBar)).toBeCloseTo(rBar, 5);
      // The published limits follow the pinned constants exactly:
      expect(Number(chart.xChart.ucl)).toBeCloseTo(grandMean + Number(SPC_CONSTANTS[n]!.a2) * rBar, 5);
      expect(Number(chart.rChart.ucl)).toBeCloseTo(Number(SPC_CONSTANTS[n]!.d4) * rBar, 5);
    }
  });

  it("every published mean is bounded by the samples' own min and max (property over the three datasets)", () => {
    for (const dataset of [DATASET_A, DATASET_B, DATASET_C]) {
      const chart = computeXbarRChart({ values: dataset, subgroupSize: 5, band: BAND });
      const min = Math.min(...dataset.map(Number));
      const max = Math.max(...dataset.map(Number));
      for (const group of chart.subgroups) {
        expect(Number(group.mean)).toBeGreaterThanOrEqual(min);
        expect(Number(group.mean)).toBeLessThanOrEqual(max);
        expect(Number(group.range)).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
