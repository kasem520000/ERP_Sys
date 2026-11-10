-- PHASE-006 · migration 0009 · master data (partners & items)
--
-- Purpose (PHASE-006 §2.1–§2.4/T1; ENTITY_CATALOG §"partners & items";
-- ERD/trade-inventory.md; TABLES/trade-inventory.md authored in-phase):
-- - partners (unified customer/supplier directory, BR-025 code rules, soft
--   delete tombstone) + partner_contacts + partner_addresses + credit_terms
-- - item_categories (bilingual tree), items (BR-025-adjacent sku rules,
--   tracking flags, costing method stored now / enforced PHASE-010),
--   uoms + uom_conversions (exact decimal factors, compose-exactly),
--   barcodes (per item per UoM), price_lists + price_list_items
-- - opening_balance_docs (kind partner|account|stock, DRAFT-only — the
--   status CHECK is this phase's hard zero-posting boundary; PHASE-007
--   widens it per expand-migrate-contract)
-- - partner_balances read model (draft-aware sums only until PHASE-007)
-- - file_objects attachments usage (ENTITY_CATALOG marks the table
--   002 infra / 006 usage — PHASE-002 shipped signed URLs only; the
--   owner linkage is this phase's usage contract)
-- - import_jobs (preview-gated bulk import state; commit runs as a
--   bounded tenant-scoped pg-boss job per ADR-0008 — payloads carry ids
--   only)
-- - branches.default_price_list_id (BR-003 "branch default list" level)
--
-- Deliberate expand-migrate-contract step (MIGRATION_STRATEGY §3, PHASE-006
-- §7): items.tax_code_id is created NULLABLE with NO FK — tax_codes arrives
-- in PHASE-009 which adds the FK + validation. Do not "complete" it early.
--
-- Zero GL postings in this phase (acceptance 5): no journal tables exist,
-- nothing here writes one, and the CI zero-posting proof asserts the
-- journal_entries table does not exist after the full master-data suite.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Trigram + btree-gin for tenant-scoped fuzzy search (DATABASE_CONVENTIONS
-- §8.5; PHASE-006 T10): pg_trgm for AR/EN name similarity, btree_gin so the
-- composite GIN indexes carry tenant_id and stay index-driven per-tenant.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gin;

--> statement-breakpoint
-- Credit terms (PHASE-006 §2.1): net-N day codes seeded per tenant (NET-7/15/
-- 30/60 as is_system read-only rows); custom codes via the service.
-- BR-026 semantics live in the service (due dates of existing documents
-- never move — this phase has no documents; the interface contract is
-- documented + tested).
CREATE TABLE IF NOT EXISTS "credit_terms" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "days" integer NOT NULL,
  "description" text,
  "is_system" boolean NOT NULL DEFAULT false,
  CONSTRAINT pk_credit_terms PRIMARY KEY ("id"),
  CONSTRAINT uq_credit_terms_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_credit_terms_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_credit_terms_code_shape CHECK ("code" ~ '^[A-Z0-9_-]{1,20}$'),
  CONSTRAINT ck_credit_terms_days CHECK ("days" BETWEEN 0 AND 365),
  CONSTRAINT ck_credit_terms_name_length CHECK (length("name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_credit_terms_tenant ON "credit_terms" ("tenant_id");

--> statement-breakpoint
-- Price lists (PHASE-006 §2.2): sale/purchase kinds, optional validity
-- window, explicit currency (tenant base by default at the service layer).
CREATE TABLE IF NOT EXISTS "price_lists" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "name" text NOT NULL,
  "name_ar" text,
  "kind" text NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "valid_from" date,
  "valid_to" date,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_price_lists PRIMARY KEY ("id"),
  CONSTRAINT uq_price_lists_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_price_lists_kind_values CHECK ("kind" IN ('SALE', 'PURCHASE')),
  CONSTRAINT ck_price_lists_status_values CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT ck_price_lists_window CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to" >= "valid_from"),
  CONSTRAINT ck_price_lists_name_length CHECK (length("name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_price_lists_tenant_kind ON "price_lists" ("tenant_id", "kind");

--> statement-breakpoint
-- Partners (PHASE-006 §2.1; ERD/trade-inventory): unified customer/supplier/
-- both directory. BR-025: codes auto-number tenant-wide (P-000001 shape by
-- default) or tenant-unique manual; kind changes only while no postings —
-- interface-level here (nothing posts until PHASE-007), the guard ships with
-- the same service and is proven by test. Soft delete via deleted_at
-- tombstone (DATABASE_CONVENTIONS soft-delete policy); code uniqueness is
-- hard (codes are never reused, including tombstoned partners).
-- credit_limit numeric(19,4) per ADR-0009 money; NULL = unlimited (BR-001).
CREATE TABLE IF NOT EXISTS "partners" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "kind" text NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "tax_number" text,
  "credit_limit" numeric(19,4),
  "credit_terms_id" uuid,
  "price_list_id" uuid,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "deleted_at" timestamptz,
  CONSTRAINT pk_partners PRIMARY KEY ("id"),
  CONSTRAINT uq_partners_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_partners_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_partners_kind_values CHECK ("kind" IN ('CUSTOMER', 'SUPPLIER', 'BOTH')),
  CONSTRAINT ck_partners_status_values CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_partners_code_shape CHECK ("code" ~ '^[A-Za-z0-9_-]{1,20}$'),
  CONSTRAINT ck_partners_name_length CHECK (length("name") BETWEEN 1 AND 200),
  CONSTRAINT ck_partners_credit_limit CHECK ("credit_limit" IS NULL OR "credit_limit" >= 0),
  CONSTRAINT ck_partners_tax_number_shape CHECK ("tax_number" IS NULL OR "tax_number" ~ '^[0-9A-Za-z-]{5,30}$'),
  CONSTRAINT ck_partners_deleted_status CHECK (("deleted_at" IS NULL) OR ("status" = 'ARCHIVED')),
  CONSTRAINT fk_partners_credit_terms FOREIGN KEY ("credit_terms_id", "tenant_id")
    REFERENCES "credit_terms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_partners_price_list FOREIGN KEY ("price_list_id", "tenant_id")
    REFERENCES "price_lists" ("id", "tenant_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_partners_tenant_kind ON "partners" ("tenant_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_partners_tenant_status ON "partners" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_partners_tenant_credit_terms ON "partners" ("tenant_id", "credit_terms_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_partners_name_trgm ON "partners"
  USING gin ("tenant_id", "name" gin_trgm_ops, "name_ar" gin_trgm_ops);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_contacts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "partner_id" uuid NOT NULL,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "role" text,
  "is_primary" boolean NOT NULL DEFAULT false,
  CONSTRAINT pk_partner_contacts PRIMARY KEY ("id"),
  CONSTRAINT uq_partner_contacts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_partner_contacts_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_partner_contacts_name_length CHECK (length("name") BETWEEN 1 AND 200),
  CONSTRAINT ck_partner_contacts_email_shape CHECK ("email" IS NULL OR "email" ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT ck_partner_contacts_phone_shape CHECK ("phone" IS NULL OR "phone" ~ '^\+?[0-9]{6,20}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_partner_contacts_tenant_partner ON "partner_contacts" ("tenant_id", "partner_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "partner_addresses" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "partner_id" uuid NOT NULL,
  "type" text NOT NULL,
  "line1" text NOT NULL,
  "line2" text,
  "city" text,
  "country_code" char(2) REFERENCES "countries" ("code") ON DELETE RESTRICT,
  "geo" jsonb,
  CONSTRAINT pk_partner_addresses PRIMARY KEY ("id"),
  CONSTRAINT uq_partner_addresses_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_partner_addresses_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_partner_addresses_type_values CHECK ("type" IN ('BILLING', 'SHIPPING', 'OTHER')),
  CONSTRAINT ck_partner_addresses_line1_length CHECK (length("line1") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_partner_addresses_tenant_partner ON "partner_addresses" ("tenant_id", "partner_id");

--> statement-breakpoint
-- Item categories (PHASE-006 §2.2): bilingual tree driving default tax codes
-- (PHASE-009) and reporting rollups; cycle-freedom is a service-level
-- invariant (T4 unit test) — the composite self-FK gives per-tenant nesting.
CREATE TABLE IF NOT EXISTS "item_categories" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "parent_id" uuid,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_item_categories PRIMARY KEY ("id"),
  CONSTRAINT uq_item_categories_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_item_categories_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_item_categories_parent FOREIGN KEY ("parent_id", "tenant_id")
    REFERENCES "item_categories" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_item_categories_code_shape CHECK ("code" ~ '^[A-Za-z0-9_-]{1,20}$'),
  CONSTRAINT ck_item_categories_status_values CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_item_categories_name_length CHECK (length("name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_categories_tenant_parent ON "item_categories" ("tenant_id", "parent_id");

--> statement-breakpoint
-- Units of measure (PHASE-006 §2.2; SEEDS/README "uoms" row): tenant-owned —
-- every tenant receives the 8 common units (piece, kg, g, L, box, carton,
-- meter, hour) as is_system read-only rows at onboarding (backfill for
-- existing tenants below); tenants extend with their own rows. The global
-- seed DEFINITIONS are the canonical read-only contract (seed updates ship
-- as migrations per SEEDS rule 2).
CREATE TABLE IF NOT EXISTS "uoms" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "is_system" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_uoms PRIMARY KEY ("id"),
  CONSTRAINT uq_uoms_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_uoms_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_uoms_code_shape CHECK ("code" ~ '^[A-Za-z0-9_-]{1,10}$'),
  CONSTRAINT ck_uoms_name_length CHECK (length("name") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_uoms_tenant ON "uoms" ("tenant_id");

--> statement-breakpoint
-- UoM conversions (PHASE-006 §2.2; TEST_STRATEGY §2.1): exact decimal factors
-- (numeric(19,6)) with the compose-exactly property proven by a property
-- test — chains multiply with zero drift at 6-dp. Box/carton→piece factors
-- are tenant-specific (deliberately NOT seeded; only the universal metric
-- pair kg↔g is seeded per tenant below).
CREATE TABLE IF NOT EXISTS "uom_conversions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "from_uom_id" uuid NOT NULL,
  "to_uom_id" uuid NOT NULL,
  "factor" numeric(19,6) NOT NULL,
  CONSTRAINT pk_uom_conversions PRIMARY KEY ("id"),
  CONSTRAINT uq_uom_conversions_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_uom_conversions_tenant_pair UNIQUE ("tenant_id", "from_uom_id", "to_uom_id"),
  CONSTRAINT fk_uom_conversions_from FOREIGN KEY ("from_uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_uom_conversions_to FOREIGN KEY ("to_uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_uom_conversions_factor CHECK ("factor" > 0),
  CONSTRAINT ck_uom_conversions_not_self CHECK ("from_uom_id" <> "to_uom_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_uom_conversions_tenant_from ON "uom_conversions" ("tenant_id", "from_uom_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_uom_conversions_tenant_to ON "uom_conversions" ("tenant_id", "to_uom_id");

--> statement-breakpoint
-- Items (PHASE-006 §2.2; ERD/trade-inventory): tenant-unique sku, bilingual
-- names, kind STOCK|SERVICE|COMPOSITE, base uom, category, costing method
-- (stored now — WAC default per decisions/accounting DR-001; enforced from
-- PHASE-010), tracking flags (has_expiry implies track_batch — expiry dates
-- ride on batches), reorder defaults, base price (BR-003 last-resort level),
-- soft-delete tombstone like partners.
-- tax_code_id: NULLABLE, NO FK — expand-migrate-contract (PHASE-009 adds
-- the FK + validation; the field stays absent from the UI until then).
CREATE TABLE IF NOT EXISTS "items" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "sku" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "kind" text NOT NULL,
  "uom_id" uuid NOT NULL,
  "category_id" uuid,
  "tax_code_id" uuid,
  "costing_method" text NOT NULL DEFAULT 'WAC',
  "track_batch" boolean NOT NULL DEFAULT false,
  "track_serial" boolean NOT NULL DEFAULT false,
  "track_imei" boolean NOT NULL DEFAULT false,
  "has_expiry" boolean NOT NULL DEFAULT false,
  "reorder_level" numeric(19,6),
  "reorder_qty" numeric(19,6),
  "base_price" numeric(19,6),
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "deleted_at" timestamptz,
  CONSTRAINT pk_items PRIMARY KEY ("id"),
  CONSTRAINT uq_items_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_items_tenant_sku UNIQUE ("tenant_id", "sku"),
  CONSTRAINT fk_items_uom FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_items_category FOREIGN KEY ("category_id", "tenant_id")
    REFERENCES "item_categories" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_items_kind_values CHECK ("kind" IN ('STOCK', 'SERVICE', 'COMPOSITE')),
  CONSTRAINT ck_items_costing_values CHECK ("costing_method" IN ('WAC', 'FIFO')),
  CONSTRAINT ck_items_status_values CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_items_sku_shape CHECK ("sku" ~ '^[A-Za-z0-9._-]{1,40}$'),
  CONSTRAINT ck_items_name_length CHECK (length("name") BETWEEN 1 AND 200),
  CONSTRAINT ck_items_expiry_requires_batch CHECK (NOT "has_expiry" OR "track_batch"),
  CONSTRAINT ck_items_tracking_stock_kind CHECK ("kind" = 'STOCK' OR (NOT "track_batch" AND NOT "track_serial" AND NOT "track_imei" AND NOT "has_expiry")),
  CONSTRAINT ck_items_reorder CHECK (("reorder_level" IS NULL OR "reorder_level" >= 0) AND ("reorder_qty" IS NULL OR "reorder_qty" >= 0)),
  CONSTRAINT ck_items_base_price CHECK ("base_price" IS NULL OR "base_price" >= 0),
  CONSTRAINT ck_items_deleted_status CHECK (("deleted_at" IS NULL) OR ("status" = 'ARCHIVED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_items_tenant_kind ON "items" ("tenant_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_items_tenant_category ON "items" ("tenant_id", "category_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_items_tenant_status ON "items" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_items_name_trgm ON "items"
  USING gin ("tenant_id", "name" gin_trgm_ops, "name_ar" gin_trgm_ops);

--> statement-breakpoint
-- Barcodes (PHASE-006 §2.2): multiple per item, per UoM. Scan ambiguity is
-- intolerable → the code is tenant-wide unique (strongest guarantee, T4 test
-- asserts both the tenant-wide and per-UoM expectations).
CREATE TABLE IF NOT EXISTS "barcodes" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "item_id" uuid NOT NULL,
  "uom_id" uuid NOT NULL,
  "code" text NOT NULL,
  CONSTRAINT pk_barcodes PRIMARY KEY ("id"),
  CONSTRAINT uq_barcodes_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_barcodes_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT uq_barcodes_tenant_item_uom_code UNIQUE ("tenant_id", "item_id", "uom_id", "code"),
  CONSTRAINT fk_barcodes_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_barcodes_uom FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_barcodes_code_shape CHECK ("code" ~ '^[0-9A-Za-z_-]{1,64}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_barcodes_tenant_item ON "barcodes" ("tenant_id", "item_id");

--> statement-breakpoint
-- Price list rows (PHASE-006 §2.2): per-UoM unit price with min-qty tiers
-- (the partial-free default tier is min_qty = 1); prices numeric(19,6) as
-- strings over the API (ADR-0009 §quantities).
CREATE TABLE IF NOT EXISTS "price_list_items" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "price_list_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "uom_id" uuid NOT NULL,
  "unit_price" numeric(19,6) NOT NULL,
  "min_qty" numeric(19,6) NOT NULL DEFAULT 1,
  CONSTRAINT pk_price_list_items PRIMARY KEY ("id"),
  CONSTRAINT uq_price_list_items_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_price_list_items_tier UNIQUE ("tenant_id", "price_list_id", "item_id", "uom_id", "min_qty"),
  CONSTRAINT fk_price_list_items_list FOREIGN KEY ("price_list_id", "tenant_id")
    REFERENCES "price_lists" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_price_list_items_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_price_list_items_uom FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_price_list_items_price CHECK ("unit_price" >= 0),
  CONSTRAINT ck_price_list_items_min_qty CHECK ("min_qty" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_price_list_items_tenant_list_item ON "price_list_items" ("tenant_id", "price_list_id", "item_id");

--> statement-breakpoint
-- Partner balances read model (PHASE-006 §2.1; MODULE_BOUNDARIES: owned by
-- `partners`): recomputed by the partners services. At this phase
-- draft_balance reflects opening-balance DRAFT sums only; open_balance and
-- overdue_amount stay 0 until the posting engine (PHASE-007) and documents
-- (PHASE-008/012) exist — every UI surface labels draft-only sums honestly
-- (PHASE-006 §7 constraint).
CREATE TABLE IF NOT EXISTS "partner_balances" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "partner_id" uuid NOT NULL,
  "open_balance" numeric(19,4) NOT NULL DEFAULT 0,
  "draft_balance" numeric(19,4) NOT NULL DEFAULT 0,
  "overdue_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "last_recomputed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_partner_balances PRIMARY KEY ("id"),
  CONSTRAINT uq_partner_balances_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_partner_balances_tenant_partner UNIQUE ("tenant_id", "partner_id"),
  CONSTRAINT fk_partner_balances_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
-- Opening-balance drafts (PHASE-006 §2.5; G-16 subledger source): typed
-- target refs per kind with shape checks making cross-kind pollution
-- structurally impossible; status is CHECK-locked to DRAFT — the
-- zero-posting boundary at the schema layer (PHASE-007 drops this check
-- when the posting engine exists; stock drafts post in PHASE-010).
CREATE TABLE IF NOT EXISTS "opening_balance_docs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "kind" text NOT NULL,
  "partner_id" uuid,
  "account_id" uuid,
  "item_id" uuid,
  "qty" numeric(19,6),
  "unit_cost" numeric(19,6),
  "amount" numeric(19,4),
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "note" text,
  "status" text NOT NULL DEFAULT 'DRAFT',
  CONSTRAINT pk_opening_balance_docs PRIMARY KEY ("id"),
  CONSTRAINT uq_opening_balance_docs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_obd_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_obd_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_obd_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_obd_kind_values CHECK ("kind" IN ('PARTNER', 'ACCOUNT', 'STOCK')),
  CONSTRAINT ck_obd_status_draft_only CHECK ("status" = 'DRAFT'),
  CONSTRAINT ck_obd_partner_shape CHECK (
    ("kind" = 'PARTNER' AND "partner_id" IS NOT NULL AND "amount" IS NOT NULL
     AND "account_id" IS NULL AND "item_id" IS NULL AND "qty" IS NULL AND "unit_cost" IS NULL)
    OR ("kind" <> 'PARTNER')),
  CONSTRAINT ck_obd_account_shape CHECK (
    ("kind" = 'ACCOUNT' AND "account_id" IS NOT NULL AND "amount" IS NOT NULL
     AND "partner_id" IS NULL AND "item_id" IS NULL AND "qty" IS NULL AND "unit_cost" IS NULL)
    OR ("kind" <> 'ACCOUNT')),
  CONSTRAINT ck_obd_stock_shape CHECK (
    ("kind" = 'STOCK' AND "item_id" IS NOT NULL AND "qty" IS NOT NULL AND "qty" > 0
     AND "unit_cost" IS NOT NULL AND "unit_cost" >= 0 AND "amount" IS NULL
     AND "partner_id" IS NULL AND "account_id" IS NULL)
    OR ("kind" <> 'STOCK'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_obd_tenant_partner ON "opening_balance_docs" ("tenant_id", "partner_id") WHERE "kind" = 'PARTNER';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_obd_tenant_account ON "opening_balance_docs" ("tenant_id", "account_id") WHERE "kind" = 'ACCOUNT';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_obd_tenant_item ON "opening_balance_docs" ("tenant_id", "item_id") WHERE "kind" = 'STOCK';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_obd_tenant_kind ON "opening_balance_docs" ("tenant_id", "kind");

--> statement-breakpoint
-- Attachments usage (PHASE-006 §2.7; ENTITY_CATALOG file_objects 002/006):
-- owner linkage for the PHASE-002 signed-URL substrate. Polymorphic
-- owner_type/owner_id validated at the service layer (typed existence
-- checks per owner); storage_key is tenant-prefixed and re-verified by
-- FilesService on every URL issuance (A11). Tombstone delete (files.manage).
CREATE TABLE IF NOT EXISTS "file_objects" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "owner_type" text NOT NULL,
  "owner_id" uuid NOT NULL,
  "storage_key" text NOT NULL,
  "name" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "content_type" text NOT NULL,
  "checksum" text,
  "uploaded_by" uuid,
  "deleted_at" timestamptz,
  CONSTRAINT pk_file_objects PRIMARY KEY ("id"),
  CONSTRAINT uq_file_objects_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_file_objects_tenant_storage_key UNIQUE ("tenant_id", "storage_key"),
  CONSTRAINT ck_file_objects_owner_values CHECK ("owner_type" IN ('PARTNER', 'ITEM', 'OPENING_BALANCE_DOC')),
  CONSTRAINT ck_file_objects_size CHECK ("size_bytes" > 0),
  CONSTRAINT ck_file_objects_name_length CHECK (length("name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_file_objects_tenant_owner ON "file_objects" ("tenant_id", "owner_type", "owner_id");

--> statement-breakpoint
-- Import jobs (PHASE-006 §2.6/T8; ADR-0008): preview-gated bulk import state.
-- The payload enqueued to pg-boss carries ONLY ids (tenantId, jobId) — file
-- bytes are fetched from the files store by key inside the handler.
-- upload_token uniqueness makes commit idempotent per token (same token →
-- same job row → single apply).
CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "kind" text NOT NULL,
  "format" text NOT NULL,
  "upload_token" text NOT NULL,
  "file_key" text NOT NULL,
  "file_name" text,
  "status" text NOT NULL DEFAULT 'PREVIEWING',
  "total_rows" integer NOT NULL DEFAULT 0,
  "valid_rows" integer NOT NULL DEFAULT 0,
  "invalid_rows" integer NOT NULL DEFAULT 0,
  "duplicate_rows" integer NOT NULL DEFAULT 0,
  "committed_rows" integer NOT NULL DEFAULT 0,
  "report" jsonb,
  "error" text,
  "committed_at" timestamptz,
  "created_by" uuid,
  CONSTRAINT pk_import_jobs PRIMARY KEY ("id"),
  CONSTRAINT uq_import_jobs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_import_jobs_tenant_token UNIQUE ("tenant_id", "upload_token"),
  CONSTRAINT ck_import_jobs_kind_values CHECK ("kind" IN ('PARTNERS', 'ITEMS', 'OPENING_BALANCES')),
  CONSTRAINT ck_import_jobs_format_values CHECK ("format" IN ('CSV', 'XLSX')),
  CONSTRAINT ck_import_jobs_status_values CHECK ("status" IN ('PREVIEWING', 'PREVIEW_READY', 'COMMITTING', 'COMMITTED', 'FAILED')),
  CONSTRAINT ck_import_jobs_counts CHECK ("total_rows" >= 0 AND "valid_rows" >= 0 AND "invalid_rows" >= 0 AND "duplicate_rows" >= 0 AND "committed_rows" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_import_jobs_tenant_status ON "import_jobs" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_import_jobs_tenant_created ON "import_jobs" ("tenant_id", "created_at");

--> statement-breakpoint
-- BR-003 "branch default list" level (PHASE-006 §2.3): nullable additive
-- column — expand-migrate-contract; branch-level assignment UI ships with
-- this phase, resolution consumes it via the pricing service.
ALTER TABLE "branches" ADD COLUMN IF NOT EXISTS "default_price_list_id" uuid;
--> statement-breakpoint
ALTER TABLE "branches" DROP CONSTRAINT IF EXISTS fk_branches_default_price_list;
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT fk_branches_default_price_list
  FOREIGN KEY ("default_price_list_id", "tenant_id")
  REFERENCES "price_lists" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- Per-tenant seeds (SEEDS/README: uoms "tenant-extendable", credit terms
-- NET-7/15/30/60, universal conversion pair kg↔g only — box/carton factors
-- are tenant-specific by design, never fabricated): idempotent by NATURAL
-- KEY (tenant_id, code) — the id is minted once on first insert and re-runs
-- converge via ON CONFLICT DO NOTHING (gen_random_uuid keeps ids
-- RFC-UUID-valid for API round-trips; app-generated rows stay UUIDv7).
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'PCS', 'Piece', 'قطعة', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'KG', 'Kilogram', 'كيلوجرام', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'G', 'Gram', 'جرام', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'L', 'Liter', 'لتر', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'BOX', 'Box', 'صندوق', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'CTN', 'Carton', 'كرتونة', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'M', 'Meter', 'متر', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uoms" ("id", "tenant_id", "code", "name", "name_ar", "is_system")
SELECT gen_random_uuid(), t."id", 'HR', 'Hour', 'ساعة', true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "credit_terms" ("id", "tenant_id", "code", "name", "name_ar", "days", "is_system")
SELECT gen_random_uuid(), t."id", 'NET-7', 'Net 7 days', 'صافي 7 أيام', 7, true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "credit_terms" ("id", "tenant_id", "code", "name", "name_ar", "days", "is_system")
SELECT gen_random_uuid(), t."id", 'NET-15', 'Net 15 days', 'صافي 15 يومًا', 15, true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "credit_terms" ("id", "tenant_id", "code", "name", "name_ar", "days", "is_system")
SELECT gen_random_uuid(), t."id", 'NET-30', 'Net 30 days', 'صافي 30 يومًا', 30, true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
INSERT INTO "credit_terms" ("id", "tenant_id", "code", "name", "name_ar", "days", "is_system")
SELECT gen_random_uuid(), t."id", 'NET-60', 'Net 60 days', 'صافي 60 يومًا', 60, true
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "code") DO NOTHING;
--> statement-breakpoint
-- Universal conversion pair (kg↔g only — factors exact at 6-dp).
INSERT INTO "uom_conversions" ("id", "tenant_id", "from_uom_id", "to_uom_id", "factor")
SELECT gen_random_uuid(), t."id",
  (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = t."id" AND u."code" = 'KG'),
  (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = t."id" AND u."code" = 'G'), 1000
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "from_uom_id", "to_uom_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "uom_conversions" ("id", "tenant_id", "from_uom_id", "to_uom_id", "factor")
SELECT gen_random_uuid(), t."id",
  (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = t."id" AND u."code" = 'G'),
  (SELECT "id" FROM "uoms" u WHERE u."tenant_id" = t."id" AND u."code" = 'KG'), 0.001
FROM "tenants" t WHERE t."deleted_at" IS NULL
ON CONFLICT ("tenant_id", "from_uom_id", "to_uom_id") DO NOTHING;

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): standard macro on all fifteen tenant-owned
-- tables (the completeness test enforces the registry stays in sync).
SELECT erp.apply_tenant_policy('"credit_terms"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"price_lists"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"partners"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"partner_contacts"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"partner_addresses"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"item_categories"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"uoms"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"uom_conversions"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"items"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"barcodes"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"price_list_items"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"partner_balances"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"opening_balance_docs"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"file_objects"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"import_jobs"');

--> statement-breakpoint
-- Grants: master data is INSERT/UPDATE only — lifecycle is archive
-- (tombstone) + RESTRICT FKs, never row DELETE (files.manage delete is a
-- tombstone too, so no DELETE grant on file_objects).
REVOKE ALL ON "credit_terms", "price_lists", "partners", "partner_contacts",
  "partner_addresses", "item_categories", "uoms", "uom_conversions", "items",
  "barcodes", "price_list_items", "partner_balances", "opening_balance_docs",
  "file_objects", "import_jobs" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "credit_terms" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "price_lists" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "partners" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "partner_contacts" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "partner_addresses" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "item_categories" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "uoms" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "uom_conversions" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "items" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "barcodes" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "price_list_items" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "partner_balances" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "opening_balance_docs" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "file_objects" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "import_jobs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "credit_terms", "price_lists", "partners", "partner_contacts",
  "partner_addresses", "item_categories", "uoms", "uom_conversions", "items",
  "barcodes", "price_list_items", "partner_balances", "opening_balance_docs",
  "file_objects", "import_jobs" TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (support-access read-all proxy composition, as 0007).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "credit_terms", "price_lists", "partners", "partner_contacts",
  "partner_addresses", "item_categories", "uoms", "uom_conversions", "items",
  "barcodes", "price_list_items", "partner_balances", "opening_balance_docs",
  "file_objects", "import_jobs" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 9)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
