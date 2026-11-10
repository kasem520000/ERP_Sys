# Industry Catalog

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-11-08

The thirteen launch industry templates. A template is a **versioned manifest** (see
[CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md) and the `industry_templates` entity in
[../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md)) that layers terminology,
menu emphasis, workflow defaults, and report packs onto the same financial core — never a
fork. Manifest files live under [../industries/templates/](../industries/templates/)
(each template below links its embedded manifest document and the extracted
machine-readable JSON under [../industries/templates/manifests/](../industries/templates/manifests/)),
with capability mapping in [../industries/capabilities/](../industries/capabilities/)
and industry workflows in [../industries/workflows/](../industries/workflows/).

**Template IDs** use `industry.<key>` (naming rule §5 of
[FEATURE_CATALOG.md](FEATURE_CATALOG.md)). They are configuration artifacts: plans grant the
*feature keys* a template emphasizes (see [SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md)
§4 add-ons), and the template decides how those features present.

## Summary matrix

| Template ID | Template (EN · AR) | Phase | Core emphasis | Flagship features |
|---|---|---|---|---|
| `industry.retail` | Retail · التجزئة | 015 | Counter selling, barcode, cash discipline | `pos.*`, `items.barcodes`, `treasury.cashier_shifts` |
| `industry.grocery` | Grocery / supermarket · البقالات والسوبرماركت | 015 | Volume retail, expiry, weighted goods | `pos.*`, `inventory.batch_tracking`, `items.units_of_measure` |
| `industry.restaurant` | Restaurant / café · المطاعم والمقاهي | 015 | Fast POS, daily cash, expiry waste | `pos.*`, `inventory.batch_tracking`, `treasury.cashier_shifts` |
| `industry.automotive` | Automotive / workshop · السيارات والورش | 017 (**SHIPPED**) | Parts + service job cards, seriality | `sales.job_cards`, `inventory.serial_tracking`, `sales.quotations`, `treasury.cashier_shifts` |
| `industry.distribution` | Distribution / field sales · التوزيع والمبيعات الميدانية | 017 (**SHIPPED**) | Van stock, credit routes, settlements | `distribution.*`, `sales.commissions`, `sales.credit_limits`; `offline.android_app` at 022 |
| `industry.food_manufacturing` | Food manufacturing · التصنيع الغذائي | 018 | BOM, batches, genealogy, expiry, QC | `manufacturing.*`, `inventory.batch_tracking` |
| `industry.professional_services` | Professional services · الخدمات المهنية | 019 (**SHIPPED**) | Contracts, recurring billing, projects | `crm.*`, `accounting.projects`, `accounting.cost_centers` |
| `industry.rental_logistics` | Rental / logistics · التأجير والخدمات اللوجستية | **SHIPPED** (delivery completion, migration 0047 — the 0044/0046 configuration-only convention; the deferred-intake reconciliation recorded in [PHASE-034-FINAL-RESTORATION.md](../implementation/phases/reports/PHASE-034-FINAL-RESTORATION.md)) | Contracts, deposits, item availability | `crm.service_contracts`, `crm.recurring_billing`, `inventory.serial_tracking` (fleet), live distribution routes/settlements (shipments) |
| `industry.wholesale` | Wholesale & trade · الجملة والتجارة | 030 (**SHIPPED**) | Quantity-break tiers, credit limits, PDC receivables | `items.price_lists` (qty-break), `partners.credit_terms`, `sales.credit_limits`, `distribution.routes` OPT, `notes.received` |
| `industry.electronics` | Mobile & electronics · الجوالات والإلكترونيات | 030 (**SHIPPED**) | IMEI register, repair cards, trade-ins | `inventory.serial_tracking` (IMEI), `crm.service_orders` (repairs), `pos.*`, trade-in via purchasing |
| `industry.healthcare` | Healthcare (commercial shell) · الرعاية الصحية | 031 (**SHIPPED**) | Patient billing, insurance claims, pharmacy batches | insurance-claim billing (AR per claim), `inventory.batch_tracking` (pharmacy), `notes.received` (claims cheques), `crm.service_orders` (visits) |
| `industry.education` | Education (commercial shell) · التعليم | 032 | Tuition contracts, installments, sibling discounts | `installments.plans` (tuition), `crm.service_contracts` (enrollment years), sibling discounts via pricing, dunning |
| `industry.agriculture` | Agriculture (commercial shell) · الزراعة | 033 | Crop-cycle costing, harvest batches, livestock serials | `manufacturing.bom` (crop cycles), `inventory.batch_tracking` (harvest), livestock as serial-tracked items, `accounting.projects` (per-field costing) |

