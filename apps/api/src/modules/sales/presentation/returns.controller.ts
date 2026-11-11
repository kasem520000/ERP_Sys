import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ReturnsService } from "../application/rma";
import { WarrantiesService } from "../application/warranties";

/**
 * Returns routes (PHASE-039 §2; matrix §3.9): the customer RMA workspace —
 * REQUESTED → APPROVED (SoD, sales.rma.approve) → RECEIVED → INSPECTED →
 * RESTOCKED/SCRAPPED/REFUNDED — plus the managed-warranty register (S-15).
 * Every route is permission-guarded (the seeded 0056 keys) and
 * Idempotency-Key'd by the global POST guard; the feature gates follow the
 * FEATURE_CATALOG keys (sales.rma / sales.warranties).
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
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");

const RMA_REASON_CODES = z.enum([
  "DAMAGED",
  "DEFECTIVE",
  "WRONG_ITEM",
  "LATE_DELIVERY",
  "CUSTOMER_REMORSE",
  "OTHER",
]) as z.ZodType<
  "DAMAGED" | "DEFECTIVE" | "WRONG_ITEM" | "LATE_DELIVERY" | "CUSTOMER_REMORSE" | "OTHER"
>;

const rmaLineSchema = z.object({
  invoiceLineId: UUID,
  qty: QTY,
  note: z.string().max(500).nullable().optional(),
});

const createRmaSchema = z.object({
  branchId: UUID,
  invoiceId: UUID,
  reasonCode: RMA_REASON_CODES,
  reason: z.string().max(1000).nullable().optional(),
  reasonAr: z.string().max(1000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
  lines: z.array(rmaLineSchema).min(1).max(200),
});

const inspectRmaSchema = z.object({
  disposition: z.enum(["RESTOCK", "SCRAP", "REFUND"]),
  inspectionNote: z.string().max(2000).nullable().optional(),
});

const completeRmaSchema = z
  .object({
    refundCashAccountId: UUID.nullable().optional(),
    entryDate: DATE.optional(),
  })
  .refine((value) => value.refundCashAccountId !== null, {
    message: "refundCashAccountId must be a uuid when present",
  });

const cancelSchema = z.object({ reason: z.string().min(3).max(500) });

const warrantyTermsSchema = z.object({
  durationMonths: z.number().int().min(1).max(120),
  coverage: z.enum(["REPAIR", "REPLACE", "REFUND", "LABOR_ONLY", "PARTS_ONLY"]),
  basis: z.enum(["INVOICE_DATE", "DELIVERY_DATE"]),
  mileageLimitKm: z.number().int().positive().nullable().optional(),
});

const createWarrantySchema = z.object({
  partnerId: UUID,
  itemId: UUID,
  serialNo: z.string().max(120).nullable().optional(),
  invoiceId: UUID.nullable().optional(),
  jobCardId: UUID.nullable().optional(),
  startDate: DATE,
  terms: warrantyTermsSchema,
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const LIMIT = (value: string | undefined, fallback: number) =>
  z.coerce.number().int().min(1).max(500).parse(value ?? fallback);

@Controller("/api/v1/sales")
export class ReturnsController {
  constructor(
    @Inject(ReturnsService) private readonly returns: ReturnsService,
    @Inject(WarrantiesService) private readonly warranties: WarrantiesService,
  ) {}

  // -- customer RMAs ------------------------------------------------------------------

  @Get("returns")
  @RequireFeature("sales.rma")
  @RequirePermissions("sales.rma.read")
  listRmas(
    @Req() request: Request,
    @Query("status") status?: string,
    @Query("partnerId") partnerId?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      this.returns.list({ status, partnerId, limit: LIMIT(limit, 200) }),
    );
  }

  @Get("returns/:id")
  @RequireFeature("sales.rma")
  @RequirePermissions("sales.rma.read")
  async getRma(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.returns.findWithLines(UUID.parse(id)));
  }

  @Post("returns")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("sales.rma")
  @RequirePermissions("sales.rma.manage")
  async createRma(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRmaSchema.parse(body);
    return envelope(
      await this.returns.create({
        branchId: input.branchId,
        invoiceId: input.invoiceId,
        reasonCode: input.reasonCode,
        reason: input.reason ?? null,
        reasonAr: input.reasonAr ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
        lines: input.lines.map((line) => ({
          invoiceLineId: line.invoiceLineId,
          qty: line.qty,
          note: line.note ?? null,
        })),
      }),
    );
  }

  @Post("returns/:id/approve")
  @RequireFeature("sales.rma")
  @RequirePermissions("sales.rma.approve")
  async approveRma(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.returns.approve(UUID.parse(id), identity.userId));
  }

  @Post("returns/:id/receive")
  @RequireFeature("sales.rma")
  @RequirePermissions("sales.rma.manage")
  async receiveRma(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.returns.receive(UUID.parse(id), identity.userId));
  }

  @Post("returns/:id/inspect")
  @RequireFeature("sales.rma")
  @RequirePermissions("sales.rma.manage")
  async inspectRma(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = inspectRmaSchema.parse(body);
    return envelope(
      await this.returns.inspect({
        rmaId: UUID.parse(id),
        disposition: input.disposition,
        inspectionNote: input.inspectionNote ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("returns/:id/complete")
  @RequireFeature("sales.rma")
  @RequirePermissions("sales.rma.manage")
  async completeRma(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = completeRmaSchema.parse(body ?? {});
    return envelope(
      await this.returns.complete({
        rmaId: UUID.parse(id),
        refundCashAccountId: input.refundCashAccountId ?? null,
        entryDate: input.entryDate,
        actorId: identity.userId,
      }),
    );
  }

  @Post("returns/:id/cancel")
  @RequireFeature("sales.rma")
  @RequirePermissions("sales.rma.manage")
  async cancelRma(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = cancelSchema.parse(body);
    return envelope(await this.returns.cancel(UUID.parse(id), input.reason, identity.userId));
  }

  // -- managed warranties (S-15) --------------------------------------------------------

  @Get("warranties")
  @RequireFeature("sales.warranties")
  @RequirePermissions("sales.warranties.manage")
  listWarranties(
    @Req() request: Request,
    @Query("partnerId") partnerId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      this.warranties.list({ partnerId, status, limit: LIMIT(limit, 200) }),
    );
  }

  @Post("warranties")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("sales.warranties")
  @RequirePermissions("sales.warranties.manage")
  async createWarranty(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createWarrantySchema.parse(body);
    return envelope(
      await this.warranties.create({
        partnerId: input.partnerId,
        itemId: input.itemId,
        serialNo: input.serialNo ?? null,
        invoiceId: input.invoiceId ?? null,
        jobCardId: input.jobCardId ?? null,
        startDate: input.startDate,
        terms: {
          durationMonths: input.terms.durationMonths,
          coverage: input.terms.coverage,
          basis: input.terms.basis,
          mileageLimitKm: input.terms.mileageLimitKm ?? null,
        },
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("warranties/:id/void")
  @RequireFeature("sales.warranties")
  @RequirePermissions("sales.warranties.manage")
  async voidWarranty(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.warranties.void(UUID.parse(id), identity.userId));
  }
}
