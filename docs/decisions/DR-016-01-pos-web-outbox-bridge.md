# DR-016-01 — POS web-terminal offline queue: localStorage bridge instead of the SQLite store

> **Status:** ACCEPTED · **Owner:** Offline & API Architecture · **Date:** 2026-11-02
> (decided in-phase) · **Approver:** Architecture Owner · **Related:**
> [../offline/LOCAL_DATABASE.md](../offline/LOCAL_DATABASE.md) §1.1/§4,
> [../offline/SYNC_PROTOCOL.md](../offline/SYNC_PROTOCOL.md) §11,
> [../offline/OFFLINE_ARCHITECTURE.md](../offline/OFFLINE_ARCHITECTURE.md) §5,
> PHASE-016 §2 item 7, PHASE-021 (desktop packaging)

## Context

ADR-0012/LOCAL_DATABASE place the device-side write store in SQLite (encrypted at rest),
packaged with the Tauri shell that arrives in PHASE-021. PHASE-016 POS terminals run in
the **browser** on shop hardware, and LOCAL_DATABASE §4 is explicit: the web platform has
no first-class write store. The scoped offline sale queue must nonetheless survive page
reloads and browser crashes — a shop keeps selling through outages with `OFF-` numbers
and honest `PENDING_SYNC` state.

## Options

| Option | Consequences |
|--------|--------------|
| **A. No offline queue on web until PHASE-021** | Loses the phase's core business value (outage selling); the chaos slice has nothing to prove |
| **B. Transparent cache (Service Worker / HTTP cache) as an invisible store** | Violates state honesty (OFFLINE_ARCHITECTURE §5 — nothing local may render as posted); opaque to the user; unbounded growth |
| **C. Explicit localStorage-backed bridge implementing the sync-core storage adapter contract** | Bounded and user-visible; the queue logic stays adapter-agnostic; swap to SQLite is configuration, not code |

## Decision

**Option C.** The browser terminal's outbox persists via the app's localStorage bridge —
queued documents, outbox rows, cursors, and meta behind the same storage-adapter
contract `@erp/sync-core` defines for the SQLite store. The queue is an **explicit,
user-visible `PENDING_SYNC` surface** (banner counts, `OFF-` receipt numbers, per-item
typed rejections at reconciliation) — never a transparent cache. No locally created
state renders as posted; the official number appears only after the server assigns it.

## Consequences

- The queue is bounded by localStorage limits; exhaustion fails loudly (chaos case C-16
  — storage-full during capture) and drains after recovery.
- PHASE-021 (Tauri desktop) swaps the adapter for the SQLite store (LOCAL_DATABASE
  §1.1) with zero queue-logic changes; the versioned local migrations in `sync-core`
  govern that store.
- PHASE-020 must accept the same wire traffic regardless of the device's local store
  backend — generalization may not assume SQLite-only clients (§11 rule 3).
- The §11 POS boundary still binds: the queue carries sales/returns/shift events and
  pulled read-caches only; growth past it is a review blocker, not a configuration.

## Approval requirements

Architecture owner counter-signature (recorded here); the PHASE-016 completion report
and SYNC_PROTOCOL §11 reference this record as the standing deviation until PHASE-021
reconciles it.
