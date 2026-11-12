import { z } from "zod";

import { LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-044 T-17 · the four WMS intelligence contracts (REPORT_CATALOG §4
 * additions): the bin-contents register (BR-076's owner visibility + the
 * INV-029 fold tie), the cycle-count variance register (the §2.6
 * cycle_count_documents family — the legacy `inventory.count-variance`
 * report reads the PHASE-010 stock_counts sessions and stays), the ABC
 * classification (the latest generation), and the slow-movement
 * intelligence view (the ABC-joined no-outbound fold with the bin spread —
 * the slotting-hint angle over the T-12 alert's shape; the PHASE-013
 * item-level `inventory.slow-moving` stays).
 */

const UUID_OPTIONAL = z.string().uuid().nullish();
const STATUS = z.enum(["AVAILABLE", "QUARANTINE", "HOLD"]).optional();
const CLS = z.enum(["A", "B", "C"]).optional();

const INV029_TIE = assertDecl(
  "inv029-bins-stock-tie",
  "Σ tenant-owned bin_contents == item_stock per (warehouse, item)",
  "مجموع محتويات الصناديق (الملك الذاتي) لا يطابق أرصدة الأصناف",
  "Tenant-owned bin contents do not tie to item stock",
  "INV-029",
);

const ABC_CLASS_SHAPE = assertDecl(
  "abc-class-shape",
  "every row carries a canonical class A/B/C and a 4dp consumption value",
  "صف بفئة غير معروفة أو قيمة استهلاك بصيغة غير سليمة",
  "A row with an unknown class or a malformed consumption value",
);

export const inventoryBinContentsContract = defineReport({
  id: "inventory.bin-contents",
  version: 1,
  title: bilingual("محتويات الصناديق", "Bin Contents"),
  category: "inventory",
  description: bilingual(
    "لكل صندوق: الصنف والدفعة والتسلسلي والحالة والكمية والملكية (مخزون الأمانة يظهر بمالكه)",
    "Per bin: item, batch, serial, status, qty, and ownership (consignment rows appear with their owner)",
  ),
  parameters: z.object({ warehouseId: UUID_OPTIONAL, status: STATUS, locale: LOCALE }),
  requiredPermission: "inventory.wms.locations",
  dataSources: [
    source(
      "inventory",
      "wmsQueries.binContents",
      ["bin_contents", "warehouse_bins", "warehouse_zones"],
      "سجل محتويات الصناديق مع هوية الموقع والملكية",
      "The bin-contents register with location identity and ownership",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV029_TIE],
  run: async (_ctx, params) => {
    const { wmsQueries } = reportingServices();
    const rows = await wmsQueries.binContents({
      warehouseId: (params.warehouseId as string | undefined) ?? undefined,
      status: params.status as "AVAILABLE" | "QUARANTINE" | "HOLD" | undefined,
    });
    // The INV-029 fold: Σ tenant-owned rows must equal the item-stock side
    // (the report runs the same probe the nightly job runs — the detector,
    // never the repairer).
    const mismatches = await wmsQueries.binStockTie({
      warehouseId: (params.warehouseId as string | undefined) ?? undefined,
    });
    const inv029Ok = mismatches.length === 0;
    const tenantQty = rows
      .filter((row) => row.ownerPartnerName === null)
      .reduce((sum, row) => sum + Number(row.qty), 0);
    const consignmentQty = rows
      .filter((row) => row.ownerPartnerName !== null)
      .reduce((sum, row) => sum + Number(row.qty), 0);
    return {
      columns: [
        col("warehouseCode", "المستودع", "Warehouse"),
        col("binCode", "الصندوق", "Bin"),
        col("zoneCode", "المنطقة", "Zone"),
        col("itemSku", "الصنف", "Item"),
        col("batchNo", "الدفعة", "Batch"),
        col("serialNo", "التسلسلي", "Serial"),
        col("status", "الحالة", "Status", "status"),
        qtyCol("qty", "الكمية", "Qty"),
        col("lpnCode", "لوحة الترخيص", "LPN"),
        col("ownerPartnerName", "المالك", "Owner"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.contentId,
        values: {
          warehouseCode: row.warehouseCode ?? "—",
          binCode: row.binCode,
          zoneCode: row.zoneCode ?? "—",
          itemSku: row.itemSku ?? row.contentId.slice(0, 8),
          batchNo: row.batchNo ?? "—",
          serialNo: row.serialNo ?? "—",
          status: row.status,
          qty: row.qty,
          lpnCode: row.lpnCode ?? "—",
          ownerPartnerName: row.ownerPartnerName ?? "—",
        },
      })),
      totals: [
        {
          id: "tenant-qty-total",
          kind: "sum",
          label: bilingual(
            `صفوف: ${rows.length} · كمية الملك الذاتي: ${tenantQty.toFixed(6)} · كمية الأمانة (مستثناة من التقييم): ${consignmentQty.toFixed(6)}`,
            `rows: ${rows.length} · tenant-owned qty: ${tenantQty.toFixed(6)} · consignment qty (valuation-excluded): ${consignmentQty.toFixed(6)}`,
          ),
          amount: `${tenantQty.toFixed(6)}`,
        },
      ],
      assertionResults: [
        {
          id: "inv029-bins-stock-tie",
          status: inv029Ok ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            inv029Ok
              ? "مطابقة تامة بين مجموع الصناديق والأرصدة"
              : `${mismatches.length} انحرافاً بين الصناديق والأرصدة — راجع تقرير المطابقة`,
            inv029Ok
              ? "Σ bins ties to item stock everywhere"
              : `${mismatches.length} bin/stock mismatch(es) — review the reconciliation report`,
          ),
        },
      ],
      notes: [
        bilingual(
          "مخزون الأمانة (عمود المالك) يُستثنى من التقييم وATP بموجب BR-076 ويظهر هنا للشفافية فقط.",
          "Consignment stock (the Owner column) is valuation- and ATP-excluded per BR-076 and appears here for visibility only.",
        ),
      ],
    };
  },
});

