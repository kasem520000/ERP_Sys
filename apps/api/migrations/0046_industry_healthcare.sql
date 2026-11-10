-- PHASE-031 · migration 0046 · industry healthcare template (the commercial shell)
--
-- Purpose (PHASE-031 §5 T2; EXPANSION_REGISTER §B stage 10, ED-07): the
-- `industry.healthcare` v1.0.0 template registers in the industry_templates
-- seed registry as a versioned CONFIGURATION ARTIFACT over the existing
-- modules — applied and switched through the UNMODIFIED PHASE-015 engine
-- (BR-038 additive-only; graceful degradation when feature keys are absent
-- or phase-gated). "Configuration + light extension", never a fork: the
-- patient is a partner FINANCIAL file only (no clinical data — the bold
-- ED-07/ED-11 boundary, machine-checked by the zero-clinical-surface test),
-- insurers are partners with per-claim open items tracked through the
-- 0045 claim_ref column, the pharmacy is a FEFO batch store reusing
-- inventory.batch_tracking unchanged, and claims are settled by cheque or
-- post-dated note through the PHASE-027 notes module (G-24/G-25/G-26 —
-- 027 is a prerequisite, so the REQUIRED pdc_notes keys resolve LIVE at
-- apply time with no phase-gating fallback, unlike the 030 posture).
--
-- Report-key reconciliation (the 0025/0027/0044 convention, applied to the
-- docs mirror manifest.healthcare.json in the same phase): the manifest
-- doc spelling partners.ar_aging → the LIVE registry key ar.aging;
-- inventory.expiry_list resolves verbatim (the PHASE-015 industry
-- contract), as do notes.aging / notes.maturity-calendar — §J stays
-- closed: zero new report keys.
--
-- DATA-ONLY: zero new tables/columns/enums/journals/posting rules/
-- permission keys/plan grants (INV-022). Every REQUIRED feature key was
-- granted by earlier migrations (the notes chain by 0038, crm.service_orders
-- by 0027, inventory.batch_tracking + sales.credit_limits by 0008/0021,
-- partners.statements + sales.invoices by the base seeds) so the engine's
-- prerequisite check classifies everything LIVE at CURRENT_SHIPPED_PHASE
-- 031; the capability `insurance_claim_billing` (ED-07's own capability)
-- carries available_from_phase PHASE-031 ≤ 031 — the shell's defining
-- entry resolves LIVE on its own release.
--
-- The six typed workflow-policy keys the manifest sets
-- (patient_file_financial_only, claim_ref_required_for_insured_invoices,
-- insurance_invoice_billed_to_company_partner, pharmacy_fefo_enforced,
-- dunning_by_claim_enabled, insurance_credit_limit_per_company) register
-- in the code-owned POLICY_REGISTRY (configuration domain — NFR-011
-- unknown keys are rejected at manifest validation; the registry IS the
-- seed, no SQL rows exist for policy keys).
--
-- Idempotent upsert on key (SEEDS rule 2); the 0008 index rows converge
-- to the full manifest, is_active = true, status = 'ACTIVE'.
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Template registry seed (T2): the PHASE-031 v1.0.0 manifest, transcribed
-- VERBATIM from docs/industries/templates/healthcare.md (the ar.aging pin
-- reconciliation above applied) — the same source
-- packages/contracts/src/industry/templates.ts transcribes, so the DB seed,
-- the contracts constant, and the docs mirror stay byte-equivalent under
-- canonicalManifestJson.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest", "is_active", "status") VALUES
  ('industry.healthcare', 'Healthcare (Commercial Shell)', 'الرعاية الصحية — الغلاف التجاري', '1.0.0',
   '{
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
       "crm.service_orders"
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
   }'::jsonb, true, 'ACTIVE')
ON CONFLICT ("key") DO UPDATE
  SET "name" = EXCLUDED."name", "name_ar" = EXCLUDED."name_ar",
      "version" = EXCLUDED."version", "manifest" = EXCLUDED."manifest",
      "is_active" = true, "status" = 'ACTIVE';

--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 46)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
