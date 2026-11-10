import { z } from "zod";

import { assertExact } from "../../application/assertions";
import { addExact, compareExact, subExact } from "../../../accounting/application/decimal-strings";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-019 T49 · the two PHASE-019 services report contracts
 * (industries/reports/README PHASE-019 rows — registered over the
 * PHASE-013 report contract; the report keys the professional-services
 * manifest pins verbatim, both dashboard:true):
 *
 * - `services.contract_revenue_schedule` — per contract × period/milestone:
 *   the frozen billing schedule (contracted) vs the posted invoices
 *   (invoiced net/VAT/gross) vs the drafts (DRAFT/PENDING_APPROVAL/APPROVED)
 *   vs the backlog (contracted − invoiced − draft) + the overdue AR
 *   open-item bucket at asOf (the ar.aging formula scoped to the posted
 *   contract invoices). GL tie: Σ invoiced net == Σ revenue-account CREDIT
 *   lines of those invoices' posted journals (tolerance 0) + the
 *   reconciliation invariant Σ contracted == Σ invoiced + Σ draft + Σ
 *   backlog (per contract, where all defined).
 * - `services.time_billing_summary` — per project × fee-earner: hours
 *   recorded vs billable vs invoiced with amounts = hours × the snapshotted
 *   rates (§6 determinism). Operational — no GL assertion (README rule 2).
 *
 * Bilingual AR/EN everywhere (Arabic first), money as canonical 4-decimal
 * strings (ADR-0009), read-only derivations over the CRM query surface via
 * `reportingServices()` — the shared contract supplies parameters, scoping,
 * drill-down, export, and print. Permissions reuse the 0027 seed (no new
 * keys): crm.contracts.manage.
 */

const WINDOW_PARAMS = {
  dateFrom: ISO_DATE,
  dateTo: ISO_DATE,
  locale: LOCALE,
};

// -- assertions (the README rule-1/rule-2 tie-outs) ----------------------------------

const CONTRACT_REVENUE_GL_TIE = assertDecl(
  "contract-revenue-gl-tie",
  "Σ invoiced net in window == Σ CREDIT lines on the SERVICE_REVENUE/SALES_REVENUE accounts of the posted contract invoices' journals",
  "صافي المفوتر في الفترة لا يطابق أرصدة حسابات الإيراد لقيود فواتير العقود المرحّلة",
  "Invoiced net in the window does not tie to the revenue-account lines of the posted contract-invoice journals",
  "INV-010",
);

const SCHEDULE_RECONCILIATION = assertDecl(
  "schedule-reconciliation",
  "per contract: Σ contracted == Σ invoiced net + Σ draft net + Σ backlog (where all defined)",
  "جدول الفوترة لا يتوازن: المتعاقد لا يساوي المفوتر + المسودة + المتبقي",
  "The billing schedule does not reconcile: contracted != invoiced + draft + backlog",
  "INV-013",
);

/** The README rule-2 labeling note for the operational (non-GL) report. */
const OPERATIONAL_NOTE = bilingual(
  "تقرير تشغيلي: الأرقام المعروضة مستمدة من مستندات وقيود مرحّلة يطابقها دفتر الأستاذ عبر تقارير الإيرادات والذمم — لا يُشترط قيد مطابقة مستقل هنا (قاعدة ٢ من دليل تقارير الصناعات)",
  "Operational report: the figures shown derive from posted documents and journals that the ledger reconciles through the revenue/AR reports — no standalone GL tie-out is required here (industry-reports rule 2)",
);

/**
 * Exact 6-dp sum for the qty (hours) columns — the qty canonical scale
 * (the decimal-strings BigInt discipline, at the 6-dp qty scale instead
 * of the 4-dp money scale).
 */
