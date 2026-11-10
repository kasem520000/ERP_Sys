# PHASE-022 MASTER PLAN — Android Application (Expo/RN — ONE app, TWO capability experiences) (BINDING)

> **Repo:** `/home/z/phase017_work` (pnpm monorepo: NestJS `apps/api` + Next.js `apps/web` +
> `apps/desktop` + `apps/mobile` + `packages/contracts|domain-core|sync-core|config|ui`).
> **Phase doc:** `docs/implementation/phases/PHASE-022.md`.
> **Authority split (the PHASE-021 convention):** the PHASE doc wins on **SCOPE**; this plan
> wins on **MECHANICS**. Deviations are recorded in the completion report as decision records
> (`DR-P22-xx`), exactly like `DR-P21-01…09` and `DR-P20-01…10` before them.
> **Doctrines inherited (verbatim commitments):** sync-core consumed **UNMODIFIED** (RISK-011
> containment; the 36/36 client suite stays green byte-identical); the **k6 precedent** — real
> artifacts + real tests for everything TypeScript, honest deferral notes for what needs
> Android hardware, **never a silent skip**; money/quantities are TEXT canonical decimal
> strings, never REAL (ADR-0009); UUIDv7 on-device in the same transaction as the outbox
> command; server-final enforcement on every pushed command.

## 0. Environment reality + golden constants (binding)

**Sandbox truth (verified this session):**

- The repo was **re-extracted from `ERP_PLATFORM_PHASE021.zip`** (commit `82eb5be`,
  PHASE-021 COMPLETE) after another environment reset — the `PHASE-019/021` precedent;
  history preserved (`.git` inside the zip). `dist-storybook` build artifacts restored from
  git so the tree is clean.
- **No Android SDK / emulator / device** in the sandbox. The Android hardware surfaces
  (on-device chaos C-06/C-07/C-13, SQLCipher cipher inspection D-02 on device, Play Store
  signing, visual snapshot gallery, T-03 scan-to-cart measurement) are shipped as
  **source + CI wiring + honest deferrals**, exactly like the Windows-hardware deferrals in
  PHASE-021 (`## Honest deferrals` in the completion report). The EAS/`mobile-release.yml`
  pipeline compiles what the sandbox cannot.
- **Node 24.22.2 + pnpm 9.15.9 (corepack)** — `export PATH="/home/z/.npm-global/bin:$PATH"`
  before any pnpm command. `react`, `react-native` (pure JS), `react-test-renderer`,
  `@testing-library/react-native` install and run on Node — so **RN components ARE
  render-tested in-sandbox** (tree-level + a11y assertions); only pixel snapshots defer.
- **Expo device modules (`expo`, `expo-sqlite`, `expo-secure-store`,
  `expo-local-authentication`, `expo-notifications`, `expo-background-fetch`) are NOT
  installed in the sandbox** — they live in `apps/mobile/native/package.json` (the
  `src-tauri`/`Cargo.toml` precedent: a package the pnpm workspace never installs; EAS CI
  installs it). All native access goes through **ports** in `src/` whose device
  implementations live in `apps/mobile/native/` (source-only, gated by the new
  `check:mobile-shell` script — the `check:desktop-shell` precedent).
- Embedded PostgreSQL 16 powers `pnpm test:db` (the 021 baseline: **130 files / 1829 tests
  in ~2 min**); better-sqlite3 has prebuilt binaries (the desktop store precedent).

**Golden constants (binding):**

