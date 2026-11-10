# PHASE-019 — CRM, Service Contracts & Projects

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-019
- **Title:** CRM, Service Contracts & Projects
- **Objective:** Ship the `crm` module — leads with conversion into partners, tasks/
  activities/reminders on the notification rails, service contracts with a recurring
  billing schedule that generates **draft** invoices idempotently per (contract,
  period), and service orders that generalize the PHASE-017 job cards — plus the
  **projects dimension** (`accounting.projects`) as a cost-center-type analytical
  dimension stampable on documents, journal lines, and reports; apply the
  `industry.professional_services` template on top. The contract itself posts nothing;
  only its generated documents do — and billing runs never bypass approval policies or
  period locks.
- **Business value:** Law offices, consultants, agencies, and maintenance contractors
  sell **time and recurring service**, not boxes; this phase gives them contracts →
  scheduled invoices → statements with a project/case dimension for profitability —
  closing the last launch-template gap in the industry stage group.

## 2. Scope

In scope:

1. **Leads** (`crm.leads`): lead capture (bilingual name, source tracking, owner rep),
   status pipeline (NEW → QUALIFIED → CONVERTED / LOST with reasons), and **conversion
   to partners/customers** — conversion creates the partner (or merges into an
   existing one with explicit confirmation), carrying contacts, and links the lead to
   the partner record forever (audit-clean provenance; BR-025 code rules apply to the
   created partner).
2. **Tasks, activities & reminders** (`crm.tasks_activities`): follow-ups, calls,
   meetings linked to leads, partners, and contracts; due dates with reminder
   notifications through the PHASE-015 in-app inbox (+ email leg); activity timeline
   per lead/partner/contract; no ledger effects ever.
3. **Service contracts** (`crm.service_contracts`): `service_contracts` with scope,
   term (start/end, renewal and expiry states), partner + optional project link, and a
   **billing schedule** — fee models per
   [professional-services.md](../../industries/templates/professional-services.md):
   monthly retainer (fixed lines), fixed-fee milestones (dated schedule entries), or
   hourly billing against recorded time entries (narrative required by template
   policy); schedule lines expand into dated entries. **The contract posts nothing**
   ([CAPABILITY_MATRIX §2.8](../../industries/capabilities/CAPABILITY_MATRIX.md)).
4. **Recurring billing** (`crm.recurring_billing`): a monthly pg-boss job (plus manual
   run) generates **DRAFT invoices** from contract schedules — idempotent per
   (contract, period): re-runs never duplicate; hourly model pulls unbilled time
   entries into lines; drafts flow the standard approval policy (template requires
   approval before posting); posting runs the ordinary sales invoice chain —
   **Journal: DR AR control (partner) · CR fee/service revenue (net) · CR VAT payable
   (per treatment)** with the project/case dimension stamped on journal lines
   ([industry-workflows.md (f)](../../industries/workflows/industry-workflows.md));
   cancellations use credit notes, never in-place edits.
5. **Deferred revenue wiring**: the `DEFERRED_REVENUE` purpose
   ([CHART_OF_ACCOUNTS.md §2](../../accounting/CHART_OF_ACCOUNTS.md) — required for
   service-contract tenants) is mapped at onboarding; contract advances received
   before the service period (prepaid retainers) post as an on-account credit item —
   DR cash · CR AR control per BR-027 — and, where the template policy defers
   recognition, the on-account application reclassifies through `DEFERRED_REVENUE`
   (release at invoice posting: DR deferred revenue · CR revenue) so advances are
   never recognized as revenue before the billed period. All postings through the
   engine; policy-gated, audited, and honest on the client statement.
6. **Service orders** (`crm.service_orders`): service delivery documents linked to a
   contract or standalone; line types mirror job cards — service/labor lines
   (non-stock) and optional parts lines consuming stock through the inventory service
   (COGS at issue). This is the **generalization** of PHASE-017's `sales.job_cards`
   per the CAPABILITY_MATRIX §2.6 reconciliation: job cards remain valid documents;
   service orders add the contract link and CRM-side workflow; a migration note maps
   job-card upgrade paths; no posting-rule fork (same invoice chain, same journals).
