# Template: Healthcare (Commercial Shell) — `healthcare`

> **Status:** SHIPPED (PHASE-031, migration 0043 — the registry seed is canonical) · **Owner:** Industry Solutions Architecture · **Updated:** 2026-11-08

The **commercial back office** for medical businesses: the patient is a *financial file
only* (no clinical data — ED-07), insurers are partners with **per-claim open items
مطالبات تأمينية**, the pharmacy is a FEFO batch store, and claims are settled by cheque or
**post-dated note شيك مؤجل** through the `notes` module. Ships in PHASE-031
([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B; ED-07). Manifest schema:
[../README.md](../README.md) §3. Signature flow summary:
[../workflows/industry-workflows.md](../workflows/industry-workflows.md) §i.

## Target businesses

- Clinics and polyclinics (patient billing + insurance claims).
- Medical centers and small hospitals' **commercial back office** (billing, pharmacy,
  receivables — never clinical).
- Pharmacies (batch/expiry stock, POS counter).
- Diagnostic labs and imaging centers (financial side only).

## Manifest

```json
{
  "id": "industry.healthcare",
  "name": "Healthcare (Commercial Shell)",
  "name_ar": "الرعاية الصحية — الغلاف التجاري",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine", "partners.directory", "partners.statements",
    "sales.invoices", "sales.credit_limits", "notes.received",
    "inventory.batch_tracking", "crm.service_orders"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "crm", "notes", "configuration"],
  "terminology_overrides": {
    "partner.patient": { "en": "Patient (financial file)", "ar": "المريض (الملف المالي)" },
    "partner.insurer": { "en": "Insurance company", "ar": "شركة التأمين" },
    "claim.ref": { "en": "Insurance claim", "ar": "مطالبة تأمينية" },
    "pharmacy.store": { "en": "Pharmacy", "ar": "صيدلية" },
    "svc.visit": { "en": "Visit", "ar": "الزيارة" },
    "doc.services_invoice": { "en": "Medical services invoice", "ar": "فاتورة الخدمات الطبية" },
    "billing.self_pay": { "en": "Self-pay", "ar": "دفع مباشر" },
    "notes.pdc": { "en": "Post-dated note", "ar": "شيك مؤجل" },
    "billing.collection": { "en": "Collection", "ar": "التحصيل" }
  },
  "navigation_manifest": { "groups": [
    { "id": "billing", "label": { "en": "Billing", "ar": "الفوترة" }, "order": 1, "items": [
      { "id": "visits", "label": { "en": "Visits & service orders", "ar": "الزيارات وأوامر الخدمة" }, "target": "crm.service_orders", "feature_key": "crm.service_orders" },
      { "id": "invoices", "label": { "en": "Invoices (patient / insurance)", "ar": "الفواتير (مريض / تأمين)" }, "target": "sales.invoices" },
      { "id": "claims", "label": { "en": "Claims by insurer", "ar": "المطالبات حسب الشركة" }, "target": "partners.statements" }
    ]},
    { "id": "pharmacy", "label": { "en": "Pharmacy", "ar": "الصيدلية" }, "order": 2, "items": [
      { "id": "expiry", "label": { "en": "Expiry control", "ar": "الرقابة على الصلاحية" }, "target": "inventory.expiry_list", "feature_key": "inventory.batch_tracking" },
      { "id": "counter", "label": { "en": "Pharmacy counter", "ar": "كاونتر الصيدلية" }, "target": "pos.counter", "feature_key": "pos.sales" },
      { "id": "pdc", "label": { "en": "Claims cheques", "ar": "شيكات المطالبات" }, "target": "notes.received", "feature_key": "notes.received" }
    ]}
  ]},
  "workflow_policies": {
    "patient_file_financial_only": true,
    "claim_ref_required_for_insured_invoices": true,
    "insurance_invoice_billed_to_company_partner": true,
    "pharmacy_fefo_enforced": true,
    "dunning_by_claim_enabled": true,
    "insurance_credit_limit_per_company": true
  },
  "document_numbering_defaults": {
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "credit_note": { "prefix": "CN", "format": "CN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "receipt": { "prefix": "RCP", "format": "RCP-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "goods_receipt": { "prefix": "GRN", "format": "GRN-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC", "default_track_batch": true, "default_track_expiry": true,
    "default_track_serial": false, "default_imei_tracking": false, "fefo_picking": true,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "notes.aging", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "notes.maturity-calendar", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "ar.aging", "pinned": true, "dashboard": false, "default_period": "this_month" },
    { "report_key": "inventory.expiry_list", "pinned": true, "dashboard": false, "default_period": "this_week" }
  ],
  "onboarding_steps": [
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts (services, pharmacy, notes receivable)", "ar": "تأكيد دليل الحسابات (الخدمات، الصيدلية، أوراق القبض)" }, "required": true },
    { "id": "payers", "title": { "en": "Insurers with credit limits & contracted fee schedules", "ar": "شركات التأمين مع سقوف الائتمان وأسعار التعاقد" }, "required": true },
    { "id": "patients", "title": { "en": "Patient financial files (no clinical data)", "ar": "الملفات المالية للمرضى (بيانات مالية فقط)" }, "required": true },
    { "id": "pharmacy_items", "title": { "en": "Pharmacy items with batches & expiry", "ar": "أصناف الصيدلية مع الدفعات والصلاحية" }, "required": true },
    { "id": "service_items", "title": { "en": "Service items (consultation, procedure fees)", "ar": "بنود الخدمات (الاستشارات، الرسوم الطبية)" }, "required": true },
    { "id": "first_visit", "title": { "en": "Bill a first visit (self-pay and insurance)", "ar": "فوترة أول زيارة (دفع مباشر وتأمين)" }, "required": false },
    { "id": "first_claim", "title": { "en": "Register a first claim cheque", "ar": "تسجيل أول شيك مطالبة" }, "required": false, "feature_key": "notes.received" }
  ],
  "capability_prerequisites": {
    "insurance_claim_billing": { "level": "REQUIRED", "feature_keys": ["sales.invoices", "notes.received", "partners.statements"], "available_from_phase": "PHASE-031" },
    "pdc_notes": { "level": "REQUIRED", "feature_keys": ["notes.received", "notes.pdc_calendar"], "available_from_phase": "PHASE-027" },
    "expiry_tracking_fefo": { "level": "REQUIRED", "feature_keys": ["inventory.batch_tracking"], "available_from_phase": "PHASE-010" },
    "job_cards": { "level": "REQUIRED", "feature_keys": ["crm.service_orders"], "available_from_phase": "PHASE-019" },
    "barcode_pos": { "level": "OPTIONAL", "feature_keys": ["pos.terminals", "pos.sales", "pos.receipts"], "available_from_phase": "PHASE-016" },
    "cashier_shifts": { "level": "OPTIONAL", "feature_keys": ["treasury.cashier_shifts"], "available_from_phase": "PHASE-016" },
    "customer_price_tiers": { "level": "OPTIONAL", "feature_keys": ["items.price_lists", "distribution.customer_tiers"], "available_from_phase": "PHASE-017" },
    "service_contracts": { "level": "OPTIONAL", "feature_keys": ["crm.service_contracts"], "available_from_phase": "PHASE-019" },
    "installment_terms": { "level": "OPTIONAL", "feature_keys": ["installments.plans"], "available_from_phase": "PHASE-027" }
  }
}
```

