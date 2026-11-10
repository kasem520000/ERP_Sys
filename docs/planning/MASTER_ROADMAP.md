# Master Roadmap

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-11-10 (Blueprint v3.0 — the completeness program)

The dependency-driven implementation roadmap: **34 phases in 11 stage groups** — stages 1–8
are the v1.1 baseline; stages 9–11 are the Blueprint v2.0 post-GA expansion
([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md)). **Blueprint v3.0 extends the
program with 31 further phases (035–065) in 4 waves (stages 12–15)** — the Full-ERP
Completion Program governed by
[COMPLETENESS_REGISTER.md](COMPLETENESS_REGISTER.md) and indexed by
[COMPLETENESS_ROADMAP.md](COMPLETENESS_ROADMAP.md). Detailed,
actionable phase documents (29 mandatory sections each) live in
[../implementation/phases/](../implementation/phases/). Every phase's full acceptance
criteria are consolidated in [PHASE_ACCEPTANCE_CRITERIA.md](PHASE_ACCEPTANCE_CRITERIA.md);
current progress in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

**Reading rule for implementers:** the phase document is authoritative; this roadmap is
the index. If they conflict, the phase document wins and this file must be corrected.

## Stage groups

| Stage | Name | Phases | Outcome |
|-------|------|--------|---------|
| 1 | Foundation & Platform | 001–004 | Repo, database infrastructure, identity/tenancy/audit, tenant provisioning + platform admin |
| 2 | Experience Layer | 005 | Design system, i18n/RTL foundation, app shell |
| 3 | Financial Core | 006–009 | Master data, accounting core + posting engine, treasury, tax engine + jurisdiction packs |
| 4 | Supply & Trade Operations | 010–012 | Inventory & warehousing, purchasing & payables, sales & receivables |
| 5 | Insight & Commercial Launch — **MVP** | 013–014 | Reporting/printing engine, subscriptions & billing & onboarding → **MVP release** |
| 6 | Industry Expansion | 015–019 | Industry framework + priority templates, POS, automotive/distribution templates, manufacturing, CRM |
| 7 | Offline & Multi-Platform | 020–022 | Sync foundation, desktop application, Android application |
| 8 | Integrations & Enterprise Readiness — **GA** | 023–025 | E-invoicing implementations + external adapters, security hardening, performance & GA readiness |
| 9 | Financial Depth | 026–029 | Fixed assets, cheques/notes/installments, budgeting, payroll |
| 10 | Industry Expansion II | 030–033 | Wholesale, electronics, healthcare, education, agriculture templates |
| 11 | Enterprise Consolidation | 034 | Multi-entity consolidation → **Enterprise Depth release** |
| 12 | Sellable Foundation — **Blueprint v3.0 Wave 1** | 035–041 | Activation & truth restoration · custom fields · ZATCA Phase-1 · sourcing · RMA/dunning · migration toolkit · communications → **Sellable gate** |
| 13 | Full-ERP Completion — **Wave 2** | 042–051 | Routing/MRP · WMS · HR core/compliance/growth · projects · CMMS · QMS · foreign trade → **Full-ERP gate** |
| 14 | Enterprise Platform — **Wave 3** | 052–059 | Workflow engine · accounting depth · tax compliance · public API · payments/commerce · BI · identity · platform ops → **Enterprise gate** |
| 15 | Differentiation & Growth — **Wave 4** | 060–065 | Sales/CRM depth · POS depth · UX excellence · Gulf differentiators · AI copilot · growth platform → **Differentiated gate** |

## Dependency graph (summary)

Full graph: [PHASE_DEPENDENCY_GRAPH.md](PHASE_DEPENDENCY_GRAPH.md).

