# Completion Report — PHASE-018

> **Status:** COMPLETE · **Updated:** 2026-11-03

## Phase ID / Date

PHASE-018 — Manufacturing & Production · 2026-11-03

## Summary

The `manufacturing` module shipped with the `industry.food_manufacturing`
template on the unmodified PHASE-015 engine. **Versioned BOMs**: per-item
version history (one ACTIVE per item by partial unique index), yield % +
per-component scrap %, DRAFT full-replace, activation archiving the previous
ACTIVE — and a multi-level explosion service computing
`round6(planned × qty_per_output × (1 + scrap%/100) ÷ yield%/100)` with cycle
detection (`BOM_CYCLE`) and a 16-level depth cap, property-proven
composed-level-by-level === single-pass. **Production orders** on the
documented lifecycle (DRAFT → RELEASED → IN_PROGRESS → COMPLETED /
CANCELLED-before-consumption): release reserves + binds `PRD-{YYYY}-{SEQ:5}`
per-branch (INV-021) and snapshots the level-1 explosion as order lines
(version-bound forever); consumption issues components through the inventory
`planIssue`/`applyIssue` seam at actual per-batch cost — one journal per call
DR WIP · CR inventory (INV-018 atomic), with beyond-threshold variance
flagging `over_plan` + one inbox notification and NEVER blocking; scrap is
reason-coded, value ≤ the order's WIP balance, DR `PRODUCTION_SCRAP` · CR WIP
with no stock move; completion is the SINGLE absorption journal — DR FG
inventory · CR WIP (materials) · [CR `PRODUCTION_LABOR` · CR
`PRODUCTION_OVERHEAD` when rates > 0] — receiving the FG batch at computed
cost with expiry = completedAt + shelf-life days and producing-order
provenance, per-order WIP netting to EXACTLY zero (INV-013 idempotent replay).
**QC gate**: the `required` policy quarantines the FG batch (new
QUARANTINED status — FEFO/availability exclude it; explicit-batch issues fail
typed); inspections PASS/FAIL + sampled with dispositions — PASS releases with
no journal, FAIL+SCRAP posts the qc_scrap journal DR `PRODUCTION_SCRAP` · CR
FG inventory and issues the whole remaining quarantined batch, FAIL+REWORK
stays held, FAIL+ACCEPT is the audited override. **Batch genealogy**: a
read-only upstream/downstream/batch-summary walk over batch provenance +
consumptions + sales edges — the recall answer, never a mutation.
**WIP reconciliation** (INV-010): kind "WIP" control-vs-subledger check live
in the health center + close checklist + PC-04 lock gate, seeded-drift →
BROKEN. 24 permission-guarded routes, 3 industry reports (registry 63 → 66,
`manufacturing.production_cost` GL-tied at tolerance 0), 4 bilingual RTL web
screens, i18n 2348 → 2556, template apply/switch/degradation proven (7
per-template tests incl. restaurant → food_manufacturing additive safety
BR-038 with POS history byte-identical).

## Files created

**Migration & schema**
- `apps/api/migrations/0026_manufacturing.sql` (872 lines) — 7 new RLS'd
  tenant tables (bills_of_materials, bom_lines [DELETE-granted for DRAFT
  full-replace], production_orders, production_order_lines,
  production_consumptions, production_scraps, inspections), widenings
  (item_batches.status + 'QUARANTINED'; stock_moves.source_type +
  'production_order'; warehouses.role RAW|WIP|FG; items.shelf_life_days;
  item_batches.production_order_id + composite FK), CoA markers 1160 WIP /
  5120 PRODUCTION_SCRAP / 5400 group / 5410 PRODUCTION_LABOR / 5420
  PRODUCTION_OVERHEAD, 8 permission seeds, plan grants (7 manufacturing
  feature keys → business+enterprise), role-template grants, the
  `industry.food_manufacturing` v1.0.0 manifest seed verbatim from the docs
  manifest, `_schema_state` 26

