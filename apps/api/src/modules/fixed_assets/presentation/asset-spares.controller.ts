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
import { envelope } from "../../../infra/http/envelope";
import { AssetSparesService } from "../application/asset-spares-service";

/**
 * PHASE-049 (W-18 — T-09) the spare-parts BOM routes (matrix §3.27 — the
 * spares family carries the single `assets.spares.manage` key: the BOM is
 * operational master data whose consumption posts as an inventory issue
 * (G-60); the reads ride the same key, the matrix's own key set). The
 * BOM never issues stock itself — the consumption surface is the
 * work-order PARTS lines through the W-17 completion act's REAL WMS path
 * (the atomic clearing; declared in the service).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal (≤ 6dp)");
const NOTE = z.string().max(2000).nullable().optional();

const addSpareSchema = z.object({
  assetId: UUID,
  itemId: UUID,
  qty: QTY,
  note: NOTE,
  noteAr: NOTE,
});

const patchSpareSchema = z
  .object({
    qty: QTY.optional(),
    note: NOTE,
    noteAr: NOTE,
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty patch" });

@Controller("/api/v1/assets/spares")
export class AssetSparesController {
  constructor(@Inject(AssetSparesService) private readonly spares: AssetSparesService) {}

  @Get()
  @RequirePermissions("assets.spares.manage")
  listSpares(@Query("assetId") assetId?: string) {
    return envelope(
      this.spares.listSpares({
        assetId: assetId === undefined || assetId === "" ? undefined : assetId,
      }),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("assets.spares.manage")
  async addSpare(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = addSpareSchema.parse(body);
    return envelope(await this.spares.addSpare({ ...input, actorId: identity.userId }));
  }

  @Patch(":id")
  @RequirePermissions("assets.spares.manage")
  async patchSpare(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = patchSpareSchema.parse(body);
    return envelope(await this.spares.patchSpare({ spareId: id, ...input, actorId: identity.userId }));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("assets.spares.manage")
  async removeSpare(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.spares.removeSpare({ spareId: id, actorId: identity.userId });
    return undefined;
  }
}