## Enabled features (exact keys)

| Feature key | Required? | Phase | Note |
|---|---|---|---|
| `partners.directory`, `partners.statements` | Required | PHASE-006 | Patient financial files + insurer files + statements |
| `sales.invoices`, `sales.credit_limits` | Required | PHASE-012 | Visit billing; per-insurer exposure caps |
| `crm.service_orders` | Required | PHASE-019 | Visit billing work order (services + dispensed items) |
| `inventory.batch_tracking` | Required | PHASE-010 | Pharmacy batches with expiry + FEFO picking |
| `notes.received` | Required | PHASE-027 | Claim cheques/PDC into custody → maturity calendar |
| `pos.terminals`, `pos.sales`, `pos.receipts` | Optional | PHASE-016 | Pharmacy counter |
| `treasury.cashier_shifts` | Optional | PHASE-016 | Front-desk/pharmacy cash discipline |
| `items.price_lists` + `distribution.customer_tiers` | Optional | PHASE-006/017 | Payer fee schedules (insured vs private rates) |
| `crm.service_contracts` | Optional | PHASE-019 | Corporate care packages |
| `installments.plans` | Optional | PHASE-027 | Patient payment plans |

## Terminology overrides (sample)

| Term key | English | العربية | Note |
|---|---|---|---|
| `partner.patient` | Patient (financial file) | المريض (الملف المالي) | Partner record; **no clinical data** (ED-07) |
| `partner.insurer` | Insurance company | شركة التأمين | Claim payer partner |
| `claim.ref` | Insurance claim | مطالبة تأمينية | Reference stamped on invoice + receipt allocation |
| `pharmacy.store` | Pharmacy | صيدلية | Batch/expiry warehouse |
| `svc.visit` | Visit | الزيارة | Service order for billing |
| `billing.self_pay` | Self-pay | دفع مباشر | Patient-billed invoice |
| `notes.pdc` | Post-dated note | شيك مؤجل | Claim settlement instrument |

## Default navigation (sample)

