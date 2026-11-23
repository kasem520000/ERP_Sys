import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-050 (W-30 — T-17, dated 2026-11-23; REPORT_CATALOG §9's
 * PHASE-050 row 2): `quality.capa-status` — the CAPA status report: one
 * row per corrective/preventive action record over the period, every
 * figure the register's own (the official number, the ladder status, the
 * NCR link, the due date, the root-cause stamp, the actions array's own
 * counts, the external cost, the close stamp) PLUS the BR-103 gate's own
 * verdict figures — the pending-actions count and the effectiveness
 * check's recorded state, derived through the SAME pure fold the close
 * act rides (capaCloseGate), against the DATABASE'S OWN CURRENT_DATE
 * (the derived-step clock law — no JavaScript clock in the path).
 *
 * The footer carries the closure law as the block-on-fail assertion
 * (`capa-closure-shape`): every CLOSED row carries its recorded
 * effectiveness check and its close stamp (the 0114 floor re-checked by
 * the reader) — a closed record without its check is a shape violation
 * and blocks the export.
 *
 * Permission `quality.view` (matrix §3.28; the §12 module-register
 * reuse rule — the same key the /quality/capa reads ride).
 */

const CAPA_STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;

/** The recorded-stamp cell (bilingual, registry-bilingual — no literals
 * leak across locales). */
function yesLabel(locale: "ar" | "en"): string {
  return locale === "ar" ? "مسجَّل" : "recorded";
}

const CAPA_CLOSURE_SHAPE = assertDecl(
  "capa-closure-shape",
  "Every CLOSED row carries its recorded effectiveness check and its close stamp (BR-103's own floor re-checked at render time)",
  "سجل CAPA مغلق بلا فحص فعالية أو ختم إغلاق — التصدير محجوب",
  "A closed CAPA record without its effectiveness check or close stamp — export blocked",
  "BR-103",
);

function capaClosureResult(
  rows: readonly {
    capaNo: string;
    status: string;
    effectivenessRecorded: boolean;
    closedAt: string | null;
  }[],
): AssertionResult {
  const offenders = rows.filter(
    (row) => row.status === "CLOSED" && (!row.effectivenessRecorded || row.closedAt === null),
  );
  const ok = offenders.length === 0;
  return {
    id: "capa-closure-shape",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `سجلات مغلقة ناقصة: ${offenders.map((row) => row.capaNo).join("، ")}`,
          `Incompletely closed record(s): ${offenders.map((row) => row.capaNo).join(", ")}`,
        ),
  };
}

export const qualityCapaStatusContract = defineReport({
  id: "quality.capa-status",
  version: 1,
  title: bilingual("حالة سجلات CAPA", "CAPA Status"),
  category: "quality",
  description: bilingual(
    "تقرير حالة الإجراءات التصحيحية والوقائية على الفترة: لكل سجل رقمه وحالته ورابط عدم المطابقة وتاريخ الاستحقاق وختم تحليل الجذر، مع عدد الإجراءات الكلي والمفتوح والمعلق (أرقام بوابة BR-103 نفسها — الطية التي يركبها فعل الإغلاق) وفحص الفعالية والتكلفة الخارجية",
    "The corrective/preventive action status report over the period: per record its number, status, NCR link, due date and root-cause stamp, with the total/open/pending action counts (BR-103's own gate figures — the same fold the close act rides), the effectiveness check and the external cost",
  ),
  parameters: z.object({
    status: z.enum(CAPA_STATUSES).optional(),
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "quality.view",
  dataSources: [
    source(
      "quality",
      "QualityReportQueriesService.capaStatus (the CAPA register's own rows + the BR-103 gate's own verdict figures through the capaCloseGate fold, derived against the database's CURRENT_DATE)",
      ["capa_records", "ncr_records"],
      "سجل CAPA بأرقامه وأرقام بوابة BR-103 نفسها",
      "The CAPA register with its own figures and BR-103's own gate numbers",
    ),
  ],
  scopeRules: { dateRange: "required", asOf: "forbidden", branches: "optional" },
  aggregation: {
    groupBy: [],
    measures: [{ id: "rows", kind: "count" }],
    sorting: [{ by: "day", dir: "desc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "none", subTotalsByGroup: false },
  freshness: { semantics: "current", cacheTtlSeconds: 300, invalidationEvents: [] },
  assertions: [CAPA_CLOSURE_SHAPE],
  drillTargets: [drill("capaId", "/quality/capa", "لوحة CAPA", "The CAPA board", "quality.view")],
  run: async (_ctx, params) => {
    const { qualityQueries } = reportingServices();
    const locale = params.locale === "en" ? "en" : "ar";
    const { rows } = await qualityQueries.capaStatus({
      status: params.status as string | undefined,
      from: params.dateFrom!,
      to: params.dateTo!,
    });
    const openCount = rows.filter((row) => row.status !== "CLOSED").length;
    const pendingTotal = rows.reduce((sum, row) => sum + row.pendingActions, 0);
    return {
      columns: [
        col("capaNo", "السجل", "CAPA"),
        col("title", "العنوان", "Title"),
        col("status", "الحالة", "Status", "status"),
        col("ncrNo", "عدم المطابقة", "NCR"),
        col("dueDate", "الاستحقاق", "Due", "date"),
        col("rootCause", "تحليل الجذر", "Root cause"),
        col("actions", "الإجراءات (كلٍ/مفتوح/معلق)", "Actions (total/open/pending)"),
        col("effectiveness", "فحص الفعالية", "Effectiveness"),
        moneyCol("externalCost", "التكلفة الخارجية", "External cost"),
        col("closedAt", "الإغلاق", "Closed", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.capaId,
        values: {
          capaNo: row.capaNo,
          title: row.title,
          status: row.status,
          ncrNo: row.ncrNo ?? "—",
          dueDate: row.dueDate ?? "—",
          rootCause: row.rootCauseRecorded ? yesLabel(locale) : "—",
          actions: `${row.actionsTotal}/${row.openActions}/${row.pendingActions}`,
          effectiveness: row.effectivenessRecorded
            ? row.effectivenessEffective === null
              ? yesLabel(locale)
              : row.effectivenessEffective
                ? locale === "ar"
                  ? "فعّال"
                  : "effective"
                : locale === "ar"
                  ? "غير فعّال"
                  : "not effective"
            : "—",
          externalCost: row.externalCost,
          closedAt: row.closedAt === null ? "—" : row.closedAt.slice(0, 10),
        },
      })),
      totals: [
        {
          id: "rows",
          kind: "sum",
          label: bilingual(
            `سجلات: ${rows.length} · غير مغلقة: ${openCount} · إجراءات معلقة: ${pendingTotal}`,
            `records: ${rows.length} · not closed: ${openCount} · pending actions: ${pendingTotal}`,
          ),
          amount: String(rows.length),
        },
      ],
      assertionResults: [capaClosureResult(rows)],
      notes: [
        bilingual(
          "أرقام الإجراءات المعلقة هي مخرجات طية بوابة BR-103 نفسها (الإجراء المفتوح غير المؤرخ أو المؤرخ مستقبلًا) مشتقة على تاريخ القاعدة نفسه الذي يركب فعل الإغلاق — لا إعادة حساب موازية",
          "The pending-action figures are the BR-103 gate fold's own outputs (an undated open action or a future-dated one), derived against the same database date the close act rides — zero parallel computation",
        ),
      ],
    };
  },
});
