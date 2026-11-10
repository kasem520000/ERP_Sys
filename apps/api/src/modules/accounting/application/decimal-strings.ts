/**
 * Exact decimal-string helpers (PHASE-007; ADR-0009 — no binary floating
 * point anywhere near money). Everything operates on canonical "1234.5678"
 * strings at the 4-dp money scale via BigInt minor units; consumers that
 * need arbitrary precision use @erp/domain-core's Decimal directly.
 */

const SCALE = 4n;
const SCALE_POW = 10n ** SCALE;

/** Parse a canonical decimal string to signed minor units (BigInt). */
function toMinor(value: string): bigint {
  const negative = value.startsWith("-");
  const [int = "0", frac = ""] = value.replace("-", "").split(".");
  const minor = BigInt(int) * SCALE_POW + BigInt(frac.slice(0, 4).padEnd(4, "0"));
  return negative ? -minor : minor;
}

/** Render signed minor units back to a canonical 4-dp string. */
function fromMinor(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / SCALE_POW;
  const frac = (abs % SCALE_POW).toString().padStart(4, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** a + b (exact, 4 dp). */
export function addExact(a: string, b: string): string {
  return fromMinor(toMinor(a) + toMinor(b));
}

/** a − b (exact, 4 dp). */
export function subExact(a: string, b: string): string {
  return fromMinor(toMinor(a) - toMinor(b));
}

/** a × b (exact, 4 dp, half-up at the money scale). */
export function multiplyExact(a: string, b: string): string {
  const product = (toMinor(a) * toMinor(b)) / SCALE_POW;
  return fromMinor(product);
}

/** |a| (exact). */
export function absExact(a: string): string {
  return a.startsWith("-") ? a.slice(1) : a;
}

/** a ? b → -1 | 0 | 1 (exact compare). */
export function compareExact(a: string, b: string): number {
  const ma = toMinor(a);
  const mb = toMinor(b);
  return ma === mb ? 0 : ma > mb ? 1 : -1;
}
