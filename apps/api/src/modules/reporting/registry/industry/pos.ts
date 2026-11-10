import { z } from "zod";

import type { ReportParams } from "../../application/contract";
import { assertExact } from "../../application/assertions";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-016 T12 · the POS report contracts (industries/reports/README
 * PHASE-016 rows): `pos.sales_by_terminal`, `pos.sales_by_hour`, and the
 * `treasury.shift_cash_reconciliation` the Z report reconciles against.
 * Bilingual AR/EN, canonical 4-decimal money strings, read-only over the
 * pos module's query surface (`posQueries`) — the same report contract
 * every PHASE-013 report rides (parameters, scoping, export, print).
 */

const WINDOW_PARAMS = {
  dateFrom: ISO_DATE,
  dateTo: ISO_DATE,
  branchIds: z.array(z.string().uuid()).nullish(),
  locale: LOCALE,
};

const POS_GL_TIE = assertDecl(
  "pos-gl-tie",
  "Σ POS invoice gross == GL cash/card/revenue movement of the same postings (window)",
  "إجمالي فواتير نقاط البيع لا يطابق حركات دفتر الأستاذ للفترة",
  "POS invoice totals do not tie to GL movements in the window",
);

async function posGlTieAssertion(params: ReportParams) {
  const { posQueries } = reportingServices();
  const tie = await posQueries.terminalTotalsGlTie({
    fromDate: params.dateFrom!,
    toDate: params.dateTo!,
  });
  return assertExact("pos-gl-tie", tie.documentSide, tie.glSide);
}

export const posSalesByTerminalContract = defineReport({
  id: "pos.sales_by_terminal",
  version: 1,
  title: bilingual("مبيعات نقاط البيع حسب الجهاز", "POS Sales by Terminal"),
  category: "sales",
  description: bilingual(
    "عدد الفواتير وصافي المبيعات والضريبة والإجمالي لكل طرفية نقاط بيع في فترة",
    "Invoice count, net, tax and gross per POS terminal for a period",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.sales.by-branch.read",
  dataSources: [
    source(
      "pos",
      "posQueries.salesByTerminal",
      ["sales_invoices", "pos_terminals"],
      "فواتير نقاط البيع المرحّلة مع سجل الأجهزة",
      "Posted POS invoices joined with the terminal registry",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "both",
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["invoice.posted", "pos_sale.posted"],
  },
  assertions: [POS_GL_TIE],
  run: async (_ctx, params) => {
    const { posQueries } = reportingServices();
    const rows = await posQueries.salesByTerminal({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("terminalCode", "الجهاز", "Terminal"),
        col("invoiceCount", "عدد الفواتير", "Invoices", "text", true),
        moneyCol("totalNet", "الصافي", "Net"),
        moneyCol("totalTax", "الضريبة", "Tax"),
        moneyCol("totalGross", "الإجمالي", "Gross"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.terminalCode,
        values: {
          terminalCode: row.terminalCode,
          invoiceCount: row.invoiceCount,
          totalNet: row.totalNet,
          totalTax: row.totalTax,
          totalGross: row.totalGross,
        },
      })),
      totals: [
        {
          id: "invoice-count",
          label: bilingual("إجمالي الفواتير", "Total invoices"),
          amount: String(rows.reduce((sum, row) => sum + row.invoiceCount, 0)),
          kind: "sum",
        },
      ],
      assertionResults: [await posGlTieAssertion(params)],
    };
  },
});

export const posSalesByHourContract = defineReport({
  id: "pos.sales_by_hour",
  version: 1,
  title: bilingual("مبيعات نقاط البيع حسب الساعة", "POS Sales by Hour"),
  category: "sales",
  description: bilingual(
    "توزيع فواتير وإجماليات نقاط البيع على ساعات اليوم",
    "POS invoice counts and gross totals by hour of day",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.sales.by-branch.read",
  dataSources: [
    source(
      "pos",
      "posQueries.salesByHour",
      ["sales_invoices"],
      "فواتير نقاط البيع المرحّلة حسب ساعة الإنشاء",
      "Posted POS invoices by creation hour",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "both",
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["invoice.posted", "pos_sale.posted"],
  },
  assertions: [POS_GL_TIE],
  run: async (_ctx, params) => {
    const { posQueries } = reportingServices();
    const rows = await posQueries.salesByHour({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      branchIds: params.branchIds ?? null,
    });
    return {
      columns: [
        col("hour", "الساعة", "Hour"),
        col("invoiceCount", "عدد الفواتير", "Invoices", "text", true),
        moneyCol("totalGross", "الإجمالي", "Gross"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.hour,
        values: { hour: `${row.hour}:00`, invoiceCount: row.invoiceCount, totalGross: row.totalGross },
      })),
      totals: [],
      assertionResults: [await posGlTieAssertion(params)],
    };
  },
});

export const treasuryShiftCashReconciliationContract = defineReport({
  id: "treasury.shift_cash_reconciliation",
  version: 1,
  title: bilingual("تسوية نقدية الورديات", "Shift Cash Reconciliation"),
  category: "treasury",
  description: bilingual(
    "كل وردية مع الرصيد المتوقع والفعلي وفرق BR-021 مقابل إجمالي مبيعات نقاط البيع على درجها",
    "Every shift with expected/counted amounts and the BR-021 variance against the POS gross that flowed through its till",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "reports.treasury.fx.read",
  dataSources: [
    source(
      "treasury",
      "posQueries.shiftCashReconciliation",
      ["cashier_shifts", "sales_invoices", "pos_terminals"],
      "سجل الورديات مع فواتير نقاط البيع المرحّلة",
      "Shift records joined with posted POS invoices",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "both",
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["shift.closed", "invoice.posted"],
  },
  assertions: [],
  run: async (_ctx, params) => {
    const { posQueries } = reportingServices();
    const rows = await posQueries.shiftCashReconciliation({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("shiftNo", "الوردية", "Shift"),
        col("terminalCode", "الجهاز", "Terminal"),
        col("status", "الحالة", "Status", "text", true),
        moneyCol("openingAmount", "الافتتاحي", "Opening"),
        moneyCol("posGross", "مبيعات النقاط", "POS gross"),
        moneyCol("capturedIn", "إيداعات", "Captured in"),
        moneyCol("capturedOut", "سحوبات", "Captured out"),
        moneyCol("expectedAmount", "المتوقع", "Expected"),
        moneyCol("countedAmount", "المفروز", "Counted"),
        moneyCol("difference", "الفرق (BR-021)", "Difference (BR-021)"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.shiftId,
        values: {
          shiftNo: row.shiftNo ?? row.shiftId.slice(0, 8),
          terminalCode: row.terminalCode ?? "—",
          status: row.status,
          openingAmount: row.openingAmount,
          posGross: row.posGross,
          capturedIn: row.capturedIn,
          capturedOut: row.capturedOut,
          expectedAmount: row.expectedAmount ?? "—",
          countedAmount: row.countedAmount ?? "—",
          difference: row.difference ?? "—",
        },
      })),
      totals: [],
      assertionResults: [],
    };
  },
});
