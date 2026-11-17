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
 * PHASE-046 (W-6, T-13 — D-12) · `payroll.eosb-liability` (REPORT_CATALOG
 * §payroll, registry 104 → 106): the per-employee end-of-service liability
 * — service years, the tier-fold days, the computed entitlement, the
 * STANDING provision (BR-087's model: the 029 balance + the accumulated
 * G-54 true-up deltas), the settled cash, and the latest delta — over
 * every employee carrying EOSB computation evidence.
 *
 * The footer carries the `eosb-provision-tie` block-on-fail assertion:
 * Σ per-employee standing provisions == the EOS_PROVISION purpose
 * account's natural-direction GL balance (LIABILITY: credit − debit) —
 * the GL includes the G-54 legs by construction, and the standing model
 * is exactly the register side that accounts for them (unsettled
 * employees carry accrued + Σ deltas; settled employees carry Σ deltas —
 * the G-31 extinguished their 029 balance at the run-line fold).
 * Tolerance 0.
 *
 * THE W-3/W-6 DESIGN POINT (recorded for the owner, dated 2026-11-17):
 * the 029-era `payroll.eos-provision` report's register fold (Σ
 * un-extinguished 029 balances) predates the G-54 legs — on a tenant
 * that posts EOSB true-ups, that report's tie FAILS (block-on-fail
 * engages — the SAFE direction: no wrong number exports) until the
 * owner directs its semantic update. THIS report is the 046-correct
 * view: the standing model ties in every world.
 *
 * Permission `payroll.reports.view`. Employee rows carry code + display
 * names only (the PII law).
 */

const EOSB_PROVISION_TIE = assertDecl(
  "eosb-provision-tie",
  "Σ per-employee standing provisions (the 029 balance + the accumulated G-54 deltas) == the EOS_PROVISION account's natural-direction GL balance (credit − debit; tolerance 0)",
  "مجموع المخصصات القائمة (رصيد 029 + مجاميع تسويات G-54) لا يطابق رصيد حساب المخصص في دفتر الأستاذ — التصدير محجوب حتى المطابقة",
  "The standing-provision sum does not tie to the EOS_PROVISION account's GL balance — export blocked until the tie passes",
  "INV-032",
);

function tieResult(ties: { registerBalance: string; glBalance: string; ok: boolean }): AssertionResult {
  return {
    id: "eosb-provision-tie",
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

export const payrollEosbLiabilityContract = defineReport({
  id: "payroll.eosb-liability",
  version: 1,
  title: bilingual("التزام مكافأة نهاية الخدمة", "EOSB Liability"),
  category: "financial",
  description: bilingual(
    "التزام مكافأة نهاية الخدمة لكل موظف: سنوات الخدمة وأيام الطبقات والاستحقاق المحسوب والمخصص القائم (رصيد 029 + مجاميع التسويات G-54) والمسدّد وآخر فرق — يحمل فحص eosb-provision-tie الذي يمنع التصدير عند الفشل",
    "The end-of-service liability per employee: service years, tier days, the computed entitlement, the standing provision (the 029 balance + the accumulated G-54 deltas), settled cash and the latest delta — carrying the eosb-provision-tie check that blocks exports on failure",
  ),
  parameters: z.object({
    locale: LOCALE,
  }),
  requiredPermission: "payroll.reports.view",
  dataSources: [
    source(
      "payroll",
      "payrollQueries.eosbLiability (the per-employee entitlement + standing-provision folds)",
      ["eosb_calculations", "payroll_run_lines", "payroll_runs", "employees"],
      "الاستحقاق والمخصص القائم لكل موظف",
      "The per-employee entitlement and standing provision",
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
      { id: "entitlement", kind: "sum" },
      { id: "standing", kind: "sum" },
      { id: "settled", kind: "sum" },
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
  assertions: [EOSB_PROVISION_TIE],
  drillTargets: [
    drill(
      "employeeId",
      "/payroll/eosb?employeeId={employeeId}",
      "شاشة تسوية نهاية الخدمة",
      "The EOSB screen",
      "payroll.eosb",
    ),
  ],
  run: async (_ctx, params) => {
    const { payroll } = reportingServices();
    const result = await payroll.eosbLiability();
    const locale = params.locale === "en" ? "en" : "ar";

    let entitlementTotal = "0";
    let standingTotal = "0";
    let settledTotal = "0";
    for (const row of result.rows) {
      if (row.entitlement !== "—") {
        entitlementTotal = addExactLocal(entitlementTotal, row.entitlement);
      }
      standingTotal = addExactLocal(standingTotal, row.standing);
      settledTotal = addExactLocal(settledTotal, row.settled ?? "0");
    }

    return {
      columns: [
        col("employee", "الموظف", "Employee"),
        col("status", "الحالة", "Status"),
        col("kind", "نوع آخر حساب", "Latest kind"),
        col("serviceYears", "سنوات الخدمة", "Service years"),
        col("tierDays", "أيام الطبقات", "Tier days"),
        moneyCol("entitlement", "الاستحقاق المحسوب", "Computed entitlement"),
        moneyCol("standing", "المخصص القائم", "Standing provision"),
        moneyCol("settled", "المسدّد نقداً", "Cash settled"),
        moneyCol("lastDelta", "آخر فرق (G-54)", "Latest delta (G-54)"),
        moneyCol("aligned", "الفرق عن الاستحقاق", "Vs entitlement"),
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
          kind: row.kind,
          serviceYears: row.serviceYears,
          tierDays: row.tierDays,
          entitlement: row.entitlement,
          standing: row.standing,
          settled: row.settled ?? "—",
          lastDelta: row.lastDelta,
          // The 029-only row (ACCRUED_ONLY) has no computed entitlement —
          // the honest "—" (never true-d-up), never a fabricated zero.
          aligned:
            row.entitlement === "—" ? "—" : addExactLocal(row.entitlement, `-${row.standing}`),
        },
      })),
      totals: [
        {
          id: "entitlementTotal",
          kind: "sum",
          label: bilingual("إجمالي الاستحقاق", "Entitlement total"),
          amount: entitlementTotal,
        },
        {
          id: "standingTotal",
          kind: "sum",
          label: bilingual("إجمالي المخصص القائم", "Standing-provision total"),
          amount: standingTotal,
        },
        {
          id: "settledTotal",
          kind: "sum",
          label: bilingual("إجمالي المسدّد", "Settled total"),
          amount: settledTotal,
        },
      ],
      assertionResults: [tieResult(result.ties)],
      notes: [],
    };
  },
});
