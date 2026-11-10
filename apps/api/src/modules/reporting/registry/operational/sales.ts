import { z } from "zod";

import type { ReportParams } from "../../application/contract";
import { assertExact } from "../../application/assertions";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-013 T9 · sales analysis contracts (REPORT_CATALOG §3) over
 * `salesAnalytics.*` — posted invoices/credit notes only, base amounts at
 * the stored posting rate (INV-008), each carrying the `sales-gl-tie`
 * ledger assertion.
 */

const WINDOW_PARAMS = {
  dateFrom: ISO_DATE,
  dateTo: ISO_DATE,
  branchIds: z.array(z.string().uuid()).nullish(),
  locale: LOCALE,
};

const SALES_TIE = assertDecl(
  "sales-gl-tie",
  "sum(netSales+taxAmount) == GL revenue+VAT movement for scope+period",
  "المبيعات لا تطابق حركات دفتر الأستاذ",
  "Sales do not tie to GL movements",
);

async function salesGlTieAssertion(params: ReportParams) {
  const { salesAnalytics } = reportingServices();
  const tie = await salesAnalytics.salesGlTie({
    fromDate: params.dateFrom!,
    toDate: params.dateTo!,
  });
  return assertExact("sales-gl-tie", tie.documentSide, tie.glSide);
}

