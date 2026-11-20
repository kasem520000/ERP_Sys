import { EvCeilingExceededError } from "./projects-errors";
import { accruedThrough, type CurveCell } from "./projects-math";

/**
 * PHASE-048 (W-10 — Projects & Contracting: the EVM + change orders +
 * IAS 23 engines) — the PURE W-10 math (T-08 + the D-11 folds), the
 * D-06/D-11 laws: the EVM indices (PV/EV/AC, CPI/SPI, EAC/ETC with the
 * documented fallback law), THE EV CEILING REFUSAL (EV never exceeds the
 * budget at the scope it is earned against — the typed refusal, acceptance
 * #4), the whole-tree aggregate percent fold (BR-095's super-root
 * corollary — the structural EV percent), and the IAS-23 capitalization
 * folds (the qualifying window from the WBS schedule + the per-line
 * eligible/expensed split with the DOCUMENTED STOP RULES). No clock, no
 * store, no I/O (the 047/W-9 unit-first precedents); all money/percent
 * math is EXACT SCALED-INTEGER arithmetic (BigInt minor units —
 * ADR-0009; the W-9 scale-bug lesson is why every example below is
 * hand-computed against the scale algebra in the comments).
 *
 * THE LAWS PINNED HERE:
 *
 * - D-06 (the two EV disciplines): EV = approved %-complete × budget —
 *   the STRUCTURAL discipline reads the weighted rollup percent (the
 *   whole tree is one scope: `aggregateWeightedPercent` — every leaf
 *   contributes (weight ?? 1) × its own report, the parent's own report
 *   never entering the fold, ONE rounding at the 2-dp display); the
 *   CERTIFICATE discipline reads the latest APPROVED progress
 *   certificate's cumulative percent (the customer-billing figure — the
 *   service feeds it through the same `earnedValue` fold). The delta
 *   between them is the management signal (the phase doc's
 *   %-complete-honesty mitigation) — never an error.
 *
 * - THE EV CEILING (acceptance #4): `earnedValue` / `earnedValueFrom-
 *   Aggregate` REFUSE (the typed `EvCeilingExceededError`) when the
 *   computed EV exceeds the budget it is earned against — at every
 *   scope: a node's EV against the node's planned cells, the project's
 *   EV against BAC (the approved budget + the approved change-order
 *   deltas — G-58's re-baseline law). The boundary EV = ceiling is
 *   LEGAL (100% complete earns exactly the budget, never more).
 *
 * - THE INDEX FALLBACK LAW: CPI = EV/AC and SPI = EV/PV are NULL when
 *   the denominator is 0 (an honest absence — never a fabricated ∞ or
 *   a fabricated 0). ETC = (BAC − EV)/CPI while a positive CPI exists
 *   (computed EXACTLY as (BAC − EV) × AC / EV — never through the
 *   rounded CPI); the documented REMAINDER fallback (ETC = BAC − EV,
 *   the remaining work at budget cost) applies when EV = 0 or AC = 0
 *   (CPI absent or zero). EAC = AC + ETC always.
 *
 * - D-11 (the IAS-23 folds): `ias23Window` reads the qualifying window
 *   from the WBS schedule (the min start / max end over the tasks that
 *   carry BOTH dates — no scheduled task = null, the caller's typed
 *   refusal; never a fabricated window). `ias23Split` folds ONE budget
 *   line against the window with the DOCUMENTED STOP RULES:
 *   (1) THE START LAW — expenditure accruing before the window start
 *       never capitalizes (its attributable borrowing cost expenses);
 *   (2) THE COMPLETION LAW — capitalization stops at the window end
 *       (the accrual past it expenses; the eligible fold caps at the
 *       slice);
 *   (3) THE ELAPSED LAW — the fold never accrues beyond `asOf` (the
 *       projection arm is the caller's; the POSTING arm enforces
 *       asOf ≤ today at the service — the never-future stop rule).
 *   The split is EXACT: the eligible portion is the line's own
 *   uniform daily spread over the [max(periodStart, windowStart),
 *   min(periodEnd, windowEnd, asOf)] sub-window with ONE half-up
 *   rounding at the 4-dp money value; `expenditures` is the whole
 *   line's accrual through asOf (the W-9 `accruedThrough` fold); the
 *   ineligible residual is their exact difference (so eligible +
 *   ineligible = expenditures IDENTICALLY); capitalized = eligible ×
 *   rate and expensed = ineligible × rate, ONE rounding each — and
 *   capitalized + expensed ≤ expenditures HOLDS BY CONSTRUCTION
 *   (rate ∈ [0,1] and half-up rounding is monotone: round(x) ≤ N for
 *   any x ≤ N on the 4-dp grid — the 0103 CHECK's own law).
 */

