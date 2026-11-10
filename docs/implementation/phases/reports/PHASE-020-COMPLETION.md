# Completion Report — PHASE-020

> **Status:** COMPLETE · **Updated:** 2026-11-04

## Phase ID / Date

PHASE-020 — Offline Synchronization Foundation · 2026-11-04

## Summary

The PHASE-016 POS-scoped offline slice is generalized into the platform-wide
**`sync` module** + **`packages/sync-core` v1** (the reference client engine),
with a PHASE-016 terminal kept working byte-identically (SYNC_PROTOCOL §11
rule 3 — wire compat is ABSOLUTE; the chaos suite's legacy legs replay 016
commands through the same handlers with the same results incl.
`result.replay`). **Substrate** (migrations `0029_sync_foundation.sql`,
`0030_sync_change_log_sequence_grant.sql`, `0031_sync_draft_line_replace.sql`
— schema_version 31): `tombstones` (the soft-delete GC ledger) +
`inbox_commands` (the push dedupe ledger — one row per EXECUTED command,
never DEFERRED) both tenant-owned + RLS; `device_refresh_tokens` (the
sessions pattern — hash-at-rest, predecessor_id rotation chain, used_at reuse
tripwire, no RLS by design, no DELETE grant: history is the reuse audit);
the `devices` registry widening (device_class CHECK over the 4 classes,
contract_version, attestation substrate, trust_flags, pull/push watermarks,
data_expires_at); `sales_invoices.owner_device_id` (OWNER_DEVICE_WINS).
0030 closed a real 0024 gap — erp_app had INSERT on `change_log` but no
USAGE on its sequence, so no feed writer could ever append through the app
role (invisible until a spec exercised the INSERT path); 0031 grants the
sync update_draft line-replace DELETE on `sales_invoice_lines` (DRAFT-only,
single-writer — posted lines unreachable by construction). **Pull v2**: 4
device-class feed groups (pos/field/desktop/personal) with the feed-group
gate (SYNC_ENTITY_NOT_PULLED, 404-equivalent — no cross-class existence
leak), the 9-entity catch-up writer + per-command `publishFeedEntries` in
the SAME transaction as the command, opaque signed cursors over contiguous
seq windows (500/1000-row + 2 MB byte caps), the C-12 resync directive,
tombstone transport for soft-deleted master data (items/partners), and the
`permissions` snapshot feed (key-set change OR >6-day freshness append;
≤1 row/6d/user idle; the 7-day D-04 watermark). **Push v2**: ONE handler
registry keyed `entityType:intent | legacy:type` calling owning-module
services ONLY — `pos_sale`/`cashier_shift` SERVER_DECISION (the 016 path),
`partner:contact_merge` FIELD_LEVEL_MERGE (whitelist + constrainedFields
guard + `partner.contact_field_merged` field-level audit),
`sales_invoice:create_draft`/`update_draft` OWNER_DEVICE_WINS + STALE_VERSION
(aggregate snapshot semantics), the ONLINE_ONLY guard (8 entity types →
FORBIDDEN resubmittable:false); inbox replay with `duplicate: true` incl.
the within-batch refinement; per-device token-bucket rate limit → DEFERRED
(never executed, never inbox-recorded, never consuming a token); the 1 MB
batch byte cap (service + controller). **Devices**: register with
attestation-lite challenge (nonce → ed25519 verify), revoke with the
pending-ops reconciliation queue, flag/expire trust, HS256 JWT access tokens
(15-min, the identity key envelope — no new secret), one-time-use refresh
rotation with reuse detection (conditional UPDATE consumption; the kill
switch survives the failure response via idempotent re-apply), and the
PUBLIC `/devices/:id/refresh` deriving the tenant from the device user's
ACTIVE membership. **Operations**: 4 maintenance jobs (inbox.retention 30d
daily 10 4, tombstone.gc weekly 30 3 * * 0, cursor.compact daily lag audit
40 4, feed.health read-only probe every 5 min), the reconciliation queue +
admin `drafts/reassign`, the health aggregate (p95, outbox.lag gauge buckets,
device.revoked.pending_ops, SyncPushFailSpike/SyncCursorStall alert feed —
60 s tenant cache), 15 routes total (devices ×7, sync ×5, admin ×3).
**Web**: 3 platform screens (devices registry, sync health, sync
reconciliation) + permission-gated NAV_ITEMS rows; i18n 2926 → 3044. **The
FULL chaos matrix C-01…C-16 + duplicates + D-series device security +
Y-series isolation suites are GREEN and blocking**: 9 spec files / 74 tests
in `apps/api/src/__db__/sync/` (~12 s whole-dir wall incl. the embedded-PG
boot vs the ≤ 15 min budget) with the shared `_oracle.ts` ledger oracle
(INV-013/001/002/018, AR tie, honest-state) asserted after EVERY scenario
and per-scenario logged seeds (C-01 `0xc01` …) for byte-identical replay;
`packages/sync-core` 36/36. The chaos suites found **three production bugs,
all fixed in-phase** (the BR-003 price gate missing on the POS autopost
path; the ITEM_INACTIVE vocabulary for soft-deleted master data; the
unenforced 1 MB push byte cap). Contract version **`2026-11-04.1`** with
grace **`["2026-10-27.1"]`** (a stale-contract device gets per-item
CONTRACT_VERSION_UNSUPPORTED + the sticky client-side read-only gate — zero
fabricated writes). Gates: sync dir 74/74, sales+pos regression 57/57,
sync-core 36/36, i18n parity 3044/3044, permissions-drift 243 = 243,
typecheck/lint 6/6, docs:validate 29/29.

