import { z } from "zod";

import { assertExact } from "../../application/assertions";
import { addExact } from "../../../accounting/application/decimal-strings";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-018 T40 · the three PHASE-018 manufacturing report contracts
 * (industries/reports/README PHASE-018 rows — registered over the
 * PHASE-013 report contract; the report keys the catalog pins verbatim):
 *
 * - `manufacturing.production_cost` — per production order: planned vs
 *   actual materials (the frozen explosion snapshot vs the issued qty and
 *   value), absorbed labor/overhead (planned = planned_qty × rate), yield
 *   and scrap; the consumed-materials value ties to the WIP debits of the
 *   consume journals (`production-materials-gl-tie`).
 * - `manufacturing.batch_genealogy` — the recall walk for one batch:
 *   upstream material batches, downstream produced batches and the
 *   customer-facing sales edges enriched with document numbers (the §10
 *   decision — the module's walk returns ids only, this surface adds
 *   invoice/delivery numbers). Operational — no GL assertion.
 * - `manufacturing.qc_inspection_log` — the QC register: one row per
 *   inspection with result, sampling, disposition and the target documents
 *   (order number / GRN number / FG batch). Operational — no GL assertion.
 *
 * Bilingual AR/EN everywhere (Arabic first), money as canonical 4-decimal
 * strings (ADR-0009), read-only derivations over the manufacturing query
 * surface via `reportingServices()` — the shared contract supplies
 * parameters, scoping, drill-down, export, and print. Permissions reuse the
 * 0026 seed (no new keys): manufacturing.costing.read /
 * manufacturing.genealogy.read / manufacturing.qc.manage.
 */

const WINDOW_PARAMS = {
  dateFrom: ISO_DATE,
  dateTo: ISO_DATE,
  locale: LOCALE,
};

// -- assertions (the README rule-2 GL tie-out) --------------------------------------

const PRODUCTION_MATERIALS_GL_TIE = assertDecl(
  "production-materials-gl-tie",
  "Σ consumed-materials value in window == Σ WIP debits of the production consume journals in window",
  "قيمة المواد المستهلكة في التقرير لا تطابق مدين حساب تحت التشغيل لقيود الاستهلاك في الفترة",
  "Consumed-materials value does not tie to the WIP debits of the production consume journals in the window",
  "INV-010",
);

/** The README rule-2 labeling note for the operational (non-GL) reports. */
const OPERATIONAL_NOTE = bilingual(
  "تقرير تشغيلي: الأرقام المعروضة مستمدة من مستندات وقيود مرحّلة يطابقها دفتر الأستاذ عبر تقارير التكلفة والمخزون — لا يُشترط قيد مطابقة مستقل هنا (قاعدة ٢ من دليل تقارير الصناعات)",
  "Operational report: the figures shown derive from posted documents and journals that the ledger reconciles through the costing/inventory reports — no standalone GL tie-out is required here (industry-reports rule 2)",
);

/** The not-found note for a recall search miss (an unknown batch is not a 500). */
const BATCH_NOT_FOUND_NOTE = bilingual(
  "لا توجد دفعة بهذا المعرّف في هذا المستأجر — نتيجة الاستدعاء فارغة (بحث استدعاء بلا مطابقة وليس خطأ)",
  "Batch not found in this tenant — the recall result is empty (a recall search miss, not an error)",
);

// ---------------------------------------------------------------------------
// manufacturing.production_cost — تكلفة الإنتاج
// ---------------------------------------------------------------------------

