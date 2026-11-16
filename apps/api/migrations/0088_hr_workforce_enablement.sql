-- PHASE-045 (Blueprint v3.0 · CR-15) · migration 0088 · HR Core —
-- Attendance, Leaves & Shifts (part 8: the workforce-industry MANIFEST
-- ENABLEMENT — the T-15 half of the deferred kickoff decision).
--
--   THE COHERENT-CHANGE LAW (the kickoff record, 2026-11-14): the
--   enablement is ONE change across the CANONICAL manifests
--   (packages/contracts/src/industry/templates.ts — the code source of
--   truth), THIS stored-registry seed, the docs mirrors
--   (docs/industries/templates/manifests/*.json), and the specs'
--   pinned hashes + the starter-plan degradation-chain pins. The DB
--   half alone (the 0078 §4 shape) would desync the stored manifests
--   from the canonical hash the registry drift job verifies — the
--   0066 §9 precedent (the PHASE-042 manufacturing enablement) is the
--   procedure this follows.
--
--   THE WORKFORCE SET (matrix §3.23's dated note — "the
--   workforce-carrying industry templates … require them by default
--   (0086 §4)", mapped onto the SHIPPED template registry): restaurant
--   (shift-roster staffing), automotive (workshop technicians — job
--   cards are labor tracking), food_manufacturing (factory shifts),
--   healthcare (clinical staff). The note's "manufacturing" is the
--   food_manufacturing template (the registry's manufacturing family);
--   "construction" has no shipped template — recorded honestly. The
--   commercial shells whose workforce surfaces would be
--   academic/agronomy operations (education, agriculture — non-goals
--   per EXPANSION_REGISTER ED-08/ED-09/ED-11) and the lean-office
--   commerce templates stay OUT (a tenant adds the hr keys through
--   their plan: business + enterprise carry them via 0086 §2).
--
--   DATA-ONLY: required_feature_keys += hr.attendance · hr.leave ·
--   hr.shifts (the hr block, canonical array order); every other
--   manifest field byte-identical.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- industry.restaurant — the workforce enablement (required_feature_keys + the hr block).
UPDATE "industry_templates" SET "manifest" = $restaura${
  "id": "industry.restaurant",
  "name": "Restaurant & Café",
  "name_ar": "المطاعم والمقاهي",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine",
    "items.barcodes",
    "items.price_lists",
    "inventory.multi_warehouse",
    "inventory.batch_tracking",
    "items.composite_products",
    "inventory.stock_counts",
    "pos.terminals",
    "pos.sales",
    "pos.offline_queue",
    "pos.table_service",
    "pos.receipts",
    "treasury.cashier_shifts",
    "hr.attendance",
    "hr.leave",
    "hr.shifts"
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
    "pos",
    "configuration"
  ],
  "terminology_overrides": {
    "pos.table": {
      "en": "Table",
      "ar": "طاولة"
    },
    "pos.order": {
      "en": "Order",
      "ar": "طلب"
    },
    "pos.kitchen": {
      "en": "Kitchen",
      "ar": "المطبخ"
    },
    "pos.order_type": {
      "en": "Order type",
      "ar": "نوع الطلب"
    },
    "pos.dine_in": {
      "en": "Dine-in",
      "ar": "داخل المطعم"
    },
    "pos.takeaway": {
      "en": "Takeaway",
      "ar": "سفري"
    },
    "pos.delivery": {
      "en": "Delivery",
      "ar": "توصيل"
    },
    "pos.check": {
      "en": "Guest check",
      "ar": "الحساب"
    },
    "menu.combo": {
      "en": "Combo / set meal",
      "ar": "وجبة"
    },
    "menu.modifier": {
      "en": "Modifier (extra)",
      "ar": "إضافة"
    },
    "pos.z_close": {
      "en": "Z close (day end)",
      "ar": "الإغلاق اليومي"
    },
    "billing.service_charge": {
      "en": "Service charge",
      "ar": "رسوم الخدمة"
    }
  },
  "navigation_manifest": {
    "groups": [
      {
        "id": "floor",
        "label": {
          "en": "Floor",
          "ar": "صالة المطعم"
        },
        "order": 1,
        "items": [
          {
            "id": "tables",
            "label": {
              "en": "Tables",
              "ar": "الطاولات"
            },
            "target": "pos.floor",
            "feature_key": "pos.table_service"
          },
          {
            "id": "quick_sale",
            "label": {
              "en": "Quick sale",
              "ar": "بيع سريع"
            },
            "target": "pos.counter",
            "feature_key": "pos.sales"
          },
          {
            "id": "kitchen",
            "label": {
              "en": "Kitchen tickets",
              "ar": "تذاكر المطبخ"
            },
            "target": "pos.kitchen",
            "feature_key": "pos.kitchen_display"
          }
        ]
      },
      {
        "id": "day",
        "label": {
          "en": "Daily close",
          "ar": "الإغلاق اليومي"
        },
        "order": 2,
        "items": [
          {
            "id": "shifts",
            "label": {
              "en": "Shifts",
              "ar": "الورديات"
            },
            "target": "treasury.shifts"
          },
          {
            "id": "z_close",
            "label": {
              "en": "Z close report",
              "ar": "تقرير الإغلاق اليومي"
            },
            "target": "pos.z_close"
          }
        ]
      }
    ]
  },
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
    "pos_sale": {
      "prefix": "RC",
      "format": "RC-{branch}-{yy}{MM}-{seq:5}",
      "per_branch": true,
      "reserve_on_approval": false
    },
    "purchase_order": {
      "prefix": "PO",
      "format": "PO-{yyyy}-{seq:5}",
      "per_branch": false,
      "reserve_on_approval": true
    },
    "goods_receipt": {
      "prefix": "GRN",
      "format": "GRN-{yyyy}-{seq:5}",
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
      "report_key": "restaurant.sales_by_table",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_week"
    },
    {
      "report_key": "restaurant.order_type_mix",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_week"
    },
    {
      "report_key": "pos.sales_by_hour",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_week"
    },
    {
      "report_key": "treasury.shift_cash_reconciliation",
      "pinned": true,
      "dashboard": false,
      "default_period": "today"
    },
    {
      "report_key": "inventory.expiry_list",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_week"
    }
  ],
  "onboarding_steps": [
    {
      "id": "branch_floors",
      "title": {
        "en": "Branch, kitchen & floor layout",
        "ar": "الفرع والمطبخ وتخطيط الصالة"
      },
      "required": true
    },
    {
      "id": "coa_confirm",
      "title": {
        "en": "Confirm chart of accounts",
        "ar": "تأكيد دليل الحسابات"
      },
      "required": true
    },
    {
      "id": "menu",
      "title": {
        "en": "Build menu (items, combos, modifiers)",
        "ar": "بناء قائمة الطعام (أصناف، وجبات، إضافات)"
      },
      "required": true
    },
    {
      "id": "ingredients",
      "title": {
        "en": "Ingredient stock with expiry",
        "ar": "مخزون المكونات مع الصلاحية"
      },
      "required": true
    },
    {
      "id": "suppliers",
      "title": {
        "en": "Suppliers & opening stock",
        "ar": "الموردون والمخزون الافتتاحي"
      },
      "required": true
    },
    {
      "id": "terminals",
      "title": {
        "en": "Terminals & floor plan",
        "ar": "تهيئة الأجهزة وخريطة الطاولات"
      },
      "required": true,
      "feature_key": "pos.table_service"
    },
    {
      "id": "first_day",
      "title": {
        "en": "Run first service day and Z close",
        "ar": "تشغيل أول يوم خدمة والإغلاق اليومي"
      },
      "required": false,
      "feature_key": "pos.sales"
    }
  ],
  "capability_prerequisites": {
    "table_service": {
      "level": "REQUIRED",
      "feature_keys": [
        "pos.table_service"
      ],
      "available_from_phase": "PHASE-016"
    },
    "barcode_pos": {
      "level": "REQUIRED",
      "feature_keys": [
        "pos.terminals",
        "pos.sales",
        "pos.offline_queue",
        "pos.receipts"
      ],
      "available_from_phase": "PHASE-016"
    },
    "cashier_shifts": {
      "level": "REQUIRED",
      "feature_keys": [
        "treasury.cashier_shifts"
      ],
      "available_from_phase": "PHASE-016"
    },
    "composite_kits": {
      "level": "REQUIRED",
      "feature_keys": [
        "items.composite_products"
      ],
      "available_from_phase": "PHASE-016"
    },
    "expiry_tracking_fefo": {
      "level": "REQUIRED",
      "feature_keys": [
        "inventory.batch_tracking"
      ],
      "available_from_phase": "PHASE-010"
    },
    "kitchen_display": {
      "level": "OPTIONAL",
      "feature_keys": [
        "pos.kitchen_display"
      ],
      "available_from_phase": "PHASE-016"
    },
    "bom_production": {
      "level": "OPTIONAL",
      "feature_keys": [
        "manufacturing.bom",
        "manufacturing.production_orders"
      ],
      "available_from_phase": "PHASE-018"
    },
    "free_goods_promo": {
      "level": "OPTIONAL",
      "feature_keys": [
        "distribution.free_goods"
      ],
      "available_from_phase": "PHASE-017"
    }
  }
}$restaura$ WHERE "key" = 'industry.restaurant';

--> statement-breakpoint
-- industry.automotive — the workforce enablement (required_feature_keys + the hr block).
UPDATE "industry_templates" SET "manifest" = $automoti${
  "id": "industry.automotive",
  "name": "Automotive & Workshop",
  "name_ar": "قطع الغيار والورش",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine",
    "items.barcodes",
    "items.price_lists",
    "inventory.multi_warehouse",
    "inventory.serial_tracking",
    "inventory.reservations",
    "sales.quotations",
    "sales.job_cards",
    "sales.reps",
    "treasury.cashier_shifts",
    "hr.attendance",
    "hr.leave",
    "hr.shifts"
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
    "configuration"
  ],
  "terminology_overrides": {
    "svc.job_card": {
      "en": "Job card",
      "ar": "بطاقة عمل"
    },
    "fleet.vehicle": {
      "en": "Vehicle",
      "ar": "المركبة"
    },
    "svc.labor": {
      "en": "Labor",
      "ar": "أجور العمل"
    },
    "vehicle.make": {
      "en": "Make",
      "ar": "الصانع"
    },
    "vehicle.model": {
      "en": "Model",
      "ar": "الطراز"
    },
    "vehicle.chassis_no": {
      "en": "Chassis number (VIN)",
      "ar": "رقم الهيكل"
    },
    "vehicle.odometer": {
      "en": "Odometer",
      "ar": "عداد المسافة"
    },
    "svc.diagnosis": {
      "en": "Diagnosis",
      "ar": "الفحص والتشخيص"
    },
    "svc.technician": {
      "en": "Technician",
      "ar": "الفني"
    },
    "svc.service_history": {
      "en": "Service history",
      "ar": "سجل الصيانة"
    },
    "part.warranty": {
      "en": "Parts warranty",
      "ar": "ضمان قطع الغيار"
    }
  },
  "navigation_manifest": {
    "groups": [
      {
        "id": "workshop",
        "label": {
          "en": "Workshop",
          "ar": "الورشة"
        },
        "order": 1,
        "items": [
          {
            "id": "job_cards",
            "label": {
              "en": "Job cards",
              "ar": "بطاقات العمل"
            },
            "target": "sales.job_cards"
          },
          {
            "id": "vehicles",
            "label": {
              "en": "Vehicles",
              "ar": "المركبات"
            },
            "target": "partners.vehicles"
          },
          {
            "id": "quotes",
            "label": {
              "en": "Diagnosis quotes",
              "ar": "عروض التشخيص"
            },
            "target": "sales.quotations"
          }
        ]
      },
      {
        "id": "parts",
        "label": {
          "en": "Parts",
          "ar": "قطع الغيار"
        },
        "order": 2,
        "items": [
          {
            "id": "parts_stock",
            "label": {
              "en": "Parts stock",
              "ar": "مخزون القطع"
            },
            "target": "inventory.on_hand"
          },
          {
            "id": "purchasing",
            "label": {
              "en": "Parts purchasing",
              "ar": "شراء القطع"
            },
            "target": "purchasing.orders"
          },
          {
            "id": "counter",
            "label": {
              "en": "Counter sale",
              "ar": "بيع الكاونتر"
            },
            "target": "pos.counter",
            "feature_key": "pos.sales"
          }
        ]
      }
    ]
  },
  "workflow_policies": {
    "job_card_parts_issue_mode": "reserve",
    "job_card_labor_rate_source": "price_list",
    "quotation_validity_days": 7,
    "invoice_approval_required_over": 0,
    "warranty_credit_note_requires_original_invoice": true,
    "shift_variance_approval_required": true
  },
  "document_numbering_defaults": {
    "job_card": {
      "prefix": "JC",
      "format": "JC-{yyyy}-{seq:5}",
      "per_branch": true,
      "reserve_on_approval": false
    },
    "quotation": {
      "prefix": "QT",
      "format": "QT-{yyyy}-{seq:5}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "sales_invoice": {
      "prefix": "INV",
      "format": "INV-{yyyy}-{seq:6}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "credit_note": {
      "prefix": "CN",
      "format": "CN-{yyyy}-{seq:5}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "purchase_order": {
      "prefix": "PO",
      "format": "PO-{yyyy}-{seq:5}",
      "per_branch": false,
      "reserve_on_approval": true
    }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC",
    "default_track_batch": false,
    "default_track_expiry": false,
    "default_track_serial": false,
    "default_imei_tracking": false,
    "fefo_picking": false,
    "allow_negative_stock": false
  },
  "report_defaults": [
    {
      "report_key": "automotive.job_card_profitability",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_month"
    },
    {
      "report_key": "automotive.vehicle_service_history",
      "pinned": true,
      "dashboard": false,
      "default_period": "custom"
    },
    {
      "report_key": "inventory.valuation",
      "pinned": true,
      "dashboard": false,
      "default_period": "custom"
    },
    {
      "report_key": "ar.aging",
      "pinned": true,
      "dashboard": false,
      "default_period": "this_month"
    }
  ],
  "onboarding_steps": [
    {
      "id": "branch_bays",
      "title": {
        "en": "Branch, workshop & bays",
        "ar": "الفرع والورشة والمواقف"
      },
      "required": true
    },
    {
      "id": "coa_confirm",
      "title": {
        "en": "Confirm chart of accounts (parts vs labor revenue)",
        "ar": "تأكيد دليل الحسابات (إيراد القطع مقابل أجور العمل)"
      },
      "required": true
    },
    {
      "id": "labor_rates",
      "title": {
        "en": "Labor rate price lists",
        "ar": "قوائم أسعار أجور العمل"
      },
      "required": true
    },
    {
      "id": "parts_catalog",
      "title": {
        "en": "Parts catalog & suppliers",
        "ar": "كتالوج القطع والموردون"
      },
      "required": true
    },
    {
      "id": "opening_stock",
      "title": {
        "en": "Opening parts stock",
        "ar": "رصيد القطع الافتتاحي"
      },
      "required": true
    },
    {
      "id": "vehicles",
      "title": {
        "en": "Import customer vehicles",
        "ar": "استيراد مركبات العملاء"
      },
      "required": false
    },
    {
      "id": "first_job",
      "title": {
        "en": "Run a first job card end-to-end",
        "ar": "تنفيذ أول بطاقة عمل كاملة"
      },
      "required": false
    }
  ],
  "capability_prerequisites": {
    "job_cards": {
      "level": "REQUIRED",
      "feature_keys": [
        "sales.job_cards"
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
    "barcode_pos": {
      "level": "OPTIONAL",
      "feature_keys": [
        "pos.terminals",
        "pos.sales",
        "pos.receipts"
      ],
      "available_from_phase": "PHASE-016"
    },
    "service_contracts": {
      "level": "OPTIONAL",
      "feature_keys": [
        "crm.service_contracts"
      ],
      "available_from_phase": "PHASE-019"
    },
    "landed_costs": {
      "level": "OPTIONAL",
      "feature_keys": [
        "purchasing.landed_costs"
      ],
      "available_from_phase": "PHASE-011"
    },
    "qc_inspections": {
      "level": "OPTIONAL",
      "feature_keys": [
        "manufacturing.qc"
      ],
      "available_from_phase": "PHASE-018"
    }
  }
}$automoti$ WHERE "key" = 'industry.automotive';

--> statement-breakpoint
-- industry.food_manufacturing — the workforce enablement (required_feature_keys + the hr block).
UPDATE "industry_templates" SET "manifest" = $foodman${
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
    "purchasing.landed_costs",
    "hr.attendance",
    "hr.leave",
    "hr.shifts"
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
}$foodman$ WHERE "key" = 'industry.food_manufacturing';

--> statement-breakpoint
-- industry.healthcare — the workforce enablement (required_feature_keys + the hr block).
UPDATE "industry_templates" SET "manifest" = $healthca${
  "id": "industry.healthcare",
  "name": "Healthcare (Commercial Shell)",
  "name_ar": "الرعاية الصحية — الغلاف التجاري",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine",
    "partners.directory",
    "partners.statements",
    "sales.invoices",
    "sales.credit_limits",
    "notes.received",
    "inventory.batch_tracking",
    "crm.service_orders",
    "hr.attendance",
    "hr.leave",
    "hr.shifts"
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
    "crm",
    "notes",
    "configuration"
  ],
  "terminology_overrides": {
    "partner.patient": {
      "en": "Patient (financial file)",
      "ar": "المريض (الملف المالي)"
    },
    "partner.insurer": {
      "en": "Insurance company",
      "ar": "شركة التأمين"
    },
    "claim.ref": {
      "en": "Insurance claim",
      "ar": "مطالبة تأمينية"
    },
    "pharmacy.store": {
      "en": "Pharmacy",
      "ar": "صيدلية"
    },
    "svc.visit": {
      "en": "Visit",
      "ar": "الزيارة"
    },
    "doc.services_invoice": {
      "en": "Medical services invoice",
      "ar": "فاتورة الخدمات الطبية"
    },
    "billing.self_pay": {
      "en": "Self-pay",
      "ar": "دفع مباشر"
    },
    "notes.pdc": {
      "en": "Post-dated note",
      "ar": "شيك مؤجل"
    },
    "billing.collection": {
      "en": "Collection",
      "ar": "التحصيل"
    }
  },
  "navigation_manifest": {
    "groups": [
      {
        "id": "billing",
        "label": {
          "en": "Billing",
          "ar": "الفوترة"
        },
        "order": 1,
        "items": [
          {
            "id": "visits",
            "label": {
              "en": "Visits & service orders",
              "ar": "الزيارات وأوامر الخدمة"
            },
            "target": "crm.service_orders",
            "feature_key": "crm.service_orders"
          },
          {
            "id": "invoices",
            "label": {
              "en": "Invoices (patient / insurance)",
              "ar": "الفواتير (مريض / تأمين)"
            },
            "target": "sales.invoices"
          },
          {
            "id": "claims",
            "label": {
              "en": "Claims by insurer",
              "ar": "المطالبات حسب الشركة"
            },
            "target": "partners.statements"
          }
        ]
      },
      {
        "id": "pharmacy",
        "label": {
          "en": "Pharmacy",
          "ar": "الصيدلية"
        },
        "order": 2,
        "items": [
          {
            "id": "expiry",
            "label": {
              "en": "Expiry control",
              "ar": "الرقابة على الصلاحية"
            },
            "target": "inventory.expiry_list",
            "feature_key": "inventory.batch_tracking"
          },
          {
            "id": "counter",
            "label": {
              "en": "Pharmacy counter",
              "ar": "كاونتر الصيدلية"
            },
            "target": "pos.counter",
            "feature_key": "pos.sales"
          },
          {
            "id": "pdc",
            "label": {
              "en": "Claims cheques",
              "ar": "شيكات المطالبات"
            },
            "target": "notes.received",
            "feature_key": "notes.received"
          }
        ]
      }
    ]
  },
  "workflow_policies": {
    "patient_file_financial_only": true,
    "claim_ref_required_for_insured_invoices": true,
    "insurance_invoice_billed_to_company_partner": true,
    "pharmacy_fefo_enforced": true,
    "dunning_by_claim_enabled": true,
    "insurance_credit_limit_per_company": true
  },
  "document_numbering_defaults": {
    "sales_invoice": {
      "prefix": "INV",
      "format": "INV-{yyyy}-{seq:6}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "credit_note": {
      "prefix": "CN",
      "format": "CN-{yyyy}-{seq:5}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "receipt": {
      "prefix": "RCP",
      "format": "RCP-{yyyy}-{seq:6}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "goods_receipt": {
      "prefix": "GRN",
      "format": "GRN-{yyyy}-{seq:6}",
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
      "report_key": "notes.aging",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_month"
    },
    {
      "report_key": "notes.maturity-calendar",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_month"
    },
    {
      "report_key": "ar.aging",
      "pinned": true,
      "dashboard": false,
      "default_period": "this_month"
    },
    {
      "report_key": "inventory.expiry_list",
      "pinned": true,
      "dashboard": false,
      "default_period": "this_week"
    }
  ],
  "onboarding_steps": [
    {
      "id": "coa_confirm",
      "title": {
        "en": "Confirm chart of accounts (services, pharmacy, notes receivable)",
        "ar": "تأكيد دليل الحسابات (الخدمات، الصيدلية، أوراق القبض)"
      },
      "required": true
    },
    {
      "id": "payers",
      "title": {
        "en": "Insurers with credit limits & contracted fee schedules",
        "ar": "شركات التأمين مع سقوف الائتمان وأسعار التعاقد"
      },
      "required": true
    },
    {
      "id": "patients",
      "title": {
        "en": "Patient financial files (no clinical data)",
        "ar": "الملفات المالية للمرضى (بيانات مالية فقط)"
      },
      "required": true
    },
    {
      "id": "pharmacy_items",
      "title": {
        "en": "Pharmacy items with batches & expiry",
        "ar": "أصناف الصيدلية مع الدفعات والصلاحية"
      },
      "required": true
    },
    {
      "id": "service_items",
      "title": {
        "en": "Service items (consultation, procedure fees)",
        "ar": "بنود الخدمات (الاستشارات، الرسوم الطبية)"
      },
      "required": true
    },
    {
      "id": "first_visit",
      "title": {
        "en": "Bill a first visit (self-pay and insurance)",
        "ar": "فوترة أول زيارة (دفع مباشر وتأمين)"
      },
      "required": false
    },
    {
      "id": "first_claim",
      "title": {
        "en": "Register a first claim cheque",
        "ar": "تسجيل أول شيك مطالبة"
      },
      "required": false,
      "feature_key": "notes.received"
    }
  ],
  "capability_prerequisites": {
    "insurance_claim_billing": {
      "level": "REQUIRED",
      "feature_keys": [
        "sales.invoices",
        "notes.received",
        "partners.statements"
      ],
      "available_from_phase": "PHASE-031"
    },
    "pdc_notes": {
      "level": "REQUIRED",
      "feature_keys": [
        "notes.received",
        "notes.pdc_calendar"
      ],
      "available_from_phase": "PHASE-027"
    },
    "expiry_tracking_fefo": {
      "level": "REQUIRED",
      "feature_keys": [
        "inventory.batch_tracking"
      ],
      "available_from_phase": "PHASE-010"
    },
    "job_cards": {
      "level": "REQUIRED",
      "feature_keys": [
        "crm.service_orders"
      ],
      "available_from_phase": "PHASE-019"
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
        "items.price_lists",
        "distribution.customer_tiers"
      ],
      "available_from_phase": "PHASE-017"
    },
    "service_contracts": {
      "level": "OPTIONAL",
      "feature_keys": [
        "crm.service_contracts"
      ],
      "available_from_phase": "PHASE-019"
    },
    "installment_terms": {
      "level": "OPTIONAL",
      "feature_keys": [
        "installments.plans"
      ],
      "available_from_phase": "PHASE-027"
    }
  }
}$healthca$ WHERE "key" = 'industry.healthcare';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 88)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
