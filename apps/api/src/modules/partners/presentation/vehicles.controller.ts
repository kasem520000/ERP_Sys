import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { UnauthenticatedError } from "../../identity/api/identity";
import { VehicleService } from "../vehicles/application/vehicle-service";

/**
 * Vehicle registry routes (PHASE-017 §2 item 3): the per-partner vehicle
 * CRUD + archive + the per-vehicle service-history timeline. Gated by the
 * single matrix key `partners.vehicles.manage` exactly as registered in
 * route-permissions (no feature gate — the registry is core partners
 * data, not an industry entitlement); the TenantContextInterceptor
 * resolves the tenant scope and the IdempotencyKeyGuard covers the POSTs.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const vehicleCreateSchema = z.object({
  partnerId: z.string().uuid(),
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(60),
  modelYear: z.number().int().min(1900).max(2100).nullish(),
  // Full VIN shape stays a service-level typed error (422
  // VEHICLE_CHASSIS_INVALID) — zod only bounds the length here.
  chassisNo: z.string().min(1).max(17).nullish(),
  plateNo: z.string().min(1).max(30).nullish(),
  color: z.string().min(1).max(60).nullish(),
  engineNo: z.string().min(1).max(60).nullish(),
  odometerKm: z.string().regex(/^\d{1,11}(\.\d)?$/, "decimal string").nullish(),
  odometerAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date string").nullish(),
  note: z.string().min(1).max(1000).nullish(),
  noteAr: z.string().min(1).max(1000).nullish(),
});

const vehicleUpdateSchema = vehicleCreateSchema.partial().omit({ partnerId: true }).extend({
  version: z.number().int().positive().optional(),
});

const vehicleListQuerySchema = z.object({
  partnerId: z.string().uuid().optional(),
  q: z.string().min(1).max(100).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

const LIMIT = z.coerce.number().int().min(1).max(100).default(25);

@Controller("api/v1/partners/vehicles")
export class VehiclesController {
  constructor(@Inject(VehicleService) private readonly vehicles: VehicleService) {}

  @Get()
  @RequirePermissions("partners.vehicles.manage")
  async list(
    @Query("partnerId") partnerId?: string,
    @Query("q") q?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    const query = vehicleListQuerySchema.parse({ partnerId, q, status });
    const rows = await this.vehicles.list(query, LIMIT.parse(limit ?? undefined));
    return envelope(rows);
  }

  @Post()
  @RequirePermissions("partners.vehicles.manage")
  @HttpCode(HttpStatus.OK)
  async create(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = vehicleCreateSchema.parse(body);
    return envelope(
      await this.vehicles.create(identity.userId, {
        partnerId: input.partnerId,
        make: input.make,
        model: input.model,
        modelYear: input.modelYear ?? null,
        chassisNo: input.chassisNo ?? null,
        plateNo: input.plateNo ?? null,
        color: input.color ?? null,
        engineNo: input.engineNo ?? null,
        odometerKm: input.odometerKm ?? null,
        odometerAt: input.odometerAt ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("partners.vehicles.manage")
  async get(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.vehicles.get(id));
  }

  @Put(":id")
  @RequirePermissions("partners.vehicles.manage")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const patch = vehicleUpdateSchema.parse(body);
    return envelope(await this.vehicles.update(identity.userId, id, patch));
  }

  @Post(":id/archive")
  @RequirePermissions("partners.vehicles.manage")
  @HttpCode(HttpStatus.OK)
  async archive(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.vehicles.archive(identity.userId, id));
  }

  @Get(":id/service-history")
  @RequirePermissions("partners.vehicles.manage")
  async serviceHistory(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.vehicles.serviceHistory(id));
  }
}
