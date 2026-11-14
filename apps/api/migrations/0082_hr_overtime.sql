-- PHASE-045 (Blueprint v3.0 · CR-15) · migration 0082 · HR Core —
-- Attendance, Leaves & Shifts (part 3: the overtime family).
--
--   overtime_rules (HR-03) — the multiplier tiers: WEEKDAY / WEEKEND /
--     HOLIDAY (the holiday-calendar integration selects the tier), the
--     pay multiplier (1.5, 2.0 … — a tenant policy, never a fabricated
--     statutory rate), and the pre-approval-required flag per rule.
--   overtime_entries (HR-03) — the worked-overtime rows: employee,
--     date, hours, the matched rule, the PENDING → APPROVED/REJECTED
--     lifecycle (the simple-approval chain — the full workflow engine
--     is PHASE-052 by decision), and the exception surfacing:
--     BR-084 — a pre-approval-required rule's UNAPPROVED time is an
--     exception (never silently fed to payroll); approved entries carry
--     the approver + the timestamp.
--
-- Grants: rules = master data (SELECT/INSERT/UPDATE); entries =
-- SELECT/INSERT/UPDATE (the lifecycle), no DELETE from the app role.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. overtime_rules (§2.5).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "overtime_rules" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "tier" text NOT NULL,
  "multiplier" numeric(5, 2) NOT NULL,
  "pre_approval_required" boolean NOT NULL DEFAULT true,
  "max_hours_per_day" numeric(5, 2),
  "active" boolean NOT NULL DEFAULT true,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_overtime_rules PRIMARY KEY ("id"),
  CONSTRAINT uq_overtime_rules_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_overtime_rules_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_overtime_rules_tier CHECK ("tier" IN ('WEEKDAY', 'WEEKEND', 'HOLIDAY')),
  CONSTRAINT ck_overtime_rules_multiplier CHECK ("multiplier" >= 1 AND "multiplier" <= 5),
  CONSTRAINT ck_overtime_rules_max_hours CHECK ("max_hours_per_day" IS NULL OR ("max_hours_per_day" > 0 AND "max_hours_per_day" <= 16)),
  CONSTRAINT ck_overtime_rules_code_shape CHECK (char_length("code") BETWEEN 1 AND 32)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_overtime_rules_tenant_tier_active
  ON "overtime_rules" ("tenant_id", "tier", "active");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. overtime_entries (§2.5).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "overtime_entries" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "employee_id" uuid NOT NULL,
  "work_date" date NOT NULL,
  "hours" numeric(7, 2) NOT NULL,
  "rule_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "requested_by" uuid,
  "decided_by" uuid,
  "decided_at" timestamptz,
  "decision_note" text,
  "is_exception" boolean NOT NULL DEFAULT false,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_overtime_entries PRIMARY KEY ("id"),
  CONSTRAINT uq_overtime_entries_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_overtime_entries_status CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT ck_overtime_entries_hours CHECK ("hours" > 0 AND "hours" <= 16),
  CONSTRAINT ck_overtime_entries_decided_shape CHECK (
    ("status" = 'PENDING') = ("decided_at" IS NULL AND "decided_by" IS NULL)),
  CONSTRAINT fk_overtime_entries_employee FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_overtime_entries_rule FOREIGN KEY ("rule_id", "tenant_id")
    REFERENCES "overtime_rules" ("id", "tenant_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_overtime_entries_tenant_employee_date
  ON "overtime_entries" ("tenant_id", "employee_id", "work_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_overtime_entries_tenant_status
  ON "overtime_entries" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_overtime_entries_tenant_exception
  ON "overtime_entries" ("tenant_id", "work_date") WHERE "is_exception";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "overtime_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "overtime_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"overtime_rules"');
--> statement-breakpoint
ALTER TABLE "overtime_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "overtime_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"overtime_entries"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['overtime_rules', 'overtime_entries'] LOOP
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
REVOKE ALL ON "overtime_rules" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "overtime_rules" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "overtime_rules" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "overtime_rules" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "overtime_entries" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "overtime_entries" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "overtime_entries" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "overtime_entries" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 82)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
