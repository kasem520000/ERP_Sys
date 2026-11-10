import { sql } from "drizzle-orm";

import { PULLED_ENTITY_TYPES } from "@erp/contracts";

import {
  requireTenantContext,
  withTenant,
  type TenantDb,
} from "../../../infra/db/tenant-context";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import { childLogger } from "../../../infra/observability/logger";
import { AuditService } from "../../audit/api/audit";
import { DrizzleAuditStore } from "../../audit/infrastructure/drizzle-audit.store";
import { InboxService } from "../../notifications/application/inbox-service";

/**
 * PHASE-020 · the sync maintenance jobs (T13; MASTER-PLAN §11; PHASE-020
 * §2 items 8–11): four idempotent, bounded sweeps registered as pg-boss
 * queues by `sync.module.ts` (the crm task-reminders-sweep registration
 * shape). Every handler carries `{ system: true }` — no tenant id in the
 * payload — and re-establishes the tenant scope per ACTIVE tenant through
 * `withTenant` (ADR-0005; the inventory.reservations-sweep contract). All
 * SQL below runs as `erp_app` INSIDE the tenant transaction, so the
 * tenant-owned tables (inbox_commands, tombstones, sync_cursors,
 * change_log, notifications) are RLS-scoped to that tenant only.
 *
 * Per-tenant pass functions (`sweep*`) require an ambient `withTenant`
 * scope and are exported so the db spec exercises them without pg-boss;
 * the `run*` functions are the job handlers' bodies (iterate ACTIVE
 * tenants, one UoW per tenant — a failure in one tenant never blocks the
 * rest, the crm sweep contract).
 *
 * Module-level singletons (the device-tokens.ts precedent): the audit
 * service and the notifications InboxService are instantiated here, not
 * DI-provided, so the functions stay plain-callable from the spec.
 */

const log = childLogger({ module: "sync-jobs" });
const audit = new AuditService(new DrizzleAuditStore());
const inbox = new InboxService();

// -- queue names + crons (registered by sync.module.ts) ------------------------

/** Daily 04:10 UTC (MASTER-PLAN §11). */
export const SYNC_INBOX_RETENTION_QUEUE = "sync.inbox.retention";
export const SYNC_INBOX_RETENTION_CRON = "10 4 * * *";

/** Sundays 03:30 UTC (MASTER-PLAN §11). */
export const SYNC_TOMBSTONE_GC_QUEUE = "sync.tombstone.gc";
export const SYNC_TOMBSTONE_GC_CRON = "30 3 * * 0";

/** Daily 04:40 UTC (MASTER-PLAN §11). */
export const SYNC_CURSOR_COMPACT_QUEUE = "sync.cursor.compact";
export const SYNC_CURSOR_COMPACT_CRON = "40 4 * * *";

/** Every 5 minutes (MASTER-PLAN §11). */
export const SYNC_FEED_HEALTH_QUEUE = "sync.feed.health";
export const SYNC_FEED_HEALTH_CRON = "*/5 * * * *";

/** The system jobs' payload: no tenant id — the handlers iterate ACTIVE
 * tenants themselves (the reservation-sweep contract). */
export interface SyncSystemJobPayload {
  system: true;
}

// -- tuning constants -----------------------------------------------------------

/** Per-iteration DELETE bound (MASTER-PLAN §11: LIMIT 5000/loop). */
export const RETENTION_BATCH = 5000;

/** Cursor-lag alert horizon (MASTER-PLAN §11: > 7d → warn + owner row). */
const CURSOR_LAG_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/** Feed-stall threshold (MASTER-PLAN §11: > 10 min → log warn only). */
const FEED_STALL_MS = 10 * 60 * 1000;

/** A device whose last pull is within this window counts as "recent" for
 * the feed-health stall precondition (documented approximation — a device
 * that pulled within a day is an active consumer of the feed). */
const FEED_HEALTH_RECENT_PULL_MS = 24 * 60 * 60 * 1000;

/** UTC calendar date of "now" — the dedupe-key horizon (one owner row per
 * device/entity/day; a same-day re-run dedupes to a no-op). */
function utcDateKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function tenantTx(functionName: string): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error(`${functionName} requires an ambient withTenant scope`);
  }
  return context.tx;
}

// -- 1. inbox retention ---------------------------------------------------------

