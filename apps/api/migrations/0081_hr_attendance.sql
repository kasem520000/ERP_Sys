-- PHASE-045 (Blueprint v3.0 · CR-15) · migration 0081 · HR Core —
-- Attendance, Leaves & Shifts (part 2: the attendance records).
--
--   attendance_records (HR-01, H-05 operational) — one row per punch
--     session: check-in / check-out (both nullable — a missing punch is
--     itself the record), the source MANUAL | IMPORT | DEVICE with the
--     device reference and optional geo coordinates, the roster shift
--     the derivation used, and the DERIVED daily status (PRESENT /
--     LATE / ABSENT / MISSING_PUNCH / HOLIDAY / ON_LEAVE) with the
--     late/early/overtime minute facts that produced it.
--
--   INV-031 (attendance exactness): intervals never overlap per
--     employee-day — the UNIQUE (tenant, employee, work_date, check_in)
--     is the import-dedupe floor (the same employee + timestamp
--     collapses to one row); the full non-overlap law is enforced at
--     the service boundary and proven by the INV-031 suite (imported
--     and manual alike — a DB-level exclusion constraint would need
--     btree_gist on timestamptz ranges and buys nothing over the
--     guarded single-writer path every record rides).
--
--   BR-082 (the immutability window): rows are append-only through the
--     capture path; corrections arrive as new rows (the import's
--     quarantine discipline) — no UPDATE of a committed punch.
--
-- Grants: SELECT/INSERT/UPDATE (the UPDATE arm is the derivation
-- backfill — status fields only through the service; no DELETE from
-- the app role: the record is the operational truth).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. attendance_records (§2.3).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_records" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "employee_id" uuid NOT NULL,
  "work_date" date NOT NULL,
  "check_in" timestamptz,
  "check_out" timestamptz,
  "source" text NOT NULL DEFAULT 'MANUAL',
  "device_ref" text,
  "geo_lat" numeric(9, 6),
  "geo_lng" numeric(9, 6),
  "shift_id" uuid,
  "derived_status" text,
  "late_minutes" integer,
  "early_leave_minutes" integer,
  "worked_minutes" integer,
  "overtime_minutes" integer,
  "is_exception" boolean NOT NULL DEFAULT false,
  "import_batch_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_attendance_records PRIMARY KEY ("id"),
  CONSTRAINT uq_attendance_records_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_attendance_records_dedupe UNIQUE ("tenant_id", "employee_id", "work_date", "check_in"),
  CONSTRAINT ck_attendance_records_source CHECK ("source" IN ('MANUAL', 'IMPORT', 'DEVICE')),
  CONSTRAINT ck_attendance_records_status CHECK ("derived_status" IN (
    'PRESENT', 'LATE', 'ABSENT', 'MISSING_PUNCH', 'HOLIDAY', 'ON_LEAVE')),
  CONSTRAINT ck_attendance_records_interval CHECK (
    "check_in" IS NULL OR "check_out" IS NULL OR "check_out" > "check_in"),
  CONSTRAINT ck_attendance_records_session_shape CHECK (
    ("check_in" IS NULL AND "check_out" IS NULL) OR ("check_in" IS NOT NULL)),
  CONSTRAINT ck_attendance_records_device_shape CHECK (
    ("source" = 'DEVICE') = ("device_ref" IS NOT NULL)),
  CONSTRAINT ck_attendance_records_minutes_nonneg CHECK (
    ("late_minutes" IS NULL OR "late_minutes" >= 0)
    AND ("early_leave_minutes" IS NULL OR "early_leave_minutes" >= 0)
    AND ("worked_minutes" IS NULL OR "worked_minutes" >= 0)
    AND ("overtime_minutes" IS NULL OR "overtime_minutes" >= 0)),
  CONSTRAINT ck_attendance_records_import_shape CHECK (
    ("source" = 'IMPORT') = ("import_batch_id" IS NOT NULL)),
  CONSTRAINT fk_attendance_records_employee FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_attendance_records_shift FOREIGN KEY ("shift_id", "tenant_id")
    REFERENCES "shifts" ("id", "tenant_id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_attendance_records_tenant_date
  ON "attendance_records" ("tenant_id", "work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_attendance_records_tenant_employee_date
  ON "attendance_records" ("tenant_id", "employee_id", "work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_attendance_records_tenant_exception
  ON "attendance_records" ("tenant_id", "work_date") WHERE "is_exception";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_attendance_records_tenant_import_batch
  ON "attendance_records" ("tenant_id", "import_batch_id") WHERE "import_batch_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. RLS — the house triple + THE CROSS-EMPLOYEE ISOLATION NOTE (CR-36 (e)):
--    the tenant policy scopes rows by tenant only; the EMPLOYEE-level
--    scoping (self-service sees OWN rows) is the application layer's
--    `hr.self_service` gate — the dedicated attack test pins that a
--    self-service actor cannot read another employee's rows through the
--    API surface, and the authorization-matrix SoD note records that HR
--    data visibility rides HR permissions, never user administration.
--> statement-breakpoint
ALTER TABLE "attendance_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "attendance_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"attendance_records"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_records'] LOOP
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
-- 3. Grants.
--> statement-breakpoint
REVOKE ALL ON "attendance_records" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "attendance_records" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "attendance_records" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "attendance_records" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 81)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