| Constant | Value |
|---|---|
| `CONTRACT_VERSION` | `"2026-11-04.1"` (grace `2026-10-27.1`) — unchanged, protocol frozen by 020 |
| Device classes (exist in `DEVICE_CLASSES`) | `"android-field"`, `"android-personal"` |
| Registration `platform` | `"android"`; `capabilities` labels `["van_sales"]` / `["personal_account"]` (advisory strings — feeds gate by deviceClass) |
| Feed groups to activate | `FEED_GROUPS.field` = POS + `"van_stocks"`, `"routes"`, `"settlement_templates"`, `"statements"`; `FEED_GROUPS.personal` = `"statements"`, `"sales_invoices"`, `"receipts"`, `"notifications"` (partner-scoped server-side) |
| Storage budget | **128 MB** LRU, byte-exact `dbstat` accounting (the DR-P21-03 port); outbox/inbox/meta/cursors never pruned |
| Sync schedule | foreground cycle **2 min** when dirty; background fetch **≤ 15 min** OS-scheduled (Doze-aware); connectivity-regained debounce **5 s**; after-local-write push-only fast cycle |
| Bandwidth budgets | pull **≤ 8 MB** / push **≤ 2 MB** per cycle (cellular defaults); **personal-account background pull ≤ 256 KB** |
| Permission snapshot watermark | **7 days** (`PERMISSION_SNAPSHOT_MAX_AGE_DAYS` exists) → read-only + online-required-for-writes |
| Rollout stages + crash gates | `10% → 50%` at ≥ 99.5% crash-free over ≥ 200 sessions (24 h); `50% → 100%` at ≥ 99.7% over ≥ 500; **halt < 98.5% ⇒ publish `minVersion` = last-known-good** (force-update) |
| Price tolerance | 0% POS / **2% tenant-configurable** for field drafts (`PRICE_CHANGED` beyond tolerance) |
| Touch targets | ≥ 44 px (ACCESSIBILITY §touch) |
| Chaos tenant (expo profile) | `TENANT_EXPO = "7e5d0000-0022-4000-8000-000000000022"` — **verify unused before use** (grep the migration seed + specs) and adjust the last block if taken; dedicated like the desktop `c0a0c0a0-…` tenant |
| Chaos budgets | expo dir **≤ 10 min**; whole sync suite stays **≤ 15 min**; full `test:db` ≤ 5 min |

## 1. Binding architecture decisions (the trues-up)

1. **DR-P22-01 — `@erp/mobile` is a TypeScript workspace package + RN screen sources + a
   `native/` expo glue dir (the ADR-0013 "Rust stays confined to plugins" pattern applied to
   Expo).** ALL application logic (theme, i18n runtime, auth/session, store, sync host,
   field-sales flow state machines, rejection UX mapping, notifications client, release
   policy) is pure TS under `apps/mobile/src/**` — vitest-tested on Node. RN screens import
   **only** `react`/`react-native` + `@erp/mobile` internals (render-tested via
   `react-test-renderer`/`@testing-library/react-native`). Expo/native access is confined to
   `apps/mobile/native/**` (excluded from tsconfig like `src-tauri`, validated by
   `scripts/check-mobile-shell.ts`, compiled only by EAS CI). `apps/mobile/package.json`
   depends on `@erp/contracts`, `@erp/domain-core`, `@erp/sync-core`, `react`,
   `react-native` (+ test tooling) — **never** `packages/ui` or `packages/config` (depcruise
   `mobile-imports-only-contracts-domain-core` stays green).
2. **DR-P22-02 — Design tokens: canonical TS object stays in `packages/ui/src/tokens/`
   (DESIGN_TOKENS §17); the mobile theme module re-declares the values and a NEW root gate
   `check:mobile-tokens` (`scripts/check-mobile-tokens.ts`, root script) imports BOTH
   (scripts/ live outside the depcruise-forbidden paths — the `check:i18n-parity` precedent)
   and asserts **byte-parity** (color/space/radius/typography/shadow/z-index families). No
   raw design values in RN code (spot-checked structurally in `check:mobile-shell`).**
3. **DR-P22-03 — RTL: RN logical props ONLY.** New ESLint restriction (in the root config,
   scoped to `apps/mobile/src/**`): physical-direction style props are **banned** —
   `marginLeft/marginRight/paddingLeft/paddingRight/left/right/borderLeftWidth/
   borderRightWidth/textAlign:'left'|'right'` (+ their StyleSheet literal forms) — in favor
   of `marginStart/marginEnd/paddingStart/paddingEnd/start/end/textAlign:'start'|'end'`.
   This is the RN port of `erp/no-physical-direction`. Sanctioned exceptions need an inline
   `// rtl-exempt:` comment. Icons mirror ONLY through a direction registry (the
   DIRECTIONAL-set port); **never** `transform:scaleX(-1)` on UI; barcodes/QR never mirror.
   Bidi: LTR runs (doc numbers, IBANs, serials) isolated with U+2068…U+2069 via the mobile
   `bidi()` helper.
4. **DR-P22-04 — i18n:** `apps/mobile/src/i18n/dictionaries.ts` (AR-first typed catalog,
   `Dictionary` interface so TS rejects key drift, `assertParity()` at load) + NEW root gate
   `check:mobile-i18n` (`scripts/check-mobile-i18n-parity.ts`) asserting ar=en parity +
   non-empty strings. Digits policy: identifiers/amounts/doc numbers render `latn` +
   `fontVariant: ['tabular-nums']`; `arab` display is tenant-configurable. The web gate
   `check:i18n-parity` (ar=en=3244) stays untouched.