function addQty(a: string, b: string): string {
  const SCALE_POW = 1_000_000n;
  const toMicro = (value: string): bigint => {
    const negative = value.startsWith("-");
    const [int = "0", frac = ""] = value.replace("-", "").split(".");
    const micro = BigInt(int) * SCALE_POW + BigInt(frac.slice(0, 6).padEnd(6, "0"));
    return negative ? -micro : micro;
  };
  const micro = toMicro(a) + toMicro(b);
  const negative = micro < 0n;
  const abs = negative ? -micro : micro;
  const whole = abs / SCALE_POW;
  const frac = (abs % SCALE_POW).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

// ---------------------------------------------------------------------------
// services.contract_revenue_schedule — جدول إيرادات العقود
// ---------------------------------------------------------------------------

export const servicesContractRevenueScheduleContract = defineReport({
  id: "services.contract_revenue_schedule",
  version: 1,
  title: bilingual("جدول إيرادات العقود", "Contract Revenue Schedule"),
  category: "industry",
  description: bilingual(
    "لكل عقد × فترة/مرحلة: المتعاقد (جدول الفوترة المجمد) مقابل المفوتر (المرحّل) والمسودة والمتبقي، مع بند المتأخرات = المبالغ المفتوحة لفواتير العقد المرحّلة المستحقة قبل تاريخ التقرير — صافي المفوتر يطابق حسابات الإيراد في القيود المرحّلة (تطابق تام)",
    "Per contract × period/milestone: the frozen billing schedule (contracted) vs posted invoices (invoiced) vs drafts vs backlog, with the overdue column = the posted contract invoices' open amounts past due at asOf — invoiced net tied exactly to the revenue accounts of the posted journals",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    contractId: z.string().uuid().optional(),
    asOf: ISO_DATE.optional(),
  }),
  requiredPermission: "crm.contracts.manage",
  dataSources: [
    source(
      "crm",
      "crmQueries.contractRevenueSchedule",
      [
        "service_contracts",
        "contract_billing_schedule",
        "contract_invoices",
        "crm_time_entries",
        "partners",
        "projects",
      ],
      "عقود الخدمات مع جداول الفوترة وفواتيرها",
      "Service contracts with their billing schedules and invoices",
    ),
    source(
      "sales",
      "sales_invoices + the AR partner subledger (invoiced/draft statuses, the overdue open items)",
      ["sales_invoices", "partner_subledger_entries", "treasury_allocations"],
      "حالات الفواتير وبنود الذمم المفتوحة للمتأخرات",
      "The invoice statuses and the AR open items for the overdue bucket",
    ),
    source(
      "accounting",
      "journal (the revenue GL tie)",
      ["journal_entries", "journal_lines"],
      "قيود فواتير العقود لمطابقة الإيراد",
      "The contract-invoice journals for the revenue tie-out",
    ),
  ],
  scopeRules: { asOf: "optional" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "contracted", kind: "sum" },
      { id: "invoicedNet", kind: "sum" },
      { id: "draftNet", kind: "sum" },
      { id: "backlog", kind: "sum" },
      { id: "overdue", kind: "sum" },
    ],
    sorting: [{ by: "contractNo", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted", "invoice.posted"],
  },
  assertions: [CONTRACT_REVENUE_GL_TIE, SCHEDULE_RECONCILIATION],
  run: async (_ctx, params) => {
    const { crm } = reportingServices();
    const asOf = params.asOf ?? params.dateTo!;
    const rows = await crm.contractRevenueSchedule({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      asOf,
      contractId: params.contractId ?? null,
    });

    const sum = (pick: (row: (typeof rows)[number]) => string | null): string =>
      rows.reduce((acc, row) => addExact(acc, pick(row) ?? "0.0000"), "0.0000");
    const contractedTotal = sum((row) => row.contracted);
    const invoicedNetTotal = sum((row) => row.invoicedNet);
    const draftNetTotal = sum((row) => row.draftNet);
    const backlogTotal = sum((row) => row.backlog);
    const overdueTotal = sum((row) => row.overdue);

    // The reconciliation invariant (per contract, where all defined):
    // Σ contracted == Σ invoiced + Σ draft + Σ backlog. Computed per
    // contract across the window's rows; the single assertion carries the
    // worst offender in `compared` when any contract fails.
    let reconciliationOk = true;
    let reconciliationDetail = "";
    const byContract = new Map<
      string,
      { contracted: string; invoiced: string; draft: string; backlog: string }
    >();
    for (const row of rows) {
      if (row.contracted === null) continue; // HOURLY operational rows
      const bucket = byContract.get(row.contractId) ?? {
        contracted: "0.0000",
        invoiced: "0.0000",
        draft: "0.0000",
        backlog: "0.0000",
      };
      bucket.contracted = addExact(bucket.contracted, row.contracted);
      bucket.invoiced = addExact(bucket.invoiced, row.invoicedNet);
      bucket.draft = addExact(bucket.draft, row.draftNet);
      bucket.backlog = addExact(bucket.backlog, row.backlog ?? "0.0000");
      byContract.set(row.contractId, bucket);
    }
    let contractedAll = "0.0000";
    let reconciledAll = "0.0000";
    for (const [contractId, bucket] of byContract) {
      contractedAll = addExact(contractedAll, bucket.contracted);
      const reconciled = addExact(
        bucket.invoiced,
        addExact(bucket.draft, bucket.backlog),
      );
      reconciledAll = addExact(reconciledAll, reconciled);
      if (compareExact(bucket.contracted, reconciled) !== 0) {
        reconciliationOk = false;
        reconciliationDetail = `${contractId}:${subExact(bucket.contracted, reconciled)}`;
      }
    }

    const tie = await crm.contractRevenueGlTie({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      contractId: params.contractId ?? null,
    });

    return {
      columns: [
        col("contractNo", "رقم العقد", "Contract"),
        col("partnerName", "العميل", "Customer"),
        col("partnerNameAr", "العميل (عربي)", "Customer (AR)"),
        col("projectCode", "المشروع", "Project"),
        col("periodKey", "الفترة", "Period"),
        col("milestoneLabel", "المرحلة", "Milestone"),
        col("entryType", "نوع البند", "Entry type", "status"),
        col("billDate", "تاريخ الفوترة", "Bill date", "date"),
        col("entryStatus", "حالة البند", "Entry status", "status"),
        moneyCol("contracted", "المتعاقد", "Contracted"),
        moneyCol("invoicedNet", "المفوتر (صافي)", "Invoiced net"),
        moneyCol("invoicedVat", "ضريبة مفروحة", "Invoiced VAT"),
        moneyCol("invoicedGross", "المفوتر (إجمالي)", "Invoiced gross"),
        moneyCol("draftNet", "مسودة (صافي)", "Draft net"),
        moneyCol("backlog", "المتبقي", "Backlog"),
        moneyCol("overdue", "متأخرات مستحقة", "Overdue"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.contractId}:${row.scheduleEntryId}`,
        values: {
          contractNo: row.contractNo,
          partnerName: row.partnerName,
          partnerNameAr: row.partnerNameAr,
          projectCode: row.projectCode,
          periodKey: row.periodKey,
          milestoneLabel: row.milestoneLabel,
          entryType: row.entryType,
          billDate: row.billDate,
          entryStatus: row.entryStatus,
          contracted: row.contracted,
          invoicedNet: row.invoicedNet,
          invoicedVat: row.invoicedVat,
          invoicedGross: row.invoicedGross,
          draftNet: row.draftNet,
          backlog: row.backlog,
          overdue: row.overdue,
        },
      })),
      totals: [
        {
          id: "contractedTotal",
          kind: "sum",
          label: bilingual("إجمالي المتعاقد", "Total contracted"),
          amount: contractedTotal,
        },
        {
          id: "invoicedNetTotal",
          kind: "sum",
          label: bilingual("إجمالي المفوتر (صافي)", "Total invoiced net"),
          amount: invoicedNetTotal,
        },
        {
          id: "draftNetTotal",
          kind: "sum",
          label: bilingual("إجمالي المسودات (صافي)", "Total draft net"),
          amount: draftNetTotal,
        },
        {
          id: "backlogTotal",
          kind: "sum",
          label: bilingual("إجمالي المتبقي", "Total backlog"),
          amount: backlogTotal,
        },
        {
          id: "overdueTotal",
          kind: "sum",
          label: bilingual("إجمالي المتأخرات", "Total overdue"),
          amount: overdueTotal,
        },
      ],
      assertionResults: [
        assertExact("contract-revenue-gl-tie", tie.registerSide, tie.glSide),
        {
          id: "schedule-reconciliation",
          status: reconciliationOk ? "PASS" : "FAIL",
          compared: {
            left: contractedAll,
            right: reconciledAll,
            ...(reconciliationOk ? {} : { detail: reconciliationDetail }),
          },
        },
      ],
      notes: [
        bilingual(
          "بند المتأخرات = المبالغ المفتوحة لفواتير العقد المرحّلة المستحقة قبل تاريخ التقرير (نفس معادلة أعمار الذمم لنفس التاريخ — حتمية BR-028)؛ دفعات التقديم المعمّرة (قيود إعادة التصنيف) ليست فواتير عقود ولا تُخصم هنا — تظهر في تقرير أعمار الذمم.",
          "The overdue column = the posted contract invoices' open amounts past due at asOf (the ar.aging formula for the same date — BR-028 determinism); the reclassified advance debits are not contract invoices and are not netted here — they stay visible on the AR aging report.",
        ),
        bilingual(
          "صفوف الساعة (HOURLY): المتعاقد والمتبقي فارغان — جدول الساعات لا يحمل مبلغاً مجمداً (يحتسب عند التشغيل)؛ تعرض الصفوف فواتيرها المولّدة فقط (تفصيل تشغيلي صادق).",
          "HOURLY rows: contracted and backlog are NULL — the hourly grid carries no frozen amount (computed at the run); the rows report their generated invoices only (the honest operational labeling).",
        ),
      ],
    };
  },
});

// ---------------------------------------------------------------------------
// services.time_billing_summary — ملخص وقت العمل والفوترة
// ---------------------------------------------------------------------------

export const servicesTimeBillingSummaryContract = defineReport({
  id: "services.time_billing_summary",
  version: 1,
  title: bilingual("ملخص وقت العمل والفوترة", "Time & Billing Summary"),
  category: "industry",
  description: bilingual(
    "لكل مشروع × منفذ رسوم: الساعات المسجلة مقابل القابلة للفوترة مقابل المفروحة فعلاً، والمبالغ = الساعات × الأسعار الملتقطة عند التسجيل (لا تُعاد احتساباً لاحقاً)",
    "Per project × fee-earner: hours recorded vs billable vs invoiced, with amounts = hours × the rates snapshotted at recording (never recomputed)",
  ),
  parameters: z.object({
    ...WINDOW_PARAMS,
    projectId: z.string().uuid().optional(),
  }),
  requiredPermission: "crm.contracts.manage",
  dataSources: [
    source(
      "crm",
      "crmQueries.timeBillingSummary",
      ["crm_time_entries", "projects", "service_contracts"],
      "قيود الوقت مع مشاريعها وعقودها",
      "The time entries with their projects and contracts",
    ),
    source(
      "sales",
      "sales_invoices (the billedInvoiceId stamp)",
      ["sales_invoices"],
      "فواتير السحب المرتبطة بقيود الوقت",
      "The invoices the billed time entries link to",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  currencyPresentation: "base",
  aggregation: {
    groupBy: [],
    measures: [
      { id: "recordedHours", kind: "sum" },
      { id: "invoicedAmount", kind: "sum" },
    ],
    sorting: [{ by: "projectCode", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "sum", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 60,
    invalidationEvents: ["invoice.posted"],
  },
  assertions: [],
  run: async (_ctx, params) => {
    const { crm } = reportingServices();
    const rows = await crm.timeBillingSummary({
      fromDate: params.dateFrom!,
      toDate: params.dateTo!,
      projectId: params.projectId ?? null,
    });
    let recordedHoursTotal = "0.000000";
    let billableHoursTotal = "0.000000";
    let invoicedHoursTotal = "0.000000";
    let recordedAmountTotal = "0.0000";
    let billableAmountTotal = "0.0000";
    let invoicedAmountTotal = "0.0000";
    for (const row of rows) {
      recordedHoursTotal = addQty(recordedHoursTotal, row.recordedHours);
      billableHoursTotal = addQty(billableHoursTotal, row.billableHours);
      invoicedHoursTotal = addQty(invoicedHoursTotal, row.invoicedHours);
      recordedAmountTotal = addExact(recordedAmountTotal, row.recordedAmount);
      billableAmountTotal = addExact(billableAmountTotal, row.billableAmount);
      invoicedAmountTotal = addExact(invoicedAmountTotal, row.invoicedAmount);
    }
    return {
      columns: [
        col("projectCode", "المشروع", "Project"),
        col("projectName", "اسم المشروع", "Project name"),
        col("feeEarnerName", "منفذ الرسوم", "Fee earner"),
        qtyCol("recordedHours", "ساعات مسجلة", "Recorded hours"),
        qtyCol("billableHours", "ساعات قابلة للفوترة", "Billable hours"),
        qtyCol("invoicedHours", "ساعات مفروحة", "Invoiced hours"),
        moneyCol("recordedAmount", "قيمة المسجل", "Recorded amount"),
        moneyCol("billableAmount", "قيمة القابل للفوترة", "Billable amount"),
        moneyCol("invoicedAmount", "قيمة المفروح", "Invoiced amount"),
        col("entryCount", "عدد القيود", "Entries", "text", true),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: `${row.projectId ?? "none"}:${row.feeEarnerUserId ?? "none"}`,
        values: {
          projectCode: row.projectCode,
          projectName: row.projectName,
          feeEarnerName: row.feeEarnerName,
          recordedHours: row.recordedHours,
          billableHours: row.billableHours,
          invoicedHours: row.invoicedHours,
          recordedAmount: row.recordedAmount,
          billableAmount: row.billableAmount,
          invoicedAmount: row.invoicedAmount,
          entryCount: row.entryCount,
        },
      })),
      totals: [
        {
          id: "recordedHoursTotal",
          kind: "sum",
          label: bilingual("إجمالي الساعات المسجلة", "Total recorded hours"),
          amount: recordedHoursTotal,
        },
        {
          id: "billableHoursTotal",
          kind: "sum",
          label: bilingual("إجمالي الساعات القابلة للفوترة", "Total billable hours"),
          amount: billableHoursTotal,
        },
        {
          id: "invoicedHoursTotal",
          kind: "sum",
          label: bilingual("إجمالي الساعات المفروحة", "Total invoiced hours"),
          amount: invoicedHoursTotal,
        },
        {
          id: "recordedAmountTotal",
          kind: "sum",
          label: bilingual("إجمالي قيمة المسجل", "Total recorded amount"),
          amount: recordedAmountTotal,
        },
        {
          id: "billableAmountTotal",
          kind: "sum",
          label: bilingual("إجمالي قيمة القابل للفوترة", "Total billable amount"),
          amount: billableAmountTotal,
        },
        {
          id: "invoicedAmountTotal",
          kind: "sum",
          label: bilingual("إجمالي قيمة المفروح", "Total invoiced amount"),
          amount: invoicedAmountTotal,
        },
      ],
      assertionResults: [],
      notes: [
        OPERATIONAL_NOTE,
        bilingual(
          "المبالغ = الساعات × السعر الملتقط عند تسجيل القيد (سياسة عدم إعادة الاحتساب — §6)؛ المسجل يشمل كل القيود غير الملغاة، والمفروح = القيود المرتبطة بفواتير.",
          "Amounts = hours × the unit rate snapshotted at recording (the never-recompute policy — §6); recorded counts every non-VOID entry, invoiced = the entries linked to invoices.",
        ),
      ],
    };
  },
});
