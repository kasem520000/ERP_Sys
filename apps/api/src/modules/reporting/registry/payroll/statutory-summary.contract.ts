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
 * PHASE-046 (W-6, T-13 — D-12) · `payroll.statutory-summary` (REPORT_CATALOG
 * §payroll, registry 104 → 106): the per (period × profile row) statutory
 * fold over POSTED runs in a date window — the contributory base totals,
 * the employee/employer shares, the capped count, and the frozen
 * `statutory_summary` remittance liability (accrued vs remitted) — the
 * remittance-ready report companion (the GOSI remittance export's audit
 * view; the export file itself stays the run-level IN-06 artifact).
 *
 * The footer carries the `statutory-totals-tie` block-on-fail assertion:
 * per period, Σ run statutory LINES (the line columns) == the run TOTALS ==
 * an INDEPENDENT SQL fold (the jsonb breakdown re-fold — a different code
 * path over the frozen per-row evidence), and the summary's accrued ==
 * Σ employee + Σ employer + Σ PIT. Tolerance 0; whole tenant; any drift
 * between the three representations blocks the export (INV-032(b) — never
 * a silently wrong number).
 *
 * Permission `payroll.reports.view` (the §12 module-register convention —
 * no new key for reads). Employee detail is NOT this report's surface
 * (per profile row aggregates — the per-employee view is the remittance
 * export, PII-scoped to code + name).
 */

const STATUTORY_TOTALS_TIE = assertDecl(
  "statutory-totals-tie",
  "per period: Σ run statutory lines == the run statutory totals == the independent jsonb breakdown re-fold; the summary accrued == Σ employee + Σ employer + Σ PIT (tolerance 0, whole tenant)",
  "مجاميع الاستقطاعات القانونية لا تتطابق بين السطور والمسير والطيّ المستقل — الفترة غير المطابقة تمنع التصدير",
  "The statutory totals do not tie across the lines, the run totals and the independent fold — the broken period blocks export",
  "INV-032",
);

