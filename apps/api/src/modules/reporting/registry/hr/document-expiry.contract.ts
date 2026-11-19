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
import { sweepBands } from "../../../hr/domain/talent-math";
import { tenantSweepWindows, type DocumentExpiryRow } from "./hr-queries";

/**
 * PHASE-047 (W-6, T-15 — REPORT_CATALOG §9's PHASE-047 row 4):
 * `hr.document-expiry` — the HR-10 document register's expiry window
 * as a report contract: one row per document with expires_on inside
 * the requested window (≤ today + daysAhead; NULL expiry never
 * ships — the sweep's own law), the days remaining computed in SQL,
 * and the band folded from the TENANT'S configured sweep windows —
 * the same hr_alert_jobs source the hr-expiry-sweep reads (red line
 * 5: DATA, never invented thresholds; the documented 30/7/0 default
 * fires when no row is registered).
 *
 * Amendment A-4's PII law holds structurally: the document NUMBER
 * never enters the projection (never in exports — the payslips
 * precedent); the row ships the employee code + name, the document
 * kind, the issue/expiry dates, the days remaining, and the band.
 *
 * The footer carries the `document-band-vocabulary` block-on-fail
 * assertion: every rendered row's band is one of the tenant's
 * configured thresholds (or the honest BEYOND label — the daysAhead
 * parameter can widen the window past the alert bands), and the
 * already-expired rows land in the TIGHTEST band (its lower edge is
 * open by the sweep's own law).
 *
 * Permission `hr.documents.manage` (matrix §3.25; REPORT_CATALOG §12
 * module-register reuse rule — the register's own permission plane,
 * the same key the /hr/documents routes ride).
 */

const BAND_VOCABULARY = assertDecl(
  "document-band-vocabulary",
  "every row's band is one of the tenant's configured sweep thresholds (or BEYOND) and the expired rows land in the tightest band",
  "نطاق خارج عتبات التنبيه المُعدَّة — التصدير محجوب",
  "A band outside the configured alert thresholds — export blocked",
  "BR-091",
);

function bandVocabularyResult(
  rows: readonly DocumentExpiryRow[],
  bands: readonly { threshold: number }[],
): AssertionResult {
  const vocabulary = new Set<string>([...bands.map((band) => `BAND_${band.threshold}`), "BEYOND"]);
  const offenders = rows.filter((row) => !vocabulary.has(row.band));
  const ok = offenders.length === 0;
  return {
    id: "document-band-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : {
          ar: `${offenders.length} صف بنطاق خارج المفردات — التصدير محجوب`,
          en: `${offenders.length} row(s) with a band outside the vocabulary — export blocked`,
        },
  };
}

export const hrDocumentExpiryContract = defineReport({
  id: "hr.document-expiry",
  version: 1,
  title: bilingual("انتهاء وثائق الموظفين", "Document Expiry"),
  category: "hr",
  description: bilingual(
    "سجل انتهاء وثائق HR-10 داخل نافذة: صف لكل وثيقة تنتهي خلال الأيام المطلوبة — النوع وتاريخي الإصدار والانتهاء والأيام المتبقية ونطاق التنبيه (من عتبات المستأجر المُعدَّة) — رقم الوثيقة لا يُصدَّر أبدًا",
    "The HR-10 document expiry register inside a window: one row per document expiring within the requested days — the kind, the issue/expiry dates, the days remaining, and the alert band (from the tenant's configured thresholds) — the document number never ships",
  ),
  parameters: z.object({
    daysAhead: z.number().int().min(0).max(365).optional().default(30),
    employeeId: z.string().uuid().optional(),
    kind: z
      .enum(["PASSPORT", "IQAMA", "VISA", "CONTRACT", "CERTIFICATE", "OTHER"])
      .optional(),
    locale: LOCALE,
  }),
  requiredPermission: "hr.documents.manage",
  dataSources: [
    source(
      "hr",
      "hrQueries.documentExpiry (the banded expiry walk over the register)",
      ["employee_documents", "employees", "hr_alert_jobs"],
      "المشي المُنطَّق لانتهاء الوثائق",
      "The banded document expiry walk",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: [],
  },
  assertions: [BAND_VOCABULARY],
  drillTargets: [
    drill(
      "employeeId",
      "/hr/org-structure",
      "سجل الوثائق والتنبيهات",
      "The documents & alerts register",
      "hr.documents.manage",
    ),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "daysRemaining", kind: "balance" }],
    sorting: [{ by: "expiresOn", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { grandTotals: "sum" },
  run: async (_ctx, params) => {
    const { hr } = reportingServices();
    const rows = await hr.documentExpiry({
      daysAhead: params.daysAhead as number,
      employeeId: params.employeeId,
      kind: params.kind,
    });
    const bands = sweepBands(await tenantSweepWindows());

    let expiredCount = 0;
    for (const row of rows) {
      if (row.daysRemaining <= 0) expiredCount += 1;
    }

    return {
      columns: [
        col("employee", "الموظف", "Employee"),
        col("kind", "نوع الوثيقة", "Document kind"),
        col("issuedOn", "تاريخ الإصدار", "Issued on"),
        col("expiresOn", "تاريخ الانتهاء", "Expires on"),
        qtyCol("daysRemaining", "الأيام المتبقية", "Days remaining"),
        col("band", "نطاق التنبيه", "Alert band"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.documentId,
        values: {
          employee: `${row.employeeCode} — ${row.employeeName}`,
          kind: row.kind,
          issuedOn: row.issuedOn ?? "—",
          expiresOn: row.expiresOn,
          daysRemaining: row.daysRemaining,
          band: row.band,
        },
      })),
      totals: [
        {
          id: "documentCount",
          kind: "sum",
          label: bilingual("عدد الوثائق", "Document count"),
          amount: rows.length.toString(),
        },
        {
          id: "expiredCount",
          kind: "check",
          label: bilingual("منتهية بالفعل", "Already expired"),
          amount: expiredCount.toString(),
        },
      ],
      assertionResults: [bandVocabularyResult(rows, bands)],
    };
  },
});
