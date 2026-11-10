# OFFLINE_AND_SYNC_ARCHITECTURE — Platforms, Local Storage, Synchronization, and Conflict Resolution

> **Status:** STABLE · **Owner:** Offline & Sync Architecture · **Updated:** 2026-10-28 (consolidation pass)
> **Authority:** Consolidates the offline strategy. Normative detail remains in
> [OFFLINE_ARCHITECTURE.md](OFFLINE_ARCHITECTURE.md), [LOCAL_DATABASE.md](LOCAL_DATABASE.md),
> [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md), [CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md),
> [IDEMPOTENCY_AND_RETRIES.md](IDEMPOTENCY_AND_RETRIES.md),
> [OFFLINE_CAPABILITIES_MATRIX.md](OFFLINE_CAPABILITIES_MATRIX.md),
> [SECURITY_AND_DEVICE_MANAGEMENT.md](SECURITY_AND_DEVICE_MANAGEMENT.md),
> [FAILURE_RECOVERY.md](FAILURE_RECOVERY.md).
> ADRs: [../architecture/ADR/ADR-0012-offline-sync.md](../architecture/ADR/ADR-0012-offline-sync.md),
> ADR-0013 (Tauri), ADR-0014 (Expo).

## 1. Platform strategy (compared, then chosen)

| Option | Verdict | Reason |
|--------|---------|--------|
| PWA-only offline | Rejected | No robust local SQL, device security, or printer integration for POS/van-sales |
| Web + Tauri desktop + Expo Android (chosen) | Accepted | Desktop/Android are **clients only**; all business rules server-side; local SQLite per client; maximal reuse of contracts + domain-core; documented in ADR-0013/0014 |
| Electron first | Fallback only | Heavier, resource-hungry; Tauri v2 chosen, Electron kept as documented fallback |
| Capacitor wrap | Rejected | RN-specific UI + shared domain-core beats a WebView wrap for offline field work (ADR-0014) |

Staging (binding): **web is online-only at MVP**; POS gets a scoped offline queue at
PHASE-016; general offline (desktop/Android, change feeds, pull/push) lands at PHASE-020;
desktop 021, Android 022. No earlier phase may claim offline writes.

## 2. What works offline (36-operation × 4-device-class matrix)

The authoritative capability matrix: [OFFLINE_CAPABILITIES_MATRIX.md](OFFLINE_CAPABILITIES_MATRIX.md)
— per operation: `cached / local-draft / online-only`, conflict policy, and post-sync
state machine. Summary of the rules:

- Offline-creatable: POS sales (scoped queue), receipts, van-sales documents, item/partner
  reference reads (cached) — each prints a temporary **`OFF-` number** reconciled 1:1
  with the server-assigned official number at sync ("pending sync" printed honestly).
- Online-only: financial statements, period close, compliance exports, user administration.
- **Posting is server-authoritative:** the local device never computes GL effects; the
  server posting engine does, at sync, under full validation.

## 3. Local database

SQLite (SQLCipher-encrypted), money as TEXT decimal strings (never float affinity),
UUIDv7 generated locally, per-device schema version with migrations, outbox table as the
sacred unit ("cache is expendable, outbox is sacred"), device keys never in the local DB
([LOCAL_DATABASE.md](LOCAL_DATABASE.md)).

## 4. Sync protocol

- **Pull:** opaque signed cursors, page caps (500 items / 2 MB), tombstones for deletes.
- **Push:** batches ≤ 50 commands / 1 MB with **per-item results** `ACCEPTED / REJECTED /
  DEFERRED` (never all-or-nothing); ordering rules per entity (document before lines);
  clock-skew is advisory-only (server timestamps authoritative).
- **Idempotency — three layers:** command keys ≥ 30 d in the sync inbox; the permanent
  posting-operation key `(tenant_id, source_type, source_id, operation)`; inbox dedupe.
  Duplicate deliveries are tested by the 6-scenario suite + chaos tests.
- Endpoints and envelopes: [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) §2–3.

## 5. Conflict resolution (per-entity policy; LWW forbidden for money/stock)

| Class | Policy |
|-------|--------|
| Financial amounts/stock | **Never merge, never invent**: re-validate server-side at sync (price re-priced, credit limit re-checked in receipt order, stock re-verified); on failure → REJECT with reason, draft preserved for edit |
| Drafts | Owner-device-wins (drafts are single-user artifacts) |
| Reference/contact fields | Server-wins or field-merge for the narrow allowed set (partner contact fields), with audit |
| Configuration | Server authoritative; local cache invalidated by events |

Two worked examples (two terminals overselling the last unit; concurrent contact-field
merge) are specified in [CONFLICT_RESOLUTION.md](CONFLICT_RESOLUTION.md) §6. Offline
serial double-sell of the same physical unit is an **acknowledged residual business risk**
(case #35, documented, not system-guaranteed-impossible).

## 6. Device security and lifecycle

Registration → per-device keys → attestation-lite at sync → revocation wipes outbox +
cache; cached permission set re-validated at sync time (revoked users/devices cannot
push); lost-device playbook in [SECURITY_AND_DEVICE_MANAGEMENT.md](SECURITY_AND_DEVICE_MANAGEMENT.md);
12-scenario failure recovery playbook in [FAILURE_RECOVERY.md](FAILURE_RECOVERY.md)
(crash mid-push, replay storms, contract skew, tamper…).

## 7. Testing gates

Chaos suite C-01…C-16 with deterministic seeded RNG and a **ledger oracle** asserting
journal uniqueness/balance/atomicity after every fault; sync tests gate PHASE-020;
"zero ledger residue" applies to every rejected offline command.
[../testing/SYNC_TESTS.md](../testing/SYNC_TESTS.md).

## 8. Known limitation (recorded, not hidden)

Financial statements are online-only on every device class; offline accountants cannot
run a TB locally. Recorded as consolidated open question OQ-C-1
([../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md](../ARCHITECTURE_RISKS_AND_OPEN_QUESTIONS.md));
any change requires an ADR because it touches the posting-authoritative principle.
