import { describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  computeDeclarationTotals,
  computeLineDuty,
  isDutyVatLineValid,
  type ComputedDutyVatLine,
} from "./duty-vat-fold";

/**
 * PHASE-051 (W-37 — T-10) the duty/VAT line fold's property tests (the
 * plan's §4 unit-first law: the PURE module FIRST — the service renders
 * the fold's output VERBATIM, so the fold's arithmetic is the contract).
 * The ADR-0009 discipline: every figure on Decimal, never a float.
 */

describe("the duty/VAT line fold (D-06 — the line math, ADR-0009)", () => {
  it("THE LINE MATH: duty = value × rate on Decimal at the ledger's 4dp — never a float product", () => {
    // 0.1 + 0.2's own classic: the float product would drift; Decimal
    // is exact to the 4dp rounding.
    expect(computeLineDuty({ customsValue: "1234.5678", dutyRate: "0.05", importVat: "0" }).dutyAmount).toBe(
      "61.7284",
    );
    expect(computeLineDuty({ customsValue: "100000.0000", dutyRate: "0.05", importVat: "0" }).dutyAmount).toBe(
      "5000.0000",
    );
    expect(computeLineDuty({ customsValue: "999.9999", dutyRate: "0.0125", importVat: "0" }).dutyAmount).toBe(
      "12.5000",
    );
  });

  it("THE ROUNDING LAW: ROUND_HALF_UP at the 4th decimal (the posting engine's canonical scale)", () => {
    expect(computeLineDuty({ customsValue: "1.00005", dutyRate: "1", importVat: "0" }).dutyAmount).toBe("1.0001");
    expect(computeLineDuty({ customsValue: "1.00004", dutyRate: "1", importVat: "0" }).dutyAmount).toBe("1.0000");
    expect(computeLineDuty({ customsValue: "3.00005", dutyRate: "0.333333", importVat: "0" }).dutyAmount).toBe(
      "1.0000",
    );
  });

  it("THE ZERO RATE IS THE EXPLICIT TENANT STATEMENT (EXW/free): duty 0, NEVER a refusal — the no-hardcoded-rates law", () => {
    const verdict = computeLineDuty({ customsValue: "5000.0000", dutyRate: "0", importVat: "0" });
    expect(verdict.dutyAmount).toBe("0.0000");
    expect(verdict.reason).toBeNull();
  });

  it("THE ZERO VALUE: a zero customs value carries duty 0 (the empty line's own shape)", () => {
    const verdict = computeLineDuty({ customsValue: "0", dutyRate: "0.05", importVat: "0" });
    expect(verdict.dutyAmount).toBe("0.0000");
    expect(verdict.reason).toBeNull();
  });

  it("THE TYPED REFUSALS (the 0121 floors' caller-side face): negative and non-finite shapes refuse with the field's own reason", () => {
    for (const [field, line] of [
      ["customsValue", { customsValue: "-1", dutyRate: "0.05", importVat: "0" }],
      ["dutyRate", { customsValue: "1", dutyRate: "-0.05", importVat: "0" }],
      ["importVat", { customsValue: "1", dutyRate: "0.05", importVat: "-1" }],
    ] as const) {
      const verdict = computeLineDuty(line);
      expect(verdict.dutyAmount).toBeNull();
      expect(verdict.reason).toContain(field);
      expect(isDutyVatLineValid(line)).toBe(false);
    }
    expect(computeLineDuty({ customsValue: "not-a-number", dutyRate: "0.05", importVat: "0" }).dutyAmount).toBeNull();
    expect(computeLineDuty({ customsValue: "1", dutyRate: "NaN", importVat: "0" }).dutyAmount).toBeNull();
    expect(computeLineDuty({ customsValue: "Infinity", dutyRate: "0.05", importVat: "0" }).dutyAmount).toBeNull();
  });

  it("PROPERTY: duty(value, rate) equals the Decimal product for a randomized grid — the never-float invariant", () => {
    // A deterministic pseudo-grid (no Math.random — reproducibility).
    for (let i = 1; i <= 25; i += 1) {
      const value = new Decimal(i).times(137.031).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      const rate = new Decimal(i).div(400).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
      const expected = value.times(rate).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      const verdict = computeLineDuty({
        customsValue: value.toFixed(4),
        dutyRate: rate.toFixed(6),
        importVat: "0",
      });
      expect(verdict.dutyAmount).toBe(expected);
      expect(verdict.reason).toBeNull();
    }
  });

  it("THE TOTALS: Σ over the computed lines EXACT — the landed amount = Σ (duty + vat), D-06's own source", () => {
    const lines: ComputedDutyVatLine[] = [
      { customsValue: "10000.0000", dutyRate: "0.05", importVat: "750.0000", dutyAmount: "500.0000" },
      { customsValue: "2500.5000", dutyRate: "0.0125", importVat: "187.5375", dutyAmount: "31.2563" },
      { customsValue: "5000.0000", dutyRate: "0", importVat: "0", dutyAmount: "0.0000" },
    ];
    const totals = computeDeclarationTotals(lines);
    expect(totals.totalCustomsValue).toBe("17500.5000");
    expect(totals.totalDuty).toBe("531.2563");
    expect(totals.totalImportVat).toBe("937.5375");
    expect(totals.totalLandedAmount).toBe("1468.7938");
    // The exact-Σ law: the landed amount's own arithmetic.
    expect(new Decimal(totals.totalLandedAmount).toFixed(4)).toBe(
      new Decimal(totals.totalDuty).plus(totals.totalImportVat).toFixed(4),
    );
  });

  it("THE EMPTY SET: an empty line set totals zero (the fold never invents a figure)", () => {
    const totals = computeDeclarationTotals([]);
    expect(totals.totalCustomsValue).toBe("0.0000");
    expect(totals.totalDuty).toBe("0.0000");
    expect(totals.totalImportVat).toBe("0.0000");
    expect(totals.totalLandedAmount).toBe("0.0000");
  });

  it("PROPERTY: the totals commute with the line order (Σ is order-independent on Decimal)", () => {
    const lines: ComputedDutyVatLine[] = [
      { customsValue: "12.3400", dutyRate: "0.07", importVat: "1.0000", dutyAmount: "0.8638" },
      { customsValue: "998.2100", dutyRate: "0.015", importVat: "0", dutyAmount: "14.9732" },
      { customsValue: "0.0100", dutyRate: "1", importVat: "0.0001", dutyAmount: "0.0100" },
    ];
    const forward = computeDeclarationTotals(lines);
    const reversed = computeDeclarationTotals([...lines].reverse());
    expect(forward).toEqual(reversed);
  });

  it("PROPERTY: the landed amount is the sum of the per-line (duty + vat) — linearity, never a re-derived figure", () => {
    const lines: ComputedDutyVatLine[] = [
      { customsValue: "55.5500", dutyRate: "0.123456", importVat: "2.2222", dutyAmount: "6.8580" },
      { customsValue: "1234.0000", dutyRate: "0.05", importVat: "98.7200", dutyAmount: "61.7000" },
    ];
    const perLine = lines
      .map((line) => new Decimal(line.dutyAmount).plus(new Decimal(line.importVat)))
      .reduce((sum, value) => sum.plus(value), new Decimal(0));
    expect(computeDeclarationTotals(lines).totalLandedAmount).toBe(perLine.toFixed(4));
  });

  it("THE FOLD'S OUTPUT SCALE: every figure a canonical 4dp string (the ledger's own shape)", () => {
    const verdict = computeLineDuty({ customsValue: "1", dutyRate: "0.1", importVat: "2" });
    expect(verdict.dutyAmount).toMatch(/^\d+\.\d{4}$/);
    const totals = computeDeclarationTotals([
      { customsValue: "1", dutyRate: "0.1", importVat: "2", dutyAmount: "0.1000" },
    ]);
    expect(totals.totalCustomsValue).toMatch(/^\d+\.\d{4}$/);
    expect(totals.totalLandedAmount).toMatch(/^\d+\.\d{4}$/);
  });
});
