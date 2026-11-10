# PHASE-019 — CRM, Service Contracts & Projects · MASTER PLAN (binding for all task agents)

Repo: `/home/z/phase017_work` (pnpm monorepo). Phase contract:
`docs/implementation/phases/PHASE-019.md`. This file is the **binding design** for the
phase; where the phase doc is ambiguous, THIS file's decisions apply (each is marked
DECISION). Task agents write per-task evidence to `agent-ctx/` and MUST NOT touch files
owned by other tasks. Isolated test runs use a private `TMPDIR=$HOME/tmp-<task>`.

> **Re-execution note (environment incident):** the first execution of this phase
> (tasks T42–T47, ~8h) was lost to an environment reset that destroyed the repo
> directory; the repo was restored from `ERP_PLATFORM_PHASE018.zip` (commit `f2f5fae`
> state, git history re-initialized — record the incident in the completion report).
> All first-execution lessons are folded into §18 and are BINDING for this run.

Read-first references: PHASE-018-MASTER-PLAN.md (the pattern this mirrors),
agent-ctx/T36…T41 evidence files, docs/industries/workflows/industry-workflows.md (f),
docs/industries/templates/professional-services.md, CAPABILITY_MATRIX §2.6/§2.8/§3,
AUTHORIZATION_MATRIX §3.8, CHART_OF_ACCOUNTS §2, BUSINESS_RULES BR-025…034/038.

## 1. Canonical journal map (final — extends POSTING_ENGINE.md §4)

| Operation (source key) | Journal |
|---|---|
| Contract invoice posting (workflow (f) step 6 — via the ORDINARY `sales_invoice:post` chain) | **DR AR control (partner) [CREDIT invoices] · CR fee revenue (SERVICE item lines → purpose `SERVICE_REVENUE`; non-service lines → `SALES_REVENUE`) · CR VAT payable (per treatment, from stored tax snapshots)**; `projectId` stamped on every line (AR + revenue + VAT + COGS lines of both journals); partner subledger rows same transaction (INV-009). CASH kind unchanged (DR cash account) |
| Contract invoice COGS (only when the invoice has stock lines — flow B) | ordinary `sales_invoice:cogs` journal, unchanged |
| Advance receipt (existing treasury chain — NOT re-implemented) | **DR cash/bank · CR AR control (partner)** — on-account credit item, BR-027; unallocated, visible, allocatable |
| Advance reclass (policy ON, at advance tagging — `contract_advance:defer`) | **DR AR control (partner, projectId-stamped) · CR `DEFERRED_REVENUE`** for the tagged amount — moves the on-account credit into the liability; the AR line is partner-stamped (its subledger debit row nets the receipt's credit row; INV-009 holds) |
| Advance release at invoice posting (`contract_advance:release`) | **DR `DEFERRED_REVENUE` · CR AR control (partner, projectId-stamped)** for the released amount — the AR credit line's subledger row is ALLOCATED to the contract invoice (the advance application); invoice open = gross − released |
| Service-order parts issue (`service_order:issue_parts`) | **DR COGS · CR inventory** (per resolved inventory account) — mirrors `job_card:issue_parts` byte-for-byte (issue_immediate mode) |
| Service-order invoice | the ordinary sales invoice chain (labor → SERVICE_REVENUE; parts → SALES_REVENUE + COGS at issue) — **no posting-rule fork** (CAPABILITY_MATRIX §2.6) |

DECISION (deferral mechanics): the phase doc's shorthand "release at invoice posting:
DR deferred revenue · CR revenue" maps mechanically to the pair reclass (DR AR · CR
DEFERRED) at tagging + release (DR DEFERRED · CR AR, allocated) at posting. Rationale:
the invoice journal already credits revenue exactly once (recognizing it a second time
via the release would double-count); the CR-AR release IS the advance application and
preserves INV-009 (invoice subledger = gross; allocation nets it; GL ties throughout).
Economic result equals the doc's intent: **revenue is recognized only by the invoice
journal in the billed period; between tagging and release the balance sheet honestly
shows the DEFERRED_REVENUE liability instead of an AR credit**. Golden test (T47)
asserts the full chain with the liability never early and the statement trail visible.

## 2. Leads (crm.leads) — lifecycle & conversion

Status pipeline `NEW → QUALIFIED → CONVERTED / LOST`. Fields: name, nameAr, phone,
email, company, source (`WALK_IN|REFERRAL|WEBSITE|CAMPAIGN|CALL|OTHER`), status,
lostReason (required on LOST), ownerUserId (rep), partnerId (set at conversion),
convertedAt, note/noteAr. No numbering series (leads are not legal documents).
Transitions: PUT edits fields while NEW/QUALIFIED; `POST /:id/convert {mode:
NEW_PARTNER|MERGE, partnerId?, kind}` — NEW_PARTNER creates the partner through
`PartnerService.create` (BR-025 auto code P-xxxxxx; carries name/nameAr/phone/email as
contact); MERGE validates the target partner and links it (audited, explicit). The
converted lead is **immutable** (further PUT/convert/lose → typed `LEAD_CONVERTED`);
`partnerId` links forever (provenance). `POST /:id/lose {reason}` (NEW/QUALIFIED only,
reason 1..200 required). No ledger effects ever.

## 3. Tasks, activities & reminders

