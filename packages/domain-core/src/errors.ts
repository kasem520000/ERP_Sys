/**
 * Base class for all domain errors. Codes are stable, machine-readable
 * UPPER_SNAKE strings; messages are human-facing and never parsed.
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** A value failed format/precision validation (e.g. money string with 5 decimals). */
export class InvalidValueError extends DomainError {
  constructor(
    message: string,
    override readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super("domain/invalid-value", message, details);
  }
}

/** An operation was attempted across different currencies. */
export class CurrencyMismatchError extends DomainError {
  constructor(readonly left: string, readonly right: string) {
    super("domain/currency-mismatch", `Currency mismatch: ${left} vs ${right}`, {
      left,
      right,
    });
  }
}
