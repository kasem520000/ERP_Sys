import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { Ias23Service } from "../application/ias23-service";

/**
 * PHASE-048 (W-10 — the D-11 engine) — the IAS 23 routes: the preview
 * (the projection arm — the split at any asOf) and the capitalization
 * posting (the elapsed arm — asOf ≤ today, one engine entry at Σ
 * capitalized + the POSTED scope rows). REQUIRES_VERIFICATION: both
 * arms refuse while the rate register is unset/unverified (the planted
 * settings key — never a fabricated rate).
 *
 * Permissions (matrix §3.26): the fourteen-key list ships no ias23
 * key — the capitalization RIDES THE BUDGET PLANE (D-11's own scope
 * law: the scope rows bind the approved budget's lines): preview →
 * projects.budget.view, capitalize → projects.budget.manage (the
 * dated note at the routes ledger records the reading). The
 * entitlement plane rides the projects.wbs feature flag (D-16).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const capitalizeSchema = z.object({
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(2000).nullish(),
});

@Controller("api/v1/projects")
export class ProjectsIas23Controller {
  constructor(@Inject(Ias23Service) private readonly ias23: Ias23Service) {}

  /** The projection arm — the split at any asOf (the register + the
   * window + the per-line eligible/expensed fold + the out-of-scope
   * list). */
  @Get(":projectId/ias23/preview")
  @RequirePermissions("projects.budget.view")
  @RequireFeature("projects.wbs")
  async preview(
    @Param("projectId") projectId: string,
    @Query("asOf") asOf?: string,
  ) {
    return envelope(
      await this.ias23.preview(projectId, asOf ?? new Date().toISOString().slice(0, 10)),
    );
  }

  /** The posting arm — one engine entry at Σ capitalized (DR the
   * mapped qualifying-asset account · CR the mapped borrowing-cost
   * account — fail-closed until the tenant maps the pair) + the POSTED
   * scope rows, all-or-nothing. */
  @Post(":projectId/ias23/capitalize")
  @RequirePermissions("projects.budget.manage")
  @RequireFeature("projects.wbs")
  @HttpCode(HttpStatus.OK)
  async capitalize(
    @Req() request: Request,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = capitalizeSchema.parse(body);
    return envelope(
      await this.ias23.capitalize(projectId, input.asOf, identity.userId, input.note ?? null),
    );
  }

  /** The scope rows' read (the computation evidence). */
  @Get(":projectId/ias23/capitalizations")
  @RequirePermissions("projects.budget.view")
  @RequireFeature("projects.wbs")
  async listCapitalizations(@Param("projectId") projectId: string) {
    return envelope(await this.ias23.listCapitalizations(projectId));
  }
}
