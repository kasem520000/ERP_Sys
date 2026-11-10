# PHASE-020 — Offline Synchronization Foundation

> **Status:** PLANNED · **Updated:** 2026-10-27

## 1. Phase Overview

- **Phase ID:** PHASE-020
- **Title:** Offline Synchronization Foundation
- **Objective:** Generalize the POS-scoped offline queue (PHASE-016) into the platform-wide
  sync protocol: a `sync` module in the API owning device registry, change feeds, pull/push
  contracts, inbox dedupe and maintenance jobs; plus `packages/sync-core` — the shared
  TypeScript client library with the reference local-store implementation (outbox, inbox,
  cursors, retries, recovery) — and the admin/monitoring surfaces (device management, sync
  health dashboard, revoked-device reconciliation). The protocol is proven by the FULL
  chaos matrix C-01…C-16 as the phase gate
  ([../../testing/SYNC_TESTS.md](../../testing/SYNC_TESTS.md) §7).
- **Business value:** every offline-capable client (POS terminals, desktop PHASE-021,
  Android field/personal PHASE-022, integrations PHASE-023) rides one correct,
  chaos-tested protocol; businesses keep selling through outages with zero double-counted
  money and zero silent loss (RISK-011, RISK-004), and operators see sync health per
  tenant/device instead of debugging blind.

## 2. Scope

In scope:

1. **Server sync module** per [MODULE_BOUNDARIES](../../architecture/MODULE_BOUNDARIES.md):
   owns `change_log`, `tombstones`, `sync_cursors`, `inbox_commands`
   ([ENTITY_CATALOG](../../database/ENTITY_CATALOG.md) rows marked 020) and mirrors
   per-device sync state; reads identity's `devices` table (schema since PHASE-003) for
   registry state. No second business-logic path: pushed commands execute through owning
   modules' domain services exactly like online requests
   ([OFFLINE_ARCHITECTURE](../../offline/OFFLINE_ARCHITECTURE.md) §7).
2. **Device registry** per
   [SECURITY_AND_DEVICE_MANAGEMENT.md](../../offline/SECURITY_AND_DEVICE_MANAGEMENT.md):
   all device classes; user self-enrollment gated by permission; **attestation-lite**
   (keypair upload + sign-a-nonce challenge; platform attestation best-effort, absence
   downgrades trust flags without blocking); **scoped credentials** (device-bound,
   one-time-use rotating refresh token + 15-min access token per
   [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md) §3); **revocation
   semantics** (kill switch: pulls return `DEVICE_REVOKED`, pushes rejected per-item
   BEFORE execution, refresh exchange fails; suspended tenant → `TENANT_SUSPENDED`);
   lifecycle audit events (`device.registered`, `device.attested`,
   `device.token_rotated`, `device.refresh_token_reuse_detected`, `device.revoked`,
   `device.data_expired`, `device.trust_flagged`); lost-device remote data-expiry and
   draft-ownership transfer support.
3. **Pull contract** per [SYNC_PROTOCOL](../../offline/SYNC_PROTOCOL.md) §2: per-entity-type
   cursors (opaque signed tokens wrapping `{entityType, seq, issuedAt}`), bootstrap
   snapshot then incremental deltas, response envelope with `items[]`
   (`op: upsert|tombstone`, `id`, `version`, `row`), `nextCursor`/`hasMore`/
   `serverTime`/`contractVersion`; page caps (default 500, max 1000 items, ≤ 2 MB —
   whichever binds first, oversized logical changes chunked by feed writers); strict seq
   ordering; cursor persistence rule (advance only after the page commits locally);
   tombstone application in the same local transaction; server-side cursor ack as a
   monitoring hint only.
