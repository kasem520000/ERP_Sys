# PHASE-010 — Inventory & Warehousing

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-010
- **Title:** Inventory & Warehousing
- **Objective:** Deliver the inventory module end-to-end: warehouses linked to branches,
  the append-only stock ledger (`stock_moves`), WAC and FIFO valuation engines with
  6-decimal internal cost precision, opening-stock posting (consuming PHASE-006 drafts),
  two-leg stock transfers with IN_TRANSIT state, full stock-count workflow with variance
  review and adjustment postings, batch/expiry/serial/IMEI tracking with FEFO issuing,
  soft reservations, reorder-level monitoring, the availability query service, and the
  inventory↔GL reconciliation job — every stock movement atomic with its journal effect
  through the posting engine.
- **Business value:** Stock is where money physically sits for trading businesses; a
  stock ledger that reconciles to the books (INV-010) and values issues truthfully
  (WAC/FIFO, returns at original cost) is the difference between trusted margins and
  guesswork — for the warehouse persona (P-03) it replaces paper counts with a bilingual
  count workspace (Journey D in
  [../../product/USER_JOURNEYS.md](../../product/USER_JOURNEYS.md)).

## 2. Scope

In scope:

1. **Warehouses & branch linkage** (feature `inventory.multi_warehouse`): `warehouses`
   entity (tenant-scoped, belongs to a branch from PHASE-004's registry), activation/
   deactivation, per-branch visibility rules; van warehouses are PHASE-017 and are NOT
   created here.
2. **`item_warehouse_settings`:** per-item-per-warehouse defaults — `reorder_level`,
   `min_qty`, plus the per-item costing method field (`wac` | `fifo`) consumed from the
   item master (PHASE-006).
3. **Stock ledger:** append-only `stock_moves` (🔒 per
   [../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) §inventory) with
   `direction` (IN/OUT), `move_kind` (receipt / issue / transfer_in / transfer_out /
   adjust), `qty`, `unit_cost`, `value_amount`, `batch_id`/`serial_id` when tracked,
   and full provenance (`source_type`, `source_id`, `moved_at`); no UPDATE/DELETE path
   exists in the module (guards + RLS, INV-018 substrate).
4. **WAC valuation engine** (feature `inventory.valuation`): moving average per
   [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md) §1
   — `newAvg = (qtyOnHand × oldAvg + qtyIn × unitCost) / (qtyOnHand + qtyIn)` after each
   receipt; issues price at the current average; internal cost precision 6 decimals
   (`numeric(19,6)` per
   [../../database/DATABASE_CONVENTIONS.md](../../database/DATABASE_CONVENTIONS.md) §4).
5. **FIFO valuation engine:** `stock_layers` created at receipt (qty + unit cost),
   consumed oldest-first on issue; Σ layer qty = on-hand qty exactly (property-tested).
6. **Per-item method lock + switch revaluation (INV-017, BR-014):** an item never mixes
   methods; switching requires no in-flight transactions and produces a dated
   **revaluation posting** (DR/CR inventory vs. appreciation/shrinkage purpose) — never
   retroactive restatement of past issues.
7. **Negative-stock policy (BR-013):** `inventory.allow_negative_stock = false` default;
   when a tenant explicitly enables it, issues price at last known average, quantities
   may go negative, and reports flag the negative state; ledger balance always holds.
8. **Opening stock posting:** consumes `opening_balance_docs` (kind `stock`) drafted in
   PHASE-006; posts through the PHASE-007 opening-balance service into the OPENING
   period: per-item lines create stock layers/moves + `DR INVENTORY · CR OPENING_EQUITY`
   (golden test G-16's stock leg,
   [../../testing/ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) §3).
9. **Stock transfers** (feature `inventory.stock_transfers`): `stock_transfers` with
   lines; lifecycle DRAFT → IN_TRANSIT → POSTED
   ([../../accounting/DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) §3);
   dispatch writes the OUT leg, receive writes the IN leg; IN_TRANSIT stock is visible
   but never sellable/reservable (BR-016); journal only when source/destination branches
   map distinct inventory accounts (POSTING_ENGINE §4 rule, golden G-15).
10. **Stock counts** (feature `inventory.stock_counts`): count sessions DRAFT → COUNTED
    → VARIANCE_REVIEW → POSTED; system-qty snapshot frozen at session start; blind-count
    option; movements after snapshot listed in variance review; per-line value impact at
    current valuation; recount with audit; approval (BR-015) posts adjustments — loss →
    `DR INVENTORY_SHRINKAGE · CR INVENTORY` (G-13), gain → `DR INVENTORY · CR
    INVENTORY_APPRECIATION` (G-14); reasons include `COUNT_LOSS`, `COUNT_GAIN`,
    `EXPIRED`, `DAMAGE`.
11. **Batch/lot + expiry tracking** (feature `inventory.batch_tracking`): `item_batches`
    with expiry dates; FEFO issuing for `has_expiry` items (BR-017); expiry write-off
    posts as shrinkage with reason `EXPIRED`.
12. **Serial/IMEI tracking** (feature `inventory.serial_tracking`): `item_serials` with
    status in_stock/sold/returned; issues bind specific units; returns must reference the
    originally sold unit (BR-018); tracking enforced only where the item is flagged.
13. **Soft reservations (MVP seam):** reservation pool with expiry
    (`stock_reservations`, soft semantics — availability netting only, never a hard
    allocation lock); the entitlement-bearing feature `inventory.reservations` (hard/soft
    policies) activates in PHASE-015 per
    [../../product/FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §inventory; the
    soft availability check is what PHASE-012 sales orders consume.
14. **Reorder-level monitoring:** `item_warehouse_settings.reorder_level` fields plus a
    nightly pg-boss check job emitting `stock.below_reorder` events through the
    notifications module (email adapter live since PHASE-003); the in-app alerting
    surface + replenishment suggestions + feature key `inventory.reorder_levels` land in
    PHASE-015 (BR-019: alert, not autopilot — no automatic POs).
15. **Availability query service:** on-hand / in-transit / reserved / available per
    item-warehouse (published service consumed by PHASE-011/012, later POS/manufacturing).
16. **Inventory↔GL reconciliation job** (INV-010): scheduled pg-boss check per
    [../../accounting/RECONCILIATION.md](../../accounting/RECONCILIATION.md) §1 row 3 —
    Σ(qty × valuation) per item/warehouse vs. the `INVENTORY` account(s), results stored
    as reconciliation records; drift is `BROKEN` → notification → Sev-1 discipline
    (RISK-009). The job also verifies INV-017 (no retroactive cost mutation) and
    INV-018 (no move without its economic effect) by construction.
17. **Manual receipts/issues** (`inventory.receipts.create` / `inventory.issues.create`):
    reason-coded direct stock moves for operational edge cases — never a way around the
    posting engine.
18. **UI screens** per [../../ui/PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md):
    warehouse management (Settings §8), item stock views + movement ledger (List+Search
    §2 with FilterBar), transfer wizard (Wizard §9), count workspace (Transaction Entry
    Workspace §4 variant), transfer/count detail (Document Detail §5).

Out of scope (explicit):

- Landed-cost allocation into receipts (PHASE-011 baseline, §3 of
  [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md)).
- Any GRN/purchase-driven receiving document (PHASE-011 owns goods receipts; this phase
  provides the `receiveStock` service they call).
- Sales/delivery-driven issuing documents (PHASE-012 calls `issueStock`).
- Hard reservation policies, reservation entitlement enforcement, replenishment
  suggestions, in-app reorder alerting (PHASE-015).
- Composite-item explosion (PHASE-015), production consumption/WIP (PHASE-018), van
  warehouses (PHASE-017), POS-scoped offline moves (PHASE-016/020).
- Report-contract registration of inventory reports (PHASE-013 engine; this phase ships
  the module query services — `stockQueries.*`, `valuationQueries.*`, `batchQueries.*`,
  `countQueries.*`, `serialQueries.*` — that the contracts will declare).
- Multi-currency stock valuation: unit costs are stored in tenant base currency only
  (FX purchases convert at the receipt's stored rate, INV-008).

## 3. Prerequisites

- Required phases: **PHASE-009** COMPLETE (tax engine — stock moves carry tax context
  where applicable and every later receiving document stamps tax snapshots); **PHASE-008**
  COMPLETE (treasury — partner/account opening-balance flows and the reconciliation-job
  pattern it established). Per
  [../../planning/PHASE_DEPENDENCY_GRAPH.md](../../planning/PHASE_DEPENDENCY_GRAPH.md),
  P-008 ∥ P-009 may run in parallel, but **both edges (008→010, 009→010) must be green
  with completion-report evidence before this phase starts**. Also required from earlier
  phases: PHASE-006 item master (costing-method field, tracking flags, opening-balance
  drafts), PHASE-007 posting engine + OPENING period + account purposes
  (`INVENTORY`, `INVENTORY_SHRINKAGE`, `INVENTORY_APPRECIATION`, `OPENING_EQUITY`),
  PHASE-004 branch registry.
- Required architecture decisions:
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (inventory
  never writes GL tables; it composes engine calls inside its own transaction),
  [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md) (6-decimal costs,
  decimal.js domain primitives),
  [ADR-0004](../../architecture/ADR/ADR-0004-postgresql-drizzle.md) (migration
  discipline), [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md) (pg-boss jobs
  for reconciliation + reorder checks).
- Relevant documentation:
  [../../accounting/INVENTORY_ACCOUNTING.md](../../accounting/INVENTORY_ACCOUNTING.md)
  (binding valuation + movement→journal rules),
  [../../accounting/POSTING_ENGINE.md](../../accounting/POSTING_ENGINE.md) (§4 stock
  rules, §1 service contract),
  [../../accounting/DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md)
  (transfer/count state machines),
  [../../accounting/ACCOUNTING_INVARIANTS.md](../../accounting/ACCOUNTING_INVARIANTS.md)
  (INV-010/017/018),
  [../../accounting/RECONCILIATION.md](../../accounting/RECONCILIATION.md),
  [../../product/BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-013…BR-019),
  [../../product/FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) §inventory,
  [../../security/AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.5,
  [../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) §inventory,
  [../../testing/ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) (G-13…G-16,
  property tests §4, RC-04/RC-05).

## 4. Design Impact

- **Database changes:** new tenant-owned tables — `warehouses`, `item_warehouse_settings`,
  `stock_moves` (append-only 🔒), `stock_layers`, `item_stock` (read model),
  `item_batches`, `item_serials`, `stock_counts`, `stock_count_lines`,
  `stock_transfers` (all per
  [../../database/ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) §inventory) **plus
  one new catalog row added in-phase per the sync rule: `stock_reservations`**
  (tenant_id, item_id, warehouse_id, qty, holder_type/holder_id, expires_at, status).
  Every table gets RLS + first-element-tenant indexes; `stock_moves` gets append-only
  guards like `audit_events` (PHASE-002 pattern). Migrations continue the `NNNN_*.sql`
  sequence; TABLES/column specs for inventory completed in
  [../../database/TABLES/](../../database/TABLES/) this phase.
- **API changes:** `/api/v1/inventory/warehouses` (CRUD, manage permission);
  `/api/v1/inventory/stock` and `/availability` (GET, view); `/api/v1/inventory/moves`
  (GET, ledger); `/api/v1/inventory/transfers` (+ `POST …/{id}/dispatch`, `…/receive`);
  `/api/v1/inventory/counts` (+ `/submit`, `/recount`, `/approve` — approve posts the
  adjustment); `/api/v1/inventory/adjustments` (+ `/post`); `/api/v1/inventory/receipts`,
  `/issues` (manual, reason-coded); `/api/v1/inventory/batches`, `/serials`;
  `/api/v1/inventory/items/{id}/method-switch` (dated revaluation). Action endpoints are
  POST verb sub-resources with Idempotency-Key per
  [../../api/API_CONVENTIONS.md](../../api/API_CONVENTIONS.md) §1–2.
- **UI changes:** warehouse management (Settings archetype), item stock + movement
  ledger lists, transfer wizard (dispatch → in-transit tracker → receive), count
  workspace (session create, sheet snapshot, line entry, variance review queue),
  document detail screens with `DocumentStatusBadge`
  ([../../ui/COMPONENT_CATALOG.md](../../ui/COMPONENT_CATALOG.md) §6.4) mapped to the
  transfer/count state tables; all strings AR+EN, RTL-first per
  [../../ui/RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md).
- **Security & authorization:** seed the PHASE-010 permission set from
  [../../security/AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) §3.5
  exactly (`inventory.stock.view`, `inventory.moves.view`,
  `inventory.receipts.create`/`inventory.issues.create`,
  `inventory.transfers.view/create/approve`, `inventory.counts.view/create/approve/post`,
  `inventory.adjustments.create/post`, `inventory.warehouses.manage`,
  `inventory.items.method_switch` (risky), `inventory.tracking.manage`); register every
  new table in `isolation/tables.registry.ts` and add A1–A11 attack coverage per
  [../../testing/TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md) §3.
- **Accounting implications:** new posting operations exercised through the engine —
  stock adjustments loss/gain (G-13/G-14), transfer between distinct valuation accounts
  (G-15, including the policy-none same-account case), opening stock (G-16 stock leg);
  invariants gained/reused: INV-010, INV-017, INV-018 (plus INV-001/002/004/011/013/014
  inherited from the engine). No journal may ever be written by the inventory module
  directly (ADR-0007).
- **Localization implications:** count sheets, movement reason codes, warehouse names,
  and state labels bilingual (AR canonical per [../../GLOSSARY.md](../../GLOSSARY.md));
  quantities render Western digits LTR-isolated inside RTL tables; Hijri/Gregorian date
  display on ledger filters follows the design-system pickers.
- **Offline implications:** none active — `stock_moves` OC flag is "POS only" and
  `stock_count_lines` "POS-lite" (ENTITY_CATALOG): the columns exist for PHASE-016/020
  but no sync path ships here; documented in
  [../../offline/OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  as PHASE-016/020 entries.
- **Module dependencies:** `inventory` depends on `items` (item master, UoM), `tenancy`
  (branches), `accounting` (PostingEngine, period checks), `audit`, `notifications`
  (event consumers); it publishes `receiveStock`/`issueStock`/`reserve`/`availability`/
  valuation queries consumed later by `purchasing`, `sales`, `pos`, `manufacturing`,
  `distribution` ([../../architecture/MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)
  — inventory exclusively owns `stock_moves`, `stock_layers`).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Migrations: inventory tables + RLS + append-only guards + registry rows + indexes | `apps/api/migrations/NNNN_inventory_core.sql`, `NNNN_inventory_tracking.sql` (next sequence numbers) | fresh-apply + regression-apply CI green; RLS presence check green |
| T2 | Warehouse service + `item_warehouse_settings` + branch linkage + seeds | `apps/api/src/modules/inventory/{api,application,domain,infrastructure}/**` | unit + isolation A-tests on new tables |
| T3 | WAC engine + `item_stock` read-model maintenance (6-decimal internal precision) | `apps/api/src/modules/inventory/domain/valuation/**` | property tests vs oracle datasets (WAC bounds, conservation) |
| T4 | FIFO engine over `stock_layers` (oldest-first, layer conservation) | `apps/api/src/modules/inventory/domain/valuation/fifo.ts` | property tests: Σ layer qty = on-hand; layers never negative |
| T5 | Movement service (receive/issue/adjust/transfer legs) — one transaction per move: stock rows + engine `post()` + audit | `apps/api/src/modules/inventory/application/movement-service.ts` | INV-018 atomicity tests (simulated mid-tx crash → neither); G-13/G-14/G-15 golden |
| T6 | Opening-stock flow consuming PHASE-006 drafts (OPENING period, per-item layers) | `apps/api/src/modules/inventory/application/opening-stock.ts` | G-16 stock leg golden; INV-009/010 green from entry #1 |
| T7 | Stock transfers: DRAFT → IN_TRANSIT → POSTED, two legs, BR-016 availability netting | `apps/api/src/modules/inventory/application/transfers.ts` | lifecycle tests + G-15 both branches (journal / policy-none) |
| T8 | Stock counts: snapshot, blind mode, line entry, variance review, approval → adjustment posting | `apps/api/src/modules/inventory/application/counts.ts` | Journey-D scripted E2E; BR-015 tolerance tests; locked-period rejection (INV-011) |
| T9 | Batch/expiry + serial/IMEI registries; FEFO issue ordering; serial sale/return binding | `apps/api/src/modules/inventory/application/tracking/**` | FEFO issue tests; BR-018 return-binding tests; expiry write-off posts shrinkage |
| T10 | Soft reservations (`stock_reservations`) + availability service (on-hand − reserved − in-transit) | `apps/api/src/modules/inventory/application/reservations.ts`, `availability.ts` | expiry sweep test; availability netting tests; no hard lock |
| T11 | Reorder monitoring pg-boss job → `stock.below_reorder` event → notifications (email adapter) | `apps/api/src/modules/inventory/application/reorder-job.ts` | job fixture: below-reorder item fires event exactly once per window |
| T12 | Reconciliation job INV-010 (+ INV-017/018 verification) with reconciliation records | `apps/api/src/modules/inventory/application/reconciliation.ts` | RC-04 green path; RC-05 seeded-drift → `BROKEN` with offending row |
| T13 | Method-lock + method-switch service (dated revaluation preview + posting) | `apps/api/src/modules/inventory/application/method-switch.ts` | INV-017 suite: switch without revaluation rejected; past issues unchanged |
| T14 | UI screens (warehouse mgmt, stock/movement lists, transfer wizard, count workspace) AR+EN | `apps/web/app/{locale}/inventory/**`, `packages/ui` reuse only | Playwright bilingual smoke; visual snapshots AR+EN |
| T15 | API routes + permission seeds + docs sync (ENTITY_CATALOG row for `stock_reservations`, TABLES specs, GLOSSARY terms) | `apps/api/src/modules/inventory/api/**`, `docs/database/**` | docs validation green; permission-seed-vs-matrix drift check green |

## 6. Verification

**Automated tests (required):**

- **Valuation property tests vs oracle datasets** (fast-check +
  hand-computed oracle fixtures): WAC — new average strictly within [min, max] of costs
  seen; `qtyOnHand × avg` = valuation total within 6-decimal rounding; issue-then-receipt
  never mutates past issue costs. FIFO — consumption order oldest-first always; Σ layer
  qty = on-hand exactly; valuation = Σ layer qty × cost (INV-010);
  [../../testing/ACCOUNTING_TESTS.md](../../testing/ACCOUNTING_TESTS.md) §4 rows 3–4.
- **Atomicity tests (INV-018):** every movement path (receipt, issue, adjustment,
  transfer legs, opening stock) commits stock rows + journal + audit in one transaction;
  a test double aborting mid-transaction leaves **neither**; no API path produces a move
  without its economic effect (or the policy-documented none-case for same-account
  transfers, asserted explicitly).
- **Golden posting tests:** G-13 (adjustment loss), G-14 (gain), G-15 (transfer between
  valuation accounts + policy-none case), G-16 (opening stock leg) — journal lines by
  purpose, subledger/stock effects, document state, audit event; each with the standard
  failure pack (locked period `PERIOD_LOCKED`, unmapped purpose `PURPOSE_NOT_MAPPED`,
  unbalanced `ENTRY_NOT_BALANCED`, duplicate `ALREADY_POSTED`) and zero-residue asserts.
- **INV-017 method-switch tests:** switch requires no in-flight transactions; produces a
  dated revaluation posting; retroactive restatement attempts rejected; history query
  returns original issue costs.
- **Reconciliation drift tests:** RC-04 (mixed ops incl. transfer-without-journal case)
  → `OK`; RC-05 (orphan `stock_move` seeded via test tooling) → `BROKEN` with the
  offending move id, notification fired, period close blocked
  ([../../accounting/RECONCILIATION.md](../../accounting/RECONCILIATION.md) §3).
- **FEFO issue tests:** expiry-enabled items issue earliest-expiry batch first (BR-017);
  non-expiry items unaffected; expiry write-off posts shrinkage with reason `EXPIRED`.
- **Tracking enforcement tests:** item flagged `has_batch` cannot receive/issue without
  batch; serial-tracked sale binds a specific in-stock unit; return must reference the
  originally sold serial (BR-018).
- **Concurrency:** CC-04 stock issue race — two concurrent issues of the last units: one
  wins, one fails `INSUFFICIENT_STOCK` with zero residue (default negative-stock-off
  policy); CC-05 period-lock race applies to adjustment posting.
- **Tenant isolation:** A1–A11 applicable rows against every new table
  ([../../testing/TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md) §3
  — registry CI-enforced); API spoofing: cross-branch warehouse reference → 403/404 with
  no existence leak.
- **Performance smoke:** movement ledger + stock queries at T-01 budget
  ([../../testing/PERFORMANCE_TEST_PLAN.md](../../testing/PERFORMANCE_TEST_PLAN.md)) on a
  seeded 100k-move tenant.

**Manual verification:**

1. Create a second warehouse under branch B1; confirm a branch-scoped `warehouse` role
   cannot see branch B2 warehouses.
2. Post opening stock from a PHASE-006 draft; verify stock layers, `item_stock`, and the
   `DR INVENTORY · CR OPENING_EQUITY` journal in one screen chain (document → journal).
3. Run a blind count: snapshot → enter counts → submit → variance review → approve;
   verify the adjustment journal and the movement ledger reason.
4. Dispatch a transfer and confirm the stock shows IN_TRANSIT (visible, not available);
   receive it at destination and confirm the two legs in the ledger.
5. Switch a FIFO item to WAC: preview shows the revaluation journal; post it; confirm
   past issues unchanged.
6. Force RC-05-style drift in a dev tenant via test tooling; confirm the reconciliation
   tile shows `BROKEN` and the accountant notification fires.

**Acceptance criteria (objective):**

1. All inventory tables exist with RLS, append-only guards on `stock_moves`, registry
   rows, and green migration CI (fresh + regression).
2. WAC and FIFO engines pass the oracle property suites with 6-decimal internal
   precision; an item never mixes methods; method switch always produces a dated
   revaluation posting (INV-017).
3. Every stock movement is atomic with its journal (INV-018) — proven by golden tests
   and crash-injection; the same-account transfer policy-none case is explicitly asserted.
4. INV-010 reconciliation job runs green on the seeded golden dataset and flags seeded
   drift as `BROKEN` with offending-row detail (RC-04/RC-05).
5. Opening stock posts from PHASE-006 drafts through the OPENING period with per-item
   layer detail; INV-009/010 hold from the first entry.
6. Transfers implement DRAFT → IN_TRANSIT → POSTED; IN_TRANSIT stock is excluded from
   availability (BR-016); cross-valuation-account transfers journal exactly per G-15.
7. Counts implement DRAFT → COUNTED → VARIANCE_REVIEW → POSTED with snapshot, variance
   approval (BR-015), and adjustment postings G-13/G-14; adjustment into a locked period
   is rejected (INV-011).
8. Batch/expiry/serial/IMEI tracking is enforced exactly where item-flagged; FEFO issues
   hold (BR-017); serial returns bind the original unit (BR-018).
9. Negative stock is rejected by default; when explicitly enabled, issues price at last
   known average and reports flag negatives (BR-013).
10. Soft reservations + availability service work; reorder job emits
    `stock.below_reorder` once per window per item-warehouse; no automatic POs exist.
11. Full acceptance list mirrored in
    [../../planning/PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md)
    (PHASE-010 row) once that consolidated file lands.

**Performance & security considerations:** stock ledger is the highest-volume table —
tenant-first composite indexes `(tenant_id, item_id, warehouse_id, moved_at)` minimum;
`item_stock` maintained transactionally (no eventually-consistent drift); statement
timeouts apply; movement queries must EXPLAIN-verify index use at 100k moves. Security:
append-only guards + RLS on every table; method-switch and count-post are risky
permissions (approval-separated, audited); no raw SQL in services.

**Migration & rollback:** migrations are expand-only (new tables; no changes to existing
tables beyond additive columns such as item costing fields if not already present from
PHASE-006). Rollback in dev = revert commits + drop the phase's tables; production is
forward-only per
[../../database/MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md). Because
`stock_moves` is append-only from day one, no rollback path may ever delete movements
written in production.

## 7. Risks and Constraints

- RISK-009 (accounting bugs destroy trust): the INV-010 job + RC-04/05 drift tests are
  the core deliverable, not garnish — any drift is Sev-1.
- RISK-014 (performance under real volumes): mitigated by the `item_stock` read model,
  tenant-first indexes, and the T-01 smoke gate; watch the reconciliation job cost on
  large tenants (batch by item).
- RISK-012 (Drizzle friction): heavy ledger queries may need raw-SQL escape hatch —
  permitted, recorded in the completion report.
- RISK-016 (boundary erosion): inventory must never import accounting repositories —
  only the PostingEngine service; CI boundary lint + review checklist.
- RISK-015 (Arabic/RTL edge cases): count sheets and reason codes get bilingual visual
  snapshots AR+EN.
- Constraint: method lock is **fixed** per item after first transaction (BR-014) — no
  tenant configuration may weaken it (INV-022).
- Constraint: reorder alerting is deliberately minimal here; do not build
  PHASE-015's in-app alert surface ("while I'm here" changes are review blockers per
  [../../planning/MASTER_ROADMAP.md](../../planning/MASTER_ROADMAP.md) scope-discipline
  rules).

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-010-COMPLETION.md` with: property/golden/
  atomicity/reconciliation test outputs (named suites), RC-05 drift proof, migration CI
  logs, isolation A-test output for every new table, T-01 smoke numbers, screenshots as
  secondary only.
- **Documentation updates required:** ENTITY_CATALOG (add `stock_reservations` row;
  confirm all §inventory rows match schema), TABLES inventory specs,
  IMPLEMENTATION_STATUS (PHASE-010 → COMPLETE), CHANGELOG, and — if any column deviated
  from the catalog — a decision record before merge.
- **Exit criteria:** all acceptance criteria green with evidence; invariants with new
  coverage (INV-010/017/018) listed in the report; docs validation green; no TODOs.
- **Definition of Done:** `main` contains the inventory module with all tables guarded,
  golden + property + isolation suites green in CI, UI screens bilingual with visual
  baselines, status files updated.
- **Handoff instructions:** next agent reads the PHASE-010 completion report, then the
  `receiveStock`/`issueStock`/availability service contracts in the module's published
  API — PHASE-011's goods receipts depend on them. **Next eligible phase: PHASE-011 —
  Purchasing & Payables** (identify only; do not implement).
