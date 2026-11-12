import { z } from "zod";
import { Decimal } from "@erp/domain-core";

import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-042 (REPORT_CATALOG §9 addition · M-16/OA-06): the work-center
 * utilization + OEE report — one row per work center × day over
 * v_work_center_oee_daily: the planned vs actual conversion hours, the
 * downtime minutes, and the four OEE legs rendered as numeric(7,4)
 * percentage strings (the canonical ADR-0009 4dp rendering).
 *
 * The leg formulas (documented decision — the view carries the raw folds,
 * the contract carries the ratio semantics):
 *   availability = (planned×60 − downtime) / (planned×60) × 100 — guarded
 *     planned > 0, else "0.0000" (a day with no planned operations has no
 *     availability ratio to state).
 *   performance  = actual / planned × 100 — from the view's planned_hours
 *     vs actual_hours columns (the std-times fold over the day's operations);
 *     values above 100 are legitimate (actual conversion exceeding the
 *     frozen standard — the honest signal, never clamped).
 *   quality      = completed_operations / total_operations × 100 — the
 *     operation-completion leg. The operation-scrap quality leg lands with
 *     PHASE-050's inspection hook (the view's scrap_qty rides the row's
 *     note); skipped operations count as resolved, not quality loss.
 *   oee          = availability × performance × quality / 10000 — computed
 *     from the RENDERED 4dp legs so the row's arithmetic is exactly
 *     reproducible by the reader (the 4dp quantum is the contract).
 */