4. **Push contract** per [SYNC_PROTOCOL](../../offline/SYNC_PROTOCOL.md) §3: batches
   (≤ 50 commands or ≤ 1 MB) with batch `Idempotency-Key` + per-command keys; the
   `SyncCommand` shape (`commandId` UUIDv7, `entityType`, `intent`, `idempotencyKey`,
   `baseVersion?`, `clientCreatedAt` advisory, `localRef?`, contract-validated payload);
   **per-item** `ACCEPTED` (resulting entity version + `officialNumber` + effect ids) /
   `REJECTED` (typed reason from the registry: `PERIOD_LOCKED`, `PRICE_CHANGED`,
   `INSUFFICIENT_STOCK`, `CREDIT_LIMIT_EXCEEDED`, `STALE_VERSION`, `VALIDATION_ERROR`,
   `ITEM_INACTIVE`, `PARTNER_INACTIVE`, `DUPLICATE_COMMAND`, `DEVICE_REVOKED`,
   `TENANT_SUSPENDED`, `CONTRACT_VERSION_UNSUPPORTED` — with `details`, `resubmittable`,
   localized message) / `DEFERRED` (`retryAfterMs`, `reason: TRANSIENT|RATE_LIMITED`,
   NOT recorded in inbox); ordering rules §6 (per-entity FIFO, full-aggregate commands,
   batch-array causality, pull/push independence).
5. **Inbox dedupe** per [SYNC_PROTOCOL](../../offline/SYNC_PROTOCOL.md) §4 and
   [IDEMPOTENCY_AND_RETRIES](../../offline/IDEMPOTENCY_AND_RETRIES.md): lookup by
   `(tenant_id, device_id, command_id)` and by intent idempotency key; duplicate delivery
   replays the stored result marked `duplicate: true` without re-execution; retention
   **≥ 30 days** via the daily `sync.inbox.retention` job; every command path keeps a
   second durable dedupe layer (posting-operation keys for financial intents — INV-013;
   UUIDv7 natural-id upsert for draft creates).
6. **Conflict policies** — the full per-entity table from
   [CONFLICT_RESOLUTION](../../offline/CONFLICT_RESOLUTION.md) §2: SERVER_DECISION for
   financial documents/stock/van moves (never LWW), SERVER_AUTHORITATIVE_SNAPSHOT for
   prices/tax rates (pull-only), FIELD_LEVEL_MERGE for partner contact fields only
   (per-field results + field-level audit events), OWNER_DEVICE_WINS for drafts
   (non-owner pushes → `FORBIDDEN` with `ownerDeviceId`), aggregate SERVER_DECISION for
   count lines, READ_ONLY for personal-account models, ONLINE_ONLY rejection
   (`FORBIDDEN`) for configuration/entitlement/role pushes; `baseVersion` /
   `STALE_VERSION` mechanics (§4) and the clock-skew policy (§5 — client timestamps
   advisory, server-authoritative business dates).
7. **Local DB schema strategy** per [LOCAL_DATABASE](../../offline/LOCAL_DATABASE.md):
   per-device-class mirrored subsets (POS terminal / Android field / desktop /
   personal-account — §1.1), lite projections shared via `packages/contracts`,
   money/quantities as TEXT decimal strings (REAL lint-banned,
   [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)), client-generated
   UUIDv7 ids, server `version` optimistic-concurrency columns, the local machinery
   (`outbox`, `inbox`, `cursors`, `meta` — §1.2 exact schema), forward-only local
   migrations mapped to `CONTRACT_VERSION` with the read-only update gate on
   `CONTRACT_VERSION_UNSUPPORTED` and cursor-reset on semantic migrations (§2), SQLCipher
   encryption with keys in OS keychain only (§4), LRU pruning within per-class budgets
   (POS 256 MB / Android 128 MB / desktop 1 GB — §5), WAL + integrity-check crash
   recovery incl. the corruption path (§6).
8. **Capabilities matrix enforcement** per
   [OFFLINE_CAPABILITIES_MATRIX](../../offline/OFFLINE_CAPABILITIES_MATRIX.md): capability
   classes gate UI and sync scope server-side; every OFFLINE-COMPLETE / OFFLINE-DRAFT /
   LOCAL-VALID cell's conflict policy and post-sync state machine implemented or honestly
   deferred to its phase column; row-by-row cross-check at exit (§5.3).
9. **Permission snapshot feed** per SECURITY_AND_DEVICE_MANAGEMENT §5: pulled at every
   sync, gates local UI only, 7-day offline watermark → read-only + online-required
   writes; enforcement always server-final.
10. **Maintenance jobs** (pg-boss,
    [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md)): `sync.inbox.retention`
    (daily), `sync.tombstone.gc` (weekly; 90-day default max-offline horizon),
    `sync.cursor.compact` (daily; alert on > 7-day device lag), `sync.feed.health`
    (5-min; alert on > 10-min feed stall).