## Files created

**Migrations (Wave 1)**
- `apps/api/migrations/0029_sync_foundation.sql` — `tombstones` +
  `inbox_commands` (tenant-owned, RLS, UQs + the retention/GC scan indexes),
  `device_refresh_tokens` (identity-owned sessions pattern), the `devices`
  widening (8 columns + device_class CHECK + IX), `owner_device_id` (+2
  indexes), permission-seed re-assertions (bilingual 020 wording; matrix
  stays 243), plan grants (`offline.sync_protocol` +
  `offline.device_management` → business+enterprise, idempotent array_cat),
  role grants, schema_state 29.
- `apps/api/migrations/0030_sync_change_log_sequence_grant.sql` — the 0024
  sequence-usage gap (DR-P20-16).
- `apps/api/migrations/0031_sync_draft_line_replace.sql` — the sync
  update_draft DELETE grant (DR-P20-16).

**Server module — `apps/api/src/modules/sync/` (Waves 2–3)**
- `application/feed-groups.ts`, `change-log-writer.ts` (the v2 catch-up
  writer + publishFeedEntries), `cursor-tokens.ts` (v2 signed cursors),
  `pull-service.ts` (byte-capped pages, resync, permission snapshots),
  `permission-snapshot.ts`.
- `application/push-service.ts` (v2 rewrite — batch gate order: device →
  suspended → revoked → contract → rate limit → per-command inbox/handler),
  `handlers/` (`index.ts` registry, `pos-sale.ts`, `shift.ts`,
  `partner-merge.ts`, `draft-invoice.ts`, `online-only.ts`),
  `inbox-service.ts`, `domain/sync-errors.ts`.
- `application/device-registry-service.ts`, `device-tokens.ts` (JWT +
  rotation + reuse kill switch), `reconciliation-service.ts`,
  `presentation/devices.controller.ts`.
- `application/health-service.ts`, `maintenance-jobs.ts` (the 4 jobs),
  `presentation/sync-admin.controller.ts` (health / reconciliation /
  drafts.reassign).
- Wired: `sync.module.ts` (services + controllers + 4 pg-boss queues),
  `sync.controller.ts` (v2 pull/push/pull-ack/push-ack/status),
  `error.filter.ts` + `route-permissions.ts` (+9 protected rows, the
  refresh route PUBLIC) + `permissions.guard.ts` (self-scope revoke).

