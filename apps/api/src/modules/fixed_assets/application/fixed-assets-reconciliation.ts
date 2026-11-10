import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import { findActivePurpose } from "../../accounting/infrastructure/accounting.store";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import type { ChecklistItem } from "../../accounting/application/reconciliation-service";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import * as store from "../infrastructure/fixed-assets.store";

/**
 * Fixed-assets register↔GL reconciliation (PHASE-026 T10; RECONCILIATION.md
 * §1 row 10 — "deferred" until this check activates it; the RC-09/WIP
 * registration pattern): per category account, the REGISTER derived from
 * source rows must equal the GL balance of the mapped purpose accounts —
 * exact, ZERO tolerance (RECONCILIATION §2). The run registers INTO the
 * PHASE-007 framework (reconciliation_runs, kind `FIXED_ASSETS`) exactly
 * like purchasing's GRNI (RC-09) and manufacturing's WIP check: this module
 * writes the run row; the framework (latestRuns + the close checklist +
 * PC-04) reads it. A BROKEN run records the diff row(s), fires the audit
 * event + the critical inbox notification (category `reconciliation`,
 * RISK-009 Sev-1), and blocks the period LOCK via the framework's
 * assertCoreChecksGreen — see the orchestrator wiring note in the P26-C
 * report (accounting's kind list must gain FIXED_ASSETS).
 *
 * THE ALGEBRA (both sides derived from source rows — NEVER from the NBV read
 * model; every term below is a signed canonical 4dp string):
 *
 * Per asset a with register row cost C_a, opening O_a, live posted
 * non-reversed depreciation lines L_a (store.assetAccumulated = O_a + L_a),
 * posted revaluations {newGross_i, delta_i}, and disposal state:
 *
 *   FIXED_ASSET account (category asset_purpose_key) receives:
 *     + C_a            (G-21 capitalization debit)
 *     + Σ_i g_i        (revaluation gross legs, g_i = newGross_i − C_a)
 *     − C_a            (G-23 disposal credit — ONLY when the asset is
 *                      DISPOSED: disposal derecognizes the RAW cost basis)
 *   ⇒ expected FA contribution = (DISPOSED ? 0 : C_a) + Σ_i (newGross_i − C_a)
 *
 *   ACCUM_DEPRECIATION account (category accum_depreciation_purpose_key):
 *     + O_a            (G-21 OPENING variant credit)
 *     + L_a            (G-22 run credits, live = non-reversed POSTED runs)
 *     + Σ_i r_i        (revaluation accum restatements,
 *                      r_i = (newGross_i − C_a) − delta_i — reconstructed
 *                      from the FROZEN row values; see current-basis.ts)
 *     − accumSnapshot  (G-23 disposal debit — ONLY when DISPOSED; the frozen
 *                      snapshot equals the live O_a + L_a because a disposed
 *                      asset is locked and drops out of runs)
 *   ⇒ expected accum contribution = (DISPOSED ? 0 : O_a + L_a) + Σ_i r_i
 *
 * The DISPOSED asset's remaining contribution {Σ g_i on FA, Σ r_i on ACCUM}
 * is the no-recycling residue: DR-002 keeps revaluation balances on the
 * reserve at disposal (IFRS-style recycling is explicitly out of scope) —
 * the residue nets to zero against REVALUATION_RESERVE (g − r − delta = 0).
 *
 * Both sides therefore tie BY CONSTRUCTION after every module operation
 * (capitalization, run, revaluation, disposal) — the check's value is
 * catching EXTERNAL drift: a manual journal hitting a FA-purpose account, a
 * register row written without its journal, or a purpose remapped mid-life.
 *
 * Semantics: LIVE (as-of-now) on both sides — the AR-check precedent (the
 * framework's own core check reads controlAccountBalance with no as-of
 * window): the register fold and the GL read both reflect all posted
 * history, so there are no temporal edge cases; input.asOf is recorded on
 * the run row for the framework's latest-run gate. (Deterministic as-of
 * reconstruction for reports is P26-D territory — the as-of contracts.)
 */

