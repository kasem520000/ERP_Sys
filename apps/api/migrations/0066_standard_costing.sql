-- PHASE-042 (Blueprint v3.0 · CR-12, extended by v3.1/CR-45 L2-12) ·
-- migration 0066 · Manufacturing I — the standard-costing layer.
--
-- Purpose (PHASE-042 §2.5a): the v3.1/CR-45 scope addition consolidated
-- BEFORE this phase per the owner's mandate (the decision precedes 042/043):
--
--   item_standard_costs — the frozen standard per item by cost type
--     (material, labor, overhead + overhead sub-splits), versioned with
--     the BOM discipline (exactly one ACTIVE, effective dates); source
--     MANUAL or ROLLED_UP (the low-level cost roll-up over BOM + routing
--     writes a new version; PHASE-043's planning costing and WMS 044's
--     standard valuation consume the frozen ACTIVE row).
--   production_orders extension — std_unit_cost (frozen at release from
--     the item's ACTIVE standard; NULL = no standard, dual mode) +
--     yield_variance (the order-level M-19 variance computed at
--     completion: (planned_qty − actual_qty) × std_unit_cost).
--   CoA markers 5990 PURCHASE_PRICE_VARIANCE + 5995 STANDARD_REVALUATION —
--     the PPV posting at receipt (standard vs actual through the
--     landed-cost point) and the stock revaluation on standard change
--     (the G-13/G-14 adjustment shapes, batch-posted).
--   The seed section (§8–§9): the standard_costs permission, the SIX
--     manufacturing feature-key plan grants (business + enterprise, the
--     0026 precedent), and the food_manufacturing manifest enablement —
--     the manufacturing-bearing template requires the new keys by default
--     (CR-36 (f): template-composable grants).
--
-- Numbering note: see 0065 — the phase doc's planned numbers predate
-- 039/040/041; this is 0066 (journal idx 65, schema_version 66).
--
-- INV-022 ledger (with 0065): +7 tables (ENTITY_CATALOG 232 → 239), +2
-- views, +7 permissions (272 → 279, matrix §3.20 — the doc's
-- "manufacturing.costing" is already live as manufacturing.costing.read
-- since 0026), +6 feature keys, +4 CoA purposes, +3 goldens (G-40/41/42),
-- INV-028, BR-068…071.
--
-- Grants: item_standard_costs is master data (SELECT/INSERT/UPDATE — the
-- version lifecycle, no tombstone deletes).

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 1. item_standard_costs (§2.5a, L2-12): the frozen standard per item —
--    DRAFT → ACTIVE → ARCHIVED with exactly one ACTIVE per item (the BOM
--    discipline); per-unit cost columns at the house unit-cost quantum
--    (19,6 — the stock_layers/item_stock precedent).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_standard_costs" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "item_id" uuid NOT NULL,
  "version_no" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "material_cost" numeric(19, 6) NOT NULL DEFAULT 0,
  "labor_cost" numeric(19, 6) NOT NULL DEFAULT 0,
  "overhead_cost" numeric(19, 6) NOT NULL DEFAULT 0,
  "total_cost" numeric(19, 6) NOT NULL DEFAULT 0,
  -- Overhead sub-splits: [{key, amount}] — the array-ness is pinned here;
  -- the per-element shape is validated by the standard-cost service at
  -- write time (PostgreSQL forbids subqueries in CHECK constraints — the
  -- 0064 variables precedent).
  "overhead_sub_splits" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "source" text NOT NULL DEFAULT 'MANUAL',
  "effective_from" date,
  "rolled_up_at" timestamptz,
  "activated_at" timestamptz,
  "archived_at" timestamptz,
  "note" text,
  "note_ar" text,
  "created_by" uuid,
  CONSTRAINT "pk_item_standard_costs" PRIMARY KEY ("id"),
  CONSTRAINT "uq_item_standard_costs_id_tenant" UNIQUE ("id", "tenant_id"),
  CONSTRAINT "uq_item_standard_costs_tenant_item_version" UNIQUE ("tenant_id", "item_id", "version_no"),
  CONSTRAINT "ck_item_standard_costs_status" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  CONSTRAINT "ck_item_standard_costs_version_no" CHECK ("version_no" >= 1),
  CONSTRAINT "ck_item_standard_costs_source" CHECK ("source" IN ('MANUAL', 'ROLLED_UP')),
  -- Costs are non-negative per-unit values.
  CONSTRAINT "ck_item_standard_costs_costs" CHECK (
    "material_cost" >= 0 AND "labor_cost" >= 0 AND "overhead_cost" >= 0
  ),
  -- The total is exactly the typed sum — never a hand-typed fourth number.
  CONSTRAINT "ck_item_standard_costs_total" CHECK (
    "total_cost" = "material_cost" + "labor_cost" + "overhead_cost"
  ),
  -- A roll-up carries its roll-up timestamp.
  CONSTRAINT "ck_item_standard_costs_rolled_up" CHECK (
    "source" <> 'ROLLED_UP' OR "rolled_up_at" IS NOT NULL
  ),
  CONSTRAINT "ck_item_standard_costs_overhead_splits_shape" CHECK (
    jsonb_typeof("overhead_sub_splits") = 'array'
  ),
  CONSTRAINT "fk_item_standard_costs_item" FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT
);

