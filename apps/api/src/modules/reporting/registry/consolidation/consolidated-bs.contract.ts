import { addExact } from "../../../accounting/application/decimal-strings";
import { bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";
import {
  BR056_NOTE,
  FX_METHOD_NOTE,
  GROUP_VIEW_NOTE,
  INV026_ASSERTION,
  TB_BALANCE_ASSERTION,
  inv026Result,
  statementParams,
  tbBalanceResult,
} from "./statements-shared";

/**
 * PHASE-034 T8 · `consolidation.consolidated-bs` (REPORT_CATALOG §10 row
 * 3): the consolidated balance sheet — the snapshot's
 * ASSET/LIABILITY/EQUITY lines in group currency, with the INV-026
 * headline assertion + the TB tie in the footer (block-on-fail).
 *
 * Permission `consolidation.reports.view`. Deterministic over (group,
 * period). Reads the completed run's snapshot — never live member books.
 */
export const consolidationConsolidatedBsContract = defineReport({
  id: "consolidation.consolidated-bs",
  version: 1,
  title: bilingual("قائمة المركز المالي الموحدة", "Consolidated Balance Sheet"),
  category: "financial",
  description: bilingual(
    "قائمة المركز المالي الموحدة: بنود الأصول والالتزامات وحقوق الملكية من لقطة التشغيل المكتمل بعملة المجموعة مع مفتاح إظهار قيود الاستبعاد — تحمل مطابقتي inv026 وربط الميزان اللتين تمنعان التصدير عند الفشل",
    "The consolidated balance sheet: the snapshot's asset/liability/equity lines in the group currency with the eliminations toggle — carrying the inv026 check and the balance tie that block exports on failure",
  ),
  parameters: statementParams,
  requiredPermission: "consolidation.reports.view",
  dataSources: [
    source(
      "consolidation",
      "consolidationQueries.statementSource (the completed run's snapshot, BS slice)",
      ["consolidation_runs", "consolidation_groups", "group_entities", "elimination_entries"],
      "لقطة التشغيل المكتمل — شريحة المركز المالي",
      "The completed run's snapshot — the BS slice",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", branches: "optional" },
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
  assertions: [INV026_ASSERTION, TB_BALANCE_ASSERTION],
  exportFormats: ["pdf", "xlsx", "csv"],
  printTemplate: "a4-report",
  run: async (_ctx, params) => {
    const { consolidation } = reportingServices();
    const source = await consolidation.statementSource({
      groupId: params.groupId,
      fiscalPeriodId: params.fiscalPeriodId,
      statement: "BS",
    });
    const eliminationCodes = new Set(
      source.snapshot.eliminations.map((line) => line.accountCode),
    );
    const rows = source.rows.filter(
      (row) => params.includeEliminations !== false || !eliminationCodes.has(row.accountCode),
    );
    let assets = "0.0000";
    let liabilities = "0.0000";
    let equity = "0.0000";
    for (const row of rows) {
      const type = row.accountType.toUpperCase();
      if (type === "ASSET") {
        assets = addExact(assets, row.debit);
      } else if (type === "LIABILITY") {
        liabilities = addExact(liabilities, row.credit);
      } else {
        equity = addExact(equity, row.credit);
      }
    }
    return {
      columns: [
        col("accountCode", "الحساب", "Account", "text"),
        col("accountType", "التصنيف", "Class", "status"),
        moneyCol("debit", "مدين (أصول)", "Debit (assets)"),
        moneyCol("credit", "دائن (التزامات/حقوق)", "Credit (liab./equity)"),
        moneyCol("net", "الصافي", "Net"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.accountCode,
        values: {
          accountCode: row.accountCode,
          accountType: row.accountType,
          debit: row.debit,
          credit: row.credit,
          net: row.net,
        },
      })),
      totals: [
        {
          id: "assetsTotal",
          kind: "sum",
          label: bilingual(`إجمالي الأصول (${source.baseCurrency})`, `Total assets (${source.baseCurrency})`),
          amount: assets,
        },
        {
          id: "liabilitiesTotal",
          kind: "sum",
          label: bilingual(`إجمالي الالتزامات (${source.baseCurrency})`, `Total liabilities (${source.baseCurrency})`),
          amount: liabilities,
        },
        {
          id: "equityTotal",
          kind: "sum",
          label: bilingual(`إجمالي حقوق الملكية (${source.baseCurrency})`, `Total equity (${source.baseCurrency})`),
          amount: equity,
        },
        {
          id: "members",
          kind: "sum",
          label: bilingual("عدد الشركات الموحدة", "Consolidated members"),
          amount: String(source.memberCount),
        },
      ],
      assertionResults: [inv026Result(source), tbBalanceResult(source)],
      notes: [
        GROUP_VIEW_NOTE,
        FX_METHOD_NOTE,
        BR056_NOTE,
        bilingual(
          "ملاحظة عرض حقوق الملكية: نسب الملكية المسجلة للإفصاح فقط (DR-006) — لا أتمتة لتوزيع حقوق الأقلية في هذا الإصدار",
          "Equity presentation note: ownership percentages are disclosure-only (DR-006) — no minority-interest waterfall automation ships at PHASE-034",
        ),
      ],
    };
  },
});