**Manufacturing module (NEW)**
- `apps/api/src/modules/manufacturing/manufacturing.module.ts`
- `apps/api/src/modules/manufacturing/domain/manufacturing-errors.ts` — 33
  typed DomainErrors (12 BOM, 11 production-order, 8 inspection/QC,
  GENEALOGY_BATCH_NOT_FOUND + shared)
- `apps/api/src/modules/manufacturing/application/bom-service.ts`
- `apps/api/src/modules/manufacturing/application/production-order-service.ts`
  (1016+ lines — lifecycle, consume, scrap, complete, cancel)
- `apps/api/src/modules/manufacturing/application/inspection-service.ts`
- `apps/api/src/modules/manufacturing/application/genealogy-service.ts`
- `apps/api/src/modules/manufacturing/application/wip-reconciliation-service.ts`
- `apps/api/src/modules/manufacturing/infrastructure/manufacturing.store.ts`
- `apps/api/src/modules/manufacturing/presentation/boms.controller.ts`
- `apps/api/src/modules/manufacturing/presentation/production-orders.controller.ts`
- `apps/api/src/modules/manufacturing/presentation/inspections.controller.ts`
- `apps/api/src/modules/manufacturing/presentation/genealogy.controller.ts`
- `apps/api/src/modules/manufacturing/presentation/reconciliation.controller.ts`

**Reporting**
- `apps/api/src/modules/reporting/registry/industry/phase018.ts` (3 contracts)
- `apps/api/src/modules/reporting/registry/industry/manufacturing-queries.ts`

**Tests (DB — 8 new spec files, 66 tests)**
- `apps/api/src/__db__/manufacturing/fixtures.ts` (TENANT_M golden-chain
  substrate: M-RAW/M-FG, flour/yeast/packaging/dough/bread, Dough v1 + Bread
  v1 BOMs, the sale + QC-gate chains)
- `apps/api/src/__db__/manufacturing/bom.spec.ts` (11 — versioning, archive
  semantics, typed rejections, yield boundaries, explosion determinism +
  exact composition + cycles + depth, 404s)
- `apps/api/src/__db__/manufacturing/orders.spec.ts` (8 — state matrix, cancel
  rules, PRD numbering per branch + version binding, variance review, INV-013
  replay, PERIOD_LOCKED zero-residue, FEFO proposal)
- `apps/api/src/__db__/manufacturing/costing.spec.ts` (9 — J1..J5 exact
  journals, WIP zero per order, on-hands snapshot, L5 expiry override, stock
  moves journal-linked + sourced)
- `apps/api/src/__db__/manufacturing/wip-recon.spec.ts` (4 — OK tie, no
  activity → NOT_APPLICABLE, locked-period read OK, seeded drift → BROKEN +
  audit + inbox + PC-04 lock block)
- `apps/api/src/__db__/manufacturing/qc.spec.ts` (6 — the gate-on chain:
  QUARANTINED hold with FEFO/availability/issue blocks, qc_scrap flow, REWORK
  hold, ACCEPT override audited, PERIOD_LOCKED zero residue, GRN record-only +
  the validation pack)
- `apps/api/src/__db__/manufacturing/genealogy.spec.ts` (10 — upstream/downstream
  multi-level exact edges, empty for purchased, unknown → typed 404, mutates
  nothing)
- `apps/api/src/__db__/reporting/industry-018.spec.ts` (11 — dedicated tenant
  R18: production_cost rows + materials GL tie, honest empties, status filter,
  genealogy walks incl. the unknown-batch miss, inspection log, registration
  pins, CSV export)
- `apps/api/src/__db__/configuration/templates-018.spec.ts` (7 — the §8
  per-template requirements)

**Web**
- `apps/web/app/[locale]/manufacturing/boms/page.tsx` +
  `apps/web/components/manufacturing-boms.tsx`
- `apps/web/app/[locale]/manufacturing/orders/page.tsx` +
  `apps/web/components/manufacturing-orders.tsx`
