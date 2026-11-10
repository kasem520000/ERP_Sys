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
import type { RegisterTieSides } from "./payroll-queries";

/**
 * PHASE-029 wave C · `payroll.register` (REPORT_CATALOG §payroll row 1):
 * the per-employee gross/deductions/net register of ONE run with the
 * employer-contribution + EOS-accrual columns and the run's payout state.
 *
 * Employee rows surface ONLY code + display names (the PII law —
 * national_id/bank fields never enter any report row; the
 * employee-detail drill requires the restricted payroll.employees.view
 * permission and lands on the module screen, not this report).
 *
 * The footer carries the `payroll-register-tie` block-on-fail assertion:
 * Σ per-employee lines == the run row totals (INV-025) AND the run's
 * journal exists un-reversed with total debit == gross + employer + eos
 * (the G-29 shape's cost side — an INDEPENDENT code path through the
 * journal store). Tolerance 0; a broken tie blocks the export.
 *
 * Permission `payroll.reports.view` (matrix §3.14; REPORT_CATALOG §12
 * reuse rule).
 */

const REGISTER_TIE = assertDecl(
  "payroll-register-tie",
  "Σ per-employee lines (gross/deductions/net) == the run totals (INV-025) and the run's journal total debit == gross + employer + eos (the G-29 cost side, un-reversed)",
  "مجاميع سطور الموظفين لا تطابق مجاميع المسير (INV-025) أو جانب التكلفة في قيد G-29 — التصدير محجوب حتى المطابقة",
  "The per-employee line sums do not tie to the run totals (INV-025) or the G-29 journal's cost side — export blocked until the tie passes",
  "INV-025",
);

const PII_NOTE = bilingual(
  "صفوف الموظفين تحمل الرمز والاسم فقط — لا هوية وطنية ولا حقول بنكية في أي تقرير (فئة C-PII)",
  "Employee rows carry code + display names only — never national ids or bank fields in any report row (the C-PII class)",
);

function tieResult(ties: RegisterTieSides): AssertionResult {
  const inv025 =
    compareExactLocal(ties.lineSums.gross, ties.runTotals.gross) === 0 &&
    compareExactLocal(ties.lineSums.deductions, ties.runTotals.deductions) === 0 &&
    compareExactLocal(ties.lineSums.net, ties.runTotals.net) === 0;
  const costSide = addExactLocal(
    addExactLocal(ties.runTotals.gross, ties.runTotals.employer),
    ties.runTotals.eos,
  );
  const journalOk =
    ties.journalDebitTotal !== null &&
    compareExactLocal(ties.journalDebitTotal, costSide) === 0 &&
    !ties.journalReversed;
  const ok = inv025 && journalOk;
  return {
    id: "payroll-register-tie",
    status: ok ? "PASS" : "FAIL",
    compared: {
      left: ties.lineSums.net,
      right: ties.runTotals.net,
    },
    detail: ok
      ? undefined
      : {
          ar: `${inv025 ? "" : "Σ السطور ≠ مجاميع المسير (INV-025)؛ "}${journalOk ? "" : "قيد G-29 غير مطابق أو معكوس"} — التصدير محجوب`,
          en: `${inv025 ? "" : "Σ lines ≠ run totals (INV-025); "}${journalOk ? "" : "the G-29 journal does not tie or is reversed"} — export blocked`,
        },
  };
}

