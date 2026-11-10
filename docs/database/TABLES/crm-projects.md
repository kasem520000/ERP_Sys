# TABLES — CRM, Service Contracts & Projects Cluster (PHASE-019)

> **Status:** DELIVERED (PHASE-019, migration `0027_crm_projects.sql`) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-03 · Column-level specs for
> the PHASE-019 cluster (leads, crm tasks + activities, the service-contract family
> — contracts + billing schedule + the invoices idempotency guard + advances —,
> service orders + lines, time entries, and the accounting-owned projects
> dimension), authored in-phase per the file header rule. ADR-0009 precision
> discipline throughout: hours and rates are `numeric(19,6)` (6-decimal internal),
> money quanta `numeric(19,4)`. All tables are draft/status-lifecycled
> (SELECT/INSERT/UPDATE for `erp_app`) — **no DELETE grants anywhere in the
> cluster** (tombstone + status flips carry the lifecycle; the manual-journal and
> bom_lines draft-replace deletes predate this phase). RLS macro on every table;
> the isolation registry covers each (A1–A10). No table here writes `journal_*`
> or `stock_*` — those stay owned by accounting and inventory respectively
> (MODULE_BOUNDARIES; ADR-0007: the advance reclass/release journals flow only
> through the centralized posting engine, anchored at plain uuids — the
> production fg_journal_id precedent).

## §projects — the analytical dimension (accounting-owned)

The `cost_centers` clone (0010 pattern) with `status` OPEN|CLOSED replacing
`is_active`: `code` text NOT NULL with the shape CHECK `^[A-Za-z0-9_-]{1,20}$` +
`uq_projects_tenant_code` (tenant, code); `name` 1..200; `name_ar`; `parent_id`
composite FK → projects (RESTRICT) — the tree stays homogeneous; `status` CHECK
`('OPEN','CLOSED')` — **a CLOSED project rejects NEW journal-line stamps** (typed
`PROJECT_CLOSED` at the engine's account-resolution stage; unknown ids fail
`PROJECT_NOT_FOUND`; posted history stays). The stamp substrate:
`journal_lines.project_id` + `manual_journal_lines.project_id` (the draft
substrate, folded into THIS migration — §18 lesson 4) both uuid NULL + composite
FK → projects (RESTRICT) + `ix_journal_lines_tenant_project`; `sales_invoices`
gains the provenance trio (below). Store functions in accounting.store
(list/find/insert/update — no DELETE); the store CRUD block is the cost_centers
clone verbatim.

## §leads — the intake pipeline (crm-owned)

`status` CHECK `('NEW','QUALIFIED','CONVERTED','LOST')`; `source` CHECK
`('WALK_IN','REFERRAL','WEBSITE','CAMPAIGN','CALL','OTHER')` DEFAULT 'OTHER';
the lost-shape CHECK (`status <> 'LOST' OR lost_reason IS NOT NULL`, reason
1..200); the converted-shape CHECK (`status <> 'CONVERTED' OR (partner_id IS NOT
NULL AND converted_at IS NOT NULL)`); `partner_id` composite FK → partners
(RESTRICT) — NULL until conversion, then linked forever (provenance); the
converted lead is immutable (service-enforced `LEAD_CONVERTED`). No numbering
series (leads are not legal documents); no ledger effect ever. `owner_user_id`
uuid NULL (the rep — no FK, the created_by precedent). Indexes:
`ix_leads_tenant_status`, `ix_leads_tenant_owner`.

## §crm_tasks / §crm_activities — future work vs logged past (crm-owned)

