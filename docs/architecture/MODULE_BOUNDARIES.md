# Module Boundaries

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28

The authoritative module (bounded context) catalog. Modules live in `apps/api/src/modules/`
as NestJS modules with a strict internal layout (`api/` = published surface,
`application/`, `domain/`, `infrastructure/`). Enforcement is described in
[DEPENDENCY_RULES.md](DEPENDENCY_RULES.md); the shared-kernel contents in ADR-0002.

## Module catalog

| Module | Bounded context | Owns (tables, exclusively) | Publishes (services consumed by other modules) | Phase |
|--------|-----------------|---------------------------|------------------------------------------------|-------|
| `shared-kernel` (package) | Cross-cutting primitives | — | ids (UUIDv7), Money/Quantity/Rate, Result, Clock, localization keys | P-001 |
| `identity` | Users, authentication, sessions, devices, MFA | users, memberships, sessions, devices, mfa_factors, recovery | authenticate, session ctx, user lookup, permission checks | P-003 |
| `tenancy` | Tenants, branches, settings, entitlements | tenants, branches, tenant_settings, plans, subscriptions, entitlements | tenant ctx, resolveEntitlements, branch registry | P-003/004 |
| `accounting` | CoA, periods, currencies, journals, **posting engine**, GL, FX, closing | accounts, account_purposes, fiscal_years, fiscal_periods, currencies, exchange_rates, journal_entries, journal_lines, cost_centers, **projects (P-019)** | PostingEngine.post/reverse, CoA queries, period checks, GL queries | P-007 (projects P-019) |
| `partners` | Customers/suppliers, credit terms, statements, subledger | partners, partner_contacts, partner_addresses, credit_terms, partner_balances | partner lookup, credit check, subledger queries | P-006 |
| `items` | Item master, categories, UoM, barcodes, price lists | items, item_categories, uoms, uom_conversions, barcodes, price_lists, price_list_items | item/UoM/pricing resolution | P-006 |
| `inventory` | Warehouses, stock ledger, valuation, batches/serials, counts, transfers | warehouses, stock_moves, stock_layers, item_warehouse_settings, stock_counts, stock_transfers, item_batches, item_serials | reserve/issue/receive stock, valuation queries, availability | P-010 |
| `sales` | Quotes, orders, deliveries, invoices, credit notes, AR docs, reps, POS docs | quotations, sales_orders, delivery_notes, sales_invoices, credit_notes, receipts, sales_reps, commissions | invoice/credit-note services, AR queries (with partners) | P-012/017 |
| `purchasing` | PR, PO, GRN, supplier invoices, debit notes, payments | purchase_requests, purchase_orders, goods_receipts, supplier_invoices, debit_notes, payments | AP queries, matching services | P-011 |
| `treasury` | Cash/bank accounts, expenses, petty cash, transfers, shifts, bank rec | cash_accounts, bank_accounts, expenses, cash_transfers, cashier_shifts, bank_reconciliations | money-movement services, account balances | P-008 |
| `tax` | Treatments, tax codes, jurisdiction packs, registrations, returns, e-invoicing adapters | tax_treatments, tax_codes, tax_rates, tax_registrations, jurisdictions, e_invoicing_submissions | resolveTax(lines), tax summaries, VAT return data | P-009 |
| `reporting` | Report contract registry, rendering, exports, print templates | reports (registry), report_runs, print_templates | runReport, export, print | P-013 |
| `notifications` | In-app + email/SMS/push adapters | notifications, notification_preferences | notify(user, event) | P-003 (email) / P-015 |
| `files` | Attachments, exports storage | file_objects | signed URL issuance, upload validation | P-002 |
| `audit` | Immutable audit events | audit_events | recordEvent (used via decorator/interceptor) | P-003 |
| `configuration` | Industry templates, feature config resolution | industry_templates, tenant_industry_config, feature_flags | resolveEffectiveConfig(tenant) | P-004/015 |
| `crm` | Leads, tasks, activities, contracts, service orders, time | leads, crm_tasks, crm_activities, service_contracts, **contract_billing_schedule, contract_invoices, contract_advances (P-019)**, service_orders, service_order_lines, **crm_time_entries (P-019)** | — | P-019 |
| `manufacturing` | BOM, production orders, WIP, QC, costing | bills_of_materials, production_orders, production_consumptions, inspections | production costing services | P-018 |
| `distribution` | Routes, van stock, rep settlements | routes, route_visits, van_stock, rep_settlements | settlement services | P-017 |
| `sync` | Device registry, change feeds, sync endpoints, cursors, tombstones, dedupe | sync_devices (mirror of identity devices' sync state), change_log, tombstones, sync_cursors, inbox_commands | pull/push contracts, device registration | P-016 (POS subset) / P-020 (full) |
| `fixed_assets` | Asset register, categories, monthly depreciation, revaluation, disposal | assets, asset_categories, depreciation_runs, depreciation_lines, asset_disposals, asset_revaluations | asset lifecycle services, depreciation scheduler | P-026 |
| `notes` | Cheques & promissory notes (PDC), custody, endorsement, dishonor, discounting | notes, note_events | custody services, maturity calendar jobs | P-027 |
| `installments` | Installment plans, schedules, late fees | installment_plans, installment_lines | plan/schedule services, late-fee engine | P-027 |
| `budgeting` | Versioned budgets by fiscal year/scope, variance vs GL (advisory controls) | budgets, budget_lines | budget versioning, variance queries (over the accounting GL read model) | P-028 |
| `payroll` | Employees, salary structures/components, monthly runs, employee loans, EOS provision | employees, salary_structures, salary_components, payroll_runs, payroll_run_lines, employee_loans, employee_loan_lines | payroll run services, EOS accrual | P-029 |
| `consolidation` | Multi-entity groups, member entities, eliminations, consolidation runs | consolidation_groups, group_entities, elimination_entries, consolidation_runs | read-only member aggregation, elimination posting via engine, FX translation | P-034 |

## Cross-module write matrix (normative)

Only these cross-module writes exist — everything else is a published-service call:

| Table(s) | Written exclusively by |
|----------|----------------------|
| `journal_entries`, `journal_lines` | `accounting` (posting engine) — nobody else, ever |
| `stock_moves`, `stock_layers` | `inventory` |
| `partners*`, `items*` | `partners`, `items` |
| `audit_events` | `audit` module interceptor (never direct inserts from modules) |
| `cash_accounts`/`bank_accounts` balances | `treasury` (through posting engine for GL effects) |
| `assets`, `asset_categories`, `depreciation_runs`, `depreciation_lines`, `asset_disposals`, `asset_revaluations` | `fixed_assets` |
| `notes`, `note_events` | `notes` |
| `installment_plans`, `installment_lines` | `installments` |
| `employees`, `salary_structures`, `salary_components`, `payroll_runs`, `payroll_run_lines`, `employee_loans`, `employee_loan_lines` | `payroll` |
| `budgets`, `budget_lines` | `budgeting` |
| `consolidation_groups`, `group_entities`, `elimination_entries`, `consolidation_runs` | `consolidation` (eliminations reach the ledger only through the posting engine, in the parent's consolidation books — ADR-0018; member books never written) |

## In-process events (side effects, not the record)

| Event | Emitted by | Handled by |
|-------|-----------|------------|
| `invoice.posted` | sales | notifications, reporting (cache invalidation) |
| `invoice.overdue` | sales (job) | notifications |
| `stock.below_reorder` | inventory | notifications |
| `tenant.suspended` | tenancy | identity (sessions), sync (device push rejection) |
| `einvoice.submission.failed` | tax adapter | notifications |
| `sync.push.rejected` | sync | notifications |

## Rule of thumb for new modules

A new capability becomes a module only if it owns tables and has a distinct vocabulary;
otherwise it is a feature of an existing module. Industry-specific logic lives in
templates + configuration + (rarely) thin adapters — **not** in new modules that duplicate
core domains (directive §3: one accounting engine, industry extensions around it).