7. **Projects dimension** (`accounting.projects`): `projects` as an analytical
   dimension extending the PHASE-007 `cost_centers` pattern — code, bilingual name,
   status, optional parent, contract links; selectable on documents and **journal
   lines** (project id on lines; engine stores it as an analytical stamp, not a GL
   split); project-filtered GL/report views (revenue/expense per project from
   `journal_lines`); usable by professional services (cases) and any other tenant
   (job costing on purchases/expenses per workflow (f) step 6 and the automotive
   per-bay cost-center pattern). Depends on `accounting.cost_centers` (closure).
8. **Professional-services template application**: `industry.professional_services`
   v1.0.0 per [professional-services.md](../../industries/templates/professional-services.md)
   via the PHASE-015 engine — terminology (`القضية / الملف`, `تسجيل الوقت`, `أتعاب
   دورية`, `دفعة مرحلية`, `عقد الخدمات`…), practice/billing navigation, policies
   (`time_entries_require_case`, `unbilled_time_review_before_invoice`,
   `invoice_approval_required`, `narrative_required_on_time_billing`), series,
   pins (`services.contract_revenue_schedule`, `services.time_billing_summary`,
   `partners.ar_aging`, `sales.commissions_due`), onboarding steps (fee items, first
   contract, first billing run, projects/cases); stock modules stay absent from
   `default_modules_enabled`.
9. **Follow-up dashboards & reports**: lead pipeline + follow-up-due dashboards
   (role-appropriate, PHASE-014 dashboard framework); reports
   `services.contract_revenue_schedule` (contracted vs invoiced vs overdue backlog,
   reconciling schedule → invoices → AR) and `services.time_billing_summary`
   (recorded vs billable vs invoiced hours per case/fee-earner) on the PHASE-013
   report contract with GL tie-outs where monetary
   ([industries/reports/README.md](../../industries/reports/README.md) PHASE-019 rows).
10. **Time entries**: recorded against a case/project + fee item (rate card via price
    lists); billable flag; weekly timesheet review unit; narrative policy enforcement
    at billing. Time feeds billing only — **staff cost is not tracked** (no payroll;
    documented limitation: project profitability is fee-based).

Out of scope (explicit):

- `industry.rental_logistics` template application: its capabilities depend on the
  proposed intake keys (`crm.rental_contracts`, `crm.contract_deposits`,
  `crm.late_fees`, `distribution.shipment_tracking` —
  [CAPABILITY_MATRIX §3](../../industries/capabilities/CAPABILITY_MATRIX.md)) and are
  **deferred behind a decision record** even though
  [INDUSTRY_CATALOG.md](../../product/INDUSTRY_CATALOG.md) nominally targets 019; the
  manifest is not seeded in this phase. (Recorded as a scope divergence for the
  product owner — see the phase report template.)
- Customer self-service portal (PHASE-023–025), court/practice-management
  integrations, trust/escrow compliance regimes (explicit template non-goals),
  payroll/time-attendance, partner profit-share distribution.
- Offline CRM (no capabilities-matrix rows; leads/contracts are online-only),
  e-invoicing submissions (PHASE-023), shipment carrier adapters (PHASE-023).

## 3. Prerequisites

- **PHASE-017 COMPLETE**: partner/contract patterns stabilized (per the dependency
  graph edge 017→019), job-card posting baseline available for the service-order
  generalization, commission/reps semantics available for fee-sharing.
