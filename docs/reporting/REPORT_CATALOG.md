# Report Catalog

> **Status:** STABLE · **Owner:** Reporting Architecture · **Updated:** 2026-11-02

Inventory of every core report, grouped by domain, with **provenance** (source of truth:
module service + owned tables), key parameters, required permission, export formats, and
the phase that delivers it. Directive STEP 9 rule: **a report without a declared source of
truth cannot exist** — the registry boot-check enforces it
([REPORTING_ARCHITECTURE.md](REPORTING_ARCHITECTURE.md) §2), and each contract is fully
specified per [REPORT_CONTRACT.md](REPORT_CONTRACT.md).

Conventions: **Perms** are minimum read permissions (branch-scoped grants intersect —
[REPORTING_ARCHITECTURE.md](REPORTING_ARCHITECTURE.md) §4). **Exports** lists formats;
PDF uses the `a4-report` template unless noted. **Phase** = delivery phase
([../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md)); reports registered
earlier than their data phases do not exist — reporting needs real data
(PHASE-013 rationale).

## 0. Catalog map

```mermaid
flowchart LR
  R["Report catalog<br/>(registry, PHASE-013 engine)"] --> F["Financial statements §1<br/>TB · GL · IS · BS · CF · close pack"]
  R --> AA["AR/AP §2<br/>aging · statements · allocations"]
  R --> SP["Sales & purchasing §3<br/>by item/customer/rep/branch · profitability"]
  R --> I["Inventory §4<br/>on hand · movement · valuation · expiry"]
  R --> T["Treasury §5<br/>daily cash · registers · shifts"]
  R --> X["Tax §6<br/>VAT return · treatments · e-invoice log"]
  R --> P["Platform §7<br/>audit · activity · runs · usage"]
  R -. "namespaced extension" .-> IND["Industry reports §8<br/>industries templates"]
  R --> F2["Financial depth §9<br/>assets · notes · installments · budgets · payroll"]
  R --> C["Consolidation §10<br/>consolidated TB/IS/BS · eliminations"]
  F --> AC["accounting module query services"]
  SP --> SALES["sales · purchasing · inventory query services"]
  T --> TR["treasury query services"]
  X --> TAX["tax summaries + GL tie"]
  F2 --> FD["fixed_assets · notes · installments · budgeting · payroll query services"]
  C --> CONS["consolidation runs + member GL read models"]
```

All arrows to modules mean *authorized query service calls* — the reporting module owns
no business tables ([REPORTING_ARCHITECTURE.md](REPORTING_ARCHITECTURE.md) §1).

## 1. Financial statements (المحاسبة — القوائم المالية)

Derived exclusively from posted journal lines + documented rules
([FINANCIAL_REPORT_RULES.md](FINANCIAL_REPORT_RULES.md)); all run **as-of** with
block-on-fail assertions ([REPORT_RECONCILIATION.md](REPORT_RECONCILIATION.md)).

| Report key | Title (EN / AR) | Source of truth (module · service · tables) | Key parameters | Perm | Exports | Phase |
|------------|------------------|---------------------------------------------|----------------|------|---------|-------|
| `financial.trial-balance` | Trial Balance / ميزان المراجعة | accounting · `glQueries.periodMovementAndBalances` · journal_entries, journal_lines, accounts | dateFrom/To, asOf, branches, grouping (type), zero-suppression, opening balances | `reports.financial.tb.read` | PDF · XLSX · CSV | PHASE-013 |
| `financial.general-ledger` | General Ledger / دفتر الأستاذ العام | accounting · `glQueries.accountLedger` · journal_entries, journal_lines, accounts, cost_centers | account(s), dateFrom/To, asOf, branches, cost-center filter | `reports.financial.gl.read` | PDF · XLSX · CSV | PHASE-013 |
| `financial.income-statement` | Income Statement / قائمة الدخل | accounting · `statementQueries.incomeStatement` · journal_lines, accounts, fiscal_periods | period (fiscal month/quarter/year), asOf, branches, comparative period toggle | `reports.financial.is.read` | PDF · XLSX · CSV | PHASE-013 |
| `financial.balance-sheet` | Balance Sheet / قائمة المركز المالي | accounting · `statementQueries.balanceSheet` · journal_lines, accounts, fiscal_periods | asOf date, branches, comparative prior year toggle | `reports.financial.bs.read` | PDF · XLSX · CSV | PHASE-013 |
| `financial.cash-flow` | Cash Flow Statement / قائمة التدفقات النقدية | accounting · `statementQueries.cashFlow` (indirect) · journal_lines, accounts, fiscal_periods | period, asOf, branches | `reports.financial.cf.read` | PDF · XLSX · CSV | PHASE-013 |
| `financial.fiscal-close-pack` | Period Close Pack / حزمة إقفال الفترة | accounting+reporting · renders the five above for a locked period | fiscal period, branches | `reports.financial.close.read` | PDF (PDF/A) · XLSX | PHASE-013 |
| `accounting.journal-register` | Journal Register / دفتر اليومية | accounting · `glQueries.journalRegister` · journal_entries, journal_lines | dateFrom/To, branches, entry-type filter, source-type filter | `accounting.journals.read` | PDF · XLSX · CSV | PHASE-007 |
| `accounting.cost-centers` | Cost Center Analysis / تحليل مراكز التكلفة | accounting · `glQueries.costCenterBreakdown` · journal_lines, cost_centers | period, branches, cost centers | `reports.accounting.cost-centers.read` | PDF · XLSX · CSV | PHASE-013 |

