/**
 * PHASE-049 (W-17 — T-05/T-06/T-07, the work-order engine + plans) — the
 * PURE plan-evaluation arithmetic, the FIRST deliverable of the wave (the
 * unit-first law, the 047/048 precedent: this file and its spec land
 * BEFORE any consumer — the service layers of T-05/T-06/T-07 import from
 * here and add NO arithmetic of their own; zero parallel computation —
 * كل حسابٍ هنا ومصدره هنا). No clock reads, no store, no I/O: `today`
 * and the reading values ARRIVE as inputs (the deterministic-template
 * law — the W-8 clock-fix discipline extended to the CMMS plane), so
 * every evaluation is reproducible from its inputs alone.
 *
 * THE LAWS PINNED HERE (the master plan D-08/D-03/D-04 + BR-097/BR-098
 * + INV-034):
 *
 * - CALENDAR DUE (D-08): a plan is due when today ≥ next_due_date —
 *   inclusive (the due day IS the trigger day). `nextCalendarDue` is the
 *   STRICT CADENCE: next_due := next_due + interval_days, computed from
 *   the plan's own calendar anchor, NEVER from the wall clock at
 *   evaluation time («recomputed from the last generation, never
 *   wall-clock drift») — a late generation keeps the rhythm (a 30-day
 *   plan due 2026-03-01 that generated on 2026-03-10 re-arms at
 *   2026-03-31, not 2026-04-09).
 *
 * - METER DUE (D-08): due when reading.value − last_generation_anchor ≥
 *   threshold_delta — inclusive at exactly the threshold («crosses» per
 *   the phase doc reads as ≥: the 5,000th km IS the due km). The ANCHOR
 *   is the GENERATION's own reading stamp: after generating at 15,200,
 *   a BACK-DATED 14,000 reading evaluates at its own position
 *   (14,000 − 15,200 < 0 → never due — the no-double-trigger law) and a
 *   back-dated-but-HIGHER 16,000 reading re-evaluates from the anchor
 *   too (800 < 5,000 → still not due) — a window already generated
 *   never re-arms. A NULL anchor is the baseline zero (a METER plan
 *   authored before any generation measures from the meter's authoring
 *   snapshot, which the service persists as the anchor at authoring —
 *   the fold here treats null as 0 so the arithmetic has exactly one
 *   shape).
 *
 * - BR-097 (the single-open window): the generation decision fold NAMES
 *   its skips — a due plan with an OPEN generated order per (asset,
 *   plan) skips as PLAN_WINDOW_OPEN (the refusal the service surfaces
 *   BY NAME — never a silent skip, never a silent truncation); a not-due
 *   plan skips as PLAN_NOT_DUE. Only a due plan with a closed window
 *   generates.
 *
 * - THE COST COLLECTORS (D-03/D-04): the labor line amount is
 *   hours × unit_rate with ONE half-up rounding at the 4-dp money
 *   quantum (the crm_time_entries snapshot precedent: the rate is
 *   snapshotted at line creation and NEVER recomputed — an unset rate is
 *   UNPRICED, never a fabricated rate). The INV-034 reconciliation fold
 *   carries the per-leg typed breakdown: GL maintenance expense must
 *   equal labor + parts + external to the cent — the verdict names the
 *   exact difference and every leg's figure (never a bare boolean).
 *
 * All money/quantity math is EXACT scaled-integer arithmetic (BigInt
 * minor units — ADR-0009; the contracting-math W-11 helpers' shape).
 */

// ── the exact scaled-integer core (the W-11 local helpers' shape) ──────────

/** Money travels at 4dp (ADR-0009); quantities/meter values at 6dp. */
const MONEY_SCALE = 4;
const QTY_SCALE = 6;

function toMinor(value: string, scale: number, what: string): bigint {
  if (!/^-?\d+(\.\d+)?$/.test(value)) {
    throw new Error(`${what} must be a canonical decimal string: ${value}`);
  }
  const negative = value.startsWith("-");
  const bare = negative ? value.slice(1) : value;
  const [whole, frac = ""] = bare.split(".");
  if (frac.length > scale) {
    throw new Error(`${what} exceeds ${scale}dp: ${value}`);
  }
  const minor = BigInt(whole + frac.padEnd(scale, "0"));
  return negative ? -minor : minor;
}

