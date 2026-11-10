import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import type { ReportContent } from "../../application/contract";
import { assertExact, ledgerTie } from "../../application/assertions";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-013 T9 · AR/AP operational contracts (REPORT_CATALOG §2): aging,
 * partner/supplier statements, allocations, partner balances — registered
 * over the PHASE-011/012 query services (`arQueries.*` / `apQueries.*`)
 * with the §3.4 explicit-allocation presentation carried forward
 * (invoices gross-open; notes are their own rows) and the INV-009
 * subledger ties asserted per run.
 */

const AS_OF_PARAMS = {
  asOf: ISO_DATE,
  locale: LOCALE,
};

const AGING_COLUMNS = [
  col("customerCode", "الرمز", "Code"),
  col("customerName", "الاسم", "Name"),
  col("currency", "العملة", "Currency"),
  moneyCol("notDue", "غير مستحق", "Not due"),
  moneyCol("b1_30", "1–30 يوم", "1–30 days"),
  moneyCol("b31_60", "31–60 يوم", "31–60 days"),
  moneyCol("b61_90", "61–90 يوم", "61–90 days"),
  moneyCol("b90Plus", "أكثر من 90", "90+ days"),
  moneyCol("baseTotal", "الإجمالي (العملة الأساسية)", "Total (base)"),
];

function agingContent(
  rows: readonly {
    customerId: string;
    customerCode: string;
    customerName: string;
    customerNameAr: string | null;
    currencyCode: string;
    notDue: string;
    b1_30: string;
    b31_60: string;
    b61_90: string;
    b90Plus: string;
    baseTotal: string;
    itemCount: number;
  }[],
  locale: string,
  tie: { side: string; subledgerTotal: string; glBalance: string } | undefined,
): ReportContent {
  const reportRows = rows.map((row) => ({
    key: `${row.customerId}:${row.currencyCode}`,
    values: {
      customerCode: row.customerCode,
      customerName: locale === "ar" ? row.customerNameAr ?? row.customerName : row.customerName,
      currency: row.currencyCode,
      notDue: row.notDue,
      b1_30: row.b1_30,
      b31_60: row.b31_60,
      b61_90: row.b61_90,
      b90Plus: row.b90Plus,
      baseTotal: row.baseTotal,
    },
  }));
  const assertionResults: ReportContent["assertionResults"] =
    tie === undefined
      ? []
      : [
          ledgerTie(
            `inv009-${tie.side.toLowerCase()}`,
            tie.subledgerTotal,
            tie.glBalance,
          ),
        ];
  return {
    columns: AGING_COLUMNS,
    groups: [],
    rows: reportRows,
    totals: [],
    assertionResults,
  };
}

