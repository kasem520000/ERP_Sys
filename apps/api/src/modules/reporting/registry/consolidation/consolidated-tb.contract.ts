import { addExact, compareExact } from "../../../accounting/application/decimal-strings";
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
 * PHASE-034 T8 · `consolidation.consolidated-tb` (REPORT_CATALOG §10 row 1
 * — the report key the catalog pins verbatim): the consolidated trial
 * balance — every account line of the completed run's snapshot, group
 * currency, with the elimination toggle; the footer carries the INV-026
 * headline assertion (block-on-fail) + the TB balance check.
 *
 * Statements read SNAPSHOTS — never live member books (O(1) renders). The
 * elimination toggle OFF renders the pre-elimination Σ members view and
 * the INV-026 note says so (eliminations subtract to zero — the
 * reconciliation still holds: the consolidated lines are the toggle's
 * input either way; the assertion compares the SNAPSHOT's stored
 * consolidated set, which always includes eliminations).
 *
 * Permission `consolidation.reports.view`. Deterministic over (group,
 * period): same snapshot ⇒ byte-identical output.
 */
export const consolidationConsolidatedTbContract = defineReport({
  id: "consolidation.consolidated-tb",
  version: 1,
  title: bilingual("ميزان المراجعة الموحد", "Consolidated Trial Balance"),
  category: "financial",
  description: bilingual(
    "ميزان المراجعة الموحد: كل الحسابات بلقطة تشغيل التوحيد المكتمل بعملة المجموعة مع مفتاح إظهار قيود الاستبعاد — يحمل مطابقة inv026 (Σ الشركات − الاستبعادات خطاً بخط) ومطابقة توازن الميزان اللتين تمنعان التصدير عند الفشل",
    "The consolidated trial balance: every account line from the completed run's snapshot in the group currency with the eliminations toggle — carrying the inv026 check (Σ members − eliminations, line-by-line) and the TB balance check that block exports on failure",
  ),
  parameters: statementParams,
  requiredPermission: "consolidation.reports.view",
  dataSources: [
    source(
      "consolidation",
      "consolidationQueries.statementSource (the completed run's immutable snapshot — never live member books)",
      ["consolidation_runs", "consolidation_groups", "group_entities", "elimination_entries"],
      "لقطة التشغيل المكتمل — مصدر القوائم الموحدة الوحيد",
      "The completed run's snapshot — the only consolidated-statement source",
    ),
    source(
      "accounting",
      "the audited platform-plane reader's member GL aggregates (frozen INTO the snapshot at run time — ADR-0018)",
      ["journal_entries", "journal_lines", "accounts"],
      "مجاميع أستاذ الشركات عبر القارئ المُدقّ (مجمّدة في اللقطة عند التشغيل)",
      "The member GL aggregates via the audited reader (frozen into the snapshot at run time)",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "optional", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [{ id: "debit", kind: "sum" }, { id: "credit", kind: "sum" }],
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
  drillTargets: [
    {
      from: "accountCode",
      route: "/consolidation/eliminations?account={accountCode}",
      label: bilingual("قيود الاستبعاد لهذا الحساب", "Eliminations for this account"),
      permission: "consolidation.eliminations.create",
    },
  ],
  exportFormats: ["pdf", "xlsx", "csv"],
  printTemplate: "a4-report",
  run: async (_ctx, params) => {
    const { consolidation } = reportingServices();
    const source = await consolidation.statementSource({
      groupId: params.groupId,
      fiscalPeriodId: params.fiscalPeriodId,
      statement: "TB",
    });
    const rows = source.rows.filter((row) => {
      if (params.includeEliminations !== false) return true;
      // The toggle-OFF view: lines whose ONLY movement is an elimination
      // effect drop out (the note explains); members-only lines stay.
      const eliminationCodes = new Set(source.snapshot.eliminations.map((line) => line.accountCode));
      return !eliminationCodes.has(row.accountCode);
    });
    let debitTotal = "0.0000";
    let creditTotal = "0.0000";
    for (const row of rows) {
      debitTotal = addExact(debitTotal, row.debit);
      creditTotal = addExact(creditTotal, row.credit);
    }
    return {
      columns: [
        col("accountCode", "الحساب", "Account", "text"),
        col("accountType", "النوع", "Type", "status"),
        col("purposeKey", "الغرض", "Purpose"),
        moneyCol("debit", "مدين", "Debit"),
        moneyCol("credit", "دائن", "Credit"),
        moneyCol("net", "الصافي", "Net"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.accountCode,
        values: {
          accountCode: row.accountCode,
          accountType: row.accountType,
          purposeKey: row.purposeKey ?? "—",
          debit: row.debit,
          credit: row.credit,
          net: row.net,
        },
      })),
      totals: [
        {
          id: "debitTotal",
          kind: "sum",
          label: bilingual(`إجمالي المدين (${source.baseCurrency})`, `Total debits (${source.baseCurrency})`),
          amount: debitTotal,
        },
        {
          id: "creditTotal",
          kind: "sum",
          label: bilingual(`إجمالي الدائن (${source.baseCurrency})`, `Total credits (${source.baseCurrency})`),
          amount: creditTotal,
        },
        {
          id: "memberCount",
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
          `مصدر البيانات: لقطة التشغيل ${source.runId} (تاريخ الفترة ${source.periodEndDate}) — الطريقة ${source.fxTranslationMethod}`,
          `Data source: run ${source.runId}'s snapshot (period end ${source.periodEndDate}) — method ${source.fxTranslationMethod}`,
        ),
        params.includeEliminations === false
          ? bilingual(
              "عرض ما قبل الاستبعادات (Σ الشركات فقط) — قيود الاستبعاد مستثناة بطلب المستخدم",
              "Pre-eliminations view (Σ members only) — eliminations excluded by user request",
            )
          : bilingual(
              "العرض يشمل أثر قيود الاستبعاد (الافتراضي)",
              "The view includes the eliminations effect (default)",
            ),
        bilingual(
          compareExact(debitTotal, creditTotal) === 0
            ? "الميزان متوازن"
            : "الميزان غير متوازن — راجع المطابقة",
          compareExact(debitTotal, creditTotal) === 0
            ? "The trial balance is balanced"
            : "The trial balance is unbalanced — see the assertion",
        ),
      ],
    };
  },
});
