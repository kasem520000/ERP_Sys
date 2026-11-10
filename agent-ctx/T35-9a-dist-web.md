# T35 — PHASE-017 Task 9-a-distribution (web UI) — 9a-dist

**Task ID:** 9a-dist · **Agent:** T35 (distribution + commissions web screens)
**Scope:** 5 screens (routes/visits · van stock · rep settlements · tiers/FOC · commissions) for the
finished PHASE-017 distribution/commissions backend, plus dictionary keys, wire types, and
localized error/status mappers. Work confined to `/home/z/phase017_work/apps/web` (+ the shared
`scripts` gate runs). **No backend, contracts, navigation, effective-config, or app-shell changes.**

## Files

### Created (pages — server component, the pos/terminals pattern)
| File | Notes |
| --- | --- |
| `apps/web/app/[locale]/distribution/routes/page.tsx` | primary resource `distribution/routes`; board seeded `distribution/visits?date=today`; supporting `sales/reps`, `distribution/vans`, `partners?limit=100` (CUSTOMER/BOTH, non-deleted) all degrade on failure; 401→login, 403→forbidden state. |
| `apps/web/app/[locale]/distribution/van/page.tsx` | primary `distribution/vans`; supporting `distribution/van-stock`, `tenancy/branches`, `sales/reps`, `inventory/warehouses` (non-VAN filtered by van ids), `items/items?limit=100` (STOCK), `inventory/transfers?status=IN_TRANSIT&limit=200` (client-filtered to van destinations). |
| `apps/web/app/[locale]/distribution/settlements/page.tsx` | primary `distribution/settlements`; supporting `sales/reps`, `treasury/cash-accounts`, `distribution/vans`. |
| `apps/web/app/[locale]/distribution/tiers/page.tsx` | primary `distribution/tiers`; supporting `distribution/free-goods-rules`, `items/price-lists?kind=SALE` (ACTIVE/SALE filtered), `items/items?limit=100` (STOCK). |
| `apps/web/app/[locale]/sales/commissions/page.tsx` | primary `sales/commission-runs`; supporting `sales/reps`. |

### Created (client components — the pos-terminals/shifts pattern)
| File | Screen surface |
| --- | --- |
| `components/distribution-routes.tsx` | route registry table (day-pattern badges) · create dialog (code `^[A-Za-z0-9._-]{2,30}$`, rep/van selects, 7 weekday toggles default MON–FRI, ≥1 enforced) · selected-route workspace: composition editor (multi-add, per-row order + pin, full-replace save) + plan-visits DatePicker (idempotent; weekday gate → `ROUTE_PLANNING_INVALID`) · visit board (date + status filters → refetch `distribution/visits`), rows grouped by route, check-in / complete (optional invoice/credit-note/receipt UUID links + note, regex-validated) / skip. |
| `components/distribution-van.tsx` | fleet table + register dialog (code `^[A-Za-z0-9_-]{1,20}$`, branch, rep — one van per rep) · per-van balances: picking a van re-reads `distribution/van-stock?warehouseId=` (refreshes the mirror); item/qty/value + exact-string totals (`sumExact`) · load-out & unload dialogs (main warehouse ↔ van; item + ≤6dp positive qty lines editor) — both return the dispatched transfer (IN_TRANSIT) · in-transit list with per-row receive (`distribution/van-stock/transfers/:id/receive`), auto re-read of the destination van. |
| `components/distribution-settlements.tsx` | status-filtered list + open dialog (rep, CASH+ACTIVE account, optional van, DatePicker, opening float) · detail workspace: summary grid (opening/cash sales/collections/refunds/expenses/expected/counted/variance+direction+reason), expected-cash component lines table (bilingual description, AR-first), count form with LIVE variance preview (exact `subtractExact` — recount path only, see deviations), approve (only when `approvalRequired`), post dialog (deposit account + amount, account⇒amount enforced), cancel (reason). All typed errors localized: `SETTLEMENT_PENDING_DOCUMENTS`, `SETTLEMENT_DAY_LOCKED`, `SETTLEMENT_APPROVAL_REQUIRED`, `SETTLEMENT_VARIANCE_REASON_REQUIRED`, `SETTLEMENT_SELF_APPROVAL`, `SETTLEMENT_STATE`, not-founds. |
| `components/distribution-tiers.tsx` | tiers table (price list, cap %, frequency, status) + create/edit dialog (code create-only; empty selects ⇒ explicit null clears — matches the PUT undefined=keep/null=clear semantics) · compact FOC rules table (buy/get sku×qty, per-multiple, max-free, tier, reason, window, status) + create dialog (positive ≤6dp qtys, reason 1–30 chars required, sane validity window, optional max-free/tier). |
| `components/commissions.tsx` | runs table (period/basis/totals/status) + create dialog (periodFrom ≤ periodTo, basis) — create = create+compute (DRAFT with lines) · run detail: lines table (rep/base/rate/commission, excluded note-lines render as a badge, payout ACCRUED/PAID) + post (the accrual point) and cancel (reason) · per-rep rules editor: rep select → GET rule → method/rate/basis; a flat rate replaces tier bands, an empty rate with a tiered rule PRESERVES them (read-only band chips). |