5. **DR-P22-05 — Server feed activation (field + personal groups).** `FEED_GROUPS.field`
   gains the field subset; `FEED_GROUPS.personal` gains the personal read models. Pull
   feeds for the new entity types ride the **existing 020 feed machinery** (change_log +
   tombstones + per-device-class scoping — `SYNC_ENTITY_NOT_PULLED` outside the group).
   Personal feeds are **partner-scoped server-side** (the 020-proven filter; LOCAL_DATABASE
   §1.1 rule 2: a tampered device cannot pull other partners' rows). If change-capture for
   `van_stocks`/`routes`/`settlement_templates`/`statements`/`receipts`/`notifications`
   needs schema objects, add **one minimal migration `0033_mobile_feeds.sql`** and record it
   as `DR-P22-05a` (the DR-P21-01 "the only server-side change" honesty pattern — the phase
   doc's "no DB changes" is read as *no business-schema changes*; quote this verbatim in the
   completion report). `SYNC_CAPABILITY_FIXTURE` rows for phase 022 flip to
   `implemented: true` with real gates; new android rows are added so
   `pnpm check:capabilities-matrix` passes with the OFFLINE_CAPABILITIES_MATRIX §2 table
   row-for-row (row-by-row cross-check lands in the completion report).
6. **DR-P22-06 — Server write intents grow 13 → 16 (reuse-first, the DR-P21-08 pattern).**
   NEW handlers in `apps/api/src/modules/sync/application/handlers/`:
   `receipt:create_field_collection` (row 9 OFFLINE-COMPLETE — posts at sync, rep-attributed,
   INV-013 idempotent), `van:confirm_load` + `van:confirm_unload` (row 12 OFFLINE-COMPLETE
   against the van snapshot; rejects double-loads / unloads beyond current van quantity with
   `INSUFFICIENT_STOCK`), `credit_note:create_draft` (row 27 OFFLINE-DRAFT). REUSED intents:
   van-sale capture = `sales_invoice:create_draft` (row 6), quotation = existing draft
   intents (row 7), partner create (row 23), `stock_count:submit_lines` (row 11),
   partner-contact merge (row 21), expense draft (row 25), serial/batch on lines (row 35 —
   payload schema extension if contracts lack it). Contract payload schemas land in
   `packages/contracts/src/sync/field-intents.ts` (the desktop-intents pattern).
7. **DR-P22-07 — FCM skeleton.** `NotificationChannelPort` interface +
   `FcmChannelAdapter` (disabled-by-default — the `DisabledSmtpTransport` pattern; fake-FCM
   transport for tests) in `apps/api/src/modules/notifications/` + a device-token opt-in
   surface on the devices module (default OFF). Locale resolved BEFORE the FCM call from
   templates; **no financial payloads in notifications** (asserted). Token storage: prefer
   an existing devices JSON column; if none fits, `0033` gains a minimal
   `device_push_tokens` table (sub-DR recorded honestly).
8. **DR-P22-08 — Mobile sync host = thin wrapper over UNMODIFIED sync-core** (the
   desktop-host pattern): `MobileStore extends StorageAdapter` over a `SqliteDriverPort`;
   `ExpoHttpTransport extends SyncTransport` (paths/headers identical to desktop constants);
   host owns per-class parameters (budgets/schedules), `HostState` UI mirror, one-in-flight
   mutex, C-08 contract gate → force-update path, D-01 revocation purge, post-cycle prune.
   **Field profile:** `applyMigrations(adapter)` (v1–3) then `MOBILE_MIGRATIONS` v4+ (field
   subset DDL: van_stocks, routes, settlement template cache, statements read cache —
   versions continue per-store like desktop v4/v5). **Personal profile (DR-P22-08b):**
   `applyPersonalMigrations` creates **cursors + meta + personal read models ONLY — no
   outbox/inbox** (LOCAL_DATABASE §1.1 rule 2; sync-core's v1 bundles outbox with cursors so
   the personal store applies its own minimal DDL into the same `schema_migrations` table —
   sync-core itself stays untouched; pull-only cycles via `SyncClient.pullAll`).
9. **DR-P22-09 — Device security.** `SecureStorePort` (device impl: expo-secure-store /
   Android Keystore; tests: in-memory port) holds refresh token + device private key +
   SQLCipher DB key; access token memory-only (15 min, silent refresh); refresh rotation
   reuse = theft signal → revocation. `UnlockPort`: biometric optional + PIN fallback.
   `TrustSignalsPort`: best-effort rooted/tamper detection → `devices.trustFlags` (via
   registration + PATCH), degrade-to-online-only until admin ack, **never brick** (D-07).
   `FLAG_SECURE`-style screenshot block on financial screens via the port. Permission
   snapshot gates UI only (7-day watermark → read-only + online-required-for-writes).
10. **DR-P22-10 — Release engineering.** `apps/mobile/eas.json` + `native/package.json`
    (expo deps) + `.github/workflows/mobile-release.yml` (tag-triggered; EAS build —
    `run-eas` with honest signing placeholders that warn-and-continue, the desktop-release
    precedent; SBOM; artifact upload; staged-rollout config 10/50/100 + crash gates) and a
    **structural in-sandbox spec test** `apps/mobile/__tests__/mobile-release-ci.test.ts`
    asserting workflow step order (the `desktop-release-ci.test.ts` pattern). Minimum-version
    enforcement: `ReleasePolicy` module (client) compares `appVersion` against a published
    minimum (updater-manifest pattern ported; simulated in tests) → force-update screen.
11. **DR-P22-11 — The RN screen set (page archetypes → mobile tab bar).** Screens ship as
    source in `apps/mobile/src/screens/**` + `apps/mobile/native/App.tsx` navigation glue;
    every screen is registered in the navigation registry and covered by tree-render +
    a11y + AR/EN direction tests. Screens: Onboarding/Login, DeviceRegistration, Unlock
    (biometric/PIN), Home dashboard (companion), Statements, InvoiceList/InvoiceView,
    RouteVisits, VanSaleCapture (barcode port + LOCAL-VALID pre-validation), Collection,
    VanLoadUnload, ReturnsDraft, CountLines, ParkedRejections (CONFLICT_RESOLUTION §3
    action table), PersonalHome (balance/statement/invoices/receipts/due dates),
    Notifications, Settings (device mgmt / sync-now / biometric toggle / language AR-EN).
    Approvals are reachable but ONLINE-ONLY-affordanced (disabled with reason offline —
    never queued). `check:mobile-shell` validates registry completeness + imports +
    logical-props + token usage + a11y props + ≥44px targets.

## 2. Package layout (new code)

```
apps/mobile/
  package.json            # @erp/mobile — contracts/domain-core/sync-core + react/react-native + vitest
  tsconfig.json           # extends @erp/config base; include src; EXCLUDE native/
  vitest.config.ts        # environment node; __tests__/**/*.test.ts(x)
  README.md               # replaces the placeholder; quickstart + structure + honest deferrals
  eas.json                # EAS profiles (preview/production) — source-only in sandbox
  app.config.ts           # expo config (source-only; native tooling reads it via EAS)
  metro.config.js         # (native/ workspace wiring) source-only
  native/                 # EXCLUDED from tsconfig + pnpm workspace (src-tauri precedent)
    package.json          # expo + expo-sqlite/secure-store/local-authentication/notifications/background-fetch
    App.tsx               # expo entry: registers drivers, navigation glue, background-fetch task
    drivers/              # device impls of the ports: secure-store, sqlite (SQLCipher), unlock, trust, notifications, fcm, background-scheduler, barcode-scanner
  src/
    constants.ts          # zero-import LEAF (the desktop pattern): budgets, schedules, class names
    theme/                # tokens.ts (RN mirror), theme.ts, primitives/ (Button, MoneyText, Badge, StatusChip, ListItem, Card, Field, TabBar)
    i18n/                 # dictionaries.ts (ar/en), runtime.ts (locale/direction/digits), bidi.ts
    auth/                 # session.ts (memory-only), refresh.ts (rotation), enroll.ts, unlock.ts (ports)
    device/               # registration.ts, trust.ts, secure-store-port.ts, drivers-registry.ts
    store/                # driver-port.ts, node-driver.ts (better-sqlite3), store.ts (StorageAdapter), migrations.ts (field v4+/personal), prune.ts, corruption.ts
    sync/                 # transport.ts, host.ts, triggers.ts, budgets.ts, revocation.ts
    fieldsales/           # flows: van-sale.ts, collection.ts, van-load.ts, returns.ts, count-lines.ts, route-visits.ts (+ prevalidation.ts against snapshots)
    companion/            # dashboards, statements, invoice views, approvals affordance
    personal/             # personal-accounts read-only home + feeds
    reconciliation/       # parked-rejections: per-code actions (CONFLICT_RESOLUTION §3 table)
    notifications/        # FCM client wiring (opt-in, token registration)
    release/              # release-policy.ts (min-version, force-update), rollout.ts (stages/gates)
    screens/              # RN screens (registry.ts + one file per screen)
  __tests__/              # vitest: theme-parity, i18n-parity, store, sync-host, auth, flows,
                          # rejection-actions, release-policy, screens render+a11y+direction,
                          # mobile-release-ci structural test
apps/api/src/modules/sync/application/handlers/   # + field-receipt.ts, van-confirm.ts, credit-note-draft.ts
apps/api/src/modules/notifications/               # + channel-port.ts, adapters/fcm/**, push-tokens surface
apps/api/src/__db__/sync/expo/                    # expoDevice factory + expo-chaos.spec (C-01..C-16) + d-expo-store.spec (D-01/02/04) + battery/connectivity fault profiles
packages/contracts/src/sync/                      # FEED_GROUPS activation + field-intents.ts + capability rows
scripts/check-mobile-tokens.ts · check-mobile-i18n-parity.ts · check-mobile-shell.ts
.github/workflows/mobile-release.yml
docs/operations/MOBILE_QUICKSTART.md + rollout runbook entries + FEATURE_CATALOG keys
```

## 3. Expo scaffold + boundaries (T1) — binding

- `apps/mobile/package.json`: name `@erp/mobile`, `"type": "module"`, exports `.` →
  `./src/index.ts`, scripts `build/typecheck = tsc --noEmit`, `lint = eslint .`,
  `test = vitest run` (the `@erp/desktop` shape verbatim). deps:
  `@erp/contracts`, `@erp/domain-core`, `@erp/sync-core`, `react@18.3.1`,
  `react-native@0.76.x`; devDeps: `@erp/config`, `react-test-renderer@18.3.1`,
  `@testing-library/react-native`, `@types/react`, `vitest`. `turbo.build.outputs = []`.
- tsconfig: extends `@erp/config/tsconfig/base.json`, `include: ["src/**/*.ts",
  "src/**/*.tsx"]`, `exclude: ["node_modules", "dist", "native"]`. JSX `react-jsx`.
- eslint: root config applies; add the mobile physical-props restriction (DR-P22-03) scoped
  to `apps/mobile/src/**` — implement as a `no-restricted-syntax`/`no-restricted-properties`
  block in the shared config gated by path, error severity, with the `// rtl-exempt:`
   escape documented in the rule message.
- depcruise: `mobile-never-imports-other-clients` + `mobile-imports-only-contracts-domain-core`
  already exist — must stay at 0 violations; `api-never-imports-clients` gains the expo
  harness exception `pathNot: "^apps/api/src/__db__/sync/expo/"` (the desktop precedent).
- `pnpm install` (NOT frozen) once to add the new deps → lockfile updated; CI stays frozen
  afterwards. Install size is modest (react/react-native are pure JS).

## 4. Theme + primitives (T2) — binding

- `src/theme/tokens.ts`: RN-shaped mirror of `packages/ui/src/tokens/` (read the canonical
  source file first; mirror color ramps incl. the semantic-state solids/tints/borders, the
  binding status-badge map DRAFT→Info / PENDING_APPROVAL→Warning / APPROVED→Success-info /
  POSTED→Success / VOIDED|CANCELLED→Danger, finance sign colors, surfaces, shadows (RN
  elevation-friendly objects), the full type scale with tabular-nums note, spacing 4px-grid
  stops, radii, z-index, focus-ring values, breakpoints (sm 640 = the phone owner view),
  motion durations/eases, icon sizes 16/20/24 + stroke 1.5).
- `check:mobile-tokens`: flatten both objects; assert every canonical token has a mobile
  twin with the SAME value (fail with a diff; exit 1). Print the parity line
  `== mobile token parity: N/N ==`.
- Primitives (`src/theme/primitives/`): Button/IconButton (min-height 44, focus ring prop),
  MoneyText (sign color by value, `latn` digits + tabular-nums + bidi isolate for the
  currency/doc-number run), Badge/StatusChip (the binding map), ListItem/Card, Field
  (label + a11y label), Spinner, EmptyState, TabBar. Each has AR+EN direction render tests
  + a11y assertions.

## 5. i18n runtime (T3) — binding

- `dictionaries.ts`: `ar` (default) + `en`; typed `Dictionary`; every screen's strings
  present; `assertParity()` throws on drift at module load (the web pattern).
- `runtime.ts`: `resolveLocale()`, `isRTL(locale)` (`I18nManager.forceRTL` happens in
  native/App.tsx — the port boundary), `formatMoney/formatQty/formatDate` (latn default;
  `arab` display behind tenant config), `t(key, params)`.
- `bidi.ts`: `bidi isolate` helpers (U+2068/U+2069) for doc numbers/IBANs/serials; phone
  numbers never mirrored.
- `check:mobile-i18n` root gate prints `== mobile i18n parity: ar=N keys, en=N keys ==`.

## 6. Server: feeds + capabilities + intents + FCM (T6/T7/T9/T11 server side) — binding

- Feeds (DR-P22-05): discover the exact server entity naming from the 020 pull machinery +
  the PHASE-012/013 statement read models + PHASE-017 van/routes/settlement tables; wire
  the field + personal groups; per-class scoping (personal = linked partner ONLY — prove
  with a tampered-pull test; field statements = route customers). Pull pages respect the
  ≤ 2 MB delta cap (existing) + the new 256 KB personal background budget is enforced
  client-side (transport) — document which side enforces what.
- Capabilities: flip the 5 deferred android-field rows to implemented:true; add rows for
  every 022-activated cell (rows 6/7/9/11/12/13/14/23/27/33/35 android-field; 13/14/29
  android-personal; 21/25 android-field if shipped this phase — matrix Phase column is the
  tiebreaker) with real gate strings naming the spec files; `check:capabilities-matrix`
  green with the doc table row-for-row.
- Intents (DR-P22-06): three new handlers + payload schemas in
  `packages/contracts/src/sync/field-intents.ts`; tests in
  `apps/api/src/__db__/sync/field-intents.spec.ts` (the desktop-intents.spec pattern:
  accept+feed+audit+replay/duplicate:true, zod reject, per-reason rejections
  INSUFFICIENT_STOCK/PERIOD_LOCKED/PRICE_CHANGED/CREDIT_LIMIT_EXCEEDED, rejection details
  carry `availableQty`/`currentPrice` machine-readable values).
- FCM (DR-P22-07): `NotificationChannelPort` + fake-FCM adapter contract tests (locale
  resolution, opt-in default OFF, per-tenant quota, retry, NO financial payloads);
  device-token opt-in endpoints on the devices module; disabled adapter when
  `FCM_CREDENTIALS` unset (the SMTP precedent).

## 7. Mobile store + sync host + auth/device (T4/T5/T6 client side) — binding

- `store/driver-port.ts`: `SqliteDriverPort` (open, close, run, all, get, transaction,
  pragma, dbstat-bytes). `node-driver.ts` = better-sqlite3 (tests + chaos); device driver
  in `native/drivers/sqlite.ts` = expo-sqlite + SQLCipher key from SecureStore. WAL ON,
  `integrity_check` on boot.
- `store/store.ts`: `MobileStore implements StorageAdapter` + the pruning trio +
  byte-exact `tableBytes` (dbstat — the DR-P21-03 port) under the 128 MB budget; LRU by
  last access; never prune outbox/inbox/meta/cursors/dirty/referenced rows.
- `store/migrations.ts`: field = `applyMigrations` (v1–3) + `MOBILE_MIGRATIONS` v4+ (field
  subset DDL, TEXT money/qty); personal = `applyPersonalMigrations` (cursors+meta+read
  models ONLY — DR-P22-08b). Boot-order guard; corruption path = stage outbox → recreate →
  re-migrate → re-import → full pull (the §6.4 desktop drill, re-proven on the expo
  profile).
- `sync/transport.ts`: `ExpoHttpTransport implements SyncTransport` (all five v2 members;
  paths = the desktop constants; `Authorization: Bearer` from the memory session +
  `x-device-id`; typed fail-closed session-expired error; unwraps `{data, meta}`); the
  device impl of fetch lives behind a tiny `HttpPort` (tests inject a fake).
- `sync/host.ts`: per-class `MobileSyncHost` over `SyncClient` + `runCycle` — android-field
  (pull+push, 8 MB/2 MB budgets, foreground 2 min, background ≤ 15 min via
  BackgroundSchedulerPort, connectivity debounce 5 s, after-write push-only fast cycle,
  DEFERRED `retryAfterMs` honored via `RetryScheduler`), android-personal (pull-only, 256
  KB background budget, NO push path compiled into the flows), contract gate →
  read-only + force-update prompt, D-01 revocation → purge + re-login.
- `auth/` + `device/`: register (`POST /api/v1/devices`, platform `android`,
  deviceClass android-field/android-personal, Ed25519 keypair via CryptoPort,
  attestation-lite nonce signing) → enroll via the DR-P21-01 `POST /api/v1/devices/:id/enroll`
  → rotating refresh (reuse detection = revoke) → 15-min memory access token; biometric
  gate + PIN fallback; trust-signal reporting; screenshot block port; permission snapshot
  watermark application (read-only degradation UI states).

## 8. Field-sales flows + companion + personal + rejection UX (T7/T8/T9/T10 client side) — binding

- Every flow is a **pure state machine + a thin screen**: `DRAFT_LOCAL`/`PENDING_SYNC →
  POSTED | REJECTED(editable)` honest states rendered distinctly (StatusChip map);
  offline numbering via `nextOfflineNumber` (sync-core); LOCAL-VALID pre-validation against
  cached snapshots (van stock qty, cached price tolerance 2%, credit-limit advisory) —
  advisory warnings never block (server decides), but structural validation blocks.
- Van sale capture: barcode scan port (device: camera; tests: fake) → cart → draft invoice
  (rows 6/35) with serial/batch capture when tracked; collection receipt (row 9); van
  load/unload confirmation (row 12, against the van snapshot); returns draft (row 27);
  count lines (row 11 — facts only, variance is server-side); route visits list (routes
  feed) with per-customer tier pricing + balances.
- Companion: dashboard + statements + invoice views READ-CACHED with as-of labels
  (stale is labeled, never guessed); approvals ONLINE-ONLY affordance (disabled + reason
  when offline — never queued); master-data search from cache.
- Personal: balance/statement/invoices/receipts/due dates/notifications — READ-CACHED,
  as-of labels, **zero write affordances** (structural test: no enqueue calls reachable
  from personal screens); ≤ 256 KB background pulls.
- ParkedRejections: the FULL CONFLICT_RESOLUTION §3 table — per-code actions
  (edit-and-resend / accept-server-price / accept-partial / cancel / substitute / review-
  and-merge / discard / request-approval-path) with audit-logged choices carrying the
  rejecting `traceId`; resends produce NEW commandId, SAME entity id, fresh
  idempotencyKey when payload changed; `DEVICE_REVOKED`/`TENANT_SUSPENDED` = no
  resubmission, administrative surface.

## 9. Expo chaos profile + security drills (T13) — binding

- `apps/api/src/__db__/sync/expo/`: `expo-device.ts` factory (`ReferenceDevice` over the
  REAL mobile store on a temp SQLite file via the node driver — expo-sqlite is the same
  SQLite engine; honest note: cipher profile on-device only), `expo-chaos.spec.ts` (the
  full C-01…C-16 matrix shapes re-driven, dedicated TENANT_EXPO), `d-expo-store.spec.ts`
  (D-01 revocation purge incl. personal class; D-02 store inspection [structure-level in
  sandbox, honest cipher note]; D-04 7-day watermark degradation), battery/connectivity
  fault profiles (`FaultTransport` modes: airplane windows, Doze-deferred backgrounds,
  mid-sync kills) with C-02/C-05/C-06/C-07/C-13 emphasized per SYNC_TESTS §5.
- Kill-matrix: reuse the desktop real-SIGKILL harness shape against the mobile store
  process (boot/pre-commit/post-commit-pre-ack/mid-pull) → WAL recovery, IN_FLIGHT→QUEUED,
  convergence, duplicate:true replays.
- Authorization: personal device cannot pull/render outside its linked partner —
  tampered-client attempts included (fabricated cursors, wrong entity types);
  `SYNC_ENTITY_NOT_PULLED` for out-of-group pulls.
- Budgets: expo dir ≤ 10 min; sync suite ≤ 15 min.

## 10. Release engineering + docs (T12/T15) — binding

- `mobile-release.yml`: tag `v*` → job `android-release` on `ubuntu-latest`: checkout →
  pnpm/node setup → install (root, frozen) → install `apps/mobile/native` (expo deps) →
  `pnpm check:mobile-shell` → typecheck/lint/test gates → EAS build (profile production;
  honest signing placeholders warn-and-continue, S-15 family documented) → SBOM → artifact
  upload → assemble staged-rollout config (10/50/100 + crash gates) + min-version
  manifest. Structural spec test asserts step order (in-sandbox).
- Docs: `docs/operations/MOBILE_QUICKSTART.md` (new), rollout + minimum-version runbook
  entries in DEPLOYMENT.md §7 + TROUBLESHOOTING.md, DEVELOPMENT_SETUP mobile section,
  FEATURE_CATALOG `offline.android_app` + `offline.mobile_accounts` → implemented,
  IMPLEMENTATION_STATUS (PHASE-022 → COMPLETE), PHASE_ACCEPTANCE_CRITERIA criteria copy,
  CHANGELOG + CURRENT_STATE, i18n-parity docs note for the mobile gate. `docs:validate`
  green.

## 11. Task order & agent waves (binding)

| Wave | Task ID | Scope | Depends |
|---|---|---|---|
| 1 | `1-a` | Expo scaffold: package/tsconfig/eslint/vitest + RN logical-props lint ban + depcruise exception + native/ skeleton + install | — |
| 1 | `1-b` | Theme: tokens mirror + primitives + `check:mobile-tokens` root gate | 1-a (package exists) |
| 1 | `1-c` | i18n: dictionaries + runtime + bidi + `check:mobile-i18n` root gate | 1-a |
| 1 | `1-d` | Server: FEED_GROUPS activation + pull-feed entities + capability rows + `0033` if needed | — |
| 2 | `2-a` | Mobile store (driver port, node driver, migrations field/personal, prune, corruption) + sync transport/host/triggers/budgets | 1-a |
| 2 | `2-b` | Auth/device: registration/enrollment/session/refresh-rotation/unlock/trust/watermark + revocation purge | 2-a |
| 2 | `2-c` | Server intents: receipt/van-confirm/credit-note + field-intents contracts + spec | 1-d |
| 2 | `2-d` | FCM skeleton: channel port + adapter + token opt-in + templates + fake-FCM tests | 1-d |
| 2 | `2-e` | Field-sales flows (state machines + prevalidation + screens) | 1-b, 1-c, 2-a |
| 3 | `3-a` | Expo chaos profile + kill-matrix + D-01/02/04 + fault profiles | 2-a, 2-b, 2-c |
| 3 | `3-b` | Companion + personal + rejection UX screens + authorization tests | 2-b, 2-e |
| 4 | `4-a` | Release engineering: eas.json + native package + mobile-release.yml + release-policy + structural CI test | 2-a |
| 4 | `4-b` | Docs + registries + completion report draft + final gate sweep | all |

- **Per-wave gates:** every wave runs `pnpm typecheck && pnpm lint` + targeted vitest
  (`pnpm --filter @erp/mobile test`, `--filter @erp/api run src/__db__/sync/...`).
  W2+ adds `pnpm lint:depcruise`, `pnpm check:permissions-drift`, `pnpm docs:validate`,
  `pnpm check:mobile-tokens`, `pnpm check:mobile-i18n`, `pnpm check:capabilities-matrix`.
  W4 adds full `pnpm test:db`, `pnpm check:mobile-shell`, `pnpm check:rls`,
  `pnpm check:i18n-parity` (web gate must stay 3244=3244).
- **Evidence:** `agent-ctx/T-P22-<taskid>.md` per task (Files / Binding mechanics applied /
  Test evidence verbatim / Gates all green / Deviations / Handoff notes) — the T-P21 shape.
- **Baseline preservation:** sync-core 36/36 byte-identical; web i18n 3244=3244; the 021
  desktop suites stay green (no desktop file touched except shared contracts additions).

## 12. Out of scope (review blockers if implemented)

- iOS anything (ADR-0014 — config-only later, needs its own decision record).
- Any change to the sync wire protocol (frozen by 020) or to `packages/sync-core` source.
- Personal-account online payments (OQ-007 open) or ANY personal-account write path.
- Offline queuing of ONLINE-ONLY rows (approvals, posting, period ops, admin, reports,
  e-invoicing) — disabled-with-reason only.
- The full back-office UI on mobile (ADR-0014 scope discipline).
- SMS channel; Bluetooth POS printers (bare-workflow escape hatch only via a new decision
  record).
- iOS push (APNs) — FCM skeleton only this phase.
