import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { StandardCostService } from "../application/standard-cost-service";

/**
 * Standard-cost routes (PHASE-042 L2-12; matrix §3.20): MANUAL drafts, the
 * BOM/routing roll-up (a new ROLLED_UP DRAFT), and the activation with the
 * optional stock revaluation — one manage key
 * (`manufacturing.standard_costs.manage`). BR-039 feature gate
 * `manufacturing.standard_costs`; costs travel as decimal strings ≤ 6dp
 * (ADR-0009; numeric(19,6) storage); the total is NEVER accepted from the
 * wire — the service derives it (the ck_item_standard_costs_total floor).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const COST = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal cost (≤ 6dp)");
const LIMIT = z.coerce.number().int().min(1).max(500);
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const NOTE = z.string().min(1).max(500).nullable().optional();

const subSplitSchema = z.object({
  key: z.string().min(1).max(40),
  amount: COST,
});

const createSchema = z.object({
  itemId: UUID,
  materialCost: COST,
  laborCost: COST,
  overheadCost: COST,
  overheadSubSplits: z.array(subSplitSchema).max(50).nullable().optional(),
  effectiveFrom: ISO_DATE.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const rollUpSchema = z.object({ itemId: UUID });

const activateSchema = z.object({
  revaluateStock: z.boolean().optional(),
  effectiveFrom: ISO_DATE.nullable().optional(),
});

@Controller("api/v1/manufacturing/standard-costs")
export class StandardCostsController {
  constructor(@Inject(StandardCostService) private readonly standardCosts: StandardCostService) {}

  @Get("")
  @RequirePermissions("manufacturing.standard_costs.manage")
  @RequireFeature("manufacturing.standard_costs")
  async list(@Query("itemId") itemId?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.standardCosts.list({
        itemId: itemId && UUID.safeParse(itemId).success ? itemId : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.standard_costs.manage")
  @RequireFeature("manufacturing.standard_costs")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.standardCosts.createDraft({
        itemId: input.itemId,
        materialCost: input.materialCost,
        laborCost: input.laborCost,
        overheadCost: input.overheadCost,
        overheadSubSplits: input.overheadSubSplits ?? null,
        effectiveFrom: input.effectiveFrom ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- roll-up BEFORE :id routes (static segment wins the Express match) --------------

  @Post("roll-up")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.standard_costs.manage")
  @RequireFeature("manufacturing.standard_costs")
  async rollUp(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = rollUpSchema.parse(body);
    return envelope(await this.standardCosts.rollUp(input.itemId, { actorId: identity.userId }));
  }

  @Post(":id/activate")
  @RequirePermissions("manufacturing.standard_costs.manage")
  @RequireFeature("manufacturing.standard_costs")
  async activate(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = activateSchema.parse(body ?? {});
    return envelope(
      await this.standardCosts.activate(id, {
        revaluateStock: input.revaluateStock,
        effectiveFrom: input.effectiveFrom ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