**`packages/sync-core` v1 (Wave 2-d)**
- `src/cycle.ts` (runCycle), `retry.ts` (full-jitter), `recovery.ts`
  (IN_FLIGHT→QUEUED + integrity check → quarantine + re-bootstrap),
  `pruning.ts` (row-budget LRU), `watermark.ts` (D-04 + assertWritable),
  `errors.ts`; extended `outbox/engine.ts` (markQueueUnresolvable),
  `commands/builders.ts` (v2 builders), `store/adapter.ts` (meta/inbox/
  quarantine), `store/pull.ts`, `client.ts`, `index.ts`; LOCAL_MIGRATIONS
  v2 (`inbox` + `meta`).

**Web (Wave 3-a)**
- `app/[locale]/platform/{devices,sync-health,sync-reconciliation}/page.tsx`
  + `components/{devices-table,devices-filter-form,sync-health-panels,
  sync-reconciliation-queue}.tsx`; NAV_ITEMS rows ×3 (DR-P20-13);
  `i18n/dictionaries.ts` +118 keys (3044, exact AR/EN parity).

**DB specs — the evidence core (Waves 2–3)**
- `src/__db__/sync/`: `_oracle.ts` (fixtures + service graph + device
  enrollment + transport + the ledger oracles), `pull.spec.ts` (9),
  `push.spec.ts` (9), `policies.spec.ts` (8), `devices.spec.ts` (9),
  `jobs.spec.ts` (6), `chaos-matrix.spec.ts` (19: C-01…C-16 + the D-04
  probe), `duplicates.spec.ts` (5), `device-security.spec.ts` (5: D-01/03/04
  + spoof), `push-isolation.spec.ts` (4: Y-01…Y-04) — 74 green.

## Verification evidence

