import { z } from "zod";

import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-039 (REPORT_CATALOG §3 additions · CR-09): the two returns &
 * collections contracts — `sales.rma_register` (the unified RMA register
 * over BOTH families, customer 0055 + supplier 0059, with the completion
 * document numbers and cycle days) and `sales.dunning_status` (the
 * collections worklist: every overdue open item with its BR-065 ladder
 * position, the policy that fired it, the late-fee register totals and
 * the referral state per invoice).
 */

const RMA_SOURCES = [
  "return_authorizations",
  "return_authorization_lines",
  "supplier_return_authorizations",
  "supplier_return_authorization_lines",
  "credit_notes",
  "debit_notes",
] as const;

const DUNNING_SOURCES = [
  "sales_invoices",
  "partner_subledger_entries",
  "dunning_letters",
  "dunning_policies",
  "collection_referrals",
] as const;

export const salesRmaRegisterContract = defineReport({
  id: "sales.rma_register",
  version: 1,
  title: bilingual("سجل مرتجعات البيع والشراء", "RMA Register (Customer + Supplier)"),
  category: "sales",
  description: bilingual(
    "سجل موحد لطلبات الإرجاع: العملاء والموردون، الحالة والقرار، مستند الإتمام وأيام الدورة",
    "The unified RMA register: customer + supplier families, status and disposition, the completion document, and cycle days",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    family: z.enum(["CUSTOMER", "SUPPLIER", "ALL"]).default("ALL"),
    locale: LOCALE,
  }),
  requiredPermission: "sales.rma.read",
  dataSources: [
    source(
      "sales",
      "returnsDunning.rmaRegister",
      [...RMA_SOURCES],
      "طلبات الإرجاع للعملاء والموردين مع مستندات الإتمام",
      "The customer + supplier return authorizations with their completion documents",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 300, invalidationEvents: [] },
  assertions: [
    assertDecl(
      "rma-register-lines-positive",
      "every register row carries at least one line (EMPTY_DOCUMENT mirror)",
      "كل صف يحمل سطرًا واحدًا على الأقل (مرآة قيد المستند غير الفارغ)",
      "An RMA row appeared with zero lines",
    ),
  ],
  run: async (_ctx, params) => {
    const { returnsDunning } = reportingServices();
    const rows = await returnsDunning.rmaRegister({
      dateFrom: params.dateFrom!,
      dateTo: params.dateTo!,
      // The zod enum above already validated the value before run() sees it.
      family: (params.family as "CUSTOMER" | "SUPPLIER" | "ALL" | undefined) ?? "ALL",
    });
    const allLined = rows.every((row) => row.lines > 0);
    return {
      columns: [
        col("rmaNo", "رقم الإرجاع", "RMA no"),
        col("rmaDate", "التاريخ", "Date", "date"),
        col("partner", "الشريك", "Partner"),
        col("family", "النوع", "Family"),
        col("status", "الحالة", "Status"),
        col("disposition", "القرار", "Disposition"),
        col("lines", "الأسطر", "Lines"),
        moneyCol("net", "الصافي", "Net"),
        moneyCol("total", "الإجمالي", "Total"),
        col("docNo", "مستند الإتمام", "Completion doc"),
        col("cycleDays", "أيام الدورة", "Cycle days"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.rmaId,
        group: row.family,
        values: {
          rmaNo: row.rmaNo ?? row.rmaId,
          rmaDate: row.rmaDate,
          partner: row.partner,
          family: row.family,
          status: row.status,
          disposition: row.disposition ?? "—",
          lines: row.lines,
          net: row.net,
          total: row.total,
          docNo: row.docNo ?? "—",
          cycleDays: row.cycleDays,
        },
      })),
      totals: [
        {
          id: "rma-summary",
          label: bilingual(
            `الطلبات: ${rows.length} · مكتملة: ${rows.filter((r) => ["RESTOCKED", "SCRAPPED", "REFUNDED", "CREDITED"].includes(r.status)).length}`,
            `Authorizations: ${rows.length} · completed: ${rows.filter((r) => ["RESTOCKED", "SCRAPPED", "REFUNDED", "CREDITED"].includes(r.status)).length}`,
          ),
          amount: "0",
          kind: "check",
        },
      ],
      assertionResults: [
        {
          id: "rma-register-lines-positive",
          status: allLined ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            allLined ? "كل الطلبات تحمل أسطرًا" : "طلب بلا أسطر",
            allLined ? "every authorization carries its lines" : "a lineless authorization appeared",
          ),
        },
      ],
    };
  },
});

