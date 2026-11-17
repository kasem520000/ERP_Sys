import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  clampBase,
  contributionAmount,
  foldPitBrackets,
  foldEosbTiers,
  foldStatutorySummary,
  trueUpDelta,
  type PitBracket,
  type EosbTier,
  type StatutoryAccrualInput,
} from "../domain/statutory-math";

/**
 * PHASE-046 (W-6, T-14) — THE INV-032 PROPERTY WING (the pure-engine
 * law, randomized but fully deterministic — fast-check's property
 * runners are seeded by default and shrink on failure). The worked
 * examples are pinned by the unit spec (statutory-math.spec 25/25) and
 * the DB suites; THIS spec proves the laws hold over the WHOLE input
 * space, not just the examples:
 *
 * - INV-032(a) — the contribution law: every line == rate% × the
 *   CLAMPED base, exact 4dp half-up (recomputed independently with
 *   BigInt); the clamp keeps the line constant above the cap (the
 *   wrong-cap shape — an above-cap line — is unrepresentable);
 * - INV-032(b) — the fold law: Σ per-row statutory lines == the folded
 *   summary, exact, order-independent (the same lines fold the same
 *   summary whatever the capture order);
 * - the PIT marginal law: Σ rounded slices == the total (no absorbed
 *   residual), every slice == rate × its width half-up 4dp;
 * - INV-032(c) — the EOSB tier law: Σ per-tier amounts == the
 *   entitlement, Σ tier days == the days, every tier's amount ==
 *   days/30 × base half-up 4dp; and the true-up delta == entitlement −
 *   provision exactly, signed.
 */

/** Parse a decimal string (≤4dp) into scaled BigInt units (10^-4). */
function units4(value: string): bigint {
  const neg = value.startsWith("-");
  const bare = neg ? value.slice(1) : value;
  const [int, frac = ""] = bare.split(".");
  const scaled = BigInt(int + frac.padEnd(4, "0"));
  return neg ? -scaled : scaled;
}

