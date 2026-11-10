import { Decimal, STORAGE_SCALE } from "./precision";
import { InvalidValueError } from "./errors";
import { Quantity } from "./quantity";

/**
 * Rate value object per ADR-0009: FX rates numeric(19,8), percentages
 * numeric(7,4) — the rate itself is never rounded before use
 * (CURRENCY_AND_PRECISION §3).
 */
export class Rate {
  private constructor(private readonly value: Decimal) {}

  /** Parse an FX-rate string (max 8 dp — API_CONVENTIONS §7). */
  static fromString(value: string): Rate {
    if (typeof value !== "string") {
      throw new InvalidValueError("Rate must be constructed from a decimal string, not a number");
    }
    if (!/^-?\d{1,15}(\.\d{1,8})?$/.test(value)) {
      throw new InvalidValueError(
        `Invalid rate string "${value}" — expected ^-?\\d{1,15}(\\.\\d{1,8})?$ (API_CONVENTIONS §7)`,
        { value },
      );
    }
    return new Rate(new Decimal(value));
  }

  /** Percentage-rate entry point (max 4 dp, e.g. "15.0000" for 15%). */
  static fromPercentageString(value: string): Rate {
    if (!/^-?\d{1,15}(\.\d{1,4})?$/.test(value)) {
      throw new InvalidValueError(
        `Invalid percentage string "${value}" — expected max 4 dp (numeric(7,4), API_CONVENTIONS §7)`,
        { value },
      );
    }
    return new Rate(new Decimal(value));
  }

  /** Forbidden by design (ADR-0009). Always throws. */
  static fromNumber(_value: number): never {
    throw new InvalidValueError(
      "Rate.fromNumber() does not exist by design (ADR-0009). Use fromString().",
    );
  }

  /** Multiply a quantity by this rate, keeping internal precision (no premature rounding). */
  timesQuantity(quantity: Quantity): Quantity {
    const product = this.value.times(quantity.toDecimal());
    return Quantity.fromString(product.toFixed(STORAGE_SCALE.quantityDecimals));
  }

  /** Canonical wire string at full 8-dp rate scale. */
  format(): string {
    return this.value.toFixed(STORAGE_SCALE.rateDecimals);
  }

  toJSON(): string {
    return this.format();
  }

  toDecimal(): Decimal {
    return this.value;
  }

  equals(other: Rate): boolean {
    return this.value.eq(other.value);
  }
}