## 2. AR / AP (الذمم — العملاء والموردون)

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `ar.aging` | AR Aging / أعمار المدينين | sales · `arQueries.aging` · sales_invoices, credit_notes, receipts, allocations (with partners subledger) | asOf, buckets (30/60/90/120 default), branches, partner filter | `reports.ar.aging.read` | PDF · XLSX · CSV | PHASE-012 |
| `ap.aging` | AP Aging / أعمار الدائنين | purchasing · `apQueries.aging` · supplier_invoices, debit_notes, payments, allocations | asOf, buckets, branches, partner filter | `reports.ap.aging.read` | PDF · XLSX · CSV | PHASE-011 |
| `partner.statement` | Customer Statement / كشف حساب العميل | sales+partners · `arQueries.partnerStatement` · AR documents + allocations | partnerId, dateFrom/To, asOf, aging summary toggle | `sales.statements.read` | PDF (`a4-document`) · XLSX · CSV | PHASE-012 |
| `supplier.statement` | Supplier Statement / كشف حساب المورد | purchasing+partners · `apQueries.partnerStatement` · AP documents + allocations | partnerId, dateFrom/To, asOf | `purchasing.statements.read` | PDF (`a4-document`) · XLSX · CSV | PHASE-011 |
| `ar.allocations` | Allocations Report / التخصيصات | sales · `arQueries.allocations` + purchasing `apQueries.allocations` · receipts, payments, allocations | dateFrom/To, partner, document | `reports.ar-alloc.read` | XLSX · CSV | PHASE-012 |
| `partner.balances` | Partner Balances / أرصدة الجهات | partners · `partnerQueries.balances` (subledger sums) · partner_balances, journal-derived | asOf, role (customer/supplier), branch, credit-limit flag | `partners.balances.read` | XLSX · CSV | PHASE-006 |

Notes: aging and statements **recompute from immutable entries at the as-of date**
(deterministic re-runs, [../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md)
§2); statement rows drill to source documents; `partner.balances` ties to AR/AP control
accounts via INV-009 assertion displayed as a footer badge.

## 3. Sales & purchasing (المبيعات والمشتريات)

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `sales.by-item` | Sales by Item / المبيعات حسب الصنف | sales · `salesAnalytics.itemRevenue` + inventory `valuationQueries.cogsByItem` | period, branches, warehouses, category, reps, currency(base/doc) | `reports.sales.by-item.read` | PDF · XLSX · CSV | PHASE-013 |
| `sales.by-customer` | Sales by Customer / المبيعات حسب العميل | sales · `salesAnalytics.customerRevenue` + partners lookup | period, branches, customer tiers (PHASE-017), reps | `reports.sales.by-customer.read` | PDF · XLSX · CSV | PHASE-013 |
| `sales.by-rep` | Sales by Rep / المبيعات حسب المندوب | sales · `salesAnalytics.repRevenue` · sales invoices + rep attribution | period, branches, reps | `reports.sales.by-rep.read` | PDF · XLSX · CSV | PHASE-013 |
| `sales.by-payment-method` | Sales by Payment Method / المبيعات حسب طريقة الدفع | sales+treasury · `salesAnalytics.paymentMethodSplit` · sales_invoices, receipts | period, branches, methods (cash/card/transfer) | `reports.sales.by-paymethod.read` | PDF · XLSX · CSV | PHASE-013 |
| `sales.document-flow` | Sales Document Flow / حركة مستندات البيع | sales · `salesAnalytics.pipelineConversion` · quotations, sales_orders, delivery_notes, sales_invoices | period, branches, rep, conversion stage filter | `reports.sales.pipeline.read` | XLSX · CSV | PHASE-013 |
| `sales.by-branch` | Sales by Branch / المبيعات حسب الفرع | sales · `salesAnalytics.branchRevenue` | period, branch consolidation | `reports.sales.by-branch.read` | PDF · XLSX · CSV | PHASE-013 |
| `sales.profitability` | Profitability / الربحية | sales + inventory · revenue minus COGS by item/customer/rep/branch | period, dimension, branches | `reports.sales.profitability.read` | PDF · XLSX · CSV | PHASE-013 |
| `sales.commissions_due` | Commissions Due / العمولات المستحقة | sales · `distributionQueries.commissionsDue` · sales_reps + commission runs/lines (registered as the §8 PHASE-017 industry contract; total tied to the accrual journals) | period, reps | `reports.sales.by-rep.read` | PDF · XLSX · CSV | PHASE-017 |
| `purchasing.by-supplier` | Purchases by Supplier / المشتريات حسب المورد | purchasing · `apAnalytics.supplierSpend` · supplier_invoices + lines | period, branches, suppliers | `reports.purchasing.by-supplier.read` | PDF · XLSX · CSV | PHASE-013 |
| `purchasing.by-item` | Purchases by Item / المشتريات حسب الصنف | purchasing · `apAnalytics.itemSpend` | period, branches, categories | `reports.purchasing.by-item.read` | PDF · XLSX · CSV | PHASE-013 |
| `purchasing.grni` | GRNI Register / سجل المستلم غير المفوتر | purchasing · `matchingQueries.grniRegister` · goods_receipts vs supplier_invoices | asOf, branches, suppliers | `reports.purchasing.grni.read` | XLSX · CSV | PHASE-011 |
| `purchasing.po-status` | Purchase Order Status / حالة أوامر الشراء | purchasing · `poQueries.statusBoard` · purchase_orders, goods_receipts, supplier_invoices | dateFrom/To, branches, suppliers, open-only | `purchasing.po.read` | XLSX · CSV | PHASE-011 |
| `purchasing.matching-exceptions` | Three-Way Match Exceptions / استثناءات المطابقة الثلاثية | purchasing · `matchingQueries.exceptions` · order/receipt/invoice comparison results | dateFrom/To, branches, exception type (price/qty/missing) | `reports.purchasing.matching.read` | XLSX · CSV | PHASE-011 |

