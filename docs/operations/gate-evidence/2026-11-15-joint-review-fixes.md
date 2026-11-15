# Gate evidence — the JOINT REVIEW FIXES: FEFO warehouse scope, the settlement/termination identity, the T-03 shift fixes, and the promise point UI (2026-11-15)

**Scope:** the owner's directive after the independent review of
`a88a898` — five fixes plus the promise-point surface, then the FULL
DB SUITE in sequence on a NEW unified head with the independent tests
and the shared gates. **Starting this round is NOT closure of 043, NOT
closure of 045, and NOT production approval — both phases and both
open risks (RISK-031, RISK-032) stay open for the owner's review.**

**The unified head this round answers for:** `75943ab` (the four fix
commits on top of `a88a898`: the FEFO warehouse-scope law `e2caf4e`,
the settlement/termination identity `f862b4c`, the T-03 shift fixes
`fb6af65`, the promise point UI `75943ab`).

**Coordination record:** this round touched BOTH phases' subject
matter (043's inventory/sales core + 045's hr module) plus the web
app — the owner's joint-review directive; the commits stay one-fix-each
with their own before/after evidence, and the shared gates below ran
ONCE at the unified head (never merged from separate runs).

---

## What landed (the five fixes + the surface)

### 1. THE FEFO WAREHOUSE-SCOPE LAW (`e2caf4e`)

The reviewer's finding: **FEFO batch selection was computed on the
ITEM'S TOTAL BALANCE ACROSS WAREHOUSES, not on the issuing warehouse's
own stock.** `listFefoBatches` folded `stock_moves` with no warehouse
filter, so an issue of 10 at a warehouse holding 10 of a local
(later-expiry) batch planned slices from a foreign (earlier-expiry)
batch sitting 5-strong at a sister warehouse — the plan then **died at
the bin allocation** (`BinContentsShortError`: the foreign batch has
no bins at the issuing warehouse) or, in the binless legacy mode,
**recorded `stock_moves` at the issuing warehouse against a batch that
does not exist there.** This is exactly why `mto-lifecycle` failed
inside the full bundle while passing standalone (the bundle's shared
DB carries earlier runs' batches of the fixed-SKU items at the sister
warehouse; a standalone fresh DB does not).

**The fix:** `listFefoBatches(itemId, warehouseId)` scopes the on-hand
fold to the issuing warehouse (a batch with no local stock is never
listed, never picked, never written); the explicit-batch on-hand bound
reads `batchOnHand(batchId, warehouseId)` — a foreign batch's
cross-warehouse total no longer passes (the typed
`BATCH_INSUFFICIENT_STOCK`, zero residue); the expiry write-off reads
the same warehouse-local fold (a write-off of a batch at a warehouse
where it holds nothing is the typed rejection; the other warehouses'
stock stays on their books).

**Evidence (each its own run, before → after at the same tree):**

| Run | Result |
|-----|--------|
| `fefo-warehouse-scope.spec` BEFORE the fix | **2/2 FAIL** — both arms died with `BinContentsShortError` (`fefo-warehouse-scope-before.log`: the 10-issue planned 5 from the foreign batch; the explicit foreign-batch issue passed the cross-warehouse bound) |
| `fefo-warehouse-scope.spec` AFTER the fix | **2/2 PASS** (`fefo-warehouse-scope-after.log`: all 10 from the LOCAL batch, ZERO foreign-batch moves at the issuing warehouse, the foreign 5 untouched at their own warehouse, the explicit foreign batch and the write-off both the typed rejection) |
| regression: inventory folder | **26/26 files · 146/146** |
| regression: manufacturing folder (mto-lifecycle included) | **28/28 files · 170/170** |
| regression: sales + pos + purchasing | **18/18 files · 150/150** |

### 2. THE SETTLEMENT / TERMINATION IDENTITY LAW (`f862b4c`)

The reviewer's directive: **re-verify the live reservation row's
identity in the consumption, the final release, and the cancel/close —
not in the allowance calculation only.** Pre-fix the delivery
settlement's (5b) `partialConsume` and the (5c) finalization's release
trusted the order line's stored `reservation_id` ALONE, and the order
terminations (`releaseOrderReservations` — cancel/close) did the same
(`svc.find` + a status check): a rogue or stale link **CONSUMED or
RELEASED A THIRD PARTY'S coverage** while the attacker's delivery
shipped free stock, and a link to an already-dead row made the whole
delivery post THROW (`ReservationStateError` rollback).