Two tables (MODULE_BOUNDARIES names both): `crm_tasks` (future work — title, dueDate,
remindAt, status OPEN|DONE|CANCELLED, relatedType LEAD|PARTNER|CONTRACT|SERVICE_ORDER
+ relatedId, assigneeUserId, note) and `crm_activities` (logged past interactions —
kind CALL|MEETING|EMAIL|NOTE, relatedType/relatedId, occurredAt, summary, durationMinutes,
actorUserId). Timeline per lead/partner/contract = activities ordered by occurredAt.
Reminders: pg-boss queue `crm.task-reminders-sweep`, cron `30 5 * * *` (daily 05:30 UTC,
the reservation-sweep registration pattern) scans OPEN tasks with remindAt <= now AND
notifiedAt IS NULL → `InboxService.record({category: "crm", severity: "info",
actionUrl: "/crm/tasks", dedupeKey: crm-task-reminder:<taskId>:<remindAt>})` + email leg
(new `task_reminder` template in the notifications email enum) + stamps notifiedAt.
Notification categories widen (0023 pattern) on BOTH `notifications` and
`notification_prefs` CHECK constraints with `'crm'`; TS `NotificationCategory` union += "crm".

## 4. Service contracts — fee models, schedule, renewal (DECISIONS)

`service_contracts`: contractNo (`CT-{YYYY}-{SEQ:5}`, docType `service_contract`,
reserve+bind at ACTIVATION — the PRD release pattern), partnerId (customer), projectId
nullable, title/titleAr, scope, feeModel `RETAINER|MILESTONES|HOURLY`, startDate,
endDate (>= startDate), monthlyAmount (RETAINER, numeric(19,4)), currencyCode (tenant
base only v1), status `DRAFT|ACTIVE|CANCELLED|RENEWED`, renewedToContractId nullable,
cancelReason, note/noteAr, activatedAt/cancelledAt. Lifecycle: DRAFT → ACTIVE
(activate: number + schedule expansion) → CANCELLED (reason) | RENEWED (renew action
creates a NEW contract copy with fresh term + links renewedToContractId). **Expiry is
derived** (status ACTIVE && endDate < today ⇒ effectively expired — exposed as
`isExpired` in reads; the billing run and list endpoints compute it; no state-flip job).
The contract itself posts NOTHING (CAPABILITY_MATRIX §2.8).

`contract_billing_schedule` (expanded grid — re-runnable, additive): entryType
`RETAINER_PERIOD|MILESTONE|HOURLY_PERIOD`, periodKey `YYYY-MM` (null for MILESTONE),
periodStart/periodEnd, billDate, amount (null for HOURLY — computed at run), feeItemId,
milestoneLabel/milestoneLabelAr, status `PLANNED|INVOICED|SKIPPED`, invoiceId nullable.
DECISION (grid semantics — binding for T46 fixtures): RETAINER grid = **calendar months
clipped to [startDate, endDate]** (contract 2026-01-15 → 2026-06-14 ⇒ 6 entries: Jan
15–31, Feb, Mar, Apr, May, Jun 1–14); billDate = **period start (billing in advance)**;
amount = the full monthlyAmount **per period — NO automatic proration** (fixed-lines
model per professional-services.md; proration is a schedule-authoring concern; the
preview shows exact windows). Month edges: periodEnd = min(last day of calendar month,
endDate); leap-day fixture 2028-02-29 (period Feb 2028 = 02-01→02-29). MILESTONES grid
= the contract's dated milestone lines (billDate = milestone date). HOURLY: one
HOURLY_PERIOD entry per calendar month of the term, billDate = **period end (arrears —
time must exist)**, amount null.

`contract_invoices` (the idempotency guard — crm-owned): contractId, periodKey nullable,
milestoneScheduleId nullable (FK → contract_billing_schedule), invoiceId (FK →
sales_invoices), status `GENERATED`, created fields. **UNIQUE (tenant, contract,
periodKey) WHERE periodKey IS NOT NULL** + **UNIQUE (tenant, contract,
milestoneScheduleId) WHERE milestoneScheduleId IS NOT NULL** — concurrent double-fire ⇒
constraint violation ⇒ graceful skip (INV-013 discipline).

`contract_advances`: contractId, receiptId (FK → treasury receipts), amount, status
`HELD|RELEASED`, deferJournalId, releasedJournalId, releasedInvoiceId, note. Tagging:
`POST /crm/contracts/:id/advances {receiptId, amount}` validates the receipt has >=
amount of unallocated on-account credit (existing treasury allocation reads) → with
policy `crm.defer_advance_recognition` ON posts the reclass journal (§1 row 4) + audit;
OFF = link-only (stays a plain on-account credit, BR-027 pure).

## 5. Recurring billing runs (T47 — the phase's correctness core)

`BillingRunService.run({asOf, actorId})`: iterates ACTIVE contracts (startDate
<= asOf); for every schedule entry with billDate <= asOf, status PLANNED, and NO
contract_invoices row: generates a **DRAFT** sales invoice through
`SalesInvoiceService.create({customerId, kind: "CREDIT", contractId, projectId,
invoiceDate: billDate, lines, actorId: POLICY_ACTOR_ID})` — RETAINER: one line
(feeItemId, qty 1, unitPrice = amount); MILESTONE: one line; HOURLY: one line per
pullable time entry (narrative as the line description — the honest timeslip),
unitPrice = the entry's snapshotted rate, qty = hours; entries pulled = status
APPROVED, not yet billed (billedInvoiceId null), entryDate within the period, narrative
non-empty when policy `narrative_required_on_time_billing` (empty-narrative entries are
listed in the preview as `needsNarrative` and skipped — never silently billed). Then
insert the contract_invoices row + flip the schedule entry INVOICED + audit
`crm.billing_run` (+ per-invoice `crm.contract_invoice_generated`). Drafts flow the
standard approval policy: with `crm.invoice_approval_required` true the run leaves
them DRAFT; false ⇒ auto-`submit()` (PENDING_APPROVAL) — **never auto-post**. Posting
is the ordinary approve+post chain (BR-034 SoD; the run's POLICY_ACTOR drafts cannot
self-approve). Idempotency: re-runs (manual double-fire, cron+manual overlap) hit the
contract_invoices UNIQUE guards ⇒ zero duplicates; the source-key idempotency of
`sales_invoice:post` is the second net at posting time. Period locks: drafts whose
billDate sits in a LOCKED period are **skipped + listed as `periodLocked`** in the run
result (posting would fail INV-011 — the run refuses to create dead drafts);
SOFT_CLOSED drafts warn (BR-030 posture noted in the result). Cancellation of a posted
contract invoice = credit note (the standard sales path — never in-place edits).
pg-boss: queue `crm.contract-billing-run`, cron `0 3 1 * *` (monthly, 1st 03:00 UTC),
payload `{system: true}` → enumerates active tenants (listActiveTenantIds pattern) →
per-tenant UoW run with asOf = today. Manual: `POST /api/v1/crm/billing-runs {asOf}`
(permission `crm.contracts.bill`), history `GET /api/v1/crm/billing-runs?limit` (over
audit events — the migration has NO billing_runs table; document the choice). Release
of HELD advances happens at invoice posting (§1 row 5) via the contract-billing port (§8).

