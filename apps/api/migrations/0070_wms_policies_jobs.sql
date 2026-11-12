-- PHASE-044 (Blueprint v3.0 · CR-14) · migration 0070 · WMS & Inventory
-- Intelligence (part 4: transfer pricing + transit exceptions + the alert
-- jobs + warehouse kitting).
--
-- Purpose (PHASE-044 §2.13/§2.14/§2.11, I-23/I-22/I-17/I-21/I-25/I-13):
--
--   transfer_pricing_policies (I-23) — per warehouse PAIR: MARKUP % over
--     the carried cost, or a FIXED unit price (base currency). Absent row
--     = the cost-carrying default (no valuation difference, G-15's value
--     conservation). G-46 posts the explicit valuation difference at
--     receive when a policy moves the price (DR dest INVENTORY · CR
--     TRANSFER_PRICING_ADJUSTMENT for the margin).
--   transit_exceptions (I-22) — damaged / missing stock on an IN_TRANSIT
--     transfer line: the exception record + the shrinkage posting refs
--     (the existing G-13 shape: DR INVENTORY_SHRINKAGE · CR INVENTORY,
--     reasons TRANSIT_DAMAGE / TRANSIT_MISSING).
--   inventory_alert_jobs (I-17/I-21/I-25) — the shelf-life and
--     slow-movement job registration: per tenant + job_kind thresholds +
--     the last-run stats; the pg-boss sweep reads it (fail-closed to the
--     documented defaults when absent).
--   warehouse_kit_orders + warehouse_kit_lines (I-13) — light kit
--     assembly from bins WITHOUT a production order: components issue
--     from their bins (existing G-14-family issue shapes, reason
--     KIT_CONSUMPTION), the kit item receipts at Σ component costs
--     EXACTLY (the G-45 roll-up — same-account by construction: the
--     policy-none G-15 mirror, no journal unless accounts differ, which
--     one warehouse cannot — the documented D-4).
--
-- CoA markers (§8): 1290 QUARANTINE_INVENTORY (the G-43 distinct-account
-- policy leg), 2135 CONSIGNATION_PAYABLE (the G-44 settlement leg), 4990
-- TRANSFER_PRICING_ADJUSTMENT (the G-46 margin leg) — the 0026/0065
-- additive-marker pattern; existing tenants map once, fail-closed
-- PURPOSE_NOT_MAPPED until then (G-43/G-44 post only when mapped — the
-- policy gate, BR-077).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. transfer_pricing_policies (§2.13, I-23): per warehouse pair — one
--    row per (from, to) direction (the transfer is directional).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transfer_pricing_policies" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "from_warehouse_id" uuid NOT NULL,
  "to_warehouse_id" uuid NOT NULL,
  "mode" text NOT NULL,
  "markup_pct" numeric(7, 4),
  "fixed_price" numeric(19, 6),
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_transfer_pricing_policies" PRIMARY KEY ("id"),
  CONSTRAINT "uq_transfer_pricing_policies_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_transfer_pricing_policies_pair" UNIQUE ("tenant_id", "from_warehouse_id", "to_warehouse_id"),
  CONSTRAINT "ck_transfer_pricing_policies_mode" CHECK ("mode" IN ('MARKUP', 'FIXED')),
  -- Mode carries exactly its operand (the pair-or-neither floor).
  CONSTRAINT "ck_transfer_pricing_policies_operand" CHECK (
    ("mode" = 'MARKUP' AND "markup_pct" IS NOT NULL AND "fixed_price" IS NULL) OR
    ("mode" = 'FIXED' AND "fixed_price" IS NOT NULL AND "markup_pct" IS NULL)
  ),
  CONSTRAINT "ck_transfer_pricing_policies_markup" CHECK (
    "markup_pct" IS NULL OR ("markup_pct" >= 0 AND "markup_pct" <= 1000)
  ),
  CONSTRAINT "ck_transfer_pricing_policies_price" CHECK (
    "fixed_price" IS NULL OR "fixed_price" >= 0
  )
);

