import { Decimal } from "@erp/domain-core";

import { RateInvalidError, RateMissingError } from "../domain/consolidation-errors";

/**
 * PHASE-034 T7 · FX translation — PURE (exported for the unit suite; no I/O):
 * member statements translate into the group's base currency with DATED
 * STORED RATES per the INV-008 conventions (stored rate > 0; translated =
 * amount × stored rate EXACTLY as stored — no recomputation, no drift), and
 * the METHOD is the OQ-V2-2 decision (DR-P34-FX-1 amending DR-006 §4):
 *
 * - CLOSING_RATE (the default): income-statement lines at the member's
 *   period rate (= the dated stored rate at the period end) and
 *   balance-sheet lines at the closing rate — both strictly stored rates;
 * - TEMPORARY (the bounded alternative): non-monetary balance-sheet lines
 *   additionally translate at transaction-date stored rates, with the
 *   equity-recycling delta surfaced as a CONSOLIDATION_ADJUSTMENT
 *   elimination line — bounded to exactly what ships at PHASE-034 (no
 *   waterfall automation, DR-006 §5 posture).
 *
 * Missing rates fail CLOSED with the typed RATE_MISSING (never a warning,
 * never a silent 1:1). Rates are resolved by the CALLER (the run service,
 * from the OWNER tenant's exchange_rates — the owner reads its own table
 * through the ordinary tenant-scoped path); this module only consumes the
 * resolved map, so the suite can pin the arithmetic without a database.
 */

/** The OQ-V2-2-decided per-group method (group config, default CLOSING_RATE). */
export type FxTranslationMethod = "CLOSING_RATE" | "TEMPORARY";

export const FX_TRANSLATION_METHODS: readonly FxTranslationMethod[] = [
  "CLOSING_RATE",
  "TEMPORARY",
] as const;

/** One dated stored rate (INV-008): base per 1 foreign, exactly as stored. */
export interface StoredRate {
  currency: string;
  rateDate: string;
  rate: string;
}

/** Resolved rate lookup: `${currency}@${date}` → the stored rate string. */
export type RateMap = ReadonlyMap<string, string>;

export function rateKey(currency: string, rateDate: string): string {
  return `${currency}@${rateDate}`;
}

/** amount × stored rate, canonical 4dp, half-up at the money scale (the
 * moneyRate discipline — Decimal, never Math.*; CURRENCY_AND_PRECISION §5:
 * round at the final step only). */
export function translateAtRate(amount: string, rate: string): string {
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4).toFixed(4);
}

/**
 * Resolve one dated rate or fail closed (RATE_MISSING / RATE_INVALID).
 * INV-008: the stored rate is used EXACTLY as stored — never recomputed,
 * never averaged, never silently defaulted to 1.
 */
export function requireDatedRate(
  rates: RateMap,
  currency: string,
  rateDate: string,
  groupId: string,
): string {
  const key = rateKey(currency, rateDate);
  const rate = rates.get(key);
  if (rate === undefined) {
    throw new RateMissingError({ currency, rateDate, groupId });
  }
  if (new Decimal(rate).lessThanOrEqualTo(0)) {
    throw new RateInvalidError({ currency, rate, rateDate });
  }
  return rate;
}

/**
 * Translate ONE member account line into the group currency under the
 * group's method.
 *
 * - Same-currency members (member base === group base): the amounts pass
 *   through UNTOUCHED (rate 1 is never applied — byte-stable parity with
 *   the member's own books; INV-008's "no recomputation" taken literally).
 * - CLOSING_RATE: `statement === "IS"` lines use the period rate (dated
 *   stored rate at the period END); `statement === "BS"` lines use the
 *   closing rate. At PHASE-034 both resolve to the SAME dated stored rate
 *   at the period end (the decision's simplification — one stored rate per
 *   (member currency, period-end date)); the split keeps the statement
 *   surface ready if a future compliance-folder record pins different
 *   dates (the seam is config-shaped, not code-shaped).
 * - TEMPORARY: identical to CLOSING_RATE for the account-line translation
 *   (the method's extra leg is the equity-recycling delta, which the run
 *   service surfaces as a CONSOLIDATION_ADJUSTMENT elimination line — see
 *   computeEquityRecyclingDelta).
 */
export function translateMemberLine(input: {
  groupId: string;
  groupBaseCurrency: string;
  memberBaseCurrency: string;
  method: FxTranslationMethod;
  statement: "IS" | "BS";
  amount: string;
  periodRate: string;
  closingRate: string;
}): string {
  if (input.memberBaseCurrency === input.groupBaseCurrency) {
    return input.amount; // pass-through — no multiplication, no drift
  }
  const rate = input.statement === "IS" ? input.periodRate : input.closingRate;
  return translateAtRate(input.amount, rate);
}

/**
 * The TEMPORARY method's equity-recycling delta (bounded PHASE-034 surface):
 * the difference between retranslating non-monetary balances at closing vs
 * transaction-date rates. The run service posts this as a
 * CONSOLIDATION_ADJUSTMENT elimination line when the group's method is
 * TEMPORARY; CLOSING_RATE groups never call it (returns "0.0000").
 *
 * Honest boundary: the transaction-date legs are the ACCOUNT-level balances
 * the reader aggregates (the account's stored translation inputs are the
 * member's own posted base amounts — dated rate resolution per account line
 * is the future compliance-folder seam, recorded in the completion report).
 */
export function computeEquityRecyclingDelta(input: {
  method: FxTranslationMethod;
  nonMonetaryClosingBalance: string;
  closingRate: string;
  transactionDateRatesBalance: string;
}): string {
  if (input.method !== "TEMPORARY") {
    return "0.0000";
  }
  const atClosing = translateAtRate(input.nonMonetaryClosingBalance, input.closingRate);
  return new Decimal(atClosing)
    .minus(new Decimal(input.transactionDateRatesBalance))
    .toDecimalPlaces(4)
    .toFixed(4);
}

/** Snapshot-stable rate resolution: the dated stored rate for a currency at
 * the LATEST stored date ≤ the requested date (the INV-008 dated-rate
 * convention — never interpolated, never averaged). */
export function resolveDatedRate(
  stored: readonly StoredRate[],
  currency: string,
  onOrBefore: string,
): string | undefined {
  let best: StoredRate | undefined;
  for (const row of stored) {
    if (row.currency !== currency || row.rateDate > onOrBefore) {
      continue;
    }
    if (best === undefined || row.rateDate > best.rateDate) {
      best = row;
    }
  }
  return best?.rate;
}
