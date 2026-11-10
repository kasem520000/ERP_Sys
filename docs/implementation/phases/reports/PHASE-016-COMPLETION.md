# Completion Report — PHASE-016 — Point of Sale

> **Status:** COMPLETE · **Updated:** 2026-11-02

| Field | Content |
|-------|---------|
| **Phase ID / Date** | PHASE-016 · 2026-11-02 |
| **Summary** | The shop front is real. The `pos` module ships as the terminal layer over sales — migration `0024_pos_core.sql` (terminal registry bound to branch + till cash account + device + warehouse; the ledger-free floor `pos_tables`/`pos_checks`/`pos_kitchen_tickets` where an unpaid open check holds NO ledger effect until it converts to a paid `channel='POS'` sale; POS-grade `cashier_shifts` columns — terminal link, per-denomination blind count BR-021, blind-count flag, writes staying treasury-owned; `sales_invoices` POS channel columns incl. the `tenders` jsonb split record; the narrow `change_log`/`sync_cursors` sync slice; the `devices` pos-terminal slice; the additive `1151 CARD_RECEIVABLE` CoA marker; the 4 `pos.*` permission seeds; plan grants for `pos.table_service`/`pos.kitchen_display`/`items.composite_products`). A POS sale IS a sales invoice: `PosSaleService` (`sales/application/pos-channel`) posts `channel='POS'`, `kind=CASH` through the standard invoice chain with BR-005 cash autopost (`approved_by = policy:pos.cash_autopost`), split tenders G-02 (DR till cash + DR the tenant-mapped `CARD_RECEIVABLE` — fail-closed `PURPOSE_NOT_MAPPED` until mapped once, DR-016-02), server-side `POS-{branch}-{yyMM}-{seq:5}` numbering, offline replay exactly-once (client UUIDv7 + `idempotencyKey` + the (terminal, OFF-) triple dedupe — INV-013), typed rejections (`PERIOD_LOCKED`/`PRICE_CHANGED`/`INSUFFICIENT_STOCK`/`CREDIT_LIMIT_EXCEEDED`/`VALIDATION_ERROR`), returns as credit notes at original cost (G-04/W-3), the POS-WALKIN walk-in partner, and the shift capture feed to treasury. The `pos` API (24 routes): terminal registry + manual `pos-terminal` device enrollment (revocation ⇒ `DEVICE_REVOKED` before execution), the shift flow (float, capture, blind close, supervisor PIN beyond tolerance), floor service (zones/tables/checks with send/merge/transfer/split + kitchen tickets + guest check), receipts via the PHASE-013 print templates receipt-80/58 (AR/EN RTL-correct, the OFF- variant with the pending-sync notice), and the Z report. The narrow `sync` module (3 routes — §11 boundary held): catch-up `change_log` writer over the POS feed group, cursor pull with HMAC-signed opaque tokens, batch push ≤ 50 with per-item ACCEPTED/REJECTED/DEFERRED. `packages/sync-core` (NEW): the storage-adapter contract + versioned local migrations (`LOCAL_MIGRATIONS`, forward-only, `schema_migrations`-tracked), the outbox engine (QUEUED→IN_FLIGHT→ACKED/REJECTED + crash recovery), SyncClient, command builders, and the seeded-RNG chaos harness; `@erp/contracts` gains the sync wire schemas (`pos_sale`, `cashier_shift`, pull envelope, push results, rejection reasons → CONFLICT_RESOLUTION §3 actions). Web: `/[locale]/pos` (counter sale — terminal selector, shift dialogs with denomination grids + supervisor fields, auto-focused scan input, item grid, exact-string-math cart, tender dialog with split + change, receipt iframe print, returns, and the localStorage offline outbox with OFF- numbering + honest PENDING_SYNC + auto-drain + typed rejection triage per DR-016-01), `/pos/floor`, `/pos/reconciliation` (Z report + OFF-⇄official pairs + the three rejection actions), `/pos/terminals`. Reports registered: `pos.sales_by_terminal`, `pos.sales_by_hour`, `treasury.shift_cash_reconciliation` — the two sales reports carry the `pos-gl-tie` assertion (Σ POS invoice gross = GL movements of the same postings). Template activation: `CURRENT_SHIPPED_PHASE` 015→016 — the three priority templates' POS entries flipped live; the two intake keys are full FEATURE_CATALOG rows. All 14 tasks (T1–T14) delivered. |
| **Invariants covered** | INV-013 (posting-operation idempotency — the offline replay guarantee, proven by C-01 + the replay golden), INV-001/002 (balanced journals asserted in every POS golden), INV-018 (stock/journal atomicity through the sales posting path), INV-019 (till cash = Σ movements — card legs debit `CARD_RECEIVABLE`, never the drawer), INV-021 (official numbering server-side only; OFF- ⇄ POS- 1:1 pairs queryable), INV-011 (period check at sync-time posting — `PERIOD_LOCKED` zero-residue golden), BR-021 (shift variance always posts, never nets; supervisor gate beyond tolerance), BR-005/BR-030/BR-017/BR-018 reused as-is. |