| Gate | Result |
|---|---|
| **FULL DB suite (embedded PG16, migrations 0001–0031)** | **115 files / 1773 tests — ALL PASSED** (up from 019's 1687; +86 across the sync cluster 74, isolation A-series for the 0029 tables + 0031 line grant, jobs 6, configuration re-pins) |
| Sync DB suite (`__db__/sync`) | **9 files / 74 tests — ALL PASSED** (pull 9, push 9, policies 8, devices 9, jobs 6, chaos-matrix 19, duplicates 5, device-security 5, push-isolation 4); whole-dir wall ~12 s vs the ≤ 15 min budget |
| `packages/sync-core` vitest | **36/36** (cycle 6, retry 7, recovery/pruning 9, watermark/tombstone 6, the 016 chaos slice 8 intact) |
| API unit suite | **274/274** (configuration 97 incl. the CURRENT_SHIPPED_PHASE=020 re-pins: 8 business-plan golden hashes moved, the two beyond-phase synthetic proofs advanced to PHASE-021) |
| Sales + POS regression (`__db__/sales` + `__db__/pos`) | 57/57 (the 016 terminal keeps working — interop) |
| pnpm typecheck / lint (6 packages) | 6/6 clean |
| pnpm lint:depcruise | **0 violations** (1018 modules; the handlers contract split — index → handlers → contract leaf — closed the 4 no-circular findings) |
| pnpm run check:permissions-drift | 243 = 243 |
| pnpm check:i18n-parity | ar=en=3044, no empty values |
| pnpm check:capabilities-matrix | rows PASS 13 · DEFERRED 15 · n/a 16 — fixture ↔ OFFLINE_CAPABILITIES_MATRIX agree (every claim gated, every deferral annotated) |
| pnpm docs:validate | 29/29 |
| check-rls catalog parity | green (in-suite via migrations.db.spec runChecks — the 019 precedent) |

**Acceptance criteria (§6 of the phase doc) — all green:**

1. Full chaos matrix C-01…C-16 green on the generalized protocol
   (`chaos-matrix.spec.ts` 19 tests, per-scenario logged seeds →
   byte-identical replay; the ledger oracle runs after every scenario).
2. Duplicate delivery at any multiplicity — 2×, 10×, concurrent twin,
   cross-batch, and the 35-day restored outbox — produces exactly one
   journal effect + official number (INV-013) with the first result
   replayed `duplicate: true` (`duplicates.spec.ts` + C-01).
3. Pull cursors are opaque signed tokens over contiguous seq windows;
   crash-between-apply-and-advance re-pulls the same page (C-05); no
   full-table dump anywhere (bootstrap = cursor 0 with the same envelope).
4. Batches are never all-or-nothing: per-item results with exact registry
   codes + machine-readable `details`; C-03 partial batch (PERIOD_LOCKED #3
   of 5) commits 1/2/4/5 with zero residue; DEFERRED items never executed,
   never recorded.
5. Inbox retention ≥ 30 days enforced by the audited daily job
   (`jobs.spec.ts`: 5200 rows drained in bounded 5000-batches + audit);
   every command class retains a second durable dedupe layer (the 35-day
   leg: inbox miss → the posting-key replay, `replay: true`).
6. LWW absent for constrained types (the ONLINE_ONLY guard + the
   partner-contact constrainedFields rejection — policy tests 8/8);
   partner-contact merges are per-field with field-level audit
   (`partner.contact_field_merged`).
7. A PHASE-016 POS terminal syncs unchanged — legacy `{type:"pos_sale"|
   "cashier_shift"}` rides the same handlers byte-identically (the chaos
   legacy legs + the 57/57 sales/pos regression); deviations are
   decision-recorded below (none touch the wire).
8. Revocation/suspension take effect per SECURITY_AND_DEVICE_MANAGEMENT §4:
   pulls DEVICE_REVOKED, pushes rejected pre-execution with zero ledger
   effects (C-06/D-01), TENANT_SUSPENDED per-item (C-14), refresh exchange
   fails; in-flight requests complete within the token lifetime.
9. Cross-tenant pushes reject with no effects and no existence disclosure
   (C-13 + Y-01…Y-04: foreign-id refs byte-equal to unknown-id shape; the
   spoof leg serves B-context only).
10. Sync health dashboard, `SyncPushFailSpike` (Sev-2), `SyncCursorStall`
    (Sev-3), `outbox.lag` + `device.revoked.pending_ops` gauges live
    (MONITORING.md updated); every alert links a TROUBLESHOOTING §sync
    runbook entry.
11. k6 sync-fleet T-05 — **staged, not executed** (honest deferral: hosted
    k6 remains a waived follow-up obligation; the local substitute is the
    chaos suite at T-05-shaped loads — see Deferrals).
12. Capabilities-matrix cross-check — quoted below (§Capabilities
    cross-check); every implemented cell matches its class/policy/state
    columns.
13. Docs: ENTITY_CATALOG/TABLES/ERD updated (TABLES/sync.md + ERD/sync.md
    authored; `ix_change_log_tenant_entity_seq` present), docs validation
    green (29/29), criteria copied into PHASE_ACCEPTANCE_CRITERIA.md.

**Capabilities cross-check (acceptance criterion 12 — the shipped cells):**

| Matrix row | Operation | Shipped 020 surface | Match |
|---|---|---|---|
| 1–3 | POS sale / return / shift (POS terminal) | `pos_sale:create` (returns ride the credit-note path), `cashier_shift:open/close` — SERVER_DECISION, `PENDING_SYNC → POSTED`/`REJECTED(editable)` honest states (C-09) | ✓ |
| 4–5 | Items/barcodes/prices/price lists lookup | READ-CACHED via the pos feed group pull (the 9-entity catch-up writer; as-of cursor) | ✓ |
| 6 | Sales invoice draft | `sales_invoice:create_draft`/`update_draft` — OD (OWNER_DEVICE_WINS) + STALE_VERSION; drafts.reassign admin transfer (C-10) | ✓ (server side; the desktop client is 021) |
| 15–20, 22, 24, 30, 36 | ONLINE-ONLY operations | the ONLINE_ONLY guard (8 entity types: roles, entitlements, tenant_settings, users, journal_entries, accounting_periods, chart_of_accounts, tax_registrations) → FORBIDDEN resubmittable:false | ✓ |
| contact merge | Partner contact edits | `partner:contact_merge` FIELD_LEVEL_MERGE (whitelist + constrained-fields guard + field-level audit) | ✓ |
| — | permissions cache | the `permissions` snapshot feed + the 7-day read-only watermark (D-04) | ✓ |
| 9–14, 21, 23, 25–26, 31–35 | field/personal operations (022) | no intents shipped — honest: the 022 columns stay DEFERRED | ✓ (by omission) |

## Deviations & decisions (recorded)

1. **DR-P20-01 — ITEM_INACTIVE/PARTNER_INACTIVE are `resubmittable: false`.**
   MASTER-PLAN §2's "true otherwise" list was the pre-scoping spelling; §14
   and the CONFLICT_RESOLUTION §3 actions table win (CANCEL_WITH_REASON /
   substitute-and-resend — retrying an inactive master-data reference can
   never succeed). The chaos-found production gap folded into this record:
   `requireSellableItem` treated soft-DELETED items as unknown
   (VALIDATION_ERROR), losing the ITEM_INACTIVE vocabulary — fixed so
   soft-deleted master data speaks the same typed vocabulary (registry map
   as the single spelling; asserted in chaos-matrix C-11b).
2. **DR-P20-02 — `FORBIDDEN` joined the sync rejection registry** (13 codes
   now): ONLINE_ONLY entity pushes + OWNER_DEVICE_WINS non-owner draft
   edits, always `resubmittable: false`. Registry addition per the
   ERROR_MODEL §4 registry-PR rule (doc row added with this phase).
3. **DR-P20-03 — register does NOT issue credentials.** MASTER-PLAN §9
   wanted `{refreshToken, accessToken}` at register; the binding task text
   won: the envelope is `{deviceId, attestationNonce, enrollmentSecret,
   contractVersion}` — the enrollment secret is the one-time registration
   proof (sha256 → device_key_hash), NOT the refresh token;
   `issueRefreshToken(tx, deviceId)` is exported and ready for the first
   refresh bootstrap (native-client enrollment lands with 021).
4. **DR-P20-04 — device access tokens are HS256 JWTs** (node:crypto only, no
   new dependency) signed with the identity `keyMaterialForTokens()` secret
   — grep proved identity signs no JWTs anywhere (sessions are opaque
   server-side rows per ADR-0015); one secret envelope, three derivations
   (reset links, sync cursors, device access). Claims
   {sub, deviceId, capabilities?, iat, exp}, 15-min exp; the existing
   X-Session-Token path untouched.
5. **DR-P20-05 — the C-12 resync trigger is `token seq > max(seq)`** (empty
   head → 0). The phase-plan "+1" spelling would miss the
   exactly-at-head+1 stale case; `>` catches it. SYNC_PROTOCOL status note
   updated.
6. **DR-P20-06 — tombstone payload retention.** `change_log` DELETE rows
   KEEP their source payload (the watermark reads `payload->>'changedAt'` —
   nulling would stall it on delete-only tails); the PULL ENVELOPE nulls
   payload + version on DELETE and emits `op: "DELETE"` (the protocol
   doc's envelope example spells the op value `"tombstone"` — the wire
   value is `"DELETE"`; the `tombstones` table is the separate GC ledger).
7. **DR-P20-07 — within-batch duplicate refinement.** A second occurrence
   of the same idempotencyKey within one batch replays the FIRST result +
   `duplicate: true` (the 016 path echoed `{deduped: true}` with no result)
   — a flapped client converges without a re-push.
8. **DR-P20-08 — p95 is an approximation**, documented in-code: percentile
   of the ≤ 5000 most recent commands in the 7-day window (not the full
   window); index `((n*95+99)/100) | 0` (ceil without Math.floor —
   ADR-0009; n ≤ 5000 keeps the product inside the safe integer range).
   Dashboard breakdowns bounded at 5000 rows each.
9. **DR-P20-09 — cursor-stall owner notifications ride the `reconciliation`
   category** (the 0023/0027 CHECK domain has no `system`/`sync` category;
   semantically closest allowed value). Notification severity `warning`
   while the MONITORING alert is Sev-3 — intentional: notification severity
   ≠ alert severity.
10. **DR-P20-10 — row-count LRU budgets** (`BYTES_PER_ROW_APPROX`, oldest-
    synced first; outbox/inbox/cursors never pruned). Byte-exact budgets
    need the real SQLite store — deferred to 021 per MASTER-PLAN §13;
    documented in pruning.ts + LOCAL_DATABASE §5.
11. **DR-P20-11 — the BR-003 price gate now runs on the POS autopost path**
    (chaos-found: the gate existed only in `SalesInvoiceService.approve`,
    which the POS autopost path bypasses — a stale unit price with
    consistent tenders POSTED at the stale price; now policy-gated on the
    POS path, C-09b green).
12. **DR-P20-12 — the 1 MB push byte cap is enforced in service AND
    controller** (chaos-found: only the count budget was enforced, and the
    service (50) and controller (z.array.max(200)) disagreed; now both
    layers enforce 50/1 MB with the typed SYNC_COMMAND_INVALID).
13. **DR-P20-13 — NAV_ITEMS carries the 3 platform rows**
    (`platform.devices` / `platform.sync-health` /
    `platform.sync-reconciliation` — permission-gated
    identity.devices.manage / sync.settings.manage / sync.devices.revoke,
    feature-keyed offline.device_management / offline.sync_protocol,
    settings group, orders 92/94/96). The W3 agent left them out
    (navigation.ts was outside its ownership); the orchestrator landed them
    — the sidebar is registry-driven, so without the rows the screens were
    crumb-only.
14. **DR-P20-14 — maintenance-job semantics.** Cursor "compaction" is the
    lag audit (the (device, entity) UQ already enforces one row per pair —
    nothing to merge): lag = now − acknowledged_at, one aggregated warn per
    lagged device + deduped owner notifications (idempotent same-day by
    key). feed.health is strictly read-only (zero writes — spec-asserted)
    and approximation-guarded (a stall counts only when the tenant has
    non-revoked devices that pulled within 24 h — an idle tenant's quiet
    feed is healthy). Retention/GC sweep legs that need UPDATE/DELETE ride
    the superuser handle (erp_app holds no UPDATE on inbox_commands by
    grants). Audit rows anchor on the FIRST affected row id (the
    reservations-sweep precedent; a no-op pass records no row).
    `deferred` is structurally 0 in the health aggregate (DEFERRED commands
    are never inbox rows); `successRate = 100` when total = 0.
15. **DR-P20-15 — no dismiss route this phase.** The reconciliation screen
    deliberately offers no dismiss action (`POST /sync/admin/reconciliation/
    dismiss` is not registered in route-permissions.ts — a button that
    always 404s would be a lie); the service keeps `dismissDevice`
    (trust_flags.reconciliation_dismissed + audit) for future wiring.
    Un-acked ops keep a revoked device on the queue until a human closes
    it (SECURITY §4.4 — never silently dropped).
16. **DR-P20-16 — substrate grant gaps closed by dedicated additive
    migrations** (the 0028 precedent): 0030 (change_log sequence USAGE for
    erp_app) and 0031 (sales_invoice_lines DELETE for the sync
    line-replace writer). Both flagged loudly by the wave agents, both
    registered (`_journal.json`, migrations.ts, the count spec).
17. **DR-P20-17 — suite-shape decisions (3-b).** C-02's vehicle maps to
    update_draft-before-create (the 020 intent set has no offline
    `receipt:allocates` intent — the honest mapping of the SYNC_TESTS row
    onto shipped intents); C-07 exercises the ±48 h skew extremes (the
    +6 h/−2 h sub-cases ride the same advisory-only mechanism); D-01's
    queue listing is asserted through the owned DRAFT (a pre-exec
    revocation has no un-acked inbox rows); the duplicates concurrent-twin
    leg is sequential in-process (a true race needs interleaved
    withTenant transactions — candidate for the 024/025 hardening pass);
    the memoryAdapter's transaction is a documented pass-through (real
    SQLite rolls the whole capture back — D-04 asserts the invariant that
    holds in both worlds).
