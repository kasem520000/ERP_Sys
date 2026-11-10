# Local Database

> **Status:** STABLE (reference store + the real desktop SQLite store LIVE since 2026-11-04) · **Owner:** Offline & API Architecture · **Updated:** 2026-11-04

Specification of the on-device SQLite store: what it mirrors, how it is versioned, how ids
are generated, how it is protected, and how it recovers. Binding decisions:
[ADR-0012](../architecture/ADR/ADR-0012-offline-sync.md) (SQLite local store),
[ADR-0006](../architecture/ADR/ADR-0006-identifiers.md) (UUIDv7 client-side ids),
[ADR-0009](../architecture/ADR/ADR-0009-money-precision.md) (money as decimal strings —
never REAL/float affinity in SQLite).

## 1. Local schema strategy

> **Status note (2026-11-04, PHASE-020):** `packages/sync-core` v1 ships the reference
> store contract + engine (LOCAL_MIGRATIONS **v2** — the v1 tables plus `inbox`
> (command_id pk, processed_at — the §4.4 client-side mirror) and `meta` (key/value —
> cursor/watermark/contract-gate state), idempotent `CREATE IF NOT EXISTS` so a v1 store
> and a fresh store converge). The engine (cycle, retry, recovery, pruning, watermark)
> was validated against the in-memory adapter — a documented transaction pass-through;
> the real SQLite store + byte-exact budgets landed with PHASE-021 (next note).

> **Status note (2026-11-04, PHASE-021):** the REAL SQLite store landed — `@erp/desktop`
> `createDesktopStore`/`openDesktopStore` (better-sqlite3, WAL + foreign keys asserted at
> open) implements the `StorageAdapter` contract against a real DB file, with desktop
> migrations **v4/v5 continuing the shared `schema_migrations` numbering** (v1–3 from
> sync-core apply first; v4 adds the read caches `sales_invoices`/`quotations`/
> `delivery_notes`/`stock_counts` + the `draft_docs` write-set + the `local_events` audit
> table; v5 seeds `meta`) — server schema untouched (these are device-local tables; see
> [ENTITY_CATALOG](../database/ENTITY_CATALOG.md) §reporting for the note). **Dual-profile
> store (DR-P21-02):** the `cipher` profile (Windows CI `--features sqlcipher` build)
> applies `PRAGMA key` + verifies `cipher_version` — true at-rest encryption; a key on
> the stock build fails closed (`SqlCipherUnavailableError`) unless the explicit
> `standard` fallback is chosen, which keeps every OTHER key-management invariant (the
> key lives only in the OS keychain; secret-scan of the file + WAL bytes green) — the
> D-02 binary inspection therefore runs for real **only on the Windows CI cipher
> profile** (recorded caveat). **Byte-exact pruning (DR-P21-03)** replaced the 020
> row-count approximation: `tableBytes` = `SELECT sum(pgsize) FROM dbstat` (verified
> present on better-sqlite3 12.11.1; a documented row-approx fallback exists and says
> so), and the post-cycle `pruneDesktopStore` pass holds the 1 GB budget LRU-first
> (§5). The **§6.4 corruption path is proven by a real drill** — a corrupted page →
> integrity verdict → stage survivors (outbox/inbox readable parts, manifest kept on
> disk) → delete file+wal/shm → re-run migrations v1–5 → re-import → cursors reset —
> and the store refuses LOUD when staging is unwritable (never deletes the outbox
> without staging). Evidence: `apps/desktop/__tests__/store*.test.ts` + the chaos
> desktop profile ([../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md) §7).

The local database is a **documented mirrored subset** of the server schema, tailored per
device class. It is NOT a replica: tables are scoped, some are read-only caches, and the
outbox/inbox/cursor tables are local-only machinery with no server counterpart.

### 1.1 Mirrored subsets per device class

| Device class | Mirrored read models (pull) | Local write set (push) | Local machinery |
|--------------|------------------------------|------------------------|-----------------|
| **POS terminal** | `items` (+ `barcodes`, `uoms`), `price_list_items` (active lists), `partners` lite (walk-in + quick-search fields), `tax_codes` + rate snapshots, cashier shift template, terminal config | `sales_invoices` + lines (POS kind), `receipts` (cash), `stock_count_lines` (POS-lite), `cashier_shifts` events | outbox, inbox, cursors, meta |
| **Android field app (van sales)** | POS subset **plus** van stock snapshot (`van_stocks` projection), route customers (`routes`), rep settlement template | Van sale invoices, collections (`receipts`), returns (`credit_notes` drafts), van load/unload confirmations | outbox, inbox, cursors, meta |
| **Desktop application** | Broad read cache of the modules the user works in (partners, items, open documents, reports the user has opened) — bounded by retention (§5) | Drafts of any OFFLINE-DRAFT operation the matrix allows (see [OFFLINE_CAPABILITIES_MATRIX.md](OFFLINE_CAPABILITIES_MATRIX.md)) | outbox, inbox, cursors, meta |
| **Personal-account app** | Statement read models, issued invoices, receipts against the linked partner, notification cache — authorized rows only | none (read-only device class) | cursors, meta (no outbox/inbox) |

