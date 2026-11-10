# PHASE-032 — Education Commercial Shell

> **Status:** COMPLETE · **Updated:** 2026-11-08 — configuration-only scope
> shipped on the PHASE-027 lineage (see
> [reports/PHASE-032-COMPLETION.md](reports/PHASE-032-COMPLETION.md)); the
> DB-level governance suites re-run on the harness environment.

## 1. Phase Overview

- **Phase ID:** PHASE-032
- **Title:** Education Commercial Shell
- **Objective:** Deliver the `industry.education` template (ED-08) as a **commercial
  shell** through the unmodified PHASE-015 engine: the guardian is the paying partner,
  the student is a partner financial file (no academic data), the enrollment year is a
  service contract via `crm.service_contracts` (no new contract engine), tuition bills
  through ordinary sales invoices with sibling/multi-child line discounts, and the tuition
  calendar is the PHASE-027 installments backbone — plans, schedules, collections, and
  late fees (BR-048/BR-049, golden G-28) — wrapped in aging-driven dunning cycles, report
  packs, terminology, and navigation patches. **Configuration only**: no new tables, no new
  modules, no new feature keys or permissions, and INV-022 unchanged — the template selects
  accounts, features, and policies, never accounting mathematics.
- **Business value:** Private schools (K-12), training centers, tutoring institutes,
  test-prep academies, and nurseries across MENA bill guardians in term or monthly
  installments; chasing late tuition is the commercial office's daily work, not an edge
  case. This phase makes the school's money office — contract → invoice → plan → due →
  collect → late fee — auditable end-to-end on the same financial core (G-01/G-05/G-28)
  while ED-11 keeps academic operations honestly out of scope.

## 2. Scope

In scope:

1. **Template application via the PHASE-015 engine** (a needed engine change here is a
   PHASE-015 defect to fix there, not a fork): `industry.education` v1.0.0 per
   [education.md](../../industries/templates/education.md) — terminology overrides
   (`الطالب (الملف المالي)` student financial file, `ولي الأمر (الدافع)` guardian payer,
   `عقد الالتحاق` enrollment contract, `القسط` installment, `خطة الأقساط` installment
   plan, `الدفعة المقدمة` down payment, `رسوم التأخير` late fee, `خصم الأشقاء` sibling
   discount…), the Enrollment / الالتحاق and Tuition billing / فوترة الرسوم navigation
   groups, workflow policies (`guardian_is_paying_partner`, `tuition_invoice_from_contract`,
   `installment_schedule_immutable_after_activation`, `late_fee_policy_per_plan`,
   `sibling_discount_line_level`, `dunning_cycle_before_late_fee`,
   `invoice_approval_required`), series `INV/RCP/CN`, stock modules **not** enabled
   (WAC dormant; service items the default item type), report pins
   (`installments.schedule` + `installments.aging` on the dashboard), and onboarding
   steps (confirm the CoA with tuition revenue + `LATE_FEE_INCOME`; programs/grades +
   fee schedules; guardian partners + student financial files; first enrollment
   contract; first tuition invoice + installment plan; collect a due installment with a
   late fee).
2. **Guardian-as-partner financial files** (per the manifest's required
   `partners.directory`/`partners.statements` keys): the guardian is the AR partner —
   invoices, receipts, allocations, and statements all address the guardian; the student
   is a partner financial file with attributes only (program/grade label, sibling group),
   **never academic data** — cohort reporting rides partner attributes and cost centers
   ([education.md](../../industries/templates/education.md) known limitations); guardian
   statements print through the existing `partners.statements` feature.