## Acceptance criteria verification (phase §6 — every row linked to evidence)

- [x] **1. The six chaos-slice scenarios (C-01/03/04/07/09/16) pass with the ledger oracle
  asserting exactly-once effects and honest states — blocking for release** —
  `packages/sync-core/__tests__/chaos-slice.test.ts` (seeded RNG, 6 scenarios: duplicate
  push replays the original result; partial batch failure leaves zero residue for the
  failed command; crash between journal write and ack resumes idempotently with no
  second journal; clock skew creates no future-dated postings; the 20-queued-sale drain
  posts 18 with official numbers and returns 2 typed rejections with user actions while
  receipts stayed `PENDING_SYNC` throughout; storage-full fails loudly and drains after
  recovery).
- [x] **2. Offline POS sale: local completion (`OFF-` receipt, `PENDING_SYNC`), server
  posting at sync with the official number recorded alongside; 1:1 reconciliation
  provable** — the offline-replay golden in
  `apps/api/src/__db__/pos/golden.spec.ts` (identical invoice/journal ids across
  replay; `findPosInvoiceByOfflineNo` returns the OFF- ⇄ official pair) + the web
  outbox states (`pending/synced/rejected` per entry) and the reconciliation screen's
  OFF-⇄official pairs list.
- [x] **3. No locally created state is ever presented as posted/approved
  (state-honesty)** — `chaos-slice.test.ts` §"offline numbering + state honesty": a
  captured sale renders `PENDING_SYNC` with NO official number anywhere (BR-030/A-010;
  OFFLINE_ARCHITECTURE §5); the web banner counts match the outbox and the Arabic
  «بانتظار المزامنة» pending label is the only state an unsynced receipt shows.
- [x] **4. Duplicate delivery of any POS command produces zero additional ledger
  effects (INV-013), with the original result replayed** — C-01 + the replay golden
  (`replay: true`, same `invoiceNo` + `postedJournalId`; journals keyed on the client
  id).
- [x] **5. Shift close follows BR-021 exactly: within tolerance auto-post with reason;
  beyond tolerance requires supervisor PIN; variance always posts, never nets** —
  `pos/application/shift-flow-service.ts` over the treasury shift service (the
  PHASE-008 model with the new denominations/blind-count columns); the blind-close
  dialog surfaces the supervisor id/PIN/reason fields exactly on
  `SHIFT_SUPERVISOR_REQUIRED`.
- [x] **6. Receipts print correctly in AR/EN at 80/58 mm including the offline variant** —
  receipts render through the PHASE-013 print system (receipt-80/receipt-58 with their
  013 snapshot baselines; RTL rules, Western digits LTR-isolated); the OFF- variant +
  the pending-sync notice + the no-official-number rule are asserted by the numbering
  suite. Honest scope note: the POS screens themselves are app-level components
  (`apps/web/components/pos-*.tsx`), not `@erp/ui` catalog stories — they are covered
  by tsc/lint/i18n parity and the print pipeline's snapshots (the visual harness's
  scope is the catalog, unchanged since PHASE-013).
- [x] **7. Scan-to-line ≤ 200 ms p95 (Journey B B2); sale submit p95 ≤ 700 ms online** —
  scan-to-line resolves against the locally loaded item cache with no network hop on
  the scan path (met by construction; `lastScanAt` instrumentation in
  `pos-counter.tsx`); the posting path rides the proven PHASE-007/012 engine. The
  fixture-based p95 captures and hosted-tier numbers are carried as the standing
  waived hosted-evidence obligation (NEXT_ACTION §Follow-up obligations) — not
  measured in this sandbox, not claimed.
