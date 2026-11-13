import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { MrpEngineService } from "../application/mrp-engine-service";
import { MrpSuggestionsService } from "../application/mrp-suggestions-service";

/**
 * MRP routes (PHASE-043 §5 T-13's backend; matrix §3.20): the run surface
 * (start / history / detail with the netting drill-down) and the
 * suggestions board (accept / dismiss-with-reason — BR-079). Permission
 * `manufacturing.mrp` + feature `manufacturing.mrp` on every route; the
 * frozen-fence override key lives on the MPS surface only.
 *
 * The run executes synchronously within the request's UoW — the
 * deterministic scope (≤ 366 buckets, the depth-capped kernel) keeps the
 * latency bounded; the run row carries its own lifecycle for the audit
 * trail. Acceptance is idempotent (INV-030): a retried accept returns
 * the ORIGINAL conversion (the HTTP Idempotency-Key guard plus the
 * service's own replay short-circuit).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const LIMIT = z.coerce.number().int().min(1).max(500);

const runSchema = z.object({
  warehouseId: UUID,
  bucketSize: z.enum(["DAY", "WEEK"]),
  horizonBuckets: z.coerce.number().int().min(1).max(366),
  runMode: z.enum(["REGENERATIVE", "NET_CHANGE"]),
  scopeItemIds: z.array(UUID).max(200).optional(),
  allowTransfers: z.boolean().optional(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)").nullable().optional(),
});

const dismissSchema = z.object({ reason: z.string().min(1).max(300) });

const SUGGESTION_STATUS = z.enum(["SUGGESTED", "ACCEPTED", "DISMISSED", "SUPERSEDED"]).optional();
const SUGGESTION_TYPE = z.enum(["PURCHASE_ORDER", "PRODUCTION_ORDER", "TRANSFER"]).optional();

@Controller("api/v1/manufacturing/mrp")
export class MrpController {
  constructor(
    @Inject(MrpEngineService) private readonly engine: MrpEngineService,
    @Inject(MrpSuggestionsService) private readonly suggestions: MrpSuggestionsService,
  ) {}

  @Post("runs")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.mrp")
  @RequireFeature("manufacturing.mrp")
  async run(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = runSchema.parse(body);
    return envelope(
      await this.engine.run({
        warehouseId: input.warehouseId,
        bucketSize: input.bucketSize,
        horizonBuckets: input.horizonBuckets,
        runMode: input.runMode,
        scopeItemIds: input.scopeItemIds,
        allowTransfers: input.allowTransfers,
        asOfDate: input.asOfDate ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("runs")
  @RequirePermissions("manufacturing.mrp")
  @RequireFeature("manufacturing.mrp")
  async listRuns(
    @Query("warehouseId") warehouseId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.engine.listRuns({
        warehouseId: warehouseId && UUID.safeParse(warehouseId).success ? warehouseId : undefined,
        limit: LIMIT.parse(limit ?? 50),
      }),
    );
  }

  @Get("runs/:id")
  @RequirePermissions("manufacturing.mrp")
  @RequireFeature("manufacturing.mrp")
  async getRun(@Param("id") id: string) {
    return envelope(await this.engine.getRunDetail(id));
  }

  @Get("suggestions")
  @RequirePermissions("manufacturing.mrp")
  @RequireFeature("manufacturing.mrp")
  async listSuggestions(
    @Query("runId") runId?: string,
    @Query("warehouseId") warehouseId?: string,
    @Query("itemId") itemId?: string,
    @Query("status") status?: string,
    @Query("suggestionType") suggestionType?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.suggestions.list({
        runId: runId && UUID.safeParse(runId).success ? runId : undefined,
        warehouseId: warehouseId && UUID.safeParse(warehouseId).success ? warehouseId : undefined,
        itemId: itemId && UUID.safeParse(itemId).success ? itemId : undefined,
        status: SUGGESTION_STATUS.parse(status ?? undefined),
        suggestionType: SUGGESTION_TYPE.parse(suggestionType ?? undefined),
        limit: LIMIT.parse(limit ?? 200),
      }),
    );
  }

  @Post("suggestions/:id/accept")
  @RequirePermissions("manufacturing.mrp")
  @RequireFeature("manufacturing.mrp")
  async accept(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.suggestions.accept(id, identity.userId));
  }

  @Post("suggestions/:id/dismiss")
  @RequirePermissions("manufacturing.mrp")
  @RequireFeature("manufacturing.mrp")
  async dismiss(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = dismissSchema.parse(body);
    return envelope(await this.suggestions.dismiss(id, input.reason, identity.userId));
  }
}

