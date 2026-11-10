import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf } from "../../../infra/context/session-context";
import { AuditService } from "../../audit/api/audit";
import { withTenant } from "../../../infra/db/tenant-context";
import { LoginService } from "../application/login-service";
import { SessionService } from "../application/session-service";
import { NotFoundError, UnauthenticatedError } from "../domain/identity-errors";
import { hashToken } from "../domain/tokens";
import * as store from "../infrastructure/identity.store";

/**
 * Session routes (AUTHENTICATION §1): login issues the rotating session
 * token consumed by the BFF; current/refresh/switch are session-self
 * surfaces; logout revokes the presented session row. The BFF holds the
 * httpOnly/Secure/SameSite=Lax cookie and echoes the CSRF token — the API
 * plane is token-authenticated and CSRF-exempt by construction.
 */

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  mfaCode: z.string().regex(/^\d{6}$|^[0-9a-f]{10}$/).optional(),
});

const switchSchema = z.object({ tenantId: z.string().uuid() });

@Controller("api/v1/identity/sessions")
export class SessionsController {
  constructor(
    @Inject(LoginService) private readonly loginService: LoginService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** POST /api/v1/identity/sessions — login (public; Idempotency-exempt). */
  @Post()
  @HttpCode(HttpStatus.OK)
  async login(@Req() request: Request, @Body() body: unknown) {
    const input = loginSchema.parse(body);
    const result = await this.loginService.login({
      email: input.email,
      password: input.password,
      mfaCode: input.mfaCode,
      ip: clientIp(request),
    });
    return envelope(result);
  }

  /** GET current — introspection (user, memberships, active tenant, permissions). */
  @Get("current")
  async current(@Req() request: Request) {
    const identity = requireIdentity(request);
    const memberships = await this.sessions.membershipOptions(identity.userId);
    const permissions =
      identity.activeTenantId !== null
        ? [...(await store.effectivePermissions(identity.userId, identity.activeTenantId))].sort()
        : [];
    return envelope({
      user: {
        id: identity.userId,
        email: identity.user.email,
        fullName: identity.user.fullName,
        locale: identity.user.locale,
      },
      activeTenantId: identity.activeTenantId,
      memberships: memberships.map((m) => ({
        tenantId: m.tenantId,
        tenantName: m.tenantName,
        tenantNameAr: m.tenantNameAr,
        roleKey: m.roleKey,
        membershipStatus: m.membershipStatus,
        tenantStatus: m.tenantStatus,
      })),
      permissions,
    });
  }

  /** DELETE current — logout: revoke the presented session server-side. */
  @Delete("current")
  @HttpCode(HttpStatus.OK)
  async logout(@Req() request: Request) {
    const identity = requireIdentity(request);
    await this.sessions.revokeById(identity.sessionId);
    if (identity.activeTenantId !== null) {
      await withTenant(identity.activeTenantId, async () => {
        await this.audit.record({
          action: "session.revoked",
          entityType: "session",
          entityId: identity.sessionId,
          actorId: identity.userId,
        });
      });
    }
    return envelope({ revoked: true });
  }

  /**
   * POST refresh — rotate the session id (M-04): old token dies with the
   * rotation; the absolute window is inherited (re-anchored created_at).
   */
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request) {
    const rotated = await this.sessions.rotate(requireSessionToken(request));
    return envelope(rotated);
  }

  /**
   * POST switch-tenant (API_CONVENTIONS §11): the server verifies the target
   * membership (S-01 — non-member tenant → 404, no existence leak) and
   * rotates the session id so the old one dies (M-04).
   */
  @Post("switch-tenant")
  @HttpCode(HttpStatus.OK)
  async switchTenant(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = switchSchema.parse(body);
    const options = await this.sessions.membershipOptions(identity.userId);
    const target = options.find(
      (option) =>
        option.tenantId === input.tenantId &&
        option.membershipStatus === "ACTIVE" &&
        option.tenantStatus === "ACTIVE",
    );
    if (target === undefined) {
      // 404 not 403: confirming existence to a probe is the oracle the
      // model forbids (ERROR_MODEL §3 / S-01).
      throw new NotFoundError("tenant");
    }
    const presented = requireSessionToken(request);
    const rotated = await this.sessions.rotate(presented);
    const active = await store.findSessionByTokenHash(hashToken(rotated.token));
    if (active !== undefined) {
      await store.updateSessionActiveTenant(active.id, input.tenantId);
    }
    return envelope({ token: rotated.token, sessionId: rotated.sessionId, activeTenantId: input.tenantId });
  }
}

function requireIdentity(request: Request) {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

function requireSessionToken(request: Request): string {
  const presented = request.header("x-session-token");
  if (presented === undefined || presented === "") {
    throw new UnauthenticatedError();
  }
  return presented;
}

function clientIp(request: Request): string {
  const forwarded = request.header("x-forwarded-for");
  if (forwarded !== undefined && forwarded !== "") {
    return forwarded.split(",")[0]!.trim();
  }
  return request.ip ?? "unknown";
}
