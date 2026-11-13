-- PHASE-043 (Blueprint v3.0 · CR-13) · migration 0075 · Manufacturing II —
-- MRP & Planning (part 2: the BOM planning extension + the bill of
-- resources).
--
-- Purpose (PHASE-043 §2.3/§2.9): the BOM graph grows the planning
-- semantics the audit demanded and the MRP explosion consumes:
--
--   bom_lines.phantom_flag (M-08) — a phantom component never gets its
--     own supply suggestion: at explosion time its OWN components are
--     demanded in its place (flattening — Σ component demand preserved,
--     acceptance criterion 2).
--   bom_substitutions (M-09) — the alternative-material records: ordered
--     substitutes per BOM line; the MRP netting tries them in priority
--     order for the uncovered remainder (the substitution lands on the
--     demand line, never silently — every substituted net is visible).
--   bom_outputs + bills_of_materials.main_allocation_pct (M-11) — the
--     by/co-product outputs of a BOM with the joint-allocation
--     percentages; at activation the BOM validation requires
--     main + Σ outputs = 100 exactly (a typed BOM_ALLOCATION_INVALID
--     otherwise — acceptance criterion 8). The completion posting
--     allocates actual WIP across ALL outputs per these percentages (G-47).
--   bill_of_resources (M-25) — the critical-resource overlay per BOM
--     (work centers with hours-per-output + key materials with
--     qty-per-output), consumed by the rough-cut capacity check against
--     PHASE-042 work-center capacities (capacity_per_shift ×
--     shifts_per_day hours/day — NOT finite scheduling).
--
-- Additive-only: every existing BOM keeps its byte-identical behavior
-- (phantom_flag defaults false, no outputs rows → single-output
-- completion unchanged; main_allocation_pct defaults 100).
--
-- Grants: the substitution/output/BOR rows are recipe-adjacent planning
-- data on versioned BOMs (SELECT/INSERT/UPDATE; DELETE only for
-- bom_substitutions/bom_outputs/bill_of_resources line replacement —
-- the bom_lines DRAFT full-replace discipline extended to its satellite
-- rows; the 0026 delete-grant precedent on bom_lines itself).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. bom_lines.phantom_flag (M-08).
--> statement-breakpoint
ALTER TABLE "bom_lines" ADD COLUMN IF NOT EXISTS "phantom_flag" boolean NOT NULL DEFAULT false;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. bills_of_materials.main_allocation_pct (M-11): 100 by default (the
--    single-output BOM); when outputs exist the activation validation
--    requires main + Σ outputs = 100 exactly.
--> statement-breakpoint
ALTER TABLE "bills_of_materials" ADD COLUMN IF NOT EXISTS "main_allocation_pct" numeric(7, 4) NOT NULL DEFAULT 100;
--> statement-breakpoint
ALTER TABLE "bills_of_materials" DROP CONSTRAINT IF EXISTS "ck_boms_allocation";
--> statement-breakpoint
ALTER TABLE "bills_of_materials" ADD CONSTRAINT ck_boms_allocation CHECK (
  "main_allocation_pct" > 0 AND "main_allocation_pct" <= 100
);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. bom_substitutions (M-09): ordered alternative materials per BOM line.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_substitutions" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "bom_line_id" uuid NOT NULL,
  "substitute_item_id" uuid NOT NULL,
  "priority" smallint NOT NULL,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_bom_substitutions" PRIMARY KEY ("id"),
  CONSTRAINT "uq_bom_substitutions_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_bom_substitutions_line_priority" UNIQUE ("tenant_id", "bom_line_id", "priority"),
  CONSTRAINT "uq_bom_substitutions_line_item" UNIQUE ("tenant_id", "bom_line_id", "substitute_item_id"),
  CONSTRAINT "ck_bom_substitutions_priority" CHECK ("priority" >= 1 AND "priority" <= 20),
  CONSTRAINT "fk_bom_substitutions_line" FOREIGN KEY ("bom_line_id", "tenant_id")
    REFERENCES "bom_lines" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT "fk_bom_substitutions_item" FOREIGN KEY ("substitute_item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bom_substitutions_line"
  ON "bom_substitutions" ("tenant_id", "bom_line_id", "priority");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. bom_outputs (M-11): the co/by-product outputs of a BOM. The MAIN
--    product is the BOM's own item (its allocation rides the header
--    column); output rows carry the rest. qty_per_output: units of this
--    output per parent unit (co-product share of the batch).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bom_outputs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "bom_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "output_kind" text NOT NULL,
  "allocation_pct" numeric(7, 4) NOT NULL,
  "qty_per_output" numeric(19, 6) NOT NULL,
  "uom_id" uuid NOT NULL,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_bom_outputs" PRIMARY KEY ("id"),
  CONSTRAINT "uq_bom_outputs_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_bom_outputs_bom_item" UNIQUE ("tenant_id", "bom_id", "item_id"),
  CONSTRAINT "ck_bom_outputs_kind" CHECK ("output_kind" IN ('CO_PRODUCT', 'BY_PRODUCT')),
  CONSTRAINT "ck_bom_outputs_allocation" CHECK ("allocation_pct" > 0 AND "allocation_pct" < 100),
  CONSTRAINT "ck_bom_outputs_qty" CHECK ("qty_per_output" > 0),
  CONSTRAINT "fk_bom_outputs_bom" FOREIGN KEY ("bom_id", "tenant_id")
    REFERENCES "bills_of_materials" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT "fk_bom_outputs_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_bom_outputs_uom" FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bom_outputs_bom"
  ON "bom_outputs" ("tenant_id", "bom_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. bill_of_resources (M-25): the critical-resource overlay per BOM —
--    exactly one of work_center_id / item_id per row (a WORK_CENTER row
--    carries hours_per_output against the PHASE-042 capacity; a
--    KEY_MATERIAL row carries qty_per_output against material supply).
--    A planning overlay, not costing data: rows attach to a specific BOM
--    version and stay editable while that BOM is ACTIVE (the rough-cut
--    check reads the ACTIVE BOM's rows at planning time).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bill_of_resources" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "bom_id" uuid NOT NULL,
  "line_no" smallint NOT NULL,
  "resource_kind" text NOT NULL,
  "work_center_id" uuid,
  "item_id" uuid,
  "consumption_factor" numeric(19, 6) NOT NULL,
  "note" text,
  "created_by" uuid,
  CONSTRAINT "pk_bill_of_resources" PRIMARY KEY ("id"),
  CONSTRAINT "uq_bill_of_resources_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_bill_of_resources_bom_line" UNIQUE ("tenant_id", "bom_id", "line_no"),
  CONSTRAINT "ck_bill_of_resources_kind" CHECK ("resource_kind" IN ('WORK_CENTER', 'KEY_MATERIAL')),
  CONSTRAINT "ck_bill_of_resources_factor" CHECK ("consumption_factor" > 0),
  CONSTRAINT "ck_bill_of_resources_exactly_one" CHECK (
    ("resource_kind" = 'WORK_CENTER' AND "work_center_id" IS NOT NULL AND "item_id" IS NULL)
    OR ("resource_kind" = 'KEY_MATERIAL' AND "item_id" IS NOT NULL AND "work_center_id" IS NULL)
  ),
  CONSTRAINT "ck_bill_of_resources_line_no" CHECK ("line_no" >= 1 AND "line_no" <= 500),
  CONSTRAINT "fk_bill_of_resources_bom" FOREIGN KEY ("bom_id", "tenant_id")
    REFERENCES "bills_of_materials" ("id", "tenant_id") ON DELETE CASCADE,
  CONSTRAINT "fk_bill_of_resources_work_center" FOREIGN KEY ("work_center_id", "tenant_id")
    REFERENCES "work_centers" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT "fk_bill_of_resources_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bill_of_resources_bom"
  ON "bill_of_resources" ("tenant_id", "bom_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_bill_of_resources_wc"
  ON "bill_of_resources" ("tenant_id", "work_center_id")
  WHERE "work_center_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. RLS — the house triple for the three new tenant tables.
--> statement-breakpoint
ALTER TABLE "bom_substitutions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bom_substitutions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bom_substitutions"');
--> statement-breakpoint
ALTER TABLE "bom_outputs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bom_outputs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bom_outputs"');
--> statement-breakpoint
ALTER TABLE "bill_of_resources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bill_of_resources" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bill_of_resources"');
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bom_substitutions', 'bom_outputs', 'bill_of_resources'] LOOP
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
-- 7. Grants — satellite rows carry the DRAFT full-replace discipline
--    (DELETE granted: the bom_lines 0026 precedent).
--> statement-breakpoint
REVOKE ALL ON "bom_substitutions" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bom_substitutions" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "bom_substitutions" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "bom_substitutions" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "bom_outputs" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bom_outputs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "bom_outputs" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "bom_outputs" TO erp_definer;
--> statement-breakpoint
REVOKE ALL ON "bill_of_resources" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bill_of_resources" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "bill_of_resources" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "bill_of_resources" TO erp_definer;

--> statement-breakpoint
COMMENT ON TABLE "bom_substitutions" IS 'PHASE-043 (M-09): ordered alternative materials per BOM line — netting tries them by priority for the uncovered remainder / المواد البديلة المرتبة لكل بند قائمة مواد — يحاول المحرك تغطية العجز بها حسب الأولوية';
--> statement-breakpoint
COMMENT ON TABLE "bom_outputs" IS 'PHASE-043 (M-11): the co/by-product outputs of a BOM with joint-allocation percentages (main + Σ outputs = 100 at activation — G-47) / مخرجات المنتجات المصاحبة والثانوية مع نسب التخصيص المشترك';
--> statement-breakpoint
COMMENT ON TABLE "bill_of_resources" IS 'PHASE-043 (M-25): the critical-resource overlay per BOM (work centers + key materials) for rough-cut capacity checks — not finite scheduling / قائمة الموارد الحرجة لكل قائمة مواد لفحص السعة التقريبي — ليست جدولة محدودة';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 75)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
