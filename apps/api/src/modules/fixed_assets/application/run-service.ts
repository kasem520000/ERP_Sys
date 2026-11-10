import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { PeriodNotFoundError } from "../../accounting/domain/accounting-errors";
import { alreadyReversed } from "../../accounting/domain/posting-engine/posting-errors";
import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";
import { PostingService } from "../../accounting/application/posting-service";
import { findPeriodById } from "../../accounting/infrastructure/accounting.store";
import { findEntryById } from "../../accounting/infrastructure/journal.store";
import { AuditService } from "../../audit/api/audit";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { runBasisOf } from "./depreciation-service";
import {
  type AssetCategoryRow,
  type AssetRow,
  type DepreciationRunRow,
  findAssetById,
  findAssetCategoryById,
  findDepreciationRunById,
  listDepreciationLinesByRun,
  listDepreciationRuns,
  updateAsset,
  updateDepreciationRun,
} from "../infrastructure/fixed-assets.store";
import {
  DepreciationRunNotFoundError,
  PeriodLockedForRunError,
  RunNotPostableError,
} from "./depreciation-errors";

/**
 * PHASE-026 T7 — depreciation-run post + reverse (P26-B).
 *
 * ── G-22 (POSTING_ENGINE §4.1 source registration: docType
 * `DEPRECIATION_RUN`, operation `post`; JOURNAL_RULES §7) ──
 * ONE journal per run: `DR DEPRECIATION_EXPENSE · CR ACCUM_DEPRECIATION`
 * on the CATEGORY accounts, LINES PER ASSET (per-asset DR/CR pairs keep the
 * entry balanced naturally: Σ DR = Σ CR = run total). Runs with more than
 * PER_ASSET_LINE_CAP (50) assets collapse the pairs per category (2 lines
 * per category — bounded journal size for 10k-asset tenants); the goldens
 * use ≤ 50 assets → per-asset lines. entryDate = the period's end_date with
 * the period passed EXPLICITLY (the engine re-validates status + window).
 *
 * ── Period lock (BR-042/INV-011) ──
 * LOCKED period → PERIOD_LOCKED failure pack (PeriodLockedForRunError wraps
 * the engine taxonomy shape). SOFT_CLOSED follows the engine's PC-02
 * policy: posting needs a reason — `softCloseReason` passes through to the
 * spec (the `accounting.periods.post_to_soft_closed` PERMISSION check is
 * the HTTP layer's duty, noted for the controller).
 *
 * ── Idempotency (INV-013) ──
 * `(tenant, DEPRECIATION_RUN, runId, post)` — a duplicate postRun on a
 * POSTED run returns the stored result as a replay (the ALREADY_POSTED
 * failure pack converges instead of erroring).
 *
 * ── Reversal (INV-014) ──
 * Engine-only counter-entry; the run keeps status POSTED and gains
 * reversal_journal_entry_id/reversed_at/reversal_reason; the append-only
 * lines stay for audit. The accumulated read model already excludes
 * reversed runs (store: `reversed_at IS NULL`), so assets whose floor-flip
 * this run caused are un-flipped back to ACTIVE when they drop below the
 * floor again (DISPOSED assets are never touched).
 */

/** Above this asset count the G-22 journal groups lines per category. */
export const PER_ASSET_LINE_CAP = 50;

export interface PostRunResult {
  run: DepreciationRunRow;
  journalEntryId: string;
  entryNo: string | null;
  idempotentReplay: boolean;
  /** Assets flipped ACTIVE → FULLY_DEPRECIATED by this post (floor reached). */
  flippedToFullyDepreciated: string[];
}

export interface ReverseRunResult {
  run: DepreciationRunRow;
  reversalJournalEntryId: string;
  entryNo: string | null;
}

export interface RunLineView {
  lineNo: number;
  assetId: string;
  assetCode: string;
  assetName: string;
  assetNameAr: string;
  categoryCode: string;
  categoryName: string;
  method: string;
  periodUnits: string | null;
  periodAmount: string;
  accumulatedAmount: string;
  cost: string;
  salvageValue: string;
  /** Live accumulated (POSTED, non-reversed runs + opening). */
  accumulatedToDate: string;
  /** NBV after this run posts (DRAFT) / after it posted (POSTED). */
  projectedNbv: string;
}

