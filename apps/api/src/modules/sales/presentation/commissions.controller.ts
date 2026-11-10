import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { CommissionService } from "../commissions/application/commission-service";

/**
 * Commission routes (PHASE-017 T7-a; matrix §3.2/§3.8): per-rep commission
 * rules + commission runs. Every route is permission-guarded (the seeded
 * `sales.commissions.manage` key) and feature-gated on `sales.commissions`,
 * Idempotency-Key'd by the global POST guard, and returns the success
 * envelope. Foreign or unknown ids are 404-shaped (A7 — no existence
 * disclosure). Money/rates travel as decimal strings (ADR-0009).
 *
 * Create = create + compute in one call (the registered route set has no
 * separate compute endpoint — the POST body carries the period; the run
 * lands DRAFT with computed lines, and `:id/post` is the accrual point).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const RATE = z.string().regex(/^\d+(\.\d{1,4})?$/, "percentage decimal (≤ 4dp)").nullable().optional();
const AMOUNT = z.string().regex(/^\d+(\.\d{1,4})?$/, "amount decimal (≤ 4dp)");
const TEXT500 = z.string().min(1).max(500).nullable().optional();

const tierBandSchema = z.object({
  /** The band's exclusive upper bound; null = the open last band. */
  upTo: AMOUNT.nullable(),
  rate: z.string().regex(/^\d+(\.\d{1,4})?$/, "percentage decimal (≤ 4dp)"),
});

const ruleSchema = z
  .object({
    method: z.enum(["NONE", "PERCENTAGE"]),
    rate: RATE,
    basis: z.enum(["INVOICED", "COLLECTED"]).optional(),
    tiers: z.array(tierBandSchema).max(20).nullable().optional(),
  })
  .refine((rule) => !(rule.method === "NONE" && rule.rate !== null && rule.rate !== undefined), {
    message: "method NONE carries no rate",
  });

const createRunSchema = z.object({
  periodFrom: DATE,
  periodTo: DATE,
  basis: z.enum(["INVOICED", "COLLECTED"]),
  note: TEXT500,
  noteAr: TEXT500,
});

const reasonSchema = z.object({ reason: z.string().min(1).max(500) });

@Controller("api/v1/sales")
export class CommissionsController {
  constructor(@Inject(CommissionService) private readonly commissions: CommissionService) {}

  @Get("reps/:id/commission-rule")
  @RequirePermissions("sales.commissions.manage")
  @RequireFeature("sales.commissions")
  async getRule(@Param("id") id: string) {
    return envelope(await this.commissions.getRule(UUID.parse(id)));
  }

  @Put("reps/:id/commission-rule")
  @RequirePermissions("sales.commissions.manage")
  @RequireFeature("sales.commissions")
  async setRule(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = ruleSchema.parse(body);
    return envelope(
      await this.commissions.setRule(
        UUID.parse(id),
        {
          method: input.method,
          rate: input.rate ?? null,
          basis: input.basis,
          tiers: input.tiers ?? null,
        },
        identity.userId,
      ),
    );
  }

  @Get("commission-runs")
  @RequirePermissions("sales.commissions.manage")
  @RequireFeature("sales.commissions")
  async list(@Query("status") status?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.commissions.list({
        status,
        limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 100),
      }),
    );
  }

  @Post("commission-runs")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("sales.commissions.manage")
  @RequireFeature("sales.commissions")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRunSchema.parse(body);
    return envelope(
      await this.commissions.createRun({
        periodFrom: input.periodFrom,
        periodTo: input.periodTo,
        basis: input.basis,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("commission-runs/:id")
  @RequirePermissions("sales.commissions.manage")
  @RequireFeature("sales.commissions")
  async get(@Param("id") id: string) {
    return envelope(await this.commissions.findWithLines(UUID.parse(id)));
  }

  @Post("commission-runs/:id/post")
  @RequirePermissions("sales.commissions.manage")
  @RequireFeature("sales.commissions")
  async post(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.commissions.post(UUID.parse(id), identity.userId));
  }

  @Post("commission-runs/:id/cancel")
  @RequirePermissions("sales.commissions.manage")
  @RequireFeature("sales.commissions")
  async cancel(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(await this.commissions.cancel(UUID.parse(id), { reason, actorId: identity.userId }));
  }
}
