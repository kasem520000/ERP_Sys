import { describe, expect, it } from "vitest";

import {
  computeEquityRecyclingDelta,
  rateKey,
  requireDatedRate,
  resolveDatedRate,
  translateAtRate,
  translateMemberLine,
  type StoredRate,
} from "../application/fx-translation";
import { RateInvalidError, RateMissingError } from "../domain/consolidation-errors";

/**
 * PHASE-034 T7 · the FX translation unit suite (the pure half; the DB suite
 * re-runs the same scenarios over the live harness): dated stored rates per
 * INV-008 (rate > 0; translated = amount × stored rate EXACTLY as stored —
 * no recomputation drift); the OQ-V2-2 method (DR-P34-FX-1: CLOSING_RATE
 * default, per-group configuration, TEMPORARY bounded to the equity-
 * recycling delta); missing rates fail CLOSED (RATE_MISSING); 3-decimal
 * currencies (KWD-style) ride the ordinary machinery.
 */

const GROUP = "01990000-0000-7000-8000-0000000000f1";

describe("INV-008 · translateAtRate (amount × stored rate, exactly as stored)", () => {
  it("multiplies at canonical 4dp half-up (the moneyRate discipline)", () => {
    expect(translateAtRate("1000.0000", "3.75000000")).toBe("3750.0000");
    expect(translateAtRate("100.0000", "0.10345000")).toBe("10.3450");
  });

  it("3-decimal currencies (KWD-style) ride the ordinary machinery", () => {
    // A KWD member translating into SAR at 12.245500 stored rate.
    expect(translateAtRate("250.125", "12.2455")).toBe("3062.9057");
    // The member's own 3-dp amounts are never pre-rounded to 2 — the final
    // step is the only rounding point (CURRENCY_AND_PRECISION §5).
    expect(translateAtRate("0.005", "1")).toBe("0.0050");
  });

  it("no recomputation drift: the same stored rate yields the same 4dp quantum, always", () => {
    const rate = "3.75";
    for (let index = 0; index < 50; index += 1) {
      expect(translateAtRate("123.4567", rate)).toBe("462.9626");
    }
  });
});

describe("INV-008 · requireDatedRate (fail-closed RATE_MISSING / RATE_INVALID)", () => {
  it("resolves the stored rate for the exact key", () => {
    const rates = new Map([[rateKey("USD", "2026-11-30"), "3.75000000"]]);
    expect(requireDatedRate(rates, "USD", "2026-11-30", GROUP)).toBe("3.75000000");
  });

  it("throws the typed RATE_MISSING when no stored rate exists at the date", () => {
    const rates = new Map<string, string>();
    expect(() => requireDatedRate(rates, "USD", "2026-11-30", GROUP)).toThrow(RateMissingError);
    expect(() => requireDatedRate(rates, "USD", "2026-11-30", GROUP)).toThrow(
      expect.objectContaining({ code: "RATE_MISSING" }),
    );
  });

  it("throws the typed RATE_INVALID when a stored rate is ≤ 0", () => {
    const rates = new Map([[rateKey("USD", "2026-11-30"), "0"]]);
    expect(() => requireDatedRate(rates, "USD", "2026-11-30", GROUP)).toThrow(RateInvalidError);
    const negative = new Map([[rateKey("USD", "2026-11-30"), "-3.75"]]);
    expect(() => requireDatedRate(negative, "USD", "2026-11-30", GROUP)).toThrow(RateInvalidError);
  });
});

describe("INV-008 · resolveDatedRate (latest stored ≤ date, never interpolated)", () => {
  it("picks the latest stored rate at-or-before the anchor date", () => {
    const stored: StoredRate[] = [
      { currency: "USD", rateDate: "2026-11-01", rate: "3.74000000" },
      { currency: "USD", rateDate: "2026-11-28", rate: "3.75500000" },
      { currency: "EUR", rateDate: "2026-11-20", rate: "4.01000000" },
    ];
    expect(resolveDatedRate(stored, "USD", "2026-11-30")).toBe("3.75500000");
    expect(resolveDatedRate(stored, "USD", "2026-11-15")).toBe("3.74000000");
    expect(resolveDatedRate(stored, "EUR", "2026-11-30")).toBe("4.01000000");
  });

  it("returns undefined when nothing is stored at-or-before the date", () => {
    const stored: StoredRate[] = [{ currency: "USD", rateDate: "2026-12-01", rate: "3.75" }];
    expect(resolveDatedRate(stored, "USD", "2026-11-30")).toBeUndefined();
  });
});

describe("OQ-V2-2 (DR-P34-FX-1) · translateMemberLine (the per-group method)", () => {
  it("same-currency members pass through UNTOUCHED (no multiplication — byte-stable member parity)", () => {
    const result = translateMemberLine({
      groupId: GROUP,
      groupBaseCurrency: "SAR",
      memberBaseCurrency: "SAR",
      method: "CLOSING_RATE",
      statement: "BS",
      amount: "1234.5678",
      periodRate: "3.75",
      closingRate: "3.75",
    });
    expect(result).toBe("1234.5678");
  });

  it("foreign-currency members translate at the dated stored rate (IS leg = period rate)", () => {
    const result = translateMemberLine({
      groupId: GROUP,
      groupBaseCurrency: "SAR",
      memberBaseCurrency: "USD",
      method: "CLOSING_RATE",
      statement: "IS",
      amount: "1000.0000",
      periodRate: "3.74000000",
      closingRate: "3.75500000",
    });
    expect(result).toBe("3740.0000");
  });

  it("foreign-currency members translate at the closing rate on the BS leg", () => {
    const result = translateMemberLine({
      groupId: GROUP,
      groupBaseCurrency: "SAR",
      memberBaseCurrency: "USD",
      method: "CLOSING_RATE",
      statement: "BS",
      amount: "1000.0000",
      periodRate: "3.74000000",
      closingRate: "3.75500000",
    });
    expect(result).toBe("3755.0000");
  });

  it("TEMPORARY translates account lines identically (the extra leg is the equity-recycling delta)", () => {
    const closing = translateMemberLine({
      groupId: GROUP,
      groupBaseCurrency: "SAR",
      memberBaseCurrency: "USD",
      method: "TEMPORARY",
      statement: "BS",
      amount: "1000.0000",
      periodRate: "3.74000000",
      closingRate: "3.75500000",
    });
    expect(closing).toBe("3755.0000");
  });
});

describe("OQ-V2-2 · computeEquityRecyclingDelta (the TEMPORARY bounded leg)", () => {
  it("CLOSING_RATE groups never compute a delta (returns 0.0000)", () => {
    expect(
      computeEquityRecyclingDelta({
        method: "CLOSING_RATE",
        nonMonetaryClosingBalance: "10000.0000",
        closingRate: "3.75",
        transactionDateRatesBalance: "37400.0000",
      }),
    ).toBe("0.0000");
  });

  it("TEMPORARY groups surface the closing-vs-transaction-date difference", () => {
    const delta = computeEquityRecyclingDelta({
      method: "TEMPORARY",
      nonMonetaryClosingBalance: "10000.0000",
      closingRate: "3.75",
      transactionDateRatesBalance: "37400.0000",
    });
    expect(delta).toBe("100.0000");
  });
});
