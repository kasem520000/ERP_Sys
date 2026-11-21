import { z } from "zod";

import type { AssertionResult } from "../../application/contract";
import { ISO_DATE, LOCALE, assertDecl, bilingual, col, defineReport, drill, moneyCol, qtyCol, source } from "../kit";
import { reportingServices } from "../services";

/**
 * PHASE-048 (W-14 — T-17, dated 2026-11-22; REPORT_CATALOG §9's
 * PHASE-048 row 1): `projects.evm-summary` — the W-10 EVM engine's own
 * snapshot as a report contract: one row per WBS node (the engine's
 * EvmNodeRow list verbatim — planned/PV/rolledPercent/EV/AC-labor/
 * CPI/SPI, every figure the engine's own string), the snapshot's own
 * top-level figures as the totals block (BAC, PV, the two EV
 * disciplines, AC total + its four legs, CPI/SPI, ETC/EAC — ZERO
 * parallel computation: nothing is re-summed at the report; the totals
 * are the snapshot's own outputs), and the engine's disclosures
 * carried verbatim as the report's notes.
 *
 * The footer carries INV-033 as the block-on-fail assertion
 * (`evm-ac-gl-tie`): the report calls the W-9 reconciliation service —
 * the ENGINE's own read, never a re-computation — and a residual (AC ≠
 * the GL project dimension) FAILS the assertion and blocks the export
 * with the engine's own figures in `compared`.
 *
 * Permission `projects.evm.view` (matrix §3.26; REPORT_CATALOG §12
 * module-register reuse rule — the same key the /projects/:id/evm
 * read and the EVM tab ride).
 */

const EVM_AC_GL_TIE = assertDecl(
  "evm-ac-gl-tie",
  "INV-033: the AC total (labor + materials + subcontract + allocated overhead) reconciles to the GL project dimension to the cent — the W-9 reconciliation service's own output",
  "التكلفة الفعلية للمشروع لا تطابق بُعد المشروع في دفتر الأستاذ (INV-033) — التصدير محجوب",
  "The project's actual cost does not reconcile to the GL project dimension (INV-033) — export blocked",
  "INV-033",
);

function inv033Result(projectId: string): Promise<AssertionResult> {
  // The engine's own reconciliation read (zero parallel computation):
  // PASS carries the engine's compared figures; the typed refusal at a
  // residual becomes the FAIL with the engine's own legs — the report
  // never recomputes the tie.
  const { projectsActuals: actuals } = reportingServices();
  return actuals
    .inv033(projectId)
    .then<AssertionResult>((report) => ({
      id: "evm-ac-gl-tie",
      status: "PASS",
      compared: { left: report.acTotal, right: report.glProjectDimension.net },
    }))
    .catch<AssertionResult>((error: unknown) => {
      // The typed refusal's own payload (DomainError.details — the
      // engine's per-leg breakdown, carried verbatim into the FAIL).
      const legs = (error as { details?: { acTotal?: string; glProjectDimension?: string; residual?: string } })
        .details ?? {};
      return {
        id: "evm-ac-gl-tie",
        status: "FAIL",
        compared: {
          left: legs.acTotal ?? "unknown",
          right: legs.glProjectDimension ?? "unknown",
        },
        detail: bilingual(
          `بقايا عدم التوافق ${legs.residual ?? "غير معروفة"} (INV-033) — التصدير محجوب`,
          `Reconciliation residual ${legs.residual ?? "unknown"} (INV-033) — export blocked`,
        ),
      };
    });
}

