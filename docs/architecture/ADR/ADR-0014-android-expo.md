# ADR-0014 — Android Application on React Native + Expo

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

Two Android audiences: (1) tenant users — owners viewing dashboards/statements, field
sales reps doing van sales and collections; (2) tenants' customers/suppliers via
personal-account views (balances, statements, invoices, notifications). Required:
offline caching, secure credential storage, push notifications eventually, barcode
scanning for field operations, and Arabic-first RTL UI. iOS is not in the initial market
scope.

## Decision

Build the Android client with **React Native (Expo toolchain, dev-client for native
modules)**. Rules:

1. **Shares non-UI packages only**: `packages/contracts`, `packages/domain-core`
   (ADR-0002). UI is React Native (not the web DOM design system) implementing the same
   [design tokens](../../ui/DESIGN_TOKENS.md) and page archetypes
   ([../../ui/PAGE_ARCHETYPES.md](../../ui/PAGE_ARCHETYPES.md)) via RN primitives —
   RTL via `I18nManager` + logical style props.
2. **Local persistence**: SQLite (expo-sqlite or Drizzle-on-sqlite) per
   [ADR-0012](ADR-0012-offline-sync.md) — the same sync protocol as desktop, with a
   mobile-tuned push schedule (background fetch constraints).
3. **Credentials**: OS keystore (Expo SecureStore); biometric unlock optional;
   refresh-token rotation on device registration.
4. **Notifications**: push via FCM adapter (post-MVP; adapter port defined in
   notifications module).
5. **Scope discipline**: the personal-account experience is read-mostly with cached
   authorized data; field sales writes flow through the sync protocol. No attempt to
   replicate the full back-office UI on mobile.

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| Capacitor (wrap the web app) | Fastest path, but weak native module story for reliable background sync + scanners; webview performance on cheap Android devices is poor; directive §12 warns against assuming a wrapped web app is a reliable offline system. |
| Flutter | Excellent UI; but Dart duplicates domain logic and contracts; loses TS-code-sharing. |
| Native Kotlin | Best platform fidelity; full code duplication; slower delivery for a small team. |

## Consequences

- Expo dev-client builds required (bare workflow escape hatch available for hardware
  integrations, e.g., Bluetooth POS printers).
- iOS later = mostly config + review of RN iOS specifics; not a rewrite (but out of
  scope until a decision record).
- App-store distribution (Play Store) adds release engineering (signing, staged
  rollouts) — documented in operations.

## Revisit triggers

- If hardware/peripheral needs on Android exceed RN/Expo plugin ecosystem, isolate that
  feature (e.g., a companion native module or a POS-specific device strategy) with a
  decision record.
