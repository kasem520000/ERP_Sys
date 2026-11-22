import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import type { CmmsMeterLogBlock } from "./cmms-queries";
import { LOCALE, assertDecl, bilingual, col, defineReport, drill, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-049 (W-22 — T-16, dated 2026-11-22; REPORT_CATALOG §9's
 * PHASE-049 row 3): `assets.meter-readings` — the readings log as a
 * report contract: one row per reading on the W-18 engine's own log
 * (the same list the meters board's readings pane renders — value,
 * effective date, source, the JOB readings' own work-order link),
 * grouped per meter with the meter's own type/unit/odometer
 * designation and the asset brief. ZERO recomputation: every figure is
 * the engine's own row verbatim.
 *
 * The footer carries the log's shape law as the block-on-fail
 * assertion (`readings-log-shape`): the source vocabulary is exactly
 * MANUAL/JOB/IMPORT, and every JOB reading carries its work-order
 * link (the engine's own authoring law — a JOB reading without a work
 * order would be a shape violation the report surfaces).
 *
 * Permission `assets.meters.view` (matrix §3.27; the §12
 * module-register reuse rule — the same key the meters board rides).
 */

const READINGS_LOG_SHAPE = assertDecl(
  "readings-log-shape",
  "The readings log's shape: the source vocabulary is exactly MANUAL/JOB/IMPORT and every JOB reading carries its own work-order link — the engine's authoring law re-checked at the report",
  "شكل سجل القراءات مكسور: مصدر خارج المفردات أو قراءة JOB بلا أمر عمل — التصدير محجوب",
  "A broken readings-log shape: a source outside the vocabulary or a JOB reading without its work order — export blocked",
  "FA-F-05",
);

function readingsShapeResult(blocks: readonly CmmsMeterLogBlock[]): AssertionResult {
  const offenders: string[] = [];
  for (const block of blocks) {
    for (const reading of block.readings) {
      if (reading.source !== "MANUAL" && reading.source !== "JOB" && reading.source !== "IMPORT") {
        offenders.push(`${block.meter.name} @ ${reading.effectiveDate} (${reading.source})`);
      }
      if (reading.source === "JOB" && reading.workOrderId === null) {
        offenders.push(`${block.meter.name} @ ${reading.effectiveDate} (JOB without a work order)`);
      }
    }
  }
  const ok = offenders.length === 0;
  return {
    id: "readings-log-shape",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `قراءات مكسورة الشكل: ${offenders.slice(0, 5).join("، ")}`,
          `Malformed reading(s): ${offenders.slice(0, 5).join(", ")}`,
        ),
  };
}

export const fixedAssetsMeterReadingsContract = defineReport({
  id: "assets.meter-readings",
  version: 1,
  title: bilingual("سجل قراءات العدادات", "Meter Readings Log"),
  category: "financial",
  description: bilingual(
    "سجل قراءات عدادات الأصول: لكل عداد قراءاته بأرقام المحرك نفسها (القيمة والتاريخ الفعلي والمصدر وربط أمر العمل لقراءات JOB) مع نوع العداد ووحدته وتعيين العداد الكيلومتري — بلا أي إعادة حساب",
    "The asset-meter readings log: per meter its readings as the engine's own rows (value, effective date, source, the JOB readings' work-order link) with the meter's type, unit and odometer designation — zero recomputation",
  ),
  parameters: z.object({
    assetId: z.string().uuid().optional(),
    meterId: z.string().uuid().optional(),
    locale: LOCALE,
  }),
  requiredPermission: "assets.meters.view",
  dataSources: [
    source(
      "fixed_assets",
      "CmmsQueriesService.meterReadingsLog (the W-18 meters engine's own register + the readings log)",
      ["asset_meters", "asset_meter_readings", "assets", "asset_categories"],
      "سجل العدادات والقراءات بأرقام المحرك",
      "The meters register and the readings log — the engine's own rows",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  aggregation: {
    groupBy: ["meter"],
    measures: [{ id: "value", kind: "derived" }],
    sorting: [{ by: "effectiveDate", dir: "desc" }],
    zeroSuppression: "rows",
  },
  totals: { rowTotals: false, grandTotals: "none", subTotalsByGroup: false },
  freshness: {
    semantics: "current",
    cacheTtlSeconds: 300,
    invalidationEvents: [],
  },
  assertions: [READINGS_LOG_SHAPE],
  drillTargets: [
    drill("assetId", "/assets/meters", "لوحة العدادات", "The meters board", "assets.meters.view"),
  ],
  run: async (_ctx, params) => {
    const { cmmsQueries } = reportingServices();
    const locale = params.locale === "en" ? "en" : "ar";
    const blocks = await cmmsQueries.meterReadingsLog({
      assetId: params.assetId as string | undefined,
      meterId: params.meterId as string | undefined,
    });

    const rows = blocks.flatMap((block) =>
      block.readings.map((reading) => ({
        key: reading.id,
        groupKey: block.meter.id,
        values: {
          meter:
            locale === "ar"
              ? `${block.assetCode} · ${block.meter.nameAr ?? block.meter.name}`
              : `${block.assetCode} · ${block.meter.name}`,
          type: block.meter.type,
          unit: block.meter.unit,
          odometer: block.meter.isOdometer ? "نعم / yes" : "—",
          value: reading.value,
          effectiveDate: reading.effectiveDate,
          source: reading.source,
          workOrder: reading.workOrderId === null ? "—" : "JOB",
          recordedAt: reading.createdAt.slice(0, 10),
        },
      })),
    );

    return {
      columns: [
        col("meter", "العداد", "Meter"),
        col("type", "النوع", "Type", "status"),
        col("unit", "الوحدة", "Unit"),
        col("odometer", "كيلومتري", "Odometer"),
        qtyCol("value", "القيمة", "Value"),
        col("effectiveDate", "التاريخ الفعلي", "Effective date", "date"),
        col("source", "المصدر", "Source", "status"),
        col("workOrder", "أمر العمل", "Work order"),
        col("recordedAt", "التسجيل", "Recorded", "date"),
      ],
      groups: blocks.map((block) => ({
        key: block.meter.id,
        label: bilingual(
          `${block.assetCode} · ${block.meter.nameAr ?? block.meter.name} (${block.meter.type} · ${block.meter.unit})`,
          `${block.assetCode} · ${block.meter.name} (${block.meter.type} · ${block.meter.unit})`,
        ),
        subtotal: { value: block.meter.lastValue },
      })),
      rows,
      totals: [
        {
          id: "meters",
          kind: "sum",
          label: bilingual("عدد العدادات", "Meters"),
          amount: String(blocks.length),
        },
        {
          id: "readings",
          kind: "sum",
          label: bilingual("عدد القراءات", "Readings"),
          amount: String(rows.length),
        },
      ],
      assertionResults: [readingsShapeResult(blocks)],
      notes: [
        bilingual(
          "كل قراءة سجل المحرك نفسه: القيمة كما سُجلت والتاريخ الفعلي كما أُعطي والمصدر من مفرداته الثلاث (يدوي / أمر عمل / استيراد) — وقراءات أمر العمل تحمل ربط أمرها دوماً. العدادات القيم الأخيرة في رأس المجموعة هي لقطة العداد نفسها",
          "Every reading is the engine's own row: the value as recorded, the effective date as given, the source from its three-value vocabulary (manual / job / import) — and JOB readings always carry their work-order link. The group headers' last figures are the meter's own snapshots",
        ),
      ],
    };
  },
});
