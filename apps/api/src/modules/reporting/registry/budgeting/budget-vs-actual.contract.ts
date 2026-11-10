import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import {
  ISO_DATE,
  LOCALE,
  assertDecl,
  bilingual,
  col,
  defineReport,
  moneyCol,
  source,
  drill,
} from "../kit";
import { reportingServices } from "../services";
import type { LedgerTieSides } from "./budgeting-queries";

/**
 * PHASE-028 wave C · `budgeting.budget-vs-actual` (REPORT_CATALOG §9 row
 * 236 — the report key the catalog pins verbatim): the ACTIVE (or
 * explicitly picked) budget version vs the GL actuals per (dimension key
 * × fiscal period) — budget, actual, variance, variance% (4dp; null when
 * budget = 0 — never a fabricated ∞), with per-period totals and the
 * standard journal drill-down chain (INV-006).
 *
 * AS-OF RULE: actuals are the natural-direction GL movements with
 * entry_date ≤ asOf (deterministic — same (budget, asOf) ⇒ byte-identical
 * output). The natural-direction convention: debit−credit for
 * ASSET/EXPENSE accounts, credit−debit for LIABILITY/EQUITY/REVENUE.
 *
 * The footer carries the `budget-ledger-tie` block-on-fail assertion: per
 * (period, account), the dimension-grouped actuals fold must equal the
 * accounting module's own trial-balance movements for the same window
 * (an INDEPENDENT code path — aggregation drift in the dimension grouping
 * or the BRANCHES source-document attribution surfaces as a blocked
 * export, never a silently wrong number). Tolerance 0; whole tenant —
 * display filters never narrow the ledger check.
 *
 * Permission `budgeting.reports.view` (matrix §3.13 row 5 — the module's
 * report read key; REPORT_CATALOG §12 reuse rule). Budgets are NOT ledger
 * documents: this contract READS the GL, it never writes it (DR-004).
 */

const BUDGET_LEDGER_TIE = assertDecl(
  "budget-ledger-tie",
  "per (period, account): Σ dimension-grouped actuals (debit + credit) == the trial-balance movements for the same window (tolerance 0, whole tenant)",
  "مجاميع الاستهلاك المجمّعة حسب البُعد لا تطابق حركات ميزان المراجعة لنفس النافذة — الفترة/الحساب غير المطابق يمنع التصدير",
  "The dimension-grouped actuals do not fold back to the trial-balance movements for the same window — the broken period/account blocks export",
  "INV-022",
);

const ASOF_RULE_NOTE = bilingual(
  "الفعلي = حركات دفتر الأستاذ بالاتجاه الطبيعي حتى التاريخ (قيد بتاريخ ≤ التاريخ): مدين−دائن للأصول والمصروفات، دائن−مدين للالتزامات وحقوق الملكية والإيرادات — النتيجة حتمية لنفس (الموازنة، التاريخ)",
  "Actuals are the natural-direction GL movements as-of (entries dated ≤ asOf): debit−credit for ASSET/EXPENSE accounts, credit−debit for LIABILITY/EQUITY/REVENUE — deterministic for the same (budget, asOf)",
);

const VARIANCE_NOTE = bilingual(
  "الانحراف = الفعلي − الموازنة (دقيق بمنزلتين مع O(4))؛ نسبة الانحراف = (الفعلي − الموازنة) ÷ الموازنة × 100 (‎-25.00% مثلاً) — تساوي null عندما تكون الموازنة صفراً (لا قيمة لانهية ملفقة)",
  "Variance = actual − budget (exact 4dp); variance % = (actual − budget) / budget × 100 (e.g. −25.00%) — null when the budget is zero (never a fabricated infinity)",
);

function tieResult(ties: LedgerTieSides): AssertionResult {
  const broken = ties.rows.filter(
    (row) => row.groupedDebit !== row.glDebit || row.groupedCredit !== row.glCredit,
  );
  const ok = ties.ok && broken.length === 0;
  const sample = broken.slice(0, 5).map((row) => row.fiscalPeriodId.slice(0, 8)).join(", ");
  return {
    id: "budget-ledger-tie",
    status: ok ? "PASS" : "FAIL",
    compared: {
      left: String(broken.length),
      right: "0",
    },
    detail: ok
      ? undefined
      : {
          ar: `${broken.length} زوج (فترة/حساب) غير مطابق${sample ? ` — أمثلة: ${sample}` : ""} — التصدير محجوب حتى المطابقة`,
          en: `${broken.length} broken (period/account) pair(s)${sample ? ` — samples: ${sample}` : ""} — export blocked until the tie passes`,
        },
  };
}

