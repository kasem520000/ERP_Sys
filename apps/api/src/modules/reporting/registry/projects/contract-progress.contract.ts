import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import type { AssertionResult } from "../../application/contract";
import { LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";
import type { ProgressCertificateRow } from "../../../crm/infrastructure/contracting.store";

/**
 * PHASE-048 (W-14 — T-17, dated 2026-11-22; REPORT_CATALOG §9's
 * PHASE-048 row 2): `projects.contract-progress` — the W-11 billing
 * engine's own registers as a report contract: one row per progress
 * certificate (the engine's ProgressCertificateRow list verbatim — the
 * BR-092 gross/retention/net pair as the engine derived it, the status
 * vocabulary, the advance applications), and the BR-093 ceiling card's
 * own read (billingState — approvedCertificates · cumulativeGross ·
 * effectiveContractValue · remaining) as the totals block. ZERO
 * parallel computation: nothing is re-summed at the report; the totals
 * are the engine's own outputs.
 *
 * The footer carries BR-092's pair integrity as the block-on-fail
 * assertion (`br-092-pair-integrity`): every rendered row re-checked —
 * net + retention MUST equal the gross on the engine's own strings
 * (exact-decimal compare, the reader's independent re-check — the
 * leave-cap precedent).
 *
 * Permission `projects.contracting.view` (matrix §3.26; the §12
 * module-register reuse rule — the same key the /projects/contracting
 * screen's certificates tab rides).
 */

const BR092_PAIR = assertDecl(
  "br-092-pair-integrity",
  "BR-092: every certificate's net + retention equals its gross (the engine-derived pair, re-checked on the engine's own strings)",
  "مستخلص مجموع احتجازه وصافيه لا يساوي إجماليه (BR-092) — التصدير محجوب",
  "A certificate whose retention + net does not equal its gross (BR-092) — export blocked",
  "BR-092",
);

function br092Result(rows: readonly ProgressCertificateRow[]): AssertionResult {
  const offender = rows.find((row) => addExact(row.netValue, row.retentionAmount) !== row.grossValue);
  return {
    id: "br-092-pair-integrity",
    status: offender === undefined ? "PASS" : "FAIL",
    compared:
      offender === undefined
        ? undefined
        : {
            left: addExact(offender.netValue, offender.retentionAmount),
            right: offender.grossValue,
          },
    detail:
      offender === undefined
        ? undefined
        : bilingual(
            `المستخلص ${offender.certificateNo ?? offender.id}: الصافي + الاحتجاز ≠ الإجمالي — التصدير محجوب`,
            `Certificate ${offender.certificateNo ?? offender.id}: net + retention ≠ gross — export blocked`,
          ),
  };
}

export const projectsContractProgressContract = defineReport({
  id: "projects.contract-progress",
  version: 1,
  title: bilingual("مستخلصات العقد والسقف", "Contract Progress & Ceiling"),
  category: "projects",
  description: bilingual(
    "سجل مستخلصات الإنجاز لمشروع واحد بمخرجات محرك الفوترة كما هي: الصنف والتاريخ والنسبة التراكمية والإجمالي والاحتجاز والصافي (زوج BR-092 الذي اشتقه المحرك) والحالة والمبالغ المسددة من الدفعات — والمجاميع أرقام بطاقة السقف نفسها (BR-093: الإجمالي التراكمي والقيمة الفعلية للعقد والمتبقي)، بلا أي جمع موازٍ",
    "One project's progress-certificate register rendered verbatim from the billing engine: kind, date, cumulative percent, gross, retention, net (the engine-derived BR-092 pair), status and advance applications — with the BR-093 ceiling card's own figures as the totals (cumulative gross, the effective contract value, the remaining), zero parallel computation",
  ),
  parameters: z.object({
    projectId: z.string().uuid(),
    locale: LOCALE,
  }),
  requiredPermission: "projects.contracting.view",
  dataSources: [
    source(
      "projects",
      "ProgressBillingService.list + billingState (the W-11 billing engine's own reads — the certificates register + the BR-093 ceiling card)",
      ["progress_certificates", "retention_accounts", "change_orders"],
      "سجل المستخلصات وبطاقة السقف",
      "The certificates register + the ceiling card",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted", "journal.reversed"],
  },
  assertions: [BR092_PAIR],
  drillTargets: [
    drill("projectId", "/projects/contracting", "شاشة التعاقدات — تبويب المستخلصات", "The contracting screen — the certificates tab", "projects.contracting.view"),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "grossValue", kind: "sum" }],
    sorting: [{ by: "certificateDate", dir: "asc" }],
    zeroSuppression: "none",
  },
  totals: { grandTotals: "none" },
  run: async (_ctx, params) => {
    const { projectsBilling: billing } = reportingServices();
    const projectId = params.projectId as string;
    const rows = await billing.list(projectId);
    const state = await billing.billingState(projectId);

    return {
      columns: [
        col("certificateNo", "رقم المستخلص", "Certificate no."),
        col("certificateDate", "التاريخ", "Date", "date"),
        col("kind", "الصنف", "Kind"),
        qtyCol("cumulativePercent", "النسبة التراكمية", "Cumulative %"),
        moneyCol("grossValue", "الإجمالي", "Gross"),
        moneyCol("retentionAmount", "الاحتجاز", "Retention"),
        moneyCol("netValue", "الصافي", "Net"),
        col("currencyCode", "العملة", "Currency"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("advanceAppliedAmount", "المسدد من الدفعة", "Advance applied"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.id,
        values: {
          certificateNo: row.certificateNo ?? "—",
          certificateDate: row.certificateDate,
          kind: row.kind,
          cumulativePercent: row.cumulativePercent,
          grossValue: row.grossValue,
          retentionAmount: row.retentionAmount,
          netValue: row.netValue,
          currencyCode: row.currencyCode,
          status: row.status,
          advanceAppliedAmount: row.advanceAppliedAmount,
        },
      })),
      // THE CEILING CARD'S OWN READ (BR-093) — never a client-side sum:
      // the engine's approved-gross fold, the effective contract value
      // and the remaining figure exactly as billingState emits them.
      totals: [
        {
          id: "approvedCertificates",
          kind: "sum",
          label: bilingual("عدد المستخلصات المعتمدة", "Approved certificates"),
          amount: state.approvedCertificates.toString(),
        },
        {
          id: "cumulativeGross",
          kind: "sum",
          label: bilingual("الإجمالي التراكمي المعتمد", "Cumulative approved gross"),
          amount: state.cumulativeGross,
        },
        {
          id: "effectiveContractValue",
          kind: "sum",
          label: bilingual("القيمة الفعلية للعقد (مع أوامر التغيير)", "Effective contract value (with change orders)"),
          amount: state.effectiveContractValue ?? "—",
        },
        {
          id: "remaining",
          kind: "sum",
          label: bilingual("المتبقي تحت السقف (BR-093)", "Remaining under the ceiling (BR-093)"),
          amount: state.remaining ?? "—",
        },
      ],
      assertionResults: [br092Result(rows)],
    };
  },
});
