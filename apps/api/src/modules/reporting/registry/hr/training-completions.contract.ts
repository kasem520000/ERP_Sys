import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import {
  ISO_DATE,
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
import type { TrainingCompletionsRow } from "./hr-queries";

/**
 * PHASE-047 (W-6, T-15 — REPORT_CATALOG §9's PHASE-047 row 3):
 * `hr.training-completions` — the completed enrollments inside a
 * window as a report contract: one row per COMPLETED enrollment —
 * the program, the employee, the attendance/completion percentages,
 * the result, and the immutable completed_at stamp (the W-3 law: the
 * COMPLETED edge stamps the date with the result in the same write
 * and never re-stamps).
 *
 * The footer carries the `training-completion-shape` block-on-fail
 * assertion: every rendered row carries a completed_at stamp and a
 * result inside the PENDING/PASSED/FAILED vocabulary (the W-4 import
 * contract's own enum) — a completion without a stamp or with a
 * foreign result is a data corruption the export must not launder.
 *
 * Permission `hr.training.view` (matrix §3.25; REPORT_CATALOG §12
 * module-register reuse rule — the same key the /hr/training reads
 * ride).
 */

const COMPLETION_SHAPE = assertDecl(
  "training-completion-shape",
  "every completed enrollment carries a completed_at stamp and a result inside the PENDING/PASSED/FAILED vocabulary",
  "إتمام بدون تاريخ ختم أو بنتيجة خارج المفردات — التصدير محجوب",
  "A completion without a stamp or with a result outside the vocabulary — export blocked",
  "BR-055",
);

const TRAINING_RESULTS: ReadonlySet<string> = new Set(["PENDING", "PASSED", "FAILED"]);

function completionShapeResult(rows: readonly TrainingCompletionsRow[]): AssertionResult {
  const offenders = rows.filter(
    (row) =>
      row.completedAt === null ||
      row.completedAt === "" ||
      (row.result !== null && !TRAINING_RESULTS.has(row.result)),
  );
  const ok = offenders.length === 0;
  return {
    id: "training-completion-shape",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : {
          ar: `${offenders.length} سجل إتمام خارج الشكل — التصدير محجوب`,
          en: `${offenders.length} completion row(s) out of shape — export blocked`,
        },
  };
}

/** Exact 2dp average on the percentage strings (never float — the
 * leave-balances precedent extended to the percent axes). */
function pct2dp(value: string): bigint {
  const [int = "0", frac = ""] = value.split(".");
  return BigInt(int) * 100n + BigInt(frac.slice(0, 2).padEnd(2, "0"));
}

export const hrTrainingCompletionsContract = defineReport({
  id: "hr.training-completions",
  version: 1,
  title: bilingual("إتمامات التدريب", "Training Completions"),
  category: "hr",
  description: bilingual(
    "سجل الإتمامات المكتملة داخل فترة: صف لكل تسجيل مكمل — البرنامج والموظف ونسب الحضور والإتمام والنتيجة وتاريخ الإتمام المختوم مرة واحدة",
    "The completed enrollments inside a window: one row per completion — the program, the employee, the attendance/completion percentages, the result, and the once-stamped completed date",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    programId: z.string().uuid().optional(),
    employeeId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "hr.training.view",
  dataSources: [
    source(
      "hr",
      "hrQueries.trainingCompletions (the completed enrollments in the window)",
      ["training_enrollments", "training_programs", "employees"],
      "التسجيلات المكملة داخل الفترة",
      "The completed enrollments inside the window",
    ),
  ],
  scopeRules: { dateRange: "required", asOf: "forbidden", branches: "optional" },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: [],
  },
  assertions: [COMPLETION_SHAPE],
  drillTargets: [
    drill(
      "programId",
      "/hr/training",
      "لوحة التدريب والشهادات",
      "The training board",
      "hr.training.view",
    ),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "completionPct", kind: "derived" }],
    sorting: [{ by: "completedAt", dir: "desc" }],
    zeroSuppression: "rows",
  },
  totals: { grandTotals: "sum" },
  run: async (_ctx, params) => {
    const { hr } = reportingServices();
    const rows = await hr.trainingCompletions({
      dateFrom: params.dateFrom as string,
      dateTo: params.dateTo as string,
      programId: params.programId,
      employeeId: params.employeeId,
    });
    const locale = params.locale === "en" ? "en" : "ar";

    let completionSum = 0n;
    let completionCount = 0;
    for (const row of rows) {
      if (row.completionPct !== null) {
        completionSum += pct2dp(row.completionPct);
        completionCount += 1;
      }
    }
    const avgCompletion =
      completionCount === 0
        ? null
        : (() => {
            // Half-up on the exact minor units — the sum and the
            // average are BOTH 2dp (the performance contract's
            // avg2dp, inlined for the percent axis).
            const count = BigInt(completionCount);
            const quotient = completionSum / count;
            const remainder = completionSum % count;
            const rounded = remainder * 2n >= count ? quotient + 1n : quotient;
            const digits = rounded.toString().padStart(3, "0");
            return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
          })();

    return {
      columns: [
        col("program", "البرنامج", "Program"),
        col("employee", "الموظف", "Employee"),
        qtyCol("attendancePct", "نسبة الحضور %", "Attendance %"),
        qtyCol("completionPct", "نسبة الإتمام %", "Completion %"),
        col("result", "النتيجة", "Result"),
        col("completedAt", "تاريخ الإتمام", "Completed at"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.enrollmentId,
        values: {
          program:
            locale === "ar" && row.programName !== row.programCode
              ? `${row.programCode} — ${row.programName}`
              : `${row.programCode} — ${row.programName}`,
          employee: `${row.employeeCode} — ${row.employeeName}`,
          attendancePct: row.attendancePct ?? "—",
          completionPct: row.completionPct ?? "—",
          result: row.result ?? "—",
          completedAt: row.completedAt.slice(0, 10),
        },
      })),
      totals: [
        {
          id: "completedCount",
          kind: "sum",
          label: bilingual("عدد الإتمامات", "Completion count"),
          amount: rows.length.toString(),
        },
        ...(avgCompletion === null
          ? []
          : [
              {
                id: "avgCompletionPct",
                kind: "sum" as const,
                label: bilingual("متوسط نسبة الإتمام", "Average completion"),
                amount: avgCompletion,
              },
            ]),
      ],
      assertionResults: [completionShapeResult(rows)],
    };
  },
});
