import { Body, Controller, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../../infra/http/envelope";
import { identityOf } from "../../../../infra/context/session-context";
import { RequirePermissions } from "../../../../infra/auth/require-permissions.decorator";
import { UnauthenticatedError } from "../../../identity/domain/identity-errors";
import { OffboardingService } from "../../application/offboarding/offboarding-service";

/**
 * Offboarding routes (PHASE-024 T11; DATA_PROTECTION §4; Journey H).
 *
 * Platform plane (two-person execution + legal hold + state):
 * - POST /tenants/:id/offboard — the person-2 execution (suspend + the
 *   90-day retention window); refuses without the owner's request.
 * - PUT /tenants/:id/legal-hold — the guardrail flag (audited both ways).
 * - GET /tenants/:id/offboarding — the flow state (H6).
 *
 * Tenant plane (tenancy.controller.ts carries the request/export/cancel
 * trio — kept there with the other tenant-plane settings routes).
 */

const legalHoldSchema = z.object({
  legalHold: z.boolean(),
  reason: z.string().min(3).max(500),
});

@Controller("api/v1/platform")
export class OffboardingPlatformController {
  constructor(@Inject(OffboardingService) private readonly offboarding: OffboardingService) {}

  /** Person 2: the platform admin executes the owner's request. */
  @Post("tenants/:id/offboard")
  @RequirePermissions("platform.tenants.offboard")
  async execute(@Req() request: Request, @Param("id") tenantId: string) {
    const identity = requireIdentity(request);
    const row = await this.offboarding.execute({ tenantId, adminId: identity.userId });
    return envelope({
      status: row.status,
      retentionUntil: row.retentionUntil,
      note: "retention window running — the daily purge sweep completes the deletion",
    });
  }

  /** Journey-H guardrail: legal hold blocks the purge (audited). */
  @Put("tenants/:id/legal-hold")
  @RequirePermissions("platform.tenants.offboard")
  async setLegalHold(
    @Req() request: Request,
    @Param("id") tenantId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = legalHoldSchema.parse(body);
    await this.offboarding.setLegalHold({
      tenantId,
      adminId: identity.userId,
      legalHold: input.legalHold,
      reason: input.reason,
    });
    return envelope({ legalHold: input.legalHold });
  }

  /** H6: the flow state for the console timeline. */
  @Get("tenants/:id/offboarding")
  @RequirePermissions("platform.tenants.view")
  async state(@Param("id") tenantId: string) {
    return envelope(await this.offboarding.state(tenantId));
  }
}

function requireIdentity(request: Request) {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}