- `apps/web/app/[locale]/manufacturing/qc/page.tsx` +
  `apps/web/components/manufacturing-qc.tsx`
- `apps/web/app/[locale]/manufacturing/genealogy/page.tsx` +
  `apps/web/components/manufacturing-genealogy.tsx`

**Docs**
- `docs/database/TABLES/manufacturing.md` (160 lines) +
  `docs/database/ERD/manufacturing.md` (133 lines) — the manufacturing cluster
- Implementation-agent evidence reports: `agent-ctx/T36…T41` (9 files)

## Files changed

- `apps/api/src/db/schema.ts` — the 7 new tables + 5 new/widened columns
- `apps/api/src/infra/db/migrations.ts` + `migrations.spec.ts` +
  `meta/_journal.json` — 0026 registered (schema-version pin 26)
- `apps/api/src/infra/auth/route-permissions.ts` — 24 manufacturing routes
- `apps/api/src/infra/http/error.filter.ts` — the 33 manufacturing error
  mappings
- `apps/api/src/app.module.ts` — ManufacturingModule
- `apps/api/src/modules/identity/infrastructure/permissions-drift.ts` (+ spec)
  — 0026 joins the seed union (matrix 241)
- `apps/api/src/modules/inventory/application/movement-core.ts` — the
  quarantined-batch guard on `planIssue` + the sole documented bypass caller
  (the QC fail-scrap flow); `stock-service.ts` availability extension;
  `tracking-service.ts` quarantine methods + `linkBatchProduction`
- `apps/api/src/modules/inventory/application/item-service.ts` + the items
  store — `shelfLifeDays` accepted/read
- `apps/api/src/modules/inventory/application/warehouse-service.ts` —
  `role` RAW|WIP|FG convention
- `apps/api/src/modules/accounting/application/period-service.ts` +
  `reconciliation-service.ts` — "WIP" joins the PC-04 hard-coded lists + the
  live `reconciliation.wip` close-checklist row (NOT_APPLICABLE when no WIP
  activity)
- `apps/api/src/modules/reporting/registry/index.ts` + `runtime.ts` +
  `services.ts` — the manufacturing data-source module, MODULE_DATA_PHASE
  manufacturing: 18, REGISTERED_PHASE_WINDOW 18, REPORT_CONTRACTS 63 → 66;
  `reporting/fixtures.ts` + `golden.spec.ts` count bumps
- `apps/api/src/__db__/isolation/tables.registry.ts` +
  `identity-isolation.db.spec.ts` — the 7 new tables + fixtures/attacks
  (fixtures + counts re-pinned)
- `apps/api/src/__db__/configuration/{golden-effective-configs.spec.ts,
  layer-fixtures.ts, template-prerequisites.spec.ts}` — 3 new food_manufacturing
  pins × {starter, business, enterprise} + the documented re-pins + CURRENT_
  SHIPPED_PHASE 18 flips
- `apps/api/src/modules/configuration/application/apply/prerequisites.ts` —
  CURRENT_SHIPPED_PHASE → "PHASE-018"
- `apps/api/src/modules/configuration/application/resolve/resolve-service.ts`
  — the 4 manufacturing policy/setting keys
- `apps/api/src/modules/configuration/domain/{policy-registry.ts,
  settings-schema.ts}` — the 4 keys (qc_gate, scrap_reason_required,
  fg_batch_expiry_from_shelf_life, consumption_variance_threshold_pct)
- `packages/contracts/src/industry/templates.ts` —
  FOOD_MANUFACTURING_TEMPLATE_MANIFEST (deep-frozen, byte-equal to the seed)
  + SHIPPED_TEMPLATE_MANIFESTS (6); `industry/index.ts` + `index.ts` exports;
  `industry-manifests.test.ts` — the six-template set + the PHASE-018 pins
- `apps/web/lib/effective-config.ts` — 4 TARGET_ROUTE_ALIASES + 3
  INDUSTRY_REPORT_TARGETS
- `apps/web/lib/api-types.ts` — WarehouseRow.role + the 22 manufacturing wire
  types
