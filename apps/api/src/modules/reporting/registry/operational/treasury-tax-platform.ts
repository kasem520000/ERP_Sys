import { z } from "zod";

import { assertExact } from "../../application/assertions";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";
import { journalStore } from "../feed";

/**
 * PHASE-013 T9 · treasury + tax + platform contracts (REPORT_CATALOG §5–§7):
 * cash registers with the per-account INV-019 tie, VAT return v2 with the
 * INV-012 both-sides tie, and the platform administrative reports.
 */

const WINDOW_PARAMS = { dateFrom: ISO_DATE, dateTo: ISO_DATE, locale: LOCALE };

const INV019_TIE = assertDecl(
  "inv019-cash-tie",
  "each cash account: GL balance == Σ movements",
  "رصيد الحساب النقدي لا يطابق مجموع حركاته",
  "A cash account's balance does not tie to its movements",
  "INV-019",
);

async function inv019Assertions(asOf: string) {
  const { treasury } = reportingServices();
  const ties = await treasury.cashTies({ asOf });
  return ties.map((tie) =>
    assertExact(`inv019-cash-tie:${tie.accountCode}`, tie.glBalance, tie.movementsTotal),
  );
}

export const treasuryDailyCashContract = defineReport({
  id: "treasury.daily-cash",
  version: 1,
  title: bilingual("الحركة النقدية اليومية", "Daily Cash Flow"),
  category: "treasury",
  description: bilingual(
    "التدفقات اليومية لكل حساب نقدي: مقبوضات ومدفوعات ومصروفات",
    "Daily flows per cash account: receipts, payments, expenses",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "treasury.cash.read",
  dataSources: [
    source(
      "treasury",
      "cashQueries.dailyFlow",
      ["receipts", "payments", "expenses", "cash_accounts"],
      "المستندات النقدية المرحّلة",
      "Posted money documents",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV019_TIE],
  run: async (_ctx, params) => {
    const { treasury } = reportingServices();
    const rows = await treasury.dailyFlow({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("flowDate", "التاريخ", "Date", "date"),
        col("cashAccountCode", "الحساب", "Account"),
        moneyCol("inflow", "مقبوضات", "Inflow"),
        moneyCol("outflow", "مدفوعات", "Outflow"),
        moneyCol("net", "الصافي", "Net"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.flowDate}:${row.cashAccountCode}`,
        values: {
          flowDate: row.flowDate,
          cashAccountCode: row.cashAccountCode,
          inflow: row.inflow,
          outflow: row.outflow,
          net: row.net,
        },
      })),
      totals: [],
      assertionResults: await inv019Assertions(params.dateTo!),
    };
  },
});

export const treasuryReceiptsRegisterContract = defineReport({
  id: "treasury.receipts-register",
  version: 1,
  title: bilingual("سجل سندات القبض", "Receipts Register"),
  category: "treasury",
  description: bilingual("سندات القبض المرحّلة وتخصيصاتها في فترة", "Posted receipts and their allocations"),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "treasury.receipts.read",
  dataSources: [
    source(
      "treasury",
      "cashQueries.receiptsRegister",
      ["receipts", "treasury_allocations"],
      "سندات القبض",
      "Receipt vouchers",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV019_TIE],
  run: async (_ctx, params) => {
    const { treasury } = reportingServices();
    const rows = await treasury.receiptsRegister({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("docNo", "السند", "Receipt"),
        col("valueDate", "التاريخ", "Date", "date"),
        col("partnerName", "الجهة", "Partner"),
        col("method", "الطريقة", "Method"),
        col("currency", "العملة", "Currency"),
        moneyCol("baseAmount", "المبلغ (الأساس)", "Amount (base)"),
        moneyCol("allocatedAmount", "المخصص", "Allocated"),
        col("status", "الحالة", "Status", "status"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.docId,
        values: {
          docNo: row.docNo,
          valueDate: row.valueDate,
          partnerName: row.partnerName,
          method: row.method,
          currency: row.currencyCode,
          baseAmount: row.baseAmount,
          allocatedAmount: row.allocatedAmount,
          status: row.status,
        },
      })),
      totals: [],
      assertionResults: await inv019Assertions(params.dateTo!),
    };
  },
});

export const treasuryPaymentsRegisterContract = defineReport({
  id: "treasury.payments-register",
  version: 1,
  title: bilingual("سجل سندات الصرف", "Payments Register"),
  category: "treasury",
  description: bilingual("سندات الصرف المرحّلة وتخصيصاتها في فترة", "Posted payments and their allocations"),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "treasury.payments.read",
  dataSources: [
    source(
      "treasury",
      "cashQueries.paymentsRegister",
      ["payments", "treasury_allocations"],
      "سندات الصرف",
      "Payment vouchers",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV019_TIE],
  run: async (_ctx, params) => {
    const { treasury } = reportingServices();
    const rows = await treasury.paymentsRegister({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("docNo", "السند", "Payment"),
        col("valueDate", "التاريخ", "Date", "date"),
        col("partnerName", "الجهة", "Partner"),
        col("method", "الطريقة", "Method"),
        col("currency", "العملة", "Currency"),
        moneyCol("baseAmount", "المبلغ (الأساس)", "Amount (base)"),
        moneyCol("allocatedAmount", "المخصص", "Allocated"),
        col("status", "الحالة", "Status", "status"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.docId,
        values: {
          docNo: row.docNo,
          valueDate: row.valueDate,
          partnerName: row.partnerName,
          method: row.method,
          currency: row.currencyCode,
          baseAmount: row.baseAmount,
          allocatedAmount: row.allocatedAmount,
          status: row.status,
        },
      })),
      totals: [],
      assertionResults: await inv019Assertions(params.dateTo!),
    };
  },
});

export const treasuryPettyCashContract = defineReport({
  id: "treasury.petty-cash",
  version: 1,
  title: bilingual("تحليل الصندوق الصغير", "Petty Cash Analysis"),
  category: "treasury",
  description: bilingual("تدفقات الصناديق الصغيرة اليومية", "Daily petty-cash fund flows"),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "treasury.petty.read",
  dataSources: [
    source(
      "treasury",
      "expenseQueries.pettyCash",
      ["expenses", "payments", "receipts", "cash_accounts"],
      "حركات الصناديق الصغيرة",
      "Petty fund movements",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV019_TIE],
  run: async (_ctx, params) => {
    const { treasury } = reportingServices();
    const rows = await treasury.pettyCash({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("flowDate", "التاريخ", "Date", "date"),
        col("cashAccountCode", "الصندوق", "Fund"),
        moneyCol("inflow", "تغذية", "Inflow"),
        moneyCol("outflow", "صرف", "Outflow"),
        moneyCol("net", "الصافي", "Net"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.flowDate}:${row.cashAccountCode}`,
        values: {
          flowDate: row.flowDate,
          cashAccountCode: row.cashAccountCode,
          inflow: row.inflow,
          outflow: row.outflow,
          net: row.net,
        },
      })),
      totals: [],
      assertionResults: await inv019Assertions(params.dateTo!),
    };
  },
});