> **Shipped status (2026-11-02, PHASE-015 + PHASE-017).** The template engine is live:
> `industry.retail`, `industry.grocery`, and `industry.restaurant` are seeded at **v1.0.0**
> in the engine-owned registry (migration 0022, status ACTIVE) and apply/switch follows the
> additive-only rule (BR-038). **PHASE-017 (migration `0025_automotive_distribution.sql`)
> seeded `industry.automotive` + `industry.distribution` at v1.0.0** — both apply through
> the unmodified engine on business/enterprise plans (the 0025 grants; see
> [SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md) §3). The other
> ten templates landed with their owning phases (018–019, 030–033) — and the final
> thirteenth with the delivery completion below.
>
> **Shipped status update (2026-11-08, PHASE-030).** Migration
> `0041_industry_wholesale_electronics.sql` (data-only, schema_version 41) seeded
> **`industry.wholesale` + `industry.electronics` at v1.0.0** — both apply through the
> unmodified PHASE-015 engine, every REQUIRED feature key already granted by earlier
> migrations (zero new keys, routes, or web code — the configuration-only phase).
>
> **Shipped status update (2026-11-08, PHASE-031).** The Healthcare Commercial Shell
> (ED-07) shipped as the register's "configuration + light extension" pattern: the
> single additive `sales_invoices.claim_ref` column (migration 0042, schema_version 42)
> + the `industry.healthcare` v1.0.0 seed (data-only migration 0043, schema_version 43).
> The shell applies through the unmodified PHASE-015 engine on pre-granted keys — the
> `insurance_claim_billing` capability resolves LIVE at its own release phase
> (available_from_phase PHASE-031 ≤ CURRENT_SHIPPED_PHASE 031), the REQUIRED pdc_notes
> chain on the 0038 grants (027 is a prerequisite, so claims cheques never phase-gate).
> Claim dunning rides the group_by_claim parameter on the EXISTING notes.aging /
> notes.maturity-calendar / partner.statement contracts (register §J stays closed).
> The pending v2.0 shells are now education / agriculture (PHASE-032…033). See
> [reports/PHASE-031-COMPLETION.md](../implementation/phases/reports/PHASE-031-COMPLETION.md).

> **Shipped status update (the delivery completion, post-034).** Migration
> `0047_industry_rental_logistics.sql` (data-only, schema_version 47) seeded
> **`industry.rental_logistics` at v1.0.0** — the thirteenth and final template, closing
> the 13-activity catalog this document registers. The shell follows the 0044/0046
> configuration-only convention over LIVE granted keys (crm.service_contracts +
> crm.recurring_billing + serial-tracked fleet + the live distribution routes/settlements
> pair), with the report pins reconciled to the live registry keys
> (inventory.serial-tracking / distribution.route_visit_compliance /
> services.contract_revenue_schedule / ar.aging — §J stays closed) and the capability set
> reconciling STRICTLY with the CAPABILITY_MATRIX §1 RNT column. The deferred
> crm.contract_deposits / crm.late_fees intake pair stays deferred per its decision
> record — deposits and late fees post through the existing contract-invoice + receipt
> machinery under the seven typed workflow policies.

