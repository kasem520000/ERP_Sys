# Idempotency and Retries (Offline Path)

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-10-27

The end-to-end idempotency model that makes offline sync safe to retry forever. This
document covers the **offline/sync path**; the general REST API policy is
[../api/IDEMPOTENCY.md](../api/IDEMPOTENCY.md). The two share one rule set — a sync push
IS an API POST ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §3).

## 1. The three dedupe layers (normative)

| Layer | Key | Scope | Retention | Purpose |
|-------|-----|-------|-----------|---------|
| **Command idempotency keys** | client-generated `idempotencyKey` (UUIDv7) per command | server, per `(tenant, intent, key)` | **≥ 30 days** (`inbox_commands` retention, [../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md)) | makes every command replay-safe across retries, reinstalls, ack loss |
| **Posting-operation keys** | `{docType}:{docId}:{operation}` server-composed (ADR-0007) | server, unique index `(tenant_id, source_type, source_id, operation)` | permanent (row uniqueness) | exactly-once LEDGER effect — INV-013: a duplicate post returns the original journal result, no new entry ([../accounting/POSTING_ENGINE.md](../accounting/POSTING_ENGINE.md) §2.1) |
| **Inbox dedupe** | `(tenant_id, device_id, command_id)` | server, `inbox_commands` | ≥ 30 days | suppresses re-EXECUTION and replays the stored per-item result, including for non-financial intents |

Design rule: **every command path passes through at least one durable dedupe layer even if
the others expire.** Financial commands pass through all three. Draft `create` intents
dedupe naturally by UUIDv7 id upsert (a replay creates nothing new).

## 2. Client retry algorithm

```ts
// packages/sync-core — retry scheduling (full jitter, capped)
function nextDelayMs(attempts: number, retryAfterMs?: number): number {
  if (retryAfterMs) return Math.min(retryAfterMs, CAP_MS);       // DEFERRED hint
  const base = 5_000;
  const exp  = Math.min(CAP_MS, base * 2 ** attempts);           // CAP_MS = 15 min
  const jittered = exp * (0.5 + Math.random() * 0.5);            // full jitter
  return Math.max(1_000, jittered);
}
```

Rules: (1) commands are idempotent by contract, so the client NEVER distinguishes "safe"
from "unsafe" retries — everything is safe; (2) `attempts` increments only on
transport/`DEFERRED` failures; `REJECTED` is terminal for that command version (user
action required, [CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §3); (3) a device with
pending commands must not exponentially back off past the cap while a sync trigger fires —
the cap bounds per-command pacing, not cycle frequency.

## 3. Duplicate-delivery scenarios (all must be harmless)

| Scenario | Mechanism that neutralizes it |
|----------|-------------------------------|
| **Network retry storm** — client times out on a push whose effects actually committed; TCP/browser/app layers retry | Inbox dedupe replays the stored per-item results; financial effects are additionally guarded by posting-operation keys |
| **Ack loss** — server executed + responded, response lost; client re-pushes the same batch | Same as above: `command_id` lookup returns original results; client applies idempotently by `commandId` |
| **App reinstall restoring an old outbox** (backup restore, device clone) | Commands carry stable `idempotencyKey`s; if within retention → replayed results; if beyond retention → financial intents still dedupe via posting keys; draft creates upsert by id (no duplicate drafts). A restored outbox older than retention is flagged for reconciliation review, not silently executed "fresh" |
| **Same command in two overlapping batches** (client bug or resend-after-partial-ack) | Per-command dedupe is independent of batch `Idempotency-Key`; second occurrence gets the stored result with `duplicate: true` |
| **Concurrent duplicate push** (two tabs/processes on desktop) | Server serializes same-key requests ([../api/IDEMPOTENCY.md](../api/IDEMPOTENCY.md) §5); client additionally takes a local outbox lease so only one process pushes |
| **Reordered delivery** (batch retry with different item order) | Order matters only within an entity (document-before-lines is intra-command; §3 carries full aggregates). Cross-entity reorders resolve via `baseVersion` checks (`STALE_VERSION`) — never LWW |

## 4. Partial failure semantics

1. A push batch is **never all-or-nothing**: the server returns per-item results, and
   `ACCEPTED` items stay accepted even if other items were `REJECTED` or the transport
   died mid-batch ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §3.3).
