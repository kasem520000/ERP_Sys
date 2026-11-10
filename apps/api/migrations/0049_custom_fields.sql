-- PHASE-036 (Blueprint v3.0 · CR-06) · migration 0049 · extensibility core
-- (custom fields, FD-18/FD-19/FD-20 + DF-39 substrate + UX-12)
--
-- Purpose (PHASE-036 §4 Design Impact): the audit's single most important
-- functional gap — FD-18 custom fields/UDF ("not a missing feature but a
-- missing business model") — lands with its two siblings: the per-entity
-- form-layout designer (FD-19) and tenant-managed picklists (FD-20).
-- Five tenant-owned tables, all RLS'd with composite tenant FKs per the
-- house convention:
--
--   custom_field_definitions  — the tenant-owned registry rows (entity_type
--     from the CODE-OWNED entity registry — no DB CHECK pins the entity
--     list so later phases register entities additively with zero
--     migrations, ADR-0019's rule; key is the BR-058 namespace-disciplined
--     tenant identifier; data_type TEXT/NUMBER/DATE/BOOLEAN/SELECT/
--     MULTISELECT/REFERENCE; config jsonb carries the REFERENCE target
--     entity + the SELECT/MULTISELECT picklist binding + the NUMBER
--     precision; validation columns required/regex/min/max/lengths;
--     status ACTIVE/ARCHIVED — archive-not-delete, history preserved).
--   custom_field_values       — the TYPED value store (ADR-0019: typed
--     columns over a jsonb blob — queryable, indexable, type-safe): one
--     row per (entity, field) with value_text/value_number/value_date/
--     value_boolean/value_json + the composite unique (tenant, entity_type,
--     entity_id, field_id). BR-057 type integrity: exactly ONE typed
--     column is non-null per row (the row-level num_nonnulls law) and a
--     value row only ever exists for an ACTIVE definition of matching
--     data_type (service-enforced + tamper-spec proven); archiving a
--     definition hides the field but PRESERVES its values (history).
--     Polymorphic (entity_type, entity_id) has NO DB-level FK by design
--     — the code-owned entity registry validates every write and the
--     orphan-sweep integrity job reconciles (PHASE-036 §7 risk 1).
--   custom_picklists          — tenant-managed value lists (FD-20),
--     ACTIVE/ARCHIVED (archive-not-delete).
--   custom_picklist_options   — the options with AR/EN labels + ordering;
--     ACTIVE/ARCHIVED — archived options are rejected for NEW values but
--     keep rendering their labels for historical ones (BR-057 history).
--   form_layouts              — the per-entity designer layouts (FD-19/
--     UX-12): sections jsonb (ordered groups of native + custom fields,
--     collapsible, column options) + role overrides (role_key NULL = the
--     entity's DEFAULT layout; one override row per (tenant, entity,
--     role) — two partial uniques, the BR-050 precedent). BR-059 protects
--     mandatory native fields from removal or reordering (service-guarded
--     against the entity registry's mandatory list).
--
-- Grants (per-table shapes):
--   - custom_field_definitions: SELECT/INSERT/UPDATE (NO DELETE — the
--     registry is archive-not-delete; ARCHIVED definitions keep their
--     values rendering forever);
--   - custom_field_values: SELECT/INSERT/UPDATE/DELETE (DELETE for the
--     replace-semantics path — a PATCH that omits a key clears its value;
--     rows are data, not history);
--   - custom_picklists: SELECT/INSERT/UPDATE (NO DELETE — archive);
--   - custom_picklist_options: SELECT/INSERT/UPDATE (NO DELETE — archive);
--   - form_layouts: SELECT/INSERT/UPDATE/DELETE (DELETE for the
--     role-override removal path; the default layout upserts in place).
--
-- INV-022 ledger: +5 tables, +0 journals (NOT ledger documents by
-- construction — a UDF value never posts), +3 permission keys (245 → 248:
-- configuration.custom_fields.read / configuration.custom_fields.manage /
-- configuration.form_layouts.manage — §9 below) and +1 feature-key plan
-- grant (platform.custom_fields → business + enterprise, the DATA-ONLY
-- tail block; starter excluded — the tier-4 precedent).
--
-- Table order: custom_picklists → custom_picklist_options →
-- custom_field_definitions → custom_field_values → form_layouts.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. custom_picklists (T5, FD-20): tenant-managed value lists. key is the
-- tenant-scoped natural key (BR-058 syntax); name/name_ar carry the
-- bilingual list labels; status ACTIVE/ARCHIVED (archived lists are
-- rejected for NEW definition bindings; bound definitions keep rendering
-- their options).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_picklists" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_custom_picklists PRIMARY KEY ("id"),
  CONSTRAINT uq_custom_picklists_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_custom_picklists_tenant_key UNIQUE ("tenant_id", "key"),
  CONSTRAINT ck_custom_picklists_status_values CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_custom_picklists_key CHECK ("key" ~ '^[a-z][a-z0-9_]{0,63}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_custom_picklists_tenant_status
  ON "custom_picklists" ("tenant_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "custom_picklists" IS
  'PHASE-036 T5: tenant-managed value lists (FD-20) — AR/EN option labels live in custom_picklist_options; archive-not-delete semantics preserve historical rendering.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. custom_picklist_options (T5): the list's options. label/label_ar are
-- the bilingual display strings; sort_order is the tenant-controlled
-- ordering (reorder is a service-level renumber); status ACTIVE/ARCHIVED —
-- archived options are rejected for NEW values (typed 400) while
-- historical values keep rendering their labels (BR-057).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_picklist_options" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "picklist_id" uuid NOT NULL,
  "label" text NOT NULL,
  "label_ar" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_custom_picklist_options PRIMARY KEY ("id"),
  CONSTRAINT uq_custom_picklist_options_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_custom_picklist_options_tenant_list_order UNIQUE ("tenant_id", "picklist_id", "sort_order"),
  CONSTRAINT fk_custom_picklist_options_list FOREIGN KEY ("picklist_id", "tenant_id")
    REFERENCES "custom_picklists" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_custom_picklist_options_status_values CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_custom_picklist_options_sort CHECK ("sort_order" >= 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_custom_picklist_options_tenant_list_status
  ON "custom_picklist_options" ("tenant_id", "picklist_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "custom_picklist_options" IS
  'PHASE-036 T5: picklist options with AR/EN labels + tenant ordering; ACTIVE/ARCHIVED — archived options rejected for new values, preserved for history.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. custom_field_definitions (T3, FD-18): the tenant-owned field
-- registry. entity_type references the CODE-OWNED entity registry
-- (ADR-0019 — no DB CHECK so later phases add entities with zero
-- migrations; the format CHECK below is a syntax floor only). key is the
-- BR-058 namespace-disciplined identifier (snake_case, reserved-stem +
-- native-column blocklist enforced at the service against the registry).
-- data_type pins the typed column the values store uses (BR-057); config
-- jsonb: { reference_entity?: entityType, picklist_id?: uuid, precision?:
-- integer } validated per data_type at the service. required + the
-- validation columns (regex TEXT / min_value+max_value NUMBER / min_length
-- +max_length TEXT) are the guard's rule set. status ACTIVE/ARCHIVED.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "entity_type" text NOT NULL,
  "key" text NOT NULL,
  "label" text NOT NULL,
  "label_ar" text NOT NULL,
  "data_type" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "required" boolean NOT NULL DEFAULT false,
  "validation_regex" text,
  "min_value" numeric(19, 6),
  "max_value" numeric(19, 6),
  "min_length" integer,
  "max_length" integer,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_custom_field_definitions PRIMARY KEY ("id"),
  CONSTRAINT uq_custom_field_definitions_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_custom_field_definitions_tenant_entity_key UNIQUE ("tenant_id", "entity_type", "key"),
  CONSTRAINT ck_custom_field_definitions_data_type CHECK (
    "data_type" IN ('TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT', 'MULTISELECT', 'REFERENCE')),
  CONSTRAINT ck_custom_field_definitions_status_values CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_custom_field_definitions_entity CHECK ("entity_type" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT ck_custom_field_definitions_key CHECK ("key" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT ck_custom_field_definitions_min_max CHECK (
    "min_value" IS NULL OR "max_value" IS NULL OR "min_value" <= "max_value"),
  CONSTRAINT ck_custom_field_definitions_min_max_length CHECK (
    "min_length" IS NULL OR "max_length" IS NULL OR ("min_length" >= 0 AND "max_length" >= 0 AND "min_length" <= "max_length"))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_custom_field_definitions_tenant_entity_status
  ON "custom_field_definitions" ("tenant_id", "entity_type", "status");
--> statement-breakpoint
COMMENT ON TABLE "custom_field_definitions" IS
  'PHASE-036 T3: tenant-owned custom-field registry (FD-18) — entity_type from the code-owned entity registry (ADR-0019 additive rule), BR-058 key namespace, seven typed data_types, config jsonb (REFERENCE target / picklist binding / precision), validation rule set, ACTIVE/ARCHIVED (archive preserves values).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. custom_field_values (T4, FD-18): the TYPED value store (ADR-0019 —
-- typed columns over a jsonb blob: queryable, indexable, type-safe). One
-- row per (entity, field); the composite unique is the replace-semantics
-- anchor; the num_nonnulls law (BR-057 row-level floor) pins EXACTLY one
-- typed column non-null — the data_type ↔ column match is service-guarded
-- (the definition row is the truth; a tamper spec proves guard-bypass
-- attempts fail typed). (entity_type, entity_id) is polymorphic by
-- design — NO DB-level FK; the code-owned entity registry validates every
-- write and the orphan-sweep integrity job reconciles (§7 risk 1).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "custom_field_values" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "field_id" uuid NOT NULL,
  "value_text" text,
  "value_number" numeric(19, 6),
  "value_date" date,
  "value_boolean" boolean,
  "value_json" jsonb,
  CONSTRAINT pk_custom_field_values PRIMARY KEY ("id"),
  CONSTRAINT uq_custom_field_values_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_custom_field_values_tenant_entity_field UNIQUE ("tenant_id", "entity_type", "entity_id", "field_id"),
  CONSTRAINT fk_custom_field_values_field FOREIGN KEY ("field_id", "tenant_id")
    REFERENCES "custom_field_definitions" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_custom_field_values_entity CHECK ("entity_type" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT ck_custom_field_values_one_typed_value CHECK (
    num_nonnulls("value_text", "value_number", "value_date", "value_boolean", "value_json") = 1),
  CONSTRAINT ck_custom_field_values_multiselect_shape CHECK (
    "value_json" IS NULL OR jsonb_typeof("value_json") = 'array')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_custom_field_values_tenant_entity_ids
  ON "custom_field_values" ("tenant_id", "entity_type", "entity_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_custom_field_values_tenant_field
  ON "custom_field_values" ("tenant_id", "field_id");
--> statement-breakpoint
COMMENT ON TABLE "custom_field_values" IS
  'PHASE-036 T4: the typed custom-field value store (ADR-0019) — one row per (entity, field), exactly one typed column non-null (the num_nonnulls law), polymorphic (entity_type, entity_id) validated by the code-owned registry (no DB FK by design; orphan-sweep reconciles).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. form_layouts (T6, FD-19/UX-12): the per-entity designer layouts.
-- role_key NULL = the entity's DEFAULT layout; a non-NULL role_key is
-- that role's override (rendered for principals holding the role). Two
-- partial uniques (the BR-050 precedent): one default per (tenant,
-- entity) + one row per (tenant, entity, role). sections jsonb = ordered
-- section groups [{ key, label, labelAr, collapsed, columns, fields:
-- [{ key, custom: boolean }] }]; BR-059 (mandatory native fields can
-- never be removed or reordered) is service-guarded against the entity
-- registry's mandatory list — the layout CHECK pins the jsonb shape floor
-- only.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_layouts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "entity_type" text NOT NULL,
  "role_key" text,
  "name" text NOT NULL,
  "sections" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_form_layouts PRIMARY KEY ("id"),
  CONSTRAINT uq_form_layouts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_form_layouts_status_values CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_form_layouts_entity CHECK ("entity_type" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT ck_form_layouts_role CHECK ("role_key" IS NULL OR "role_key" ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT ck_form_layouts_sections_shape CHECK (jsonb_typeof("sections") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_form_layouts_tenant_entity_default
  ON "form_layouts" ("tenant_id", "entity_type")
  WHERE "role_key" IS NULL AND "status" = 'ACTIVE';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_form_layouts_tenant_entity_role
  ON "form_layouts" ("tenant_id", "entity_type", "role_key")
  WHERE "role_key" IS NOT NULL AND "status" = 'ACTIVE';
--> statement-breakpoint
COMMENT ON TABLE "form_layouts" IS
  'PHASE-036 T6: per-entity form-layout designer store (FD-19/UX-12) — sections jsonb (ordered native+custom field groups), role overrides via role_key (NULL = default; two partial uniques), BR-059 mandatory-native protection service-guarded.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS (TENANT_ISOLATION §2): the house macro on every new tenant-owned
-- table.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"custom_picklists"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"custom_picklist_options"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"custom_field_definitions"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"custom_field_values"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"form_layouts"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6b. Purge path (the 0036/0037/0038/0042/0043 discipline): every new
-- tenant table gains the erp_migrate DELETE/UPDATE policies confined to
-- the GUC-named tenant (custom-field rows join the tenant offboarding
-- export→purge flow per DATA_PROTECTION §4).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['custom_picklists', 'custom_picklist_options',
                            'custom_field_definitions', 'custom_field_values', 'form_layouts']
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
-- 6c. Grants (per-table shapes; see the header ledger):
--  - custom_picklists / custom_picklist_options: SELECT/INSERT/UPDATE
--    (NO DELETE — archive-not-delete);
--  - custom_field_definitions: SELECT/INSERT/UPDATE (NO DELETE);
--  - custom_field_values: SELECT/INSERT/UPDATE/DELETE (replace
--    semantics);
--  - form_layouts: SELECT/INSERT/UPDATE/DELETE (override removal).
--> statement-breakpoint
REVOKE ALL ON "custom_picklists", "custom_picklist_options", "custom_field_definitions",
  "custom_field_values", "form_layouts" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "custom_picklists" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "custom_picklist_options" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "custom_field_definitions" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_field_values" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "form_layouts" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "custom_picklists", "custom_picklist_options", "custom_field_definitions",
  "custom_field_values", "form_layouts" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "custom_picklists", "custom_picklist_options", "custom_field_definitions",
  "custom_field_values", "form_layouts" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Permission seed (PHASE-036 §4): the three extensibility keys
-- (matrix §3.8) — the definitions manager (read = list definitions/
-- picklists/layouts; manage = create/update/archive), and the form-layout
-- designer. The owner template cross-join re-runs idempotently (every
-- tenant-plane key); the accountant template gains the read key (master-
-- data visibility — the §3.8 configuration.settings.manage family
-- pattern). Viewer deliberately does NOT hold them (the checklist
-- allTenantRoles set stays unchanged).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('configuration.custom_fields.read', 'configuration', 'View custom-field definitions, picklists and form layouts / عرض الحقول المخصصة وقوائم القيم وتخطيطات النماذج'),
('configuration.custom_fields.manage', 'configuration', 'Create, update and archive custom fields and picklists / إدارة الحقول المخصصة وقوائم القيم'),
('configuration.form_layouts.manage', 'configuration', 'Design per-entity form layouts and role overrides / تصميم تخطيطات النماذج وتجاوزاتها حسب الدور')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r CROSS JOIN "permissions" p
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
  AND p."key" NOT LIKE 'platform.%'
  AND p."key" <> 'identity.mfa.manage'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, 'configuration.custom_fields.read'
FROM "roles" r WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. Plan grant (the 0042/0043/0048 block): platform.custom_fields →
-- business + enterprise. Starter does NOT get it (the tier-4 precedent —
-- budgeting 0042, payroll 0043, import/export 0048: starter tenants ask
-- the platform for field changes; the BR-040 dependency closure
-- (platform.onboarding) is already satisfied in both plans). The
-- template-composable grant behavior is unchanged (CR-36 f).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['platform.custom_fields'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('platform.custom_fields' = ANY("feature_keys"));

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 49)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
