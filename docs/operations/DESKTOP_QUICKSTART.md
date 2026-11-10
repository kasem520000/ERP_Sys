# Desktop Quickstart

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-04

The developer loop for the ERP Desktop application — the Tauri v2 shell around the web ERP
build delivered by PHASE-021 ([ADR-0013](../architecture/ADR/ADR-0013-tauri-desktop.md);
scope and acceptance in [../implementation/phases/PHASE-021.md](../implementation/phases/PHASE-021.md)).
Everything application-level is **TypeScript on plain Node** (real SQLite files, real
Ed25519 crypto): nothing in the inner loop needs Windows, a Rust toolchain, or the Tauri
CLI. Runtime requirements for installed clients (WebView2 minimum + guidance) live in
[DESKTOP_SYSTEM_REQUIREMENTS.md](DESKTOP_SYSTEM_REQUIREMENTS.md); the monorepo-wide
bootstrap (database, compose stack, env file) is
[DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) — this page only adds the desktop-specific
loop on top of it.

## 1. Prerequisites

| Tool | Version | Why | Check |
|------|---------|-----|-------|
| Node.js | 22.12+ | the `@erp/desktop` TS runtime, the export build, Playwright | `node -v` (`.nvmrc` pins 22.12.0) |
| pnpm | 9.15.9 | workspace package manager (root `packageManager` pin) | `pnpm -v` |
| Playwright chromium | `@playwright/test` 1.64 (root devDep) | the E2E offline journey (§5) | `pnpm exec playwright --version` |
| Rust toolchain | **not needed** for development | the shell ships as source; only the Windows CI workflow compiles it (§6) | — |

Bootstrap is the standard monorepo one: `pnpm install` (the same command as
[DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) §2 — no desktop-specific step exists;
`better-sqlite3` installs with prebuilt binaries, and the SQLCipher cipher profile is a
Windows-CI-only custom build per [DR-P21-02](../implementation/phases/PHASE-021.md) — see
[../offline/LOCAL_DATABASE.md](../offline/LOCAL_DATABASE.md) §4).

## 2. The TS runtime test loop (`@erp/desktop`)

All application logic — SQLite store (dual-profile), enrollment/keychain/session/unlock,
sync host + triggers + revocation, minisign updater client + rollout gates, WebView2 probe,
crash telemetry, ESC-POS print, the bridge contract — lives in `apps/desktop/src/**` as the
workspace package `@erp/desktop`; `src-tauri/**` is the thin Rust shell (§6). The whole
runtime suite runs on Node against **real temp-dir SQLite files and real minisign
keypairs** (no mocks of the store or the verifier):

```bash
pnpm --filter @erp/desktop test         # 16 files / 274 tests green (store, auth,
                                        #   sync host/triggers/revocation/transport,
                                        #   updater/minisign, webview2, telemetry,
                                        #   print, bridge, updater-manifest, CI shape)
pnpm --filter @erp/desktop typecheck    # tsc --noEmit (strict)
pnpm --filter @erp/desktop lint         # the repo shared config incl. boundary rules
```

Golden constants live in `apps/desktop/src/constants.ts` (`WEBVIEW2_MINIMUM`,
`WEBVIEW2_RECOMMENDED`, `DESKTOP_STORAGE_BUDGET_BYTES` 1 GiB, `CRASH_FREE_GATES`) — specs
import them; never hard-code the numbers. The package layout, export surface, and the
honest split table are in [`apps/desktop/README.md`](../../apps/desktop/README.md).

## 3. The web console (`apps/web` dev + the offline console route)

The Offline Console (DR-P21-06) is the shared, capability-gated surface hosting the
desktop matrix column: cached reads with as-of labels, the 9 OFFLINE-DRAFT flows, the
outbox/rejection queue with the full
[CONFLICT_RESOLUTION](../offline/CONFLICT_RESOLUTION.md) §3 action table, honest-state
badges, sync-now, reprint-from-cache. In a plain browser (the shell bridge absent,
`detectBridge()` fail-closed) the same components render ONLINE-ONLY /
disabled-with-reason states — never queues, never simulations.

```bash
pnpm --filter @erp/web dev              # web on http://localhost:3000 (hot reload)
# routes: /ar/offline + /en/offline (the console), /{locale}/unlock (offline login
#         against the cached permission snapshot — the D-04 watermark)
# entries: the nav item + the owner-dashboard quick action
pnpm --filter @erp/web test             # the console suites — 73 tests green
                                         #   (bridge, store-client, sync-mirror,
                                         #   components AR/EN + RTL, schema parity)
```

Boundary rule (enforced by `pnpm lint:depcruise`, rule `web-shell-no-server`): nothing
under `app/[locale]/offline|unlock/**`, `components/offline/**`, or `lib/shell/**` may
import the BFF/server helpers or `next/headers` — the offline screens must run from a
static export (§4).

## 4. The export build (`build:desktop` → `out-desktop`)

