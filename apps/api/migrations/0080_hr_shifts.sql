-- PHASE-045 (Blueprint v3.0 · CR-15) · migration 0080 · HR Core —
-- Attendance, Leaves & Shifts (part 1: the shift family).
--
--   shifts (HR-04) — a reusable shift template: start/end times, the
--     grace period (late tolerance), paid break minutes, the night flag
--     (the overnight crossing arm), bilingual name. Templates are
--     referenced by the roster grid — never date-scoped themselves.
--   shift_rotations (HR-04) — the employee × date roster grid: which
--     shift (or none) an employee is rostered to work on a given date;
--     ROTATION rows come from the rotation-pattern generator, MANUAL
--     rows from the roster editor. ONE row per (employee, date) — the
--     grid's cell, replaced (not duplicated) on edit.
--
-- INV-031 adjacency: the roster is an input to the daily-status
-- derivation (present / late-past-grace / absent / missing-punch /
-- holiday / on-leave) — never a ledger document.
--
-- Grants: master data + the roster grid (SELECT/INSERT/UPDATE/DELETE —
-- the grid cell is replaceable by design; no append-only discipline
-- applies to planning rows).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. shifts (§2.1).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shifts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  "grace_minutes" integer NOT NULL DEFAULT 0,
  "break_minutes" integer NOT NULL DEFAULT 0,
  "is_night" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_shifts PRIMARY KEY ("id"),
  CONSTRAINT uq_shifts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_shifts_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_shifts_code_shape CHECK (char_length("code") BETWEEN 1 AND 32),
  CONSTRAINT ck_shifts_grace_range CHECK ("grace_minutes" >= 0 AND "grace_minutes" <= 240),
  CONSTRAINT ck_shifts_break_range CHECK ("break_minutes" >= 0 AND "break_minutes" <= 480),
  CONSTRAINT ck_shifts_name_length CHECK (length("name") BETWEEN 1 AND 120),
  CONSTRAINT ck_shifts_night_shape CHECK (
    ("is_night" AND "end_time" < "start_time") OR (NOT "is_night" AND "end_time" > "start_time")
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_shifts_tenant_active
  ON "shifts" ("tenant_id", "active");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. shift_rotations (§2.2 — the employee × date grid).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shift_rotations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "employee_id" uuid NOT NULL,
  "work_date" date NOT NULL,
  "shift_id" uuid,
  "source" text NOT NULL DEFAULT 'MANUAL',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_shift_rotations PRIMARY KEY ("id"),
  CONSTRAINT uq_shift_rotations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_shift_rotations_cell UNIQUE ("tenant_id", "employee_id", "work_date"),
  CONSTRAINT ck_shift_rotations_source CHECK ("source" IN ('ROTATION', 'MANUAL')),
  CONSTRAINT fk_shift_rotations_employee FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_shift_rotations_shift FOREIGN KEY ("shift_id", "tenant_id")
    REFERENCES "shifts" ("id", "tenant_id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_shift_rotations_tenant_date
  ON "shift_rotations" ("tenant_id", "work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_shift_rotations_tenant_employee
  ON "shift_rotations" ("tenant_id", "employee_id", "work_date");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shifts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"shifts"');
--> statement-breakpoint
ALTER TABLE "shift_rotations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "shift_rotations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"shift_rotations"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shifts', 'shift_rotations'] LOOP
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
-- 4. Grants.
--> statement-breakpoint
REVOKE ALL ON "shifts" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shifts" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "shifts" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "shifts" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "shift_rotations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shift_rotations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "shift_rotations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "shift_rotations" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 80)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