/**
 * ONE bounded retention iteration: DELETE up to RETENTION_BATCH
 * inbox_commands rows whose processed_at is older than 30 days, returning
 * the deleted count (the loop primitive — exported for the db spec's
 * bound proof). Rows are ordered by processed_at so the oldest go first.
 */
export async function sweepInboxRetentionBatch(): Promise<{
  deleted: number;
  firstId: string | null;
}> {
  const tx = tenantTx("sweepInboxRetentionBatch");
  const batch = await tx.execute(sql`
    DELETE FROM inbox_commands
    WHERE id IN (
      SELECT id FROM inbox_commands
      WHERE processed_at < now() - interval '30 days'
      ORDER BY processed_at
      LIMIT ${RETENTION_BATCH}
    )
    RETURNING id
  `);
  const ids = batch.rows as unknown as { id: string }[];
  return { deleted: ids.length, firstId: ids[0]?.id ?? null };
}

/**
 * The per-tenant inbox retention pass: loop the bounded batch until an
 * iteration deletes fewer than RETENTION_BATCH rows (the set is drained).
 * Audited as a system action (no actor) anchored on the FIRST deleted row
 * id — audit_events.entity_id is NOT NULL (the reservations-sweep
 * pattern); a pass that deleted nothing records no audit row.
 */
export async function sweepInboxRetention(): Promise<{ deleted: number }> {
  let deleted = 0;
  let firstId: string | null = null;
  for (;;) {
    const batch = await sweepInboxRetentionBatch();
    if (firstId === null) {
      firstId = batch.firstId;
    }
    deleted += batch.deleted;
    if (batch.deleted < RETENTION_BATCH) {
      break;
    }
  }
  if (deleted > 0 && firstId !== null) {
    await audit.record({
      action: "sync.inbox_retention_swept",
      entityType: "inbox_command",
      entityId: firstId,
      after: { deleted },
    });
  }
  return { deleted };
}

/** The job handler body: one pass per ACTIVE tenant. */
export async function runInboxRetention(): Promise<{ tenants: number; deleted: number }> {
  const tenantIds = await listActiveTenantIds();
  let deleted = 0;
  for (const tenantId of tenantIds) {
    const swept = await withTenant(tenantId, () => sweepInboxRetention());
    deleted += swept.deleted;
  }
  return { tenants: tenantIds.length, deleted };
}

// -- 2. tombstone GC --------------------------------------------------------------

/**
 * The per-tenant tombstone GC pass: DELETE rows whose gc_after horizon
 * has passed (deleted_at + 90d by default — the soft-delete GC ledger),
 * in bounded RETENTION_BATCH iterations. Audited like the inbox sweep
 * (system action, anchored on the first deleted id; nothing → no row).
 */
export async function sweepTombstoneGc(): Promise<{ deleted: number }> {
  const tx = tenantTx("sweepTombstoneGc");
  let deleted = 0;
  let firstId: string | null = null;
  for (;;) {
    const batch = await tx.execute(sql`
      DELETE FROM tombstones
      WHERE id IN (
        SELECT id FROM tombstones
        WHERE gc_after < now()
        ORDER BY gc_after
        LIMIT ${RETENTION_BATCH}
      )
      RETURNING id
    `);
    const ids = batch.rows as unknown as { id: string }[];
    if (firstId === null && ids.length > 0) {
      firstId = ids[0]!.id;
    }
    deleted += ids.length;
    if (ids.length < RETENTION_BATCH) {
      break;
    }
  }
  if (deleted > 0 && firstId !== null) {
    await audit.record({
      action: "sync.tombstone_gc_swept",
      entityType: "tombstone",
      entityId: firstId,
      after: { deleted },
    });
  }
  return { deleted };
}

/** The job handler body: one pass per ACTIVE tenant. */
export async function runTombstoneGc(): Promise<{ tenants: number; deleted: number }> {
  const tenantIds = await listActiveTenantIds();
  let deleted = 0;
  for (const tenantId of tenantIds) {
    const swept = await withTenant(tenantId, () => sweepTombstoneGc());
    deleted += swept.deleted;
  }
  return { tenants: tenantIds.length, deleted };
}

// -- 3. cursor compaction + lag alert ---------------------------------------------

export interface CursorCompactResult {
  /** Distinct devices carrying cursor rows in this tenant. */
  devices: number;
  /** Cursor rows in this tenant (one per device/entity — the UQ). */
  entities: number;
  /** Cursor rows whose acknowledged_at is past the 7-day lag horizon. */
  laggedRows: number;
  /** Distinct devices with at least one lagged row. */
  laggedDevices: number;
  /** Notification rows INSERTED this pass (deduped re-runs insert 0). */
  notifications: number;
}

