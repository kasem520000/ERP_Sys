-- PHASE-015 · migration 0022 · industry configuration framework
--
-- Purpose (PHASE-015 §4; CONFIGURATION_ENGINE §3; INDUSTRIES/README §8):
-- the template engine goes live. `industry_templates` gains the registry
-- lifecycle status (ACTIVE/DRAFT/RETIRED — the 004 seed stub becomes the
-- engine-owned registry) and the three PHASE-015 priority manifests at
-- v1.0.0, seeded verbatim from
-- docs/industries/templates/{retail,grocery-supermarket,restaurant-cafe}.md
-- (the 0008 index stubs of the other ten templates stay until their owning
-- phases ship). `tenant_industry_config` records the applied-template state
-- per tenant — exactly one row per tenant (UNIQUE (tenant_id)); the BR-038
-- additive-only switch archives ride as jsonb snapshots (terminology,
-- navigation, capabilities + conflict notes), never as extra rows.
-- `feature_flags` is the L8 platform rollout-flag table (platform delivery
-- only, never tenant policy — no tenant_id, no RLS; global reference,
-- writable only via erp_migrate). `item_components` carries the
-- composite-product definitions (T9 items.composite_products): the explosion
-- contract reads these rows; one row per (composite, component) pair.
--
-- All tenant-owned tables get the PHASE-002 RLS macro; the registry and the
-- flags table stay global references (SELECT-only grants for erp_app).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- industry_templates: registry lifecycle status (PHASE-015 §4 — the 0008
-- index becomes the engine-owned registry; ACTIVE/DRAFT/RETIRED).
--> statement-breakpoint
ALTER TABLE "industry_templates" ADD COLUMN "status" text NOT NULL DEFAULT 'ACTIVE';
--> statement-breakpoint
ALTER TABLE "industry_templates" DROP CONSTRAINT IF EXISTS ck_industry_templates_status_values;
--> statement-breakpoint
ALTER TABLE "industry_templates" ADD CONSTRAINT ck_industry_templates_status_values
  CHECK ("status" IN ('ACTIVE', 'DRAFT', 'RETIRED'));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Template registry seeds (T4): the three PHASE-015 priority manifests,
