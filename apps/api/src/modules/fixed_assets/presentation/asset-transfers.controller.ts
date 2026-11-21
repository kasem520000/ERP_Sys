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
import { envelope } from "../../../infra/http/envelope";
import { AssetTransfersService } from "../application/asset-transfers-service";

/**
 * PHASE-049 (W-18 — T-10) the transfers routes (matrix §3.27 — the SoD
 * split): the reads on `assets.transfer.view`; the authoring + submission
 * on `assets.maintenance.manage` (the maintenance plane's operational
 * write — the CREATOR's key); the verdicts (approve + reject, the G-61
 * gate) on `assets.transfer.approve` — the APPROVER's key. Creator ≠
 * approver at the key plane AND at the service's SoD backstop (§4).
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

const createTransferSchema = z.object({
  assetId: UUID,
  toBranchId: UUID,
  reason: z.string().min(1).max(2000),
  reasonAr: NOTE,
  note: NOTE,
  noteAr: NOTE,
});

const rejectSchema = z.object({
  rejectReason: z.string().min(1).max(2000),
});

@Controller("/api/v1/assets/transfers")
export class AssetTransfersController {
  constructor(@Inject(AssetTransfersService) private readonly transfers: AssetTransfersService) {}

  @Get()
  @RequirePermissions("assets.transfer.view")
  listTransfers(@Query("assetId") assetId?: string, @Query("status") status?: string) {
    return envelope(
      this.transfers.list({
        assetId: assetId === undefined || assetId === "" ? undefined : assetId,
        status: status === undefined || status === "" ? undefined : status,
      }),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("assets.maintenance.manage")
  async createTransfer(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createTransferSchema.parse(body);
    return envelope(await this.transfers.create({ ...input, actorId: identity.userId }));
  }

  @Get(":id")
  @RequirePermissions("assets.transfer.view")
  async getTransfer(@Param("id") id: string) {
    return envelope(await this.transfers.get(id));
  }

  @Post(":id/submit")
  @RequirePermissions("assets.maintenance.manage")
  async submitTransfer(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.transfers.submit(id, identity.userId));
  }

  /** THE G-61 GATE: the approval act (the NBV reclassification posted
   * exactly once; the seals after the operation, the same transaction). */
  @Post(":id/approve")
  @RequirePermissions("assets.transfer.approve")
  async approveTransfer(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.transfers.approve({ transferId: id, actorId: identity.userId }));
  }

  /** The verdict XOR's other side — the rejection never silent. */
  @Post(":id/reject")
  @RequirePermissions("assets.transfer.approve")
  async rejectTransfer(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = rejectSchema.parse(body);
    return envelope(
      await this.transfers.reject({
        transferId: id,
        rejectReason: input.rejectReason,
        actorId: identity.userId,
      }),
    );
  }
}
