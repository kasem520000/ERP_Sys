import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { InspectionService } from "../application/inspection-service";

/**
 * Inspection routes (PHASE-018 §9 rows 22–24; MASTER-PLAN §4): the QC gate's
 * decision surface — list/read/create under the seeded `manufacturing.qc.manage`
 * key, BR-039 feature-gated on `manufacturing.qc`, requireIdentity, the global
 * Idempotency-Key POST guard, and the success envelope throughout. Foreign or
 * unknown ids are 404-shaped (A7). A create carries the side effects the
 * disposition dictates (quarantine release — no journal; FAIL+SCRAP — the
 * qc_scrap journal + stock issue), so each POST is its own business event.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const LIMIT = z.coerce.number().int().min(1).max(500);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const NOTE = z.string().min(1).max(500).nullable().optional();
const TARGET_TYPE = z.enum(["production_order", "goods_receipt"]).optional();

const createSchema = z.object({
  targetType: z.enum(["production_order", "goods_receipt"]),
  orderId: UUID.nullable().optional(),
  grnId: UUID.nullable().optional(),
  result: z.enum(["PASS", "FAIL"]),
  sampled: z.boolean().optional(),
  sampleSize: z.number().int().min(1).max(2_000_000_000).nullable().optional(),
  disposition: z
    .enum(["ACCEPT", "SCRAP", "REWORK", "RETURN_TO_SUPPLIER"])
    .nullable()
    .optional(),
  inspectedAt: DATE.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

@Controller("api/v1/manufacturing/inspections")
export class InspectionsController {
  constructor(@Inject(InspectionService) private readonly inspections: InspectionService) {}

  @Get("")
  @RequirePermissions("manufacturing.qc.manage")
  @RequireFeature("manufacturing.qc")
  async list(
    @Query("targetType") targetType?: string,
    @Query("orderId") orderId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.inspections.list({
        targetType: TARGET_TYPE.parse(targetType ?? undefined),
        orderId: orderId && UUID.safeParse(orderId).success ? orderId : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("manufacturing.qc.manage")
  @RequireFeature("manufacturing.qc")
  async get(@Param("id") id: string) {
    return envelope(await this.inspections.find(id));
  }

  @Post("")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.qc.manage")
  @RequireFeature("manufacturing.qc")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.inspections.create({
        targetType: input.targetType,
        orderId: input.orderId ?? null,
        grnId: input.grnId ?? null,
        result: input.result,
        sampled: input.sampled ?? false,
        sampleSize: input.sampleSize ?? null,
        disposition: input.disposition ?? null,
        inspectedAt: input.inspectedAt ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
