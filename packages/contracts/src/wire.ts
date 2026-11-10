import { z } from "zod";

/**
 * Wire-format schemas — the single authoritative registry of transport
 * precision patterns (API_CONVENTIONS §7, consolidation fix DEF-001).
 * Money/quantities/rates travel as JSON strings, never numbers (ADR-0009).
 */

/** Monetary amounts: numeric(19,4) storage, max 4 dp. */
export const MONEY_AMOUNT_PATTERN = /^-?\d{1,15}(\.\d{1,4})?$/;
/** Quantities: numeric(19,6), max 6 dp. */
export const QUANTITY_PATTERN = /^-?\d{1,15}(\.\d{1,6})?$/;
/** FX rates: numeric(19,8), max 8 dp. */
export const FX_RATE_PATTERN = /^-?\d{1,15}(\.\d{1,8})?$/;
/** Percentages: numeric(7,4), max 4 dp. */
export const PERCENTAGE_PATTERN = /^-?\d{1,15}(\.\d{1,4})?$/;
/** Business dates: ISO 8601 calendar date. */
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Timestamps: ISO 8601 UTC with offset/Z. */
export const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export const moneyAmountSchema = z
  .string()
  .regex(MONEY_AMOUNT_PATTERN, "money must be a decimal string with max 4 dp (numeric(19,4))");

export const quantitySchema = z
  .string()
  .regex(QUANTITY_PATTERN, "quantity must be a decimal string with max 6 dp (numeric(19,6))");

export const fxRateSchema = z
  .string()
  .regex(FX_RATE_PATTERN, "FX rate must be a decimal string with max 8 dp (numeric(19,8))");

export const percentageSchema = z
  .string()
  .regex(PERCENTAGE_PATTERN, "percentage must be a decimal string with max 4 dp (numeric(7,4))");

export const isoDateSchema = z
  .string()
  .regex(ISO_DATE_PATTERN, "business dates are ISO 8601 YYYY-MM-DD strings");

export const utcTimestampSchema = z
  .string()
  .regex(UTC_TIMESTAMP_PATTERN, "timestamps are ISO 8601 UTC with offset/Z");
