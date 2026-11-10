import { z } from "zod";

import type { ReportContent, ReportParams } from "../../application/contract";
import {
  bsCurrentYearOnce,
  bsTbTie,
  cfCashTie,
  glEntryBalance,
  isNetEqualsBsCurrentResult,
  isTbTie,
  tbClosingNetZero,
  tbDebitsEqualCredits,
  ledgerTie,
} from "../../application/assertions";
import { addExact, subExact } from "../../../accounting/application/decimal-strings";
import {
  ISO_DATE,
  ISO_DATETIME,
  LOCALE,
  assertDecl,
  bilingual,
  col,
  defineReport,
  drill,
  FINANCIAL_ASSERTION_MESSAGES,
  moneyCol,
  source,
} from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-013 T8 · the financial statement contracts (REPORT_CATALOG §1):
 * TB, GL, IS, BS, CF, fiscal-close pack, journal register, cost centers —
 * as-of deterministic, §11 assertion-complete, drill-chained
 * (statement → account → journal → source document).
 *
 * Branch note: journal lines carry no branch dimension (migrations
 * 0001–0020) — statements are consolidated by construction and declare
 * `fixed-all`; documented in the completion report.
 */

const FINANCIAL_PARAMS = {
  dateFrom: ISO_DATE,
  dateTo: ISO_DATE,
  asOf: ISO_DATETIME.nullish(),
  locale: LOCALE,
  zeroSuppression: z.boolean().optional().default(true),
};

export function resolveAsOf(params: ReportParams): string | null {
  return params.asOf ?? null;
}

/** Locale-picked label helper. */
export function pick(label: { ar: string; en: string }, locale: string): string {
  return locale === "ar" ? label.ar : label.en;
}

// ---------------------------------------------------------------------------
// Trial Balance — ميزان المراجعة
// ---------------------------------------------------------------------------

