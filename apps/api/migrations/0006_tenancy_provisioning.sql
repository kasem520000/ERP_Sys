-- PHASE-004 · migration 0006 · tenancy provisioning & platform administration
--
-- Purpose (PHASE-004 §2.1/§2.4–§2.9, TABLES/tenancy-identity.md):
-- - global reference tables `currencies` + `countries` (assigned P-002 in
--   SEEDS/README, explicitly deferred at PHASE-002 completion and skipped by
--   PHASE-003 — delivered here because `tenants.base_currency/country_code`
--   need the FK targets; no tenant_id, no RLS, read-only to the app role);
-- - global `industry_templates` + `chart_of_accounts_template` reference
--   tables (list-level only: the apply/switch ENGINE is PHASE-015, the
--   posting-readiness rules are PHASE-007);
-- - the additive `tenants` profile expansion (base_currency, country_code,
--   timezone, industry_template_key, deleted_at) + the status check swap to
--   add OFFBOARDED;
-- - the platform-scope audit widening: `audit_events.tenant_id` becomes
--   NULLable (platform-scope rows, pre-announced in TABLES/tenancy-identity)
--   + the `via_platform_admin` marker demanded by matrix §3.10/§7, with a
--   command-specific policy pair (SELECT/INSERT) that keeps tenants
--   confined while the platform GUC path reviews cross-tenant history;
-- - the tenant-owned provisioning tables: `branches`, `tenant_settings`,
--   `subscriptions` (minimal — billing columns are PHASE-014),
--   `entitlements` (materialized grants), `support_sessions` (matrix §7);
-- - the platform-level `plans` table (DR-001 starter/business/enterprise
--   skeleton; values are PLACEHOLDER per OQ-002 — no pricing surface) with
--   its own platform-scope RLS path mirroring `tenants`;
-- - the dedicated platform-operations tenant + its instantiated
--   `platform_admin` role (matrix §2: platform staff authenticate through
--   the same session/membership substrate, carry platform.* keys only and
--   never a business-tenant role) — seeded through a SECURITY DEFINER
--   helper owned by `erp_definer` (idempotent);
-- - the pre-GUC entitlement projection for the BR-039 enforcement guard
--   (`erp.tenant_active_entitlements`) mirroring the PHASE-003 identity
--   projections.
--
-- Runs as the migration bootstrap role (fresh-stack superuser or
-- erp_migrate on provisioned environments), same envelope as 0001–0005.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Global reference: ISO-4217 currency records (TABLES/core-accounting.md
-- §currencies; SEEDS/README P-002). Natural key PK, bilingual labels,
-- minor_units drives ADR-0009 rounding (KWD/BHD/OMR/JOD/IQD = 3).
CREATE TABLE IF NOT EXISTS "currencies" (
  "code" char(3) NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "minor_units" integer NOT NULL DEFAULT 2,
  "symbol" text,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_currencies PRIMARY KEY ("code"),
  CONSTRAINT ck_currencies_minor_units CHECK ("minor_units" BETWEEN 0 AND 4),
  CONSTRAINT ck_currencies_code_shape CHECK ("code" = upper("code"))
);
--> statement-breakpoint
-- Idempotent seed by natural key (SEEDS/README rule 1).
INSERT INTO "currencies" ("code", "name", "name_ar", "minor_units", "symbol") VALUES
  ('SAR', 'Saudi Riyal', 'ريال سعودي', 2, 'ر.س'),
  ('AED', 'UAE Dirham', 'درهم إماراتي', 2, 'د.إ'),
  ('BHD', 'Bahraini Dinar', 'دينار بحريني', 3, 'د.ب'),
  ('KWD', 'Kuwaiti Dinar', 'دينار كويتي', 3, 'د.ك'),
  ('OMR', 'Omani Rial', 'ريال عماني', 3, 'ر.ع'),
  ('QAR', 'Qatari Riyal', 'ريال قطري', 2, 'ر.ق'),
  ('YER', 'Yemeni Rial', 'ريال يمني', 2, 'ر.ي'),
  ('EGP', 'Egyptian Pound', 'جنيه مصري', 2, 'ج.م'),
  ('JOD', 'Jordanian Dinar', 'دينار أردني', 3, 'د.ا'),
  ('IQD', 'Iraqi Dinar', 'دينار عراقي', 3, 'ع.د'),
  ('USD', 'US Dollar', 'دولار أمريكي', 2, '$'),
  ('EUR', 'Euro', 'يورو', 2, '€')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "minor_units" = EXCLUDED."minor_units", "symbol" = EXCLUDED."symbol";

