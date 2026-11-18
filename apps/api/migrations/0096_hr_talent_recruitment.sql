-- PHASE-047 (Blueprint v3.0 · CR-17) · migration 0096 · HR Growth —
-- Talent & Performance (part 2: the recruitment cluster, T-02).
--
--   vacancies (T-07) — the requisition: the position slot (the FK to
--     positions lands with 0097's org cluster — the plan's slot ordering
--     creates positions after vacancies; the column ships here as the
--     plain uuid + index, 0097 §5 adds the constraint), the requested
--     headcount, and the lifecycle OPEN→ON_HOLD→FILLED→CANCELLED (the
--     typed transitions land with the W-3 engine).
--   applicants (T-07, BR-088) — the pipeline row: the monotonic stage
--     ladder NEW→SCREEN→INTERVIEW→OFFER→HIRED/REJECTED — backward motion
--     ONLY via the recorded reopen action (the stage_history jsonb
--     append — the transition audit shape; the state machine itself is
--     the W-3 engine's pure law), the source, and the hired→employee
--     link (hired_employee_id — the hire act's bridge to the 045 master,
--     written once at W-3). Evidence discipline: no DELETE (REJECTED is
--     a terminal state, never an erasure — the pipeline is the hiring
--     record).
--   interviews (T-07) — ONE row per panelist slot per round: the
--     scheduled window, the mode, the scorecard ratings (jsonb — the
--     competency-keyed shape the scorecard UI writes), the verdict, the
--     comments. Evidence discipline: no DELETE (the panel record).
--
-- Grants: vacancies = master data incl. DELETE (the typed service guards
-- own the lifecycle); applicants/interviews = the evidence discipline
-- (SELECT/INSERT/UPDATE, no DELETE).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. vacancies (the requisition).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vacancies" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "code" text NOT NULL,
  -- The position slot: FK added by 0097 §5 (positions is created there —
  -- the plan's slot ordering; the uuid ships here so the vacancy universe
  -- is complete from day one).
  "position_id" uuid,
  "title" text NOT NULL,
  "title_ar" text,
  "headcount" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'OPEN',
  "opened_at" timestamptz,
  "filled_at" timestamptz,
  "notes" text,
  CONSTRAINT pk_vacancies PRIMARY KEY ("id"),
  CONSTRAINT uq_vacancies_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_vacancies_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_vacancies_headcount CHECK ("headcount" > 0),
  CONSTRAINT ck_vacancies_status
    CHECK ("status" IN ('OPEN', 'ON_HOLD', 'FILLED', 'CANCELLED'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_vacancies_tenant_status
  ON "vacancies" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_vacancies_tenant_position
  ON "vacancies" ("tenant_id", "position_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. applicants (the pipeline row, BR-088's substrate).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "applicants" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "vacancy_id" uuid NOT NULL,
  "full_name" text NOT NULL,
  "full_name_ar" text,
  "email" text,
  "phone" text,
  "source" text,
  "stage" text NOT NULL DEFAULT 'NEW',
  "stage_history" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "hired_employee_id" uuid,
  "notes" text,
  CONSTRAINT pk_applicants PRIMARY KEY ("id"),
  CONSTRAINT uq_applicants_id_tenant UNIQUE ("id", "tenant_id"),
  -- RESTRICT (never CASCADE): vacancies carry the DELETE grant, but the
  -- applicant rows are the hiring RECORD — the FK refuses the parent's
  -- deletion while evidence rows exist (the evidence protects itself).
  CONSTRAINT fk_applicants_vacancy
    FOREIGN KEY ("vacancy_id", "tenant_id")
    REFERENCES "vacancies" ("id", "tenant_id") ON DELETE RESTRICT,
  -- The hired link: written once by the hire act (W-3); the composite FK
  -- keeps it tenant-coherent.
  CONSTRAINT fk_applicants_hired_employee
    FOREIGN KEY ("hired_employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE SET NULL,
  CONSTRAINT ck_applicants_stage
    CHECK ("stage" IN ('NEW', 'SCREEN', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_applicants_tenant_vacancy
  ON "applicants" ("tenant_id", "vacancy_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_applicants_tenant_stage
  ON "applicants" ("tenant_id", "stage");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. interviews (the panel scorecards — one row per panelist per round).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interviews" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "applicant_id" uuid NOT NULL,
  "round" integer NOT NULL,
  "panelist_employee_id" uuid NOT NULL,
  "scheduled_start" timestamptz NOT NULL,
  "scheduled_end" timestamptz NOT NULL,
  "mode" text NOT NULL,
  "scorecard" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "verdict" text,
  "comments" text,
  CONSTRAINT pk_interviews PRIMARY KEY ("id"),
  CONSTRAINT uq_interviews_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_interviews_applicant_round_panelist
    UNIQUE ("tenant_id", "applicant_id", "round", "panelist_employee_id"),
  CONSTRAINT fk_interviews_applicant
    FOREIGN KEY ("applicant_id", "tenant_id")
    REFERENCES "applicants" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_interviews_panelist
    FOREIGN KEY ("panelist_employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_interviews_round CHECK ("round" > 0),
  CONSTRAINT ck_interviews_window CHECK ("scheduled_end" > "scheduled_start"),
  CONSTRAINT ck_interviews_mode CHECK ("mode" IN ('ONSITE', 'VIDEO', 'PHONE')),
  CONSTRAINT ck_interviews_verdict
    CHECK ("verdict" IS NULL OR "verdict" IN ('STRONG_HIRE', 'HIRE', 'NO_HIRE', 'STRONG_NO_HIRE'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_interviews_tenant_applicant
  ON "interviews" ("tenant_id", "applicant_id", "round");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_interviews_tenant_panelist
  ON "interviews" ("tenant_id", "panelist_employee_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "vacancies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "vacancies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"vacancies"');
--> statement-breakpoint
ALTER TABLE "applicants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "applicants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"applicants"');
--> statement-breakpoint
ALTER TABLE "interviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "interviews" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"interviews"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vacancies', 'applicants', 'interviews'] LOOP
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
-- 5. Grants — the master/evidence split.
--> statement-breakpoint
REVOKE ALL ON "vacancies" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "vacancies" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "vacancies" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "vacancies" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "applicants" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "applicants" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "applicants" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "applicants" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "interviews" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "interviews" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "interviews" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "interviews" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 96)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
