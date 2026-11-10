import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { appClient, ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { SyncHealthService } from "../../modules/sync/application/health-service";
import {
  RETENTION_BATCH,
  runFeedHealth,
  runInboxRetention,
  runTombstoneGc,
  sweepCursorCompact,
  sweepFeedHealth,
  sweepInboxRetentionBatch,
} from "../../modules/sync/application/maintenance-jobs";

/**
 * PHASE-020 T3-a db evidence (MASTER-PLAN §11 + §12; PHASE-020 §2 items
 * 8–11): the four maintenance jobs + the admin health aggregate —
 *
 * 1. inbox retention: deletes only processed_at older than 30 days, the
 *    per-iteration DELETE bound is 5000, the loop drains the set, and the
 *    pass is audited (`sync.inbox_retention_swept`);
 * 2. tombstone GC: respects the gc_after horizon (future rows survive),
 *    audited (`sync.tombstone_gc_swept`);
 * 3. cursor compact: lag = now − acknowledged_at per device/entity; rows
 *    past the 7-day horizon log + insert ONE owner notification per
 *    device/entity/day (dedupe key `sync.cursor.stall:{deviceId}:
 *    {entityType}:{date}`) — a same-day re-run inserts nothing; audited
 *    (`sync.cursor_compact_run`);
 * 4. feed.health: read-only — no change_log/notifications/audit mutations
 *    before vs after (log warn only);
 * 5. the health aggregate (GET /sync/admin/health shape): push stats +
 *    p95, breakdowns by reason and by command type, cursor lag per entity,
 *    the outbox gauge, revoked pending ops, and both derived alerts.
 *
 * Dedicated tenant 27272727 (SAR, verified unused across the repo); the
 * owner carries a tenant `owner` role (the ownerTarget() contract the
 * notification insert rides on). Job functions are called directly — no
 * pg-boss in specs (the handlers' bodies are the run* functions).
 */

const TENANT_JOBS = "27272727-2727-2727-2727-272727272727";
const OWNER = "27272727-0000-4000-8000-000000002701";
const USER2 = "27272727-0000-4000-8000-000000002702";

const healthService = new SyncHealthService();

/** The shared device fixture id (seeded in beforeAll). */
let deviceId = "";

/** The tenant-scoped app client (RLS world) for read assertions. */
async function tenantClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_JOBS]);
  return client;
}

async function countInbox(client: Client, predicate: string): Promise<number> {
  const result = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM inbox_commands WHERE tenant_id = $1 AND ${predicate}`,
    [TENANT_JOBS],
  );
  return result.rows[0]?.n ?? 0;
}

async function auditRows(
  client: Client,
  action: string,
): Promise<{ entityId: string | null; after: Record<string, unknown> | null }[]> {
  const result = await client.query(
    `SELECT entity_id AS "entityId", after FROM audit_events
      WHERE tenant_id = $1 AND action = $2 ORDER BY at`,
    [TENANT_JOBS, action],
  );
  return result.rows.map((row) => ({
    entityId: row.entityId,
    after: row.after === null ? null : (JSON.parse(JSON.stringify(row.after)) as Record<string, unknown>),
  }));
}

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'T2727 Jobs (sync)', 'مستأجر مهام المزامنة', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_JOBS],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'jobs-owner@fixture.test', 'Jobs Owner', 'x', 'ACTIVE'),
       ($2, 'jobs-second@fixture.test', 'Jobs Second', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [OWNER, USER2],
  );
  // A tenant-scoped `owner` role cloned from the system template — the
  // ownerTarget() join (roles.key = 'owner') resolves the notification
  // target from this membership.
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'owner', 'Jobs Owner', 'مالك المهام', false)
     ON CONFLICT (id) DO NOTHING`,
    [roleId, TENANT_JOBS],
  );
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner' LIMIT 1`,
  );
  if (template.rows[0] !== undefined) {
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp
        WHERE rp.role_id = $3
       ON CONFLICT (role_id, permission_id) DO NOTHING`,
      [roleId, TENANT_JOBS, template.rows[0].id],
    );
  }
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id) VALUES
       ($1, $2, $3, $4), ($5, $2, $6, $4)
     ON CONFLICT (id) DO NOTHING`,
    [generateUuidV7(), TENANT_JOBS, OWNER, roleId, generateUuidV7(), USER2],
  );
  // The shared device fixture: pulled within the last 24h (the feed-health
  // precondition), last pushed 30d ago (the outbox gt7d bucket).
  deviceId = generateUuidV7();
  await su.query(
    `INSERT INTO devices (id, user_id, platform, name, device_key_hash, device_class,
                           last_pull_at, last_push_at)
     VALUES ($1, $2, 'ANDROID', 'Van tablet 27', $3, 'android-field', now(), now() - interval '30 days')`,
    [deviceId, OWNER, `sha:${deviceId}`],
  );
  await su.end();
});

