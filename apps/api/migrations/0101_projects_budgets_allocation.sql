-- PHASE-048 (Blueprint v3.0 · CR-18) · migration 0101 · Projects &
-- Contracting (part 2: budgets + resource allocations, T-02 — PR-01/PR-03).
--
--   project_budgets (D-04/T-06 — PR-01) — the project cost-plan header by
--     the 028 budgeting register's shape: the versioned DRAFT→APPROVED→
--     CLOSED lifecycle (approval precedes every EVM effect — PV reads the
--     APPROVED curve, D-06), the bilingual name, the revision-free first
--     cut (the 028 supersedes chain stays the GL-plane's; the project
--     plane re-baselines through change orders, D-07). NO delete grant
--     (the 028 budgets precedent: the approved curve is the variance
--     truth — CLOSED stays readable).
--   project_budget_lines (D-04) — the cost curve's cells: one row per
--     (budget × cost type × WBS node × period window), the planned
--     amount in ADR-0009 money (numeric(19,4), never binary float).
--     DELETE granted for the DRAFT bulk-replace path (the 028
--     budget_lines precedent — the service never deletes a non-DRAFT
--     parent's lines). The four cost types are the collectors' axes
--     (D-05: LABOR/MATERIAL/SUBCONTRACT/OVERHEAD).
--   project_resource_allocations (T-02 — PR-03) — employee or asset, the
--     date range, the allocation percent (0 < x ≤ 100 per row; the
--     over-allocation WARNING against calendars is the engine's read-side
--     signal, never a write refusal — the phase doc's own wording). The
--     XOR CHECK pins the resource kind to exactly one target (the
--     performance_reviews self-kind CHECK precedent). The asset side
--     targets the fixed-assets register (`assets`, 037) — the CMMS
--     handoff's cross-branch movement context (the phase doc §8).
--
-- Ledger-free by design (the plan's W-8 scope; the cost-curve engine,
-- the vs-actual rollup and the INV-033 reconciliation service land W-9).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. project_budgets (the cost-plan header).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_budgets" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "project_id" uuid NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "approved_at" timestamptz,
  "approved_by" uuid,
  "closed_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_project_budgets PRIMARY KEY ("id"),
  CONSTRAINT uq_project_budgets_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_project_budgets_tenant_project_name
    UNIQUE ("tenant_id", "project_id", "name"),
  CONSTRAINT fk_project_budgets_project
    FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_project_budgets_status
    CHECK ("status" IN ('DRAFT', 'APPROVED', 'CLOSED')),
  CONSTRAINT ck_project_budgets_approval
    CHECK ("status" = 'DRAFT' OR "approved_at" IS NOT NULL)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_project_budgets_tenant_project_status
  ON "project_budgets" ("tenant_id", "project_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. project_budget_lines (the curve's cells: type × node × window).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_budget_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "budget_id" uuid NOT NULL,
  "cost_type" text NOT NULL,
  "wbs_task_id" uuid,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "planned_amount" numeric(19, 4) NOT NULL,
  "note" text,
  CONSTRAINT pk_project_budget_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_project_budget_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_project_budget_lines_budget
    FOREIGN KEY ("budget_id", "tenant_id")
    REFERENCES "project_budgets" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_project_budget_lines_wbs_task
    FOREIGN KEY ("wbs_task_id", "tenant_id")
    REFERENCES "project_wbs_tasks" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_project_budget_lines_cost_type
    CHECK ("cost_type" IN ('LABOR', 'MATERIAL', 'SUBCONTRACT', 'OVERHEAD')),
  CONSTRAINT ck_project_budget_lines_window
    CHECK ("period_end" >= "period_start"),
  CONSTRAINT ck_project_budget_lines_amount
    CHECK ("planned_amount" >= 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_project_budget_lines_tenant_budget
  ON "project_budget_lines" ("tenant_id", "budget_id", "cost_type");
--> statement-breakpoint
-- The cell law (one planned amount per type × node × period-start): two
-- partial uniques — the node-bound cell and the project-level (NULL-node)
-- cell (the pullable-index precedent's WHERE shape; NULLs never join a
-- plain UNIQUE in PG, so the partial pair IS the NULLS NOT DISTINCT cell).
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_budget_lines_cell_task
  ON "project_budget_lines" ("tenant_id", "budget_id", "cost_type", "wbs_task_id", "period_start")
  WHERE "wbs_task_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_budget_lines_cell_project
  ON "project_budget_lines" ("tenant_id", "budget_id", "cost_type", "period_start")
  WHERE "wbs_task_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_project_budget_lines_tenant_wbs
  ON "project_budget_lines" ("tenant_id", "wbs_task_id")
  WHERE "wbs_task_id" IS NOT NULL;
--> statement-breakpoint
-- The vs-actual rollup's time axis (T-06).
CREATE INDEX IF NOT EXISTS ix_project_budget_lines_tenant_period
  ON "project_budget_lines" ("tenant_id", "period_start", "period_end");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. project_resource_allocations (employee or asset × window × %).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_resource_allocations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "project_id" uuid NOT NULL,
  "wbs_task_id" uuid,
  "resource_kind" text NOT NULL,
  "employee_id" uuid,
  "asset_id" uuid,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "allocation_percent" numeric(5, 2) NOT NULL,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_project_resource_allocations PRIMARY KEY ("id"),
  CONSTRAINT uq_project_resource_allocations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_project_resource_allocations_project
    FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_project_resource_allocations_wbs_task
    FOREIGN KEY ("wbs_task_id", "tenant_id")
    REFERENCES "project_wbs_tasks" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_project_resource_allocations_employee
    FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_project_resource_allocations_asset
    FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_project_resource_allocations_kind
    CHECK ("resource_kind" IN ('EMPLOYEE', 'ASSET')),
  CONSTRAINT ck_project_resource_allocations_target
    CHECK (
      ("resource_kind" = 'EMPLOYEE' AND "employee_id" IS NOT NULL AND "asset_id" IS NULL)
      OR ("resource_kind" = 'ASSET' AND "asset_id" IS NOT NULL AND "employee_id" IS NULL)
    ),
  CONSTRAINT ck_project_resource_allocations_window
    CHECK ("end_date" >= "start_date"),
  CONSTRAINT ck_project_resource_allocations_percent
    CHECK ("allocation_percent" > 0 AND "allocation_percent" <= 100)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_project_resource_allocations_tenant_project
  ON "project_resource_allocations" ("tenant_id", "project_id", "start_date", "end_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_project_resource_allocations_tenant_employee
  ON "project_resource_allocations" ("tenant_id", "employee_id", "start_date", "end_date")
  WHERE "employee_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_project_resource_allocations_tenant_asset
  ON "project_resource_allocations" ("tenant_id", "asset_id", "start_date", "end_date")
  WHERE "asset_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS (the A1–A10 law: enable + force + the tenant policy + the purge
--    path) then the grants, per the 028 discipline (budgets NO delete —
--    the approved curve is the variance truth; lines DELETE for the DRAFT
--    bulk-replace; allocations planning data with DELETE).
--> statement-breakpoint
ALTER TABLE "project_budgets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_budgets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"project_budgets"');
--> statement-breakpoint
ALTER TABLE "project_budget_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_budget_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"project_budget_lines"');
--> statement-breakpoint
ALTER TABLE "project_resource_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_resource_allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"project_resource_allocations"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'project_budgets', 'project_budget_lines', 'project_resource_allocations'
  ] LOOP
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
REVOKE ALL ON "project_budgets" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "project_budgets" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "project_budgets" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "project_budgets" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "project_budget_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_budget_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "project_budget_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "project_budget_lines" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "project_resource_allocations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_resource_allocations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "project_resource_allocations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "project_resource_allocations" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 101)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
