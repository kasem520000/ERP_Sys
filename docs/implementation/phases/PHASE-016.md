# PHASE-016 — Point of Sale

> **Status:** COMPLETE · **Updated:** 2026-11-02

## 1. Phase Overview

- **Phase ID:** PHASE-016
- **Title:** Point of Sale
- **Objective:** Deliver the `pos` module as the terminal layer over the sales module:
  registered terminals bound to branches and devices, POS-grade cashier shifts, a
  touch-first counter sale flow that posts through the sales module's invoice chain
  (cash auto-post policy), 80 mm / 58 mm RTL-correct receipts through the PHASE-013
  print system, table service and kitchen tickets for the restaurant template, and the
  **scoped offline sale queue** — the deliberately narrow, first real consumer of the
  sync protocol (per the PHASE-016/PHASE-020 boundary table in
  [SYNC_PROTOCOL.md §11](../../offline/SYNC_PROTOCOL.md)) — so a shop keeps selling
  through outages with `OFF-` receipt numbers, honest `PENDING_SYNC` state, and
  exactly-once ledger effects on reconnect.
- **Business value:** Counter retail is the region's most common software need; this
  phase turns the MVP back-office ERP into a working shop-front system (retail, grocery,
  restaurant templates all light up their POS entries), and it de-risks the entire
  offline program by proving the protocol on one narrow, high-value flow before
  PHASE-020 generalizes it (roadmap sequencing rationale #4–#5).

## 2. Scope

In scope:

1. **Terminal registry** (`pos.terminals` feature): `pos_terminals` rows per branch —
   code, name, branch binding, linked device (one terminal = one device), cash account
   binding (till), receipt size (80/58 mm), activate/deactivate lifecycle; admin
   registration screen; `pos-terminal` platform devices enrolled manually by an admin
   (SYNC_PROTOCOL §11: attestation-lite optional at this phase).
2. **POS shifts** (`pos.shifts`): reuse the treasury shift model from
   [PHASE-008](PHASE-008.md) — opening float → in-shift sales capture → blind close
   count → variance posting per BR-021 (shortage → expense; overage → income;
   approval-gated above tolerance; **never netted silently**) — with POS-grade terminal
   UX (open/close from the sale screen, per-denomination count entry, supervisor PIN for
   beyond-tolerance variance). Shift events queue offline like sales (capabilities
   matrix row #3).
3. **POS sale flow** (`pos.sales`): touch-first UI per the POS archetype
   ([PAGE_ARCHETYPES.md §10](../../ui/PAGE_ARCHETYPES.md)) — item grid tiles + category
   tabs, auto-focus barcode scan input, cart with qty steppers, large total, tender panel
   with **cash / card / mixed-split** payments; keyboard-wedge and camera scanning
   (`pos.barcode_scanning`), including **scale-barcode parsing** for weighed grocery
   lines (item + weight from the label; weighed lines value at the item's normal costing
   method); quick-key tiles; cash ("walk-in") customer and named-customer sales;
   returns/exchanges referencing the original invoice (BR-004 window,
   `pos.return_requires_original_invoice` template policy; stock re-entry at original
   cost); line/document discounts within role ceilings (BR-002 — cashier 0% default);
   tax preview and receipt tax display resolved per the tenant's jurisdiction pack
   ([ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md)) with
   **unregistered-mode receipts**: `NOT_SUBJECT` posture prints without VAT fields and
   simplified-invoice layout where the pack defines it.
4. **Posting path**: a POS sale IS a sales-module invoice (POS channel, `kind=CASH`,
   `cash_sales_autopost`/`pos.cash_autopost=true` per BR-005) — settlement journal
   (DR cash/card-in-till · CR revenue · CR VAT payable per treatment) + COGS journal
   (DR COGS · CR inventory at issue cost, FEFO batch for expiry items per BR-017,
   serial/IMEI binding for tracked items per BR-018), both through the centralized
   posting engine in one transaction (INV-013/018). Auto-post records
   `approved_by = policy:pos.cash_autopost` distinct from `posted_by`
   ([DOCUMENT_LIFECYCLE.md §2](../../accounting/DOCUMENT_LIFECYCLE.md) rule 1).
5. **Table service & kitchen tickets** (`pos.table_service`, `pos.kitchen_display` —
   intake keys registered into FEATURE_CATALOG at this phase per
   [CAPABILITY_MATRIX §3](../../industries/capabilities/CAPABILITY_MATRIX.md)): floor
   plan with tables/zones, order types (dine-in سفري/توصيل taxonomy per the restaurant
   template), item sends/merges on one check, guest-check transfer/split, pre-payment
   guest check print; **unpaid open tables hold no ledger effect**; kitchen ticket
   printing only (screen-based KDS remains a roadmap extension).
6. **Receipts** (`pos.receipts`): 80 mm / 58 mm print templates through the PHASE-013
   print system (`reporting.print_templates`, versioned, AR/EN, RTL-correct per
   [RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md) and
   [PRINTING_AND_EXPORT.md](../../reporting/PRINTING_AND_EXPORT.md)); offline receipts
   print the `OFF-…` number plus a "pending synchronization" notice — the official
   number is printed **nowhere** until the server assigns it
   ([OFFLINE_ARCHITECTURE.md §5](../../offline/OFFLINE_ARCHITECTURE.md));
   reprint of already-synced receipts from local cache (matrix row #32).
7. **The scoped offline sale queue** (`pos.offline_queue`) — per the boundary table
   ([SYNC_PROTOCOL.md §11](../../offline/SYNC_PROTOCOL.md)), same wire contracts, narrow
   scope:
   - **Local store** (SQLite via Drizzle, encrypted at rest —
     [LOCAL_DATABASE.md §1.1](../../offline/LOCAL_DATABASE.md) POS row): pulled
     snapshots `items` (+ `barcodes`, `uoms`), `price_list_items` (active lists),
     `partners` lite, `tax_codes` + rate snapshots, shift template, terminal config;
     local write set: POS invoices + lines (with stamped price/tax snapshots),
     cash receipts, shift events; outbox / inbox mirror / cursors / meta tables with
     their own versioned SQLite migrations.
   - **Pull**: per-entity-type cursors over a single POS feed group with bootstrap
     snapshot for items/prices (same envelope as SYNC_PROTOCOL §2); tombstones apply
     in the cursor-advancing local transaction.
   - **Push**: outbox commands `pos_sale` (invoice + lines + cash receipt aggregate),
     `cashier_shift` events, each with client-generated UUIDv7 ids + stable
     `idempotencyKey`; batches ≤ 50 commands with per-item `ACCEPTED / REJECTED /
     DEFERRED` results; server executes through the **sales module service + posting
     engine** — sync adds transport, never a second business-logic path; official
     number + journal ids returned on ACCEPTED replace local pending state
     (`PENDING_SYNC → POSTED`, offline number recorded alongside for reconciliation).
   - **Dedupe at this phase**: per-sale `idempotencyKey` + posting-operation key
     (INV-013). The full `inbox_commands` registry with 30-day retention and reinstall
     detection is **PHASE-020** — but every command path must already have a second
     dedupe layer so double execution is impossible.
   - **Conflict policy**: SERVER_DECISION for POS sales (stock/price/period/credit
     validated against server state at execution); typed rejections surfaced at the
     shift-end reconciliation screen for the POS codes (`PERIOD_LOCKED`,
     `PRICE_CHANGED`, `INSUFFICIENT_STOCK`, `CREDIT_LIMIT_EXCEEDED`,
     `VALIDATION_ERROR`) with the CONFLICT_RESOLUTION §3 user actions
     (edit-and-resend / accept-server-price / cancel-with-reason); on-account (credit)
     POS sales to known customers are LOCAL-VALID (cached credit check, hard server
     decision at sync — matrix row #31).
   - **Devices**: `pos-terminal` class only, manual enrollment, one terminal = one
     device, no cross-terminal draft visibility; revocation rejects pushes
     (`DEVICE_REVOKED`) before any command executes.
   - **Explicitly NOT generalized here** (PHASE-020 scope, recorded so the boundary
     holds): change feeds for other entity types and device classes; the general
     device registry with user self-enrollment; `inbox_commands` retention jobs;
     multi-device draft ownership rules; the full per-entity conflict-policy table;
     tombstone GC beyond the POS group. Any deviation from §11 is recorded as a
     decision and reconciled in PHASE-020, which must accept a PHASE-016 terminal on
     day one.
8. **End-of-day close**: Z report (shift-derived, read-only print — sales by order type,
   by tender, per shift, `Z-{branch}-{yyyyMMdd}` per the restaurant template) and
   reconciliation to journals via the PHASE-013 reports `pos.sales_by_terminal`,
   `pos.sales_by_hour`, `treasury.shift_cash_reconciliation`
   ([industries/reports/README.md](../../industries/reports/README.md) PHASE-016 rows);
   cash-drop transfer to safe/bank posts DR safe/bank · CR till (treasury transfer).
9. **Hardware abstraction, minimal by design**: keyboard-wedge/camera scanner and
   receipt printer only. The cash drawer is a **manual** drawer (no electronic pop/
   status integration — posture documented for PHASE-021); no ECR/fiscal-register
   integration, no scale-device integration (scale data arrives via barcodes).
10. **Template activation**: flip the phase-gated entries of
    `industry.retail` / `industry.grocery` / `industry.restaurant` from "coming with
    PHASE-016" to live (CONFIGURATION_ENGINE §9 `module.installed` invalidation;
    `industry.*` manifests unchanged — entitlements already carried the keys).

Out of scope (explicit):

- The generalized sync foundation (device registry for all classes, change feeds beyond
  the POS group, inbox retention, multi-device rules) — **PHASE-020**; this phase must
  not grow past the §11 boundary.
- Desktop Tauri shell packaging and auto-update (PHASE-021) — the POS terminal UI runs
  in the browser on POS hardware at this phase; the Tauri packaging arrives with 021.
- Android field app / van-sales offline (PHASE-022); personal-account mobile (PHASE-022).
- Screen-based kitchen display system (bump statuses, prep timers) — roadmap extension,
  no committed phase; kitchen **tickets** only here.
- E-invoicing submissions (ZATCA/ETA — PHASE-023); receipts follow pack layout rules
  but make no authority claims.
- Loyalty/gift cards, e-commerce storefront integrations, delivery-platform adapters
  (PHASE-023 at the earliest).

## 3. Prerequisites

- **PHASE-015 COMPLETE**: configuration engine + the three templates with phase-gated
  POS entries; `industry.*` manifests seeded; the intake keys `pos.table_service` /
  `pos.kitchen_display` registered into
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) via its §25 protocol at the
  start of this phase. Verified via completion report + green CI.
- Consumed as-is: PHASE-008 (cashier shifts, cash accounts, BR-021), PHASE-009 (tax
  engine + packs, `NOT_SUBJECT` unregistered posture), PHASE-012 (sales invoice chain,
  credit notes, receipts, BR-001…BR-005), PHASE-010 (stock ledger, batches/serials,
  FEFO), PHASE-013 (print templates, report contract), PHASE-006 (barcodes, price
  lists, UoM).
- Required architecture decisions:
  [ADR-0012](../../architecture/ADR/ADR-0012-offline-sync.md) (SQLite + outbox/inbox;
  server-authoritative posting; state honesty),
  [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md) (posting
  only through the engine),
  [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (UUIDv7 client ids;
  official numbering server-side),
  [ADR-0010](../../architecture/ADR/ADR-0010-tax-jurisdiction-packs.md) (receipt tax
  layout per pack), [ADR-0011](../../architecture/ADR/ADR-0011-reporting-printing.md)
  (versioned 80/58 mm print templates).
- Relevant documentation:
  [SYNC_PROTOCOL.md](../../offline/SYNC_PROTOCOL.md) (§2, §3 wire contracts; **§11
  boundary table — binding**), [LOCAL_DATABASE.md](../../offline/LOCAL_DATABASE.md)
  (§1.1 POS subset), [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (rows #1–#5, #8, #23, #31, #32, #33, #35), [CONFLICT_RESOLUTION.md](../../offline/CONFLICT_RESOLUTION.md)
  (§2 SERVER_DECISION, §3 rejection UX), [IDEMPOTENCY_AND_RETRIES.md](../../offline/IDEMPOTENCY_AND_RETRIES.md),
  [SYNC_TESTS.md](../../testing/SYNC_TESTS.md) (§7 PHASE-016 slice),
  [industries/workflows/industry-workflows.md](../../industries/workflows/industry-workflows.md)
  (workflow (a) — table order → Z close), [USER_JOURNEYS.md](../../product/USER_JOURNEYS.md)
  (Journey B — POS day incl. offline), [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md) §10,
  [BUSINESS_RULES.md](../../product/BUSINESS_RULES.md) (BR-001…BR-005, BR-017, BR-018,
  BR-021, BR-029, BR-030), [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md)
  (§3.2 `sales.pos_session.*`, cashier role, §3.8 `sync.devices.*`).

## 4. Design Impact

- **Database changes:** `pos_terminals` (branch, device link, till cash account, receipt
  size, status); `sales_invoices`/`sales_invoice_lines` POS channel fields
  (`offline_receipt_no` already catalogued, `pos_terminal_id`, order type, table ref);
  `cashier_shifts` gains terminal linkage (schema added in this phase's migration;
  runtime writes remain treasury-owned through its published service — no cross-module
  writes per [MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)); narrow sync slice —
  `change_log` (+ POS feed-group writer), `sync_cursors`, and device rows for
  `pos-terminal` (the ENTITY_CATALOG currently marks these PHASE-020 — this phase
  introduces the **narrow** slice and updates the catalog rows to "016 (POS subset) /
  020 (generalized)"); no `inbox_commands` table yet (dedupe via idempotency +
  posting-operation keys). Local SQLite schema per LOCAL_DATABASE §1.1 with its own
  versioned migrations in `packages/sync-core/migrations`.
- **API changes:** terminal CRUD + activation; shift open/close endpoints; POS sale
  submit (online path); sync subset — `POST /api/v1/devices` (pos-terminal class),
  `GET /api/v1/sync/pull?entity=<pos-group>&cursor=…`, `POST /api/v1/sync/push`
  (per-item results, `Idempotency-Key` batch header), `GET /api/v1/sync/status`;
  print-receipt invocation via the PHASE-013 print service. Contracts in
  `packages/contracts` (zod per intent: `pos_sale`, `cashier_shift`, partner-create
  draft per matrix row #23).
- **UI changes:** POS archetype instantiation — counter sale screen, floor plan
  (tables/zones) for restaurant, shift panel with float/count entry, tender dialog with
  split payments, offline banner + queued-sale count (honest sync state), shift-end
  reconciliation screen listing per-item rejections with typed actions, Z report view;
  RTL-first with LTR-isolated numerals/keypads; admin terminal registration screen.
- **Security & authorization:** cashier role is terminal-scoped (one branch, one
  terminal during a shift — AUTHORIZATION_MATRIX §5); permission set reconciled between
  AUTHORIZATION_MATRIX (`sales.pos_session.open/close/post`, `sync.devices.revoke`) and
  FEATURE_CATALOG (`pos.terminals.manage`, `pos.sales.sell`, `pos.shifts.manage`,
  `pos.receipts.print`) into the seeded permissions table; device credentials scoped to
  the `pos` capability subset; pushes rejected pre-execution on revocation; BR-039
  server-side enforcement on every POS action.
- **Accounting implications:** no new posting rules — POS reuses the PHASE-012 invoice
  chain; invariants exercised: INV-001/002 (balance), INV-013 (posting-operation
  idempotency — the offline replay guarantee), INV-018 (stock/journal atomicity),
  INV-019 (till cash = movements), INV-021 (official numbering server-side; `OFF-`
  numbers reconcile 1:1 per BR-029/A-010 posture), INV-011 (period check at sync-time
  posting). Offline document dates are business facts; posting dates follow tenant
  policy at sync (CONFLICT_RESOLUTION §5).
- **Localization implications:** receipts are Arabic-first RTL with EN variants;
  numeral rendering per tenant locale (Arabic-Indic vs Western digits asserted in
  visual tests, RISK-015); offline banner and rejection copy bilingual; scale-barcode
  parsing locale-independent (EAN prefix conventions configured per item).
- **Offline implications:** this phase ADDS the implemented POS cells of matrix rows
  #1–#5 (sales/returns/shift events + items/prices/partners read-cache), #8, #23, #31,
  #32, #33, #35 to the implemented set; the matrix is
  cross-checked row-by-row at phase exit (its §5 rule 3) and quoted in the completion
  report. `pos.offline_queue` is OFFLINE-COMPLETE for sales/returns/shift
  events/collections; back-office remains online-only.
- **Module dependencies:** `pos` (new — terminal registry, terminal UX, receipt
  invocation, offline queue) over `sales` (invoice documents), `treasury` (shifts,
  cash), `inventory` (issue/FEFO/serials via the sales posting path), `tax` (snapshot +
  receipt layout), `reporting` (print + reports), `sync` (narrow server slice;
  generalized module arrives 020), `identity` (device rows), `audit` (events:
  `shift.opened`, `pos_sale.posted`, `pos_sale.synced`, `credit_note.posted`,
  `shift.closed`, `sync.push.rejected` — Journey B audit list).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | FEATURE_CATALOG intake for `pos.table_service`, `pos.kitchen_display` (+ plan/add-on wiring per §25 protocol) | `docs/product/FEATURE_CATALOG.md`, seeds | manifest resolution test green; no orphan keys |
| T2 | Terminal registry + admin UI + device enrollment (`pos-terminal` manual) | `apps/api/src/modules/pos/**`, `apps/web/src/features/pos-admin/**` | contract + permission tests; activation lifecycle test |
| T3 | POS shift UX over treasury shifts (float, denominations, blind count, variance, supervisor PIN) | `apps/web/src/features/pos-shift/**`, `apps/api/src/modules/pos/application/shifts/**` | BR-021 boundary tests (tolerance 0 default; beyond-tolerance cannot close silently) |
| T4 | Counter sale flow: item grid, scan input, scale-barcode parse, cart, quick keys, discounts (BR-002), tax preview per pack, unregistered-mode layout | `apps/web/src/features/pos-counter/**` | scan-to-line < 200 ms perf test (Journey B B2); scale-line valuation test; ceiling tests |
| T5 | Online sale posting path through sales module (BR-005 auto-post audit record; split tenders; returns/exchange flow) | `apps/api/src/modules/sales/application/pos-channel/**` | posting golden tests: settlement + COGS journals, credit-note mirror, `approved_by=policy` recorded |
| T6 | Table service + order types + guest check + kitchen tickets (no ledger until payment) | `apps/web/src/features/pos-floor/**`, `apps/api/src/modules/pos/application/floor/**` | state tests: unpaid tables post nothing (workflow (a) steps 2–5); check transfer/split |
| T7 | Local store: SQLite schema + migrations (§1.1 POS subset), snapshot bootstrap, cursors, crash recovery | `packages/sync-core/**` | SQLite mirror suite; cursor-advance-only-after-commit test; recovery (WAL roll-forward, IN_FLIGHT→QUEUED) |
| T8 | Server sync slice: POS feed-group `change_log` writer, pull endpoint, push endpoint with per-item results, sale/shift command handlers via module services | `apps/api/src/modules/sync/**` (narrow), `apps/api/src/modules/sales/application/sync-inbox/**` | contract tests on envelope/per-item shape; handlers call real posting engine (no mocks) |
| T9 | Outbox/offline queue client: `OFF-` numbering (terminal-scoped sequence), honest `PENDING_SYNC` states, offline receipt print, reconnect push + result application | `packages/sync-core/src/outbox/**`, `apps/web/src/features/pos-offline/**` | state-honesty tests (no local state renders as posted); OFF-⇄official reconciliation 1:1 |
| T10 | Rejection UX: typed-reason → action mapping (CONFLICT_RESOLUTION §3), shift-end reconciliation screen | `apps/web/src/features/pos-reconciliation/**` | per-code action tests; on-account credit-sale rejection flow (row #31) |
| T11 | Receipt templates 80/58 mm (AR/EN, RTL rules, OFF- variant, reprint) via print service | `apps/api/src/modules/reporting/print-templates/**` | receipt snapshot tests AR + EN both sizes; OFF- notice assertion |
| T12 | Z report + POS reports registration (`pos.sales_by_terminal`, `pos.sales_by_hour`, `treasury.shift_cash_reconciliation`, restaurant table/order-type reports) | `apps/api/src/modules/{pos,reporting}/**` | report fixtures reconcile to journal lines (GL tie-out) |
| T13 | Chaos slice harness: seeded-RNG sim, fault-injection proxy, SQLite device emulation (SYNC_TESTS §1) in slice mode | `packages/sync-core/test-harness/**`, `apps/api/test/sync/**` | **C-01, C-03, C-04, C-07, C-09, C-16 green** (blocking for POS release) |
| T14 | Template activation flip + docs updates (matrix row quote, catalog sync-slice rows, FEATURE_CATALOG Phase columns) | `docs/**`, config seeds | docs validation green; capabilities-matrix exit cross-check |

## 6. Verification

**Automated tests (required):**

- **Chaos suite — PHASE-016 slice** ([SYNC_TESTS.md §7](../../testing/SYNC_TESTS.md),
  blocking): **C-01 duplicate push** (every command processed once, INV-013; replays
  return the original result), **C-03 partial batch failure** (per-item results, zero
  residue for the failed command), **C-04 crash between journal write and ack**
  (idempotent resume, no second journal), **C-07 clock skew** (server-authoritative
  dates; skew creates no future-dated postings), **C-09 offline queue drain with
  server rejects** (20 queued sales; 18 post with official numbers; 2 return typed
  rejections with user reconciliation flows; receipts were `PENDING_SYNC` throughout),
  **C-16 storage-full during capture** (loud failure, queue drains after recovery).
  The reconnect-storm case (flap → debounced full cycle → drain) is covered by C-09 +
  the periodic/trigger wiring of SYNC_PROTOCOL §8.
- **Posting golden tests** (assert persisted journal lines, not responses): POS cash
  sale (settlement + COGS, FEFO batch, serial binding), split tender, return/credit
  note mirror with stock re-entry at original cost, shift variance journal (BR-021),
  cash-drop transfer; failure cases mandatory: `PERIOD_LOCKED`, `INSUFFICIENT_STOCK`,
  `PRICE_CHANGED`, `CREDIT_LIMIT_EXCEEDED`, `ALREADY_POSTED` — each proving zero ledger
  residue.
- **Receipt snapshot tests (AR)**: 80 mm + 58 mm AR and EN renders; offline variant
  shows `OFF-` number + pending-sync notice and no official number; numeral/direction
  assertions (RISK-015); reprint-from-cache asserts no re-numbering (INV-021).
- **State-honesty suite**: `PENDING_SYNC` never renders as posted anywhere
  (matrix + OFFLINE_ARCHITECTURE §5); offline banner counts match outbox; as-of labels
  on cached prices/partners.
- **Numbering tests**: official POS series per branch (`POS-{branch}-{yy}{MM}-{seq:5}`
  etc.) assigned server-side only; `OFF-` terminal sequences reconcile 1:1 to posted
  invoices; uniqueness under parallel terminals (INV-021).
- **Permission matrix tests** for every new route (cashier terminal-scoped; revocation
  kills push/pull); device push from a revoked terminal ⇒ `DEVICE_REVOKED`, zero
  effects.
- **Capabilities-matrix exit cross-check**: implemented POS cells match the matrix
  row-by-row; completion report quotes the table.

**Manual verification:**

1. Register a terminal, open a shift with float, sell by scan + scale item + quick key,
   split cash/card payment, print 80 mm receipt — in AR.
2. Kill the network mid-morning: banner appears, sales complete locally with `OFF-`
   receipts; restore: queue drains, official numbers appear, one rejected sale (price
   changed) shows the reconciliation screen with actions.
3. Restaurant flow: open table → send kitchen ticket → guest check → payment → table
   closes; Z close at day end reconciles to `treasury.shift_cash_reconciliation`.
4. Unregistered tenant (no-VAT pack): receipt prints without VAT fields; tax summary
   records `NOT_SUBJECT`.

**Acceptance criteria (objective):** *(mirrored into `PHASE_ACCEPTANCE_CRITERIA.md`
row 016 when that file exists.)*

1. The six chaos-slice scenarios (C-01/03/04/07/09/16) pass with the ledger oracle
   asserting exactly-once effects and honest states — blocking for release.
2. Offline POS sale: local completion (`OFF-` receipt, `PENDING_SYNC`), server posting
   at sync with the official number recorded alongside; 1:1 reconciliation provable.
3. No locally created state is ever presented as posted/approved (state-honesty suite).
4. Duplicate delivery of any POS command produces zero additional ledger effects
   (INV-013), with the original result replayed.
5. Shift close follows BR-021 exactly: within tolerance auto-post with reason; beyond
   tolerance requires supervisor PIN; variance always posts, never nets.
6. Receipts print correctly in AR/EN at 80/58 mm including the offline variant; visual
   baselines updated for the POS archetype (both directions).
7. Scan-to-line ≤ 200 ms p95 on the perf fixture (Journey B target); sale submit p95
   ≤ 700 ms online.
8. All POS routes enforce permissions server-side; a revoked device's pushes are
   rejected before execution with zero effects.
9. Phase-gated template entries for retail/grocery/restaurant now resolve live (no
   "coming with PHASE-016" labels remain for shipped keys); back-office behavior
   unchanged for tenants without the POS entitlement (degrades cleanly).
10. ENTITY_CATALOG sync-slice rows, capabilities matrix, FEATURE_CATALOG Phase columns,
    and print-template registry updated; docs validation green.

**Performance & security considerations:** POS pull page ≤ 2 MB / ≤ 1000 items; push
batch ≤ 50 commands / ≤ 1 MB (protocol budgets); terminal periodic sync every 1 min
when outbox non-empty; local DB encrypted (SQLCipher profile in nightly matrix);
device tokens short-lived + rotating refresh; no tenant data in URLs/logs; rate limits
on sale submit and device enrollment.

**Migration & rollback:** additive migrations (pos_terminals, invoice channel columns,
narrow change_log/cursors, device rows). Rollback: disable the `pos` module flag per
tenant (entitlements-driven — menus hide, documents stay readable); revert schema only
in dev; posted POS invoices are ordinary sales invoices and remain valid — the offline
queue drains or is exported before any terminal rollback; local SQLite stores are
device-local (no server rollback interacts with them beyond cursor reset, which is safe
by §2 idempotence).

## 7. Risks and Constraints

- **RISK-011** (sync double-posting / lost sales): the core risk of this phase —
  mitigated by INV-013 posting-operation keys + per-command idempotency + the blocking
  chaos slice; any oracle mismatch is Sev-1 (SYNC_TESTS §9).
- **RISK-004** (offline expectations exceed protocol): mitigated by honest states,
  the matrix's explicit limits (no multi-device drafts, one terminal one device), and
  the §11 boundary — scope growth toward PHASE-020 is a review blocker here.
- **RISK-014** (performance under volume): scan-to-line and sale-submit budgets tested
  on the retail fixture; feed writer chunking per SYNC_PROTOCOL §2.5.
- **RISK-015** (RTL/numeral edge cases on receipts): snapshot tests assert digits and
  direction, not eyeballs.
- **RISK-017** (Tauri/WebView2 on old shop PCs): does not bite yet — browser-based
  terminals at this phase; posture documented for PHASE-021 packaging.
- Cash-drawer discipline risk (manual drawer + offline refunds): refunds against
  unsynced same-shift receipts queue in order (matrix row #2 note) and oversell
  resolution is always an explicit audited action (CONFLICT_RESOLUTION §6.1).
- Constraints: same wire contracts as the generalized protocol (§11 rule 1); no
  business rules inside the sync transport; posting only through the engine.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-016-COMPLETION.md` with: chaos-slice run
  transcripts (seeded, replayable) + ledger-oracle outputs, posting-golden fixture
  results, receipt snapshots AR/EN, OFF-⇄official reconciliation listing, permission
  matrix output, capabilities-matrix row-by-row quote, perf numbers, docs validation.
- **Documentation updates required:** IMPLEMENTATION_STATUS (PHASE-016 → COMPLETE),
  CURRENT_STATE, CHANGELOG, ENTITY_CATALOG/TABLES/ERD (pos_terminals, sync-slice rows),
  OFFLINE_CAPABILITIES_MATRIX (implemented cells), FEATURE_CATALOG (intake keys now
  shipped; Phase columns), INDUSTRY_CATALOG (POS entries live), print-template registry,
  permission seeds reconciliation note.
- **Exit criteria:** all acceptance criteria green with evidence; chaos slice blocking
  gate passed; three templates' POS flows demonstrably live; no §11 boundary deviation
  (or each deviation recorded as a decision for PHASE-020 reconciliation).
- **Definition of Done:** pos module + local store + sync slice + receipts + reports +
  tests merged; CI green (chaos slice included); templates activated; docs
  synchronized; zero TODOs in delivered scope.
- **Handoff instructions:** the POS offline queue is the first concrete consumer the
  generalized protocol must accept unchanged — PHASE-020 starts from the §11 table and
  the recorded deviations. The next agent reads the completion report, then the
  automotive/distribution template specs whose POS-flavored entries are now live.
  **Next eligible phase: PHASE-017 — Industry Templates: Automotive & Distribution**
  (PHASE-020 — Offline Sync Foundation — becomes parallel-eligible per the dependency
  graph; identify only, do not implement).
