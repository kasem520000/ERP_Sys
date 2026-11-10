# ADR-0012 — Offline: SQLite Local Store + Outbox/Inbox Sync; Server-Authoritative Posting

> **Status:** ACCEPTED · **Date:** 2026-10-27 · **Supersedes:** none

## Context

POS terminals, field-sales phones, and the desktop app must keep working without
connectivity; van sales may be offline for hours; personal-account views must cache
authorized data. Directive §12 forbids replication shortcuts, forbids blind
last-write-wins for financial data, and requires the server to remain authoritative for
finalized shared records. It also forbids assuming a wrapped web app becomes a reliable
offline accounting system.

## Decision

1. **Local store: SQLite** (via Drizzle on `better-sqlite3`/`expo`/`tauri-plugin-sql`
   per platform) with its **own versioned migrations** mirroring a documented subset of
   the server schema ([../../offline/LOCAL_DATABASE.md](../../offline/LOCAL_DATABASE.md)).
2. **Sync protocol: outbox + inbox** ([../../offline/SYNC_PROTOCOL.md](../../offline/SYNC_PROTOCOL.md)):
   - **Pull**: per-entity-type incremental cursors from ordered change feeds (updated_at
     sequences + tombstones); never full-table dumps.
   - **Push**: local operations recorded in an outbox as idempotent commands with
     client-generated UUIDv7 entity IDs (ADR-0006) + idempotency keys; the server
     executes each command **at most once** and returns per-item results.
   - **Inbox** records processed command IDs for dedupe against duplicate delivery.
   - Devices register and receive scoped credentials; revoked devices stop receiving
     pulls and their pushes are rejected.
3. **Conflict policies are per entity type** ([../../offline/CONFLICT_RESOLUTION.md](../../offline/CONFLICT_RESOLUTION.md)):
   financial documents are never last-write-wins. Server-side validators decide
   acceptance (period open, stock availability, price validity, credit limits); the
   client receives structured rejections to surface for user action. Only
   non-constrained local-draft fields merge automatically.
4. **Server-authoritative effects**: finalization (approval, posting, official
   numbering) happens ONLY on the server. A locally accepted offline sale (POS) is
   marked `PENDING_SYNC` locally and becomes `POSTED` only after the server transaction
   commits; the local UI must show this state honestly (directive §12: never claim
   official acceptance because it exists locally).
5. **Financial effects apply exactly once**: posting-operation keys
   (ADR-0007) + command idempotency keys + inbox dedupe make duplicate delivery harmless.
6. **Security**: local DB encrypted at rest (SQLCipher/OS-level), device keys in OS
   keychain, offline permission snapshot refreshed at sync; clock-skew handling
   documented ([../../offline/SECURITY_AND_DEVICE_MANAGEMENT.md](../../offline/SECURITY_AND_DEVICE_MANAGEMENT.md)).

## Alternatives considered

| Alternative | Why not |
|-------------|---------|
| PostgreSQL replication to client | Not a synchronization protocol; schema/config coupling; conflicts unmanageable; forbidden by directive §1.18. |
| CRDTs for documents | Financial documents need validation against server state (stock, credit, period) — CRDT convergence is wrong semantics for money. |
| LWW per record | Explicitly forbidden for financial/stock/receipts/journals (directive §12). |
| Web app + service worker cache only | Suitable for read-mostly personal-account views; not for POS/field-sales writes. |

## Consequences

- POS offline sales (PHASE-016) implement a **scoped subset** of this protocol early;
  the generalized framework lands in PHASE-020; desktop/Android consume it after.
- Every offline-capable operation is specified in the capabilities matrix
  ([../../offline/OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md))
  with its conflict policy and post-sync state machine.
- Sync correctness has a dedicated chaos-test suite (duplicates, partial failure,
  revocation, clock skew) ([../../testing/SYNC_TESTS.md](../../testing/SYNC_TESTS.md)).

## Revisit triggers

- If a future module needs true peer-to-peer merge (multi-user offline collaboration),
  that is a new architecture decision with its own ADR — not an extension of LWW.
