import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import type { AssertionResult } from "../../application/contract";
import type { InstallmentAgingBucket, InstallmentsAgingTieRow } from "./installments-queries";
import { collectedExceedsSettled } from "./installments-queries";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-027 wave E · `installments.aging` (REPORT_CATALOG §9 row 235 — the
 * report key the catalog pins verbatim): the uncollected installment lines
 * (PENDING/DUE/OVERDUE) of the activated, un-closed plans (ACTIVE/DEFAULTED)
 * aged by due_date vs asOf — one row per line on its RESIDUAL
 * (amount − collected), the ar-queries bucket convention (fixed shape):
 * notDue / 1–30 / 31–60 / 61–90 / 90+ days overdue, integral day difference
 * ((asOfMs − dueMs) / 86_400_000 | 0).
 *
 * AS-OF RULE: the lines render their CURRENT states (collections attribution
 * is job-derived and time-varying — the plan register owns them) with the
 * asOf anchoring the population (plans activated ≤ asOf) and the buckets.
 * Plan amounts are base-currency by construction this phase.
 *
 * The footer carries the `installments-inv016-tie` block-on-fail sanity
 * (read-only): per plan, Σ line collected_amount ≤ Σ source settled (the
 * posted receipt allocations on the plan's source open items — the same
 * reads the attribution recompute consumes; the service enforces the
 * stronger down-payment-excluded invariant, so this check surfaces drift
 * only). The footer note states the BR-049 late-fee policy semantics (flat
 * fees per plan — rate/cap/grace, DR-003: never interest).
 *
 * Permission `installments.plans.view`. Deterministic over (asOf, partner).
 */

const INSTALLMENTS_INV016_TIE = assertDecl(
  "installments-inv016-tie",
  "Σ line collected ≤ Σ source settled (per plan — the INV-016 attribution sanity)",
  "مجموع المحصل على الأقساط يتجاوز المسدد على مستند المصدر (INV-016)",
  "The lines' collected total exceeds the source document's settled total (INV-016)",
  "INV-016",
);

/** The per-plan INV-016 fold result (offending plans named in the detail). */
function inv016TieResult(ties: readonly InstallmentsAgingTieRow[]): AssertionResult {
  const broken = ties.filter((tie) => collectedExceedsSettled(tie));
  let linesCollected = "0.0000";
  let sourceSettled = "0.0000";
  for (const tie of ties) {
    linesCollected = addExact(linesCollected, tie.linesCollected);
    sourceSettled = addExact(sourceSettled, tie.sourceSettled);
  }
  const ok = broken.length === 0;
  return {
    id: "installments-inv016-tie",
    status: ok ? "PASS" : "FAIL",
    compared: { left: linesCollected, right: sourceSettled },
    detail: ok
      ? undefined
      : {
          ar: `خطط تجاوز فيها المحصل المسدد: ${broken
            .map((tie) => `${tie.planSourceNo ?? tie.planId} (أقساط ${tie.linesCollected} / مسدد ${tie.sourceSettled})`)
            .join("، ")}`,
          en: `Plan(s) where collected exceeds settled: ${broken
            .map((tie) => `${tie.planSourceNo ?? tie.planId} (lines ${tie.linesCollected} / settled ${tie.sourceSettled})`)
            .join(", ")}`,
        },
  };
}

const AGING_BUCKETS: readonly InstallmentAgingBucket[] = ["notDue", "1_30", "31_60", "61_90", "90_plus"];

const BUCKET_FIELD: Readonly<Record<InstallmentAgingBucket, string>> = {
  notDue: "notDue",
  "1_30": "b1_30",
  "31_60": "b31_60",
  "61_90": "b61_90",
  "90_plus": "b90Plus",
};

const BR049_NOTE = bilingual(
  "سياسة رسوم التأخير لكل خطة (BR-049): رسم مسطح فقط = min(النسبة × مبلغ القسط، السقف) بعد أيام السماح، مرة واحدة لكل قسط (G-28)، والتعثر بعد العدد المتتالي المحدد — لا فائدة ولا تركيب في أي مكان (DR-003)؛ الأقساط المعفاة (WAIVED) لا تدخل الأعمار",
  "The late-fee policy is PER PLAN (BR-049): a FLAT fee only = min(rate × line amount, cap) after the grace days, once per line (G-28), with default after the configured consecutive count — no interest, no compounding anywhere (DR-003); WAIVED lines never age",
);

const ASOF_RULE_NOTE = bilingual(
  "الأعمار على المتبقي (المبلغ − المحصل) للسطور غير المحصلة من الخطط المفعّلة غير المغلقة التي فُعّلت حتى التاريخ — الحالات الجارية كما يملكها سجل الخطة (التحصيل مشتق بالوظيفة الدورية ومتغير زمنياً) والتاريخ المطلوب مرساة للمجتمع والدلاء",
  "The aging is over the RESIDUAL (amount − collected) of the uncollected lines of activated, un-closed plans activated ≤ asOf — the lines' CURRENT states as the plan register owns them (collections attribution is job-derived and time-varying), the requested asOf anchoring the population and the buckets",
);

