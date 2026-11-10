# T-P20-3a — Jobs + admin API + web screens (Wave 3 / PHASE-020)

> Task ID 3-a · PHASE-020 · MASTER-PLAN §11 (jobs) + §12 (admin/monitoring +
> web) + §8 rows 13–15 · PHASE-020 §2 items 8–11 + item 11 (health).
> Delivered by subagent (first session landed the files; this session verified
> every surface against the binding spec, fixed one comment, re-ran all gates,
> and wrote this record).

## Files (all owned files only)

| File | Status |
|---|---|
| `apps/api/src/modules/sync/application/health-service.ts` | NEW — SyncHealthService (§12 aggregate, 60s cache) |
| `apps/api/src/modules/sync/presentation/sync-admin.controller.ts` | NEW — 3 admin routes (route-permissions rows ~2670–2684 verbatim) |
| `apps/api/src/modules/sync/application/maintenance-jobs.ts` | NEW — run/sweep ×4 + queue/cron constants |
| `apps/api/src/modules/sync/sync.module.ts` | MODIFIED — SyncHealthService + SyncAdminController wired; 4 pg-boss queues registered (crm sweep shape) |
| `apps/api/src/__db__/sync/jobs.spec.ts` | NEW (6 tests) |
| `apps/web/app/[locale]/platform/devices/page.tsx` | NEW |
| `apps/web/app/[locale]/platform/sync-health/page.tsx` | NEW |
| `apps/web/app/[locale]/platform/sync-reconciliation/page.tsx` | NEW |
| `apps/web/components/devices-table.tsx` | NEW (client: revoke/flag/expiry/detail dialogs) |
| `apps/web/components/devices-filter-form.tsx` | NEW (client: URL-encoded class+status filters) |
| `apps/web/components/sync-health-panels.tsx` | NEW (server-renderable panels, no chart lib) |
| `apps/web/components/sync-reconciliation-queue.tsx` | NEW (client: reassign dialog; NO dismiss) |
| `apps/web/i18n/dictionaries.ts` | MODIFIED — +118 typed keys ×{ar,en} (additive only; 0 deletions) |
| `apps/web/components/app-shell.tsx` | MODIFIED — 3 FALLBACK_CRUMBS rows (see D8) |

Forbidden files untouched by this task (verified — `git status` deltas beyond
the list above belong to waves 1/2/2-d/3-b: migrations, infra/**, contracts,
sync-core, the other sync application/presentation files, the sibling specs).

## Exported signatures (for wiring / completion report)

### health-service.ts
```ts
@Injectable() export class SyncHealthService {
  health(): Promise<SyncHealthReport>   // ambient withTenant tx; 60s in-memory cache keyed by tenant
}
export interface SyncHealthReport {
  tenantId: string; generatedAt: string; windowDays: number;   // windowDays = 7
  push: { total; accepted; rejected; deferred; successRate /*0..100, 100 when total=0*/; p95LatencyMs /*created_at→processed_at*/ };
  pullLagByEntity: { entityType; maxLagMs /*now − acknowledged_at*/; devices }[];
  conflictsByType: { key /*"entity_type:intent"*/; count }[];
  rejectionsByReason: { key /*result->>'reason', UNKNOWN fallback*/; count }[];
  outboxLagGauge: { bucket /*never|lt1h|lt6h|lt24h|lt7d|gt7d*/; devices }[];
  revokedPendingOps: { devices; pendingCommands; ownedDrafts };
  tombstones: number;                 // the GC ledger size (extra, §12-adjacent)
  alerts: { severity: "warning"|"critical"; code: "SyncCursorStall"|"SyncPushFailSpike"; message; details? }[];
}
```
Alert rules exactly per task: SyncCursorStall when any entity maxLagMs > 7d
(Sev-3 warning); SyncPushFailSpike when successRate < 90% AND total ≥ 20 over
the 7d window (Sev-2 critical).

### maintenance-jobs.ts
```ts
export const SYNC_INBOX_RETENTION_QUEUE = "sync.inbox.retention";  // cron "10 4 * * *"
export const SYNC_TOMBSTONE_GC_QUEUE    = "sync.tombstone.gc";     // cron "30 3 * * 0"
export const SYNC_CURSOR_COMPACT_QUEUE  = "sync.cursor.compact";   // cron "40 4 * * *"
export const SYNC_FEED_HEALTH_QUEUE     = "sync.feed.health";      // cron "*/5 * * * *"
export interface SyncSystemJobPayload { system: true }
export const RETENTION_BATCH = 5000;

