import { describe, expect, it } from "vitest";

import {
  DEFAULT_LC_EXPIRY_WINDOWS,
  lcDiscrepancyDedupeKey,
  lcExpiryDedupeKey,
  lcSweepBandFor,
  lcSweepBands,
  lcSweepSeverity,
  normalizeLcSweepWindows,
} from "./lc-sweep-math";

/**
 * PHASE-051 (W-34 — T-06) the trade-expiry sweep's PROPERTY TESTS (the
 * unit-first law — the pure layer proven BEFORE the sweep renders it):
 * BR-105's default ladder, the normalize fold's fail-closed direction,
 * the disjoint bands' partition law, the open lower edge of the tightest
 * band, the dedupe axes' exact shapes, and the S-15 severity ladder.
 */

describe("the windows (the tenant-configurable ladder)", () => {
  it("BR-105's own default: [30,14,7,1] — the phase doc §2's verbatim days", () => {
    expect(DEFAULT_LC_EXPIRY_WINDOWS).toEqual([30, 14, 7, 1]);
  });

  it("THE FAIL-CLOSED DIRECTION: an empty/garbage residue reads as the documented default", () => {
    expect(normalizeLcSweepWindows([])).toEqual([30, 14, 7, 1]);
    expect(normalizeLcSweepWindows(["garbage", null, false, {}, 1.5])).toEqual([30, 14, 7, 1]);
  });

  it("THE COERCION CLASS REFUSED: null/bool/floats DROP, never coerce (Number(null) === 0 would fabricate a 0-day window)", () => {
    // A null in the list must NOT read as 0 — the whole list's residue
    // falls back to the default, and no fabricated member appears.
    const windows = normalizeLcSweepWindows([null, 30, 7]);
    expect(windows).toEqual([30, 7]);
    expect(normalizeLcSweepWindows([null])).toEqual([30, 14, 7, 1]);
  });

  it("duplicates drop; integers and STRICT integer strings parse; the sort is DESCENDING", () => {
    expect(normalizeLcSweepWindows([7, 30, 7, "30", 14])).toEqual([30, 14, 7]);
    expect(normalizeLcSweepWindows([" 14 ", 1, 30])).toEqual([30, 14, 1]);
    expect(normalizeLcSweepWindows(["1.0", "01", "-3"])).toEqual([30, 14, 7, 1]);
  });

  it("a tenant-narrowed ladder stands (one window is a legal ladder)", () => {
    expect(normalizeLcSweepWindows([7])).toEqual([7]);
    expect(normalizeLcSweepWindows([0])).toEqual([0]);
  });
});

describe("the bands (the disjoint partition)", () => {
  it("THE PARTITION LAW: each day-value falls in EXACTLY ONE band — the no-double-fire fold", () => {
    const bands = lcSweepBands([30, 14, 7, 1]);
    expect(bands).toEqual([
      { threshold: 30, fromDays: 14, toDays: 30 },
      { threshold: 14, fromDays: 7, toDays: 14 },
      { threshold: 7, fromDays: 1, toDays: 7 },
      { threshold: 1, fromDays: null, toDays: 1 },
    ]);
    for (let days = -10; days <= 60; days += 1) {
      const hits = bands.filter(
        (band) => days <= band.toDays && (band.fromDays === null || days > band.fromDays),
      );
      expect(hits.length).toBeLessThanOrEqual(1);
    }
  });

  it("THE OPEN LOWER EDGE: the tightest band catches the already-expired instruments (days ≤ 0)", () => {
    const bands = lcSweepBands([30, 14, 7, 1]);
    expect(lcSweepBandFor(bands, 0)?.threshold).toBe(1);
    expect(lcSweepBandFor(bands, -5)?.threshold).toBe(1);
    // The expiry transition's own population — exactly the exposure the
    // sweep exists for.
    expect(lcSweepBandFor(bands, 1)?.threshold).toBe(1);
  });

  it("the descent across nights: 30 → 14 → 7 → 1, each threshold exactly once", () => {
    const bands = lcSweepBands([30, 14, 7, 1]);
    expect(lcSweepBandFor(bands, 29)?.threshold).toBe(30);
    expect(lcSweepBandFor(bands, 30)?.threshold).toBe(30);
    expect(lcSweepBandFor(bands, 31)).toBeNull();
    expect(lcSweepBandFor(bands, 15)?.threshold).toBe(30);
    expect(lcSweepBandFor(bands, 14)?.threshold).toBe(14);
    expect(lcSweepBandFor(bands, 8)?.threshold).toBe(14);
    expect(lcSweepBandFor(bands, 7)?.threshold).toBe(7);
    expect(lcSweepBandFor(bands, 2)?.threshold).toBe(7);
  });

  it("the band edges honor the half-open interval `fromDays < days <= toDays`", () => {
    const bands = lcSweepBands([14, 7]);
    expect(bands).toEqual([
      { threshold: 14, fromDays: 7, toDays: 14 },
      { threshold: 7, fromDays: null, toDays: 7 },
    ]);
    expect(lcSweepBandFor(bands, 14)?.threshold).toBe(14);
    expect(lcSweepBandFor(bands, 7)?.threshold).toBe(7);
  });
});

describe("the dedupe keys (D-09's own axes)", () => {
  it("THE EXPIRY KEY: `trade:lc:{lcId}:{threshold}:{expiryDate}` — the day axis is the expiry date the alert names", () => {
    expect(
      lcExpiryDedupeKey({ lcId: "6f1c", threshold: 14, expiryDate: "2027-01-31" }),
    ).toBe("trade:lc:6f1c:14:2027-01-31");
  });

  it("THE DISCREPANCY KEY: the same axes with the disc marker — disjoint from the expiry family", () => {
    expect(
      lcDiscrepancyDedupeKey({ lcId: "6f1c", threshold: 14, expiryDate: "2027-01-31" }),
    ).toBe("trade:lc:6f1c:disc:14:2027-01-31");
    const expiry = lcExpiryDedupeKey({ lcId: "x", threshold: 1, expiryDate: "2027-02-01" });
    const discrepancy = lcDiscrepancyDedupeKey({
      lcId: "x",
      threshold: 1,
      expiryDate: "2027-02-01",
    });
    expect(expiry).not.toEqual(discrepancy);
  });

  it("THE CONVERGENCE AXIS: the same instrument + threshold + day converges; a new day or threshold forms a new key", () => {
    const a = lcExpiryDedupeKey({ lcId: "L1", threshold: 7, expiryDate: "2027-01-31" });
    const b = lcExpiryDedupeKey({ lcId: "L1", threshold: 7, expiryDate: "2027-01-31" });
    expect(a).toEqual(b);
    expect(lcExpiryDedupeKey({ lcId: "L1", threshold: 1, expiryDate: "2027-01-31" })).not.toEqual(a);
    expect(lcExpiryDedupeKey({ lcId: "L2", threshold: 7, expiryDate: "2027-01-31" })).not.toEqual(a);
  });
});

describe("the S-15 severity ladder", () => {
  it("info at the ≥ 30-day bands (the far horizon); warning below (the near one)", () => {
    expect(lcSweepSeverity(30)).toBe("info");
    expect(lcSweepSeverity(45)).toBe("info");
    expect(lcSweepSeverity(14)).toBe("warning");
    expect(lcSweepSeverity(7)).toBe("warning");
    expect(lcSweepSeverity(1)).toBe("warning");
  });
});
