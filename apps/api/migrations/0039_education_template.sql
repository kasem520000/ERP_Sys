-- PHASE-032 · migration 0039 · education commercial shell — template
-- registry seed
--
-- Purpose (PHASE-032 §4–§6; EXPANSION_REGISTER §B/§L, ED-08): the
-- `industry.education` template ships as a **commercial shell** through
-- the unmodified PHASE-015 engine — configuration only, exactly per the
-- phase plan's Design Impact: **no new tables, no new modules, no new
-- feature keys, no new permission keys, INV-022 unchanged**. This
-- migration is additive seeds and a registry row only (§6 "Migration &
-- rollback"): the manifest row itself, converging the 0008 index row to
-- the full v1.0.0 manifest.
--
-- The tuition backbone rides the PHASE-027 modules verbatim: the guardian
-- is the paying AR partner, the student a partner financial file (never
-- academic data — ED-11), the enrollment year a crm.service_contracts
-- schedule source, tuition invoices ordinary sales documents with sibling
-- line discounts (BR-002 ceilings), and the tuition calendar the
-- installments module (BR-048/BR-049, G-05/G-28). The twelve
-- installments/notes feature keys were already granted to business +
-- enterprise by migration 0038 (the tier-4 precedent) — this migration
-- adds NO plan grants; starter stays degraded-back-office by design.
--
-- Manifest content: verbatim from
-- docs/industries/templates/manifests/manifest.education.json (the
-- canonical source; the §J doc reconciliation applied — the draft's
-- partners.ar_aging planning id pinned to the live ar.aging registry key,
-- the 0025/0027 precedent). Idempotent upsert on key; the 0008 index row
-- converges to the full manifest, is_active = true, status = 'ACTIVE'.
--
-- Lineage note (recorded honestly): PHASE-032 executes on the PHASE-027
-- lineage after the working environments holding the interim PHASE-028
-- through PHASE-031 states were lost to sandbox resets (the standing
-- re-initialization pattern — see commit 82eb5be). Stage-10 phases share
-- only the GA gate and their pre-GA functional prereqs
-- (PHASE_DEPENDENCY_GRAPH): education's prereqs (PHASE-015/025/027) are
-- all satisfied at this HEAD, so the template ships here ahead of the
-- still-unexecuted stage-9/10 siblings, which remain NOT_STARTED.

--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Template registry seed: the PHASE-032 manifest, verbatim from
-- docs/industries/templates/manifests/manifest.education.json (the
-- canonical source — the §J doc reconciliation applied: the
-- partners.ar_aging pin reconciled to the live ar.aging registry key).
-- Idempotent upsert on key; the 0008 index row converges to the full
-- manifest, is_active = true, status = 'ACTIVE'.
--> statement-breakpoint
INSERT INTO "industry_templates" ("key", "name", "name_ar", "version", "manifest", "is_active", "status") VALUES
  ('industry.education', 'Education (Commercial Shell)', 'التعليم — الغلاف التجاري', '1.0.0',
   '{
  "id": "industry.education",
  "name": "Education (Commercial Shell)",
  "name_ar": "التعليم — الغلاف التجاري",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine",
    "items.item_master",
    "items.price_lists",
    "partners.directory",
    "partners.statements",
    "crm.service_contracts",
    "sales.invoices",
    "treasury.receipts_disbursements",
    "installments.plans",
    "installments.collections",
    "installments.late_fees"
  ],
  "default_modules_enabled": [
    "accounting",
    "partners",
    "items",
    "sales",
    "treasury",
    "tax",
    "reporting",
    "crm",
    "installments",
    "configuration"
  ],
  "terminology_overrides": {
    "partner.student": {
      "en": "Student (financial file)",
      "ar": "الطالب (الملف المالي)"
    },
    "partner.guardian": {
      "en": "Guardian (payer)",
      "ar": "ولي الأمر (الدافع)"
    },
    "fee.tuition": {
      "en": "Tuition fees",
      "ar": "الرسوم الدراسية"
    },
    "fee.schedule": {
      "en": "Fee schedule (program/grade)",
      "ar": "جدول الرسوم (البرنامج / الصف)"
    },
    "doc.enrollment_contract": {
      "en": "Enrollment contract",
      "ar": "عقد الالتحاق"
    },
    "billing.installment": {
      "en": "Installment",
      "ar": "القسط"
    },
    "billing.installment_plan": {
      "en": "Installment plan",
      "ar": "خطة الأقساط"
    },
    "billing.down_payment": {
      "en": "Down payment",
      "ar": "الدفعة المقدمة"
    },
    "fee.late": {
      "en": "Late fee",
      "ar": "رسوم التأخير"
    },
    "discount.siblings": {
      "en": "Sibling discount",
      "ar": "خصم الأشقاء"
    }
  },
  "navigation_manifest": {
    "groups": [
      {
        "id": "enrollment",
        "label": {
          "en": "Enrollment",
          "ar": "الالتحاق"
        },
        "order": 1,
        "items": [
          {
            "id": "contracts",
            "label": {
              "en": "Enrollment contracts",
              "ar": "عقود الالتحاق"
            },
            "target": "crm.contracts",
            "feature_key": "crm.service_contracts"
          },
          {
            "id": "students",
            "label": {
              "en": "Students & guardians",
              "ar": "الطلاب وأولياء الأمور"
            },
            "target": "partners.directory"
          },
          {
            "id": "fee_lists",
            "label": {
              "en": "Fee schedules",
              "ar": "جداول الرسوم"
            },
            "target": "items.price_lists"
          }
        ]
      },
      {
        "id": "billing",
        "label": {
          "en": "Tuition billing",
          "ar": "فوترة الرسوم"
        },
        "order": 2,
        "items": [
          {
            "id": "plans",
            "label": {
              "en": "Installment plans",
              "ar": "خطط الأقساط"
            },
            "target": "installments.plans",
            "feature_key": "installments.plans"
          },
          {
            "id": "invoices",
            "label": {
              "en": "Tuition invoices",
              "ar": "فواتير الرسوم"
            },
            "target": "sales.invoices"
          },
          {
            "id": "due_list",
            "label": {
              "en": "Due & overdue installments",
              "ar": "الأقساط المستحقة والمتأخرة"
            },
            "target": "installments.collections",
            "feature_key": "installments.collections"
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
    "guardian_is_paying_partner": true,
    "tuition_invoice_from_contract": true,
    "installment_schedule_immutable_after_activation": true,
    "late_fee_policy_per_plan": true,
    "sibling_discount_line_level": true,
    "dunning_cycle_before_late_fee": true,
    "invoice_approval_required": true
  },
  "document_numbering_defaults": {
    "contract_invoice": {
      "prefix": "INV",
      "format": "INV-{yyyy}-{seq:6}",
      "per_branch": false,
      "reserve_on_approval": false
    },
    "sales_invoice": {
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
    "credit_note": {
      "prefix": "CN",
      "format": "CN-{yyyy}-{seq:5}",
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
      "report_key": "installments.schedule",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_month"
    },
    {
      "report_key": "installments.aging",
      "pinned": true,
      "dashboard": true,
      "default_period": "this_month"
    },
    {
      "report_key": "services.contract_revenue_schedule",
      "pinned": true,
      "dashboard": false,
      "default_period": "this_year"
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
        "en": "Confirm chart of accounts (tuition revenue, late-fee income)",
        "ar": "تأكيد دليل الحسابات (إيراد الرسوم، إيراد رسوم التأخير)"
      },
      "required": true
    },
    {
      "id": "programs",
      "title": {
        "en": "Programs/grades + fee schedule price lists",
        "ar": "البرامج والصفوف + جداول الرسوم"
      },
      "required": true
    },
    {
      "id": "guardians",
      "title": {
        "en": "Guardian partners & student financial files",
        "ar": "أولياء الأمور والملفات المالية للطلاب"
      },
      "required": true
    },
    {
      "id": "first_contract",
      "title": {
        "en": "First enrollment contract",
        "ar": "أول عقد التحاق"
      },
      "required": true
    },
    {
      "id": "first_plan",
      "title": {
        "en": "First tuition invoice + installment plan",
        "ar": "أول فاتورة رسوم وخطة أقساط"
      },
      "required": true
    },
    {
      "id": "first_collection",
      "title": {
        "en": "Collect a due installment (apply late fee)",
        "ar": "تحصيل قسط مستحق (مع رسوم تأخير)"
      },
      "required": false
    }
  ],
  "capability_prerequisites": {
    "installment_terms": {
      "level": "REQUIRED",
      "feature_keys": [
        "installments.plans",
        "installments.collections",
        "installments.late_fees"
      ],
      "available_from_phase": "PHASE-027"
    },
    "service_contracts": {
      "level": "REQUIRED",
      "feature_keys": [
        "crm.service_contracts"
      ],
      "available_from_phase": "PHASE-019"
    },
    "recurring_billing": {
      "level": "OPTIONAL",
      "feature_keys": [
        "crm.recurring_billing"
      ],
      "available_from_phase": "PHASE-019"
    },
    "deposits_late_fees": {
      "level": "OPTIONAL",
      "feature_keys": [
        "crm.contract_deposits",
        "crm.late_fees"
      ],
      "available_from_phase": "PHASE-019"
    },
    "customer_price_tiers": {
      "level": "OPTIONAL",
      "feature_keys": [
        "items.price_lists",
        "distribution.customer_tiers"
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
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 39)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
