import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, source } from "../kit";
import { reportingServices } from "../services";
import { WORKFLOW_REPORT_VOCABULARIES } from "./workflow-queries";

/**
 * PHASE-052 (W-49 — T-14, dated 2026-11-28; REPORT_CATALOG's PHASE-052
 * row 1): `workflow.pending-approvals` — the approvals inbox's own
 * figures at the tenant register's breadth (the manager's view): one
 * row per CURRENT (the pointer's own) PENDING APPROVAL step on ACTIVE
 * chains, with the assignee, the age at the DB's own clock, the
 * overdue verdict, and the document drill facts (the engine's own
 * reader law — the same per-entity doc numbers and amount derivations
 * the inbox reads).
 *
 * The footer carries the trigger registry's own vocabulary as the
 * block-on-fail assertion (`pending-approvals-trigger-vocabulary`):
 * every row's trigger entity sits in the 0127 CHECK's own closed
 * domain (the owner's ruling (ج)).
 *
 * Permission `workflow.inbox.act` (matrix §3.30; the §12
 * module-register reuse rule — the same key the inbox's own read
 * rides).
 */

const TRIGGER_VOCABULARY = assertDecl(
  "pending-approvals-trigger-vocabulary",
  "Every row's trigger entity sits on the 0127 closed registry (the ruling (ج): manual_journal · purchase_order · change_order · duty_drawback_claim)",
  "قيمة خارج سجل المستندات المرتبطة — التصدير محجوب",
  "A value outside the bound trigger registry — export blocked",
);

function triggerVocabularyResult(
  rows: readonly { triggerEntity: string; stepInstanceId: string }[],
): AssertionResult {
  const offenders = rows.filter(
    (row) => !(WORKFLOW_REPORT_VOCABULARIES.triggerEntities as readonly string[]).includes(row.triggerEntity),
  );
  const ok = offenders.length === 0;
  return {
    id: "pending-approvals-trigger-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `خطوات خارج السجل: ${offenders.map((row) => row.stepInstanceId.slice(0, 8)).join("، ")}`,
          `Off-register step(s): ${offenders.map((row) => row.stepInstanceId.slice(0, 8)).join(", ")}`,
        ),
  };
}

export const workflowPendingApprovalsContract = defineReport({
  id: "workflow.pending-approvals",
  version: 1,
  title: bilingual("الموافقات المعلقة", "Pending Approvals"),
  category: "workflow",
  description: bilingual(
    "سجل الموافقات المعلقة على المنشأة: لكل خطوة موافقة جارية (خطوة المؤشر الحالية على سلسلة نشطة) المكلَّف بها وعمرها بساعة قاعدة البيانات نفسها وحكم التجاوز ومستندها بالمبلغ، مرتبة الأقرب استحقاقًا أولًا — الأرقام قراءات المحرك نفسه بلا أي إعادة حساب",
    "The tenant's pending-approvals register: per live approval step (the pointer's current step on an ACTIVE chain) its assignee, its age at the database's own clock, the overdue verdict, and its document with the amount — aging-first; every figure the engine's own read, zero parallel computation",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    overdueOnly: z.boolean().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "workflow.inbox.act",
  dataSources: [
    source(
      "workflow",
      "WorkflowReportQueriesService.pendingApprovals (the inbox's own pointer-step APPROVAL query at the tenant's breadth — the aging figures the DB's own clock computes)",
      ["workflow_step_instances", "workflow_instances", "users"],
      "قراءة صندوق الموافقات نفسها بعرض المنشأة",
      "The approvals inbox's own read at the tenant's breadth",
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
  assertions: [TRIGGER_VOCABULARY],
  drillTargets: [
    drill("documentId", "/workflow/approvals", "صندوق الموافقات", "The approvals inbox", "workflow.inbox.act"),
  ],
  run: async (_ctx, params) => {
    const { workflowQueries } = reportingServices();
    const rows = await workflowQueries.pendingApprovals({
      from: params.dateFrom!,
      to: params.dateTo!,
      overdueOnly: params.overdueOnly === true,
    });
    const overdue = rows.filter((row) => row.overdue).length;
    return {
      columns: [
        col("triggerEntity", "النوع", "Type"),
        col("documentNo", "المستند", "Document"),
        col("stepName", "الخطوة", "Step"),
        col("assigneeName", "المكلَّف", "Assignee"),
        col("ageHours", "العمر (ساعة)", "Age (h)", "qty"),
        col("dueAt", "الاستحقاق", "Due", "date"),
        col("overdue", "الحالة", "Status", "status"),
        moneyCol("amountBase", "المبلغ", "Amount"),
        col("currency", "العملة", "CCY"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.stepInstanceId,
        values: {
          triggerEntity: row.triggerEntity,
          documentNo: row.documentNo ?? row.documentId.slice(0, 8),
          stepName: row.stepName,
          assigneeName: row.assigneeName ?? row.assigneeUserId.slice(0, 8),
          ageHours: String(row.ageHours),
          dueAt: row.dueAt === null ? "—" : row.dueAt.slice(0, 10),
          overdue: row.overdue ? "OVERDUE" : "PENDING",
          amountBase: row.amountBase,
          currency: row.currency,
        },
      })),
      totals: [
        {
          id: "rows",
          kind: "sum",
          label: bilingual(
            `خطوات معلقة: ${rows.length} · متأخرة: ${overdue}`,
            `pending steps: ${rows.length} · overdue: ${overdue}`,
          ),
          amount: String(rows.length),
        },
      ],
      assertionResults: [triggerVocabularyResult(rows)],
      notes: [
        bilingual(
          "العمر وحكم التجاوز يحسبهما توقيت قاعدة البيانات نفسها داخل الاستعلام (قانون الساعة)؛ الخطوات المعروضة هي خطوات المؤشر الحالية على السلاسل النشطة فقط (قانون السلم — الخطوة المستقبلية لا تُعرض هنا)",
          "The age and the overdue verdict are computed by the database's own clock inside the query (the clock law); the rows are the pointer's CURRENT steps on ACTIVE chains only (the ladder law — a future step never lists)",
        ),
      ],
    };
  },
});
