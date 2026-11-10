import Decimal from "decimal.js";

/**
 * Decimal configuration per ADR-0009: 34 significant digits, explicit rounding
 * modes only. Binary floating point is forbidden for money, quantities, and rates.
 */
Decimal.set({ precision: 34 });

export { Decimal };
export const DECIMAL_PRECISION = 34;

/** Storage/exactness caps per ADR-0009 and docs/localization/CURRENCY_AND_PRECISION.md §1. */
export const STORAGE_SCALE = {
  /** monetary amounts: numeric(19,4) */
  amountDecimals: 4,
  /** quantities: numeric(19,6) */
  quantityDecimals: 6,
  /** FX rates: numeric(19,8) */
  rateDecimals: 8,
  /** percentages: numeric(7,4) */
  percentageDecimals: 4,
} as const;
