-- PHASE-043 (Blueprint v3.0 · CR-13) · migration 0074 · Manufacturing II —
-- MRP & Planning (part 1: the planning-policy substrate + the master
-- production schedule).
--
-- Purpose (PHASE-043 §2.1/§2.2): every MRP net-requirements line needs a
-- policy substrate to net against and a master schedule to plan from:
--
--   items planning-policy fields (M-01, DF-24) — lead_time_days,
--     safety_stock (manual value OR the AUTO policy: service level +
--     look-back window over demand variability — the deterministic z×σ×√LT
--     formula, no statistics invented at run time), lot_sizing rule
--     (LOT_FOR_LOT / FIXED_ORDER_QTY / ORDER_MULTIPLE / PERIOD_SUPPLY),
--     and the time fences (frozen / slushy — planning horizon days).
--   lot_sizing_rules (M-01) — the GLOBAL rule-definition catalog (the
--     permissions pattern: no tenant_id, no RLS, seeded read-only in
--     0078 — the "lot-sizing rule definitions" seed the phase doc names).
--   mps_entries (M-05) — the master production schedule: planned
--     production quantities per (warehouse, item, bucket), the demand
--     override inside the frozen fence; edits inside the frozen fence
--     require the explicit manufacturing.mps.frozen_edit permission +
--     a reason (BR-078 — service-enforced, the reason rides the row).
--
-- Numbering note (the 0065 pattern): the phase doc planned "≈ 0067…0072"
-- written before PHASE-044 took 0067…0073; the honest slots are therefore
-- 0074…0078 (journal idx 73…77, schema_version 74…78). The doc's id
-- counters are likewise stale — the coordinated ID_LEDGER reservations are
-- G-47…G-49 · INV-030 · BR-078…BR-080 (the 039–044 waves consumed the
-- doc's G-44…G-46/INV-028/BR-061…063 guesses).
--
-- INV-022 ledger: +2 tenant tables (mps_entries here, bill_of_resources +
-- the BOM planning extension + the MRP family in 0075/0076), +1 global
-- catalog (lot_sizing_rules), +4 permissions (287 → 291, matrix §3.20 —
-- 0078's seed), +3 feature keys (0078), +3 CoA purposes (0077 — the
-- tolling markers), +3 journal goldens registered in docs (G-47/G-48/G-49,
-- JOURNAL_RULES §7) + INV-030 (ACCOUNTING_INVARIANTS) + BR-078…080
-- (BUSINESS_RULES).
--
-- Grants: items/mps_entries are planning data (SELECT/INSERT/UPDATE — the
-- status lifecycle + the frozen-fence reason discipline; no tombstone
-- deletes); lot_sizing_rules is a global read-only catalog (SELECT only).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. Item planning-policy fields (§2.1, M-01/DF-24): additive columns only.
--    NULL lead time / safety stock = "no policy" — the run's data-readiness
--    panel and the MRP exceptions report surface them (never silently
--    treated as zero: a NULL lead time pushes the release date to the
--    horizon start and flags the suggestion).
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "lead_time_days" integer
  CONSTRAINT "ck_items_lead_time" CHECK ("lead_time_days" IS NULL OR ("lead_time_days" >= 0 AND "lead_time_days" <= 365));
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "safety_stock_policy" text NOT NULL DEFAULT 'MANUAL';
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "safety_stock_qty" numeric(19, 6)
  CONSTRAINT "ck_items_safety_stock_qty" CHECK ("safety_stock_qty" IS NULL OR "safety_stock_qty" >= 0);
--> statement-breakpoint
-- AUTO safety stock inputs: the z-table service levels (90/95/98/99 — the
-- deterministic policy: z × σ(daily demand over the look-back) × √LT) and
-- the look-back window in days.
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "ss_service_level_pct" numeric(5, 2)
  CONSTRAINT "ck_items_ss_service_level" CHECK ("ss_service_level_pct" IS NULL OR "ss_service_level_pct" IN (90, 95, 98, 99));
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "ss_lookback_days" integer
  CONSTRAINT "ck_items_ss_lookback" CHECK ("ss_lookback_days" IS NULL OR ("ss_lookback_days" >= 30 AND "ss_lookback_days" <= 1095));
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "lot_sizing_rule" text NOT NULL DEFAULT 'LOT_FOR_LOT';
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "fixed_order_qty" numeric(19, 6)
  CONSTRAINT "ck_items_fixed_order_qty" CHECK ("fixed_order_qty" IS NULL OR "fixed_order_qty" > 0);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "order_multiple" numeric(19, 6)
  CONSTRAINT "ck_items_order_multiple" CHECK ("order_multiple" IS NULL OR "order_multiple" > 0);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "period_supply_buckets" integer
  CONSTRAINT "ck_items_period_supply" CHECK ("period_supply_buckets" IS NULL OR ("period_supply_buckets" >= 1 AND "period_supply_buckets" <= 13));
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "frozen_fence_days" integer NOT NULL DEFAULT 0
  CONSTRAINT "ck_items_frozen_fence" CHECK ("frozen_fence_days" >= 0 AND "frozen_fence_days" <= 90);
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "slushy_fence_days" integer NOT NULL DEFAULT 0
  CONSTRAINT "ck_items_slushy_fence" CHECK ("slushy_fence_days" >= 0 AND "slushy_fence_days" <= 180);
--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "ck_items_planning_shape";
--> statement-breakpoint
-- The lot-sizing parameter discipline: exactly the operand the chosen rule
-- needs (FOQ needs fixed_order_qty; ORDER_MULTIPLE needs order_multiple;
-- PERIOD_SUPPLY needs period_supply_buckets); AUTO safety stock needs BOTH
-- its service level and its look-back; MANUAL needs safety_stock_qty (or
-- NULL = no safety demand).
ALTER TABLE "items" ADD CONSTRAINT ck_items_planning_shape CHECK (
  ("lot_sizing_rule" IN ('LOT_FOR_LOT', 'FIXED_ORDER_QTY', 'ORDER_MULTIPLE', 'PERIOD_SUPPLY'))
  AND ("lot_sizing_rule" <> 'FIXED_ORDER_QTY' OR "fixed_order_qty" IS NOT NULL)
  AND ("lot_sizing_rule" <> 'ORDER_MULTIPLE' OR "order_multiple" IS NOT NULL)
  AND ("lot_sizing_rule" <> 'PERIOD_SUPPLY' OR "period_supply_buckets" IS NOT NULL)
  AND ("safety_stock_policy" IN ('MANUAL', 'AUTO'))
  AND ("safety_stock_policy" <> 'AUTO' OR ("ss_service_level_pct" IS NOT NULL AND "ss_lookback_days" IS NOT NULL AND "lead_time_days" IS NOT NULL))
);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. lot_sizing_rules (M-01): the GLOBAL rule-definition catalog — the
--    permissions pattern (no tenant_id, no RLS, seeded once in 0078, read
--    by every tenant; param_required names the items column the rule
--    consumes). Not in the tenant tables registry (no tenant_id).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lot_sizing_rules" (
  "code" text NOT NULL,
  "name" text NOT NULL,
  "name_ar" text NOT NULL,
  "description" text NOT NULL,
  "description_ar" text NOT NULL,
  "param_required" text,
  CONSTRAINT "pk_lot_sizing_rules" PRIMARY KEY ("code"),
  CONSTRAINT "ck_lot_sizing_rules_param" CHECK (
    "param_required" IS NULL OR "param_required" IN
      ('fixed_order_qty', 'order_multiple', 'period_supply_buckets')
  )
);

