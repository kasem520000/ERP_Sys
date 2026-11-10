import { addExact } from "../../../accounting/application/decimal-strings";
import { bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";
import {
  BR056_NOTE,
  FX_METHOD_NOTE,
  GROUP_VIEW_NOTE,
  INV026_ASSERTION,
  inv026Result,
  statementParams,
} from "./statements-shared";

/**
 * PHASE-034 T8 · `consolidation.consolidated-is` (REPORT_CATALOG §10 row
 * 2): the consolidated income statement — the snapshot's REVENUE/EXPENSE
 * lines in group currency (FINANCIAL_REPORT_RULES derivation), with the
 * INV-026 headline assertion in the footer (block-on-fail).
 *
 * Permission `consolidation.reports.view`. Deterministic over (group,
 * period). Reads the completed run's snapshot — never live member books.
 */
export const consolidationConsolidatedIsContract = defineReport({
  id: "consolidation.consolidated-is",
  version: 1,
  title: bilingual("قائمة الدخل الموحدة", "Consolidated Income Statement"),
  category: "financial",
  description: bilingual(
    "قائمة الدخل الموحدة: بنود الإيرادات والمصروفات من لقطة التشغيل المكتمل بعملة المجموعة مع صافي الدخل الموحد — تحمل مطابقة inv026 التي تمنع التصدير عند الفشل",
    "The consolidated income statement: the snapshot's revenue/expense lines in the group currency with the consolidated net income — carrying the inv026 check that blocks exports on failure",
  ),
  parameters: statementParams,
  requiredPermission: "consolidation.reports.view",
  dataSources: [
    source(
      "consolidation",
      "consolidationQueries.statementSource (the completed run's snapshot, IS slice)",
      ["consolidation_runs", "consolidation_groups", "group_entities", "elimination_entries"],
      "لقطة التشغيل المكتمل — شريحة قائمة الدخل",
      "The completed run's snapshot — the IS slice",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "optional", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [{ id: "net", kind: "sum" }],
    sorting: [{ by: "accountCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "as-of",
    cacheTtlSeconds: 86400,
    invalidationEvents: ["consolidation.run.completed"],
  },
  assertions: [INV026_ASSERTION],
  exportFormats: ["pdf", "xlsx", "csv"],
  printTemplate: "a4-report",
  run: async (_ctx, params) => {
    const { consolidation } = reportingServices();
    const source = await consolidation.statementSource({
      groupId: params.groupId,
      fiscalPeriodId: params.fiscalPeriodId,
      statement: "IS",
    });
    const rows = source.rows.filter(
      (row) => params.includeEliminations !== false || !isEliminationOnly(row.accountCode, source.snapshot.eliminations.map((line) => line.accountCode)),
    );
    let revenue = "0.0000";
    let expense = "0.0000";
    for (const row of rows) {
      if (row.accountType.toUpperCase() === "REVENUE") {
        revenue = addExact(revenue, row.credit);
      } else {
        expense = addExact(expense, row.debit);
      }
    }
    const net = addExact(revenue, `-${expense}`);
    return {
      columns: [
        col("accountCode", "الحساب", "Account", "text"),
        col("accountType", "النوع", "Type", "status"),
        moneyCol("credit", "دائن (إيراد)", "Credit (revenue)"),
        moneyCol("debit", "مدين (مصروف)", "Debit (expense)"),
        moneyCol("net", "الأثر الصافي", "Net effect"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.accountCode,
        values: {
          accountCode: row.accountCode,
          accountType: row.accountType,
          credit: row.credit,
          debit: row.debit,
          net: row.net,
        },
      })),
      totals: [
        {
          id: "revenueTotal",
          kind: "sum",
          label: bilingual(`إجمالي الإيرادات (${source.baseCurrency})`, `Total revenues (${source.baseCurrency})`),
          amount: revenue,
        },
        {
          id: "expenseTotal",
          kind: "sum",
          label: bilingual(`إجمالي المصروفات (${source.baseCurrency})`, `Total expenses (${source.baseCurrency})`),
          amount: expense,
        },
        {
          id: "netIncome",
          kind: "sum",
          label: bilingual(`صافي الدخل الموحد (${source.baseCurrency})`, `Consolidated net income (${source.baseCurrency})`),
          amount: net,
        },
      ],
      assertionResults: [inv026Result(source)],
      notes: [GROUP_VIEW_NOTE, FX_METHOD_NOTE, BR056_NOTE],
    };
  },
});

function isEliminationOnly(accountCode: string, eliminationCodes: readonly string[]): boolean {
  return eliminationCodes.includes(accountCode);
}
