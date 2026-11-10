-- PHASE-011 · migration 0017 · purchasing AP re-allocations
--
-- Purpose (PHASE-011 §2.7; RECEIVABLES_AND_PAYABLES §3.3): post-allocation
-- re-allocation happens via AUDITED re-allocation documents, not edits. A
-- purchase_reallocation moves a settled amount of a POSTED payment from one
-- AP open item to another open item of the SAME partner (same currency),
-- keeping INV-016 bounds under the CC-02 lock, rewriting the payment's
-- treasury_allocations rows inside the same transaction (the sanctioned
-- replace pattern PHASE-008 established for drafts, extended here under a
-- posted-document audit trail), and recording the movement as its own
-- durable document + audit event. The partner subledger is untouched —
-- allocations are settlement metadata; the payment's AP_CONTROL line keeps
-- its 1:1 provenance (INV-009).
--
-- The GRNI reconciliation (RC-09, RECONCILIATION map row 8) needs no new
-- table: the register is a deterministic recomputation from goods_receipt_
-- lines (received value) minus POSTED supplier-invoice lines (cleared
-- value), compared against the GRNI account's journal balance — the query
-- service ships in the purchasing module; the reconciliation_runs.kind
-- CHECK already includes 'GRNI' (migration 0011).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Re-allocation documents: one per (payment, from→to movement batch).
-- Status is POSTED-at-create (the document IS the audited effect) — the
-- service validates + executes + records atomically.
CREATE TABLE IF NOT EXISTS "purchase_reallocations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid,
  "doc_no" text,
  "payment_id" uuid NOT NULL,
  "supplier_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'POSTED',
  "total_amount" numeric(19, 4) NOT NULL,
  "executed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_purchase_reallocations PRIMARY KEY ("id"),
  CONSTRAINT uq_purchase_reallocations_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_purchase_reallocations_tenant_no UNIQUE ("tenant_id", "doc_no"),
  CONSTRAINT fk_purchase_reallocations_payment FOREIGN KEY ("payment_id", "tenant_id")
    REFERENCES "payments" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_purchase_reallocations_supplier FOREIGN KEY ("supplier_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_purchase_reallocations_status_values CHECK ("status" = 'POSTED'),
  CONSTRAINT ck_purchase_reallocations_amount_positive CHECK ("total_amount" > 0),
  CONSTRAINT ck_purchase_reallocations_reason_length CHECK (length("reason") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_reallocations_tenant_payment
  ON "purchase_reallocations" ("tenant_id", "payment_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_reallocations_tenant_supplier
  ON "purchase_reallocations" ("tenant_id", "supplier_id", "created_at");

--> statement-breakpoint
-- Re-allocation lines: the from→to pairs. Exactly one of the two may be
-- NULL to express "return to on-account" (to NULL = un-allocate) or
-- "allocate an on-account remainder" (from NULL) — the explicit on-account
-- semantics of BR-027.
CREATE TABLE IF NOT EXISTS "purchase_reallocation_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "reallocation_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "from_open_item_id" uuid,
  "to_open_item_id" uuid,
  "amount" numeric(19, 4) NOT NULL,
  CONSTRAINT pk_purchase_reallocation_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_purchase_reallocation_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_purchase_reallocation_lines_doc_line UNIQUE ("tenant_id", "reallocation_id", "line_no"),
  CONSTRAINT fk_purchase_reallocation_lines_doc FOREIGN KEY ("reallocation_id", "tenant_id")
    REFERENCES "purchase_reallocations" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_purchase_reallocation_lines_amount_positive CHECK ("amount" > 0),
  CONSTRAINT ck_purchase_reallocation_lines_direction CHECK (
    "from_open_item_id" IS NOT NULL OR "to_open_item_id" IS NOT NULL
  )
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_purchase_reallocation_lines_tenant_doc
  ON "purchase_reallocation_lines" ("tenant_id", "reallocation_id");

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2).
SELECT erp.apply_tenant_policy('"purchase_reallocations"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"purchase_reallocation_lines"');

--> statement-breakpoint
-- Grants: INSERT-only documents (the audit trail is append-only by shape —
-- status CHECK admits only POSTED).
REVOKE ALL ON "purchase_reallocations", "purchase_reallocation_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "purchase_reallocations" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON "purchase_reallocation_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "purchase_reallocations", "purchase_reallocation_lines" TO erp_readonly;

--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "purchase_reallocations", "purchase_reallocation_lines" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 17)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