--> statement-breakpoint
GRANT SELECT ON "lot_sizing_rules" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "lot_sizing_rules" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "lot_sizing_rules" TO erp_definer;
--> statement-breakpoint
COMMENT ON TABLE "lot_sizing_rules" IS 'PHASE-043 (M-01): the global lot-sizing rule catalog (seeded read-only — the permissions pattern) / كتالوج قواعد تحجم الأوامر العالمي (قراءة فقط — نمط الصلاحيات)';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. mps_entries (§2.2, M-05): the master production schedule — planned
--    production quantities per (warehouse, item, bucket_start). One row
--    per slot (partial unique); FIRMED rows are the committed schedule
--    (planners lock them inside the frozen fence), PLANNED rows are the
--    working schedule. The MRP engine consumes both as bucket demand
--    (kind MPS); the frozen-fence edit discipline (permission + reason,
--    BR-078) is service-enforced and the last reason rides the row.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mps_entries" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "warehouse_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "bucket_start" date NOT NULL,
  "qty" numeric(19, 6) NOT NULL,
  "uom_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'PLANNED',
  "last_edit_reason" text,
  "note" text,
  "note_ar" text,
  "created_by" uuid,
  CONSTRAINT "pk_mps_entries" PRIMARY KEY ("id"),
  CONSTRAINT "uq_mps_entries_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_mps_entries_slot" UNIQUE ("tenant_id", "warehouse_id", "item_id", "bucket_start"),
  CONSTRAINT "ck_mps_entries_qty" CHECK ("qty" >= 0),
  CONSTRAINT "ck_mps_entries_status" CHECK ("status" IN ('PLANNED', 'FIRMED')),
  CONSTRAINT "ck_mps_entries_reason_shape" CHECK (
    "last_edit_reason" IS NULL OR length("last_edit_reason") BETWEEN 1 AND 300
  ),
  CONSTRAINT "fk_mps_entries_warehouse" FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mps_entries_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_mps_entries_uom" FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mps_entries_tenant_wh_item"
  ON "mps_entries" ("tenant_id", "warehouse_id", "item_id", "bucket_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_mps_entries_tenant_status"
  ON "mps_entries" ("tenant_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS — the house triple (apply_tenant_policy + the purge path).
--> statement-breakpoint
ALTER TABLE "mps_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "mps_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"mps_entries"');
--> statement-breakpoint
DROP POLICY IF EXISTS purge_path_delete ON public.mps_entries;
--> statement-breakpoint
DROP POLICY IF EXISTS purge_path_update ON public.mps_entries;
--> statement-breakpoint
CREATE POLICY purge_path_delete ON public.mps_entries FOR DELETE TO erp_migrate
  USING (tenant_id = erp.current_tenant_id());
--> statement-breakpoint
CREATE POLICY purge_path_update ON public.mps_entries FOR UPDATE TO erp_migrate
  USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Grants.
--> statement-breakpoint
REVOKE ALL ON "mps_entries" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "mps_entries" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "mps_entries" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "mps_entries" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "mps_entries" IS 'PHASE-043 (M-05): master production schedule — planned/firmed production per warehouse, item and bucket; frozen-fence edits need the mps.frozen_edit permission + reason (BR-078) / الجدول الزمني للإنتاج الرئيسي: كميات مخططة/مثبتة لكل مستودع وصنف وفترة زمنية';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 74)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
