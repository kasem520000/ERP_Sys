-- PHASE-040 (Blueprint v3.0 · CR-10; scope extended by v3.1/CR-46 — the
-- L1-21 export-templates half) · migration 0060 · Data Onboarding &
-- Migration Toolkit
--
-- Purpose (PHASE-040 §2): kill the onboarding bottleneck (H-17 — imports
-- existed for only PARTNERS/ITEMS/OPENING_BALANCES). This migration lays
-- the substrate; the engine itself is application code:
--
--   import_mappings — tenant-scoped saved column maps (kind + column map
--     jsonb + options), reused across files; the v3.1/CR-46 extension
--     gives the table the EXPORT direction (saved export templates:
--     entity, column selection, format, filters) so recurring extracts
--     run one-click with a consistent shape.
--   import_jobs widening — the kind CHECK gains the SEVEN new kinds
--     (COA, ACCOUNT_OPENING_BALANCES, FIXED_ASSETS, EMPLOYEES,
--     PRICE_LISTS, CONTRACTS, BUDGETS); additive columns mapping_id
--     (which saved mapping produced the job) and options (per-job run
--     options — e.g. the target budget for BUDGETS). Existing rows are
--     untouched (additive-only, zero reshape).
--   tenants markers — the SANDBOX plane (OA-05): kind STANDARD|SANDBOX,
--     sandbox_expires_at (time-boxed), sandbox_max_users (quota-capped),
--     sandbox_owner_email (the sales-demo contact); the demo-seed markers
--     (demo_seeded_at, demo_template, demo_seed_hash) make the demo-data
--     loader idempotent and auditable.
--
-- Numbering note (recorded in the PHASE-040 completion report §4): the
-- phase doc planned `0058_import_toolkit.sql` "next after 0057" — written
-- before the v3.2/CR-50 R-03 extension consumed 0055–0059 for the
-- supplier RMA; this migration is therefore 0060 (journal idx 59,
-- schema_version 60). Likewise the doc's counters predate PHASE-039:
-- permissions extend 265 → 267 (not 261 → 263) and ENTITY_CATALOG moves
-- 227 → 228 (not 223 → 224).
--
-- Permission keys (the doc's `platform.imports.manage` /
-- `platform.demo_data.manage` renamed — recorded deviation, completion
-- report §4): matrix §3.10 + the identity-flows checklist pin
-- `platform.*` as NEVER tenant-assignable (owner/viewer must 403), so
-- tenant-plane keys cannot carry the platform prefix. The two keys seed
-- as `configuration.imports.manage` (owner + accountant — the back-office
-- import hub) and `configuration.demo_data.manage` (owner — the demo-data
-- loader); the PLATFORM-plane sandbox provisioning route rides the
-- existing `platform.subscriptions.manage` (never plan-gated — the
-- platform.payouts precedent, exactly as the phase doc demands).
--
-- INV-022 ledger: +1 table (the phase's +1; ENTITY_CATALOG 227 → 228),
-- +0 journal rules (the toolkit posts through EXISTING engines only —
-- the negative ledger proof), +2 permissions (265 → 267), +2 feature
-- keys (platform.data_migration → business+enterprise, the 0051 tier-4
-- precedent; platform.demo_data → ALL plans, the recorded
-- trial-enablement decision).
--
-- Grants: import_mappings is tenant user data — SELECT/INSERT/UPDATE/
-- DELETE (mappings are re-editable and removable; no document semantics).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. import_mappings (§2.3): saved column maps, both directions.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_mappings" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "name" text NOT NULL,
  "direction" text NOT NULL DEFAULT 'IMPORT',
  "kind" text NOT NULL,
  "entity" text,
  "column_map" jsonb NOT NULL,
  "options" jsonb,
  "created_by" uuid,
  CONSTRAINT "pk_import_mappings" PRIMARY KEY ("id"),
  CONSTRAINT "uq_import_mappings_id_tenant" UNIQUE ("id", "tenant_id"),
  -- One name per (tenant, direction, kind): a saved map is reusable across
  -- files of the same shape — the acceptance-4 reuse contract.
  CONSTRAINT "uq_import_mappings_tenant_direction_kind_name"
    UNIQUE ("tenant_id", "direction", "kind", "name"),
  CONSTRAINT "ck_import_mappings_direction" CHECK ("direction" IN ('IMPORT', 'EXPORT')),
  -- The kind vocabulary: the three baseline kinds + the seven PHASE-040
  -- kinds (import direction); the EXPORT direction addresses an entity
  -- from the export surface (the items/partners/opening exporters of the
  -- baseline + custom-field views) — free-form but shape-checked in the
  -- application layer.
  CONSTRAINT "ck_import_mappings_kind_shape" CHECK (
    "kind" ~ '^[A-Z][A-Z0-9_]{1,40}$'
  ),
  CONSTRAINT "ck_import_mappings_name_length" CHECK (length("name") BETWEEN 1 AND 100),
  -- EXPORT rows name their entity; IMPORT rows leave it NULL.
  CONSTRAINT "ck_import_mappings_entity_shape" CHECK (
    ("direction" = 'IMPORT' AND "entity" IS NULL)
    OR ("direction" = 'EXPORT' AND "entity" IS NOT NULL AND "entity" ~ '^[a-z][a-z0-9_.]{1,60}$')
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_import_mappings_tenant_direction_kind"
  ON "import_mappings" ("tenant_id", "direction", "kind");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. import_jobs widening (additive; existing rows untouched).
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT IF EXISTS ck_import_jobs_kind_values;
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT ck_import_jobs_kind_values CHECK (
  "kind" IN ('PARTNERS', 'ITEMS', 'OPENING_BALANCES',
             'COA', 'ACCOUNT_OPENING_BALANCES', 'FIXED_ASSETS',
             'EMPLOYEES', 'PRICE_LISTS', 'CONTRACTS', 'BUDGETS')
);
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "mapping_id" uuid;
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN IF NOT EXISTS "options" jsonb;
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT IF EXISTS fk_import_jobs_mapping;
--> statement-breakpoint
ALTER TABLE "import_jobs"
  ADD CONSTRAINT fk_import_jobs_mapping FOREIGN KEY ("mapping_id", "tenant_id")
    REFERENCES "import_mappings" ("id", "tenant_id") ON DELETE SET NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. Tenants: the SANDBOX plane (OA-05) + the demo-seed markers (TB-19/20).
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'STANDARD';
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sandbox_expires_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sandbox_max_users" integer;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "sandbox_owner_email" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "demo_seeded_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "demo_template" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "demo_seed_hash" text;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_kind_values'
  ) THEN
    ALTER TABLE "tenants"
      ADD CONSTRAINT ck_tenants_kind_values CHECK ("kind" IN ('STANDARD', 'SANDBOX'));
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ck_tenants_sandbox_shape'
  ) THEN
    ALTER TABLE "tenants" ADD CONSTRAINT ck_tenants_sandbox_shape CHECK (
      ("kind" = 'STANDARD' AND "sandbox_expires_at" IS NULL AND "sandbox_max_users" IS NULL
         AND "sandbox_owner_email" IS NULL)
      OR ("kind" = 'SANDBOX' AND "sandbox_expires_at" IS NOT NULL
         AND "sandbox_max_users" IS NOT NULL AND "sandbox_max_users" >= 1
         AND "sandbox_max_users" <= 10)
    );
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_tenants_kind" ON "tenants" ("kind") WHERE "kind" = 'SANDBOX';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS (import_mappings — the house triple: apply_tenant_policy + the
--    purge path).
--> statement-breakpoint
ALTER TABLE "import_mappings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_mappings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"import_mappings"');

