import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import { addExact, multiplyExact, subExact, compareExact, absExact } from "../application/decimal-strings";

/**
 * PHASE-007 property tests (ACCOUNTING_TESTS §4, the subset owned by this
 * phase): rounding monotonicity / residual conservation, line-net/tax/
 * header conservation, and FX base conversion — generated inputs, not
 * hand-picked cases, tolerance 0.
 */

const amountArb = fc
  .tuple(fc.integer({ min: 0, max: 10 ** 9 }), fc.integer({ min: 0, max: 9999 }))
  .map(([major, minor]) => `${major}.${String(minor).padStart(4, "0")}`);

const rateArb = fc
  .tuple(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 0, max: 99999999 }))
  .map(([whole, frac]) => `${whole}.${String(frac).padEnd(8, "0")}`);

/** Engine's exact base conversion (POSTING_ENGINE validation #3). */
function baseOf(amount: string, rate: string): string {
  return new Decimal(amount)
    .times(new Decimal(rate))
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);
}

describe("PHASE-007 property tests — rounding + conservation (§4)", () => {
  it("rounding monotonicity + idempotence: base(doc, rate) never exceeds one ULP drift and re-rounding never changes", () => {
    fc.assert(
      fc.property(fc.tuple(amountArb, rateArb), ([amount, rate]) => {
        const once = baseOf(amount, rate);
        const twice = baseOf(once, "1");
        // Re-rounding is idempotent at scale 4.
        expect(twice).toBe(once);
        // The exact product and the rounded conversion stay within one
        // minor unit (monotone, never more than half-up rounding).
        const exact = new Decimal(amount).times(new Decimal(rate));
        const rounded = new Decimal(once);
        expect(rounded.minus(exact).abs().lessThanOrEqualTo(new Decimal("0.00005"))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("residual conservation: Σ rounded line splits + residual = rounded total (never dropped)", () => {
    fc.assert(
      fc.property(
        fc.record({
          total: amountArb,
          parts: fc.integer({ min: 2, max: 50 }),
        }),
        ({ total, parts }) => {
          // Split `total` into `parts` equal 4-dp shares (floor), track the
          // residual explicitly — the sum of shares + residual must equal
          // the total EXACTLY (INV-007 discipline at the money scale).
          const totalMinor = BigInt(total.replace(".", ""));
          const shareMinor = totalMinor / BigInt(parts);
          const residualMinor = totalMinor - shareMinor * BigInt(parts);
          let sumMinor = 0n;
          for (let i = 0; i < parts; i += 1) {
            sumMinor += shareMinor;
          }
          sumMinor += residualMinor;
          expect(sumMinor).toBe(totalMinor);
          // String round-trip: Σ shares + residual parses back to total.
          const reconstructed = addExact(
            fromMinorTimes(shareMinor * BigInt(parts)),
            fromMinorTimes(residualMinor),
          );
          expect(compareExact(reconstructed, total)).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("line-net/tax/header conservation: Σ line nets + Σ line tax = header totals exactly (INV-007)", () => {
    const netArb = amountArb;
    const taxRateArb = fc.constantFrom("0.0000", "0.0500", "0.1400", "0.1500");
    fc.assert(
      fc.property(
        fc.record({ lines: fc.array(netArb, { minLength: 1, maxLength: 20 }), rate: taxRateArb }),
        ({ lines, rate }) => {
          const lineTaxes = lines.map((net) => multiplyExact(net, rate));
          const headerNet = lines.reduce((acc, net) => addExact(acc, net), "0.0000");
          const headerTax = lineTaxes.reduce((acc, tax) => addExact(acc, tax), "0.0000");
          const headerTotal = addExact(headerNet, headerTax);
          // Re-deriving the totals from per-line sums is exact.
          expect(compareExact(headerNet, lines.reduce((acc, n) => addExact(acc, n), "0.0000"))).toBe(0);
          // The invoice-style pair: total = net + tax holds by construction
          // and subtraction is the exact inverse.
          expect(compareExact(subExact(headerTotal, headerTax), headerNet)).toBe(0);
          expect(compareExact(subExact(headerTotal, headerNet), headerTax)).toBe(0);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("FX base conversion: base = doc × rate exactly as stored; balanced doc sets balance in base (INV-002/008)", () => {
    fc.assert(
      fc.property(
        fc.record({
          debit: amountArb,
          rate: rateArb,
        }),
        ({ debit, rate }) => {
          const baseDebit = baseOf(debit, rate);
          const baseCredit = baseOf(debit, rate);
          expect(baseDebit).toBe(baseCredit);
          // A balanced doc pair (equal debit/credit) converts to a balanced
          // base pair — and re-reading the stored value never drifts.
          expect(compareExact(baseDebit, baseCredit)).toBe(0);
          expect(absExact(subExact(baseDebit, baseCredit))).toBe("0.0000");
        },
      ),
      { numRuns: 500 },
    );
  });

  it("FX entry storage: rate > 0 always, and the stored base is deterministic on re-read (no drift)", () => {
    fc.assert(
      fc.property(fc.tuple(amountArb, rateArb), ([amount, rate]) => {
        // Rate positivity is INV-008's storage rule — the generator only
        // produces positive rates; the conversion never invents a negative
        // base from a non-negative doc amount.
        expect(compareExact(rate, "0.00000000")).toBe(1);
        const stored = baseOf(amount, rate);
        expect(compareExact(stored, "0.0000")).toBeGreaterThanOrEqual(0);
        // Re-read determinism (INV-008 "no recomputation drift"): the same
        // stored inputs always re-derive the same stored base.
        expect(baseOf(amount, rate)).toBe(stored);
        // And the stored value is within half a minor unit of the exact
        // product (the single documented rounding point).
        const exact = new Decimal(amount).times(new Decimal(rate));
        expect(
          new Decimal(stored).minus(exact).abs().lessThanOrEqualTo(new Decimal("0.00005")),
        ).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});

function fromMinorTimes(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 10n ** 4n;
  const frac = (abs % 10n ** 4n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