- Consumed as-is: PHASE-006 (partners, credit terms, BR-025/026), PHASE-007 (cost
  centers, journal lines analytical stamping, approval policies, periods), PHASE-012
  (sales invoices, credit notes, receipts, AR aging), PHASE-013 (report contract,
  statements), PHASE-014 (dashboards), PHASE-015 (template engine, in-app
  notifications).
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (contract
  billing posts only through the invoice chain),
  [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (pg-boss monthly billing
  job), [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) (fee
  VAT per treatment — nothing invented).
- Relevant documentation:
  [professional-services.md](../../industries/templates/professional-services.md),
  [industry-workflows.md (f)](../../industries/workflows/industry-workflows.md)
  (contract billing with per-step journals),
  [CAPABILITY_MATRIX.md §2.8, §3](../../industries/capabilities/CAPABILITY_MATRIX.md)
  (service_contracts, recurring_billing, deposits/late-fees intake notes),
  [CHART_OF_ACCOUNTS.md §2](../../accounting/CHART_OF_ACCOUNTS.md) (DEFERRED_REVENUE),
  [RECEIVABLES_AND_PAYABLES.md](../../accounting/RECEIVABLES_AND_PAYABLES.md) (BR-027
  on-account discipline), [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md)
  (BR-025…BR-027, BR-030…BR-034), [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)
  (draft → approval → posting; INV-011 period gate), [USER_JOURNEYS.md](../../product/USER_JOURNEYS.md),
  [AUTHORIZATION_MATRIX.md §3.8](../../security/AUTHORIZATION_MATRIX.md) (`crm.*`,
  `accounting.projects.manage`), [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)
  (crm ownership).

## 4. Design Impact

- **Database changes:** crm-owned `leads` (pipeline, source, converted-to partner ref),
  `tasks`, `activities`, `service_contracts` (+ `contract_billing_schedule` lines,
  fee model, renewal state), `service_orders` (+ lines: service/parts), CRM time
  entries table; accounting-owned `projects` (code, name/name_ar, status, parent,
  contract link) and `journal_lines.project_id` (additive analytical column, engine
  written). **ENTITY_CATALOG has no crm section** — this phase adds it (+ TABLES/ERD)
  per the sync rule; `DEFERRED_REVENUE` purpose rows already exist in the CoA template.
- **API changes:** leads CRUD + `/convert`; tasks/activities CRUD + reminder
  subscriptions; contracts CRUD + schedule expansion + `/generate-billing-preview`;
  billing-run endpoints (manual trigger; job scheduled via pg-boss); service orders
  CRUD + lifecycle + `/invoice`; projects CRUD; project-filtered report parameters.
  Action-endpoint style per [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md);
  contracts in `packages/contracts`.
- **UI changes:** lead pipeline board + conversion wizard; tasks/activities timelines
  with reminders; contract editor with schedule preview; billing-run review screen
  (drafts list, unbilled-time review); service-order workspace (reuses job-card
  patterns); projects management + project column/filter in GL and reports;
  follow-up dashboards. Bilingual RTL-first; archetypes per
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md).
- **Security & authorization:** seed and reconcile per AUTHORIZATION_MATRIX §3.8 —
  `crm.leads.manage`, `crm.tasks.manage`, `crm.activities.manage` (sales, owner;
  branch), `crm.contracts.manage`, `crm.service_orders.manage` (owner; tenant),
  `accounting.projects.manage` — plus the feature-implied `crm.contracts.bill` from
  FEATURE_CATALOG; billing-run execution is owner/accountant-gated; risky postings
  stay with the invoice approve/post permissions (BR-034 SoD).
- **Accounting implications:** the only new ledger-touching path is contract billing —
  and it is the ordinary invoice chain (DR AR · CR revenue · CR VAT, project stamp on
  lines; partner subledger rows in the same transaction per POSTING_ENGINE §5) plus
  the policy-gated DEFERRED_REVENUE reclassification (advance received on-account per
  BR-027 → applied/reclassified at invoice posting). Invariants exercised: INV-001/
  002, INV-009 (partner subledger), INV-011 (billing into a locked period is
  rejected; drafts warn), INV-013 (billing-run idempotency), INV-016 (allocation
  bounds at receipt application), INV-021 (series immutability). The
  `contract_invoice` numbering series from the template feeds the standard numbering
  service (BR-029).
- **Localization implications:** template terminology AR/EN (`أتعاب دورية`,
  `دفعة مرحلية`, `القضية / الملف`…); statements, invoices, and dashboards bilingual
  RTL; Hijri display option respected on schedule dates (display only, A-004).
