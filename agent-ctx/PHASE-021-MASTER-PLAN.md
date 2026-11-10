# PHASE-021 MASTER PLAN — Desktop Application (Tauri v2 shell) (BINDING)

> Executor context: repo `/home/z/phase017_work`, monorepo pnpm (NestJS API +
> Next.js web + packages). Phase doc: `docs/implementation/phases/PHASE-021.md`.
> The PHASE doc wins on SCOPE; this plan wins on MECHANICS. Deviations are
> recorded in the completion report as decision records (DR-P21-xx), exactly
> like DR-P20-01…10 before them.

## 0. Environment reality + golden constants (binding)

**Sandbox truth (drives every decision below):**
- NO Rust toolchain in the sandbox → the Tauri Rust shell ships as **source
  code** (`apps/desktop/src-tauri/**`), compiled + signed only by the Windows CI
  workflow (`.github/workflows/desktop-release.yml`, shipped as code). This is
  the k6 precedent: real artifacts + real tests for everything TypeScript,
  honest deferral notes for what needs Windows hardware. NOT a silent skip.
- Playwright chromium IS installed → the offline-journey E2E (T14) runs for
  real against the exported shell UI.
- `better-sqlite3` installs with prebuilt binaries → the desktop local store is
  a REAL SQLite file (WAL), not the in-memory adapter. SQLCipher proper is a
  custom build → dual-profile store (DR-P21-02 below).

**Golden constants (all specs use these; reuse 020 identities):**

| Constant | Value |
|---|---|
| `TENANT_DESKTOP` | `21212121-2121-2121-2121-212121212121` (verify unused before use) |
| `ACTOR_DESKTOP_OWNER` | `21212121-0000-4000-8000-000000002101` |
| `ACTOR_DESKTOP_USER` | `21212121-0000-4000-8000-000000002102` |
| `CONTRACT_VERSION` | `"2026-11-04.1"` (`SYNC_CONTRACT_VERSION` from `@erp/contracts`) |
| Device class | `"tauri-desktop"` (contracts `DeviceClass`) |
| Feed group | `FEED_GROUPS.desktop` = POS group + `sales_invoices` |
| `WEBVIEW2_MINIMUM` | `"109.0.1518.78"` — last Evergreen branch still supporting the oldest supported Windows builds (DR-P21-04; config-bumpable, rides the updater channel) |
| `WEBVIEW2_RECOMMENDED` | `"120.0.2210.61"` — below recommended but ≥ minimum ⇒ degraded-capability notices |
| Rollout stages | `10% → 50% → 100%` |
| Crash gates | promote ≥ 99.5% crash-free sessions (trailing 24 h, ≥ 200 sessions) for 10→50; ≥ 99.7% (≥ 500 sessions) for 50→100; **halt + force-update below 98.5%** (DR-P21-05) |
| Updater signature | minisign (Ed25519) — Tauri updater format; REAL keypairs generated in tests (never mock the verifier) |
| Local storage budget | desktop **1 GB byte-exact** (dbstat; DR-P21-03) |

## 1. Binding architecture decisions (the trues-up)

