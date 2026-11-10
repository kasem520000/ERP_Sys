-- PHASE-009 · migration 0013 · tax engine & jurisdiction packs
--
-- Purpose (PHASE-009 §2, §4; TAX_ENGINE.md; ADR-0010; COUNTRY_PACKS.md):
-- - tax_treatments / jurisdictions / jurisdiction_tax_rates: GLOBAL reference
--   data (ADR-0005 / TENANT_ISOLATION §3 — no tenant_id, no RLS, read-only to
--   erp_app; seeded by erp_migrate only). Every rate row carries treatment,
--   rate, effective window, source_ref and verified_at NULL with the
--   compliance-matrix REQUIRES_VERIFICATION provenance (directive §1.12–
--   1.13: nothing here is VERIFIED — the per-fact checklist is the human
--   protocol this phase enables, never performs).
-- - tax_codes (tenant): code tenant-unique, bilingual name, bound
--   jurisdiction, default treatment, rate-snapshot policy.
-- - tax_registrations (tenant): per-jurisdiction REGISTERED /
--   NOT_REGISTERED / DEREGISTERED with number + effective dates; migrates
--   the provisional PHASE-004 `tax.registration.*` settings (expand step —
--   the registration service owns the dual-read window this phase).
-- - tax_pack_bindings (tenant): the staged pack-version pin per country
--   (preview → apply, audited; never retroactive — snapshots rule).
-- - tax_document_summaries (tenant): the per-document tax-summary substrate
--   (accumulated by treatment, rate, tax code at posting time) that the VAT
--   return aggregates and the INV-012 check (RC-06/RC-07) reconciles against
--   GL tax-account movements. Written ONLY by the tax posting adapter inside
--   the posting transaction (append-only 🔒 by grants + guard — a mutated
--   summary is exactly the RC-07 drift the check must catch, so the guard
--   keeps honest drift possible only via superuser tooling, mirroring the
--   cash_movements defense-in-depth posture while the app role cannot
--   rewrite posting history).
-- - vat_returns (tenant): draft → ready → filed-by-human with filing
--   metadata (tax.returns.mark_filed — the platform reports, humans file).
-- - e_invoicing_submissions (SCHEMA ONLY per FEATURE_CATALOG "023 (schema
--   009)"): the submission registry the EInvoicingAdapter port + fake
--   adapter exercise in tests; real adapters are PHASE-023 gated on verified
--   official specifications (RISK-005).
-- - Expand step (MIGRATION_STRATEGY §3): items.tax_code_id (nullable since
--   migration 0009) gains its FK; item_categories gains
--   default_tax_code_id (nullable, FK) for category-default resolution.
--
-- Doc-reality reconciliation (completion report): the phase document's T1
-- names this file 0010_tax.sql; 0010–0012 already exist (the same drift the
-- PHASE-007/008 reports recorded) — it ships as 0013. The phase §2.4 names
-- only SA's prior-rate history window as an example; the compliance files
-- record an asserted prior window for BH only (5% from 2019 — sa.md §2
-- deliberately does NOT assert the pre-2020-07 rate value, so no SA prior
-- row is seeded: fabricating it would violate directive §1.12). SA's
-- boundary fixture is therefore the window-start fail-closed probe
-- (2020-06-30 → NO_RATE_FOR_DATE) — recorded in the report.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Global reference: tax treatments (TAX_ENGINE §1 — the six, never
-- conflated, each with its distinct return-box semantics).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tax_treatments" (
  "key" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "taxable" boolean NOT NULL,
  "output_tax_box" text,
  "input_tax_box" text,
  "sort_order" integer NOT NULL,
  CONSTRAINT pk_tax_treatments PRIMARY KEY ("key"),
  CONSTRAINT ck_tax_treatments_key_values CHECK ("key" IN
    ('STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE', 'NOT_SUBJECT')),
  CONSTRAINT ck_tax_treatments_boxes CHECK (
    ("output_tax_box" IS NULL AND "input_tax_box" IS NULL)
    OR ("output_tax_box" IS NOT NULL AND "input_tax_box" IS NOT NULL)
  )
);
--> statement-breakpoint
COMMENT ON TABLE "tax_treatments" IS
  'PHASE-009 TAX_ENGINE §1: the six distinct treatments (seed-only global reference — zero-rated ≠ exempt, absence of VAT ≠ NOT_SUBJECT).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Global reference: jurisdiction packs (COUNTRY_PACKS §2–§5). The JSONB