afterAll(async () => {
  await closeDb();
});

describe("sync maintenance jobs (MASTER-PLAN §11)", () => {
  it("the shared device fixture is registered (id captured for the suites below)", async () => {
    const client = await tenantClient();
    const rows = await client.query<{ name: string | null }>(
      `SELECT name FROM devices WHERE id = $1`,
      [deviceId],
    );
    await client.end();
    expect(rows.rows[0]?.name).toBe("Van tablet 27");
  });

  it("inbox retention: only processed_at older than 30d, bounded at 5000/iteration, loop drains + audit", async () => {
    const su = await superuserClient();
    // 5200 rows past the horizon + 2 fresh rows (1h old) — the fresh pair
    // must survive every sweep below.
    await su.query(
      `INSERT INTO inbox_commands (id, tenant_id, device_id, command_id, idempotency_key,
                                   entity_type, intent, status, result, processed_at, created_at)
       SELECT gen_random_uuid(), $1, $2, 'jobs-old-' || g, 'jobs-old-idem-' || g,
              'items', 'create', 'ACCEPTED',
              '{"status":"ACCEPTED","reason":null,"message":"ok"}'::jsonb,
              now() - interval '40 days', now() - interval '40 days'
         FROM generate_series(1, 5200) g`,
      [TENANT_JOBS, deviceId],
    );
    await su.query(
      `INSERT INTO inbox_commands (id, tenant_id, device_id, command_id, idempotency_key,
                                   entity_type, intent, status, result, processed_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, 'jobs-fresh-1', 'jobs-fresh-idem-1',
               'items', 'create', 'ACCEPTED',
               '{"status":"ACCEPTED","reason":null,"message":"ok"}'::jsonb,
               now() - interval '1 hour', now() - interval '1 hour' - interval '3 seconds'),
              (gen_random_uuid(), $1, $2, 'jobs-fresh-2', 'jobs-fresh-idem-2',
               'items', 'create', 'ACCEPTED',
               '{"status":"ACCEPTED","reason":null,"message":"ok"}'::jsonb,
               now() - interval '1 hour', now() - interval '1 hour' - interval '3 seconds')`,
      [TENANT_JOBS, deviceId],
    );
    await su.end();

    // The full job pass (loops internally): the old set is drained, the
    // fresh pair survives, the pass is audited with the loop total.
    const run = await runInboxRetention();
    expect(run.tenants).toBeGreaterThanOrEqual(1);
    expect(run.deleted).toBeGreaterThanOrEqual(5200);

    const client = await tenantClient();
    expect(await countInbox(client, "processed_at < now() - interval '30 days'")).toBe(0);
    expect(await countInbox(client, "processed_at > now() - interval '30 days'")).toBe(2);
    const swept = await auditRows(client, "sync.inbox_retention_swept");
    expect(swept).toHaveLength(1);
    expect(swept[0]!.after).toMatchObject({ deleted: 5200 });
    expect(swept[0]!.entityId).not.toBeNull();
    await client.end();

    // The per-iteration bound: 5600 new old rows, ONE batch call deletes
    // exactly RETENTION_BATCH and leaves the rest for the next iteration.
    const su2 = await superuserClient();
    await su2.query(
      `INSERT INTO inbox_commands (id, tenant_id, device_id, command_id, idempotency_key,
                                   entity_type, intent, status, result, processed_at, created_at)
       SELECT gen_random_uuid(), $1, $2, 'jobs-old2-' || g, 'jobs-old2-idem-' || g,
              'items', 'create', 'ACCEPTED',
              '{"status":"ACCEPTED","reason":null,"message":"ok"}'::jsonb,
              now() - interval '40 days', now() - interval '40 days'
         FROM generate_series(1, 5600) g`,
      [TENANT_JOBS, deviceId],
    );
    await su2.end();

    const bounded = await withTenant(TENANT_JOBS, () => sweepInboxRetentionBatch());
    expect(bounded.deleted).toBe(RETENTION_BATCH);
    const client2 = await tenantClient();
    expect(await countInbox(client2, "processed_at < now() - interval '30 days'")).toBe(600);
    await client2.end();

    // A second full pass drains the remainder (loop exit) + a second audit
    // row carries only what THAT pass deleted.
    const drain = await runInboxRetention();
    expect(drain.deleted).toBeGreaterThanOrEqual(600);
    const client3 = await tenantClient();
    expect(await countInbox(client3, "processed_at < now() - interval '30 days'")).toBe(0);
    expect(await countInbox(client3, "processed_at > now() - interval '30 days'")).toBe(2);
    const swept2 = await auditRows(client3, "sync.inbox_retention_swept");
    expect(swept2).toHaveLength(2);
    expect(swept2[1]!.after).toMatchObject({ deleted: 600 });
    await client3.end();
  });

  it("tombstone GC: respects the gc_after horizon + audit", async () => {
    const su = await superuserClient();
    await su.query(
      `INSERT INTO tombstones (id, tenant_id, entity_type, entity_id, deleted_at, gc_after) VALUES
         (gen_random_uuid(), $1, 'items',    'jobs-tomb-1', now() - interval '100 days', now() - interval '10 days'),
         (gen_random_uuid(), $1, 'items',    'jobs-tomb-2', now() - interval '100 days', now() - interval '5 days'),
         (gen_random_uuid(), $1, 'partners', 'jobs-tomb-3', now() - interval '10 days', now() + interval '80 days'),
         (gen_random_uuid(), $1, 'partners', 'jobs-tomb-4', now() - interval '5 days',  now() + interval '85 days')`,
      [TENANT_JOBS],
    );
    await su.end();

    const run = await runTombstoneGc();
    expect(run.deleted).toBeGreaterThanOrEqual(2);

    const client = await tenantClient();
    const remaining = await client.query<{ entity_id: string }>(
      `SELECT entity_id FROM tombstones WHERE tenant_id = $1 ORDER BY entity_id`,
      [TENANT_JOBS],
    );
    expect(remaining.rows.map((row) => row.entity_id)).toEqual(["jobs-tomb-3", "jobs-tomb-4"]);
    const swept = await auditRows(client, "sync.tombstone_gc_swept");
    expect(swept).toHaveLength(1);
    expect(swept[0]!.after).toMatchObject({ deleted: 2 });
    await client.end();
  });

  it("cursor compact: lag computed, owner notification written + deduped by key, audited", async () => {
    const su = await superuserClient();
    // items: 10d-old ack (lagged) · partners: 1h-old ack (fresh) ·
    // barcodes: never acknowledged (excluded from the lag population).
    await su.query(
      `INSERT INTO sync_cursors (id, tenant_id, device_id, entity_type, last_seq, acknowledged_at) VALUES
         (gen_random_uuid(), $1, $2, 'items',    120, now() - interval '10 days'),
         (gen_random_uuid(), $1, $2, 'partners', 80,  now() - interval '1 hour'),
         (gen_random_uuid(), $1, $2, 'barcodes', 12,  NULL)`,
      [TENANT_JOBS, deviceId],
    );
    await su.end();

    const firstPass = await withTenant(TENANT_JOBS, () => sweepCursorCompact());
    expect(firstPass).toMatchObject({
      devices: 1,
      entities: 3,
      laggedRows: 1,
      laggedDevices: 1,
      notifications: 1,
    });

    const date = new Date().toISOString().slice(0, 10);
    const dedupeKey = `sync.cursor.stall:${deviceId}:items:${date}`;
    const client = await tenantClient();
    const notification = await client.query(
      `SELECT category, severity, user_id AS "userId", action_url AS "actionUrl",
              title::text AS "titleText", body::text AS "bodyText"
         FROM notifications WHERE tenant_id = $1 AND dedupe_key = $2`,
      [TENANT_JOBS, dedupeKey],
    );
    expect(notification.rows).toHaveLength(1);
    const row = notification.rows[0]!;
    expect(row.category).toBe("reconciliation");
    expect(row.severity).toBe("warning");
    expect(row.userId).toBe(OWNER);
    expect(row.actionUrl).toBe("/platform/sync-health");
    expect(JSON.parse(row.titleText).ar).toBe("توقف مؤشر مزامنة جهاز");
    expect(JSON.parse(row.bodyText).ar).toContain("Van tablet 27");
    expect(JSON.parse(row.bodyText).ar).toContain("items");
    expect(JSON.parse(row.bodyText).en).toContain("Van tablet 27");
    // Only ONE notification exists for the tenant: the fresh partners
    // cursor and the never-acked barcodes cursor produced none.
    const allStall = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
        WHERE tenant_id = $1 AND dedupe_key LIKE 'sync.cursor.stall:%'`,
      [TENANT_JOBS],
    );
    expect(allStall.rows[0]?.n).toBe(1);

    const compactRuns = await auditRows(client, "sync.cursor_compact_run");
    expect(compactRuns).toHaveLength(1);
    expect(compactRuns[0]!.entityId).toBe(deviceId);
    expect(compactRuns[0]!.after).toMatchObject({
      devices: 1,
      entities: 3,
      laggedRows: 1,
      laggedDevices: 1,
      notifications: 1,
    });
    await client.end();

    // Same-day re-run: the dedupe key absorbs it — nothing new inserted.
    const secondPass = await withTenant(TENANT_JOBS, () => sweepCursorCompact());
    expect(secondPass.notifications).toBe(0);
    const client2 = await tenantClient();
    const allStall2 = await client2.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications
        WHERE tenant_id = $1 AND dedupe_key LIKE 'sync.cursor.stall:%'`,
      [TENANT_JOBS],
    );
    expect(allStall2.rows[0]?.n).toBe(1);
    await client2.end();
  });

  it("feed.health: read-only — change_log/notifications/audit untouched, stall detected", async () => {
    const su = await superuserClient();
    await su.query(
      `INSERT INTO change_log (tenant_id, entity_type, entity_id, op, payload, changed_at) VALUES
         ($1, 'items',    'jobs-feed-1', 'UPSERT', '{}'::jsonb, now() - interval '20 minutes'),
         ($1, 'partners', 'jobs-feed-2', 'UPSERT', '{}'::jsonb, now())`,
      [TENANT_JOBS],
    );
    await su.end();

    const client = await tenantClient();
    const before = await client.query<{ n: number; head: string | null; notes: number; audits: number }>(
      `SELECT
         (SELECT count(*)::text FROM change_log WHERE tenant_id = $1)::int AS n,
         (SELECT max(changed_at)::text FROM change_log WHERE tenant_id = $1) AS head,
         (SELECT count(*)::int FROM notifications WHERE tenant_id = $1) AS notes,
         (SELECT count(*)::int FROM audit_events WHERE tenant_id = $1) AS audits`,
      [TENANT_JOBS],
    );
    const snapshot = before.rows[0]!;
    expect(snapshot.n).toBe(2);
    expect(snapshot.notes).toBe(1); // the cursor-stall row from the suite above
    await client.end();

    // The device fixture pulled within the last 24h (beforeAll), so the
    // 20-minute-old items head is a stall; the fresh partners head is not.
    const job = await runFeedHealth();
    expect(job.tenants).toBeGreaterThanOrEqual(1);
    expect(job.stalls).toBeGreaterThanOrEqual(1);
    const perTenant = await withTenant(TENANT_JOBS, () => sweepFeedHealth());
    expect(perTenant.stalls).toHaveLength(1);
    expect(perTenant.stalls[0]!.entityType).toBe("items");
    expect(perTenant.stalls[0]!.lagMs).toBeGreaterThan(10 * 60 * 1000);

    const client2 = await tenantClient();
    const after = await client2.query<{ n: number; head: string | null; notes: number; audits: number }>(
      `SELECT
         (SELECT count(*)::text FROM change_log WHERE tenant_id = $1)::int AS n,
         (SELECT max(changed_at)::text FROM change_log WHERE tenant_id = $1) AS head,
         (SELECT count(*)::int FROM notifications WHERE tenant_id = $1) AS notes,
         (SELECT count(*)::int FROM audit_events WHERE tenant_id = $1) AS audits`,
      [TENANT_JOBS],
    );
    const afterSnapshot = after.rows[0]!;
    expect(afterSnapshot.n).toBe(snapshot.n);
    expect(afterSnapshot.head).toBe(snapshot.head);
    expect(afterSnapshot.notes).toBe(snapshot.notes);
    expect(afterSnapshot.audits).toBe(snapshot.audits);
    await client2.end();
  });

  it("health aggregate: push stats + p95, breakdowns, cursor lag, outbox gauge, revoked pending ops, alerts", async () => {
    const su = await superuserClient();
    // 35 rejected (10 STALE_VERSION on sales_invoice:create_draft + 25
    // VALIDATION_ERROR on pos_sale:create) + 5 accepted — all with a
    // deterministic 3s created_at→processed_at latency. The 2 fresh rows
    // from the retention suite ride along (same 3s latency).
    await su.query(
      `INSERT INTO inbox_commands (id, tenant_id, device_id, command_id, idempotency_key,
                                   entity_type, intent, status, result, processed_at, created_at)
       SELECT gen_random_uuid(), $1, $2, 'jobs-health-' || g, 'jobs-health-idem-' || g,
              CASE WHEN g <= 10 THEN 'sales_invoice' ELSE 'pos_sale' END,
              CASE WHEN g <= 10 THEN 'create_draft' ELSE 'create' END,
              CASE WHEN g <= 35 THEN 'REJECTED' ELSE 'ACCEPTED' END,
              CASE
                WHEN g <= 10 THEN '{"status":"REJECTED","reason":"STALE_VERSION","message":"stale"}'::jsonb
                WHEN g <= 35 THEN '{"status":"REJECTED","reason":"VALIDATION_ERROR","message":"invalid"}'::jsonb
                ELSE '{"status":"ACCEPTED","reason":null,"message":"ok"}'::jsonb
              END,
              now() - interval '3 seconds', now() - interval '6 seconds'
         FROM generate_series(1, 40) g`,
      [TENANT_JOBS, deviceId],
    );
    // A revoked device with one un-acked inbox row (40d old — outside the
    // 7d push window, inside the pending-ops count by design).
    const revokedDeviceId = generateUuidV7();
    await su.query(
      `INSERT INTO devices (id, user_id, platform, name, device_key_hash, device_class, revoked_at)
       VALUES ($1, $2, 'ANDROID', 'Lost phone 27', $3, 'android-personal', now())`,
      [revokedDeviceId, USER2, `sha:${revokedDeviceId}`],
    );
    await su.query(
      `INSERT INTO inbox_commands (id, tenant_id, device_id, command_id, idempotency_key,
                                   entity_type, intent, status, result, processed_at, created_at)
       VALUES (gen_random_uuid(), $1, $2, 'jobs-revoked-1', 'jobs-revoked-idem-1',
               'items', 'create', 'ACCEPTED',
               '{"status":"ACCEPTED","reason":null,"message":"ok"}'::jsonb,
               now() - interval '40 days', now() - interval '40 days')`,
      [TENANT_JOBS, revokedDeviceId],
    );
    await su.end();

    const report = await withTenant(TENANT_JOBS, () => healthService.health());

    expect(report.tenantId).toBe(TENANT_JOBS);
    expect(report.windowDays).toBe(7);
    // Push plane: 2 fresh + 40 seeded = 42 (7 accepted / 35 rejected).
    expect(report.push).toMatchObject({ total: 42, accepted: 7, rejected: 35, deferred: 0 });
    expect(report.push.successRate).toBe(16.7);
    expect(report.push.p95LatencyMs).toBe(3000);

    // Breakdowns: by typed reason + by command type.
    const reasons = new Map(report.rejectionsByReason.map((row) => [row.key, row.count]));
    expect(reasons.get("STALE_VERSION")).toBe(10);
    expect(reasons.get("VALIDATION_ERROR")).toBe(25);
    const conflicts = new Map(report.conflictsByType.map((row) => [row.key, row.count]));
    expect(conflicts.get("sales_invoice:create_draft")).toBe(10);
    expect(conflicts.get("pos_sale:create")).toBe(25);

    // Cursor lag per entity: items (10d-old ack) stalls; partners (1h) does not.
    const itemsLag = report.pullLagByEntity.find((row) => row.entityType === "items");
    const partnersLag = report.pullLagByEntity.find((row) => row.entityType === "partners");
    expect(itemsLag).toBeDefined();
    expect(itemsLag!.devices).toBe(1);
    expect(itemsLag!.maxLagMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
    expect(partnersLag).toBeDefined();
    expect(partnersLag!.maxLagMs).toBeLessThan(7 * 24 * 60 * 60 * 1000);

    // Outbox gauge: the fixture device last pushed 30d ago (gt7d); the
    // revoked device never pushed (never).
    const gauge = new Map(report.outboxLagGauge.map((row) => [row.bucket, row.devices]));
    expect(gauge.get("gt7d")).toBe(1);
    expect(gauge.get("never")).toBe(1);

    // Revoked pending ops: one revoked device, one pending command, no drafts.
    expect(report.revokedPendingOps).toMatchObject({
      devices: 1,
      pendingCommands: 1,
      ownedDrafts: 0,
    });
    expect(report.tombstones).toBe(2);

    // Alerts: both derived rows fire (Sev-2 critical + Sev-3 warning).
    const codes = new Map(report.alerts.map((alert) => [alert.code, alert]));
    expect(codes.get("SyncCursorStall")?.severity).toBe("warning");
    expect(codes.get("SyncPushFailSpike")?.severity).toBe("critical");
    expect(codes.get("SyncPushFailSpike")?.message).toContain("16.7%");

    // The report is served from the 60s in-memory cache on a second call.
    const cached = await withTenant(TENANT_JOBS, () => healthService.health());
    expect(cached.generatedAt).toBe(report.generatedAt);
  });
});
