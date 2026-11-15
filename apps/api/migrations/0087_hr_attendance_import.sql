-- PHASE-045 (Blueprint v3.0 · CR-15) · migration 0087 · HR Core —
-- Attendance, Leaves & Shifts (part 8: the device-import log + the
-- anomaly quarantine — T-05, N-17).
--
--   attendance_import_batches — the IMPORT LOG: one row per COMMITTED
--     import, carrying the source file's FINGERPRINT (sha256 — the
--     same file never commits twice, the UNIQUE floor), the counts
--     (rows parsed / imported / quarantined), the mapping the import
--     was interpreted with (the audit trail of interpretation), and
--     the file's device identity (the records themselves carry NO
--     device_ref — the 0081 device-shape CHECK binds device_ref to
--     source='DEVICE' only; an IMPORT row's traceability is its
--     import_batch_id → this row).
--
--   attendance_import_anomalies — THE QUARANTINE: every refused line
--     (unknown employee, invalid row, out-of-range time, duplicate in
--     file, already imported, double punch-in, orphan punch-out,
--     session overlap) lands here with its RAW LINE + the typed
--     reason, PENDING review — NOTHING lands silently. The resolve
--     action (REJECT or IMPORT-with-corrections) is the reviewer's
--     explicit act, audited.
--
-- Grants: the log is append-only (SELECT/INSERT); the quarantine is
-- SELECT/INSERT/UPDATE (the resolution write) — no DELETE from the
-- app role: the import log is the operational truth.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. attendance_import_batches (the import log).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_import_batches" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "file_name" text NOT NULL,
  "file_sha256" char(64) NOT NULL,
  "file_size" integer NOT NULL,
  "row_count" integer NOT NULL,
  "imported_count" integer NOT NULL,
  "quarantine_count" integer NOT NULL,
  "device_ref" text,
  "mapping" jsonb NOT NULL,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_attendance_import_batches PRIMARY KEY ("id"),
  CONSTRAINT uq_attendance_import_batches_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_attendance_import_batches_fingerprint UNIQUE ("tenant_id", "file_sha256"),
  CONSTRAINT ck_attendance_import_batches_sha_shape CHECK (char_length("file_sha256") = 64),
  CONSTRAINT ck_attendance_import_batches_counts CHECK (
    "row_count" >= 0 AND "imported_count" >= 0 AND "quarantine_count" >= 0
    AND "imported_count" + "quarantine_count" <= "row_count"),
  CONSTRAINT ck_attendance_import_batches_size CHECK ("file_size" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_attendance_import_batches_tenant_created
  ON "attendance_import_batches" ("tenant_id", "created_at" DESC);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. attendance_import_anomalies (the quarantine).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_import_anomalies" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "batch_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "employee_code" text,
  "punch_at" text,
  "direction" text,
  "reason" text NOT NULL,
  "detail" text,
  "raw_line" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "resolution_note" text,
  "resolved_by" uuid,
  "resolved_at" timestamptz,
  CONSTRAINT pk_attendance_import_anomalies PRIMARY KEY ("id"),
  CONSTRAINT uq_attendance_import_anomalies_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_attendance_import_anomalies_batch FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "attendance_import_batches" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_attendance_import_anomalies_reason CHECK ("reason" IN (
    'UNKNOWN_EMPLOYEE', 'INVALID_ROW', 'OUT_OF_RANGE', 'DUPLICATE_IN_FILE',
    'ALREADY_IMPORTED', 'DOUBLE_PUNCH_IN', 'ORPHAN_PUNCH_OUT', 'SESSION_OVERLAP')),
  CONSTRAINT ck_attendance_import_anomalies_status CHECK ("status" IN ('PENDING', 'RESOLVED', 'REJECTED')),
  CONSTRAINT ck_attendance_import_anomalies_direction CHECK (
    "direction" IS NULL OR "direction" IN ('IN', 'OUT')),
  CONSTRAINT ck_attendance_import_anomalies_line CHECK ("line_no" >= 1),
  CONSTRAINT ck_attendance_import_anomalies_resolution_shape CHECK (
    ("status" = 'PENDING') = ("resolved_by" IS NULL AND "resolved_at" IS NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_attendance_import_anomalies_batch
  ON "attendance_import_anomalies" ("tenant_id", "batch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_attendance_import_anomalies_tenant_status
  ON "attendance_import_anomalies" ("tenant_id", "status") WHERE "status" = 'PENDING';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS — the house triple (the 0081 pattern).
--> statement-breakpoint
ALTER TABLE "attendance_import_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "attendance_import_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"attendance_import_batches"');
--> statement-breakpoint
ALTER TABLE "attendance_import_anomalies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "attendance_import_anomalies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"attendance_import_anomalies"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_import_batches', 'attendance_import_anomalies'] LOOP
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
REVOKE ALL ON "attendance_import_batches" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "attendance_import_batches" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "attendance_import_batches" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "attendance_import_batches" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "attendance_import_anomalies" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "attendance_import_anomalies" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "attendance_import_anomalies" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "attendance_import_anomalies" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 87)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