18. **DR-P20-18 — device-security mechanics.** The reuse kill switch
    survives the failure response: the controller catches DeviceRevokedError
    and re-applies via the exported idempotent
    `reapplyRefreshReuseRevocation` in a fresh committed withTenant (no
    double alarm). Concurrent double-spend closed by conditional-UPDATE
    consumption. The devices tenant boundary rides the memberships join
    (RLS filters to the ambient tenant — the PHASE-003 service-mediated
    rule). `oldestPendingAt` = min(inbox_commands.processed_at)
    (approximation documented). platformVersion/appVersion are wire-accepted
    and audit-carried only (no devices columns). Unix seconds use the
    bitwise `(Date.now()/1000) | 0` (Math.floor is lint-forbidden,
    ADR-0009).
19. **DR-P20-19 — permission snapshot cadence:** append on key-set change
    OR when the last snapshot is > 6 days old (without the freshness rule
    an idle tenant's snapshot ages past the 7-day D-04 watermark and every
    device flips read-only despite zero permission changes); the 500-key
    chunk rule is satisfied by reality (243-key matrix) — single row per
    snapshot, pagination deferred with an in-file comment.
20. **DR-P20-20 — sync-core gate semantics.** The contract gate stores
    `meta: contractGate = "read-only"` (sticky until a status call reports
    a supported version — the store stays READABLE but never pushes);
    revoked-device discovery mid-cycle marks the whole queue `unresolvable`
    (no per-item retry storm; reconciliation owns the aftermath);
    `markQueueUnresolvable` was added to the 016 outbox engine with the
    016 chaos-slice test untouched and green.
