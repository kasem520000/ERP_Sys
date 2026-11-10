# T36 / Task 1 — Foundation: migration 0026 + registrations + enablement (PHASE-018)

**Agent:** T36 (foundation) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — typecheck 6/6, lint 6/6, depcruise 0, permissions-drift 241=241,
docs:validate 29/29, api unit 267/267, DB suite 1450/1452 (the 2 fails are the
documented mid-phase gaps: unmounted manufacturing routes → T38/T39; grocery
qc_inspections now included (0026 grants) → T37 re-pins).
Note: the dispatching agent completed the final 10% (count fixes 246→241, viewer
role set, SEED_PATHS, stray probe cleanup) after the subagent hit its turn cap.

## Files created

- `apps/api/migrations/0026_manufacturing.sql` (872 lines) — 7 RLS'd tenant tables
  (bills_of_materials, bom_lines [DELETE-granted], production_orders,
  production_order_lines, production_consumptions, production_scraps, inspections),
  widenings (item_batches.status + 'QUARANTINED'; stock_moves.source_type +
  'production_order'; warehouses.role RAW|WIP|FG; items.shelf_life_days;
  item_batches.production_order_id + composite FK), CoA markers 1160 WIP /
  5120 PRODUCTION_SCRAP / 5400 group / 5410 PRODUCTION_LABOR / 5420
  PRODUCTION_OVERHEAD, 8 permission seeds, plan grants (7 manufacturing feature
  keys → business+enterprise), 4 role-template grant blocks (owner/viewer/
  warehouse/accountant), `industry.food_manufacturing` v1.0.0 manifest seed
  (verbatim from docs/industries/templates/manifests/manifest.food_manufacturing.json),
  schema_version 26.
- `docs/database/TABLES/manufacturing.md` (160 lines) + `docs/database/ERD/manufacturing.md`
  (133 lines) — the manufacturing cluster docs (check:rls catalog parity).

## Files changed

- `apps/api/src/db/schema.ts` — drizzle mirrors of the 7 tables + 3 new columns
  (warehouses.role, items.shelf_life_days, item_batches.production_order_id).
- `apps/api/src/infra/db/migrations.ts` (+0026), `migrations.spec.ts` (last tag),
  `migrations/meta/_journal.json` (idx 25).
- `apps/api/src/modules/identity/infrastructure/permissions-drift.ts` (+0026 in union)
  and `permissions-drift.spec.ts` (SEED_PATHS + 0026).
- `apps/api/src/infra/auth/route-permissions.ts` — the 24 PHASE-018 routes per
  MASTER-PLAN §9.
- `apps/api/src/__db__/isolation/tables.registry.ts` (7 tables; bom_lines
  deleteGranted) + `identity-isolation.db.spec.ts` (seedFixtures/OWN_ROW/
  MISMATCHED_INSERT for all 7).
- `apps/api/src/__db__/identity-flows.db.spec.ts` — 246→241 count fix (233 after
  0025 + 8 = 241; drift CLI agrees) + viewer-tier manufacturing read keys.
- `apps/api/src/__db__/tenancy-http.db.spec.ts`, `tenancy-provisioning.db.spec.ts` —
  0026-accurate counts (accounts +5 → 50? see in-file comments; purposes 20→25).
- **Inventory enablement**: `tracking-service.ts` (+quarantineBatch/releaseQuarantine/
  linkBatchProduction at L129/144/160), `movement-core.ts` (explicit-batch QUARANTINED
  guard L654), `inventory-errors.ts` (+BatchQuarantinedError L185 + quarantine/provenance
  errors), `stock-service.ts` (availability: −quarantined in availableQty, new
  quarantinedQty field), `inventory.store.ts` (+quarantinedQty, linkBatchProduction,
  batch status writes, ItemReadRow.shelfLifeDays L249).
- **Items**: `item-service.ts` + `items.store.ts` (shelfLifeDays create/update),
  `items-errors.ts`, `composites.spec.ts` (fixture field).
- **Warehouses**: `warehouse-service.ts` (+role create/update).
- `apps/api/src/infra/http/error.filter.ts` — BatchQuarantinedError + provenance
  error mappings (409).
- `docs/security/AUTHORIZATION_MATRIX.md` §3.8 — +3 rows (qc.manage, genealogy.read,
  costing.read); existing 2 rows untouched. `docs/database/ENTITY_CATALOG.md` —
  manufacturing section (3 new-table mentions verified).

## Handoff notes for T38/T39/T40/T41

- T38 calls: `tracking.quarantineBatch(batchId)` (ACTIVE→QUARANTINED, else
  BATCH_NOT_ACTIVE), `releaseQuarantine(batchId)` (QUARANTINED→ACTIVE),
  `linkBatchProduction(batchId, orderId)` (sets production_order_id where NULL).
- `planIssue` with explicit batchId now throws `BatchQuarantinedError` (code
  `BATCH_QUARANTINED`, 409) on a QUARANTINED batch; FEFO auto-pick unchanged
  (listFefoBatches is ACTIVE-only by the 0015 WHERE).
- `StockService.availability` now returns `quarantinedQty` (6dp string) and nets it
  out of `availableQty`.
- `ItemReadRow.shelfLifeDays: number | null` available via
  `store.findItemForInventory`.
- Purposes to map in fixtures: WIP→1160, PRODUCTION_SCRAP→5120,
  PRODUCTION_LABOR→5410, PRODUCTION_OVERHEAD→5420 (markers seeded by 0026 —
  provisioning picks them up on tenant CoA provisioning).
- Expected-mid-phase failures (T38/T39 mount the controllers; T37 re-pins):
  `billing/readonly-sweep` (14 manufacturing routes 404) and
  `configuration/template-switch` R9 (grocery qc_inspections moved phaseGated→included
  because 0026 grants manufacturing.qc to business — update with the phase bump).

## Test outputs

- `pnpm typecheck` — 6/6 · `pnpm lint` — 6/6 · `pnpm run lint:depcruise` — 0 violations
- `pnpm run check:permissions-drift` — matrix 241 keys, seed 241 keys
- `pnpm docs:validate` — 29/29
- `pnpm --filter @erp/api test` — 25 files / 267 tests ALL PASSED
- DB suite (isolated TMPDIR): `Test Files 2 failed | 86 passed (88)` /
  `Tests 2 failed | 1450 passed (1452)` — both fails documented above; the
  migrations.db.spec (incl. `runChecks` RLS + catalog parity) and the full
  isolation A1–A10 suite PASS over the 7 new tables.
