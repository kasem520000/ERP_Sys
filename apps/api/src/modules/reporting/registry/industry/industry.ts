import { z } from "zod";

import { assertExact } from "../../application/assertions";
import { addExact } from "../../../accounting/application/decimal-strings";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";
import { drillRoute } from "../../application/scope";

/**
 * PHASE-015 T10 · the industry report contracts
 * (industries/reports/README PHASE-015 rows — registered over the
 * PHASE-013 contract; the template manifests pin these exact keys):
 *
 * - `inventory.expiry_list` — batches bucketed by days-to-expiry with
 *   value-at-risk and FEFO pick suggestions (grocery / restaurant /
 *   distribution / manufacturing).
 * - `grocery.expiry_writeoff` — the write-off register (reason
 *   EXPIRED/DAMAGE) with the GL tie-out to INVENTORY_SHRINKAGE.
 * - `retail.imei_register` — the IMEI in/out ledger per device with GRN,
 *   sale, and return linkage.
 *
 * Bilingual AR/EN everywhere (Arabic first), money as canonical
 * 4-decimal strings (ADR-0009), read-only derivations over the inventory
 * module's query surfaces via `reportingServices()` — the shared contract
 * supplies parameters, scoping, drill-down, export, and print.
 */

const AS_OF_PARAMS = { asOf: ISO_DATE, locale: LOCALE };
const WINDOW_PARAMS = { dateFrom: ISO_DATE, dateTo: ISO_DATE, locale: LOCALE };

const INV010_TIE = assertDecl(
  "inv010-stock-tie",
  "Σ on-hand value == INVENTORY account balance",
  "قيمة المخزون لا تطابق حساب المخزون في دفتر الأستاذ",
  "Stock value does not tie to the inventory GL account",
  "INV-010",
);

const WRITEOFF_GL_TIE = assertDecl(
  "writeoff-gl-tie",
  "Σ write-off register values == Σ INVENTORY_SHRINKAGE journal debits of the same write-off postings (window)",
  "إجمالي قيم الشطب لا يطابق قيود حساب الهالك في دفتر الأستاذ للفترة",
  "Write-off totals do not tie to the shrinkage GL lines in the window",
  "INV-010/018",
);

const IMEI_LEDGER_TIE = assertDecl(
  "imei-ledger-consistency",
  "every listed device's in/out ledger is consistent (in − out ∈ {0, 1}; every return references a sale)",
  "سجل دخول/خروج غير متسق لأحد الأجهزة، أو إرجاع بلا بيع مرجعي",
  "An inconsistent in/out ledger on a listed device, or a return without a referenced sale",
  "INV-018",
);

async function inv010Assertion(asOf: string) {
  const { inventory } = reportingServices();
  const tie = await inventory.inv010Tie({ asOf });
  return assertExact("inv010-stock-tie", tie.valuationSide, tie.glSide);
}

/** The standard days-to-expiry bucket edges (0–7, 8–30, 31–60, 60+). */
const DEFAULT_BUCKET_EDGES = [7, 30, 60];

function expiryBucket(
  daysToExpiry: number,
  edges: readonly number[],
): { key: string; ar: string; en: string } {
  if (daysToExpiry < 0) {
    return { key: "expired", ar: "منتهية الصلاحية", en: "Already expired" };
  }
  let prev = 0;
  for (const edge of edges) {
    if (daysToExpiry <= edge) {
      return {
        key: `b${prev}_${edge}`,
        ar: `${prev}–${edge} يوم`,
        en: `${prev}–${edge} days`,
      };
    }
    prev = edge + 1;
  }
  const last = edges[edges.length - 1] ?? 0;
  return { key: `b${last}p`, ar: `أكثر من ${last} يوم`, en: `Over ${last} days` };
}

// ---------------------------------------------------------------------------
// inventory.expiry_list — قائمة الصلاحية بالفئات العمرية
// ---------------------------------------------------------------------------