export async function runInboxRetention(): Promise<{ tenants; deleted }>       // job bodies: iterate ACTIVE tenants
export async function runTombstoneGc(): Promise<{ tenants; deleted }>          //   via listActiveTenantIds() +
export async function runCursorCompact(): Promise<{ tenants; laggedDevices; notifications }>  // withTenant per tenant
export async function runFeedHealth(): Promise<{ tenants; stalls }>            // read-only

export async function sweepInboxRetentionBatch(): Promise<{ deleted; firstId }>  // ONE bounded iteration (spec-exposed)
export async function sweepInboxRetention(): Promise<{ deleted }>               // loop until drained + audit
export async function sweepTombstoneGc(): Promise<{ deleted }>                  // gc_after < now(), LIMIT 5000/loop + audit
export async function sweepCursorCompact(): Promise<CursorCompactResult>        // lag audit + owner notifications
export async function sweepFeedHealth(): Promise<{ stalls: { entityType; lagMs }[] }>
```
Audit actions: `sync.inbox_retention_swept`, `sync.tombstone_gc_swept`,
`sync.cursor_compact_run` (system actor, anchored on the first affected row id
— the reservations-sweep precedent; a pass with nothing to do records no row).
Cursor-stall notification: category `reconciliation`, severity `warning`,
bilingual jsonb title/body, actionUrl `/platform/sync-health`, dedupe key
`sync.cursor.stall:{deviceId}:{entityType}:{date}` (idempotent same-day).

### sync-admin.controller.ts
```ts
@Controller("api/v1/sync/admin") export class SyncAdminController {
  constructor(healthService: SyncHealthService, reconciliation: ReconciliationService)
  @Get("health")              @RequirePermissions("sync.settings.manage")  → envelope(await health())
  @Get("reconciliation")      @RequirePermissions("sync.devices.revoke")   → envelope(await reconciliation.pendingOperations())
  @Post("drafts/reassign")    @RequirePermissions("sync.devices.revoke")   → envelope(await reconciliation.reassignDrafts({actorId, fromDeviceId, toDeviceId}))
}
```
Paths match the route-permissions registry rows VERBATIM (checked at
route-permissions.ts lines 2670–2684). Body schema zod `{fromDeviceId: uuid,
toDeviceId: uuid}`; `requireIdentity` + `requireActiveTenant` duplicated
locally per the module convention (never import from a sibling controller).

### sync.module.ts registration (the crm.task-reminders-sweep shape, ×4)
`getBoss()` → `createQueue(...).catch(/exist/i rethrow)` →
`work<SyncSystemJobPayload>(queue, jobs ⇒ run*())` →
`schedule(queue, CRON, { system: true })` — one block per queue, payload
`{ system: true }`, failures never block module init.

## Web screens

- `/[locale]/platform/devices` — registry table (name, class, platform,
  contract version, attestation badge, trust-flag chips, last pull/push,
  status, data expiry, pending commands) + row actions: revoke (confirm dialog
  + reason → `POST /api/v1/devices/:id/revoke {reason}`), flag (`PATCH
  /api/v1/devices/:id {trustFlags:{key:value}}`), data expiry (DatePicker →
  `PATCH {dataExpiresAt}` ISO end-of-day, or clear), detail drawer (`GET
  /api/v1/devices/:id` → cursors per entity). URL filters: `?class=&status=`
  (shareable, the platform/audit pattern).
- `/[locale]/platform/sync-health` — stat cards (total/accepted/rejected/
  deferred/successRate/p95), pull-lag table, conflicts-by-type +
  rejections-by-reason bars (styled divs, no chart lib), outbox gauge buckets,
  revoked pending ops + tombstones cards, alerts feed with localized
  SyncCursorStall/SyncPushFailSpike messages + Sev badges, `generatedAt`
  footer (honest 60s-cache freshness).
- `/[locale]/platform/sync-reconciliation` — queue table (device, revokedAt,
  pendingCommands, ownedDrafts, oldestPendingAt) + reassign dialog (active
  devices select via best-effort GET /devices; manual device-id input fallback
  when the list is unavailable — honest degrade). **NO dismiss button** —
  `POST /api/v1/sync/admin/reconciliation/dismiss` is NOT registered in
  route-permissions.ts, so the screen deliberately offers no dismiss action
  (the registry is the source of truth; the service keeps `dismissDevice` for
  future wiring — T-P20-2c decision 10).

All three: server components, `getDictionary`, `requireSessionToken`,
`fetchApi` (lib/server-api), AppShell, ErrorState/RetryButton, 401→login
redirect, 403→platformNoAccess InfoNotice, Arabic-first RTL (`dir="ltr"`
isolation on mono/numeric cells), responsive grids, semantic HTML
(`table`/`thead`/`th[scope]`/`section`/`h2`), loading state on the detail
fetch (`role="status"`).

## Test evidence (verbatim)

```
$ cd apps/api && TMPDIR=$HOME/tmp-p20j npx vitest run --config vitest.db.config.ts src/__db__/sync/jobs.spec.ts
 ✓ src/__db__/sync/jobs.spec.ts (6 tests) 355ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  4.56s (incl. embedded-PG boot)

 ✓ … > the shared device fixture is registered (id captured for the suites below) 8ms
 ✓ … > inbox retention: only processed_at older than 30d, bounded at 5000/iteration, loop drains + audit 256ms
 ✓ … > tombstone GC: respects the gc_after horizon + audit 23ms
 ✓ … > cursor compact: lag computed, owner notification written + deduped by key, audited 39ms
 ✓ … > feed.health: read-only — change_log/notifications/audit untouched, stall detected 36ms
 ✓ … > health aggregate: push stats + p95, breakdowns, cursor lag, outbox gauge, revoked pending ops, alerts 22ms
