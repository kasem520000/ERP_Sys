import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, source } from "../kit";
import { reportingServices } from "../services";
import { WORKFLOW_REPORT_VOCABULARIES } from "./workflow-queries";

/**
 * PHASE-052 (W-49 — T-14, dated 2026-11-28; REPORT_CATALOG's PHASE-052
 * row 2): `workflow.sla-aging` — the escalation plane's own figures:
 * one row per awaiting step that carries an SLA (due_at not null) on
 * an ACTIVE chain, with the hours over due at the DB's own clock, the
 * breach verdict, and the escalation events' own counts (the
 * NOTIFY/REMINDER stamps the sweep wrote — the events are the sweep's
 * own records, never recomputed here). The footer carries the aging
 * buckets (≤ 24h · 24–48h · > 48h over due) as the register's own
 * summary.
 *
 * The footer carries the step-type vocabulary as the block-on-fail
 * assertion (`sla-aging-step-type-vocabulary`): every row's step type
 * sits in the 0127 CHECK's own domain (the W-10 scope note — the
 * three step types ONLY).
 *
 * Permission `workflow.escalation.manage` (matrix §3.30; the §12
 * module-register reuse rule — the same key the escalation plane's
 * own configuration rides).
 */

const STEP_TYPE_VOCABULARY = assertDecl(
  "sla-aging-step-type-vocabulary",
  "Every row's step type sits on the 0127 domain (the W-10 scope note: APPROVAL · NOTIFICATION · TASK — free-form custom actions are OUT)",
  "قيمة خارج مفردات أنواع الخطوات — التصدير محجوب",
  "A value outside the step-type vocabulary — export blocked",
);

function stepTypeVocabularyResult(
  rows: readonly { stepType: string; stepInstanceId: string }[],
): AssertionResult {
  const offenders = rows.filter(
    (row) => !(WORKFLOW_REPORT_VOCABULARIES.stepTypes as readonly string[]).includes(row.stepType),
  );
  const ok = offenders.length === 0;
  return {
    id: "sla-aging-step-type-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `خطوات خارج المفردات: ${offenders.map((row) => row.stepInstanceId.slice(0, 8)).join("، ")}`,
          `Off-vocabulary step(s): ${offenders.map((row) => row.stepInstanceId.slice(0, 8)).join(", ")}`,
        ),
  };
}

export const workflowSlaAgingContract = defineReport({
  id: "workflow.sla-aging",
  version: 1,
  title: bilingual("تقادم مهل الخدمة", "SLA Aging"),
  category: "workflow",
  description: bilingual(
    "سجل التصعيد وتقادم المهل: لكل خطوة منتظرة تحمل مهلة خدمة (على سلسلة نشطة) ساعات تجاوز المهلة بساعة قاعدة البيانات نفسها وحكم الاختراق وعدد أحداث التصعيد التي كتبها الجارى الدوري (إشعار/تذكير) ومستندها، مرتبة الأشد تجاوزًا أولًا؛ الملخص يحمل شرائح التقادم (≤ ٢٤ ساعة · ٢٤–٤٨ · أكثر من ٤٨) — الأرقام قراءات محرك التصعيد نفسه",
    "The escalation + SLA-aging register: per awaiting step that carries an SLA (on an ACTIVE chain) its hours over due at the database's own clock, the breach verdict, the escalation events count the sweep wrote (NOTIFY/REMINDER), and its document — most-over-due first; the footer carries the aging buckets (≤ 24h · 24–48h · > 48h) — every figure the escalation plane's own read",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "workflow.escalation.manage",
  dataSources: [
    source(
      "workflow",
      "WorkflowReportQueriesService.slaAging (the escalation plane's own awaiting-steps read + the sweep's own escalation_events counts — the clock law verbatim)",
      ["workflow_step_instances", "workflow_instances", "escalation_events", "users"],
      "قراءات مستوى التصعيد نفسه مع طوابع الجاري الدوري",
      "The escalation plane's own reads with the sweep's own stamps",
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
  assertions: [STEP_TYPE_VOCABULARY],
  drillTargets: [
    drill("documentId", "/workflow/approvals", "صندوق الموافقات", "The approvals inbox", "workflow.inbox.act"),
  ],
  run: async (_ctx, params) => {
    const { workflowQueries } = reportingServices();
    const rows = await workflowQueries.slaAging({
      from: params.dateFrom!,
      to: params.dateTo!,
    });
    const breached = rows.filter((row) => row.breached);
    const within24 = breached.filter((row) => row.hoursOverDue <= 24).length;
    const within48 = breached.filter((row) => row.hoursOverDue > 24 && row.hoursOverDue <= 48).length;
    const beyond48 = breached.filter((row) => row.hoursOverDue > 48).length;
    const reminders = rows.reduce((sum, row) => sum + row.escalationEvents, 0);
    return {
      columns: [
        col("triggerEntity", "النوع", "Type"),
        col("documentNo", "المستند", "Document"),
        col("stepName", "الخطوة", "Step"),
        col("stepType", "نوع الخطوة", "Step type"),
        col("assigneeName", "المكلَّف", "Assignee"),
        col("dueAt", "الاستحقاق", "Due", "date"),
        col("hoursOverDue", "ساعات التجاوز", "Hours over", "qty"),
        col("breached", "الحالة", "Status", "status"),
        col("escalationEvents", "أحداث التصعيد", "Escalations", "qty"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.stepInstanceId,
        values: {
          triggerEntity: row.triggerEntity,
          documentNo: row.documentNo ?? row.documentId.slice(0, 8),
          stepName: row.stepName,
          stepType: row.stepType,
          assigneeName: row.assigneeName ?? row.assigneeUserId.slice(0, 8),
          dueAt: row.dueAt.slice(0, 10),
          hoursOverDue: String(row.hoursOverDue),
          breached: row.breached ? "BREACHED" : "AWAITING",
          escalationEvents: String(row.escalationEvents),
        },
      })),
      totals: [
        {
          id: "rows",
          kind: "sum",
          label: bilingual(
            `خطوات بمهل: ${rows.length} · مخترقة: ${breached.length} (≤٢٤س: ${within24} · ٢٤–٤٨س: ${within48} · أكثر من ٤٨س: ${beyond48}) · أحداث تصعيد: ${reminders}`,
            `SLA steps: ${rows.length} · breached: ${breached.length} (≤24h: ${within24} · 24–48h: ${within48} · >48h: ${beyond48}) · escalation events: ${reminders}`,
          ),
          amount: String(rows.length),
        },
      ],
      assertionResults: [stepTypeVocabularyResult(rows)],
      notes: [
        bilingual(
          "ساعات التجاوز وحكم الاختراق يحسبهما توقيت قاعدة البيانات نفسها داخل الاستعلام (قانون الساعة — الجاري الدوري نفسه)؛ أحداث التصعيد طوابع الجاري الدوري كما كتبها (القفل البنيوي يمنع التكرار) — لا يُشغَّل الجاري هنا أبدًا: التقرير قراءة لا إنذار",
          "The hours-over-due and the breach verdict are computed by the database's own clock inside the query (the clock law — the sweep's own); the escalation events are the sweep's own stamps as it wrote them (the structural dedupe prevents doubles) — the sweep is NEVER run here: a report is a read, never the alerting act",
        ),
      ],
    };
  },
});
