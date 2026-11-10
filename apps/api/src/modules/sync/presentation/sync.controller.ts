import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { SYNC_CONTRACT_VERSION, isContractSupported } from "@erp/contracts";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { generateUuidV7 } from "@erp/domain-core";
import { sql } from "drizzle-orm";
import { feedGroupForDeviceClass, deviceClassOf, loadDevice } from "../application/feed-groups";
import { pull } from "../application/pull-service";
import { PushService } from "../application/push-service";
import { DeviceRegistryService } from "../application/device-registry-service";
import { SyncCommandInvalidError } from "../domain/sync-errors";

/**
 * PHASE-020 · the generalized sync routes (MASTER-PLAN §8; SYNC_PROTOCOL
 * endpoint table): device status, per-entity pull (+ the C-12 resync
 * directive), batch push (v2 `SyncCommand` + the 016 legacy shapes — §11
 * rule 3), and the best-effort acks. Device identity rides EITHER the
 * authenticated session + `X-Device-Id` (the BFF/016 terminal path) OR
 * the 15-min device access token (ADR-0015 §3 — the middleware resolves
 * the user; the device row is re-verified per request: revocation and
 * suspension are enforced before anything executes).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DEVICE_HEADER = "x-device-id";

@Controller()
export class SyncController {
  constructor(
    private readonly push: PushService,
    private readonly registry: DeviceRegistryService,
  ) {}

  /** Heartbeat / status v2 (§1 table + §2.1): contract version (422-grade
   * mismatch signal for C-08 — the body carries the supported version),
   * server time, the device's feed group, device state, tenant status. */
  @Get("api/v1/sync/status")
  @RequirePermissions("pos.sales.sell")
  async status(@Req() request: Request) {
    const identity = requireIdentity(request);
    const deviceIdHeader = request.headers[DEVICE_HEADER];
    let device:
      | Awaited<ReturnType<typeof loadDevice>>
      | undefined = undefined;
    if (typeof deviceIdHeader === "string" && deviceIdHeader.length > 0) {
      device = await loadDevice(deviceIdHeader);
    }
    const tx = requireTenantContext().tx!;
    const tenantRows = await tx.execute(
      sql`SELECT status FROM tenants WHERE id = erp.current_tenant_id()`,
    );
    const tenantStatus =
      (tenantRows.rows as unknown as { status: string }[])[0]?.status ?? "ACTIVE";
    const deviceClass =
      device === undefined
        ? null
        : deviceClassOf({ deviceClass: device.deviceClass, platform: device.platform });
    return envelope({
      contractVersion: SYNC_CONTRACT_VERSION,
      serverTime: new Date().toISOString(),
      feedGroup: feedGroupForDeviceClass(deviceClass),
      device:
        device === undefined
          ? null
          : {
              id: device.id,
              deviceClass,
              revoked: device.revokedAt !== null,
              trustFlags: device.trustFlags ?? {},
              dataExpiresAt: device.dataExpiresAt,
              contractVersion: device.contractVersion,
              // C-08 gate signal for native clients: is the device's stored
              // contract version still supported by this server?
              contractSupported:
                device.contractVersion === null
                  ? null
                  : isContractSupported(device.contractVersion),
            },
      suspended: tenantStatus !== "ACTIVE",
      tenantId: identity.activeTenantId,
    });
  }

  /** Pull deltas v2 (§2): per-entity-type cursor pagination; the device
   * header scopes the feed group (no device → the fail-safe pos group,
   * the 016 path). The `permissions` entity resolves through the device's
   * user snapshot feed. */
  @Get("api/v1/sync/pull")
  @RequirePermissions("pos.sales.sell")
  async pullDelta(
    @Req() request: Request,
    @Query("entity") entity?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    const entityType = z.string().min(2).max(40).parse(entity ?? "");
    const deviceIdHeader = request.headers[DEVICE_HEADER];
    const deviceId =
      typeof deviceIdHeader === "string" && deviceIdHeader.length > 0
        ? z.string().uuid().parse(deviceIdHeader)
        : undefined;

    // One door for every entity type: the pull service gates the device
    // itself (§1.5 — not-found → the 016 404, revoked → DEVICE_REVOKED before
    // anything is served), enforces the feed-group scope, and routes the
    // synthetic `permissions` entity through the per-user snapshot feed.
    const result = await pull({
      entityType,
      cursor: cursor === undefined || cursor === "" || cursor === "null" ? null : cursor,
      limit: limit === undefined ? undefined : Number(limit),
      deviceId,
    });
    if (deviceId !== undefined) {
      await this.registry.touchPull(deviceId).catch(() => undefined);
    }
    return envelope(result);
  }

  /** Push commands v2 (§3): batch with per-item results. The body is
   * EITHER the 016 shape `{batchId, commands}` (byte-compat — §11 rule 3)
   * OR the v2 `{contractVersion, commands}` envelope (SyncCommand
   * items); `Idempotency-Key` remains the batch id on the legacy wire. */
  @Post("api/v1/sync/push")
  @RequirePermissions("sales.pos_session.post")
  async pushCommands(@Req() request: Request, @Body() body: unknown) {
    requireIdentity(request);
    const deviceIdHeader = request.headers[DEVICE_HEADER];
    const deviceId = z
      .string()
      .uuid()
      .parse(typeof deviceIdHeader === "string" ? deviceIdHeader : "");
    const input = z
      .object({
        batchId: z.string().min(8).max(120).optional(),
        contractVersion: z.string().min(1).max(60).optional(),
        commands: z.array(z.unknown()).max(50),
      })
      .parse(body);
    // The batch byte budget (SYNC_PROTOCOL §3: ≤ 50 commands OR ≤ 1 MB):
    // a serialized batch past 1 MB is a malformed envelope — typed 400
    // (SyncCommandInvalidError), never a silent truncate (D-03).
    if (Buffer.byteLength(JSON.stringify(input.commands), "utf8") > 1_000_000) {
      throw new SyncCommandInvalidError("push batch exceeds the 1 MB budget");
    }
    const result = await this.push.push({
      deviceId,
      batchId: input.batchId,
      contractVersion: input.contractVersion,
      commands: input.commands,
    });
    await this.registry.touchPush(deviceId).catch(() => undefined);
    return envelope(result);
  }

  /** Pull ack (§2.8 — the server-side cursor HINT): records the device's
   * last confirmed positions into sync_cursors for support/monitoring;
   * correctness never depends on it. */
  @Post("api/v1/sync/pull/ack")
  @RequirePermissions("pos.sales.sell")
  async pullAck(@Req() request: Request, @Body() body: unknown) {
    requireIdentity(request);
    const deviceIdHeader = request.headers[DEVICE_HEADER];
    const deviceId = z
      .string()
      .uuid()
      .parse(typeof deviceIdHeader === "string" ? deviceIdHeader : "");
    const input = z
      .object({
        positions: z
          .array(
            z.object({
              entityType: z.string().min(2).max(40),
              cursor: z.string().min(1),
            }),
          )
          .max(50),
      })
      .parse(body);
    const acked = await ackPositions(deviceId, input.positions);
    await this.registry.touchPull(deviceId).catch(() => undefined);
    return envelope({ acknowledged: acked });
  }

  /** Push ack (§5.1 — best-effort bookkeeping): the server MAY advance
   * outbox-lag metrics from the processed ids; dedupe covers the
   * un-acked case (correctness never depends on ack delivery). */
  @Post("api/v1/sync/push/ack")
  @RequirePermissions("sales.pos_session.post")
  async pushAck(@Req() request: Request, @Body() body: unknown) {
    requireIdentity(request);
    const deviceIdHeader = request.headers[DEVICE_HEADER];
    const deviceId = z
      .string()
      .uuid()
      .parse(typeof deviceIdHeader === "string" ? deviceIdHeader : "");
    const input = z
      .object({ commandIds: z.array(z.string().min(8).max(120)).max(200) })
      .parse(body);
    await this.registry.touchPush(deviceId).catch(() => undefined);
    return envelope({ acknowledged: input.commandIds.length });
  }
}

