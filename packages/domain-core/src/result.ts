import type { DomainError } from "./errors";

/**
 * Result type for fallible domain operations: failures carry a DomainError,
 * never a thrown exception across module boundaries.
 */
export type Result<T, E extends DomainError = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E extends DomainError>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

export function isOk<T, E extends DomainError>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E extends DomainError>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}