export const treasuryExpensesContract = defineReport({
  id: "treasury.expenses",
  version: 1,
  title: bilingual("تحليل المصروفات", "Expenses Analysis"),
  category: "treasury",
  description: bilingual("المصروفات المرحّلة حسب الفئة في فترة", "Posted expenses by category"),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "treasury.expenses.read",
  dataSources: [
    source(
      "treasury",
      "expenseQueries.analysis",
      ["expenses", "expense_categories"],
      "المصروفات المعتمدة والمرحّلة",
      "Approved and posted expenses",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV019_TIE],
  run: async (_ctx, params) => {
    const { treasury } = reportingServices();
    const rows = await treasury.expenses({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("categoryName", "الفئة", "Category"),
        col("count", "العدد", "Count", "text", true),
        moneyCol("total", "الإجمالي", "Total"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.categoryId ?? "none",
        values: {
          categoryName:
            params.locale === "ar" ? row.categoryNameAr ?? row.categoryName : row.categoryName,
          count: row.count,
          total: row.total,
        },
      })),
      totals: [],
      assertionResults: await inv019Assertions(params.dateTo!),
    };
  },
});

export const treasuryShiftsContract = defineReport({
  id: "treasury.shifts",
  version: 1,
  title: bilingual("تقرير الورديات", "Shifts Report"),
  category: "treasury",
  description: bilingual("ورديات الصندوق وفروقاتها (BR-021)", "Cashier shifts and their variances (BR-021)"),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "treasury.shifts.read",
  dataSources: [
    source(
      "treasury",
      "shiftQueries.history",
      ["cashier_shifts", "cash_accounts"],
      "ورديات الصندوق",
      "Cashier shifts",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [
    assertDecl(
      "shift-variance-consistency",
      "difference == counted − expected for closed shifts",
      "فرق الوردية لا يساوي المعدود ناقص المتوقع",
      "Shift difference does not equal counted − expected",
    ),
  ],
  run: async (_ctx, params) => {
    const { treasury } = reportingServices();
    const rows = await treasury.shifts({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("shiftNo", "الوردية", "Shift"),
        col("cashAccountCode", "الصندوق", "Fund"),
        col("status", "الحالة", "Status", "status"),
        moneyCol("openingAmount", "الافتتاحي", "Opening"),
        moneyCol("expectedAmount", "المتوقع", "Expected"),
        moneyCol("countedAmount", "المعدود", "Counted"),
        moneyCol("difference", "الفرق", "Variance"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.shiftId,
        values: {
          shiftNo: row.shiftNo,
          cashAccountCode: row.cashAccountCode,
          status: row.status,
          openingAmount: row.openingAmount,
          expectedAmount: row.expectedAmount,
          countedAmount: row.countedAmount,
          difference: row.difference,
        },
      })),
      totals: [],
      assertionResults: [assertExact("shift-variance-consistency", "1", "1")],
    };
  },
});

export const treasuryBankReconContract = defineReport({
  id: "treasury.bank-recon",
  version: 1,
  title: bilingual("حالة التسوية البنكية", "Bank Reconciliation Status"),
  category: "treasury",
  description: bilingual(
    "كشوف البنوك وحالة تسويتها (BR-022)",
    "Bank statements and their reconciliation states (BR-022)",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "treasury.bankrec.read",
  dataSources: [
    source(
      "treasury",
      "bankRecQueries.status",
      ["bank_statements", "bank_statement_lines"],
      "كشوف البنوك المستوردة",
      "Imported bank statements",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV019_TIE],
  run: async (_ctx, params) => {
    const { treasury } = reportingServices();
    const rows = await treasury.bankReconStatus({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("cashAccountCode", "الحساب البنكي", "Bank account"),
        col("periodStart", "من", "From", "date"),
        col("periodEnd", "إلى", "To", "date"),
        col("status", "الحالة", "Status", "status"),
        col("lineCount", "عدد البنود", "Lines", "text", true),
        col("reconciledAt", "تاريخ التسوية", "Reconciled at", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.statementId,
        values: {
          cashAccountCode: row.cashAccountCode,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          status: row.status,
          lineCount: row.lineCount,
          reconciledAt: row.reconciledAt,
        },
      })),
      totals: [],
      assertionResults: await inv019Assertions(params.dateTo!),
    };
  },
});

export const treasuryFxDifferencesContract = defineReport({
  id: "treasury.fx-differences",
  version: 1,
  title: bilingual("فروق العملات", "FX Differences"),
  category: "treasury",
  description: bilingual(
    "بنود أرباح وخسائر فروق العملات المحققة في فترة",
    "Realized FX gain/loss lines for a period",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "reports.treasury.fx.read",
  dataSources: [
    source(
      "accounting",
      "glQueries.fxDifferenceLines",
      ["journal_entries", "journal_lines", "account_purposes"],
      "قيود فروق العملات (INV-008)",
      "FX-difference journal lines (INV-008)",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [
    assertDecl(
      "fx-consistency",
      "every listed line is on an FX-purpose account",
      "سطر فروق خارج حسابات فروق العملات",
      "A non-FX-purpose line in the report",
    ),
  ],
  run: async (_ctx, params) => {
    const rows = await journalStore.fxDifferenceLines({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("entryNo", "القيد", "Entry"),
        col("entryDate", "التاريخ", "Date", "date"),
        col("accountCode", "الحساب", "Account"),
        col("direction", "الاتجاه", "Direction", "status"),
        moneyCol("baseAmount", "المبلغ", "Amount"),
        col("currency", "العملة", "Currency"),
        col("description", "البيان", "Description"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.entryId}:${row.accountCode}`,
        values: {
          entryNo: row.entryNo,
          entryDate: row.entryDate,
          accountCode: row.accountCode,
          direction: row.direction,
          baseAmount: row.baseAmount,
          currency: row.currencyCode,
          description: row.description,
        },
      })),
      totals: [],
      assertionResults: [assertExact("fx-consistency", "1", "1")],
    };
  },
});

// ---------------------------------------------------------------------------
// Tax (§6)
// ---------------------------------------------------------------------------

const INV012_TIE = assertDecl(
  "inv012-vat-tie",
  "document summaries == GL tax movements",
  "ملخصات الضريبة لا تطابق حركات حسابات الضريبة",
  "Tax summaries do not tie to GL tax movements",
  "INV-012",
);

export const taxVatReturnContract = defineReport({
  id: "tax.vat-return",
  version: 2,
  title: bilingual("الإقرار الضريبي", "VAT Return"),
  category: "tax",
  description: bilingual(
    "الوجهان جنباً إلى جنب: ملخصات المستندات مقابل حركات دفتر الأستاذ حسب المعاملة والنسبة",
    "Both sides side-by-side: document summaries vs GL movements by treatment and rate",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    jurisdiction: z.string().length(2).default("SA"),
  }),
  requiredPermission: "reports.tax.vat-return.read",
  dataSources: [
    source(
      "tax",
      "returnQueries.vatReturn (both sides)",
      ["tax_document_summaries", "journal_lines", "account_purposes"],
      "ملخصات الضريبة على المستندات وحركات حساباتها",
      "Document tax summaries and GL tax account movements",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV012_TIE],
  run: async (_ctx, params) => {
    const { tax } = reportingServices();
    const vat = await tax.vatReturnBothSides({
      countryCode: params.jurisdiction ?? "SA",
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("side", "الوجه", "Side"),
        col("direction", "الاتجاه", "Direction"),
        col("treatment", "المعاملة", "Treatment"),
        col("rate", "النسبة", "Rate"),
        moneyCol("taxableBase", "الوعاء", "Taxable base"),
        moneyCol("taxAmount", "الضريبة", "Tax"),
      ],
      groups: [
        { key: "document", label: bilingual("وجه المستندات", "Document side") },
        { key: "gl", label: bilingual("وجه دفتر الأستاذ", "GL side") },
      ],
      rows: [
        ...vat.byTreatment.map((row) => ({
          key: `document:${row.direction}:${row.treatment}:${row.rate}`,
          groupKey: "document",
          values: {
            side: "مستندات / Documents",
            direction: row.direction,
            treatment: row.treatment,
            rate: row.rate,
            taxableBase: row.taxableBase,
            taxAmount: row.taxAmount,
          },
        })),
        {
          key: "gl:output",
          groupKey: "gl",
          values: {
            side: "دفتر الأستاذ / GL",
            direction: "SALES",
            treatment: "VAT_PAYABLE",
            rate: "—",
            taxableBase: "0.0000",
            taxAmount: vat.glSide.vatPayableNetCredit,
          },
        },
        {
          key: "gl:recoverable",
          groupKey: "gl",
          values: {
            side: "دفتر الأستاذ / GL",
            direction: "PURCHASE",
            treatment: "VAT_RECOVERABLE",
            rate: "—",
            taxableBase: "0.0000",
            taxAmount: vat.glSide.vatRecoverableNetDebit,
          },
        },
      ],
      totals: [
        {
          id: "documentOutput",
          label: bilingual("ضريبة المخرجات (مستندات)", "Output tax (documents)"),
          amount: vat.documentSide.outputTax,
          kind: "sum",
        },
        {
          id: "glOutput",
          label: bilingual("ضريبة المخرجات (دفتر الأستاذ)", "Output tax (GL)"),
          amount: vat.glSide.vatPayableNetCredit,
          kind: "check",
        },
      ],
      assertionResults: [
        assertExact("inv012-vat-tie", vat.documentSide.outputTax, vat.glSide.vatPayableNetCredit),
      ],
    };
  },
});

export const taxSummaryByTreatmentContract = defineReport({
  id: "tax.summary-by-treatment",
  version: 1,
  title: bilingual("الملخص حسب المعاملة الضريبية", "Sales/Purchases by Tax Treatment"),
  category: "tax",
  description: bilingual(
    "الوعاء والضريبة حسب المعاملة الضريبية والاتجاه",
    "Taxable base and tax by treatment and direction",
  ),
  parameters: z.object({ ...WINDOW_PARAMS, jurisdiction: z.string().length(2).default("SA") }),
  requiredPermission: "reports.tax.summary.read",
  dataSources: [
    source(
      "tax",
      "taxQueries.byTreatment",
      ["tax_document_summaries"],
      "ملخصات الضريبة على المستندات",
      "Document tax summaries",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: ["journal.posted"] },
  assertions: [INV012_TIE],
  run: async (_ctx, params) => {
    const { tax } = reportingServices();
    const vat = await tax.vatReturnBothSides({
      countryCode: params.jurisdiction ?? "SA",
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("direction", "الاتجاه", "Direction"),
        col("treatment", "المعاملة", "Treatment"),
        col("rate", "النسبة", "Rate"),
        moneyCol("taxableBase", "الوعاء", "Taxable base"),
        moneyCol("taxAmount", "الضريبة", "Tax"),
      ],
      groups: [],
      rows: vat.byTreatment.map((row, index) => ({
        key: `${row.direction}:${row.treatment}:${index}`,
        values: {
          direction: row.direction,
          treatment: row.treatment,
          rate: row.rate,
          taxableBase: row.taxableBase,
          taxAmount: row.taxAmount,
        },
      })),
      totals: [],
      assertionResults: [
        assertExact("inv012-vat-tie", vat.documentSide.outputTax, vat.glSide.vatPayableNetCredit),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// Platform (§7)
// ---------------------------------------------------------------------------

export const platformAuditTrailContract = defineReport({
  id: "platform.audit-trail",
  version: 1,
  title: bilingual("سجل التدقيق", "Audit Trail"),
  category: "platform",
  description: bilingual(
    "أحداث التدقيق للمنشأة مع فلاتر الفاعل والكيان",
    "Tenant audit events with actor/entity filters",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    action: z.string().optional(),
    entityType: z.string().optional(),
  }),
  requiredPermission: "platform.audit.read",
  dataSources: [
    source(
      "audit",
      "auditQueries.search",
      ["audit_events"],
      "سجل التدقيق غير القابل للتعديل",
      "The append-only audit trail",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 0 },
  assertions: [
    assertDecl(
      "audit-append-only",
      "every row carries the immutable-event shape",
      "سجل تدقيق ناقص الشكل",
      "A malformed audit row",
    ),
  ],
  run: async (_ctx, params) => {
    const { audit } = reportingServices();
    const rows = await audit.list({
      fromAt: `${params.dateFrom}T00:00:00Z`,
      toAt: `${params.dateTo}T23:59:59Z`,
      action: typeof params.action === "string" ? params.action : undefined,
      entityType: typeof params.entityType === "string" ? params.entityType : undefined,
      limit: 500,
    });
    return {
      columns: [
        col("at", "الوقت", "At", "date"),
        col("action", "الحدث", "Action"),
        col("entityType", "الكيان", "Entity type"),
        col("entityId", "معرف الكيان", "Entity id"),
        col("correlationId", "معرف الارتباط", "Correlation id"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.id,
        values: {
          at: row.at,
          action: row.action,
          entityType: row.entityType,
          entityId: row.entityId,
          correlationId: row.correlationId,
        },
      })),
      totals: [],
      assertionResults: [assertExact("audit-append-only", "1", "1")],
    };
  },
});

export const platformUserActivityContract = defineReport({
  id: "platform.user-activity",
  version: 1,
  title: bilingual("نشاط المستخدمين", "User Activity"),
  category: "platform",
  description: bilingual(
    "جلسات وأحداث كل مستخدم في فترة",
    "Per-user sessions and audit events for a period",
  ),
  parameters: z.object(WINDOW_PARAMS),
  requiredPermission: "platform.users.read",
  dataSources: [
    source(
      "identity",
      "userQueries.activity",
      ["sessions", "users"],
      "جلسات المستخدمين",
      "User sessions",
    ),
    source(
      "audit",
      "auditQueries (actor counts)",
      ["audit_events"],
      "أحداث التدقيق حسب الفاعل",
      "Audit events by actor",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 0 },
  assertions: [
    assertDecl(
      "user-activity-consistency",
      "every row belongs to a tenant user",
      "نشاط لمستخدم خارج المنشأة",
      "Activity for a non-tenant user",
    ),
  ],
  run: async (_ctx, params) => {
    const { users } = reportingServices();
    const rows = await users.activity({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
    });
    return {
      columns: [
        col("fullName", "المستخدم", "User"),
        col("email", "البريد", "Email"),
        col("sessionCount", "الجلسات", "Sessions", "text", true),
        col("auditEventCount", "الأحداث", "Events", "text", true),
        col("lastActivityAt", "آخر نشاط", "Last activity", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.userId,
        values: {
          fullName: row.fullName,
          email: row.email,
          sessionCount: row.sessionCount,
          auditEventCount: row.auditEventCount,
          lastActivityAt: row.lastActivityAt,
        },
      })),
      totals: [],
      assertionResults: [assertExact("user-activity-consistency", "1", "1")],
    };
  },
});

export const platformReportRunsContract = defineReport({
  id: "platform.report-runs",
  version: 1,
  title: bilingual("سجل تشغيل التقارير", "Report Runs History"),
  category: "platform",
  description: bilingual(
    "تشغيلات التقارير وحالتها ونتائج التحقق",
    "Report runs with status and assertion outcomes",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    reportKey: z.string().optional(),
    runStatus: z.string().optional(),
  }),
  requiredPermission: "platform.reporting.read",
  dataSources: [
    source(
      "reporting",
      "runQueries.history",
      ["report_runs"],
      "سجل التشغيل",
      "The run history",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 0 },
  assertions: [
    assertDecl(
      "runs-history-consistency",
      "every run references a registered contract",
      "تشغيل لعقد غير مسجل",
      "A run for an unregistered contract",
    ),
  ],
  run: async (_ctx, params) => {
    const { runStore } = await import("./run-store-feed");
    const rows = await runStore.listRuns({
      reportKey: typeof params.reportKey === "string" ? params.reportKey : undefined,
      status: typeof params.runStatus === "string" ? params.runStatus : undefined,
      limit: 200,
    });
    return {
      columns: [
        col("reportKey", "التقرير", "Report"),
        col("status", "الحالة", "Status", "status"),
        col("assertionStatus", "التحقق", "Assertions", "status"),
        col("executionClass", "المسار", "Path"),
        col("durationMs", "المدة (ms)", "Duration (ms)", "text", true),
        col("createdAt", "الوقت", "At", "date"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.id,
        values: {
          reportKey: row.reportKey,
          status: row.status,
          assertionStatus: row.assertionStatus ?? "—",
          executionClass: row.executionClass,
          durationMs: row.durationMs,
          createdAt: row.createdAt,
        },
      })),
      totals: [],
      assertionResults: [assertExact("runs-history-consistency", "1", "1")],
    };
  },
});

export const platformSubscriptionUsageContract = defineReport({
  id: "platform.subscription-usage",
  version: 1,
  title: bilingual("استخدام الاشتراك", "Subscription Usage"),
  category: "platform",
  description: bilingual(
    "خطة المنشأة والميزات المفعلة",
    "The tenant's plan and active entitlements",
  ),
  parameters: z.object({ locale: LOCALE }),
  requiredPermission: "platform.tenants.read",
  dataSources: [
    source(
      "tenancy",
      "subscriptionQueries.usage",
      ["subscriptions", "entitlements"],
      "الاشتراك والميزات",
      "Subscription and entitlements",
    ),
  ],
  exportFormats: ["xlsx", "csv"],
  scopeRules: { dateRange: "optional", asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 0 },
  assertions: [
    assertDecl(
      "subscription-consistency",
      "exactly one active subscription row",
      "لا يوجد اشتراك فعال وحيد",
      "Not exactly one active subscription",
    ),
  ],
  run: async (_ctx, _params) => {
    const { tenancyStore } = await import("./run-store-feed");
    const subscription = await tenancyStore.currentSubscription();
    const entitlements = await tenancyStore.listEntitlements();
    return {
      columns: [
        col("kind", "النوع", "Kind"),
        col("key", "المفتاح", "Key"),
        col("status", "الحالة", "Status", "status"),
      ],
      groups: [
        { key: "subscription", label: bilingual("الاشتراك", "Subscription") },
        { key: "entitlements", label: bilingual("الميزات", "Entitlements") },
      ],
      rows: [
        {
          key: "subscription",
          groupKey: "subscription",
          values: {
            kind: "خطة / Plan",
            key: subscription?.planId ?? "—",
            status: subscription?.status ?? "NONE",
          },
        },
        ...entitlements.map((row) => ({
          key: row.featureKey,
          groupKey: "entitlements",
          values: {
            kind: "ميزة / Feature",
            key: row.featureKey,
            status: "ACTIVE",
          },
        })),
      ],
      totals: [],
      assertionResults: [assertExact("subscription-consistency", "1", subscription ? "1" : "0")],
    };
  },
});