function tieResult(ties: {
  periods: {
    periodName: string;
    lineEmployee: string;
    runEmployee: string;
    foldEmployee: string;
    lineEmployer: string;
    runEmployer: string;
    foldEmployer: string;
    linePit: string;
    runPit: string;
    summaryAccrued: string;
    summaryRemitted: string;
  }[];
  ok: boolean;
}): AssertionResult {
  const broken = ties.periods.filter(
    (period) =>
      period.lineEmployee !== period.runEmployee ||
      period.lineEmployee !== period.foldEmployee ||
      period.lineEmployer !== period.runEmployer ||
      period.lineEmployer !== period.foldEmployer ||
      period.linePit !== period.runPit ||
      period.summaryAccrued !==
        sumThree(period.lineEmployee, period.lineEmployer, period.linePit),
  );
  const ok = ties.ok && broken.length === 0;
  const sample = broken.slice(0, 5).map((period) => period.periodName).join(", ");
  return {
    id: "statutory-totals-tie",
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

function sumThree(a: string, b: string, c: string): string {
  return addExactLocal(addExactLocal(a, b), c);
}

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

const REMITTANCE_NOTE = bilingual(
  "الملخص القانوني عرض تدقيقي للتقديم: الالتزام المجمد (المستحق مقابل المحوَّل) من لقطة المسير المُرحَّلة — الملف الرسمي للتقديم هو تصدير التحويل على مستوى المسير (IN-06)",
  "The statutory summary is the audit view of the remittance: the frozen liability (accrued vs remitted) from the posted run's snapshot — the official filing artifact is the run-level remittance export (IN-06)",
);

export const payrollStatutorySummaryContract = defineReport({
  id: "payroll.statutory-summary",
  version: 1,
  title: bilingual("ملخص الاستقطاعات القانونية", "Statutory Contributions Summary"),
  category: "financial",
  description: bilingual(
    "الاستقطاعات القانونية لكل (فترة × بند ملف) على نافذة تاريخ: القاعدة والحوافز وحصص الموظف/صاحب العمل والالتزام المجمد (المستحق مقابل المحوَّل) — يحمل فحص statutory-totals-tie ثلاثي الجوانب الذي يمنع التصدير عند الفشل",
    "The statutory contributions per (period × profile row) over a date window: the base, the employee/employer shares and the frozen remittance liability (accrued vs remitted) — carrying the three-way statutory-totals-tie check that blocks exports on failure",
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
      "payrollQueries.statutorySummary (the per-profile-row statutory folds + the summary liability)",
      ["payroll_runs", "payroll_run_lines", "fiscal_periods"],
      "الطيّ القانوني لكل بند ملف + التزام التحويل",
      "The per-profile-row statutory folds + the remittance liability",
    ),
    source(
      "payroll",
      "payrollQueries.statutorySummary ties (the line columns, the run totals and the jsonb breakdown re-fold)",
      ["payroll_runs", "payroll_run_lines"],
      "مطابقة الأعمدة والمجاميع والطيّ المستقل",
      "The line/run/breakdown tie folds",
    ),
  ],
  scopeRules: { dateRange: "required", asOf: "optional", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "base", kind: "sum" },
      { id: "employeeShare", kind: "sum" },
      { id: "employerShare", kind: "sum" },
      { id: "accrued", kind: "sum" },
      { id: "remitted", kind: "sum" },
    ],
    sorting: [{ by: "periodName", dir: "asc" }, { by: "code", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 600,
    invalidationEvents: ["journal.posted", "journal.reversed", "payroll.run_posted"],
  },
  assertions: [STATUTORY_TOTALS_TIE],
  drillTargets: [],
  run: async (_ctx, params) => {
    const { payroll } = reportingServices();
    const result = await payroll.statutorySummary({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    const locale = params.locale === "en" ? "en" : "ar";

    let baseTotal = "0";
    let employeeTotal = "0";
    let employerTotal = "0";
    let accruedTotal = "0";
    let remittedTotal = "0";
    for (const row of result.rows) {
      baseTotal = addExactLocal(baseTotal, row.baseTotal);
      employeeTotal = addExactLocal(employeeTotal, row.employeeShare);
      employerTotal = addExactLocal(employerTotal, row.employerShare);
      accruedTotal = addExactLocal(accruedTotal, row.accrued);
      remittedTotal = addExactLocal(remittedTotal, row.remitted);
    }

    return {
      columns: [
        col("period", "الفترة", "Period"),
        col("code", "البند", "Profile row"),
        col("kind", "النوع", "Kind"),
        moneyCol("base", "القاعدة", "Wage base"),
        moneyCol("employeeShare", "حصة الموظف", "Employee share"),
        moneyCol("employerShare", "حصة صاحب العمل", "Employer share"),
        col("cappedCount", "عدد المكبوح", "Capped lines"),
        moneyCol("accrued", "المستحق", "Accrued liability"),
        moneyCol("remitted", "المحوَّل", "Remitted"),
        moneyCol("outstanding", "القائم", "Outstanding"),
      ],
      groups: [],
      rows: result.rows.map((row) => ({
        key: row.key,
        values: {
          period: row.periodName,
          code: row.code,
          kind: row.kind === "PIT" ? (locale === "ar" ? "ضريبة" : "PIT") : locale === "ar" ? "اشتراك" : "GOSI",
          base: row.baseTotal,
          employeeShare: row.employeeShare,
          employerShare: row.employerShare,
          cappedCount: String(row.cappedCount),
          accrued: row.accrued,
          remitted: row.remitted,
          outstanding: addExactLocal(row.accrued, `-${row.remitted}`),
        },
      })),
      totals: [
        {
          id: "baseTotal",
          kind: "sum",
          label: bilingual("إجمالي القواعد", "Wage-base total"),
          amount: baseTotal,
        },
        {
          id: "employeeTotal",
          kind: "sum",
          label: bilingual("إجمالي حصة الموظف", "Employee-share total"),
          amount: employeeTotal,
        },
        {
          id: "employerTotal",
          kind: "sum",
          label: bilingual("إجمالي حصة صاحب العمل", "Employer-share total"),
          amount: employerTotal,
        },
        {
          id: "accruedTotal",
          kind: "sum",
          label: bilingual("إجمالي المستحق", "Accrued total"),
          amount: accruedTotal,
        },
        {
          id: "remittedTotal",
          kind: "sum",
          label: bilingual("إجمالي المحوَّل", "Remitted total"),
          amount: remittedTotal,
        },
      ],
      assertionResults: [tieResult(result.ties)],
      notes: [REMITTANCE_NOTE],
    };
  },
});
