import {
  Body,
  Controller,
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
import { AssetMetersService } from "../application/asset-meters-service";

/**
 * PHASE-049 (W-18 — T-08) the meters + readings routes (matrix §3.27):
 * the reads on `assets.meters.view`, the readings on `assets.meters.record`
 * (the risky key — a reading evaluates the METER plans event-driven in the
 * reading's own transaction, a wrong reading generates real work orders),
 * and the meter AUTHORING (the register + R-10's odometer designation —
 * the maintenance plane's operational write) on `assets.maintenance.manage`
 * (the matrix's own key set: the meters family carries view/record only —
 * the designation is a maintenance-management act, declared in the W-18
 * dated note).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal (≤ 6dp)");
const METER_TYPE = z.enum(["HOURS", "KM", "PRODUCTION", "CUSTOM"]);
const SOURCE = z.enum(["MANUAL", "JOB", "IMPORT"]);
const NOTE = z.string().max(2000).nullable().optional();

const createMeterSchema = z.object({
  assetId: UUID,
  name: z.string().min(1).max(200),
  nameAr: NOTE,
  type: METER_TYPE,
  unit: z.string().min(1).max(16),
  isOdometer: z.boolean().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const patchMeterSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    nameAr: NOTE,
    unit: z.string().min(1).max(16).optional(),
    isOdometer: z.boolean().optional(),
    note: NOTE,
    noteAr: NOTE,
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty patch" });

const readingSchema = z
  .object({
    value: QTY,
    effectiveDate: DATE,
    source: SOURCE.optional(),
    workOrderId: UUID.nullable().optional(),
    note: NOTE,
    noteAr: NOTE,
  })
  .refine((value) => value.source !== "JOB" || value.workOrderId !== undefined, {
    message: "a JOB reading names its work order",
  });

@Controller("/api/v1/assets/meters")
export class AssetMetersController {
  constructor(@Inject(AssetMetersService) private readonly meters: AssetMetersService) {}

  // -- the register (D-07 — R-10's write path on the manage key) ----------------

  @Get()
  @RequirePermissions("assets.meters.view")
  listMeters(@Query("assetId") assetId?: string) {
    return envelope(
      this.meters.listMeters({
        assetId: assetId === undefined || assetId === "" ? undefined : assetId,
      }),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("assets.maintenance.manage")
  async createMeter(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createMeterSchema.parse(body);
    return envelope(await this.meters.createMeter({ ...input, actorId: identity.userId }));
  }

  @Get(":id")
  @RequirePermissions("assets.meters.view")
  async getMeter(@Param("id") id: string) {
    return envelope(await this.meters.getMeter(id));
  }

  @Patch(":id")
  @RequirePermissions("assets.maintenance.manage")
  async patchMeter(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = patchMeterSchema.parse(body);
    return envelope(await this.meters.patchMeter({ meterId: id, ...input, actorId: identity.userId }));
  }

  // -- the readings log (D-07 — the event surface on the record key) ------------

  @Get(":id/readings")
  @RequirePermissions("assets.meters.view")
  async listReadings(@Param("id") id: string) {
    return envelope(await this.meters.listReadings(id));
  }

  /** THE EVENT: the reading's own transaction evaluates the meter's
   * ACTIVE plans (the anchor delta; the named skips; no arming). */
  @Post(":id/readings")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("assets.meters.record")
  async recordReading(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = readingSchema.parse(body);
    return envelope(
      await this.meters.recordReading({ meterId: id, ...input, actorId: identity.userId }),
    );
  }
}