11. **Monitoring & admin**: sync health dashboard (push success/latency, pull cursor lag
    by entity, conflicts by type, rejected pushes by reason code —
    [MONITORING](../../operations/MONITORING.md) §1 "Sync health" PHASE-020), alerts
    (`SyncPushFailSpike` Sev-2, `SyncCursorStall` Sev-3), gauges `outbox.lag` and
    `device.revoked.pending_ops`, device management screens, and the revoked-device
    reconciliation view (FAILURE_RECOVERY S7); `change_log` growth monitoring added to
    deploy pre-flight ([DEPLOYMENT](../../operations/DEPLOYMENT.md) §7).
12. **`packages/sync-core` v1** (TypeScript, shared by desktop and Android —
    [ADR-0002](../../architecture/ADR/ADR-0002-typescript-monorepo.md)): outbox/inbox
    machinery, full-jitter retry scheduler, cycle engine (connect → status → pull →
    push → ack), contract-version gate, recovery sequence, LRU pruning, corruption path —
    plus the harness-native reference device proving the SDK (not just the harness)
    implements outbox/inbox correctly
    ([SYNC_TESTS](../../testing/SYNC_TESTS.md) §5).

Out of scope (explicit):

- **End-user applications**: the desktop app (PHASE-021) and Android app (PHASE-022) —
  this phase ships the protocol, the client library, and the reference local store, not
  the apps.
- New business modules or intents beyond those the matrix assigns to PHASE-016/020;
  van-sales field flows land with PHASE-022's device class even though the protocol
  supports them.
- Web offline writes (browser stays online-only; no service-worker write cache —
  OFFLINE_ARCHITECTURE §6).
- E-invoicing/regulatory submission paths (PHASE-023; matrix row 19 is ONLINE-ONLY).
- Offline administration, offline posting, offline period operations, peer-to-peer sync —
  all forbidden non-goals (OFFLINE_ARCHITECTURE §2, §9).
- Replication of any form, LWW for constrained data, and any "manual cursor fix" tool
  (FAILURE_RECOVERY §2.5).

## 3. Prerequisites

- Required phases: **PHASE-016 — Point of Sale** COMPLETE: its offline sale queue is the
  first concrete consumer this phase generalizes; the POS terminal's subset (single feed
  group, `pos_sale` push, offline `OFF-…` receipts, 5-code rejection UX) must be running
  on the SAME wire contracts (SYNC_PROTOCOL §11), verified by its completion report and
  by this phase's interoperability acceptance criterion. Transitively, the platform
  substrate (001–015) is COMPLETE per
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md).
- Required architecture decisions:
  [ADR-0012](../../architecture/ADR/ADR-0012-offline-sync.md) (SQLite + outbox/inbox; no
  replication; no LWW for financial data; server-authoritative posting),
  [ADR-0015](../../architecture/ADR/ADR-0015-authentication.md) (device tokens, rotation,
  revocation), [ADR-0006](../../architecture/ADR/ADR-0006-identifiers.md) (UUIDv7
  client ids), [ADR-0007](../../architecture/ADR/ADR-0007-centralized-posting-engine.md)
  (INV-013 posting-operation keys), [ADR-0008](../../architecture/ADR/ADR-0008-jobs-redis.md)
  (maintenance jobs), [ADR-0009](../../architecture/ADR/ADR-0009-money-precision.md)
  (decimal-string money).
