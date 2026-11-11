-- PHASE-039 (Blueprint v3.0 · CR-09; scope extended by v3.2/CR-50 ·
-- R-03) · migration 0059 · Returns & Collections V — the supplier RMA
-- mirror (return-to-vendor)
--
-- Purpose (PHASE-039 §2.13, the v3.2/R-03 addition decided BEFORE any
-- 039 code was written): the purchasing counterpart of the customer
-- RMA — a return authorization TO the supplier whose completion
-- auto-generates the AP DEBIT NOTE through the posting engine:
--
--   supplier_return_authorizations — REQUESTED → APPROVED (SoD creator
--     ≠ approver) → SHIPPED (the goods leave: the inventory issue leg
--     posts through the movement engine — no-negative-stock applies)
--     → CREDITED (the debit note posts: G-38 DR AP_CONTROL (partner)
--     · CR INVENTORY at the receipt cost — plus the DN document
--     itself through the existing debit-notes machinery; a cost/value
--     difference would CR the tenant-mapped purchase-returns account,
--     fail-closed when unmapped). srma_no reserved at APPROVAL.
--   supplier_return_authorization_lines — PO-line referenced; qty
--     bounded by the purchased quantity − already-returned (the
--     service fold; typed rejection above it). Replace-on-edit
--     (DRAFT only) → DELETE granted.
--
-- INV-022 ledger: +2 tables (completing the phase's +10), +1 journal
-- (G-38 — JOURNAL_RULES; numbering continues from G-37), +0
-- permissions (rides the 0056 keys: purchasing.rma.read/manage), +0
-- feature keys (rides purchasing.rma granted in 0056 §10).
--
-- Grants: header SELECT/INSERT/UPDATE — NO DELETE; lines add DELETE
-- (replace-on-edit, DRAFT only).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. supplier_return_authorizations (T-13, R-03): the RTV header.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_return_authorizations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "srma_no" text,
  "supplier_id" uuid NOT NULL,
  "purchase_order_id" uuid NOT NULL,
  "reason_code" text NOT NULL,
  "reason" text,
  "reason_ar" text,
  "status" text NOT NULL DEFAULT 'REQUESTED',
  "currency_code" varchar(3) NOT NULL,
  "total_net" numeric(19,4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19,4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19,4) NOT NULL DEFAULT 0,
  "requested_at" timestamptz NOT NULL DEFAULT now(),
  "approved_at" timestamptz,
  "approved_by" uuid,
  "shipped_at" timestamptz,
  "shipped_by" uuid,
  "credited_at" timestamptz,
  "credited_by" uuid,
  "debit_note_id" uuid,
  "posted_journal_id" uuid,
  "entry_no" text,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT "pk_supplier_return_authorizations" PRIMARY KEY ("id"),
  CONSTRAINT "uq_supplier_return_authorizations_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_supplier_return_authorizations_tenant_no" UNIQUE ("tenant_id", "srma_no"),
  CONSTRAINT "ck_supplier_return_authorizations_status" CHECK (
    "status" IN ('REQUESTED','APPROVED','SHIPPED','CREDITED','CANCELLED')
  ),
  CONSTRAINT "ck_supplier_return_authorizations_reason_code" CHECK (
    "reason_code" IN ('DAMAGED','DEFECTIVE','WRONG_ITEM','OVER_SHIPMENT',
                      'EXPIRED','RECALL','OTHER')
  ),
  -- Lifecycle stamps (the 0053 discipline): approval implies SoD
  -- stamps; SHIPPED implies the ship stamps; CREDITED implies the
  -- debit note + journal (the exactly-once completion shape, BR-064
  -- applied to the purchasing side).
  CONSTRAINT "ck_supplier_return_authorizations_lifecycle_stamps" CHECK (
    ("status" = 'REQUESTED')
    OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL
        AND "debit_note_id" IS NULL AND "posted_journal_id" IS NULL)
    OR ("status" IN ('APPROVED','SHIPPED','CREDITED')
        AND "approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
    OR ("status" IN ('SHIPPED','CREDITED') AND "shipped_at" IS NOT NULL AND "shipped_by" IS NOT NULL)
    OR ("status" = 'CREDITED' AND "credited_at" IS NOT NULL AND "credited_by" IS NOT NULL
        AND "debit_note_id" IS NOT NULL AND "posted_journal_id" IS NOT NULL)
  ),
  CONSTRAINT "ck_supplier_return_authorizations_amounts" CHECK (
    "total_net" >= 0 AND "total_tax" >= 0 AND "total_gross" >= 0
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_supplier_return_authorizations_tenant_status"
  ON "supplier_return_authorizations" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_supplier_return_authorizations_tenant_supplier"
  ON "supplier_return_authorizations" ("tenant_id", "supplier_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_supplier_return_authorizations_tenant_po"
  ON "supplier_return_authorizations" ("tenant_id", "purchase_order_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. supplier_return_authorization_lines (T-13): replace-on-edit.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_return_authorization_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "srma_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "po_line_id" uuid NOT NULL,
  "item_id" uuid,
  "qty" numeric(19,6) NOT NULL,
  -- Snapshot at request time (the PO line's own values — evidence).
  "unit_cost" numeric(19,4) NOT NULL DEFAULT 0,
  "net_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "note" text,
  CONSTRAINT "pk_supplier_return_authorization_lines" PRIMARY KEY ("id"),
  CONSTRAINT "uq_supplier_return_authorization_lines_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_supplier_return_authorization_lines_srma_line" UNIQUE ("srma_id", "tenant_id", "line_no"),
  CONSTRAINT "ck_supplier_return_authorization_lines_qty" CHECK ("qty" > 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_supplier_return_authorization_lines_tenant_srma"
  ON "supplier_return_authorization_lines" ("tenant_id", "srma_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_supplier_return_authorization_lines_tenant_po_line"
  ON "supplier_return_authorization_lines" ("tenant_id", "po_line_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. Composite tenant FKs.
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations" DROP CONSTRAINT IF EXISTS fk_supplier_return_authorizations_branch;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations"
  ADD CONSTRAINT fk_supplier_return_authorizations_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations" DROP CONSTRAINT IF EXISTS fk_supplier_return_authorizations_supplier;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations"
  ADD CONSTRAINT fk_supplier_return_authorizations_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations" DROP CONSTRAINT IF EXISTS fk_supplier_return_authorizations_po;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations"
  ADD CONSTRAINT fk_supplier_return_authorizations_po FOREIGN KEY ("purchase_order_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations" DROP CONSTRAINT IF EXISTS fk_supplier_return_authorizations_debit_note;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations"
  ADD CONSTRAINT fk_supplier_return_authorizations_debit_note FOREIGN KEY ("debit_note_id", "tenant_id")
    REFERENCES "debit_notes" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorization_lines" DROP CONSTRAINT IF EXISTS fk_supplier_return_authorization_lines_srma;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorization_lines"
  ADD CONSTRAINT fk_supplier_return_authorization_lines_srma FOREIGN KEY ("srma_id", "tenant_id")
    REFERENCES "supplier_return_authorizations" ("id", "tenant_id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorization_lines" DROP CONSTRAINT IF EXISTS fk_supplier_return_authorization_lines_po_line;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorization_lines"
  ADD CONSTRAINT fk_supplier_return_authorization_lines_po_line FOREIGN KEY ("po_line_id", "tenant_id")
    REFERENCES "purchase_order_lines" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorization_lines" DROP CONSTRAINT IF EXISTS fk_supplier_return_authorization_lines_item;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorization_lines"
  ADD CONSTRAINT fk_supplier_return_authorization_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS.
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorizations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"supplier_return_authorizations"');
--> statement-breakpoint
ALTER TABLE "supplier_return_authorization_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "supplier_return_authorization_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"supplier_return_authorization_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Purge path (the house discipline).
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_return_authorizations', 'supplier_return_authorization_lines'] LOOP
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
-- 6. Grants: header SELECT/INSERT/UPDATE — NO DELETE; lines add DELETE.
--> statement-breakpoint
REVOKE ALL ON "supplier_return_authorizations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "supplier_return_authorizations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "supplier_return_authorizations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "supplier_return_authorizations" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "supplier_return_authorization_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_return_authorization_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "supplier_return_authorization_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "supplier_return_authorization_lines" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Bilingual table comments.
--> statement-breakpoint
COMMENT ON TABLE "supplier_return_authorizations" IS 'PHASE-039 (R-03, v3.2): the supplier RMA mirror — REQUESTED→APPROVED(SoD)→SHIPPED→CREDITED; completion auto-generates the AP debit note (G-38) / مرتجعات الموردين: الطلب→الموافقة→الشحن→إشعار المدين تلقائياً';
--> statement-breakpoint
COMMENT ON TABLE "supplier_return_authorization_lines" IS 'PHASE-039 (R-03): supplier-RMA lines — PO-line referenced, qty bounded by purchased − returned / سطور مرتجعات الموردين بسقف الكمية المشتراة';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 59)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
