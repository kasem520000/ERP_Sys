-- PHASE-013 · migration 0020 · reporting engine core
--
-- Purpose (PHASE-013 §2.1–§2.3, §4; ADR-0011; REPORTING_ARCHITECTURE §1):
-- the reporting module owns exactly TWO tables and zero business data —
-- `report_runs` (execution orchestration: one row per
-- (tenant, report_key, params_hash) — re-runs replace their own artifacts,
-- never duplicate; the stored result envelope is the export source of truth:
-- "you print what you saw") and `print_templates` (the per-tenant registry
-- of the four versioned base templates shipped in packages/ui/print —
-- tenants never author templates, the registry records the version in use).
--
-- All business truth stays in the owning modules: reports read through
-- module-owned authorized query services only (MODULE_BOUNDARIES §"reporting";
-- RISK-016) — enforced by the provenance boot-check + boundary lint.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Report runs: the execution record (REPORTING_ARCHITECTURE §3).
-- status lifecycle: QUEUED → RUNNING → SUCCEEDED | FAILED (inline runs skip
-- QUEUED). assertion_status records the executable self-check outcome
-- (REPORT_RECONCILIATION §1 — FAIL stores the result + blocks exports
-- server-side; it is NOT a run failure: the viewer must render the banner).
CREATE TABLE IF NOT EXISTS "report_runs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "report_key" text NOT NULL,
  "contract_version" integer NOT NULL,
  "params" jsonb NOT NULL,
  "params_hash" text NOT NULL,
  "execution_class" text NOT NULL,
  "status" text NOT NULL DEFAULT 'QUEUED',
  "stage" text,
  "requested_by" uuid,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "duration_ms" integer,
  "error_code" text,
  "error_detail" jsonb,
  "assertion_status" text,
  "result" jsonb,
  "assertions" jsonb,
  "artifacts" jsonb,
  "correlation_id" text,
  CONSTRAINT pk_report_runs PRIMARY KEY ("id"),
  CONSTRAINT uq_report_runs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_report_runs_tenant_key_params UNIQUE ("tenant_id", "report_key", "params_hash"),
  CONSTRAINT ck_report_runs_status_values CHECK (
    "status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')
  ),
  CONSTRAINT ck_report_runs_exec_class CHECK ("execution_class" IN ('inline', 'job')),
  CONSTRAINT ck_report_runs_assertion CHECK (
    "assertion_status" IS NULL OR "assertion_status" IN ('PASS', 'FAIL')
  ),
  CONSTRAINT ck_report_runs_contract_version CHECK ("contract_version" >= 1),
  CONSTRAINT ck_report_runs_finished_requires_started CHECK (
    "finished_at" IS NULL OR "started_at" IS NOT NULL
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_report_runs_tenant_created
  ON "report_runs" ("tenant_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_report_runs_tenant_requested_by
  ON "report_runs" ("tenant_id", "requested_by", "created_at" DESC);

--> statement-breakpoint
-- Print templates: per-tenant registry of the four versioned base templates
-- (PRINTING_AND_EXPORT §1). Rows are synced from the code-defined catalog
-- (packages/ui/print) by the reporting module — idempotent upsert; tenants
-- pick locale variants, they never author template logic.
CREATE TABLE IF NOT EXISTS "print_templates" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "key" text NOT NULL,
  "version" integer NOT NULL,
  "locale_variants" jsonb NOT NULL,
  "metadata" jsonb,
  CONSTRAINT pk_print_templates PRIMARY KEY ("id"),
  CONSTRAINT uq_print_templates_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_print_templates_tenant_key UNIQUE ("tenant_id", "key"),
  CONSTRAINT ck_print_templates_key_values CHECK (
    "key" IN ('a4-document', 'a4-report', 'receipt-80', 'receipt-58')
  ),
  CONSTRAINT ck_print_templates_version CHECK ("version" >= 1)
);

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2).
SELECT erp.apply_tenant_policy('"report_runs"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"print_templates"');

--> statement-breakpoint
-- Grants: runs are orchestration state (executor inserts + updates status in
-- place; no DELETE — the run history is append-mostly evidence); templates
-- are registry rows (select/insert/update for the idempotent sync).
REVOKE ALL ON "report_runs", "print_templates" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "report_runs" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "print_templates" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "report_runs", "print_templates" TO erp_readonly;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "report_runs", "print_templates" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 20)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