export const payrollRegisterContract = defineReport({
  id: "payroll.register",
  version: 1,
  title: bilingual("سجل الرواتب", "Payroll Register"),
  category: "financial",
  description: bilingual(
    "سجل مسير الرواتب لكل موظف: الإجمالي والاستقطاعات والصافي مع مساهمات صاحب العمل ومخصص نهاية الخدمة وحالة الصرف — يحمل فحص payroll-register-tie الذي يمنع التصدير عند الفشل",
    "The per-employee payroll register of one run: gross, deductions and net with employer contributions, the EOS accrual and the payout state — carrying the payroll-register-tie check that blocks exports on failure",
  ),
  parameters: z.object({
    runId: z.string().uuid(),
    asOf: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "payroll.reports.view",
  dataSources: [
    source(
      "payroll",
      "payrollQueries.register (the frozen per-employee run lines + the run totals)",
      ["payroll_runs", "payroll_run_lines", "employees"],
      "سطور المسير المجمّدة لكل موظف + مجاميع المسير (INV-025)",
      "The frozen per-employee run lines + the run totals (INV-025)",
    ),
    source(
      "accounting",
      "journal (the G-29 entry + its lines — the tie side)",
      ["journal_entries", "journal_lines"],
      "قيد المسير وسطوره — جانب المطابقة",
      "The run's journal entry + its lines — the tie side",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "gross", kind: "sum" },
      { id: "deductions", kind: "sum" },
      { id: "net", kind: "sum" },
    ],
    sorting: [{ by: "employeeCode", dir: "asc" }],
    zeroSuppression: "none",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "as-of",
    cacheTtlSeconds: 3600,
    invalidationEvents: ["journal.posted", "journal.reversed", "payroll.run_posted"],
  },
  assertions: [REGISTER_TIE],
  drillTargets: [
    drill(
      "runId",
      "/payroll/{runId}",
      "مساحة عمل المسير",
      "The run workspace",
      "payroll.runs.view",
    ),
  ],
  run: async (_ctx, params) => {
    const { payroll } = reportingServices();
    const result = await payroll.register({ runId: params.runId! });
    const locale = params.locale === "en" ? "en" : "ar";

    let grossTotal = "0";
    let deductionsTotal = "0";
    let netTotal = "0";
    for (const row of result.rows) {
      grossTotal = addExactLocal(grossTotal, row.gross);
      deductionsTotal = addExactLocal(deductionsTotal, row.deductions);
      netTotal = addExactLocal(netTotal, row.net);
    }

    return {
      columns: [
        col("employee", "الموظف", "Employee"),
        col("runNo", "رقم المسير", "Run no"),
        col("period", "الفترة", "Period"),
        moneyCol("gross", "الإجمالي", "Gross"),
        moneyCol("deductions", "الاستقطاعات", "Deductions"),
        moneyCol("net", "الصافي", "Net"),
        moneyCol("employer", "مساهمات صاحب العمل", "Employer"),
        moneyCol("eos", "مخصص نهاية الخدمة", "EOS accrual"),
      ],
      groups: [],
      rows: result.rows.map((row) => ({
        key: row.employeeId,
        values: {
          employee:
            locale === "ar"
              ? `${row.employeeCode} — ${row.employeeNameAr ?? row.employeeName}`
              : `${row.employeeCode} — ${row.employeeName}`,
          runNo: result.run.runNo ?? "—",
          period: result.run.periodName,
          gross: row.gross,
          deductions: row.deductions,
          net: row.net,
          employer: row.employerContributions,
          eos: row.eosAccrual,
        },
      })),
      totals: [
        {
          id: "grossTotal",
          kind: "sum",
          label: bilingual("إجمالي الإجماليات", "Gross total"),
          amount: grossTotal,
        },
        {
          id: "deductionsTotal",
          kind: "sum",
          label: bilingual("إجمالي الاستقطاعات", "Deductions total"),
          amount: deductionsTotal,
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
        PII_NOTE,
        bilingual(
          `المدفوع ${result.run.paid} من صافي ${result.run.net} (${result.run.status === "POSTED" ? "مرحّل" : result.run.status})`,
          `Paid ${result.run.paid} of net ${result.run.net} (${result.run.status === "POSTED" ? "posted" : result.run.status})`,
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

function compareExactLocal(a: string, b: string): number {
  const toMinor = (value: string): bigint => {
    const neg = value.startsWith("-");
    const [int = "0", frac = ""] = value.replace("-", "").split(".");
    const minor = BigInt(int) * 10_000n + BigInt(frac.slice(0, 4).padEnd(4, "0"));
    return neg ? -minor : minor;
  };
  const A = toMinor(a);
  const B = toMinor(b);
  return A === B ? 0 : A > B ? 1 : -1;
}