21. **DR-P20-21 — handlers contract split (W4 close-out).** depcruise's
    no-circular rule flagged the handlers barrel (index ↔ handler files
    shared the contract types). The shared contract (types +
    `configureHandlerServices`/`handlerServices` + `handlerValidationError`)
    moved to `handlers/contract.ts` — a leaf; index keeps the registry and
    re-exports the contract, so `./handlers` consumers are unchanged.
22. **DR-P20-22 — createQueue deadlock tolerance.** The DB suite boots
    several full apps on ONE process-bound boss singleton; the four new
    boot-time `createQueue` registrations widened the pg-boss
    maintenance-vs-createQueue deadlock window (import-export flaked once).
    `SyncModule.createQueueTolerant` retries 40P01 twice — every other
    error still throws (no masking).
23. **DR-P20-23 — isolation A-series for the 0029 tables + the 0031
    grant.** `tables.registry.ts` gained the OWN_ROW/seed/attack fixtures
    for `tombstones` + `inbox_commands` (the A4/A7 column fallbacks:
    gc_after / result — neither carries updated_at; inbox_commands rides
    the NO_UPDATE_GRANT denial path) and `sales_invoice_lines` flipped
    `deleteGranted: true` (migration 0031's DRAFT-replace grant — RLS
    still confines deletes to own-tenant rows, proven by A5).
