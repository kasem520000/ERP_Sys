import { Decimal, DomainError } from "@erp/domain-core";

/**
 * PHASE-050 (W-27 — T-09, 2026-11-23) THE SPC PURE MODULE — the computed
 * X-bar/R control charts, Cp/Cpk and the out-of-control flags (D-12: the
 * unit-first law — THIS fold is the ONLY SPC arithmetic in the module;
 * the service feeds it and returns its output VERBATIM, and every
 * consumer — the surface API, the future web chart (W-29), the report
 * pack (W-30) — reads the service, never a parallel computation).
 *
 * THE PINNED FORMULAS (the phase doc §7's own risk — wrong control
 * limits silently mislead — answered by pinning, with the property tests
 * on pinned reference datasets proving every figure):
 *
 *   · subgroups: the time-ordered samples chunk into consecutive groups
 *     of `subgroupSize`; a trailing partial group is EXCLUDED from the
 *     chart's arithmetic and disclosed as `excludedCount` (the classic
 *     discipline — a partial group is not evidence).
 *   · x̄ᵢ = Σ values / n · rᵢ = max − min (both at 6dp).
 *   · X̄̄ (grand mean) = Σ x̄ᵢ / k · R̄ = Σ rᵢ / k (6dp).
 *   · X-chart limits: X̄̄ ± A₂·R̄ · R-chart limits: D₃·R̄ / D₄·R̄.
 *   · σ̂ (within-subgroup estimate) = R̄ / d₂.
 *   · Cp = (USL − LSL) / (6σ̂) · Cpk = min(USL − X̄̄, X̄̄ − LSL) / (3σ̂)
 *     — the SPECIFICATION band (the spec row's own UCL/LCL) is the
 *     USL/LSL, never a fabricated limit: a one-sided or unset band
 *     yields Cp = Cpk = null (the no-fabrication law, red line 5).
 *   · out-of-control: a subgroup is flagged when its ROUNDED mean is
 *     strictly beyond the published X limits, or its ROUNDED range is
 *     strictly beyond the published R limits — the CLOSED-INTERVAL law
 *     (a value ON a limit is within; the tolerance fold's own
 *     discipline), and the flags judge exactly the figures the chart
 *     PUBLISHES (the operator's own numbers — self-consistent).
 *
 * THE DEGENERATE SHAPE (the declared honest interpretation): when R̄ = 0
 * (every subgroup carries zero variation) the limits collapse onto the
 * grand mean and σ̂ is undefined as an estimate — sigmaHat/cp/cpk are
 * null, never a fabricated infinity, and no flag can fire by
 * construction (every mean equals the collapsed limit — the inclusive
 * tie law proven on that very world).
 *
 * THE CONSTANTS (the standard Shewhart tables, pinned 3dp): n = 2…10 —
 * a subgroup size outside the table's domain is refused (the typed
 * error names the size and the domain).
 */

export const SPC_SUBGROUP_SIZE_MIN = 2;
export const SPC_SUBGROUP_SIZE_MAX = 10;

/** The pinned Shewhart constants per subgroup size n (A₂ · D₃ · D₄ · d₂). */
export const SPC_CONSTANTS: Readonly<
  Record<number, { a2: string; d3: string; d4: string; d2: string }>
> = {
  2: { a2: "1.880", d3: "0.000", d4: "3.267", d2: "1.128" },
  3: { a2: "1.023", d3: "0.000", d4: "2.574", d2: "1.693" },
  4: { a2: "0.729", d3: "0.000", d4: "2.282", d2: "2.059" },
  5: { a2: "0.577", d3: "0.000", d4: "2.114", d2: "2.326" },
  6: { a2: "0.483", d3: "0.000", d4: "2.004", d2: "2.534" },
  7: { a2: "0.419", d3: "0.076", d4: "1.924", d2: "2.704" },
  8: { a2: "0.373", d3: "0.136", d4: "1.864", d2: "2.847" },
  9: { a2: "0.337", d3: "0.184", d4: "1.816", d2: "2.970" },
  10: { a2: "0.308", d3: "0.223", d4: "1.777", d2: "3.078" },
};

const ROUNDING = Decimal.ROUND_HALF_UP;

function round6(value: Decimal): string {
  return value.toDecimalPlaces(6, ROUNDING).toFixed(6);
}

/** One computed subgroup — the values verbatim plus the folded figures. */
export interface SpcSubgroup {
  values: string[];
  mean: string;
  range: string;
  xOutOfControl: boolean;
  rOutOfControl: boolean;
}

/** The published X-bar/R chart (every figure at 6dp, ROUND_HALF_UP). */
export interface XbarRChart {
  subgroupSize: number;
  /** The complete subgroups in time order (the chart's own arithmetic). */
  subgroups: SpcSubgroup[];
  /** The trailing partial group's sample count — excluded, disclosed. */
  excludedCount: number;
  grandMean: string;
  rBar: string;
  xChart: { ucl: string; lcl: string };
  rChart: { ucl: string; lcl: string };
  /** σ̂ = R̄/d₂ — null in the degenerate R̄ = 0 shape. */
  sigmaHat: string | null;
  /** Cp against the specification band — null when the band is not
   * two-sided or σ̂ is undefined (the no-fabrication law). */
  cp: string | null;
  /** Cpk against the specification band — the same null law as Cp. */
  cpk: string | null;
  /** True when ANY subgroup is flagged on either chart. */
  outOfControl: boolean;
}

export interface SpcChartInput {
  /** The time-ordered sample values (oldest first). */
  values: string[];
  /** The subgroup size n — 2…10 (the pinned table's domain). */
  subgroupSize: number;
  /** The specification band (the spec row's own UCL/LCL — the USL/LSL
   * of Cp/Cpk; nullable ends are the no-fabrication law). */
  band: { ucl: string | null; lcl: string | null };
}

