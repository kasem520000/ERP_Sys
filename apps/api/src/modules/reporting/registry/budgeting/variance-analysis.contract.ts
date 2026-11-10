import { z } from "zod";

import {
  ISO_DATE,
  LOCALE,
  assertDecl,
  bilingual,
  col,
  defineReport,
  moneyCol,
  source,
} from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-028 wave C · `budgeting.variance-analysis` (REPORT_CATALOG §9 row
 * 237 — the report key the catalog pins verbatim): the period trend of
 * budget-vs-actual variance with the top over/under-budget lines and
 * threshold highlighting (≥ warn_threshold_percent ⇒ the OVER flag) — the
 * companion analysis view of `budgeting.budget-vs-actual`.
 *
 * Same as-of rule, same natural-direction convention, same
 * `budget-ledger-tie` block-on-fail assertion (the tie is WHOLE TENANT —
 * display filters never narrow the ledger check). Permission
 * `budgeting.reports.view`. Budgets are NOT ledger documents (DR-004) —
 * read-only over the GL, always.
 */

const BUDGET_LEDGER_TIE = assertDecl(
  "budget-ledger-tie",
  "per (period, account): Σ dimension-grouped actuals (debit + credit) == the trial-balance movements for the same window (tolerance 0, whole tenant)",
  "مجاميع الاستهلاك المجمّعة حسب البُعد لا تطابق حركات ميزان المراجعة لنفس النافذة — الفترة/الحساب غير المطابق يمنع التصدير",
  "The dimension-grouped actuals do not fold back to the trial-balance movements for the same window — the broken period/account blocks export",
  "INV-022",
);

const THRESHOLD_NOTE = bilingual(
  "تُبرز الأسطر التي بلغت أو تجاوزت حد التحذير (budgeting.controls.warn_threshold_percent — ‎100 افتراضياً): علم OVER على النسبة المستخدمة ≥ الحد",
  "Lines at/over the warning threshold (budgeting.controls.warn_threshold_percent — 100 by default) highlight with the OVER flag when the used percent ≥ the threshold",
);