24. **DR-P20-24 — the CURRENT_SHIPPED_PHASE=020 flip moved with its
    pins:** the template-prerequisites pin advanced to 020, the two
    "beyond shipped phase" synthetic proofs (OPTIONAL rental_logistics +
    REQUIRED fixed_assets) advanced to PHASE-021 (the documented §18
    lesson-5 maintenance), layer-fixtures BUSINESS_KEYS gained the 0029
    offline keys (the 021/022 app keys stay enterprise-only), and the 8
    business-plan golden hashes re-pinned.

**Honest deferrals (never silent):**

- **021/022 columns**: platformVersion/appVersion stay audit-only (no
  `devices` columns); the desktop/field/personal pull projections beyond
  the shipped 9 entities land with their clients.
- **Byte-exact LRU budgets** → 021 (DR-P20-10).
- **k6 sync-fleet (T-05)**: staged, not executed — hosted k6 remains a
  waived follow-up obligation (NEXT_ACTION §Follow-up obligations); the
  chaos suite at T-05-shaped loads is the recorded local substitute.
- **Concurrent-twin race leg** → the 024/025 hardening pass (DR-P20-17).
- **`receipt:allocates` intent** → 022/023 (C-02 mapped honestly in the
  meantime).
- **Dismiss route** (DR-P20-15) — service surface ready, route not
  registered this phase.

## Documentation updates required — all done

