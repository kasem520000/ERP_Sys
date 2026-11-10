# PHASE-018 — Manufacturing & Production

> **Status:** COMPLETE · **Updated:** 2026-11-03 (evidence:
> [reports/PHASE-018-COMPLETION.md](reports/PHASE-018-COMPLETION.md))

## 1. Phase Overview

- **Phase ID:** PHASE-018
- **Title:** Manufacturing & Production
- **Objective:** Ship the `manufacturing` module per
  [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md) — versioned
  multi-level bills of materials, production orders following the documented lifecycle,
  batch-tracked material consumption into WIP, finished-goods receipt at computed
  production cost, reason-coded scrap, batch genealogy for recall traceability, and
  pass/fail QC gates — and apply the `industry.food_manufacturing` template whose
  expiry/QC/genealogy defaults exercise all of it. All ledger effects flow through the
  canonical production rules (DR WIP · CR inventory at consumption; DR FG · CR WIP at
  completion; DR scrap expense · CR WIP) and reconcile to the GL continuously
  (INV-010 WIP).
- **Business value:** Bakeries, dairies, and packaged-food producers get recipe-driven
  production with real costing and recall-grade traceability on the same books as their
  shop — WIP that nets to zero per order, scrap that lands in the P&L honestly, and a
  genealogy search that answers "which batches used this flour" in seconds.

## 2. Scope

In scope:

1. **Bills of materials** (`manufacturing.bom`): `bills_of_materials` versioned per
   finished/semi-finished item — components with quantities per output UoM, **yield**
   (expected output vs input), **scrap factors** per component, version history with
   effective dates (a production order binds the BOM version at release); multi-level
   recipes via semi-finished items (chaining orders — one FG item per order line, no
   co-product splits, per the template limitation); **explosion service** computing
   gross material requirements (multi-level, applying yield and scrap factors).
2. **Production orders** (`manufacturing.production_orders`):
   `production_orders` with lifecycle **DRAFT → RELEASED → IN_PROGRESS → COMPLETED /
   CANCELLED (before consumption)** per
   [DOCUMENT_LIFECYCLE.md §3](../../accounting/DOCUMENT_LIFECYCLE.md); number reserved
   at release (`PRD-{yyyy}-{seq:5}`, per-branch, `reserve_on_approval: true` in the
   template); planned quantity/date/line; consumption and completion are incremental
   within IN_PROGRESS; COMPLETED posts the FG/WIP journals and closes the order;
   CANCELLED allowed only before any consumption.
3. **Material consumption** (`production_consumptions`): batch-tracked issue of
   components from the materials warehouse — **Journal: DR WIP · CR inventory at issue
   cost** (WAC/FIFO per item,
   [INVENTORY_ACCOUNTING.md §2](../../accounting/INVENTORY_ACCOUNTING.md)); each
   consumption records the material batch id (genealogy upstream edges); stock moves
   atomic with journals (INV-018); consumption beyond the BOM-planned quantity triggers
   the **consumption-variance review task** at the template threshold (default 5%) —
   correction is an adjusted consumption, never a silent edit.
4. **WIP accounting** (`manufacturing.wip`): the `WIP` account purpose
   ([CHART_OF_ACCOUNTS.md §2](../../accounting/CHART_OF_ACCOUNTS.md) — mapped before
   any production posts, `PURPOSE_NOT_MAPPED` fails closed) tracks WIP **per production
   order**; at completion WIP nets to zero for the order; continuous reconciliation to
   the GL per INV-010 (Σ order WIP balances = WIP account; drift is a Sev-1
   data-integrity incident per
   [RECONCILIATION.md](../../accounting/RECONCILIATION.md) discipline).
5. **Finished goods receipt at production cost** (`manufacturing.costing`): completion
   creates the FG batch and receives it into the FG warehouse at **computed production
   cost = consumed materials (actual issue costs) + labor + overhead absorption where
   enabled** (simple configured rates per production order — no shop-floor time
   capture, documented limitation; restaurants' prep-recipes reuse this at small
   scale). **Journal: DR finished goods inventory (at production cost) · CR WIP**.
   Actual-vs-planned (BOM) variance is reported, not auto-backflushed.
