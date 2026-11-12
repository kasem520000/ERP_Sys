import { z } from "zod";

import { addExact, compareExact } from "../../../accounting/application/decimal-strings";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-042 (REPORT_CATALOG §9 addition · M-14/BR-069): the rework cost
 * register — one row per rework order over rework_orders × production_orders
 * (the parent order number) with the G-41 value legs (labor / overhead /
 * rework value) and the defect reference. The register is the BR-069
 * evidence surface: rework conversion cost lands in REWORK_EXPENSE, never
 * in the parent order's FG layer (the rework-costing db spec pins the
 * parent's columns byte-identical before/after).
 */

export const manufacturingReworkCostContract = defineReport({
  id: "manufacturing.rework-cost",
  version: 1,
  title: bilingual("سجل تكلفة إعادة التشغيل", "Rework Cost Register"),
  category: "industry",
  description: bilingual(
    "كل أمر إعادة تشغيل بصف مستقل مع الأمر الأصل ومرجع العيب والكمية وأرجل التكلفة (أجور/مصاريف/الإجمالي) وتاريخ الإكمال — تكلفة إعادة التشغيل تبقى في مصروفها ولا تُرسمل في إنتاج الأمر الأصل",
    "Every rework order as a row with the parent order, defect reference, qty, and the value legs (labor/overhead/total) — rework conversion cost stays in its expense, never capitalized into the parent FG layer",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "manufacturing.costing.read",
  dataSources: [
    source(
      "manufacturing",
      "manufacturingExecution.reworkCost",
      ["rework_orders", "production_orders", "items"],
      "أوامر إعادة التشغيل مع الأمر الأصل والصنف",
      "The rework orders with the parent order and item",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: [] },
  assertions: [
    assertDecl(
      "rework-value-shape",
      "every COMPLETED row's reworkValue equals laborValue + overheadValue exactly at 4dp (the G-41 typed-sum rule)",
      "قيمة إعادة التشغيل لكل صف مكتمل تساوي مجموع الأجور والمصاريف بدقة 4dp",
      "A completed rework row whose value is not the typed sum of its legs",
    ),
  ],
  run: async (_ctx, params) => {
    const { manufacturingExecution } = reportingServices();
    const rows = await manufacturingExecution.reworkCost({
      from: params.dateFrom!,
      to: params.dateTo!,
    });
    const valueShapeOk = rows
      .filter((row) => row.status === "COMPLETED" && row.reworkValue !== null)
      .every((row) => compareExact(row.reworkValue!, addExact(row.laborValue, row.overheadValue)) === 0);
    const completed = rows.filter((row) => row.status === "COMPLETED");
    const laborTotal = completed.reduce((sum, row) => addExact(sum, row.laborValue), "0.0000");
    const overheadTotal = completed.reduce((sum, row) => addExact(sum, row.overheadValue), "0.0000");
    const reworkTotal = completed.reduce(
      (sum, row) => (row.reworkValue === null ? sum : addExact(sum, row.reworkValue)),
      "0.0000",
    );
    return {
      columns: [
        col("reworkNo", "أمر إعادة التشغيل", "Rework order"),
        col("parentOrderNo", "الأمر الأصل", "Parent order"),
        col("itemSku", "الصنف", "SKU"),
        col("defectRef", "مرجع العيب", "Defect ref"),
        qtyCol("qty", "الكمية", "Qty"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("laborValue", "الأجور", "Labor"),
        moneyCol("overheadValue", "المصاريف", "Overhead"),
        moneyCol("reworkValue", "تكلفة إعادة التشغيل", "Rework value"),
        col("completedAt", "الإكمال", "Completed", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.reworkId,
        group: row.status,
        values: {
          reworkNo: row.reworkNo ?? "—",
          parentOrderNo: row.parentOrderNo ?? "—",
          itemSku: row.itemSku,
          defectRef: row.defectRef,
          qty: row.qty,
          status: row.status,
          laborValue: row.laborValue,
          overheadValue: row.overheadValue,
          reworkValue: row.reworkValue ?? "—",
          completedAt: row.completedAt ?? "—",
        },
      })),
      totals: [
        {
          id: "rework-labor-total",
          kind: "sum",
          label: bilingual("إجمالي أجور إعادة التشغيل", "Total rework labor"),
          amount: laborTotal,
        },
        {
          id: "rework-overhead-total",
          kind: "sum",
          label: bilingual("إجمالي مصاريف إعادة التشغيل", "Total rework overhead"),
          amount: overheadTotal,
        },
        {
          id: "rework-value-total",
          kind: "sum",
          label: bilingual(
            `المكتملة: ${completed.length} من ${rows.length} · إجمالي تكلفة إعادة التشغيل`,
            `completed: ${completed.length} of ${rows.length} · total rework value`,
          ),
          amount: reworkTotal,
        },
      ],
      assertionResults: [
        {
          id: "rework-value-shape",
          status: valueShapeOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            valueShapeOk ? "القيمة تساوي مجموع الأرجل بدقة" : "قيمة لا تساوي مجموع أرجلها",
            valueShapeOk ? "every completed value is the exact sum of its legs" : "a completed value off its legs",
          ),
        },
      ],
    };
  },
});
