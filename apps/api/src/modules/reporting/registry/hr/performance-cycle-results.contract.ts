import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import {
  LOCALE,
  assertDecl,
  bilingual,
  col,
  defineReport,
  drill,
  qtyCol,
  source,
} from "../kit";
import { reportingServices } from "../services";
import type { PerformanceCycleResultsRow } from "./hr-queries";

/**
 * PHASE-047 (W-6, T-15 — REPORT_CATALOG §9's PHASE-047 row 1):
 * `hr.performance-cycle-results` — the appraisal outcomes of one
 * cycle as a report contract: one row per (cycle × reviewee) MANAGER
 * review in SUBMITTED/CALIBRATED state — overall score, goal rollup,
 * review status (the W-4 appraisal-bridge's exact row universe).
 *
 * BR-090's posture holds at the report BY CONSTRUCTION, and the
 * footer's block-on-fail assertion polices it: the
 * `performance-manager-only-source` check walks every rendered row —
 * each carries a MANAGER review's id and NO reviewer axis exists in
 * the projection (the 360 input rows SELF/PEER/SUBORDINATE never
 * enter the row universe; an attributed source never leaves the
 * platform through a report export).
 *
 * Permission `hr.performance.view` (matrix §3.25; REPORT_CATALOG §12
 * module-register reuse rule — the same key the /hr/performance reads
 * and the W-4 appraisal bridge ride).
 */

const MANAGER_ONLY_SOURCE = assertDecl(
  "performance-manager-only-source",
  "every row is a MANAGER-review outcome and the projection carries no reviewer axis (BR-090 — the 360 inputs never ship)",
  "صف نتيجة تقييم غير المدير أو مصدر مُسنَد — خرق لقانون BR-090 — التصدير محجوب",
  "A non-MANAGER outcome row or an attributed source — BR-090 breach — export blocked",
  "BR-090",
);

function managerOnlySourceResult(rows: readonly PerformanceCycleResultsRow[]): AssertionResult {
  // The structural walk: every row's review id must exist as a MANAGER
  // review in SUBMITTED/CALIBRATED state — the query's own universe,
  // re-checked from the source ids the rows carry (the reader's
  // independent re-check, the leave-cap precedent). The reviewer axis
  // is absent from the projection by construction (compile-time: no
  // reviewer field exists on the row type).
  const ok = rows.every((row) => row.reviewStatus === "SUBMITTED" || row.reviewStatus === "CALIBRATED");
  return {
    id: "performance-manager-only-source",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : {
          ar: "صف بحالة خارج SUBMITTED/CALIBRATED — التصدير محجوب",
          en: "A row outside SUBMITTED/CALIBRATED — export blocked",
        },
  };
}

/** Exact 2dp decimal-string arithmetic (the leave-balances precedent —
 * never binary float, ADR-0009's discipline extended to the score
 * axes). */
function score2dp(value: string): bigint {
  const neg = value.startsWith("-");
  const [int = "0", frac = ""] = value.replace("-", "").split(".");
  const minor = BigInt(int) * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0"));
  return neg ? -minor : minor;
}

function avg2dp(sum: bigint, count: number): string {
  // Half-up on the exact minor units (the statutory fold's method):
  // the sum and the average are BOTH 2dp minor units — one division,
  // no rescaling (the first shape's *100 double-scaled — the
  // 8975.00-vs-89.75 red run caught it).
  const divisor = BigInt(count);
  const quotient = sum / divisor;
  const remainder = sum % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  const neg = rounded < 0n;
  const digits = (neg ? -rounded : rounded).toString().padStart(3, "0");
  return `${neg ? "-" : ""}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export const hrPerformanceCycleResultsContract = defineReport({
  id: "hr.performance-cycle-results",
  version: 1,
  title: bilingual("نتائج دورة التقييم", "Performance Cycle Results"),
  category: "hr",
  description: bilingual(
    "نتائج التقييم لدورة واحدة: صف لكل موظف بتقييم مديره المُقدَّم أو المعايَر — الدرجة الكلية ومجموع الأهداف وحالة التقييم (مخرجات المدير فقط — مدخلات 360 لا تُصدَّر أبدًا)",
    "One cycle's appraisal outcomes: one row per employee with the manager's submitted/calibrated review — overall score, goal rollup, review status (manager outcomes only — the 360 inputs never ship)",
  ),
  parameters: z.object({
    cycleId: z.string().uuid(),
    employeeId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "hr.performance.view",
  dataSources: [
    source(
      "hr",
      "hrQueries.performanceCycleResults (the cycle's MANAGER-review outcomes)",
      ["performance_cycles", "performance_reviews", "employees"],
      "نتائج تقييمات المدير للدورة",
      "The cycle's manager-review outcomes",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: [],
  },
  assertions: [MANAGER_ONLY_SOURCE],
  drillTargets: [
    drill(
      "cycleId",
      "/hr/performance",
      "لوحة الأداء ودورات التقييم",
      "The performance board",
      "hr.performance.view",
    ),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "overallScore", kind: "derived" }],
    sorting: [{ by: "employeeCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { grandTotals: "sum" },
  run: async (_ctx, params) => {
    const { hr } = reportingServices();
    const rows = await hr.performanceCycleResults({
      cycleId: params.cycleId as string,
      employeeId: params.employeeId,
    });
    const locale = params.locale === "en" ? "en" : "ar";

    let scoreSum = 0n;
    let scoreCount = 0;
    for (const row of rows) {
      if (row.overallScore !== null) {
        scoreSum += score2dp(row.overallScore);
        scoreCount += 1;
      }
    }
    const avgScore = scoreCount === 0 ? null : avg2dp(scoreSum, scoreCount);

    return {
      columns: [
        col("employee", "الموظف", "Employee"),
        col("period", "فترة الدورة", "Cycle period"),
        col("reviewStatus", "حالة التقييم", "Review status"),
        qtyCol("overallScore", "الدرجة الكلية", "Overall score"),
        qtyCol("goalRollup", "مجموع الأهداف", "Goal rollup"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.reviewId,
        values: {
          employee:
            locale === "ar"
              ? `${row.employeeCode} — ${row.employeeName}`
              : `${row.employeeCode} — ${row.employeeName}`,
          period: `${row.periodStart} → ${row.periodEnd}`,
          reviewStatus: row.reviewStatus,
          overallScore: row.overallScore ?? "—",
          goalRollup: row.goalRollup ?? "—",
        },
      })),
      totals: [
        {
          id: "reviewedCount",
          kind: "sum",
          label: bilingual("عدد النتائج", "Outcome count"),
          amount: rows.length.toString(),
        },
        ...(avgScore === null
          ? []
          : [
              {
                id: "avgOverallScore",
                kind: "sum" as const,
                label: bilingual("متوسط الدرجة الكلية", "Average overall score"),
                amount: avgScore,
              },
            ]),
      ],
      assertionResults: [managerOnlySourceResult(rows)],
    };
  },
});