2. The client reconciles **per item**: `ACCEPTED` → apply server state (official numbers
   replace pending state); `REJECTED` → park with typed reason for user action;
   `DEFERRED` → re-queue with `retryAfterMs`; **no result received** (transport failure)
   → leave `QUEUED`/re-`IN_FLIGHT`, the next cycle re-pushes ONLY unresolved commands
   (never re-pushes applied ones — the local inbox mirror suppresses stale responses).
3. "Resend only failures" is the invariant: a partially accepted batch must never be
   resent wholesale with mutated payloads — accepted commands keep their keys untouched,
   failed commands get NEW keys only when their payload actually changed after user edits.
4. Crash between result-apply steps: each local application is a transaction per command
   keyed by `commandId`; re-delivery of the same result re-applies as a no-op.

## 5. Test requirements (chaos suite — link)

The sync chaos suite ([../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md)) must
demonstrate, with seeded failures:

1. **Duplicates**: same command delivered 2×, 10×, concurrently → exactly one effect, one
   journal entry, one official number (INV-013 assert).
2. **Reorder**: batch delivered with permuted order → outcomes identical for
   order-independent commands; `STALE_VERSION` for order-dependent edits.
3. **Partial**: kill transport after item 3 of 10 → items 1–3 applied once, 4–10 re-pushed
   once, no duplicates, no loss.
4. **Crash between ack steps**: kill client between push-apply, inbox-mirror write, and
   ack → all orderings converge with zero duplicate effects.
5. **Reinstall**: restore a 35-day-old outbox onto a fresh install → replay results or
   reconciliation flag; no double-posted invoices.
6. **Clock skew**: device clock ±48 h → no ordering or acceptance differences (advisory
   timestamps only, [CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §5).

These tests gate PHASE-020 acceptance and re-run per release on the sync path
([../planning/MASTER_ROADMAP.md](../planning/MASTER_ROADMAP.md) PHASE-020).

## 6. Client-side key lifecycle rules

1. A command's `idempotencyKey` is generated **once**, in the same local transaction that
   writes the outbox row ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §1.2), and is immutable
   for the lifetime of that command version.
2. The key is regenerated **only** when the user changes the intent after a `REJECTED`
   (edit-and-resend): same entity id, new `commandId`, new `idempotencyKey` when the
   payload differs. "Accept server price" resends reuse the entity id but change totals →
   new key. A byte-identical resend (pure retry) NEVER regenerates.
3. Keys are UUIDv7 for time-ordered debugging; the inbox stores `(device_id, command_id)`
   so two devices may never collide even in a pathological duplicate-key bug.
4. The device keeps unresolved (not `SYNCED`) commands forever; resolved commands are
   compacted after their results are applied ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §5.2) —
   the durable record lives server-side (inbox + audit), not on the device.

## 7. Invariant summary (assertable)

| Invariant | Assertion used in tests |
|-----------|--------------------------|
| Exactly-once ledger effect | journal entry count per `(source, operation)` == 1 after N duplicate deliveries (INV-013) |
| Exactly-once official number | invoice numbers assigned per accepted command == 1 (no gaps introduced by duplicates — gaps only via documented void paths, ADR-0006 §3) |
| No lost result | every `ACCEPTED`/`REJECTED` eventually reflected on the device (bounded by trigger cycles), even with ack loss |
| No fabricated acceptance | device rows reach `POSTED`/server-state only via an `ACCEPTED` result payload ([OFFLINE_ARCHITECTURE.md](OFFLINE_ARCHITECTURE.md) §5) |
| Convergence | after connectivity stabilizes: outbox empties to {SYNCED, REJECTED-parked} and cursors advance — with no operator intervention |

