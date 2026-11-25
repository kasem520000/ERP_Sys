import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
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
import { BondedService } from "../application/bonded-service";
import { DrawbackService } from "../application/drawback-service";

/**
 * PHASE-051 (W-38 — T-11 + T-12, 2026-11-25) the trade bonded/drawback
 * routes (matrix §3.29, the keys-seed-first discipline's FIFTH trade
 * binding wave — the keys landed at W-33 (0122 §5), the routes bind as
 * the service waves ship, every change dated at the
 * ROUTE_PERMISSIONS block): the bonded register's reads bind
 * trade.view (the finance-read plane) and its acts bind
 * trade.bonded.manage (the in-bond transfer + the release — G-66's
 * moves); the drawback register's reads bind trade.view and its
 * workflow binds trade.drawback.manage (BR-108's gate). The routes are
 * feature-gated at the controller on the whole-module unit `trade`
 * (D-04 — the bonded/drawback family carries no own flag). Foreign or
 * unknown ids are 404-shaped (A7 — RLS makes them indistinguishable).
 * The execute act's own summary (the duty recognized + the journal +
 * the transfer journal) rides the response envelope — the W-39 bonded
 * surfaces render the same figures.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const NOTE = z.string().max(2000).nullable().optional();
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "a positive decimal (≤ 6dp)");
const COST = z.string().regex(/^\d+(\.\d{1,6})?$/, "a non-negative decimal (≤ 6dp)");

const bondedLineSchema = z.object({
  itemId: UUID,
  qty: QTY,
  unitCost: COST.nullable().optional(),
});

const createBondedMoveSchema = z.object({
  moveKind: z.enum(["IN_BOND", "RELEASE"]),
  fromWarehouseId: UUID.nullable().optional(),
  toWarehouseId: UUID.nullable().optional(),
  declarationId: UUID.nullable().optional(),
  lines: z.array(bondedLineSchema).min(1).max(200),
  note: NOTE,
  noteAr: NOTE,
});

const executeBondedMoveSchema = z.object({
  exchangeRate: z
    .string()
    .regex(/^\d+(\.\d{1,8})?$/, "a positive decimal (≤ 8dp)")
    .nullable()
    .optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "an ISO date").nullable().optional(),
});

const createDrawbackClaimSchema = z.object({
  exportDeclarationId: UUID.nullable().optional(),
  exportBillOfLadingId: UUID.nullable().optional(),
  claimedAmount: z.string().regex(/^\d+(\.\d{1,4})?$/, "a positive decimal (≤ 4dp)"),
  currency: z.string().regex(/^[A-Z]{3}$/, "an ISO-4217 code"),
  note: NOTE,
  noteAr: NOTE,
});

const linkDrawbackEvidenceSchema = z.object({
  exportDeclarationId: UUID.nullable().optional(),
  exportBillOfLadingId: UUID.nullable().optional(),
});

const actSchema = z.object({ reason: z.string().min(1).max(2000).optional() });

@Controller("/api/v1/trade")
export class TradeBondedController {
  constructor(
    @Inject(BondedService) private readonly bonded: BondedService,
    @Inject(DrawbackService) private readonly drawback: DrawbackService,
  ) {}

  // ── the bonded register (G-66's moves + BR-107's release) ───────────

  @Get("bonded/moves")
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  listBondedMoves(
    @Query("moveKind") moveKind?: string,
    @Query("status") status?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("declarationId") declarationId?: string,
  ) {
    return envelope(
      this.bonded.list({
        moveKind: moveKind === undefined || moveKind === "" ? undefined : moveKind,
        status: status === undefined || status === "" ? undefined : status,
        warehouseId: warehouseId === undefined || warehouseId === "" ? undefined : warehouseId,
        declarationId: declarationId === undefined || declarationId === "" ? undefined : declarationId,
      }),
    );
  }

  @Get("bonded/moves/:id")
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  async findBondedMove(@Param("id") id: string) {
    return envelope(await this.bonded.find(id));
  }

  @Post("bonded/moves")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.bonded.manage")
  @RequireFeature("trade")
  async createBondedMove(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createBondedMoveSchema.parse(body);
    return envelope(
      await this.bonded.create({
        moveKind: input.moveKind,
        fromWarehouseId: input.fromWarehouseId ?? null,
        toWarehouseId: input.toWarehouseId ?? null,
        declarationId: input.declarationId ?? null,
        lines: input.lines,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("bonded/moves/:id/execute")
  @RequirePermissions("trade.bonded.manage")
  @RequireFeature("trade")
  async executeBondedMove(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = executeBondedMoveSchema.parse(body ?? {});
    return envelope(
      await this.bonded.execute({
        id,
        exchangeRate: input.exchangeRate ?? null,
        entryDate: input.entryDate ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // ── the drawback register (BR-108's workflow) ───────────────────────

  @Get("drawback/claims")
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  listDrawbackClaims(@Query("status") status?: string) {
    return envelope(
      this.drawback.list({
        status: status === undefined || status === "" ? undefined : status,
      }),
    );
  }

  @Get("drawback/claims/:id")
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  async findDrawbackClaim(@Param("id") id: string) {
    return envelope(await this.drawback.find(id));
  }

  @Post("drawback/claims")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.drawback.manage")
  @RequireFeature("trade")
  async createDrawbackClaim(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createDrawbackClaimSchema.parse(body);
    return envelope(
      await this.drawback.create({
        exportDeclarationId: input.exportDeclarationId ?? null,
        exportBillOfLadingId: input.exportBillOfLadingId ?? null,
        claimedAmount: input.claimedAmount,
        currency: input.currency,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("drawback/claims/:id/evidence")
  @RequirePermissions("trade.drawback.manage")
  @RequireFeature("trade")
  async linkDrawbackEvidence(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = linkDrawbackEvidenceSchema.parse(body);
    return envelope(
      await this.drawback.linkEvidence({
        id,
        exportDeclarationId: input.exportDeclarationId ?? null,
        exportBillOfLadingId: input.exportBillOfLadingId ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("drawback/claims/:id/submit")
  @RequirePermissions("trade.drawback.manage")
  @RequireFeature("trade")
  async submitDrawbackClaim(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    actSchema.parse(body ?? {});
    return envelope(await this.drawback.submit({ id, actorId: identity.userId }));
  }

  @Post("drawback/claims/:id/review")
  @RequirePermissions("trade.drawback.manage")
  @RequireFeature("trade")
  async reviewDrawbackClaim(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    actSchema.parse(body ?? {});
    return envelope(await this.drawback.review({ id, actorId: identity.userId }));
  }

  @Post("drawback/claims/:id/approve")
  @RequirePermissions("trade.drawback.manage")
  @RequireFeature("trade")
  async approveDrawbackClaim(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    actSchema.parse(body ?? {});
    return envelope(await this.drawback.approve({ id, actorId: identity.userId }));
  }

  @Post("drawback/claims/:id/reject")
  @RequirePermissions("trade.drawback.manage")
  @RequireFeature("trade")
  async rejectDrawbackClaim(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    actSchema.parse(body ?? {});
    return envelope(await this.drawback.reject({ id, actorId: identity.userId }));
  }

  @Post("drawback/claims/:id/pay")
  @RequirePermissions("trade.drawback.manage")
  @RequireFeature("trade")
  async payDrawbackClaim(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    actSchema.parse(body ?? {});
    // THE HONEST NO-GL SHAPE (D-12): the pay act is a registry stamp
    // only — the refund money lands when treasury records it (053's
    // surface); no journal, no cash movement, by design.
    return envelope(await this.drawback.pay({ id, actorId: identity.userId }));
  }
}