-- descriptor carries the pack interchange form (formats, identifiers with
-- null-until-verified formats, e_invoicing regime, regulatory notes); pack
-- data is immutable per version — upgrades ship as new seed migrations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "jurisdictions" (
  "id" uuid NOT NULL,
  "country_code" char(2) NOT NULL,
  "country_name" text NOT NULL,
  "country_name_ar" text NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "minor_units" integer NOT NULL,
  "vat_status" text NOT NULL,
  "pack_version" text NOT NULL,
  "descriptor" jsonb NOT NULL,
  "verification_status" text NOT NULL DEFAULT 'REQUIRES_VERIFICATION',
  "source_ref" text NOT NULL,
  "verified_at" timestamptz,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_jurisdictions PRIMARY KEY ("id"),
  CONSTRAINT uq_jurisdictions_country UNIQUE ("country_code"),
  CONSTRAINT ck_jurisdictions_vat_status_values CHECK ("vat_status" IN
    ('VAT_IN_FORCE', 'VAT_PLANNED', 'NO_VAT')),
  CONSTRAINT ck_jurisdictions_verification_values CHECK ("verification_status" IN
    ('REQUIRES_VERIFICATION', 'VERIFIED')),
  CONSTRAINT ck_jurisdictions_verified_shape CHECK (
    ("verification_status" = 'VERIFIED') = ("verified_at" IS NOT NULL)
  ),
  CONSTRAINT ck_jurisdictions_minor_units CHECK ("minor_units" BETWEEN 0 AND 4)
);
--> statement-breakpoint
COMMENT ON TABLE "jurisdictions" IS
  'PHASE-009 ADR-0010 jurisdiction packs: versioned global reference data (read-only to erp_app; verified only via the compliance-matrix per-fact protocol).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Global reference: versioned, effective-dated rate rows (COUNTRY_PACKS §3
-- `tax_rates[]`). A rate change = a NEW row with effective_from, never an
-- edit (§6.3); prior windows keep effective_to so boundary fixtures pin.
-- Only STANDARD_RATED rows are seeded — the compliance files record exactly
-- the standard rates; ZERO_RATED is definitionally 0% (TAX_ENGINE §1) and
-- EXEMPT/OUT_OF_SCOPE/NOT_SUBJECT compute no tax by engine semantics, so no
-- unasserted values are invented here (directive §1.12–1.13).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "jurisdiction_tax_rates" (
  "id" uuid NOT NULL,
  "jurisdiction_id" uuid NOT NULL REFERENCES "jurisdictions" ("id") ON DELETE RESTRICT,
  "treatment" text NOT NULL,
  "rate" numeric(8,4) NOT NULL,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "source_ref" text NOT NULL,
  "verified_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_jurisdiction_tax_rates PRIMARY KEY ("id"),
  CONSTRAINT uq_jurisdiction_rates_window UNIQUE
    ("jurisdiction_id", "treatment", "effective_from"),
  CONSTRAINT fk_jurisdiction_rates_treatment FOREIGN KEY ("treatment")
    REFERENCES "tax_treatments" ("key") ON DELETE RESTRICT,
  CONSTRAINT ck_jurisdiction_rates_positive CHECK ("rate" >= 0),
  CONSTRAINT ck_jurisdiction_rates_treatment_values CHECK ("treatment" IN
    ('STANDARD_RATED', 'ZERO_RATED', 'REVERSE_CHARGE')),
  CONSTRAINT ck_jurisdiction_rates_window CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_jurisdiction_rates_lookup
  ON "jurisdiction_tax_rates" ("jurisdiction_id", "treatment", "effective_from");
--> statement-breakpoint
COMMENT ON TABLE "jurisdiction_tax_rates" IS
  'PHASE-009 TAX_ENGINE §3: effective-dated pack rates with source_ref + verified_at NULL (REQUIRES_VERIFICATION baseline research — never presented as compliance advice).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Tenant: tax codes (TAX_ENGINE §1 — the tenant-usable binder: default
-- treatment + the jurisdiction whose pack resolves the rate at document
-- date). Codes are per-jurisdiction: a tenant operating in SA + EG keeps
-- separate codes per pack; resolution NEVER crosses packs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tax_codes" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "country_code" char(2) NOT NULL REFERENCES "jurisdictions" ("country_code") ON DELETE RESTRICT,
  "default_treatment" text NOT NULL,
  "snapshot_policy" text NOT NULL DEFAULT 'STAMP_AT_POSTING',
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_tax_codes PRIMARY KEY ("id"),
  CONSTRAINT uq_tax_codes_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_tax_codes_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT uq_tax_codes_tenant_country_code UNIQUE ("tenant_id", "country_code", "code"),
  CONSTRAINT ck_tax_codes_treatment_values CHECK ("default_treatment" IN
    ('STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE', 'NOT_SUBJECT')),
  CONSTRAINT ck_tax_codes_status_values CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_tax_codes_policy_values CHECK ("snapshot_policy" IN ('STAMP_AT_POSTING', 'STAMP_AT_DRAFT')),
  CONSTRAINT ck_tax_codes_code_shape CHECK ("code" ~ '^[A-Za-z0-9_-]{1,20}$'),
  CONSTRAINT ck_tax_codes_code_length CHECK (length("code") BETWEEN 1 AND 20)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tax_codes_tenant_country_status
  ON "tax_codes" ("tenant_id", "country_code", "status");
--> statement-breakpoint
COMMENT ON TABLE "tax_codes" IS
  'PHASE-009 tenant tax codes: default treatment + bound jurisdiction; the resolver stamps the pack rate at document date (fail-closed outside the seeded window).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Tenant: tax registrations (TAX_ENGINE §1): per-jurisdiction status with
