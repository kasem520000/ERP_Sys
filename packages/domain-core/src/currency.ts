/** ISO-4217 minor units per docs/localization/CURRENCY_AND_PRECISION.md §2. */
export const CURRENCY_MINOR_UNITS = {
  SAR: 2, // Saudi Riyal
  AED: 2, // UAE Dirham
  QAR: 2, // Qatari Riyal
  EGP: 2, // Egyptian Pound
  YER: 2, // Yemeni Rial
  BHD: 3, // Bahraini Dinar
  KWD: 3, // Kuwaiti Dinar
  OMR: 3, // Omani Rial
  JOD: 3, // Jordanian Dinar
  IQD: 3, // Iraqi Dinar
  USD: 2, // cross-border trade
  EUR: 2, // cross-border trade
} as const;

export type CurrencyCode = keyof typeof CURRENCY_MINOR_UNITS;

export const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = Object.keys(
  CURRENCY_MINOR_UNITS,
) as readonly CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCY_MINOR_UNITS, value);
}

export function minorUnitsOf(currency: CurrencyCode): number {
  return CURRENCY_MINOR_UNITS[currency];
}