/**
 * The per-tenant cursor compaction pass. The (device_id, entity_type) UQ
 * already enforces single-row-per-entity, so "compaction" is the lag
 * audit: lag = now − acknowledged_at per device/entity. Rows past the
 * 7-day horizon log a warn (aggregated per device) and insert one owner
 * notification per device/entity/day (dedupe key
 * `sync.cursor.stall:{deviceId}:{entityType}:{date}` — idempotent for
 * same-day re-runs). Audited as `sync.cursor_compact_run` anchored on the
 * first lagged device when the pass found lag (the reservations-sweep
 * precedent: a pass with nothing to report records no row).
 *
 * The notification category is `reconciliation` — the closest allowed
 * value of the notifications CHECK domain (0023/0027 have no `system`
 * category) — and the severity is `warning` (the NotificationSeverity
 * spelling; the MONITORING.md alert is Sev-3).
 */
export async function sweepCursorCompact(): Promise<CursorCompactResult> {
  const tx = tenantTx("sweepCursorCompact");
  const totals = await tx.execute(sql`
    SELECT count(*)::int AS entities, count(DISTINCT device_id)::int AS devices
    FROM sync_cursors
  `);
  const totalRow =
    (totals.rows as unknown as { entities: number; devices: number }[])[0] ?? {
      entities: 0,
      devices: 0,
    };

  const laggedRows = await tx.execute(sql`
    SELECT sc.device_id AS "deviceId", d.name AS "deviceName",
           sc.entity_type AS "entityType",
           (extract(epoch from (now() - sc.acknowledged_at)) * 1000)::double precision AS "lagMs"
    FROM sync_cursors sc
    JOIN devices d ON d.id = sc.device_id
    WHERE sc.acknowledged_at IS NOT NULL
      AND (now() - sc.acknowledged_at) > ${CURSOR_LAG_HORIZON_MS} * interval '1 millisecond'
    ORDER BY "deviceId", "entityType"
  `);
  const lagged = laggedRows.rows as unknown as {
    deviceId: string;
    deviceName: string | null;
    entityType: string;
    lagMs: number;
  }[];

  const laggedDevices = new Set(lagged.map((row) => row.deviceId));

  // Compact log: one warn line per lagged device (bounded by device count).
  const perDevice = new Map<string, { name: string | null; entities: string[]; maxLagMs: number }>();
  for (const row of lagged) {
    const entry =
      perDevice.get(row.deviceId) ?? { name: row.deviceName, entities: [], maxLagMs: 0 };
    entry.entities.push(row.entityType);
    if (row.lagMs > entry.maxLagMs) {
      entry.maxLagMs = row.lagMs;
    }
    perDevice.set(row.deviceId, entry);
  }
  const context = requireTenantContext();
  for (const [deviceId, entry] of perDevice) {
    log.warn(
      {
        tenantId: context.tenantId,
        deviceId,
        deviceName: entry.name,
        entities: entry.entities,
        maxLagMs: Number(entry.maxLagMs.toFixed(0)),
        horizonDays: CURSOR_LAG_HORIZON_MS / 86400000,
      },
      "sync cursor stall: device cursors are past the lag horizon",
    );
  }

  // One owner notification per lagged device/entity, deduped per day.
  let notifications = 0;
  if (lagged.length > 0) {
    const owner = await inbox.ownerTarget();
    if (owner !== null) {
      const prefs = await inbox.prefsFor(owner.userId, "reconciliation");
      if (prefs.inApp) {
        const date = utcDateKey();
        for (const row of lagged) {
          const deviceLabel = row.deviceName ?? row.deviceId;
          const outcome = await inbox.record({
            category: "reconciliation",
            severity: "warning",
            title: { ar: "توقف مؤشر مزامنة جهاز", en: "Device sync cursor stall" },
            body: {
              ar: `الجهاز «${deviceLabel}» لم يؤكد مؤشر «${row.entityType}» منذ أكثر من 7 أيام — تحقق من حالة الجهاز.`,
              en: `Device "${deviceLabel}" has not acknowledged the "${row.entityType}" cursor for more than 7 days — check the device.`,
            },
            actionUrl: "/platform/sync-health",
            dedupeKey: `sync.cursor.stall:${row.deviceId}:${row.entityType}:${date}`,
            userId: owner.userId,
          });
          if (outcome.inserted) {
            notifications += 1;
          }
        }
      }
    }
  }

  if (lagged.length > 0) {
    await audit.record({
      action: "sync.cursor_compact_run",
      entityType: "sync_cursor",
      entityId: lagged[0]!.deviceId,
      after: {
        devices: totalRow.devices,
        entities: totalRow.entities,
        laggedRows: lagged.length,
        laggedDevices: laggedDevices.size,
        notifications,
      },
    });
  }

  return {
    devices: totalRow.devices,
    entities: totalRow.entities,
    laggedRows: lagged.length,
    laggedDevices: laggedDevices.size,
    notifications,
  };
}