Operational revenue reports carry a `sales-gl-tie` assertion (net+tax vs GL revenue/VAT
movements for the same scope) — see worked example in
[REPORT_CONTRACT.md](REPORT_CONTRACT.md) §4.

## 4. Inventory (المخزون)

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `inventory.stock-on-hand` | Stock on Hand / المخزون المتوفر | inventory · `stockQueries.onHand` · stock_moves, stock_layers, warehouses | asOf, branches, warehouses, category, only-negative, valuation method view | `inventory.stock.read` | PDF · XLSX · CSV | PHASE-010 |
| `inventory.movement` | Stock Movement / حركة المخزون | inventory · `stockQueries.movement` · stock_moves (+ sources via provenance) | dateFrom/To, warehouses, items, move reasons, batch filter | `inventory.moves.read` | PDF · XLSX · CSV | PHASE-010 |
| `inventory.valuation` | Inventory Valuation / تقييم المخزون | inventory · `valuationQueries.itemValuation` · stock_layers (WAC/FIFO) | asOf, warehouses, method, include WIP | `inventory.valuation.read` | PDF · XLSX · CSV | PHASE-010 |
| `inventory.expiry` | Expiry Report / تقرير الانتهاء (الصلاحية) | inventory · `batchQueries.expiry` · item_batches | asOf, warehouses, days-to-expiry buckets, category | `inventory.batches.read` | PDF · XLSX · CSV | PHASE-010 |
| `inventory.count-variance` | Count Variance / فروقات الجرد | inventory · `countQueries.variance` · stock_counts (+ adjustment journals via provenance) | count session, warehouse, variance threshold | `inventory.counts.read` | PDF · XLSX · CSV | PHASE-010 |
| `inventory.slow-moving` | Slow-Moving Stock / المخزون الراكد | inventory · `stockQueries.turnover` | asOf, no-sale days threshold, warehouses | `inventory.stock.read` | XLSX · CSV | PHASE-013 |
| `inventory.transfer-log` | Stock Transfer Log / سجل التحويلات | inventory · `stockQueries.transferLog` · stock_transfers, stock_moves | dateFrom/To, from/to warehouses, status (in-transit/posted) | `inventory.moves.read` | PDF · XLSX · CSV | PHASE-010 |
| `inventory.serial-tracking` | Serial / IMEI Tracking / تتبع المسلسلات و IMEI | inventory · `serialQueries.tracking` · item_serials (+ sale/purchase provenance) | serial/IMEI exact match or item+date range | `inventory.serials.read` | XLSX · CSV | PHASE-010 |

Valuation and stock-on-hand reports assert INV-010 (Σ qty×valuation = inventory account)
and display the check result in the footer ([REPORT_RECONCILIATION.md](REPORT_RECONCILIATION.md)).