- Relevant documentation: the full offline set —
  [OFFLINE_ARCHITECTURE.md](../../offline/OFFLINE_ARCHITECTURE.md),
  [SYNC_PROTOCOL.md](../../offline/SYNC_PROTOCOL.md),
  [LOCAL_DATABASE.md](../../offline/LOCAL_DATABASE.md),
  [CONFLICT_RESOLUTION.md](../../offline/CONFLICT_RESOLUTION.md),
  [IDEMPOTENCY_AND_RETRIES.md](../../offline/IDEMPOTENCY_AND_RETRIES.md),
  [SECURITY_AND_DEVICE_MANAGEMENT.md](../../offline/SECURITY_AND_DEVICE_MANAGEMENT.md),
  [OFFLINE_CAPABILITIES_MATRIX.md](../../offline/OFFLINE_CAPABILITIES_MATRIX.md),
  [FAILURE_RECOVERY.md](../../offline/FAILURE_RECOVERY.md) — plus
  [AUTHENTICATION.md](../../api/AUTHENTICATION.md) §2 (device endpoints),
  [IDEMPOTENCY.md](../../api/IDEMPOTENCY.md),
  [ERROR_MODEL.md](../../api/ERROR_MODEL.md) §4,
  [API_CONVENTIONS.md](../../api/API_CONVENTIONS.md),
  [SYNC_TESTS.md](../../testing/SYNC_TESTS.md) (the phase gate),
  [TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md) (Y-series),
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §10 (D-01…D-08),
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md),
  [MONITORING.md](../../operations/MONITORING.md),
  [TROUBLESHOOTING.md](../../operations/TROUBLESHOOTING.md) §sync,
  [CONSTRAINTS_AND_INDEXES.md](../../database/CONSTRAINTS_AND_INDEXES.md)
  (`ix_change_log_tenant_entity_seq`, phase 020).

## 4. Design Impact

- **Database changes:** new tenant-owned tables `change_log` (tenant_id, entity_type,
  entity_id, op, changed_at, `seq` bigint drawn from a global sequence — the sanctioned
  non-PK sequence use for sync cursors, distinct from the UUIDv7-PK rule of
  [DATABASE_CONVENTIONS.md](../../database/DATABASE_CONVENTIONS.md) §2), `tombstones`,
  `sync_cursors` (device_id, entity_type, last_seq), `inbox_commands` (tenant_id,
  device_id, command_id, processed_at, result) — all with RLS `USING`+`WITH CHECK`,
  `FORCE RLS`, composite tenant FKs, catalog entries in
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) in the same phase (sync rule),
  and the feed index `ix_change_log_tenant_entity_seq`. `devices` (identity-owned)
  gains sync-state columns (capabilities, contract version, trust flags, last_seen).
  The tenant-owned-table registry and attack suite expand in the same PR
  ([TENANT_ISOLATION.md](../../database/TENANT_ISOLATION.md) §5 expansion rule).
- **API changes:** `POST /api/v1/devices` (registration + attestation-lite challenge —
  endpoint exists from PHASE-003; this phase completes its sync semantics),
  `GET /api/v1/sync/status`, `GET /api/v1/sync/pull`, `POST /api/v1/sync/push`,
  `POST /api/v1/sync/pull/ack`, `POST /api/v1/sync/push/ack`
  ([API_CONVENTIONS](../../api/API_CONVENTIONS.md) envelopes; sync pull carries its own
  limits; batch `Idempotency-Key` required). New reason codes are already in the
  [ERROR_MODEL](../../api/ERROR_MODEL.md) §4 registry — additions follow the registry PR
  process and must update the chaos contract together (SYNC_TESTS §9 rule 3).
- **UI changes:** admin console additions — device registry/management screens
  (feature key `offline.device_management`; permission keys per
  [AUTHORIZATION_MATRIX.md](../../security/AUTHORIZATION_MATRIX.md):
  `sync.devices.register`/`sync.devices.revoke`, `identity.devices.manage`), sync health
  dashboard panels, and the revoked-device reconciliation queue. No end-user app screens.
- **Security & authorization:** server-final permission enforcement on every pushed
  command (route + service layers, exactly like online); permission snapshot as
  UI-gating cache only; attack-test additions D-01…D-08 (revocation, encryption-at-rest,
  tampered rows, snapshot expiry, clock skew) and the PHASE-020+ spoof scenario
  (tenant-A device pushing tenant-B references → rejection, no existence leak);
  token-bucket rate limiting per device with cheap rejection before the DB-heavy path
  (R-06); `erp_rls_denials_total` stays 0.
- **Accounting implications:** no new posting rules. This phase TRANSPORTS commands into
  the existing posting engine; INV-013 (posting-operation keys) is the exactly-once
  ledger guarantee under duplicate delivery; INV-011 (period locks) enforced at sync
  execution; INV-018 (stock/journal atomicity) exercised by the chaos oracle;
  official numbers assigned only inside the server transaction (INV-021 numbering
  continuity; `OFF-…` local refs reconcile 1:1 per
  [DOCUMENT_LIFECYCLE.md](../../accounting/DOCUMENT_LIFECYCLE.md) §4).