export interface RunWorkspace {
  run: DepreciationRunRow;
  period: {
    id: string;
    name: string;
    kind: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  lines: RunLineView[];
  totals: { assetCount: number; totalAmount: string };
}

@Injectable()
export class RunService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  // -- read models ------------------------------------------------------------------

  /** Run list for the workspace index (period names joined in memory). */
  async listRuns(
    filter: { status?: string; limit?: number } = {},
  ): Promise<
    Array<DepreciationRunRow & { periodName: string | null; periodStatus: string | null }>
  > {
    const runs = await listDepreciationRuns(filter);
    const periodNames = new Map<string, { name: string; status: string }>();
    return Promise.all(
      runs.map(async (run) => {
        let info = periodNames.get(run.fiscalPeriodId);
        if (info === undefined) {
          const period = await findPeriodById(run.fiscalPeriodId);
          info =
            period === undefined
              ? { name: "—", status: "UNKNOWN" }
              : { name: period.name, status: period.status };
          periodNames.set(run.fiscalPeriodId, info);
        }
        return { ...run, periodName: info.name, periodStatus: info.status };
      }),
    );
  }

  /** The run + its period (detail header). */
  async getRun(runId: string): Promise<RunWorkspace["run"] & { period: RunWorkspace["period"] }> {
    const run = await findDepreciationRunById(runId);
    if (run === undefined) throw new DepreciationRunNotFoundError(runId);
    const period = await findPeriodById(run.fiscalPeriodId);
    if (period === undefined) throw new PeriodNotFoundError(run.fiscalPeriodId);
    return {
      ...run,
      period: {
        id: period.id,
        name: period.name,
        kind: period.kind,
        startDate: period.startDate,
        endDate: period.endDate,
        status: period.status,
      },
    };
  }

  /**
   * The run workspace (PAGE_ARCHETYPES §4): run + per-line asset/category
   * context + live NBV preview for the MoneySummaryBar. Read-only on
   * persisted state — the assembly/recompute responses (and the
   * UOP_UNITS_REQUIRED / DEPRECIATION_ASSEMBLY_REJECTED payloads) carry the
   * excluded-asset lists.
   */
  async getRunWorkspace(runId: string): Promise<RunWorkspace> {
    const run = await findDepreciationRunById(runId);
    if (run === undefined) throw new DepreciationRunNotFoundError(runId);
    const period = await findPeriodById(run.fiscalPeriodId);
    if (period === undefined) throw new PeriodNotFoundError(run.fiscalPeriodId);

    const assetCache = new Map<string, AssetRow>();
    const categoryCache = new Map<string, AssetCategoryRow>();
    const lines = await listDepreciationLinesByRun(run.id);
    const views: RunLineView[] = [];
    for (const line of lines) {
      let asset = assetCache.get(line.assetId);
      if (asset === undefined) {
        asset = await findAssetById(line.assetId);
        if (asset === undefined) continue; // orphaned line (FK makes this unreachable)
        assetCache.set(asset.id, asset);
      }
      let category = categoryCache.get(asset.categoryId);
      if (category === undefined) {
        category = await findAssetCategoryById(asset.categoryId);
        if (category !== undefined) categoryCache.set(category.id, category);
      }
      // Live preview on the CURRENT basis (DR-002 §4 — revalued gross when
      // one is posted; basis accumulated includes post-reval posted lines).
      const basis = await runBasisOf(asset);
      const accumulatedToDate = basis.accumulated;
      const gross = new Decimal(basis.grossValue);
      const projected =
        run.status === "DRAFT"
          ? gross.minus(new Decimal(accumulatedToDate)).minus(new Decimal(line.periodAmount))
          : gross.minus(new Decimal(accumulatedToDate));
      views.push({
        lineNo: line.lineNo,
        assetId: line.assetId,
        assetCode: asset.code,
        assetName: asset.name,
        assetNameAr: asset.nameAr,
        categoryCode: category?.code ?? "?",
        categoryName: category?.name ?? "?",
        method: asset.depreciationMethod,
        periodUnits: line.periodUnits,
        periodAmount: line.periodAmount,
        accumulatedAmount: line.accumulatedAmount,
        cost: asset.cost,
        salvageValue: asset.salvageValue,
        accumulatedToDate,
        projectedNbv: projected.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      });
    }
    return {
      run,
      period: {
        id: period.id,
        name: period.name,
        kind: period.kind,
        startDate: period.startDate,
        endDate: period.endDate,
        status: period.status,
      },
      lines: views,
      totals: { assetCount: run.assetCount, totalAmount: run.totalAmount },
    };
  }

