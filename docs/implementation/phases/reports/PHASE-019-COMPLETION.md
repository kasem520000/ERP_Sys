# Completion Report — PHASE-019

> **Status:** COMPLETE · **Updated:** 2026-11-03

## Phase ID / Date

PHASE-019 — CRM, Service Contracts & Projects · 2026-11-03

## Summary

The `crm` module shipped with the `accounting.projects` analytical dimension and
the `industry.professional_services` template on the unmodified PHASE-015
engine. **Leads**: the NEW → QUALIFIED → CONVERTED/LOST pipeline with conversion
into partners through the REAL PartnerService (BR-025 auto-code P-xxxxxx with
contact carry; MERGE validated + audited; the converted lead immutable with
forever provenance). **Tasks/activities/reminders**: future tasks + logged
activities with per-entity timelines; the `crm.task-reminders-sweep` pg-boss
job (cron 30 5 * * *) delivers in-app inbox notifications (the new `crm`
category) + the `task_reminder` email leg, idempotent by notifiedAt +
dedupeKey. **Service contracts**: CT-{YYYY}-{SEQ:5} reserved at activation;
three fee models expand into the additive billing grid — retainer months
clipped to the term billed in advance (NO proration per DECISION — fixed-lines
model), dated milestones, hourly arrears periods; leap-day and month-edge
fixtures property-proven (2028-02-29; 2026-01-15→06-14 ⇒ exactly 6 entries);
DRAFT edits reconcile additively (removed milestones flip SKIPPED, restores
re-PLAN); renewal creates the successor contract + RENEWED link; expiry is
derived. **The contract posts nothing** — only its generated documents do.
**Recurring billing**: the monthly pg-boss job (cron 0 3 1 * *) + manual runs
generate DRAFT invoices through the REAL SalesInvoiceService.create — one per
(contract, period/milestone) enforced by the contract_invoices partial unique
guards: re-runs, double-fire, and manual+scheduled overlap produce ZERO
duplicates (INV-013); LOCKED-period entries are skipped + listed (INV-011 —
never dead drafts); approval policies apply exactly as to manual invoices
(BR-034 — the run never posts); hourly pulls only APPROVED narrative-complete
time entries with needsNarrative listed honestly; cancellations are credit
notes. **Deferred revenue**: the verified CHART_OF_ACCOUNTS §2 gap closed —
the CoA template gains **2130 DEFERRED_REVENUE** (fail-closed
PURPOSE_NOT_MAPPED until mapped); advances tag against the receipt's
unallocated on-account credit (BR-027) → policy ON posts **J-DEF [DR AR
(partner, projectId) · CR DEFERRED_REVENUE]**; at contract-invoice posting the
contract-billing port (wired in the CrmModule constructor — the
JobCardsController precedent) fires **J-REL [DR DEFERRED_REVENUE · CR AR
(partner, projectId)]** inside the SAME posting UoW + the receipt→invoice
treasury allocation mirror (invoice open = gross − released); partial releases
continue as new HELD rows; the honest-failure posture keeps the invoice post
alive when the release fails (critical inbox + audit + HELD follow-up). The
golden chain proves revenue NEVER recognized before the billed period
(2025-12 revenue lines == 0), INV-009 tied at every step, and the full client
statement trail (receipt credit → reclass debit → invoice debit → release
credit). **Service orders** generalize the PHASE-017 job cards byte-close
(SO-{YYYY}-{SEQ:5}, SERVICE/PARTS lines, reserve/issue_immediate parts, the
invoiceCard pattern) with contract linkage altering NO journal — the
CAPABILITY_MATRIX §2.6 reconciliation honored, no posting-rule fork. **The
projects dimension** extends the cost-centers pattern: OPEN|CLOSED status with
fail-closed PROJECT_NOT_FOUND/PROJECT_CLOSED engine validation; journal-line
stamping flows JournalLineSpec.projectId → engine → insertLine (the
costCenterId byte-template) incl. manual journal drafts and the sales-invoice
post/COGS journals; GL + report filters (project-filtered totals ===
unfiltered slice sums, spec-proven). 45 permission-guarded routes
(readonly-sweep violations 29 → 0 as the controllers mounted); reports
registry 66 → 68 (`services.contract_revenue_schedule` with the GL tie at
tolerance 0 + the schedule = invoiced + draft + backlog reconciliation +
ar.aging-matching overdue buckets BR-028-deterministic;
`services.time_billing_summary` operational); the dashboard-summary route +
the permission-gated web CRM card; template apply/switch/degradation proven
(7/7 per-template tests incl. retail → professional_services additive switch
safety BR-038 over a real posted invoice); 8 bilingual RTL web screens + the
GL project filter; i18n 2556 → 2926. **The full DB suite — 106 files / 1687
tests — is ALL GREEN** on embedded PG16 (migrations 0001–0028), with the unit
suite 404/404, typecheck/lint 6/6, depcruise 0 violations (971 modules),
permissions-drift 243 = 243, manifests 7/7, docs:validate 29/29.

