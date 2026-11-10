/**
 * T14-UI (PHASE-008) — exact decimal string math for the treasury screens
 * (ADR-0009: money values are canonical decimal STRINGS, never floats).
 * The same BigInt 4-dp minor-units approach the @erp/ui patterns use
 * (packages/ui exact-decimal) and the posting engine uses — the UI can
 * never disagree with the engine on the same fixture.
 */

/** Parses a canonical decimal string into 4-dp BigInt minor units. */
function toMinor(value: string): bigint {
  const negative = value.startsWith("-");
  const [int = "0", frac = ""] = value.replace("-", "").split(".");
  const minor =
    BigInt(int === "" ? "0" : int) * 10_000n + BigInt(frac.slice(0, 4).padEnd(4, "0"));
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

/** Σ over canonical strings; empty strings count as zero. */
export function sumExact(values: readonly string[]): string {
  let minor = 0n;
  for (const value of values) {
    minor += toMinor(value === "" ? "0" : value);
  }
  return fromMinor(minor);
}

/** Exact 4-dp subtraction (a − b). */
export function subtractExact(a: string, b: string): string {
  return fromMinor(toMinor(a === "" ? "0" : a) - toMinor(b === "" ? "0" : b));
}

/** Exact 4-dp addition (a + b). */
export function addExact(a: string, b: string): string {
  return fromMinor(toMinor(a === "" ? "0" : a) + toMinor(b === "" ? "0" : b));
}

/** Exact 4-dp comparison (-1 | 0 | 1). */
export function compareExact(a: string, b: string): -1 | 0 | 1 {
  const diff = toMinor(a === "" ? "0" : a) - toMinor(b === "" ? "0" : b);
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}

/** True when the canonical string is zero at 4dp ("", "0", "0.00" …). */
export function isZeroExact(value: string): boolean {
  return toMinor(value === "" ? "0" : value) === 0n;
}

/** Positive-decimal shape check (mirrors the API MONEY regex, ≤8 dp). */
export function isPositiveDecimal(value: string): boolean {
  return /^\d+(\.\d{1,8})?$/.test(value.trim());
}

/** Parses a decimal string at an arbitrary fixed dp into BigInt minor units. */
function toMinorAt(value: string, dp: bigint): bigint {
  const [int = "0", frac = ""] = value.split(".");
  return BigInt(int === "" ? "0" : int) * 10n ** dp + BigInt(frac.slice(0, Number(dp)).padEnd(Number(dp), "0"));
}

/** Renders BigInt minor units at a fixed dp back to a canonical decimal string. */
function fromMinorAt(minor: bigint, dp: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 10n ** dp;
  const frac = (abs % 10n ** dp).toString().padStart(Number(dp), "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** Exact money × integer-count (denomination grids; ADR-0009 — never floats). */
export function mulCountExact(value: string, count: string): string {
  if (!/^\d+$/.test(count)) {
    return "0.0000";
  }
  return fromMinor(toMinor(value === "" ? "0" : value) * BigInt(count));
}

/**
 * Exact qty(≤6dp) × unitPrice(≤6dp) rounded half-up to 4dp money — the POS
 * cart/Z-preview line math. A PREVIEW only (the engine's own line math stays
 * authoritative); exact so the preview can never disagree with itself.
 */
export function mulQtyPriceExact(qty: string, unitPrice: string): string {
  const product = toMinorAt(qty === "" ? "0" : qty, 6n) * toMinorAt(unitPrice === "" ? "0" : unitPrice, 6n);
  const scale = 10n ** 8n; // 6dp × 6dp = 12dp → 4dp needs ÷10^8
  const quotient = product / scale;
  const remainder = product % scale;
  const rounded = remainder * 2n >= scale ? quotient + 1n : quotient;
  return fromMinorAt(rounded, 4n);
}

/** Exact ±1 step on a ≤6dp quantity string (POS cart steppers; never floats). */
export function stepQtyExact(qty: string, delta: 1 | -1): string {
  const minor = toMinorAt(qty === "" ? "0" : qty, 6n) + BigInt(delta);
  if (minor <= 0n) {
    return "0";
  }
  return fromMinorAt(minor, 6n);
}

/**
 * Integer percent (0–100) of part/whole at 4dp — DISPLAY bars only; the
 * return drives a CSS width, never a money value (ADR-0009 stays intact).
 */
export function percentExact(part: string, whole: string): number {
  const wholeMinor = toMinor(whole === "" ? "0" : whole);
  if (wholeMinor <= 0n) {
    return 0;
  }
  const percent = (toMinor(part === "" ? "0" : part) * 100n) / wholeMinor;
  return Number(percent > 100n ? 100n : percent);
}