--> statement-breakpoint
-- Exactly one ACTIVE standard per item (the BOM discipline — the 0026
-- uq_bills_of_materials_active_item pattern).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_item_standard_costs_active_item"
  ON "item_standard_costs" ("tenant_id", "item_id") WHERE "status" = 'ACTIVE';

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_item_standard_costs_tenant_status"
  ON "item_standard_costs" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_item_standard_costs_tenant_item"
  ON "item_standard_costs" ("tenant_id", "item_id", "status");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 2. production_orders extension (§2.5a): additive columns ONLY —
--    std_unit_cost frozen at release (NULL = no ACTIVE standard existed —
--    dual mode, the flat-rate path unchanged); yield_variance computed at
--    completion.
--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "std_unit_cost" numeric(19, 6);
--> statement-breakpoint
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "yield_variance" numeric(19, 4) NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "production_orders"
  ADD CONSTRAINT "ck_production_orders_std_unit_cost" CHECK (
    "std_unit_cost" IS NULL OR "std_unit_cost" >= 0
  ) NOT VALID;
--> statement-breakpoint
COMMENT ON COLUMN "production_orders"."std_unit_cost" IS 'PHASE-042 (L2-12): the frozen per-unit standard at release (NULL = no ACTIVE standard — dual mode)';
--> statement-breakpoint
COMMENT ON COLUMN "production_orders"."yield_variance" IS 'PHASE-042 (M-19): order-level yield variance = (planned_qty − actual_qty) × std_unit_cost, computed at completion';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 3. RLS — the house triple.
--> statement-breakpoint
ALTER TABLE "item_standard_costs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "item_standard_costs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"item_standard_costs"');
--> statement-breakpoint
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS purge_path_delete ON public.item_standard_costs';
  EXECUTE 'DROP POLICY IF EXISTS purge_path_update ON public.item_standard_costs';
  EXECUTE format('CREATE POLICY purge_path_delete ON public.item_standard_costs FOR DELETE TO erp_migrate '
    || 'USING (tenant_id = erp.current_tenant_id())');
  EXECUTE format('CREATE POLICY purge_path_update ON public.item_standard_costs FOR UPDATE TO erp_migrate '
    || 'USING (tenant_id = erp.current_tenant_id()) WITH CHECK (true)');