```mermaid
flowchart TB
  subgraph S1["Stage 1 — Foundation"]
    P001[P001 Repo & Engineering] --> P002[P002 DB & Migrations] --> P003[P003 Identity, Tenancy & Audit] --> P004[P004 Provisioning & Admin]
  end
  subgraph S2["Stage 2 — Experience"]
    P005[P005 Design System, i18n & RTL]
  end
  subgraph S3["Stage 3 — Financial Core"]
    P006[P006 Master Data] --> P007[P007 Accounting Core & Posting]
    P007 --> P008[P008 Treasury & Expenses]
    P007 --> P009[P009 Tax Engine & Packs]
  end
  subgraph S4["Stage 4 — Trade"]
    P010[P010 Inventory & Warehousing]
    P010 --> P011[P011 Purchasing & Payables]
    P011 --> P012[P012 Sales & Receivables]
  end
  subgraph S5["Stage 5 — MVP"]
    P013[P013 Reporting, Statements & Printing]
    P013 --> P014[P014 Subscriptions, Billing & Onboarding]
  end
  subgraph S6["Stage 6 — Industries"]
    P015[P015 Industry Framework & Templates]
    P015 --> P016[P016 Point of Sale]
    P016 --> P017[P017 Automotive & Distribution Templates]
    P017 --> P018[P018 Manufacturing]
    P017 --> P019[P019 CRM, Service & Projects]
  end
  subgraph S7["Stage 7 — Offline & Clients"]
    P020[P020 Offline Sync Foundation]
    P020 --> P021[P021 Desktop App]
    P020 --> P022[P022 Android App]
  end
  subgraph S8["Stage 8 — Enterprise"]
    P023[P023 Integrations & E-Invoicing]
    P023 --> P024[P024 Security Hardening]
    P024 --> P025[P025 Performance & GA]
  end
  subgraph S9["Stage 9 — Financial Depth"]
    P026[P026 Fixed Assets]
    P027[P027 Notes & Installments]
    P028[P028 Budgeting]
    P029[P029 Payroll]
  end
  subgraph S10["Stage 10 — Industry Expansion II"]
    P030[P030 Wholesale & Electronics]
    P031[P031 Healthcare Shell]
    P032[P032 Education Shell]
    P033[P033 Agriculture Shell]
  end
  subgraph S11["Stage 11 — Enterprise Consolidation"]
    P034[P034 Multi-Entity Consolidation]
  end
  P004 --> P005
  P005 --> P006
  P009 --> P010
  P012 --> P013
  P014 --> P015
  P014 -.MVP gate.-> MVP[[MVP RELEASE]]
  P020 -.-> P016
  P025 -.-> GA[[GA RELEASE]]
  P025 --> P026
  P025 --> P027
  P025 --> P028
  P025 --> P029
  P015 --> P030
  P017 --> P030
  P019 --> P030
  P015 --> P031
  P027 --> P031
  P015 --> P032
  P027 --> P032
  P015 --> P033
  P018 --> P033
  P026 --> P034
  P029 --> P034
  P034 -.-> ED[[ENTERPRISE DEPTH RELEASE]]
```

Critical path: **P001 → P002 → P003 → P004 → P005 → P006 → P007 → {P008, P009} → P010 →
P011 → P012 → P013 → P014 (MVP)**. Post-GA (v2.0 expansion): P025 (GA) → {P026, P029} →
P034 → **Enterprise Depth release** — full expansion dependencies in
[PHASE_DEPENDENCY_GRAPH.md](PHASE_DEPENDENCY_GRAPH.md).

## Phase summary table