**`crm_tasks`** — `status` CHECK `('OPEN','DONE','CANCELLED')`; `related_type`
CHECK `('LEAD','PARTNER','CONTRACT','SERVICE_ORDER')` + `related_id` (polymorphic
— no FK, the inspections target precedent); `title` 1..200; `assignee_user_id`
uuid NULL; `due_date` date NULL; `remind_at`/`notified_at` timestamptz NULL —
the reminder sweep (cron `30 5 * * *`) scans OPEN tasks with `remind_at <= now`
AND `notified_at IS NULL`, records the inbox row (category 'crm') + the
`task_reminder` email, then stamps `notified_at`. Indexes:
`ix_crm_tasks_tenant_status_due` (tenant, status, due_date),
`ix_crm_tasks_tenant_related` (tenant, related_type, related_id), and the
partial `ix_crm_tasks_pending_reminders` (tenant, remind_at) WHERE
`remind_at IS NOT NULL AND notified_at IS NULL` — the sweep's scan substrate.

**`crm_activities`** — `kind` CHECK `('CALL','MEETING','EMAIL','NOTE')`; the
same related CHECK; `occurred_at` NOT NULL; `summary` 1..2000;
`duration_minutes` int NULL CHECK ≥ 0; `actor_user_id` uuid NULL. Index:
`ix_crm_activities_tenant_related` (tenant, related_type, related_id,
`occurred_at DESC`) — the timeline read.

## §service_contracts — the CT- document (crm-owned; posts nothing)

`status` CHECK `('DRAFT','ACTIVE','CANCELLED','RENEWED')`; `fee_model` CHECK
`('RETAINER','MILESTONES','HOURLY')`; the term CHECK (`end_date >= start_date`);
`monthly_amount` numeric(19,4) NULL CHECK ≥ 0 (the RETAINER input — no
contract-level fee_item_id: **the schedule rows are the fee-item home**, §18
lesson 1); `contract_no` tenant-unique where set (partial
`uq_service_contracts_tenant_no`, CT-{yyyy}-{seq:5} reserved + bound at
activation — the PRD release pattern); `partner_id` composite FK (RESTRICT);
`project_id` composite FK → projects (RESTRICT); `renewed_to_contract_id`
composite FK → service_contracts (the renew action creates a NEW contract copy
with fresh term + links it). **Expiry is derived** (status ACTIVE && end_date <
today ⇒ `isExpired` in reads; no state-flip job). `currency_code` varchar(3)
(tenant base only v1). Indexes: the partial number uq,
`ix_service_contracts_tenant_status`, `ix_service_contracts_tenant_partner`.

## §contract_billing_schedule — the expanded grid (crm-owned)

`entry_type` CHECK `('RETAINER_PERIOD','MILESTONE','HOURLY_PERIOD')`;
`period_key` text NULL CHECK `~ '^[0-9]{4}-[0-9]{2}$'` (NULL for MILESTONE);
`period_start`/`period_end` date NULL (the clipped calendar window);
`bill_date` NOT NULL; `amount` numeric(19,4) NULL (NULL for HOURLY — computed
at the run); `fee_item_id` composite FK → items (RESTRICT) — **the fee-item
home**; `milestone_label`/`milestone_label_ar` (partial uq WHERE
entry_type='MILESTONE'); `status` CHECK `('PLANNED','INVOICED','SKIPPED')`;
`invoice_id` composite FK → sales_invoices (the INVOICED flip stamp). Grid
semantics (binding for the T46 fixtures): RETAINER grid = calendar months
clipped to [start, end], billDate = period start (in advance), the full
monthly amount per period (NO automatic proration); MILESTONE grid = the
dated milestone lines (billDate = milestone date); HOURLY: one entry per
calendar month, billDate = period end (arrears — time must exist), amount
NULL. Re-runnable, additive — re-expansion converges (never duplicates).
Indexes: the partial entry-period uq (tenant, contract, entry_type,
period_key) WHERE period_key IS NOT NULL, the partial milestone uq, and
`ix_contract_billing_schedule_tenant_bill` (tenant, contract, bill_date).

## §contract_invoices — the idempotency guard (crm-owned)