1. **The desktop runtime is TypeScript, not Rust** (ADR-0013 "Rust stays
   confined to plugins"): `apps/desktop` becomes workspace package
   `@erp/desktop` with ALL client logic in `src/**` (store, enrollment, sync
   host, updater, probes, telemetry, print) — fully unit-testable on Node.
   `src-tauri/**` is the thin Rust shell: plugin glue + window + updater
   bootstrap only, shipped as source, compiled only in Windows CI (honest
   report note; a `scripts/check-desktop-shell.ts` validates the shell config
   invariants + bridge contract parity instead of compiling).
2. **DR-P21-01 — enrollment bootstrap endpoint (server, small, promised).**
   PHASE-020 shipped register returning `{deviceId, attestationNonce,
   enrollmentSecret, contractVersion}` and `POST /devices/:id/refresh` which
   only rotates an EXISTING token — DR-P20-03 explicitly deferred "the
   first-refresh bootstrap for native enrollment wires `issueRefreshToken`" to
   021. The phase doc's "API changes: none" refers to the sync wire protocol
   (pull/push frozen) — the enrollment exchange is the recorded exception:
   `POST /api/v1/devices/:id/enroll` (PUBLIC, credential-in-body like refresh):
   body `{enrollmentSecret}` → verify sha256 against `devices.device_key_hash`
   (one-time: hash cleared on success) → `issueRefreshToken(tx, deviceId)` →
   `{refreshToken, accessToken, expiresAt, refreshTokenExpiresAt}` + audit
   `device.enrolled`. Wrong/expired secret → typed `DeviceRefreshInvalidError`
   (same class as refresh; no existence leak). Register-with-`deviceKeyPublic`
   flow unchanged (attest stays separate). Route-permissions row + PUBLIC route
   registration + AUTHORIZATION_MATRIX row (drift gate parity) + specs.
   **This is the ONLY server-side change in the phase.**
3. **DR-P21-02 — SQLCipher dual-profile store.** `createDesktopStore(opts)` in
   `@erp/desktop` opens better-sqlite3 and, when `opts.encryptionKey` is set,
   applies `PRAGMA key` + verifies via `PRAGMA cipher_version`. Profile
   `"cipher"` (SQLCipher build of better-sqlite3 — Windows CI compiles it via
   the documented custom build) gives true at-rest encryption; profile
   `"standard"` (sandbox + CI fallback) runs plain SQLite with every OTHER
   key-management invariant enforced: key lives ONLY in the keychain
   abstraction, never in the DB file/logs/prefs (secret-scan test), and the
   D-02 binary-inspection test **auto-skips with an explicit recorded caveat**
   when `cipher_version` is absent (the Windows CI profile runs it for real).
   The store API is identical across profiles — everything downstream is
   profile-blind.
4. **DR-P21-03 — byte-exact pruning (the DR-P20-10 promise).** The sqlite
   adapter implements the StorageAdapter optional pruning surface +
   `tableBytes(table)` via `SELECT sum(pgsize) FROM dbstat WHERE name = ?`
   (better-sqlite3 compiles with SQLITE_ENABLE_DBSTAT_VTAB — W1 verifies; if
   dbstat is absent the adapter falls back to `countRows × BYTES_PER_ROW_APPROX`
   and SAYS SO in `PruneResult`). Desktop maintenance runs its own byte-exact
   pass (`pruneDesktopStore`) against the 1 GB budget — `sync-core.pruneStore`
   stays untouched as the generic fallback.
5. **Sync-core is consumed UNMODIFIED** (review blocker otherwise). The
   desktop store implements `StorageAdapter` (transaction/run/all/get +
   optional pruning trio). Desktop-only migrations are versions **4+** applied
   by a desktop-local applier that reuses the same `schema_migrations` table
   pattern (sync-core's `applyMigrations(adapter)` runs first with versions
   1–3, then `applyDesktopMigrations` adds v4+; sync-core source untouched).
   If real-SQLite dialect testing exposes sync-core SQL bugs, fixes are
   recorded as bug-fix DRs (behavior-frozen), never protocol changes.
6. **DR-P21-06 — offline UI scope: the Offline Console.** The matrix's
   desktop write-rows ship as one shared, capability-gated surface:
   `apps/web/app/[locale]/offline/` (client components) + shared components in
   `apps/web/components/offline/**`, hosting: cached reads w/ as-of labels,
   the 9 OFFLINE-DRAFT flows (invoice draft, quotation draft, delivery note,
   stock count lines, partner contact edit, partner create, expense entry,
   cash transfer/drawer drop, stock transfer draft), the outbox/rejection
   queue with the FULL CONFLICT_RESOLUTION §3 action table, honest-state
   badges, sync-now, reprint-from-cache. In the browser (bridge absent) the
   console renders ONLINE-ONLY/disable-with-reason states — same components,
   capability-gated. Entry: nav item + dashboard quick action (cheap
   integration points; per-page deep integration is iterative polish, out of
   scope, noted in the report).
7. **DR-P21-07 — desktop web build = exported shell subset.** `pnpm --filter
   @erp/web build:desktop` runs a prebuild (`scripts/desktop-export-prebuild.mjs`)
   that excludes server-only routes per `apps/web/desktop.routes.json` (the
   BFF catch-all + session routes + middleware + any route the shell manifest
   doesn't include), then `next build` with `ERP_TARGET=desktop`
   (`output: "export"`, `images.unoptimized`, `distDir out-desktop`).
   The export contains the offline console + unlock screen + shell chrome
   (static, client-hydrated). Online use loads the deployed web app (same UI)
   — ADR-0013's reuse holds; the shell serves offline screens from disk.
   Guard (the T1 test hook): depcruise rule `web-shell-no-server` — nothing
   under `apps/web/app/[locale]/offline/**`, `apps/web/components/offline/**`,
   or `apps/web/lib/shell/**` may import `lib/bff.ts` / `lib/server-api.ts` /
   `next/headers` / server-only BFF helpers; violation fails `lint:depcruise`
   + a standalone guard script asserts the export exists & contains the
   offline route after `build:desktop`.
8. **Updater = real minisign, real manifests, real cohort math.**
   `@erp/desktop/src/updater/`: minisign signature verification (Ed25519 via
   node:crypto, minisign signature format parsing — base64 `untrusted comment`
   + `trusted comment` + sig), manifest schema (Tauri v2 updater platforms
   shape), deterministic staged-rollout cohort (`sha256(deviceId + channel +
   version) / 2^256 < stagePercent`), minimum-version enforcement
   (`minVersion` in manifest forces update; below-minimum app blocks with the
   update screen), downgrade rejection (offered version < current → refuse),
   dual-trust key window (S-15 rotation: manifest may carry TWO valid
   pubkeys). `deploy/updater/` = the manifest service (a static-JSON layout +
   `scripts/updater-manifest.ts` to sign/publish; a tiny in-process server for
   tests) + `manifest.json` fixtures for staging channels. Tests generate REAL
   ed25519 minisign keypairs and sign REAL bundles — unsigned/tampered/
   downgraded all REJECTED (D-06 green in-sandbox).
9. **WebView2 probe + telemetry + print are TS modules with plugin adapters.**
   `system/webview2.ts` (version probe input from the Rust side via bridge;
   comparison + minimum/recommended banding + install-guidance payload),
   `telemetry/crash.ts` (redaction: strip tokens/keys/paths; tenant tag;
   crash-free-session counter feeding the rollout gate), `print/escpos.ts`
   (80/58 mm bilingual receipt rendering to ESC-POS byte buffers + reprint-
   from-cache orchestration — reprint NEVER re-numbers, row 32).
10. **Bridge contract (the ONLY web↔shell seam).** `window.__erpDesktop` (or
    injected global) with typed surface: `{ version, capabilities: {...},
    keychain: {get,set,delete}, sql: {execute,query}, http: {request},
    updater: {checkNow, install}, system: {webview2Version, osInfo},
    print: {printRaw, printHtml}, connectivity: {onChange} }`. `@erp/desktop`
    exports the `DesktopBridge` interface + `detectBridge()`; apps/web
    `lib/shell/bridge.ts` re-exports a browser-safe client (null bridge →
    browser mode, ONLINE-ONLY affordances). The Rust side implements the same
    contract (validated by `scripts/check-desktop-shell.ts` comparing the TS
    interface to the Rust command names in `src-tauri`).

## 2. Package layout (new code)

```
apps/desktop/                       # @erp/desktop (workspace package)
  package.json  tsconfig.json  vitest.config.ts
  src/
    index.ts                        # public exports
    store/sqlite-adapter.ts         # StorageAdapter over better-sqlite3 (WAL)
    store/desktop-migrations.ts     # v4+: sales_invoices cache + draft write-sets
    store/prune.ts                  # byte-exact 1 GB budget pass (dbstat)
    store/corruption.ts             # integrity_check + §6.4 stage→reset→re-import→pull
    auth/enroll.ts                  # register → (attest) → enroll → keychain → unlock
    auth/keychain.ts                # Keychain interface + MemoryKeychain (tests) + bridge impl
    auth/session.ts                 # access-token memory manager (15-min silent refresh)
    auth/unlock.ts                  # cached permission snapshot unlock + 7-day watermark
    sync/host.ts                    # SyncDesktopHost: triggers + SyncClient hosting
    sync/triggers.ts                # start/unlock, connectivity 5s debounce, 2-min dirty,
                                    #   post-write fast push, manual
    sync/transport.ts               # SyncTransport over bridge http (device token auth)
    sync/revocation.ts              # D-01: purge local tenant data on revocation contact
    updater/minisign.ts             # real minisign verify (Ed25519)
    updater/manifest.ts             # manifest schema + cohort + min-version + downgrade
    updater/client.ts               # check/download/verify/apply state machine
    system/webview2.ts              # probe + banding + guidance
    telemetry/crash.ts              # redaction + crash-free sessions
    print/escpos.ts                 # 80/58 mm bilingual templates → ESC-POS bytes
    print/reprint.ts                # reprint-from-cache (row 32)
    bridge/contract.ts              # DesktopBridge interface + detectBridge()
  __tests__/                        # vitest: store/auth/sync/updater/system/print suites
  src-tauri/                        # Rust shell (source only; Windows CI compiles)
    tauri.conf.json  Cargo.toml  build.rs  src/main.rs  src/lib.rs
    plugins/{sql,keychain,print}/   # Rust plugin glue
    capabilities/default.json
  README.md                         # replaces the placeholder
apps/web/
  desktop.routes.json               # shell manifest (prebuild exclusion list)
  scripts/desktop-export-prebuild.mjs (or scripts/ at repo root — W2-c decides, keep consistent)
  app/[locale]/offline/page.tsx     # Offline Console (client)
  app/[locale]/unlock/page.tsx      # offline login/unlock screen (client)
  components/offline/**             # shared capability-gated components
  lib/shell/bridge.ts               # browser-safe bridge client + capability gates
deploy/updater/                     # manifest service + fixtures + runbook
.github/workflows/desktop-release.yml  # Windows build + signing + SBOM + CalVer
tests/e2e/desktop-offline.spec.ts   # T14 journey (playwright, chromium installed ✓)
```

## 3. Desktop store mechanics (T2) — binding

- Open: `new Database(path)`; `PRAGMA journal_mode = WAL`; `PRAGMA foreign_keys
  = ON`; cipher profile per DR-P21-02 (`PRAGMA key` + `cipher_version` check).
- Migrations: sync-core `applyMigrations(adapter)` (v1–3, min-contract
  tracking) then `applyDesktopMigrations(adapter)` v4+ in ONE transaction each:
  - **v4** (`"2026-11-04.1"`): read caches `sales_invoices` (+`version`),
    `quotations`, `delivery_notes`, `stock_counts` + write-sets `draft_docs`
    (unified draft store: `doc_type, local_id, payload, local_status
    DRAFT_LOCAL|PENDING_MERGE|SYNC_FAILED|MERGED|CANCELLED_LOCAL, command_id,
    rejection, updated_at`), `local_events` (audit-logged user choices w/
    `trace_id`). Column meanings frozen; semantic changes ⇒ version bump +
    cursor reset note (LOCAL_DATABASE §2).
  - **v5**: `meta` keys (`deviceClass="tauri-desktop"`, `contractVersion`,
    `permissionSnapshotAt`, `enrolledDeviceId`, `rolloutChannel`).
- `integrityCheck()`: `PRAGMA integrity_check` → anything but `ok` ⇒ §6.4:
  stage outbox+inbox rows (readable parts) to a staging file → delete DB file →
  re-run migrations → re-import → cursors reset (full pull). Loud
  `LocalStoreCorruptError` semantics preserved (sync-core pattern).
- Boot sequence (every start): open → migrations → `recoveryPass(adapter)`
  (IN_FLIGHT → QUEUED + checksums) → integrity drill hooks.
- Byte-exact prune (DR-P21-03) runs post-cycle, never prunes
  MACHINERY_TABLES, LRU by last-access columns, tombstones applied immediately.

## 4. Enrollment + credentials + unlock (T3/T7) — binding

1. First run: `enrollDevice({deviceName, deviceClass: "tauri-desktop",
   contractVersion, deviceKeyPublic?})` → register (session-authenticated by
   the logged-in user OR via the web flow; the sandbox harness drives it with
   the suite actor) → optional `attest(nonce signature)` (ed25519 via
   node:crypto) → **enroll** (DR-P21-01) → store refresh token + device key +
   SQLite key in the Keychain (NEVER SQLite), access token memory-only.
2. Keychain interface: `get/set/delete(name)` namespaced
   `erp.<deviceId>.{refreshToken|deviceKey|dbKey}`; implementations:
   `MemoryKeychain` (tests), `BridgeKeychain` (shell → Windows Credential
   Manager). Secret-scan test: after full flows, assert no secret material in
   the DB file bytes / logs / prefs (D-02 profile-dependent part + invariant
   part).
3. Unlock (offline login): reads cached `permissions` snapshot rows +
   watermark. Within 7 days ⇒ full UI per snapshot; beyond ⇒ read-only +
   online-required (D-04, now against the REAL SQLite store). Unlock PIN/hash
   optional (v1: presence of keychain = unlock; recorded decision).
4. Rotation: access token refreshed silently at expiry−60s via refresh route;
   reuse detection (400/revoked) ⇒ D-01 path (revocation.ts): stop sync,
   purge local tenant data incl. outbox on next contact instruction, require
   re-enrollment.

## 5. Sync host mechanics (T4) — binding

- `SyncDesktopHost` wraps `new SyncClient(adapter, transport)` UNMODIFIED.
  Transport = bridge http: `status()/pull/push/pushV2/pullAck/pushAck` with
  `Authorization: Bearer <accessToken>` + `x-device-id` header
  (devices.controller convention), base URL from config.
- Triggers (SYNC_PROTOCOL §8): app start/unlock → `recover()` + full
  `sync()`; connectivity regained (bridge event) → debounce 5 s → full cycle;
  periodic 2 min while dirty (`queueStats().queued > 0`); post-write →
  push-only fast cycle; manual sync-now. One in-flight cycle at a time
  (mutex); outcomes feed the UI state store (`lib/shell` mirrors for React).
- Contract gate: `status().contractVersion` unsupported ⇒ `readOnly = true`
  (no push, honest banner + update prompt; C-08). Stale server (server older
  than app's min) ⇒ refuse local writes (`SyncReadOnlyError` path).
- Pull scope: `feedEntitiesForDeviceClass("tauri-desktop")` = POS group +
  `sales_invoices`; permissions first (already in `runCycle`).
- Revocation/`dataExpiresAt`: status shows revoked/expired ⇒ revocation.ts
  purge (D-01) — the response instruction honored, audited locally.

## 6. Offline UI + rejection UX (T5/T6) — binding

- Components (shared, browser-safe, bilingual AR/EN + RTL):
  `OfflineBadge`, `AsOfLabel` (cursor-time from meta), `OnlineOnlyDisabled`
  (reason prop, AR/EN), `HonestStateBadge`
  (DRAFT_LOCAL/PENDING_MERGE/SYNC_FAILED/MERGED), `SyncNowButton`,
  `ConnectivityDot` — mounted in the Offline Console + dashboard quick action.
- Draft flows: per doc-type forms building REAL v2 commands via sync-core
  builders (`buildDraftInvoiceCreate`, `buildPartnerContactMerge`, …) +
  desktop builders for the new intents (`buildSyncCommandV2` + per-intent
  payload schemas).
- **DR-P21-08 — the desktop write intents land server-side THIS phase**
  (020's completion report: "Desktop/van/personal … their intents are
  021/022 columns"; the capabilities fixture's tauri-desktop rows pin
  partner-create to 021; the matrix Phase column pins rows 7/10/11/25/26/34
  to PHASE-021). Wire contracts (schemas, envelopes, rejection registry)
  stay FROZEN — new intents are new handler-registry entries + payload
  schemas inside the existing v2 command envelope, each behind a numbered
  decision record, each calling the OWNING module service only:
  | Intent | Policy | Owning service |
  |---|---|---|
  | `partner:create` | SD | PartnerService.create (016 pattern) |
  | `quotation:create_draft` | OD-create | QuotationsService draft path |
  | `delivery_note:create_draft` | SD-at-submit | DeliveryNotesService draft path |
  | `expense:create` | SD | ExpensesService (019 CRM/service pattern) |
  | `cash_transfer:create_draft` | SD | Treasury cash-transfer service |
  | `stock_transfer:create_draft` | SD | Inventory transfers draft path |
  | `stock_count:submit_lines` | SD-aggregate | Stock counts service |
  CREATE-draft only for the new types (invoice keeps 020's create+update OD
  pair; no offline update intents for the new types — non-owner edits are
  simply not offered offline; invoice non-owner FORBIDDEN already covers
  criterion 4's server rejection). No new tables, no new routes: handlers
  register in the existing push registry + feed publication in-tx. Payload
  schemas live in `packages/contracts/src/sync/` (additive, version-frozen).
  Each handler ships its own `__db__` specs (accept/reject/idempotent-replay
  + honest-state asserts). The capabilities fixture gains implemented rows
  for all of them at W4 (matrix §5 rules 1+3).
- Rejection UX: the FULL §3 table (not just the 3-value enum):
  PERIOD_LOCKED→[edit-and-resend, cancel]; PRICE_CHANGED→[accept-server-price,
  edit-and-resend, cancel]; INSUFFICIENT_STOCK→[edit-and-resend,
  accept-partial, cancel]; CREDIT_LIMIT_EXCEEDED→[edit-and-resend,
  request-approval-online, cancel]; STALE_VERSION→[review-and-merge diff,
  discard]; ITEM/PARTNER_INACTIVE→[cancel, substitute-and-resend];
  VALIDATION_ERROR→[edit-and-resend]; DEVICE_REVOKED/TENANT_SUSPENDED→admin
  state, no resubmission. Every choice ⇒ `local_events` row
  `{choice, reason, traceId, commandId, at}` + audit via next sync contact;
  resend = NEW commandId + fresh idempotencyKey (same entity id).
- Reprint: cached POSTED sales invoices/receipts → `print/escpos.ts` →
  bridge print (browser fallback: window.print of the HTML template). Never
  re-numbers (assert in tests).

## 7. Updater + rollout + probe + print + telemetry (T8/T9/T10/T11) — binding

- Manifest (Tauri v2 updater shape): `{version, pub_date, platforms:
  {"windows-x86_64": {signature, url}}, minVersion?, rollout:
  {stagePercent, cohortSeed}, notes}`; served by `deploy/updater/` layout
  `stable/latest.json` + versioned dirs; `scripts/updater-manifest.ts
  sign|publish` (minisign; CI-only real keys, test keys in specs).
- Client state machine: check (manifest fetch via bridge http) → verify
  minisign sig (REAL crypto) → version compare (downgrade REJECT) → cohort
  gate (skip if not selected) → min-version gate (block+prompt) → download →
  verify bundle signature → install (bridge) → relaunch. Dual-key window
  honored (either trusted key verifies).
- Staged rollout service logic (`deploy/updater/rollout.ts` + tests):
  stage transitions read crash-free-session metrics (input fixture from the
  sync-health dashboard shape); gates per §0 constants; halt path emits
  minVersion bump. CI workflow consumes the same module.
- WebView2: `parseWebview2Version`, `compareVersions`,
  `webview2Policy(version)` → `{status: "supported"|"degraded"|"unsupported",
  guidance}`; probe matrix test incl. below-minimum, degraded band, current.
- Telemetry: `redactEvent` strips `refreshToken|accessToken|dbKey|deviceKey|
  Authorization` + file paths; crash-free session counter
  (`sessionStart/crash` → rolling rate) — feeds rollout gates; no secrets in
  logs (scan test).
- Print: ESC-POS commands (init/justify/cut/code128 + Arabic-aware line
  wrapping — bilingual templates parity with 013/016 fixtures); fixture tests
  compare rendered bytes to golden templates.

## 8. Tauri shell sources + web export + CI (T1/T12) — binding

- `src-tauri/tauri.conf.json`: productName, identifier `com.erp.desktop`,
  `frontendDist: "../../apps/web/out-desktop"`, updater endpoint
  `https://updates.erp.example/stable/{{target}}/{{current_version}}`,
  min TLS, Windows bundle targets (nsis+msi), signing env wired in CI only.
- Rust glue: `main.rs`/`lib.rs` register plugins (sql sidecar w/ SQLCipher
  build flag, keyring, updater, print raw, system probe commands matching the
  bridge contract names). `plugins/**` minimal — logic lives in TS.
- `scripts/check-desktop-shell.ts`: validates tauri.conf.json invariants,
  bridge contract ↔ Rust command parity (name set diff), export exists after
  build, no secrets in shell configs; wired as `check:desktop-shell`.
- CI `desktop-release.yml`: on tag `v*` → windows-latest → pnpm install →
  `build:desktop` → cargo build (SQLCipher feature) → sign (EV cert +
  minisign updater key from secrets) → SBOM (cyclonedx-npm) → artifact upload
updater manifest publish. Sandbox ships the workflow as code + a YAML
  structural validation test (honest note: executed on real Windows runners).
- `.dependency-cruiser.cjs`: add rules — `desktop-no-api` (`@erp/desktop` may
  not import `@erp/api`/`apps/api`), `web-shell-no-server` (DR-P21-07),
  `desktop-no-web` (desktop src may not import apps/web internals; bridge
  contract types are duplicated client-side).

## 9. Chaos desktop profile + kill-matrix + D-02/D-06 (T13) — binding

- New `apps/api/src/__db__/sync/desktop/` suite: drives the SAME scenario
  shapes as `chaos-matrix.spec.ts` but with `ReferenceDevice` constructed over
  the REAL sqlite adapter (temp-dir DB file, WAL) via a `desktopDevice()`
  factory — the full matrix C-01…C-16 on the file store. Shared scenario
  helpers may be extracted from the existing spec into
  `../_chaos-scenarios.ts` (pure refactor; the 020 spec keeps passing
  bit-identically).
- **C-08 with real signed updates**: contract-downgrade server → device
  read-only → updater client fetches a REAL minisign-signed manifest +
  bundle (keys generated in-test) → verify ok → "update applied" (version
  bump in meta) → clean resume, no data corruption.
- **Kill-matrix (T9 hook)**: spawn a real child Node process running a push
  cycle against a file DB; SIGKILL at scripted points (pre-commit,
  post-commit pre-ack, mid-pull); reopen: WAL recovers, `IN_FLIGHT → QUEUED`,
  outbox intact, re-converges (C-04 semantics through REAL process kills).
- D-01/D-04 re-run on the file store (they were in-memory-only); D-02:
  cipher-profile binary inspection (skip w/ caveat on standard profile) +
  secret-scan invariants; D-06: updater attack suite (unsigned, tampered,
  downgrade, min-version force).
- Budget: desktop dir ≤ 10 min wall; whole sync suite stays ≤ 15 min.

## 10. E2E offline journey (T14) — binding

`tests/e2e/desktop-offline.spec.ts` (playwright, chromium ✓): serve
`apps/web/out-desktop` statically; inject `window.__erpDesktop` test double
BACKED BY THE REAL desktop runtime (adapter over a temp sqlite file + a
FaultTransport scripted server: offline → online → PRICE_CHANGED rejection) —
page.exposeFunction wiring in `page.addInitScript`. Journey (AR then EN):
unlock (cached snapshot) → cached item/partner reads w/ as-of labels → create
invoice draft (DRAFT_LOCAL badge) → simulate offline ONLINE-ONLY action
(disabled w/ reason) → reconnect → cycle completes → PRICE_CHANGED rejection
rendered → user picks accept-server-price → resubmitted → ACCEPTED state.
Assertions on honest states at every step + i18n strings both locales.

## 11. Docs + registries (T15) — binding

- `docs/operations/DESKTOP_QUICKSTART.md` (new), DEVELOPMENT_SETUP.md desktop
  section, `docs/operations/DESKTOP_SYSTEM_REQUIREMENTS.md` (WebView2 minimum
  + guidance), DEPLOYMENT §7 updater-hosting runbook entries,
  TROUBLESHOOTING §desktop (updater fail, WebView2 below-min, corruption
  path), FEATURE_CATALOG `offline.desktop_app` → LIVE, IMPLEMENTATION_STATUS
  (PHASE-021 → COMPLETE), CURRENT_STATE, CHANGELOG, PHASE_ACCEPTANCE_CRITERIA
  (criteria copied), SYNC_TESTS status note (desktop profile live),
  LOCAL_DATABASE status note (real store landed; cipher profile note),
  OFFLINE_CAPABILITIES_MATRIX desktop column statuses + capabilities fixture
  flips (items lookup, price list view, partner create, reprint,
  master-data search, invoice draft, partner contact edit → implemented:true
  with gates; deferred-intent split recorded per §6), ENTITY_CATALOG local
  tables note, CURRENT_SHIPPED_PHASE → `PHASE-021`
  (`apps/api/src/modules/configuration/application/apply/prerequisites.ts` +
  the 2 pinned spec re-pins), MONITORING client-stability panels note.
- `agent-ctx/T-P21-*.md` evidence per task + PHASE-021-COMPLETION.md.

## 12. Task order & agent waves

| Wave | Task ID | Scope | Depends |
|---|---|---|---|
| W1 | **1-a** | `@erp/desktop` scaffold + sqlite adapter + desktop migrations v4/v5 + corruption path + byte-exact prune + store suite | — |
| W1 | **1-b** | Server enroll endpoint (DR-P21-01) + registries + desktop auth (enroll/keychain/session/unlock) + suites | — |
| W1 | **1-c** | minisign + updater client + manifest/rollout service + webview2 + telemetry + escpos/print + suites | — |
| W2 | **2-a** | sync host + triggers + transport + revocation + host suites (needs 1-a, 1-b) | W1 |
| W2 | **2-b** | apps/web: bridge client + offline console + affordances + rejection UX + unlock screen + i18n + component suites | W1 (bridge contract) |
| W2 | **2-c** | src-tauri sources + web export target + prebuild + guard rules + check:desktop-shell + CI workflow + deploy/updater | W1 (updater contract) |
| W2 | **2-d** | DR-P21-08 server write intents: 7 payload schemas + handlers + feed publication + `__db__` specs (needs 1-b enroll for specs) | W1 |
| W3 | **3-a** | chaos desktop profile + C-08 signed updates + kill-matrix + D-01/02/04/06 on file store | W2 |
| W3 | **3-b** | E2E desktop-offline journey (AR+EN) | W2 |
| W4 | **4** | docs + capabilities flips + completion report + CURRENT_SHIPPED_PHASE=021 + FULL gates + commit | W3 |

Per-wave gates: `pnpm typecheck && pnpm lint` + targeted vitest; W2+ adds
`lint:depcruise`, `check:permissions-drift` (enroll row!), `docs:validate`,
`check:i18n-parity`; W4 adds full `test:db`, `check:capabilities-matrix`,
`check:desktop-shell`, `check:rls`.

## 13. Out of scope (review blockers if implemented)

- Android (022), macOS/Linux shells (decision record required first).
- Offline UPDATE intents for the new draft types (create-only, DR-P21-08);
  any future update/merge semantics = their own decision records.
- Web offline writes (browser stays online-only; the console in a browser
  renders ONLINE-ONLY states only).
- POS terminal provisioning changes; sync wire protocol changes; a second
  business-logic path anywhere (handlers/owning services only).
- Byte-exact budgets on non-desktop classes (desktop-only this phase).
- Real Windows signing execution in sandbox (CI code only, honestly noted).
