# PHASE-022 — Android Application

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-022
- **Title:** Android Application
- **Objective:** Ship the Expo / React Native Android client
  ([ADR-0014](../../architecture/ADR/ADR-0014-android-expo.md)) as ONE app with two
  experiences scoped at device registration: (a) the **tenant user companion** —
  dashboards, statements, and approvals on the go (approvals ONLINE-ONLY per the
  matrix), including the **field sales** workload (van stock snapshot, route visits,
  OFFLINE-COMPLETE van sales/collections through the PHASE-020 sync protocol under
  Android background constraints); and (b) the **personal-accounts mode** for tenants'
  customers and suppliers — balance, statement, invoices, receipts, due dates from
  cached read-only data. The app is RTL-first (`I18nManager` + logical style props)
  with design tokens ported from [DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md), stores
  credentials in SecureStore with optional biometric unlock, and rolls out through the
  Play Store with staged rollout and minimum-version enforcement.
- **Business value:** van-sales reps and collectors keep selling through hours-long
  route dead zones (the offline value promise), owners watch the business from their
  pocket, and tenants' customers self-serve statements — the first three audiences of
  the multi-platform release ([RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md)
  v2.0 multi-platform tier).

## 2. Scope

In scope:

1. **Expo app scaffold** per ADR-0014: Expo toolchain with dev-client (bare-workflow
   escape hatch documented for hardware integrations); shares `packages/contracts`,
   `packages/domain-core`, and `packages/sync-core` ONLY — the UI is React Native
   primitives implementing the same design tokens and page archetypes
   ([PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md)), never the web DOM components.
2. **Field-sales experience** (matrix Android-field column; journeys G —
   [USER_JOURNEYS.md](../../product/USER_JOURNEYS.md)): READ-CACHED van stock snapshot
   (`van_stocks` projection), route customers (`routes`), rep settlement template;
   **OFFLINE-COMPLETE** field collection receipts (row 9), van load/unload
   confirmations (row 12), and van-sale capture with LOCAL-VALID pre-validation
   against snapshots (rows 6/7/23 LOCAL-VALID†: sales invoice draft, quotation draft,
   partner create — cached credit/van-stock checks advisory, server decides);
   OFFLINE-DRAFT credit notes for customer returns (row 27) and count lines (row 11);
   honest `PENDING_SYNC → POSTED / REJECTED(editable)` state machines rendered
   distinctly.
3. **Tenant companion screens**: dashboards and customer statement views READ-CACHED
   (rows 13/14/33); approval actions reachable but ONLINE-ONLY (row 16 — disabled with
   reason when offline, never queued); master-data search from cache.
4. **Personal-accounts mode** (rows 13, 14, 28, 29): linked-partner authorization
   resolved server-side — the device cannot pull other partners' rows
   ([LOCAL_DATABASE.md](../../offline/LOCAL_DATABASE.md) §1.1 rule 2); balance,
   statement, issued invoices, receipts, due dates, notification cache — READ-CACHED
   with as-of labels; **no offline writes** (read-only device class, no outbox);
   personal-account online payments remain deferred (row 28, OQ-007 decision pending).
5. **Device registration & security** per
   [SECURITY_AND_DEVICE_MANAGEMENT.md](../../offline/SECURITY_AND_DEVICE_MANAGEMENT.md):
   registration as `android` platform with capability subset (`van_sales`,
   `personal_account`); attestation-lite keypair; **Expo SecureStore** (Android
   Keystore) for refresh token, device private key, and the SQLCipher DB key;
   **biometric unlock optional** (ADR-0014 §3) with PIN fallback; access tokens
   memory-only; screenshots/screen-recording disabled on financial screens; rooted/
   tampered-device best-effort detection recorded to `devices.trustFlags` with
   degrade-to-online-only policy (never brick on false positives).
6. **Local store**: expo-sqlite with SQLCipher encryption option + app-sandbox storage
   as second layer; `sync-core` schema/migrations applied at app start; the Android
   field subset (POS subset + van stock + routes + statements,
   LOCAL_DATABASE §1.1); LRU pruning within the 128 MB budget.
7. **Android sync scheduling** per [SYNC_PROTOCOL.md](../../offline/SYNC_PROTOCOL.md)
   §8: foreground cycle every 2 min when dirty; **background fetch OS-scheduled
   ≤ every 15 min** respecting Doze/battery constraints; connectivity-regained cycle
   debounced 5 s; DEFERRED honors `retryAfterMs`; cellular bandwidth budgets (pull
   ≤ 8 MB, push ≤ 2 MB per cycle; personal-account background pulls ≤ 256 KB).
