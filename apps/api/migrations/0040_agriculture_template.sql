-- PHASE-033 · migration 0040 · agriculture commercial shell — template
-- registry seed
--
-- Purpose (PHASE-033 §4–§6; EXPANSION_REGISTER §B/§L, ED-09): the
-- `industry.agriculture` template ships as a **commercial shell** through
-- the unmodified PHASE-015 engine — configuration only, exactly per the
-- phase plan's Design Impact: **no new tables, no new modules, no new
-- feature keys, no new permission keys, INV-022 unchanged**. This
-- migration is additive seeds and a registry row only (§6 "Migration &
-- rollback"): the manifest row itself, converging the 0008 index row to
-- the full v1.0.0 manifest.
--
-- The season backbone rides the PHASE-018/019 modules verbatim: the crop
-- cycle is a BOM recipe run as a production order costed to the field
-- project (accounting.projects + cost centers), the harvest lands as a
-- batch at production cost (then WAC onward, G-17), crop loss posts as
-- G-18 scrap with a reason, livestock are serial-tracked items at head
-- level, inputs are ordinary purchases (G-07/G-08), and produce sells
-- from harvest batches (G-01/G-02/G-03, FEFO). Every required feature
-- key was already granted to business + enterprise by earlier migrations
-- (manufacturing.bom/production_orders @ 0026, inventory.batch_tracking +
-- accounting.cost_centers @ 0008, purchasing/sales @ the starter base,
-- accounting.projects @ 0027) — this migration adds NO plan grants, the
-- first shipped template whose REQUIRED chain needs none; starter stays
-- degraded-back-office by design.
--
-- Manifest content: verbatim from
-- docs/industries/templates/manifests/manifest.agriculture.json (the
-- canonical source; the §J doc reconciliation applied — the draft's
-- inventory.stock_valuation planning id pinned to the live
-- inventory.valuation registry key, the 0025/0039 precedent). Idempotent
-- upsert on key; the 0008 index row converges to the full manifest,
-- is_active = true, status = 'ACTIVE'.
--
-- Lineage note (recorded honestly): PHASE-033 executes on the PHASE-027
-- lineage after the working environments holding the interim PHASE-028
-- through PHASE-031 states were lost to sandbox resets (the standing
-- re-initialization pattern — see commit 82eb5be). Stage-10 phases share
-- only the GA gate and their pre-GA functional prereqs
-- (PHASE_DEPENDENCY_GRAPH): agriculture's prereqs
-- (PHASE-015/018/019/025) are all satisfied at this HEAD, so the
-- template ships here ahead of the still-unexecuted stage-9/10 siblings,
-- which remain NOT_STARTED.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Template registry seed: the PHASE-033 manifest, verbatim from
-- docs/industries/templates/manifests/manifest.agriculture.json (the
-- canonical source — the §J doc reconciliation applied: the
-- inventory.stock_valuation pin reconciled to the live
-- inventory.valuation registry key). Idempotent upsert on key; the 0008
-- index row converges to the full manifest, is_active = true, status =
-- 'ACTIVE'.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest", "is_active", "status") VALUES
  ('industry.agriculture', 'Agriculture (Commercial Shell)', 'الزراعة — الغلاف التجاري', '1.0.0',
   '{
  "id": "industry.agriculture",
  "name": "Agriculture (Commercial Shell)",
  "name_ar": "الزراعة — الغلاف التجاري",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine",
    "manufacturing.bom",
    "manufacturing.production_orders",
    "inventory.batch_tracking",
    "purchasing.orders",
    "purchasing.goods_receipts",
    "sales.invoices",
    "accounting.projects",
    "accounting.cost_centers"
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
    "crop.item": {
      "en": "Crop",
      "ar": "المحصول"
    },
    "crop.cycle": {
      "en": "Crop cycle",
      "ar": "الدورة الزراعية"
    },
    "mfg.recipe": {
      "en": "Crop-cycle recipe (BOM)",
      "ar": "وصفة الدورة الزراعية (قائمة المواد)"
    },
    "mfg.production_order": {
      "en": "Cycle run order",
      "ar": "أمر تنفيذ الدورة"
    },
    "harvest.batch": {
      "en": "Harvest batch",
      "ar": "دفعة الحصاد"
    },
    "farm.field": {
      "en": "Farm / Field",
      "ar": "المزرعة / الحقل"
    },
    "livestock.head": {
      "en": "Livestock head",
      "ar": "رأس"
    },
    "input.seeds": {
      "en": "Seeds & inputs",
      "ar": "البذور والمدخلات"
    },
    "input.feed": {
      "en": "Feed",
      "ar": "الأعلاف"
    },
    "mfg.yield": {
      "en": "Yield",
      "ar": "المردود"
    },
    "mfg.scrap": {
      "en": "Crop loss",
      "ar": "الفاقد"
    }
  },
  "navigation_manifest": {
    "groups": [
      {
        "id": "season",
        "label": {
          "en": "Season",
          "ar": "الموسم"
        },
        "order": 1,
        "items": [
          {
            "id": "fields",
            "label": {
              "en": "Fields & projects",
              "ar": "الحقول والمشاريع"
            },
            "target": "accounting.projects"
          },
          {
            "id": "recipes",
            "label": {
              "en": "Crop-cycle recipes (BOM)",
              "ar": "وصفات الدورات (قائمة المواد)"
            },
            "target": "manufacturing.bom",
            "feature_key": "manufacturing.bom"
          },
          {
            "id": "cycles",
            "label": {
              "en": "Cycle run orders",
              "ar": "أوامر تنفيذ الدورات"
            },
            "target": "manufacturing.orders",
            "feature_key": "manufacturing.production_orders"
          }
        ]
      },
      {
        "id": "harvest",
        "label": {
          "en": "Harvest & trade",
          "ar": "الحصاد والتجارة"
        },
        "order": 2,
        "items": [
          {
            "id": "batches",
            "label": {
              "en": "Harvest batches",
              "ar": "دفعات الحصاد"
            },
            "target": "inventory.batches",
            "feature_key": "inventory.batch_tracking"
          },
          {
            "id": "sales",
            "label": {
              "en": "Produce sales",
              "ar": "مبيعات المحاصيل"
            },
            "target": "sales.invoices"
          },
          {
            "id": "livestock",
            "label": {
              "en": "Livestock register",
              "ar": "سجل الثروة الحيوانية"
            },
            "target": "inventory.serials",
            "feature_key": "inventory.serial_tracking"
          }
        ]
      }
    ]
  },
  "workflow_policies": {
    "cycle_order_per_field_project": true,
    "harvest_batch_genealogy_enabled": true,
    "field_cost_center_mandatory_on_cycle": true,
    "scrap_reason_required": true,
    "consumption_variance_threshold_pct": 5,
    "livestock_serial_per_head": true
  },
  "document_numbering_defaults": {
    "production_order": {
      "prefix": "CYC",
      "format": "CYC-{yyyy}-{seq:5}",
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
    "stock_transfer": {
      "prefix": "TRF",
      "format": "TRF-{yyyy}-{seq:5}",
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
      "default_period": "this_year"
    },
    {
      "report_key": "inventory.valuation",
      "pinned": true,
      "dashboard": false,
      "default_period": "custom"
    },
    {
      "report_key": "inventory.expiry_list",
      "pinned": true,
      "dashboard": false,
      "default_period": "this_week"
    },
    {
      "report_key": "manufacturing.batch_genealogy",
      "pinned": true,
      "dashboard": false,
      "default_period": "custom"
    }
  ],
  "onboarding_steps": [
    {
      "id": "coa_confirm",
      "title": {
        "en": "Confirm chart of accounts (WIP, crop loss, biological assets)",
        "ar": "تأكيد دليل الحسابات (تحت التشغيل، الفاقد، الأصول الحيوية)"
      },
      "required": true
    },
    {
      "id": "fields",
      "title": {
        "en": "Fields as projects + cost centers",
        "ar": "الحقول كمشاريع ومراكز تكلفة"
      },
      "required": true
    },
    {
      "id": "recipes",
      "title": {
        "en": "Crop-cycle recipes per crop",
        "ar": "وصفات الدورات لكل محصول"
      },
      "required": true
    },
    {
      "id": "inputs",
      "title": {
        "en": "Seeds/feed/inputs with batches",
        "ar": "البذور والأعلاف والمدخلات مع الدفعات"
      },
      "required": true
    },
    {
      "id": "livestock",
      "title": {
        "en": "Livestock items with head-level serials",
        "ar": "أصناف الثروة الحيوانية بتسجيل رأس برأس"
      },
      "required": false,
      "feature_key": "inventory.serial_tracking"
    },
    {
      "id": "first_cycle",
      "title": {
        "en": "Run first cycle: order → harvest intake → sale",
        "ar": "تنفيذ أول دورة: أمر، حصاد، بيع"
      },
      "required": false
    }
  ],
  "capability_prerequisites": {
    "crop_cycle_costing": {
      "level": "REQUIRED",
      "feature_keys": [
        "manufacturing.bom",
        "manufacturing.production_orders",
        "accounting.projects"
      ],
      "available_from_phase": "PHASE-033"
    },
    "harvest_batches": {
      "level": "REQUIRED",
      "feature_keys": [
        "inventory.batch_tracking",
        "manufacturing.batch_genealogy"
      ],
      "available_from_phase": "PHASE-018"
    },
    "bom_production": {
      "level": "REQUIRED",
      "feature_keys": [
        "manufacturing.bom",
        "manufacturing.production_orders"
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
    "batch_genealogy": {
      "level": "OPTIONAL",
      "feature_keys": [
        "manufacturing.batch_genealogy"
      ],
      "available_from_phase": "PHASE-018"
    },
    "qc_inspections": {
      "level": "OPTIONAL",
      "feature_keys": [
        "manufacturing.qc"
      ],
      "available_from_phase": "PHASE-018"
    },
    "customer_price_tiers": {
      "level": "OPTIONAL",
      "feature_keys": [
        "distribution.customer_tiers"
      ],
      "available_from_phase": "PHASE-017"
    },
    "commissions": {
      "level": "OPTIONAL",
      "feature_keys": [
        "sales.commissions"
      ],
      "available_from_phase": "PHASE-017"
    },
    "landed_costs": {
      "level": "OPTIONAL",
      "feature_keys": [
        "purchasing.landed_costs"
      ],
      "available_from_phase": "PHASE-011"
    },
    "shipment_tracking": {
      "level": "OPTIONAL",
      "feature_keys": [
        "distribution.shipment_tracking"
      ],
      "available_from_phase": "PHASE-019"
    },
    "pdc_notes": {
      "level": "OPTIONAL",
      "feature_keys": [
        "notes.received"
      ],
      "available_from_phase": "PHASE-027"
    },
    "cashier_shifts": {
      "level": "OPTIONAL",
      "feature_keys": [
        "treasury.cashier_shifts"
      ],
      "available_from_phase": "PHASE-016"
    }
  }
}'::jsonb, true, 'ACTIVE')
ON CONFLICT ("key") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "version" = EXCLUDED."version", "manifest" = EXCLUDED."manifest",
      "is_active" = true, "status" = 'ACTIVE';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 40)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