--> statement-breakpoint
-- Global reference: in-scope country records (COUNTRY_PACKS §5 — the 10
-- target-market jurisdictions) with the seeded display defaults a tenant
-- inherits at registration (default_locale, currency, date format, IANA
-- timezone). No column-level spec existed for `countries` (docs gap flagged
-- in the PHASE-004 completion report): shape follows SEEDS/README
-- "ISO-3166 country records + default locale/currency/date formats" and the
-- COUNTRY_PACKS §3 field list.
CREATE TABLE IF NOT EXISTS "countries" (
  "code" char(2) NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "default_locale" text NOT NULL DEFAULT 'ar',
  "currency_code" char(3) NOT NULL,
  "date_format" text NOT NULL DEFAULT 'dd/MM/yyyy',
  "time_zone" text NOT NULL DEFAULT 'UTC',
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_countries PRIMARY KEY ("code"),
  CONSTRAINT fk_countries_currency FOREIGN KEY ("currency_code")
    REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  CONSTRAINT ck_countries_code_shape CHECK ("code" = upper("code")),
  CONSTRAINT ck_countries_locale_values CHECK ("default_locale" IN ('ar', 'en'))
);
--> statement-breakpoint
INSERT INTO "countries" ("code", "name", "name_ar", "default_locale", "currency_code", "time_zone") VALUES
  ('SA', 'Saudi Arabia', 'المملكة العربية السعودية', 'ar', 'SAR', 'Asia/Riyadh'),
  ('AE', 'United Arab Emirates', 'الإمارات العربية المتحدة', 'ar', 'AED', 'Asia/Dubai'),
  ('BH', 'Bahrain', 'مملكة البحرين', 'ar', 'BHD', 'Asia/Bahrain'),
  ('KW', 'Kuwait', 'دولة الكويت', 'ar', 'KWD', 'Asia/Kuwait'),
  ('OM', 'Oman', 'سلطنة عمان', 'ar', 'OMR', 'Asia/Muscat'),
  ('QA', 'Qatar', 'دولة قطر', 'ar', 'QAR', 'Asia/Qatar'),
  ('YE', 'Yemen', 'الجمهورية اليمنية', 'ar', 'YER', 'Asia/Aden'),
  ('EG', 'Egypt', 'جمهورية مصر العربية', 'ar', 'EGP', 'Africa/Cairo'),
  ('JO', 'Jordan', 'المملكة الأردنية الهاشمية', 'ar', 'JOD', 'Asia/Amman'),
  ('IQ', 'Iraq', 'جمهورية العراق', 'ar', 'IQD', 'Asia/Baghdad')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "default_locale" = EXCLUDED."default_locale",
      "currency_code" = EXCLUDED."currency_code",
      "date_format" = EXCLUDED."date_format", "time_zone" = EXCLUDED."time_zone";

