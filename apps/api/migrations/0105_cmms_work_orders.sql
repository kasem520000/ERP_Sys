-- PHASE-049 (Blueprint v3.0 · CR-19, extended by v3.2/CR-50) · migration
-- 0105 · CMMS — Asset Maintenance (part 1: the preventive plans + the
-- checklist + the work-order engine's substrate — T-01, the plan §2's
-- honest slot; the phase doc's "0083…0086" are stale blueprint slots,
-- its own note defers to the journal at implementation time — the 047
-- D-03/048 D-02 precedent).
--
--   maintenance_plans (D-08 — FA-F-01/FA-F-03, BR-097): the per-asset
--     preventive register — trigger CALENDAR (interval days + the
--     recomputed next_due) or METER (a meter FK + the delta threshold),
--     the XOR shape law (a plan is exactly one trigger kind), the
--     generation anchor (last_anchor_value — the GENERATION's own
--     reading stamp, so a back-dated reading can never double-trigger:
--     a window already generated never re-arms) + last_generated_at.
--     Master data with DELETE granted (the typed service guards own
--     the lifecycle; generated orders' plan FK RESTRICT protects the
--     plans with history). THE METER FK lands with 0106's asset_meters
--     as an additive ALTER (the 0100 crm_time_entries / 0104 stamps
--     precedent — never a forward reference, never a guess here).
--   maintenance_plan_tasks (D-08 — FA-F-03, BR-098): the checklist
--     steps (seq ordering, bilingual title + instruction, the active
--     flag) carried onto generated orders with per-step results — the
--     results land with W-17's generation API (the carry-over law);
--     the plan's own rows CASCADE with the plan (the 0101
--     budget_lines→budgets precedent — the checklist is the plan's
--     own).
--   maintenance_work_orders (D-03 — FA-F-02/H-15): the REQUESTED →
--     PLANNED → IN_PROGRESS ↔ ON_HOLD → COMPLETED machine (forward-only
--     with the pause both-ways law, never a regression past IN_PROGRESS
--     — the 048 D-12 field-service shape), the problem/solution text,
--     the priority, the assigned technician (an HR READ — the 048
--     payroll read-only law extended: 049 never writes an HR table),
--     the three cost-leg TOTALS (labor/parts/external, ADR-0009 money —
--     the cost LINES are W-17's collectors: if that wave lands a
--     cost-lines table instead of columns, the dated note records the
--     +9 per D-02's own provision — nothing silent), and THE COMPLETION
--     STAMP (single-use completed_at written only after the G-59
--     posting succeeded, the same ambient transaction — D-04; the
--     journal stamp exists only on the completed path, the 0103
--     progress_certificates invoice-gate precedent). Generated orders
--     carry their plan link (plan_id) and the BR-097 single-open
--     structural guard: the partial unique on open generated orders per
--     (asset, plan) — D-08. Evidence discipline: NO delete (the order
--     history is the service-history timeline's spine).
--
--   Ledger-free by design at W-16 (G-59's posting lands W-17 through
--   the REAL engine with a registered source key under INV-013
--   idempotency; the canon row is W-23's).
--
--   The 044 asset register is the substrate, EXTENDED never replaced
--   (D-01 — the frozen-substrate law): disposed/written-off assets
--   open no work order or plan (the status guard at every authoring
--   path is the W-17 service's typed refusal; the FK stays RESTRICT —
--   the register row is never the machine's to cascade).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. maintenance_plans (the preventive register — BR-097's window law).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_plans" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "asset_id" uuid NOT NULL,
  "name" text NOT NULL,
  "name_ar" text,
  "description" text,
  "description_ar" text,
  "trigger_type" text NOT NULL,
  "interval_days" integer,
  "next_due_date" date,
  "meter_id" uuid,
  "threshold_delta" numeric(19, 6),
  "last_anchor_value" numeric(19, 6),
  "last_generated_at" timestamptz,
  "is_active" boolean NOT NULL DEFAULT true,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_maintenance_plans PRIMARY KEY ("id"),
  CONSTRAINT uq_maintenance_plans_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_maintenance_plans_tenant_asset_name UNIQUE ("tenant_id", "asset_id", "name"),
  CONSTRAINT fk_maintenance_plans_asset
    FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  -- NOTE: fk_maintenance_plans_meter (the METER trigger's chosen meter)
  -- lands with 0106's asset_meters as an additive ALTER — the 0100/0104
  -- additive precedent; meter_id carries no FK for exactly this one
  -- migration, never silently.
  CONSTRAINT ck_maintenance_plans_trigger
    CHECK ("trigger_type" IN ('CALENDAR', 'METER')),
  CONSTRAINT ck_maintenance_plans_interval
    CHECK ("interval_days" IS NULL OR ("interval_days" >= 1 AND "interval_days" <= 3650)),
  CONSTRAINT ck_maintenance_plans_threshold
    CHECK ("threshold_delta" IS NULL OR "threshold_delta" > 0),
  CONSTRAINT ck_maintenance_plans_last_anchor
    CHECK ("last_anchor_value" IS NULL OR "last_anchor_value" >= 0),
  -- The XOR shape law (D-08): a plan is EXACTLY ONE trigger kind —
  -- CALENDAR carries interval_days + next_due_date and never a meter;
  -- METER carries the meter FK + the delta threshold and never a
  -- calendar pair. The anchor exists only after the first generation.
  CONSTRAINT ck_maintenance_plans_trigger_shape
    CHECK (
      ("trigger_type" = 'CALENDAR' AND "interval_days" IS NOT NULL
         AND "next_due_date" IS NOT NULL AND "meter_id" IS NULL
         AND "threshold_delta" IS NULL)
      OR ("trigger_type" = 'METER' AND "interval_days" IS NULL
           AND "next_due_date" IS NULL AND "meter_id" IS NOT NULL
           AND "threshold_delta" IS NOT NULL)
    ),
  -- The generation anchor lives only on the METER kind (the reading
  -- stamp the next evaluation measures from — the back-dated
  -- no-double-trigger law's own column).
  CONSTRAINT ck_maintenance_plans_anchor_gated
    CHECK ("trigger_type" = 'METER' OR "last_anchor_value" IS NULL)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_maintenance_plans_tenant_asset
  ON "maintenance_plans" ("tenant_id", "asset_id", "is_active");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. maintenance_plan_tasks (the checklist — BR-098's open-step gate).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_plan_tasks" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "plan_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "title" text NOT NULL,
  "title_ar" text,
  "instruction" text,
  "instruction_ar" text,
  "is_active" boolean NOT NULL DEFAULT true,
  CONSTRAINT pk_maintenance_plan_tasks PRIMARY KEY ("id"),
  CONSTRAINT uq_maintenance_plan_tasks_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_maintenance_plan_tasks_tenant_plan_seq
    UNIQUE ("tenant_id", "plan_id", "seq"),
  CONSTRAINT fk_maintenance_plan_tasks_plan
    FOREIGN KEY ("plan_id", "tenant_id")
    REFERENCES "maintenance_plans" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT ck_maintenance_plan_tasks_seq
    CHECK ("seq" >= 1)
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_maintenance_plan_tasks_tenant_plan
  ON "maintenance_plan_tasks" ("tenant_id", "plan_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. maintenance_work_orders (the machine + the cost totals + the
--    completion stamp).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_work_orders" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "asset_id" uuid NOT NULL,
  "order_no" text NOT NULL,
  "problem" text NOT NULL,
  "problem_ar" text,
  "solution" text,
  "solution_ar" text,
  "priority" text NOT NULL DEFAULT 'MEDIUM',
  "technician_employee_id" uuid,
  "status" text NOT NULL DEFAULT 'REQUESTED',
  "plan_id" uuid,
  "planned_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "labor_total" numeric(19, 4) NOT NULL DEFAULT 0,
  "parts_total" numeric(19, 4) NOT NULL DEFAULT 0,
  "external_total" numeric(19, 4) NOT NULL DEFAULT 0,
  "journal_entry_id" uuid,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_maintenance_work_orders PRIMARY KEY ("id"),
  CONSTRAINT uq_maintenance_work_orders_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_maintenance_work_orders_tenant_no UNIQUE ("tenant_id", "order_no"),
  CONSTRAINT fk_maintenance_work_orders_asset
    FOREIGN KEY ("asset_id", "tenant_id")
    REFERENCES "assets" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_maintenance_work_orders_technician
    FOREIGN KEY ("technician_employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_maintenance_work_orders_plan
    FOREIGN KEY ("plan_id", "tenant_id")
    REFERENCES "maintenance_plans" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_maintenance_work_orders_journal
    FOREIGN KEY ("journal_entry_id", "tenant_id")
    REFERENCES "journal_entries" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_maintenance_work_orders_priority
    CHECK ("priority" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT ck_maintenance_work_orders_status
    CHECK ("status" IN ('REQUESTED', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED')),
  CONSTRAINT ck_maintenance_work_orders_totals
    CHECK ("labor_total" >= 0 AND "parts_total" >= 0 AND "external_total" >= 0),
  -- The machine's stamp law (the 0103 service_visits shape): exactly the
  -- stamps of the passed states — REQUESTED carries none; PLANNED the
  -- plan stamp; IN_PROGRESS and ON_HOLD (the pause state — the pause
  -- history is the W-17 single-clock engine's) the start stamp; COMPLETED
  -- the single-use completion stamp. Never a regression past IN_PROGRESS.
  CONSTRAINT ck_maintenance_work_orders_stamps
    CHECK (
      ("status" = 'REQUESTED' AND "planned_at" IS NULL AND "started_at" IS NULL
         AND "completed_at" IS NULL)
      OR ("status" = 'PLANNED' AND "planned_at" IS NOT NULL AND "started_at" IS NULL
           AND "completed_at" IS NULL)
      OR ("status" IN ('IN_PROGRESS', 'ON_HOLD') AND "planned_at" IS NOT NULL
           AND "started_at" IS NOT NULL AND "completed_at" IS NULL)
      OR ("status" = 'COMPLETED' AND "planned_at" IS NOT NULL AND "started_at" IS NOT NULL
           AND "completed_at" IS NOT NULL)
    ),
  -- The G-59 stamp exists only on the completed path (the 0103
  -- invoice-gate precedent); completion itself requires its journal —
  -- both written in the SAME ambient transaction (all-or-nothing, D-04).
  CONSTRAINT ck_maintenance_work_orders_journal_gated
    CHECK (
      ("status" = 'COMPLETED' AND "journal_entry_id" IS NOT NULL)
      OR ("status" <> 'COMPLETED' AND "journal_entry_id" IS NULL)
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_maintenance_work_orders_tenant_asset
  ON "maintenance_work_orders" ("tenant_id", "asset_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_maintenance_work_orders_tenant_status
  ON "maintenance_work_orders" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_maintenance_work_orders_tenant_technician
  ON "maintenance_work_orders" ("tenant_id", "technician_employee_id")
  WHERE "technician_employee_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_maintenance_work_orders_tenant_plan
  ON "maintenance_work_orders" ("tenant_id", "plan_id")
  WHERE "plan_id" IS NOT NULL;
--> statement-breakpoint
-- BR-097's structural guard (D-08): at most ONE OPEN generated order per
-- (asset, plan) — the typed refusal's DB floor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_work_orders_tenant_plan_open
  ON "maintenance_work_orders" ("tenant_id", "asset_id", "plan_id")
  WHERE "plan_id" IS NOT NULL
    AND "status" IN ('REQUESTED', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS (the A1–A10 law) + the purge path.
--> statement-breakpoint
ALTER TABLE "maintenance_plans" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "maintenance_plans" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"maintenance_plans"');
--> statement-breakpoint
ALTER TABLE "maintenance_plan_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "maintenance_plan_tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"maintenance_plan_tasks"');
--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "maintenance_work_orders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"maintenance_work_orders"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'maintenance_plans', 'maintenance_plan_tasks', 'maintenance_work_orders'
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
-- 5. Grants — the evidence discipline vs master data.
--> statement-breakpoint
REVOKE ALL ON "maintenance_plans" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "maintenance_plans" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "maintenance_plans" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "maintenance_plans" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "maintenance_plan_tasks" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "maintenance_plan_tasks" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "maintenance_plan_tasks" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "maintenance_plan_tasks" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "maintenance_work_orders" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "maintenance_work_orders" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "maintenance_work_orders" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "maintenance_work_orders" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "maintenance_plans" IS 'PHASE-049 (D-08 — BR-097): per-asset preventive plans — CALENDAR (interval days, the recomputed next_due) or METER (a chosen meter + the delta threshold, the GENERATION''s own reading anchor — a back-dated reading never double-triggers); at most ONE open generated order per asset per trigger window / خطط الصيانة الوقائية لكل أصل: مُطلِق تقويم أو عدّاد، ونافذة مفتوحة واحدة كحد أقصى لكل أصل وخطة';
--> statement-breakpoint
COMMENT ON TABLE "maintenance_plan_tasks" IS 'PHASE-049 (D-08 — BR-098): the preventive plan''s checklist steps (seq-ordered, bilingual) carried onto generated work orders with per-step results — completion is blocked while any step is open / خطوات قائمة الفحص للخطة الوقائية تُنقل إلى أوامر الصيانة المولدة بنتائج لكل خطوة — لا اكتمال مع خطوة مفتوحة';
--> statement-breakpoint
COMMENT ON TABLE "maintenance_work_orders" IS 'PHASE-049 (D-03): maintenance work orders — the REQUESTED→PLANNED→IN_PROGRESS↔ON_HOLD→COMPLETED machine with the labor/parts/external cost totals (ADR-0009) and the single-use completion stamp (G-59 through the REAL engine, the journal written in the same transaction; the asset''s cost and depreciation UNTOUCHED — maintenance is an expense, never a capitalization) / أوامر الصيانة: حالات محددة بتكاليف العمالة والقطع والخدمات الخارجية وختم الإنجاز الأحيد الاستخدام مع ترحيل G-59 عبر المحرك — تكلفة الأصل وإهلاكه لا يُمَسّان';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 105)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
