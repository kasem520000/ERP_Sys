import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { PlatformScope } from "../../../infra/auth/platform-scope.decorator";
import { UnauthenticatedError } from "../../identity/api/identity";
import { SandboxService } from "../application/sandbox-service";

/**
 * PHASE-040 sandbox provisioning routes (§2.6, OA-05; matrix §3.18): the
 * platform-plane one-call sales demo — a time-boxed, quota-capped SANDBOX
 * tenant with the chosen industry template and seeded demo data. Platform
 * staff only (`@PlatformScope()`); the action is never plan-gated (the
 * platform.payouts precedent — it rides `platform.subscriptions.manage`,
 * the manual-plan-assignment family).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const provisionSchema = z.object({
  name: z.string().min(3).max(200),
  templateKey: z.string().min(6).max(60),
  ownerEmail: z.string().email().max(200),
  days: z.number().int().min(1).max(90).optional(),
  maxUsers: z.number().int().min(1).max(10).optional(),
  countryCode: z.string().length(2).optional(),
});

@Controller("api/v1/platform")
export class SandboxController {
  constructor(@Inject(SandboxService) private readonly sandboxes: SandboxService) {}

  @Post("sandbox-tenants")
  @PlatformScope()
  @RequirePermissions("platform.subscriptions.manage")
  @HttpCode(HttpStatus.OK)
  async provision(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = provisionSchema.parse(body);
    return envelope(await this.sandboxes.provision(identity.userId, input));
  }

  @Get("sandbox-tenants")
  @PlatformScope()
  @RequirePermissions("platform.subscriptions.manage")
  async list(): Promise<unknown> {
    return envelope(await this.sandboxes.list());
  }
}
