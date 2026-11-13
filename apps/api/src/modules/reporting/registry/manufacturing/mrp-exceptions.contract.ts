import { z } from "zod";

import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-043 T-16 (REPORT_CATALOG addition · the M-01 garbage-in mitigation's
 * report leg): the MRP exceptions view — the planning data-readiness defects
 * (missing lead times, incomplete safety/lot-sizing operands, phantoms
 * without recipes) + the latest run's uncovered residuals and frozen-fence
 * suggestions. The run screen's readiness panel mirrors the same classes;
 * the report is the printer-friendly / scheduled-digest surface.
 */

const UUID_OPTIONAL = z.string().uuid().optional();

export const manufacturingMrpExceptionsContract = defineReport({
  id: "manufacturing.mrp-exceptions",
  version: 1,
  title: bilingual("استثناءات تخطيط الاحتياجات", "MRP Exceptions"),
  category: "industry",
  description: bilingual(
    "عيوب بيانات التخطيط (زمن توريد مفقود، معاملات ناقصة، قائمة وهمية بلا وصفة) + البواقي غير المغطاة واقتراحات السياج المجمد من آخر تشغيل",
    "The planning data defects (missing lead times, incomplete operands, phantoms without recipes) + the latest run's uncovered residuals and frozen-fence suggestions",
  ),
  parameters: z.object({
    warehouseId: UUID_OPTIONAL,
    runId: UUID_OPTIONAL,
    asOf: ISO_DATE.nullish(),
    locale: LOCALE,
  }),
  requiredPermission: "manufacturing.mrp",
  dataSources: [
    source(
      "manufacturing",
      "planningQueries.planningExceptions",
      ["items", "bom_lines", "bills_of_materials", "mrp_runs", "mrp_demand_lines", "mrp_supply_lines", "mrp_suggestions"],
      "استثناءات التخطيط: العيوب والبواقي واقتراحات السياج",
      "The planning exceptions: defects, residuals, fence-locked suggestions",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [
    assertDecl(
      "mrp-exception-classes",
      "every row's exceptionKind is one of the five documented classes (MISSING_LEAD_TIME, MISSING_SAFETY_OPERANDS, PHANTOM_WITHOUT_RECIPE, UNCOVERED_RESIDUAL, FROZEN_FENCE_SUGGESTION)",
      "كل استثناء يقع في واحدة من الفئات الخمس الموثقة",
      "An unknown exception class rendered",
    ),
  ],
  run: async (_ctx, params) => {
    const { planningQueries } = reportingServices();
    const rows = await planningQueries.planningExceptions({
      warehouseId: (params.warehouseId as string | undefined) ?? undefined,
      runId: (params.runId as string | undefined) ?? undefined,
    });
    const CLASSES = new Set([
      "MISSING_LEAD_TIME",
      "MISSING_SAFETY_OPERANDS",
      "PHANTOM_WITHOUT_RECIPE",
      "UNCOVERED_RESIDUAL",
      "FROZEN_FENCE_SUGGESTION",
    ]);
    const classOk = rows.every((row) => CLASSES.has(row.exceptionKind));
    const byKind = new Map<string, number>();
    for (const row of rows) {
      byKind.set(row.exceptionKind, (byKind.get(row.exceptionKind) ?? 0) + 1);
    }
    return {
      columns: [
        col("sku", "الصنف", "SKU"),
        col("itemName", "الاسم", "Name"),
        col("exceptionKind", "الفئة", "Exception", "status"),
        col("detail", "التفصيل", "Detail"),
        col("runId", "التشغيل", "Run"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.itemId}:${row.exceptionKind}:${row.runId ?? "-"}`,
        values: {
          sku: row.sku,
          itemName: row.itemName,
          exceptionKind: row.exceptionKind,
          detail: row.detail,
          runId: row.runId ?? "—",
        },
      })),
      totals: [
        { id: "exceptions", kind: "sum", label: bilingual("عدد الاستثناءات", "Exception count"), amount: String(rows.length) },
        ...[...byKind.entries()].map(([kind, count]) => ({
          id: `kind:${kind}`,
          kind: "sum" as const,
          label: bilingual(kind, kind),
          amount: String(count),
        })),
      ],
      assertionResults: [
        {
          id: "mrp-exception-classes",
          status: classOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            classOk ? "كل استثناء يحمل فئة موثقة" : "فئة غير موثقة ظهرت — وسّع العقد قبل التشغيل التالي",
            classOk ? "every exception renders a documented class" : "an unknown exception class appeared — extend the contract before the next run",
          ),
        },
      ],
      notes: [
        bilingual(
          "الفئات الخمس: زمن توريد مفقود · معاملات ناقصة (مخزون الأمان أو التحجم) · قائمة وهمية بلا وصفة · باقٍ غير مغطى في آخر تشغيل · اقتراح داخل السياج المجمد. هذه عيوب بيانات تُصلح من بطاقة الصنف أو الجدول الرئيسي — لا يصلحها التشغيل.",
          "The five classes: missing lead time · incomplete operands (safety stock / lot sizing) · a phantom without a recipe · an uncovered residual in the latest run · a suggestion inside the frozen fence. These are DATA defects fixed on the item card or the MPS — a run never fixes them.",
        ),
      ],
    };
  },
});
