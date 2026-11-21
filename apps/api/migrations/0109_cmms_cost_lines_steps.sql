-- PHASE-049 (Blueprint v3.0 · CR-19, extended by v3.2/CR-50) · migration
-- 0109 · CMMS — Asset Maintenance (part 5: the W-17 engine's two line
-- tables — T-05/T-06/T-07; the D-02-dated honest +9/+10 provision, the
-- 0105 header's own recorded note: «the cost LINES are W-17's
-- collectors: if that wave lands a cost-lines table instead of columns,
-- the dated note records the +9 per D-02's own provision — nothing
-- silent», and the carry-over law's own storage, 0105's «the results
-- land with W-17's generation API»).
--
--   maintenance_cost_lines (D-03/D-04/D-05 — BR-098, G-59, G-60): the
--     work order's three cost legs, ONE table, the per-leg XOR shape
--     law (a line is EXACTLY one leg): LABOR (the technician — an HR
--     READ, 049 never writes an HR table; hours; unit_rate — the
--     SNAPSHOT at line creation, the crm_time_entries.unitRate
--     precedent; an unset rate = UNPRICED, never a fabricated rate) ·
--     PARTS (the item + the issuing warehouse + qty; the value lands
--     at the completion act — the issue's OWN value through the REAL
--     WMS path, stamped per line: issue_unit_cost/issued_at, the
--     service-order W-3 provenance) · EXTERNAL (the supplier partner +
--     the expected bill amount + its own bilingual description — the
--     partner-side accrual leg; the supplier bill's own posting
--     supersedes the accrual when it lands, the 038 pattern). The
--     amount column: LABOR = hours × the snapshot rate (ONE half-up
--     rounding at 4dp, the pure fold cmms-plan-math.laborLineAmount);
--     PARTS = the issue value, NULL until the completion act (the
--     pairing CHECK); EXTERNAL = the input amount (nullable until the
--     bill is known). THE COMPLETION GATE (BR-098): a typed refusal
--     naming every unpriced line — never a silent partial. Master
--     data WITH DELETE granted (0105's own class for the
--     service-guarded lifecycles — the typed service refuses every
--     touch after COMPLETION by name, WORK_ORDER_COMPLETED; the
--     order's own row is the no-DELETE evidence spine).
--
--   maintenance_work_order_steps (D-08 — BR-098): the checklist
--     CARRIED onto generated orders (the carry-over law: the plan's
--     ACTIVE tasks copied at generation — seq, the bilingual title +
--     instruction SNAPSHOT so a later plan edit never rewrites a
--     generated order's carried steps) with the per-step results
--     (result PASS/FAIL + the bilingual note + recorded_at/recorded_by
--     — the stamp law: result and stamp exist together or not at all).
--     An OPEN step (result IS NULL) blocks completion — BR-098's gate.
--     NO DELETE grant, ever: the gate's integrity floor (deleting an
--     open step to force completion must be impossible — the row is
--     the order's own record of what the plan asked; the source-task
--     FK RESTRICT keeps the plan's history honest).
--
--   PLUS THE stock_moves SOURCE WIDENING: 'maintenance_work_order'
--     joins the source domain (the 0073 DROP+ADD pattern — the parts
--     issue at the completion act sources every move to its order).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. maintenance_cost_lines (the three cost collectors — the +9).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_cost_lines" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "work_order_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "leg_type" text NOT NULL,
  "employee_id" uuid,
  "hours" numeric(19, 6),
  "unit_rate" numeric(19, 6),
  "item_id" uuid,
  "warehouse_id" uuid,
  "qty" numeric(19, 6),
  "partner_id" uuid,
  "amount" numeric(19, 4),
  "description" text,
  "description_ar" text,
  "issue_unit_cost" numeric(19, 6),
  "issued_at" timestamptz,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_maintenance_cost_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_maintenance_cost_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_maintenance_cost_lines_order_line
    UNIQUE ("tenant_id", "work_order_id", "line_no"),
  CONSTRAINT fk_maintenance_cost_lines_work_order
    FOREIGN KEY ("work_order_id", "tenant_id")
    REFERENCES "maintenance_work_orders" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_maintenance_cost_lines_employee
    FOREIGN KEY ("employee_id", "tenant_id")
    REFERENCES "employees" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_maintenance_cost_lines_item
    FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_maintenance_cost_lines_warehouse
    FOREIGN KEY ("warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_maintenance_cost_lines_partner
    FOREIGN KEY ("partner_id", "tenant_id")
    REFERENCES "partners" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_maintenance_cost_lines_leg
    CHECK ("leg_type" IN ('LABOR', 'PARTS', 'EXTERNAL')),
  CONSTRAINT ck_maintenance_cost_lines_line_no
    CHECK ("line_no" >= 1),
  CONSTRAINT ck_maintenance_cost_lines_floors
    CHECK (("hours" IS NULL OR "hours" > 0)
       AND ("qty" IS NULL OR "qty" > 0)
       AND ("unit_rate" IS NULL OR "unit_rate" >= 0)
       AND ("amount" IS NULL OR "amount" >= 0)
       AND ("issue_unit_cost" IS NULL OR "issue_unit_cost" >= 0)),
  -- The per-leg XOR shape law (D-03): a line is EXACTLY ONE leg, with
  -- exactly that leg's own columns — LABOR carries the technician +
  -- hours (+ the rate snapshot), PARTS the item + warehouse + qty,
  -- EXTERNAL the supplier partner. Every other leg's columns are NULL.
  CONSTRAINT ck_maintenance_cost_lines_leg_shape
    CHECK (
      ("leg_type" = 'LABOR' AND "employee_id" IS NOT NULL AND "hours" IS NOT NULL
         AND "item_id" IS NULL AND "warehouse_id" IS NULL AND "qty" IS NULL
         AND "partner_id" IS NULL)
      OR ("leg_type" = 'PARTS' AND "employee_id" IS NULL AND "hours" IS NULL
           AND "unit_rate" IS NULL AND "item_id" IS NOT NULL
           AND "warehouse_id" IS NOT NULL AND "qty" IS NOT NULL
           AND "partner_id" IS NULL)
      OR ("leg_type" = 'EXTERNAL' AND "employee_id" IS NULL AND "hours" IS NULL
           AND "unit_rate" IS NULL AND "item_id" IS NULL AND "warehouse_id" IS NULL
           AND "qty" IS NULL AND "partner_id" IS NOT NULL)
    ),
  -- The pricing pair (D-03): a LABOR line is priced exactly when its
  -- snapshot rate exists (amount = hours × rate; both or neither — an
  -- unset rate is UNPRICED, never a fabricated rate).
  CONSTRAINT ck_maintenance_cost_lines_labor_pricing
    CHECK ("leg_type" <> 'LABOR' OR (("unit_rate" IS NULL) = ("amount" IS NULL))),
  -- The issue stamps exist only on the PARTS leg and only as the
  -- completion act's own pairing (the issue's own value + its unit
  -- cost + the stamp, all together or not at all — the W-3
  -- provenance shape).
  CONSTRAINT ck_maintenance_cost_lines_issue_gated
    CHECK (
      ("leg_type" <> 'PARTS' AND "issue_unit_cost" IS NULL AND "issued_at" IS NULL)
      OR ("leg_type" = 'PARTS' AND "employee_id" IS NULL
           AND (("issued_at" IS NULL AND "issue_unit_cost" IS NULL AND "amount" IS NULL)
             OR ("issued_at" IS NOT NULL AND "issue_unit_cost" IS NOT NULL
                 AND "amount" IS NOT NULL)))
    )
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_maintenance_cost_lines_tenant_order
  ON "maintenance_cost_lines" ("tenant_id", "work_order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_maintenance_cost_lines_tenant_item
  ON "maintenance_cost_lines" ("tenant_id", "item_id")
  WHERE "item_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. maintenance_work_order_steps (the carried checklist + results —
--    the +10, the carry-over law's own storage).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "maintenance_work_order_steps" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "created_by" uuid,
  "updated_by" uuid,
  "work_order_id" uuid NOT NULL,
  "source_task_id" uuid NOT NULL,
  "seq" integer NOT NULL,
  "title" text NOT NULL,
  "title_ar" text,
  "instruction" text,
  "instruction_ar" text,
  "result" text,
  "result_note" text,
  "result_note_ar" text,
  "recorded_at" timestamptz,
  "recorded_by" uuid,
  CONSTRAINT pk_maintenance_work_order_steps PRIMARY KEY ("id"),
  CONSTRAINT uq_maintenance_work_order_steps_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT uq_maintenance_work_order_steps_order_seq
    UNIQUE ("tenant_id", "work_order_id", "seq"),
  CONSTRAINT fk_maintenance_work_order_steps_work_order
    FOREIGN KEY ("work_order_id", "tenant_id")
    REFERENCES "maintenance_work_orders" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT fk_maintenance_work_order_steps_source_task
    FOREIGN KEY ("source_task_id", "tenant_id")
    REFERENCES "maintenance_plan_tasks" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_maintenance_work_order_steps_seq
    CHECK ("seq" >= 1),
  CONSTRAINT ck_maintenance_work_order_steps_result
    CHECK ("result" IS NULL OR "result" IN ('PASS', 'FAIL')),
  -- The result stamp law: a result and its recording stamp exist
  -- together or not at all (an OPEN step — result IS NULL — is
  -- BR-098's completion blocker; a recorded step always carries when
  -- and never loses its record).
  CONSTRAINT ck_maintenance_work_order_steps_stamp
    CHECK (("result" IS NULL) = ("recorded_at" IS NULL)
      AND ("result" IS NULL OR "recorded_by" IS NOT NULL))
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_maintenance_work_order_steps_tenant_order
  ON "maintenance_work_order_steps" ("tenant_id", "work_order_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. THE stock_moves SOURCE WIDENING (the 0073 DROP+ADD pattern): the
--    completion act's parts issue sources every move to its order.
--> statement-breakpoint
ALTER TABLE "stock_moves" DROP CONSTRAINT IF EXISTS ck_stock_moves_source_shape;

--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT ck_stock_moves_source_shape CHECK ("source_type" IN (
  'manual_receipt', 'manual_issue', 'stock_adjustment', 'stock_count', 'stock_transfer',
  'opening_balance_doc', 'method_switch', 'goods_receipt', 'supplier_invoice', 'landed_cost',
  'delivery_note', 'sales_invoice', 'credit_note', 'job_card', 'production_order',
  'service_order', 'cycle_count', 'quarantine_disposition', 'consignment_settlement',
  'warehouse_kit', 'cross_dock', 'maintenance_work_order'
));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. RLS (the A1–A10 law) + the purge path.
--> statement-breakpoint
ALTER TABLE "maintenance_cost_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "maintenance_cost_lines" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"maintenance_cost_lines"');
--> statement-breakpoint
ALTER TABLE "maintenance_work_order_steps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "maintenance_work_order_steps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"maintenance_work_order_steps"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'maintenance_cost_lines', 'maintenance_work_order_steps'
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
-- 5. Grants — the two line tables' own disciplines.
--    maintenance_cost_lines: master data WITH DELETE (0105's own class
--    for service-guarded lifecycles — the typed service refuses every
--    touch after COMPLETION by name; the open order's lines are the
--    working surface). maintenance_work_order_steps: S/I/U only — NO
--    DELETE ever (BR-098's integrity floor: an open step cannot be
--    deleted to force completion).
--> statement-breakpoint
REVOKE ALL ON "maintenance_cost_lines" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "maintenance_cost_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "maintenance_cost_lines" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "maintenance_cost_lines" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "maintenance_work_order_steps" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "maintenance_work_order_steps" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "maintenance_work_order_steps" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "maintenance_work_order_steps" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "maintenance_cost_lines" IS 'PHASE-049 (D-03/D-04/D-05 — BR-098): the work order''s cost collectors — ONE line per leg (the per-leg XOR shape): LABOR (the technician HR-read + hours + the rate SNAPSHOT — an unset rate is UNPRICED, a typed completion refusal) · PARTS (the item + warehouse + qty; the value is the completion act''s own inventory issue, stamped per line) · EXTERNAL (the supplier partner + the expected bill — the accrual leg the supplier bill''s own posting supersedes) / مجمعات تكاليف أمر الصيانة: عملة أو قطع أو خدمة خارجية — سطر لكل نوع بختم قيمته عند الإنجاز';
--> statement-breakpoint
COMMENT ON TABLE "maintenance_work_order_steps" IS 'PHASE-049 (D-08 — BR-098): the plan''s checklist CARRIED onto generated orders (the seq/title/instruction snapshot at generation) with the per-step results — completion is blocked while any step is open (result IS NULL); a step is never deletable / خطوات قائمة الفحص المنقولة إلى الأمر المولد بنتائجها — لا اكتمال مع خطوة مفتوحة ولا حذف لخطوة أبدًا';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 109)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
