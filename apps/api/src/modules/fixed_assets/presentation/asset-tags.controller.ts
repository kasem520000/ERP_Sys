import {
  Body,
  Controller,
  Delete,
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
import { AssetTagsService } from "../application/asset-tags-service";

/**
 * PHASE-049 (W-19 — T-11) the signed tags' routes (matrix §3.27's W-19
 * dated note): the whole family rides the single `assets.tags.manage` key
 * (the register, the print sheet, the printed stamp, the hygiene delete —
 * the codes are unguessable signed tokens and regeneration changes what
 * physical QR labels resolve), and THE SCAN ROUTE rides
 * `assets.maintenance.view` — the DECLARED INTERPRETATION: the scan
 * resolves INTO the maintenance plane's asset card (the technician's
 * surface); the register's own reads stay on `fixed_assets.assets.view`.
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

const createTagsSchema = z.object({
  assetId: UUID,
  quantity: z.number().int().min(1).max(50).optional(),
  note: NOTE,
  noteAr: NOTE,
});

@Controller("/api/v1/assets/tags")
export class AssetTagsController {
  constructor(@Inject(AssetTagsService) private readonly tags: AssetTagsService) {}

  /** The batch create (1…50 signed codes for one asset, one transaction —
   * one sheet's worth; ZERO parallel accounting: the rows are the batch). */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("assets.tags.manage")
  async createTags(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createTagsSchema.parse(body);
    return envelope(
      await this.tags.createTags({ ...input, actorId: identity.userId }),
    );
  }

  @Get()
  @RequirePermissions("assets.tags.manage")
  listTags(@Query("assetId") assetId?: string) {
    return envelope(
      this.tags.listTags({
        assetId: assetId === undefined || assetId === "" ? undefined : assetId,
      }),
    );
  }

  /** ONE SHEET PER TAG BATCH (D-09): the asset brief + its UNPRINTED tags
   * — the payload the W-21 print plane renders deterministically (`bi()`). */
  @Get("print-sheet")
  @RequirePermissions("assets.tags.manage")
  async printSheet(@Query("assetId") assetId: string) {
    return envelope(await this.tags.printSheet({ assetId }));
  }

  /** THE PRINTED STAMP — the single-consumption CAS seal (the
   * already-printed tag refuses BY NAME; a re-print prints a NEW tag). */
  @Post(":id/print")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("assets.tags.manage")
  async printTag(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.tags.printTag({ tagId: id, actorId: identity.userId }));
  }

  /** The register-hygiene delete (a mistyped batch's cleanup or a retired
   * label — the code stops resolving the moment the row dies; audited). */
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("assets.tags.manage")
  async deleteTag(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.tags.deleteTag({ tagId: id, actorId: identity.userId });
  }
}

/**
 * THE SCAN SURFACE (D-09): resolves a scanned signed code to the asset
 * card through the standard auth + RLS stack — the signature gate BEFORE
 * any lookup (a forged code never touches the database), then the
 * tenant-scoped read (a foreign tenant's scan is the typed 404, never a
 * cross-tenant oracle).
 */
@Controller("/api/v1/assets/scan")
export class AssetScanController {
  constructor(@Inject(AssetTagsService) private readonly tags: AssetTagsService) {}

  @Get(":code")
  @RequirePermissions("assets.maintenance.view")
  async scan(@Param("code") code: string) {
    return envelope(await this.tags.scanCode({ code }));
  }
}
