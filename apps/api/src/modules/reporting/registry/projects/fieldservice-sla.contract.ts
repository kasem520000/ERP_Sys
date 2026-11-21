import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import type { SlaReadout } from "../../../crm/application/fieldservice-service";
import { LOCALE, assertDecl, bilingual, col, defineReport, drill, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-048 (W-14 — T-17, dated 2026-11-22; REPORT_CATALOG §9's
 * PHASE-048 row 4): `projects.fieldservice-sla` — the W-12 single
 * clock's own readings as a report contract: one row per visit on the
 * dispatch board's own listing (the W-13 presentation join — the
 * parent order's own number + the technician's own names), each row
 * carrying BOTH clocks' pause-aware readings from the PURE readout
 * (`slaReadout` — the same single fold the evaluation surface rides,
 * with NOTHING recorded: a report is never the evaluation act; BR-096's
 * deduped inbox escalation fires only through the operator's per-visit
 * evaluation surface, the W-12 design law).
 *
 * THE EXACTNESS LAW: the readings' milliseconds are the engine's own
 * integers rendered verbatim (elapsedMs/pausedMs per clock); the hours
 * view is DISPLAY-ONLY — one 3,600,000 division per figure, the single
 * rounding, exactly as the W-13 board renders it. NO_TARGET is the
 * honest absence (the target column reads "—" and breached stays false
 * while the register is unset — never a fabricated target).
 *
 * The footer carries the fail-closed law as the block-on-fail
 * assertion (`sla-no-fabricated-target`): every row re-checked — a
 * null target renders "—" AND never breaches (the register-unset
 * posture, structural at the report).
 *
 * Permission `projects.fieldservice.view` (matrix §3.26; the §12
 * module-register reuse rule — the same key the dispatch board and the
 * dedicated SLA endpoint ride).
 */

const SLA_NO_FABRICATED_TARGET = assertDecl(
  "sla-no-fabricated-target",
  "BR-096's fail-closed posture at the report: a clock with NO configured target renders the honest absence (target '—') and never breaches — no fabricated targets",
  "ساعة بلا هدف مُعدّ تُعرض مخترقة أو بهدف مُختلَق — التصدير محجوب",
  "A clock with no configured target renders breached or with a fabricated target — export blocked",
  "BR-096",
);

function noFabricatedTargetResult(readouts: readonly SlaReadout[]): AssertionResult {
  const offender = readouts.find(
    (readout) =>
      (readout.response.targetMs === null && readout.response.breached) ||
      (readout.resolution.targetMs === null && readout.resolution.breached),
  );
  return {
    id: "sla-no-fabricated-target",
    status: offender === undefined ? "PASS" : "FAIL",
    detail:
      offender === undefined
        ? undefined
        : bilingual(
            `الزيارة ${offender.visitId}: ساعة بلا هدف مُعدّ تُعرض مخترقة — التصدير محجوب`,
            `Visit ${offender.visitId}: a no-target clock renders breached — export blocked`,
          ),
  };
}

/** The one display division (the W-13 board's own shape): ms → hours,
 * the single rounding at display — the exact ms ride their own
 * columns. */
function msToHours(ms: number): string {
  return (ms / 3_600_000).toFixed(2);
}

const VISIT_STATUSES = ["NEW", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "COMPLETED", "CLOSED"] as const;

