# T38a — Manufacturing module skeleton + BOM domain + fixtures substrate (PHASE-018)

**Agent:** T38a (BOM slice of the T38 production-core task) · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — typecheck 6/6, lint 6/6, depcruise 0 (1602 modules), permissions-drift
241=241, api unit 270/270 (25 files), DB suite **1469/1470** — the single failure is the
documented mid-phase gap `billing/readonly-sweep`, whose failing list shrank from 14
manufacturing routes to exactly **10** (the remaining unmounted non-bom state-changing
routes: 8 order + wip-check + inspections POST — T38b/T39's scope). The 4 state-changing
BOM routes (#2/#4/#5/#6) now sweep as the typed 403 — mounting proven.

## Files created

- `apps/api/src/modules/manufacturing/domain/manufacturing-errors.ts` — 12 typed
  DomainErrors (UPPER_SNAKE codes, English messages mirroring distribution-errors.ts):
  BomNotFoundError 404, BomVersionConflictError 409, BomNotDraftError 409,
  BomNotActiveError 409, BomActiveExistsError 409, BomLineInvalidError 422,
  BomCycleError 422, BomTooDeepError 422, BomItemNotStockError 422,
  BomSelfReferenceError 422, BomYieldInvalidError 422, BomUomMismatchError 422 (the
  extra the brief's D allowed: "add if needed, or validate equality and 422").
- `apps/api/src/modules/manufacturing/infrastructure/manufacturing.store.ts` — function
  module store (job-cards.store pattern): `tenantTx()`, `erp.current_tenant_id()`
  inserts, `::text` casts, snake→camel aliases, section banners. Surface: `insertBom`
  (bom + inline lines), `findBomById`, `listBoms({itemId?, status?, limit})`,
  `listBomsForItem`, `findActiveBom` (ORDER BY version_no DESC LIMIT 1),
  `patchBom` (DRAFT fields + status transitions stamping activated_at/archived_at via
  CASE — patchJobCard pattern), `listBomLines`, `findBomLineById`, `replaceBomLines`
  (DELETE+INSERT — the 0026 DELETE grant), `findItemForBom` (cross-module read-only
  SELECT on published `items` — the §6 precedent). Types `BomRow`/`BomLineRow`/
  `BomLineInsert`/`BomItemRow` 1:1 with drizzle.
- `apps/api/src/modules/manufacturing/application/bom-service.ts` — BomService
  (constructor: AuditService only — the BOM never posts): create (STOCK+ACTIVE FG,
  outputUom == base uom, yield 0<y≤100 ≤4dp, monotonic versionNo = max across ALL
  versions + 1, line validation, 23505→BomVersionConflict), update (PUT, DRAFT-only,
  full-replace with provided-ids-belong validation), activate (DRAFT-only; effectiveFrom
  input??today; archives the previous ACTIVE in the SAME call; 23505→BomActiveExists),
  archive (ACTIVE-only), find/findWithLines/list, explode (multi-level walk).
- `apps/api/src/modules/manufacturing/presentation/boms.controller.ts` —
  `@Controller("api/v1/manufacturing/boms")`, routes #1–7 of §9 VERBATIM against
  route-permissions.ts (paths + `manufacturing.boms.manage` + `manufacturing.bom` on
  every route), requireIdentity, zod (UUID, QTY ≤6dp `^\d+(\.\d{1,6})?$`, PCT ≤4dp,
  LIMIT ≤500, ISO DATE), `@HttpCode(CREATED)` on POST, envelope(). The explosion route
  is declared BEFORE `:id` (static segment wins the Express match — see probe below).
- `apps/api/src/modules/manufacturing/manufacturing.module.ts` — imports
  AccountingModule/AuditModule/InventoryModule/ItemsModule/ConfigurationModule
  (policy reads for T38b/T39 — imported now so T38b needs no module-graph change);
  providers/exports [BomService]; controllers [BomsController].
- `apps/api/src/__db__/manufacturing/fixtures.ts` — the shared manufacturing fixture
  substrate (below).
- `apps/api/src/__db__/manufacturing/bom.spec.ts` — 11 tests (below).
- `agent-ctx/T38a-3a-bom.md` (this file).

## Files changed

- `apps/api/src/app.module.ts` — ManufacturingModule registered right after
  DistributionModule (mirror position).
- `apps/api/src/infra/http/error.filter.ts` — import block + "PHASE-018 manufacturing"
  ladder: 409 (BomVersionConflict/BomNotDraft/BomNotActive/BomActiveExists), 404
  (BomNotFound), 422 (BomLineInvalid/BomCycle/BomTooDeep/BomItemNotStock/
  BomSelfReference/BomYieldInvalid/BomUomMismatch) — placed after the T36 quarantine
  block. Additive only; no other module touched.

## Decisions

1. **TENANT_M = `66666666-6666-6666-6666-666666666666`** — the MASTER-PLAN-suggested
   4444 pattern is TAKEN (`treasury/fixtures.ts` TENANT_T = 4444…, also reused by
   billing lifecycle). 6666 verified unused across the repo (grep, no matches).
   Actors: M_ACTOR `e6e6e6e6-0000-4000-8000-0000000006e1`, M_WAREHOUSE …6e2,
   M_QC …6e3 (sales-fixture user-row shape).
2. **Stock-seeding path: `stock.manualReceipt({reason:"COUNT_GAIN", batchNo,
   batchExpiry, unitCost})`** — `opening_balance_docs` lines carry only
   item/qty/unit_cost/currency (verified against OpeningStockService.post — no
   batchNo/expiry anywhere in that path), so the batch-capable seed is the
   tracking.spec.ts manualReceipt pattern. COUNT_GAIN posts DR INVENTORY · CR
   INVENTORY_APPRECIATION — 4920 created + purpose-mapped in the fixture (the
   inventory fixture's gap, same fix). One batch each (M-F1/M-Y1/M-P1) → FEFO trivial;
   batch ids exported as `fixture.batches` (looked up via tracking.listBatches).
3. **Explosion semantics** (MASTER-PLAN §3, all Decimal, round6 half-up per level):
   `gross = round6(planned × qtyPerOutput × (1+scrap/100) ÷ (yield/100))` where the
   yield is the BOM version converted AT THAT LEVEL; components with an ACTIVE
   version recurse (their gross is the next level's planned qty); the totals map
   accumulates per item ACROSS levels (diamonds legal). **Cycle detection is on the
   current chain (path), not a global visited set** — the diamond case (the same raw
   material at several levels) must sum, never reject; a line component already on the
   path is the cycle (BomCycleError with `details.chain`). Depth cap 16 (level 17
   entry → BomTooDeepError). Explicit `bomId` overrides resolution (a DRAFT what-if is
   legitimate); a bomId of another item renders 404-shaped (A7). Ordering: levels asc,
   items within a level by itemId asc, totals by itemId asc. `viaSemiFinished` is the
   parent item id at level ≥ 2, null on level 1 (they didn't come via a semi-finished).
   **Version-binding rule (T1's hook) is T38b's order test — noted, skipped here.**
4. **versionNo allocation** = max(version_no)+1 across ALL versions of the item
   (DRAFT included — monotonic; archived versions never renumber). Computed in the
   service from `listBomsForItem`; the uq (tenant, item, version) 23505 race backstops
   → BomVersionConflictError. **One-active**: activate archives the previous ACTIVE
   first IN THE SAME CALL, so the partial unique never trips on our own writes; the
   23505 catch (concurrent activate) → BomActiveExistsError. `countActiveBomVersions`
   NOT added — `findActiveBom` + the partial index + the 23505 catch cover the
   one-active rule (YAGNI; noted for T38b).
5. **Store owns its cross-module reads** (`findItemForBom` on published `items`) —
   the distribution-store §6 precedent; no items-module store import inside the
   manufacturing store/service (the module graph still imports ItemsModule etc. per
   the brief — T38b's order services will consume them). `replaceBomLines` is a plain
   DELETE+INSERT preserving provided ids (validated to belong in the service) — the
   0026 grant exists for exactly this; no job-card tombstone dance needed.
6. **Fixture BOMs are created through the real BomService** (create DRAFT → activate)
   — the spec substrate doubles as the service exercise; exported as post-activate
   `BomRow`s (`fixture.boms.dough` / `fixture.boms.bread`, both ACTIVE, effectiveFrom
   M_JAN 2026-01-05).
7. **bom.spec mutations never touch the golden five** — dedicated spec-owned SKUs
   (M-SPEC-*, M-CYC-*, M-DEP-01..18). The explosion property pack only READS the
   golden BOMs, because later files in the shared sequential DB run (T38b's golden
   chain) depend on Dough v1/Bread v1 staying ACTIVE.
8. **HTTP surface**: distribution specs are service-level only, so bom.spec stays
   service-level. Mounting is proven twice: (a) readonly-sweep's bom entries vanished
   from the 404 list (14→10, all four state-changing BOM routes now 403
   tenancy/subscription-read-only); (b) a one-off TEMPORARY probe spec (deleted after
   the run — no repo artifact) booted the real AppModule, logged in an owner, and
   proved the route ORDER: `GET /boms/explosion` → 422 VALIDATION_ERROR (the explosion
   handler + zod — NOT 404 BOM_NOT_FOUND which a losing `:id` match would produce),
   `GET /boms/:uuid` → 404 BOM_NOT_FOUND, `GET /boms?limit=5` → 200 with data:
   `PROBE explosion(no params) → {"status":422,"code":"VALIDATION_ERROR"} ·
   explosion(qty 0) → 422 VALIDATION_ERROR · boms/:id (unknown) → 404 BOM_NOT_FOUND ·
   boms list → 200 OK`.
   Side finding: zod v4 `z.string().uuid()` enforces RFC 9562 (variant nibble
   [89abAB]) — the readonly-sweep materializer's `11111111-…` ids fail zod uuid
   schemas but ride SERVICE paths fine (404/422 as designed); no action needed.

## Explosion number table (spec-pinned, verified with the Decimal library)

Explode(bread, 750) — bread v1 (yield 80.0000; dough 1.000000 scrap 0; packaging
0.250000 scrap 0) → dough v1 (yield 80.0000; flour 0.500000 scrap 2.0000; yeast
0.100000 scrap 0):

| Level | Item | Computation | 6dp pin |
|---|---|---|---|
| 1 | dough | 750×1×1÷0.8 | **937.500000** |
| 1 | packaging | 750×0.25÷0.8 | **234.375000** |
| 2 | flour (via dough 937.5) | 937.5×0.5×1.02÷0.8 | **597.656250** |
| 2 | yeast (via dough 937.5) | 937.5×0.1÷0.8 | **117.187500** |
| Σ | dough / pack / flour / yeast | totals map | 937.500000 / 234.375000 / 597.656250 / 117.187500 |

The brief's inline "598.242188" was an arithmetic slip (it double-applied factors);
computed carefully with Decimal the §3 formula gives 597.656250 — and the SAME
implementation reproduces the MASTER-PLAN §8 release-line numbers exactly
(dough order planned 1000 → flour 637.500000, yeast 125.000000), which is the
strongest cross-check available: §8's release lines ARE the level-1 explosion.
Single-pass closed form (750 × qty × (1+scrap) ÷ 0.64) === composed level-by-level
on this fixture — asserted in the spec with independently-computed Decimal values.

## Test tails

- `pnpm --filter @erp/api typecheck` → clean. `pnpm lint` → 6/6.
  `pnpm run lint:depcruise` → "✔ no dependency violations found (1602 modules,
  6327 dependencies cruised)" (was 1595/6266 — +7 modules: errors, store, service,
  controller, module, fixtures, spec).
- `pnpm run check:permissions-drift` → "[permissions-drift] OK — matrix 241 keys,
  seed 241 keys".
- `pnpm --filter @erp/api test` → `Test Files 25 passed (25) / Tests 270 passed (270)`.
- Isolated `TMPDIR=$HOME/tmp-t38a pnpm --filter @erp/api test:db` (runs the whole
  suite — the `-- src/...` arg does not filter under pnpm; `npx vitest run --config
  vitest.db.config.ts <path>` does): `Test Files 1 failed | 89 passed (90)` /
  `Tests 1 failed | 1469 passed (1470)`; the failure is readonly-sweep listing
  EXACTLY: POST/PUT /api/v1/manufacturing/production-orders (8 routes: list-create,
  :id PUT, release, start, consume, scrap, complete, cancel) + POST
  /api/v1/manufacturing/reconciliation/wip-check + POST /api/v1/manufacturing/
  inspections — all 404 (unmounted). Note: the brief predicted "17 non-bom routes
  (10 order + 1 wip-check + 3 genealogy + 3 inspections)"; the sweep only probes
  STATE-CHANGING routes, and the genealogy (GET #19–21) + inspection GETs (#22–23)
  never enter the failing list — the true remaining count is 10.
- `src/__db__/manufacturing/bom.spec.ts (11 tests)`:
  1. lifecycle: v1 DRAFT → v2 (versionNo 2) → DRAFT full-replace (preserved id + new
     line, scrap/qty asserted) → activate v1 → activate v2 archives v1 (one-active;
     findActiveBom v2; exactly 1 ACTIVE) → archive v2 → findActiveBom undefined → v3
     climbs to 3 (monotonic over ARCHIVED) → archive of non-ACTIVE → BOM_NOT_ACTIVE.
  2. audit events (entityType "bom"): created/activated/archived present; the dough
     activation row found by entityId.
  3. rejections: SERVICE FG → BOM_ITEM_NOT_STOCK; self-reference → BOM_SELF_REFERENCE;
     duplicate component → BOM_LINE_INVALID; qty 0 → BOM_LINE_INVALID; scrap −1 →
     BOM_LINE_INVALID; foreign outputUom → BOM_UOM_MISMATCH; yield 0 / 100.0001 →
     BOM_YIELD_INVALID; yield 100.0000 boundary create OK; non-DRAFT edit/activate →
     BOM_NOT_DRAFT; foreign line id on PUT → BOM_LINE_INVALID; unknown bom → BOM_NOT_FOUND.
  4. explosion: determinism (twice + explicit bomId deep-equal); composition exactness
     (the table above; single-pass equality; totals = Σ per level; itemId-ascending
     orders); cycle A→B→A → BOM_CYCLE with `details.chain [a, b]`; depth 16 walks /
     17 rejects (BOM_TOO_DEEP, maxDepth 16 — chain M-DEP-01..18); unknown item /
     flour-with-no-BOM / cross-item bomId → BOM_NOT_FOUND.
- First-run defect caught and fixed: spec SERVICE items must not carry tracking
  flags (ck_items_tracking_stock_kind) — ensureSpecItem now zeroes tracking for
  non-STOCK kinds.

## Deviations

- `BomUomMismatchError` added beyond the 11 listed error classes (explicitly allowed
  by the brief's D: "add if needed, or validate equality and 422").
- `countActiveBomVersions` omitted (see decision #4) — findActiveBom + the partial
  unique index + the 23505 catch are the one-active enforcement; if T38b wants the
  counter it is a 5-line addition to the store's bom section.
- The readonly-sweep remaining-count is 10 (not the brief's 17) — see the test-tails
  note; nothing to fix, the sweep's design only sweeps state-changing routes.
- viaSemiFinished semantics chosen as parent-item-id at level ≥ 2 / null at level 1
  (the brief did not pin it); documented in the service and the ExplosionLevelItem
  type.

## Handoff notes for T38b (production orders)

- **Fixture surface** (`src/__db__/manufacturing/fixtures.ts`): `TENANT_M`, `M_ACTOR`,
  `M_WAREHOUSE`, `M_QC`; `setupMfgFixture()` memoized; exported ids —
  `fiscalYearId`, `branchId`, `warehouseRaw` (M-RAW role RAW), `warehouseFg` (M-FG
  role FG), `customerId` (M-C1 + NET30), `taxCodeIds.{standard,notSubject}`,
  `gl.{inventory,wip,productionScrap,productionLabor,productionOverhead,cogs,
  arControl,salesRevenue,vatPayable,openingEquity,inventoryAppreciation,cashGl,
  serviceAccount}`, `items.{flour,yeast,pack,dough,bread}` (all STOCK/WAC/PCS/
  trackBatch/hasExpiry; shelf 180/90/365/2/5), `batches.{flour,yeast,packaging}`
  (M-F1/M-Y1/M-P1 batch IDS — for explicit-batch consumption), `boms.{dough,bread}`
  (post-activate BomRows, both ACTIVE). Exported service instances: `boms`
  (BomService), `warehouses`, `stock`, `tracking`, `periods`, `coa`, `taxCodes`,
  `registrations`, `salesInvoices` (+`mPosting`/`mNumbering`) — extend the export
  list with your order services (the header comment says so). Deterministic dates:
  M_OPENING_DATE 2025-12-31 / M_JAN 2026-01-05 / M_FEB / M_DEC. Helpers:
  `mfgAppClient()`, `su()`, `setMfgSetting(key, value)` / `clearMfgSetting(key)`
  (mirror setSalesSetting; values JSON.stringify'd — the qc_gate/
  scrap_reason_required/fg_batch_expiry_from_shelf_life/
  consumption_variance_threshold_pct overrides for your policy packs).
  Golden §8 chain remains unmutated by bom.spec — your orders own it: dough order
  planned 1000 materials M-RAW fg M-RAW (release lines flour 637.500000, yeast
  125.000000 = explode(dough,1000) level-1), bread order planned 750 fg M-FG
  (dough 937.500000, packaging 234.375000).
- **Store layout**: `manufacturing.store.ts` sections are banner-commented; the
  production-order functions append below the bottom banner (same
  tenantTx/erp.current_tenant_id/::text/alias conventions). The bom surface above
  is stable — additive only.
- **Module graph**: ManufacturingModule already imports Accounting/Audit/Inventory/
  Items/Configuration — your order services need no module change; movement-core
  stays a direct import (job-card-posting precedent). Read policies via
  ResolveEffectiveConfigService `config.policies` — all four manufacturing keys are
  ALWAYS present (T37's proof), never a readEffectiveSetting fallback.
- **Version binding**: bind the BOM version at release (bomId + yieldSnapshot) and
  snapshot level-1 as order lines — the released order keeps its version even after
  a newer BOM activates; that proof belongs to your orders spec (deliberately not in
  bom.spec).
- **Numbering**: PRD-{YYYY}-{SEQ:5} docType `production_order`, per-branch
  (branchId = order.branchId), periodKey = year — reserve+bind at release (INV-021);
  the manifest/series plumbing already exists (T37).
- readonly-sweep will go green once you mount routes #8–17 (+ #18/#24 by whoever
  owns them — wip-check is listed under your task in §15 but T38's brief splits
  it; coordinate: after T38b the sweep list should drop to wip-check + inspections
  only, then T39 clears the rest).
