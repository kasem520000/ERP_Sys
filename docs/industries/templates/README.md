# Industry Template Manifests — Index

> **Status:** STABLE · **Owner:** Industry Solutions Architecture · **Updated:** 2026-11-08

The thirteen first-party industry templates, one manifest per business activity family. Each
template document in this folder contains: the JSON manifest (following the schema in
[../README.md](../README.md) §3), target businesses, exact feature keys, sample navigation
(AR + EN), terminology overrides, the signature workflow, inventory defaults, emphasized
document types and reports, and explicit out-of-scope/limitations.

## Index

> **Canonical template identity (consolidation DEF-008, 2026-10-28):** the machine key is
> the manifest `"id"` (`industry.*`), resolved by the configuration engine; the filenames
> below are documentation slugs only. Machine-readable manifests are extracted to
> [`manifests/`](manifests/) (one `manifest.<family>.json` per template, JSON-validated by
> `scripts/extract_manifests.py`; regenerate after editing any embedded manifest).

| Machine id (canonical) | Manifest JSON | Document | Industries served | Phase | Key differentiators |
|------------------------|---------------|----------|-------------------|-------|---------------------|
| `industry.retail` | [manifest.retail.json](manifests/manifest.retail.json) | [retail.md](retail.md) | Clothing, electronics, mobile phones, cosmetics, general retail stores | PHASE-015 | Barcode counter POS, IMEI register for phones, variant-style items, exchanges/returns, branch transfers |
| `industry.grocery` | [manifest.grocery.json](manifests/manifest.grocery.json) | [grocery-supermarket.md](grocery-supermarket.md) | Grocery, convenience stores, supermarkets, wholesale food retail | PHASE-015 | Scale-barcode weighed items, batch/expiry with FEFO, expiry write-off discipline, customer price tiers |
| `industry.restaurant` | [manifest.restaurant.json](manifests/manifest.restaurant.json) | [restaurant-cafe.md](restaurant-cafe.md) | Restaurants, cafés, buffets, bakeries with retail counters | PHASE-015 | Table service, order types, combos, fast check flow, daily Z close, kitchen ticket routing |
| `industry.automotive` | [manifest.automotive.json](manifests/manifest.automotive.json) | [automotive-workshop.md](automotive-workshop.md) | Tire shops, spare-parts stores, repair workshops (combined or standalone) | PHASE-017 (**delivered 2026-11-02**) | Job cards combining parts + labor, per-customer vehicle registry, diagnosis quotations, service history |
| `industry.distribution` | [manifest.distribution.json](manifests/manifest.distribution.json) | [distribution-field-sales.md](distribution-field-sales.md) | Van-sales distributors, beverage/food routes, wholesale with field reps | PHASE-017 (**delivered 2026-11-02**) | Routes, van stock, rep settlements with variance, price tiers, free goods, field collections |
| `industry.food_manufacturing` | [manifest.food_manufacturing.json](manifests/manifest.food_manufacturing.json) | [food-manufacturing.md](food-manufacturing.md) | Bakeries, food production lines, packaging operations | PHASE-018 (**delivered 2026-11-03**) | BOM/recipes, production orders with WIP, QC gate, batch genealogy, shelf-life batches |
| `industry.professional_services` | [manifest.professional_services.json](manifests/manifest.professional_services.json) | [professional-services.md](professional-services.md) | Law offices, consulting, accounting firms, agencies | PHASE-019 (**delivered 2026-11-03**) | Service contracts, time-based and recurring billing, milestones, project dimension, no stock by default |
| `industry.rental_logistics` | [manifest.rental_logistics.json](manifests/manifest.rental_logistics.json) | [rental-logistics.md](rental-logistics.md) | Car rental, equipment rental, shipping/freight agencies | PHASE-019 | Rental contracts with deposits and late fees, fleet utilization, shipment milestone tracking |
| `industry.wholesale` | [manifest.wholesale.json](manifests/manifest.wholesale.json) | [wholesale.md](wholesale.md) | Wholesale shops, importers, B2B trading houses, cash-and-carry | PHASE-030 (**delivered 2026-11-08**) | Quantity-break price tiers, customer price tiers, credit limits + statements, bulk quick-order entry, PDC notes for receivables |
| `industry.electronics` | [manifest.electronics.json](manifests/manifest.electronics.json) | [electronics.md](electronics.md) | Mobile shops, electronics retailers, accessories + repair combos | PHASE-030 (**delivered 2026-11-08**) | IMEI-level serial register, repair job cards (parts + labor), trade-in purchases of used devices, warranty claim tracking |
| `industry.healthcare` | [manifest.healthcare.json](manifests/manifest.healthcare.json) | [healthcare.md](healthcare.md) | Clinics, medical centers, hospitals' commercial back office, pharmacies | PHASE-031 | Patient financial files (no clinical data), insurance-claim billing with per-claim AR, pharmacy FEFO batches, claims settled by PDC notes |
| `industry.education` | [manifest.education.json](manifests/manifest.education.json) | [education.md](education.md) | Private schools, training centers, tutoring businesses | PHASE-032 | Enrollment/year contracts, tuition fee schedules per program/grade, installment plans + late fees, sibling discounts, guardian as paying partner |
| `industry.agriculture` | [manifest.agriculture.json](manifests/manifest.agriculture.json) | [agriculture.md](agriculture.md) | Farms, agri-traders, livestock operations, greenhouses | PHASE-033 | Crop-cycle costing via BOM + production order per field project, harvest batches with genealogy, livestock as serial-tracked heads, per-field profitability |

