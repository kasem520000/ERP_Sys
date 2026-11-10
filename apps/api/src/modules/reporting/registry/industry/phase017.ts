import { z } from "zod";

import { assertExact } from "../../application/assertions";
import { addExact } from "../../../accounting/application/decimal-strings";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-017 T8-a · the seven PHASE-017 industry report contracts
 * (industries/reports/README PHASE-017 rows — registered over the
 * PHASE-013 report contract; the report keys the catalog pins verbatim):
 *
 * - `automotive.job_card_profitability` — per job card: parts margin
 *   (parts revenue − parts COGS), labor revenue, duration, invoice status;
 *   parts COGS ties to the COGS journal lines (`jc-parts-cogs-tie`).
 * - `automotive.vehicle_service_history` — the per-vehicle timeline of job
 *   cards, invoices, and warranty notes (the partners serviceHistory read
 *   model over a report contract; operational — no GL assertion).
 * - `distribution.rep_settlement` — per rep/day: load-out, sales, returns,
 *   collections, counted vs expected cash, variance + the GL tie of
 *   variance + deposit journals (`settlement-gl-tie`).
 * - `distribution.route_visit_compliance` — planned vs actual visits per
 *   route with sales per completed visit (planning data — no GL assertion).
 * - `distribution.van_stock_balances` — stock per van warehouse with
 *   ageing and expiry risk; the mirror ties to Σ signed stock_moves
 *   (`van-conservation-tie`).
 * - `sales.discount_management_effectiveness` — FOC lines given vs the
 *   paid sales alongside per customer/promotion (foc_reason_code
 *   aggregation; operational measurement — no GL assertion).
 * - `sales.commissions_due` — commissions per rep per period: base, rate,
 *   accrual, payout state; the posted total ties to the accrual journals
 *   (`commissions-total-tie`).
 *
 * Bilingual AR/EN everywhere (Arabic first), money as canonical 4-decimal
 * strings (ADR-0009), read-only derivations over the sales/partners/
 * distribution query surfaces via `reportingServices()` — the shared
 * contract supplies parameters, scoping, drill-down, export, and print.
 * Permissions reuse the seeded catalog (no new keys): the
 * reports.sales.profitability / sales.statements / reports.treasury.fx /
 * reports.sales.by-rep / reports.sales.by-customer / inventory.stock
 * families — the same keys the PHASE-015/016 industry rows already ride.
 */

const WINDOW_PARAMS = {
  dateFrom: ISO_DATE,
  dateTo: ISO_DATE,
  locale: LOCALE,
};

// -- assertions (the README rule-2 GL tie-outs) --------------------------------------

const JC_PARTS_COGS_TIE = assertDecl(
  "jc-parts-cogs-tie",
  "Σ per-card parts COGS (invoice issue-value snapshots net of warranty re-entries) == Σ net COGS journal-line amounts of the postings backing the listed cards (sales_invoice:cogs + job_card:issue_parts + credit_note:reentry)",
  "تكلفة القطع في التقرير لا تطابق قيود تكلفة المبيعات في دفتر الأستاذ",
  "Report parts COGS does not tie to the COGS journal lines of the postings backing the listed cards",
  "INV-010",
);

const SETTLEMENT_GL_TIE = assertDecl(
  "settlement-gl-tie",
  "Σ |variance| + Σ deposits == Σ DEBITS of the settlements' variance/deposit journals in the window (BR-021: the variance always posts, never netted)",
  "مجموع فروق التسويات والإيداعات لا يطابق قيود دفتر الأستاذ للفترة",
  "Settlement variance + deposit totals do not tie to the GL journals in the window",
  "BR-021",
);

const VAN_CONSERVATION_TIE = assertDecl(
  "van-conservation-tie",
  "Σ van_stocks mirror qty == Σ signed stock_moves qty over the (scoped) VAN warehouses",
  "أرصدة مرآة مخزون السيارات لا تطابق حركات المخزون الموقعة",
  "The van stock mirror does not tie to the signed stock moves",
  "INV-010",
);

const COMMISSIONS_TOTAL_TIE = assertDecl(
  "commissions-total-tie",
  "Σ commission_amount of the POSTED runs' lines (period ends in window) == Σ COMMISSION_EXPENSE debits of the accrual journals in the window",
  "إجمالي العمولات المرحّلة لا يطابق قيود مصروف العمولات في دفتر الأستاذ",
  "Posted commissions total does not tie to the commission-expense GL lines",
  "ADR-0009",
);