| EN | AR | Target |
|----|----|--------|
| Visits & service orders | الزيارات وأوامر الخدمة | `crm.service_orders` |
| Invoices (patient / insurance) | الفواتير (مريض / تأمين) | `sales.invoices` |
| Claims by insurer | المطالبات حسب الشركة | `partners.statements` |
| Expiry control | الرقابة على الصلاحية | `inventory.expiry_list` |
| Claims cheques | شيكات المطالبات | `notes.received` |

## Signature workflow — visit → invoice → claim → PDC collection

1. **Visit زيارة** — a service order opens for the patient (financial file only): service
   lines (consultation, procedures) and dispensed pharmacy items (FEFO batch). *No ledger
   effect until invoiced.*
2. **Invoice فاتورة الخدمات الطبية** — either self-pay (billed to the patient partner) or
   insured (billed to the insurance-company partner with the **claim reference مطالبة
   تأمينية** stamped on the invoice): **DR AR control · CR services revenue · CR VAT**
   (G-01); dispensed items post **DR COGS · CR pharmacy inventory** (G-03). Per-insurer
   credit limits cap accumulated exposure before save.
3. **Claim open item** — the insurer's partner subledger tracks each claim as its own open
   item (claim ref on invoice); statements reconcile to the AR control (INV-009/012).
4. **Claim cheque received** — insurer pays by cheque/PDC: note into custody —
   **DR `NOTES_RECEIVABLE` · CR `AR_CONTROL`** (G-24), claim reference carried on the note.
5. **Collection at maturity** — deposited and collected: **DR bank · CR `NOTES_RECEIVABLE`**
   (G-25); a dishonored claim cheque restores the claim open item exactly (G-26, BR-046).
6. **Aging by claim** — `notes.aging` + `notes.maturity-calendar` drive dunning per claim,
   not just per insurer.

Credit-chain journals follow
[../../product/BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §2; note
lifecycle §10 (v2.0, [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §M);
compact flow [../workflows/industry-workflows.md](../workflows/industry-workflows.md) §i.

## Inventory behavior defaults

| Setting | Default | Notes |
|---|---|---|
| Costing method | WAC | Pharmacy items |
| Batch + expiry | On | Medicine categories |
| FEFO picking | On | Nearest-expiry batch proposed/forced at dispensing |
| Write-off path | Governed | Expiry write-off behind approval, reason `EXPIRED` |
| Serial tracking | Off | High-value equipment categories may opt in |
| Negative stock | Forbidden | Dispensing cannot exceed on-hand |

## Document types emphasized

| Document | Arabic | Numbering default | Policy |
|---|---|---|---|
| Medical services invoice | فاتورة الخدمات الطبية | `INV-{yyyy}-{seq:6}` | Claim ref required when insured |
| Receipt | سند قبض | `RCP-{yyyy}-{seq:6}` | Allocates to claim open items |
| Credit note (refund) | إشعار دائن | `CN-{yyyy}-{seq:5}` | References original invoice |
| Goods receipt (pharmacy) | سند استلام البضاعة | `GRN-{yyyy}-{seq:6}` | Batch/expiry capture |
| Claim note | شيك مطالبة | — (notes register) | Maturity date; BR-045 |

## Reports emphasized

`notes.aging` (dashboard — by claim), `notes.maturity-calendar` (dashboard),
`ar.aging` (reconciled to the live registry key at the 0043 seed — the doc draft said
`partners.ar_aging`), `inventory.expiry_list` — see [../reports/README.md](../reports/README.md).
`notes.*` reports register at PHASE-027 ([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §J).

## Out of scope for this template (ED-07, ED-11 — commercial shell only)

- **Clinical records / HIS** (diagnoses, prescriptions, clinical notes, patient charts).
- **Appointments and clinical scheduling** (doctor calendars, room planning).
- **Lab results / LIS integration** (result storage, analyzer feeds).
- **Medical staff rostering** (shift planning for clinicians) — payroll is a separate
  platform module with financial scope only (PHASE-029).

Deep-vertical operations remain non-goals until a future decision record adds them
(ED-11; [../../decisions/product/DR-003-platform-expansion-v2.md](../../decisions/product/DR-003-platform-expansion-v2.md)).

## Known limitations

- The claim is a reference (invoice + note + allocation metadata), not a separate claim
  document entity — rejection/appeal cycles beyond credit notes are manual bookkeeping.
- Insurer fee schedules use price lists + tiers; contract-rate versioning is ordinary
  price-list versioning, not a claims-adjudication engine.
- Templates never grant features (plans do) and never change accounting (INV-022); until
  PHASE-027 ships `notes.*` platform-wide, claim cheques are phase-gated "coming with
  PHASE-027" and claims settle via ordinary receipts.
