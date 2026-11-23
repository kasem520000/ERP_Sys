import { describe, expect, it } from "vitest";

import {
  DEFAULT_CALIBRATION_SWEEP_WINDOWS,
  calibrationBandFor,
  calibrationDedupeKey,
  calibrationSweepBands,
  calibrationSweepSeverity,
  normalizeCalibrationSweepWindows,
} from "./calibration-sweep-math";

/**
 * PHASE-050 (W-26 — T-08, 2026-11-23) the calibration sweep's property
 * pack (the cmms-sweep-math.spec precedent): the window fold's honest
 * refusal of every coercion class, the disjoint-band law (each instrument
 * in EXACTLY ONE band per pass — the whole no-double-fire fold), the
 * band boundaries inclusive/exactly as declared, the dedupe key's own
 * axes (D-08's «per instrument+window+day» — the day axis the DUE DATE,
 * the per-cycle re-alert), and the severity ladder. The pure layer before
 * any consumer lands (the unit-first law).
 */

describe("PHASE-050 W-26 — T-08: the window fold (normalize — the honest refusal of every coercion class)", () => {
  it("the documented default [30,7,0] DESCENDING — what a tenant with no stored row fails closed to", () => {
    expect(DEFAULT_CALIBRATION_SWEEP_WINDOWS).toEqual([30, 7, 0]);
    expect(normalizeCalibrationSweepWindows([])).toEqual([30, 7, 0]);
  });

  it("duplicates drop; the sort is DESCENDING (widest first)", () => {
    expect(normalizeCalibrationSweepWindows([0, 30, 7, 30, 0, 7])).toEqual([30, 7, 0]);
    expect(normalizeCalibrationSweepWindows([3, 45, 12])).toEqual([45, 12, 3]);
  });

  it("STRICT integer strings parse; every other string/float/null/bool DROPS — the fabrication class refused entirely", () => {
    expect(normalizeCalibrationSweepWindows(["30", " 7 ", "0"])).toEqual([30, 7, 0]);
    expect(normalizeCalibrationSweepWindows([1.5, 30, -7, null, undefined, true, false])).toEqual(
      [30],
    );
    expect(normalizeCalibrationSweepWindows(["1.5", "garbage", "", "-3", "03"])).toEqual([30, 7, 0]);
  });

  it("garbage never disables — an all-garbage residue reads as the documented default (the fail-closed direction)", () => {
    expect(normalizeCalibrationSweepWindows(["x", "y", null, {}, []])).toEqual([30, 7, 0]);
  });
});

