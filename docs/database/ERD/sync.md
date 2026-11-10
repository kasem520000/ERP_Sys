# ERD — Offline Sync Cluster (PHASE-020)

> **Status:** DELIVERED (PHASE-020, migrations `0029_sync_foundation.sql` +
> `0030` + `0031`; the 016 slice in `0024_pos_core.sql`) ·
> **Owner:** Database Architecture · **Updated:** 2026-11-04 · **Phases:** 016 (slice) / 020

Core attributes only. Column-level specifications live in
[TABLES/sync.md](../TABLES/sync.md) (authored in PHASE-020) — sync rule in
[database README](../README.md#synchronization-rule-normative); the Drizzle
schema is the machine-readable mirror. The sync substrate carries **no FKs on
tenant_id** by design (tenant deletes never cascade through sync
bookkeeping); `devices`/`device_refresh_tokens` are identity-owned,
service-mediated (no tenant_id, no RLS — the PHASE-003 §4 rule).

```mermaid
erDiagram
  users ||--o{ devices : "registers (003)"
  devices ||--o{ device_refresh_tokens : "rotation chain (CASCADE)"
  device_refresh_tokens |o--o{ device_refresh_tokens : "predecessor_id"
  devices ||--o{ sync_cursors : "pull positions (hint)"
  devices ||--o{ inbox_commands : "executed commands (dedupe)"
  devices |o--o{ sales_invoices : "owner_device_id (OWNER_DEVICE_WINS drafts)"
  devices |o--o| pos_terminals : "one terminal = one device (016)"
  tenants ||--o{ change_log : "feed rows (no FK - the 0024 pattern)"
  tenants ||--o{ tombstones : "GC ledger (no FK)"
  tenants ||--o{ sync_cursors : ""
  tenants ||--o{ inbox_commands : ""

  devices {
    uuid id PK
    uuid user_id FK
    text platform "003 compat"
    text device_class "pos-terminal|tauri-desktop|android-field|android-personal"
    text key_hash "enrollment proof (sha256)"
    text contract_version "the C-08 gate input"
    text attestation_public_key "ed25519 (020)"
    text attestation_nonce "issued at registration"
    timestamptz attested_at "set on verify"
    jsonb trust_flags "audited admin plane"
    jsonb capabilities
    timestamptz last_pull_at "outbox-lag gauge"
    timestamptz last_push_at "outbox-lag gauge"
    timestamptz data_expires_at "lost-device remote expiry (021 consumer)"
    timestamptz revoked_at
  }
  device_refresh_tokens {
    uuid id PK
    uuid device_id FK "CASCADE"
    text token_hash UK "hash-at-rest"
    uuid predecessor_id "successor -> consumed predecessor"
    timestamptz issued_at
    timestamptz expires_at "CHECK > issued_at"
    timestamptz used_at "reuse tripwire (one-time-use)"
    timestamptz revoked_at
  }
  change_log {
    bigint seq "bigserial - the page window"
    uuid tenant_id "no FK (0024 pattern)"
    text entity_type "shape-checked"
    text entity_id
    text op "UPSERT|DELETE"
    jsonb payload "DELETE keeps source payload (watermark)"
    timestamptz changed_at
  }
  sync_cursors {
    uuid tenant_id "no FK"
    uuid device_id
    text entity_type
    bigint last_seq
    timestamptz acknowledged_at "lag-gauge column"
  }
  tombstones {
    uuid id PK
    uuid tenant_id "no FK"
    text entity_type "shape-checked"
    text entity_id
    timestamptz deleted_at "app-provided"
    timestamptz gc_after "weekly sweep boundary"
  }
  inbox_commands {
    uuid id PK
    uuid tenant_id "no FK"
    uuid device_id
    text command_id "v2 replay key (UQ w/ tenant+device)"
    text idempotency_key "legacy lookup"
    text entity_type
    text intent
    text status "ACCEPTED|REJECTED (never DEFERRED)"
    jsonb result "replayed with duplicate:true"
    timestamptz processed_at "30d retention key"
  }
```

Note: `sales_invoices.owner_device_id` (0029) is the only FK-carrying sync
addition into a business table — stamped at device draft creation, checked on
`update_draft`, re-stamped by the admin reassign route
([../../offline/CONFLICT_RESOLUTION.md](../../offline/CONFLICT_RESOLUTION.md)
§2 OWNER_DEVICE_WINS). The `permissions` snapshot rows ride `change_log` with
`entity_type = 'permissions'` (per-device-user key sets, ≤ 1 row / 6d idle;
[SECURITY_AND_DEVICE_MANAGEMENT.md](../../offline/SECURITY_AND_DEVICE_MANAGEMENT.md)
§4).
