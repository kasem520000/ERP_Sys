# Product Requirements

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-10-28

This document is the consolidated requirements baseline. Detailed feature behavior lives in
the [../product/FEATURE_CATALOG.md](product/FEATURE_CATALOG.md) (canonical feature keys);
industry behavior in [../industries/](industries/README.md); compliance behavior in
[../localization/](localization/COUNTRY_PACKS.md). Requirement IDs below are normative and
are referenced by phase documents.

## 1. Requirement areas and priorities

Priority legend: **M** = MVP (by [PHASE-014](planning/MASTER_ROADMAP.md)), **1** = first
post-MVP stage (PHASE-015…019), **2** = offline/clients (PHASE-020…022), **3** =
integrations/enterprise (PHASE-023…025), **4** = post-GA depth expansion (PHASE-026…034,
Blueprint v2.0 — [EXPANSION_REGISTER.md](EXPANSION_REGISTER.md)).

### PLT — Platform & tenant management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-PLT-001 | Public registration with business-activity selection, country/currency/tax-registration capture | M |
| FR-PLT-002 | Guided onboarding wizard producing an initial tenant workspace (menus, terminology, numbering) | M |
| FR-PLT-003 | Tenant lifecycle: active, suspended (billing/security), restored, offboarded with data export | M |
| FR-PLT-004 | Branch and warehouse registry per tenant | M |
| FR-PLT-005 | Subscription plans, feature entitlements, usage limits enforced server-side | M |
| FR-PLT-006 | Platform administrator console: tenants, entitlements, suspension, audit trail, support access (time-boxed, audited) | M |
| FR-PLT-007 | Marketing site with pricing pages | M |
| FR-PLT-008 | Administrative audit trail of all platform-level actions | M |

### ACC — Accounting

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ACC-001 | Chart of accounts: bilingual, hierarchical, leaf-only posting, system-purpose mapping | M |
| FR-ACC-002 | Fiscal years/periods with soft-close and hard-lock; posting blocked in locked periods | M |
| FR-ACC-003 | Manual and recurring journal entries with approval workflow and configurable approval limits | M |
| FR-ACC-004 | Centralized posting engine; balanced-entry enforcement; reversal-only corrections for posted entries | M |
| FR-ACC-005 | General ledger with account drill-down to source documents | M |
| FR-ACC-006 | Opening balances for accounts, customers, suppliers, cash, and stock | M |
| FR-ACC-007 | Multi-currency with exchange-rate tables and realized/unrealized difference posting | M |
| FR-ACC-008 | Cost centers and one analytical dimension (projects) | 1 |
| FR-ACC-009 | Fixed assets and depreciation schedules — detailed and superseded by the v2.0 FIX area (FR-FIX-001…005, PHASE-026) | 4 |
| FR-ACC-010 | Period-close checklist and year-end close to retained earnings | M |

### SAL — Sales & receivables

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-SAL-001 | Quotations → sales orders → delivery notes → invoices → credit notes chain | M |
| FR-SAL-002 | Cash and credit sales; partial payments and allocations | M |
| FR-SAL-003 | Customer price lists, discounts, free goods | M |
| FR-SAL-004 | Credit limits with configurable blocking behavior | M |
| FR-SAL-005 | Receipts (cash/bank/cheque) with AR posting and settlement allocation | M |
| FR-SAL-006 | Receivables aging and customer statements | M |
| FR-SAL-007 | Sales representatives and commissions | 1 |
| FR-SAL-008 | Point of sale: terminals, shifts, barcode, offline sale queue | 1 |

### PUR — Purchasing & payables

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-PUR-001 | Purchase requests → orders → goods receipts → supplier invoices → debit notes | M |
| FR-PUR-002 | Supplier payments and allocation; supplier statements and payables aging | M |
| FR-PUR-003 | Three-way matching (order/receipt/invoice) with tolerance rules | M |
| FR-PUR-004 | Supplier price lists; landed-cost allocation to inventory value | 1 |

### INV — Inventory & warehousing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-INV-001 | Multi-warehouse, multi-branch stock; branch-level visibility rules | M |
| FR-INV-002 | Stock ledger of immutable movements (receipt, issue, transfer, adjustment) | M |
| FR-INV-003 | Valuation: weighted average or FIFO per tenant, consistent per item, no retroactive changes | M |
| FR-INV-004 | Batch/lot, expiry, serial-number, and IMEI tracking | M |
| FR-INV-005 | Stock counts and reconciliations; adjustment postings | M |
| FR-INV-006 | Transfers in-transit; reservations; reorder levels | 1 |
| FR-INV-007 | Composite products, bundles, and kits | 1 |
| FR-INV-008 | Units of measure with conversion factors and per-UoM pricing | M |

### PAS — Customers, suppliers & personal accounts

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-PAS-001 | Unified partner model (customers, suppliers, both) with bilingual names, contacts, addresses, credit terms | M |
| FR-PAS-002 | Partner subledgers reconcilable to AR/AP control accounts | M |
| FR-PAS-003 | Customer/supplier statements and mobile-friendly account views | M (views) / 2 (app) |
| FR-PAS-004 | Customer self-service portal | 3 |