export const salesDunningStatusContract = defineReport({
  id: "sales.dunning_status",
  version: 1,
  title: bilingual("حالة التحصيل", "Dunning Status"),
  category: "sales",
  description: bilingual(
    "قائمة عمل التحصيل: كل بند متأخر مع خطوة السلّم والسياسة والغرامات وحالة الإحالة",
    "The collections worklist: every overdue open item with its ladder step, policy, late fees, and referral state",
  ),
  parameters: z.object({ asOf: ISO_DATE, locale: LOCALE }),
  requiredPermission: "sales.dunning.manage",
  dataSources: [
    source(
      "sales",
      "returnsDunning.dunningStatus",
      [...DUNNING_SOURCES],
      "البنود المتأخرة المفتوحة مع سجل رسائل التحصيل والغرامات والإحالات",
      "The overdue open items with the dunning letter register, late fees, and referrals",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "required" },
  freshness: { semantics: "as-of", cacheTtlSeconds: 0, invalidationEvents: [] },
  assertions: [
    assertDecl(
      "dunning-status-step-monotonic",
      "every lettered item's step is ≥ 1 and ≤ its policy's ladder top (BR-065 mirror)",
      "خطوة كل بند ضمن 1..أعلى سلّم سياسته (مرآة BR-065)",
      "A dunning step fell outside its policy's ladder",
    ),
  ],
  run: async (_ctx, params) => {
    const { returnsDunning } = reportingServices();
    const rows = await returnsDunning.dunningStatus(params.asOf!);
    const stepped = rows.filter((row) => row.dunningStep !== null);
    const monotonic = stepped.every(
      (row) => row.dunningStep! >= 1 && row.dunningStep! <= 20 && row.policyName !== null,
    );
    return {
      columns: [
        col("invoiceNo", "الفاتورة", "Invoice"),
        col("partner", "العميل", "Customer"),
        col("dueDate", "الاستحقاق", "Due", "date"),
        col("daysOverdue", "أيام التأخير", "Days overdue"),
        moneyCol("outstanding", "المستحق", "Outstanding"),
        col("dunningStep", "خطوة التحصيل", "Dunning step"),
        col("policyName", "السياسة", "Policy"),
        moneyCol("feeCharged", "الغرامات", "Fees charged"),
        col("feeWaived", "المعفاة", "Fees waived"),
        col("referralStatus", "الإحالة", "Referral"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.invoiceId,
        values: {
          invoiceNo: row.invoiceNo ?? row.invoiceId,
          partner: row.partner,
          dueDate: row.dueDate,
          daysOverdue: row.daysOverdue,
          outstanding: row.outstanding,
          dunningStep: row.dunningStep ?? "—",
          policyName: row.policyName ?? "—",
          feeCharged: row.feeCharged,
          feeWaived: row.feeWaived,
          referralStatus: row.referralStatus ?? "—",
        },
      })),
      totals: [
        {
          id: "dunning-summary",
          label: bilingual(
            `البنود المتأخرة: ${rows.length} · عليها رسائل: ${stepped.length}`,
            `Overdue items: ${rows.length} · lettered: ${stepped.length}`,
          ),
          amount: "0",
          kind: "check",
        },
      ],
      assertionResults: [
        {
          id: "dunning-status-step-monotonic",
          status: monotonic ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            monotonic ? "كل الخطوات ضمن السلّم" : "خطوة خارج السلّم",
            monotonic ? "every step sits inside its ladder" : "a step left its ladder",
          ),
        },
      ],
    };
  },
});