function round4(value: Decimal): string {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

export const manufacturingWorkCenterUtilizationContract = defineReport({
  id: "manufacturing.work-center-utilization",
  version: 1,
  title: bilingual("استغلال مراكز العمل ومؤشر OEE", "Work-Center Utilization & OEE"),
  category: "industry",
  description: bilingual(
    "لكل مركز عمل ويوم: الساعات المخططة والفعلية ودقائق التوقف مع أرجل التوافر والأداء والجودة والمؤشر الكلي OEE — من منظور OEE اليومي عبر مراكز العمل",
    "Per work center and day: planned vs actual hours, downtime minutes, and the availability/performance/quality/OEE legs — the daily OEE view over the work centers",
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
      "manufacturingExecution.workCenterUtilization",
      ["v_work_center_oee_daily", "work_centers"],
      "منظور OEE اليومي مع هوية مركز العمل",
      "The daily OEE view with the work-center identity",
    ),
  ],
  scopeRules: { asOf: "forbidden" },
  freshness: { semantics: "current", cacheTtlSeconds: 60, invalidationEvents: [] },
  assertions: [
    assertDecl(
      "oee-availability-window",
      "every availability leg is within 0..100 (a leg outside the window means the downtime window exceeds the planned window — a master-data anomaly worth blocking)",
      "كل رجل توافر ضمن 0..100 (خارج النطاق يعني أن نافذة التوقف تتجاوز النافذة المخططة)",
      "An availability leg outside 0..100",
    ),
    assertDecl(
      "oee-legs-shape",
      "every leg renders as a canonical non-negative 4dp decimal string (ADR-0009)",
      "كل رجل يُعرض كسلسلة عشرية مكونة من أربع خانات غير سالبة",
      "A malformed OEE leg",
    ),
  ],
  run: async (_ctx, params) => {
    const { manufacturingExecution } = reportingServices();
    const rows = await manufacturingExecution.workCenterUtilization({
      from: params.dateFrom!,
      to: params.dateTo!,
      // The zod uuid schema above already validated the value before run().
      workCenterId: (params.workCenterId as string | undefined) ?? undefined,
    });
    const rendered = rows.map((row) => {
      const plannedHours = new Decimal(row.plannedHours);
      const actualHours = new Decimal(row.actualHours);
      const plannedMinutes = plannedHours.times(60);
      const availability =
        plannedMinutes.greaterThan(0)
          ? round4(
              plannedMinutes
                .minus(new Decimal(row.downtimeMinutes))
                .div(plannedMinutes)
                .times(100),
            )
          : "0.0000";
      const performance =
        plannedHours.greaterThan(0) ? round4(actualHours.div(plannedHours).times(100)) : "0.0000";
      const quality =
        row.totalOperations > 0
          ? round4(new Decimal(row.completedOperations).div(row.totalOperations).times(100))
          : "0.0000";
      const oee = round4(
        new Decimal(availability)
          .times(new Decimal(performance))
          .times(new Decimal(quality))
          .div(10000),
      );
      return {
        row,
        availability,
        performance,
        quality,
        oee,
      };
    });
    const availabilityOk = rendered.every(
      (entry) =>
        new Decimal(entry.availability).greaterThanOrEqualTo(0) &&
        new Decimal(entry.availability).lessThanOrEqualTo(100),
    );
    const legsShapeOk = rendered.every((entry) =>
      [entry.availability, entry.performance, entry.quality, entry.oee].every(
        (leg) => /^-?\d+\.\d{4}$/.test(leg) && new Decimal(leg).greaterThanOrEqualTo(0),
      ),
    );
    const downtimeTotal = rendered.reduce(
      (sum, entry) => sum + entry.row.downtimeMinutes,
      0,
    );
    const centers = new Set(rendered.map((entry) => entry.row.workCenterId)).size;
    const locale = params.locale ?? "ar";
    return {
      columns: [
        col("code", "المركز", "Work center"),
        col("name", "اسم المركز", "Center name"),
        col("day", "اليوم", "Day", "date"),
        col("plannedHours", "ساعات مخططة", "Planned hours", "qty", true),
        col("actualHours", "ساعات فعلية", "Actual hours", "qty", true),
        col("downtimeMinutes", "دقائق التوقف", "Downtime (min)", "text", true),
        col("completedOperations", "عمليات مكتملة", "Completed ops", "text", true),
        col("skippedOperations", "عمليات متجاوزة", "Skipped ops", "text", true),
        col("availabilityPct", "التوافر %", "Availability %", "text", true),
        col("performancePct", "الأداء %", "Performance %", "text", true),
        col("qualityPct", "الجودة %", "Quality %", "text", true),
        col("oeePct", "OEE %", "OEE %", "text", true),
      ],
      groups: [],
      rows: rendered.map((entry) => ({
        key: `${entry.row.workCenterId}:${entry.row.day}`,
        group: entry.row.code,
        values: {
          code: entry.row.code,
          name: locale === "ar" ? (entry.row.nameAr ?? entry.row.name) : entry.row.name,
          day: entry.row.day,
          plannedHours: entry.row.plannedHours,
          actualHours: entry.row.actualHours,
          downtimeMinutes: `${entry.row.downtimeMinutes}`,
          completedOperations: `${entry.row.completedOperations}`,
          skippedOperations: `${entry.row.skippedOperations}`,
          availabilityPct: entry.availability,
          performancePct: entry.performance,
          qualityPct: entry.quality,
          oeePct: entry.oee,
        },
      })),
      totals: [
        {
          id: "downtime-minutes-total",
          kind: "sum",
          label: bilingual(
            `مراكز: ${centers} · صفوف: ${rendered.length} · إجمالي دقائق التوقف`,
            `centers: ${centers} · rows: ${rendered.length} · total downtime minutes`,
          ),
          amount: `${downtimeTotal}.0000`,
        },
      ],
      assertionResults: [
        {
          id: "oee-availability-window",
          status: availabilityOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            availabilityOk ? "كل أرجل التوافر ضمن 0..100" : "رجل توافر خارج 0..100",
            availabilityOk ? "every availability leg within 0..100" : "an availability leg outside 0..100",
          ),
        },
        {
          id: "oee-legs-shape",
          status: legsShapeOk ? ("PASS" as const) : ("FAIL" as const),
          detail: bilingual(
            legsShapeOk ? "الأرجل بصيغة عشرية 4dp سليمة" : "رجل بصيغة غير سليمة",
            legsShapeOk ? "legs render as canonical 4dp decimals" : "a malformed leg",
          ),
        },
      ],
      notes: [
        bilingual(
          "الأداء = الفعلي ÷ المخطط × ١٠٠ من منظور OEE (قد يتجاوز ١٠٠ بصدق)؛ الجودة = العمليات المكتملة ÷ الإجمالي — رجل جودة التالف الإحصائي ترتبط بإحصاء الفحص في مرحلة لاحقة؛ OEE = التوافر × الأداء × الجودة ÷ ١٠٠٠٠ من الأرجل المعروضة.",
          "Performance = actual ÷ planned × 100 off the OEE view (values above 100 are honest, never clamped); quality = completed ÷ total operations — the statistical-scrap quality leg lands with the inspection hook; OEE = availability × performance × quality ÷ 10000 over the rendered legs.",
        ),
      ],
    };
  },
});