- **Localization implications:** rejection `message` fields are `LocalizedText` (AR+EN)
  from the existing message catalog; admin screens bilingual with RTL layout; the
  honest-state badges (`PENDING_SYNC`, `DRAFT_LOCAL`, `SYNC_FAILED` —
  [GLOSSARY.md](../../GLOSSARY.md)) have canonical Arabic strings reused by later client
  phases.
- **Offline implications:** this phase IS the offline foundation: the capability classes
  (OFFLINE-COMPLETE / OFFLINE-DRAFT / LOCALLY-VALIDATED-PENDING-SERVER / ONLINE-ONLY)
  become enforced enums in `packages/contracts`, and the matrix becomes a CI-checked
  artifact (implemented gates must match the row's class and phase column).
- **Module dependencies:** `sync` module (new) consumed by all later offline clients;
  sync depends on `identity` (devices, tokens), `audit` (lifecycle events), `tenancy`
  (suspension events), and routes commands INTO `sales`, `treasury`, `inventory`,
  `partners`, `items` via their published services — never raw table writes
  ([MODULE_BOUNDARIES](../../architecture/MODULE_BOUNDARIES.md) cross-module write
  matrix); `tenant.suspended` and `sync.push.rejected` in-process events wired
  (MODULE_BOUNDARIES events table).

## 5. Implementation Plan

| # | Task | Expected files | Test hook |
|---|------|-----------------|-----------|
| T1 | Server migrations: `change_log`, `tombstones`, `sync_cursors`, `inbox_commands` (+ RLS, tenant FKs, feed index); `devices` sync-state columns; ENTITY_CATALOG/TABLES/ERD entries | `apps/api/migrations/0NNN_sync_foundation.sql`, docs/database | fresh+regression migration CI; RLS presence check; attack suite on new tables |
| T2 | Change-feed writer infrastructure: transactional feed publication on entity change, seq assignment, chunking of oversized logical changes, tombstone emission on soft-delete | `apps/api/src/modules/sync/feed/**` + module hooks | integration: feed ordered by seq; page-cap chunking; feed entries transactional with command execution |
| T3 | Device registry service: registration (permission-gated), attestation-lite nonce challenge, capabilities negotiation, trust flags, revocation (self/admin/operator), lifecycle audit events | `apps/api/src/modules/sync/devices/**` | D-01; audit-event assertions; registration without permission → 403 |
| T4 | Scoped device credentials: rotating one-time-use refresh tokens (device-bound), 15-min access tokens, reuse detection → revoke + alarm | `apps/api/src/modules/identity/**` (device token paths) | M-05 (reused refresh → chain revoked); rotation audit rows |
| T5 | Pull endpoint: signed opaque cursors, envelope, bootstrap snapshots per entity type, limits (500/1000/≤2 MB), `hasMore`, tombstone items | `apps/api/src/modules/sync/api/**` | contract tests; C-05 (flap re-pull), C-12 (cursor regression → resync directive) |
| T6 | Push endpoint: batch validation, batch + per-command idempotency keys, per-item result channel, typed reason registry, DEFERRED semantics, ordering (per-entity FIFO, array-order causality) | `apps/api/src/modules/sync/api/**` | C-01…C-04, C-08, C-13; reason-code exactness asserts |
| T7 | Command handler framework: per-intent executors calling owning-module services, permission + entitlement + branch-scope re-checks, posting-engine routing for financial intents | `apps/api/src/modules/sync/handlers/**` + module service seams | Y-01…Y-04 push isolation; generated permission checklist |
| T8 | Inbox dedupe + retention: `(tenant, device, command_id)` + idempotency-key lookup, stored-result replay with `duplicate: true`, `sync.inbox.retention` job (≥ 30 days, audited) | `apps/api/src/modules/sync/inbox/**` | duplicate replay tests (2×, 10×, concurrent, cross-batch); retention job idempotence |
| T9 | Conflict policies: SERVER_DECISION validators (period, stock, price tolerance, credit limit incl. in-flight), SAS price/tax pull-only enforcement, partner-contact FIELD_LEVEL_MERGE (per-field results + audit), drafts OWNER_DEVICE_WINS (+ `drafts.reassign` transfer, audited), `baseVersion` → `STALE_VERSION` with `details` | `apps/api/src/modules/**` validators + `apps/api/src/modules/sync/policies/**` | CONFLICT_RESOLUTION §2 table tests; C-09 (drain rejects), C-10 (two devices), C-11 (tombstone) |
| T10 | `packages/sync-core` v1: outbox/inbox/cursors/meta schema (LOCAL_DATABASE §1.2), full-jitter retry scheduler, cycle engine, contract-version gate + read-only mode, recovery sequence (WAL roll-forward, IN_FLIGHT→QUEUED), integrity check + corruption path, LRU pruning | `packages/sync-core/**` | unit + property tests; harness-native reference device in chaos matrix |
| T11 | Contracts: `CONTRACT_VERSION` export, capability-class enums, lite projections (partners lite etc.), per-device-class subset manifests, local forward-only migrations | `packages/contracts/**`, `packages/sync-core/migrations/**` | SQLite mirror suite; migration-in-transaction test; REAL-type lint ban |
| T12 | Permission snapshot feed entity + 7-day watermark degrade (read-only + online-required writes) | `apps/api/src/modules/identity/snapshot/**` + feed writer | D-04; downgrade propagates on next sync without app update |
| T13 | Maintenance jobs: inbox retention, tombstone GC, cursor compaction (+ > 7-day lag alert), feed health (+ > 10-min stall alert) | `apps/api/src/jobs/sync/**` | job idempotence; stall alert fires on seeded feed freeze |
| T14 | Admin + monitoring: device management screens, sync health dashboard (push success/latency, cursor lag by entity, conflicts by type, rejections by reason), revoked-device reconciliation queue; pre-flight `change_log` growth note | `apps/web/src/app/admin/**`, dashboards config | admin E2E journey; dashboard panels present; reconciliation queue → zero monitored |
| T15 | Chaos harness + FULL matrix green: deterministic sim (seeded RNG), fault-injection proxy, real API + Testcontainers PG + real local-store code; C-01…C-16 + Y-series + D-series wired as blocking CI (≤ 15 min) | `tests/sync-chaos/**`, CI workflow | `SEED=<n> pnpm test:sync-chaos` green; failed scenario replays byte-identically |
| T16 | k6 sync-fleet scenario: 500 simulated devices pulling/pushing, 5% revoked, fault-free profile | `tests/performance/sync-fleet.js` | T-05 p95 < 3 s; revoked path cheap (R-06 rule) |
| T17 | Capabilities matrix cross-check tooling: implemented capability gates vs matrix rows (class, policy, state machine, phase column) | `scripts/check-capabilities-matrix.ts` + fixture | row-by-row output quoted in completion report (matrix §5.3) |
| T18 | Docs updates: OFFLINE set status notes if implementation deviates, monitoring/deployment additions, FEATURE_CATALOG keys status, CHANGELOG | `docs/**` | docs validation script green |

## 6. Verification

**Automated tests (required):**

- **FULL sync chaos matrix C-01…C-16** per [SYNC_TESTS.md](../../testing/SYNC_TESTS.md)
  — blocking, ≤ 15 min budget, deterministic via seeded RNG; the ledger oracle asserts
  INV-013 (per-source journal uniqueness), INV-001/002 (balance), INV-018
  (stock/journal atomicity), INV-009/010 (subledger equality), honest-state markers.
  Highlight scenarios: C-01 duplicates (3× delivery → one effect, original result
  replayed `duplicate: true`); C-03 partial batch (per-item, zero residue); C-04 crash
  post-commit pre-ack (idempotent resume); C-06 revoked device (zero effects);
  C-09 POS drain with rejects (typed reconciliation, honest `PENDING_SYNC` throughout);
  C-13 tenant switch (no cross-tenant delivery, 404-equivalent semantics).
- Duplicate-delivery set from
  [IDEMPOTENCY_AND_RETRIES.md](../../offline/IDEMPOTENCY_AND_RETRIES.md) §5: same
  command 2×/10×/concurrently; 35-day-old restored outbox (replay or reconciliation
  flag, never double-post); clock skew ±48 h (no ordering/acceptance differences).
- Pull mechanics: cursor advances only after local commit; crash between apply and
  advance re-pulls the same page; tombstone deletes row + cached children in one local
  transaction; tombstone for an unknown row is a no-op; page caps enforced.
- Device security D-01…D-08 (applicable rows) per
  [SECURITY_TEST_PLAN.md](../../security/SECURITY_TEST_PLAN.md) §10; isolation Y-01…Y-04
  per [TENANT_ISOLATION_TESTS.md](../../testing/TENANT_ISOLATION_TESTS.md).
- Migration tests (fresh + regression) and RLS attack tests on all four new tables;
  tenant-table registry expanded in the same PR.

**Manual verification:**

1. Register a desktop-class device from a user account (attestation-lite challenge
   visible in audit), pull a bootstrap snapshot, push a draft — inspect per-item results.
2. Revoke the device mid-queue: pull returns `DEVICE_REVOKED`, pushes rejected before
   execution, pending operations appear in the tenant reconciliation queue; close the
   queue to zero.
3. Force a contract-version skew: device receives `422 CONTRACT_VERSION_UNSUPPORTED`
   and enters read-only update mode — no fabricated writes.
4. Sync health dashboard shows live cursor lag, rejection reasons, and outbox lag;
   kill the feed writer and watch `sync.feed.health` alert fire.

**Acceptance criteria (objective):**

1. Full chaos matrix C-01…C-16 green in CI on the generalized protocol, with a logged
   seed reproducing any failure byte-identically.
2. Duplicate delivery of a financial command (any multiplicity, including concurrent and
   cross-batch) produces exactly one journal effect and one official number (INV-013),
   and the first result is replayed with `duplicate: true`.
3. Pull cursors are opaque signed tokens; pages are contiguous seq windows; crash at any
   point converges by re-pull; no full-table dump exists anywhere in the protocol.
4. Push batches are never all-or-nothing: per-item results with exact registry codes and
   machine-readable `details`; `DEFERRED` items are not executed and not recorded in the
   inbox.
5. Inbox retention ≥ 30 days is enforced by an audited job; every command class retains
   a second durable dedupe layer after inbox expiry.
6. LWW is absent for all constrained entity types (negative test: attempted
   last-write-wins merge of a financial document fails policy review AND the test suite);
   partner-contact merges produce per-field results + field-level audit events.
7. A PHASE-016 POS terminal syncs unchanged against the generalized server (same wire
   contracts; subset scope enforced server-side); any deviation is decision-recorded.
8. Revocation and suspension take effect per SECURITY_AND_DEVICE_MANAGEMENT §4: pulls
   `DEVICE_REVOKED`/`TENANT_SUSPENDED`, pushes rejected pre-execution with zero ledger
   effects, refresh exchange fails; in-flight requests complete within ≤ token lifetime.
9. Cross-tenant push attempts (device of tenant A referencing tenant B entities) reject
   with no effects and no existence disclosure (C-13 + Y-series green).
10. Sync health dashboard, alerts (`SyncPushFailSpike`, `SyncCursorStall`), `outbox.lag`
    and `device.revoked.pending_ops` gauges are live; every alert links a
    [TROUBLESHOOTING.md](../../operations/TROUBLESHOOTING.md) §sync runbook entry.
11. k6 sync-fleet scenario passes T-05 (p95 < 3 s) with 500 devices and 5% revoked.
12. Capabilities matrix cross-check output (row-by-row) is quoted in the completion
    report; every implemented cell matches its class/policy/state-machine columns.
13. Docs: ENTITY_CATALOG/TABLES/ERD updated, `ix_change_log_tenant_entity_seq` present,
    docs validation green; criteria copied into
    [PHASE_ACCEPTANCE_CRITERIA.md](../../planning/PHASE_ACCEPTANCE_CRITERIA.md).

**Performance & security considerations:** T-05 sync round-trip budget; page caps bound
memory; feed writes transactional with command execution (no hot-table double writes);
device tokens memory-only on clients, never in SQLite or logs
(SECURITY_AND_DEVICE_MANAGEMENT §3); rate-limit rejection is cheap (R-06); `change_log`
is a hot growth table — growth monitoring + partitioning decision trigger noted in
[DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7; RLS denial counter must remain 0.

**Migration & rollback:** forward-only migrations per
[MIGRATION_STRATEGY.md](../../database/MIGRATION_STRATEGY.md) (expand-contract; feed
tables start empty — no backfill); app-level rollback = previous image with new tables
ignored (no destructive steps); mixed client fleets protected by the contract-version
gate; local (SQLite) migrations are forward-only and contract-mapped — never shipped
down. Protocol-behavior changes update SYNC_PROTOCOL.md in the same PR as the chaos
suite (executable-spec rule).

## 7. Risks and Constraints

- **RISK-011** (sync double-posting / lost sales) is THE risk this phase exists to kill:
  three dedupe layers + full chaos matrix as the blocking gate; any oracle mismatch is a
  release blocker triaged per
  [INCIDENT_RESPONSE.md](../../security/INCIDENT_RESPONSE.md) ladder (ledger effects =
  SEV-1 class).
- **RISK-004** (offline expectations exceed protocol capacity): the capabilities matrix
  is enforced and communicated honestly; no real-time multi-user offline collaboration
  is implied anywhere.
- **RISK-010** (cross-tenant leak): four new tenant-owned tables + device-scoped
  credentials widen the surface — attack suite expansion + Y-series + C-13 are
  mandatory, not optional.
- **RISK-014** (performance under volume): `change_log` growth and push throughput are
  load-tested (T-05, sync-fleet); feed pagination prevents unbounded page sizes.
- **RISK-012** (young-library friction): better-sqlite3/SQLCipher and Drizzle-on-SQLite
  rough edges are expected; raw-SQL escape hatch allowed with usage recorded.
- **RISK-019/020** (agent drift / docs drift): the chaos suite is the executable spec of
  SYNC_PROTOCOL.md — same-PR update rule; completion report quotes the matrix
  row-by-row.
- Constraint: POS-scoped PHASE-016 clients must keep working untouched on day one
  (SYNC_PROTOCOL §11 rule 3) — no breaking wire change may ship in this phase.

## 8. Completion and Handoff

- **Completion evidence:** report at
  `docs/implementation/phases/reports/PHASE-020-COMPLETION.md` with: full chaos-matrix
  CI output (C-01…C-16, seed logged), duplicate-delivery proofs (INV-013 assertion
  output), Y-series + D-series results, interoperability proof against a PHASE-016
  terminal, k6 sync-fleet report (T-05), capabilities-matrix cross-check table,
  dashboard screenshots-as-secondary, docs validation output.
- **Documentation updates required:**
  [IMPLEMENTATION_STATUS.md](../../planning/IMPLEMENTATION_STATUS.md) (PHASE-020 →
  COMPLETE), `docs/handoff/CURRENT_STATE.md`, `docs/handoff/CHANGELOG.md`,
  [ENTITY_CATALOG.md](../../database/ENTITY_CATALOG.md) + TABLES + ERD,
  [MONITORING.md](../../operations/MONITORING.md) (sync dashboards live),
  [DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7 (pre-flight addition),
  FEATURE_CATALOG keys `offline.sync_protocol` / `offline.device_management` status.
- **Exit criteria:** all acceptance criteria green with evidence; full chaos matrix
  blocking in CI from this phase on (every push); PHASE-016 interop proven; sync
  dashboards/alerts live in staging; docs synchronized; zero TODOs in shipped code.
- **Definition of Done:** protocol + sync-core + reference store + admin/monitoring all
  in `main`; `pnpm test:sync-chaos` green deterministically; no end-user app code added;
  IMPLEMENTATION_STATUS updated with report link and `phase/020` tag.
- **Handoff instructions:** the protocol is now FROZEN — wire-contract changes require a
  decision record + chaos-suite + SYNC_PROTOCOL.md updates in one PR. Next implementers
  read the PHASE-020 completion report, then build clients strictly from
  `packages/sync-core` + the capabilities matrix (no bespoke sync code). **Next eligible
  phase: PHASE-021 — Desktop Application** (PHASE-022 and PHASE-023 also become
  eligible; agents still execute one phase at a time —
  [PHASE_DEPENDENCY_GRAPH.md](../../planning/PHASE_DEPENDENCY_GRAPH.md) parallelism
  notes). Identify only; do not implement.
