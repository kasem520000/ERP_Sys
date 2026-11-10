# Template: Automotive & Workshop — `automotive_workshop`

> **Status:** STABLE · **Owner:** Industry Solutions Architecture · **Updated:** 2026-10-27`

Parts counter + repair workshop on one core: every vehicle is a customer asset, every repair
is a **job card بطاقة عمل** combining parts and labor. Ships in PHASE-017
([../../planning/MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md)). Manifest schema:
[../README.md](../README.md) §3. Full job-card workflow with accounting effects:
[../workflows/industry-workflows.md](../workflows/industry-workflows.md) (b).

## Target businesses

- Tire shops (sales + fitting services).
- Spare-parts stores (with or without fitting).
- General repair workshops (mechanical, electrical, A/C, oil change).
- Mobile-phone & electronics repair counters (same job-card pattern, different vocabulary).

## Manifest

```json
{
  "id": "industry.automotive",
  "name": "Automotive & Workshop",
  "name_ar": "قطع الغيار والورش",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine", "items.barcodes", "items.price_lists",
    "inventory.multi_warehouse", "inventory.serial_tracking", "inventory.reservations",
    "sales.quotations", "sales.job_cards", "sales.reps", "treasury.cashier_shifts"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "configuration"],
  "terminology_overrides": {
    "svc.job_card": { "en": "Job card", "ar": "بطاقة عمل" },
    "fleet.vehicle": { "en": "Vehicle", "ar": "المركبة" },
    "svc.labor": { "en": "Labor", "ar": "أجور العمل" },
    "vehicle.make": { "en": "Make", "ar": "الصانع" },
    "vehicle.model": { "en": "Model", "ar": "الطراز" },
    "vehicle.chassis_no": { "en": "Chassis number (VIN)", "ar": "رقم الهيكل" },
    "vehicle.odometer": { "en": "Odometer", "ar": "عداد المسافة" },
    "svc.diagnosis": { "en": "Diagnosis", "ar": "الفحص والتشخيص" },
    "svc.technician": { "en": "Technician", "ar": "الفني" },
    "svc.service_history": { "en": "Service history", "ar": "سجل الصيانة" },
    "part.warranty": { "en": "Parts warranty", "ar": "ضمان قطع الغيار" }
  },
  "navigation_manifest": { "groups": [
    { "id": "workshop", "label": { "en": "Workshop", "ar": "الورشة" }, "order": 1, "items": [
      { "id": "job_cards", "label": { "en": "Job cards", "ar": "بطاقات العمل" }, "target": "sales.job_cards" },
      { "id": "vehicles", "label": { "en": "Vehicles", "ar": "المركبات" }, "target": "partners.vehicles" },
      { "id": "quotes", "label": { "en": "Diagnosis quotes", "ar": "عروض التشخيص" }, "target": "sales.quotations" }
    ]},
    { "id": "parts", "label": { "en": "Parts", "ar": "قطع الغيار" }, "order": 2, "items": [
      { "id": "parts_stock", "label": { "en": "Parts stock", "ar": "مخزون القطع" }, "target": "inventory.on_hand" },
      { "id": "purchasing", "label": { "en": "Parts purchasing", "ar": "شراء القطع" }, "target": "purchasing.orders" },
      { "id": "counter", "label": { "en": "Counter sale", "ar": "بيع الكاونتر" }, "target": "pos.counter", "feature_key": "pos.sales" }
    ]}
  ]},
  "workflow_policies": {
    "job_card_parts_issue_mode": "reserve",
    "job_card_labor_rate_source": "price_list",
    "quotation_validity_days": 7,
    "invoice_approval_required_over": 0,
    "warranty_credit_note_requires_original_invoice": true,
    "shift_variance_approval_required": true
  },
  "document_numbering_defaults": {
    "job_card": { "prefix": "JC", "format": "JC-{yyyy}-{seq:5}", "per_branch": true, "reserve_on_approval": false },
    "quotation": { "prefix": "QT", "format": "QT-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "credit_note": { "prefix": "CN", "format": "CN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "purchase_order": { "prefix": "PO", "format": "PO-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": true }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC", "default_track_batch": false, "default_track_expiry": false,
    "default_track_serial": false, "default_imei_tracking": false, "fefo_picking": false,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "automotive.job_card_profitability", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "automotive.vehicle_service_history", "pinned": true, "dashboard": false, "default_period": "custom" },
    { "report_key": "inventory.valuation", "pinned": true, "dashboard": false, "default_period": "custom" },
    { "report_key": "ar.aging", "pinned": true, "dashboard": false, "default_period": "this_month" }
  ],
  "onboarding_steps": [
    { "id": "branch_bays", "title": { "en": "Branch, workshop & bays", "ar": "الفرع والورشة والمواقف" }, "required": true },
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts (parts vs labor revenue)", "ar": "تأكيد دليل الحسابات (إيراد القطع مقابل أجور العمل)" }, "required": true },
    { "id": "labor_rates", "title": { "en": "Labor rate price lists", "ar": "قوائم أسعار أجور العمل" }, "required": true },
    { "id": "parts_catalog", "title": { "en": "Parts catalog & suppliers", "ar": "كتالوج القطع والموردون" }, "required": true },
    { "id": "opening_stock", "title": { "en": "Opening parts stock", "ar": "رصيد القطع الافتتاحي" }, "required": true },
    { "id": "vehicles", "title": { "en": "Import customer vehicles", "ar": "استيراد مركبات العملاء" }, "required": false },
    { "id": "first_job", "title": { "en": "Run a first job card end-to-end", "ar": "تنفيذ أول بطاقة عمل كاملة" }, "required": false }
  ],
  "capability_prerequisites": {
    "job_cards": { "level": "REQUIRED", "feature_keys": ["sales.job_cards"], "available_from_phase": "PHASE-017" },
    "commissions": { "level": "OPTIONAL", "feature_keys": ["sales.commissions"], "available_from_phase": "PHASE-017" },
    "barcode_pos": { "level": "OPTIONAL", "feature_keys": ["pos.terminals", "pos.sales", "pos.receipts"], "available_from_phase": "PHASE-016" },
    "service_contracts": { "level": "OPTIONAL", "feature_keys": ["crm.service_contracts"], "available_from_phase": "PHASE-019" },
    "landed_costs": { "level": "OPTIONAL", "feature_keys": ["purchasing.landed_costs"], "available_from_phase": "PHASE-011" },
    "qc_inspections": { "level": "OPTIONAL", "feature_keys": ["manufacturing.qc"], "available_from_phase": "PHASE-018" }
  }
}
```

## Enabled features (exact keys)

| Feature key | Required? | Phase | Note |
|---|---|---|---|
| `sales.job_cards` | Required | PHASE-017 | The workshop document: labor lines + parts lines |
| `inventory.reservations` | Required | PHASE-017 | Parts reserved against approved job cards |
| `inventory.serial_tracking` | Required | PHASE-010 | Per-part serial capture where flagged |
| `sales.quotations`, `sales.reps` | Required | PHASE-012 | Diagnosis quote → approval |
| `pos.sales` (counter mode) | Optional | PHASE-016 | Over-the-counter parts selling |
| `sales.commissions` | Optional | PHASE-017 | Technician/service-advisor incentives |
| `crm.service_contracts` | Optional | PHASE-019 | Prepaid service/maintenance plans |
| `purchasing.landed_costs` | Optional | PHASE-011 | Imported parts cost truth |

## Terminology overrides (sample)

| Term key | English | العربية | Note |
|---|---|---|---|
| `svc.job_card` | Job card | بطاقة عمل | One repair engagement |
| `fleet.vehicle` | Vehicle | المركبة | Customer asset record |
| `svc.labor` | Labor | أجور العمل | Billed service lines (non-stock) |
| `vehicle.chassis_no` | Chassis number (VIN) | رقم الهيكل | Vehicle identity |
| `vehicle.odometer` | Odometer | عداد المسافة | Captured at check-in/out |
| `svc.diagnosis` | Diagnosis | الفحص والتشخيص | Pre-quote inspection |
| `svc.technician` | Technician | الفني | Assigned user on the card |
| `svc.service_history` | Service history | سجل الصيانة | Per-vehicle timeline |
| `part.warranty` | Warranty | الضمان | Warranty credit notes reference original invoice |

## Default navigation (sample)

| EN | AR | Target |
|----|----|--------|
| Job cards | بطاقات العمل | `sales.job_cards` |
| Vehicles | المركبات | `partners.vehicles` |
| Diagnosis quotes | عروض التشخيص | `sales.quotations` |
| Parts stock | مخزون القطع | `inventory.on_hand` |
| Counter sale | بيع الكاونتر | `pos.counter` |
| Job-card profitability | ربحية بطاقات العمل | `automotive.job_card_profitability` |

## Signature workflow — job card (compact)

```mermaid
flowchart TD
    V["Check-in: vehicle + odometer + complaints"] --> JC["Job card DRAFT"]
    JC --> D["Diagnosis: labor lines + required parts"]
    D --> Q["Quotation generated from card"]
    Q --> AP{"Customer approves?"}
    AP -- "No" --> CJ["CANCELLED — audited, no ledger"]
    AP -- "Yes" --> W["IN_PROGRESS: reserve/issue parts, log labor hours"]
    W --> IV["Invoice: parts + labor + VAT"]
    IV --> J1["DR AR/Cash · CR Parts revenue · CR Labor revenue · CR VAT"]
    IV --> J2["DR COGS · CR Inventory for issued parts"]
    W --> PAY["Receipt / credit terms"]
