# PHASE-047 — HR Growth — Talent & Performance

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0) · **Wave:** 2 / Stage 13 · **Register:** [CR-17](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §10 (HR-05…HR-10) · §17 (N-14) · §29.4 (DF-51) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.2

## 1. Phase Overview

- **Phase ID:** PHASE-047
- **Title:** HR Growth — Talent & Performance (نمو الموارد البشرية — المواهب والأداء)
- **Objective:** Complete the HR trilogy that closes H-05. PHASE-045 delivered the employee
  master, attendance, leaves and shifts; PHASE-046 delivered compliant payroll. This phase
  adds the talent layer the audit scored at zero across §10: performance cycles with
  aggregated 360-degree feedback, a competency framework with scaled levels, cascading
  weighted goals with KRIs, a recruitment pipeline from vacancy to hire with panel
  interview scorecards, training programs with enrollments and certifications, an
  org-structure tree with AR/EN positions and grades, and an employee-document register
  with expiry sweeps (iqama, passport, contracts). It also ships the documented external
  HR integration surface (DF-51/N-14): export/import bridges that make the employee
  master, the org snapshot and appraisal results portable to and from external HR systems.
- **Business value:** The platform becomes the system of record for the whole employee
  lifecycle — hire, grow, certify, document — not just pay. For Gulf employers the
  document-expiry sweep alone (iqama/passport renewals, certification validity, probation
  end) converts a standing compliance exposure into a scheduled alert product; the
  recruitment pipeline and 360 reviews replace spreadsheet tracking for the 30+ employee
  companies the audit identified as the target band; and the external bridges unblock
  deals where an incumbent HRIS must remain in place.
- **الملخص التنفيذي (AR):** تختم هذه المرحلة ثلاثية الموارد البشرية التي بدأتها
  المرحلتان 045 و046: بعد الموظف والحضور والرواتب الممتثلة، تُضاف طبقة المواهب التي
  رصدها التدقيق بالصفر — دورات تقييم الأداء بمدخلات 360 مجمّعة، إطار كفاءات بمستويات
  مدرّجة، أهداف متسلسلة بأوزان ومؤشرات أداء، مسار توظيف من الشاغر حتى التعيين ببطاقات
  تقييم للجان المقابلات، برامج تدريب وتسجيلات وشهادات، هيكل تنظيمي بوظائف ثنائية
  اللغة ودرجات، وسجل وثائق الموظف مع تفقّد يومي لانتهاء الإقامة والجواز والشهادة
  وفترة التجربة وموعد التقييم — إضافة إلى جسور تصدير/استيراد موثّقة لأنظمة الموارد
  البشرية الخارجية (DF-51).

## 2. Scope

In scope:

1. **Performance cycles & reviews (HR-05)**: `performance_cycles` (period, status
   DRAFT→ACTIVE→CALIBRATION→CLOSED, participant scope by org unit / position) and
   `performance_reviews` (reviewer, reviewee, cycle, overall and per-competency scores,
   weighted goal rollup, comments, and 360 feedback inputs recorded per source
   relationship SELF/PEER/SUBORDINATE and shown to the reviewer only in aggregate).
2. **Competency framework (HR-06)**: `competencies` (AR/EN name, category) with
   `competency_levels` (1–5 scale with AR/EN level descriptors); review scorecards rate
   competencies against these levels.
3. **Cascading goals (HR-06)**: `goals` — parent–child tree cascading org → team →
   employee, weight, KRI target/actual/progress, status; per-reviewee active weights
   inside a cycle must sum to exactly 100%.
4. **Recruitment pipeline (HR-07)**: `vacancies` (position, requested headcount, status
   OPEN→ON_HOLD→FILLED→CANCELLED), `applicants` (source, pipeline stage
   NEW→SCREEN→INTERVIEW→OFFER→HIRED/REJECTED, monotonic transitions with a recorded
   reopen action), and `interviews` (one row per panelist slot per round: scheduled
   window, mode, scorecard ratings, verdict, comments).
5. **Training & certifications (HR-08)**: `training_programs` (internal/external,
   provider, cost), `training_enrollments` (employee, status, attendance, completion %,
   result) and `certifications` (employee, issuer, issue/expiry dates, certificate
   number).
6. **Org structure & positions (HR-09)**: `org_units` (tree with materialized path) and
   `positions` (title AR/EN, grade, org unit, reports_to position); the 045 employee
   master gains the position assignment as a documented extension.
7. **Employee documents (HR-10)**: `employee_documents` (type
   PASSPORT/IQAMA/VISA/CONTRACT/CERTIFICATE/OTHER, number, issue/expiry, notes) with a
   daily expiry sweep — the iqama/passport alert job of the audit's HR-10.
8. **Employee 360 view extension**: the existing employee detail surface gains a 360
   extension — position and org placement, review history with trend, active goals,
   training records, certifications, documents with expiry chips, and the recruitment
   source record for hired employees.
9. **Alerts**: `hr.document-expiry`, `hr.certification-expiry`, `hr.probation-end` (from
   the 045 employee master) and `hr.review-due` (cycle window closing) — fired at
   30/7/0 days before the date, deduplicated per employee per document.
10. **External HR integration surface (DF-51, N-14; the external-HR share of IN-06)**:
    documented bridges over the existing external-integrations surface — export of
    employee master, employment history and org snapshot (CSV/JSON), import of appraisal
    results and training completions with row-level validation reports. Workday and
    BambooHR field maps are documented as the reference profiles. No live third-party
    connector ships here; the public API platform of PHASE-055 is the substrate for live
    connectors.

Out of scope: live Workday/BambooHR connectors (055 substrate) · merit/bonus cycles that
write payroll variables (046 owns payroll posting) · succession planning and 9-box grids
(candidate idea, recorded not committed) · payroll cost-rate maintenance (046) · any GL
posting — this phase is ledger-free by design.

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-046 — HR Payroll Compliance COMPLETE | NOT_STARTED — PLANNED (Blueprint v3.0) |
| PHASE-045 — HR Core COMPLETE (employee master, employee↔user linkage, probation dates) | NOT_STARTED — PLANNED (Blueprint v3.0) |
| Delivered baseline: employee master + payroll tables, posting engine, RLS isolation, AR/EN i18n, ⌘K palette, pg-boss jobs | delivered (stages 1–11) |

Hard ordering 045 → 046 → 047 is binding
([COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5): performance and
talent data without the employee master and its user linkage has no substrate.

## 4. Design Impact

- **Navigation**: +4 screens — `/hr/performance`, `/hr/recruitment`, `/hr/training`,
  `/hr/org-structure` — plus the employee 360 extension; all registered in `NAV_ITEMS`
  and the ⌘K palette (OA-04), following the 12-template screen discipline (AR/EN parity,
  RTL, empty/loading states).
- **Migrations**: 4 scripts, next in sequence — `0075_hr_talent_performance.sql`
  (cycles/reviews/competencies/levels/goals), `0076_hr_talent_recruitment.sql`
  (vacancies/applicants/interviews), `0077_hr_talent_training_org.sql`
  (training/certifications/org units/positions/employee documents) and
  `0078_hr_talent_grants.sql` (DATA-ONLY: permission seeds, plan/template grants,
  competency scale seed). Exact numbers are confirmed against the Drizzle journal at
  implementation time (phases 036–046 are expected to consume 0049–0074).
- **Entities**: +14 tenant tables → SQL migration + Drizzle mirror + `ENTITY_CATALOG.md`
  rows (CR-36a).
- **Permissions**: +12 keys — `hr.performance.view/manage/review`,
  `hr.recruitment.view/manage/interview`, `hr.training.view/manage`,
  `hr.org.view/manage`, `hr.documents.manage`, `hr.competency.manage`; the zero-drift
  discipline is extended (registry = seed, no drift at whatever base 036–046 leave).
- **i18n**: ~+260 AR/EN key pairs across the four screen families and the 360 extension;
  the parity equality check is extended (base+n = base+n).
- **Reports**: +4 contracts — `hr.performance-cycle-results`, `hr.recruitment-pipeline`,
  `hr.training-completions`, `hr.document-expiry` — with `REPORT_CATALOG.md` rows and the
  catalog↔registry reconciliation check extended.
- **Feature flags**: `hr.performance`, `hr.recruitment`, `hr.training`, `hr.org` —
  template-composable grants (CR-36f); the professional-services, healthcare, education
  and food-manufacturing templates compose them by default in their manifests.
- **Jobs**: one daily sweep (`hr-expiry-sweep`) on the existing pg-boss queue covering
  documents, certifications, probation end and review due.
- **Docs**: `ENTITY_CATALOG.md`, `REPORT_CATALOG.md`, `NAVIGATION_MODEL.md`,
  `FEATURE_CATALOG.md`, `BUSINESS_RULES.md` (BR-087…BR-090 — reservations re-coordinated 2026-11-13 per [../../planning/ID_LEDGER.md](../../planning/ID_LEDGER.md); the original plan's BR-057…060 predate the 036/037 waves' consumption of those slots), the HR tables doc, and the
  integrations README (bridge contracts).
- **No GL postings** — `JOURNAL_RULES.md` and `ACCOUNTING_INVARIANTS.md` are untouched;
  this phase adds no golden entries.
- **No new ADR** — all changes are within decided patterns; CR-36 gates apply.
- **Offline sync assessment (OA-02)**: N/A-recorded — talent workflows are web-only, no
  synced entity is added, the sync-fleet harness needs no extension.

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migration `0075` (performance cycles/reviews, competencies/levels, goals) + journal/spec updates | api |
| T-02 | Migration `0076` (vacancies, applicants, interviews) + journal/spec updates | api |
| T-03 | Migration `0077` (training, certifications, org units, positions, employee documents) + journal/spec updates | api |
| T-04 | Migration `0078` DATA-ONLY: permission seeds, plan/template grants, competency scale seed | api |
| T-05 | Performance API: cycle lifecycle, review submission, 360 aggregation with min-3 anonymization (BR-089), calibration | api |
| T-06 | Goals API: cascade tree, weight-sum validation (BR-088), KRI progress rollup | api |
| T-07 | Recruitment API: vacancies, applicant pipeline with monotonic stages (BR-087), interview scorecards | api |
| T-08 | Training/certifications API + org tree/positions API with reports_to cycle detection | api |
| T-09 | Employee documents API + `hr-expiry-sweep` job (30/7/0, deduplicated) + notifications | api |
| T-10 | External HR bridges: export/import endpoints, validation reports, integration contract docs | api |
| T-11 | `/hr/performance` screens (cycle admin, review entry, calibration view) | web |
| T-12 | `/hr/recruitment` screens (vacancy board, applicant pipeline, interview scheduling + scorecards) | web |
| T-13 | `/hr/training` and `/hr/org-structure` screens (tree editor with cycle-safe moves) | web |
| T-14 | Employee 360 extension + alert list surfaces | web |
| T-15 | Report contracts ×4 + `REPORT_CATALOG.md` rows + catalog↔registry check extension | api |
| T-16 | `ENTITY_CATALOG.md` / `BUSINESS_RULES.md` / `NAVIGATION_MODEL.md` / `FEATURE_CATALOG.md` updates | docs |
| T-17 | RLS attack tests A1–A10 for the 14 new tables + OA-06 performance budgets (applicant pipeline, review aggregation) | api |
| T-18 | Run full local gates (typecheck/lint/tests/docs/i18n parity/permissions drift) and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations `0075…0078` apply cleanly with Drizzle mirror parity; all 14 new tables
   have `ENTITY_CATALOG.md` rows (CR-36a).
2. A full performance cycle runs end-to-end — activate, submit reviews with 360 inputs
   (aggregated, minimum 3 responses per relationship, never attributed — BR-089),
   calibrate, close — and per-reviewee goal weights sum to exactly 100% (BR-088).
3. The recruitment pipeline enforces monotonic stage transitions (BR-087); hiring an
   applicant links the record to the 045 employee master; interview scorecards record
   per panelist per round.
4. Training enrollments and certifications record completion and results; certifications
   feed the expiry sweep with issuer and expiry intact.
5. `hr-expiry-sweep` fires at 30/7/0 days for iqama/passport documents, certifications,
   probation end and review due, deduplicated per employee per document; evidence in the
   job log and notification records.
6. The four screens and the 360 extension render with AR/EN parity, RTL and
   loading/empty states; they are registered in `NAV_ITEMS` and ⌘K (OA-04) with
   feature-flag gating verified per plan and per template composition.
7. +12 permission keys seeded; the zero-drift equality holds (CR-36b); a business-plan
   tenant sees the granted subset, an enterprise tenant sees all four families.
8. RLS attack tests A1–A10 extended to all 14 new tenant tables — cross-tenant
   reads/writes rejected (CR-36e).
9. House gates green — typecheck · lint · boundaries · unit tests · `docs:validate` ·
   i18n parity · permissions drift · manifests · OA-06 budgets (indexes + EXPLAIN on the
   applicant pipeline and review aggregation queries) — and the external bridges
   verified: employee master + org snapshot export as CSV/JSON, appraisal-results import
   validates rows and rejects bad rows with a report, bridge contracts documented in the
   integrations README.
10. Completion report `reports/PHASE-047-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` PHASE-047 row flipped; archive delivered as
    `ERP_PLATFORM_PHASE047.zip` (OA-07).

## 7. Risks and Constraints

- **Sensitive appraisal data** — the most privacy-sensitive payload in the platform:
  mitigated by dedicated permission keys, RLS attack tests per table, and aggregate-only
  360 visibility (BR-089); a field-level audit note is recorded for the governance phase
  to formalize later.
- **Org-tree corruption** — a cycle in `reports_to` or `org_units` breaks every rollup:
  mitigated by cycle-detection validation at write time and materialized paths.
- **Stage sprawl in recruitment** — tenant-custom stage sets would fragment the pipeline
  report: mitigated by the fixed stage enum with an explicit recorded reopen action
  instead of backward jumps (BR-087).
- **Prerequisite drift** — the 045/046 field contracts (probation date, employee↔user
  linkage) may shift before this phase runs: mitigated by consuming their documented
  contracts and recording any delta in the completion report.

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-047-COMPLETION.md`
  (evidence per acceptance criterion, local gate output, the bridge contract summary).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-047 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase PHASE-048 (Projects & Contracting); unconnected Wave-2 siblings
  may run in parallel per
  [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE047.zip` (OA-07) and handed
  to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-048».
- Handoff notes for PHASE-048: `positions` (with grades and cost bands) and the employee
  master are the picker source for `project_resource_allocations`; the employee 360
  extension is the surface project managers will use when allocating people to WBS
  tasks.
