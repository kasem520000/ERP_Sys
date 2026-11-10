import { Body, Controller, Get, Inject, HttpCode, HttpStatus, Param, Patch, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { DEVICE_CLASSES, SYNC_CONTRACT_VERSION } from "@erp/contracts";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { getDb } from "../../../infra/db/client";
import { withTenant } from "../../../infra/db/tenant-context";
import {
  effectivePermissions,
  ForbiddenError,
  membershipOptions,
  TenantContextRequiredError,
  UnauthenticatedError,
} from "../../identity/api/identity";
import { DeviceNotFoundError, DeviceRegistryService } from "../application/device-registry-service";
import { enrollDeviceWithSecret } from "../application/device-enrollment";
import {
  DevicePushTokenRevokedError,
  upsertPushToken,
} from "../application/device-push-tokens";
import {
  DeviceRefreshInvalidError,
  DeviceRevokedError,
  reapplyRefreshReuseRevocation,
  rotateRefreshToken,
} from "../application/device-tokens";

/**
 * PHASE-020 · device registry routes (T3; MASTER-PLAN §8 rows 1–7;
 * SECURITY_AND_DEVICE_MANAGEMENT §1–§4; ADR-0015 §3; SYNC_PROTOCOL §1).
 *
 * Row 1–6 are permission-guarded tenant routes (the interceptor wraps the
 * handler in withTenant so the registry service and its audit events share
 * one unit of work). Row 7 — `POST /api/v1/devices/:id/refresh` — is the
 * PUBLIC credential exchange (route-permissions PUBLIC_ROUTES, the login
 * pattern: the bearer refresh token in the body IS the credential, no
 * session can exist before credentials rotate). The refresh route derives
 * its tenant scope the way login does: device → user → ACTIVE membership
 * (definer projection, pre-GUC) → withTenant(rotation).
 *
 * Row 8 — `POST /api/v1/devices/:id/enroll` — is the PHASE-021 enrollment
 * bootstrap (DR-P21-01, MASTER-PLAN §1 item 2): the same PUBLIC
 * credential-exchange pattern with the one-time enrollment secret in the
 * body (register returns it ONCE; the enroll exchange verifies its sha256
 * against devices.device_key_hash, clears the hash, and mints the FIRST
 * refresh token — the wiring DR-P20-03 deferred to 021). The phase doc's
 * "API changes: none" refers to the SYNC WIRE PROTOCOL (pull/push frozen
 * by PHASE-020); this credential exchange is the recorded exception the
 * PHASE-020 completion report promised — not a sync-protocol change.
 */

const UUID = z.string().uuid();

const registerSchema = z.object({
  deviceName: z.string().min(2).max(120),
  deviceClass: z.enum(DEVICE_CLASSES),
  platform: z.string().min(2).max(40).optional(),
  platformVersion: z.string().max(80).optional(),
  appVersion: z.string().max(80).optional(),
  contractVersion: z.string().max(40).optional(),
  deviceKeyPublic: z.string().min(16).max(400).optional(),
  capabilities: z.array(z.string().min(1).max(40)).max(20).optional(),
  platformAttestation: z.string().min(4).max(2000).optional(),
  /**
   * PHASE-022 T-P22-3-b (2-b's Deviation 2 closed — MASTER-PLAN §1 item 5 /
   * DR-P22-05a): the personal-account partner link. Accepted for
   * deviceClass "android-personal" ONLY (the registry service gates the
   * class + authorizes the link server-side — the registering identity
   * must be a CONTACT of that partner or hold the devices admin plane;
   * the payload id is NEVER trusted blind). Tenant-scoped by RLS: a
   * cross-tenant partner id finds no row and is refused with the same
   * typed error.
   */
  linkedPartnerId: UUID.optional(),
});

const patchSchema = z.object({
  trustFlags: z.record(z.string(), z.unknown()).optional(),
  dataExpiresAt: z.string().datetime().nullable().optional(),
});

const attestSchema = z.object({ signature: z.string().min(8).max(2000) });
const revokeSchema = z.object({ reason: z.string().min(1).max(500).optional() });
const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });
const enrollSchema = z.object({ enrollmentSecret: z.string().min(20).max(200) });

/**
 * PHASE-022 · DR-P22-07: the device-token opt-in body. optIn defaults FALSE
 * (tokens are per-device, opt-in explicit — integrations §3.5); locale
 * defaults 'ar' (the device's notification locale, resolved BEFORE the FCM
 * call). Token shape is bounded by length only — never a guessed format.
 */
const pushTokenSchema = z.object({
  token: z.string().min(20).max(512),
  locale: z.enum(["ar", "en"]).default("ar"),
  optIn: z.boolean().default(false),
});

/** Duplicated locally per the module convention (never import from a sibling
 * controller): the session identity or 401. */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

/** Guarded routes require an active tenant scope (the PermissionsGuard
 * already rejects null activeTenantId — this is the typed belt). */
