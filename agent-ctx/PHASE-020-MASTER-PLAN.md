# PHASE-020 MASTER PLAN — Offline Synchronization Foundation (BINDING)

> Executor context: repo `/home/z/phase017_work`, monorepo pnpm (NestJS API +
> Next.js web + drizzle + manual SQL migrations). Phase doc:
> `docs/implementation/phases/PHASE-020.md`. This plan trues-up the phase doc into
> concrete, binding decisions. Where the plan and phase doc disagree on detail, the
> PHASE doc wins on SCOPE; this plan wins on MECHANICS. Deviations get recorded in
> the completion report (decision-record style, like DR-016-01..03).

## 0. Golden fixture identities (binding — all specs use these)

| Constant | Value | Notes |
|---|---|---|
| `TENANT_SYNC` | `20202020-2020-2020-2020-202020202020` | the sync suite's SAR tenant (verified unused) |
| `TENANT_SYNC_B` | `30303030-3030-3030-3030-303030303030` | second tenant for Y-series isolation |
| `ACTOR_SYNC_ADMIN` | `20202020-0000-4000-8000-000000002001` | owner-role actor (register/revoke devices) |
| `ACTOR_SYNC_USER` | `20202020-0000-4000-8000-000000002002` | regular actor |
| Device UUIDs | generated `generateUuidV7()` per spec | never fixed ids for devices |
| `CONTRACT_VERSION` | `"2026-11-04.1"` | exported from `@erp/contracts` (`SYNC_CONTRACT_VERSION`) |

Pattern (from CRM suites): superuser inserts tenant + users in `beforeAll` with
`ON CONFLICT DO NOTHING`, `seedMasterDataBasics()` inside `withTenant`, services
instantiated directly, app client (`appClient()`) for RLS-world reads.

## 1. Binding architecture decisions (the trues-up)

1. **Wire compat is §11 rule 3 — ABSOLUTE.** The 016 POS terminal keeps working
   byte-identically: legacy push commands (`{type: "pos_sale"|"cashier_shift", id,
   idempotencyKey, createdAt, …}`) and the legacy pull envelope
   (`changes[]` + `cursor` + `hasMore`) ride unchanged. V2 is ADDITIVE ONLY:
   - Pull envelope gains `nextCursor`, `serverTime`, `contractVersion`, `resync?`
     (C-12 directive), and each change gains `version` (server row version).
     `changes[]`/`op: "UPSERT"|"DELETE"`/`payload` stay. **Tombstones flow as
     `op:"DELETE"` + `payload:null` entries** (016 clients already handle DELETE).
   - Push accepts BOTH shapes: v2 `SyncCommand` (detected by `intent`+`entityType`
     fields) and legacy (`type` field). Both adapt into ONE handler registry.
   - `PushItemResult` keeps `id`/`idempotencyKey`/`status`/`reason`/`message`/
     `action` and gains `commandId?`, `duplicate?: true`, `entity?: {id, version}`,
     `officialNumber?`, `effects?: {journalEntryIds?, stockMoveIds?}`,
     `resubmittable?`, `localized?: {ar: string; en: string}`.
2. **Four new tenant-owned tables** (RLS `USING`+`WITH CHECK` via
   `erp.apply_tenant_policy`, `FORCE RLS` where the macro does it): `tombstones`,
   `inbox_commands` (+ `change_log`, `sync_cursors` already exist from 0024 —
   catalog notes updated "016 (POS subset) / **020 (generalized, live)**").
   `devices` stays service-mediated (NO tenant_id, NO RLS — PHASE-003 §4 rule);
   `device_refresh_tokens` follows the `sessions` pattern (user-owned,
   service-mediated, revoked by service — not RLS).
3. **Feed strategy = hybrid.** (a) The catch-up writer (016 pattern, generalized to
   registered FEED GROUPS per device class) projects source read-models into
   `change_log` inside the pull transaction — online mutations stay covered without
   touching frozen modules. (b) Pushed-command execution writes its own
   `change_log` entries for affected entities in the SAME transaction as the
   command (feed transactional with execution — SYNC_PROTOCOL §9 note 4). (c)
   Soft-deleted projected rows emit `op:'DELETE'` feed entries AND a `tombstones`
   row (GC boundary tracking).
