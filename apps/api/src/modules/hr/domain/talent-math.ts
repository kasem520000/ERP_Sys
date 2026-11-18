/**
 * PHASE-047 (W-2 — HR Growth: Talent & Performance) — the PURE engine
 * math (T-05 + T-06), the D-08 law: the 360 aggregation, BR-089's
 * weight-sum validation, the KRI progress rollup + triage, and D-09's
 * cycle guard are PURE domain functions — no clock, no store, no I/O
 * (the attendance-classification and 046 statutory-math precedents) —
 * unit-tested FIRST; the services fold them over the stores' rows and
 * throw the typed refusals (talent-errors.ts). All percent/weight math
 * is EXACT SCALED-INTEGER math (BigInt minor units at the 2-dp scale —
 * ADR-0009's no-float discipline extended to the talent plane's
 * percent fields; a review score is not money, but a 65.00% rollup
 * computed in binary float would still be a fabrication).
 *
 * THE LAWS PINNED HERE:
 *
 * - BR-090 (the 360 anonymity law): a relationship's inputs surface
 *   ONLY in aggregate, and ONLY at ≥ 3 SUBMITTED responses — never an
 *   attributed source. `aggregate360` computes the per-relationship
 *   {count, mean, min, max}; `visible360` is the ≥ 3 filter. The mean
 *   carries ONE half-up rounding point at 2 dp (the INV-032 exactness
 *   discipline — never a per-source rounding, never an absorbed
 *   residual). The threshold is the phase doc's own documented value
 *   (3), parameterized only for the spec's pinning.
 *
 * - BR-089 (the goal weight-sum law): a reviewee's ACTIVE goal weights
 *   inside a cycle sum to EXACTLY 100% — `goalWeightSum` is the exact
 *   fold and `weightsExactly100` the predicate ("100", "100.0", and
 *   "100.00" are the same number; exactness is string-scale-insensi-
 *   tive by construction). The fail-closed typed refusal
 *   (GoalWeightsInvalidError) is thrown by the SERVICE at the moment
 *   the goals become a review's input — never here.
 *
 * - THE KRI ROLLUP: `rollupGoalProgress` is the weighted progress
 *   Σ(weight/100 × progress) with a NULL progress reading as 0.00 —
 *   ONE half-up rounding point at the TOTAL (never per goal: three
 *   33.33% goals each rounding would fabricate a residue the exact
 *   fold provably does not have).
 *
 * - THE KRI TRIAGE: `triageKriProgress` derives the goal's status from
 *   its progress against the expected pace — ≥ 100 → ACHIEVED, below
 *   pace → AT_RISK, otherwise ACTIVE. `expectedPctThrough` computes
 *   the pace from the cycle window (rounded to the integer percent,
 *   clamped [0, 100]; a degenerate window is 100 — everything is
 *   behind). The clock NEVER enters the pure layer: the service passes
 *   `todayMs`.
 *
 * - D-09 (the cycle-safe move law): `wouldCreateCycle` walks the
 *   parent chain from the PROPOSED parent upward — reaching the moved
 *   node means the move would close a loop. The org-units/positions
 *   writers (W-3) ride the SAME function.
 */

/** The 360 source relationships (BR-090's kinds — MANAGER is the
 * review proper, never a 360 input). */
export type FeedbackKind = "SELF" | "PEER" | "SUBORDINATE";

export const FEEDBACK_KINDS: readonly FeedbackKind[] = ["SELF", "PEER", "SUBORDINATE"];

/** BR-090's documented threshold: a relationship's inputs surface only
 * at ≥ 3 responses (the phase doc's own value — parameterized in the
 * pure functions solely so the spec can pin the boundary at 2/3). */
export const MIN_360_RESPONSES = 3;

// ── the exact 2-dp scaled-integer core (BigInt minor units) ────────────────

const SCALE_2 = 100n;

/** Parse a canonical 2-dp decimal string ("87.50") to minor units.
 * Accepts 0–2 decimal digits ("87", "87.5") — the canonical forms the
 * API and the numeric(5,2) column render. Anything else is a caller
 * bug (the service validates the shape BEFORE folding; the pure layer
 * never fabricates). */
function toMinor2(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole = "0", frac = ""] = value.replace("-", "").split(".");
  const minor = BigInt(whole) * SCALE_2 + BigInt(frac.slice(0, 2).padEnd(2, "0"));
  return negative ? -minor : minor;
}