Requirement traceability: retail/grocery/restaurant = FR-IND-002, automotive/distribution =
FR-IND-003, food manufacturing = FR-IND-004, professional services + rental/logistics =
FR-IND-005 in [../../PRODUCT_REQUIREMENTS.md](../../PRODUCT_REQUIREMENTS.md); the five
v2.0 templates (wholesale, electronics, healthcare, education, agriculture) = **FR-IND-006**
per [../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §L (ED-06…ED-09); phase
sequencing per [../../planning/MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md)
(stage 6, PHASE-015…019; stages 9–11, PHASE-030…033).

## Phase map

| Phase | Delivers |
|-------|----------|
| PHASE-015 | Industry framework (manifest engine, switching rules) + `retail`, `grocery_supermarket`, `restaurant_cafe` templates — POS-flavored entries are phase-gated "coming with PHASE-016" |
| PHASE-016 | Point of sale — un-gates `barcode_pos`, `table_service`, `scale_barcodes`, `cashier_shifts` terminal flows (**delivered 2026-11-02** — the POS entries resolve live) |
| PHASE-017 | `automotive_workshop` + `distribution_field_sales` templates (**delivered 2026-11-02** — both seeded at v1.0.0 by migration 0025 and live on business/enterprise; un-gates the automotive/distribution capability entries incl. grocery's `customer_price_tiers`; offline van selling stays PHASE-022) |
| PHASE-018 | `food_manufacturing` template (manufacturing module) (**delivered 2026-11-03** — seeded at v1.0.0 by migration 0026 and live on business/enterprise; the seven `manufacturing.*` feature keys grant with the migration; restaurants' optional prep-recipe entries become live configuration with this add-on) |
| PHASE-019 | `professional_services` template (CRM module, service contracts, projects dimension) (**delivered 2026-11-03** — seeded at v1.0.0 by migration 0027 and live on business/enterprise; the six CRM+projects feature keys (`crm.leads`, `crm.tasks_activities`, `crm.service_contracts`, `crm.recurring_billing`, `crm.service_orders`, `accounting.projects`) grant with the migration; the `rental_logistics` intake set stays deferred behind the §17 decision record — RISK-019/RISK-020, never silently changed) |
| PHASE-030 | `wholesale` + `electronics` templates (**delivered 2026-11-08** — seeded at v1.0.0 by the data-only migration 0041 and applying through the unmodified PHASE-015 engine on pre-granted keys; the credit/PDC entries resolve live on the `notes` module — PHASE-027 shipped 2026-11-07, so no wholesale entry phase-gates anymore) |
| PHASE-031 | `healthcare` commercial shell (**delivered 2026-11-08** — the additive `sales_invoices.claim_ref` light extension by migration 0042 + the template seeded at v1.0.0 by the data-only migration 0043; the insurance_claim_billing capability resolves LIVE at its own release phase, the REQUIRED pdc_notes chain on the 0038 grants, pharmacy FEFO on inventory.batch_tracking; the group_by_claim report parameter rides notes.aging / notes.maturity-calendar / partner.statement) |
| PHASE-032 | `education` commercial shell (tuition installments gate on the `installments` module, PHASE-027) |
| PHASE-033 | `agriculture` commercial shell (crop cycles reuse `manufacturing` PHASE-018; field costing reuses projects PHASE-019) |

## Choosing and combining

- One **active template** per tenant at a time; capabilities from other templates may be
  added individually (a supermarket group with an in-store bakery adds
  `bom_production` when PHASE-018 ships — additive per [../README.md](../README.md) §5).
- Hybrid businesses pick the template matching their **dominant revenue flow** and layer
  optional capabilities (e.g., a tire shop that is 80% parts retail picks
  `automotive_workshop` and switches `barcode_pos` to OPTIONAL→enabled).
- When no template fits, the tenant completes onboarding with platform defaults
  (no template) and composes capabilities manually.

## Adding a new first-party template

1. Write the manifest against the schema ([../README.md](../README.md) §3) and a document
   in this folder using the same section skeleton.
2. Answer all 29 capability rows × 13 industry columns in
   [../capabilities/CAPABILITY_MATRIX.md](../capabilities/CAPABILITY_MATRIX.md) for the new
   industry (REQUIRED/OPTIONAL/N/A) — extend the matrix, don't fork it.
3. Pass the seven governance tests ([../README.md](../README.md) §8), including golden
   onboarding and switch-safety fixtures.
4. Register in the platform template registry with semver `1.0.0` and bilingual release
   notes; add signature workflows and reports to
   [../workflows/](../workflows/README.md) and [../reports/README.md](../reports/README.md)
   where the template introduces a new flow.
