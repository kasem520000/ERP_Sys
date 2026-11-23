import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { NcrService } from "../application/ncr-service";
import { SpecificationService } from "../application/specification-service";

/**
 * PHASE-050 (W-25 — T-05 + T-06, 2026-11-23) the quality routes (matrix
 * §3.28): every route is permission-guarded with the exact 0116-seeded
 * keys (the keys-seed-first discipline's FIRST binding wave — the keys
 * landed at W-24, the routes bind as the service waves ship, every change
 * dated at the ROUTE_PERMISSIONS block) and feature-gated on the
 * whole-module `quality` key (D-04 — the declared neutral zero means a
 * STARTER tenant sees the feature-gated refusal, the entitlements
 * guard's own envelope). Foreign/unknown ids are 404-shaped (A7 — RLS
 * makes them indistinguishable). The disposition route is the G-62
 * act's door: the gate's refusals (the ladder, the on-hand floor, the
 * unmapped-purpose fail-closed) surface as typed envelopes.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const TEXT = z.string().min(1).max(2000);
const NOTE = z.string().max(2000).nullable().optional();
const SHORT = z.string().min(1).max(120);
const UNIT = z.string().min(1).max(16).nullable().optional();
const VALUE = z.string().regex(/^-?\d+(\.\d{1,6})?$/, "decimal (≤ 6dp)");
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal (≤ 6dp)");
const SEVERITY = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM");
const SOURCE = z.enum(["INSPECTION", "PRODUCTION", "COMPLAINT", "SUPPLIER"]);
const DISPOSITION = z.enum(["REWORK", "SCRAP", "ACCEPT", "RETURN_TO_SUPPLIER"]);

const createSpecSchema = z.object({
  itemId: UUID,
  parameter: SHORT,
  parameterAr: NOTE,
  unit: UNIT,
  targetValue: VALUE,
  ucl: VALUE.nullable().optional(),
  lcl: VALUE.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const updateSpecSchema = z
  .object({
    parameterAr: NOTE,
    unit: UNIT,
    targetValue: VALUE.optional(),
    ucl: VALUE.nullable().optional(),
    lcl: VALUE.nullable().optional(),
    isActive: z.boolean().optional(),
    note: NOTE,
    noteAr: NOTE,
  })
  .refine(
    (value) =>
      value.ucl === undefined ||
      value.lcl === undefined ||
      value.ucl === null ||
      value.lcl === null ||
      Number(value.ucl) > Number(value.lcl),
    { message: "the tolerance band must be real: UCL > LCL (a point or inverted band is refused)" },
  );

const createNcrSchema = z.object({
  source: SOURCE,
  severity: SEVERITY,
  itemId: UUID,
  batchId: UUID.nullable().optional(),
  inspectionId: UUID.nullable().optional(),
  partnerId: UUID.nullable().optional(),
  problem: TEXT,
  problemAr: NOTE,
  affectedQty: QTY,
  note: NOTE,
  noteAr: NOTE,
});

const dispositionSchema = z.object({
  disposition: DISPOSITION,
});

@Controller("/api/v1/quality")
export class QualitySpecificationsController {
  constructor(
    @Inject(SpecificationService) private readonly specifications: SpecificationService,
  ) {}

  @Get("specifications")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  listSpecifications(
    @Query("itemId") itemId?: string,
    @Query("activeOnly") activeOnly?: string,
  ) {
    return envelope(
      this.specifications.list({
        itemId: itemId === undefined || itemId === "" ? undefined : itemId,
        activeOnly: activeOnly === "true",
        limit: 200,
      }),
    );
  }

  @Post("specifications")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("quality.manage")
  @RequireFeature("quality")
  async createSpecification(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSpecSchema.parse(body);
    return envelope(
      await this.specifications.create({
        itemId: input.itemId,
        parameter: input.parameter,
        parameterAr: input.parameterAr,
        unit: input.unit,
        targetValue: input.targetValue,
        ucl: input.ucl,
        lcl: input.lcl,
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  @Get("specifications/:id")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async findSpecification(@Param("id") id: string) {
    return envelope(await this.specifications.find(id));
  }

  @Patch("specifications/:id")
  @RequirePermissions("quality.manage")
  @RequireFeature("quality")
  async updateSpecification(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const patch = updateSpecSchema.parse(body);
    return envelope(
      await this.specifications.update(
        id,
        {
          parameterAr: patch.parameterAr,
          unit: patch.unit,
          targetValue: patch.targetValue,
          ucl: patch.ucl,
          lcl: patch.lcl,
          isActive: patch.isActive,
          note: patch.note,
          noteAr: patch.noteAr,
        },
        identity.userId,
      ),
    );
  }

  @Delete("specifications/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("quality.manage")
  @RequireFeature("quality")
  async removeSpecification(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.specifications.remove(id, identity.userId);
  }

  /**
   * THE INSPECTION-RESULT MAPPING CONTRACT's read route (the plan W-25's
   * documented contract — the engines' own rows, zero parallel
   * computation).
   */
  @Get("inspections/:inspectionId/map")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async inspectionMap(@Param("inspectionId") inspectionId: string) {
    return envelope(await this.specifications.inspectionMap(inspectionId));
  }
}

@Controller("/api/v1/quality")
export class QualityNcrController {
  constructor(@Inject(NcrService) private readonly ncr: NcrService) {}

  @Get("ncr")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  listNcrs(
    @Query("status") status?: string,
    @Query("itemId") itemId?: string,
    @Query("batchId") batchId?: string,
    @Query("source") source?: string,
  ) {
    return envelope(
      this.ncr.list({
        status,
        itemId: itemId === undefined || itemId === "" ? undefined : itemId,
        batchId: batchId === undefined || batchId === "" ? undefined : batchId,
        source,
        limit: 200,
      }),
    );
  }

  @Post("ncr")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("quality.ncr.manage")
  @RequireFeature("quality")
  async createNcr(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createNcrSchema.parse(body);
    return envelope(
      await this.ncr.create({
        source: input.source,
        severity: input.severity,
        itemId: input.itemId,
        batchId: input.batchId,
        inspectionId: input.inspectionId,
        partnerId: input.partnerId,
        problem: input.problem,
        problemAr: input.problemAr,
        affectedQty: input.affectedQty,
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  @Get("ncr/:id")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async findNcr(@Param("id") id: string) {
    return envelope(await this.ncr.find(id));
  }

  /** THE G-62 ACT'S DOOR: the disposition (BR-102's ladder step + the
   * SCRAP write-off through the REAL engine). */
  @Post("ncr/:id/disposition")
  @RequirePermissions("quality.ncr.manage")
  @RequireFeature("quality")
  async dispositionNcr(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = dispositionSchema.parse(body);
    return envelope(await this.ncr.disposition(id, { disposition: input.disposition, actorId: identity.userId }));
  }

  @Post("ncr/:id/close")
  @RequirePermissions("quality.ncr.manage")
  @RequireFeature("quality")
  async closeNcr(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.ncr.close(id, identity.userId));
  }
}
