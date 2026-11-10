-- PHASE-018 · migration 0026 · Manufacturing & Production foundation
--
-- Purpose (PHASE-018 §2/§7; ENTITY_CATALOG §manufacturing): the data model
-- for the manufacturing module, all additive:
-- - manufacturing-owned: `bills_of_materials` + `bom_lines` (versioned
--   recipes per item — DRAFT → ACTIVE → ARCHIVED with exactly one ACTIVE
--   version per item, yield_pct + per-component scrap_pct, the level-1
--   snapshot substrate for explosion), `production_orders` +
--   `production_order_lines` (DRAFT → RELEASED → IN_PROGRESS → COMPLETED /
--   CANCELLED, the PRD- numbering + BOM bind at release, per-order WIP
--   costing columns), `production_consumptions` (batch-linked material
--   issues — the genealogy upstream edges), `production_scraps`
--   (reason-coded WIP scrap), `inspections` (QC pass/fail + dispositions
--   against production orders or goods receipts).
-- - inventory-owned additive: `item_batches.status` widens with
--   'QUARANTINED' (the QC gate holds completed FG batches until inspection
--   releases them); `stock_moves.source_type` widens with
--   'production_order'; `warehouses` gains `role` ('RAW'|'WIP'|'FG'
--   convention only); `items` gains `shelf_life_days`; `item_batches` gains
--   `production_order_id` (produced-batch provenance — the genealogy edge).
-- - chart_of_accounts_template: 1160 WIP (ASSET, parent 1100) + 5120
--   PRODUCTION_SCRAP (EXPENSE, parent 5000) + the 5400 absorption group
--   with leaves 5410 PRODUCTION_LABOR / 5420 PRODUCTION_OVERHEAD (the
--   completion journal's absorbed-labor/overhead credit lines).
-- - permission seeds (AUTHORIZATION_MATRIX §3.8 manufacturing block; 8
--   keys) + plan/role wiring (the 7 manufacturing feature keys join
--   business + enterprise; starter does NOT get them).
-- - template registry seed: `industry.food_manufacturing` v1.0.0, manifest
--   verbatim from docs/industries/templates/manifests/
--   manifest.food_manufacturing.json (the canonical source; the contracts
--   constant derives from the same file).
--
-- All tenant-owned tables get the PHASE-002 RLS macro.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- bills_of_materials + bom_lines (manufacturing-owned; the versioned recipe).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bills_of_materials" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "item_id" uuid NOT NULL,
  "version_no" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "output_uom_id" uuid NOT NULL,
  "yield_pct" numeric(7,4) NOT NULL DEFAULT 100.0000,
  "effective_from" date,
  "note" text,
  "note_ar" text,
  "activated_at" timestamptz,
  "archived_at" timestamptz,
  CONSTRAINT pk_bills_of_materials PRIMARY KEY ("id"),
  CONSTRAINT uq_bills_of_materials_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_bills_of_materials_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_bills_of_materials_uom FOREIGN KEY ("output_uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_bills_of_materials_status CHECK ("status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  CONSTRAINT ck_bills_of_materials_yield CHECK ("yield_pct" > 0 AND "yield_pct" <= 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_bills_of_materials_tenant_item_version
  ON "bills_of_materials" ("tenant_id", "item_id", "version_no");
--> statement-breakpoint
-- Exactly one ACTIVE version per item (the level-1 explosion resolves it).
CREATE UNIQUE INDEX IF NOT EXISTS uq_bills_of_materials_active_item
  ON "bills_of_materials" ("tenant_id", "item_id") WHERE "status" = 'ACTIVE';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bills_of_materials_tenant_status ON "bills_of_materials" ("tenant_id", "status");
--> statement-breakpoint
ALTER TABLE "bills_of_materials" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bills_of_materials"');

--> statement-breakpoint
-- Component lines; DELETE granted for the DRAFT full-replace (the only
-- manufacturing table with a delete grant).
CREATE TABLE IF NOT EXISTS "bom_lines" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "bom_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "component_item_id" uuid NOT NULL,
  "uom_id" uuid NOT NULL,
  "qty_per_output" numeric(19,6) NOT NULL,
  "scrap_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_bom_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_bom_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_bom_lines_bom FOREIGN KEY ("bom_id", "tenant_id")
    REFERENCES "bills_of_materials" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_bom_lines_component FOREIGN KEY ("component_item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_bom_lines_uom FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_bom_lines_qty_per_output CHECK ("qty_per_output" > 0),
  CONSTRAINT ck_bom_lines_scrap_pct CHECK ("scrap_pct" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_bom_lines_bom_line ON "bom_lines" ("tenant_id", "bom_id", "line_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_bom_lines_tenant_component ON "bom_lines" ("tenant_id", "component_item_id");
--> statement-breakpoint
ALTER TABLE "bom_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"bom_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- production_orders + production_order_lines (manufacturing-owned; the
-- PRD- work order — release binds the BOM version and snapshots the
-- level-1 explosion as order lines).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_orders" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "branch_id" uuid NOT NULL,
  "order_no" text,
  "status" text NOT NULL DEFAULT 'DRAFT',
  "bom_id" uuid,
  "item_id" uuid NOT NULL,
  "uom_id" uuid NOT NULL,
  "planned_qty" numeric(19,6) NOT NULL,
  "planned_date" date,
  "actual_qty" numeric(19,6) NOT NULL DEFAULT 0,
  "materials_warehouse_id" uuid NOT NULL,
  "fg_warehouse_id" uuid NOT NULL,
  "labor_rate" numeric(19,6) NOT NULL DEFAULT 0,
  "overhead_rate" numeric(19,6) NOT NULL DEFAULT 0,
  "cost_center_id" uuid,
  "yield_snapshot" numeric(7,4),
  "fg_batch_id" uuid,
  "fg_journal_id" uuid,
  "fg_value" numeric(19,4) NOT NULL DEFAULT 0,
  "wip_credit_value" numeric(19,4) NOT NULL DEFAULT 0,
  "labor_value" numeric(19,4) NOT NULL DEFAULT 0,
  "overhead_value" numeric(19,4) NOT NULL DEFAULT 0,
  "note" text,
  "note_ar" text,
  "cancel_reason" text,
  "released_at" timestamptz,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "cancelled_at" timestamptz,
  CONSTRAINT pk_production_orders PRIMARY KEY ("id"),
  CONSTRAINT uq_production_orders_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_production_orders_branch FOREIGN KEY ("branch_id", "tenant_id")
    REFERENCES "branches" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_production_orders_bom FOREIGN KEY ("bom_id", "tenant_id")
    REFERENCES "bills_of_materials" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_production_orders_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_production_orders_uom FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_production_orders_materials_wh FOREIGN KEY ("materials_warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_production_orders_fg_wh FOREIGN KEY ("fg_warehouse_id", "tenant_id")
    REFERENCES "warehouses" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_production_orders_status CHECK ("status" IN ('DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT ck_production_orders_planned_qty CHECK ("planned_qty" > 0),
  CONSTRAINT ck_production_orders_cancel_requires_reason CHECK (
    "status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancel_reason" IS NOT NULL)
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_orders_tenant_no
  ON "production_orders" ("tenant_id", "order_no") WHERE "order_no" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_production_orders_tenant_status ON "production_orders" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_production_orders_tenant_item ON "production_orders" ("tenant_id", "item_id");
--> statement-breakpoint
ALTER TABLE "production_orders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"production_orders"');

--> statement-breakpoint
-- The frozen level-1 explosion snapshot (bound at release; over_plan flags
-- the §5 variance review once consumption crosses the threshold).
CREATE TABLE IF NOT EXISTS "production_order_lines" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "order_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "component_item_id" uuid NOT NULL,
  "uom_id" uuid NOT NULL,
  "planned_qty" numeric(19,6) NOT NULL,
  "scrap_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "actual_qty" numeric(19,6) NOT NULL DEFAULT 0,
  "over_plan" boolean NOT NULL DEFAULT false,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_production_order_lines PRIMARY KEY ("id"),
  CONSTRAINT uq_production_order_lines_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_production_order_lines_order FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "production_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_production_order_lines_component FOREIGN KEY ("component_item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_production_order_lines_uom FOREIGN KEY ("uom_id", "tenant_id")
    REFERENCES "uoms" ("id", "tenant_id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_order_lines_order_line
  ON "production_order_lines" ("tenant_id", "order_id", "line_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_production_order_lines_tenant_order_item
  ON "production_order_lines" ("tenant_id", "order_id", "component_item_id");
--> statement-breakpoint
ALTER TABLE "production_order_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"production_order_lines"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- production_consumptions (manufacturing-owned; the batch-linked material
-- issue — one row per consumed component batch, the journal anchored at
-- consume time; genealogy upstream edges).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_consumptions" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "order_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "batch_id" uuid,
  "qty" numeric(19,6) NOT NULL,
  "unit_cost" numeric(19,6) NOT NULL,
  "value" numeric(19,4) NOT NULL,
  "journal_id" uuid,
  "consumed_at" timestamptz NOT NULL,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_production_consumptions PRIMARY KEY ("id"),
  CONSTRAINT uq_production_consumptions_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_production_consumptions_order FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "production_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_production_consumptions_item FOREIGN KEY ("item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_production_consumptions_qty CHECK ("qty" > 0),
  CONSTRAINT ck_production_consumptions_unit_cost CHECK ("unit_cost" >= 0),
  CONSTRAINT ck_production_consumptions_value CHECK ("value" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_production_consumptions_tenant_order
  ON "production_consumptions" ("tenant_id", "order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_production_consumptions_tenant_item
  ON "production_consumptions" ("tenant_id", "item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_production_consumptions_tenant_batch
  ON "production_consumptions" ("tenant_id", "batch_id") WHERE "batch_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "production_consumptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"production_consumptions"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- production_scraps (manufacturing-owned; reason-coded pre-completion WIP
-- scrap — value ≤ the order's running WIP balance is service-enforced).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "production_scraps" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "order_id" uuid NOT NULL,
  "reason_code" text NOT NULL,
  "qty" numeric(19,6) NOT NULL,
  "value" numeric(19,4) NOT NULL,
  "journal_id" uuid,
  "scrapped_at" timestamptz NOT NULL,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_production_scraps PRIMARY KEY ("id"),
  CONSTRAINT uq_production_scraps_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_production_scraps_order FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "production_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_production_scraps_reason_shape CHECK (char_length("reason_code") BETWEEN 1 AND 40),
  CONSTRAINT ck_production_scraps_qty CHECK ("qty" > 0),
  CONSTRAINT ck_production_scraps_value CHECK ("value" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_production_scraps_tenant_order ON "production_scraps" ("tenant_id", "order_id");
--> statement-breakpoint
ALTER TABLE "production_scraps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"production_scraps"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- inspections (manufacturing-owned; QC pass/fail + dispositions against
-- production orders (FG batches) or goods receipts; releasing a QUARANTINED
-- FG batch back to ACTIVE is the PASS+ACCEPT outcome — no journal).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inspections" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "version" integer NOT NULL DEFAULT 1,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_by" uuid,
  "target_type" text NOT NULL,
  "order_id" uuid,
  "grn_id" uuid,
  "fg_batch_id" uuid,
  "result" text NOT NULL,
  "sampled" boolean NOT NULL DEFAULT false,
  "sample_size" integer,
  "disposition" text,
  "inspected_at" timestamptz NOT NULL,
  "note" text,
  "note_ar" text,
  CONSTRAINT pk_inspections PRIMARY KEY ("id"),
  CONSTRAINT uq_inspections_id_tenant UNIQUE ("id", "tenant_id"),
  CONSTRAINT fk_inspections_order FOREIGN KEY ("order_id", "tenant_id")
    REFERENCES "production_orders" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_inspections_grn FOREIGN KEY ("grn_id", "tenant_id")
    REFERENCES "goods_receipts" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_inspections_target_type CHECK ("target_type" IN ('production_order', 'goods_receipt')),
  CONSTRAINT ck_inspections_target_shape CHECK (
    ("target_type" <> 'production_order' OR "order_id" IS NOT NULL)
    AND ("target_type" <> 'goods_receipt' OR "grn_id" IS NOT NULL)
  ),
  CONSTRAINT ck_inspections_result CHECK ("result" IN ('PASS', 'FAIL')),
  CONSTRAINT ck_inspections_disposition CHECK (
    "disposition" IS NULL OR "disposition" IN ('ACCEPT', 'SCRAP', 'REWORK', 'RETURN_TO_SUPPLIER')
  ),
  CONSTRAINT ck_inspections_fail_needs_disposition CHECK ("result" = 'PASS' OR "disposition" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_inspections_tenant_order
  ON "inspections" ("tenant_id", "order_id") WHERE "order_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_inspections_tenant_grn
  ON "inspections" ("tenant_id", "grn_id") WHERE "grn_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "inspections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"inspections"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Widenings (additive CHECK re-issues + new nullable columns). The
-- item_batches FK needs production_orders to exist, hence this block sits
-- after the table creates above.
--> statement-breakpoint
ALTER TABLE "item_batches" DROP CONSTRAINT IF EXISTS ck_item_batches_status_values;
--> statement-breakpoint
ALTER TABLE "item_batches" ADD CONSTRAINT ck_item_batches_status_values
  CHECK ("status" IN ('ACTIVE', 'QUARANTINED', 'WRITTEN_OFF'));
--> statement-breakpoint
ALTER TABLE "stock_moves" DROP CONSTRAINT IF EXISTS ck_stock_moves_source_shape;
--> statement-breakpoint
ALTER TABLE "stock_moves" ADD CONSTRAINT ck_stock_moves_source_shape CHECK ("source_type" IN (
  'manual_receipt', 'manual_issue', 'stock_adjustment', 'stock_count', 'stock_transfer',
  'opening_balance_doc', 'method_switch', 'goods_receipt', 'supplier_invoice', 'landed_cost',
  'delivery_note', 'sales_invoice', 'credit_note', 'job_card', 'production_order'
));
--> statement-breakpoint
ALTER TABLE "warehouses" ADD COLUMN IF NOT EXISTS "role" text;
--> statement-breakpoint
ALTER TABLE "warehouses" DROP CONSTRAINT IF EXISTS ck_warehouses_role_values;
--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT ck_warehouses_role_values
  CHECK ("role" IS NULL OR "role" IN ('RAW', 'WIP', 'FG'));
--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "shelf_life_days" integer;
--> statement-breakpoint
ALTER TABLE "item_batches" ADD COLUMN IF NOT EXISTS "production_order_id" uuid;
--> statement-breakpoint
ALTER TABLE "item_batches" DROP CONSTRAINT IF EXISTS fk_item_batches_production_order;
--> statement-breakpoint
ALTER TABLE "item_batches" ADD CONSTRAINT fk_item_batches_production_order
  FOREIGN KEY ("production_order_id", "tenant_id")
  REFERENCES "production_orders" ("id", "tenant_id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_batches_tenant_production_order
  ON "item_batches" ("tenant_id", "production_order_id") WHERE "production_order_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- chart_of_accounts_template: the WIP + production-scrap/absorption markers
-- (additive; existing tenants map once — fail-closed PURPOSE_NOT_MAPPED
-- until then, the CARD_RECEIVABLE precedent DR-016-02).
--> statement-breakpoint
INSERT INTO "chart_of_accounts_template" ("code", "name", "name_ar", "type", "is_group", "parent_code", "purpose_key") VALUES
  ('1160', 'Work in progress', 'تحت التشغيل', 'ASSET', false, '1100', 'WIP'),
  ('5120', 'Production scrap', 'التالف (الإنتاج)', 'EXPENSE', false, '5000', 'PRODUCTION_SCRAP'),
  ('5400', 'Production absorption', 'استيعاب تكاليف الإنتاج', 'EXPENSE', true, '5000', NULL),
  ('5410', 'Applied production labor', 'أجور الإنتاج المطبقة', 'EXPENSE', false, '5400', 'PRODUCTION_LABOR'),
  ('5420', 'Applied production overhead', 'مصاريف إنتاج غير مباشرة مطبقة', 'EXPENSE', false, '5400', 'PRODUCTION_OVERHEAD')
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "type" = EXCLUDED."type", "is_group" = EXCLUDED."is_group",
      "parent_code" = EXCLUDED."parent_code", "purpose_key" = EXCLUDED."purpose_key";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Template registry seed: the PHASE-018 manifest, verbatim from
-- docs/industries/templates/manifests/manifest.food_manufacturing.json (the
-- canonical source). Idempotent upsert on key; the 0008 index row converges
-- to the full manifest, is_active = true, status = 'ACTIVE'.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest", "is_active", "status") VALUES
  ('industry.food_manufacturing', 'Food Manufacturing', 'التصنيع الغذائي', '1.0.0',
   '{
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
}'::jsonb, true, 'ACTIVE')
ON CONFLICT ("key") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "version" = EXCLUDED."version", "manifest" = EXCLUDED."manifest",
      "is_active" = true, "status" = 'ACTIVE';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Permission seeds (AUTHORIZATION_MATRIX §3.8 manufacturing block; the
-- drift checker requires matrix ↔ seed parity).
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('manufacturing.boms.manage', 'manufacturing', 'BOM maintenance / إدارة قوائم المواد'),
('manufacturing.production_orders.view', 'manufacturing', 'View production orders / عرض أوامر الإنتاج'),
('manufacturing.production_orders.create', 'manufacturing', 'Create and edit draft production orders / إنشاء وتحرير أوامر الإنتاج'),
('manufacturing.production_orders.approve', 'manufacturing', 'Release, start and cancel production orders / اعتماد أوامر الإنتاج'),
('manufacturing.production_orders.post', 'manufacturing', 'Post consumption, scrap and completion / ترحيل الاستهلاك والهالك والإتمام'),
('manufacturing.qc.manage', 'manufacturing', 'QC inspections and dispositions / إدارة فحوص الجودة'),
('manufacturing.genealogy.read', 'manufacturing', 'Batch genealogy reads / قراءة شجرة الدفعات'),
('manufacturing.costing.read', 'manufacturing', 'Production costing reads / قراءة تكاليف الإنتاج')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Plan grants (FEATURE_CATALOG §25 protocol step 3): the manufacturing set
-- joins business + enterprise. Enterprise already carries the seven keys
-- from the 0008 base seed, so the guard makes it a no-op there; starter
-- does NOT get them. Idempotent array_cat.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['manufacturing.bom', 'manufacturing.production_orders', 'manufacturing.wip',
        'manufacturing.costing', 'manufacturing.scrap', 'manufacturing.batch_genealogy',
        'manufacturing.qc'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('manufacturing.bom' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- System role-template grants (the 0005 cross-join predates the 0026
-- keys): owner gains the full set; viewer and accountant gain the read
-- tier; warehouse gains the operational tier (view/create + QC).
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.boms.manage', 'manufacturing.production_orders.view',
  'manufacturing.production_orders.create', 'manufacturing.production_orders.approve',
  'manufacturing.production_orders.post', 'manufacturing.qc.manage',
  'manufacturing.genealogy.read', 'manufacturing.costing.read'
)
WHERE r."key" = 'owner' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.production_orders.view', 'manufacturing.genealogy.read',
  'manufacturing.costing.read'
)
WHERE r."key" = 'viewer' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.production_orders.view', 'manufacturing.production_orders.create',
  'manufacturing.qc.manage'
)
WHERE r."key" = 'warehouse' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "tenant_id", "permission_id")
SELECT r."id", NULL, p."key"
FROM "roles" r JOIN "permissions" p ON p."key" IN (
  'manufacturing.production_orders.view', 'manufacturing.genealogy.read',
  'manufacturing.costing.read'
)
WHERE r."key" = 'accountant' AND r."tenant_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

--> statement-breakpoint
-- Grants (erp_app writes; erp_readonly reads; erp_definer read surface).
-- bom_lines carries DELETE (the DRAFT full-replace); everything else is
-- status-lifecycled (no tombstone deletes).
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "bills_of_materials", "production_orders",
  "production_order_lines", "production_consumptions", "production_scraps",
  "inspections" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bom_lines" TO erp_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON "item_batches", "items", "warehouses" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "bills_of_materials", "bom_lines", "production_orders",
  "production_order_lines", "production_consumptions", "production_scraps",
  "inspections" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "bills_of_materials", "bom_lines", "production_orders",
  "production_order_lines", "production_consumptions", "production_scraps",
  "inspections", "item_batches", "items", "warehouses"
  TO erp_definer;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 26)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
