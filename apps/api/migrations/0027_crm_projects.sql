-- PHASE-019 · migration 0027 · CRM, Service Contracts & Projects foundation
--
-- Purpose (PHASE-019 §4–§8; ENTITY_CATALOG §crm/§accounting): the data model
-- for the CRM/service-billing/projects phase, all additive:
-- - crm-owned: `leads` (the NEW → QUALIFIED → CONVERTED/LOST intake
--   pipeline; conversion links the partner forever — provenance, no ledger
--   effect), `crm_tasks` (future work + the reminder sweep substrate) +
--   `crm_activities` (logged past interactions — the timeline), the
--   service-contract family: `service_contracts` (the CT- document; posts
--   nothing itself — the schedule is the fee-item home, NOT the contract),
--   `contract_billing_schedule` (the expanded grid: RETAINER_PERIOD /
--   MILESTONE / HOURLY_PERIOD rows), `contract_invoices` (the idempotency
--   guard — concurrent double-fire hits the partial uniques and skips
--   gracefully, INV-013 discipline), `contract_advances` (on-account
--   receipts tagged to a contract; the reclass/release journal anchors are
--   plain uuids — the production fg_journal_id precedent), plus
--   `crm_time_entries` (timeslips; rates snapshotted at recording).
-- - the service-order generalization of job cards: `service_orders` +
--   `service_order_lines` (SO- numbering at reserve; issue_immediate /
--   reserve policies mirror the workshop byte-close).
-- - accounting-owned: `projects` (the cost_centers clone with status
--   OPEN|CLOSED — CLOSED rejects new journal-line stamps, typed
--   PROJECT_CLOSED) + the journal-line stamp substrate: `journal_lines`
--   and `manual_journal_lines` (the draft substrate — folded in here, not
--   a later 0028) both gain `project_id`.
-- - sales-owned widening: `sales_invoices` gains `contract_id` /
--   `service_order_id` / `project_id` (composite FKs, RESTRICT) — the
--   billing run, the service-order invoice, and the project stamp ride the
--   header; every line of the post + COGS journals carries projectId.
-- - notifications widen `category` with 'crm' (the task-reminder sweep);
--   `stock_moves.source_type` widens with 'service_order' (parts issues
--   at service-order approval).
-- - chart_of_accounts_template: 2130 exists since 0008 as a plain row
--   ('Accrued expenses', purpose NULL) — UPDATED IN PLACE (the 0025
--   4200/SERVICE_REVENUE precedent) to 'Deferred revenue' with the
--   DEFERRED_REVENUE purpose marker (existing tenants map once —
--   fail-closed PURPOSE_NOT_MAPPED until then, the CARD_RECEIVABLE
--   precedent DR-016-02).
-- - permission seeds (AUTHORIZATION_MATRIX §3.8/§3.1; 7 keys — 5 already
--   in the 0004 base seed, re-asserted; crm.contracts.bill +
--   accounting.projects.manage are new) + plan/role wiring (the 6
--   PHASE-019 feature keys join business + enterprise; starter does NOT
--   get them).
-- - template registry seed: `industry.professional_services` v1.0.0,
--   manifest verbatim from docs/industries/templates/manifests/
--   manifest.professional_services.json (the canonical source; the §12
--   doc reconciliation applied first — the bom_production N/A entry
--   dropped, the partners.ar_aging pin reconciled to the live ar.aging
--   registry key).
--
-- All tenant-owned tables get the PHASE-002 RLS macro.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- projects (accounting-owned; the cost_centers clone — 0010 pattern). The
-- OPEN|CLOSED status replaces is_active; CLOSED rejects NEW journal-line
-- stamps at the engine (PROJECT_CLOSED) while posted history stays.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "parent_id" uuid,
  "status" text NOT NULL DEFAULT 'OPEN',
  CONSTRAINT pk_projects PRIMARY KEY ("id"),
  CONSTRAINT uq_projects_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_projects_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_projects_parent FOREIGN KEY ("parent_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_projects_code_shape CHECK ("code" ~ '^[A-Za-z0-9_-]{1,20}$'),
  CONSTRAINT ck_projects_name_length CHECK (length("name") BETWEEN 1 AND 200),
  CONSTRAINT ck_projects_status CHECK ("status" IN ('OPEN', 'CLOSED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_projects_tenant_parent ON "projects" ("tenant_id", "parent_id");
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"projects"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- leads (crm-owned; the intake pipeline). No numbering series (leads are
-- not legal documents); conversion links partner_id forever.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leads" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "name" text NOT NULL,
  "name_ar" text,
  "phone" text,
  "email" text,
  "company" text,
  "source" text NOT NULL DEFAULT 'OTHER',
  "status" text NOT NULL DEFAULT 'NEW',
  "lost_reason" text,
  "owner_user_id" uuid,
  "partner_id" uuid,
  "converted_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_leads PRIMARY KEY ("id"),
  CONSTRAINT uq_leads_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_leads_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_leads_source CHECK ("source" IN ('WALK_IN', 'REFERRAL', 'WEBSITE', 'CAMPAIGN', 'CALL', 'OTHER')),
  CONSTRAINT ck_leads_status CHECK ("status" IN ('NEW', 'QUALIFIED', 'CONVERTED', 'LOST')),
  CONSTRAINT ck_leads_lost_requires_reason CHECK ("status" <> 'LOST' OR "lost_reason" IS NOT NULL),
  CONSTRAINT ck_leads_lost_reason_shape CHECK (
    "lost_reason" IS NULL OR char_length("lost_reason") BETWEEN 1 AND 200
  ),
  CONSTRAINT ck_leads_converted_shape CHECK (
    "status" <> 'CONVERTED' OR ("partner_id" IS NOT NULL AND "converted_at" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_leads_tenant_status ON "leads" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_leads_tenant_owner ON "leads" ("tenant_id", "owner_user_id");
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"leads"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- crm_tasks + crm_activities (crm-owned; future work vs logged past).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_tasks" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "title" text NOT NULL,
  "related_type" text NOT NULL,
  "related_id" uuid NOT NULL,
  "assignee_user_id" uuid,
  "due_date" date,
  "remind_at" timestamptz,
  "notified_at" timestamptz,
  "status" text NOT NULL DEFAULT 'OPEN',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_crm_tasks PRIMARY KEY ("id"),
  CONSTRAINT uq_crm_tasks_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_crm_tasks_status CHECK ("status" IN ('OPEN', 'DONE', 'CANCELLED')),
  CONSTRAINT ck_crm_tasks_related_type CHECK ("related_type" IN ('LEAD', 'PARTNER', 'CONTRACT', 'SERVICE_ORDER')),
  CONSTRAINT ck_crm_tasks_title_shape CHECK (length("title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_crm_tasks_tenant_status_due
  ON "crm_tasks" ("tenant_id", "status", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_crm_tasks_tenant_related
  ON "crm_tasks" ("tenant_id", "related_type", "related_id");
--> statement-breakpoint
-- The reminder sweep's scan substrate (the 05:30 cron reads exactly this
-- slice: remindable, not yet notified).
CREATE INDEX IF NOT EXISTS ix_crm_tasks_pending_reminders
  ON "crm_tasks" ("tenant_id", "remind_at")
  WHERE "remind_at" IS NOT NULL AND "notified_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "crm_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"crm_tasks"');

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_activities" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "kind" text NOT NULL,
  "related_type" text NOT NULL,
  "related_id" uuid NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "summary" text NOT NULL,
  "duration_minutes" integer,
  "actor_user_id" uuid,
  CONSTRAINT pk_crm_activities PRIMARY KEY ("id"),
  CONSTRAINT uq_crm_activities_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_crm_activities_kind CHECK ("kind" IN ('CALL', 'MEETING', 'EMAIL', 'NOTE')),
  CONSTRAINT ck_crm_activities_related_type CHECK ("related_type" IN ('LEAD', 'PARTNER', 'CONTRACT', 'SERVICE_ORDER')),
  CONSTRAINT ck_crm_activities_duration CHECK ("duration_minutes" IS NULL OR "duration_minutes" >= 0),
  CONSTRAINT ck_crm_activities_summary_shape CHECK (length("summary") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_crm_activities_tenant_related
  ON "crm_activities" ("tenant_id", "related_type", "related_id", "occurred_at" DESC);
--> statement-breakpoint
ALTER TABLE "crm_activities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"crm_activities"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- service_contracts (crm-owned; the CT- document). NO contract-level
-- fee_item_id column — the schedule rows are the fee-item home (§18
-- lesson 1); the contract posts nothing itself.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_contracts" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "contract_no" text,
  "partner_id" uuid NOT NULL,
  "project_id" uuid,
  "title" text NOT NULL,
  "title_ar" text,
  "scope" text,
  "fee_model" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "monthly_amount" numeric(19,4),
  "currency_code" varchar(3) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "renewed_to_contract_id" uuid,
  "cancel_reason" text,
  "note" text,
  "note_ar" text,
  "activated_at" timestamptz,
  "cancelled_at" timestamptz,
  CONSTRAINT pk_service_contracts PRIMARY KEY ("id"),
  CONSTRAINT uq_service_contracts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_service_contracts_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_service_contracts_project FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_service_contracts_renewal FOREIGN KEY ("renewed_to_contract_id", "tenant_id")
    REFERENCES "service_contracts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_service_contracts_fee_model CHECK ("fee_model" IN ('RETAINER', 'MILESTONES', 'HOURLY')),
  CONSTRAINT ck_service_contracts_status CHECK ("status" IN ('DRAFT', 'ACTIVE', 'CANCELLED', 'RENEWED')),
  CONSTRAINT ck_service_contracts_term CHECK ("end_date" >= "start_date"),
  CONSTRAINT ck_service_contracts_monthly CHECK ("monthly_amount" IS NULL OR "monthly_amount" >= 0),
  CONSTRAINT ck_service_contracts_title_shape CHECK (length("title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_contracts_tenant_no
  ON "service_contracts" ("tenant_id", "contract_no") WHERE "contract_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_service_contracts_tenant_status ON "service_contracts" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_service_contracts_tenant_partner ON "service_contracts" ("tenant_id", "partner_id");
--> statement-breakpoint
ALTER TABLE "service_contracts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"service_contracts"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- contract_billing_schedule (crm-owned; the expanded grid — re-runnable,
-- additive). RETAINER grid = calendar months clipped to the term, billDate
-- = period start (in advance); MILESTONE rows carry their labels; HOURLY
-- periods bill in arrears with amount NULL (computed at the run).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_billing_schedule" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "contract_id" uuid NOT NULL,
  "entry_type" text NOT NULL,
  "period_key" text,
  "period_start" date,
  "period_end" date,
  "bill_date" date NOT NULL,
  "amount" numeric(19,4),
  "fee_item_id" uuid NOT NULL,
  "milestone_label" text,
  "milestone_label_ar" text,
  "status" text NOT NULL DEFAULT 'PLANNED',
  "invoice_id" uuid,
  CONSTRAINT pk_contract_billing_schedule PRIMARY KEY ("id"),
  CONSTRAINT uq_contract_billing_schedule_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_contract_billing_schedule_contract FOREIGN KEY ("contract_id", "tenant_id")
    REFERENCES "service_contracts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_contract_billing_schedule_fee_item FOREIGN KEY ("fee_item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_contract_billing_schedule_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_contract_billing_schedule_entry_type CHECK (
    "entry_type" IN ('RETAINER_PERIOD', 'MILESTONE', 'HOURLY_PERIOD')
  ),
  CONSTRAINT ck_contract_billing_schedule_status CHECK ("status" IN ('PLANNED', 'INVOICED', 'SKIPPED')),
  CONSTRAINT ck_contract_billing_schedule_period_key CHECK (
    "period_key" IS NULL OR "period_key" ~ '^[0-9]{4}-[0-9]{2}$'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_billing_schedule_tenant_entry_period
  ON "contract_billing_schedule" ("tenant_id", "contract_id", "entry_type", "period_key")
  WHERE "period_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_billing_schedule_tenant_milestone
  ON "contract_billing_schedule" ("tenant_id", "contract_id", "milestone_label")
  WHERE "entry_type" = 'MILESTONE';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_contract_billing_schedule_tenant_bill
  ON "contract_billing_schedule" ("tenant_id", "contract_id", "bill_date");
--> statement-breakpoint
ALTER TABLE "contract_billing_schedule" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"contract_billing_schedule"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- contract_invoices (crm-owned; the idempotency guard). The two partial
-- uniques make concurrent double-fire a constraint violation ⇒ graceful
-- skip (INV-013 discipline); the billing run is the only writer.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_invoices" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "contract_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "period_key" text,
  "milestone_schedule_id" uuid,
  "status" text NOT NULL DEFAULT 'GENERATED',
  CONSTRAINT pk_contract_invoices PRIMARY KEY ("id"),
  CONSTRAINT uq_contract_invoices_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_contract_invoices_contract FOREIGN KEY ("contract_id", "tenant_id")
    REFERENCES "service_contracts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_contract_invoices_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_contract_invoices_milestone FOREIGN KEY ("milestone_schedule_id", "tenant_id")
    REFERENCES "contract_billing_schedule" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_contract_invoices_status CHECK ("status" IN ('GENERATED')),
  CONSTRAINT ck_contract_invoices_period_key CHECK (
    "period_key" IS NULL OR "period_key" ~ '^[0-9]{4}-[0-9]{2}$'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_invoices_tenant_period
  ON "contract_invoices" ("tenant_id", "contract_id", "period_key")
  WHERE "period_key" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_invoices_tenant_milestone
  ON "contract_invoices" ("tenant_id", "contract_id", "milestone_schedule_id")
  WHERE "milestone_schedule_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_contract_invoices_tenant_contract ON "contract_invoices" ("tenant_id", "contract_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_contract_invoices_tenant_invoice ON "contract_invoices" ("tenant_id", "invoice_id");
--> statement-breakpoint
ALTER TABLE "contract_invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"contract_invoices"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- contract_advances (crm-owned; on-account receipts tagged to a contract).
-- The journal anchors are plain uuids (no FK — the production fg_journal_id
-- precedent); released_invoice_id links the releasing invoice row.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "contract_advances" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "contract_id" uuid NOT NULL,
  "receipt_id" uuid NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "status" text NOT NULL DEFAULT 'HELD',
  "defer_journal_id" uuid,
  "released_journal_id" uuid,
  "released_invoice_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_contract_advances PRIMARY KEY ("id"),
  CONSTRAINT uq_contract_advances_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_contract_advances_contract FOREIGN KEY ("contract_id", "tenant_id")
    REFERENCES "service_contracts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_contract_advances_receipt FOREIGN KEY ("receipt_id", "tenant_id")
    REFERENCES "receipts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_contract_advances_status CHECK ("status" IN ('HELD', 'RELEASED')),
  CONSTRAINT ck_contract_advances_amount CHECK ("amount" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_contract_advances_tenant_contract_status
  ON "contract_advances" ("tenant_id", "contract_id", "status");
--> statement-breakpoint
ALTER TABLE "contract_advances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"contract_advances"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- service_orders + service_order_lines (crm-owned; the job-card
-- generalization). SO- numbering reserved at creation (docType
-- service_order); parts issue in issue_immediate mode posts the
-- service_order:issue_parts COGS journal — mirroring job cards byte-close.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_orders" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "order_no" text,
  "partner_id" uuid NOT NULL,
  "contract_id" uuid,
  "warehouse_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "note" text,
  "note_ar" text,
  "cancel_reason" text,
  "approved_at" timestamptz,
  "completed_at" timestamptz,
  "invoiced_at" timestamptz,
  "cancelled_at" timestamptz,
  CONSTRAINT pk_service_orders PRIMARY KEY ("id"),
  CONSTRAINT uq_service_orders_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_service_orders_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_service_orders_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_service_orders_contract FOREIGN KEY ("contract_id", "tenant_id")
    REFERENCES "service_contracts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_service_orders_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_service_orders_status CHECK ("status" IN ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'CANCELLED')),
  CONSTRAINT ck_service_orders_cancel_requires_reason CHECK (
    "status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_orders_tenant_no
  ON "service_orders" ("tenant_id", "order_no") WHERE "order_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_service_orders_tenant_status ON "service_orders" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_service_orders_tenant_partner ON "service_orders" ("tenant_id", "partner_id");
--> statement-breakpoint
ALTER TABLE "service_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"service_orders"');

--> statement-breakpoint
-- Tombstone-based lines (no DELETE grant — the job_card_lines shape).
CREATE TABLE IF NOT EXISTS "service_order_lines" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "order_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "line_type" text NOT NULL,
  "item_id" uuid NOT NULL,
  "description" text,
  "description_ar" text,
  "estimated_hours" numeric(19,6),
  "unit_price" numeric(19,6) NOT NULL DEFAULT 0,
  "qty" numeric(19,6) NOT NULL,
  "logged_hours" numeric(19,6) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'PENDING',
  "reservation_id" uuid,
  "issue_unit_cost" numeric(19,6),
  "issue_value" numeric(19,4),
  "issue_journal_id" uuid,
  "invoice_line_id" uuid,
  "note" text,
  CONSTRAINT pk_service_order_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_service_order_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_service_order_lines_order FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "service_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_service_order_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_service_order_lines_type CHECK ("line_type" IN ('SERVICE', 'PARTS')),
  CONSTRAINT ck_service_order_lines_status CHECK ("status" IN ('PENDING', 'RESERVED', 'ISSUED', 'INVOICED', 'VOID')),
  CONSTRAINT ck_service_order_lines_qty CHECK ("qty" > 0),
  CONSTRAINT ck_service_order_lines_hours CHECK ("estimated_hours" IS NULL OR "estimated_hours" >= 0),
  CONSTRAINT ck_service_order_lines_service_shape CHECK (
    "line_type" <> 'SERVICE' OR "estimated_hours" IS NOT NULL
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_order_lines_order_line
  ON "service_order_lines" ("tenant_id", "order_id", "line_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_service_order_lines_tenant_reservation
  ON "service_order_lines" ("tenant_id", "reservation_id") WHERE "reservation_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "service_order_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"service_order_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- crm_time_entries (crm-owned; timeslips). unit_rate is snapshotted at
-- recording (never recomputed); projectId required-when-policy is
-- service-enforced (TIME_ENTRY_CASE_REQUIRED), nullable here.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "crm_time_entries" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "entry_date" date NOT NULL,
  "hours" numeric(19,6) NOT NULL,
  "fee_item_id" uuid NOT NULL,
  "project_id" uuid,
  "contract_id" uuid,
  "fee_earner_user_id" uuid,
  "unit_rate" numeric(19,6) NOT NULL,
  "narrative" text,
  "billable" boolean NOT NULL DEFAULT true,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "billed_invoice_id" uuid,
  CONSTRAINT pk_crm_time_entries PRIMARY KEY ("id"),
  CONSTRAINT uq_crm_time_entries_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_crm_time_entries_fee_item FOREIGN KEY ("fee_item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_crm_time_entries_project FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_crm_time_entries_contract FOREIGN KEY ("contract_id", "tenant_id")
    REFERENCES "service_contracts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_crm_time_entries_invoice FOREIGN KEY ("billed_invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_crm_time_entries_status CHECK ("status" IN ('DRAFT', 'APPROVED', 'BILLED', 'VOID')),
  CONSTRAINT ck_crm_time_entries_hours CHECK ("hours" > 0),
  CONSTRAINT ck_crm_time_entries_rate CHECK ("unit_rate" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_crm_time_entries_tenant_project_date
  ON "crm_time_entries" ("tenant_id", "project_id", "entry_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_crm_time_entries_tenant_status ON "crm_time_entries" ("tenant_id", "status");
--> statement-breakpoint
-- The billing run's pull substrate: APPROVED entries not yet billed.
CREATE INDEX IF NOT EXISTS ix_crm_time_entries_pullable
  ON "crm_time_entries" ("tenant_id", "entry_date")
  WHERE "billed_invoice_id" IS NULL AND "status" = 'APPROVED';
--> statement-breakpoint
ALTER TABLE "crm_time_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"crm_time_entries"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Widenings (additive CHECK re-issues + new nullable columns). The
-- sales_invoices/journal_lines FK targets exist above; notifications and
-- stock_moves domains re-issue per the 0023 pattern.
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm'
  ));
--> statement-breakpoint
ALTER TABLE "stock_moves" DROP CONSTRAINT IF EXISTS ck_stock_moves_source_shape;
--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT ck_stock_moves_source_shape CHECK ("source_type" IN (
  'manual_receipt', 'manual_issue', 'stock_adjustment', 'stock_count', 'stock_transfer',
  'opening_balance_doc', 'method_switch', 'goods_receipt', 'supplier_invoice', 'landed_cost',
  'delivery_note', 'sales_invoice', 'credit_note', 'job_card', 'production_order',
  'service_order'
));
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "contract_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "service_order_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales_invoices" DROP CONSTRAINT IF EXISTS fk_sales_invoices_contract;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT fk_sales_invoices_contract
  FOREIGN KEY ("contract_id", "tenant_id")
  REFERENCES "service_contracts" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "sales_invoices" DROP CONSTRAINT IF EXISTS fk_sales_invoices_service_order;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT fk_sales_invoices_service_order
  FOREIGN KEY ("service_order_id", "tenant_id")
  REFERENCES "service_orders" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "sales_invoices" DROP CONSTRAINT IF EXISTS fk_sales_invoices_project;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT fk_sales_invoices_project
  FOREIGN KEY ("project_id", "tenant_id")
  REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_contract
  ON "sales_invoices" ("tenant_id", "contract_id") WHERE "contract_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_service_order
  ON "sales_invoices" ("tenant_id", "service_order_id") WHERE "service_order_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_project
  ON "sales_invoices" ("tenant_id", "project_id") WHERE "project_id" IS NOT NULL;
--> statement-breakpoint
-- The journal-line project stamp (the cost_center_id byte-template). The
-- manual-journal draft substrate folds into THIS migration (§18 lesson 4)
-- — no separate 0028.
ALTER TABLE "journal_lines" ADD COLUMN IF NOT EXISTS "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "journal_lines" DROP CONSTRAINT IF EXISTS fk_journal_lines_project;
--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT fk_journal_lines_project
  FOREIGN KEY ("project_id", "tenant_id")
  REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_journal_lines_tenant_project ON "journal_lines" ("tenant_id", "project_id");
--> statement-breakpoint
ALTER TABLE "manual_journal_lines" ADD COLUMN IF NOT EXISTS "project_id" uuid;
--> statement-breakpoint
ALTER TABLE "manual_journal_lines" DROP CONSTRAINT IF EXISTS fk_manual_journal_lines_project;
--> statement-breakpoint
ALTER TABLE "manual_journal_lines" ADD CONSTRAINT fk_manual_journal_lines_project
  FOREIGN KEY ("project_id", "tenant_id")
  REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- chart_of_accounts_template: 2130 exists since 0008 as a plain row
-- ('Accrued expenses', purpose NULL) — UPDATED IN PLACE (the 0025
-- 4200/SERVICE_REVENUE precedent) to the deferred-revenue liability with
-- the DEFERRED_REVENUE purpose marker. New tenants provision it at
-- onboarding; existing tenants map once (fail-closed PURPOSE_NOT_MAPPED
-- until then).
--> statement-breakpoint
UPDATE "chart_of_accounts_template" SET
  "name" = 'Deferred revenue', "name_ar" = 'الإيرادات المؤجلة',
  "purpose_key" = 'DEFERRED_REVENUE'
WHERE "code" = '2130' AND "purpose_key" IS NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Template registry seed: the PHASE-019 manifest, verbatim from
-- docs/industries/templates/manifests/manifest.professional_services.json
-- (the canonical source — the §12 doc reconciliation applied: the
-- bom_production N/A entry dropped, partners.ar_aging pinned to the live
-- ar.aging registry key). Idempotent upsert on key; the 0008 index row
-- converges to the full manifest, is_active = true, status = 'ACTIVE'.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest", "is_active", "status") VALUES
  ('industry.professional_services', 'Professional Services', 'المكاتب المهنية', '1.0.0',
   '{
  "id": "industry.professional_services",
  "name": "Professional Services",
  "name_ar": "المكاتب المهنية",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine",
    "items.item_master",
    "crm.service_contracts",
    "crm.recurring_billing",
    "accounting.projects",
    "sales.invoices",
    "partners.statements"
  ],
  "default_modules_enabled": [
    "accounting",
    "partners",
    "items",
    "sales",
    "treasury",
    "tax",
    "reporting",
    "crm",
    "configuration"
  ],
  "terminology_overrides": {
    "svc.case": {
      "en": "Case / Matter",
      "ar": "القضية / الملف"
    },
    "svc.time_entry": {
      "en": "Time entry",
      "ar": "تسجيل الوقت"
    },
    "svc.timesheet": {
      "en": "Timesheet",
      "ar": "كشف الساعات"
    },
    "svc.billable": {
      "en": "Billable",
      "ar": "قابل للفوترة"
    },
    "fee.fixed_fee": {
      "en": "Fixed fee",
      "ar": "أتعاب مقطوعة"
    },
    "fee.hourly": {
      "en": "Hourly fee",
      "ar": "أتعاب بالساعة"
    },
    "fee.retainer": {
      "en": "Retainer",
      "ar": "أتعاب دورية"
    },
    "billing.milestone": {
      "en": "Milestone",
      "ar": "دفعة مرحلية"
    },
    "doc.contract": {
      "en": "Service contract",
      "ar": "عقد الخدمات"
    },
    "acc.project": {
      "en": "Project",
      "ar": "المشروع"
    }
  },
  "navigation_manifest": {
    "groups": [
      {
        "id": "practice",
        "label": {
          "en": "Practice",
          "ar": "المكتب"
        },
        "order": 1,
        "items": [
          {
            "id": "cases",
            "label": {
              "en": "Cases / Projects",
              "ar": "القضايا / المشاريع"
            },
            "target": "accounting.projects"
          },
          {
            "id": "timesheets",
            "label": {
              "en": "Time & timesheets",
              "ar": "الوقت وكشوف الساعات"
            },
            "target": "crm.time"
          },
          {
            "id": "contracts",
            "label": {
              "en": "Service contracts",
              "ar": "عقود الخدمات"
            },
            "target": "crm.contracts"
          }
        ]
      },
      {
        "id": "billing",
        "label": {
          "en": "Billing",
          "ar": "الفوترة"
        },
        "order": 2,
        "items": [
          {
            "id": "recurring",
            "label": {
              "en": "Recurring invoices",
              "ar": "الفواتير الدورية"
            },
            "target": "crm.recurring_billing"
          },
          {
            "id": "invoices",
            "label": {
              "en": "Invoices",
              "ar": "الفواتير"
            },
            "target": "sales.invoices"
          },
          {
            "id": "statements",
            "label": {
              "en": "Client statements",
              "ar": "كشوف حسابات العملاء"
            },
            "target": "partners.statements"
          }
        ]
      }
    ]
  },
  "workflow_policies": {
    "contract_billing_mode": "retainer_or_milestones",
    "time_entries_require_case": true,
    "unbilled_time_review_before_invoice": true,
    "invoice_approval_required": true,
    "invoice_numbering_per_series": false,
    "narrative_required_on_time_billing": true
  },
  "document_numbering_defaults": {
    "contract_invoice": {
      "prefix": "INV",
      "format": "INV-{yyyy}-{seq:6}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "sales_invoice": {
      "prefix": "INV",
      "format": "INV-{yyyy}-{seq:6}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "receipt": {
      "prefix": "RCP",
      "format": "RCP-{yyyy}-{seq:6}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "credit_note": {
      "prefix": "CN",
      "format": "CN-{yyyy}-{seq:5}",
      "per_branch": false,
      "reserve_on_approval": false
    }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC",
    "default_track_batch": false,
    "default_track_expiry": false,
    "default_track_serial": false,
    "default_imei_tracking": false,
    "fefo_picking": false,
    "allow_negative_stock": false
  },
  "report_defaults": [
    {
      "report_key": "services.contract_revenue_schedule",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_month"
    },
    {
      "report_key": "services.time_billing_summary",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_month"
    },
    {
      "report_key": "ar.aging",
      "pinned": true,
      "dashboard": false,
      "default_period": "this_month"
    },
    {
      "report_key": "sales.commissions_due",
      "pinned": true,
      "dashboard": false,
      "default_period": "this_month"
    }
  ],
  "onboarding_steps": [
    {
      "id": "coa_confirm",
      "title": {
        "en": "Confirm chart of accounts (fee revenue natures)",
        "ar": "تأكيد دليل الحسابات (طبيعة إيرادات الأتعاب)"
      },
      "required": true
    },
    {
      "id": "clients",
      "title": {
        "en": "Clients & engagement contacts",
        "ar": "العملاء وجهات التعامل"
      },
      "required": true
    },
    {
      "id": "fee_items",
      "title": {
        "en": "Fee items (hourly, fixed, disbursements)",
        "ar": "بنود الأتعاب (بالساعة، مقطوعة، مصروفات نائبة)"
      },
      "required": true
    },
    {
      "id": "first_contract",
      "title": {
        "en": "First service contract",
        "ar": "أول عقد خدمات"
      },
      "required": true
    },
    {
      "id": "billing_run",
      "title": {
        "en": "Run first recurring billing cycle",
        "ar": "تشغيل أول دورة فوترة دورية"
      },
      "required": false
    },
    {
      "id": "projects",
      "title": {
        "en": "Open projects/cases",
        "ar": "فتح المشاريع/القضايا"
      },
      "required": false
    }
  ],
  "capability_prerequisites": {
    "service_contracts": {
      "level": "REQUIRED",
      "feature_keys": [
        "crm.service_contracts"
      ],
      "available_from_phase": "PHASE-019"
    },
    "recurring_billing": {
      "level": "REQUIRED",
      "feature_keys": [
        "crm.recurring_billing"
      ],
      "available_from_phase": "PHASE-019"
    },
    "deposits_late_fees": {
      "level": "OPTIONAL",
      "feature_keys": [
        "crm.contract_deposits",
        "crm.late_fees"
      ],
      "available_from_phase": "PHASE-019"
    },
    "commissions": {
      "level": "OPTIONAL",
      "feature_keys": [
        "sales.commissions"
      ],
      "available_from_phase": "PHASE-017"
    },
    "job_cards": {
      "level": "OPTIONAL",
      "feature_keys": [
        "sales.job_cards"
      ],
      "available_from_phase": "PHASE-017"
    }
  }
}'::jsonb, true, 'ACTIVE')
ON CONFLICT ("key") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "version" = EXCLUDED."version", "manifest" = EXCLUDED."manifest",
      "is_active" = true, "status" = 'ACTIVE';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Permission seeds (AUTHORIZATION_MATRIX §3.8/§3.1; the drift checker
-- requires matrix ↔ seed parity). Five keys re-assert the 0004 base seed
-- (idempotent upsert); crm.contracts.bill and accounting.projects.manage
-- are new.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('crm.leads.manage', 'crm', 'CRM basics (PHASE-019) / إدارة علاقات العملاء'),
('crm.tasks.manage', 'crm', 'CRM basics (PHASE-019) / إدارة علاقات العملاء'),
('crm.activities.manage', 'crm', 'CRM basics (PHASE-019) / إدارة علاقات العملاء'),
('crm.contracts.manage', 'crm', 'Service contracts & orders / العقود وأوامر الخدمة'),
('crm.contracts.bill', 'crm', 'Run recurring billing runs / تشغيل دورات الفوترة الدورية'),
('crm.service_orders.manage', 'crm', 'Service contracts & orders / العقود وأوامر الخدمة'),
('accounting.projects.manage', 'accounting', 'Maintain the projects dimension / إدارة بُعد المشاريع')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Plan grants (FEATURE_CATALOG §25 protocol step 3): the PHASE-019 set
-- joins business + enterprise. Enterprise already carries the six keys
-- from the 0008 base seed, so the guard makes it a no-op there; starter
-- does NOT get them. Idempotent array_cat.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['crm.leads', 'crm.tasks_activities', 'crm.service_contracts',
        'crm.recurring_billing', 'crm.service_orders', 'accounting.projects'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('crm.leads' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- System role-template grants (the 0005 cross-join predates the 0027
-- keys): owner gains the full set; sales gains the intake tier; the
-- accountant gains the billing + projects tier.
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'crm.leads.manage', 'crm.tasks.manage', 'crm.activities.manage',
  'crm.contracts.manage', 'crm.contracts.bill', 'crm.service_orders.manage',
  'accounting.projects.manage'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'crm.leads.manage', 'crm.tasks.manage', 'crm.activities.manage'
)
WHERE r."key" = 'sales' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'crm.contracts.bill', 'accounting.projects.manage'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- Grants (erp_app writes; erp_readonly reads; erp_definer read surface).
-- All eleven tables are draft/status-lifecycled — NO DELETE grants
-- anywhere (tombstones and status flips carry the lifecycle; the
-- manual-journal/bom draft-replace deletes predate this phase). The new
-- columns on widened tables ride their existing table-level grants.
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "leads", "crm_tasks", "crm_activities",
  "service_contracts", "contract_billing_schedule", "contract_invoices",
  "contract_advances", "service_orders", "service_order_lines",
  "crm_time_entries", "projects" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "leads", "crm_tasks", "crm_activities", "service_contracts",
  "contract_billing_schedule", "contract_invoices", "contract_advances",
  "service_orders", "service_order_lines", "crm_time_entries", "projects"
  TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "leads", "crm_tasks", "crm_activities", "service_contracts",
  "contract_billing_schedule", "contract_invoices", "contract_advances",
  "service_orders", "service_order_lines", "crm_time_entries", "projects"
  TO erp_definer;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 27)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