## 1. `industry.retail` — Retail · قالب التجزئة

- **Target businesses.** Single- or few-branch shops selling physical goods over a counter:
  mobile accessories, electronics, clothing, pharmacies, bookstores. Persona P-01 (owner)
  and P-04 (cashier).
- **Capability needs.** Barcode-first selling, cash/card split, simple returns, reorder
  visibility, daily cash discipline; minimal accounting vocabulary.
- **Key modules emphasized.** `pos`, `items` (barcodes, price lists), `inventory`
  (multi-warehouse basics), `treasury` (shifts), `reporting` (daily cash, sales by item).
- **Example workflows.** [BUSINESS_WORKFLOWS.md](BUSINESS_WORKFLOWS.md) §1 (cash O2C), §4
  (counts), §9 (bank rec); [USER_JOURNEYS.md](USER_JOURNEYS.md) Journey B.
- **Manifest pointer.** [../industries/templates/](../industries/templates/) — actual manifest at
  [../industries/templates/retail.md](../industries/templates/retail.md) (embedded) and
  [../industries/templates/manifests/manifest.retail.json](../industries/templates/manifests/manifest.retail.json) (extracted machine form, id `industry.retail`).
- **Terminology examples.** نسمي الشاشة الرئيسية "المبيعات" لا "المستندات"; invoice kinds
  surface as "فاتورة نقدي/آجل" instead of CASH/CREDIT codes.

## 2. `industry.grocery` — Grocery / supermarket · قالب البقالات والسوبرماركت

- **Target businesses.** Supermarkets and groceries with hundreds to tens of thousands of
  SKUs, weighted goods (produce, meat), high expiry turnover.
- **Capability needs.** Fast item lookup by barcode/partial name, scale-barcode parsing,
  FEFO picking, expiry write-off workflow, promotions (multi-price), tight count cycles.
- **Key modules emphasized.** `pos` (scale integration via barcode parsing), `items`
  (categories, UoM, price lists), `inventory` (batches/expiry), `reporting` (expiry report,
  margin by category).
- **Example workflows.** Workflow §1 (POS), §4 (rolling counts on categories), expiry
  write-off per [../accounting/INVENTORY_ACCOUNTING.md](../accounting/INVENTORY_ACCOUNTING.md) §5.
- **Manifest pointer.** [../industries/templates/](../industries/templates/) — actual manifest at
  [../industries/templates/grocery-supermarket.md](../industries/templates/grocery-supermarket.md) (embedded) and
  [../industries/templates/manifests/manifest.grocery.json](../industries/templates/manifests/manifest.grocery.json) (extracted machine form, id `industry.grocery`).

## 3. `industry.restaurant` — Restaurant / café · قالب المطاعم والمقاهي

- **Target businesses.** Restaurants, cafés, bakeries, buffets: high ticket volume, small
  item count, daily stock of perishables, cash + card mix.
- **Capability needs.** Sub-second POS, order/shift handover, purchase by recipe
  (kitchen-level BOM lite), waste/expiry recording, daily cash close.
- **Key modules emphasized.** `pos`, `inventory.batch_tracking`, `treasury.cashier_shifts`,
  `items.composite_products` (combo meals), `purchasing` (supplier invoices with weight
  capture).
- **Example workflows.** Workflow §1, §9; Journey B; production-lite via composites (full
  production belongs to `industry.food_manufacturing`).
- **Manifest pointer.** [../industries/templates/](../industries/templates/) — actual manifest at
  [../industries/templates/restaurant-cafe.md](../industries/templates/restaurant-cafe.md) (embedded) and
  [../industries/templates/manifests/manifest.restaurant.json](../industries/templates/manifests/manifest.restaurant.json) (extracted machine form, id `industry.restaurant`).

## 4. `industry.automotive` — Automotive / workshop · قالب السيارات والورش