```

Retention proof detail: 5200 stale rows → `runInboxRetention` drains them in
looped 5000-batches (audit `deleted: 5200`), 2 fresh rows survive; a fresh
5600-row set + ONE `sweepInboxRetentionBatch()` call deletes exactly
RETENTION_BATCH (5000) leaving 600; a second full pass drains the 600 (audit
`deleted: 600`). Cursor compact: 10d-old `items` ack → 1 notification with the
exact dedupe key + audit `sync.cursor_compact_run`; same-day re-run inserts 0
(dedupe absorbs); the 1h `partners` ack and never-acked `barcodes` cursor
produce none. feed.health: change_log/notifications/audit_events counts and
the feed head are byte-identical before vs after the pass, and the 20-min-old
`items` head is detected as a stall. Health aggregate: 42-command window →
successRate 16.7%, p95 3000ms, reason/type breakdowns, items-stall + fail-spike
alerts both firing, outbox buckets gt7d=1 + never=1, revokedPendingOps
{1,1,0}, tombstones 2, and the 60s cache serves the same `generatedAt`.

Full sync dir (sibling 3-b suites included — all green):

```
$ cd apps/api && TMPDIR=$HOME/tmp-p20j2 npx vitest run --config vitest.db.config.ts src/__db__/sync/
 ✓ src/__db__/sync/chaos-matrix.spec.ts (19 tests | 2 skipped) 2350ms   [3-b]
 ✓ src/__db__/sync/duplicates.spec.ts (5 tests) 607ms                   [3-b]
 ✓ src/__db__/sync/push.spec.ts (9 tests) 1356ms
 ✓ src/__db__/sync/jobs.spec.ts (6 tests) 363ms                         [3-a, this task]
 ✓ src/__db__/sync/devices.spec.ts (9 tests) 282ms
 ✓ src/__db__/sync/pull.spec.ts (9 tests) 112ms
 ✓ src/__db__/sync/policies.spec.ts (8 tests) 161ms
 Test Files  7 passed (7)
      Tests  63 passed | 2 todo (65)
