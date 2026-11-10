# Template: Mobile & Electronics — `electronics`

> **Status:** STABLE · **Owner:** Industry Solutions Architecture · **Updated:** 2026-10-28

Retail counter + service bench on one core: every phone is an **IMEI سجل الأجهزة**, every
repair is a **repair card بطاقة صيانة** consuming parts and labor, and trade-ins are ordinary
purchases of used devices. Ships in PHASE-030
([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B; ED-06). Manifest schema:
[../README.md](../README.md) §3. Signature flow summary:
[../workflows/industry-workflows.md](../workflows/industry-workflows.md) §h.

## Target businesses

- Mobile-phone shops (per-device IMEI register, trade-ins, SIM/accessories).
- Electronics and appliance retailers (serial-tracked high-value units).
- Accessories + repair combos (screen/battery swaps, software service).
- Consumer-electronics chains with a repair back room.

## Manifest

```json
{
  "id": "industry.electronics",
  "name": "Mobile & Electronics",
  "name_ar": "الجوالات والإلكترونيات",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine", "items.barcodes", "items.price_lists",
    "inventory.serial_tracking", "pos.terminals", "pos.sales", "pos.offline_queue",
    "pos.receipts", "crm.service_orders", "sales.invoices", "treasury.cashier_shifts"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "pos", "crm", "configuration"],
  "terminology_overrides": {
    "pos.sale": { "en": "Retail sale", "ar": "بيع بالتجزئة" },
    "svc.repair_card": { "en": "Repair card", "ar": "بطاقة صيانة" },
    "svc.repair": { "en": "Repair", "ar": "الصيانة / الإصلاح" },
    "item.imei": { "en": "IMEI", "ar": "الرقم التسلسلي (IMEI)" },
    "device.checkin": { "en": "Device check-in", "ar": "استلام الجهاز" },
    "tradein.purchase": { "en": "Trade-in purchase", "ar": "شراء جهاز مستعمل" },
    "part.accessory": { "en": "Accessory", "ar": "ملحق" },
    "part.spare": { "en": "Spare part", "ar": "قطعة غيار" },
    "svc.warranty": { "en": "Warranty claim", "ar": "بطارية الضمان / مطالبة الضمان" },
    "svc.labor": { "en": "Labor", "ar": "أجور الصيانة" }
  },
  "navigation_manifest": { "groups": [
    { "id": "counter", "label": { "en": "Counter", "ar": "الكاونتر" }, "order": 1, "items": [
      { "id": "pos", "label": { "en": "Point of sale", "ar": "نقطة البيع" }, "target": "pos.counter", "feature_key": "pos.sales" },
      { "id": "imei", "label": { "en": "IMEI register", "ar": "سجل الأجهزة" }, "target": "inventory.imei", "feature_key": "inventory.serial_tracking" },
      { "id": "tradein", "label": { "en": "Trade-in purchases", "ar": "شراء الأجهزة المستعملة" }, "target": "purchasing.tradein" }
    ]},
    { "id": "service", "label": { "en": "Repair", "ar": "الصيانة" }, "order": 2, "items": [
      { "id": "repair_cards", "label": { "en": "Repair cards", "ar": "بطاقات الصيانة" }, "target": "crm.service_orders", "feature_key": "crm.service_orders" },
      { "id": "returns", "label": { "en": "Returns & exchanges", "ar": "المرتجعات والاستبدال" }, "target": "sales.credit_notes" },
      { "id": "receipts", "label": { "en": "Receipts", "ar": "سندات القبض" }, "target": "treasury.receipts" }
    ]}
  ]},
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
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "pos_sale": { "prefix": "POS", "format": "POS-{branch}-{yy}{MM}-{seq:5}", "per_branch": true, "reserve_on_approval": false },
    "job_card": { "prefix": "RC", "format": "RC-{yyyy}-{seq:5}", "per_branch": true, "reserve_on_approval": false },
    "credit_note": { "prefix": "CN", "format": "CN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "goods_receipt": { "prefix": "GRN", "format": "GRN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC", "default_track_batch": false, "default_track_expiry": false,
    "default_track_serial": true, "default_imei_tracking": true, "fefo_picking": false,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "retail.imei_register", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "pos.sales_by_terminal", "pinned": true, "dashboard": true, "default_period": "today" },
    { "report_key": "pos.sales_by_hour", "pinned": true, "dashboard": false, "default_period": "this_week" },
    { "report_key": "inventory.valuation", "pinned": true, "dashboard": false, "default_period": "custom" }
  ],
  "onboarding_steps": [
    { "id": "counter_branch", "title": { "en": "Create branch, stockroom & terminals", "ar": "إنشاء الفرع والمستودع وأجهزة نقطة البيع" }, "required": true },
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts (device vs service vs used-goods)", "ar": "تأكيد دليل الحسابات (الأجهزة، الصيانة، الأجهزة المستعملة)" }, "required": true },
    { "id": "imei_categories", "title": { "en": "Item categories with IMEI flags", "ar": "تصنيفات الأصناف مع خيار تسجيل IMEI" }, "required": true },
    { "id": "labor_rates", "title": { "en": "Repair labor rate lists", "ar": "قوائم أسعار أجور الصيانة" }, "required": true },
    { "id": "opening_stock", "title": { "en": "Opening stock with IMEI capture", "ar": "المخزون الافتتاحي مع تسجيل الأجهزة" }, "required": true },
    { "id": "first_repair", "title": { "en": "Run a first repair card end-to-end", "ar": "تنفيذ أول بطاقة صيانة كاملة" }, "required": false, "feature_key": "crm.service_orders" },
    { "id": "first_shift", "title": { "en": "Open first shift and sell", "ar": "افتتاح أول وردية وإجراء أول عملية بيع" }, "required": false, "feature_key": "pos.sales" }
  ],
  "capability_prerequisites": {
    "imei_tracking": { "level": "REQUIRED", "feature_keys": ["inventory.serial_tracking"], "available_from_phase": "PHASE-010" },
    "job_cards": { "level": "REQUIRED", "feature_keys": ["crm.service_orders"], "available_from_phase": "PHASE-019" },
    "barcode_pos": { "level": "REQUIRED", "feature_keys": ["pos.terminals", "pos.sales", "pos.offline_queue", "pos.receipts"], "available_from_phase": "PHASE-016" },
    "cashier_shifts": { "level": "REQUIRED", "feature_keys": ["treasury.cashier_shifts"], "available_from_phase": "PHASE-016" },
    "composite_kits": { "level": "OPTIONAL", "feature_keys": ["items.composite_products"], "available_from_phase": "PHASE-016" },
    "customer_price_tiers": { "level": "OPTIONAL", "feature_keys": ["distribution.customer_tiers"], "available_from_phase": "PHASE-017" },
    "free_goods_promo": { "level": "OPTIONAL", "feature_keys": ["sales.discount_management", "distribution.free_goods"], "available_from_phase": "PHASE-017" },
    "commissions": { "level": "OPTIONAL", "feature_keys": ["sales.commissions"], "available_from_phase": "PHASE-017" },
    "landed_costs": { "level": "OPTIONAL", "feature_keys": ["purchasing.landed_costs"], "available_from_phase": "PHASE-011" },
    "service_contracts": { "level": "OPTIONAL", "feature_keys": ["crm.service_contracts"], "available_from_phase": "PHASE-019" },
    "pdc_notes": { "level": "OPTIONAL", "feature_keys": ["notes.received"], "available_from_phase": "PHASE-027" },
    "installment_terms": { "level": "OPTIONAL", "feature_keys": ["installments.plans"], "available_from_phase": "PHASE-027" }
  }
}
```

## Enabled features (exact keys)

| Feature key | Required? | Phase | Note |
|---|---|---|---|
| `inventory.serial_tracking` | Required | PHASE-010 | IMEI-level register: capture at GRN and sale; sale of an unregistered IMEI blocked |
| `crm.service_orders` | Required | PHASE-019 | Repair cards: labor lines + parts lines → invoice |
| `pos.terminals`, `pos.sales`, `pos.offline_queue`, `pos.receipts` | Required | PHASE-016 | Counter selling with offline queue (`OFF-…` numbers) |
| `treasury.cashier_shifts` | Required | PHASE-016 | Shift open/float/close/variance |
| `sales.invoices` | Required | PHASE-012 | Credit/corporate invoices over the counter flow |
| `items.composite_products` | Optional | PHASE-016 | Bundles (device + case + protector sold as one line) |
| `sales.discount_management`, `distribution.free_goods` | Optional | PHASE-012/017 | Accessories promotions (buy phone, get cover) |
| `sales.commissions` | Optional | PHASE-017 | Sales-staff incentives |
| `purchasing.landed_costs` | Optional | PHASE-011 | Imported devices' true cost |
| `crm.service_contracts` | Optional | PHASE-019 | Extended-warranty / prepaid maintenance plans |
| `notes.received`, `installments.plans` | Optional | PHASE-027 | Corporate customers' PDC and in-house installments (ED-03 flat-fee model) |

## Terminology overrides (sample)

| Term key | English | العربية | Note |
|---|---|---|---|
| `pos.sale` | Retail sale | بيع بالتجزئة | Counter POS sale |
| `svc.repair_card` | Repair card | بطاقة صيانة | One repair engagement (service order) |
| `svc.repair` | Repair | الصيانة / الإصلاح | Service nature label |
| `item.imei` | IMEI | الرقم التسلسلي (IMEI) | Device identity per unit |
| `device.checkin` | Device check-in | استلام الجهاز | Captures device + IMEI + fault notes |
| `tradein.purchase` | Trade-in purchase | شراء جهاز مستعمل | Used-device purchase at branch |
| `svc.warranty` | Warranty claim | مطالبة الضمان | Tracked via repair card against original invoice |
| `svc.labor` | Labor | أجور الصيانة | Non-stock service lines |

## Default navigation (sample)

| EN | AR | Target |
|----|----|--------|
| Point of sale | نقطة البيع | `pos.counter` |
| IMEI register | سجل الأجهزة | `inventory.imei` |
| Repair cards | بطاقات الصيانة | `crm.service_orders` |
| Trade-in purchases | شراء الأجهزة المستعملة | `purchasing.tradein` |
| Returns & exchanges | المرتجعات والاستبدال | `sales.credit_notes` |
| Shifts | الورديات | `treasury.shifts` |

## Signature workflow — repair job card

1. **Check-in استلام الجهاز** — customer + device record (model, IMEI, fault notes);
   repair card DRAFT (a `crm.service_orders` service order). *No ledger effect.*
2. **Diagnosis & quote** — labor lines from the repair rate list + required parts lines;
   quotation generated. *No ledger effect.*
3. **Approval → IN_PROGRESS** — parts **reserved** against the card (default policy). *No
   ledger effect under `reserve`.*
4. **Execution** — technician issues parts and logs labor hours; warranty claims reference
   the original invoice.
5. **Invoice** — parts + labor in one invoice:
   - **DR AR/cash · CR parts revenue · CR service revenue · CR VAT** (G-01/G-02 revenue shape)
   - **DR COGS · CR inventory** for the issued parts (G-03).
6. **Warranty/return path** — credit note referencing the original invoice mirrors
   revenue/VAT; returned parts re-enter stock at **original cost**.

This is the automotive job-card flow
([../workflows/industry-workflows.md](../workflows/industry-workflows.md) §b; a variant of
[../../product/BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §2 with service
lines) with a service-order document; counter path follows Journey B
([../../product/USER_JOURNEYS.md](../../product/USER_JOURNEYS.md)). Trade-in: the branch buys
the used device via a purchase + goods receipt — **DR inventory (used-goods item) · CR
cash/AP** (G-07/G-08 shape) — and resells it as a serial-tracked used item.

## Inventory behavior defaults

| Setting | Default | Notes |
|---|---|---|
| Costing method | WAC | Used-goods categories carry their own WAC |
| Serial tracking | On | Per-device identity |
| IMEI tracking | On | Phone/device categories force IMEI capture at GRN and sale |
| Batch/expiry | Off | |
| Trade-in intake | GRN at branch | Used device = new serial item with condition grade attribute |
| Negative stock | Forbidden | |

## Document types emphasized

| Document | Arabic | Numbering default | Policy |
|---|---|---|---|
| POS sale | بيع نقطة البيع | `POS-{branch}-{yy}{MM}-{seq:5}` | Auto-post on payment |
| Repair card | بطاقة صيانة | `RC-{yyyy}-{seq:5}` | DRAFT→IN_PROGRESS→COMPLETED→INVOICED |
| Sales invoice (parts + labor) | فاتورة البيع | `INV-{yyyy}-{seq:6}` | Two revenue natures: goods vs service |
| Warranty credit note | إشعار دائن (ضمان) | `CN-{yyyy}-{seq:5}` | Must reference original invoice |
| Trade-in goods receipt | سند استلام جهاز مستعمل | `GRN-{yyyy}-{seq:5}` | Serial capture; condition grade |

## Reports emphasized

`retail.imei_register` (dashboard), `pos.sales_by_terminal`, `pos.sales_by_hour`,
`inventory.valuation` — see [../reports/README.md](../reports/README.md); the valuation pin
uses the LIVE registry key (`inventory.valuation` — the 0025/0027 reconciliation convention
for the `inventory.stock_valuation` doc spelling).

## Out of scope for this template

- **Telecom carrier integration** (SIM activation, airtime commissions, carrier billing) —
  external adapters only (PHASE-023).
- **Installment financing via third parties** (bank BNPL, carrier installments) — only the
  platform's own flat-fee installment plans exist (ED-03; `installments.*`, PHASE-027).
- Refurbishment production lines (batch repair pipelines) — compose
  `industry.food_manufacturing`-style `bom_production` if genuinely needed.
- Device diagnostics-tool (flasher/OS) integration.

## Known limitations

- Actual technician labor cost is not tracked (no payroll at GA; PHASE-029 adds financial
  payroll) — repair-card profitability = parts margin + labor revenue, as documented for
  job cards ([../capabilities/CAPABILITY_MATRIX.md](../capabilities/CAPABILITY_MATRIX.md) §2.6).
- Until PHASE-019 ships `crm.service_orders`, repair intake runs on back-office invoices;
  the template's repair entries are phase-gated "coming with PHASE-019".
- Templates never grant features (plans do) and never change accounting (INV-022).
