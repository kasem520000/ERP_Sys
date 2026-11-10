# Sync Protocol

> **Status:** STABLE (generalized foundation LIVE since 2026-11-04) · **Owner:** Offline & API Architecture · **Updated:** 2026-11-04

The normative device↔server synchronization protocol implementing
[ADR-0012](../architecture/ADR/ADR-0012-offline-sync.md). Transport is HTTPS against the
versioned REST API ([../api/API_CONVENTIONS.md](../api/API_CONVENTIONS.md)); semantics are
**outbox push + cursor pull + inbox dedupe**. There is no replication channel, no
websocket state sync, and no client-initiated schema introspection.

Endpoint summary (v1):

| Operation | Route | Notes |
|-----------|-------|-------|
| Register device | `POST /api/v1/devices` | authenticated by user session/token; returns device credentials |
| Pull deltas | `GET /api/v1/sync/pull?entity=<type>&cursor=<token>&limit=<n>` | per-entity-type, cursor-paginated |
| Push commands | `POST /api/v1/sync/push` | batch; per-item results; `Idempotency-Key` = batch id |
| Ack pull batch | `POST /api/v1/sync/pull/ack` | advances server-side cursor (optional server hint) |
| Heartbeat / status | `GET /api/v1/sync/status` | contract version, server time, pending flags |

## 1. Device registration

