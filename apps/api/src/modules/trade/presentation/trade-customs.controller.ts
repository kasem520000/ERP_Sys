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
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { CustomsService } from "../application/customs-service";

/**
 * PHASE-051 (W-37 — T-10, 2026-11-25) the trade customs routes (matrix
 * §3.29, the keys-seed-first discipline's FOURTH trade binding wave —
 * the keys landed at W-33 (0122 §5), the routes bind as the service
 * waves ship, every change dated at the ROUTE_PERMISSIONS block): the
 * declarations bind trade.customs.view over the reads (the register +
 * the find's own chain — the declaration + its lines + the fold's
 * totals) and trade.customs.manage over the register acts (create with
 * the lines · the DRAFT-only add-line · submit · accept · THE G-65
 * COMPLETION · cancel); the HS registry binds trade.customs.view over
 * the reads and trade.customs.manage over the tenant additions + the
 * retirement. The routes are feature-gated at the controller on the
 * whole-module unit `trade` (D-04 — the customs family carries no own
 * flag; the phase doc's third flag trade.customs is the screen-plane
 * composable unit, W-39's own wiring). Foreign/unknown ids are
 * 404-shaped (A7 — RLS makes them indistinguishable). The completion's
 * own summary (the totals + the landed-cost document + the journal)
 * rides the response envelope — the W-39 customs screen renders the
 * same figures.
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
const HS_CODE = z.string().regex(/^[0-9]{2,10}$/, "2…10 digits (the harmonized system's own shape)");
const DECIMAL = z
  .string()
  .regex(/^\d+(\.\d{1,8})?$/, "a non-negative decimal (≤ 8dp)");
const ORIGIN = z.string().regex(/^[A-Z]{2}$/, "an ISO-3166 alpha-2 code").nullable().optional();

const declarationLineSchema = z.object({
  hsCode: HS_CODE,
  originCountry: ORIGIN,
  itemId: UUID.nullable().optional(),
  description: z.string().min(1).max(200).nullable().optional(),
  quantity: z.string().regex(/^\d+(\.\d{1,6})?$/, "a non-negative decimal (≤ 6dp)").nullable().optional(),
  uom: z.string().min(1).max(20).nullable().optional(),
  customsValue: DECIMAL,
  dutyRate: DECIMAL,
  importVat: DECIMAL,
  note: NOTE,
  noteAr: NOTE,
});

const createDeclarationSchema = z.object({
  declarationType: z.enum(["IMPORT", "EXPORT", "TRANSIT"]),
  customsOffice: z.string().min(1).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/, "an ISO-4217 code"),
  receiptId: UUID.nullable().optional(),
  purchaseOrderId: UUID.nullable().optional(),
  billOfLadingId: UUID.nullable().optional(),
  lines: z.array(declarationLineSchema).min(1).max(200),
  note: NOTE,
  noteAr: NOTE,
});

const addLineSchema = z.object({ line: declarationLineSchema });

const ladderSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
  exchangeRate: z.string().regex(/^\d+(\.\d{1,8})?$/, "a positive decimal (≤ 8dp)").nullable().optional(),
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "an ISO date").nullable().optional(),
});

const createHsSchema = z.object({
  hsCode: HS_CODE,
  name: z.string().min(2).max(160),
  nameAr: z.string().min(2).max(160),
  note: NOTE,
  noteAr: NOTE,
});

const updateHsSchema = z.object({
  attemptedCode: HS_CODE.nullable().optional(),
  name: z.string().min(2).max(160).nullable().optional(),
  nameAr: z.string().min(2).max(160).nullable().optional(),
  isActive: z.boolean().optional(),
  note: NOTE,
  noteAr: NOTE,
});

@Controller("/api/v1/trade/customs")
export class TradeCustomsController {
  constructor(@Inject(CustomsService) private readonly customs: CustomsService) {}

  // ── the declarations register (the ladder + the G-65 flow) ───────────

  @Get("declarations")
  @RequirePermissions("trade.customs.view")
  @RequireFeature("trade")
  listDeclarations(
    @Query("status") status?: string,
    @Query("declarationType") declarationType?: string,
    @Query("receiptId") receiptId?: string,
  ) {
    return envelope(
      this.customs.list({
        status: status === undefined || status === "" ? undefined : status,
        declarationType: declarationType === undefined || declarationType === "" ? undefined : declarationType,
        receiptId: receiptId === undefined || receiptId === "" ? undefined : receiptId,
      }),
    );
  }

  @Get("declarations/:id")
  @RequirePermissions("trade.customs.view")
  @RequireFeature("trade")
  async findDeclaration(@Param("id") id: string) {
    return envelope(await this.customs.find(id));
  }

  @Post("declarations")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.customs.manage")
  @RequireFeature("trade")
  async createDeclaration(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createDeclarationSchema.parse(body);
    return envelope(
      await this.customs.createDeclaration({
        declarationType: input.declarationType,
        customsOffice: input.customsOffice,
        currency: input.currency,
        receiptId: input.receiptId ?? null,
        purchaseOrderId: input.purchaseOrderId ?? null,
        billOfLadingId: input.billOfLadingId ?? null,
        lines: input.lines,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("declarations/:id/lines")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.customs.manage")
  @RequireFeature("trade")
  async addDeclarationLine(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = addLineSchema.parse(body);
    return envelope(
      await this.customs.addLine(id, input.line, identity.userId),
    );
  }

  @Post("declarations/:id/submit")
  @RequirePermissions("trade.customs.manage")
  @RequireFeature("trade")
  async submitDeclaration(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.customs.submit(id, identity.userId));
  }

  @Post("declarations/:id/accept")
  @RequirePermissions("trade.customs.manage")
  @RequireFeature("trade")
  async acceptDeclaration(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.customs.accept(id, identity.userId));
  }

  @Post("declarations/:id/complete")
  @RequirePermissions("trade.customs.manage")
  @RequireFeature("trade")
  async completeDeclaration(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = ladderSchema.parse(body ?? {});
    return envelope(
      await this.customs.complete({
        id,
        exchangeRate: input.exchangeRate ?? null,
        entryDate: input.entryDate ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("declarations/:id/cancel")
  @RequirePermissions("trade.customs.manage")
  @RequireFeature("trade")
  async cancelDeclaration(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = ladderSchema.parse(body ?? {});
    return envelope(
      await this.customs.cancel(id, input.reason ?? "cancelled by the actor", identity.userId),
    );
  }

  // ── the HS registry (the tenant-extensible starter set) ──────────────

  @Get("hs")
  @RequirePermissions("trade.customs.view")
  @RequireFeature("trade")
  listHsCodes(@Query("activeOnly") activeOnly?: string) {
    return envelope(
      this.customs.listHsCodes({
        activeOnly: activeOnly === undefined || activeOnly === "" ? true : activeOnly !== "false",
      }),
    );
  }

  @Post("hs")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.customs.manage")
  @RequireFeature("trade")
  async createHsCode(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createHsSchema.parse(body);
    return envelope(
      await this.customs.createHsCode({
        hsCode: input.hsCode,
        name: input.name,
        nameAr: input.nameAr,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("hs/:code")
  @RequirePermissions("trade.customs.manage")
  @RequireFeature("trade")
  async updateHsCode(@Req() request: Request, @Param("code") code: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateHsSchema.parse(body);
    return envelope(
      await this.customs.updateHsCode({
        hsCode: code,
        attemptedCode: input.attemptedCode ?? null,
        name: input.name ?? null,
        nameAr: input.nameAr ?? null,
        isActive: input.isActive,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