- **Offline implications:** none — CRM operations are online-only (absent from the
  capabilities matrix write set); the matrix gains no rows; contract/billing reads on
  future desktop cache are read-only (PHASE-021 concern).
- **Module dependencies:** new `crm` module (leads, tasks/activities, contracts,
  service orders, time entries, billing scheduler) depending on `partners` (creation/
   lookup), `sales` (invoice draft creation via published service, reps/commissions),
  `accounting` (posting engine, periods, projects dimension), `notifications`
  (reminders), `reporting` (reports); `accounting` owns `projects`. crm publishes
  nothing yet ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md));
  service-order parts consumption calls `inventory` services like job cards do.

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Projects dimension: entity, journal-line stamping, report filters (extends cost_centers pattern) | `apps/api/src/modules/accounting/projects/**`, engine line-spec extension | line-stamp tests (project id persisted on journal lines); project-filtered GL fixture; cost-center closure check |
| T2 | Leads: pipeline, sources, conversion to partner (create/merge with confirmation), provenance link | `apps/api/src/modules/crm/leads/**` | **conversion flow tests**: convert→partner created with BR-025 code; merge path audited; lead immutable after conversion |
| T3 | Tasks/activities/reminders + notification integration + timelines | `apps/api/src/modules/crm/tasks/**`, `apps/api/src/modules/notifications/**` | reminder delivery test (in-app + email); due-date boundaries; timeline completeness |
| T4 | Service contracts: terms, fee models, schedule expansion, renewal/expiry states | `apps/api/src/modules/crm/contracts/**` | schedule expansion tests (retainer monthly grid; milestone dates; hourly ties to time entries); renewal state machine |
| T5 | Time entries + timesheets + billable flags + narrative policy | `apps/api/src/modules/crm/time/**` | narrative-required enforcement; timesheet review state; unbilled-time pull fixture |
| T6 | Recurring billing job: idempotent per (contract, period) draft generation; preview endpoint; approval handoff | `apps/api/src/modules/crm/contracts/application/billing/**`, pg-boss job | **recurring billing schedule correctness tests**: boundary dates (month edges, leap-day, contract end month), re-run no-duplicate, period-lock behavior (drafts warn; posting blocked INV-011), cancel-by-credit-note path |
| T7 | DEFERRED_REVENUE wiring: advance on-account application/reclassification policy at invoice posting | `apps/api/src/modules/crm/contracts/application/deferral/**` + sales application hook | golden tests: advance receipt (BR-027 on-account) → invoice posting reclassification; no revenue before the billed period; statement trail visible |
| T8 | Service orders: contract-linked/standalone; service + parts lines; job-card generalization note + upgrade path | `apps/api/src/modules/crm/service-orders/**` | posting golden tests (labor revenue + parts COGS mirror job-card fixtures); standalone-vs-contract linkage |
| T9 | Contract billing posting path via sales invoices (project stamp, partner subledger same-transaction) | `apps/api/src/modules/sales/application/contract-billing/**` | posting golden fixture per workflow (f) step 6; failure cases (`PERIOD_LOCKED`, `PURPOSE_NOT_MAPPED`) zero residue |
| T10 | Reports: `services.contract_revenue_schedule`, `services.time_billing_summary`; follow-up dashboards | `apps/api/src/modules/{crm,reporting}/**`, web dashboards | **contract revenue schedule report reconciliation**: contracted = schedule; invoiced = posted invoices; overdue = AR open items; ties to AR control (INV-009) |
| T11 | Apply `industry.professional_services` template (seed + engine apply + pins/checklists) | `apps/api/src/modules/configuration/infrastructure/seeds/**` | all seven per-template tests (industries/README §8) incl. switch safety and degraded entitlement |
| T12 | UI: pipeline board, contract editor, billing review, service orders, projects screens | `apps/web/src/features/crm/**`, `projects/**` | component + a11y tests AR/EN; visual snapshots; keyboard-complete billing review |
| T13 | Permission seeds + role templates + docs updates (ENTITY_CATALOG crm/projects sections, FEATURE_CATALOG, job-card generalization note) | seeds, `docs/**` | permission matrix tests; docs validation green |

