/**
 * PHASE-048 (W-9 — Projects & Contracting: the WBS + budgets + actuals
 * engines) — the PURE engine math (T-05 + T-06 + T-07), the D-03/D-04/
 * D-05 laws: the dependency-cycle detector, the parent-cycle guard, the
 * weighted %-complete rollup fold (BR-095), the budget cost-curve
 * interpolation, and the overhead distributor fold are PURE domain
 * functions — no clock, no store, no I/O (the 047 talent-math and
 * attendance-classification precedents) — unit-tested FIRST (the plan
 * §4's unit-first law); the services fold them over the stores' rows and
 * throw the typed refusals (projects-errors.ts). All money/weight/percent
 * math is EXACT SCALED-INTEGER arithmetic (BigInt minor units —
 * ADR-0009's no-float discipline; a 65.00% rollup or a 12,345.6789 money
 * fold computed in binary float would be a fabrication).
 *
 * THE LAWS PINNED HERE:
 *
 * - D-03 (the dependency cycle law): `detectDependencyCycle` walks the
 *   single-predecessor chain from the proposed edge's task upward — the
 *   0100 edge set is a functional graph (each task carries at most ONE
 *   predecessor), so the walk is a single path; revisiting any node (or
 *   reaching the proposed successor) closes a loop and the CYCLE PATH is
 *   returned for the typed refusal's message. `wouldCreateParentCycle`
 *   is the 047 D-09 org-tree guard verbatim (the `has`-before-`add`
 *   termination fix pinned by the 047 unit spec's honest finding).
 *
 * - BR-095 (the weighted rollup law): `rollupWeightedPercent` recomputes
 *   every node's effective percent FROM THE LEAVES of its subtree — a
 *   leaf contributes (weight ?? 1) × its own percent_complete (the NULL
 *   weight is the equal-share neutral element, a documented reading —
 *   never a fabricated business constant); a parent's stored own-report
 *   NEVER enters the fold (D-03: the aggregate is recomputed on every
 *   read, never a stored stale sum). The fold carries ONE half-up
 *   rounding point at the TOTAL (never per leaf: three 33.33% leaves
 *   each rounding would fabricate a residue the exact fold provably
 *   does not have — the BR-089/047 discipline). The degenerate
 *   all-explicit-zero-weight subtree folds as the equal-share mean (a
 *   zero-weight subtree is an unweighted summary, never a fabricated
 *   "not started" 0.00).
 *
 * - D-04 (the cost-curve interpolation law): `accruedThrough` spreads
 *   each budget cell uniformly over its inclusive [period_start,
 *   period_end] day window — before the window 0, past it the full
 *   amount, inside it amount × elapsedDays / windowDays with the
 *   end-of-day convention (the first day accrues 1/windowDays). The
 *   multi-bucket sum is EXACT: per-bucket fractions share the LCM
 *   denominator (BigInt), and the ONE half-up rounding happens at the
 *   4-dp money total — never per bucket.
 *
 * - D-05 (the overhead distributor fold): `allocateOverhead` distributes
 *   the pool over the driver shares exactly — allocated_i = pool ×
 *   share_i / Σshares, ONE half-up rounding at the 4-dp money value per
 *   project (each project's allocation is a posted money amount; the
 *   posting and the collector read the SAME fold, so INV-033 reconciles
 *   by construction). A zero pool or an all-zero driver set allocates
 *   honest zeros — never a fabricated spread.
 *
 * The clock NEVER enters the pure layer: the services pass `todayIso` /
 * `asOf` strings.
 */

// ── the exact scaled-integer core (BigInt minor units) ────────────────────

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

/** Half-up rounding of a rational numerator/denominator to minor units
 * at the given scale (a tie rounds UP — ADR-0009's convention). */
function roundDivHalfUp(numerator: bigint, denominator: bigint, scale: number): bigint {
  if (denominator === 0n) throw new Error("roundDivHalfUp: zero denominator");
  const pow = 10n ** BigInt(scale);
  const scaled = numerator * pow;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const bump = remainder * 2n >= denominator ? 1n : 0n;
  return quotient + bump;
}

// ── D-03: the dependency-cycle detector (the 0100 edge set) ───────────────

