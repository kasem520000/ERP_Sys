-- PHASE-046 (Blueprint v3.0 · CR-16) · migration 0089 · HR Payroll
-- Compliance (part 1: the statutory row-sets + the employees extension).
--
--   statutory_contribution_profiles (D-01) — a TENANT-SCOPED ROW-SET per
--     jurisdiction, never one row: GOSI's three branches (pension / SANED
--     / OH) are separate rows because the LAW is a row-set — each branch
--     its own rate pair and its own wage-base cap (the dual-cap law:
--     pension/OH at 45,000 · SANED at 15,000). The OWNER'S CORRECTED
--     SCHEDULE (the PHASE-046 approval dispatch, 2026-11-16):
--       GOSI-PENSION  CITIZEN   employee 9.0000%  employer  9.0000%  cap 45,000
--       GOSI-SANED    CITIZEN   employee 0.7500%  employer  0.7500%  cap 15,000
--       GOSI-OH       ALL       employee 0.0000%  employer  2.0000%  cap 45,000
--     → Saudi totals: employer 11.75% (9% + 0.75% + 2%), employee 9.75%;
--       non-Saudi: OH only (employer 2%, employee 0).
--     contributory_keys jsonb = the structure component keys that count
--     toward the wage base beyond basic_salary (DATA, never hard-coded —
--     the KSA contributory wage is basic + housing).
--   payroll_tax_brackets (D-03) — effective-dated marginal bracket
--     row-sets per jurisdiction; the SET-level exemption defaults
--     (personal_allowance_default, per_dependent_allowance) ride the set
--     and are validated SET-CONSISTENT by the service (the typed
--     PitBracketSetInvalid refusal). A jurisdiction with NO verified
--     brackets computes zero PIT with an honest no-bracket state (KSA
--     seeds NO bracket rows — no employee PIT in KSA).
--   employees extension (D-02, the owner-approved plan addition) —
--     nationality (nullable ISO-3166 alpha-2; NULL is FAIL-CLOSED: the
--     employee gets NO statutory lines and surfaces the explicit
--     unpricedNationality run warning — never a guessed rate, BR-055)
--     + pit_exemptions jsonb ({personalAllowance?, dependents?, other?}
--     — absent = the set defaults, no fabricated values).
--
-- Grants: both master tables SELECT/INSERT/UPDATE, NO DELETE — the
-- verification trail is evidence (BR-085); retirement is status RETIRED.
-- The verification fields (source_name, source_ref, verified_by,
-- verified_at, review_note) + updated_by carry the SoD verify law
-- (verifier ≠ last editor — the BR-034 house pattern).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. statutory_contribution_profiles (D-01 — the row-set law).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "statutory_contribution_profiles" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "jurisdiction_code" text NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "employee_rate" numeric(7, 4) NOT NULL,
  "employer_rate" numeric(7, 4) NOT NULL,
  "base_min" numeric(19, 4),
  "base_max" numeric(19, 4),
  "contributory_keys" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "applies_to" text NOT NULL DEFAULT 'ALL',
  "effective_from" date NOT NULL,
  "effective_to" date,
  "status" text NOT NULL DEFAULT 'REQUIRES_VERIFICATION',
  "source_name" text,
  "source_ref" text,
  "verified_by" uuid,
  "verified_at" timestamptz,
  "review_note" text,
  "updated_by" uuid,
  CONSTRAINT pk_statutory_contribution_profiles PRIMARY KEY ("id"),
  CONSTRAINT uq_statutory_contribution_profiles_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_statutory_contribution_profiles_tenant_jurisdiction_code
    UNIQUE ("tenant_id", "jurisdiction_code", "code"),
  CONSTRAINT ck_statutory_contribution_profiles_jurisdiction
    CHECK (char_length("jurisdiction_code") BETWEEN 2 AND 8),
  CONSTRAINT ck_statutory_contribution_profiles_code
    CHECK (char_length("code") BETWEEN 1 AND 40),
  CONSTRAINT ck_statutory_contribution_profiles_rates
    CHECK ("employee_rate" >= 0 AND "employee_rate" <= 100
       AND "employer_rate" >= 0 AND "employer_rate" <= 100),
  CONSTRAINT ck_statutory_contribution_profiles_base
    CHECK (("base_min" IS NULL OR "base_min" >= 0)
       AND ("base_max" IS NULL OR "base_max" >= 0)
       AND ("base_min" IS NULL OR "base_max" IS NULL OR "base_min" <= "base_max")),
  CONSTRAINT ck_statutory_contribution_profiles_applies
    CHECK ("applies_to" IN ('ALL', 'CITIZEN', 'NON_CITIZEN')),
  CONSTRAINT ck_statutory_contribution_profiles_status
    CHECK ("status" IN ('REQUIRES_VERIFICATION', 'VERIFIED', 'RETIRED')),
  CONSTRAINT ck_statutory_contribution_profiles_effective
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT ck_statutory_contribution_profiles_verified_shape
    CHECK (("status" = 'VERIFIED') = ("verified_at" IS NOT NULL AND "source_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_statutory_contribution_profiles_tenant_jurisdiction_status
  ON "statutory_contribution_profiles" ("tenant_id", "jurisdiction_code", "status", "effective_from");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. payroll_tax_brackets (D-03 — the marginal row-set).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payroll_tax_brackets" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "jurisdiction_code" text NOT NULL,
  "code" text NOT NULL,
  "floor" numeric(19, 4) NOT NULL,
  "ceiling" numeric(19, 4),
  "rate" numeric(7, 4) NOT NULL,
  "sort" integer NOT NULL,
  "personal_allowance_default" numeric(19, 4) NOT NULL DEFAULT 0,
  "per_dependent_allowance" numeric(19, 4) NOT NULL DEFAULT 0,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "status" text NOT NULL DEFAULT 'REQUIRES_VERIFICATION',
  "source_name" text,
  "source_ref" text,
  "verified_by" uuid,
  "verified_at" timestamptz,
  "review_note" text,
  "updated_by" uuid,
  CONSTRAINT pk_payroll_tax_brackets PRIMARY KEY ("id"),
  CONSTRAINT uq_payroll_tax_brackets_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_payroll_tax_brackets_set_sort
    UNIQUE ("tenant_id", "jurisdiction_code", "code", "effective_from", "sort"),
  CONSTRAINT ck_payroll_tax_brackets_jurisdiction
    CHECK (char_length("jurisdiction_code") BETWEEN 2 AND 8),
  CONSTRAINT ck_payroll_tax_brackets_code
    CHECK (char_length("code") BETWEEN 1 AND 40),
  CONSTRAINT ck_payroll_tax_brackets_floor CHECK ("floor" >= 0),
  CONSTRAINT ck_payroll_tax_brackets_ceiling
    CHECK ("ceiling" IS NULL OR "ceiling" > "floor"),
  CONSTRAINT ck_payroll_tax_brackets_rate
    CHECK ("rate" >= 0 AND "rate" <= 100),
  CONSTRAINT ck_payroll_tax_brackets_sort CHECK ("sort" >= 1),
  CONSTRAINT ck_payroll_tax_brackets_allowances
    CHECK ("personal_allowance_default" >= 0 AND "per_dependent_allowance" >= 0),
  CONSTRAINT ck_payroll_tax_brackets_effective
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT ck_payroll_tax_brackets_status
    CHECK ("status" IN ('REQUIRES_VERIFICATION', 'VERIFIED', 'RETIRED')),
  CONSTRAINT ck_payroll_tax_brackets_verified_shape
    CHECK (("status" = 'VERIFIED') = ("verified_at" IS NOT NULL AND "source_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payroll_tax_brackets_tenant_jurisdiction_effective
  ON "payroll_tax_brackets" ("tenant_id", "jurisdiction_code", "effective_from", "sort");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. employees extension (D-02 — the owner-approved addition).
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "nationality" char(2);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "pit_exemptions" jsonb;
--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS ck_employees_nationality;
--> statement-breakpoint
ALTER TABLE "employees"
  ADD CONSTRAINT ck_employees_nationality CHECK ("nationality" IS NULL OR "nationality" ~ '^[A-Z]{2}$');
--> statement-breakpoint
COMMENT ON COLUMN "employees"."nationality" IS
  'PHASE-046 D-02 (the owner-approved plan addition): ISO-3166 alpha-2 — the GOSI citizen split''s resolution axis (CITIZEN rows match only nationals of the tenant''s jurisdiction, NON_CITIZEN the complement, ALL everyone). NULL is FAIL-CLOSED: no statutory lines + the explicit unpricedNationality run warning — never a guessed rate (BR-055). Registered in the PII inventory (docs/privacy/PII_INVENTORY.md).';
--> statement-breakpoint
COMMENT ON COLUMN "employees"."pit_exemptions" IS
  'PHASE-046 D-03: per-employee PIT exemption overrides {personalAllowance?, dependents?, other?} — absent keys fall back to the bracket set''s defaults, never fabricated values.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "statutory_contribution_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "statutory_contribution_profiles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"statutory_contribution_profiles"');
--> statement-breakpoint
ALTER TABLE "payroll_tax_brackets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payroll_tax_brackets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"payroll_tax_brackets"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['statutory_contribution_profiles', 'payroll_tax_brackets'] LOOP
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
-- 5. Grants — the verification trail is evidence: NO DELETE for erp_app.
--> statement-breakpoint
REVOKE ALL ON "statutory_contribution_profiles" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "statutory_contribution_profiles" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "statutory_contribution_profiles" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "statutory_contribution_profiles" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "payroll_tax_brackets" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payroll_tax_brackets" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "payroll_tax_brackets" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "payroll_tax_brackets" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 89)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