## 6. Verification

**Automated tests (required):**

- **Recurring billing schedule correctness**: contract 2026-01-15 → 2026-06-14,
  monthly retainer — the run generates exactly one draft per (contract, period) with
  correct period boundaries (partial first/last months per schedule semantics); leap
  day and month-edge fixtures; re-running the job (manual + scheduled double-fire)
  creates **zero duplicates** (idempotency per contract-period, INV-013 discipline);
  milestone and hourly models produce their own exact fixtures (hourly pulls only
  unbilled, narrative-complete entries).
- **Period locks**: schedule entry in a LOCKED period ⇒ posting rejected
  (`PERIOD_LOCKED`) with the draft clearly warned; SOFT_CLOSED posting requires the
  BR-030 permission + reason; drafts spanning a rate change warn (BR-033 posture).
- **Conversion flows**: lead → partner (new) with code auto-numbering (BR-025); lead →
  existing partner merge (audited, explicit); converted lead is immutable and links
  its partner; quotation→contract and job-card→service-order upgrade paths verified.
- **Contract revenue schedule report reconciliation**: for the fixture set —
  Σ contracted schedule = Σ invoiced + Σ draft + Σ backlog; invoiced ties to posted
  invoices and the AR control via the partner subledger (INV-009); overdue buckets
  match `partners.ar_aging` for the same as-of date (determinism, BR-028).
- **Posting golden tests**: contract invoice (DR AR · CR fee revenue · CR VAT per
  treatment; project dimension stamped on lines; subledger rows same transaction);
  credit-note cancellation; DEFERRED_REVENUE reclassification pair (advance →
  on-account → reclass at posting) with the liability never recognized early; failure
  cases with zero ledger residue.
- **Service-order golden tests**: parts + labor invoice mirrors the job-card fixture
  (PHASE-017 regression pack reused); contract linkage doesn't alter journals.
- **Projects tests**: project id persisted on journal lines; project-filtered GL
  totals equal unfiltered slice sums; unmapped-project rejection on closed projects.
- **Template tests**: all seven per-template requirements for
  `industry.professional_services` (schema, resolution, golden fixture, workflow
  smoke with journals, switch safety, RTL visual set, degraded entitlement).
- **Reminder/notification tests**; **permission matrix tests** for all new routes
  (billing-run gated; contracts/service-orders owner-scoped).

**Manual verification:**

1. Create a lead from a walk-in, qualify, convert to a customer; schedule a follow-up
   task and receive its reminder in the in-app inbox.
2. Author a retainer contract (3 months) + a milestone line; run the billing job
   twice — the review screen shows the same draft set (no duplicates); approve + post
   one; check the statement and the revenue-schedule report (contracted/invoiced/
   overdue).
3. Record time against a case, run the hourly billing preview, enforce the
   narrative policy, post; verify the project column on journal lines and the
   project-filtered GL.
4. Apply the template to a fresh tenant: fee-item onboarding, contract checklist,
   terminology (`أتعاب دورية`), stock modules absent from navigation.

**Acceptance criteria (objective):** *(mirrored into `PHASE_ACCEPTANCE_CRITERIA.md`
row 019 when that file exists.)*

1. Billing runs are idempotent per (contract, period) — double-fire and manual+scheduled
   overlap produce zero duplicate invoices (INV-013 discipline).
2. Schedule boundary fixtures (partial months, month edges, leap day, contract end)
   generate exactly the expected draft set with correct amounts and dates.
3. No billing document posts into a LOCKED period; SOFT_CLOSED follows BR-030; drafts
   spanning rate changes warn per BR-033.
4. The contract revenue schedule report reconciles: schedule = invoiced + draft +
   backlog, and invoiced ties to AR control via the partner subledger (INV-009) at a
   deterministic as-of date (BR-028).
5. Lead→partner conversion (create and merge) is audited, provenance-linked, and
   post-conversion immutable; BR-025 code rules hold.
