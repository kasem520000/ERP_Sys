-- PHASE-028 · migration 0042 · budgeting (budgets & variance control)
--
-- Purpose (PHASE-028 §4 Design Impact + DR-004/ED-04): the budgeting module
-- lands per the option-A decision — two tenant-owned tables (versioned
-- budgets + period-level budget lines), all RLS'd with composite tenant
-- FKs. Budgets are NOT ledger documents: no journal rules, no goldens, no
-- CoA purposes, no reconciliation kinds, no cash_movements sources — the
-- module is a planning + variance layer that READS the GL and can never
-- write it (ADR-0007 monopoly untouched; INV-022 is the boundary).
--
-- BR-050 (the phase's core DB invariant): at most one ACTIVE budget
-- version per (fiscal year, scope) — the partial unique index
-- uq_budgets_one_active WHERE status = 'ACTIVE'. Revisions supersede
-- (new DRAFT with supersedes_id chain + copied lines), never edit; the
-- predecessor flips ACTIVE → REVISED only at the successor's activation,
-- atomically in one transaction (the service orders UPDATE-old-then-
-- INSERT-new under the partial unique's race guarantee).
--
-- State machine (budget_status §9): DRAFT → PENDING_APPROVAL → ACTIVE →
-- REVISED | CLOSED. Shape CHECKs (the 0038 lesson — encode exactly what
-- the machine produces, one-directional where a state carries both pre-
-- and post-stamp shapes):
--   ck_budgets_approved_shape  — status='DRAFT' ⇒ approved_at IS NULL
--     (approve() stamps approved_at while status is STILL
--     PENDING_APPROVAL — pre- and post-approval both live there, so the
--     implication runs one way only);
--   ck_budgets_activated_shape — (status IN ACTIVE/REVISED/CLOSED) =
--     (activated_at IS NOT NULL) — bidirectional: the machine only ever
--     sets REVISED/CLOSED from an ACTIVE (hence activated) row;
--   ck_budgets_closed_shape    — (status='CLOSED') = (closed_at IS NOT
--     NULL).
-- budget_lines are mutable ONLY while the parent budget is DRAFT — the
-- service-level discipline (409 IMMUTABLE_DOCUMENT on non-DRAFT bulk
-- replace); no append-only grants here: this is planning data, and
-- REVISED/CLOSED versions freeze rows at the version level (grants carry
-- DELETE for the DRAFT bulk-replace path only — the service never deletes
-- a non-DRAFT parent's lines).
--
-- Budget codes are tenant-scoped natural keys (DATA_DICTIONARY §12):
-- BUD-<year>-<seq> minted per (fiscal year, scope) monotonic from the
-- module's store — a budget is planning data, not a document; NO official
-- numbering-sequence is fabricated (ADR-0006).
--
-- Notifications (§8c): the category CHECK widens with 'budgeting' (the
-- 0023/0027/0035 pattern) — the advisory control warnings (BR-051) and
-- the at/over-threshold sweep surface.
--
-- Plan grants (§9): the six §22 feature keys join business + enterprise
-- (the tier-4 financial-depth precedent — fixed_assets 0037, notes/
-- installments 0038); starter does NOT get them.
--
-- Permissions: NOTHING to seed — the §3.13 keys (budgeting.budgets.
-- view|create|approve|activate + budgeting.reports.view) already live in
-- 0004/0005 (the docs-as-contract head start; drift stays 245=245).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. budgets (T2): the version register. scope budget_scope §9 (ACCOUNTS,
-- COST_CENTERS, PROJECTS, BRANCHES — scope is a filter, not a fork);
-- revision_no (NOT "version" — the standard optimistic-lock integer owns
-- that name) counts the supersede chain depth (1 = original);
-- supersedes_id links the revision to its predecessor (composite tenant
-- FK, same-(year,scope) enforced at the service level); code is the
-- tenant-scoped natural key (BUD-<year>-<seq>, DATA_DICTIONARY §12 — no
-- official numbers: a budget is planning data, not a document, ADR-0006);
-- lifecycle stamps (submitted/approved/activated/closed _at/_by) with the
-- shape CHECKs above; bilingual name + memo.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budgets" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "fiscal_year_id" uuid NOT NULL,
  "scope" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "revision_no" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "supersedes_id" uuid,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "activated_at" timestamptz,
  "activated_by" uuid,
  "closed_at" timestamptz,
  "closed_by" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_budgets PRIMARY KEY ("id"),
  CONSTRAINT uq_budgets_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_budgets_fiscal_year FOREIGN KEY ("fiscal_year_id", "tenant_id")
    REFERENCES "fiscal_years" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_budgets_supersedes FOREIGN KEY ("supersedes_id", "tenant_id")
    REFERENCES "budgets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_budgets_scope_values CHECK ("scope" IN ('ACCOUNTS', 'COST_CENTERS', 'PROJECTS', 'BRANCHES')),
  CONSTRAINT ck_budgets_status_values CHECK ("status" IN
    ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'REVISED', 'CLOSED')),
  CONSTRAINT ck_budgets_revision CHECK ("revision_no" >= 1),
  CONSTRAINT ck_budgets_approved_shape CHECK (
    NOT ("status" = 'DRAFT' AND "approved_at" IS NOT NULL)),
  CONSTRAINT ck_budgets_activated_shape CHECK (
    ("status" IN ('ACTIVE', 'REVISED', 'CLOSED')) = ("activated_at" IS NOT NULL)),
  CONSTRAINT ck_budgets_closed_shape CHECK (
    ("status" = 'CLOSED') = ("closed_at" IS NOT NULL)),
  CONSTRAINT ck_budgets_code CHECK ("code" ~ '^BUD-[0-9]{4}-[0-9]{1,6}$')
);
--> statement-breakpoint
-- BR-050 (the phase's core DB invariant): exactly one ACTIVE version per
-- (tenant, fiscal year, scope). The listing index doubles as the
-- activation-path guard pair.
CREATE UNIQUE INDEX IF NOT EXISTS uq_budgets_one_active
  ON "budgets" ("tenant_id", "fiscal_year_id", "scope")
  WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_budgets_tenant_year_scope_status
  ON "budgets" ("tenant_id", "fiscal_year_id", "scope", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_budgets_tenant_supersedes
  ON "budgets" ("tenant_id", "supersedes_id");
--> statement-breakpoint
COMMENT ON TABLE "budgets" IS
  'PHASE-028 T2: the versioned budget register — scope budget_scope §9 (ACCOUNTS/COST_CENTERS/PROJECTS/BRANCHES), the DRAFT → PENDING_APPROVAL → ACTIVE → REVISED/CLOSED lifecycle with SoD approval (budgeting.budgets.approve), and the BR-050 partial unique (one ACTIVE per tenant/year/scope). Revisions supersede via supersedes_id + copied lines, never edit. Budgets are NOT ledger documents (DR-004): zero journal rules, zero goldens, structurally ledger-incapable.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. budget_lines (T3): the period grid. One row per (dimension key ×
-- fiscal period) — 12 rows per account for a standard year (the grid
-- adapts to the tenant's actual period count). Dimensions: account_id
-- REQUIRED; cost_center_id/project_id/branch_id optional per scope (the
-- scope decides which dimension keys the grid groups by — scope is a
-- filter, not a fork). amount 19,4 (ADR-0009) non-negative. Every period
-- row must belong to the budget's fiscal_year_id (typed
-- BUDGET_PERIOD_MISMATCH at the service; the composite FK keeps the
-- period tenant-true). Mutable only while the parent is DRAFT (service
-- discipline + 409 IMMUTABLE_DOCUMENT).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "budget_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "budget_id" uuid NOT NULL,
  "fiscal_period_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "cost_center_id" uuid,
  "project_id" uuid,
  "branch_id" uuid,
  "amount" numeric(19,4) NOT NULL,
  CONSTRAINT pk_budget_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_budget_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_budget_lines_budget FOREIGN KEY ("budget_id", "tenant_id")
    REFERENCES "budgets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_budget_lines_period FOREIGN KEY ("fiscal_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_budget_lines_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_budget_lines_cost_center FOREIGN KEY ("cost_center_id", "tenant_id")
    REFERENCES "cost_centers" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_budget_lines_project FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_budget_lines_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_budget_lines_amount CHECK ("amount" >= 0)
);
--> statement-breakpoint
-- The §4 performance index (consumption queries bounded by (tenant,
-- fiscal_period, account)); the budget grid read; the dimension drill.
CREATE INDEX IF NOT EXISTS ix_budget_lines_tenant_period_account
  ON "budget_lines" ("tenant_id", "fiscal_period_id", "account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_budget_lines_tenant_budget
  ON "budget_lines" ("tenant_id", "budget_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_budget_lines_tenant_dimensions
  ON "budget_lines" ("tenant_id", "cost_center_id", "project_id", "branch_id");
--> statement-breakpoint
COMMENT ON TABLE "budget_lines" IS
  'PHASE-028 T3: the period grid — one row per (dimension key × fiscal period), amount 19,4 (ADR-0009). account_id REQUIRED; cost_center/project/branch optional per scope. Period must belong to the parent budget''s fiscal year (service-validated, BUDGET_PERIOD_MISMATCH). Mutable only while the parent is DRAFT (409 IMMUTABLE_DOCUMENT on non-DRAFT replace); REVISED/CLOSED versions freeze rows at the version level.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS (TENANT_ISOLATION §2): the house macro on every new tenant-owned
-- table.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"budgets"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"budget_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6b. Purge path (the 0036/0037/0038 discipline): every new tenant table
-- gains the erp_migrate DELETE/UPDATE policies confined to the GUC-named
-- tenant.
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budgets', 'budget_lines']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS purge_path_delete ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS purge_path_update ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY purge_path_delete ON public.%I FOR DELETE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id())', t);
    EXECUTE format(
      'CREATE POLICY purge_path_update ON public.%I FOR UPDATE TO erp_migrate '
        || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)', t);
  END LOOP;
END $$;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Grants (per-table shapes):
--  - budgets: INSERT/UPDATE/SELECT (create + lifecycle transitions + the
--    supersede flip; NO DELETE — the version chain is audited history,
--    REVISED/CLOSED stay readable for variance truth);
--  - budget_lines: INSERT/UPDATE/SELECT/DELETE — DELETE exists for the
--    DRAFT bulk-replace path (the grid rewrites a draft's lines whole;
--    the service confines deletes to DRAFT parents and never deletes
--    after activation — the version-freeze discipline is service-level,
--    documented in the TABLES spec);
--> statement-breakpoint
REVOKE ALL ON "budgets", "budget_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "budgets" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "budget_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "budgets", "budget_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "budgets", "budget_lines" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8c. Notification categories (the 0023/0027/0035 widening pattern):
-- 'budgeting' — the advisory overspend warnings (BR-051: notification +
-- banner at/over budget) and the at/over-threshold sweep surface.
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing', 'notes', 'installments', 'budgeting'
  ));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. Plan grants (FEATURE_CATALOG §22 protocol step 3): the six
-- PHASE-028 feature keys join business + enterprise (the tier-4
-- financial-depth precedent — fixed_assets 0037, notes/installments
-- 0038); starter does NOT get them. Idempotent array_cat.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['budgeting.budgets', 'budgeting.cost_center_budgets', 'budgeting.project_budgets',
        'budgeting.approvals', 'budgeting.controls', 'budgeting.reports'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('budgeting.budgets' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 42)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
