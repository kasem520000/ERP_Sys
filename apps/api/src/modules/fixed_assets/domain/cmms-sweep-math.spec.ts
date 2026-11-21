import { describe, expect, it } from "vitest";

import {
  ASSET_EXPIRY_CLASSES,
  DEFAULT_ASSET_EXPIRY_SWEEP_WINDOWS,
  assetExpiryDedupeKey,
  bandFor,
  normalizeSweepWindows,
  sweepBands,
  sweepSeverity,
} from "./cmms-sweep-math";

/**
 * PHASE-049 (W-19 — T-12) THE SWEEP WINDOW ARITHMETIC — unit-first (the
 * plan §4's own list: "the sweep window arithmetic (the 30/7/0 classes,
 * the dedupe keys — D-10)").
 */
describe("normalizeSweepWindows (the tenant-configurable ladder, fail-closed)", () => {
  it("the documented default [30,7,0] — the registry default and the fold's fail-closed residue are ONE list", () => {
    expect(DEFAULT_ASSET_EXPIRY_SWEEP_WINDOWS).toEqual([30, 7, 0]);
    expect(normalizeSweepWindows([])).toEqual([30, 7, 0]);
  });

  it("garbage never disables the sweep — null/bool/float/garbage all DROP (never coerce: Number(null) === 0 would fabricate a 0-day window); an empty residue reads as the default", () => {
    expect(normalizeSweepWindows(["30", "x", null, -7, 1.5, Number.NaN, true, ""])).toEqual([30]);
    expect(normalizeSweepWindows([null, "x", -1, true])).toEqual([30, 7, 0]);
  });

  it("duplicates drop; the result sorts DESCENDING (widest first)", () => {
    expect(normalizeSweepWindows([0, 7, 7, 30, 30, 0])).toEqual([30, 7, 0]);
    expect(normalizeSweepWindows([3, 60, 14, 60])).toEqual([60, 14, 3]);
  });

  it("string-encoded integers coerce (the jsonb settings row may hand strings through)", () => {
    expect(normalizeSweepWindows(["30", "7", "0"])).toEqual([30, 7, 0]);
  });
});

describe("sweepBands (the disjoint fold — each item in EXACTLY ONE band per pass)", () => {
  it("the default ladder folds into three disjoint bands, tightest open-ended (already-expired items stay caught)", () => {
    expect(sweepBands([30, 7, 0])).toEqual([
      { threshold: 30, fromDays: 7, toDays: 30 },
      { threshold: 7, fromDays: 0, toDays: 7 },
      { threshold: 0, fromDays: null, toDays: 0 },
    ]);
  });

  it("bandFor walks the ladder exactly once — no item in two bands, nothing between the rungs", () => {
    const bands = sweepBands([30, 7, 0]);
    expect(bandFor(bands, 45)).toBeNull(); // farther than the widest window
    expect(bandFor(bands, 30)?.threshold).toBe(30);
    expect(bandFor(bands, 12)?.threshold).toBe(30);
    expect(bandFor(bands, 7)?.threshold).toBe(7);
    expect(bandFor(bands, 3)?.threshold).toBe(7);
    expect(bandFor(bands, 0)?.threshold).toBe(0);
    expect(bandFor(bands, -5)?.threshold).toBe(0); // EXPIRED — the open floor catches it
  });

  it("the no-double-fire law is the fold's own shape: one pass, one band, one key", () => {
    const bands = sweepBands([30, 7, 0]);
    const hits = bands.filter(
      (band) => 10 <= band.toDays && (band.fromDays === null || 10 > band.fromDays),
    );
    expect(hits).toHaveLength(1);
  });
});

describe("assetExpiryDedupeKey (the BR-091 cmms shape) + the severity ladder (S-15)", () => {
  it("the key's exact shape — assets:{class}:{assetId}:{threshold}", () => {
    expect(
      assetExpiryDedupeKey({ assetExpiryClass: "warranty", assetId: "a1", threshold: 30 }),
    ).toBe("assets:warranty:a1:30");
    expect(
      assetExpiryDedupeKey({ assetExpiryClass: "inspection", assetId: "a1", threshold: 0 }),
    ).toBe("assets:inspection:a1:0");
  });

  it("the four classes are the 0108 column family — one ladder governs all", () => {
    expect(ASSET_EXPIRY_CLASSES).toEqual(["warranty", "insurance", "license", "inspection"]);
  });

  it("info at the ≥ 30-day bands, warning below", () => {
    expect(sweepSeverity(30)).toBe("info");
    expect(sweepSeverity(60)).toBe("info");
    expect(sweepSeverity(7)).toBe("warning");
    expect(sweepSeverity(0)).toBe("warning");
  });
});
