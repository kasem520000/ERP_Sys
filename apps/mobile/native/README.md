# apps/mobile/native — the Expo glue (device side)

PHASE-022 ([ADR-0014], [DR-P22-01] in the [MASTER-PLAN §1]): this directory is
the **device-side glue** of `@erp/mobile` — the exact `apps/desktop/src-tauri`
precedent applied to Expo instead of Tauri:

| Concern | Rule |
|---|---|
| pnpm workspace | **NOT a workspace member.** `pnpm-workspace.yaml` excludes `apps/mobile/native` explicitly (`!apps/mobile/native`); the root `pnpm install` never installs `expo` or any expo-* module (verified: `pnpm -r list` shows zero expo packages). |
| TypeScript | **Excluded from `apps/mobile/tsconfig.json`** (`exclude: ["node_modules", "dist", "native"]`) — like `src-tauri` before it. |
| Who installs it | **EAS CI only** (`.github/workflows/mobile-release.yml`, T-P22-4-a — see the EAS flow below). |
| Sandbox validation | `pnpm check:mobile-shell` (T-P22-4-a) — structural checks only: the expo toolchain declaration, the entry-point wiring, the app.config/eas keys, the screen registry, the screen import surface, the workspace boundary. Nothing here compiles or runs in the dev sandbox (no Android SDK / EAS CLI / expo toolchain — the k6 precedent). |
| Application logic | **Never here.** ALL logic (theme, i18n runtime, auth/session, store, sync host, flows, rejection UX, release policy) is pure TypeScript in [`apps/mobile/src/`](../src) and vitest-tested on Node. RN screens in `src/screens/**` import only `react`/`react-native` + `@erp/mobile` internals. |

## The EAS flow (T-P22-4-a — how CI builds this)

`.github/workflows/mobile-release.yml` (tag `v*`) builds the app on
`ubuntu-latest` (which ships the Android SDK the EAS local build needs):

1. **Workspace install (frozen)** — `pnpm install --frozen-lockfile` at the
   repo root. `expo` is NEVER installed here (this dir is excluded from the
   workspace); the workspace provides `@erp/mobile` +
   `@erp/contracts`/`@erp/domain-core`/`@erp/sync-core` + react/react-native.
2. **Gates** — `@erp/mobile` typecheck/lint/test, `pnpm check:mobile-shell`,
   `pnpm check:mobile-tokens`, `pnpm check:mobile-i18n`.
3. **Native install** — `pnpm install --no-frozen-lockfile` IN THIS DIR
   (`cd apps/mobile/native`). The package manager is pinned by this
   package's `"packageManager": "pnpm@9.15.9"` field (corepack respects it on
   the runner); `--no-frozen-lockfile` because no lockfile is committed for a
   package the workspace never installs — EAS resolves the toolchain fresh
   per build (the `~52`/`~15.x` tilde ranges).
4. **Signing + FCM provisioning** (warn-and-continue, the desktop signtool
   precedent) — from [SECRETS_MANAGEMENT] S-15-family GitHub secrets:
   `ANDROID_KEYSTORE_BASE64`/`ANDROID_KEYSTORE_ALIAS`/
   `ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_PASSWORD` →
   `native/credentials.json` + `native/release.jks` (the EAS local-build
   credentials); `FCM_PROJECT_ID`/`FCM_APP_ID`/`FCM_API_KEY` →
   `native/google-services.json` (prebuild injects it when present; the
   SERVER-side FCM service-account pair lives with the API's FCM adapter
   config — task 2-d, never in this workflow). Every seam emits `::warning::`
   and continues when unset — an unsigned internal build is fine for QA,
   **never for Play Store GA**.
5. **EAS build** — `eas build --platform android --profile production` from
   the EAS project root (`apps/mobile` — `eas.json` + `app.config.ts` +
   `metro.config.js` live there; the app ENTRY is this dir's `App.tsx` via
   `apps/mobile/package.json` `"main"`). `EXPO_TOKEN`
   (`secrets.EXPO_TOKEN`) authenticates remote credentials; a fully local
   `credentials.json` from step 4 builds without it.
6. **Artifacts** — CycloneDX SBOM + the apk/aab from the Gradle outputs, the
   staged-rollout config (10/50/100 + the 99.5/99.7/98.5 gates), and the
   release manifest carrying `minVersion` (the force-update input consumed
   by `../src/release`).

Honest limitation (recorded in the workflow + the T-P22-4-a evidence): the
sandbox validates the pipeline **structurally** (the
`apps/mobile/__tests__/mobile-release-ci.test.ts` spec) — EAS itself only
executes on real runners; the metro monorepo wiring (`metro.config.js` —
watchFolders/nodeModulesPaths over the pnpm layout) is verified on the first
real EAS run.

## Contents

- `package.json` — declares the expo toolchain versions (expo ~52, expo-sqlite,
  expo-secure-store, expo-local-authentication, expo-notifications,
  expo-background-fetch, expo-task-manager, react 18.3.1, react-native 0.76.5)
  for EAS, plus the `"packageManager"` pin. **Declared, never installed in the
  sandbox.**
- `App.tsx` — the expo entry (`registerRootComponent`); the navigation +
  driver glue TODO is documented in the file header (the screen waves' DR
  follow-up).
- `drivers/` — the device implementations of the `src/` ports (see
  [`drivers/README.md`](drivers/README.md)).

[ADR-0014]: ../../../docs/architecture/ADR/ADR-0014-android-expo.md
[MASTER-PLAN §1]: ../../../agent-ctx/PHASE-022-MASTER-PLAN.md
[SECRETS_MANAGEMENT]: ../../../docs/security/SECRETS_MANAGEMENT.md
