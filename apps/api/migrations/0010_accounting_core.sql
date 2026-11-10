-- PHASE-007 · migration 0010 · accounting core (fiscal calendar, FX, cost
-- centers, recurring journals, approval policies, numbering store)
--
-- Purpose (PHASE-007 §2.1–§2.3, §2.9–§2.10; TABLES/core-accounting.md):
-- - fiscal_years + fiscal_periods (12 monthly REGULAR periods + special
--   OPENING [start−1d] and CLOSING [end] periods; no-overlap exclusion
--   among REGULAR periods via btree_gist; states OPEN/SOFT_CLOSED/LOCKED;
--   reopen audit columns for INV-020)
-- - exchange_rates (dated, base-per-1-foreign, MANUAL|IMPORTED — INV-008)
-- - cost_centers (basic tree, INV/analytical dimension)
-- - recurring_journals (template JSONB + schedule + next-run; generation
--   is a pg-boss job that creates DRAFT manual journals only)
-- - approval_policies (per-doc-type versioned policy rows; BR-034)
-- - numbering_sequences + number_assignments (ADR-0006 store: per-(tenant,
--   branch, type, period) sequences with atomic upsert-increment — CC-03 —
--   plus the assignment ledger whose rows make voided numbers reserved
--   forever, INV-021)
--
-- The journal tables (journal_entries/journal_lines + manual-journal drafts
-- + partner subledger + reconciliation runs) are migration 0011.
--
-- Doc-reality reconciliation (recorded in the completion report): the phase
-- document's T1 names this file 0007_accounting_core.sql; migrations
-- 0007–0009 already exist (PHASE-004/006), so the chain continues at 0010.
--
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- btree_gist: uuid equality inside the periods exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

