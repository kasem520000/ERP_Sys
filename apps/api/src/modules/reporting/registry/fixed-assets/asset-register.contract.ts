import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import type { AssertionResult } from "../../application/contract";
import { intersectBranchScope } from "../../application/scope";
import type { FaTieSide } from "./fixed-assets-queries";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-026 T11 · `fixed_assets.asset-register` (REPORT_CATALOG §9 row 228 —
 * the report key the catalog pins verbatim): the as-of asset register with
 * category/branch/status/custodian filters. Every figure is the
 * date-anchored reconstruction of the fixed-assets-queries surface:
 *
 * - accumulated = opening_accumulated + posted non-reversed depreciation
 *   lines through asOf (the reversal leg counts when its OWN entry date is
 *   ≤ asOf — the same anchor the GL as-of read uses);
 * - NBV = cost − accumulated (INV-023: never below the salvage floor);
 * - status is the AS-OF state (DISPOSED when the G-23 entry is ≤ asOf;
 *   FULLY_DEPRECIATED at the current-basis floor; else ACTIVE) — never the
 *   live row's status.
 *
 * The footer carries the two RC-10 ledger ties as block-on-fail assertions
 * (REPORT_RECONCILIATION §1): `fa-cost-tie` (Σ live-as-of cost + Σ posted
 * revaluation gross deltas == the FIXED_ASSET account balance as-of) and
 * `fa-accum-tie` (Σ accumulated + revaluation accum restatements == the
 * ACCUM_DEPRECIATION balance, credit-positive). The ties are WHOLE TENANT —
 * display filters never narrow the ledger check (journal_lines carry no
 * branch; RC-10 is tenant-wide too). Tolerance 0 (exact-decimal compare).
 *
 * Permission `fixed_assets.reports.view` (AUTHORIZATION_MATRIX §3.11 —
 * granted to owner+accountant, not viewer). As-of deterministic: same
 * (scope, dates, asOf) → byte-identical output.
 */

const FA_COST_TIE = assertDecl(
  "fa-cost-tie",
  "Σ live-as-of register cost + Σ posted revaluation gross deltas == the FIXED_ASSET account balance as-of (per category purpose key)",
  "تكلفة الأصول الحية حتى التاريخ زائد فروق إعادة التقييم الإجمالية لا تطابق رصيد حساب الأصول الثابتة في دفتر الأستاذ",
  "Live-as-of register cost plus revaluation gross deltas does not tie to the FIXED_ASSET account balance",
  "RC-10",
);

const FA_ACCUM_TIE = assertDecl(
  "fa-accum-tie",
  "Σ accumulated as-of + Σ revaluation accum restatements == the ACCUM_DEPRECIATION account balance as-of (credit-positive, per category purpose key)",
  "مجمع الإهلاك حتى التاريخ زائد إعادة صياغات مجمع إعادة التقييم لا تطابق رصيد حساب مجمع الإهلاك في دفتر الأستاذ",
  "Accumulated depreciation plus revaluation restatements does not tie to the ACCUM_DEPRECIATION account balance",
  "RC-10",
);

/** The INV-023 footer note (REPORT_CATALOG §9 note under row 228). */
const INV023_NOTE = bilingual(
  "صافي القيمة الدفترية = التكلفة − مجمع الإهلاك حتى التاريخ، ولا ينزل أبداً عن قيمة الإنقاذ (INV-023)؛ الصفوف المستبعدة تحتفظ بأرقامها المجمدة لحظة الاستبعاد بينما غادرت كلفتها ومجمعها دفتر الأستاذ بقيود G-23 — ويبقى أثر إعادة التقييم (فروق إعادة التقييم) على الحسابات",
  "NBV = cost − accumulated depreciation as-of and never falls below the salvage floor (INV-023); DISPOSED rows keep their frozen at-disposal figures while their cost and accumulated left the ledger with the G-23 entries — the revaluation residue (gross legs) stays on the accounts",
);

