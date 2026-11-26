import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, source } from "../kit";
import { reportingServices } from "../services";
import { TRADE_REPORT_VOCABULARIES } from "./trade-queries";

/**
 * PHASE-051 (W-40 — T-15, dated 2026-11-26; REPORT_CATALOG §9's
 * PHASE-051 row 1): `trade.lc-register` — the letters-of-credit
 * register as a report contract: one row per LC issued over the
 * period, every figure the register's own (the official number, the
 * 0119 ladder status, the currency, the amount, the margin deposit,
 * the issuing bank, the beneficiary, the PO brief), with the expiry
 * horizon derived on the DATABASE'S OWN CURRENT_DATE and classified
 * through THE SWEEP'S OWN BAND FOLD (the same effective windows the
 * sweep's alerting pass rides — never running the sweep) plus the
 * checklist's own open-discrepancy count and the amendments count.
 *
 * The amounts are the register's own strings (per-currency — the
 * register carries its own currency column; amounts are NOT summed
 * across currencies, the retention-statement law extended to FX).
 *
 * The footer carries the vocabulary law as the block-on-fail
 * assertion (`lc-status-vocabulary`): every row's status sits in the
 * 0119 CHECK's own domain — a foreign value means the register
 * drifted from its floor and blocks the export.
 *
 * Permission `trade.lc.view` (matrix §3.29; the §12 module-register
 * reuse rule — the same key the /trade/lc reads ride).
 */

const LC_STATUS_VOCABULARY = assertDecl(
  "lc-status-vocabulary",
  "Every row's status sits on the 0119 ladder (DRAFT → ISSUED → RETIRED | EXPIRED | CANCELLED)",
  "قيمة خارج مفردات سجل الاعتمادات المستندية — التصدير محجوب",
  "A value outside the LC register's own status vocabulary — export blocked",
);

function lcVocabularyResult(
  rows: readonly { status: string; lcNo: string }[],
): AssertionResult {
  const offenders = rows.filter(
    (row) => !(TRADE_REPORT_VOCABULARIES.lcStatuses as readonly string[]).includes(row.status),
  );
  const ok = offenders.length === 0;
  return {
    id: "lc-status-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `سجلات خارج المفردات: ${offenders.map((row) => row.lcNo).join("، ")}`,
          `Off-register row(s): ${offenders.map((row) => row.lcNo).join(", ")}`,
        ),
  };
}

export const tradeLcRegisterContract = defineReport({
  id: "trade.lc-register",
  version: 1,
  title: bilingual("سجل الاعتمادات المستندية", "LC Register"),
  category: "trade",
  description: bilingual(
    "سجل الاعتمادات المستندية الصادرة على الفترة: لكل اعتماد رقمه الرسمي وحالته على سلم 0119 وعملته ومبلغه وهامش الوديعة والبنك المصدر والمستفيد وأمر الشراء المرتبط، مع أفق الانتهاء مشتقًّا على تاريخ قاعدة البيانات ومصنَّفًا بطيّ التنبيه نفسه الذي يركبه الكنس — المبالغ لا تجمع عبر العملات المختلفة؛ إجمالي السجل عدد صفوفه",
    "The letters-of-credit register over the period: per LC its official number, its 0119-ladder status, currency, amount, margin deposit, issuing bank, beneficiary and linked PO, with the expiry horizon derived on the database's own date and classified by the same band fold the sweep rides — amounts are never summed across unlike currencies; the register's total is its row count",
  ),
  parameters: z.object({
    status: z.enum(["DRAFT", "ISSUED", "RETIRED", "EXPIRED", "CANCELLED"]).optional(),
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "trade.lc.view",
  dataSources: [
    source(
      "trade",
      "TradeReportQueriesService.lcRegister (the LC register's own rows + the sweep's own band fold + the checklist's own discrepancy count)",
      ["letters_of_credit", "lc_amendments", "lc_documents"],
      "سجل الاعتمادات المستندية بأرقامه ومفرداته الخاصة",
      "The LC register with its own numbers and vocabularies",
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
  assertions: [LC_STATUS_VOCABULARY],
  drillTargets: [
    drill("lcId", "/trade/lc", "لوحة الاعتمادات", "The LC board", "trade.lc.view"),
  ],
  run: async (_ctx, params) => {
    const { tradeQueries } = reportingServices();
    const { rows } = await tradeQueries.lcRegister({
      status: params.status as string | undefined,
      from: params.dateFrom!,
      to: params.dateTo!,
    });
    const issued = rows.filter((row) => row.status === "ISSUED").length;
    const inBand = rows.filter((row) => row.bandThreshold !== null).length;
    return {
      columns: [
        col("lcNo", "الاعتماد", "LC"),
        col("day", "الإصدار", "Issued", "date"),
        col("status", "الحالة", "Status", "status"),
        col("currency", "العملة", "CCY"),
        moneyCol("amount", "المبلغ", "Amount"),
        moneyCol("marginAmount", "هامش الوديعة", "Margin"),
        col("issuingBank", "البنك المصدر", "Issuing bank"),
        col("beneficiaryName", "المستفيد", "Beneficiary"),
        col("poNo", "أمر الشراء", "PO"),
        col("expiryDate", "الانتهاء", "Expiry", "date"),
        col("daysToExpiry", "الأيام للانتهاء", "Days left"),
        col("band", "نطاق التنبيه", "Alert band", "status"),
        col("openDiscrepancies", "تعارضات مفتوحة", "Open discrepancies"),
        col("amendments", "التعديلات", "Amendments"),
        col("settledAt", "التسوية", "Settled", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.lcId,
        values: {
          lcNo: row.lcNo,
          day: row.day,
          status: row.status,
          currency: row.currency,
          amount: row.amount,
          marginAmount: row.marginAmount,
          issuingBank: row.issuingBank,
          beneficiaryName: row.beneficiaryName,
          poNo: row.poNo ?? "—",
          expiryDate: row.expiryDate,
          daysToExpiry: String(row.daysToExpiry),
          band:
            row.bandThreshold === null
              ? "—"
              : row.daysToExpiry < 0
                ? `≤${row.bandThreshold} (منتهٍ)`
                : `≤${row.bandThreshold}`,
          openDiscrepancies: String(row.openDiscrepancies),
          amendments: String(row.amendments),
          settledAt: row.settledAt === null ? "—" : row.settledAt.slice(0, 10),
        },
      })),
      totals: [
        {
          id: "rows",
          kind: "sum",
          label: bilingual(
            `اعتمادات: ${rows.length} · قائمة: ${issued} · داخل نطاقات التنبيه: ${inBand}`,
            `LCs: ${rows.length} · issued: ${issued} · in alert bands: ${inBand}`,
          ),
          amount: String(rows.length),
        },
      ],
      assertionResults: [lcVocabularyResult(rows)],
      notes: [
        bilingual(
          "المبالغ تُعرض بأرقام السجل نفسها بعملة كل اعتماد ولا تُجمع عبر العملات المختلفة (قانون كشف الاحتجاز)؛ نطاق التنبيه مشتق بطيّ الكنس نفسه (الإطارات الفعّالة المخزنة ∪ الافتراضي الموثق) دون تشغيل الكنس — التقرير ليس فعل التنبيه؛ الأيام للانتهاء مشتقة على CURRENT_DATE الخاصة بقاعدة البيانات",
          "The amounts render as the register's own strings in each LC's own currency and are never summed across unlike currencies; the alert band derives through the sweep's own fold (the stored effective windows ∪ the documented default) without ever running the sweep — a report is never the alerting act; the days-to-expiry derive on the database's own CURRENT_DATE",
        ),
      ],
    };
  },
});
