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
// PHASE-050 (W-27 — T-09 + T-10 + T-11): the SPC + supplier-score + COA planes.
import { SpcService } from "../application/spc-service";
import { SupplierScoreService } from "../application/supplier-score-service";
import { CoaService } from "../application/coa-service";

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

// ── PHASE-050 (W-27 — T-09 + T-10 + T-11): the SPC + supplier-score +
// COA planes (the keys-seed-first THIRD binding wave) ────────────────────────

const spcMeasurementSchema = z.object({
  specId: UUID,
  value: VALUE,
  sampledAt: STAMP,
  source: z.enum(["MANUAL", "PRODUCTION", "INSPECTION"]).optional(),
  batchId: UUID.nullable().optional(),
  note: NOTE,
});

const supplierRecomputeSchema = z.object({
  periodStart: DAY,
});

const coaGenerateSchema = z.object({
  docType: z.enum(["COA", "COC"]),
  itemId: UUID,
  batchId: UUID.nullable().optional(),
  inspectionId: UUID.nullable().optional(),
  parameters: z
    .array(
      z.object({
        specId: UUID,
        value: VALUE,
        ncrId: UUID.nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  note: NOTE,
  noteAr: NOTE,
});

@Controller("/api/v1/quality")
export class QualitySpcController {
  constructor(@Inject(SpcService) private readonly spc: SpcService) {}

  /** The sample store's read (the chart's own history — the provenance
   * read rides the batch filter). */
  @Get("spc/measurements")
  @RequirePermissions("quality.spc.view")
  @RequireFeature("quality.spc")
  listMeasurements(
    @Query("specId") specId?: string,
    @Query("batchId") batchId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      this.spc.listMeasurements({
        specId: specId === undefined || specId === "" ? undefined : specId,
        batchId: batchId === undefined || batchId === "" ? undefined : batchId,
        limit: limit === undefined ? 200 : Math.min(Number(limit) || 200, 500),
      }),
    );
  }

  /** The sample ingestion (the master-data manage key — the 0116
   * grants' own S/I/U discipline; the surface rides quality.spc). */
  @Post("spc/measurements")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("quality.manage")
  @RequireFeature("quality.spc")
  async recordMeasurement(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = spcMeasurementSchema.parse(body);
    return envelope(
      await this.spc.record({
        specId: input.specId,
        value: input.value,
        sampledAt: input.sampledAt,
        source: input.source,
        batchId: input.batchId,
        note: input.note,
        actorId: identity.userId,
      }),
    );
  }

  /** THE CHART READ: the PURE module's output VERBATIM (X-bar/R, Cp/Cpk,
   * the out-of-control flags — D-12's zero-parallel-computation law). */
  @Get("spc/charts/:specId")
  @RequirePermissions("quality.spc.view")
  @RequireFeature("quality.spc")
  async chart(
    @Param("specId") specId: string,
    @Query("subgroupSize") subgroupSize?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.spc.chart(specId, {
        subgroupSize:
          subgroupSize === undefined || subgroupSize === ""
            ? undefined
            : Number(subgroupSize),
        limit: limit === undefined || limit === "" ? undefined : Number(limit),
      }),
    );
  }
}

@Controller("/api/v1/quality")
export class QualitySupplierScoresController {
  constructor(@Inject(SupplierScoreService) private readonly scores: SupplierScoreService) {}

  @Get("supplier-scores")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  listScores(@Query("partnerId") partnerId?: string, @Query("limit") limit?: string) {
    return envelope(
      this.scores.list({
        partnerId: partnerId === undefined || partnerId === "" ? undefined : partnerId,
        limit: limit === undefined ? 200 : Math.min(Number(limit) || 200, 500),
      }),
    );
  }

  /** THE DOCUMENTED 038 FEED CONTRACT's own door (D-13 — the consumer
   * reads, never re-computes): the latest periods for one supplier,
   * VERBATIM. DECLARED BEFORE the recompute route's :partnerId shape
   * never collides (distinct sub-paths). */
  @Get("supplier-scores/:partnerId/feed")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async feed(@Param("partnerId") partnerId: string, @Query("limit") limit?: string) {
    return envelope(
      await this.scores.feed(
        partnerId,
        limit === undefined ? undefined : Math.min(Number(limit) || 12, 24),
      ),
    );
  }

  /** The rolling fold's recompute (the master-data manage key — the
   * fold is rebuildable derived data, the 0115 grants' own shape). */
  @Post("supplier-scores/:partnerId/recompute")
  @RequirePermissions("quality.manage")
  @RequireFeature("quality")
  async recompute(
    @Req() request: Request,
    @Param("partnerId") partnerId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = supplierRecomputeSchema.parse(body);
    return envelope(
      await this.scores.recompute({
        partnerId,
        periodStart: input.periodStart,
        actorId: identity.userId,
      }),
    );
  }
}

@Controller("/api/v1/quality")
export class QualityCoaController {
  constructor(@Inject(CoaService) private readonly coa: CoaService) {}

  @Get("coa")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  listCertificates(
    @Query("itemId") itemId?: string,
    @Query("batchId") batchId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      this.coa.list({
        itemId: itemId === undefined || itemId === "" ? undefined : itemId,
        batchId: batchId === undefined || batchId === "" ? undefined : batchId,
        limit: limit === undefined ? 200 : Math.min(Number(limit) || 200, 500),
      }),
    );
  }

  /** BR-104's own door: the generation gate (the refusal names the
   * parameter and both figures; the frozen snapshot lands verbatim). */
  @Post("coa")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("quality.coa.generate")
  @RequireFeature("quality")
  async generate(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = coaGenerateSchema.parse(body);
    return envelope(
      await this.coa.generate({
        docType: input.docType,
        itemId: input.itemId,
        batchId: input.batchId,
        inspectionId: input.inspectionId,
        parameters: input.parameters,
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  @Get("coa/:id")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async findCertificate(@Param("id") id: string) {
    return envelope(await this.coa.find(id));
  }
}

// ── PHASE-050 (W-28 — T-12 + T-13 + T-14): the complaints · holds · recall
// planes (the keys-seed-first FOURTH binding wave — the 0116-seeded keys
// quality.complaints.manage · quality.hold.manage · quality.recall.manage
// bind here; INV-035's gate is server-side in the movement core, the
// routes are the register's own management surface) ──────────────────────────

// PHASE-050 (W-28 — T-12): the complaints plane.
import { ComplaintService } from "../application/complaint-service";
// PHASE-050 (W-28 — T-13): the holds plane (the register's management
// surface — the BLOCKING side is the shared gate in the movement core).
import { HoldService } from "../application/hold-service";
// PHASE-050 (W-28 — T-14): the recall plane (the drill + the record).
import { RecallService } from "../application/recall-service";

const COMPLAINT_CHANNELS = ["PHONE", "EMAIL", "WALK_IN", "PORTAL", "SOCIAL", "OTHER"] as const;
const COMPLAINT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const createComplaintSchema = z.object({
  channel: z.enum(COMPLAINT_CHANNELS),
  severity: z.enum(COMPLAINT_SEVERITIES).default("MEDIUM"),
  customerId: UUID,
  itemId: UUID.nullish(),
  batchId: UUID.nullish(),
  subject: z.string().min(1).max(500),
  details: NOTE,
  detailsAr: NOTE,
  note: NOTE,
  noteAr: NOTE,
});

const complaintTriageSchema = z.object({
  ncrId: UUID.nullish(),
});

const complaintLinkNcrSchema = z.object({
  ncrId: UUID,
});

const complaintResolveSchema = z.object({
  resolution: TEXT,
});

const createHoldSchema = z.object({
  batchId: UUID,
  reason: TEXT,
  ncrId: UUID.nullish(),
  note: NOTE,
  noteAr: NOTE,
});

const holdReleaseSchema = z.object({
  releaseNote: TEXT,
});

const createRecallSchema = z.object({
  batchId: UUID,
  reason: TEXT,
  note: NOTE,
  noteAr: NOTE,
});

@Controller("/api/v1/quality")
export class QualityComplaintsController {
  constructor(@Inject(ComplaintService) private readonly complaints: ComplaintService) {}

  @Post("complaints")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("quality.complaints.manage")
  @RequireFeature("quality")
  async createComplaint(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createComplaintSchema.parse(body);
    return envelope(
      await this.complaints.create({
        channel: input.channel,
        severity: input.severity,
        customerId: input.customerId,
        itemId: input.itemId ?? null,
        batchId: input.batchId ?? null,
        subject: input.subject,
        details: input.details ?? null,
        detailsAr: input.detailsAr ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("complaints")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async listComplaints(
    @Query("status") status?: string,
    @Query("customerId") customerId?: string,
    @Query("ncrId") ncrId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.complaints.list({
        status,
        customerId,
        ncrId,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  @Get("complaints/:id")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async findComplaint(@Param("id") id: string) {
    return envelope(await this.complaints.find(id));
  }

  @Post("complaints/:id/triage")
  @RequirePermissions("quality.complaints.manage")
  @RequireFeature("quality")
  async triageComplaint(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = complaintTriageSchema.parse(body ?? {});
    return envelope(
      await this.complaints.triage({
        complaintId: id,
        ncrId: input.ncrId ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("complaints/:id/link-ncr")
  @RequirePermissions("quality.complaints.manage")
  @RequireFeature("quality")
  async linkComplaintNcr(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = complaintLinkNcrSchema.parse(body);
    return envelope(
      await this.complaints.linkNcr({
        complaintId: id,
        ncrId: input.ncrId,
        actorId: identity.userId,
      }),
    );
  }

  @Post("complaints/:id/progress")
  @RequirePermissions("quality.complaints.manage")
  @RequireFeature("quality")
  async progressComplaint(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(
      await this.complaints.progress({ complaintId: id, actorId: identity.userId }),
    );
  }

  @Post("complaints/:id/resolve")
  @RequirePermissions("quality.complaints.manage")
  @RequireFeature("quality")
  async resolveComplaint(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = complaintResolveSchema.parse(body);
    return envelope(
      await this.complaints.resolve({
        complaintId: id,
        resolution: input.resolution,
        actorId: identity.userId,
      }),
    );
  }

  @Post("complaints/:id/close")
  @RequirePermissions("quality.complaints.manage")
  @RequireFeature("quality")
  async closeComplaint(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.complaints.close({ complaintId: id, actorId: identity.userId }));
  }
}

@Controller("/api/v1/quality")
export class QualityHoldsController {
  constructor(@Inject(HoldService) private readonly holds: HoldService) {}

  @Post("holds")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("quality.hold.manage")
  @RequireFeature("quality")
  async createHold(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createHoldSchema.parse(body);
    return envelope(
      await this.holds.create({
        batchId: input.batchId,
        reason: input.reason,
        ncrId: input.ncrId ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("holds")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async listHolds(
    @Query("batchId") batchId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.holds.list({
        batchId,
        status: status === "ACTIVE" || status === "RELEASED" ? status : undefined,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  /** The batch's ACTIVE hold — the web banners' own read (W-29). */
  @Get("holds/batch/:batchId")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async findActiveHold(@Param("batchId") batchId: string) {
    return envelope(await this.holds.findActiveByBatch(batchId));
  }

  @Post("holds/:id/release")
  @RequirePermissions("quality.hold.manage")
  @RequireFeature("quality")
  async releaseHold(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = holdReleaseSchema.parse(body);
    return envelope(
      await this.holds.release({
        holdId: id,
        releaseNote: input.releaseNote,
        actorId: identity.userId,
      }),
    );
  }
}

@Controller("/api/v1/quality")
export class QualityRecallController {
  constructor(@Inject(RecallService) private readonly recalls: RecallService) {}

  @Post("recall")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("quality.recall.manage")
  @RequireFeature("quality")
  async initiateRecall(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRecallSchema.parse(body);
    return envelope(
      await this.recalls.initiate({
        batchId: input.batchId,
        reason: input.reason,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("recall")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async listRecalls(
    @Query("status") status?: string,
    @Query("batchId") batchId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.recalls.list({
        status,
        batchId,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  /** THE DRILL QUERY (D-14 — the live read; declared BEFORE the :id
   * route so "drill" never captures an id). */
  @Get("recall/drill/:batchId")
  @RequirePermissions("quality.recall.manage")
  @RequireFeature("quality")
  async drillBatch(@Param("batchId") batchId: string) {
    return envelope(await this.recalls.drill(batchId));
  }

  @Get("recall/:id")
  @RequirePermissions("quality.view")
  @RequireFeature("quality")
  async findRecall(@Param("id") id: string) {
    return envelope(await this.recalls.find(id));
  }

  @Post("recall/:id/execute")
  @RequirePermissions("quality.recall.manage")
  @RequireFeature("quality")
  async executeRecall(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.recalls.execute({ recallId: id, actorId: identity.userId }));
  }

  @Post("recall/:id/close")
  @RequirePermissions("quality.recall.manage")
  @RequireFeature("quality")
  async closeRecall(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.recalls.close({ recallId: id, actorId: identity.userId }));
  }
}
