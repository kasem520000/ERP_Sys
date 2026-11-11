-- PHASE-039 (Blueprint v3.0 · CR-09; scope extended by v3.1/CR-46 and
-- v3.2/CR-50) · migration 0055 · Returns & Collections I — the customer
-- RMA workflow + managed warranties (H-12/S-14 · S-15)
--
-- Purpose (PHASE-039 §4 Design Impact): the operational returns layer the
-- audit found missing ("a return is a credit note with no operational
-- process"):
--
--   return_authorizations — the customer RMA header: REQUESTED → APPROVED
--     (SoD creator ≠ approver) → RECEIVED → INSPECTED → RESTOCKED /
--     SCRAPPED / REFUNDED (CANCELLED off the way). rma_no reserved at
--     APPROVAL (the PR/CAPEX discipline — drafts are scratch). The
--     terminal completion auto-generates the credit note through the
--     posting engine — exactly once, atomically with the disposition leg
--     (BR-064; the INV-013 source keys return_authorization:
--     restock|scrap|refund). Goldens G-35 (restock — the CN reentry leg
--     re-shelves at ORIGINAL COST, the W-3 discipline), G-36 (scrap
--     write-off: DR the tenant-mapped scrap-loss account · CR COGS at
--     the original cost — the goods never re-shelve), G-37 (refund: the
--     CN + the cash-out leg DR AR_CONTROL · CR CASH, cash_movements
--     source 'return_authorization').
--   return_authorization_lines — the return lines: invoice_line_id
--     (composite FK) + qty bounded by invoiced − credited − open-RMA
--     (the service folds all three; a typed rejection above it).
--     Replace-on-edit (DRAFT only) → DELETE granted, the rfq_lines
--     precedent.
--   warranty_registrations — managed warranties with STRUCTURED terms
--     (S-15): typed jsonb { durationMonths, coverage, basis,
--     mileageLimitKm? } replacing the free-text blob; start/end dates
--     computed from the basis (INVOICE_DATE); the daily expiry sweep
--     emits 30/7/0-day notifications (category 'warranties' — widened
--     in 0056 §7).
--
-- INV-022 ledger: +3 tables here (of the phase's +10 — 0055: 3 · 0056:
-- 3 · 0058: 2 · 0059: 2), +3 journals (G-35/G-36/G-37 — JOURNAL_RULES;
-- numbering continues from G-34 shipped with PHASE-038), permissions and
-- feature keys seeded in 0056 §9/§10 (all nine keys, one block).
--
-- Grants: headers SELECT/INSERT/UPDATE — NO DELETE (workflow history);
-- return_authorization_lines adds DELETE (replace-on-edit, DRAFT only).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. return_authorizations (T-02/T-03/T-04): the customer RMA header.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "return_authorizations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  -- Official number reserved at APPROVAL (drafts are scratch).
  "rma_no" text,
  "partner_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "reason_code" text NOT NULL,
  "reason" text,
  "reason_ar" text,
  "status" text NOT NULL DEFAULT 'REQUESTED',
  "disposition" text,
  "currency_code" varchar(3) NOT NULL,
  "total_net" numeric(19,4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19,4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19,4) NOT NULL DEFAULT 0,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "approved_at" timestamptz,
  "approved_by" uuid,
  "received_at" timestamptz,
  "received_by" uuid,
  "inspected_at" timestamptz,
  "inspected_by" uuid,
  "inspection_note" text,
  "completed_at" timestamptz,
  "completed_by" uuid,
  "credit_note_id" uuid,
  "posted_journal_id" uuid,
  "entry_no" text,
  "refund_cash_account_id" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT "pk_return_authorizations" PRIMARY KEY ("id"),
  CONSTRAINT "uq_return_authorizations_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_return_authorizations_tenant_no" UNIQUE ("tenant_id", "rma_no"),
  CONSTRAINT "ck_return_authorizations_status" CHECK (
    "status" IN ('REQUESTED','APPROVED','RECEIVED','INSPECTED',
                 'RESTOCKED','SCRAPPED','REFUNDED','CANCELLED')
  ),
  CONSTRAINT "ck_return_authorizations_reason_code" CHECK (
    "reason_code" IN ('DAMAGED','DEFECTIVE','WRONG_ITEM','LATE_DELIVERY',
                      'CUSTOMER_REMORSE','OTHER')
  ),
  CONSTRAINT "ck_return_authorizations_disposition" CHECK (
    "disposition" IN ('RESTOCK','SCRAP','REFUND')
  ),
  -- Lifecycle stamps (the supplier_advances 0053 discipline): a status
  -- implies its evidence columns; the terminal states imply the posted
  -- credit note + journal (BR-064's exactly-once completion shape).
  CONSTRAINT "ck_return_authorizations_lifecycle_stamps" CHECK (
    ("status" = 'REQUESTED')
    OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL
        AND "credit_note_id" IS NULL AND "posted_journal_id" IS NULL)
    OR ("status" IN ('APPROVED','RECEIVED','INSPECTED','RESTOCKED','SCRAPPED','REFUNDED')
        AND "approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
    OR ("status" IN ('RECEIVED','INSPECTED','RESTOCKED','SCRAPPED','REFUNDED')
        AND "received_at" IS NOT NULL)
    OR ("status" IN ('INSPECTED','RESTOCKED','SCRAPPED','REFUNDED')
        AND "inspected_at" IS NOT NULL AND "inspected_by" IS NOT NULL)
    OR ("status" IN ('RESTOCKED','SCRAPPED','REFUNDED')
        AND "completed_at" IS NOT NULL AND "completed_by" IS NOT NULL
        AND "disposition" IS NOT NULL
        AND "credit_note_id" IS NOT NULL AND "posted_journal_id" IS NOT NULL)
  ),
  -- The disposition is only chosen at/after inspection (BR-064).
  CONSTRAINT "ck_return_authorizations_disposition_gate" CHECK (
    "disposition" IS NULL OR "status" IN ('INSPECTED','RESTOCKED','SCRAPPED','REFUNDED')
  ),
  -- A refund needs the cash account it pays out from.
  CONSTRAINT "ck_return_authorizations_refund_cash" CHECK (
    "status" <> 'REFUNDED' OR "refund_cash_account_id" IS NOT NULL
  ),
  CONSTRAINT "ck_return_authorizations_amounts" CHECK (
    "total_net" >= 0 AND "total_tax" >= 0 AND "total_gross" >= 0
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_return_authorizations_tenant_status"
  ON "return_authorizations" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_return_authorizations_tenant_partner"
  ON "return_authorizations" ("tenant_id", "partner_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_return_authorizations_tenant_invoice"
  ON "return_authorizations" ("tenant_id", "invoice_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. return_authorization_lines (T-02): replace-on-edit (DRAFT only).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "return_authorization_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "rma_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "invoice_line_id" uuid NOT NULL,
  "item_id" uuid,
  "qty" numeric(19,6) NOT NULL,
  -- Snapshot at request time (the invoice line's own values — evidence).
  "unit_price" numeric(19,4) NOT NULL DEFAULT 0,
  "discount_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "tax_code_id" uuid,
  "net_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "tax_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "note" text,
  CONSTRAINT "pk_return_authorization_lines" PRIMARY KEY ("id"),
  CONSTRAINT "uq_return_authorization_lines_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_return_authorization_lines_rma_line" UNIQUE ("rma_id", "tenant_id", "line_no"),
  CONSTRAINT "ck_return_authorization_lines_qty" CHECK ("qty" > 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_return_authorization_lines_tenant_rma"
  ON "return_authorization_lines" ("tenant_id", "rma_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_return_authorization_lines_tenant_invoice_line"
  ON "return_authorization_lines" ("tenant_id", "invoice_line_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. warranty_registrations (T-05): structured warranty terms (S-15).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warranty_registrations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "partner_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "serial_no" text,
  "invoice_id" uuid,
  "job_card_id" uuid,
  -- The structured terms (S-15): { durationMonths: int>0, coverage:
  -- REPAIR|REPLACE|REFUND|LABOR_ONLY|PARTS_ONLY, basis:
  -- INVOICE_DATE|DELIVERY_DATE, mileageLimitKm?: int>0 } — service-validated
  -- shape; the CHECK pins the json type only.
  "terms" jsonb NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "last_notified_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT "pk_warranty_registrations" PRIMARY KEY ("id"),
  CONSTRAINT "uq_warranty_registrations_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_warranty_registrations_status" CHECK ("status" IN ('ACTIVE','EXPIRED','VOID')),
  CONSTRAINT "ck_warranty_registrations_terms_shape" CHECK (jsonb_typeof("terms") = 'object'),
  CONSTRAINT "ck_warranty_registrations_dates" CHECK ("end_date" >= "start_date")
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warranty_registrations_tenant_status"
  ON "warranty_registrations" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warranty_registrations_tenant_partner"
  ON "warranty_registrations" ("tenant_id", "partner_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warranty_registrations_tenant_expiry"
  ON "warranty_registrations" ("tenant_id", "status", "end_date");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. Composite tenant FKs (the 0051/0053 discipline).
--> statement-breakpoint
ALTER TABLE "return_authorizations" DROP CONSTRAINT IF EXISTS fk_return_authorizations_branch;
--> statement-breakpoint
ALTER TABLE "return_authorizations"
  ADD CONSTRAINT fk_return_authorizations_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "return_authorizations" DROP CONSTRAINT IF EXISTS fk_return_authorizations_partner;
--> statement-breakpoint
ALTER TABLE "return_authorizations"
  ADD CONSTRAINT fk_return_authorizations_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "return_authorizations" DROP CONSTRAINT IF EXISTS fk_return_authorizations_invoice;
--> statement-breakpoint
ALTER TABLE "return_authorizations"
  ADD CONSTRAINT fk_return_authorizations_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "return_authorizations" DROP CONSTRAINT IF EXISTS fk_return_authorizations_credit_note;
--> statement-breakpoint
ALTER TABLE "return_authorizations"
  ADD CONSTRAINT fk_return_authorizations_credit_note FOREIGN KEY ("credit_note_id", "tenant_id")
    REFERENCES "credit_notes" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "return_authorizations" DROP CONSTRAINT IF EXISTS fk_return_authorizations_refund_cash;
--> statement-breakpoint
ALTER TABLE "return_authorizations"
  ADD CONSTRAINT fk_return_authorizations_refund_cash FOREIGN KEY ("refund_cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "return_authorization_lines" DROP CONSTRAINT IF EXISTS fk_return_authorization_lines_rma;
--> statement-breakpoint
ALTER TABLE "return_authorization_lines"
  ADD CONSTRAINT fk_return_authorization_lines_rma FOREIGN KEY ("rma_id", "tenant_id")
    REFERENCES "return_authorizations" ("id", "tenant_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "return_authorization_lines" DROP CONSTRAINT IF EXISTS fk_return_authorization_lines_invoice_line;
--> statement-breakpoint
ALTER TABLE "return_authorization_lines"
  ADD CONSTRAINT fk_return_authorization_lines_invoice_line FOREIGN KEY ("invoice_line_id", "tenant_id")
    REFERENCES "sales_invoice_lines" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "return_authorization_lines" DROP CONSTRAINT IF EXISTS fk_return_authorization_lines_item;
--> statement-breakpoint
ALTER TABLE "return_authorization_lines"
  ADD CONSTRAINT fk_return_authorization_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "warranty_registrations" DROP CONSTRAINT IF EXISTS fk_warranty_registrations_partner;
--> statement-breakpoint
ALTER TABLE "warranty_registrations"
  ADD CONSTRAINT fk_warranty_registrations_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "warranty_registrations" DROP CONSTRAINT IF EXISTS fk_warranty_registrations_item;
--> statement-breakpoint
ALTER TABLE "warranty_registrations"
  ADD CONSTRAINT fk_warranty_registrations_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "warranty_registrations" DROP CONSTRAINT IF EXISTS fk_warranty_registrations_invoice;
--> statement-breakpoint
ALTER TABLE "warranty_registrations"
  ADD CONSTRAINT fk_warranty_registrations_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. RLS (every tenant table — A1–A10 attack suite extends via the
-- isolation registry).
--> statement-breakpoint
ALTER TABLE "return_authorizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "return_authorizations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"return_authorizations"');
--> statement-breakpoint
ALTER TABLE "return_authorization_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "return_authorization_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"return_authorization_lines"');
--> statement-breakpoint
ALTER TABLE "warranty_registrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warranty_registrations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"warranty_registrations"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. Purge path (the house discipline).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['return_authorizations', 'return_authorization_lines', 'warranty_registrations'] LOOP
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
-- 7. Grants: headers SELECT/INSERT/UPDATE — NO DELETE (workflow history);
-- the lines table adds DELETE (replace-on-edit, DRAFT only — the
-- rfq_lines precedent).
--> statement-breakpoint
REVOKE ALL ON "return_authorizations", "warranty_registrations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "return_authorizations", "warranty_registrations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "return_authorizations", "warranty_registrations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "return_authorizations", "warranty_registrations" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "return_authorization_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "return_authorization_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "return_authorization_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "return_authorization_lines" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. Bilingual table comments (the 0053 evidence discipline).
--> statement-breakpoint
COMMENT ON TABLE "return_authorizations" IS 'PHASE-039: customer RMA workflow — REQUESTED→APPROVED(SoD)→RECEIVED→INSPECTED→RESTOCKED/SCRAPPED/REFUNDED; completion auto-generates the credit note (G-35/36/37, BR-064) / سير عمل المرتجعات: الطلب→الموافقة→الاستلام→الفحص→إعادة التخزين أو الإتلاف أو الاسترداد، مع توليد إشعار الدائن تلقائياً عند الاكتمال';
--> statement-breakpoint
COMMENT ON TABLE "return_authorization_lines" IS 'PHASE-039: RMA lines — invoice-line referenced, qty bounded by invoiced − credited − open-RMA / سطور المرتجعات مربوطة بسطور الفاتورة مع سقف الكمية المفوترة';
--> statement-breakpoint
COMMENT ON TABLE "warranty_registrations" IS 'PHASE-039: managed warranties with structured terms (S-15) + the 30/7/0-day expiry sweep / الضمانات المُدارة بشروط مهيكلة مع تنبيهات الانتهاء';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 55)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
