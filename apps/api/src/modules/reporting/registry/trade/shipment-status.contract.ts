import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, source } from "../kit";
import { reportingServices } from "../services";
import { TRADE_REPORT_VOCABULARIES } from "./trade-queries";

/**
 * PHASE-051 (W-40 — T-15, dated 2026-11-26; REPORT_CATALOG §9's
 * PHASE-051 row 3): `trade.shipment-status` — the shipment board as a
 * report contract: one row per bill of lading issued over the period,
 * every figure the register's own (the official BL-{YYYY}-{SEQ:6}
 * number, the multimodal doc type, the carrier, the ports, the
 * container count, the linked PO / delivery-note briefs), with the
 * shipment_status THE FOLD'S OWN DRIVEN FIGURE (the monotone
 * BOOKED → DEPARTED → ARRIVED → CLEARED → DELIVERED ladder — never
 * writable by hand, D-14's own law) and the event log's own
 * append-only truth (the latest milestone + the event count) plus the
 * packing lists under each B/L.
 *
 * The footer carries the vocabulary law as the block-on-fail
 * assertion (`shipment-status-vocabulary`): every row's shipment
 * status sits in the 0122 fold's own milestone domain.
 *
 * Permission `trade.shipments.view` (matrix §3.29; the §12
 * module-register reuse rule — the same key the /trade/shipments
 * reads ride).
 */

const SHIPMENT_STATUS_VOCABULARY = assertDecl(
  "shipment-status-vocabulary",
  "Every row's shipment status sits on the tracking fold's own monotone ladder (BOOKED → DEPARTED → ARRIVED → CLEARED → DELIVERED)",
  "قيمة خارج مفردات سلم حالة الشحنة — التصدير محجوب",
  "A value outside the shipment-status ladder's own vocabulary — export blocked",
);

function shipmentVocabularyResult(
  rows: readonly { shipmentStatus: string; blNo: string }[],
): AssertionResult {
  const offenders = rows.filter(
    (row) => !(TRADE_REPORT_VOCABULARIES.shipmentMilestones as readonly string[]).includes(row.shipmentStatus),
  );
  const ok = offenders.length === 0;
  return {
    id: "shipment-status-vocabulary",
    status: ok ? "PASS" : "FAIL",
    detail: ok
      ? undefined
      : bilingual(
          `بوالص خارج المفردات: ${offenders.map((row) => row.blNo).join("، ")}`,
          `Off-register row(s): ${offenders.map((row) => row.blNo).join(", ")}`,
        ),
  };
}

