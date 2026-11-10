import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import {
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

/**
 * PHASE-029 wave C · `payroll.eos-provision` (REPORT_CATALOG §payroll row
 * 3): the end-of-service provision movements per employee — accruals
 * (POSTED-run lines), the cash settlement stamp, the released residual
 * and the balance — with the BR-055 policy note.
 *
 * The footer carries the `payroll-eos-ledger-tie` block-on-fail
 * assertion: Σ un-extinguished balances == the EOS_PROVISION purpose
 * account's natural-direction GL balance (LIABILITY: credit − debit) —
 * the register-vs-ledger fold (an INDEPENDENT code path). Tolerance 0.
 *
 * NO jurisdiction rates anywhere (BR-055 — the tenant policy note states
 * the basis discipline; the grep-verifiable no-rates law).
 *
 * Permission `payroll.reports.view`. Employee rows carry code + display
 * names only (the PII law).
 */

const EOS_LEDGER_TIE = assertDecl(
  "payroll-eos-ledger-tie",
  "Σ un-extinguished per-employee balances == the EOS_PROVISION purpose account's natural-direction GL balance (credit − debit; tolerance 0)",
  "مجموع الأرصدة غير المطفأة لا يطابق رصيد حساب مخصص نهاية الخدمة في دفتر الأستاذ — التصدير محجوب حتى المطابقة",
  "The un-extinguished balance sum does not tie to the EOS_PROVISION account's GL balance — export blocked until the tie passes",
  "INV-025",
);

const POLICY_NOTE = bilingual(
  "المخصص يعمل بسياسة المستأجر (BR-055): أيام الاستحقاق لكل سنة خدمة قيمة صريحة من المستأجر — لا تُشحن أي نسب نظامية لأي دولة، والمحرك معطّل افتراضياً",
  "The provision runs on tenant policy (BR-055): the accrual days per service year are an explicit tenant value — no jurisdiction rates ship for any country, and the engine is disabled by default",
);

function tieResult(ties: { registerBalance: string; glBalance: string; ok: boolean }): AssertionResult {
  return {
    id: "payroll-eos-ledger-tie",
    status: ties.ok ? "PASS" : "FAIL",
    compared: { left: ties.registerBalance, right: ties.glBalance },
    detail: ties.ok
      ? undefined
      : {
          ar: `رصيد السجل ${ties.registerBalance} ≠ رصيد دفتر الأستاذ ${ties.glBalance} — التصدير محجوب`,
          en: `Register balance ${ties.registerBalance} ≠ GL balance ${ties.glBalance} — export blocked`,
        },
  };
}

export const payrollEosProvisionContract = defineReport({
  id: "payroll.eos-provision",
  version: 1,
  title: bilingual("مخصص نهاية الخدمة", "EOS Provision"),
  category: "financial",
  description: bilingual(
    "حركات مخصص نهاية الخدمة لكل موظف: الاستحقاقات والتسويات والفروق المحررة والرصيد — يحمل فحص payroll-eos-ledger-tie الذي يمنع التصدير عند الفشل",
    "The end-of-service provision movements per employee: accruals, settlements, released residuals and the balance — carrying the payroll-eos-ledger-tie check that blocks exports on failure",
  ),
  parameters: z.object({
    locale: LOCALE,
  }),
  requiredPermission: "payroll.reports.view",
  dataSources: [
    source(
      "payroll",
      "payrollQueries.eosProvision (the per-employee accrual/settlement folds)",
      ["payroll_runs", "payroll_run_lines", "employees"],
      "استحقاقات المخصص وتسوياته لكل موظف",
      "The per-employee provision accruals and settlements",
    ),
    source(
      "accounting",
      "journal (the EOS_PROVISION account lines — the tie side)",
      ["journal_entries", "journal_lines", "account_purposes"],
      "سطور حساب المخصص في دفتر الأستاذ — جانب المطابقة",
      "The provision account's GL lines — the tie side",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "optional", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "accrued", kind: "sum" },
      { id: "settled", kind: "sum" },
      { id: "balance", kind: "sum" },
    ],
    sorting: [{ by: "employeeCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 600,
    invalidationEvents: ["journal.posted", "journal.reversed", "payroll.run_posted"],
  },
  assertions: [EOS_LEDGER_TIE],
  drillTargets: [
    drill(
      "employeeId",
      "/payroll/employees/{employeeId}",
      "ملف الموظف",
      "The employee file",
      "payroll.employees.view",
    ),
  ],
  run: async (_ctx, params) => {
    const { payroll } = reportingServices();
    const result = await payroll.eosProvision();
    const locale = params.locale === "en" ? "en" : "ar";

    let accruedTotal = "0";
    let settledTotal = "0";
    let balanceTotal = "0";
    for (const row of result.rows) {
      accruedTotal = addExactLocal(accruedTotal, row.accrued);
      settledTotal = addExactLocal(settledTotal, row.settled ?? "0");
      balanceTotal = addExactLocal(balanceTotal, row.balance);
    }

    return {
      columns: [
        col("employee", "الموظف", "Employee"),
        col("status", "الحالة", "Status"),
        moneyCol("accrued", "المستحق", "Accrued"),
        moneyCol("settled", "المسدّد نقداً", "Cash settled"),
        moneyCol("released", "المحرر", "Released"),
        moneyCol("balance", "الرصيد", "Balance"),
      ],
      groups: [],
      rows: result.rows.map((row) => ({
        key: row.employeeId,
        values: {
          employee:
            locale === "ar"
              ? `${row.employeeCode} — ${row.employeeNameAr ?? row.employeeName}`
              : `${row.employeeCode} — ${row.employeeName}`,
          status: row.status,
          accrued: row.accrued,
          settled: row.settled ?? "—",
          released: row.released ?? "—",
          balance: row.balance,
        },
      })),
      totals: [
        {
          id: "accruedTotal",
          kind: "sum",
          label: bilingual("إجمالي المستحق", "Accrued total"),
          amount: accruedTotal,
        },
        {
          id: "settledTotal",
          kind: "sum",
          label: bilingual("إجمالي المسدّد", "Settled total"),
          amount: settledTotal,
        },
        {
          id: "balanceTotal",
          kind: "sum",
          label: bilingual("إجمالي الرصيد", "Balance total"),
          amount: balanceTotal,
        },
      ],
      assertionResults: [tieResult(result.ties)],
      notes: [POLICY_NOTE],
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