8. **RTL-first implementation**: `I18nManager.forceRTL` under `ar`, logical style
   props only, mirroring rules per [RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md)
   ported to RN; digits policy (identifiers/numbers `latn`; tenant-configurable
   `arab` display), Arabic-first strings with EN parity.
9. **Push notifications adapter (FCM) skeleton**: `NotificationChannelPort`
   implementation skeleton per [integrations/README.md](../../api/integrations/README.md)
   §3.5 — device tokens opt-in per device from the device registry; template + locale
   resolved before the call; best-effort delivery with retry + per-tenant quota. This
   phase ships the client-side wiring + server adapter skeleton, not marketing
   campaigns.
10. **Release engineering**: Play Store staged rollout (10% → 50% → 100% with
    crash-rate gates reading the client-stability dashboard), **minimum-version
    enforcement** (force-update path), app signing keys (S-15 family,
    [SECRETS_MANAGEMENT.md](../../security/SECRETS_MANAGEMENT.md)), crash reporting
    with tenant tag.
11. **Contract-version gate** on pull/push: `CONTRACT_VERSION_UNSUPPORTED` → read-only
    sync mode + Play Store update prompt; stale server → refuse local writes.

Out of scope (explicit):

- iOS (out of initial market scope, ADR-0014 — a later decision record; mostly config
  + review, not a rewrite).
- Any change to the sync protocol (frozen by PHASE-020).
- Offline writes for personal accounts, personal-account online payments (OQ-007
  deferred; row 28), and any ONLINE-ONLY row (approvals, posting, period ops, admin,
  reports, e-invoicing).
- Full back-office UI on mobile (ADR-0014 scope discipline — no attempt to replicate
  the web ERP).
- SMS channel (providers TBD per market, post-phase), Bluetooth POS printers
  (bare-workflow escape hatch only if a design partner demands it — decision record).

## 3. Prerequisites

- Required phases: **PHASE-020 — Offline Synchronization Foundation** COMPLETE
  (`packages/sync-core` v1, device registry, contracts, chaos matrix green — verified
  via completion report + CI). PHASE-017's distribution features (routes, van stock,
  settlements) must be COMPLETE for the field-sales experience; the personal-accounts
  mode additionally relies on PHASE-012/013 statement read models.
- Required architecture decisions:
  [ADR-0014](../../architecture/ADR/ADR-0014-android-expo.md) (Expo/RN, shared
  non-UI packages, SecureStore, FCM post-MVP port),
  [ADR-0012](../../architecture/ADR/ADR-0012-offline-sync.md),
  [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md),
  [ADR-0002](../../architecture/ADR/ADR-0002-typescript-monorepo.md).
