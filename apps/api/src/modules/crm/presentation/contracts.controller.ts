import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ContractService } from "../application/contract-service";

/**
 * Service-contract routes (PHASE-019 §11 rows 18–29; AUTHORIZATION_MATRIX
 * §3.8): the DRAFT → ACTIVE/CANCELLED/RENEWED lifecycle (CT- number at
 * activation), the §4 schedule grid + the read-only billing preview (the
 * T47 contract), and advance tagging. Every route is permission-guarded
 * (the seeded `crm.contracts.manage` key), BR-039 feature-gated on
 * `crm.service_contracts`, Idempotency-Key'd by the global POST guard, and
 * returns the success envelope. Foreign or unknown ids are 404-shaped (A7).
 * The contract posts NOTHING itself (CAPABILITY_MATRIX §2.8) — only the
 * policy-gated advance reclass (§1 row 4).
 *
 * Shares the `api/v1/crm` prefix with the T45 controllers so the registered
 * route-permissions rows match byte-for-byte.
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
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const MONEY4 = z.string().regex(/^\d+(\.\d{1,4})?$/, "expected a decimal (≤ 4dp)");
const NOTE = z.string().min(1).max(500).nullable().optional();

const milestoneSchema = z.object({
  label: z.string().min(1).max(200),
  labelAr: z.string().min(1).max(200).nullable().optional(),
  dueDate: DATE,
  amount: MONEY4,
  feeItemId: UUID.nullable().optional(),
});

/** zod's optional fields normalized to the service's explicit-null shape. */
function toMilestoneLines(
  milestones: readonly z.infer<typeof milestoneSchema>[] | null | undefined,
): import("../application/contract-service").MilestoneLineInput[] | null {
  if (milestones === null || milestones === undefined) return null;
  return milestones.map((line) => ({
    label: line.label,
    labelAr: line.labelAr ?? null,
    dueDate: line.dueDate,
    amount: line.amount,
    feeItemId: line.feeItemId ?? null,
  }));
}

/** The create shape: the contract-level feeItemId + (MILESTONES) lines. */
const createSchema = z.object({
  partnerId: UUID,
  projectId: UUID.nullable().optional(),
  title: z.string().min(1).max(200),
  titleAr: z.string().min(1).max(200).nullable().optional(),
  scope: z.string().min(1).max(2000).nullable().optional(),
  feeModel: z.enum(["RETAINER", "MILESTONES", "HOURLY"]),
  startDate: DATE,
  endDate: DATE,
  monthlyAmount: MONEY4.nullable().optional(),
  feeItemId: UUID.nullable().optional(),
  milestones: z.array(milestoneSchema).nullable().optional(),
  currencyCode: z.string().length(3).nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

/**
 * The DRAFT edit (row 21 — DRAFT-only at the service). §18 lesson 1: every
 * field is optional; an omitted feeItemId resolves the STORED grid default
 * and omitted milestones mean "unchanged" (no array checks).
 */
const updateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  titleAr: z.string().min(1).max(200).nullable().optional(),
  scope: z.string().min(1).max(2000).nullable().optional(),
  projectId: UUID.nullable().optional(),
  startDate: DATE.optional(),
  endDate: DATE.optional(),
  monthlyAmount: MONEY4.nullable().optional(),
  feeItemId: UUID.nullable().optional(),
  milestones: z.array(milestoneSchema).nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const cancelSchema = z.object({ reason: z.string().min(1).max(500) });

const renewSchema = z
  .object({
    startDate: DATE.optional(),
    endDate: DATE.optional(),
    note: NOTE,
  })
  .default({});

const advanceSchema = z.object({
  receiptId: UUID,
  amount: MONEY4,
  note: NOTE,
  noteAr: NOTE,
});

@Controller("api/v1/crm")
export class ContractsController {
  constructor(@Inject(ContractService) private readonly contracts: ContractService) {}

  @Get("contracts")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async list(
    @Query("status") status?: string,
    @Query("partnerId") partnerId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.contracts.list({
        status,
        partnerId: partnerId && UUID.safeParse(partnerId).success ? partnerId : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("contracts")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.contracts.create({
        partnerId: input.partnerId,
        projectId: input.projectId ?? null,
        title: input.title,
        titleAr: input.titleAr ?? null,
        scope: input.scope ?? null,
        feeModel: input.feeModel,
        startDate: input.startDate,
        endDate: input.endDate,
        monthlyAmount: input.monthlyAmount ?? null,
        feeItemId: input.feeItemId ?? null,
        milestones: toMilestoneLines(input.milestones),
        currencyCode: input.currencyCode ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("contracts/:id")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async get(@Param("id") id: string) {
    return envelope(await this.contracts.find(id));
  }

  @Put("contracts/:id")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateSchema.parse(body ?? {});
    return envelope(
      await this.contracts.update(id, {
        title: input.title,
        titleAr: input.titleAr,
        scope: input.scope,
        projectId: input.projectId,
        startDate: input.startDate,
        endDate: input.endDate,
        monthlyAmount: input.monthlyAmount,
        feeItemId: input.feeItemId,
        milestones: toMilestoneLines(input.milestones) ?? undefined,
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  @Post("contracts/:id/activate")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async activate(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.contracts.activate(id, identity.userId));
  }

  @Post("contracts/:id/cancel")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async cancel(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = cancelSchema.parse(body);
    return envelope(await this.contracts.cancel(id, reason, identity.userId));
  }

  @Post("contracts/:id/renew")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async renew(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = renewSchema.parse(body ?? {});
    return envelope(
      await this.contracts.renew(id, {
        startDate: input.startDate,
        endDate: input.endDate,
        note: input.note,
        actorId: identity.userId,
      }),
    );
  }

  @Get("contracts/:id/schedule")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async schedule(@Param("id") id: string) {
    return envelope(await this.contracts.listSchedule(id));
  }

  /** Row 26 — the read-only billing preview (the T47 contract). */
  @Get("contracts/:id/billing-preview")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async billingPreview(@Param("id") id: string, @Query("asOf") asOf?: string) {
    return envelope(await this.contracts.billingPreview(id, asOf ?? new Date().toISOString().slice(0, 10)));
  }

  @Post("contracts/:id/advances")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async tagAdvance(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = advanceSchema.parse(body);
    return envelope(
      await this.contracts.tagAdvance({
        contractId: id,
        receiptId: input.receiptId,
        amount: input.amount,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("contracts/:id/advances")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async advances(@Param("id") id: string) {
    return envelope(await this.contracts.listAdvances(id));
  }

  /** Row 29 — the contract-invoices guard listing (T47's run writes rows). */
  @Get("contract-invoices")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async contractInvoices(
    @Query("contractId") contractId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.contracts.listContractInvoices({
        contractId: contractId && UUID.safeParse(contractId).success ? contractId : undefined,
        status,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }
}
