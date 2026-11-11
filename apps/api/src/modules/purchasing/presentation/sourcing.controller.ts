import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { RfqService } from "../application/rfq";
import { SupplierQuoteService } from "../application/quotes";
import { AwardService } from "../application/award";
import { BlanketService } from "../application/blanket";
import { ScorecardService } from "../application/scorecards";
import { CapexService } from "../application/capex";
import { SupplierAdvancesService } from "../application/advances";
import { TenderIntakeService } from "../application/tenders";

/**
 * Sourcing routes (PHASE-038 §4; matrix §3.16): the RFQ negotiation loop
 * (H-11/P-01), supplier quotes (P-02), the comparison/award matrix with
 * the 3-bid floor (BR-062) and BR-063's one-award-per-round, blanket
 * agreements (P-03), supplier collaboration (scorecards + approved
 * items, P-04), advances + early-payment discounts (G-33/G-34), CAPEX
 * requests with the 028 guard (P-10/P-15), and tender intake (P-14).
 * Every route is permission-guarded (the seeded sourcing keys) and
 * Idempotency-Key'd by the global POST guard; feature gates follow the
 * FEATURE_CATALOG keys (the tier-4 financial-depth grants).
 *
 * The SUPPLIER-FACING portal route lives in portal.controller.ts (the
 * public surface — PUBLIC_ROUTES + its own rate limiter); everything here
 * is back-office.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)");
const MONEY4 = z.string().regex(/^\d+\.\d{4}$/, "canonical 4-dp decimal");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "decimal");
const UUID = z.string().uuid();

const rfqLineSchema = z.object({
  itemId: UUID,
  qty: QTY,
  targetPrice: MONEY.nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

const createRfqSchema = z.object({
  branchId: UUID,
  title: z.string().min(1).max(200),
  titleAr: z.string().max(200).nullable().optional(),
  mode: z.enum(["OPEN", "INVITED"]),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  dueAt: z.string().datetime().nullable().optional(),
  invitedSuppliers: z.array(UUID).max(200).default([]),
  lines: z.array(rfqLineSchema).min(1).max(500),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const updateRfqSchema = createRfqSchema
  .partial()
  .omit({ branchId: true, currencyCode: true })
  .extend({ lines: z.array(rfqLineSchema).min(1).max(500).optional() });

const quoteLineSchema = z.object({
  rfqLineId: UUID,
  qty: QTY,
  unitPrice: z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal (≤ 6dp)"),
  leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

const backOfficeQuoteSchema = z.object({
  supplierId: UUID,
  quoteRef: z.string().max(120).nullable().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
  validUntil: DATE.nullable().optional(),
  paymentTerms: z.string().max(300).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  lines: z.array(quoteLineSchema).min(1).max(500),
});

const mintInviteSchema = z.object({
  supplierId: UUID,
  expiresAt: z.string().datetime(),
});

const awardDecisionSchema = z.object({
  rfqLineId: UUID,
  quoteId: UUID,
  supplierId: UUID,
  qty: QTY,
  unitPrice: z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal (≤ 6dp)"),
});

const awardSchema = z.object({
  decisions: z.array(awardDecisionSchema).min(1).max(500),
  blanketOrderId: UUID.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const blanketPriceLockSchema = z.object({
  itemId: UUID,
  unitPrice: MONEY,
  note: z.string().max(300).optional(),
});

const createBlanketSchema = z.object({
  branchId: UUID,
  supplierId: UUID,
  contractId: UUID.nullable().optional(),
  title: z.string().min(1).max(200),
  titleAr: z.string().max(200).nullable().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  validFrom: DATE,
  validTo: DATE,
  minCommitment: MONEY4,
  maxCommitment: MONEY4,
  priceLock: z.array(blanketPriceLockSchema).max(500).default([]),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const releaseSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: UUID,
        qty: QTY,
        unitPrice: MONEY.nullable().optional(),
        note: z.string().max(300).optional(),
      }),
    )
    .min(1)
    .max(500),
  releaseDate: DATE.optional(),
  note: z.string().max(2000).nullable().optional(),
});

const advanceSchema = z.object({
  supplierId: UUID,
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  amount: MONEY4,
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const disburseSchema = z.object({
  cashAccountId: UUID,
  entryDate: DATE.optional(),
});

const applyAdvanceSchema = z.object({
  amount: MONEY4,
  entryDate: DATE.optional(),
});

const termsSchema = z.object({
  supplierId: UUID,
  discountPct: z.string().regex(/^\d+(\.\d{1,2})?$/, "percentage"),
  discountDays: z.number().int().min(1).max(365),
  minInvoiceAmount: MONEY4.default("0.0000"),
  note: z.string().max(1000).nullable().optional(),
});

const captureSchema = z.object({
  invoiceId: UUID,
  paymentId: UUID,
  entryDate: DATE.optional(),
});

const approvedItemSchema = z.object({
  supplierId: UUID,
  itemId: UUID,
  status: z.enum(["APPROVED", "SUSPENDED"]),
  expiresAt: DATE.nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

const capexSchema = z.object({
  branchId: UUID,
  title: z.string().min(1).max(200),
  titleAr: z.string().max(200).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  accountId: UUID,
  costCenterId: UUID.nullable().optional(),
  projectId: UUID.nullable().optional(),
  estimatedAmount: MONEY4,
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  neededBy: DATE.nullable().optional(),
});

const tenderSchema = z.object({
  title: z.string().min(1).max(200),
  titleAr: z.string().max(200).nullable().optional(),
  announcingAuthority: z.string().min(1).max(200),
  tenderRefNo: z.string().max(120).nullable().optional(),
  publishedAt: DATE.nullable().optional(),
  submissionDeadline: z.string().datetime().nullable().optional(),
  estimatedValue: MONEY.nullable().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  govRegistrationNo: z.string().max(120).nullable().optional(),
  govRegistrationExpiry: DATE.nullable().optional(),
  classificationCode: z.string().max(80).nullable().optional(),
  sourceUrl: z.string().max(500).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const decideSchema = z.object({
  ourDecision: z.enum(["PENDING", "WILL_BID", "DECLINED", "WON", "LOST"]),
  note: z.string().max(2000).nullable().optional(),
});

const LIMIT = (value: string | undefined, fallback: number) =>
  z.coerce.number().int().min(1).max(500).parse(value ?? fallback);

@Controller("/api/v1/purchasing")
export class SourcingController {
  constructor(
    @Inject(RfqService) private readonly rfqs: RfqService,
    @Inject(SupplierQuoteService) private readonly quotes: SupplierQuoteService,
    @Inject(AwardService) private readonly awards: AwardService,
    @Inject(BlanketService) private readonly blankets: BlanketService,
    @Inject(ScorecardService) private readonly scorecards: ScorecardService,
    @Inject(CapexService) private readonly capex: CapexService,
    @Inject(SupplierAdvancesService) private readonly advances: SupplierAdvancesService,
    @Inject(TenderIntakeService) private readonly tenders: TenderIntakeService,
  ) {}

  // -- RFQ lifecycle -----------------------------------------------------------------

  @Get("rfqs")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.read")
  listRfqs(
    @Req() request: Request,
    @Query("status") status?: string,
    @Query("branchId") branchId?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(this.rfqs.list({ status, branchId, limit: LIMIT(limit, 200) }));
  }

  @Get("rfqs/:id")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.read")
  async getRfq(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.rfqs.findWithLines(UUID.parse(id)));
  }

  @Post("rfqs")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async createRfq(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRfqSchema.parse(body);
    return envelope(
      await this.rfqs.create({
        branchId: input.branchId,
        title: input.title,
        titleAr: input.titleAr ?? null,
        mode: input.mode,
        currencyCode: input.currencyCode,
        dueAt: input.dueAt ?? null,
        invitedSuppliers: input.invitedSuppliers,
        lines: input.lines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          targetPrice: l.targetPrice ?? null,
          note: l.note ?? null,
        })),
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("rfqs/:id")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async updateRfq(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateRfqSchema.parse(body);
    return envelope(
      await this.rfqs.update(UUID.parse(id), {
        title: input.title,
        titleAr: input.titleAr,
        mode: input.mode,
        dueAt: input.dueAt,
        invitedSuppliers: input.invitedSuppliers,
        note: input.note,
        noteAr: input.noteAr,
        lines: input.lines?.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          targetPrice: l.targetPrice ?? null,
          note: l.note ?? null,
        })),
        actorId: identity.userId,
      }),
    );
  }

  @Post("rfqs/:id/issue")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async issueRfq(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.rfqs.issue(UUID.parse(id), identity.userId));
  }

  @Post("rfqs/:id/close")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async closeRfq(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.rfqs.close(UUID.parse(id), identity.userId));
  }

  @Post("rfqs/:id/cancel")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async cancelRfq(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(body);
    return envelope(await this.rfqs.cancel(UUID.parse(id), input.reason, identity.userId));
  }

  // -- quotes (back-office entry) + portal invite admin -------------------------------

  @Get("rfqs/:id/quotes")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.read")
  async listQuotes(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.quotes.listForRfq(UUID.parse(id)));
  }

  @Post("rfqs/:id/quotes")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async submitQuote(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = backOfficeQuoteSchema.parse(body);
    return envelope(
      await this.quotes.submit({
        rfqId: UUID.parse(id),
        supplierId: input.supplierId,
        quoteRef: input.quoteRef ?? null,
        submittedVia: "BACK_OFFICE",
        currencyCode: input.currencyCode,
        leadTimeDays: input.leadTimeDays ?? null,
        validUntil: input.validUntil ?? null,
        paymentTerms: input.paymentTerms ?? null,
        submittedBy: identity.userId,
        portalContact: null,
        note: input.note ?? null,
        lines: input.lines.map((l) => ({
          rfqLineId: l.rfqLineId,
          qty: l.qty,
          unitPrice: l.unitPrice,
          leadTimeDays: l.leadTimeDays ?? null,
          note: l.note ?? null,
        })),
      }),
    );
  }

  @Post("rfqs/:id/portal-invites")
  @RequireFeature("purchasing.supplier_portal")
  @RequirePermissions("purchasing.rfqs.manage")
  async mintPortalInvite(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = mintInviteSchema.parse(body);
    return envelope(
      await this.quotes.mintPortalInvite({
        rfqId: UUID.parse(id),
        supplierId: input.supplierId,
        expiresAt: input.expiresAt,
        actorId: identity.userId,
      }),
    );
  }

  @Post("rfqs/:id/portal-invites/revoke")
  @RequireFeature("purchasing.supplier_portal")
  @RequirePermissions("purchasing.rfqs.manage")
  async revokePortalInvite(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ supplierId: UUID }).parse(body);
    await this.quotes.revokePortalInvite({
      rfqId: UUID.parse(id),
      supplierId: input.supplierId,
      actorId: identity.userId,
    });
    return envelope({ revoked: true });
  }

  // -- comparison + award --------------------------------------------------------------

  @Get("rfqs/:id/comparison")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.read")
  async getComparison(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.awards.findLiveByRfq(UUID.parse(id)));
  }

  @Post("rfqs/:id/comparison")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async prepareComparison(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.awards.prepare({ rfqId: UUID.parse(id), actorId: identity.userId }));
  }

  @Post("comparisons/:id/award")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.award")
  async award(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = awardSchema.parse(body);
    return envelope(
      await this.awards.award({
        comparisonId: UUID.parse(id),
        decisions: input.decisions,
        blanketOrderId: input.blanketOrderId ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("comparisons/:id/cancel")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async cancelComparison(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.awards.cancel(UUID.parse(id), identity.userId));
  }

  // -- blanket agreements ----------------------------------------------------------------

  @Get("blanket-orders")
  @RequireFeature("purchasing.blanket_orders")
  @RequirePermissions("purchasing.rfqs.read")
  listBlankets(
    @Req() request: Request,
    @Query("status") status?: string,
    @Query("supplierId") supplierId?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(this.blankets.list({ status, supplierId, limit: LIMIT(limit, 200) }));
  }

  @Get("blanket-orders/:id")
  @RequireFeature("purchasing.blanket_orders")
  @RequirePermissions("purchasing.rfqs.read")
  async getBlanket(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.blankets.findWithReleases(UUID.parse(id)));
  }

  @Post("blanket-orders")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("purchasing.blanket_orders")
  @RequirePermissions("purchasing.rfqs.manage")
  async createBlanket(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createBlanketSchema.parse(body);
    return envelope(
      await this.blankets.create({
        branchId: input.branchId,
        supplierId: input.supplierId,
        contractId: input.contractId ?? null,
        title: input.title,
        titleAr: input.titleAr ?? null,
        currencyCode: input.currencyCode,
        validFrom: input.validFrom,
        validTo: input.validTo,
        minCommitment: input.minCommitment,
        maxCommitment: input.maxCommitment,
        priceLock: input.priceLock,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("blanket-orders/:id/releases")
  @RequireFeature("purchasing.blanket_orders")
  @RequirePermissions("purchasing.rfqs.manage")
  async releaseBlanket(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = releaseSchema.parse(body);
    return envelope(
      await this.blankets.release({
        blanketId: UUID.parse(id),
        lines: input.lines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          unitPrice: l.unitPrice ?? null,
          note: l.note,
        })),
        releaseDate: input.releaseDate ?? new Date().toISOString().slice(0, 10),
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("blanket-orders/:id/close")
  @RequireFeature("purchasing.blanket_orders")
  @RequirePermissions("purchasing.rfqs.manage")
  async closeBlanket(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.blankets.close(UUID.parse(id), identity.userId));
  }

  // -- supplier collaboration ---------------------------------------------------------------

  @Get("supplier-ratings")
  @RequireFeature("purchasing.supplier_scorecards")
  @RequirePermissions("purchasing.rfqs.read")
  listRatings(@Req() request: Request, @Query("limit") limit?: string) {
    requireIdentity(request);
    return envelope(this.scorecards.list(LIMIT(limit, 200)));
  }

  @Get("supplier-ratings/:supplierId")
  @RequireFeature("purchasing.supplier_scorecards")
  @RequirePermissions("purchasing.rfqs.read")
  async getRating(@Req() request: Request, @Param("supplierId") supplierId: string) {
    requireIdentity(request);
    return envelope(await this.scorecards.find(UUID.parse(supplierId)));
  }

  @Post("supplier-ratings/:supplierId/recompute")
  @RequireFeature("purchasing.supplier_scorecards")
  @RequirePermissions("purchasing.suppliers.rate")
  async recomputeRating(@Req() request: Request, @Param("supplierId") supplierId: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ windowDays: z.number().int().min(7).max(730).optional() }).parse(body ?? {});
    return envelope(
      await this.scorecards.recompute({
        supplierId: UUID.parse(supplierId),
        windowDays: input.windowDays,
        computedBy: identity.userId,
      }),
    );
  }

  @Get("approved-supplier-items")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.read")
  listApprovedItems(
    @Req() request: Request,
    @Query("supplierId") supplierId?: string,
    @Query("itemId") itemId?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(this.scorecards.listApprovedItems({ supplierId, itemId, limit: LIMIT(limit, 200) }));
  }

  @Post("approved-supplier-items")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async upsertApprovedItem(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = approvedItemSchema.parse(body);
    return envelope(
      await this.scorecards.upsertApprovedItem({
        supplierId: input.supplierId,
        itemId: input.itemId,
        status: input.status,
        expiresAt: input.expiresAt ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- advances + early-payment discounts (G-33/G-34) -------------------------------------------

  @Get("supplier-advances")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.read")
  listAdvances(
    @Req() request: Request,
    @Query("supplierId") supplierId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(this.advances.list({ supplierId, status, limit: LIMIT(limit, 200) }));
  }

  @Post("supplier-advances")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async createAdvance(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = advanceSchema.parse(body);
    return envelope(
      await this.advances.create({
        supplierId: input.supplierId,
        currencyCode: input.currencyCode,
        amount: input.amount,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("supplier-advances/:id/approve")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async approveAdvance(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.advances.approve(UUID.parse(id), identity.userId));
  }

  @Post("supplier-advances/:id/disburse")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async disburseAdvance(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = disburseSchema.parse(body);
    return envelope(
      await this.advances.disburse({
        id: UUID.parse(id),
        cashAccountId: input.cashAccountId,
        entryDate: input.entryDate,
        actorId: identity.userId,
      }),
    );
  }

  @Post("supplier-advances/:id/apply")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async applyAdvance(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = applyAdvanceSchema.parse(body);
    return envelope(
      await this.advances.apply({
        id: UUID.parse(id),
        amount: input.amount,
        entryDate: input.entryDate,
        actorId: identity.userId,
      }),
    );
  }

  @Post("supplier-advances/:id/cancel")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async cancelAdvance(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(body);
    return envelope(await this.advances.cancel(UUID.parse(id), input.reason, identity.userId));
  }

  @Get("early-payment-discount-terms")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.read")
  listTerms(@Req() request: Request, @Query("limit") limit?: string) {
    requireIdentity(request);
    return envelope(this.advances.listTerms(LIMIT(limit, 200)));
  }

  @Post("early-payment-discount-terms")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async upsertTerms(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = termsSchema.parse(body);
    return envelope(
      await this.advances.upsertTerms({
        supplierId: input.supplierId,
        discountPct: input.discountPct,
        discountDays: input.discountDays,
        minInvoiceAmount: input.minInvoiceAmount,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("early-payment-discount-terms/:id/approve")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async approveTerms(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.advances.approveTerms(UUID.parse(id), identity.userId));
  }

  @Post("early-payment-discount-captures")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async captureDiscount(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = captureSchema.parse(body);
    return envelope(
      await this.advances.captureDiscount({
        invoiceId: input.invoiceId,
        paymentId: input.paymentId,
        entryDate: input.entryDate,
        actorId: identity.userId,
      }),
    );
  }

  // -- CAPEX requests ------------------------------------------------------------------------

  @Get("capex-requests")
  @RequireFeature("purchasing.capex_requests")
  @RequirePermissions("purchasing.capex.read")
  listCapex(
    @Req() request: Request,
    @Query("status") status?: string,
    @Query("branchId") branchId?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(this.capex.list({ status, branchId, limit: LIMIT(limit, 200) }));
  }

  @Get("capex-requests/:id")
  @RequireFeature("purchasing.capex_requests")
  @RequirePermissions("purchasing.capex.read")
  async getCapex(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.capex.find(UUID.parse(id)));
  }

  @Post("capex-requests")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("purchasing.capex_requests")
  @RequirePermissions("purchasing.capex.manage")
  async createCapex(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = capexSchema.parse(body);
    return envelope(
      await this.capex.create({
        branchId: input.branchId,
        title: input.title,
        titleAr: input.titleAr ?? null,
        description: input.description ?? null,
        accountId: input.accountId,
        costCenterId: input.costCenterId ?? null,
        projectId: input.projectId ?? null,
        estimatedAmount: input.estimatedAmount,
        currencyCode: input.currencyCode,
        neededBy: input.neededBy ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("capex-requests/:id")
  @RequireFeature("purchasing.capex_requests")
  @RequirePermissions("purchasing.capex.manage")
  async updateCapex(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = capexSchema.partial().omit({ branchId: true, currencyCode: true }).parse(body);
    return envelope(
      await this.capex.update(UUID.parse(id), {
        title: input.title,
        titleAr: input.titleAr,
        description: input.description,
        accountId: input.accountId,
        costCenterId: input.costCenterId,
        projectId: input.projectId,
        estimatedAmount: input.estimatedAmount,
        neededBy: input.neededBy,
        actorId: identity.userId,
      }),
    );
  }

  @Post("capex-requests/:id/submit")
  @RequireFeature("purchasing.capex_requests")
  @RequirePermissions("purchasing.capex.manage")
  async submitCapex(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.capex.submit(UUID.parse(id), identity.userId));
  }

  @Post("capex-requests/:id/approve")
  @RequireFeature("purchasing.capex_requests")
  @RequirePermissions("purchasing.capex.approve")
  async approveCapex(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.capex.approve(UUID.parse(id), identity.userId));
  }

  @Post("capex-requests/:id/reject")
  @RequireFeature("purchasing.capex_requests")
  @RequirePermissions("purchasing.capex.approve")
  async rejectCapex(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(body);
    return envelope(await this.capex.reject(UUID.parse(id), input.reason, identity.userId));
  }

  @Post("capex-requests/:id/cancel")
  @RequireFeature("purchasing.capex_requests")
  @RequirePermissions("purchasing.capex.manage")
  async cancelCapex(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(body);
    return envelope(await this.capex.cancel(UUID.parse(id), input.reason, identity.userId));
  }

  // -- tender intake -------------------------------------------------------------------------

  @Get("tender-intakes")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.read")
  listTenders(
    @Req() request: Request,
    @Query("status") status?: string,
    @Query("ourDecision") ourDecision?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(this.tenders.list({ status, ourDecision, limit: LIMIT(limit, 200) }));
  }

  @Get("tender-intakes/:id")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.read")
  async getTender(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.tenders.find(UUID.parse(id)));
  }

  @Post("tender-intakes")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async createTender(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = tenderSchema.parse(body);
    return envelope(
      await this.tenders.create({
        title: input.title,
        titleAr: input.titleAr ?? null,
        announcingAuthority: input.announcingAuthority,
        tenderRefNo: input.tenderRefNo ?? null,
        publishedAt: input.publishedAt ?? null,
        submissionDeadline: input.submissionDeadline ?? null,
        estimatedValue: input.estimatedValue ?? null,
        currencyCode: input.currencyCode ?? null,
        govRegistrationNo: input.govRegistrationNo ?? null,
        govRegistrationExpiry: input.govRegistrationExpiry ?? null,
        classificationCode: input.classificationCode ?? null,
        sourceUrl: input.sourceUrl ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("tender-intakes/:id")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async updateTender(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = tenderSchema.partial().parse(body);
    return envelope(
      await this.tenders.update(UUID.parse(id), {
        title: input.title,
        titleAr: input.titleAr,
        announcingAuthority: input.announcingAuthority,
        tenderRefNo: input.tenderRefNo,
        publishedAt: input.publishedAt,
        submissionDeadline: input.submissionDeadline,
        estimatedValue: input.estimatedValue,
        currencyCode: input.currencyCode,
        govRegistrationNo: input.govRegistrationNo,
        govRegistrationExpiry: input.govRegistrationExpiry,
        classificationCode: input.classificationCode,
        sourceUrl: input.sourceUrl,
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  @Post("tender-intakes/:id/decide")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async decideTender(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = decideSchema.parse(body);
    return envelope(
      await this.tenders.decide(UUID.parse(id), {
        ourDecision: input.ourDecision,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("tender-intakes/:id/close")
  @RequireFeature("purchasing.rfqs")
  @RequirePermissions("purchasing.rfqs.manage")
  async closeTender(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.tenders.close(UUID.parse(id), identity.userId));
  }
}