export const salesByItemContract = defineReport({
  id: "sales.by-item",
  version: 1,
  title: bilingual("المبيعات حسب الصنف", "Sales by Item"),
  category: "sales",
  description: bilingual(
    "الكميات وصافي المبيعات والضريبة والتكلفة والربحية لكل صنف في فترة",
    "Quantities, net sales, tax, cost and margin per item for a period",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.sales.by-item.read",
  dataSources: [
    source(
      "sales",
      "salesAnalytics.itemRevenue",
      ["sales_invoices", "credit_notes", "sales_invoice_lines", "credit_note_lines"],
      "بنود الفواتير والإشعارات الدائنة المرحّلة",
      "Posted invoice and credit-note lines",
    ),
    source(
      "inventory",
      "invoice issue-value COGS (W-1/W-3 snapshots)",
      ["sales_invoice_lines", "credit_note_lines"],
      "تكلفة المبيعات الفعلية بسعر الصرف عند الترحيل",
      "Actual COGS at the issue-cost snapshots",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "both",
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted", "credit_note.posted"] },
  assertions: [SALES_TIE],
  run: async (_ctx, params) => {
    const { salesAnalytics } = reportingServices();
    const rows = await salesAnalytics.itemRevenue({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("sku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        qtyCol("qtySold", "الكمية", "Qty"),
        moneyCol("grossSales", "إجمالي المبيعات", "Gross sales"),
        moneyCol("discounts", "الخصومات", "Discounts"),
        moneyCol("netSales", "صافي المبيعات", "Net sales"),
        moneyCol("taxAmount", "الضريبة", "Tax"),
        moneyCol("cogs", "التكلفة", "COGS"),
        moneyCol("margin", "هامش الربح", "Margin"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.itemId,
        values: {
          sku: row.sku,
          itemName: params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
          qtySold: row.qtySold,
          grossSales: row.grossSales,
          discounts: row.discounts,
          netSales: row.netSales,
          taxAmount: row.taxAmount,
          cogs: row.cogs,
          margin: (Number(row.netSales) - Number(row.cogs)).toFixed(4),
        },
      })),
      totals: [],
      assertionResults: [await salesGlTieAssertion(params)],
    };
  },
});

export const salesByCustomerContract = defineReport({
  id: "sales.by-customer",
  version: 1,
  title: bilingual("المبيعات حسب العميل", "Sales by Customer"),
  category: "sales",
  description: bilingual("صافي مبيعات كل عميل في فترة", "Net sales per customer for a period"),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.sales.by-customer.read",
  dataSources: [
    source(
      "sales",
      "salesAnalytics.customerRevenue",
      ["sales_invoices", "credit_notes"],
      "فواتير وإشعارات مرحّلة حسب العميل",
      "Posted invoices/notes by customer",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted", "credit_note.posted"] },
  assertions: [SALES_TIE],
  run: async (_ctx, params) => {
    const { salesAnalytics } = reportingServices();
    const rows = await salesAnalytics.customerRevenue({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("customerName", "العميل", "Customer"),
        col("documentCount", "عدد المستندات", "Documents", "text", true),
        moneyCol("netSales", "صافي المبيعات", "Net sales"),
        moneyCol("taxAmount", "الضريبة", "Tax"),
        moneyCol("grossSales", "الإجمالي", "Gross"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.customerId,
        values: {
          customerName: params.locale === "ar" ? row.partnerNameAr ?? row.partnerName : row.partnerName,
          documentCount: row.documentCount,
          netSales: row.netSales,
          taxAmount: row.taxAmount,
          grossSales: row.grossSales,
        },
      })),
      totals: [],
      assertionResults: [await salesGlTieAssertion(params)],
    };
  },
});

export const salesByRepContract = defineReport({
  id: "sales.by-rep",
  version: 1,
  title: bilingual("المبيعات حسب المندوب", "Sales by Rep"),
  category: "sales",
  description: bilingual(
    "مبيعات كل مندوب في فترة (العمولات مرحلة لاحقة)",
    "Per-rep sales for a period (commissions are PHASE-017)",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.sales.by-rep.read",
  dataSources: [
    source(
      "sales",
      "salesAnalytics.repRevenue",
      ["sales_invoices", "credit_notes", "sales_reps"],
      "إسناد المستندات للمندوبين",
      "Rep attribution on posted documents",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted", "credit_note.posted"] },
  assertions: [SALES_TIE],
  run: async (_ctx, params) => {
    const { salesAnalytics } = reportingServices();
    const rows = await salesAnalytics.repRevenue({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("repName", "المندوب", "Rep"),
        col("documentCount", "عدد المستندات", "Documents", "text", true),
        moneyCol("netSales", "صافي المبيعات", "Net sales"),
        moneyCol("grossSales", "الإجمالي", "Gross"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.repId ?? "none",
        values: {
          repName: params.locale === "ar" ? row.repNameAr ?? row.repName : row.repName,
          documentCount: row.documentCount,
          netSales: row.netSales,
          grossSales: row.grossSales,
        },
      })),
      totals: [],
      assertionResults: [await salesGlTieAssertion(params)],
    };
  },
});

export const salesByPaymentMethodContract = defineReport({
  id: "sales.by-payment-method",
  version: 1,
  title: bilingual("المبيعات حسب طريقة الدفع", "Sales by Payment Method"),
  category: "sales",
  description: bilingual(
    "توزيع المبيعات النقدية والمحصّلة حسب طريقة الدفع",
    "Cash-sale and settled-credit split by payment method",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.sales.by-paymethod.read",
  dataSources: [
    source(
      "sales",
      "salesAnalytics.paymentMethodSplit",
      ["sales_invoices", "receipts"],
      "المبيعات النقدية والمقبوضات المحصّلة",
      "Cash sales and settled receipts",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted"] },
  assertions: [SALES_TIE],
  run: async (_ctx, params) => {
    const { salesAnalytics } = reportingServices();
    const rows = await salesAnalytics.paymentMethodSplit({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("kind", "الطريقة", "Method"),
        col("documentCount", "عدد المستندات", "Documents", "text", true),
        moneyCol("amount", "المبلغ", "Amount"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.kind,
        values: {
          kind: row.kind === "CASH" ? "نقدية / Cash" : "آجل محصّل / Credit settled",
          documentCount: row.documentCount,
          amount: row.amount,
        },
      })),
      totals: [],
      assertionResults: [await salesGlTieAssertion(params)],
    };
  },
});

export const salesByBranchContract = defineReport({
  id: "sales.by-branch",
  version: 1,
  title: bilingual("المبيعات حسب الفرع", "Sales by Branch"),
  category: "sales",
  description: bilingual("مبيعات كل فرع في فترة (عرض موحد)", "Per-branch sales for a period (consolidated view)"),
  parameters: z.object({ dateFrom: ISO_DATE, dateTo: ISO_DATE, locale: LOCALE }),
  requiredPermission: "reports.sales.by-branch.read",
  dataSources: [
    source(
      "sales",
      "salesAnalytics.branchRevenue",
      ["sales_invoices", "credit_notes", "branches"],
      "مبيعات الفروع المرحّلة",
      "Posted branch sales",
    ),
  ],
  scopeRules: { branches: "fixed-all", asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted", "credit_note.posted"] },
  assertions: [SALES_TIE],
  run: async (_ctx, params) => {
    const { salesAnalytics } = reportingServices();
    const rows = await salesAnalytics.branchRevenue({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("branchName", "الفرع", "Branch"),
        col("documentCount", "عدد المستندات", "Documents", "text", true),
        moneyCol("netSales", "صافي المبيعات", "Net sales"),
        moneyCol("grossSales", "الإجمالي", "Gross"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.branchId ?? "none",
        values: {
          branchName: params.locale === "ar" ? row.branchNameAr ?? row.branchName : row.branchName,
          documentCount: row.documentCount,
          netSales: row.netSales,
          grossSales: row.grossSales,
        },
      })),
      totals: [],
      assertionResults: [await salesGlTieAssertion(params)],
    };
  },
});

export const salesDocumentFlowContract = defineReport({
  id: "sales.document-flow",
  version: 1,
  title: bilingual("حركة مستندات البيع", "Sales Document Flow"),
  category: "sales",
  description: bilingual(
    "أعداد وقيم عروض الأسعار والأوامر والتسليمات والفواتير في فترة",
    "Quote/order/delivery/invoice counts and values for a period",
  ),
  parameters: z.object({ dateFrom: ISO_DATE, dateTo: ISO_DATE, locale: LOCALE }),
  requiredPermission: "reports.sales.pipeline.read",
  dataSources: [
    source(
      "sales",
      "salesAnalytics.pipelineConversion",
      ["quotations", "sales_orders", "delivery_notes", "sales_invoices"],
      "مسار المستندات من العرض إلى الفاتورة",
      "The quote-to-invoice document pipeline",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted"] },
  assertions: [SALES_TIE],
  run: async (_ctx, params) => {
    const { salesAnalytics } = reportingServices();
    const rows = await salesAnalytics.pipelineConversion({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    const STAGE_AR: Record<string, string> = {
      quotations: "عروض الأسعار",
      orders: "أوامر البيع",
      deliveries: "إشعارات التسليم",
      invoices: "الفواتير",
    };
    return {
      columns: [
        col("stage", "المرحلة", "Stage"),
        col("documentCount", "العدد", "Count", "text", true),
        moneyCol("totalNet", "القيمة الصافية", "Net value"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.stage,
        values: {
          stage: STAGE_AR[row.stage] ?? row.stage,
          documentCount: row.documentCount,
          totalNet: row.totalNet,
        },
      })),
      totals: [],
      assertionResults: [await salesGlTieAssertion(params)],
    };
  },
});

export const salesProfitabilityContract = defineReport({
  id: "sales.profitability",
  version: 1,
  title: bilingual("الربحية", "Profitability"),
  category: "sales",
  description: bilingual(
    "الإيراد ناقص التكلفة حسب الصنف والعميل والفرع",
    "Revenue minus COGS by item, customer and branch",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    dimension: z.enum(["item", "customer", "branch"]).optional().default("item"),
  }),
  requiredPermission: "reports.sales.profitability.read",
  dataSources: [
    source(
      "sales",
      "salesAnalytics.{itemRevenue,customerRevenue,branchRevenue}",
      ["sales_invoices", "credit_notes", "sales_invoice_lines"],
      "الإيرادات والتكاليف المرحّلة",
      "Posted revenue and COGS",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted", "credit_note.posted"] },
  assertions: [SALES_TIE],
  run: async (_ctx, params) => {
    const { salesAnalytics } = reportingServices();
    const dimension = params.dimension ?? "item";
    let rows: { key: string; label: string; netSales: string; cogs: string }[] = [];
    if (dimension === "item") {
      const data = await salesAnalytics.itemRevenue({
        fromDate: params.dateFrom!,
        toDate: params.dateTo!,
        branchIds: params.branchIds ?? null,
      });
      rows = data.map((row) => ({
        key: row.itemId,
        label: params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
        netSales: row.netSales,
        cogs: row.cogs,
      }));
    } else if (dimension === "customer") {
      const data = await salesAnalytics.customerRevenue({
        fromDate: params.dateFrom!,
        toDate: params.dateTo!,
        branchIds: params.branchIds ?? null,
      });
      rows = data.map((row) => ({
        key: row.customerId,
        label: params.locale === "ar" ? row.partnerNameAr ?? row.partnerName : row.partnerName,
        netSales: row.netSales,
        cogs: "0.0000",
      }));
    } else {
      const data = await salesAnalytics.branchRevenue({
        fromDate: params.dateFrom!,
        toDate: params.dateTo!,
      });
      rows = data.map((row) => ({
        key: row.branchId ?? "none",
        label: params.locale === "ar" ? row.branchNameAr ?? row.branchName : row.branchName,
        netSales: row.netSales,
        cogs: "0.0000",
      }));
    }
    return {
      columns: [
        col("label", "البُعد", "Dimension"),
        moneyCol("netSales", "صافي المبيعات", "Net sales"),
        moneyCol("cogs", "التكلفة", "COGS"),
        moneyCol("profit", "الربح", "Profit"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.key,
        values: {
          label: row.label,
          netSales: row.netSales,
          cogs: row.cogs,
          profit: (Number(row.netSales) - Number(row.cogs)).toFixed(4),
        },
      })),
      totals: [],
      assertionResults: [await salesGlTieAssertion(params)],
    };
  },
});