/**
 * THE FOLD: X-bar/R + Cp/Cpk + the out-of-control flags. Total over the
 * declared domain — the two typed refusals (the subgroup size outside
 * 2…10; fewer samples than one complete subgroup) are the caller's
 * input floor, thrown here so no consumer re-derives them.
 */
export function computeXbarRChart(input: SpcChartInput): XbarRChart {
  const n = input.subgroupSize;
  if (!Number.isInteger(n) || n < SPC_SUBGROUP_SIZE_MIN || n > SPC_SUBGROUP_SIZE_MAX) {
    throw new SpcSubgroupSizeInvalidError(n);
  }
  if (input.values.length < n) {
    throw new SpcInsufficientSamplesError(input.values.length, n);
  }
  const constants = SPC_CONSTANTS[n]!;
  const a2 = new Decimal(constants.a2);
  const d3 = new Decimal(constants.d3);
  const d4 = new Decimal(constants.d4);
  const d2 = new Decimal(constants.d2);

  const complete = Math.floor(input.values.length / n);
  const excludedCount = input.values.length - complete * n;

  const subgroups: SpcSubgroup[] = [];
  for (let group = 0; group < complete; group += 1) {
    const slice = input.values.slice(group * n, (group + 1) * n)!;
    const decimals = slice.map((value) => new Decimal(value));
    let sum = new Decimal(0);
    let min = decimals[0]!;
    let max = decimals[0]!;
    for (const value of decimals) {
      sum = sum.plus(value);
      if (value.lessThan(min)) min = value;
      if (value.greaterThan(max)) max = value;
    }
    subgroups.push({
      values: slice,
      mean: round6(sum.div(n)),
      range: round6(max.minus(min)),
      xOutOfControl: false,
      rOutOfControl: false,
    });
  }

  let meanSum = new Decimal(0);
  let rangeSum = new Decimal(0);
  for (const group of subgroups) {
    meanSum = meanSum.plus(new Decimal(group.mean));
    rangeSum = rangeSum.plus(new Decimal(group.range));
  }
  const k = new Decimal(subgroups.length);
  const grandMean = round6(meanSum.div(k));
  const rBar = round6(rangeSum.div(k));

  const gm = new Decimal(grandMean);
  const rb = new Decimal(rBar);
  const xUcl = round6(gm.plus(a2.times(rb)));
  const xLcl = round6(gm.minus(a2.times(rb)));
  const rUcl = round6(d4.times(rb));
  const rLcl = round6(d3.times(rb));

  // The flags judge the PUBLISHED figures (the closed-interval law: a
  // value ON a limit is within — strictly-beyond only).
  const xU = new Decimal(xUcl);
  const xL = new Decimal(xLcl);
  const rU = new Decimal(rUcl);
  const rL = new Decimal(rLcl);
  let outOfControl = false;
  for (const group of subgroups) {
    const mean = new Decimal(group.mean);
    const range = new Decimal(group.range);
    group.xOutOfControl = mean.greaterThan(xU) || mean.lessThan(xL);
    group.rOutOfControl = range.greaterThan(rU) || range.lessThan(rL);
    if (group.xOutOfControl || group.rOutOfControl) outOfControl = true;
  }

  // σ̂ and the capability indices — the degenerate R̄ = 0 shape carries
  // null (never a fabricated infinity); a band that is not two-sided
  // carries null (never a fabricated limit).
  const degenerate = rb.isZero();
  const sigmaHat = degenerate ? null : round6(rb.div(d2));
  let cp: string | null = null;
  let cpk: string | null = null;
  if (
    !degenerate &&
    input.band.ucl !== null &&
    input.band.lcl !== null &&
    new Decimal(input.band.ucl).greaterThan(new Decimal(input.band.lcl))
  ) {
    const usl = new Decimal(input.band.ucl);
    const lsl = new Decimal(input.band.lcl);
    const sigma = rb.div(d2); // full precision — rounding only at the surface
    cp = round6(usl.minus(lsl).div(sigma.times(6)));
    const toUsl = usl.minus(gm);
    const toLsl = gm.minus(lsl);
    const closer = toUsl.lessThan(toLsl) ? toUsl : toLsl;
    cpk = round6(closer.div(sigma.times(3)));
  }

  return {
    subgroupSize: n,
    subgroups,
    excludedCount,
    grandMean,
    rBar,
    xChart: { ucl: xUcl, lcl: xLcl },
    rChart: { ucl: rUcl, lcl: rLcl },
    sigmaHat,
    cp,
    cpk,
    outOfControl,
  };
}

// ── the fold's own typed input floors (the quality taxonomy's family) ────────
// Declared beside the fold that throws them — the classes are the fold's
// own contract; quality-errors.ts re-exports the family so the HTTP face
// stays one import (the W-25 taxonomy's shape).

export class SpcSubgroupSizeInvalidError extends DomainError {
  constructor(size: number) {
    super(
      "SPC_SUBGROUP_SIZE_INVALID",
      `the subgroup size ${size} is outside the pinned constants table's domain (2…10 — the standard Shewhart tables; a size outside the table has no pinned constants and is refused)`,
      { subgroupSize: size, min: SPC_SUBGROUP_SIZE_MIN, max: SPC_SUBGROUP_SIZE_MAX },
    );
  }
}

export class SpcInsufficientSamplesError extends DomainError {
  constructor(have: number, need: number) {
    super(
      "SPC_INSUFFICIENT_SAMPLES",
      `${have} sample(s) cannot form even one complete subgroup of ${need} (the chart needs at least one complete subgroup — the partial trailing group is excluded by design, never charted)`,
      { have, need },
    );
  }
}
