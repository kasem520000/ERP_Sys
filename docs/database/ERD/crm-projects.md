# ERD — CRM, Service Contracts & Projects Cluster (PHASE-019)

> **Status:** DELIVERED (PHASE-019, migration `0027_crm_projects.sql`) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-03 · **Phases:** 019

Core attributes only. Column-level specifications live in
[TABLES/crm-projects.md](../TABLES/crm-projects.md) (authored in PHASE-019) —
sync rule in [database README](../README.md#synchronization-rule-normative);
the Drizzle schema is the machine-readable mirror (migration 0027 +
`db/schema.ts`).

```mermaid
erDiagram
  projects |o--o{ projects : "parent (composite FK)"
  projects ||--o{ service_contracts : "project stamp (nullable)"
  projects ||--o{ crm_time_entries : "timeslip case (nullable)"
  projects ||--o{ journal_lines : "PHASE-019 stamp (journal_lines.project_id)"
  projects ||--o{ sales_invoices : "header stamp (sales_invoices.project_id)"
  partners ||--o{ leads : "linked at conversion (forever)"
  leads ||--o{ crm_tasks : "related target (polymorphic, no FK)"
  leads ||--o{ crm_activities : "related target (polymorphic, no FK)"
  partners ||--o{ service_contracts : "the customer"
  partners ||--o{ service_orders : "the customer"
  service_contracts |o--o{ service_contracts : "renewed_to_contract_id (the renew copy)"
  service_contracts ||--o{ contract_billing_schedule : "the expanded grid (fee-item home)"
  service_contracts ||--o{ contract_invoices : "idempotency guard"
  service_contracts ||--o{ contract_advances : "on-account receipts tagged"
  service_contracts |o--o{ service_orders : "contract linkage (nullable, no journal fork)"
  items ||--o{ contract_billing_schedule : "fee item (SERVICE)"
  items ||--o{ crm_time_entries : "fee item (SERVICE)"
  items ||--o{ service_order_lines : "SERVICE or PARTS item"
  sales_invoices ||--o{ contract_invoices : "the generated invoice"
  sales_invoices |o--o{ contract_billing_schedule : "INVOICED flip stamp (invoice_id)"
  sales_invoices |o--o{ crm_time_entries : "billed_invoice_id (the pull stamp)"
  service_orders |o--o{ sales_invoices : "sales_invoices.service_order_id (0027 trio)"
  receipts ||--o{ contract_advances : "the tagged receipt"
  branches ||--o{ service_orders : "per-branch SO- series"
  warehouses ||--o{ service_orders : "parts warehouse"
  service_orders ||--o{ service_order_lines : "tombstone lines"
  warehouses ||--o{ stock_moves : "parts issues (service_order source)"

  projects {
    uuid id PK
    text code UK_tenant "^[A-Za-z0-9_-]{1,20}$"
    text name "1..200"
    text name_ar
    uuid parent_id FK "composite, RESTRICT"
    text status "OPEN|CLOSED (CLOSED rejects new stamps)"
  }
  leads {
    uuid id PK
    text name
    text source "WALK_IN|REFERRAL|WEBSITE|CAMPAIGN|CALL|OTHER"
    text status "NEW|QUALIFIED|CONVERTED|LOST"
    text lost_reason "LOST => present (1..200)"
    uuid owner_user_id
    uuid partner_id FK "set at conversion, linked forever"
    timestamptz converted_at "CONVERTED => partner_id + converted_at"
  }
  crm_tasks {
    uuid id PK
    text title "1..200"
    text related_type "LEAD|PARTNER|CONTRACT|SERVICE_ORDER"
    uuid related_id "polymorphic (no FK)"
    uuid assignee_user_id
    date due_date
    timestamptz remind_at "sweep scans remind_at <= now"
    timestamptz notified_at "NULL until notified"
    text status "OPEN|DONE|CANCELLED"
  }
  crm_activities {
    uuid id PK
    text kind "CALL|MEETING|EMAIL|NOTE"
    text related_type "LEAD|PARTNER|CONTRACT|SERVICE_ORDER"
    uuid related_id "polymorphic (no FK)"
    timestamptz occurred_at "timeline order (DESC)"
    text summary "1..2000"
    int duration_minutes ">= 0"
    uuid actor_user_id
  }
  service_contracts {
    uuid id PK
    text contract_no UK_tenant "CT-{yyyy}-{seq:5} at activation"
    uuid partner_id FK
    uuid project_id FK "composite RESTRICT"
    text title "1..200"
    text fee_model "RETAINER|MILESTONES|HOURLY"
    date start_date
    date end_date "CHECK end >= start"
    numeric monthly_amount "19,4 >= 0 (RETAINER input)"
    varchar currency_code "tenant base only v1"
    text status "DRAFT|ACTIVE|CANCELLED|RENEWED"
    uuid renewed_to_contract_id FK "the renew copy"
  }
  contract_billing_schedule {
    uuid id PK
    uuid contract_id FK
    text entry_type "RETAINER_PERIOD|MILESTONE|HOURLY_PERIOD"
    text period_key UK_entry_period "YYYY-MM, partial WHERE NOT NULL"
    date period_start
    date period_end
    date bill_date "period start (advance) | end (arrears)"
    numeric amount "19,4 (NULL for HOURLY)"
    uuid fee_item_id FK "the fee-item home"
    text milestone_label UK_milestone "partial WHERE MILESTONE"
    text status "PLANNED|INVOICED|SKIPPED"
    uuid invoice_id FK "the INVOICED flip stamp"
  }
  contract_invoices {
    uuid id PK
    uuid contract_id FK
    uuid invoice_id FK "RESTRICT -> sales_invoices"
    text period_key UK_period "partial WHERE NOT NULL"
    uuid milestone_schedule_id FK UK_milestone "partial WHERE NOT NULL"
    text status "GENERATED"
  }
  contract_advances {
    uuid id PK
    uuid contract_id FK
    uuid receipt_id FK "RESTRICT -> receipts"
    numeric amount "19,4 > 0"
    text status "HELD|RELEASED"
    uuid defer_journal_id "plain uuid (no FK)"
    uuid released_journal_id "plain uuid (no FK)"
    uuid released_invoice_id "plain uuid (no FK)"
  }
  service_orders {
    uuid id PK
    text order_no UK_tenant "SO-{yyyy}-{seq:5} at creation"
    uuid branch_id FK
    uuid partner_id FK
    uuid contract_id FK "nullable (no journal fork)"
    uuid warehouse_id FK "parts"
    text status "DRAFT|IN_PROGRESS|COMPLETED|INVOICED|CANCELLED"
    text cancel_reason "CANCELLED => reason + cancelled_at"
  }
  service_order_lines {
    uuid id PK
    uuid order_id FK
    int line_no UK_order_line
    text line_type "SERVICE|PARTS"
    uuid item_id FK
    numeric estimated_hours "19,6 (SERVICE => present)"
    numeric unit_price "19,6"
    numeric qty "19,6 > 0"
    numeric logged_hours "19,6 default 0"
    text status "PENDING|RESERVED|ISSUED|INVOICED|VOID"
    uuid reservation_id
    uuid issue_journal_id "service_order:issue_parts anchor"
    uuid invoice_line_id
  }
  crm_time_entries {
    uuid id PK
    date entry_date
    numeric hours "19,6 > 0"
    uuid fee_item_id FK "SERVICE item"
    uuid project_id FK "required-when-policy (service-enforced)"
    uuid contract_id FK
    uuid fee_earner_user_id
    numeric unit_rate "19,6 >= 0 snapshotted at recording"
    text narrative "needsNarrative skip when policy on"
    boolean billable "default true"
    text status "DRAFT|APPROVED|BILLED|VOID"
    uuid billed_invoice_id FK "the pull stamp"
  }
```

Atomicity notes: the advance reclass (`contract_advance:defer`) and the
release (`contract_advance:release`, fired by the contract-billing port in the
same posting UoW as the contract invoice's post) each commit in ONE
transaction with their documents (INV-018) through the centralized posting
engine (INV-013 idempotency anchors, plain uuids — no FK, the production
fg_journal_id precedent). The contract itself posts NOTHING — its invoices
are DRAFT sales invoices through the ordinary chain (the billing run never
auto-posts; BR-034 SoD). Service orders mirror job cards byte-close: parts
issue in issue_immediate mode posts the `service_order:issue_parts` COGS
journal; the order's invoice posts settlement only (no second COGS). Time
feeds billing ONLY — no payroll, no staff cost (documented limitation:
profitability is fee-based). The projects stamp travels on
`journal_lines.project_id` (+ `manual_journal_lines.project_id`, the draft
substrate) and on the `sales_invoices` header (the 0027 trio:
contract_id/service_order_id/project_id) — every line of a contract invoice's
post + COGS journals carries it; a CLOSED project rejects NEW stamps (typed
PROJECT_CLOSED at the engine) while posted history stays.
