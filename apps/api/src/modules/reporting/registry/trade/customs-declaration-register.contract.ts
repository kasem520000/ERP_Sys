import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, source } from "../kit";
import { reportingServices } from "../services";
import { TRADE_REPORT_VOCABULARIES } from "./trade-queries";

/**
 * PHASE-051 (W-40 — T-15, dated 2026-11-26; REPORT_CATALOG §9's
 * PHASE-051 row 2): `trade.customs-declaration-register` — the customs
 * declarations register as a report contract: one row per declaration
 * over the period, every figure the register's own (the official
 * CUS-{YYYY}-{SEQ:6} number, the 0121 ladder status, the type, the
 * office, the workflow stamps, the linked B/L + PO + landed-cost
 * briefs), with **the line fold's OWN totals rendered from the LINES
 * at every read** — the SAME computeDeclarationTotals fold the G-65
 * completion act rides (never a stored parallel figure — D-06's
 * zero-parallel-computation law). The per-currency amounts are the
 * register's own strings (amounts NOT summed across currencies).
 *
 * The footer carries the vocabulary law as the block-on-fail
 * assertion (`declaration-status-vocabulary`): every row's status
 * sits in the 0121 CHECK's own domain.
 *
 * Permission `trade.customs.view` (matrix §3.29; the §12
 * module-register reuse rule — the same key the /trade/customs reads
 * ride).
 */

const DECLARATION_STATUS_VOCABULARY = assertDecl(
  "declaration-status-vocabulary",
  "Every row's status sits on the 0121 ladder (DRAFT → SUBMITTED → ACCEPTED → COMPLETED | CANCELLED)",
  "قيمة خارج مفردات سجل الإقرارات الجمركية — التصدير محجوب",
  "A value outside the customs declarations register's own status vocabulary — export blocked",
);

function declarationVocabularyResult(
  rows: readonly { status: string; declarationNo: string }[],
): AssertionResult {
  const offenders = rows.filter(
    (row) => !(TRADE_REPORT_VOCABULARIES.declarationStatuses as readonly string[]).includes(row.status),
  );
  const ok = offenders.length === 0;
  return {
    id: "declaration-status-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `إقرارات خارج المفردات: ${offenders.map((row) => row.declarationNo).join("، ")}`,
          `Off-register row(s): ${offenders.map((row) => row.declarationNo).join(", ")}`,
        ),
  };
}

