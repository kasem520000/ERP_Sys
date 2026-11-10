import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import { intersectBranchScope } from "../../application/scope";
import { ISO_DATE, LOCALE, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-026 T11 · `fixed_assets.depreciation-schedule` (REPORT_CATALOG §9
 * row 229): the per-asset remaining depreciation schedule — posted-to-date
 * accumulated on the CURRENT basis (the same composition the runs use:
 * opening + posted non-reversed lines + revaluation restatements, every leg
 * date-anchored ≤ asOf) plus the method-aware remaining schedule
 * (DR-002 §Decision 5):
 *
 * - STRAIGHT_LINE      remaining months of the useful life
 * - DECLINING_BALANCE  remaining base at the monthly rate (12 / life on the
 *                      opening NBV, floored at salvage)
 * - UNITS_OF_PRODUCTION remaining units = total_estimated_units − consumed
 *                      through asOf (usage is manual per run — DR-002)
 *
 * The next-period amount is EXACTLY what the period's run would compute
 * (the same pure kernel + the same current-basis composition: a POSTED
 * revaluation's gross replaces the register cost, salvage stays), including
 * the next-month convention (the acquisition month never depreciates) and
 * the final-period residual absorption (INV-023). UoP stays blank pending
 * the manual usage the run workspace collects. Footer totals.
 *
 * Permission `fixed_assets.reports.view`; as-of deterministic (same
 * (scope, dates, asOf) → byte-identical). No GL assertion here — the
 * register owns the fa-cost-tie / fa-accum-tie block-on-fail checks; this
 * schedule is the derived planning surface over the same source rows.
 */

const METHOD_NOTE = bilingual(
  "الجدول حسب الطريقة: القسط الثابت يعرض الأشهر المتبقية من العمر الإنتاجي؛ القسط المتناقص يعرض القاعدة المتبقية بالنسبة الشهرية (١٢ ÷ العمر بالأشهر على صافي القيمة الافتتاحية)؛ وحدات الإنتاج تعرض الوحدات المتبقية (الإجمالي المقدر − المستهلك حتى التاريخ) وسعر الوحدة — والاستخدام يدوي لكل تشغيل (DR-002)",
  "Method-aware: STRAIGHT_LINE shows the remaining months of the useful life; DECLINING_BALANCE shows the remaining base at the monthly rate (12 / life on opening NBV); UNITS_OF_PRODUCTION shows the remaining units (total estimated − consumed through asOf) and the per-unit rate — usage is manual per run (DR-002)",
);

const NEXT_AMOUNT_NOTE = bilingual(
  "مبلغ الفترة القادمة = ما يحسبه تشغيل الإهلاك لنفس الفترة على الأساس الجاري (تكلفة تُستبدل بالقيمة الإجمالية بعد إعادة التقييم والإنقاذ كما هو): شهر الاقتناء لا يُهلك (اصطلاح الشهر التالي)، والفترة الأخيرة تمتص المتبقي (INV-023)، ووحدات الإنتاج تُترك فارغة بانتظار الاستخدام اليدوي",
  "The next-period amount is what that period's depreciation run would compute on the current basis (a revalued gross replaces the cost; salvage stays): the acquisition month never depreciates (next-month convention), the final period absorbs the residual (INV-023), and UNITS_OF_PRODUCTION stays blank pending its manual usage",
);

export const fixedAssetsDepreciationScheduleContract = defineReport({
  id: "fixed_assets.depreciation-schedule",
  version: 1,
  title: bilingual("جدول الإهلاك", "Depreciation Schedule"),
  category: "financial",
  description: bilingual(
    "جدول الإهلاك المتبقي لكل أصل حي حتى تاريخ: المجمع المرحّل حتى التاريخ على الأساس الجاري والقاعدة المتبقية حسب الطريقة (أشهر متبقية / قاعدة بنسبة / وحدات متبقية) مع مبلغ الفترة القادمة كما سيحسبه التشغيل",
    "The remaining depreciation schedule per live asset as of a date: posted-to-date accumulated on the current basis and the method-aware remaining base (remaining months / base at rate / remaining units) with the next-period amount the run would compute",
  ),
  parameters: z.object({
    asOf: ISO_DATE,
    fiscalPeriodId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    method: z
      .enum(["STRAIGHT_LINE", "DECLINING_BALANCE", "UNITS_OF_PRODUCTION"])
      .optional(),
    branchIds: z.array(z.string().uuid()).nullish(),
    locale: LOCALE,
  }),
  requiredPermission: "fixed_assets.reports.view",
  dataSources: [
    source(
      "fixed_assets",
      "fixedAssetsQueries.depreciationSchedule (the as-of basis + the method-aware remaining)",
      ["assets", "asset_categories", "depreciation_runs", "depreciation_lines", "asset_revaluations"],
      "الأصول وفئاتها وتشغيلات الإهلاك وسطورها وإعادات التقييم — الأساس الجاري حتى التاريخ",
      "Assets, categories, depreciation runs and lines, revaluations — the as-of current basis",
    ),
    source(
      "accounting",
      "fiscal_periods (the projection period) + journal_entries (the as-of anchors)",
      ["fiscal_periods", "journal_entries"],
      "الفترات المالية لفترة الإسقاط وقيود الإهلاك لمرابط التاريخ",
      "The fiscal period for the projection and the depreciation entries as date anchors",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "postedToAccum", kind: "sum" },
      { id: "remainingBase", kind: "sum" },
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
  assertions: [],
  run: async (ctx, params) => {
    const { fixedAssets } = reportingServices();
    const scope = intersectBranchScope(ctx, params);
    const rows = await fixedAssets.depreciationSchedule({
      asOf: params.asOf!,
      fiscalPeriodId: params.fiscalPeriodId ?? null,
      branchIds: scope.branchIds,
      categoryId: params.categoryId ?? null,
      method: params.method ?? null,
    });

    let postedTotal = "0.0000";
    let remainingTotal = "0.0000";
    for (const row of rows) {
      postedTotal = addExact(postedTotal, row.postedToAccum);
      remainingTotal = addExact(remainingTotal, row.remainingBase);
    }

    return {
      columns: [
        col("code", "الرمز", "Code"),
        col("name", "الأصل", "Asset"),
        col("category", "الفئة", "Category"),
        col("method", "الطريقة", "Method", "status"),
        col("acquisitionDate", "تاريخ الاقتناء", "Acquired", "date"),
        col("usefulLifeMonths", "العمر (شهر)", "Life (months)", "text", true),
        moneyCol("salvage", "قيمة الإنقاذ", "Salvage"),
        moneyCol("basisGross", "الأساس الجاري", "Current basis"),
        moneyCol("postedToAccum", "المجمع حتى التاريخ", "Posted-to-date"),
        moneyCol("remainingBase", "القاعدة المتبقية", "Remaining base"),
        col("remainingMonths", "أشهر متبقية", "Remaining months", "text", true),
        col("dbRatePct", "النسبة الشهرية %", "Monthly rate %", "text", true),
        qtyCol("remainingUnits", "وحدات متبقية", "Remaining units"),
        moneyCol("unitRate", "سعر الوحدة", "Unit rate"),
        moneyCol("nextAmount", "مبلغ الفترة القادمة", "Next-period amount"),
        col("atFloor", "عند الحد", "At floor", "status"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.assetId,
        values: {
          code: row.code,
          name: params.locale === "ar" ? row.nameAr ?? row.name : row.name,
          category: row.categoryCode,
          method: row.method,
          acquisitionDate: row.acquisitionDate,
          usefulLifeMonths: row.usefulLifeMonths,
          salvage: row.salvageValue,
          basisGross: row.basisGross,
          postedToAccum: row.postedToAccum,
          remainingBase: row.remainingBase,
          remainingMonths: row.remainingMonths,
          dbRatePct: row.dbRatePct,
          remainingUnits: row.remainingUnits,
          unitRate: row.unitRate,
          nextAmount: row.nextAmount,
          atFloor: row.atFloor ? "true" : "false",
        },
      })),
      totals: [
        {
          id: "rowCount",
          kind: "sum",
          label: bilingual("عدد الأصول الحية", "Live assets"),
          amount: String(rows.length),
        },
        {
          id: "postedTotal",
          kind: "sum",
          label: bilingual("إجمالي المجمع حتى التاريخ", "Total posted-to-date"),
          amount: postedTotal,
        },
        {
          id: "remainingTotal",
          kind: "sum",
          label: bilingual("إجمالي القاعدة المتبقية", "Total remaining base"),
          amount: remainingTotal,
        },
      ],
      assertionResults: [],
      notes: [
        METHOD_NOTE,
        NEXT_AMOUNT_NOTE,
        bilingual(
          "المجمع حتى التاريخ على الأساس الجاري = الرصيد الافتتاحي + سطور التشغيلات المرحّلة غير المعكوسة (تاريخ القيد ≤ التاريخ) + إعادة صياغات مجمع إعادة التقييم المؤرخة ≤ التاريخ — نفس تركيبة التشغيلات التي تطابق RC-10",
          "Posted-to-date on the current basis = opening + posted non-reversed run lines (entry date ≤ asOf) + revaluation accum restatements dated ≤ asOf — the same run composition RC-10 reconciles",
        ),
      ],
    };
  },
});