function requireActiveTenant(identity: SessionContext): string {
  if (identity.activeTenantId === null) {
    throw new TenantContextRequiredError();
  }
  return identity.activeTenantId;
}

/** Context-less device lookup for the public refresh route (devices is
 * service-mediated — no RLS, no tenant GUC needed). */
async function findDeviceUser(deviceId: string): Promise<{ userId: string } | undefined> {
  const rows = await getDb().execute(sql`
    SELECT user_id AS "userId" FROM devices WHERE id = ${deviceId} LIMIT 1
  `);
  return (rows.rows as unknown as { userId: string }[])[0];
}

@Controller("api/v1/devices")
export class DevicesController {
  // PHASE-022 · DR-P22-07 (repair): the EXPLICIT token injection (the
  // users/sessions/mfa controller convention). The bare-type constructor
  // param relied on tsc's emitDecoratorMetadata — present in the production
  // build, but the vitest/esbuild transform drops design:paramtypes, so the
  // first HTTP-level devices spec (fcm-channel.spec) exposed the controller
  // booting with an undefined registry under tests.
  constructor(@Inject(DeviceRegistryService) private readonly registry: DeviceRegistryService) {}

  /** Row 1 — register a device; the enrollment secret is returned ONCE. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("sync.devices.register")
  async register(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity);
    const input = registerSchema.parse(body);
    const result = await this.registry.register({
      actorId: identity.userId,
      tenantId,
      deviceName: input.deviceName,
      deviceClass: input.deviceClass,
      platform: input.platform,
      platformVersion: input.platformVersion,
      appVersion: input.appVersion,
      contractVersion: input.contractVersion,
      deviceKeyPublic: input.deviceKeyPublic,
      capabilities: input.capabilities,
      platformAttestation: input.platformAttestation,
      // DR-P22-05a: the personal-class partner link (authorized inside the
      // service against the REGISTERING identity — never the payload id alone).
      linkedPartnerId: input.linkedPartnerId,
      actorEmail: identity.user.email,
    });
    return envelope({
      deviceId: result.device.id,
      attestationNonce: result.attestationNonce,
      enrollmentSecret: result.enrollmentSecret,
      contractVersion: SYNC_CONTRACT_VERSION,
    });
  }

  /** Row 2 — the registry table (web `/platform/devices`). */
  @Get()
  @RequirePermissions("identity.devices.manage")
  async list(@Req() request: Request) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity);
    return envelope(await this.registry.list({ tenantId }));
  }

  /** Row 3 — the detail view (drawer with per-entity cursor state). */
  @Get(":id")
  @RequirePermissions("identity.devices.manage")
  async get(@Param("id") id: string) {
    return envelope(await this.registry.get({ deviceId: UUID.parse(id) }));
  }

  /** Row 4 — the admin plane: trust flags (merge) + remote data expiry. */
  @Patch(":id")
  @RequirePermissions("identity.devices.manage")
  async patch(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    requireActiveTenant(identity);
    const input = patchSchema.parse(body);
    const deviceId = UUID.parse(id);
    let trustFlags: Record<string, unknown> | undefined;
    let dataExpiresAt: Date | null | undefined;
    if (input.trustFlags !== undefined) {
      trustFlags = await this.registry.flagTrust({
        deviceId,
        actorId: identity.userId,
        flags: input.trustFlags,
      });
    }
    if (input.dataExpiresAt !== undefined) {
      const result = await this.registry.expireData({
        deviceId,
        actorId: identity.userId,
        expiresAt: input.dataExpiresAt,
      });
      dataExpiresAt = result.dataExpiresAt;
    }
    return envelope({ deviceId, trustFlags, dataExpiresAt });
  }

  /** Row 5 — attestation-lite: prove possession of the registered key. */
  @Post(":id/attest")
  @RequirePermissions("sync.devices.register")
  async attest(@Param("id") id: string, @Body() body: unknown) {
    const input = attestSchema.parse(body);
    return envelope(
      await this.registry.attest({ deviceId: UUID.parse(id), signature: input.signature }),
    );
  }

  /**
   * Row 6 — revoke (the kill switch). The route registry marks the key
   * `self: true`: self-revoke (session user owns the device) and admin
   * revoke are both allowed — the handler enforces the ownership boundary,
   * the guard enforces the key (or the widened self scope).
   */
  @Post(":id/revoke")
  @RequirePermissions("sync.devices.revoke", { self: true })
  async revoke(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity);
    const input = revokeSchema.parse(body);
    const deviceId = UUID.parse(id);
    const detail = await this.registry.get({ deviceId });
    const self = detail.device.userId === identity.userId;
    const admin = (await effectivePermissions(identity.userId, tenantId)).has("sync.devices.revoke");
    if (!self && !admin) {
      throw new ForbiddenError("sync.devices.revoke");
    }
    return envelope(
      await this.registry.revoke({
        deviceId,
        actorId: identity.userId,
        reason: input.reason,
        admin,
      }),
    );
  }

  /**
   * Row 9 — PHASE-022 · DR-P22-07: the device-token opt-in surface (default
   * OFF). Permission-gated like device patch (identity.devices.manage) with
   * the revoke pattern's self scope: the device ITSELF calls this
   * post-registration with its device credentials — the 15-min access
   * token resolves the session (the sync data plane's ADR-0015 §3 path),
   * and the handler enforces the ownership boundary (the device's own
   * user, or an admin holding the manage key — exactly the revoke route's
   * self/admin split). optIn defaults false; a token never belongs to two
   * devices (uq token — typed conflict); revocation clears the rows.
   */
  @Put(":id/push-token")
  @RequirePermissions("identity.devices.manage", { self: true })
  async pushToken(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity);
    const input = pushTokenSchema.parse(body);
    const deviceId = UUID.parse(id);
    const detail = await this.registry.get({ deviceId });
    if (detail.device.revokedAt !== null) {
      // The kill switch is final — a revoked device never changes its token.
      throw new DevicePushTokenRevokedError(deviceId);
    }
    const self = detail.device.userId === identity.userId;
    const admin = (await effectivePermissions(identity.userId, tenantId)).has("identity.devices.manage");
    if (!self && !admin) {
      throw new ForbiddenError("identity.devices.manage");
    }
    return envelope(
      await upsertPushToken({
        deviceId,
        token: input.token,
        locale: input.locale,
        optIn: input.optIn,
        actorId: identity.userId,
      }),
    );
  }

  /**
   * Row 7 — PUBLIC credential exchange (PUBLIC_ROUTES; the login pattern).
   * Tenant derivation: device → user → ACTIVE membership (definer
   * projection, pre-GUC) → withTenant. On the reuse path the rotation throws
   * AFTER revoking — withTenant rolls the unit of work back with the throw,
   * so the controller re-applies the kill switch in its own committed scope
   * (idempotent, no double alarm). The M-05 revocation must SURVIVE the
   * failure response it causes.
   */
  @Post(":id/refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Param("id") id: string, @Body() body: unknown) {
    const input = refreshSchema.parse(body);
    const deviceId = UUID.parse(id);
    const device = await findDeviceUser(deviceId);
    if (device === undefined) {
      throw new DeviceNotFoundError(deviceId);
    }
    const options = await membershipOptions(device.userId);
    const active = options.find(
      (option) =>
        option.tenantId !== null &&
        option.membershipStatus === "ACTIVE" &&
        option.tenantStatus === "ACTIVE",
    );
    if (active === undefined) {
      throw new DeviceRefreshInvalidError(
        "the device user has no active membership — credential exchange unavailable",
      );
    }
    try {
      const rotated = await withTenant(active.tenantId, () =>
        rotateRefreshToken({ deviceId, token: input.refreshToken }),
      );
      return envelope(rotated);
    } catch (error) {
      if (error instanceof DeviceRevokedError) {
        await withTenant(active.tenantId, () =>
          reapplyRefreshReuseRevocation({ deviceId }),
        ).catch(() => undefined);
      }
      throw error;
    }
  }

  /**
   * Row 8 — PUBLIC enrollment bootstrap (DR-P21-01, PHASE-021; the recorded
   * exception to the phase's "API changes: none" — that freeze is the sync
   * wire protocol, not the credential plane; the PHASE-020 completion
   * report promised this wiring). Credential-in-body like refresh (the
   * login pattern): the one-time enrollment secret register returned IS
   * the credential. Tenant derivation identical to refresh: device → user
   * → ACTIVE membership (definer projection, pre-GUC) → withTenant. No
   * rollback-survival catch needed: the enroll path never revokes anything
   * (no reuse kill switch), so a thrown error rolls back cleanly.
   */
  @Post(":id/enroll")
  @HttpCode(HttpStatus.OK)
  async enroll(@Param("id") id: string, @Body() body: unknown) {
    const input = enrollSchema.parse(body);
    const deviceId = UUID.parse(id);
    const device = await findDeviceUser(deviceId);
    if (device === undefined) {
      throw new DeviceNotFoundError(deviceId);
    }
    const options = await membershipOptions(device.userId);
    const active = options.find(
      (option) =>
        option.tenantId !== null &&
        option.membershipStatus === "ACTIVE" &&
        option.tenantStatus === "ACTIVE",
    );
    if (active === undefined) {
      throw new DeviceRefreshInvalidError(
        "the device user has no active membership — credential exchange unavailable",
      );
    }
    const enrolled = await withTenant(active.tenantId, () =>
      enrollDeviceWithSecret({ deviceId, enrollmentSecret: input.enrollmentSecret }),
    );
    return envelope(enrolled);
  }
}
