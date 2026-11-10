-- PHASE-004 · migration 0007 · accounts schema (created early for CoA
-- instantiation)
--
-- Purpose (PHASE-004 §2.3/T2): the tenant-owned `accounts` + `account_purposes`
-- tables per TABLES/core-accounting.md — created NOW because onboarding
-- instantiates the CoA template into them; the posting-readiness rules
-- (V1–V6, INV-004/005/015 guards) and every posting arrive with PHASE-007.
-- ENTITY_CATALOG currently marks both entities at PHASE-007; the phase
-- document itself orders the catalog markers corrected at completion to
-- "004 (schema+template) / 007 (posting)" — done in the docs sync, not a
-- silent drift.
--
-- Zero GL postings exist in this phase (acceptance 9): no journal tables,
-- no numbering service, no fiscal calendar — accounts rows are master data.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Chart-of-accounts nodes (TABLES §accounts): per-tenant codes (dictionary
-- §12 tenant-scoped natural key), bilingual names, the 5-type check that
-- drives statement mapping, the tree (parent composite FK — RESTRICT keeps
-- deletion structurally impossible), is_postable leaves (V5/INV-004), and
-- optional currency restriction (INV-005). Status ARCHIVE is blocked by
-- future V4 while postings/purposes reference the account.
CREATE TABLE IF NOT EXISTS "accounts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "type" text NOT NULL,
  "parent_id" uuid,
  "is_postable" boolean NOT NULL DEFAULT false,
  "currency_code" char(3) REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_accounts PRIMARY KEY ("id"),
  -- composite-FK anchor for journal_lines (PHASE-007) + account_purposes
  CONSTRAINT uq_accounts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_accounts_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_accounts_parent FOREIGN KEY ("parent_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_accounts_type_values CHECK ("type" IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  CONSTRAINT ck_accounts_status_values CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_accounts_code_shape CHECK ("code" ~ '^[0-9]{1,8}$'),
  CONSTRAINT ck_accounts_name_length CHECK (length("name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_accounts_tenant_parent ON "accounts" ("tenant_id", "parent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_accounts_tenant_type ON "accounts" ("tenant_id", "type");

--> statement-breakpoint
-- Purpose → account mapping (TABLES §account_purposes): the posting engine's
-- resolution layer — it never hard-codes account ids; it resolves
-- purpose_keys to the tenant's active account (1:1 per tenant per purpose,
-- active while active_to IS NULL — the partial unique below is V1). History
-- rows keep report-time resolution stable across changes (§2 "history
-- preserved for reports spanning the change"). PHASE-007 makes unmapped
-- purposes fail closed (PURPOSE_NOT_MAPPED); PHASE-004 only instantiates
-- the template markers (acceptance 2: purposes mapped 1:1).
CREATE TABLE IF NOT EXISTS "account_purposes" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "purpose_key" text NOT NULL,
  "account_id" uuid NOT NULL,
  "active_from" date NOT NULL,
  "active_to" date,
  CONSTRAINT pk_account_purposes PRIMARY KEY ("id"),
  CONSTRAINT fk_account_purposes_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_account_purposes_purpose_shape CHECK ("purpose_key" ~ '^[A-Z][A-Z0-9_]{2,40}$'),
  CONSTRAINT ck_account_purposes_window CHECK ("active_to" IS NULL OR "active_to" >= "active_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_purposes_tenant_purpose_active
  ON "account_purposes" ("tenant_id", "purpose_key") WHERE "active_to" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_account_purposes_tenant ON "account_purposes" ("tenant_id");

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): standard macro on both tenant-owned tables.
SELECT erp.apply_tenant_policy('"accounts"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"account_purposes"');

--> statement-breakpoint
-- Grants: accounts are master data — INSERT/UPDATE for onboarding/CoA
-- editing (tenancy onboarding + PHASE-007 accounting module), never
-- DELETE (lifecycle + RESTRICT make it structurally impossible anyway).
REVOKE ALL ON "accounts", "account_purposes" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "accounts" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "account_purposes" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "accounts", "account_purposes" TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (PHASE-004 support-access "read-all" proxy resolves
-- account rows inside the target tenant scope — projection-free; the grant
-- below exists so erp_definer-owned helper functions stay composable).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "accounts", "account_purposes" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 7)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
