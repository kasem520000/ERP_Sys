# T-P20-1 — Foundation: migration 0029 + registries + contracts v2 (WAVE 1)

> Task ID: 1 (Wave 1) · PHASE-020 · executed by subagent + orchestrator verification.

## Delivered

### Migration `apps/api/migrations/0029_sync_foundation.sql`
- `tombstones` (tenant-owned, RLS via `erp.apply_tenant_policy`): UQ (tenant, entity_type,
  entity_id), gc_after horizon, entity-shape CHECK.
- `inbox_commands` (tenant-owned, RLS): UQ (tenant_id, device_id, command_id), IX
  (tenant, idempotency_key), IX (tenant, processed_at), status CHECK
  ('ACCEPTED'|'REJECTED').
- `device_refresh_tokens` (identity-owned, sessions pattern — NO RLS by design):
  token_hash UQ, predecessor_id rotation chain, used_at reuse tripwire, FK devices
  ON DELETE CASCADE; grants SELECT/INSERT/UPDATE to erp_app (no DELETE — history is
  the reuse audit trail).
- `devices` widening: contract_version, device_class (CHECK 4 classes),
  attestation_public_key/nonce/attested_at, trust_flags jsonb DEFAULT '{}',
  last_pull_at, last_push_at, data_expires_at + IX device_class.
- `sales_invoices.owner_device_id` + 2 indexes (OWNER_DEVICE_WINS drafts policy).
- Permission seeds re-asserted (sync.devices.register/revoke, sync.settings.manage,
  identity.devices.manage — already in 0004 base; bilingual wording updated, 0027
  upsert pattern).
- Plan grants: `offline.sync_protocol` + `offline.device_management` → business +
  enterprise (idempotent array_cat guard).
- Grants per role (erp_app/erp_readonly/erp_definer) + schema_state marker = 29.

### Registrations
- `_journal.json` entry 0029; `infra/db/migrations.ts` list;
  `__db__/isolation/tables.registry.ts` (+tombstones, inbox_commands,
  device_refresh_tokens); `db/schema.ts` drizzle table defs + column additions;
  `infra/db/migrations.spec.ts` count; identity `permissions-drift.ts` seed-migration
  list + 0029; `docs/database/ENTITY_CATALOG.md` notes (016 subset → 020 generalized).
- `route-permissions.ts`: +9 protected rows (devices ×6, sync admin ×3 — §8 rows 1–6,
  13–15), sync data plane rows 8–12 (status/pull/push/pull-ack/push-ack) in
  SESSION_ROUTES, `/api/v1/devices/:id/refresh` in PUBLIC_ROUTES (credential exchange
  like login).

### Contracts v2 (`packages/contracts/src/sync/index.ts` — additive only)
- `SYNC_CONTRACT_VERSION "2026-11-04.1"` + GRACE `["2026-10-27.1"]` + `isContractSupported`.
- `DEVICE_CLASSES`, `CAPABILITY_CLASSES`, `FEED_GROUPS` (pos/field/desktop/personal),
  `PULLED_ENTITY_TYPES`, `PERMISSIONS_ENTITY_TYPE`.
- `SYNC_REJECTION_REASONS` (13 codes incl. FORBIDDEN) + static subset proof
  (POS_REJECTION_REASONS ⊂ SYNC_REJECTION_REASONS).
- `actionForSyncRejection`, `RESUBMITTABLE_BY_REASON`, `ONLINE_ONLY_ENTITIES`.
- `syncCommandSchema`/`SyncCommandV2`, `pushRequestSchema`/`PushRequestV2`.
- `PushItemResultV2Extension` + `PushItemResultV2` (superset of 016 result).
- Per-intent payloads: `partnerContactMergeSchema` (whitelist + ≥1 field refine),
  `draftInvoiceCreateSchema`, `draftInvoiceUpdateSchema` (decimal-string money/qty).
- Pull envelope extended additively: nextCursor/serverTime/contractVersion/resync +
  per-change `version` (nullable, optional).

### sync-core local schema
- `LOCAL_MIGRATIONS` v2: `inbox` (command_id pk, processed_at) + `meta` (key/value) —
  idempotent CREATE IF NOT EXISTS (v1 store + fresh store converge).

## Gate outputs (all green)
- `pnpm typecheck` — 6/6 successful.
- `pnpm lint` — 6/6 successful.
- `packages/sync-core` vitest — 8/8 passed (016 chaos-slice intact).
- Embedded-PG verify (full migration chain, drizzle-kit migrate): apply OK,
  idempotent re-apply no-op, RLS policies present, grants exact, owner template holds
  all 4 sync keys, plan feature keys granted, schema_state = 29 — ALL GREEN.
- `check:permissions-drift` — matrix 243 keys = seed 243 keys OK.
- `check:rls` — OK (via gate runner).

## Decisions taken (recorded for the completion report)
1. Permission seeds are RE-ASSERTIONS (keys existed in 0004 base + owner template via
   0005 cross-join) — bilingual wording updated, matrix parity count unchanged (243).
2. `device_refresh_tokens` has no DELETE grant (rotation chain history = reuse audit).
3. ONLINE_ONLY_ENTITIES: 8 entity types (roles, entitlements, tenant_settings, users,
   journal_entries, accounting_periods, chart_of_accounts, tax_registrations).
4. `FORBIDDEN` added to the sync rejection registry (CONFLICT_RESOLUTION §2
   ONLINE_ONLY row + OWNER_DEVICE_WINS non-owner pushes) — registry addition per the
   ERROR_MODEL registry-PR rule; to be noted in completion report + ERROR_MODEL §4.
5. Refresh route is PUBLIC (credential exchange), all other device routes
   permission-gated; sync data plane rides SESSION_ROUTES (self-scope).

## Left for W2
- Pull side (2-a), push side (2-b), devices (2-c), sync-core engine (2-d) — the SQL +
   contract substrate is ready for them.