const TIE_SCOPE_NOTE = bilingual(
  "مطابقتا fa-cost-tie و fa-accum-tie على مستوى المستأجر كاملاً حتى التاريخ (كل الفروع والفئات) — مرشحات العرض لا تضيّق فحص دفتر الأستاذ، والصف غير المرسمل (بلا قيد G-21) يُحتسب في جانب السجل ليكشف الانحراف",
  "The fa-cost-tie / fa-accum-tie checks are whole-tenant as-of (all branches and categories) — display filters never narrow the ledger check, and an uncaptured row (no G-21 journal) stays on the register side so its drift surfaces",
);

/** Build one block-on-fail tie result with the per-key offenders in the detail. */
function tieResult(id: string, side: FaTieSide): AssertionResult {
  const broken = side.perKey.filter((key) => key.register !== key.gl);
  const ok = broken.length === 0;
  return {
    id,
    status: ok ? "PASS" : "FAIL",
    compared: { left: side.registerTotal, right: side.glTotal },
    detail: ok
      ? undefined
      : {
          ar: `حسابات غير مطابقة: ${broken
            .map((key) => `${key.purposeKey} (سجل ${key.register} / أستاذ ${key.gl})`)
            .join("، ")}`,
          en: `Mismatched purpose account(s): ${broken
            .map((key) => `${key.purposeKey} (register ${key.register} / GL ${key.gl})`)
            .join(", ")}`,
        },
  };
}

const ASSET_STATUSES = ["ACTIVE", "FULLY_DEPRECIATED", "DISPOSED", "WRITTEN_OFF"] as const;