function format4(scaled: bigint): string {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const digits = abs.toString().padStart(5, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = (abs + denominator / 2n) / denominator;
  return negative ? -quotient : quotient;
}

/** rate% × base, half-up 4dp — the independent BigInt recomputation. */
function rateTimesBase(ratePercent: string, base: string): string {
  // rate (scale 4, percent) × base (scale 4) → scale 8; percent → the
  // fraction divides by 10^2; the result's scale 4 divides by 10^4.
  return format4(divHalfUp(units4(ratePercent) * units4(base), 1_000_000n));
}

// -- the arbitraries -------------------------------------------------------------------

const money4 = fc
  .tuple(fc.nat({ max: 200_000 }), fc.nat({ max: 9_999 }))
  .map(([int, frac]) => `${int}.${frac.toString().padStart(4, "0")}`);

const rate4 = fc
  .tuple(fc.nat({ max: 100 }), fc.nat({ max: 9_999 }))
  .map(([int, frac]) => `${int}.${frac.toString().padStart(4, "0")}`);

const optionalBound = fc.option(money4, { nil: undefined });

describe("PHASE-046 (W-6, T-14) · INV-032(a) — the contribution + clamp law over the whole input space", () => {
  it("property: every line == rate% × the CLAMPED base, exact 4dp half-up (independent BigInt recomputation)", () => {
    fc.assert(
      fc.property(rate4, money4, optionalBound, optionalBound, (rate, base, baseMin, baseMax) => {
        const clamped = clampBase(base, baseMin ?? null, baseMax ?? null);
        expect(clamped.clamped).toBe(
          baseMin !== undefined && units4(base) < units4(baseMin)
            ? baseMin
            : baseMax !== undefined && units4(base) > units4(baseMax)
              ? baseMax
              : base,
        );
        const amount = contributionAmount(rate, clamped.clamped);
        expect(amount).toBe(rateTimesBase(rate, clamped.clamped));
        expect(amount).toMatch(/^-?\d+\.\d{4}$/);
      }),
      { numRuns: 400 },
    );
  });

  it("property: the clamp law — the line is constant at/above the cap and at/below the floor (the wrong-cap shape unrepresentable); NULL = unbounded", () => {
    fc.assert(
      fc.property(rate4, money4, money4, money4, (rate, base, floor, ceiling) => {
        // Only well-ordered windows (the canonical sets are; a disordered
        // window is a data error outside this property's space).
        fc.pre(units4(floor) <= units4(ceiling));
        const above = format4(units4(ceiling) + 10_000n);
        const at = ceiling;
        const below = format4(units4(floor) - 10_000n);
        const lineAt = contributionAmount(rate, clampBase(at, floor, ceiling).clamped);
        const lineAbove = contributionAmount(rate, clampBase(above, floor, ceiling).clamped);
        expect(lineAbove).toBe(lineAt); // never above the capped maximum
        expect(clampBase(above, floor, ceiling).clampedBy).toBe("MAX");
        const lineBelow = contributionAmount(rate, clampBase(below, floor, ceiling).clamped);
        const lineAtFloor = contributionAmount(rate, clampBase(floor, floor, ceiling).clamped);
        expect(lineBelow).toBe(lineAtFloor); // never below the floored minimum
        expect(clampBase(below, floor, ceiling).clampedBy).toBe("MIN");
        // NULL = unbounded: no clamp ever engages.
        expect(clampBase(base, null, null)).toMatchObject({ clamped: base, clampedBy: null });
      }),
      { numRuns: 300 },
    );
  });
});

describe("PHASE-046 (W-6, T-14) · INV-032(b) — the fold law: Σ lines == the summary, order-independent", () => {
  const accrual = fc.record({
    code: fc.constantFrom("GOSI-PENSION", "GOSI-SANED", "GOSI-OH", "PIT-XX"),
    kind: fc.constantFrom("CONTRIBUTION" as const, "PIT" as const),
    employeeAmount: money4,
    employerAmount: money4,
  });

  it("property: the folded summary's accrued == Σ (employee + employer) per (code, kind), exact; the fold is order-independent; remitted starts at zero", () => {
    fc.assert(
      fc.property(fc.array(accrual, { minLength: 0, maxLength: 40 }), (accruals) => {
        const summary = foldStatutorySummary(accruals as StatutoryAccrualInput[]);
        const expected = new Map<string, string>();
        for (const row of accruals) {
          const key = `${row.kind}|${row.code}`;
          const add = format4(units4(row.employeeAmount) + units4(row.employerAmount));
          expected.set(key, expected.has(key) ? format4(units4(expected.get(key)!) + units4(add)) : add);
        }
        expect(summary).toHaveLength(expected.size);
        for (const row of summary) {
          expect(row.accrued).toBe(expected.get(`${row.kind}|${row.code}`));
          expect(row.remitted).toBe("0.0000");
        }
        // Order independence of the VALUES: the summary's row ORDER is
        // first-seen (deterministic per capture order), so the tie is on
        // the (kind, code)-keyed maps, not the array order.
        const shuffled = [...accruals];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = (i * 7 + 3) % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
        }
        const byKey = (rows: typeof summary) =>
          new Map(rows.map((row) => [`${row.kind}|${row.code}`, row.accrued]));
        expect(byKey(foldStatutorySummary(shuffled as StatutoryAccrualInput[]))).toEqual(
          byKey(summary),
        );
      }),
      { numRuns: 250 },
    );
  });
});