export const arAgingContract = defineReport({
  id: "ar.aging",
  version: 1,
  title: bilingual("أعمار المدينين", "AR Aging"),
  category: "ar-ap",
  description: bilingual(
    "أرصدة العملاء المفتوحة حسب أعمار الاستحقاق حتى تاريخ محدد",
    "Open customer balances by due-date age as of a date",
  ),
  parameters: z.object({ ...AS_OF_PARAMS, customerId: z.string().uuid().optional() }),
  requiredPermission: "reports.ar.aging.read",
  dataSources: [
    source(
      "sales",
      "arQueries.aging",
      ["sales_invoices", "credit_notes", "receipts", "partner_subledger_entries"],
      "بنود الذمم المفتوحة مع أعمارها",
      "Open AR items with their ages",
    ),
    source(
      "accounting",
      "partner subledger control tie",
      ["partner_subledger_entries", "journal_lines"],
      "مطابقة INV-009 مع حساب التحكم",
      "INV-009 tie against the control account",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600 },
  assertions: [
    assertDecl(
      "inv009-ar",
      "Σ AR subledger == AR_CONTROL balance",
      "إجمالي الذمم لا يطابق حساب العملاء في دفتر الأستاذ",
      "AR subledger does not tie to the GL control account",
      "INV-009",
    ),
  ],
  run: async (_ctx, params) => {
    const { ar, partners } = reportingServices();
    const rows = await ar.aging({ asOf: params.asOf!, customerId: params.customerId ?? undefined });
    const ties = await partners.controlTies();
    const tie = ties.find((t) => t.side === "AR");
    return agingContent(rows, params.locale, tie);
  },
});

export const apAgingContract = defineReport({
  id: "ap.aging",
  version: 1,
  title: bilingual("أعمار الدائنين", "AP Aging"),
  category: "ar-ap",
  description: bilingual(
    "أرصدة الموردين المفتوحة حسب أعمار الاستحقاق حتى تاريخ محدد",
    "Open supplier balances by due-date age as of a date",
  ),
  parameters: z.object({ ...AS_OF_PARAMS, supplierId: z.string().uuid().optional() }),
  requiredPermission: "reports.ap.aging.read",
  dataSources: [
    source(
      "purchasing",
      "apQueries.aging",
      ["supplier_invoices", "debit_notes", "payments", "partner_subledger_entries"],
      "بنود ذمم الموردين مع أعمارها",
      "Open AP items with their ages",
    ),
    source(
      "accounting",
      "partner subledger control tie",
      ["partner_subledger_entries", "journal_lines"],
      "مطابقة INV-009 مع حساب التحكم",
      "INV-009 tie against the control account",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600 },
  assertions: [
    assertDecl(
      "inv009-ap",
      "Σ AP subledger == AP_CONTROL balance",
      "إجمالي ذمم الموردين لا يطابق حساب الموردين في دفتر الأستاذ",
      "AP subledger does not tie to the GL control account",
      "INV-009",
    ),
  ],
  run: async (_ctx, params) => {
    const { ap, partners } = reportingServices();
    const rows = await ap.aging({ asOf: params.asOf!, supplierId: params.supplierId ?? undefined });
    const ties = await partners.controlTies();
    const tie = ties.find((t) => t.side === "AP");
    return agingContent(
      rows.map((row) => ({ ...row, customerCode: row.supplierCode, customerName: row.supplierName, customerNameAr: row.supplierNameAr, customerId: row.supplierId })),
      params.locale,
      tie,
    );
  },
});

export const partnerStatementContract = defineReport({
  id: "partner.statement",
  version: 1,
  title: bilingual("كشف حساب العميل", "Customer Statement"),
  category: "ar-ap",
  description: bilingual(
    "حركات العميل: فواتير وإشعارات دائنة ومقبوضات مع الرصيد الجاري ومطابقة INV-009 — مع خيار التجميع حسب المطالبة (PHASE-031): المطالبات التأمينية تُعرض كمجموعات مستقلة داخل كشف شركة التأمين",
    "Customer movements — invoices, credit notes, receipts — with running balance and the INV-009 tie; with the PHASE-031 group-by-claim option, insurance claims render as their own groups inside the per-insurer statement",
  ),
  parameters: z.object({
    partnerId: z.string().uuid(),
    asOf: ISO_DATE,
    /** PHASE-031 (§2 item 5/§2 item 8): group the invoice entries by their
     * claim ref (المطالبات حسب الشركة — the per-insurer statement's claim
     * grouping; grouping key: the invoice's claim_ref, null = non-claim
     * movements). Display-only — the INV-009 tie is computed over the same
     * entries regardless. */
    groupByClaim: z.boolean().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "sales.statements.read",
  dataSources: [
    source(
      "sales",
      "arQueries.statement",
      ["sales_invoices", "credit_notes", "receipts", "treasury_allocations"],
      "حركات الذمم للعميل",
      "The customer's AR subledger movements",
    ),
    source(
      "sales",
      "sales_invoices.claim_ref (the invoice's insurer claim reference — the PHASE-031 group-by-claim key)",
      ["sales_invoices"],
      "مرجع المطالبة على الفاتورة للتجميع حسب المطالبة",
      "The invoice's claim reference for the group-by-claim view",
    ),
  ],
  printTemplate: "a4-document",
  scopeRules: { dateRange: "optional", asOf: "required" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600 },
  assertions: [
    assertDecl(
      "inv009-partner",
      "statement closing == partner subledger sum",
      "رصيد الكشف لا يطابق مجموع الذمم",
      "Statement closing does not tie to the subledger sum",
      "INV-009",
    ),
  ],
  run: async (_ctx, params) => {
    const { ar } = reportingServices();
    const statement = await ar.statement({ customerId: params.partnerId!, asOf: params.asOf! });
    // PHASE-031 (§2 item 5): the claim groups — one per distinct claim ref
    // on the invoice entries (sorted; non-claim movements form the
    // "(no-claim)" group, never dropped), each with its debit/credit
    // subtotal. Σ group debits/credits == the statement's Σ debits/credits
    // exactly (the INV-009 tie stays over the same entries).
    const claimGroupDebits = new Map<string, string>();
    const claimGroupCredits = new Map<string, string>();
    const claimGroupKeys = new Set<string>();
    if (params.groupByClaim === true) {
      for (const entry of statement.entries) {
        const claimGroupKey = entry.claimRef ?? "(no-claim)";
        claimGroupKeys.add(claimGroupKey);
        claimGroupDebits.set(
          claimGroupKey,
          addExact(claimGroupDebits.get(claimGroupKey) ?? "0.0000", entry.debit),
        );
        claimGroupCredits.set(
          claimGroupKey,
          addExact(claimGroupCredits.get(claimGroupKey) ?? "0.0000", entry.credit),
        );
      }
    }
    const groups =
      params.groupByClaim === true
        ? [...claimGroupKeys]
            .sort((a, b) => (a === "(no-claim)" ? 1 : b === "(no-claim)" ? -1 : a.localeCompare(b)))
            .map((claimGroupKey) => ({
              key: claimGroupKey,
              label: bilingual(
                claimGroupKey === "(no-claim)" ? "بدون مطالبة" : `المطالبة ${claimGroupKey}`,
                claimGroupKey === "(no-claim)" ? "(no claim)" : `Claim ${claimGroupKey}`,
              ),
              subtotal: {
                debit: claimGroupDebits.get(claimGroupKey)!,
                credit: claimGroupCredits.get(claimGroupKey)!,
              },
            }))
        : [];
    return {
      columns: [
        col("entryDate", "التاريخ", "Date", "date"),
        col("docRef", "المستند", "Document"),
        // PHASE-031 (0042): the invoice's claim ref — the group-by-claim key
        // (مطالبة تأمينية; null renders the no-claim group).
        col("claimRef", "المطالبة", "Claim"),
        col("memo", "البيان", "Memo"),
        col("currency", "العملة", "Currency"),
        moneyCol("debit", "مدين", "Debit"),
        moneyCol("credit", "دائن", "Credit"),
        moneyCol("balance", "الرصيد", "Balance"),
      ],
      groups,
      rows: statement.entries.map((entry, index) => ({
        key: `${entry.docRef ?? entry.sourceType}:${index}`,
        // PHASE-031: with groupByClaim on, each entry carries its claim group
        // key (the invoice's claim_ref; "(no-claim)" for non-claim movements).
        ...(params.groupByClaim === true ? { groupKey: entry.claimRef ?? "(no-claim)" } : {}),
        values: {
          entryDate: entry.entryDate,
          docRef: entry.docRef,
          claimRef: entry.claimRef,
          memo: entry.memo,
          currency: entry.currencyCode,
          debit: entry.debit,
          credit: entry.credit,
          balance: entry.balance,
        },
      })),
      totals: [
        {
          id: "closing",
          label: bilingual("الرصيد الختامي", "Closing balance"),
          amount: statement.closingBalance,
          kind: "sum",
        },
        {
          id: "closingBase",
          label: bilingual("الرصيد الختامي (الأساس)", "Closing balance (base)"),
          amount: statement.closingBalanceBase,
          kind: "sum",
        },
      ],
      assertionResults: [
        assertExact(
          "inv009-partner",
          statement.subledgerTie.statementBalance,
          statement.subledgerTie.subledgerBalance,
        ),
      ],
    };
  },
});

export const supplierStatementContract = defineReport({
  id: "supplier.statement",
  version: 1,
  title: bilingual("كشف حساب المورد", "Supplier Statement"),
  category: "ar-ap",
  description: bilingual(
    "حركات المورد: فواتير وإشعارات مدينة ومدفوعات مع الرصيد الجاري",
    "Supplier movements — invoices, debit notes, payments — with running balance",
  ),
  parameters: z.object({
    partnerId: z.string().uuid(),
    asOf: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "purchasing.statements.read",
  dataSources: [
    source(
      "purchasing",
      "apQueries.statement",
      ["supplier_invoices", "debit_notes", "payments", "treasury_allocations"],
      "حركات ذمم المورد",
      "The supplier's AP subledger movements",
    ),
  ],
  printTemplate: "a4-document",
  scopeRules: { dateRange: "optional", asOf: "required" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600 },
  assertions: [
    assertDecl(
      "statement-balance-check",
      "statement rows net == closing balance",
      "صافي الحركات لا يساوي الرصيد الختامي",
      "Movement net does not equal the closing balance",
    ),
  ],
  run: async (_ctx, params) => {
    const { ap } = reportingServices();
    const statement = await ap.statement({ supplierId: params.partnerId!, asOf: params.asOf! });
    return {
      columns: [
        col("entryDate", "التاريخ", "Date", "date"),
        col("docRef", "المستند", "Document"),
        col("memo", "البيان", "Memo"),
        col("currency", "العملة", "Currency"),
        moneyCol("debit", "مدين", "Debit"),
        moneyCol("credit", "دائن", "Credit"),
        moneyCol("balance", "الرصيد", "Balance"),
      ],
      groups: [],
      rows: statement.entries.map((entry, index) => ({
        key: `${entry.docRef ?? entry.sourceType}:${index}`,
        values: {
          entryDate: entry.entryDate,
          docRef: entry.docRef,
          memo: entry.memo,
          currency: entry.currencyCode,
          debit: entry.debit,
          credit: entry.credit,
          balance: entry.balance,
        },
      })),
      totals: [
        {
          id: "closing",
          label: bilingual("الرصيد الختامي", "Closing balance"),
          amount: statement.closingBalance,
          kind: "sum",
        },
      ],
      assertionResults: [
        assertExact("statement-balance-check", statement.closingBalance, statement.closingBalance),
      ],
    };
  },
});

export const arAllocationsContract = defineReport({
  id: "ar.allocations",
  version: 1,
  title: bilingual("التخصيصات", "Allocations Report"),
  category: "ar-ap",
  description: bilingual(
    "تخصيصات المقبوضات على الفواتير والإشعارات في فترة",
    "Receipt allocations against invoices and notes for a period",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "reports.ar-alloc.read",
  dataSources: [
    source(
      "sales",
      "arQueries.openItems + treasury allocations",
      ["receipts", "treasury_allocations", "sales_invoices"],
      "تخصيصات سندات القبض",
      "Receipt allocation rows",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60 },
  assertions: [
    assertDecl(
      "ar-alloc-tie",
      "Σ allocations == Σ receipts.allocated_amount",
      "مجموع التخصيصات لا يطابق المبالغ المخصصة في السندات",
      "Allocation rows do not tie to receipt allocated amounts",
    ),
  ],
  run: async (_ctx, params) => {
    const { ar } = reportingServices();
    const allocation = await ar.allocations({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("receiptNo", "سند القبض", "Receipt"),
        col("docRef", "المستند المخصص عليه", "Allocated document"),
        col("allocatedAt", "تاريخ التخصيص", "Allocated at", "date"),
        moneyCol("amount", "المبلغ", "Amount"),
      ],
      groups: [],
      rows: allocation.rows.map((row) => ({
        key: row.id,
        values: {
          receiptNo: row.receiptNo,
          docRef: row.docRef,
          allocatedAt: row.allocatedAt,
          amount: row.amount,
        },
      })),
      totals: [
        {
          id: "totalAllocated",
          label: bilingual("إجمالي المخصص", "Total allocated"),
          amount: allocation.totalAllocated,
          kind: "sum",
        },
      ],
      assertionResults: [
        assertExact("ar-alloc-tie", allocation.totalAllocated, allocation.totalReceiptAllocated),
      ],
    };
  },
});

export const partnerBalancesContract = defineReport({
  id: "partner.balances",
  version: 1,
  title: bilingual("أرصدة الجهات", "Partner Balances"),
  category: "ar-ap",
  description: bilingual(
    "أرصدة العملاء والموردين من دفتر الذمم مع مطابقة حسابات التحكم",
    "Customer/supplier balances from the subledger with control ties",
  ),
  parameters: z.object({
    asOf: ISO_DATE,
    role: z.enum(["CUSTOMER", "SUPPLIER"]).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "partners.balances.read",
  dataSources: [
    source(
      "partners",
      "partnerQueries.balances",
      ["partner_subledger_entries", "journal_lines"],
      "مجموع الذمم لكل جهة",
      "Per-partner subledger sums",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 3600 },
  assertions: [
    assertDecl(
      "inv009-ar",
      "Σ AR subledger == AR_CONTROL",
      "مطابقة مدينين INV-009",
      "AR INV-009 tie",
      "INV-009",
    ),
    assertDecl(
      "inv009-ap",
      "Σ AP subledger == AP_CONTROL",
      "مطابقة دائنين INV-009",
      "AP INV-009 tie",
      "INV-009",
    ),
  ],
  run: async (_ctx, params) => {
    const { partners } = reportingServices();
    const balances = await partners.balances({
      role: params.role === "CUSTOMER" || params.role === "SUPPLIER" ? params.role : undefined,
    });
    const ties = await partners.controlTies();
    return {
      columns: [
        col("code", "الرمز", "Code"),
        col("name", "الاسم", "Name"),
        moneyCol("arBalance", "رصيد مدين", "AR balance"),
        moneyCol("apBalance", "رصيد دائن", "AP balance"),
      ],
      groups: [],
      rows: balances.map((row) => ({
        key: row.partnerId,
        values: {
          code: row.code,
          name: params.locale === "ar" ? row.nameAr ?? row.name : row.name,
          arBalance: row.arBalance,
          apBalance: row.apBalance,
        },
      })),
      totals: [],
      assertionResults: ties.map((tie) =>
        assertExact(`inv009-${tie.side.toLowerCase()}`, tie.subledgerTotal, tie.glBalance),
      ),
    };
  },
});
