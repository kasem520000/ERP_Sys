import { sql, type SQL } from "drizzle-orm";

import { PERMISSIONS_ENTITY_TYPE } from "@erp/contracts";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { PosDeviceNotFoundError, PosSyncEntityInvalidError } from "../../pos/domain/pos-errors";
import { isFeedEntity, syncFeed } from "./change-log-writer";
import { decodeCursor, encodeCursor, SYNC_CONTRACT_VERSION } from "./cursor-tokens";
import { deviceClassOf, isEntityPullableByDevice, loadDevice } from "./feed-groups";
import { pullPermissionSnapshot } from "./permission-snapshot";
import {
  STATEMENTS_ENTITY_TYPE,
  statementPartnerIds,
  pullStatementsFeed,
} from "./statement-feed";

/**
 * PHASE-020 · the v2 pull service (T5; SYNC_PROTOCOL §2 + MASTER-PLAN §5):
 * per-entity-type cursors over the device-class feed groups. The catch-up
 * writer feeds the change_log first (same transaction — a pull never
 * observes a half-fed change_log), then the batch is served strictly in
 * seq order with the v2 page budgets: ≤ min(limit, 1000) items AND ≤ 2 MB
 * serialized (whichever binds first; a single oversized item still rides
 * alone). The 016 wire shape (`changes[]` + `cursor` + `hasMore`) is kept
 * verbatim; the v2 envelope adds `nextCursor`/`serverTime`/
 * `contractVersion` and the C-12 `resync` directive (a cursor beyond the
 * feed head → bounded restart from 0). `deviceId` is OPTIONAL — the 016
 * session path (no device id) resolves to the fail-safe pos feed group.
 */

/** A pull on a revoked device is rejected before anything is served
 * (SYNC_PROTOCOL §1.5 — zero effects on revocation); the entity pullable
 * gate is 404-equivalent with no existence leak. Both classes live in
 * domain/sync-errors.ts (the single spelling — request-level errors map
 * in the ERROR_MODEL filter). */
export {
  SyncDeviceRevokedError,
  SyncEntityNotPulledError,
} from "../domain/sync-errors";
import { SyncDeviceRevokedError, SyncEntityNotPulledError } from "../domain/sync-errors";

/** The serialized-page budget (SYNC_PROTOCOL §2.5 delta sizes). */
export const PULL_PAGE_BYTE_CAP = 2_000_000;

/**
 * The byte-cap check (pure, exported for unit testing): does adding an
 * item of `nextItemBytes` to a page already holding `accumulatedBytes`
 * stay within the 2 MB budget? The page loop never strands a page empty —
 * the first item always rides (§2.5: a large row may occupy a full page
 * alone).
 */
export function fitsByteCap(accumulatedBytes: number, nextItemBytes: number): boolean {
  return accumulatedBytes + nextItemBytes <= PULL_PAGE_BYTE_CAP;
}

/** One served change (v2: the server row `version`, null on DELETE). */
export interface PullChangeV2 {
  id: string;
  seq: number;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown> | null;
  changedAt: string;
  version: number | null;
}

/** The v2 pull envelope: the 016 shape + the additive v2 fields. */
export interface PullEnvelopeV2 {
  entityType: string;
  /** The current position token (the LAST EMITTED seq — 016 semantics). */
  cursor: string;
  hasMore: boolean;
  changes: readonly PullChangeV2[];
  /** v2 alias of `cursor` (same token value). */
  nextCursor?: string;
  serverTime?: string;
  contractVersion?: string;
  /** C-12 directive: restart the feed from seq 0 (bounded restart). */
  resync?: boolean;
}

/** 016 compat alias (the 016 name for the v2 envelope). */
export type PullEnvelope = PullEnvelopeV2;

