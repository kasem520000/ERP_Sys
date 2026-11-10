-- PHASE-020 · migration 0029 · offline synchronization foundation
--
-- Purpose (PHASE-020 MASTER-PLAN §3; SYNC_PROTOCOL §2/§3; LOCAL_DATABASE
-- §1): the substrate the generalized sync protocol runs on, all additive:
-- - `tombstones` (tenant-owned, RLS): the soft-delete GC ledger — feed
--   entries are the transport (op:'DELETE' rows ride change_log), this
--   table tracks the GC boundary (gc_after) so a device that missed a
--   delete within the horizon can still be told, and the weekly GC job
--   has a bounded sweep. Both deleted_at and gc_after are app-provided
--   (a DEFAULT tying gc_after to deleted_at would need a function — the
--   writer sets both in one statement).
-- - `inbox_commands` (tenant-owned, RLS): the push dedupe ledger — every
--   EXECUTED command (ACCEPTED or REJECTED, never DEFERRED) records its
--   result here; a redelivery replays the stored result with
--   `duplicate: true` (C-01/C-04). Retention is the 30-day sweep.
-- - `device_refresh_tokens` (identity-owned, service-mediated — the
--   sessions pattern from 0003: NO RLS, hash-at-rest only): the rotating
--   one-time-use refresh chain (predecessor_id links rotations; used_at
--   is the reuse-detection tripwire).
-- - `devices` widening (PHASE-003 schema, 016 pos-terminal slice → the
--   020 registry): device class + contract version + attestation
--   substrate + trust flags + sync watermarks + remote data expiry. The
--   platform column stays for 003 compat.
-- - `sales_invoices` gains `owner_device_id` (the OWNER_DEVICE_WINS
--   drafts policy — C-10): stamped at draft creation by a device,
--   checked on update_draft, re-stamped by the admin reassign route.
-- - permission seeds re-asserted (the four sync keys were seeded at 0004
--   base; the owner template already holds them via the 0005 cross-join)
--   + plan feature grants (offline.sync_protocol + offline.device_management
--   join business + enterprise — the 0027 pattern; enterprise already
--   carries both from the 0008 base seed, the guard makes it a no-op
--   there, starter does NOT get them).
--
-- All tenant-owned tables get the PHASE-002 RLS macro. devices and
-- device_refresh_tokens stay service-mediated (PHASE-003 §4 rule: no
-- tenant_id, no RLS — the check-rls tenant_id rule does not apply).
--> statement-breakpoint
SET ROLE erp_migrate;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- tombstones (the soft-delete GC ledger; the change_log feed entries are
-- the transport — this table is the boundary bookkeeping). No FK on
-- tenant_id (the 0024 change_log/sync_cursors pattern: the sync substrate
-- never cascades through tenant deletes).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tombstones" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "tenant_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "deleted_at" timestamptz NOT NULL,
  "gc_after" timestamptz NOT NULL,
  CONSTRAINT pk_tombstones PRIMARY KEY ("id"),
  CONSTRAINT uq_tombstones_tenant_entity UNIQUE ("tenant_id", "entity_type", "entity_id"),
  CONSTRAINT ck_tombstones_entity_shape CHECK ("entity_type" ~ '^[a-z][a-z0-9_]{2,40}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_tombstones_tenant_gc
  ON "tombstones" ("tenant_id", "gc_after");
--> statement-breakpoint
ALTER TABLE "tombstones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"tombstones"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- inbox_commands (the push dedupe ledger; MASTER-PLAN §3/§6): one row per
-- EXECUTED command — DEFERRED (rate-limited) commands are never recorded
-- (they were not executed; the client retries the same command_id).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "inbox_commands" (
  "id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "tenant_id" uuid NOT NULL,
  "device_id" uuid NOT NULL,
  "command_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "entity_type" text NOT NULL,
  "intent" text NOT NULL,
  "status" text NOT NULL,
  "result" jsonb NOT NULL,
  "processed_at" timestamptz NOT NULL,
  CONSTRAINT pk_inbox_commands PRIMARY KEY ("id"),
  CONSTRAINT uq_inbox_commands_device_command UNIQUE ("tenant_id", "device_id", "command_id"),
  CONSTRAINT ck_inbox_commands_status CHECK ("status" IN ('ACCEPTED', 'REJECTED')),
  CONSTRAINT ck_inbox_commands_entity_shape CHECK ("entity_type" ~ '^[a-z][a-z0-9_]{2,40}$')
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_inbox_commands_tenant_idempotency
  ON "inbox_commands" ("tenant_id", "idempotency_key");
--> statement-breakpoint
-- The retention sweep's scan slice (processed_at < now() − 30d); a partial
-- WHERE now()-relative predicate is not valid in a static index, so this
-- is the plain composite the sweep filters.
CREATE INDEX IF NOT EXISTS ix_inbox_commands_tenant_processed
  ON "inbox_commands" ("tenant_id", "processed_at");
--> statement-breakpoint
ALTER TABLE "inbox_commands" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
SELECT erp.apply_tenant_policy('"inbox_commands"');

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- device_refresh_tokens (identity-owned, service-mediated — the sessions
-- pattern from 0003: hash-at-rest, absolute expiry, revoked by service;
-- NO RLS by design). One-time-use rotation chain: used_at is the
-- reuse-detection tripwire (reuse revokes the device), predecessor_id
-- links a successor to its consumed predecessor.
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_refresh_tokens" (
  "id" uuid NOT NULL,
  "device_id" uuid NOT NULL REFERENCES "devices" ("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "predecessor_id" uuid,
  "issued_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz,
  "revoked_at" timestamptz,
  CONSTRAINT pk_device_refresh_tokens PRIMARY KEY ("id"),
  CONSTRAINT uq_device_refresh_tokens_token_hash UNIQUE ("token_hash"),
  CONSTRAINT ck_device_refresh_tokens_window CHECK ("expires_at" > "issued_at")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_device_refresh_tokens_device
  ON "device_refresh_tokens" ("device_id");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- devices: the 020 registry widening (MASTER-PLAN §3/§9). device_class is
-- the feed-group/capability discriminator (platform stays for 003 compat);
-- attestation_* is the ed25519 challenge substrate (nonce issued at
-- registration, attested_at set on verify); trust_flags the admin plane
-- (audited flips); last_pull_at/last_push_at the outbox-lag gauges;
-- data_expires_at the lost-device remote expiry (sync-core refuses local
-- reads past it — the 021 consumer).
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "contract_version" text;
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "device_class" text;
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT IF EXISTS ck_devices_device_class_values;
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT ck_devices_device_class_values
  CHECK ("device_class" IN ('pos-terminal', 'tauri-desktop', 'android-field', 'android-personal'));
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "attestation_public_key" text;
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "attestation_nonce" text;
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "attested_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "trust_flags" jsonb NOT NULL DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "last_pull_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "last_push_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN IF NOT EXISTS "data_expires_at" timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_devices_device_class ON "devices" ("device_class");

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- sales_invoices: the drafts owner-device stamp (OWNER_DEVICE_WINS,
-- MASTER-PLAN §7): create_draft stamps the creating device; update_draft
-- rejects non-owners (FORBIDDEN) and stale versions (STALE_VERSION); the
-- admin reassign route re-stamps. Rides the existing table-level grants.
--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN IF NOT EXISTS "owner_device_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_tenant_owner_device
  ON "sales_invoices" ("tenant_id", "owner_device_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ix_sales_invoices_owner_device
  ON "sales_invoices" ("owner_device_id") WHERE "owner_device_id" IS NOT NULL;

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Permission seeds (AUTHORIZATION_MATRIX §3.8/§3.9 rows 188/189/256): the
-- four sync-plane keys were already seeded by the 0004 base seed and the
-- owner template already holds them through the 0005 cross-join — this
-- re-assertion (the 0027 idempotent upsert pattern) carries the
-- PHASE-020-specific bilingual wording as the keys go live.
--> statement-breakpoint
INSERT INTO "permissions" ("key", "module", "description") VALUES
('sync.devices.register', 'sync', 'Register offline devices / تسجيل الأجهزة غير المتصلة'),
('sync.devices.revoke', 'sync', 'Revoke offline devices / إلغاء الأجهزة'),
('sync.settings.manage', 'sync', 'Manage sync settings / إدارة إعدادات المزامنة'),
('identity.devices.manage', 'identity', 'Manage device registrations / إدارة تسجيل الأجهزة')
ON CONFLICT ("key") DO UPDATE
  SET "module" = EXCLUDED."module", "description" = EXCLUDED."description";

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Plan grants (FEATURE_CATALOG §25 protocol step 3; the 0027 pattern): the
-- PHASE-020 pair joins business + enterprise. Enterprise already carries
-- both keys from the 0008 base seed (the guard makes it a no-op there);
-- business gains them (its plan limits already include 5 offline devices);
-- starter does NOT get them. Idempotent array_cat.
--> statement-breakpoint
UPDATE "plans" SET "feature_keys" = array_cat("feature_keys",
  ARRAY['offline.sync_protocol', 'offline.device_management'])
WHERE "key" IN ('business', 'enterprise')
  AND NOT ('offline.sync_protocol' = ANY("feature_keys"));

--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Grants (erp_app writes; erp_readonly reads; erp_definer read surface).
-- tombstones upserts (ON CONFLICT DO UPDATE extends gc_after) and the GC
-- job deletes → full CRUD; inbox_commands is INSERT/SELECT + the retention
-- DELETE (executed rows are immutable); device_refresh_tokens rides the
-- sessions pattern (SELECT, INSERT, UPDATE — rotation marks used_at,
-- revocation marks revoked_at; DELETE never granted: history is the reuse
-- audit trail, purge is a future retention job's concern). The new columns
-- on devices/sales_invoices ride their existing table-level grants.
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tombstones" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "inbox_commands" TO erp_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "device_refresh_tokens" TO erp_app;
--> statement-breakpoint
GRANT SELECT ON "tombstones", "inbox_commands", "device_refresh_tokens" TO erp_readonly;
--> statement-breakpoint
GRANT SELECT ON "tombstones", "inbox_commands", "device_refresh_tokens" TO erp_definer;
--> statement-breakpoint
RESET ROLE;

--> statement-breakpoint
-- Schema-state marker for /health/ready (mirrors the migration manifest).
INSERT INTO erp._schema_state (key, value) VALUES ('schema_version', 29)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now();
