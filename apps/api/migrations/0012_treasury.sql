-- PHASE-008 · migration 0012 · treasury cluster
--
-- Purpose (PHASE-008 §2, §4; TABLES/treasury-tax.md; ERD/treasury-tax.md):
-- - cash_accounts: CASH|BANK|PETTY treasury accounts — each IS a GL account
--   (account_id 1:1, unique per tenant); open/close lifecycle preserves
--   history (closing blocks new documents only).
-- - cash_movements: immutable IN/OUT rows (INV-019's substrate). Written
--   ONLY by treasury services inside the posting transaction. Append-only
--   🔒 by grants (SELECT/INSERT — no UPDATE/DELETE for erp_app at all) +
--   the erp.cash_movements_guard() BEFORE UPDATE/DELETE trigger, so even
--   repository misuse cannot rewrite cash history (§6 security).
-- - receipts / payments: the generic money documents (DRAFT → POSTED; the
--   approval states exist for tenants that add BR-034 policies). AP/AR-
--   specific allocation columns extend in PHASE-011/012 per the phase doc;
--   the partner allocations of THIS phase settle the PHASE-007 opening-
--   balance subledger items.
-- - treasury_allocations: the allocation substrate (INV-016) — receipt and
--   payment legs are real composite FKs (exactly one set), the open item is
--   the partner subledger entry. The phase doc's §4 table list undercounts
--   this table (its §2.3 allocations + §6 INV-016 tests require durable
--   rows) — recorded in the phase report's doc-reality reconciliation.
-- - expense_categories / expenses: bilingual categories mapped to expense
--   accounts (BR-023); claims carry the reserved tax_code_id (wired in
--   PHASE-009) and the receipt attachment (files module).
-- - cash_transfers: account↔account transfers with bank charges (G-12).
-- - cashier_shifts: BR-021 shift model (float, manual capture feed, close
--   count, variance handling; POS-grade UX lands PHASE-016).
-- - bank_statements / bank_statement_lines: statement import (idempotent
--   per file hash) + matching substrate (BR-022). Statement lines are
--   informational — they NEVER become ledger entries (RECONCILIATION §4).
-- - reconciliation_runs.kind widened with 'BANK_REC' (the per-account
--   statement-period reconcile state rides the PHASE-007 framework).
--
-- Doc-reality reconciliation (completion report): the phase document's T1
-- names this file 0009_treasury.sql; 0009–0011 already exist (same drift
-- the PHASE-007 report recorded for its own T2) — it ships as 0012.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Cash/bank/petty accounts (PHASE-008 §2.1): each treasury account IS a GL
-- account — uq_cash_accounts_tenant_account enforces the 1:1 link so INV-
-- 019's "balance = Σ movements" is per-GL-account unambiguous. Opening
-- requires an existing mapped GL account (service-enforced); closing
-- preserves every movement and journal row (status flip only).
CREATE TABLE IF NOT EXISTS "cash_accounts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "name" text NOT NULL,
  "name_ar" text,
  "type" text NOT NULL,
  "account_id" uuid NOT NULL,
  "branch_id" uuid,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz,
  "closed_by" uuid,
  "close_reason" text,
  CONSTRAINT pk_cash_accounts PRIMARY KEY ("id"),
  CONSTRAINT uq_cash_accounts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_cash_accounts_tenant_account UNIQUE ("tenant_id", "account_id"),
  CONSTRAINT uq_cash_accounts_tenant_name UNIQUE ("tenant_id", "name"),
  CONSTRAINT fk_cash_accounts_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_cash_accounts_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_cash_accounts_type_values CHECK ("type" IN ('CASH', 'BANK', 'PETTY')),
  CONSTRAINT ck_cash_accounts_status_values CHECK ("status" IN ('ACTIVE', 'CLOSED')),
  CONSTRAINT ck_cash_accounts_closed_shape CHECK (
    ("status" = 'CLOSED') = ("closed_at" IS NOT NULL)
  ),
  CONSTRAINT ck_cash_accounts_name_length CHECK (length("name") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_cash_accounts_tenant_type_status ON "cash_accounts" ("tenant_id", "type", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_cash_accounts_tenant_branch ON "cash_accounts" ("tenant_id", "branch_id") WHERE "branch_id" IS NOT NULL;

--> statement-breakpoint
-- Cash movements (PHASE-008 §2.2; INV-019): immutable IN/OUT rows written
-- only by treasury services in the SAME transaction as the journal posting.
-- amount is the account-currency quantum; base_amount carries the exact
-- base conversion so the INV-019 check sums in base. The (source, account,
-- direction) uniqueness is the movement-level idempotency mirror of the
-- journal's INV-013 key — a source document never yields two movements on
-- the same account side (transfers differ per account+direction).
CREATE TABLE IF NOT EXISTS "cash_movements" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "cash_account_id" uuid NOT NULL,
  "direction" text NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "exchange_rate" numeric(19,8) NOT NULL DEFAULT 1,
  "base_amount" numeric(19,4) NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "value_date" date NOT NULL,
  "memo" text,
  "memo_ar" text,
  CONSTRAINT pk_cash_movements PRIMARY KEY ("id"),
  CONSTRAINT uq_cash_movements_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_cash_movements_source_side UNIQUE ("tenant_id", "source_type", "source_id", "cash_account_id", "direction"),
  CONSTRAINT fk_cash_movements_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_cash_movements_direction_values CHECK ("direction" IN ('IN', 'OUT')),
  CONSTRAINT ck_cash_movements_amount_positive CHECK ("amount" > 0),
  CONSTRAINT ck_cash_movements_base_positive CHECK ("base_amount" > 0),
  CONSTRAINT ck_cash_movements_rate_positive CHECK ("exchange_rate" > 0),
  CONSTRAINT ck_cash_movements_source_shape CHECK ("source_type" IN ('receipt', 'payment', 'cash_transfer', 'expense', 'shift_variance')),
  CONSTRAINT ck_cash_movements_memo_length CHECK ("memo" IS NULL OR length("memo") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_cash_movements_tenant_account_date ON "cash_movements" ("tenant_id", "cash_account_id", "value_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_cash_movements_tenant_source ON "cash_movements" ("tenant_id", "source_type", "source_id");

--> statement-breakpoint
-- Receipts (PHASE-008 §2.3; G-05/G-06): money-in documents. DRAFT → POSTED
-- (DOCUMENT_LIFECYCLE §3: no approval by default; BR-034 policies may add
-- the PENDING_APPROVAL/APPROVED states for doc_type 'receipt'). Official
-- numbers assign at posting via the numbering service (INV-021). Posted
-- rows are immutable — correction is reversal-only (INV-014).
CREATE TABLE IF NOT EXISTS "receipts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "receipt_no" text,
  "cash_account_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "method" text NOT NULL,
  "payer_name" text,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "amount" numeric(19,4) NOT NULL,
  "exchange_rate" numeric(19,8),
  "value_date" date NOT NULL,
  "reference" text,
  "description" text,
  "description_ar" text,
  "allocated_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "fx_gain_loss" numeric(19,4) NOT NULL DEFAULT 0,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "posted_journal_id" uuid,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_receipts PRIMARY KEY ("id"),
  CONSTRAINT uq_receipts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_receipts_cash_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_receipts_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_receipts_status_values CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_receipts_method_values CHECK ("method" IN ('CASH', 'BANK', 'CHEQUE', 'CARD', 'TRANSFER')),
  CONSTRAINT ck_receipts_amount_positive CHECK ("amount" > 0),
  CONSTRAINT ck_receipts_rate_positive CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0),
  CONSTRAINT ck_receipts_allocated_bounds CHECK ("allocated_amount" >= 0 AND "allocated_amount" <= "amount"),
  CONSTRAINT ck_receipts_posted_shape CHECK (
    ("status" = 'POSTED') = ("posted_journal_id" IS NOT NULL AND "receipt_no" IS NOT NULL)
  ),
  CONSTRAINT ck_receipts_reference_length CHECK ("reference" IS NULL OR length("reference") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_receipts_tenant_status_date ON "receipts" ("tenant_id", "status", "value_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_receipts_tenant_partner ON "receipts" ("tenant_id", "partner_id");

--> statement-breakpoint
-- Payments (PHASE-008 §2.3; G-10): the money-out mirror of receipts.
CREATE TABLE IF NOT EXISTS "payments" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "payment_no" text,
  "cash_account_id" uuid NOT NULL,
  "partner_id" uuid NOT NULL,
  "method" text NOT NULL,
  "payee_name" text,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "amount" numeric(19,4) NOT NULL,
  "exchange_rate" numeric(19,8),
  "value_date" date NOT NULL,
  "reference" text,
  "description" text,
  "description_ar" text,
  "allocated_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "fx_gain_loss" numeric(19,4) NOT NULL DEFAULT 0,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "posted_journal_id" uuid,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_payments PRIMARY KEY ("id"),
  CONSTRAINT uq_payments_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_payments_cash_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_payments_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_payments_status_values CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_payments_method_values CHECK ("method" IN ('CASH', 'BANK', 'CHEQUE', 'CARD', 'TRANSFER')),
  CONSTRAINT ck_payments_amount_positive CHECK ("amount" > 0),
  CONSTRAINT ck_payments_rate_positive CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0),
  CONSTRAINT ck_payments_allocated_bounds CHECK ("allocated_amount" >= 0 AND "allocated_amount" <= "amount"),
  CONSTRAINT ck_payments_posted_shape CHECK (
    ("status" = 'POSTED') = ("posted_journal_id" IS NOT NULL AND "payment_no" IS NOT NULL)
  ),
  CONSTRAINT ck_payments_reference_length CHECK ("reference" IS NULL OR length("reference") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payments_tenant_status_date ON "payments" ("tenant_id", "status", "value_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_payments_tenant_partner ON "payments" ("tenant_id", "partner_id");

--> statement-breakpoint
-- Treasury allocations (PHASE-008 §2.3; INV-016; CC-02): settlement links
-- between a receipt/payment and the partner's open items (PHASE-007
-- partner_subledger_entries — the opening-balance items). Exactly one of
-- receipt_id/payment_id is set (real composite FKs, not a polymorphic
-- hole). Effective allocations are those on POSTED documents; the service
-- validates Σ ≤ document amount and Σ ≤ open item outstanding under a row
-- lock on the open item (CC-02). DRAFT rows are editable until posting;
-- DELETE is granted for the pre-POST edit path (same sanctioned pattern as
-- manual journal drafts) and confined by the service.
CREATE TABLE IF NOT EXISTS "treasury_allocations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid,
  "receipt_id" uuid,
  "payment_id" uuid,
  "open_item_id" uuid NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  CONSTRAINT pk_treasury_allocations PRIMARY KEY ("id"),
  CONSTRAINT uq_treasury_allocations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_treasury_allocations_receipt FOREIGN KEY ("receipt_id", "tenant_id")
    REFERENCES "receipts" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_treasury_allocations_payment FOREIGN KEY ("payment_id", "tenant_id")
    REFERENCES "payments" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_treasury_allocations_open_item FOREIGN KEY ("open_item_id", "tenant_id")
    REFERENCES "partner_subledger_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_treasury_allocations_exactly_one_doc CHECK (
    ("receipt_id" IS NULL) <> ("payment_id" IS NULL)
  ),
  CONSTRAINT ck_treasury_allocations_amount_positive CHECK ("amount" > 0)
);
--> statement-breakpoint
-- Per-document uniqueness via partial indexes (NULLs are distinct in a
-- plain UNIQUE, so the polymorphic CHECK exactly-one-doc needs two
-- partial uniques to prevent duplicate (doc, open item) allocation rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_allocations_receipt_item
  ON "treasury_allocations" ("tenant_id", "receipt_id", "open_item_id") WHERE "receipt_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_treasury_allocations_payment_item
  ON "treasury_allocations" ("tenant_id", "payment_id", "open_item_id") WHERE "payment_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_treasury_allocations_tenant_item ON "treasury_allocations" ("tenant_id", "open_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_treasury_allocations_tenant_receipt ON "treasury_allocations" ("tenant_id", "receipt_id") WHERE "receipt_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_treasury_allocations_tenant_payment ON "treasury_allocations" ("tenant_id", "payment_id") WHERE "payment_id" IS NOT NULL;

--> statement-breakpoint
-- Expense categories (PHASE-008 §2.6; BR-023): bilingual, tenant-unique
-- code, mapped to a postable expense GL account; approval_mode 'none'
-- skips the PENDING_APPROVAL hop for trivial categories.
CREATE TABLE IF NOT EXISTS "expense_categories" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "account_id" uuid NOT NULL,
  "approval_mode" text NOT NULL DEFAULT 'single-approver',
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_expense_categories PRIMARY KEY ("id"),
  CONSTRAINT uq_expense_categories_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_expense_categories_tenant_code UNIQUE ("tenant_id", "code"),
  CONSTRAINT fk_expense_categories_account FOREIGN KEY ("account_id", "tenant_id")
    REFERENCES "accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_expense_categories_approval CHECK ("approval_mode" IN ('none', 'single-approver')),
  CONSTRAINT ck_expense_categories_code_shape CHECK ("code" ~ '^[A-Za-z0-9_-]{2,30}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_expense_categories_tenant_active ON "expense_categories" ("tenant_id", "is_active");

--> statement-breakpoint
-- Expenses (PHASE-008 §2.6; BR-023; G-11): claims with DRAFT →
-- PENDING_APPROVAL → APPROVED → POSTED lifecycle. tax_code_id is the
-- RESERVED PHASE-009 field (nullable FK-able later; no tax table exists
-- yet so it carries as a uuid placeholder — documented in the phase doc).
-- receipt_file_id links the mandatory receipt attachment (files module)
-- above the tenant's receipt threshold.
CREATE TABLE IF NOT EXISTS "expenses" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "expense_no" text,
  "category_id" uuid NOT NULL,
  "cash_account_id" uuid NOT NULL,
  "payee_name" text NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "amount" numeric(19,4) NOT NULL,
  "exchange_rate" numeric(19,8),
  "tax_code_id" uuid,
  "receipt_file_id" uuid,
  "value_date" date NOT NULL,
  "description" text,
  "description_ar" text,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "posted_journal_id" uuid,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_expenses PRIMARY KEY ("id"),
  CONSTRAINT uq_expenses_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_expenses_category FOREIGN KEY ("category_id", "tenant_id")
    REFERENCES "expense_categories" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_cash_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_receipt_file FOREIGN KEY ("receipt_file_id", "tenant_id")
    REFERENCES "file_objects" ("id", "tenant_id") ON DELETE SET NULL,
  CONSTRAINT ck_expenses_status_values CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_expenses_amount_positive CHECK ("amount" > 0),
  CONSTRAINT ck_expenses_rate_positive CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0),
  CONSTRAINT ck_expenses_posted_shape CHECK (
    ("status" = 'POSTED') = ("posted_journal_id" IS NOT NULL AND "expense_no" IS NOT NULL)
  ),
  CONSTRAINT ck_expenses_payee_length CHECK (length("payee_name") BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_expenses_tenant_status_date ON "expenses" ("tenant_id", "status", "value_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_expenses_tenant_category ON "expenses" ("tenant_id", "category_id");

--> statement-breakpoint
-- Cash transfers (PHASE-008 §2.5; G-12): DRAFT → POSTED (approval states
-- available for BR-034 policies on doc_type 'cash_transfer'); the fee F
-- posts to the BANK_CHARGES purpose; INV-019 holds on both sides.
CREATE TABLE IF NOT EXISTS "cash_transfers" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "transfer_no" text,
  "from_account_id" uuid NOT NULL,
  "to_account_id" uuid NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "amount" numeric(19,4) NOT NULL,
  "fee_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "exchange_rate" numeric(19,8),
  "value_date" date NOT NULL,
  "reference" text,
  "description" text,
  "description_ar" text,
  "submitted_at" timestamptz,
  "submitted_by" uuid,
  "approved_at" timestamptz,
  "approved_by" uuid,
  "posted_journal_id" uuid,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "cancelled_at" timestamptz,
  "cancelled_by" uuid,
  "cancel_reason" text,
  CONSTRAINT pk_cash_transfers PRIMARY KEY ("id"),
  CONSTRAINT uq_cash_transfers_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_cash_transfers_from FOREIGN KEY ("from_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_cash_transfers_to FOREIGN KEY ("to_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_cash_transfers_status_values CHECK ("status" IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_cash_transfers_distinct_accounts CHECK ("from_account_id" <> "to_account_id"),
  CONSTRAINT ck_cash_transfers_amount_positive CHECK ("amount" > 0),
  CONSTRAINT ck_cash_transfers_fee_nonnegative CHECK ("fee_amount" >= 0),
  CONSTRAINT ck_cash_transfers_fee_below_amount CHECK ("fee_amount" < "amount"),
  CONSTRAINT ck_cash_transfers_rate_positive CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0),
  CONSTRAINT ck_cash_transfers_posted_shape CHECK (
    ("status" = 'POSTED') = ("posted_journal_id" IS NOT NULL AND "transfer_no" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_cash_transfers_tenant_status_date ON "cash_transfers" ("tenant_id", "status", "value_date");

--> statement-breakpoint
-- Cashier shifts (PHASE-008 §2.7; BR-021): the shift model + manual
-- tellering capture (captured_in/captured_out accumulate the manual feed;
-- the POS integration lands PHASE-016). expected = opening + in − out at
-- close; difference = counted − expected. One OPEN shift per account
-- (partial unique). Variance journals post with the shift as source; the
-- supervisor attestation is required above the tolerance threshold.
CREATE TABLE IF NOT EXISTS "cashier_shifts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "status" text NOT NULL DEFAULT 'OPEN',
  "shift_no" text,
  "cash_account_id" uuid NOT NULL,
  "currency_code" char(3) NOT NULL REFERENCES "currencies" ("code") ON DELETE RESTRICT,
  "exchange_rate" numeric(19,8),
  "opening_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "captured_in" numeric(19,4) NOT NULL DEFAULT 0,
  "captured_out" numeric(19,4) NOT NULL DEFAULT 0,
  "expected_amount" numeric(19,4),
  "counted_amount" numeric(19,4),
  "difference" numeric(19,4),
  "variance_posted_journal_id" uuid,
  "supervisor_id" uuid,
  "supervisor_verified_at" timestamptz,
  "close_reason" text,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz,
  "closed_by" uuid,
  CONSTRAINT pk_cashier_shifts PRIMARY KEY ("id"),
  CONSTRAINT uq_cashier_shifts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_cashier_shifts_cash_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_cashier_shifts_status_values CHECK ("status" IN ('OPEN', 'CLOSED', 'CANCELLED')),
  CONSTRAINT ck_cashier_shifts_amounts_nonnegative CHECK (
    "opening_amount" >= 0 AND "captured_in" >= 0 AND "captured_out" >= 0
  ),
  CONSTRAINT ck_cashier_shifts_closed_shape CHECK (
    ("status" IN ('CLOSED', 'CANCELLED')) = ("closed_at" IS NOT NULL)
  ),
  CONSTRAINT ck_cashier_shifts_rate_positive CHECK ("exchange_rate" IS NULL OR "exchange_rate" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_cashier_shifts_one_open_per_account
  ON "cashier_shifts" ("tenant_id", "cash_account_id") WHERE "status" = 'OPEN';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_cashier_shifts_tenant_status ON "cashier_shifts" ("tenant_id", "status", "opened_at");

--> statement-breakpoint
-- Bank statements (PHASE-008 §2.8; BR-022): one imported file per (tenant,
-- hash) — imports are idempotent; RECONCILED locks the statement period
-- for that account (the lock is enforced by the service on any later
-- matching inside a reconciled window for the account).
CREATE TABLE IF NOT EXISTS "bank_statements" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "status" text NOT NULL DEFAULT 'IMPORTED',
  "cash_account_id" uuid NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "file_name" text NOT NULL,
  "file_hash" text NOT NULL,
  "adapter_id" text NOT NULL,
  "opening_balance" numeric(19,4),
  "closing_balance" numeric(19,4),
  "line_count" integer NOT NULL DEFAULT 0,
  "imported_at" timestamptz NOT NULL DEFAULT now(),
  "reconciled_at" timestamptz,
  "reconciled_by" uuid,
  CONSTRAINT pk_bank_statements PRIMARY KEY ("id"),
  CONSTRAINT uq_bank_statements_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_bank_statements_tenant_hash UNIQUE ("tenant_id", "file_hash"),
  CONSTRAINT fk_bank_statements_cash_account FOREIGN KEY ("cash_account_id", "tenant_id")
    REFERENCES "cash_accounts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_bank_statements_status_values CHECK ("status" IN ('IMPORTED', 'RECONCILED')),
  CONSTRAINT ck_bank_statements_period CHECK ("period_end" >= "period_start"),
  CONSTRAINT ck_bank_statements_hash_shape CHECK ("file_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ck_bank_statements_count CHECK ("line_count" >= 0),
  CONSTRAINT ck_bank_statements_reconciled_shape CHECK (
    ("status" = 'RECONCILED') = ("reconciled_at" IS NOT NULL)
  ),
  CONSTRAINT ck_bank_statements_filename_length CHECK (length("file_name") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bank_statements_tenant_account_period
  ON "bank_statements" ("tenant_id", "cash_account_id", "period_start", "period_end");

--> statement-breakpoint
-- Bank statement lines (PHASE-008 §2.8; BR-022 fixed): informational rows
-- only — they NEVER create ledger entries (RECONCILIATION §4). The signed
-- amount convention: positive = money into the bank account, negative =
-- money out. matched_movement_id links the informational side to the
-- system movement; matched_at/by + match_mode audit every match.
CREATE TABLE IF NOT EXISTS "bank_statement_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "bank_statement_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "line_date" date NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "reference" text,
  "description" text,
  "matched_movement_id" uuid,
  "matched_at" timestamptz,
  "matched_by" uuid,
  "match_mode" text,
  CONSTRAINT pk_bank_statement_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_bank_statement_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_bank_statement_lines_statement_no UNIQUE ("bank_statement_id", "line_no"),
  CONSTRAINT fk_bank_statement_lines_statement FOREIGN KEY ("bank_statement_id", "tenant_id")
    REFERENCES "bank_statements" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_bank_statement_lines_movement FOREIGN KEY ("matched_movement_id", "tenant_id")
    REFERENCES "cash_movements" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_bank_statement_lines_mode_values CHECK ("match_mode" IN ('AUTO', 'MANUAL') OR "match_mode" IS NULL),
  CONSTRAINT ck_bank_statement_lines_match_shape CHECK (
    ("matched_movement_id" IS NULL) = ("matched_at" IS NULL)
  ),
  CONSTRAINT ck_bank_statement_lines_reference_length CHECK ("reference" IS NULL OR length("reference") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bank_statement_lines_tenant_statement
  ON "bank_statement_lines" ("tenant_id", "bank_statement_id", "line_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bank_statement_lines_tenant_movement
  ON "bank_statement_lines" ("tenant_id", "matched_movement_id") WHERE "matched_movement_id" IS NOT NULL;

--> statement-breakpoint
-- Reconciliation-runs kind widening (PHASE-008 §2.10): the bank-rec
-- per-account period completion rides the PHASE-007 framework — add the
-- 'BANK_REC' kind alongside the pre-provisioned 'CASH' (INV-019).
ALTER TABLE "reconciliation_runs" DROP CONSTRAINT IF EXISTS ck_reconciliation_runs_kind_values;
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT ck_reconciliation_runs_kind_values
  CHECK ("kind" IN ('AR', 'AP', 'CASH', 'BANK_REC', 'VAT', 'INVENTORY', 'GRNI', 'WIP'));

--> statement-breakpoint
-- Expenses carry receipt attachments (files module, §2.6/BR-023): widen
-- the file_objects owner CHECK with 'EXPENSE' (the PHASE-006 set was
-- PARTNER/ITEM/OPENING_BALANCE_DOC — additive widening, no removals).
ALTER TABLE "file_objects" DROP CONSTRAINT IF EXISTS ck_file_objects_owner_values;
--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT ck_file_objects_owner_values
  CHECK ("owner_type" IN ('PARTNER', 'ITEM', 'OPENING_BALANCE_DOC', 'EXPENSE'));

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): standard macro on every new tenant-owned table.
SELECT erp.apply_tenant_policy('"cash_accounts"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"cash_movements"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"receipts"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"payments"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"treasury_allocations"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"expense_categories"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"expenses"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"cash_transfers"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"cashier_shifts"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bank_statements"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bank_statement_lines"');

--> statement-breakpoint
-- Grants. cash_movements is append-only 🔒: SELECT/INSERT only for erp_app
-- (no UPDATE, no DELETE — A4 proves the denial) plus the guard trigger
-- below (defense in depth, §6). treasury_allocations carries the
-- sanctioned pre-POST edit DELETE (draft allocation replacement — the
-- manual-journal-drafts pattern; the service confines it to non-POSTED
-- documents). Everything else: SELECT/INSERT/UPDATE (lifecycle states);
-- posted rows are immutable by service + the CHECK shape constraints.
REVOKE ALL ON "cash_accounts", "cash_movements", "receipts", "payments",
  "treasury_allocations", "expense_categories", "expenses", "cash_transfers",
  "cashier_shifts", "bank_statements", "bank_statement_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cash_accounts" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "cash_movements" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "receipts" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payments" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "treasury_allocations" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "expense_categories" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "expenses" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cash_transfers" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "cashier_shifts" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bank_statements" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bank_statement_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "cash_accounts", "cash_movements", "receipts", "payments",
  "treasury_allocations", "expense_categories", "expenses", "cash_transfers",
  "cashier_shifts", "bank_statements", "bank_statement_lines" TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (support-access read-all proxy composition, as prior phases).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "cash_accounts", "cash_movements", "receipts", "payments",
  "treasury_allocations", "expense_categories", "expenses", "cash_transfers",
  "cashier_shifts", "bank_statements", "bank_statement_lines" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Append-only guard for cash_movements (§6 security: grant + trigger, so
-- even repository misuse cannot rewrite cash history). The function is
-- created by the migrate role (schema owner) and fires for every row.
CREATE OR REPLACE FUNCTION erp.cash_movements_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cash_movements are append-only (INV-019): % on row % is forbidden',
    TG_OP, OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_cash_movements_guard ON "cash_movements";
--> statement-breakpoint
CREATE TRIGGER trg_cash_movements_guard
  BEFORE UPDATE OR DELETE ON "cash_movements"
  FOR EACH ROW EXECUTE FUNCTION erp.cash_movements_guard();
--> statement-breakpoint
COMMENT ON FUNCTION erp.cash_movements_guard() IS
  'PHASE-008 INV-019: cash_movements are immutable (INSERT-only; the guard fires as defense in depth beyond the missing UPDATE/DELETE grants).';

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 12)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