export async function pull(input: {
  entityType: string;
  cursor: string | null;
  limit?: number;
  deviceId?: string;
}): Promise<PullEnvelopeV2> {
  const entityType = input.entityType;
  const limit = Math.min(Math.max(input.limit ?? 500, 1), 1000);
  const serverTime = new Date().toISOString();

  // (1) Resolve the device (OPTIONAL — the 016 session path passes none):
  // revoked → typed rejection before anything is served (§1.5).
  let deviceClass: string | null = null;
  let userId: string | null = null;
  let linkedPartnerId: string | null = null;
  if (input.deviceId !== undefined) {
    const device = await loadDevice(input.deviceId);
    if (device === undefined) {
      throw new PosDeviceNotFoundError(input.deviceId);
    }
    if (device.revokedAt !== null) {
      throw new SyncDeviceRevokedError(input.deviceId);
    }
    deviceClass = deviceClassOf(device);
    userId = device.userId;
    linkedPartnerId = device.linkedPartnerId;
  }

  // (2) The pull-scope gate: entity in the device class's feed group (or
  // the permissions snapshot) — else SYNC_ENTITY_NOT_PULLED, no existence
  // leak across classes (MASTER-PLAN §5.1).
  if (!isEntityPullableByDevice(entityType, deviceClass)) {
    throw new SyncEntityNotPulledError(entityType, deviceClass ?? "pos-terminal (default)");
  }

  // (3) The permissions snapshot entity: the per-user synthetic feed.
  if (entityType === PERMISSIONS_ENTITY_TYPE) {
    if (userId === null) {
      // The snapshot is per device USER — the 016 session path (no device)
      // has no user binding on this surface.
      throw new PosSyncEntityInvalidError(
        `${PERMISSIONS_ENTITY_TYPE} (pull requires a device — pass deviceId)`,
      );
    }
    const snapshot = await pullPermissionSnapshot({ userId, cursor: input.cursor, limit });
    const envelope: PullEnvelopeV2 = {
      entityType,
      cursor: snapshot.nextCursorToken,
      nextCursor: snapshot.nextCursorToken,
      hasMore: snapshot.hasMore,
      changes: snapshot.changes,
      serverTime,
      contractVersion: SYNC_CONTRACT_VERSION,
    };
    if (snapshot.resync === true) {
      envelope.resync = true;
    }
    return envelope;
  }

  // (3b) PHASE-022 · DR-P22-05 — the statements feed: the per-partner
  // synthetic feed (computed at pull time, content-diff catch-up). Field
  // serves its route customers; personal serves the linked partner ONLY
  // (LOCAL_DATABASE §1.1 rule 2 — the scope is server-side, whatever
  // cursor is presented). The group gate above has already passed, so a
  // device is present here.
  if (entityType === STATEMENTS_ENTITY_TYPE) {
    const partnerIds = await statementPartnerIds({
      deviceClass: deviceClass ?? "pos-terminal",
      linkedPartnerId,
    });
    const page = await pullStatementsFeed({
      partnerIds,
      cursor: input.cursor,
      limit,
    });
    const statementsEnvelope: PullEnvelopeV2 = {
      entityType,
      cursor: page.nextCursorToken,
      nextCursor: page.nextCursorToken,
      hasMore: page.hasMore,
      changes: page.changes,
      serverTime,
      contractVersion: SYNC_CONTRACT_VERSION,
    };
    if (page.resync === true) {
      statementsEnvelope.resync = true;
    }
    return statementsEnvelope;
  }

  // (4) Catch the feed up to the sources (same transaction — a pull never
  // observes a half-fed change_log). The pullable gate above guarantees a
  // registered feed entity; the guard is defensive only.
  if (!isFeedEntity(entityType)) {
    throw new SyncEntityNotPulledError(entityType, deviceClass ?? "pos-terminal (default)");
  }
  await syncFeed(entityType);

  const tx = requireTenantContext().tx!;

  // (5) Cursor decode; invalid → the 016 message contract (restart from
  // null) — a client holding a stale-format token re-bootstraps.
  const decoded = input.cursor === null ? undefined : decodeCursor(input.cursor);
  if (decoded === undefined) {
    if (input.cursor !== null && input.cursor !== "") {
      throw new PosSyncEntityInvalidError(
        `${entityType} (cursor rejected — restart from null)`,
      );
    }
  } else if (decoded.entityType !== entityType) {
    throw new PosSyncEntityInvalidError(
      `${entityType} (cursor belongs to ${decoded.entityType})`,
    );
  }
  const afterSeq: number = decoded === undefined ? 0 : decoded.seq;

  // (6) C-12 cursor regression: a token seq beyond the tenant feed head
  // (restore-from-backup / cross-environment cursor) → the resync
  // directive — a fresh 0-cursor, zero changes, ledger untouched.
  const headRows = await tx.execute(sql`
    SELECT max(seq) AS "max" FROM change_log WHERE entity_type = ${entityType}
  `);
  const head = Number(
    (headRows.rows as unknown as { max: string | number | null }[])[0]?.max ?? 0,
  );
  if (afterSeq > head) {
    const fresh = encodeCursor({ entityType, seq: 0, issuedAt: serverTime });
    return {
      entityType,
      cursor: fresh,
      nextCursor: fresh,
      hasMore: false,
      changes: [],
      serverTime,
      contractVersion: SYNC_CONTRACT_VERSION,
      resync: true,
    };
  }

  // (7) Serve the batch strictly in seq order: count cap (limit+1 fetch
  // detects hasMore) AND the 2 MB byte cap (first item always rides).
  // PHASE-022 · DR-P22-05: android-personal devices serve ONLY their
  // partner/user scope — the filter rides the same query (LOCAL_DATABASE
  // §1.1 rule 2, server-side; a tampered device gets nothing outside its
  // scope whatever cursor it presents).
  const scope = personalServeScope(entityType, deviceClass, {
    linkedPartnerId,
    userId,
  });
  const rows = await tx.execute(sql`
    SELECT seq, entity_id AS "entityId", op, payload, changed_at AS "changedAt",
           payload->>'version' AS "version"
    FROM change_log
    WHERE entity_type = ${entityType} AND seq > ${afterSeq} ${scope ?? sql``}
    ORDER BY seq ASC
    LIMIT ${limit + 1}
  `);
  const all = rows.rows as unknown as {
    seq: number | string;
    entityId: string;
    op: "UPSERT" | "DELETE";
    payload: Record<string, unknown> | null;
    changedAt: string;
    version: string | null;
  }[];
  const countCapped = all.length > limit;
  const candidates = countCapped ? all.slice(0, limit) : all;

  const changes: PullChangeV2[] = [];
  let bytes = 0;
  let byteCapped = false;
  for (const row of candidates) {
    const change: PullChangeV2 = {
      id: row.entityId,
      seq: Number(row.seq),
      op: row.op,
      // Tombstones flow as op:'DELETE' + payload:null (MASTER-PLAN §1.1);
      // the stored projection payload stays for the watermark's sake.
      payload: row.op === "DELETE" ? null : row.payload,
      changedAt: row.changedAt,
      version: row.op === "DELETE" || row.version === null ? null : Number(row.version),
    };
    const itemBytes = Buffer.byteLength(JSON.stringify(change));
    if (changes.length > 0 && !fitsByteCap(bytes, itemBytes)) {
      byteCapped = true;
      break;
    }
    changes.push(change);
    bytes += itemBytes;
  }

  const hasMore = countCapped || byteCapped;
  const lastSeq = changes.length > 0 ? changes[changes.length - 1]!.seq : afterSeq;
  const token = encodeCursor({ entityType, seq: lastSeq, issuedAt: serverTime });
  return {
    entityType,
    cursor: token,
    nextCursor: token,
    hasMore,
    changes,
    serverTime,
    contractVersion: SYNC_CONTRACT_VERSION,
  };
}

