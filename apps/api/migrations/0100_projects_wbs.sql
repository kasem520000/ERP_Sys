-- PHASE-048 (Blueprint v3.0 · CR-18) · migration 0100 · Projects &
-- Contracting (part 1: the WBS tree, T-01 — on the PHASE-047 delivery
-- lineage; the phase doc's "0079" slots are stale blueprint numbers, its
-- own note defers to the journal — the honest slots after 0099, D-02).
--
--   project_wbs_tasks (D-03/T-01 — PR-04/H-06) — the work-breakdown tree
--     around the FROZEN six-column projects substrate (D-01: extended,
--     never replaced): the parent link (the 047 D-09 org-tree precedent
--     exactly — cycle safety by the pure detectCycle unit at the engine,
--     W-9, validation at write time, the API the only move path), the
--     single-predecessor dependency edge (the same precedent's shape: a
--     self composite-FK — the multi-edge graph composes through
--     intermediate tasks; the DB carries the FK-verified edge, BR-095's
--     recompute law owns the aggregate), the milestone flag (the
--     zero-duration marker), the weight and percent_complete columns
--     (the weighted rollup is RECOMPUTED FROM THE LEAVES on every read
--     of the aggregate — never a stored stale sum; the stored value is
--     the task's own report, D-03), and the bilingual title pair.
--   + THE WBS DIMENSION ON crm_time_entries (the phase doc's "+1 column
--     family"): the nullable wbs_task_id with its composite FK — the
--     labor-actual collector's dimension (T-07/D-05: approved time
--     entries × employee cost rates on the WBS node). The task ∈ entry's
--     project coherence is the W-9 collector's write-time validation
--     (cross-row, engine-side — recorded here per the F1 law).
--
-- Ledger-free by design (the plan's W-8 scope: substrate only — the
-- engines, rollups and goldens land W-9…W-14; JOURNAL_RULES and
-- ACCOUNTING_INVARIANTS untouched until W-15's canon rows).
--
-- Grants: planning/operational data with typed service guards owning
-- the lifecycles — DELETE granted (the competencies/shifts precedent);
-- the tree dies with its project (CASCADE) while the predecessor and
-- parent edges RESTRICT (children first, the evidence order).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. project_wbs_tasks (the WBS tree + the dependency edge).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_wbs_tasks" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "project_id" uuid NOT NULL,
  "parent_task_id" uuid,
  "predecessor_task_id" uuid,
  "wbs_code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "is_milestone" boolean NOT NULL DEFAULT false,
  "start_date" date,
  "end_date" date,
  "weight" numeric(7, 4),
  "percent_complete" numeric(5, 2) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_project_wbs_tasks PRIMARY KEY ("id"),
  CONSTRAINT uq_project_wbs_tasks_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_project_wbs_tasks_tenant_project_code
    UNIQUE ("tenant_id", "project_id", "wbs_code"),
  CONSTRAINT fk_project_wbs_tasks_project
    FOREIGN KEY ("project_id", "tenant_id")
    REFERENCES "projects" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_project_wbs_tasks_parent
    FOREIGN KEY ("parent_task_id", "tenant_id")
    REFERENCES "project_wbs_tasks" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_project_wbs_tasks_predecessor
    FOREIGN KEY ("predecessor_task_id", "tenant_id")
    REFERENCES "project_wbs_tasks" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_project_wbs_tasks_parent_not_self
    CHECK ("parent_task_id" IS NULL OR "parent_task_id" <> "id"),
  CONSTRAINT ck_project_wbs_tasks_predecessor_not_self
    CHECK ("predecessor_task_id" IS NULL OR "predecessor_task_id" <> "id"),
  CONSTRAINT ck_project_wbs_tasks_window
    CHECK ("end_date" IS NULL OR "start_date" IS NULL OR "end_date" >= "start_date"),
  CONSTRAINT ck_project_wbs_tasks_weight
    CHECK ("weight" IS NULL OR ("weight" >= 0 AND "weight" <= 100)),
  CONSTRAINT ck_project_wbs_tasks_percent
    CHECK ("percent_complete" >= 0 AND "percent_complete" <= 100)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_project_wbs_tasks_tenant_project
  ON "project_wbs_tasks" ("tenant_id", "project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_project_wbs_tasks_tenant_parent
  ON "project_wbs_tasks" ("tenant_id", "project_id", "parent_task_id");
--> statement-breakpoint
-- The dependency edge's walk (the cycle probe's read path, W-9).
CREATE INDEX IF NOT EXISTS ix_project_wbs_tasks_tenant_predecessor
  ON "project_wbs_tasks" ("tenant_id", "predecessor_task_id")
  WHERE "predecessor_task_id" IS NOT NULL;

--> statement-breakpoint
ALTER TABLE "project_wbs_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "project_wbs_tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"project_wbs_tasks"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_wbs_tasks'] LOOP
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
-- 2. Grants — planning data, DELETE granted (the typed service guards own
--    the tree lifecycles; the parent/predecessor RESTRICT edges enforce
--    the children-first order).
--> statement-breakpoint
REVOKE ALL ON "project_wbs_tasks" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_wbs_tasks" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "project_wbs_tasks" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "project_wbs_tasks" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. THE WBS DIMENSION ON crm_time_ENTRIES (the phase doc's "+1 column
--    family"; 0027's table is otherwise untouched — additive only, the
--    employees-extension precedent). The collector (T-07/D-05) aggregates
--    approved entries by the WBS node; the task∈project coherence is the
--    write-time validation (W-9), never a guessed default.
--> statement-breakpoint
ALTER TABLE "crm_time_entries" ADD COLUMN IF NOT EXISTS "wbs_task_id" uuid;
--> statement-breakpoint
ALTER TABLE "crm_time_entries"
  ADD CONSTRAINT fk_crm_time_entries_wbs_task
  FOREIGN KEY ("wbs_task_id", "tenant_id")
  REFERENCES "project_wbs_tasks" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_crm_time_entries_tenant_wbs
  ON "crm_time_entries" ("tenant_id", "wbs_task_id")
  WHERE "wbs_task_id" IS NOT NULL;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 100)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
