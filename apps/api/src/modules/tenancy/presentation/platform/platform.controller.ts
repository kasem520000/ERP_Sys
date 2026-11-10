import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";

import { envelope, paginatedEnvelope } from "../../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../../infra/context/session-context";
import { RequirePermissions } from "../../../../infra/auth/require-permissions.decorator";
import { PlatformScope } from "../../../../infra/auth/platform-scope.decorator";
import { ambientAnyTx, withTenantOnTx } from "../../../../infra/db/tenant-context";
import { UnauthenticatedError } from "../../../identity/api/identity";
import { PlatformConsoleService } from "../../application/platform-console-service";
import { EntitlementsService } from "../../application/entitlements-service";
import { LifecycleService } from "../../application/lifecycle-service";
import { SupportAccessService } from "../../application/support-access-service";

/**
 * Platform admin console (PHASE-004 §2.7/T10; matrix §3.10; S-07):
 * PlatformScope-marked cross-tenant surface — tenant list/search, tenant
 * detail, suspend/restore, entitlement edits, manual plan assignment, the
 * cross-tenant audit viewer, and the support-session console. Platform
 * staff authenticate through the normal session substrate with their
 * platform-operations membership; the interceptor hands these routes the
 * platform GUC envelope and the services add per-operation tenant scoping.
 * Without a `platform.*` key the permission guard 403s + audits (S-07) —
 * including every escalation attempt from a business-tenant session.
 */

const suspendSchema = z.object({ reason: z.string().min(3).max(500) });
const entitlementGrantSchema = z.object({
  featureKey: z.string().min(3).max(100),
  source: z.enum(["MANUAL", "PROMO", "TRIAL"]),
  expiresAt: z.string().datetime().nullish(),
  reason: z.string().min(3).max(500),
});
const revokeSchema = z.object({ reason: z.string().min(3).max(500) });
const planAssignSchema = z.object({
  planKey: z.enum(["starter", "business", "enterprise"]),
  trialDays: z.number().int().min(1).max(365).optional(),
});
// PHASE-024 T4: the plan-level MFA policy payload (role keys; unknown
// roles are inert by the resolver's total design — documented in
// identity/domain/mfa-policy.ts).
const planMfaPolicySchema = z.object({
  requiredRoles: z.array(z.string().min(1).max(100)).max(20),
});
// PHASE-024 T12: the review window (default: the last 7 days).
const supportReviewWindowSchema = z.object({
  fromAt: z.string().datetime().optional(),
  toAt: z.string().datetime().optional(),
});
const supportOpenSchema = z.object({
  reason: z.string().min(3).max(500),
  ticketRef: z.string().min(3).max(100).optional(),
  maxHours: z.number().int().min(1).max(4).optional(),
});
const supportCloseSchema = z.object({ reason: z.string().min(3).max(500) });

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

function consoleTx() {
  const tx = ambientAnyTx();
  if (tx === undefined) {
    throw new Error("platform console handler must run inside a platform scope");
  }
  return tx;
}

function parseCursor(raw: unknown): { createdAt?: string; id?: string } {
  if (typeof raw !== "string" || raw === "") {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as { createdAt?: string; id?: string };
    return parsed;
  } catch {
    return {};
  }
}

@PlatformScope()
@Controller("api/v1/platform")
export class PlatformConsoleController {
  constructor(
    @Inject(PlatformConsoleService) private readonly console: PlatformConsoleService,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
    @Inject(LifecycleService) private readonly lifecycle: LifecycleService,
    @Inject(SupportAccessService) private readonly support: SupportAccessService,
  ) {}

  // -- tenant list/search + detail --------------------------------------------