-- verbatim from the template docs — Arabic strings included. Idempotent
-- upsert on key (SEEDS rule 2); existing rows from 0008 converge to the
-- full manifest, is_active = true, status = 'ACTIVE'.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest", "is_active", "status") VALUES
  ('industry.retail', 'Retail Stores', 'متاجر التجزئة', '1.0.0',
   '{
  "id": "industry.retail",
  "name": "Retail Stores",
  "name_ar": "متاجر التجزئة",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine", "items.barcodes", "items.price_lists",
    "inventory.multi_warehouse", "inventory.stock_transfers", "inventory.serial_tracking",
     "pos.terminals", "pos.sales", "pos.offline_queue",
    "pos.receipts", "treasury.cashier_shifts"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "pos", "configuration"],
  "terminology_overrides": {
    "pos.terminal": { "en": "Terminal", "ar": "الطرفية" },
    "doc.sales_invoice_pos": { "en": "POS sale", "ar": "بيع نقطة البيع" },
    "item.exchange": { "en": "Exchange", "ar": "الاستبدال" },
    "item.variant": { "en": "Variant (size/color)", "ar": "المقاس / اللون" },
    "item.tag_price": { "en": "Tag price", "ar": "السعر المعلن" },
    "promo.season_sale": { "en": "Season sale", "ar": "تخفيضات الموسم" }
  },
  "navigation_manifest": { "groups": [
    { "id": "selling", "label": { "en": "Selling", "ar": "البيع" }, "order": 1, "items": [
      { "id": "pos", "label": { "en": "Point of sale", "ar": "نقطة البيع" }, "target": "pos.counter", "feature_key": "pos.sales" },
      { "id": "returns", "label": { "en": "Returns & exchanges", "ar": "المرتجعات والاستبدال" }, "target": "sales.credit_notes" },
      { "id": "receipts", "label": { "en": "Receipts", "ar": "سندات القبض" }, "target": "treasury.receipts" }
    ]},
    { "id": "stock", "label": { "en": "Stock", "ar": "المخزون" }, "order": 2, "items": [
      { "id": "transfers", "label": { "en": "Branch transfers", "ar": "تحويلات الفروع" }, "target": "inventory.transfers" },
      { "id": "imei", "label": { "en": "IMEI register", "ar": "سجل الأجهزة" }, "target": "inventory.imei", "feature_key": "inventory.serial_tracking" }
    ]}
  ]},
  "workflow_policies": {
    "cash_sales_autopost": true,
    "pos.return_requires_original_invoice": true,
    "exchange_same_value_only": false,
    "shift_variance_approval_required": true,
    "stock_transfer_in_transit_visible": true
  },
  "document_numbering_defaults": {
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "pos_sale": { "prefix": "POS", "format": "POS-{branch}-{yy}{MM}-{seq:5}", "per_branch": true, "reserve_on_approval": false },
    "credit_note": { "prefix": "CN", "format": "CN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "stock_transfer": { "prefix": "TRF", "format": "TRF-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC", "default_track_batch": false, "default_track_expiry": false,
    "default_track_serial": false, "default_imei_tracking": false, "fefo_picking": false,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "pos.sales_by_terminal", "pinned": true, "dashboard": true, "default_period": "today" },
    { "report_key": "pos.sales_by_hour", "pinned": true, "dashboard": true, "default_period": "this_week" },
    { "report_key": "retail.imei_register", "pinned": true, "dashboard": false, "default_period": "this_month" },
    { "report_key": "inventory.stock_valuation", "pinned": true, "dashboard": false, "default_period": "custom" }
  ],
  "onboarding_steps": [
    { "id": "branch_warehouse", "title": { "en": "Create branch and stockroom", "ar": "إنشاء الفرع والمستودع" }, "required": true },
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts", "ar": "تأكيد دليل الحسابات" }, "required": true },
    { "id": "categories", "title": { "en": "Item categories & tracking flags", "ar": "تصنيفات الأصناف وخيارات التتبع" }, "required": true },
    { "id": "suppliers", "title": { "en": "Suppliers & opening stock", "ar": "الموردون ورصيد المخزون الافتتاحي" }, "required": true },
    { "id": "terminals", "title": { "en": "Set up POS terminals", "ar": "تهيئة أجهزة نقطة البيع" }, "required": true, "feature_key": "pos.terminals" },
    { "id": "first_shift", "title": { "en": "Open first shift and make a sale", "ar": "افتتاح أول وردية وإجراء أول عملية بيع" }, "required": false, "feature_key": "pos.sales" }
  ],
  "capability_prerequisites": {
    "barcode_pos": { "level": "REQUIRED", "feature_keys": ["pos.terminals", "pos.sales", "pos.offline_queue", "pos.receipts"], "available_from_phase": "PHASE-016" },
    "cashier_shifts": { "level": "REQUIRED", "feature_keys": ["treasury.cashier_shifts"], "available_from_phase": "PHASE-016" },
    "imei_tracking": { "level": "OPTIONAL", "feature_keys": ["inventory.serial_tracking"], "available_from_phase": "PHASE-010" },
    "composite_kits": { "level": "OPTIONAL", "feature_keys": ["items.composite_products"], "available_from_phase": "PHASE-016" },
    "free_goods_promo": { "level": "OPTIONAL", "feature_keys": ["distribution.free_goods"], "available_from_phase": "PHASE-017" },
    "landed_costs": { "level": "OPTIONAL", "feature_keys": ["purchasing.landed_costs"], "available_from_phase": "PHASE-011" }
  }
}'::jsonb, true, 'ACTIVE'),
  ('industry.grocery', 'Grocery & Supermarket', 'البقالات والسوبرماركت', '1.0.0',
   '{
  "id": "industry.grocery",
  "name": "Grocery & Supermarket",
  "name_ar": "البقالات والسوبرماركت",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine", "items.barcodes", "items.price_lists",
    "distribution.customer_tiers", "inventory.multi_warehouse", "inventory.batch_tracking"
    , "inventory.stock_counts", "pos.terminals", "pos.sales",
    "pos.offline_queue", "pos.barcode_scanning", "pos.receipts",
    "treasury.cashier_shifts"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "pos", "configuration"],
  "terminology_overrides": {
    "item.scale_item": { "en": "Scale item", "ar": "صنف الميزان" },
    "batch.expiry": { "en": "Expiry date", "ar": "تاريخ الانتهاء" },
    "inventory.fefo": { "en": "FEFO (nearest expiry first)", "ar": "الأقرب انتهاءً يصدر أولاً" },
    "inventory.markdown": { "en": "Near-expiry markdown", "ar": "تخفيض قرب الانتهاء" },
    "inventory.writeoff": { "en": "Write-off", "ar": "الإعدام" },
    "item.shelf_life": { "en": "Shelf life", "ar": "مدة الصلاحية" },
    "purchasing.reorder": { "en": "Reorder level", "ar": "حد إعادة الطلب" }
  },
  "navigation_manifest": { "groups": [
    { "id": "selling", "label": { "en": "Selling", "ar": "البيع" }, "order": 1, "items": [
      { "id": "pos", "label": { "en": "Point of sale", "ar": "نقطة البيع" }, "target": "pos.counter", "feature_key": "pos.sales" },
      { "id": "tiers", "label": { "en": "Customer price tiers", "ar": "فئات أسعار العملاء" }, "target": "items.tiers" }
    ]},
    { "id": "expiry", "label": { "en": "Expiry control", "ar": "الرقابة على الصلاحية" }, "order": 2, "items": [
      { "id": "expiry_list", "label": { "en": "Expiry list", "ar": "قائمة الصلاحيات" }, "target": "inventory.expiry_list" },
      { "id": "writeoff", "label": { "en": "Write-off register", "ar": "سجل الإعدام" }, "target": "inventory.writeoff" },
      { "id": "counts", "label": { "en": "Stock counts", "ar": "جرد المخزون" }, "target": "inventory.counts" }
    ]}
  ]},
  "workflow_policies": {
    "cash_sales_autopost": true,
    "expiry_writeoff_requires_approval": true,
    "markdown_requires_approval": false,
    "batch_expiry_capture_required_on_grn": true,
    "scale_item_weighed_lines": true,
    "shift_variance_approval_required": true
  },
  "document_numbering_defaults": {
    "pos_sale": { "prefix": "POS", "format": "POS-{branch}-{yy}{MM}-{seq:5}", "per_branch": true, "reserve_on_approval": false },
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "goods_receipt": { "prefix": "GRN", "format": "GRN-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "credit_note": { "prefix": "CN", "format": "CN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC", "default_track_batch": true, "default_track_expiry": true,
    "default_track_serial": false, "default_imei_tracking": false, "fefo_picking": true,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "inventory.expiry_list", "pinned": true, "dashboard": true, "default_period": "this_week" },
    { "report_key": "grocery.expiry_writeoff", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "pos.sales_by_hour", "pinned": true, "dashboard": true, "default_period": "this_week" },
    { "report_key": "inventory.stock_valuation", "pinned": true, "dashboard": false, "default_period": "custom" }
  ],
  "onboarding_steps": [
    { "id": "branch_warehouse", "title": { "en": "Create branch, shop floor and backroom", "ar": "إنشاء الفرع وصالة البيع والمستودع الخلفي" }, "required": true },
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts", "ar": "تأكيد دليل الحسابات" }, "required": true },
    { "id": "categories", "title": { "en": "Food categories with batch/expiry defaults", "ar": "تصنيفات الأغذية مع خيارات الدفعة والصلاحية" }, "required": true },
    { "id": "scale_items", "title": { "en": "Set up scale items", "ar": "تهيئة أصناف الميزان" }, "required": false, "feature_key": "pos.barcode_scanning" },
    { "id": "suppliers", "title": { "en": "Suppliers & opening stock with batches", "ar": "الموردون والمخزون الافتتاحي مع الدفعات" }, "required": true },
    { "id": "tiers", "title": { "en": "Price tiers (retail / wholesale)", "ar": "فئات الأسعار (تجزئة / جملة)" }, "required": false },
    { "id": "terminals", "title": { "en": "Set up POS terminals & scales", "ar": "تهيئة أجهزة نقطة البيع والموازين" }, "required": true, "feature_key": "pos.terminals" },
    { "id": "first_count", "title": { "en": "Baseline count for expiry-sensitive stock", "ar": "جرد أساسي للأصناف الحساسة للصلاحية" }, "required": true }
  ],
  "capability_prerequisites": {
    "barcode_pos": { "level": "REQUIRED", "feature_keys": ["pos.terminals", "pos.sales", "pos.offline_queue", "pos.receipts"], "available_from_phase": "PHASE-016" },
    "scale_barcodes": { "level": "REQUIRED", "feature_keys": ["pos.barcode_scanning"], "available_from_phase": "PHASE-016" },
    "expiry_tracking_fefo": { "level": "REQUIRED", "feature_keys": ["inventory.batch_tracking" ], "available_from_phase": "PHASE-010" },
    "customer_price_tiers": { "level": "REQUIRED", "feature_keys": ["distribution.customer_tiers"], "available_from_phase": "PHASE-017" },
    "cashier_shifts": { "level": "REQUIRED", "feature_keys": ["treasury.cashier_shifts"], "available_from_phase": "PHASE-016" },
    "free_goods_promo": { "level": "OPTIONAL", "feature_keys": ["sales.discount_management", "distribution.free_goods"], "available_from_phase": "PHASE-017" },
    "composite_kits": { "level": "OPTIONAL", "feature_keys": ["items.composite_products"], "available_from_phase": "PHASE-016" },
    "qc_inspections": { "level": "OPTIONAL", "feature_keys": ["manufacturing.qc"], "available_from_phase": "PHASE-018" }
  }
}'::jsonb, true, 'ACTIVE'),
  ('industry.restaurant', 'Restaurant & Café', 'المطاعم والمقاهي', '1.0.0',
   '{
  "id": "industry.restaurant",
  "name": "Restaurant & Café",
  "name_ar": "المطاعم والمقاهي",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine", "items.barcodes", "items.price_lists",
    "inventory.multi_warehouse", "inventory.batch_tracking" ,
    "items.composite_products", "inventory.stock_counts", "pos.terminals", "pos.sales",
    "pos.offline_queue", "pos.table_service", "pos.receipts",
    "treasury.cashier_shifts"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "pos", "configuration"],
  "terminology_overrides": {
    "pos.table": { "en": "Table", "ar": "طاولة" },
    "pos.order": { "en": "Order", "ar": "طلب" },
    "pos.kitchen": { "en": "Kitchen", "ar": "المطبخ" },
    "pos.order_type": { "en": "Order type", "ar": "نوع الطلب" },
    "pos.dine_in": { "en": "Dine-in", "ar": "داخل المطعم" },
    "pos.takeaway": { "en": "Takeaway", "ar": "سفري" },
    "pos.delivery": { "en": "Delivery", "ar": "توصيل" },
    "pos.check": { "en": "Guest check", "ar": "الحساب" },
    "menu.combo": { "en": "Combo / set meal", "ar": "وجبة" },
    "menu.modifier": { "en": "Modifier (extra)", "ar": "إضافة" },
    "pos.z_close": { "en": "Z close (day end)", "ar": "الإغلاق اليومي" },
    "billing.service_charge": { "en": "Service charge", "ar": "رسوم الخدمة" }
  },
  "navigation_manifest": { "groups": [
    { "id": "floor", "label": { "en": "Floor", "ar": "صالة المطعم" }, "order": 1, "items": [
      { "id": "tables", "label": { "en": "Tables", "ar": "الطاولات" }, "target": "pos.floor", "feature_key": "pos.table_service" },
      { "id": "quick_sale", "label": { "en": "Quick sale", "ar": "بيع سريع" }, "target": "pos.counter", "feature_key": "pos.sales" },
      { "id": "kitchen", "label": { "en": "Kitchen tickets", "ar": "تذاكر المطبخ" }, "target": "pos.kitchen", "feature_key": "pos.kitchen_display" }
    ]},
    { "id": "day", "label": { "en": "Daily close", "ar": "الإغلاق اليومي" }, "order": 2, "items": [
      { "id": "shifts", "label": { "en": "Shifts", "ar": "الورديات" }, "target": "treasury.shifts" },
      { "id": "z_close", "label": { "en": "Z close report", "ar": "تقرير الإغلاق اليومي" }, "target": "pos.z_close" }
    ]}
  ]},
  "workflow_policies": {
    "cash_sales_autopost": true,
    "default_pos_order_type": "dine_in",
    "unpaid_table_holds_no_ledger": true,
    "combo_explosion_at_posting": true,
    "service_charge_default_rate": 0,
    "shift_variance_approval_required": true,
    "daily_waste_count_recommended": true
  },
  "document_numbering_defaults": {
    "pos_sale": { "prefix": "RC", "format": "RC-{branch}-{yy}{MM}-{seq:5}", "per_branch": true, "reserve_on_approval": false },
    "purchase_order": { "prefix": "PO", "format": "PO-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": true },
    "goods_receipt": { "prefix": "GRN", "format": "GRN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "stock_adjustment": { "prefix": "ADJ", "format": "ADJ-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC", "default_track_batch": true, "default_track_expiry": true,
    "default_track_serial": false, "default_imei_tracking": false, "fefo_picking": true,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "restaurant.sales_by_table", "pinned": true, "dashboard": true, "default_period": "this_week" },
    { "report_key": "restaurant.order_type_mix", "pinned": true, "dashboard": true, "default_period": "this_week" },
    { "report_key": "pos.sales_by_hour", "pinned": true, "dashboard": true, "default_period": "this_week" },
    { "report_key": "treasury.shift_cash_reconciliation", "pinned": true, "dashboard": false, "default_period": "today" },
    { "report_key": "inventory.expiry_list", "pinned": true, "dashboard": true, "default_period": "this_week" }
  ],
  "onboarding_steps": [
    { "id": "branch_floors", "title": { "en": "Branch, kitchen & floor layout", "ar": "الفرع والمطبخ وتخطيط الصالة" }, "required": true },
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts", "ar": "تأكيد دليل الحسابات" }, "required": true },
    { "id": "menu", "title": { "en": "Build menu (items, combos, modifiers)", "ar": "بناء قائمة الطعام (أصناف، وجبات، إضافات)" }, "required": true },
    { "id": "ingredients", "title": { "en": "Ingredient stock with expiry", "ar": "مخزون المكونات مع الصلاحية" }, "required": true },
    { "id": "suppliers", "title": { "en": "Suppliers & opening stock", "ar": "الموردون والمخزون الافتتاحي" }, "required": true },
    { "id": "terminals", "title": { "en": "Terminals & floor plan", "ar": "تهيئة الأجهزة وخريطة الطاولات" }, "required": true, "feature_key": "pos.table_service" },
    { "id": "first_day", "title": { "en": "Run first service day and Z close", "ar": "تشغيل أول يوم خدمة والإغلاق اليومي" }, "required": false, "feature_key": "pos.sales" }
  ],
  "capability_prerequisites": {
    "table_service": { "level": "REQUIRED", "feature_keys": ["pos.table_service"], "available_from_phase": "PHASE-016" },
    "barcode_pos": { "level": "REQUIRED", "feature_keys": ["pos.terminals", "pos.sales", "pos.offline_queue", "pos.receipts"], "available_from_phase": "PHASE-016" },
    "cashier_shifts": { "level": "REQUIRED", "feature_keys": ["treasury.cashier_shifts"], "available_from_phase": "PHASE-016" },
    "composite_kits": { "level": "REQUIRED", "feature_keys": ["items.composite_products"], "available_from_phase": "PHASE-016" },
    "expiry_tracking_fefo": { "level": "REQUIRED", "feature_keys": ["inventory.batch_tracking" ], "available_from_phase": "PHASE-010" },
    "kitchen_display": { "level": "OPTIONAL", "feature_keys": ["pos.kitchen_display"], "available_from_phase": "PHASE-016" },
    "bom_production": { "level": "OPTIONAL", "feature_keys": ["manufacturing.bom", "manufacturing.production_orders"], "available_from_phase": "PHASE-018" },
    "free_goods_promo": { "level": "OPTIONAL", "feature_keys": ["distribution.free_goods"], "available_from_phase": "PHASE-017" }
  }
}'::jsonb, true, 'ACTIVE')
ON CONFLICT ("key") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "version" = EXCLUDED."version", "manifest" = EXCLUDED."manifest",
      "is_active" = true, "status" = 'ACTIVE';

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- tenant_industry_config (T5/T6): the applied-template state. One row per
-- tenant (UNIQUE (tenant_id)); applied_manifest_hash pins the exact manifest
-- content applied (switch/extend compares against it); overrides is the
-- tenant's explicit L1 overlay; the archived_* jsonb snapshots + conflict
-- notes are the BR-038 read-only history the diff preview renders.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_industry_config" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "template_key" text NOT NULL,
  "applied_version" text NOT NULL,
  "applied_manifest_hash" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now(),
  "applied_by" uuid REFERENCES "users" ("id") ON DELETE RESTRICT,
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "overrides" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "archived_terminology" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "archived_navigation" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "archived_capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "conflict_notes" jsonb NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT pk_tenant_industry_config PRIMARY KEY ("id"),
  CONSTRAINT uq_tenant_industry_config_tenant UNIQUE ("tenant_id"),
  CONSTRAINT fk_tenant_industry_config_template FOREIGN KEY ("template_key")
    REFERENCES "industry_templates" ("key") ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_industry_config_version_shape CHECK ("applied_version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tenant_industry_config_tenant
  ON "tenant_industry_config" ("tenant_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- feature_flags (L8 rollout flags — platform delivery only, never tenant
-- policy; CONFIGURATION_ENGINE §3). Global reference like
-- jurisdictions/plans: no tenant_id, no RLS; erp_migrate writes, everyone
-- else reads.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_flags" (
  "key" text NOT NULL,
  "scope" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "rules" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pk_feature_flags PRIMARY KEY ("key")
);

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- item_components (T9 items.composite_products): composite-item definition
-- lines — explosion at posting issues components at their own cost. The
-- tenant-composite FK pattern (id, tenant_id) keeps references
-- tenant-scoped; the pair is unique per definition.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "item_components" (
  "id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "tenants" ("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "composite_item_id" uuid NOT NULL,
  "component_item_id" uuid NOT NULL,
  "qty" numeric(18, 6) NOT NULL,
  CONSTRAINT pk_item_components PRIMARY KEY ("id"),
  CONSTRAINT uq_item_components_pair UNIQUE ("composite_item_id", "component_item_id"),
  CONSTRAINT fk_item_components_composite FOREIGN KEY ("composite_item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT fk_item_components_component FOREIGN KEY ("component_item_id", "tenant_id")
    REFERENCES "items" ("id", "tenant_id") ON DELETE RESTRICT,
  CONSTRAINT ck_item_components_qty_positive CHECK ("qty" > 0),
  CONSTRAINT ck_item_components_distinct CHECK ("composite_item_id" <> "component_item_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_components_tenant
  ON "item_components" ("tenant_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_item_components_composite
  ON "item_components" ("composite_item_id");

--> statement-breakpoint
-- RLS (TENANT_ISOLATION §2) — the macro on every new tenant-owned table.
SELECT erp.apply_tenant_policy('"tenant_industry_config"');
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"item_components"');

--> statement-breakpoint
-- Grants (the per-table shape): tenant_industry_config is apply/switch
-- state (no DELETE — the row is never removed, only re-applied/switched);
-- item_components is full definition CRUD; feature_flags is read-only to
-- the app (platform writes ship as migrations).
REVOKE ALL ON "tenant_industry_config", "item_components" FROM erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tenant_industry_config" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "item_components" TO erp_app;
--> statement-breakpoint
REVOKE ALL ON "feature_flags" FROM erp_app;
--> statement-breakpoint
GRANT SELECT ON "feature_flags" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "tenant_industry_config", "item_components", "feature_flags" TO erp_readonly;
--> statement-breakpoint
RESET ROLE;
--> statement-breakpoint
GRANT SELECT ON "tenant_industry_config", "item_components", "feature_flags" TO erp_definer;
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 22)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();

--> statement-breakpoint
RESET ROLE;
