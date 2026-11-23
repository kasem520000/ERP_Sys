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
  Put,
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
// PHASE-050 (W-26 — T-07 + T-08): the CAPA + calibration planes.
import { CapaService } from "../application/capa-service";
import { CalibrationService } from "../application/calibration-service";
import { QualityCalibrationSweepService } from "../application/quality-calibration-sweep-service";

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

// PHASE-050 (W-26 — T-07 + T-08, dated 2026-11-23): the CAPA + calibration
// planes' own shapes (the 4dp money floor on the external cost — ADR-0009's
// no-binary-float law at the API face; the actions array's canonical cells
// validated by the domain fold at the service floor).
const AMOUNT4 = z.string().regex(/^\d+(\.\d{1,4})?$/, "decimal (≤ 4dp)");
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const STAMP = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "ISO datetime");

const createCapaSchema = z.object({
  title: TEXT,
  ncrId: UUID.nullable().optional(),
  ownerEmployeeId: UUID.nullable().optional(),
  dueDate: DAY.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const capaRootCauseSchema = z.object({
  rootCause: z.string().min(1).max(4000),
});

const capaActionCell = z.object({
  title: z.string().min(1).max(500),
  ownerEmployeeId: UUID.nullable().optional(),
  dueDate: DAY.nullable().optional(),
  completedAt: STAMP.nullable().optional(),
});

const capaActionsSchema = z.object({
  actions: z.array(capaActionCell).max(100),
});

const capaExternalCostSchema = z.object({
  amount: AMOUNT4,
});

const capaCloseSchema = z.object({
  summary: z.string().min(1).max(4000),
  effective: z.boolean(),
  checkedAt: STAMP,
});

const createCalibrationSchema = z.object({
  assetId: UUID,
  standardUsed: SHORT,
  result: z.enum(["PASS", "FAIL", "ADJUSTED"]),
  calibratedAt: STAMP,
  dueDate: DAY,
  providerId: UUID.nullable().optional(),
  certificateRef: SHORT.nullable().optional(),
  externalCost: AMOUNT4.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const calibrationThresholdsSchema = z.object({
  thresholds: z.array(z.number().int().min(0)).min(1).max(12),
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

// ── PHASE-050 (W-26 — T-07): the CAPA plane (BR-103's gate + the G-63 door) ───

@Controller("/api/v1/quality")
export class QualityCapaController {
  constructor(@Inject(CapaService) private readonly capa: CapaService) {}

  @Get("capa")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  listCapas(@Query("status") status?: string, @Query("ncrId") ncrId?: string) {
    return envelope(
      this.capa.list({
        status,
        ncrId: ncrId === undefined || ncrId === "" ? undefined : ncrId,
        limit: 200,
      }),
    );
  }

  @Post("capa")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("quality.capa.manage")
  @RequireFeature("quality")
  async createCapa(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createCapaSchema.parse(body);
    return envelope(
      await this.capa.create({
        title: input.title,
        ncrId: input.ncrId,
        ownerEmployeeId: input.ownerEmployeeId,
        dueDate: input.dueDate,
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  @Get("capa/:id")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async findCapa(@Param("id") id: string) {
    return envelope(await this.capa.find(id));
  }

  /** THE START ACT'S DOOR: the root-cause analysis (OPEN → IN_PROGRESS in
   * the same CAS — the declared W-26 interpretation). */
  @Post("capa/:id/root-cause")
  @RequirePermissions("quality.capa.manage")
  @RequireFeature("quality")
  async recordCapaRootCause(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = capaRootCauseSchema.parse(body);
    return envelope(
      await this.capa.recordRootCause(id, { rootCause: input.rootCause, actorId: identity.userId }),
    );
  }

  /** The actions array's door (the canonical cells validated by the
   * domain fold at the service floor). */
  @Post("capa/:id/actions")
  @RequirePermissions("quality.capa.manage")
  @RequireFeature("quality")
  async recordCapaActions(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = capaActionsSchema.parse(body);
    return envelope(
      await this.capa.recordActions(id, {
        actions: input.actions.map((cell) => ({
          title: cell.title,
          ownerEmployeeId: cell.ownerEmployeeId ?? null,
          dueDate: cell.dueDate ?? null,
          completedAt: cell.completedAt ?? null,
        })),
        actorId: identity.userId,
      }),
    );
  }

  /** THE G-63 ACT'S DOOR: the external service cost (DR QUALITY_EXPENSE ·
   * CR EXTERNAL_ACCRUAL through the REAL engine, fail-closed, exactly
   * once). */
  @Post("capa/:id/external-cost")
  @RequirePermissions("quality.capa.manage")
  @RequireFeature("quality")
  async recordCapaExternalCost(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = capaExternalCostSchema.parse(body);
    return envelope(
      await this.capa.recordExternalCost(id, { amount: input.amount, actorId: identity.userId }),
    );
  }

  /** BR-103's own door: the close with the effectiveness check (every
   * open window elapsed — the typed refusals carry the figures). */
  @Post("capa/:id/close")
  @RequirePermissions("quality.capa.manage")
  @RequireFeature("quality")
  async closeCapa(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = capaCloseSchema.parse(body);
    return envelope(
      await this.capa.close(id, {
        summary: input.summary,
        effective: input.effective,
        checkedAt: input.checkedAt,
        actorId: identity.userId,
      }),
    );
  }
}

// ── PHASE-050 (W-26 — T-08): the calibration plane (D-08's binding + the
// sweep's settings surface) ────────────────────────────────────────────────────

@Controller("/api/v1/quality")
export class QualityCalibrationController {
  constructor(
    @Inject(CalibrationService) private readonly calibration: CalibrationService,
    @Inject(QualityCalibrationSweepService)
    private readonly sweep: QualityCalibrationSweepService,
  ) {}

  @Get("calibration")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  listCalibrations(@Query("assetId") assetId?: string) {
    return envelope(
      this.calibration.list({
        assetId: assetId === undefined || assetId === "" ? undefined : assetId,
        limit: 200,
      }),
    );
  }

  @Post("calibration")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("quality.calibration.manage")
  @RequireFeature("quality")
  async createCalibration(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createCalibrationSchema.parse(body);
    return envelope(
      await this.calibration.create({
        assetId: input.assetId,
        standardUsed: input.standardUsed,
        result: input.result,
        calibratedAt: input.calibratedAt,
        dueDate: input.dueDate,
        providerId: input.providerId,
        certificateRef: input.certificateRef,
        externalCost: input.externalCost,
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  /** The sweep's effective ladder (stored ∪ the documented default
   * [30,7,0], normalized by the pure fold) + the last run's seal (the
   * audit plane is the job log). DECLARED BEFORE the :id route so the
   * path never swallows it as an id. */
  @Get("calibration/sweep-config")
  @RequirePermissions("quality.calibration.manage")
  @RequireFeature("quality")
  async getSweepConfig() {
    return envelope(await this.sweep.effectiveConfig());
  }

  /** The audited thresholds write — the same registry validation, the
   * same tenant_settings row, the same invalidation event as the
   * generic settings surface (one data home; the wave's own named
   * refusal). */
  @Put("calibration/sweep-config")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("quality.calibration.manage")
  @RequireFeature("quality")
  async putSweepConfig(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = calibrationThresholdsSchema.parse(body);
    return envelope(
      await this.sweep.writeThresholds({
        thresholds: input.thresholds,
        actorId: identity.userId,
      }),
    );
  }

  @Get("calibration/:id")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async findCalibration(@Param("id") id: string) {
    return envelope(await this.calibration.find(id));
  }
}
