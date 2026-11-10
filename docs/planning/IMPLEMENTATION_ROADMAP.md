# IMPLEMENTATION_ROADMAP — Consolidated Phased Delivery Plan

> **Status:** STABLE · **Owner:** Platform Architecture · **Updated:** 2026-10-28 (consolidation pass; v2.0 expansion §6 appended)
> **Authority:** This is the consolidated view of the 34-phase plan (001–025 v1.1 baseline
> + 026–034 v2.0 expansion — §6). Per-phase normative
> detail remains in [../implementation/phases/PHASE-001.md](../implementation/phases/PHASE-001.md) …
> [PHASE-034.md](../implementation/phases/PHASE-034.md) (29-section format), acceptance criteria in
> [PHASE_ACCEPTANCE_CRITERIA.md](PHASE_ACCEPTANCE_CRITERIA.md), dependencies in
> [PHASE_DEPENDENCY_GRAPH.md](PHASE_DEPENDENCY_GRAPH.md), release strategy in [RELEASE_STRATEGY.md](RELEASE_STRATEGY.md).
> The phase sequence is unchanged from the validated baseline — consolidation adds
> scope items into existing phases (§"Consolidation deltas") rather than renumbering.

## 1. Stage gates

- **MVP release gate = end of PHASE-014** (subscription/billing/onboarding/dashboards +
  security & performance review). **GA gate = end of PHASE-025**.
- **Enterprise Depth gate = end of PHASE-034** — stages 9–11 are post-GA additive releases
  that never alter the MVP/GA gates (ED-01; §6).
- Every phase: prerequisites must be met by *completed* phases (per completion reports,
  not claims); acceptance criteria are objectively checkable; full re-run of the
  invariant + isolation suites is mandatory for phases touching posting, RLS, or authz.

## 2. Phase plan (with consolidation deltas and effort bands)

| # | Phase | Prereq | Consolidation deltas (source) | Effort band |
|---|-------|--------|-------------------------------|-------------|
| 001 | Repository & engineering foundation | — | none | S |
| 002 | Database & migration infrastructure (Drizzle, RLS helpers, audit triggers, pg-boss, storage) | 001 | none (DEF-010 test hook prepared) | M |
| 003 | Identity, multi-tenancy & audit core (auth, sessions, MFA, roles, RLS enforcement, attack tests A1–A11) | 002 | login/refresh **excluded from idempotency keys** (F2) | L |
| 004 | Tenant provisioning & platform administration | 003 | none | M |
| 005 | Design system, i18n & RTL foundation | 004 | **document-status badge binding + APPROVED token** (F2) into token/component work | M |
| 006 | Master data (partners, items, UoM, barcodes, price lists, opening-balance drafts, import/export) | 005 | none | L |
| 007 | Accounting core & posting engine (CoA, fiscal calendar, FX, journals, GL, approvals, opening balances, invariant suite) | 006 | **DEF-010: deferrable balance constraint trigger + engine-bypass test** (F4); `OPENING_EQUITY` purpose seeded (DEF-006) | XL |
| 008 | Treasury: cash, banking & expenses | 007 | permission keys `sales.receipts.*` / `purchasing.payments.*` (DEF-007) | L |
| 009 | Tax engine & jurisdiction packs | 007 | anti-fabrication **marketing rule** wired into pack tooling (F4) | L |
| 010 | Inventory & warehousing (WAC/FIFO, transfers, counts, batches/expiry/serials/IMEI) | 009 | **FEFO-picking vs costing decoupling rule** explicit + tested (F4) | XL |
| 011 | Purchasing & payables (PO/GRN/invoices/matching) | 010 | DEF-007 key fix applied to docs | L |
| 012 | Sales & receivables | 011 | DEF-007 key fix applied to docs | L |
| 013 | Reporting engine, financial statements & printing | 012 | **tafqit amount-in-words helper + fixtures** (F1); report-reconciliation independent-SQL method (F4) in test suite | L |
| 014 | Subscription, billing, onboarding & dashboards — **MVP** | 013 | none | L |
| 015 | Industry framework & priority templates (manifest engine + retail/grocery/restaurant) | 014 | consumes the **extracted manifest JSONs** (done in consolidation; engine validates against them) | M |
| 016 | Point of sale (incl. scoped offline sale queue) | 015 | none | L |
| 017 | Automotive & distribution templates | 016 | none | M |
| 018 | Manufacturing & production | 017 | none | L |
| 019 | CRM, service contracts & projects | 017 | none | M |
| 020 | Offline synchronization foundation (device registry, change feeds, conflict policies, local DB) | 016 | none | XL |
| 021 | Desktop application (Tauri) | 020 | DEF-002 ref fix applied to docs | M |
| 022 | Android application (Expo) | 020 | DEF-002 ref fix applied to docs | M |
| 023 | External integrations & e-invoicing (ZATCA, ETA evaluation, payments, e-commerce/shipping adapters) | 020 | DEF-003 ref fix applied to docs | L |
| 024 | Security hardening & compliance review | 023 | none | M |
| 025 | Performance, reliability & GA readiness | 024 | none | L |