## Files created

**Migrations & schema**
- `apps/api/migrations/0027_crm_projects.sql` (1063 lines) — 11 new RLS'd
  tenant tables (projects, leads, crm_tasks, crm_activities,
  service_contracts, contract_billing_schedule, contract_invoices,
  contract_advances, service_orders, service_order_lines, crm_time_entries),
  widenings (journal_lines.project_id + manual_journal_lines.project_id;
  sales_invoices contract_id/service_order_id/project_id; stock_moves
  source_type + service_order; notifications/notification_prefs category +
  'crm' on BOTH CHECKs), the CoA marker 2130 DEFERRED_REVENUE, 7 permission
  seeds, plan grants (6 feature keys → business+enterprise), role-template
  grants, the `industry.professional_services` v1.0.0 seed, schema_version 27.
- `apps/api/migrations/0028_crm_service_order_holder.sql` — the
  stock_reservations.holder_type CHECK re-issue adding SERVICE_ORDER (the
  0027 gap T48 discovered; the 0025 DROP+ADD pattern).

**Module code (apps/api/src/modules/crm/)**
- `domain/crm-errors.ts` — 28 typed errors across the task family.
- `infrastructure/crm.store.ts` — the raw-SQL store: leads/tasks/activities +
  contracts/schedule/contract_invoices/advances + time entries + service
  orders/lines (all tenantTx + uuidv7; the partial-unique guards; the
  pullable-time query).
- `application/lead-service.ts`, `task-service.ts`, `activity-service.ts`,
  `related-target.ts` (T45); `contract-service.ts` (1171 lines — the grid
  expansion + advance tagging + billing preview), `time-entry-service.ts`
  (T46); `billing-run-service.ts`, `deferral-service.ts` (T47);
  `service-order-service.ts`, `service-order-posting.ts` (T48).
- `presentation/leads.controller.ts`, `tasks.controller.ts`,
  `contracts.controller.ts`, `time.controller.ts`, `billing.controller.ts`,
  `service-orders.controller.ts` — the 45 routes (rows 4–45) mounted
  byte-verbatim against the T42 registry.
- `crm.module.ts` — the module + the contract-billing port wiring + the two
  pg-boss jobs (task reminders daily; contract billing monthly).

**Accounting/sales surface (T42/T44)**
- `journal-spec.ts` / `posting-engine.ts` / `posting-errors.ts` /
  `journal.store.ts` / `accounting.store.ts` — the projectId stamping path +
  PROJECT_NOT_FOUND/PROJECT_CLOSED + the projects CRUD block.
- `sales/application/invoices.ts` + `sales.store.ts` — the
  contractId/serviceOrderId/projectId create inputs, the header stamping on
  post/COGS journals, the contract-billing port + the raw-SQL existence reads.
- `accounting.controller.ts` — the projects trio (GET/POST/PATCH).

**Reporting**
- `reporting/registry/industry/phase019.ts` + `crm-queries.ts` — the two
  contracts + CrmQueriesService; registry wiring (SOURCE_MODULES crm,
  MODULE_DATA_PHASE 19, window 19, REPORT_CONTRACTS 66 → 68).

**Configuration/contracts (T43)**
- `packages/contracts/src/industry/templates.ts` —
  PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST (byte-equal to the 0027 seed;
  sha256 d000a115…29a) + SHIPPED_TEMPLATE_MANIFESTS (7).
- POLICY_REGISTRY + SETTINGS_REGISTRY (6 manifest keys + the platform-only
  crm.defer_advance_recognition); CURRENT_SHIPPED_PHASE 19; layer-fixtures;
  golden-effective-configs (3 new + all 19 re-pinned — tabulated in
  `agent-ctx/T43-2-template.md`).

**Web (apps/web)**
- 7 server pages (`app/[locale]/crm/{pipeline,tasks,contracts,billing,time,service-orders}`
  + `accounting/projects`) + 7 client components + the GL project filter + the
  dashboard CRM card; `lib/api-types.ts` (+21 wire rows), `lib/messages.ts`
  (localizedCrmError + 14 status helpers), `lib/effective-config.ts` (5 aliases
  + 2 report targets), `components/app-shell.tsx` (7 crumb rows),
  `i18n/dictionaries.ts` (+370 keys — 2926, exact AR/EN parity).

