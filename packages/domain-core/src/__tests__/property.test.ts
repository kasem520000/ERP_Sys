import fc from "fast-check";
import { describe, it } from "vitest";
import { Money, Quantity, generateUuidV7 } from "../index";

/**
 * Property tests required by PHASE-001 §6: money add/sub/mul/round and
 * UUIDv7 monotonicity & format, over generated inputs (not hand-picked cases).
 */

describe("Money properties (fast-check)", () => {
  it("add is exact and commutative in minor units (no float drift)", () => {
    const minorArb = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
    fc.assert(
      fc.property(fc.tuple(minorArb, minorArb), ([a, b]) => {
        const left = Money.fromMinorUnits(a, "SAR").add(Money.fromMinorUnits(b, "SAR"));
        const right = Money.fromMinorUnits(b, "SAR").add(Money.fromMinorUnits(a, "SAR"));
        return (
          left.toMinorUnits() === a + b &&
          right.toMinorUnits() === a + b &&
          left.equals(right)
        );
      }),
      { numRuns: 500 },
    );
  });

  it("subtract is the exact inverse of add", () => {
    const minorArb = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
    fc.assert(
      fc.property(fc.tuple(minorArb, minorArb), ([a, b]) => {
        const result = Money.fromMinorUnits(a, "SAR")
          .add(Money.fromMinorUnits(b, "SAR"))
          .subtract(Money.fromMinorUnits(b, "SAR"));
        return result.toMinorUnits() === a;
      }),
      { numRuns: 500 },
    );
  });

  it("multiplyQuantity with integer quantities is exact", () => {
    const minorArb = fc.bigInt({ min: 0n, max: 10n ** 9n });
    const qtyArb = fc.bigInt({ min: 0n, max: 10n ** 6n });
    fc.assert(
      fc.property(fc.tuple(minorArb, qtyArb), ([minor, qty]) => {
        const product = Money.fromMinorUnits(minor, "SAR").multiplyQuantity(
          Quantity.fromIntegerUnits(qty),
        );
        return product.toMinorUnits() === minor * qty;
      }),
      { numRuns: 500 },
    );
  });

  it("rounding half-up matches the manual minor-units rule (incl. the .5 boundary)", () => {
    const minorArb = fc.bigInt({ min: 0n, max: 10n ** 9n });
    const digitArb = fc.integer({ min: 0, max: 9 });
    fc.assert(
      fc.property(fc.tuple(minorArb, digitArb), ([minor, digit]) => {
        // amount (major units) = (minor*10 + digit) / 1000 SAR → one extra decimal digit
        const total = (minor * 10n + BigInt(digit)).toString().padStart(4, "0");
        const amount = `${total.slice(0, -3)}.${total.slice(-3)}`;
        const expectedMinor = digit >= 5 ? minor + 1n : minor;
        return (
          Money.fromString(amount, "SAR").roundToMinorUnits().toMinorUnits() === expectedMinor
        );
      }),
      { numRuns: 500 },
    );
  });

  it("parse(format()) round-trips already-rounded values", () => {
    const minorArb = fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n });
    fc.assert(
      fc.property(fc.tuple(minorArb, fc.constantFrom<"SAR" | "KWD" | "OMR">("SAR", "KWD", "OMR")), ([minor, currency]) => {
        const m = Money.fromMinorUnits(minor, currency);
        return Money.fromString(m.format(), currency).equals(m);
      }),
      { numRuns: 500 },
    );
  });
});

describe("UUIDv7 properties (fast-check)", () => {
  const PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("always matches UUIDv7 format and stays sortable across generated batches", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), (n) => {
        const ids = Array.from({ length: n }, () => generateUuidV7());
        const sorted = [...ids].sort();
        return ids.every((id) => PATTERN.test(id)) && sorted.join("|") === ids.join("|");
      }),
      { numRuns: 50 },
    );
  });
});