  @Get("tenants")
  @RequirePermissions("platform.tenants.view")
  async listTenants(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Query("q") query?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") rawLimit?: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const parsed = parseCursor(cursor);
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
    const result = await this.console.listTenants(identity.userId, {
      query,
      cursor:
        parsed.createdAt !== undefined && parsed.id !== undefined
          ? { createdAt: parsed.createdAt, id: parsed.id }
          : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    if (result.nextCursor !== undefined) {
      response.header("x-next-cursor", result.nextCursor);
    }
    return paginatedEnvelope(result.rows, {
      limit: result.rows.length,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  }

  @Get("tenants/:id")
  @RequirePermissions("platform.tenants.view")
  async tenantDetail(@Req() request: Request, @Param("id") tenantId: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.console.tenantDetail(identity.userId, tenantId));
  }

  // -- lifecycle (matrix §3.10 risky suspend; rule-6 semantics) ----------------

  @Post("tenants/:id/suspend")
  @RequirePermissions("platform.tenants.suspend")
  @HttpCode(HttpStatus.OK)
  async suspendTenant(
    @Req() request: Request,
    @Param("id") tenantId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = suspendSchema.parse(body);
    return envelope(await this.lifecycle.suspend(identity.userId, tenantId, input.reason));
  }

  @Post("tenants/:id/restore")
  @RequirePermissions("platform.tenants.restore")
  @HttpCode(HttpStatus.OK)
  async restoreTenant(
    @Req() request: Request,
    @Param("id") tenantId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = suspendSchema.parse(body);
    return envelope(await this.lifecycle.restore(identity.userId, tenantId, input.reason));
  }

  // -- entitlements editing (§2.7; audited, closure-checked) -------------------

  @Get("tenants/:id/entitlements")
  @RequirePermissions("platform.entitlements.manage")
  async listEntitlements(
    @Req() request: Request,
    @Param("id") tenantId: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const detail = await this.console.tenantDetail(identity.userId, tenantId);
    return envelope(detail.entitlements);
  }

  @Post("tenants/:id/entitlements")
  @RequirePermissions("platform.entitlements.manage")
  @HttpCode(HttpStatus.OK)
  async grantEntitlement(
    @Req() request: Request,
    @Param("id") tenantId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = entitlementGrantSchema.parse(body);
    const result = await withTenantOnTx(tenantId, consoleTx(), () =>
      this.entitlements.grant(identity.userId, {
        featureKey: input.featureKey,
        source: input.source,
        expiresAt: input.expiresAt ?? null,
        reason: input.reason,
      }),
    );
    return envelope(result);
  }

  @Delete("tenants/:id/entitlements/:featureKey")
  @RequirePermissions("platform.entitlements.manage")
  async revokeEntitlement(
    @Req() request: Request,
    @Param("id") tenantId: string,
    @Param("featureKey") featureKey: string,
    @Query("reason") reason?: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const parsedReason = revokeSchema.parse({ reason: reason ?? "" }).reason;
    await withTenantOnTx(tenantId, consoleTx(), () =>
      this.entitlements.revoke(identity.userId, featureKey, parsedReason),
    );
    return envelope({ revoked: featureKey });
  }

  // -- manual plan assignment (platform.subscriptions.manage) ------------------

  @Post("tenants/:id/plan")
  @RequirePermissions("platform.subscriptions.manage")
  @HttpCode(HttpStatus.OK)
  async assignPlan(
    @Req() request: Request,
    @Param("id") tenantId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = planAssignSchema.parse(body);
    return envelope(
      await this.console.assignPlan(identity.userId, tenantId, {
        planKey: input.planKey,
        trialDays: input.trialDays,
      }),
    );
  }

  // -- plan-level MFA policy (PHASE-024 T4; platform.plans.manage) --------------

  @Put("plans/:key/mfa-policy")
  @RequirePermissions("platform.plans.manage")
  async setPlanMfaPolicy(
    @Req() request: Request,
    @Param("key") planKey: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = planMfaPolicySchema.parse(body);
    return envelope(
      await this.console.setPlanMfaPolicy(identity.userId, planKey, input.requiredRoles),
    );
  }

  // -- cross-tenant audit viewer (platform.audit.view) --------------------------

  @Get("audit/events")
  @RequirePermissions("platform.audit.view")
  async auditEvents(
    @Req() request: Request,
    @Query("tenantId") tenantId?: string,
    @Query("action") action?: string,
    @Query("platformOnly") platformOnly?: string,
    @Query("fromAt") fromAt?: string,
    @Query("toAt") toAt?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") rawLimit?: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    let parsedCursor: { at?: string; id?: string };
    try {
      parsedCursor = cursor === undefined || cursor === "" ? {} : JSON.parse(cursor);
    } catch {
      parsedCursor = {};
    }
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
    const result = await this.console.auditEvents(identity.userId, {
      tenantId,
      action,
      platformOnly: platformOnly === "true",
      fromAt,
      toAt,
      limit: Number.isFinite(limit) ? limit : undefined,
      cursor:
        parsedCursor.at !== undefined && parsedCursor.id !== undefined
          ? { at: parsedCursor.at, id: parsedCursor.id }
          : undefined,
    });
    return paginatedEnvelope(result.rows, {
      limit: result.rows.length,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  }

  // -- support sessions console (§7) -------------------------------------------

  /**
   * PHASE-024 T12 (matrix §7): the support-access review report over a
   * window — every session with grant + end + proxied-read counts + the
   * explicit gap list (expired-unclosed / zero-action / orphaned-reads).
   */
  @Get("support-sessions/review")
  @RequirePermissions("platform.support.access")
  async supportReview(
    @Req() request: Request,
    @Query("fromAt") rawFromAt?: string,
    @Query("toAt") rawToAt?: string,
  ): Promise<unknown> {
    requireIdentity(request);
    const parsed = supportReviewWindowSchema.parse({ fromAt: rawFromAt, toAt: rawToAt });
    const windowToAt = parsed.toAt ?? new Date().toISOString();
    const windowFromAt =
      parsed.fromAt ?? new Date(Date.parse(windowToAt) - 7 * 24 * 60 * 60 * 1000).toISOString();
    return envelope(await this.support.reviewReport({ fromAt: windowFromAt, toAt: windowToAt }));
  }

  @Get("tenants/:id/support-sessions")
  @RequirePermissions("platform.support.access")
  async listSupportSessions(
    @Req() request: Request,
    @Param("id") tenantId: string,
  ): Promise<unknown> {
    requireIdentity(request);
    return envelope(await this.support.listForConsole(tenantId, consoleTx()));
  }

  @Post("tenants/:id/support-sessions")
  @RequirePermissions("platform.support.access")
  @HttpCode(HttpStatus.OK)
  async openSupportSession(
    @Req() request: Request,
    @Param("id") tenantId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = supportOpenSchema.parse(body);
    return envelope(
      await this.support.open(identity.userId, tenantId, consoleTx(), {
        reason: input.reason,
        ticketRef: input.ticketRef,
        maxHours: input.maxHours,
      }),
    );
  }

  @Post("tenants/:id/support-sessions/:sessionId/close")
  @RequirePermissions("platform.support.access")
  @HttpCode(HttpStatus.OK)
  async closeSupportSession(
    @Req() request: Request,
    @Param("id") tenantId: string,
    @Param("sessionId") sessionId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = supportCloseSchema.parse(body);
    await this.support.close(identity.userId, tenantId, sessionId, consoleTx(), input.reason);
    return envelope({ closed: true });
  }
  /** §7 rule 4: the enumerated read-all proxy (per-action audited). */
  @Get("tenants/:id/support-sessions/:sessionId/tenant-data/:resource")
  @RequirePermissions("platform.support.access")
  async proxyTenantData(
    @Req() request: Request,
    @Param("id") tenantId: string,
    @Param("sessionId") sessionId: string,
    @Param("resource") resource: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(
      await this.support.proxyRead(identity.userId, tenantId, sessionId, resource, consoleTx()),
    );
  }
}
