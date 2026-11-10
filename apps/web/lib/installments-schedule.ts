/**
 * PHASE-027 (wave F) — the client-side mirror of the installments schedule
 * kernel. The authoritative implementation lives in the API
 * (apps/api/src/modules/installments/application/plan-service.ts —
 * `computeSchedule` + `advanceDate`); this helper reproduces it verbatim so
 * the wizard's LIVE preview can never disagree with what the server will
 * store. Any change there MUST be mirrored here (the shared-kernel rule the
 * depreciation preview uses). Exact string math via lib/exact-money
 * (ADR-0009 — no floats anywhere).
 *
 * Schedule math (flat, DR-003 — no interest, no compounding):
 *   lineAmount = round4((total − down) / count) — ROUND_HALF_UP
 *   lastLine   = (total − down) − (count − 1) × lineAmount  (remainder
 *                absorption: Σ lines == total − down EXACTLY)
 * Due dates: start + (seq − 1) frequency steps (WEEKLY +7d, BIWEEKLY +14d,
 * MONTHLY/QUARTERLY calendar months with end-of-month clamping).
 */
import { addExact, compareExact, subtractExact } from "./exact-money";

export type InstallmentFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "QUARTERLY";

export interface ScheduleLine {
  seq: number;
  dueDate: string;
  amount: string;
}

/**
 * BR-049 PLACEHOLDER defaults (OQ-002 family — configuration, never silent):
 * the exact LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS the API kernel normalizes
 * to; the wizard pre-fills these and labels them as PLACEHOLDER.
 */
export const LATE_FEE_POLICY_PLACEHOLDER_DEFAULTS = {
  rate: "0.0200",
  cap: "500.0000",
  grace_days: 7,
  auto_charge: false,
  defaulted_after_lines: 3,
} as const;

/** Exact 4-dp round-half-up division helper (the Decimal.toDecimalPlaces(4, ROUND_HALF_UP) mirror). */
function divRound4(spread: string, count: number): string {
  // spread arrives as a canonical 4-dp string → N = spread in minor units.
  const negative = spread.startsWith("-");
  const [int = "0", frac = ""] = spread.replace("-", "").split(".");
  const n = BigInt(int === "" ? "0" : int) * 10_000n + BigInt(frac.slice(0, 4).padEnd(4, "0")) * (negative ? -1n : 1n);
  const c = BigInt(count);
  // round half away from zero: (2·|N| + c) / 2c, then re-apply the sign.
  const absN = n < 0n ? -n : n;
  const roundedMinor = (absN * 2n + c) / (c * 2n);
  const signed = negative ? -roundedMinor : roundedMinor;
  const neg4 = signed < 0n;
  const abs4 = neg4 ? -signed : signed;
  const whole = abs4 / 10_000n;
  const frac4 = (abs4 % 10_000n).toString().padStart(4, "0");
  return `${neg4 ? "-" : ""}${whole}.${frac4}`;
}

/**
 * Calendar-step date math (UTC, string-to-string): WEEKLY +7d, BIWEEKLY
 * +14d; MONTHLY/QUARTERLY add calendar months with end-of-month clamping
 * (Jan 31 + 1 month = Feb 28/29). Mirrors the kernel's advanceDate.
 */
export function advanceScheduleDate(startDate: string, frequency: string, steps: number): string {
  if (steps === 0) return startDate;
  if (frequency === "WEEKLY" || frequency === "BIWEEKLY") {
    const days = frequency === "WEEKLY" ? 7 : 14;
    const ms = new Date(`${startDate}T00:00:00Z`).getTime() + steps * days * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const months = frequency === "MONTHLY" ? 1 : 3;
  const y = Number(startDate.slice(0, 4));
  const m = Number(startDate.slice(5, 7));
  const d = Number(startDate.slice(8, 10));
  const total = y * 12 + (m - 1) + steps * months;
  // Integer month→year division without Math.* (ADR-0009 lint rule).
  const year = (total - (total % 12)) / 12;
  const month = (total % 12) + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, daysInMonth);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The pure schedule kernel (mirror of the API computeSchedule): flat
 * per-line amounts with remainder absorption on the last line; a
 * non-positive line (down payment ≥ spread) throws the same invalid-shape
 * signal the server surfaces as SCHEDULE_INVALID.
 */
export function computeSchedulePreview(input: {
  total: string;
  down: string;
  count: number;
  startDate: string;
  frequency: InstallmentFrequency;
}): ScheduleLine[] {
  const spread = subtractExact(input.total, input.down);
  const perLine = divRound4(spread, input.count);
  const lines: ScheduleLine[] = [];
  let allocated = "0.0000";
  for (let seq = 1; seq <= input.count; seq += 1) {
    const amount = seq === input.count ? subtractExact(spread, allocated) : perLine;
    if (compareExact(amount, "0.0000") <= 0) {
      throw new Error(`line ${seq} computed a non-positive amount ${amount}`);
    }
    allocated = addExact(allocated, amount);
    lines.push({ seq, dueDate: advanceScheduleDate(input.startDate, input.frequency, seq - 1), amount });
  }
  return lines;
}