END $$;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 4. Grants.
--> statement-breakpoint
REVOKE ALL ON "item_standard_costs" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "item_standard_costs" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "item_standard_costs" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "item_standard_costs" TO erp_definer;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 5. Bilingual table comment.
--> statement-breakpoint
COMMENT ON TABLE "item_standard_costs" IS 'PHASE-042 (L2-12/CR-45): the frozen per-item standard cost by type (material/labor/overhead + sub-splits) — versioned, one ACTIVE (the BOM discipline) / التكلفة المعيارية المجمّدة للصنف حسب النوع: مادة وأجور ومصاريف غير مباشرة، بنسخ واحدة نشطة كقوائم المواد';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 6. CoA template markers (the 0026 additive pattern): the standard-cost
--    variance pair. PPV posts at receipt (standard vs actual, through the
--    landed-cost point — G-42's sibling goldens land in JOURNAL_RULES §7);
--    revaluation posts on standard change (batch, the G-13/G-14 shapes).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('5990', 'Purchase price variance', 'انحراف سعر الشراء', 'EXPENSE', false, '5000', 'PURCHASE_PRICE_VARIANCE'),
  ('5995', 'Standard cost revaluation', 'إعادة تقييم التكلفة المعيارية', 'EXPENSE', false, '5000', 'STANDARD_REVALUATION')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 7. Permission seed (matrix §3.20; zero-drift 278 → 279): the seventh key.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('manufacturing.standard_costs.manage', 'manufacturing', 'Manage item standard costs (roll-up, freeze/activate, revaluation) / إدارة التكاليف المعيارية للأصناف (التجميع والتجميد والتفعيل وإعادة التقييم)')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.standard_costs.manage'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.standard_costs.manage'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 8. Feature plan grants (FEATURE_CATALOG §protocol step 3; the 0026
--    manufacturing precedent): the SIX manufacturing-execution keys join
--    business + enterprise (starter excluded; enterprise carries them from
--    the base seed philosophy — the guard keeps it idempotent).
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['manufacturing.routing', 'manufacturing.work_centers',
        'manufacturing.shopfloor', 'manufacturing.rework',
        'manufacturing.downtime', 'manufacturing.standard_costs'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('manufacturing.routing' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- 9. food_manufacturing manifest enablement (CR-36 (f)): the manufacturing-
--    bearing template requires the new keys by default — required_feature_
--    keys gains the six execution keys (canonical order: the manufacturing
--    block). The docs mirror + the contracts verbatim transcription move
--    with this seed (the byte/hash pins re-anchored — the 039 re-pin
--    procedure).
--> statement-breakpoint
UPDATE "industry_templates" SET "manifest" = $mfg${
  "id": "industry.food_manufacturing",
  "name": "Food Manufacturing",
  "name_ar": "التصنيع الغذائي",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine",
    "manufacturing.bom",
    "manufacturing.production_orders",
    "manufacturing.qc",
    "manufacturing.batch_genealogy",
    "manufacturing.routing",
    "manufacturing.work_centers",
    "manufacturing.shopfloor",
    "manufacturing.rework",
    "manufacturing.downtime",
    "manufacturing.standard_costs",
    "inventory.multi_warehouse",
    "inventory.batch_tracking",
    "inventory.stock_counts",
    "items.price_lists",
    "purchasing.landed_costs"
  ],
  "default_modules_enabled": [
    "accounting",
    "partners",
    "items",
    "inventory",
    "sales",
    "purchasing",
    "treasury",
    "tax",
    "reporting",
    "manufacturing",
    "configuration"
  ],
  "terminology_overrides": {
    "mfg.recipe": {
      "en": "Recipe (BOM)",
      "ar": "الوصفة (قائمة المواد)"
    },
    "mfg.production_order": {
      "en": "Production order",
      "ar": "أمر الإنتاج"
    },
    "mfg.yield": {
      "en": "Yield",
      "ar": "المردود"
    },
    "mfg.scrap": {
      "en": "Scrap",
      "ar": "الهالك"
    },
    "mfg.qc_gate": {
      "en": "QC gate",
      "ar": "بوابة فحص الجودة"
    },
    "mfg.batch_genealogy": {
      "en": "Batch genealogy",
      "ar": "شجرة الدفعات"
    },
    "mfg.semi_finished": {
      "en": "Semi-finished",
      "ar": "نصف مصنّع"
    },
    "item.shelf_life": {
      "en": "Shelf life (days)",
      "ar": "مدة الصلاحية (أيام)"
    },
    "mfg.production_line": {
      "en": "Production line",
      "ar": "خط الإنتاج"
    }
  },
  "navigation_manifest": {
    "groups": [
      {
        "id": "production",
        "label": {
          "en": "Production",
          "ar": "الإنتاج"
        },
        "order": 1,
        "items": [
          {
            "id": "recipes",
            "label": {
              "en": "Recipes (BOM)",
              "ar": "الوصفات (قائمة المواد)"
            },
            "target": "manufacturing.bom"
          },
          {
            "id": "orders",
            "label": {
              "en": "Production orders",
              "ar": "أوامر الإنتاج"
            },
            "target": "manufacturing.orders"
          },
          {
            "id": "qc",
            "label": {
              "en": "QC inspections",
              "ar": "فحوصات الجودة"
            },
            "target": "manufacturing.qc"
          }
        ]
      },
      {
        "id": "trace",
        "label": {
          "en": "Traceability",
          "ar": "التتبع"
        },
        "order": 2,
        "items": [
          {
            "id": "genealogy",
            "label": {
              "en": "Batch genealogy",
              "ar": "شجرة الدفعات"
            },
            "target": "manufacturing.genealogy"
          },
          {
            "id": "expiry",
            "label": {
              "en": "Expiry control",
              "ar": "الرقابة على الصلاحية"
            },
            "target": "inventory.expiry_list"
          }
        ]
      }
    ]
  },
  "workflow_policies": {
    "production_qc_gate": "required",
    "fg_batch_expiry_from_shelf_life": true,
    "scrap_reason_required": true,
    "consumption_variance_threshold_pct": 5,
    "expiry_writeoff_requires_approval": true,
    "markdown_requires_approval": false
  },
  "document_numbering_defaults": {
    "production_order": {
      "prefix": "PRD",
      "format": "PRD-{yyyy}-{seq:5}",
      "per_branch": true,
      "reserve_on_approval": true
    },
    "goods_receipt": {
      "prefix": "GRN",
      "format": "GRN-{yyyy}-{seq:6}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "sales_invoice": {
      "prefix": "INV",
      "format": "INV-{yyyy}-{seq:6}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "delivery_note": {
      "prefix": "DLV",
      "format": "DLV-{yyyy}-{seq:5}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "stock_adjustment": {
      "prefix": "ADJ",
      "format": "ADJ-{yyyy}-{seq:5}",
      "per_branch": false,
      "reserve_on_approval": false
    }
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
    {
      "report_key": "manufacturing.production_cost",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_month"
    },
    {
      "report_key": "manufacturing.batch_genealogy",
      "pinned": true,
      "dashboard": false,
      "default_period": "custom"
    },
    {
      "report_key": "manufacturing.qc_inspection_log",
      "pinned": true,
      "dashboard": false,
      "default_period": "this_month"
    },
    {
      "report_key": "inventory.expiry_list",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_week"
    },
    {
      "report_key": "grocery.expiry_writeoff",
      "pinned": true,
      "dashboard": false,
      "default_period": "this_month"
    }
  ],
  "onboarding_steps": [
    {
      "id": "warehouses",
      "title": {
        "en": "Raw materials, WIP and finished-goods warehouses",
        "ar": "مستودعات المواد الخام والتشغيل والإنتاج التام"
      },
      "required": true
    },
    {
      "id": "coa_confirm",
      "title": {
        "en": "Confirm chart of accounts (WIP, scrap accounts)",
        "ar": "تأكيد دليل الحسابات (حسابات تحت التشغيل والهالك)"
      },
      "required": true
    },
    {
      "id": "recipes",
      "title": {
        "en": "Recipes with yield",
        "ar": "الوصفات مع المردود"
      },
      "required": true
    },
    {
      "id": "materials",
      "title": {
        "en": "Materials with batches & suppliers",
        "ar": "المواد مع الدفعات والموردون"
      },
      "required": true
    },
    {
      "id": "fg_shelf_life",
      "title": {
        "en": "Finished goods & shelf-life defaults",
        "ar": "المنتجات التامة ومدد الصلاحية"
      },
      "required": true
    },
    {
      "id": "first_run",
      "title": {
        "en": "Run first production order end-to-end",
        "ar": "تنفيذ أول أمر إنتاج كامل"
      },
      "required": false
    },
    {
      "id": "outlet",
      "title": {
        "en": "Optional factory outlet counter",
        "ar": "كاونتر منفذ بيع المصنع (اختياري)"
      },
      "required": false,
      "feature_key": "pos.sales"
    }
  ],
  "capability_prerequisites": {
    "bom_production": {
      "level": "REQUIRED",
      "feature_keys": [
        "manufacturing.bom",
        "manufacturing.production_orders"
      ],
      "available_from_phase": "PHASE-018"
    },
    "qc_inspections": {
      "level": "REQUIRED",
      "feature_keys": [
        "manufacturing.qc"
      ],
      "available_from_phase": "PHASE-018"
    },
    "batch_genealogy": {
      "level": "REQUIRED",
      "feature_keys": [
        "manufacturing.batch_genealogy"
      ],
      "available_from_phase": "PHASE-018"
    },
    "expiry_tracking_fefo": {
      "level": "REQUIRED",
      "feature_keys": [
        "inventory.batch_tracking"
      ],
      "available_from_phase": "PHASE-010"
    },
    "landed_costs": {
      "level": "REQUIRED",
      "feature_keys": [
        "purchasing.landed_costs"
      ],
      "available_from_phase": "PHASE-011"
    },
    "barcode_pos": {
      "level": "OPTIONAL",
      "feature_keys": [
        "pos.terminals",
        "pos.sales",
        "pos.receipts"
      ],
      "available_from_phase": "PHASE-016"
    },
    "cashier_shifts": {
      "level": "OPTIONAL",
      "feature_keys": [
        "treasury.cashier_shifts"
      ],
      "available_from_phase": "PHASE-016"
    },
    "customer_price_tiers": {
      "level": "OPTIONAL",
      "feature_keys": [
        "distribution.customer_tiers"
      ],
      "available_from_phase": "PHASE-017"
    }
  }
}
$mfg$
WHERE "key" = 'industry.food_manufacturing';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 66)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