function fromMinor(minor: bigint, scale: number): string {
  const negative = minor < 0n;
  const bare = (negative ? -minor : minor).toString().padStart(scale + 1, "0");
  const whole = bare.slice(0, bare.length - scale);
  const frac = bare.slice(bare.length - scale);
  const trimmed = frac.replace(/0+$/, "");
  const body = trimmed.length === 0 ? whole : `${whole}.${trimmed}`;
  return negative ? `-${body}` : body;
}

/** Half-up division (BigInt): value ÷ divisor at the target scale. */
function roundDivHalfUp(value: bigint, divisor: bigint): bigint {
  const twice = value * 2n + divisor;
  const quotient = twice / (divisor * 2n);
  // BigInt division truncates toward zero; twice was arranged so that
  // truncation IS the half-up boundary for the non-negative inputs this
  // module's laws admit (hours, rates, amounts are all ≥ 0).
  return quotient;
}

// ── the calendar fold (D-08 — the strict cadence) ──────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toUtcDay(iso: string, what: string): number {
  if (!ISO_DATE.test(iso)) {
    throw new Error(`${what} must be an ISO calendar date (yyyy-mm-dd): ${iso}`);
  }
  const [y, m, d] = iso.split("-").map((part) => Number.parseInt(part, 10));
  const ms = Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
  const back = new Date(ms).toISOString().slice(0, 10);
  if (back !== iso) {
    throw new Error(`${what} is not a real calendar date: ${iso}`);
  }
  return ms;
}

function fromUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** CALENDAR due (D-08): today ≥ next_due — the due day IS the trigger day. */
export function calendarDue(today: string, nextDue: string): boolean {
  return toUtcDay(today, "today") >= toUtcDay(nextDue, "nextDue");
}

/**
 * The STRICT CADENCE (D-08): the next due date is the plan's own
 * next_due + interval_days — computed from the plan's calendar anchor,
 * never from the wall clock at evaluation time. Interval bounds mirror
 * the 0105 CHECK (1…3650).
 */
export function nextCalendarDue(nextDue: string, intervalDays: number): string {
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650) {
    throw new Error(`intervalDays must be an integer in [1, 3650]: ${intervalDays}`);
  }
  return fromUtcDay(toUtcDay(nextDue, "nextDue") + intervalDays * DAY_MS);
}

// ── the meter fold (D-08 — the anchor semantics) ───────────────────────────

/**
 * reading.value − last_generation_anchor at the 6-dp meter quantum. A
 * NULL anchor is the baseline zero (exactly one arithmetic shape — the
 * service persists the authoring snapshot, so null reaches this fold
 * only from legacy/manual rows and reads as 0).
 */
export function meterDelta(readingValue: string, anchor: string | null): string {
  const value = toMinor(readingValue, QTY_SCALE, "readingValue");
  const base = anchor === null ? 0n : toMinor(anchor, QTY_SCALE, "anchor");
  return fromMinor(value - base, QTY_SCALE);
}

/** METER due (D-08): delta ≥ threshold — the 5,000th km IS the due km. */
export function meterDue(
  readingValue: string,
  anchor: string | null,
  threshold: string,
): boolean {
  const value = toMinor(readingValue, QTY_SCALE, "readingValue");
  const base = anchor === null ? 0n : toMinor(anchor, QTY_SCALE, "anchor");
  const limit = toMinor(threshold, QTY_SCALE, "threshold");
  if (limit <= 0n) {
    throw new Error(`threshold must be > 0: ${threshold}`);
  }
  return value - base >= limit;
}

// ── the generation decision fold (BR-097 — the named skips) ────────────────

/** Why a due-or-not plan did not generate — NAMED, never a silent skip. */
export type GenerationSkipReason = "PLAN_NOT_DUE" | "PLAN_WINDOW_OPEN";

export interface GenerationDecision {
  readonly generate: boolean;
  /** Present exactly when generate is false — the named skip. */
  readonly skipReason?: GenerationSkipReason;
}

