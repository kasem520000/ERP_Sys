import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-020 · the sync health aggregate (T14; MASTER-PLAN §12; PHASE-020
 * §2 item 11): `GET /api/v1/sync/admin/health` — push success/latency, pull
 * cursor lag per entity, conflict + rejection breakdowns, the outbox lag
 * gauge, revoked-device pending ops, and derived alerts. Computed from
 * bounded queries over the tenant's inbox_commands / sync_cursors /
 * devices / tombstones rows on the ambient `withTenant` transaction (the
 * guarded route's interceptor establishes the scope — the
 * ReconciliationService.pendingOperations contract).
 *
 * In-memory cache (60s, module-level Map — the push-service rate-limiter
 * pattern): per API process, keyed by tenant id. The cached copy is served
 * as-is; `generatedAt` is the ORIGINAL compute time, so a served report is
 * at most 60s stale by design.
 *
 * Documented approximations:
 * - p95LatencyMs is computed from `processed_at - created_at` deltas of the
 *   ≤5000 MOST RECENT commands in the 7d window (ORDER BY processed_at DESC
 *   LIMIT 5000, then sorted in JS) — the percentile of the recent sample,
 *   not of the full window.
 * - `deferred` is 0 by construction: rate-limited (DEFERRED) commands are
 *   never persisted as inbox rows (C-03 discipline) — the transient
 *   rate-limit pressure is observable only in logs. The field stays in the
 *   report shape per MASTER-PLAN §12.
 * - successRate is 100 when total is 0 (an empty window is healthy, not
 *   failing); one decimal via toFixed.
 */

/** Report cache TTL (the push-service rate-limiter pattern). */
const CACHE_TTL_MS = 60_000;

/** Bounded window for the push-plane aggregates. */
const WINDOW_DAYS = 7;

/** p95 sample cap (see the header note). */
const P95_SAMPLE_CAP = 5000;

/** Breakdown sample cap (rejected rows over the window). */
const BREAKDOWN_CAP = 5000;

/** Cursor-lag alert horizon (SyncCursorStall — MONITORING Sev-3). */
const CURSOR_STALL_MS = 7 * 24 * 60 * 60 * 1000;

/** Push failure-spike thresholds (SyncPushFailSpike — MONITORING Sev-2). */
const FAIL_SPIKE_RATE = 90;
const FAIL_SPIKE_MIN_TOTAL = 20;

export interface SyncHealthPushStats {
  total: number;
  accepted: number;
  rejected: number;
  deferred: number;
  /** 0..100, one decimal; 100 when total is 0. */
  successRate: number;
  /** Processing latency p95 in ms (created_at → processed_at); null when
   * the window has no samples. */
  p95LatencyMs: number | null;
}

export interface SyncHealthPullLagRow {
  entityType: string;
  /** max(now − acknowledged_at) over the entity's acknowledged cursors, in
   * ms; null when the entity has no acknowledged cursor (excluded rows are
   * cursor rows never acknowledged — no lag is defined for them). */
  maxLagMs: number | null;
  /** Devices with an acknowledged cursor for the entity. */
  devices: number;
}

export interface SyncHealthBreakdownRow {
  /** rejectionsByReason: the typed reason code (`result.reason`, UNKNOWN
   * when missing). conflictsByType: `entity_type:intent` — the command
   * types where conflicts land. */
  key: string;
  count: number;
}

export interface SyncHealthOutboxBucket {
  /** last_push_at age bucket: never | lt1h | lt6h | lt24h | lt7d | gt7d. */
  bucket: string;
  devices: number;
}

export interface SyncHealthRevokedPendingOps {
  /** Revoked devices still on the reconciliation queue (dismissed devices
   * excluded — mirrors ReconciliationService.pendingOperations so the
   * gauge and the queue agree on "close the queue to zero"). */
  devices: number;
  pendingCommands: number;
  ownedDrafts: number;
}

export interface SyncHealthAlert {
  /** warning = Sev-3, critical = Sev-2 (MONITORING §1). The web screen
   * localizes by `code` using `details`; `message` is the ops-facing
   * English text (the fallback when a code is unknown to the client). */
  severity: "warning" | "critical";
  code: string;
  message: string;
  /** Localization variables for the known codes (entity/days/devices,
   * rate/total/rejected). */
  details?: Record<string, string | number>;
}

export interface SyncHealthReport {
  tenantId: string;
  generatedAt: string;
  windowDays: number;
  push: SyncHealthPushStats;
  pullLagByEntity: SyncHealthPullLagRow[];
  conflictsByType: SyncHealthBreakdownRow[];
  rejectionsByReason: SyncHealthBreakdownRow[];
  outboxLagGauge: SyncHealthOutboxBucket[];
  revokedPendingOps: SyncHealthRevokedPendingOps;
  /** Current tombstones rows (the GC ledger size). */
  tombstones: number;
  alerts: SyncHealthAlert[];
}

