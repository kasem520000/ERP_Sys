-- PHASE-045 (Blueprint v3.0 · CR-15) · migration 0083 · HR Core —
-- Attendance, Leaves & Shifts (part 4: the leave family).
--
--   leave_types (HR-02) — the leave catalog: paid flag, the accrual
--     policy (entitled days per year — granted monthly with prorated
--     joiners when monthly_grant is set — the tenant's policy, never a
--     fabricated statutory rate), and the carry-over cap (days that
--     survive the year boundary; excess truncates at rollover with an
--     audit line).
--   leave_balances (HR-02) — the per-(employee, type, YEAR) balance
--     rows: entitlement, used, carried-forward. INV-031: used ≤
--     entitlement + carried-forward at EVERY moment (the property
--     suite proves it including mid-year joiners and carry-over
--     boundaries); balances are rows, not computed views, so the
--     period-close snapshot is reconstructable.
--   leave_requests (HR-02) — the request lifecycle: PENDING →
--     APPROVED / REJECTED / CANCELLED (the simple-approval chain — the
--     multi-step workflow engine is PHASE-052 by decision record; the
--     decision notes the upgrade path with no data migration).
--
-- Grants: types = master data; balances = SELECT/INSERT/UPDATE (the
-- accrual runs and the decrement/settle writes); requests =
-- SELECT/INSERT/UPDATE (the lifecycle).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. leave_types (§2.6).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_types" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "paid" boolean NOT NULL DEFAULT true,
  "accrual_days_per_year" numeric(7, 2) NOT NULL DEFAULT 0,
  "monthly_grant" boolean NOT NULL DEFAULT false,
  "prorate_joiners" boolean NOT NULL DEFAULT true,
  "carry_over_cap_days" numeric(7, 2) NOT NULL DEFAULT 0,
  "active" boolean NOT NULL DEFAULT true,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_leave_types PRIMARY KEY ("id"),
  CONSTRAINT uq_leave_types_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_leave_types_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_leave_types_accrual CHECK ("accrual_days_per_year" >= 0 AND "accrual_days_per_year" <= 366),
  CONSTRAINT ck_leave_types_carry CHECK ("carry_over_cap_days" >= 0 AND "carry_over_cap_days" <= 366),
  CONSTRAINT ck_leave_types_code_shape CHECK (char_length("code") BETWEEN 1 AND 32)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_leave_types_tenant_active
  ON "leave_types" ("tenant_id", "active");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. leave_balances (§2.6 — per employee × type × year).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_balances" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "employee_id" uuid NOT NULL,
  "leave_type_id" uuid NOT NULL,
  "year" integer NOT NULL,
  "entitlement_days" numeric(7, 2) NOT NULL DEFAULT 0,
  "used_days" numeric(7, 2) NOT NULL DEFAULT 0,
  "carried_forward_days" numeric(7, 2) NOT NULL DEFAULT 0,
  "note" text,
  CONSTRAINT pk_leave_balances PRIMARY KEY ("id"),
  CONSTRAINT uq_leave_balances_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_leave_balances_cell UNIQUE ("tenant_id", "employee_id", "leave_type_id", "year"),
  CONSTRAINT ck_leave_balances_year CHECK ("year" >= 2020 AND "year" <= 2100),
  CONSTRAINT ck_leave_balances_nonneg CHECK (
    "entitlement_days" >= 0 AND "used_days" >= 0 AND "carried_forward_days" >= 0),
  CONSTRAINT fk_leave_balances_employee FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_leave_balances_type FOREIGN KEY ("leave_type_id", "tenant_id")
    REFERENCES "leave_types" ("id", "tenant_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_leave_balances_tenant_employee_year
  ON "leave_balances" ("tenant_id", "employee_id", "year");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. leave_requests (§2.6 — the simple-approval lifecycle).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leave_requests" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "employee_id" uuid NOT NULL,
  "leave_type_id" uuid NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "days" numeric(7, 2) NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "requested_by" uuid,
  "decided_by" uuid,
  "decided_at" timestamptz,
  "decision_note" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_leave_requests PRIMARY KEY ("id"),
  CONSTRAINT uq_leave_requests_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_leave_requests_status CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT ck_leave_requests_span CHECK ("end_date" >= "start_date"),
  CONSTRAINT ck_leave_requests_days CHECK ("days" > 0 AND "days" <= 366),
  CONSTRAINT ck_leave_requests_decided_shape CHECK (
    ("status" IN ('PENDING')) = ("decided_at" IS NULL AND "decided_by" IS NULL)),
  CONSTRAINT fk_leave_requests_employee FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_leave_requests_type FOREIGN KEY ("leave_type_id", "tenant_id")
    REFERENCES "leave_types" ("id", "tenant_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_leave_requests_tenant_employee_status
  ON "leave_requests" ("tenant_id", "employee_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_leave_requests_tenant_dates
  ON "leave_requests" ("tenant_id", "start_date", "end_date");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leave_types" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"leave_types"');
--> statement-breakpoint
ALTER TABLE "leave_balances" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leave_balances" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"leave_balances"');
--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "leave_requests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"leave_requests"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['leave_types', 'leave_balances', 'leave_requests'] LOOP
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
-- 5. Grants.
--> statement-breakpoint
REVOKE ALL ON "leave_types" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "leave_types" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "leave_types" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "leave_types" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "leave_balances" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "leave_balances" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "leave_balances" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "leave_balances" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "leave_requests" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "leave_requests" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "leave_requests" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "leave_requests" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 83)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