-- number + effective dates. The expand step of the PHASE-004 settings
-- migration — the registration service reads these rows first and falls back
-- to the legacy `tax.registration.*` settings during the dual-read window.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tax_registrations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "country_code" char(2) NOT NULL REFERENCES "jurisdictions" ("country_code") ON DELETE RESTRICT,
  "status" text NOT NULL,
  "registration_number" text,
  "effective_from" date NOT NULL,
  "effective_to" date,
  "deregistered_at" date,
  "note" text,
  CONSTRAINT pk_tax_registrations PRIMARY KEY ("id"),
  CONSTRAINT uq_tax_registrations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_tax_registrations_tenant_country UNIQUE ("tenant_id", "country_code"),
  CONSTRAINT ck_tax_registrations_status_values CHECK ("status" IN
    ('REGISTERED', 'NOT_REGISTERED', 'DEREGISTERED')),
  CONSTRAINT ck_tax_registrations_number_shape CHECK (
    ("status" = 'REGISTERED' AND "registration_number" IS NOT NULL
       AND length("registration_number") BETWEEN 3 AND 50)
    OR ("status" <> 'REGISTERED' AND "registration_number" IS NULL)
  ),
  CONSTRAINT ck_tax_registrations_dereg_shape CHECK (
    ("status" = 'DEREGISTERED') = ("deregistered_at" IS NOT NULL)
  ),
  CONSTRAINT ck_tax_registrations_window CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tax_registrations_tenant_country
  ON "tax_registrations" ("tenant_id", "country_code");
--> statement-breakpoint
COMMENT ON TABLE "tax_registrations" IS
  'PHASE-009 per-jurisdiction registrations (TAX_ENGINE §1): REGISTERED computes VAT; NOT_REGISTERED/DEREGISTERED resolve NOT_SUBJECT — posted snapshots never rewrite on transition.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Tenant: staged pack bindings (COUNTRY_PACKS §6.4): the tenant's pinned
-- pack version per country + the apply audit trail. Preview diffs render
-- from rate-window history; apply records version + actor + audit event.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tax_pack_bindings" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "country_code" char(2) NOT NULL REFERENCES "jurisdictions" ("country_code") ON DELETE RESTRICT,
  "pack_version" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  "applied_by" uuid,
  CONSTRAINT pk_tax_pack_bindings PRIMARY KEY ("id"),
  CONSTRAINT uq_tax_pack_bindings_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_tax_pack_bindings_tenant_country UNIQUE ("tenant_id", "country_code")
);
--> statement-breakpoint
COMMENT ON TABLE "tax_pack_bindings" IS
  'PHASE-009 T13 staged rollout: tenant pack-version pin per country (preview → apply, audited; posted snapshots are never rewritten — BR-033).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Tenant: document tax summaries (TAX_ENGINE §2 accumulation substrate +