export const projectsEvmSummaryContract = defineReport({
  id: "projects.evm-summary",
  version: 1,
  title: bilingual("ملخص القيمة المكتسبة", "EVM Summary"),
  category: "projects",
  description: bilingual(
    "لقطة محرك القيمة المكتسبة لمشروع واحد حتى تاريخه: صف لكل عنصر في هيكل العمل (المخطط والقيمة المخططة ونسبة الإنجاز المرجحة والقيمة المكتسبة وتكلفة العمالة والمؤشرات) — كل الأرقام مخرجات المحرك نصًا كما هي، والمجاميع أرقام اللقطة نفسها (بلا أي جمع موازٍ)، وربط INV-033 مع بعد المشروع في دفتر الأستاذ إلزامي للتصدير",
    "One project's EVM engine snapshot as of a date: one row per WBS node (planned, PV, the weighted rollup percent, EV, the labor AC, the indices) — every figure the engine's own string verbatim, the totals the snapshot's own outputs (zero parallel computation), and the INV-033 tie to the GL project dimension mandatory for export",
  ),
  parameters: z.object({
    projectId: z.string().uuid(),
    asOf: ISO_DATE.optional(),
    locale: LOCALE,
  }),
  requiredPermission: "projects.evm.view",
  dataSources: [
    source(
      "projects",
      "EvmService.snapshot (the W-10 EVM engine — PV from the approved cost curve, EV both disciplines, AC the four collectors, CPI/SPI/ETC/EAC)",
      [
        "project_wbs_tasks",
        "project_budgets",
        "project_budget_lines",
        "crm_time_entries",
        "subcontractor_certificates",
        "change_orders",
      ],
      "لقطة محرك القيمة المكتسبة",
      "The EVM engine's snapshot",
    ),
    source(
      "projects",
      "ProjectActualsService.inv033 (the W-9 reconciliation — the INV-033 tie)",
      ["journal_lines"],
      "ربط INV-033 مع دفتر الأستاذ",
      "The INV-033 GL tie",
    ),
  ],
  scopeRules: { dateRange: "optional", asOf: "optional", branches: "optional" },
  freshness: {
    semantics: "as-of",
    cacheTtlSeconds: 60,
    invalidationEvents: ["journal.posted", "journal.reversed"],
  },
  assertions: [EVM_AC_GL_TIE],
  drillTargets: [
    drill("projectId", "/projects", "لوحة المشاريع وتبويب القيمة المكتسبة", "The projects board + the EVM tab", "projects.evm.view"),
  ],
  aggregation: {
    groupBy: [],
    measures: [
      { id: "pv", kind: "derived" },
      { id: "ev", kind: "derived" },
      { id: "acLabor", kind: "sum" },
    ],
    sorting: [{ by: "wbsCode", dir: "asc" }],
    zeroSuppression: "none",
  },
  totals: { grandTotals: "none" },
  run: async (_ctx, params) => {
    const { projectsEvm: evm } = reportingServices();
    const projectId = params.projectId as string;
    // The controller's own default (projects-evm.controller.ts): asOf
    // defaults to today when the caller omits it; the engine's own read
    // stays the single source.
    const asOf = (params.asOf as string | undefined) ?? new Date().toISOString().slice(0, 10);
    const snapshot = await evm.snapshot(projectId, asOf);

    const tie = await inv033Result(projectId);

    return {
      columns: [
        col("wbsCode", "رمز الهيكل", "WBS code"),
        col("name", "العنصر", "Node"),
        moneyCol("planned", "المخطط", "Planned"),
        moneyCol("pv", "القيمة المخططة", "PV"),
        qtyCol("rolledPercent", "نسبة الإنجاز المرجحة", "Rolled %"),
        moneyCol("ev", "القيمة المكتسبة", "EV"),
        moneyCol("acLabor", "تكلفة العمالة", "AC labor"),
        qtyCol("cpi", "مؤشر أداء التكلفة", "CPI"),
        qtyCol("spi", "مؤشر أداء الجدول", "SPI"),
      ],
      groups: [],
      rows: snapshot.nodes.map((node) => ({
        key: node.wbsTaskId,
        values: {
          wbsCode: node.wbsCode,
          name: node.name,
          planned: node.planned,
          pv: node.pv,
          rolledPercent: node.rolledPercent,
          ev: node.ev,
          acLabor: node.acLabor,
          cpi: node.cpi ?? "—",
          spi: node.spi ?? "—",
        },
      })),
      // THE SNAPSHOT'S OWN FIGURES — never a client-side sum (zero
      // parallel computation): every amount below is the engine's own
      // string from the snapshot object.
      totals: [
        { id: "bac", kind: "sum", label: bilingual("الموازنة عند الإتمام (بعد أوامر التغيير)", "BAC (after change orders)"), amount: snapshot.budget.bac },
        { id: "pv", kind: "sum", label: bilingual("القيمة المخططة", "PV"), amount: snapshot.pv },
        {
          id: "evStructural",
          kind: "sum",
          label: bilingual("القيمة المكتسبة — الانضباط الهيكلي", "EV — structural discipline"),
          amount: snapshot.ev.structural.value,
        },
        {
          id: "evCertificate",
          kind: "sum",
          label: bilingual("القيمة المكتسبة — انضباط المستخلص", "EV — certificate discipline"),
          amount: snapshot.ev.certificate === null ? "—" : snapshot.ev.certificate.value,
        },
        { id: "acTotal", kind: "sum", label: bilingual("التكلفة الفعلية", "AC total"), amount: snapshot.ac.total },
        { id: "acLabor", kind: "sum", label: bilingual("التكلفة الفعلية — العمالة", "AC labor"), amount: snapshot.ac.labor },
        { id: "acMaterials", kind: "sum", label: bilingual("التكلفة الفعلية — المواد", "AC materials"), amount: snapshot.ac.materials },
        { id: "acSubcontract", kind: "sum", label: bilingual("التكلفة الفعلية — الباطن", "AC subcontract"), amount: snapshot.ac.subcontract },
        { id: "acOverhead", kind: "sum", label: bilingual("التكلفة الفعلية — الحمل الموزع", "AC allocated overhead"), amount: snapshot.ac.overhead },
        { id: "cpi", kind: "sum", label: bilingual("مؤشر أداء التكلفة", "CPI"), amount: snapshot.indices.cpi ?? "—" },
        { id: "spi", kind: "sum", label: bilingual("مؤشر أداء الجدول", "SPI"), amount: snapshot.indices.spi ?? "—" },
        { id: "etc", kind: "sum", label: bilingual("التقدير للإتمام", "ETC"), amount: snapshot.forecast.etc },
        { id: "eac", kind: "sum", label: bilingual("التقدير عند الإتمام", "EAC"), amount: snapshot.forecast.eac },
      ],
      assertionResults: [tie],
      // The engine's disclosures carried VERBATIM (both slots the same
      // string — the engine emits its disclosures once; a translated
      // copy would be a fabricated compliance text (red line 5)).
      notes: snapshot.disclosures.map((disclosure) => bilingual(disclosure, disclosure)),
    };
  },
});