/** Upsert the acknowledged cursor positions (sync_cursors — the monitoring
 * hint; the client's local cursor stays authoritative for resume). */
async function ackPositions(
  deviceId: string,
  positions: readonly { entityType: string; cursor: string }[],
): Promise<number> {
  const tx = requireTenantContext().tx!;
  // Reuse the cursor decoder contract: positions arrive as the same opaque
  // tokens the pull envelope returned (tamper-evident, entity-bound).
  const { decodeCursor } = await import("../application/cursor-tokens");
  let acknowledged = 0;
  for (const position of positions) {
    const decoded = decodeCursor(position.cursor);
    if (decoded === undefined || decoded.entityType !== position.entityType) {
      continue; // malformed/hint-mismatch positions are skipped silently
    }
    await tx.execute(sql`
      INSERT INTO sync_cursors
        (id, created_at, updated_at, version, tenant_id, device_id, entity_type,
         last_seq, acknowledged_at)
      VALUES (${generateUuidV7()}, now(), now(), 1, erp.current_tenant_id(),
              ${deviceId}, ${position.entityType}, ${decoded.seq}, now())
      ON CONFLICT (device_id, entity_type) DO UPDATE
        SET last_seq = EXCLUDED.last_seq, acknowledged_at = now(), updated_at = now()
    `);
    acknowledged += 1;
  }
  return acknowledged;
}