describe("PHASE-046 (W-6, T-14) · the PIT marginal law: Σ rounded slices == the total, no absorbed residual", () => {
  /** A random SET-CONSISTENT tiling of [0, ∞): the first floor 0, every
   * next floor = the previous ceiling, the last ceiling open. */
  const consistentBrackets = fc
    .array(fc.nat({ max: 60 }), { minLength: 1, maxLength: 8 })
    .map((widths) => {
      const brackets: PitBracket[] = [];
      let floor = 0;
      for (const [index, widthUnits] of widths.entries()) {
        const width = widthUnits * 1_000;
        const ceiling = index === widths.length - 1 ? null : floor + width;
        brackets.push({
          floor: format4(BigInt(floor)),
          ceiling: ceiling === null ? null : format4(BigInt(ceiling)),
          rate: `0.0000`,
        });
        if (ceiling === null) break;
        floor = ceiling;
      }
      return brackets;
    })
    .map((brackets) =>
      brackets.map((bracket, index) => ({
        ...bracket,
        rate: `${index % 2 === 0 ? index : 20 - index}.2500`,
      })),
    );

  it("property: Σ slice amounts == the total exactly (no absorbed residual); every slice == rate% × its width half-up 4dp", () => {
    fc.assert(
      fc.property(consistentBrackets, money4, (brackets, taxable) => {
        const fold = foldPitBrackets(taxable, brackets);
        let sum = 0n;
        for (const slice of fold.slices) {
          sum += units4(slice.amount);
        }
        expect(format4(sum)).toBe(fold.tax);
        expect(fold.sliceTotal).toBe(fold.tax); // the explicit tie, no absorbed residual
        // Every slice's rate × width == its amount (half-up 4dp).
        for (const slice of fold.slices) {
          expect(slice.amount).toBe(rateTimesBase(slice.rate, slice.slice));
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("PHASE-046 (W-6, T-14) · INV-032(c) — the EOSB tier fold + the true-up delta", () => {
  const tiers = fc
    .array(fc.tuple(fc.nat({ max: 10 }), fc.nat({ max: 3 }), fc.nat({ max: 45 })), {
      minLength: 1,
      maxLength: 5,
    })
    .map((rows) => {
      const sorted = [...rows].sort((a, b) => a[0] - b[0]);
      const out: EosbTier[] = [];
      let previousTo: number | null = null;
      for (const [fromYears, width, daysPerYear] of sorted) {
        if (previousTo !== null && fromYears < previousTo) continue; // keep strict stacking
        if (out.some((tier) => tier.fromYears === `${fromYears}.0000`)) continue;
        out.push({
          fromYears: `${fromYears}.0000`,
          toYears: width === 0 ? null : `${fromYears + width}.0000`,
          daysPerYear: `${Math.max(daysPerYear, 1)}.0000`,
        });
        if (width === 0) break;
        previousTo = fromYears + width;
      }
      return out.length > 0 ? out : [{ fromYears: "0.0000", toYears: null, daysPerYear: "15.0000" }];
    });

  it("property: Σ tier amounts == the entitlement and Σ tier days == the days, exact; every tier == days/30 × base half-up 4dp", () => {
    fc.assert(
      fc.property(tiers, money4, money4, (tierRows, serviceYears, eosBase) => {
        const fold = foldEosbTiers(serviceYears, eosBase, tierRows);
        let amountSum = 0n;
        let daysSum = 0n;
        for (const share of fold.breakdown) {
          amountSum += units4(share.amount);
          daysSum += units4(share.days);
          // The per-tier law: days = years × daysPerYear (half-up 4dp)…
          expect(share.days).toBe(
            format4(divHalfUp(units4(share.yearsInTier) * units4(share.daysPerYear), 10_000n)),
          );
          // …and amount = days/30 × eosBase (half-up 4dp) — the exact
          // rational: round_half_up(days × base / 30) at scale 4.
          expect(share.amount).toBe(
            format4(divHalfUp(units4(share.days) * units4(eosBase), 300_000n)),
          );
        }
        expect(format4(amountSum)).toBe(fold.entitlement); // no absorbed residual
        expect(format4(daysSum)).toBe(fold.days);
      }),
      { numRuns: 300 },
    );
  });

  it("property: the true-up delta == entitlement − provision exactly, signed 4dp (INV-032(c))", () => {
    fc.assert(
      fc.property(money4, money4, (entitlement, provision) => {
        const delta = trueUpDelta(entitlement, provision);
        expect(delta).toBe(format4(units4(entitlement) - units4(provision)));
        // The sign law: positive accrues, negative releases, zero posts
        // nothing (the golden suite pins the no-journal arm).
        expect(delta.startsWith("-")).toBe(units4(entitlement) < units4(provision));
      }),
      { numRuns: 300 },
    );
  });
});