The billing run's second net (after the source-key idempotency of
`sales_invoice:post`): `contract_id` + `invoice_id` composite FKs (RESTRICT →
sales_invoices); `period_key` NULL + **partial uq (tenant, contract,
period_key) WHERE period_key IS NOT NULL**; `milestone_schedule_id` composite
FK → contract_billing_schedule + **partial uq (tenant, contract,
milestone_schedule_id) WHERE milestone_schedule_id IS NOT NULL** — concurrent
double-fire (manual double-click, cron+manual overlap) hits the constraint
⇒ graceful skip (INV-013 discipline); `status` CHECK ('GENERATED'). Indexes:
`ix_contract_invoices_tenant_contract`, `ix_contract_invoices_tenant_invoice`.

## §contract_advances — on-account receipts tagged to a contract (crm-owned)

`contract_id` + `receipt_id` composite FKs (RESTRICT → receipts); `amount`
numeric(19,4) CHECK > 0; `status` CHECK `('HELD','RELEASED')` — tagging
validates the receipt has ≥ amount of unallocated on-account credit (existing
treasury allocation reads); with policy `crm.defer_advance_recognition` ON the
tag posts the reclass journal (source `contract_advance:defer`), OFF =
link-only (stays a plain on-account credit, BR-027 pure). The release at
invoice posting (source `contract_advance:release`, fired by the
contract-billing port in the same posting UoW) flips HELD → RELEASED. The
journal anchors `defer_journal_id`/`released_journal_id`/`released_invoice_id`
are **plain uuids — no FK** (the production fg_journal_id precedent). Index:
`ix_contract_advances_tenant_contract_status`.

## §service_orders / §service_order_lines — the job-card generalization (crm-owned)

**`service_orders`** — mirrors job cards byte-close: `status` CHECK
`('DRAFT','IN_PROGRESS','COMPLETED','INVOICED','CANCELLED')`; `order_no`
tenant-unique where set (partial uq, SO-{yyyy}-{seq:5}, docType
`service_order`, reserved at creation); `branch_id`/`partner_id`/`warehouse_id`
composite FKs (RESTRICT); `contract_id` composite FK NULL (standalone allowed
— contract linkage does NOT alter any journal); the cancel-shape CHECK
(CANCELLED ⇒ cancelled_at + cancel_reason). Indexes: the partial number uq,
`ix_service_orders_tenant_status`, `ix_service_orders_tenant_partner`.

**`service_order_lines`** — tombstone-based (no DELETE grant — the
job_card_lines shape): `line_type` CHECK `('SERVICE','PARTS')`; `status` CHECK
`('PENDING','RESERVED','ISSUED','INVOICED','VOID')`; `item_id` composite FK
(SERVICE items for SERVICE lines / STOCK for PARTS — service-enforced);
`qty` CHECK > 0; `estimated_hours` NULL CHECK ≥ 0 with the service-shape CHECK
(`line_type <> 'SERVICE' OR estimated_hours IS NOT NULL`); `logged_hours`
DEFAULT 0; the issue stamps `reservation_id`/`issue_unit_cost` (19,6)/
`issue_value` (19,4)/`issue_journal_id` (the `service_order:issue_parts` COGS
anchor — plain uuid) + `invoice_line_id`. Indexes:
`uq_service_order_lines_order_line` (tenant, order, line_no) + the partial
reservation ix.

## §crm_time_entries — timeslips (crm-owned)

`hours` numeric(19,6) CHECK > 0; `status` CHECK
`('DRAFT','APPROVED','BILLED','VOID')` — the weekly review (Monday ISO
weekStart) flips the week's DRAFT entries → APPROVED (audited batch); only
APPROVED entries are pullable by billing; `fee_item_id` composite FK (SERVICE
item); `project_id` composite FK → projects (RESTRICT) — required when policy
`crm.time_entries_require_case` (service-enforced, typed
`TIME_ENTRY_CASE_REQUIRED`; nullable here); `contract_id` composite FK NULL;
`unit_rate` numeric(19,6) CHECK ≥ 0 — **snapshotted at recording** (price list
of the contract partner when resolvable, else manual input; never recomputed
— determinism); `narrative` text NULL (empty-narrative entries are listed as
`needsNarrative` and skipped — never silently billed when the policy is on);
`billed_invoice_id` composite FK → sales_invoices (RESTRICT) — stamped at the
billing run. Time feeds billing ONLY — no payroll, no staff cost (documented
limitation: profitability is fee-based). Indexes:
`ix_crm_time_entries_tenant_project_date` (tenant, project, entry_date),
`ix_crm_time_entries_tenant_status`, the partial `ix_crm_time_entries_pullable`
(tenant, entry_date) WHERE `billed_invoice_id IS NULL AND status = 'APPROVED'`.