export const budgetingBudgetVsActualContract = defineReport({
  id: "budgeting.budget-vs-actual",
  version: 1,
  title: bilingual("الموازنة مقابل الفعلي", "Budget vs Actual"),
  category: "financial",
  description: bilingual(
    "الموازنة النشطة مقابل دفتر الأستاذ حتى تاريخ: لكل (مفتاح البُعد × الفترة المالية) — الموازنة والفعلي والانحراف ونسبة الانحراف مع إجماليات الفترات وسلسلة التنقل إلى القيود — يحمل فحص budget-ledger-tie الذي يمنع التصدير عند الفشل",
    "The ACTIVE budget vs the GL as of a date: per (dimension key × fiscal period) — budget, actual, variance and variance % with period totals and the journal drill-down chain — carrying the budget-ledger-tie check that blocks exports on failure",
  ),
  parameters: z.object({
    asOf: ISO_DATE,
    budgetId: z.string().uuid().optional(),
    fiscalYearId: z.string().uuid().optional(),
    scope: z.enum(["ACCOUNTS", "COST_CENTERS", "PROJECTS", "BRANCHES"]).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "budgeting.reports.view",
  dataSources: [
    source(
      "budgeting",
      "budgetingQueries.budgetVsActual (the ACTIVE version baseline + the dimension-grouped GL actuals)",
      ["budgets", "budget_lines"],
      "نسخ الموازنة وسطور الشبكة الزمنية — خط الأساس القابل للمقارنة (BR-050)",
      "The budget versions + the period grid lines — the comparable baseline (BR-050)",
    ),
    source(
      "accounting",
      "journal (the GL movements + the trial-balance tie side)",
      ["journal_entries", "journal_lines", "fiscal_periods", "accounts"],
      "حركات دفتر الأستاذ المجمّعة زمنياً + جانب المطابقة من ميزان المراجعة",
      "The period-grouped GL movements + the trial-balance tie side",
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
  drillTargets: [
    drill(
      "accountId",
      "/accounting/general-ledger?account={accountId}&from={periodStart}&to={periodEnd}",
      "سجل القيود للحساب",
      "The account's journal register",
      "accounting.gl.view",
    ),
  ],
  run: async (_ctx, params) => {
    const { budgeting } = reportingServices();
    const result = await budgeting.budgetVsActual({
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
    });
    const locale = params.locale === "en" ? "en" : "ar";
    const ties = await budgeting.ledgerTieOf({
      budgetId: result.budget.id,
    });

    let budgetTotal = "0";
    let actualTotal = "0";
    let varianceTotal = "0";
    for (const row of result.rows) {
      budgetTotal = addExactLocal(budgetTotal, row.budget);
      actualTotal = addExactLocal(actualTotal, row.actual);
      varianceTotal = addExactLocal(varianceTotal, row.variance);
    }

    return {
      columns: [
        col("account", "الحساب", "Account"),
        col("period", "الفترة", "Period"),
        col("budgetCode", "رقم الموازنة", "Budget code"),
        moneyCol("budget", "الموازنة", "Budget"),
        moneyCol("actual", "الفعلي", "Actual"),
        moneyCol("variance", "الانحراف", "Variance"),
        col("variancePct", "نسبة الانحراف", "Variance %", "text", true),
      ],
      groups: [],
      rows: result.rows.map((row) => ({
        key: row.key,
        values: {
          account:
            locale === "ar"
              ? `${row.accountCode} — ${row.accountNameAr ?? row.accountName}`
              : `${row.accountCode} — ${row.accountName}`,
          period: locale === "ar" ? row.periodNameAr ?? row.periodName : row.periodName,
          budgetCode: result.budget.code,
          budget: row.budget,
          actual: row.actual,
          variance: row.variance,
          variancePct: row.variancePct ?? "—",
        },
      })),
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
          id: "varianceTotal",
          kind: "sum",
          label: bilingual("إجمالي الانحراف", "Variance total"),
          amount: varianceTotal,
        },
      ],
      assertionResults: [tieResult(ties)],
      notes: [
        ASOF_RULE_NOTE,
        VARIANCE_NOTE,
        bilingual(
          "الموازنات ليست مستندات دفتر أستاذ (DR-004): هذا التقرير يقرأ دفتر الأستاذ فقط ولا يكتبه أبداً",
          "Budgets are not ledger documents (DR-004): this report READS the GL and never writes it",
        ),
      ],
    };
  },
});

function addExactLocal(a: string, b: string): string {
  // Exact 4dp addition over plain decimal strings (module-local — the
  // accounting helper is imported by the queries layer; contracts fold
  // display totals only).
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
