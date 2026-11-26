import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, source } from "../kit";
import { reportingServices } from "../services";
import { TRADE_REPORT_VOCABULARIES } from "./trade-queries";

/**
 * PHASE-051 (W-40 — T-15, dated 2026-11-26; REPORT_CATALOG §9's
 * PHASE-051 row 4): `trade.duty-drawback-status` — the drawback claims
 * register as a report contract: one row per claim over the period,
 * every figure the register's own (the official DBK-{YYYY}-{SEQ:6}
 * number, the 0121 ladder status, the claimed amount in the claim's
 * own currency, the workflow stamps), with the export evidence's own
 * briefs (the linked declaration's own number · the linked B/L's own
 * number — the honest dash when absent; the 0121 CHECK's own floor
 * means a non-DRAFT row always carries one).
 *
 * The footer carries the vocabulary law as the block-on-fail
 * assertion (`drawback-status-vocabulary`): every row's status sits
 * in the 0121 CHECK's own domain.
 *
 * The honest no-GL shape (D-12) is the register's own: the claim is
 * a registry record, the refund lands when treasury records it — the
 * claimed amounts are NOT summed across currencies (the
 * retention-statement law extended to FX).
 *
 * Permission `trade.view` (matrix §3.29; the §12 module-register
 * reuse rule — the same key the /trade/drawback reads ride).
 */

const DRAWBACK_STATUS_VOCABULARY = assertDecl(
  "drawback-status-vocabulary",
  "Every row's status sits on the 0121 ladder (DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED | PAID)",
  "قيمة خارج مفردات سجل طلبات استرداد الرسوم — التصدير محجوب",
  "A value outside the drawback claims register's own status vocabulary — export blocked",
);

function drawbackVocabularyResult(
  rows: readonly { status: string; claimNo: string }[],
): AssertionResult {
  const offenders = rows.filter(
    (row) => !(TRADE_REPORT_VOCABULARIES.drawbackStatuses as readonly string[]).includes(row.status),
  );
  const ok = offenders.length === 0;
  return {
    id: "drawback-status-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `طلبات خارج المفردات: ${offenders.map((row) => row.claimNo).join("، ")}`,
          `Off-register row(s): ${offenders.map((row) => row.claimNo).join(", ")}`,
        ),
  };
}

export const tradeDutyDrawbackStatusContract = defineReport({
  id: "trade.duty-drawback-status",
  version: 1,
  title: bilingual("حالة طلبات استرداد الرسوم", "Duty Drawback Status"),
  category: "trade",
  description: bilingual(
    "سجل طلبات استرداد الرسوم الجمركية على الفترة: لكل طلب رقمه الرسمي وحالته على سلم 0121 والمبلغ المطالب به بعملته وطوابع سير العمل، مع موجز أدلة التصدير المرتبطة (رقم الإقرار التصديري · رقم بوليصة الشحن) — الشرطة الصادقة عند غياب الدليل؛ المبالغ لا تجمع عبر العملات المختلفة (الشكل بلا قيود محاسبية — القيد سجل، والاسترداد مالًا يهبط عند تسجيل الخزينة له)",
    "The duty drawback claims register over the period: per claim its official number, 0121-ladder status, claimed amount in its own currency and workflow stamps, with the linked export evidence briefs (the export declaration's number · the B/L's number) — the honest dash when absent; amounts are never summed across unlike currencies (the no-GL shape — the claim is a registry record, the refund lands when treasury records it)",
  ),
  parameters: z.object({
    status: z.enum(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "PAID"]).optional(),
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "trade.view",
  dataSources: [
    source(
      "trade",
      "TradeReportQueriesService.dutyDrawbackStatus (the claims register's own rows + the export evidence's own briefs)",
      ["duty_drawback_claims", "customs_declarations", "bills_of_lading"],
      "سجل طلبات الاسترداد بأرقامه ومفرداته الخاصة",
      "The drawback claims register with its own numbers and vocabularies",
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
  assertions: [DRAWBACK_STATUS_VOCABULARY],
  drillTargets: [
    drill("claimId", "/trade/shipments", "لوحة الشحنات", "The shipments board", "trade.shipments.view"),
  ],
  run: async (_ctx, params) => {
    const { tradeQueries } = reportingServices();
    const rows = await tradeQueries.dutyDrawbackStatus({
      status: params.status as string | undefined,
      from: params.dateFrom!,
      to: params.dateTo!,
    });
    const approved = rows.filter((row) => row.status === "APPROVED").length;
    const paid = rows.filter((row) => row.status === "PAID").length;
    const pending = rows.filter((row) => row.status === "SUBMITTED" || row.status === "UNDER_REVIEW").length;
    return {
      columns: [
        col("claimNo", "الطلب", "Claim"),
        col("day", "الإنشاء", "Created", "date"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("claimedAmount", "المبلغ المطالب", "Claimed amount"),
        col("currency", "العملة", "CCY"),
        col("exportDeclarationNo", "الإقرار التصديري", "Export declaration"),
        col("exportBlNo", "بوليصة التصدير", "Export B/L"),
        col("submittedAt", "التقديم", "Submitted", "date"),
        col("decidedAt", "القرار", "Decided", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.claimId,
        values: {
          claimNo: row.claimNo,
          day: row.day,
          status: row.status,
          claimedAmount: row.claimedAmount,
          currency: row.currency,
          exportDeclarationNo: row.exportDeclarationNo ?? "—",
          exportBlNo: row.exportBlNo ?? "—",
          submittedAt: row.submittedAt === null ? "—" : row.submittedAt.slice(0, 10),
          decidedAt: row.decidedAt === null ? "—" : row.decidedAt.slice(0, 10),
        },
      })),
      totals: [
        {
          id: "rows",
          kind: "sum",
          label: bilingual(
            `طلبات: ${rows.length} · قيد المراجعة: ${pending} · معتمدة: ${approved} · مدفوعة: ${paid}`,
            `claims: ${rows.length} · in review: ${pending} · approved: ${approved} · paid: ${paid}`,
          ),
          amount: String(rows.length),
        },
      ],
      assertionResults: [drawbackVocabularyResult(rows)],
      notes: [
        bilingual(
          "المبالغ المطالب بها تُعرض بأرقام السجل نفسها بعملة كل طلب ولا تُجمع عبر العملات المختلفة؛ الطلب سجل لا وثيقة قيود (الشكل بلا قيود محاسبية — D-12): الاسترداد المالي يهبط عندما تسجّله الخزينة (سطح 053)؛ بوابة دليل التصدير (BR-108) قانون الخدمة نفسها وقاعدة 0121 أرضيتها",
          "The claimed amounts render as the register's own strings in each claim's own currency and are never summed across unlike currencies; the claim is a registry record, not a ledger document (the honest no-GL shape — D-12): the money refund lands when treasury records it (053's surface); the export-evidence gate (BR-108) is the service's own law and the 0121 CHECK's own floor",
        ),
      ],
    };
  },
});