export const tradeCustomsDeclarationRegisterContract = defineReport({
  id: "trade.customs-declaration-register",
  version: 1,
  title: bilingual("سجل الإقرارات الجمركية", "Customs Declarations Register"),
  category: "trade",
  description: bilingual(
    "سجل الإقرارات الجمركية على الفترة: لكل إقرار رقمه الرسمي ونوعه ومكتبه وحالته على سلم 0121 وطوابع سير العمل، مع موجز بوليصة الشحن وأمر الشراء ووثيقة التكاليف الأرضية المرتبطة، وإجماليات السطور (القيمة الجمركية · الرسم · ضريبة الاستيراد · المبلغ الأرضي) مشتقة من سطور الإقرار نفسها عبر طيّ الإكمال نفسه عند كل قراءة — المبالغ بعملة الإقرار ولا تجمع عبر العملات المختلفة",
    "The customs declarations register over the period: per declaration its official number, type, office, 0121-ladder status and workflow stamps, with the linked B/L, PO and landed-cost briefs, and the line totals (customs value · duty · import VAT · the landed amount) derived from the declaration's OWN lines through the same fold the completion act rides at every read — amounts render in the declaration's own currency and are never summed across unlike currencies",
  ),
  parameters: z.object({
    status: z.enum(["DRAFT", "SUBMITTED", "ACCEPTED", "COMPLETED", "CANCELLED"]).optional(),
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "trade.customs.view",
  dataSources: [
    source(
      "trade",
      "TradeReportQueriesService.customsDeclarationRegister (the declarations' own rows + the line fold's own totals via computeDeclarationTotals)",
      ["customs_declarations", "customs_declaration_lines"],
      "سجل الإقرارات الجمركية بإجماليات سطوره الخاصة",
      "The customs declarations register with its own line totals",
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
  assertions: [DECLARATION_STATUS_VOCABULARY],
  drillTargets: [
    drill("declarationId", "/trade/customs", "لوحة الإقرارات الجمركية", "The customs board", "trade.customs.view"),
  ],
  run: async (_ctx, params) => {
    const { tradeQueries } = reportingServices();
    const rows = await tradeQueries.customsDeclarationRegister({
      status: params.status as string | undefined,
      from: params.dateFrom!,
      to: params.dateTo!,
    });
    const completed = rows.filter((row) => row.status === "COMPLETED").length;
    return {
      columns: [
        col("declarationNo", "الإقرار", "Declaration"),
        col("day", "الإنشاء", "Created", "date"),
        col("declarationType", "النوع", "Type", "status"),
        col("customsOffice", "المكتب", "Office"),
        col("status", "الحالة", "Status", "status"),
        col("currency", "العملة", "CCY"),
        col("lines", "السطور", "Lines"),
        moneyCol("totalCustomsValue", "القيمة الجمركية", "Customs value"),
        moneyCol("totalDuty", "الرسم الجمركي", "Duty"),
        moneyCol("totalImportVat", "ضريبة الاستيراد", "Import VAT"),
        moneyCol("totalLandedAmount", "المبلغ الأرضي (رسم+ضريبة)", "Landed (duty+VAT)"),
        col("blNo", "بوليصة الشحن", "B/L"),
        col("poNo", "أمر الشراء", "PO"),
        col("landedCostNo", "التكاليف الأرضية", "Landed cost"),
        col("submittedAt", "التقديم", "Submitted", "date"),
        col("acceptedAt", "القبول", "Accepted", "date"),
        col("completedAt", "الإكمال", "Completed", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.declarationId,
        values: {
          declarationNo: row.declarationNo,
          day: row.day,
          declarationType: row.declarationType,
          customsOffice: row.customsOffice,
          status: row.status,
          currency: row.currency,
          lines: String(row.lines),
          totalCustomsValue: row.totalCustomsValue,
          totalDuty: row.totalDuty,
          totalImportVat: row.totalImportVat,
          totalLandedAmount: row.totalLandedAmount,
          blNo: row.blNo ?? "—",
          poNo: row.poNo ?? "—",
          landedCostNo: row.landedCostNo ?? "—",
          submittedAt: row.submittedAt === null ? "—" : row.submittedAt.slice(0, 10),
          acceptedAt: row.acceptedAt === null ? "—" : row.acceptedAt.slice(0, 10),
          completedAt: row.completedAt === null ? "—" : row.completedAt.slice(0, 10),
        },
      })),
      totals: [
        {
          id: "rows",
          kind: "sum",
          label: bilingual(
            `إقرارات: ${rows.length} · مكتملة: ${completed}`,
            `declarations: ${rows.length} · completed: ${completed}`,
          ),
          amount: String(rows.length),
        },
      ],
      assertionResults: [declarationVocabularyResult(rows)],
      notes: [
        bilingual(
          "الإجماليات مشتقة من سطور الإقرار نفسها عبر computeDeclarationTotals — الطيّ نفسه الذي يركبه فعل الإكمال (G-65) عند كل قراءة، لا رقم مخزّن موازٍ قطّ؛ المبالغ بعملة كل إقرار ولا تُجمع عبر العملات المختلفة (قانون كشف الاحتجاز)؛ المبلغ الأرضي = Σ (الرسم + ضريبة الاستيراد) على 4 منازل",
          "The totals derive from the declaration's OWN lines through computeDeclarationTotals — the same fold the G-65 completion act rides — at every read, never a stored parallel figure; the amounts render in each declaration's own currency and are never summed across unlike currencies; the landed amount = Σ (duty + import VAT) at 4dp",
        ),
      ],
    };
  },
});
