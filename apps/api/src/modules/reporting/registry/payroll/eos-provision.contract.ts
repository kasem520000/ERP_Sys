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
 * PHASE-046 (W-6, T-13 — THE W-3/W-6 DESIGN POINT, dated 2026-11-17,
 * recorded for the owner's review): this 029-era register fold (Σ
 * un-extinguished per-employee balances over the run-line accruals)
 * predates the G-54 EOSB true-up legs. On a tenant that posts EOSB
 * true-ups, the GL side grows by the deltas while this register side
 * does not — the tie FAILS and the block-on-fail engages (the SAFE
 * direction: a drifted export is refused, never silently wrong). The
 * 046-correct view — the STANDING model (the 029 balance + the
 * accumulated G-54 deltas), which ties in every world — is
 * `payroll.eosb-liability` (this wave's contract). The semantic update
 * of THIS report (fold the deltas into the register side, or retire the
 * 029 view in favor of the standing view) is the owner's open input;
 * not changed here unilaterally.
 *
 * [RULED 2026-11-18 (the owner's W-9 verification dispatch): option (A) —
 * FOLD THE DELTAS. This report's register side folds the accumulated
 * G-54 true-up deltas (aligning with the standing model so it ties in
 * every world); block-on-fail retained; the 029 golden re-pinned in the
 * true-up world. Delivered as a SMALL STANDALONE maintenance wave (the
 * W-8/W-9 pattern) at the delivering session's scheduling discretion —
 * NOT inside PHASE-047's ledger-free waves (payroll-module scope; keep
 * 047 clean). Until that wave lands, the SAFE-direction block stands
 * exactly as documented above.]
 *
 * **[DELIVERED 2026-11-18 — the standalone maintenance wave LANDED (same
 * day, on the W-0 head `6ffd79d`; the delivering session's fresh clone,
 * the same-session evidence rule honored). The register side now carries
 * the STANDING balance — the 029 balance + the accumulated G-54 true-up
 * deltas — with the delta visible as its own `trueUp` column, and the
 * row universe extended to the computations (a true-ups-only employee
 * renders; the standing model's law). The tie `payroll-eos-ledger-tie`
 * holds in EVERY world; block-on-fail retained (the seeded-drift arm
 * re-proven in the true-up world); the golden re-pinned BOTH worlds — the
 * no-true-up PAY world (payroll-rules.spec: the fold a no-op, every
 * legacy assertion unchanged) and the true-up PCR world (the compliance
 * spec's re-pin: Σ standing 42,500 == the GL). The SAFE-direction
 * paragraph above is the historical pre-fold record — superseded by this
 * delivery; `payroll.eosb-liability` remains the entitlement view.]**
 *
 * Permission `payroll.reports.view`. Employee rows carry code + display
 * names only (the PII law).
 */

const EOS_LEDGER_TIE = assertDecl(
  "payroll-eos-ledger-tie",
  "Σ per-employee standing balances (the 029 balance + the accumulated G-54 true-up deltas) == the EOS_PROVISION purpose account's natural-direction GL balance (credit − debit; tolerance 0)",
  "مجموع الأرصدة القائمة (رصيد 029 + مجاميع تسويات G-54) لا يطابق رصيد حساب مخصص نهاية الخدمة في دفتر الأستاذ — التصدير محجوب حتى المطابقة",
  "The standing-balance sum (the 029 balance + the accumulated G-54 deltas) does not tie to the EOS_PROVISION account's GL balance — export blocked until the tie passes",
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
          en: `Register standing balance ${ties.registerBalance} ≠ GL balance ${ties.glBalance} — export blocked`,
        },
  };
}

export const payrollEosProvisionContract = defineReport({
  id: "payroll.eos-provision",
  version: 1,
  title: bilingual("مخصص نهاية الخدمة", "EOS Provision"),
  category: "financial",
  description: bilingual(
    "حركات مخصص نهاية الخدمة لكل موظف: الاستحقاقات والتسويات والفروق المحررة ومجاميع تسويات G-54 والرصيد القائم — يحمل فحص payroll-eos-ledger-tie الذي يمنع التصدير عند الفشل",
    "The end-of-service provision movements per employee: accruals, settlements, released residuals, the G-54 true-up totals and the standing balance — carrying the payroll-eos-ledger-tie check that blocks exports on failure",
  ),
  parameters: z.object({
    locale: LOCALE,
  }),
  requiredPermission: "payroll.reports.view",
  dataSources: [
    source(
      "payroll",
      "payrollQueries.eosProvision (the per-employee accrual/settlement folds + the accumulated G-54 true-up deltas — the ruled option-(A) standing fold)",
      ["payroll_runs", "payroll_run_lines", "employees", "eosb_calculations"],
      "استحقاقات المخصص وتسوياته ومجاميع تسويات G-54 لكل موظف",
      "The per-employee provision accruals, settlements and G-54 true-up totals",
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
      { id: "trueUp", kind: "sum" },
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
    let trueUpTotal = "0";
    let balanceTotal = "0";
    for (const row of result.rows) {
      accruedTotal = addExactLocal(accruedTotal, row.accrued);
      settledTotal = addExactLocal(settledTotal, row.settled ?? "0");
      trueUpTotal = addExactLocal(trueUpTotal, row.trueUp);
      balanceTotal = addExactLocal(balanceTotal, row.balance);
    }

    return {
      columns: [
        col("employee", "الموظف", "Employee"),
        col("status", "الحالة", "Status"),
        moneyCol("accrued", "المستحق", "Accrued"),
        moneyCol("settled", "المسدّد نقداً", "Cash settled"),
        moneyCol("released", "المحرر", "Released"),
        moneyCol("trueUp", "مجاميع التسويات (G-54)", "True-up total (G-54)"),
        moneyCol("balance", "الرصيد القائم", "Standing balance"),
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
          trueUp: row.trueUp,
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
          id: "trueUpTotal",
          kind: "sum",
          label: bilingual("إجمالي مجاميع التسويات", "True-up total"),
          amount: trueUpTotal,
        },
        {
          id: "balanceTotal",
          kind: "sum",
          label: bilingual("إجمالي الرصيد القائم", "Standing-balance total"),
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
