import { Body, Controller, Get, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { MpsService } from "../application/mps-service";

/**
 * MPS routes (PHASE-043 §5 T-14's backend; matrix §3.20): the bucket-grid
 * entries surface — list + slot upsert under `manufacturing.mps`. The
 * frozen-fence gate (BR-078) is DATA-DEPENDENT (the item's fence window),
 * so the controller resolves the guard's permission set and passes the
 * boolean down (the static route table cannot express it); the service
 * enforces permission + reason inside the fence.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const LIMIT = z.coerce.number().int().min(1).max(2000);
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal quantity (≤ 6dp)");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const REASON = z.string().min(1).max(300).nullable().optional();

const upsertSchema = z.object({
  warehouseId: UUID,
  itemId: UUID,
  bucketStart: DATE,
  qty: QTY,
  uomId: UUID,
  status: z.enum(["PLANNED", "FIRMED"]).optional(),
  reason: REASON,
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
});

@Controller("api/v1/manufacturing/mps")
export class MpsController {
  constructor(private readonly mps: MpsService) {}

  @Get("entries")
  @RequirePermissions("manufacturing.mps")
  @RequireFeature("manufacturing.mps")
  async list(
    @Query("warehouseId") warehouseId?: string,
    @Query("itemId") itemId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.mps.list({
        warehouseId: warehouseId && UUID.safeParse(warehouseId).success ? warehouseId : undefined,
        itemId: itemId && UUID.safeParse(itemId).success ? itemId : undefined,
        from: from && DATE.safeParse(from).success ? from : undefined,
        to: to && DATE.safeParse(to).success ? to : undefined,
        limit: LIMIT.parse(limit ?? 500),
      }),
    );
  }

  @Put("entries")
  @RequirePermissions("manufacturing.mps")
  @RequireFeature("manufacturing.mps")
  async upsert(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = upsertSchema.parse(body);
    return envelope(
      await this.mps.upsert({
        warehouseId: input.warehouseId,
        itemId: input.itemId,
        bucketStart: input.bucketStart,
        qty: input.qty,
        uomId: input.uomId,
        status: input.status,
        reason: input.reason ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        // BR-078: the data-dependent frozen-fence override — resolved from
        // the guard's per-request permission set.
        frozenEditPermission: identity.permissions?.has("manufacturing.mps.frozen_edit") ?? false,
        actorId: identity.userId,
      }),
    );
  }

  @Get("readiness")
  @RequirePermissions("manufacturing.mps")
  @RequireFeature("manufacturing.mps")
  async readiness(@Query("warehouseId") warehouseId?: string) {
    const warehouse =
      warehouseId !== undefined && UUID.safeParse(warehouseId).success ? warehouseId : undefined;
    if (warehouse === undefined) {
      return envelope({ itemsWithoutLeadTime: [], scopeSize: 0 });
    }
    return envelope(await this.mps.readiness(warehouse));
  }
}
