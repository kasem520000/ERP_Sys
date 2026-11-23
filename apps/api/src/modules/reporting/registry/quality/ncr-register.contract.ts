import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-050 (W-30 — T-17, dated 2026-11-23; REPORT_CATALOG §9's
 * PHASE-050 row 1): `quality.ncr-register` — the NCR register as a
 * report contract: one row per non-conformance record over the period,
 * every figure the register's own (the official number, the status on
 * the 0114 ladder, the severity, the source, the affected quantity, the
 * disposition pair), with the item + partner briefs joined for the
 * report plane. The affected quantities are NOT summed (different items
 * carry different units — the retention-statement law: no cross-kind
 * totals; the row count is the register's own total).
 *
 * The footer carries the vocabulary law as the block-on-fail assertion
 * (`ncr-status-vocabulary`): every row's status/severity/source sits in
 * the 0114 CHECK's own domain — a foreign value means the register
 * drifted from its floor and blocks the export.
 *
 * Permission `quality.view` (matrix §3.28; the §12 module-register
 * reuse rule — the same key the /quality/ncr reads ride).
 */

const NCR_STATUSES = ["OPEN", "DISPOSITIONED", "CLOSED"] as const;
const NCR_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const NCR_SOURCES = ["INSPECTION", "PRODUCTION", "COMPLAINT", "SUPPLIER"] as const;

const NCR_STATUS_VOCABULARY = assertDecl(
  "ncr-status-vocabulary",
  "Every row's status sits on the OPEN → DISPOSITIONED → CLOSED ladder and its severity/source sit in the 0114 CHECK's own vocabularies",
  "قيمة خارج مفردات سجل عدم المطابقة (الحالة أو الدرجة أو المصدر) — التصدير محجوب",
  "A value outside the NCR register's own status/severity/source vocabulary — export blocked",
);

function ncrVocabularyResult(
  rows: readonly {
    status: string;
    severity: string;
    source: string;
    ncrNo: string;
  }[],
): AssertionResult {
  const offenders = rows.filter(
    (row) =>
      !(NCR_STATUSES as readonly string[]).includes(row.status) ||
      !(NCR_SEVERITIES as readonly string[]).includes(row.severity) ||
      !(NCR_SOURCES as readonly string[]).includes(row.source),
  );
  const ok = offenders.length === 0;
  return {
    id: "ncr-status-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `سجلات خارج المفردات: ${offenders.map((row) => row.ncrNo).join("، ")}`,
          `Off-register row(s): ${offenders.map((row) => row.ncrNo).join(", ")}`,
        ),
  };
}

export const qualityNcrRegisterContract = defineReport({
  id: "quality.ncr-register",
  version: 1,
  title: bilingual("سجل عدم المطابقات", "NCR Register"),
  category: "quality",
  description: bilingual(
    "سجل سجلات عدم المطابقة على الفترة: لكل سجل رقمه الرسمي وحالته على السلم ودرجته ومصدره والكمية المتأثرة وقرار التصرف، مع الصنف والجهة — الكميات لا تجمع عبر الوحدات المختلفة؛ إجمالي السجل عدد صفوفه",
    "The non-conformance register over the period: per record its official number, its ladder status, severity, source, affected quantity and disposition pair, with the item and partner briefs — quantities are never summed across unlike units; the register's total is its row count",
  ),
  parameters: z.object({
    status: z.enum(NCR_STATUSES).optional(),
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "quality.view",
  dataSources: [
    source(
      "quality",
      "QualityReportQueriesService.ncrRegister (the NCR register's own rows with the item/partner briefs)",
      ["ncr_records", "items", "partners"],
      "سجل عدم المطابقة بأرقامه ومفرداته الخاصة",
      "The NCR register with its own numbers and vocabularies",
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
  assertions: [NCR_STATUS_VOCABULARY],
  drillTargets: [
    drill("ncrId", "/quality/ncr", "سجل عدم المطابقات", "The NCR board", "quality.view"),
  ],
  run: async (_ctx, params) => {
    const { qualityQueries } = reportingServices();
    const locale = params.locale === "en" ? "en" : "ar";
    const rows = await qualityQueries.ncrRegister({
      status: params.status as string | undefined,
      from: params.dateFrom!,
      to: params.dateTo!,
    });
    const openCount = rows.filter((row) => row.status === "OPEN").length;
    return {
      columns: [
        col("ncrNo", "السجل", "NCR"),
        col("day", "اليوم", "Day", "date"),
        col("status", "الحالة", "Status", "status"),
        col("severity", "الدرجة", "Severity", "status"),
        col("source", "المصدر", "Source", "status"),
        col("item", "الصنف", "Item"),
        col("partner", "الجهة", "Partner"),
        col("problem", "المشكلة", "Problem"),
        qtyCol("affectedQty", "الكمية المتأثرة", "Affected qty"),
        col("disposition", "التصرف", "Disposition", "status"),
        col("closedAt", "الإغلاق", "Closed", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.ncrId,
        values: {
          ncrNo: row.ncrNo,
          day: row.day,
          status: row.status,
          severity: row.severity,
          source: row.source,
          item:
            locale === "ar"
              ? `${row.itemSku} · ${row.itemNameAr ?? row.itemName}`
              : `${row.itemSku} · ${row.itemName}`,
          partner:
            row.partnerName === null
              ? "—"
              : locale === "ar"
                ? (row.partnerNameAr ?? row.partnerName)
                : row.partnerName,
          problem: row.problem,
          affectedQty: row.affectedQty,
          disposition: row.disposition ?? "—",
          closedAt: row.closedAt === null ? "—" : row.closedAt.slice(0, 10),
        },
      })),
      totals: [
        {
          id: "rows",
          kind: "sum",
          label: bilingual(`سجلات: ${rows.length} · مفتوحة: ${openCount}`, `records: ${rows.length} · open: ${openCount}`),
          amount: String(rows.length),
        },
      ],
      assertionResults: [ncrVocabularyResult(rows)],
      notes: [
        bilingual(
          "الكميات المتأثرة تُعرض بأرقام السجل نفسها ولا تُجمع (أصناف مختلفة بوحدات مختلفة — قانون كشف الاحتجاز)؛ السلم مفتوح ← مصرَّف ← مغلق وقرار التصرف يهبط مع سلّم 0114 نفسه",
          "The affected quantities render as the register's own strings and are never summed (different items carry different units — the retention-statement law); the ladder is OPEN → DISPOSITIONED → CLOSED with the disposition pair riding the 0114 ladder itself",
        ),
      ],
    };
  },
});