/** The job handler body: one pass per ACTIVE tenant. */
export async function runCursorCompact(): Promise<{
  tenants: number;
  laggedDevices: number;
  notifications: number;
}> {
  const tenantIds = await listActiveTenantIds();
  let laggedDevices = 0;
  let notifications = 0;
  for (const tenantId of tenantIds) {
    const swept = await withTenant(tenantId, () => sweepCursorCompact());
    laggedDevices += swept.laggedDevices;
    notifications += swept.notifications;
  }
  return { tenants: tenantIds.length, laggedDevices, notifications };
}

// -- 4. feed health ----------------------------------------------------------------

export interface FeedHealthResult {
  /** Entities whose feed head is stalling (max(changed_at) > 10 min old)
   * while the tenant has active devices with recent pulls. Read-only pass
   * — NO data changes, NO notifications (log warn only, per MASTER-PLAN
   * §11: the 5-minute cadence must never spam). */
  stalls: { entityType: string; lagMs: number }[];
}

/**
 * The per-tenant feed health pass: for every FEED entity with rows in
 * change_log, max(changed_at) older than 10 minutes is a stall — but only
 * while the tenant has active (non-revoked) devices with recent pulls
 * (within 24h — documented approximation); an idle tenant's quiet feed is
 * healthy by definition. Read-only: it only logs.
 */
export async function sweepFeedHealth(): Promise<FeedHealthResult> {
  const tx = tenantTx("sweepFeedHealth");
  const context = requireTenantContext();

  const deviceRows = await tx.execute(sql`
    SELECT count(*)::int AS n
    FROM devices d
    JOIN memberships m ON m.user_id = d.user_id
    WHERE m.status = 'ACTIVE'
      AND d.revoked_at IS NULL
      AND d.last_pull_at IS NOT NULL
      AND (now() - d.last_pull_at) < ${FEED_HEALTH_RECENT_PULL_MS} * interval '1 millisecond'
  `);
  const activeDevices = (deviceRows.rows as unknown as { n: number }[])[0]?.n ?? 0;

  const stalls: { entityType: string; lagMs: number }[] = [];
  if (activeDevices > 0) {
    const feedEntities = sql.join(
      PULLED_ENTITY_TYPES.map((entityType) => sql`${entityType}`),
      sql`, `,
    );
    const heads = await tx.execute(sql`
      SELECT entity_type AS "entityType",
             (extract(epoch from (now() - max(changed_at))) * 1000)::double precision AS "lagMs"
      FROM change_log
      WHERE entity_type IN (${feedEntities})
      GROUP BY entity_type
    `);
    for (const row of heads.rows as unknown as { entityType: string; lagMs: number }[]) {
      if (row.lagMs > FEED_STALL_MS) {
        stalls.push({ entityType: row.entityType, lagMs: Number(row.lagMs.toFixed(0)) });
      }
    }
  }

  if (stalls.length > 0) {
    log.warn(
      {
        tenantId: context.tenantId,
        activeDevices,
        stalls,
        thresholdMs: FEED_STALL_MS,
      },
      "sync feed stall: entities stopped changing while devices are pulling",
    );
  }
  return { stalls };
}

/** The job handler body: one pass per ACTIVE tenant. */
export async function runFeedHealth(): Promise<{ tenants: number; stalls: number }> {
  const tenantIds = await listActiveTenantIds();
  let stalls = 0;
  for (const tenantId of tenantIds) {
    const swept = await withTenant(tenantId, () => sweepFeedHealth());
    stalls += swept.stalls.length;
  }
  return { tenants: tenantIds.length, stalls };
}
