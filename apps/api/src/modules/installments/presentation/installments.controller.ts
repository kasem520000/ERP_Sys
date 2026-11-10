import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { PlanService } from "../application/plan-service";
import { InstallmentCollectionService } from "../application/collection-service";

/**
 * Installment routes (PHASE-027 §4; matrix §3.12): every route
 * permission-guarded with the exact seeded keys, Idempotency-Key-guarded
 * by the global POST guard, success envelope throughout. Foreign/unknown
 * ids are 404-shaped (A7). Installment collections are ordinary sales
 * receipts (§3.4 keys — no new receipt keys); these routes cover the plan
 * lifecycle + waive + the late-fee charge.
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const UUID = z.string().uuid();
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "non-negative decimal (≤ 4dp)");
const FREQUENCY = z.enum(["WEEKLY", "BIWEEKLY", "MONTHLY", "QUARTERLY"]);
const SOURCE = z.enum(["sales_invoice", "service_contract"]);
const POLICY = z
  .object({
    rate: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
    cap: MONEY.optional(),
    grace_days: z.coerce.number().int().min(0).max(365).optional(),
    auto_charge: z.boolean().optional(),
    defaulted_after_lines: z.coerce.number().int().min(1).max(120).optional(),
  })
  .optional()
  .nullable();

const createPlanSchema = z.object({
  sourceType: SOURCE,
  sourceId: UUID,
  totalAmount: MONEY.nullable().optional(),
  downPayment: MONEY,
  count: z.coerce.number().int().min(1).max(120),
  startDate: DATE,
  frequency: FREQUENCY,
  lateFeePolicy: POLICY,
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
});

const editDraftSchema = z.object({
  downPayment: MONEY.optional(),
  count: z.coerce.number().int().min(1).max(120).optional(),
  startDate: DATE.optional(),
  frequency: FREQUENCY.optional(),
  lateFeePolicy: POLICY,
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
});

const waiveSchema = z.object({ reason: z.string().min(1).max(500) });

@Controller("api/v1/installment-plans")
export class InstallmentsController {
  constructor(
    @Inject(PlanService) private readonly plans: PlanService,
    @Inject(InstallmentCollectionService)
    private readonly collections: InstallmentCollectionService,
  ) {}

  @Get()
  @RequirePermissions("installments.plans.view")
  async list(
    @Req() request: Request,
    @Query("partnerId") partnerId?: string,
    @Query("status") status?: string,
    @Query("sourceType") sourceType?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      await this.plans.listPlans({
        partnerId: partnerId === undefined || partnerId === "" ? undefined : UUID.parse(partnerId),
        status:
          status === undefined || status === ""
            ? undefined
            : status === "DRAFT"
              ? null
              : z.enum(["ACTIVE", "CLOSED", "DEFAULTED"]).parse(status),
        sourceType: sourceType === undefined || sourceType === "" ? undefined : SOURCE.parse(sourceType),
        limit: Math.min(Number(limit ?? "200") || 200, 1000),
      }),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("installments.plans.manage")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createPlanSchema.parse(body);
    return envelope(
      await this.plans.createPlan({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        totalAmount: input.totalAmount ?? null,
        downPayment: input.downPayment,
        count: input.count,
        startDate: input.startDate,
        frequency: input.frequency,
        lateFeePolicy: input.lateFeePolicy ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("installments.plans.view")
  async get(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.plans.getPlan(UUID.parse(id)));
  }

  @Post(":id/activate")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("installments.plans.manage")
  async activate(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.plans.activatePlan(UUID.parse(id), identity.userId));
  }

  @Put(":id")
  @RequirePermissions("installments.plans.manage")
  async editDraft(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = editDraftSchema.parse(body);
    return envelope(
      await this.plans.editDraft(
        UUID.parse(id),
        {
          downPayment: input.downPayment,
          count: input.count,
          startDate: input.startDate,
          frequency: input.frequency,
          lateFeePolicy: input.lateFeePolicy ?? null,
          note: input.note ?? undefined,
          noteAr: input.noteAr ?? undefined,
        },
        identity.userId,
      ),
    );
  }

  @Post(":id/lines/:lineId/waive")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("installments.lines.waive")
  async waive(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    void UUID.parse(id);
    const input = waiveSchema.parse(body);
    return envelope(
      await this.collections.waiveLine({
        lineId: UUID.parse(lineId),
        reason: input.reason,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/lines/:lineId/charge-late-fee")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("installments.plans.manage")
  async chargeLateFee(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
  ) {
    const identity = requireIdentity(request);
    void UUID.parse(id);
    return envelope(
      await this.collections.chargeLateFee({
        lineId: UUID.parse(lineId),
        actorId: identity.userId,
      }),
    );
  }
}