/** The PHASE-007 framework run kind. ORCHESTRATOR NOTE (P26-C report): the
 * `reconciliation_runs.kind` CHECK (ck_reconciliation_runs_kind_values,
 * migration 0011 as widened by 0012) does NOT yet include FIXED_ASSETS — a
 * one-statement widening migration must land before the DB gate. */
export const FIXED_ASSETS_CHECK_KIND = "FIXED_ASSETS";

/** One scan page for the register fold (listAssets caps at the caller's
 * limit): 1M rows covers the 10k-asset design tenant an order of magnitude
 * over; a paginated fold is the production-scale follow-up (honest marker —
 * the nightly job's N per-asset reads are index-backed at this scale). */
const REGISTER_SCAN_LIMIT = 1_000_000;

/** Canonical 4dp normalization for GL text reads (the purchasing-check
 * precedent; exact — no Math.*). */
function money4(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

// -- the pure register fold (exported for the golden suite) --------------------------

export interface RegisterFoldCategory {
  id: string;
  code: string;
  assetPurposeKey: string;
  accumDepreciationPurposeKey: string;
}

export interface RegisterFoldAsset {
  id: string;
  categoryId: string;
  cost: string;
  status: string;
  /** The live accumulated read model (opening + Σ posted non-reversed lines). */
  accumulated: string;
}

/** POSTED revaluations only. */
export interface RegisterFoldRevaluation {
  assetId: string;
  newGrossValue: string;
  delta: string;
}

export interface RegisterExpectedSide {
  purposeKey: string;
  side: "FIXED_ASSET" | "ACCUM_DEPRECIATION";
  expected: string;
  /** Category codes contributing to this side (categories may share an
   * account through a common purpose key — the GL is per ACCOUNT). */
  categories: string[];
}

/**
 * The pure fold: per (purpose key × side), the expected GL contribution of
 * the register. Assets are matched to categories by categoryId; revaluations
 * by assetId (POSTED rows only — the caller filters). Signed accumulation:
 * a downward revaluation contributes a negative restatement.
 */
export function registerExpectedSides(input: {
  categories: readonly RegisterFoldCategory[];
  assets: readonly RegisterFoldAsset[];
  revaluations: readonly RegisterFoldRevaluation[];
}): RegisterExpectedSide[] {
  const categoryById = new Map(input.categories.map((c) => [c.id, c] as const));
  interface Acc {
    fa: string;
    accum: string;
    categories: Set<string>;
  }
  const byFaPurpose = new Map<string, Acc>();
  const byAccumPurpose = new Map<string, Acc>();
  const faBucket = (key: string): Acc => {
    let bucket = byFaPurpose.get(key);
    if (bucket === undefined) {
      bucket = { fa: "0", accum: "0", categories: new Set() };
      byFaPurpose.set(key, bucket);
    }
    return bucket;
  };
  const accumBucket = (key: string): Acc => {
    let bucket = byAccumPurpose.get(key);
    if (bucket === undefined) {
      bucket = { fa: "0", accum: "0", categories: new Set() };
      byAccumPurpose.set(key, bucket);
    }
    return bucket;
  };

  const revalsByAsset = new Map<string, RegisterFoldRevaluation[]>();
  for (const rv of input.revaluations) {
    const list = revalsByAsset.get(rv.assetId);
    if (list === undefined) revalsByAsset.set(rv.assetId, [rv]);
    else list.push(rv);
  }

  for (const asset of input.assets) {
    const category = categoryById.get(asset.categoryId);
    if (category === undefined) continue; // orphan asset without a category — impossible via the service gates
    const fa = faBucket(category.assetPurposeKey);
    const accum = accumBucket(category.accumDepreciationPurposeKey);
    fa.categories.add(category.code);
    accum.categories.add(category.code);
    const disposed = asset.status === "DISPOSED" || asset.status === "WRITTEN_OFF";
    // G-21 basis leaves with the disposal; the revaluation residue stays.
    if (!disposed) {
      fa.fa = addExact(fa.fa, asset.cost);
      accum.accum = addExact(accum.accum, asset.accumulated);
    }
    for (const rv of revalsByAsset.get(asset.id) ?? []) {
      const g = subExact(rv.newGrossValue, asset.cost);
      const r = subExact(g, rv.delta);
      fa.fa = addExact(fa.fa, g);
      accum.accum = addExact(accum.accum, r);
    }
  }

  const sides: RegisterExpectedSide[] = [];
  for (const [purposeKey, bucket] of byFaPurpose) {
    sides.push({
      purposeKey,
      side: "FIXED_ASSET",
      expected: money4(bucket.fa),
      categories: [...bucket.categories].sort(),
    });
  }
  for (const [purposeKey, bucket] of byAccumPurpose) {
    sides.push({
      purposeKey,
      side: "ACCUM_DEPRECIATION",
      expected: money4(bucket.accum),
      categories: [...bucket.categories].sort(),
    });
  }
  return sides;
}

// -- the RC-10 check service ----------------------------------------------------------

/** One offending row in a BROKEN run's diff (category/account/expected/actual). */
export interface FaReconciliationDiffRow {
  side: "FIXED_ASSET" | "ACCUM_DEPRECIATION";
  purposeKey: string;
  accountCode: string | null;
  categories: string[];
  expected: string;
  actual: string | null;
  diff: string;
  note?: string;
}

@Injectable()
export class FixedAssetsReconciliationService {
  constructor(
    // Explicit @Inject on every param (the vitest/esbuild design:paramtypes
    // precedent — see the WIP service note).
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  /**
   * RC-10: the register↔GL check. Read-only analysis — the only writes are
   * the reconciliation_runs row, the audit event, and the notification
   * (never a journal; drift is fixed by additive documents,
   * RECONCILIATION §3.2).
   */
  async runFixedAssetsCheck(input: {
    asOf: string;
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }): Promise<journalStore.ReconciliationRunRow> {
    const categories = await store.listAssetCategories({});
    if (categories.length === 0) {
      // Nothing maps — the AR unmapped-purpose precedent: an OK run with
      // zero counts (the checklist renders NOT_APPLICABLE from the diff).
      return journalStore.insertReconciliationRun({
        kind: FIXED_ASSETS_CHECK_KIND,
        asOf: input.asOf,
        status: "OK",
        controlBalance: "0.0000",
        subledgerBalance: "0.0000",
        diffCount: 0,
        diff: { categories: 0, assets: 0, accounts: 0, note: "no asset categories — nothing to reconcile" },
        runMode: input.runMode,
        checkedBy: input.checkedBy,
      });
    }

    const assets = await store.listAssets({ limit: REGISTER_SCAN_LIMIT });
    const revaluations: RegisterFoldRevaluation[] = [];
    const accumulatedById = new Map<string, string>();
    for (const asset of assets) {
      accumulatedById.set(asset.id, await store.assetAccumulated(asset.id));
      for (const rv of await store.listAssetRevaluationsByAsset(asset.id)) {
        if (rv.status === "POSTED") {
          revaluations.push({ assetId: asset.id, newGrossValue: rv.newGrossValue, delta: rv.delta });
        }
      }
    }

    const expectedSides = registerExpectedSides({
      categories: categories.map((c) => ({
        id: c.id,
        code: c.code,
        assetPurposeKey: c.assetPurposeKey,
        accumDepreciationPurposeKey: c.accumDepreciationPurposeKey,
      })),
      assets: assets.map((a) => ({
        id: a.id,
        categoryId: a.categoryId,
        cost: a.cost,
        status: a.status,
        accumulated: accumulatedById.get(a.id) ?? "0",
      })),
      revaluations,
    });

    // Resolve each purpose key to its ACTIVE account (≤1 per key — the CoA
    // purpose-mapping uniqueness) and read the GL balance; unmapped keys
    // with a nonzero expected side are drift (register without GL).
    const rows: FaReconciliationDiffRow[] = [];
    let controlTotal = "0";
    let subledgerTotal = "0";
    let accounts = 0;
    for (const side of expectedSides) {
      const mapping = await findActivePurpose(side.purposeKey);
      if (mapping === undefined) {
        if (compareExact(side.expected, "0") !== 0) {
          rows.push({
            side: side.side,
            purposeKey: side.purposeKey,
            accountCode: null,
            categories: side.categories,
            expected: side.expected,
            actual: null,
            diff: side.expected,
            note: "purpose not mapped — register value exists with no GL account (BR-041 violation)",
          });
          subledgerTotal = addExact(subledgerTotal, side.expected);
        }
        continue;
      }
      accounts += 1;
      const actual = money4(await journalStore.controlAccountBalance(mapping.accountId));
      controlTotal = addExact(controlTotal, actual);
      subledgerTotal = addExact(subledgerTotal, side.expected);
      if (compareExact(actual, side.expected) !== 0) {
        rows.push({
          side: side.side,
          purposeKey: side.purposeKey,
          accountCode: mapping.accountCode ?? null,
          categories: side.categories,
          expected: side.expected,
          actual,
          diff: money4(subExact(actual, side.expected)),
        });
      }
    }
    // GL drift with NO register side at all (a purpose mapped, its account
    // carrying a balance, but no assets registered under any category using
    // that key): expected 0 vs the live account — surfaced per key/side.
    const seenPurposeKeys = new Map(expectedSides.map((side) => [side.purposeKey, side.side] as const));
    const categoryPurposeSides = new Map<string, "FIXED_ASSET" | "ACCUM_DEPRECIATION">();
    for (const category of categories) {
      categoryPurposeSides.set(category.assetPurposeKey, "FIXED_ASSET");
      categoryPurposeSides.set(category.accumDepreciationPurposeKey, "ACCUM_DEPRECIATION");
    }
    for (const [purposeKey, side] of categoryPurposeSides) {
      if (seenPurposeKeys.has(purposeKey)) continue;
      const mapping = await findActivePurpose(purposeKey);
      if (mapping === undefined) continue;
      const actual = money4(await journalStore.controlAccountBalance(mapping.accountId));
      if (compareExact(actual, "0") !== 0) {
        accounts += 1;
        controlTotal = addExact(controlTotal, actual);
        rows.push({
          side,
          purposeKey,
          accountCode: mapping.accountCode ?? null,
          categories: [],
          expected: "0.0000",
          actual,
          diff: actual,
          note: "GL balance with no register side — external journals on a fixed-asset purpose account",
        });
      }
    }

    const status = rows.length > 0 ? "BROKEN" : "OK";
    const run = await journalStore.insertReconciliationRun({
      kind: FIXED_ASSETS_CHECK_KIND,
      asOf: input.asOf,
      status,
      controlBalance: money4(controlTotal),
      subledgerBalance: money4(subledgerTotal),
      diffCount: rows.length,
      diff: {
        categories: categories.length,
        assets: assets.length,
        accounts,
        rows,
      },
      runMode: input.runMode,
      checkedBy: input.checkedBy,
    });
    if (status === "BROKEN") {
      // The notification record: the audit event carries the diff (the
      // durable, assertable surface) and the inbox row surfaces it
      // (category reconciliation, severity critical — RISK-009 Sev-1).
      await this.audit.record({
        action: "fixed_assets.reconciliation_broken",
        entityType: "reconciliation_run",
        entityId: run.id,
        actorId: input.checkedBy ?? undefined,
        after: {
          kind: FIXED_ASSETS_CHECK_KIND,
          controlBalance: run.controlBalance,
          subledgerBalance: run.subledgerBalance,
          diffCount: run.diffCount,
          rows,
        },
      });
      await this.inbox.record({
        category: "reconciliation",
        severity: "critical",
        title: {
          en: "Fixed-assets reconciliation broken",
          ar: "انكسار مطابقة الأصول الثابتة",
        },
        body: {
          en: `The fixed-asset register no longer ties to the FIXED_ASSET/ACCUM_DEPRECIATION accounts as of ${input.asOf} (register ${run.subledgerBalance} vs GL ${run.controlBalance}, ${rows.length} row(s)) — investigate before the period lock.`,
          ar: `لم يعد سجل الأصول الثابتة مطابقًا لحسابات الأصول والإهلاك المتراكم كما في ${input.asOf} (السجل ${run.subledgerBalance} مقابل الأستاذ ${run.controlBalance}، ${rows.length} صف/صفوف) — يرجى التحقق قبل إقفال الفترة.`,
        },
        actionUrl: "/fixed-assets",
        dedupeKey: `fa-reconciliation-broken:${run.id}`,
      });
    }
    return run;
  }
}

// -- close-checklist rows (PERIOD_CLOSING §2; accounting wires these — see
//    the orchestrator note in the P26-C report) ---------------------------------------

/** RC-10 checklist row from the latest run (mirrors the GRNI/WIP item
 * shape in accounting's closeChecklist). */
export function fixedAssetsCheckItem(
  run?: journalStore.ReconciliationRunRow,
): ChecklistItem {
  if (run === undefined) {
    return {
      key: "reconciliation.fixed_assets",
      label: {
        en: "Fixed-asset register reconciled (RC-10)",
        ar: "مطابقة سجل الأصول الثابتة (RC-10)",
      },
      state: "NOT_RUN",
      detail: "fixed-assets RC-10 check not run yet (POST /fixed-assets/reconciliation/fa-check)",
    };
  }
  const diff = run.diff as { categories?: number; assets?: number } | null;
  const label = {
    en: "Fixed-asset register reconciled (RC-10)",
    ar: "مطابقة سجل الأصول الثابتة (RC-10)",
  };
  if (run.status === "OK" && ((diff?.assets ?? 0) === 0 || (diff?.categories ?? 0) === 0)) {
    return {
      key: "reconciliation.fixed_assets",
      label,
      state: "NOT_APPLICABLE",
      detail: "no fixed-asset activity — nothing to reconcile",
    };
  }
  if (run.status === "OK") {
    return {
      key: "reconciliation.fixed_assets",
      label,
      state: "OK",
      detail: `RC-10: register ${run.subledgerBalance} = FA/accum accounts ${run.controlBalance} as of ${run.asOf}`,
    };
  }
  return {
    key: "reconciliation.fixed_assets",
    label,
    state: "BROKEN",
    detail: `RC-10 broken: register ${run.subledgerBalance} ≠ FA/accum accounts ${run.controlBalance} (${run.diffCount} row(s)) — period lock blocked (PC-04)`,
  };
}

/**
 * PERIOD_CLOSING §2 advisory (the PHASE-26 addition): "depreciation run
 * POSTED for the closing period". NON-BLOCKING by design — an unposted run
 * is surfaced for explicit disposition, never a hard close gate (the state
 * stays OK/NOT_APPLICABLE so the checklist's allSatisfied is unaffected).
 */
export async function depreciationRunAdvisory(periodId: string): Promise<ChecklistItem> {
  const label = {
    en: "Depreciation run posted for the closing period (advisory)",
    ar: "تشغيل الإهلاك مرحّل لفترة الإقفال (استشاري)",
  };
  // Depreciable population probe: no live assets → nothing to depreciate.
  const [active, fullyDepreciated] = await Promise.all([
    store.listAssets({ status: "ACTIVE", limit: 1 }),
    store.listAssets({ status: "FULLY_DEPRECIATED", limit: 1 }),
  ]);
  if (active.length === 0 && fullyDepreciated.length === 0) {
    return {
      key: "depreciation.run_posted",
      label,
      state: "NOT_APPLICABLE",
      detail: "no live assets — nothing to depreciate",
    };
  }
  const run = await store.findDepreciationRunByPeriod(periodId);
  if (run === undefined) {
    return {
      key: "depreciation.run_posted",
      label,
      state: "OK",
      detail: "advisory (non-blocking): no depreciation run for the closing period yet — post G-22 before closing",
    };
  }
  if (run.status !== "POSTED") {
    return {
      key: "depreciation.run_posted",
      label,
      state: "OK",
      detail: `advisory (non-blocking): run is ${run.status} — post it before closing`,
    };
  }
  return {
    key: "depreciation.run_posted",
    label,
    state: "OK",
    detail: `G-22 run posted (${run.assetCount} asset line(s), ${run.totalAmount})`,
  };
}