6. **Scrap** (`manufacturing.scrap`): scrap reporting with **reason codes** at
   consumption/output points — **Journal: DR `PRODUCTION_SCRAP` expense · CR WIP**
   ([CHART_OF_ACCOUNTS.md §2](../../accounting/CHART_OF_ACCOUNTS.md) purpose);
   `scrap_reason_required` template policy; failed QC units route to scrap with the
   same posting.
7. **Batch genealogy** (`manufacturing.batch_genealogy`): linkage of consumed material
   batches → produced FG batch (upstream) and produced batch → downstream sales lines
   (backward/forward trace via `item_batches` + production consumption references);
   read-only recall analytics — never alters posted documents; requires
   `inventory.batch_tracking` (closure per FEATURE_CATALOG).
8. **QC basics** (`manufacturing.qc`): `inspections` with pass/fail/sampled results and
   dispositions (accept / scrap / rework / return-to-supplier) attachable to goods
   receipts and production completions; a REQUIRED QC gate at completion
   (`production_qc_gate: required` template policy) **quarantines** the FG batch
   (stock status flag — not a new ledger state) until inspection passes; failures route
   to scrap (journal as item 6) or return; passing has no journal — it releases
   quarantine. `manufacturing.qc_inspection_log` report.
9. **Expiry & batch defaults from the template**: FG batches get
   `expiry = production date + shelf-life days` (`fg_batch_expiry_from_shelf_life`);
   materials and FG follow FEFO issuing; near-expiry markdown (revenue-side only) and
   expiry write-off reuse the PHASE-015/010 flows (`grocery.expiry_writeoff` shared
   report, approval-gated `EXPIRED` shrinkage).
10. **Production costing reconciliation & reports**: `manufacturing.production_cost`
    (planned vs actual material/labor/overhead per order with yield and scrap —
    dashboard), `manufacturing.batch_genealogy`, `manufacturing.qc_inspection_log`,
    plus the shared `inventory.expiry_list` — all on the PHASE-013 report contract
    with GL tie-outs ([industries/reports/README.md](../../industries/reports/README.md)
    PHASE-018 rows).
11. **UI**: BOM editor (versions, yield/scrap, component picker), production order
    workspace (release → consumption entry with batch pickers → scrap → QC →
    completion), genealogy search (batch → upstream/downstream trees), production cost
    report view.
12. **Template application**: `industry.food_manufacturing` v1.0.0 per
    [food-manufacturing.md](../../industries/templates/food-manufacturing.md) via the
    PHASE-015 engine — terminology (`الوصفة`, `أمر الإنتاج`, `المردود`, `الهالك`,
    `بوابة فحص الجودة`, `شجرة الدفعات`…), production/traceability navigation,
    policies, series, pins, onboarding steps (raw/WIP/FG warehouses, recipes with
    yield, shelf-life defaults, first production run).

Out of scope (explicit):

- MRP / demand-driven planning (OQ-006 — non-goal), finite capacity scheduling, MES /
  shop-floor IoT / OEE, machine telemetry.
- Labor time capture and payroll-grade costing; activity-based costing beyond simple
  configured absorption rates.
- Co-product/by-product splits (one FG item per order line — chaining via semi-finished
  batches instead); simultaneous co-products.
- Allergen/nutrition labeling, HACCP documentation management (QC here is pass/fail/
  sampled inspection only).
- Automatic backflush correction of consumption variances (review + adjusted
  consumption instead).
- Barcode-POS factory outlet (POS features already shipped in PHASE-016 — the optional
  outlet entries are configuration, not new code).

## 3. Prerequisites

- **PHASE-017 COMPLETE**: industry framework maturity proven on two templates;
  batch/transfer/conservation baseline proven; posting-path patterns (job-card COGS,
  settlement variance) reusable. Verified via completion report + green CI.