**DB specs (the evidence core)**
- `src/__db__/crm/`: leads.spec (8), tasks.spec (10), contracts.spec (20),
  time.spec (7), billing.spec + deferral.spec (19), service-orders.spec (15)
  — 79/79.
- `src/__db__/accounting/projects.spec.ts` (7); `src/__db__/reporting/
  industry-019.spec.ts` (11); `src/__db__/configuration/templates-019.spec.ts`
  (7); isolation extended to the 11 new tables.

**Docs**
- `docs/database/TABLES/crm-projects.md` + `docs/database/ERD/crm-projects.md`
  (authored in-phase); ENTITY_CATALOG crm + projects sections;
  AUTHORIZATION_MATRIX §3.1/§3.8 rows + seed-union note; MODULE_BOUNDARIES crm
  row; POSTING_ENGINE §4 rows; CHART_OF_ACCOUNTS §3 2130 row;
  FEATURE_CATALOG §13/§14 shipped flips; SUBSCRIPTION_AND_ENTITLEMENTS wiring;
  INDUSTRY_CATALOG + CAPABILITY_MATRIX §3 rental annotations; reports README
  registration (68).

## Verification evidence

| Gate | Result |
|---|---|
| Full DB suite (embedded PG16, migrations 0001–0028) | **106 files / 1687 tests — ALL PASSED** |
| Unit (contracts 50 + domain-core 38 + ui 42 + api 274) | **404/404** |
| pnpm typecheck / lint (6 packages) | 6/6 clean |
| pnpm run lint:depcruise | 0 violations (971 modules) |
| pnpm run check:permissions-drift | 243 = 243 |
| pnpm validate:manifests | 7/7 |
| pnpm run check:i18n-parity | ar=en=2926, no empty values |
| pnpm docs:validate | 29/29 |
| check-rls catalog parity | green (in-suite via migrations.db.spec runChecks) |

**Acceptance criteria (§6 of the phase doc) — all green:**
1. Billing idempotency per (contract, period) — double-fire + overlap ⇒ zero
   duplicates (billing.spec; the constraint-skip net + the source-key net).
2. Schedule boundary fixtures (partial months, month edges, leap day,
   contract end) generate exactly the expected drafts (contracts.spec +
   billing.spec: 6-entry retainer grid; 2028-02-29; mid-month clips).
3. No billing document posts into a LOCKED period (skipped + listed;
   SOFT_CLOSED posture noted — INV-011/BR-030).
4. The revenue-schedule report reconciles schedule = invoiced + draft +
   backlog, invoiced ties to the AR control via the subledger (INV-009) at a
   deterministic asOf (BR-028) — industry-019.spec 11/11, GL tie tolerance 0.
5. Lead→partner conversion (create + merge) audited, provenance-linked,
   post-conversion immutable; BR-025 codes hold (leads.spec).
6. Contracts post nothing; only generated documents do; approval policies
   apply identically (BR-034 — the run's POLICY_ACTOR drafts never self-post).
7. DEFERRED_REVENUE never recognizes advance revenue before the billed
   period; the client statement shows the full trail (deferral.spec — the
   2025-12 revenue == 0 golden + the ordered subledger trail).
8. Projects stamp journal lines; project-filtered reports equal their
   unfiltered slices; usable from any module's documents (projects.spec +
   the invoice stamping assertions).
9. `industry.professional_services` passes all seven per-template tests;
   stock modules absent from its enabled set; degradation clean
   (templates-019.spec 7/7).
10. ENTITY_CATALOG gains crm + projects (+ TABLES/ERD); FEATURE_CATALOG,
    permission seeds, the job-card generalization note updated; docs
    validation green.

## Deviations & decisions (recorded)

1. **Rental-logistics deferral (RISK-019/020 — the phase's standing decision
   record):** `crm.rental_contracts`, `crm.contract_deposits`, `crm.late_fees`,
   and `distribution.shipment_tracking` are NOT implemented. INDUSTRY_CATALOG
   nominally targeted rental at 019; the phase plan (§2 out-of-scope) deferred
   the set behind this record because the capabilities depend on the §3 intake
   keys (deposits/late fees/shipments) whose semantics need their own design
   pass (the DEPOSITS_RECEIVED liability split vs the plain on-account +
   DEFERRED_REVENUE reclass path shipped here). The divergence is annotated in
   INDUSTRY_CATALOG (row → "deferred") and CAPABILITY_MATRIX §3 (all four rows
   → "deferred") — never silently changed. **Queued for the product owner.**
   Advances today use the honest BR-027 on-account + policy-gated
   DEFERRED_REVENUE reclass; no deposit-liability claims are made.