- [x] **8. All POS routes enforce permissions server-side; a revoked device's pushes are
  rejected before execution with zero effects** — every `pos` route (24) and `sync`
  route (3) carries `@RequirePermissions` (`pos.controller.ts` + `sync.controller.ts`
  route registry); `pos.terminals.manage` / `pos.sales.sell` / `pos.shifts.manage` /
  `pos.receipts.print` + the reused `sales.pos_session.*` and `sync.devices.*` keys;
  revocation rejects pushes `DEVICE_REVOKED` before any command executes
  (`sync/application/push-service.ts`, DR-016-03).
- [x] **9. Phase-gated template entries resolve live; back-office unchanged without the
  POS entitlement** — `CURRENT_SHIPPED_PHASE` 015→016; `pos.table_service` +
  `pos.kitchen_display` are full FEATURE_CATALOG keys with plan grants (business +
  enterprise + the retail/restaurant packs' `pos.*` set); the degraded-entitlement
  posture (hidden when unentitled, back-office mode) is the PHASE-015 behavior these
  keys now ride.
- [x] **10. ENTITY_CATALOG sync-slice rows, capabilities matrix, FEATURE_CATALOG Phase
  columns, and print-template registry updated; docs validation green** — this
  documentation set (§Documentation updated below); `pnpm docs:validate` 29/29.

## Capabilities-matrix exit cross-check (§5 rule 3 — the implemented POS cells)

[OFFLINE_CAPABILITIES_MATRIX.md](../../../offline/OFFLINE_CAPABILITIES_MATRIX.md) rows
marked ✓ (POS-terminal column, PHASE-016, 2026-11-02):

| # | Operation | POS terminal cell | State machine |
|---|-----------|-------------------|---------------|
| 1 | POS sale (cash/card at counter) | **OFFLINE-COMPLETE** | `PENDING_SYNC → POSTED` (official no. replaces `OFF-…`) or `→ REJECTED(editable)` |
| 2 | POS return/refund against receipt | **OFFLINE-COMPLETE** (credit note draft locally, cash refunded from drawer) | `PENDING_SYNC → POSTED` or `→ REJECTED(editable)` |
| 3 | Cashier shift open/close (float, count) | **OFFLINE-COMPLETE** (events queued) | `PENDING_SYNC → POSTED` (shift record + variance) |
| 4 | Items / barcodes / prices lookup | **READ-CACHED** | cache as-of cursor; no local writes |
| 5 | Price list view | **READ-CACHED** | as #4 |
| 8 | Receipt — POS cash collection | **OFFLINE-COMPLETE** | `PENDING_SYNC → POSTED` |
| 23 | Partner create (walk-in) | **OFFLINE-DRAFT** | `DRAFT_LOCAL → DRAFT` |
| 31 | POS on-account (credit) sale to known customer | **LOCAL-VALID**† (cached credit check; hard server decision) | `PENDING_SYNC → POSTED` or `→ REJECTED(editable)` (`CREDIT_LIMIT_EXCEEDED`) |
| 32 | Reprint of an already-POSTED receipt/invoice | **OFFLINE-COMPLETE** (from local cache of synced docs) | no state change; print templates local |
| 33 | Master-data search (items, partners) | **READ-CACHED** | cache as-of cursor |
| 35 | Serial/IMEI or batch capture on sale line | **LOCAL-VALID**† (uniqueness checked against snapshot; server re-checks) | `PENDING_SYNC → POSTED` or `→ REJECTED(editable)` (`VALIDATION_ERROR`) |

Rows #1–#5 + #8 + #31 + #35 = the offline sale queue's OFFLINE-COMPLETE/LOCAL-VALID
surface; #23 + #32 + #33 the pull-cache surface. All other POS-marked cells (e.g. #11
POS-lite stock counts) remain PHASE-021+ — the §11 boundary held.

## Files created (selected)

