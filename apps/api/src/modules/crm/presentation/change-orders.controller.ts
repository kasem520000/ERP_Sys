import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ChangeOrderService } from "../application/change-order-service";

/**
 * PHASE-048 (W-10 — T-09) — the change-order routes (BR-094 / G-58 /
 * D-07): the authoring plane (DRAFT/SUBMITTED — INERT, BR-094's gate
 * precedes every effect), THE APPROVAL GATE (approve/reject — the
 * privileged act that applies G-58's exactly-once delta and consumes
 * the single-use stamp), and the re-baselined ceiling read.
 *
 * Permissions (matrix §3.26): the authoring + read plane rides
 * projects.change_order.view (the fourteen-key list ships no
 * change_order.manage — BR-094 makes authoring safe: nothing a DRAFT
 * author can do moves money until an approver acts, so the view key
 * carries the working plane; the dated note at the routes ledger
 * records the reading); the gate rides projects.change_order.approve.
 * The entitlement plane rides the projects.wbs feature flag (D-16).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const createSchema = z.object({
  coNo: z.string().trim().min(1).max(40).nullish(),
  title: z.string().trim().min(1).max(200),
  titleAr: z.string().trim().min(1).max(200).nullish(),
  scopeDelta: z.string().max(4000).nullish(),
  scopeDeltaAr: z.string().max(4000).nullish(),
  priceDelta: z.string().regex(/^-?\d+(\.\d{1,4})?$/, "a SIGNED decimal with ≤ 4dp"),
  scheduleDeltaDays: z.number().int().refine((days) => days !== 0, "non-zero").nullish(),
  note: z.string().max(2000).nullish(),
  noteAr: z.string().max(2000).nullish(),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

@Controller("api/v1/projects")
export class ChangeOrdersController {
  constructor(@Inject(ChangeOrderService) private readonly changeOrders: ChangeOrderService) {}

  @Get(":projectId/change-orders")
  @RequirePermissions("projects.change_order.view")
  @RequireFeature("projects.wbs")
  async list(@Param("projectId") projectId: string) {
    return envelope(await this.changeOrders.list(projectId));
  }

  @Post(":projectId/change-orders")
  @RequirePermissions("projects.change_order.view")
  @RequireFeature("projects.wbs")
  async create(@Req() request: Request, @Param("projectId") projectId: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.changeOrders.create({
        projectId,
        coNo: input.coNo ?? null,
        title: input.title,
        titleAr: input.titleAr ?? null,
        scopeDelta: input.scopeDelta ?? null,
        scopeDeltaAr: input.scopeDeltaAr ?? null,
        priceDelta: input.priceDelta,
        scheduleDeltaDays: input.scheduleDeltaDays ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  /** The re-baselined ceilings, recomputed on every read (the contract
   * register + the APPROVED deltas; BAC = the approved budget + the
   * same deltas — the gate is the only path that moves either). */
  @Get(":projectId/change-orders/ceiling")
  @RequirePermissions("projects.change_order.view")
  @RequireFeature("projects.wbs")
  async ceiling(@Param("projectId") projectId: string) {
    return envelope(await this.changeOrders.ceiling(projectId));
  }

  @Get("change-orders/:id")
  @RequirePermissions("projects.change_order.view")
  @RequireFeature("projects.wbs")
  async get(@Param("id") id: string) {
    return envelope(await this.changeOrders.get(id));
  }

  @Post("change-orders/:id/submit")
  @RequirePermissions("projects.change_order.view")
  @RequireFeature("projects.wbs")
  @HttpCode(HttpStatus.OK)
  async submit(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.changeOrders.submit(id, identity.userId));
  }

  /** THE GATE — approval applies G-58's exactly-once effects (the
   * price-delta posting through the engine + the single-use stamp +
   * the ceiling recompute); the accountant's approval key. */
  @Post("change-orders/:id/approve")
  @RequirePermissions("projects.change_order.approve")
  @RequireFeature("projects.wbs")
  @HttpCode(HttpStatus.OK)
  async approve(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.changeOrders.approve(id, identity.userId));
  }

  @Post("change-orders/:id/reject")
  @RequirePermissions("projects.change_order.approve")
  @RequireFeature("projects.wbs")
  @HttpCode(HttpStatus.OK)
  async reject(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = rejectSchema.parse(body);
    return envelope(await this.changeOrders.reject(id, input.reason, identity.userId));
  }
}