export const budgetingVarianceAnalysisContract = defineReport({
  id: "budgeting.variance-analysis",
  version: 1,
  title: bilingual("تحليل الانحرافات", "Variance Analysis"),
  category: "financial",
  description: bilingual(
    "اتجاه انحراف الموازنة عبر الفترات مع أعلى أسطر التجاوز/التوفير وتبريز حد التحذير — يحمل فحص budget-ledger-tie الذي يمنع التصدير عند الفشل",
    "The budget variance trend across periods with the top over/under-budget lines and threshold highlighting — carrying the budget-ledger-tie check that blocks exports on failure",
  ),
  parameters: z.object({
    asOf: ISO_DATE,
    budgetId: z.string().uuid().optional(),
    fiscalYearId: z.string().uuid().optional(),
    scope: z.enum(["ACCOUNTS", "COST_CENTERS", "PROJECTS", "BRANCHES"]).optional(),
    thresholdPercent: z.number().int().min(1).max(1000).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "budgeting.reports.view",
  dataSources: [
    source(
      "budgeting",
      "budgetingQueries.varianceAnalysis (the period trend + the top over/under folds)",
      ["budgets", "budget_lines"],
      "نسخ الموازنة وسطور الشبكة — خط الأساس والاتجاه (BR-050)",
      "The budget versions + the grid lines — the baseline and the trend (BR-050)",
    ),
    source(
      "accounting",
      "journal (the GL movements + the trial-balance tie side)",
      ["journal_entries", "journal_lines", "fiscal_periods", "accounts"],
      "حركات دفتر الأستاذ المجمّعة زمنياً + جانب المطابقة",
      "The period-grouped GL movements + the tie side",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "budget", kind: "sum" },
      { id: "actual", kind: "sum" },
      { id: "variance", kind: "derived" },
    ],
    sorting: [{ by: "periodName", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "as-of",
    cacheTtlSeconds: 3600,
    invalidationEvents: ["journal.posted", "journal.reversed", "period.locked", "budget.activated"],
  },
  assertions: [BUDGET_LEDGER_TIE],
  run: async (_ctx, params) => {
    const { budgeting } = reportingServices();
    const analysis = await budgeting.varianceAnalysis({
      budgetId: params.budgetId ?? null,
      fiscalYearId: params.fiscalYearId ?? null,
      scope:
        params.scope === "ACCOUNTS" ||
        params.scope === "COST_CENTERS" ||
        params.scope === "PROJECTS" ||
        params.scope === "BRANCHES"
          ? params.scope
          : null,
      asOf: params.asOf!,
      thresholdPercent: params.thresholdPercent,
    });
    const locale = params.locale === "en" ? "en" : "ar";
    const ties = await budgeting.ledgerTieOf({ budgetId: analysis.budget.id });
    const threshold = params.thresholdPercent ?? 100;

    const usedPercent = (budget: string, actual: string): number => {
      if (budget === "0" || budget === "0.0000" || budget === "0.00") {
        return 0;
      }
      const [bInt, bFrac = ""] = budget.split(".");
      const [aInt, aFrac = ""] = actual.split(".");
      const B = BigInt(bInt + bFrac.padEnd(4, "0"));
      const A = BigInt(aInt + aFrac.padEnd(4, "0"));
      return Number((A * 100n) / B);
    };

    const broken = ties.rows.filter(
      (row) => row.groupedDebit !== row.glDebit || row.groupedCredit !== row.glCredit,
    );
    const tieOk = ties.ok && broken.length === 0;

    let budgetTotal = "0";
    let actualTotal = "0";
    for (const period of analysis.periodTotals) {
      budgetTotal = fold(budgetTotal, period.budget);
      actualTotal = fold(actualTotal, period.actual);
    }

    const trendRows = analysis.periodTotals.map((period) => {
      const percent = usedPercent(period.budget, period.actual);
      const overThreshold = percent >= threshold;
      return {
        key: `trend:${period.fiscalPeriodId}`,
        groupKey: "trend",
        values: {
          period: locale === "ar" ? period.periodNameAr ?? period.periodName : period.periodName,
          budget: period.budget,
          actual: period.actual,
          variance: period.variance,
          trendFlag: period.variance.startsWith("-")
            ? locale === "ar"
              ? "تحت الموازنة"
              : "UNDER"
            : locale === "ar"
              ? "فوق الموازنة"
              : "OVER",
          highlight: overThreshold ? (locale === "ar" ? "عند/فوق الحد" : "AT/OVER") : "",
        },
      };
    });
    const lineRow = (prefix: string, row: (typeof analysis.topOver)[number]) => ({
      key: `${prefix}:${row.key}`,
      groupKey: prefix,
      values: {
        period:
          locale === "ar"
            ? row.periodNameAr ?? row.periodName
            : row.periodName,
        budget: row.budget,
        actual: row.actual,
        variance: row.variance,
        trendFlag:
          prefix === "over"
            ? locale === "ar"
              ? "فوق الموازنة"
              : "OVER"
            : locale === "ar"
              ? "تحت الموازنة"
              : "UNDER",
        highlight: (row.variancePct ?? "0").replace("-", "").trim(),
      },
    });
    return {
      columns: [
        col("period", "الفترة / السطر", "Period / line"),
        moneyCol("budget", "الموازنة", "Budget"),
        moneyCol("actual", "الفعلي", "Actual"),
        moneyCol("variance", "الانحراف", "Variance"),
        col("trendFlag", "الاتجاه", "Trend", "status"),
        col("highlight", "التبريز", "Highlight", "status"),
      ],
      groups: [
        {
          key: "trend",
          label: bilingual("اتجاه الفترات", "Period trend"),
        },
        {
          key: "over",
          label: bilingual("أعلى أسطر التجاوز (10)", "Top over-budget lines (10)"),
        },
        {
          key: "under",
          label: bilingual("أعلى أسطر التوفير (10)", "Top under-budget lines (10)"),
        },
      ],
      rows: [
        ...trendRows,
        ...analysis.topOver.map((row) => lineRow("over", row)),
        ...analysis.topUnder.map((row) => lineRow("under", row)),
      ],
      totals: [
        {
          id: "budgetTotal",
          kind: "sum",
          label: bilingual("إجمالي الموازنة", "Budget total"),
          amount: budgetTotal,
        },
        {
          id: "actualTotal",
          kind: "sum",
          label: bilingual("إجمالي الفعلي", "Actual total"),
          amount: actualTotal,
        },
        {
          id: "topOverCount",
          kind: "sum",
          label: bilingual("عدد أسطر التجاوز (أعلى 10)", "Over-budget lines (top 10)"),
          amount: String(analysis.topOver.length),
        },
        {
          id: "topUnderCount",
          kind: "sum",
          label: bilingual("عدد أسطر التوفير (أعلى 10)", "Under-budget lines (top 10)"),
          amount: String(analysis.topUnder.length),
        },
      ],
      assertionResults: [
        {
          id: "budget-ledger-tie",
          status: tieOk ? "PASS" : "FAIL",
          compared: { left: String(broken.length), right: "0" },
          detail: tieOk
            ? undefined
            : {
                ar: `${broken.length} زوج (فترة/حساب) غير مطابق — التصدير محجوب حتى المطابقة`,
                en: `${broken.length} broken (period/account) pair(s) — export blocked until the tie passes`,
              },
        },
      ],
      notes: [
        THRESHOLD_NOTE,
        bilingual(
          "أعلى أسطر التجاوز/التوفير (حسب |الانحراف|) تُرفق في البيانات الخام للتقرير للعرض التفصيلي",
          "The top over/under lines (by |variance|) ride the raw report data for the detail view",
        ),
        bilingual(
          "الموازنات ليست مستندات دفتر أستاذ (DR-004): هذا التقرير يقرأ دفتر الأستاذ فقط ولا يكتبه أبداً",
          "Budgets are not ledger documents (DR-004): this report READS the GL and never writes it",
        ),
      ],
    };
  },
});

function fold(a: string, b: string): string {
  const negA = a.startsWith("-");
  const negB = b.startsWith("-");
  const [aInt, aFrac = ""] = (negA ? a.slice(1) : a).split(".");
  const [bInt, bFrac = ""] = (negB ? b.slice(1) : b).split(".");
  const A = BigInt(aInt + aFrac.padEnd(4, "0")) * (negA ? -1n : 1n);
  const B = BigInt(bInt + bFrac.padEnd(4, "0")) * (negB ? -1n : 1n);
  const S = A + B;
  const neg = S < 0n;
  const digits = (neg ? -S : S).toString().padStart(5, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}
