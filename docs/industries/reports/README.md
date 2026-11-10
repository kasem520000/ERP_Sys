# Industry Report Catalog

> **Status:** STABLE · **Owner:** Industry Solutions Architecture · **Updated:** 2026-11-02

Industry-flavored reports are **registry entries over shared data** — every report listed
here implements the shared report contract (parameters, scopes, permissions, currency
handling, drill-down, export, versioning) defined in
[../../reporting/REPORT_CONTRACT.md](../../reporting/REPORT_CONTRACT.md), renders
bilingual RTL-correct output ([../../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md)
adjacent rules in [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §7),
and reconciles to the ledger wherever it touches financial figures.

Report keys follow the `module.report_name` convention (module = providing module from
[../../architecture/MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)); the
canonical report registry lives with the reporting module (PHASE-013 engine; industry
entries register as their phases ship). **Registration status (2026-11-04):** the
PHASE-015 set (`inventory.expiry_list`, `grocery.expiry_writeoff`, `retail.imei_register`),
the PHASE-016 POS set (`pos.sales_by_terminal`, `pos.sales_by_hour`,
`treasury.shift_cash_reconciliation`), the PHASE-017 set (the seven automotive /
distribution / commissions rows below), the PHASE-018 set (the three manufacturing
rows below), and the PHASE-019 services set (`services.contract_revenue_schedule`,
`services.time_billing_summary`) are **live in the code registry — 68 contracts
total**; the restaurant analytics pair, the rental pair, and the logistics board
remain catalogued only until their owning phases ship.

## Catalog

| Report key | Industries | Description | Source data (module tables) | Phase |
|---|---|---|---|---|
| `pos.sales_by_terminal` | retail, grocery, restaurant | Sales totals by terminal, cashier, and shift with tender split and receipt drill-down | POS/sales documents, `cashier_shifts` | PHASE-016 |
| `pos.sales_by_hour` | retail, grocery, restaurant | Hour-of-day sales distribution for staffing and promo timing | Sales invoices (POS channel) | PHASE-016 |
| `restaurant.sales_by_table` | restaurant | Revenue, covers, and average check by table/zone | POS table-service orders → invoices | PHASE-016 (catalogued; not in the shipped 016 registry set) |
| `restaurant.order_type_mix` | restaurant | Dine-in / takeaway / delivery split over time | POS orders | PHASE-016 (catalogued; not in the shipped 016 registry set) |
| `treasury.shift_cash_reconciliation` | all POS-using industries | Expected vs counted cash per shift with variance and approval state | `cashier_shifts`, receipts, cash accounts | PHASE-016 |
| `inventory.expiry_list` | grocery, restaurant, distribution, manufacturing | Batches bucketed by days-to-expiry with value-at-risk and FEFO pick suggestions | `item_batches`, `stock_moves` | PHASE-015 |
| `grocery.expiry_writeoff` | grocery, restaurant, manufacturing | Write-off register (reason `EXPIRED`/`DAMAGED`) with GL tie-out to shrinkage | `stock_moves`, `journal_lines` | PHASE-015 |
| `retail.imei_register` | retail | IMEI in/out ledger per device with GRN, sale, and return linkage | `item_serials`, `stock_moves` | PHASE-015 |
| `automotive.job_card_profitability` | automotive | Per job card: parts margin, labor revenue, duration, and invoice status (parts COGS tie to the GL at tolerance 0) | `job_cards` + invoice-line snapshots (netted by warranty re-entry), `journal_lines` | PHASE-017 |
| `automotive.vehicle_service_history` | automotive | Per-vehicle timeline of job cards, invoices, and warranty notes | `vehicles` (partners), `job_cards`, `sales_invoices`, `credit_notes` | PHASE-017 |
| `distribution.rep_settlement` | distribution | Per rep/day: load-out, sales, returns, collections, counted vs expected cash, variance (GL tie to the variance/deposit journals at tolerance 0) | `rep_settlements` + component lines, `stock_moves` (load-out), receipts | PHASE-017 |
| `distribution.route_visit_compliance` | distribution | Planned vs actual visits per route with sales per visit | `routes`, `route_visits` | PHASE-017 |
| `distribution.van_stock_balances` | distribution | Stock per van warehouse with ageing and expiry risk (conservation tie: mirror = Σ signed stock moves) | `van_stocks` (mirror), `stock_moves`, `item_batches` | PHASE-017 |
| `sales.discount_management_effectiveness` | grocery, distribution, retail | Free goods given (FOC lines) vs sales uplift per customer/promotion | Sales invoice lines (foc_reason_code) | PHASE-017 |
| `sales.commissions_due` | distribution, automotive, professional services | Commissions per rep per period: base, rate, accrual, payout state (total tie to the accrual journals) | `sales_reps`, `commission_runs` + lines | PHASE-017 |
| `purchasing.landed_cost_allocation` | distribution, retail, manufacturing | Landed-cost components allocated per goods receipt and affected items | `goods_receipts`, `stock_layers` | PHASE-011 |
| `manufacturing.production_cost` | manufacturing | Planned vs actual material/labor/overhead per production order with yield and scrap | `production_orders`, `production_consumptions` | PHASE-018 |
| `manufacturing.batch_genealogy` | manufacturing | Upstream material batches and downstream sales for a finished batch (recall support) | `production_consumptions`, `item_batches`, sales lines | PHASE-018 |
| `manufacturing.qc_inspection_log` | manufacturing, grocery | Inspections with results, dispositions, and quarantined batches | `inspections` | PHASE-018 |
| `services.contract_revenue_schedule` | professional services, rental | Contracted billing schedule vs invoiced vs overdue backlog (revenue schedule) | `service_contracts`, `sales_invoices` | PHASE-019 |
| `services.time_billing_summary` | professional services | Hours recorded vs billable vs invoiced per case/project and fee-earner | CRM time entries, invoices | PHASE-019 |
| `rental.fleet_utilization` | rental | Utilization % per rentable asset, revenue per asset, idle days, maintenance flags | Rental contracts, `item_serials` status | PHASE-019 |
| `rental.late_fee_register` | rental | Late returns, fees charged, waivers, and deposit applications | Rental contracts, invoices | PHASE-019 |
| `logistics.shipment_status_board` | rental-logistics (logistics side) | Shipments by milestone status with ageing; adapter-fed statuses from PHASE-023 | `distribution` shipment records | PHASE-019 |

Shared financial and operational reports (trial balance, AR/AP aging, stock valuation,
customer/supplier statements) belong to the core reporting catalog and are available to
every industry; they are not repeated here.

## v2.0 templates (PHASE-030…033) — report mapping

The five v2.0 templates ([../../EXPANSION_REGISTER.md](../../EXPANSION_REGISTER.md) §L)
pin **existing** core/industry reports plus the new stage-9 module reports
(`notes.*`, `installments.*` — canonical keys per EXPANSION_REGISTER §J, registered at
PHASE-027; no new industry-flavored report keys are introduced by these templates):

| Template | Key reports pinned at apply time |
|---|---|
| `industry.wholesale` | `notes.maturity-calendar` (dashboard), `notes.aging`, `partners.ar_aging` (customer statements), `inventory.stock_valuation` |
| `industry.electronics` | `retail.imei_register` (serial tracking — dashboard), `pos.sales_by_terminal`, `pos.sales_by_hour`, `inventory.stock_valuation` |
| `industry.healthcare` | `notes.aging` (dunning by claim — dashboard), `notes.maturity-calendar` (dashboard), `partners.ar_aging`, `inventory.expiry_list` (pharmacy FEFO); `installments.*` not applicable |
| `industry.education` | `installments.schedule` (dashboard), `installments.aging` (dashboard), `services.contract_revenue_schedule`, `partners.ar_aging` |
| `industry.agriculture` | `manufacturing.production_cost` (cycle costing — dashboard), `inventory.stock_valuation`, `inventory.expiry_list` (produce perishables), `manufacturing.batch_genealogy` (harvest traceability) |

## Rules for industry reports

1. **Contract compliance.** Parameters, permission scoping, currency, drill-down to source
   documents, and export formats come from the shared contract — no bespoke report
   frameworks per industry.
2. **Ledger reconciliation.** Any report presenting monetary totals that exist in the GL
   (write-offs, COGS, revenue) shows its GL tie-out or is explicitly labeled operational
   (INV-012 discipline).
3. **Phase discipline.** A report's phase matches the phase of its source data's module —
   e.g., `distribution.rep_settlement` cannot exist before PHASE-017 settlements; it is
   registered at that phase, not before.
4. **Bilingual RTL.** Every industry report ships with AR and EN titles, headers, and
   print templates; Arabic numerals and date formats follow tenant locale settings.
5. **Addition process.** New industry reports: define key + source tables + phase, register
   in the reporting registry, implement against the contract, add to the relevant
   template's `report_defaults`, and cover with a fixture asserting totals against journal
   lines where applicable.