Rules:

1. A table may enter a device subset only if the
   [OFFLINE_CAPABILITIES_MATRIX.md](OFFLINE_CAPABILITIES_MATRIX.md) or a read-model
   requirement justifies it; "might be useful" is rejected in review.
2. Personal-account mirrors are filtered **server-side** by partner authorization before
   they ever enter a change feed — the device cannot pull rows of other partners.
3. Lite projections (e.g., `partners` lite) are explicit column subsets defined in
   `packages/contracts` so server feed writers and client consumers share one shape.
4. Money columns are `TEXT` holding canonical decimal strings (`"1234.5000"`); quantities
   `TEXT` 6-decimal strings; never SQLite `REAL` (ADR-0009 §4).

> **Status (2026-11-05, PHASE-022 COMPLETE):** the two Android subsets above are LIVE
> exactly as specified — `@erp/mobile` (`apps/mobile/src/store/migrations.ts`): the field
> profile applies `sync-core` v1–3 then the mobile field DDL (v4+: `van_stocks`,
> `routes`, `settlement_templates`, `statements` read cache); the personal profile
> applies its own minimal DDL (cursors + meta + personal read models ONLY — no
> outbox/inbox, per rule 2 of §1.2's machinery split, because sync-core's v1 bundles
> outbox creation with cursors — DR-P22-08b). Server-side feed groups + the
> partner-scope filter shipped in PHASE-022 (migration 0033); the expo chaos profile
> proves both stores on real SQLite files.

### 1.2 Core local machinery (all write-capable devices)

```ts
// packages/sync-core/schema — identical on Tauri (better-sqlite3) and Expo (expo-sqlite)
export const outbox = sqliteTable('outbox', {
  commandId: text('command_id').notNull().primaryKey(),   // UUIDv7, client-generated
  entityType: text('entity_type').notNull(),              // e.g. 'sales_invoice'
  intent: text('intent').notNull(),                       // 'create' | 'update' | 'submit' | ...
  payload: text('payload').notNull(),                     // canonical JSON (contract-validated)
  idempotencyKey: text('idempotency_key').notNull(),      // see IDEMPOTENCY_AND_RETRIES.md
  baseVersion: integer('base_version'),                   // server version when edited, for If-Match
  clientCreatedAt: text('client_created_at').notNull(),   // ISO 8601 — advisory only
  localRef: text('local_ref'),                            // e.g. offline receipt no.
  batchId: text('batch_id'),                              // set when pushed; null = never pushed
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: integer('next_attempt_at').notNull().default(0), // unix ms
  state: text('state').notNull(),                         // QUEUED | IN_FLIGHT | SYNCED | REJECTED
  lastError: text('last_error'),                          // typed rejection code JSON
  createdAt: integer('created_at').notNull(),             // unix ms
});

export const inbox = sqliteTable('inbox', {
  commandId: text('command_id').notNull().primaryKey(),   // processed server-side results
  processedAt: integer('processed_at').notNull(),
});

export const cursors = sqliteTable('cursors', {
  entityType: text('entity_type').notNull(),
  lastSeq: text('last_seq').notNull(),                    // opaque server sequence token
  syncedAt: integer('synced_at').notNull(),
  primaryKey({ entityType }) {},                          // one cursor per entity type
});

export const meta = sqliteTable('meta', {
  key: text('key').primaryKey(),                          // contractVersion, deviceHash, watermarks…
  value: text('value').notNull(),
});
```

Business tables carry the same primary keys as server (`id` UUIDv7 text) plus
`version` (server-assigned optimistic-concurrency integer) plus local-only columns
(`local_status`, `local_dirty`). The server `version` is only ever set by pull — a pushed
edit result returns the new authoritative version.

## 2. Local migrations and versioning

1. Local migrations are **independent** of server Drizzle migrations but are **mapped to
   server contract versions**: `packages/contracts` exports
   `CONTRACT_VERSION = '2026-10-27.1'` (or semver); each local migration declares the
   minimum contract version it understands, and the pull/push envelopes echo the server's
   contract version.
2. Local migrations are forward-only, applied at app start inside a transaction, tracked
   in a local `schema_migrations` table. No down-migration ships to devices.
3. **Conflict-of-capability rule (forced update):** if the server reports a contract
   version **newer** than the app's maximum known version, the server responds to
   pull/push with `CONTRACT_VERSION_UNSUPPORTED`; the app enters a **read-only sync mode**
   and prompts for update. If a stale server (older than the app expects for its schema)
   is encountered, the app refuses to write locally rather than fabricating compatibility.
4. An app update may never reinterpret an existing local record implicitly: if a migration
   changes the meaning of a cached column, it must bump the entity's feed cursor reset
   (full re-pull of that entity type) as part of the migration.

## 3. Local id strategy

1. Every locally created entity gets a **UUIDv7 generated on the device** (ADR-0006) — for
   documents AND their lines. Ids are generated inside the same local transaction that
   writes the business row and the outbox command.
