# Completion Report — PHASE-010

> **Status:** COMPLETE · **Updated:** 2026-10-30

## Report fields

| Field | Content |
|-------|---------|
| **Phase ID / Date** | PHASE-010 · 2026-10-30 |
| **Summary** | The inventory module ships end-to-end with every stock movement atomic with its journal effect: migrations `0014_inventory_core.sql` + `0015_inventory_tracking.sql` land 13 tenant tables (warehouses branch-linked with the per-warehouse GL override — the G-15 seam; `stock_moves` append-only by grants + guard trigger, even superuser DELETE refuses; `stock_layers` with consumed rows kept for the exact Σ property; the `item_stock` read model; transfers + lines; adjustments; reservations — the in-phase catalog addition; batches; serials; counts + lines) plus the `opening_balance_docs` STOCK status lift and the batches/serials FK expand steps. The movement core runs stock rows + `PostingEngine.post` + audit in ONE transaction (INV-018, crash-injection proven); WAC + FIFO value at 6-decimal internal precision (oracle property suites); opening stock consumes PHASE-006 drafts through the OPENING period (G-16); transfers run DRAFT → IN_TRANSIT → POSTED with the G-15 distinct-accounts journal and the policy-none same-account case asserted; counts run DRAFT → COUNTED → VARIANCE_REVIEW → POSTED with frozen snapshots, blind mode, BR-015 tolerance/supervisor, and G-13/G-14 posting; FEFO batches (BR-017), serial return-binding (BR-018), soft reservations + availability, the BR-019 reorder digest, the INV-010/RC-04/RC-05 reconciliation check registered into the PHASE-007 framework (PC-04 lock block + live checklist item), the INV-017 method switch with dated revaluation, and manual reason-coded receipts/issues/adjustments. 49 routes under `/api/v1/inventory`; 5 AR/EN web screens; a 0014 seed correction realigns the viewer template with matrix §3.5. |
| **Files created** | (below) |
| **Files changed** | (below) |
| **Database migrations** | `0014_inventory_core.sql`, `0015_inventory_tracking.sql` (below) |
| **API changes** | 49 routes under `/api/v1/inventory` (below) |
| **UI changes** | 5 screens + nav + i18n (below) |
| **Security changes** | (below) |
| **Tests executed** | (below) |
| **Actual test results** | (below) |
| **Build results** | (below) |
| **Invariants covered** | INV-010, INV-017, INV-018 (below) |
| **Acceptance criteria verification** | 10/10 PASS (below) |
| **Evidence** | (below) |
| **Known limitations** | (below) |
| **Deferred work** | (below) |
| **Documentation updated** | (below) |
| **Risks** | none added; RISK-009/012/014/015/016 mitigations exercised (below) |
| **Rollback instructions** | (below) |
| **Next eligible phase** | PHASE-011 — Purchasing & Payables (identify only) |

## Summary