export const installmentsAgingContract = defineReport({
  id: "installments.aging",
  version: 1,
  title: bilingual("أعمار الأقساط", "Installments Aging"),
  category: "financial",
  description: bilingual(
    "أعمار الأقساط غير المحصلة حتى تاريخ: كل قساط متبقٍ في دلو استحقاقه (غير مستحق/1–30/31–60/61–90/أكثر من 90) مع حالته ورسوم تأخيره — يحمل فحص installments-inv016-tie الذي يمنع التصدير عند الفشل",
    "The uncollected installments aging as of a date: each line's residual in its due bucket (notDue/1–30/31–60/61–90/90+) with its status and late fee — carrying the installments-inv016-tie check that blocks exports on failure",
  ),
  parameters: z.object({
    asOf: ISO_DATE,
    partnerId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "installments.plans.view",
  dataSources: [
    source(
      "installments",
      "installmentsQueries.aging (uncollected lines by due bucket + the INV-016 fold)",
      ["installment_plans", "installment_lines"],
      "خطط الأقساط وسطورها غير المحصلة بأعمار الاستحقاق",
      "Installment plans + their uncollected lines by due age",
    ),
    source(
      "treasury",
      "the plans' source settled stream (posted receipt allocations — the INV-016 sanity)",
      ["treasury_allocations", "receipts"],
      "مسدد مستند المصدر لكل خطة — فحص INV-016",
      "Each plan's source settled stream — the INV-016 sanity",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [{ id: "residual", kind: "sum" }],
    sorting: [{ by: "dueDate", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "as-of",
    cacheTtlSeconds: 3600,
    invalidationEvents: ["journal.posted", "journal.reversed", "period.locked"],
  },
  assertions: [INSTALLMENTS_INV016_TIE],
  run: async (_ctx, params) => {
    const { installments } = reportingServices();
    const view = await installments.aging({
      asOf: params.asOf!,
      partnerId: params.partnerId ?? null,
    });

    const bucketTotals: Record<InstallmentAgingBucket, string> = {
      notDue: "0.0000",
      "1_30": "0.0000",
      "31_60": "0.0000",
      "61_90": "0.0000",
      "90_plus": "0.0000",
    };
    let residualTotal = "0.0000";
    let lateFeeTotal = "0.0000";
    const reportRows = [];
    for (const row of view.rows) {
      bucketTotals[row.bucket] = addExact(bucketTotals[row.bucket], row.residualAmount);
      residualTotal = addExact(residualTotal, row.residualAmount);
      if (row.lateFeeAmount !== null) {
        lateFeeTotal = addExact(lateFeeTotal, row.lateFeeAmount);
      }
      const values: Record<string, string | number | null> = {
        plan: row.planSourceNo ?? row.planId,
        planStatus: row.planStatus,
        partner: params.locale === "ar" ? row.partnerNameAr ?? row.partnerName : row.partnerName,
        seq: row.seq,
        dueDate: row.dueDate,
        lineStatus: row.lineStatus,
        residual: row.residualAmount,
        lateFee: row.lateFeeAmount,
      };
      for (const bucket of AGING_BUCKETS) {
        values[BUCKET_FIELD[bucket]] = bucket === row.bucket ? row.residualAmount : "0.0000";
      }
      reportRows.push({ key: row.lineId, values });
    }

    return {
      columns: [
        col("plan", "الخطة", "Plan"),
        col("planStatus", "حالة الخطة", "Plan status", "status"),
        col("partner", "الشريك", "Partner"),
        col("seq", "#", "Seq", "text", true),
        col("dueDate", "الاستحقاق", "Due", "date"),
        col("lineStatus", "حالة القسط", "Status", "status"),
        moneyCol("residual", "المتبقي", "Residual"),
        moneyCol("notDue", "غير مستحق", "Not due"),
        moneyCol("b1_30", "1–30 يوم", "1–30 days"),
        moneyCol("b31_60", "31–60 يوم", "31–60 days"),
        moneyCol("b61_90", "61–90 يوم", "61–90 days"),
        moneyCol("b90Plus", "أكثر من 90", "90+ days"),
        moneyCol("lateFee", "رسوم التأخير", "Late fee"),
      ],
      groups: [],
      rows: reportRows,
      totals: [
        {
          id: "lineCount",
          kind: "sum",
          label: bilingual("عدد الأقساط غير المحصلة", "Uncollected lines"),
          amount: String(reportRows.length),
        },
        ...AGING_BUCKETS.map((bucket) => ({
          id: BUCKET_FIELD[bucket],
          kind: "sum" as const,
          label: bilingual(
            `إجمالي ${bucket === "notDue" ? "غير المستحق" : bucket === "1_30" ? "1–30 يوم" : bucket === "31_60" ? "31–60 يوم" : bucket === "61_90" ? "61–90 يوم" : "أكثر من 90"}`,
            `Total ${bucket === "notDue" ? "not due" : bucket === "1_30" ? "1–30 days" : bucket === "31_60" ? "31–60 days" : bucket === "61_90" ? "61–90 days" : "90+ days"}`,
          ),
          amount: bucketTotals[bucket],
        })),
        {
          id: "baseTotal",
          kind: "sum",
          label: bilingual("إجمالي المتبقي", "Total residual"),
          amount: residualTotal,
        },
        {
          id: "lateFeeTotal",
          kind: "sum",
          label: bilingual("إجمالي رسوم التأخير المحمّلة", "Total charged late fees"),
          amount: lateFeeTotal,
        },
      ],
      assertionResults: [inv016TieResult(view.ties)],
      notes: [ASOF_RULE_NOTE, BR049_NOTE],
    };
  },
});