4. **Device access tokens** ride the existing JWT machinery (ADR-0015): a 15-min
   access token claim set `{sub: userId, deviceId, capabilities}` + a rotating
   one-time-use refresh token (hash-stored, device-bound, chain-linked). Sync
   routes accept EITHER a user session (BFF/web-terminal, 016 path) OR a device
   access token (native clients, 020 path) — both resolve to (user, tenant,
   device). Session path keeps the `X-Device-Id` header convention from 016.
5. **Scope honesty (§2.8):** 020 ships the protocol + these concrete intents:
   `pos_sale` (SD, 016), `cashier_shift` (SD, 016), `partner:contact_merge` (FM),
   `sales_invoice:create_draft` / `sales_invoice:update_draft` (OD +
   baseVersion/STALE_VERSION), plus the ONLINE_ONLY guard and `drafts.reassign`.
   Desktop/van/personal feed groups and their intents are 021/022 columns —
   **honestly deferred**, asserted by the capabilities cross-check tool (T17).
6. `FORBIDDEN` joins the sync rejection registry (CONFLICT_RESOLUTION §2 row
   "Configuration/entitlements/roles → ONLINE_ONLY … rejects with FORBIDDEN";
   ONLINE_ONLY pushes + non-owner draft pushes use it). Registry addition recorded
   in the completion report per the ERROR_MODEL registry-PR rule.

## 2. Wire contracts v2 (`packages/contracts/src/sync/index.ts` — extend in place)

```ts
export const SYNC_CONTRACT_VERSION = "2026-11-04.1";
export const SYNC_CONTRACT_GRACE = ["2026-10-27.1"]; // 016 baseline accepted

// Device classes (LOCAL_DATABASE §1.1) + capability enums (§2 of phase doc)
export const DEVICE_CLASSES = ["pos-terminal", "tauri-desktop", "android-field", "android-personal"] as const;
export const CAPABILITY_CLASSES = ["OFFLINE-COMPLETE", "OFFLINE-DRAFT", "LOCALLY-VALIDATED-PENDING-SERVER", "READ-CACHED", "ONLINE-ONLY"] as const;

// Feed groups per device class (pull scope — server-enforced)
export const FEED_GROUPS = {
  pos: ["items","barcodes","uoms","price_list_items","partners","tax_codes","pos_terminals","cashier_shifts"],
  desktop: [...pos, "sales_invoices"],   // read cache; pulls DRAFT+POSTED headers
  field: [...pos /* van feeds are 022 — deferred */],
  personal: [],                          // 022 — deferred (honest empty)
} as const;
export const PULLED_ENTITY_TYPES = [...new Set(Object.values(FEED_GROUPS).flat())] as const;
// + the synthetic "permissions" snapshot entity (every class pulls it)

export const SYNC_REJECTION_REASONS = [
  "PERIOD_LOCKED","PRICE_CHANGED","INSUFFICIENT_STOCK","CREDIT_LIMIT_EXCEEDED",
  "STALE_VERSION","VALIDATION_ERROR","ITEM_INACTIVE","PARTNER_INACTIVE",
  "DUPLICATE_COMMAND","DEVICE_REVOKED","TENANT_SUSPENDED",
  "CONTRACT_VERSION_UNSUPPORTED","FORBIDDEN",
] as const;

// v2 command (SYNC_PROTOCOL §3.2)
export const syncCommandSchema = z.object({
  commandId: z.string().uuid(),           // UUIDv7
  entityType: z.string().min(2).max(40),
  intent: z.string().min(2).max(40),
  idempotencyKey: z.string().min(8).max(120),
  baseVersion: z.number().int().nonnegative().optional(),
  clientCreatedAt: z.string().min(4),     // advisory (§7 clock skew)
  localRef: z.string().max(80).optional(),
  payload: z.unknown(),
});
export const pushRequestSchema = z.object({
  contractVersion: z.string().optional(), // absent = 016 legacy
  commands: z.array(z.union([syncCommandSchema, z.unknown()])).max(50),
});
```

