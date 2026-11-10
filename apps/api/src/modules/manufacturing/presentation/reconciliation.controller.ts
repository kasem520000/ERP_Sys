import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ManufacturingReconciliationService } from "../application/wip-reconciliation-service";

/**
 * Manufacturing reconciliation routes (PHASE-018 §9 row 18; MASTER-PLAN
 * §11): the WIP↔GL check (INV-010 extension) — a read-only analysis that
 * records its run into the PHASE-007 reconciliation framework
 * (`reconciliation_runs`, kind WIP), never a journal write. Permission
 * `manufacturing.costing.read` (the costing read key), feature gate
 * `manufacturing.wip` (BR-039). requireIdentity, the global
 * Idempotency-Key POST guard, and the success envelope throughout.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");

const wipCheckSchema = z.object({
  asOf: DATE.optional(),
  runMode: z.enum(["NIGHTLY", "ON_DEMAND"]).optional(),
  checkedBy: z.string().uuid().nullable().optional(),
});

@Controller("api/v1/manufacturing")
export class ReconciliationController {
  constructor(
    @Inject(ManufacturingReconciliationService)
    private readonly reconciliation: ManufacturingReconciliationService,
  ) {}

  /**
   * POST /api/v1/manufacturing/reconciliation/wip-check — run the WIP check
   * as-of (defaults to today). The HTTP surface is on-demand by nature; the
   * nightly leg rides the same service once pg-boss wiring lands.
   */
  @Post("reconciliation/wip-check")
  @RequirePermissions("manufacturing.costing.read")
  @RequireFeature("manufacturing.wip")
  async runWipCheck(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = wipCheckSchema.parse(body ?? {});
    return envelope(
      await this.reconciliation.runWipCheck({
        asOf: input.asOf ?? new Date().toISOString().slice(0, 10),
        runMode: input.runMode ?? "ON_DEMAND",
        checkedBy: input.checkedBy ?? identity.userId,
      }),
    );
  }
}
