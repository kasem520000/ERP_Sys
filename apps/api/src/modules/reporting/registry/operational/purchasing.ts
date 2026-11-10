import { z } from "zod";

import { assertExact } from "../../application/assertions";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-013 T9 · purchasing contracts (REPORT_CATALOG §3) over
 * `apAnalytics.*` / `apQueries.*` — with the purchasing-gl-tie and the
 * GRNI INV-010 discipline.
 */

const WINDOW_PARAMS = {
  dateFrom: ISO_DATE,
  dateTo: ISO_DATE,
  locale: LOCALE,
};

const PURCHASING_TIE = assertDecl(
  "purchasing-gl-tie",
  "Σ posted invoice gross == GL movement from supplier-invoice entries",
  "المشتريات لا تطابق حركات دفتر الأستاذ",
  "Purchases do not tie to GL movements",
);

export const purchasingBySupplierContract = defineReport({
  id: "purchasing.by-supplier",
  version: 1,
  title: bilingual("المشتريات حسب المورد", "Purchases by Supplier"),
  category: "purchasing",
  description: bilingual("قيمة مشتريات كل مورد في فترة", "Per-supplier purchase value for a period"),
  parameters: z.object({ ...WINDOW_PARAMS, branchIds: z.array(z.string().uuid()).nullish() }),
  requiredPermission: "reports.purchasing.by-supplier.read",
  dataSources: [
    source(
      "purchasing",
      "apAnalytics.supplierSpend",
      ["supplier_invoices", "supplier_invoice_lines"],
      "فواتير الموردين المرحّلة",
      "Posted supplier invoices",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted"] },
  assertions: [PURCHASING_TIE],
  run: async (_ctx, params) => {
    const { apAnalytics } = reportingServices();
    const rows = await apAnalytics.supplierSpend({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("supplierName", "المورد", "Supplier"),
        col("invoiceCount", "عدد الفواتير", "Invoices", "text", true),
        moneyCol("netSpend", "الصافي", "Net"),
        moneyCol("taxAmount", "الضريبة", "Tax"),
        moneyCol("grossSpend", "الإجمالي", "Gross"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.supplierId,
        values: {
          supplierName: params.locale === "ar" ? row.supplierNameAr ?? row.supplierName : row.supplierName,
          invoiceCount: row.invoiceCount,
          netSpend: row.netSpend,
          taxAmount: row.taxAmount,
          grossSpend: row.grossSpend,
        },
      })),
      totals: [],
      assertionResults: [await purchasingTie(params)],
    };
  },
});

export const purchasingByItemContract = defineReport({
  id: "purchasing.by-item",
  version: 1,
  title: bilingual("المشتريات حسب الصنف", "Purchases by Item"),
  category: "purchasing",
  description: bilingual("كميات وقيم مشتريات كل صنف في فترة", "Per-item purchase quantities and values"),
  parameters: z.object({ ...WINDOW_PARAMS, branchIds: z.array(z.string().uuid()).nullish() }),
  requiredPermission: "reports.purchasing.by-item.read",
  dataSources: [
    source(
      "purchasing",
      "apAnalytics.itemSpend",
      ["supplier_invoices", "supplier_invoice_lines"],
      "بنود فواتير الموردين",
      "Supplier invoice lines",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["invoice.posted"] },
  assertions: [PURCHASING_TIE],
  run: async (_ctx, params) => {
    const { apAnalytics } = reportingServices();
    const rows = await apAnalytics.itemSpend({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("sku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        qtyCol("qty", "الكمية", "Qty"),
        moneyCol("netSpend", "القيمة", "Net spend"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.itemId,
        values: {
          sku: row.sku,
          itemName: params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
          qty: row.qty,
          netSpend: row.netSpend,
        },
      })),
      totals: [],
      assertionResults: [await purchasingTie(params)],
    };
  },
});

export const purchasingGrniContract = defineReport({
  id: "purchasing.grni",
  version: 1,
  title: bilingual("سجل المستلم غير المفوتر", "GRNI Register"),
  category: "purchasing",
  description: bilingual(
    "المستلمات غير المفوترة حتى تاريخ مع مطابقة RC-09",
    "Goods received not invoiced as of a date (RC-09 tie)",
  ),
  parameters: z.object({ asOf: ISO_DATE, locale: LOCALE }),
  requiredPermission: "reports.purchasing.grni.read",
  dataSources: [
    source(
      "purchasing",
      "apQueries.grniRegister",
      ["goods_receipts", "supplier_invoices", "supplier_invoice_lines"],
      "الاستلامات غير المفوترة",
      "Un-invoiced receipts",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { dateRange: "optional", asOf: "required" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600 },
  assertions: [
    assertDecl(
      "grni-register-tie",
      "GRNI register total == GRNI account balance",
      "سجل GRNI لا يطابق حساب المستلم غير المفوتر",
      "GRNI register does not tie to the GRNI account",
      "INV-010",
    ),
  ],
  run: async (_ctx, params) => {
    const { ap } = reportingServices();
    const register = await ap.grniRegister(params.asOf!);
    return {
      columns: [
        col("receiptNo", "سجل الاستلام", "Receipt"),
        col("supplier", "المورد", "Supplier"),
        col("receiptDate", "التاريخ", "Date", "date"),
        moneyCol("receivedValue", "القيمة المستلمة", "Received value"),
        moneyCol("invoicedValue", "القيمة المفوترة", "Invoiced value"),
        moneyCol("openValue", "غير المفوتر", "Open value"),
      ],
      groups: [],
      rows: (register as unknown as Record<string, unknown>[]).map((row, index) => ({
        key: String(row.id ?? index),
        values: {
          receiptNo: row.receiptNo as string,
          supplier: (row.supplierName as string) ?? "",
          receiptDate: row.receiptDate as string,
          receivedValue: String(row.receivedValue ?? "0.0000"),
          invoicedValue: String(row.invoicedValue ?? "0.0000"),
          openValue: String(row.openValue ?? row.remaining ?? "0.0000"),
        },
      })),
      totals: [],
      assertionResults: [],
    };
  },
});

export const purchasingPoStatusContract = defineReport({
  id: "purchasing.po-status",
  version: 1,
  title: bilingual("حالة أوامر الشراء", "Purchase Order Status"),
  category: "purchasing",
  description: bilingual(
    "لوحة حالة أوامر الشراء: المطلوب مقابل المستلم مقابل المفوتر",
    "PO status board: ordered vs received vs invoiced",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    openOnly: z.boolean().optional().default(true),
  }),
  requiredPermission: "purchasing.po.read",
  dataSources: [
    source(
      "purchasing",
      "apAnalytics.poStatus",
      ["purchase_orders", "goods_receipts", "supplier_invoices"],
      "حالة أوامر الشراء واستلاماتها وفواتيرها",
      "PO statuses with receipts and invoices",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60 },
  assertions: [PURCHASING_TIE],
  run: async (_ctx, params) => {
    const { apAnalytics } = reportingServices();
    const rows = await apAnalytics.poStatus({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      openOnly: params.openOnly !== false,
    });
    return {
      columns: [
        col("orderNo", "أمر الشراء", "PO"),
        col("orderDate", "التاريخ", "Date", "date"),
        col("supplierName", "المورد", "Supplier"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("totalNet", "قيمة الأمر", "Ordered"),
        moneyCol("receivedValue", "المستلم", "Received"),
        moneyCol("invoicedValue", "المفوتر", "Invoiced"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.poId,
        values: {
          orderNo: row.orderNo,
          orderDate: row.orderDate,
          supplierName: row.supplierName,
          status: row.status,
          totalNet: row.totalNet,
          receivedValue: row.receivedValue,
          invoicedValue: row.invoicedValue,
        },
      })),
      totals: [],
      assertionResults: [await purchasingTie(params)],
    };
  },
});

export const purchasingMatchingExceptionsContract = defineReport({
  id: "purchasing.matching-exceptions",
  version: 1,
  title: bilingual("استثناءات المطابقة الثلاثية", "Three-Way Match Exceptions"),
  category: "purchasing",
  description: bilingual(
    "فواتير الموردين بنتائج مطابقة غير سليمة (سعر/كمية/مستلم مفقود)",
    "Supplier invoices with non-clean match results (price/qty/missing)",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.purchasing.matching.read",
  dataSources: [
    source(
      "purchasing",
      "apAnalytics.matchingExceptions",
      ["supplier_invoices", "goods_receipts", "purchase_orders"],
      "نتائج المطابقة الثلاثية",
      "Three-way match results",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60 },
  assertions: [
    assertDecl(
      "matching-exceptions-consistency",
      "every listed row carries a stored match result",
      "صف بدون نتيجة مطابقة مخزنة",
      "A row without a stored match result",
    ),
  ],
  run: async (_ctx, params) => {
    const { apAnalytics } = reportingServices();
    const rows = await apAnalytics.matchingExceptions({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    const allStored = rows.every((row) => row.matchStatus !== null);
    return {
      columns: [
        col("invoiceNo", "رقم الفاتورة", "Invoice no"),
        col("internalNo", "الرقم الداخلي", "Internal no"),
        col("supplierName", "المورد", "Supplier"),
        col("matchStatus", "حالة المطابقة", "Match status", "status"),
        col("exception", "الاستثناء", "Exception"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.invoiceId,
        values: {
          invoiceNo: row.invoiceNo,
          internalNo: row.internalNo,
          supplierName: row.supplierName,
          matchStatus: row.matchStatus,
          exception: row.exception,
        },
      })),
      totals: [],
      assertionResults: [assertExact("matching-exceptions-consistency", allStored ? "1" : "0", "1")],
    };
  },
});

async function purchasingTie(params: { dateFrom?: string; dateTo?: string }) {
  const { apAnalytics } = reportingServices();
  const tie = await apAnalytics.purchasingGlTie({
    fromDate: params.dateFrom!,
    toDate: params.dateTo!,
  });
  return assertExact("purchasing-gl-tie", tie.documentSide, tie.glSide);
}
