import { z } from "zod";

import { addExact, compareExact, subExact } from "../../../accounting/application/decimal-strings";
import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-027 wave E · `installments.schedule` (REPORT_CATALOG §9 row 234 —
 * the report key the catalog pins verbatim): one plan's lines with
 * seq/dueDate/amount/status — the printable schedule (a4-document).
 *
 * AS-OF RULE: collections attribution is job-derived and time-varying (the
 * sweep rebuilds receipt_refs/collected from the source document's posted
 * allocations), so the lines render their CURRENT states — the plan register
 * owns them — with the asOf recorded for freshness semantics. Plan amounts
 * are base-currency by construction this phase.
 *
 * The footer carries BOTH block-on-fail ties (the BR-048 activation
 * invariants, exact): `schedule-sum-tie` (Σ line amounts == plan.total −
 * plan.downPayment EXACTLY — the builder's remainder absorption) and
 * `lines-count-tie` (line count == plan.line_count). Tolerance 0.
 *
 * Permission `installments.plans.view`. Deterministic over (planId, asOf).
 */

const SCHEDULE_SUM_TIE = assertDecl(
  "schedule-sum-tie",
  "Σ line amounts == plan.total − plan.downPayment EXACTLY",
  "مجموع مبالغ الأقساط لا يساوي إجمالي الخطة ناقص الدفعة الأولى",
  "The schedule lines do not sum to the plan total minus the down payment",
  "BR-048",
);

const LINES_COUNT_TIE = assertDecl(
  "lines-count-tie",
  "line count == plan.line_count",
  "عدد الأقساط لا يطابق عدد سطور الخطة المسجل",
  "The line count does not match the plan's recorded line count",
  "BR-048",
);

/** The exact schedule-sum tie (Σ lines vs total − down). */
function scheduleSumResult(input: {
  linesTotal: string;
  expected: string;
}): AssertionResult {
  const ok = compareExact(input.linesTotal, input.expected) === 0;
  return {
    id: "schedule-sum-tie",
    status: ok ? "PASS" : "FAIL",
    compared: { left: input.linesTotal, right: input.expected },
    detail: ok
      ? undefined
      : {
          ar: `Σ مبالغ الأقساط ${input.linesTotal} ≠ إجمالي الخطة ناقص الدفعة ${input.expected} — الجدول غير متسق مع الخطة (BR-048)`,
          en: `Σ line amounts ${input.linesTotal} ≠ plan total − down payment ${input.expected} — the schedule is inconsistent with the plan (BR-048)`,
        },
  };
}

/** The exact line-count tie. */
function linesCountResult(input: { count: number; expected: number }): AssertionResult {
  const ok = input.count === input.expected;
  return {
    id: "lines-count-tie",
    status: ok ? "PASS" : "FAIL",
    compared: { left: String(input.count), right: String(input.expected) },
    detail: ok
      ? undefined
      : {
          ar: `عدد السطور ${input.count} ≠ ${input.expected} المسجل في الخطة`,
          en: `Line count ${input.count} ≠ the plan's recorded ${input.expected}`,
        },
  };
}

export const installmentsScheduleContract = defineReport({
  id: "installments.schedule",
  version: 1,
  title: bilingual("جدول الأقساط", "Installment Schedule"),
  category: "financial",
  description: bilingual(
    "جدول أقساط خطة واحدة: كل قسط بتاريخه ومبلغه وحالته (المحصل والمتبقي) مع رأس الخطة والدفعة الأولى وسياسة رسوم التأخير — يحمل مطابقتي schedule-sum-tie و lines-count-tie اللتين تمنعان التصدير عند الفشل",
    "One plan's installment schedule: every line with its due date, amount and status (collected + residual) plus the plan header, down payment and late-fee policy — carrying the schedule-sum-tie / lines-count-tie checks that block exports on failure",
  ),
  parameters: z.object({
    planId: z.string().uuid(),
    asOf: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "installments.plans.view",
  dataSources: [
    source(
      "installments",
      "installmentsQueries.schedule (the plan register's own lines)",
      ["installment_plans", "installment_lines"],
      "خطط الأقساط وسطورها — الحالة الجارية للسطور",
      "Installment plans + lines — the lines' current states",
    ),
    source(
      "partners",
      "partner identity of the plan header",
      ["partners"],
      "هوية الشريك في رأس الخطة",
      "The partner identity for the plan header",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "amount", kind: "sum" },
      { id: "collected", kind: "sum" },
      { id: "residual", kind: "sum" },
    ],
    sorting: [{ by: "seq", dir: "asc" }],
    zeroSuppression: "none",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  printTemplate: "a4-document",
  freshness: {
    semantics: "as-of",
    cacheTtlSeconds: 3600,
    invalidationEvents: ["journal.posted", "journal.reversed", "period.locked"],
  },
  assertions: [SCHEDULE_SUM_TIE, LINES_COUNT_TIE],
  run: async (_ctx, params) => {
    const { installments } = reportingServices();
    const view = await installments.schedule({ planId: params.planId!, asOf: params.asOf! });

    let amountTotal = "0.0000";
    let collectedTotal = "0.0000";
    let residualTotal = "0.0000";
    for (const line of view.lines) {
      amountTotal = addExact(amountTotal, line.amount);
      collectedTotal = addExact(collectedTotal, line.collectedAmount);
      residualTotal = addExact(residualTotal, line.residualAmount);
    }
    const expectedTotal = subExact(view.plan.totalAmount, view.plan.downPayment);

    return {
      columns: [
        col("seq", "#", "Seq", "text", true),
        col("dueDate", "الاستحقاق", "Due", "date"),
        moneyCol("amount", "مبلغ القسط", "Amount"),
        moneyCol("collected", "المحصل", "Collected"),
        moneyCol("residual", "المتبقي", "Residual"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("lateFee", "رسوم التأخير", "Late fee"),
      ],
      groups: [],
      rows: view.lines.map((line) => ({
        key: line.lineId,
        values: {
          seq: line.seq,
          dueDate: line.dueDate,
          amount: line.amount,
          collected: line.collectedAmount,
          residual: line.residualAmount,
          status: line.status,
          lateFee: line.lateFeeAmount,
        },
      })),
      totals: [
        {
          id: "lineCount",
          kind: "sum",
          label: bilingual("عدد الأقساط", "Lines"),
          amount: String(view.lines.length),
        },
        {
          id: "amountTotal",
          kind: "sum",
          label: bilingual("إجمالي الأقساط", "Total lines"),
          amount: amountTotal,
        },
        {
          id: "collectedTotal",
          kind: "sum",
          label: bilingual("إجمالي المحصل", "Total collected"),
          amount: collectedTotal,
        },
        {
          id: "residualTotal",
          kind: "sum",
          label: bilingual("إجمالي المتبقي", "Total residual"),
          amount: residualTotal,
        },
        {
          id: "planTotal",
          kind: "sum",
          label: bilingual("إجمالي الخطة", "Plan total"),
          amount: view.plan.totalAmount,
        },
        {
          id: "downPayment",
          kind: "sum",
          label: bilingual("الدفعة الأولى", "Down payment"),
          amount: view.plan.downPayment,
        },
      ],
      assertionResults: [
        scheduleSumResult({ linesTotal: amountTotal, expected: expectedTotal }),
        linesCountResult({ count: view.lines.length, expected: view.plan.lineCount }),
      ],
      notes: [
        bilingual(
          `الخطة ${view.plan.sourceNo ?? view.plan.planId} — الشريك ${params.locale === "ar" ? view.plan.partnerNameAr ?? view.plan.partnerName ?? view.plan.partnerId : view.plan.partnerName ?? view.plan.partnerId}؛ المصدر ${view.plan.sourceType}؛ الحالة ${view.plan.status ?? "مسودة"}؛ التكرار ${view.plan.frequency}`,
          `Plan ${view.plan.sourceNo ?? view.plan.planId} — partner ${view.plan.partnerName ?? view.plan.partnerId}; source ${view.plan.sourceType}; status ${view.plan.status ?? "DRAFT"}; frequency ${view.plan.frequency}`,
        ),
        bilingual(
          "الحالات الجارية للسطور كما يملكها سجل الخطة (التحصيل مشتق بالوظيفة الدورية ومتغير زمنياً) — التاريخ المطلوب مسجل لدلالة الحداثة فقط؛ رسوم التأخير مسطحة فقط (DR-003: لا فائدة ولا تركيب)",
          "The lines' CURRENT states as the plan register owns them (collections attribution is job-derived and time-varying) — the requested asOf is recorded for freshness semantics only; late fees are FLAT only (DR-003: no interest, no compounding)",
        ),
        bilingual(
          `سياسة رسوم التأخير (BR-049): النسبة ${view.plan.lateFeePolicy.rate}، السقف ${view.plan.lateFeePolicy.cap}، السماح ${view.plan.lateFeePolicy.grace_days} يوم، الشحن الآلي ${view.plan.lateFeePolicy.auto_charge ? "مفعّل" : "معطّل"}، التعثر بعد ${view.plan.lateFeePolicy.defaulted_after_lines} قسط متأخر متتالي`,
          `Late-fee policy (BR-049): rate ${view.plan.lateFeePolicy.rate}, cap ${view.plan.lateFeePolicy.cap}, grace ${view.plan.lateFeePolicy.grace_days} days, auto-charge ${view.plan.lateFeePolicy.auto_charge ? "on" : "off"}, default after ${view.plan.lateFeePolicy.defaulted_after_lines} consecutive overdue lines`,
        ),
      ],
    };
  },
});
