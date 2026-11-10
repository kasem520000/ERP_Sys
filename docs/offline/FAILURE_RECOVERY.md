# Failure Recovery

> **Status:** STABLE · **Owner:** Offline & API Architecture · **Updated:** 2026-10-27

The scenario playbook for everything that can go wrong on the offline path. Each scenario
specifies: detection → immediate behavior → recovery → monitoring/prevention. Mechanisms
are defined in [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md),
[LOCAL_DATABASE.md](LOCAL_DATABASE.md), and
[IDEMPOTENCY_AND_RETRIES.md](IDEMPOTENCY_AND_RETRIES.md); observability conventions in
[../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md).

## 1. Scenario playbook

| # | Scenario | Detection | Immediate behavior | Recovery | Monitoring / prevention |
|---|----------|-----------|--------------------|----------|--------------------------|
| 1 | **App crash mid-outbox write** | Process death; SQLite WAL roll-forward at next start | Local transaction atomicity: business row + outbox command commit together or not at all ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §6.2) | Nothing to recover: either the full operation exists or it never happened; user re-enters if absent | Crash-free metrics per platform; WAL is mandatory config verified at startup |
| 2 | **Crash mid-sync (pull or push in flight)** | Missing response / connection reset | `IN_FLIGHT` commands reset to `QUEUED` at recovery ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §6.3); pull cursor only advances after page commit | Idempotent resume: same page re-pulled, same commands re-pushed; inbox dedupe replays stored results ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §4) | `sync.resume.count` metric; chaos test "kill at every step" ([../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md)) |
| 3 | **Server timeout on push** (effects may or may not have committed) | Client timeout | Batch left unresolved; other commands unaffected; NO assumption of failure or success | Next cycle re-pushes unresolved commands only; duplicates neutralized by inbox + posting keys — outcomes converge to exactly-once ([IDEMPOTENCY_AND_RETRIES.md](IDEMPOTENCY_AND_RETRIES.md) §4) | p95 push latency alert; server-side per-command audit lets support confirm what committed from the `traceId` |
| 4 | **Rejected batch (typed business rejections)** | Per-item `REJECTED` results | Documents parked `REJECTED` with typed reason + details; UI shows mandated actions ([CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §3) | User edits/accepts/cancels; resubmission creates new commands; every choice audited | Rejection-rate-by-code dashboard per tenant (e.g., `PRICE_CHANGED` spikes after a price campaign) |
| 5 | **Corrupted local DB** | `PRAGMA integrity_check` fails at start ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §6.4) | App blocks writes, informs user | Stage outbox/inbox → reset DB → re-run migrations → re-import outbox/inbox → full pull rebuilds caches. If outbox unrecoverable: explicit reconciliation incident — never silent loss | Integrity check at every start; corruption events reported (anonymized) to error tracker |
| 6 | **Device replacement** (new hardware) | User/admin action | Old device revoked; new device registers ([SECURITY_AND_DEVICE_MANAGEMENT.md](SECURITY_AND_DEVICE_MANAGEMENT.md) §2) | Old device's pending ops surface via revocation-rejection path; admin reassigns drafts/terminals (ownership transfer, [CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §6.3); new device bootstraps | `device.registered`/`device.revoked` audit pair; replacement runbook |
| 7 | **Revoked device with pending ops** | Push rejected per-item `DEVICE_REVOKED` | Device stops syncing; user informed | Pending operations listed in tenant reconciliation view for explicit accept/reject review by an authorized user ([SECURITY_AND_DEVICE_MANAGEMENT.md](SECURITY_AND_DEVICE_MANAGEMENT.md) §4.4) | Reconciliation queue must reach zero — monitored per tenant |
| 8 | **Stale contract version** (app older/older-server than schema expects) | `CONTRACT_VERSION_UNSUPPORTED` on pull/push ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §2.3) | Read-only sync mode + update prompt; writes blocked rather than fabricated | Update app (auto-update channel for Tauri, store update for Android); after update, full cycle resumes; incompatible cached entities re-pull via cursor reset | Forced-update rate metric; contract versions logged per device in device registry |
| 9 | **Split queues after connectivity flapping** (partial cycles, interleaved retries) | Cycle log shows interleaved batches/out-of-order acknowledgments | Per-entity FIFO + `baseVersion` checks make interleaving safe; local inbox mirror suppresses stale responses ([IDEMPOTENCY_AND_RETRIES.md](IDEMPOTENCY_AND_RETRIES.md) §4) | Sequence reconciliation: server compares processed command ids vs pushed ids; client outbox states converge (`QUEUED` shrinks to zero or parked `REJECTED`); any orphan server-side result without local application is re-delivered by replay | `outbox.lag` (count + age) gauge per device; flap events (≥ 3 cycles/min) logged |
| 10 | **Server-side feed stall** (change_log stops advancing for a tenant) | `sync.feed.health` job ([SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §10) | None client-side (pulls return empty deltas — correct behavior) | Ops alert with runbook; feed writer fix; clients self-heal on next advancing feed — cursors need no manual repair | Alert: no feed advance > 10 min for an active tenant |
| 11 | **Clock jump on device** (manual time change, timezone travel) | Local monotonic counters unaffected | Client timestamps are advisory only; scheduling uses local counters + server `retryAfterMs` | No reconciliation needed; server decisions never depended on device time ([CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §5) | Device clock-offset metric from `/sync/status` for support diagnostics |
| 12 | **Refresh-token reuse detected** (stolen token replay) | Server sees a rotated token reused ([SECURITY_AND_DEVICE_MANAGEMENT.md](SECURITY_AND_DEVICE_MANAGEMENT.md) §3) | Immediate device revocation + alarm | Kill-switch path (scenario 7); user re-authenticates and re-enrolls | Security alarm to on-call; `device.refresh_token_reuse_detected` audit event |

## 2. Recovery invariants (must hold in every scenario)

1. **No double financial effect** — a command that committed once can never commit again
   (INV-013 + command keys + inbox, [IDEMPOTENCY_AND_RETRIES.md](IDEMPOTENCY_AND_RETRIES.md) §1).
2. **No silent loss** — every user-originated operation is either synced (server state
   returned), parked as `REJECTED` with a typed reason, or surfaced as an explicit
   reconciliation incident. "Vanished" is not an allowed outcome.
3. **No fabricated acceptance** — no recovery path ever marks a local row `POSTED`
   without a server `ACCEPTED` result carrying the official number
   ([OFFLINE_ARCHITECTURE.md](OFFLINE_ARCHITECTURE.md) §5).
4. **Cache is expendable, outbox is sacred** — any recovery may drop/rebuild pulled read
   models; no recovery may drop an unresolved outbox command without an audited incident
   ([LOCAL_DATABASE.md](LOCAL_DATABASE.md) §6.5).
5. **Convergence without manual cursor surgery** — all recovery ends in a normal
   connect → pull → push → ack cycle; there is no supported "manual cursor fix" tool.

## 3. Monitoring hooks (per scenario)

| Hook | Type | Destination |
|------|------|-------------|
| `sync.cycle.duration`, `sync.push.items{status}`, `sync.pull.pages` | metrics | Prometheus-style exporter → dashboards ([../architecture/OBSERVABILITY.md](../architecture/OBSERVABILITY.md)) |
| `sync.resume.count`, `integrity.check.failed`, `contract.unsupported` | metrics + error events | dashboards + error tracker (Sentry-equivalent, tenant tag) |
| `outbox.lag` per device (count, oldest-age) | gauge | alert: > 100 items or > 24 h age |
| `device.revoked.pending_ops` (reconciliation queue depth) | gauge per tenant | alert: non-zero > 48 h |
| Rejection-rate by reason code | counter | per-tenant dashboard; anomaly detection on spikes |
| `sync.feed.health` stall, `boss` dead-letter growth for sync jobs | alerts | on-call runbook [../operations/TROUBLESHOOTING.md](../operations/TROUBLESHOOTING.md) |

Every alert links a runbook entry keyed by scenario number above; runbook steps reference
this table's recovery column — the playbook and the runbook are the same artifact at two
levels of detail.

## 4. Step-by-step support runbook (top scenarios)

**S5 — corrupted local DB (POS/desktop):**
1. Confirm the integrity-failure event on the device screen; do NOT let staff retry writes.
2. Support pulls the device's last sync state from the server (`sync_cursors` hint +
   outbox-lag metric) to know what was pending.
3. Trigger (or wait for) the app's reset flow: stage outbox/inbox → reset → re-pull.
4. Verify the outbox re-push completes; check reconciliation view for anything the server
   says it never received while the device was corrupted.
5. If the outbox was unrecoverable: open the reconciliation incident, list affected
   offline receipt numbers (`OFF-…`) missing server-side, and reconcile against drawer
   counts/shift records ([../accounting/DOCUMENT_LIFECYCLE.md](../accounting/DOCUMENT_LIFECYCLE.md) §4).

**S7 — revoked device with pending ops:**
1. Open the tenant reconciliation view (lists every `DEVICE_REVOKED`-rejected command).
2. With the department manager, walk each pending operation: record it server-side
   manually if it happened (cash sale that left goods/drawer) or mark it void with reason.
3. Reassign ownership of any drafts the device owned
   ([CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §6.3).
4. Close when `device.revoked.pending_ops` reaches zero for that device; audit trail
   retains the full review.

**S8 — stale contract version (forced update):**
1. Confirm the app/contract versions from the device registry vs the server changelog.
2. Push the update through the platform's channel (Tauri auto-update staged rollout /
   Play Store staged rollout).
3. Watch `contract.unsupported` metric fall to zero for the tenant; no server action can
   substitute for the client update — support must not attempt data "fixes".

## 5. Data-loss boundary (what can and cannot be lost)

| Data category | Can be lost in any scenario? | Bounded by |
|--------------|------------------------------|-----------|
| Pulled read models (caches, statements, prices) | Yes — by design, rebuilt by full pull | pull bandwidth + retention (LOCAL_DATABASE §5) |
| Unsynced outbox commands | Only if the local DB is corrupted AND staging fails — then they become an audited reconciliation incident, never silent loss | scenario 5; incident review |
| Accepted server state (documents, journals, stock) | No — server is authoritative; local damage cannot touch it | server backups ([../database/BACKUP_AND_RECOVERY.md](../database/BACKUP_AND_RECOVERY.md)) |
| Official numbers / ledger effects | No — assigned/committed only server-side in one transaction (ADR-0006/0007) | posting-engine invariants (INV-006, INV-013) |
| Sync progress (cursors) | At worst, re-pull from an earlier cursor | page idempotence (SYNC_PROTOCOL §2.7) |
| Device credentials | Revocable/replaceable; loss forces re-enrollment, never data exposure | keychain/keystore storage (SECURITY §3) |

This table is the answer to "what does an outage cost us?" — the platform's contract is
that the right-hand column is always a mechanism in this document set, not a hope.