export const projectFieldserviceSlaContract = defineReport({
  id: "projects.fieldservice-sla",
  version: 1,
  title: bilingual("موقف مستوى الخدمة الميدانية", "Field Service SLA Posture"),
  category: "projects",
  description: bilingual(
    "قراءات الساعة الواحدة لزيارات الخدمة الميدانية من الطية النقية نفسها: لكل زيارة ساعة الاستجابة وساعة الإنجاز بزمن الإيقاف المراعى — المللي ثانية أرقام المحرك كما هي والساعات عرض فقط (قسمة واحدة)، والساعات المستهدفة من سجل المستأجر مع الغياب الصادق (—) حين لا هدف معدًا، ولا أي تسجيل إشعارات: التقرير ليس فعل التقييم",
    "The single clock's readings over the field-service visits from the same pure fold: per visit the response + resolution clocks pause-aware — the milliseconds the engine's own integers verbatim, the hours display-only (one division), the target hours from the tenant's register with the honest absence (—) when unset, and NO notification ever recorded: a report is not the evaluation act",
  ),
  parameters: z.object({
    serviceOrderId: z.string().uuid().optional(),
    status: z.enum(VISIT_STATUSES).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    locale: LOCALE,
  }),
  requiredPermission: "projects.fieldservice.view",
  dataSources: [
    source(
      "projects",
      "FieldserviceService.board (the W-12 dispatch board's own listing, the W-13 presentation join) + slaReadout (the SAME single fold the evaluation surface rides — pure, nothing recorded)",
      ["service_visits", "service_orders", "employees"],
      "لوحة الإرسال وقراءات الساعة الواحدة",
      "The dispatch board + the single clock's readings",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "forbidden", branches: "optional" },
  freshness: {
    // Running clocks advance by the millisecond — a cached reading is a
    // stale reading: TTL 0, always recompute (the sourcing precedent).
    semantics: "current",
    cacheTtlSeconds: 0,
    invalidationEvents: [],
  },
  assertions: [SLA_NO_FABRICATED_TARGET],
  drillTargets: [
    drill("serviceOrderId", "/projects/fieldservice", "لوحة الخدمة الميدانية", "The field-service dispatch board", "projects.fieldservice.view"),
  ],
  aggregation: {
    groupBy: [],
    measures: [{ id: "responseElapsedMs", kind: "sum" }],
    sorting: [{ by: "scheduledStart", dir: "asc" }],
    zeroSuppression: "none",
  },
  totals: { grandTotals: "none" },
  run: async (_ctx, params) => {
    const { projectsFieldservice: fieldservice } = reportingServices();
    const visits = await fieldservice.board({
      serviceOrderId: params.serviceOrderId as string | undefined,
      status: params.status as string | undefined,
      limit: (params.limit as number | undefined) ?? 200,
    });
    const locale = params.locale === "en" ? "en" : "ar";
    const readouts: SlaReadout[] = [];
    for (const visit of visits) {
      readouts.push(await fieldservice.slaReadout(visit.id));
    }

    const responseBreached = readouts.filter((readout) => readout.response.breached).length;
    const resolutionBreached = readouts.filter((readout) => readout.resolution.breached).length;

    return {
      columns: [
        col("orderNo", "أمر الخدمة", "Service order"),
        col("technician", "الفني", "Technician"),
        col("scheduledStart", "الجدولة", "Scheduled start", "date"),
        col("status", "الحالة", "Status", "status"),
        col("paused", "موقوفة", "Paused"),
        qtyCol("responseElapsedMs", "الاستجابة — المللي (المحرك)", "Response — ms (engine)"),
        qtyCol("responsePausedMs", "الاستجابة — إيقاف (مللي)", "Response — paused ms"),
        qtyCol("responseElapsedH", "الاستجابة — ساعات (عرض)", "Response — hours (display)"),
        qtyCol("responseTargetH", "الاستجابة — الهدف (ساعات)", "Response — target (hours)"),
        col("responseBreached", "الاستجابة — تجاوز", "Response — breached", "status"),
        qtyCol("resolutionElapsedMs", "الإنجاز — المللي (المحرك)", "Resolution — ms (engine)"),
        qtyCol("resolutionPausedMs", "الإنجاز — إيقاف (مللي)", "Resolution — paused ms"),
        qtyCol("resolutionElapsedH", "الإنجاز — ساعات (عرض)", "Resolution — hours (display)"),
        qtyCol("resolutionTargetH", "الإنجاز — الهدف (ساعات)", "Resolution — target (hours)"),
        col("resolutionBreached", "الإنجاز — تجاوز", "Resolution — breached", "status"),
      ],
      groups: [],
      rows: visits.map((visit, index) => {
        const readout = readouts[index]!;
        return {
          key: visit.id,
          values: {
            orderNo: visit.orderNo ?? visit.serviceOrderId,
            technician:
              locale === "ar"
                ? (visit.technicianNameAr ?? visit.technicianName ?? "—")
                : (visit.technicianName ?? visit.technicianNameAr ?? "—"),
            scheduledStart: visit.scheduledStart,
            status: visit.status,
            paused: visit.isPaused ? "نعم / yes" : "لا / no",
            responseElapsedMs: readout.response.elapsedMs,
            responsePausedMs: readout.response.pausedMs,
            responseElapsedH: msToHours(readout.response.elapsedMs),
            responseTargetH: readout.response.targetMs === null ? "—" : msToHours(readout.response.targetMs),
            responseBreached: readout.response.breached ? "متجاوزة / BREACHED" : "—",
            resolutionElapsedMs: readout.resolution.elapsedMs,
            resolutionPausedMs: readout.resolution.pausedMs,
            resolutionElapsedH: msToHours(readout.resolution.elapsedMs),
            resolutionTargetH: readout.resolution.targetMs === null ? "—" : msToHours(readout.resolution.targetMs),
            resolutionBreached: readout.resolution.breached ? "متجاوزة / BREACHED" : "—",
          },
        };
      }),
      // Counts only — the engine's own boolean readings counted; NO
      // ms totals (summing running clocks is meaningless — the posture
      // is per visit; zero parallel computation of any figure).
      totals: [
        {
          id: "visits",
          kind: "sum",
          label: bilingual("عدد الزيارات", "Visits"),
          amount: visits.length.toString(),
        },
        {
          id: "responseBreached",
          kind: "sum",
          label: bilingual("زيارات تجاوزت ساعة الاستجابة", "Visits breaching the response clock"),
          amount: responseBreached.toString(),
        },
        {
          id: "resolutionBreached",
          kind: "sum",
          label: bilingual("زيارات تجاوزت ساعة الإنجاز", "Visits breaching the resolution clock"),
          amount: resolutionBreached.toString(),
        },
      ],
      assertionResults: [noFabricatedTargetResult(readouts)],
      notes: [
        bilingual(
          "المللي ثانية أرقام المحرك الدقيقة كما هي؛ الساعات عرض فقط (قسمة واحدة عند العرض). الأهداف من سجل المستأجر — والغياب الصادق (—) حين لا هدف معدًا (الساعة لا تُعرض مخترقة أبدًا بلا هدف). لا يُسجَّل أي إشعار من هذا التقرير: التصعيد شأن سطح التقييم وحده",
          "The milliseconds are the engine's exact integers verbatim; the hours are display-only (one division at render). Targets come from the tenant's register — the honest absence (—) when unset (a clock never renders breached without a target). No notification is ever recorded from this report: escalation is the evaluation surface's alone",
        ),
      ],
    };
  },
});
