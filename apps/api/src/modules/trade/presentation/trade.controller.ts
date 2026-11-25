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

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { LcService } from "../application/lc-service";
import { TradeExpirySweepService } from "../application/trade-expiry-sweep-service";

/**
 * PHASE-051 (W-34 — T-05 + T-06, 2026-11-25) the trade LC routes (matrix
 * §3.29): every route is permission-guarded with the exact 0122-seeded
 * keys (the keys-seed-first discipline's FIRST trade binding wave — the
 * ten keys landed at W-33, the routes bind as the service waves ship,
 * every change dated at the ROUTE_PERMISSIONS block) and feature-gated
 * on the LC plane's own composable unit `trade.lc` (D-04 — the declared
 * neutral zero means a STARTER tenant sees the feature-gated refusal,
 * the entitlements guard's own envelope). Foreign/unknown ids are
 * 404-shaped (A7 — RLS makes them indistinguishable). The lifecycle
 * doors (issue · retire — the G-64 pair; the fees — the
 * financial-charges discipline; the amendments — the typed changes with
 * the margin adjustments) surface the gates' typed refusals as
 * envelopes; the sweep-config surface binds the operational config
 * (the cmms/quality expiry-sweep precedent — the effective ladder +
 * the last run's seal is operational config, never a finance read).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const TEXT = z.string().min(1).max(2000);
const NOTE = z.string().max(2000).nullable().optional();
const NAME = z.string().min(1).max(500);
const CURRENCY = z.string().regex(/^[A-Z]{3}$/, "an ISO-4217 code (3 uppercase letters)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "decimal (≤ 4dp)");
const RATE = z.string().regex(/^\d+(\.\d{1,8})?$/, "a positive rate (≤ 8dp)");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "an ISO date (yyyy-mm-dd)");
const DOC_TYPE = z
  .string()
  .regex(/^[A-Z0-9 _/-]{2,120}$/, "the 0119 checklist floor's shape");
const CHANGE_TYPE = z.enum(["VALUE", "VALIDITY", "DOCUMENTS", "OTHER"]);

const createLcSchema = z.object({
  purchaseOrderId: UUID.nullable().optional(),
  currency: CURRENCY,
  amount: MONEY,
  marginAmount: MONEY.nullable().optional(),
  exchangeRate: RATE.nullable().optional(),
  issuingBank: NAME,
  beneficiaryName: NAME,
  applicantName: NAME,
  expiryDate: DATE,
  note: NOTE,
  noteAr: NOTE,
});

const issueSchema = z.object({
  marginAmount: MONEY.nullable().optional(),
  bankAccountId: UUID.nullable().optional(),
  exchangeRate: RATE.nullable().optional(),
  entryDate: DATE.nullable().optional(),
});

const amendmentSchema = z
  .object({
    changeType: CHANGE_TYPE,
    valueFrom: MONEY.nullable().optional(),
    valueTo: MONEY.nullable().optional(),
    expiryFrom: DATE.nullable().optional(),
    expiryTo: DATE.nullable().optional(),
    documentsNote: TEXT.nullable().optional(),
    summary: TEXT.nullable().optional(),
    marginTo: MONEY.nullable().optional(),
    bankAccountId: UUID.nullable().optional(),
    exchangeRate: RATE.nullable().optional(),
    note: NOTE,
  })
  .refine(
    (value) =>
      value.changeType !== "VALUE" ||
      (value.valueFrom !== undefined && value.valueTo !== undefined),
    { message: "a VALUE amendment carries its from/to amount pair" },
  )
  .refine(
    (value) =>
      value.changeType !== "VALIDITY" ||
      (value.expiryFrom !== undefined && value.expiryTo !== undefined),
    { message: "a VALIDITY amendment carries its expiry from/to pair" },
  )
  .refine(
    (value) => value.changeType !== "DOCUMENTS" || value.documentsNote !== undefined,
    { message: "a DOCUMENTS amendment carries its note" },
  )
  .refine((value) => value.changeType !== "OTHER" || value.summary !== undefined, {
    message: "an OTHER amendment carries its summary",
  });

const documentSchema = z.object({
  docType: DOC_TYPE,
  presented: z.boolean().optional(),
  verified: z.boolean().optional(),
  discrepancyNotes: TEXT.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const feeSchema = z.object({
  amount: MONEY,
  bankAccountId: UUID,
  exchangeRate: RATE.nullable().optional(),
  entryDate: DATE.nullable().optional(),
  memo: NOTE,
});

const retireSchema = z.object({
  bankAccountId: UUID.nullable().optional(),
  exchangeRate: RATE.nullable().optional(),
  entryDate: DATE.nullable().optional(),
});

const thresholdsSchema = z.object({
  thresholds: z.array(z.number().int().min(0)).min(1).max(12),
});

@Controller("/api/v1/trade/lc")
export class TradeLcController {
  constructor(
    @Inject(LcService) private readonly lcs: LcService,
    @Inject(TradeExpirySweepService)
    private readonly expirySweep: TradeExpirySweepService,
  ) {}

  // ── the register (the reads + the DRAFT create) ─────────────────────

  @Get()
  @RequirePermissions("trade.lc.view")
  @RequireFeature("trade.lc")
  listLcs(@Query("status") status?: string) {
    return envelope(
      this.lcs.list({
        status: status === undefined || status === "" ? undefined : status,
      }),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.lc.manage")
  @RequireFeature("trade.lc")
  async createLc(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createLcSchema.parse(body);
    return envelope(
      await this.lcs.create({
        purchaseOrderId: input.purchaseOrderId ?? null,
        currency: input.currency,
        amount: input.amount,
        marginAmount: input.marginAmount ?? null,
        exchangeRate: input.exchangeRate ?? null,
        issuingBank: input.issuingBank,
        beneficiaryName: input.beneficiaryName,
        applicantName: input.applicantName,
        expiryDate: input.expiryDate,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // ── the sweep-config surface (the operational config — declared BEFORE
  // the :id routes so the literal path never falls into the parameter's)
  @Get("sweep-config")
  @RequirePermissions("trade.lc.manage")
  @RequireFeature("trade.lc")
  async sweepConfig() {
    return envelope(await this.expirySweep.effectiveConfig());
  }

  @Put("sweep-config")
  @RequirePermissions("trade.lc.manage")
  @RequireFeature("trade.lc")
  async writeSweepConfig(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = thresholdsSchema.parse(body);
    return envelope(
      await this.expirySweep.writeThresholds({
        thresholds: input.thresholds,
        actorId: identity.userId,
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("trade.lc.view")
  @RequireFeature("trade.lc")
  async findLc(@Param("id") id: string) {
    return envelope(await this.lcs.find(id));
  }

  // ── the lifecycle doors (the G-64 pair + the fees) ───────────────────

  @Post(":id/issue")
  @RequirePermissions("trade.lc.manage")
  @RequireFeature("trade.lc")
  async issueLc(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = issueSchema.parse(body);
    return envelope(
      await this.lcs.issue(id, {
        marginAmount: input.marginAmount ?? null,
        bankAccountId: input.bankAccountId ?? null,
        exchangeRate: input.exchangeRate ?? null,
        entryDate: input.entryDate ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/amendments")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.lc.manage")
  @RequireFeature("trade.lc")
  async amendLc(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = amendmentSchema.parse(body);
    return envelope(
      await this.lcs.amend(id, {
        changeType: input.changeType,
        valueFrom: input.valueFrom ?? null,
        valueTo: input.valueTo ?? null,
        expiryFrom: input.expiryFrom ?? null,
        expiryTo: input.expiryTo ?? null,
        documentsNote: input.documentsNote ?? null,
        summary: input.summary ?? null,
        marginTo: input.marginTo ?? null,
        bankAccountId: input.bankAccountId ?? null,
        exchangeRate: input.exchangeRate ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/documents")
  @RequirePermissions("trade.lc.manage")
  @RequireFeature("trade.lc")
  async recordDocument(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = documentSchema.parse(body);
    return envelope(
      await this.lcs.recordDocument(id, {
        docType: input.docType,
        presented: input.presented,
        verified: input.verified,
        discrepancyNotes: input.discrepancyNotes ?? undefined,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/fees")
  @RequirePermissions("trade.lc.manage")
  @RequireFeature("trade.lc")
  async chargeFee(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = feeSchema.parse(body);
    return envelope(
      await this.lcs.fee(id, {
        amount: input.amount,
        bankAccountId: input.bankAccountId,
        exchangeRate: input.exchangeRate ?? null,
        entryDate: input.entryDate ?? null,
        memo: input.memo ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/retire")
  @RequirePermissions("trade.lc.manage")
  @RequireFeature("trade.lc")
  async retireLc(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = retireSchema.parse(body);
    return envelope(
      await this.lcs.retire(id, {
        bankAccountId: input.bankAccountId ?? null,
        exchangeRate: input.exchangeRate ?? null,
        entryDate: input.entryDate ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/cancel")
  @RequirePermissions("trade.lc.manage")
  @RequireFeature("trade.lc")
  async cancelLc(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.lcs.cancel(id, { actorId: identity.userId }));
  }
}