- Consumed as-is: PHASE-010 (stock ledger, batches/expiry/FEFO, transfers, counts),
  PHASE-011 (GRN + landed costs for imported ingredients — REQUIRED in the template),
  PHASE-007 (WIP/PRODUCTION_SCRAP purposes on the CoA template, cost centers, periods),
  PHASE-013 (report contract), PHASE-015 (template engine).
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (production
  journals only through the engine),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (cost math on decimal
  primitives), [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md)
  (no hard-coded fiscal behavior in production docs).
- Relevant documentation:
  [food-manufacturing.md](../../industries/templates/food-manufacturing.md),
  [industry-workflows.md (d)](../../industries/workflows/industry-workflows.md)
  (bakery production with per-step journals),
  [CAPABILITY_MATRIX.md §2.7](../../industries/capabilities/CAPABILITY_MATRIX.md)
  (`bom_production`, `batch_genealogy`, `qc_inspections`),
  [INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) (§2 production
  rows), [POSTING_ENGINE.md §4](../../accounting/POSTING_ENGINE.md) (production
  completion/scrap rows), [DOCUMENT_LIFECYCLE.md §3](../../accounting/DOCUMENT_LIFECYCLE.md)
  (production order states), [ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (INV-010/011/013/018), [CHART_OF_ACCOUNTS.md](../../accounting/CHART_OF_ACCOUNTS.md)
  (WIP, PRODUCTION_SCRAP), [AUTHORIZATION_MATRIX.md §3.8](../../security/AUTHORIZATION_MATRIX.md)
  (`manufacturing.boms.manage`, `manufacturing.production_orders.*`).

## 4. Design Impact

- **Database changes:** manufacturing-owned `bills_of_materials` (+ version/line
  child tables), `production_orders` (+ lines: planned vs actual), 
  `production_consumptions` (order, item, batch, qty, unit cost, journal ref),
  `inspections` (target GRN/order, results, disposition, quarantined batch ref);
  `item_batches` gains produced-batch provenance (production order ref — additive);
  warehouse-role fields for raw/WIP/FG conventions (settings, not new tables).
  **ENTITY_CATALOG currently has no manufacturing section** — this phase adds it
  (tables + ERD cluster) per the sync rule.
- **API changes:** BOM CRUD + versioning + explosion endpoint; production order
  lifecycle actions (`/release`, `/consume`, `/scrap`, `/complete`, `/cancel`);
  inspections CRUD + gate resolution; genealogy query endpoints (upstream/downstream
  by batch); production cost report parameters. Action-endpoint style per
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md); contracts in `packages/contracts`.
- **UI changes:** BOM editor, production order workspace, QC inspection entry, genealogy
  search screen (batch tree), production cost report — workspace/list/report archetypes
  per [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md); bilingual RTL-first.
- **Security & authorization:** permission keys seeded per AUTHORIZATION_MATRIX §3.8 —
  `manufacturing.boms.manage`, `manufacturing.production_orders.view/create/approve/
  post` (approve/post **risky**), reconciled with FEATURE_CATALOG keys
  (`manufacturing.bom.manage`, `manufacturing.production.manage`,
  `manufacturing.costing.read`, `manufacturing.scrap.post`,
  `manufacturing.genealogy.read`, `manufacturing.qc.manage`); role templates updated
  (warehouse creates orders; owner approves/posts).
- **Accounting implications:** exercises the canonical production rules — consumption
  (DR WIP · CR inventory), completion (DR FG · CR WIP at material+labor+overhead),
  scrap (DR PRODUCTION_SCRAP · CR WIP); new coverage: INV-010 extended to WIP
  (order-level WIP = account balance), INV-013 (release/consume/complete idempotent
  operations), INV-018 (consumption/FG moves atomic with journals), INV-011 (posting
  date in open period — completion during a lock fails closed). The WIP and
  PRODUCTION_SCRAP purposes must be mapped before first production post (fail closed).
