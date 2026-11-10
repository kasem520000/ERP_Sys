/**
 * PHASE-022 T-P22-3-b · exact decimal arithmetic for the READ-CACHED
 * view-models and the §3 rejection executors (ADR-0009 §4: money and
 * quantities are TEXT canonical decimal strings — never REAL, never
 * number). Pure BigInt integer math under the decimal point; every input
 * is a canonical decimal string (optionally signed), every output is a
 * canonical decimal string trimmed to the significant scale.
 *
 * ZERO-IMPORT leaf (the constants.ts rule): imported via "./exact-decimal"
 * / "../exact-decimal", never through the root barrel.
 */

/** Parse a canonical decimal string onto {neg, units, scale}. */
function parseDecimal(value: string): { neg: boolean; units: bigint; scale: number } {
  const text = value.trim();
  const neg = text.startsWith("-");
  const unsigned = neg || text.startsWith("+") ? text.slice(1) : text;
  const dot = unsigned.indexOf(".");
  const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracPart = dot === -1 ? "" : unsigned.slice(dot + 1);
  const units = BigInt(intPart === "" ? "0" : intPart) * 10n ** BigInt(fracPart.length) +
    BigInt(fracPart === "" ? "0" : fracPart);
  return { neg: neg && units !== 0n, units, scale: fracPart.length };
}

/** Render {neg, units, scale} back to a canonical decimal string. */
function renderDecimal(parts: { neg: boolean; units: bigint; scale: number }): string {
  const scale = BigInt(parts.scale);
  const units = parts.units < 0n ? -parts.units : parts.units;
  const intPart = units / 10n ** scale;
  const fracPart = units % 10n ** scale;
  const fraction = parts.scale === 0 ? "" : `.${fracPart.toString().padStart(parts.scale, "0")}`;
  return `${parts.neg ? "-" : ""}${intPart.toString()}${fraction}`;
}

/** Align two decimals to a common scale (the pad for addition). */
function align(
  a: { neg: boolean; units: bigint; scale: number },
  b: { neg: boolean; units: bigint; scale: number },
): { a: bigint; b: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  const aUnits = (a.neg ? -a.units : a.units) * 10n ** BigInt(scale - a.scale);
  const bUnits = (b.neg ? -b.units : b.units) * 10n ** BigInt(scale - b.scale);
  return { a: aUnits, b: bUnits, scale };
}

/** Exact addition of two canonical decimal strings. */
export function addDecimals(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const aligned = align(pa, pb);
  const sum = aligned.a + aligned.b;
  const neg = sum < 0n;
  return renderDecimal({ neg, units: neg ? -sum : sum, scale: aligned.scale });
}

/** Exact multiplication of two canonical decimal strings. */
export function mulDecimals(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const product = (pa.neg ? -pa.units : pa.units) * (pb.neg ? -pb.units : pb.units);
  const neg = product < 0n;
  return renderDecimal({ neg, units: neg ? -product : product, scale: pa.scale + pb.scale });
}

/** Exact subtraction (a − b). */
export function subDecimals(a: string, b: string): string {
  return addDecimals(a, b.startsWith("-") ? b.slice(1) : `-${b}`);
}

/** Exact minimum of two canonical decimal strings (returns one of them). */
export function minDecimals(a: string, b: string): string {
  const pa = parseDecimal(a);
  const pb = parseDecimal(b);
  const aligned = align(pa, pb);
  return aligned.a <= aligned.b ? a : b;
}

/** Sum a list of canonical decimal strings ("0" for an empty list). */
export function sumDecimals(values: readonly string[]): string {
  return values.reduce((acc, value) => addDecimals(acc, value), "0");
}

/** Whether a canonical decimal string is exactly zero. */
export function isZeroDecimal(value: string): boolean {
  return parseDecimal(value).units === 0n;
}
