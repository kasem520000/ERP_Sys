import type { JournalLineSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  absExact,
  addExact,
  compareExact,
  subExact,
} from "../../accounting/application/decimal-strings";
import * as store from "../infrastructure/fixed-assets.store";
import { AssetNotFoundError } from "../domain/fixed-assets-errors";

/**
 * The revalued-basis contract (PHASE-026 T8; DR-002 §4 — "subsequent runs
 * compute on the revalued basis"). The register row (`assets`) is NEVER
 * rewritten by a revaluation: the revaluation snapshot chain
 * (asset_revaluations, ordered by date) IS the audit trail, and the CURRENT
 * basis of an asset is the LAST POSTED revaluation's
 * {new_gross_value, new_accumulated} — or, when none exists, the register
 * row's cost and the live accumulated read model
 * (opening_accumulated + Σ posted non-reversed depreciation lines — the
 * store's assetAccumulated).
 *
 * WIRING POINT (orchestrator, recorded in the P26-C report): the store's
 * `assetNbv`/`assetAccumulated` stay HISTORY-based (they never include
 * revaluation restatements). P26-B's depreciation math MUST consume
 * `currentBasis(assetId)` for the revalued-basis runs; the RC-10 check
 * (fixed-assets-reconciliation.ts) is the machine guarantee that the GL and
 * the source rows never drift apart while that wiring lands.
 */

/** The depreciation basis of an asset (canonical 4dp decimal strings). */
export interface AssetBasis {
  grossValue: string;
  accumulated: string;
}

/**
 * The current basis: the LAST POSTED revaluation's restated figures when one
 * exists, else the register row (cost + the live accumulated read model).
 */
export async function currentBasis(assetId: string): Promise<AssetBasis> {
  const last = await store.findLastPostedRevaluation(assetId);
  if (last !== undefined) {
    return { grossValue: last.newGrossValue, accumulated: last.newAccumulated };
  }
  const asset = await store.findAssetById(assetId);
  if (asset === undefined) throw new AssetNotFoundError(assetId);
  return { grossValue: asset.cost, accumulated: await store.assetAccumulated(assetId) };
}

// -- pure revaluation algebra (BR-044) -------------------------------------------------
//
// NOTATION (all signed canonical 4dp strings; exact arithmetic via the
// accounting decimal-string helpers — no Math.*, ADR-0009):
//
//   cost      the register row's cost (G-21 basis — NEVER rewritten)
//   oldAccum  the live accumulated at revaluation time
//             (opening + Σ posted non-reversed lines — store.assetAccumulated)
//   newGross / newAccum  the restated basis being posted
//
//   newNBV = newGross − newAccum
//   oldNBV = cost − oldAccum
//   delta  = newNBV − oldNBV
//          = (newGross − cost) − (newAccum − oldAccum)
//
// Define the two mirror legs:
//
//   g (gross restatement)     = newGross − cost
//   r (accum restatement)     = newAccum − oldAccum = g − delta
//
// Then BY CONSTRUCTION:  g = r + delta  — the three legs always net zero:
//
//   delta > 0:  DR FIXED_ASSET g · [CR ACCUM r if r > 0 | DR ACCUM −r if r < 0]
//               · CR REVALUATION_RESERVE delta
//   delta < 0:  [DR FIXED_ASSET g if g > 0 | CR FIXED_ASSET −g if g < 0]
//               · [CR ACCUM r if r > 0 | DR ACCUM −r if r < 0]
//               · DR REVALUATION_RESERVE −delta
//   delta = 0:  the two mirror legs post alone (a pure reclass — g = r);
//               the reserve line is SKIPPED, never a zero line.
//
// The frozen `delta` column (numeric on asset_revaluations) reconstructs the
// old side exactly:  oldAccum = newAccum − r = newAccum − (g − delta), so
// the posted journal and the stored row agree BY CONSTRUCTION (RC-10 derives
// r from the same frozen values — see fixed-assets-reconciliation.ts).

/** Signed gross restatement g = newGross − cost. */
export function revaluationGrossDelta(cost: string, newGrossValue: string): string {
  return subExact(newGrossValue, cost);
}