/** One dependency edge: `taskId` carries `predecessorId` as its single
 * predecessor (0100's single-predecessor law — the multi-edge graph
 * composes through intermediate tasks). */
export interface DependencyEdge {
  readonly taskId: string;
  readonly predecessorId: string;
}

/**
 * Walk the predecessor chain from the PROPOSED edge's task upward. The
 * 0100 edge set is a functional graph (each task has ≤ 1 predecessor),
 * so the walk is a single path; a loop closes when the path revisits a
 * node (pre-existing corrupted data) or reaches the proposed successor
 * (the new edge would close the loop). Returns the CYCLE PATH (the
 * ordered node ids, the closing edge's successor first) when a cycle is
 * reachable, else null.
 */
export function detectDependencyCycle(
  edges: ReadonlyArray<DependencyEdge>,
  addition?: DependencyEdge,
): string[] | null {
  const predecessorOf = new Map<string, string>();
  for (const edge of edges) {
    predecessorOf.set(edge.taskId, edge.predecessorId);
  }
  if (addition !== undefined) {
    predecessorOf.set(addition.taskId, addition.predecessorId);
  }
  const successor = addition?.taskId;
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = addition?.predecessorId;
  while (cursor !== undefined) {
    if (successor !== undefined && cursor === successor) {
      return [...path, cursor]; // the walk reached the moved node — loop closed
    }
    if (seen.has(cursor)) {
      return [...path, cursor]; // a pre-existing loop in the stored set
    }
    seen.add(cursor);
    path.push(cursor);
    cursor = predecessorOf.get(cursor);
  }
  return null;
}

/**
 * The parent-chain move guard (the 047 D-09 org-tree precedent verbatim,
 * its `has`-before-`add` termination fix included): would re-parenting
 * `taskId` under `proposedParentId` close a loop in the parent forest?
 */
