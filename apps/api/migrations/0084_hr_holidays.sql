-- PHASE-045 (Blueprint v3.0 · CR-15) · migration 0084 · HR Core —
-- Attendance, Leaves & Shifts (part 5: the holiday calendars).
--
--   holiday_calendars (HR-01/HR-04 support) — one calendar per
--     jurisdiction (the tenant's operating jurisdictions; bilingual
--     names): feeds the absence derivation (a holiday day derives
--     HOLIDAY, never ABSENT), the leave charge rules, and the overtime
--     tier selection (the HOLIDAY tier).
--   holidays — the dated rows: ONE per (calendar, date), bilingual.
--
-- Grants: master data (SELECT/INSERT/UPDATE/DELETE — a calendar row is
-- fully editable until the period closes; the statutory jurisdiction
-- PACKS are PHASE-046's verification regime, nothing fabricated here).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. holiday_calendars + holidays (§2.7).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holiday_calendars" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "jurisdiction_code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "active" boolean NOT NULL DEFAULT true,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_holiday_calendars PRIMARY KEY ("id"),
  CONSTRAINT uq_holiday_calendars_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_holiday_calendars_tenant_jurisdiction UNIQUE ("tenant_id", "jurisdiction_code"),
  CONSTRAINT ck_holiday_calendars_jurisdiction_shape CHECK (char_length("jurisdiction_code") BETWEEN 2 AND 8)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holidays" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "calendar_id" uuid NOT NULL,
  "holiday_date" date NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  CONSTRAINT pk_holidays PRIMARY KEY ("id"),
  CONSTRAINT uq_holidays_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_holidays_cell UNIQUE ("tenant_id", "calendar_id", "holiday_date"),
  CONSTRAINT ck_holidays_name_length CHECK (length("name") BETWEEN 1 AND 120),
  CONSTRAINT fk_holidays_calendar FOREIGN KEY ("calendar_id", "tenant_id")
    REFERENCES "holiday_calendars" ("id", "tenant_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_holidays_tenant_date
  ON "holidays" ("tenant_id", "holiday_date");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "holiday_calendars" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "holiday_calendars" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"holiday_calendars"');
--> statement-breakpoint
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "holidays" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"holidays"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['holiday_calendars', 'holidays'] LOOP
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
REVOKE ALL ON "holiday_calendars" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "holiday_calendars" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "holiday_calendars" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "holiday_calendars" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "holidays" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "holidays" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "holidays" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "holidays" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 84)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