- Relevant documentation:
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md)
  (Android-field + personal-account columns),
  [LOCAL_DATABASE.md](../../offline/LOCAL_DATABASE.md) §1.1 (field/personal subsets),
  [SYNC_PROTOCOL.md](../../offline/SYNC_PROTOCOL.md) §1/§8 (registration, triggers,
  budgets), [CONFLICT_RESOLUTION.md](../../offline/CONFLICT_RESOLUTION.md) §3
  (rejection UX), [SECURITY_AND_DEVICE_MANAGEMENT.md](../../offline/SECURITY_AND_DEVICE_MANAGEMENT.md)
  (§3 keystore, §5 snapshot, §7 root posture),
  [FAILURE_RECOVERY.md](../../offline/FAILURE_RECOVERY.md) (battery/connectivity
  scenarios), [SYNC_TESTS.md](../../testing/SYNC_TESTS.md) §5/§7 (Expo device profile,
  PHASE-022 gate), [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §10
  (D-01, D-07), [DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md),
  [RTL_DESIGN_RULES.md](../../ui/RTL_DESIGN_RULES.md),
  [ACCESSIBILITY.md](../../ui/ACCESSIBILITY.md) (44 px touch, screen readers),
  [USER_JOURNEYS.md](../../product/USER_JOURNEYS.md) (Journey G),
  [FEATURE_CATALOG.md](../../product/FEATURE_CATALOG.md) (`offline.android_app`,
  `offline.mobile_accounts`), [RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md).

## 4. Design Impact

- **Database changes:** none server-side. Local SQLite: Android field subset +
  personal-account read models (no outbox/inbox tables for personal-account
  registrations — cursors/meta only, LOCAL_DATABASE §1.1). Personal-account feed
  filtering is server-side and was proven in PHASE-020; this phase only consumes it.
- **API changes:** none to core contracts; the notifications module gains the FCM
  `NotificationChannelPort` adapter skeleton + device-token registration surface
  (opt-in per device); `e_invoicing`-style new modules are NOT touched.
- **UI changes:** new RN app: onboarding/login, dashboard, statements, invoice list,
  route-visit list, van-sale capture screen (barcode scanning via camera), collection
  screen, van load/unload confirmation, reconciliation/parked-rejections screen,
  personal-account home (balance/statement/invoices/receipts/due dates), settings
  (device management, sync now, biometric toggle, language AR/EN). Archetypes follow
  [PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md) mobile notes and the navigation
  model's mobile tab bar.
- **Security & authorization:** SecureStore-only secrets; biometric gate optional;
   permission snapshot gates UI; server-final enforcement on every pushed command;
   personal-account devices receive customer-scoped tokens (read-only-own-data set,
   [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md) personal-account
   portal); rooted-device policy = online-only mode until admin acknowledgment
   (D-07); revocation UX per D-01 (stop sync, purge on next contact per lost-device
   playbook).
- **Accounting implications:** none new — van sales/collections replay through the
  existing sales/treasury services at sync (INV-013 exactly-once; INV-011 period
  checks; credit-limit checks server-side include other devices' in-flight accepted
  documents — a local check can only approximate).
- **Localization implications:** Arabic-first: all screens designed RTL-first and
  mirrored for EN; bidi isolation for mixed content; bilingual visual parity is a
  release gate; notification templates resolve locale before FCM calls.
- **Offline implications:** implements the Android-field and personal-account columns
  of the capabilities matrix; battery/connectivity fault profiles join the chaos
  harness; background-fetch constraints documented honestly in user help.
- **Module dependencies:** `apps/mobile` (Expo) depends on `packages/contracts`,
  `packages/domain-core`, `packages/sync-core`; the notifications module owns the FCM
  adapter; sync module consumed read-only. No new server module
  ([MODULE_BOUNDARIES.md](../../architecture/MODULE_BOUNDARIES.md)).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Expo project scaffold + dev-client build config + shared-package wiring (contracts, domain-core, sync-core) | `apps/mobile/**` | clean `eas build` dev-client; lint boundaries green |
| T2 | Design-token port: `--erp-*` tokens → RN theme module; core primitives (buttons, lists, badges, money text, status chips) + typography scale | `apps/mobile/src/theme/**`, `apps/mobile/src/ui/**` | token-parity test vs [DESIGN_TOKENS.md](../../ui/DESIGN_TOKENS.md) source; contrast spot checks |
| T3 | RTL/i18n runtime: `I18nManager`, logical-style lint rule (physical-prop ban), AR/EN string catalogs, digits policy | `apps/mobile/src/i18n/**` | RTL/EN parity snapshots on primitives + screens |
| T4 | SecureStore + biometric unlock + registration flow (keypair, attestation-lite, capability negotiation `van_sales`/`personal_account`) | `apps/mobile/src/auth/**`, `apps/mobile/src/device/**` | registration E2E; biometric fallback; D-01 revocation UX |
| T5 | Local store wiring: expo-sqlite + SQLCipher, `sync-core` schema/migrations, LRU pruning (128 MB), integrity + corruption path | `apps/mobile/src/store/**` | D-02-style encryption inspection; corruption drill; migration tests |
| T6 | Sync host: foreground/background scheduling (≤ 15-min background fetch, Doze-aware), connectivity trigger, budgets, contract gate + force-update path | `apps/mobile/src/sync/**` | trigger matrix tests; DEFERRED retryAfterMs honored; C-08 contract-downgrade path |
| T7 | Field-sales flows: route-visit list, van-sale capture (camera barcode + LOCAL-VALID pre-validation), collection receipt, van load/unload, returns draft, count lines — honest state machines | `apps/mobile/src/fieldsales/**` | matrix-row tests; C-09-style drain with rejects on device profile |
| T8 | Companion screens: dashboards, statements, invoice views (READ-CACHED, as-of labels), approvals ONLINE-ONLY affordance | `apps/mobile/src/companion/**` | offline read journey; approval blocked offline with reason |
| T9 | Personal-accounts mode: customer-scoped login, balance/statement/invoices/receipts/due dates, notifications cache — read-only device class | `apps/mobile/src/personal/**` | authorization tests (no other-partner rows reachable even tampered); ≤ 256 KB background pull budget |
| T10 | Rejection UX per CONFLICT_RESOLUTION §3: parked-rejections screen with per-code actions + audit-logged choices | `apps/mobile/src/reconciliation/**` | per-code action tests; audit rows carry rejecting `traceId` |
| T11 | FCM skeleton: `NotificationChannelPort` adapter + device-token opt-in + locale-resolved templates | `apps/api/src/modules/notifications/adapters/fcm/**`, `apps/mobile/src/notifications/**` | adapter contract tests against a fake FCM; opt-in default off |
| T12 | Release engineering: EAS/Play pipeline, app signing (S-15), staged rollout config, minimum-version enforcement, crash reporting | `apps/mobile/eas.json`, `.github/workflows/mobile-release.yml` | signing verification; staged-gate + force-update simulation |
| T13 | Chaos subset on device-class harness: full matrix against the Expo/SQLite profile with battery/connectivity fault profiles; C-06/C-07/C-13 on-device | `tests/sync-chaos/**` (expo profile), device farm scripts | SYNC_TESTS §7 PHASE-022 slice green |
| T14 | Component + parity test suite: RN component tests, a11y checks, AR/EN visual snapshots | `apps/mobile/__tests__/**` | suite green; flake quarantine respected |
| T15 | Docs: mobile quickstart, rollout runbook, FEATURE_CATALOG `offline.android_app`/`offline.mobile_accounts` status | `docs/operations/**`, `docs/product/**` | docs validation green |

## 6. Verification

**Automated tests (required):**

- **Sync chaos on the Expo/SQLite device-class harness**
  ([SYNC_TESTS.md](../../testing/SYNC_TESTS.md) §5: field-sales phone profile with
  battery/connectivity faults; §7 PHASE-022 row): full matrix, with **C-06 (revoked
  device), C-07 (clock skew), C-13 (tenant switch) executed on-device** (device farm
  or emulator matrix), not only in-sim.
- Revocation tests (D-01): revoke mid-queue → push rejected `DEVICE_REVOKED`, pulls
  refused, queued data purged on next contact (lost-device playbook), reconciliation
  queue lists unresolved ops.
- Tampered-build/root policy (D-07): trust flags recorded; degrade-to-online-only
  behavior verified; no lockout on false positive.
- Authorization: personal-account device cannot pull or render any row outside its
  linked partner (tampered-client attempts included); tenant-user device is bounded by
  its capability subset server-side.
- RN component tests + AR/EN parity snapshots for every screen; a11y checks (touch
  targets ≥ 44 px, screen-reader labels) per [ACCESSIBILITY.md](../../ui/ACCESSIBILITY.md).
- FCM adapter contract tests against a fake provider (locale resolution, opt-in,
  quota); no notification contains financial payloads.

**Manual verification:**

1. Register a field-sales device; pull van stock + routes; switch the phone to
   airplane mode; complete a van sale + a collection; verify `PENDING_SYNC` states and
   honest offline numbering; restore connectivity → watch drain and official numbers.
2. Seed rejections on drain (price change beyond tolerance, insufficient van stock):
   resolve each via the parked-rejections screen; verify audit trail.
3. Register a personal-account device (customer scope): confirm balance/statement/
   invoices/due dates are cached, labeled as-of, and that no write affordance exists.
4. Toggle AR ⇄ EN: verify direction, layout mirroring, digits, and bidi text in
   mixed-content rows.
5. Enroll biometric unlock, then revoke the device from admin console: verify
   next-contact purge and re-login requirement.

**Acceptance criteria (objective):**

1. One installable app serves both experiences; role/capability scoping happens at
   device registration, not by build variant (ADR-0014 rule quoted in report).
2. Full chaos matrix green on the Expo profile; C-06/C-07/C-13 evidenced on-device.
3. Every implemented Android-field/personal-account matrix cell matches its class
   (row-by-row cross-check quoted); OFFLINE-COMPLETE rows show honest
   `PENDING_SYNC → POSTED/REJECTED` machines; personal-account class has NO write path.
4. Background sync respects OS constraints: ≤ 15-min background fetch, Doze-safe,
   budgets enforced (≤ 8 MB pull / ≤ 2 MB push cellular; ≤ 256 KB personal-account
   background fetch) — schedule evidence in report.
5. Secrets exist only in SecureStore; SQLCipher key never in the DB or preferences;
   access tokens memory-only; screenshots blocked on financial screens (inspection
   evidence).
6. Biometric unlock optional with PIN fallback; permission snapshot gates UI; beyond
   the 7-day watermark the app is read-only + online-required for writes.
7. RTL parity: AR-first design with EN mirroring; parity snapshots green both
   directions; no physical-property styles in RN code (lint ban active).
8. Revocation, suspension, and contract-skew paths behave per protocol (D-01, C-14,
   C-08) with force-update via minimum-version enforcement.
9. Play Store pipeline produces a signed artifact; staged rollout 10%→50%→100% with
   crash-rate gates wired to the client-stability dashboard.
10. FCM skeleton: opt-in per device, locale-resolved templates, contract tests green;
    delivery is best-effort with retry + quota (no functional dependency on push).
11. Docs updated (quickstart, rollout runbook, FEATURE_CATALOG keys → implemented);
    docs validation green; criteria copied into
    [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).

**Performance & security considerations:** T-03 (< 2 s scan-to-cart on a mid-range
Android reference device — measured, since it gates the POS/field experience); sync
cycles cheap on battery (scheduling evidence); no PII in notifications; crash-free
sessions feed rollout gates; rooted-device detection is explicitly NOT a security
boundary (server-final enforcement), so a false positive only degrades UX.

**Migration & rollback:** local migrations forward-only via `sync-core` (contract-
mapped, cursor-reset on semantic changes); app rollback = Play Store staged rollout
halt + previous version re-promotion; force-update via minimum-version enforcement
(RELEASE_STRATEGY §Rollback); no server migrations in this phase.

## 7. Risks and Constraints

- **RISK-004** (offline expectations): van-sales users may expect real-time stock —
  the app must label snapshot as-of and surface server rejections as first-class UX,
  not surprises.
- **RISK-011** containment: `sync-core` consumed unmodified; on-device chaos slices
  (C-06/C-07/C-13) prove the RN/sqlite profile against the same oracles.
- **RISK-015** (Hijri/Arabic-numeral UX): mobile date pickers and digit rendering are
  new surface — bilingual + digit-variant snapshot tests required.
- Cheap-Android webview performance was an ADR-0014 rejection reason for Capacitor —
  any move to wrap the web app instead of RN primitives requires a new ADR.
- Background-schedule reality (Doze, OEM task killers — common on regional Android
  OEMs): documented honestly in user help; foreground cycles remain the reliability
  path; a user-facing "sync now" always exists.
- Constraint: no iOS, no personal-account payments (OQ-007 open), no full back office
  on mobile; FCM is skeleton-only in this phase.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-022-COMPLETION.md` with: chaos-slice CI
  output (incl. on-device C-06/C-07/C-13 evidence), T-03 measurement on the reference
  device, matrix row-by-row cross-check, RTL/EN parity snapshot gallery, SecureStore/
  encryption inspection, staged-rollout + force-update simulation output, FCM contract
  test results, docs validation output.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-022 →
  COMPLETE), `docs/handoff/CURRENT_STATE.md`, `docs/handoff/CHANGELOG.md`, mobile
  quickstart in [DEVELOPMENT_SETUP.md](../../operations/DEVELOPMENT_SETUP.md), rollout
  + minimum-version runbook entries ([DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7,
  [TROUBLESHOOTING.md](../../operations/TROUBLESHOOTING.md)), FEATURE_CATALOG
  `offline.android_app` / `offline.mobile_accounts` status.
- **Exit criteria:** all acceptance criteria green with evidence; v2.0 multi-platform
  release content (PHASE-020+021+022) complete per
  [RELEASE_STRATEGY.md](../../planning/RELEASE_STRATEGY.md) tiers; docs synchronized;
  zero TODOs.
- **Definition of Done:** signed Play-Store-ready artifact in `main`; both experiences
  demoable end-to-end on real hardware; chaos + parity + a11y suites green and wired
  to CI; client-stability dashboard panels live for Android.
- **Handoff instructions:** the multi-platform tier is complete; the Android column of
  the capabilities matrix is implemented — matrix changes need decision records. The
  integration phase next reuses the adapter registry and job patterns; personal-account
  payments remain blocked on OQ-007 (decision record required before any checkout
  work). **Next eligible phase: PHASE-023 — External Integrations & E-Invoicing
  Implementations.** Identify only; do not implement.
