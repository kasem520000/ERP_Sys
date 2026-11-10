-- COMPLETION (post-034 delivery audit) · migration 0047 · industry rental_logistics
-- template — the thirteenth commercial shell (the register's final column).
--
-- Purpose: the `industry.rental_logistics` v1.0.0 template registers in the
-- industry_templates seed registry as a versioned CONFIGURATION ARTIFACT over
-- the existing modules — applied and switched through the UNMODIFIED
-- PHASE-015 engine (BR-038 additive-only; graceful degradation when feature
-- keys are absent or phase-gated). "Configuration, never a fork": rental
-- contracts ride the live crm.service_contracts engine with the template's
-- terminology overlay (عقد الإيجار / الحجز / مبلغ التأمين), the fleet is
-- serial-tracked items over inventory.serial_tracking, deposits and late
-- fees post through the EXISTING contract-invoice + receipt machinery under
-- the seven typed workflow policies, and shipments ride the live
-- distribution routes + settlements surfaces. The deferred PHASE-019 intake
-- pair (crm.contract_deposits / crm.late_fees — RISK-019 decision record)
-- stays deferred: this seed grants NOTHING.
--
-- Report-key reconciliation (the 0025/0027/0044/0046 convention, applied to
-- the docs mirror manifest.rental_logistics.json in the same delivery): the
-- manifest doc spellings rental.fleet_utilization → the LIVE registry key
-- inventory.serial-tracking, rental.late_fee_register + partners.ar_aging →
-- ar.aging (deduplicated — late-fee receivables ARE AR open items),
-- logistics.shipment_status_board → distribution.route_visit_compliance;
-- services.contract_revenue_schedule resolves verbatim — §J stays closed:
-- zero new report keys.
--
-- Capability reconciliation: capability_prerequisites ≡ the CAPABILITY_MATRIX
-- §1 RNT column, STRICT both directions (the five matrix OPT cells the doc
-- manifest omitted — job_cards / customer_price_tiers / commissions /
-- pdc_notes / installment_terms — are declared over their live keys).
--
-- DATA-ONLY: zero new tables/columns/enums/journals/posting rules/
-- permission keys/plan grants (INV-022; drift stays 245=245). Every
-- REQUIRED feature key was granted by earlier migrations (crm set by 0027,
-- inventory.serial_tracking + items.item_master + partners.statements +
-- treasury.accounts by the base seeds, distribution pair by 0025, treasury
-- receipts by base) so the engine's prerequisite check classifies everything
-- LIVE at CURRENT_SHIPPED_PHASE 034; the defining capabilities carry
-- available_from_phase PHASE-017/019 ≤ 034.
--
-- The seven typed workflow-policy keys the manifest sets
-- (rental_deposit_required, late_fee_after_grace_hours,
-- late_fee_calculation, damage_charge_requires_inspection,
-- deposit_release_requires_manager_approval,
-- overdue_rental_blocks_new_reservation, shipment_milestones_manual)
-- register in the code-owned POLICY_REGISTRY (configuration domain —
-- NFR-011 unknown keys are rejected at manifest validation; the registry IS
-- the seed, no SQL rows exist for policy keys).
--
-- Idempotent upsert on key (SEEDS rule 2); the 0008 index row converges
-- from its phase-019 stub to the full manifest, is_active = true,
-- status = 'ACTIVE'.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Template registry seed: the v1.0.0 manifest, transcribed VERBATIM from
-- packages/contracts/src/industry/templates.ts (RENTAL_LOGISTICS_TEMPLATE_
-- MANIFEST) so the DB seed, the contracts constant, and the docs mirror
-- (with the reconciliations recorded above) stay byte-equivalent under
-- canonicalManifestJson.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest", "is_active", "status") VALUES
  ('industry.rental_logistics', 'Rental & Logistics', 'التأجير والخدمات اللوجستية', '1.0.0',
   '{
     "id": "industry.rental_logistics",
     "name": "Rental & Logistics",
     "name_ar": "التأجير والخدمات اللوجستية",
     "version": "1.0.0",
     "required_feature_keys": [
       "industry.template_engine",
       "crm.service_contracts",
       "crm.recurring_billing",
       "inventory.serial_tracking",
       "items.item_master",
       "partners.statements",
       "treasury.accounts"
     ],
     "default_modules_enabled": [
       "accounting",
       "partners",
       "items",
       "inventory",
       "sales",
       "treasury",
       "tax",
       "reporting",
       "crm",
       "distribution",
       "configuration"
     ],
     "terminology_overrides": {
       "rental.contract": {
         "en": "Rental contract",
         "ar": "عقد الإيجار"
       },
       "rental.reservation": {
         "en": "Reservation",
         "ar": "الحجز"
       },
       "rental.deposit": {
         "en": "Security deposit",
         "ar": "مبلغ التأمين"
       },
       "rental.late_fee": {
         "en": "Late fee",
         "ar": "رسوم التأخير"
       },
       "rental.pickup": {
         "en": "Pickup (check-out)",
         "ar": "الاستلام"
       },
       "rental.return": {
         "en": "Return (check-in)",
         "ar": "الإرجاع"
       },
       "rental.inspection": {
         "en": "Damage inspection",
         "ar": "فحص الأضرار"
       },
       "rental.fleet": {
         "en": "Fleet",
         "ar": "الأسطول"
       },
       "rental.utilization": {
         "en": "Utilization",
         "ar": "نسبة الاستغلال"
       },
       "rental.grace_period": {
         "en": "Grace period",
         "ar": "مدة السماح"
       },
       "logi.shipment": {
         "en": "Shipment",
         "ar": "الشحنة"
       },
       "logi.waybill": {
         "en": "Waybill",
         "ar": "بوليصة الشحن"
       },
       "logi.milestone": {
         "en": "Milestone",
         "ar": "تحديث حالة الشحنة"
       }
     },
     "navigation_manifest": {
       "groups": [
         {
           "id": "rental",
           "label": {
             "en": "Rental",
             "ar": "التأجير"
           },
           "order": 1,
           "items": [
             {
               "id": "reservations",
               "label": {
                 "en": "Reservations",
                 "ar": "الحجوزات"
               },
               "target": "crm.pipeline",
               "feature_key": "crm.leads"
             },
             {
               "id": "contracts",
               "label": {
                 "en": "Rental contracts",
                 "ar": "عقود الإيجار"
               },
               "target": "crm.contracts"
             },
             {
               "id": "fleet",
               "label": {
                 "en": "Fleet & assets",
                 "ar": "الأسطول والأصول"
               },
               "target": "items.item_master",
               "feature_key": "inventory.serial_tracking"
             },
             {
               "id": "returns",
               "label": {
                 "en": "Returns & inspections",
                 "ar": "الإرجاع والفحص"
               },
               "target": "crm.service_orders",
               "feature_key": "crm.service_orders"
             }
           ]
         },
         {
           "id": "logistics",
           "label": {
             "en": "Logistics",
             "ar": "الخدمات اللوجستية"
           },
           "order": 2,
           "items": [
             {
               "id": "shipments",
               "label": {
                 "en": "Shipments",
                 "ar": "الشحنات"
               },
               "target": "distribution.routes",
               "feature_key": "distribution.routes"
             },
             {
               "id": "status_board",
               "label": {
                 "en": "Status board",
                 "ar": "لوحة الحالات"
               },
               "target": "distribution.settlements",
               "feature_key": "distribution.settlements"
             }
           ]
         }
       ]
     },
     "workflow_policies": {
       "rental_deposit_required": true,
       "late_fee_after_grace_hours": 3,
       "late_fee_calculation": "daily_rate_based",
       "damage_charge_requires_inspection": true,
       "deposit_release_requires_manager_approval": true,
       "overdue_rental_blocks_new_reservation": true,
       "shipment_milestones_manual": true
     },
     "document_numbering_defaults": {
       "rental_contract": {
         "prefix": "RNT",
         "format": "RNT-{yyyy}-{seq:5}",
         "per_branch": true,
         "reserve_on_approval": true
       },
       "contract_invoice": {
         "prefix": "INV",
         "format": "INV-{yyyy}-{seq:6}",
         "per_branch": false,
         "reserve_on_approval": false
       },
       "receipt": {
         "prefix": "RCP",
         "format": "RCP-{yyyy}-{seq:6}",
         "per_branch": false,
         "reserve_on_approval": false
       },
       "payment": {
         "prefix": "PAY",
         "format": "PAY-{yyyy}-{seq:6}",
         "per_branch": false,
         "reserve_on_approval": false
       },
       "shipment": {
         "prefix": "SHP",
         "format": "SHP-{yyyy}-{seq:6}",
         "per_branch": false,
         "reserve_on_approval": false
       }
     },
     "inventory_policy_defaults": {
       "costing_method": "WAC",
       "default_track_batch": false,
       "default_track_expiry": false,
       "default_track_serial": true,
       "default_imei_tracking": false,
       "fefo_picking": false,
       "allow_negative_stock": false
     },
     "report_defaults": [
       {
         "report_key": "inventory.serial-tracking",
         "pinned": true,
         "dashboard": true,
         "default_period": "this_month"
       },
       {
         "report_key": "distribution.route_visit_compliance",
         "pinned": true,
         "dashboard": true,
         "default_period": "today"
       },
       {
         "report_key": "services.contract_revenue_schedule",
         "pinned": true,
         "dashboard": false,
         "default_period": "this_month"
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
         "id": "coa_confirm",
         "title": {
           "en": "Confirm chart of accounts (customer deposits liability)",
           "ar": "تأكيد دليل الحسابات (التزامات تأمينات العملاء)"
         },
         "required": true
       },
       {
         "id": "fleet",
         "title": {
           "en": "Register fleet/assets as serial items",
           "ar": "تسجيل الأسطول/الأصول كأصناف متسلسلة"
         },
         "required": true
       },
       {
         "id": "rate_cards",
         "title": {
           "en": "Rental rate cards",
           "ar": "تعريفات التأجير"
         },
         "required": true
       },
       {
         "id": "customers",
         "title": {
           "en": "Customers & ID documents",
           "ar": "العملاء ووثائق الهوية"
         },
         "required": true
       },
       {
         "id": "deposit_policy",
         "title": {
           "en": "Deposit & late-fee policy",
           "ar": "سياسة التأمين ورسوم التأخير"
         },
         "required": true
       },
       {
         "id": "first_contract",
         "title": {
           "en": "Run first rental contract end-to-end",
           "ar": "تنفيذ أول عقد إيجار كامل"
         },
         "required": false
       },
       {
         "id": "shipments",
         "title": {
           "en": "Configure shipment milestones (logistics)",
           "ar": "تهيئة حالات الشحنات (اللوجستيات)"
         },
         "required": false,
         "feature_key": "distribution.routes"
       }
     ],
     "capability_prerequisites": {
       "rental_contracts": {
         "level": "REQUIRED",
         "feature_keys": [
           "crm.service_contracts"
         ],
         "available_from_phase": "PHASE-019"
       },
       "service_contracts": {
         "level": "REQUIRED",
         "feature_keys": [
           "crm.service_contracts"
         ],
         "available_from_phase": "PHASE-019"
       },
       "recurring_billing": {
         "level": "REQUIRED",
         "feature_keys": [
           "crm.recurring_billing"
         ],
         "available_from_phase": "PHASE-019"
       },
       "deposits_late_fees": {
         "level": "REQUIRED",
         "feature_keys": [
           "crm.recurring_billing",
           "treasury.receipts_disbursements"
         ],
         "available_from_phase": "PHASE-019"
       },
       "shipment_tracking": {
         "level": "REQUIRED",
         "feature_keys": [
           "distribution.routes",
           "distribution.settlements"
         ],
         "available_from_phase": "PHASE-017"
       },
       "field_collections": {
         "level": "REQUIRED",
         "feature_keys": [
           "treasury.receipts_disbursements"
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
       "cashier_shifts": {
         "level": "OPTIONAL",
         "feature_keys": [
           "treasury.cashier_shifts"
         ],
         "available_from_phase": "PHASE-016"
       },
       "job_cards": {
         "level": "OPTIONAL",
         "feature_keys": [
           "crm.service_orders"
         ],
         "available_from_phase": "PHASE-019"
       },
       "customer_price_tiers": {
         "level": "OPTIONAL",
         "feature_keys": [
           "items.price_lists"
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
       "route_planning": {
         "level": "OPTIONAL",
         "feature_keys": [
           "distribution.routes"
         ],
         "available_from_phase": "PHASE-017"
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
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 47)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