--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS purge_path_delete ON public.import_mappings';
  EXECUTE 'DROP POLICY IF EXISTS purge_path_update ON public.import_mappings';
  EXECUTE format(
    'CREATE POLICY purge_path_delete ON public.import_mappings FOR DELETE TO erp_migrate '
      || 'USING (tenant_id = erp.current_tenant_id())');
  EXECUTE format(
    'CREATE POLICY purge_path_update ON public.import_mappings FOR UPDATE TO erp_migrate '
      || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)');
END $$;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Grants: user data — full CRUD for erp_app (mappings are editable and
--    removable; no append-only semantics).
--> statement-breakpoint
REVOKE ALL ON "import_mappings" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_mappings" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "import_mappings" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "import_mappings" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. Bilingual table comments.
--> statement-breakpoint
COMMENT ON TABLE "import_mappings" IS 'PHASE-040: saved import column maps + export templates (kind, column map, options) — one name per tenant/direction/kind / خرائط أعمدة الاستيراد المحفوظة وقوالب التصدير';
--> statement-breakpoint
COMMENT ON COLUMN "import_jobs"."mapping_id" IS 'PHASE-040: the saved mapping that shaped this job (SET NULL when the mapping is removed)';
--> statement-breakpoint
COMMENT ON COLUMN "import_jobs"."options" IS 'PHASE-040: per-job run options (e.g. the target budgetId for the BUDGETS kind)';
--> statement-breakpoint
COMMENT ON COLUMN "tenants"."kind" IS 'PHASE-040 (OA-05): STANDARD | SANDBOX — sandbox tenants are platform-provisioned, time-boxed, quota-capped, never consolidation members';
--> statement-breakpoint
COMMENT ON COLUMN "tenants"."demo_seeded_at" IS 'PHASE-040 (TB-19/20): when the demo-data loader last ran (idempotency marker)';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Permission seed (PHASE-040 §4): the TWO keys (matrix §3.18) —
--    zero-drift extends 265 → 267 (seed = mirror; the drift CLI joins
--    this file). configuration.imports.manage → owner + accountant
--    (the back-office hub; the items.import.run precedent keeps the
--    baseline items import console untouched); configuration.
--    demo_data.manage → owner (explicitly granted; a platform-plane
--    sandbox route would ride platform.subscriptions.manage — recorded
--    in §4 of the phase doc's plan, see matrix §3.18).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('configuration.imports.manage', 'configuration', 'Run the import toolkit: seven kinds, mapping wizard, saved mappings, adapters / تشغيل عدّة الاستيراد: سبعة أنواع ومعين الربط والخرائط المحفوظة والمحوّلات'),
('configuration.demo_data.manage', 'configuration', 'Seed one-click realistic demo data per industry template and provision sandbox tenants / تحميل البيانات التجريبية الواقعية لكل قالب قطاعي وإنشاء المستأجرين التجريبيين')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
  AND p."key" IN ('configuration.imports.manage', 'configuration.demo_data.manage')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
  AND p."key" IN ('configuration.imports.manage')
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. Feature plan grants (FEATURE_CATALOG §protocol step 3):
--    platform.data_migration → business + enterprise (the 0051 tier-4
--    precedent — starter excluded); platform.demo_data → ALL plans (the
--    recorded trial-enablement decision: a trial tenant must be able to
--    light up with demo data — that is the whole point of a trial).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['platform.data_migration'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('platform.data_migration' = ANY("feature_keys"));
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['platform.demo_data'])
WHERE "key" IN ('starter', 'business', 'enterprise')
  AND NOT ('platform.demo_data' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 60)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
