# apps/desktop — `@erp/desktop` (the TS runtime) + `src-tauri` (the shell)

PHASE-021 ([ADR-0013]) desktop application, split per the binding architecture
decision ([MASTER-PLAN §1 item 1]):

| Layer | Location | Language | Tested where |
|---|---|---|---|
| **ALL application logic** — SQLite store (dual-profile SQLCipher, DR-P21-02), enrollment/keychain auth, sync host, minisign updater client, WebView2 probe, crash telemetry, ESC-POS print | `src/**` (workspace package `@erp/desktop`) | TypeScript | `pnpm --filter @erp/desktop test` — real SQLite files, real Ed25519 crypto, no mocks (ADR-0013 "Rust stays confined to plugins") |
| **Thin shell** — window, plugin glue, the `DesktopBridge` command surface, updater bootstrap | `src-tauri/**` | Rust | **not compiled in the dev sandbox** (no Rust toolchain) — `pnpm check:desktop-shell` validates the structural invariants; the Windows CI workflow compiles + signs it for real |

## Dev quickstart (sandbox / any machine)

```bash
pnpm install
pnpm --filter @erp/desktop test        # the whole TS runtime suite (real SQLite + real crypto)
pnpm --filter @erp/desktop typecheck
pnpm --filter @erp/desktop lint
```

The runtime is plain Node (better-sqlite3 + node:crypto) — nothing here needs
Windows or a Rust toolchain.

## The desktop web export (DR-P21-07)

```bash
pnpm --filter @erp/web build:desktop   # → apps/web/out-desktop (static export)
pnpm check:desktop-shell               # structural gate (see below)
```

`build:desktop` wraps `next build` via `scripts/desktop-export-prebuild.mjs`:
it stashes every server-only surface (`app/api`, `middleware.ts`, all
`app/[locale]` routes not in `apps/web/desktop.routes.json`) into
`.desktop-stash/`, builds with `ERP_TARGET=desktop` (`output: "export"`,
`distDir: "out-desktop"`, unoptimized images), and **always restores the tree**
(finally — also on build failure; crash-safe if a previous run died). The
export contains the offline console + the unlock screen (client-hydrated);
online use loads the deployed web app — the same UI.

## The shell structural gate (`check:desktop-shell`)

Validates everything about the shell that does NOT need cargo:

1. `src-tauri/tauri.conf.json` invariants (identifier `com.erp.desktop`,
   `frontendDist → ../../web/out-desktop`, updater endpoint template, nsis+msi
   bundle targets, `<set-by-CI>` pubkey placeholder);
2. **bridge ↔ Rust command parity** — every `DesktopBridge` member
   (`src/bridge/contract.ts`) must have its matching `#[tauri::command]`
   (`keychain_get`, `sql_execute`, `http_request`, `updater_check_now`,
   `system_webview2_version`, `print_print_raw`, `connectivity_is_online`, …)
   registered in `src-tauri/src/lib.rs`, and vice versa;
3. `desktop.routes.json` schema + routes exist;
4. `apps/web/out-desktop` completeness (when built — CI runs this after
   `build:desktop`);
5. secret scan over the shell configs (no key material; `<set-by-CI>`
   allowlisted).

## Rust posture (honest note)

`src-tauri` ships as **source only** in this repository — the dev sandbox has
no Rust toolchain (the k6 precedent: real artifacts + real tests for
everything TypeScript, honest deferral for what needs Windows hardware). The
Windows release pipeline (`.github/workflows/desktop-release.yml`, tag `v*`)
compiles the crate (`cargo build --release --features sqlcipher` — the
DR-P21-02 cipher profile via rusqlite's bundled SQLCipher), bundles
nsis + msi, signs with an EV certificate, produces the minisign updater
signature (S-15), generates the SBOM, and publishes the updater manifest
layout. Its step order is structurally asserted by
`__tests__/desktop-release-ci.test.ts`.

## Updater signing + hosting

- `pnpm tsx scripts/updater-manifest.ts --self-test` — REAL crypto round-trip
  (generated keypair → sign → verify → tamper-reject), also run as part of the
  desktop suite (`__tests__/updater-manifest.test.ts`).
- Signing/publishing runbook, layout, and immutability rules:
  [`deploy/updater/README.md`](../../deploy/updater/README.md).
- Staged rollout + the halt remedy (minVersion bump, DR-P21-05): see
  `src/updater/rollout.ts` and the [RELEASE_STRATEGY] §Rollout.

## Documentation map

- [ADR-0013 — Tauri v2 desktop shell][ADR-0013] · [PHASE-021 phase doc]
- [LOCAL_DATABASE] (desktop store subset, encryption, recovery) ·
  [SYNC_PROTOCOL] (triggers, budgets) · [OFFLINE_CAPABILITIES_MATRIX] (desktop
  column)
- [SECRETS_MANAGEMENT] §S-15 (updater signing keys) · [DEPLOYMENT] §7
  (updater hosting)
- System requirements (WebView2 minimum + guidance):
  `docs/operations/DESKTOP_SYSTEM_REQUIREMENTS.md` (W4) · quickstart:
  `docs/operations/DESKTOP_QUICKSTART.md` (W4)

[ADR-0013]: ../../docs/architecture/ADR/ADR-0013-tauri-desktop.md
[MASTER-PLAN §1 item 1]: ../../agent-ctx/PHASE-021-MASTER-PLAN.md
[PHASE-021 phase doc]: ../../docs/implementation/phases/PHASE-021.md
[LOCAL_DATABASE]: ../../docs/offline/LOCAL_DATABASE.md
[SYNC_PROTOCOL]: ../../docs/offline/SYNC_PROTOCOL.md
[OFFLINE_CAPABILITIES_MATRIX]: ../../docs/offline/OFFLINE_CAPABILITIES_MATRIX.md
[SECRETS_MANAGEMENT]: ../../docs/security/SECRETS_MANAGEMENT.md
[DEPLOYMENT]: ../../docs/operations/DEPLOYMENT.md
[RELEASE_STRATEGY]: ../../docs/planning/RELEASE_STRATEGY.md
