import { describe, expect, it } from "vitest";

import {
  SUPPLIER_SCORE_WEIGHTS,
  SupplierScoreInputsInvalidError,
  foldSupplierQualityScore,
} from "./supplier-score";

/**
 * PHASE-050 (W-27 — T-10, 2026-11-23) THE SUPPLIER SCORE FOLD'S PROPERTY
 * TESTS: the pinned composites (hand-computed, string-literal pins) + the
 * laws the pins alone cannot walk — the unmeasurable zero, the drag cap,
 * monotonicity in every defect input, the blend's convexity bounds, and
 * the input floor's typed refusals.
 */

describe("PHASE-050 W-27 — the supplier quality score fold", () => {
  it("the clean supplier (no defects, all on-time) scores exactly 100.00 with both legs at 100", () => {
    const fold = foldSupplierQualityScore({
      ncrCount: 0,
      rejectionCount: 0,
      onTimeDeliveries: 10,
      totalDeliveries: 10,
    });
    expect(fold).toEqual({
      score: "100.00",
      defectLeg: "100.000000",
      deliveryLeg: "100.000000",
      unmeasured: false,
    });
  });

  it("the pinned symmetric composite: one NCR + one rejection, eight on-time of ten → 80.00", () => {
    const fold = foldSupplierQualityScore({
      ncrCount: 1,
      rejectionCount: 1,
      onTimeDeliveries: 8,
      totalDeliveries: 10,
    });
    expect(fold.defectLeg).toBe("80.000000");
    expect(fold.deliveryLeg).toBe("80.000000");
    expect(fold.score).toBe("80.00");
    expect(fold.unmeasured).toBe(false);
  });

  it("the pinned asymmetric composite: two NCRs, all on-time → 0.6×80 + 0.4×100 = 88.00", () => {
    const fold = foldSupplierQualityScore({
      ncrCount: 2,
      rejectionCount: 0,
      onTimeDeliveries: 10,
      totalDeliveries: 10,
    });
    expect(fold.defectLeg).toBe("80.000000");
    expect(fold.deliveryLeg).toBe("100.000000");
    expect(fold.score).toBe("88.00");
  });

  it("the pinned rounding composite: one NCR, one on-time of three → 160/3 → 53.33 (2dp HALF_UP)", () => {
    const fold = foldSupplierQualityScore({
      ncrCount: 1,
      rejectionCount: 0,
      onTimeDeliveries: 1,
      totalDeliveries: 3,
    });
    // defect leg 100 − 100/3 = 66.666667 (6dp) · delivery 33.333333
    expect(fold.defectLeg).toBe("66.666667");
    expect(fold.deliveryLeg).toBe("33.333333");
    // 0.6×(200/3) + 0.4×(100/3) = 160/3 = 53.3333… → 53.33
    expect(fold.score).toBe("53.33");
  });

  it("the drag caps at zero — a defect-flooded supplier never scores below 0.00", () => {
    const fold = foldSupplierQualityScore({
      ncrCount: 25,
      rejectionCount: 30,
      onTimeDeliveries: 0,
      totalDeliveries: 10,
    });
    expect(fold.defectLeg).toBe("0.000000");
    expect(fold.deliveryLeg).toBe("0.000000");
    expect(fold.score).toBe("0.00");
  });

  it("THE UNMEASURABLE SHAPE: zero deliveries → 0.00 with the flag, even with zero defects (evidence, never decoration)", () => {
    const fold = foldSupplierQualityScore({
      ncrCount: 0,
      rejectionCount: 0,
      onTimeDeliveries: 0,
      totalDeliveries: 0,
    });
    expect(fold).toEqual({
      score: "0.00",
      defectLeg: "0.000000",
      deliveryLeg: "0.000000",
      unmeasured: true,
    });
  });

  it("MONOTONICITY (property): more NCRs or more rejections never raises the score; more on-time never lowers it", () => {
    for (let ncr = 0; ncr <= 6; ncr += 1) {
      for (let rejection = 0; rejection <= 6; rejection += 1) {
        for (let onTime = 0; onTime <= 12; onTime += 3) {
          const total = 12;
          const base = foldSupplierQualityScore({
            ncrCount: ncr,
            rejectionCount: rejection,
            onTimeDeliveries: onTime,
            totalDeliveries: total,
          });
          if (ncr < 6) {
            const worse = foldSupplierQualityScore({
              ncrCount: ncr + 1,
              rejectionCount: rejection,
              onTimeDeliveries: onTime,
              totalDeliveries: total,
            });
            expect(Number(worse.score)).toBeLessThanOrEqual(Number(base.score));
          }
          if (rejection < 6) {
            const worse = foldSupplierQualityScore({
              ncrCount: ncr,
              rejectionCount: rejection + 1,
              onTimeDeliveries: onTime,
              totalDeliveries: total,
            });
            expect(Number(worse.score)).toBeLessThanOrEqual(Number(base.score));
          }
          if (onTime < 12) {
            const better = foldSupplierQualityScore({
              ncrCount: ncr,
              rejectionCount: rejection,
              onTimeDeliveries: onTime + 1,
              totalDeliveries: total,
            });
            expect(Number(better.score)).toBeGreaterThanOrEqual(Number(base.score));
          }
        }
      }
    }
  });

  it("BOUNDS (property ×200): the score is a convex blend of legs in [0,100] — every world lands in [0.00, 100.00]", () => {
    let state = 24680;
    const next = (mod: number) => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return Math.abs(state % mod);
    };
    for (let round = 0; round < 200; round += 1) {
      const total = next(50);
      const fold = foldSupplierQualityScore({
        ncrCount: next(30),
        rejectionCount: next(30),
        onTimeDeliveries: total === 0 ? 0 : next(total + 1),
        totalDeliveries: total,
      });
      const score = Number(fold.score);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
      // The convex-blend law: min(legs) − 1ulp ≤ score ≤ max(legs) + 1ulp.
      const low = Math.min(Number(fold.defectLeg), Number(fold.deliveryLeg));
      const high = Math.max(Number(fold.defectLeg), Number(fold.deliveryLeg));
      expect(score).toBeGreaterThanOrEqual(low - 0.005);
      expect(score).toBeLessThanOrEqual(high + 0.005);
    }
  });

  it("THE WEIGHTS PIN: the blend is exactly 0.60 defect + 0.40 delivery (the documented weights)", () => {
    expect(SUPPLIER_SCORE_WEIGHTS).toEqual({ defect: "0.60", delivery: "0.40" });
    // 0.6×70 + 0.4×40 = 42 + 16 = 58 — the exact decimal blend, no float.
    const fold = foldSupplierQualityScore({
      ncrCount: 3,
      rejectionCount: 0,
      onTimeDeliveries: 4,
      totalDeliveries: 10,
    });
    expect(fold.defectLeg).toBe("70.000000");
    expect(fold.deliveryLeg).toBe("40.000000");
    expect(fold.score).toBe("58.00");
  });

  it("THE INPUT FLOOR: negative counts and on-time above total are the typed refusal naming all four figures", () => {
    expect(() =>
      foldSupplierQualityScore({ ncrCount: -1, rejectionCount: 0, onTimeDeliveries: 1, totalDeliveries: 5 }),
    ).toThrow(SupplierScoreInputsInvalidError);
    expect(() =>
      foldSupplierQualityScore({ ncrCount: 0, rejectionCount: 0, onTimeDeliveries: 6, totalDeliveries: 5 }),
    ).toThrow(SupplierScoreInputsInvalidError);
    try {
      foldSupplierQualityScore({ ncrCount: 0, rejectionCount: 0, onTimeDeliveries: 6, totalDeliveries: 5 });
    } catch (error) {
      expect((error as SupplierScoreInputsInvalidError).details).toEqual({
        ncrCount: 0,
        rejectionCount: 0,
        onTimeDeliveries: 6,
        totalDeliveries: 5,
      });
    }
  });
});