```

## Gate results (all green)

| Gate | Result |
|---|---|
| `cd apps/api && npx tsc --noEmit -p tsconfig.json` | PASS (exit 0, no output) |
| `npx eslint` on the 5 owned api files | PASS (exit 0, no output) |
| `TMPDIR=$HOME/tmp-p20j npx vitest run --config vitest.db.config.ts src/__db__/sync/jobs.spec.ts` | PASS 6/6 |
| `TMPDIR=$HOME/tmp-p20j2 npx vitest run --config vitest.db.config.ts src/__db__/sync/` | PASS 7 files / 63 tests (2 todo) |
| `cd apps/web && npx tsc --noEmit -p tsconfig.json` | PASS (exit 0, no output) |
| repo root `pnpm check:i18n-parity` | PASS — `ar=3044 keys, en=3044 keys … 100% key parity; no empty values` |
| (W3 extra) `pnpm check:permissions-drift` | PASS — `matrix 243 keys, seed 243 keys` |
| eslint on the 7 owned web files (root config) | PASS (exit 0) |
| `Math.floor` scan of every owned file (ADR-0009) | 0 matches (bitwise `\| 0` pattern used) |

## Decisions (numbered, for the completion report)

1. **Notification category = `reconciliation`** (0023/0027 CHECK domain has no
   `system`/`sync` category; `reconciliation` is the semantically closest
   allowed value and 0027 kept it). Severity `warning` (the
   NotificationSeverity spelling; the MONITORING.md alert is Sev-3 — the
   mismatch is intentional: notification severity ≠ alert severity).
2. **p95 approximation documented in-code**: percentile of the ≤5000 most
   recent commands in the 7d window (`ORDER BY processed_at DESC LIMIT 5000`,
   sorted in JS), not of the full window. Index = `((n*95+99)/100) | 0`
   (ceil without Math.floor/float rounding — ADR-0009; n ≤ 5000 keeps the
   product inside the safe integer range).
3. **`deferred` is 0 by construction**: rate-limited DEFERRED commands are
   never persisted as inbox rows (2-b's C-03 discipline), so the column is
   computed but structurally zero — documented in the service header; the
   transient pressure is observable only in logs.
4. **`successRate = 100` when total = 0** (an empty window is healthy, not
   failing); one decimal via toFixed.
5. **Cursor "compaction" = the lag audit**: the (device_id, entity_type) UQ
   already enforces one row per pair, so there is nothing to merge — the pass
   computes lag = now − acknowledged_at, logs one aggregated warn per lagged
   device, and inserts the deduped owner notifications. Master-plan §11's
   "merge cursor hints (last per device/entity kept — UQ already)" concedes
   this: the UQ does the compaction.
6. **Audit rows need an entity anchor**: audit_events.entity_id is NOT NULL,
   so each swept pass anchors on the FIRST deleted row id (retention/GC) or
   the first lagged device id (compact) — the reservations-sweep precedent; a
   no-op pass records no row (nothing happened, nothing to audit).
7. **feed.health preconditions are approximation-guarded**: a stall counts
   only when the tenant has non-revoked devices that pulled within 24h (an
   idle tenant's quiet feed is healthy by definition — the 5-minute cadence
   must never spam), and the pass is strictly read-only: log warn only, zero
   writes (spec asserts change_log/notifications/audit_events are untouched).
8. **Nav mechanism**: the sidebar is registry-driven
   (`packages/contracts/src/navigation.ts` NAV_ITEMS — frozen/forbidden for
   this task), so the three screens ride the `platform/audit` precedent in
   `app-shell.tsx` FALLBACK_CRUMBS (breadcrumbs only). Sidebar entries need a
   NAV_ITEMS row (permission-gated `sync.settings.manage` /
   `identity.devices.manage` / `sync.devices.revoke`) — left for the
   orchestrator/W4 (leftover 2).
9. **`dismiss` deliberately absent from the screen** (task rule): no
   `reconciliation/dismiss` row exists in route-permissions.ts; offering a
   button that always 404s would be a lie. The queue still "closes to zero"
   via reassign + the service-level `dismissDevice` (wired when the route
   lands).
10. **Revoked pending ops mirror `pendingOperations`**: the health gauge
    applies the same `reconciliation_dismissed` filter as the queue so the
    dashboard number and the reconciliation screen agree on "close the queue
    to zero".
11. **Outbox gauge tenant boundary**: devices has no tenant_id (PHASE-003
    service-mediated rule), so tenant scoping rides the memberships join
    (`JOIN memberships m ON m.user_id = d.user_id`, RLS filters to the
    ambient tenant) — the 2-c list/pendingOperations precedent.
12. **Spec fixture**: dedicated tenant 27272727 (SAR, verified unused), owner
    27272727-…2701 + second user …2702; tenant `owner` role cloned from the
    system template via role_permissions cross-insert (the 0005 cross-join
    already carries the sync-plane keys); job functions called directly — no
    pg-boss in specs (the `run*` bodies are the queue handlers).
13. **The reconciliation screen's target list is best-effort**: fetching
    GET /devices needs `identity.devices.manage`, which a
    revoke-only admin may lack — the dialog then falls back to a manual
    device-id input (honest degrade; the API re-validates every id anyway).
14. **p95/latency rows, breakdowns bounded** at 5000 rows each (`LIMIT`)
    — the dashboard queries stay O(1) pages even on a hot tenant.

## Leftovers (for the orchestrator / W4)

1. **Sidebar NAV_ITEMS rows** for the three screens (packages/contracts
   navigation.ts is out of this task's ownership — decision 8).
2. **Dismiss route** (`POST /api/v1/sync/admin/reconciliation/dismiss`,
   `sync.devices.revoke`) — not registered in route-permissions.ts this
   phase; the service surface (`dismissDevice`) and the queue semantics are
   ready (SECURITY §4.4: un-acked ops keep a revoked device on the queue
   until a human dismisses).
3. **`outbox.lag` + `device.revoked.pending_ops` metrics exposition** beyond
   the dashboard shape (MONITORING docs land with T18/W4; the gauges are the
   `outboxLagGauge` buckets + `revokedPendingOps` object).
4. The 2 chaos-matrix `todo` skips are 3-b's WIP slots, not this task's
   scope.