/**
 * BR-097's fold: only a DUE plan with a CLOSED window generates. A due
 * plan whose (asset, plan) window already holds an OPEN generated order
 * skips as PLAN_WINDOW_OPEN — the skip the service surfaces BY NAME at
 * the forced path and reports in the evaluation's skip list (never a
 * silent truncation); the window re-arms when the open order completes
 * (the 0105 partial unique's own law).
 */
export function generationDecision(input: {
  due: boolean;
  openWindow: boolean;
}): GenerationDecision {
  if (!input.due) return { generate: false, skipReason: "PLAN_NOT_DUE" };
  if (input.openWindow) return { generate: false, skipReason: "PLAN_WINDOW_OPEN" };
  return { generate: true };
}

// ── the cost collectors (D-03/D-04 — the snapshot arithmetic) ──────────────

/**
 * The labor line amount: hours × unit_rate with ONE half-up rounding at
 * the 4-dp money quantum (6dp × 6dp → 4dp). The rate is an INPUT here —
 * the service passes the SNAPSHOT (the crm_time_entries.unitRate law:
 * snapshotted at line creation, never recomputed; an unset rate never
 * reaches this fold — the line stays UNPRICED and BR-098's gate refuses
 * the completion BY NAME).
 */
export function laborLineAmount(hours: string, unitRate: string): string {
  const hoursM6 = toMinor(hours, QTY_SCALE, "hours");
  const rateM6 = toMinor(unitRate, QTY_SCALE, "unitRate");
  if (hoursM6 <= 0n) throw new Error(`hours must be > 0: ${hours}`);
  if (rateM6 < 0n) throw new Error(`unitRate must be non-negative: ${unitRate}`);
  const productM12 = hoursM6 * rateM6; // 6dp × 6dp = 12dp exact
  const amountM4 = roundDivHalfUp(productM12, 10n ** 8n); // → 4dp half-up
  return fromMinor(amountM4, MONEY_SCALE);
}

/** The exact 4-dp sum (the totals' fold — never a stored sum to go stale). */
export function sumAmounts(values: readonly string[]): string {
  let total = 0n;
  for (const value of values) {
    total += toMinor(value, MONEY_SCALE, "amount");
  }
  return fromMinor(total, MONEY_SCALE);
}

// ── the INV-034 reconciliation fold (the per-leg typed breakdown) ──────────

/** INV-034's verdict — every figure named, the difference exact. */
export interface Inv034Verdict {
  readonly balanced: boolean;
  readonly labor: string;
  readonly parts: string;
  readonly external: string;
  /** labor + parts + external (the source-lines total). */
  readonly sourceTotal: string;
  /** The GL maintenance-expense DEBIT the G-59 entry carried. */
  readonly glExpenseDebit: string;
  /** 0 when balanced; the exact signed excess (GL − source) when not. */
  readonly difference: string;
}

/**
 * INV-034 (work-order cost integrity): per work order, the GL
 * maintenance expense equals the sum of its labor, parts and external
 * source lines TO THE CENT — no posting occurs before completion (the
 * gate is the service's; this fold is the reconciliation the golden
 * transcripts and the reports read). The verdict carries the per-leg
 * typed breakdown and the exact difference — never a bare boolean (the
 * poisoned world's refusal names what broke and by how much).
 */
export function reconcileWorkOrderCosts(input: {
  laborTotal: string;
  partsTotal: string;
  externalTotal: string;
  glExpenseDebit: string;
}): Inv034Verdict {
  const labor = toMinor(input.laborTotal, MONEY_SCALE, "laborTotal");
  const parts = toMinor(input.partsTotal, MONEY_SCALE, "partsTotal");
  const external = toMinor(input.externalTotal, MONEY_SCALE, "externalTotal");
  const gl = toMinor(input.glExpenseDebit, MONEY_SCALE, "glExpenseDebit");
  const source = labor + parts + external;
  const difference = gl - source;
  return {
    balanced: difference === 0n,
    labor: fromMinor(labor, MONEY_SCALE),
    parts: fromMinor(parts, MONEY_SCALE),
    external: fromMinor(external, MONEY_SCALE),
    sourceTotal: fromMinor(source, MONEY_SCALE),
    glExpenseDebit: fromMinor(gl, MONEY_SCALE),
    difference: fromMinor(difference, MONEY_SCALE),
  };
}
