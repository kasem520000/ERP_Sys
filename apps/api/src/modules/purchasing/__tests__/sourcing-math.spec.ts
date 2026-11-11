import { describe, expect, it } from "vitest";

import {
  AWARD_WEIGHTS,
  discountAmount,
  discountDeadline,
  foldScorecard,
  isWithinDiscountWindow,
  blanketReleaseCheck,
  netAfterDiscount,
  resolveToleranceForLine,
  scoreOffers,
  threeBidDecision,
} from "../application/sourcing-math";

/**
 * PHASE-038 unit suite (T-13): the PURE sourcing math — the award
 * scoring fold, the BR-062 3-bid decision, the blanket commitment guard,
 * the G-34 window/amount math, the P-11 tolerance-band resolution, and
 * the P-04 scorecard fold. Deterministic: identical inputs → identical
 * outputs (the pricing.ts discipline).
 */

describe("scoreOffers (the award-matrix fold)", () => {
  it("anchors the lowest price and shortest lead at 100 and folds the documented weights", () => {
    const scored = scoreOffers("10", [
      { quoteId: "q1", supplierId: "s1", unitPrice: "10.000000", leadTimeDays: 5, validUntil: "2030-01-01", asOf: "2026-01-01" },
      { quoteId: "q2", supplierId: "s2", unitPrice: "20.000000", leadTimeDays: 10, validUntil: "2030-01-01", asOf: "2026-01-01" },
    ]);
    expect(scored[0]!.priceScore).toBe("100.00");
    expect(scored[0]!.deliveryScore).toBe("100.00");
    expect(scored[0]!.termsScore).toBe("100.00");
    expect(scored[0]!.weightedScore).toBe("100.00");
    expect(scored[0]!.lineTotal).toBe("100.0000");
    // q2: price 100*10/20 = 50; delivery 100*5/10 = 50; terms 100.
    const expected = 50 * AWARD_WEIGHTS.price + 50 * AWARD_WEIGHTS.delivery + 100 * AWARD_WEIGHTS.terms;
    expect(scored[1]!.priceScore).toBe("50.00");
    expect(scored[1]!.deliveryScore).toBe("50.00");
    expect(Number(scored[1]!.weightedScore)).toBeCloseTo(expected, 2);
  });

  it("scores a missing lead time and an expired validity at zero on those legs", () => {
    const scored = scoreOffers("1", [
      { quoteId: "q1", supplierId: "s1", unitPrice: "5.000000", leadTimeDays: null, validUntil: "2025-01-01", asOf: "2026-01-01" },
    ]);
    expect(scored[0]!.deliveryScore).toBe("0.00");
    expect(scored[0]!.termsScore).toBe("0.00");
    expect(scored[0]!.priceScore).toBe("100.00");
    expect(Number(scored[0]!.weightedScore)).toBeCloseTo(100 * AWARD_WEIGHTS.price, 2);
  });

  it("returns an empty fold for an empty offer set", () => {
    expect(scoreOffers("5", [])).toEqual([]);
  });
});

describe("threeBidDecision (BR-062)", () => {
  it("proceeds when OFF or the floor is disabled", () => {
    expect(threeBidDecision({ mode: "OFF", minQuoteCount: 3, submittedQuotes: 1 })).toBe("proceed");
    expect(threeBidDecision({ mode: "ENFORCED", minQuoteCount: 0, submittedQuotes: 1 })).toBe("proceed");
  });
  it("proceeds when the received count meets the floor", () => {
    expect(threeBidDecision({ mode: "ENFORCED", minQuoteCount: 3, submittedQuotes: 3 })).toBe("proceed");
  });
  it("warns in ADVISORY and rejects in ENFORCED below the floor", () => {
    expect(threeBidDecision({ mode: "ADVISORY", minQuoteCount: 3, submittedQuotes: 2 })).toBe("warn");
    expect(threeBidDecision({ mode: "ENFORCED", minQuoteCount: 3, submittedQuotes: 2 })).toBe("reject");
  });
});

describe("blanketReleaseCheck (P-03)", () => {
  it("accepts a release within the remaining commitment", () => {
    const result = blanketReleaseCheck({ requested: "400.0000", releasedAmount: "100.0000", maxCommitment: "1000.0000" });
    expect(result).toEqual({ ok: true, remainingAfter: "500.0000" });
  });
  it("rejects an over-release with the remaining as the typed-rejection input", () => {
    const result = blanketReleaseCheck({ requested: "700.0000", releasedAmount: "400.0000", maxCommitment: "1000.0000" });
    expect(result).toEqual({ ok: false, remaining: "600.0000" });
  });
  it("rejects a non-positive release", () => {
    const result = blanketReleaseCheck({ requested: "0.0000", releasedAmount: "0.0000", maxCommitment: "1000.0000" });
    expect(result.ok).toBe(false);
  });
});

describe("the G-34 window + amount math", () => {
  it("computes the deadline and the in-window check inclusively", () => {
    expect(discountDeadline("2026-01-10", 10)).toBe("2026-01-20");
    expect(isWithinDiscountWindow({ invoiceDate: "2026-01-10", discountDays: 10, paymentDate: "2026-01-20" })).toBe(true);
    expect(isWithinDiscountWindow({ invoiceDate: "2026-01-10", discountDays: 10, paymentDate: "2026-01-21" })).toBe(false);
  });
  it("computes the discount and net after discount at 4dp half-up", () => {
    expect(discountAmount("10000.0000", "2.00")).toBe("200.0000");
    expect(netAfterDiscount("10000.0000", "200.0000")).toBe("9800.0000");
  });
});

describe("resolveToleranceForLine (P-11 bands)", () => {
  const bands = [
    { maxLineAmount: "1000.0000", qtyPct: "5", pricePct: "10" },
    { maxLineAmount: "10000.0000", qtyPct: "2", pricePct: "4" },
  ];
  it("resolves the FIRST band whose ceiling covers the line amount", () => {
    expect(resolveToleranceForLine("80.0000", bands)).toEqual({ qtyPct: "5", pricePct: "10" });
    expect(resolveToleranceForLine("1000.0000", bands)).toEqual({ qtyPct: "5", pricePct: "10" });
    expect(resolveToleranceForLine("1000.0001", bands)).toEqual({ qtyPct: "2", pricePct: "4" });
  });
  it("returns null above the largest band (the flat keys govern)", () => {
    expect(resolveToleranceForLine("20000.0000", bands)).toBeNull();
    expect(resolveToleranceForLine("1.0000", [])).toBeNull();
  });
});

describe("foldScorecard (P-04)", () => {
  it("keeps a perfect supplier at 100", () => {
    const folded = foldScorecard({ deliveryScore: "100.00", qualityScore: "100.00", priceVariancePct: null });
    expect(folded.priceScore).toBe("100.00");
    expect(folded.overallScore).toBe("100.00");
  });
  it("drags the price score linearly and folds the documented weights", () => {
    // 7.5% variance → price 50; delivery 100 · 0.4 + quality 80 · 0.4 + price 50 · 0.2 = 82.
    const folded = foldScorecard({ deliveryScore: "100.00", qualityScore: "80.00", priceVariancePct: "7.5" });
    expect(folded.priceScore).toBe("50.00");
    expect(folded.overallScore).toBe("82.00");
  });
  it("clamps variances above 15% to a zero price score", () => {
    const folded = foldScorecard({ deliveryScore: "100.00", qualityScore: "100.00", priceVariancePct: "40" });
    expect(folded.priceScore).toBe("0.00");
    expect(folded.overallScore).toBe("80.00");
  });
});