export function wouldCreateParentCycle(
  taskId: string,
  proposedParentId: string,
  parentOf: ReadonlyMap<string, string | null>,
): boolean {
  let cursor: string | null = proposedParentId;
  const seen = new Set<string>();
  while (cursor !== null && cursor !== undefined) {
    if (cursor === taskId) return true;
    if (seen.has(cursor)) return true; // corrupted chain — refuse the move
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

// ── BR-095: the weighted %-complete rollup fold ───────────────────────────

/** The fold's node input — the flat task row the service reads. */
export interface RollupNodeInput {
  readonly id: string;
  readonly parentTaskId: string | null;
  /** numeric(7,4) as a decimal string, or null (the equal-share neutral). */
  readonly weight: string | null;
  /** numeric(5,2) as a decimal string — the task's OWN report. */
  readonly percentComplete: string;
}

/** One node's rollup result. */
export interface RollupNodeResult {
  readonly id: string;
  /** The leaf-recomputed weighted percent (2-dp string) — BR-095. */
  readonly rolledPercent: string;
  /** The subtree's leaf count (a leaf counts itself). */
  readonly leafCount: number;
  /** The subtree's effective weight sum at the 4-dp scale (minor units). */
  readonly weightSum: string;
}

const PCT_SCALE = 2;
const WEIGHT_SCALE = 4;

/**
 * The weighted rollup recomputed FROM THE LEAVES for every node at once
 * (BR-095 / D-03): a leaf's effective percent is its own report; a
 * parent's is Σ(leaf weight × leaf percent) / Σ(leaf weight) over its
 * subtree's leaves with ONE half-up rounding at the total. The weight
 * NULL reads as the equal-share neutral 1; the degenerate all-zero
 * weight subtree folds as the equal-share mean. Node-by-node
 * reconcilable by construction: every node's fold reads exactly its own
 * subtree's leaves.
 */
export function rollupWeightedPercent(
  nodes: ReadonlyArray<RollupNodeInput>,
): Map<string, RollupNodeResult> {
  const byId = new Map<string, RollupNodeInput>();
  const childrenOf = new Map<string, string[]>();
  const rootIds: string[] = [];
  for (const node of nodes) {
    byId.set(node.id, node);
  }
  for (const node of nodes) {
    if (node.parentTaskId !== null) {
      const list = childrenOf.get(node.parentTaskId) ?? [];
      list.push(node.id);
      childrenOf.set(node.parentTaskId, list);
    } else {
      rootIds.push(node.id);
    }
  }
  // A node is a LEAF when no other node names it as a parent.
  const isLeaf = (id: string): boolean => (childrenOf.get(id) ?? []).length === 0;

  interface Fold {
    weightSum: bigint; // scale 4
    weightedPct: bigint; // scale 6 (weight minor4 × pct minor2)
    leafCount: number;
  }
  const memo = new Map<string, Fold>();
  const fold = (id: string): Fold => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id)!;
    let result: Fold;
    if (isLeaf(id)) {
      const weight = node.weight === null ? 10n ** BigInt(WEIGHT_SCALE) : toMinor(node.weight, WEIGHT_SCALE, "weight");
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

  const results = new Map<string, RollupNodeResult>();
  for (const node of nodes) {
    const folded = fold(node.id);
    let rolledMinor: bigint;
    if (folded.weightSum === 0n) {
      // Degenerate: every leaf explicitly weight 0 — the equal-share
      // mean (documented reading; never a fabricated 0.00 "not started").
      const leaves = leafPercentMinors(node.id);
      const total = leaves.reduce((sum, pct) => sum + pct, 0n);
      rolledMinor =
        leaves.length === 0
          ? toMinor(node.percentComplete, PCT_SCALE, "percentComplete")
          : roundDivHalfUp(total, BigInt(leaves.length), 0);
    } else {
      // weightedPct is minor-6, weightSum is minor-4: the ratio lands at
      // the percent's own minor-2 scale with NO extra scaling
      // (10^-6 / 10^-4 × 10^2 = 1).
      rolledMinor = roundDivHalfUp(folded.weightedPct, folded.weightSum, 0);
    }
    results.set(node.id, {
      id: node.id,
      rolledPercent: fromMinor(rolledMinor, PCT_SCALE),
      leafCount: folded.leafCount,
      weightSum: fromMinor(folded.weightSum, WEIGHT_SCALE),
    });
  }
  return results;

  /** The subtree's leaf OWN percent minors (the degenerate arm). */
  function leafPercentMinors(id: string): bigint[] {
    if (isLeaf(id)) {
      const node = byId.get(id)!;
      return [toMinor(node.percentComplete, PCT_SCALE, "percentComplete")];
    }
    const out: bigint[] = [];
    for (const childId of childrenOf.get(id) ?? []) {
      out.push(...leafPercentMinors(childId));
    }
    return out;
  }
}

// ── D-04: the budget cost-curve interpolation ─────────────────────────────

/** One curve cell — a budget line's (window, amount) projection. */
export interface CurveCell {
  readonly periodStart: string;
  readonly periodEnd: string;
  /** numeric(19,4) as a decimal string (≥ 0). */
  readonly plannedAmount: string;
}

/** Days between two ISO dates (inclusive: end − start + 1). The UTC
 * midnight milliseconds divide exactly by 86,400,000 (no DST in UTC),
 * so the division is an EXACT integer — never a float rounding
 * (ADR-0009's lint law; the integrality assertion guards the caller). */
export function inclusiveDays(startIso: string, endIso: string): number {
  const start = Date.parse(`${startIso}T00:00:00Z`);
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    throw new Error(`invalid window: ${startIso}..${endIso}`);
  }
  return exactUtcDays(start, end) + 1;
}

/** The exact whole-day count between two UTC-midnight instants (the
 * shared helper — throws on a non-integral difference, a caller bug). */
function exactUtcDays(startMs: number, endMs: number): number {
  const diff = endMs - startMs;
  const days = diff / 86_400_000;
  if (!Number.isInteger(days)) {
    throw new Error(`non-integral day difference: ${diff}ms`);
  }
  return days;
}

/**
 * The cost curve's point-in-time accrual (D-04 — the PV interpolation):
 * each cell spreads uniformly over its inclusive day window; the sum is
 * EXACT (per-cell fractions share the LCM denominator in BigInt) with
 * ONE half-up rounding at the 4-dp money total — never per cell. `asOf`
 * before a window accrues 0; past it the full amount.
 */
export function accruedThrough(cells: ReadonlyArray<CurveCell>, asOf: string): string {
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(asOfMs)) {
    throw new Error(`invalid asOf date: ${asOf}`);
  }
  const MONEY_SCALE = 4;
  const denominators: bigint[] = [];
  const prepared: Array<{ numerator: bigint; denominator: bigint }> = [];
  for (const cell of cells) {
    const startMs = Date.parse(`${cell.periodStart}T00:00:00Z`);
    const endMs = Date.parse(`${cell.periodEnd}T00:00:00Z`);
    const amount = toMinor(cell.plannedAmount, MONEY_SCALE, "plannedAmount");
    if (asOfMs < startMs) {
      prepared.push({ numerator: 0n, denominator: 1n });
      continue;
    }
    const totalDays = exactUtcDays(startMs, endMs) + 1;
    if (asOfMs >= endMs) {
      prepared.push({ numerator: amount, denominator: 1n });
      continue;
    }
    const elapsed = exactUtcDays(startMs, asOfMs) + 1;
    prepared.push({ numerator: amount * BigInt(elapsed), denominator: BigInt(totalDays) });
    denominators.push(BigInt(totalDays));
  }
  // The exact sum over the common (LCM) denominator — the numerators
  // are ALREADY in minor-4 money units, so the rounding scale is 0.
  const common = denominators.reduce((lcm, value) => (lcm * value) / gcd(lcm, value), 1n);
  let numerator = 0n;
  for (const { numerator: num, denominator: den } of prepared) {
    numerator += (num * common) / den;
  }
  return fromMinor(roundDivHalfUp(numerator, common, 0), MONEY_SCALE);
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0n ? 1n : x;
}

