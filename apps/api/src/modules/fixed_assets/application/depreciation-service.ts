import { Decimal } from "@erp/domain-core";

import { PeriodNotFoundError } from "../../accounting/domain/accounting-errors";
import {
  findActivePurpose,
  findPeriodById,
} from "../../accounting/infrastructure/accounting.store";
import {
  type AssetCategoryRow,
  type AssetRow,
  type DepreciationLineRow,
  type DepreciationRunRow,
  assetAccumulated,
  findAssetById,
  findAssetCategoryById,
  findDepreciationRunByPeriod,
  findDepreciationRunById,
  findLastPostedRevaluation,
  insertDepreciationLines,
  insertDepreciationRun,
  listAssets,
  listDepreciationLinesByAsset,
  listDepreciationLinesByRun,
  resetDraftRunLines,
  updateAsset,
  updateDepreciationRun,
} from "../infrastructure/fixed-assets.store";
import { AssetNotFoundError } from "../domain/fixed-assets-errors";
import { revaluationOldAccumulated } from "./current-basis";
import {
  AssemblyCancelledError,
  AssemblyValidationError,
  DepreciationAssetInvalidError,
  DepreciationRunNotFoundError,
  type AssetRejection,
  NbvFloorViolationError,
  PeriodLockedForRunError,
  RunAlreadyExistsError,
  RunNotPostableError,
  UoPUnitsRequiredError,
} from "./depreciation-errors";

/**
 * PHASE-026 T6 — the depreciation calculation engine (P26-B).
 *
 * ── Method authority (DR-002 §Decision 5; no fabricated jurisdiction rules) ──
 * The three registered methods (DATA_DICTIONARY §9 enum is exhaustive):
 *
 * 1. STRAIGHT_LINE — `(cost − salvage_value) / useful_life_months` per month,
 *    half-up to 4dp (ADR-0009).
 * 2. DECLINING_BALANCE — rate on opening NBV. DR-002 fixes no numeric rate, so
 *    the documented default shipped here is the STRAIGHT-LINE-EQUIVALENT
 *    monthly fraction: `rate = 12 / useful_life_months` per month (e.g. a
 *    60-month asset decays 20%/month of its OPENING NBV). The monthly amount
 *    is `min(openingNBV × rate, openingNBV − salvage)` — floored so
 *    accumulated NEVER exceeds cost − salvage (BR-043/INV-023); when
 *    `openingNBV − salvage ≤ 0` the asset is at the floor, flips
 *    FULLY_DEPRECIATED and drops out of runs.
 * 3. UNITS_OF_PRODUCTION — `(cost − salvage) × period_units /
 *    total_estimated_units`; usage is MANUAL per line in the run workspace
 *    (no metering, DR-002 revisit clause), capped at the same floor.
 *
 * ── Month convention (the DR-002 default, encoded as golden fixtures) ──
 * Next-month convention (the conservative Arabic-market standard — Qoyod
 * et al.): THE ACQUISITION MONTH ITSELF DOES NOT DEPRECIATE. An asset is
 * eligible for a fiscal period iff
 *   `monthIndex(acquisitionDate, period.startDate) ≥ 1`
 * i.e. the period starts in a month strictly AFTER the acquisition month
 * (`monthIndex === 0` is the acquisition month; `< 0` is before acquisition).
 * Golden: 12,000 cost / 0 salvage / 60 months SL acquired 2026-01-15 → the
 * 2026-01 run does NOT include it; the first run is 2026-02 at 200.0000/month.
 *
 * ── Final-period residual absorption (INV-023) ──
 * Σ depreciation over the life = cost − salvage EXACTLY. The period whose
 * month index is ≥ useful_life_months (the life-end month, or the first run
 * after it when months were skipped) takes the ENTIRE remaining headroom
 * instead of the formula amount; UoP absorbs when cumulative consumed units
 * reach total_estimated_units. The floor cap `min(formula, headroom)` applies
 * to every other period, so accumulated ≤ base ALWAYS (BR-043).
 *
 * ── Rounding (ADR-0009) ──
 * Half-up to 4dp via @erp/domain-core Decimal — Math.* is banned
 * (no-restricted-properties); money/units travel as canonical decimal strings.
 *
 * ── Revalued basis (DR-002 §4 — “subsequent runs compute on the revalued
 * basis”; P26-C's current-basis contract) ──
 * A POSTED revaluation restates the asset's (gross, accumulated) WITHOUT
 * rewriting the register row. Runs compute on `runBasisOf(asset)`: gross =
 * the last POSTED revaluation's new_gross_value (else cost); accumulated =
 * the revaluation's new_accumulated PLUS every posted non-reversed line
 * since (history − the revaluation-time old accumulated, reconstructed via
 * P26-C's frozen-delta algebra). That composition equals the RC-10 GL side
 * exactly (history + r), so the run floor `gross − salvage` is the same
 * current basis RC-10 reconciles — INV-023's “cost” under revaluation is
 * the current gross basis. P26-C's `currentBasis()` alone freezes at
 * revaluation time (drops post-reval lines), so the runs use the corrected
 * composition here (documented for the completion report).
 *
 * ── Assembly (BR-042, one run per fiscal period) ──
 * `assembleRun` creates-or-reuses the DRAFT run (a run in ANY other status →
 * 409 DEPRECIATION_RUN_PERIOD_TAKEN), resets DRAFT lines (the append-only
 * exception, store-guarded), computes chunk-wise (CHUNK = 500 — bounded
 * statements + the cancel probe point, ADR-0008), inserts lines
 * (line_no sequential, period_amount > 0 — assets computing to 0.0000 are
 * excluded AND LISTED, never silently dropped), then stamps totals. BR-041
 * category gaps and data problems REJECT the whole assembly with the full
 * per-asset reason list before anything is written (zero residue).
 *
 * NOTE (known race, documented): the FULLY_DEPRECIATED flip re-reads the
 * asset before updating status, but the store exposes no conditional
 * `UPDATE … WHERE status = 'ACTIVE'`; a disposal committing in the same
 * instant could be overwritten. The window is milliseconds and disposals
 * re-validate in their own flow; recorded for the completion report.
 */

