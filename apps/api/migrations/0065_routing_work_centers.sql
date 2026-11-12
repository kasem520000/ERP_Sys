-- PHASE-042 (Blueprint v3.0 · CR-12) · migration 0065 · Manufacturing I —
-- Routing, Work Centers & Costing (part 1: the execution substrate).
--
-- Purpose (PHASE-042 §2): production orders stop being one-shot
-- "consume materials → produce item" documents and become multi-operation
-- shop-floor documents executed against routings on work centers:
--
--   work_centers (M-03/H-04) — where product flows: per-shift capacity
--     (hours), fixed/var cost rates per hour in base currency, status, and
--     the cost-center analytics link.
--   routings + routing_operations (M-02) — versioned per item (exactly one
--     ACTIVE, the BOM discipline): sequenced operations carrying setup/run
--     times, the work center, optional per-operation rate overrides, and
--     the inspection hook reserved for PHASE-050.
--   production_orders extension (M-02/M-17) — additive columns only:
--     routing_id + current_operation (NULL = routing-less legacy mode; the
--     dual-mode decision — routing-less orders keep the flat-rate path).
--   production_order_operations (M-02/M-17/M-18) — the per-order frozen
--     operation rows: the PENDING/SETUP/RUNNING/PAUSED/COMPLETED/SKIPPED
--     state machine (skip requires approval + reason), actual setup/run
--     times, operator, and the per-operation variance columns (M-13/M-19)
--     computed at completion against the frozen routing standard.
--   rework_orders (M-14) — reference the defective batch/serial + parent
--     production order, carry their own routing; the cost roll-up posts to
--     REWORK_EXPENSE — never capitalized into the parent FG layer.
--   downtime_records (M-15) — work center, reason code (closed vocabulary),
--     duration, linked order/operation: the OEE availability input and the
--     non-value-added cost source (posting is policy-gated, default OFF).
--   v_work_center_oee_daily + v_work_center_oee_period (M-16) — derived
--     views ONLY (availability × performance × quality from operation
--     records + downtime records); no new source-of-truth tables.
--
-- Numbering note (the 0060/0064 pattern): the phase doc planned
-- "≈ 0060…0066" written before PHASE-039 (0055–0059), PHASE-040
-- (0060–0063) and PHASE-041 (0064); this migration is therefore 0065
-- (journal idx 64, schema_version 65), with the standard-costing layer in
-- 0066. Likewise the doc's rule/golden/invariant counters are stale:
-- BR-057…060 → BR-068…071, G-38/39/40 → G-40/41/42 (039 took G-35…39),
-- INV-027 → INV-028 (037 took INV-027), and the doc's
-- "manufacturing.costing" key is already live as manufacturing.costing.read
-- (0026) — the new keys are the SIX below (272 → 278).
--
-- INV-022 ledger: +6 tables (work_centers, routings, routing_operations,
-- production_order_operations, rework_orders, downtime_records;
-- ENTITY_CATALOG 232 → 239 with 0066's item_standard_costs), +2 documented
-- views, +6 permissions (272 → 278, matrix §3.20), +6 feature keys
-- (0066's seed section, with the template-manifest enablement), +2 CoA
-- purposes (5125 REWORK_EXPENSE, 5430 DOWNTIME_EXPENSE — the 0026 additive
-- marker pattern; existing tenants map once, fail-closed
-- PURPOSE_NOT_MAPPED until then), +2 journal goldens registered in docs
-- (G-40 operation WIP, G-41 rework — JOURNAL_RULES §7) + G-42 (downtime,
-- 0066 lands the policy plumbing).
--
-- Grants: work_centers/routings/routing_operations are master data
-- (SELECT/INSERT/UPDATE — status lifecycles, no tombstone deletes);
-- production_order_operations/rework_orders are document rows
-- (SELECT/INSERT/UPDATE); downtime_records is a log (SELECT/INSERT/UPDATE;
-- edits by the logging discipline, DELETE rides the purge path only).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. work_centers (§2.1, M-03/H-04): the shop-floor capacity + rate datum.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_centers" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "description" text,
  -- Capacity is HOURS per shift (the denominator shared with setup/run
  -- times and the per-hour rates); shifts_per_day scales it to the day.
  "capacity_per_shift" numeric(7, 2) NOT NULL DEFAULT 8,
  "shifts_per_day" smallint NOT NULL DEFAULT 1,
  "fixed_cost_rate" numeric(19, 6) NOT NULL DEFAULT 0,
  "var_cost_rate" numeric(19, 6) NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "cost_center_id" uuid,
  "created_by" uuid,
  CONSTRAINT "pk_work_centers" PRIMARY KEY ("id"),
  CONSTRAINT "uq_work_centers_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_work_centers_tenant_code" UNIQUE ("tenant_id", "code"),
  CONSTRAINT "ck_work_centers_code_shape" CHECK ("code" ~ '^[A-Za-z][A-Za-z0-9_-]{1,39}$'),
  CONSTRAINT "ck_work_centers_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "ck_work_centers_capacity" CHECK (
    "capacity_per_shift" > 0 AND "capacity_per_shift" <= 24
  ),
  CONSTRAINT "ck_work_centers_shifts" CHECK (
    "shifts_per_day" >= 1 AND "shifts_per_day" <= 6
  ),
  -- Rates are non-negative costs per hour (0 = uncosted capacity).
  CONSTRAINT "ck_work_centers_rates" CHECK (
    "fixed_cost_rate" >= 0 AND "var_cost_rate" >= 0
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_work_centers_tenant_status"
  ON "work_centers" ("tenant_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. routings (§2.2, M-02): versioned per item — DRAFT → ACTIVE → ARCHIVED
--    with exactly one ACTIVE per item (the BOM discipline).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routings" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "item_id" uuid NOT NULL,
  "version_no" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "output_uom_id" uuid NOT NULL,
  "note" text,
  "note_ar" text,
  "activated_at" timestamptz,
  "archived_at" timestamptz,
  "created_by" uuid,
  CONSTRAINT "pk_routings" PRIMARY KEY ("id"),
  CONSTRAINT "uq_routings_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_routings_tenant_item_version" UNIQUE ("tenant_id", "item_id", "version_no"),
  CONSTRAINT "ck_routings_status" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  CONSTRAINT "ck_routings_version_no" CHECK ("version_no" >= 1),
  CONSTRAINT "fk_routings_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_routings_uom" FOREIGN KEY ("output_uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
-- Exactly one ACTIVE routing per item (the BOM discipline — the 0026
-- uq_bills_of_materials_active_item pattern).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_routings_active_item"
  ON "routings" ("tenant_id", "item_id") WHERE "status" = 'ACTIVE';

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_routings_tenant_status"
  ON "routings" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_routings_tenant_item"
  ON "routings" ("tenant_id", "item_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. routing_operations (§2.2, M-02): sequenced operations on the routing —
--    setup_time is hours per batch, run_time is hours per unit; the rate
--    overrides are NULL = inherit the work center's rates.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "routing_operations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "routing_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "work_center_id" uuid NOT NULL,
  "setup_time" numeric(19, 6) NOT NULL DEFAULT 0,
  "run_time" numeric(19, 6) NOT NULL DEFAULT 0,
  "fixed_cost_rate" numeric(19, 6),
  "var_cost_rate" numeric(19, 6),
  "description" text,
  "description_ar" text,
  -- Reserved for PHASE-050 quality gates at operations.
  "inspection_hook" boolean NOT NULL DEFAULT false,
  "created_by" uuid,
  CONSTRAINT "pk_routing_operations" PRIMARY KEY ("id"),
  CONSTRAINT "uq_routing_operations_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_routing_operations_routing_sequence" UNIQUE ("tenant_id", "routing_id", "sequence"),
  CONSTRAINT "ck_routing_operations_sequence" CHECK ("sequence" >= 1 AND "sequence" <= 999),
  CONSTRAINT "ck_routing_operations_times" CHECK (
    "setup_time" >= 0 AND "run_time" >= 0
  ),
  -- Rate overrides travel together and are non-negative when present.
  CONSTRAINT "ck_routing_operations_rate_overrides" CHECK (
    ("fixed_cost_rate" IS NULL AND "var_cost_rate" IS NULL)
    OR ("fixed_cost_rate" IS NOT NULL AND "fixed_cost_rate" >= 0
        AND "var_cost_rate" IS NOT NULL AND "var_cost_rate" >= 0)
  ),
  CONSTRAINT "fk_routing_operations_routing" FOREIGN KEY ("routing_id", "tenant_id")
    REFERENCES "routings" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_routing_operations_work_center" FOREIGN KEY ("work_center_id", "tenant_id")
    REFERENCES "work_centers" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_routing_operations_tenant_work_center"
  ON "routing_operations" ("tenant_id", "work_center_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. production_orders extension (§2.3, M-02/M-17): additive columns ONLY
--    (the 0062 additive precedent — zero reshape, legacy orders unaffected).
--    routing_id NULL = the legacy flat-rate path (dual mode, documented);
--    current_operation = the routing sequence of the active operation
--    (NULL = not started or routing-less).
--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "routing_id" uuid;
--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "current_operation" integer;
--> statement-breakpoint
ALTER TABLE "production_orders"
  ADD CONSTRAINT "fk_production_orders_routing" FOREIGN KEY ("routing_id", "tenant_id")
    REFERENCES "routings" ("id", "tenant_id") ON DELETE RESTRICT NOT VALID;
--> statement-breakpoint
ALTER TABLE "production_orders"
  ADD CONSTRAINT "ck_production_orders_current_operation" CHECK (
    "current_operation" IS NULL OR "current_operation" >= 1
  ) NOT VALID;
--> statement-breakpoint
COMMENT ON COLUMN "production_orders"."routing_id" IS 'PHASE-042 (M-02): the bound routing (NULL = the legacy flat-rate dual mode); frozen at release';
--> statement-breakpoint
COMMENT ON COLUMN "production_orders"."current_operation" IS 'PHASE-042 (M-17): the routing sequence of the active operation; NULL = not started or routing-less';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. production_order_operations (§2.3, M-02/M-17/M-18/M-13/M-19): the
--    per-order frozen operation rows + the state machine + the actual-time
--    capture + the per-operation variance columns (setup/usage/rate),
--    computed at completion against the frozen standard columns below.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_order_operations" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "order_id" uuid NOT NULL,
  "routing_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "work_center_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  -- The frozen standard (from the routing + work center at release — the
  -- snapshot discipline; later routing edits never move a live order).
  "std_setup_time" numeric(19, 6) NOT NULL DEFAULT 0,
  "std_run_time" numeric(19, 6) NOT NULL DEFAULT 0,
  "std_fixed_rate" numeric(19, 6) NOT NULL DEFAULT 0,
  "std_var_rate" numeric(19, 6) NOT NULL DEFAULT 0,
  -- The actuals (captured at the terminal / scan points).
  "actual_setup_time" numeric(19, 6) NOT NULL DEFAULT 0,
  "actual_run_time" numeric(19, 6) NOT NULL DEFAULT 0,
  -- The per-operation variance columns (M-13/M-19), computed at completion:
  -- setup = (actual_setup − std_setup) × rates; usage = (actual_run −
  -- std_run × qty) × rate; rate = (actual_rate − std_rate) × actual_time.
  "setup_variance" numeric(19, 4) NOT NULL DEFAULT 0,
  "usage_variance" numeric(19, 4) NOT NULL DEFAULT 0,
  "rate_variance" numeric(19, 4) NOT NULL DEFAULT 0,
  "operator_user_id" uuid,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  -- Operation-level statistical scrap (M-12) with reason codes.
  "scrap_qty" numeric(19, 6) NOT NULL DEFAULT 0,
  "scrap_reason_code" text,
  "skip_reason" text,
  "skip_approved_by" uuid,
  -- The G-40 operation-completion WIP posting.
  "journal_id" uuid,
  "created_by" uuid,
  CONSTRAINT "pk_production_order_operations" PRIMARY KEY ("id"),
  CONSTRAINT "uq_production_order_operations_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_production_order_operations_order_sequence" UNIQUE ("tenant_id", "order_id", "sequence"),
  CONSTRAINT "ck_production_order_operations_status" CHECK (
    "status" IN ('PENDING', 'SETUP', 'RUNNING', 'PAUSED', 'COMPLETED', 'SKIPPED')
  ),
  CONSTRAINT "ck_production_order_operations_sequence" CHECK (
    "sequence" >= 1 AND "sequence" <= 999
  ),
  CONSTRAINT "ck_production_order_operations_times" CHECK (
    "std_setup_time" >= 0 AND "std_run_time" >= 0
      AND "std_fixed_rate" >= 0 AND "std_var_rate" >= 0
      AND "actual_setup_time" >= 0 AND "actual_run_time" >= 0
  ),
  CONSTRAINT "ck_production_order_operations_scrap" CHECK (
    "scrap_qty" >= 0
      AND ("scrap_qty" = 0 OR "scrap_reason_code" IS NOT NULL)
  ),
  -- SKIPPED carries its approval evidence; terminal states carry their
  -- timestamps; PENDING/SETUP/RUNNING/PAUSED are pre-completion.
  CONSTRAINT "ck_production_order_operations_state_evidence" CHECK (
    ("status" = 'SKIPPED' AND "skip_reason" IS NOT NULL AND "skip_approved_by" IS NOT NULL)
    OR ("status" = 'COMPLETED' AND "finished_at" IS NOT NULL AND "started_at" IS NOT NULL)
    OR ("status" IN ('SETUP', 'RUNNING', 'PAUSED') AND "started_at" IS NOT NULL)
    OR ("status" = 'PENDING' AND "started_at" IS NULL AND "finished_at" IS NULL)
  ),
  CONSTRAINT "fk_production_order_operations_order" FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "production_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_production_order_operations_routing" FOREIGN KEY ("routing_id", "tenant_id")
    REFERENCES "routings" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_production_order_operations_work_center" FOREIGN KEY ("work_center_id", "tenant_id")
    REFERENCES "work_centers" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
-- The shop-floor terminal scan path (OA-06 hot path): the order's live ops.
CREATE INDEX IF NOT EXISTS "ix_production_order_operations_order"
  ON "production_order_operations" ("tenant_id", "order_id", "status");
--> statement-breakpoint
-- The OEE availability/performance fold + the utilization report.
CREATE INDEX IF NOT EXISTS "ix_production_order_operations_work_center"
  ON "production_order_operations" ("tenant_id", "work_center_id", "started_at");
--> statement-breakpoint
-- The variance report path (per-operation variance rollups).
CREATE INDEX IF NOT EXISTS "ix_production_order_operations_variance"
  ON "production_order_operations" ("tenant_id", "sequence", "setup_variance");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. rework_orders (§2.6, M-14): reference the defective batch/serial and
--    the parent production order; carry their own routing; the completion
--    posts the conversion roll-up to REWORK_EXPENSE — never capitalized
--    into the parent finished-goods layer (BR-069).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rework_orders" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "rework_no" text,
  "parent_order_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "defect_ref" text NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "uom_id" uuid NOT NULL,
  "routing_id" uuid,
  "status" text NOT NULL DEFAULT 'DRAFT',
  -- The frozen routing standard + the actuals (captured at completion).
  "std_setup_time" numeric(19, 6) NOT NULL DEFAULT 0,
  "std_run_time" numeric(19, 6) NOT NULL DEFAULT 0,
  "std_fixed_rate" numeric(19, 6) NOT NULL DEFAULT 0,
  "std_var_rate" numeric(19, 6) NOT NULL DEFAULT 0,
  "actual_setup_time" numeric(19, 6) NOT NULL DEFAULT 0,
  "actual_run_time" numeric(19, 6) NOT NULL DEFAULT 0,
  -- The conversion cost roll-up (G-41): labor + overhead legs.
  "labor_value" numeric(19, 4) NOT NULL DEFAULT 0,
  "overhead_value" numeric(19, 4) NOT NULL DEFAULT 0,
  "rework_value" numeric(19, 4) NOT NULL DEFAULT 0,
  "journal_id" uuid,
  "defect_reason_code" text,
  "note" text,
  "note_ar" text,
  "released_at" timestamptz,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  "cancel_reason" text,
  "created_by" uuid,
  CONSTRAINT "pk_rework_orders" PRIMARY KEY ("id"),
  CONSTRAINT "uq_rework_orders_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_rework_orders_status" CHECK (
    "status" IN ('DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  ),
  CONSTRAINT "ck_rework_orders_qty" CHECK ("qty" > 0),
  CONSTRAINT "ck_rework_orders_defect_ref" CHECK (
    char_length("defect_ref") BETWEEN 1 AND 120
  ),
  CONSTRAINT "ck_rework_orders_times" CHECK (
    "std_setup_time" >= 0 AND "std_run_time" >= 0
      AND "std_fixed_rate" >= 0 AND "std_var_rate" >= 0
      AND "actual_setup_time" >= 0 AND "actual_run_time" >= 0
  ),
  -- Completion evidence: the roll-up and its journal travel together.
  CONSTRAINT "ck_rework_orders_completion" CHECK (
    ("status" <> 'COMPLETED')
    OR ("completed_at" IS NOT NULL AND "journal_id" IS NOT NULL AND "rework_value" > 0)
  ),
  CONSTRAINT "fk_rework_orders_parent" FOREIGN KEY ("parent_order_id", "tenant_id")
    REFERENCES "production_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_rework_orders_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_rework_orders_batch" FOREIGN KEY ("batch_id", "tenant_id")
    REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_rework_orders_uom" FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_rework_orders_routing" FOREIGN KEY ("routing_id", "tenant_id")
    REFERENCES "routings" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
-- One number per tenant once assigned (the production_orders
-- uq_production_orders_tenant_no pattern — partial unique, NULLs allowed
-- for DRAFT rows before numbering).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_rework_orders_tenant_no"
  ON "rework_orders" ("tenant_id", "rework_no") WHERE "rework_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_rework_orders_tenant_status"
  ON "rework_orders" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_rework_orders_tenant_parent"
  ON "rework_orders" ("tenant_id", "parent_order_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. downtime_records (§2.7, M-15): the OEE availability input + the
--    non-value-added cost source. Posting is policy-gated (BR-070, default
--    OFF — record-only); the closed reason vocabulary is the log floor.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "downtime_records" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "work_center_id" uuid NOT NULL,
  "order_id" uuid,
  "operation_sequence" integer,
  "reason_code" text NOT NULL,
  "started_at" timestamptz NOT NULL,
  "ended_at" timestamptz,
  "duration_minutes" integer NOT NULL,
  -- The non-value cost estimate (rates × hours) when computed/posted.
  "cost_amount" numeric(19, 4),
  "journal_id" uuid,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_downtime_records" PRIMARY KEY ("id"),
  CONSTRAINT "uq_downtime_records_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_downtime_records_reason" CHECK ("reason_code" IN (
    'PLAN_SETUP', 'BREAKDOWN', 'MAINTENANCE', 'MATERIAL_SHORTAGE',
    'QUALITY_HOLD', 'POWER_OUTAGE', 'CHANGEOVER', 'OPERATOR_ABSENT', 'OTHER'
  )),
  CONSTRAINT "ck_downtime_records_duration" CHECK (
    "duration_minutes" >= 0 AND "duration_minutes" <= 1440
  ),
  -- Open records carry no end; closed records end at/after the start and
  -- their duration is the elapsed minutes.
  CONSTRAINT "ck_downtime_records_window" CHECK (
    ("ended_at" IS NULL AND "journal_id" IS NULL AND "cost_amount" IS NULL)
    OR ("ended_at" IS NOT NULL AND "ended_at" >= "started_at")
  ),
  -- The order link is the (order, sequence) pair or neither.
  CONSTRAINT "ck_downtime_records_link_shape" CHECK (
    ("order_id" IS NULL AND "operation_sequence" IS NULL)
    OR ("order_id" IS NOT NULL AND "operation_sequence" IS NOT NULL)
  ),
  CONSTRAINT "fk_downtime_records_work_center" FOREIGN KEY ("work_center_id", "tenant_id")
    REFERENCES "work_centers" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_downtime_records_order" FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "production_orders" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
-- The OEE availability fold + the downtime-analysis report.
CREATE INDEX IF NOT EXISTS "ix_downtime_records_work_center"
  ON "downtime_records" ("tenant_id", "work_center_id", "started_at");
--> statement-breakpoint
-- The order-linked downtime path (the terminal's live view).
CREATE INDEX IF NOT EXISTS "ix_downtime_records_order"
  ON "downtime_records" ("tenant_id", "order_id")
  WHERE "order_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. OEE computed views (§2.8, M-16): derived facts ONLY — availability ×
--    performance × quality from operation records + downtime records (the
--    statistical-scrap floor; the PHASE-050 inspection hook extends the
--    quality leg later). security_invoker so RLS applies through them
--    (views are NOT in the tables registry — no source-of-truth rows).
--> statement-breakpoint
CREATE OR REPLACE VIEW "v_work_center_oee_daily" WITH (security_invoker = true) AS
SELECT
  o."tenant_id",
  o."work_center_id",
  date(o."started_at") AS "day",
  COALESCE(SUM(o."std_setup_time" + o."std_run_time"), 0) AS "planned_hours",
  COALESCE(SUM(o."actual_setup_time" + o."actual_run_time"), 0) AS "actual_hours",
  COALESCE(SUM(o."scrap_qty"), 0) AS "scrap_qty",
  COUNT(*) FILTER (WHERE o."status" = 'COMPLETED') AS "completed_operations",
  COUNT(*) FILTER (WHERE o."status" = 'SKIPPED') AS "skipped_operations",
  COUNT(*) AS "total_operations",
  COALESCE(dt."downtime_minutes", 0) AS "downtime_minutes"
FROM "production_order_operations" o
LEFT JOIN LATERAL (
  SELECT SUM(x."duration_minutes") AS "downtime_minutes"
  FROM "downtime_records" x
  WHERE x."tenant_id" = o."tenant_id"
    AND x."work_center_id" = o."work_center_id"
    AND date(x."started_at") = date(o."started_at")
) dt ON true
WHERE o."started_at" IS NOT NULL
GROUP BY o."tenant_id", o."work_center_id", date(o."started_at"), dt."downtime_minutes";

--> statement-breakpoint
-- The period view folds the daily operation metrics and derives the
-- month's downtime INDEPENDENTLY from downtime_records (a day with zero
-- operation rows still contributes its downtime to the month total — the
-- daily view only materializes days the work center operated). The inner
-- derived table lifts period_start to a plain column first: PostgreSQL
-- does not match outer-reference expressions inside subqueries against
-- the outer GROUP BY, but plain grouped columns are legal outer refs.
CREATE OR REPLACE VIEW "v_work_center_oee_period" WITH (security_invoker = true) AS
SELECT
  p."tenant_id",
  p."work_center_id",
  p."period_start",
  SUM(p."planned_hours") AS "planned_hours",
  SUM(p."actual_hours") AS "actual_hours",
  SUM(p."scrap_qty") AS "scrap_qty",
  SUM(p."completed_operations") AS "completed_operations",
  SUM(p."skipped_operations") AS "skipped_operations",
  SUM(p."total_operations") AS "total_operations",
  COALESCE((
    SELECT SUM(x."duration_minutes")
    FROM "downtime_records" x
    WHERE x."tenant_id" = p."tenant_id"
      AND x."work_center_id" = p."work_center_id"
      AND x."started_at" >= p."period_start"
      AND x."started_at" < p."period_start" + interval '1 month'
  ), 0) AS "downtime_minutes"
FROM (
  SELECT
    "tenant_id",
    "work_center_id",
    date_trunc('month', "day") AS "period_start",
    "planned_hours",
    "actual_hours",
    "scrap_qty",
    "completed_operations",
    "skipped_operations",
    "total_operations"
  FROM "v_work_center_oee_daily"
) p
GROUP BY p."tenant_id", p."work_center_id", p."period_start";
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. RLS — the house triple (apply_tenant_policy + the purge path) for all
--    six new tables (production_orders keeps its existing policies; the
--    two views are security_invoker over RLS tables).
--> statement-breakpoint
ALTER TABLE "work_centers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "work_centers" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"work_centers"');
--> statement-breakpoint
ALTER TABLE "routings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "routings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"routings"');
--> statement-breakpoint
ALTER TABLE "routing_operations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "routing_operations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"routing_operations"');
--> statement-breakpoint
ALTER TABLE "production_order_operations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "production_order_operations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"production_order_operations"');
--> statement-breakpoint
ALTER TABLE "rework_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rework_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"rework_orders"');
--> statement-breakpoint
ALTER TABLE "downtime_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "downtime_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"downtime_records"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'work_centers', 'routings', 'routing_operations',
    'production_order_operations', 'rework_orders', 'downtime_records'
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
-- 10. Grants.
--> statement-breakpoint
REVOKE ALL ON "work_centers" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "work_centers" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "work_centers" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "work_centers" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "routings" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "routings" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "routings" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "routings" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "routing_operations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "routing_operations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "routing_operations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "routing_operations" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "production_order_operations" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "production_order_operations" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "production_order_operations" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "production_order_operations" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "rework_orders" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "rework_orders" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "rework_orders" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "rework_orders" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "downtime_records" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "downtime_records" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "downtime_records" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "downtime_records" TO erp_definer;
--> statement-breakpoint
GRANT SELECT ON "v_work_center_oee_daily" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "v_work_center_oee_daily" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "v_work_center_oee_period" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "v_work_center_oee_period" TO erp_readonly;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 11. Bilingual table comments.
--> statement-breakpoint
COMMENT ON TABLE "work_centers" IS 'PHASE-042 (M-03/H-04): work centers — per-shift capacity (hours) + fixed/var hourly cost rates + status + cost-center link / مراكز العمل: السعة لكل وردية ومعدلات التكلفة الثابتة والمتغيرة والوضع وربط مركز التكلفة';
--> statement-breakpoint
COMMENT ON TABLE "routings" IS 'PHASE-042 (M-02): versioned routings per item — one ACTIVE (the BOM discipline) / مسارات التشغيل المرقّمة لكل صنف — نسخة نشطة واحدة كقوائم المواد';
--> statement-breakpoint
COMMENT ON TABLE "routing_operations" IS 'PHASE-042 (M-02): sequenced routing operations — setup/run times + work center + optional rate overrides / عمليات المسار المرقّمة: زمن التحضير والتشغيل ومركز العمل وتجاوزات المعدلات الاختيارية';
--> statement-breakpoint
COMMENT ON TABLE "production_order_operations" IS 'PHASE-042 (M-02/M-17/M-18): per-order frozen operation rows — the PENDING/SETUP/RUNNING/PAUSED/COMPLETED/SKIPPED machine + actual times + variance columns / صفوف عمليات أمر الإنتاج: آلة الحالات والأزمنة الفعلية وأعمدة الفروق';
--> statement-breakpoint
COMMENT ON TABLE "rework_orders" IS 'PHASE-042 (M-14): rework orders — own routing; cost posts to REWORK_EXPENSE, never the parent FG layer / أوامر إعادة التشغيل: مسار خاص وتكلفة تُحمَّل على مصروف إعادة التشغيل لا على طبقة المنتج النهائي للأمر الأصل';
--> statement-breakpoint
COMMENT ON TABLE "downtime_records" IS 'PHASE-042 (M-15): downtime records — reason-coded availability input of OEE + the non-value cost source / سجل توقفات مركز العمل: أسباب مرمّزة تُغذّي مؤشر OEE ومصدر التكلفة غير المضيفة للقيمة';
--> statement-breakpoint
COMMENT ON VIEW "v_work_center_oee_daily" IS 'PHASE-042 (M-16): derived daily OEE facts per work center (security_invoker — RLS applies) / حقائق OEE اليومية المشتقّة لكل مركز عمل';
--> statement-breakpoint
COMMENT ON VIEW "v_work_center_oee_period" IS 'PHASE-042 (M-16): derived monthly OEE facts per work center with downtime minutes / حقائق OEE الشهرية المشتقّقة مع دقائق التوقف';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 12. CoA template markers (the 0026 additive pattern): REWORK_EXPENSE +
--     DOWNTIME_EXPENSE — existing tenants map once (fail-closed
--     PURPOSE_NOT_MAPPED until then, the CARD_RECEIVABLE precedent
--     DR-016-02). 0066 lands the standard-costing pair (5990/5995).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('5125', 'Rework expense', 'مصروف إعادة التشغيل', 'EXPENSE', false, '5000', 'REWORK_EXPENSE'),
  ('5430', 'Downtime (idle capacity)', 'التوقف (طاقة معطّلة)', 'EXPENSE', false, '5400', 'DOWNTIME_EXPENSE')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 13. Permission seed (matrix §3.20; zero-drift 272 → 278): the SIX keys.
--     The doc's planned "manufacturing.costing" is already live as
--     manufacturing.costing.read (0026) — recorded as the numbering
--     deviation. shopfloor.execute + downtime.log reach the warehouse role
--     (the operational tier, the 0026 precedent); the manage keys stay
--     owner + accountant.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('manufacturing.work_centers.manage', 'manufacturing', 'Manage work centers (capacity, rates, status, cost-center link) / إدارة مراكز العمل (السعة والمعدلات والوضع وربط مركز التكلفة)'),
('manufacturing.routings.manage', 'manufacturing', 'Manage versioned routings and their operations / إدارة مسارات التشغيل المرقّمة وعملياتها'),
('manufacturing.shopfloor.execute', 'manufacturing', 'Execute shop-floor operations (scan start/pause/complete, log scrap and downtime) / تنفيذ عمليات أرضية المصنع (بدء/إيقاف/إكمال بالمسح وتسجيل الهالك والتوقف)'),
('manufacturing.rework_orders.manage', 'manufacturing', 'Manage rework orders (create from defect, release, complete) / إدارة أوامر إعادة التشغيل'),
('manufacturing.downtime.log', 'manufacturing', 'Log and close downtime records with reason codes / تسجيل وإغلاق حالات التوقف بأكواد الأسباب'),
('manufacturing.oee.read', 'manufacturing', 'Read OEE views and work-center utilization / قراءة مؤشرات OEE واستغلال مراكز العمل')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.work_centers.manage', 'manufacturing.routings.manage',
  'manufacturing.shopfloor.execute', 'manufacturing.rework_orders.manage',
  'manufacturing.downtime.log', 'manufacturing.oee.read'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.work_centers.manage', 'manufacturing.routings.manage',
  'manufacturing.rework_orders.manage', 'manufacturing.oee.read'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.shopfloor.execute', 'manufacturing.downtime.log',
  'manufacturing.oee.read'
)
WHERE r."key" = 'warehouse' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.oee.read'
)
WHERE r."key" = 'viewer' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 65)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