// -- PHASE-022 · DR-P22-05 · the personal serve scope -------------------------------

/**
 * The android-personal serve filter (LOCAL_DATABASE §1.1 rule 2): every
 * row a personal device pulls must belong to the linked partner (the
 * partner-keyed entities) or the device user (notifications) — the change
 * ledger is tenant-wide (the transport), the SCOPE is per-device and
 * server-side. Undefined for every other class (desktop/pos/field ride
 * their groups unfiltered — the 020 behavior unchanged).
 *
 * Scope keys (the payload contract per entity, packages/contracts
 * feed-projections): `sales_invoices` carries `customerId`, `receipts`
 * carries `partnerId`, `notifications` carries `userId`. A personal device
 * with no linked partner serves an EMPTY partner scope (fail closed —
 * never an unscoped serve); an entity type without a known key also fails
 * closed (`AND false`), so the personal group can never leak a future
 * entity by omission. `statements` never rides this path (its dedicated
 * feed scopes by partner set); the defensive entry keeps that explicit.
 */
function personalServeScope(
  entityType: string,
  deviceClass: string | null,
  device: { linkedPartnerId: string | null; userId: string | null },
): SQL | undefined {
  if (deviceClass !== "android-personal") {
    return undefined;
  }
  const partnerId = device.linkedPartnerId;
  switch (entityType) {
    case "sales_invoices":
      return partnerId === null
        ? sql`AND false`
        : sql`AND payload->>'customerId' = ${partnerId}`;
    case "receipts":
      return partnerId === null
        ? sql`AND false`
        : sql`AND payload->>'partnerId' = ${partnerId}`;
    case "notifications":
      return device.userId === null
        ? sql`AND false`
        : sql`AND payload->>'userId' = ${device.userId}`;
    // statements rides its dedicated partner-set feed; anything else in
    // the personal group without a scope key fails closed.
    default:
      return sql`AND false`;
  }
}
