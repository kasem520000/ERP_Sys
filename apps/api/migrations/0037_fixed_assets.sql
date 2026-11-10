-- PHASE-026 · migration 0037 · fixed assets & depreciation
--
-- Purpose (PHASE-026 §4 Design Impact + DR-002): the fixed_assets module
-- lands per the option-A decision — six tenant-owned tables (asset
-- categories with purpose links BR-041, the asset register with the NBV
-- floor substrate, monthly depreciation runs + append-only 🔒 lines,
-- disposal documents, audited revaluations), all RLS'd with composite
-- tenant FKs; depreciation_lines is append-only by grants + guard trigger
-- (INV-003 pattern — even repository misuse cannot rewrite depreciation
-- history; the offboarding purge path admits DELETE only under
-- erp.purge_mode, mirroring the 0036 audit-guard exception).
--
-- CoA template (§11): the six v2.0 purpose keys (CHART_OF_ACCOUNTS §2)
-- gain template accounts — 1210 FIXED_ASSET (existing row, purpose added),
-- 1220 ACCUM_DEPRECIATION (new contra-asset leaf), 5300
-- DEPRECIATION_EXPENSE (existing row, purpose added), 4910
-- ASSET_DISPOSAL_GAIN, 5910 ASSET_DISPOSAL_LOSS, 3210 REVALUATION_RESERVE —
-- so provisioned tenants resolve every fixed-assets purpose from day one;
-- tenants map their own accounts via account_purposes (fail closed on
-- PURPOSE_NOT_MAPPED per POSTING_ENGINE §3).
--
-- Permission seeds (AUTHORIZATION_MATRIX §3.11 — 13 keys; drift checker
-- requires matrix ↔ seed parity): categories.manage, assets.view/create/
-- manage, depreciation_runs.view/run/post, revaluations.create/post,
-- disposals.create/approve/post, reports.view. The §4 SoD row
-- (disposals.approve from a second user) is service-enforced + audited.
--
-- Plan grants (FEATURE_CATALOG §19 — 7 feature keys): the fixed_assets set
-- joins business + enterprise (the manufacturing/tier-4 precedent);
-- starter does NOT get them.
--
-- Five §9 enums as CHECK constraints (DATA_DICTIONARY enum registry):
-- asset_status, depreciation_method, disposal_kind, revaluation_status,
-- depreciation_run_status. No migrations touch existing tables (purely
-- additive; expand-compatible per MIGRATION_STRATEGY).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. asset_categories (T2): tenant-scoped natural key `code` (§12), the
-- bilingual name pair (§3), category defaults, and the three purpose
-- links (register §E). BR-041: a category is unusable until all three
-- purposes resolve to active accounts — enforced by the category service
-- at create/update AND re-checked at first asset use + every posting
-- (fail-closed). Deactivation allowed, deletion not (INV-015 — the
-- in-use guard lives in the service).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_categories" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "useful_life_months_default" integer NOT NULL,
  "depreciation_method_default" text NOT NULL DEFAULT 'STRAIGHT_LINE',
  "asset_purpose_key" text NOT NULL DEFAULT 'FIXED_ASSET',
  "accum_depreciation_purpose_key" text NOT NULL DEFAULT 'ACCUM_DEPRECIATION',
  "expense_purpose_key" text NOT NULL DEFAULT 'DEPRECIATION_EXPENSE',
  "active" boolean NOT NULL DEFAULT true,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_asset_categories PRIMARY KEY ("id"),
  CONSTRAINT uq_asset_categories_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_asset_categories_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_asset_categories_life CHECK ("useful_life_months_default" BETWEEN 1 AND 1200),
  CONSTRAINT ck_asset_categories_method CHECK ("depreciation_method_default" IN
    ('STRAIGHT_LINE', 'DECLINING_BALANCE', 'UNITS_OF_PRODUCTION')),
  CONSTRAINT ck_asset_categories_purpose_shape CHECK (
    "asset_purpose_key" ~ '^[A-Z][A-Z0-9_]{2,40}$'
    AND "accum_depreciation_purpose_key" ~ '^[A-Z][A-Z0-9_]{2,40}$'
    AND "expense_purpose_key" ~ '^[A-Z][A-Z0-9_]{2,40}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_categories_tenant_active
  ON "asset_categories" ("tenant_id", "active");
--> statement-breakpoint
COMMENT ON TABLE "asset_categories" IS
  'PHASE-026 T2: asset categories — tenant-scoped code, bilingual names, useful-life/method defaults, and the three purpose links (FIXED_ASSET / ACCUM_DEPRECIATION / DEPRECIATION_EXPENSE per category, overridable to more specific keys). BR-041: unusable until all three purposes resolve to active accounts; deactivation allowed, deletion never (INV-015).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. assets (T3): the register. `code` tenant-scoped natural key; status
-- machine ACTIVE → FULLY_DEPRECIATED → DISPOSED (WRITTEN_OFF from ACTIVE
-- via a zero-proceeds SCRAP per the service; disposal locks the asset —
-- INV-023). opening_accumulated carries the opening-variant
-- accumulated-to-date (G-21 opening posts DR OPENING_EQUITY · CR
-- ACCUM_DEPRECIATION so future runs resume from the true NBV). NBV =
-- cost − salvage floor: computed value = cost − opening_accumulated −
-- Σ posted lines; the INV-023 suite proves it never drops below salvage.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assets" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "category_id" uuid NOT NULL,
  "acquisition_date" date NOT NULL,
  "cost" numeric(19,4) NOT NULL,
  "salvage_value" numeric(19,4) NOT NULL DEFAULT 0,
  "opening_accumulated" numeric(19,4) NOT NULL DEFAULT 0,
  "useful_life_months" integer NOT NULL,
  "depreciation_method" text NOT NULL DEFAULT 'STRAIGHT_LINE',
  "total_estimated_units" numeric(19,6),
  "branch_id" uuid NOT NULL,
  "custodian_user_id" uuid,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "source_type" text,
  "source_id" uuid,
  "note" text,
  "note_ar" text,
  "disposed_at" timestamptz,
  "written_off_at" timestamptz,
  CONSTRAINT pk_assets PRIMARY KEY ("id"),
  CONSTRAINT uq_assets_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_assets_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_assets_category FOREIGN KEY ("category_id", "tenant_id")
    REFERENCES "asset_categories" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_assets_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_assets_custodian FOREIGN KEY ("custodian_user_id")
    REFERENCES "users" ("id") ON DELETE SET NULL,
  CONSTRAINT ck_assets_cost CHECK ("cost" >= 0),
  CONSTRAINT ck_assets_salvage CHECK ("salvage_value" >= 0 AND "salvage_value" <= "cost"),
  CONSTRAINT ck_assets_opening_accum CHECK ("opening_accumulated" >= 0
    AND "opening_accumulated" <= "cost" - "salvage_value"),
  CONSTRAINT ck_assets_life CHECK ("useful_life_months" BETWEEN 1 AND 1200),
  CONSTRAINT ck_assets_method CHECK ("depreciation_method" IN
    ('STRAIGHT_LINE', 'DECLINING_BALANCE', 'UNITS_OF_PRODUCTION')),
  CONSTRAINT ck_assets_status_values CHECK ("status" IN
    ('ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED', 'WRITTEN_OFF')),
  CONSTRAINT ck_assets_uop_units CHECK ("depreciation_method" <> 'UNITS_OF_PRODUCTION'
    OR "total_estimated_units" IS NOT NULL AND "total_estimated_units" > 0)
);
--> statement-breakpoint
-- Register listings index (phase §6: (tenant, category, status, branch)).
CREATE INDEX IF NOT EXISTS ix_assets_tenant_cat_status_branch
  ON "assets" ("tenant_id", "category_id", "status", "branch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_assets_tenant_custodian
  ON "assets" ("tenant_id", "custodian_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_assets_tenant_source
  ON "assets" ("tenant_id", "source_type", "source_id");
--> statement-breakpoint
COMMENT ON TABLE "assets" IS
  'PHASE-026 T3: the asset register — code/name/category/acquisition/cost/salvage/life/method/branch/custodian + status (asset_status §9). opening_accumulated is the opening-variant accumulated-to-date input (G-21 opening leg). NBV floor at salvage (INV-023): cost − opening_accumulated − Σ posted depreciation lines ≥ salvage, machine-checked. Disposal locks the asset (DISPOSED, exactly once).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. depreciation_runs (T6/T7): one run per (tenant, fiscal period) — the
-- UNIQUE is the one-run-per-period dedupe (second assembly → 409). status
-- DRAFT → POSTED; posting is explicit (fixed_assets.depreciation_runs.post)
-- and period-locked (LOCKED period rejected — INV-011, PERIOD_LOCKED
-- failure pack). Posted runs reverse only via the engine (INV-014): the
-- counter-entry links through reversal_journal_entry_id and the lines stay
-- for audit (append-only). assembly_job_id tracks the bounded pg-boss job
-- (ADR-0008: chunked, cancelable) while assembly is in flight.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "depreciation_runs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "fiscal_period_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "asset_count" integer NOT NULL DEFAULT 0,
  "total_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "assembly_job_id" text,
  "assembled_at" timestamptz,
  "assembled_by" uuid,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "journal_entry_id" uuid,
  "reversal_journal_entry_id" uuid,
  "reversed_at" timestamptz,
  "reversal_reason" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_depreciation_runs PRIMARY KEY ("id"),
  CONSTRAINT uq_depreciation_runs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_depreciation_runs_tenant_period UNIQUE ("tenant_id", "fiscal_period_id"),
  CONSTRAINT fk_depreciation_runs_period FOREIGN KEY ("fiscal_period_id", "tenant_id")
    REFERENCES "fiscal_periods" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_depreciation_runs_status_values CHECK ("status" IN ('DRAFT', 'POSTED')),
  CONSTRAINT ck_depreciation_runs_totals CHECK ("asset_count" >= 0 AND "total_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_depreciation_runs_tenant_status
  ON "depreciation_runs" ("tenant_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "depreciation_runs" IS
  'PHASE-026 T6/T7: monthly depreciation batches — ONE per (tenant, fiscal period) (BR-042). DRAFT assembly (bounded pg-boss job, ADR-0008) → explicit POST (G-22: one journal per run, lines per asset, DR DEPRECIATION_EXPENSE · CR ACCUM_DEPRECIATION per category). Period-locked (INV-011). Reversal is engine-only (INV-014): counter-entry + reversed_at; the append-only lines stay for audit.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. depreciation_lines 🔒 (T6): append-only per-asset run lines (INV-003
-- pattern). One line per (run, asset); period_units carries the manual
-- UNITS_OF_PRODUCTION usage entered in the run workspace; accumulated_
-- amount is the running accumulated AFTER this line (the NBV floor proof:
-- cost − salvage − accumulated ≥ 0 checked by the service + INV-023
-- property suite; the guard trigger + grants make rewrite impossible).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "depreciation_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "run_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "period_units" numeric(19,6),
  "period_amount" numeric(19,4) NOT NULL,
  "accumulated_amount" numeric(19,4) NOT NULL,
  CONSTRAINT pk_depreciation_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_depreciation_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_depreciation_lines_run_asset UNIQUE ("run_id", "asset_id"),
  CONSTRAINT fk_depreciation_lines_run FOREIGN KEY ("run_id", "tenant_id")
    REFERENCES "depreciation_runs" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_depreciation_lines_asset FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_depreciation_lines_amount CHECK ("period_amount" > 0),
  CONSTRAINT ck_depreciation_lines_accum CHECK ("accumulated_amount" >= 0),
  CONSTRAINT ck_depreciation_lines_line_no CHECK ("line_no" >= 1),
  CONSTRAINT ck_depreciation_lines_units CHECK ("period_units" IS NULL OR "period_units" >= 0)
);
--> statement-breakpoint
-- Asset history + as-of reporting (the depreciation-schedule report source).
CREATE INDEX IF NOT EXISTS ix_depreciation_lines_tenant_asset
  ON "depreciation_lines" ("tenant_id", "asset_id");
--> statement-breakpoint
COMMENT ON TABLE "depreciation_lines" IS
  'PHASE-026 T6: append-only 🔒 per-asset depreciation lines (INV-003 pattern) — one per (run, asset); period_units is the manual UoP usage; accumulated_amount is the asset accumulated AFTER the line. UPDATE is grant-denied outright; DELETE is grant-capable but policy-owned by the erp.depreciation_lines_guard trigger (posted-run lines are immutable history; DELETE passes only for purge_mode or DRAFT-run assembly resets).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. asset_disposals (T9): SALE/SCRAP documents. disposal_no is the
-- official number from the numbering service (INV-021, ADR-0006).
-- net_book_value/accumulated_snapshot freeze the disposal-time state
-- (immutable after post); gain_loss = proceeds − NBV (the G-23 mirror:
-- gain → ASSET_DISPOSAL_GAIN credit, loss → ASSET_DISPOSAL_LOSS debit —
-- mandatory). approved_by/approved_at carry the §4 SoD approval (second
-- user; the creator cannot post — audited on use). Posting locks the
-- asset (DISPOSED, INV-023: once, only from ACTIVE/FULLY_DEPRECIATED).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_disposals" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "asset_id" uuid NOT NULL,
  "disposal_no" text,
  "kind" text NOT NULL,
  "disposal_date" date NOT NULL,
  "proceeds" numeric(19,4) NOT NULL DEFAULT 0,
  "net_book_value" numeric(19,4) NOT NULL,
  "accumulated_snapshot" numeric(19,4) NOT NULL,
  "gain_loss" numeric(19,4) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "approved_by" uuid,
  "approved_at" timestamptz,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "journal_entry_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_asset_disposals PRIMARY KEY ("id"),
  CONSTRAINT uq_asset_disposals_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_asset_disposals_asset FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_asset_disposals_kind CHECK ("kind" IN ('SALE', 'SCRAP')),
  CONSTRAINT ck_asset_disposals_status_values CHECK ("status" IN ('DRAFT', 'POSTED')),
  CONSTRAINT ck_asset_disposals_proceeds CHECK ("proceeds" >= 0),
  CONSTRAINT ck_asset_disposals_nbs CHECK ("net_book_value" >= 0
    AND "accumulated_snapshot" >= 0)
);
--> statement-breakpoint
-- Partial unique index (NOT a table constraint — PostgreSQL partial uniques
-- are indexes): one official disposal_no per tenant, NULL while DRAFT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_disposals_tenant_no
  ON "asset_disposals" ("tenant_id", "disposal_no")
  WHERE "disposal_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_disposals_tenant_asset
  ON "asset_disposals" ("tenant_id", "asset_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_disposals_tenant_status_date
  ON "asset_disposals" ("tenant_id", "status", "disposal_date");
--> statement-breakpoint
COMMENT ON TABLE "asset_disposals" IS
  'PHASE-026 T9: SALE/SCRAP disposal documents — official disposal_no (numbering service, INV-021), frozen NBV/accumulated snapshots, gain_loss = proceeds − NBV. G-23 journal with the MANDATORY loss mirror (ASSET_DISPOSAL_LOSS). Posting requires fixed_assets.disposals.approve from a SECOND user (SoD, AUTHORIZATION_MATRIX §4) and locks the asset (INV-023). SCRAP proceeds = 0 is an explicit entry, never a silent default.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. asset_revaluations (T8): optional, audited revaluations (BR-044).
-- new_gross_value/new_accumulated restate the basis; delta is the NBV
-- delta (new_gross − new_accumulated − pre-revaluation NBV) — it posts to
-- REVALUATION_RESERVE (never P&L), both directions golden-tested.
-- Subsequent runs compute on the revalued basis (the service rewrites
-- neither cost nor history: the revaluation snapshot chain is the audit
-- trail; the CURRENT basis = last POSTED revaluation).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "asset_revaluations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "asset_id" uuid NOT NULL,
  "revaluation_date" date NOT NULL,
  "new_gross_value" numeric(19,4) NOT NULL,
  "new_accumulated" numeric(19,4) NOT NULL,
  "delta" numeric(19,4) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "reason" text NOT NULL,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "journal_entry_id" uuid,
  CONSTRAINT pk_asset_revaluations PRIMARY KEY ("id"),
  CONSTRAINT uq_asset_revaluations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_asset_revaluations_asset FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_asset_revaluations_status_values CHECK ("status" IN ('DRAFT', 'POSTED')),
  CONSTRAINT ck_asset_revaluations_basis CHECK ("new_gross_value" > 0
    AND "new_accumulated" >= 0 AND "new_gross_value" - "new_accumulated" >= 0),
  CONSTRAINT ck_asset_revaluations_reason_len CHECK (length("reason") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_asset_revaluations_tenant_asset
  ON "asset_revaluations" ("tenant_id", "asset_id");
--> statement-breakpoint
COMMENT ON TABLE "asset_revaluations" IS
  'PHASE-026 T8: audited asset revaluations (BR-044) — the NBV delta posts to REVALUATION_RESERVE via the engine (never P&L), both directions golden-tested; reason mandatory; subsequent depreciation runs compute on the revalued basis. One live DRAFT per asset at a time (service-enforced); revaluation on a DISPOSED asset is rejected.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Append-only guard for depreciation_lines (INV-003 pattern; the 0036
--    audit-guard exception shape): UPDATE prohibited for everyone (the
--    running accumulated is history). DELETE admitted in EXACTLY two
--    cases: (a) the offboarding purge path (erp.purge_mode — migration-
--    scope connection only), (b) lines of a run still in DRAFT — a DRAFT
--    assembly is not history yet (re-assembly resets it; posted-run lines
--    are immutable history, the guard enforces it regardless of grants —
--    grants give the capability, the trigger owns the policy).
--> statement-breakpoint
CREATE OR REPLACE FUNCTION erp.depreciation_lines_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'depreciation_lines are append-only (INV-003): % prohibited', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF current_setting('erp.purge_mode', true) = 'on' THEN
      RETURN OLD; -- the offboarding purge path (migration-scope tooling only)
    END IF;
    IF EXISTS (SELECT 1 FROM depreciation_runs r
               WHERE r.id = OLD.run_id AND r.status = 'DRAFT') THEN
      RETURN OLD; -- DRAFT assembly reset (re-assembly); POSTED-run lines never leave
    END IF;
    RAISE EXCEPTION 'depreciation_lines are append-only (INV-003): DELETE on a posted run''s lines is prohibited';
  END IF;
  RETURN OLD;
END
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_depreciation_lines_guard ON "depreciation_lines";
--> statement-breakpoint
CREATE TRIGGER trg_depreciation_lines_guard
  BEFORE UPDATE OR DELETE ON "depreciation_lines"
  FOR EACH ROW EXECUTE FUNCTION erp.depreciation_lines_guard();

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. RLS (TENANT_ISOLATION §2): the house macro on every tenant-owned
--    table.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"asset_categories"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"assets"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"depreciation_runs"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"depreciation_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"asset_disposals"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"asset_revaluations"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8b. Purge path (the 0036 discipline): every new tenant table gains the
-- erp_migrate DELETE/UPDATE policies confined to the GUC-named tenant —
-- scoped to the six new tables (idempotent drop+create).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asset_categories', 'assets', 'depreciation_runs',
                           'depreciation_lines', 'asset_disposals', 'asset_revaluations']
  LOOP
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
-- 9. Grants (per-table shapes):
--  - asset_categories: INSERT/UPDATE/SELECT — deactivation is the delete
--    (INV-015 in-use guard is service-level);
--  - assets: INSERT/UPDATE/SELECT (register maintenance; no DELETE —
--    disposals are documents);
--  - depreciation_runs: INSERT/UPDATE/SELECT (lifecycle state);
--  - depreciation_lines: INSERT + SELECT + DELETE (append-only 🔒 with
--    the DRAFT-reset exception — the guard trigger owns the policy: UPDATE
--    never; DELETE only for purge_mode or DRAFT-run lines; posted-run
--    lines are immutable history);
--  - asset_disposals / asset_revaluations: INSERT/UPDATE/SELECT
--    (DRAFT→POSTED lifecycle), no DELETE.
--> statement-breakpoint
REVOKE ALL ON "asset_categories", "assets", "depreciation_runs", "depreciation_lines",
  "asset_disposals", "asset_revaluations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "asset_categories" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "assets" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "depreciation_runs" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "depreciation_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "asset_disposals" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "asset_revaluations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "asset_categories", "assets", "depreciation_runs", "depreciation_lines",
  "asset_disposals", "asset_revaluations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "asset_categories", "assets", "depreciation_runs", "depreciation_lines",
  "asset_disposals", "asset_revaluations" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10. CoA template (§11): the six v2.0 purpose keys gain template
-- accounts. 1210/5300 exist since 0008 with NULL purposes — the upsert
-- adds them; 1220 (contra-asset), 4910, 5910, 3210 are new leaves. The
-- onboarding instantiation copies template rows + purposes into every
-- provisioned tenant (tenancy onboarding-service step 3), so new tenants
-- resolve all fixed-assets purposes from day one; existing tenants map
-- their own accounts via account_purposes (fail-closed).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('1210', 'Equipment', 'معدات وأجهزة', 'ASSET', false, '1200', 'FIXED_ASSET'),
  ('1220', 'Accumulated depreciation', 'مجمع إهلاك الأصول', 'ASSET', false, '1200', 'ACCUM_DEPRECIATION'),
  ('3210', 'Revaluation reserve', 'احتياطي إعادة التقييم', 'EQUITY', false, '3000', 'REVALUATION_RESERVE'),
  ('4910', 'Asset disposal gains', 'أرباح استبعاد الأصول', 'REVENUE', false, '4000', 'ASSET_DISPOSAL_GAIN'),
  ('5300', 'Depreciation', 'الإهلاك', 'EXPENSE', false, '5000', 'DEPRECIATION_EXPENSE'),
  ('5910', 'Asset disposal losses', 'خسائر استبعاد الأصول', 'EXPENSE', false, '5000', 'ASSET_DISPOSAL_LOSS')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10b. RC-10 reconciliation kind (T10): the fixed-assets register check
-- registers into the PHASE-007 framework — widen the reconciliation_runs
-- kind CHECK with 'FIXED_ASSETS' (the 0012 BANK_REC widening pattern; the
-- framework + PC-04 close block are consumed, never edited).
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" DROP CONSTRAINT IF EXISTS ck_reconciliation_runs_kind_values;
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT ck_reconciliation_runs_kind_values
  CHECK ("kind" IN ('AR', 'AP', 'CASH', 'BANK_REC', 'VAT', 'INVENTORY', 'GRNI', 'WIP', 'FIXED_ASSETS'));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 11. Permission seeds (AUTHORIZATION_MATRIX §3.11 — 13 keys; the drift
-- checker requires matrix ↔ seed parity). The owner template cross-join
-- re-runs idempotently (every tenant-plane key).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('fixed_assets.categories.manage', 'fixed_assets', 'Maintain asset categories and their purpose mappings (BR-041) / إدارة فئات الأصول وربط الأغراض'),
('fixed_assets.assets.view', 'fixed_assets', 'View the asset register / عرض سجل الأصول الثابتة'),
('fixed_assets.assets.create', 'fixed_assets', 'Acquire/capitalize assets (G-21) / إدخال ورسملة الأصول'),
('fixed_assets.assets.manage', 'fixed_assets', 'Maintain assets (custodian, branch, status) / إدارة بيانات الأصول (العهدة، الفرع، الحالة)'),
('fixed_assets.depreciation_runs.view', 'fixed_assets', 'View depreciation runs / عرض تشغيلات الإهلاك'),
('fixed_assets.depreciation_runs.run', 'fixed_assets', 'Execute the monthly depreciation run (G-22, BR-042) / تنفيذ تشغيل الإهلاك الشهري'),
('fixed_assets.depreciation_runs.post', 'fixed_assets', 'Post a depreciation run via the engine / ترحيل الإهلاك عبر محرك القيود'),
('fixed_assets.revaluations.create', 'fixed_assets', 'Draft an asset revaluation (BR-044) / إعداد إعادة تقييم الأصول'),
('fixed_assets.revaluations.post', 'fixed_assets', 'Post the revaluation delta to REVALUATION_RESERVE / ترحيل إعادة التقييم'),
('fixed_assets.disposals.create', 'fixed_assets', 'Draft a disposal — sale/scrap (G-23) / إعداد استبعاد الأصول (بيع/كشط)'),
('fixed_assets.disposals.approve', 'fixed_assets', 'Approve a disposal / اعتماد استبعاد الأصول'),
('fixed_assets.disposals.post', 'fixed_assets', 'Post the disposal journal (gain/loss per G-23) / ترحيل استبعاد الأصول'),
('fixed_assets.reports.view', 'fixed_assets', 'View/run fixed-asset report keys (REPORT_CATALOG §9) / تشغيل تقارير الأصول الثابتة')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";

--> statement-breakpoint
-- Owner template: every tenant-plane key (idempotent cross-join).
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
  AND p."key" NOT LIKE 'platform.%'
  AND p."key" <> 'identity.mfa.manage'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- Accountant: the operational set (everything except revaluations.post and
-- disposals.approve — owner-only per §3.11).
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'fixed_assets.categories.manage', 'fixed_assets.assets.view',
  'fixed_assets.assets.create', 'fixed_assets.assets.manage',
  'fixed_assets.depreciation_runs.view', 'fixed_assets.depreciation_runs.run',
  'fixed_assets.depreciation_runs.post', 'fixed_assets.revaluations.create',
  'fixed_assets.disposals.create', 'fixed_assets.disposals.post',
  'fixed_assets.reports.view'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- Viewer: the read tier.
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'fixed_assets.assets.view', 'fixed_assets.depreciation_runs.view',
  'fixed_assets.reports.view'
)
WHERE r."key" = 'viewer' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 12. Plan grants (FEATURE_CATALOG §19/§25 protocol step 3): the seven
-- fixed_assets feature keys join business + enterprise (the tier-4
-- financial-depth precedent — manufacturing 0026, e-invoicing 0035);
-- starter does NOT get them. Idempotent array_cat.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['fixed_assets.register', 'fixed_assets.categories', 'fixed_assets.acquisition',
        'fixed_assets.depreciation', 'fixed_assets.revaluation', 'fixed_assets.disposal',
        'fixed_assets.reports'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('fixed_assets.register' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 37)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