## 5. Treasury (الخزينة)

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `treasury.daily-cash` | Daily Cash Flow / الحركة النقدية اليومية | treasury · `cashQueries.dailyFlow` · cash_accounts movements (+ posted journals) | date, branch, account(s), opening/closing toggle | `treasury.cash.read` | PDF · XLSX · CSV | PHASE-008 |
| `treasury.receipts-register` | Receipts Register / سجل سندات القبض | treasury+sales · `cashQueries.receiptsRegister` · receipts (+ allocations) | dateFrom/To, branches, cashiers, payment methods, partner | `treasury.receipts.read` | PDF · XLSX · CSV | PHASE-008 |
| `treasury.payments-register` | Payments Register / سجل سندات الصرف | treasury+purchasing · `cashQueries.paymentsRegister` · payments (+ allocations) | dateFrom/To, branches, payees, accounts | `treasury.payments.read` | PDF · XLSX · CSV | PHASE-008 |
| `treasury.petty-cash` | Petty Cash Analysis / تحليل الصندوق الصغير | treasury · `expenseQueries.pettyCash` · expenses, cash_transfers (petty fund scope) | period, branches, funds, expense categories | `treasury.petty.read` | PDF · XLSX · CSV | PHASE-008 |
| `treasury.fx-differences` | FX Differences / فروق العملات | accounting+treasury · `glQueries.fxDifferenceLines` · journal_lines (FX purposes) | period, branches, currencies | `reports.treasury.fx.read` | PDF · XLSX · CSV | PHASE-008 |
| `treasury.expenses` | Expenses Analysis / تحليل المصروفات | treasury · `expenseQueries.analysis` · expenses (+ GL expense accounts) | period, branches, expense categories, cost centers | `treasury.expenses.read` | PDF · XLSX · CSV | PHASE-008 |
| `treasury.shifts` | Shifts Report / تقرير الورديات | treasury · `shiftQueries.history` · cashier_shifts (+ receipts/payments) | dateFrom/To, branches, cashiers, variance filter | `treasury.shifts.read` | PDF · XLSX · CSV | PHASE-008 |
| `treasury.bank-recon` | Bank Reconciliation Status / حالة التسوية البنكية | treasury · `bankRecQueries.status` · bank_reconciliations | period, bank account, matched/unmatched filter | `treasury.bankrec.read` | XLSX · CSV | PHASE-008 |

Cash reports assert INV-019 (account balance = Σ movements) per account in scope.

## 6. Tax (الضرائب — per jurisdiction)

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `tax.vat-return` | VAT Return / الإقرار الضريبي | tax · `returnQueries.vatReturn` · document tax summaries + GL tax accounts (INV-012 tie) | jurisdiction, period, registration, output/input breakdown by treatment | `reports.tax.vat-return.read` | PDF · XLSX · CSV | PHASE-009 |
| `tax.summary-by-treatment` | Sales/Purchases by Tax Treatment / الملخص حسب المعاملة الضريبية | tax · `taxQueries.byTreatment` + sales/purchasing analytics | period, branches, direction (sales/purchases) | `reports.tax.summary.read` | XLSX · CSV | PHASE-009 |
| `tax.e-invoicing-log` | E-Invoicing Submission Log / سجل الفوترة الإلكترونية | tax · `eInvoicingQueries.submissions` · e_invoicing_submissions | period, status (cleared/reported/failed), adapter | `reports.tax.einvoice-log.read` | XLSX · CSV | PHASE-023 |

The VAT return renders both sides (document summaries vs GL movements) side-by-side; a
mismatch marks the draft "unfileable" ([../accounting/RECONCILIATION.md](../accounting/RECONCILIATION.md)
§5) — the platform reports; humans file.

## 7. Platform administration (المنصة)

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `platform.audit-trail` | Audit Trail / سجل التدقيق | audit · `auditQueries.search` · audit_events | dateFrom/To, actor, entity type/id, correlation id | `platform.audit.read` | XLSX · CSV | PHASE-003 |
| `platform.user-activity` | User Activity / نشاط المستخدمين | identity+audit · `userQueries.activity` · sessions, audit_events | period, users, branch | `platform.users.read` | XLSX · CSV | PHASE-003 |
| `platform.report-runs` | Report Runs History / سجل تشغيل التقارير | reporting · `runQueries.history` · report_runs | period, user, report, status | `platform.reporting.read` | XLSX · CSV | PHASE-013 |
| `platform.subscription-usage` | Subscription Usage / استخدام الاشتراك | tenancy · `subscriptionQueries.usage` · subscriptions, entitlements | period, tenant (platform admin scope) | `platform.tenants.read` | XLSX · CSV | PHASE-004/014 |

## 8. Industry reports (extension point)

Industry templates add template-namespaced reports under
`industries/<template>/reports/`, following the same contract and registry
rules ([REPORTING_ARCHITECTURE.md](REPORTING_ARCHITECTURE.md) §2) — e.g., restaurant
day-part sales, automotive job-card margin, distribution route productivity,
manufacturing batch costing (PHASE-018). Pointer:
[../industries/reports/](../industries/reports/) (maintained by the industry templates
phase; contracts land with their templates). Core modules remain the source of truth —
industry reports may only query through the same module query services plus their own
industry tables.

**Shipped (PHASE-015, category `industry`)** — the first three contracts registered over
the PHASE-013 engine; the priority-template manifests pin these exact keys
(`inventory.expiry_list` + `grocery.expiry_writeoff` by grocery/restaurant,
`retail.imei_register` by retail):

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `inventory.expiry_list` | Expiry List (Age Buckets) / قائمة الصلاحية (الفئات العمرية) | inventory · `industryInventoryQueries.expiryList` · item_batches, stock_moves, items, warehouses | asOf, warehouses, bucket days (default 7/30/60) | `inventory.stock.read` | PDF · XLSX · CSV | PHASE-015 |
| `grocery.expiry_writeoff` | Expiry / Damage Write-off Register / سجل شطب المنتهي والتالف | inventory · `industryInventoryQueries.writeoffRegister` + accounting write-off GL tie · stock_moves, stock_adjustments, item_batches, items, warehouses, journal_lines | dateFrom/To, warehouses | `inventory.moves.read` | PDF · XLSX · CSV | PHASE-015 |
| `retail.imei_register` | IMEI Register (In/Out Ledger) / سجل أجهزة IMEI (الدخول/الخروج) | inventory · `industryInventoryQueries.imeiRegister` + purchasing/sales linkage · item_serials, stock_moves, items, goods_receipts, sales_invoices, credit_notes | dateFrom/To (goods-in date), item | `inventory.serials.read` | PDF · XLSX · CSV | PHASE-015 |