Delivered per [../PHASE-010.md](../PHASE-010.md) and
[../../accounting/INVENTORY_ACCOUNTING.md](../../../accounting/INVENTORY_ACCOUNTING.md) /
[ADR-0007](../../../architecture/ADR/ADR-0007-centralized-posting-engine.md) /
[ADR-0009](../../../architecture/ADR/ADR-0009-money-precision.md): warehouses linked to the
PHASE-004 branch registry with per-warehouse GL inventory-account overrides, the
append-only `stock_moves` ledger (SELECT/INSERT-only grants + `trg_stock_moves_guard`
— the RC-05 proof shows even superuser DELETE refused; repairs are compensating
corrections and the documented test-tooling path), WAC and FIFO valuation engines as a
pure domain package at 6-decimal internal precision with the oracle property suite
(new average strictly within [min, max] of costs seen; Σ layer qty = on-hand exactly;
issue-then-receipt never mutates past issue costs), opening-stock posting that consumes
the PHASE-006 stock drafts through the OPENING period with per-item layers (G-16's stock
leg; INV-010 green from entry #1), two-leg transfers with IN_TRANSIT stock visible but
never sellable (BR-016) and journals only when the warehouses resolve distinct GL
accounts (G-15 + the policy-none case asserted), the full count workflow (Journey D:
snapshot frozen at creation, blind mode, audited recounts, BR-015 value-impact
tolerance with supervisor override, approval posting G-13 loss / G-14 gain, locked-period
rejection with zero residue), FEFO batch issuing with expiry write-off as EXPIRED
shrinkage (BR-017), the serial/IMEI registry with original-unit return binding (BR-018),
soft reservations with expiry sweep and the availability service (the PHASE-011/012
seam), the nightly reorder job firing `stock.below_reorder` email digests exactly once
per 24h window per item-warehouse (BR-019 — alert, never autopilot; no purchase tables
exist, asserted), the INV-010 reconciliation job (movement trail + pending IN legs vs
GL per resolved account, zero tolerance, orphan surfacing, PC-04 lock block, live
close-checklist item), per-item method lock with dated-revaluation switching (INV-017),
and manual reason-coded receipts/issues/adjustments. The 0014 migration also carries a
template correction: the PHASE-003-era `0005` seed pre-granted the viewer role
`inventory.transfers.view` / `inventory.counts.view`, which matrix §3.5 assigns to
warehouse + owner only — PHASE-010's route surface made the drift observable in the
identity checklist, so the module migration realigns the system template with the
matrix exactly (recorded here as the decision trail for the grant removal).

## Files created

**apps/api**
- `migrations/0014_inventory_core.sql` — 9 tables + RLS + grants + the append-only guard + the viewer-template correction + `_schema_state` → 14.
- `migrations/0015_inventory_tracking.sql` — 4 tables (batches/serials/counts/lines) + the stock_moves batch/serial FK expand steps + RLS + grants + `_schema_state` → 15.
- `src/modules/inventory/domain/inventory-errors.ts` — 29 typed error codes (ERROR_MODEL §4).
- `src/modules/inventory/domain/valuation/wac.ts` — the pure WAC engine (newAvg after each receipt; issues at current average; 6-dp Decimal).
- `src/modules/inventory/domain/valuation/fifo.ts` — the pure FIFO layer-consumption engine (oldest-first; exact Σ conservation).
- `src/modules/inventory/domain/valuation/valuation.spec.ts` — the oracle property suite (12 tests: WAC bounds, conservation, immutability of past issues, FIFO ordering).
- `src/modules/inventory/application/warehouse-service.ts` — warehouses + `item_warehouse_settings` + branch linkage (T2).
- `src/modules/inventory/application/movement-core.ts` — the one-transaction movement writer: stock rows + `PostingEngine.post` + audit (T5; INV-018).
- `src/modules/inventory/application/stock-service.ts` — manual receipts/issues, on-hand/availability/moves queries (T5/T10).
- `src/modules/inventory/application/adjustment-service.ts` — reason-coded adjustments DRAFT → POSTED (G-13/G-14).
- `src/modules/inventory/application/transfer-service.ts` — DRAFT → IN_TRANSIT → POSTED two-leg (T7; G-15/BR-016).
- `src/modules/inventory/application/count-service.ts` — the count workflow (T8; Journey D/BR-015).
- `src/modules/inventory/application/tracking-service.ts` — batches + serials registries, FEFO, write-off, sale/return binding (T9).
- `src/modules/inventory/application/reservation-service.ts` — the soft pool + sweep (T10).
- `src/modules/inventory/application/availability` logic inside `stock-service.ts` — on-hand − reserved − in-transit.
- `src/modules/inventory/application/reorder-service.ts` — the nightly scan + once-per-window dedupe (T11; BR-019).
- `src/modules/inventory/application/reconciliation-service.ts` — the INV-010 job (T12; RC-04/RC-05).
- `src/modules/inventory/application/method-switch-service.ts` — preview + dated revaluation posting (T13; INV-017).
- `src/modules/inventory/application/opening-stock-service.ts` — the PHASE-006 drafts consumer (T6; G-16).
- `src/modules/inventory/infrastructure/inventory.store.ts` — the Drizzle store + the sanctioned raw-SQL escape hatches (ledger aggregates — recorded under RISK-012).
- `src/modules/inventory/presentation/inventory.controller.ts` — 49 routes (T15).
- `src/modules/inventory/inventory.module.ts` — the Nest module.
- `src/__db__/inventory/fixtures.ts` — tenant I substrate (isolated tenant, FY2026 timeline, dedicated WAC/FIFO/perishable/device items).
- `src/__db__/inventory/valuation-ledger.spec.ts` — 6 tests (WAC + FIFO through the real services; layer conservation; BR-013 both policies).
- `src/__db__/inventory/golden.spec.ts` — 9 tests (G-13, G-14, G-15 both branches, G-16, INSUFFICIENT_STOCK zero-residue, failure packs).
- `src/__db__/inventory/counts.spec.ts` — 4 tests (Journey D scripted E2E, blind mode, BR-015 tolerance, INV-011 locked period).
- `src/__db__/inventory/operations.spec.ts` — 6 tests (reservations netting, BR-016 availability, BR-019 reorder window, A7 spoof zero-residue, CC-04 race, T-01 100k perf smoke with cleanup).
- `src/__db__/inventory/recon.spec.ts` — 3 tests (RC-04 mixed ops incl. policy-none, RC-05 orphan drift → BROKEN + notification + PC-04 + repair).
- `src/__db__/inventory/tracking.spec.ts` — 6 tests (FEFO, expiry write-off, batch-required enforcement, serial binding, BR-018 return).
- `src/__db__/inventory/method-switch.spec.ts` — 3 tests (INV-017 suite: revaluation posting, history immutability, in-flight rejection).

**apps/web**
- `components/inventory-warehouses.tsx` — the Settings-archetype manager (create + deactivate/reactivate with confirm).
- `components/inventory-stock.tsx` — stock on hand + warehouse filter + the BR-016 availability drill.
- `components/inventory-moves.tsx` — the movement ledger with direction/kind/warehouse filters + batch/serial columns.
- `components/inventory-transfers.tsx` — the transfer wizard (multi-line create → dispatch → in-transit badge → receive/cancel).
- `components/inventory-counting.tsx` — the count workspace (create with item picking + blind mode; sheet; entry; submit; variance review; recount; plain/supervisor approve).
- `app/[locale]/inventory/warehouses/page.tsx`, `stock/page.tsx`, `moves/page.tsx`, `transfers/page.tsx`, `counting/page.tsx` — the 5 BFF server routes.

## Files changed

- `apps/api/src/db/schema.ts` — the 13 inventory tables mirrored (sync rule).
- `apps/api/src/app.module.ts` — InventoryModule registered.
- `apps/api/src/infra/auth/route-permissions.ts` — +49 PHASE-010 route rows (matrix §3.5 keys).
- `apps/api/src/infra/db/migrations.ts` + `migrations.spec.ts` + `migrations/meta/_journal.json` — manifest 0001–0015.
- `apps/api/src/__db__/isolation/tables.registry.ts` — the 13 tables registered (the generated A-suite covers them); `identity-isolation.db.spec.ts` — `stock_moves` in the NO_UPDATE_GRANT denial set (A4).
- `apps/api/src/__db__/identity-flows.db.spec.ts` — the viewer allowlist gains the two matrix-§3.5 viewer-tier keys (`inventory.stock.view`, `inventory.moves.view`); a pre-existing sequential-handler race in the wrong-email/wrong-password test fixed (handlers now attach at promise creation — the spurious unhandled rejection is gone).
- `apps/api/src/modules/accounting/application/reconciliation-service.ts` — the INV-010 checklist item (live states incl. the no-activity NOT_APPLICABLE branch) + `assertCoreChecksGreen` reads INVENTORY (PC-04).
- `apps/api/src/modules/accounting/application/period-service.ts` — PC-04 lock block includes INVENTORY BROKEN runs.
- `apps/api/src/modules/configuration/domain/settings-schema.ts` — `inventory.allow_negative_stock` (BR-013) + `inventory.count_variance_tolerance` (BR-015).
- `apps/api/src/modules/notifications/application/templates.ts` — the `stock_below_reorder` AR/EN digest (BR-019; explicitly alert-only).
- `apps/web/i18n/dictionaries.ts` — 1085 → 1231 keys (AR=EN, triple parity).
- `apps/web/lib/api-types.ts` — the 13 inventory row types.
- `apps/web/lib/messages.ts` — `localizedInventoryError` + move direction/kind/reason label mappers.
- `packages/contracts/src/navigation.ts` — +5 nav items (the inventory group).
- `docs/database/ENTITY_CATALOG.md` — §inventory rows refined (+`stock_reservations`, +`stock_transfer_lines`, G-15 override + reorder-stamp columns).
- `docs/database/TABLES/trade-inventory.md` — the §inventory column specs authored in-phase.
- `docs/planning/IMPLEMENTATION_STATUS.md`, `docs/handoff/CURRENT_STATE.md`, `docs/handoff/NEXT_ACTION.md`, `docs/handoff/CHANGELOG.md` — status sync (this phase).

## Database migrations

- **`0014_inventory_core.sql`** — `warehouses` (branch FK, code/name uniques, GL override FK, deactivation shape CHECK), `item_warehouse_settings` (reorder/min + the dedupe stamp), `stock_moves` 🔒 (direction/kind/qty/cost/value CHECKs, provenance, journal FK, moved_at), `stock_layers` (remaining/cost CHECKs, source-move unique), `item_stock` (unique triple, negative-tolerant), `stock_transfers` (+ lines), `stock_adjustments`, `stock_reservations`; the `opening_balance_docs` status CHECK widened for the STOCK kind; RLS macro ×9; grants (stock_moves SELECT/INSERT only); `trg_stock_moves_guard`; the viewer-template correction (DELETE of the 0005 pre-grants for `inventory.transfers.view`/`inventory.counts.view` per matrix §3.5); `_schema_state` → 14.
- **`0015_inventory_tracking.sql`** — `item_batches` (FEFO index), `item_serials` (IMEI shape + binding CHECKs), `stock_counts` (lifecycle shape CHECKs), `stock_count_lines` (snapshot/counted/value + partial uniques for plain/batch shapes); the stock_moves batch/serial FK expand steps; RLS ×4; grants; `_schema_state` → 15.

Doc-reality note (recorded per protocol step 9): the phase document's T1 names the files
by "next sequence numbers"; they ship as **0014/0015** continuing the manifest (the same
drift the PHASE-007/008/009 reports recorded). The ENTITY_CATALOG §inventory rows match
the delivered schema; the in-phase `stock_reservations` sync-rule addition and the
`stock_transfer_lines` child-table clarification are recorded there and specified in
TABLES/trade-inventory.md.

## API changes

`/api/v1/inventory/**` (49 routes, permission-gated per matrix §3.5, Idempotency-Key
guard via the global POST rule, A7-parity 404s):
`GET|POST warehouses`, `GET warehouses/:id`, `POST warehouses/:id/update|deactivate|reactivate`;
`POST item-warehouse-settings`;
`GET stock`, `GET availability`, `GET moves`;
`POST receipts`, `POST issues` (manual, reason-coded);
`GET|POST adjustments`, `POST adjustments/:id/post|cancel`;
`GET|POST transfers`, `GET transfers/:id`, `GET transfers/:id/lines`,
`POST transfers/:id/dispatch|receive|cancel`;
`GET|POST counts`, `GET counts/:id`, `GET counts/:id/lines`,
`POST counts/:id/enter|submit|recount|approve|cancel`;
`GET|POST batches`, `POST batches/:id/write-off`;
`GET|POST serials`, `GET serials/:id/sale`;
`GET|POST reservations`, `POST reservations/:id/release|consume`, `POST reservations/sweep-expired`;
`POST reorder/run-scan`; `POST reconciliation/stock-check`;
`GET items/:id/method-switch/preview`, `POST items/:id/method-switch`;
`GET opening-stock/drafts`, `POST opening-stock/post`.

## UI changes

5 AR/EN routes on the PHASE-005 components: المخزون / Inventory —
`/inventory/warehouses` (Settings archetype: list + create with branch/GL pickers +
deactivate-with-confirm/reactivate), `/inventory/stock` (List+Search: the read model
with the warehouse filter, negative badge, and the BR-016 availability drill
on-hand − reserved − in-transit), `/inventory/moves` (the ledger with
direction/kind/warehouse filters + batch/serial columns; read-only by construction),
`/inventory/transfers` (the wizard: multi-line create → dispatch → the in-transit
badge → receive; cancel from draft), `/inventory/counting` (Journey D: session create
with searchable item picking + blind mode; the frozen-snapshot sheet with blind
masking; line entry; submit; variance review with per-line diff + value impact +
recount with reason; plain/supervisor approval). Navigation registry +5 items; i18n
1085 → 1231 keys with 100% AR/EN parity (runtime + CI script).

## Security changes

- Permissions active on routes: `inventory.stock.view` / `inventory.moves.view`
  (viewer-tier per matrix §3.5 — the corrected viewer template holds exactly these),
  `inventory.receipts.create` / `inventory.issues.create`,
  `inventory.transfers.view/create/approve` (`.approve` risky — the in-transit receipt),
  `inventory.counts.view/create/approve` + `inventory.counts.post` (risky),
  `inventory.adjustments.create/post` (`.post` risky), `inventory.warehouses.manage`,
  `inventory.items.method_switch` (risky — dated revaluation), `inventory.tracking.manage`.
  Route registry rows added; risky actions audited server-side.
- New tenant-owned RLS tables: the 13 above — registered in `tables.registry.ts`; the
  generated A1–A11 suite runs against them (A3 mismatched-tenant INSERT → 42501; A4/A7
  UPDATE + id-probe; `stock_moves` UPDATE/DELETE grant-denied).
- Append-only defense in depth: `trg_stock_moves_guard` fires beyond the missing
  grants — the RC-05 proof asserts even superuser DELETE refuses; the only repair path
  is the documented test tooling (trigger disabled for the fixture moment) and
  production repairs are compensating corrections.
- The viewer-template correction (0014) — grant REMOVAL aligning the seed with the
  authorization matrix; recorded as the decision trail here and in TABLES.
- Spoof rows: warehouse/item/batch/serial/count/transfer/adjustment id enumeration
  cross-tenant → 404-shaped typed errors identical for unknown-vs-foreign (A7 parity
  asserted); cross-branch warehouse references render identically with zero residue.
- No external network calls exist in the module.

## Tests executed

```
pnpm exec vitest run --config vitest.db.config.ts src/__db__/inventory/   # the inventory suite (8 files)
pnpm run test:db                                                          # the full db suite
pnpm test                                                                 # api unit (incl. the valuation property suite)
cd apps/web && pnpm typecheck && pnpm lint                                # web gates
pnpm check:i18n-parity · pnpm check:ui-catalog · pnpm boundary:negative-test
pnpm docs:validate
pnpm gate:local                                                           # the full CI-equivalent gate
```

## Actual test results

```
inventory suite →  Test Files 8 passed (8) · Tests 37 passed (37)   [counts 4, golden 9,
                   method-switch 3, operations 6, recon 3, tracking 6, valuation-ledger 6]
valuation props  →  12 tests (WAC bounds/conservation/immutability; FIFO ordering/Σ)  [unit]
full db suite    →  Test Files 50 passed (50) · Tests 814 passed (814) (exit 0; embedded
                   PostgreSQL 16; migrations 0001–0015 applied in setup; two consecutive
                   clean runs + the operations→golden poisoner pair fixed for file-order
                   independence — the T-01 smoke now cleans its 100k seeded moves)
api unit         →  15 files · 92 tests passed
web              →  typecheck clean · lint clean
i18n parity      →  ar=1231 keys, en=1231 keys — 100% parity
ui catalog       →  37 component exports ↔ 60 catalog rows — parity green
visual harness   →  passed (AR+EN threshold-0 baselines; axe 0 violations; DataTable perf
                   floor=16.56ms table=17.23ms overhead=0.67ms)
web-security     →  4 passed (§8 headers, nonce rotation, no third-party, CSP executes)
docs validate    →  29/29 checks passed
gate:local       →  ALL LOCAL GATES GREEN — every step exit 0 (see §Evidence)
```

Failure-pack evidence inside the suites: `PERIOD_LOCKED` (count approval into a locked
period — zero residue, session stays VARIANCE_REVIEW), `PURPOSE_NOT_MAPPED` /
`ENTRY_NOT_BALANCED` / `ALREADY_POSTED` (the golden failure packs),
`INSUFFICIENT_STOCK` (dispatch beyond on-hand + the CC-04 last-units race: one winner,
one typed failure, zero double-spend), `WAREHOUSE_CODE_EXISTS`,
`WAREHOUSE_NOT_DEACTIVABLE`, `BATCH_REQUIRED`, `SERIAL_RETURN_BINDING_INVALID`
(the BR-018 original-unit binding), `COUNT_VARIANCE_TOLERANCE_EXCEEDED` (BR-015
supervisor gate), `METHOD_SWITCH_IN_FLIGHT` / `METHOD_SWITCH_SAME` (INV-017),
`STOCK_TRANSFER_SAME_WAREHOUSE`, and the reconciliation drift path (RC-05: orphan move
seeded via the documented superuser tooling → BROKEN with the offending row id +
notification audit event + PC-04 lock block → repaired → OK).

## Build results

`pnpm build` → 5 tasks successful (web compiled; turbo cache warm from the gate run).

## Invariants covered

- **INV-010 (stock ↔ GL):** the reconciliation job + RC-04/RC-05 + G-16's
  green-from-entry-#1 + every golden's balance assertions.
- **INV-017 (no retroactive cost mutation):** append-only `stock_moves` (grants + guard
  + superuser-refusal proof), the method-switch suite (past issues unchanged; switch
  requires revaluation posting), history queries returning original costs.
- **INV-018 (no move without its economic effect):** the movement core's single
  transaction (stock + journal + audit), the crash-injection tests, and the
  policy-none case asserted explicitly (same-account transfer legs carry NULL
  `posted_journal_id` by documented policy — the job's construction verifies it).
- Inherited from the engine: INV-001/002/004/011/013/014 (period locks, idempotency,
  reversal-only correction — exercised through the golden failure packs).

## Acceptance criteria verification

1. **Tables + RLS + append-only + registry + migration CI** — PASS: 13 tables, RLS
   macro ×13, `stock_moves` grants + guard with A4/superuser denials asserted, registry
   rows ×13, fresh-apply green every db-suite boot (embedded PG16) + the manifest spec.
2. **WAC/FIFO oracle property suites at 6 decimals; method lock; INV-017 switch** —
   PASS: 12 property tests + 6 ledger tests + 3 method-switch tests; an item never
   mixes methods (BR-014); the switch produces the dated revaluation posting.
3. **INV-018 atomicity incl. the same-account policy-none case** — PASS: goldens with
   zero-residue failure packs; crash-injection; the G-15 policy-none test asserts the
   NULL journal explicitly.
4. **INV-010 job green on the golden dataset + RC-05 drift flagged with row detail** —
   PASS: RC-04 mixed ops (incl. the policy-none transfer) → OK exact balances; RC-05 →
   BROKEN with the offending move id, notification fired, period lock blocked.
5. **Opening stock from PHASE-006 drafts through the OPENING period with per-item
   layers; INV-009/010 from entry #1** — PASS: G-16 (40 @ 3.00 FIFO + 60 @ 3.00 WAC =
   300.0000; per-item layers; idempotent replay; INV-010 check OK immediately after).
6. **Transfers DRAFT → IN_TRANSIT → POSTED; BR-016 netting; G-15 journals** — PASS:
   lifecycle tests + the availability read (source down, destination in-transit visible
   but on-hand/available 0) + G-15 both branches.
7. **Counts DRAFT → COUNTED → VARIANCE_REVIEW → POSTED with snapshot, BR-015, G-13/G-14,
   INV-011 rejection** — PASS: the Journey-D scripted E2E + the locked-period pack.
8. **Batch/expiry/serial/IMEI enforced exactly where flagged; FEFO; BR-018 binding** —
   PASS: tracking suite (FEFO order, batch-required enforcement, original-unit returns).
9. **Negative stock rejected by default; explicit-on prices at last average and flags** —
   PASS: BR-013 both policies in valuation-ledger + the `ix_item_stock_tenant_negative`
   flag index; the setting `inventory.allow_negative_stock` default false.
10. **Soft reservations + availability; reorder once per window; no automatic POs** —
    PASS: reservation netting/sweep tests; the BR-019 window test (first scan alerts ≥1,
    re-scan inside the window alerts 0/withinWindow ≥1); `purchase%` tables asserted
    absent.

## Evidence

- The db-suite output above (814/814, two consecutive clean full runs; the
  operations+golden pair re-verified after the T-01 cleanup fix).
- The gate: `bash scripts/ci/local-gate.sh` ran to completion with every step exit 0
  (typecheck 5/5 · lint 5/5 · depcruise 1066 modules/3714 deps clean ·
  permissions-drift 199=199 · unit green · db 814 green · build 5/5 · contrast ·
  i18n 1231=1231 · ui-catalog 37↔60 · visual harness green incl. perf floor/overhead ·
  web-security 4/4 · docs 29/29 · boundary negatives ×3 green). Sandbox note (honest
  recording): this environment reaps long-lived detached processes, so the wrapper was
  completed in the foreground; each step's real output is quoted in the phase worklog
  (`agent-ctx/T15-gate-evidence-PHASE-010.md`).
- T-01 smoke: the seeded 100k-move tenant served the ledger slice (LIMIT 100) and the
  on-hand read inside the local budgets (< 1500 ms / < 500 ms asserted) with
  EXPLAIN-verified `ix_stock_moves_tenant_item_wh_date` use; the seeded rows are
  removed afterward (suite-order discipline — the cleanup mirrors RC-05's documented
  tooling).
- The viewer-template correction: before the 0014 DELETE, the identity checklist failed
  `viewer must NOT hold inventory.transfers.view`; after it + the two viewer-tier
  allowlist keys, the checklist passes (matrix §3.5 exact).

## Known limitations

- Landed-cost allocation into receipts ships with PHASE-011 (this phase's receipts take
  a direct unit cost; the service seam accepts the cost parameter).
- `useStockAvailability` in @erp/ui remains the honest PHASE-006 stub (unused): the
  availability surface ships behind the inventory routes/screens; wiring the picker
  pattern to the live service lands with its first consumer (PHASE-011/012).
- The reorder alert is the email digest + audit event only — the in-app alerting
  surface + replenishment suggestions are PHASE-015 by scope discipline.
- `stock_moves` OC columns ("POS only") exist for PHASE-016/020; no sync path ships
  here (OFFLINE_CAPABILITIES_MATRIX rows stand).

## Deferred work

- Hard reservation policies + the `inventory.reservations` entitlement key (PHASE-015).
- Composite-item explosion, van warehouses, production consumption (PHASE-015/017/018).
- Report-contract registration of the inventory query services (PHASE-013 engine).
- Sales-order holder type on reservations + consumption policies (PHASE-012).

## Documentation updated

- `docs/database/ENTITY_CATALOG.md` — §inventory rows matched to the schema
  (+`stock_reservations`, +`stock_transfer_lines`, the G-15 override and the reorder
  stamp columns).
- `docs/database/TABLES/trade-inventory.md` — the PHASE-010 cluster column specs
  authored in-phase (§warehouses / §stock_moves / §stock_transfers / §item_batches +
  §item_serials / §stock_counts + grants & the guard, per the file-header rule).
- `docs/planning/IMPLEMENTATION_STATUS.md` — PHASE-010 → COMPLETE with evidence.
- `docs/handoff/CURRENT_STATE.md`, `docs/handoff/NEXT_ACTION.md`,
  `docs/handoff/CHANGELOG.md` — status sync (next action → PHASE-011).
- No column deviated from the catalog beyond the recorded in-phase additions (the
  sync rule's `stock_reservations` row + the transfer-lines child clarification).

## Risks

- RISK-009 (accounting bugs destroy trust): the INV-010 job + RC-04/05 drift tests are
  the core deliverable — green, with the PC-04 lock block live.
- RISK-014 (performance under real volumes): the `item_stock` read model + the
  tenant-first composite indexes + the T-01 smoke at 100k moves with EXPLAIN-verified
  index use.
- RISK-012 (Drizzle friction): the ledger aggregates use the sanctioned raw-SQL escape
  hatch inside the store (recorded here per the phase's §7).
- RISK-016 (boundary erosion): inventory never imports accounting repositories — only
  the PostingEngine service; depcruise green (1066 modules).
- RISK-015 (Arabic/RTL edge cases): the 5 screens are AR+EN with the frozen tokens;
  quantities render LTR-isolated (`dir="ltr"` + tabular-nums) inside RTL tables.

## Rollback instructions

Migrations are expand-only (new tables + additive CHECK lifts). Dev rollback = revert
the commits + drop the phase's tables; production is forward-only per
MIGRATION_STRATEGY. `stock_moves` is append-only from day one: **no rollback path may
ever delete movements written in production** — corrections are compensating documents.

## Next eligible phase

**PHASE-011 — Purchasing & Payables** (identify only; do not implement). Its goods
receipts consume this phase's published `receiveStock` service; the AP subledger rides
the partners module's sanctioned same-transaction api; GRNI reconciliation flips the
close-checklist item live.
