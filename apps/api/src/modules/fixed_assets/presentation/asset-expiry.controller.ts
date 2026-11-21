import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { AssetExpirySweepService } from "../application/asset-expiry-sweep-service";

/**
 * PHASE-049 (W-19 — T-12) the expiry plane's routes (matrix §3.27's W-19
 * dated note): THE SWEEP CONFIG family on the new `assets.expiry.manage`
 * key (the sweep threshold settings surface — the first 049 settings
 * keys) and THE FLEET-LIGHT REGISTER on `assets.expiry.view` (R-10's
 * read model — the four expiry chips + the odometer binding, the
 * renewal-register read plane).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const thresholdsSchema = z.object({
  thresholds: z.array(z.number().int().min(0)).min(1).max(12),
});

@Controller("/api/v1/assets/expiry-sweep")
export class AssetExpirySweepController {
  constructor(
    @Inject(AssetExpirySweepService) private readonly sweep: AssetExpirySweepService,
  ) {}

  /** The effective ladder (stored ∪ the documented default [30,7,0],
   * normalized by the pure fold) + the last run's seal (the audit plane
   * is the job log). */
  @Get()
  @RequirePermissions("assets.expiry.manage")
  async getConfig() {
    return envelope(await this.sweep.effectiveConfig());
  }

  /** The audited thresholds write — the same registry validation, the
   * same tenant_settings row, the same invalidation event as the generic
   * settings surface (one data home; the wave's own named refusal). */
  @Put()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("assets.expiry.manage")
  async putConfig(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = thresholdsSchema.parse(body);
    return envelope(
      await this.sweep.writeThresholds({ thresholds: input.thresholds, actorId: identity.userId }),
    );
  }
}

/** THE FLEET-LIGHT REGISTER (R-10 — the owner's CR-50 light-only
 * decision): ACTIVE assets with the four expiry chips + the odometer
 * binding; the vehicle-class grouping is the caller's category filter
 * (categories are tenant data — never a hard-coded law). */
@Controller("/api/v1/assets/fleet-light")
export class AssetFleetLightController {
  constructor(
    @Inject(AssetExpirySweepService) private readonly sweep: AssetExpirySweepService,
  ) {}

  @Get()
  @RequirePermissions("assets.expiry.view")
  async fleetLight(@Query("categoryId") categoryId?: string) {
    const categoryIds =
      categoryId === undefined || categoryId === ""
        ? undefined
        : categoryId.split(",").map((value) => value.trim()).filter((value) => value !== "");
    return envelope(await this.sweep.fleetLight({ categoryIds }));
  }
}