## 6. Time entries & timesheets (crm.time)

`crm_time_entries`: entryDate, hours numeric(19,6) > 0, feeItemId (SERVICE item),
projectId (**required when policy `crm.time_entries_require_case`** — typed
`TIME_ENTRY_CASE_REQUIRED`), contractId nullable, feeEarnerUserId, unitRate
numeric(19,6) — **snapshotted at recording** (price list of the contract partner when
resolvable, else manual input; never recomputed later — determinism), narrative text,
billable boolean default true, status `DRAFT|APPROVED|BILLED|VOID`, billedInvoiceId
nullable, timesheetWeek? (derived — no column). Weekly review:
`POST /api/v1/crm/time/timesheets/review {weekStart}` (Monday ISO date) flips the
week's DRAFT entries → APPROVED (audited batch `crm.timesheet_reviewed`); only APPROVED
entries are pullable by billing. Void: DRAFT/APPROVED only (typed error otherwise).
Time feeds billing ONLY — no payroll, no staff cost (documented limitation:
profitability is fee-based).

## 7. Service orders (crm.service_orders) — the job-card generalization

Mirror `sales/job-cards/**` byte-close: `service_orders` (orderNo `SO-{YYYY}-{SEQ:5}`,
docType `service_order` reserve-at-creation; partnerId, contractId nullable
(standalone allowed), branchId, warehouseId (parts), status
`DRAFT|IN_PROGRESS|COMPLETED|INVOICED|CANCELLED`, cancelReason, note/noteAr) +
`service_order_lines` (lineNo, lineType `SERVICE|PARTS`, itemId, description,
estimatedHours (SERVICE), unitPrice, qty (PARTS), status
`PENDING|RESERVED|ISSUED|INVOICED|VOID` — tombstone-based like job cards, no DELETE
grant, reservationId, issueUnitCost/issueValue/issueJournalId, invoiceLineId,
loggedHours). Lifecycle = job cards verbatim: create (validate SERVICE items for
SERVICE lines / STOCK for PARTS) → approve (issue_immediate: parts planIssue +
`service_order:issue_parts` COGS journal; reserve mode: ReservationService
holderType "SERVICE_ORDER") → logHours → complete → invoice (COMPLETED only; through
`SalesInvoiceService.create({serviceOrderId, ...})` + POLICY_ACTOR auto-approve + post
in-transaction — the job-card `invoiceCard` pattern) → cancel (releases reservations,
refuses when invoiced/issued). Contract linkage does NOT alter any journal. The
job-card → service-order upgrade path: a migration-note row in the completion report +
docs (CAPABILITY_MATRIX §2.6 reconciliation); job cards remain valid documents — no
data migration, no fork.

## 8. Projects dimension (accounting.projects)

Mirror cost_centers exactly (0010 pattern): code `^[A-Za-z0-9_-]{1,20}$` uq (tenant,
code), name/nameAr, parentId (composite FK, RESTRICT), status text `OPEN|CLOSED`
(**CLOSED rejects new journal-line stamps** — typed `PROJECT_CLOSED`; cost_centers'
is_active equivalent), contract links are the service_contracts.projectId FK side.
Store functions in accounting.store.ts (list/find/insert/update — no DELETE);
controller endpoints in accounting.controller.ts (GET/POST/PATCH, cost-center trio
shape); drizzle row in schema.ts. `journal_lines.project_id` uuid NULL + composite FK
→ projects (RESTRICT) + index (tenant, project). **`manual_journal_lines.project_id`
too (migration 0028 — the draft substrate; the §10 0027 DDL missed it in the first
execution; T44 discovered it — fold it into 0027 directly this time).** Stamping path:
`JournalLineSpec.projectId` → engine `ResolvedLine.projectId` → `insertLine` (the
costCenterId column is the byte-template). Engine validation (new step in the
account-resolution stage): unknown project → `PROJECT_NOT_FOUND`; status CLOSED →
`PROJECT_CLOSED` — fail closed. Consumers: manual journal drafts (zod `projectId` per
line, journals.controller + journal-service buildSpec), sales invoices (header-level
`projectId` on create — stamped on ALL lines of the post journal AND the COGS
journal), GL queries + statements + reports gain an optional `projectId` filter
(project-filtered totals === unfiltered slice sums).

## 9. Policies & settings (POLICY_REGISTRY + SETTINGS_REGISTRY)