- **Target businesses.** Tire shops, spare-parts dealers, repair workshops, service centers
  — frequently parts + labor in one invoice (PHASE-017 **SHIPPED**, per
  [../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md)).
- **Capability needs.** Job cards (work orders) consuming parts and labor, serial/IMEI
  where applicable, per-vehicle service history, supplier special-order flows.
- **Key modules emphasized.** `sales.job_cards` (the work-order document — shipped 017;
  `crm.service_orders` is the PHASE-019 generalization), `inventory.serial_tracking`,
  `items.item_master` (fitment attributes via categories), `purchasing`,
  `accounting.cost_centers` (per-bay profitability).
- **Example workflows.** Job-card: service order → parts issue → labor lines → invoice
  (variant of Workflow §2 with service lines); Workflow §8 feeding maintenance contracts.
- **Manifest pointer.** [../industries/templates/](../industries/templates/) — actual manifest at
  [../industries/templates/automotive-workshop.md](../industries/templates/automotive-workshop.md) (embedded) and
  [../industries/templates/manifests/manifest.automotive.json](../industries/templates/manifests/manifest.automotive.json) (extracted machine form, id `industry.automotive`).

## 5. `industry.distribution` — Distribution / field sales · قالب التوزيع

- **Target businesses.** Beverage/snack/household distributors with van fleets, credit
  routes, and rep commissions (PHASE-017 **SHIPPED**).
- **Capability needs.** Van stock accountability, route planning, offline selling and
  collecting (PHASE-022), free-goods promotions, settlements, customer tiers, credit
  discipline at scale.
- **Key modules emphasized.** `distribution.*` (routes, van stock, settlements, tiers, free
  goods), `sales` (credit limits, reps, commissions), `offline.android_app`, `treasury`
  (collections).
- **Example workflows.** Workflow §7 (van-sales settlement); [USER_JOURNEYS.md](USER_JOURNEYS.md)
  Journey G.
- **Manifest pointer.** [../industries/templates/](../industries/templates/) — actual manifest at
  [../industries/templates/distribution-field-sales.md](../industries/templates/distribution-field-sales.md) (embedded) and
  [../industries/templates/manifests/manifest.distribution.json](../industries/templates/manifests/manifest.distribution.json) (extracted machine form, id `industry.distribution`).

## 6. `industry.food_manufacturing` — Food manufacturing · قالب التصنيع الغذائي

- **Target businesses.** Bakeries, dairy, packaged-food producers — BOM-driven production
  with batch traceability and expiry. **SHIPPED with PHASE-018 (2026-11-03)** — seeded at
  v1.0.0 by migration `0026_manufacturing.sql`, live on business/enterprise, and applying
  through the unmodified PHASE-015 engine.
- **Capability needs.** BOM versioning, production orders with WIP costing, batch
  genealogy for recall, expiry management, QC intake checks, scrap/waste posting.
- **Key modules emphasized.** `manufacturing.*` (BOM, production orders, WIP, costing,
  scrap, genealogy, QC), `inventory.batch_tracking`, `purchasing.landed_costs`.
- **Example workflows.** Workflow §6 (production run); batch genealogy from consumed to
  produced batches; expiry write-off.
- **Manifest pointer.** [../industries/templates/](../industries/templates/) — actual manifest at
  [../industries/templates/food-manufacturing.md](../industries/templates/food-manufacturing.md) (embedded) and
  [../industries/templates/manifests/manifest.food_manufacturing.json](../industries/templates/manifests/manifest.food_manufacturing.json) (extracted machine form, id `industry.food_manufacturing`).

## 7. `industry.professional_services` — Professional services · قالب الخدمات المهنية

- **Target businesses.** Law offices, engineering consultants, marketing agencies,
  maintenance contractors — selling time and recurring service (PHASE-019).
- **Capability needs.** Contracts with billing schedules, recurring invoices, project/cost-
  center profitability, service orders for deliverables, minimal stock (consumables).