interface CacheEntry {
  at: number;
  report: SyncHealthReport;
}

const reportCache = new Map<string, CacheEntry>();

/** The outbox lag buckets in display order. */
const OUTBOX_BUCKETS = ["never", "lt1h", "lt6h", "lt24h", "lt7d", "gt7d"] as const;

@Injectable()
export class SyncHealthService {
  /**
   * The per-tenant health report. Runs on the ambient tenant transaction
   * (RLS scopes every query to the tenant); a fresh copy is cached for 60s
   * per process.
   */
  async health(): Promise<SyncHealthReport> {
    const context = requireTenantContext();
    const cached = reportCache.get(context.tenantId);
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.report;
    }
    const report = await this.compute(context.tenantId);
    reportCache.set(context.tenantId, { at: Date.now(), report });
    return report;
  }

  private async compute(tenantId: string): Promise<SyncHealthReport> {
    const tx = requireTenantContext().tx!;

    // -- push plane (7d window, bounded) --------------------------------------
    const pushRows = await tx.execute(sql`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'ACCEPTED')::int AS accepted,
             count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected,
             count(*) FILTER (WHERE result->>'status' = 'DEFERRED')::int AS deferred
      FROM inbox_commands
      WHERE processed_at > now() - ${WINDOW_DAYS} * interval '1 day'
    `);
    const pushRow =
      (pushRows.rows as unknown as {
        total: number;
        accepted: number;
        rejected: number;
        deferred: number;
      }[])[0] ?? { total: 0, accepted: 0, rejected: 0, deferred: 0 };

    // p95 of processed_at - created_at (see the header approximation note).
    const latencyRows = await tx.execute(sql`
      SELECT (extract(epoch from (processed_at - created_at)) * 1000)::double precision AS "latencyMs"
      FROM inbox_commands
      WHERE processed_at > now() - ${WINDOW_DAYS} * interval '1 day'
      ORDER BY processed_at DESC
      LIMIT ${P95_SAMPLE_CAP}
    `);
    const latencies = (latencyRows.rows as unknown as { latencyMs: number }[])
      .map((row) => row.latencyMs)
      .sort((a, b) => a - b);
    let p95LatencyMs: number | null = null;
    if (latencies.length > 0) {
      // ceil(0.95 × n) as a 0-based index — computed via the bitwise
      // int-truncation pattern the login-service uses (ADR-0009 bans
      // Math.floor; n ≤ 5000 so the product stays far inside the safe
      // integer range).
      const index = ((latencies.length * 95 + 99) / 100) | 0;
      p95LatencyMs = Number(latencies[index - 1]!.toFixed(1));
    }

    const successRate =
      pushRow.total === 0
        ? 100
        : Number(((pushRow.accepted / pushRow.total) * 100).toFixed(1));

    // -- rejection breakdowns (rejected rows over the window, bounded) --------
    const rejectedRows = await tx.execute(sql`
      SELECT coalesce(result->>'reason', 'UNKNOWN') AS reason,
             entity_type || ':' || intent AS "commandType"
      FROM inbox_commands
      WHERE status = 'REJECTED' AND processed_at > now() - ${WINDOW_DAYS} * interval '1 day'
      ORDER BY processed_at
      LIMIT ${BREAKDOWN_CAP}
    `);
    const reasonCounts = new Map<string, number>();
    const conflictCounts = new Map<string, number>();
    for (const row of rejectedRows.rows as unknown as { reason: string; commandType: string }[]) {
      reasonCounts.set(row.reason, (reasonCounts.get(row.reason) ?? 0) + 1);
      conflictCounts.set(row.commandType, (conflictCounts.get(row.commandType) ?? 0) + 1);
    }
    const toBreakdown = (map: Map<string, number>): SyncHealthBreakdownRow[] =>
      [...map.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

    // -- pull cursor lag per entity --------------------------------------------
    const lagRows = await tx.execute(sql`
      SELECT entity_type AS "entityType",
             count(*)::int AS devices,
             max(extract(epoch from (now() - acknowledged_at)) * 1000)::double precision AS "maxLagMs"
      FROM sync_cursors
      WHERE acknowledged_at IS NOT NULL
      GROUP BY entity_type
      ORDER BY "maxLagMs" DESC
    `);
    const pullLagByEntity = (
      lagRows.rows as unknown as { entityType: string; devices: number; maxLagMs: number }[]
    ).map((row) => ({
      entityType: row.entityType,
      devices: row.devices,
      maxLagMs: Number(row.maxLagMs.toFixed(1)),
    }));

    // -- outbox lag gauge (tenant devices by last_push_at age) ----------------
    const bucketRows = await tx.execute(sql`
      SELECT CASE
               WHEN d.last_push_at IS NULL THEN 'never'
               WHEN now() - d.last_push_at < interval '1 hour' THEN 'lt1h'
               WHEN now() - d.last_push_at < interval '6 hours' THEN 'lt6h'
               WHEN now() - d.last_push_at < interval '24 hours' THEN 'lt24h'
               WHEN now() - d.last_push_at < interval '7 days' THEN 'lt7d'
               ELSE 'gt7d'
             END AS bucket,
             count(*)::int AS devices
      FROM devices d
      JOIN memberships m ON m.user_id = d.user_id
      WHERE m.status = 'ACTIVE'
      GROUP BY bucket
    `);
    const bucketCounts = new Map<string, number>(
      (bucketRows.rows as unknown as { bucket: string; devices: number }[]).map(
        (row) => [row.bucket, row.devices],
      ),
    );
    const outboxLagGauge: SyncHealthOutboxBucket[] = OUTBOX_BUCKETS.map((bucket) => ({
      bucket,
      devices: bucketCounts.get(bucket) ?? 0,
    }));

    // -- revoked-device pending ops (the reconciliation queue population) -----
    const revokedRows = await tx.execute(sql`
      SELECT count(*)::int AS devices,
             coalesce(sum(pending), 0)::int AS "pendingCommands",
             coalesce(sum(drafts), 0)::int AS "ownedDrafts"
      FROM (
        SELECT d.id,
               (SELECT count(*) FROM inbox_commands ic WHERE ic.device_id = d.id) AS pending,
               (SELECT count(*) FROM sales_invoices si
                  WHERE si.owner_device_id = d.id AND si.status = 'DRAFT') AS drafts
        FROM devices d
        JOIN memberships m ON m.user_id = d.user_id
        WHERE d.revoked_at IS NOT NULL
          AND m.status = 'ACTIVE'
          AND COALESCE((d.trust_flags ->> 'reconciliation_dismissed')::boolean, false) = false
      ) t
    `);
    const revokedPendingOps =
      (revokedRows.rows as unknown as SyncHealthRevokedPendingOps[])[0] ?? {
        devices: 0,
        pendingCommands: 0,
        ownedDrafts: 0,
      };

    // -- tombstones ledger size -------------------------------------------------
    const tombstoneRows = await tx.execute(sql`SELECT count(*)::int AS n FROM tombstones`);
    const tombstones = (tombstoneRows.rows as unknown as { n: number }[])[0]?.n ?? 0;

    // -- alerts (MONITORING §1: Sev-2 critical / Sev-3 warning) -----------------
    const alerts: SyncHealthAlert[] = [];
    for (const row of pullLagByEntity) {
      if (row.maxLagMs !== null && row.maxLagMs > CURSOR_STALL_MS) {
        const days = Number((row.maxLagMs / 86400000).toFixed(1));
        alerts.push({
          severity: "warning",
          code: "SyncCursorStall",
          message: `Entity "${row.entityType}" has not acknowledged a pull cursor for ${days} days (${row.devices} device cursor(s) affected) — the 7-day horizon is exceeded.`,
          details: { entity: row.entityType, days, devices: row.devices },
        });
      }
    }
    if (successRate < FAIL_SPIKE_RATE && pushRow.total >= FAIL_SPIKE_MIN_TOTAL) {
      alerts.push({
        severity: "critical",
        code: "SyncPushFailSpike",
        message: `Push success rate is ${successRate}% over the last ${WINDOW_DAYS} days (${pushRow.total} commands, ${pushRow.rejected} rejected) — below the ${FAIL_SPIKE_RATE}% threshold.`,
        details: { rate: successRate, total: pushRow.total, rejected: pushRow.rejected },
      });
    }

    return {
      tenantId,
      generatedAt: new Date().toISOString(),
      windowDays: WINDOW_DAYS,
      push: {
        total: pushRow.total,
        accepted: pushRow.accepted,
        rejected: pushRow.rejected,
        deferred: pushRow.deferred,
        successRate,
        p95LatencyMs,
      },
      pullLagByEntity,
      conflictsByType: toBreakdown(conflictCounts),
      rejectionsByReason: toBreakdown(reasonCounts),
      outboxLagGauge,
      revokedPendingOps,
      tombstones,
      alerts,
    };
  }
}