- `apps/web/lib/messages.ts` — localizedManufacturingError (33 codes) + 9
  label helpers
- `apps/web/components/app-shell.tsx` — the manufacturing fallback-crumb
  section
- `apps/web/i18n/dictionaries.ts` — +208 keys × 3 blocks (AR authored first)
- Docs: ENTITY_CATALOG (manufacturing section), FEATURE_CATALOG (permission
  column reconciliation), AUTHORIZATION_MATRIX §3.8 (+3 rows, 241 = seed
  union), POSTING_ENGINE §4 (the four production rows incl. qc_scrap),
  CHART_OF_ACCOUNTS (PRODUCTION_LABOR/PRODUCTION_OVERHEAD purposes),
  SUBSCRIPTION_AND_ENTITLEMENTS (the 0026 add-on wiring), industries
  README/templates README/INDUSTRY_CATALOG/capabilities status flips, reports
  README (registration status 66), IMPLEMENTATION_STATUS, CURRENT_STATE,
  CHANGELOG, NEXT_ACTION

## Database migrations

- `0026_manufacturing.sql` — everything additive (7 tables, widenings via the
  DROP+re-ADD CHECK pattern, CoA marker inserts ON CONFLICT DO UPDATE,
  permission/plan/role grants ON CONFLICT DO UPDATE, the template seed).
  Follows the 0025 byte-patterns (SET ROLE erp_migrate, statement
  breakpoints, the RLS macro `SELECT erp.apply_tenant_policy('"t"')`, GRANTs,
  `_schema_state` = 26). Rollback = dev-only schema revert; product rollback
  = disable the manufacturing entitlements (read-only historical access —
  posted orders/journals stay valid ordinary documents).

## API changes

24 new routes under `/api/v1/manufacturing` (all requireIdentity + envelope +
Idempotency-Key, zod UUID/QTY≤6dp/MONEY≤4dp):
- BOMs (7): `GET/POST /boms`, `GET/PUT /boms/:id`,
  `POST /boms/:id/{activate,archive}`, `GET /boms/explosion?itemId&qty&bomId?`
  — `manufacturing.boms.manage` + `manufacturing.bom`
- Production orders (10): `GET/POST /production-orders?status&itemId&limit`,
  `GET/PUT /:id`, `POST /:id/{release,start,consume,scrap,complete,cancel}`
  — view/create/approve/post split (approve/post RISKY), scrap under
  `manufacturing.scrap`
- Reconciliation (1): `POST /reconciliation/wip-check` —
  `manufacturing.costing.read` + `manufacturing.wip`
- Genealogy (3): `GET /genealogy/{upstream,downstream,batch}/:batchId` —
  `manufacturing.genealogy.read` + `manufacturing.batch_genealogy`
- Inspections (3): `GET /inspections?targetType&orderId&limit`,
  `GET /inspections/:id`, `POST /inspections` — `manufacturing.qc.manage` +
  `manufacturing.qc`

## UI changes