### Modified
| File | Change |
| --- | --- |
| `apps/web/i18n/dictionaries.ts` | replaced the three `// (agent-filled block)` lines at the **T14** anchor (interface + ar + en) with **231 keys** (dist* / commissions* / commErr*). The T6 automotive anchor was never touched (the parallel agent filled it mid-task; anchors were re-located after their edits). |
| `apps/web/lib/api-types.ts` | appended the requested rows — `RouteRow`, `RouteVisitRow`, `VanRow`, `VanStockRow`, `RepSettlementRow` (+`approvalRequired`), `RepSettlementLineRow`, `CustomerTierRow`, `FreeGoodsRuleRow`, `CommissionRunRow`, `CommissionRunLineRow` — plus supporting `RouteDayCode`, `RouteCustomerRow`, `RoutePlanVisitsResult`, `RepSettlementWithLines`, `CommissionRunWithLines`, `RepCommissionRuleRow`. Mirrors the store rows exactly (ADR-0009 decimal strings). |
| `apps/web/lib/messages.ts` | `localizedDistributionError` + `localizedCommissionError` (typed-code → dictionary; A7 not-founds render generically; posting-engine codes fall back to the API message) and label helpers: `localizedVisitStatus`, `localizedDayCode`, `localizedSettlementStatus`, `localizedVarianceDirection`, `localizedSettlementComponent` (incl. VARIANCE/BANK_DEPOSIT posted legs), `localizedCommissionStatus`, `localizedCommissionBasis`, `localizedPayoutStatus`; added the shared `INACTIVE` case to `localizedStatus`. |

## Key count
**231 keys × 3 blocks (interface/ar/en)** — routes+visits 60, van stock 34, settlements 61, tiers+FOC 34,
commissions 42 (incl. the late `distCompDerivedHint`, `distComponentVariance`, `distComponentBankDeposit`).
AR authored first, then EN. Reused existing common keys (`commonSave/Cancel/Open/Clear/Confirm`,
`statusActive/Inactive/Cancelled`, `accountingColStatus`, `errors*`, `transfersCol*`/`transfersReceive`).

## Verification output
```
$ pnpm --filter @erp/web typecheck        → tsc --noEmit, exit 0 (clean)
$ pnpm --filter @erp/web run lint         → eslint ., exit 0 (clean)
$ pnpm run check:i18n-parity
== i18n key parity: ar=2348 keys, en=2348 keys ==
ar/en catalogs at 100% key parity; no empty values.
```
(2348 includes the T6 automotive agent's keys; parity re-run after their concurrent landing — my 231
are complete in all three blocks.)

## Deviations & decisions (all additive, none blocking)
1. **Composition read path:** the registered surface has **no GET for a route's customers** (only the
   POST full-replace). The editor derives the current composition from the route's planned visits
   (`GET distribution/visits?routeId=` — first appearance across dates) and says so in the UI
   (`distCompDerivedHint`); saving is the authoritative full-replace. Backend change was out of scope.
2. **In-transit list source:** `GET inventory/transfers?status=IN_TRANSIT` (registered inventory
   route), client-filtered to van destinations; receive rides the distribution route
   `van-stock/transfers/:id/receive`. Degrades to empty on 403 (the screen still works).
3. **List caps:** partners/items LIMIT max is 100 server-side → `?limit=100` (not 500).
4. **Settlement count preview:** a DRAFT's expected cash is ledger-computed at count time, so the
   live variance preview is only honest on the **recount** path (`countedCash !== null`); first
   counts send blind and the typed `SETTLEMENT_VARIANCE_REASON_REQUIRED` renders localized. The
   reason input still pre-validates on previews.
5. **Commission rule PUT semantics:** NONE clears rate+tiers; a non-empty flat rate replaces tier
   bands (`tiers: null`); an empty rate with a tiered rule re-sends the loaded bands (preserved).
   Band editing stays out of scope (read-only chips + hint), per the task's "method/rate/basis editor".
6. **`text-muted-foreground`:** used by ~20 existing components but absent from the Tailwind v4
   `@theme` tokens — my components use the real `text-gray-500` token (same visual intent).
7. **Route PUT / FOC PUT:** not surfaced — the task spec lists create dialogs only (no edit dialogs
   for routes/FOC); tier edit IS included (task: "create/edit dialog").
8. **Complete-visit links** are optional UUID text inputs (client regex + server zod both guard).
9. **`bg-surface`** does not exist as a token — used `bg-surface-sunken` for inset panels.

## Coordination notes
- The T6 automotive agent filled their dictionary/api-types/messages blocks **concurrently**; I
  re-located my three anchors after each of their edits and only ever replaced MY `// (agent-filled
  block)` lines (one MultiEdit partially applied mid-conflict; verified no duplicates, then applied
  the ar/en blocks individually with the correct `,`/`;` literal endings).
- No changes to: `contracts/navigation.ts`, `lib/effective-config.ts`, `app-shell.tsx` (its
  distribution crumbs/`pagePath` fallbacks already cover my five routes), backend files.