Manifest keys (6, all with settingsKey, all boolean except contract_billing_mode):
`contract_billing_mode` (enum `retainer_or_milestones|retainer|milestones|hourly`,
default `retainer_or_milestones`, settingsKey `crm.contract_billing_mode`),
`time_entries_require_case` (bool, default true, `crm.time_entries_require_case`),
`unbilled_time_review_before_invoice` (bool, default true,
`crm.unbilled_time_review_before_invoice`), `invoice_approval_required` (bool, default
true, `crm.invoice_approval_required`), `invoice_numbering_per_series` (bool, default
false, `crm.invoice_numbering_per_series` — documented posture v1: numbering stays the
standard SAL series; no fork), `narrative_required_on_time_billing` (bool, default
true, `crm.narrative_required_on_time_billing`). Platform-only (SETTINGS_REGISTRY, NOT
in the manifest): `crm.defer_advance_recognition` (bool, default **false**,
L5-overridable; golden tests set it true). Services read through
`ResolveEffectiveConfigService` (`config.policies[...]`, manufacturing pattern) or
`readEffectiveSetting` for platform-only keys.

## 10. Migration 0027_crm_projects.sql — DDL contract

Follow 0026 byte-patterns (header, SET ROLE erp_migrate, statement-breakpoints, RLS
`SELECT erp.apply_tenant_policy('"t"')`, GRANTs, `_schema_state` = 27). New tenant
tables (11, all standard columns + uq_<t>_id_tenant + tenant-scoped indexes +
composite 2-col FKs):

1. `leads` — status CHECK NEW|QUALIFIED|CONVERTED|LOST; source CHECK; CHECK (status
   <> 'LOST' OR lost_reason IS NOT NULL); CHECK (status <> 'CONVERTED' OR (partner_id
   IS NOT NULL AND converted_at IS NOT NULL)); ix (tenant, status); ix (tenant, owner).
2. `crm_tasks` — status CHECK OPEN|DONE|CANCELLED; related_type CHECK + related shape;
   ix (tenant, status, due_date); ix (tenant, related); partial ix WHERE remind_at IS
   NOT NULL AND notified_at IS NULL.
3. `crm_activities` — kind CHECK; related CHECK; ix (tenant, related, occurred_at DESC).
4. `service_contracts` — fee_model CHECK; status CHECK; CHECK end >= start; monthly
   amount CHECK >= 0; uq (tenant, contract_no) WHERE NOT NULL; ix (tenant, status);
   ix (tenant, partner); FK project_id → projects (composite). **NO contract-level
   fee_item_id column** — the schedule rows are the fee-item home (§18 lesson 1).
5. `contract_billing_schedule` — contract FK; entry_type CHECK; period_key text NULL;
   uq (tenant, contract, entry_type, period_key) WHERE period_key IS NOT NULL; uq
   (tenant, contract, milestone_label) WHERE entry_type = 'MILESTONE'; ix (tenant,
   contract, bill_date); status CHECK PLANNED|INVOICED|SKIPPED.
6. `contract_invoices` — contract FK + invoice FK → sales_invoices (composite,
   RESTRICT); period_key text NULL; milestone_schedule_id uuid NULL; the two partial
   UNIQUEs from §4; ix (tenant, contract); ix (tenant, invoice).
7. `contract_advances` — contract FK + receipt FK → receipts (composite); status CHECK
   HELD|RELEASED; amount numeric(19,4) > 0; ix (tenant, contract, status).
8. `service_orders` — uq (tenant, order_no) WHERE NOT NULL; status CHECK; contract FK
   nullable; ix (tenant, status); ix (tenant, partner).
9. `service_order_lines` — order FK; line_type CHECK; status CHECK; uq (tenant, order,
   line_no).
10. `crm_time_entries` — hours numeric(19,6) > 0; status CHECK; ix (tenant, project,
    entry_date); ix (tenant, status); partial ix WHERE billed_invoice_id IS NULL AND
    status = 'APPROVED'.
11. `projects` — the cost_centers clone with status text CHECK OPEN|CLOSED instead of
    is_active; uq (tenant, code); ix (tenant, parent).

Widenings (DROP + re-ADD CHECK pattern): `notifications.category` + `'crm'` AND
`notification_prefs.category` + `'crm'` (BOTH constraints, 0023 pattern);
`stock_moves.source_type` + `'service_order'`; `sales_invoices` += `contract_id` uuid
NULL (composite FK → service_contracts RESTRICT), `service_order_id` uuid NULL
(composite FK → service_orders RESTRICT), `project_id` uuid NULL (composite FK →
projects RESTRICT); `journal_lines` += `project_id` uuid NULL (composite FK → projects
RESTRICT) + ix (tenant, project); **`manual_journal_lines` += `project_id` uuid NULL
(composite FK → projects RESTRICT)** (the draft substrate — in THIS migration, not a
later 0028).

CoA template insert (ON CONFLICT DO UPDATE, 0008/0025 pattern): **2130
`DEFERRED_REVENUE`** "Deferred revenue / الإيرادات المؤجلة" (LIABILITY leaf, parent
2100 group, purpose marker DEFERRED_REVENUE). (Verified gap: the purpose key exists in
CHART_OF_ACCOUNTS §2 but NO account/template row exists — this migration adds it;
service-contract tenants map it at onboarding; the engine fails closed
`PURPOSE_NOT_MAPPED` when a deferral runs without a mapping.)

Permission seeds (7 keys; ON CONFLICT DO UPDATE): `crm.leads.manage`,
`crm.tasks.manage`, `crm.activities.manage` (module crm; sales, owner — branch),
`crm.contracts.manage` (owner — tenant), `crm.contracts.bill` (owner, accountant —
tenant; the feature-implied key from FEATURE_CATALOG `crm.recurring_billing`),
`crm.service_orders.manage` (owner — tenant), `accounting.projects.manage` (module
accounting; owner, accountant — mirrors cost_centers). AUTHORIZATION_MATRIX §3.8 gains
the 3 new rows (contracts.bill, projects.manage in §3.1) — keep the existing 2 crm rows
byte-identical. Plan grants (array_cat, guard, business+enterprise, starter excluded):
`crm.leads`, `crm.tasks_activities`, `crm.service_contracts`, `crm.recurring_billing`,
`crm.service_orders`, `accounting.projects` (6 keys). Role-template grants: owner = all
7; sales = leads/tasks/activities manage; accountant = contracts.bill +
projects.manage. Template seed: `industry.professional_services` v1.0.0 manifest
**verbatim** from the docs JSON (after the §12 doc reconciliation) — byte-equality
with the contracts constant proven by hash pin in templates-019.spec.