Four bilingual RTL screens (server page + client component, the distribution
archetypes; 22 of the 24 routes reachable — `PUT production-orders/:id` is
deliberately not surfaced (create-a-replacement discipline) and wip-check
belongs to the reconciliation framework's own surface):
- `/manufacturing/boms` — version registry + filters, create dialog with the
  multi-line component editor, DRAFT edit + activate (effective-from) +
  archive, the multi-level explosion preview (levels + per-item totals)
- `/manufacturing/orders` — order list + status filter, create dialog
  (branch, FG item, explicit BOM version pool, warehouses, labor/overhead
  rates with the absorption hint), the order workspace: header card with
  money fields + produced batch/expiry, plan-lines table with the `over_plan`
  warning chip, the lifecycle bar (release/start/consume/scrap/complete/
  cancel per status), consume dialog seeded from the planned components with
  per-component batch pickers, scrap + complete dialogs, consumptions +
  scraps tables with journal shorts
- `/manufacturing/qc` — inspections table + target-type filter, create
  dialog (COMPLETED-order select or pasted GRN UUID, PASS/FAIL, sampled +
  sample size, the client-side disposition matrix mirroring the service,
  inspected-at), the success notice composing the quarantine-release +
  qc_scrap outcomes
- `/manufacturing/genealogy` — recall search: item → batch pool (or pasted
  UUID), Upstream/Downstream/Summary cards with the typed
  GENEALOGY_BATCH_NOT_FOUND handling
- Nav: `manufacturing.{bom,orders,qc,genealogy}` aliases + 3 report
  deep-links; template-derived groups Production/الإنتاج +
  Traceability/التتبع when applied

## Security changes

- 8 new permission keys seeded (matrix 241 = seed union 0004+0024+0025+0026
  drift-green); `manufacturing.production_orders.approve` + `.post` are the
  RISKY keys (audited)
- 7 new RLS'd tenant tables (the PHASE-002 macro) — registered in the
  isolation A-test registry with fixtures + mismatched-tenant attacks
- Role-template grants: owner (full), viewer (view/genealogy/costing reads),
  warehouse (create orders + QC), accountant (view/genealogy/costing reads)
- The quarantined-batch guard on `planIssue` (explicit bypass ONLY for the
  QC fail-scrap caller, documented at the guard); genealogy is read-only by
  construction (no mutation path)

## Tests executed

```
pnpm typecheck                      # 6/6 packages
pnpm lint                           # 6/6 packages
pnpm run lint:depcruise             # 1626 modules, 0 violations
pnpm run check:permissions-drift    # matrix 241 keys, seed 241 keys
pnpm validate:manifests             # 6/6 manifests
pnpm test                           # api 270 + contracts 46 + domain-core 38
                                    # + ui 42 + sync-core 8
pnpm --filter @erp/api test:db      # FULL single-process suite (embedded PG16)
pnpm docs:validate                  # 29/29
pnpm run check:i18n-parity          # ar=2556, en=2556
pnpm run check:rls                  # OK — 175 catalog tables
pnpm run check:ui-catalog           # 37 exports ↔ 60 rows
pnpm run check:token-contrast       # all §16 pairs pass AA
pnpm run test:web-security          # 4/4 (CSP probe)
pnpm run test:visual-harness-run    # perf harness pass
pnpm run boundary:negative-test     # pass
pnpm run boundary:negative-ui-test  # pass
pnpm run boundary:negative-i18n-test # pass
pnpm run build                      # 6/6
```

## Actual test results

- **DB suite (the gate's step 7): 96 files / 1517 tests — ALL PASSED**
  (single process, embedded PostgreSQL 16, migrations 0001–0026, 85.20 s)
- Unit: api 270/270 (25 files — incl. the reporting pins at 66 contracts) ·
  contracts 46/46 (6 manifests — the food_manufacturing constant byte-equal
  to the seed) · domain-core 38/38 · ui 42/42 · sync-core 8/8
- check:rls executed against an embedded PG16 with the full chain applied
  (the same runner shape as the db suite's global setup): `[check-rls] OK —
  175 catalog tables`
- All six implementation-agent evidence reports carry per-task outputs in
  `agent-ctx/T36…T41` (T38 split a/b/i/ii across three files)

## Build results

- typecheck 6/6 · lint 6/6 · build 6/6 (turbo) · depcruise 0 violations
  (1626 modules, 6582 dependencies)

## Invariants covered

- **INV-001/002** (balanced journals): every production posting (consume,
  complete incl. absorption credits, scrap, qc_scrap) goes through
  PostingService — engine-enforced, golden-asserted with exact 4dp strings
- **INV-010** (subledger ↔ GL): the WIP kind — GL WIP-purpose balance vs Σ
  per-order WIP; seeded drift → BROKEN + audit + inbox + PC-04 lock block
  (wip-recon.spec); the close checklist row live with NOT_APPLICABLE when no
  production activity
- **INV-011** (posting date in open period): consume/complete/qc_scrap into
  a LOCKED month → typed `PERIOD_LOCKED` with ZERO residue (orders +
  costing + qc packs)
- **INV-013** (idempotency): complete-on-COMPLETED returns the stored
  completion result (same journal + batch, zero new rows); release-on-
  RELEASED is a no-op returning the current order
- **INV-018** (move/journal atomicity): consumption + FG receipt ride
  planIssue/applyIssue + planReceipt/applyReceipt inside the owning
  transaction — every chain move journal-linked and sourced
  `production_order` (costing.spec)
- **INV-021** (series immutability): PRD-{YYYY}-{SEQ:5} reserve+bind at
  release through NumberingService, per-branch; append-only series
- **BR-017** (FEFO): the batch-less consume picks the earliest-expiry batch
  (orders.spec); QUARANTINED batches excluded from FEFO/availability
- **BR-038** (additive switching): restaurant → food_manufacturing →
  restaurant — the POS invoice + journals byte-identical, series = union,
  switch-back always succeeds (templates-018.spec)
- **BR-040** (dependency closure): degraded entitlement (missing
  manufacturing keys) blocks apply with the exact missing chain; restaurant
  without the add-on hides its OPTIONAL prep-recipe entries cleanly

## Acceptance criteria verification

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Multi-level costing golden test green: per-order WIP nets to exactly zero; FG cost = materials + labor + overhead; journals fixture-exact | **PASS** | costing.spec 9/9 — the §8 chain exact: J1 DR WIP 8875.0000 · CR INVENTORY 8875.0000 (flour 637.5 @10 + yeast 125 @20); J2 DR PRODUCTION_SCRAP 443.7500 · CR WIP (reason BURNT, WIP 8431.2500); J3 DR INVENTORY 8431.2500 · CR WIP (dough unit 8.875000, expiry +2d); J4 DR WIP 8554.6875 · CR INVENTORY (dough 937.5 @8.875 + packaging 234.375 @1); J5 the multi-credit DR INVENTORY 9117.1875 · CR WIP 8554.6875 · CR PRODUCTION_LABOR 375.0000 · CR PRODUCTION_OVERHEAD 187.5000 (bread unit 12.156250, expiry +5d); `sumOrderWip` 0.0000 both orders; INV-001/002 balance holds |
| 2 | Genealogy forward/backward traces correct on the multi-level fixture and read-only | **PASS** | genealogy.spec 10/10 — upstream(bread) 4 edges over 2 levels (dough+packaging at 1, flour+yeast at 2); downstream(flour) → dough order → bread order → the invoice; unknown batch → typed GENEALOGY_BATCH_NOT_FOUND on all three entry points; the mutates-nothing assertion (journal/audit/stock/batch counts unchanged); industry-018.spec repeats the walks through the report surface on tenant R18 |
| 3 | Consumption and completion atomic with their journals (INV-018) and idempotent under replay (INV-013) | **PASS** | costing.spec stock-moves test (every chain move journal-linked + sourced); orders.spec INV-013 test (complete twice → same journal/batch, release twice → no-op); the PERIOD_LOCKED pack proves zero-residue atomicity |
| 4 | QC gate: quarantined FG invisible to availability/sales until pass; failures post scrap with reason; passing posts nothing | **PASS** | qc.spec QC-1..QC-6 — completion holds the batch QUARANTINED (FEFO/availability/explicit-issue all blocked); FAIL+SCRAP = the qc_scrap journal DR PRODUCTION_SCRAP · CR FG inventory + the whole-batch issue; FAIL+REWORK holds, later PASS releases; FAIL+ACCEPT audited override; PERIOD_LOCKED zero residue; GRN targets record-only |
| 5 | FG batches receive expiry = production date + shelf-life days; FEFO applies | **PASS** | costing.spec expiry test (+2d dough / +5d bread under the ON policy; NULL under the L5 OFF override); orders.spec FEFO proposal (earliest-expiry batch picked on a multi-batch item) |
| 6 | Scrap posts to PRODUCTION_SCRAP with reason codes; variance beyond threshold creates a review task, never a silent correction | **PASS** | costing.spec J2 exact (reason BURNT); orders.spec variance test (within 5% no flag; beyond → over_plan + exactly ONE dedupe-keyed inbox notification; consumption never blocked); `manufacturing.scrap_reason_required` policy enforced (reason 1..40) |
| 7 | WIP reconciliation (INV-010) live in the health center and detects seeded drift | **PASS** | wip-recon.spec 4/4 — OK tie 0.0000 = 0.0000 on the chain; NOT_APPLICABLE without production activity; the seeded manual capitalization on the WIP account → BROKEN + orphan detail + audit `manufacturing.reconciliation_broken` + inbox + the PC-04 lock block tripping RECONCILIATION_BROKEN then reopening; `POST /reconciliation/wip-check` mounted |
| 8 | `industry.food_manufacturing` passes all seven per-template tests and switches additively from `industry.restaurant` with zero data loss (BR-038) | **PASS** | templates-018.spec 7/7 — clean apply (hash pinned, PRD series, pins, checklist, derived nav/terminology/policies), idempotent re-apply (zero writes), switch safety with a REAL posted POS sale surviving byte-identical across both switches, degraded entitlement missingChain, restaurant-without-add-on hidden cleanly, starter blocked with the exact chain, L5-beats-L1 policy override |
| 9 | All manufacturing routes enforce the seeded permissions (approve/post risky, audited); owner/warehouse role split verified | **PASS** | 24 route-permissions rows verbatim; permissions-drift 241=241; the billing readonly-sweep covers every state-changing route (the typed 403); role-template grants per §7 (warehouse creates + QC, owner approves/posts) |
| 10 | ENTITY_CATALOG gains the manufacturing section (+ TABLES/ERD); FEATURE_CATALOG Phase columns confirmed; docs validation green | **PASS** | TABLES/manufacturing.md + ERD/manufacturing.md authored (check:rls catalog parity 175 tables); ENTITY_CATALOG manufacturing section; FEATURE_CATALOG permission column reconciled to the real keys; `pnpm docs:validate` 29/29 |

## Evidence

- Command outputs above (run 2026-11-03 on the final tree, this box)
- Per-task evidence: `agent-ctx/T36-1-foundation.md`,
  `T37-2-template.md`, `T38a-3a-bom.md`, `T38bi-3b-orders.md`,
  `T38bii-3c-wip-recon.md`, `T39-4-qc-genealogy.md`, `T40-5-reports.md`,
  `T41-6-web.md` (+ the binding `PHASE-018-MASTER-PLAN.md`)
- Full-suite tail: `Test Files  96 passed (96)` / `Tests  1517 passed (1517)` /
  `Duration  85.20s`
- Manifest hash pin: `industry.food_manufacturing@1.0.0` sha256:e62f1bf2…
  (validate:manifests — the docs manifest, the migration seed, and the
  contracts constant byte-equal)

## Known limitations

- **Labor/overhead are configured rates, not time capture** (no shop-floor
  MES/payroll): absorption = actualQty × rate, labeled honestly in the UI
  hint and the production_cost report (planned vs actual, never implying
  payroll-grade precision)
- **One FG item per order** (no co-products) — semi-finished chaining via
  separate orders, per the template limitation; order planned lines are
  level-1 only
- **Order edit UI is deliberately absent** (DRAFT PUT exists on the API but
  the web surfaces create-a-replacement + adjusted-consumption instead — the
  honest correction discipline)
- **QC/genealogy id-short columns on the web**: InspectionRow carries ids
  (not document numbers) and there is no GRN list API — the QC screen
  resolves order numbers through the COMPLETED pool, renders GRN ids short
  with a paste hint, and the genealogy sales table defers doc numbers to the
  `manufacturing.batch_genealogy` report (the §10 ids-only design)
- **Inspection FAIL+ACCEPT is an audited operator override** (releases
  quarantine without a re-test) — surfaced as such in the UI
- **RETURN_TO_SUPPLIER dispositions are record-only** (GRN-target
  inspections) — no supplier-return document flow yet
- **bom_lines carry DELETE grants** (the DRAFT full-replace pattern) — the
  one deliberate DELETE in the manufacturing grants, documented in TABLES
- The variance "review task" is the `over_plan` flag + one inbox
  notification (no separate task entity) — per the §5 DECISION

## Deferred work

- MRP / demand-driven planning, finite-capacity scheduling, MES/IoT —
  OQ-006 non-goals (never this phase)
- Labor time capture + activity-based costing beyond the simple rates —
  platform payroll is PHASE-029
- Co-product/by-product splits — template limitation, revisit with design
  partners
- Allergen/nutrition/HACCP documentation management — QC stays
  pass/fail/sampled
- Supplier-return documents for RETURN_TO_SUPPLIER dispositions — record-only
  for now
- `k6/mvp-candidate.ts` staged hosted run — standing follow-up from
  PHASE-014

## Documentation updated

IMPLEMENTATION_STATUS (PHASE-018 → COMPLETE + the current-state header),
CURRENT_STATE (module narrative, web screens, i18n counts, tested line,
phase-history), CHANGELOG (the PHASE-018 entry), NEXT_ACTION (flipped to
PHASE-019 with the PHASE-018 frozen-semantics block), ENTITY_CATALOG
(manufacturing section), TABLES/manufacturing.md + ERD/manufacturing.md
(in-phase), FEATURE_CATALOG (permission column reconciliation),
AUTHORIZATION_MATRIX §3.8 (241 = 241), POSTING_ENGINE §4 (the four
production rows incl. the qc_scrap posting), CHART_OF_ACCOUNTS
(PRODUCTION_LABOR/PRODUCTION_OVERHEAD purposes), RECONCILIATION.md (the WIP
row — pre-authored, verified), SUBSCRIPTION_AND_ENTITLEMENTS (the 0026
add-on wiring + the pack row), industries README + templates README +
INDUSTRY_CATALOG + food-manufacturing.md (delivered flips), reports README
(registration status 66), the PHASE-018.md status header.

## Risks

- No new RISK_REGISTER entries. RISK-009 (accounting correctness — the
  phase's sacred surface): mitigated by the exact-zero WIP goldens + the
  INV-010 WIP check with seeded-drift detection + the tolerance-0
  production-materials GL tie. RISK-012 (Drizzle friction): the genealogy
  walks + WIP aggregation use the documented raw-SQL escape hatch via
  tenantTx (read-only) — recorded in the service headers. RISK-016
  (boundary erosion): manufacturing consumes items/inventory/accounting
  published services only — depcruise 0 violations over the new module; the
  `planIssue` quarantine bypass is the single documented exception, guarded
  + named. RISK-019 (implementing beyond phase): zero sync-client code
  (grep-verified — offline van selling stays PHASE-022).

## Rollback instructions

Product-level: disable the food-manufacturing add-on / revoke the
manufacturing entitlements (add-on removal → read-only historical access per
SUBSCRIPTION_AND_ENTITLEMENTS; posted orders/journals/batches remain valid
ordinary documents — the restaurant template's prep-recipe entries hide
cleanly, proven by templates-018 test 5). Dev-level: revert migration 0026
(`drizzle-kit` down / restore a pre-0026 dump); revert the code tree to the
`phase/017` state. No data migration is required for entitlement-only
rollback.

## Next eligible phase

**PHASE-019 — CRM, Service Contracts & Projects** (identify only — NOT
implemented here). It consumes the partner/contract patterns 017 stabilized,
generalizes job cards into `crm.service_orders` WITHOUT a posting-rule fork,
extends the PHASE-007 cost-centers pattern with the projects dimension, and
applies `industry.professional_services`. PHASE-020 (Offline Sync
Foundation) remains parallel-eligible; PHASE-018 deliberately shipped zero
sync-client code.