-- INV-012's document side): one row per (source document, treatment, rate,
-- tax code) group written by the tax posting adapter INSIDE the posting
-- transaction. Append-only 🔒 (grants — no UPDATE/DELETE for erp_app): the
-- VAT return and the RC-06/RC-07 checks read these rows; RC-07's seeded
-- drift is a superuser-tooling mutation by construction (the app role
-- cannot rewrite posting history).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tax_document_summaries" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "document_date" date NOT NULL,
  "fiscal_period_id" uuid,
  "country_code" char(2) NOT NULL REFERENCES "jurisdictions" ("country_code") ON DELETE RESTRICT,
  "direction" text NOT NULL,
  "treatment" text NOT NULL,
  "rate" numeric(8,4) NOT NULL,
  "tax_code_id" uuid,
  "taxable_base" numeric(19,4) NOT NULL,
  "tax_amount" numeric(19,4) NOT NULL,
  "snapshot" jsonb NOT NULL,
  CONSTRAINT pk_tax_document_summaries PRIMARY KEY ("id"),
  CONSTRAINT uq_tax_document_summaries_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_tax_document_summaries_group UNIQUE
    ("tenant_id", "source_type", "source_id", "direction", "treatment", "rate", "tax_code_id"),
  CONSTRAINT ck_tax_document_summaries_direction CHECK ("direction" IN ('OUTPUT', 'INPUT')),
  CONSTRAINT ck_tax_document_summaries_treatment CHECK ("treatment" IN
    ('STANDARD_RATED', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE', 'NOT_SUBJECT')),
  CONSTRAINT ck_tax_document_summaries_source CHECK ("source_type" ~ '^[a-z][a-z0-9_]{2,39}$'),
  CONSTRAINT fk_tax_document_summaries_tax_code FOREIGN KEY ("tax_code_id", "tenant_id")
    REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tax_summaries_period
  ON "tax_document_summaries" ("tenant_id", "country_code", "document_date", "direction");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tax_summaries_source
  ON "tax_document_summaries" ("tenant_id", "source_type", "source_id");
--> statement-breakpoint
COMMENT ON TABLE "tax_document_summaries" IS
  'PHASE-009 INV-012 document side: per-document (treatment, rate, tax code) groups accumulated at posting; the VAT return aggregates these and reconciles them against GL tax-account movements (RC-06).';

--> statement-breakpoint
-- Append-only guard for tax_document_summaries (defense in depth beyond the
-- grants, mirroring cash_movements): the app role never rewrites tax
-- history; RC-07 drift fixtures mutate via the test superuser only.
CREATE OR REPLACE FUNCTION erp.tax_summaries_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tax_document_summaries are append-only (INV-012 substrate): % on row % is forbidden',
    TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_tax_summaries_guard ON "tax_document_summaries";
--> statement-breakpoint
CREATE TRIGGER trg_tax_summaries_guard
  BEFORE UPDATE OR DELETE ON "tax_document_summaries"
  FOR EACH ROW EXECUTE FUNCTION erp.tax_summaries_guard();
--> statement-breakpoint
COMMENT ON FUNCTION erp.tax_summaries_guard() IS
  'PHASE-009 INV-012: document tax summaries are immutable after posting (grants + trigger — RC-07 drift only via superuser tooling, never the app role).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Tenant: VAT returns (TAX_ENGINE §4): the bilingual aggregation with the
-- INV-012 side-by-side cross-check; READY only when both sides agree;
-- FILED is a human action recorded with metadata (the platform reports).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "vat_returns" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "country_code" char(2) NOT NULL REFERENCES "jurisdictions" ("country_code") ON DELETE RESTRICT,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "summary" jsonb NOT NULL,
  "cross_check" jsonb NOT NULL,
  "cross_check_ok" boolean NOT NULL DEFAULT false,
  "prepared_at" timestamptz,
  "prepared_by" uuid,
  "filed_at" timestamptz,
  "filed_by" uuid,
  "filing_reference" text,
  "filing_note" text,
  CONSTRAINT pk_vat_returns PRIMARY KEY ("id"),
  CONSTRAINT uq_vat_returns_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_vat_returns_window UNIQUE ("tenant_id", "country_code", "period_start", "period_end"),
  CONSTRAINT ck_vat_returns_status_values CHECK ("status" IN ('DRAFT', 'READY', 'FILED')),
  CONSTRAINT ck_vat_returns_period CHECK ("period_end" >= "period_start"),
  CONSTRAINT ck_vat_returns_filed_shape CHECK (
    ("status" = 'FILED') = ("filed_at" IS NOT NULL AND "filed_by" IS NOT NULL)
  ),
  -- Non-DRAFT requires a preparation timestamp; a REVOKED ready (mismatch
  -- found on re-prepare — RC-07) legitimately falls back to DRAFT and keeps
  -- its prepared_at history (the audit trail of the failed preparation).
  CONSTRAINT ck_vat_returns_prepared_shape CHECK (
    "status" = 'DRAFT' OR "prepared_at" IS NOT NULL
  ),
  CONSTRAINT ck_vat_returns_filing_reference_length CHECK ("filing_reference" IS NULL OR length("filing_reference") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_vat_returns_tenant_period
  ON "vat_returns" ("tenant_id", "country_code", "period_start", "period_end");
--> statement-breakpoint
COMMENT ON TABLE "vat_returns" IS
  'PHASE-009 VAT return v1: statuses draft → ready (INV-012 cross-check green) → filed-by-human (tax.returns.mark_filed, audited — the platform never files).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Tenant: e-invoicing submission registry (SCHEMA ONLY — FEATURE_CATALOG
-- "023 (schema 009)"; E_INVOICING_ARCHITECTURE §1). The port + fake adapter
-- exercise the lifecycle states in PHASE-009 tests; real adapters ship in
-- PHASE-023 gated on verified official specs (RISK-005).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "e_invoicing_submissions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "country_code" char(2) NOT NULL REFERENCES "jurisdictions" ("country_code") ON DELETE RESTRICT,
  "adapter_id" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "payload_digest" text,
  "authority_reference" text,
  "submitted_at" timestamptz,
  "responded_at" timestamptz,
  "error_detail" jsonb,
  CONSTRAINT pk_e_invoicing_submissions PRIMARY KEY ("id"),
  CONSTRAINT uq_e_invoicing_submissions_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_e_invoicing_submissions_source UNIQUE ("tenant_id", "source_type", "source_id"),
  CONSTRAINT ck_e_invoicing_status_values CHECK ("status" IN
    ('PENDING', 'GENERATED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'FAILED')),
  CONSTRAINT ck_e_invoicing_source CHECK ("source_type" ~ '^[a-z][a-z0-9_]{2,39}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_e_invoicing_tenant_status
  ON "e_invoicing_submissions" ("tenant_id", "country_code", "status");
--> statement-breakpoint
COMMENT ON TABLE "e_invoicing_submissions" IS
  'PHASE-009 schema-only registry (real integrations PHASE-023): submission lifecycle PENDING → GENERATED → SUBMITTED → ACCEPTED/REJECTED/FAILED per adapter run.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Expand step (MIGRATION_STRATEGY §3): the PHASE-006 reserved columns gain
-- their FKs — items.tax_code_id → tax_codes, and item_categories gains the
-- nullable category-default column (T5: item/category defaults).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_items_tax_code'
  ) THEN
    ALTER TABLE "items" ADD CONSTRAINT fk_items_tax_code
      FOREIGN KEY ("tax_code_id", "tenant_id")
      REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "item_categories" ADD COLUMN IF NOT EXISTS "default_tax_code_id" uuid;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_item_categories_default_tax_code'
  ) THEN
    ALTER TABLE "item_categories" ADD CONSTRAINT fk_item_categories_default_tax_code
      FOREIGN KEY ("default_tax_code_id", "tenant_id")
      REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
-- The treasury expenses' reserved tax_code_id (migration 0012) gains its FK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_expenses_tax_code'
  ) THEN
    ALTER TABLE "expenses" ADD CONSTRAINT fk_expenses_tax_code
      FOREIGN KEY ("tax_code_id", "tenant_id")
      REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
COMMENT ON COLUMN "item_categories"."default_tax_code_id" IS
  'PHASE-009 category-default tax code (T5): item resolution falls back to the category default when the item carries no direct code.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- RLS (TENANT_ISOLATION §2): standard macro on every new tenant-owned
-- table. The global reference tables (tax_treatments, jurisdictions,
-- jurisdiction_tax_rates) deliberately carry NO RLS — they are pack data
-- (§3 of TENANT_ISOLATION: platform-owned, read-only to erp_app).
-- ---------------------------------------------------------------------------
SELECT erp.apply_tenant_policy('"tax_codes"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"tax_registrations"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"tax_pack_bindings"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"tax_document_summaries"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"vat_returns"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"e_invoicing_submissions"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Grants. Global pack tables: SELECT ONLY for erp_app (writes rejected —
-- asserted by the grant test; seed updates ship as erp_migrate migrations).
-- tax_document_summaries is append-only 🔒 (SELECT/INSERT — INV-012's
-- substrate; UPDATE/DELETE denied for erp_app, guard trigger as defense in
-- depth). Everything else: SELECT/INSERT/UPDATE (lifecycle states); posted
-- immutability is service-enforced with the CHECK shape constraints.
-- ---------------------------------------------------------------------------
REVOKE ALL ON "tax_treatments", "jurisdictions", "jurisdiction_tax_rates",
  "tax_codes", "tax_registrations", "tax_pack_bindings",
  "tax_document_summaries", "vat_returns", "e_invoicing_submissions"
  FROM erp_app;
--> statement-breakpoint
GRANT SELECT ON "tax_treatments", "jurisdictions", "jurisdiction_tax_rates" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tax_codes" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tax_registrations" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tax_pack_bindings" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "tax_document_summaries" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "vat_returns" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "e_invoicing_submissions" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "tax_treatments", "jurisdictions", "jurisdiction_tax_rates",
  "tax_codes", "tax_registrations", "tax_pack_bindings",
  "tax_document_summaries", "vat_returns", "e_invoicing_submissions"
  TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (support-access read-all proxy composition, as prior phases).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "tax_treatments", "jurisdictions", "jurisdiction_tax_rates",
  "tax_codes", "tax_registrations", "tax_pack_bindings",
  "tax_document_summaries", "vat_returns", "e_invoicing_submissions"
  TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Seeds — tax treatments (TAX_ENGINE §1: return-box semantics verbatim:
-- zero-rated reports in the taxable-0% box, exempt in its own no-recovery
-- box; out-of-scope and reverse-charge distinct; NOT_SUBJECT the honest
-- record for unregistered/no-VAT).
-- ---------------------------------------------------------------------------
INSERT INTO "tax_treatments"
  ("key", "name", "name_ar", "taxable", "output_tax_box", "input_tax_box", "sort_order")
VALUES
  ('STANDARD_RATED', 'Standard rated', 'خاضع للسعر الأساسي', true,
   'OUTPUT_STANDARD', 'INPUT_RECOVERABLE', 1),
  ('ZERO_RATED', 'Zero rated', 'خاضع بسعر صفر', true,
   'OUTPUT_ZERO_RATED', 'INPUT_RECOVERABLE', 2),
  ('EXEMPT', 'Exempt', 'معفى', false,
   'OUTPUT_EXEMPT', 'INPUT_EXPENSED', 3),
  ('OUT_OF_SCOPE', 'Out of scope', 'خارج النطاق', false, NULL, NULL, 4),
  ('REVERSE_CHARGE', 'Reverse charge', 'التوريد العكسي', true,
   'OUTPUT_REVERSE_CHARGE', 'INPUT_RECOVERABLE', 5),
  ('NOT_SUBJECT', 'Not subject', 'غير خاضع', false, NULL, NULL, 6)
ON CONFLICT ("key") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
    "taxable" = EXCLUDED."taxable",
    "output_tax_box" = EXCLUDED."output_tax_box",
    "input_tax_box" = EXCLUDED."input_tax_box",
    "sort_order" = EXCLUDED."sort_order";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Seeds — the 10 jurisdiction packs (COUNTRY_PACKS §5 summary, compliance-
-- matrix per-country files). Every regulatory fact ships as baseline
-- research: verification_status REQUIRES_VERIFICATION + verified_at NULL +
-- the official source to verify against. Identifier formats stay null
-- until verified (labels only); NO_VAT packs ship fully (formats,
-- identifiers, invoice baseline) with vat_status NO_VAT — absence of VAT ≠
-- absence of obligations (directive §6). Effective dates: the compliance
-- files record month granularity — seeded as the first of the recorded
-- month (documented mapping in the completion report).
-- ---------------------------------------------------------------------------
INSERT INTO "jurisdictions"
  ("id", "country_code", "country_name", "country_name_ar", "currency_code",
   "minor_units", "vat_status", "pack_version", "descriptor",
   "verification_status", "source_ref")
VALUES
  ('13a00000-0000-7000-8000-000000000001', 'SA', 'Saudi Arabia', 'المملكة العربية السعودية', 'SAR',
   2, 'VAT_IN_FORCE', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar","en"],"time_zone":"Asia/Riyadh","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"VAT","ar":"ضريبة القيمة المضافة"},"e_invoicing":{"regime":"ZATCA_FATOORAH","adapter_id":"zatca","status":"MANDATORY_IN_FORCE","verification":{"status":"REQUIRES_VERIFICATION","official_source":"https://zatca.gov.sa","verification_phase":"PHASE-023"}},"business_identifiers":{"vat_registration_number":{"label":{"en":"VAT registration number","ar":"الرقم الضريبي"},"format":null},"commercial_registration":{"label":{"en":"Commercial Registration (CR)","ar":"السجل التجاري"},"format":null}},"regulatory_notes":["Baseline research snapshot; all regulatory values REQUIRES_VERIFICATION (compliance-matrix/sa.md).","Prior lower rate before 2020-07 exists but its value is deliberately not asserted (sa.md §2) — no seed row; documents before the window fail closed."]}',
   'REQUIRES_VERIFICATION', 'zatca.gov.sa (baseline research; compliance-matrix/sa.md)'),
  ('13a00000-0000-7000-8000-000000000002', 'AE', 'United Arab Emirates', 'الإمارات العربية المتحدة', 'AED',
   2, 'VAT_IN_FORCE', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar","en"],"time_zone":"Asia/Dubai","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"VAT","ar":"ضريبة القيمة المضافة"},"e_invoicing":{"regime":"AE_MOF_PLANNED","adapter_id":null,"status":"VAT_PLANNED_EINVOICING","verification":{"status":"REQUIRES_VERIFICATION","official_source":"https://tax.gov.ae","verification_phase":"PHASE-023"}},"business_identifiers":{"vat_registration_number":{"label":{"en":"TRN (Tax Registration Number)","ar":"رقم التسجيل الضريبي"},"format":null},"trade_license":{"label":{"en":"Trade license number","ar":"رقم الرخصة التجارية"},"format":null}},"regulatory_notes":["Baseline research snapshot; all regulatory values REQUIRES_VERIFICATION (compliance-matrix/ae.md).","E-invoicing announced/planned via MoF — adapter slot dormant until official specs (E_INVOICING_ARCHITECTURE §5)."]}',
   'REQUIRES_VERIFICATION', 'tax.gov.ae (baseline research; compliance-matrix/ae.md)'),
  ('13a00000-0000-7000-8000-000000000003', 'BH', 'Bahrain', 'مملكة البحرين', 'BHD',
   3, 'VAT_IN_FORCE', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar","en"],"time_zone":"Asia/Bahrain","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"VAT","ar":"ضريبة القيمة المضافة"},"e_invoicing":{"regime":"NONE","adapter_id":null,"status":"NONE","verification":{"status":"REQUIRES_VERIFICATION","official_source":"https://nbr.gov.bh","verification_phase":"PHASE-023"}},"business_identifiers":{"vat_registration_number":{"label":{"en":"VAT registration number","ar":"الرقم الضريبي"},"format":null}},"regulatory_notes":["Baseline research snapshot; all regulatory values REQUIRES_VERIFICATION (compliance-matrix/bh.md).","Prior rate window recorded: 5% from 2019 (VAT introduction) until the 2022 increase — the seeded rate-change boundary fixture."]}',
   'REQUIRES_VERIFICATION', 'nbr.gov.bh (baseline research; compliance-matrix/bh.md)'),
  ('13a00000-0000-7000-8000-000000000004', 'KW', 'Kuwait', 'دولة الكويت', 'KWD',
   3, 'NO_VAT', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar","en"],"time_zone":"Asia/Kuwait","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"VAT","ar":"ضريبة القيمة المضافة"},"e_invoicing":{"regime":"NONE","adapter_id":null,"status":"NONE","verification":{"status":"REQUIRES_VERIFICATION","official_source":"https://mof.gov.kw","verification_phase":"PHASE-023"}},"business_identifiers":{},"regulatory_notes":["NO_VAT at research date; VAT repeatedly proposed but not enacted (compliance-matrix/kw.md) — a future introduction is a pack version bump, no core change (RISK-008).","Absence of VAT ≠ absence of obligations (directive §6): the pack ships fully with formats + identifiers; documents run without VAT fields and no VAT postings."]}',
   'REQUIRES_VERIFICATION', 'mof.gov.kw / tax.gov.kw (baseline research; compliance-matrix/kw.md)'),
  ('13a00000-0000-7000-8000-000000000005', 'OM', 'Oman', 'سلطنة عمان', 'OMR',
   3, 'VAT_IN_FORCE', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar","en"],"time_zone":"Asia/Muscat","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"VAT","ar":"ضريبة القيمة المضافة"},"e_invoicing":{"regime":"NONE","adapter_id":null,"status":"NONE","verification":{"status":"REQUIRES_VERIFICATION","official_source":"https://taxoman.gov.om","verification_phase":"PHASE-023"}},"business_identifiers":{"vat_registration_number":{"label":{"en":"VAT registration number","ar":"الرقم الضريبي"},"format":null}},"regulatory_notes":["Baseline research snapshot; all regulatory values REQUIRES_VERIFICATION (compliance-matrix/om.md)."]}',
   'REQUIRES_VERIFICATION', 'taxoman.gov.om (baseline research; compliance-matrix/om.md)'),
  ('13a00000-0000-7000-8000-000000000006', 'QA', 'Qatar', 'دولة قطر', 'QAR',
   2, 'VAT_PLANNED', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar","en"],"time_zone":"Asia/Qatar","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"VAT","ar":"ضريبة القيمة المضافة"},"e_invoicing":{"regime":"NONE","adapter_id":null,"status":"NONE","verification":{"status":"REQUIRES_VERIFICATION","official_source":"https://gta.gov.qa","verification_phase":"PHASE-023"}},"business_identifiers":{},"regulatory_notes":["VAT_PLANNED — introduction announced, no date asserted (compliance-matrix/qa.md); behaves as NOT_SUBJECT until a rate row ships with a verified pack version.","Excise on some goods exists (baseline) — out of current pack scope, future pack feature via decision record."]}',
   'REQUIRES_VERIFICATION', 'gta.gov.qa (baseline research; compliance-matrix/qa.md)'),
  ('13a00000-0000-7000-8000-000000000007', 'YE', 'Yemen', 'الجمهورية اليمنية', 'YER',
   2, 'NO_VAT', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar"],"time_zone":"Asia/Aden","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"VAT","ar":"ضريبة القيمة المضافة"},"e_invoicing":{"regime":"NONE","adapter_id":null,"status":"NONE","verification":{"status":"REQUIRES_VERIFICATION","official_source":null,"verification_phase":"PHASE-023"}},"business_identifiers":{},"regulatory_notes":["NO_VAT at research date; legacy sales-tax concepts exist but are not asserted (compliance-matrix/ye.md) — official portal TBC; treated as NO_VAT with standard commercial invoicing until verified."]}',
   'REQUIRES_VERIFICATION', 'Yemeni tax authority (portal TBC; compliance-matrix/ye.md)'),
  ('13a00000-0000-7000-8000-000000000008', 'EG', 'Egypt', 'جمهورية مصر العربية', 'EGP',
   2, 'VAT_IN_FORCE', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar","en"],"time_zone":"Africa/Cairo","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"VAT","ar":"ضريبة القيمة المضافة"},"e_invoicing":{"regime":"ETA_EINVOICING","adapter_id":"eta_eg","status":"MANDATORY_IN_FORCE","verification":{"status":"REQUIRES_VERIFICATION","official_source":"https://eta.gov.eg","verification_phase":"PHASE-023"}},"business_identifiers":{"vat_registration_number":{"label":{"en":"VAT registration number","ar":"الرقم الضريبي"},"format":null}},"regulatory_notes":["Baseline research snapshot; all regulatory values REQUIRES_VERIFICATION (compliance-matrix/eg.md).","Schedule/additional rates may exist in schedule-based VAT systems — none asserted (eg.md §2).","Time zone Africa/Cairo observes DST — the notable regional exception (VERIFIED_BASELINE per IANA)."]}',
   'REQUIRES_VERIFICATION', 'eta.gov.eg (baseline research; compliance-matrix/eg.md)'),
  ('13a00000-0000-7000-8000-000000000009', 'JO', 'Jordan', 'المملكة الأردنية الهاشمية', 'JOD',
   3, 'VAT_IN_FORCE', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar","en"],"time_zone":"Asia/Amman","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"GST (General Sales Tax)","ar":"ضريبة المبيعات العامة"},"e_invoicing":{"regime":"NONE","adapter_id":null,"status":"NONE","verification":{"status":"REQUIRES_VERIFICATION","official_source":"https://istd.gov.jo","verification_phase":"PHASE-023"}},"business_identifiers":{"vat_registration_number":{"label":{"en":"GST registration number","ar":"الرقم الضريبي"},"format":null}},"regulatory_notes":["Jordan GST is modeled by the VAT engine with local terminology (ضريبة المبيعات / General Sales Tax) recorded here so documents + reports show correct terminology (COUNTRY_PACKS §5).","Baseline research snapshot; all regulatory values REQUIRES_VERIFICATION (compliance-matrix/jo.md)."]}',
   'REQUIRES_VERIFICATION', 'istd.gov.jo / taxes.gov.jo (baseline research; compliance-matrix/jo.md)'),
  ('13a00000-0000-7000-8000-00000000000a', 'IQ', 'Iraq', 'جمهورية العراق', 'IQD',
   3, 'NO_VAT', '1.0.0-baseline',
   '{"default_language":"ar","supported_languages":["ar","en"],"time_zone":"Asia/Baghdad","date_format":"dd/MM/yyyy","number_format":{"decimal_separator":".","grouping_separator":",","digit_default":"latn"},"address_format":{"order":["line1","line2","city","district","postal_code","country"]},"tax_scheme_label":{"en":"VAT","ar":"ضريبة القيمة المضافة"},"e_invoicing":{"regime":"NONE","adapter_id":null,"status":"NONE","verification":{"status":"REQUIRES_VERIFICATION","official_source":"https://mof.gov.iq","verification_phase":"PHASE-023"}},"business_identifiers":{},"regulatory_notes":["NO_VAT at research date; proposals exist, not enacted (compliance-matrix/iq.md) — GCT (General Commission for Taxes) matters remain future pack features via decision record."]}',
   'REQUIRES_VERIFICATION', 'mof.gov.iq (baseline research; compliance-matrix/iq.md)')