// -- pure month arithmetic (integer-only; no Date, no Math.*) -----------------------

interface YearMonth {
  year: number;
  month: number; // 1..12
}

function ymOf(isoDate: string): YearMonth {
  return { year: Number(isoDate.slice(0, 4)), month: Number(isoDate.slice(5, 7)) };
}

function absoluteMonth(ym: YearMonth): number {
  return ym.year * 12 + (ym.month - 1);
}

function fromAbsoluteMonth(total: number): YearMonth {
  // Remainder first (always exact for integers), then a division that is
  // exact BY CONSTRUCTION — no truncation of an inexact float quotient.
  const r = ((total % 12) + 12) % 12;
  const year = (total - r) / 12;
  return { year, month: r + 1 };
}

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value);
}

/** First calendar day of the month containing `isoDate` (yyyy-mm-01). */
export function monthStartOf(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

/** `months` added to a month-START iso date (day stays 01 — life-window math). */
export function addMonths(monthStartIso: string, months: number): string {
  const target = fromAbsoluteMonth(absoluteMonth(ymOf(monthStartIso)) + months);
  return `${String(target.year)}-${pad2(target.month)}-01`;
}

/**
 * Months between the acquisition month and the period's month (period −
 * acquisition). 0 = the acquisition month itself (NOT eligible — next-month
 * convention); ≥ 1 = eligible; < 0 = before acquisition.
 */
export function monthIndexOf(acquisitionDate: string, periodStartDate: string): number {
  return absoluteMonth(ymOf(periodStartDate)) - absoluteMonth(ymOf(acquisitionDate));
}

/**
 * Postgres 23505 unique violation (drizzle wraps pg errors in a cause chain
 * — the posting-service precedent): concurrent same-period run creations
 * converge instead of surfacing a raw 500.
 */
export function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

// -- pure depreciation kernel (exported for the INV-023 property suite) --------------

export const DEPRECIATION_METHODS = [
  "STRAIGHT_LINE",
  "DECLINING_BALANCE",
  "UNITS_OF_PRODUCTION",
] as const;

export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

/** The asset fields the kernel needs (AssetRow satisfies this structurally). */
export interface AssetMathInput {
  id: string;
  code: string;
  acquisitionDate: string;
  cost: string;
  salvageValue: string;
  usefulLifeMonths: number;
  depreciationMethod: string;
  totalEstimatedUnits: string | null;
}

/**
 * Period context for the final-period residual absorption. The assembly
 * ALWAYS passes it; without it the kernel returns the plain formula amount
 * (capped at the floor) — the property suite passes it to drive full lives.
 */
export interface ComputePeriodContext {
  /** The run's fiscal period start date (yyyy-mm-dd). */
  periodStartDate: string;
  /** UoP only: units consumed by POSTED non-reversed lines before this run. */
  cumulativeUnitsBefore?: string;
}

export interface ComputedDepreciation {
  /** Canonical 4dp decimal string, ≥ 0 (0.0000 = no line this period). */
  amount: string;
  /** True when accumulated after this amount equals cost − salvage (floor). */
  flipsFullyDepreciated: boolean;
  /** True when this period absorbs the residual (INV-023 final period). */
  isFinalPeriod: boolean;
}

/** Half-up to the money scale (ADR-0009 — 19,4). */
export function round4(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

/** Depreciable base = cost − salvage (the INV-023 ceiling). Decimal-exact. */
export function depreciableBaseOf(asset: AssetMathInput): string {
  return round4(new Decimal(asset.cost).minus(new Decimal(asset.salvageValue)));
}

/**
 * The three-method kernel (DR-002 §Decision 5). Pure: no store, no clock.
 *
 * - STRAIGHT_LINE: `round4(base / life)`, capped at the headroom.
 * - DECLINING_BALANCE: `round4(openingNBV × 12/life)`, capped at the headroom
 *   (openingNBV = cost − accumulated, NOT floored below salvage — the CAP is
 *   the floor enforcement).
 * - UNITS_OF_PRODUCTION: `round4(base × periodUnits / totalUnits)`, capped at
 *   the headroom.
 *
 * With `context`: the final period (SL/DB monthIndex ≥ life; UoP cumulative
 * units ≥ total) takes the WHOLE remaining headroom so Σ = base exactly.
 */
export function computeMonthlyAmount(
  asset: AssetMathInput,
  accumulatedBefore: string,
  periodUnits?: string,
  context?: ComputePeriodContext,
): ComputedDepreciation {
  const cost = new Decimal(asset.cost);
  const salvage = new Decimal(asset.salvageValue);
  const base = cost.minus(salvage);
  const accumulated = new Decimal(accumulatedBefore);
  const headroom = base.minus(accumulated);

  if (headroom.isNegative()) {
    throw new NbvFloorViolationError({
      assetId: asset.id,
      code: asset.code,
      accumulated: accumulatedBefore,
      base: round4(base),
    });
  }
  if (headroom.isZero()) {
    return { amount: "0.0000", flipsFullyDepreciated: true, isFinalPeriod: false };
  }

  const life = asset.usefulLifeMonths;
  if (!Number.isInteger(life) || life <= 0) {
    throw new DepreciationAssetInvalidError({
      assetId: asset.id,
      code: asset.code,
      problem: `useful_life_months must be a positive integer (got ${String(life)})`,
    });
  }

  let candidate: Decimal;
  let isFinal = false;

  switch (asset.depreciationMethod) {
    case "STRAIGHT_LINE": {
      candidate = new Decimal(round4(base.div(life)));
      if (context !== undefined) {
        isFinal = monthIndexOf(asset.acquisitionDate, context.periodStartDate) >= life;
      }
      break;
    }
    case "DECLINING_BALANCE": {
      const rate = new Decimal(12).div(life); // DR-002 default (see header)
      const openingNbv = cost.minus(accumulated);
      candidate = new Decimal(round4(openingNbv.times(rate)));
      if (context !== undefined) {
        isFinal = monthIndexOf(asset.acquisitionDate, context.periodStartDate) >= life;
      }
      break;
    }
    case "UNITS_OF_PRODUCTION": {
      if (periodUnits === undefined) {
        throw new UoPUnitsRequiredError([
          {
            assetId: asset.id,
            code: asset.code,
            totalEstimatedUnits: asset.totalEstimatedUnits ?? "0",
          },
        ]);
      }
      const totalUnits = new Decimal(asset.totalEstimatedUnits ?? "0");
      const units = new Decimal(periodUnits);
      if (!totalUnits.isPositive() || units.isNegative() || !units.isFinite()) {
        throw new DepreciationAssetInvalidError({
          assetId: asset.id,
          code: asset.code,
          problem: `UoP needs total_estimated_units > 0 and period_units ≥ 0 (got total ${asset.totalEstimatedUnits ?? "null"}, period ${periodUnits})`,
        });
      }
      candidate = new Decimal(round4(base.times(units).div(totalUnits)));
      if (context !== undefined && context.cumulativeUnitsBefore !== undefined) {
        isFinal = new Decimal(context.cumulativeUnitsBefore).plus(units).gte(totalUnits);
      }
      break;
    }
    default:
      throw new DepreciationAssetInvalidError({
        assetId: asset.id,
        code: asset.code,
        problem: `unknown depreciation method "${asset.depreciationMethod}" (§9 enum is exhaustive)`,
      });
  }

  const amount = isFinal ? headroom : Decimal.min(candidate, headroom);
  const amountStr = round4(amount);
  return {
    amount: amountStr,
    flipsFullyDepreciated: headroom.minus(amount).isZero(),
    isFinalPeriod: isFinal,
  };
}

// -- eligibility read model -----------------------------------------------------------

/** Structural subset of the accounting store's FiscalPeriodRow. */
export interface FiscalPeriodLike {
  id: string;
  name: string;
  kind: string;
  startDate: string;
  endDate: string;
  status: string;
}

/** An asset cleared to depreciate this period, with its math inputs. */
export interface EligibleWorkItem {
  asset: AssetRow;
  category: AssetCategoryRow;
  /** The basis the kernel computes on (revalued gross when one is posted). */
  basis: RunBasis;
  accumulatedBefore: string;
  base: string;
  headroom: string;
  monthIndex: number;
}

export interface ExcludedAsset {
  assetId: string;
  code: string;
  reason:
    | "ACQUISITION_MONTH" // monthIndex 0 — the acquisition month (next-month convention)
    | "BEFORE_ACQUISITION" // monthIndex < 0 — period predates the asset
    | "STATUS_NOT_ACTIVE" // FULLY_DEPRECIATED / DISPOSED / WRITTEN_OFF
    | "AT_FLOOR" // accumulated ≥ cost − salvage (INV-023 floor)
    | "ZERO_AMOUNT"; // computes to 0.0000 (e.g. UoP with 0 usage) — no line
  detail?: string;
}

export interface EligibilityOutcome {
  /** Eligible, validated, sorted by asset code (deterministic assembly). */
  items: EligibleWorkItem[];
  /** Not eligible — listed for the workspace UI (never silently skipped). */
  excluded: ExcludedAsset[];
  /** BR-041/data rejections — non-empty rejects the whole assembly. */
  rejections: AssetRejection[];
  /** ACTIVE assets already at the floor (status hygiene — flipped by caller). */
  atFloor: Array<{ assetId: string; code: string }>;
}

/** Non-negative decimal string, ≤ 6dp (units are numeric(19,6)). */
const UNITS_PATTERN = /^\d{1,16}(\.\d{1,6})?$/;

export function isValidUnitsInput(value: string | undefined): value is string {
  return value !== undefined && UNITS_PATTERN.test(value);
}

// -- the run basis (register row or the revalued basis) ------------------------------

export interface RunBasis {
  /** Current gross carrying value: last POSTED revaluation's new gross, else cost. */
  grossValue: string;
  /** Live basis accumulated (reval restatement + posted lines since). */
  accumulated: string;
  /** True when a POSTED revaluation restates this asset. */
  revalued: boolean;
}

/**
 * The basis a depreciation run computes on (DR-002 §4). Without a POSTED
 * revaluation: (cost, the store's live accumulated). With one: (newGross,
 * newAccumulated + posted-lines-since) — the exact RC-10 GL composition
 * (see the file header). The salvage floor stays the register's
 * salvage_value (the revaluation model restates no salvage).
 */
export async function runBasisOf(asset: AssetRow): Promise<RunBasis> {
  const history = new Decimal(await assetAccumulated(asset.id));
  const last = await findLastPostedRevaluation(asset.id);
  if (last === undefined) {
    return { grossValue: asset.cost, accumulated: history.toFixed(4), revalued: false };
  }
  // oldAccum = the history side the revaluation restated FROM (P26-C's
  // frozen-delta reconstruction: newAccum − r, r = (newGross − cost) − delta).
  const oldAccum = revaluationOldAccumulated(
    asset.cost,
    last.newGrossValue,
    last.newAccumulated,
    last.delta,
  );
  const since = history.minus(new Decimal(oldAccum));
  const accumulated = new Decimal(last.newAccumulated).plus(since);
  return {
    grossValue: last.newGrossValue,
    accumulated: accumulated.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    revalued: true,
  };
}

// -- assembly (T6) --------------------------------------------------------------------

export interface AssembleRunInput {
  fiscalPeriodId: string;
  actorId: string | null;
  /**
   * Manual UNITS_OF_PRODUCTION usage per asset id (DR-002: no metering).
   * REQUIRED to cover every eligible UoP asset — missing entries reject with
   * UOP_UNITS_REQUIRED listing the assets; the workspace UI then collects
   * units and re-assembles.
   */
  unitsByAssetId?: Record<string, string>;
}

export interface AssembleRunOptions {
  /** Cancel probe — checked once per CHUNK (ADR-0008 bounded job). */
  shouldCancel?: () => boolean | Promise<boolean>;
  /**
   * recomputeDraftLine path: eligible UoP assets WITHOUT an existing line
   * default to "0" instead of rejecting (their observable state — excluded,
   * ZERO_AMOUNT — is unchanged until the user edits THEIR units).
   */
  defaultMissingUnitsToZero?: boolean;
}

export interface AssembleRunResult {
  run: DepreciationRunRow;
  lines: DepreciationLineRow[];
  excluded: ExcludedAsset[];
  /** Asset ids flipped ACTIVE → FULLY_DEPRECIATED by this assembly. */
  flippedToFullyDepreciated: string[];
  /** True when an existing DRAFT run was re-assembled (reset + recompute). */
  reusedDraft: boolean;
}

/** Assets per assembly chunk (pagination page + insert batch + cancel probe). */
export const DEPRECIATION_ASSEMBLY_CHUNK = 500;

/**
 * Depreciation assembly service (T6). Plain-callable inside the caller's
 * ambient tenant transaction (HTTP UoW or the job's withTenant scope) — a
 * failure anywhere rolls the whole assembly back (zero residue).
 */
export class DepreciationService {
  /**
   * Eligibility + validation pass for a period. Reads ACTIVE assets page-wise
   * (CHUNK), resolves categories + the three BR-041 purposes with per-key
   * caches, and classifies each asset:
   * - excluded  → not participating (month convention / status / floor) — listed;
   * - rejection → participating but invalid (BR-041 gap, data guard) — the
   *   CALLER must refuse the whole assembly (never silently skip);
   * - item      → cleared to depreciate.
   */
  async eligibleAssetsForPeriod(period: FiscalPeriodLike): Promise<EligibilityOutcome> {
    const categoryCache = new Map<string, AssetCategoryRow | undefined>();
    const purposeCache = new Map<string, boolean>();
    const resolves = async (purposeKey: string): Promise<boolean> => {
      const cached = purposeCache.get(purposeKey);
      if (cached !== undefined) return cached;
      const ok = (await findActivePurpose(purposeKey)) !== undefined;
      purposeCache.set(purposeKey, ok);
      return ok;
    };

    const items: EligibleWorkItem[] = [];
    const excluded: ExcludedAsset[] = [];
    const rejections: AssetRejection[] = [];
    const atFloor: Array<{ assetId: string; code: string }> = [];

    // Page through ACTIVE assets (listAssets defaults to LIMIT 50 — always
    // pass an explicit page; ordering by code keeps pages stable).
    let offset = 0;
    let page: AssetRow[] = [];
    do {
      page = await listAssets({
        status: "ACTIVE",
        limit: DEPRECIATION_ASSEMBLY_CHUNK,
        offset,
      });
      for (const asset of page) {
        const monthIndex = monthIndexOf(asset.acquisitionDate, period.startDate);
        if (monthIndex < 0) {
          excluded.push({
            assetId: asset.id,
            code: asset.code,
            reason: "BEFORE_ACQUISITION",
            detail: `period ${period.name} starts before acquisition ${asset.acquisitionDate}`,
          });
          continue;
        }
        if (monthIndex === 0) {
          excluded.push({
            assetId: asset.id,
            code: asset.code,
            reason: "ACQUISITION_MONTH",
            detail: `acquired ${asset.acquisitionDate} — the acquisition month does not depreciate (next-month convention)`,
          });
          continue;
        }

        // The run basis (DR-002 §4): revalued (gross, accumulated) when a
        // POSTED revaluation restates the asset, else the register row.
        const basis = await runBasisOf(asset);
        const base = new Decimal(basis.grossValue).minus(new Decimal(asset.salvageValue));
        const accumulated = new Decimal(basis.accumulated);
        if (accumulated.gt(base)) {
          rejections.push({
            assetId: asset.id,
            code: "NBV_FLOOR_VIOLATION",
            reason: `basis accumulated ${accumulated.toFixed(4)} exceeds the depreciable base ${base.toFixed(4)} (INV-023${basis.revalued ? "; revalued basis" : ""})`,
          });
          continue;
        }
        if (accumulated.gte(base)) {
          atFloor.push({ assetId: asset.id, code: asset.code });
          excluded.push({
            assetId: asset.id,
            code: asset.code,
            reason: "AT_FLOOR",
            detail: "accumulated already equals the basis gross − salvage",
          });
          continue;
        }

        // Participating asset → BR-041 category usability (all three
        // purposes resolve to active accounts) + kernel data guards.
        let category = categoryCache.get(asset.categoryId);
        if (category === undefined) {
          category = await findAssetCategoryById(asset.categoryId);
          categoryCache.set(asset.categoryId, category);
        }
        if (category === undefined) {
          rejections.push({
            assetId: asset.id,
            code: "CATEGORY_NOT_FOUND",
            reason: `category ${asset.categoryId} does not exist (deletion is forbidden — INV-015; data corruption)`,
          });
          continue;
        }
        if (!category.active) {
          rejections.push({
            assetId: asset.id,
            code: "CATEGORY_NOT_USABLE",
            reason: `category ${category.code} is deactivated (BR-041) — reactivate it or dispose the asset before running depreciation`,
          });
          continue;
        }
        const purposeGaps: string[] = [];
        for (const purposeKey of [
          category.assetPurposeKey,
          category.accumDepreciationPurposeKey,
          category.expensePurposeKey,
        ]) {
          if (!(await resolves(purposeKey))) purposeGaps.push(purposeKey);
        }
        if (purposeGaps.length > 0) {
          rejections.push({
            assetId: asset.id,
            code: "PURPOSE_NOT_MAPPED",
            reason: `category ${category.code} purposes without an active account (BR-041): ${purposeGaps.join(", ")}`,
          });
          continue;
        }
        if (!Number.isInteger(asset.usefulLifeMonths) || asset.usefulLifeMonths <= 0) {
          rejections.push({
            assetId: asset.id,
            code: "DEPRECIATION_ASSET_INVALID",
            reason: `useful_life_months must be a positive integer (got ${String(asset.usefulLifeMonths)})`,
          });
          continue;
        }
        if (
          asset.depreciationMethod === "UNITS_OF_PRODUCTION" &&
          (asset.totalEstimatedUnits === null ||
            !new Decimal(asset.totalEstimatedUnits).isPositive())
        ) {
          rejections.push({
            assetId: asset.id,
            code: "DEPRECIATION_ASSET_INVALID",
            reason: "UNITS_OF_PRODUCTION requires total_estimated_units > 0",
          });
          continue;
        }

        items.push({
          asset,
          category,
          basis,
          accumulatedBefore: accumulated.toFixed(4),
          base: base.toFixed(4),
          headroom: base.minus(accumulated).toFixed(4),
          monthIndex,
        });
      }
      offset += page.length;
    } while (page.length === DEPRECIATION_ASSEMBLY_CHUNK);

    items.sort((a, b) => (a.asset.code < b.asset.code ? -1 : a.asset.code > b.asset.code ? 1 : 0));
    return { items, excluded, rejections, atFloor };
  }

  /**
   * Create-or-reuse the DRAFT run for the period and assemble its lines.
   * One run per (tenant, fiscal period): a run in ANY status other than
   * DRAFT → 409 RunAlreadyExistsError; an existing DRAFT → reset + recompute
   * (re-assembly is the workspace loop). Rejects LOUDLY (whole assembly,
   * zero residue) on per-asset validation problems or missing UoP units.
   */
  async assembleRun(
    input: AssembleRunInput,
    options: AssembleRunOptions = {},
  ): Promise<AssembleRunResult> {
    const period = await findPeriodById(input.fiscalPeriodId);
    if (period === undefined) throw new PeriodNotFoundError(input.fiscalPeriodId);
    if (period.status === "LOCKED") {
      throw new PeriodLockedForRunError({
        runId: "(not created)",
        fiscalPeriodId: period.id,
        periodName: period.name,
        status: period.status,
      });
    }

    const existing = await findDepreciationRunByPeriod(input.fiscalPeriodId);
    if (existing !== undefined && existing.status !== "DRAFT") {
      throw new RunAlreadyExistsError({
        fiscalPeriodId: input.fiscalPeriodId,
        existingRunId: existing.id,
        status: existing.status,
      });
    }

    // Validation BEFORE any write (zero residue on rejection).
    const eligibility = await this.eligibleAssetsForPeriod(period);
    if (eligibility.rejections.length > 0) {
      throw new AssemblyValidationError(eligibility.rejections);
    }

    const invalidUnits: AssetRejection[] = [];
    const missingUnits: Array<{ assetId: string; code: string; totalEstimatedUnits: string }> = [];
    const unitsOf = (assetId: string): string | undefined =>
      input.unitsByAssetId === undefined ? undefined : input.unitsByAssetId[assetId];
    for (const item of eligibility.items) {
      if (item.asset.depreciationMethod !== "UNITS_OF_PRODUCTION") continue;
      const raw = unitsOf(item.asset.id);
      if (raw === undefined || raw === "") {
        if (options.defaultMissingUnitsToZero !== true) {
          missingUnits.push({
            assetId: item.asset.id,
            code: item.asset.code,
            totalEstimatedUnits: item.asset.totalEstimatedUnits ?? "0",
          });
        }
        continue;
      }
      if (!isValidUnitsInput(raw)) {
        invalidUnits.push({
          assetId: item.asset.id,
          code: "INVALID_UNITS",
          reason: `period units "${raw}" must be a non-negative decimal with ≤ 6dp`,
        });
      }
    }
    if (invalidUnits.length > 0) throw new AssemblyValidationError(invalidUnits);
    if (missingUnits.length > 0) throw new UoPUnitsRequiredError(missingUnits);

    let run: DepreciationRunRow;
    if (existing !== undefined) {
      run = existing;
    } else {
      try {
        run = await insertDepreciationRun({
          fiscalPeriodId: input.fiscalPeriodId,
          createdBy: input.actorId,
        });
      } catch (error) {
        // Concurrent same-period assembly lost the uq_depreciation_runs_
        // tenant_period race → converge on the winner's run (409 only when
        // the winner's run is not re-assemblable).
        if (!isUniqueViolation(error)) throw error;
        const racer = await findDepreciationRunByPeriod(input.fiscalPeriodId);
        if (racer === undefined) throw error;
        if (racer.status !== "DRAFT") {
          throw new RunAlreadyExistsError({
            fiscalPeriodId: input.fiscalPeriodId,
            existingRunId: racer.id,
            status: racer.status,
          });
        }
        run = racer;
      }
    }
    // Re-assembly reset (the single sanctioned DRAFT-only delete — a no-op
    // on a fresh run: it has no lines yet).
    await resetDraftRunLines(run.id);

    const cancelProbe = async (): Promise<void> => {
      if (options.shouldCancel !== undefined && (await options.shouldCancel())) {
        throw new AssemblyCancelledError(run.id);
      }
    };

    const inserted: DepreciationLineRow[] = [];
    const excluded = [...eligibility.excluded];
    let lineNo = 0;
    let total = new Decimal(0);

    for (let start = 0; start < eligibility.items.length; start += DEPRECIATION_ASSEMBLY_CHUNK) {
      await cancelProbe(); // ADR-0008: cancel flag checked per chunk
      const chunk = eligibility.items.slice(start, start + DEPRECIATION_ASSEMBLY_CHUNK);
      const batch: Array<{
        runId: string;
        assetId: string;
        lineNo: number;
        periodUnits: string | null;
        periodAmount: string;
        accumulatedAmount: string;
        createdBy: string | null;
      }> = [];
      for (const item of chunk) {
        const isUoP = item.asset.depreciationMethod === "UNITS_OF_PRODUCTION";
        const rawUnits = unitsOf(item.asset.id);
        const units = isUoP
          ? rawUnits !== undefined && rawUnits !== ""
            ? rawUnits
            : "0"
          : undefined;
        const context =
          isUoP === true
            ? {
                periodStartDate: period.startDate,
                cumulativeUnitsBefore: await this.cumulativePostedUnits(item.asset.id),
              }
            : { periodStartDate: period.startDate };
        // The kernel computes on the CURRENT basis (DR-002 §4): a POSTED
        // revaluation's gross replaces the register cost; salvage stays.
        const computed = computeMonthlyAmount(
          { ...item.asset, cost: item.basis.grossValue },
          item.accumulatedBefore,
          units,
          context,
        );
        if (computed.amount === "0.0000") {
          excluded.push({
            assetId: item.asset.id,
            code: item.asset.code,
            reason: "ZERO_AMOUNT",
            detail: isUoP === true ? `period units ${units}` : "formula rounds to 0.0000",
          });
          continue;
        }
        lineNo += 1;
        total = total.plus(new Decimal(computed.amount));
        batch.push({
          runId: run.id,
          assetId: item.asset.id,
          lineNo,
          periodUnits: isUoP === true ? (units ?? "0") : null,
          periodAmount: computed.amount,
          accumulatedAmount: round4(
            new Decimal(item.accumulatedBefore).plus(new Decimal(computed.amount)),
          ),
          createdBy: input.actorId,
        });
      }
      inserted.push(...(await insertDepreciationLines(batch)));
    }

    // Status hygiene: ACTIVE assets already at the floor flip now (they
    // dropped out of the run; the POST-time flip below covers assets that
    // REACH the floor via this run's lines).
    const flipped: string[] = [];
    for (const { assetId } of eligibility.atFloor) {
      const fresh = await findAssetById(assetId);
      if (fresh !== undefined && fresh.status === "ACTIVE") {
        await updateAsset(assetId, { status: "FULLY_DEPRECIATED" });
        flipped.push(assetId);
      }
    }

    const updated =
      (await updateDepreciationRun(run.id, {
        assetCount: lineNo,
        totalAmount: round4(total),
        assembledAt: new Date().toISOString(),
        assembledBy: input.actorId,
      })) ?? run;

    return {
      run: updated,
      lines: inserted,
      excluded,
      flippedToFullyDepreciated: flipped,
      reusedDraft: existing !== undefined,
    };
  }

  /**
   * Workspace edit path (DRAFT only): recompute the run with ONE asset's
   * UNITS_OF_PRODUCTION usage changed. depreciation_lines is append-only, so
   * the edit is a full DRAFT re-assembly: existing line units are preserved,
   * the target asset gets the new units, and eligible UoP assets without a
   * line default to 0 (their state is unchanged until edited). Non-UoP
   * targets are rejected — units are a UoP-only input.
   */
  async recomputeDraftLine(
    runId: string,
    assetId: string,
    periodUnits: string,
  ): Promise<AssembleRunResult> {
    const run = await findDepreciationRunById(runId);
    if (run === undefined) throw new DepreciationRunNotFoundError(runId);
    if (run.status !== "DRAFT") {
      throw new RunNotPostableError(
        `run ${runId} is ${run.status} — only a DRAFT run's lines can be re-computed`,
        { runId, status: run.status },
      );
    }
    const asset = await findAssetById(assetId);
    if (asset === undefined) throw new AssetNotFoundError(assetId);
    if (asset.depreciationMethod !== "UNITS_OF_PRODUCTION") {
      throw new AssemblyValidationError([
        {
          assetId,
          code: "NOT_UOP_ASSET",
          reason: `asset ${asset.code} uses ${asset.depreciationMethod} — period units apply to UNITS_OF_PRODUCTION assets only`,
        },
      ]);
    }
    if (!isValidUnitsInput(periodUnits)) {
      throw new AssemblyValidationError([
        {
          assetId,
          code: "INVALID_UNITS",
          reason: `period units "${periodUnits}" must be a non-negative decimal with ≤ 6dp`,
        },
      ]);
    }

    const unitsByAssetId: Record<string, string> = {};
    for (const line of await listDepreciationLinesByRun(run.id)) {
      if (line.periodUnits !== null) unitsByAssetId[line.assetId] = line.periodUnits;
    }
    unitsByAssetId[assetId] = periodUnits;

    return this.assembleRun(
      {
        fiscalPeriodId: run.fiscalPeriodId,
        actorId: run.assembledBy ?? run.createdBy,
        unitsByAssetId,
      },
      { defaultMissingUnitsToZero: true },
    );
  }

  /** UoP support: units consumed by POSTED, non-reversed lines (6dp exact). */
  async cumulativePostedUnits(assetId: string): Promise<string> {
    const lines = await listDepreciationLinesByAsset(assetId);
    let sum = new Decimal(0);
    for (const line of lines) {
      if (line.runStatus !== "POSTED" || line.reversedAt !== null) continue;
      if (line.periodUnits === null) continue;
      sum = sum.plus(new Decimal(line.periodUnits));
    }
    return sum.toFixed(6);
  }
}