export const inventoryExpiryListContract = defineReport({
  id: "inventory.expiry_list",
  version: 1,
  title: bilingual("قائمة الصلاحية (الفئات العمرية)", "Expiry List (Age Buckets)"),
  category: "industry",
  description: bilingual(
    "الدفعات المتوفرة مصنفة حسب الأيام المتبقية حتى انتهاء الصلاحية، مع القيمة المعرضة للخطر وترتيب الالتقاط FEFO — مقيّدة بحساب المخزون في دفتر الأستاذ (INV-010)",
    "On-hand batches bucketed by days-to-expiry with value at risk and FEFO pick order — tied to the inventory GL account (INV-010)",
  ),
  parameters: z.object({
    ...AS_OF_PARAMS,
    warehouseIds: z.array(z.string().uuid()).nullish(),
    bucketDays: z.array(z.number().int().min(1)).optional().default(DEFAULT_BUCKET_EDGES),
  }),
  requiredPermission: "inventory.stock.read",
  dataSources: [
    source(
      "inventory",
      "industryInventoryQueries.expiryList",
      ["item_batches", "stock_moves", "items", "warehouses"],
      "دفعات الصلاحية وحركات المخزون المسعّرة",
      "Expiry batches and their valued stock moves",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", warehouses: "optional" },
  aggregation: {
    groupBy: [],
    measures: [{ id: "value", kind: "sum" }, { id: "qty", kind: "sum" }],
    sorting: [{ by: "expiryDate", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600, invalidationEvents: ["journal.posted"] },
  assertions: [INV010_TIE],
  run: async (_ctx, params) => {
    const { industryInventory } = reportingServices();
    const edges = params.bucketDays ?? DEFAULT_BUCKET_EDGES;
    const rows = await industryInventory.expiryList({
      asOf: params.asOf!,
      warehouseIds: params.warehouseIds ?? undefined,
    });
    let valueAtRisk = "0.0000";
    const reportRows = rows.map((row) => {
      valueAtRisk = addExact(valueAtRisk, row.value);
      const bucket = expiryBucket(row.daysToExpiry, edges);
      return {
        key: `${row.batchId}:${row.warehouseId}`,
        values: {
          sku: row.sku,
          itemName: params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
          batchNo: row.batchNo,
          warehouseCode: row.warehouseCode,
          expiryDate: row.expiryDate,
          daysToExpiry: row.daysToExpiry,
          bucket: params.locale === "ar" ? bucket.ar : bucket.en,
          qty: row.qty,
          value: row.value,
          fefoRank: row.fefoRank,
        },
      };
    });
    return {
      columns: [
        col("sku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        col("batchNo", "الدفعة", "Batch"),
        col("warehouseCode", "المستودع", "Warehouse"),
        col("expiryDate", "الانتهاء", "Expiry", "date"),
        col("daysToExpiry", "الأيام المتبقية", "Days left", "text", true),
        col("bucket", "الفئة العمرية", "Bucket", "status"),
        qtyCol("qty", "الكمية", "Qty"),
        moneyCol("value", "القيمة المعرضة للخطر", "Value at risk"),
        col("fefoRank", "ترتيب FEFO", "FEFO pick", "qty", true),
      ],
      groups: [],
      rows: reportRows,
      totals: [
        {
          id: "valueAtRisk",
          kind: "sum",
          label: bilingual("إجمالي القيمة المعرضة للخطر", "Total value at risk"),
          amount: valueAtRisk,
        },
      ],
      assertionResults: [await inv010Assertion(params.asOf!)],
      notes: [
        bilingual(
          "اقتراح الالتقاط FEFO: الترتيب 1 = أقرب دفعة انتهاءً لكل صنف ومستودع.",
          "FEFO pick suggestion: rank 1 = the earliest-expiring batch of the item per warehouse.",
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// grocery.expiry_writeoff — سجل شطب المنتهي والتالف
// ---------------------------------------------------------------------------

export const groceryExpiryWriteoffContract = defineReport({
  id: "grocery.expiry_writeoff",
  version: 1,
  title: bilingual("سجل شطب المنتهي والتالف", "Expiry / Damage Write-off Register"),
  category: "industry",
  description: bilingual(
    "حركات الشطب (السبب EXPIRED أو DAMAGE) في فترة معينة مع قيمة التكلفة والمستند المصدر، وإجماليات لكل سبب، ومطابقة إلزامية مع قيود حساب الهالك في دفتر الأستاذ",
    "Write-off moves (reason EXPIRED or DAMAGE) in a window with cost value and source document, totals per reason, and the mandatory tie-out to the shrinkage GL account",
  ),
  parameters: z.object({ ...WINDOW_PARAMS, warehouseIds: z.array(z.string().uuid()).nullish() }),
  requiredPermission: "inventory.moves.read",
  dataSources: [
    source(
      "inventory",
      "industryInventoryQueries.writeoffRegister",
      ["stock_moves", "stock_adjustments", "item_batches", "items", "warehouses"],
      "حركات الشطب المنتهي/التالف مع المستندات المصدر",
      "Expired/damaged write-off moves with their source documents",
    ),
    source(
      "accounting",
      "journal (writeoff GL tie)",
      ["journal_lines", "journal_entries"],
      "قيود حساب الهالك للمطابقة",
      "The shrinkage-account journal lines for the tie-out",
    ),
  ],
  scopeRules: { warehouses: "optional", asOf: "forbidden" },
  aggregation: {
    groupBy: ["reason"],
    measures: [{ id: "valueAmount", kind: "sum" }, { id: "qty", kind: "sum" }],
    sorting: [{ by: "movedAt", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: true },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [WRITEOFF_GL_TIE],
  run: async (_ctx, params) => {
    const { industryInventory } = reportingServices();
    const rows = await industryInventory.writeoffRegister({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      warehouseIds: params.warehouseIds ?? undefined,
    });
    const tie = await industryInventory.writeoffGlTie({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    let expiredTotal = "0.0000";
    let damagedTotal = "0.0000";
    for (const row of rows) {
      if (row.reason === "EXPIRED") {
        expiredTotal = addExact(expiredTotal, row.valueAmount);
      } else if (row.reason === "DAMAGE") {
        damagedTotal = addExact(damagedTotal, row.valueAmount);
      }
    }
    return {
      columns: [
        col("movedAt", "التاريخ", "Date", "date"),
        col("itemSku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        col("warehouseCode", "المستودع", "Warehouse"),
        col("batchNo", "الدفعة", "Batch"),
        qtyCol("qty", "الكمية", "Qty"),
        moneyCol("valueAmount", "قيمة التكلفة", "Cost value"),
        col("reason", "السبب", "Reason", "status"),
        col("sourceType", "نوع المصدر", "Source type"),
        col("sourceRef", "المستند المصدر", "Source document"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.moveId,
        values: {
          movedAt: row.movedAt,
          itemSku: row.itemSku,
          itemName: params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
          warehouseCode: row.warehouseCode,
          batchNo: row.batchNo,
          qty: row.qty,
          valueAmount: row.valueAmount,
          reason: row.reason,
          sourceType: row.sourceType,
          sourceRef: row.sourceRef,
        },
      })),
      totals: [
        {
          id: "expiredTotal",
          kind: "sum",
          label: bilingual("إجمالي الشطب — منتهي الصلاحية", "Write-off total — expired"),
          amount: expiredTotal,
        },
        {
          id: "damagedTotal",
          kind: "sum",
          label: bilingual("إجمالي الشطب — تالف", "Write-off total — damaged"),
          amount: damagedTotal,
        },
        {
          id: "writeoffTotal",
          kind: "sum",
          label: bilingual("إجمالي الشطب", "Write-off total"),
          amount: addExact(expiredTotal, damagedTotal),
        },
      ],
      assertionResults: [assertExact("writeoff-gl-tie", tie.registerSide, tie.glSide)],
      notes: [],
    };
  },
});

// ---------------------------------------------------------------------------
// retail.imei_register — سجل أجهزة IMEI (الدخول/الخروج)
// ---------------------------------------------------------------------------

export const retailImeiRegisterContract = defineReport({
  id: "retail.imei_register",
  version: 1,
  title: bilingual("سجل أجهزة IMEI (الدخول/الخروج)", "IMEI Register (In/Out Ledger)"),
  category: "industry",
  description: bilingual(
    "سجل دخول وخروج كل جهاز برقم مسلسل أو IMEI: سند الاستلام (GRN)، فاتورة البيع، ومرجع الإرجاع إن وُجد، مع التعمق إلى المستندات المصدر",
    "The per-device IMEI in/out ledger: GRN reference (in), sale reference (out), and return linkage where present, with drill-down to the source documents",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE.optional(),
    dateTo: ISO_DATE.optional(),
    itemId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "inventory.serials.read",
  dataSources: [
    source(
      "inventory",
      "industryInventoryQueries.imeiRegister",
      ["item_serials", "stock_moves", "items"],
      "سجل أجهزة المسلسلات وحركاتها",
      "The serial/IMEI registry and its moves",
    ),
    source(
      "purchasing",
      "goods_receipts (GRN linkage)",
      ["goods_receipts"],
      "ربط سندات الاستلام",
      "The goods-receipt linkage",
    ),
    source(
      "sales",
      "sales_invoices + credit_notes (sale/return linkage)",
      ["sales_invoices", "credit_notes"],
      "ربط فواتير البيع والإرجاع",
      "The sale and return linkage",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden" },
  aggregation: {
    groupBy: [],
    measures: [{ id: "devices", kind: "count" }],
    sorting: [{ by: "serialNo", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  drillTargets: [
    drill(
      "grnRef",
      "/{locale}/purchasing/goods-receipts/{grnId}",
      "سند الاستلام",
      "Goods receipt",
      "purchasing.goods_receipts.view",
    ),
    drill(
      "saleRef",
      "/{locale}/sales/invoices/{saleId}",
      "فاتورة البيع",
      "Sales invoice",
      "sales.invoices.view",
    ),
    drill(
      "returnRef",
      "/{locale}/sales/credit-notes/{returnId}",
      "إشعار دائن الإرجاع",
      "Return credit note",
      "sales.credit_notes.view",
    ),
  ],
  assertions: [IMEI_LEDGER_TIE],
  run: async (ctx, params) => {
    const { industryInventory } = reportingServices();
    const rows = await industryInventory.imeiRegister({
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      itemId: params.itemId,
    });
    let violations = 0;
    const reportRows = rows.map((row) => {
      const net = row.inCount - row.outCount;
      const returnedWithoutSale = row.returnRef !== null && row.saleRef === null;
      if ((net !== 0 && net !== 1) || returnedWithoutSale) {
        violations += 1;
      }
      const drillLinks: { label: { ar: string; en: string }; route: string }[] = [];
      if (row.grnId !== null) {
        const route = drillRoute(
          ctx,
          `/${params.locale}/purchasing/goods-receipts/${row.grnId}`,
          "purchasing.goods_receipts.view",
        );
        if (route !== null) {
          drillLinks.push({ label: bilingual("سند الاستلام", "Goods receipt"), route });
        }
      }
      if (row.saleId !== null) {
        const route = drillRoute(
          ctx,
          `/${params.locale}/sales/invoices/${row.saleId}`,
          "sales.invoices.view",
        );
        if (route !== null) {
          drillLinks.push({ label: bilingual("فاتورة البيع", "Sales invoice"), route });
        }
      }
      if (row.returnId !== null) {
        const route = drillRoute(
          ctx,
          `/${params.locale}/sales/credit-notes/${row.returnId}`,
          "sales.credit_notes.view",
        );
        if (route !== null) {
          drillLinks.push({ label: bilingual("إشعار دائن الإرجاع", "Return credit note"), route });
        }
      }
      return {
        key: row.serialId,
        values: {
          serialNo: row.serialNo,
          imei: row.imei,
          itemSku: row.itemSku,
          itemName: params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
          status: row.status,
          currentOwner: row.currentOwner,
          receivedAt: row.receivedAt,
          grnRef: row.grnRef,
          saleRef: row.saleRef,
          soldAt: row.soldAt,
          returnRef: row.returnRef,
          returnedAt: row.returnedAt,
        },
        drillLinks,
      };
    });
    return {
      columns: [
        col("serialNo", "المسلسل", "Serial"),
        col("imei", "IMEI", "IMEI"),
        col("itemSku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        col("status", "الحالة", "Status", "status"),
        col("currentOwner", "الحائز", "Custody"),
        col("receivedAt", "تاريخ الاستلام", "Received", "date"),
        col("grnRef", "سند الاستلام", "GRN"),
        col("saleRef", "فاتورة البيع", "Sale"),
        col("soldAt", "تاريخ البيع", "Sold", "date"),
        col("returnRef", "مرجع الإرجاع", "Return"),
      ],
      groups: [],
      rows: reportRows,
      totals: [
        {
          id: "devices",
          kind: "sum",
          label: bilingual("عدد الأجهزة", "Devices"),
          amount: String(rows.length),
        },
      ],
      assertionResults: [assertExact("imei-ledger-consistency", String(violations), "0")],
      notes: [
        bilingual(
          "النافذة الزمنية — إن حُددت — تنطبق على تاريخ دخول الجهاز المخزون (أول حركة استلام).",
          "The window, when given, applies to the device's goods-in date (first IN move).",
        ),
      ],
    };
  },
});
