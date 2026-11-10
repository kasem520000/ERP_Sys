# TABLES — Offline Sync Cluster (PHASE-016 slice / PHASE-020 generalized)

> **Status:** DELIVERED (PHASE-020, migrations `0029_sync_foundation.sql` +
> `0030_sync_change_log_sequence_grant.sql` + `0031_sync_draft_line_replace.sql`;
> the 016 slice predates it in `0024_pos_core.sql`) · **Owner:** Database
> Architecture · **Updated:** 2026-11-04 · Column-level specs for the sync
> substrate: the change feed (`change_log`), pull positions (`sync_cursors`),
> the soft-delete GC ledger (`tombstones`), the push dedupe ledger
> (`inbox_commands`), the device credential chain (`device_refresh_tokens`),
> and the `devices` registry widening. The sync substrate deliberately carries
> **no FKs on tenant_id** (the 0024 pattern — tenant deletes never cascade
> through sync bookkeeping; GC is the jobs' concern). The device-local SQLite
> mirror is [../../offline/LOCAL_DATABASE.md](../../offline/LOCAL_DATABASE.md)
> — owned by `packages/sync-core` (LOCAL_MIGRATIONS v2: `inbox` + `meta`).

## §change_log — the ordered change feed (016 base, 0024; generalized 020)

`tenant_id`, `entity_type` (shape-checked `^[a-z][a-z0-9_]{2,40}$`), `entity_id`
(text — UUIDv7 as string), `op` CHECK `('UPSERT','DELETE')`, `payload` jsonb
NULL allowed (DELETE rows keep their source payload — the watermark reads
`payload->>'changedAt'`; the PULL ENVELOPE nulls payload + version on DELETE),
`changed_at` timestamptz, `seq` bigserial. Hot index
`ix_change_log_tenant_entity_seq` (tenant_id, entity_type, seq) — the pull
page window scan. Writers (all inside the owning module's transaction):
per-command `publishFeedEntries` (push results), the 9-entity catch-up
projections (items, barcodes, uoms, price_list_items, partners, tax_codes,
pos_terminals, cashier_shifts, sales invoices for the drafts feed), and the
`permissions` snapshot rows. Migration **0030** closed the 0024 grant gap
(`GRANT USAGE, SELECT ON SEQUENCE change_log_seq_seq TO erp_app` — INSERT
existed but `nextval()` was denied for the app role; invisible until a spec
exercised the INSERT path). **Hot growth table** — pre-flight guidance in
[../../operations/DEPLOYMENT.md](../../operations/DEPLOYMENT.md) §7.

## §sync_cursors — per-device pull positions (016 base; the hint, never the truth)

`(tenant_id, device_id, entity_type)` UNIQUE — one row per pair; `last_seq`
(the acknowledged feed position), `acknowledged_at` (the lag-gauge column —
`now() − acknowledged_at` feeds the health aggregate + the daily
`sync.cursor.compact` lag audit with deduped owner notifications). Correctness
never depends on it (the client's local cursor is authoritative for resume —
SYNC_PROTOCOL §2.8); `pull/ack` upserts it and touches
`devices.last_pull_at`.

## §tombstones — the soft-delete GC ledger (020, 0029)

Tenant-owned + RLS. `(tenant_id, entity_type, entity_id)` UNIQUE (idempotent
upsert extends `gc_after`); `entity_type` shape CHECK; `deleted_at` +
`gc_after` timestamptz both app-provided (no DEFAULT tying them — the writer
sets both in one statement). Feed entries are the transport; this table is the
boundary bookkeeping so a device that missed a delete within the horizon can
still be told. DELETE entries are emitted only for sources with a soft-delete
lifecycle (items/partners `deleted_at`); pos_terminals/cashier_shifts/uoms/
tax_codes/barcodes/price_list_items have no delete lifecycle — deactivation
rides the UPSERT payload. Index `ix_tombstones_tenant_gc` (tenant_id,
gc_after) — the weekly `sync.tombstone.gc` sweep's scan slice (gc_after <
now(), bounded 5000/loop, audited). Grants: full CRUD for `erp_app` (the GC
job deletes).

## §inbox_commands — the push dedupe ledger (020, 0029)

Tenant-owned + RLS. One row per **EXECUTED** command — status CHECK
`('ACCEPTED','REJECTED')`; `DEFERRED` (rate-limited) commands are never
recorded (they were not executed; the client retries the same command_id).
`(tenant_id, device_id, command_id)` UNIQUE (the v2 replay key), plus
`(tenant_id, device_id, idempotency_key)` legacy lookup; `result` jsonb stores
the exact per-item result replayed with `duplicate: true` on redelivery
(C-01/C-04). `processed_at` is the retention key — the daily
`sync.inbox.retention` job deletes `processed_at < now() − 30d` bounded
5000/loop with an audit summary row (the durable second dedupe layer is the
owning service's posting key — proven by the 35-day restored-outbox chaos
leg). Indexes: `ix_inbox_commands_tenant_idempotency` (tenant_id,
idempotency_key), `ix_inbox_commands_tenant_processed` (tenant_id,
processed_at). Grants: SELECT/INSERT/DELETE for `erp_app` (executed rows are
immutable — no UPDATE).

## §device_refresh_tokens — the rotating credential chain (020, 0029)

Identity-owned, service-mediated (the 0003 sessions pattern: **no RLS by
design** — devices has no tenant_id per the PHASE-003 §4 rule). `device_id`
FK → devices ON DELETE CASCADE; `token_hash` UNIQUE (hash-at-rest; the raw
token exists only in the device's memory — never in SQLite, never in logs);
`predecessor_id` links a successor to its consumed predecessor (the rotation
chain); `issued_at`/`expires_at` with the window CHECK
(`expires_at > issued_at`); **`used_at` is the reuse-detection tripwire** —
consumption is a conditional UPDATE (`SET used_at WHERE id AND used_at IS
NULL RETURNING`; zero rows ⇒ reuse ⇒ revoke the device + alarm + throw);
`revoked_at`. Rotation is one-time-use: refresh → access token (HS256 JWT,
15-min exp) + successor refresh token (30-day window). Grants:
SELECT/INSERT/UPDATE for `erp_app` — **no DELETE** (the chain history is the
reuse audit trail; purge is a future retention job's concern).

## §devices — the 020 registry widening (0029)

On the PHASE-003 table (003, service-mediated — no tenant_id, no RLS):
`device_class` CHECK `('pos-terminal','tauri-desktop','android-field',
'android-personal')` + `ix_devices_device_class` (the feed-group/capability
discriminator; `platform` stays for 003 compat); `contract_version` (the
C-08 gate input); `attestation_public_key`/`attestation_nonce`/`attested_at`
(the ed25519 challenge substrate — nonce issued at registration, attested_at
set on verify); `trust_flags` jsonb DEFAULT `'{}'` (the audited admin plane:
flag/expire/reconciliation_dismissed); `last_pull_at`/`last_push_at` (the
outbox-lag gauges, touched by the ack routes); `data_expires_at` (the
lost-device remote expiry — sync-core refuses local reads past it, the 021
consumer). Plus `sales_invoices.owner_device_id` (0029, two indexes) — the
OWNER_DEVICE_WINS drafts stamp; and migration **0031**'s
`GRANT DELETE ON sales_invoice_lines TO erp_app` (the sync update_draft
aggregate-replace path — DRAFT-only, single-writer; posted lines unreachable
by construction).

## Grants & roles (migrations 0029–0031)

`tombstones` SELECT/INSERT/UPDATE/DELETE + `inbox_commands`
SELECT/INSERT/DELETE + `device_refresh_tokens` SELECT/INSERT/UPDATE for
`erp_app`; SELECT for `erp_readonly`/`erp_definer`; RLS macro on both
tenant-owned tables; all three registered in the isolation suite's table
registry (`src/__db__/isolation/tables.registry.ts`). Permission seeds
re-asserted with 020 bilingual wording (sync.devices.register/revoke,
sync.settings.manage, identity.devices.manage — keys existed since 0004; the
matrix stays 243 = seed union, drift-green); plan grants
`offline.sync_protocol` + `offline.device_management` → business + enterprise
(the idempotent array_cat guard; starter excluded).