### TRS — Treasury & expenses

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-TRS-001 | Cash accounts, bank accounts, petty cash, transfers | M |
| FR-TRS-002 | Expense categories, claims, approval policies | M |
| FR-TRS-003 | Bank reconciliation with statement import and matching | M |
| FR-TRS-004 | Cashier shifts: opening/closing floats, cash differences, reconciliation | 1 |

### TAX — Tax & compliance

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-TAX-001 | Tax engine with distinct treatments: standard/zero-rated/exempt/out-of-scope/reverse-charge/not-subject | M |
| FR-TAX-002 | Jurisdiction packs: versioned rates, effective dates, invoice requirements, numbering rules | M |
| FR-TAX-003 | Correct operation for unregistered and no-VAT jurisdictions (e.g., Yemen, Kuwait) | M |
| FR-TAX-004 | VAT return report reconciling to GL tax accounts | M |
| FR-TAX-005 | E-invoicing adapter framework; ZATCA (KSA) integration per verified official specifications | 3 |
| FR-TAX-006 | Egypt ETA integration evaluation and adapter | 3 |

### RPT — Reporting & analytics

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-RPT-001 | Report contract: parameters, scopes, permissions, currency, drill-down, export, version | M |
| FR-RPT-002 | Financial statements: trial balance, income statement, balance sheet, cash flow | M |
| FR-RPT-003 | Operational reports: stock on hand/movements, sales/purchase analysis, profitability | M (core) / 1 (extended) |
| FR-RPT-004 | Bilingual RTL-correct print templates (A4, receipt, POS) and PDF/XLSX/CSV export | M |
| FR-RPT-005 | Dashboards with drill-down | M (basic) |
| FR-RPT-006 | Scheduled reports | 3 |

### IND — Industry configuration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-IND-001 | Industry template engine with manifest schema; safe switching/extension without data corruption | 1 |
| FR-IND-002 | Templates: retail, grocery/supermarket, restaurant/café | 1 |
| FR-IND-003 | Templates: automotive/workshop, distribution/field sales | 1 |
| FR-IND-004 | Template: food manufacturing | 2 |
| FR-IND-005 | Templates: professional services, rental/logistics | 2 |
| FR-IND-006 | v2.0 templates: wholesale, mobile/electronics, and healthcare/education/agriculture **commercial shells** (per [EXPANSION_REGISTER.md](EXPANSION_REGISTER.md) ED-06…ED-11; deep-vertical operations stay out of scope) | 4 |

### MFG / CRM / DST — Advanced operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-MFG-001 | BOM, production orders, material consumption, WIP, finished goods, scrap, batch genealogy, production costing | 2 |
| FR-CRM-001 | Leads, follow-ups, tasks, activities, contracts, service orders | 2 |
| FR-DST-001 | Van sales: vehicle stock, representative accountability, routes, settlements, free goods, collections | 2 |

### OFF — Offline & clients

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-OFF-001 | Offline capability matrix per operation; server-authoritative posting | 2 |
| FR-OFF-002 | Sync protocol: outbox/inbox, idempotency keys, cursors, per-entity conflict policies | 2 |
| FR-OFF-003 | POS offline sale queue (before general sync framework) | 1 |
| FR-OFF-004 | Desktop application (Windows first) | 2 |
| FR-OFF-005 | Android application: personal accounts + field sales | 2 |
| FR-OFF-006 | Customer/supplier mobile account views with cached authorized data | 2 |

### FIX — Fixed assets & depreciation (v2.0)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-FIX-001 | Asset register with categories; a category maps `FIXED_ASSET` / `ACCUM_DEPRECIATION` / `DEPRECIATION_EXPENSE` purposes before any asset may post (BR-041) | 4 |
| FR-FIX-002 | Depreciation posts only via monthly, period-locked runs — no manual asset journals (BR-042) | 4 |
| FR-FIX-003 | NBV floor: Σ depreciation ≤ cost − salvage, NBV ≥ 0, one-time disposal only from ACTIVE/FULLY_DEPRECIATED (INV-023, BR-043) | 4 |
| FR-FIX-004 | Optional audited revaluation; delta posts to `REVALUATION_RESERVE`, never P&L (BR-044) | 4 |
| FR-FIX-005 | Methods: straight-line, declining-balance, units-of-production; no country-specific tax-depreciation automation — defaults are tenant-configured | 4 |