/** The README rule-2 labeling note for the operational (non-GL) reports. */
const OPERATIONAL_NOTE = bilingual(
  "تقرير تشغيلي: الأرقام المالية المعروضة مستمدة من مستندات مرحّلة يطابقها دفتر الأستاذ عبر تقارير المبيعات والمخزون — لا يُشترط قيد مطابقة مستقل هنا (قاعدة ٢ من دليل تقارير الصناعات)",
  "Operational report: the monetary figures shown derive from posted documents that the ledger reconciles through the sales/inventory reports — no standalone GL tie-out is required here (industry-reports rule 2)",
);

// ---------------------------------------------------------------------------
// automotive.job_card_profitability — ربحية بطاقات العمل
// ---------------------------------------------------------------------------

export const automotiveJobCardProfitabilityContract = defineReport({
  id: "automotive.job_card_profitability",
  version: 1,
  title: bilingual("ربحية بطاقات العمل", "Job Card Profitability"),
  category: "industry",
  description: bilingual(
    "لكل بطاقة عمل: هامش القطع (إيراد القطع ناقص تكلفتها) وإيراد العمل والمدة وحالة الفاتورة، مع مطابقة تكلفة القطع مع قيود تكلفة المبيعات في دفتر الأستاذ",
    "Per job card: parts margin (parts revenue − parts COGS), labor revenue, duration, and invoice status — parts COGS tied to the COGS journal lines",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    branchIds: z.array(z.string().uuid()).nullish(),
  }),
  requiredPermission: "reports.sales.profitability.read",
  dataSources: [
    source(
      "sales",
      "automotiveQueries.jobCardProfitability",
      ["job_cards", "job_card_lines", "sales_invoices", "sales_invoice_lines"],
      "بطاقات العمل وخطوطها مع فواتيرها المرحّلة",
      "Job cards and their lines joined with their posted invoices",
    ),
    source(
      "accounting",
      "journal (parts COGS tie)",
      ["journal_lines", "journal_entries"],
      "قيود تكلفة المبيعات للمطابقة",
      "The COGS journal lines for the tie-out",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "both",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "partsRevenue", kind: "sum" },
      { id: "partsCogs", kind: "sum" },
      { id: "laborRevenue", kind: "sum" },
    ],
    sorting: [{ by: "invoiceNo", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["invoice.posted", "journal.posted"],
  },
  assertions: [JC_PARTS_COGS_TIE],
  run: async (_ctx, params) => {
    const { automotive } = reportingServices();
    const rows = await automotive.jobCardProfitability({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    let partsRevenueTotal = "0.0000";
    let partsCogsTotal = "0.0000";
    let partsMarginTotal = "0.0000";
    let laborRevenueTotal = "0.0000";
    for (const row of rows) {
      partsRevenueTotal = addExact(partsRevenueTotal, row.partsRevenue);
      partsCogsTotal = addExact(partsCogsTotal, row.partsCogs);
      partsMarginTotal = addExact(partsMarginTotal, row.partsMargin);
      laborRevenueTotal = addExact(laborRevenueTotal, row.laborRevenue);
    }
    const tie = await automotive.jobCardPartsCogsTie({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("cardNo", "البطاقة", "Card"),
        col("customerName", "العميل", "Customer"),
        col("vehicleLabel", "المركبة", "Vehicle"),
        col("plateNo", "اللوحة", "Plate"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("partsRevenue", "إيراد القطع", "Parts revenue"),
        moneyCol("partsCogs", "تكلفة القطع", "Parts COGS"),
        moneyCol("partsMargin", "هامش القطع", "Parts margin"),
        moneyCol("laborRevenue", "إيراد العمل", "Labor revenue"),
        qtyCol("laborHours", "ساعات العمل", "Labor hours"),
        col("daysOpen", "أيام المدة", "Days open", "text", true),
        col("invoiceNo", "الفاتورة", "Invoice"),
        col("invoiceStatus", "حالة الفاتورة", "Invoice status", "status"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.cardId,
        values: {
          cardNo: row.cardNo,
          customerName: row.customerName,
          vehicleLabel: row.vehicleLabel,
          plateNo: row.plateNo,
          status: row.status,
          partsRevenue: row.partsRevenue,
          partsCogs: row.partsCogs,
          partsMargin: row.partsMargin,
          laborRevenue: row.laborRevenue,
          laborHours: row.laborHours,
          daysOpen: row.daysOpen,
          invoiceNo: row.invoiceNo,
          invoiceStatus: row.invoiceStatus,
        },
      })),
      totals: [
        {
          id: "partsRevenueTotal",
          kind: "sum",
          label: bilingual("إجمالي إيراد القطع", "Total parts revenue"),
          amount: partsRevenueTotal,
        },
        {
          id: "partsCogsTotal",
          kind: "sum",
          label: bilingual("إجمالي تكلفة القطع", "Total parts COGS"),
          amount: partsCogsTotal,
        },
        {
          id: "partsMarginTotal",
          kind: "sum",
          label: bilingual("إجمالي هامش القطع", "Total parts margin"),
          amount: partsMarginTotal,
        },
        {
          id: "laborRevenueTotal",
          kind: "sum",
          label: bilingual("إجمالي إيراد العمل", "Total labor revenue"),
          amount: laborRevenueTotal,
        },
      ],
      assertionResults: [assertExact("jc-parts-cogs-tie", tie.registerSide, tie.glSide)],
      notes: [
        bilingual(
          "الإيراد والتكلفة صافيان بعد إشعارات الضمان المرتبطة بالبطاقة (الإرجاع بالتكلفة الأصلية).",
          "Revenue and COGS net the warranty credit notes linked to the card (re-entry at the original issue cost).",
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// automotive.vehicle_service_history — سجل صيانة المركبة
// ---------------------------------------------------------------------------

export const automotiveVehicleServiceHistoryContract = defineReport({
  id: "automotive.vehicle_service_history",
  version: 1,
  title: bilingual("سجل صيانة المركبة", "Vehicle Service History"),
  category: "industry",
  description: bilingual(
    "الخط الزمني لكل مركبة: بطاقات العمل والفواتير وإشعارات الضمان — نموذج القراءة الخاص بالسجل في وحدة الشركاء فوق عقد تقرير مشترك",
    "The per-vehicle timeline of job cards, invoices, and warranty notes — the partners registry's serviceHistory read model over the shared report contract",
  ),
  parameters: z.object({
    vehicleId: z.string().uuid(),
    locale: LOCALE,
  }),
  requiredPermission: "sales.statements.read",
  dataSources: [
    source(
      "partners",
      "automotiveQueries.vehicleServiceHistory (vehicles.serviceHistory read model)",
      ["vehicles", "job_cards", "sales_invoices", "credit_notes"],
      "سجل المركبة: بطاقات العمل والفواتير وإشعارات الضمان",
      "The vehicle timeline: job cards, invoices, warranty credit notes",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden" },
  aggregation: {
    groupBy: [],
    measures: [{ id: "entries", kind: "count" }],
    sorting: [{ by: "date", dir: "desc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["invoice.posted", "journal.posted"],
  },
  assertions: [],
  run: async (_ctx, params) => {
    const { automotive } = reportingServices();
    const entries = await automotive.vehicleServiceHistory({
      vehicleId: params.vehicleId!,
    });
    const kindLabels: Record<string, { ar: string; en: string }> = {
      JOB_CARD: bilingual("بطاقة عمل", "Job card"),
      INVOICE: bilingual("فاتورة", "Invoice"),
      CREDIT_NOTE: bilingual("إشعار دائن (ضمان)", "Credit note (warranty)"),
    };
    return {
      columns: [
        col("date", "التاريخ", "Date", "date"),
        col("kind", "النوع", "Kind", "status"),
        col("docNo", "المستند", "Document"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("total", "الإجمالي", "Total"),
      ],
      groups: [],
      rows: entries.map((entry) => ({
        key: `${entry.kind}:${entry.id}`,
        values: {
          date: entry.date,
          kind: params.locale === "ar" ? kindLabels[entry.kind]!.ar : kindLabels[entry.kind]!.en,
          docNo: entry.docNo,
          status: entry.status,
          total: entry.total,
        },
      })),
      totals: [
        {
          id: "entries",
          kind: "sum",
          label: bilingual("عدد الحركات", "Timeline entries"),
          amount: String(entries.length),
        },
      ],
      assertionResults: [],
      notes: [OPERATIONAL_NOTE],
    };
  },
});

// ---------------------------------------------------------------------------
// distribution.rep_settlement — تسوية المندوب
// ---------------------------------------------------------------------------

export const distributionRepSettlementContract = defineReport({
  id: "distribution.rep_settlement",
  version: 1,
  title: bilingual("تسوية المندوب", "Rep Settlement"),
  category: "industry",
  description: bilingual(
    "لكل مندوب ويوم: التحميل والمبيعات والمرتجعات والتحصيلات والنقدية المفروزة مقابل المتوقعة والفرق، مع مطابقة الفروق والإيداعات مع قيود دفتر الأستاذ (قاعدة BR-021)",
    "Per rep/day: load-out, sales, returns, collections, counted vs expected cash and the variance — variance + deposits tied to the GL journals (BR-021)",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    repIds: z.array(z.string().uuid()).nullish(),
  }),
  requiredPermission: "reports.treasury.fx.read",
  dataSources: [
    source(
      "distribution",
      "distributionQueries.repSettlement",
      ["rep_settlements", "rep_settlement_lines", "stock_moves", "warehouses"],
      "تسويات المندوبين مع مكوناتها وحركة التحميل على السيارة",
      "Rep settlements with their components and the van load-out moves",
    ),
    source(
      "accounting",
      "journal (settlement variance/deposit tie)",
      ["journal_entries", "journal_lines"],
      "قيود فروق التسويات والإيداعات للمطابقة",
      "The settlement variance/deposit journals for the tie-out",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "both",
  aggregation: {
    groupBy: ["settlementDate"],
    measures: [
      { id: "expectedCash", kind: "sum" },
      { id: "countedCash", kind: "sum" },
      { id: "variance", kind: "sum" },
    ],
    sorting: [{ by: "settlementDate", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted", "settlement.posted"],
  },
  assertions: [SETTLEMENT_GL_TIE],
  run: async (_ctx, params) => {
    const { distribution } = reportingServices();
    const rows = await distribution.repSettlement({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      repIds: params.repIds ?? null,
    });
    let expectedTotal = "0.0000";
    let countedTotal = "0.0000";
    let varianceTotal = "0.0000";
    let depositTotal = "0.0000";
    let loadOutTotal = "0.0000";
    for (const row of rows) {
      expectedTotal = addExact(expectedTotal, row.expectedCash);
      countedTotal = addExact(countedTotal, row.countedCash ?? "0.0000");
      varianceTotal = addExact(varianceTotal, row.variance ?? "0.0000");
      depositTotal = addExact(depositTotal, row.depositAmount ?? "0.0000");
      loadOutTotal = addExact(loadOutTotal, row.loadOutValue);
    }
    const tie = await distribution.settlementGlTie({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      repIds: params.repIds ?? null,
    });
    return {
      columns: [
        col("settlementNo", "التسوية", "Settlement"),
        col("settlementDate", "التاريخ", "Date", "date"),
        col("repCode", "المندوب", "Rep"),
        col("repName", "اسم المندوب", "Rep name"),
        col("vanCode", "السيارة", "Van"),
        col("status", "الحالة", "Status", "status"),
        qtyCol("loadOutQty", "كمية التحميل", "Load-out qty"),
        moneyCol("loadOutValue", "قيمة التحميل", "Load-out value"),
        moneyCol("openingCash", "الافتتاحي", "Opening"),
        moneyCol("cashSales", "المبيعات النقدية", "Cash sales"),
        moneyCol("collections", "التحصيلات", "Collections"),
        moneyCol("cashRefunds", "المرتجعات النقدية", "Cash refunds"),
        moneyCol("repExpenses", "مصروفات المندوب", "Rep expenses"),
        moneyCol("expectedCash", "المتوقع", "Expected"),
        moneyCol("countedCash", "المفروز", "Counted"),
        moneyCol("variance", "الفرق (BR-021)", "Variance (BR-021)"),
        col("varianceDirection", "اتجاه الفرق", "Direction", "status"),
        moneyCol("depositAmount", "الإيداع البنكي", "Bank deposit"),
        col("varianceJournalNo", "قيد الفرق", "Variance JE"),
        col("depositJournalNo", "قيد الإيداع", "Deposit JE"),
        col("componentLineCount", "سطور المكونات", "Component lines", "text", true),
        moneyCol("componentLinesTotal", "مجموع السطور (المفروز − الإيداع)", "Lines total (counted − deposit)"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.settlementId,
        values: {
          settlementNo: row.settlementNo,
          settlementDate: row.settlementDate,
          repCode: row.repCode,
          repName: row.repName,
          vanCode: row.vanCode,
          status: row.status,
          loadOutQty: row.loadOutQty,
          loadOutValue: row.loadOutValue,
          openingCash: row.openingCash,
          cashSales: row.cashSales,
          collections: row.collections,
          cashRefunds: row.cashRefunds,
          repExpenses: row.repExpenses,
          expectedCash: row.expectedCash,
          countedCash: row.countedCash,
          variance: row.variance,
          varianceDirection: row.varianceDirection,
          depositAmount: row.depositAmount,
          varianceJournalNo: row.varianceJournalNo,
          depositJournalNo: row.depositJournalNo,
          componentLineCount: row.componentLineCount,
          componentLinesTotal: row.componentLinesTotal,
        },
      })),
      totals: [
        {
          id: "loadOutTotal",
          kind: "sum",
          label: bilingual("إجمالي قيمة التحميل", "Total load-out value"),
          amount: loadOutTotal,
        },
        {
          id: "expectedTotal",
          kind: "sum",
          label: bilingual("إجمالي المتوقع", "Total expected cash"),
          amount: expectedTotal,
        },
        {
          id: "countedTotal",
          kind: "sum",
          label: bilingual("إجمالي المفروز", "Total counted cash"),
          amount: countedTotal,
        },
        {
          id: "varianceTotal",
          kind: "sum",
          label: bilingual("إجمالي الفرق", "Total variance"),
          amount: varianceTotal,
        },
        {
          id: "depositTotal",
          kind: "sum",
          label: bilingual("إجمالي الإيداعات", "Total deposits"),
          amount: depositTotal,
        },
      ],
      assertionResults: [assertExact("settlement-gl-tie", tie.registerSide, tie.glSide)],
      notes: [
        bilingual(
          "المتوقع = الافتتاحي + المبيعات النقدية + التحصيلات − المرتجعات النقدية − مصروفات المندوب؛ الفرق يُرحّل دائماً ولا يُصاف أبداً (BR-021).",
          "Expected = opening + cash sales + collections − cash refunds − rep expenses; the variance always posts and is never netted (BR-021).",
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// distribution.route_visit_compliance — التزام خطوط السير
// ---------------------------------------------------------------------------

export const distributionRouteVisitComplianceContract = defineReport({
  id: "distribution.route_visit_compliance",
  version: 1,
  title: bilingual("التزام خطوط السير", "Route Visit Compliance"),
  category: "industry",
  description: bilingual(
    "الزيارات المخططة مقابل الفعلية لكل خط سير مع مبيعات كل زيارة منجزة — بيانات تخطيط لا تُرحّل قيوداً",
    "Planned vs actual visits per route with the sales of each completed visit — planning data that posts nothing",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    routeIds: z.array(z.string().uuid()).nullish(),
  }),
  requiredPermission: "reports.sales.by-rep.read",
  dataSources: [
    source(
      "distribution",
      "distributionQueries.routeVisitCompliance",
      ["routes", "route_visits", "route_customers"],
      "خطوط السير وزياراتها المخططة والفعلية",
      "Routes with their planned and actual visits",
    ),
    source(
      "sales",
      "sales_invoices (sales per visit linkage)",
      ["sales_invoices"],
      "فواتير البيع المرتبطة بالزيارات المنجزة",
      "The sales invoices linked to completed visits",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  aggregation: {
    groupBy: ["routeCode"],
    measures: [
      { id: "plannedCount", kind: "count" },
      { id: "salesTotal", kind: "sum" },
    ],
    sorting: [{ by: "routeCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["invoice.posted"],
  },
  assertions: [],
  run: async (_ctx, params) => {
    const { distribution } = reportingServices();
    const routeIds = Array.isArray(params.routeIds) ? (params.routeIds as readonly string[]) : null;
    const rows = await distribution.routeVisitCompliance({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      routeIds,
    });
    let plannedTotal = 0;
    let completedTotal = 0;
    let missedTotal = 0;
    let salesGrandTotal = "0.0000";
    for (const row of rows) {
      plannedTotal += row.plannedCount;
      completedTotal += row.completedCount;
      missedTotal += row.missedCount;
      salesGrandTotal = addExact(salesGrandTotal, row.salesTotal);
    }
    return {
      columns: [
        col("routeCode", "خط السير", "Route"),
        col("routeName", "اسم الخط", "Route name"),
        col("repCode", "المندوب", "Rep"),
        col("repName", "اسم المندوب", "Rep name"),
        col("plannedCount", "المخططة", "Planned", "text", true),
        col("completedCount", "المنجزة", "Completed", "text", true),
        col("skippedCount", "المتخطاة", "Skipped", "text", true),
        col("missedCount", "الفائتة", "Missed", "text", true),
        col("pendingCount", "المعلقة", "Pending", "text", true),
        col("salesInvoiceCount", "عدد الفواتير", "Invoices", "text", true),
        moneyCol("salesTotal", "إجمالي المبيعات", "Sales total"),
        moneyCol("salesPerVisit", "متوسط البيع للزيارة", "Sales per visit"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.routeId,
        values: {
          routeCode: row.routeCode,
          routeName: row.routeName,
          repCode: row.repCode,
          repName: row.repName,
          plannedCount: row.plannedCount,
          completedCount: row.completedCount,
          skippedCount: row.skippedCount,
          missedCount: row.missedCount,
          pendingCount: row.pendingCount,
          salesInvoiceCount: row.salesInvoiceCount,
          salesTotal: row.salesTotal,
          salesPerVisit: row.salesPerVisit,
        },
      })),
      totals: [
        {
          id: "plannedTotal",
          kind: "sum",
          label: bilingual("إجمالي المخططة", "Total planned"),
          amount: String(plannedTotal),
        },
        {
          id: "completedTotal",
          kind: "sum",
          label: bilingual("إجمالي المنجزة", "Total completed"),
          amount: String(completedTotal),
        },
        {
          id: "missedTotal",
          kind: "sum",
          label: bilingual("إجمالي الفائتة", "Total missed"),
          amount: String(missedTotal),
        },
        {
          id: "salesGrandTotal",
          kind: "sum",
          label: bilingual("إجمالي مبيعات الزيارات", "Total visit sales"),
          amount: salesGrandTotal,
        },
      ],
      assertionResults: [],
      notes: [OPERATIONAL_NOTE],
    };
  },
});

// ---------------------------------------------------------------------------
// distribution.van_stock_balances — أرصدة مخزون السيارات
// ---------------------------------------------------------------------------

export const distributionVanStockBalancesContract = defineReport({
  id: "distribution.van_stock_balances",
  version: 1,
  title: bilingual("أرصدة مخزون السيارات", "Van Stock Balances"),
  category: "industry",
  description: bilingual(
    "المخزون في كل سيارة توزيع مع التقدم في العمر وخطر انتهاء الصلاحية — المرآة تُطابق حركات المخزون الموقعة (INV-010)",
    "Stock per van warehouse with ageing and expiry risk — the mirror tied to the signed stock moves (INV-010)",
  ),
  parameters: z.object({
    warehouseIds: z.array(z.string().uuid()).nullish(),
    locale: LOCALE,
  }),
  requiredPermission: "inventory.stock.read",
  dataSources: [
    source(
      "distribution",
      "distributionQueries.vanStockBalances",
      ["van_stocks", "warehouses"],
      "مرآة أرصدة السيارات مع ارتباط المندوب",
      "The van stock mirror with its rep binding",
    ),
    source(
      "inventory",
      "stock_moves + item_batches (ageing/expiry + conservation tie)",
      ["stock_moves", "item_batches", "items"],
      "حركات المخزون ودفعات الصلاحية للتقدم العمري والمطابقة",
      "Stock moves and expiry batches for ageing and the tie",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", warehouses: "optional" },
  aggregation: {
    groupBy: [],
    measures: [
      { id: "qty", kind: "sum" },
      { id: "value", kind: "sum" },
    ],
    sorting: [{ by: "warehouseCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted"],
  },
  assertions: [VAN_CONSERVATION_TIE],
  run: async (_ctx, params) => {
    const { distribution } = reportingServices();
    const warehouseIds = params.warehouseIds ?? null;
    const rows = await distribution.vanStockBalances({ warehouseIds });
    const tie = await distribution.vanConservationTie({ warehouseIds });
    let totalQty = "0.000000";
    let totalValue = "0.0000";
    for (const row of rows) {
      totalQty = addExact(totalQty, row.qty);
      totalValue = addExact(totalValue, row.value);
    }
    return {
      columns: [
        col("warehouseCode", "السيارة", "Van"),
        col("warehouseName", "اسم السيارة", "Van name"),
        col("repCode", "المندوب", "Rep"),
        col("repName", "اسم المندوب", "Rep name"),
        col("sku", "الصنف", "SKU"),
        col("itemName", "اسم الصنف", "Item"),
        col("batchNo", "الدفعة", "Batch"),
        col("expiryDate", "الانتهاء", "Expiry", "date"),
        col("daysToExpiry", "الأيام المتبقية", "Days left", "text", true),
        qtyCol("qty", "الكمية", "Qty"),
        moneyCol("value", "القيمة", "Value"),
        col("oldestInbound", "أقدم وارد", "Oldest inbound", "date"),
        col("ageDays", "عمر المخزون (يوم)", "Age (days)", "text", true),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.warehouseId}:${row.itemId}:${row.batchId ?? "none"}`,
        values: {
          warehouseCode: row.warehouseCode,
          warehouseName: row.warehouseName,
          repCode: row.repCode,
          repName: row.repName,
          sku: row.sku,
          itemName: params.locale === "ar" ? row.itemNameAr ?? row.itemName : row.itemName,
          batchNo: row.batchNo,
          expiryDate: row.expiryDate,
          daysToExpiry: row.daysToExpiry,
          qty: row.qty,
          value: row.value,
          oldestInbound: row.oldestInbound,
          ageDays: row.ageDays,
        },
      })),
      totals: [
        {
          id: "totalQty",
          kind: "sum",
          label: bilingual("إجمالي الكمية", "Total qty"),
          amount: totalQty,
        },
        {
          id: "totalValue",
          kind: "sum",
          label: bilingual("إجمالي القيمة", "Total value"),
          amount: totalValue,
        },
      ],
      assertionResults: [assertExact("van-conservation-tie", tie.mirrorSide, tie.movesSide)],
      notes: [
        bilingual(
          "التقدم العمري = أقدم حركة واردة لكل (سيارة، صنف، دفعة)؛ المرآة تُحدَّث داخل معاملات خدمات السيارات، وفشل المطابقة يعني مرآة قديمة.",
          "Ageing = the oldest inbound move per (van, item, batch); the mirror is refreshed inside the van services' owning transactions — a failed tie means a stale mirror.",
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// sales.discount_management_effectiveness — فاعلية السلع المجانية
// ---------------------------------------------------------------------------

export const salesDiscountEffectivenessContract = defineReport({
  id: "sales.discount_management_effectiveness",
  version: 1,
  title: bilingual("فاعلية السلع المجانية", "Free Goods (FOC) Effectiveness"),
  category: "industry",
  description: bilingual(
    "السلع المجانية الممنوحة (سطور FOC) مقابل المبيعات المدفوعة المرافقة لكل عميل وكل حملة ترويجية — تجميع حسب سبب FOC (BR-008: صفر السعر مع تكلفة وقيود)",
    "Free goods given (FOC lines) vs the paid sales alongside per customer and promotion — the foc_reason_code aggregation (BR-008: zero price, real cost and COGS)",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.sales.by-customer.read",
  dataSources: [
    source(
      "sales",
      "distributionQueries.discountEffectiveness",
      ["sales_invoice_lines", "sales_invoices"],
      "سطور السلع المجانية بأسبابها مع فواتيرها",
      "FOC invoice lines with their reason codes and invoices",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  aggregation: {
    groupBy: ["reasonCode"],
    measures: [
      { id: "focQty", kind: "sum" },
      { id: "focCostValue", kind: "sum" },
      { id: "pairedSalesNet", kind: "sum" },
    ],
    sorting: [{ by: "reasonCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["invoice.posted"],
  },
  assertions: [],
  run: async (_ctx, params) => {
    const { distribution } = reportingServices();
    const rows = await distribution.discountEffectiveness({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    let focQtyTotal = "0.000000";
    let focCostTotal = "0.0000";
    let pairedNetTotal = "0.0000";
    for (const row of rows) {
      focQtyTotal = addExact(focQtyTotal, row.focQty);
      focCostTotal = addExact(focCostTotal, row.focCostValue);
      pairedNetTotal = addExact(pairedNetTotal, row.pairedSalesNet);
    }
    return {
      columns: [
        col("reasonCode", "كود السبب", "Reason"),
        col("customerCode", "العميل", "Customer"),
        col("customerName", "اسم العميل", "Customer name"),
        col("focLineCount", "عدد السطور", "FOC lines", "text", true),
        qtyCol("focQty", "كمية المجاني", "FOC qty"),
        moneyCol("focRevenue", "إيراد المجاني", "FOC revenue"),
        moneyCol("focCostValue", "تكلفة المجاني", "FOC cost"),
        col("pairedInvoiceCount", "فواتير مرافقة", "Paired invoices", "text", true),
        qtyCol("pairedSalesQty", "كمية المبيعات المدفوعة", "Paired qty"),
        moneyCol("pairedSalesNet", "صافي المبيعات المدفوعة", "Paired sales net"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.reasonCode}:${row.customerCode ?? "unknown"}`,
        values: {
          reasonCode: row.reasonCode,
          customerCode: row.customerCode,
          customerName: row.customerName,
          focLineCount: row.focLineCount,
          focQty: row.focQty,
          focRevenue: row.focRevenue,
          focCostValue: row.focCostValue,
          pairedInvoiceCount: row.pairedInvoiceCount,
          pairedSalesQty: row.pairedSalesQty,
          pairedSalesNet: row.pairedSalesNet,
        },
      })),
      totals: [
        {
          id: "focQtyTotal",
          kind: "sum",
          label: bilingual("إجمالي كمية المجاني", "Total FOC qty"),
          amount: focQtyTotal,
        },
        {
          id: "focCostTotal",
          kind: "sum",
          label: bilingual("إجمالي تكلفة المجاني", "Total FOC cost"),
          amount: focCostTotal,
        },
        {
          id: "pairedNetTotal",
          kind: "sum",
          label: bilingual("إجمالي المبيعات المدفوعة المرافقة", "Total paired sales net"),
          amount: pairedNetTotal,
        },
      ],
      assertionResults: [],
      notes: [OPERATIONAL_NOTE],
    };
  },
});

// ---------------------------------------------------------------------------
// sales.commissions_due — العمولات المستحقة
// ---------------------------------------------------------------------------

export const salesCommissionsDueContract = defineReport({
  id: "sales.commissions_due",
  version: 1,
  title: bilingual("العمولات المستحقة", "Commissions Due"),
  category: "industry",
  description: bilingual(
    "العمولات لكل مندوب وللفترة: الأساس والنسبة والاستحقاق وحالة الدفع — الإجمالي المرحّل يطابق قيود مصروف العمولات في دفتر الأستاذ",
    "Commissions per rep per period: base, rate, accrual, and payout state — the posted total tied to the commission-expense GL lines",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    repIds: z.array(z.string().uuid()).nullish(),
  }),
  requiredPermission: "reports.sales.by-rep.read",
  dataSources: [
    source(
      "sales",
      "distributionQueries.commissionsDue",
      ["commission_runs", "commission_run_lines", "sales_reps"],
      "تشغيلات العمولات وخطوطها مع المندوبين",
      "Commission runs with their lines joined with the reps",
    ),
    source(
      "accounting",
      "journal (commissions total tie)",
      ["journal_entries", "journal_lines"],
      "قيود مخصص العمولات للمطابقة",
      "The commission accrual journals for the tie-out",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "both",
  aggregation: {
    groupBy: ["runId"],
    measures: [{ id: "commissionAmount", kind: "sum" }],
    sorting: [{ by: "periodFrom", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted"],
  },
  assertions: [COMMISSIONS_TOTAL_TIE],
  run: async (_ctx, params) => {
    const { distribution } = reportingServices();
    const rows = await distribution.commissionsDue({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    // The displayed + tied total covers the POSTED runs only (DRAFT runs
    // are computed, not accrued — no journal exists to tie).
    let postedTotal = "0.0000";
    for (const row of rows) {
      if (row.runStatus === "POSTED") {
        postedTotal = addExact(postedTotal, row.commissionAmount);
      }
    }
    const tie = await distribution.commissionsTotalTie({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("periodFrom", "من", "From", "date"),
        col("periodTo", "إلى", "To", "date"),
        col("basis", "الأساس", "Basis", "status"),
        col("runStatus", "حالة التشغيلة", "Run status", "status"),
        col("repCode", "المندوب", "Rep"),
        col("repName", "اسم المندوب", "Rep name"),
        moneyCol("baseAmount", "الأساس", "Base"),
        col("rateApplied", "النسبة %", "Rate %", "text", true),
        moneyCol("commissionAmount", "العمولة", "Commission"),
        col("payoutStatus", "حالة الدفع", "Payout", "status"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.runId}:${row.repCode}`,
        values: {
          periodFrom: row.periodFrom,
          periodTo: row.periodTo,
          basis: row.basis,
          runStatus: row.runStatus,
          repCode: row.repCode,
          repName: row.repName,
          baseAmount: row.baseAmount,
          rateApplied: row.rateApplied,
          commissionAmount: row.commissionAmount,
          payoutStatus: row.payoutStatus,
        },
      })),
      totals: [
        {
          id: "postedTotal",
          kind: "sum",
          label: bilingual("إجمالي العمولات المرحّلة", "Total posted commissions"),
          amount: postedTotal,
        },
      ],
      assertionResults: [assertExact("commissions-total-tie", tie.registerSide, tie.glSide)],
      notes: [
        bilingual(
          "الإجمالي يغطي التشغيلات المرحّلة فقط؛ التشغيلات المسودة معروضة للمتابعة ولا تُستحق بعد (لا قيد لها).",
          "The total covers POSTED runs only; DRAFT runs are listed for visibility but not yet accrued (no journal exists).",
        ),
      ],
    };
  },
});
