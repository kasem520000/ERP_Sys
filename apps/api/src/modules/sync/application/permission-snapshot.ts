import { sql } from "drizzle-orm";

import { PERMISSIONS_ENTITY_TYPE } from "@erp/contracts";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { PosSyncEntityInvalidError } from "../../pos/domain/pos-errors";
import { decodeCursor, encodeCursor } from "./cursor-tokens";

/**
 * PHASE-020 · the `permissions` snapshot feed (T12; SYNC_PROTOCOL §2 +
 * MASTER-PLAN §10): the synthetic per-USER entity every device class
 * pulls every cycle. The catch-up writer (syncPermissionSnapshot) projects
 * the device user's CURRENT effective permission keys in the device
 * tenant into `change_log` (entity_type 'permissions', entity_id = the
 * user id) — a new row only when the key-set changed (or the last
 * snapshot is close to going stale, keeping the client-side D-04 watermark
 * `now − snapshotAt > 7d` from tripping on an idle tenant). The pull
 * serves those rows through the standard cursor envelope.
 *
 * The effective-key query is the identity module's canonical one
 * (`erp.user_effective_permissions`, migration 0003 — memberships ⋈
 * role_permissions, ACTIVE only); re-implementing the join would be a
 * second source of truth for the same fact.
 *
 * Chunking (MASTER-PLAN §10 "≤ 500 keys per change row"): satisfied by
 * reality — the permission matrix tops out at 243 keys (W1
 * check:permissions-drift parity), so ONE row carries the whole set and
 * the `${userId}:${page}` pagination is NOT implemented in 020 (noted as
 * a decision; trivial to add if the matrix ever crosses 500).
 */

/** How fresh a projection must stay: refreshed when older than 6 days —
 * comfortably inside the 7-day read-only watermark (D-04) with bounded
 * growth (≤ ~1 row / 6 days / user when idle). */
const SNAPSHOT_REFRESH_MS = 6 * 24 * 60 * 60 * 1000;

/** The watermark the client enforces (rides the payload; D-04). */
const SNAPSHOT_WATERMARK_DAYS = 7;

/** The change row served to the pull envelope (same shape as the generic
 * pull items; the snapshot is synthetic — no server row version, DELETE
 * never occurs — so `version` is null). */
export interface PermissionSnapshotChange {
  id: string;
  seq: number;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown> | null;
  changedAt: string;
  version: number | null;
}

function sameKeySet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * The catch-up writer for the permissions entity: project the user's
 * CURRENT effective keys when they changed (or the last snapshot is
 * stale). Returns the new snapshotAt, or null when nothing was appended.
 */
export async function syncPermissionSnapshot(device: { userId: string }): Promise<string | null> {
  const tx = requireTenantContext().tx!;
  const keyRows = await tx.execute(sql`
    SELECT permission_key FROM erp.user_effective_permissions(${device.userId}, erp.current_tenant_id())
    ORDER BY permission_key
  `);
  const permissions = (keyRows.rows as unknown as { permission_key: string }[]).map(
    (row) => row.permission_key,
  );

  const lastRows = await tx.execute(sql`
    SELECT payload FROM change_log
    WHERE entity_type = ${PERMISSIONS_ENTITY_TYPE} AND entity_id = ${device.userId}
    ORDER BY seq DESC LIMIT 1
  `);
  const lastPayload = (
    lastRows.rows as unknown as {
      payload: { userId?: string; permissions?: string[]; snapshotAt?: string } | null;
    }[]
  )[0];
  const last = lastPayload?.payload ?? undefined;
  const lastPermissions =
    last?.permissions === undefined ? null : [...last.permissions].sort();
  const changed =
    last === undefined ||
    lastPermissions === null ||
    !sameKeySet(lastPermissions, permissions);
  const lastSnapshotAt =
    last?.snapshotAt !== undefined ? Date.parse(String(last.snapshotAt)) : Number.NaN;
  const stale =
    !Number.isNaN(lastSnapshotAt) && Date.now() - lastSnapshotAt > SNAPSHOT_REFRESH_MS;
  if (!changed && !stale) {
    return null;
  }

  const snapshotAt = new Date().toISOString();
  await tx.execute(sql`
    INSERT INTO change_log (tenant_id, entity_type, entity_id, op, payload, changed_at)
    VALUES (erp.current_tenant_id(), ${PERMISSIONS_ENTITY_TYPE}, ${device.userId}, 'UPSERT',
            ${JSON.stringify({
              userId: device.userId,
              permissions,
              snapshotAt,
              watermarkDays: SNAPSHOT_WATERMARK_DAYS,
            })}::jsonb, ${snapshotAt}::timestamptz)
  `);
  return snapshotAt;
}

