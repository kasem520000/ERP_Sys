import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-050 (W-30 — T-17, dated 2026-11-23; REPORT_CATALOG §9's
 * PHASE-050 row 4): `quality.complaints-summary` — the complaints
 * summary: the register's own grouped counts over the period — by status
 * (the 0114 ladder NEW → TRIAGED → IN_PROGRESS → RESOLVED → CLOSED), by
 * channel and by severity (the intake vocabularies) — one GROUP BY per
 * axis, three sections on the same register. COUNTS ONLY (amendment A-4
 * spirit: no complaint body or personal data crosses into the summary).
 *
 * The footer carries the count tie as the block-on-fail assertion
 * (`complaints-count-tie`): each axis's counts sum to the period total —
 * every complaint counted exactly once per axis (the same tie law the
 * recruitment pipeline rides).
 *
 * Permission `quality.view` (matrix §3.28; the §12 module-register
 * reuse rule — the same key the /quality/complaints reads ride).
 */

const COMPLAINTS_COUNT_TIE = assertDecl(
  "complaints-count-tie",
  "Each axis's counts (status, channel, severity) sum to the period total — every complaint counted exactly once per axis",
  "مجموع أحد المحاور لا يساوي إجمالي الفترة — التصدير محجوب",
  "An axis's counts do not sum to the period total — export blocked",
);

function complaintsTieResult(summary: {
  total: number;
  byStatus: readonly { key: string; n: number }[];
  byChannel: readonly { key: string; n: number }[];
  bySeverity: readonly { key: string; n: number }[];
}): AssertionResult {
  const axes: string[] = [];
  const sumOf = (rows: readonly { n: number }[]) => rows.reduce((sum, row) => sum + row.n, 0);
  if (sumOf(summary.byStatus) !== summary.total) axes.push("status");
  if (sumOf(summary.byChannel) !== summary.total) axes.push("channel");
  if (sumOf(summary.bySeverity) !== summary.total) axes.push("severity");
  const ok = axes.length === 0;
  return {
    id: "complaints-count-tie",
    status: ok ? "PASS" : "FAIL",
    compared: ok ? undefined : { left: String(summary.total), right: axes.join(",") },
    detail: ok
      ? undefined
      : bilingual(
          `محاور لا تساوي الإجمالي: ${axes.join("، ")}`,
          `Axis/axes not summing to the total: ${axes.join(", ")}`,
        ),
  };
}

/** The three summary sections' own shape (one per axis). */
function axisRows(
  axis: "status" | "channel" | "severity",
  counts: readonly { key: string; n: number }[],
  locale: "ar" | "en",
) {
  const labels: Record<typeof axis, { ar: string; en: string }> = {
    status: { ar: "الحالة", en: "Status" },
    channel: { ar: "القناة", en: "Channel" },
    severity: { ar: "الدرجة", en: "Severity" },
  };
  return counts.map((entry) => ({
    key: `${axis}:${entry.key}`,
    groupKey: axis,
    values: {
      axis: locale === "ar" ? labels[axis].ar : labels[axis].en,
      value: entry.key,
      count: entry.n,
    },
  }));
}

export const qualityComplaintsSummaryContract = defineReport({
  id: "quality.complaints-summary",
  version: 1,
  title: bilingual("ملخص الشكاوى", "Complaints Summary"),
  category: "quality",
  description: bilingual(
    "ملخص شكاوى العملاء على الفترة في ثلاثة أقسام: العدد حسب الحالة (سلّم ٠١١٤) وحسب قناة الاستقبال وحسب الدرجة — تجميعات السجل نفسه، أعداد فقط",
    "The customer complaints summary over the period in three sections: the counts by status (the 0114 ladder), by intake channel and by severity — the register's own groupings, counts only",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "quality.view",
  dataSources: [
    source(
      "quality",
      "QualityReportQueriesService.complaintsSummary (the complaints register's own grouped counts — one GROUP BY per axis)",
      ["complaints"],
      "تجميعات سجل الشكاوى نفسه",
      "The complaints register's own grouped counts",
    ),
  ],
  scopeRules: { dateRange: "required", asOf: "forbidden", branches: "optional" },
  aggregation: {
    groupBy: ["axis"],
    measures: [{ id: "count", kind: "count" }],
    sorting: [{ by: "count", dir: "desc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "none", subTotalsByGroup: false },
  freshness: { semantics: "current", cacheTtlSeconds: 300, invalidationEvents: [] },
  assertions: [COMPLAINTS_COUNT_TIE],
  run: async (_ctx, params) => {
    const { qualityQueries } = reportingServices();
    const locale = params.locale === "en" ? "en" : "ar";
    const summary = await qualityQueries.complaintsSummary({
      from: params.dateFrom!,
      to: params.dateTo!,
    });
    const groups = [
      {
        key: "status",
        label: bilingual(
          `حسب الحالة (${summary.byStatus.length})`,
          `By status (${summary.byStatus.length})`,
        ),
      },
      {
        key: "channel",
        label: bilingual(
          `حسب القناة (${summary.byChannel.length})`,
          `By channel (${summary.byChannel.length})`,
        ),
      },
      {
        key: "severity",
        label: bilingual(
          `حسب الدرجة (${summary.bySeverity.length})`,
          `By severity (${summary.bySeverity.length})`,
        ),
      },
    ];
    return {
      columns: [
        col("axis", "المحور", "Axis"),
        col("value", "القيمة", "Value", "status"),
        col("count", "العدد", "Count", "qty"),
      ],
      groups,
      rows: [
        ...axisRows("status", summary.byStatus, locale),
        ...axisRows("channel", summary.byChannel, locale),
        ...axisRows("severity", summary.bySeverity, locale),
      ],
      totals: [
        {
          id: "total",
          kind: "sum",
          label: bilingual("إجمالي شكاوى الفترة", "Complaints in the period"),
          amount: String(summary.total),
        },
        {
          id: "today",
          kind: "check",
          label: bilingual("تاريخ القاعدة (مرجع الاشتقاق)", "Database date (the derivation anchor)"),
          amount: summary.today,
        },
      ],
      assertionResults: [complaintsTieResult(summary)],
      notes: [
        bilingual(
          "أعداد فقط — لا يعبر نص الشكوى ولا بيانات العميل إلى الملخص؛ كل محور يجمع إلى إجمالي الفترة (كل شكوى محسوبة مرة واحدة في كل محور)",
          "Counts only — no complaint body or customer data crosses into the summary; every axis sums to the period total (each complaint counted exactly once per axis)",
        ),
      ],
    };
  },
});