## Widenings, the projects stamp & the 2130 marker (0027)

- **`notifications.category` + `notification_prefs.category`** widen with
  `'crm'` (BOTH constraints, the 0023 DROP/re-ADD pattern) — the task-reminder
  sweep's in-app leg; the TS `NotificationCategory` union gains "crm" and the
  `task_reminder` email template joins the notifications enum.
- **`stock_moves.source_type`** widens with `'service_order'` (parts issues at
  service-order approval, issue_immediate mode — the full 0026 list re-issued
  + the new value).
- **`sales_invoices`** gains `contract_id` / `service_order_id` / `project_id`
  uuid NULL + composite FKs (RESTRICT) + partial tenant indexes (the 0025
  job-card pattern) — the billing run, the service-order invoice, and the
  project stamp ride the header; `SalesInvoiceService.create` accepts all
  three (existence-validated: project must exist AND be OPEN; contract through
  the contract-billing port when wired, else the raw read; service order
  crm-side validated + raw-probe backstop).
- **`journal_lines.project_id`** uuid NULL + composite FK (RESTRICT) +
  `ix_journal_lines_tenant_project` — the cost_center_id byte-template. The
  engine's account-resolution stage validates the stamp (PROJECT_NOT_FOUND /
  PROJECT_CLOSED, fail closed). **`manual_journal_lines.project_id`** too —
  the draft substrate folded into THIS migration (§18 lesson 4), not a later
  0028; the consumer wiring (zod per line + buildSpec) lands with the projects
  dimension task.
- **CoA template marker:** 2130 exists since 0008 as a plain row ('Accrued
  expenses', purpose NULL) — **UPDATED IN PLACE** (the 0025 4200/SERVICE_REVENUE
  precedent) to 'Deferred revenue' / 'الإيرادات المؤجلة' with the
  `DEFERRED_REVENUE` purpose marker. New tenants provision it at onboarding;
  existing tenants map once (fail-closed `PURPOSE_NOT_MAPPED` until then, the
  CARD_RECEIVABLE precedent DR-016-02).

## Grants & roles (migration 0027)

All eleven tables are draft/status-lifecycled: `SELECT, INSERT, UPDATE` for
`erp_app` — **NO DELETE grants anywhere** (tombstones and status flips carry
the lifecycle). `SELECT` for `erp_readonly` + `erp_definer` on all eleven. The
new columns on the widened tables (sales_invoices, journal_lines,
manual_journal_lines, notifications, notification_prefs, stock_moves) ride
their existing table-level grants. RLS macro `erp.apply_tenant_policy` on all
eleven tenant-owned tables; every one registered in the isolation suite's
table registry with generated A-test coverage (A1–A10). The 0027 permission
seeds (7 keys — 5 re-asserting the 0004 base set + the new `crm.contracts.bill`
and `accounting.projects.manage`) + plan grants (the 6 PHASE-019 feature keys
join business; enterprise already carried them from the 0008 base seed;
starter does NOT get them) + role-template grants (owner full set; sales the
intake tier; accountant billing + projects) + the `industry.professional_services`
v1.0.0 manifest seed (verbatim from
docs/industries/templates/manifests/manifest.professional_services.json — the
§12 doc reconciliation applied first: the bom_production N/A entry dropped,
the partners.ar_aging pin reconciled to the live ar.aging registry key).