--> statement-breakpoint
-- Fiscal years (TABLES §fiscal_years): tenant accounting years, Gregorian
-- (A-004); uq name per tenant makes creation idempotent by label; status
-- OPEN|CLOSED flips at year-end close (PERIOD_CLOSING §3).
CREATE TABLE IF NOT EXISTS "fiscal_years" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "name" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  CONSTRAINT pk_fiscal_years PRIMARY KEY ("id"),
  CONSTRAINT uq_fiscal_years_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_fiscal_years_tenant_name UNIQUE ("tenant_id", "name"),
  CONSTRAINT ck_fiscal_years_status_values CHECK ("status" IN ('OPEN', 'CLOSED')),
  CONSTRAINT ck_fiscal_years_window CHECK ("start_date" <= "end_date"),
  CONSTRAINT ck_fiscal_years_name_length CHECK (length("name") BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_fiscal_years_tenant_window ON "fiscal_years" ("tenant_id", "start_date", "end_date");

--> statement-breakpoint
-- Fiscal periods (TABLES §fiscal_periods): REGULAR months + special
-- OPENING/CLOSING windows. tenant_id denormalized (RLS scope derives via
-- year). Exclusion applies among REGULAR periods (the special windows may
-- share the year-end date with December by design: date resolution prefers
-- REGULAR; specials are addressed explicitly by the opening posting and the
-- year-end close). Reopen columns carry INV-020's audited path.
CREATE TABLE IF NOT EXISTS "fiscal_periods" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "fiscal_year_id" uuid NOT NULL,
  "name" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'REGULAR',
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "closed_at" timestamptz,
  "closed_by" uuid,
  "reopened_at" timestamptz,
  "reopened_by" uuid,
  "reopen_reason" text,
  CONSTRAINT pk_fiscal_periods PRIMARY KEY ("id"),
  CONSTRAINT uq_fiscal_periods_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_fiscal_periods_year FOREIGN KEY ("fiscal_year_id", "tenant_id")
    REFERENCES "fiscal_years" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_fiscal_periods_kind_values CHECK ("kind" IN ('REGULAR', 'OPENING', 'CLOSING')),
  CONSTRAINT ck_fiscal_periods_status_values CHECK ("status" IN ('OPEN', 'SOFT_CLOSED', 'LOCKED')),
  CONSTRAINT ck_fiscal_periods_window CHECK ("start_date" <= "end_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_fiscal_periods_tenant_dates ON "fiscal_periods" ("tenant_id", "start_date", "end_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_fiscal_periods_tenant_year ON "fiscal_periods" ("tenant_id", "fiscal_year_id");
--> statement-breakpoint
-- One special period per year: the DEFERRABLE unique above keeps REGULAR
-- rows unconstrained; this partial variant is the service-facing guard for
-- specials at insert time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_periods_special_kind
  ON "fiscal_periods" ("fiscal_year_id", "kind") WHERE "kind" <> 'REGULAR';
--> statement-breakpoint
-- No overlapping REGULAR periods per tenant (exclusion constraint via
-- btree_gist; PERIOD_CLOSING §1).
ALTER TABLE "fiscal_periods" DROP CONSTRAINT IF EXISTS excl_fiscal_periods_no_overlap;
--> statement-breakpoint
ALTER TABLE "fiscal_periods" ADD CONSTRAINT excl_fiscal_periods_no_overlap
  EXCLUDE USING gist (
    "tenant_id" WITH =,
    daterange("start_date", "end_date", '[]') WITH &&
  ) WHERE ("kind" = 'REGULAR');

--> statement-breakpoint
-- Dated exchange rates (TABLES §exchange_rates; CURRENCY_AND_PRECISION §5):
-- rate is BASE per 1 FOREIGN (multiply doc amounts by it), > 0 (INV-008),
-- one row per (tenant, currency, date) — supersede by UPDATE, never delete.
CREATE TABLE IF NOT EXISTS "exchange_rates" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "rate_date" date NOT NULL,
  "rate" numeric(19,8) NOT NULL,
  "source" text NOT NULL DEFAULT 'MANUAL',
  CONSTRAINT pk_exchange_rates PRIMARY KEY ("id"),
  CONSTRAINT uq_exchange_rates_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_exchange_rates_tenant_currency_date UNIQUE ("tenant_id", "currency_code", "rate_date"),
  CONSTRAINT ck_exchange_rates_rate_positive CHECK ("rate" > 0),
  CONSTRAINT ck_exchange_rates_source_values CHECK ("source" IN ('MANUAL', 'IMPORTED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_exchange_rates_tenant_currency_date
  ON "exchange_rates" ("tenant_id", "currency_code", "rate_date" DESC);

--> statement-breakpoint
-- Cost centers (TABLES §cost_centers): analytical dimension; inactive
-- centers reject new journal lines (service rule); tree stays acyclic.
CREATE TABLE IF NOT EXISTS "cost_centers" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "parent_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_cost_centers PRIMARY KEY ("id"),
  CONSTRAINT uq_cost_centers_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_cost_centers_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_cost_centers_parent FOREIGN KEY ("parent_id", "tenant_id")
    REFERENCES "cost_centers" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_cost_centers_code_shape CHECK ("code" ~ '^[A-Za-z0-9_-]{1,20}$'),
  CONSTRAINT ck_cost_centers_name_length CHECK (length("name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_cost_centers_tenant_parent ON "cost_centers" ("tenant_id", "parent_id");

--> statement-breakpoint
-- Recurring journals (TABLES §recurring_journals; JOURNAL_RULES §2): the
-- template JSONB carries the draft-entry payload (accounts/directions,
-- fixed amounts or re-enter policy) — the generated artifact is a real
-- manual-journal DRAFT; the pg-boss job NEVER posts directly.
CREATE TABLE IF NOT EXISTS "recurring_journals" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "name" text NOT NULL,
  "template" jsonb NOT NULL,
  "schedule" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date,
  "next_run_date" date NOT NULL,
  "last_run_at" timestamptz,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_recurring_journals PRIMARY KEY ("id"),
  CONSTRAINT uq_recurring_journals_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_recurring_journals_status_values CHECK ("status" IN ('ACTIVE', 'PAUSED')),
  CONSTRAINT ck_recurring_journals_schedule_values CHECK ("schedule" IN ('MONTHLY', 'WEEKLY', 'DAILY', 'QUARTERLY', 'YEARLY')),
  CONSTRAINT ck_recurring_journals_window CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
  CONSTRAINT ck_recurring_journals_name_length CHECK (length("name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_recurring_journals_tenant_due ON "recurring_journals" ("tenant_id", "status", "next_run_date");

--> statement-breakpoint
-- Approval policies (TABLES §approval_policies; JOURNAL_RULES §3 + BR-034):
-- per doc type, versioned by applies_from; the JSONB policy carries the
-- mode (none|single-approver|two-step|amount-threshold), the base-currency
-- threshold and allow_self_approval (default false — SoD server-enforced).
CREATE TABLE IF NOT EXISTS "approval_policies" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "doc_type" text NOT NULL,
  "policy" jsonb NOT NULL,
  "applies_from" date NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_approval_policies PRIMARY KEY ("id"),
  CONSTRAINT uq_approval_policies_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_approval_policies_tenant_type_from UNIQUE ("tenant_id", "doc_type", "applies_from"),
  CONSTRAINT ck_approval_policies_doc_type_shape CHECK ("doc_type" ~ '^[a-z_]{3,40}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_approval_policies_tenant_type ON "approval_policies" ("tenant_id", "doc_type", "applies_from" DESC);

--> statement-breakpoint
-- Numbering store (ADR-0006; PHASE-007 T13/BR-029/INV-021): per-(tenant,
-- branch, doc type, period) sequences with the canonical atomic
-- upsert-increment (INSERT .. ON CONFLICT DO UPDATE RETURNING) — 50
-- parallel acquirers serialize on the row update without deadlocks (CC-03).
-- branch_id/period_key are nullable; COALESCE sentinels make the unique
-- expression index treat NULL as a real key so ON CONFLICT always matches.
CREATE TABLE IF NOT EXISTS "numbering_sequences" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "doc_type" text NOT NULL,
  "branch_id" uuid,
  "period_key" text,
  "next_value" bigint NOT NULL DEFAULT 1,
  "format" text NOT NULL DEFAULT '{PREFIX}-{SEQ:6}',
  CONSTRAINT pk_numbering_sequences PRIMARY KEY ("id"),
  CONSTRAINT uq_numbering_sequences_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_numbering_sequences_doc_type_shape CHECK ("doc_type" ~ '^[a-z_]{3,40}$'),
  CONSTRAINT ck_numbering_sequences_next CHECK ("next_value" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_numbering_sequences_scope
  ON "numbering_sequences" (
    "tenant_id", "doc_type",
    COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE("period_key", '')
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_numbering_sequences_tenant ON "numbering_sequences" ("tenant_id");

--> statement-breakpoint
-- Number assignments (the numbering audit ledger): every rendered official
-- number is recorded here with its sequence value + owning document; voided
-- rows are tombstoned (voided_at) and NEVER deleted or reused — INV-021's
-- "voided numbers remain reserved" is uniqueness over surviving rows.
CREATE TABLE IF NOT EXISTS "number_assignments" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "doc_type" text NOT NULL,
  "branch_id" uuid,
  "period_key" text,
  "number" text NOT NULL,
  "value" bigint NOT NULL,
  "document_id" uuid,
  "voided_at" timestamptz,
  "voided_by" uuid,
  CONSTRAINT pk_number_assignments PRIMARY KEY ("id"),
  CONSTRAINT uq_number_assignments_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_number_assignments_value CHECK ("value" >= 1),
  CONSTRAINT ck_number_assignments_number_length CHECK (length("number") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_number_assignments_scope_number
  ON "number_assignments" (
    "tenant_id", "doc_type",
    COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid),
    "number"
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_number_assignments_tenant_doc ON "number_assignments" ("tenant_id", "doc_type", "created_at");

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): standard macro on all eight tenant-owned tables.
SELECT erp.apply_tenant_policy('"fiscal_years"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"fiscal_periods"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"exchange_rates"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"cost_centers"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"recurring_journals"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"approval_policies"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"numbering_sequences"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"number_assignments"');

--> statement-breakpoint
-- Grants: calendar/config/dimension tables are INSERT/UPDATE (state
-- transitions, supersede-by-update; RESTRICT + lifecycle make DELETE
-- structurally unnecessary). number_assignments is append-style: rows are
-- inserted and (only) void-tombstoned — UPDATE carries the void path.
REVOKE ALL ON "fiscal_years", "fiscal_periods", "exchange_rates", "cost_centers",
  "recurring_journals", "approval_policies", "numbering_sequences",
  "number_assignments" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fiscal_years" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "fiscal_periods" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "exchange_rates" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cost_centers" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "recurring_journals" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "approval_policies" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "numbering_sequences" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "number_assignments" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "fiscal_years", "fiscal_periods", "exchange_rates", "cost_centers",
  "recurring_journals", "approval_policies", "numbering_sequences",
  "number_assignments" TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (support-access read-all proxy composition, as 0007/0009).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "fiscal_years", "fiscal_periods", "exchange_rates", "cost_centers",
  "recurring_journals", "approval_policies", "numbering_sequences",
  "number_assignments" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 10)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