// ── the exact scaled-integer core (the W-9 helpers' shape, local) ─────────

/** Parse a canonical decimal string to minor units at the given scale. */
function toMinor(value: string, scale: number, what: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", frac = ""] = value.replace("-", "").split(".");
  if (frac.length > scale) {
    throw new Error(`${what}: more than ${scale} decimal digits: ${value}`);
  }
  const minor = BigInt(whole + frac.padEnd(scale, "0"));
  return negative ? -minor : minor;
}

/** Render minor units as a canonical decimal string at the scale. */
function fromMinor(minor: bigint, scale: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const pow = 10n ** BigInt(scale);
  const whole = abs / pow;
  const frac = (abs % pow).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${whole.toString()}.${frac}`;
}

/** Half-up rounding of numerator/denominator to minor units at the
 * given scale (a tie rounds UP — ADR-0009's convention). */
function roundDivHalfUp(numerator: bigint, denominator: bigint, scale: number): bigint {
  if (denominator === 0n) throw new Error("roundDivHalfUp: zero denominator");
  const pow = 10n ** BigInt(scale);
  const scaled = numerator * pow;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const bump = remainder * 2n >= denominator ? 1n : 0n;
  return quotient + bump;
}

const MONEY_SCALE = 4;
const PCT_SCALE = 2;
const WEIGHT_SCALE = 4;
const INDEX_SCALE = 6;
const RATE_SCALE = 6;

// ── D-06: the whole-tree aggregate percent (BR-095's super-root) ──────────

/** The aggregate fold's node input — the same shape the W-9 rollup reads. */
export interface AggregateNodeInput {
  readonly id: string;
  readonly parentTaskId: string | null;
  /** numeric(7,4) as a decimal string, or null (the equal-share neutral). */
  readonly weight: string | null;
  /** numeric(5,2) as a decimal string — the task's OWN report. */
  readonly percentComplete: string;
}

/** The aggregate fold's result: the exact sums plus the 2-dp display. */
export interface AggregatePercentResult {
  /** Σ(weight × leaf percent) at the 6-dp scale — EXACT (weight minor4 ×
   * percent minor2). The EV fold consumes THIS, never the rounded
   * display, so the money rounding happens exactly ONCE (at EV). */
  readonly weightedPctSum: string;
  /** Σ(leaf weight) at the 4-dp scale — EXACT. */
  readonly weightSum: string;
  /** The 2-dp display percent (ONE half-up rounding at the display). */
  readonly percent: string;
  /** The leaf count the fold covered. */
  readonly leafCount: number;
}

/**
 * BR-095's super-root corollary: the WHOLE tree as one scope — every
 * leaf contributes (weight ?? 1) × its own report (the NULL weight is
 * the equal-share neutral); a parent's own report NEVER enters the
 * fold; the degenerate all-explicit-zero-weight tree folds as the
 * equal-share mean (never a fabricated 0.00). Returns null when the
 * tree holds no nodes (the caller's honest zero, never a fabricated
 * percent).
 */
export function aggregateWeightedPercent(
  nodes: ReadonlyArray<AggregateNodeInput>,
): AggregatePercentResult | null {
  if (nodes.length === 0) return null;
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentTaskId !== null) {
      const list = childrenOf.get(node.parentTaskId) ?? [];
      list.push(node.id);
      childrenOf.set(node.parentTaskId, list);
    }
  }
  const byId = new Map(nodes.map((node) => [node.id, node] as const));
  const isLeaf = (id: string): boolean => (childrenOf.get(id) ?? []).length === 0;

  interface Fold {
    weightSum: bigint; // scale 4
    weightedPct: bigint; // scale 6
    leafCount: number;
  }
  const memo = new Map<string, Fold>();
  const fold = (id: string): Fold => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id)!;
    let result: Fold;
    if (isLeaf(id)) {
      const weight =
        node.weight === null ? 10n ** BigInt(WEIGHT_SCALE) : toMinor(node.weight, WEIGHT_SCALE, "weight");
      const pct = toMinor(node.percentComplete, PCT_SCALE, "percentComplete");
      result = { weightSum: weight, weightedPct: weight * pct, leafCount: 1 };
    } else {
      let weightSum = 0n;
      let weightedPct = 0n;
      let leafCount = 0;
      for (const childId of childrenOf.get(id) ?? []) {
        const child = fold(childId);
        weightSum += child.weightSum;
        weightedPct += child.weightedPct;
        leafCount += child.leafCount;
      }
      result = { weightSum, weightedPct, leafCount };
    }
    memo.set(id, result);
    return result;
  };

  let weightSum = 0n;
  let weightedPct = 0n;
  let leafCount = 0;
  for (const node of nodes) {
    // Every node's subtree folds identically; summing the ROOTS covers
    // the whole forest exactly once (a leaf root folds itself).
    if (node.parentTaskId === null) {
      const folded = fold(node.id);
      weightSum += folded.weightSum;
      weightedPct += folded.weightedPct;
      leafCount += folded.leafCount;
    }
  }

  if (weightSum === 0n) {
    // Degenerate: every leaf explicitly weight 0 — the equal-share
    // mean over the leaves' OWN reports (the W-9 law, never a
    // fabricated 0.00 "not started").
    const leaves = nodes.filter((node) => isLeaf(node.id));
    const total = leaves.reduce(
      (sum, leaf) => sum + toMinor(leaf.percentComplete, PCT_SCALE, "percentComplete"),
      0n,
    );
    const meanMinor = roundDivHalfUp(total, BigInt(Math.max(leaves.length, 1)), 0);
    return {
      weightedPctSum: "0.000000",
      weightSum: "0.0000",
      percent: fromMinor(meanMinor, PCT_SCALE),
      leafCount: leaves.length,
    };
  }

  // weightedPct is minor-6 and weightSum minor-4: the ratio wps/ws is
  // the PERCENT NUMBER × 100 (10^-6/10^-4 = 10^-2 — the W-9 rollup's
  // own scale note), i.e. it ALREADY sits at the percent's minor-2
  // scale — the divisor is weightSum ALONE. (THE UNIT-FIRST CATCH: the
  // first shape divided by weightSum × 10^2 and rendered 0.56 for the
  // 56.44 world — the W-9 scale-bug class, caught by the pure spec's
  // hand-computed arm before any consumer landed.)
  const percentMinor = roundDivHalfUp(weightedPct, weightSum, 0);
  return {
    weightedPctSum: fromMinor(weightedPct, 6),
    weightSum: fromMinor(weightSum, WEIGHT_SCALE),
    percent: fromMinor(percentMinor, PCT_SCALE),
    leafCount,
  };
}

// ── D-06: the earned-value folds (THE EV CEILING REFUSAL) ─────────────────

/**
 * EV = percent × budget, ONE half-up rounding at the 4-dp money total
 * — the PER-NODE form (the 2-dp percent the rollup reads). REFUSES the
 * typed `EvCeilingExceededError` when the result exceeds the budget
 * (acceptance #4: EV never exceeds the approved budget at the scope it
 * is earned against; the boundary EV = budget is legal).
 *
 * Scale algebra: budget(minor4) × percent(minor2) = minor6; the /100
 * percent factor plus the /10^2 minor-scale factor = the single /10^4
 * divisor landing at minor4 money.
 */
export function earnedValue(budget: string, percent: string): string {
  const budgetMinor = toMinor(budget, MONEY_SCALE, "budget");
  const pctMinor = toMinor(percent, PCT_SCALE, "percent");
  const evMinor = roundDivHalfUp(budgetMinor * pctMinor, 10n ** 4n, 0);
  if (evMinor > budgetMinor) {
    throw new EvCeilingExceededError(
      `EV ${fromMinor(evMinor, MONEY_SCALE)} exceeds the budget ${budget} it is earned against — the earned value never exceeds the approved budget at its scope (the boundary EV = budget is legal)`,
      { ev: fromMinor(evMinor, MONEY_SCALE), budget, percent },
    );
  }
  return fromMinor(evMinor, MONEY_SCALE);
}

/**
 * The STRUCTURAL project EV from the aggregate fold — the EXACT rational
 * (weightedPctSum/weightSum), never the rounded 2-dp display, so the
 * money rounding happens exactly ONCE (at EV). The same typed ceiling
 * refusal.
 *
 * Scale algebra: ev = budget × (wps/ws)/100 in units;
 * ev_minor4 = budget_minor4 × wps_minor6 / (ws_minor4 × 10^4).
 */
export function earnedValueFromAggregate(
  budget: string,
  aggregate: AggregatePercentResult,
): string {
  const budgetMinor = toMinor(budget, MONEY_SCALE, "budget");
  const wpsMinor = toMinor(aggregate.weightedPctSum, 6, "weightedPctSum");
  const wsMinor = toMinor(aggregate.weightSum, WEIGHT_SCALE, "weightSum");
  if (wsMinor === 0n) {
    // The degenerate equal-share aggregate carries no exact ratio —
    // fall back to the display percent (its fold already rounded once).
    return earnedValue(budget, aggregate.percent);
  }
  const evMinor = roundDivHalfUp(budgetMinor * wpsMinor, wsMinor * 10n ** 4n, 0);
  if (evMinor > budgetMinor) {
    throw new EvCeilingExceededError(
      `EV ${fromMinor(evMinor, MONEY_SCALE)} exceeds the budget ${budget} it is earned against — the earned value never exceeds the approved budget at its scope (the boundary EV = budget is legal)`,
      { ev: fromMinor(evMinor, MONEY_SCALE), budget, percent: aggregate.percent },
    );
  }
  return fromMinor(evMinor, MONEY_SCALE);
}

// ── D-06: the performance indices + the forecast ──────────────────────────

/**
 * CPI = EV / AC at the 6-dp index scale — NULL when AC = 0 (an honest
 * absence; EV = 0 with AC > 0 is the honest 0.000000, never null).
 */
export function costPerformanceIndex(ev: string, ac: string): string | null {
  const evMinor = toMinor(ev, MONEY_SCALE, "ev");
  const acMinor = toMinor(ac, MONEY_SCALE, "ac");
  if (acMinor === 0n) return null;
  return fromMinor(roundDivHalfUp(evMinor, acMinor, INDEX_SCALE), INDEX_SCALE);
}

/** SPI = EV / PV at the 6-dp index scale — NULL when PV = 0. */
export function schedulePerformanceIndex(ev: string, pv: string): string | null {
  const evMinor = toMinor(ev, MONEY_SCALE, "ev");
  const pvMinor = toMinor(pv, MONEY_SCALE, "pv");
  if (pvMinor === 0n) return null;
  return fromMinor(roundDivHalfUp(evMinor, pvMinor, INDEX_SCALE), INDEX_SCALE);
}

/** The forecast result — ETC/EAC plus the method disclosure. */
export interface ForecastResult {
  /** Estimate to complete: (BAC − EV)/CPI when a positive CPI exists
   * (computed EXACTLY as (BAC − EV) × AC / EV), else BAC − EV. */
  readonly etc: string;
  /** Estimate at completion: AC + ETC. */
  readonly eac: string;
  /** The documented method: CPI_BASED or the REMAINDER fallback. */
  readonly method: "CPI_BASED" | "REMAINDER";
}

/**
 * The forecast at completion (D-06's documented fallback law): while EV
 * and AC are both positive, ETC = (BAC − EV) × AC / EV (the exact form
 * of (BAC − EV)/CPI — never through the rounded index) and EAC =
 * AC + ETC; when EV = 0 or AC = 0 (CPI absent or zero) the REMAINDER
 * fallback prices the remaining work at budget cost (ETC = BAC − EV).
 * Refuses when EV > BAC (the same ceiling law — defensive; the EV folds
 * already enforce it upstream).
 */
export function forecastAtCompletion(bac: string, ev: string, ac: string): ForecastResult {
  const bacMinor = toMinor(bac, MONEY_SCALE, "bac");
  const evMinor = toMinor(ev, MONEY_SCALE, "ev");
  const acMinor = toMinor(ac, MONEY_SCALE, "ac");
  if (evMinor > bacMinor) {
    throw new EvCeilingExceededError(
      `the forecast refused: EV ${ev} exceeds BAC ${bac} — the earned value never exceeds the budget at its scope`,
      { ev, budget: bac, percent: null as unknown as string },
    );
  }
  const remainder = bacMinor - evMinor;
  if (evMinor > 0n && acMinor > 0n) {
    const etcMinor = roundDivHalfUp(remainder * acMinor, evMinor, 0);
    return {
      etc: fromMinor(etcMinor, MONEY_SCALE),
      eac: fromMinor(acMinor + etcMinor, MONEY_SCALE),
      method: "CPI_BASED",
    };
  }
  return {
    etc: fromMinor(remainder, MONEY_SCALE),
    eac: fromMinor(acMinor + remainder, MONEY_SCALE),
    method: "REMAINDER",
  };
}

// ── D-11: the IAS-23 folds ────────────────────────────────────────────────

/** The qualifying window (the WBS schedule's span). */
export interface Ias23Window {
  readonly start: string;
  readonly end: string;
}

/**
 * THE QUALIFYING WINDOW (D-11): the min scheduled start / max scheduled
 * end over the WBS tasks that carry BOTH dates — the construction
 * window the capitalization runs on. Tasks without dates are excluded
 * (the honest shape); no scheduled task at all = null (the caller's
 * typed refusal — never a fabricated window).
 */
export function ias23Window(
  tasks: ReadonlyArray<{ startDate: string | null; endDate: string | null }>,
): Ias23Window | null {
  let start: string | null = null;
  let end: string | null = null;
  for (const task of tasks) {
    if (task.startDate === null || task.endDate === null) continue;
    if (start === null || task.startDate < start) start = task.startDate;
    if (end === null || task.endDate > end) end = task.endDate;
  }
  if (start === null || end === null) return null;
  return { start, end };
}

/** The exact UTC-midnight milliseconds of an ISO date (validated). */
function isoMs(iso: string, what: string): number {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`${what}: invalid ISO date ${iso}`);
  return ms;
}

/** The whole-day count between two UTC midnights (integrality-guarded —
 * UTC has no DST so the division is exact; ADR-0009's no-float law). */
function utcDaysBetween(aMs: number, bMs: number): number {
  const diff = bMs - aMs;
  const days = diff / 86_400_000;
  if (!Number.isInteger(days)) throw new Error(`non-integral day difference: ${diff}ms`);
  return days;
}

/** One budget line's IAS-23 split against the qualifying window. */
export interface Ias23SplitResult {
  /** The line's qualifying slice: [max(periodStart, windowStart),
   * min(periodEnd, windowEnd)] — the row's own window. */
  readonly sliceStart: string;
  readonly sliceEnd: string;
  /** The whole line's accrual through asOf (the W-9 fold, ONE rounding). */
  readonly expenditures: string;
  /** The accrual inside the qualifying slice through asOf (ONE rounding). */
  readonly eligible: string;
  /** expenditures − eligible — the exact residual (the stop rules' bite). */
  readonly ineligible: string;
  /** eligible × rate (ONE rounding at 4-dp money). */
  readonly capitalized: string;
  /** ineligible × rate (ONE rounding at 4-dp money). */
  readonly expensed: string;
}

/**
 * THE IAS-23 SPLIT (D-11) — one budget line folded against the
 * qualifying window with the DOCUMENTED STOP RULES (the header's three
 * laws). The eligible portion is the line's own uniform daily spread
 * over the sub-window [max(periodStart, windowStart), min(periodEnd,
 * windowEnd, asOf)] — ONE half-up rounding at the 4-dp money value;
 * the expenditures base is the whole line's accrual through asOf (the
 * W-9 `accruedThrough`); the ineligible residual is their exact
 * difference; capitalized = eligible × rate and expensed = ineligible ×
 * rate with ONE rounding each. `rate` is the FRACTION at the 6-dp
 * scale ("0.050000" = 5%). Returns null when the line's period does
 * not overlap the qualifying window (out of scope — the caller lists
 * it honestly, never a fabricated zero row).
 */
export function ias23Split(
  cell: CurveCell,
  window: Ias23Window,
  rate: string,
  asOf: string,
): Ias23SplitResult | null {
  const sliceStart = cell.periodStart > window.start ? cell.periodStart : window.start;
  const sliceEnd = cell.periodEnd < window.end ? cell.periodEnd : window.end;
  if (sliceStart > sliceEnd) return null; // no overlap with the qualifying window

  const rateMinor = toMinor(rate, RATE_SCALE, "rate");
  if (rateMinor < 0n || rateMinor > 10n ** BigInt(RATE_SCALE)) {
    throw new Error(`ias23Split: rate must be a fraction in [0,1]: ${rate}`);
  }

  // The expenditures base — the whole line through asOf (the W-9 fold).
  const expenditures = accruedThrough([cell], asOf);

  // The eligible fold — the line's own spread over the sub-window
  // [sliceStart, min(sliceEnd, asOf)] (the start + completion + elapsed
  // stop rules all land here: before the slice 0, past it the slice's
  // prorated amount, never the full line unless the slice IS the line).
  const effEnd = asOf < sliceEnd ? asOf : sliceEnd;
  const amountMinor = toMinor(cell.plannedAmount, MONEY_SCALE, "plannedAmount");
  let eligibleMinor = 0n;
  if (effEnd >= sliceStart) {
    const totalDays = utcDaysBetween(isoMs(cell.periodStart, "periodStart"), isoMs(cell.periodEnd, "periodEnd")) + 1;
    const elapsedDays = utcDaysBetween(isoMs(sliceStart, "sliceStart"), isoMs(effEnd, "effEnd")) + 1;
    eligibleMinor = roundDivHalfUp(amountMinor * BigInt(elapsedDays), BigInt(totalDays), 0);
  }
  const expendituresMinor = toMinor(expenditures, MONEY_SCALE, "expenditures");
  const ineligibleMinor = expendituresMinor - eligibleMinor; // exact at 4 dp

  // The split — ONE rounding each; capitalized ≤ eligible and expensed ≤
  // ineligible by monotone half-up rounding (rate ≤ 1), so the 0103
  // CHECK's law (capitalized + expensed ≤ expenditures) holds by
  // construction.
  const capitalizedMinor = roundDivHalfUp(eligibleMinor * rateMinor, 10n ** BigInt(RATE_SCALE), 0);
  const expensedMinor = roundDivHalfUp(ineligibleMinor * rateMinor, 10n ** BigInt(RATE_SCALE), 0);

  return {
    sliceStart,
    sliceEnd,
    expenditures: fromMinor(expendituresMinor, MONEY_SCALE),
    eligible: fromMinor(eligibleMinor, MONEY_SCALE),
    ineligible: fromMinor(ineligibleMinor, MONEY_SCALE),
    capitalized: fromMinor(capitalizedMinor, MONEY_SCALE),
    expensed: fromMinor(expensedMinor, MONEY_SCALE),
  };
}

/**
 * The rate-register boundary conversion: the settings register's
 * z.number rate (the W-8 planted shape) to the EXACT 6-dp fraction
 * string the folds consume — the single float boundary, documented
 * (everything downstream is exact scaled-integer arithmetic).
 * Returns null when the value is not a finite number in [0,1] (the
 * caller's REQUIRES_VERIFICATION refusal).
 */
export function rateToExactString(rate: number): string | null {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    return null;
  }
  return rate.toFixed(6);
}
