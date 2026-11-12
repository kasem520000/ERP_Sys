import { z } from "zod";

import { addExact } from "../../../accounting/application/decimal-strings";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, moneyCol, source } from "../kit";
import { reportingServices } from "../services";
import type { DowntimeAnalysisRow } from "./queries";

/**
 * PHASE-042 (REPORT_CATALOG §9 addition · M-15/BR-070): the downtime
 * analysis — downtime_records × work_centers grouped by (work center,
 * reason code): the lost minutes, the record count, and the posted
 * idle-capacity cost (the G-42 policy gate stays visible — records closed
 * under the default "off" policy contribute minutes but no cost).
 */

interface DowntimeGroup {
  workCenterId: string;
  code: string;
  reasonCode: string;
  minutes: number;
  records: number;
  costSum: string;
  costedRecords: number;
}

function groupByCenterAndReason(rows: readonly DowntimeAnalysisRow[]): DowntimeGroup[] {
  const groups = new Map<string, DowntimeGroup>();
  for (const row of rows) {
    const key = `${row.workCenterId}:${row.reasonCode}`;
    const existing = groups.get(key);
    if (existing === undefined) {
      groups.set(key, {
        workCenterId: row.workCenterId,
        code: row.code,
        reasonCode: row.reasonCode,
        minutes: row.durationMinutes,
        records: 1,
        costSum: row.costAmount ?? "0.0000",
        costedRecords: row.costAmount !== null ? 1 : 0,
      });
      continue;
    }
    existing.minutes += row.durationMinutes;
    existing.records += 1;
    if (row.costAmount !== null) {
      existing.costSum = addExact(existing.costSum, row.costAmount);
      existing.costedRecords += 1;
    }
  }
  return [...groups.values()].sort(
    (a, b) => (a.code === b.code ? a.reasonCode.localeCompare(b.reasonCode) : a.code.localeCompare(b.code)),
  );
}

export const manufacturingDowntimeAnalysisContract = defineReport({
  id: "manufacturing.downtime-analysis",
  version: 1,
  title: bilingual("تحليل التوقف حسب السبب", "Downtime Analysis by Reason"),
  category: "industry",
  description: bilingual(
    "سجلات التوقف مجمّعة بمركز العمل وسبب التوقف: الدقائق المفقودة وعدد السجلات والتكلفة المرحّلة (سياسة الترحيل الافتراضية تسجل بلا تكلفة)",
    "Downtime records grouped by work center and reason code: lost minutes, record count, and the posted idle-capacity cost (the default posting policy records without cost)",
  ),
  parameters: z.object({
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    workCenterId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "manufacturing.oee.read",
  dataSources: [
    source(
      "manufacturing",
      "manufacturingExecution.downtimeAnalysis",
      ["downtime_records", "work_centers", "production_orders"],
      "سجلات التوقف مع مركز العمل والأمر المرتبط",
      "The downtime records with the work center and the linked order",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: [] },
  assertions: [
    assertDecl(
      "downtime-window-shape",
      "every group carries ≥ 1 record and non-negative minutes (the ck_downtime_records_duration floor: 0..1440 per record)",
      "كل مجموعة تحمل سجلاً واحداً على الأقل ودقائق غير سالبة (حد فحص المدة لكل سجل 0..1440)",
      "A downtime group with no records or negative minutes",
    ),
  ],
  run: async (_ctx, params) => {
    const { manufacturingExecution } = reportingServices();
    const rows = await manufacturingExecution.downtimeAnalysis({
      from: params.dateFrom!,
      to: params.dateTo!,
      // The zod uuid schema above already validated the value before run().
      workCenterId: (params.workCenterId as string | undefined) ?? undefined,
    });
    const groups = groupByCenterAndReason(rows);
    const shapeOk = groups.every((group) => group.records >= 1 && group.minutes >= 0);
    const minutesTotal = groups.reduce((sum, group) => sum + group.minutes, 0);
    const recordsTotal = groups.reduce((sum, group) => sum + group.records, 0);
    const costTotal = groups.reduce((sum, group) => addExact(sum, group.costSum), "0.0000");
    const costed = groups.reduce((sum, group) => sum + group.costedRecords, 0);
    return {
      columns: [
        col("code", "المركز", "Work center"),
        col("reasonCode", "سبب التوقف", "Reason code"),
        col("records", "السجلات", "Records", "text", true),
        col("minutes", "الدقائق", "Minutes", "text", true),
        moneyCol("costAmount", "التكلفة المرحّلة", "Posted cost"),
        col("costedRecords", "سجلات مكلفة", "Costed records", "text", true),
      ],
      groups: [],
      rows: groups.map((group) => ({
        key: `${group.workCenterId}:${group.reasonCode}`,
        group: group.code,
        values: {
          code: group.code,
          reasonCode: group.reasonCode,
          records: `${group.records}`,
          minutes: `${group.minutes}`,
          costAmount: group.costSum,
          costedRecords: `${group.costedRecords}`,
        },
      })),
      totals: [
        {
          id: "downtime-minutes-total",
          kind: "sum",
          label: bilingual(
            `إجمالي الدقائق: ${minutesTotal} · السجلات: ${recordsTotal} · المكلفة: ${costed}`,
            `total minutes: ${minutesTotal} · records: ${recordsTotal} · costed: ${costed}`,
          ),
          amount: `${minutesTotal}.0000`,
        },
        {
          id: "downtime-cost-total",
          kind: "sum",
          label: bilingual("إجمالي تكلفة التوقف المرحّلة", "Total posted downtime cost"),
          amount: costTotal,
        },
      ],
      assertionResults: [
        {
          id: "downtime-window-shape",
          status: shapeOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            shapeOk ? "كل المجموعات سليمة" : "مجموعة بلا سجلات أو بدقائق سالبة",
            shapeOk ? "every group well-formed" : "a group with no records or negative minutes",
          ),
        },
      ],
      notes: [
        bilingual(
          "السجلات المفتوحة (قبل الإغلاق) تُحتسب دقائقها صفراً؛ التكلفة تظهر فقط للسجلات المغلقة تحت سياسة الترحيل post (الافتراضي off — سجل بلا تكلفة).",
          "Open (not yet closed) records contribute zero minutes; cost appears only for records closed under the 'post' policy (the default 'off' leaves the record costless).",
        ),
      ],
    };
  },
});