  // -- post (G-22) --------------------------------------------------------------------

  /**
   * Post the assembled DRAFT run as the G-22 journal (one journal per run).
   * Duplicate posts replay the stored result (INV-013). After the entry
   * lands: run → POSTED (+ posted_at/by + journal_entry_id), and every line
   * asset that reached the cost − salvage floor flips FULLY_DEPRECIATED
   * (INV-023 — only ACTIVE assets flip; a concurrently-disposed asset keeps
   * its DISPOSED lock).
   */
  async postRun(input: {
    runId: string;
    actorId: string | null;
    /** PC-02: required when the period is SOFT_CLOSED (permission at the route). */
    softCloseReason?: string;
  }): Promise<PostRunResult> {
    const run = await findDepreciationRunById(input.runId);
    if (run === undefined) throw new DepreciationRunNotFoundError(input.runId);

    // INV-013 replay: a POSTED run (incl. a reversed one — the original
    // entry is the stored result) returns instead of re-posting.
    if (run.status === "POSTED" && run.journalEntryId !== null) {
      const entry = await findEntryById(run.journalEntryId);
      return {
        run,
        journalEntryId: run.journalEntryId,
        entryNo: entry?.entryNo ?? null,
        idempotentReplay: true,
        flippedToFullyDepreciated: [],
      };
    }

    const lines = await listDepreciationLinesByRun(run.id);
    if (run.assembledAt === null || lines.length === 0) {
      throw new RunNotPostableError(
        `run ${input.runId} is not postable — assemble it first (assembled ${
          run.assembledAt === null ? "never" : run.assembledAt
        }, ${String(lines.length)} line(s); an empty run has no journal to post)`,
        { runId: input.runId, assembledAt: run.assembledAt, lineCount: lines.length },
      );
    }

    const period = await findPeriodById(run.fiscalPeriodId);
    if (period === undefined) throw new PeriodNotFoundError(run.fiscalPeriodId);
    if (period.status === "LOCKED") {
      throw new PeriodLockedForRunError({
        runId: run.id,
        fiscalPeriodId: period.id,
        periodName: period.name,
        status: period.status,
      });
    }
    if (period.status === "SOFT_CLOSED" && input.softCloseReason === undefined) {
      // PC-02 (engine policy): soft-closed posting needs the reason; the
      // permission (`accounting.periods.post_to_soft_closed`) is checked at
      // the route — mirrored here so the failure pack shape matches.
      throw new PeriodLockedForRunError({
        runId: run.id,
        fiscalPeriodId: period.id,
        periodName: period.name,
        status: period.status,
      });
    }

    // Line context (assets + categories) for the per-asset G-22 pairs.
    const assetCache = new Map<string, AssetRow>();
    const categoryCache = new Map<string, AssetCategoryRow>();
    const contextOf = async (
      assetId: string,
    ): Promise<{ asset: AssetRow; category: AssetCategoryRow } | undefined> => {
      let asset = assetCache.get(assetId);
      if (asset === undefined) {
        asset = await findAssetById(assetId);
        if (asset === undefined) return undefined;
        assetCache.set(assetId, asset);
      }
      let category = categoryCache.get(asset.categoryId);
      if (category === undefined) {
        category = await findAssetCategoryById(asset.categoryId);
        if (category === undefined) return undefined;
        categoryCache.set(category.id, category);
      }
      return { asset, category };
    };

    const journalLines: JournalLineSpec[] = [];
    if (lines.length <= PER_ASSET_LINE_CAP) {
      // G-22 canonical shape: lines per asset (DR expense · CR accum per
      // asset, on the category accounts — balanced by construction).
      for (const line of lines) {
        const context = await contextOf(line.assetId);
        if (context === undefined) {
          throw new RunNotPostableError(
            `run ${input.runId} line ${String(line.lineNo)} references a missing asset/category — data corruption`,
            { runId: input.runId, assetId: line.assetId },
          );
        }
        journalLines.push({
          purpose: context.category.expensePurposeKey,
          direction: "DEBIT",
          amount: line.periodAmount,
          memo: {
            en: `Depreciation — ${context.asset.code} ${context.asset.name} (${period.name})`,
            ar: `إهلاك — ${context.asset.code} ${context.asset.nameAr} (${period.name})`,
          },
        });
        journalLines.push({
          purpose: context.category.accumDepreciationPurposeKey,
          direction: "CREDIT",
          amount: line.periodAmount,
          memo: {
            en: `Accumulated depreciation — ${context.asset.code} (${period.name})`,
            ar: `مجمع الإهلاك — ${context.asset.code} (${period.name})`,
          },
        });
      }
    } else {
      // Bounded journal for large runs: per-category aggregated pairs.
      const perCategory = new Map<
        string,
        { category: AssetCategoryRow; total: Decimal; assets: number }
      >();
      for (const line of lines) {
        const context = await contextOf(line.assetId);
        if (context === undefined) {
          throw new RunNotPostableError(
            `run ${input.runId} line ${String(line.lineNo)} references a missing asset/category — data corruption`,
            { runId: input.runId, assetId: line.assetId },
          );
        }
        const entry = perCategory.get(context.category.id);
        if (entry === undefined) {
          perCategory.set(context.category.id, {
            category: context.category,
            total: new Decimal(line.periodAmount),
            assets: 1,
          });
        } else {
          entry.total = entry.total.plus(new Decimal(line.periodAmount));
          entry.assets += 1;
        }
      }
      const grouped = [...perCategory.values()].sort((a, b) =>
        a.category.code < b.category.code ? -1 : a.category.code > b.category.code ? 1 : 0,
      );
      for (const group of grouped) {
        const amount = group.total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
        journalLines.push({
          purpose: group.category.expensePurposeKey,
          direction: "DEBIT",
          amount,
          memo: {
            en: `Depreciation — ${group.category.code} (${String(group.assets)} assets, ${period.name})`,
            ar: `إهلاك — ${group.category.code} (${String(group.assets)} أصلًا، ${period.name})`,
          },
        });
        journalLines.push({
          purpose: group.category.accumDepreciationPurposeKey,
          direction: "CREDIT",
          amount,
          memo: {
            en: `Accumulated depreciation — ${group.category.code} (${period.name})`,
            ar: `مجمع الإهلاك — ${group.category.code} (${period.name})`,
          },
        });
      }
    }

    const spec: JournalSpec = {
      source: { docType: "depreciation_run", docId: run.id, operation: "post" },
      entryDate: period.endDate,
      fiscalPeriodId: period.id,
      description: {
        en: `Depreciation run ${period.name} — ${String(run.assetCount)} asset(s)`,
        ar: `قسط الإهلاك ${period.name} — ${String(run.assetCount)} أصلًا`,
      },
      currency: await ownTenantBaseCurrency(),
      lines: journalLines,
      ...(input.softCloseReason !== undefined ? { softCloseReason: input.softCloseReason } : {}),
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    const posted =
      (await updateDepreciationRun(run.id, {
        status: "POSTED",
        postedAt: new Date().toISOString(),
        postedBy: input.actorId,
        journalEntryId: result.journalEntryId,
      })) ?? run;

    // INV-023 floor flips (AFTER the run is POSTED so the accumulated read
    // model includes it; only ACTIVE assets flip — disposal locks win). The
    // floor is the CURRENT basis (DR-002 §4 — a revalued gross moves it).
    const flipped: string[] = [];
    for (const line of lines) {
      const asset = assetCache.get(line.assetId);
      if (asset === undefined || asset.status !== "ACTIVE") continue;
      const basis = await runBasisOf(asset);
      const base = new Decimal(basis.grossValue).minus(new Decimal(asset.salvageValue));
      const accumulated = new Decimal(basis.accumulated);
      if (accumulated.gte(base)) {
        await updateAsset(line.assetId, { status: "FULLY_DEPRECIATED" });
        flipped.push(line.assetId);
      }
    }

    await this.audit.record({
      action: "fixed_assets.depreciation_run_posted",
      entityType: "depreciation_run",
      entityId: run.id,
      actorId: input.actorId ?? undefined,
      before: { status: "DRAFT" },
      after: {
        status: "POSTED",
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        periodId: period.id,
        assetCount: run.assetCount,
        totalAmount: run.totalAmount,
        fullyDepreciatedAssets: flipped,
        idempotentReplay: result.idempotentReplay,
      },
    });

    return {
      run: posted,
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      idempotentReplay: result.idempotentReplay,
      flippedToFullyDepreciated: flipped,
    };
  }

  // -- reverse (INV-014) ----------------------------------------------------------------

  /**
   * Reverse a POSTED run through the engine (counter-entry; at most one
   * reversal). The counter-entry lands in the run's own period while it is
   * still OPEN (same-date reversal, entryDate = period end), else TODAY (an
   * OPEN current period is required — ReversalInput carries no soft-close
   * reason, so SOFT_CLOSED originals fall to today per the engine's rule).
   * Assets this run had flipped to the floor drop back to ACTIVE when their
   * live accumulated falls below cost − salvage again; the append-only
   * lines stay for audit.
   */
  async reverseRun(input: {
    runId: string;
    actorId: string | null;
    reason: string;
  }): Promise<ReverseRunResult> {
    const run = await findDepreciationRunById(input.runId);
    if (run === undefined) throw new DepreciationRunNotFoundError(input.runId);
    if (run.status !== "POSTED") {
      throw new RunNotPostableError(
        `run ${input.runId} is ${run.status} — only a POSTED run can be reversed`,
        { runId: input.runId, status: run.status },
      );
    }
    if (run.journalEntryId === null) {
      throw new RunNotPostableError(
        `run ${input.runId} has no journal entry to reverse — data corruption`,
        { runId: input.runId },
      );
    }
    if (run.reversedAt !== null || run.reversalJournalEntryId !== null) {
      throw alreadyReversed({ entryId: run.journalEntryId });
    }
    const reason = input.reason.trim();
    if (reason === "") {
      throw new RunNotPostableError("a reversal reason is required (INV-014 audit)", {
        runId: input.runId,
      });
    }

    const period = await findPeriodById(run.fiscalPeriodId);
    if (period === undefined) throw new PeriodNotFoundError(run.fiscalPeriodId);
    const today = new Date().toISOString().slice(0, 10); // wall clock (no float math)
    const samePeriodDate = period.endDate <= today ? period.endDate : today;
    const entryDate = period.status === "OPEN" ? samePeriodDate : today;

    const result = await this.posting.reverse(
      { originalEntryId: run.journalEntryId, entryDate, reason },
      { reversedBy: input.actorId },
    );

    const reversed =
      (await updateDepreciationRun(run.id, {
        reversalJournalEntryId: result.journalEntryId,
        reversedAt: new Date().toISOString(),
        reversalReason: reason,
      })) ?? run;

    // Un-flip floor hits this run caused: the accumulated read model now
    // excludes the reversed run, so assets below the floor return to ACTIVE
    // (DISPOSED/WRITTEN_OFF are never touched; FULLY_DEPRECIATED assets that
    // are still at the floor stay). The floor is the CURRENT basis (DR-002).
    const lines = await listDepreciationLinesByRun(run.id);
    const unflipped: string[] = [];
    const seen = new Set<string>();
    for (const line of lines) {
      if (seen.has(line.assetId)) continue;
      seen.add(line.assetId);
      const asset = await findAssetById(line.assetId);
      if (asset === undefined || asset.status !== "FULLY_DEPRECIATED") continue;
      const basis = await runBasisOf(asset);
      const base = new Decimal(basis.grossValue).minus(new Decimal(asset.salvageValue));
      const accumulated = new Decimal(basis.accumulated);
      if (accumulated.lt(base)) {
        await updateAsset(line.assetId, { status: "ACTIVE" });
        unflipped.push(line.assetId);
      }
    }

    await this.audit.record({
      action: "fixed_assets.depreciation_run_reversed",
      entityType: "depreciation_run",
      entityId: run.id,
      actorId: input.actorId ?? undefined,
      before: { status: run.status, journalEntryId: run.journalEntryId },
      after: {
        status: run.status,
        reversalJournalEntryId: result.journalEntryId,
        reason,
        reactivatedAssets: unflipped,
      },
    });

    return {
      run: reversed,
      reversalJournalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
    };
  }
}