export const tradeShipmentStatusContract = defineReport({
  id: "trade.shipment-status",
  version: 1,
  title: bilingual("حالة الشحنات", "Shipment Status"),
  category: "trade",
  description: bilingual(
    "لوحة حالة الشحنات على الفترة: لكل بوليصة شحن رقمها الرسمي ونوع وثيقتها متعددة الوسائط وناقلها وموانئها وعدد الحاويات وموجز أمر الشراء أو إشعار التسليم المرتبط، مع حالة الشحنة التي يقودها الطيّ الرتيب نفسه (لا تُكتب يدويًا قطّ — قانون D-14) وسجل الأحداث الملحق نفسه (أحدث معلم + عدد الأحداث) وقوائم التعبئة تحت كل بوليصة",
    "The shipment-status board over the period: per bill of lading its official number, multimodal doc type, carrier, ports, container count and linked PO or delivery-note brief, with the shipment status the monotone fold itself drives (never writable by hand — D-14's own law), the append-only event log's own truth (the latest milestone + the event count) and the packing lists under each B/L",
  ),
  parameters: z.object({
    docType: z.enum(["BILL_OF_LADING", "AIR_WAYBILL", "ROAD_WAYBILL", "MULTIMODAL"]).optional(),
    dateFrom: ISO_DATE,
    dateTo: ISO_DATE,
    locale: LOCALE,
  }),
  requiredPermission: "trade.shipments.view",
  dataSources: [
    source(
      "trade",
      "TradeReportQueriesService.shipmentStatus (the B/L register's own rows + the event log's own truth + the packing-list counts)",
      ["bills_of_lading", "shipment_tracking_events", "packing_lists"],
      "سجل بوالص الشحن بحالته المدفوعة بالأحداث",
      "The B/L register with its event-driven statuses",
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
  assertions: [SHIPMENT_STATUS_VOCABULARY],
  drillTargets: [
    drill("blId", "/trade/shipments", "لوحة الشحنات", "The shipments board", "trade.shipments.view"),
  ],
  run: async (_ctx, params) => {
    const { tradeQueries } = reportingServices();
    const rows = await tradeQueries.shipmentStatus({
      docType: params.docType as string | undefined,
      from: params.dateFrom!,
      to: params.dateTo!,
    });
    const delivered = rows.filter((row) => row.shipmentStatus === "DELIVERED").length;
    const cleared = rows.filter((row) => row.shipmentStatus === "CLEARED").length;
    return {
      columns: [
        col("blNo", "البوليصة", "B/L"),
        col("day", "الإصدار", "Issued", "date"),
        col("docType", "النوع", "Doc type", "status"),
        col("carrierName", "الناقل", "Carrier"),
        col("portOfLoading", "ميناء الشحن", "Port of loading"),
        col("portOfDischarge", "ميناء التفريغ", "Port of discharge"),
        col("containerCount", "الحاويات", "Containers"),
        col("shipmentStatus", "حالة الشحنة", "Shipment status", "status"),
        col("latestMilestone", "أحدث معلم", "Latest milestone", "status"),
        col("latestEventAt", "أحدث حدث", "Latest event", "date"),
        col("events", "الأحداث", "Events"),
        col("packingLists", "قوائم التعبئة", "Packing lists"),
        col("poNo", "أمر الشراء", "PO"),
        col("deliveryNoteNo", "إشعار التسليم", "Delivery note"),
      ],
      groups: [],
      rows: rows.map((row) => ({
        key: row.blId,
        values: {
          blNo: row.blNo,
          day: row.day,
          docType: row.docType,
          carrierName: row.carrierName,
          portOfLoading: row.portOfLoading ?? "—",
          portOfDischarge: row.portOfDischarge ?? "—",
          containerCount: String(row.containerCount),
          shipmentStatus: row.shipmentStatus,
          latestMilestone: row.latestMilestone ?? "—",
          latestEventAt: row.latestEventAt === null ? "—" : row.latestEventAt.slice(0, 16).replace("T", " "),
          events: String(row.events),
          packingLists: String(row.packingLists),
          poNo: row.poNo ?? "—",
          deliveryNoteNo: row.deliveryNoteNo ?? "—",
        },
      })),
      totals: [
        {
          id: "rows",
          kind: "sum",
          label: bilingual(
            `بوالص: ${rows.length} · مُخلَّصة: ${cleared} · مُسلَّمة: ${delivered}`,
            `B/Ls: ${rows.length} · cleared: ${cleared} · delivered: ${delivered}`,
          ),
          amount: String(rows.length),
        },
      ],
      assertionResults: [shipmentVocabularyResult(rows)],
      notes: [
        bilingual(
          "حالة الشحنة هي الرقم الذي يقوده طيّ التتبع الرتيب من سجل الأحداث الملحق — لا تُكتب يدويًا على أي سطح (قانون D-14)؛ أحدث معلم وعدد الأحداث قراءتان من سجل الأحداث نفسه (السجل الملحق لا يُحذف منه شيء)؛ قوائم التعبئة عدّ لقوائم البوليصة نفسها",
          "The shipment status is the figure the monotone tracking fold drives from the append-only event log — never writable by hand on any surface (D-14's own law); the latest milestone and the event count are reads of the event log itself (append-only, never deleted); the packing lists count the B/L's own lists",
        ),
      ],
    };
  },
});