- **Key modules emphasized.** `crm.*` (contracts, recurring billing, service orders),
  `accounting.projects`, `accounting.cost_centers`, `sales.invoices` (time/expense lines).
- **Example workflows.** Workflow §8 (service contract billing); expense claims (Journey F)
  tagged to projects.
- **Manifest pointer.** [../industries/templates/](../industries/templates/) — actual manifest at
  [../industries/templates/professional-services.md](../industries/templates/professional-services.md) (embedded) and
  [../industries/templates/manifests/manifest.professional_services.json](../industries/templates/manifests/manifest.professional_services.json) (extracted machine form, id `industry.professional_services`).

## 8. `industry.rental_logistics` — Rental / logistics · قالب التأجير واللوجستيات

- **Target businesses.** Car/equipment rental, freight agencies, storage providers —
  contracts, deposits, and availability-driven operations. **SHIPPED with the delivery
  completion (post-034)** — seeded at v1.0.0 by migration `0047_industry_rental_logistics.sql`
  (data-only), live on business/enterprise, and applying through the unmodified PHASE-015
  engine; the framework was available from PHASE-015, the shell composed at the completion.
- **Capability needs.** Rental contracts with periodic billing and return workflows,
  deposit handling, asset-level availability (serials), shipment/consignment tracking
  basics.
- **Key modules emphasized.** `crm.service_contracts` (rental terms), `crm.recurring_billing`,
  `inventory.serial_tracking` (asset units — the fleet), `treasury` (deposit handling via on-account
  amounts, BR-027), `items.item_master` (rental SKUs with own UoM semantics), and the live
  distribution routes/settlements pair (the shipment status board).
- **Example workflows.** Workflow §8 (contract billing) + return/inspection variant of
  Workflow §4 (condition counts); deposit apply against final invoice.
- **Manifest pointer.** [../industries/templates/](../industries/templates/) — actual manifest at
  [../industries/templates/rental-logistics.md](../industries/templates/rental-logistics.md) (embedded) and
  [../industries/templates/manifests/manifest.rental_logistics.json](../industries/templates/manifests/manifest.rental_logistics.json) (extracted machine form, id `industry.rental_logistics`).

## 9. `industry.wholesale` — Wholesale & trade · قالب الجملة والتجارة

- **Target businesses.** Wholesale shops, importers, B2B trading houses, cash-and-carry
  operators selling to retailers on credit terms (PHASE-030; ED-06). **SHIPPED with
  PHASE-030 (2026-11-08)** — seeded at v1.0.0 by the data-only migration
  `0041_industry_wholesale_electronics.sql`, applying through the unmodified PHASE-015
  engine on pre-granted keys (zero new feature keys — see
  [FEATURE_CATALOG.md](FEATURE_CATALOG.md) §18).
- **Capability needs.** Quantity-break price tiers (`price_list_items.min_qty`) and
  customer price tiers, credit-first trading with credit limits + statements, bulk
  quick-order entry from quotes, goods-receipt intake for imports, PDC notes for
  receivables.
- **Key modules emphasized.** `items` (barcodes, price lists with qty breaks), `partners`
  (credit terms, statements), `sales` (quote → order → delivery → credit invoice chain,
  credit limits), `purchasing` (goods receipts), `inventory` (multi-warehouse), `notes`
  (PDC custody + maturity calendar, PHASE-027).
- **Example workflows.** Order-to-cash **credit variant** (Workflow §2) quote→bulk
  order→delivery→credit invoice→statement; PDC note lifecycle (Workflow §10, v2.0) for
  collection.
- **Manifest pointer.** [../industries/templates/wholesale.md](../industries/templates/wholesale.md)
  (embedded) and
  [../industries/templates/manifests/manifest.wholesale.json](../industries/templates/manifests/manifest.wholesale.json)
  (extracted machine form, id `industry.wholesale`).
