-- PHASE-038 (Blueprint v3.0 · CR-08) · migration 0053 · Procurement
-- sourcing III — supplier collaboration (P-04 · P-12 · P-13)
--
-- Purpose (PHASE-038 §4 Design Impact): the supplier collaboration
-- cluster. Four tables:
--
--   supplier_ratings — the scorecard store: delivery/quality/price scores
--     over a rolling window computed from live documents (GRN punctuality,
--     debit-note quality drag, invoice price variance); ONE row per
--     supplier (recompute overwrites — the window moves). detail jsonb
--     carries the sample decomposition (evidence).
--   approved_supplier_items — the approved-vendor-per-item list (P-04,
--     the item-vendor mapping leg of P-09): gates vendor suggestions per
--     policy (purchasing.approved_vendor_list.mode OFF|FLAG|BLOCK).
--   supplier_advances — advance disbursement tracking: DRAFT → APPROVED
--     (SoD creator ≠ approver) → DISBURSED (G-33 posts: DR the
--     tenant-mapped ADVANCES control · CR CASH/BANK) → CLOSED (fully
--     applied; the apply leg DR AP_CONTROL · CR the same control, the
--     supplier's subledger nets). The control account is tenant-mapped by
--     setting (purchasing.supplier_advance_control_account) — fail-closed
--     when unmapped (the payroll G-29 loan-account precedent).
--   early_payment_discount_terms — per-supplier early-payment terms:
--     discount_pct + discount_days; the terms row must be APPROVED
--     (SoD) before a capture can post (G-34: DR AP_CONTROL · CR the
--     tenant-mapped discount-income account, within the window only).
--
-- INV-022 ledger: +4 tables (ENTITY_CATALOG 211 → 215), +2 journals
-- (G-33 supplier advance post + apply, G-34 early-payment discount
-- capture — JOURNAL_RULES §7; numbering continues from G-32), +0
-- permissions (rides the 0051 sourcing keys), +0 feature keys
-- (purchasing.supplier_scorecards granted in 0051 §10).
--
-- Grants: all four SELECT/INSERT/UPDATE — NO DELETE (ratings recompute
-- overwrites; advances/terms are workflow history; the approved list
-- suspends).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. supplier_ratings (T-01/T-06): the scorecard store.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_ratings" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "supplier_id" uuid NOT NULL,
  "window_start" date NOT NULL,
  "window_end" date NOT NULL,
  -- 0..100 scores (2dp); the overall is the documented weighted fold
  -- (delivery 40% · quality 40% · price 20% — the P-04 baseline).
  "delivery_score" numeric(5,2) NOT NULL,
  "quality_score" numeric(5,2) NOT NULL,
  "price_score" numeric(5,2) NOT NULL,
  "overall_score" numeric(5,2) NOT NULL,
  "sample_size" integer NOT NULL DEFAULT 0,
  -- The sample decomposition: { grns: n, onTime: n, invoices: n,
  -- debitNotes: n, priceVariancePct, notes: [...] } — the evidence.
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "computed_by" uuid,
  "computed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_supplier_ratings PRIMARY KEY ("id"),
  CONSTRAINT uq_supplier_ratings_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_supplier_ratings_tenant_supplier UNIQUE ("tenant_id", "supplier_id"),
  CONSTRAINT ck_supplier_ratings_window CHECK ("window_start" <= "window_end"),
  CONSTRAINT ck_supplier_ratings_scores CHECK (
    "delivery_score" BETWEEN 0 AND 100 AND "quality_score" BETWEEN 0 AND 100
    AND "price_score" BETWEEN 0 AND 100 AND "overall_score" BETWEEN 0 AND 100),
  CONSTRAINT ck_supplier_ratings_sample CHECK ("sample_size" >= 0),
  CONSTRAINT ck_supplier_ratings_detail_shape CHECK (jsonb_typeof("detail") = 'object')
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_ratings_tenant_window
  ON "supplier_ratings" ("tenant_id", "window_end");

--> statement-breakpoint
COMMENT ON TABLE "supplier_ratings" IS
  'PHASE-038 T-01/T-06: the supplier scorecard (P-04) — delivery/quality/price scores computed from live documents over the rolling window; one row per supplier, recompute overwrites.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. approved_supplier_items (T-01/T-06): the approved-vendor-per-item
-- list (the P-09 vendor-mapping leg).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approved_supplier_items" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "supplier_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'APPROVED',
  "approved_by" uuid,
  "approved_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" date,
  "note" text,
  CONSTRAINT pk_approved_supplier_items PRIMARY KEY ("id"),
  CONSTRAINT uq_approved_supplier_items_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_approved_supplier_items_tenant_supplier_item UNIQUE ("tenant_id", "supplier_id", "item_id"),
  CONSTRAINT ck_approved_supplier_items_status CHECK ("status" IN ('APPROVED', 'SUSPENDED'))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_approved_supplier_items_tenant_item
  ON "approved_supplier_items" ("tenant_id", "item_id", "status");

--> statement-breakpoint
COMMENT ON TABLE "approved_supplier_items" IS
  'PHASE-038 T-01/T-06: the approved-vendor-per-item list — gates vendor suggestions per the purchasing.approved_vendor_list.mode policy (OFF|FLAG|BLOCK); SUSPENDED vendors keep history but stop suggesting.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. supplier_advances (T-01/T-08): advance disbursement tracking (G-33).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_advances" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "supplier_id" uuid NOT NULL,
  -- Official number reserved at DISBURSE (the posting stamp — the payroll
  -- PR- pattern); NULL until then.
  "advance_no" text,
  "currency_code" varchar(3) NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  -- The applied portion (the apply leg nets the supplier's AP open
  -- items); never above the advance amount.
  "applied_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "approved_by" uuid,
  "approved_at" timestamptz,
  -- The disbursement leg (G-33): cash account + posting stamps.
  "cash_account_id" uuid,
  "entry_date" date,
  "posted_journal_id" uuid,
  "entry_no" text,
  "disbursed_at" timestamptz,
  "disbursed_by" uuid,
  "cancel_reason" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_supplier_advances PRIMARY KEY ("id"),
  CONSTRAINT uq_supplier_advances_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_supplier_advances_tenant_no UNIQUE ("tenant_id", "advance_no"),
  CONSTRAINT ck_supplier_advances_currency_shape CHECK ("currency_code" ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_supplier_advances_amount_positive CHECK ("amount" > 0),
  CONSTRAINT ck_supplier_advances_status CHECK (
    "status" IN ('DRAFT', 'APPROVED', 'DISBURSED', 'CLOSED', 'CANCELLED')),
  CONSTRAINT ck_supplier_advances_applied CHECK (
    "applied_amount" >= 0 AND "applied_amount" <= "amount"),
  CONSTRAINT ck_supplier_advances_lifecycle_stamps CHECK (
    ("status" = 'DRAFT' AND "approved_at" IS NULL AND "disbursed_at" IS NULL)
    OR ("status" = 'APPROVED' AND "approved_at" IS NOT NULL AND "disbursed_at" IS NULL)
    OR ("status" = 'DISBURSED' AND "approved_at" IS NOT NULL AND "disbursed_at" IS NOT NULL
        AND "posted_journal_id" IS NOT NULL)
    OR ("status" IN ('CLOSED', 'CANCELLED')))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_advances_tenant_supplier
  ON "supplier_advances" ("tenant_id", "supplier_id", "status");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_advances_tenant_status
  ON "supplier_advances" ("tenant_id", "status");

--> statement-breakpoint
COMMENT ON TABLE "supplier_advances" IS
  'PHASE-038 T-01/T-08: supplier advance disbursement tracking (P-12) — DRAFT→APPROVED (SoD)→DISBURSED (G-33: DR ADVANCES control · CR CASH/BANK)→CLOSED (fully applied; the apply leg nets the supplier subledger); the control account is tenant-mapped by setting, fail-closed when unmapped.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. early_payment_discount_terms (T-01/T-08): per-supplier early-payment
-- terms (G-34 capture rides these).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "early_payment_discount_terms" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "supplier_id" uuid NOT NULL,
  "discount_pct" numeric(5,2) NOT NULL,
  "discount_days" integer NOT NULL,
  "min_invoice_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  -- SoD: the terms must be approved by someone other than their creator
  -- before any capture can post (the acceptance-6 SoD leg for G-34).
  "approved_by" uuid,
  "approved_at" timestamptz,
  "note" text,
  CONSTRAINT pk_early_payment_discount_terms PRIMARY KEY ("id"),
  CONSTRAINT uq_early_payment_discount_terms_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_early_payment_discount_terms_tenant_supplier UNIQUE ("tenant_id", "supplier_id"),
  CONSTRAINT ck_early_payment_discount_terms_pct CHECK ("discount_pct" > 0 AND "discount_pct" <= 100),
  CONSTRAINT ck_early_payment_discount_terms_days CHECK ("discount_days" > 0),
  CONSTRAINT ck_early_payment_discount_terms_min CHECK ("min_invoice_amount" >= 0),
  CONSTRAINT ck_early_payment_discount_terms_status CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT ck_early_payment_discount_terms_approval CHECK (
    "approved_by" IS NULL OR "approved_at" IS NOT NULL)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_early_payment_discount_terms_tenant_supplier
  ON "early_payment_discount_terms" ("tenant_id", "supplier_id", "status");

--> statement-breakpoint
COMMENT ON TABLE "early_payment_discount_terms" IS
  'PHASE-038 T-01/T-08: per-supplier early-payment discount terms (P-13) — discount_pct within discount_days; capture posts G-34 (DR AP_CONTROL · CR the tenant-mapped discount-income account) only while the terms are ACTIVE + approved (SoD) and the payment lands inside the window.';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Composite tenant FKs.
--> statement-breakpoint
ALTER TABLE "supplier_ratings"
  DROP CONSTRAINT IF EXISTS fk_supplier_ratings_supplier;
ALTER TABLE "supplier_ratings"
  ADD CONSTRAINT fk_supplier_ratings_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "approved_supplier_items"
  DROP CONSTRAINT IF EXISTS fk_approved_supplier_items_supplier;
ALTER TABLE "approved_supplier_items"
  ADD CONSTRAINT fk_approved_supplier_items_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "approved_supplier_items"
  DROP CONSTRAINT IF EXISTS fk_approved_supplier_items_item;
ALTER TABLE "approved_supplier_items"
  ADD CONSTRAINT fk_approved_supplier_items_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "supplier_advances"
  DROP CONSTRAINT IF EXISTS fk_supplier_advances_supplier;
ALTER TABLE "supplier_advances"
  ADD CONSTRAINT fk_supplier_advances_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "supplier_advances"
  DROP CONSTRAINT IF EXISTS fk_supplier_advances_cash_account;
ALTER TABLE "supplier_advances"
  ADD CONSTRAINT fk_supplier_advances_cash_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "early_payment_discount_terms"
  DROP CONSTRAINT IF EXISTS fk_early_payment_discount_terms_supplier;
ALTER TABLE "early_payment_discount_terms"
  ADD CONSTRAINT fk_early_payment_discount_terms_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS (TENANT_ISOLATION §2): the house macro on the four tables.
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"supplier_ratings"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"approved_supplier_items"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"supplier_advances"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"early_payment_discount_terms"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6b. Purge path (the house discipline).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_ratings', 'approved_supplier_items', 'supplier_advances', 'early_payment_discount_terms'] LOOP
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
-- 7. Grants: all four SELECT/INSERT/UPDATE — NO DELETE.
--> statement-breakpoint
REVOKE ALL ON "supplier_ratings", "approved_supplier_items", "supplier_advances", "early_payment_discount_terms" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "supplier_ratings", "approved_supplier_items", "supplier_advances", "early_payment_discount_terms" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "supplier_ratings", "approved_supplier_items", "supplier_advances", "early_payment_discount_terms" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "supplier_ratings", "approved_supplier_items", "supplier_advances", "early_payment_discount_terms" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. Permission/feature plan grants: NONE — the collaboration surfaces
-- ride the 0051 sourcing keys (purchasing.rfqs.read/manage +
-- purchasing.suppliers.rate) and the purchasing.supplier_scorecards
-- feature grant (0051 §10). Zero new keys here.
-- ---------------------------------------------------------------------------

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 53)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