describe("PHASE-050 W-26 — T-08: the disjoint-band law (the no-double-fire fold)", () => {
  it("the default ladder folds into EXACTLY the three disjoint bands — each window its own band edge, the tightest band's floor open", () => {
    expect(calibrationSweepBands([30, 7, 0])).toEqual([
      { threshold: 30, fromDays: 7, toDays: 30 },
      { threshold: 7, fromDays: 0, toDays: 7 },
      { threshold: 0, fromDays: null, toDays: 0 },
    ]);
  });

  it("each days-to-due value falls in EXACTLY ONE band — the grid walked cell by cell (the upper edges inclusive, the floors open)", () => {
    const bands = calibrationSweepBands([30, 7, 0]);
    expect(calibrationBandFor(bands, 45)).toBeNull(); // outside the widest
    expect(calibrationBandFor(bands, 31)).toBeNull();
    expect(calibrationBandFor(bands, 30)?.threshold).toBe(30); // inclusive top
    expect(calibrationBandFor(bands, 29)?.threshold).toBe(30);
    expect(calibrationBandFor(bands, 8)?.threshold).toBe(30);
    expect(calibrationBandFor(bands, 7)?.threshold).toBe(7); // (0,7]
    expect(calibrationBandFor(bands, 1)?.threshold).toBe(7);
    expect(calibrationBandFor(bands, 0)?.threshold).toBe(0); // the open floor
    expect(calibrationBandFor(bands, -20)?.threshold).toBe(0); // overdue — exactly the exposure the alert exists for
    // No double-membership: every value in the grid lands in exactly one
    // band (the fold's own totality law, the probe's SQL mirror).
    for (let days = -25; days <= 45; days += 1) {
      const home = calibrationBandFor(bands, days);
      if (home === null) {
        expect(days > 30).toBe(true);
        continue;
      }
      expect(days <= home.toDays).toBe(true);
      expect(home.fromDays === null || days > home.fromDays).toBe(true);
    }
  });

  it("a custom ladder folds with the same law (the probe's SQL mirrors this fold)", () => {
    const bands = calibrationSweepBands([25, 10]);
    expect(bands).toEqual([
      { threshold: 25, fromDays: 10, toDays: 25 },
      { threshold: 10, fromDays: null, toDays: 10 },
    ]);
    expect(calibrationBandFor(bands, 25)?.threshold).toBe(25);
    expect(calibrationBandFor(bands, 24)?.threshold).toBe(25);
    expect(calibrationBandFor(bands, 11)?.threshold).toBe(25);
    expect(calibrationBandFor(bands, 10)?.threshold).toBe(10); // the open floor now
    expect(calibrationBandFor(bands, -5)?.threshold).toBe(10);
    expect(calibrationBandFor(bands, 26)).toBeNull();
  });

  it("the single-window ladder degenerates to ONE open-floor band (the tightest is also the widest)", () => {
    const bands = calibrationSweepBands([14]);
    expect(bands).toEqual([{ threshold: 14, fromDays: null, toDays: 14 }]);
    expect(calibrationBandFor(bands, 14)?.threshold).toBe(14);
    expect(calibrationBandFor(bands, 13)?.threshold).toBe(14);
    expect(calibrationBandFor(bands, -30)?.threshold).toBe(14);
    expect(calibrationBandFor(bands, 15)).toBeNull();
  });
});

describe("PHASE-050 W-26 — T-08: the dedupe key (D-08's own axes — «per instrument+window+day»)", () => {
  it("the exact shape: quality:calibration:{assetId}:{threshold}:{dueDate}", () => {
    expect(
      calibrationDedupeKey({
        assetId: "5a5a5a5a-0000-4000-8000-0000000005a2",
        threshold: 30,
        dueDate: "2026-12-23",
      }),
    ).toBe("quality:calibration:5a5a5a5a-0000-4000-8000-0000000005a2:30:2026-12-23");
  });

  it("the DAY axis is the due date — the per-cycle re-alert law: a re-calibrated instrument's NEW due date forms a NEW key (the next cycle alerts again); within one cycle the keys are IDENTICAL (the convergence law)", () => {
    const assetId = "5a5a5a5a-0000-4000-8000-0000000005a2";
    const cycleOne = calibrationDedupeKey({ assetId, threshold: 30, dueDate: "2026-12-23" });
    const rerun = calibrationDedupeKey({ assetId, threshold: 30, dueDate: "2026-12-23" });
    const cycleTwo = calibrationDedupeKey({ assetId, threshold: 30, dueDate: "2027-06-23" });
    expect(rerun).toBe(cycleOne); // the same cycle's re-run converges
    expect(cycleTwo).not.toBe(cycleOne); // the next cycle re-alerts
    // The band axis separates the same cycle's descents (30 → 7 → 0).
    expect(calibrationDedupeKey({ assetId, threshold: 7, dueDate: "2026-12-23" })).not.toBe(
      cycleOne,
    );
  });
});

describe("PHASE-050 W-26 — T-08: the severity ladder (the S-15 shape)", () => {
  it("info at the ≥ 30-day bands, warning below", () => {
    expect(calibrationSweepSeverity(30)).toBe("info");
    expect(calibrationSweepSeverity(45)).toBe("info");
    expect(calibrationSweepSeverity(7)).toBe("warning");
    expect(calibrationSweepSeverity(0)).toBe("warning");
  });
});