Notes: `inventory.expiry_list` carries the `inv010-stock-tie` assertion (Σ on-hand value
= inventory GL account, INV-010); `grocery.expiry_writeoff` carries the
`writeoff-gl-tie` assertion (register totals = INVENTORY_SHRINKAGE journal debits,
INV-010/018); `retail.imei_register` asserts the per-device in/out ledger consistency
(INV-018) and drills to the source GRN, sales invoice, and return credit note.

**Shipped (PHASE-016, categories `sales`/`treasury`)** — the POS report set the Z
report reconciles against; the two sales reports carry the `pos-gl-tie` assertion
(Σ POS invoice gross = GL movements of the same postings):

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `pos.sales_by_terminal` | POS Sales by Terminal / مبيعات نقاط البيع حسب الجهاز | pos · `posQueries.salesByTerminal` · sales_invoices, pos_terminals | dateFrom/To, branchIds | `reports.sales.by-branch.read` | PDF · XLSX · CSV | PHASE-016 |
| `pos.sales_by_hour` | POS Sales by Hour / مبيعات نقاط البيع حسب الساعة | pos · `posQueries.salesByHour` · sales_invoices | dateFrom/To, branchIds | `reports.sales.by-branch.read` | PDF · XLSX · CSV | PHASE-016 |
| `treasury.shift_cash_reconciliation` | Shift Cash Reconciliation / تسوية نقدية الورديات | treasury · `posQueries.shiftCashReconciliation` · cashier_shifts, sales_invoices, pos_terminals (BR-021 variance vs the POS gross through the till) | dateFrom/To | `reports.treasury.fx.read` | PDF · XLSX · CSV | PHASE-016 |

The two catalogued restaurant analytics rows (`restaurant.sales_by_table`,
`restaurant.order_type_mix` — [../industries/reports/README.md](../industries/reports/README.md))
are NOT in the shipped 016 registry set (honest note there).

**Shipped (PHASE-017, category `industry`)** — the seven automotive / distribution /
commissions contracts over the PHASE-013 engine (registry 56 → 63; all reuse existing
permission keys — no new report permissions); the automotive + distribution template
manifests pin the exact keys:

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `automotive.job_card_profitability` | Job Card Profitability / ربحية بطاقات العمل | sales · `automotiveQueries.jobCardProfitability` · job_cards + lines with posted invoice-line snapshots (netted by warranty re-entry) | dateFrom/To, branchIds | `reports.sales.profitability.read` | PDF · XLSX · CSV | PHASE-017 |
| `automotive.vehicle_service_history` | Vehicle Service History / سجل صيانة المركبة | partners · `automotiveQueries.vehicleServiceHistory` (the vehicles.serviceHistory read model) | vehicleId | `sales.statements.read` | PDF · XLSX · CSV | PHASE-017 |
| `distribution.rep_settlement` | Rep Settlement / تسوية المندوب | distribution · `distributionQueries.repSettlement` · rep_settlements + component lines + van load-out moves | dateFrom/To, repIds | `reports.treasury.fx.read` | PDF · XLSX · CSV | PHASE-017 |
| `distribution.route_visit_compliance` | Route Visit Compliance / الالتزام بخطوط السير | distribution · `distributionQueries.routeVisitCompliance` · routes, route_visits (+ linked documents) | dateFrom/To, routeIds | `reports.sales.by-rep.read` | PDF · XLSX · CSV | PHASE-017 |
| `distribution.van_stock_balances` | Van Stock Balances / أرصدة مخزون السيارات | distribution · `distributionQueries.vanStockBalances` · van_stocks mirror (+ expiry via batches) | warehouseIds | `inventory.stock.read` | PDF · XLSX · CSV | PHASE-017 |
| `sales.discount_management_effectiveness` | Discount Management Effectiveness / فاعلية السلع المجانية | sales · `distributionQueries.discountEffectiveness` · sales_invoice_lines (foc_reason_code) | dateFrom/To | `reports.sales.by-customer.read` | PDF · XLSX · CSV | PHASE-017 |
| `sales.commissions_due` | Commissions Due / العمولات المستحقة | sales · `distributionQueries.commissionsDue` · commission_runs + lines joined sales_reps | dateFrom/To, repIds | `reports.sales.by-rep.read` | PDF · XLSX · CSV | PHASE-017 |

