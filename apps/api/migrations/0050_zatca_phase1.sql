-- PHASE-037 (Blueprint v3.0 · CR-07) · migration 0050 · ZATCA Phase-1 & QR
-- compliance (H-01 Phase-1 / H-02 · X-08 P1 · DF-54)
--
-- Purpose (PHASE-037 §4 Design Impact): the Saudi e-invoicing Phase-1
-- GENERATION substrate, with ZERO external APIs — the TLV-base64 QR
-- payload, the per-device ICV counter, and the previous-invoice-hash
-- (PIH) chain. Two shapes:
--
--   sales_invoices addenda — additive NULLABLE columns (append-only
--     discipline: existing rows never reshape; history is filled by the
--     backfill job, never rewritten):
--       zatca_device_id        — the issuing EIAS device (chain anchor)
--       icv                    — the invoice counter (1..N per device,
--                                strictly monotonic, zero gaps — INV-027)
--       previous_invoice_hash  — PIH (base64; genesis = base64 SHA-256 "0")
--       invoice_hash           — this invoice's digest (base64, v1 marker)
--       qr_payload             — the base64 TLV payload (render-at-print
--                                only — the image is NEVER stored, OA-06)
--       classification         — STANDARD | SIMPLIFIED (the B2C path)
--     plus the partial unique (tenant, device, icv) WHERE icv IS NOT
--     NULL — the DB-level INV-027 uniqueness floor (a device can never
--     mint the same counter twice, even under a race).
--
--   zatca_devices — the per-tenant EIAS device registry (RLS'd): device
--     UUID/serial as ZATCA assigns them, solution-provider placeholder
--     fields (Phase-2 CSID onboarding completes them), an explicit
--     registration status vocabulary whose ONLY reachable value before
--     PHASE-054 is NOT_REGISTERED (the honesty placeholder — the DB CHECK
--     admits the future states so 054 needs no reshape, but the app
--     surface writes NOT_REGISTERED only), and the per-device icv_counter
--     (the chain anchor; minting increments it transactionally).
--
-- INV-022 ledger: +1 table (ENTITY_CATALOG 203 → 204), +0 journals (the
-- chain stamps the invoice's own post transaction — it never posts), +1
-- permission key (248 → 249: tax.einvoicing.devices.manage — §8 below,
-- matrix §3.7), +0 feature keys (Phase-1 rides the existing
-- tax.einvoicing_zatca entitlement; FEATURE_CATALOG unchanged).
--
-- Grants: zatca_devices carries SELECT/INSERT/UPDATE for erp_app —
-- NO DELETE (devices are the chain anchor; a device with issued invoices
-- is archive-disabled by the service, and the purge path covers
-- offboarding). The sales_invoices addenda touch NO grants (the table's
-- existing shapes stay; the new columns ride them).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. sales_invoices addenda (T-02/T-07): the four chain columns + the
-- classification + the device link, all NULLABLE (zero reshape of existing
-- rows — the backfill fills history in issuance order).
--> statement-breakpoint
ALTER TABLE "sales_invoices"
  ADD COLUMN IF NOT EXISTS "zatca_device_id" uuid,
  ADD COLUMN IF NOT EXISTS "icv" integer,
  ADD COLUMN IF NOT EXISTS "previous_invoice_hash" text,
  ADD COLUMN IF NOT EXISTS "invoice_hash" text,
  ADD COLUMN IF NOT EXISTS "qr_payload" text,
  ADD COLUMN IF NOT EXISTS "invoice_hash_version" text,
  ADD COLUMN IF NOT EXISTS "classification" text;

--> statement-breakpoint
-- The classification vocabulary (STANDARD = B2B standard tax invoice,
-- SIMPLIFIED = B2C simplified tax invoice — the ZATCA Phase-1 document
-- types; POS receipts are SIMPLIFIED by default).
ALTER TABLE "sales_invoices"
  DROP CONSTRAINT IF EXISTS ck_sales_invoices_classification,
  ADD CONSTRAINT ck_sales_invoices_classification CHECK (
    "classification" IS NULL OR "classification" IN ('STANDARD', 'SIMPLIFIED'));

--> statement-breakpoint
-- Chain columns cohere: a stamped invoice carries ALL of them (the
-- backfill stamps atomically; no partial stamp can exist).
ALTER TABLE "sales_invoices"
  DROP CONSTRAINT IF EXISTS ck_sales_invoices_zatca_stamp_shape,
  ADD CONSTRAINT ck_sales_invoices_zatca_stamp_shape CHECK (
    ("zatca_device_id" IS NULL AND "icv" IS NULL AND "previous_invoice_hash" IS NULL
      AND "invoice_hash" IS NULL AND "qr_payload" IS NULL AND "invoice_hash_version" IS NULL)
    OR ("zatca_device_id" IS NOT NULL AND "icv" IS NOT NULL AND "previous_invoice_hash" IS NOT NULL
      AND "invoice_hash" IS NOT NULL AND "qr_payload" IS NOT NULL AND "invoice_hash_version" IS NOT NULL));

--> statement-breakpoint
-- A SIMPLIFIED invoice carries a stamp by the time it is POSTED? NO — that
-- is BR-060's APPLICATION guard (fail-closed typed rejection at post and
-- print); a DB-level equality would break the DRAFT lifecycle (stamps
-- land at post). The stamp-shape CHECK above is the DB floor.

--> statement-breakpoint
-- The INV-027 DB floor: one invoice per (tenant, device, icv) — the
-- partial unique makes a counter collision a constraint violation even
-- under concurrent minting races.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_invoices_tenant_device_icv
  ON "sales_invoices" ("tenant_id", "zatca_device_id", "icv")
  WHERE "zatca_device_id" IS NOT NULL AND "icv" IS NOT NULL;

--> statement-breakpoint
-- The chain-verification walk index (OA-06: EXPLAIN-verified path): the
-- verification service walks a device's chain in ICV order.
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_device_icv
  ON "sales_invoices" ("tenant_id", "zatca_device_id", "icv")
  WHERE "zatca_device_id" IS NOT NULL;

--> statement-breakpoint
-- The classification filter (the B2C path surface — lists + the report).
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_classification
  ON "sales_invoices" ("tenant_id", "classification")
  WHERE "classification" IS NOT NULL;

--> statement-breakpoint
COMMENT ON COLUMN "sales_invoices"."zatca_device_id" IS
  'PHASE-037: the issuing ZATCA EIAS device (zatca_devices.id) — the chain anchor for ICV/PIH.';
COMMENT ON COLUMN "sales_invoices"."icv" IS
  'PHASE-037: invoice counter (ICV) — strictly monotonic 1..N per device, zero gaps (INV-027; DB floor uq_sales_invoices_tenant_device_icv).';
COMMENT ON COLUMN "sales_invoices"."previous_invoice_hash" IS
  'PHASE-037: PIH — the predecessor''s stored invoice_hash; genesis = base64(SHA-256(ASCII "0")).';
COMMENT ON COLUMN "sales_invoices"."invoice_hash" IS
  'PHASE-037: this invoice''s hash digest (base64; invoice_hash_version marks the digest implementation — UBL 2.1 digest lands in PHASE-054).';
COMMENT ON COLUMN "sales_invoices"."qr_payload" IS
  'PHASE-037: the base64 TLV QR payload (five mandated fields) — stored, rendered to an image at print time only (OA-06).';
COMMENT ON COLUMN "sales_invoices"."invoice_hash_version" IS
  'PHASE-037: the digest implementation marker (invoice-hash-v1; PHASE-054 finalizes with UBL 2.1 and re-derives).';
COMMENT ON COLUMN "sales_invoices"."classification" IS
  'PHASE-037: invoice classification — STANDARD (B2B) | SIMPLIFIED (B2C); BR-060 fail-closed guards post+print for KSA-VAT tenants.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. zatca_devices (T-02): the per-tenant EIAS device registry. The
-- registration status is the honesty placeholder: NOT_REGISTERED is the
-- only value the Phase-1 application surface writes (the CHECK admits the
-- future Phase-2 states so 054 evolves vocabulary, never reshape).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "zatca_devices" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "name" text NOT NULL,
  "name_ar" text,
  -- ZATCA-assigned device identity (EIAS). Both are placeholders until the
  -- Phase-2 onboarding issues them; the service validates shape when set.
  "device_uuid" text,
  "device_serial" text,
  -- Solution-provider placeholder fields (the onboarding vendor data —
  -- PHASE-054 completes them; stored verbatim, never guessed).
  "solution_provider_name" text,
  "solution_provider_vat" text,
  -- Registration status: NOT_REGISTERED is the only reachable value in
  -- Phase-1 (BR-061 honesty — no registry claims). CHECK admits the
  -- Phase-2 lifecycle so 054 needs no shape migration.
  "registration_status" text NOT NULL DEFAULT 'NOT_REGISTERED',
  -- The chain anchor: the next ICV this device mints is icv_counter + 1.
  -- Minting increments it transactionally inside the invoice post.
  "icv_counter" integer NOT NULL DEFAULT 0,
  -- Optional branch binding (a device may serve one branch's terminals).
  "branch_id" uuid,
  "note" text,
  CONSTRAINT pk_zatca_devices PRIMARY KEY ("id"),
  CONSTRAINT uq_zatca_devices_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_zatca_devices_tenant_name UNIQUE ("tenant_id", "name"),
  CONSTRAINT uq_zatca_devices_tenant_device_uuid UNIQUE ("tenant_id", "device_uuid"),
  CONSTRAINT ck_zatca_devices_name_length CHECK (length("name") BETWEEN 1 AND 160),
  CONSTRAINT ck_zatca_devices_registration_status CHECK (
    "registration_status" IN ('NOT_REGISTERED', 'PENDING', 'REGISTERED', 'REVOKED')),
  CONSTRAINT ck_zatca_devices_icv_counter CHECK ("icv_counter" >= 0),
  CONSTRAINT ck_zatca_devices_device_uuid_shape CHECK (
    "device_uuid" IS NULL OR "device_uuid" ~ '^[0-9a-fA-F-]{36}$'),
  CONSTRAINT ck_zatca_devices_vat_shape CHECK (
    "solution_provider_vat" IS NULL OR "solution_provider_vat" ~ '^\d{15}$')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_zatca_devices_tenant_status
  ON "zatca_devices" ("tenant_id", "registration_status");

--> statement-breakpoint
COMMENT ON TABLE "zatca_devices" IS
  'PHASE-037 T-02: the per-tenant ZATCA EIAS device registry — device UUID/serial + solution-provider placeholders, registration_status (NOT_REGISTERED only in Phase-1; BR-061), and icv_counter — the chain anchor minted transactionally per invoice post (INV-027).';

--> statement-breakpoint
-- The invoice → device link rides a composite tenant FK (the house
-- convention — the tenant_id of both sides must agree).
ALTER TABLE "sales_invoices"
  DROP CONSTRAINT IF EXISTS fk_sales_invoices_zatca_device;
ALTER TABLE "sales_invoices"
  ADD CONSTRAINT fk_sales_invoices_zatca_device FOREIGN KEY ("zatca_device_id", "tenant_id")
    REFERENCES "zatca_devices" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "zatca_devices"
  DROP CONSTRAINT IF EXISTS fk_zatca_devices_branch;
ALTER TABLE "zatca_devices"
  ADD CONSTRAINT fk_zatca_devices_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS (TENANT_ISOLATION §2): the house macro on the new tenant table.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"zatca_devices"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3b. Purge path (the 0036/0042/0043/0049 discipline): the device rows
-- join the tenant offboarding export→purge flow per DATA_PROTECTION §4.
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS purge_path_delete ON public.%I', 'zatca_devices');
  EXECUTE format('DROP POLICY IF EXISTS purge_path_update ON public.%I', 'zatca_devices');
  EXECUTE format(
    'CREATE POLICY purge_path_delete ON public.%I FOR DELETE TO erp_migrate '
      || 'USING (tenant_id = erp.current_tenant_id())', 'zatca_devices');
  EXECUTE format(
    'CREATE POLICY purge_path_update ON public.%I FOR UPDATE TO erp_migrate '
      || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)', 'zatca_devices');
END $$;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. Grants: SELECT/INSERT/UPDATE on the device registry — NO DELETE
-- (the chain anchor is archive-not-delete; the purge path covers
-- offboarding). The sales_invoices addenda touch no grants.
--> statement-breakpoint
REVOKE ALL ON "zatca_devices" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "zatca_devices" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "zatca_devices" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "zatca_devices" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Permission seed (PHASE-037 §4): ONE new key —
--    tax.einvoicing.devices.manage (matrix §3.7) — the EIAS device
--    registry manager (create devices, view chain status). Zero-drift
--    extends 248 → 249 (seed = mirror; the drift CLI joins this file).
--    The owner template cross-join re-runs idempotently (every
--    tenant-plane key); the accountant gains it (tax module stewardship —
--    the tax.einvoicing.manage family pattern). Viewer deliberately does
--    NOT hold it.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('tax.einvoicing.devices.manage', 'tax', 'Manage ZATCA EIAS devices and view their chain status / إدارة أجهزة الفوترة الإلكترونية وعرض حالة السلسلة')
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
SELECT r."id", NULL, 'tax.einvoicing.devices.manage'
FROM "roles" r WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. Feature plan grant: NONE — Phase-1 generation rides the existing
-- tax.einvoicing_zatca entitlement (FEATURE_CATALOG.md unchanged; the
-- plan grants stay untouched; template-composable behavior preserved).
-- ---------------------------------------------------------------------------

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 50)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