Effort bands are **planning estimates for a senior full-stack team** (S ≈ 1–2 weeks,
M ≈ 2–4, L ≈ 4–8, XL ≈ 8–12; sequential-with-overlap model, AI-assisted development may
compress them but the plan does **not** assume compression). These bands were absent from
the baseline (register CR-0-General-01) and are required for capacity planning; they are
estimates, not commitments.

## 3. Critical path

001 → 002 → 003 → 007 (via 004/005/006) → 010 → 013 → **014 (MVP)** → 015 → 016 →
020 → 021/022/023 → 024 → **025 (GA)**. Tax (009) and treasury (008) run parallel to
010–012. The dependency graph in [PHASE_DEPENDENCY_GRAPH.md](PHASE_DEPENDENCY_GRAPH.md)
governs; parallelization notes there are binding.

## 4. Risks specific to this roadmap

1. **PHASE-023 bundling risk** (unchanged from baseline, flagged): ZATCA adapter + ETA
   evaluation + payment providers + commerce adapters in one phase. Mitigation recorded in
   [../decisions/compliance/DR-001-zatca-scope-and-timing.md](../decisions/compliance/DR-001-zatca-scope-and-timing.md)
   (clearance may be deferred post-GA); if certification lead times pressure the schedule,
   split 023 into 023a (ZATCA) / 023b (other adapters) — requires a roadmap decision
   record, not silent scope change.
2. **No calendar commitments in this plan** — sizing exists (§2) but staffing is a
   product-owner decision; the roadmap deliberately ships no dates (OQ-002-class decision).
3. Phase docs are the unit of execution; if a phase doc contradicts this roadmap, the
   **phase doc governs for its scope** and the discrepancy is a defect to fix in one of them.

## 5. Next recommended implementation unit

**PHASE-001** (repository & engineering foundation) — as specified in
[../implementation/phases/PHASE-001.md](../implementation/phases/PHASE-001.md), executed
under [../handoff/AGENT_START_HERE.md](../handoff/AGENT_START_HERE.md) with
evidence-based completion. No consolidated defect blocks it.

## 6. Blueprint v2.0 expansion (stages 9–11 — post-GA)

Per [../EXPANSION_REGISTER.md](../EXPANSION_REGISTER.md) (ED-01), the roadmap extends
post-GA to 34 phases in 11 stage groups; stages 9–11 are **additive releases that never
alter the MVP (014) or GA (025) gates**. Normative per-phase detail lives in
[../implementation/phases/PHASE-026.md](../implementation/phases/PHASE-026.md) …
[PHASE-034.md](../implementation/phases/PHASE-034.md) (29-section format); all canonical
identifiers (entities, feature keys, goldens, invariants, rules, reports, templates) are
fixed in the register.

| # | Phase | Stage | Prereqs (functional, after GA 025) | Module(s) |
|---|-------|-------|-------------------------------------|-----------|
| 026 | Fixed assets & depreciation | 9 — Financial Depth | 007, 013 | `fixed_assets` |
| 027 | Cheques, promissory notes & installments | 9 | 008, 012, 013 | `notes`, `installments` |
| 028 | Budgeting & variance control | 9 | 007, 013 | `budgeting` |
| 029 | Payroll: salaries, loans & end-of-service | 9 | 007, 008, 013 | `payroll` |
| 030 | Wholesale & electronics templates | 10 — Industry Expansion II | 015, 017, 019 | configuration over existing modules |
| 031 | Healthcare commercial shell | 10 | 015, 010, 012, 019, 027 | configuration + light extension |
| 032 | Education commercial shell | 10 | 015, 027 | configuration + light extension |
| 033 | Agriculture commercial shell | 10 | 015, 018 | configuration + light extension |
| 034 | Multi-entity consolidation | 11 — Enterprise Consolidation | 013, 026, 029 (+ dated FX from 007) | `consolidation` |

Effort bands for 026–034 are not yet assigned; the §2 bands cover phases 001–025 only,
and bands for the expansion phases will be added when each phase document is reviewed
for capacity planning. **Enterprise Depth release gate = end of PHASE-034**: consolidated
statements reconcile to member books with eliminations proven (INV-026) — see §1 and
[MASTER_ROADMAP.md](MASTER_ROADMAP.md) §Release gates.
