-- PHASE-047 (Blueprint v3.0 · CR-17) · migration 0095 · HR Growth —
-- Talent & Performance (part 1: the performance cluster, T-01).
--
--   performance_cycles (D-03/T-05) — the review cycle: the period window,
--     the lifecycle DRAFT→ACTIVE→CALIBRATION→CLOSED (the CAS transitions
--     land with the W-2 engine; the CHECK admits exactly these states),
--     the participant scope (org-unit ids jsonb — the scope resolution is
--     the engine's), and the review-due date (the hr.review-due sweep's
--     probe, D-06).
--   performance_reviews (D-08/T-05) — ONE row per (cycle, reviewee,
--     reviewer, kind): kind MANAGER carries the review proper (overall +
--     per-competency scores + the weighted goal rollup + comments); kinds
--     SELF/PEER/SUBORDINATE are the 360 INPUT rows (per source
--     relationship, BR-090's raw substrate — the reviewer sees them ONLY
--     in aggregate at the ≥ 3 threshold; no API surface returns an
--     attributed source below it). The evidence discipline: no DELETE
--     (the 360 aggregate's integrity depends on the source rows existing).
--   competencies + competency_levels (T-01/T-04) — the tenant competency
--     dictionary and the 1–5 scale (the ONE shipped default, BR-055's red
--     line: the scale is tenant-configurable DATA — 0098 §4 seeds the
--     documented AR/EN default; tenants edit descriptors, never invent
--     numbers).
--   goals (D-03/T-06) — the cascading weighted goals: the parent link
--     (org → team → employee), the KRI target/actual/progress, and the
--     per-cycle per-reviewee weight axis (BR-089's Σ = exactly 100% is
--     the W-2 engine's typed law; the (tenant, cycle, employee, title)
--     UNIQUE is the structural floor). Evidence discipline: no DELETE
--     (CANCELLED is the terminal soft state — the leave_requests
--     precedent).
--
-- Ledger-free by design (D-05): no journal rules, no invariants, no
-- account purposes — JOURNAL_RULES.md and ACCOUNTING_INVARIANTS.md
-- untouched.
--
-- Grants: cycles/competencies/competency_levels = master data incl.
-- DELETE (the shifts/eosb_rules precedent — typed service guards own the
-- lifecycles); reviews/goals = the evidence discipline (SELECT/INSERT/
-- UPDATE, no DELETE).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. performance_cycles (the review cycle).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_cycles" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "name" text NOT NULL,
  "name_ar" text,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "review_due_date" date,
  "scope_org_unit_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT pk_performance_cycles PRIMARY KEY ("id"),
  CONSTRAINT uq_performance_cycles_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_performance_cycles_status
    CHECK ("status" IN ('DRAFT', 'ACTIVE', 'CALIBRATION', 'CLOSED')),
  CONSTRAINT ck_performance_cycles_period
    CHECK ("period_end" >= "period_start"),
  CONSTRAINT ck_performance_cycles_review_due
    CHECK ("review_due_date" IS NULL OR "review_due_date" >= "period_start")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_performance_cycles_tenant_status
  ON "performance_cycles" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_performance_cycles_tenant_period
  ON "performance_cycles" ("tenant_id", "period_start", "period_end");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. performance_reviews (the review + the per-source 360 rows).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "performance_reviews" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "cycle_id" uuid NOT NULL,
  "reviewer_employee_id" uuid NOT NULL,
  "reviewee_employee_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "overall_score" numeric(5, 2),
  "competency_scores" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "goal_rollup" numeric(7, 2),
  "comments" text,
  CONSTRAINT pk_performance_reviews PRIMARY KEY ("id"),
  CONSTRAINT uq_performance_reviews_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_performance_reviews_cycle_reviewer_reviewee_kind
    UNIQUE ("tenant_id", "cycle_id", "reviewee_employee_id", "reviewer_employee_id", "kind"),
  CONSTRAINT fk_performance_reviews_cycle
    FOREIGN KEY ("cycle_id", "tenant_id")
    REFERENCES "performance_cycles" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_performance_reviews_reviewer
    FOREIGN KEY ("reviewer_employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_performance_reviews_reviewee
    FOREIGN KEY ("reviewee_employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_performance_reviews_kind
    CHECK ("kind" IN ('MANAGER', 'SELF', 'PEER', 'SUBORDINATE')),
  CONSTRAINT ck_performance_reviews_status
    CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'CALIBRATED')),
  CONSTRAINT ck_performance_reviews_score
    CHECK ("overall_score" IS NULL OR ("overall_score" >= 0 AND "overall_score" <= 100)),
  CONSTRAINT ck_performance_reviews_rollup
    CHECK ("goal_rollup" IS NULL OR ("goal_rollup" >= 0 AND "goal_rollup" <= 100)),
  -- BR-090's substrate law: the reviewer ≠ the reviewee on MANAGER/PEER/
  -- SUBORDINATE rows (SELF is the employee's own input by definition).
  CONSTRAINT ck_performance_reviews_self_kind
    CHECK (("kind" = 'SELF') = ("reviewer_employee_id" = "reviewee_employee_id"))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_performance_reviews_tenant_cycle
  ON "performance_reviews" ("tenant_id", "cycle_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_performance_reviews_tenant_reviewee
  ON "performance_reviews" ("tenant_id", "reviewee_employee_id", "kind");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. competencies + competency_levels (the framework + the 1–5 scale).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competencies" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "category" text,
  "active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_competencies PRIMARY KEY ("id"),
  CONSTRAINT uq_competencies_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_competencies_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_competencies_code CHECK (char_length("code") BETWEEN 1 AND 64)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_competencies_tenant_active
  ON "competencies" ("tenant_id", "active");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "competency_levels" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "level" integer NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "descriptor" text NOT NULL,
  "descriptor_ar" text NOT NULL,
  CONSTRAINT pk_competency_levels PRIMARY KEY ("id"),
  CONSTRAINT uq_competency_levels_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_competency_levels_tenant_level UNIQUE ("tenant_id", "level"),
  -- The scale's documented shape: exactly the 1–5 band (BR-055's one
  -- shipped default — 0098 §4 seeds it; the CHECK is the floor).
  CONSTRAINT ck_competency_levels_band CHECK ("level" BETWEEN 1 AND 5)
);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. goals (the cascading weighted KRI tree).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "goals" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "cycle_id" uuid NOT NULL,
  "owner_employee_id" uuid NOT NULL,
  "parent_goal_id" uuid,
  "title" text NOT NULL,
  "title_ar" text,
  "weight" numeric(5, 2) NOT NULL,
  "kri_target" text,
  "kri_actual" text,
  "progress_pct" numeric(5, 2),
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "due_date" date,
  CONSTRAINT pk_goals PRIMARY KEY ("id"),
  CONSTRAINT uq_goals_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_goals_cycle_employee_title
    UNIQUE ("tenant_id", "cycle_id", "owner_employee_id", "title"),
  CONSTRAINT fk_goals_cycle
    FOREIGN KEY ("cycle_id", "tenant_id")
    REFERENCES "performance_cycles" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_goals_owner
    FOREIGN KEY ("owner_employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  -- The cascade's parent link: RESTRICT (children re-parent before the
  -- parent goes — the cycle-safe move law's sibling, D-09).
  CONSTRAINT fk_goals_parent
    FOREIGN KEY ("parent_goal_id") REFERENCES "goals" ("id") ON DELETE RESTRICT,
  CONSTRAINT ck_goals_weight CHECK ("weight" >= 0 AND "weight" <= 100),
  CONSTRAINT ck_goals_progress
    CHECK ("progress_pct" IS NULL OR ("progress_pct" >= 0 AND "progress_pct" <= 100)),
  CONSTRAINT ck_goals_status
    CHECK ("status" IN ('ACTIVE', 'ACHIEVED', 'AT_RISK', 'CANCELLED')),
  -- A goal never parents itself (the one-row cycle floor; the multi-row
  -- cycle detection is the W-2 engine's pure detectCycle, D-09).
  CONSTRAINT ck_goals_not_self CHECK ("parent_goal_id" IS NULL OR "parent_goal_id" <> "id")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_goals_tenant_cycle
  ON "goals" ("tenant_id", "cycle_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_goals_tenant_owner
  ON "goals" ("tenant_id", "owner_employee_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_goals_tenant_parent
  ON "goals" ("tenant_id", "parent_goal_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "performance_cycles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "performance_cycles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"performance_cycles"');
--> statement-breakpoint
ALTER TABLE "performance_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "performance_reviews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"performance_reviews"');
--> statement-breakpoint
ALTER TABLE "competencies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "competencies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"competencies"');
--> statement-breakpoint
ALTER TABLE "competency_levels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "competency_levels" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"competency_levels"');
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"goals"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'performance_cycles', 'performance_reviews', 'competencies',
    'competency_levels', 'goals'
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
-- ---------------------------------------------------------------------------
-- 6. Grants — master data vs the evidence discipline.
--> statement-breakpoint
REVOKE ALL ON "performance_cycles" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "performance_cycles" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "performance_cycles" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "performance_cycles" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "performance_reviews" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "performance_reviews" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "performance_reviews" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "performance_reviews" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "competencies" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "competencies" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "competencies" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "competencies" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "competency_levels" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "competency_levels" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "competency_levels" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "competency_levels" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "goals" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "goals" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "goals" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "goals" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 95)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
