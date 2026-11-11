-- PHASE-038 (Blueprint v3.0 · CR-08) · migration 0052 · Procurement
-- sourcing II — blanket agreements + the contract linkage (P-03 · P-06)
--
-- Purpose (PHASE-038 §4 Design Impact): the collaboration layer's
-- commitment instruments. Two shapes:
--
--   blanket_orders — the standing agreement with a supplier (RLS'd):
--     validity window, min/max commitment amounts, price-locked lines
--     (jsonb), status ACTIVE → EXPIRED/CLOSED/CANCELLED, and the
--     released_amount accumulator the service advances transactionally
--     (over-release is a typed rejection; the DB CHECK is the floor).
--     additive contract_id → crm.service_contracts (P-06).
--   blanket_releases — the append-only release ledger: each release
--     carries its lines (jsonb), the amount, and the generated purchase
--     order id (the executable document GRN/AP flow against). NO DELETE
--     — released commitment is audited history; the parent stays within
--     max_commitment by the CHECK + the transactional service update.
--
--   purchase_orders addendum — the additive NULLABLE contract_id column
--   (P-06: contract-linked purchasing; composite FK to
--   crm.service_contracts).
--
-- INV-022 ledger: +2 tables (ENTITY_CATALOG 209 → 211), +0 journals (a
-- release generates a purchase order — the PO's own lifecycle posts), +0
-- permissions (rides the §0051 sourcing keys), +0 feature keys
-- (purchasing.blanket_orders granted in 0051 §10).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. purchase_orders addenda (P-06): the additive contract linkage.
--> statement-breakpoint
ALTER TABLE "purchase_orders"
  ADD COLUMN IF NOT EXISTS "contract_id" uuid;

--> statement-breakpoint
COMMENT ON COLUMN "purchase_orders"."contract_id" IS
  'PHASE-038 (P-06): the linked CRM service contract (service_contracts.id) — contract-linked purchasing; NULLABLE additive column.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. blanket_orders (T-01/T-05): the standing supplier agreement.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blanket_orders" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "blanket_no" text NOT NULL,
  "supplier_id" uuid NOT NULL,
  -- P-06: the linked CRM service contract (contract-linked purchasing).
  "contract_id" uuid,
  "title" text NOT NULL,
  "title_ar" text,
  "currency_code" varchar(3) NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "valid_from" date NOT NULL,
  "valid_to" date NOT NULL,
  -- Commitment controls: the service tracks released_amount against the
  -- max (over-release is a typed rejection; this CHECK is the DB floor
  -- advanced transactionally in the same statement as the release).
  "min_commitment" numeric(19,4) NOT NULL DEFAULT 0,
  "max_commitment" numeric(19,4) NOT NULL,
  "released_amount" numeric(19,4) NOT NULL DEFAULT 0,
  -- Price-locked lines: [{ itemId, unitPrice, note? }] — the release
  -- resolves prices from here (lock honored; the release jsonb carries
  -- the effective price verbatim).
  "price_lock" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "closed_at" timestamptz,
  "closed_by" uuid,
  "cancel_reason" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_blanket_orders PRIMARY KEY ("id"),
  CONSTRAINT uq_blanket_orders_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_blanket_orders_tenant_no UNIQUE ("tenant_id", "blanket_no"),
  CONSTRAINT ck_blanket_orders_title_length CHECK (length("title") BETWEEN 1 AND 200),
  CONSTRAINT ck_blanket_orders_currency_shape CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_blanket_orders_status CHECK ("status" IN ('ACTIVE', 'EXPIRED', 'CLOSED', 'CANCELLED')),
  CONSTRAINT ck_blanket_orders_validity CHECK ("valid_from" <= "valid_to"),
  CONSTRAINT ck_blanket_orders_commitments CHECK ("min_commitment" >= 0 AND "max_commitment" >= 0),
  CONSTRAINT ck_blanket_orders_released_shape CHECK (
    "released_amount" >= 0 AND "released_amount" <= "max_commitment"),
  CONSTRAINT ck_blanket_orders_price_lock_shape CHECK (jsonb_typeof("price_lock") = 'array'),
  CONSTRAINT ck_blanket_orders_active_stamps CHECK (
    ("status" IN ('ACTIVE', 'EXPIRED')) OR ("closed_at" IS NOT NULL AND "status" IN ('CLOSED', 'CANCELLED')))
);

--> statement-breakpoint
-- The OA-06 hot path: blanket management opens on the live agreements.
CREATE INDEX IF NOT EXISTS ix_blanket_orders_tenant_status
  ON "blanket_orders" ("tenant_id", "status", "valid_to");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_blanket_orders_tenant_supplier
  ON "blanket_orders" ("tenant_id", "supplier_id");

--> statement-breakpoint
COMMENT ON TABLE "blanket_orders" IS
  'PHASE-038 T-01/T-05: the standing supplier agreement — validity window, min/max commitment, price-locked lines, and the transactional released_amount accumulator (P-03); contract_id links P-06 contract purchasing.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. blanket_releases (T-01/T-05): the append-only release ledger.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blanket_releases" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid,
  "blanket_id" uuid NOT NULL,
  "release_no" text NOT NULL,
  "release_date" date NOT NULL,
  -- [{ itemId, qty, unitPrice }] — the effective release (prices resolved
  -- from the blanket price lock or explicit per-line quotes).
  "lines" jsonb NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  -- The generated executable document (the purchase order GRN/AP flow
  -- against) — created in the same transaction as the release.
  "purchase_order_id" uuid NOT NULL,
  "note" text,
  CONSTRAINT pk_blanket_releases PRIMARY KEY ("id"),
  CONSTRAINT uq_blanket_releases_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_blanket_releases_tenant_no UNIQUE ("tenant_id", "release_no"),
  CONSTRAINT ck_blanket_releases_lines_shape CHECK (jsonb_typeof("lines") = 'array'),
  CONSTRAINT ck_blanket_releases_amount_positive CHECK ("amount" > 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_blanket_releases_tenant_blanket
  ON "blanket_releases" ("tenant_id", "blanket_id", "release_date");

--> statement-breakpoint
COMMENT ON TABLE "blanket_releases" IS
  'PHASE-038 T-01/T-05: the append-only release ledger — each release decrements the blanket''s remaining commitment and carries the generated purchase order (the executable document); NO DELETE.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. Composite tenant FKs.
--> statement-breakpoint
ALTER TABLE "purchase_orders"
  DROP CONSTRAINT IF EXISTS fk_purchase_orders_contract;
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT fk_purchase_orders_contract FOREIGN KEY ("contract_id", "tenant_id")
    REFERENCES "service_contracts" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "blanket_orders"
  DROP CONSTRAINT IF EXISTS fk_blanket_orders_branch;
ALTER TABLE "blanket_orders"
  ADD CONSTRAINT fk_blanket_orders_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "blanket_orders"
  DROP CONSTRAINT IF EXISTS fk_blanket_orders_supplier;
ALTER TABLE "blanket_orders"
  ADD CONSTRAINT fk_blanket_orders_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "blanket_orders"
  DROP CONSTRAINT IF EXISTS fk_blanket_orders_contract;
ALTER TABLE "blanket_orders"
  ADD CONSTRAINT fk_blanket_orders_contract FOREIGN KEY ("contract_id", "tenant_id")
    REFERENCES "service_contracts" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "blanket_releases"
  DROP CONSTRAINT IF EXISTS fk_blanket_releases_blanket;
ALTER TABLE "blanket_releases"
  ADD CONSTRAINT fk_blanket_releases_blanket FOREIGN KEY ("blanket_id", "tenant_id")
    REFERENCES "blanket_orders" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "blanket_releases"
  DROP CONSTRAINT IF EXISTS fk_blanket_releases_purchase_order;
ALTER TABLE "blanket_releases"
  ADD CONSTRAINT fk_blanket_releases_purchase_order FOREIGN KEY ("purchase_order_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. RLS (TENANT_ISOLATION §2): the house macro.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"blanket_orders"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"blanket_releases"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5b. Purge path (the house discipline).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['blanket_orders', 'blanket_releases'] LOOP
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
-- 6. Grants: both tables SELECT/INSERT/UPDATE — NO DELETE (the release
-- ledger is append-only; blanket agreements close/cancel by status).
--> statement-breakpoint
REVOKE ALL ON "blanket_orders", "blanket_releases" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "blanket_orders", "blanket_releases" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "blanket_orders", "blanket_releases" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "blanket_orders", "blanket_releases" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Permission/feature plan grants: NONE — the blanket surfaces ride the
-- 0051 sourcing keys (purchasing.rfqs.read/manage) and the
-- purchasing.blanket_orders feature grant (0051 §10). Zero new keys here.
-- ---------------------------------------------------------------------------

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 52)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
