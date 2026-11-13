# PHASE-050 — Quality Management System

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 2 / Stage 13 · **Register:** [CR-20](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §7 (M-23) · §8 (Q-01…Q-12) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.2

## 1. Phase Overview

- **Phase ID:** PHASE-050
- **Title:** Quality Management System (QMS) (إدارة الجودة)
- **Objective:** Deliver the quality module the audit found entirely absent (§8):
  item-level quality specifications with target and UCL/LCL tolerances; NCR records with
  source, severity and disposition; CAPA records with root-cause analysis and
  effectiveness checks; calibration records for instruments; SPC measurements feeding
  computed control charts; supplier quality scores that feed the PHASE-038 scorecards;
  COA generation from inspection results; customer complaint intake linked to NCRs;
  batch quality holds that block every issue/ship path; a recall registry that drills
  batch → where-used → customers; management review records (Q-10) and HACCP-style
  hazard registers for the food template (Q-11).
- **Business value:** Quality is the gate to regulated and export customers: food
  manufacturers need HACCP evidence and batch control, distributors need COA documents
  with every shipment, and every manufacturer needs NCR/CAPA discipline for ISO
  registration. Today all of it lives in spreadsheets beside the ERP; after this phase
  the batch ledger, inspections and customer records are one traceability chain, and a
  recall drill becomes a query instead of a fire drill (Q-09).
- **الملخص التنفيذي (AR):** تُنشئ هذه المرحلة وحدة الجودة الغائبة كلياً وفق التدقيق:
  مواصفات جودة لكل صنف بمعاملات وأهداف وحدود تحمّل عليا/دنيا، سجلات حالات عدم
  المطابقة NCR بمصدر وشدة وقرار تصرف، سجلات CAPA بتحليل جذور وإجراءات تصحيحية
  ووقائية مع تحقق الفعالية، سجلات معايرة للأجهزة، قيادات SPC تُغذّي خرائط مراقبة
  محسوبة، درجات جودة الموردين المتدفقة إلى بطاقات تقييم مرحلة 038، توليد شهادات
  التحليل COA من نتائج الفحص، استقبال شكاوى العملاء وربطها بـ NCR، حجز الدفعات
  الذي يمنع أي صرف أو شحن، وسجل استدعاء يتتبّع الدفعة حتى العملاء — مع سجلات
  مراجعة إدارة الجودة وسجلات مخاطر بنمط HACCP لقالب الأغذية (Q-10/Q-11).

## 2. Scope

In scope:

1. **Quality specifications (Q-05)**: `quality_specifications` — per item: parameters,
   target, tolerances UCL/LCL; they feed inspection lines, SPC and COA generation.
2. **NCR records (Q-01)**: `ncr_records` — source
   INSPECTION/PRODUCTION/COMPLAINT/SUPPLIER, severity, affected quantity, disposition
   REWORK/SCRAP/ACCEPT/RETURN_TO_SUPPLIER; the SCRAP disposition posts the inventory
   write-off (G-62); closure requires a disposition (BR-101).
3. **CAPA records (Q-02)**: `capa_records` — root-cause analysis text, corrective and
   preventive actions with owners and dates, and an effectiveness check recorded after
   the action due date (BR-102).
4. **Calibration records (Q-03)**: `calibration_records` — instrument (tracked as an
   asset on the 049 surfaces), standard used, result, due date; feeds the expiry sweep
   pattern.
5. **SPC (Q-04)**: `spc_measurements` — per-parameter samples with computed X-bar/R
   control charts, Cp/Cpk and out-of-control flagging; surfaced under the
   `quality.spc` feature key.
6. **Supplier quality scores (Q-06)**: `supplier_quality_scores` — rolling scores built
   from NCRs, rejections and delivery performance; they feed the supplier scorecards of
   PHASE-038 through a documented contract.
7. **COA generation (Q-07)**: `coa_documents` — certificate of analysis generated from
   inspection results against the item's specifications (BR-103), bilingual AR/EN print;
   certificates of conformity ride the same table as a document type.
8. **Complaints (Q-08)**: `complaints` — customer complaint intake (channel, severity,
   item/batch reference), triage, NCR link, resolution and feedback.
9. **Batch holds & recall (Q-09, Q-12)**: `batch_quality_holds` — hold/release with
   reason and disposition link, blocking every issue/ship path server-side (INV-035,
   BR-100) — and `recall_registry` — the traceability drill batch → where-used →
   customers, built on the existing batch/serial ledger.
10. **Management review & hazard registers (Q-10, Q-11)**: `quality_management_reviews`
    — meeting records with an indicator pack (NCR/CAPA/complaint/SPC status) and
    decisions — and `hazard_registers` — HACCP-style hazards, CCPs, critical limits and
    monitoring, composed by the food-manufacturing template.
11. **Production quality gates (M-23)**: a documented contract to the routing surface of
    PHASE-042 — inspection results gate operation completion when an operation is
    quality-gate flagged; the contract is recorded here and enforced when 042 delivers.

Out of scope: full ISO document control / ECM (062) · supplier-portal quality
collaboration (038 portal skeleton and 060) · laboratory information management beyond
calibration records (not an audited gap) · live lab-instrument integrations (055
substrate) · production routing implementation itself (042).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-035 — Activation & Truth Restoration COMPLETE (v3.0 entry point and discipline baseline) | NOT_STARTED — PLANNED (Blueprint v3.0) |
| Delivered baseline: inspections module, batch/serial tracking, sales delivery + inventory issue paths, posting engine, RLS isolation, AR/EN i18n, ⌘K palette, pg-boss jobs | delivered (stages 1–11) |
| Related surfaces (consumed via documented contracts, not hard prerequisites): PHASE-038 supplier scorecards · PHASE-042 routings (M-23 gates) · PHASE-044 WMS issue paths | NOT_STARTED — PLANNED (block enforced on baseline issue paths now, extended automatically) |

Per [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5 this phase has
no v3.0 hard ordering edge beyond 035; the hold-blocking contract is written so it also
binds the WMS picking paths of 044 when that phase delivers.

## 4. Design Impact

- **Navigation**: +5 screens — `/quality/ncr`, `/quality/capa`, `/quality/calibration`,
  `/quality/spc` (charts), `/quality/complaints` — plus the COA generation/print surface
  and hold banners on batch surfaces; ⌘K registration (OA-04); 12-template screen
  discipline.
- **Migrations**: 4 scripts, next in sequence — `0087_quality_specifications.sql`
  (specifications, SPC measurements), `0088_quality_ncr_capa.sql` (NCR, CAPA,
  complaints), `0089_quality_calibration_supplier.sql` (calibration, supplier quality
  scores, COA documents), `0090_quality_holds_recall.sql` (batch holds, recall registry,
  management reviews, hazard registers + the DATA-ONLY grants block). Exact numbers
  confirmed against the Drizzle journal at implementation time.
- **Entities**: +12 tenant tables → SQL + Drizzle mirror + `ENTITY_CATALOG.md` rows
  (CR-36a).
- **Permissions**: +10 keys — `quality.view/manage`, `quality.ncr.manage`,
  `quality.capa.manage`, `quality.calibration.manage`, `quality.spc.view`,
  `quality.complaints.manage`, `quality.coa.generate`, `quality.hold.manage`,
  `quality.recall.manage`; zero-drift discipline extended (CR-36b).
- **i18n**: ~+240 AR/EN key pairs across the five screen families, the COA print and the
  hold banners; parity equality extended (base+n = base+n).
- **Reports**: +4 contracts — `quality.ncr-register`, `quality.capa-status`,
  `quality.calibration-due`, `quality.complaints-summary` — with `REPORT_CATALOG.md`
  rows and the catalog↔registry reconciliation check extended.
- **Feature flags**: `quality`, `quality.spc` — template-composable grants (CR-36f);
  food-manufacturing, agriculture, healthcare and electronics templates compose
  `quality` by default; `quality.spc` composes for food-manufacturing and electronics.
- **Posting rules** (reservations re-coordinated 2026-11-13 per
  [../../planning/ID_LEDGER.md](../../planning/ID_LEDGER.md) — the original plan's G-63/G-64/INV-034/BR-070…073 predate the 037–042/044 waves' consumption of those slots): `JOURNAL_RULES.md` gains G-62 (NCR scrap disposition → inventory
  write-off posting) and G-63 (external calibration/CAPA service costs → quality
  expense posting); `ACCOUNTING_INVARIANTS.md` gains INV-035 (hold enforcement);
  `BUSINESS_RULES.md` gains BR-100…BR-103.
- **Jobs**: a `quality-calibration-due` sweep (30/7/0) on the existing pg-boss queue.
- **Docs**: `ENTITY_CATALOG.md`, `REPORT_CATALOG.md`, `NAVIGATION_MODEL.md`,
  `JOURNAL_RULES.md`, `ACCOUNTING_INVARIANTS.md`, `BUSINESS_RULES.md`, the
  food-manufacturing template doc (hazard registers).
- **No new ADR** — blocking rides a shared validation service; postings ride the posting
  engine; CR-36 gates apply.
- **Offline sync assessment (OA-02)**: N/A-recorded — QMS workflows are web-only; the
  hold check is server-side so any offline document carrying a held batch is rejected at
  sync reconciliation.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migration `0087` (specifications, SPC measurements) + journal/spec updates | api |
| T-02 | Migration `0088` (NCR, CAPA, complaints) | api |
| T-03 | Migration `0089` (calibration records, supplier quality scores, COA documents) | api |
| T-04 | Migration `0090` (batch holds, recall registry, management reviews, hazard registers) + grants | api |
| T-05 | Specifications API + inspection-result mapping contract (feeds from the existing inspections module) | api |
| T-06 | NCR API: sources, severity, dispositions; G-62 scrap write-off posting; closure gate (BR-101) | api |
| T-07 | CAPA API: root cause, actions, effectiveness check gate (BR-102); G-63 external cost posting | api |
| T-08 | Calibration API: instrument-as-asset binding, due-date sweep job | api |
| T-09 | SPC service: X-bar/R computation, Cp/Cpk, out-of-control flags + property tests on known datasets | api |
| T-10 | Supplier quality scores: rolling computation + the documented feed contract to the 038 scorecards | api |
| T-11 | COA generation service (BR-103) + bilingual print template | api |
| T-12 | Complaints API with NCR link + intake notifications | api |
| T-13 | Batch holds: shared blocking validation service wired into every issue/ship path (INV-035, BR-100) + invariant test | api |
| T-14 | Recall registry: batch → where-used → customers drill on the batch/serial ledger | api |
| T-15 | `/quality/ncr`, `/quality/capa`, `/quality/calibration`, `/quality/spc`, `/quality/complaints` screens + COA print surface | web |
| T-16 | Management review pack + hazard registers composed into the food-manufacturing template manifest | api |
| T-17 | Report contracts ×4 + `REPORT_CATALOG.md` rows + catalog↔registry check extension | api |
| T-18 | Golden tests G-62/G-63 + INV-035 test + RLS attack tests A1–A10 + OA-06 budgets on SPC and recall drill queries | api |
| T-19 | Docs: catalog/invariants/journal-rules/business-rules/navigation/template updates | docs |
| T-20 | Run full local gates and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations `0087…0090` apply cleanly with Drizzle mirror parity; all 12 new tables
   have `ENTITY_CATALOG.md` rows (CR-36a).
2. The NCR → CAPA lifecycle runs end-to-end: NCR closure requires a disposition (BR-101);
   CAPA closure requires the effectiveness check recorded after the action due date
   (BR-102); golden tests G-62 (scrap write-off) and G-63 (external quality cost) post
   balanced entries through the posting engine.
3. INV-035 holds: any issue/ship document line referencing a batch with an active
   quality hold is rejected server-side on every baseline path (sales delivery,
   inventory issue, and any 044 picking path when delivered); release requires a
   disposition-linked record (BR-100).
4. COA generation produces a certificate from inspection results against the item's
   specification, blocked unless every parameter is within tolerance or carries an
   accepted-deviation NCR reference (BR-103); the print renders bilingual AR/EN with
   RTL correctness.
5. SPC charts compute correctly on known datasets (X-bar/R, Cp/Cpk) with out-of-control
   points flagged; property tests cover the math.
6. Supplier quality scores compute from NCR/rejection/delivery data and expose the
   documented feed contract consumed by the 038 scorecards.
7. The recall drill resolves a batch to its where-used chain and the customers who
   received it within the OA-06 budget (indexed where-used query, EXPLAIN-verified).
8. The `quality-calibration-due` sweep fires 30/7/0-day alerts bound to instrument
   assets; the food-manufacturing template composes `quality` + hazard registers in its
   manifest.
9. CR-36 gates: +10 permission keys with zero-drift equality · i18n parity · RLS attack
   tests A1–A10 on all new tables · feature-flag/template gating verified ·
   `docs:validate` green · manifest reconciliation.
10. Completion report `reports/PHASE-050-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` row flipped; archive delivered as
    `ERP_PLATFORM_PHASE050.zip` (OA-07).

## 7. Risks and Constraints

- **Enforcement drift** — a new issue path added later could bypass the hold check:
  mitigated by a single shared validation service plus the INV-035 invariant test wired
  into the document-validation test suite every path must extend.
- **SPC math correctness** — wrong control limits silently mislead: mitigated by property
  tests against reference datasets and pinned formulas documented in the phase report.
- **Recall drill performance** — where-used over large serial ledgers can degrade:
  mitigated by indexed traversal and the OA-06 budget as an acceptance criterion.
- **Regulatory variance of hazard registers** — HACCP interpretations differ by
  jurisdiction and auditor: mitigated by template-composable registers (not hardcoded
  checklists) and a documented critical-limits structure the tenant owns.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-050-COMPLETION.md`
  (evidence per acceptance criterion, G-62/G-63 transcripts, the INV-035 blocking test
  matrix, SPC reference-dataset results).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-050 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase PHASE-051 (Foreign Trade & Logistics); unconnected Wave-2
  siblings may run in parallel per
  [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE050.zip` (OA-07) and handed
  to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-051».
- Handoff notes for PHASE-051: certificate-of-origin/analysis print patterns and the
  bilingual print pipeline shipped here are reused for trade certificates; the
  batch-hold blocking service is the precedent for bonded-warehouse movement
  restrictions on stock.