- **Terminology examples.** العملاء/التجار for customers; فاتورة بيع جملة for the
  wholesale sales invoice; سند قبض for the receipt voucher; شيك مؤجل for post-dated notes.

## 10. `industry.electronics` — Mobile & electronics · قالب الجوالات والإلكترونيات

- **Target businesses.** Mobile shops, electronics retailers, accessories + repair
  combos (PHASE-030; ED-06). **SHIPPED with PHASE-030 (2026-11-08)** — seeded at v1.0.0
  by the data-only migration `0041_industry_wholesale_electronics.sql`, applying through
  the unmodified PHASE-015 engine on pre-granted keys (zero new feature keys — see
  [FEATURE_CATALOG.md](FEATURE_CATALOG.md) §18).
- **Capability needs.** IMEI-level serial register (capture at GRN and sale), repair job
  cards consuming parts + labor (`crm.service_orders`), POS counter selling, trade-in
  purchases of used devices at branch, warranty claim tracking via service orders.
- **Key modules emphasized.** `inventory.serial_tracking` (IMEI register), `pos`
  (terminals, sales, receipts), `crm.service_orders` (repair cards), `items` (barcodes,
  price lists, composite bundles), `purchasing` (trade-in GRN of used goods).
- **Example workflows.** Repair job card → parts issue → labor lines → invoice — the
  automotive job-card flow (Workflow §2 variant) over service orders; counter flow per
  Journey B ([USER_JOURNEYS.md](USER_JOURNEYS.md)).
- **Manifest pointer.** [../industries/templates/electronics.md](../industries/templates/electronics.md)
  (embedded) and
  [../industries/templates/manifests/manifest.electronics.json](../industries/templates/manifests/manifest.electronics.json)
  (extracted machine form, id `industry.electronics`).
- **Terminology examples.** بيع بالتجزئة (retail sale), صيانة/إصلاح (repair), بطاقة
  صيانة (repair card), سجل الأجهزة (IMEI register).

## 11. `industry.healthcare` — Healthcare commercial shell · قالب الرعاية الصحية

- **Target businesses.** Clinics, medical centers, small hospitals' **commercial back
  office**, pharmacies (PHASE-031; ED-07 — financial layer only).
- **Capability needs.** Patient-as-partner **financial** file (no clinical data — ED-07
  explicit), insurance-company claims as partner open items with per-claim tracking
  (claim ref on invoice/receipt), pharmacy FEFO batches, dunning by claim, claims settled
  by cheque/PDC.
- **Key modules emphasized.** `partners` (patient + insurer files, statements), `sales`
  (invoices with claim refs, per-insurer credit limits), `crm.service_orders` (visit
  billing), `inventory.batch_tracking` (pharmacy expiry), `notes` (claims cheques/PDC,
  PHASE-027).
- **Example workflows.** Visit → invoice (patient or insurance) → claim open item →
  PDC/collection → aging by claim (Workflow §2 credit chain + Workflow §10 note
  lifecycle, v2.0).
- **Manifest pointer.** [../industries/templates/healthcare.md](../industries/templates/healthcare.md)
  (embedded) and
  [../industries/templates/manifests/manifest.healthcare.json](../industries/templates/manifests/manifest.healthcare.json)
  (extracted machine form, id `industry.healthcare`).
- **Terminology examples.** المريض (financial file), شركة التأمين (insurer), مطالبة
  تأمينية (claim), صيدلية (pharmacy).

## 12. `industry.education` — Education commercial shell · قالب التعليم

- **Target businesses.** Private schools, training centers, tutoring businesses
  (PHASE-032; ED-08 — commercial layer only).
- **Capability needs.** Tuition fee schedules per program/grade (price lists over
  services), semester/monthly installment plans (BR-048/049), sibling/multi-child discounts
  (discount policies on lines), late-fee dunning cycles, guardian as the paying partner.
