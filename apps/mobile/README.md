# apps/mobile — `@erp/mobile` (the TS runtime) + `native/` (the Expo glue)

PHASE-022 ([ADR-0014]) Android application — **ONE app, TWO capability
experiences** (`android-field` field sales + `android-personal` companion) —
split per the binding architecture decision ([MASTER-PLAN §1 item 1],
DR-P22-01):

| Layer | Location | Language | Tested where |
|---|---|---|---|
| **ALL application logic** — golden constants, theme/tokens mirror, i18n runtime, auth/session, device registration/trust, SQLite store (field + personal profiles), sync host over **UNMODIFIED** `@erp/sync-core`, field-sales flow state machines, rejection UX, notifications client, release policy, RN screens | `src/**` (workspace package `@erp/mobile`) | TypeScript | `pnpm --filter @erp/mobile test` — vitest on Node: pure-TS suites for logic; RN screens render-test via `react-test-renderer`/`@testing-library/react-native` (see the JSX deferral note below) |
| **Thin device shell** — expo entry, driver registration (secure-store, sqlite/unlock/trust/notifications/background-scheduler/barcode), navigation glue, background-fetch task | `native/**` | TypeScript + Expo/RN toolchain | **not compiled in the dev sandbox** (no Android SDK / EAS CLI — the `src-tauri` precedent) — `pnpm check:mobile-shell` (added by a later PHASE-022 task) validates the structural invariants; EAS CI (`.github/workflows/mobile-release.yml`) installs + compiles it for real |

## The DR-P22-01 pattern (why two dirs)

The ADR-0013 "Rust stays confined to plugins" pattern applied to Expo:

- `apps/mobile/package.json` is a normal pnpm workspace member whose
  dependencies are pure JS: `@erp/contracts`, `@erp/domain-core`,
  `@erp/sync-core`, `react` 18.3.1, `react-native` 0.76.x + test tooling —
  **never** `expo*` (depcruise `mobile-imports-only-contracts-domain-core`
  stays green; RN never imports `packages/ui`).
- `apps/mobile/native/package.json` declares the expo toolchain
  (`expo ~52`, `expo-sqlite`, `expo-secure-store`, `expo-local-authentication`,
  `expo-notifications`, `expo-background-fetch`, `expo-task-manager`) but is
  **NOT a pnpm workspace member** (`pnpm-workspace.yaml` excludes it via
  `!apps/mobile/native`; the root install never installs expo — verified:
  `pnpm -r list --depth -1 | grep expo` is empty). EAS CI installs it
  standalone before `eas build` (task 4-a).
- All native access crosses a **port** boundary: interfaces in
  `src/**` (e.g. `SecureStorePort`, `SqliteDriverPort`, `UnlockPort`), device
  implementations in `native/drivers/**`. Tests always inject fakes; drivers
  never contain business logic. `native/` is excluded from
  `apps/mobile/tsconfig.json` (the `src-tauri` precedent).
- `app.config.ts` + `eas.json` + `metro.config.js` are **source-only**: read
  by the native toolchain/EAS, never by the sandbox install.
- **The app entry is `native/App.tsx`**: `apps/mobile/package.json` `"main"`
  points there (metro resolves the entry from the project-root package.json).
  The library surface stays on the `"exports"` map (`"." → ./src/index.ts`),
  so workspace consumers (vitest, the expo chaos harness, typecheck) never
  follow the entry — the T-P22-4-a release wiring.

## Dev quickstart (sandbox / any machine)

```bash
pnpm install                              # expo is NOT installed (native/ is excluded)
pnpm --filter @erp/mobile test            # vitest on Node (logic + render smoke)
pnpm --filter @erp/mobile typecheck       # tsc --noEmit (strict; src only)
pnpm --filter @erp/mobile lint            # incl. the DR-P22-03 RTL ban (below)
pnpm lint:depcruise                       # boundary rules, 0 violations
```

## Boundary rules that apply here