| Phase | Title | Prereqs | Key outcome |
|-------|-------|---------|-------------|
| [PHASE-001](../implementation/phases/PHASE-001.md) | Repository & Engineering Foundation | — | Monorepo, tooling, CI gates, dev environment; docs-in-repo workflow |
| [PHASE-002](../implementation/phases/PHASE-002.md) | Database & Migration Infrastructure | 001 | Drizzle + migrations, RLS helpers, audit trigger utilities, pg-boss, storage adapter, health checks |
| [PHASE-003](../implementation/phases/PHASE-003.md) | Identity, Multi-Tenancy & Audit Core | 002 | Auth, sessions, MFA, roles/permissions, RLS enforcement, audit events, tenant isolation attack tests |
| [PHASE-004](../implementation/phases/PHASE-004.md) | Tenant Provisioning & Platform Administration | 003 | Registration, onboarding wizard (backend), branches, entitlements service, admin console, support access |
| [PHASE-005](../implementation/phases/PHASE-005.md) | Design System, i18n & RTL Foundation | 004 | Tokens, core components, app shell, AR/EN locales, RTL rules, visual regression harness |
| [PHASE-006](../implementation/phases/PHASE-006.md) | Master Data | 005 | Partners, items, UoM, barcodes, price lists, opening-balance drafts, attachments, import/export |
| [PHASE-007](../implementation/phases/PHASE-007.md) | Accounting Core & Posting Engine | 006 | CoA, fiscal calendar, currencies/FX, journals, posting engine, GL, approvals, opening balances posting, invariant suite |
| [PHASE-008](../implementation/phases/PHASE-008.md) | Treasury: Cash, Banking & Expenses | 007 | Cash/bank accounts, receipts/disbursements, petty cash, transfers, expenses, shifts, bank reconciliation, FX differences |
| [PHASE-009](../implementation/phases/PHASE-009.md) | Tax Engine & Jurisdiction Packs | 007 | Treatments, tax codes, versioned rates, all country packs incl. no-VAT, tax summaries, VAT return report, adapter framework |
| [PHASE-010](../implementation/phases/PHASE-010.md) | Inventory & Warehousing | 009 | Stock ledger, WAC/FIFO valuation, opening stock, transfers, counts, batches/expiry/serials/IMEI, GL integration |
| [PHASE-011](../implementation/phases/PHASE-011.md) | Purchasing & Payables | 010 | PR/PO/GRN/supplier invoices/debit notes, three-way matching, payments, AP aging, statements |
| [PHASE-012](../implementation/phases/PHASE-012.md) | Sales & Receivables | 011 | Quote→order→delivery→invoice→credit note, receipts, allocations, credit limits, AR aging, statements |
| [PHASE-013](../implementation/phases/PHASE-013.md) | Reporting Engine, Financial Statements & Printing | 012 | Report contract, TB/IS/BS/CF, operational reports, print templates AR/EN, PDF/XLSX/CSV, drill-down |
| [PHASE-014](../implementation/phases/PHASE-014.md) | Subscription, Billing, Onboarding & Dashboards — **MVP** | 013 | Plans, entitlement enforcement, checkout (provider + manual), onboarding UX, dashboards, security/perf review → **MVP RELEASE** |
| [PHASE-015](../implementation/phases/PHASE-015.md) | Industry Framework & Priority Templates | 014 | Configuration engine, manifests, retail + grocery + restaurant templates, template switching rules |
| [PHASE-016](../implementation/phases/PHASE-016.md) | Point of Sale | 015 | Terminals, POS sales flow, shifts/drawer, receipts (80/58mm), barcode, offline sale queue (scoped sync) |
| [PHASE-017](../implementation/phases/PHASE-017.md) | Automotive & Distribution Templates | 016 | Job-card workflow template, van sales, routes, rep stock, settlements, customer tiers, free goods |
| [PHASE-018](../implementation/phases/PHASE-018.md) | Manufacturing & Production | 017 | BOM, production orders, consumption, WIP, finished goods, scrap, batch genealogy, production costing, QC basics |
| [PHASE-019](../implementation/phases/PHASE-019.md) | CRM, Service Contracts & Projects | 017 | Leads/tasks/activities, service contracts, recurring billing, service orders, project dimension |
| [PHASE-020](../implementation/phases/PHASE-020.md) | Offline Synchronization Foundation | 016 | Device registry, change feeds, pull/push contracts, conflict policies, local DB schema & migrations, sync tests |
| [PHASE-021](../implementation/phases/PHASE-021.md) | Desktop Application | 020 | Tauri shell, packaging, auto-update, offline web-ERP in shell, keychain, printer integration |
| [PHASE-022](../implementation/phases/PHASE-022.md) | Android Application | 020 | Expo app: personal accounts + field sales, offline cache, device registration, push notifications |
| [PHASE-023](../implementation/phases/PHASE-023.md) | External Integrations & E-Invoicing | 020 | ZATCA phase-2 adapter (verified specs), ETA evaluation, payment providers, e-commerce/shipping adapters |
| [PHASE-024](../implementation/phases/PHASE-024.md) | Security Hardening & Compliance Review | 023 | Pen test fixes, MFA policies, rate-limit hardening, audit review, dependency triage |
| [PHASE-025](../implementation/phases/PHASE-025.md) | Performance, Reliability & GA Readiness | 024 | Load tests, DR drill, restore tests, runbook validation, SLOs, GA release |
| [PHASE-026](../implementation/phases/PHASE-026.md) | Fixed Assets & Depreciation | 025, 007, 013 | Asset register & categories, monthly depreciation runs, revaluation, disposal with gain/loss mirrors (INV-023, goldens G-21…G-23) |
| [PHASE-027](../implementation/phases/PHASE-027.md) | Cheques, Promissory Notes & Installments | 025, 008, 012, 013 | Notes module (PDC calendar, endorsement, dishonor, discounting) + installment plans/schedules/late fees (INV-024, goldens G-24…G-28) |
| [PHASE-028](../implementation/phases/PHASE-028.md) | Budgeting & Variance Control | 025, 007, 013 | Versioned budgets by fiscal year/scope, budget-vs-actual variance, advisory controls (BR-050/051) |
| [PHASE-029](../implementation/phases/PHASE-029.md) | Payroll: Salaries, Loans & End-of-Service | 025, 007, 008, 013 | Financial-scope payroll: employees, salary structures/components, monthly runs, employee loans, EOS provision (INV-025, goldens G-29…G-31) |
| [PHASE-030](../implementation/phases/PHASE-030.md) | Wholesale & Electronics Templates | 025, 015, 017, 019 | `industry.wholesale` + `industry.electronics` configuration templates (qty-break price lists, IMEI serials, repairs, trade-in) |
| [PHASE-031](../implementation/phases/PHASE-031.md) | Healthcare Commercial Shell | 025, 015, 010, 012, 019, 027 | `industry.healthcare` commercial shell: patient financial files, insurance-claim billing, pharmacy stock |
| [PHASE-032](../implementation/phases/PHASE-032.md) | Education Commercial Shell | 025, 015, 027 | `industry.education` commercial shell: tuition contracts, installment plans, sibling discounts |
| [PHASE-033](../implementation/phases/PHASE-033.md) | Agriculture Commercial Shell | 025, 015, 018 | `industry.agriculture` commercial shell: crop-cycle costing via BOM, harvest batches, livestock-as-serials |
| [PHASE-034](../implementation/phases/PHASE-034.md) | Multi-Entity Consolidation | 025, 013, 026, 029 | Read-only consolidation runs + elimination journals in the parent's consolidation books, zero cross-tenant writes (INV-026, golden G-32) → **Enterprise Depth release** |

