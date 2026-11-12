import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { RoutingService, type RoutingOperationInput } from "../application/routing-service";

/**
 * Routing routes (PHASE-042 matrix §3.20): versioned routings per item —
 * the BOM surface's exact shape (one manage key for the whole version
 * lifecycle, DRAFT-only PATCH full-replace, activate with the archive
 * previous in the same call, copy to a new DRAFT). BR-039 feature gate
 * `manufacturing.routing`; foreign or unknown ids are 404-shaped (A7);
 * times/rates travel as decimal strings ≤ 6dp (ADR-0009).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const TIME = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal hours (≤ 6dp)");
const LIMIT = z.coerce.number().int().min(1).max(500);
const NOTE = z.string().min(1).max(500).nullable().optional();
const ROUTING_STATUS = z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional();

const operationSchema = z.object({
  sequence: z.coerce.number().int().min(1).max(999),
  workCenterId: UUID,
  setupTime: TIME,
  runTime: TIME,
  /** NULL = inherit the work center's rate; overrides travel as a pair. */
  fixedCostRate: TIME.nullable().optional(),
  varCostRate: TIME.nullable().optional(),
  description: NOTE,
  descriptionAr: NOTE,
});

const createSchema = z.object({
  itemId: UUID,
  outputUomId: UUID,
  note: NOTE,
  noteAr: NOTE,
  operations: z.array(operationSchema).min(1).max(200),
});

const updateSchema = z.object({
  outputUomId: UUID.optional(),
  note: NOTE,
  noteAr: NOTE,
  /** Full operation-set replace (DRAFT only). */
  operations: z.array(operationSchema).min(1).max(200).optional(),
});

function toServiceOperation(op: z.infer<typeof operationSchema>): RoutingOperationInput {
  return {
    sequence: op.sequence,
    workCenterId: op.workCenterId,
    setupTime: op.setupTime,
    runTime: op.runTime,
    fixedCostRate: op.fixedCostRate ?? null,
    varCostRate: op.varCostRate ?? null,
    description: op.description ?? null,
    descriptionAr: op.descriptionAr ?? null,
  };
}

@Controller("api/v1/manufacturing/routings")
export class RoutingsController {
  constructor(@Inject(RoutingService) private readonly routings: RoutingService) {}

  @Get("")
  @RequirePermissions("manufacturing.routings.manage")
  @RequireFeature("manufacturing.routing")
  async list(
    @Query("itemId") itemId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.routings.list({
        itemId: itemId && UUID.safeParse(itemId).success ? itemId : undefined,
        status: ROUTING_STATUS.parse(status ?? undefined),
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.routings.manage")
  @RequireFeature("manufacturing.routing")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.routings.createDraft({
        itemId: input.itemId,
        outputUomId: input.outputUomId,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
        operations: input.operations.map(toServiceOperation),
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("manufacturing.routings.manage")
  @RequireFeature("manufacturing.routing")
  async get(@Param("id") id: string) {
    return envelope(await this.routings.getDetail(id));
  }

  @Patch(":id")
  @RequirePermissions("manufacturing.routings.manage")
  @RequireFeature("manufacturing.routing")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateSchema.parse(body ?? {});
    return envelope(
      await this.routings.update(id, {
        outputUomId: input.outputUomId,
        note: input.note,
        noteAr: input.noteAr,
        operations: input.operations?.map(toServiceOperation),
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/activate")
  @RequirePermissions("manufacturing.routings.manage")
  @RequireFeature("manufacturing.routing")
  async activate(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.routings.activate(id, { actorId: identity.userId }));
  }

  @Post(":id/copy")
  @RequirePermissions("manufacturing.routings.manage")
  @RequireFeature("manufacturing.routing")
  async copy(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.routings.copyFromRouting(id, { actorId: identity.userId }));
  }
}