`actionForRejection` mapping extended: `STALE_VERSION → EDIT_AND_RESEND`,
`ITEM_INACTIVE|PARTNER_INACTIVE|FORBIDDEN|CONTRACT_VERSION_UNSUPPORTED|DUPLICATE_COMMAND → CANCEL_WITH_REASON`.
Per-intent payload schemas: `partnerContactMergeSchema` (whitelisted fields only),
`draftInvoiceCreateSchema`, `draftInvoiceUpdateSchema` (aggregate snapshot).
`resubmittable` per reason: false for FORBIDDEN/CONTRACT_VERSION_UNSUPPORTED/
DEVICE_REVOKED/TENANT_SUSPENDED/DUPLICATE_COMMAND, true otherwise.

## 3. Migration `0029_sync_foundation.sql` (DDL contract)

- `tombstones`: id uuid pk, created_at, tenant_id uuid NOT NULL, entity_type text,
  entity_id text, deleted_at timestamptz NOT NULL, gc_after timestamptz NOT NULL
  DEFAULT (deleted_at + 90d); UQ (tenant_id, entity_type, entity_id); RLS macro;
  `GRANT` per pattern.
- `inbox_commands`: id uuid pk, created_at, tenant_id, device_id uuid NOT NULL,
  command_id text NOT NULL, idempotency_key text NOT NULL, entity_type text,
  intent text, status text ('ACCEPTED'|'REJECTED') CHECK, result jsonb NOT NULL,
  processed_at timestamptz NOT NULL; UQ (tenant_id, device_id, command_id);
  IX (tenant_id, idempotency_key); RLS macro.
- `device_refresh_tokens` (identity-owned, service-mediated — sessions pattern):
  id uuid pk, device_id uuid NOT NULL REFERENCES devices, token_hash text NOT NULL
  UQ, predecessor_id uuid NULL, issued_at, expires_at NOT NULL, used_at NULL,
  revoked_at NULL.
- `devices` ADD columns: `contract_version text`, `attestation_public_key text`,
  `attestation_nonce text`, `attested_at timestamptz`, `trust_flags jsonb NOT NULL
  DEFAULT '{}'`, `last_pull_at timestamptz`, `last_push_at timestamptz`,
  `data_expires_at timestamptz`, `device_class text` (CHECK in DEVICE_CLASSES —
  platform column stays for 003 compat).
- `sales_invoices` ADD `owner_device_id uuid NULL` (drafts OD policy) + IX.
- Permission seeds: `sync.devices.register`, `sync.devices.revoke`,
  `sync.settings.manage`, `identity.devices.manage` (matrix rows 188/189/256) —
  exact keys already in AUTHORIZATION_MATRIX; drift checker demands parity.