Notes: `automotive.job_card_profitability` carries the `jc-parts-cogs-tie` assertion
(per-card parts COGS = the GL net of `sales_invoice:cogs` + `job_card:issue_parts` +
`credit_note:reentry`, tolerance 0); `distribution.rep_settlement` carries
`settlement-gl-tie` (|variance| + deposit = the variance + deposit journal debits);
`distribution.van_stock_balances` carries `van-conservation-tie` (mirror = Σ signed
stock moves); `sales.commissions_due` carries `commissions-total-tie` (posted run totals
= COMMISSION_EXPENSE debits of `commission_run:accrual` journals); the two operational
rows (vehicle history, route compliance) carry no GL assertion per the §11 rule-2 note
(README rules 2/3 — planning data / read model).

## 9. Financial depth (v2.0 — fixed assets, notes, installments, budgeting, payroll)

Added by Blueprint v2.0 ([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) §J —
catalog 50 → 67). Provenance = owning module + owned tables (rule §16); permissions per
[AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.11–§3.14; registers
reuse module read permissions per §12.

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `fixed_assets.asset-register` | Asset Register / سجل الأصول الثابتة | fixed_assets · assets, asset_categories, depreciation_lines (NBV as-of) | asOf, branches, category, status, custodian | `fixed_assets.reports.view` | PDF · XLSX · CSV | PHASE-026 |
| `fixed_assets.depreciation-schedule` | Depreciation Schedule / جدول الإهلاك | fixed_assets · assets, depreciation_runs, depreciation_lines | fiscal period, asOf, category, method | `fixed_assets.reports.view` | PDF · XLSX · CSV | PHASE-026 |
| `fixed_assets.movements` | Asset Movements / حركة الأصول | fixed_assets · depreciation_runs, asset_disposals, asset_revaluations (+ journal provenance via the engine) | dateFrom/To, branches, movement kind | `fixed_assets.reports.view` | PDF · XLSX · CSV | PHASE-026 |
| `notes.maturity-calendar` | Maturity Calendar / تقويم الاستحقاق | notes · notes, note_events (PDC calendar auto-derived — BR-045) | dateFrom/To, direction, status, bank, partner | `notes.notes.view` | PDF · XLSX · CSV | PHASE-027 |
| `notes.aging` | Notes Aging / أعمار الأوراق التجارية | notes · notes (maturity buckets vs as-of) | asOf, buckets, direction, partner | `notes.notes.view` | PDF · XLSX · CSV | PHASE-027 |
| `notes.dishonored-register` | Dishonored Notes Register / سجل الأوراق المرتجعة | notes · note_events (DISHONOR events; AR restoration journals via provenance) | dateFrom/To, partner, reason | `notes.notes.view` | XLSX · CSV | PHASE-027 |
| `installments.schedule` | Installment Schedule / جدول الأقساط | installments · installment_plans, installment_lines | planId, asOf, line status | `installments.plans.view` | PDF (`a4-document`) · XLSX · CSV | PHASE-027 |
| `installments.aging` | Installments Aging / أعمار الأقساط | installments · installment_lines (overdue buckets; late-fee policy per plan — BR-049) | asOf, buckets, partner | `installments.plans.view` | PDF · XLSX · CSV | PHASE-027 |
| `budgeting.budget-vs-actual` | Budget vs Actual / الموازنة مقابل الفعلي | budgeting · budgets, budget_lines + GL read model (posted journal lines via accounting queries) | fiscal period/year, scope, branches, dimension (account/cost center/project/branch) | `budgeting.reports.view` | PDF · XLSX · CSV | PHASE-028 |
| `budgeting.variance-analysis` | Variance Analysis / تحليل الانحرافات | budgeting · budgets, budget_lines + GL read model | period, scope, variance threshold, grouping | `budgeting.reports.view` | PDF · XLSX · CSV | PHASE-028 |
| `payroll.register` | Payroll Register / سجل الرواتب | payroll · payroll_runs, payroll_run_lines, employees (component snapshots) | fiscal period, branch, run | `payroll.reports.view` | PDF · XLSX · CSV | PHASE-029 |
| `payroll.cost-summary` | Payroll Cost Summary / ملخص تكاليف الرواتب | payroll · payroll_run_lines + GL expense provenance (cost allocation by branch/cost center) | period, branch, cost center, component kind | `payroll.reports.view` | PDF · XLSX · CSV | PHASE-029 |
| `payroll.eos-provision` | EOS Provision / مخصص نهاية الخدمة | payroll · employees, salary_structures (EOS-base components), payroll_runs + provision journal provenance | asOf, branch, tenure buckets | `payroll.reports.view` | PDF · XLSX · CSV | PHASE-029 |

Notes: `fixed_assets.asset-register` asserts INV-023 in the footer (NBV = cost −
accumulated depreciation ≥ salvage floor); `notes.maturity-calendar` and `notes.aging`
assert INV-024 (custody equals journal effects — COLLECTED/DISCOUNTED/RETURNED notes carry
zero `NOTES_RECEIVABLE` balance); `payroll.register` shows employee-level amounts — every
run is audited and the permission is not granted to `viewer`-derived templates by default
([AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) §3.14).

## 10. Consolidation (v2.0 — multi-entity)

Delivered by PHASE-034 (**COMPLETE 2026-11-09** — registry rows 76 → 80; the four
contracts run on the PHASE-013 engine reading the completed run's immutable
snapshots). A legal entity = a tenant: consolidated statements are read-runs
over member books plus eliminations posted in the parent's consolidation books
([ADR-0018](../architecture/ADR/ADR-0018-multi-entity-consolidation.md)); member books are
never written (INV-026).

| Report key | Title (EN / AR) | Source of truth | Key parameters | Perm | Exports | Phase |
|------------|------------------|-----------------|----------------|------|---------|-------|
| `consolidation.consolidated-tb` | Consolidated Trial Balance / ميزان المراجعة الموحد | consolidation · consolidation_runs + member GL read models (read-only cross-tenant service — ADR-0018) | fiscal period, group, elimination toggle | `consolidation.reports.view` | PDF · XLSX · CSV | PHASE-034 |
| `consolidation.consolidated-is` | Consolidated Income Statement / قائمة الدخل الموحدة | consolidation · consolidation_runs + member GL read models | period, comparative, FX rate date | `consolidation.reports.view` | PDF · XLSX · CSV | PHASE-034 |
| `consolidation.consolidated-bs` | Consolidated Balance Sheet / قائمة المركز المالي الموحدة | consolidation · consolidation_runs + member GL read models | asOf, FX rate date, elimination toggle | `consolidation.reports.view` | PDF · XLSX · CSV | PHASE-034 |
| `consolidation.eliminations-log` | Eliminations Log / سجل قيود الاستبعاد | consolidation · elimination_entries, consolidation_runs (+ journals in the parent's consolidation books via provenance) | fiscal period, group, status | `consolidation.reports.view` | XLSX · CSV | PHASE-034 |

Notes: every consolidated statement asserts INV-026 in the footer — consolidated =
Σ member statements (group currency, dated FX) − eliminations; `consolidation.eliminations-log`
drills only to journals in the parent's consolidation books; members with open fiscal
periods cannot be consolidated (BR-056).

## 11. Standard parameter reference

Parameters are declarative ([REPORT_CONTRACT.md](REPORT_CONTRACT.md) §5) and render from
the schema in the FilterBar ([../ui/COMPONENT_CATALOG.md](../ui/COMPONENT_CATALOG.md) §3).
Standard parameters and their widgets:

| Parameter | Type / widget | Notes |
|-----------|---------------|-------|
| `dateFrom` / `dateTo` | `DateRangePicker` (Gregorian+Hijri display) | Fiscal-calendar aware; presets map to fiscal periods |
| `asOf` | `DatePicker` + time (optional on financial reports) | Enables determinism (§[FINANCIAL_REPORT_RULES.md](FINANCIAL_REPORT_RULES.md) §7) |
| `period` | Fiscal period picker | Used by IS/CF/VAT instead of raw dates |
| `branchIds` | Branch multi-select (chips) | Options limited to user's branch grants |
| `warehouseIds` | `WarehousePicker` | Only where scope applies |
| `partnerId(s)` / `itemId(s)` / `repIds` | `Combobox` (async) | Debounced search, 200ms |
| `currency` | `Select`: base / document | Only contracts with `presentation: 'both'` |
| `grouping` | `Select` (contract-declared options only) | e.g., by type / category |
| `zeroSuppression` | `Switch` (default on) | Display-only; assertions unaffected |
| `comparative` | `Select`: none / prior period / prior year | IS/BS/CF |
| `locale` | Run locale (`ar` / `en`) | Drives direction of exports and labels |

## 12. Permission naming convention

- Statement & analytics reports: `reports.<group>.<report>.read` (e.g.,
  `reports.financial.tb.read`, `reports.sales.by-item.read`).
- Module operational registers reuse the module's own read permission (e.g.,
  `accounting.journals.read`, `inventory.moves.read`, `treasury.cash.read`) — a register
  is a module surface exposed through the reporting engine, not a new privilege.
- Platform reports: `platform.<area>.read` — granted only to platform/tenant admins.
- v2.0 module report keys live in their owning module's section of
  [AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md) (§3.11–§3.15):
  `fixed_assets.reports.view`, `budgeting.reports.view`, `payroll.reports.view`,
  `consolidation.reports.view`; notes and installment operational registers reuse the
  module read permissions `notes.notes.view` and `installments.plans.view`.
- Every permission must exist in the role matrix before the report's phase completes
  ([../security/AUTHORIZATION_MATRIX.md](../security/AUTHORIZATION_MATRIX.md)).

## 13. Data readiness & phase matrix

A report cannot be registered before its data phase — the registry cross-checks
`dataSources[].module` against the module's delivery phase:

| Data phase | Registers then |
|------------|----------------|
| PHASE-003 | platform.audit-trail, platform.user-activity |
| PHASE-004 | platform.subscription-usage |
| PHASE-006 | partner.balances |
| PHASE-007 | accounting.journal-register, TB/GL (engine data ready; statements render from PHASE-013) |
| PHASE-008 | treasury registers (daily cash, receipts/payments, expenses, petty cash, FX differences, shifts, bank rec) |
| PHASE-009 | tax.vat-return, tax.summary-by-treatment |
| PHASE-010 | inventory reports (on hand, movement, valuation, expiry, counts, transfers, serials) |
| PHASE-011 | AP aging, supplier statements, GRNI, PO status, matching exceptions |
| PHASE-012 | AR aging, customer statements, allocations |
| PHASE-013 | **Reporting engine** — delivered 2026-11-01 (48 rows registered §1–§7): all statement/analytics reports, close pack, slow-moving, report-run history |
| PHASE-015 | industry reports v1 (§8: expiry list, expiry/damage write-off register, IMEI register — delivered with the configuration engine) |
| PHASE-016 | POS reports (§8: sales-by-terminal, sales-by-hour — both `pos-gl-tie`-asserted — and shift-cash-reconciliation; delivered with the pos module) |
| PHASE-017 | industry reports II (§8: job-card profitability, vehicle service history, rep settlement, route-visit compliance, van stock balances, discount-management effectiveness, commissions due — the automotive/distribution set; delivered with the distribution module, 7 contracts, registry 63) |
| PHASE-023 | e-invoicing log |
| PHASE-026 | fixed-asset reports (asset register, depreciation schedule, movements) |
| PHASE-027 | notes reports (maturity calendar, aging, dishonored register) + installment reports (schedule, aging) |
| PHASE-028 | budgeting reports (budget vs actual, variance analysis) |
| PHASE-029 | payroll reports (register, cost summary, EOS provision) |
| PHASE-034 | consolidation reports (consolidated TB/IS/BS, eliminations log) — **delivered 2026-11-09, registry 80** |

## 14. Saved views, dashboard widgets, and subscriptions

- **Saved views**: users save named parameter sets (key + version + params + label
  bilingual); shared views are tenant-scoped, personal views user-scoped. Saved views
  appear in FilterBar's "saved views" menu and in the Reports group landing list
  (delivered PHASE-013: client-side parameter sets).
- **Dashboard widgets** (PHASE-014): `KPIStatCard`/`ChartCard` widgets bind to report
  contracts in `current` freshness mode with pinned parameters (e.g., "this month cash
  in"); clicking a widget opens the underlying report with those parameters — widgets
  are links, not parallel implementations ([../ui/PAGE_ARCHETYPES.md](../ui/PAGE_ARCHETYPES.md) §1).
- **Subscriptions (post-MVP seam)**: scheduled runs land through the pg-boss schedule +
  notification email adapter described in [PRINTING_AND_EXPORT.md](PRINTING_AND_EXPORT.md)
  §7; contracts need no changes.

## 15. Cross-catalog consistency rules

1. **One number, one truth**: any amount appearing in multiple reports (e.g., the AR
   balance in aging vs partner statement vs the BS receivable line) derives from the
   same posted lines under the same scope — the golden-dataset suite pins cross-report
   equality ([REPORT_RECONCILIATION.md](REPORT_RECONCILIATION.md) §3).
2. **Naming**: report keys are `<domain>.<subject>` kebab-case; titles follow the
   canonical Arabic terms of [../GLOSSARY.md](../GLOSSARY.md).
3. **Exports**: every report supports at least XLSX and CSV; PDF requires pagination
   review against the `a4-report` template ([PRINTING_AND_EXPORT.md](PRINTING_AND_EXPORT.md)).
4. **Locale parity**: parameters, labels, empty states, and assertion messages exist
   in AR and EN at contract level — no report ships EN-only strings.
5. **Permission breadth**: a report may span modules only via declared multi-module
   sources — never via undeclared joins.

## 16. Provenance audit checklist (per report, enforced at registry boot)

- [ ] `dataSources` names at least one module and one authorized query service.
- [ ] `tables[]` lists only tables owned by that module
      ([../architecture/MODULE_BOUNDARIES.md](../architecture/MODULE_BOUNDARIES.md)) —
      cross-module *reads* happen only through the named services; cross-module writes
      are impossible by construction.
- [ ] Each source has a bilingual `purpose` (rendered in the UI as "مصدر البيانات /
      source of truth").
- [ ] Permission exists in the role matrix; phase readiness matches §13.
- [ ] Financial reports carry the [FINANCIAL_REPORT_RULES.md](FINANCIAL_REPORT_RULES.md)
      §11 assertion set; operational reports carry a ledger-tie where applicable
      ([REPORT_RECONCILIATION.md](REPORT_RECONCILIATION.md) §1.4).
- [ ] Drill links resolve only to routes the target user can open (checked at link
      generation, [REPORTING_ARCHITECTURE.md](REPORTING_ARCHITECTURE.md) §9).

## 17. Catalog governance

1. Adding a report: contract (per [REPORT_CONTRACT.md](REPORT_CONTRACT.md)) + row here
   with provenance + permission naming under `reports.*` (or module read perms for
   operational lists) + phase acceptance criteria update.
2. Removing/renaming a report key: deprecation period (key still resolves with a
   "moved/renamed" notice for one release) because saved views and dashboards reference
   keys.
3. Saved views (user-saved parameter sets) reference `report key + version`; contract
   version bumps re-validate saved views on open.
4. Every report appears in the command menu index with its bilingual title
   ([../ui/NAVIGATION_MODEL.md](../ui/NAVIGATION_MODEL.md) §3).
