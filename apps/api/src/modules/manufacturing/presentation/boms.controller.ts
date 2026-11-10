import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { BomService, type BomLineInput } from "../application/bom-service";

/**
 * BOM routes (PHASE-018 §9 rows 1–7; matrix §3.8): versioned recipe
 * maintenance for one FG item. Every route is permission-guarded (the seeded
 * `manufacturing.boms.manage` key — the single manage key for the whole
 * version lifecycle), BR-039 feature-gated on `manufacturing.bom`,
 * Idempotency-Key'd by the global POST guard, and returns the success
 * envelope. Foreign or unknown ids are 404-shaped (A7 — no existence
 * disclosure). Quantities travel as decimal strings ≤ 6dp, percentages ≤ 4dp
 * (ADR-0009; numeric(19,6) / numeric(7,4) storage).
 *
 * The explosion route is declared BEFORE :id so the static segment wins the
 * Express match (a param route would otherwise swallow "explosion").
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)");
const PCT = z.string().regex(/^\d+(\.\d{1,4})?$/, "percentage decimal (≤ 4dp)");
const LIMIT = z.coerce.number().int().min(1).max(500);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const NOTE = z.string().min(1).max(500).nullable().optional();

const lineSchema = z.object({
  /** Preserved on the PUT full-replace; ignored on create. */
  id: UUID.nullable().optional(),
  componentItemId: UUID,
  qtyPerOutput: QTY,
  scrapPct: PCT.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const createSchema = z.object({
  itemId: UUID,
  outputUomId: UUID,
  yieldPct: PCT,
  note: NOTE,
  noteAr: NOTE,
  lines: z.array(lineSchema).min(1).max(200),
});

const updateSchema = z.object({
  outputUomId: UUID.optional(),
  yieldPct: PCT.optional(),
  note: NOTE,
  noteAr: NOTE,
  /** Full line-set replace (DRAFT only); provided line ids are preserved. */
  lines: z.array(lineSchema).min(1).max(200).optional(),
});

const activateSchema = z.object({ effectiveFrom: DATE.nullable().optional() });

function toServiceLine(line: z.infer<typeof lineSchema>): BomLineInput {
  return {
    id: line.id ?? null,
    componentItemId: line.componentItemId,
    qtyPerOutput: line.qtyPerOutput,
    scrapPct: line.scrapPct ?? null,
    note: line.note ?? null,
    noteAr: line.noteAr ?? null,
  };
}

@Controller("api/v1/manufacturing/boms")
export class BomsController {
  constructor(@Inject(BomService) private readonly boms: BomService) {}

  @Get("")
  @RequirePermissions("manufacturing.boms.manage")
  @RequireFeature("manufacturing.bom")
  async list(
    @Query("itemId") itemId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.boms.list({
        itemId: itemId && UUID.safeParse(itemId).success ? itemId : undefined,
        status,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.boms.manage")
  @RequireFeature("manufacturing.bom")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.boms.create({
        itemId: input.itemId,
        outputUomId: input.outputUomId,
        yieldPct: input.yieldPct,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
        lines: input.lines.map(toServiceLine),
      }),
    );
  }

  // -- explosion BEFORE :id (static segment wins the Express match) ---------------

  @Get("explosion")
  @RequirePermissions("manufacturing.boms.manage")
  @RequireFeature("manufacturing.bom")
  async explosion(
    @Query("itemId") itemId?: string,
    @Query("qty") qty?: string,
    @Query("bomId") bomId?: string,
  ) {
    const input = z
      .object({
        itemId: UUID,
        qty: QTY,
        bomId: UUID.nullable().optional(),
      })
      .parse({ itemId, qty, bomId: bomId ?? null });
    return envelope(await this.boms.explode(input.itemId, input.qty, input.bomId));
  }

  @Get(":id")
  @RequirePermissions("manufacturing.boms.manage")
  @RequireFeature("manufacturing.bom")
  async get(@Param("id") id: string) {
    return envelope(await this.boms.findWithLines(id));
  }

  @Put(":id")
  @RequirePermissions("manufacturing.boms.manage")
  @RequireFeature("manufacturing.bom")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateSchema.parse(body ?? {});
    return envelope(
      await this.boms.update(id, {
        outputUomId: input.outputUomId,
        yieldPct: input.yieldPct,
        note: input.note,
        noteAr: input.noteAr,
        lines: input.lines?.map(toServiceLine),
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/activate")
  @RequirePermissions("manufacturing.boms.manage")
  @RequireFeature("manufacturing.bom")
  async activate(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = activateSchema.parse(body ?? {});
    return envelope(
      await this.boms.activate(id, {
        effectiveFrom: input.effectiveFrom ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/archive")
  @RequirePermissions("manufacturing.boms.manage")
  @RequireFeature("manufacturing.bom")
  async archive(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.boms.archive(id, { actorId: identity.userId }));
  }
}
