import { Decimal } from "./precision";
import {
  CurrencyMismatchError,
  DomainError,
  InvalidValueError,
} from "./errors";
import { minorUnitsOf, isCurrencyCode, type CurrencyCode } from "./currency";
import type { Quantity } from "./quantity";

/**
 * Money value object per ADR-0009:
 * - exact decimal arithmetic (decimal.js, 34 significant digits);
 * - canonical string representation ("1234.5000") at the currency's minor units;
 * - construction from JS numbers is forbidden (runtime + ESLint rule);
 * - rounding is decimal half-up at the currency's minor units
 *   (docs/localization/CURRENCY_AND_PRECISION.md §3).
 */
export class Money {
  private constructor(
    /** Amount as exact decimal. Never derived from a JS float. */
    private readonly amount: Decimal,
    readonly currency: CurrencyCode,
  ) {}

  /** Parse a canonical decimal string (max 4 dp — wire rule, API_CONVENTIONS §7). */
  static fromString(value: string, currency: CurrencyCode): Money {
    if (!isCurrencyCode(currency)) {
      throw new InvalidValueError(`Unsupported currency code: ${String(currency)}`, {
        currency: String(currency),
      });
    }
    if (typeof value !== "string") {
      throw new InvalidValueError("Money must be constructed from a decimal string, not a number", {
        received: typeof value,
      });
    }
    if (!/^-?\d{1,15}(\.\d{1,4})?$/.test(value)) {
      throw new InvalidValueError(
        `Invalid money string "${value}" — expected ^-?\\d{1,15}(\\.\\d{1,4})?$ (API_CONVENTIONS §7)`,
        { value },
      );
    }
    return new Money(new Decimal(value), currency);
  }

  /**
   * Construct from integer minor units (e.g. halalas, fils). The only numeric
   * entry point — integers are exactly representable.
   */
  static fromMinorUnits(minor: bigint, currency: CurrencyCode): Money {
    const d = minorUnitsOf(currency);
    const scaled = new Decimal(minor.toString()).div(new Decimal(10).pow(d));
    return new Money(scaled, currency);
  }

  /** Forbidden by design (ADR-0009: binary floating point). Always throws. */
  static fromNumber(_value: number, _currency: CurrencyCode): never {
    throw new DomainError(
      "domain/money-float-construction-forbidden",
      "Money.fromNumber() does not exist by design (ADR-0009). Use fromString() or fromMinorUnits().",
    );
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  negate(): Money {
    return new Money(this.amount.neg(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  /**
   * Line net = round(qty × unit price, minor units, half-up)
   * (CURRENCY_AND_PRECISION §3: "Line net" rounding point). Costing at 6-decimal
   * internal precision arrives with the inventory phases; here money rounds to
   * the currency's minor units.
   */
  multiplyQuantity(quantity: Quantity): Money {
    return this.roundToMinorUnits(
      new Money(this.amount.times(quantity.toDecimal()), this.currency),
    );
  }

  /** Round an arbitrary-precision money value to the currency's minor units, half-up. */
  roundToMinorUnits(value?: Money): Money {
    const target = value ?? this;
    this.assertSameCurrency(target);
    const d = minorUnitsOf(target.currency);
    const rounded = target.amount.toDecimalPlaces(d, Decimal.ROUND_HALF_UP);
    return new Money(rounded, target.currency);
  }

  /** Exact integer minor units (never a JS number). */
  toMinorUnits(): bigint {
    const d = minorUnitsOf(this.currency);
    return BigInt(this.amount.times(new Decimal(10).pow(d)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toString());
  }

  /** Canonical string with the currency's minor units, e.g. "1234.50" (SAR) / "1234.500" (KWD). */
  format(): string {
    return this.amount.toFixed(minorUnitsOf(this.currency));
  }

  /** Canonical wire string (JSON transport is string, never number — ADR-0009). */
  toJSON(): string {
    return this.format();
  }

  toString(): string {
    return `${this.format()} ${this.currency}`;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.eq(other.amount);
  }

  compare(other: Money): number {
    this.assertSameCurrency(other);
    return this.amount.comparedTo(other.amount);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isPositive(): boolean {
    return this.amount.isPositive() && !this.amount.isZero();
  }

  /** Sum a same-currency list (document totals are Σ rounded lines). */
  static sum(moneys: readonly Money[]): Money {
    if (moneys.length === 0) {
      throw new DomainError("domain/money-empty-sum", "Money.sum of an empty list needs a currency");
    }
    const first = moneys[0];
    if (!first) {
      throw new DomainError("domain/money-empty-sum", "Money.sum of an empty list needs a currency");
    }
    return moneys.reduce((acc, m) => acc.add(m), first.subtract(first));
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
