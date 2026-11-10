import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { TenantContextRequiredError, UnauthenticatedError } from "../../identity/api/identity";
import { SyncHealthService } from "../application/health-service";
import { ReconciliationService } from "../application/reconciliation-service";

/**
 * PHASE-020 · the sync admin/monitoring routes (T14; MASTER-PLAN §12; the
 * route-permissions rows ~2672–2683, matched verbatim):
 *
 *   GET  api/v1/sync/admin/health            — sync.settings.manage
 *   GET  api/v1/sync/admin/reconciliation    — sync.devices.revoke
 *   POST api/v1/sync/admin/drafts/reassign   — sync.devices.revoke
 *
 * All three are guarded tenant routes: the interceptor wraps the handler in
 * `withTenant(activeTenantId)`, so the health aggregate and the
 * reconciliation queue run on the ambient tenant transaction (the
 * DevicesController guarded-route contract). A `reconciliation/dismiss`
 * route is deliberately NOT exposed — it is not registered in
 * route-permissions (the registry is the source of truth; the queue's
 * dismiss action stays available to the service for future wiring).
 */

const reassignSchema = z.object({
  fromDeviceId: z.string().uuid(),
  toDeviceId: z.string().uuid(),
});

/** Duplicated locally per the module convention (never import from a
 * sibling controller): the session identity or 401. */
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

@Controller("api/v1/sync/admin")
export class SyncAdminController {
  constructor(
    private readonly healthService: SyncHealthService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  /** The health dashboard aggregate (web `/platform/sync-health`). */
  @Get("health")
  @RequirePermissions("sync.settings.manage")
  async health(@Req() request: Request) {
    const identity = requireIdentity(request);
    requireActiveTenant(identity);
    return envelope(await this.healthService.health());
  }

  /** The revoked-device pending-ops queue (web
   * `/platform/sync-reconciliation`). */
  @Get("reconciliation")
  @RequirePermissions("sync.devices.revoke")
  async reconciliationQueue(@Req() request: Request) {
    const identity = requireIdentity(request);
    requireActiveTenant(identity);
    return envelope(await this.reconciliation.pendingOperations());
  }

  /** Transfer DRAFT ownership off a revoked device (audited inside the
   * service; returns the moved count). */
  @Post("drafts/reassign")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("sync.devices.revoke")
  async reassignDrafts(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    requireActiveTenant(identity);
    const input = reassignSchema.parse(body);
    const result = await this.reconciliation.reassignDrafts({
      actorId: identity.userId,
      fromDeviceId: input.fromDeviceId,
      toDeviceId: input.toDeviceId,
    });
    return envelope(result);
  }
}