--> statement-breakpoint
ALTER TABLE "transfer_pricing_policies"
  ADD CONSTRAINT "fk_transfer_pricing_from_wh"
  FOREIGN KEY ("from_warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "transfer_pricing_policies"
  ADD CONSTRAINT "fk_transfer_pricing_to_wh"
  FOREIGN KEY ("to_warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. transit_exceptions (§2.13, I-22): the damaged/missing record on an
--    in-transit transfer line. The posting refs prove the shrinkage leg.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transit_exceptions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "transfer_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "exception_kind" text NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "journal_id" uuid,
  "move_id" uuid,
  "resolved_at" timestamptz,
  "resolved_by" uuid,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_transit_exceptions" PRIMARY KEY ("id"),
  CONSTRAINT "uq_transit_exceptions_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_transit_exceptions_kind" CHECK ("exception_kind" IN ('DAMAGE', 'MISSING')),
  CONSTRAINT "ck_transit_exceptions_qty" CHECK ("qty" > 0),
  -- Resolved carries its evidence (the state-evidence floor).
  CONSTRAINT "ck_transit_exceptions_state_evidence" CHECK (
    ("resolved_at" IS NULL) = ("journal_id" IS NULL)
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_transit_exceptions_tenant_transfer"
  ON "transit_exceptions" ("tenant_id", "transfer_id");

--> statement-breakpoint
ALTER TABLE "transit_exceptions"
  ADD CONSTRAINT "fk_transit_exceptions_transfer"
  FOREIGN KEY ("transfer_id", "tenant_id") REFERENCES "stock_transfers" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. inventory_alert_jobs (§2.13, I-17/I-21/I-25): the job registration —
--    per tenant + kind thresholds; the sweep emits notifications through
--    the existing center and stamps the run stats here.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inventory_alert_jobs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "job_kind" text NOT NULL,
  "shelf_life_days" integer NOT NULL DEFAULT 14,
  "slow_movement_days" integer NOT NULL DEFAULT 90,
  "is_active" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamptz,
  "last_flagged" integer NOT NULL DEFAULT 0,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_inventory_alert_jobs" PRIMARY KEY ("id"),
  CONSTRAINT "uq_inventory_alert_jobs_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_inventory_alert_jobs_tenant_kind" UNIQUE ("tenant_id", "job_kind"),
  CONSTRAINT "ck_inventory_alert_jobs_kind" CHECK ("job_kind" IN ('SHELF_LIFE', 'SLOW_MOVEMENT')),
  CONSTRAINT "ck_inventory_alert_jobs_days" CHECK (
    "shelf_life_days" >= 1 AND "slow_movement_days" >= 1
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_inventory_alert_jobs_tenant_active"
  ON "inventory_alert_jobs" ("tenant_id", "is_active");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. warehouse_kit_orders + warehouse_kit_lines (§2.11, I-13): light kit
--    assembly. WK- number at post; total_component_cost is the Σ roll-up
--    (G-45: the kit layer at Σ component costs EXACTLY).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_kit_orders" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "kit_no" text,
  "warehouse_id" uuid NOT NULL,
  "kit_item_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "uom_id" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_component_cost" numeric(19, 4),
  "posted_journal_id" uuid,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "note" text,
  "note_ar" text,
  "created_by" uuid,
  CONSTRAINT "pk_warehouse_kit_orders" PRIMARY KEY ("id"),
  CONSTRAINT "uq_warehouse_kit_orders_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_warehouse_kit_orders_tenant_kit_no" UNIQUE ("tenant_id", "kit_no"),
  CONSTRAINT "ck_warehouse_kit_orders_status" CHECK (
    "status" IN ('DRAFT', 'POSTED', 'CANCELLED')
  ),
  CONSTRAINT "ck_warehouse_kit_orders_qty" CHECK ("qty" > 0),
  CONSTRAINT "ck_warehouse_kit_orders_state_evidence" CHECK (
    ("status" = 'POSTED') = ("kit_no" IS NOT NULL AND "posted_at" IS NOT NULL)
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warehouse_kit_orders_tenant_wh_status"
  ON "warehouse_kit_orders" ("tenant_id", "warehouse_id", "status");

--> statement-breakpoint
ALTER TABLE "warehouse_kit_orders"
  ADD CONSTRAINT "fk_warehouse_kit_orders_warehouse"
  FOREIGN KEY ("warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "warehouse_kit_orders"
  ADD CONSTRAINT "fk_warehouse_kit_orders_item"
  FOREIGN KEY ("kit_item_id", "tenant_id") REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_kit_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "order_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "component_item_id" uuid NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "unit_cost" numeric(19, 6),
  "value_amount" numeric(19, 4),
  "from_bin_id" uuid,
  "created_by" uuid,
  CONSTRAINT "pk_warehouse_kit_lines" PRIMARY KEY ("id"),
  CONSTRAINT "uq_warehouse_kit_lines_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_warehouse_kit_lines_doc_line" UNIQUE ("tenant_id", "order_id", "line_no"),
  CONSTRAINT "ck_warehouse_kit_lines_line_no" CHECK ("line_no" >= 1),
  CONSTRAINT "ck_warehouse_kit_lines_qty" CHECK ("qty" > 0)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_warehouse_kit_lines_tenant_doc"
  ON "warehouse_kit_lines" ("tenant_id", "order_id");

--> statement-breakpoint
ALTER TABLE "warehouse_kit_lines"
  ADD CONSTRAINT "fk_warehouse_kit_lines_order"
  FOREIGN KEY ("order_id", "tenant_id") REFERENCES "warehouse_kit_orders" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "warehouse_kit_lines"
  ADD CONSTRAINT "fk_warehouse_kit_lines_item"
  FOREIGN KEY ("component_item_id", "tenant_id") REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "warehouse_kit_lines"
  ADD CONSTRAINT "fk_warehouse_kit_lines_bin"
  FOREIGN KEY ("from_bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. CoA template markers (the 0026/0065 additive pattern): the three
--    policy legs — 1290 QUARANTINE_INVENTORY (G-43), 2135
--    CONSIGNATION_PAYABLE (G-44), 4990 TRANSFER_PRICING_ADJUSTMENT
--    (G-46). Existing tenants map once; G-43/G-44 post ONLY when mapped
--    (the policy gate — the G-15 distinct-account mirror, BR-077).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('1290', 'Quarantine inventory', 'مخزون تحت الفحص', 'ASSET', false, '1100', 'QUARANTINE_INVENTORY'),
  ('2135', 'Consignment payable', 'أمانة الموردين (دائنون)', 'LIABILITY', false, '2100', 'CONSIGNATION_PAYABLE'),
  ('4990', 'Transfer pricing adjustment', 'تسعير التحويلات الداخلية', 'REVENUE', false, '4000', 'TRANSFER_PRICING_ADJUSTMENT')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS — the house triple for the six new tables.
--> statement-breakpoint
ALTER TABLE "transfer_pricing_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transfer_pricing_policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"transfer_pricing_policies"');
--> statement-breakpoint
ALTER TABLE "transit_exceptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transit_exceptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"transit_exceptions"');
--> statement-breakpoint
ALTER TABLE "inventory_alert_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inventory_alert_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"inventory_alert_jobs"');
--> statement-breakpoint
ALTER TABLE "warehouse_kit_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warehouse_kit_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"warehouse_kit_orders"');
--> statement-breakpoint
ALTER TABLE "warehouse_kit_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warehouse_kit_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"warehouse_kit_lines"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'transfer_pricing_policies', 'transit_exceptions', 'inventory_alert_jobs',
    'warehouse_kit_orders', 'warehouse_kit_lines'
  ] LOOP
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
-- 7. Grants.
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "transfer_pricing_policies" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "transfer_pricing_policies" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "transfer_pricing_policies" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "transit_exceptions" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "transit_exceptions" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "transit_exceptions" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "inventory_alert_jobs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "inventory_alert_jobs" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "inventory_alert_jobs" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "warehouse_kit_orders" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "warehouse_kit_orders" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "warehouse_kit_orders" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "warehouse_kit_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "warehouse_kit_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "warehouse_kit_lines" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 70)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
