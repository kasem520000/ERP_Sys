import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { LOCALE, assertDecl, bilingual, col, defineReport, drill, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-050 (W-30 — T-17, dated 2026-11-23; REPORT_CATALOG §9's
 * PHASE-050 row 3): `quality.calibration-due` — the calibration due
 * report over THE SWEEP'S OWN PROBE SHAPE (D-18): the effective
 * thresholds ladder (stored ∪ the documented default [30,7,0],
 * normalized by the pure fold — the same config the sweep's settings
 * surface renders) folded into the DISJOINT bands, then ONE probe per
 * band over the ACTIVE instruments' LATEST calibration due dates (the
 * latest-first law is the probe's own — a re-calibrated instrument's
 * current obligation is its newest due date). The report NEVER runs the
 * sweep — a report is never the alerting act; it renders the same
 * window the alerts name, with the days derived from the DATABASE'S OWN
 * CURRENT_DATE inside the probe's SQL (the derived-step clock law).
 *
 * The footer carries the band law as the block-on-fail assertion
 * (`calibration-band-vocabulary`): every rendered row's band is one of
 * the effective ladder's own thresholds — a band outside the ladder is
 * a shape violation and blocks the export.
 *
 * Permission `quality.view` (matrix §3.28; the §12 module-register
 * reuse rule — the same key the /quality/calibration reads ride).
 */

const CALIBRATION_BAND_VOCABULARY = assertDecl(
  "calibration-band-vocabulary",
  "Every rendered row's band threshold is one of the effective thresholds ladder's own windows (the sweep's disjoint-band fold — every instrument in exactly one band)",
  "نافذة خارج سلّم العتبات الفعّالة — التصدير محجوب",
  "A band outside the effective thresholds ladder — export blocked",
);

function calibrationBandResult(
  thresholds: readonly number[],
  bands: readonly { threshold: number }[],
): AssertionResult {
  const ladder = new Set(thresholds);
  const ok = bands.every((band) => ladder.has(band.threshold));
  return {
    id: "calibration-band-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `نافذة خارج السلّم: ${bands.map((band) => band.threshold).join("، ")}`,
          `Band(s) outside the ladder: ${bands.map((band) => band.threshold).join(", ")}`,
        ),
  };
}

/** The band's own label (the sweep's windows verbatim — the threshold's
 * day window, bilingual). */
function bandLabel(band: { threshold: number; fromDays: number | null }, locale: "ar" | "en"): string {
  if (band.fromDays === null) {
    return locale === "ar"
      ? `استحقاق ضمن ${band.threshold} يوم (شامل الاستحقاق الفائت)`
      : `due within ${band.threshold} day(s) (overdue included)`;
  }
  return locale === "ar"
    ? `استحقاق خلال ${band.fromDays}–${band.threshold} يومًا`
    : `due in ${band.fromDays}–${band.threshold} day(s)`;
}

export const qualityCalibrationDueContract = defineReport({
  id: "quality.calibration-due",
  version: 1,
  title: bilingual("استحقاقات المعايرة", "Calibration Due"),
  category: "quality",
  description: bilingual(
    "تقرير استحقاق معايرة الأجهزة على مجسات الكنس نفسها: سلّم العتبات الفعّالة (المخزن أو الافتراضي الموثق ٣٠/٧/٠) مطويًا إلى نوافذ منفصلة، ولكل نافذة الأجهزة النشطة التي يقع أحدث تاريخ استحقاق معايرتها ضمنها — التواريخ مشتقة على تاريخ القاعدة نفسه، والتقرير لا يشغّل الكنس أبدًا",
    "The instrument calibration due report over the sweep's own probes: the effective thresholds ladder (stored or the documented [30,7,0] default) folded into disjoint windows, and per window the ACTIVE instruments whose LATEST calibration due date falls inside — the dates derived against the database's own date, and the report never runs the sweep",
  ),
  parameters: z.object({
    locale: LOCALE,
  }),
  requiredPermission: "quality.view",
  dataSources: [
    source(
      "quality",
      "QualityReportQueriesService.calibrationDue (the sweep engine's effective config + the scanCalibrationDue probe per disjoint band — the same reads the alerting sweep rides)",
      ["calibration_records", "assets", "tenant_settings"],
      "مجسات الكنس على سجل المعايرة والأجهزة النشطة",
      "The sweep's own probes over the calibration register and the active instruments",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  aggregation: {
    groupBy: ["band"],
    measures: [{ id: "instruments", kind: "count" }],
    sorting: [{ by: "dueDate", dir: "asc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "none", subTotalsByGroup: false },
  freshness: { semantics: "current", cacheTtlSeconds: 300, invalidationEvents: [] },
  assertions: [CALIBRATION_BAND_VOCABULARY],
  drillTargets: [
    drill("assetId", "/quality/calibration", "سجل المعايرة", "The calibration register", "quality.view"),
  ],
  run: async (_ctx, params) => {
    const { qualityQueries } = reportingServices();
    const locale = params.locale === "en" ? "en" : "ar";
    const { today, thresholds, bands } = await qualityQueries.calibrationDue();
    const groups = bands.map((entry, index) => ({
      key: `band-${entry.band.threshold}-${index}`,
      label: bilingual(
        `${bandLabel(entry.band, "ar")} (${entry.instruments.length})`,
        `${bandLabel(entry.band, "en")} (${entry.instruments.length})`,
      ),
    }));
    const rows = bands.flatMap((entry, index) =>
      entry.instruments.map((instrument) => ({
        key: `${instrument.assetId}:${entry.band.threshold}`,
        groupKey: `band-${entry.band.threshold}-${index}`,
        values: {
          window: bandLabel(entry.band, locale),
          code: instrument.code,
          instrument:
            locale === "ar"
              ? (instrument.nameAr ?? instrument.name)
              : instrument.name,
          dueDate: instrument.dueDate,
        },
      })),
    );
    const flagged = bands.reduce((sum, entry) => sum + entry.instruments.length, 0);
    return {
      columns: [
        col("window", "النافذة", "Window", "status"),
        col("code", "الجهاز", "Instrument code"),
        col("instrument", "اسم الجهاز", "Instrument name"),
        col("dueDate", "تاريخ الاستحقاق", "Due date", "date"),
      ],
      groups,
      rows,
      totals: [
        {
          id: "flagged",
          kind: "sum",
          label: bilingual(
            `أجهزة مستحقة: ${flagged} · السلّم: [${thresholds.join(", ")}]`,
            `instruments due: ${flagged} · ladder: [${thresholds.join(", ")}]`,
          ),
          amount: String(flagged),
        },
        {
          id: "today",
          kind: "check",
          label: bilingual("تاريخ القاعدة (مرجع الاشتقاق)", "Database date (the derivation anchor)"),
          amount: today,
        },
      ],
      assertionResults: [calibrationBandResult(thresholds, bands.map((entry) => entry.band))],
      notes: [
        bilingual(
          "النوافذ منفصلة ببنية الطية النقية نفسها (كل جهاز في نافذة واحدة بالضبط) والعتبات هي السلّم الفعّال نفسه الذي يركبه الكنس والإشعارات — أحدث تاريخ استحقاق للجهاز هو التزامه الجاري (قانون الأحدث أولًا)",
          "The windows are disjoint by the pure fold's own construction (every instrument in exactly one band) and the thresholds are the same effective ladder the sweep and its alerts ride — an instrument's LATEST due date is its current obligation (the latest-first law)",
        ),
      ],
    };
  },
});
