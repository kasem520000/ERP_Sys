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

import { envelope, paginatedEnvelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { UnauthenticatedError } from "../../identity/api/identity";
import { JournalService } from "../application/journal-service";
import { OpeningBalancesPostingService } from "../application/opening-balances-service";
import { YearEndService } from "../application/year-end-service";

/**
 * Journal routes (PHASE-007 §4; matrix §3.1): manual-journal lifecycle
 * (draft CRUD → submit → approve → post → reverse), recurring definitions
 * + due generation, approval policies, the approvals queue, opening-balance
 * posting, and the year-end close. POST actions carry Idempotency-Key
 * semantics through the engine's source keys (INV-013).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const MONEY = z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, "decimal string");
const LIMIT = z.coerce.number().int().min(1).max(100).default(25);

const lineSchema = z.object({
  accountId: z.string().uuid(),
  direction: z.enum(["DEBIT", "CREDIT"]),
  amount: MONEY,
  partnerId: z.string().uuid().nullish(),
  itemId: z.string().uuid().nullish(),
  costCenterId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
  taxCodeId: z.string().uuid().nullish(),
  memo: z.string().min(1).max(500).nullish(),
  memoAr: z.string().min(1).max(500).nullish(),
});

const draftCreateSchema = z.object({
  entryDate: DATE,
  currencyCode: z.string().length(3).optional(),
  exchangeRate: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/).nullish(),
  rateSource: z.enum(["TABLE", "MANUAL"]).optional(),
  description: z.string().min(1).max(2000).nullish(),
  descriptionAr: z.string().min(1).max(2000).nullish(),
  reference: z.string().min(1).max(100).nullish(),
  lines: z.array(lineSchema).min(2),
  templateId: z.string().uuid().nullish(),
  recurrenceId: z.string().uuid().nullish(),
});

const draftPatchSchema = z.object({
  entryDate: DATE.optional(),
  exchangeRate: z.string().regex(/^\d{1,12}(\.\d{1,8})?$/).nullish(),
  description: z.string().min(1).max(2000).nullish(),
  descriptionAr: z.string().min(1).max(2000).nullish(),
  reference: z.string().min(1).max(100).nullish(),
  lines: z.array(lineSchema).min(2).optional(),
});

const postSchema = z.object({
  softCloseReason: z.string().min(3).max(500).optional(),
});

const reverseSchema = z.object({
  entryDate: DATE,
  reason: z.string().min(3).max(500),
});

const recurringCreateSchema = z.object({
  name: z.string().min(1).max(200),
  schedule: z.enum(["MONTHLY", "WEEKLY", "DAILY", "QUARTERLY", "YEARLY"]),
  startDate: DATE,
  endDate: DATE.nullish(),
  nextRunDate: DATE,
  amountPolicy: z.enum(["FIXED", "RE_ENTER"]),
  lines: z.array(lineSchema).min(2),
});

const policyCreateSchema = z.object({
  docType: z.string().min(3).max(40),
  mode: z.enum(["none", "single-approver", "two-step", "amount-threshold"]),
  threshold: z.string().regex(/^\d{1,15}(\.\d{1,4})?$/).nullish(),
  appliesFrom: DATE,
});

const yearEndSchema = z.object({ reason: z.string().min(3).max(500).optional() });

@Controller("api/v1/accounting")
export class JournalsController {
  constructor(
    @Inject(JournalService) private readonly journals: JournalService,
    @Inject(OpeningBalancesPostingService) private readonly opening: OpeningBalancesPostingService,
    @Inject(YearEndService) private readonly yearEnd: YearEndService,
  ) {}

  // -- manual journal drafts ------------------------------------------------------

  @Get("journal-entries")
  @RequirePermissions("accounting.journal_entries.view")
  async list(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    const page = await this.journals.list({ status, limit: LIMIT.parse(limit ?? undefined) });
    return paginatedEnvelope(page, { limit: page.length, hasMore: false });
  }

  @Get("journal-entries/:id")
  @RequirePermissions("accounting.journal_entries.view")
  async get(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.journals.get(id));
  }

  @Post("journal-entries")
  @RequirePermissions("accounting.journal_entries.create")
  @HttpCode(HttpStatus.OK)
  async create(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = draftCreateSchema.parse(body);
    return envelope(
      await this.journals.create(identity.userId, {
        entryDate: input.entryDate,
        currencyCode: input.currencyCode,
        exchangeRate: input.exchangeRate ?? null,
        rateSource: input.rateSource,
        description: input.description ?? null,
        descriptionAr: input.descriptionAr ?? null,
        reference: input.reference ?? null,
        lines: input.lines.map((line) => ({
          accountId: line.accountId,
          direction: line.direction,
          amount: line.amount,
          partnerId: line.partnerId ?? null,
          itemId: line.itemId ?? null,
          costCenterId: line.costCenterId ?? null,
          projectId: line.projectId ?? null,
          taxCodeId: line.taxCodeId ?? null,
          memo: line.memo ?? null,
          memoAr: line.memoAr ?? null,
        })),
        templateId: input.templateId ?? null,
        recurrenceId: input.recurrenceId ?? null,
      }),
    );
  }

  @Patch("journal-entries/:id")
  @RequirePermissions("accounting.journal_entries.create")
  async patch(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = draftPatchSchema.parse(body);
    return envelope(
      await this.journals.update(identity.userId, id, {
        entryDate: input.entryDate,
        exchangeRate: input.exchangeRate,
        description: input.description,
        descriptionAr: input.descriptionAr,
        reference: input.reference,
        lines: input.lines?.map((line) => ({
          accountId: line.accountId,
          direction: line.direction,
          amount: line.amount,
          partnerId: line.partnerId ?? null,
          itemId: line.itemId ?? null,
          costCenterId: line.costCenterId ?? null,
          projectId: line.projectId ?? null,
          taxCodeId: line.taxCodeId ?? null,
          memo: line.memo ?? null,
          memoAr: line.memoAr ?? null,
        })),
      }),
    );
  }

  @Post("journal-entries/:id/submit")
  @RequirePermissions("accounting.journal_entries.create")
  @HttpCode(HttpStatus.OK)
  async submit(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.journals.submit(identity.userId, id));
  }

  @Post("journal-entries/:id/approve")
  @RequirePermissions("accounting.journal_entries.approve")
  @HttpCode(HttpStatus.OK)
  async approve(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const note = z
      .object({ note: z.string().min(1).max(500).optional() })
      .parse(body ?? {});
    return envelope(await this.journals.approve(identity.userId, id, note.note));
  }

  @Post("journal-entries/:id/post")
  @RequirePermissions("accounting.journal_entries.post")
  @HttpCode(HttpStatus.OK)
  async post(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = postSchema.parse(body ?? {});
    return envelope(await this.journals.post(identity.userId, id, input));
  }

  @Post("journal-entries/:id/reverse")
  @RequirePermissions("accounting.journal_entries.reverse")
  @HttpCode(HttpStatus.OK)
  async reverse(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = reverseSchema.parse(body);
    return envelope(
      await this.journals.reverse(identity.userId, id, {
        entryDate: input.entryDate,
        reason: input.reason,
      }),
    );
  }

  @Post("journal-entries/:id/cancel")
  @RequirePermissions("accounting.journal_entries.create")
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = z.object({ reason: z.string().min(3).max(500) }).parse(body);
    return envelope(await this.journals.cancel(identity.userId, id, input.reason));
  }

  @Get("journal-entries/:id/preview")
  @RequirePermissions("accounting.journal_entries.approve")
  async preview(@Param("id") id: string): Promise<unknown> {
    // BR-034: the approver preview is the EXACT spec the engine will post.
    return envelope(await this.journals.previewSpec(id));
  }

  // -- approvals queue + policies ----------------------------------------------------

  @Get("approvals/queue")
  @RequirePermissions("accounting.journal_entries.approve")
  async approvalsQueue(
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    const page = await this.journals.list({
      status: "PENDING_APPROVAL",
      limit: LIMIT.parse(limit ?? undefined),
    });
    return paginatedEnvelope(page, { limit: page.length, hasMore: false });
  }

  @Get("approval-policies")
  @RequirePermissions("accounting.journal_entries.view")
  async listPolicies(): Promise<unknown> {
    return envelope(await this.journals.listPolicies());
  }

  @Post("approval-policies")
  @RequirePermissions("accounting.accounts.manage")
  @HttpCode(HttpStatus.OK)
  async createPolicy(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = policyCreateSchema.parse(body);
    return envelope(
      await this.journals.upsertPolicy(identity.userId, {
        docType: input.docType,
        mode: input.mode,
        threshold: input.threshold ?? null,
        appliesFrom: input.appliesFrom,
      }),
    );
  }

  // -- recurring journals -------------------------------------------------------------

  @Get("recurring-journals")
  @RequirePermissions("accounting.journal_entries.view")
  async listRecurring(): Promise<unknown> {
    return envelope(await this.journals.listRecurring());
  }

  @Post("recurring-journals")
  @RequirePermissions("accounting.journal_entries.create")
  @HttpCode(HttpStatus.OK)
  async createRecurring(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = recurringCreateSchema.parse(body);
    return envelope(
      await this.journals.createRecurring(identity.userId, {
        name: input.name,
        template: {
          lines: input.lines.map((line) => ({
            accountId: line.accountId,
            direction: line.direction,
            amount: line.amount,
            partnerId: line.partnerId ?? null,
            itemId: line.itemId ?? null,
            costCenterId: line.costCenterId ?? null,
            projectId: line.projectId ?? null,
            taxCodeId: line.taxCodeId ?? null,
            memo: line.memo ?? null,
            memoAr: line.memoAr ?? null,
          })),
          amountPolicy: input.amountPolicy,
        },
        schedule: input.schedule,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        nextRunDate: input.nextRunDate,
      }),
    );
  }

  @Post("recurring-journals/:id/status")
  @RequirePermissions("accounting.journal_entries.create")
  @HttpCode(HttpStatus.OK)
  async setRecurringStatus(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = z.object({ status: z.enum(["ACTIVE", "PAUSED"]) }).parse(body);
    return envelope(await this.journals.setRecurringStatus(identity.userId, id, input.status));
  }

  @Post("recurring-journals/generate-due")
  @RequirePermissions("accounting.journal_entries.post")
  @HttpCode(HttpStatus.OK)
  async generateDue(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = z.object({ asOf: DATE.optional() }).parse(body ?? {});
    const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
    return envelope(await this.journals.generateDueRecurring(identity.userId, asOf));
  }

  // -- opening balances + year-end ------------------------------------------------------

  @Get("opening-balances")
  @RequirePermissions("accounting.journal_entries.view")
  async listOpening(@Query("kind") kind?: string): Promise<unknown> {
    return envelope(await this.opening.listDrafts(kind));
  }

  @Post("opening-balances/:yearId/post")
  @RequirePermissions("accounting.opening_balances.post")
  @HttpCode(HttpStatus.OK)
  async postOpening(@Req() request: Request, @Param("yearId") yearId: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.opening.post(identity.userId, yearId));
  }

  @Post("year-end-close/:yearId/execute")
  @RequirePermissions("accounting.year_end_close.execute")
  @HttpCode(HttpStatus.OK)
  async executeYearEnd(@Req() request: Request, @Param("yearId") yearId: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.yearEnd.execute(identity.userId, yearId));
  }

  @Post("year-end-close/:yearId/reverse")
  @RequirePermissions("accounting.year_end_close.execute")
  @HttpCode(HttpStatus.OK)
  async reverseYearEnd(
    @Req() request: Request,
    @Param("yearId") yearId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = yearEndSchema.parse(body ?? {});
    return envelope(
      await this.yearEnd.reverse(identity.userId, yearId, input.reason ?? "year-end correction"),
    );
  }
}