## Release gates

### v3.0 wave gates (Blueprint v3.0 — stages 12–15)

Per [COMPLETENESS_REGISTER.md](COMPLETENESS_REGISTER.md) CR-38, the four v3.0 waves close
with their own additive gates (they never alter the MVP/GA/Enterprise-Depth criteria
below):

- **Sellable gate (end of stage 12, PHASE-041):** ZATCA Phase-1 QR invoices scan-verified,
  OQ-002 pricing resolved, activation defects closed, custom fields live, sourcing/RMA/
  dunning/migration/communications shipped — the platform can be sold in its launch
  markets.
- **Full-ERP gate (end of stage 13, PHASE-051):** MRP runs producing accepted orders,
  WMS directed picking live, HR core+payroll compliance live, projects/CMMS/QMS/foreign
  trade shipped.
- **Enterprise gate (end of stage 14, PHASE-059):** public API + webhooks in production,
  SSO/SCIM live, BI builder + scheduled delivery live, tenant backup/restore + status
  page + quotas shipped.
- **Differentiated gate (end of stage 15, PHASE-065):** Hijri/Tafqeet/seasons live,
  AI copilot (opt-in) live, loyalty/gift cards live, growth platform live — the audit's
  "differentiators" column is closed.

### MVP gate (end of PHASE-014)

- A real business can: register → onboard → configure CoA → record opening balances →
  buy (PO→GRN→invoice) → sell (order→delivery→invoice→receipt) → count stock → close a
  period → print financial statements + VAT return — in Arabic and English.
- All accounting invariants tested; tenant isolation attack suite green; backups
  configured and a restore rehearsed once in staging; subscription billing operational
  (provider + manual fallback); security review of MVP surface complete.
- Exit evidence per [PHASE_ACCEPTANCE_CRITERIA.md](PHASE_ACCEPTANCE_CRITERIA.md) §14.

### GA gate (end of PHASE-025)

- Load tests at 10× projected traffic meet NFR-006; DR drill completed within RTO;
  restore-from-backup proven; pen-test findings closed; runbooks validated; error
  budget process live; ZATCA adapter (if in scope for KSA launch segment) certified per
  official requirements — or the launch segment explicitly excludes e-invoicing-requiring
  taxpayers (documented decision).