```bash
pnpm --filter @erp/web build:desktop    # stash → next build (ERP_TARGET=desktop,
                                        #   output:"export", distDir out-desktop) →
                                        #   always-restore; ≈ 20–40 s
pnpm check:desktop-shell                # structural gate (§6) — also PASSes with the
                                        #   "export not built" note on a clean tree
```

The build wraps `next build` via `apps/web/scripts/desktop-export-prebuild.mjs`: every
server-only surface (`app/api`, `middleware.ts`, and every `app/[locale]` route not in
`apps/web/desktop.routes.json` — the shell subset is the offline console + the unlock
screen, DR-P21-07) is stashed into `.desktop-stash/`, the reduced tree is built, and the
workspace tree is **always restored** (also on build failure). Output:
`apps/web/out-desktop/{ar,en}/offline.html` + `unlock.html` + `_next/static`.

> **Lint landmine (remove before linting).** `out-desktop` is a transient, regenerable,
> gitignored artifact — but while it exists, the generated `_next` chunks break
> `pnpm --filter @erp/web lint` and root `pnpm lint` (~2 000 errors). Remove it after
> use (`rm -rf apps/web/out-desktop`), or land the shared-config ignore
> (`"**/out-desktop/**"` in `packages/config/eslint`) before linting with it present.
> The Windows CI builds it fresh and never lints it.

## 5. The E2E offline journey

```bash
pnpm test:e2e-desktop                   # Playwright chromium; builds the export (§4),
                                        #   serves it statically, injects a bridge
                                        #   double BACKED BY THE REAL desktop runtime
                                        #   (temp SQLite + real SyncDesktopHost + a
                                        #   scripted transport) — 2 journeys (AR + EN)
                                        #   green, ~25 s incl. the export build
```

The journey (unlock → cached reads with as-of labels → draft create → offline flip +
ONLINE-ONLY check → reconnect → sync → PRICE_CHANGED rejection → accept-server-price →
ACCEPTED) is spec'd in
[../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md) §7 and driven from
`tests/e2e/desktop-offline.spec.ts` with i18n asserted from the real dictionaries in both
locales.

## 6. The Rust shell posture (source-only; Windows CI compiles)

`apps/desktop/src-tauri/**` ships as **source code** — the k6 precedent: real artifacts
and real tests for everything TypeScript, honest deferral for what needs Windows
hardware. In development, `pnpm check:desktop-shell` validates what would otherwise need
cargo: (1) `tauri.conf.json` invariants (identifier, `frontendDist → apps/web/out-desktop`,
updater endpoint template, nsis+msi targets, the `<set-by-CI>` pubkey placeholder); (2)
bridge ↔ Rust command parity (every `DesktopBridge` member has its `#[tauri::command]`,
and vice versa); (3) the `desktop.routes.json` manifest schema; (4) export completeness
when built; (5) a secret scan over the shell configs. The Windows release workflow
(`.github/workflows/desktop-release.yml`, on tag `v*`) compiles the crate
(`--features sqlcipher`), bundles, EV-codesigns, minisign-signs the updater artifacts
(S-15), generates the SBOM, and publishes the updater manifest — its step order is
structurally asserted by `apps/desktop/__tests__/desktop-release-ci.test.ts`.

Updater manifest tooling (hosting layout + immutability rules:
[DEPLOYMENT.md](DEPLOYMENT.md) §7 and
[`deploy/updater/README.md`](../../deploy/updater/README.md)):

```bash
pnpm tsx scripts/updater-manifest.ts --self-test   # REAL crypto round-trip (sign →
                                                   #   verify → tamper-reject)
```

## 7. Command map

| Command | What it does |
|---------|--------------|
| `pnpm --filter @erp/desktop test` | the TS runtime suite — 16 files / 274 tests on real SQLite + real crypto |
| `pnpm --filter @erp/desktop typecheck` / `lint` | strict tsc / the shared ESLint config |
| `pnpm --filter @erp/web dev` | the web console incl. `/{locale}/offline` + `/{locale}/unlock` |
| `pnpm --filter @erp/web test` | the console component + shell-client suites (73 tests) |
| `pnpm --filter @erp/web build:desktop` | the static export → `apps/web/out-desktop` (DR-P21-07) — remove before linting (§4) |
| `pnpm check:desktop-shell` | the shell structural gate (tauri.conf + bridge parity + manifest + export + secrets) |
| `pnpm test:e2e-desktop` | the offline journey E2E, AR + EN (builds the export itself) |
| `pnpm lint:depcruise` | the desktop/web boundary rules (`desktop-no-api`, `desktop-no-web`, `web-shell-no-server`) |
| `pnpm tsx scripts/updater-manifest.ts --self-test` | updater manifest sign/verify round-trip |

Related runbooks: updater failure paths, WebView2 below-minimum, the corruption path, and
the sync-driver fail-closed posture —
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) §desktop. Rollout gates and the crash-free
dashboard: [MONITORING.md](MONITORING.md) §1,
[../planning/RELEASE_STRATEGY.md](../planning/RELEASE_STRATEGY.md) §Rollout.