- **Localization implications:** template terminology AR/EN (`الوصفة (قائمة المواد)`,
  `أمر الإنتاج`, `المردود`, `الهالك`…); batch/expiry labels; RTL report layouts;
  numerals per tenant locale.
- **Offline implications:** none — production is online-only (not in the capabilities
  matrix write set); the matrix gains no rows in this phase (quarantine is a stock
  status, not an offline state).
- **Module dependencies:** new `manufacturing` module (BOM, orders, consumptions,
  inspections, costing services) depending on `items` (item master, UoM), `inventory`
  (issue/receive/batches via published services — never direct table writes),
  `accounting` (posting engine, purposes, periods), `reporting` (report registry);
  `configuration` consumes nothing new. Direction: manufacturing → {items, inventory,
  accounting, reporting} only ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md),
  [DEPENDENCY_RULES.md](../../architecture/DEPENDENCY_RULES.md)).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | BOM domain: versions, components, yield, scrap factors, effective dates; explosion service (multi-level, yield/scrap math) | `apps/api/src/modules/manufacturing/bom/**` | property tests on explosion math (yield × scrap factors compose exactly; 6-decimal qty precision); version-binding-at-release test |
| T2 | Production order lifecycle + numbering at release + CANCELLED-before-consumption rule | `apps/api/src/modules/manufacturing/orders/**` | state-machine tests per DOCUMENT_LIFECYCLE §3; cancel-after-consumption rejected; number reserved at release (INV-021) |
| T3 | Consumption service: batch-tracked issue → DR WIP · CR inventory; genealogy upstream edges; variance-threshold review task | `apps/api/src/modules/manufacturing/orders/application/consume/**` | golden test: consumption journal at issue cost; INV-018 atomicity; FEFO batch proposal; >5% variance triggers review task |
| T4 | Completion + costing: FG batch (expiry from shelf life), production cost = materials + labor + overhead rates, DR FG · CR WIP; WIP nets to zero | `apps/api/src/modules/manufacturing/orders/application/complete/**` | **costing golden tests (multi-level BOM with scrap %)**: chained semi-finished orders; WIP zero per order; expiry = production + shelf life |
| T5 | Scrap service: reason codes, DR PRODUCTION_SCRAP · CR WIP; failed-QC routing | `apps/api/src/modules/manufacturing/orders/application/scrap/**` | golden scrap journal; reason-required policy; scrap does not break WIP reconciliation |
| T6 | QC inspections + quarantine status + gate at completion; GRN-attachable inspections | `apps/api/src/modules/manufacturing/qc/**` | gate tests: quarantined FG not sellable (availability excludes it); pass ⇒ release, no journal; fail ⇒ scrap journal or return disposition |
| T7 | Genealogy queries: upstream (batch → consumed batches) and downstream (batch → sales lines) + recall listing | `apps/api/src/modules/manufacturing/genealogy/**` | **genealogy trace tests**: multi-level chain fixture — trace FG batch → level-2 material batches → downstream invoices; read-only guarantee |
| T8 | WIP reconciliation job (per order + account level) wired into the reconciliation health center | `apps/api/src/modules/{manufacturing,accounting}/**` | seeded-drift test: manufactured imbalance surfaces as BROKEN (INV-010) |
| T9 | Reports: `manufacturing.production_cost`, `manufacturing.batch_genealogy`, `manufacturing.qc_inspection_log` (+ shared expiry pins) | `apps/api/src/modules/{manufacturing,reporting}/**` | fixtures with GL tie-outs (production cost ↔ WIP/FG journals) |
| T10 | UI: BOM editor, order workspace, QC entry, genealogy search, cost report | `apps/web/src/features/manufacturing/**` | component + a11y tests AR/EN; visual snapshots; keyboard-complete consumption entry |
| T11 | Apply `industry.food_manufacturing` template (manifest seed + engine apply + pins/checklists) | `apps/api/src/modules/configuration/infrastructure/seeds/**` | all seven per-template tests (industries/README §8) incl. switch safety (`industry.restaurant` → `industry.food_manufacturing` adds production menus, POS history untouched) |
| T12 | Permission seeds + role-template updates + catalog/ERD additions | `apps/api/src/modules/identity/**`, seeds, `docs/database/**` | permission matrix tests; docs validation green |