### NTE — Notes & installments (v2.0)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-NTE-001 | Cheques & promissory notes received/issued with partner + maturity; PDC maturity calendar auto-derived (BR-045) | 4 |
| FR-NTE-002 | Note lifecycle journals via the engine only (receive, collect, dishonor, discount, return); endorsement moves custody without a journal (BR-046/047, INV-024) | 4 |
| FR-NTE-003 | Dishonor restores the AR open item exactly (amount + references) with a required reason; optional bank fee via `BANK_CHARGES` (INV-024) | 4 |
| FR-NTE-004 | Installment plans: total equals the source document, schedule immutable after activation, **flat fees only — no interest computation** (BR-048) | 4 |
| FR-NTE-005 | Late-fee policy per plan (rate + cap + grace — PLACEHOLDER defaults) posted only via the engine (BR-049) | 4 |

### BDG — Budgeting (v2.0)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-BDG-001 | Versioned budgets per (fiscal year, scope: accounts/cost centers/projects/branches); one ACTIVE version per scope; revisions supersede, never edit (BR-050) | 4 |
| FR-BDG-002 | Budget-vs-actual and variance analysis; budgets are **not** ledger documents (no journals) | 4 |
| FR-BDG-003 | Controls advisory by default; hard-block only via explicit tenant policy — the ledger is never silently blocked (BR-051) | 4 |

### PAY — Payroll financial scope (v2.0)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-PAY-001 | Employees, salary structures & components; attendance/leave/performance/HR operations are out of scope | 4 |
| FR-PAY-002 | Monthly payroll runs posting only via runs (BR-053); posted runs immutable, reversal-only; totals equal Σ lines, net = gross − deductions exactly (INV-025) | 4 |
| FR-PAY-003 | Employee loans with per-period deduction cap (BR-054) | 4 |
| FR-PAY-004 | End-of-service (EOS) provision per tenant policy table; jurisdiction contribution/EOS rates REQUIRE_VERIFICATION — components tenant-configured, zero fabricated rates (BR-055) | 4 |

### CNS — Multi-entity consolidation (v2.0)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-CNS-001 | Consolidation groups: member tenants with ownership percent and include-from ([ADR-0018](architecture/ADR/ADR-0018-multi-entity-consolidation.md)) | 4 |
| FR-CNS-002 | Read-only consolidation runs over members with closed fiscal periods; zero cross-tenant writes (BR-056, INV-026) | 4 |
| FR-CNS-003 | Elimination entries posted via the engine into the parent's consolidation books (G-32); consolidated TB/IS/BS + eliminations log reports | 4 |
| FR-CNS-004 | Group FX translation using dated exchange rates (INV-008 conventions) | 4 |

## 2. Non-functional requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-001 | Language & direction | Arabic-first RTL and English LTR with identical feature parity; no untranslated financial term |
| NFR-002 | Accessibility | WCAG 2.1 AA for all shared components; keyboard-complete accounting entry |
| NFR-003 | Tenant isolation | Zero cross-tenant data access; enforced by scoped queries + RLS + automated attack tests |
| NFR-004 | Auditability | Immutable audit events for every state change of financial documents; actor, time, before/after |
| NFR-005 | Financial correctness | All invariants in [../accounting/ACCOUNTING_INVARIANTS.md](accounting/ACCOUNTING_INVARIANTS.md) hold at all times, verified by automated tests |
| NFR-006 | Performance (MVP) | Interactive document list < 500 ms p95 at 100k documents/tenant; invoice posting < 300 ms p95 |
| NFR-007 | Availability (MVP) | 99.5% monthly for API; RPO ≤ 15 min; RTO ≤ 4 h (revised at PHASE-025) |
| NFR-008 | Data durability | Encrypted backups, tested restores quarterly, documented runbook |
| NFR-009 | API discipline | Versioned, idempotent writes, cursor pagination, documented error model, OpenAPI generated from code |
| NFR-010 | Maintainability | Modular monolith with enforced module boundaries; no cross-module table writes; dependency rules linted |
| NFR-011 | Configurability limits | Configuration may never bypass accounting invariants, authorization, or legal requirements |
| NFR-012 | Currency precision | No binary floating point for money anywhere; NUMERIC(19,4) storage; decimal math in application code |

## 3. Constraints

- PostgreSQL is the primary database ([ADR-0004](architecture/ADR/ADR-0004-postgresql-drizzle.md)).
- TypeScript end-to-end ([ADR-0002](architecture/ADR/ADR-0002-typescript-monorepo.md)).
- No microservices, event sourcing, or distributed databases without a documented justification ([ADR-0001](architecture/ADR/ADR-0001-modular-monolith.md)).
- No compliance claims without official-source verification
  ([../localization/compliance-matrix/](localization/compliance-matrix/README.md)).
- The server is authoritative for all posted financial records ([ADR-0007](architecture/ADR/ADR-0007-centralized-posting-engine.md), [ADR-0012](architecture/ADR/ADR-0012-offline-sync.md)).

## 4. Open requirements

Ambiguities and pending product-owner decisions are recorded with recommended provisional
decisions in [ASSUMPTIONS_AND_OPEN_QUESTIONS.md](ASSUMPTIONS_AND_OPEN_QUESTIONS.md) and
decision records under [../decisions/](decisions/README.md). No requirement in this document
depends on an unresolved decision being resolved in a particular way.