```

Numbered steps, both parts-issue policies, and per-step journals:
[../workflows/industry-workflows.md](../workflows/industry-workflows.md) §b.

## Inventory behavior defaults

| Setting | Default | Notes |
|---|---|---|
| Costing method | WAC | FIFO permissible; per-item lock after transactions |
| Batch/expiry | Off | Tires with date codes may enable batch per category |
| Serial tracking | Per-category opt-in | Batteries, high-value units |
| Reservation on approval | On | Approved job cards hold parts until issue |
| Parts issue mode | `reserve` (COGS at invoice) | Switchable to `issue_immediate` (COGS at issue) per policy |
| Negative stock | Forbidden | |

## Document types emphasized

| Document | Arabic | Numbering default | Policy |
|---|---|---|---|
| Job card | بطاقة عمل | `JC-{yyyy}-{seq:5}` | DRAFT→IN_PROGRESS→COMPLETED→INVOICED |
| Quotation (diagnosis) | عرض التشخيص | `QT-{yyyy}-{seq:5}` | 7-day validity default |
| Sales invoice (parts + labor) | فاتورة البيع | `INV-{yyyy}-{seq:6}` | Two revenue natures: parts vs labor |
| Warranty credit note | إشعار دائن (ضمان) | `CN-{yyyy}-{seq:5}` | Must reference original invoice |
| Purchase order (parts) | أمر الشراء | `PO-{yyyy}-{seq:5}` | Number reserved at approval |

## Reports emphasized

`automotive.job_card_profitability` (dashboard), `automotive.vehicle_service_history`,
`inventory.valuation` (slow-moving parts), `ar.aging`,
`sales.commissions_due` — see [../reports/README.md](../reports/README.md).

## Out of scope for this template

- Vehicle telematics / GPS tracking integration.
- Diagnostic-scan-tool (OBD) integration.
- Technician payroll — platform non-goal; commissions only
  ([../../SCOPE_AND_NON_GOALS.md](../../SCOPE_AND_NON_GOALS.md)).
- Parts-catalog fitment databases (which part fits which model) beyond item attributes.

## Known limitations

- **Actual labor cost is not tracked** (no payroll module): job-card profitability = parts
  margin + labor revenue; technician-hours are recorded for scheduling/billing, not costed.
- Vehicle registry holds structured vehicle attributes; fitment matching is manual.
- Multi-visit job cards (vehicle left for days) are supported via the IN_PROGRESS state,
  but bay/technician scheduling is not a planning engine — assignments are manual.
