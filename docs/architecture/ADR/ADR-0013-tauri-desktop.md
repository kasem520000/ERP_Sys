# ADR-0013 — Desktop Application on Tauri v2

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

Target users (owners, accountants, cashiers) want a native-feeling Windows application
(Windows is the dominant desktop OS in the region) with offline capability, low resource
usage for old shop PCs, auto-update, and OS-level credential/key storage. Directive §12
requires evaluating Electron vs Tauri rather than wrapping the web app blindly.

## Decision

Build the desktop client with **Tauri v2**, reusing the web ERP UI (`apps/web` build) as
the frontend inside the Tauri shell, with Rust-side plugins for:

- Local SQLite (offline store per [ADR-0012](ADR-0012-offline-sync.md))
- OS keychain credential storage
- Hardware barcode/scanner input where needed (POS peripherals)
- Auto-update (Tauri updater with signed bundles)
- Receipt printers (OS print APIs / raw ESC-POS via plugin) as needed by POS templates

Platform order: **Windows first** (bundle + updater), macOS/Linux on demand (decision
record), because the target market is Windows-dominated.

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Electron | Mature but ships Chromium per app (~150–200MB installs, high RAM) — bad for old shop machines; larger attack surface (Node in production). |
| .NET MAUI / Qt / Flutter desktop | New UI stack ≠ shared web UI; duplicates the design system; violates single-language momentum (ADR-0002). |
| Web app + PWA only | No OS integration (keychain, printers, robust background sync); unacceptable for POS desktop. |

## Consequences

- Small bundles (~10–20MB), low memory, native webview (WebView2 on Windows — must be
  listed as a system requirement).
- Rust toolchain enters the build (Tauri core only; app logic stays TypeScript).
  AI-agent implementability: Tauri v2 is well-documented; keep Rust code to plugins.
- The web UI must keep a **build target** for Tauri (static export of the ERP app) and
  must not depend on Next.js server features at runtime for offline screens.
- WebView differences (older WebView2 versions on customer machines) → graceful
  degradation checks at startup; minimum-version enforcement in updater channel.

## Revisit triggers

- If WebView2 availability on target machines proves poor, or required POS hardware
  integration becomes impractical in Tauri, evaluate Electron with a documented ADR —
  the UI investment is fully reusable either way.
