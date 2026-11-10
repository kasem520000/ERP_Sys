import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireLimit } from "../../../infra/auth/require-limit.decorator";
import { InvitationService } from "../application/invitation-service";
import { UsersService } from "../application/users-service";
import { SessionService } from "../application/session-service";
import { MfaService } from "../application/mfa-service";
import { NotFoundError, UnauthenticatedError } from "../domain/identity-errors";

/**
 * Users / invitations / roles routes (matrix §3.9): the tenant-admin
 * plane. Every protected handler resolves the tenant scope through the
 * TenantContextInterceptor (session → active membership) and enforces its
 * AUTHORIZATION_MATRIX key here — the generated checklist iterates the
 * registry in infra/auth/route-permissions.ts.
 */

const inviteSchema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid(),
});

const acceptSchema = z.object({
  token: z.string().min(10).max(200),
  fullName: z.string().min(1).max(200),
  password: z.string().min(10).max(200),
  locale: z.enum(["ar", "en"]).optional(),
});

const grantsSchema = z.object({ keys: z.array(z.string().min(3).max(100)).max(300) });
const cloneSchema = z.object({ templateKey: z.string().min(2).max(60) });

@Controller("api/v1/identity")
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(InvitationService) private readonly invitations: InvitationService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}

  // -- users (tenant plane) -------------------------------------------------

  @Get("users")
  @RequirePermissions("identity.users.view")
  async listUsers(@Req() request: Request) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity.activeTenantId);
    return envelope(await this.users.listForTenant(tenantId));
  }

  // -- invitations ----------------------------------------------------------

  /** Issue an invitation (owner; email + tenant role; 72 h token). */
  @Post("invitations")
  @RequirePermissions("identity.users.invite")
  @RequireLimit("users")
  @HttpCode(HttpStatus.OK)
  async invite(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity.activeTenantId);
    const input = inviteSchema.parse(body);
    const issued = await this.invitations.issue({
      tenantId,
      email: input.email,
      roleId: input.roleId,
      invitedBy: identity.userId,
    });
    // The emailed link is the token itself; the API response exposes it to
    // the invited-actor UI only in dev (mailpit carries it in real flows).
    return envelope({
      invitationId: issued.invitationId,
      expiresAt: issued.expiresAt,
      acceptPath: `/api/v1/identity/invitations/accept?token=${encodeURIComponent(issued.token)}`,
    });
  }

  @Get("invitations")
  @RequirePermissions("identity.users.view")
  async listInvitations(@Req() request: Request) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity.activeTenantId);
    return envelope(await this.invitations.listForTenant(tenantId));
  }

  @Post("invitations/:id/revoke")
  @RequirePermissions("identity.users.invite")
  @HttpCode(HttpStatus.OK)
  async revokeInvitation(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity.activeTenantId);
    await this.invitations.revoke(id, tenantId, identity.userId);
    return envelope({ revoked: true });
  }

  // -- invitation acceptance (PUBLIC — the emailed token is the capability)

  @Get("invitations/accept")
  async viewInvitation(@Query("token") token: string) {
    if (token === undefined || token === "") {
      throw new NotFoundError("invitation");
    }
    return envelope(await this.invitations.viewByToken(token));
  }

  @Post("invitations/accept")
  @HttpCode(HttpStatus.OK)
  async acceptInvitation(@Body() body: unknown) {
    const input = acceptSchema.parse(body);
    const result = await this.invitations.accept(input);
    return envelope(result);
  }

  // -- memberships ----------------------------------------------------------

  @Post("memberships/:id/revoke")
  @RequirePermissions("identity.users.manage")
  @HttpCode(HttpStatus.OK)
  async revokeMembership(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity.activeTenantId);
    await this.users.revokeMembership({ tenantId, membershipId: id, actorId: identity.userId });
    return envelope({ revoked: true });
  }

  // -- sessions (admin plane: list tenant sessions, revoke any — M-10) ------

  @Get("sessions/tenant")
  @RequirePermissions("identity.sessions.revoke")
  async listTenantSessions(@Req() request: Request) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity.activeTenantId);
    return envelope(await this.sessions.listForTenant(tenantId));
  }

  @Post("sessions/:id/revoke")
  @RequirePermissions("identity.sessions.revoke")
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.users.revokeUserSession({
      sessionId: id,
      actorId: identity.userId,
    });
    return envelope({ revoked: true });
  }

  // -- roles editor (identity.roles.assign plane) ---------------------------

  @Get("roles")
  @RequirePermissions("identity.roles.assign")
  async listRoles() {
    return envelope({
      tenantRoles: await this.users.listTenantRoles(),
      systemTemplates: await this.users.listSystemTemplates(),
    });
  }

  @Post("roles/clone-template")
  @RequirePermissions("identity.roles.assign")
  @HttpCode(HttpStatus.OK)
  async cloneTemplate(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity.activeTenantId);
    const input = cloneSchema.parse(body);
    const role = await this.users.cloneTemplate({
      templateKey: input.templateKey,
      tenantId,
      actorId: identity.userId,
    });
    return envelope(role);
  }

  @Post("roles/:id/grants")
  @RequirePermissions("identity.roles.assign")
  @HttpCode(HttpStatus.OK)
  async setGrants(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = grantsSchema.parse(body);
    await this.users.setRoleGrants({ roleId: id, keys: input.keys, actorId: identity.userId });
    return envelope({ updated: true });
  }

  // -- MFA admin reset (PHASE-024 T4) ---------------------------------------

  /**
   * Admin-assisted MFA reset (matrix §3.9 `identity.mfa.admin_reset` — the
   * seeded key's first route; SECRETS_MANAGEMENT §3 S-05 emergency column):
   * removes every factor of the target user (confirmed + pending), audited.
   * If a policy still mandates MFA for them, the response says so — their
   * next login takes the enrollment-bootstrap path.
   */
  @Delete("users/:userId/mfa")
  @RequirePermissions("identity.mfa.admin_reset")
  async adminResetMfa(@Req() request: Request, @Param("userId") userId: string) {
    const identity = requireIdentity(request);
    const tenantId = requireActiveTenant(identity.activeTenantId);
    const result = await this.mfa.adminReset({
      adminId: identity.userId,
      targetUserId: userId,
      tenantId,
    });
    return envelope({
      reset: true,
      factorsRemoved: result.factorsRemoved,
      note: "if a policy mandates mfa for this user, their next login starts the enrollment bootstrap",
    });
  }
}

function requireIdentity(request: Request) {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

function requireActiveTenant(activeTenantId: string | null): string {
  if (activeTenantId === null) {
    throw new NotFoundError("tenant");
  }
  return activeTenantId;
}
