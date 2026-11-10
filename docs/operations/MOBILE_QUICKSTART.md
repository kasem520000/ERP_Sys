# Mobile Quickstart

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-05

The developer loop for the ERP Android application — the Expo/React Native app delivered by
PHASE-022 ([ADR-0014](../architecture/ADR/ADR-0014-android-expo.md); scope and acceptance in
[../implementation/phases/PHASE-022.md](../implementation/phases/PHASE-022.md)). **ONE app,
TWO capability experiences** — `android-field` (van sales, collections, route visits, counts,
returns) and `android-personal` (the read-only partner companion) — with role/capability
scoping at device registration, never by build variant. Everything application-level is
**TypeScript on plain Node** (real temp-dir SQLite stores, real Ed25519 attestation, real
render tests through `@testing-library/react-native`): nothing in the inner loop needs the
Android SDK, an emulator, or the Expo CLI. The monorepo-wide bootstrap (database, compose
stack, env file) is [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) — this page only adds the
mobile-specific loop on top of it.

## 1. Prerequisites

| Tool | Version | Why | Check |
|------|---------|-----|-------|
| Node.js | 22 LTS+ | the `@erp/mobile` TS runtime + vitest (`.nvmrc` pins 22.12.0) | `node -v` |
| pnpm | 9.15.9 | workspace package manager (root `packageManager` pin) | `pnpm -v` |
| Android toolchain | **only for device builds** (§5) | SDK + JDK for `eas build --local` / Android Studio runs; NOT needed for the test loop | — |
| Expo CLI / EAS CLI | **only for device builds** (§5) | installed by the release workflow inside `apps/mobile/native` | — |

Bootstrap is the standard monorepo one: `pnpm install`. **Expo is never installed by that
command** — `apps/mobile/native/` is excluded from the pnpm workspace (§2), so the root
install stays pure-JS (`react` 18.3.1 + `react-native` 0.76.x install and run on Node; the
expo-* device modules live only in `native/package.json`).

## 2. The two-layer structure (DR-P22-01)

The ADR-0013 "Rust stays confined to plugins" pattern applied to Expo — the split is
binding ([master plan §1](../../agent-ctx/PHASE-022-MASTER-PLAN.md) item 1):