## 11. API surface (45 routes — route-permissions.ts rows; controllers match VERBATIM)

| # | Method+Path | Permission | Feature |
|---|---|---|---|
| 1 | GET /api/v1/accounting/projects | accounting.journal_entries.view | accounting.projects |
| 2 | POST /api/v1/accounting/projects | accounting.projects.manage | accounting.projects |
| 3 | PATCH /api/v1/accounting/projects/:id | accounting.projects.manage | accounting.projects |
| 4 | GET /api/v1/crm/leads?status&ownerUserId&limit | crm.leads.manage | crm.leads |
| 5 | POST /api/v1/crm/leads | crm.leads.manage | crm.leads |
| 6 | GET /api/v1/crm/leads/:id | crm.leads.manage | crm.leads |
| 7 | PUT /api/v1/crm/leads/:id | crm.leads.manage | crm.leads |
| 8 | POST /api/v1/crm/leads/:id/convert | crm.leads.manage | crm.leads |
| 9 | POST /api/v1/crm/leads/:id/lose | crm.leads.manage | crm.leads |
| 10 | GET /api/v1/crm/tasks?status&relatedType&relatedId&limit | crm.tasks.manage | crm.tasks_activities |
| 11 | POST /api/v1/crm/tasks | crm.tasks.manage | crm.tasks_activities |
| 12 | PUT /api/v1/crm/tasks/:id | crm.tasks.manage | crm.tasks_activities |
| 13 | POST /api/v1/crm/tasks/:id/complete | crm.tasks.manage | crm.tasks_activities |
| 14 | POST /api/v1/crm/tasks/:id/cancel | crm.tasks.manage | crm.tasks_activities |
| 15 | GET /api/v1/crm/activities?relatedType&relatedId&limit | crm.activities.manage | crm.tasks_activities |
| 16 | POST /api/v1/crm/activities | crm.activities.manage | crm.tasks_activities |
| 17 | GET /api/v1/crm/dashboard-summary | crm.leads.manage | crm.leads |
| 18 | GET /api/v1/crm/contracts?status&partnerId&limit | crm.contracts.manage | crm.service_contracts |
| 19 | POST /api/v1/crm/contracts | crm.contracts.manage | crm.service_contracts |
| 20 | GET /api/v1/crm/contracts/:id | crm.contracts.manage | crm.service_contracts |
| 21 | PUT /api/v1/crm/contracts/:id | crm.contracts.manage | crm.service_contracts (DRAFT-only edit) |
| 22 | POST /api/v1/crm/contracts/:id/activate | crm.contracts.manage | crm.service_contracts (number + grid) |
| 23 | POST /api/v1/crm/contracts/:id/cancel | crm.contracts.manage | crm.service_contracts (reason) |
| 24 | POST /api/v1/crm/contracts/:id/renew | crm.contracts.manage | crm.service_contracts |
| 25 | GET /api/v1/crm/contracts/:id/schedule | crm.contracts.manage | crm.service_contracts |
| 26 | GET /api/v1/crm/contracts/:id/billing-preview?asOf | crm.contracts.manage | crm.service_contracts |
| 27 | POST /api/v1/crm/contracts/:id/advances | crm.contracts.manage | crm.service_contracts |
| 28 | GET /api/v1/crm/contracts/:id/advances | crm.contracts.manage | crm.service_contracts |
| 29 | GET /api/v1/crm/contract-invoices?contractId&status&limit | crm.contracts.manage | crm.service_contracts |
| 30 | GET /api/v1/crm/billing-runs?limit | crm.contracts.bill | crm.recurring_billing |
| 31 | POST /api/v1/crm/billing-runs | crm.contracts.bill | crm.recurring_billing |
| 32 | GET /api/v1/crm/time-entries?from&to&projectId&mine&limit | crm.contracts.manage | crm.service_contracts |
| 33 | POST /api/v1/crm/time-entries | crm.contracts.manage | crm.service_contracts |
| 34 | PUT /api/v1/crm/time-entries/:id | crm.contracts.manage | crm.service_contracts |
| 35 | POST /api/v1/crm/time-entries/:id/void | crm.contracts.manage | crm.service_contracts |
| 36 | POST /api/v1/crm/time/timesheets/review | crm.contracts.manage | crm.service_contracts |
| 37 | GET /api/v1/crm/service-orders?status&contractId&limit | crm.service_orders.manage | crm.service_orders |
| 38 | POST /api/v1/crm/service-orders | crm.service_orders.manage | crm.service_orders |
| 39 | GET /api/v1/crm/service-orders/:id | crm.service_orders.manage | crm.service_orders |
| 40 | PUT /api/v1/crm/service-orders/:id | crm.service_orders.manage | crm.service_orders (DRAFT-only) |
| 41 | POST /api/v1/crm/service-orders/:id/approve | crm.service_orders.manage | crm.service_orders |
| 42 | POST /api/v1/crm/service-orders/:id/log-hours | crm.service_orders.manage | crm.service_orders |
| 43 | POST /api/v1/crm/service-orders/:id/complete | crm.service_orders.manage | crm.service_orders |
| 44 | POST /api/v1/crm/service-orders/:id/invoice | crm.service_orders.manage | crm.service_orders |
| 45 | POST /api/v1/crm/service-orders/:id/cancel | crm.service_orders.manage | crm.service_orders |

