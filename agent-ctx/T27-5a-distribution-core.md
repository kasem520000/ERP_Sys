# T27 / Task 5-a — Distribution module core: routes, visits, van stock (PHASE-017 T7/T8)

**Agent:** 5-a (distribution module core) · **Task ID:** 5-a · **Repo:** /home/z/phase017_work
**Status:** COMPLETE — `pnpm --filter @erp/api typecheck` green (exit 0), full-package `eslint .` green (exit 0), spec **6/6 green** (isolated TMPDIR run), boot-free route probe OK (all 16 mounted paths match `ROUTE_PERMISSIONS` verbatim; 24 settlements/tiers/free-goods entries verified deferred).

## Files

| File | Kind | Notes |
|---|---|---|
| `apps/api/src/modules/distribution/domain/distribution-errors.ts` | new | Typed DomainError set (codes below) |
| `apps/api/src/modules/distribution/infrastructure/distribution.store.ts` | new | Function-module store — the ONLY writer of `routes`/`route_customers`/`route_visits`/`van_stocks` + the VAN slice of `warehouses` |
| `apps/api/src/modules/distribution/application/route-service.ts` | new | `RouteService` — route CRUD, composition, planVisits (idempotent, planning-only) |
| `apps/api/src/modules/distribution/application/visit-service.ts` | new | `VisitService` — board, checkIn/complete/skip, markMissedVisits |
| `apps/api/src/modules/distribution/application/van-stock-service.ts` | new | `VanStockService` — registerVan, loadOut/receiveTransfer/unload (wraps `TransferService`), mirror-first reads, balances |
| `apps/api/src/modules/distribution/presentation/distribution.controller.ts` | new | `@Controller("api/v1/distribution")` — the 16 T7/T8 routes only |
| `apps/api/src/modules/distribution/distribution.module.ts` | new | imports [AuditModule, InventoryModule] (InventoryModule exports `TransferService` — verified), controllers/providers/exports the 3 services |
| `apps/api/src/app.module.ts` | edit (add-only) | `DistributionModule` added immediately after `SalesModule` (import + array entry) |
| `apps/api/src/__db__/distribution/core.spec.ts` | new | 6 db-backed tests on `setupSalesFixture()` tenant S |

Untouched (as instructed): `infra/auth/route-permissions.ts`, migration `0025`, `src/db/schema.ts`, sales/partners/inventory files.

## Error surface (`distribution-errors.ts`)

`ROUTE_NOT_FOUND`, `ROUTE_CODE_TAKEN` (RouteCodeDuplicateError), `ROUTE_PLANNING_INVALID` (PlanningDataError), `VISIT_NOT_FOUND`, `VISIT_STATE`, `VISIT_DOCUMENT_NOT_FOUND` (VisitDocumentNotFoundError — **addition**, see deviations), `VAN_NOT_FOUND`, `VAN_CODE_TAKEN` (VanCodeDuplicateError — **addition**), `VAN_REP_BINDING` (VanRepBindingError), `VAN_LOAD_OUT` (LoadOutError).

## Store surface (`distribution.store.ts`)

