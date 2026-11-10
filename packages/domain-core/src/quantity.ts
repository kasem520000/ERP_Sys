import { Decimal, STORAGE_SCALE } from "./precision";
import { InvalidValueError } from "./errors";

/**
 * Quantity value object per ADR-0009: numeric(19,6) storage, decimal math,
 * string transport (max 6 dp — API_CONVENTIONS §7).
 */
export class Quantity {
  private constructor(private readonly value: Decimal) {}

  /** Parse a canonical decimal string (max 6 dp). */
  static fromString(value: string): Quantity {
    if (typeof value !== "string") {
      throw new InvalidValueError("Quantity must be constructed from a decimal string, not a number");
    }
    if (!/^-?\d{1,15}(\.\d{1,6})?$/.test(value)) {
      throw new InvalidValueError(
        `Invalid quantity string "${value}" — expected ^-?\\d{1,15}(\\.\\d{1,6})?$ (API_CONVENTIONS §7)`,
        { value },
      );
    }
    return new Quantity(new Decimal(value));
  }

  static fromIntegerUnits(units: bigint): Quantity {
    return new Quantity(new Decimal(units.toString()));
  }

  /** Forbidden by design (ADR-0009). Always throws. */
  static fromNumber(_value: number): never {
    throw new InvalidValueError(
      "Quantity.fromNumber() does not exist by design (ADR-0009). Use fromString() or fromIntegerUnits().",
    );
  }

  add(other: Quantity): Quantity {
    return new Quantity(this.value.plus(other.value));
  }

  subtract(other: Quantity): Quantity {
    return new Quantity(this.value.minus(other.value));
  }

  /** Internal unit-cost precision stays at 6 decimals (ADR-0009 rounding policy). */
  toUnitCost(): string {
    return this.value.toFixed(STORAGE_SCALE.quantityDecimals);
  }

  /** Canonical wire string (max 6 dp). */
  format(): string {
    return this.value.toFixed(STORAGE_SCALE.quantityDecimals);
  }

  toJSON(): string {
    return this.format();
  }

  toDecimal(): Decimal {
    return this.value;
  }

  equals(other: Quantity): boolean {
    return this.value.eq(other.value);
  }

  isZero(): boolean {
    return this.value.isZero();
  }
}
