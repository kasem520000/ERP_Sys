import { z } from "zod";

import { assertExact } from "../../application/assertions";
import { addExact } from "../../../accounting/application/decimal-strings";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-014 · the dashboard-binding contracts (PHASE-014 §2.7; REPORT_CATALOG
 * §14): the reports the owner/CEO dashboard widgets bind to with pinned
 * parameters in `current` freshness mode. Widgets are LINKS, never parallel
 * implementations — the KPI numbers equal the bound contract's run for the
 * same pinned parameters (asserted by the dashboard db spec), and clicking
 * a widget opens the underlying report with those parameters.
 *
 * - `sales.daily-revenue` → the "sales today" widget (pinned to today).
 * - `inventory.reorder-alerts` → the "stock alerts" widget (BR-019 — an
 *   alert, never autopilot; the replenishment surface lands PHASE-015).
 * The "cash position" widget binds `treasury.daily-cash` (existing, pinned
 * to today) and "AR overdue" binds `ar.aging` (existing, pinned asOf today
 * — the widget shows the overdue buckets total).
 */

const WINDOW_PARAMS = { dateFrom: ISO_DATE, dateTo: ISO_DATE, locale: LOCALE };

const SALES_TIE = assertDecl(
  "sales-gl-tie",
  "Σ posted sales base gross == REVENUE/VAT journal lines in window",
  "إجمالي المبيعات لا يطابق قيود دفتر الأستاذ في الفترة",
  "Sales totals do not tie to the GL in the window",
);

async function salesTieAssertion(fromDate: string, toDate: string) {
  const { salesAnalytics } = reportingServices();
  const tie = await salesAnalytics.salesGlTie({ fromDate, toDate });
  return assertExact("sales-gl-tie", tie.documentSide, tie.glSide);
}

export const salesDailyRevenueContract = defineReport({
  id: "sales.daily-revenue",
  version: 1,
  title: bilingual("إيراد المبيعات اليومي", "Daily Sales Revenue"),
  category: "sales",
  description: bilingual(
    "صافي الإيراد اليومي من الفواتير المرحّلة مطروحًا منه إشعارات الدائن (بالعملة الأساسية وبسعر الترحيل المخزن)",
    "Daily net revenue from posted invoices minus credit notes (base at the stored posting rate)",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.sales.pipeline.read",
  dataSources: [
    source(
      "sales",
      "salesAnalytics.dailyRevenue",
      ["sales_invoices", "sales_invoice_lines", "credit_notes", "credit_note_lines"],
      "فواتير وإشعارات المبيعات المرحّلة",
      "Posted sales invoices and credit notes",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted"] },
  assertions: [SALES_TIE],
  run: async (_ctx, params) => {
    const { salesAnalytics } = reportingServices();
    const rows = await salesAnalytics.dailyRevenue({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    const tie = await salesTieAssertion(params.dateFrom!, params.dateTo!);
    // The footer total = Σ day netSales (exact-decimal string math —
    // ADR-0009; the same number the dashboard widget renders: no
    // side-channel math, widget == contract run).
    const totalNet = rows.reduce((acc, row) => addExact(acc, row.netSales), "0.0000");
    return {
      columns: [
        col("flowDate", "التاريخ", "Date", "date"),
        col("invoiceCount", "فواتير", "Invoices", "qty", true),
        col("noteCount", "إشعارات دائن", "Credit notes", "qty", true),
        moneyCol("netSales", "صافي الإيراد", "Net revenue"),
        moneyCol("taxAmount", "الضريبة", "Tax"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.flowDate,
        values: {
          flowDate: row.flowDate,
          invoiceCount: String(row.invoiceCount),
          noteCount: String(row.noteCount),
          netSales: row.netSales,
          taxAmount: row.taxAmount,
        },
      })),
      totals: [
        {
          id: "netSales",
          kind: "sum",
          label: bilingual("الإجمالي", "Total"),
          amount: totalNet,
        },
      ],
      assertionResults: tie === undefined ? [] : [tie],
      notes: [],
    };
  },
});

export const inventoryReorderAlertsContract = defineReport({
  id: "inventory.reorder-alerts",
  version: 1,
  title: bilingual("تنبيهات إعادة الطلب", "Reorder Alerts"),
  category: "inventory",
  description: bilingual(
    "الأصناف التي بلغت حد إعادة الطلب أو دونه لكل مستودع نشط — تنبيه فقط، لا شراء تلقائي (BR-019)",
    "Items at or below their reorder level per active warehouse — an alert only, never autopilot (BR-019)",
  ),
  parameters: z.object({ locale: LOCALE }),
  requiredPermission: "inventory.stock.read",
  dataSources: [
    source(
      "inventory",
      "inventoryQueries.reorderCandidates",
      ["item_warehouse_settings", "item_stock", "items", "warehouses"],
      "إعدادات إعادة الطلب والكميات المتوفرة",
      "Reorder-level settings and on-hand quantities",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden", dateRange: "optional" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [],
  run: async (_ctx, params) => {
    const { inventory } = reportingServices();
    const rows = await inventory.reorderCandidates();
    return {
      columns: [
        col("itemSku", "الرمز", "SKU"),
        col("itemName", "الصنف", "Item"),
        col("warehouseCode", "المستودع", "Warehouse"),
        qtyCol("qtyOnHand", "المتوفر", "On hand"),
        qtyCol("reorderLevel", "حد إعادة الطلب", "Reorder level"),
        qtyCol("minQty", "الحد الأدنى", "Minimum"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.itemId}:${row.warehouseId}`,
        values: {
          itemSku: row.itemSku,
          itemName:
            params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
          warehouseCode: row.warehouseCode,
          qtyOnHand: row.qtyOnHand,
          reorderLevel: row.reorderLevel,
          minQty: row.minQty,
        },
      })),
      totals: [],
      assertionResults: [],
      notes: [
        bilingual(
          "تنبيه فقط — لا يتم إنشاء أوامر شراء تلقائيًا (BR-019).",
          "Alert only — no purchase orders are created automatically (BR-019).",
        ),
      ],
    };
  },
});
