# Template: Wholesale & Trade — `wholesale`

> **Status:** STABLE · **Owner:** Industry Solutions Architecture · **Updated:** 2026-10-28

B2B trading at its classic shape: **quantity-break price tiers شرائح الكمية**, credit-first
customers with limits and statements, bulk order entry, and receivables settled by cash or
**post-dated cheques شيكات مؤجلة** through the `notes` module. Ships in PHASE-030
([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B; ED-06). Manifest schema:
[../README.md](../README.md) §3. Signature flow summary:
[../workflows/industry-workflows.md](../workflows/industry-workflows.md) §g.

## Target businesses

- Wholesale shops and cash-and-carry operators selling to retailers.
- Importers and B2B trading houses (container-level purchasing, credit reselling).
- Building-material, foodstuff, and consumer-goods traders with counter and delivery trade.
- Any business whose dominant flow is quote → bulk order → delivery → credit invoice →
  statement → collection.

## Manifest

```json
{
  "id": "industry.wholesale",
  "name": "Wholesale & Trade",
  "name_ar": "الجملة والتجارة",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine", "items.barcodes", "items.price_lists",
    "partners.credit_terms", "partners.statements", "sales.quotations",
    "sales.orders", "sales.deliveries", "sales.invoices", "sales.credit_limits",
    "purchasing.goods_receipts", "inventory.multi_warehouse", "notes.received"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "notes", "configuration"],
  "terminology_overrides": {
    "partner.customer": { "en": "Customer (trader)", "ar": "العميل / التاجر" },
    "doc.sales_invoice": { "en": "Wholesale sales invoice", "ar": "فاتورة بيع جملة" },
    "doc.quotation": { "en": "Trade quote", "ar": "عرض السعر" },
    "doc.sales_order": { "en": "Bulk order", "ar": "أمر التوريد" },
    "billing.receipt_voucher": { "en": "Receipt voucher", "ar": "سند قبض" },
    "price.qty_break": { "en": "Quantity break", "ar": "شريحة الكمية" },
    "price.min_qty": { "en": "Min. quantity", "ar": "الحد الأدنى للكمية" },
    "price.customer_tier": { "en": "Customer price tier", "ar": "فئة سعر العميل" },
    "credit.limit": { "en": "Credit limit", "ar": "سقف الائتمان" },
    "credit.terms": { "en": "Credit terms", "ar": "شروط الدفع" },
    "notes.pdc": { "en": "Post-dated note", "ar": "شيك مؤجل" },
    "billing.statement": { "en": "Customer statement", "ar": "كشف حساب العميل" }
  },
  "navigation_manifest": { "groups": [
    { "id": "trading", "label": { "en": "Trading", "ar": "التجارة" }, "order": 1, "items": [
      { "id": "quick_order", "label": { "en": "Bulk quick order", "ar": "إدخال طلب سريع" }, "target": "sales.quick_order" },
      { "id": "quotes", "label": { "en": "Quotes", "ar": "عروض الأسعار" }, "target": "sales.quotations" },
      { "id": "orders", "label": { "en": "Bulk orders", "ar": "أوامر التوريد" }, "target": "sales.orders" },
      { "id": "deliveries", "label": { "en": "Deliveries", "ar": "إشعارات التسليم" }, "target": "sales.deliveries" }
    ]},
    { "id": "credit", "label": { "en": "Credit & collections", "ar": "الائتمان والتحصيل" }, "order": 2, "items": [
      { "id": "invoices", "label": { "en": "Credit invoices", "ar": "فواتير الآجل" }, "target": "sales.invoices" },
      { "id": "statements", "label": { "en": "Customer statements", "ar": "كشوف الحسابات" }, "target": "partners.statements" },
      { "id": "pdc", "label": { "en": "PDC custody", "ar": "الشيكات المؤجلة" }, "target": "notes.received", "feature_key": "notes.received" },
      { "id": "maturity", "label": { "en": "Maturity calendar", "ar": "تقويم الاستحقاق" }, "target": "notes.pdc_calendar", "feature_key": "notes.pdc_calendar" }
    ]}
  ]},
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
    "quotation": { "prefix": "QT", "format": "QT-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "sales_order": { "prefix": "ORD", "format": "ORD-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": true },
    "delivery_note": { "prefix": "DLV", "format": "DLV-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "credit_note": { "prefix": "CN", "format": "CN-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "receipt": { "prefix": "RCP", "format": "RCP-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "goods_receipt": { "prefix": "GRN", "format": "GRN-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "stock_transfer": { "prefix": "TRF", "format": "TRF-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC", "default_track_batch": false, "default_track_expiry": false,
    "default_track_serial": false, "default_imei_tracking": false, "fefo_picking": false,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "notes.maturity-calendar", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "notes.aging", "pinned": true, "dashboard": false, "default_period": "this_month" },
    { "report_key": "ar.aging", "pinned": true, "dashboard": true, "default_period": "this_month" },
    { "report_key": "inventory.valuation", "pinned": true, "dashboard": false, "default_period": "custom" }
  ],
  "onboarding_steps": [
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts (trade receivables, notes receivable)", "ar": "تأكيد دليل الحسابات (ذمم التجار، أوراق القبض)" }, "required": true },
    { "id": "warehouses", "title": { "en": "Main & branch warehouses", "ar": "المستودع الرئيسي ومستودعات الفروع" }, "required": true },
    { "id": "price_tiers", "title": { "en": "Price lists with quantity breaks & customer tiers", "ar": "قوائم الأسعار مع شرائح الكمية وفئات العملاء" }, "required": true },
    { "id": "customers_credit", "title": { "en": "Customers with credit terms, limits & opening balances", "ar": "العملاء مع شروط الدفع وحدود الائتمان والأرصدة الافتتاحية" }, "required": true },
    { "id": "opening_stock", "title": { "en": "Opening stock via goods receipts", "ar": "المخزون الافتتاحي عبر سندات الاستلام" }, "required": true },
    { "id": "first_cycle", "title": { "en": "Run quote → bulk order → delivery → credit invoice", "ar": "تنفيذ أول دورة: عرض، أمر توريد، تسليم، فاتورة آجل" }, "required": false },
    { "id": "first_pdc", "title": { "en": "Receive a first PDC note against an invoice", "ar": "استلام أول شيك مؤجل مقابل فاتورة" }, "required": false, "feature_key": "notes.received" }
  ],
  "capability_prerequisites": {
    "customer_price_tiers": { "level": "REQUIRED", "feature_keys": ["items.price_lists", "distribution.customer_tiers"], "available_from_phase": "PHASE-017" },
    "pdc_notes": { "level": "REQUIRED", "feature_keys": ["notes.received", "notes.pdc_calendar"], "available_from_phase": "PHASE-027" },
    "installment_terms": { "level": "OPTIONAL", "feature_keys": ["installments.plans", "installments.late_fees"], "available_from_phase": "PHASE-027" },
    "barcode_pos": { "level": "OPTIONAL", "feature_keys": ["pos.terminals", "pos.sales", "pos.receipts"], "available_from_phase": "PHASE-016" },
    "cashier_shifts": { "level": "OPTIONAL", "feature_keys": ["treasury.cashier_shifts"], "available_from_phase": "PHASE-016" },
    "imei_tracking": { "level": "OPTIONAL", "feature_keys": ["inventory.serial_tracking"], "available_from_phase": "PHASE-010" },
    "expiry_tracking_fefo": { "level": "OPTIONAL", "feature_keys": ["inventory.batch_tracking"], "available_from_phase": "PHASE-010" },
    "free_goods_promo": { "level": "OPTIONAL", "feature_keys": ["sales.discount_management", "distribution.free_goods"], "available_from_phase": "PHASE-017" },
    "commissions": { "level": "OPTIONAL", "feature_keys": ["sales.commissions"], "available_from_phase": "PHASE-017" },
    "landed_costs": { "level": "OPTIONAL", "feature_keys": ["purchasing.landed_costs"], "available_from_phase": "PHASE-011" },
    "route_planning": { "level": "OPTIONAL", "feature_keys": ["distribution.routes"], "available_from_phase": "PHASE-017" },
    "field_collections": { "level": "OPTIONAL", "feature_keys": ["treasury.receipts_disbursements"], "available_from_phase": "PHASE-017" },
    "shipment_tracking": { "level": "OPTIONAL", "feature_keys": ["distribution.shipment_tracking"], "available_from_phase": "PHASE-019" }
  }
}
```

## Enabled features (exact keys)

| Feature key | Required? | Phase | Note |
|---|---|---|---|
| `items.price_lists` | Required | PHASE-006 | Quantity-break tiers (`min_qty` per price-list line) + per-tier customer lists |
| `partners.credit_terms`, `partners.statements` | Required | PHASE-006/012 | Credit-first trading; monthly statements |
| `sales.quotations`, `sales.orders`, `sales.deliveries` | Required | PHASE-012 | Quote → bulk order → delivery chain; one-click order from quote |
| `sales.invoices`, `sales.credit_limits` | Required | PHASE-012 | Credit invoice against delivery; limit enforced before save |
| `purchasing.goods_receipts` | Required | PHASE-011 | Container intake with barcode capture |
| `inventory.multi_warehouse` | Required | PHASE-010 | Main + branch warehouses |
| `notes.received` | Required | PHASE-027 | PDC discipline: custody → maturity calendar → collection/dishonor |
| `treasury.cashier_shifts`, `pos.*` | Optional | PHASE-016 | Cash-and-carry counter selling |
| `distribution.routes`, `distribution.customer_tiers`, `treasury.receipts_disbursements` | Optional | PHASE-017 | Collection rounds for delivery trucks |
| `installments.plans`, `installments.late_fees` | Optional | PHASE-027 | Reseller installment deals |

## Terminology overrides (sample)

| Term key | English | العربية | Note |
|---|---|---|---|
| `partner.customer` | Customer (trader) | العميل / التاجر | B2B register; not "مستهلك" |
| `doc.sales_invoice` | Wholesale sales invoice | فاتورة بيع جملة | Credit invoice against a delivery |
| `doc.sales_order` | Bulk order | أمر التوريد | Quantity-driven |
| `billing.receipt_voucher` | Receipt voucher | سند قبض | Collection against open invoices |
| `price.qty_break` | Quantity break | شريحة الكمية | `price_list_items.min_qty` tier |
| `price.customer_tier` | Customer price tier | فئة سعر العميل | Wholesale / semi-wholesale / retail tiers |
| `credit.limit` | Credit limit | سقف الائتمان | Enforced before invoice save |
| `notes.pdc` | Post-dated note | شيك مؤجل | Received into `notes` custody, not cash |
| `billing.statement` | Customer statement | كشف حساب العميل | Monthly AR statement |

## Default navigation (sample)

| EN | AR | Target |
|----|----|--------|
| Bulk quick order | إدخال طلب سريع | `sales.quick_order` |
| Quotes | عروض الأسعار | `sales.quotations` |
| Bulk orders | أوامر التوريد | `sales.orders` |
| Credit invoices | فواتير الآجل | `sales.invoices` |
| Customer statements | كشوف الحسابات | `partners.statements` |
| PDC custody | الشيكات المؤجلة | `notes.received` |
| Maturity calendar | تقويم الاستحقاق | `notes.pdc_calendar` |

## Signature workflow — quote → bulk order → credit invoice → PDC collection

1. Sales rep opens a **trade quote عرض سعر** with quantity lines; the price list resolves
   the tier and the quantity break (`min_qty`) automatically per customer.
2. Customer accepts → quote converts to a **bulk order أمر توريد** in one click (number
   reserved at approval). *No ledger effect.*
3. Warehouse picks and posts a **delivery note إشعار تسليم**; stock issues from the main
   warehouse (COGS journal, G-03 shape).
4. The credit invoice is raised against the delivery: **DR AR control · CR revenue · CR VAT**
   (G-01); the credit limit is checked before save and blocks/warns per policy.
5. End of month: **customer statement كشف حساب** reconciles to the AR control
   (INV-009/012 discipline).
6. Customer hands a **post-dated cheque شيك مؤجل**: note received into custody —
   **DR `NOTES_RECEIVABLE` · CR `AR_CONTROL`** (G-24, settles the open item; BR-045).
7. At maturity the note is deposited and collected — **DR cash/bank · CR `NOTES_RECEIVABLE`**
   (G-25); a bounced note restores the AR open item exactly (G-26, BR-046).

Numbered steps and journals: credit chain per
[../../product/BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §2; note lifecycle
per §10 (v2.0, [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §M) and the compact
signature flow [../workflows/industry-workflows.md](../workflows/industry-workflows.md) §g.

## Inventory behavior defaults

| Setting | Default | Notes |
|---|---|---|
| Costing method | WAC | Importers may add `purchasing.landed_costs` |
| Batch/expiry | Off | Food wholesalers enable per category (`inventory.batch_tracking`) |
| Serial / IMEI | Off (per-category opt-in) | High-value units |
| FEFO picking | Off | Follows batch categories when enabled |
| Negative stock | Forbidden | Template may not enable it |

## Document types emphasized

| Document | Arabic | Numbering default | Policy |
|---|---|---|---|
| Trade quote | عرض السعر | `QT-{yyyy}-{seq:5}` | Converts to order in one click |
| Bulk order | أمر التوريد | `ORD-{yyyy}-{seq:6}` | Number reserved at approval |
| Delivery note | إشعار التسليم | `DLV-{yyyy}-{seq:5}` | Issues stock; references order |
| Wholesale credit invoice | فاتورة بيع جملة | `INV-{yyyy}-{seq:6}` | Credit limit enforced |
| Receipt voucher | سند قبض | `RCP-{yyyy}-{seq:6}` | Allocates to open invoices |
| PDC note receipt | شيك مؤجل | — (notes register) | Requires maturity date; BR-045 |

## Reports emphasized

`notes.maturity-calendar` (dashboard), `notes.aging`, `ar.aging` (dashboard),
`inventory.valuation` — see [../reports/README.md](../reports/README.md); the pins use the
LIVE registry keys (`ar.aging` / `inventory.valuation` — the 0025/0027 reconciliation
convention for `partners.ar_aging` / `inventory.stock_valuation` doc spellings). The two
`notes.*` reports registered with the `notes` module at PHASE-027
([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §J).

## Out of scope for this template

- **E-commerce B2B portals** — external adapters only (PHASE-023 integrations).
- **Contract pricing negotiation workflows** (rebate accruals, trade-spend accounting) —
  price lists and discount policies are the supported surface.
- Van-based route distribution — compose `industry.distribution` capabilities instead
  (`distribution.routes` is offered as OPTIONAL here).

## Known limitations

- Quantity-break tiers resolve on price-list lines (`price_list_items.min_qty`); an
  explicitly quoted price always wins over tier resolution
  ([../capabilities/CAPABILITY_MATRIX.md](../capabilities/CAPABILITY_MATRIX.md) §2.5).
- PDC discounting/endorsement to third parties uses the generic `notes` module features
  (`notes.endorsement`, `notes.discounting`, PHASE-027) — no trading-desk collateral
  management is modeled.
- Templates never grant features (plans do) and never change accounting (INV-022); until
  PHASE-027 ships platform-wide, `notes.received` entries are phase-gated "coming with
  PHASE-027" and credit trading works via ordinary receipts.
