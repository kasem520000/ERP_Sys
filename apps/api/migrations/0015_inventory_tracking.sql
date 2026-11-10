-- PHASE-010 · migration 0015 · inventory tracking cluster
--
-- Purpose (PHASE-010 §2.11/§2.12/§2.10; TABLES/trade-inventory.md §inventory):
-- - item_batches: batch/lot registry with expiry dates — the FEFO issuing
--   basis for has_expiry items (BR-017). On-hand per batch derives from
--   stock_moves (Σ IN − Σ OUT filtered by batch_id) — no drift-prone
--   side read model.
-- - item_serials: serial/IMEI unit registry (in_stock → sold → returned;
--   BR-018 return-binding substrate). IMEI is tenant-unique where present
--   (hardware identifiers are globally unique by standard); serial_no is
--   unique per (tenant, item) — the same serial MAY exist on different
--   SKUs (batch codes), a deliberately honest looseness.
-- - stock_counts + stock_count_lines: the count workspace substrate
--   (BR-015; Journey D). DRAFT → COUNTED → VARIANCE_REVIEW → POSTED
--   (CANCELLED from DRAFT). system_qty freezes at session start; the
--   blind-count option hides it from the counter surface; variance
--   review lists post-snapshot movements; approval posts G-13/G-14.
-- - stock_moves gains the batch/serial FKs here (expand step — the
--   tables now exist).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Batch/lot registry (PHASE-010 §2.11; BR-017 FEFO). expiry_date is
-- required by the service when the item is flagged has_expiry (the
-- CHECK stays permissive at the schema level — items without expiry
-- may still carry lot dates; FEFO only orders by expiry_date).
CREATE TABLE IF NOT EXISTS "item_batches" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "item_id" uuid NOT NULL,
  "batch_no" text NOT NULL,
  "expiry_date" date,
  "source_ref" text,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT pk_item_batches PRIMARY KEY ("id"),
  CONSTRAINT uq_item_batches_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_item_batches_tenant_item_no UNIQUE ("tenant_id", "item_id", "batch_no"),
  CONSTRAINT fk_item_batches_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_item_batches_status_values CHECK ("status" IN ('ACTIVE', 'WRITTEN_OFF')),
  CONSTRAINT ck_item_batches_batch_no_length CHECK (length("batch_no") BETWEEN 1 AND 60),
  CONSTRAINT ck_item_batches_source_ref_length CHECK ("source_ref" IS NULL OR length("source_ref") BETWEEN 1 AND 120)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_batches_tenant_item_expiry
  ON "item_batches" ("tenant_id", "item_id", "expiry_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_batches_tenant_status
  ON "item_batches" ("tenant_id", "status");

--> statement-breakpoint
-- Serial/IMEI unit registry (PHASE-010 §2.12; BR-018). status is the unit's
-- lifecycle: in_stock (receivable/issuable) → sold (bound to a sale move)
-- → returned (re-entered at ORIGINAL issue cost; a returned unit may be
-- re-sold — the move history keeps the binding). sold_at/returned_at
-- carry the binding audit the return check reads.
CREATE TABLE IF NOT EXISTS "item_serials" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "item_id" uuid NOT NULL,
  "serial_no" text NOT NULL,
  "imei" text,
  "status" text NOT NULL DEFAULT 'in_stock',
  "current_owner" text,
  "sold_at" date,
  "returned_at" date,
  CONSTRAINT pk_item_serials PRIMARY KEY ("id"),
  CONSTRAINT uq_item_serials_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_item_serials_tenant_item_no UNIQUE ("tenant_id", "item_id", "serial_no"),
  CONSTRAINT fk_item_serials_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_item_serials_status_values CHECK ("status" IN ('in_stock', 'sold', 'returned')),
  CONSTRAINT ck_item_serials_serial_length CHECK (length("serial_no") BETWEEN 1 AND 80),
  CONSTRAINT ck_item_serials_imei_shape CHECK ("imei" IS NULL OR "imei" ~ '^[0-9]{15,17}$'),
  CONSTRAINT ck_item_serials_sold_shape CHECK (
    ("status" IN ('sold', 'returned')) = ("sold_at" IS NOT NULL)
  ),
  CONSTRAINT ck_item_serials_returned_shape CHECK (
    ("status" = 'returned') = ("returned_at" IS NOT NULL)
  ),
  CONSTRAINT ck_item_serials_owner_length CHECK ("current_owner" IS NULL OR length("current_owner") BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_item_serials_tenant_imei
  ON "item_serials" ("tenant_id", "imei") WHERE "imei" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_serials_tenant_item_status
  ON "item_serials" ("tenant_id", "item_id", "status");

--> statement-breakpoint
-- Count sessions (PHASE-010 §2.10; BR-015; Journey D): DRAFT (open sheet,
-- snapshot_at frozen at creation) → COUNTED (counter submits) →
-- VARIANCE_REVIEW (variance computed + value impact) → POSTED (approval
-- posts the adjustment; G-13/G-14). supervisor_override records the
-- above-tolerance second-counter/supervisor approval (BR-015).
CREATE TABLE IF NOT EXISTS "stock_counts" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "count_no" text,
  "warehouse_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "blind" boolean NOT NULL DEFAULT false,
  "snapshot_at" timestamptz NOT NULL DEFAULT now(),
  "counted_by" uuid,
  "submitted_at" timestamptz,
  "approved_by" uuid,
  "approved_at" timestamptz,
  "supervisor_override" boolean NOT NULL DEFAULT false,
  "posting_date" date,
  "posted_journal_id" uuid,
  "variance" jsonb,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_stock_counts PRIMARY KEY ("id"),
  CONSTRAINT uq_stock_counts_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_stock_counts_tenant_no UNIQUE ("tenant_id", "count_no"),
  CONSTRAINT fk_stock_counts_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_counts_journal FOREIGN KEY ("posted_journal_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_stock_counts_status_values CHECK ("status" IN (
    'DRAFT', 'COUNTED', 'VARIANCE_REVIEW', 'POSTED', 'CANCELLED'
  )),
  CONSTRAINT ck_stock_counts_counted_shape CHECK (
    ("status" IN ('COUNTED', 'VARIANCE_REVIEW', 'POSTED'))
      = ("counted_by" IS NOT NULL AND "submitted_at" IS NOT NULL)
  ),
  CONSTRAINT ck_stock_counts_review_shape CHECK (
    ("status" IN ('VARIANCE_REVIEW', 'POSTED')) = ("variance" IS NOT NULL)
  ),
  CONSTRAINT ck_stock_counts_posted_shape CHECK (
    ("status" = 'POSTED') = ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL
      AND "posting_date" IS NOT NULL)
  ),
  CONSTRAINT ck_stock_counts_note_length CHECK ("note" IS NULL OR length("note") BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_counts_tenant_status
  ON "stock_counts" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_counts_tenant_wh
  ON "stock_counts" ("tenant_id", "warehouse_id");

--> statement-breakpoint
-- Count lines: system_qty is the frozen snapshot (copied from item_stock at
-- session creation); counted_qty lands at submission (NULL = not counted);
-- value_impact is computed at variance review (variance_qty × current
-- valuation, 4-decimal money). Batch-tracked items may carry multiple
-- lines per item (one per batch); the partial uniques make both shapes
-- collision-free.
CREATE TABLE IF NOT EXISTS "stock_count_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "stock_count_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "system_qty" numeric(19, 6) NOT NULL,
  "counted_qty" numeric(19, 6),
  "recounted" boolean NOT NULL DEFAULT false,
  "recount_note" text,
  "value_impact" numeric(19, 4),
  CONSTRAINT pk_stock_count_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_stock_count_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_stock_count_lines_no UNIQUE ("stock_count_id", "line_no"),
  CONSTRAINT fk_stock_count_lines_count FOREIGN KEY ("stock_count_id", "tenant_id")
    REFERENCES "stock_counts" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_stock_count_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_stock_count_lines_batch FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_stock_count_lines_system_nonnegative CHECK ("system_qty" >= 0),
  CONSTRAINT ck_stock_count_lines_counted_nonnegative CHECK ("counted_qty" IS NULL OR "counted_qty" >= 0),
  CONSTRAINT ck_stock_count_lines_line_no CHECK ("line_no" >= 1),
  CONSTRAINT ck_stock_count_lines_recount_note_length CHECK ("recount_note" IS NULL OR length("recount_note") BETWEEN 1 AND 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_count_lines_count_item_plain
  ON "stock_count_lines" ("stock_count_id", "item_id") WHERE "batch_id" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_count_lines_count_item_batch
  ON "stock_count_lines" ("stock_count_id", "item_id", "batch_id") WHERE "batch_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_stock_count_lines_tenant_count
  ON "stock_count_lines" ("tenant_id", "stock_count_id", "line_no");

--> statement-breakpoint
-- stock_moves batch/serial FK expand step (0014 declared the columns;
-- the referenced tables exist as of this migration).
ALTER TABLE "stock_moves"
  ADD CONSTRAINT fk_stock_moves_batch FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "stock_moves"
  ADD CONSTRAINT fk_stock_moves_serial FOREIGN KEY ("serial_id", "tenant_id")
    REFERENCES "item_serials" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2): standard macro on every new tenant-owned table.
SELECT erp.apply_tenant_policy('"item_batches"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"item_serials"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"stock_counts"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"stock_count_lines"');

--> statement-breakpoint
-- Grants: SELECT/INSERT/UPDATE for the registries + workspace (lifecycle
-- states; posted rows immutable by service + shape CHECKs).
REVOKE ALL ON "item_batches", "item_serials", "stock_counts",
  "stock_count_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "item_batches" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "item_serials" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stock_counts" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "stock_count_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "item_batches", "item_serials", "stock_counts",
  "stock_count_lines" TO erp_readonly;

--> statement-breakpoint
-- Definer read surface (support-access read-all proxy composition, as prior phases).
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "item_batches", "item_serials", "stock_counts",
  "stock_count_lines" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 15)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
