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
} from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-029 wave C · `payroll.cost-summary` (REPORT_CATALOG §payroll row
 * 2): the payroll cost by (cost center × project × period) — gross,
 * employer contributions, EOS accrual, the folded cost, and net — over a
 * date window of POSTED runs.
 *
 * The footer carries the `payroll-cost-ledger-tie` block-on-fail
 * assertion: per period, Σ run-line cost (gross + employer + eos) ==
 * the journal's payroll_run-sourced entry DEBIT total for that period
 * (an INDEPENDENT code path through the journal store — dimension-fold
 * drift surfaces as a blocked export, never a silently wrong number).
 * Tolerance 0; whole tenant.
 *
 * Permission `payroll.reports.view`. Employee detail is NOT this report's
 * surface (aggregates by dimension — the PII law keeps it that way).
 */

const COST_LEDGER_TIE = assertDecl(
  "payroll-cost-ledger-tie",
  "per period: Σ run-line cost (gross + employer + eos) == the journal's payroll_run-sourced entry debit total (tolerance 0, whole tenant)",
  "تكلفة المسير المجمّعة لا تطابق جانب المدين لقيود مسيرات الرواتب لنفس الفترة — الفترة غير المطابقة تمنع التصدير",
  "The folded run-line cost does not tie to the payroll-run journal debit side for the same period — the broken period blocks export",
  "INV-025",
);

function tieResult(ties: {
  rows: { periodName: string; runCost: string; glDebit: string }[];
  ok: boolean;
}): AssertionResult {
  const broken = ties.rows.filter((row) => row.runCost !== row.glDebit);
  const ok = ties.ok && broken.length === 0;
  const sample = broken.slice(0, 5).map((row) => row.periodName).join(", ");
  return {
    id: "payroll-cost-ledger-tie",
    status: ok ? "PASS" : "FAIL",
    compared: { left: String(broken.length), right: "0" },
    detail: ok
      ? undefined
      : {
          ar: `${broken.length} فترة غير مطابقة${sample ? ` — أمثلة: ${sample}` : ""} — التصدير محجوب حتى المطابقة`,
          en: `${broken.length} broken period(s)${sample ? ` — samples: ${sample}` : ""} — export blocked until the tie passes`,
        },
  };
}

export const payrollCostSummaryContract = defineReport({
  id: "payroll.cost-summary",
  version: 1,
  title: bilingual("ملخص تكلفة الرواتب", "Payroll Cost Summary"),
  category: "financial",
  description: bilingual(
    "تكلفة الرواتب حسب (مركز التكلفة × المشروع × الفترة) على نافذة تاريخ: الإجمالي ومساهمات صاحب العمل والمخصص والتكلفة المطوية والصافي — يحمل فحص payroll-cost-ledger-tie الذي يمنع التصدير عند الفشل",
    "The payroll cost by (cost center × project × period) over a date window: gross, employer contributions, the EOS accrual, the folded cost and net — carrying the payroll-cost-ledger-tie check that blocks exports on failure",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "payroll.reports.view",
  dataSources: [
    source(
      "payroll",
      "payrollQueries.costSummary (the dimension-folded run-line cost)",
      ["payroll_runs", "payroll_run_lines", "cost_centers", "projects", "fiscal_periods"],
      "سطور المسير المجمّعة حسب البُعد — تكلفة الرواتب",
      "The dimension-folded run lines — the payroll cost",
    ),
    source(
      "accounting",
      "journal (the payroll_run-sourced entries — the tie side)",
      ["journal_entries", "journal_lines"],
      "قيود مسيرات الرواتب — جانب المطابقة",
      "The payroll-run journal entries — the tie side",
    ),
  ],
  scopeRules: { dateRange: "required", asOf: "optional", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "gross", kind: "sum" },
      { id: "employer", kind: "sum" },
      { id: "eos", kind: "sum" },
      { id: "cost", kind: "derived" },
      { id: "net", kind: "sum" },
    ],
    sorting: [{ by: "periodName", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 3600,
    invalidationEvents: ["journal.posted", "journal.reversed", "payroll.run_posted"],
  },
  assertions: [COST_LEDGER_TIE],
  drillTargets: [],
  run: async (_ctx, params) => {
    const { payroll } = reportingServices();
    const result = await payroll.costSummary({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    const locale = params.locale === "en" ? "en" : "ar";

    let costTotal = "0";
    let netTotal = "0";
    for (const row of result.rows) {
      costTotal = addExactLocal(costTotal, row.cost);
      netTotal = addExactLocal(netTotal, row.net);
    }

    return {
      columns: [
        col("period", "الفترة", "Period"),
        col("costCenter", "مركز التكلفة", "Cost center"),
        col("project", "المشروع", "Project"),
        moneyCol("gross", "الإجمالي", "Gross"),
        moneyCol("employer", "مساهمات صاحب العمل", "Employer"),
        moneyCol("eos", "المخصص", "EOS accrual"),
        moneyCol("cost", "التكلفة", "Cost"),
        moneyCol("net", "الصافي", "Net"),
      ],
      groups: [],
      rows: result.rows.map((row) => ({
        key: row.key,
        values: {
          period: row.periodName,
          costCenter: row.costCenterCode ?? (locale === "ar" ? "غير مخصص" : "Unassigned"),
          project: row.projectCode ?? (locale === "ar" ? "غير مخصص" : "Unassigned"),
          gross: row.gross,
          employer: row.employer,
          eos: row.eos,
          cost: row.cost,
          net: row.net,
        },
      })),
      totals: [
        {
          id: "costTotal",
          kind: "sum",
          label: bilingual("إجمالي التكلفة", "Cost total"),
          amount: costTotal,
        },
        {
          id: "netTotal",
          kind: "sum",
          label: bilingual("إجمالي الصافي", "Net total"),
          amount: netTotal,
        },
      ],
      assertionResults: [tieResult(result.ties)],
      notes: [
        bilingual(
          "التكلفة = الإجمالي + مساهمات صاحب العمل + مخصص نهاية الخدمة (جانب المدين لقيد G-29)",
          "Cost = gross + employer contributions + the EOS accrual (the G-29 debit side)",
        ),
      ],
    };
  },
});

function addExactLocal(a: string, b: string): string {
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
