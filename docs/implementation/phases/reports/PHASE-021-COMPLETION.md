# Completion Report — PHASE-021

> **Status:** COMPLETE · **Updated:** 2026-11-04

## Phase ID / Date

PHASE-021 — Desktop Application (Tauri v2 shell) · 2026-11-04

## Summary

The Windows-first desktop client ships as the **`@erp/desktop` TypeScript
runtime** (ADR-0013: "Rust stays confined to plugins") + the **Offline
Console** web surface + the **Tauri v2 Rust shell as source** (compiled +
signed only by the Windows CI workflow — the k6 precedent: real artifacts +
real tests for everything TypeScript, honest deferral notes for what needs
Windows hardware). The runtime: a **real SQLite file store**
(`better-sqlite3`, WAL, desktop migrations v4/v5 continuing the shared
`schema_migrations` numbering — read caches `sales_invoices`/`quotations`/
`delivery_notes`/`stock_counts` + the unified `draft_docs` write set +
`local_events` audit trail) with the **DR-P21-02 dual-profile SQLCipher
posture** (cipher profile fail-closed `SqlCipherUnavailableError` on stock
builds; standard profile enforces every other key-management invariant —
key lives ONLY in the keychain abstraction, secret-scan proven on the file
bytes + WAL), **DR-P21-03 byte-exact pruning** (dbstat-measured, the 1 GB
budget, machinery never pruned) and the proven **§6.4 corruption path**
(stage → delete → re-migrate → re-import → full re-pull). **Auth**: the
**DR-P21-01 enrollment bootstrap** — `POST /api/v1/devices/:id/enroll`
(PUBLIC, the recorded PHASE-020 promise): one-time sha256 secret verify
against `devices.device_key_hash` (migration `0032` drops the NOT NULL —
the ONLY server-side change of the phase) → `issueRefreshToken` chain-root
→ access-token memory-only session (15-min silent refresh at expiry−60 s,
rotation mutex, D-01 reuse hook) + the **D-04 unlock** against the cached
permission snapshot (7-day watermark degrade, re-verified against the REAL
file store). **Sync**: `SyncDesktopHost` — a thin host over the UNMODIFIED
`packages/sync-core` (`runCycle`/`pushAllV2`/recovery verbatim) with the
full **SYNC_PROTOCOL §8 trigger set** (start/unlock, connectivity 5 s
debounce burst-collapse, 2-min periodic-while-dirty, post-write fast push,
manual), the C-08 contract gate mirrored into UI state, the D-01
`purgeOnRevocation` (business tables + outbox + cursors in ONE transaction;
`local_events` kept with scrubbed payloads; **DR-P21-3a-01**: VACUUM +
checkpoint so the purge is proven at the FILE-BYTES level — zero tenant
markers post-purge). **Updater**: REAL minisign (Ed25519 via `node:crypto`,
the full signature-file format incl. global signatures), the Tauri v2
manifest schema with deterministic staged-rollout cohorts (exact BigInt
rationals), min-version force + downgrade rejection + the S-15 dual-trust
key window, the crash-free-session gates (≥99.5%/≥200 → 50%; ≥99.7%/≥500 →
100%; <98.5% ⇒ halt + minVersion bump — DR-P21-05), WebView2 banding
(min 109.0.1518.78 / recommended 120.0.2210.61 — DR-P21-04), redaction-first
telemetry, and the bilingual 80/58 mm ESC-POS renderer + reprint-from-cache
(the cached doc_no VERBATIM — never re-numbers, row 32). **The bridge**
(`window.__erpDesktop`): the ONLY web↔shell seam — 16 validated members
incl. the **DR-P21-09 optional `sync` driver** (syncNow/pushNow → the
Rust `sync_driver` seam, fail-closed `SYNC_DRIVER_NOT_REGISTERED`; parity
machine-checked both directions). **The Offline Console**
(**DR-P21-06**, `apps/web`): 100% bridge-driven (async repository over
`bridge.sql` — the sync ENGINE never runs in the webview; the console is
the UI twin, the engine is the shell-side runtime) — the **9 OFFLINE-DRAFT
flows** (invoice draft, quotation draft, delivery note, stock count lines,
partner contact edit, partner create, expense entry, cash transfer/drawer
drop, stock transfer draft — matrix rows 6/7/10/11/21/23/25/26/34), cached
reads with as-of labels, ONLINE-ONLY disabled-with-reason (never queued,
never simulated), the **FULL CONFLICT_RESOLUTION §3 action table** with
every user choice audit-logged to `local_events` (+ the rejecting
response's `traceId` — the details.traceId fix closed the gap), honest-state
badges, sync-now, unlock screen, and the webview reprint path (printHtml,
field-parity with the ESC-POS template). **Server write intents**
(**DR-P21-08** — the 020 completion report's promise): the 7 new intents
land as additive registry entries calling OWNING services only —
`partner:create` (SD), `quotation:create_draft` (OD-create — create-only,
`quotation:update_draft` deliberately ABSENT), `delivery_note:create_draft`,
`expense:create`, `cash_transfer:create_draft`, `stock_transfer:create_draft`,
`stock_count:submit_lines` (SD-aggregate w/ line-no resolution) — registry
6→13, payload schemas additive in `@erp/contracts` (version-frozen wire),
feed publication in-tx, zero new tables. **The exported shell subset**
(**DR-P21-07**): `build:desktop` — the manifest-driven prebuild stashes the
non-shell routes + middleware, `next build` with `output: "export"` →
`out-desktop` (offline + unlock, ar/en, ~3.7 MB), always-restore proven on
both failure paths; three new depcruise rules (`web-shell-no-server`,
`desktop-no-api`, `desktop-no-web`) + `check:desktop-shell` (tauri.conf
invariants, bridge↔Rust parity, manifest, export completeness, secret scan)
+ the Windows `desktop-release.yml` (build → cargo SQLCipher → EV signing →
minisign updater key → SBOM → artifacts → manifest publish, structurally
validated by a spec). **The E2E offline journey** (T14) runs the REAL
runtime behind a page-exposeFunction bridge double: unlock → cached reads →
draft → offline ONLINE-ONLY → reconnect → PRICE_CHANGED →
accept-server-price → ACCEPTED — **both locales green** — and it EARNED its
keep: it found **DR-P21-3b-1**, a real integration defect no unit test
crossed (the console enqueued the business payload while the engine sends
`JSON.parse(row.payload)` verbatim — unattributable wire commands froze
IN_FLIGHT forever); the fix (full v2 envelope in the column + the
outbox-view compat unwrap + the traceId follow-up) is landed and the
journey passes with zero spec tolerance.

## Decision records (DR-P21-xx)

| DR | Decision |
|---|---|
| **DR-P21-01** | The enrollment bootstrap endpoint (server, the ONLY server-side change): PUBLIC `POST /api/v1/devices/:id/enroll`, one-time sha256 verify + `device_key_hash` cleared in the same UoW (conditional UPDATE — concurrent double-spend safe), `device.enrolled` audit, typed failures mirroring refresh (no existence leak). Migration `0032` (schema_version 32) drops the 0003 `NOT NULL` so the one-time clear is legal. |
| **DR-P21-02** | Dual-profile store: `cipher` (SQLCipher build — Windows CI; stock build fails CLOSED `SqlCipherUnavailableError`) vs `standard` (sandbox + CI fallback — every other key-management invariant enforced; the key NEVER in the DB/logs; the D-02 binary inspection runs for real on cipher builds, standard carries the recorded caveat). |
| **DR-P21-03** | Byte-exact pruning: `tableBytes` via dbstat (`SELECT sum(pgsize)`) — measured present on better-sqlite3 12.11.1 (all budget asserts `estimated:false`); the documented row-approx fallback says so honestly; the 1 GB budget; machinery + dirty + unacked write-set rows never pruned. |
| **DR-P21-04** | WebView2 floor 109.0.1518.78 / recommended 120.0.2210.61 (banding: unsupported / degraded-notices / supported); config-bumpable via the updater channel. |
| **DR-P21-05** | Crash-gated staged rollout: 10→50 ≥99.5% (≥200 sessions), 50→100 ≥99.7% (≥500), <98.5% ⇒ halt + minVersion force-update (the `haltRemedy`). |
| **DR-P21-06** | The Offline Console scope: ONE shared capability-gated surface (`/{locale}/offline` + `/{locale}/unlock` + `components/offline/**`), browser = ONLINE-ONLY/disable-with-reason states, same components. |
| **DR-P21-07** | Desktop web build = exported shell subset: manifest-driven prebuild (stash/always-restore) + `ERP_TARGET=desktop` export; online use loads the deployed web app (ADR-0013 reuse holds). |
| **DR-P21-08** | The 7 desktop write intents land server-side THIS phase (registry 6→13) — create-draft-only for the new types (no offline update intents; `quotation:update_draft` absent by design); owning services only; honest VALIDATION_ERROR surfacing of typed service codes (no new wire reasons — DR-2d-2). |
| **DR-P21-09** | The bridge's OPTIONAL `sync` member (syncNow/pushNow): manual sync needed a bridge surface; the Rust `sync_driver` seam is source-only (Windows CI registers the runtime driver; absent ⇒ typed `SYNC_DRIVER_NOT_REGISTERED` — fail-closed, the UI gates on `capabilities.sync`). Parity machine-checked (16 members ↔ commands both directions). |
| **DR-P21-3a-01** | D-01 purge completion: VACUUM + checkpoint after the transactional purge so the "no tenant data remains" claim is proven at the file-bytes level (binary grep), not just row counts. |
| **DR-P21-3b-1** | The E2E-found enqueue-shape defect + fix: the outbox `payload` column carries the FULL v2 envelope (the engine sends it verbatim); `outbox-view` compat-unwraps for display; the `details.traceId` follow-up closes the audit gap (acceptance criterion 5 met end-to-end). |
| Sub-DRs | W1: key-id derivation (SHA-512/8, verifier never gates on ids); manifest dual-mode signature (manifest-mode + Tauri bundle-sig bound to a trusted key id); blocked-min-version terminal state; ESC-POS 48/32-col + wrap-not-shape (the driver shapes Arabic); the enrollment secret's 0003 NOT-NULL drop (1-b); quotations carry no `owner_device_id` column — OD-create rides the device-stamped audit + create-only registry shape (DR-2d-1); `stock_count:submit_lines` maps to `CountService.enterCounts` (DR-2d-3). W2: the constants leaf module (kills the barrel cycles); `frontendDist` path correction (`../../web/out-desktop` — D1 of 2-c); rusqlite `bundled-sqlcipher-vendored-openssl` behind the cargo feature + keyring-4 direct (D2/D3 — the community plugin gap); `out-desktop` as a transient regenerable artifact + the durable shared-config ignore (D6, landed in W4); the print palette in `packages/ui/print/reprint-css.ts` (the sanctioned PRINTING_AND_EXPORT §2 layer). W3: the schema-parity spec reads the desktop migration SOURCE as text (depcruise bans the cross-client module edge — the REAL DDL still parsed). |

## Environment reset (recorded, the PHASE-019 precedent)

The sandbox was reset mid-phase (2026-11-04T17:11Z) — the working tree with
the in-flight W2 work was lost. The repository was re-initialized from
`ERP_PLATFORM_PHASE020.zip` (commit `a04bc03`, full git history preserved)
and PHASE-021 was rebuilt from the binding master plan
(`agent-ctx/PHASE-021-MASTER-PLAN.md` — recovered verbatim) in four waves.
Same wording as PHASE-019's record: code state fully rebuilt + re-proven;
only wall-clock was lost.

## Test evidence (all green, exact counts)

| Suite | Count |
|---|---|
| **Full DB suite** (`pnpm test:db`, embedded PG16, migrations 0001–0032) | **120 files / 1829 tests** (020: 1773 → +56: enroll 6 + desktop-intents 23 + desktop profile 27) |
| Desktop profile (`apps/api/src/__db__/sync/desktop/`) | **27** — the FULL chaos matrix C-01…C-16 (+C-09b/C-11b) on the REAL file store; the kill-matrix (4 real-SIGKILL windows: pre-commit / post-commit-pre-ack / mid-pull / control — WAL recovery, IN_FLIGHT→QUEUED on disk, outbox exactly intact, converges, duplicate:true replays); D-01/02/04/06 on the file store |
| C-08 with REAL signed updates | 5-leg journey: per-item rejects → host gate (read-only, ZERO push attempts) → REAL minisign-signed manifest+bundle (in-test ed25519 keys) → `appVersion` 1.0.0→2.0.0 → server restored → gate cleared, clean resume, zero corruption |
| `@erp/desktop` unit suite | **16 files / 274 tests** (store/prune/corruption 27, auth 13, minisign 24, updater 75, webview2 22, telemetry 19, print 20, bridge 19, sync-host 40, CI/manifest structural 15+) |
| `@erp/web` console suites | **5 files / 73 tests** (bridge 14, store-client 20, sync-mirror 11, components 21, schema-parity 7) |
| **E2E offline journey** (`pnpm test:e2e-desktop`) | **2/2** — AR (3.6 s) + EN (3.2 s), the real runtime behind the bridge double, both failure-proofed locators + i18n from the real dictionary |
| Contracts / api unit | 50/50 · 274/274 |
| 020 regression | chaos-matrix.spec 19/19 byte-identical (no scenario extraction — the safe branch); policies/push 17/17; full suite re-run inside test:db |

## Gates (final sweep, all green)

`typecheck` 7/7 · `lint` 7/7 (uncached) · `lint:depcruise` **0 violations**
(1198 modules) · `check:permissions-drift` **243=243** ·
`check:capabilities-matrix` **PASS** (44 rows; 11 desktop cells flipped
implemented with real gates; android 022 deferrals kept) ·
`check:desktop-shell` **PASS** (5 sections) · `check:rls` **0 violations**
(188 catalog tables) · `docs:validate` **29/29** · `check:i18n-parity`
**ar=en=3244** (+200 keys, exact parity) · template re-pins: the 2 pinned
specs re-pinned (phase → PHASE-021; beyond-phase synthetics advanced
021→022; golden hashes UNTOUCHED — no manifest capability at 020/021,
census-verified).

## Budgets

Desktop chaos dir **13 s** (≤10 min) · whole sync suite **21 s / 130 tests**
(≤15 min) · E2E file **24.6 s incl. the export build** (≤5 min) · full
test:db **1 m 53 s** wall in this sandbox.

## Honest deferrals (recorded, not silent)

1. **The Rust shell compiles only on Windows CI** (`.github/workflows/
   desktop-release.yml` — structurally validated in-sandbox; the k6
   precedent). `check:desktop-shell` covers tauri.conf invariants + bridge
   parity + manifest + export + secrets as the standing source-level gate.
2. **The SQLCipher cipher profile** runs for real only on the Windows build
   (D-02 binary inspection included there); the sandbox profile is standard
   with every other invariant enforced + the fail-closed posture proven.
3. **The production sync-driver registration** (the `sync_driver` seam's
   Windows-CI integration hosting the TS runtime) — the seam + the
   fail-closed semantics + the E2E proof (the real host behind the bridge)
   are shipped; the packaging decision (sidecar hosting) rides the Windows
   CI milestone.
4. **The webview reprint is printHtml** (field-layout parity with the
   ESC-POS template, asserted); the byte-exact ESC-POS path is the
   shell-runtime's (Node profile).
5. macOS/Linux shells: deferred (decision record required — ADR-0013
   platform order); Windows only this phase.
6. Byte-exact budgets stay desktop-only (per-class budgets are their own
   decision records).

## Manual verification pointers (for the Windows pilot)

The §6 manual journeys map to shipped evidence: the offline day =
`pnpm test:e2e-desktop` (both locales); the PRICE_CHANGED seed = the E2E
step 5–6 + the chaos C-09b; the kill drill = the kill-matrix; the signed
update = C-08's real-minisign leg + `updater-manifest.ts --self-test`; the
clean-Windows install + below-minimum WebView2 = the Windows CI artifact +
`DESKTOP_SYSTEM_REQUIREMENTS.md` (the probe matrix is unit-proven).

## Handoff

The desktop column of the capabilities matrix is implemented (11 cells
flipped, checker-green); any new offline capability is a matrix change
(decision record + same-phase local migration, matrix §5 rules). The
`@erp/desktop` runtime + `packages/sync-core` are the Android team's
substrate — **reuse `sync-core` untouched and port design tokens, not sync
code** (the PHASE-021.md handoff instruction). **Next eligible phase:
PHASE-022 — Android Application** (depends only on PHASE-020's frozen
contracts; the bridge/sync-driver pattern is the reference).