// ── D-05: the overhead distributor fold ───────────────────────────────────

/** One project's driver reading (labor hours or direct cost, 4-dp). */
export interface OverheadDriverShare {
  readonly projectId: string;
  readonly driverValue: string;
}

/** One project's allocation result. */
export interface OverheadAllocationResult {
  readonly projectId: string;
  /** pool × share / Σshares — ONE half-up rounding at 4 dp (money). */
  readonly allocated: string;
  /** The exact share of the driver total (0…1, 6-dp display). */
  readonly share: string;
}

/**
 * The tenant-configured distributor fold (D-05): the overhead pool
 * distributes over the driver shares exactly — allocated_i =
 * pool × share_i / Σshares with ONE half-up rounding per project at the
 * 4-dp money value. A zero pool or an all-zero driver set allocates
 * honest zeros for every project (never a fabricated spread, never a
 * residual silently absorbed by the last project).
 */
export function allocateOverhead(
  pool: string,
  shares: ReadonlyArray<OverheadDriverShare>,
): OverheadAllocationResult[] {
  const MONEY_SCALE = 4;
  const SHARE_SCALE = 6;
  const poolMinor = toMinor(pool, MONEY_SCALE, "pool");
  const driverMinors = shares.map((share) => ({
    projectId: share.projectId,
    driver: toMinor(share.driverValue, MONEY_SCALE, "driverValue"),
  }));
  const total = driverMinors.reduce((sum, entry) => sum + entry.driver, 0n);
  if (poolMinor === 0n || total === 0n) {
    return driverMinors.map((entry) => ({
      projectId: entry.projectId,
      allocated: fromMinor(0n, MONEY_SCALE),
      share: fromMinor(0n, SHARE_SCALE),
    }));
  }
  return driverMinors.map((entry) => ({
    projectId: entry.projectId,
    // pool(minor4) × driver(minor4) / total(minor4) lands at minor-4
    // money with NO extra scaling (10^-4 × 10^4 / 10^4 = 1).
    allocated: fromMinor(roundDivHalfUp(poolMinor * entry.driver, total, 0), MONEY_SCALE),
    share: fromMinor(roundDivHalfUp(entry.driver, total, SHARE_SCALE), SHARE_SCALE),
  }));
}

/**
 * The labor entry valuation: hours(6-dp) × rate(6-dp) — the exact 12-dp
 * product with ONE half-up rounding at the 4-dp money value (the entry
 * is the valued unit; the rate is the valuation-time snapshot).
 */