6. Contracts post nothing; only generated documents do; approval policies apply to
   contract invoices exactly as to manual ones (BR-034).
7. DEFERRED_REVENUE reclassification never recognizes advance revenue before the
   billed period; the client statement shows the full trail.
8. Projects stamp journal lines; project-filtered reports equal their unfiltered
   slices; the dimension is usable from any module's documents.
9. `industry.professional_services` passes all seven per-template tests; stock
   modules remain absent from its enabled set; degradation without optional keys is
   clean.
10. ENTITY_CATALOG gains crm + projects sections (+ TABLES/ERD); FEATURE_CATALOG,
    permission seeds, and the job-card generalization note are updated; docs
    validation green.

**Performance & security considerations:** billing run for 500 active contracts
≤ 2 min (pg-boss batched, tenant-scoped, idempotent); pipeline board p95 ≤ 500 ms;
report as-of queries indexed on (tenant, partner, date). Billing-run execution is
permission-gated and audited; contract advances are never netted silently (BR-027);
no route may post a contract directly — only the invoice chain.

**Migration & rollback:** additive migrations (crm tables, projects, journal-line
column). Rollback: disable the professional-services add-on → read-only historical
access; drafts unposted revert to inert data; posted invoices remain ordinary sales
invoices; the `projects` dimension column is nullable and harmless if the feature is
off; dev-only schema revert otherwise.

## 7. Risks and Constraints

- **RISK-009** (accounting correctness): deferred-revenue reclassification is the
  phase's sensitive posting — golden fixtures + the never-early-recognition test are
  the gate; misstated contract revenue is Sev-1.
- **RISK-019** (implementing beyond phase): the rental-logistics capabilities
  (deposits, late fees, shipments) are the tempting overreach — explicitly deferred
  behind a decision record; implementing them here is a review blocker.
- **RISK-020** (docs drift): the `INDUSTRY_CATALOG` targets rental at 019 while this
  phase defers it — the divergence is recorded in the phase report and the catalog is
  annotated (not silently changed).
- **RISK-016** (boundary erosion): crm must create invoices through the sales service,
  never write sales tables; billing posts only through the engine.
- Duplicate-billing risk (job double-fire, manual+scheduled overlap): idempotency per
  (contract, period) is the hard guard, tested explicitly.
- Constraints: time entries feed billing, not payroll (profitability is fee-based —
  labeled honestly); no trust/escrow compliance claims; the deposit mechanism from the
  intake set is NOT implemented in this phase.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-019-COMPLETION.md` with: billing
  idempotency + boundary-date outputs, revenue-schedule reconciliation output
  (INV-009 tie-out), deferred-revenue golden journals, conversion-flow audits,
  template test results (all seven), permission matrix output, docs validation,
  and the recorded rental-logistics deferral note.
- **Documentation updates required:** IMPLEMENTATION_STATUS (PHASE-019 → COMPLETE),
  CURRENT_STATE, CHANGELOG, ENTITY_CATALOG + TABLES + ERD (crm cluster, projects),
  FEATURE_CATALOG (Phase columns for `crm.*`, `accounting.projects`;
  rental-intake keys annotated as deferred), INDUSTRY_CATALOG (rental deferral note),
  CAPABILITY_MATRIX §3 status update, permission seeds note.
- **Exit criteria:** all acceptance criteria green with evidence; stage-6 industry
  group complete (015–019); docs synchronized; the recorded rental decision is queued
  for the product owner.
- **Definition of Done:** crm module + projects dimension + template + reports +
  dashboards + tests merged; CI green; zero TODOs in delivered scope.
- **Handoff instructions:** stage 6 is complete; stage 7 begins with the offline
  program — the PHASE-020 agent starts from the §11 boundary table and the recorded
  PHASE-016 deviations, and the PHASE-022 agent will mirror the field subset over the
  distribution data model stabilized in 017. Read the 016/017 completion reports
  first. **Next eligible phase: PHASE-020 — Offline Synchronization Foundation**
  (identify only; do not implement).
