# Scope and Non-Goals

> **Status:** STABLE · **Owner:** Product & Platform Architecture · **Updated:** 2026-10-28

This document defines what the Platform will and will not do, per release tier. It exists to
prevent scope creep and to keep the first commercial release achievable. Anything not listed
as in-scope is out-of-scope until a decision record adds it.

## Release tiers

| Tier | Delivered by | Definition |
|------|--------------|------------|
| **Foundation** | PHASE-001…004 | Repo, database infra, identity/tenancy/audit, tenant provisioning, platform admin |
| **MVP (Minimum Viable Commercial Release)** | PHASE-001…014 | Sellable back-office SaaS: accounting, inventory, purchasing, sales, tax, reporting, subscriptions |
| **Industry expansion** | PHASE-015…019 | Industry templates, POS, automotive/distribution templates, manufacturing, CRM |
| **Multi-platform** | PHASE-020…022 | Offline sync foundation, desktop app, Android app |
| **Enterprise & integrations** | PHASE-023…025 | E-invoicing implementations, payment/e-commerce adapters, security hardening, GA readiness |
| **Financial depth** | PHASE-026…029 | Fixed assets & depreciation, cheques/promissory notes (PDC) & installments, budgeting, payroll (financial scope only) — post-GA additive releases |
| **Industry expansion II** | PHASE-030…033 | Wholesale, electronics, healthcare, education, agriculture commercial-shell templates |
| **Enterprise consolidation** | PHASE-034 | Multi-entity consolidation (read-only runs + eliminations) → **Enterprise Depth release** |

## In scope — MVP (non-exhaustive summary)

Full detail in [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) and
[../product/FEATURE_CATALOG.md](product/FEATURE_CATALOG.md).

- Multi-tenant SaaS with registration, onboarding, branches, subscriptions, entitlements.
- Double-entry accounting: chart of accounts (bilingual), fiscal periods, journal entries,
  approval workflow, posting engine, general ledger, opening balances, multi-currency.
- Treasury: cash/bank/petty cash, receipts and disbursements, expenses, bank reconciliation.
- Master data: customers/suppliers, items, UoM, barcodes, price lists.
- Inventory: multi-warehouse stock ledger, WAC/FIFO valuation, batches/expiry/serials/IMEI,
  counts, transfers.
- Purchasing: PR/PO/GRN/supplier invoices/debit notes/payments, three-way matching.
- Sales: quotation→order→delivery→invoice→credit note, receipts, credit limits, aging.
- Tax: treatment model, jurisdiction packs (all listed countries, including no-VAT),
  VAT return report, unregistered-business mode.
- Reporting: report contract, financial statements, operational reports, bilingual RTL
  printing, PDF/XLSX/CSV export.
- Arabic-first RTL UI + English LTR; web application.

## In scope — post-MVP tiers

- Industry template engine + retail, grocery, restaurant, automotive, distribution, food
  manufacturing, professional services, rental/logistics templates.
- Point of sale with offline sale queue.
- Manufacturing (BOM, production orders, costing, QC basics), CRM/service, van sales and
  settlements.
- General offline sync foundation, desktop application (Tauri), Android application.
- ZATCA e-invoicing implementation (only against verified official specifications),
  payment-provider adapters, e-commerce/shipping adapters.
- Security hardening, performance, DR readiness for GA.
- **Financial depth (PHASE-026…029)**: fixed assets & depreciation (register, categories,
  monthly runs, revaluation, disposal); cheques & promissory notes (PDC calendar,
  endorsement, dishonor, discounting); installment plans (schedules, collections, late
  fees); budgeting (versioned budgets, variance, advisory controls); payroll **financial
  processing** (employees, salary structures, monthly runs, employee loans, EOS
  provision) — per [EXPANSION_REGISTER.md](EXPANSION_REGISTER.md).
- **Five new industry templates (PHASE-030…033)**: wholesale, electronics, healthcare,
  education, agriculture — commercial shells (configuration + light extension over
  existing modules; deep vertical operations remain non-goals).
- **Multi-entity consolidation (PHASE-034)**: read-only consolidation runs over member
  books + elimination journals in the parent's consolidation books (ADR-0018).

## Explicit non-goals (all tiers unless a decision record changes this)

1. **Payroll-related HR operations.** Attendance, leave, performance management, and
   gratuity legal automation are out of scope — payroll **financial** processing
   (structures, runs, loans, EOS provision) IS in scope from PHASE-029 (DR-005).
2. **A public marketplace / third-party app ecosystem.** The extension mechanism is
   internal industry templates and jurisdiction packs, not a plugin marketplace.
3. **Blockchain, cryptocurrency, or tokenization features.**
4. **Country-specific legal accounting formats beyond the listed jurisdictions** (e.g.,
   statutory filing directly to governments) without a verified official integration.
5. **Deep-vertical operations for unlisted verticals (hospitals, schools, agriculture).**
   These verticals now ship **commercial-shell templates** (PHASE-031/032/033) — patient
   financial files, tuition contracts, crop-cycle costing — but deep vertical operations
   (clinical HIS, academic LMS, agronomy science) remain non-goals until decision records
   add them (ED-11).
6. **Real-time financial consolidation across separate legal entities at launch** —
   multi-branch yes; consolidated group reporting is a later enterprise capability.
7. **Microservices, event sourcing, or distributed databases** at launch
   ([ADR-0001](architecture/ADR/ADR-0001-modular-monolith.md)).
8. **Running on customer-owned infrastructure (on-premise)** at launch. The deployment
   architecture keeps this possible, but the commercial model is SaaS.
9. **Social/network features, AI copilots, and chat interfaces** — not part of the core
   platform promise; may be revisited post-GA.
10. **Supporting languages beyond Arabic and English in the MVP.** The i18n architecture
    supports adding languages; only AR and EN are produced and tested initially.
11. **Interest-bearing installment computation (riba).** Installment late fees are flat,
    tenant-configured policy amounts/rates per plan (DR-003); no compound-interest or
    amortization schedules are computed or implied.

## Deliberate deferrals (with reasons and triggers)

| Deferred item | Reason | Must be completed by |
|---------------|--------|---------------------|
| Scheduled reports & email digests | Depends on job scheduler maturity | PHASE-025 |
| Customer self-service portal | Requires hardened public auth surface | PHASE-023…025 |
| Hijri fiscal calendars | Fiscal years are Gregorian; Hijri display everywhere is MVP | If customers demand it (decision record) |
| Payment provider auto-reconciliation | Requires verified provider APIs | PHASE-024 |

*Blueprint v2.0 moves (ED-18):* **fixed assets & depreciation** moved out of this table
into planned scope — delivered by **PHASE-026** (DR-002); **multi-entity consolidation**
moved into planned scope — delivered by **PHASE-034** (ADR-0018). Both are additive
post-GA releases ([EXPANSION_REGISTER.md](EXPANSION_REGISTER.md), ED-01).

## What "done" means for a tier

A tier is done only when every phase it contains meets its exit criteria with evidence, per
[../planning/PHASE_ACCEPTANCE_CRITERIA.md](planning/PHASE_ACCEPTANCE_CRITERIA.md) and the
completion-report requirements in
[../handoff/IMPLEMENTATION_PROTOCOL.md](handoff/IMPLEMENTATION_PROTOCOL.md).