export function valueHoursAtRate(hours: string, rate: string): string {
  const MONEY_SCALE = 4;
  const hoursMinor = toMinor(hours, 6, "hours");
  const rateMinor = toMinor(rate, 6, "rate");
  // minor6 × minor6 = minor12; rounding to minor4 divides by 10^8.
  const money = roundDivHalfUp(hoursMinor * rateMinor, 10n ** 8n, 0);
  return fromMinor(money, MONEY_SCALE);
}

// ── D-05: the labor rate resolution fold (payroll read-only) ──────────────

/** One salary-structure component as the payroll tables render it. */
export interface CostComponentInput {
  readonly kind: "ALLOWANCE" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
  readonly calc: "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS";
  readonly amount: string | null;
  readonly rate: string | null;
}

/**
 * The monthly employer cost read from the payroll structure (D-01: the
 * payroll data is READ, never written, never duplicated): basic + the
 * ALLOWANCE and EMPLOYER_CONTRIBUTION components folded in the payroll
 * run's documented order (basic → PERCENT_OF_BASIC → PERCENT_OF_GROSS
 * reading the earnings accumulated before it — the 029 structure fold).
 * DEDUCTION components never enter the EMPLOYER cost. Exact 4-dp
 * arithmetic; ONE half-up rounding at each percent component (the
 * payroll fold's own convention) and at the total.
 */
export function monthlyEmployerCost(
  basicSalary: string,
  components: ReadonlyArray<CostComponentInput>,
): string {
  const MONEY_SCALE = 4;
  const basic = toMinor(basicSalary, MONEY_SCALE, "basicSalary");
  let gross = basic;
  let total = basic;
  // The documented seq order: FIXED → PERCENT_OF_BASIC → PERCENT_OF_GROSS.
  const ordered = [...components].sort((a, b) => calcRank(a.calc) - calcRank(b.calc));
  for (const component of ordered) {
    if (component.kind === "DEDUCTION") continue;
    let value = 0n;
    if (component.calc === "FIXED") {
      value = toMinor(component.amount ?? "0", MONEY_SCALE, "amount");
    } else if (component.calc === "PERCENT_OF_BASIC") {
      // rate is the PERCENT number at 4 dp ("10.0000" = 10%): the
      // fraction divisor is 10^6 (10^4 scale × the /100 percent).
      const rate = toMinor(component.rate ?? "0", 4, "rate");
      value = roundDivHalfUp(basic * rate, 10n ** 6n, 0);
    } else {
      const rate = toMinor(component.rate ?? "0", 4, "rate");
      value = roundDivHalfUp(gross * rate, 10n ** 6n, 0);
    }
    total += value;
    gross += value;
  }
  return fromMinor(total, MONEY_SCALE);
}

function calcRank(calc: CostComponentInput["calc"]): number {
  switch (calc) {
    case "FIXED":
      return 0;
    case "PERCENT_OF_BASIC":
      return 1;
    case "PERCENT_OF_GROSS":
      return 2;
  }
}

/**
 * The hourly cost rate: the monthly employer cost ÷ the tenant's
 * configured standard monthly hours (the projects.labor setting — NO
 * platform default, the BR-055 discipline). Returns null when the
 * divisor is absent (the caller lands the entry UNPRICED with the
 * explicit warning — the payroll.variable.overtime_hours_per_day
 * precedent: never a fabricated rate). ONE half-up rounding at the 6-dp
 * rate (the crm_time_entries.unit_rate scale).
 */
export function hourlyCostRate(
  monthlyCost: string,
  standardMonthlyHours: number | null,
): string | null {
  if (
    standardMonthlyHours === null ||
    typeof standardMonthlyHours !== "number" ||
    !Number.isInteger(standardMonthlyHours) ||
    standardMonthlyHours < 1 ||
    standardMonthlyHours > 744
  ) {
    return null;
  }
  const RATE_SCALE = 6;
  const monthly = toMinor(monthlyCost, 4, "monthlyCost");
  // rate_minor6 = monthly_minor4 × 10^2 / hours (the monthly cost is
  // minor-4, the rate is minor-6 — the ×10^2 keeps the division exact
  // at the rate's own scale; ONE half-up rounding at the rate).
  const rate = roundDivHalfUp(monthly * 100n, BigInt(standardMonthlyHours), 0);
  return fromMinor(rate, RATE_SCALE);
}
