import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-034 T8 · `consolidation.eliminations-log` (REPORT_CATALOG §10 row
 * 4): the eliminations log — the parent's elimination documents (DRAFT +
 * POSTED incl. reversal counter-entries, BR-056) with the journal-chain
 * provenance; drills ONLY to journals in the parent's consolidation books.
 *
 * The footer carries the `eliminations-journal-tie` block-on-fail
 * assertion: every POSTED elimination carries ≥1 journal entry id (the
 * INV-006 source chain) and is balanced (DR == CR — the G-32 shape);
 * DRAFT rows render with their live balance preview. Tolerance 0.
 *
 * Permission `consolidation.reports.view`. Deterministic over (group,
 * period). XLSX/CSV exports (the catalog row's formats).
 */

const ELIMINATIONS_JOURNAL_TIE = assertDecl(
  "eliminations-journal-tie",
  "every POSTED elimination has ≥1 journal entry (INV-006 chain) and DR == CR (G-32)",
  "قيود استبعاد مرحلة بلا قيد يومية مرتبط أو غير متوازنة (سلسلة INV-006 / شكل G-32)",
  "Posted eliminations missing a linked journal entry or unbalanced (INV-006 chain / G-32 shape)",
  "INV-006",
);

const BR056_REVERSAL_NOTE = bilingual(
  "التصحيحات بقيد عكسي فقط (BR-056): كل قيد عكسي مستند جديد DRAFT→POSTED مرتبط عبر reversal_of — الأصل يبقى مرحلاً وغير قابل للتعديل (INV-003)",
  "Corrections are reversal-only counter-entries (BR-056): each reversal is a NEW DRAFT→POSTED document linked through reversal_of — the original stays POSTED and immutable (INV-003)",
);

const G32_SHAPE_NOTE = bilingual(
  "شكل G-32: قيد الاستبعاد بين الشركات — مدين AP_CONTROL (الشركة ب) ودائن AR_CONTROL (الشركة أ) — يُرحّل في دفاتر التوحيد للشركة الأم فقط؛ بنود الاستثمار/حقوق الملكية عبر غرض CONSOLIDATION_ADJUSTMENT",
  "The G-32 shape: the intercompany elimination — DR AP_CONTROL (entity B) · CR AR_CONTROL (entity A) — posts in the PARENT's consolidation books only; investment/equity lines ride the CONSOLIDATION_ADJUSTMENT purpose",
);

function eliminationsTieResult(input: {
  journalChainBroken: string[];
  unbalanced: string[];
  postedCount: number;
}): AssertionResult {
  const ok = input.journalChainBroken.length === 0 && input.unbalanced.length === 0;
  return {
    id: "eliminations-journal-tie",
    status: ok ? "PASS" : "FAIL",
    compared: {
      left: String(input.postedCount),
      right: String(input.postedCount - input.journalChainBroken.length - input.unbalanced.length),
    },
    detail: ok
      ? undefined
      : {
          ar: `قيود بلا سلسلة يومية: ${input.journalChainBroken.join("، ") || "لا شيء"} — غير متوازنة: ${input.unbalanced.join("، ") || "لا شيء"}`,
          en: `Missing journal chain: ${input.journalChainBroken.join(", ") || "none"} — unbalanced: ${input.unbalanced.join(", ") || "none"}`,
        },
  };
}

export const consolidationEliminationsLogContract = defineReport({
  id: "consolidation.eliminations-log",
  version: 1,
  title: bilingual("سجل قيود الاستبعاد", "Eliminations Log"),
  category: "financial",
  description: bilingual(
    "سجل قيود الاستبعاد: مستندات الاستبعاد (مسودة ومرحّلة بما فيها القيود العكسية) مع سلسلة قيود اليومية في دفاتر التوحيد للشركة الأم — يحمل مطابقة eliminations-journal-tie التي تمنع التصدير عند الفشل",
    "The eliminations log: the elimination documents (DRAFT + POSTED incl. reversal counter-entries) with the journal-chain provenance into the parent's consolidation books — carrying the eliminations-journal-tie check that blocks exports on failure",
  ),
  parameters: z.object({
    groupId: z.string().uuid(),
    fiscalPeriodId: z.string().uuid(),
    asOf: ISO_DATE.optional(),
    status: z.enum(["DRAFT", "POSTED"]).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "consolidation.reports.view",
  dataSources: [
    source(
      "consolidation",
      "consolidationQueries.eliminationsLog (the parent's elimination documents + journal provenance)",
      ["elimination_entries", "consolidation_runs"],
      "مستندات الاستبعاد وسلسلة قيود اليومية في دفاتر الشركة الأم",
      "The elimination documents + the journal chain in the parent's books",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "optional", branches: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [{ id: "debitTotal", kind: "sum" }, { id: "creditTotal", kind: "sum" }],
    sorting: [{ by: "createdAt", dir: "asc" }],
    zeroSuppression: "none",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["consolidation.elimination.posted"],
  },
  assertions: [ELIMINATIONS_JOURNAL_TIE],
  drillTargets: [
    {
      from: "eliminationNo",
      route: "/accounting/journals?source=consolidation_elimination&sourceId={eliminationId}",
      label: bilingual("قيد اليومية المرتبط (دفاتر الشركة الأم)", "The linked journal entry (parent's books)"),
      permission: "consolidation.eliminations.create",
    },
  ],
  exportFormats: ["xlsx", "csv"],
  printTemplate: "a4-report",
  run: async (_ctx, params) => {
    const { consolidation } = reportingServices();
    const rows = await consolidation.eliminationsLog({
      groupId: params.groupId,
      fiscalPeriodId: params.fiscalPeriodId,
    });
    const filtered = params.status === undefined ? rows : rows.filter((row) => row.status === params.status);
    const tie = await consolidation.eliminationsTie({
      groupId: params.groupId,
      fiscalPeriodId: params.fiscalPeriodId,
    });
    let postedDebit = "0.0000";
    for (const row of filtered) {
      if (row.status === "POSTED") {
        postedDebit = addExact(postedDebit, row.debitTotal);
      }
    }
    return {
      columns: [
        col("eliminationNo", "رقم الاستبعاد", "Elimination no", "text"),
        col("kind", "النوع", "Kind", "status"),
        col("description", "الوصف", "Description"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("debitTotal", "مدين", "Debit"),
        moneyCol("creditTotal", "دائن", "Credit"),
        col("reversalOf", "عكس لـ", "Reversal of"),
        col("journalCount", "قيود اليومية", "Journals"),
        col("postedAt", "تاريخ الترحيل", "Posted at", "date"),
      ],
      groups: [],
      rows: filtered.map((row) => ({
        key: row.eliminationId,
        values: {
          eliminationNo: row.eliminationNo ?? "— (مسودة)",
          kind: row.kind,
          description: row.description,
          status: row.status,
          debitTotal: row.debitTotal,
          creditTotal: row.creditTotal,
          reversalOf: row.reversalOf ?? "—",
          journalCount: String(row.journalEntryIds.length),
          postedAt: row.postedAt ?? "—",
        },
      })),
      totals: [
        {
          id: "postedCount",
          kind: "sum",
          label: bilingual("عدد القيود المرحّلة", "Posted eliminations"),
          amount: String(tie.postedCount),
        },
        {
          id: "postedDebitTotal",
          kind: "sum",
          label: bilingual("إجمالي المدين المرحّل", "Posted debit total"),
          amount: postedDebit,
        },
      ],
      assertionResults: [eliminationsTieResult(tie)],
      notes: [
        G32_SHAPE_NOTE,
        BR056_REVERSAL_NOTE,
        bilingual(
          tie.journalChainBroken.length === 0
            ? "سلسلة قيود اليومية مكتملة لكل القيود المرحّلة"
            : "توجد قيود مرحّلة بلا سلسلة يومية — راجع المطابقة",
          tie.journalChainBroken.length === 0
            ? "The journal chain is complete for every posted elimination"
            : "Some posted eliminations lack a journal chain — see the assertion",
        ),
      ],
    };
  },
});