export const fixedAssetsAssetRegisterContract = defineReport({
  id: "fixed_assets.asset-register",
  version: 1,
  title: bilingual("سجل الأصول الثابتة", "Asset Register"),
  category: "financial",
  description: bilingual(
    "سجل الأصول الثابتة حتى تاريخ: التكلفة ومجمع الإهلاك وصافي القيمة الدفترية لكل أصل مع الفئة والفرع والحالة والمسؤول عن العهدة — يحمل مطابقتي دفتر الأستاذ (fa-cost-tie و fa-accum-tie) اللتين تمنعان التصدير عند الفشل",
    "The fixed-asset register as of a date: cost, accumulated depreciation and NBV per asset with category, branch, status and custodian — carrying the fa-cost-tie / fa-accum-tie ledger checks that block exports on failure",
  ),
  parameters: z.object({
    asOf: ISO_DATE,
    branchIds: z.array(z.string().uuid()).nullish(),
    categoryId: z.string().uuid().optional(),
    status: z.enum(ASSET_STATUSES).optional(),
    custodianUserId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "fixed_assets.reports.view",
  dataSources: [
    source(
      "fixed_assets",
      "fixedAssetsQueries.assetRegister (the as-of reconstruction)",
      ["assets", "asset_categories", "depreciation_lines", "asset_revaluations", "asset_disposals"],
      "الأصول وفئاتها وسطور الإهلاك وإعادة التقييم والاستبعاد — إعادة بناء حتى التاريخ",
      "Assets, categories, depreciation lines, revaluations and disposals — the as-of reconstruction",
    ),
    source(
      "accounting",
      "journal (G-21/G-23 provenance + as-of FA/accum balances for the ties)",
      ["journal_entries", "journal_lines", "account_purposes"],
      "قيود الرسملة والاستبعاد وأرصدة حسابات الأصول ومجمع الإهلاك للمطابقة",
      "Capitalization/disposal entries and the FA/accum account balances for the tie-out",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "cost", kind: "sum" },
      { id: "accumulated", kind: "sum" },
      { id: "nbv", kind: "sum" },
    ],
    sorting: [{ by: "code", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "as-of",
    cacheTtlSeconds: 3600,
    invalidationEvents: ["journal.posted", "journal.reversed", "period.locked"],
  },
  assertions: [FA_COST_TIE, FA_ACCUM_TIE],
  run: async (ctx, params) => {
    const { fixedAssets } = reportingServices();
    const scope = intersectBranchScope(ctx, params);
    const rows = await fixedAssets.assetRegister({
      asOf: params.asOf!,
      branchIds: scope.branchIds,
      categoryId: params.categoryId ?? null,
      status: params.status ?? null,
      custodianUserId: params.custodianUserId ?? null,
    });

    let costTotal = "0.0000";
    let accumulatedTotal = "0.0000";
    let nbvTotal = "0.0000";
    for (const row of rows) {
      costTotal = addExact(costTotal, row.cost);
      accumulatedTotal = addExact(accumulatedTotal, row.accumulatedAsOf);
      nbvTotal = addExact(nbvTotal, row.nbvAsOf);
    }

    const ties = await fixedAssets.assetRegisterTies({ asOf: params.asOf! });

    return {
      columns: [
        col("code", "الرمز", "Code"),
        col("name", "الأصل", "Asset"),
        col("category", "الفئة", "Category"),
        col("branch", "الفرع", "Branch"),
        col("acquisitionDate", "تاريخ الاقتناء", "Acquired", "date"),
        moneyCol("cost", "التكلفة", "Cost"),
        moneyCol("accumulated", "مجمع الإهلاك", "Accumulated"),
        moneyCol("nbv", "صافي القيمة الدفترية", "NBV"),
        col("status", "الحالة", "Status", "status"),
        col("custodian", "المسؤول", "Custodian"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.assetId,
        values: {
          code: row.capitalized ? row.code : `${row.code} *`,
          name: params.locale === "ar" ? row.nameAr ?? row.name : row.name,
          category: row.categoryCode,
          branch: row.branchCode,
          acquisitionDate: row.acquisitionDate,
          cost: row.cost,
          accumulated: row.accumulatedAsOf,
          nbv: row.nbvAsOf,
          status: row.statusAsOf,
          custodian: row.custodianName,
        },
      })),
      totals: [
        {
          id: "rowCount",
          kind: "sum",
          label: bilingual("عدد الأصول", "Assets"),
          amount: String(rows.length),
        },
        {
          id: "costTotal",
          kind: "sum",
          label: bilingual("إجمالي التكلفة", "Total cost"),
          amount: costTotal,
        },
        {
          id: "accumulatedTotal",
          kind: "sum",
          label: bilingual("إجمالي مجمع الإهلاك", "Total accumulated"),
          amount: accumulatedTotal,
        },
        {
          id: "nbvTotal",
          kind: "sum",
          label: bilingual("إجمالي صافي القيمة الدفترية", "Total NBV"),
          amount: nbvTotal,
        },
      ],
      assertionResults: [tieResult("fa-cost-tie", ties.fa), tieResult("fa-accum-tie", ties.accum)],
      notes: [
        INV023_NOTE,
        TIE_SCOPE_NOTE,
        bilingual(
          "مجمع الإهلاك حتى التاريخ = الرصيد الافتتاحي + سطور تشغيلات الإهلاك المرحّلة غير المعكوسة التي تاريخ قيدها ≤ التاريخ (القيد العكسي يُحتسب حين يكون تاريخه هو ≤ التاريخ) — وإعادة البناء على التاريخ لا تتأثر بعمليات لاحقة مؤرخة بعده",
          "Accumulated as-of = opening + posted non-reversed depreciation lines whose entry date is ≤ asOf (a reversal leg counts only when its own entry date is ≤ asOf) — the as-of reconstruction ignores later-dated activity",
        ),
        bilingual(
          "الرمز المؤشر بنجمة (*) أصل غير مرسمل بعد (لا يوجد قيد G-21) — صف سجل بلا أثر في دفتر الأستاذ يكشفه فحص المطابقة",
          "A starred (*) code marks a not-yet-capitalized asset (no G-21 journal) — a register row without a ledger effect, surfaced by the tie check",
        ),
      ],
    };
  },
});
