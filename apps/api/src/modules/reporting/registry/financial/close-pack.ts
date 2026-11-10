import { z } from "zod";

import type { ReportContent, ReportParams } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { trialBalanceContract, incomeStatementContract, balanceSheetContract, cashFlowContract } from "./statements";

/**
 * PHASE-013 · the fiscal-close pack (REPORT_CATALOG §1
 * `financial.fiscal-close-pack`): renders TB + IS + BS + CF for a locked
 * fiscal period as one archive-class job (PDF/A-2b per
 * PRINTING_AND_EXPORT §3) — the heavy execution-class showcase: a pg-boss
 * job with progress stages, idempotent per params_hash.
 */
export const fiscalClosePackContract = defineReport({
  id: "financial.fiscal-close-pack",
  version: 1,
  title: bilingual("حزمة إقفال الفترة", "Period Close Pack"),
  category: "financial",
  description: bilingual(
    "ميزان المراجعة وقوائم الدخل والمركز المالي والتدفقات لفترة مقفلة في حزمة واحدة",
    "TB + IS + BS + CF for a locked fiscal period as one archive pack",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    asOf: z.string().nullish(),
    locale: LOCALE,
  }),
  requiredPermission: "reports.financial.close.read",
  dataSources: [
    source(
      "accounting",
      "statementQueries.{trialBalance,incomeStatement,balanceSheet,cashFlow}",
      ["journal_entries", "journal_lines", "accounts", "account_purposes"],
      "القوائم المالية الأربع للفترة",
      "The four financial statements for the period",
    ),
  ],
  scopeRules: { branches: "fixed-all", asOf: "optional" },
  aggregation: {
    groupBy: ["statement"],
    measures: [{ id: "amount", kind: "sum" }],
    sorting: [],
    zeroSuppression: "none",
  },
  totals: { grandTotals: "none", subTotalsByGroup: true },
  executionClass: "job",
  exportFormats: ["pdf", "xlsx"],
  freshness: { semantics: "as-of", cacheTtlSeconds: 86400 },
  assertions: [
    assertDecl(
      "tb-debits-equal-credits",
      "pack TB balances",
      "ميزان المراجعة في الحزمة غير متوازن",
      "The pack's trial balance is unbalanced",
      "INV-001",
    ),
    assertDecl(
      "bs-current-year-once",
      "pack BS current-year counted once",
      "نتيجة السنة الجارية في الحزمة غير سليمة",
      "The pack's current-year result is incorrect",
    ),
  ],
  run: async (_ctx, params): Promise<ReportContent> => {
    // Renders by composing the four statement derivations; the executor's
    // job path wraps this with progress stages + archive-class PDF/A.
    const subParams: ReportParams = {
      ...params,
      asOfDate: params.dateTo,
      comparative: "none",
      grouping: "account-type",
      includeOpening: true,
    };
    const parts = await Promise.all([
      trialBalanceContract.run(_ctx, subParams),
      incomeStatementContract.run(_ctx, subParams),
      balanceSheetContract.run(_ctx, subParams),
      cashFlowContract.run(_ctx, subParams),
    ]);
    const [tb, is, bs, cf] = parts;
    const rows: ReportContent["rows"][number][] = [];
    const push = (groupKey: string, line: string, lineAr: string, amount: string) => {
      rows.push({
        key: `${groupKey}:${rows.length}`,
        groupKey,
        values: { line, accountName: lineAr, amount },
      });
    };
    push("tb", "Trial balance debit", "مدين ميزان المراجعة", tb.totals[0]?.amount ?? "0.0000");
    push("tb", "Trial balance credit", "دائن ميزان المراجعة", tb.totals[1]?.amount ?? "0.0000");
    push("is", "Net income", "صافي الدخل", is.totals.find((t) => t.id === "netIncome")?.amount ?? "0.0000");
    push("bs", "Total assets", "إجمالي الأصول", bs.totals.find((t) => t.id === "totalAssets")?.amount ?? "0.0000");
    push("bs", "Total equity", "إجمالي حقوق الملكية", bs.totals.find((t) => t.id === "totalEquity")?.amount ?? "0.0000");
    push("cf", "Net change in cash", "صافي التغير في النقدية", cf.totals.find((t) => t.id === "computedChange")?.amount ?? "0.0000");
    return {
      columns: [
        col("line", "البند", "Line"),
        col("accountName", "الوصف", "Description"),
        moneyCol("amount", "المبلغ", "Amount"),
      ],
      groups: [
        { key: "tb", label: bilingual("ميزان المراجعة", "Trial Balance") },
        { key: "is", label: bilingual("قائمة الدخل", "Income Statement") },
        { key: "bs", label: bilingual("قائمة المركز المالي", "Balance Sheet") },
        { key: "cf", label: bilingual("قائمة التدفقات", "Cash Flow") },
      ],
      rows,
      totals: [],
      assertionResults: [...tb.assertionResults, ...bs.assertionResults, ...cf.assertionResults],
      notes: [
        bilingual(
          "حزمة أرشيفية — تُصدَّر بصيغة PDF/A-2b",
          "Archive pack — exported as PDF/A-2b",
        ),
      ],
    };
  },
});
