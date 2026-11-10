import { describe, expect, it } from "vitest";
import {
  CurrencyMismatchError,
  DomainError,
  InvalidValueError,
  Money,
  Quantity,
} from "../index";

describe("Money", () => {
  it("parses and formats canonical strings at the currency's minor units", () => {
    expect(Money.fromString("1234.5", "SAR").format()).toBe("1234.50");
    expect(Money.fromString("1234.5000", "SAR").format()).toBe("1234.50");
    expect(Money.fromString("1234.5", "KWD").format()).toBe("1234.500");
    expect(Money.fromString("1234.5", "OMR").format()).toBe("1234.500");
  });

  it("rejects strings beyond the 4-dp wire limit", () => {
    expect(() => Money.fromString("1234.50000", "SAR")).toThrow(InvalidValueError);
    expect(() => Money.fromString("12.5.6", "SAR")).toThrow(InvalidValueError);
    expect(() => Money.fromString("", "SAR")).toThrow(InvalidValueError);
    // A JSON number is a contract violation (ADR-0009) — runtime enforces strings.
    expect(() => Money.fromString(1234.5 as unknown as string, "SAR")).toThrow(InvalidValueError);
  });

  it("forbids construction from JS numbers (ADR-0009)", () => {
    // fromNumber() always throws by design; string/BigInt are the only entry points.
    expect(() => Money.fromNumber(10.5, "SAR")).toThrow(DomainError);
    expect(() => Money.fromNumber(0, "SAR")).toThrow(DomainError);
  });

  it("adds and subtracts exactly (no 0.1+0.02 drift)", () => {
    expect(Money.fromString("0.1", "SAR").add(Money.fromString("0.02", "SAR")).format()).toBe("0.12");
    expect(Money.fromString("1.10", "SAR").subtract(Money.fromString("0.02", "SAR")).format()).toBe("1.08");
  });

  it("rejects mixed-currency arithmetic", () => {
    expect(() => Money.fromString("1", "SAR").add(Money.fromString("1", "AED"))).toThrow(
      CurrencyMismatchError,
    );
  });

  it("multiplies by quantity with half-up rounding at minor units (CURRENCY_AND_PRECISION §3)", () => {
    expect(Money.fromString("0.335", "SAR").multiplyQuantity(Quantity.fromString("1")).format()).toBe(
      "0.34",
    );
    // 3-decimal currencies must never round at 2 decimals (correctness bug, not simplification):
    expect(Money.fromString("0.0375", "OMR").multiplyQuantity(Quantity.fromString("1")).format()).toBe(
      "0.038",
    );
    expect(Money.fromString("2.00", "SAR").multiplyQuantity(Quantity.fromString("3")).format()).toBe(
      "6.00",
    );
    expect(Money.fromString("0.005", "SAR").roundToMinorUnits().format()).toBe("0.01");
    expect(Money.fromString("-0.005", "SAR").roundToMinorUnits().format()).toBe("-0.01");
  });

  it("rounds half-up away from zero on exact halves", () => {
    expect(Money.fromString("1.005", "SAR").roundToMinorUnits().format()).toBe("1.01");
    expect(Money.fromString("-1.005", "SAR").roundToMinorUnits().format()).toBe("-1.01");
    expect(Money.fromString("1.004", "SAR").roundToMinorUnits().format()).toBe("1.00");
  });

  it("converts to exact BigInt minor units and back", () => {
    expect(Money.fromString("1234.50", "SAR").toMinorUnits()).toBe(123450n);
    expect(Money.fromString("1234.500", "KWD").toMinorUnits()).toBe(1234500n);
    expect(Money.fromMinorUnits(123450n, "SAR").format()).toBe("1234.50");
    expect(Money.fromMinorUnits(-5n, "SAR").toMinorUnits()).toBe(-5n);
  });

  it("sums same-currency lists (Σ rounded lines)", () => {
    const total = Money.sum([
      Money.fromString("1.11", "SAR"),
      Money.fromString("2.22", "SAR"),
      Money.fromString("3.30", "SAR"),
    ]);
    expect(total.format()).toBe("6.63");
  });

  it("compares and inspects sign", () => {
    const a = Money.fromString("1.00", "SAR");
    const b = Money.fromString("2.00", "SAR");
    expect(a.compare(b)).toBeLessThan(0);
    expect(b.isPositive()).toBe(true);
    expect(a.isZero()).toBe(false);
    expect(Money.fromString("0.00", "SAR").isZero()).toBe(true);
    expect(Money.fromString("-1.00", "SAR").isNegative()).toBe(true);
  });

  it("serializes to a canonical wire string via toJSON", () => {
    expect(Money.fromString("1234.5000", "SAR").toJSON()).toBe("1234.50");
  });
});