export const trialBalanceContract = defineReport({
  id: "financial.trial-balance",
  version: 1,
  title: bilingual("ميزان المراجعة", "Trial Balance"),
  category: "financial",
  description: bilingual(
    "حركات ورصيد كل حساب لفترة محددة، مع التحقق من توازن المدين والدائن",
    "Per-account period movement and balance with debit/credit balance check",
  ),
  parameters: z.object({
    ...FINANCIAL_PARAMS,
    grouping: z.enum(["none", "account-type"]).optional().default("account-type"),
    includeOpening: z.boolean().optional().default(true),
  }),
  requiredPermission: "reports.financial.tb.read",
  dataSources: [
    source(
      "accounting",
      "statementQueries.trialBalance",
      ["journal_entries", "journal_lines", "accounts"],
      "حركات ومراكز الحسابات المرحّلة",
      "Posted account movements and balances",
    ),
  ],
  scopeRules: { branches: "fixed-all", asOf: "optional" },
  aggregation: {
    groupBy: ["accountType", "accountCode"],
    measures: [
      { id: "openingDebit", kind: "balance" },
      { id: "periodDebit", kind: "sum" },
      { id: "periodCredit", kind: "sum" },
      { id: "closingDebit", kind: "balance" },
      { id: "closingCredit", kind: "balance" },
    ],
    sorting: [{ by: "accountCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "balance-check", subTotalsByGroup: true },
  drillTargets: [
    drill(
      "accountRow",
      "/{locale}/accounting/gl?accountId={accountId}&from={dateFrom}&to={dateTo}",
      "دفتر الأستاذ للحساب",
      "Account ledger",
      "reports.financial.gl.read",
    ),
  ],
  assertions: [
    assertDecl(
      "tb-debits-equal-credits",
      "sum(periodDebit) == sum(periodCredit)",
      FINANCIAL_ASSERTION_MESSAGES["tb-debits-equal-credits"].ar,
      FINANCIAL_ASSERTION_MESSAGES["tb-debits-equal-credits"].en,
      "INV-001",
    ),
    assertDecl(
      "tb-closing-net-zero",
      "sum(closingDebit) - sum(closingCredit) == 0",
      FINANCIAL_ASSERTION_MESSAGES["tb-closing-net-zero"].ar,
      FINANCIAL_ASSERTION_MESSAGES["tb-closing-net-zero"].en,
      "INV-001/002",
    ),
  ],
  run: async (_ctx, params): Promise<ReportContent> => {
    const { statements } = reportingServices();
    const tb = await statements.trialBalance({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      asOf: resolveAsOf(params),
    });
    const suppress = params.zeroSuppression !== false;
    const visible = suppress
      ? tb.rows.filter(
          (row) =>
            row.openingDebit !== "0.0000" ||
            row.openingCredit !== "0.0000" ||
            row.periodDebit !== "0.0000" ||
            row.periodCredit !== "0.0000" ||
            row.closingDebit !== "0.0000" ||
            row.closingCredit !== "0.0000",
        )
      : tb.rows;
    const groups = new Map<string, { key: string; label: { ar: string; en: string } }>();
    for (const row of visible) {
      if (!groups.has(row.type)) {
        groups.set(row.type, {
          key: row.type,
          label: {
            ar: ACCOUNT_TYPE_AR[row.type] ?? row.type,
            en: ACCOUNT_TYPE_EN[row.type] ?? row.type,
          },
        });
      }
    }
    return {
      columns: [
        col("accountCode", "رمز الحساب", "Account code"),
        col("accountName", "الحساب", "Account"),
        moneyCol("openingDebit", "مدين افتتاحي", "Opening debit"),
        moneyCol("openingCredit", "دائن افتتاحي", "Opening credit"),
        moneyCol("periodDebit", "مدين الفترة", "Period debit"),
        moneyCol("periodCredit", "دائن الفترة", "Period credit"),
        moneyCol("closingDebit", "مدين ختامي", "Closing debit"),
        moneyCol("closingCredit", "دائن ختامي", "Closing credit"),
      ],
      groups: [...groups.values()],
      rows: visible.map((row) => ({
        key: row.accountId,
        groupKey: row.type,
        values: {
          accountCode: row.code,
          accountName: row.name,
          openingDebit: params.includeOpening === false ? null : row.openingDebit,
          openingCredit: params.includeOpening === false ? null : row.openingCredit,
          periodDebit: row.periodDebit,
          periodCredit: row.periodCredit,
          closingDebit: row.closingDebit,
          closingCredit: row.closingCredit,
          accountId: row.accountId,
          dateFrom: params.dateFrom ?? null,
          dateTo: params.dateTo ?? null,
        },
        drillLinks: [
          {
            label: bilingual("دفتر الأستاذ للحساب", "Account ledger"),
            route: `/${params.locale}/accounting/gl?accountId=${row.accountId}&from=${params.dateFrom}&to=${params.dateTo}`,
          },
        ],
      })),
      totals: [
        {
          id: "periodDebit",
          label: bilingual("إجمالي مدين الفترة", "Total period debit"),
          amount: tb.totals.periodDebit,
          kind: "sum",
        },
        {
          id: "periodCredit",
          label: bilingual("إجمالي دائن الفترة", "Total period credit"),
          amount: tb.totals.periodCredit,
          kind: "sum",
        },
        {
          id: "closingDebit",
          label: bilingual("إجمالي المدين الختامي", "Total closing debit"),
          amount: tb.totals.closingDebit,
          kind: "sum",
        },
        {
          id: "closingCredit",
          label: bilingual("إجمالي الدائن الختامي", "Total closing credit"),
          amount: tb.totals.closingCredit,
          kind: "check",
        },
      ],
      assertionResults: [
        tbDebitsEqualCredits(tb.totals.periodDebit, tb.totals.periodCredit),
        tbClosingNetZero(tb.totals.closingDebit, tb.totals.closingCredit),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// General Ledger — دفتر الأستاذ العام
// ---------------------------------------------------------------------------

export const generalLedgerContract = defineReport({
  id: "financial.general-ledger",
  version: 1,
  title: bilingual("دفتر الأستاذ العام", "General Ledger"),
  category: "financial",
  description: bilingual(
    "حركات حساب محدد مع الرصيد الجاري والوصول إلى القيد والمستند المصدر",
    "One account's ledger with running balance and entry/document drill",
  ),
  parameters: z.object({
    ...FINANCIAL_PARAMS,
    accountId: z.string().uuid(),
  }),
  requiredPermission: "reports.financial.gl.read",
  dataSources: [
    source(
      "accounting",
      "statementQueries.generalLedger",
      ["journal_entries", "journal_lines", "accounts"],
      "بنود القيود المرحّلة على الحساب",
      "Posted journal lines on the account",
    ),
  ],
  scopeRules: { branches: "fixed-all" },
  aggregation: {
    groupBy: [],
    measures: [
      { id: "debit", kind: "sum" },
      { id: "credit", kind: "sum" },
    ],
    sorting: [{ by: "entryDate", dir: "asc" }],
    zeroSuppression: "none",
  },
  totals: { grandTotals: "sum", subTotalsByGroup: false },
  drillTargets: [
    drill(
      "lineRow",
      "/{locale}/accounting/journals/{entryId}",
      "القيد المحاسبي",
      "Journal entry",
      "accounting.journals.read",
    ),
  ],
  assertions: [
    assertDecl(
      "gl-entry-balance",
      "every included entry balances (base)",
      FINANCIAL_ASSERTION_MESSAGES["gl-entry-balance"].ar,
      FINANCIAL_ASSERTION_MESSAGES["gl-entry-balance"].en,
      "INV-001/002",
    ),
  ],
  run: async (_ctx, params): Promise<ReportContent> => {
    const { statements } = reportingServices();
    const ledger = await statements.generalLedger({
      accountId: params.accountId!,
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      asOf: resolveAsOf(params),
    });
    const unbalanced = await statements.unbalancedEntries({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      asOf: resolveAsOf(params),
    });
    return {
      columns: [
        col("entryDate", "التاريخ", "Date", "date"),
        col("entryNo", "رقم القيد", "Entry no"),
        col("description", "البيان", "Description"),
        col("memo", "ملاحظة السطر", "Line memo"),
        col("currency", "العملة", "Currency"),
        moneyCol("debit", "مدين", "Debit"),
        moneyCol("credit", "دائن", "Credit"),
        moneyCol("balance", "الرصيد", "Balance"),
      ],
      groups: [],
      rows: ledger.lines.map((line) => ({
        key: `${line.entryId}:${line.lineNo}`,
        values: {
          entryDate: line.entryDate,
          entryNo: line.entryNo,
          description: line.description,
          memo: line.memo,
          currency: line.currencyCode,
          debit: line.direction === "DEBIT" ? line.baseAmount : null,
          credit: line.direction === "CREDIT" ? line.baseAmount : null,
          balance: line.balanceAfter,
          entryId: line.entryId,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
        },
        drillLinks: [
          {
            label: bilingual("القيد المحاسبي", "Journal entry"),
            route: `/${params.locale}/accounting/journals/${line.entryId}`,
          },
        ],
      })),
      totals: [
        {
          id: "opening",
          label: bilingual("الرصيد الافتتاحي", "Opening balance"),
          amount: ledger.openingBalance,
          kind: "sum",
        },
      ],
      assertionResults: [glEntryBalance(unbalanced)],
    };
  },
});

// ---------------------------------------------------------------------------
// Income Statement — قائمة الدخل
// ---------------------------------------------------------------------------

export const incomeStatementContract = defineReport({
  id: "financial.income-statement",
  version: 1,
  title: bilingual("قائمة الدخل", "Income Statement"),
  category: "financial",
  description: bilingual(
    "الإيرادات مطروحاً منها المردودات والخصومات ثم تكلفة المبيعات والمصروفات حتى صافي الدخل",
    "Revenue net of returns/discounts, COGS and expenses down to net income",
  ),
  parameters: z.object({
    ...FINANCIAL_PARAMS,
    comparative: z.enum(["none", "prior-period", "prior-year"]).optional().default("none"),
  }),
  requiredPermission: "reports.financial.is.read",
  dataSources: [
    source(
      "accounting",
      "statementQueries.incomeStatement",
      ["journal_lines", "journal_entries", "accounts", "account_purposes"],
      "بنود القيود المرحّلة لحسابات الإيرادات والمصروفات",
      "Posted lines on revenue/expense accounts",
    ),
  ],
  scopeRules: { branches: "fixed-all", asOf: "optional" },
  aggregation: {
    groupBy: ["section", "accountCode"],
    measures: [{ id: "presented", kind: "sum" }],
    sorting: [{ by: "accountCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { grandTotals: "balance-check", subTotalsByGroup: true },
  assertions: [
    assertDecl(
      "is-tb-tie",
      "IS lines == TB revenue/expense movements",
      FINANCIAL_ASSERTION_MESSAGES["is-tb-tie"].ar,
      FINANCIAL_ASSERTION_MESSAGES["is-tb-tie"].en,
    ),
    assertDecl(
      "is-net-equals-bs-current-result",
      "IS net income == BS current-year result line",
      FINANCIAL_ASSERTION_MESSAGES["is-net-equals-bs-current-result"].ar,
      FINANCIAL_ASSERTION_MESSAGES["is-net-equals-bs-current-result"].en,
    ),
  ],
  run: async (_ctx, params): Promise<ReportContent> => {
    const { statements } = reportingServices();
    const fiscalYearStart = statements.fiscalYearStartOf(params.dateTo!);
    const is = await statements.incomeStatement({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      asOf: resolveAsOf(params),
      fiscalYearStart,
    });
    // is-tb-tie: IS section totals vs TB movements (same window, independent pass).
    const tb = await statements.trialBalance({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      asOf: resolveAsOf(params),
    });
    const tbRevenue = tb.rows
      .filter((row) => row.type === "REVENUE")
      .reduce((acc, row) => addExact(acc, subExact("0.0000", subExact(row.periodDebit, row.periodCredit))), "0.0000");
    // PHASE-013 fix (T-TESTS): expenses are debit-normal — the presented
    // movement is periodDebit − periodCredit (positive), matching the
    // statement's per-normal-side presentation. The original outer
    // subExact("0.0000", …) negated them, so is-tb-tie compared +expenses
    // against −movements.
    const tbExpense = tb.rows
      .filter((row) => row.type === "EXPENSE")
      .reduce((acc, row) => addExact(acc, subExact(row.periodDebit, row.periodCredit)), "0.0000");
    const isNetFromLines = subExact(is.totals.netRevenue, addExact(is.totals.cogsTotal, is.totals.expenseTotal));
    // Cross-statement: BS current-year line at the same asOf.
    const bs = await statements.balanceSheet({
      asOfDate: params.dateTo!,
      asOf: resolveAsOf(params),
      fiscalYearStart,
    });

    const rows: ReportContent["rows"][number][] = [];
    const pushLine = (
      section: string,
      code: string,
      name: string,
      nameAr: string,
      amount: string,
    ) => {
      rows.push({
        key: `${section}:${code}`,
        groupKey: section,
        values: { accountCode: code, accountName: nameAr, line: name, amount },
      });
    };
    for (const line of is.revenue) {
      pushLine(
        line.isContra ? "revenue-contra" : "revenue",
        line.code,
        line.name,
        line.nameAr,
        line.presented,
      );
    }
    for (const line of is.cogs) {
      pushLine("cogs", line.code, line.name, line.nameAr, line.presented);
    }
    for (const line of is.expenses) {
      pushLine("expenses", line.code, line.name, line.nameAr, line.presented);
    }
    return {
      columns: [
        col("accountCode", "الرمز", "Code"),
        col("accountName", "الحساب", "Account"),
        moneyCol("amount", "المبلغ", "Amount"),
      ],
      groups: [
        { key: "revenue", label: bilingual("الإيرادات", "Revenue") },
        { key: "revenue-contra", label: bilingual("مطروحات الإيرادات", "Revenue deductions") },
        { key: "cogs", label: bilingual("تكلفة المبيعات", "COGS") },
        { key: "expenses", label: bilingual("المصروفات", "Expenses") },
      ],
      rows,
      totals: [
        {
          id: "netRevenue",
          label: bilingual("صافي الإيرادات", "Net revenue"),
          amount: is.totals.netRevenue,
          kind: "sum",
        },
        {
          id: "grossProfit",
          label: bilingual("مجمل الربح", "Gross profit"),
          amount: is.totals.grossProfit,
          kind: "sum",
        },
        {
          id: "netIncome",
          label: bilingual("صافي الدخل", "Net income"),
          amount: is.totals.netIncome,
          kind: "check",
        },
        {
          id: "ytdNetIncome",
          label: bilingual("صافي الدخل من بداية السنة", "YTD net income"),
          amount: is.totals.ytdNetIncome,
          kind: "sum",
        },
      ],
      assertionResults: [
        isTbTie(
          [
            { id: "netRevenue", amount: is.totals.netRevenue },
            { id: "expenses-total", amount: addExact(is.totals.cogsTotal, is.totals.expenseTotal) },
          ],
          [
            { id: "netRevenue", amount: tbRevenue },
            { id: "expenses-total", amount: tbExpense },
          ],
        ),
        isNetEqualsBsCurrentResult(isNetFromLines, bs.currentYearResult.total),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// Balance Sheet — قائمة المركز المالي
// ---------------------------------------------------------------------------

export const balanceSheetContract = defineReport({
  id: "financial.balance-sheet",
  version: 1,
  title: bilingual("قائمة المركز المالي", "Balance Sheet"),
  category: "financial",
  description: bilingual(
    "أرصدة الأصول والالتزامات وحقوق الملكية حتى تاريخ محدد مع بند نتيجة السنة الجارية",
    "As-of asset, liability and equity balances with the current-year result line",
  ),
  parameters: z.object({
    asOfDate: ISO_DATE,
    asOf: ISO_DATETIME.nullish(),
    locale: LOCALE,
    comparative: z.enum(["none", "prior-year"]).optional().default("none"),
  }),
  requiredPermission: "reports.financial.bs.read",
  dataSources: [
    source(
      "accounting",
      "statementQueries.balanceSheet",
      ["journal_entries", "journal_lines", "accounts", "account_purposes"],
      "أرصدة الحسابات المرحّلة حتى التاريخ",
      "Posted account balances as of a date",
    ),
  ],
  scopeRules: { branches: "fixed-all", dateRange: "optional", asOf: "optional" },
  aggregation: {
    groupBy: ["section", "accountCode"],
    measures: [{ id: "amount", kind: "balance" }],
    sorting: [{ by: "accountCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { grandTotals: "balance-check", subTotalsByGroup: true },
  assertions: [
    assertDecl(
      "bs-tb-tie",
      "BS closing balances == TB closing balances",
      FINANCIAL_ASSERTION_MESSAGES["bs-tb-tie"].ar,
      FINANCIAL_ASSERTION_MESSAGES["bs-tb-tie"].en,
    ),
    assertDecl(
      "bs-current-year-once",
      "current-year result counted exactly once",
      FINANCIAL_ASSERTION_MESSAGES["bs-current-year-once"].ar,
      FINANCIAL_ASSERTION_MESSAGES["bs-current-year-once"].en,
    ),
  ],
  run: async (_ctx, params): Promise<ReportContent> => {
    const { statements } = reportingServices();
    const fiscalYearStart = statements.fiscalYearStartOf(params.asOfDate!);
    const bs = await statements.balanceSheet(
      {
        asOfDate: params.asOfDate!,
        asOf: resolveAsOf(params),
        fiscalYearStart,
      },
      { priorYearComparative: params.comparative === "prior-year" },
    );
    // bs-tb-tie: per-side sums == TB closing balances (independent pass).
    const tb = await statements.trialBalance({
      fromDate: "0001-01-01",
      toDate: params.asOfDate!,
      asOf: resolveAsOf(params),
    });
    const signedClosing = (row: { closingDebit: string; closingCredit: string }): string =>
      subExact(row.closingDebit, row.closingCredit);
    const tbAssets = tb.rows
      .filter((row) => row.type === "ASSET")
      .reduce((acc, row) => addExact(acc, signedClosing(row)), "0.0000");
    const tbLe = tb.rows
      .filter((row) => row.type === "LIABILITY" || row.type === "EQUITY")
      .reduce((acc, row) => addExact(acc, subExact("0.0000", signedClosing(row))), "0.0000");
    const rows: ReportContent["rows"][number][] = [];
    const pushLine = (section: string, line: { code: string; nameAr: string; name: string; amount: string }) => {
      rows.push({
        key: `${section}:${line.code}`,
        groupKey: section,
        values: {
          accountCode: line.code,
          accountName: line.nameAr,
          line: line.name,
          amount: line.amount,
        },
      });
    };
    for (const line of bs.assets) {
      pushLine("assets", line);
    }
    for (const line of bs.liabilities) {
      pushLine("liabilities", line);
    }
    for (const line of bs.equity) {
      pushLine("equity", line);
    }
    rows.push({
      key: "equity:current-year",
      groupKey: "equity",
      values: {
        accountCode: "—",
        accountName: "صافي دخل السنة الجارية",
        line: "Net income — current year",
        amount: bs.currentYearResult.total,
      },
    });
    return {
      columns: [
        col("accountCode", "الرمز", "Code"),
        col("accountName", "الحساب", "Account"),
        moneyCol("amount", "الرصيد", "Balance"),
      ],
      groups: [
        { key: "assets", label: bilingual("الأصول", "Assets") },
        { key: "liabilities", label: bilingual("الالتزامات", "Liabilities") },
        { key: "equity", label: bilingual("حقوق الملكية", "Equity") },
      ],
      rows,
      totals: [
        {
          id: "totalAssets",
          label: bilingual("إجمالي الأصول", "Total assets"),
          amount: bs.totals.totalAssets,
          kind: "sum",
        },
        {
          id: "totalLiabilities",
          label: bilingual("إجمالي الالتزامات", "Total liabilities"),
          amount: bs.totals.totalLiabilities,
          kind: "sum",
        },
        {
          id: "totalEquity",
          label: bilingual("إجمالي حقوق الملكية", "Total equity"),
          amount: bs.totals.totalEquity,
          kind: "sum",
        },
        {
          id: "balanceCheck",
          label: bilingual("الأصول = الالتزامات + حقوق الملكية", "Assets = Liabilities + Equity"),
          amount: bs.totals.difference,
          kind: "check",
        },
      ],
      assertionResults: [
        bsTbTie(bs.totals.totalAssets, tbAssets),
        ledgerTie("bs-tb-tie-le", addExact(bs.totals.totalLiabilities, bs.totals.totalEquity), addExact(tbLe, bs.currentYearResult.total)),
        bsCurrentYearOnce(
          bs.currentYearResult.total,
          bs.currentYearResult.closingComponent,
          bs.currentYearResult.ytdComponent,
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// Cash Flow (indirect) — قائمة التدفقات النقدية
// ---------------------------------------------------------------------------

export const cashFlowContract = defineReport({
  id: "financial.cash-flow",
  version: 1,
  title: bilingual("قائمة التدفقات النقدية", "Cash Flow Statement"),
  category: "financial",
  description: bilingual(
    "طريقة غير مباشرة: صافي الدخل مع تغيرات رأس المال العامل والاستثمار والتمويل حتى صافي التغير في النقدية",
    "Indirect method: net income ± working capital, investing and financing to the net cash change",
  ),
  parameters: z.object(FINANCIAL_PARAMS),
  requiredPermission: "reports.financial.cf.read",
  dataSources: [
    source(
      "accounting",
      "statementQueries.cashFlow",
      ["journal_entries", "journal_lines", "accounts", "account_purposes"],
      "أرصدة الحسابات المالية عند بداية الفترة ونهايتها",
      "Account balances at window start and end",
    ),
  ],
  scopeRules: { branches: "fixed-all", asOf: "optional" },
  aggregation: {
    groupBy: ["section"],
    measures: [{ id: "delta", kind: "sum" }],
    sorting: [],
    zeroSuppression: "none",
  },
  totals: { grandTotals: "balance-check", subTotalsByGroup: true },
  assertions: [
    assertDecl(
      "cf-cash-tie",
      "computed net change == Δ cash + equivalents",
      FINANCIAL_ASSERTION_MESSAGES["cf-cash-tie"].ar,
      FINANCIAL_ASSERTION_MESSAGES["cf-cash-tie"].en,
      "INV-019",
    ),
  ],
  run: async (_ctx, params): Promise<ReportContent> => {
    const { statements } = reportingServices();
    const fiscalYearStart = statements.fiscalYearStartOf(params.dateTo!);
    const cf = await statements.cashFlow({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      asOf: resolveAsOf(params),
      fiscalYearStart,
    });
    const rows: ReportContent["rows"][number][] = [];
    rows.push({
      key: "operating:net-income",
      groupKey: "operating",
      values: {
        line: "صافي الدخل / Net income",
        accountName: "صافي الدخل",
        delta: cf.totals.netIncome,
      },
    });
    const pushAdj = (
      section: string,
      line: { code: string; nameAr: string; name: string; delta: string },
    ) => {
      rows.push({
        key: `${section}:${line.code}`,
        groupKey: section,
        values: {
          accountCode: line.code,
          accountName: line.nameAr,
          line: line.name,
          delta: subExact("0.0000", line.delta),
        },
      });
    };
    for (const line of cf.operatingAdjustments) {
      pushAdj("operating", line);
    }
    for (const line of cf.investingAdjustments) {
      pushAdj("investing", line);
    }
    for (const line of cf.financingAdjustments) {
      pushAdj("financing", line);
    }
    for (const line of cf.otherAdjustments) {
      pushAdj("other", line);
    }
    return {
      columns: [
        col("accountCode", "الرمز", "Code"),
        col("accountName", "الحساب", "Account"),
        moneyCol("delta", "التغير", "Change"),
      ],
      groups: [
        { key: "operating", label: bilingual("الأنشطة التشغيلية", "Operating activities") },
        { key: "investing", label: bilingual("الأنشطة الاستثمارية", "Investing activities") },
        { key: "financing", label: bilingual("الأنشطة التمويلية", "Financing activities") },
        { key: "other", label: bilingual("أخرى", "Other") },
      ],
      rows,
      totals: [
        {
          id: "computedChange",
          label: bilingual("صافي التغير في النقدية (محسوب)", "Net change in cash (computed)"),
          amount: cf.totals.computedChange,
          kind: "sum",
        },
        {
          id: "actualCashDelta",
          label: bilingual("التغير الفعلي في النقدية", "Actual cash delta"),
          amount: cf.totals.actualCashDelta,
          kind: "sum",
        },
        {
          id: "cashTie",
          label: bilingual("فرق المطابقة", "Tie difference"),
          amount: cf.totals.difference,
          kind: "check",
        },
      ],
      assertionResults: [cfCashTie(cf.totals.computedChange, cf.totals.actualCashDelta)],
      notes: [
        bilingual(
          "طريقة غير مباشرة: الحسابات غير المصنفة تُجمّع في بند «أخرى» — التصنيف المباشر تحسين لاحق",
          "Indirect method: untagged accounts aggregate under “Other” — direct classification is a post-MVP enhancement",
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// Journal Register — دفتر اليومية (REPORT_CATALOG §1, PHASE-007 data)
// ---------------------------------------------------------------------------

export const journalRegisterContract = defineReport({
  id: "accounting.journal-register",
  version: 1,
  title: bilingual("دفتر اليومية", "Journal Register"),
  category: "financial",
  description: bilingual(
    "قيود اليومية المرحّلة لفترة مع فلتر نوع المصدر",
    "Posted journal entries for a period with a source-type filter",
  ),
  parameters: z.object({
    ...FINANCIAL_PARAMS,
    sourceType: z.string().optional(),
  }),
  requiredPermission: "accounting.journals.read",
  dataSources: [
    source(
      "accounting",
      "glQueries.journalRegister",
      ["journal_entries", "journal_lines"],
      "قيود اليومية المرحّلة",
      "Posted journal entries",
    ),
  ],
  scopeRules: { branches: "fixed-all" },
  aggregation: {
    groupBy: [],
    measures: [
      { id: "totalDebit", kind: "sum" },
      { id: "totalCredit", kind: "sum" },
    ],
    sorting: [{ by: "entryDate", dir: "asc" }],
    zeroSuppression: "none",
  },
  totals: { grandTotals: "balance-check", subTotalsByGroup: false },
  assertions: [
    assertDecl(
      "gl-entry-balance",
      "every included entry balances (base)",
      FINANCIAL_ASSERTION_MESSAGES["gl-entry-balance"].ar,
      FINANCIAL_ASSERTION_MESSAGES["gl-entry-balance"].en,
      "INV-001/002",
    ),
  ],
  run: async (_ctx, params): Promise<ReportContent> => {
    const { gl, statements } = reportingServices();
    const register = await gl.journalRegister({
      fromDate: params.dateFrom,
      toDate: params.dateTo,
      sourceType: params.sourceType,
      limit: 5000,
    });
    const unbalanced = await statements.unbalancedEntries({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      asOf: resolveAsOf(params),
    });
    return {
      columns: [
        col("entryDate", "التاريخ", "Date", "date"),
        col("entryNo", "رقم القيد", "Entry no"),
        col("sourceType", "نوع المصدر", "Source type"),
        col("description", "البيان", "Description"),
        moneyCol("totalDebit", "إجمالي المدين", "Total debit"),
        moneyCol("totalCredit", "إجمالي الدائن", "Total credit"),
      ],
      groups: [],
      rows: register.map((entry) => ({
        key: entry.id,
        values: {
          entryDate: entry.entryDate,
          entryNo: entry.entryNo,
          sourceType: entry.sourceType,
          description: entry.description,
          totalDebit: entry.totalDebit,
          totalCredit: entry.totalCredit,
        },
      })),
      totals: [],
      assertionResults: [glEntryBalance(unbalanced)],
    };
  },
});

// ---------------------------------------------------------------------------
// Cost Center Analysis — تحليل مراكز التكلفة
// ---------------------------------------------------------------------------

export const costCentersContract = defineReport({
  id: "accounting.cost-centers",
  version: 1,
  title: bilingual("تحليل مراكز التكلفة", "Cost Center Analysis"),
  category: "financial",
  description: bilingual(
    "حركات مدين ودائن لكل مركز تكلفة وحساب في فترة",
    "Debit/credit movement per cost center and account for a period",
  ),
  parameters: z.object(FINANCIAL_PARAMS),
  requiredPermission: "reports.accounting.cost-centers.read",
  dataSources: [
    source(
      "accounting",
      "glQueries.costCenterBreakdown",
      ["journal_lines", "cost_centers", "accounts"],
      "بنود القيود حسب مركز التكلفة",
      "Journal lines by cost center",
    ),
  ],
  scopeRules: { branches: "fixed-all" },
  aggregation: {
    groupBy: ["costCenter", "accountCode"],
    measures: [
      { id: "debit", kind: "sum" },
      { id: "credit", kind: "sum" },
    ],
    sorting: [{ by: "accountCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { grandTotals: "balance-check", subTotalsByGroup: true },
  assertions: [
    assertDecl(
      "tb-debits-equal-credits",
      "sum(debit) == sum(credit)",
      FINANCIAL_ASSERTION_MESSAGES["tb-debits-equal-credits"].ar,
      FINANCIAL_ASSERTION_MESSAGES["tb-debits-equal-credits"].en,
      "INV-001",
    ),
  ],
  run: async (_ctx, params): Promise<ReportContent> => {
    const rows = await costCenterBreakdownFeed(params);
    let totalDebit = "0.0000";
    let totalCredit = "0.0000";
    const content: ReportContent["rows"] = rows.map((row) => {
      totalDebit = addExact(totalDebit, row.debit);
      totalCredit = addExact(totalCredit, row.credit);
      return {
        key: `${row.costCenterId ?? "none"}:${row.accountCode}`,
        groupKey: row.costCenterCode ?? "none",
        values: {
          costCenter: row.costCenterName ?? "—",
          accountCode: row.accountCode,
          accountName: row.accountName,
          debit: row.debit,
          credit: row.credit,
        },
      };
    });
    return {
      columns: [
        col("costCenter", "مركز التكلفة", "Cost center"),
        col("accountCode", "رمز الحساب", "Account code"),
        col("accountName", "الحساب", "Account"),
        moneyCol("debit", "مدين", "Debit"),
        moneyCol("credit", "دائن", "Credit"),
      ],
      groups: [],
      rows: content,
      totals: [
        {
          id: "totalDebit",
          label: bilingual("إجمالي المدين", "Total debit"),
          amount: totalDebit,
          kind: "sum",
        },
        {
          id: "totalCredit",
          label: bilingual("إجمالي الدائن", "Total credit"),
          amount: totalCredit,
          kind: "check",
        },
      ],
      assertionResults: [tbDebitsEqualCredits(totalDebit, totalCredit)],
    };
  },
});

async function costCenterBreakdownFeed(
  params: ReportParams,
): Promise<
  { costCenterId: string | null; costCenterCode: string | null; costCenterName: string | null; accountCode: string; accountName: string; debit: string; credit: string }[]
> {
  // Reaches the accounting store through the reporting service locator's
  // own module surface (cost-center breakdown lives in journal.store).
  const { journalStore } = await import("../feed");
  return journalStore.costCenterBreakdown({
    fromDate: params.dateFrom!,
    toDate: params.dateTo!,
  });
}

const ACCOUNT_TYPE_AR: Record<string, string> = {
  ASSET: "الأصول",
  LIABILITY: "الالتزامات",
  EQUITY: "حقوق الملكية",
  REVENUE: "الإيرادات",
  EXPENSE: "المصروفات",
};

const ACCOUNT_TYPE_EN: Record<string, string> = {
  ASSET: "Assets",
  LIABILITY: "Liabilities",
  EQUITY: "Equity",
  REVENUE: "Revenue",
  EXPENSE: "Expenses",
};
