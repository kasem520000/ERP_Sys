# PHASE-048 — Projects & Contracting

> **Status:** NOT_STARTED — PLANNED (Blueprint v3.0, IDs bound by v3.1/CR-45) · **Wave:** 2 / Stage 13 · **Register:** [CR-18](../../planning/COMPLETENESS_REGISTER.md)
> **Evidence base:** [gap-analysis/ERP_FULL_GAP_ANALYSIS.md](../../planning/gap-analysis/ERP_FULL_GAP_ANALYSIS.md) §2 (H-06) · §11 (PR-01…PR-15) · §29.1 (DF-08) · [gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md](../../planning/gap-analysis/GAP_ANALYSIS_LAYER2_IFRS_ADVANCED.md) (L2-15 milestone billing · L2-20 subcontracting — v3.1 ID bindings on existing scope) · [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §6.1/§6.2

## 1. Phase Overview

- **Phase ID:** PHASE-048
- **Title:** Projects & Contracting (المشاريع والمقاولات)
- **Objective:** Turn the audit's "projects table = 6 columns, no more" (H-06) into a real
  project-management and Gulf-contracting module: a WBS with milestones, dependencies,
  weights and %-complete; budgets by cost type with a full vs-actual rollup (labor from
  time entries, materials from inventory issues, subcontractors from certificates,
  overhead by allocation); EVM discipline (PV/EV/AC, CPI/SPI, forecast at completion);
  resource allocation of employees and assets; change orders gated by approval;
  subcontractor agreements and certificates with retention; customer billing through
  progress certificates that generate sales invoices; retention hold and release
  postings; advance applications; and a field-service dispatch board with SLA clocks.
- **Business value:** Contracting is the audit's biggest single Gulf differentiator
  (DF-08): progress certificates, retention and multi-currency contracts are the daily
  bread of GCC contractors who today pay heavily for that capability. The same machinery
  gives every project-driven tenant — professional services, workshops, fit-out — EVM
  visibility and honest profitability (PR-12) instead of a bare P&L dimension, and
  closes the field-service hole (PR-13/PR-14/PR-15) for service businesses.
- **الملخص التنفيذي (AR):** تحوّل هذه المرحلة جدول المشاريع ذا الأعمدة الستة إلى
  منظومة مشاريع ومقاولات كاملة: هيكل عمل بمهام ومعالم وتبعيات وأوزان ونسب إنجاز،
  موازنات بأنواع التكلفة مع مقارنة شاملة بالفعلي (عمالة من قيود الوقت، مواد من
  صرف المخزون، مقاولو الباطن من المستخلصات، حملات بإعادة التوزيع)، منهجية إدارة
  القيمة المكتسبة PV/EV/AC بمؤشرات CPI/SPI وتوقعات الإكمال، تخصيص الموارد من
  الموظفين والأصول، أوامر التغيير بموافقة مسبقة، عقود الباطن ومستخلصاته مع
  الاحتجاز، فواتير العملاء عبر مستخلصات الإنجاز مع ترحيل الإيراد واحتجاز الضمان
  وصرفه، الدفعات المقدمة، ولوحة خدمة ميدانية بفنيين وساعات SLA — بشهادات طباعة
  عربية وعقود متعددة العملات (DF-08).

## 2. Scope

In scope:

1. **WBS (PR-04, H-06)**: `project_wbs_tasks` — tree with milestones (zero-duration
   flag), predecessor dependencies, weight, and `percent_complete` with weighted rollup
   to the project; cycle-safe dependency validation.
2. **Project budgets (PR-01)**: `project_budgets` + `project_budget_lines` by cost type
   LABOR/MATERIAL/SUBCONTRACT/OVERHEAD, planned amounts spread over the WBS schedule
   (the cost curve behind PV), with a vs-actual rollup per type and per WBS node.
3. **Resource allocation (PR-03)**: `project_resource_allocations` — employee or asset,
   date range, allocation %, with over-allocation warnings against calendars.
4. **Labor actuals (PR-09, PR-10)**: the existing time-entry surface gains the WBS-task
   dimension; labor cost is valued at employee cost rates from the payroll data — the
   payroll journal itself is consumed read-only, never duplicated.
5. **EVM (PR-02, PR-12)**: PV from the budget curve, EV from approved %-complete ×
   budget, AC from labor + material issues + subcontractor certificates + overhead
   allocation; CPI/SPI/EAC/ETC computed per project and per WBS node; INV-032 makes the
   reconciliation to source documents binding.
6. **Change orders (PR-05)**: `change_orders` — scope delta description, price delta,
   schedule delta; approval is required before any budget, billing or contract-value
   effect (G-59); multi-step approval chains bind here when the workflow engine of
   PHASE-052 lands.
7. **Subcontracting (PR-06 — the L2-20 home since v3.1/CR-45)**:
   `subcontractor_agreements` (value, currency, retention %,
   period) + `subcontractor_certificates` (progress %, gross value, retention withheld,
   net payable); subcontractor retention is tracked in the same retention ledger.
   The v3.1 binding documents the **inbound-subcontract purchase linkage**: each
   certificate drives its subcontractor purchase obligation through the purchasing
   chain (the AP debit-note/PO linkage), and PHASE-043's tolling flow (M-21) covers
   the manufacturing-side subcontract — together closing L2-20.
8. **Retention (PR-07, DF-08)**: `retention_accounts` — hold %, accrued balance, release
   schedule tied to taking-over and defect-liability dates; G-56 (hold at each
   certificate) and G-57 (release at final acceptance) define the postings.
9. **Progress-certificated billing (PR-11, PR-08 — the L2-15 home since
   v3.1/CR-45)**: `progress_certificates` — type
   PROGRESS/ADVANCE/FINAL, cumulative completed %, gross value, retention, net — generate
   sales invoices on approval; G-58 recognizes revenue at the approved cumulative value;
   advance applications post as customer advances amortized against later certificates,
   mirroring the supplier-advance discipline of PHASE-038 on the customer side.
   The v3.1 binding adds the **IFRS-15 output-method alignment rule**: the certificate
   completion measure and PHASE-068's recognition schedules (L1-02) must use a
   consistent output method per contract (the interface contract both sides honor;
   L2-15's residual is exactly this alignment, not a rebuild).
10. **Field service (PR-13, PR-14, PR-15)**: `service_visits` on the existing service
    orders — technician, time window, status
    NEW→SCHEDULED→DISPATCHED→IN_PROGRESS→COMPLETED→CLOSED, SLA response/resolution
    clocks with pause states and breach escalation (BR-065), completion notes and parts
    used.
11. **Contracting print pack (DF-08)**: bilingual AR/EN print templates for progress
    certificates, subcontractor certificates and retention statements; contracts in any
    enabled currency with FX applied at posting per the existing FX discipline.

Out of scope: analytic dimensions beyond project (053) · the approval-chain engine
itself (052) · resource capacity leveling (043 owns work-center capacity) · customer
portal certificate approval (060) · FX revaluation runs (053) · intercompany
charge-backs (053).

## 3. Prerequisites

| Prerequisite | Status |
|---|---|
| PHASE-036 — Extensibility Core COMPLETE (custom fields surfaced on WBS tasks, budget lines, change orders — CR-06) | NOT_STARTED — PLANNED (Blueprint v3.0) |
| Delivered baseline: projects + time entries + sales invoices, posting engine, multi-currency FX discipline, RLS isolation, AR/EN i18n, ⌘K palette | delivered (stages 1–11) |
| Soft dependencies (read-only, not blocking): PHASE-038 advance postings pattern · PHASE-044 WMS issue paths for material actuals | NOT_STARTED — PLANNED (degrade gracefully when absent) |

Hard ordering 036 before 042+ is binding
([COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5); the baseline
projects module, time entries and the posting engine are already delivered and are
extended, not replaced.

## 4. Design Impact

- **Navigation**: +3 screens — `/projects` (WBS board with a Gantt-ish timeline,
  dependencies and %-complete), `/projects/contracting` (certificates, retention, change
  orders, subcontracts), `/projects/fieldservice` (dispatch board) — plus an EVM tab on
  the project detail surface; ⌘K registration (OA-04); 12-template screen discipline.
- **Migrations**: 4 scripts, next in sequence — `0079_projects_wbs.sql`,
  `0080_projects_budgets_allocation.sql` (budgets/lines + allocations + the WBS
  dimension on time entries), `0081_projects_change_orders.sql`,
  `0082_projects_contracting_fieldservice.sql` (subcontracts, certificates, retention,
  progress certificates, service visits) with the DATA-ONLY grants block appended per the
  house convention. Exact numbers confirmed against the Drizzle journal at
  implementation time.
- **Entities**: +9 tenant tables → SQL + Drizzle mirror + `ENTITY_CATALOG.md` rows
  (CR-36a); +1 column family on the existing time-entry table.
- **Permissions**: +14 keys — `projects.wbs.view/manage`, `projects.budget.view/manage`,
  `projects.allocation.manage`, `projects.change_order.view/approve`,
  `projects.contracting.view/manage`, `projects.certificates.approve`,
  `projects.retention.manage`, `projects.evm.view`,
  `projects.fieldservice.view/dispatch`; zero-drift discipline extended (CR-36b).
- **i18n**: ~+300 AR/EN key pairs across the three screen families and the print
  templates; parity equality extended (base+n = base+n).
- **Reports**: +4 contracts — `projects.evm-summary`, `projects.contract-progress`,
  `projects.retention-statement`, `projects.fieldservice-sla` — with `REPORT_CATALOG.md`
  rows and the catalog↔registry reconciliation check extended.
- **Feature flags**: `projects.wbs`, `projects.contracting`, `projects.fieldservice` —
  template-composable grants (CR-36f); professional-services, automotive-workshop and
  rental-logistics templates compose them by default.
- **Posting rules**: `JOURNAL_RULES.md` gains G-56 (retention hold at certificate),
  G-57 (retention release at acceptance), G-58 (progress-certificate revenue),
  G-59 (change-order delta); `ACCOUNTING_INVARIANTS.md` gains INV-032 (EVM
  consistency); `BUSINESS_RULES.md` gains BR-061…BR-065 (retention % from the contract,
  cumulative billing ≤ approved contract value including approved change orders, change
  orders inert until approved, weighted %-complete rollup integrity, SLA breach
  escalation on pause-aware clocks).
- **Print templates**: 3 bilingual templates (progress certificate, subcontractor
  certificate, retention statement).
- **Docs**: `ENTITY_CATALOG.md`, `REPORT_CATALOG.md`, `NAVIGATION_MODEL.md`,
  `JOURNAL_RULES.md`, `ACCOUNTING_INVARIANTS.md`, `BUSINESS_RULES.md`, the
  crm-projects tables doc.
- **No new ADR** — postings ride the centralized posting engine; CR-36 gates apply.
- **Offline sync assessment (OA-02)**: service visits are flagged as a future offline
  candidate for technicians; N/A-recorded for this phase (capture surfaces revisit with
  the sync-conflict surfaces of PHASE-062).

## 5. Implementation Plan

| Task | Description | Layer |
|---|---|---|
| T-01 | Migration `0079` (WBS tasks tree, milestones, dependencies) + journal/spec updates | api |
| T-02 | Migration `0080` (budgets + lines by cost type, allocations, WBS dimension on time entries) | api |
| T-03 | Migration `0081` (change orders with approval link) | api |
| T-04 | Migration `0082` (subcontracts, sub certificates, retention accounts, progress certificates, service visits) + grants | api |
| T-05 | WBS API: tree, dependency cycle detection, weighted %-complete rollup (BR-064) | api |
| T-06 | Budget API: cost-curve construction, vs-actual rollup by cost type and node | api |
| T-07 | Labor/material/subcontract actual collectors + overhead allocation; INV-032 reconciliation service | api |
| T-08 | EVM service: PV/EV/AC, CPI/SPI, EAC/ETC, forecast at completion + tests | api |
| T-09 | Change-order API: approval gate (BR-063), contract-value/budget/billing effects (G-59) | api |
| T-10 | Subcontracting API: agreements, certificates with retention, AP linkage | api |
| T-11 | Retention ledger + G-56/G-57 posting rules through the posting engine | api |
| T-12 | Progress-certificate billing: certificate → sales invoice, G-58 revenue posting, advance application amortization | api |
| T-13 | Field-service API: dispatch, SLA clocks with pause states, breach escalation (BR-065) | api |
| T-14 | `/projects` WBS board + Gantt-ish timeline + EVM tab | web |
| T-15 | `/projects/contracting` screen (certificates, retention, change orders, subcontracts) | web |
| T-16 | `/projects/fieldservice` dispatch board + 3 bilingual print templates | web |
| T-17 | Report contracts ×4 + `REPORT_CATALOG.md` rows + catalog↔registry check extension | api |
| T-18 | Golden tests G-56…G-59 + INV-032 test + RLS attack tests A1–A10 + OA-06 budgets on rollup queries | api |
| T-19 | Docs: catalog/invariants/journal-rules/business-rules/navigation updates | docs |
| T-20 | Run full local gates and record evidence | all |

## 6. Verification

Acceptance criteria (all must pass with recorded evidence):

1. Migrations `0079…0082` apply cleanly with Drizzle mirror parity; all 9 new tables (+
   the time-entry dimension) have `ENTITY_CATALOG.md` rows (CR-36a).
2. WBS board renders the tree, milestones and dependencies; the weighted %-complete
   rollup (BR-064) reconciles node-by-node; dependency cycles are rejected.
3. The project cost rollup is complete and INV-032 holds: AC per project equals labor
   (time entries × cost rates) + materials (inventory issues) + subcontractor
   (certificates) + allocated overhead, reconciling to the GL project dimension to the
   cent.
4. EVM figures (PV/EV/AC, CPI/SPI, EAC/ETC) compute per project and per node; EV never
   exceeds the approved budget; the forecast surface renders trend + estimate at
   completion.
5. Change orders stay inert until approved (BR-063); approval adjusts contract value,
   budget and billing ceiling (G-59) exactly once (idempotent posting).
6. Golden tests pass on the seeded chart: G-56 retention withheld at each progress
   certificate, G-57 released at final acceptance, G-58 revenue recognized at the
   approved cumulative value, G-59 change-order delta posted — all through the posting
   engine with balanced entries.
7. Progress certificates generate sales invoices with retention withheld; advance
   applications post as customer advances and amortize against later certificates;
   cumulative billing never exceeds the approved contract value including change orders
   (BR-061/BR-062).
8. Field service: dispatch board assigns technicians; SLA response/resolution clocks
   honor pause states and escalate on breach (BR-065); completion records notes and
   parts.
9. CR-36 gates: +14 permission keys with zero-drift equality · i18n parity · RLS attack
   tests A1–A10 on all new tables · feature-flag/template gating verified ·
   `docs:validate` green · OA-06 budgets (indexes + EXPLAIN on the rollup and dispatch
   queries) — with the bilingual contracting prints rendering AR/EN with RTL correctness
   for certificates and retention statements, and multi-currency contracts posting
   through the existing FX discipline.
10. Completion report `reports/PHASE-048-COMPLETION.md` appended with evidence;
    `IMPLEMENTATION_STATUS.md` PHASE-048 row flipped; archive delivered as
    `ERP_PLATFORM_PHASE048.zip` (OA-07).

## 7. Risks and Constraints

- **%-complete honesty** — EVM is garbage-in when teams self-report progress: mitigated
  by certificate-gated EV for customer billing and the weighted structural rollup for
  internal EV, with the delta surfaced as a management signal.
- **Retention presentation variance** — accountants differ on contra-revenue vs
  receivable presentation: the default mapping is documented in G-56/G-57 and any owner
  deviation is recorded as a decision record at implementation time.
- **Dependency and scheduling edge cases** — WBS cycles and overlapping allocations can
  poison rollups: mitigated by cycle detection, allocation warnings and property tests.
- **SLA clock semantics** — timezones, pauses and re-dispatch make clocks easy to get
  wrong: mitigated by a single clock service with a dedicated test matrix.
- **Largest phase in the wave** — scope risk is real: mitigated by the task split above
  and by keeping field service to dispatch + SLA (scheduling optimization is explicitly
  deferred).

## 8. Completion and Handoff

- Completion report: `docs/implementation/phases/reports/PHASE-048-COMPLETION.md`
  (evidence per acceptance criterion, the four golden test transcripts, INV-032
  reconciliation output, SLA test matrix).
- Status flip: `IMPLEMENTATION_STATUS.md` PHASE-048 row → COMPLETE; `NEXT_ACTION.md`
  → next eligible phase PHASE-049 (CMMS — Asset Maintenance); unconnected Wave-2
  siblings may run in parallel per
  [COMPLETENESS_ROADMAP.md](../../planning/COMPLETENESS_ROADMAP.md) §5.
- Delivery: repository state archived as `ERP_PLATFORM_PHASE048.zip` (OA-07) and handed
  to the owner; the owner continues with «ابدأ تنفيذ المرحلة PHASE-049».
- Handoff notes for PHASE-049: the work-order status machine, board patterns and the
  SLA clock service shipped here are reused by maintenance work orders; the
  `project_resource_allocations` asset side hands the CMMS phase its cross-branch asset
  movement context.