2. **Deferral mechanics (master plan §1 DECISION):** the doc's shorthand
   "release: DR deferred · CR revenue" maps to the reclass+release pair
   (J-DEF at tagging; J-REL at posting with the receipt→invoice allocation) —
   the invoice journal already credits revenue exactly once; the CR-AR release
   IS the advance application. INV-009 holds throughout; the golden chain
   pins the economics.
3. **Environment incident (honest record):** the first execution of this phase
   (tasks T42–T47 complete, ~8h) was lost when the sandbox environment was
   re-provisioned mid-session and the working directory destroyed. The repo
   was restored from `ERP_PLATFORM_PHASE018.zip` (the PHASE-018 state at
   commit f2f5fae); git history 001–018 was lost with the old `.git` (the
   phase content survives in the docs + evidence files) and the repository
   was re-initialized with the restored baseline as the root commit. The
   phase was then re-executed in full with the first execution's post-mortem
   folded into the master plan §18 (the fee-item-home resolution, the J-DEF
   project stamping, the partner-subledger schema verification, the
   manual_journal_lines column, the golden re-pin scope, the spec port
   wiring, the evidence-early discipline). All gates above are from the
   re-execution.
4. **Billing-run history over audit_events** (no billing_runs table —
   migration 0027 is frozen; the summary JSON in the audit after-state is the
   history source; documented in T47's evidence).
5. **The J-DEF debit row on the aging surface** stays an open item until
   J-REL lands (the reclass pair nets at the partner-BALANCE level) — noted
   for T49; the report scopes overdue to posted contract invoices only
   (T49's evidence documents the choice).
6. **T48's 0028 migration** — 0027 missed the stock_reservations.holder_type
   CHECK for SERVICE_ORDER; re-issued additively (append-only registration).
7. **T46b follow-up** — the T46 agent hit the harness turn limit after the
   services landed but before the specs; a focused follow-up wrote the specs
   and fixed 4 surfaced bugs (the milestones-undefined wipe, the SKIPPED
   re-PLAN restore, the billable CASE SQL, the batch-audit entity_id).
   Recorded in `agent-ctx/T46-5-contracts-time.md`.

## Documentation updates required — all done

IMPLEMENTATION_STATUS (019 → COMPLETE + the summary row) ✓ · CURRENT_STATE
(the implemented list + migrations 0001–0028) ✓ · CHANGELOG (the 019 entry) ✓
· ENTITY_CATALOG + TABLES + ERD (crm cluster + projects) ✓ · FEATURE_CATALOG
(§13/§14 phase columns + permission keys reconciled) ✓ · INDUSTRY_CATALOG
(rental deferral annotation) ✓ · CAPABILITY_MATRIX §3 (the four deferred rows)
✓ · reports README (registration 68) ✓ · permission seeds note (§3.8) ✓.

## Exit criteria

All acceptance criteria green with evidence; **stage 6 (the industry group
015–019) is COMPLETE**; docs synchronized; the rental-logistics decision is
queued for the product owner.

## Definition of Done

crm module + projects dimension + template + reports + dashboards + tests
merged; CI green; zero TODOs in delivered scope. ✓

## Handoff instructions

Stage 7 begins with the offline program — the **PHASE-020 agent** starts from
the PHASE-018 §11 boundary table (the sync slice shipped in 016 + the
`packages/sync-core` chaos-proven foundation) and the recorded PHASE-016
deviations (DR-016-01/02/03); read the 016/017/018 completion reports first.
The **PHASE-022 agent** will mirror the field subset over the distribution
data model stabilized in 017. CRM is online-only by design (absent from the
capabilities matrix write set) — the future desktop cache is a PHASE-021
read-only concern. **Next eligible phase: PHASE-020 — Offline Synchronization
Foundation** (identify only; do not implement).

## Task evidence index

| Task | Evidence |
|---|---|
| T42 Foundation (migrations + registrations + engine/sales surface) | `agent-ctx/T42-1-foundation.md` |
| T43 Template & configuration | `agent-ctx/T43-2-template.md` |
| T44 Projects dimension | `agent-ctx/T44-3-projects.md` |
| T45 CRM core (leads/tasks/activities/reminders) | `agent-ctx/T45-4-crm-core.md` |
| T46 Contracts + schedule + time (incl. the T46b spec follow-up) | `agent-ctx/T46-5-contracts-time.md` |
| T47 Billing runs + deferred release | `agent-ctx/T47-6-billing-deferral.md` |
| T48 Service orders | `agent-ctx/T48-7-service-orders.md` |
| T49 Reports + dashboards | `agent-ctx/T49-8-reports.md` |
| T50 Web screens | `agent-ctx/T50-9-web.md` |
| Binding design | `agent-ctx/PHASE-019-MASTER-PLAN.md` (§18 = the re-execution lessons) |
