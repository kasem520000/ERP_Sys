import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-042 (REPORT_CATALOG §9 addition · M-13/M-19): the manufacturing
 * cost-variance rollup — per completed production order: the per-operation
 * variance folds (Σ setup / usage / rate variance over the frozen
 * production_order_operations rows) + the order-level yield variance
 * ((planned − actual) × std_unit_cost at 4dp; positive = produced-less-
 * than-planned = unfavorable). rate_variance is 0 in v1 (the std rates ARE
 * the actual rates — work-center rate changes mid-order are the PHASE-043
 * concern); the column stays so the shape never moves.
 */

export const manufacturingCostVarianceContract = defineReport({
  id: "manufacturing.cost-variance",
  version: 1,
  title: bilingual("انحرافات التكلفة التصنيعية", "Manufacturing Cost Variances"),
  category: "industry",
  description: bilingual(
    "لكل أمر إنتاج مكتمل: مجموع انحرافات التجهيز والاستخدام والسعر لعملياته مع انحراف الإنتاجية على مستوى الأمر — انحراف موجب يعني غير مواتٍ",
    "Per completed production order: the setup/usage/rate variance folds over its operations plus the order-level yield variance — a positive variance is unfavorable",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    itemId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "manufacturing.costing.read",
  dataSources: [
    source(
      "manufacturing",
      "manufacturingExecution.costVariance",
      ["production_orders", "production_order_operations", "items"],
      "أوامر الإنتاج المكتملة مع انحرافات عملياتها المجمدة",
      "The completed production orders with their frozen operation variances",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: [] },
  assertions: [
    assertDecl(
      "variance-decimal-shape",
      "every variance column renders as a canonical signed 4dp decimal string (ADR-0009 — no binary floats near money)",
      "كل عمود انحراف يُعرض كسلسلة عشرية موقعة من أربع خانات",
      "A malformed variance value",
    ),
  ],
  run: async (_ctx, params) => {
    const { manufacturingExecution } = reportingServices();
    const rows = await manufacturingExecution.costVariance({
      from: params.dateFrom!,
      to: params.dateTo!,
      // The zod uuid schema above already validated the value before run().
      itemId: (params.itemId as string | undefined) ?? undefined,
    });
    const DECIMAL_4DP = /^-?\d+\.\d{4}$/;
    const shapeOk = rows.every((row) =>
      [row.setupVariance, row.usageVariance, row.rateVariance, row.yieldVariance].every((value) =>
        DECIMAL_4DP.test(value),
      ),
    );
    const setupTotal = rows.reduce((sum, row) => addExact(sum, row.setupVariance), "0.0000");
    const usageTotal = rows.reduce((sum, row) => addExact(sum, row.usageVariance), "0.0000");
    const rateTotal = rows.reduce((sum, row) => addExact(sum, row.rateVariance), "0.0000");
    const yieldTotal = rows.reduce((sum, row) => addExact(sum, row.yieldVariance), "0.0000");
    const operationCount = rows.reduce((sum, row) => sum + row.operations, 0);
    return {
      columns: [
        col("orderNo", "أمر الإنتاج", "Order"),
        col("itemSku", "الصنف", "SKU"),
        col("status", "الحالة", "Status", "status"),
        col("completedAt", "الإكمال", "Completed", "date"),
        moneyCol("setupVariance", "انحراف التجهيز", "Setup variance"),
        moneyCol("usageVariance", "انحراف الاستخدام", "Usage variance"),
        moneyCol("rateVariance", "انحراف السعر", "Rate variance"),
        moneyCol("yieldVariance", "انحراف الإنتاجية", "Yield variance"),
        col("operations", "عدد العمليات", "Operations", "text", true),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.orderId,
        group: row.itemSku,
        values: {
          orderNo: row.orderNo ?? "—",
          itemSku: row.itemSku,
          status: row.status,
          completedAt: row.completedAt ?? "—",
          setupVariance: row.setupVariance,
          usageVariance: row.usageVariance,
          rateVariance: row.rateVariance,
          yieldVariance: row.yieldVariance,
          operations: `${row.operations}`,
        },
      })),
      totals: [
        {
          id: "setup-variance-total",
          kind: "sum",
          label: bilingual("إجمالي انحراف التجهيز", "Total setup variance"),
          amount: setupTotal,
        },
        {
          id: "usage-variance-total",
          kind: "sum",
          label: bilingual("إجمالي انحراف الاستخدام", "Total usage variance"),
          amount: usageTotal,
        },
        {
          id: "rate-variance-total",
          kind: "sum",
          label: bilingual("إجمالي انحراف السعر", "Total rate variance"),
          amount: rateTotal,
        },
        {
          id: "yield-variance-total",
          kind: "sum",
          label: bilingual(
            `أوامر: ${rows.length} · عمليات: ${operationCount} · إجمالي انحراف الإنتاجية`,
            `orders: ${rows.length} · operations: ${operationCount} · total yield variance`,
          ),
          amount: yieldTotal,
        },
      ],
      assertionResults: [
        {
          id: "variance-decimal-shape",
          status: shapeOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            shapeOk ? "كل القيم بصيغة 4dp سليمة" : "قيمة بصيغة غير سليمة",
            shapeOk ? "every value renders as canonical 4dp" : "a malformed value",
          ),
        },
      ],
      notes: [
        bilingual(
          "انحراف السعر صفر في الإصدار الأول (المعايير هي الأسعار الفعلية)؛ انحراف الإنتاجية = (المخططة − الفعلية) × التكلفة المعيارية للوحدة — الموجب غير مواتٍ؛ الأوامر بلا مسار تظهر بأصفار (النمط المزدوج).",
          "Rate variance is 0 in v1 (the std rates ARE the actual rates); yield variance = (planned − actual) × std unit cost — positive is unfavorable; routing-less orders show zeros (the dual mode).",
        ),
      ],
    };
  },
});