- **depcruise** (`pnpm lint:depcruise`): `mobile-never-imports-other-clients`
  (no `apps/web`/`apps/desktop`), `mobile-imports-only-contracts-domain-core`
  (no `packages/ui`, no `packages/config` from src), plus the blanket
  client/API bans. The `api-never-imports-clients` rule carves out exactly
  one test-harness exception: `apps/api/src/__db__/sync/expo/**` (the expo
  chaos profile, task 3-a — the desktop precedent).
- **ESLint (DR-P22-03, RTL):** physical-direction React Native style props are
  **banned** in `apps/mobile/src/**` — `marginLeft|marginRight|paddingLeft|
  paddingRight|borderLeftWidth|borderRightWidth|borderLeftColor|borderRightColor`
  (+ `left`/`right` as style keys) and `textAlign: 'left'|'right'` are lint
  ERRORS. Use the logical props (`marginStart/marginEnd/paddingStart/
  paddingEnd/start/end/borderStartWidth/borderEndWidth/textAlign 'start'|'end'`)
  per [RTL_DESIGN_RULES §1] — the RN port of `erp/no-physical-direction`.
  Sanctioned exceptions carry an inline `// rtl-exempt: <reason>` comment.
- **eslint boundaries plugin**: `apps-mobile` element may import
  `packages-contracts` + `packages-domain-core` only.
- **tsconfig**: `native/` is excluded — never typecheck the glue dir with the
  workspace config.

## Honest-deferral doctrine (what compiles where)

The sandbox has **no Android SDK, emulator, device, EAS CLI or expo
toolchain** — the PHASE-021 k6/Windows precedent applied to Android:

- Everything TypeScript under `src/**` is real code with real tests on Node
  (never a silent skip).
- The Android hardware surfaces (on-device chaos drills, SQLCipher cipher
  inspection on device, Play Store signing, visual snapshot gallery,
  scan-to-cart camera measurement) ship as **source + CI wiring + honest
  deferral notes**; the EAS pipeline (`mobile-release.yml`, task 4-a)
  compiles and exercises what the sandbox cannot.
- **JSX render tests — recorded observation (feeds a DR-P22-xx):** the
  `react-native` package itself ships Flow syntax (`import typeof …` +
  `@flow strict-local` Library sources) that Node/esbuild refuse to parse, so
  rendering RN *component trees* (View/Text) under vitest needs a
  flow-stripping transform pipeline (see `__tests__/scaffold-jsx.test.tsx`
  for the full note + the candidate wiring). Until that lands, in-sandbox
  render tests validate the JSX pipeline + pure-React components; RN
  component-tree + pixel assertions defer to EAS/device profiles.

## Documentation map

- [ADR-0014 — Android Application on React Native + Expo][ADR-0014] ·
  [PHASE-022 phase doc]
- [MASTER-PLAN §1 DR-P22-01][MASTER-PLAN §1] (the split) ·
  [RTL_DESIGN_RULES §1][RTL_DESIGN_RULES] (logical props)
- [LOCAL_DATABASE] (mobile store subset, budgets, pruning) ·
  [SYNC_PROTOCOL] (feeds, budgets, schedule) ·
  [OFFLINE_CAPABILITIES_MATRIX] (android rows)
- `docs/operations/MOBILE_QUICKSTART.md` (W4, task 4-b)

[ADR-0014]: ../../docs/architecture/ADR/ADR-0014-android-expo.md
[PHASE-022 phase doc]: ../../docs/implementation/phases/PHASE-022.md
[MASTER-PLAN §1]: ../../agent-ctx/PHASE-022-MASTER-PLAN.md
[RTL_DESIGN_RULES]: ../../docs/ui/RTL_DESIGN_RULES.md
[LOCAL_DATABASE]: ../../docs/offline/LOCAL_DATABASE.md
[SYNC_PROTOCOL]: ../../docs/offline/SYNC_PROTOCOL.md
[OFFLINE_CAPABILITIES_MATRIX]: ../../docs/offline/OFFLINE_CAPABILITIES_MATRIX.md