ON CONFLICT ("country_code") DO UPDATE
  SET "country_name" = EXCLUDED."country_name",
    "country_name_ar" = EXCLUDED."country_name_ar",
    "currency_code" = EXCLUDED."currency_code",
    "minor_units" = EXCLUDED."minor_units",
    "vat_status" = EXCLUDED."vat_status",
    "pack_version" = EXCLUDED."pack_version",
    "descriptor" = EXCLUDED."descriptor",
    "verification_status" = EXCLUDED."verification_status",
    "source_ref" = EXCLUDED."source_ref",
    "is_active" = true;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Seeds — rate windows, ONLY the values the compliance files assert (each
-- with its official source + verified_at NULL; effective month → first of
-- month). BH carries the recorded prior window (5% 2019 → 2021-12-31;
-- 10% from 2022-01-01) — the rate-change boundary fixture. SA/AE/OM/EG/JO
-- seed only their recorded windows: a document dated before the window
-- fails closed (NO_RATE_FOR_DATE — the honest boundary, sa.md deliberately
-- not asserting the pre-window rate). NO_VAT/PLANNED packs ship NO rows.
-- ---------------------------------------------------------------------------
INSERT INTO "jurisdiction_tax_rates"
  ("id", "jurisdiction_id", "treatment", "rate", "effective_from", "effective_to", "source_ref")
