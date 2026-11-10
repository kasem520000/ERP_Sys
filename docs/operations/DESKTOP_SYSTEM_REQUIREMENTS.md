# Desktop System Requirements

> **Status:** STABLE · **Owner:** Platform Operations · **Updated:** 2026-11-04

Runtime requirements for the installed ERP Desktop application (PHASE-021, Windows-first
per [ADR-0013](../architecture/ADR/ADR-0013-tauri-desktop.md) — the Tauri v2 shell around
the web ERP static export). The startup capability probe (`apps/desktop/src/system/webview2.ts`)
verifies the WebView2 band on every launch and produces the bilingual status + guidance
payload; the developer loop is [DESKTOP_QUICKSTART.md](DESKTOP_QUICKSTART.md).

## 1. Supported platforms

| Requirement | Value | Notes |
|-------------|-------|-------|
| Operating system | **Windows 10 or 11, 64-bit** | The supported platform for PHASE-021 ([ADR-0013](../architecture/ADR/ADR-0013-tauri-desktop.md) platform order) |
| WebView2 runtime | Evergreen channel, **minimum 109.0.1518.78**, recommended **120.0.2210.61** (DR-P21-04) | A **system requirement**, not a bundled dependency — the shell renders in the OS webview; see the banding table below |
| Installer / bundle class | ~10–20 MB (nsis `.exe` + msi) | The ADR-0013 rationale (small bundles, low memory — the reason Tauri beat Electron's ~150–200 MB installs); the measured bundle + memory figures for the shipped release are recorded in the PHASE-021 completion report |
| Local storage | **1 GB byte-exact budget** for the local SQLite store (DR-P21-03) | Measured via `dbstat` page bytes, LRU-pruned post-cycle (never the outbox/machinery/audit tables); plus WAL + staging headroom on the same volume |

## 2. WebView2 Evergreen banding (DR-P21-04)

The probe compares the installed runtime against `WEBVIEW2_MINIMUM` (109.0.1518.78 — the
last Evergreen branch still supporting the oldest supported Windows builds) and
`WEBVIEW2_RECOMMENDED` (120.0.2210.61); both constants ride the updater channel
(config-bumpable, `apps/desktop/src/constants.ts`).

| Installed runtime | Status | Behavior |
|-------------------|--------|----------|
| ≥ 120.0.2210.61 | **supported** | Full capability |
| > 109.0.1518.78 and < 120.0.2210.61 | **degraded** | The app runs with **degraded-capability notices** for the older runtime (graceful degradation, RISK-017) |
| Exactly 109.0.1518.78 | **supported** | The floor is the tested baseline |
| < 109.0.1518.78 | **unsupported** | The **system-requirements path**: a clear bilingual requirements message + WebView2 Evergreen installer guidance — no crash, no broken UI (PHASE-021 acceptance criterion 10) |

Below-minimum machines never reach a broken app state: the update/installer guidance is
the only path forward, and the installer bootstraps the Evergreen runtime where the
tenant's image lacks it. Ops-side triage for below-minimum and degraded cases:
[TROUBLESHOOTING.md](TROUBLESHOOTING.md) §desktop.

## 3. Local storage budget (DR-P21-03)

The desktop store budget is **1 GB, byte-exact** (`SELECT sum(pgsize) FROM dbstat` — the
sandbox-verified SQLite 3.53 build ships `SQLITE_ENABLE_DBSTAT_VTAB`; a documented
row-approximation fallback exists and says so in its prune result). The post-cycle prune
pass removes oldest-synced cache rows LRU-first until the store is under budget and
reports honestly when nothing prunable remains; outbox/inbox/cursors/meta and the
`local_events` audit trail are never pruned. Store design:
[../offline/LOCAL_DATABASE.md](../offline/LOCAL_DATABASE.md).

## 4. macOS / Linux — deferred (decision record required)

PHASE-021 ships **Windows only**. macOS and Linux support are explicitly deferred per
[ADR-0013](../architecture/ADR/ADR-0013-tauri-desktop.md) (platform order: Windows first)
and [../implementation/phases/PHASE-021.md](../implementation/phases/PHASE-021.md) §2
item 12: scheduling either platform requires its own decision record first — do not treat
this file's absence of macOS/Linux rows as support. ADR-0013's revisit trigger (pilot
install failures on target hardware) is the escalation path for WebView2-availability
problems on Windows, not a platform switch.
