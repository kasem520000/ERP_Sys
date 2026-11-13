-- PHASE-043 (Blueprint v3.0 · CR-13) · migration 0076 · Manufacturing II —
-- MRP & Planning (part 3: the run engine family + the document links).
--
-- Purpose (PHASE-043 §2.4/§2.5/§2.7/§2.10): the deterministic,
-- explanation-first net-requirements engine:
--
--   mrp_runs (H-03/M-01/M-07) — one planning run per (warehouse, params):
--     run mode REGENERATIVE | NET_CHANGE, bucket size DAY | WEEK, horizon
--     buckets, scope items, and the FULL parameter snapshot (jsonb params —
--     replayable determinism); the demand/supply snapshot rows ARE the
--     run's input evidence.
--   mrp_demand_lines — the per-(item, bucket) demand snapshot: MPS,
--     unreserved firm sales orders, the safety-stock gap, BOM-explosion
--     demand (with the generating parent) and substitution coverage; the
--     substitutes jsonb carries the M-09 records riding the line.
--   mrp_supply_lines — the per-(item, bucket) supply snapshot: qualified
--     on-hand (per batch for expiry items — a batch whose expiry precedes
--     the bucket start does NOT cover it, M-10), ACTIVE reservations,
--     open purchase orders, open production orders, inbound transfers and
--     co/by-product receipts (M-11 netting).
--   mrp_suggestions (H-03/M-01/M-24) — the actionable output:
--     PURCHASE_ORDER / PRODUCTION_ORDER / TRANSFER, quantity after lot
--     sizing, due/release dates, the per-suggestion netting drill-down
--     (jsonb — the explanation-first law), SUGGESTED → ACCEPTED (the
--     idempotent one-click conversion, INV-030/BR-079) / DISMISSED
--     (reason required, BR-079) / SUPERSEDED (re-run coverage netting),
--     and the one-to-one converted-document link.
--
--   Document links (additive columns): production_orders.sales_order_line_id
--     (the MTO link M-22) + mrp_suggestion_id; purchase_orders.
--     mrp_suggestion_id (the bidirectional link, acceptance criterion 3 —
--     no duplicated purchasing logic, the 038 create path is called);
--     sales_order_lines.promised_date + the ATP stamps (M-06/S-10 — the
--     promise-date suggestion + the over-promise warning).
--   stock_reservations.holder_type gains PRODUCTION_ORDER (the 0025/0028
--     widening pattern — the MTO hard reservation + the policy engine's
--     production reservations, T-12).
--
-- INV-030 (netting exactness): per bucket, net = (MPS + unreserved firm
-- sales + safety-stock gap) − (qualified on-hand − reserved) − (open POs +
-- open MOs + inbound transfers) computed in exact Decimal arithmetic with
-- every term snapshotted — the property suite proves it per bucket.
--
-- Grants: the MRP family is planning data (SELECT/INSERT/UPDATE — status
-- lifecycles; no deletes: superseded rows stay as audit trail).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. mrp_runs (§2.4).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mrp_runs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'RUNNING',
  "run_mode" text NOT NULL,
  "bucket_size" text NOT NULL,
  "horizon_buckets" integer NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "as_of_date" date NOT NULL,
  "scope_item_ids" jsonb NOT NULL DEFAULT '[]',
  "params" jsonb NOT NULL,
  "stats" jsonb,
  "error_code" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "created_by" uuid,
  CONSTRAINT "pk_mrp_runs" PRIMARY KEY ("id"),
  CONSTRAINT "uq_mrp_runs_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_mrp_runs_status" CHECK ("status" IN ('RUNNING', 'COMPLETED', 'FAILED')),
  CONSTRAINT "ck_mrp_runs_mode" CHECK ("run_mode" IN ('REGENERATIVE', 'NET_CHANGE')),
  CONSTRAINT "ck_mrp_runs_bucket" CHECK ("bucket_size" IN ('DAY', 'WEEK')),
  CONSTRAINT "ck_mrp_runs_horizon" CHECK ("horizon_buckets" >= 1 AND "horizon_buckets" <= 366),
  CONSTRAINT "ck_mrp_runs_failed_shape" CHECK (
    ("status" <> 'FAILED') OR ("error_code" IS NOT NULL AND "completed_at" IS NOT NULL)
  ),
  CONSTRAINT "fk_mrp_runs_warehouse" FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mrp_runs_tenant_wh_created"
  ON "mrp_runs" ("tenant_id", "warehouse_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mrp_runs_tenant_status"
  ON "mrp_runs" ("tenant_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. mrp_demand_lines (§2.4): the per-run demand snapshot. bucket 0 is the
--    pre-horizon slot (past-due demand lands there — the deterministic
--    past-due fold).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mrp_demand_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "run_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "bucket_index" integer NOT NULL,
  "bucket_start" date NOT NULL,
  "demand_kind" text NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "sales_order_line_id" uuid,
  "mps_entry_id" uuid,
  "parent_item_id" uuid,
  "substituted_item_id" uuid,
  "substitutes" jsonb NOT NULL DEFAULT '[]',
  "note" text,
  CONSTRAINT "pk_mrp_demand_lines" PRIMARY KEY ("id"),
  CONSTRAINT "uq_mrp_demand_lines_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_mrp_demand_lines_slot" UNIQUE ("tenant_id", "run_id", "item_id", "bucket_index", "demand_kind", "parent_item_id"),
  CONSTRAINT "ck_mrp_demand_lines_kind" CHECK ("demand_kind" IN ('MPS', 'SALES_ORDER', 'SAFETY_STOCK', 'BOM_EXPLOSION', 'SUBSTITUTION')),
  CONSTRAINT "ck_mrp_demand_lines_bucket" CHECK ("bucket_index" >= 0),
  CONSTRAINT "ck_mrp_demand_lines_qty" CHECK ("qty" >= 0),
  CONSTRAINT "fk_mrp_demand_lines_run" FOREIGN KEY ("run_id", "tenant_id")
    REFERENCES "mrp_runs" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT "fk_mrp_demand_lines_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mrp_demand_lines_sales_line" FOREIGN KEY ("sales_order_line_id", "tenant_id")
    REFERENCES "sales_order_lines" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mrp_demand_lines_mps" FOREIGN KEY ("mps_entry_id", "tenant_id")
    REFERENCES "mps_entries" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mrp_demand_lines_run_item"
  ON "mrp_demand_lines" ("tenant_id", "run_id", "item_id", "bucket_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mrp_demand_lines_run_kind"
  ON "mrp_demand_lines" ("tenant_id", "run_id", "demand_kind");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. mrp_supply_lines (§2.4): the per-run supply snapshot. ON_HAND rows
--    are per batch (batch_id NULL for batch-less items) with the expiry
--    date riding the row — the M-10 expiry-aware qualification evidence.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mrp_supply_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "run_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "bucket_index" integer NOT NULL,
  "bucket_start" date NOT NULL,
  "supply_kind" text NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "batch_id" uuid,
  "expires_on" date,
  "purchase_order_id" uuid,
  "production_order_id" uuid,
  "stock_transfer_id" uuid,
  "note" text,
  CONSTRAINT "pk_mrp_supply_lines" PRIMARY KEY ("id"),
  CONSTRAINT "uq_mrp_supply_lines_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_mrp_supply_lines_kind" CHECK ("supply_kind" IN (
    'ON_HAND', 'RESERVED', 'OPEN_PO', 'OPEN_MO', 'INBOUND_TRANSFER', 'CO_PRODUCT', 'SUGGESTED_RECEIPT'
  )),
  CONSTRAINT "ck_mrp_supply_lines_bucket" CHECK ("bucket_index" >= 0),
  CONSTRAINT "ck_mrp_supply_lines_qty" CHECK ("qty" >= 0),
  CONSTRAINT "fk_mrp_supply_lines_run" FOREIGN KEY ("run_id", "tenant_id")
    REFERENCES "mrp_runs" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT "fk_mrp_supply_lines_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mrp_supply_lines_batch" FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mrp_supply_lines_run_item"
  ON "mrp_supply_lines" ("tenant_id", "run_id", "item_id", "bucket_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mrp_supply_lines_run_kind"
  ON "mrp_supply_lines" ("tenant_id", "run_id", "supply_kind");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. mrp_suggestions (§2.5, H-03/M-01/M-24): the actionable output.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mrp_suggestions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "run_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "warehouse_id" uuid NOT NULL,
  "from_warehouse_id" uuid,
  "suggestion_type" text NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "uom_id" uuid,
  "due_date" date NOT NULL,
  "release_date" date NOT NULL,
  "frozen_fence" boolean NOT NULL DEFAULT false,
  "status" text NOT NULL DEFAULT 'SUGGESTED',
  "substituted_item_id" uuid,
  "bom_id" uuid,
  "netting" jsonb NOT NULL DEFAULT '{}',
  "dismissed_reason" text,
  "converted_doc_type" text,
  "converted_doc_id" uuid,
  "accepted_at" timestamptz,
  "accepted_by" uuid,
  "dismissed_at" timestamptz,
  "dismissed_by" uuid,
  "superseded_at" timestamptz,
  "superseded_by_run_id" uuid,
  "created_by" uuid,
  CONSTRAINT "pk_mrp_suggestions" PRIMARY KEY ("id"),
  CONSTRAINT "uq_mrp_suggestions_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_mrp_suggestions_type" CHECK ("suggestion_type" IN ('PURCHASE_ORDER', 'PRODUCTION_ORDER', 'TRANSFER')),
  CONSTRAINT "ck_mrp_suggestions_status" CHECK ("status" IN ('SUGGESTED', 'ACCEPTED', 'DISMISSED', 'SUPERSEDED')),
  CONSTRAINT "ck_mrp_suggestions_qty" CHECK ("qty" > 0),
  CONSTRAINT "ck_mrp_suggestions_dates" CHECK ("release_date" <= "due_date"),
  CONSTRAINT "ck_mrp_suggestions_transfer_shape" CHECK (
    ("suggestion_type" <> 'TRANSFER') OR "from_warehouse_id" IS NOT NULL
  ),
  CONSTRAINT "ck_mrp_suggestions_dismissed_shape" CHECK (
    ("status" <> 'DISMISSED') OR ("dismissed_reason" IS NOT NULL AND length("dismissed_reason") BETWEEN 1 AND 300)
  ),
  CONSTRAINT "ck_mrp_suggestions_converted_shape" CHECK (
    ("status" <> 'ACCEPTED') OR ("converted_doc_type" IS NOT NULL AND "converted_doc_id" IS NOT NULL)
  ),
  CONSTRAINT "ck_mrp_suggestions_doc_types" CHECK (
    "converted_doc_type" IS NULL OR "converted_doc_type" IN ('purchase_order', 'production_order', 'stock_transfer')
  ),
  CONSTRAINT "fk_mrp_suggestions_run" FOREIGN KEY ("run_id", "tenant_id")
    REFERENCES "mrp_runs" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mrp_suggestions_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mrp_suggestions_warehouse" FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mrp_suggestions_from_warehouse" FOREIGN KEY ("from_warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mrp_suggestions_bom" FOREIGN KEY ("bom_id", "tenant_id")
    REFERENCES "bills_of_materials" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mrp_suggestions_supersede_run" FOREIGN KEY ("superseded_by_run_id", "tenant_id")
    REFERENCES "mrp_runs" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
-- The one-to-one conversion link (acceptance criterion 3): a converted
-- document is claimed by exactly one suggestion — the idempotency anchor.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_mrp_suggestions_converted_doc"
  ON "mrp_suggestions" ("tenant_id", "converted_doc_type", "converted_doc_id")
  WHERE "converted_doc_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mrp_suggestions_tenant_status"
  ON "mrp_suggestions" ("tenant_id", "status", "suggestion_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mrp_suggestions_tenant_item"
  ON "mrp_suggestions" ("tenant_id", "item_id", "warehouse_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mrp_suggestions_run"
  ON "mrp_suggestions" ("tenant_id", "run_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Document links (additive columns; the MTO + conversion wiring).
--> statement-breakpoint
-- The MTO link (M-22): the production order's driving sales line — set at
-- conversion (from the suggestion) or directly (a make-to-order shop
-- binding an order to demand); completion routes the output to the linked
-- sales delivery with the MO's actual cost (G-49).
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "sales_order_line_id" uuid;
--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "mrp_suggestion_id" uuid;
--> statement-breakpoint
ALTER TABLE "production_orders" DROP CONSTRAINT IF EXISTS "fk_production_orders_sales_line";
--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT fk_production_orders_sales_line
  FOREIGN KEY ("sales_order_line_id", "tenant_id")
  REFERENCES "sales_order_lines" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "production_orders" DROP CONSTRAINT IF EXISTS "fk_production_orders_mrp_suggestion";
--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT fk_production_orders_mrp_suggestion
  FOREIGN KEY ("mrp_suggestion_id", "tenant_id")
  REFERENCES "mrp_suggestions" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "mrp_suggestion_id" uuid;
--> statement-breakpoint
ALTER TABLE "purchase_orders" DROP CONSTRAINT IF EXISTS "fk_purchase_orders_mrp_suggestion";
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT fk_purchase_orders_mrp_suggestion
  FOREIGN KEY ("mrp_suggestion_id", "tenant_id")
  REFERENCES "mrp_suggestions" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
-- The ATP stamps on sales lines (M-06/S-10): the user's promise date, the
-- engine's verdict (OK | SHORT — the over-promise warning) and its
-- suggested date (CTP: the first date live supply can cover).
ALTER TABLE "sales_order_lines" ADD COLUMN IF NOT EXISTS "promised_date" date;
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN IF NOT EXISTS "atp_status" text;
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD COLUMN IF NOT EXISTS "atp_suggested_date" date;
--> statement-breakpoint
ALTER TABLE "sales_order_lines" DROP CONSTRAINT IF EXISTS "ck_sales_order_lines_atp";
--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT ck_sales_order_lines_atp CHECK (
  "atp_status" IS NULL OR "atp_status" IN ('OK', 'SHORT')
);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. stock_reservations.holder_type gains PRODUCTION_ORDER (the 0025/0028
--    widening pattern): the MTO hard reservation + the policy engine's
--    production-order reservations (T-12).
--> statement-breakpoint
ALTER TABLE "stock_reservations" DROP CONSTRAINT IF EXISTS ck_stock_reservations_holder_values;
--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT ck_stock_reservations_holder_values
  CHECK ("holder_type" IN ('MANUAL', 'SALES_ORDER', 'JOB_CARD', 'SERVICE_ORDER', 'PRODUCTION_ORDER'));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. RLS — the house triple for the MRP family.
--> statement-breakpoint
ALTER TABLE "mrp_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mrp_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"mrp_runs"');
--> statement-breakpoint
ALTER TABLE "mrp_demand_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mrp_demand_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"mrp_demand_lines"');
--> statement-breakpoint
ALTER TABLE "mrp_supply_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mrp_supply_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"mrp_supply_lines"');
--> statement-breakpoint
ALTER TABLE "mrp_suggestions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mrp_suggestions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"mrp_suggestions"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mrp_runs', 'mrp_demand_lines', 'mrp_supply_lines', 'mrp_suggestions'] LOOP
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
-- 8. Grants.
--> statement-breakpoint
REVOKE ALL ON "mrp_runs" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "mrp_runs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "mrp_runs" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "mrp_runs" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "mrp_demand_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "mrp_demand_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "mrp_demand_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "mrp_demand_lines" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "mrp_supply_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "mrp_supply_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "mrp_supply_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "mrp_supply_lines" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "mrp_suggestions" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "mrp_suggestions" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "mrp_suggestions" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "mrp_suggestions" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "mrp_runs" IS 'PHASE-043 (H-03/M-01/M-07): the deterministic MRP run — parameters snapshotted (jsonb), demand/supply lines are the input evidence, suggestions the actionable output / تشغيل تخطيط الاحتياجات: معاملات مُلتقطة وسطور طلب/عرض هي الدليل و الاقتراحات هي المخرَج';
--> statement-breakpoint
COMMENT ON TABLE "mrp_demand_lines" IS 'PHASE-043: the per-run demand snapshot — MPS + unreserved firm sales + safety-stock gap + BOM explosion + substitution (INV-030 terms) / لقطة الطلب لكل تشغيل: الجدول الرئيسي وأوامر البيع غير المحجوزة وفجوة مخزون الأمان والانفجار والبدائل';
--> statement-breakpoint
COMMENT ON TABLE "mrp_supply_lines" IS 'PHASE-043: the per-run supply snapshot — qualified on-hand (per batch, M-10 expiry-aware), reservations, open POs/MOs, inbound transfers, co-products / لقطة العرض لكل تشغيل: المتاح المؤهل لكل دفعة والمحجوزات وأوامر الشراء والإنتاج المفتوحة';
--> statement-breakpoint
COMMENT ON TABLE "mrp_suggestions" IS 'PHASE-043 (H-03/M-01/M-24): actionable suggestions — accept (idempotent conversion, INV-030/BR-079) / dismiss with reason / supersede on re-run / الاقتراحات القابلة للتنفيذ: قبول بتحويل لا يتكرر أو رفض بسبب أو إحلال عند إعادة التشغيل';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 76)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
