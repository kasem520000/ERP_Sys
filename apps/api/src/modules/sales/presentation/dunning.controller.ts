import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { DunningService } from "../application/dunning";

/**
 * Dunning routes (PHASE-039 §4; matrix §3.9): the collections workspace —
 * the policy ladder (BR-065 monotonic), the letters register with its
 * late-fee charge/waive actions (L1-12), the logged collection actions,
 * the periodic credit reviews (L1-10), and the collection-agency terminal
 * layer (L1-11). Every route is permission-guarded (the seeded 0056 keys)
 * and Idempotency-Key'd by the global POST guard; the feature gate is
 * sales.dunning (the late-fees/agencies keys ride it — 0056 §10). The
 * AGENCY-FACING callback lives in agency-portal.controller.ts (the public
 * surface); everything here is back-office.
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
const MONEY4 = z.string().regex(/^\d+\.\d{4}$/, "canonical 4-dp decimal");
const PCT = z.string().regex(/^\d+(\.\d{1,2})?$/, "percent (≤ 2dp)");
const LIMIT = (value: string | undefined, fallback: number) =>
  z.coerce.number().int().min(1).max(500).parse(value ?? fallback);

const dunningStepSchema = z.object({
  stepNo: z.number().int().min(1).max(20),
  daysOverdue: z.number().int().min(1),
  channel: z.enum(["EMAIL", "WHATSAPP", "SMS"]),
  templateKey: z.string().min(1).max(120),
  escalate: z.boolean().optional().default(false),
  referToAgency: z.boolean().optional().default(false),
});

const createPolicySchema = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().max(200).nullable().optional(),
  partnerTierIds: z.array(UUID).max(50).default([]),
  isDefault: z.boolean().default(false),
  steps: z.array(dunningStepSchema).min(1).max(20),
  lateFeeMode: z.enum(["DISABLED", "CONTRACT_RATE", "STATUTORY_CAP"]).default("DISABLED"),
  lateFeeRatePct: PCT.nullable().optional(),
  lateFeeGraceDays: z.number().int().min(0).max(365).default(0),
  lateFeeMaxAmount: MONEY4.nullable().optional(),
  lateFeeSource: z.string().min(3).max(500).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const updatePolicySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().max(200).nullable().optional(),
  partnerTierIds: z.array(UUID).max(50).optional(),
  isDefault: z.boolean().optional(),
  steps: z.array(dunningStepSchema).min(1).max(20).optional(),
  lateFeeMode: z.enum(["DISABLED", "CONTRACT_RATE", "STATUTORY_CAP"]).optional(),
  lateFeeRatePct: PCT.nullable().optional(),
  lateFeeGraceDays: z.number().int().min(0).max(365).optional(),
  lateFeeMaxAmount: MONEY4.nullable().optional(),
  lateFeeSource: z.string().min(3).max(500).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const runSweepSchema = z.object({
  asOf: DATE.optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const waiveFeeSchema = z.object({ reason: z.string().min(3).max(500) });
const chargeFeeSchema = z.object({ invoiceId: UUID });

const ACTION_TYPES = z.enum([
  "CALL",
  "EMAIL",
  "PROMISE_TO_PAY",
  "DISPUTE",
  "FIELD_VISIT",
  "PAYMENT_PLAN",
  "WRITE_OFF_REQUEST",
  "AGENCY_REFERRAL",
  "OTHER",
]) as z.ZodType<
  | "CALL"
  | "EMAIL"
  | "PROMISE_TO_PAY"
  | "DISPUTE"
  | "FIELD_VISIT"
  | "PAYMENT_PLAN"
  | "WRITE_OFF_REQUEST"
  | "AGENCY_REFERRAL"
  | "OTHER"
>;

const ACTION_OUTCOMES = z.enum([
  "PENDING",
  "PROMISED",
  "BROKEN",
  "PAID",
  "ESCALATED",
  "NO_ANSWER",
  "OTHER",
]) as z.ZodType<
  "PENDING" | "PROMISED" | "BROKEN" | "PAID" | "ESCALATED" | "NO_ANSWER" | "OTHER"
>;

const createActionSchema = z
  .object({
    partnerId: UUID,
    invoiceId: UUID.nullable().optional(),
    policyId: UUID.nullable().optional(),
    actionType: ACTION_TYPES,
    actionDate: DATE,
    outcome: ACTION_OUTCOMES.default("PENDING"),
    promisedDate: DATE.nullable().optional(),
    followUpDate: DATE.nullable().optional(),
    amount: MONEY4.nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    noteAr: z.string().max(2000).nullable().optional(),
  })
  .refine((value) => value.actionType !== "PROMISE_TO_PAY" || value.promisedDate != null, {
    message: "a PROMISE_TO_PAY action requires its promisedDate",
  });

const recordReviewSchema = z.object({
  scoreClass: z.enum(["A", "B", "C", "D"]).nullable().optional(),
  nextReviewAt: DATE.nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

const createAgencySchema = z
  .object({
    partnerId: UUID,
    contactName: z.string().max(200).nullable().optional(),
    email: z.string().max(200).nullable().optional(),
    phone: z.string().max(60).nullable().optional(),
    commissionMode: z.enum(["PCT_OF_COLLECTED", "FLAT_FEE"]),
    commissionPct: PCT.nullable().optional(),
    flatFee: MONEY4.nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    noteAr: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (value) =>
      (value.commissionMode === "PCT_OF_COLLECTED" && value.commissionPct != null) ||
      (value.commissionMode === "FLAT_FEE" && value.flatFee != null),
    { message: "PCT_OF_COLLECTED needs commissionPct; FLAT_FEE needs flatFee" },
  );

const createReferralSchema = z.object({
  agencyId: UUID,
  partnerId: UUID,
  invoiceId: UUID.nullable().optional(),
  referredAmount: MONEY4,
  referralDate: DATE,
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const settleReferralSchema = z.object({ settledAmount: MONEY4 });

@Controller("/api/v1/sales")
export class DunningController {
  constructor(@Inject(DunningService) private readonly dunning: DunningService) {}

  // -- the policy ladder -------------------------------------------------------------------

  @Get("dunning/policies")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  listPolicies(@Req() request: Request, @Query("status") status?: string, @Query("limit") limit?: string) {
    requireIdentity(request);
    return envelope(this.dunning.listPolicies({ status, limit: LIMIT(limit, 200) }));
  }

  @Post("dunning/policies")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  async createPolicy(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createPolicySchema.parse(body);
    return envelope(
      await this.dunning.createPolicy({
        name: input.name,
        nameAr: input.nameAr ?? null,
        partnerTierIds: input.partnerTierIds,
        isDefault: input.isDefault,
        steps: input.steps as unknown as Record<string, unknown>[],
        lateFeeMode: input.lateFeeMode,
        lateFeeRatePct: input.lateFeeRatePct ?? null,
        lateFeeGraceDays: input.lateFeeGraceDays,
        lateFeeMaxAmount: input.lateFeeMaxAmount ?? null,
        lateFeeSource: input.lateFeeSource ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch("dunning/policies/:id")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  async updatePolicy(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updatePolicySchema.parse(body);
    return envelope(
      await this.dunning.updatePolicy(
        UUID.parse(id),
        {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
          ...(input.partnerTierIds === undefined ? {} : { partnerTierIds: input.partnerTierIds }),
          ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
          ...(input.steps === undefined ? {} : { steps: input.steps as unknown as Record<string, unknown>[] }),
          ...(input.lateFeeMode === undefined ? {} : { lateFeeMode: input.lateFeeMode }),
          ...(input.lateFeeRatePct === undefined ? {} : { lateFeeRatePct: input.lateFeeRatePct }),
          ...(input.lateFeeGraceDays === undefined ? {} : { lateFeeGraceDays: input.lateFeeGraceDays }),
          ...(input.lateFeeMaxAmount === undefined ? {} : { lateFeeMaxAmount: input.lateFeeMaxAmount }),
          ...(input.lateFeeSource === undefined ? {} : { lateFeeSource: input.lateFeeSource }),
          ...(input.note === undefined ? {} : { note: input.note }),
          ...(input.noteAr === undefined ? {} : { noteAr: input.noteAr }),
        },
        identity.userId,
      ),
    );
  }

  @Post("dunning/policies/:id/activate")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  async activatePolicy(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.dunning.activatePolicy(UUID.parse(id), identity.userId));
  }

  @Post("dunning/policies/:id/archive")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  async archivePolicy(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.dunning.archivePolicy(UUID.parse(id), identity.userId));
  }

  // -- the sweep + the letters register -------------------------------------------------------

  @Post("dunning/run")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  async runSweep(@Req() request: Request, @Body() body: unknown) {
    requireIdentity(request);
    const input = runSweepSchema.parse(body ?? {});
    return envelope(await this.dunning.runSweep(input));
  }

  @Get("dunning/letters")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  listLetters(
    @Req() request: Request,
    @Query("partnerId") partnerId?: string,
    @Query("invoiceId") invoiceId?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      this.dunning.listLetters({
        ...(partnerId === undefined ? {} : { partnerId: UUID.parse(partnerId) }),
        ...(invoiceId === undefined ? {} : { invoiceId: UUID.parse(invoiceId) }),
        limit: LIMIT(limit, 200),
      }),
    );
  }

  @Post("dunning/letters/:id/waive-fee")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.late-fees.manage")
  async waiveFee(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = waiveFeeSchema.parse(body);
    return envelope(
      await this.dunning.waiveFee({ letterId: UUID.parse(id), reason: input.reason, actorId: identity.userId }),
    );
  }

  @Post("dunning/charge-fee")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.late-fees.manage")
  async chargeFee(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = chargeFeeSchema.parse(body);
    return envelope(await this.dunning.chargeLateFee({ invoiceId: input.invoiceId, actorId: identity.userId }));
  }

  // -- collection actions -----------------------------------------------------------------------

  @Get("dunning/actions")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  listActions(
    @Req() request: Request,
    @Query("partnerId") partnerId?: string,
    @Query("invoiceId") invoiceId?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      this.dunning.listActions({
        ...(partnerId === undefined ? {} : { partnerId: UUID.parse(partnerId) }),
        ...(invoiceId === undefined ? {} : { invoiceId: UUID.parse(invoiceId) }),
        limit: LIMIT(limit, 200),
      }),
    );
  }

  @Post("dunning/actions")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  async createAction(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createActionSchema.parse(body);
    return envelope(
      await this.dunning.recordAction({
        partnerId: input.partnerId,
        invoiceId: input.invoiceId ?? null,
        policyId: input.policyId ?? null,
        actionType: input.actionType,
        actionDate: input.actionDate,
        outcome: input.outcome,
        promisedDate: input.promisedDate ?? null,
        followUpDate: input.followUpDate ?? null,
        amount: input.amount ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- credit reviews (L1-10) -----------------------------------------------------------------------

  @Get("credit-reviews")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  listCreditReviews(@Req() request: Request, @Query("due") due?: string, @Query("asOf") asOf?: string) {
    requireIdentity(request);
    // ?due=1 → the review-due workset at asOf (default today); the plain
    // listing is the credit-risk register (partners carrying a class or a
    // review clock).
    if (due === "1") {
      return envelope(
        this.dunning.listDueReviews({ asOf: asOf ?? new Date().toISOString().slice(0, 10) }),
      );
    }
    return envelope(this.dunning.listCreditRiskRegister());
  }

  @Post("credit-reviews/:partnerId")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.dunning.manage")
  async recordReview(@Req() request: Request, @Param("partnerId") partnerId: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = recordReviewSchema.parse(body ?? {});
    return envelope(
      await this.dunning.recordReview({
        partnerId: UUID.parse(partnerId),
        scoreClass: input.scoreClass,
        nextReviewAt: input.nextReviewAt,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- collection agencies (L1-11) ---------------------------------------------------------------------

  @Get("collection-agencies")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  listAgencies(@Req() request: Request, @Query("status") status?: string, @Query("limit") limit?: string) {
    requireIdentity(request);
    return envelope(this.dunning.listAgencies({ status, limit: LIMIT(limit, 200) }));
  }

  @Post("collection-agencies")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  async createAgency(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createAgencySchema.parse(body);
    return envelope(
      await this.dunning.createAgency({
        partnerId: input.partnerId,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        commissionMode: input.commissionMode,
        commissionPct: input.commissionPct ?? null,
        flatFee: input.flatFee ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("collection-agencies/:id/issue-token")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  async issueAgencyToken(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    // The raw token is returned ONCE — only sha256(token) persists.
    return envelope(await this.dunning.issueAgencyToken(UUID.parse(id), identity.userId));
  }

  @Post("collection-agencies/:id/suspend")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  async suspendAgency(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.dunning.setAgencyStatus(UUID.parse(id), "SUSPENDED", identity.userId));
  }

  @Post("collection-agencies/:id/activate")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  async activateAgency(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.dunning.setAgencyStatus(UUID.parse(id), "ACTIVE", identity.userId));
  }

  // -- referrals (L1-11) ----------------------------------------------------------------------------------

  @Get("collection-referrals")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  listReferrals(
    @Req() request: Request,
    @Query("agencyId") agencyId?: string,
    @Query("partnerId") partnerId?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      this.dunning.listReferrals({
        ...(agencyId === undefined ? {} : { agencyId: UUID.parse(agencyId) }),
        ...(partnerId === undefined ? {} : { partnerId: UUID.parse(partnerId) }),
        limit: LIMIT(limit, 200),
      }),
    );
  }

  @Post("collection-referrals")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  async createReferral(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createReferralSchema.parse(body);
    return envelope(
      await this.dunning.referToAgency({
        agencyId: input.agencyId,
        partnerId: input.partnerId,
        invoiceId: input.invoiceId ?? null,
        referredAmount: input.referredAmount,
        referralDate: input.referralDate,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("collection-referrals/:id/settle")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  async settleReferral(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = settleReferralSchema.parse(body);
    return envelope(
      await this.dunning.settleReferral({
        referralId: UUID.parse(id),
        settledAmount: input.settledAmount,
        actorId: identity.userId,
      }),
    );
  }

  @Post("collection-referrals/:id/post-commission")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  async postCommission(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(
      await this.dunning.postCommission({ referralId: UUID.parse(id), actorId: identity.userId }),
    );
  }

  @Post("collection-referrals/:id/close")
  @RequireFeature("sales.dunning")
  @RequirePermissions("sales.collection-agencies.manage")
  async closeReferral(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(
      await this.dunning.closeReferral({ referralId: UUID.parse(id), actorId: identity.userId }),
    );
  }
}