VALUES
  ('13b00000-0000-7000-8000-000000000001', '13a00000-0000-7000-8000-000000000001', 'STANDARD_RATED', 15.0000, '2020-07-01', NULL,
   'zatca.gov.sa — 15% since Jul 2020 (sa.md §2; REQUIRES_VERIFICATION)'),
  ('13b00000-0000-7000-8000-000000000002', '13a00000-0000-7000-8000-000000000002', 'STANDARD_RATED', 5.0000, '2018-01-01', NULL,
   'tax.gov.ae — 5% since Jan 2018 (ae.md §2; REQUIRES_VERIFICATION)'),
  ('13b00000-0000-7000-8000-000000000003', '13a00000-0000-7000-8000-000000000003', 'STANDARD_RATED', 5.0000, '2019-01-01', '2021-12-31',
   'nbr.gov.bh — 5% from 2019 (VAT introduction) until the 2022 increase (bh.md §2; REQUIRES_VERIFICATION)'),
  ('13b00000-0000-7000-8000-000000000004', '13a00000-0000-7000-8000-000000000003', 'STANDARD_RATED', 10.0000, '2022-01-01', NULL,
   'nbr.gov.bh — 10% since Jan 2022 (bh.md §2; REQUIRES_VERIFICATION)'),
  ('13b00000-0000-7000-8000-000000000005', '13a00000-0000-7000-8000-000000000005', 'STANDARD_RATED', 5.0000, '2021-04-01', NULL,
   'taxoman.gov.om — 5% since Apr 2021 (om.md §2; REQUIRES_VERIFICATION)'),
  ('13b00000-0000-7000-8000-000000000006', '13a00000-0000-7000-8000-000000000008', 'STANDARD_RATED', 14.0000, '2017-01-01', NULL,
   'eta.gov.eg — 14% since 2017, VAT law era (eg.md §2; REQUIRES_VERIFICATION)'),
  ('13b00000-0000-7000-8000-000000000007', '13a00000-0000-7000-8000-000000000009', 'STANDARD_RATED', 16.0000, '2018-01-01', NULL,
   'istd.gov.jo / taxes.gov.jo — GST 16% since 2018, most goods/services (jo.md §2; REQUIRES_VERIFICATION)')
ON CONFLICT ("jurisdiction_id", "treatment", "effective_from") DO UPDATE
  SET "rate" = EXCLUDED."rate",
    "effective_to" = EXCLUDED."effective_to",
    "source_ref" = EXCLUDED."source_ref",
    "verified_at" = NULL;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 13)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