- Plan grants for feature keys `offline.sync_protocol`, `offline.device_management`
  (pattern: `plan_features` grants like 019's 6 keys).
- Registrations: `apps/api/migrations/meta/_journal` + `migrations.ts` list +
  `tables.registry.ts` + `route-permissions.ts` rows (§8 below) + RLS presence
  list in `scripts/check-rls.ts` if table-driven.

## 4. Server sync module layout (apps/api/src/modules/sync/)

```
sync.module.ts               // wiring + 4 job queues + event wiring
domain/sync-errors.ts        // typed errors → reason codes (extend pos-errors pattern)
application/
  feed-groups.ts             // FEED_GROUPS registry + device-class resolution
  change-log-writer.ts       // generalized catch-up writer + tombstone emission
    + feedPublisher()        // in-tx feed write after command execution
  cursor-tokens.ts           // v2: {entityType, seq, issuedAt} HMAC (keep 016 format)
  pull-service.ts            // v2: caps 500/1000/2MB, hasMore, resync, bootstrap
  push-service.ts            // v2: handler registry + inbox + DEFERRED + rate limit
  handlers/{pos-sale,shift,partner-merge,draft-invoice,online-only}.ts
  inbox-service.ts           // lookup/replay/record + retention support
  device-registry-service.ts // register/attest/revoke/flag/expire + audit events
  device-tokens.ts           // refresh rotation + reuse detection + access JWT
  permission-snapshot.ts     // "permissions" feed projection + watermark
  reconciliation-service.ts  // revoked-device pending ops + drafts.reassign
  health-service.ts          // sync health aggregates (dashboard)
presentation/
  sync.controller.ts         // status/pull/push/pull-ack/push-ack (extended)
  devices.controller.ts      // /api/v1/devices* (new)
  sync-admin.controller.ts   // admin health/reconciliation/reassign (new)
```

## 5. Pull v2 (T5) — mechanics

1. `GET /api/v1/sync/pull?entity=&cursor=&limit=`: entity must be in the
   device-class feed group (or `permissions`) — else `404`-equivalent
   `SYNC_ENTITY_NOT_PULLED` typed error (no existence leak across classes).
2. Cursor absent → bootstrap from seq 0 (catch-up writer guarantees the source is
   fully projected — watermark tail per entity).
3. Page assembly: `LIMIT min(limit|500, 1000)` rows by seq ASC from
   `change_log`; ALSO stop when serialized bytes > 2 MB (`JSON.stringify` length
   ×2 utf16 → use Buffer.byteLength) → `hasMore: true` + `nextCursor` at last
   emitted seq. Item shape: `{id, seq, op, version, payload, changedAt}` —
   `version` read from payload->>'version' (projections include it; DELETE items
   get `version: null`).
4. C-12: token seq > current `max(seq)` for (tenant, entity) + 1 → return
   `{resync: true, cursor: <fresh 0-cursor>, changes: []}` (bounded restart).
5. `POST /api/v1/sync/pull/ack {positions: [{entityType, cursor}]}` → upsert
   `sync_cursors` (hint only) + touch `devices.last_pull_at`.
6. `GET /api/v1/sync/status` v2: `{serverTime, contractVersion: SYNC_CONTRACT_VERSION,
   device: {id, class, revoked, trustFlags, dataExpiresAt}, suspended}`.
7. Tombstones: projection of soft-deleted rows → DELETE entry + tombstones row
   (idempotent upsert on UQ); pull merges tombstone rows still within horizon
   (their feed entries are the transport; tombstones table is the GC ledger).

## 6. Push v2 (T6/T7/T8/T9) — mechanics

Batch flow (per request, single tenant tx context):
1. Resolve device (session header or token claim). `revoked → DEVICE_REVOKED`
   per-item for ALL commands (C-06, zero effects, before execution);
   tenant suspended → `TENANT_SUSPENDED` likewise (C-14).
2. `contractVersion` present and unsupported → per-item
   `CONTRACT_VERSION_UNSUPPORTED` (resubmittable false) + HTTP 200 (per-item
   channel; the 422 lives on `/sync/status` — C-08 gate note).
3. Rate limit: token bucket per device (in-memory Map, refill 10 batch/min,
   burst 20) → overflow items `DEFERRED {reason: 'RATE_LIMITED', retryAfterMs:
   5000}` — NOT executed, NOT in inbox.
4. Per command (array order): parse v2/legacy → inbox lookup
   `(tenant_id, device_id, command_id)` (v2) or `(tenant_id, device_id,
   idempotency_key)` (both) → hit: replay stored result + `duplicate: true`
   (C-01). Miss: execute handler → record inbox row + feed entries (same tx) →
   return result. Handler throw → typed reject (zero residue — handler tx).
5. Handler registry: `Map<"entityType:intent" | "legacy:type", Handler>`;
   handlers call OWNING module services only (PosSaleService, PosShiftFlowService,
   PartnerService, SalesInvoiceService.create draft path) — no raw table writes
   outside owning modules (MODULE_BOUNDARIES matrix).
6. ONLINE_ONLY guard first: entityType in
   `ONLINE_ONLY_ENTITIES` (roles, entitlements, tenant_settings, users,
   journal_entries, accounting_periods, chart_of_accounts, tax_registrations) →
   REJECTED `FORBIDDEN` resubmittable:false.
7. Legacy adapter: `{type:"pos_sale"}` → `pos_sale:create` handler with the same
   service call as 016 (byte-identical results incl. `result.replay`).

## 7. Conflict policies (T9) — concrete

| Intent | Policy | Mechanics |
|---|---|---|
| `pos_sale:create` | SERVER_DECISION | existing 016 path (period/price/stock/credit + INV-013 op key) |
| `cashier_shift:open/close` | SERVER_DECISION | existing 016 path |
| `partner:contact_merge` | FIELD_LEVEL_MERGE | whitelist `phone,phone2,email,addressLine1,addressLine2,city,contactPerson`; per-field LWW server-side merge + audit event `partner.contact_field_merged` (field-level before/after in details); constrained fields present in payload (`creditLimit,paymentTerms,taxNumber,priceListId,status`) → REJECTED VALIDATION_ERROR `details.constrainedFields`, zero merge |
| `sales_invoice:create_draft` | OWNER_DEVICE_WINS | creates DRAFT invoice via sales service, stamps `owner_device_id = device`, returns `{id, version}` |
| `sales_invoice:update_draft` | OD + baseVersion | non-owner device → REJECTED `FORBIDDEN` details.ownerDeviceId; `baseVersion` mismatch vs current `version` → REJECTED `STALE_VERSION` details.currentVersion (row returned via pull); absent baseVersion → accepted (decision: legacy tolerance, recorded) |
| any ONLINE_ONLY entity | ONLINE_ONLY | REJECTED `FORBIDDEN` |
| `drafts.reassign` | server-mediated transfer | admin route `POST /sync/admin/drafts/reassign {draftId, toDeviceId}` — permission `sync.devices.revoke`, audited `sync.draft_reassigned`, re-stamps owner_device_id |

## 8. API surface (route-permissions.ts rows — controllers match VERBATIM)

| # | Method | Path | Permission |
|---|---|---|---|
| 1 | POST | /api/v1/devices | sync.devices.register |
| 2 | GET | /api/v1/devices | identity.devices.manage |
| 3 | GET | /api/v1/devices/:id | identity.devices.manage |
| 4 | PATCH | /api/v1/devices/:id | identity.devices.manage |
| 5 | POST | /api/v1/devices/:id/attest | sync.devices.register |
| 6 | POST | /api/v1/devices/:id/revoke | sync.devices.revoke (self revoke allowed — `self: true`) |
| 7 | POST | /api/v1/devices/:id/refresh | PUBLIC (credential exchange — bearer refresh token) |
| 8 | GET | /api/v1/sync/status | authenticated (self) — keep 016 row |
| 9 | GET | /api/v1/sync/pull | authenticated (self) |
| 10 | POST | /api/v1/sync/push | authenticated (self) |
| 11 | POST | /api/v1/sync/pull/ack | authenticated (self) |
| 12 | POST | /api/v1/sync/push/ack | authenticated (self) |
| 13 | GET | /api/v1/sync/admin/health | sync.settings.manage |
| 14 | GET | /api/v1/sync/admin/reconciliation | sync.devices.revoke |
| 15 | POST | /api/v1/sync/admin/drafts/reassign | sync.devices.revoke |

Rows 8–10 already exist from 016 (verify exact paths) — extend, don't duplicate.
Refresh route: PUBLIC + requires valid refresh token in body (like login) — add to
PUBLIC_ROUTES if the guard demands registration.

## 9. Device registry + credentials (T3/T4)

- `POST /api/v1/devices` body `{deviceName, deviceClass, platform, platformVersion,
  appVersion, contractVersion, deviceKeyPublic?, capabilities?}` → devices row
  (`device_status` implicit: attested_at NULL = pending), audit `device.registered`,
  returns `{deviceId, attestation: {nonce} | null, refreshToken, accessToken}`
  (credentials issued immediately; attestation upgrades trust_flags).
- `POST /devices/:id/attest {signature}` — ed25519 verify(nonce, publicKey)
  (node:crypto); sets attested_at, trust_flags `{attested: true,
  platformAttestation: "provided"|"absent"}`, audit `device.attested`; wrong
  signature → 400 typed `ATTESTATION_FAILED` (retryable, nonce NOT rotated).
- Refresh rotation: `POST /devices/:id/refresh {refreshToken}` → hash lookup;
  `used_at != null` = REUSE → revoke device + audit
  `device.refresh_token_reuse_detected` + alarm (log + notifications row for
  tenant owners); valid → mark used, mint successor (predecessor_id chain),
  audit `device.token_rotated`, return new pair. Access JWT: 15-min
  `{sub, deviceId, capabilities}` — reuse existing JWT sign/verify util.
- Revoke: sets revoked_at + revoked_reason, audit `device.revoked`; in-flight
  grace = token lifetime (no enforcement beyond 15-min expiry — in-flight
  requests complete).
- Trust flag / data expiry: PATCH devices → `trust_flags` audit
  `device.trust_flagged`; `data_expires_at` set → audit `device.data_expired`
  (lost-device remote expiry; sync-core refuses local reads past expiry — 021
  consumer; 020 asserts the API + audit).
- Lifecycle audit events ALL through AuditService (existing pattern).

## 10. Permission snapshot feed (T12)

Entity `permissions`: per-device projection of the device user's effective
permission keys in the device tenant: `{userId, permissions: string[],
snapshotAt}` — chunked (≤ 500 keys per change row; multiple rows keyed
`userId:page:N`). Pulled by every class at every cycle (sync-core pulls it
first). Watermark: snapshot row's `snapshotAt`; sync-core marks the store
read-only when now − snapshotAt > 7d (D-04) — server stays final authority
always. D-04 test: stale snapshot → local writes refused client-side; server
still enforces permissions on push (re-checks are never skipped).

## 11. Maintenance jobs (T13) — CRM module pattern (pg-boss queues + cron)

| Queue | Cron (UTC) | Behavior (idempotent, bounded) |
|---|---|---|
| `sync.inbox.retention` | `10 4 * * *` | DELETE inbox_commands processed_at < now()−30d LIMIT 5000/loop; audit summary row |
| `sync.tombstone.gc` | `30 3 * * 0` | DELETE tombstones gc_after < now() LIMIT 5000/loop |
| `sync.cursor.compact` | `40 4 * * *` | merge cursor hints (last per device/entity kept — UQ already); compute lag = now − acknowledged_at; > 7d → log alert + notifications row (owners) — feeds dashboard |
| `sync.feed.health` | `*/5 * * * *` | per ACTIVE tenant: max(changed_at) per feed entity; stall > 10 min → log alert + gauge; no data changes |

System jobs (`system: true` payload, iterate ACTIVE tenants) — exactly the
crm.task-reminders-sweep registration shape.

## 12. Admin/monitoring + web (T14)

- `GET /sync/admin/health` → `{push: {total, accepted, rejected, deferred,
  successRate, p95LatencyMs}, pullLagByEntity: [{entityType, maxLagMs, devices}],
  conflictsByType, rejectionsByReason, outboxLagGauge (devices by last_push_at
  age), revokedPendingOps, alerts}` — computed from inbox_commands/sync_cursors/
  devices aggregates (bounded queries, in-memory cache 60s).
- Web screens (bilingual AR/EN, RTL, `platform.*` layout conventions, sticky
  footer, shadcn/ui where applicable — follow apps/web existing admin screens):
  - `/[locale]/platform/devices` — registry table (class, platform, attestation
    badge, trust flags, last seen, contract version, status), row actions:
    revoke (confirm dialog), flag, set data expiry; detail drawer with sync
    state (cursors per entity).
  - `/[locale]/platform/sync-health` — dashboard panels: push success/latency,
    cursor lag by entity, conflicts by type, rejections by reason, alerts feed.
  - `/[locale]/platform/sync-reconciliation` — revoked-device pending-ops queue
    (device, pending commands, oldest age), actions: reassign drafts, dismiss
    (audited); "close the queue to zero" journey testable.
- i18n parity: `check:i18n-parity` green (ar/en keys both directions).
- Monitoring docs: alerts `SyncPushFailSpike` (Sev-2), `SyncCursorStall`
  (Sev-3) + gauges `outbox.lag`, `device.revoked.pending_ops` documented in
  MONITORING.md with TROUBLESHOOTING §sync links (T18).

## 13. packages/sync-core v1 (T10)

Extend in place (do NOT break the 016 chaos-slice test — it keeps passing):
- `LOCAL_MIGRATIONS` v2: add `inbox` mirror + `meta` keys (`contractVersion`,
  `permissionSnapshotAt`, `deviceClass`); `schema_migrations` tracking.
- Cycle engine: `SyncClient.runCycle()` = status → (contract gate: mismatch →
  `readOnly = true`, no push, no fabrications) → pull permissions → pull each
  entity type until drained → push batches (FIFO per entity, ≤50) → push/ack +
  pull/ack (best-effort).
- Full-jitter retry scheduler: `delay = min(cap, base×2^attempts)×rand(0.5..1)`,
  base 5s cap 15min; honors `retryAfterMs`; `nextAttemptAt` already in schema.
- Recovery: `recover()` IN_FLIGHT→QUEUED (exists) + `integrityCheck()` (meta
  checksum of cursor/inbox counts; mismatch → quarantine + re-bootstrap via
  cursor reset = C-12 path) + corruption path (store throws typed
  `LocalStoreCorruptError` — loud, no silent drop).
- LRU pruning: per-class budgets (pos 256MB / android 128MB / desktop 1GB) —
  approximate by row-count budget per business table (documented approximation;
  byte-exact is 021+ with real SQLite); prune oldest-synced rows first, never
  outbox/inbox/cursors.
- Permission watermark: > 7d → `readOnly` (D-04) — writes throw
  `SyncReadOnlyError`.
- Harness-native reference device (chaos matrix drives THIS, not a fake).

## 14. Chaos matrix C-01…C-16 (T15) — `apps/api/src/__db__/sync/`

`chaos-matrix.spec.ts` — real services + real embedded PG + real sync-core
SyncClient via an in-process transport (`harness adapter`: HTTP-shaped calls
straight into controller services with tenant context). Seeded RNG; every
scenario logs its seed. Per scenario (assertions bind to the SYNC_TESTS §2 table):

| ID | Test vehicle |
|---|---|
| C-01 | pos_sale ×3 duplicate batches → 1 journal effect per command (INV-013 oracle), all 4 deliveries byte-equal results, `duplicate: true` on replays |
| C-02 | receipt-allocates-invoice pair reordered across batches → dependent REJECTED VALIDATION_ERROR details.missingDependency, no orphan effects; resubmit after predecessor → ACCEPTED |
| C-03 | 5-command batch, #3 fails (period lock) → 1,2,4,5 committed, #3 typed reject, zero residue (journal line count exact) |
| C-04 | crash post-commit pre-ack (simulate: execute push, drop response, re-push) → original result replayed, no second journal |
| C-05 | flap mid-pull (truncated page) → cursor not advanced; re-pull same page; eventual equality with oracle |
| C-06 | revoke mid-queue → pull DEVICE_REVOKED, push per-item DEVICE_REVOKED, zero ledger, reconciliation queue lists pending ops |
| C-07 | clock skew ±48h (+6h/−2h cases) → server-authoritative dates, client timestamps advisory only, same-second dedupe intact |
| C-08 | contract v(n−1) → per-item CONTRACT_VERSION_UNSUPPORTED, nothing executed/inbox; sync-core readOnly mode |
| C-09 | 20 queued sales, 2 rejected (price change + stock) → 18 official numbers, 2 typed rejects with user actions, PENDING_SYNC throughout (honest-state assert) |
| C-10 | two devices edit same draft → non-owner FORBIDDEN details.ownerDeviceId; owner STALE_VERSION on baseVersion mismatch; exactly one resolution path |
| C-11 | item deleted server-side → tombstone pull removes local row; stale push referencing it → ITEM_INACTIVE resubmittable:false; unknown-row tombstone no-op |
| C-12 | cursor newer than head → resync directive + fresh cursor; ledger untouched |
| C-13 | tenant A device referencing tenant B entities → VALIDATION_ERROR (no existence disclosure — error identical to unknown-id), zero effects |
| C-14 | tenant suspended mid-session → TENANT_SUSPENDED pulls/pushes; restore → resume from cursor, no duplicates |
| C-15 | tampered local rows (crafted payload: negative qty, price tamper) → typed rejects, no partial ledger (INV-013/018) |
| C-16 | storage-full at capture → loud typed error, queue persists, drains after recovery (C-09 semantics) |

Companion suites: `duplicates.spec.ts` (2×/10×/concurrent/cross-batch/35-day
restored outbox — inbox expiry path → posting-key dedupe), `push-isolation.spec.ts`
(Y-01…Y-04 push slices), `device-security.spec.ts` (D-01 revocation pre-exec,
D-03 tamper, D-04 snapshot expiry, spoof scenario tenant-A→tenant-B), plus
`pull.spec.ts`, `push.spec.ts`, `devices.spec.ts`, `jobs.spec.ts` unit-of-behavior
suites per component.

Ledger oracle helper (shared): per-source journal uniqueness (INV-013), balance
(INV-001/002), stock/journal atomicity (INV-018), subledger equality
(INV-009/010 — AR control vs open items), honest-state (PENDING_SYNC never
posted). Budget: whole sync dir ≤ 15 min wall (mirror CI gate claim; measure
and quote actual in completion report).

## 15. k6 + tooling (T16/T17)

- `tests/performance/sync-fleet.js`: 500 VU devices (mixed pull/push loops),
  5% revoked fleet slice (cheap rejection assert — R-06), thresholds
  `p(95)<3000ms` on sync round-trip; seeded data via the API provisioning
  helper scripts (document staged run; sandbox does not execute k6 — the script
  + documented procedure is the deliverable, honestly noted in the report).
- `scripts/check-capabilities-matrix.ts`: parses
  OFFLINE_CAPABILITIES_MATRIX.md rows + a machine fixture
  (`packages/contracts` capability manifest: implemented intents × class ×
  policy × state machine) → row-by-row PASS/DEFERRED(phase) table; exit ≠ 0 on
  a cell claiming implementation without a matching gate or vice-versa. Wired as
  `check:capabilities-matrix` in root package.json; output quoted in the
  completion report (§5.3).

## 16. Docs (T18)

ENTITY_CATALOG (4 tables → 020 live; devices/device_refresh_tokens rows),
TABLES.md, ERD, IMPLEMENTATION_STATUS (PHASE-020 → COMPLETE + report link),
CURRENT_STATE, CHANGELOG, FEATURE_CATALOG (`offline.sync_protocol` +
`offline.device_management` → LIVE), MONITORING (sync dashboards + alerts +
gauges), DEPLOYMENT §7 (change_log growth pre-flight note), TROUBLESHOOTING
§sync runbook entries (one per alert), PHASE_ACCEPTANCE_CRITERIA (criteria
copied), SYNC_TESTS status note (FULL matrix live), LOCAL_DATABASE/SYNC_PROTOCOL
status notes if deviations. `CURRENT_SHIPPED_PHASE = "PHASE-020"` in
configuration prerequisites (feature keys `offline.*` resolve live). Docs
validation green (`pnpm docs:validate`).

## 17. Task order & dependencies (agent waves)

| Wave | Task ID | Scope | Depends |
|---|---|---|---|
| W1 | **1** | Migration 0029 + registries + contracts v2 + sync-core local schema v2 | — |
| W2 | **2-a** | Pull side: feed groups + writer v2 + pull v2 + cursor v2 + status v2 + pull/ack | 1 |
| W2 | **2-b** | Push side: handler framework + inbox + DEFERRED + rate limit + policies + legacy compat | 1 |
| W2 | **2-c** | Device registry + tokens + attestation + revocation + permission snapshot feed | 1 |
| W2 | **2-d** | sync-core v1 (cycle engine, retry, gate, recovery, pruning, watermark) | 1 |
| W3 | **3-a** | Jobs ×4 + admin API + health/reconciliation + web screens ×3 + i18n | 2-a/b/c |
| W3 | **3-b** | Chaos matrix + duplicates + isolation + device security suites | 2-a/b/c/d |
| W4 | **4** | k6 script + capabilities tooling + docs + completion report + full gates | 3-a/b |

Per-wave gates: `pnpm typecheck && pnpm lint` + targeted vitest + (W3+)
`check:permissions-drift`, `lint:depcruise`, `docs:validate`, full
`test:db` at W4. Evidence files `agent-ctx/T-P20-*.md` per task.

## 18. Out of scope (review blockers if implemented)

- End-user apps (Tauri desktop, Android) — 021/022.
- Van-sales field flows, personal-account feeds — 022 (deferred honestly).
- Web offline writes / service-worker cache; peer-to-peer sync; replication of
  any form; LWW for constrained data; "manual cursor fix" tools.
- E-invoicing submission paths (023).
- Byte-exact LRU budgets (row-count approximation documented — real SQLite in 021).
- New business intents beyond §1.5's list.
- NO second business-logic path: handlers call owning-module services ONLY.
