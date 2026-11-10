import { Decimal } from "@erp/domain-core";

import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { readEffectiveSetting } from "../../../infra/settings/setting-reader";
import type * as store from "../infrastructure/treasury.store";
import {
  CashAccountClosedError,
  CashAccountCurrencyMismatchError,
  CashAccountNotFoundError,
  InvalidAmountError,
  TreasuryFxRateRequiredError,
} from "../domain/treasury-errors";

/**
 * Shared treasury document-support helpers (PHASE-008): exact-decimal money
 * math (ADR-0009 — identical half-up semantics to the posting engine), FX
 * rate capture, cash-account eligibility, and the BR-020/021/023 settings
 * readers. Everything here is pure plumbing for the application services —
 * no SQL, no HTTP.
 */

/** money(x): canonical 4-dp string, half-up (the engine's exact rule). */
export function money(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** amount × rate → canonical 4-dp base money, half-up (engine-identical). */
export function moneyMultiply(amount: string, rate: string): string {
  return money(new Decimal(amount).times(new Decimal(rate)));
}

/** a − b as canonical 4-dp (BigInt exact via decimal-strings semantics). */
export function moneySub(a: string, b: string): string {
  return money(new Decimal(a).minus(new Decimal(b)));
}

/** a + b as canonical 4-dp. */
export function moneyAdd(a: string, b: string): string {
  return money(new Decimal(a).plus(new Decimal(b)));
}

export function moneyCompare(a: string, b: string): number {
  return new Decimal(a).comparedTo(new Decimal(b));
}

export function moneyAbs(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}

/** Positive canonical amount or the typed error (§6 failure pack: INVALID_AMOUNT). */
export function requirePositiveAmount(raw: string, label: string): string {
  const value = money(new Decimal(raw));
  if (!new Decimal(value).isFinite() || new Decimal(value).lte(0)) {
    throw new InvalidAmountError(`${label} must be a positive decimal, got "${raw}"`);
  }
  return value;
}

/** The effective settlement rate (r₁): required + positive when ≠ base (INV-008 capture). */
export async function resolveDocumentRate(input: {
  currencyCode: string;
  exchangeRate: string | null;
}): Promise<string> {
  const base = await ownTenantBaseCurrency();
  if (input.currencyCode === base) return "1";
  if (input.exchangeRate === null || input.exchangeRate === "") {
    throw new TreasuryFxRateRequiredError(input.currencyCode);
  }
  const rate = new Decimal(input.exchangeRate);
  if (!rate.isFinite() || rate.lte(0)) {
    throw new InvalidAmountError(`exchange rate must be positive, got "${input.exchangeRate}"`);
  }
  return rate.toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toFixed(8);
}

/**
 * An ACTIVE cash account (§6 failure pack: closed target). The settlement
 * currency may differ from the drawer's primary currency — the movement
 * records the settlement currency + base conversion, and the posting engine
 * enforces the real INV-005 restriction on the GL side at post time.
 */
export function requireActiveAccount(
  account: store.CashAccountRow | undefined,
): store.CashAccountRow {
  if (account === undefined) {
    // A7: identical shape for unknown-vs-foreign (controller maps 404).
    throw new CashAccountNotFoundError("unknown");
  }
  if (account.status === "CLOSED") {
    throw new CashAccountClosedError(account.id);
  }
  return account;
}

/**
 * An ACTIVE cash account whose drawer currency matches the document
 * currency exactly (same-currency flows: transfers and expenses).
 */
export function requireActiveAccountInCurrency(
  account: store.CashAccountRow | undefined,
  documentCurrency: string,
): store.CashAccountRow {
  const active = requireActiveAccount(account);
  if (active.currencyCode !== documentCurrency) {
    throw new CashAccountCurrencyMismatchError({
      accountCurrency: active.currencyCode,
      documentCurrency,
    });
  }
  return active;
}

/** Official treasury document numbers (INV-021 via the PHASE-007 numbering service). */
export const TREASURY_NUMBER_FORMATS = {
  receipt: { prefix: "RCV", format: "RCV-{YYYY}-{SEQ:6}", docType: "receipt" },
  payment: { prefix: "PAY", format: "PAY-{YYYY}-{SEQ:6}", docType: "payment" },
  cash_transfer: { prefix: "TRF", format: "TRF-{YYYY}-{SEQ:6}", docType: "cash_transfer" },
  expense: { prefix: "EXP", format: "EXP-{YYYY}-{SEQ:6}", docType: "expense" },
  cashier_shift: { prefix: "SHT", format: "SHT-{YYYY}-{SEQ:6}", docType: "cashier_shift" },
} as const;

export type TreasuryDocType = keyof typeof TREASURY_NUMBER_FORMATS;

/** BR-020 settings (PLACEHOLDER defaults documented per OQ-002). */
export async function pettyCashSettings(): Promise<{ singleTxLimit: string; maxBalance: string }> {
  const single = await readEffectiveSetting<string>("treasury.petty_cash.single_tx_limit");
  const max = await readEffectiveSetting<string>("treasury.petty_cash.max_balance");
  return { singleTxLimit: single ?? "5000.0000", maxBalance: max ?? "20000.0000" };
}

/** BR-021 settings. */
export async function shiftSettings(): Promise<{
  tolerance: string;
  autoPost: boolean;
  supervisorPin: string;
}> {
  const tolerance = await readEffectiveSetting<string>("treasury.shift_variance_tolerance");
  const autoPost = await readEffectiveSetting<boolean>("treasury.shift_auto_post_small_variance");
  const supervisorPin = await readEffectiveSetting<string>("treasury.shift_supervisor_pin");
  return {
    tolerance: tolerance ?? "0.0000",
    autoPost: autoPost ?? true,
    supervisorPin: supervisorPin ?? "",
  };
}

/** BR-023 receipt-attachment threshold (0 = always required). */
export async function expenseReceiptThreshold(): Promise<string> {
  const threshold = await readEffectiveSetting<string>("treasury.expense_receipt_threshold");
  return threshold ?? "0.0000";
}

/** The tenant base currency (cached read via the settings substrate). */
export async function baseCurrency(): Promise<string> {
  return ownTenantBaseCurrency();
}