/** Signed accum restatement r = (newGross − cost) − delta (= newAccum − oldAccum). */
export function revaluationAccumRestatement(
  cost: string,
  newGrossValue: string,
  delta: string,
): string {
  return subExact(subExact(newGrossValue, cost), delta);
}

/** The reconstructed pre-revaluation accumulated (oldAccum = newAccum − r). */
export function revaluationOldAccumulated(
  cost: string,
  newGrossValue: string,
  newAccumulated: string,
  delta: string,
): string {
  return subExact(newAccumulated, revaluationAccumRestatement(cost, newGrossValue, delta));
}

/** The revaluation NBV delta from the raw inputs (draft-time computation):
 * delta = (newGross − newAccum) − currentNBV. */
export function revaluationDelta(
  newGrossValue: string,
  newAccumulated: string,
  currentNbv: string,
): string {
  return subExact(subExact(newGrossValue, newAccumulated), currentNbv);
}

export interface RevaluationLineInput {
  /** The category's FIXED_ASSET purpose key (per-category account, BR-041). */
  assetPurposeKey: string;
  /** The category's ACCUM_DEPRECIATION purpose key. */
  accumDepreciationPurposeKey: string;
  /** Defaults to REVALUATION_RESERVE (CoA 3210). */
  reservePurposeKey?: string;
  cost: string;
  newGrossValue: string;
  newAccumulated: string;
  /** Frozen at draft: (newGross − newAccum) − pre-revaluation NBV. */
  delta: string;
}

/**
 * The BR-044 three-way mirror as PURE line builder (exported for the golden
 * suite — disposal-math.spec.ts asserts both directions). Zero-valued legs
 * are omitted (the engine requires amount > 0); a full no-op basis yields an
 * EMPTY array (the service rejects it — a revaluation must move something).
 */
export function computeRevaluationLines(input: RevaluationLineInput): JournalLineSpec[] {
  const reservePurpose = input.reservePurposeKey ?? "REVALUATION_RESERVE";
  const g = revaluationGrossDelta(input.cost, input.newGrossValue);
  const r = revaluationAccumRestatement(input.cost, input.newGrossValue, input.delta);
  const memo = {
    en: `Asset revaluation: gross ${g.startsWith("-") ? "down" : "up"} to ${input.newGrossValue}`,
    ar: `إعادة تقييم أصل: القيمة الإجمالية إلى ${input.newGrossValue}`,
  };
  const lines: JournalLineSpec[] = [];
  // Gross leg (DR on uplift, CR on write-down; skipped when the gross is
  // unchanged — never a zero line).
  if (compareExact(g, "0") > 0) {
    lines.push({ purpose: input.assetPurposeKey, direction: "DEBIT", amount: g, memo });
  } else if (compareExact(g, "0") < 0) {
    lines.push({ purpose: input.assetPurposeKey, direction: "CREDIT", amount: absExact(g), memo });
  }
  // Accum restatement leg (CR when accumulated increases, DR when it drops).
  if (compareExact(r, "0") > 0) {
    lines.push({
      purpose: input.accumDepreciationPurposeKey,
      direction: "CREDIT",
      amount: r,
      memo,
    });
  } else if (compareExact(r, "0") < 0) {
    lines.push({
      purpose: input.accumDepreciationPurposeKey,
      direction: "DEBIT",
      amount: absExact(r),
      memo,
    });
  }
  // Reserve plug (never through P&L — BR-044). SKIPPED on a zero-delta pure
  // reclass (the two mirror legs balance alone: g = r).
  if (compareExact(input.delta, "0") > 0) {
    lines.push({ purpose: reservePurpose, direction: "CREDIT", amount: input.delta, memo });
  } else if (compareExact(input.delta, "0") < 0) {
    lines.push({
      purpose: reservePurpose,
      direction: "DEBIT",
      amount: absExact(input.delta),
      memo,
    });
  }
  return lines;
}

/** Σ legs check used by the golden suite's balance assertion (re-exported
 * convenience; exact, no rounding). */
export function sumDirection(
  lines: readonly JournalLineSpec[],
  direction: "DEBIT" | "CREDIT",
): string {
  let total = "0";
  for (const line of lines) {
    if (line.direction === direction) total = addExact(total, line.amount);
  }
  return total;
}
