/**
 * @erp/domain-core — shared kernel (ADR-0002).
 * Everything here is isomorphic (Node + browser): no Node-only APIs.
 */
export { Decimal, DECIMAL_PRECISION, STORAGE_SCALE } from "./precision";
export {
  CURRENCY_MINOR_UNITS,
  SUPPORTED_CURRENCIES,
  isCurrencyCode,
  minorUnitsOf,
  type CurrencyCode,
} from "./currency";
export { Money } from "./money";
export { Quantity } from "./quantity";
export { Rate } from "./rate";
export {
  DomainError,
  InvalidValueError,
  CurrencyMismatchError,
} from "./errors";
export type { Result } from "./result";
export { ok, err, isOk, isErr } from "./result";
export { generateUuidV7, Uuidv7OverflowError } from "./uuidv7";
export { CalendarDate } from "./calendar-date";