3. **Enrollment/year contracts via `crm.service_contracts` — no new contract engine**:
   one enrollment contract عقد الالتحاق per student per year as the billing schedule
   source (`CT-` contract register); the contract itself posts nothing (no ledger effect);
   term invoices generate from the contract schedule via `crm.recurring_billing`
   (OPTIONAL key) or are raised manually; registration deposits remain on-account credits
   per BR-027 (`crm.contract_deposits`/`crm.late_fees` stay optional pending-intake keys —
   the template must degrade cleanly when a plan lacks them, governance test #7).
4. **Tuition fee schedules**: fee items as service items (`items.item_master`) with
   per-program/per-grade fee-schedule price lists (`items.price_lists`, BR-003
   precedence); the down payment appears as an invoice line or as the plan's first term.
5. **Tuition invoices + sibling/multi-child discounts**: tuition invoices from the
   contract (single annual or per-term): **DR AR (guardian) · CR tuition revenue · CR
   VAT** where the jurisdiction pack taxes education (G-01 — treatment from the pack,
   nothing hard-coded); sibling/multi-child discounts are **line-level discounts on
   invoices** via `sales.discount_management` under BR-002 role ceilings — no new
   pricing engine surface; approval is required before posting (template policy), so
   creator ≠ approver SoD applies on the existing invoice approval.
6. **Installment plans — the tuition backbone** (`installments.plans`,
   `installments.schedules`, `installments.collections`, `installments.late_fees` from
   [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md)): a plan activates against the
   tuition invoice — **plan total = invoice total exactly (BR-048)**; the schedule
   (down payment + monthly/term dues) is immutable after activation; collection runs
   raise ordinary receipts that allocate to installment lines (G-05); the OVERDUE job
   flags past-due lines; late fees post **only via the engine** as **G-28**
   (DR `AR_CONTROL` · CR `LATE_FEE_INCOME`) per the per-plan policy (BR-049 — rate, cap,
   and grace are tenant-configured PLACEHOLDER defaults, OQ-002 family); waivers are
   explicit credit-note lines, never silent edits; parents paying by post-dated cheques
   use `notes.received` (OPTIONAL, PHASE-027).
7. **Dunning cycles** (policy `dunning_cycle_before_late_fee`): the aging buckets of
   `installments.aging` drive the reminder cycle before any late-fee posting; guardian
   statements and `partners.ar_aging` back the follow-up; this is policy + report
   configuration over the PHASE-027 module — no new dunning engine.
8. **Report packs** (existing PHASE-013 contract keys pinned at apply time — **no new
   report keys**): `installments.schedule` (dashboard), `installments.aging` (dashboard),
   `services.contract_revenue_schedule`, `partners.ar_aging`, and
   `partners.statements` for guardians — monetary totals carry GL tie-outs where they
   exist (INV-009 AR subledger; plan totals tie to their source invoices per BR-048).
9. **Terminology + navigation patches**: the two manifest nav groups apply additively
   through the PHASE-015 nav registry — templates surface existing targets
   (`crm.contracts`, `partners.directory`, `items.price_lists`, `installments.plans`,
   `sales.invoices`, `installments.collections`, `treasury.receipts`); core navigation
   groups are retained, never removed; RTL-first Arabic labels; document numbering
   defaults per the manifest (`INV-{yyyy}-{seq:6}`, `RCP-{yyyy}-{seq:6}`,
   `CN-{yyyy}-{seq:5}`).

Out of scope (explicit):

- **Academic scheduling** (timetables, teacher allocation, room planning), **grades,
  attendance, and LMS** (report cards, coursework, academic parent portals), and
  **transport and canteen operations** (bus routes, meal planning) — ED-11 deep-vertical
  operations; transport/canteen remain *billable* fee/service items, nothing more
  ([education.md](../../industries/templates/education.md)).
- Any new contract, discount, dunning, or late-fee engine; any new table, module,
  feature key, or permission (register §C/§D assign `industry.education` none); anything
  that touches INV-022 (templates never alter accounting mathematics).
- Stock/POS surfaces (stock modules stay disabled by default — a tenant enabling a
  school shop later activates ordinary inventory); offline guardian self-service portals
  (PHASE-022 personal-account scope unchanged); deep-vertical academic decision records
  (a future DR would be required per ED-11 — see
  [DR-003-platform-expansion-v2.md](../../decisions/product/DR-003-platform-expansion-v2.md)).

## 3. Prerequisites

- **PHASE-025 COMPLETE** (GA gate): stage-10 templates apply on the GA platform;
  stages 9–11 are additive releases that never alter the GA gate (ED-01). Verified via
  the completion report + green CI.
- **PHASE-015 COMPLETE** — the framework (functional prereq, register §B). Consumed
  artifacts: the template engine (apply/switch/extend with diff preview), terminology
  resolution, navigation registry, series/policy/report seeds, onboarding checklists,
  additive-only switching per BR-038, template audit events, and the seven governance
  tests. Verified via [PHASE-015.md](PHASE-015.md) completion report + green CI.
- **PHASE-027 COMPLETE** — installments, the tuition backbone (functional prereq,
  register §B): `installment_plans`/`installment_lines` with the BR-048 total lock and
  post-activation immutability, collections via receipt allocation, the OVERDUE job,
  the per-plan late-fee policy jsonb with engine-only G-28 posting (BR-049), the
  `installments.schedule`/`installments.aging` report contracts, and `notes.received`
  for PDC tuition cheques. Verified via [PHASE-027.md](PHASE-027.md) completion
  report + green CI.
- **PHASE-012 COMPLETE** (consumed as-is): invoices with discount lines
  (`sales.discount_management`, BR-002), receipts and allocations (INV-016), credit
  notes for waivers, and the AR partner subledger (INV-009).
- **PHASE-019 COMPLETE** (OPT at the phase level per register §B — consumed as-is):
  `crm.service_contracts` for enrollment years and `crm.recurring_billing` for
  term-invoice generation. It is a pre-GA phase, so the required feature is present on
  the GA platform; "OPT" means this phase's acceptance exercises the enrollment contract
  only as a schedule source, not CRM-specific flows beyond it.
- Required architecture decisions:
  [ADR-0005](../../architecture/ADR/ADR-0005-multi-tenancy.md) (a template applies inside
  one tenant and never crosses tenants),
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (zero new
  posting surfaces — tuition flows ride existing engine rules G-01/G-05/G-28),
  [ADR-0016](../../architecture/ADR/ADR-0016-ui-tailwind-radix.md) (every surfaced screen
  instantiates a sanctioned archetype from the design system).
- Relevant documentation:
  [education.md](../../industries/templates/education.md) (the template — authoritative
  manifest),
  [industries/README.md](../../industries/README.md) §3 (manifest schema), §5
  (additive-only rules), §8 (the seven governance tests),
  [industry-workflows.md](../../industries/workflows/industry-workflows.md) (j) education
  flow, [BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §12 (installment
  chain) and §8-style recurring billing,
  [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md) (EDU column;
  `installment_terms` row),
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-002, BR-003, BR-027, BR-038,
  BR-048, BR-049), [JOURNAL_RULES.md](../../accounting/JOURNAL_RULES.md) §7 (G-28),
  [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md) (`LATE_FEE_INCOME`
  purpose row), [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.12
  (installments keys; CRM/sales/treasury keys reused),
  [industries/reports/README.md](../../industries/reports/README.md) (education report
  row), [DR-003-platform-expansion-v2.md](../../decisions/product/DR-003-platform-expansion-v2.md)
  (ED-08/ED-11), [EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B/§L.

## 4. Design Impact

- **Database changes:** **none** — no new tables (register §C assigns `industry.education`
  no entities; ED-08 is a configuration-layer template). The manifest ships as the
  extracted [manifest.education.json](../../industries/templates/manifests/manifest.education.json)
  (regenerated by `scripts/extract_manifests.py`); the configuration module's
  `industry_templates` registry row, series, policy defaults, report pins, and onboarding
  checklist are additive seeds. INV-022 unchanged — the config-fuzz suite re-runs to
  prove no accounting-mathematics change.
- **API changes:** none new — apply/switch/extend run through the existing
  configuration endpoints (PHASE-015) with diff preview and audit events; onboarding
  checklist state reads through the existing endpoints; every tuition flow uses the
  existing crm/sales/installments/treasury/reporting contracts verbatim.
- **UI changes:** the Enrollment and Tuition billing navigation groups surface existing
  screens re-labeled by terminology (enrollment contracts, students & guardians, fee
  schedules, installment plans, tuition invoices, due & overdue installments, receipts);
  no new components or archetypes; all screens RTL-first with AR+EN baselines re-run.
- **Security & authorization:** no new permission keys — the template exercises
  `crm.contracts.manage`, `installments.plans.manage`, `installments.lines.waive`,
  `sales.invoices.*`, and the treasury receipt keys that already exist
  ([AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.12 + §2/§3
  rows); the `invoice_approval_required` policy turns on the existing invoice approval
  with creator ≠ approver SoD; entitlement gating is per plan, fail-closed.
- **Accounting implications:** zero new posting rules — the tuition chain exercises
  G-01 (tuition invoice with approval), G-05 (receipt collection allocating to
  installment lines), and G-28 (late fee, engine-only) with new document sources only;
  invariants reused: INV-008 (rates where a pack taxes education in a second currency),
  INV-009 (guardian subledger), INV-013 (idempotent operations), INV-016 (allocation
  bounds), INV-021 (series immutability), INV-022 (unchanged — the template selects
  accounts and policies, never math). The `LATE_FEE_INCOME` purpose mapping is required
  at onboarding (fail-closed `PURPOSE_NOT_MAPPED` otherwise).
- **Localization implications:** the full AR/EN terminology set from the manifest;
  Arabic-first labels (خطة الأقساط, الأقساط المستحقة والمتأخرة); guardian statements,
  installment schedules, and dunning reminders print bilingual RTL through the PHASE-013
  print system; education VAT treatment comes from the jurisdiction pack (REQUIRES
  VERIFICATION per the official-sources protocol — nothing fabricated here).
- **Offline implications:** none implemented — a school's commercial office is a
  back-office, online surface; the installments offline rows
  ([OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md) #41
  schedules READ-CACHED, #42 collections via the existing receipts path) are unchanged
  by this template.
- **Module dependencies:** `configuration` applies the template over `crm`, `partners`,
  `items`, `sales`, `installments`, `treasury`, and `reporting` — every module consumed
  through its published services; no module writes another's tables
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)); no new module and
  no new inter-module edge
  ([DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md) unchanged).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Register + verify the manifest: `industry.education` v1.0.0 row in the template registry (version, family), extracted manifest byte-verified against the embedded doc manifest, series/policy/report-pin/onboarding seeds | `docs/industries/templates/manifests/manifest.education.json`, `apps/api/src/modules/configuration/infrastructure/seeds/**` | manifest JSON-Schema validation (governance #1); feature-key resolution closure test: all `required_feature_keys` resolve fail-closed in the catalog + entitlement service (governance #2) |
| T2 | Apply + onboarding golden fixture: apply to a fresh tenant; snapshot nav tree, terminology resolution, numbering series, inventory defaults, report pins, onboarding checklist (AR + EN) | `apps/api/src/modules/configuration/**` (seeds + apply path), test fixtures under `tests/industries/education/**` | golden onboarding fixture asserts every snapshot field (governance #3) |
| T3 | Fee schedules + student/guardian files: fee service items and program/grade price lists seeded; guardian partner + student financial file fixture with cohort attributes and sibling group | onboarding fixtures + `apps/api/src/modules/{items,partners}/**` (config only) | BR-003 price-list precedence test; guardian statement renders the student label set; partner statement drill to journals |
| T4 | Enrollment contract + term invoices: enrollment contract as schedule source; `crm.recurring_billing` term-invoice generation (OPTIONAL key) or manual raise; contract posts nothing | `apps/api/src/modules/crm/**` (config only) | workflow smoke: contract → draft invoice (no ledger at contract; G-01 only at invoice approval/posting) with fixture-asserted journal lines (governance #4) |
| T5 | Sibling/multi-child discounts: line-level discount policies with BR-002 ceilings; revenue-only effect; approval required before posting | `apps/api/src/modules/sales/**` (config only) | discount ceiling block/warn tests; VAT mathematics untouched (INV-022 config-fuzz row) |
| T6 | Tuition installment chain: plan against the tuition invoice (BR-048 equality, immutable schedule after activation, down payment + monthly/term dues); collection receipts allocating to lines (G-05); OVERDUE; per-plan late fee → G-28; waiver via credit note | `apps/api/src/modules/installments/**` (config only) | **tuition end-to-end golden**: enrollment contract → tuition invoice → installment plan → due → collect → late fee (G-28) with persisted journal lines asserted at each step; failure paths zero-residue (`PERIOD_LOCKED`, `PLAN_TOTAL_MISMATCH`, edit-after-activation → `SCHEDULE_IMMUTABLE`) |
| T7 | Dunning cycle: aging-driven reminder cycle before late fee (policy), guardian statements, `partners.ar_aging`; PDC tuition cheques via `notes.received` (OPTIONAL) | `apps/api/src/modules/{installments,reporting}/**` (config only) | dunning policy test — late fee blocked until the dunning cycle has surfaced per policy; aging buckets correct on fixture data |
| T8 | Report pack wiring: pins + dashboards (`installments.schedule`, `installments.aging`, `services.contract_revenue_schedule`, `partners.ar_aging`, `partners.statements`) | `apps/api/src/modules/reporting/**` (config only) | report fixtures with GL tie-outs (AR control, INV-009; plan totals tie to source invoices, BR-048); assertion engine green |
| T9 | Governance suite + switch safety + docs sync: run all seven governance tests; switch test (`industry.retail` → `industry.education` on a live tenant); degraded entitlement; RTL visual set; docs updates | `tests/industries/education/**`, `docs/**` | all seven green (governance #1–#7); switch safety: zero data loss, archived capabilities read-only, series append-only; docs validation green |

## 6. Verification

**Automated tests (required):**

- **The seven governance tests** per
  [industries/README.md §8](../../industries/README.md), run for `industry.education`:
  (1) manifest JSON-Schema validation; (2) feature-key resolution (fail-closed) for
  every required and prerequisite key; (3) golden onboarding fixture (AR + EN); (4)
  workflow smoke with expected journals — the tuition chain end-to-end; (5) switch
  safety — apply `industry.retail`, create items/partners, post documents, switch to
  `industry.education`, assert zero data loss and archived capabilities read-only;
  (6) RTL visual set (AR + EN screenshots of the enrollment and billing surfaces);
  (7) degraded entitlement — plan missing an OPTIONAL key (e.g., `crm.recurring_billing`,
  `crm.contract_deposits`, `notes.received`) hides cleanly; missing a REQUIRED key
  (e.g., `installments.plans`) blocks onboarding with actionable guidance.
- **Tuition end-to-end golden**: enrollment contract (no ledger) → tuition invoice with
  sibling line discount (G-01: DR AR (guardian) · CR tuition revenue · CR VAT per pack
  treatment; approval required) → installment plan (BR-048: plan total = invoice total
  exactly; schedule immutable after activation) → dues fall due → collection receipt
  (G-05: DR cash/bank · CR AR control, allocated to installment lines) → one line ages
  past grace → late fee (G-28: DR `AR_CONTROL` · CR `LATE_FEE_INCOME`, engine-only, per
  the plan's policy) → waiver as an explicit credit note. Persisted journal lines
  asserted at every step; INV-013 idempotency per source/operation; zero residue on
  every failure path.
- **Rule tests re-run education-shaped** (`installments-rules`/`sales-rules` fixtures):
  BR-048 (total equality + immutability), BR-049 (policy shape: rate + cap + grace —
  PLACEHOLDER defaults documented, OQ-002), BR-002 (discount ceilings),
  BR-003 (fee-schedule price-list precedence), BR-027 (registration deposits as
  on-account credits), BR-038 (additive switching).
- **Invariant/config-fuzz re-run**: INV-022 proof — template apply/switch/policy churn
  never alters accounting mathematics or authorization; INV-009/016 spot checks on
  guardian allocations.
- **Permission matrix re-run** for every surfaced route (no new keys; the existing
  checklist must stay green); invoice approval SoD fires when one role holds
  create + approve + post.
- **Report fixtures** for all pinned keys with GL tie-outs where monetary.

**Manual verification:**

1. Apply `industry.education` to a fresh tenant (AR UI): walk the onboarding checklist
   end-to-end (CoA confirm with tuition revenue + late-fee income; programs/grades +
   fee schedules; guardians + student files; first contract; first invoice + plan;
   first collection with a late fee).
2. Run one school year on fixtures: enroll a guardian with three students → annual
   contract per student → term invoices with sibling discounts → one plan per invoice
   (down payment + monthly dues) → collect two dues → let one age → send the dunning
   reminder → charge the late fee → waive it via credit note; check
   `installments.aging`, the guardian statement, and `partners.ar_aging` agree with
   the AR control account.
3. Switch a live retail tenant to `industry.education`: diff preview matches; posted
   history intact; archived retail entries read-only; switch back succeeds.
4. Remove an OPTIONAL key from a test plan (e.g., `notes.received`) and verify the
   surface degrades cleanly; remove a REQUIRED key and verify onboarding blocks with
   actionable guidance.

**Acceptance criteria (objective):** *(mirrored into
[PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md) — v2.0
section, PHASE-032.)*

1. `industry.education` applies via the **unmodified** PHASE-015 engine and passes all
   seven governance tests; a needed engine change is a PHASE-015 defect fixed there.
2. The tuition flow runs end-to-end on the template tenant — enrollment contract →
   tuition invoice (G-01, approval-gated) → installment plan (BR-048 total equality,
   immutable schedule) → dues → collection (G-05) → late fee (G-28, engine-only,
   per-plan policy) — with persisted journal lines asserted at every step and zero
   residue on failure paths.
3. Sibling/multi-child discounts apply as invoice line discounts under BR-002 ceilings
   and never touch VAT mathematics; waivers are explicit credit notes.
4. The dunning cycle precedes any late-fee posting per the template policy, and the
   aging dashboards/statements reconcile to the AR control (INV-009).
5. All pinned report keys run on the PHASE-013 contract with GL tie-outs; **no new
   report keys, feature keys, permission keys, tables, or modules exist**; INV-022 is
   unchanged (config-fuzz proof attached).
6. Additive switching per BR-038 is proven against a live tenant (zero data loss;
   archived capabilities read-only; series append-only).
7. The template degrades cleanly without OPTIONAL keys (`crm.recurring_billing`,
   `crm.contract_deposits`, `crm.late_fees`, `notes.received`) and blocks onboarding
   without REQUIRED keys with actionable guidance.
8. CAPABILITY_MATRIX keeps its EDU column and `installment_terms` row with citations
   (landed with the v2.0 doc sync); docs validation green; identifiers match the
   register exactly (ED-08, §D keys reused, none new).

**Performance & security considerations:** template apply p95 within the PHASE-015
budget on the onboarding fixture; aging/schedule dashboards render from the existing
report executor budgets; entitlement checks are fail-closed on every surfaced route;
student/guardian files are ordinary partner records —
[DATA_PROTECTION.md](../../security/DATA_PROTECTION.md) applies unchanged (no
academic or health-adjacent data exists to protect by design); late-fee policy
defaults are tenant-configured PLACEHOLDERs (OQ-002 family — the template ships no
invented rates).

**Migration & rollback:** **no schema migration** — additive seeds and a registry row
only. Rollback = switch away or archive the template per
[industries/README.md §5](../../industries/README.md) additive rules + entitlement
removal (read-only historical access per
[SUBSCRIPTION_AND_ENTITLEMENTS.md](../../product/SUBSCRIPTION_AND_ENTITLEMENTS.md));
posted invoices, plans, receipts, late fees, and waivers are ordinary documents and
remain valid regardless of the active template.

## 7. Risks and Constraints

- **RISK-002** (template genericity): schools vary (term vs monthly, per-student vs
  per-family billing) — mitigated by manifest terminology/policies and the two
  design-partner validations required at rollout.
- **RISK-019** (implementing beyond phase): the tempting overreach is academic data
  (classes, sections, attendance) and a bespoke dunning engine — both explicitly out of
  scope; the completion report must show zero non-partner student schema and zero new
  engine surfaces.
- Late-fee drift: G-28 and the policy shape are PHASE-027-owned; an education policy
  the module cannot express is a PHASE-027 defect, not a template fork.
- Constraint: BR-049 defaults (rate, cap, grace) are per-plan PLACEHOLDER policies
  (OQ-002 family) — the template ships no invented rates; tenants configure them
  (honesty rule, register §O).
- Constraint: `crm.contract_deposits`/`crm.late_fees` are pending-intake keys — the
  template lists them OPTIONAL and must degrade cleanly without them (governance #7);
  canonizing them would need a register amendment.
- Constraint: education VAT treatment varies by jurisdiction — it comes from the pack
  (REQUIRES_VERIFICATION); nothing is hard-coded (ADR-0007/ADR-0010 discipline).

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-032-COMPLETION.md` with: all seven
  governance-test outputs (AR + EN), the tuition end-to-end golden output (journal
  lines at each step incl. the G-28 fixture), switch-safety output, report GL tie-outs,
  the INV-022 config-fuzz proof, permission checklist output, RTL visual set, and docs
  validation.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-032 →
  COMPLETE), CURRENT_STATE, CHANGELOG,
  [INDUSTRY_CATALOG.md](../../product/INDUSTRY_CATALOG.md) pointer check (already points
  at PHASE-032), [CAPABILITY_MATRIX.md](../../industries/capabilities/CAPABILITY_MATRIX.md)
  EDU row citation check, [industries/templates/README.md](../../industries/templates/README.md)
  phase-map row check, and the
  [MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) stage-10 progress note.
- **Exit criteria:** all acceptance criteria green with evidence; the template is live
  via the unmodified engine; ED-08 is delivered as a commercial shell only (ED-11
  respected); zero new schema/keys/modules.
- **Definition of Done:** manifest + seeds + governance tests + tuition golden +
  switch-safety + report fixtures merged; CI green; docs synchronized; zero TODOs in
  the delivered scope; the config-fuzz suite still proves INV-022.
- **Handoff instructions:** read the PHASE-032 completion report. Stage-10 siblings
  (PHASE-030, PHASE-031 if not yet executed, and PHASE-033) are all eligible next per
  [PHASE_DEPENDENCY_GRAPH.md](../../planning/PHASE_DEPENDENCY_GRAPH.md) — they share
  only the GA gate and their pre-GA functional prereqs; the agent protocol executes one
  at a time. The PHASE-033 agent needs nothing from this phase (independent templates);
  the PHASE-034 agent (consolidation, stage 11) needs stages 9–10 book surfaces
  complete. **Next eligible phase: PHASE-033 — Agriculture Commercial Shell** (or the
  earliest unexecuted stage-10 phase per IMPLEMENTATION_STATUS; identify only, do not
  implement).
