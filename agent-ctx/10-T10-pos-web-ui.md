# Task 10 — PHASE-016 T4+T10: POS Web UI (`apps/web`)

**Status: COMPLETE** — `tsc --noEmit` 0 errors · `pnpm check:i18n-parity` green (2030/2030 keys) · `pnpm --filter @erp/web lint` 0 errors. Only `apps/web/**` touched (apps/api, packages/, docs untouched).

## What was built

### Pages (async Server Components, `await params` + `isLocale` + `requireSessionToken` + `fetchApi`, 401→login, 403→forbidden `ErrorState`)
- `app/[locale]/pos/page.tsx` — counter screen. Loads `pos/terminals` (primary), `items/items?limit=100`, `partners/partners?kind=CUSTOMER&limit=100`, `treasury/cash-accounts`, `sales/sales-invoices?limit=20&kind=CASH` (returns quick-pick). Accepts `?checkId=` (floor → counter Pay hand-off).
- `app/[locale]/pos/floor/page.tsx` — floor plan. Loads `tenancy/branches` + `items/items?limit=100`, picks first active branch, prerenders `pos/floor?branchId=` + `pos/checks?branchId=&status=OPEN`.
- `app/[locale]/pos/reconciliation/page.tsx` — Z report. Loads branches + `pos/terminals` (id→code map), prerenders `pos/z-report?branchId=&date=today` + open checks for the default branch.
- `app/[locale]/pos/terminals/page.tsx` — terminal registry. Loads `pos/terminals` (primary), branches, cash accounts, `inventory/warehouses`.

### Client components (`components/`)
- `pos-counter.tsx` — terminal selector + open-shift badge (`GET pos/terminals/:id/shift`), open-shift dialog (float + optional denomination grid), blind-close dialog (denomination grid, exact BigInt totals, supervisor id/PIN/reason fields appear on `SHIFT_SUPERVISOR_REQUIRED`), auto-focused scan input (SKU lookup among loaded items, `lastScanAt` perf note in ms), item grid + search, cart with exact-string math (`mulQtyPriceExact`/`sumExact`, "final tax computed at posting" note), tender dialog (cash/card split, remaining, change due), `POST pos/sales` → receipt preview (`GET pos/invoices/:id/receipt` → iframe srcDoc + print via hidden iframe), customer picker (walk-in default), returns dialog (invoice id/no → `GET sales/sales-invoices/:id` lines → `POST pos/sales/returns`), offline banner + localStorage outbox (`pos-outbox` key): offline Pay stores `OFF-{terminalCode}-{seq}` + `PENDING_SYNC` (never shown as posted; Arabic "بانتظار المزامنة"), auto-drain on `online` event via `POST pos/sales` with `offlineReceiptNo`, per-entry state pending/synced/rejected + retry/keep/remove.
- `pos-floor.tsx` — zone sections, table cards (FREE green / OCCUPIED amber with check no), tableless (takeaway/delivery) open-checks list, open-check dialog (order type + guests), add-table dialog, check editor: line list with sent-to-kitchen badges, qty steppers, add-item select, `PUT pos/checks/:id/lines`, kitchen ticket send + ticket list, transfer dialog, split mode (checkboxes on SAVED lineNos — draft resets to saved on entry), guest-check printable HTML (escaped, pt units) preview + print, Pay (sessionStorage `pos-preloaded-check` + router push `/{locale}/pos?checkId=`), cancel-with-reason.
- `pos-reconciliation.tsx` — branch select + DatePicker + load; totals card (zNumber badge), by-order-type/by-tender/by-terminal DataTables, by-hour div bars (`percentExact` — BigInt ratio, no float money math), offline reconciliation pairs (OFF- ⇄ official), Z print (hidden iframe), open-checks reminder, and the rejected-outbox triage: Edit & resend (sessionStorage `pos-outbox-edit` → `/pos`), Accept server price (re-fetch `items/items`, update line prices, re-submit), Cancel with reason (kept locally).
- `pos-terminals.tsx` — registry DataTable (code/name/branch/till/receipt size/status/device/last seen), register dialog (code `^[A-Za-z0-9._-]{2,30}$` validation, till+branch required, warehouse optional, 80/58mm), activate/deactivate row actions, enroll-device dialog (client-generated 48-hex key shown once, readOnly), revoke device.

### Lib
- `lib/api-types.ts` — added `PosTerminalRow`, `PosSaleTender`, `PosSaleResult`, `PosDeviceEnrollResult`, `PosShiftOpenResult`, `PosCheckLine`, `PosCheckRow`, `PosCheckSplitResult`, `PosFloorTable`, `PosFloorZone`, `PosKitchenTicketRow`, `PosReceiptRender`, `PosZReport`, `PosOutboxEntry` (+`PosReceiptSize`/`PosOrderType` unions).
- `lib/exact-money.ts` — additive: `mulCountExact`, `mulQtyPriceExact` (6dp×6dp→4dp half-up), `stepQtyExact`, `percentExact` (display bars only).
- `lib/messages.ts` — additive: `localizedPosError`, `localizedPosOrderType`, `localizedPosCheckStatus`, `localizedPosOfflineReason`.
- `lib/pos-outbox.ts` — NEW: localStorage outbox CRUD, `nextOfflineReceiptNo` (`OFF-{code}-{seq}`), corruption-tolerant parse, sessionStorage hand-offs (`pos-preloaded-check`, `pos-outbox-edit`).
- `lib/print-frame.ts` — NEW: `printHtmlDocument(html)` (off-screen iframe + `print()`; pt/mm units, no hex/px — lint rule compliant).
- `i18n/dictionaries.ts` — +201 keys × ar/en (all `pos*`-prefixed: posNav/posCounter/posShift/posTender/posReceipt/posReturn/posFloor/posReconciliation/posTerminals/posOffline), 100% parity (1829→2030).
- `components/app-shell.tsx` — POS nav group appended to the merged navigation (withPosNavigation; contracts registry frozen so this is the documented app-side seam, same cast boundary as mergeNavigation) + 4 FALLBACK_CRUMBS entries.

## Endpoint assumptions (verified against apps/api source, read-only)
1. `GET pos/terminals` is `pos.terminals.manage`-gated — the counter/terminals pages treat it as the primary resource (403 → forbidden), per the task.
2. `GET pos/terminals/:id/shift` with NO open shift returns a 200 whose envelope drops `data` (JSON `undefined`) — handled as `status === 200 && !ok → null`.
3. Item/partner lists are capped at `limit=100` by the API (partners/items LIMIT max=100); the POS grid works over the first 100 items (scan+search included).
4. `GET sales/sales-invoices/:id` returns the invoice with `lines` (used by the returns dialog; `line.id` = `invoiceLineId`).
5. Offline re-submit is the simplified path per the task: `POST pos/sales` with `offlineReceiptNo` (the server-side (terminal, OFF-) dedupe lives in the sync-push path, not plain submit — a lost-response retry could double-post; flagged as T7–T9 follow-up).
6. Split uses SAVED lineNos (draft resets to saved lines on entering split mode) since the API keys on the persisted `lineNo`.
7. Z-report `byTerminal` carries terminal ids; the reconciliation page maps them through `GET pos/terminals` (degrades to id slice).

## Verification (all green)
- `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json` → 0 errors
- `pnpm check:i18n-parity` → ar=2030, en=2030, 100% parity
- `pnpm --filter @erp/web lint` → 0 errors (fixed: 2× `#ccc` in print HTML → CSS keyword `silver`; avoided banned `Math.round`; logical CSS props only)