**The fix — one definition everywhere** (the new
`sales/application/reservation-identity.ts` — `liveOwnReservationForOrder`:
LIVE row (ACTIVE, non-expired) + the line's ITEM + the ORDER's
WAREHOUSE + the BENEFICIARY holder):

- the delivery post's beneficiary allowance (refactored onto the
  helper — semantics unchanged from the hard-review round);
- the settlement's OWN-reservation consume (5b): a mismatched or dead
  row is **SKIPPED** (fail-closed — someone else's pool is untouchable,
  a dead row has nothing to retire; the post never throws on a stale
  link);
- the fully-delivered finalization's release (5c): identity-verified;
  the stale link still clears, the foreign row stays untouched;
- the order terminations (cancel/close): identity-verified — another
  order's cancellation/close can never release a third party's
  coverage; the stale link still clears;
- `checkLineAtp`'s own-reservation read refactored onto the same
  helper.

**Evidence (each its own run, before → after at the same tree):**

| Run | Result |
|-----|--------|
| `reservation-hard-review.spec` (n)/(o) BEFORE the fix | **2 FAIL** (`settlement-identity-before.log`: the victim's ACTIVE 6 was consumed 4 by the attacker's partial delivery, released in full at the attacker's line completion, and released again by the attacker's cancel) — (k)(l)(m) still 3/3 PASS |
| `reservation-hard-review.spec` AFTER the fix | **5/5 PASS** (`settlement-identity-after.log`: the victim's coverage untouched through the partial + completing deliveries, the dead-link post clean, cancel AND close both identity-safe, the free-pool accounting exact) |
| regression: sales + manufacturing | **38/38 files · 252/252** |

### 3–5. THE T-03 SHIFT FIXES (`fb6af65`)

Three findings on the 045 parallel track:

1. **THE CHUNKED ROTATION WRITE** — a full run at the declared ceiling
   (200 employees × 92 days = 18,400 cells × 5 bind params = 92,000
   parameters) blew PostgreSQL's 65,535-parameter wire-protocol limit
   as ONE INSERT (the pre-fix reproduction:
   `bind message has 26464 parameter formats but 0 parameters`).
   `bulkUpsertRotationCells` now writes in chunks of 13,107 rows
   (⌊65,535/5⌋, a documented compile-time constant), every chunk on the
   SAME ambient transaction — one commit/rollback unit.
2. **THE PAGINATED GRID READ** — pre-fix `readGrid` was a SILENT
   `LIMIT 5000` (a full-year grid for 200 employees = 73,200 cells
   returned 5,000 rows with no truncation signal and no way to fetch
   the rest). The read now answers
   `{ rows, page, pageSize, total, hasMore }` (default page 500,
   ceiling 5,000), the store gains `OFFSET` + `countRosterCells` with
   the same filters, and the route accepts `page`/`pageSize`.
3. **THE RLS TEST'S ISOLATION** — spec (d) no longer assumes the
   SHARED tenant A is empty; the boundary is proven on TENANT H's OWN
   rows BY ID against tenant A, plus a DEDICATED isolated boundary
   tenant (`TENANT_H_RLS` — empty by construction) carrying the strong
   empty-world assertions and the by-ID not-found arms.

**Evidence (each its own run, before → after at the same tree):**

| Run | Result |
|-----|--------|
| the 200×92 ceiling test BEFORE the chunking | **FAIL** — the protocol error above (`rotation-ceiling-before.log`) |
| `shifts-roster.spec` AFTER all three fixes | **5/5 PASS** (`rotation-ceiling-after.log`: the full 200×92 run — 18,400 cells written, idempotent re-run, the over-the-ceiling guards (201 employees / 93 days) still typed; the 28-cell pagination walk; the 18,400-cell walk across 37 pages retrieves EVERY cell; the isolated-tenant boundary arms) |

### 6. THE PROMISE POINT UI (`75943ab`)

The reviewer's directive: **display the ATP states, the quantities,
and the bilingual warning at the promise point, keeping the unreserved
portion advisory and allowing backorders.** The new
`AtpPromisePoint` component on the sales orders workspace (a "Promise
point" row action, gated by `sales.orders.view`) renders per line: the
verdict (OK/SHORT), the three-valued protection standing
(UNPROTECTED / PARTIALLY_PROTECTED / FULLY_PROTECTED), the five
quantities (availableNow at the requested date, remaining,
allocated-to-line, protected, unprotected), the CTP suggested date,
and the BILINGUAL advisory note verbatim (EN ltr + AR rtl). The
card's description carries the standing rule itself
(`salesPromiseAdvisoryRule`: the unreserved portion is advisory only,
a backorder remains possible, a shortage never blocks issuing) — and
nothing in the panel blocks anything (no ATP gate exists at issue).

**Evidence:** web typecheck clean; web lint clean; web unit 5/5 files
· 73/73; i18n parity 5789 = 5789 keys (22 new keys, AR/EN).

---

## THE SHARED GATES AT THE UNIFIED HEAD `75943ab` (each its own run, this session)

| Gate | Command | Result |
|------|---------|--------|
| **THE FULL DB SUITE — ONE serial run** | `vitest run --config vitest.db.config.ts` (all `src/__db__` specs, one embedded PostgreSQL 16, one process, sequential) | **227/227 files · 3,228 passed \| 2 skipped · 0 failed · 515.43s** (`full-db-suite-joint-review.log`) — includes `mto-lifecycle` (the bundle-failure the FEFO defect explains), `fefo-warehouse-scope` 2/2, `reservation-hard-review` 5/5, `shifts-roster` 5/5, `identity-flows` (the route × role checklist) |
| api typecheck | `tsc --noEmit -p tsconfig.json` | **clean (exit 0)** |
| api lint | `eslint .` | **clean (exit 0)** |
| web typecheck | `tsc --noEmit -p tsconfig.json` | **clean (exit 0)** |
| web lint | `eslint .` | **clean (exit 0)** |
| web unit | `vitest run` | **5/5 files · 73/73** |
| id-ledger + self-test | `pnpm run check:id-ledger` + `--self-test` | **0 errors / 0 warnings; self-test 14/14 OK (9c/9d included)** — corrected in place 2026-11-15 (the 59085a0 review round): the original cell said "16/16 OK (9c/9d included)", a transcription error (exactly 14 arms at this and every relevant head since 817b276; the 81f09e9 round already flagged it in its own ledger) |
| permissions drift | `pnpm run check:permissions-drift` | **OK — matrix 297 = seed 297** |
| i18n parity | `pnpm run check:i18n-parity` | **ar=5789 = en=5789, 100%, no empty values** |
| docs validation | `pnpm run docs:validate` | **33/33 checks passed** |

## Honest notes

- The mto-lifecycle bundle-failure mechanism (the FEFO defect feeding
  on the shared DB's cross-warehouse batch residue of the fixed-SKU
  items) is now CLOSED at the root — the FEFO fold is warehouse-local —
  and the full-suite single run above is the proof (227/227 with
  mto-lifecycle inside it).
- The settlement identity's dead-link arm changes one observable
  behavior on purpose: pre-fix a delivery whose line pointed at an
  already-consumed reservation THREW (the whole post rolled back);
  post-fix the identity read skips the dead row and the delivery posts
  on its own entitlements. The fail-closed direction that matters
  (never touch a row the order does not own) is unchanged and now
  pinned by (n3).
- The isolated boundary tenant (`TENANT_H_RLS`) is a test fixture
  tenant only — no production surface references it.
- **What stays OPEN:** RISK-031 (the nightly probe's documented
  boundary), RISK-032 (the unreserved-demand POLICY — the owner's
  choice; the reservation-side closure claim stays withdrawn pending
  the independent review's verdict on the fixed heads), the 043
  hard review itself (this round's fixes go to the reviewer), and
  PHASE-045 (T-02's RLS-attack half + T-04…T-19). **NO closure of 043,
  NO closure of 045, and NO production approval are claimed by this
  round.**