/** Render minor units as the canonical 2-dp string. */
function fromMinor2(minor: bigint): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  return `${negative ? "-" : ""}${abs / SCALE_2}.${(abs % SCALE_2).toString().padStart(2, "0")}`;
}

// ── BR-090: the 360 aggregation ────────────────────────────────────────────

/** One submitted 360 input's aggregate contribution — the reviewer's
 * own row never enters (MANAGER is not a 360 kind). */
export interface FeedbackInput {
  readonly kind: FeedbackKind;
  /** The input's overall score, 0–100, 2-dp canonical string. */
  readonly overallScore: string;
}

/** The per-relationship aggregate — the ONLY shape in which 360 inputs
 * ever leave the service boundary (BR-090: count + stats, never an
 * attributed source). */
export interface RelationshipAggregate {
  readonly kind: FeedbackKind;
  readonly count: number;
  /** The half-up 2-dp mean — ONE rounding point. */
  readonly mean: string;
  readonly min: string;
  readonly max: string;
}

export type Aggregate360Result = Readonly<Record<FeedbackKind, RelationshipAggregate | null>>;

/** Fold the submitted 360 inputs into the per-relationship aggregates
 * — pure, order-independent (a ∃-quantified min/max and a commutative
 * sum: the rows' physical order cannot change the answer). */
export function aggregate360(inputs: ReadonlyArray<FeedbackInput>): Aggregate360Result {
  const acc: Record<FeedbackKind, { count: number; sum: bigint; min: bigint; max: bigint } | null> =
    { SELF: null, PEER: null, SUBORDINATE: null };
  for (const input of inputs) {
    const minor = toMinor2(input.overallScore);
    const cell = acc[input.kind] ?? { count: 0, sum: 0n, min: minor, max: minor };
    cell.count += 1;
    cell.sum += minor;
    if (minor < cell.min) cell.min = minor;
    if (minor > cell.max) cell.max = minor;
    acc[input.kind] = cell;
  }
  const result: Record<FeedbackKind, RelationshipAggregate | null> = {
    SELF: null,
    PEER: null,
    SUBORDINATE: null,
  };
  for (const kind of FEEDBACK_KINDS) {
    const cell = acc[kind];
    if (cell === null) continue;
    result[kind] = {
      kind,
      count: cell.count,
      // sum/count, half-up at the 2-dp minor scale — the classic
      // (2a + b) / (2b) integer form of round-half-up(a / b).
      mean: fromMinor2((cell.sum * 2n + BigInt(cell.count)) / (BigInt(cell.count) * 2n)),
      min: fromMinor2(cell.min),
      max: fromMinor2(cell.max),
    };
  }
  return result;
}

/** BR-090's filter: only relationships at ≥ `minResponses` SUBMITTED
 * responses surface — the below-threshold kinds render null (hidden,
 * never "count: 2" — a count below the threshold is itself an
 * attribution surface). */
export function visible360(
  aggregates: Aggregate360Result,
  minResponses: number = MIN_360_RESPONSES,
): Aggregate360Result {
  const out: Record<FeedbackKind, RelationshipAggregate | null> = {
    SELF: null,
    PEER: null,
    SUBORDINATE: null,
  };
  for (const kind of FEEDBACK_KINDS) {
    const agg = aggregates[kind];
    out[kind] = agg !== null && agg.count >= minResponses ? agg : null;
  }
  return out;
}

// ── BR-089: the goal weight-sum law ────────────────────────────────────────

/** The exact fold of the ACTIVE goal weights (2-dp canonical strings).
 * Zero goals fold to "0.00". */
export function goalWeightSum(weights: readonly string[]): string {
  let sum = 0n;
  for (const weight of weights) sum += toMinor2(weight);
  return fromMinor2(sum);
}

/** The BR-089 predicate: the sum is EXACTLY 100% (scale-insensitive —
 * "100", "100.0", "100.00" are the same number; 99.99 and 100.01 are
 * both refusals, zero tolerance by the phase doc's own word
 * "exactly"). */
export function weightsExactly100(sum: string): boolean {
  return toMinor2(sum) === 10_000n;
}

// ── the KRI rollup ─────────────────────────────────────────────────────────

/** One active goal's rollup contribution. A NULL progress reads as
 * 0.00 (the honest unstarted state — documented, never an invented
 * mid-point). */
export interface GoalProgressInput {
  readonly weight: string;
  readonly progressPct: string | null;
}

