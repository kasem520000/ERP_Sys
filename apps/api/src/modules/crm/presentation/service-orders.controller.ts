import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ServiceOrderService } from "../application/service-order-service";
import { ServiceOrderPosting } from "../application/service-order-posting";

/**
 * Service-order routes (PHASE-019 T48; MASTER-PLAN §11 rows 37–45): the
 * job-card lifecycle generalized to the crm module. Every route is
 * permission-guarded (the seeded `crm.service_orders.manage` key — the
 * lifecycle's single manage key), BR-039 feature-gated on
 * `crm.service_orders`, Idempotency-Key'd by the global POST guard, and
 * returns the success envelope. Foreign or unknown ids are 404-shaped (A7 —
 * no existence disclosure). Money/qty/hours travel as decimal strings
 * (ADR-0009). The parts issue policy is an approve-time body choice
 * (`reserve` default | `issue_immediate`).
 *
 * The controller is the port's registration point — the posting port
 * (issue_immediate COGS at approval, completion invoicing) is injected here
 * and registered on the service at construction, before any request can
 * reach the lifecycle (the JobCardsController precedent).
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
const TEXT500 = z.string().min(1).max(500).nullable().optional();
const LIMIT = z.coerce.number().int().min(1).max(500);

const lineSchema = z.object({
  /** Preserved on the PUT full-replace; ignored on create. */
  id: UUID.nullable().optional(),
  lineType: z.enum(["SERVICE", "PARTS"]),
  itemId: UUID,
  /** PARTS only (required > 0). SERVICE lines bill estimatedHours. */
  qty: QTY.nullable().optional(),
  unitPrice: PRICE.nullable().optional(),
  /** SERVICE only (required > 0 — the billed quantity). */
  estimatedHours: HOURS.nullable().optional(),
  description: TEXT500,
  descriptionAr: TEXT500,
  note: TEXT500,
});

const createSchema = z.object({
  branchId: UUID,
  partnerId: UUID,
  contractId: UUID.nullable().optional(),
  warehouseId: UUID,
  note: TEXT500,
  noteAr: TEXT500,
  lines: z.array(lineSchema).min(1).max(200),
});

const patchSchema = z.object({
  note: TEXT500,
  noteAr: TEXT500,
  /** Full line-set replace (DRAFT only); provided line ids are preserved. */
  lines: z.array(lineSchema).min(1).max(200).optional(),
});

const reasonSchema = z.object({ reason: z.string().min(1).max(500) });
const logHoursSchema = z.object({ lineId: UUID, hours: HOURS });
/** The parts issue policy is an APPROVE-TIME choice (0027 has no
 * parts_issue_mode column — the DDL is binding; the persisted line stamps
 * carry it forward). Default `reserve` — the job-card default branch. */
const approveSchema = z.object({
  partsIssueMode: z.enum(["reserve", "issue_immediate"]).default("reserve"),
});

function toServiceLine(line: z.infer<typeof lineSchema>) {
  return {
    id: line.id ?? null,
    lineType: line.lineType,
    itemId: line.itemId,
    qty: line.qty ?? null,
    unitPrice: line.unitPrice ?? null,
    estimatedHours: line.estimatedHours ?? null,
    description: line.description ?? null,
    descriptionAr: line.descriptionAr ?? null,
    note: line.note ?? null,
  };
}

@Controller("api/v1/crm")
export class ServiceOrdersController {
  constructor(
    @Inject(ServiceOrderService) private readonly serviceOrders: ServiceOrderService,
    // Explicit @Inject — the vitest/esbuild pipeline does not emit
    // design:paramtypes (the ContractService note).
    @Inject(ServiceOrderPosting) posting: ServiceOrderPosting,
  ) {
    // The port wiring: register the posting port before the first request
    // (the JobCardsController precedent).
    this.serviceOrders.setPostingPort(posting);
  }

  @Get("service-orders")
  @RequirePermissions("crm.service_orders.manage")
  @RequireFeature("crm.service_orders")
  async list(
    @Query("status") status?: string,
    @Query("contractId") contractId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.serviceOrders.list({
        status,
        contractId: contractId && UUID.safeParse(contractId).success ? contractId : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("service-orders")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("crm.service_orders.manage")
  @RequireFeature("crm.service_orders")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.serviceOrders.create({
        branchId: input.branchId,
        partnerId: input.partnerId,
        contractId: input.contractId ?? null,
        warehouseId: input.warehouseId,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
        lines: input.lines.map(toServiceLine),
      }),
    );
  }

  @Get("service-orders/:id")
  @RequirePermissions("crm.service_orders.manage")
  @RequireFeature("crm.service_orders")
  async get(@Param("id") id: string) {
    return envelope(await this.serviceOrders.findWithLines(id));
  }

  @Put("service-orders/:id")
  @RequirePermissions("crm.service_orders.manage")
  @RequireFeature("crm.service_orders")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = patchSchema.parse(body ?? {});
    return envelope(
      await this.serviceOrders.update(id, {
        note: input.note ?? undefined,
        noteAr: input.noteAr ?? undefined,
        lines: input.lines?.map(toServiceLine),
        actorId: identity.userId,
      }),
    );
  }

  @Post("service-orders/:id/approve")
  @RequirePermissions("crm.service_orders.manage")
  @RequireFeature("crm.service_orders")
  async approve(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = approveSchema.parse(body ?? {});
    return envelope(
      await this.serviceOrders.approve(id, {
        partsIssueMode: input.partsIssueMode,
        actorId: identity.userId,
      }),
    );
  }

  @Post("service-orders/:id/log-hours")
  @RequirePermissions("crm.service_orders.manage")
  @RequireFeature("crm.service_orders")
  async logHours(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = logHoursSchema.parse(body);
    return envelope(
      await this.serviceOrders.logHours(id, input.lineId, {
        hours: input.hours,
        actorId: identity.userId,
      }),
    );
  }

  @Post("service-orders/:id/complete")
  @RequirePermissions("crm.service_orders.manage")
  @RequireFeature("crm.service_orders")
  async complete(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.serviceOrders.complete(id, { actorId: identity.userId }));
  }

  @Post("service-orders/:id/invoice")
  @RequirePermissions("crm.service_orders.manage")
  @RequireFeature("crm.service_orders")
  async invoice(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.serviceOrders.invoice(id, { actorId: identity.userId }));
  }

  @Post("service-orders/:id/cancel")
  @RequirePermissions("crm.service_orders.manage")
  @RequireFeature("crm.service_orders")
  async cancel(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(await this.serviceOrders.cancel(id, { reason, actorId: identity.userId }));
  }
}