- **Gate close-out (v1.1.0, 2026-11-06):** enumerated clause-by-clause with truthful
  status markers (CLOSED / CLOSED-LOCAL-TIER / INFRA-GATED) + evidence links in
  [GA-RELEASE-CHECKLIST.md](../implementation/phases/reports/GA-RELEASE-CHECKLIST.md)
  (the 11 PHASE-025 §6 acceptance criteria; honest markers decided up front). Load
  evidence INFRA-GATED per
  [PERFORMANCE_TEST_PLAN.md](../testing/PERFORMANCE_TEST_PLAN.md) §8 (local-equivalent
  at the documented 10× volumes; production-class hosted run = the standing waiver);
  DR drill + restore CLOSED-LOCAL-TIER (drill records + runbook §8 rows); pen-test
  findings closed per [security-findings.md](../operations/security-findings.md)
  (0 Critical open; external-firm leg the standing waiver); the e-invoicing clause
  resolved per the documented decision
  ([compliance/DR-001](../decisions/compliance/DR-001-zatca-scope-and-timing.md),
  OPEN option C): the launch segment excludes e-invoicing-requiring taxpayers — the
  ZATCA adapter ships as the honest `UNVERIFIED` refuse-to-submit stub. Gate-run
  outputs on the release SHA: **typecheck 8/8 · lint 8/8 · depcruise 0/2209 · DB suite
  143 files/2035 tests ALL GREEN (incl. the GA load specs: T-01 8ms · T-02 23ms ·
  T-04 1576ms statements · T-05 122ms · T-06 183ms · T-07 0.000% · T-08 111.3
  posts/s; spike 429@1001; hammer isolation 14ms; soak retained-heap 0.996) ·
  drift battery 29/29 + 244=244 + 3399=3399 · restore drills §4 1.3s / §7 1.1s
  both PASSED · check:observability 19/19 — gate run 2026-11-06**

### Enterprise Depth gate (end of PHASE-034)

- Consolidated statements reconcile to member books: consolidated TB/IS/BS = Σ member
  statements (group currency, dated FX) − eliminations (INV-026, golden G-32).
- Eliminations proven: every elimination is a balanced journal posted only in the
  parent's consolidation books, reversible only by counter-entry (BR-056); zero
  cross-tenant writes (ADR-0018).
- Payroll, fixed-assets, and notes/installments suites green (INV-023…INV-025, goldens
  G-21…G-31) — stage-9 depth runs on the proven GA core.
- Exit evidence per [PHASE_ACCEPTANCE_CRITERIA.md](PHASE_ACCEPTANCE_CRITERIA.md) §026–034.

## Sequencing rationale (key decisions)

1. **Tax engine (P-009) BEFORE purchasing/sales (P-011/012)**: invoices must carry tax
   treatments from their first version; retrofitting tax lines into posted documents is
   impossible (immutability).
2. **Treasury (P-008) before sales/purchasing**: receipts/payments are consumed by both
   trade modules; partners' opening balances need AR/AP subledger + control accounts
   which exist after P-007.
3. **Reporting engine (P-013) after trade modules**: statements must reconcile to real
   transactional data, not stubs; but report *contract* foundation is defined in docs now
   and consumed progressively (financial statement needs only P-007 data — PHASE-013
   builds the engine, with earlier phases providing data).
4. **POS (P-016) after MVP**: POS needs the industry framework and a scoped offline
   queue; forcing it into MVP would delay the commercial launch for a segment that can
   launch with back-office invoicing.
5. **Offline sync foundation (P-020) generalized AFTER POS**: POS ships a narrowly
   scoped, documented offline queue (P-016) as the first real consumer; the generalized
   protocol (P-020) then abstracts it — this avoids designing sync in the abstract.
6. **E-invoicing implementation (P-023) last**: requires verified official
   specifications, credentials, and certification paths that must not be fabricated;
   the architecture (adapters) is ready from P-009, so implementation is isolated.
7. **Financial-depth modules (P-026…029) after GA**: they extend a proven core — every
   new posting flows through the same posting engine, invariants, and golden datasets
   (ED-01); building them before GA would delay the commercial launch for depth that
   early customers do not need yet.
8. **Commercial shells (P-030…033) before deep verticals** (ED-11): configuration-layer
   templates over existing modules ship industry value fast without new core surface;
   deep-vertical operations (clinical HIS, academic LMS, agronomy science) wait for
   explicit decision records.
9. **Consolidation last (P-034)**: it reads everything — member books, dated FX,
   fixed-asset and payroll data — so it lands after the modules it consumes and closes
   stage 11 with the Enterprise Depth gate.

## Scope discipline rules

- A phase may pull scope **forward** from a later phase only via a decision record that
  also moves the later phase's scope explicitly.
- No phase implements beyond its document; "while I'm here" changes are code-review
  blockers ([../implementation/templates/CODE_REVIEW_TEMPLATE.md](../implementation/templates/CODE_REVIEW_TEMPLATE.md)).
- Every phase ends with updated [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md),
  a completion report with evidence, and `CHANGELOG.md` entries.
- **Stages 9–11 (PHASE-026…034) are additive post-GA releases**
  ([../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md), ED-01): they may never alter the
  MVP (PHASE-014) or GA (PHASE-025) gate criteria, and no expansion scope may be pulled
  backward into stages 1–8.
