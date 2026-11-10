-- PHASE-012 · migration 0019 · sales AR re-allocations
--
-- Purpose (PHASE-012 §2.7; RECEIVABLES_AND_PAYABLES §3.3): post-allocation
-- re-allocation happens via AUDITED re-allocation documents, not edits. A
-- sales_reallocation moves a settled amount of a POSTED customer receipt
-- from one AR open item to another open item of the SAME partner (same
-- currency), keeping INV-016 bounds under the CC-02 lock, rewriting the
-- receipt's treasury_allocations rows inside the same transaction (the
-- sanctioned replace pattern PHASE-008 established for drafts, extended
-- here under a posted-document audit trail — mirroring the PHASE-011
-- purchase_reallocations pair), and recording the movement as its own
-- durable document + audit event. The partner subledger is untouched —
-- allocations are settlement metadata; the receipt's AR_CONTROL line keeps
-- its 1:1 provenance (INV-009).
--
-- Receipts themselves (the money leg) needed NO new columns: the PHASE-008
-- receipts entity + treasury_allocations (receipt_id column) already carry
-- the AR-allocation surface — the PHASE-012 §4 "receipts gains
-- AR-allocation rows/columns" item is satisfied by the existing substrate
-- (documented in the completion report's reconciliation notes).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Re-allocation documents: one per (receipt, from→to movement batch).
-- Status is POSTED-at-create (the document IS the audited effect) — the
-- service validates + executes + records atomically.
CREATE TABLE IF NOT EXISTS "sales_reallocations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid,
  "doc_no" text,
  "receipt_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'POSTED',
  "total_amount" numeric(19, 4) NOT NULL,
  "executed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_sales_reallocations PRIMARY KEY ("id"),
  CONSTRAINT uq_sales_reallocations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_sales_reallocations_tenant_no UNIQUE ("tenant_id", "doc_no"),
  CONSTRAINT fk_sales_reallocations_receipt FOREIGN KEY ("receipt_id", "tenant_id")
    REFERENCES "receipts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_sales_reallocations_customer FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_sales_reallocations_status_values CHECK ("status" = 'POSTED'),
  CONSTRAINT ck_sales_reallocations_amount_positive CHECK ("total_amount" > 0),
  CONSTRAINT ck_sales_reallocations_reason_length CHECK (length("reason") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_reallocations_tenant_receipt
  ON "sales_reallocations" ("tenant_id", "receipt_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_reallocations_tenant_customer
  ON "sales_reallocations" ("tenant_id", "customer_id", "created_at");

--> statement-breakpoint
-- Re-allocation lines: the from→to pairs. Exactly one of the two may be
-- NULL to express "return to on-account" (to NULL = un-allocate) or
-- "allocate an on-account remainder" (from NULL) — the explicit on-account
-- semantics of BR-027.
CREATE TABLE IF NOT EXISTS "sales_reallocation_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "reallocation_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "from_open_item_id" uuid,
  "to_open_item_id" uuid,
  "amount" numeric(19, 4) NOT NULL,
  CONSTRAINT pk_sales_reallocation_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_sales_reallocation_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_sales_reallocation_lines_doc_line UNIQUE ("tenant_id", "reallocation_id", "line_no"),
  CONSTRAINT fk_sales_reallocation_lines_doc FOREIGN KEY ("reallocation_id", "tenant_id")
    REFERENCES "sales_reallocations" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_sales_reallocation_lines_amount_positive CHECK ("amount" > 0),
  CONSTRAINT ck_sales_reallocation_lines_direction CHECK (
    "from_open_item_id" IS NOT NULL OR "to_open_item_id" IS NOT NULL
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_reallocation_lines_tenant_doc
  ON "sales_reallocation_lines" ("tenant_id", "reallocation_id");

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2).
SELECT erp.apply_tenant_policy('"sales_reallocations"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"sales_reallocation_lines"');

--> statement-breakpoint
-- Grants: INSERT-only documents (the audit trail is append-only by shape —
-- status CHECK admits only POSTED).
REVOKE ALL ON "sales_reallocations", "sales_reallocation_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "sales_reallocations" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "sales_reallocation_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "sales_reallocations", "sales_reallocation_lines" TO erp_readonly;

--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "sales_reallocations", "sales_reallocation_lines" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 19)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