All routes: requireIdentity + envelope + Idempotency-Key global guards; zod UUID /
QTY≤6dp / MONEY≤4dp / date ISO. The contract-billing port: `SalesInvoiceService`
gains `setContractBillingPort(port: { validateContract(id): Promise<boolean>;
onContractInvoicePosted(contractId, invoiceId, actorId): Promise<void> } | null)` —
wired in the CrmModule constructor (the JobCardsController port-wiring precedent;
avoids circular module imports). The port fires the advance release (§1 row 5) after a
successful post of a contract-linked invoice, inside the same posting UoW.
`SalesInvoiceService.create` gains optional `contractId`, `serviceOrderId`, `projectId`
(existence-validated via the port for contract; direct store reads for project —
accounting store is importable; service orders validated crm-side before the call and
trusted at the boundary, documented).

## 12. Template & configuration (industry.professional_services)

Doc reconciliation FIRST (T43, recorded as deviations in the evidence + completion
report): (a) **drop the `bom_production` capability_prerequisites entry** from
professional-services.md (its `level: "N/A"` + empty feature_keys fail the §3 zod
schema; the .md note is updated to say the not-applicable capability is simply
absent); (b) **reconcile the pin `partners.ar_aging` → `ar.aging`** (the live registry
key — the 0025 automotive precedent; same for the .md reports table); (c) regenerate
the extracted JSON (`python3 scripts/extract_manifests.py`). Then: contracts
`PROFESSIONAL_SERVICES_TEMPLATE_MANIFEST` (deepFreeze, verbatim) + both barrel exports
+ SHIPPED_TEMPLATE_MANIFESTS (7) + industry-manifests.test (seven manifests, PHASE-019
pins block, 3 negative fixtures); POLICY_REGISTRY (6) + SETTINGS_REGISTRY (6 +
`crm.defer_advance_recognition`); `CURRENT_SHIPPED_PHASE` → "PHASE-019";
layer-fixtures (SHIPPED_TEMPLATES += professional_services; BUSINESS_KEYS += the 6-key
0027 block; REMOVE the now-duplicate explicit enterprise rows for
`crm.*`/`accounting.projects`); golden-effective-configs (3 new rows + professional
structural anchors + **re-pin ALL rows** — the 7 new SETTINGS keys land in every
tenant's policies map + L4 changes; tabulate old→new); template-prerequisites spec
(pin → 19; automotive service_contracts OPTIONAL assertion flips — the without-add-on
test revokes the full 5-key CRM set, single-key revoke breaks BR-040 closure; move the
synthetic REQUIRED-later-phase proof to `accounting.fixed_assets`@PHASE-020);
template-switch R9 re-check (zero pins expected to move — grocery's set was already
fully live at 018); `templates-019.spec.ts` — the §8 seven requirements (clean apply +
KNOWN_HASH pinned twice; idempotent re-apply; switch safety BR-038 — retail →
professional_services over a real posted invoice; degraded entitlement revoke
`crm.service_contracts` → typed blocked + zero rows; source-without-add-on hides
cleanly; starter full missing chain; L5-beats-L1 on a services policy). Feature-key
closure: `crm.leads`, `crm.tasks_activities`, `crm.service_contracts`,
`crm.recurring_billing`, `crm.service_orders`, `accounting.projects` all exist in
FEATURE_DEPS ✓; `crm.contract_deposits`/`crm.late_fees` stay §3 pending intake (NOT
implemented — RISK-019).

## 13. Reports & dashboards (PHASE-013 contract, registry/industry/phase019.ts)

`services.contract_revenue_schedule` (params dateFrom/dateTo/locale + contractId? +
asOf; requiredPermission `crm.contracts.manage`; GL tie: Σ invoiced net == the
contract invoices' posted revenue journal lines, tolerance 0; rows: per contract ×
period — contracted (schedule), invoiced (POSTED), draft (DRAFT/PENDING_APPROVAL/
APPROVED), backlog (contracted − invoiced − draft), overdue (AR open buckets matching
`ar.aging` for the same asOf — BR-028 determinism); **reconciliation invariant:
schedule = invoiced + draft + backlog** asserted in the spec) and
`services.time_billing_summary` (params window + projectId?; permission
`crm.contracts.manage`; hours recorded vs billable vs invoiced per project/fee-earner,
amounts = hours × snapshotted rates; operational labels where non-GL). Registry wiring:
`DataSourceModule` union += "crm"; `SOURCE_MODULES` += "crm"; `MODULE_DATA_PHASE.crm
= 19`; `REGISTERED_PHASE_WINDOW` 18 → 19; REPORT_CONTRACTS += 2 (registry 66 → 68);
`CrmQueriesService` in registry/industry/crm-queries.ts (raw SQL via tenantTx,
read-only). Dashboards: `GET /api/v1/crm/dashboard-summary` (route #17) returns
pipeline counts by status + follow-ups due today/overdue + contracts expiring in 30d +
next billing preview count — rendered as a permission-gated CRM section on the
dashboard page (DECISION: operational counts, not forced into report contracts; the
two services.* reports pin dashboard:true via the manifest and appear as pinned
reports).

## 14. Web (7 screens + GL filter, bilingual RTL, server page + client component)

Routes: `/crm/pipeline` (lead board + conversion wizard), `/crm/tasks` (tasks +
activity timeline tabs), `/crm/contracts` (list + editor + schedule preview +
advances), `/crm/billing` (runs history + manual run + drafts review + unbilled-time
preview), `/crm/time` (entries + weekly review), `/crm/service-orders` (workspace),
`/accounting/projects` (management) + the GL screen gains an optional project filter
column. `TARGET_ROUTE_ALIASES` += crm.pipeline→/crm/pipeline, crm.time→/crm/time,
crm.contracts→/crm/contracts, crm.recurring_billing→/crm/billing,
accounting.projects→/accounting/projects. `INDUSTRY_REPORT_TARGETS` += the 2 services.*
keys. FALLBACK_CRUMBS rows (one `crmNavSection` group + projects row). api-types rows;
messages.ts error mappers (localizedCrmError + status maps); dictionaries.ts keys
(AR+EN parity — one PHASE-019 block at the end of all three blocks); dashboard CRM
section. Money canonical strings; `dir="ltr"` on numerals; 44px touch targets; sticky
footer; a11y labels; keyboard-complete billing review.

## 15. Golden fixture numbers (binding — billing/deferral/service-order/report specs)

Dedicated tenant `TENANT_C19` family (verify uniqueness per suite; the first execution
used: contracts 66666666-…, time 67676767-…, billing 68686868-…, deferral 69696969-…
— keep those or pick neighbors). Branch MAIN. Purposes mapped: AR_CONTROL→1130,
SALES_REVENUE→4100, SERVICE_REVENUE→4200, VAT_PAYABLE→2120, DEFERRED_REVENUE→2130,
COGS→5100, INVENTORY→1140. Fee items (SERVICE): `FEE-RET` (monthly retainer),
`FEE-MIL` (milestone), `FEE-HR` (hourly consult). Output tax code 15% (mirror the
sales fixtures tax code). Partner `P-000001` (CUSTOMER, credit terms 30d). Project
`CASE-01` (OPEN) + `CASE-02` (for the closed-rejection test).

**Retainer chain** (contract 2026-01-15 → 2026-06-14, monthly 1000.0000, FEE-RET,
project CASE-01): activate → CT number + 6 schedule entries (Jan 15–31 … Jun 1–14,
billDate = period start). Run asOf 2026-02-01 → 2 drafts (Jan, Feb) each net 1000.0000
gross 1150.0000; re-run → 0 new; run asOf 2026-07-01 → 4 more (total 6). Approve+post
the January draft (period 2026-01 OPEN): **J-INV [DR AR 1150.0000 (partner, project
stamped) · CR SERVICE_REVENUE 1000.0000 (project) · CR VAT_PAYABLE 150.0000 (project)]**
+ partner subledger row 1150.0000 same tx; contract_invoices row (period 2026-01);
schedule entry INVOICED.

**Deferral chain** (policy `crm.defer_advance_recognition` = true via tenant_settings):
receipt 500.0000 (2025-12-15, on-account) → **J-RCP [DR cash 500.0000 · CR AR
500.0000]** (existing chain); tag advance → **J-DEF [DR AR 500.0000 (partner,
projectId-stamped) · CR DEFERRED_REVENUE 500.0000]**; post the February draft (gross
1150.0000) → **J-INV2 [DR AR 1150.0000 · CR SERVICE_REVENUE 1000.0000 · CR VAT_PAYABLE
150.0000]** + **J-REL [DR DEFERRED_REVENUE 500.0000 · CR AR 500.0000 (partner,
projectId-stamped, allocated to the invoice)]**; invoice open 650.0000; AR GL =
subledger (INV-009 tie asserted at every step); DEFERRED_REVENUE balance 0; revenue
recognized ONLY in the posting periods (assert 2025-12 revenue lines == 0). Policy
OFF control fixture: tag → link only, no J-DEF, plain on-account.

**Milestone chain**: contract 2 milestones (2026-03-01 "Signing" 5000.0000, 2026-05-01
"Delivery" 7000.0000, FEE-MIL); run asOf 2026-03-01 → 1 draft (5000.0000 + VAT);
re-run → 0; second milestone bills at its date. **Hourly chain**: contract HOURLY
(rate via price list 250.000000/h FEE-HR, CASE-01); time entries: 2.000000 h
2026-04-03 (narrative "Drafting"), 1.500000 h 2026-04-10 (no narrative — skipped +
listed needsNarrative), 3.000000 h 2026-03-28 (different month — separate period grid);
weekly review approves; run asOf 2026-05-01 → April draft: ONE line 2.000000 ×
250.000000 = 500.0000 net ("Drafting" as description); March entry bills in the March
run; narrative-less entry stays unbilled. **Leap-day fixture**: term 2028-02-01 →
2028-03-31 → periods Feb (02-01→02-29), Mar; month-edge: term ending mid-month clips.

**Service-order chain** (mirrors job-card fixtures): SO with 1 SERVICE line (3 h @
150.000000) + 1 PARTS line (STOCK item, qty 2, warehouse W-SO with stock @ 50.000000):
approve (issue_immediate) → **J-COGS [DR COGS 100.0000 · CR INVENTORY 100.0000]**;
invoice → **J-SO [DR AR 517.5000 · CR SERVICE_REVENUE 450.0000 · CR VAT 67.5000]**
(3×150×1.15; parts line optional in the fixture set — when present: + parts net/
VAT per the ordinary chain); contract-linked variant: identical journals + contractId
stamped on the invoice row.

## 16. Task order & dependencies

| Task | Agent scope | Depends on | Evidence file |
|---|---|---|---|
| T42 (1) | Foundation: migration 0027 (all §10 incl. manual_journal_lines.project_id) + schema.ts rows/columns + registrations (migrations.ts, _journal, migrations.spec, permissions-drift union + 0027, route-permissions 45 rows, tables.registry + isolation fixtures/count bumps, stock_moves/notifications widenings, sales_invoices columns, journal-spec/engine/store project stamping + PROJECT_CLOSED/NOT_FOUND, sales create input fields + port setter) + ENTITY_CATALOG/TABLES/ERD/AUTH_MATRIX/MODULE_BOUNDARIES doc rows + docs:validate | — | agent-ctx/T42-1-foundation.md |
| T43 (2) | Template + configuration: §12 in full | T42 | agent-ctx/T43-2-template.md |
| T44 (3) | Projects dimension: store + controller + GL filters + manual-journal projectId + projects.spec | T42 | agent-ctx/T44-3-projects.md |
| T45 (4) | CRM core: leads + tasks/activities + reminder sweep + notifications + dashboard-summary + specs | T42 | agent-ctx/T45-4-crm-core.md |
| T46 (5) | Contracts + schedule + time: contract service + time service + controllers + specs (§18 lesson 1 baked in) | T42 | agent-ctx/T46-5-contracts-time.md |
| T47 (6) | Billing + deferral release: BillingRunService + pg-boss job + port wiring + J-REL + billing/deferral specs (§18 lessons 2–3 baked in) | T46 | agent-ctx/T47-6-billing-deferral.md |
| T48 (7) | Service orders: §7 full + service-orders.spec | T42 | agent-ctx/T48-7-service-orders.md |
| T49 (8) | Reports + dashboards: §13 | T47 | agent-ctx/T49-8-reports.md |
| T50 (9) | Web: §14 | T47, T48 | agent-ctx/T50-9-web.md |
| — (me) | Docs updates + full gate + PHASE-019-COMPLETION.md (incl. the rental deferral decision record + the environment-incident note) | all | docs/implementation/phases/reports/PHASE-019-COMPLETION.md |

Parallel batches: T43 + T44 + T45 after T42 (disjoint file sets); T46 → T47 → T48;
T48 only needs T42 (may run alongside T46/T47 if the agent sticks to its folders).
T49 + T50 parallel after T48.

DB-test conventions: dedicated tenant per suite; `TMPDIR=$HOME/tmp-<task> npx vitest
run --config vitest.db.config.ts src/__db__/<path>`; order independence (reopen
periods after PERIOD_LOCKED packs). Gate commands: `pnpm typecheck`, `pnpm lint`,
`pnpm run lint:depcruise`, `pnpm run check:permissions-drift`, `pnpm validate:manifests`,
`pnpm test`, `pnpm --filter @erp/api test:db`, `pnpm docs:validate`, `pnpm run
check:i18n-parity`, `pnpm run check:rls`. **Every task agent writes its evidence file
FIRST (before the final gate pass) so it survives harness deadlines.**

## 17. Out of scope (review blockers if implemented)

`crm.rental_contracts`, `crm.contract_deposits`, `crm.late_fees`,
`distribution.shipment_tracking` (the rental-logistics intake set — deferred behind
the decision record in the completion report; the manifest is NOT seeded); customer
portal; court/practice integrations; trust/escrow claims; payroll/time-attendance;
offline CRM; e-invoicing submissions; carrier adapters. INDUSTRY_CATALOG's rental-at-019
targeting is annotated as a recorded divergence (RISK-020), never silently changed.

## 18. Lessons from the first execution (BINDING — post-mortem of the lost run)

1. **The fee-item home is the SCHEDULE, not the contract** (0027 has no
   contract-level fee_item_id — binding DDL). The update-path validation MUST resolve
   the effective contract-level default from the STORED grid when the patch omits
   feeItemId: a `resolveStoredFeeItem(contract)` helper (MILESTONES → the first stored
   MILESTONE row's feeItemId; RETAINER/HOURLY → `findScheduleGridFeeItem`);
   `validateFeeModel` must accept `milestones: undefined` = "unchanged, skip array
   checks". Symptom it fixed: a DRAFT full-replace PATCH omitting feeItemId threw
   ContractInputInvalidError ("milestone X has no fee item") — 2 spec failures.
   `applySchedule` already resolved stored defaults for writes; mirror it in
   validation.
2. **J-DEF's AR line carries the project stamp** (like J-REL and the invoice journals —
   §1 row 1): `tagAdvance`'s journal spec must stamp `projectId: contract.projectId`
   on the AR_CONTROL DEBIT line (the DEFERRED_REVENUE CREDIT line carries none — spec
   line 529 of the deferral fixtures). J-REL stamps projectId on BOTH lines.
3. **The deferral release's open-item lookup must match the REAL
   partner_subledger_entries schema** — before writing `findInvoiceArOpenItem`, read
   the actual DDL (grep `partner_subledger` in apps/api/migrations/) AND the
   PartnerSubledgerPort writer to get the exact column names and the direction/source
   conventions; the first execution's `WHERE source_type = 'sales_invoice' AND
   source_id = … AND direction = 'DEBIT'` was written blind and the release hook
   silently no-opped (openItem undefined → early return, no J-RL, no inbox). Verify
   by asserting the J-REL journal exists in the same test that posts the invoice.
4. **T44's migration gap**: manual_journal_lines needed project_id (the draft
   substrate) — it is folded INTO 0027 this time (§10), not a separate 0028.
5. **T43's golden re-pins**: ALL rows move (not just business/enterprise) — the 7 new
   SETTINGS keys land in every tenant's policies map; tabulate old→new honestly.
   The without-add-on degradation test revokes the full 5-key CRM set (single-key
   revoke breaks the tenant's own BR-040 closure); the synthetic phase-gate proof
   moves to `accounting.fixed_assets`@PHASE-020.
6. **Spec service instances**: DB specs construct their service graph manually —
   the deferral spec MUST wire the port on its own `salesInvoices` instance
   (`setContractBillingPort`) exactly as CrmModule does, or the release path never
   fires under test.
7. **Harness deadlines**: task agents hit "context deadline exceeded" AFTER
   completing code but before writing evidence. Write the evidence file EARLY
   (§16 note); keep final chat reports ≤30 lines.
