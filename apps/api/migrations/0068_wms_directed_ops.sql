-- PHASE-044 (Blueprint v3.0 · CR-14) · migration 0068 · WMS & Inventory
-- Intelligence (part 2: directed operations — putaway rules + the picking
-- family).
--
-- Purpose (PHASE-044 §2.3/§2.4, I-03/I-04/I-06/I-07, PP-11/PP-12):
--
--   putaway_rules — the condition engine (item attributes / zone type /
--     batch characteristics) generating SUGGESTED putaway tasks on goods
--     receipt (I-03, PP-12): ordered by priority, first match wins, the
--     condition is a closed jsonb shape validated at the service.
--   pick_strategies — per-warehouse directed-pick method (FIFO / FEFO /
--     NEAREST) + the partial-pick allowed rule (I-04): one row per
--     warehouse (the floor; absent = the legacy direct-issue path).
--   pick_waves — pick waves grouping deliveries into routes (I-06):
--     DRAFT → RELEASED → COMPLETED/CANCELLED; release snapshots the
--     warehouse's strategy so later edits never move a live wave.
--   pick_tasks — the task board (I-07, PP-11, DF-17, OA-02): PICK and
--     PUTAWAY kinds, assignee, scan verification, progressive qty, and
--     the version column the field-sync conflict checks read (the
--     two-devices-claim-one-task guard, BR-074).
--
-- The task table is ONE for both kinds: the sync duty (OA-02) ships a
-- single task contract to the Android client — pick AND putaway state
-- transitions + scan confirmations ride the same shape (the documented
-- decision D-3; a split would double the sync surface for no gain).
--
-- Grants: master data (putaway_rules, pick_strategies) per the 0026
-- precedent; waves/tasks are document rows (SELECT/INSERT/UPDATE).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. putaway_rules (§2.3, I-03): priority-ordered condition → target.
--    condition jsonb closed shape (service-validated):
--      { "itemCategory"?: string, "trackBatch"?: boolean,
--        "hasExpiry"?: boolean, "itemType"?: string, "uomId"?: string }
--    target: a zone_type (the engine picks a bin inside it) or an exact
--    bin (target_bin_id) — pair-or-zone (the CHECK floor).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "putaway_rules" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "priority" integer NOT NULL DEFAULT 100,
  "name" text NOT NULL,
  "condition" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "target_zone_type" text,
  "target_bin_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_putaway_rules" PRIMARY KEY ("id"),
  CONSTRAINT "uq_putaway_rules_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_putaway_rules_tenant_priority" UNIQUE ("tenant_id", "priority"),
  CONSTRAINT "ck_putaway_rules_priority" CHECK ("priority" >= 1 AND "priority" <= 1000),
  CONSTRAINT "ck_putaway_rules_target" CHECK (
    ("target_zone_type" IS NULL) <> ("target_bin_id" IS NULL)
  ),
  CONSTRAINT "ck_putaway_rules_zone_type" CHECK (
    "target_zone_type" IS NULL OR "target_zone_type" IN
      ('PICKING', 'BULK', 'QUARANTINE', 'DOCK', 'STAGE')
  ),
  CONSTRAINT "ck_putaway_rules_condition_shape" CHECK (
    jsonb_typeof("condition") = 'object'
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_putaway_rules_tenant_active"
  ON "putaway_rules" ("tenant_id", "is_active", "priority");

--> statement-breakpoint
ALTER TABLE "putaway_rules"
  ADD CONSTRAINT "fk_putaway_rules_target_bin"
  FOREIGN KEY ("target_bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. pick_strategies (§2.4, I-04): per-warehouse directed-pick method.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pick_strategies" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "warehouse_id" uuid NOT NULL,
  "method" text NOT NULL DEFAULT 'FIFO',
  "allow_partial" boolean NOT NULL DEFAULT true,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_pick_strategies" PRIMARY KEY ("id"),
  CONSTRAINT "uq_pick_strategies_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_pick_strategies_tenant_wh" UNIQUE ("tenant_id", "warehouse_id"),
  CONSTRAINT "ck_pick_strategies_method" CHECK ("method" IN ('FIFO', 'FEFO', 'NEAREST'))
);

--> statement-breakpoint
ALTER TABLE "pick_strategies"
  ADD CONSTRAINT "fk_pick_strategies_warehouse"
  FOREIGN KEY ("warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. pick_waves (§2.4, I-06): deliveries grouped into one picking route.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pick_waves" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "wave_no" text,
  "warehouse_id" uuid NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "method" text,
  "route_note" text,
  "released_at" timestamptz,
  "completed_at" timestamptz,
  "created_by" uuid,
  "released_by" uuid,
  "completed_by" uuid,
  CONSTRAINT "pk_pick_waves" PRIMARY KEY ("id"),
  CONSTRAINT "uq_pick_waves_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_pick_waves_tenant_wave_no" UNIQUE ("tenant_id", "wave_no"),
  CONSTRAINT "ck_pick_waves_status" CHECK (
    "status" IN ('DRAFT', 'RELEASED', 'COMPLETED', 'CANCELLED')
  ),
  CONSTRAINT "ck_pick_waves_method" CHECK (
    "method" IS NULL OR "method" IN ('FIFO', 'FEFO', 'NEAREST')
  ),
  -- RELEASED+ carries its stamp; the number lands at release (PW- prefix).
  CONSTRAINT "ck_pick_waves_state_evidence" CHECK (
    ("status" = 'DRAFT' AND "released_at" IS NULL AND "wave_no" IS NULL) OR
    ("status" <> 'DRAFT' AND "released_at" IS NOT NULL AND "wave_no" IS NOT NULL) OR
    ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_pick_waves_tenant_wh_status"
  ON "pick_waves" ("tenant_id", "warehouse_id", "status");

--> statement-breakpoint
ALTER TABLE "pick_waves"
  ADD CONSTRAINT "fk_pick_waves_warehouse"
  FOREIGN KEY ("warehouse_id", "tenant_id") REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. pick_tasks (§2.4, I-07, PP-11/DF-17, OA-02): the unified task board.
--    PICK tasks carry from_bin (the strategy's allocation) + the delivery
--    line ref; PUTAWAY tasks carry to_bin (the rule's suggestion) + the
--    receipt line ref. version bumps on every transition — the sync
--    conflict floor (BR-074). qty_picked < qty only while allow_partial.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pick_tasks" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "task_no" text,
  "wave_id" uuid,
  "task_kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'PENDING',
  "assignee_user_id" uuid,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "serial_id" uuid,
  "lpn_id" uuid,
  "qty" numeric(19, 6) NOT NULL,
  "qty_done" numeric(19, 6) NOT NULL DEFAULT 0,
  "from_bin_id" uuid,
  "to_bin_id" uuid,
  "source_type" text NOT NULL,
  "source_id" uuid NOT NULL,
  "source_line_no" integer,
  "scan_verified" boolean NOT NULL DEFAULT false,
  "sequence_no" integer,
  "completed_at" timestamptz,
  "completed_by" uuid,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_pick_tasks" PRIMARY KEY ("id"),
  CONSTRAINT "uq_pick_tasks_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "ck_pick_tasks_kind" CHECK ("task_kind" IN ('PICK', 'PUTAWAY')),
  CONSTRAINT "ck_pick_tasks_status" CHECK (
    "status" IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')
  ),
  CONSTRAINT "ck_pick_tasks_qty" CHECK ("qty" > 0),
  CONSTRAINT "ck_pick_tasks_qty_done" CHECK ("qty_done" >= 0 AND "qty_done" <= "qty"),
  -- COMPLETED carries its evidence (the state-evidence floor).
  CONSTRAINT "ck_pick_tasks_state_evidence" CHECK (
    ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)
  ),
  -- A PICK reads from a bin; a PUTAWAY writes to one (the shape floor).
  CONSTRAINT "ck_pick_tasks_direction" CHECK (
    ("task_kind" = 'PICK' AND "from_bin_id" IS NOT NULL) OR
    ("task_kind" = 'PUTAWAY' AND "to_bin_id" IS NOT NULL)
  ),
  CONSTRAINT "ck_pick_tasks_sequence" CHECK (
    "sequence_no" IS NULL OR ("sequence_no" >= 1 AND "sequence_no" <= 1000000)
  )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_pick_tasks_tenant_wave_status"
  ON "pick_tasks" ("tenant_id", "wave_id", "status");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_pick_tasks_tenant_kind_status"
  ON "pick_tasks" ("tenant_id", "task_kind", "status");

--> statement-breakpoint
-- The task board + the field-sync pull feed (OA-02): assignee-scoped.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_pick_tasks_tenant_assignee_status"
  ON "pick_tasks" ("tenant_id", "assignee_user_id", "status");

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_pick_tasks_tenant_source"
  ON "pick_tasks" ("tenant_id", "source_type", "source_id");

--> statement-breakpoint
ALTER TABLE "pick_tasks"
  ADD CONSTRAINT "fk_pick_tasks_wave"
  FOREIGN KEY ("wave_id", "tenant_id") REFERENCES "pick_waves" ("id", "tenant_id") ON DELETE CASCADE;

--> statement-breakpoint
ALTER TABLE "pick_tasks"
  ADD CONSTRAINT "fk_pick_tasks_item"
  FOREIGN KEY ("item_id", "tenant_id") REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "pick_tasks"
  ADD CONSTRAINT "fk_pick_tasks_batch"
  FOREIGN KEY ("batch_id", "tenant_id") REFERENCES "item_batches" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "pick_tasks"
  ADD CONSTRAINT "fk_pick_tasks_serial"
  FOREIGN KEY ("serial_id", "tenant_id") REFERENCES "item_serials" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "pick_tasks"
  ADD CONSTRAINT "fk_pick_tasks_lpn"
  FOREIGN KEY ("lpn_id", "tenant_id") REFERENCES "lpns" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "pick_tasks"
  ADD CONSTRAINT "fk_pick_tasks_from_bin"
  FOREIGN KEY ("from_bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
ALTER TABLE "pick_tasks"
  ADD CONSTRAINT "fk_pick_tasks_to_bin"
  FOREIGN KEY ("to_bin_id", "tenant_id") REFERENCES "warehouse_bins" ("id", "tenant_id") ON DELETE RESTRICT;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. RLS — the house triple for the four new tables.
--> statement-breakpoint
ALTER TABLE "putaway_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "putaway_rules" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"putaway_rules"');
--> statement-breakpoint
ALTER TABLE "pick_strategies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pick_strategies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"pick_strategies"');
--> statement-breakpoint
ALTER TABLE "pick_waves" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pick_waves" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"pick_waves"');
--> statement-breakpoint
ALTER TABLE "pick_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "pick_tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"pick_tasks"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'putaway_rules', 'pick_strategies', 'pick_waves', 'pick_tasks'
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
-- 6. Grants.
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "putaway_rules" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "putaway_rules" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "putaway_rules" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "pick_strategies" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "pick_strategies" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "pick_strategies" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "pick_waves" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "pick_waves" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "pick_waves" TO erp_definer;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "pick_tasks" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "pick_tasks" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "pick_tasks" TO erp_definer;

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 68)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