| Layer | Location | Tested where |
|---|---|---|
| **ALL application logic** — golden constants, theme/tokens mirror, i18n runtime, auth/session, device registration/trust, SQLite store (field + personal profiles), sync host over **UNMODIFIED** `@erp/sync-core`, field-sales flow state machines, rejection UX, companion/personal view models, notifications client, release policy, RN screens | `apps/mobile/src/**` (workspace package `@erp/mobile`) | `pnpm --filter @erp/mobile test` — vitest on Node: pure-TS suites for logic; the RN screens render-test for real through `react-test-renderer`/`@testing-library/react-native` (the vitest Flow bridge strips react-native's Flow syntax) |
| **Thin device shell** — expo entry (`native/App.tsx`), driver registration (secure-store, sqlite, unlock, trust, notifications/fcm, background-scheduler, barcode-scanner), navigation glue, the background-fetch task | `apps/mobile/native/**` + `app.config.ts` + `eas.json` + `metro.config.js` | **not compiled in the dev sandbox** (the `src-tauri` precedent) — `pnpm check:mobile-shell` validates the structural invariants (§4); the EAS CI pipeline installs + compiles it for real (§5) |

All native access crosses a **port** boundary: interfaces in `src/**`
(`SecureStorePort`, `SqliteDriverPort`, `UnlockPort`, `TrustSignalsPort`, …), device
implementations in `native/drivers/**`. Tests always inject fakes; drivers never contain
business logic. Boundary rules that apply here: `mobile-never-imports-other-clients` and
`mobile-imports-only-contracts-domain-core` (depcruise — `@erp/mobile` may import only
`@erp/contracts`/`@erp/domain-core`/`@erp/sync-core` + react/react-native, **never**
`packages/ui`), and the ESLint **DR-P22-03 RTL ban** — physical-direction style props
(`marginLeft`/`paddingRight`/`left`/… and `textAlign: 'left'|'right'`) are errors in
`apps/mobile/src/**`; use the logical props (`marginStart/marginEnd/paddingStart/
paddingEnd/start/end/textAlign 'start'|'end'`), with `// rtl-exempt: <reason>` as the
sanctioned escape. The full local map is [`apps/mobile/README.md`](../../apps/mobile/README.md).

## 3. Running the suite

```bash
pnpm --filter @erp/mobile test         # 27 files / 393 tests green on Node — constants,
                                       #   theme/primitives (real renders, a11y, ≥44px
                                       #   targets, AR/EN direction), i18n parity, store +
                                       #   prune + corruption, transport/host/triggers/
                                       #   revocation, auth/session/enroll/unlock/trust/
                                       #   watermark/secure-screen, field-sales flows +
                                       #   screens, companion/personal/rejection UX,
                                       #   release policy + rollout gates, the CI
                                       #   structural test
pnpm --filter @erp/mobile typecheck    # tsc --noEmit (strict; src only — native/ excluded)
pnpm --filter @erp/mobile lint         # the repo shared config incl. the DR-P22-03 ban
```

Golden constants live in `apps/mobile/src/constants.ts` (the zero-import leaf: the 128 MB
storage budget, the 2-min/15-min/5-s sync schedule, the 8 MB/2 MB/256 KB bandwidth
budgets, the 10/50/100 rollout stages + crash gates, the 44 px touch floor, the 2% field
price tolerance) — specs import them; never hard-code the numbers. The server-side
substrate the app talks to is proven by the api sync suite
(`apps/api/src/__db__/sync/` — pull-fields/pull-personal/field-intents/expo chaos,
embedded PostgreSQL 16 via `pnpm test:db`).

## 4. The mobile gates

| Gate | What it proves |
|------|----------------|
| `pnpm check:mobile-tokens` | design-token parity: the RN mirror in `apps/mobile/src/theme/tokens.ts` re-declares the canonical `packages/ui/src/tokens/` values byte-identically (130/130) and derives the RN adaptations from them (50/50) — no raw design values in RN code |
| `pnpm check:mobile-i18n` | AR/EN dictionary parity for the mobile catalog (`apps/mobile/src/i18n/dictionaries.ts`): ar=en=371 keys, no empty values (the mobile twin of the web `check:i18n-parity`, which stays at ar=en=3244) |
| `pnpm check:mobile-shell` | the structural shell gate (7 sections): the `native/` toolchain declaration vs the workspace pins, the `native/App.tsx` entry + planned wiring, `app.config.ts`/`eas.json` invariants (android-only, `com.erp.field`, preview/production profiles), the screen registry (every `*Screen.tsx` registered, no orphans), screen imports (allowlist only), the workspace boundary (`native/` never installed, zero expo deps in `@erp/mobile`), and the DR-P22-02/03 spot-checks (no raw hex, no physical-direction props) |
| `pnpm lint:depcruise` | the boundary rules above stay at 0 violations |

## 5. The EAS / device-build flow

The release pipeline (`.github/workflows/mobile-release.yml`, tag `v*`) compiles what the
dev sandbox cannot — the step order is structurally asserted by
`apps/mobile/__tests__/mobile-release-ci.test.ts`:

1. Root `pnpm install --frozen-lockfile` + the `@erp/mobile` quality gates
   (typecheck/lint/test) + `check:mobile-shell` + `check:mobile-tokens` +
   `check:mobile-i18n` — every pnpm-level gate runs first.
2. **Native install**: `pnpm install --no-frozen-lockfile` inside `apps/mobile/native`
   (the only place the expo toolchain — expo ~52, expo-sqlite, expo-secure-store,
   expo-local-authentication, expo-notifications, expo-background-fetch,
   expo-task-manager — enters a node_modules).
3. S-15/FCM provisioning (warn-and-continue placeholders — see
   [../security/SECRETS_MANAGEMENT.md](../security/SECRETS_MANAGEMENT.md) S-15):
   `ANDROID_KEYSTORE_BASE64/ALIAS/PASSWORD/KEY_PASSWORD` → `native/credentials.json` +
   `native/release.jks`; `FCM_PROJECT_ID/APP_ID/API_KEY` → `native/google-services.json`.
4. `eas-cli build --platform android --profile production --local` from the project root
   (entry `native/App.tsx` via the package.json `main`; the library surface stays on the
   `exports` map). Missing secrets warn loudly and skip honestly — an unsigned artifact is
   the internal channel only, never GA.
5. CycloneDX SBOM → apk/aab upload → the staged-rollout config + the release manifest
   (`minVersion` starts at the release version; the halt remedy bumps it to
   last-known-good — [DEPLOYMENT.md](DEPLOYMENT.md) §7).

A second workflow job (`device-farm`, `workflow_dispatch`-gated) documents the on-device
matrix (chaos C-06/C-07/C-13 + the D-02 cipher inspection) — it requires an Android runner
with an emulator matrix (§6). Local device builds follow the same shape: install
`apps/mobile/native`, then `eas build` or `npx expo run:android` from the project root.

## 6. The honest-deferral doctrine (what proves what)

The PHASE-021 k6 precedent applied to Android — **real artifacts + real tests for
everything TypeScript, honest deferral notes for what needs Android hardware, never a
silent skip**:

| Proven in the sandbox (Node) | Deferred to EAS CI / the device farm |
|---|---|
| The full logic suite (27 files / 393 tests) incl. REAL renders of every screen (AR/EN, a11y labels, ≥44 px targets, logical-props-only styles — tree-level parity) | The compiled APK/AAB (Play Store signing, EAS build) |
| The expo chaos profile on the REAL mobile store (temp SQLite files via the node driver — expo-sqlite is the same engine): the full C-01…C-16 matrix (+C-11b), real-SIGKILL kill-matrix windows, D-01/D-02/D-04 drills, battery/connectivity fault profiles (`apps/api/src/__db__/sync/expo/`) | The on-device legs: C-06/C-07/C-13 on hardware, the SQLCipher cipher inspection (D-02) on the encrypted profile |
| The release policy + rollout gates (calver comparison, force-update decision, 10/50/100 + the crash thresholds) with boundary tests | The live Play Console staged rollout + crash-rate dashboards |
| `check:mobile-shell` (the structural invariants of `native/` + the workflow) | The metro monorepo wiring on the first real EAS run |

Pixel-level visual snapshots and the T-03 scan-to-cart measurement (< 2 s on a mid-range
reference device) also belong to the device/CI column — tree-level parity + the structural
gates are the sandbox's proof. The deferral list is recorded in full in the
[completion report](../implementation/phases/reports/PHASE-022-COMPLETION.md).

## 7. Command map

| Command | What it does |
|---------|--------------|
| `pnpm --filter @erp/mobile test` | the TS runtime suite — 27 files / 393 tests (logic + real screen renders) |
| `pnpm --filter @erp/mobile typecheck` / `lint` | strict tsc / the shared ESLint config incl. the DR-P22-03 RTL ban |
| `pnpm check:mobile-tokens` | design-token parity gate (130/130 + 50/50 derivations) |
| `pnpm check:mobile-i18n` | mobile dictionary parity gate (ar=en=371) |
| `pnpm check:mobile-shell` | the structural shell + screen-registry gate (EAS CI compiles the real thing) |
| `pnpm lint:depcruise` | the mobile boundary rules (`mobile-never-imports-other-clients`, `mobile-imports-only-contracts-domain-core`) |
| `pnpm test:db` | the api sync/chaos suites incl. the expo profile (embedded PostgreSQL 16) |

Related runbooks: background-fetch reality (Doze), sync budgets, the force-update path,
device revocation UX — [TROUBLESHOOTING.md](TROUBLESHOOTING.md) §android. Play Store
staged rollout + minimum-version enforcement:
[DEPLOYMENT.md](DEPLOYMENT.md) §7. Design authority:
[ADR-0014](../architecture/ADR/ADR-0014-android-expo.md); mechanics:
[PHASE-022 master plan](../../agent-ctx/PHASE-022-MASTER-PLAN.md);
evidence: [PHASE-022-COMPLETION.md](../implementation/phases/reports/PHASE-022-COMPLETION.md).