## 6. Verification

**Automated tests (required):**

- **Costing golden tests (multi-level BOM with scrap %)**: fixture — FG item with a
  two-level recipe (semi-finished dough → bread; flour/yeast/packaging with yield and
  per-component scrap factors): assert per-step persisted journal lines — consumption
  (DR WIP · CR inventory at actual issue cost, per batch), semi-finished completion
  (DR semi-finished inventory · CR WIP), final completion (DR FG · CR WIP at materials
  + configured labor/overhead), scrap events (DR PRODUCTION_SCRAP · CR WIP with reason)
  — final: per-order WIP nets to **exactly zero** and the FG unit cost equals the
  computed production cost; INV-001/002 balance in doc and base currency.
- **Genealogy trace tests**: from the same fixture, forward trace (flour batch → all
  produced batches → invoices that sold them) and backward trace (sold FG batch →
  consumed material batches, multi-level); read-only assertion (no mutation path
  exists); empty-result behavior for untracked items.
- **WIP reconciliation tests**: INV-010 extension — Σ per-order WIP = WIP account at
  every step; seeded drift (a manual journal hitting WIP without a source order)
  surfaces as BROKEN in the reconciliation health center; completion into a LOCKED
  period rejected with `PERIOD_LOCKED` and zero residue.
- **Lifecycle/state tests**: full matrix of legal transitions; CANCELLED only before
  consumption; re-release/complete idempotency (INV-013 — a replayed completion
  command returns the original result, no second FG receipt).
- **QC gate tests**: REQUIRED gate blocks sellability of the FG batch until pass
  (availability query excludes quarantined); sampled inspections; dispositions post
  correctly (scrap journal / return); `qc_inspection_log` fixture.
- **BOM property tests**: explosion determinism; yield/scrap composition exactness;
  version binding (order keeps its released version despite a newer BOM).
- **Template tests**: all seven per-template requirements for
  `industry.food_manufacturing`, including switch safety from `industry.restaurant`
  (additive-only, BR-038) and degraded-entitlement behavior.
- **Report fixtures** with GL tie-outs; permission matrix tests for all new routes;
  failure-case tests mandatory for each posting rule (`PERIOD_LOCKED`,
  `PURPOSE_NOT_MAPPED` when WIP/SCRAP unmapped, `INSUFFICIENT_STOCK` on consumption,
  `ALREADY_POSTED` on replay).

**Manual verification:**

1. Author the two-level bread recipe with yield 95% and 2% flour scrap; release an
   order for 1,000 units; consume in two batches (FEFO proposals); introduce one scrap
   event (`BURNT`); pass QC; complete — inspect the production cost report
   (planned vs actual) and the zero WIP balance.
2. Trace: from the completed FG batch, run the genealogy search backward to the flour
   batches and forward to the invoice that sold it.
3. Lock the period mid-order → completion fails with the typed error; reopen per
   INV-020 flow; complete.
4. Apply the template to a fresh tenant: terminology, menus, series (`PRD-`), pins,
   onboarding checklist match the manifest byte-for-byte (AR + EN).

**Acceptance criteria (objective):** *(mirrored into `PHASE_ACCEPTANCE_CRITERIA.md`
row 018 when that file exists.)*

1. Multi-level costing golden test green: per-order WIP nets to exactly zero; FG cost
   = materials + labor + overhead absorption; all journals fixture-exact.
2. Genealogy forward/backward traces correct on the multi-level fixture and read-only.
3. Consumption and completion are atomic with their journals (INV-018) and idempotent
   under replay (INV-013).
4. QC gate: quarantined FG is invisible to availability/sales until pass; failures
   post scrap with reason; passing posts nothing.
