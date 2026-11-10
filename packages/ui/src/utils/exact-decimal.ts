/**
 * Exact 4-dp decimal arithmetic over canonical money STRINGS (ADR-0009 —
 * never floats). The same BigInt-minor-units approach the accounting engine
 * uses, so pattern components (MoneySummaryBar, ShiftPanel) can never
 * disagree with the engine on the same fixture.
 */

/** Parses a canonical decimal string into 4-dp BigInt minor units. */
function toMinor(value: string): bigint {
  const negative = value.startsWith("-");
  const [int = "0", frac = ""] = value.replace("-", "").split(".");
  const minor = BigInt(int === "" ? "0" : int) * 10_000n + BigInt(frac.slice(0, 4).padEnd(4, "0"));
  return negative ? -minor : minor;
}

/** Renders 4-dp BigInt minor units back to a canonical decimal string. */
function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 10_000n;
  const frac = (abs % 10_000n).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Exact 4-dp addition over canonical strings (BigInt minor units). */
export function addExact(a: string, b: string): string {
  return fromMinor(toMinor(a) + toMinor(b));
}

/** Exact 4-dp subtraction over canonical strings (BigInt minor units). */
export function subtractExact(a: string, b: string): string {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** Exact 4-dp comparison (-1 | 0 | 1) over canonical strings. */
export function compareExact(a: string, b: string): -1 | 0 | 1 {
  const diff = toMinor(a) - toMinor(b);
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}

/** True when a canonical string is zero at 4dp ("", "0", "0.00" …). */
export function isZeroExact(value: string): boolean {
  return toMinor(value === "" ? "0" : value) === 0n;
}