1. **Authentication first**: registration is performed by an authenticated user (web
   session via BFF, or an existing device token) who holds the
   `devices.register` permission. Tenant context is derived from membership — never from
   the payload ([../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §3).
2. **Request**: `{ deviceName, platform: 'tauri-desktop' | 'android' | 'pos-terminal',
   platformVersion, appVersion, contractVersion, deviceKeyPublic, capabilities }` where
   `capabilities` is the negotiated subset (e.g., `pos`, `van_sales`, `personal_account`).
3. **Attestation-lite**: the device generates an asymmetric keypair; the public key is
   uploaded and the server challenges it once (sign-a-nonce) to prove possession. Platform
   attestation (Play Integrity / OS key attestation) is used **best-effort** — absence
   downgrades trust flags but does not block registration (see
   [SECURITY_AND_DEVICE_MANAGEMENT.md](SECURITY_AND_DEVICE_MANAGEMENT.md) §2).
4. **Scoped credentials issued**: the server creates a `devices` row, returns
   `device_id` (UUIDv7), a **refresh token** (one-time-use, rotating, bound to device id)
   and a short-lived **access token** (15 min) scoped to: pull feeds for the capability
   subset, push commands for the capability subset, and the modules the user's role
   permits. Credential mechanics per [ADR-0015](../architecture/ADR/ADR-0015-authentication.md).
5. **Revocation** (user self-service or admin) marks the device revoked: pulls return
   `DEVICE_REVOKED`, pushes are rejected with `DEVICE_REVOKED` before any command executes.
   In-flight requests complete (grace ≤ token lifetime); no new tokens are minted.
6. A suspended tenant suspends all its devices: sync surfaces `TENANT_SUSPENDED`
   ([../architecture/MULTI_TENANCY.md](../architecture/MULTI_TENANCY.md) §3.6).

## 2. Pull contract

1. **Per-entity-type cursors** over the ordered change feed (`change_log.seq`, see
   [../database/ENTITY_CATALOG.md](../database/ENTITY_CATALOG.md) "reporting & platform
   jobs"). The cursor is an **opaque, signed token** wrapping `{entityType, seq,
   issuedAt}`; clients store it verbatim and never parse it.
2. **Never full-table dumps.** A new device pulls: (a) a bootstrap snapshot per entity
   type (server-paginated with the same envelope), then (b) incremental deltas. Bootstrap
   size per entity type is bounded by the device class subset
   ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §1.1).
3. **Response envelope**:

```jsonc
// GET /api/v1/sync/pull?entity=sales_invoice&cursor=…&limit=500
{
  "data": {
    "entityType": "sales_invoice",
    "items": [ /* { "op": "upsert" | "tombstone", "id": "…", "version": 12, "row": { … } } */ ],
    "nextCursor": "b64…",        // absent when done
    "hasMore": false,
    "serverTime": "2026-10-27T08:15:00Z",
    "contractVersion": "2026-10-27.1"
  },
  "meta": { "requestId": "…", "count": 42 }
}
```

4. **Pagination**: `limit` (default 500, max 1000 items per page); loop while `hasMore`
   is true. Delta pages are ordered strictly by feed `seq` — a page is a contiguous seq
   window, so replay after crash is always safe with the last persisted cursor.
5. **Delta sizes**: each page is capped by item count AND serialized bytes (≤ 2 MB);
   whichever binds first. Large rows (documents with many lines) may occupy a full page
   alone. Feed writers chunk oversized entities so a single logical change never exceeds
   the page cap.
6. **Tombstones / soft-delete propagation**: server soft-deletes write a `tombstones`
   row + a feed entry with `op: "tombstone"`. The client deletes the local row (and its
   cached children) **in the same local transaction** that advances the cursor. A
   tombstone for a row the device never had is a no-op (idempotent).
7. **Cursor persistence rule**: the local cursor advances ONLY after the page's rows are
   committed locally. Crash between apply and cursor-advance = same page re-pulled;
   upserts are idempotent by `id` + `version` (apply only if `version` > local).
8. **Server-side cursor (hint)**: `POST /sync/pull/ack` lets the server record the
   device's last confirmed position (`sync_cursors`) for support/monitoring; correctness
   does NOT depend on it — the client's local cursor is authoritative for resume.

## 3. Push contract

1. The client sends a **batch** of outbox commands (≤ 50 commands or ≤ 1 MB, whichever
   binds first) to `POST /api/v1/sync/push`. The batch itself carries an
   `Idempotency-Key` (the batch UUIDv7) per [../api/IDEMPOTENCY.md](../api/IDEMPOTENCY.md);
   each command carries its own key as well, so a batch replayed under a different batch
   key still dedupes per-command.
2. **Command shape**:

```ts
type SyncCommand = {
  commandId: string;        // UUIDv7 — client-generated, globally unique
  entityType: string;       // 'sales_invoice' | 'receipt' | 'stock_count_line' | …
  intent: string;           // 'create' | 'update_draft' | 'pos_sale' | 'collect' | …
  idempotencyKey: string;   // stable across retries (see IDEMPOTENCY_AND_RETRIES.md)
  baseVersion?: number;     // server version of the row if the command edits server state
  clientCreatedAt: string;  // ISO 8601 — advisory only (§7 clock skew)
  localRef?: string;        // e.g. offline receipt no. 'OFF-...'
  payload: unknown;         // contract-validated entity payload (zod schema per intent)
};

type PushRequest = { contractVersion: string; commands: SyncCommand[] };

type PushItemResult =
  | { commandId: string; status: 'ACCEPTED';
      entity: { id: string; version: number };        // resulting server state (subset)
      officialNumber?: string;                        // e.g. invoice_no when assigned
      effects?: { journalEntryIds?: string[]; stockMoveIds?: string[] } }
  | { commandId: string; status: 'REJECTED';
      reason: SyncRejectionCode;                      // typed, stable enum (below)
      message: LocalizedText;                         // for direct display
      details?: Record<string, unknown>;              // e.g. currentPrice, availableQty, currentVersion
      resubmittable: boolean }                        // may fix & resend vs must cancel
  | { commandId: string; status: 'DEFERRED';
      retryAfterMs: number; reason: 'TRANSIENT' | 'RATE_LIMITED' };
```

3. **Per-item semantics** (the server never all-or-nothings a batch): each command is
   executed through the owning module's service in its own transaction; results are
   returned per `commandId`. `ACCEPTED` returns the resulting server state and any
   **official numbers** assigned (invoice no, journal ids) so the client can replace
   local pending state with authoritative state.
4. **Typed rejection reasons** (registry in [../api/ERROR_MODEL.md](../api/ERROR_MODEL.md)
   §4; summary): `PERIOD_LOCKED`, `PRICE_CHANGED`, `INSUFFICIENT_STOCK`, `CREDIT_LIMIT_EXCEEDED`,
   `STALE_VERSION`, `VALIDATION_ERROR`, `ITEM_INACTIVE`, `PARTNER_INACTIVE`,
   `DUPLICATE_COMMAND` (accepted-idempotent case is returned as ACCEPTED, not rejected —
   see §4), `DEVICE_REVOKED`, `TENANT_SUSPENDED`, `CONTRACT_VERSION_UNSUPPORTED`.
   Rejection payload carries machine-readable `details` so the UI can offer exact actions
   ([CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §3).
5. **DEFERRED** is for transient server-side conditions (lock contention, rate limit):
   the command is NOT executed, NOT recorded in inbox, and the client retries after
   `retryAfterMs`. DEFERRED must not be used for business-rule failures — those are
   REJECTED.
6. Financial commands route through the **posting engine** inside the same transaction
   (ADR-0007; INV-013 posting-operation keys make replay exactly-once). The push endpoint
   adds transport only — it never contains business rules.

## 4. Inbox dedupe (server-side)

1. Before executing a command, the server looks up `inbox_commands` by
   `(tenant_id, device_id, command_id)` — or by the command's `idempotencyKey` where the
   intent defines one (financial intents always do).
2. **Duplicate delivery → original result replay**: if found, the server returns the
   stored result for that command (marked `duplicate: true` in the item result meta),
   WITHOUT re-executing. This makes retry storms, app-reinstall-restored outboxes, and
   ack-loss replays harmless ([IDEMPOTENCY_AND_RETRIES.md](IDEMPOTENCY_AND_RETRIES.md) §3).
3. Inbox rows are retained ≥ 30 days (retention job in pg-boss,
   [ADR-0008](../architecture/ADR/ADR-0008-jobs-redis.md)); a command older than retention
   replayed after expiry dedupes instead via the posting-engine key (financial) or via
   natural id upsert (drafts) — every command path has a second dedupe layer; there is no
   command class whose double-execution is possible.
4. **Client-side inbox mirror**: the device records processed `commandId`s locally
   ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §1.2) to suppress already-resolved items when a
   stale server response is re-delivered.

## 5. Ack and cleanup

1. After the client applies per-item results, it sends
   `POST /api/v1/sync/push/ack { commandIds: […] }`; the server MAY use this to advance
   bookkeeping (e.g., outbox lag metrics). Correctness never depends on ack delivery —
   dedupe (§4) covers the un-acked case.
2. Local cleanup: on `ACCEPTED`, the outbox row moves to `SYNCED` and the business row's
   local pending columns are replaced by returned server state (`PENDING_SYNC → POSTED`
   for POS sales, with official number recorded; `DRAFT_LOCAL → DRAFT` for drafts). On
   `REJECTED`, the row moves to `REJECTED` with the typed error stored; the user resolves
   it ([CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §3). `SYNCED`/terminal `REJECTED`
   rows are compacted (deleted) after their results are reflected — the inbox keeps the
   durable dedupe record.
3. Ack is batched with the next sync cycle when possible (bandwidth §8).

## 6. Ordering rules

1. **Per-entity FIFO**: the client pushes commands for the same entity id in creation
   order (outbox sequence by `commandId` timestamp component). The server executes a
   device's commands for the same entity serially in received order; it MAY reorder
   across unrelated entities for throughput.
2. **Document-before-lines**: `create` intents carry the full aggregate (document +
   lines) in one command — there is no separate "create line" command for unsynced
   documents, which eliminates a class of ordering hazards. `update_draft` commands are
   aggregate snapshots, not line patches.
3. Cross-entity causality within a batch (e.g., receipt allocating to an invoice created
   in the same batch) is preserved: the client orders them, and the server processes
   batch items in array order. A failed predecessor rejects dependents with
   `VALIDATION_ERROR` referencing the missing dependency — resubmission after the
   predecessor resolves them.
4. Pull is independent of push ordering: the client must not assume its pushed data is
   visible in a pull issued in the same cycle; server propagation to change feeds is
   transactional with command execution, but the cursor may lag one cycle. Harmless.

## 7. Clock skew policy

1. Client timestamps (`clientCreatedAt`) are **advisory metadata** — recorded for audit
   and UX ("created offline at …") and never used by the server for business decisions,
   ordering, or expiry.
2. **Server time is authoritative**: document dates proposed by the client are validated
   against server time + open-period rules; a POS sale pushed days later posts with the
   server's reconciliation policy (document date preserved for the business fact, posting
   date per tenant policy — see [../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md)).
3. **Sequence numbers, not wall clocks, define ordering** in feeds and retry scheduling;
   monotonicity comes from the server sequence (`change_log.seq`) and local counters, so
   device clock jumps (manual changes, timezone travel) never corrupt sync state.
4. Devices sync their clock offset from `/sync/status` `serverTime` for display purposes
   only.

## 8. Retry policy, triggers, and bandwidth budgets

**Retry policy (client):** exponential backoff with full jitter —
`delay = min(cap, base × 2^attempts) × random(0.5…1)`; base 5 s, cap 15 min for
connectivity failures; `DEFERRED` responses honor `retryAfterMs` (bounded by the cap).
Commands are idempotent (§3, [IDEMPOTENCY_AND_RETRIES.md](IDEMPOTENCY_AND_RETRIES.md)), so
retries are always safe; there is no "at-most-once" mode anywhere in the client.

**Sync triggers:**

| Trigger | Behavior |
|---------|----------|
| App start / unlock | Recovery pass ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §6.3), then one full cycle (pull → push → ack) |
| Connectivity regained (OS signal) | Debounced (5 s) full cycle |
| Periodic | Foreground: every 2 min if dirty; background (Android): OS-scheduled fetch, ≤ every 15 min; POS terminal: every 1 min if outbox non-empty |
| After local write | Push-only fast cycle for interactive feedback (drafts) |
| Manual | User-initiated "sync now"; shows per-item results and typed rejections |

**Bandwidth budgets:** sync traffic is capped per cycle (default: pull ≤ 8 MB, push ≤ 2 MB
over cellular; counts scale up on Wi-Fi/LAN). Budget exhaustion splits across cycles —
correctness never depends on a cycle completing (cursors + idempotent commands).
Personal-account apps pull only delta pages ≤ 256 KB per background fetch.

## 9. Full cycle sequence (with mid-cycle failure)

```mermaid
sequenceDiagram
  autonumber
  participant D as Device (sync-core)
  participant A as API (sync module)
  participant DBC as Device SQLite
  participant DBS as Server (change_log / inbox / domain)

  Note over D,DBC: trigger: app start / reconnect / periodic
  D->>DBC: recovery: WAL roll-forward, IN_FLIGHT → QUEUED
  D->>A: GET /sync/status (access token)
  A-->>D: contractVersion, serverTime
  alt contract mismatch
    A-->>D: 422 CONTRACT_VERSION_UNSUPPORTED
    D->>D: enter read-only update mode (LOCAL_DATABASE §2.3)
  end
  loop per entity type, while hasMore
    D->>A: GET /sync/pull?entity=…&cursor=…
    A->>DBS: read change_log seq window (+ tombstones)
    A-->>D: { items, nextCursor, hasMore }
    D->>DBC: tx: apply items (upsert by version / tombstone) + advance cursor
    Note over D,DBC: crash here → same page re-pulled next run (idempotent)
  end
  loop batch of ≤50 commands from outbox (FIFO per entity)
    D->>A: POST /sync/push (Idempotency-Key: batchId)
    A->>DBS: per command: inbox check → execute via module service (+ posting engine)
    Note over A,DBS: mid-request crash: nothing committed OR<br/>committed with inbox row —<br/>replay returns stored result (§4)
    A-->>D: per-item ACCEPTED / REJECTED / DEFERRED
    D->>DBC: tx: apply results (PENDING_SYNC→POSTED w/ official no;<br/>or REJECTED w/ typed reason), inbox mirror += ids
    Note over D,DBC: crash here → results re-delivered on replay;<br/>local application is idempotent by commandId
  end
  D->>A: POST /sync/push/ack { processed commandIds } (best-effort)
  D->>A: POST /sync/pull/ack { cursors } (best-effort, server-side hint)
  D-->>D: schedule next cycle per triggers
```

Failure windows are annotated at the exact points where a crash or network drop can occur;
every window is covered by either cursor idempotence (pull) or command idempotence +
inbox dedupe (push). The expanded scenario playbook, including corruption and revocation
paths, is [FAILURE_RECOVERY.md](FAILURE_RECOVERY.md).

## 10. Server-side maintenance (pg-boss jobs)

| Job | Schedule | Purpose |
|-----|----------|---------|
| `sync.inbox.retention` | daily | prune `inbox_commands` older than 30 days (bounded, audited) |
| `sync.tombstone.gc` | weekly | compact tombstones older than max offline horizon (90 days default) |
| `sync.cursor.compact` | daily | merge `sync_cursors` hints; alert on devices lagging > 7 days |
| `sync.feed.health` | 5 min | verify change feeds are advancing per tenant; alert on stall |

Jobs are tenant-scoped and idempotent ([ADR-0008](../architecture/ADR/ADR-0008-jobs-redis.md));
metrics feed [../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md) §"Domain".

## 11. POS-scoped subset (PHASE-016) vs generalized foundation (PHASE-020)

> **SHIPPED 2026-11-02 (PHASE-016).** The narrow slice below is live: the `sync` module
> ships the catch-up `change_log` writer for the POS feed group
> (items/barcodes/uoms/price_list_items/partners/tax_codes), cursor pull with
> HMAC-signed opaque tokens, and batch push (≤ 50 commands) with per-item
> `ACCEPTED / REJECTED / DEFERRED` results — **the same wire contracts as §2/§3** (rule 1
> held); `packages/sync-core` ships the device-side store contract + versioned local
> migrations, the outbox engine (QUEUED → IN_FLIGHT → ACKED/REJECTED with crash
> recovery), and the chaos-test harness. Three deviations from this table are recorded
> as decisions for PHASE-020/021 reconciliation:
> [DR-016-01](../decisions/DR-016-01-pos-web-outbox-bridge.md) (the browser-terminal
> queue persists via the app's localStorage bridge, not the SQLite store — an explicit
> user-visible `PENDING_SYNC` surface; the Tauri SQLite store ships with PHASE-021),
> [DR-016-02](../decisions/DR-016-02-card-receivable-mapping.md) (card tenders require
> the tenant to map the `CARD_RECEIVABLE` purpose once — fail-closed
> `PURPOSE_NOT_MAPPED`), and
> [DR-016-03](../decisions/DR-016-03-pos-device-transport.md) (devices ride the identity
> `devices` table with session transport; full device tokens are PHASE-020).

> **SHIPPED 2026-11-04 (PHASE-020).** The generalized foundation is live: the `sync`
> module (migrations 0029–0031) ships 4 device-class feed groups (pos / field /
> desktop / personal) + the 9-entity catch-up writer, pull v2 (byte-capped pages +
> the C-12 resync directive + the `permissions` snapshot feed), push v2 (the handler
> registry over owning-module services, inbox dedupe, per-device rate limit →
> DEFERRED, the 1 MB batch cap), the device registry with attestation + refresh
> rotation (reuse detection revokes), four maintenance jobs, the reconciliation
> queue, and the admin health aggregate; `packages/sync-core` v1 ships the reference
> client engine. A PHASE-016 terminal syncs UNCHANGED (rule 3 held; the chaos
> suite's legacy legs prove interop). Deviations from the letter of this document,
> decision-recorded in the completion report (DR-P20-05/06/07):
> (a) the resync trigger is `token seq > max(seq)` for the (tenant, entity) — the
> "+1" spelling would miss the exactly-at-head+1 stale case;
> (b) the change feed stores DELETE rows with their source `payload` retained (the
> watermark reads `payload->>'changedAt'`), while the PULL ENVELOPE nulls payload +
> version on DELETE and emits `op: "DELETE"` (this document's envelope example calls
> the op value `"tombstone"` — the wire value is `"DELETE"`; the `tombstones` table
> is the separate GC ledger);
> (c) a within-batch duplicate idempotencyKey replays the FIRST result with
> `duplicate: true` (the 016 leg echoed `{deduped: true}` with no result — the v2
> refinement lets a flapped client converge without a re-push);
> plus the notification category for cursor-stall owner alerts is `reconciliation`
> (the seeded CHECK domain has no `sync` category).

PHASE-016 ships the smallest correct implementation that satisfies real POS offline
sales; PHASE-020 generalizes without changing the contracts above. **The boundary is
explicit — PHASE-016 must not grow past it, and PHASE-020 must remain backward-compatible
with PHASE-016 clients.**

| Capability | PHASE-016 (POS scoped) | PHASE-020 (generalized) |
|------------|------------------------|--------------------------|
| Device registration | `pos-terminal` devices only; manual enrollment by admin; attestation-lite optional | All device classes; user self-enrollment per permission; attestation-lite standard |
| Entities pulled | `items`, `barcodes`, `uoms`, `price_list_items`, `partners` lite, `tax_codes` | All mirrored subsets per device class incl. van stock, route customers, desktop read cache |
| Entities pushed | `pos_sale` (invoice+lines+cash receipt), `cashier_shift` events | Every matrix row marked push-capable (drafts, counts, van ops, collections) |
| Conflict policies | POS sale server-decision (stock/price/period); offline receipt reconciliation | Full per-entity policy table ([CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §2) |
| Dedupe | `idempotencyKey` per sale + posting-operation key | + `inbox_commands` registry, 30-day retention, reinstall detection |
| Pull machinery | Per-entity cursors (same envelope as §2) — single feed group, bootstrap snapshot for items/prices | Same contract, all entity types, LRU pruning, tombstone GC |
| Rejection UX | Typed reasons for the 5 POS codes surfaced at shift-end reconciliation screen | Full registry mapped to per-operation user actions |
| Multi-device | One terminal = one device; no cross-terminal draft visibility | Draft ownership rules, stale-version handling, multi-device matrix columns |
| Testing | POS offline chaos script (kill/replay/duplicate) within PHASE-016 acceptance | Full suite per [../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md) |

**Rules:** (1) PHASE-016 uses the SAME wire contracts (§2, §3) — the subset is in scope,
not in format; (2) any PHASE-016 deviation must be recorded as a decision and reconciled
in PHASE-020; (3) PHASE-020 must accept a PHASE-016 terminal on day one (contract-version
gate, [LOCAL_DATABASE.md](LOCAL_DATABASE.md) §2.3).
