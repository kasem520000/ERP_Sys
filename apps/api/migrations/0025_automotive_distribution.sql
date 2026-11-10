-- PHASE-017 · migration 0025 · Industry Templates: Automotive & Distribution
--
-- Purpose (PHASE-017 §2/§4; ENTITY_CATALOG §sales/§partners/§distribution):
-- the data model for the two PHASE-017 industry templates, all additive:
-- - sales-owned: `job_cards` + `job_card_lines` (the workshop work order —
--   DRAFT → IN_PROGRESS → COMPLETED → INVOICED + CANCELLED, parts lines vs
--   labor lines, issue-mode policy, reservation/issue linkage, quotation /
--   invoice / warranty-credit-note references); `sales_invoices` gains
--   job_card_id + vehicle_id (provenance + per-vehicle history),
--   `sales_invoice_lines` gains foc_reason_code (BR-008 zero-price FOC
--   lines carry their reason), `credit_notes` gains job_card_id; the
--   commission surface — sales_reps gains commission rule columns +
--   `commission_runs` / `commission_run_lines` (accrual at run time).
-- - partners-owned: `vehicles` (per-partner registry: make/model/VIN/
--   plate/odometer) + partners.customer_tier_id (tier assignment drives
--   BR-003 resolution; the tiers themselves are distribution-owned).
-- - distribution-owned (the new module): `customer_tiers` (tier → price
--   list), `free_goods_rules` (buy-X-get-Y, per-tier, reason-coded),
--   `routes` + `route_customers` + `route_visits` (planning only — drives
--   no posting), `van_stocks` (read-model mirror of stock_moves scoped to
--   VAN warehouses, refreshed inside the owning transaction), and
--   `rep_settlements` + `rep_settlement_lines` (day-end rep settlement —
--   STL- series, variance always posts BR-021, POSTED locks the day).
-- - inventory-owned additive: warehouses gains type ('STANDARD'|'VAN') +
--   rep binding; stock_reservations holder widens with 'JOB_CARD';
--   stock_moves source widens with 'job_card'; cash_movements source
--   widens with 'rep_settlement'.
-- - chart_of_accounts_template: 2150 COMMISSION_ACCRUAL + 5250
--   COMMISSION_EXPENSE (the commission accrual journal pair, POSTING_ENGINE
--   §4 row) + the 4200 marker gains purpose SERVICE_REVENUE (labor lines —
--   additive UPDATE only where NULL; existing mappings untouched).
-- - permission seeds (AUTHORIZATION_MATRIX §3.8 distribution block +
--   feature-implied keys) + plan/role wiring (sales.job_cards + the
--   distribution set join business/enterprise — the add-on wiring).
--
-- Recorded reconciliations (documented, not silent):
-- - the docs manifest `manifest.automotive.json` pins
--   `inventory.stock_valuation` / `partners.ar_aging`; the live report
--   contract keys are `inventory.valuation` / `ar.aging` — the seeded
--   manifest pins the REAL keys (docs updated in-phase).
-- - the distribution manifest's `stock_transfer: LOD-` series entry is
--   seeded verbatim but is NOT consumed: load-outs are ordinary transfers
--   numbered by the inventory-owned TRN- series (module-owned numbering,
--   INV-021 — same precedent as retail's INV- vs the module's SAL-).
--
-- All tenant-owned tables get the PHASE-002 RLS macro.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- vehicles: the per-partner vehicle registry (T5; partners-owned).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vehicles" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "partner_id" uuid NOT NULL,
  "make" text NOT NULL,
  "model" text NOT NULL,
  "model_year" integer,
  "chassis_no" text,
  "plate_no" text,
  "color" text,
  "engine_no" text,
  "odometer_km" numeric(12,1),
  "odometer_at" date,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_vehicles PRIMARY KEY ("id"),
  CONSTRAINT uq_vehicles_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_vehicles_partner FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_vehicles_status CHECK ("status" IN ('ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_vehicles_make_shape CHECK (char_length("make") BETWEEN 1 AND 60),
  CONSTRAINT ck_vehicles_chassis_shape CHECK ("chassis_no" IS NULL OR "chassis_no" ~ '^[A-HJ-NPR-Z0-9]{6,17}$'),
  CONSTRAINT ck_vehicles_year_range CHECK ("model_year" IS NULL OR "model_year" BETWEEN 1900 AND 2100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_tenant_chassis ON "vehicles" ("tenant_id", "chassis_no") WHERE "chassis_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_vehicles_tenant_partner ON "vehicles" ("tenant_id", "partner_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_vehicles_tenant_plate ON "vehicles" ("tenant_id", "plate_no") WHERE "plate_no" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"vehicles"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- job_cards + job_card_lines (T3/T4; sales-owned workshop document).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_cards" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "card_no" text,
  "customer_id" uuid NOT NULL,
  "vehicle_id" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "parts_issue_mode" text NOT NULL DEFAULT 'reserve',
  "warehouse_id" uuid NOT NULL,
  "complaints" text,
  "complaints_ar" text,
  "diagnosis" text,
  "diagnosis_ar" text,
  "odometer_km" numeric(12,1),
  "checked_in_at" timestamptz,
  "approved_at" timestamptz,
  "completed_at" timestamptz,
  "invoiced_at" timestamptz,
  "cancelled_at" timestamptz,
  "quotation_id" uuid,
  "invoice_id" uuid,
  "credit_note_id" uuid,
  "labor_hours_total" numeric(19,6) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_job_cards PRIMARY KEY ("id"),
  CONSTRAINT uq_job_cards_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_job_cards_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_job_cards_customer FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_job_cards_vehicle FOREIGN KEY ("vehicle_id", "tenant_id")
    REFERENCES "vehicles" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_job_cards_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_job_cards_status CHECK ("status" IN ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'CANCELLED')),
  CONSTRAINT ck_job_cards_issue_mode CHECK ("parts_issue_mode" IN ('reserve', 'issue_immediate')),
  CONSTRAINT ck_job_cards_cancel_requires_reason CHECK (
    "status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "note" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_cards_tenant_card_no ON "job_cards" ("tenant_id", "card_no") WHERE "card_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_job_cards_tenant_status ON "job_cards" ("tenant_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_job_cards_tenant_vehicle ON "job_cards" ("tenant_id", "vehicle_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_job_cards_tenant_customer ON "job_cards" ("tenant_id", "customer_id", "status");
--> statement-breakpoint
ALTER TABLE "job_cards" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"job_cards"');

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_card_lines" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "job_card_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "line_type" text NOT NULL,
  "item_id" uuid NOT NULL,
  "description" text,
  "description_ar" text,
  "qty" numeric(19,6) NOT NULL,
  "unit_price" numeric(19,6) NOT NULL DEFAULT 0,
  "estimated_hours" numeric(19,6),
  "logged_hours" numeric(19,6) NOT NULL DEFAULT 0,
  "discount_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "tax_code_id" uuid,
  "status" text NOT NULL DEFAULT 'PENDING',
  "reservation_id" uuid,
  "issue_unit_cost" numeric(19,6),
  "issue_value" numeric(19,4),
  "issue_journal_id" uuid,
  "invoice_line_id" uuid,
  "note" text,
  CONSTRAINT pk_job_card_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_job_card_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_job_card_lines_card FOREIGN KEY ("job_card_id", "tenant_id")
    REFERENCES "job_cards" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_job_card_lines_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_job_card_lines_type CHECK ("line_type" IN ('PARTS', 'LABOR')),
  CONSTRAINT ck_job_card_lines_status CHECK ("status" IN ('PENDING', 'RESERVED', 'ISSUED', 'INVOICED', 'CANCELLED')),
  CONSTRAINT ck_job_card_lines_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_job_card_lines_hours CHECK ("estimated_hours" IS NULL OR "estimated_hours" >= 0),
  CONSTRAINT ck_job_card_lines_labor_hours CHECK ("line_type" <> 'LABOR' OR "estimated_hours" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_card_lines_card_line ON "job_card_lines" ("tenant_id", "job_card_id", "line_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_job_card_lines_reservation ON "job_card_lines" ("tenant_id", "reservation_id") WHERE "reservation_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_card_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"job_card_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- sales_invoices / sales_invoice_lines / credit_notes: additive provenance
-- columns (T4): the card → invoice → warranty-note chain + FOC reason.
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "job_card_id" uuid;
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "vehicle_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_job_card
  ON "sales_invoices" ("tenant_id", "job_card_id") WHERE "job_card_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_vehicle
  ON "sales_invoices" ("tenant_id", "vehicle_id") WHERE "vehicle_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD COLUMN IF NOT EXISTS "foc_reason_code" text;
--> statement-breakpoint
-- BR-008 relaxation: a FOC line is a zero-price line WITH a reason code —
-- it still issues stock and posts COGS (revenue side zero). 0018's
-- net > 0 CHECK predates the reason column; re-issued additively so
-- zero-net lines are legal exactly when reason-coded.
ALTER TABLE "sales_invoice_lines" DROP CONSTRAINT IF EXISTS ck_sales_invoice_lines_net_positive;
--> statement-breakpoint
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT ck_sales_invoice_lines_net_positive
  CHECK ("net_amount" > 0 OR "foc_reason_code" IS NOT NULL);
--> statement-breakpoint
ALTER TABLE "credit_notes" ADD COLUMN IF NOT EXISTS "job_card_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_credit_notes_tenant_job_card
  ON "credit_notes" ("tenant_id", "job_card_id") WHERE "job_card_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- customer_tiers (T11; distribution-owned) + partners.customer_tier_id.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_tiers" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "price_list_id" uuid,
  "discount_cap_pct" numeric(5,2),
  "visit_frequency_days" integer,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_customer_tiers PRIMARY KEY ("id"),
  CONSTRAINT uq_customer_tiers_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_customer_tiers_price_list FOREIGN KEY ("price_list_id", "tenant_id")
    REFERENCES "price_lists" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_customer_tiers_code_shape CHECK ("code" ~ '^[A-Za-z0-9._-]{2,30}$'),
  CONSTRAINT ck_customer_tiers_status CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT ck_customer_tiers_discount_cap CHECK ("discount_cap_pct" IS NULL OR ("discount_cap_pct" >= 0 AND "discount_cap_pct" <= 100)),
  CONSTRAINT ck_customer_tiers_visit_freq CHECK ("visit_frequency_days" IS NULL OR "visit_frequency_days" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_tiers_tenant_code ON "customer_tiers" ("tenant_id", "code");
--> statement-breakpoint
ALTER TABLE "customer_tiers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"customer_tiers"');
--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "customer_tier_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_partners_tenant_tier
  ON "partners" ("tenant_id", "customer_tier_id") WHERE "customer_tier_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- free_goods_rules (T11; distribution-owned; BR-008 reason codes).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "free_goods_rules" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "rule_type" text NOT NULL DEFAULT 'BUY_X_GET_Y',
  "buy_item_id" uuid NOT NULL,
  "buy_qty" numeric(19,6) NOT NULL,
  "get_item_id" uuid NOT NULL,
  "get_qty" numeric(19,6) NOT NULL,
  "per_multiple" boolean NOT NULL DEFAULT true,
  "max_free_per_order" numeric(19,6),
  "tier_id" uuid,
  "reason_code" text NOT NULL,
  "valid_from" date,
  "valid_to" date,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_free_goods_rules PRIMARY KEY ("id"),
  CONSTRAINT uq_free_goods_rules_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_free_goods_buy_item FOREIGN KEY ("buy_item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_free_goods_get_item FOREIGN KEY ("get_item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_free_goods_tier FOREIGN KEY ("tier_id", "tenant_id")
    REFERENCES "customer_tiers" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_free_goods_code_shape CHECK ("code" ~ '^[A-Za-z0-9._-]{2,30}$'),
  CONSTRAINT ck_free_goods_rule_type CHECK ("rule_type" IN ('BUY_X_GET_Y')),
  CONSTRAINT ck_free_goods_status CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT ck_free_goods_qty_positive CHECK ("buy_qty" > 0 AND "get_qty" > 0),
  CONSTRAINT ck_free_goods_window CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_from" <= "valid_to"),
  CONSTRAINT ck_free_goods_max_free CHECK ("max_free_per_order" IS NULL OR "max_free_per_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_free_goods_rules_tenant_code ON "free_goods_rules" ("tenant_id", "code");
--> statement-breakpoint
ALTER TABLE "free_goods_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"free_goods_rules"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- routes / route_customers / route_visits (T7; planning-only — no posting).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routes" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "sales_rep_id" uuid,
  "van_warehouse_id" uuid,
  "day_pattern" jsonb NOT NULL DEFAULT '["MON","TUE","WED","THU","FRI"]'::jsonb,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_routes PRIMARY KEY ("id"),
  CONSTRAINT uq_routes_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_routes_rep FOREIGN KEY ("sales_rep_id", "tenant_id")
    REFERENCES "sales_reps" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_routes_van FOREIGN KEY ("van_warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_routes_code_shape CHECK ("code" ~ '^[A-Za-z0-9._-]{2,30}$'),
  CONSTRAINT ck_routes_status CHECK ("status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_routes_tenant_code ON "routes" ("tenant_id", "code");
--> statement-breakpoint
ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"routes"');

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_customers" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "route_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "visit_order" integer NOT NULL DEFAULT 0,
  "is_pinned" boolean NOT NULL DEFAULT false,
  CONSTRAINT pk_route_customers PRIMARY KEY ("id"),
  CONSTRAINT uq_route_customers_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_route_customers_route FOREIGN KEY ("route_id", "tenant_id")
    REFERENCES "routes" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_route_customers_customer FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_route_customers_order CHECK ("visit_order" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_route_customers_route_customer ON "route_customers" ("tenant_id", "route_id", "customer_id");
--> statement-breakpoint
ALTER TABLE "route_customers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"route_customers"');

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "route_visits" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "route_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "planned_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'PLANNED',
  "checked_in_at" timestamptz,
  "checked_out_at" timestamptz,
  "sales_invoice_id" uuid,
  "credit_note_id" uuid,
  "receipt_id" uuid,
  "sales_rep_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_route_visits PRIMARY KEY ("id"),
  CONSTRAINT uq_route_visits_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_route_visits_route FOREIGN KEY ("route_id", "tenant_id")
    REFERENCES "routes" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_route_visits_customer FOREIGN KEY ("customer_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_route_visits_status CHECK ("status" IN ('PLANNED', 'COMPLETED', 'SKIPPED', 'MISSED'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_route_visits_tenant_date ON "route_visits" ("tenant_id", "planned_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_route_visits_tenant_route ON "route_visits" ("tenant_id", "route_id", "planned_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_route_visits_tenant_status ON "route_visits" ("tenant_id", "status", "planned_date");
--> statement-breakpoint
ALTER TABLE "route_visits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"route_visits"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- warehouses: the VAN type + rep binding (T8; inventory-owned, additive).
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "type" text NOT NULL DEFAULT 'STANDARD';
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "rep_id" uuid;
--> statement-breakpoint
ALTER TABLE "warehouses" DROP CONSTRAINT IF EXISTS ck_warehouses_type_values;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT ck_warehouses_type_values CHECK ("type" IN ('STANDARD', 'VAN'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_warehouses_tenant_type ON "warehouses" ("tenant_id", "type", "is_active");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouses_tenant_rep
  ON "warehouses" ("tenant_id", "rep_id") WHERE "rep_id" IS NOT NULL AND "type" = 'VAN';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- van_stocks: the read-model mirror (T8; distribution-owned; refreshed
-- from stock_moves inside the owning transaction — stock_moves stays the
-- source of truth; reports tie the mirror to the moves).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "van_stocks" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "warehouse_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "qty" numeric(19,6) NOT NULL DEFAULT 0,
  "value" numeric(19,4) NOT NULL DEFAULT 0,
  "refreshed_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_van_stocks PRIMARY KEY ("id"),
  CONSTRAINT uq_van_stocks_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_van_stocks_warehouse FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_van_stocks_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_van_stocks_non_negative CHECK ("qty" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_van_stocks_key ON "van_stocks"
  ("tenant_id", "warehouse_id", "item_id", COALESCE("batch_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_van_stocks_tenant_warehouse ON "van_stocks" ("tenant_id", "warehouse_id");
--> statement-breakpoint
ALTER TABLE "van_stocks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"van_stocks"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- rep_settlements + lines (T10; STL- series; variance always posts).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rep_settlements" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "settlement_no" text,
  "sales_rep_id" uuid NOT NULL,
  "van_warehouse_id" uuid,
  "shift_id" uuid,
  "settlement_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "opening_cash" numeric(19,4) NOT NULL DEFAULT 0,
  "cash_sales" numeric(19,4) NOT NULL DEFAULT 0,
  "collections" numeric(19,4) NOT NULL DEFAULT 0,
  "cash_refunds" numeric(19,4) NOT NULL DEFAULT 0,
  "rep_expenses" numeric(19,4) NOT NULL DEFAULT 0,
  "expected_cash" numeric(19,4) NOT NULL DEFAULT 0,
  "counted_cash" numeric(19,4),
  "variance" numeric(19,4),
  "variance_direction" text,
  "variance_reason" text,
  "variance_journal_id" uuid,
  "deposit_account_id" uuid,
  "deposit_amount" numeric(19,4),
  "deposit_journal_id" uuid,
  "approved_by" uuid,
  "approved_at" timestamptz,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "cancelled_at" timestamptz,
  "cancel_reason" text,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_rep_settlements PRIMARY KEY ("id"),
  CONSTRAINT uq_rep_settlements_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_rep_settlements_rep FOREIGN KEY ("sales_rep_id", "tenant_id")
    REFERENCES "sales_reps" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_rep_settlements_warehouse FOREIGN KEY ("van_warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_rep_settlements_status CHECK ("status" IN ('DRAFT', 'COUNTED', 'APPROVED', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_rep_settlements_variance_direction CHECK ("variance_direction" IN ('SHORTAGE', 'SURPLUS', 'NONE')),
  CONSTRAINT ck_rep_settlements_variance_reason CHECK ("variance_direction" IS NULL OR "variance_direction" = 'NONE' OR "variance_reason" IS NOT NULL),
  CONSTRAINT ck_rep_settlements_posted_shape CHECK (
    ("status" <> 'POSTED') OR ("posted_at" IS NOT NULL AND "variance_journal_id" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_rep_settlements_tenant_no ON "rep_settlements" ("tenant_id", "settlement_no") WHERE "settlement_no" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_rep_settlements_rep_day ON "rep_settlements" ("tenant_id", "sales_rep_id", "settlement_date") WHERE "status" <> 'CANCELLED';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_rep_settlements_tenant_status ON "rep_settlements" ("tenant_id", "status", "settlement_date");
--> statement-breakpoint
ALTER TABLE "rep_settlements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"rep_settlements"');

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rep_settlement_lines" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "settlement_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "component" text NOT NULL,
  "amount" numeric(19,4) NOT NULL,
  "source_type" text,
  "source_id" uuid,
  "description" text,
  "description_ar" text,
  CONSTRAINT pk_rep_settlement_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_rep_settlement_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_rep_settlement_lines_settlement FOREIGN KEY ("settlement_id", "tenant_id")
    REFERENCES "rep_settlements" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_rep_settlement_lines_component CHECK (
    "component" IN ('OPENING_CASH', 'CASH_SALE', 'COLLECTION', 'CASH_REFUND', 'REP_EXPENSE', 'VARIANCE', 'BANK_DEPOSIT')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_rep_settlement_lines_settlement_line ON "rep_settlement_lines" ("tenant_id", "settlement_id", "line_no");
--> statement-breakpoint
ALTER TABLE "rep_settlement_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"rep_settlement_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Commissions (T12): sales_reps rule columns + the run documents.
--> statement-breakpoint
ALTER TABLE "sales_reps" ADD COLUMN IF NOT EXISTS "commission_method" text NOT NULL DEFAULT 'NONE';
--> statement-breakpoint
ALTER TABLE "sales_reps" ADD COLUMN IF NOT EXISTS "commission_rate" numeric(7,4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "sales_reps" ADD COLUMN IF NOT EXISTS "commission_basis" text NOT NULL DEFAULT 'INVOICED';
--> statement-breakpoint
ALTER TABLE "sales_reps" ADD COLUMN IF NOT EXISTS "commission_tiers" jsonb;
--> statement-breakpoint
ALTER TABLE "sales_reps" DROP CONSTRAINT IF EXISTS ck_sales_reps_commission_method;
--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT ck_sales_reps_commission_method CHECK ("commission_method" IN ('NONE', 'PERCENTAGE'));
--> statement-breakpoint
ALTER TABLE "sales_reps" DROP CONSTRAINT IF EXISTS ck_sales_reps_commission_basis;
--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT ck_sales_reps_commission_basis CHECK ("commission_basis" IN ('INVOICED', 'COLLECTED'));
--> statement-breakpoint
ALTER TABLE "sales_reps" DROP CONSTRAINT IF EXISTS ck_sales_reps_commission_rate;
--> statement-breakpoint
ALTER TABLE "sales_reps" ADD CONSTRAINT ck_sales_reps_commission_rate CHECK ("commission_rate" >= 0 AND "commission_rate" <= 100);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_runs" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "period_from" date NOT NULL,
  "period_to" date NOT NULL,
  "basis" text NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "total_base" numeric(19,4) NOT NULL DEFAULT 0,
  "total_commission" numeric(19,4) NOT NULL DEFAULT 0,
  "journal_entry_id" uuid,
  "computed_at" timestamptz,
  "posted_at" timestamptz,
  "posted_by" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_commission_runs PRIMARY KEY ("id"),
  CONSTRAINT uq_commission_runs_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT ck_commission_runs_basis CHECK ("basis" IN ('INVOICED', 'COLLECTED')),
  CONSTRAINT ck_commission_runs_status CHECK ("status" IN ('DRAFT', 'POSTED', 'CANCELLED')),
  CONSTRAINT ck_commission_runs_period CHECK ("period_from" <= "period_to"),
  CONSTRAINT ck_commission_runs_posted_shape CHECK ("status" <> 'POSTED' OR ("posted_at" IS NOT NULL AND "journal_entry_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_commission_runs_tenant_period ON "commission_runs" ("tenant_id", "period_from", "period_to");
--> statement-breakpoint
ALTER TABLE "commission_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"commission_runs"');

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "commission_run_lines" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "run_id" uuid NOT NULL,
  "sales_rep_id" uuid NOT NULL,
  "base_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "rate_applied" numeric(7,4) NOT NULL DEFAULT 0,
  "commission_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "detail" jsonb,
  "payout_status" text NOT NULL DEFAULT 'ACCRUED',
  "payment_id" uuid,
  CONSTRAINT pk_commission_run_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_commission_run_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_commission_run_lines_run FOREIGN KEY ("run_id", "tenant_id")
    REFERENCES "commission_runs" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_commission_run_lines_rep FOREIGN KEY ("sales_rep_id", "tenant_id")
    REFERENCES "sales_reps" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_commission_run_lines_payout CHECK ("payout_status" IN ('ACCRUED', 'PAID'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_commission_run_lines_run_rep ON "commission_run_lines" ("tenant_id", "run_id", "sales_rep_id");
--> statement-breakpoint
ALTER TABLE "commission_run_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"commission_run_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Widenings (additive CHECK re-issues): reservation holders gain JOB_CARD;
-- stock moves gain the job_card source; cash movements gain rep_settlement.
--> statement-breakpoint
ALTER TABLE "stock_reservations" DROP CONSTRAINT IF EXISTS ck_stock_reservations_holder_values;
--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT ck_stock_reservations_holder_values
  CHECK ("holder_type" IN ('MANUAL', 'SALES_ORDER', 'JOB_CARD'));
--> statement-breakpoint
ALTER TABLE "stock_moves" DROP CONSTRAINT IF EXISTS ck_stock_moves_source_shape;
--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT ck_stock_moves_source_shape CHECK ("source_type" IN (
  'manual_receipt', 'manual_issue', 'stock_adjustment', 'stock_count', 'stock_transfer',
  'opening_balance_doc', 'method_switch', 'goods_receipt', 'supplier_invoice', 'landed_cost',
  'delivery_note', 'sales_invoice', 'credit_note', 'job_card'
));
--> statement-breakpoint
ALTER TABLE "cash_movements" DROP CONSTRAINT IF EXISTS ck_cash_movements_source_shape;
--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT ck_cash_movements_source_shape CHECK ("source_type" IN (
  'receipt', 'payment', 'cash_transfer', 'expense', 'shift_variance', 'sales_invoice', 'rep_settlement'
));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- chart_of_accounts_template: the commission accrual pair + the labor
-- revenue marker (additive; existing tenants map once — fail-closed
-- PURPOSE_NOT_MAPPED until then, the CARD_RECEIVABLE precedent DR-016-02).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('2150', 'Accrued commissions', 'عمولات مستحقة', 'LIABILITY', false, '2100', 'COMMISSION_ACCRUAL'),
  ('5250', 'Commissions expense', 'مصروف العمولات', 'EXPENSE', false, '5200', 'COMMISSION_EXPENSE')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";
--> statement-breakpoint
UPDATE "chart_of_accounts_template" SET "purpose_key" = 'SERVICE_REVENUE'
WHERE "code" = '4200' AND "purpose_key" IS NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Template registry seeds (T2): the two PHASE-017 manifests, verbatim from
-- docs/industries/templates/manifests/ (the two report-key reconciliations
-- above applied — inventory.valuation / ar.aging are the live contract
-- keys). Idempotent upsert on key; the 0008 index rows converge to the
-- full manifest, is_active = true, status = 'ACTIVE'.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest", "is_active", "status") VALUES
  ('industry.automotive', 'Automotive & Workshop', 'قطع الغيار والورش', '1.0.0',
   '{
  "id": "industry.automotive",
  "name": "Automotive & Workshop",
  "name_ar": "قطع الغيار والورش",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine",
    "items.barcodes",
    "items.price_lists",
    "inventory.multi_warehouse",
    "inventory.serial_tracking",
    "inventory.reservations",
    "sales.quotations",
    "sales.job_cards",
    "sales.reps",
    "treasury.cashier_shifts"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "configuration"],
  "terminology_overrides": {
    "svc.job_card": { "en": "Job card", "ar": "بطاقة عمل" },
    "fleet.vehicle": { "en": "Vehicle", "ar": "المركبة" },
    "svc.labor": { "en": "Labor", "ar": "أجور العمل" },
    "vehicle.make": { "en": "Make", "ar": "الصانع" },
    "vehicle.model": { "en": "Model", "ar": "الطراز" },
    "vehicle.chassis_no": { "en": "Chassis number (VIN)", "ar": "رقم الهيكل" },
    "vehicle.odometer": { "en": "Odometer", "ar": "عداد المسافة" },
    "svc.diagnosis": { "en": "Diagnosis", "ar": "الفحص والتشخيص" },
    "svc.technician": { "en": "Technician", "ar": "الفني" },
    "svc.service_history": { "en": "Service history", "ar": "سجل الصيانة" },
    "part.warranty": { "en": "Parts warranty", "ar": "ضمان قطع الغيار" }
  },
  "navigation_manifest": {
    "groups": [
      {
        "id": "workshop",
        "label": { "en": "Workshop", "ar": "الورشة" },
        "order": 1,
        "items": [
          { "id": "job_cards", "label": { "en": "Job cards", "ar": "بطاقات العمل" }, "target": "sales.job_cards" },
          { "id": "vehicles", "label": { "en": "Vehicles", "ar": "المركبات" }, "target": "partners.vehicles" },
          { "id": "quotes", "label": { "en": "Diagnosis quotes", "ar": "عروض التشخيص" }, "target": "sales.quotations" }
        ]
      },
      {
        "id": "parts",
        "label": { "en": "Parts", "ar": "قطع الغيار" },
        "order": 2,
        "items": [
          { "id": "parts_stock", "label": { "en": "Parts stock", "ar": "مخزون القطع" }, "target": "inventory.on_hand" },
          { "id": "purchasing", "label": { "en": "Parts purchasing", "ar": "شراء القطع" }, "target": "purchasing.orders" },
          { "id": "counter", "label": { "en": "Counter sale", "ar": "بيع الكاونتر" }, "target": "pos.counter", "feature_key": "pos.sales" }
        ]
      }
    ]
  },
  "workflow_policies": {
    "job_card_parts_issue_mode": "reserve",
    "job_card_labor_rate_source": "price_list",
    "quotation_validity_days": 7,
    "invoice_approval_required_over": 0,
    "warranty_credit_note_requires_original_invoice": true,
    "shift_variance_approval_required": true
  },
  "document_numbering_defaults": {
    "job_card": { "prefix": "JC", "format": "JC-{yyyy}-{seq:5}", "per_branch": true, "reserve_on_approval": false },
    "quotation": { "prefix": "QT", "format": "QT-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "credit_note": { "prefix": "CN", "format": "CN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "purchase_order": { "prefix": "PO", "format": "PO-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": true }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC",
    "default_track_batch": false,
    "default_track_expiry": false,
    "default_track_serial": false,
    "default_imei_tracking": false,
    "fefo_picking": false,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "automotive.job_card_profitability", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "automotive.vehicle_service_history", "pinned": true, "dashboard": false, "default_period": "custom" },
    { "report_key": "inventory.valuation", "pinned": true, "dashboard": false, "default_period": "custom" },
    { "report_key": "ar.aging", "pinned": true, "dashboard": false, "default_period": "this_month" }
  ],
  "onboarding_steps": [
    { "id": "branch_bays", "title": { "en": "Branch, workshop & bays", "ar": "الفرع والورشة والمواقف" }, "required": true },
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts (parts vs labor revenue)", "ar": "تأكيد دليل الحسابات (إيراد القطع مقابل أجور العمل)" }, "required": true },
    { "id": "labor_rates", "title": { "en": "Labor rate price lists", "ar": "قوائم أسعار أجور العمل" }, "required": true },
    { "id": "parts_catalog", "title": { "en": "Parts catalog & suppliers", "ar": "كتالوج القطع والموردون" }, "required": true },
    { "id": "opening_stock", "title": { "en": "Opening parts stock", "ar": "رصيد القطع الافتتاحي" }, "required": true },
    { "id": "vehicles", "title": { "en": "Import customer vehicles", "ar": "استيراد مركبات العملاء" }, "required": false },
    { "id": "first_job", "title": { "en": "Run a first job card end-to-end", "ar": "تنفيذ أول بطاقة عمل كاملة" }, "required": false }
  ],
  "capability_prerequisites": {
    "job_cards": { "level": "REQUIRED", "feature_keys": ["sales.job_cards"], "available_from_phase": "PHASE-017" },
    "commissions": { "level": "OPTIONAL", "feature_keys": ["sales.commissions"], "available_from_phase": "PHASE-017" },
    "barcode_pos": { "level": "OPTIONAL", "feature_keys": ["pos.terminals", "pos.sales", "pos.receipts"], "available_from_phase": "PHASE-016" },
    "service_contracts": { "level": "OPTIONAL", "feature_keys": ["crm.service_contracts"], "available_from_phase": "PHASE-019" },
    "landed_costs": { "level": "OPTIONAL", "feature_keys": ["purchasing.landed_costs"], "available_from_phase": "PHASE-011" },
    "qc_inspections": { "level": "OPTIONAL", "feature_keys": ["manufacturing.qc"], "available_from_phase": "PHASE-018" }
  }
}'::jsonb, true, 'ACTIVE'),
  (
   'industry.distribution', 'Distribution & Field Sales', 'التوزيع والمبيعات الميدانية', '1.0.0',
   '{
  "id": "industry.distribution",
  "name": "Distribution & Field Sales",
  "name_ar": "التوزيع والمبيعات الميدانية",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine",
    "distribution.routes",
    "distribution.van_stock",
    "distribution.settlements",
    "treasury.receipts_disbursements",
    "distribution.customer_tiers",
    "sales.discount_management",
    "sales.reps",
    "sales.commissions",
    "inventory.multi_warehouse",
    "inventory.stock_transfers",
    "inventory.batch_tracking",
    "treasury.cashier_shifts"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "distribution", "configuration"],
  "terminology_overrides": {
    "route.route": { "en": "Route", "ar": "خط السير" },
    "route.visit": { "en": "Visit", "ar": "الزيارة" },
    "van.van_stock": { "en": "Van stock", "ar": "مخزون السيارة" },
    "van.load_out": { "en": "Load-out", "ar": "التحميل الصباحي" },
    "van.unload": { "en": "Evening unload", "ar": "التنزيل المسائي" },
    "settlement.rep_settlement": { "en": "Rep settlement", "ar": "تسوية المندوب" },
    "settlement.variance": { "en": "Cash variance", "ar": "فرق الصندوق" },
    "billing.collection": { "en": "Collection", "ar": "التحصيل" },
    "price.tier": { "en": "Customer tier", "ar": "فئة العميل" },
    "promo.free_goods": { "en": "Free goods", "ar": "بضاعة مجانية" },
    "hr.field_rep": { "en": "Sales rep (van)", "ar": "مندوب التوزيع" }
  },
  "navigation_manifest": {
    "groups": [
      {
        "id": "field",
        "label": { "en": "Field operations", "ar": "العمليات الميدانية" },
        "order": 1,
        "items": [
          { "id": "routes", "label": { "en": "Routes & visits", "ar": "خطوط السير والزيارات" }, "target": "distribution.routes" },
          { "id": "van_stock", "label": { "en": "Van stock", "ar": "مخزون السيارة" }, "target": "distribution.van_stock" },
          { "id": "collections", "label": { "en": "Collections", "ar": "التحصيل" }, "target": "distribution.collections" }
        ]
      },
      {
        "id": "settle",
        "label": { "en": "Settlements", "ar": "التسويات" },
        "order": 2,
        "items": [
          { "id": "rep_settlements", "label": { "en": "Rep settlements", "ar": "تسويات المندوبين" }, "target": "distribution.settlements" },
          { "id": "commissions", "label": { "en": "Commissions", "ar": "العمولات" }, "target": "sales.commissions" }
        ]
      }
    ]
  },
  "workflow_policies": {
    "van_loadout_requires_transfer": true,
    "settlement_required_daily": true,
    "settlement_variance_approval_required": true,
    "collection_receipt_at_visit": true,
    "tier_price_automatic_by_partner": true,
    "credit_sale_credit_limit_enforced": true,
    "free_goods_require_reason_code": true
  },
  "document_numbering_defaults": {
    "stock_transfer": { "prefix": "LOD", "format": "LOD-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "credit_note": { "prefix": "CN", "format": "CN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "receipt": { "prefix": "RCP", "format": "RCP-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "settlement": { "prefix": "STL", "format": "STL-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC",
    "default_track_batch": true,
    "default_track_expiry": true,
    "default_track_serial": false,
    "default_imei_tracking": false,
    "fefo_picking": true,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "distribution.rep_settlement", "pinned": true, "dashboard": true, "default_period": "this_week" },
    { "report_key": "distribution.van_stock_balances", "pinned": true, "dashboard": true, "default_period": "today" },
    { "report_key": "distribution.route_visit_compliance", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "sales.discount_management_effectiveness", "pinned": true, "dashboard": false, "default_period": "this_month" },
    { "report_key": "sales.commissions_due", "pinned": true, "dashboard": false, "default_period": "this_month" }
  ],
  "onboarding_steps": [
    { "id": "main_warehouse", "title": { "en": "Main warehouse & van fleet", "ar": "المستودع الرئيسي وأسطول السيارات" }, "required": true },
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts (rep cash account)", "ar": "تأكيد دليل الحسابات (حساب نقديات المندوب)" }, "required": true },
    { "id": "reps_vans", "title": { "en": "Create reps, vans & assign routes", "ar": "إنشاء المندوبين والسيارات وإسناد خطوط السير" }, "required": true },
    { "id": "tiers", "title": { "en": "Customer tiers & price lists", "ar": "فئات العملاء وقوائم الأسعار" }, "required": true },
    { "id": "customers", "title": { "en": "Route customers with credit terms", "ar": "عملاء الخطوط وشروط الدفع" }, "required": true },
    { "id": "opening_stock", "title": { "en": "Opening stock with batches", "ar": "المخزون الافتتاحي مع الدفعات" }, "required": true },
    { "id": "first_day", "title": { "en": "Run first load-out → visits → settlement", "ar": "تنفيذ أول يوم: تحميل، زيارات، تسوية" }, "required": false }
  ],
  "capability_prerequisites": {
    "van_stock": { "level": "REQUIRED", "feature_keys": ["distribution.van_stock"], "available_from_phase": "PHASE-017" },
    "route_planning": { "level": "REQUIRED", "feature_keys": ["distribution.routes"], "available_from_phase": "PHASE-017" },
    "field_collections": { "level": "REQUIRED", "feature_keys": ["treasury.receipts_disbursements"], "available_from_phase": "PHASE-017" },
    "customer_price_tiers": { "level": "REQUIRED", "feature_keys": ["distribution.customer_tiers"], "available_from_phase": "PHASE-017" },
    "free_goods_promo": { "level": "REQUIRED", "feature_keys": ["sales.discount_management", "distribution.free_goods"], "available_from_phase": "PHASE-017" },
    "commissions": { "level": "REQUIRED", "feature_keys": ["sales.commissions"], "available_from_phase": "PHASE-017" },
    "cashier_shifts": { "level": "REQUIRED", "feature_keys": ["treasury.cashier_shifts"], "available_from_phase": "PHASE-016" },
    "expiry_tracking_fefo": { "level": "REQUIRED", "feature_keys": ["inventory.batch_tracking"], "available_from_phase": "PHASE-010" },
    "landed_costs": { "level": "OPTIONAL", "feature_keys": ["purchasing.landed_costs"], "available_from_phase": "PHASE-011" }
  }
}'::jsonb, true, 'ACTIVE')
ON CONFLICT ("key") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "version" = EXCLUDED."version", "manifest" = EXCLUDED."manifest",
      "is_active" = true, "status" = 'ACTIVE';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Permission seeds (AUTHORIZATION_MATRIX §3.8 distribution block +
-- feature-implied keys; the drift checker requires matrix ↔ seed parity —
-- 0004 already carries distribution.routes.manage / van_stock.view /
-- settlements.approve).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('sales.job_cards.manage', 'sales', 'Workshop job-card lifecycle / إدارة بطاقات العمل'),
('partners.vehicles.manage', 'partners', 'Customer vehicle registry / سجل مركبات العملاء'),
('distribution.settlements.manage', 'distribution', 'Create/count rep settlements / إدارة تسويات المناديب'),
('distribution.tiers.manage', 'distribution', 'Customer price tiers / إدارة فئات العملاء'),
('distribution.free_goods.manage', 'distribution', 'Free-goods promotion rules / إدارة قواعد السلع المجانية'),
('distribution.van_stock.manage', 'distribution', 'Van load-out/unload operations / عمليات تحميل وتنزيل سيارات التوزيع'),
('sales.commissions.manage', 'sales', 'Commission rules and runs / إدارة العمولات وتشغيلها')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Plan grants (T1; FEATURE_CATALOG §25 protocol step 3): the intake key
-- sales.job_cards + the distribution/commission set join business +
-- enterprise (the automotive/distribution add-on packs light up; business
-- additionally gains inventory.reservations — automotive's REQUIRED
-- capability chain). Idempotent array_cat.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['sales.job_cards', 'sales.commissions', 'distribution.routes',
        'distribution.van_stock', 'distribution.settlements',
        'distribution.customer_tiers', 'distribution.free_goods'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('sales.job_cards' = ANY("feature_keys"));
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['inventory.reservations'])
WHERE "key" = 'business'
  AND NOT ('inventory.reservations' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- System role-template grants (the 0005 cross-join predates the 0025
-- keys): owner gains the full set; sales gains the workshop/commission/
-- tier/FOC/settlement-create keys; warehouse gains the van operations
-- keys; accountant gains the money-adjacent approve/run keys.
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'sales.job_cards.manage', 'partners.vehicles.manage',
  'distribution.settlements.manage', 'distribution.settlements.approve',
  'distribution.tiers.manage', 'distribution.free_goods.manage',
  'distribution.van_stock.manage', 'distribution.van_stock.view',
  'sales.commissions.manage'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'sales.job_cards.manage', 'sales.commissions.manage',
  'distribution.tiers.manage', 'distribution.free_goods.manage',
  'distribution.settlements.manage'
)
WHERE r."key" = 'sales' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'distribution.van_stock.manage', 'distribution.van_stock.view',
  'distribution.routes.manage'
)
WHERE r."key" = 'warehouse' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'distribution.settlements.approve', 'sales.commissions.manage'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- Grants (erp_app writes; erp_readonly reads; erp_definer read surface).
-- route_customers + van_stocks carry DELETE (composition edits / mirror
-- rewrite); everything else is status-lifecycled (no tombstone deletes).
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "vehicles", "job_cards", "job_card_lines",
  "customer_tiers", "free_goods_rules", "routes", "route_visits",
  "rep_settlements", "rep_settlement_lines", "commission_runs",
  "commission_run_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "route_customers", "van_stocks" TO erp_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "warehouses", "partners", "sales_reps", "sales_invoices",
  "sales_invoice_lines", "credit_notes", "stock_reservations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "vehicles", "job_cards", "job_card_lines", "customer_tiers",
  "free_goods_rules", "routes", "route_customers", "route_visits", "van_stocks",
  "rep_settlements", "rep_settlement_lines", "commission_runs",
  "commission_run_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "vehicles", "job_cards", "job_card_lines", "customer_tiers",
  "free_goods_rules", "routes", "route_customers", "route_visits", "van_stocks",
  "rep_settlements", "rep_settlement_lines", "commission_runs",
  "commission_run_lines", "warehouses", "partners", "sales_reps",
  "sales_invoices", "sales_invoice_lines", "credit_notes", "stock_reservations"
  TO erp_definer;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 25)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
