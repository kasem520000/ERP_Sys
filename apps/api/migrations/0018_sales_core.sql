-- PHASE-012 · migration 0018 · sales core cluster
--
-- Purpose (PHASE-012 §2, §4; ENTITY_CATALOG §sales; TABLES/trade-sales.md):
-- - sales_reps: the rep registry + attribution surface (T12). Commissions
--   are explicitly PHASE-017 scope — NO commission columns ship here (the
--   phase's grep-clean scope guard).
-- - quotations + lines: DRAFT → SENT → ACCEPTED (converts to a sales
--   order) / REJECTED / EXPIRED / CANCELLED per DOCUMENT_LIFECYCLE §3; no
--   ledger effect; valid_until enforced (BR-006 — an expired quote cannot
--   be accepted or converted; re-issue as a new quotation).
-- - sales_orders + lines: confirmed orders with optional line-level SOFT
--   stock reservation against the PHASE-010 stock_reservations seam
--   (expiry-honored, non-blocking — the holder_type 'SALES_ORDER' PHASE-010
--   reserved), DRAFT → PENDING_APPROVAL → APPROVED → ISSUED → CLOSED with
--   BR-029 numbering at issue (SOR-).
-- - delivery_notes + lines: POSTED issues stock through the PHASE-010
--   movement core (planIssue/applyIssue inside the posting transaction —
--   MODULE_BOUNDARIES: sales never writes stock_moves itself) and posts
--   the COGS journal (golden G-03) WITHOUT AR (BR-007 doc_flow
--   delivery_then_invoice); converts to invoice later
--   (converted_invoice_id).
-- - sales_invoices + lines: cash + credit kinds; tax stamps per line
--   (BR-033 snapshots); official numbering at posting (SAL-, INV-021);
--   credit_check jsonb records the BR-001 decision (open + this vs limit,
--   posture, override) at approval; offline_receipt_no (PHASE-016) and
--   einvoice_status (PHASE-023) columns exist but stay NULL this phase.
-- - credit_notes + lines: returns + corrections referencing the original
--   invoice (BR-004 — the reference is NEVER optional); return lines
--   re-enter stock at the ORIGINAL issue cost (G-04/W-3: the
--   reentry_unit_cost snapshot travels from the invoice line, never a
--   current-average recompute).
--
-- Grant posture: SELECT/INSERT/UPDATE for erp_app on every table (draft
-- lifecycle states); posted rows are immutable by service discipline +
-- shape CHECKs (status ↔ posted_* columns), mirroring the
-- treasury/purchasing pattern. No append-only guard is needed here: the
-- immutable ledgers (journal, stock_moves, partner_subledger_entries,
-- cash_movements) are owned by their modules.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Sales reps (PHASE-012 §2.10; T12): attribution only — the commissions
-- engine is PHASE-017 (scope guard: no commission columns here).
CREATE TABLE IF NOT EXISTS "sales_reps" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "email" text,
  "phone" text,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_sales_reps PRIMARY KEY ("id"),
  CONSTRAINT uq_sales_reps_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_sales_reps_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT ck_sales_reps_status_values CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT ck_sales_reps_code_length CHECK (length("code") BETWEEN 1 AND 40),
  CONSTRAINT ck_sales_reps_name_length CHECK (length("name") BETWEEN 1 AND 200),
  CONSTRAINT ck_sales_reps_email_length CHECK ("email" IS NULL OR length("email") BETWEEN 3 AND 254),
  CONSTRAINT ck_sales_reps_phone_length CHECK ("phone" IS NULL OR length("phone") BETWEEN 3 AND 40),
  CONSTRAINT ck_sales_reps_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_reps_tenant_status
  ON "sales_reps" ("tenant_id", "status", "code");

--> statement-breakpoint
-- Quotations (PHASE-012 §2.1; BR-006): no ledger effect; quote_no reserves
-- at SENT (the first outbound state — BR-029's boundary). valid_until is
-- NOT NULL: the service derives it from quote_date +
-- sales.quote_default_validity_days (30) when the caller omits it.
CREATE TABLE IF NOT EXISTS "quotations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "sales_rep_id" uuid,
  "quote_no" text,
  "quote_date" date NOT NULL,
  "valid_until" date NOT NULL,
  "currency_code" varchar(3) NOT NULL,
  "exchange_rate" numeric(19, 8),
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_net" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19, 4) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  "sent_at" timestamptz,
  "sent_by" uuid,
  "accepted_at" timestamptz,
  "accepted_by" uuid,
  "rejected_at" timestamptz,
  "rejected_by" uuid,
  "rejection_reason" text,
  "converted_order_id" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_quotations PRIMARY KEY ("id"),
  CONSTRAINT uq_quotations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_quotations_tenant_no UNIQUE ("tenant_id", "quote_no"),
  CONSTRAINT fk_quotations_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_quotations_customer FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_quotations_rep FOREIGN KEY ("sales_rep_id", "tenant_id")
    REFERENCES "sales_reps" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_quotations_status_values CHECK ("status" IN (
    'DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'
  )),
  CONSTRAINT ck_quotations_validity CHECK ("valid_until" >= "quote_date"),
  CONSTRAINT ck_quotations_sent_shape CHECK (
    ("status" <> 'SENT' AND "status" <> 'ACCEPTED') OR ("sent_at" IS NOT NULL AND "sent_by" IS NOT NULL AND "quote_no" IS NOT NULL)
  ),
  CONSTRAINT ck_quotations_accepted_shape CHECK (
    ("status" <> 'ACCEPTED') OR ("accepted_at" IS NOT NULL AND "accepted_by" IS NOT NULL AND "converted_order_id" IS NOT NULL)
  ),
  CONSTRAINT ck_quotations_rejected_shape CHECK (
    ("status" <> 'REJECTED') OR ("rejected_at" IS NOT NULL AND "rejected_by" IS NOT NULL)
  ),
  CONSTRAINT ck_quotations_cancel_shape CHECK (
    ("status" <> 'CANCELLED') OR ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  CONSTRAINT ck_quotations_totals CHECK (
    "total_gross" = "total_net" + "total_tax"
  ),
  CONSTRAINT ck_quotations_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_quotations_tenant_status
  ON "quotations" ("tenant_id", "status", "quote_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_quotations_tenant_customer
  ON "quotations" ("tenant_id", "customer_id", "quote_date");

--> statement-breakpoint
-- Quotation lines: qty/price/discount/net/tax per line (BR-003 pricing
-- resolved at create through the items service; manual override within
-- BR-002 ceilings — validation is service-level).
CREATE TABLE IF NOT EXISTS "quotation_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "quotation_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "description" text,
  "description_ar" text,
  "qty" numeric(19, 6) NOT NULL,
  "unit_price" numeric(19, 6) NOT NULL DEFAULT 0,
  "discount_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_code_id" uuid,
  "net_amount" numeric(19, 4) NOT NULL,
  "tax_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "note" text,
  CONSTRAINT pk_quotation_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_quotation_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_quotation_lines_quote_line UNIQUE ("tenant_id", "quotation_id", "line_no"),
  CONSTRAINT fk_quotation_lines_quote FOREIGN KEY ("quotation_id", "tenant_id")
    REFERENCES "quotations" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_quotation_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_quotation_lines_tax_code FOREIGN KEY ("tax_code_id", "tenant_id")
    REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_quotation_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_quotation_lines_price_nonneg CHECK ("unit_price" >= 0),
  CONSTRAINT ck_quotation_lines_discount_nonneg CHECK ("discount_amount" >= 0),
  CONSTRAINT ck_quotation_lines_net_nonneg CHECK ("net_amount" >= 0),
  CONSTRAINT ck_quotation_lines_tax_nonneg CHECK ("tax_amount" >= 0),
  CONSTRAINT ck_quotation_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_quotation_lines_tenant_quote
  ON "quotation_lines" ("tenant_id", "quotation_id");

--> statement-breakpoint
-- Sales orders (PHASE-012 §2.2): the confirmed source of deliveries and
-- invoices; order_no reserves at ISSUE (SOR-, BR-029). Lines carry the
-- optional soft-reservation reference (stock_reservations holder_type
-- 'SALES_ORDER' — the PHASE-010 seam); availability nets ACTIVE
-- non-expired rows; expiry is honored by the sweep (non-blocking).
CREATE TABLE IF NOT EXISTS "sales_orders" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "sales_rep_id" uuid,
  "warehouse_id" uuid NOT NULL,
  "quotation_id" uuid,
  "order_no" text,
  "order_date" date NOT NULL,
  "expected_date" date,
  "currency_code" varchar(3) NOT NULL,
  "exchange_rate" numeric(19, 8),
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_net" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19, 4) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "issued_at" timestamptz,
  "issued_by" uuid,
  "closed_at" timestamptz,
  "closed_by" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_sales_orders PRIMARY KEY ("id"),
  CONSTRAINT uq_sales_orders_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_sales_orders_tenant_no UNIQUE ("tenant_id", "order_no"),
  CONSTRAINT fk_sales_orders_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_orders_customer FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_orders_rep FOREIGN KEY ("sales_rep_id", "tenant_id")
    REFERENCES "sales_reps" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_orders_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_orders_quotation FOREIGN KEY ("quotation_id", "tenant_id")
    REFERENCES "quotations" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_sales_orders_status_values CHECK ("status" IN (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'CLOSED', 'CANCELLED'
  )),
  CONSTRAINT ck_sales_orders_issued_shape CHECK (
    ("status" <> 'ISSUED' AND "status" <> 'CLOSED') OR ("issued_at" IS NOT NULL AND "issued_by" IS NOT NULL AND "order_no" IS NOT NULL)
  ),
  CONSTRAINT ck_sales_orders_approved_shape CHECK (
    ("status" NOT IN ('APPROVED', 'ISSUED', 'CLOSED')) OR ("approved_at" IS NOT NULL AND "approved_by" IS NOT NULL)
  ),
  CONSTRAINT ck_sales_orders_cancel_shape CHECK (
    ("status" <> 'CANCELLED') OR ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  CONSTRAINT ck_sales_orders_totals CHECK (
    "total_gross" = "total_net" + "total_tax"
  ),
  CONSTRAINT ck_sales_orders_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_orders_tenant_status
  ON "sales_orders" ("tenant_id", "status", "order_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_orders_tenant_customer
  ON "sales_orders" ("tenant_id", "customer_id", "order_date");

--> statement-breakpoint
-- Sales-order lines: qty/price/discount/net/tax + the optional soft
-- reservation reference (PHASE-010 stock_reservations row).
CREATE TABLE IF NOT EXISTS "sales_order_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "order_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "description" text,
  "description_ar" text,
  "qty" numeric(19, 6) NOT NULL,
  "unit_price" numeric(19, 6) NOT NULL DEFAULT 0,
  "discount_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_code_id" uuid,
  "net_amount" numeric(19, 4) NOT NULL,
  "tax_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "reservation_id" uuid,
  "note" text,
  CONSTRAINT pk_sales_order_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_sales_order_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_sales_order_lines_order_line UNIQUE ("tenant_id", "order_id", "line_no"),
  CONSTRAINT fk_sales_order_lines_order FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "sales_orders" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_sales_order_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_order_lines_tax_code FOREIGN KEY ("tax_code_id", "tenant_id")
    REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_order_lines_reservation FOREIGN KEY ("reservation_id", "tenant_id")
    REFERENCES "stock_reservations" ("id", "tenant_id") ON DELETE SET NULL,
  CONSTRAINT ck_sales_order_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_sales_order_lines_price_nonneg CHECK ("unit_price" >= 0),
  CONSTRAINT ck_sales_order_lines_discount_nonneg CHECK ("discount_amount" >= 0),
  CONSTRAINT ck_sales_order_lines_net_positive CHECK ("net_amount" > 0),
  CONSTRAINT ck_sales_order_lines_tax_nonneg CHECK ("tax_amount" >= 0),
  CONSTRAINT ck_sales_order_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_order_lines_tenant_order
  ON "sales_order_lines" ("tenant_id", "order_id");

--> statement-breakpoint
-- Delivery notes (PHASE-012 §2.3; BR-007 delivery_then_invoice): POSTED
-- issues stock through the PHASE-010 movement core and posts the COGS
-- journal (G-03) WITHOUT AR; converts to invoice later
-- (converted_invoice_id). issue_unit_cost/issue_value snapshot on the
-- lines at post — the credit-note re-entry provenance (W-3).
CREATE TABLE IF NOT EXISTS "delivery_notes" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "sales_rep_id" uuid,
  "order_id" uuid,
  "warehouse_id" uuid NOT NULL,
  "delivery_no" text,
  "delivery_date" date NOT NULL,
  "currency_code" varchar(3) NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_net" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19, 4) NOT NULL DEFAULT 0,
  "cogs_value" numeric(19, 4) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  "posting_date" date,
  "posted_by" uuid,
  "posted_at" timestamptz,
  "posted_journal_id" uuid,
  "converted_invoice_id" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_delivery_notes PRIMARY KEY ("id"),
  CONSTRAINT uq_delivery_notes_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_delivery_notes_tenant_no UNIQUE ("tenant_id", "delivery_no"),
  CONSTRAINT fk_delivery_notes_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_notes_customer FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_notes_rep FOREIGN KEY ("sales_rep_id", "tenant_id")
    REFERENCES "sales_reps" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_notes_order FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "sales_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_notes_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_notes_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_delivery_notes_status_values CHECK ("status" IN (
    'DRAFT', 'POSTED', 'CANCELLED'
  )),
  CONSTRAINT ck_delivery_notes_posted_shape CHECK (
    ("status" = 'POSTED') = ("posting_date" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_journal_id" IS NOT NULL AND "delivery_no" IS NOT NULL)
  ),
  CONSTRAINT ck_delivery_notes_cancel_shape CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  CONSTRAINT ck_delivery_notes_totals CHECK (
    "total_gross" = "total_net" + "total_tax"
  ),
  CONSTRAINT ck_delivery_notes_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_delivery_notes_tenant_status
  ON "delivery_notes" ("tenant_id", "status", "delivery_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_delivery_notes_tenant_customer
  ON "delivery_notes" ("tenant_id", "customer_id", "delivery_date");

--> statement-breakpoint
-- Delivery-note lines: batch/serial capture at issue (BR-017 FEFO picks
-- when unspecified; explicit batch binds), the snapshot issue cost + value
-- (the W-3 original-cost provenance for later credit-note re-entry).
CREATE TABLE IF NOT EXISTS "delivery_note_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "delivery_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "order_line_id" uuid,
  "item_id" uuid NOT NULL,
  "description" text,
  "description_ar" text,
  "qty" numeric(19, 6) NOT NULL,
  "unit_price" numeric(19, 6) NOT NULL DEFAULT 0,
  "discount_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "net_amount" numeric(19, 4) NOT NULL,
  "batch_id" uuid,
  "serial_ids" jsonb,
  "issue_unit_cost" numeric(19, 6),
  "issue_value" numeric(19, 4),
  "note" text,
  CONSTRAINT pk_delivery_note_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_delivery_note_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_delivery_note_lines_delivery_line UNIQUE ("tenant_id", "delivery_id", "line_no"),
  CONSTRAINT fk_delivery_note_lines_delivery FOREIGN KEY ("delivery_id", "tenant_id")
    REFERENCES "delivery_notes" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_delivery_note_lines_order_line FOREIGN KEY ("order_line_id", "tenant_id")
    REFERENCES "sales_order_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_note_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_note_lines_batch FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_delivery_note_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_delivery_note_lines_price_nonneg CHECK ("unit_price" >= 0),
  CONSTRAINT ck_delivery_note_lines_discount_nonneg CHECK ("discount_amount" >= 0),
  CONSTRAINT ck_delivery_note_lines_net_nonneg CHECK ("net_amount" >= 0),
  CONSTRAINT ck_delivery_note_lines_issue_shape CHECK (
    ("issue_unit_cost" IS NULL) = ("issue_value" IS NULL)
  ),
  CONSTRAINT ck_delivery_note_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_delivery_note_lines_tenant_delivery
  ON "delivery_note_lines" ("tenant_id", "delivery_id");

--> statement-breakpoint
-- Sales invoices (PHASE-012 §2.4; POSTING_ENGINE §4; goldens G-01/G-02/
-- G-03; W-1): cash + credit kinds; official invoice_no (SAL-) at posting
-- (INV-021); tax stamps per line (BR-033); credit_check jsonb records the
-- BR-001 decision at approval (posture, math, override); due date from
-- the customer's credit terms (BR-026). offline_receipt_no (PHASE-016)
-- and einvoice_status (PHASE-023) stay NULL this phase. Flow A
-- (delivery_then_invoice): delivery_id set, no stock/COGS here. Flow B
-- (invoice_then_delivery, with-goods): warehouse_id set, the invoice
-- issues stock + posts its own COGS entry (sales_invoice:cogs).
CREATE TABLE IF NOT EXISTS "sales_invoices" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "sales_rep_id" uuid,
  "kind" text NOT NULL,
  "invoice_no" text,
  "invoice_date" date NOT NULL,
  "due_date" date NOT NULL,
  "currency_code" varchar(3) NOT NULL,
  "exchange_rate" numeric(19, 8),
  "order_id" uuid,
  "delivery_id" uuid,
  "warehouse_id" uuid,
  "cash_account_id" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_net" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19, 4) NOT NULL DEFAULT 0,
  "cogs_value" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_summary" jsonb,
  "credit_check" jsonb,
  "offline_receipt_no" text,
  "einvoice_status" text,
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
  "posted_cogs_journal_id" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_sales_invoices PRIMARY KEY ("id"),
  CONSTRAINT uq_sales_invoices_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_sales_invoices_tenant_no UNIQUE ("tenant_id", "invoice_no"),
  CONSTRAINT fk_sales_invoices_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoices_customer FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoices_rep FOREIGN KEY ("sales_rep_id", "tenant_id")
    REFERENCES "sales_reps" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoices_order FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "sales_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoices_delivery FOREIGN KEY ("delivery_id", "tenant_id")
    REFERENCES "delivery_notes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoices_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoices_cash_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoices_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoices_cogs_journal FOREIGN KEY ("posted_cogs_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_sales_invoices_kind_values CHECK ("kind" IN ('CASH', 'CREDIT')),
  CONSTRAINT ck_sales_invoices_status_values CHECK ("status" IN (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED'
  )),
  CONSTRAINT ck_sales_invoices_cash_shape CHECK (
    ("kind" <> 'CASH') OR "cash_account_id" IS NOT NULL
  ),
  CONSTRAINT ck_sales_invoices_goods_shape CHECK (
    ("warehouse_id" IS NULL OR "delivery_id" IS NULL)
  ),
  CONSTRAINT ck_sales_invoices_posted_shape CHECK (
    ("status" = 'POSTED') = ("posting_date" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_journal_id" IS NOT NULL AND "invoice_no" IS NOT NULL)
  ),
  CONSTRAINT ck_sales_invoices_cancel_shape CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  CONSTRAINT ck_sales_invoices_totals CHECK (
    "total_gross" = "total_net" + "total_tax"
  ),
  CONSTRAINT ck_sales_invoices_due_after_invoice CHECK ("due_date" >= "invoice_date"),
  CONSTRAINT ck_sales_invoices_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
-- The AR aging/statement index (§6 performance: (tenant, partner,
-- due_date) must EXPLAIN-verify at 100k AR documents).
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_customer_due
  ON "sales_invoices" ("tenant_id", "customer_id", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_status
  ON "sales_invoices" ("tenant_id", "status", "invoice_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_order
  ON "sales_invoices" ("tenant_id", "order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_delivery
  ON "sales_invoices" ("tenant_id", "delivery_id");

--> statement-breakpoint
-- Sales-invoice lines: item (stock line) or account (service/charge);
-- delivery_line_id links flow A (stock/COGS already posted by the DN);
-- tax_snapshot is the BR-033 stamped rate snapshot; issue_unit_cost/
-- issue_value snapshot the with-goods issue (flow B) or copy from the DN
-- line (flow A) — the credit-note re-entry provenance (W-3 original cost).
CREATE TABLE IF NOT EXISTS "sales_invoice_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "invoice_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid,
  "account_id" uuid,
  "delivery_line_id" uuid,
  "description" text,
  "description_ar" text,
  "qty" numeric(19, 6) NOT NULL,
  "unit_price" numeric(19, 6) NOT NULL DEFAULT 0,
  "discount_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_code_id" uuid,
  "net_amount" numeric(19, 4) NOT NULL,
  "tax_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_snapshot" jsonb,
  "batch_id" uuid,
  "serial_ids" jsonb,
  "issue_unit_cost" numeric(19, 6),
  "issue_value" numeric(19, 4),
  "note" text,
  CONSTRAINT pk_sales_invoice_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_sales_invoice_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_sales_invoice_lines_invoice_line UNIQUE ("tenant_id", "invoice_id", "line_no"),
  CONSTRAINT fk_sales_invoice_lines_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_sales_invoice_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoice_lines_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoice_lines_delivery_line FOREIGN KEY ("delivery_line_id", "tenant_id")
    REFERENCES "delivery_note_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoice_lines_tax_code FOREIGN KEY ("tax_code_id", "tenant_id")
    REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_invoice_lines_batch FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_sales_invoice_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_sales_invoice_lines_price_nonneg CHECK ("unit_price" >= 0),
  CONSTRAINT ck_sales_invoice_lines_discount_nonneg CHECK ("discount_amount" >= 0),
  CONSTRAINT ck_sales_invoice_lines_net_positive CHECK ("net_amount" > 0),
  CONSTRAINT ck_sales_invoice_lines_tax_nonneg CHECK ("tax_amount" >= 0),
  CONSTRAINT ck_sales_invoice_lines_target CHECK (
    ("item_id" IS NULL) <> ("account_id" IS NULL)
  ),
  CONSTRAINT ck_sales_invoice_lines_issue_shape CHECK (
    ("issue_unit_cost" IS NULL) = ("issue_value" IS NULL)
  ),
  CONSTRAINT ck_sales_invoice_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoice_lines_tenant_invoice
  ON "sales_invoice_lines" ("tenant_id", "invoice_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoice_lines_tenant_delivery_line
  ON "sales_invoice_lines" ("tenant_id", "delivery_line_id");

--> statement-breakpoint
-- Credit notes (PHASE-012 §2.5; BR-004; golden G-04; W-3): returns and
-- corrections referencing an invoice — invoice_id is NOT NULL (the
-- reference requirement NEVER disables, BR-004). The return window is a
-- service check (sales.return_window_days). note_no (CRN-) at posting.
CREATE TABLE IF NOT EXISTS "credit_notes" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "sales_rep_id" uuid,
  "invoice_id" uuid NOT NULL,
  "note_no" text,
  "note_date" date NOT NULL,
  "currency_code" varchar(3) NOT NULL,
  "exchange_rate" numeric(19, 8),
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_net" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_tax" numeric(19, 4) NOT NULL DEFAULT 0,
  "total_gross" numeric(19, 4) NOT NULL DEFAULT 0,
  "reentry_value" numeric(19, 4) NOT NULL DEFAULT 0,
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
  CONSTRAINT pk_credit_notes PRIMARY KEY ("id"),
  CONSTRAINT uq_credit_notes_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_credit_notes_tenant_no UNIQUE ("tenant_id", "note_no"),
  CONSTRAINT fk_credit_notes_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_credit_notes_customer FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_credit_notes_rep FOREIGN KEY ("sales_rep_id", "tenant_id")
    REFERENCES "sales_reps" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_credit_notes_invoice FOREIGN KEY ("invoice_id", "tenant_id")
    REFERENCES "sales_invoices" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_credit_notes_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_credit_notes_status_values CHECK ("status" IN (
    'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED'
  )),
  CONSTRAINT ck_credit_notes_posted_shape CHECK (
    ("status" = 'POSTED') = ("posting_date" IS NOT NULL AND "posted_by" IS NOT NULL
      AND "posted_at" IS NOT NULL AND "posted_journal_id" IS NOT NULL AND "note_no" IS NOT NULL)
  ),
  CONSTRAINT ck_credit_notes_cancel_shape CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL AND "cancelled_by" IS NOT NULL)
  ),
  CONSTRAINT ck_credit_notes_totals CHECK (
    "total_gross" = "total_net" + "total_tax"
  ),
  CONSTRAINT ck_credit_notes_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_credit_notes_tenant_status
  ON "credit_notes" ("tenant_id", "status", "note_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_credit_notes_tenant_invoice
  ON "credit_notes" ("tenant_id", "invoice_id");

--> statement-breakpoint
-- Credit-note lines: return_to_stock flags the physical re-entry (at the
-- original issue cost snapshotted from the referenced invoice line —
-- reentry_unit_cost/reentry_value); batch preserved + serial binds the
-- originally sold unit (BR-018); invoice_line_id is the mandatory
-- per-line reference.
CREATE TABLE IF NOT EXISTS "credit_note_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "note_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "invoice_line_id" uuid NOT NULL,
  "item_id" uuid,
  "description" text,
  "description_ar" text,
  "qty" numeric(19, 6) NOT NULL,
  "unit_price" numeric(19, 6) NOT NULL DEFAULT 0,
  "discount_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_code_id" uuid,
  "net_amount" numeric(19, 4) NOT NULL,
  "tax_amount" numeric(19, 4) NOT NULL DEFAULT 0,
  "tax_snapshot" jsonb,
  "return_to_stock" boolean NOT NULL DEFAULT false,
  "batch_id" uuid,
  "serial_ids" jsonb,
  "reentry_unit_cost" numeric(19, 6),
  "reentry_value" numeric(19, 4),
  "note" text,
  CONSTRAINT pk_credit_note_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_credit_note_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_credit_note_lines_note_line UNIQUE ("tenant_id", "note_id", "line_no"),
  CONSTRAINT fk_credit_note_lines_note FOREIGN KEY ("note_id", "tenant_id")
    REFERENCES "credit_notes" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_credit_note_lines_invoice_line FOREIGN KEY ("invoice_line_id", "tenant_id")
    REFERENCES "sales_invoice_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_credit_note_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_credit_note_lines_tax_code FOREIGN KEY ("tax_code_id", "tenant_id")
    REFERENCES "tax_codes" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_credit_note_lines_batch FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_credit_note_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_credit_note_lines_price_nonneg CHECK ("unit_price" >= 0),
  CONSTRAINT ck_credit_note_lines_discount_nonneg CHECK ("discount_amount" >= 0),
  CONSTRAINT ck_credit_note_lines_net_positive CHECK ("net_amount" > 0),
  CONSTRAINT ck_credit_note_lines_tax_nonneg CHECK ("tax_amount" >= 0),
  CONSTRAINT ck_credit_note_lines_reentry_shape CHECK (
    ("return_to_stock" = false) OR ("item_id" IS NOT NULL AND "reentry_unit_cost" IS NOT NULL AND "reentry_value" IS NOT NULL)
  ),
  CONSTRAINT ck_credit_note_lines_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_credit_note_lines_tenant_note
  ON "credit_note_lines" ("tenant_id", "note_id");

--> statement-breakpoint
-- stock_moves source-shape widening (the PHASE-012 expand step on the
-- PHASE-010/011 substrate): delivery notes and with-goods sales invoices
-- issue stock through the movement core with source_type 'delivery_note'
-- / 'sales_invoice'; credit-note returns re-enter as receipts with
-- 'credit_note'. Append-only semantics are untouched (grants + guard
-- remain — SELECT/INSERT only for erp_app).
ALTER TABLE "stock_moves" DROP CONSTRAINT IF EXISTS ck_stock_moves_source_shape;
--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT ck_stock_moves_source_shape CHECK ("source_type" IN (
  'manual_receipt', 'manual_issue', 'stock_adjustment', 'stock_count',
  'stock_transfer', 'opening_balance_doc', 'method_switch',
  'goods_receipt', 'supplier_invoice', 'landed_cost',
  'delivery_note', 'sales_invoice', 'credit_note'
));

--> statement-breakpoint
-- cash_movements source-shape widening (the G-02 cash-invoice leg): a
-- CASH sales invoice pays at the counter through the treasury surface —
-- its movement row sources to the invoice (INV-019: the movement's base
-- equals the cash line's base). Append-only grants unchanged.
ALTER TABLE "cash_movements" DROP CONSTRAINT IF EXISTS ck_cash_movements_source_shape;
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT ck_cash_movements_source_shape CHECK ("source_type" IN (
  'receipt', 'payment', 'cash_transfer', 'expense', 'shift_variance', 'sales_invoice'
));

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): standard macro on every new tenant-owned table.
SELECT erp.apply_tenant_policy('"sales_reps"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"quotations"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"quotation_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"sales_orders"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"sales_order_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"delivery_notes"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"delivery_note_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"sales_invoices"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"sales_invoice_lines"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"credit_notes"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"credit_note_lines"');

--> statement-breakpoint
-- Grants: draft-lifecycle tables — SELECT/INSERT/UPDATE for erp_app
-- (posted immutability is service discipline + the shape CHECKs above,
-- mirroring the treasury/purchasing pattern).
REVOKE ALL ON "sales_reps", "quotations", "quotation_lines",
  "sales_orders", "sales_order_lines", "delivery_notes",
  "delivery_note_lines", "sales_invoices", "sales_invoice_lines",
  "credit_notes", "credit_note_lines"
  FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_reps" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "quotations" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "quotation_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_orders" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_order_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "delivery_notes" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "delivery_note_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_invoices" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "sales_invoice_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "credit_notes" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "credit_note_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "sales_reps", "quotations", "quotation_lines",
  "sales_orders", "sales_order_lines", "delivery_notes",
  "delivery_note_lines", "sales_invoices", "sales_invoice_lines",
  "credit_notes", "credit_note_lines"
  TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (support-access read-all proxy composition, as prior phases).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "sales_reps", "quotations", "quotation_lines",
  "sales_orders", "sales_order_lines", "delivery_notes",
  "delivery_note_lines", "sales_invoices", "sales_invoice_lines",
  "credit_notes", "credit_note_lines"
  TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 18)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
