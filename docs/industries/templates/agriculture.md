# Template: Agriculture (Commercial Shell) — `agriculture`

> **Status:** STABLE · **Owner:** Industry Solutions Architecture · **Updated:** 2026-11-08

Farming economics on the trading core: every **crop cycle الدورة الزراعية** is a BOM recipe
run as a production order costed to a **field project الحقل**, harvests land as **batches
دفعة الحصاد**, and livestock are serial-tracked items at **head level رأس**. Ships in
PHASE-033 ([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §B; ED-09). Manifest
schema: [../README.md](../README.md) §3. Signature flow summary:
[../workflows/industry-workflows.md](../workflows/industry-workflows.md) §k.

## Target businesses

- Farms and greenhouses (open-field and protected crops).
- Agri-traders buying and reselling harvest produce.
- Livestock operations (head-level animal tracking — commercial scope).
- Contract growers costing per field/per crop season.

## Manifest

```json
{
  "id": "industry.agriculture",
  "name": "Agriculture (Commercial Shell)",
  "name_ar": "الزراعة — الغلاف التجاري",
  "version": "1.0.0",
  "required_feature_keys": [
    "industry.template_engine", "manufacturing.bom", "manufacturing.production_orders",
    "inventory.batch_tracking", "purchasing.orders", "purchasing.goods_receipts",
    "sales.invoices", "accounting.projects", "accounting.cost_centers"
  ],
  "default_modules_enabled": ["accounting", "partners", "items", "inventory", "sales",
    "purchasing", "treasury", "tax", "reporting", "manufacturing", "configuration"],
  "terminology_overrides": {
    "crop.item": { "en": "Crop", "ar": "المحصول" },
    "crop.cycle": { "en": "Crop cycle", "ar": "الدورة الزراعية" },
    "mfg.recipe": { "en": "Crop-cycle recipe (BOM)", "ar": "وصفة الدورة الزراعية (قائمة المواد)" },
    "mfg.production_order": { "en": "Cycle run order", "ar": "أمر تنفيذ الدورة" },
    "harvest.batch": { "en": "Harvest batch", "ar": "دفعة الحصاد" },
    "farm.field": { "en": "Farm / Field", "ar": "المزرعة / الحقل" },
    "livestock.head": { "en": "Livestock head", "ar": "رأس" },
    "input.seeds": { "en": "Seeds & inputs", "ar": "البذور والمدخلات" },
    "input.feed": { "en": "Feed", "ar": "الأعلاف" },
    "mfg.yield": { "en": "Yield", "ar": "المردود" },
    "mfg.scrap": { "en": "Crop loss", "ar": "الفاقد" }
  },
  "navigation_manifest": { "groups": [
    { "id": "season", "label": { "en": "Season", "ar": "الموسم" }, "order": 1, "items": [
      { "id": "fields", "label": { "en": "Fields & projects", "ar": "الحقول والمشاريع" }, "target": "accounting.projects" },
      { "id": "recipes", "label": { "en": "Crop-cycle recipes (BOM)", "ar": "وصفات الدورات (قائمة المواد)" }, "target": "manufacturing.bom", "feature_key": "manufacturing.bom" },
      { "id": "cycles", "label": { "en": "Cycle run orders", "ar": "أوامر تنفيذ الدورات" }, "target": "manufacturing.orders", "feature_key": "manufacturing.production_orders" }
    ]},
    { "id": "harvest", "label": { "en": "Harvest & trade", "ar": "الحصاد والتجارة" }, "order": 2, "items": [
      { "id": "batches", "label": { "en": "Harvest batches", "ar": "دفعات الحصاد" }, "target": "inventory.batches", "feature_key": "inventory.batch_tracking" },
      { "id": "sales", "label": { "en": "Produce sales", "ar": "مبيعات المحاصيل" }, "target": "sales.invoices" },
      { "id": "livestock", "label": { "en": "Livestock register", "ar": "سجل الثروة الحيوانية" }, "target": "inventory.serials", "feature_key": "inventory.serial_tracking" }
    ]}
  ]},
  "workflow_policies": {
    "cycle_order_per_field_project": true,
    "harvest_batch_genealogy_enabled": true,
    "field_cost_center_mandatory_on_cycle": true,
    "scrap_reason_required": true,
    "consumption_variance_threshold_pct": 5,
    "livestock_serial_per_head": true
  },
  "document_numbering_defaults": {
    "production_order": { "prefix": "CYC", "format": "CYC-{yyyy}-{seq:5}", "per_branch": true, "reserve_on_approval": true },
    "goods_receipt": { "prefix": "GRN", "format": "GRN-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "sales_invoice": { "prefix": "INV", "format": "INV-{yyyy}-{seq:6}", "per_branch": false, "reserve_on_approval": false },
    "delivery_note": { "prefix": "DLV", "format": "DLV-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false },
    "stock_transfer": { "prefix": "TRF", "format": "TRF-{yyyy}-{seq:5}", "per_branch": false, "reserve_on_approval": false }
  },
  "inventory_policy_defaults": {
    "costing_method": "WAC", "default_track_batch": true, "default_track_expiry": true,
    "default_track_serial": false, "default_imei_tracking": false, "fefo_picking": true,
    "allow_negative_stock": false
  },
  "report_defaults": [
    { "report_key": "manufacturing.production_cost", "pinned": true, "dashboard": true, "default_period": "this_year" },
    { "report_key": "inventory.valuation", "pinned": true, "dashboard": false, "default_period": "custom" },
    { "report_key": "inventory.expiry_list", "pinned": true, "dashboard": false, "default_period": "this_week" },
    { "report_key": "manufacturing.batch_genealogy", "pinned": true, "dashboard": false, "default_period": "custom" }
  ],
  "onboarding_steps": [
    { "id": "coa_confirm", "title": { "en": "Confirm chart of accounts (WIP, crop loss, biological assets)", "ar": "تأكيد دليل الحسابات (تحت التشغيل، الفاقد، الأصول الحيوية)" }, "required": true },
    { "id": "fields", "title": { "en": "Fields as projects + cost centers", "ar": "الحقول كمشاريع ومراكز تكلفة" }, "required": true },
    { "id": "recipes", "title": { "en": "Crop-cycle recipes per crop", "ar": "وصفات الدورات لكل محصول" }, "required": true },
    { "id": "inputs", "title": { "en": "Seeds/feed/inputs with batches", "ar": "البذور والأعلاف والمدخلات مع الدفعات" }, "required": true },
    { "id": "livestock", "title": { "en": "Livestock items with head-level serials", "ar": "أصناف الثروة الحيوانية بتسجيل رأس برأس" }, "required": false, "feature_key": "inventory.serial_tracking" },
    { "id": "first_cycle", "title": { "en": "Run first cycle: order → harvest intake → sale", "ar": "تنفيذ أول دورة: أمر، حصاد، بيع" }, "required": false }
  ],
  "capability_prerequisites": {
    "crop_cycle_costing": { "level": "REQUIRED", "feature_keys": ["manufacturing.bom", "manufacturing.production_orders", "accounting.projects"], "available_from_phase": "PHASE-033" },
    "harvest_batches": { "level": "REQUIRED", "feature_keys": ["inventory.batch_tracking", "manufacturing.batch_genealogy"], "available_from_phase": "PHASE-018" },
    "bom_production": { "level": "REQUIRED", "feature_keys": ["manufacturing.bom", "manufacturing.production_orders"], "available_from_phase": "PHASE-018" },
    "expiry_tracking_fefo": { "level": "REQUIRED", "feature_keys": ["inventory.batch_tracking"], "available_from_phase": "PHASE-010" },
    "batch_genealogy": { "level": "OPTIONAL", "feature_keys": ["manufacturing.batch_genealogy"], "available_from_phase": "PHASE-018" },
    "qc_inspections": { "level": "OPTIONAL", "feature_keys": ["manufacturing.qc"], "available_from_phase": "PHASE-018" },
    "customer_price_tiers": { "level": "OPTIONAL", "feature_keys": ["distribution.customer_tiers"], "available_from_phase": "PHASE-017" },
    "commissions": { "level": "OPTIONAL", "feature_keys": ["sales.commissions"], "available_from_phase": "PHASE-017" },
    "landed_costs": { "level": "OPTIONAL", "feature_keys": ["purchasing.landed_costs"], "available_from_phase": "PHASE-011" },
    "shipment_tracking": { "level": "OPTIONAL", "feature_keys": ["distribution.shipment_tracking"], "available_from_phase": "PHASE-019" },
    "pdc_notes": { "level": "OPTIONAL", "feature_keys": ["notes.received"], "available_from_phase": "PHASE-027" },
    "cashier_shifts": { "level": "OPTIONAL", "feature_keys": ["treasury.cashier_shifts"], "available_from_phase": "PHASE-016" }
  }
}
```

## Enabled features (exact keys)

| Feature key | Required? | Phase | Note |
|---|---|---|---|
| `manufacturing.bom` | Required | PHASE-018 | Crop-cycle recipe: seeds/feed/labor/overhead inputs + yield |
| `manufacturing.production_orders` | Required | PHASE-018 | Cycle runs per field, one order per (field, cycle) |
| `inventory.batch_tracking` | Required | PHASE-010 | Harvest batches (and input batches) with expiry windows |
| `purchasing.orders`, `purchasing.goods_receipts` | Required | PHASE-011 | Supplies/feed purchases and intake |
| `sales.invoices` | Required | PHASE-012 | Produce sales from harvest batches |
| `accounting.projects`, `accounting.cost_centers` | Required | PHASE-019 | Field = project; crop = cost center; per-field profitability |
| `inventory.serial_tracking` | Optional | PHASE-010 | Livestock heads (per-category opt-in; one serial per رأس) |
| `manufacturing.batch_genealogy` | Optional | PHASE-018 | Harvest genealogy: input batches → harvest batch → sales |
| `manufacturing.qc` | Optional | PHASE-018 | Harvest grading inspections |
| `purchasing.landed_costs` | Optional | PHASE-011 | Imported inputs (seeds, fertilizer, feed) |
| `notes.received` | Optional | PHASE-027 | Buyers' post-dated cheques |

## Terminology overrides (sample)

| Term key | English | العربية | Note |
|---|---|---|---|
| `crop.item` | Crop | المحصول | Finished-goods item label |
| `crop.cycle` | Crop cycle | الدورة الزراعية | Season/rotation run |
| `mfg.recipe` | Crop-cycle recipe (BOM) | وصفة الدورة الزراعية (قائمة المواد) | Food-friendly BOM label |
| `mfg.production_order` | Cycle run order | أمر تنفيذ الدورة | Stamped with field project + crop cost center |
| `harvest.batch` | Harvest batch | دفعة الحصاد | Output batch at completion |
| `farm.field` | Farm / Field | المزرعة / الحقل | Project + cost center pair |
| `livestock.head` | Livestock head | رأس | Serial-tracked animal unit |
| `mfg.scrap` | Crop loss | الفاقد | Reason-coded; posts to scrap expense |

## Default navigation (sample)

| EN | AR | Target |
|----|----|--------|
| Fields & projects | الحقول والمشاريع | `accounting.projects` |
| Crop-cycle recipes (BOM) | وصفات الدورات (قائمة المواد) | `manufacturing.bom` |
| Cycle run orders | أوامر تنفيذ الدورات | `manufacturing.orders` |
| Harvest batches | دفعات الحصاد | `inventory.batches` |
| Produce sales | مبيعات المحاصيل | `sales.invoices` |
| Livestock register | سجل الثروة الحيوانية | `inventory.serials` |

## Signature workflow — season setup → inputs → cycle run → harvest intake → sale

1. **Season setup** — create the **field project الحقل** (+ crop cost center) and the
   **crop-cycle recipe وصفة الدورة** (BOM: seeds/feed/fertilizer + labor + overhead rates
   + yield). *No ledger effect.*
2. **Input purchases** — seeds/feed via purchase orders + goods receipts:
   **DR inventory · CR GRNI** (G-07) then supplier invoice clears the accrual (G-08); landed
   costs attach where imported.
3. **Cycle run أمر تنفيذ الدورة** — production order released against the field project;
   input batches consumed through the season: **DR WIP · CR inventory at issue cost**
   (production-run consumption, G-17 chain).
4. **Harvest intake الحصاد** — completion posts the **harvest batch دفعة الحصاد** at
   production cost: **DR finished-goods inventory · CR WIP** (G-17); genealogy links
   consumed input batches → harvest batch; crop loss scrap posts **DR crop-loss expense ·
   CR WIP** (G-18) with reason.
5. **Produce sale** — invoices issue from harvest batches (FEFO): **DR AR/cash · CR revenue
   · CR VAT** (G-01/G-02) + **DR COGS · CR inventory** (G-03); the field project stamp gives
   per-field profitability.

Numbered production-run steps and journals:
[../../product/BUSINESS_WORKFLOWS.md](../../product/BUSINESS_WORKFLOWS.md) §6 and
[../workflows/industry-workflows.md](../workflows/industry-workflows.md) §d; compact flow
§k below. Farm machinery assets follow the **generic** fixed-asset lifecycle (PHASE-026;
BUSINESS_WORKFLOWS §11 once v2.0 adds it) — this template introduces **no**
agriculture-specific asset flow (none is needed).

## Inventory behavior defaults

| Setting | Default | Notes |
|---|---|---|
| Costing method | WAC | Harvest batch lands at production cost → WAC onward |
| Batch + expiry | On | Produce batches get perishability windows; FEFO issues |
| Serial tracking | Per-category opt-in | Livestock: one serial per head (رأس), status per animal |
| Livestock intake | GRN as serial item | Purchased/born animals enter as serials at cost |
| Scrap / crop loss | Reason-coded | Posts to scrap expense; approval for large variances |
| Negative stock | Forbidden | |

## Document types emphasized

| Document | Arabic | Numbering default | Policy |
|---|---|---|---|
| Cycle run order | أمر تنفيذ الدورة | `CYC-{yyyy}-{seq:5}` | Number reserved at release; field/crop stamps |
| Goods receipt (inputs/livestock) | سند استلام البضاعة | `GRN-{yyyy}-{seq:6}` | Batch capture; serial capture per head |
| Produce sales invoice | فاتورة بيع المحصول | `INV-{yyyy}-{seq:6}` | FEFO batch issue |
| Delivery note | إشعار التسليم | `DLV-{yyyy}-{seq:5}` | Farm-gate / market delivery |
| Stock transfer | تحويل مخزون | `TRF-{yyyy}-{seq:5}` | Field store → cold store |

## Reports emphasized

`manufacturing.production_cost` (cycle: planned vs actual inputs, yield, crop loss —
dashboard), `inventory.valuation`, `inventory.expiry_list` (perishables),
`manufacturing.batch_genealogy` — see [../reports/README.md](../reports/README.md). The
`inventory.valuation` pin is the live registry key (the 0025 automotive / 0039 education
reconciliation precedent — `inventory.stock_valuation` was the pre-013 planning id).

## Out of scope for this template (ED-09, ED-11 — commercial shell only)

- **Precision agronomy / IoT** (soil sensors, drone imagery, irrigation telemetry).
- **Weather integrations** (forecasts, growing-degree-day models).
- **Feed-mix optimization science** (least-cost ration formulation) — feed is a purchased
  input consumed by the cycle BOM; no optimization engine.

Deep-vertical operations remain non-goals until a future decision record adds them (ED-11;
[../../decisions/product/DR-003-platform-expansion-v2.md](../../decisions/product/DR-003-platform-expansion-v2.md)).

## Known limitations

- Biological-asset revaluation (IAS 41-style fair-value measurement) is **not** modeled —
  livestock and growing crops stay at cost through WIP; a future decision record would be
  required for fair-value accounting.
- Labor and overhead absorb at configured rates per cycle order (as in food manufacturing);
  actual field time capture awaits the payroll module's financial scope (PHASE-029).
- One FG item per production order line (no co-product split) — multi-crop rotations are
  separate cycle orders (the [food-manufacturing.md](food-manufacturing.md) limitation
  applies identically).
- Templates never grant features (plans do) and never change accounting (INV-022).
