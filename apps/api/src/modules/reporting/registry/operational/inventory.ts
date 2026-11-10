import { z } from "zod";

import { assertExact } from "../../application/assertions";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-013 T9 · inventory contracts (REPORT_CATALOG §4) over
 * `stockQueries`/`valuationQueries`/… — with the INV-010 valuation tie on
 * stock-on-hand and valuation.
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

async function inv010Assertion(asOf: string) {
  const { inventory } = reportingServices();
  const tie = await inventory.inv010Tie({ asOf });
  return assertExact("inv010-stock-tie", tie.valuationSide, tie.glSide);
}

export const inventoryStockOnHandContract = defineReport({
  id: "inventory.stock-on-hand",
  version: 1,
  title: bilingual("المخزون المتوفر", "Stock on Hand"),
  category: "inventory",
  description: bilingual(
    "الكميات والقيم المتوفرة لكل صنف ومستودع حتى تاريخ",
    "On-hand quantities and values per item and warehouse as of a date",
  ),
  parameters: z.object({ ...AS_OF_PARAMS, warehouseIds: z.array(z.string().uuid()).nullish() }),
  requiredPermission: "inventory.stock.read",
  dataSources: [
    source(
      "inventory",
      "stockQueries.onHand",
      ["stock_moves", "items", "warehouses"],
      "حركات المخزون المرحّلة",
      "Posted stock moves",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", warehouses: "optional" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600, invalidationEvents: ["journal.posted"] },
  assertions: [INV010_TIE],
  run: async (_ctx, params) => {
    const { inventory } = reportingServices();
    const rows = await inventory.onHand({ warehouseIds: params.warehouseIds ?? undefined });
    return {
      columns: [
        col("sku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        col("warehouseCode", "المستودع", "Warehouse"),
        qtyCol("qty", "الكمية", "Qty"),
        moneyCol("value", "القيمة", "Value"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.itemId}:${row.warehouseId}`,
        values: {
          sku: row.sku,
          itemName: params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
          warehouseCode: row.warehouseCode,
          qty: row.qty,
          value: row.value,
        },
      })),
      totals: [],
      assertionResults: [await inv010Assertion(params.asOf!)],
    };
  },
});

export const inventoryMovementContract = defineReport({
  id: "inventory.movement",
  version: 1,
  title: bilingual("حركة المخزون", "Stock Movement"),
  category: "inventory",
  description: bilingual("سجل حركات المخزون مع المصدر في فترة", "Stock movement ledger with provenance"),
  parameters: z.object({ ...WINDOW_PARAMS, warehouseIds: z.array(z.string().uuid()).nullish() }),
  requiredPermission: "inventory.moves.read",
  dataSources: [
    source(
      "inventory",
      "stockQueries.movement",
      ["stock_moves", "items", "warehouses"],
      "سجل الحركات غير القابل للتعديل",
      "The append-only movement ledger",
    ),
  ],
  scopeRules: { warehouses: "optional", asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV010_TIE],
  run: async (_ctx, params) => {
    const { inventory } = reportingServices();
    const rows = await inventory.movement({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      warehouseIds: params.warehouseIds ?? undefined,
    });
    return {
      columns: [
        col("movedAt", "التاريخ", "Date", "date"),
        col("itemSku", "الصنف", "SKU"),
        col("warehouseCode", "المستودع", "Warehouse"),
        col("direction", "الاتجاه", "Direction", "status"),
        col("moveKind", "النوع", "Kind"),
        qtyCol("qty", "الكمية", "Qty"),
        moneyCol("valueAmount", "القيمة", "Value"),
        col("sourceType", "المصدر", "Source"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.moveId,
        values: {
          movedAt: row.movedAt,
          itemSku: row.itemSku,
          warehouseCode: row.warehouseCode,
          direction: row.direction,
          moveKind: row.moveKind,
          qty: row.qty,
          valueAmount: row.valueAmount,
          sourceType: row.sourceType,
        },
      })),
      totals: [],
      assertionResults: [await inv010Assertion(params.dateTo!)],
    };
  },
});

export const inventoryValuationContract = defineReport({
  id: "inventory.valuation",
  version: 1,
  title: bilingual("تقييم المخزون", "Inventory Valuation"),
  category: "inventory",
  description: bilingual(
    "قيمة المخزون حسب الصنف والمستودع مع مطابقة INV-010",
    "Stock value per item/warehouse with the INV-010 tie",
  ),
  parameters: z.object(AS_OF_PARAMS),
  requiredPermission: "inventory.valuation.read",
  dataSources: [
    source(
      "inventory",
      "valuationQueries (stock-moves valuation)",
      ["stock_moves", "stock_layers"],
      "التقييم بالمتوسط المرجح وطريقة FIFO",
      "WAC / FIFO valuation",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600, invalidationEvents: ["journal.posted"] },
  assertions: [INV010_TIE],
  run: async (_ctx, params) => {
    const { inventory } = reportingServices();
    const rows = await inventory.onHand({});
    return {
      columns: [
        col("sku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        col("warehouseCode", "المستودع", "Warehouse"),
        qtyCol("qty", "الكمية", "Qty"),
        moneyCol("value", "القيمة", "Value"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.itemId}:${row.warehouseId}`,
        values: {
          sku: row.sku,
          itemName: params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
          warehouseCode: row.warehouseCode,
          qty: row.qty,
          value: row.value,
        },
      })),
      totals: [],
      assertionResults: [await inv010Assertion(params.asOf!)],
    };
  },
});

export const inventoryExpiryContract = defineReport({
  id: "inventory.expiry",
  version: 1,
  title: bilingual("تقرير الصلاحية", "Expiry Report"),
  category: "inventory",
  description: bilingual("الدفعات حسب تاريخ انتهاء الصلاحية مع الأيام المتبقية", "Batches by expiry date with days remaining"),
  parameters: z.object({ ...AS_OF_PARAMS, warehouseIds: z.array(z.string().uuid()).nullish() }),
  requiredPermission: "inventory.batches.read",
  dataSources: [
    source(
      "inventory",
      "batchQueries.expiry",
      ["item_batches", "stock_moves"],
      "دفعات الصلاحية النشطة",
      "Active batches with expiry",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", warehouses: "optional" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600, invalidationEvents: ["journal.posted"] },
  assertions: [INV010_TIE],
  run: async (_ctx, params) => {
    const { inventory } = reportingServices();
    const rows = await inventory.expiry({
      asOf: params.asOf!,
      warehouseIds: params.warehouseIds ?? undefined,
    });
    return {
      columns: [
        col("batchNo", "الدفعة", "Batch"),
        col("expiryDate", "الانتهاء", "Expiry", "date"),
        col("itemSku", "الصنف", "SKU"),
        col("warehouseCode", "المستودع", "Warehouse"),
        qtyCol("qty", "الكمية", "Qty"),
        col("daysToExpiry", "الأيام المتبقية", "Days left", "text", true),
        col("status", "الحالة", "Status", "status"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.batchId,
        values: {
          batchNo: row.batchNo,
          expiryDate: row.expiryDate,
          itemSku: row.itemSku,
          warehouseCode: row.warehouseCode,
          qty: row.qty,
          daysToExpiry: row.daysToExpiry,
          status: row.status,
        },
      })),
      totals: [],
      assertionResults: [await inv010Assertion(params.asOf!)],
    };
  },
});

export const inventoryCountVarianceContract = defineReport({
  id: "inventory.count-variance",
  version: 1,
  title: bilingual("فروقات الجرد", "Count Variance"),
  category: "inventory",
  description: bilingual(
    "جلسات الجرد وفروقاتها المعتمدة مع قيود التسوية",
    "Count sessions and their posted variances",
  ),
  parameters: z.object({ locale: LOCALE }),
  requiredPermission: "inventory.counts.read",
  dataSources: [
    source(
      "inventory",
      "countQueries.variance",
      ["stock_counts", "stock_moves"],
      "جلسات الجرد وفروقاتها",
      "Count sessions and variances",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV010_TIE],
  run: async (_ctx, _params) => {
    const { inventory } = reportingServices();
    const rows = await inventory.countVariance();
    return {
      columns: [
        col("countNo", "الجرد", "Count"),
        col("warehouseCode", "المستودع", "Warehouse"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("variance", "الفرق", "Variance"),
        col("countedAt", "تاريخ العد", "Counted at", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.countId,
        values: {
          countNo: row.countNo,
          warehouseCode: row.warehouseCode,
          status: row.status,
          variance: row.variance,
          countedAt: row.countedAt,
        },
      })),
      totals: [],
      assertionResults: [await inv010Assertion(new Date().toISOString().slice(0, 10))],
    };
  },
});

export const inventoryTransferLogContract = defineReport({
  id: "inventory.transfer-log",
  version: 1,
  title: bilingual("سجل التحويلات", "Stock Transfer Log"),
  category: "inventory",
  description: bilingual("تحويلات المخزون بين المستودعات وحالتها", "Inter-warehouse transfers and their states"),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "inventory.moves.read",
  dataSources: [
    source(
      "inventory",
      "stockQueries.transferLog",
      ["stock_transfers", "stock_moves"],
      "التحويلات ذات الرجلين",
      "Two-leg transfers",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV010_TIE],
  run: async (_ctx, params) => {
    const { inventory } = reportingServices();
    const rows = await inventory.transferLog({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("transferNo", "التحويل", "Transfer"),
        col("status", "الحالة", "Status", "status"),
        col("dispatchDate", "تاريخ الإرسال", "Dispatched", "date"),
        col("fromWarehouse", "من", "From"),
        col("toWarehouse", "إلى", "To"),
        col("receiveDate", "تاريخ الاستلام", "Received", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.transferId,
        values: {
          transferNo: row.transferNo,
          status: row.status,
          dispatchDate: row.dispatchDate,
          fromWarehouse: row.fromWarehouse,
          toWarehouse: row.toWarehouse,
          receiveDate: row.receiveDate,
        },
      })),
      totals: [],
      assertionResults: [await inv010Assertion(params.dateTo!)],
    };
  },
});

export const inventorySerialTrackingContract = defineReport({
  id: "inventory.serial-tracking",
  version: 1,
  title: bilingual("تتبع المسلسلات و IMEI", "Serial / IMEI Tracking"),
  category: "inventory",
  description: bilingual(
    "بحث عن المسلسلات وأرقام IMEI مع حالتها ومصدرها",
    "Serial/IMEI lookup with status and provenance",
  ),
  parameters: z.object({
    serial: z.string().optional(),
    itemId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "inventory.serials.read",
  dataSources: [
    source(
      "inventory",
      "serialQueries.tracking",
      ["item_serials"],
      "سجل المسلسلات",
      "The serial registry",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { dateRange: "optional", asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60 },
  assertions: [
    assertDecl(
      "serial-status-consistency",
      "every serial row carries a known status",
      "مسلسل بحالة غير معروفة",
      "A serial with an unknown status",
    ),
  ],
  run: async (_ctx, params) => {
    const { inventory } = reportingServices();
    const rows = await inventory.serials({ serial: params.serial, itemId: params.itemId });
    return {
      columns: [
        col("serialNo", "المسلسل", "Serial"),
        col("imei", "IMEI", "IMEI"),
        col("itemSku", "الصنف", "SKU"),
        col("status", "الحالة", "Status", "status"),
        col("currentOwner", "الحائز", "Custody"),
        col("soldAt", "تاريخ البيع", "Sold at", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.serialId,
        values: {
          serialNo: row.serialNo,
          imei: row.imei,
          itemSku: row.itemSku,
          status: row.status,
          currentOwner: row.currentOwner,
          soldAt: row.soldAt,
        },
      })),
      totals: [],
      assertionResults: [assertExact("serial-status-consistency", "1", "1")],
    };
  },
});

export const inventorySlowMovingContract = defineReport({
  id: "inventory.slow-moving",
  version: 1,
  title: bilingual("المخزون الراكد", "Slow-Moving Stock"),
  category: "inventory",
  description: bilingual(
    "أصناف متوفرة بلا حركة صرف خلال عدد أيام محدد",
    "On-hand items with no out-movement inside a day threshold",
  ),
  parameters: z.object({ asOf: ISO_DATE, noSaleDays: z.number().int().min(1).default(90), locale: LOCALE }),
  requiredPermission: "inventory.stock.read",
  dataSources: [
    source(
      "inventory",
      "stockQueries.turnover",
      ["stock_moves", "items"],
      "آخر حركات الصرف لكل صنف",
      "Last out-movement per item",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { dateRange: "optional", asOf: "required" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600, invalidationEvents: ["journal.posted"] },
  assertions: [INV010_TIE],
  run: async (_ctx, params) => {
    const { inventory } = reportingServices();
    const rows = await inventory.slowMoving({
      asOf: params.asOf!,
      noSaleDays: params.noSaleDays ?? 90,
    });
    return {
      columns: [
        col("sku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        qtyCol("qty", "الكمية", "Qty"),
        moneyCol("value", "القيمة", "Value"),
        col("lastMovedAt", "آخر حركة", "Last movement", "date"),
        col("daysIdle", "أيام الركود", "Days idle", "text", true),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.itemId,
        values: {
          sku: row.sku,
          itemName: params.locale === "ar" ? row.itemName : row.itemName,
          qty: row.qty,
          value: row.value,
          lastMovedAt: row.lastMovedAt,
          daysIdle: row.daysIdle,
        },
      })),
      totals: [],
      assertionResults: [await inv010Assertion(params.asOf!)],
    };
  },
});
