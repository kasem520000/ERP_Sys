-- PHASE-023 · migration 0035 · external integrations & e-invoicing
--
-- Purpose (PHASE-023 §4 Design Impact + MASTER-PLAN §1): the submission
-- registry becomes OPERATIONAL (E_INVOICING_ARCHITECTURE §2/§6: lifecycle
-- PENDING → GENERATED → SIGNED → SUBMITTED → ACCEPTED/REJECTED → REPORTED
-- with retries, dead-letter, audit; raw payloads/responses as ENCRYPTED
-- files), certificates gain their S-10 metadata registry (SECRETS §6 —
-- path + lifecycle ONLY, key material never in the DB), per-tenant adapter
-- rollout flags default OFF (T13), bank-statement parking for unparseable
-- lines (T7 — never a guessed amount), the shipped bank-format registry
-- rows, commerce-channel import bookkeeping (T8), and the billing payout
-- substrate (T6 hardening).
--
-- Gated-shipping note (§2.3): this migration is 100% ungated scope — no
-- ZATCA wire format, no authority field list, no certificate flow is
-- encoded here. The registry state machine is adapter-neutral; adapter
-- enablement ships default OFF.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. e_invoicing_submissions expand (T1/T2): the PHASE-009 schema-only
-- registry gains the operational lifecycle columns. SIGNED + REPORTED join
-- the status enum (DATA_DICTIONARY already documents the full ladder);
-- attempts/next_attempt_at drive the retry sweep; authority_refs is the
-- JSONB array of authority-issued references (ICV/UUID etc. stored as
-- compliance payload fields — ADR-0006: never replacing platform identity);
-- payload_file_id/response_file_id point at the encrypted files-module
-- objects (seal-envelope AES-256-GCM, tenant-scoped signed URLs on read).
--
-- Expand-contract: the 009 UNIQUE (tenant_id, source_type, source_id)
-- becomes (…, adapter_id) — RELATIONSHIPS.md documents documents →
-- submissions as 1:N PER ADAPTER, and registry idempotency is exactly "one
-- row per document × adapter" (the no-double-clearance guarantee). No
-- legacy rows exist to backfill (schema was test-only).
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" DROP CONSTRAINT IF EXISTS uq_e_invoicing_submissions_source;
--> statement-breakpoint
-- Registry idempotency is ONE LIVE ROW per document × adapter: a PARTIAL
-- unique index over the non-terminal states (PENDING/GENERATED/SIGNED/
-- SUBMITTED/ACCEPTED/REPORTED). REJECTED/FAILED rows are history — the
-- resubmission chain (retry_of_submission_id) appends new rows while the
-- superseded ones stay immutable (append-only history, E_INVOICING §2 +
-- TROUBLESHOOTING §10: "create a NEW submission — never edit history").
CREATE UNIQUE INDEX IF NOT EXISTS uq_einvoicing_submissions_live
  ON "e_invoicing_submissions" ("tenant_id", "source_type", "source_id", "adapter_id")
  WHERE "status" IN ('PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED', 'ACCEPTED', 'REPORTED');
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" DROP CONSTRAINT IF EXISTS ck_e_invoicing_status_values;
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" ADD CONSTRAINT ck_e_invoicing_status_values CHECK ("status" IN
  ('PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'REPORTED', 'FAILED'));
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" ADD COLUMN IF NOT EXISTS "next_attempt_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" ADD COLUMN IF NOT EXISTS "authority_refs" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" ADD COLUMN IF NOT EXISTS "payload_file_id" uuid;
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" ADD COLUMN IF NOT EXISTS "response_file_id" uuid;
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" ADD COLUMN IF NOT EXISTS "reported_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" ADD COLUMN IF NOT EXISTS "last_error_code" text;
--> statement-breakpoint
ALTER TABLE "e_invoicing_submissions" ADD COLUMN IF NOT EXISTS "retry_of_submission_id" uuid;
--> statement-breakpoint
-- The append-only attempt chain: a resubmission (after REJECTED or a
-- user-actioned fix) links to the row it supersedes — history is never
-- rewritten, the chain is the audit substrate.
CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_retry_of
  ON "e_invoicing_submissions" ("tenant_id", "retry_of_submission_id");
--> statement-breakpoint
COMMENT ON TABLE "e_invoicing_submissions" IS
  'PHASE-023 OPERATIONAL submission registry (E_INVOICING §2): lifecycle PENDING → GENERATED → SIGNED → SUBMITTED → ACCEPTED/REJECTED → REPORTED with exponential-capped retries, dead-letter alerting, full audit. Registry status is the SOLE source of authority truth (directive §12) — a document''s official validity never depends on local state. One row per document × adapter (registry idempotency — no double clearance).';
--> statement-breakpoint
-- The retry/DLQ sweep index: only live-retry states have next_attempt_at.
CREATE INDEX IF NOT EXISTS ix_einvoicing_submissions_retry
  ON "e_invoicing_submissions" ("status", "next_attempt_at")
  WHERE "status" IN ('PENDING', 'GENERATED', 'SIGNED', 'SUBMITTED');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. e_invoicing_certificates (T5; SECRETS §6 — S-10 HIGHEST): metadata +
-- lifecycle registry ONLY. The encrypted key blob lives in the files store
-- under einvoicing/{jurisdiction}/{tenant}/… paths; this table records the
-- path, fingerprint, validity window and rotation chain so expiry
-- monitoring (30/14/7-day alerts) and usage audit have their substrate.
-- The API role has NO column here that contains key material — by design.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "e_invoicing_certificates" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "country_code" char(2) NOT NULL REFERENCES "jurisdictions" ("country_code") ON DELETE RESTRICT,
  "adapter_id" text NOT NULL,
  "label" text NOT NULL,
  "key_version" text NOT NULL,
  "secret_path" text NOT NULL,
  "fingerprint" text NOT NULL,
  "not_before" timestamptz NOT NULL,
  "not_after" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "enrolled_by" uuid,
  "enrolled_at" timestamptz NOT NULL DEFAULT now(),
  "rotated_from_id" uuid,
  "sign_count" bigint NOT NULL DEFAULT 0,
  "last_used_at" timestamptz,
  "expires_alerted_at" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT pk_e_invoicing_certificates PRIMARY KEY ("id"),
  CONSTRAINT uq_e_invoicing_certificates_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_e_invoicing_certificates_path UNIQUE ("secret_path"),
  CONSTRAINT ck_e_invoicing_cert_status CHECK ("status" IN
    ('ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'REVOKED')),
  CONSTRAINT ck_e_invoicing_cert_path_shape CHECK ("secret_path" LIKE 'einvoicing/%'),
  CONSTRAINT ck_e_invoicing_cert_window CHECK ("not_after" > "not_before"),
  CONSTRAINT ck_e_invoicing_cert_label CHECK (length("label") BETWEEN 1 AND 120),
  CONSTRAINT fk_e_invoicing_cert_rotated_from FOREIGN KEY ("rotated_from_id", "tenant_id")
    REFERENCES "e_invoicing_certificates" ("id", "tenant_id") ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_einvoicing_certs_tenant
  ON "e_invoicing_certificates" ("tenant_id", "adapter_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "e_invoicing_certificates" IS
  'PHASE-023 T5: e-invoicing certificate registry (SECRETS §6 S-10 HIGHEST) — path/lifecycle metadata only; the encrypted blob is external (files store einvoicing/{jurisdiction}/{tenant}/…). Signing-job-only access: no API surface reads key material; usage audited per decrypt/sign; expiry alerts at 30/14/7 days; offboarding purge removes secret paths.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. e_invoicing_certificate_usage (T5): append-only usage audit — every
-- decrypt + sign operation writes a row (tenant, certificate, submission,
-- operation, key version) feeding the signing-volume dashboard. INSERT +
-- SELECT only (grants); retention sweeps bound growth.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "e_invoicing_certificate_usage" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "certificate_id" uuid NOT NULL,
  "submission_id" uuid,
  "operation" text NOT NULL,
  "key_version" text NOT NULL,
  "used_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_einvoicing_cert_usage PRIMARY KEY ("id"),
  CONSTRAINT uq_einvoicing_cert_usage_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_einvoicing_cert_usage_op CHECK ("operation" IN ('SIGN', 'DECRYPT')),
  CONSTRAINT fk_einvoicing_cert_usage_cert FOREIGN KEY ("certificate_id", "tenant_id")
    REFERENCES "e_invoicing_certificates" ("id", "tenant_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_einvoicing_cert_usage_cert
  ON "e_invoicing_certificate_usage" ("tenant_id", "certificate_id", "used_at");
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. e_invoicing_adapter_settings (T13): the per-tenant rollout flag —
-- default OFF for every adapter in every jurisdiction (DEPLOYMENT §7
-- PHASE-023 row). Enablement is a gated, audited action that requires a
-- provisioned ACTIVE certificate (service-enforced; the gate test asserts
-- it). The global feature_flags table stays platform-only (L8) — this is
-- tenant-owned configuration, RLS-scoped.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "e_invoicing_adapter_settings" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "adapter_id" text NOT NULL,
  "country_code" char(2) NOT NULL REFERENCES "jurisdictions" ("country_code") ON DELETE RESTRICT,
  "enabled" boolean NOT NULL DEFAULT false,
  "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled_by" uuid,
  "enabled_at" timestamptz,
  CONSTRAINT pk_einvoicing_adapter_settings PRIMARY KEY ("id"),
  CONSTRAINT uq_einvoicing_adapter_settings UNIQUE ("tenant_id", "adapter_id"),
  CONSTRAINT ck_einvoicing_settings_enabled_shape CHECK (
    ("enabled" = false) OR ("enabled_by" IS NOT NULL AND "enabled_at" IS NOT NULL)
  )
);
--> statement-breakpoint
COMMENT ON TABLE "e_invoicing_adapter_settings" IS
  'PHASE-023 T13: per-tenant e-invoicing adapter rollout flags — default OFF; enabling requires a provisioned ACTIVE certificate (service gate) and is audited. Adapter enablement NEVER touches the global feature_flags table (platform L8 vs tenant configuration).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. bank_statement_parked_lines (T7): unparseable statement rows park for
-- manual mapping — NEVER a guessed amount into bank_statement_lines. The
-- raw cells are stored verbatim (jsonb array of strings); resolution
-- writes the mapped bank_statement_line and links it; discard records why.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_statement_parked_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "statement_id" uuid NOT NULL,
  "line_index" integer NOT NULL,
  "raw_cells" jsonb NOT NULL,
  "raw_line" text NOT NULL,
  "parked_reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PARKED',
  "resolved_line_id" uuid,
  "resolved_by" uuid,
  "resolved_at" timestamptz,
  "resolution_note" text,
  CONSTRAINT pk_bank_parked_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_bank_parked_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_bank_parked_lines_slot UNIQUE ("statement_id", "line_index"),
  CONSTRAINT ck_bank_parked_status CHECK ("status" IN ('PARKED', 'RESOLVED', 'DISCARDED')),
  CONSTRAINT ck_bank_parked_reason CHECK (length("parked_reason") BETWEEN 1 AND 200),
  CONSTRAINT ck_bank_parked_index CHECK ("line_index" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bank_parked_tenant_status
  ON "bank_statement_parked_lines" ("tenant_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "bank_statement_parked_lines" IS
  'PHASE-023 T7: parked unparseable bank-statement rows awaiting manual mapping — raw cells stored verbatim, amounts NEVER guessed (the mapper confirms every field); resolution links the created bank_statement_line.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. bank_statement_formats (global reference, seeded): the shipped
-- parser-format registry rows (integrations README §3.6 — "format registry
-- grows per bank; each parser declares columns it requires"). Rows
-- describe FORMAT FAMILIES (structural shapes), not bank-specific claims —
-- no format is attributed to a bank without verified documentation
-- (NO-FABRICATION). erp_migrate writes; everyone else reads.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_statement_formats" (
  "key" text NOT NULL,
  "label_en" text NOT NULL,
  "label_ar" text NOT NULL,
  "family" text NOT NULL,
  "extensions" jsonb NOT NULL,
  "required_columns" jsonb NOT NULL,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_bank_statement_formats PRIMARY KEY ("key"),
  CONSTRAINT ck_bank_formats_family CHECK ("family" IN ('csv', 'xlsx'))
);
--> statement-breakpoint
INSERT INTO "bank_statement_formats" ("key", "label_en", "label_ar", "family", "extensions", "required_columns", "notes") VALUES
  ('generic-csv', 'Generic CSV (mapped columns)', 'CSV عام (أعمدة مخططة)', 'csv',
    '[".csv"]', '["date", "amount"]',
    'PHASE-008 generic CSV adapter: AR/EN header aliases, tenant-supplied column mapping, UTF-8 BOM tolerated.'),
  ('generic-xlsx', 'Generic Excel workbook', 'مصنف Excel عام', 'xlsx',
    '[".xlsx"]', '["date", "amount"]',
    'PHASE-008 generic XLSX adapter (exceljs), first worksheet, AR/EN header aliases.'),
  ('csv-debit-credit', 'CSV with separate debit/credit columns', 'CSV بأعمدة مدين/دائن منفصلة', 'csv',
    '[".csv"]', '["date", "debit_or_credit"]',
    'PHASE-023 T7: two-column amount family — signed amount derived from the debit/credit pair (a row with both or neither parks); balance columns optional.'),
  ('csv-with-balances', 'CSV with running balance columns', 'CSV بأعمدة رصيد جارٍ', 'csv',
    '[".csv"]', '["date", "amount", "balance"]',
    'PHASE-023 T7: single signed amount + running balance; balance drift (parsed running balance ≠ previous balance ± amount) is recorded as an advisory warning, never a silent correction.')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
COMMENT ON TABLE "bank_statement_formats" IS
  'PHASE-023 T7: the shipped bank-statement format registry — format families with declared required columns (integrations README §3.6). No bank-specific attribution without verified documentation.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. commerce_channel_orders (T8): imported channel orders staged for the
-- server-decision conflict policy — upsert by natural key (tenant, channel,
-- channel order id); financial-field changes on re-import flag CONFLICT
-- with the previous payload preserved in conflict_detail; resolution is an
-- explicit human decision (ADR-0012 — no LWW anywhere).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commerce_channel_orders" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "channel_adapter_id" text NOT NULL,
  "channel_order_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'IMPORTED',
  "conflict_detail" jsonb,
  "import_batch_id" uuid,
  "resolved_by" uuid,
  "resolved_at" timestamptz,
  "resolution" text,
  CONSTRAINT pk_commerce_channel_orders PRIMARY KEY ("id"),
  CONSTRAINT uq_commerce_channel_orders_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_commerce_channel_orders_natural UNIQUE ("tenant_id", "channel_adapter_id", "channel_order_id"),
  CONSTRAINT ck_commerce_orders_status CHECK ("status" IN ('IMPORTED', 'CONFLICT', 'RESOLVED')),
  CONSTRAINT ck_commerce_channel_id CHECK (length("channel_adapter_id") BETWEEN 2 AND 40),
  CONSTRAINT ck_commerce_order_id CHECK (length("channel_order_id") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_commerce_orders_tenant_status
  ON "commerce_channel_orders" ("tenant_id", "channel_adapter_id", "status");
--> statement-breakpoint
COMMENT ON TABLE "commerce_channel_orders" IS
  'PHASE-023 T8: staged e-commerce channel orders — upsert by natural key (tenant, channel, channel order id); financial-field drift on re-import flags CONFLICT for explicit server-decision resolution; never last-write-wins (ADR-0012).';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. commerce_channel_imports (T8): batch bookkeeping — the Idempotency-Key
-- per batch (duplicate batch replays return the recorded outcome without
-- re-pulling), cursor before/after, and the pulled/imported/skipped/conflict
-- counters the UI surfaces.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commerce_channel_imports" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "channel_adapter_id" text NOT NULL,
  "batch_key" text NOT NULL,
  "cursor_before" jsonb,
  "cursor_after" jsonb,
  "pulled_count" integer NOT NULL DEFAULT 0,
  "imported_count" integer NOT NULL DEFAULT 0,
  "skipped_count" integer NOT NULL DEFAULT 0,
  "conflict_count" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'COMPLETED',
  "error" text,
  CONSTRAINT pk_commerce_channel_imports PRIMARY KEY ("id"),
  CONSTRAINT uq_commerce_imports_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_commerce_imports_batch UNIQUE ("tenant_id", "channel_adapter_id", "batch_key"),
  CONSTRAINT ck_commerce_imports_status CHECK ("status" IN ('COMPLETED', 'FAILED'))
);
--> statement-breakpoint
COMMENT ON TABLE "commerce_channel_imports" IS
  'PHASE-023 T8: commerce-channel import batch bookkeeping — Idempotency-Key per batch (duplicate batch = recorded outcome replay), cursors, and per-batch counters.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. billing_payouts (T6): provider payout batches (gross/fees/net) for the
-- reconciliation job — sandbox-depth today (DR-002 OPEN), provider-shaped
-- tomorrow: the row records what the provider REPORTED; reconciliation
-- compares against settled platform payments in the window and reports
-- drift honestly. No production cutover claim.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_payouts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "provider_id" text NOT NULL,
  "provider_ref" text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "gross_amount" numeric(18, 4) NOT NULL,
  "fee_amount" numeric(18, 4) NOT NULL,
  "net_amount" numeric(18, 4) NOT NULL,
  "currency_code" char(3) NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "settled_payment_count" integer,
  "reconciled_at" timestamptz,
  "drift_detail" jsonb,
  "raw" jsonb,
  CONSTRAINT pk_billing_payouts PRIMARY KEY ("id"),
  CONSTRAINT uq_billing_payouts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_billing_payouts_ref UNIQUE ("provider_id", "provider_ref"),
  CONSTRAINT ck_billing_payouts_status CHECK ("status" IN ('PENDING', 'RECONCILED', 'DRIFT')),
  CONSTRAINT ck_billing_payouts_net CHECK ("net_amount" = "gross_amount" - "fee_amount"),
  CONSTRAINT ck_billing_payouts_period CHECK ("period_end" >= "period_start")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_billing_payouts_tenant
  ON "billing_payouts" ("tenant_id", "status", "period_end");
--> statement-breakpoint
COMMENT ON TABLE "billing_payouts" IS
  'PHASE-023 T6: provider payout batches (gross/fee/net per provider report) + reconciliation outcome (RECONCILED or DRIFT with detail). Sandbox-depth until DR-002 decides the provider; no production claim.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 10. notifications category widen (T2/T5/T10): 'einvoicing' — the
-- einvoice.submission.failed dead-letter notification (E_INVOICING §1)
-- and the CertExpiry 30/14/7-day escalation ladder (SECRETS §6). Same
-- widening shape as migrations 0023/0027 (both CHECK domains).
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS ck_notifications_category_values;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT ck_notifications_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing'
  ));
--> statement-breakpoint
ALTER TABLE "notification_prefs" DROP CONSTRAINT IF EXISTS ck_notification_prefs_category_values;
--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT ck_notification_prefs_category_values
  CHECK ("category" IN (
    'limits', 'subscription', 'reconciliation', 'invoice_overdue', 'stock', 'templates', 'crm',
    'einvoicing'
  ));
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 11. billing_events type widen (T6): 'payment.refunded' — the refund
-- flow's auditable trail (the invoice stays PAID; history is append-only).
--> statement-breakpoint
ALTER TABLE "billing_events" DROP CONSTRAINT IF EXISTS ck_billing_events_type_values;
--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT ck_billing_events_type_values
  CHECK ("type" IN (
    'trial.started', 'trial.expired',
    'checkout.created', 'checkout.completed', 'checkout.expired',
    'payment.succeeded', 'payment.failed',
    'manual_payment.recorded',
    'payment.refunded',
    'dunning.warned',
    'grace.entered',
    'suspension.executed',
    'subscription.restored',
    'plan.change.requested', 'plan.changed', 'downgrade.blocked',
    'limit.warning'
  ));
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- file_objects owner values expand: the encrypted submission payload and
-- authority response artifacts (EINVOICE_PAYLOAD / EINVOICE_RESPONSE) and
-- the certificate encrypted blob (EINVOICING_CERT).
--> statement-breakpoint
ALTER TABLE "file_objects" DROP CONSTRAINT IF EXISTS ck_file_objects_owner_values;
--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT ck_file_objects_owner_values
  CHECK ("owner_type" IN ('PARTNER', 'ITEM', 'OPENING_BALANCE_DOC', 'EXPENSE',
    'EINVOICE_PAYLOAD', 'EINVOICE_RESPONSE', 'EINVOICING_CERT'));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RLS (TENANT_ISOLATION §2): the macro on every new tenant-owned table.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"e_invoicing_certificates"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"e_invoicing_certificate_usage"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"e_invoicing_adapter_settings"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bank_statement_parked_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"commerce_channel_orders"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"commerce_channel_imports"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"billing_payouts"');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants (per-table shapes):
--  - submissions keep the 009 shape (full CRUD, the registry owns them);
--  - certificates: INSERT (enrollment), UPDATE (rotation/status/counters),
--    SELECT — DELETE never (revocation is a status, history is immutable);
--  - certificate usage: INSERT + SELECT only (append-only audit);
--  - adapter settings: INSERT/UPDATE/SELECT (toggle surface);
--  - parked lines: INSERT/UPDATE/SELECT (resolution), no DELETE (audit);
--  - commerce orders/imports: full CRUD on imports, INSERT/UPDATE/SELECT on
--    orders (no DELETE — import history is bookkeeping);
--  - payouts: INSERT/UPDATE/SELECT (reconciliation marks);
--  - bank_statement_formats: global reference — read-only to the app.
--> statement-breakpoint
REVOKE ALL ON "e_invoicing_certificates", "e_invoicing_certificate_usage",
  "e_invoicing_adapter_settings", "bank_statement_parked_lines",
  "commerce_channel_orders", "commerce_channel_imports", "billing_payouts" FROM erp_app;
--> statement-breakpoint
-- NOTE (DELETE grants): the ONLY DELETE callers are the tenant-offboarding
-- purge (certs/certificate-service.ts purgeTenantCertificates — DATA_PROTECTION
-- §4 step 6: key material and its usage trail must NOT survive offboarding;
-- usage rows go first, the FK). The runtime API surface never deletes:
-- revocation is a status; enrollment history is immutable otherwise.
GRANT SELECT, INSERT, UPDATE, DELETE ON "e_invoicing_certificates" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "e_invoicing_certificate_usage" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "e_invoicing_adapter_settings" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bank_statement_parked_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "commerce_channel_orders" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "commerce_channel_imports" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "billing_payouts" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "e_invoicing_certificates", "e_invoicing_certificate_usage",
  "e_invoicing_adapter_settings", "bank_statement_parked_lines",
  "commerce_channel_orders", "commerce_channel_imports", "billing_payouts" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "e_invoicing_certificates", "e_invoicing_certificate_usage",
  "e_invoicing_adapter_settings", "bank_statement_parked_lines",
  "commerce_channel_orders", "commerce_channel_imports", "billing_payouts" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "bank_statement_formats" FROM erp_app;
--> statement-breakpoint
GRANT SELECT ON "bank_statement_formats" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "bank_statement_formats" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "bank_statement_formats" TO erp_definer;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 12. permission seed (T8): sales.commerce.manage — the commerce-channel
-- import surface (pull orders, resolve conflicts). The owner template
-- cross-join re-runs idempotently (every tenant-plane key); the sales
-- role template gains the key per AUTHORIZATION_MATRIX §3.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('sales.commerce.manage', 'sales', 'Import e-commerce channel orders and resolve conflicts / إدارة استيراد طلبات قنوات التجارة الإلكترونية')
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
SELECT r."id", NULL, 'sales.commerce.manage'
FROM "roles" r WHERE r."key" = 'sales' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 13. plan grants (FEATURE_CATALOG §25 protocol step 3): the tenant-plane
-- PHASE-023 feature keys join business + enterprise — the bank-statement
-- parking aid + the commerce channel staging import. platform.payouts is
-- the operator console (the platform.subscriptions pattern — never
-- plan-gated). Idempotent array_cat.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['treasury.bank_statement_parking', 'sales.commerce_channels'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('treasury.bank_statement_parking' = ANY("feature_keys"));
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 35)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
