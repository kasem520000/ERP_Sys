-- PHASE-011 · migration 0016 · purchasing core cluster
--
-- Purpose (PHASE-011 §2, §4; ENTITY_CATALOG §purchasing; TABLES/trade-purchasing.md):
-- - purchase_requests + lines: internal requisitions with approval routing
--   (DRAFT → PENDING_APPROVAL → APPROVED/REJECTED → CONVERTED → CANCELLED).
-- - purchase_orders + lines: supplier orders DRAFT → PENDING_APPROVAL →
--   APPROVED → ISSUED → CLOSED / CANCELLED with amendments as linked
--   revisions (revision_of_id), BR-010 approval thresholds consumed from
--   the PHASE-007 approval_policies substrate, and BR-029 numbering.
-- - goods_receipts + lines: GRN documents; POSTED receives stock through
--   the PHASE-010 inventory services (planReceipt/applyReceipt inside the
--   posting transaction — MODULE_BOUNDARIES: purchasing never writes
--   stock_moves itself) and posts the GRNI accrual (golden G-07). PO-less
--   receipts carry po_less_reason (BR-012 explicit permission + reason).
-- - supplier_invoices + lines: AP invoices with the supplier's own
--   invoice_no (BR-011 duplicate semantics enforced at service level),
--   match_result jsonb (per-line three-way-match outcomes + dispositions
--   recorded BEFORE approval — BR-009), tax stamps per line (BR-033
--   snapshots), and the G-08 posting (GRNI clear + AP open).
-- - debit_notes + lines: AP corrections mirroring supplier invoices
--   (golden G-09), referencing the original invoice (INV-003 — corrections
--   are always new documents).
-- - landed_costs + allocations: the PHASE-011 BASELINE (allocation math +
--   remaining-qty constraint only; the full workflow UI + entitlement
--   activation are PHASE-015 — FEATURE_CATALOG).
--
-- Grant posture: SELECT/INSERT/UPDATE for erp_app on every table (draft
-- lifecycle states); posted rows are immutable by service discipline +
-- shape CHECKs (status ↔ posted_* columns), mirroring the treasury pattern.
-- No append-only guard is needed here: the immutable ledgers (journal,
-- stock_moves, partner_subledger_entries) are owned by their modules.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Purchase requests (PHASE-011 §2.1): internal requisitions. request_no is
-- assigned at approval (BR-029 assign_at policy, default posting is for
-- ledger documents; PRs are not ledger docs — reserve at approval).
CREATE TABLE IF NOT EXISTS "purchase_requests" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "request_no" text,
  "needed_by" date,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "note" text,
  "note_ar" text,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "rejected_at" timestamptz,
  "rejected_by" uuid,
  "rejection_reason" text,
  "converted_order_id" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_purchase_requests PRIMARY KEY ("id"),
  CONSTRAINT uq_purchase_requests_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_purchase_requests_tenant_no UNIQUE ("tenant_id", "request_no"),
  CONSTRAINT fk_purchase_requests_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_purchase_requests_status_values CHECK ("status" IN (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CONVERTED', 'CANCELLED'
  )),
  CONSTRAINT ck_purchase_requests_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500),
  CONSTRAINT ck_purchase_requests_note_ar_length CHECK ("note_ar" IS NULL OR length("note_ar") BETWEEN 1 AND 500),
  CONSTRAINT ck_purchase_requests_rejection_shape CHECK (
    ("status" = 'REJECTED') = ("rejected_at" IS NOT NULL AND "rejected_by" IS NOT NULL)
  ),
  CONSTRAINT ck_purchase_requests_cancel_shape CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_requests_tenant_status
  ON "purchase_requests" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_requests_tenant_branch
  ON "purchase_requests" ("tenant_id", "branch_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_request_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "request_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "note" text,
  CONSTRAINT pk_purchase_request_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_purchase_request_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_purchase_request_lines_req_line UNIQUE ("tenant_id", "request_id", "line_no"),
  CONSTRAINT fk_purchase_request_lines_request FOREIGN KEY ("request_id", "tenant_id")
    REFERENCES "purchase_requests" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_purchase_request_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_purchase_request_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_purchase_request_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_request_lines_tenant_item
  ON "purchase_request_lines" ("tenant_id", "item_id");

--> statement-breakpoint
-- Purchase orders (PHASE-011 §2.1; DOCUMENT_LIFECYCLE §3): DRAFT →
-- PENDING_APPROVAL (BR-010 threshold routing) → APPROVED → ISSUED → CLOSED;
-- amendments are NEW revisions linked via revision_of_id (INV-003 — never
-- edits); order_no assigned at ISSUED (posting-analogous official number).
CREATE TABLE IF NOT EXISTS "purchase_orders" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "order_no" text,
  "order_date" date NOT NULL,
  "expected_date" date,
  "currency_code" varchar(3) NOT NULL,
  "exchange_rate" numeric(19, 8),
  "revision_of_id" uuid,
  "revision_no" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_net" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_summary" jsonb,
  "note" text,
  "note_ar" text,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "rejected_at" timestamptz,
  "rejected_by" uuid,
  "rejection_reason" text,
  "issued_at" timestamptz,
  "issued_by" uuid,
  "closed_at" timestamptz,
  "closed_by" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_purchase_orders PRIMARY KEY ("id"),
  CONSTRAINT uq_purchase_orders_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_purchase_orders_tenant_no UNIQUE ("tenant_id", "order_no"),
  CONSTRAINT fk_purchase_orders_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_orders_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_orders_revision_of FOREIGN KEY ("revision_of_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_purchase_orders_status_values CHECK ("status" IN (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CLOSED', 'CANCELLED'
  )),
  CONSTRAINT ck_purchase_orders_revision_shape CHECK ("revision_no" >= 1),
  CONSTRAINT ck_purchase_orders_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500),
  CONSTRAINT ck_purchase_orders_note_ar_length CHECK ("note_ar" IS NULL OR length("note_ar") BETWEEN 1 AND 500),
  CONSTRAINT ck_purchase_orders_issued_shape CHECK (
    ("status" IN ('ISSUED', 'CLOSED')) = ("order_no" IS NOT NULL AND "issued_at" IS NOT NULL AND "issued_by" IS NOT NULL)
  ),
  CONSTRAINT ck_purchase_orders_cancel_shape CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  CONSTRAINT ck_purchase_orders_totals CHECK (
    "total_gross" = "total_net" + "total_tax"
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_orders_tenant_status
  ON "purchase_orders" ("tenant_id", "status", "order_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_orders_tenant_supplier
  ON "purchase_orders" ("tenant_id", "supplier_id", "order_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_orders_tenant_branch
  ON "purchase_orders" ("tenant_id", "branch_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_orders_revision_chain
  ON "purchase_orders" ("tenant_id", "revision_of_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchase_order_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "order_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "unit_price" numeric(19, 6) NOT NULL DEFAULT 0,
  "tax_code_id" uuid,
  "net_amount" numeric(19, 4) NOT NULL,
  "tax_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "price_source" text NOT NULL DEFAULT 'MANUAL',
  "request_line_id" uuid,
  "note" text,
  CONSTRAINT pk_purchase_order_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_purchase_order_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_purchase_order_lines_order_line UNIQUE ("tenant_id", "order_id", "line_no"),
  CONSTRAINT fk_purchase_order_lines_order FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_purchase_order_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_order_lines_tax_code FOREIGN KEY ("tax_code_id", "tenant_id")
    REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_order_lines_request_line FOREIGN KEY ("request_line_id", "tenant_id")
    REFERENCES "purchase_request_lines" ("id", "tenant_id") ON DELETE SET NULL,
  CONSTRAINT ck_purchase_order_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_purchase_order_lines_price_nonneg CHECK ("unit_price" >= 0),
  CONSTRAINT ck_purchase_order_lines_net_nonneg CHECK ("net_amount" >= 0),
  CONSTRAINT ck_purchase_order_lines_tax_nonneg CHECK ("tax_amount" >= 0),
  CONSTRAINT ck_purchase_order_lines_price_source_values CHECK ("price_source" IN (
    'BASE_COST', 'PURCHASE_PRICE_LIST', 'MANUAL'
  )),
  CONSTRAINT ck_purchase_order_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_order_lines_tenant_item
  ON "purchase_order_lines" ("tenant_id", "item_id");

--> statement-breakpoint
-- The PR→PO conversion link (expand step — purchase_orders ships below).
ALTER TABLE "purchase_requests" ADD CONSTRAINT fk_purchase_requests_converted_order
  FOREIGN KEY ("converted_order_id", "tenant_id")
  REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- Goods receipts (PHASE-011 §2.2; golden G-07): POSTED receives stock via
-- the PHASE-010 movement core (batch capture at receipt for tracked items)
-- and posts DR INVENTORY/expense · CR GRNI. po_id NULL = PO-less "direct
-- purchase" (BR-012: explicit permission + reason; may be forbidden by the
-- purchasing.allow_po_less_grn policy).
CREATE TABLE IF NOT EXISTS "goods_receipts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "po_id" uuid,
  "warehouse_id" uuid NOT NULL,
  "receipt_no" text,
  "receipt_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "po_less_reason" text,
  "total_value" numeric(19, 4) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  "posting_date" date,
  "posted_by" uuid,
  "posted_at" timestamptz,
  "posted_journal_id" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_goods_receipts PRIMARY KEY ("id"),
  CONSTRAINT uq_goods_receipts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_goods_receipts_tenant_no UNIQUE ("tenant_id", "receipt_no"),
  CONSTRAINT fk_goods_receipts_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipts_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipts_po FOREIGN KEY ("po_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipts_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipts_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_goods_receipts_status_values CHECK ("status" IN ('DRAFT', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_goods_receipts_po_less_shape CHECK (
    ("po_id" IS NULL) = ("po_less_reason" IS NOT NULL)
  ),
  CONSTRAINT ck_goods_receipts_posted_shape CHECK (
    ("status" = 'POSTED') = ("posting_date" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_journal_id" IS NOT NULL AND "receipt_no" IS NOT NULL)
  ),
  CONSTRAINT ck_goods_receipts_cancel_shape CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  CONSTRAINT ck_goods_receipts_po_state CHECK (
    "po_id" IS NULL OR "status" <> 'POSTED' OR TRUE
  ),
  CONSTRAINT ck_goods_receipts_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500),
  CONSTRAINT ck_goods_receipts_po_less_reason_length CHECK ("po_less_reason" IS NULL OR length("po_less_reason") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_goods_receipts_tenant_status
  ON "goods_receipts" ("tenant_id", "status", "receipt_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_goods_receipts_tenant_supplier
  ON "goods_receipts" ("tenant_id", "supplier_id", "receipt_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_goods_receipts_tenant_po
  ON "goods_receipts" ("tenant_id", "po_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_goods_receipts_tenant_wh
  ON "goods_receipts" ("tenant_id", "warehouse_id");

--> statement-breakpoint
-- GRN lines. unit_cost is the PROVISIONAL cost (PO price at receipt; the
-- supplier invoice's final cost revalues at G-08 with the variance
-- recorded). Expense/asset purchases carry account_id instead of stock.
CREATE TABLE IF NOT EXISTS "goods_receipt_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "receipt_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "po_line_id" uuid,
  "item_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "unit_cost" numeric(19, 6) NOT NULL DEFAULT 0,
  "value_amount" numeric(19, 4) NOT NULL,
  "account_id" uuid,
  "batch_no" text,
  "batch_expiry" date,
  "serial_ids" jsonb,
  "note" text,
  CONSTRAINT pk_goods_receipt_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_goods_receipt_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_goods_receipt_lines_receipt_line UNIQUE ("tenant_id", "receipt_id", "line_no"),
  CONSTRAINT fk_goods_receipt_lines_receipt FOREIGN KEY ("receipt_id", "tenant_id")
    REFERENCES "goods_receipts" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_goods_receipt_lines_po_line FOREIGN KEY ("po_line_id", "tenant_id")
    REFERENCES "purchase_order_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipt_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_goods_receipt_lines_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_goods_receipt_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_goods_receipt_lines_cost_nonneg CHECK ("unit_cost" >= 0),
  CONSTRAINT ck_goods_receipt_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300),
  CONSTRAINT ck_goods_receipt_lines_batch_shape CHECK (
    "batch_expiry" IS NULL OR "batch_no" IS NOT NULL
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_goods_receipt_lines_tenant_item
  ON "goods_receipt_lines" ("tenant_id", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_goods_receipt_lines_po_line
  ON "goods_receipt_lines" ("tenant_id", "po_line_id");

--> statement-breakpoint
-- Supplier invoices (PHASE-011 §2.3/§2.5; golden G-08): the supplier's own
-- invoice_no (BR-011 duplicate semantics: (supplier, number, amount) block
-- / (supplier, number) different amount warn — service-level, NOT a unique
-- constraint), internal_no (BR-029), match_result jsonb recorded BEFORE
-- approval (BR-009 — the posting path refuses to run without it), and the
-- tax_summary accumulating by (treatment, rate, tax code) for INV-012.
CREATE TABLE IF NOT EXISTS "supplier_invoices" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "invoice_no" text NOT NULL,
  "internal_no" text,
  "invoice_date" date NOT NULL,
  "due_date" date NOT NULL,
  "currency_code" varchar(3) NOT NULL,
  "exchange_rate" numeric(19, 8),
  "po_id" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "match_status" text NOT NULL DEFAULT 'PENDING',
  "match_result" jsonb,
  "duplicate_warning" jsonb,
  "total_net" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_summary" jsonb,
  "note" text,
  "note_ar" text,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "posting_date" date,
  "posted_by" uuid,
  "posted_at" timestamptz,
  "posted_journal_id" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_supplier_invoices PRIMARY KEY ("id"),
  CONSTRAINT uq_supplier_invoices_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_supplier_invoices_tenant_internal UNIQUE ("tenant_id", "internal_no"),
  CONSTRAINT fk_supplier_invoices_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_invoices_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_invoices_po FOREIGN KEY ("po_id", "tenant_id")
    REFERENCES "purchase_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_invoices_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_supplier_invoices_status_values CHECK ("status" IN (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED'
  )),
  CONSTRAINT ck_supplier_invoices_match_status_values CHECK ("match_status" IN (
    'PENDING', 'MATCHED', 'EXCEPTION', 'DISPOSITIONED'
  )),
  CONSTRAINT ck_supplier_invoices_posted_shape CHECK (
    ("status" = 'POSTED') = ("posting_date" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_journal_id" IS NOT NULL AND "internal_no" IS NOT NULL)
  ),
  CONSTRAINT ck_supplier_invoices_cancel_shape CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  CONSTRAINT ck_supplier_invoices_totals CHECK (
    "total_gross" = "total_net" + "total_tax"
  ),
  CONSTRAINT ck_supplier_invoices_due_after_invoice CHECK ("due_date" >= "invoice_date"),
  CONSTRAINT ck_supplier_invoices_invoice_no_length CHECK (length("invoice_no") BETWEEN 1 AND 60),
  CONSTRAINT ck_supplier_invoices_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_invoices_tenant_status
  ON "supplier_invoices" ("tenant_id", "status", "invoice_date");
--> statement-breakpoint
-- The AP aging/statement index (§6 performance: (tenant, partner, due_date)
-- must EXPLAIN-verify at 100k AP documents).
CREATE INDEX IF NOT EXISTS ix_supplier_invoices_tenant_supplier_due
  ON "supplier_invoices" ("tenant_id", "supplier_id", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_invoices_tenant_supplier_no
  ON "supplier_invoices" ("tenant_id", "supplier_id", "invoice_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_invoices_tenant_po
  ON "supplier_invoices" ("tenant_id", "po_id");

--> statement-breakpoint
-- Supplier invoice lines. grn_line_id links the three-way match (PO ↔ GRN ↔
-- invoice); tax_snapshot is the BR-033 stamped rate snapshot; the per-line
-- journal quanta (grni_cleared_value / stock_revalue_value) persist the
-- exact G-08 legs for auditability.
CREATE TABLE IF NOT EXISTS "supplier_invoice_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "invoice_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "grn_line_id" uuid,
  "po_line_id" uuid,
  "item_id" uuid,
  "account_id" uuid,
  "description" text,
  "description_ar" text,
  "qty" numeric(19, 6) NOT NULL,
  "unit_price" numeric(19, 6) NOT NULL DEFAULT 0,
  "tax_code_id" uuid,
  "vat_recoverable" boolean NOT NULL DEFAULT true,
  "net_amount" numeric(19, 4) NOT NULL,
  "tax_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_snapshot" jsonb,
  "grni_cleared_value" numeric(19, 4) NOT NULL DEFAULT 0,
  "stock_revalue_value" numeric(19, 4) NOT NULL DEFAULT 0,
  "note" text,
  CONSTRAINT pk_supplier_invoice_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_supplier_invoice_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_supplier_invoice_lines_invoice_line UNIQUE ("tenant_id", "invoice_id", "line_no"),
  CONSTRAINT fk_supplier_invoice_lines_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "supplier_invoices" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_supplier_invoice_lines_grn_line FOREIGN KEY ("grn_line_id", "tenant_id")
    REFERENCES "goods_receipt_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_invoice_lines_po_line FOREIGN KEY ("po_line_id", "tenant_id")
    REFERENCES "purchase_order_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_invoice_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_invoice_lines_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_supplier_invoice_lines_tax_code FOREIGN KEY ("tax_code_id", "tenant_id")
    REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_supplier_invoice_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_supplier_invoice_lines_price_nonneg CHECK ("unit_price" >= 0),
  CONSTRAINT ck_supplier_invoice_lines_net_positive CHECK ("net_amount" > 0),
  CONSTRAINT ck_supplier_invoice_lines_tax_nonneg CHECK ("tax_amount" >= 0),
  CONSTRAINT ck_supplier_invoice_lines_target CHECK (
    ("item_id" IS NULL) <> ("account_id" IS NULL)
  ),
  CONSTRAINT ck_supplier_invoice_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_invoice_lines_tenant_item
  ON "supplier_invoice_lines" ("tenant_id", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_supplier_invoice_lines_grn_line
  ON "supplier_invoice_lines" ("tenant_id", "grn_line_id");

--> statement-breakpoint
-- Debit notes (PHASE-011 §2.6; golden G-09): AP corrections mirroring
-- supplier invoices, referencing the original invoice (INV-003/BR-031 —
-- corrections are always NEW documents).
CREATE TABLE IF NOT EXISTS "debit_notes" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "ref_invoice_id" uuid NOT NULL,
  "note_no" text,
  "note_date" date NOT NULL,
  "currency_code" varchar(3) NOT NULL,
  "exchange_rate" numeric(19, 8),
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_net" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_summary" jsonb,
  "note" text,
  "note_ar" text,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "posting_date" date,
  "posted_by" uuid,
  "posted_at" timestamptz,
  "posted_journal_id" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_debit_notes PRIMARY KEY ("id"),
  CONSTRAINT uq_debit_notes_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_debit_notes_tenant_no UNIQUE ("tenant_id", "note_no"),
  CONSTRAINT fk_debit_notes_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_debit_notes_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_debit_notes_ref_invoice FOREIGN KEY ("ref_invoice_id", "tenant_id")
    REFERENCES "supplier_invoices" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_debit_notes_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_debit_notes_status_values CHECK ("status" IN (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED'
  )),
  CONSTRAINT ck_debit_notes_posted_shape CHECK (
    ("status" = 'POSTED') = ("posting_date" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_journal_id" IS NOT NULL AND "note_no" IS NOT NULL)
  ),
  CONSTRAINT ck_debit_notes_cancel_shape CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  CONSTRAINT ck_debit_notes_totals CHECK (
    "total_gross" = "total_net" + "total_tax"
  ),
  CONSTRAINT ck_debit_notes_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_debit_notes_tenant_status
  ON "debit_notes" ("tenant_id", "status", "note_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_debit_notes_tenant_supplier
  ON "debit_notes" ("tenant_id", "supplier_id", "note_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_debit_notes_ref_invoice
  ON "debit_notes" ("tenant_id", "ref_invoice_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "debit_note_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "note_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "invoice_line_id" uuid,
  "item_id" uuid,
  "account_id" uuid,
  "description" text,
  "description_ar" text,
  "qty" numeric(19, 6) NOT NULL,
  "unit_price" numeric(19, 6) NOT NULL DEFAULT 0,
  "tax_code_id" uuid,
  "vat_recoverable" boolean NOT NULL DEFAULT true,
  "net_amount" numeric(19, 4) NOT NULL,
  "tax_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_snapshot" jsonb,
  "note" text,
  CONSTRAINT pk_debit_note_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_debit_note_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_debit_note_lines_note_line UNIQUE ("tenant_id", "note_id", "line_no"),
  CONSTRAINT fk_debit_note_lines_note FOREIGN KEY ("note_id", "tenant_id")
    REFERENCES "debit_notes" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_debit_note_lines_invoice_line FOREIGN KEY ("invoice_line_id", "tenant_id")
    REFERENCES "supplier_invoice_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_debit_note_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_debit_note_lines_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_debit_note_lines_tax_code FOREIGN KEY ("tax_code_id", "tenant_id")
    REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_debit_note_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_debit_note_lines_price_nonneg CHECK ("unit_price" >= 0),
  CONSTRAINT ck_debit_note_lines_net_positive CHECK ("net_amount" > 0),
  CONSTRAINT ck_debit_note_lines_tax_nonneg CHECK ("tax_amount" >= 0),
  CONSTRAINT ck_debit_note_lines_target CHECK (
    ("item_id" IS NULL) <> ("account_id" IS NULL)
  ),
  CONSTRAINT ck_debit_note_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_debit_note_lines_tenant_item
  ON "debit_note_lines" ("tenant_id", "item_id");

--> statement-breakpoint
-- Landed costs (PHASE-011 §2.10 — BASELINE ONLY: allocation math +
-- remaining-qty constraint; the full workflow UI + entitlement activation
-- are PHASE-015). charge_account_id is the credit side (freight payable
-- accrual, bank, or AP partner account — tenant's choice); allocation
-- revalues the affected WAC/layers through the inventory revaluation
-- service (MODULE_BOUNDARIES — purchasing never writes stock tables).
CREATE TABLE IF NOT EXISTS "landed_costs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "grn_id" uuid NOT NULL,
  "cost_no" text,
  "cost_type" text NOT NULL,
  "vendor_id" uuid,
  "amount" numeric(19, 4) NOT NULL,
  "allocation_method" text NOT NULL DEFAULT 'VALUE',
  "charge_account_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "allocated_to_stock" numeric(19, 4) NOT NULL DEFAULT 0,
  "allocated_to_cogs" numeric(19, 4) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  "posting_date" date,
  "posted_by" uuid,
  "posted_at" timestamptz,
  "posted_journal_id" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_landed_costs PRIMARY KEY ("id"),
  CONSTRAINT uq_landed_costs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_landed_costs_tenant_no UNIQUE ("tenant_id", "cost_no"),
  CONSTRAINT fk_landed_costs_grn FOREIGN KEY ("grn_id", "tenant_id")
    REFERENCES "goods_receipts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_landed_costs_vendor FOREIGN KEY ("vendor_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_landed_costs_charge_account FOREIGN KEY ("charge_account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_landed_costs_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_landed_costs_cost_type_values CHECK ("cost_type" IN (
    'freight', 'customs', 'insurance', 'other'
  )),
  CONSTRAINT ck_landed_costs_method_values CHECK ("allocation_method" IN ('VALUE', 'QTY')),
  CONSTRAINT ck_landed_costs_status_values CHECK ("status" IN ('DRAFT', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_landed_costs_amount_positive CHECK ("amount" > 0),
  CONSTRAINT ck_landed_costs_posted_shape CHECK (
    ("status" = 'POSTED') = ("posting_date" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_journal_id" IS NOT NULL AND "cost_no" IS NOT NULL)
  ),
  CONSTRAINT ck_landed_costs_cancel_shape CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  -- The allocation sum holds exactly once POSTED (DRAFT rows carry 0/0
  -- until the posting computes them).
  CONSTRAINT ck_landed_costs_allocation_sum CHECK (
    "status" <> 'POSTED' OR ("allocated_to_stock" + "allocated_to_cogs" = "amount")
  ),
  CONSTRAINT ck_landed_costs_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_landed_costs_tenant_grn
  ON "landed_costs" ("tenant_id", "grn_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_landed_costs_tenant_status
  ON "landed_costs" ("tenant_id", "status");

--> statement-breakpoint
-- Landed-cost allocation rows: one per GRN line. remaining_qty is the
-- on-hand-at-allocation snapshot (the remaining-qty constraint — §2.10);
-- cogs_adjustment_amount carries the issued-portion difference (explicit,
-- auditable — never silent back-dating).
CREATE TABLE IF NOT EXISTS "landed_cost_allocations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "landed_cost_id" uuid NOT NULL,
  "grn_line_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "qty_at_allocation" numeric(19, 6) NOT NULL,
  "remaining_qty" numeric(19, 6) NOT NULL,
  "allocated_amount" numeric(19, 4) NOT NULL,
  "cogs_adjustment_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "revalue_applied_at" timestamptz,
  CONSTRAINT pk_landed_cost_allocations PRIMARY KEY ("id"),
  CONSTRAINT uq_landed_cost_allocations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_landed_cost_allocations_cost_line UNIQUE ("tenant_id", "landed_cost_id", "grn_line_id"),
  CONSTRAINT fk_landed_cost_allocations_cost FOREIGN KEY ("landed_cost_id", "tenant_id")
    REFERENCES "landed_costs" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_landed_cost_allocations_grn_line FOREIGN KEY ("grn_line_id", "tenant_id")
    REFERENCES "goods_receipt_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_landed_cost_allocations_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_landed_cost_allocations_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_landed_cost_allocations_qty_positive CHECK ("qty_at_allocation" > 0),
  CONSTRAINT ck_landed_cost_allocations_remaining_nonneg CHECK ("remaining_qty" >= 0),
  CONSTRAINT ck_landed_cost_allocations_remaining_bound CHECK ("remaining_qty" <= "qty_at_allocation"),
  CONSTRAINT ck_landed_cost_allocations_amount_nonneg CHECK ("allocated_amount" >= 0),
  CONSTRAINT ck_landed_cost_allocations_cogs_nonneg CHECK ("cogs_adjustment_amount" >= 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_landed_cost_allocations_tenant_item
  ON "landed_cost_allocations" ("tenant_id", "item_id", "warehouse_id");

--> statement-breakpoint
-- stock_moves source-shape widening (the PHASE-011 expand step on the
-- PHASE-010 substrate): goods receipts receive stock through the movement
-- core with source_type 'goods_receipt'; supplier-invoice cost revalues
-- and landed-cost revalues join the INV-010 trail as adjust moves with
-- 'supplier_invoice' / 'landed_cost'. Append-only semantics are untouched
-- (grants + guard remain — SELECT/INSERT only for erp_app).
ALTER TABLE "stock_moves" DROP CONSTRAINT IF EXISTS ck_stock_moves_source_shape;
--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT ck_stock_moves_source_shape CHECK ("source_type" IN (
  'manual_receipt', 'manual_issue', 'stock_adjustment', 'stock_count',
  'stock_transfer', 'opening_balance_doc', 'method_switch',
  'goods_receipt', 'supplier_invoice', 'landed_cost'
));

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): standard macro on every new tenant-owned table.
SELECT erp.apply_tenant_policy('"purchase_requests"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"purchase_request_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"purchase_orders"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"purchase_order_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"goods_receipts"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"goods_receipt_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"supplier_invoices"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"supplier_invoice_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"debit_notes"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"debit_note_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"landed_costs"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"landed_cost_allocations"');

--> statement-breakpoint
-- Grants: draft-lifecycle tables — SELECT/INSERT/UPDATE for erp_app (posted
-- immutability is service discipline + the shape CHECKs above, mirroring
-- treasury's receipts/payments pattern).
REVOKE ALL ON "purchase_requests", "purchase_request_lines",
  "purchase_orders", "purchase_order_lines", "goods_receipts",
  "goods_receipt_lines", "supplier_invoices", "supplier_invoice_lines",
  "debit_notes", "debit_note_lines", "landed_costs", "landed_cost_allocations"
  FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "purchase_requests" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "purchase_request_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "purchase_orders" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "purchase_order_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "goods_receipts" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "goods_receipt_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "supplier_invoices" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "supplier_invoice_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "debit_notes" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "debit_note_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "landed_costs" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "landed_cost_allocations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "purchase_requests", "purchase_request_lines",
  "purchase_orders", "purchase_order_lines", "goods_receipts",
  "goods_receipt_lines", "supplier_invoices", "supplier_invoice_lines",
  "debit_notes", "debit_note_lines", "landed_costs", "landed_cost_allocations"
  TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (support-access read-all proxy composition, as prior phases).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "purchase_requests", "purchase_request_lines",
  "purchase_orders", "purchase_order_lines", "goods_receipts",
  "goods_receipt_lines", "supplier_invoices", "supplier_invoice_lines",
  "debit_notes", "debit_note_lines", "landed_costs", "landed_cost_allocations"
  TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 16)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