ENTITY_CATALOG (the 4 sync tables → 020 generalized LIVE; devices widened;
device_refresh_tokens row; sales_invoices owner_device_id) ✓ · TABLES/sync.md
+ ERD/sync.md (authored; tenancy-identity ERD + trade-sales pointer trued
up) ✓ · IMPLEMENTATION_STATUS (020 → COMPLETE + report link) ✓ ·
CURRENT_STATE (the PHASE-020 section + implemented list + tested line) ✓ ·
CHANGELOG (the 020 entry) ✓ · FEATURE_CATALOG (`offline.sync_protocol` +
`offline.device_management` → shipped 2026-11-04; permission keys
reconciled) ✓ · ERROR_MODEL §4 (the FORBIDDEN row + the resubmittable
clarification) ✓ · MONITORING (dashboard LIVE + gauges + alert conditions) ✓
· DEPLOYMENT §7 (the change_log growth pre-flight + partitioning decision
trigger) ✓ · TROUBLESHOOTING §7 (one runbook entry per alert + the
reconciliation-queue + refresh-reuse rows) ✓ · PHASE_ACCEPTANCE_CRITERIA
(criteria copied) ✓ · SYNC_TESTS (FULL-matrix-live status note) ✓ ·
LOCAL_DATABASE + SYNC_PROTOCOL (status notes + the deviation pointers
DR-P20-05/06/07/10) ✓ · NEXT_ACTION (021 single next action) ✓.

## Exit criteria

All acceptance criteria green with evidence (k6 T-05 honestly staged — the
waived-hosted-infra posture, recorded); **the FULL chaos matrix is blocking
in CI from this phase on** (every push); PHASE-016 interop proven (legacy
legs + 57/57 regression); sync dashboards/alerts live; docs synchronized;
zero TODOs in shipped code (the 3 chaos `it.todo` slots were fixed
in-phase — C-09b/C-11b/D-03b all green).

## Definition of Done

Protocol + sync-core + reference store + admin/monitoring all in the working
tree (commit pending the W4 close-out); the sync suites green
deterministically (logged seeds); no end-user app code added (021/022
untouched); CI-equivalent local gates green. ✓

## Handoff instructions

Stage 8 begins with the **PHASE-021 desktop agent**: start from this report
+ the PHASE-020 master plan §13 (the sync-core surface it hosts UNMODIFIED),
ADR-0013, LOCAL_DATABASE §1.1/§5/§6.4, and the OFFLINE_CAPABILITIES_MATRIX
desktop column. The byte-exact LRU budgets and the real SQLite/SQLCipher
store are 021's first items (DR-P20-10); the keychain holds the refresh
token, device key, and SQLite key (SECURITY §3); the first-refresh
bootstrap for native enrollment wires `issueRefreshToken` (DR-P20-03).
**Next eligible phase: PHASE-021 — Desktop Application** (identify only; do
not implement).

## Task evidence index

| Task | Evidence |
|---|---|
| 1 Foundation (migrations 0029–0031 substrate + registries + contracts v2 + sync-core schema v2) | `agent-ctx/T-P20-1-foundation.md` |
| 2-a Pull side (feed groups + catch-up writer + pull v2 + cursors + permission snapshots) | `agent-ctx/T-P20-2a-pull.md` |
| 2-b Push side (handler framework + inbox + DEFERRED + rate limit + policies + legacy compat) | `agent-ctx/T-P20-2b-push.md` |
| 2-c Device registry + tokens + attestation + revocation + reconciliation | `agent-ctx/T-P20-2c-devices.md` |
| 2-d sync-core v1 (cycle, retry, recovery, pruning, watermark) | `agent-ctx/T-P20-2d-sync-core.md` |
| 3-a Jobs + admin API + web screens + i18n | `agent-ctx/T-P20-3a-jobs-admin-web.md` |
| 3-b Chaos matrix + duplicates + isolation + device security suites | `agent-ctx/T-P20-3b-chaos-suites.md` |
| 4-a k6 fleet script + capabilities cross-check tooling | `agent-ctx/T-P20-4a-tooling.md` |
| 4-b Docs + this completion report | `agent-ctx/T-P20-4b-docs.md` |
| Orchestrator close-out (controller/module/guard wiring; 3 production-bug fixes C-09b/C-11b/D-03b; CURRENT_SHIPPED_PHASE flip + re-pins; handlers contract split; deadlock tolerance; isolation fixtures) | `agent-ctx/T-P20-W4-closeout.md` |
| Binding design | `agent-ctx/PHASE-020-MASTER-PLAN.md` |
