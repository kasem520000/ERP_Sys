-- PHASE-046 (Blueprint v3.0 · CR-16) · migration 0090 · HR Payroll
-- Compliance (part 2: the EOSB row-sets).
--
--   eosb_rules (D-04) — the service-year tier rows per jurisdiction under
--     the same verification discipline: from_years/to_years (NULL = the
--     open top) × days_per_year, with the optional contract_type override
--     (NULL = all — the tenant-configurable axis the doc names). The KSA
--     seed (migration 0092): 0–5 years → 15 days/year, > 5 → 30
--     days/year — VERIFIED with the labor-law citation (the doc's own
--     worked shape; the entitlement is the per-year tier fold: 7 years ×
--     eosBase 9,000 → 5×15 + 2×30 = 135 days → 135/30 × 9,000).
--   eosb_calculations (D-04) — the per-employee computation evidence:
--     kind TERMINATION / PERIOD_TRUE_UP / OPENING; the service-years, the
--     tier breakdown + the wage-base snapshot (jsonb — the 029 eosBase
--     concept frozen at calculation time), the entitlement, the standing
--     provision balance, and the SIGNED delta (entitlement − provision —
--     BR-087's delta-only true-up; a positive delta accrues, a negative
--     one releases, zero posts nothing). The G-31 settlement path is
--     untouched — at termination the engine computes, the true-up aligns
--     the provision (G-54), then G-31 settles exactly as shipped.
--
-- Grants: rules = master data incl. DELETE; calculations = the evidence
-- discipline — SELECT/INSERT/UPDATE, no DELETE for erp_app.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. eosb_rules (D-04 — the tier row-set).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eosb_rules" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "jurisdiction_code" text NOT NULL,
  "from_years" numeric(7, 2) NOT NULL,
  "to_years" numeric(7, 2),
  "days_per_year" numeric(7, 2) NOT NULL,
  "contract_type" text,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "status" text NOT NULL DEFAULT 'REQUIRES_VERIFICATION',
  "source_name" text,
  "source_ref" text,
  "verified_by" uuid,
  "verified_at" timestamptz,
  "review_note" text,
  "updated_by" uuid,
  CONSTRAINT pk_eosb_rules PRIMARY KEY ("id"),
  CONSTRAINT uq_eosb_rules_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_eosb_rules_jurisdiction
    CHECK (char_length("jurisdiction_code") BETWEEN 2 AND 8),
  CONSTRAINT ck_eosb_rules_span CHECK ("from_years" >= 0),
  CONSTRAINT ck_eosb_rules_open CHECK ("to_years" IS NULL OR "to_years" > "from_years"),
  CONSTRAINT ck_eosb_rules_days CHECK ("days_per_year" >= 0 AND "days_per_year" <= 366),
  CONSTRAINT ck_eosb_rules_effective
    CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
  CONSTRAINT ck_eosb_rules_status
    CHECK ("status" IN ('REQUIRES_VERIFICATION', 'VERIFIED', 'RETIRED')),
  CONSTRAINT ck_eosb_rules_verified_shape
    CHECK (("status" = 'VERIFIED') = ("verified_at" IS NOT NULL AND "source_name" IS NOT NULL))
);
--> statement-breakpoint
-- The tier uniqueness per (tenant, jurisdiction, effective window) with
-- the NULL contract_type treated as its own bucket (NULLs are distinct
-- in plain UNIQUEs — the expression index closes the hole).
CREATE UNIQUE INDEX IF NOT EXISTS uq_eosb_rules_tier
  ON "eosb_rules" ("tenant_id", "jurisdiction_code", COALESCE("contract_type", ''), "effective_from", "from_years");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_eosb_rules_tenant_jurisdiction_effective
  ON "eosb_rules" ("tenant_id", "jurisdiction_code", "effective_from");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. eosb_calculations (D-04 — the computation evidence).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eosb_calculations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "employee_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "service_years" numeric(7, 2) NOT NULL,
  "tier_breakdown" jsonb NOT NULL,
  "wage_base_snapshot" jsonb NOT NULL,
  "entitlement_amount" numeric(19, 4) NOT NULL,
  "provision_balance" numeric(19, 4) NOT NULL,
  "delta" numeric(19, 4) NOT NULL,
  "journal_entry_id" uuid,
  "status" text NOT NULL DEFAULT 'COMPUTED',
  "run_id" uuid,
  "fiscal_period_id" uuid,
  "entry_date" date NOT NULL,
  "note" text,
  CONSTRAINT pk_eosb_calculations PRIMARY KEY ("id"),
  CONSTRAINT uq_eosb_calculations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_eosb_calculations_kind
    CHECK ("kind" IN ('TERMINATION', 'PERIOD_TRUE_UP', 'OPENING')),
  CONSTRAINT ck_eosb_calculations_service CHECK ("service_years" >= 0),
  CONSTRAINT ck_eosb_calculations_amounts
    CHECK ("entitlement_amount" >= 0 AND "provision_balance" >= 0),
  CONSTRAINT ck_eosb_calculations_delta
    CHECK ("delta" = "entitlement_amount" - "provision_balance"),
  CONSTRAINT ck_eosb_calculations_status CHECK ("status" IN ('COMPUTED', 'POSTED')),
  CONSTRAINT ck_eosb_calculations_posted_shape
    CHECK (("status" = 'POSTED') = ("journal_entry_id" IS NOT NULL)),
  CONSTRAINT fk_eosb_calculations_employee FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_eosb_calculations_run FOREIGN KEY ("run_id", "tenant_id")
    REFERENCES "payroll_runs" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_eosb_calculations_period FOREIGN KEY ("fiscal_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_eosb_calculations_tenant_employee_kind
  ON "eosb_calculations" ("tenant_id", "employee_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_eosb_calculations_tenant_journal
  ON "eosb_calculations" ("tenant_id", "journal_entry_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "eosb_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "eosb_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"eosb_rules"');
--> statement-breakpoint
ALTER TABLE "eosb_calculations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "eosb_calculations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"eosb_calculations"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['eosb_rules', 'eosb_calculations'] LOOP
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
-- 4. Grants — the evidence discipline on calculations: no DELETE.
--> statement-breakpoint
REVOKE ALL ON "eosb_rules" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "eosb_rules" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "eosb_rules" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "eosb_rules" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "eosb_calculations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "eosb_calculations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "eosb_calculations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "eosb_calculations" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 90)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