5. FG batches receive expiry = production date + shelf-life days; FEFO applies to
   materials and FG.
6. Scrap posts to `PRODUCTION_SCRAP` with reason codes; consumption variance beyond
   the threshold creates a review task, never a silent correction.
7. WIP reconciliation (INV-010) is live in the health center and detects seeded drift.
8. `industry.food_manufacturing` passes all seven per-template tests and switches
   additively from `industry.restaurant` with zero data loss (BR-038).
9. All manufacturing routes enforce the seeded permissions (approve/post risky,
   audited); owner/warehouse role split verified.
10. ENTITY_CATALOG gains the manufacturing section (+ TABLES/ERD); FEATURE_CATALOG
    Phase columns confirmed; docs validation green.

**Performance & security considerations:** explosion of a 5-level × 200-component BOM
p95 ≤ 300 ms; genealogy query over 10k batches p95 ≤ 2 s (recursive CTE, tenant-scoped
indexes); consumption/complete transactions ≤ 1 s at fixture scale. Consumption cannot
exceed on-hand (BR-013 default); production posting requires mapped WIP/SCRAP purposes
(fail closed); risky permissions audited; no direct journal writes from manufacturing.

**Migration & rollback:** additive migrations (manufacturing tables, batch provenance
columns, warehouse settings). Rollback: disable the manufacturing add-on → features
move to read-only historical access (posted orders/inspections stay readable);
dev-only schema revert otherwise; no existing posting rule is touched by rollback.

## 7. Risks and Constraints

- **RISK-009** (accounting correctness): WIP is the phase's sacred surface — the
  exactly-zero-per-order invariant plus INV-010 health-center coverage are the gate;
  any drift is Sev-1.
- **RISK-012** (Drizzle friction): recursive genealogy queries may exercise the
  raw-SQL escape hatch — permitted with a recorded note per PHASE-002 precedent.
- **RISK-016** (boundary erosion): manufacturing must consume inventory/accounting
  services, never write their tables; dependency-cruiser extended.
- **RISK-002** (template genericity): food-manufacturing terminology and the bakery
  workflow fixtures keep the template concrete; design-partner validation at rollout.
- Costing-accuracy risk (configured labor/overhead vs actual): the platform labels
  absorption rates honestly (documented limitation — no shop-floor time capture);
  reports show planned vs actual, never implying payroll-grade precision.
- Constraints: no MRP, no scheduling, no co-products (template + OQ-006 non-goals);
  one FG item per order line; QC is pass/fail/sampled only.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-018-COMPLETION.md` with: costing-golden
  outputs (multi-level, scrap %), genealogy trace outputs, WIP reconciliation evidence
  (including seeded-drift detection), lifecycle/QC test results, template test
  results, permission matrix output, docs validation, perf numbers.
- **Documentation updates required:** IMPLEMENTATION_STATUS (PHASE-018 → COMPLETE),
  CURRENT_STATE, CHANGELOG, ENTITY_CATALOG + TABLES + ERD (manufacturing cluster),
  FEATURE_CATALOG (Phase columns for `manufacturing.*`), INDUSTRY_CATALOG pointers,
  RECONCILIATION.md (WIP check row if absent), permission seeds note.
- **Exit criteria:** all acceptance criteria green with evidence; WIP proven
  zero-netting and GL-reconciled; genealogy proven multi-level; template live via the
  unmodified engine; docs synchronized.
- **Definition of Done:** manufacturing module + template + reports + UI + tests merged;
  CI green; zero TODOs in delivered scope.
- **Handoff instructions:** the restaurant template's OPTIONAL `bom_production`
  entries (prep recipes) are now live configuration for `industry.restaurant` tenants
  with the manufacturing add-on — verify degradation without the add-on remains clean.
  **Next eligible phase: PHASE-019 — CRM, Service Contracts & Projects**
  (parallel-eligible with 018 per the graph if 018 completed first; identify only, do
  not implement).