/** The weighted progress rollup Σ(weight/100 × progress) with ONE
 * half-up rounding point at the TOTAL. Precondition: the caller has
 * enforced BR-089 (the weights sum to exactly 100) — the rollup itself
 * is total and computes over whatever it is given.
 *
 * The scale algebra: weight_minor and progress_minor are each at 1e2,
 * so a product is at 1e4; the total lives at 1e4 and the single
 * half-up division by 1e2 lands at the 1e2 minor scale — one rounding,
 * at the total, never per goal. */
export function rollupGoalProgress(goals: ReadonlyArray<GoalProgressInput>): string {
  let totalAt1e4 = 0n;
  for (const goal of goals) {
    const weightMinor = toMinor2(goal.weight);
    const progressMinor = toMinor2(goal.progressPct ?? "0.00");
    totalAt1e4 += weightMinor * progressMinor;
  }
  // The single half-up rounding point: (x + 5,000) / 10,000 lands the
  // 1e4 product scale on the 1e2 minor scale.
  return fromMinor2((totalAt1e4 + 5_000n) / 10_000n);
}

// ── the KRI triage ─────────────────────────────────────────────────────────

/** The expected-pace window in epoch ms (the cycle period, or the
 * goal's own due-date window when one is set). */
export interface PaceWindow {
  readonly startMs: number;
  readonly endMs: number;
  readonly todayMs: number;
}

/** The expected progress percent through the window — rounded to the
 * integer percent, clamped [0, 100]. A degenerate window (end ≤
 * start, or the window already fully elapsed) is 100: the triage
 * reads "everything is due" (fail-strict, never a fabricated grace). */
export function expectedPctThrough(window: PaceWindow): number {
  if (window.endMs <= window.startMs || window.todayMs >= window.endMs) return 100;
  if (window.todayMs <= window.startMs) return 0;
  const elapsed = BigInt(window.todayMs - window.startMs);
  const duration = BigInt(window.endMs - window.startMs);
  // elapsed/duration × 100, half-up at the integer percent.
  return Number((elapsed * 100n * 2n + duration) / (duration * 2n));
}

/** The goal status a KRI progress reading triages into. CANCELLED is
 * not a triage verdict — it is the terminal human decision and is
 * refused upstream before the triage ever runs. */
export type KriTriageVerdict = "ACHIEVED" | "AT_RISK" | "ACTIVE";

/** ≥ 100 → ACHIEVED; below the expected pace → AT_RISK; otherwise
 * ACTIVE. Pure: the expected percent is computed by the caller
 * (`expectedPctThrough` — an INTEGER percent by construction) and
 * passed in; a non-integer would fail loud at the BigInt conversion
 * (never a silent float fold — ADR-0009's law). */
export function triageKriProgress(progressPct: string, expectedPct: number): KriTriageVerdict {
  if (toMinor2(progressPct) >= 10_000n) return "ACHIEVED";
  if (toMinor2(progressPct) < BigInt(expectedPct) * SCALE_2) return "AT_RISK";
  return "ACTIVE";
}

// ── D-09: the cycle-safe move guard ────────────────────────────────────────

/** The parent edges the guard walks (id → parentId; null = root). */
export interface ParentEdge {
  readonly id: string;
  readonly parentId: string | null;
}

/** Would moving `id` under `newParentId` close a loop? Walks UP from
 * the proposed parent through the edge map — reaching `id` means the
 * move would create a cycle (refuse before any write, D-09's law). A
 * null parent (move to root) can never close a loop; the walk ending
 * at a root or off the known set is safe (the FK guarantees the
 * parent exists — an unknown id in the chain is a caller bug, never a
 * silent cycle). The walk is bounded: every distinct node is visited
 * at most once, so a pre-existing loop in the data refuses (never
 * spins). */
export function wouldCreateCycle(
  edges: ReadonlyArray<ParentEdge>,
  id: string,
  newParentId: string | null,
): boolean {
  if (newParentId === null) return false;
  if (newParentId === id) return true;
  const byId = new Map(edges.map((edge) => [edge.id, edge.parentId]));
  let cursor: string | null = newParentId;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === id) return true;
    // The bounded-walk floor: a node seen twice means the chain
    // already loops — refuse (never spin). NOTE the shape:
    // `seen.add` returns the SET (always truthy), so the "newly
    // added" test is `has` BEFORE the add — the naive
    // `!seen.add(cursor)` is always false and the walk never
    // terminates (the unit spec's (c) arm caught exactly this).
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor) ?? null;
  }
  return false;
}