--> statement-breakpoint
-- Global reference: the industry-template INDEX (SEEDS/README
-- "P-004 (list) / P-015 (engine)"). Rows carry only key + bilingual label +
-- version + a minimal manifest marker in PHASE-004 — the versioned JSONB
-- manifests and the apply/switch machinery are PHASE-015 (BR-038).
CREATE TABLE IF NOT EXISTS "industry_templates" (
  "key" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "version" text NOT NULL DEFAULT '1.0.0',
  "manifest" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_industry_templates PRIMARY KEY ("key"),
  CONSTRAINT ck_industry_templates_key_shape CHECK ("key" ~ '^industry\.[a-z][a-z0-9_]{2,30}$'),
  CONSTRAINT ck_industry_templates_version_shape CHECK ("version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);

--> statement-breakpoint
-- Global reference: the bilingual default CoA template (CHART_OF_ACCOUNTS
-- §3, all 42 rows) with its purpose markers. `is_group` distinguishes the
-- reporting tree from postable leaves (V5); `purpose_key` carries the §2
-- markers (1:1 per template — partial unique below). Tenant instantiation
-- copies these rows into tenant-owned `accounts`/`account_purposes`
-- (PHASE-004 T5); posting-readiness rules V1–V6 begin in PHASE-007.
CREATE TABLE IF NOT EXISTS "chart_of_accounts_template" (
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "type" text NOT NULL,
  "is_group" boolean NOT NULL DEFAULT false,
  "parent_code" text,
  "purpose_key" text,
  CONSTRAINT pk_chart_of_accounts_template PRIMARY KEY ("code"),
  CONSTRAINT fk_coa_template_parent FOREIGN KEY ("parent_code")
    REFERENCES "chart_of_accounts_template" ("code") ON DELETE RESTRICT,
  CONSTRAINT ck_coa_template_type_values CHECK ("type" IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  CONSTRAINT ck_coa_template_code_shape CHECK ("code" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
-- 1:1 purpose markers inside the template (CHART_OF_ACCOUNTS §2: "one
-- active account per purpose per tenant" — enforced for the template too).
CREATE UNIQUE INDEX IF NOT EXISTS uq_coa_template_purpose
  ON "chart_of_accounts_template" ("purpose_key") WHERE "purpose_key" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- `tenants` profile expansion (expand-only per MIGRATION_STRATEGY §3).
-- New columns arrive nullable, legacy rows are backfilled with the primary
-- market defaults (SA/SAR — documented in the completion report), then the
-- spec-mandated NOT NULLs are applied.
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "base_currency" char(3);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "country_code" char(2);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "timezone" text NOT NULL DEFAULT 'UTC';
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "industry_template_key" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "deleted_at" timestamptz;
--> statement-breakpoint
UPDATE "tenants"
   SET "country_code" = 'SA', "base_currency" = 'SAR'
 WHERE "country_code" IS NULL OR "base_currency" IS NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "base_currency" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "country_code" SET NOT NULL;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tenants_base_currency') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT fk_tenants_base_currency
      FOREIGN KEY ("base_currency") REFERENCES "currencies" ("code") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tenants_country') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT fk_tenants_country
      FOREIGN KEY ("country_code") REFERENCES "countries" ("code") ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tenants_industry_template') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT fk_tenants_industry_template
      FOREIGN KEY ("industry_template_key") REFERENCES "industry_templates" ("key") ON DELETE RESTRICT;
  END IF;
END
$$;
--> statement-breakpoint
-- Status check swap (constraint swap, never an in-place edit): the TABLES
-- spec value list is ACTIVE | SUSPENDED | OFFBOARDED; the delivered
-- PHASE-002 constraint also allowed PENDING. The union keeps legacy rows
-- valid (expand rule) while adding OFFBOARDED — no code path creates
-- PENDING tenants (registration lands ACTIVE); reconciled in the report.
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS ck_tenants_status_values;
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT ck_tenants_status_values
  CHECK ("status" IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED'));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Platform-scope audit widening (PHASE-004 §2.9, pre-announced in
-- TABLES/tenancy-identity.md): platform events carry tenant_id NULL, the
-- `via_platform_admin` marker (matrix §3.10 platform_admin: "every action
-- audited with via_platform_admin"; §7 support rule 3) lands as an
-- additive column, and the single tenant_isolation policy widens to the
-- platform path (mirroring the `tenants` variant the check-rls checker
-- documents):
-- - SELECT USING: tenant rows for the tenant GUC; everything for the
--   platform GUC (cross-tenant review, platform.audit.view, S-07 surface);
-- - INSERT WITH CHECK: tenant rows via the tenant GUC; NULL-tenant
--   platform rows via the platform GUC ONLY — a platform session can
--   never forge a tenant-scoped row, and a tenant session can never
--   forge a platform row (the IS NULL clause blocks it);
-- - UPDATE/DELETE stay grant-denied + trigger-guarded (INV-003): the
--   generic policy's USING folding into DELETE visibility is irrelevant
--   without a DELETE grant.
ALTER TABLE "audit_events" ALTER COLUMN "tenant_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN IF NOT EXISTS "via_platform_admin" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "audit_events";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_events" TO erp_app, erp_readonly
  USING ("tenant_id" = erp.current_tenant_id() OR erp.platform_scope_active())
  WITH CHECK (("tenant_id" = erp.current_tenant_id())
              OR ("tenant_id" IS NULL AND erp.platform_scope_active()));
--> statement-breakpoint
-- Platform review surface pagination key + the platform-row partial index.
CREATE INDEX IF NOT EXISTS ix_audit_events_at_id ON "audit_events" ("at", "id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_audit_events_platform ON "audit_events" ("at") WHERE "tenant_id" IS NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Branches (TABLES §branches, PHASE-004 §2.4): operating units. Deactivation
-- (is_active = false) keeps history — no DELETE grant; inactive branches
-- reject new documents at the service layer (acceptance 3).
CREATE TABLE IF NOT EXISTS "branches" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "address" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_branches PRIMARY KEY ("id"),
  -- composite-FK anchor for future document/stock tables
  CONSTRAINT uq_branches_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_branches_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_branches_code_shape CHECK ("code" ~ '^[A-Za-z0-9_-]{1,20}$'),
  CONSTRAINT ck_branches_name_length CHECK (length("name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_branches_tenant ON "branches" ("tenant_id");

--> statement-breakpoint
-- Tenant settings typed key-value store (TABLES §tenant_settings,
-- CONFIGURATION_ENGINE §4/§L5): schema-validated by the owning module's
-- registry (settings-service), before/after audited, cache-invalidation
-- events on change (§9). INV-022: values configure, never override math.
CREATE TABLE IF NOT EXISTS "tenant_settings" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "updated_by" uuid,
  CONSTRAINT pk_tenant_settings PRIMARY KEY ("id"),
  CONSTRAINT uq_tenant_settings_tenant_key UNIQUE ("tenant_id", "key"),
  CONSTRAINT ck_tenant_settings_key_shape CHECK ("key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_.]*){1,3}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tenant_settings_tenant ON "tenant_settings" ("tenant_id");

--> statement-breakpoint
-- Subscription plans (TABLES §plans; DR-001 — platform-level, no tenant).
-- `name_ar` is an additive bilingual label column: the TABLES spec lists
-- only `name`, but PHASE-004 §4 requires "bilingual plan labels" —
-- deviation recorded in the completion report. limits/feature_keys values
-- are PLACEHOLDER pending the OQ-002 pricing pass (acceptance 10); the
-- columns themselves are the DR-001-endorsed shape (no schema change
-- needed at billing time).
CREATE TABLE IF NOT EXISTS "plans" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "price_amount" numeric(19,4) NOT NULL,
  "currency_code" char(3) NOT NULL,
  "billing_period" text NOT NULL DEFAULT 'MONTHLY',
  "limits" jsonb NOT NULL,
  "feature_keys" text[] NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_plans PRIMARY KEY ("id"),
  CONSTRAINT uq_plans_key UNIQUE ("key"),
  CONSTRAINT fk_plans_currency FOREIGN KEY ("currency_code")
    REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  CONSTRAINT ck_plans_price_nonnegative CHECK ("price_amount" >= 0),
  CONSTRAINT ck_plans_billing_period_values CHECK ("billing_period" IN ('MONTHLY', 'YEARLY')),
  CONSTRAINT ck_plans_key_shape CHECK ("key" ~ '^[a-z][a-z0-9_]*$')
);

--> statement-breakpoint
-- Tenant plan assignment (TABLES §subscriptions — MINIMAL schema; the
-- billing columns — provider lifecycle, dunning, proration — arrive with
-- PHASE-014). Manual assignment rows only in this phase (§2.5).
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "plan_id" uuid NOT NULL REFERENCES "plans" ("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "provider_ref" text,
  CONSTRAINT pk_subscriptions PRIMARY KEY ("id"),
  CONSTRAINT ck_subscriptions_status_values CHECK ("status" IN ('ACTIVE', 'PAST_DUE', 'CANCELLED')),
  CONSTRAINT ck_subscriptions_period_window CHECK ("period_start" <= "period_end")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_subscriptions_tenant ON "subscriptions" ("tenant_id");

--> statement-breakpoint
-- Materialized feature grants (TABLES §entitlements; SUBSCRIPTION §4):
-- re-materialized transactionally with the subscription record; MANUAL
-- overrides win while active; TRIAL/PROMO carry expires_at (NULL = while
-- the source holds). Server-side enforcement reads these rows
-- (BR-039); UI visibility is derived-only.
CREATE TABLE IF NOT EXISTS "entitlements" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "feature_key" text NOT NULL,
  "source" text NOT NULL DEFAULT 'PLAN',
  "expires_at" timestamptz,
  CONSTRAINT pk_entitlements PRIMARY KEY ("id"),
  CONSTRAINT uq_entitlements_tenant_feature UNIQUE ("tenant_id", "feature_key"),
  CONSTRAINT ck_entitlements_source_values CHECK ("source" IN ('PLAN', 'MANUAL', 'PROMO', 'TRIAL')),
  CONSTRAINT ck_entitlements_feature_key_shape CHECK ("feature_key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,2}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_entitlements_tenant ON "entitlements" ("tenant_id");

--> statement-breakpoint
-- Time-boxed support sessions (matrix §7; SECURITY_ARCHITECTURE
-- support-access): opt-in or ticket-required, default max 4h, auto-expiry
-- checked server-side on every action, tenant-visible + terminable.
CREATE TABLE IF NOT EXISTS "support_sessions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "platform_user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "opt_in" boolean NOT NULL DEFAULT false,
  "ticket_ref" text,
  "reason" text NOT NULL,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "closed_at" timestamptz,
  "closed_by" uuid REFERENCES "users" ("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_support_sessions PRIMARY KEY ("id"),
  CONSTRAINT ck_support_sessions_status_values CHECK ("status" IN ('ACTIVE', 'CLOSED', 'EXPIRED', 'TERMINATED')),
  CONSTRAINT ck_support_sessions_window CHECK ("expires_at" > "opened_at"),
  CONSTRAINT ck_support_sessions_opt_in_or_ticket
    CHECK ("opt_in" OR "ticket_ref" IS NOT NULL),
  CONSTRAINT ck_support_sessions_reason_length CHECK (length("reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_support_sessions_tenant_status ON "support_sessions" ("tenant_id", "status");

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): the standard macro on every new tenant-owned
-- table — branches, tenant_settings, subscriptions, entitlements,
-- support_sessions. Platform-scope access to these rows is per-operation
-- tenant scoping (ADR-0005): the platform console services enter the
-- TARGET tenant's UoW (`withTenant(target)`), never a blanket GUC.
SELECT erp.apply_tenant_policy('"branches"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"tenant_settings"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"subscriptions"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"entitlements"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"support_sessions"');

--> statement-breakpoint
-- RLS: `plans` — platform-scope path mirroring `tenants` (TENANT_ISOLATION
-- §3.2). Reads are additionally allowed for any established tenant scope
-- (plan labels + entitlement materialization resolve through the tenancy
-- module's services); writes exist only under the platform GUC (plan
-- definitions are platform staff territory — matrix platform.plans.manage).
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation_select ON "plans";
--> statement-breakpoint
CREATE POLICY tenant_isolation_select ON "plans" FOR SELECT TO erp_app, erp_readonly
  USING (erp.current_tenant_id() IS NOT NULL OR erp.platform_scope_active());
--> statement-breakpoint
DROP POLICY IF EXISTS platform_admin_write ON "plans";
--> statement-breakpoint
CREATE POLICY platform_admin_write ON "plans" FOR UPDATE TO erp_app
  USING (erp.platform_scope_active())
  WITH CHECK (erp.platform_scope_active());
--> statement-breakpoint
DROP POLICY IF EXISTS platform_admin_insert ON "plans";
--> statement-breakpoint
CREATE POLICY platform_admin_insert ON "plans" FOR INSERT TO erp_app
  WITH CHECK (erp.platform_scope_active());
--> statement-breakpoint
-- Migration-role seeding path (mirrors `template_seed` on roles): plan
-- definitions are reference data whose updates ship as migrations
-- (SEEDS/README rule 2) — erp_migrate may only ever touch them while
-- seeding; runtime writes belong to the platform admin path above.
DROP POLICY IF EXISTS plan_seed ON "plans";
--> statement-breakpoint
CREATE POLICY plan_seed ON "plans" TO erp_migrate
  USING (true)
  WITH CHECK (true);

--> statement-breakpoint
-- Grants (DATABASE_CONVENTIONS §9): least privilege. Reference tables are
-- SELECT-only; tenant-owned provisioning tables follow the lifecycle
-- pattern (no DELETE except entitlement revocation, which is the
-- materialization upsert's symmetric half).
REVOKE ALL ON "currencies", "countries", "industry_templates", "chart_of_accounts_template" FROM erp_app;
--> statement-breakpoint
GRANT SELECT ON "currencies", "countries", "industry_templates", "chart_of_accounts_template" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "currencies", "countries", "industry_templates", "chart_of_accounts_template" TO erp_readonly;
--> statement-breakpoint
REVOKE ALL ON "branches", "tenant_settings", "plans", "subscriptions", "entitlements", "support_sessions" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "branches" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_settings" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "plans" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "subscriptions" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "entitlements" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "support_sessions" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "branches", "tenant_settings", "plans", "subscriptions", "entitlements", "support_sessions" TO erp_readonly;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Pre-GUC + platform-plane definer extensions (mirroring the PHASE-0003
-- pattern: projections owned by the NOLOGIN BYPASSRLS `erp_definer` role —
-- FORCE RLS binds even the table owner, so controlled escape hatches MUST
-- live on the bypass role).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "entitlements", "subscriptions", "branches", "tenant_settings", "support_sessions", "plans" TO erp_definer;
--> statement-breakpoint
GRANT INSERT ON "tenants", "roles", "role_permissions" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_definer;

--> statement-breakpoint
-- BR-039 enforcement input: the ACTIVE (non-expired) feature-key set for a
-- tenant, resolved BEFORE any tenant GUC exists (guards run before the
-- interceptor). Read-only, exact-tenant scoped, no writes.
CREATE OR REPLACE FUNCTION erp.tenant_active_entitlements(p_tenant_id uuid)
RETURNS TABLE (feature_key text, source text, expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, erp
AS $$
  SELECT e.feature_key, e.source, e.expires_at
  FROM entitlements e
  WHERE e.tenant_id = p_tenant_id
    AND (e.expires_at IS NULL OR e.expires_at > now())
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.tenant_active_entitlements(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.tenant_active_entitlements(uuid) TO erp_app;

--> statement-breakpoint
-- Platform-operations tenant seeding (matrix §2 platform_admin: "platform.*
-- only; never holds tenant roles"): platform staff are users with an
-- ACTIVE membership in the dedicated operations tenant holding the
-- platform_admin role instantiated from the system template (same
-- clone-from-template path every tenant uses — template grants are the
-- permission source of truth). Fixed natural ids; idempotent. The first
-- platform staff USER is provisioned out-of-band by ops (DEVELOPMENT_SETUP
-- — same envelope as role passwords: no credentials in migrations).
CREATE OR REPLACE FUNCTION erp.seed_platform_tenant() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, erp
AS $$
DECLARE
  v_platform_tenant constant uuid := '20000000-0000-4000-8000-000000000001';
  v_platform_role constant uuid := '20000000-0000-4000-8000-000000000002';
  v_template_id uuid;
BEGIN
  INSERT INTO tenants (id, name, name_ar, status, base_currency, country_code, timezone)
  VALUES (v_platform_tenant, 'Platform Operations', 'عمليات المنصة',
          'ACTIVE', 'SAR', 'SA', 'Asia/Riyadh')
  ON CONFLICT (id) DO NOTHING;

  SELECT r.id INTO v_template_id
  FROM roles r
  WHERE r.key = 'platform_admin' AND r.tenant_id IS NULL AND r.is_system;
  IF v_template_id IS NULL THEN
    RAISE EXCEPTION 'platform_admin template missing — run migration 0005 first';
  END IF;

  INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
  VALUES (v_platform_role, v_platform_tenant, 'platform_admin',
          'Platform Admin', 'مدير المنصة', false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO role_permissions (role_id, tenant_id, permission_id)
  SELECT v_platform_role, v_platform_tenant, rp.permission_id
  FROM role_permissions rp
  WHERE rp.role_id = v_template_id AND rp.tenant_id IS NULL
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION erp.seed_platform_tenant() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION erp.seed_platform_tenant() TO erp_migrate;

--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
SET ROLE erp_migrate;
--> statement-breakpoint
SELECT erp.seed_platform_tenant();

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 6)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