/**
 * Serve the user's permissions snapshot feed through the standard cursor
 * mechanics (called by the pull service for entity 'permissions'):
 * guarantees the bootstrap row exists (first pull forces a projection),
 * then serves change_log rows for entity_id = userId strictly by seq.
 * A cursor beyond the feed head returns the C-12 bounded-restart directive
 * (`resync: true` + a fresh 0-cursor) exactly like the generic path.
 */
export async function pullPermissionSnapshot(input: {
  userId: string;
  cursor: string | null;
  limit: number;
}): Promise<{
  changes: PermissionSnapshotChange[];
  hasMore: boolean;
  nextCursorToken: string;
  resync?: boolean;
}> {
  const tx = requireTenantContext().tx!;
  let afterSeq = 0;
  if (input.cursor !== null) {
    const decoded = decodeCursor(input.cursor);
    if (decoded === undefined) {
      // The 016 message contract for rejected cursors (restart from null).
      throw new PosSyncEntityInvalidError(
        `${PERMISSIONS_ENTITY_TYPE} (cursor rejected — restart from null)`,
      );
    }
    if (decoded.entityType !== PERMISSIONS_ENTITY_TYPE) {
      throw new PosSyncEntityInvalidError(
        `${PERMISSIONS_ENTITY_TYPE} (cursor belongs to ${decoded.entityType})`,
      );
    }
    afterSeq = decoded.seq;
  }

  // Bootstrap: a user never pulled before gets the initial projection.
  await syncPermissionSnapshot({ userId: input.userId });

  // C-12: cursor beyond the user's feed head → bounded restart from 0.
  const headRows = await tx.execute(sql`
    SELECT max(seq) AS "max" FROM change_log
    WHERE entity_type = ${PERMISSIONS_ENTITY_TYPE} AND entity_id = ${input.userId}
  `);
  const head = Number((headRows.rows as unknown as { max: string | number | null }[])[0]?.max ?? 0);
  const issuedAt = new Date().toISOString();
  if (afterSeq > head) {
    return {
      changes: [],
      hasMore: false,
      nextCursorToken: encodeCursor({ entityType: PERMISSIONS_ENTITY_TYPE, seq: 0, issuedAt }),
      resync: true,
    };
  }

  const rows = await tx.execute(sql`
    SELECT seq, entity_id AS "entityId", op, payload, changed_at AS "changedAt",
           payload->>'version' AS "version"
    FROM change_log
    WHERE entity_type = ${PERMISSIONS_ENTITY_TYPE} AND entity_id = ${input.userId}
      AND seq > ${afterSeq}
    ORDER BY seq ASC
    LIMIT ${input.limit + 1}
  `);
  const all = rows.rows as unknown as {
    seq: number | string;
    entityId: string;
    op: "UPSERT" | "DELETE";
    payload: Record<string, unknown> | null;
    changedAt: string;
    version: string | null;
  }[];
  const hasMore = all.length > input.limit;
  const batch = hasMore ? all.slice(0, input.limit) : all;
  const lastSeq = batch.length > 0 ? Number(batch[batch.length - 1]!.seq) : afterSeq;
  const changes: PermissionSnapshotChange[] = batch.map((row) => ({
    id: row.entityId,
    seq: Number(row.seq),
    op: row.op,
    // Snapshot rows are UPSERTs; the mapping keeps the generic DELETE
    // semantics (null payload/version) for shape parity.
    payload: row.op === "DELETE" ? null : row.payload,
    changedAt: row.changedAt,
    version: row.op === "DELETE" || row.version === null ? null : Number(row.version),
  }));
  return {
    changes,
    hasMore,
    nextCursorToken: encodeCursor({ entityType: PERMISSIONS_ENTITY_TYPE, seq: lastSeq, issuedAt }),
  };
}