- **Key modules emphasized.** `crm.service_contracts` (enrollment/year contracts),
  `installments` (plans, collections, late fees — PHASE-027), `sales.invoices` (tuition),
  `items.item_master` + `items.price_lists` (fee schedules), `treasury` (receipts).
- **Example workflows.** Enrollment contract → tuition invoice → installment plan →
  due/collect → late fee (Workflow §12 installment sale & collection + §8-style
  recurring billing, v2.0).
- **Manifest pointer.** [../industries/templates/education.md](../industries/templates/education.md)
  (embedded) and
  [../industries/templates/manifests/manifest.education.json](../industries/templates/manifests/manifest.education.json)
  (extracted machine form, id `industry.education`).
- **Terminology examples.** الطالب/ولي الأمر (financial), الرسوم الدراسية (tuition),
  القسط (installment), خصم الأشقاء (sibling discount).

## 13. `industry.agriculture` — Agriculture commercial shell · قالب الزراعة

- **Target businesses.** Farms, agri-traders, livestock operations, greenhouses
  (PHASE-033; ED-09 — commercial layer only).
- **Capability needs.** Crop-cycle costing via BOM + production order per field/project
  (seeds/feed/labor inputs → harvest batch WAC), harvest batch genealogy
  (`batch_genealogy` reuse), livestock as serial-tracked items (head level), per-field
  profitability via projects.
- **Key modules emphasized.** `manufacturing.bom` + `manufacturing.production_orders`
  (crop-cycle recipes and runs), `inventory.batch_tracking` (harvest batches) and
  `inventory.serial_tracking` (livestock heads, OPT), `purchasing` (supplies/feed),
  `sales.invoices` (produce), `accounting.projects` + `accounting.cost_centers`
  (per-field/per-crop costing).
- **Example workflows.** Season setup (project/BOM) → input purchases → production run →
  harvest batch intake → sales (Workflow §6 production run + Workflow §11 note: no
  agriculture-specific asset flow exists — farm machinery follows the generic fixed-asset
  lifecycle at PHASE-026).
- **Manifest pointer.** [../industries/templates/agriculture.md](../industries/templates/agriculture.md)
  (embedded) and
  [../industries/templates/manifests/manifest.agriculture.json](../industries/templates/manifests/manifest.agriculture.json)
  (extracted machine form, id `industry.agriculture`).
- **Terminology examples.** المحصول (crop), الدورة الزراعية (crop cycle), الحصاد
  (harvest), المزرعة/الحقل (farm/field).

## How templates relate to the rest of the blueprint

1. **A template never changes accounting** — it re-uses the identical posting engine and
   invariants (INV-022). It selects defaults (policies from [BUSINESS_RULES.md](BUSINESS_RULES.md)),
   menu emphasis, terminology (Arabic-first), and report packs.
2. **A template never grants features by itself** — entitlements come from the plan and
   add-ons ([SUBSCRIPTION_AND_ENTITLEMENTS.md](SUBSCRIPTION_AND_ENTITLEMENTS.md)); a
   template applied without its feature keys degrades gracefully (menus hide, defaults
   queue) rather than erroring.
3. **Switching is additive-only** (BR-038) and runs the compatibility checks in
   [CONFIGURATION_ENGINE.md](CONFIGURATION_ENGINE.md) §6 — e.g., switching
   `industry.restaurant` → `industry.food_manufacturing` adds production menus without
   touching POS history.
4. **Hospitals, schools, and agriculture now have commercial-shell templates**
   (`industry.healthcare` PHASE-031, `industry.education` PHASE-032,
   `industry.agriculture` PHASE-033) covering their financial/commercial layer — patient
   billing & claims, tuition & installments, crop costing — while their **deep
   operational verticals (HIS clinical, LMS academic, agronomy operations) remain
   non-goals until a decision record adds them** (ED-11;
   [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md);
   [../decisions/product/DR-003-platform-expansion-v2.md](../decisions/product/DR-003-platform-expansion-v2.md));
   the framework must make adding them possible without core changes.
