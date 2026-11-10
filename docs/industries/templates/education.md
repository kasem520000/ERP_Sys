# Template: Education (Commercial Shell) — `education`

> **Status:** STABLE · **Owner:** Industry Solutions Architecture · **Updated:** 2026-11-08

The **commercial office** of a school: the guardian is the paying partner, the enrollment
year is a **service contract عقد الالتحاق**, tuition bills in **installments أقساط** with
late-fee dunning, and siblings discount through line-level policies. Shipped in PHASE-032
([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B; ED-08 — applied via the
unmodified PHASE-015 engine; migration 0039 registry seed). Manifest schema:
[../README.md](../README.md) §3. Signature flow summary:
[../workflows/industry-workflows.md](../workflows/industry-workflows.md) §j.

## Target businesses

- Private schools (K-12) billing tuition in term or monthly installments.
- Training centers (course packages, cohort batches).
- Tutoring businesses and test-prep institutes.
- Nurseries and after-school programs.

## Manifest

```json
{
  "id": "industry.education",
  "name": "Education (Commercial Shell)",
  "name_ar": "التعليم — الغلاف التجاري",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine", "items.item_master", "items.price_lists",
    "partners.directory", "partners.statements", "crm.service_contracts",
    "sales.invoices", "treasury.receipts_disbursements",
    "installments.plans", "installments.collections", "installments.late_fees"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "sales", "treasury",
    "tax", "reporting", "crm", "installments", "configuration"],
  "terminology_overrides": {
    "partner.student": { "en": "Student (financial file)", "ar": "الطالب (الملف المالي)" },
    "partner.guardian": { "en": "Guardian (payer)", "ar": "ولي الأمر (الدافع)" },
    "fee.tuition": { "en": "Tuition fees", "ar": "الرسوم الدراسية" },
    "fee.schedule": { "en": "Fee schedule (program/grade)", "ar": "جدول الرسوم (البرنامج / الصف)" },
    "doc.enrollment_contract": { "en": "Enrollment contract", "ar": "عقد الالتحاق" },
    "billing.installment": { "en": "Installment", "ar": "القسط" },
    "billing.installment_plan": { "en": "Installment plan", "ar": "خطة الأقساط" },
    "billing.down_payment": { "en": "Down payment", "ar": "الدفعة المقدمة" },
    "fee.late": { "en": "Late fee", "ar": "رسوم التأخير" },
    "discount.siblings": { "en": "Sibling discount", "ar": "خصم الأشقاء" }
  },
  "navigation_manifest": { "groups": [
    { "id": "enrollment", "label": { "en": "Enrollment", "ar": "الالتحاق" }, "order": 1, "items": [
      { "id": "contracts", "label": { "en": "Enrollment contracts", "ar": "عقود الالتحاق" }, "target": "crm.contracts", "feature_key": "crm.service_contracts" },
      { "id": "students", "label": { "en": "Students & guardians", "ar": "الطلاب وأولياء الأمور" }, "target": "partners.directory" },
      { "id": "fee_lists", "label": { "en": "Fee schedules", "ar": "جداول الرسوم" }, "target": "items.price_lists" }
    ]},
    { "id": "billing", "label": { "en": "Tuition billing", "ar": "فوترة الرسوم" }, "order": 2, "items": [
      { "id": "plans", "label": { "en": "Installment plans", "ar": "خطط الأقساط" }, "target": "installments.plans", "feature_key": "installments.plans" },
      { "id": "invoices", "label": { "en": "Tuition invoices", "ar": "فواتير الرسوم" }, "target": "sales.invoices" },
      { "id": "due_list", "label": { "en": "Due & overdue installments", "ar": "الأقساط المستحقة والمتأخرة" }, "target": "installments.collections", "feature_key": "installments.collections" },
      { "id": "receipts", "label": { "en": "Receipts", "ar": "سندات القبض" }, "target": "treasury.receipts" }
    ]}
  ]},
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
    "contract_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "receipt": { "prefix": "RCP", "format": "RCP-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "credit_note": { "prefix": "CN", "format": "CN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC", "default_track_batch": false, "default_track_expiry": false,
    "default_track_serial": false, "default_imei_tracking": false, "fefo_picking": false,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "installments.schedule", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "installments.aging", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "services.contract_revenue_schedule", "pinned": true, "dashboard": false, "default_period": "this_year" },
    { "report_key": "ar.aging", "pinned": true, "dashboard": false, "default_period": "this_month" }
  ],
  "onboarding_steps": [
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts (tuition revenue, late-fee income)", "ar": "تأكيد دليل الحسابات (إيراد الرسوم، إيراد رسوم التأخير)" }, "required": true },
    { "id": "programs", "title": { "en": "Programs/grades + fee schedule price lists", "ar": "البرامج والصفوف + جداول الرسوم" }, "required": true },
    { "id": "guardians", "title": { "en": "Guardian partners & student financial files", "ar": "أولياء الأمور والملفات المالية للطلاب" }, "required": true },
    { "id": "first_contract", "title": { "en": "First enrollment contract", "ar": "أول عقد التحاق" }, "required": true },
    { "id": "first_plan", "title": { "en": "First tuition invoice + installment plan", "ar": "أول فاتورة رسوم وخطة أقساط" }, "required": true },
    { "id": "first_collection", "title": { "en": "Collect a due installment (apply late fee)", "ar": "تحصيل قسط مستحق (مع رسوم تأخير)" }, "required": false }
  ],
  "capability_prerequisites": {
    "installment_terms": { "level": "REQUIRED", "feature_keys": ["installments.plans", "installments.collections", "installments.late_fees"], "available_from_phase": "PHASE-027" },
    "service_contracts": { "level": "REQUIRED", "feature_keys": ["crm.service_contracts"], "available_from_phase": "PHASE-019" },
    "recurring_billing": { "level": "OPTIONAL", "feature_keys": ["crm.recurring_billing"], "available_from_phase": "PHASE-019" },
    "deposits_late_fees": { "level": "OPTIONAL", "feature_keys": ["crm.contract_deposits", "crm.late_fees"], "available_from_phase": "PHASE-019" },
    "customer_price_tiers": { "level": "OPTIONAL", "feature_keys": ["items.price_lists", "distribution.customer_tiers"], "available_from_phase": "PHASE-017" },
    "pdc_notes": { "level": "OPTIONAL", "feature_keys": ["notes.received"], "available_from_phase": "PHASE-027" },
    "cashier_shifts": { "level": "OPTIONAL", "feature_keys": ["treasury.cashier_shifts"], "available_from_phase": "PHASE-016" }
  }
}
```

## Enabled features (exact keys)

| Feature key | Required? | Phase | Note |
|---|---|---|---|
| `crm.service_contracts` | Required | PHASE-019 | Enrollment/year contracts; posts nothing itself |
| `installments.plans`, `installments.collections`, `installments.late_fees` | Required | PHASE-027 | Tuition plans: monthly/term dues, collection runs, late fees |
| `sales.invoices` | Required | PHASE-012 | Tuition invoices (fee + discount lines) |
| `items.item_master`, `items.price_lists` | Required | PHASE-006/012 | Fee items; fee schedules per program/grade |
| `partners.directory`, `partners.statements` | Required | PHASE-006 | Guardian = paying partner; student = financial file |
| `treasury.receipts_disbursements` | Required | PHASE-008 | Installment receipt posting (G-05) |
| `crm.recurring_billing` | Optional | PHASE-019 | Term-invoice generation from contracts (§8-style alternative to plans) |
| `crm.contract_deposits`, `crm.late_fees` | Optional | PHASE-019 | Registration deposits (BR-027 on-account credits) |
| `sales.discount_management` | Optional | PHASE-012 | **Sibling/multi-child discounts** as line-level policies |
| `notes.received` | Optional | PHASE-027 | Parents paying tuition by post-dated cheques |

## Terminology overrides (sample)

| Term key | English | العربية | Note |
|---|---|---|---|
| `partner.student` | Student (financial file) | الطالب (الملف المالي) | Billing subject; **no academic data** |
| `partner.guardian` | Guardian (payer) | ولي الأمر (الدافع) | The AR partner |
| `fee.tuition` | Tuition fees | الرسوم الدراسية | Service item lines |
| `doc.enrollment_contract` | Enrollment contract | عقد الالتحاق | Contract per student per year |
| `billing.installment` | Installment | القسط | Plan line with due date |
| `billing.installment_plan` | Installment plan | خطة الأقساط | BR-048: total = source invoice; immutable after activation |
| `fee.late` | Late fee | رسوم التأخير | Per-plan policy (BR-049); posts via G-28 |
| `discount.siblings` | Sibling discount | خصم الأشقاء | Line-level discount policy |

## Default navigation (sample)

| EN | AR | Target |
|----|----|--------|
| Enrollment contracts | عقود الالتحاق | `crm.contracts` |
| Students & guardians | الطلاب وأولياء الأمور | `partners.directory` |
| Installment plans | خطط الأقساط | `installments.plans` |
| Tuition invoices | فواتير الرسوم | `sales.invoices` |
| Due & overdue installments | الأقساط المستحقة والمتأخرة | `installments.collections` |
| Receipts | سندات القبض | `treasury.receipts` |

## Signature workflow — enrollment → tuition plan → due → collect → late fee

1. **Enrollment contract عقد الالتحاق** — guardian (paying partner) + student (financial
   file) + program/grade; the fee schedule price list resolves the year's tuition lines;
   sibling discounts apply as line-level policies. *No ledger effect.*
2. **Tuition invoice فاتورة الرسوم** — generated from the contract (recurring-billing style,
   one per contract-period, or a single annual invoice): **DR AR (guardian) · CR tuition
   revenue · CR VAT** where the jurisdiction pack taxes education (G-01; treatment from the
   pack — nothing hard-coded).
3. **Installment plan خطة الأقساط** — activated against the invoice: total equals the
   invoice exactly (BR-048), down payment + monthly/term dues; schedule immutable after
   activation.
4. **Due → collect** — `installments.collections` runs raise receipts as dues fall due:
   **DR cash/bank · CR AR control** (G-05 receipt posting); allocation to the installment
   lines.
5. **Late fee رسوم التأخير** — overdue lines accrue the per-plan policy charge after grace:
   **DR AR control · CR `LATE_FEE_INCOME`** (G-28, only via the engine; BR-049). Waivers are
   explicit credit lines (never silent edits).
6. **Aging** — `installments.aging` + `installments.schedule` drive the dunning cycle.

Numbered steps: installment chain per
[../../product/BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §12 and §8-style
recurring billing (v2.0, [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §M);
compact flow [../workflows/industry-workflows.md](../workflows/industry-workflows.md) §j.

## Inventory behavior defaults

| Setting | Default | Notes |
|---|---|---|
| Stock modules | Not enabled | Inventory/purchasing absent from `default_modules_enabled` |
| Costing method | WAC (dormant) | Applies only if the tenant later enables stock (uniform shop, supplies) |
| All tracking flags | Off | |
| Service items | Default item type | Fee items; rate tables via price lists |

## Document types emphasized

| Document | Arabic | Numbering default | Policy |
|---|---|---|---|
| Enrollment contract | عقد الالتحاق | `CT-` (contract register) | No ledger effect; schedule source |
| Tuition invoice | فاتورة الرسوم الدراسية | `INV-{yyyy}-{seq:6}` | Approval required before posting |
| Installment plan | خطة الأقساط | — (plan register) | BR-048 total lock; immutable schedule |
| Receipt | سند القبض | `RCP-{yyyy}-{seq:6}` | Allocates to installment lines |
| Credit note (waiver/refund) | إشعار دائن | `CN-{yyyy}-{seq:5}` | Late-fee waivers are explicit documents |

## Reports emphasized

`installments.schedule` (dashboard), `installments.aging` (dashboard),
`services.contract_revenue_schedule`, `ar.aging` — see
[../reports/README.md](../reports/README.md). `installments.*` reports register at
PHASE-027 ([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §J). The
`ar.aging` pin is the live registry key (the 0025 automotive reconciliation
precedent — `partners.ar_aging` was the pre-013 planning id).

## Out of scope for this template (ED-08, ED-11 — commercial shell only)

- **Academic scheduling** (timetables, teacher allocation, room planning).
- **Grades, attendance, and LMS** (report cards, coursework, parent portals for academics).
- **Transport and canteen operational logistics** (bus routes/tracking, meal planning) —
  these are *billable* as fee/service items, but their operations are not managed.

Deep-vertical operations remain non-goals until a future decision record adds them (ED-11;
[../../decisions/product/DR-003-platform-expansion-v2.md](../../decisions/product/DR-003-platform-expansion-v2.md)).

## Known limitations

- The student is a partner financial file with attributes only — class/section is a label,
  not a scheduling object; cohort reporting is via partner attributes and cost centers.
- Late-fee defaults (rate, cap, grace) are per-plan PLACEHOLDER policies (BR-049, OQ-002
  family) — the template ships no invented rates; tenants configure them.
- Templates never grant features (plans do) and never change accounting (INV-022); until
  PHASE-027 ships `installments.*` platform-wide, tuition is billed as ordinary invoices
  with manual due tracking.