- **Routes:** `insertRoute` (jsonb day_pattern via `JSON.stringify(...)::jsonb`), `findRouteById` / `findRouteByCode` (rep + van code joined), `listRoutes({status?, limit})`, `updateRoute` (dynamic `sql.join` SET — undefined=untouched, null=clear, `COALESCE`/`CASE WHEN` semantics), `replaceRouteCustomers` (DELETE+INSERT — the granted DELETE table), `listRouteCustomers` (customer code/name/nameAr joined, ORDER BY visit_order).
- **Visits:** `insertVisits` (batch loop), `findVisitById`, `listVisits({date?, routeId?, status?, limit})` (route code + customer name joins — the board shape), `checkInVisit`/`completeVisit`/`skipVisit` — **conditional UPDATEs** (`WHERE status='PLANNED' [AND checked_in_at IS NULL] RETURNING id`) as the exactly-once anchors; provided doc links only ever fill (COALESCE); `markVisitsMissed(beforeDate)` (PLANNED ∧ `planned_date < beforeDate` ∧ `checked_in_at IS NULL` → MISSED, returns flipped ids).
- **Vans:** `listVans` (type='VAN' + rep/branch joins), `findVanByWarehouseId` (returns the row whatever its type — caller decides VAN-ness), `findVanByRepId` (one-van-per-rep probe), `insertVanWarehouse` (direct `INSERT INTO warehouses` with `type='VAN'` + `rep_id` — **documented VAN-slice exception**: inventory's `insertWarehouse` predates the 0025 additive columns and stays unaware of them; distribution owns these two additive columns, still through ambient tx + `erp.current_tenant_id()` + erp_app grants), `updateVanRep` (store primitive, unexposed in the 5-a service — 6-a/6-b may surface it).
- **Mirror:** `vanWarehouseIds()`, `refreshVanStockMirror(warehouseIds?)` (ambient-tx DELETE scoped slice → `SELECT SUM(CASE WHEN direction='IN' THEN qty ELSE -qty END)` GROUP BY (warehouse, item, batch) over `stock_moves ⋈ warehouses type='VAN'`, `HAVING <> 0` skips zero rows, re-INSERT with `generateUuidV7()`, `refreshed_at = now()`), `listVanStock` (item sku/name/nameAr joins), `vanStockTotals` (per-van totals + max refreshed_at).
- **Read-only cross-module reads (§6 read precedent, own SQL, documented):** `findCustomerRef` (partners), `findSalesRepRef` (sales_reps), `findWarehouseCodeRef` (warehouses), `salesInvoiceExists`/`creditNoteExists`/`receiptExists` (fixed-table EXISTS — visit completion links).

## Service semantics

**RouteService** (`@Inject(AuditService)`): dayPattern validated ⊆ MON..SUN (non-empty, no dupes → PlanningDataError; default MON–FRI); rep must exist + ACTIVE; van must be VAN-type + active; code unique (pre-check → RouteCodeDuplicateError). Audits `distribution.route_created` / `route_updated` (entityType `"route"`). `setCustomers` full-replace — customers exist + kind CUSTOMER/BOTH + no dupes; visitOrder defaults to array index. `planVisits` — weekday (UTC) must ∈ day_pattern else PlanningDataError; idempotent (skips existing (route, customer, date) via a pre-read); audits `distribution.route_visits_planned` with `{date, planned, skipped}`; **NO LEDGER EVER** (no posting service is even imported). `visitsForRoute(routeId, date?)`.

**VisitService** (`@Inject(AuditService)`): `list` (board), `checkIn` (double check-in → VISIT_STATE; stamps checked_in_at + optional rep/note), `complete` (EXISTS-validates each provided salesInvoiceId/creditNoteId/receiptId → VISIT_DOCUMENT_NOT_FOUND; stamps checked_out_at + COMPLETED + links), `skip` (PLANNED→SKIPPED), `markMissedVisits(date)` — batch audited as ONE event anchored on the first flipped id (the `inventory.reservations_swept` pattern) with `{beforeDate, missed, visitIds}`.

**VanStockService** (`@Inject(AuditService)`, `transferService: TransferService` injected positionally): `registerVan` (rep exists+ACTIVE, one-van-per-rep pre-check → VAN_REP_BINDING, warehouse code pre-check → VAN_CODE_TAKEN, VAN warehouse insert; audit `distribution.van_registered` entityType `"van"`); `listVans`; `listVanStock` (mirror refresh first — given van or all VAN warehouses — then read); `loadOut` (van VAN+active, from ≠ van, non-empty lines → `transferService.create(from→van)` + `dispatch` → IN_TRANSIT; audit `distribution.van_loadout`; **no journal of its own** — TransferService owns the G-15 branch-distinct policy); `receiveTransfer` (dest must be a VAN warehouse → `transferService.receive` + mirror refresh of that van; audit `distribution.van_transfer_received`); `unload` (reverse create+dispatch; audit `distribution.van_unload`); `balances` (refresh + per-van mirror totals).

## API surface (all requireIdentity + envelope + zod; POSTs HttpCode 201)

```
GET    /api/v1/distribution/routes                    ?status&limit         distribution.routes.manage + distribution.routes
POST   /api/v1/distribution/routes                    {code,name,nameAr?,salesRepId?,vanWarehouseId?,dayPattern?,note?,noteAr?}
GET    /api/v1/distribution/routes/:id
PUT    /api/v1/distribution/routes/:id                {name?,nameAr?,salesRepId?,vanWarehouseId?,dayPattern?,status?,note?,noteAr?}
POST   /api/v1/distribution/routes/:id/customers      {customers:[{customerId,visitOrder?,isPinned?}]} (full-replace)
POST   /api/v1/distribution/routes/:id/plan-visits    {date}
GET    /api/v1/distribution/visits                    ?date&routeId&status&limit          (same routes keys)
POST   /api/v1/distribution/visits/:id/check-in       {salesRepId?,note?}
POST   /api/v1/distribution/visits/:id/complete       {salesInvoiceId?,creditNoteId?,receiptId?,note?}
POST   /api/v1/distribution/visits/:id/skip           {note?}
GET    /api/v1/distribution/vans                      distribution.van_stock.view + distribution.van_stock
POST   /api/v1/distribution/vans                      {code,name,nameAr?,branchId,salesRepId}   manage + feature
GET    /api/v1/distribution/van-stock                 ?warehouseId&itemId&limit              view + feature
POST   /api/v1/distribution/van-stock/load-out        {fromWarehouseId,vanWarehouseId,lines:[{itemId,qty}],note?,noteAr?}  manage + feature
POST   /api/v1/distribution/van-stock/unload          {vanWarehouseId,toWarehouseId,lines,note?,noteAr?}                 manage + feature
POST   /api/v1/distribution/van-stock/transfers/:id/receive                                                    manage + feature
```

**Route-probe evidence** (temporary tsx probe over `Reflect` metadata vs `ROUTE_PERMISSIONS`, deleted after the run): all 16 mounted paths matched registered entries verbatim; the 24 `settlements`/`tiers`/`free-goods-rules` entries printed as deferred — none mounted. A comment in the controller marks where 6-a/6-b land.

## Test output (isolated: `mkdir -p $HOME/tmp-5a && cd apps/api && TMPDIR=$HOME/tmp-5a npx vitest run --config vitest.db.config.ts src/__db__/distribution/core.spec.ts`)

```
 ✓ src/__db__/distribution/core.spec.ts (6 tests) 924ms
 Test Files  1 passed (1)   Tests  6 passed (6)
```

Fixture: `setupSalesFixture()` (tenant S; S-WH with items a×20 @60 WAC / b×10 @25; customerId + limitedCustomerId); rep `D-REP-01` + `D-REP-02` via the real `SalesRepService.create`; van `D-VAN-01` via `registerVan` (idempotent guards for suite reruns).

1. **Route CRUD + composition + planVisits:** create (rep join, default pattern), duplicate code → `ROUTE_CODE_TAKEN`, bad pattern → `ROUTE_PLANNING_INVALID`, find/list/update (ACTIVE↔INACTIVE), setCustomers (visitOrder 1/2 defaults, isPinned, name join), duplicate customer + unknown partner → `ROUTE_PLANNING_INVALID`, plan 2026-01-15 (THU) → 2 PLANNED with `salesRepId` + route/customer names, re-plan → `{planned: 0, skipped: 2}` (idempotent), 2026-01-17 (SAT) → `ROUTE_PLANNING_INVALID` (weekday gate), visitsForRoute + board.
2. **Planning-only evidence:** `countJournals()` snapshot before the whole pack → **unchanged after** (no route/visit op writes a journal). Second pack: full RT-SOUTH route (create/compose/plan), `ROUTE_NOT_FOUND` on unknown id, binding a route to the STANDARD warehouse `S-WH` → `VAN_NOT_FOUND` — journal count still unchanged.
3. **registerVan:** VAN warehouse `type='VAN'`, `salesRepId`/`salesRepCode` bound, active, listed by `listVans`; same rep again → `VAN_REP_BINDING`; warehouse-code collision (`S-WH`, via the second rep so the rep gate doesn't shadow it) → `VAN_CODE_TAKEN`.
4. **Van stock conservation + BR-016 + no-journal:** `loadOut` 5× item a → status IN_TRANSIT + `TRN-\d{4}-\d{6}`; **mirror EMPTY while in transit** (in-transit never sellable); load-out guards (source ≡ van, empty lines) → `VAN_LOAD_OUT`; `receiveTransfer` → POSTED, mirror qty `5.000000` value `300.0000` (5 × 60.000000 carried WAC); `unload` 2 → mirror `3.000000`; **conservation tie**: `Σ signed stock_moves @ van == mirror qty` (raw-SQL probe); `balances({warehouseId})` total `3.000000`; **journal count unchanged through load-out → receive → unload** (both warehouses resolve the shared tenant INVENTORY purpose 1140 ⇒ policy-none — G-15).
5. **Visit lifecycle:** checkIn (stamp; double → `VISIT_STATE`), dangling completion link → `VISIT_DOCUMENT_NOT_FOUND`, complete with a REAL posted invoice (`quickPostedInvoice` — its own +1 journal asserted explicitly), COMPLETED + checked_out_at + salesInvoiceId linked, re-complete → `VISIT_STATE`, skip + re-skip → `VISIT_STATE`, `markMissedVisits("2026-01-13")` flips **0** (COMPLETED/SKIPPED stops never flip; nothing stale yet); journal count unchanged by the visit ops themselves (only the invoice's own posting).
6. **Missed sweep flips the genuinely stale:** RT-SOUTH visit planned 2026-01-05 (Monday) → `markMissedVisits("2026-01-13")` → in `visitIds`, status MISSED; post-sweep skip → `VISIT_STATE`.

## What Tasks 6-a / 6-b add (hand-off)

- **6-a (T10 rep settlements):** `rep_settlements`/`rep_settlement_lines` service + the 7 `settlements` routes (`GET/POST settlements`, `GET :id`, `POST :id/{count,approve,post,cancel}`) with `distribution.settlements.manage`/`.approve` (creator ≠ approver); STL- numbering; variance ALWAYS posts BR-021; expected-cash math may reuse `vanStockTotals` + the van mirror (already refreshed inside receive/balances) and reads my visit board for the day's documents. `VanStockService` is exported from `DistributionModule` for the balances tie-in; a new `SettlementService` provider + controller mount on the same prefix (the controller comment marks the spot).
- **6-b (T11 tiers + free goods):** `customer_tiers` + `free_goods_rules` services + the 8 `tiers`/`free-goods-rules` routes with `distribution.tiers.manage` / `distribution.free_goods.manage`; BR-003 price resolution and BR-008 FOC reason codes land in the sales pricing path, not here.
- Reports (T13) can consume `listVisits` (compliance), `vanStockTotals` (van balances), `vanWarehouseIds()` directly — all exported via the store/module.

## Deviations / decisions (read before building on this)

1. **Two extra typed errors beyond the listed eight:** `VisitDocumentNotFoundError` (`VISIT_DOCUMENT_NOT_FOUND`) — the task mandated a typed error for absent completion links but the 8-name list had no fit; `VanCodeDuplicateError` (`VAN_CODE_TAKEN`) — a van code IS a warehouse code (uq_warehouses_tenant_code) and surfacing the raw 23505 (or misusing `RouteCodeDuplicateError`) would be worse. Both mirror the pos-error style.
2. **`insertVanWarehouse` writes `warehouses` directly** — the documented VAN-slice exception (inventory's `insertWarehouse` predates `type`/`rep_id`); van rows are inserted with `inventory_account_id NULL` (⇒ tenant INVENTORY purpose — the shared-account no-journal default per §2.5) and STANDARD warehouses remain inventory's exclusively.
3. **Visit-state machine:** checkIn requires PLANNED + no prior check-in; complete/skip require PLANNED. complete does NOT require a prior check-in (actuals may arrive from a sales doc without an explicit check-in — §2 "actuals from sales documents or explicit check-ins"). checkIn keeps status PLANNED (only the timestamp).
4. **Idempotency of planVisits is a pre-read, not a DB constraint** — migration 0025 deliberately has no unique index on (route, customer, date); the service skips existing triples, making re-plans no-ops (asserted).
5. **`markMissedVisits` does not flip checked-in-but-never-completed visits** — the task's condition is "no check_in"; those stay PLANNED for the compliance report to age.
6. **`updateVanRep` is a store primitive** not yet surfaced on the 5-a service (no route in the registered 16) — 6-a/6-b or a later task can expose rep rebinding.
7. **`weekdayOf` is UTC** — dates travel as `YYYY-MM-DD` strings everywhere (no server-TZ drift), matching the DATE zod gate.
8. **Mirror refresh scope:** `listVanStock`/`balances` refresh the given van (or ALL VAN warehouses) inside the ambient tx before reading; `receiveTransfer` refreshes only the destination van. Refresh is DELETE+INSERT (the granted DELETE on `van_stocks`), never incremental — the tie to `stock_moves` is asserted in test 4.
9. Decimal strings throughout (`qty::text`, `value::text`, 6dp/4dp); bilingual `nameAr`/`noteAr` honored on routes/vans/visits; audit entityType `"route"`/`"visit"`/`"van"` as specified.