export const manufacturingProductionCostContract = defineReport({
  id: "manufacturing.production_cost",
  version: 1,
  title: bilingual("تكلفة الإنتاج", "Production Cost"),
  category: "industry",
  description: bilingual(
    "لكل أمر إنتاج: المواد المخططة مقابل الفعلية (الكمية والقيمة) والأجور والمصاريف غير المباشرة المطبقة مع نسبة الإنجاز والتالف — قيمة المواد المستهلكة تطابق مدين تحت التشغيل لقيود الاستهلاك",
    "Per production order: planned vs actual materials (qty and value), applied labor/overhead, yield and scrap — the consumed-materials value tied to the WIP debits of the consume journals",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    status: z.enum(["DRAFT", "RELEASED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
    branchIds: z.array(z.string().uuid()).nullish(),
  }),
  requiredPermission: "manufacturing.costing.read",
  dataSources: [
    source(
      "manufacturing",
      "manufacturingQueries.productionCost",
      ["production_orders", "production_order_lines", "production_consumptions", "production_scraps", "items"],
      "أوامر الإنتاج مع خططها واستهلاكها وتالفها",
      "Production orders with their frozen plans, consumptions and scraps",
    ),
    source(
      "accounting",
      "journal (production materials tie)",
      ["journal_entries", "journal_lines"],
      "قيود استهلاك المواد للمطابقة",
      "The material-consumption journals for the tie-out",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "consumedValue", kind: "sum" },
      { id: "fgValue", kind: "sum" },
      { id: "scrapValue", kind: "sum" },
    ],
    sorting: [{ by: "orderNo", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted"],
  },
  assertions: [PRODUCTION_MATERIALS_GL_TIE],
  run: async (_ctx, params) => {
    const { manufacturing } = reportingServices();
    const rows = await manufacturing.productionCost({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      status: params.status ?? null,
      branchIds: params.branchIds ?? null,
    });
    let consumedValueTotal = "0.0000";
    let scrapValueTotal = "0.0000";
    let fgValueTotal = "0.0000";
    let laborValueTotal = "0.0000";
    let overheadValueTotal = "0.0000";
    for (const row of rows) {
      consumedValueTotal = addExact(consumedValueTotal, row.consumedValue);
      scrapValueTotal = addExact(scrapValueTotal, row.scrapValue);
      fgValueTotal = addExact(fgValueTotal, row.fgValue);
      laborValueTotal = addExact(laborValueTotal, row.laborValue);
      overheadValueTotal = addExact(overheadValueTotal, row.overheadValue);
    }
    const tie = await manufacturing.productionCostGlTie({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("orderNo", "أمر الإنتاج", "Order"),
        col("status", "الحالة", "Status", "status"),
        col("sku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        qtyCol("plannedQty", "الكمية المخططة", "Planned qty"),
        qtyCol("actualQty", "الكمية الفعلية", "Actual qty"),
        col("yieldPct", "نسبة الإنجاز %", "Yield %", "text", true),
        qtyCol("plannedComponentsQty", "مواد مخططة (كمية)", "Planned components qty"),
        qtyCol("consumedQty", "مواد مستهلكة (كمية)", "Consumed qty"),
        col("overPlanLines", "سطور فوق الخطة", "Over-plan lines", "text", true),
        moneyCol("consumedValue", "قيمة المستهلك", "Consumed value"),
        moneyCol("scrapValue", "قيمة التالف", "Scrap value"),
        col("scrapCount", "عدد التالف", "Scraps", "text", true),
        moneyCol("plannedLaborValue", "أجور مخططة", "Planned labor"),
        moneyCol("plannedOverheadValue", "مصاريف مخططة", "Planned overhead"),
        moneyCol("laborValue", "أجور مطبقة", "Applied labor"),
        moneyCol("overheadValue", "مصاريف مطبقة", "Applied overhead"),
        moneyCol("fgValue", "قيمة الإنتاج التام", "FG value"),
        moneyCol("wipBalance", "رصيد تحت التشغيل", "WIP balance"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.orderId,
        values: {
          orderNo: row.orderNo,
          status: row.status,
          sku: row.sku,
          itemName: row.itemName,
          plannedQty: row.plannedQty,
          actualQty: row.actualQty,
          yieldPct: row.yieldPct,
          plannedComponentsQty: row.plannedComponentsQty,
          consumedQty: row.consumedQty,
          overPlanLines: row.overPlanLines,
          consumedValue: row.consumedValue,
          scrapValue: row.scrapValue,
          scrapCount: row.scrapCount,
          plannedLaborValue: row.plannedLaborValue,
          plannedOverheadValue: row.plannedOverheadValue,
          laborValue: row.laborValue,
          overheadValue: row.overheadValue,
          fgValue: row.fgValue,
          wipBalance: row.wipBalance,
        },
      })),
      totals: [
        {
          id: "consumedValueTotal",
          kind: "sum",
          label: bilingual("إجمالي قيمة المواد المستهلكة", "Total consumed value"),
          amount: consumedValueTotal,
        },
        {
          id: "scrapValueTotal",
          kind: "sum",
          label: bilingual("إجمالي قيمة التالف", "Total scrap value"),
          amount: scrapValueTotal,
        },
        {
          id: "fgValueTotal",
          kind: "sum",
          label: bilingual("إجمالي قيمة الإنتاج التام", "Total FG value"),
          amount: fgValueTotal,
        },
        {
          id: "laborValueTotal",
          kind: "sum",
          label: bilingual("إجمالي الأجور المطبقة", "Total applied labor"),
          amount: laborValueTotal,
        },
        {
          id: "overheadValueTotal",
          kind: "sum",
          label: bilingual("إجمالي المصاريف المطبقة", "Total applied overhead"),
          amount: overheadValueTotal,
        },
      ],
      assertionResults: [assertExact("production-materials-gl-tie", tie.registerSide, tie.glSide)],
      notes: [
        bilingual(
          "مقارنة المواد على مستوى الكمية: الكمية المخططة (لقطة انفجار قائمة المواد) مقابل الكمية المستهلكة — للمواد المخططة لا أساس تكلفة قبل الاستهلاك، أما الأجور والمصاريف فالمخطط = الكمية المخططة × النسبة.",
          "The materials comparison is on QUANTITY: planned components (the BOM-explosion snapshot) vs consumed qty — planned component VALUE has no cost basis until consumed; planned labor/overhead = planned qty × rate.",
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// manufacturing.batch_genealogy — شجرة الدفعات
// ---------------------------------------------------------------------------

const GENEALOGY_COLUMNS = [
  col("kind", "النوع", "Kind", "status"),
  col("level", "المستوى", "Level", "text", true),
  col("batchNo", "الدفعة", "Batch"),
  col("sku", "الصنف", "SKU"),
  qtyCol("qty", "الكمية", "Qty"),
  col("orderNo", "أمر الإنتاج", "Order"),
  col("producedByOrderNo", "أمر إنتاج الدفعة", "Produced by order"),
  col("docNo", "مستند البيع", "Sales document"),
  col("docDate", "تاريخ المستند", "Document date", "date"),
];

export const manufacturingBatchGenealogyContract = defineReport({
  id: "manufacturing.batch_genealogy",
  version: 1,
  title: bilingual("شجرة الدفعات", "Batch Genealogy"),
  category: "industry",
  description: bilingual(
    "سير الاستدعاء لدفعة واحدة: دفعات المواد أعلى السلسلة (حتى أوامر الإنتاج المنتجة لها) والدفعات المنتجة والمبيعات أسفلها مع أرقام مستندات البيع — الدفعة غير الموجودة نتيجة فارغة وليست خطأ",
    "The recall walk for one batch: upstream material batches (through the orders that produced them) and the downstream produced batches and sales with the sales document numbers — an unknown batch is an empty result, not an error",
  ),
  parameters: z.object({
    batchId: z.string().uuid(),
    locale: LOCALE,
  }),
  requiredPermission: "manufacturing.genealogy.read",
  dataSources: [
    source(
      "manufacturing",
      "manufacturingQueries.batchGenealogy (the §10 recall walk + the sales doc-number enrichment)",
      ["production_consumptions", "production_orders", "item_batches", "items", "stock_moves"],
      "دفعات المواد والإنتاج مع حركات البيع المصدرية",
      "The material/production batches with their sourcing sale moves",
    ),
    source(
      "sales",
      "sales_invoices/delivery_notes (sales doc numbers)",
      ["sales_invoices", "delivery_notes"],
      "أرقام مستندات البيع لإثراء نتائج الاستدعاء",
      "The sales document numbers enriching the recall edges",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [{ id: "rows", kind: "count" }],
    sorting: [{ by: "kind", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted", "invoice.posted"],
  },
  assertions: [],
  run: async (_ctx, params) => {
    const { manufacturing } = reportingServices();
    const walk = await manufacturing.batchGenealogy({ batchId: params.batchId! });
    if (walk.batch === null) {
      // A recall search miss is not a 500: the typed not-found stays
      // manufacturing-owned; the report surfaces the empty walk + the note.
      return {
        columns: GENEALOGY_COLUMNS,
        groups: [],
        rows: [],
        totals: [
          {
            id: "rows",
            kind: "sum",
            label: bilingual("عدد نتائج الاستدعاء", "Recall rows"),
            amount: "0",
          },
        ],
        assertionResults: [],
        notes: [OPERATIONAL_NOTE, BATCH_NOT_FOUND_NOTE],
      };
    }
    return {
      columns: GENEALOGY_COLUMNS,
      groups: [],
      rows: walk.rows.map((row) => ({
        key: `${row.kind}:${row.level}:${row.batchNo ?? "none"}:${row.docNo ?? row.orderNo ?? ""}`,
        values: {
          kind: row.kind,
          level: row.level,
          batchNo: row.batchNo,
          sku: row.sku,
          qty: row.qty,
          orderNo: row.orderNo,
          producedByOrderNo: row.producedByOrderNo,
          docNo: row.docNo,
          docDate: row.docDate,
        },
      })),
      totals: [
        {
          id: "rows",
          kind: "sum",
          label: bilingual("عدد نتائج الاستدعاء", "Recall rows"),
          amount: String(walk.rows.length),
        },
      ],
      assertionResults: [],
      notes: [
        OPERATIONAL_NOTE,
        bilingual(
          "قراءة فقط فوق الجداول المنشورة: المستوى = عدد القفزات من الدفعة المطلوبة (١ = الحافة المباشرة)، والمستوى ١٦ حداً أقصى يتوقف عنده السير دون خطأ.",
          "Read-only over the published tables: level = hops from the queried batch (1 = the immediate edge); the walk stops (no error) at the 16-level cap.",
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// manufacturing.qc_inspection_log — سجل فحوص الجودة
// ---------------------------------------------------------------------------

export const manufacturingQcInspectionLogContract = defineReport({
  id: "manufacturing.qc_inspection_log",
  version: 1,
  title: bilingual("سجل فحوص الجودة", "QC Inspection Log"),
  category: "industry",
  description: bilingual(
    "سجل الفحوص في الفترة: النتيجة والعيّنة والقرار مع أمر الإنتاج أو إشعار الاستلام والدفعة محل الفحص",
    "The inspections of the window: result, sampling and disposition with the production order or goods receipt and the batch under inspection",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "manufacturing.qc.manage",
  dataSources: [
    source(
      "manufacturing",
      "manufacturingQueries.qcInspectionLog",
      ["inspections", "production_orders", "goods_receipts", "item_batches"],
      "الفحوص مع مستنداتها المستهدفة ودفعاتها",
      "The inspections with their target documents and batches",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [{ id: "resultCount", kind: "count" }],
    sorting: [{ by: "inspectedAt", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted"],
  },
  assertions: [],
  run: async (_ctx, params) => {
    const { manufacturing } = reportingServices();
    const rows = await manufacturing.qcInspectionLog({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("inspectedAt", "تاريخ الفحص", "Inspected at", "date"),
        col("targetType", "الهدف", "Target", "status"),
        col("orderNo", "أمر الإنتاج", "Order"),
        col("grnNo", "إشعار الاستلام", "GRN"),
        col("fgBatchNo", "الدفعة", "Batch"),
        col("result", "النتيجة", "Result", "status"),
        col("sampled", "عيّنة", "Sampled", "status"),
        col("sampleSize", "حجم العيّنة", "Sample size", "text", true),
        col("disposition", "القرار", "Disposition", "status"),
        col("note", "ملاحظة", "Note"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.inspectionId,
        values: {
          inspectedAt: row.inspectedAt,
          targetType: row.targetType,
          orderNo: row.orderNo,
          grnNo: row.grnNo,
          fgBatchNo: row.fgBatchNo,
          result: row.result,
          sampled: row.sampled ? "true" : "false",
          sampleSize: row.sampleSize,
          disposition: row.disposition,
          note: row.note,
        },
      })),
      totals: [
        {
          id: "resultCount",
          kind: "sum",
          label: bilingual("عدد الفحوص", "Inspections"),
          amount: String(rows.length),
        },
      ],
      assertionResults: [],
      notes: [OPERATIONAL_NOTE],
    };
  },
});