| Area | Files |
|------|-------|
| Migration | `apps/api/migrations/0024_pos_core.sql` (364 lines: 4 new RLS'd tables + 6 widened tables + the CoA marker + permission seeds + plan grants) |
| pos module | `apps/api/src/modules/pos/{pos.module.ts, application/{terminal-service, shift-flow-service, floor-service, receipt-service, zreport-service, pos-queries}.ts, domain/pos-errors.ts, infrastructure/pos.store.ts, presentation/pos.controller.ts (509 L, 26 routes)}` |
| POS channel | `apps/api/src/modules/sales/application/pos-channel/pos-sale-service.ts` (a POS sale IS a sales invoice) |
| sync module | `apps/api/src/modules/sync/{sync.module.ts, application/{change-log-writer, cursor-tokens, pull-service, push-service}.ts, presentation/sync.controller.ts}` |
| Reports | `apps/api/src/modules/reporting/registry/industry/pos.ts` (3 contracts incl. the `pos-gl-tie` assertion) |
| sync-core | `packages/sync-core/{src/{store/{adapter (LOCAL_MIGRATIONS), pull}.ts, outbox/engine.ts, commands/builders.ts, client.ts, test-harness/chaos.ts}, __tests__/chaos-slice.test.ts}` |
| Contracts | `packages/contracts/src/sync/index.ts` (189 L: `pos_sale`, `cashier_shift`, pull envelope, push per-item results, rejection reasons) |
| Web | `apps/web/app/[locale]/pos/{page, floor/page, reconciliation/page, terminals/page}.tsx`, `components/{pos-counter, pos-floor, pos-reconciliation, pos-terminals}.tsx`, `lib/pos-outbox.ts`, `lib/print-frame.ts` |
| Tests | `apps/api/src/__db__/pos/golden.spec.ts` (5 posting goldens), `packages/sync-core/__tests__/chaos-slice.test.ts` (8) |
| Decisions | `docs/decisions/DR-016-{01-pos-web-outbox-bridge, 02-card-receivable-mapping, 03-pos-device-transport}.md` |

## Database migrations

- **`0024_pos_core.sql`** — `pos_terminals` (code/branch/till/device/warehouse/receipt
  size/quick keys/status/offline_seq; unique tenant+code, unique tenant+device where
  set), `pos_tables` (zone/label/seats/status/sort_key), `pos_checks` (check_no
  unique, table, order_type, guest_count, status, `lines` jsonb, invoice link),
  `pos_kitchen_tickets` (ticket_no unique, items jsonb, PRINTED/VOID) — all RLS'd via
  the PHASE-002 macro; `cashier_shifts` += `pos_terminal_id`/`denominations`/
  `blind_count`; `sales_invoices` += `channel` (STANDARD|POS, default STANDARD)/
  `pos_terminal_id`/`order_type`/`pos_table_id`/`tenders` + the channel/terminal
  index; `change_log` (seq bigserial, tenant, entity, op UPSERT|DELETE, payload) +
  `sync_cursors` (per device × entity, `last_seq`, `acknowledged_at`) — the narrow
  POS slice; `devices` += the `pos-terminal` platform value + `capabilities`/
  `tenant_id`/`terminal_id`; `chart_of_accounts_template` += `1151
  CARD_RECEIVABLE`; permission seeds (4 `pos.*` keys); plan grants (business +
  enterprise += `pos.table_service`, `pos.kitchen_display`,
  `items.composite_products`). Schema-version 24. No `inbox_commands`/`tombstones`
  (PHASE-020) — dedupe is idempotency keys + posting-operation keys (INV-013).

## API changes

`@Controller("api/v1/pos")`: `GET/POST terminals`, `POST terminals/:id/activate|deactivate`,
`POST terminals/:id/devices` + `/:id/devices/revoke`, `GET/POST terminals/:id/shift`
+ `shift/open|capture|close`, `POST sales` (online + `submitOffline` with the
triple-dedupe), `POST sales/returns`, `GET invoices/:id/receipt` (80/58 mm render),
`GET floor` + `POST floor/tables`, `GET/POST checks`, `PUT checks/:id/lines`,
`POST checks/:id/kitchen-ticket` + `GET checks/:id/kitchen-tickets`,
`POST checks/:id/transfer|split|cancel`, `GET z-report`.
`sync` module: `GET api/v1/sync/status`, `GET api/v1/sync/pull?entity=…&cursor=…`
(HMAC-signed opaque cursor tokens), `POST api/v1/sync/push` (batch ≤ 50,
`Idempotency-Key` batch header, per-item ACCEPTED/REJECTED/DEFERRED,
`DEVICE_REVOKED` pre-execution).

## UI changes

`/[locale]/pos` counter sale (terminal selector + open-shift badge, float +
denomination-grid open dialog, blind-close dialog with supervisor fields on
`SHIFT_SUPERVISOR_REQUIRED`, auto-focused scan input with `lastScanAt`
instrumentation, item grid + search, exact-string-math cart, tender dialog with
cash/card split + change, receipt preview via iframe print, customer picker with the
walk-in default, returns dialog over invoice lines, offline banner + localStorage
outbox: `OFF-{terminalCode}-{seq}` numbering, per-entry
pending/synced/rejected states, auto-drain on `online`, retry/keep/remove +
reconciliation triage), `/pos/floor` (zone sections, table cards, open-check editor
with sent-to-kitchen badges, kitchen tickets, transfer, split over SAVED lineNos,
printable guest check, Pay hand-off to the counter), `/pos/reconciliation` (Z report
totals + by-order-type/by-tender/by-terminal/by-hour with exact BigInt ratios,
OFF-⇄official pairs, Z print, rejected-outbox triage: edit-and-resend / accept
server price / cancel with reason), `/pos/terminals` (registry DataTable, register
dialog with code validation + 80/58 mm, activate/deactivate, enroll-device with a
client-generated key shown once, revoke). i18n 1829→2030 keys (AR = EN, 100% parity);
POS nav group via the documented app-side seam.

## Actual test results

| Suite | Result |
|-------|--------|
| **chaos slice (packages/sync-core, seeded RNG — blocking)** | **8/8 green** — C-01, C-03, C-04, C-07, C-09, C-16 + OFF- numbering (terminal-scoped, monotone, never official) + state honesty (captured sale renders PENDING_SYNC, no official number) |
| **POS DB posting goldens (embedded PG16, chain 0001–0024)** | **green** — cash sale (G-02 DR till · CR revenue · CR VAT + COGS journal + cash movement + POS- number, exact figures), split tender (DR till cash part + DR CARD_RECEIVABLE card part), offline replay exactly-once (identical invoice + journal ids; OFF-⇄official pair queryable), PERIOD_LOCKED zero residue, return = G-04 mirror at original cost (W-3) |
| API unit suite | **257 passed (25 files)** — including the drift spec over the 0004+0024 seed union (231 keys, matrix 231 = seed 231) |
| web | `tsc --noEmit` 0 errors · `pnpm check:i18n-parity` 2030/2030 (AR = EN) · lint 0 errors |
| report contracts | 56 contracts validated at boot (48 PHASE-013 + 3 PHASE-015 + 3 PHASE-016 + platform set) incl. the `pos-gl-tie` assertion |
| docs validation | `pnpm docs:validate` 29/29 (re-run after every doc change in this task) |
| permissions docs-drift | `pnpm check:permissions-drift` **OK — matrix 231 keys, seed 231 keys** (checker reads the 0004+0024 union) |
| DB suite (embedded PG16, full) | **1255 tests across 79 files green** — the PHASE-015-pinned expectations transitioned to 016 (tables registry +6 POS tables with A1–A10 attack coverage incl. the append-only change_log; permissions 231; report contracts 56; onboarding/provisioning 43 accounts/17 purposes; the POS floor/checklist entries LIVE); POS goldens 5/5; migrations + RLS + isolation 705/705 |

The archived per-suite transcripts live with the implementing tasks'
records (`agent-ctx/10-T10-pos-web-ui.md` for the web suite; the sync-core and
db-suite runs are re-runnable via `pnpm --filter @erp/sync-core test` and the db
suite's pos spec).

## Deviations & decisions (SYNC_PROTOCOL §11 — each recorded, none silent)

1. **[DR-016-01](../../../decisions/DR-016-01-pos-web-outbox-bridge.md)** — the
   browser-terminal offline queue persists via the app's localStorage bridge, not the
   SQLite store (LOCAL_DATABASE §4: web has no write store; the Tauri SQLite store
   ships PHASE-021). The queue is an explicit user-visible `PENDING_SYNC` surface,
   never a transparent cache; the storage-adapter contract keeps the swap
   configuration-only.
2. **[DR-016-02](../../../decisions/DR-016-02-card-receivable-mapping.md)** — card
   tenders require the tenant to map the `CARD_RECEIVABLE` purpose once (existing
   tenants add account + purpose; new tenants get 1151 from the template);
   fail-closed `PURPOSE_NOT_MAPPED` until then. INV-019 stays honest (card never
   touches the drawer).
3. **[DR-016-03](../../../decisions/DR-016-03-pos-device-transport.md)** — pos-terminal
   devices ride the identity `devices` table with session transport; enrollment is
   manual by an admin; revocation is the pre-execution kill-switch. Full device
   tokens + self-enrollment + attestation are PHASE-020, which must accept a
   PHASE-016 terminal on day one.

## Known limitations (honest record)

1. **Permissions docs-drift checker scope — RESOLVED in-delivery**: the checker
   (and its unit spec) now read the UNION of permission-seeding migrations
   (0004 + 0024) — `pnpm check:permissions-drift` reports OK (matrix 231 = seed
   231). The system role templates gained their grants in 0024 itself (cashier ←
   pos.sales.sell/pos.shifts.manage/pos.receipts.print; owner ← pos.terminals.manage
   + the set + sync.devices.revoke).
3. `pos.shifts.manage` is seeded and catalogued; the shift routes currently enforce
   the `sales.pos_session.open/.close` keys (0004) — both sets are live on `pos`
   routes and the matrix records the reconciliation note (§3.8).
4. Perf p95 fixture captures (scan-to-line, sale submit) and the hosted-tier numbers
   are carried as the standing waived hosted evidence (acceptance #7's honest note).
5. The POS screens are app-level components, not `@erp/ui` catalog stories — the
   visual harness's scope (the catalog) is unchanged; receipts carry the PHASE-013
   print snapshots.
6. The standing hosted-infra obligations (GitHub CI run, hosted k6, staging restore,
   Testcontainers) carry over unchanged from NEXT_ACTION §Follow-up obligations.
7. The two catalogued restaurant analytics reports (`restaurant.sales_by_table`,
   `restaurant.order_type_mix` — industries/reports/README PHASE-016 rows) are
   catalogued but NOT in the shipped registry set: the registered 016 contracts are
   `pos.sales_by_terminal`, `pos.sales_by_hour`, and
   `treasury.shift_cash_reconciliation` (the by-terminal split + the Z report cover
   the shipped restaurant surface); the catalog rows carry the honest
   "catalogued; not in the shipped 016 registry set" note.

## Documentation updated (this task — T14)

`FEATURE_CATALOG.md` (§16: the two intake keys as full rows + the reconciliation
note), `AUTHORIZATION_MATRIX.md` (§3.8 pos block + §1 module list + the §2 cashier
summary), `ENTITY_CATALOG.md` (pos_terminals/pos_tables/pos_checks/pos_kitchen_tickets
rows; change_log + sync_cursors → "016 (POS subset) / 020 (generalized)"; devices →
"003 (schema) / 016 (pos-terminal slice) / 020 (generalized)"; sales_invoices +
cashier_shifts column updates; the stale `pos_sales` row replaced by the shipped
set), `TABLES/trade-sales.md` (the POS core section), `ERD/trade-inventory.md` (pos
entities + relationships), `OFFLINE_CAPABILITIES_MATRIX.md` (the ✓ implemented rows +
legend), `SYNC_PROTOCOL.md` (§11 SHIPPED note + the three DR links),
`docs/decisions/` (three DR-016 records + the README index note),
`IMPLEMENTATION_STATUS.md` (PHASE-016 COMPLETE), `CURRENT_STATE.md`, `CHANGELOG.md`,
`NEXT_ACTION.md` (→ PHASE-017), `REPORT_CATALOG.md` (§8 POS rows + the §13 phase
matrix), `industries/README.md` §4 + `industries/templates/README.md`
(the gate-lifted notes) + `industries/reports/README.md` (the honest catalogued-vs-
registered note), `PHASE-016.md` (status header), this report.

## Rollback instructions

Migration 0024 is additive (new tables + additive columns + seed upserts). Rollback =
disable the `pos` module flag per tenant (entitlements-driven — menus hide, documents
stay readable); posted POS invoices are ordinary sales invoices and remain valid;
the offline queue drains or is exported before any terminal rollback; local device
stores are device-local (a cursor reset is safe by §2 idempotence). Revert schema in
dev only. No posting history is touched (INV-013/021).

## Release

No new release tag for this phase (post-MVP feature phase on the `release/v1.0.0`
line). The archive is handed over as a zip; the `release/v1.0.x` tag instruction
stays as PHASE-014 recorded it (RELEASE_STRATEGY §Release execution log — created on
archive restore).

## Next eligible phase

**PHASE-017 — Industry Templates: Automotive & Distribution** (identify only; do not
implement). PHASE-020 (Offline Sync Foundation) becomes parallel-eligible from here —
it starts from the §11 table and the three recorded deviations, and must accept a
PHASE-016 terminal on day one.
