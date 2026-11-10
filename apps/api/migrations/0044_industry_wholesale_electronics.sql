-- PHASE-030 · migration 0044 · industry wholesale + electronics templates
--
-- Purpose (PHASE-030 §5 T1; EXPANSION_REGISTER §B stage 10, ED-06): the
-- first two Blueprint v2.0 industry templates — industry.wholesale and
-- industry.electronics — register in the industry_templates seed registry
-- as versioned CONFIGURATION ARTIFACTS over the existing modules, applied
-- and switched through the UNMODIFIED PHASE-015 engine (BR-038
-- additive-only; graceful degradation when feature keys are absent or
-- phase-gated). This is an explicitly CONFIGURATION-ONLY migration:
-- INV-022 is the phase's central constraint, so there are NO new tables,
-- columns, enums, journals, posting rules, permission keys, or plan
-- grants here (every REQUIRED feature key of both manifests was already
-- granted by earlier migrations: the wholesale notes chain by 0038, the
-- electronics POS set by 0024, crm.service_orders by 0027 — the engine's
-- prerequisite check classifies everything LIVE at CURRENT_SHIPPED_PHASE).
--
-- Report-key reconciliation (the 0025/0027 convention, applied to the
-- docs mirrors manifest.wholesale.json / manifest.electronics.json in the
-- same phase): partners.ar_aging → ar.aging and inventory.stock_valuation
-- → inventory.valuation are the LIVE report-registry keys the pins land
-- on (notes.maturity-calendar / notes.aging / retail.imei_register /
-- pos.sales_by_terminal / pos.sales_by_hour resolve verbatim — §J stays
-- closed: zero new report keys).
--
-- The typed workflow-policy keys the manifests set (qty_break_pricing_
-- automatic, bulk_order_from_quote_one_click, delivery_before_credit_
-- invoice, statement_monthly_by_default, pdc_note_requires_maturity_date,
-- imei_capture_required_flagged_items, repair_parts_issue_mode,
-- repair_card_labor_rate_source, tradein_purchase_at_branch) register in
-- the code-owned POLICY_REGISTRY (configuration domain — NFR-011 unknown
-- keys are rejected at manifest validation; the registry IS the seed, no
-- SQL rows exist for policy keys).
--
-- Idempotent upsert on key (SEEDS rule 2); the 0008 index rows converge
-- to the full manifests, is_active = true, status = 'ACTIVE'.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Template registry seeds (T1): the two PHASE-030 v1.0.0 manifests,
-- transcribed VERBATIM from docs/industries/templates/{wholesale,
-- electronics}.md (the reconciled report keys above applied) — the same
-- source packages/contracts/src/industry/templates.ts transcribes, so
-- the DB seed, the contracts constant, and the docs mirror stay
-- byte-equivalent under canonicalManifestJson.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest", "is_active", "status") VALUES
  ('industry.wholesale', 'Wholesale & Trade', 'الجملة والتجارة', '1.0.0',
   '{
     "id": "industry.wholesale",
     "name": "Wholesale & Trade",
     "name_ar": "الجملة والتجارة",
     "version": "1.0.0",
     "required_feature_keys": [
       "industry.template_engine",
       "items.barcodes",
       "items.price_lists",
       "partners.credit_terms",
       "partners.statements",
       "sales.quotations",
       "sales.orders",
       "sales.deliveries",
       "sales.invoices",
       "sales.credit_limits",
       "purchasing.goods_receipts",
       "inventory.multi_warehouse",
       "notes.received"
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
       "notes",
       "configuration"
     ],
     "terminology_overrides": {
       "partner.customer": {
         "en": "Customer (trader)",
         "ar": "العميل / التاجر"
       },
       "doc.sales_invoice": {
         "en": "Wholesale sales invoice",
         "ar": "فاتورة بيع جملة"
       },
       "doc.quotation": {
         "en": "Trade quote",
         "ar": "عرض السعر"
       },
       "doc.sales_order": {
         "en": "Bulk order",
         "ar": "أمر التوريد"
       },
       "billing.receipt_voucher": {
         "en": "Receipt voucher",
         "ar": "سند قبض"
       },
       "price.qty_break": {
         "en": "Quantity break",
         "ar": "شريحة الكمية"
       },
       "price.min_qty": {
         "en": "Min. quantity",
         "ar": "الحد الأدنى للكمية"
       },
       "price.customer_tier": {
         "en": "Customer price tier",
         "ar": "فئة سعر العميل"
       },
       "credit.limit": {
         "en": "Credit limit",
         "ar": "سقف الائتمان"
       },
       "credit.terms": {
         "en": "Credit terms",
         "ar": "شروط الدفع"
       },
       "notes.pdc": {
         "en": "Post-dated note",
         "ar": "شيك مؤجل"
       },
       "billing.statement": {
         "en": "Customer statement",
         "ar": "كشف حساب العميل"
       }
     },
     "navigation_manifest": {
       "groups": [
         {
           "id": "trading",
           "label": {
             "en": "Trading",
             "ar": "التجارة"
           },
           "order": 1,
           "items": [
             {
               "id": "quick_order",
               "label": {
                 "en": "Bulk quick order",
                 "ar": "إدخال طلب سريع"
               },
               "target": "sales.quick_order"
             },
             {
               "id": "quotes",
               "label": {
                 "en": "Quotes",
                 "ar": "عروض الأسعار"
               },
               "target": "sales.quotations"
             },
             {
               "id": "orders",
               "label": {
                 "en": "Bulk orders",
                 "ar": "أوامر التوريد"
               },
               "target": "sales.orders"
             },
             {
               "id": "deliveries",
               "label": {
                 "en": "Deliveries",
                 "ar": "إشعارات التسليم"
               },
               "target": "sales.deliveries"
             }
           ]
         },
         {
           "id": "credit",
           "label": {
             "en": "Credit & collections",
             "ar": "الائتمان والتحصيل"
           },
           "order": 2,
           "items": [
             {
               "id": "invoices",
               "label": {
                 "en": "Credit invoices",
                 "ar": "فواتير الآجل"
               },
               "target": "sales.invoices"
             },
             {
               "id": "statements",
               "label": {
                 "en": "Customer statements",
                 "ar": "كشوف الحسابات"
               },
               "target": "partners.statements"
             },
             {
               "id": "pdc",
               "label": {
                 "en": "PDC custody",
                 "ar": "الشيكات المؤجلة"
               },
               "target": "notes.received",
               "feature_key": "notes.received"
             },
             {
               "id": "maturity",
               "label": {
                 "en": "Maturity calendar",
                 "ar": "تقويم الاستحقاق"
               },
               "target": "notes.pdc_calendar",
               "feature_key": "notes.pdc_calendar"
             }
           ]
         }
       ]
     },
     "workflow_policies": {
       "credit_sale_credit_limit_enforced": true,
       "qty_break_pricing_automatic": true,
       "tier_price_automatic_by_partner": true,
       "bulk_order_from_quote_one_click": true,
       "delivery_before_credit_invoice": true,
       "statement_monthly_by_default": true,
       "pdc_note_requires_maturity_date": true
     },
     "document_numbering_defaults": {
       "quotation": {
         "prefix": "QT",
         "format": "QT-{yyyy}-{seq:5}",
         "per_branch": false,
         "reserve_on_approval": false
       },
       "sales_order": {
         "prefix": "ORD",
         "format": "ORD-{yyyy}-{seq:6}",
         "per_branch": false,
         "reserve_on_approval": true
       },
       "delivery_note": {
         "prefix": "DLV",
         "format": "DLV-{yyyy}-{seq:5}",
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
       "default_track_batch": false,
       "default_track_expiry": false,
       "default_track_serial": false,
       "default_imei_tracking": false,
       "fefo_picking": false,
       "allow_negative_stock": false
     },
     "report_defaults": [
       {
         "report_key": "notes.maturity-calendar",
         "pinned": true,
         "dashboard": true,
         "default_period": "this_month"
       },
       {
         "report_key": "notes.aging",
         "pinned": true,
         "dashboard": false,
         "default_period": "this_month"
       },
       {
         "report_key": "ar.aging",
         "pinned": true,
         "dashboard": true,
         "default_period": "this_month"
       },
       {
         "report_key": "inventory.valuation",
         "pinned": true,
         "dashboard": false,
         "default_period": "custom"
       }
     ],
     "onboarding_steps": [
       {
         "id": "coa_confirm",
         "title": {
           "en": "Confirm chart of accounts (trade receivables, notes receivable)",
           "ar": "تأكيد دليل الحسابات (ذمم التجار، أوراق القبض)"
         },
         "required": true
       },
       {
         "id": "warehouses",
         "title": {
           "en": "Main & branch warehouses",
           "ar": "المستودع الرئيسي ومستودعات الفروع"
         },
         "required": true
       },
       {
         "id": "price_tiers",
         "title": {
           "en": "Price lists with quantity breaks & customer tiers",
           "ar": "قوائم الأسعار مع شرائح الكمية وفئات العملاء"
         },
         "required": true
       },
       {
         "id": "customers_credit",
         "title": {
           "en": "Customers with credit terms, limits & opening balances",
           "ar": "العملاء مع شروط الدفع وحدود الائتمان والأرصدة الافتتاحية"
         },
         "required": true
       },
       {
         "id": "opening_stock",
         "title": {
           "en": "Opening stock via goods receipts",
           "ar": "المخزون الافتتاحي عبر سندات الاستلام"
         },
         "required": true
       },
       {
         "id": "first_cycle",
         "title": {
           "en": "Run quote → bulk order → delivery → credit invoice",
           "ar": "تنفيذ أول دورة: عرض، أمر توريد، تسليم، فاتورة آجل"
         },
         "required": false
       },
       {
         "id": "first_pdc",
         "title": {
           "en": "Receive a first PDC note against an invoice",
           "ar": "استلام أول شيك مؤجل مقابل فاتورة"
         },
         "required": false,
         "feature_key": "notes.received"
       }
     ],
     "capability_prerequisites": {
       "customer_price_tiers": {
         "level": "REQUIRED",
         "feature_keys": [
           "items.price_lists",
           "distribution.customer_tiers"
         ],
         "available_from_phase": "PHASE-017"
       },
       "pdc_notes": {
         "level": "REQUIRED",
         "feature_keys": [
           "notes.received",
           "notes.pdc_calendar"
         ],
         "available_from_phase": "PHASE-027"
       },
       "installment_terms": {
         "level": "OPTIONAL",
         "feature_keys": [
           "installments.plans",
           "installments.late_fees"
         ],
         "available_from_phase": "PHASE-027"
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
       "imei_tracking": {
         "level": "OPTIONAL",
         "feature_keys": [
           "inventory.serial_tracking"
         ],
         "available_from_phase": "PHASE-010"
       },
       "expiry_tracking_fefo": {
         "level": "OPTIONAL",
         "feature_keys": [
           "inventory.batch_tracking"
         ],
         "available_from_phase": "PHASE-010"
       },
       "free_goods_promo": {
         "level": "OPTIONAL",
         "feature_keys": [
           "sales.discount_management",
           "distribution.free_goods"
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
       "route_planning": {
         "level": "OPTIONAL",
         "feature_keys": [
           "distribution.routes"
         ],
         "available_from_phase": "PHASE-017"
       },
       "field_collections": {
         "level": "OPTIONAL",
         "feature_keys": [
           "treasury.receipts_disbursements"
         ],
         "available_from_phase": "PHASE-017"
       },
       "shipment_tracking": {
         "level": "OPTIONAL",
         "feature_keys": [
           "distribution.shipment_tracking"
         ],
         "available_from_phase": "PHASE-019"
       }
     }
   }'::jsonb, true, 'ACTIVE'),
  ('industry.electronics', 'Mobile & Electronics', 'الجوالات والإلكترونيات', '1.0.0',
   '{
     "id": "industry.electronics",
     "name": "Mobile & Electronics",
     "name_ar": "الجوالات والإلكترونيات",
     "version": "1.0.0",
     "required_feature_keys": [
       "industry.template_engine",
       "items.barcodes",
       "items.price_lists",
       "inventory.serial_tracking",
       "pos.terminals",
       "pos.sales",
       "pos.offline_queue",
       "pos.receipts",
       "crm.service_orders",
       "sales.invoices",
       "treasury.cashier_shifts"
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
       "crm",
       "configuration"
     ],
     "terminology_overrides": {
       "pos.sale": {
         "en": "Retail sale",
         "ar": "بيع بالتجزئة"
       },
       "svc.repair_card": {
         "en": "Repair card",
         "ar": "بطاقة صيانة"
       },
       "svc.repair": {
         "en": "Repair",
         "ar": "الصيانة / الإصلاح"
       },
       "item.imei": {
         "en": "IMEI",
         "ar": "الرقم التسلسلي (IMEI)"
       },
       "device.checkin": {
         "en": "Device check-in",
         "ar": "استلام الجهاز"
       },
       "tradein.purchase": {
         "en": "Trade-in purchase",
         "ar": "شراء جهاز مستعمل"
       },
       "part.accessory": {
         "en": "Accessory",
         "ar": "ملحق"
       },
       "part.spare": {
         "en": "Spare part",
         "ar": "قطعة غيار"
       },
       "svc.warranty": {
         "en": "Warranty claim",
         "ar": "بطارية الضمان / مطالبة الضمان"
       },
       "svc.labor": {
         "en": "Labor",
         "ar": "أجور الصيانة"
       }
     },
     "navigation_manifest": {
       "groups": [
         {
           "id": "counter",
           "label": {
             "en": "Counter",
             "ar": "الكاونتر"
           },
           "order": 1,
           "items": [
             {
               "id": "pos",
               "label": {
                 "en": "Point of sale",
                 "ar": "نقطة البيع"
               },
               "target": "pos.counter",
               "feature_key": "pos.sales"
             },
             {
               "id": "imei",
               "label": {
                 "en": "IMEI register",
                 "ar": "سجل الأجهزة"
               },
               "target": "inventory.imei",
               "feature_key": "inventory.serial_tracking"
             },
             {
               "id": "tradein",
               "label": {
                 "en": "Trade-in purchases",
                 "ar": "شراء الأجهزة المستعملة"
               },
               "target": "purchasing.tradein"
             }
           ]
         },
         {
           "id": "service",
           "label": {
             "en": "Repair",
             "ar": "الصيانة"
           },
           "order": 2,
           "items": [
             {
               "id": "repair_cards",
               "label": {
                 "en": "Repair cards",
                 "ar": "بطاقات الصيانة"
               },
               "target": "crm.service_orders",
               "feature_key": "crm.service_orders"
             },
             {
               "id": "returns",
               "label": {
                 "en": "Returns & exchanges",
                 "ar": "المرتجعات والاستبدال"
               },
               "target": "sales.credit_notes"
             },
             {
               "id": "receipts",
               "label": {
                 "en": "Receipts",
                 "ar": "سندات القبض"
               },
               "target": "treasury.receipts"
             }
           ]
         }
       ]
     },
     "workflow_policies": {
       "cash_sales_autopost": true,
       "imei_capture_required_flagged_items": true,
       "repair_parts_issue_mode": "reserve",
       "repair_card_labor_rate_source": "price_list",
       "tradein_purchase_at_branch": true,
       "warranty_credit_note_requires_original_invoice": true,
       "shift_variance_approval_required": true
     },
     "document_numbering_defaults": {
       "sales_invoice": {
         "prefix": "INV",
         "format": "INV-{yyyy}-{seq:6}",
         "per_branch": false,
         "reserve_on_approval": false
       },
       "pos_sale": {
         "prefix": "POS",
         "format": "POS-{branch}-{yy}{MM}-{seq:5}",
         "per_branch": true,
         "reserve_on_approval": false
       },
       "job_card": {
         "prefix": "RC",
         "format": "RC-{yyyy}-{seq:5}",
         "per_branch": true,
         "reserve_on_approval": false
       },
       "credit_note": {
         "prefix": "CN",
         "format": "CN-{yyyy}-{seq:5}",
         "per_branch": false,
         "reserve_on_approval": false
       },
       "goods_receipt": {
         "prefix": "GRN",
         "format": "GRN-{yyyy}-{seq:5}",
         "per_branch": false,
         "reserve_on_approval": false
       }
     },
     "inventory_policy_defaults": {
       "costing_method": "WAC",
       "default_track_batch": false,
       "default_track_expiry": false,
       "default_track_serial": true,
       "default_imei_tracking": true,
       "fefo_picking": false,
       "allow_negative_stock": false
     },
     "report_defaults": [
       {
         "report_key": "retail.imei_register",
         "pinned": true,
         "dashboard": true,
         "default_period": "this_month"
       },
       {
         "report_key": "pos.sales_by_terminal",
         "pinned": true,
         "dashboard": true,
         "default_period": "today"
       },
       {
         "report_key": "pos.sales_by_hour",
         "pinned": true,
         "dashboard": false,
         "default_period": "this_week"
       },
       {
         "report_key": "inventory.valuation",
         "pinned": true,
         "dashboard": false,
         "default_period": "custom"
       }
     ],
     "onboarding_steps": [
       {
         "id": "counter_branch",
         "title": {
           "en": "Create branch, stockroom & terminals",
           "ar": "إنشاء الفرع والمستودع وأجهزة نقطة البيع"
         },
         "required": true
       },
       {
         "id": "coa_confirm",
         "title": {
           "en": "Confirm chart of accounts (device vs service vs used-goods)",
           "ar": "تأكيد دليل الحسابات (الأجهزة، الصيانة، الأجهزة المستعملة)"
         },
         "required": true
       },
       {
         "id": "imei_categories",
         "title": {
           "en": "Item categories with IMEI flags",
           "ar": "تصنيفات الأصناف مع خيار تسجيل IMEI"
         },
         "required": true
       },
       {
         "id": "labor_rates",
         "title": {
           "en": "Repair labor rate lists",
           "ar": "قوائم أسعار أجور الصيانة"
         },
         "required": true
       },
       {
         "id": "opening_stock",
         "title": {
           "en": "Opening stock with IMEI capture",
           "ar": "المخزون الافتتاحي مع تسجيل الأجهزة"
         },
         "required": true
       },
       {
         "id": "first_repair",
         "title": {
           "en": "Run a first repair card end-to-end",
           "ar": "تنفيذ أول بطاقة صيانة كاملة"
         },
         "required": false,
         "feature_key": "crm.service_orders"
       },
       {
         "id": "first_shift",
         "title": {
           "en": "Open first shift and sell",
           "ar": "افتتاح أول وردية وإجراء أول عملية بيع"
         },
         "required": false,
         "feature_key": "pos.sales"
       }
     ],
     "capability_prerequisites": {
       "imei_tracking": {
         "level": "REQUIRED",
         "feature_keys": [
           "inventory.serial_tracking"
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
         "level": "OPTIONAL",
         "feature_keys": [
           "items.composite_products"
         ],
         "available_from_phase": "PHASE-016"
       },
       "customer_price_tiers": {
         "level": "OPTIONAL",
         "feature_keys": [
           "distribution.customer_tiers"
         ],
         "available_from_phase": "PHASE-017"
       },
       "free_goods_promo": {
         "level": "OPTIONAL",
         "feature_keys": [
           "sales.discount_management",
           "distribution.free_goods"
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
       "service_contracts": {
         "level": "OPTIONAL",
         "feature_keys": [
           "crm.service_contracts"
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
       "installment_terms": {
         "level": "OPTIONAL",
         "feature_keys": [
           "installments.plans"
         ],
         "available_from_phase": "PHASE-027"
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
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 44)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
