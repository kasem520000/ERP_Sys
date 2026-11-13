import { Body, Controller, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { PlanningPolicyService } from "../../items/application/planning-policy-service";
import { AtpService } from "../application/atp-service";
import { BillOfResourcesService } from "../application/bill-of-resources-service";

/**
 * Planning routes (PHASE-043; matrix §3.20): the item planning policies
 * (the item card's planning tab surface — `manufacturing.
 * planning_policies`), the lot-sizing catalog read, the ATP/CTP query
 * (`manufacturing.mrp` — the sales-line stamping rides the sales module's
 * own route), and the bill-of-resources maintenance + rough-cut check
 * (`manufacturing.mrp` — planning data, the BOM-manage tier).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal quantity (≤ 6dp)");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");

const policySchema = z.object({
  leadTimeDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  safetyStockPolicy: z.enum(["MANUAL", "AUTO"]).optional(),
  safetyStockQty: QTY.nullable().optional(),
  ssServiceLevelPct: z.enum(["90", "95", "98", "99"]).nullable().optional(),
  ssLookbackDays: z.coerce.number().int().min(30).max(1095).nullable().optional(),
  lotSizingRule: z.enum(["LOT_FOR_LOT", "FIXED_ORDER_QTY", "ORDER_MULTIPLE", "PERIOD_SUPPLY"]).optional(),
  fixedOrderQty: QTY.nullable().optional(),
  orderMultiple: QTY.nullable().optional(),
  periodSupplyBuckets: z.coerce.number().int().min(1).max(13).nullable().optional(),
  frozenFenceDays: z.coerce.number().int().min(0).max(90).optional(),
  slushyFenceDays: z.coerce.number().int().min(0).max(180).optional(),
});

const atpSchema = z.object({
  itemId: UUID,
  warehouseId: UUID,
  qty: QTY,
  date: DATE.nullable().optional(),
  horizonDays: z.coerce.number().int().min(1).max(366).optional(),
});

const borRowSchema = z.object({
  resourceKind: z.enum(["WORK_CENTER", "KEY_MATERIAL"]),
  workCenterId: UUID.nullable(),
  itemId: UUID.nullable(),
  consumptionFactor: QTY,
  note: z.string().min(1).max(500).nullable().optional(),
});

const borReplaceSchema = z.object({ rows: z.array(borRowSchema).min(1).max(200) });

const roughCutSchema = z.object({
  itemId: UUID,
  warehouseId: UUID,
  proposedQty: QTY,
  horizonDays: z.coerce.number().int().min(1).max(366),
});

@Controller("api/v1/manufacturing/planning")
export class PlanningController {
  constructor(
    @Inject(PlanningPolicyService) private readonly policies: PlanningPolicyService,
    @Inject(AtpService) private readonly atp: AtpService,
    @Inject(BillOfResourcesService) private readonly bor: BillOfResourcesService,
  ) {}

  // -- lot-sizing catalog + item planning policies ------------------------------------

  @Get("lot-sizing-rules")
  @RequirePermissions("manufacturing.planning_policies")
  @RequireFeature("manufacturing.planning")
  async lotSizingRules() {
    return envelope(await this.policies.lotSizingRules());
  }

  @Get("policies/:itemId")
  @RequirePermissions("manufacturing.planning_policies")
  @RequireFeature("manufacturing.planning")
  async getPolicy(@Param("itemId") itemId: string) {
    return envelope(await this.policies.get(itemId));
  }

  @Put("policies/:itemId")
  @RequirePermissions("manufacturing.planning_policies")
  @RequireFeature("manufacturing.planning")
  async updatePolicy(@Req() request: Request, @Param("itemId") itemId: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = policySchema.parse(body ?? {});
    return envelope(
      await this.policies.update(identity.userId, itemId, {
        leadTimeDays: input.leadTimeDays,
        safetyStockPolicy: input.safetyStockPolicy,
        safetyStockQty: input.safetyStockQty,
        ssServiceLevelPct: input.ssServiceLevelPct,
        ssLookbackDays: input.ssLookbackDays,
        lotSizingRule: input.lotSizingRule,
        fixedOrderQty: input.fixedOrderQty,
        orderMultiple: input.orderMultiple,
        periodSupplyBuckets: input.periodSupplyBuckets,
        frozenFenceDays: input.frozenFenceDays,
        slushyFenceDays: input.slushyFenceDays,
      }),
    );
  }

  // -- ATP/CTP query ------------------------------------------------------------------

  @Post("atp")
  @RequirePermissions("manufacturing.mrp")
  @RequireFeature("manufacturing.mrp")
  async checkAtp(@Body() body: unknown) {
    const input = atpSchema.parse(body);
    return envelope(
      await this.atp.check({
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        qty: input.qty,
        date: input.date ?? null,
        horizonDays: input.horizonDays,
      }),
    );
  }

  // -- bill of resources + the rough-cut check ----------------------------------------

  @Get("bor/:bomId")
  @RequirePermissions("manufacturing.boms.manage")
  @RequireFeature("manufacturing.work_centers")
  async listBor(@Param("bomId") bomId: string) {
    return envelope(await this.bor.list(bomId));
  }

  @Put("bor/:bomId")
  @RequirePermissions("manufacturing.boms.manage")
  @RequireFeature("manufacturing.work_centers")
  async replaceBor(@Req() request: Request, @Param("bomId") bomId: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = borReplaceSchema.parse(body);
    return envelope(
      await this.bor.replace(
        bomId,
        input.rows.map((row) => ({
          resourceKind: row.resourceKind,
          workCenterId: row.workCenterId,
          itemId: row.itemId,
          consumptionFactor: row.consumptionFactor,
          note: row.note ?? null,
        })),
        identity.userId,
      ),
    );
  }

  @Post("bor/rough-cut")
  @RequirePermissions("manufacturing.mrp")
  @RequireFeature("manufacturing.mrp")
  async roughCut(@Body() body: unknown) {
    const input = roughCutSchema.parse(body);
    return envelope(
      await this.bor.roughCut({
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        proposedQty: input.proposedQty,
        horizonDays: input.horizonDays,
      }),
    );
  }
}
