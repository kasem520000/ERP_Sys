import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";
import type { RetentionAccountRow } from "../../../crm/infrastructure/contracting.store";

/**
 * PHASE-048 (W-14 — T-17, dated 2026-11-22; REPORT_CATALOG §9's
 * PHASE-048 row 3): `projects.retention-statement` — the W-11 retention
 * engine's own ledger as a report contract: one row per retention
 * account (the customer register + every subcontractor row — the
 * W-13 screen's own read, rendered verbatim: the contract value, the
 * hold %, the accrued balance, the released amount, the schedule's
 * taking-over/defect-liability gates, the status).
 *
 * THE NO-TOTALS LAW (the W-13 print precedent, carried to the report):
 * the statement renders NO amount totals BY DESIGN — a cross-kind
 * total (customer + subcontractor rows) would be a parallel sum over
 * heterogeneous registers; the only total is the row count. Declared
 * in the description and pinned by the spec.
 *
 * The footer carries the ledger's structural laws as the block-on-fail
 * assertion (`retention-ledger-shape`): the side vocabulary
 * (CUSTOMER/SUBCONTRACTOR only), the status vocabulary
 * (ACTIVE/RELEASED only), and the single-customer-register law (at
 * most one CUSTOMER row per project — the 0103 partial unique's own
 * law, re-checked by the reader).
 *
 * Permission `projects.contracting.view` (matrix §3.26; the §12
 * module-register reuse rule — the same key the /projects/contracting
 * screen's retention tab and the W-13 retention-statement print ride).
 */

const RETENTION_SHAPE = assertDecl(
  "retention-ledger-shape",
  "the ledger's structural laws: sides CUSTOMER/SUBCONTRACTOR only, statuses ACTIVE/RELEASED only, and at most ONE customer register per project (the 0103 partial unique's own law)",
  "سجل احتجاز خارج المفردات أو سجل عميل مزدوج — التصدير محجوب",
  "A retention row outside the vocabulary or a duplicate customer register — export blocked",
  "BR-092",
);

function retentionShapeResult(rows: readonly RetentionAccountRow[]): AssertionResult {
  const sides = new Set(["CUSTOMER", "SUBCONTRACTOR"]);
  const statuses = new Set(["ACTIVE", "RELEASED"]);
  const badVocabulary = rows.find((row) => !sides.has(row.kind) || !statuses.has(row.status));
  const customerRows = rows.filter((row) => row.kind === "CUSTOMER").length;
  const ok = badVocabulary === undefined && customerRows <= 1;
  return {
    id: "retention-ledger-shape",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `صف خارج مفردات السجل أو ${customerRows} سجلات عميل — التصدير محجوب`,
          `A row outside the ledger vocabulary or ${customerRows} customer registers — export blocked`,
        ),
  };
}

export const projectsRetentionStatementContract = defineReport({
  id: "projects.retention-statement",
  version: 1,
  title: bilingual("كشف الاحتجاز", "Retention Statement"),
  category: "projects",
  description: bilingual(
    "دفتر احتجاز مشروع واحد كما يقرؤه المحرك: سجل العميل وكل سجلات الباطن — قيمة العقد ونسبة الاحتجاز والرصيدالمتراكم والمصروف وبوابات الجدول (الاستلام الابتدائي وضمان العيوب) والحالة. لا مجاميع مالية بحسب التصميم: الجمع بين سجل العميل وسجلات الباطن جمع موازٍ عبر أنواع مختلفة — الكشف يحمل عدد الصفوف فقط",
    "One project's retention ledger rendered verbatim from the engine: the customer register + every subcontractor row — the contract value, the hold %, the accrued balance, the released amount, the schedule's gates (taking-over + defect liability), the status. NO amount totals BY DESIGN: summing the customer register with the subcontractor rows would be a cross-kind parallel sum — the statement carries the row count only",
  ),
  parameters: z.object({
    projectId: z.string().uuid(),
    locale: LOCALE,
  }),
  requiredPermission: "projects.contracting.view",
  dataSources: [
    source(
      "projects",
      "RetentionService.ledger (the W-11 retention engine's own whole-ledger read — the customer register + every sub row, the W-13 screen's read)",
      ["retention_accounts", "subcontractor_agreements", "progress_certificates", "subcontractor_certificates"],
      "دفتر الاحتجاز كاملًا",
      "The whole retention ledger",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted", "journal.reversed"],
  },
  assertions: [RETENTION_SHAPE],
  drillTargets: [
    drill("projectId", "/projects/contracting", "شاشة التعاقدات — تبويب الاحتجاز", "The contracting screen — the retention tab", "projects.contracting.view"),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "accruedBalance", kind: "balance" }],
    sorting: [{ by: "kind", dir: "asc" }],
    zeroSuppression: "none",
  },
  totals: { grandTotals: "none" },
  run: async (_ctx, params) => {
    const { projectsRetention: retention } = reportingServices();
    const projectId = params.projectId as string;
    const rows = await retention.ledger(projectId);

    return {
      columns: [
        col("kind", "النوع", "Side", "status"),
        col("agreement", "مرجع العقد", "Agreement ref"),
        moneyCol("contractValue", "قيمة العقد", "Contract value"),
        col("currencyCode", "العملة", "Currency"),
        qtyCol("holdPercent", "نسبة الاحتجاز", "Hold %"),
        moneyCol("accruedBalance", "الرصيد المتراكم", "Accrued balance"),
        moneyCol("releasedAmount", "المصروف", "Released"),
        col("takingOverDate", "الاستلام الابتدائي", "Taking-over", "date"),
        col("defectLiabilityDate", "ضمان العيوب", "Defect liability", "date"),
        col("status", "الحالة", "Status", "status"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.id,
        values: {
          kind: row.kind,
          agreement: row.subcontractorAgreementId ?? "CUSTOMER",
          contractValue: row.contractValue ?? "—",
          currencyCode: row.currencyCode ?? "—",
          holdPercent: row.holdPercent ?? "—",
          accruedBalance: row.accruedBalance,
          releasedAmount: row.releasedAmount,
          takingOverDate: row.takingOverDate ?? "—",
          defectLiabilityDate: row.defectLiabilityDate ?? "—",
          status: row.status,
        },
      })),
      // NO AMOUNT TOTALS BY DESIGN (the W-13 print law — a cross-kind
      // total would be a parallel sum over heterogeneous registers).
      // The count is the statement's only total.
      totals: [
        {
          id: "ledgerRows",
          kind: "sum",
          label: bilingual("عدد سجلات الدفتر", "Ledger rows"),
          amount: rows.length.toString(),
        },
      ],
      assertionResults: [retentionShapeResult(rows)],
      notes: [
        bilingual(
          "الكشف يحمل أرصدة الدفتر كما هي بلا مجاميع: الجمع بين سجل العميل وسجلات الباطن جمع موازٍ عبر أنواع مختلفة — بحسب تصميم الطباعة نفسه",
          "The statement renders the ledger's balances with no totals by design: summing the customer register with the subcontractor rows would be a cross-kind parallel sum — the print pack's own design law",
        ),
      ],
    };
  },
});