export const inventoryCycleCountVarianceContract = defineReport({
  id: "inventory.cycle-count-variance",
  version: 1,
  title: bilingual("فروقات الجرد الدوري", "Cycle-Count Variance"),
  category: "inventory",
  description: bilingual(
    "مستندات الجرد الدوري وبنودها وفروقاتها الكمية والقيمية مع أسباب CYCLE_COUNT (تقرير PHASE-010 يبقى لجلسات stock_counts)",
    "The cycle-count documents and their lines with qty/value variances and CYCLE_COUNT reasons (the PHASE-010 report stays for stock_counts sessions)",
  ),
  parameters: z.object({ warehouseId: UUID_OPTIONAL, postedOnly: z.boolean().optional(), locale: LOCALE }),
  requiredPermission: "inventory.cycle_counts",
  dataSources: [
    source(
      "inventory",
      "wmsQueries.cycleCountVariance",
      ["cycle_count_documents", "cycle_count_lines"],
      "بنود مستندات الجرد الدوري وفروقاتها",
      "The cycle-count document lines and their variances",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { dateRange: "optional", asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [
    assertDecl(
      "cycle-count-variance-consistent",
      "every rendered variance equals counted − system exactly (the displayed math is the stored math)",
      "فرق معروض لا يساوي (المعدود − الدفتري)",
      "A rendered variance differs from counted − system",
    ),
  ],
  run: async (_ctx, params) => {
    const { wmsQueries } = reportingServices();
    const rows = await wmsQueries.cycleCountVariance({
      warehouseId: (params.warehouseId as string | undefined) ?? undefined,
      postedOnly: (params.postedOnly as boolean | undefined) ?? false,
    });
    const varianceOk = rows.every((row) => {
      if (row.countedQty === null || row.varianceQty === null) return true;
      const rendered = (Number(row.countedQty) - Number(row.systemQty)).toFixed(6);
      return rendered === Number(row.varianceQty).toFixed(6);
    });
    const lossTotal = rows
      .filter((row) => row.valueImpact !== null && Number(row.valueImpact) < 0)
      .reduce((sum, row) => sum + Math.abs(Number(row.valueImpact)), 0);
    const gainTotal = rows
      .filter((row) => row.valueImpact !== null && Number(row.valueImpact) > 0)
      .reduce((sum, row) => sum + Number(row.valueImpact), 0);
    return {
      columns: [
        col("countNo", "الجرد", "Count"),
        col("warehouseCode", "المستودع", "Warehouse"),
        col("lineNo", "البند", "Line"),
        col("itemSku", "الصنف", "Item"),
        col("binCode", "الصندوق", "Bin"),
        col("batchNo", "الدفعة", "Batch"),
        qtyCol("systemQty", "الدفتري", "System"),
        qtyCol("countedQty", "المعدود", "Counted"),
        qtyCol("varianceQty", "الفرق", "Variance"),
        moneyCol("valueImpact", "الأثر", "Impact"),
        col("reason", "السبب", "Reason"),
        col("status", "الحالة", "Status", "status"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.documentId}:${row.lineNo}`,
        values: {
          countNo: row.countNo ?? row.documentId.slice(0, 8),
          warehouseCode: row.warehouseCode ?? "—",
          lineNo: `${row.lineNo}`,
          itemSku: row.itemSku ?? "—",
          binCode: row.binCode ?? "—",
          batchNo: row.batchNo ?? "—",
          systemQty: row.systemQty,
          countedQty: row.countedQty ?? "—",
          varianceQty: row.varianceQty ?? "—",
          valueImpact: row.valueImpact ?? "—",
          reason: row.reason ?? "—",
          status: row.status,
        },
      })),
      totals: [
        {
          id: "variance-totals",
          kind: "sum",
          label: bilingual(
            `بنود: ${rows.length} · خسارة: ${lossTotal.toFixed(4)} · زيادة: ${gainTotal.toFixed(4)}`,
            `lines: ${rows.length} · loss: ${lossTotal.toFixed(4)} · gain: ${gainTotal.toFixed(4)}`,
          ),
          amount: `${(gainTotal - lossTotal).toFixed(4)}`,
        },
      ],
      assertionResults: [
        {
          id: "cycle-count-variance-consistent",
          status: varianceOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            varianceOk ? "كل الفروق المعروضة تطابق (المعدود − الدفتري)" : "فرق معروض لا يطابق الجمع",
            varianceOk ? "every rendered variance equals counted − system" : "a rendered variance mismatches",
          ),
        },
      ],
      notes: [
        bilingual(
          "الترحيل يعتمد أشكال G-13/G-14 بأسباب CYCLE_COUNT_LOSS/GAIN؛ عتبة الاعتماد BR-075 تحكم المشرف.",
          "Posting rides the G-13/G-14 shapes with CYCLE_COUNT_LOSS/GAIN reasons; BR-075's threshold governs the supervisor gate.",
        ),
      ],
    };
  },
});

export const inventoryAbcClassificationContract = defineReport({
  id: "inventory.abc-classification",
  version: 1,
  title: bilingual("تصنيف ABC", "ABC Classification"),
  category: "inventory",
  description: bilingual(
    "أحدث توليد تصنيف ABC: الترتيب والفئة وقيمة الاستهلاك والسرعة داخل نافذة الحركة",
    "The latest ABC generation: rank, class, consumption value, and velocity over the movement window",
  ),
  parameters: z.object({ cls: CLS, locale: LOCALE }),
  requiredPermission: "inventory.abc",
  dataSources: [
    source(
      "inventory",
      "wmsQueries.abcClassification",
      ["abc_classifications"],
      "أحدث توليد تصنيف ABC (is_latest)",
      "The latest ABC generation (is_latest)",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 3600, invalidationEvents: [] },
  assertions: [ABC_CLASS_SHAPE],
  run: async (_ctx, params) => {
    const { wmsQueries } = reportingServices();
    const rows = await wmsQueries.abcClassification({
      cls: params.cls as "A" | "B" | "C" | undefined,
    });
    const shapeOk = rows.every(
      (row) =>
        (row.cls === "A" || row.cls === "B" || row.cls === "C") &&
        /^-?\d+\.\d{4}$/.test(row.consumptionValue),
    );
    const counts = { A: 0, B: 0, C: 0 };
    for (const row of rows) {
      if (row.cls === "A" || row.cls === "B" || row.cls === "C") {
        counts[row.cls] += 1;
      }
    }
    return {
      columns: [
        col("rankNo", "الترتيب", "Rank"),
        col("itemSku", "الصنف", "Item"),
        col("itemName", "الاسم", "Name"),
        col("cls", "الفئة", "Class", "status"),
        moneyCol("consumptionValue", "قيمة الاستهلاك", "Consumption value"),
        qtyCol("totalQtyOut", "الكمية المنصرفة", "Qty out"),
        col("velocity", "السرعة يومياً", "Velocity/day", "text", true),
        col("windowDays", "النافذة (يوم)", "Window (days)", "text", true),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.itemId,
        values: {
          rankNo: `${row.rankNo}`,
          itemSku: row.itemSku ?? row.itemId.slice(0, 8),
          itemName: row.itemName ?? "—",
          cls: row.cls,
          consumptionValue: row.consumptionValue,
          totalQtyOut: row.totalQtyOut,
          velocity: row.velocity,
          windowDays: `${row.windowDays}`,
        },
      })),
      totals: [
        {
          id: "abc-summary",
          kind: "sum",
          label: bilingual(
            `أ: ${counts.A} · ب: ${counts.B} · ج: ${counts.C}`,
            `A: ${counts.A} · B: ${counts.B} · C: ${counts.C}`,
          ),
          amount: `${rows.length}.0000`,
        },
      ],
      assertionResults: [
        {
          id: "abc-class-shape",
          status: shapeOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            shapeOk ? "كل الفئات A/B/C والقيم بصيغة 4dp سليمة" : "صف بفئة أو قيمة غير سليمة",
            shapeOk ? "every class is A/B/C and values are canonical 4dp" : "a row with a malformed class or value",
          ),
        },
      ],
      notes: [
        bilingual(
          "تصنيف باريتو على قيمة الاستهلاك داخل النافذة؛ الصنف بلا حركة يقع في الفئة ج؛ الفئة تحكم وتيرة الجرد الدوري وتلميحات التوزيع.",
          "A Pareto walk over consumption value in the window; zero-consumption items land in C; the class drives count frequency and slotting hints.",
        ),
      ],
    };
  },
});

export const inventorySlowMovementContract = defineReport({
  id: "inventory.slow-movement",
  version: 1,
  title: bilingual("بطء الحركة — منظور الذكاء المخزني", "Slow Movement — Intelligence View"),
  category: "inventory",
  description: bilingual(
    "أصناف راكدة بلا صرف داخل النافذة مع فئة ABC وانتشار الصناديق — منظور إعادة التوزيع (تقرير PHASE-013 على مستوى الصنف يبقى)",
    "Idle items with no outbound in the window joined to the ABC class and bin spread — the slotting view (the PHASE-013 item-level report stays)",
  ),
  parameters: z.object({ windowDays: z.number().int().min(1).default(90), locale: LOCALE }),
  requiredPermission: "inventory.stock.read",
  dataSources: [
    source(
      "inventory",
      "wmsQueries.slowMovement",
      ["item_stock", "stock_moves", "bin_contents", "abc_classifications"],
      "الرقود بلا صرف داخل النافذة مع الفئة وانتشار الصناديق",
      "Stocked rows with no outbound in the window with class and bin spread",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { dateRange: "optional", asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 3600, invalidationEvents: ["journal.posted"] },
  assertions: [
    assertDecl(
      "slow-movement-window",
      "every row is genuinely idle inside the declared window (never-issued or last-out beyond it)",
      "صف برصيد صادر داخل النافذة",
      "A row with an outbound inside the window",
    ),
  ],
  run: async (_ctx, params) => {
    const { wmsQueries } = reportingServices();
    const windowDays = (params.windowDays as number | undefined) ?? 90;
    const rows = await wmsQueries.slowMovement({ windowDays });
    const windowOk = rows.every((row) => row.lastOutAt === null || Date.parse(row.lastOutAt) < Date.now() - windowDays * 86_400_000);
    const wideSpread = rows.filter((row) => row.binCount >= 3).length;
    const classC = rows.filter((row) => row.cls === "C").length;
    return {
      columns: [
        col("itemSku", "الصنف", "Item"),
        col("itemName", "الاسم", "Name"),
        col("warehouseCode", "المستودع", "Warehouse"),
        qtyCol("onHand", "الرصيد", "On hand"),
        col("lastOutAt", "آخر صرف", "Last out", "date"),
        col("binCount", "عدد الصناديق", "Bins", "text", true),
        col("cls", "فئة ABC", "ABC class", "status", true),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.itemId}:${row.warehouseCode ?? "—"}`,
        values: {
          itemSku: row.itemSku ?? row.itemId.slice(0, 8),
          itemName: row.itemName ?? "—",
          warehouseCode: row.warehouseCode ?? "—",
          onHand: row.onHand,
          lastOutAt: row.lastOutAt?.slice(0, 10) ?? "—",
          binCount: `${row.binCount}`,
          cls: row.cls ?? "—",
        },
      })),
      totals: [
        {
          id: "slow-movement-summary",
          kind: "sum",
          label: bilingual(
            `راكد: ${rows.length} · فئة ج: ${classC} · انتشار ≥ 3 صناديق: ${wideSpread}`,
            `idle: ${rows.length} · class C: ${classC} · spread ≥ 3 bins: ${wideSpread}`,
          ),
          amount: `${rows.length}.0000`,
        },
      ],
      assertionResults: [
        {
          id: "slow-movement-window",
          status: windowOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            windowOk ? "كل الصفوف راكدة فعلاً داخل النافذة" : "صف له صرف داخل النافذة",
            windowOk ? "every row is genuinely idle inside the window" : "a row with an outbound inside the window",
          ),
        },
      ],
      notes: [
        bilingual(
          "الجمع بين فئة ج وبطء الحركة وانتشار الصناديق هو مرشح إعادة التوزيع (تلميح — لا إعادة توزيع تلقائية).",
          "Class C + slow movement + wide bin spread is the consolidation candidate (a hint — never automatic slotting).",
        ),
      ],
    };
  },
});