2. The server upserts by id; it never rewrites ids. Official document numbers are assigned
   by the server at finalization only; POS offline receipt numbers (`OFF-…`) are local
   references stored in `local_ref` and reconciled at sync
   ([../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §4).
3. UUIDv7 gives time-ordered ids → good locality in SQLite's B-trees and natural
   debugging (creation time visible in the id).
4. Id collision across devices is a non-event (122 bits of randomness per ms); no
   local sequence machinery exists.

## 4. Encryption at rest

| Platform | Mechanism | Notes |
|----------|-----------|-------|
| Tauri desktop | **SQLCipher** via the Tauri SQL plugin (or a sidecar `better-sqlite3` over a SQLCipher build) | Key generated on first run, stored in the OS keychain (Windows Credential Manager); DB file never at rest unencrypted |
| Android | **SQLCipher** through the expo SQLite driver with an encryption option; app-sandbox storage as a second layer (Android sandbox + encrypted FS) | Key held in Android Keystore via Expo SecureStore; biometric gate optional (ADR-0014) |
| Web | No local write store; cache headers only | No service-worker write cache is permitted for tenant data |

Rules: the encryption key never lives in the SQLite file, in preferences, or in app logs;
no secrets (tokens, passwords, signing material) are ever stored in the local DB — only in
the OS keychain/keystore ([SECURITY_AND_DEVICE_MANAGEMENT.md](SECURITY_AND_DEVICE_MANAGEMENT.md) §4).

## 5. Local data retention (pruning pulled read models)

1. Pulled read models are **cache**: the server can always re-serve them. Local space is
   bounded per device class (budgets: POS 256 MB, Android 128 MB, desktop 1 GB defaults,
   overridable in device config).
2. Pruning is **LRU by last access**, entity-type aware, and only ever removes rows that
   (a) came from a pull feed AND (b) have no local dirty state AND (c) are not referenced
   by an outbox command. Outbox/inbox/meta are never pruned by LRU.
   *(PHASE-020 implementation note: the shipped budgets are row-count approximations
   per device class — a documented `BYTES_PER_ROW_APPROX` constant, oldest-synced rows
   first — because the byte-exact accounting needs the real SQLite store; the byte-exact
   desktop budget landed with PHASE-021 — `dbstat` page bytes, DR-P21-03, see the §1
   status note — decision-recorded in the 020 completion report.)*
3. Prune evicting a row the user later needs = transparent re-pull (user-visible as a
   fetch, not an error). Backward cursor re-walk is allowed for re-hydration only, with
   server-side rate protection.
4. Tombstones apply immediately regardless of LRU: a tombstoned entity is removed locally
   in the same pull transaction that delivered the tombstone.

## 6. Crash recovery

1. **WAL mode is mandatory** (`PRAGMA journal_mode=WAL`): a process kill never corrupts
   the DB; the last committed transaction survives.
2. **Command atomicity**: writing a business operation and its outbox command happens in
   ONE local transaction — a crash can never leave a sold receipt without its outbox
   entry, or vice versa.
3. **The outbox is the source of truth for pending operations.** On every app start, the
   recovery sequence is: (a) roll WAL forward; (b) mark any command left `IN_FLIGHT` by a
   crash back to `QUEUED` (server idempotency makes re-push safe);
   (c) resume retry scheduling; (d) verify `meta.contractVersion` vs app schema — mismatch
   triggers the update gate (§2.3).
4. **Corruption path**: if SQLite integrity check fails (`PRAGMA integrity_check`), the
   app: (a) exports the outbox/inbox tables to a staging file where readable; (b) resets
   the local DB (delete + re-create + re-run migrations); (c) re-imports the staged
   outbox/inbox; (d) performs a full pull to rebuild read models. Net acceptable loss:
   cached read models only. If the outbox itself is unrecoverable, unrecoverable pending
   operations are surfaced as an explicit reconciliation incident for the tenant — never
   silently discarded ([FAILURE_RECOVERY.md](FAILURE_RECOVERY.md) §1).
5. **Rebuild-from-server principle**: any row whose provenance is "pull" is disposable;
   any row whose provenance is "user action not yet acknowledged by server" is precious.
   Schema and code must keep those two categories separated (machinery vs cache tables).

## 7. Conventions summary (normative)

| Topic | Rule |
|-------|------|
| Driver | Drizzle over better-sqlite3 (desktop) / expo-sqlite (Android); one shared schema package |
| Ids | UUIDv7, client-generated, never server-rewritten |
| Money/quantities | TEXT decimal strings (ADR-0009); REAL is lint-banned in local schema |
| Timestamps | Local rows: unix-ms integers for scheduling; payload timestamps: ISO 8601 UTC strings, advisory only |
| Statuses | Server statuses and local statuses (`PENDING_SYNC`, `DRAFT_LOCAL`, `SYNC_FAILED`) are distinct columns — never overloaded |
| Cursors | Opaque tokens; never parsed or extrapolated client-side |
| Migrations | Forward-only, contract-mapped, applied at start in a transaction |
| Integrity check | Run at app start after WAL recovery; failure → §6.4 path |
