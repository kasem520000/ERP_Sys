# T-P20-2a — PHASE-020 pull side (Wave 2): feed groups + writer v2 + pull v2 + cursor v2 + permission snapshot

> Task ID: 2-a · PHASE-020 · SYNC_PROTOCOL §2/§9 + MASTER-PLAN §1/§5/§10.
> All six owned files delivered; `__db__/sync/pull.spec.ts` 9/9 green on the
> embedded-PG suite; owned files contribute ZERO typecheck errors (remaining
> api/sync-core errors are sibling agents' in-flight files — 2-b/2-c/2-d).

## Files

| File | Status |
|---|---|
| `apps/api/src/modules/sync/application/feed-groups.ts` | NEW |
| `apps/api/src/modules/sync/application/change-log-writer.ts` | REWRITTEN (generalized; 016 exports kept) |
| `apps/api/src/modules/sync/application/cursor-tokens.ts` | EXTENDED (format FROZEN; version re-export) |
| `apps/api/src/modules/sync/application/pull-service.ts` | REWRITTEN to v2 |
| `apps/api/src/modules/sync/application/permission-snapshot.ts` | NEW |
| `apps/api/src/__db__/sync/pull.spec.ts` | NEW (9 its, all green) |
| `apps/api/migrations/0030_sync_change_log_sequence_grant.sql` | NEW — **substrate fix, see D1** (+ `_journal.json`, `infra/db/migrations.ts`, `infra/db/migrations.spec.ts` registrations) |

## Exported signatures (EXACT — for controller wiring)

### pull-service.ts
```ts
export async function pull(input: {
  entityType: string;
  cursor: string | null;      // null → bootstrap
  limit?: number;             // default 500, clamped [1, 1000]
  deviceId?: string;          // OPTIONAL — absent = the 016 session path
                              // (fail-safe pos feed group)
}): Promise<PullEnvelopeV2>;

export interface PullEnvelopeV2 {
  entityType: string;
  cursor: string;             // LAST EMITTED seq token (016 semantics)
  hasMore: boolean;
  changes: readonly PullChangeV2[];
  nextCursor?: string;        // v2 alias — SAME token value as cursor
  serverTime?: string;        // ISO now
  contractVersion?: string;   // SYNC_CONTRACT_VERSION = "2026-11-04.1"
  resync?: boolean;           // C-12: bounded restart from seq 0
}
export interface PullChangeV2 {
  id: string; seq: number; op: "UPSERT" | "DELETE";
  payload: Record<string, unknown> | null;  // null on DELETE (tombstones)
  changedAt: string; version: number | null; // null on DELETE
}
export type PullEnvelope = PullEnvelopeV2;   // 016 name kept as alias

export class SyncDeviceRevokedError extends DomainError  // code "DEVICE_REVOKED"
export class SyncEntityNotPulledError extends DomainError // code "SYNC_ENTITY_NOT_PULLED"
export const PULL_PAGE_BYTE_CAP = 2_000_000;
export function fitsByteCap(accumulatedBytes: number, nextItemBytes: number): boolean;
```
Controller call shape is the 016 one EXTENDED by `deviceId`:
`pull({entityType, cursor, limit, deviceId})`. The 016 controller compiles
and behaves unchanged without `deviceId` (pos group default; bad cursors
still throw `PosSyncEntityInvalidError` with the 016 messages).

### feed-groups.ts
```ts
export function feedGroupForDeviceClass(deviceClass: string | null): readonly string[];
// class group + "permissions"; unknown/null → pos group + permissions
export function isEntityPullableByDevice(entityType: string, deviceClass: string | null): boolean;
export function deviceClassOf(row: {deviceClass: string | null; platform: string | null}): string;
// device_class → platform map ('pos-terminal'|'DESKTOP'→'tauri-desktop'|'ANDROID'→'android-field') → default 'pos-terminal'
export interface SyncDeviceRow { id; userId; deviceClass; platform; revokedAt; dataExpiresAt; contractVersion }
export async function loadDevice(deviceId: string): Promise<SyncDeviceRow | undefined>;
```

### change-log-writer.ts
```ts
export const POS_FEED_ENTITIES: readonly ["items","barcodes","uoms","price_list_items","partners","tax_codes"]; // 016 verbatim
export type PosFeedEntity = ...;
export function isPosFeedEntity(entityType: string): entityType is PosFeedEntity; // 016 verbatim
export type FeedEntity = (typeof PULLED_ENTITY_TYPES)[number]; // 9 entities
export function isFeedEntity(entityType: string): entityType is FeedEntity;
export async function syncFeed(entityType: FeedEntity, chunk = 500): Promise<string | null>;
export interface FeedEntry { entityType: string; entityId: string; op: "UPSERT" | "DELETE";
  payload: Record<string, unknown> | null; changedAt?: string }
export async function publishFeedEntries(entries: readonly FeedEntry[]): Promise<void>;
// in-tx feed writer for pushed commands (SYNC_PROTOCOL §9 note 4); empty → no-op;
// DELETE ops also upsert tombstones. 2-b's push-service.ts already imports this.
```
Projections now cover all 9 feed entities: the 016 six + `pos_terminals`,
`cashier_shifts`, `sales_invoices` (header-only — lines NOT pulled in 020).
Every payload carries the source `version` (all 9 source tables have the
column — verified per migration; no `version: 1` fallback was needed).

### cursor-tokens.ts
```ts
export { SYNC_CONTRACT_VERSION } from "@erp/contracts"; // "2026-11-04.1"
// encodeCursor/decodeCursor/CursorClaims UNCHANGED (016 tokens stay valid)
```
NOTE for the controller: `/sync/status` now advertises `"2026-11-04.1"`
(the env-derived `1.0.0-pos-dev` local constant is retired per task).

### permission-snapshot.ts
```ts
export async function syncPermissionSnapshot(device: {userId: string}): Promise<string | null>;
// appends when key-set changed OR last snapshot > 6d old; returns snapshotAt | null
export async function pullPermissionSnapshot(input: {
  userId: string; cursor: string | null; limit: number;
}): Promise<{changes: PermissionSnapshotChange[]; hasMore: boolean; nextCursorToken: string; resync?: boolean}>;
export interface PermissionSnapshotChange { /* same shape as PullChangeV2 */ }
```
Payload: `{userId, permissions: [...keys], snapshotAt, watermarkDays: 7}`.
Key source: `erp.user_effective_permissions(userId, erp.current_tenant_id())`
(the identity module's canonical SECURITY DEFINER query — 0003).

## Test evidence (`__db__/sync/pull.spec.ts`, tenant 20202020 / actor ...3001)

```
 ✓ src/__db__/sync/pull.spec.ts (9 tests) 418ms
   ✓ bootstrap pull (cursor null) → seq-ordered changes with version; drained → hasMore false
   ✓ page cap: limit=2 → hasMore + advancing nextCursor; continuation is contiguous
   ✓ byte cap: fitsByteCap enforces the 2 MB page budget (pure)
   ✓ C-12: cursor beyond the feed head → resync directive (fresh 0-cursor, zero changes)
   ✓ feed-group gate: android-personal cannot pull items (SYNC_ENTITY_NOT_PULLED) but pulls permissions
   ✓ revoked device: pull rejected with DEVICE_REVOKED before anything is served (§1.5)
   ✓ tombstone: soft-deleted partner → op:'DELETE' + payload:null feed entry + a tombstones row
   ✓ permission snapshot: revoking the membership projects an updated snapshot row on the next pull
   ✓ pos-group v2 projections: pos_terminals feed entry present; cashier_shifts drains empty
 Test Files  1 passed (1)   Tests  9 passed (9)
```
Regression smokes (my shared-surface changes only): `infra/db/migrations.spec.ts`
4/4, `__db__/migrations.db.spec.ts` + `__db__/readiness.db.spec.ts` 11/11,
016 `__db__/pos/golden.spec.ts` 5/5.

## Decisions (for the completion report / orchestrator)

1. **D1 — Migration 0030 (substrate fix, outside the owned list — flagged
   loudly):** 0024 granted erp_app `INSERT ON change_log` but never
   `USAGE ON SEQUENCE change_log_seq_seq` — `nextval()` is denied for
   erp_app, so NO feed writer (016's included) could ever append through
   the app role; the gap was invisible because no spec exercised the
   INSERT path (the isolation suite seeds change_log as the bootstrap
   role). My spec hit it immediately (`permission denied for sequence
   change_log_seq_seq`). Fix follows the 0028 precedent (a missed grant on
   an applied migration closed by a dedicated additive migration):
   `GRANT USAGE, SELECT ON SEQUENCE change_log_seq_seq TO erp_app` +
   registrations (`_journal.json`, `infra/db/migrations.ts`,
   `infra/db/migrations.spec.ts` last-tag assertion). schema_version → 30
   (all consumers are MIGRATIONS.length-based — verified).
2. **Tombstone scope:** DELETE feed entries + tombstones rows are emitted
   ONLY for sources with a soft-delete lifecycle (items/partners
   `deleted_at`). pos_terminals/cashier_shifts/uoms/tax_codes/barcodes/
   price_list_items have no delete lifecycle (0024: "no delete — documents
   reference terminals") — deactivation rides the UPSERT payload (status
   INACTIVE/ARCHIVED), so a device KEEPS the row and can see it is
   inactive. This matches MASTER-PLAN §5.7 ("projection of soft-deleted
   rows"); the task brief's "or a deactivation status" is satisfied by
   items/partners' ARCHIVED (which implies deleted_at by CHECK).
3. **DELETE rows keep their source payload in change_log** (the watermark
   reads `payload->>'changedAt'` — nulling it would stall the watermark on
   delete-only tails); the PULL ENVELOPE nulls payload + version on
   DELETE (master-plan §1.1 wire contract). `publishFeedEntries` stores
   payload verbatim (null allowed) — its DELETE rows don't advance the
   watermark, which is fine because the catch-up writer covers the
   source-based watermark for those entities.
4. **Permission snapshot refresh cadence:** append on key-set change OR
   when the last snapshot row is > 6d old (SNAPSHOT_REFRESH_MS). Without
   the freshness rule an idle tenant's snapshot would age past the 7-day
   D-04 watermark and every device would flip read-only despite zero
   permission changes. Bounded growth: ≤ ~1 row / 6d / user when idle.
5. **Chunking NOT implemented:** the 500-key chunk rule is satisfied by
   reality (243-key matrix, W1 drift-check parity); single row per
   snapshot, entity_id = userId. `${userId}:${page}` pagination deferred
   (comment in the file).
6. **Error mapping duplication with 2-b:** `SyncDeviceRevokedError` also
   exists in 2-b's `domain/sync-errors.ts` (push-flavored message; same
   code "DEVICE_REVOKED"). Mine lives in pull-service.ts because the task
   forbade creating domain files. Recommend the orchestrator consolidate
   on the domain/ spelling and re-export from pull-service (or move
   `SyncEntityNotPulledError` — pull-only, no 2-b counterpart — into
   domain/sync-errors.ts) when wiring controllers + the error filter.
7. **HTTP mappings for the filter are the orchestrator's:** suggested —
   `SYNC_ENTITY_NOT_PULLED` → 404 (no existence leak), `DEVICE_REVOKED`
   → 403, keep 016's `SYNC_ENTITY_INVALID` → 422 for bad cursors. None of
   the new codes are mapped in `error.filter.ts` yet (not my file).
8. **Device-not-found on pull** → 016's `PosDeviceNotFoundError` (404
   shape, no leak). **`permissions` pull without deviceId** →
   `PosSyncEntityInvalidError("permissions (pull requires a device — pass
   deviceId)")` — the snapshot is per device USER; the v2 controller
   should pass `deviceId` (or a future `userId` input) for this entity.
9. **C-12 threshold:** resync iff `decoded.seq > max(seq)` (empty head →
   0), per the task brief (§5.4's "+1" spelling would miss the
   exactly-at-head+1 stale case; `>` catches it).
10. **`max(seq)`/`seq` coercion:** pg returns int8 as string — every seq
    is `Number()`-coerced before it touches the envelope (the 016 code
    passed it through raw).
11. **`changedAt` ISO fix:** the 016 `mapRow` used `String(Date)` (locale
    format, unparseable by pg) for the returned watermark/tombstone
    timestamps; now `toISOString()`. The payload JSON is unchanged
    (JSON.stringify already rendered ISO).
12. **data_expires_at NOT enforced on pull** (loadDevice returns it; the
    021 sync-core consumer refuses local reads past it — master-plan §9).
    Pull-side enforcement was not in scope; flag for 2-c/3-a if wanted.

## Left for the orchestrator / other waves
- Controller wiring: pass `deviceId` (X-Device-Id / device JWT claim) into
  `pull`; `/sync/status` v2 shape (§5.6) + `pull/ack` (§5.5) are NOT in my
  owned files — nothing implements them yet.
- Error-filter rows for the new codes (D7).
- Consolidate the duplicated SyncDeviceRevokedError (D6).
- C-12 resync is exercised per-entity; the permissions path also returns
  `resync` (user-scoped head).
