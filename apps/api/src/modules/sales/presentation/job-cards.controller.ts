import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { JobCardService } from "../job-cards/application/job-card-service";
import { JobCardPosting } from "../job-cards/application/posting/job-card-posting";

/**
 * Job-card routes (PHASE-017 T3; matrix §3.2/§3.8): the workshop work
 * order as a sales-module document. Every route is permission-guarded
 * (the seeded `sales.job_cards.manage` key — the lifecycle's single
 * manage key; posting runs through the sales invoice chain's own keys in
 * T4), BR-039 feature-gated on `sales.job_cards`, Idempotency-Key'd by
 * the global POST guard, and returns the success envelope. Foreign or
 * unknown ids are 404-shaped (A7 — no existence disclosure). Money/qty/
 * hours travel as decimal strings (ADR-0009).
 *
 * PHASE-017 T4-a: the controller is the port's registration point — the
 * posting port (issue_immediate COGS at approval, completion invoicing,
 * warranty credit notes) is injected here and registered on the service
 * at construction, before any request can reach the lifecycle.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)");
const PRICE = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal (≤ 6dp)");
const HOURS = z.string().regex(/^\d+(\.\d{1,6})?$/, "hours decimal (≤ 6dp)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "money decimal (≤ 4dp)");
const DATETIME = z.string().datetime().nullable().optional();
const TEXT300 = z.string().min(1).max(300).nullable().optional();
const TEXT500 = z.string().min(1).max(500).nullable().optional();

const lineSchema = z.object({
  /** Preserved on the PUT full-replace; ignored on create. */
  id: UUID.nullable().optional(),
  lineType: z.enum(["PARTS", "LABOR"]),
  itemId: UUID,
  qty: QTY,
  unitPrice: PRICE.nullable().optional(),
  estimatedHours: HOURS.nullable().optional(),
  discountAmount: MONEY.nullable().optional(),
  taxCodeId: UUID.nullable().optional(),
  description: TEXT300,
  descriptionAr: TEXT300,
  note: TEXT300,
});

const createSchema = z.object({
  branchId: UUID,
  customerId: UUID,
  vehicleId: UUID.nullable().optional(),
  warehouseId: UUID,
  partsIssueMode: z.enum(["reserve", "issue_immediate"]).default("reserve"),
  complaints: TEXT500,
  complaintsAr: TEXT500,
  odometerKm: QTY.nullable().optional(),
  checkedInAt: DATETIME,
  note: TEXT500,
  noteAr: TEXT500,
  lines: z.array(lineSchema).min(1).max(200),
});

const patchSchema = z.object({
  complaints: TEXT500,
  complaintsAr: TEXT500,
  diagnosis: TEXT500,
  diagnosisAr: TEXT500,
  note: TEXT500,
  noteAr: TEXT500,
  odometerKm: QTY.nullable().optional(),
  /** Full line-set replace (DRAFT only); provided line ids are preserved. */
  lines: z.array(lineSchema).min(1).max(200).optional(),
});

const reasonSchema = z.object({ reason: z.string().min(1).max(500) });
const hoursSchema = z.object({ hours: HOURS });

function toServiceLine(line: z.infer<typeof lineSchema>) {
  return {
    id: line.id ?? null,
    lineType: line.lineType,
    itemId: line.itemId,
    qty: line.qty,
    unitPrice: line.unitPrice ?? null,
    estimatedHours: line.estimatedHours ?? null,
    discountAmount: line.discountAmount ?? null,
    taxCodeId: line.taxCodeId ?? null,
    description: line.description ?? null,
    descriptionAr: line.descriptionAr ?? null,
    note: line.note ?? null,
  };
}

@Controller("api/v1/sales/job-cards")
export class JobCardsController {
  constructor(
    @Inject(JobCardService) private readonly jobCards: JobCardService,
    posting: JobCardPosting,
  ) {
    // T4-a wiring: register the posting port before the first request.
    this.jobCards.setPostingPort(posting);
  }

  @Get("")
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async list(
    @Query("status") status?: string,
    @Query("customerId") customerId?: string,
    @Query("vehicleId") vehicleId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.jobCards.list({
        status,
        customerId: customerId && z.string().uuid().safeParse(customerId).success ? customerId : undefined,
        vehicleId: vehicleId && z.string().uuid().safeParse(vehicleId).success ? vehicleId : undefined,
        limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 100),
      }),
    );
  }

  @Post("")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.jobCards.create({
        branchId: input.branchId,
        customerId: input.customerId,
        vehicleId: input.vehicleId ?? null,
        warehouseId: input.warehouseId,
        partsIssueMode: input.partsIssueMode,
        complaints: input.complaints ?? null,
        complaintsAr: input.complaintsAr ?? null,
        odometerKm: input.odometerKm ?? null,
        checkedInAt: input.checkedInAt ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
        lines: input.lines.map(toServiceLine),
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async get(@Param("id") id: string) {
    return envelope(await this.jobCards.findWithLines(id));
  }

  @Put(":id")
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = patchSchema.parse(body ?? {});
    return envelope(
      await this.jobCards.update(id, {
        complaints: input.complaints ?? undefined,
        complaintsAr: input.complaintsAr ?? undefined,
        diagnosis: input.diagnosis ?? undefined,
        diagnosisAr: input.diagnosisAr ?? undefined,
        note: input.note ?? undefined,
        noteAr: input.noteAr ?? undefined,
        odometerKm: input.odometerKm ?? undefined,
        lines: input.lines?.map(toServiceLine),
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/quotation")
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async generateQuotation(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.jobCards.generateQuotation(id, { actorId: identity.userId }));
  }

  @Post(":id/approve")
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async approve(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.jobCards.approve(id, { actorId: identity.userId }));
  }

  @Post(":id/complete")
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async complete(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.jobCards.complete(id, { actorId: identity.userId }));
  }

  @Post(":id/invoice")
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async invoice(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.jobCards.invoice(id, { actorId: identity.userId }));
  }

  @Post(":id/cancel")
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async cancel(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(await this.jobCards.cancel(id, { reason, actorId: identity.userId }));
  }

  @Post(":id/lines/:lineId/log-hours")
  @RequirePermissions("sales.job_cards.manage")
  @RequireFeature("sales.job_cards")
  async logHours(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const { hours } = hoursSchema.parse(body);
    return envelope(await this.jobCards.logHours(id, lineId, { hours, actorId: identity.userId }));
  }
}
