import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { UnauthenticatedError } from "../../identity/api/identity";
import { DemoDataService } from "../application/demo-data-service";

/**
 * PHASE-040 demo-data routes (§2.5, TB-19/TB-20; matrix §3.18 — the
 * `configuration.demo_data.manage` key, feature-gated `platform.demo_data`
 * which ALL plans carry — the recorded trial-enablement decision): the
 * 13-template catalog with this tenant's seeded status, and the one-click
 * loader (idempotent; refuses tenants with posted real documents).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const seedSchema = z.object({
  templateKey: z.string().min(6).max(60),
});

@Controller("api/v1/onboarding/demo-data")
export class DemoDataController {
  constructor(@Inject(DemoDataService) private readonly demo: DemoDataService) {}

  @Get("templates")
  @RequirePermissions("configuration.demo_data.manage")
  @RequireFeature("platform.demo_data")
  async templates(): Promise<unknown> {
    return envelope(await this.demo.status());
  }

  @Get("status")
  @RequirePermissions("configuration.demo_data.manage")
  @RequireFeature("platform.demo_data")
  async status(): Promise<unknown> {
    return envelope(await this.demo.status());
  }

  @Post("")
  @RequirePermissions("configuration.demo_data.manage")
  @RequireFeature("platform.demo_data")
  @HttpCode(HttpStatus.OK)
  async seed(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = seedSchema.parse(body);
    return envelope(await this.demo.seed(identity.userId, input.templateKey));
  }
}
