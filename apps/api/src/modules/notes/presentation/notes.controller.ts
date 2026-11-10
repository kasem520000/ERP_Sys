import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { NoteService } from "../application/note-service";
import { ReceiveService } from "../application/receive-service";
import { IssueService } from "../application/issue-service";
import { CollectionService } from "../application/collection-service";
import { DishonorService } from "../application/dishonor-service";
import { EndorsementService } from "../application/endorsement-service";
import { DiscountService } from "../application/discount-service";
import {
  getOrComputePdcCalendar,
  isStale,
  CALENDAR_STALE_AFTER_HOURS,
} from "../application/pdc-calendar-queries";
import { NotesReconciliationService } from "../application/notes-reconciliation";

/**
 * Notes routes (PHASE-027 §4; matrix §3.12): every route permission-guarded
 * with the exact seeded keys, Idempotency-Key-guarded by the global POST
 * guard (IDEMPOTENCY §1.1), success envelope throughout. Foreign/unknown ids
 * are 404-shaped (A7 — RLS makes them indistinguishable).
 *
 * Permission mapping notes (the §3.12 set has 9 keys + the in-phase
 * notes.notes.return):
 *   - create/reclassify     → notes.notes.create (the doc-surface owner);
 *   - collect               → notes.notes.deposit (the bank-chain action
 *                              key — deposit+collect are one custody surface);
 *   - the RC-11 on-demand run → notes.notes.view (the read key — the
 *                              manufacturing costing.read precedent).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const UUID = z.string().uuid();
const TEXT = z.string().min(1).max(500).nullable().optional();
const CURRENCY = z.string().regex(/^[A-Z]{3}$/, "ISO currency");
const RATE = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal rate (≤ 6dp)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "non-negative decimal (≤ 4dp)");
const KIND = z.enum(["CHEQUE", "PROMISSORY_NOTE"]);
const ALLOCATIONS = z
  .array(z.object({ openItemId: UUID, amount: MONEY }))
  .max(20)
  .nullable()
  .optional();

const createNoteSchema = z.object({
  direction: z.enum(["RECEIVED", "ISSUED"]),
  kind: KIND,
  partnerId: UUID,
  number: TEXT,
  issuingBank: TEXT,
  amount: MONEY,
  currency: CURRENCY,
  exchangeRate: RATE.optional(),
  issueDate: DATE.optional(),
  maturityDate: DATE,
  sourceInvoiceId: UUID.nullable().optional(),
  allocations: ALLOCATIONS,
  note: TEXT,
  noteAr: TEXT,
  eventDate: DATE.optional(),
});

const reclassifySchema = z.object({
  number: TEXT,
  issuingBank: TEXT,
  maturityDate: DATE.optional(),
  note: TEXT,
  noteAr: TEXT,
  // Substantive fields are refused with typed NOTE_FIELDS_IMMUTABLE — the
  // schema surfaces them so the service can name them in the error.
  kind: KIND.optional(),
  direction: z.enum(["RECEIVED", "ISSUED"]).optional(),
  partnerId: UUID.optional(),
  amount: MONEY.optional(),
  currency: CURRENCY.optional(),
  sourceInvoiceId: UUID.nullable().optional(),
});

const endorseSchema = z.object({
  eventDate: DATE,
  endorsee: TEXT,
  memo: TEXT,
  memoAr: TEXT,
});

const depositSchema = z.object({
  cashAccountId: UUID,
  eventDate: DATE,
  memo: TEXT,
  memoAr: TEXT,
});

const collectSchema = z.object({
  cashAccountId: UUID.nullable().optional(),
  exchangeRate: RATE.optional(),
  eventDate: DATE,
  memo: TEXT,
  memoAr: TEXT,
});

const dishonorSchema = z.object({
  reason: z.string().min(1).max(500),
  bankFee: MONEY.nullable().optional(),
  cashAccountId: UUID.nullable().optional(),
  eventDate: DATE,
  memo: TEXT,
  memoAr: TEXT,
});

const returnSchema = z.object({
  eventDate: DATE,
  memo: TEXT,
  memoAr: TEXT,
});

const discountSchema = z.object({
  cashAccountId: UUID,
  fee: MONEY,
  eventDate: DATE,
  memo: TEXT,
  memoAr: TEXT,
});

const reconciliationSchema = z.object({
  asOf: DATE.optional(),
  runMode: z.enum(["NIGHTLY", "ON_DEMAND"]).optional(),
});

@Controller("api/v1/notes")
export class NotesController {
  constructor(
    @Inject(NoteService) private readonly notes: NoteService,
    @Inject(ReceiveService) private readonly receive: ReceiveService,
    @Inject(IssueService) private readonly issue: IssueService,
    @Inject(CollectionService) private readonly collectionSvc: CollectionService,
    @Inject(DishonorService) private readonly dishonorSvc: DishonorService,
    @Inject(EndorsementService) private readonly endorsement: EndorsementService,
    @Inject(DiscountService) private readonly discountSvc: DiscountService,
    @Inject(NotesReconciliationService)
    private readonly reconciliation: NotesReconciliationService,
  ) {}

  @Get()
  @RequirePermissions("notes.notes.view")
  async list(
    @Req() request: Request,
    @Query("kind") kind?: string,
    @Query("direction") direction?: string,
    @Query("status") status?: string,
    @Query("partnerId") partnerId?: string,
    @Query("maturityFrom") maturityFrom?: string,
    @Query("maturityTo") maturityTo?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      await this.notes.listNotes({
        kind: kind === undefined || kind === "" ? undefined : z.enum(["CHEQUE", "PROMISSORY_NOTE"]).parse(kind),
        direction: direction === undefined || direction === "" ? undefined : z.enum(["RECEIVED", "ISSUED"]).parse(direction),
        status:
          status === undefined || status === ""
            ? undefined
            : z
                .enum([
                  "IN_CUSTODY",
                  "ENDORSED_OUT",
                  "DEPOSITED",
                  "COLLECTED",
                  "DISHONORED",
                  "DISCOUNTED",
                  "RETURNED",
                ])
                .parse(status),
        partnerId: partnerId === undefined || partnerId === "" ? undefined : UUID.parse(partnerId),
        maturityFrom: maturityFrom === undefined || maturityFrom === "" ? undefined : DATE.parse(maturityFrom),
        maturityTo: maturityTo === undefined || maturityTo === "" ? undefined : DATE.parse(maturityTo),
        limit: Math.min(Number(limit ?? "200") || 200, 1000),
      }),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("notes.notes.create")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createNoteSchema.parse(body);
    const eventDate = input.eventDate ?? new Date().toISOString().slice(0, 10);
    const base = {
      partnerId: input.partnerId,
      kind: input.kind,
      number: input.number ?? null,
      issuingBank: input.issuingBank ?? null,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: input.exchangeRate ?? null,
      issueDate: input.issueDate ?? null,
      maturityDate: input.maturityDate,
      sourceInvoiceId: input.sourceInvoiceId ?? null,
      allocations: input.allocations ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      eventDate,
      actorId: identity.userId,
    };
    if (input.direction === "RECEIVED") {
      return envelope(await this.receive.receiveNote(base));
    }
    return envelope(await this.issue.issueNote(base));
  }

  @Get("pdc-calendar")
  @RequirePermissions("notes.notes.view")
  async pdcCalendar(@Req() request: Request, @Query("asOf") asOf?: string) {
    requireIdentity(request);
    const date = asOf === undefined || asOf === "" ? new Date().toISOString().slice(0, 10) : DATE.parse(asOf);
    const snapshot = await getOrComputePdcCalendar(date);
    return envelope({
      ...snapshot,
      stale: isStale(snapshot),
      staleAfterHours: CALENDAR_STALE_AFTER_HOURS,
    });
  }

  @Post("reconciliation/notes-check")
  @RequirePermissions("notes.notes.view")
  async runNotesCheck(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = reconciliationSchema.parse(body ?? {});
    return envelope(
      await this.reconciliation.runNotesCheck({
        asOf: input.asOf ?? new Date().toISOString().slice(0, 10),
        runMode: input.runMode ?? "ON_DEMAND",
        checkedBy: identity.userId,
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("notes.notes.view")
  async get(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.notes.getNote(UUID.parse(id)));
  }

  @Put(":id")
  @RequirePermissions("notes.notes.create")
  async reclassify(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = reclassifySchema.parse(body);
    const immutableAttempted: string[] = [];
    if (input.kind !== undefined) immutableAttempted.push("kind");
    if (input.direction !== undefined) immutableAttempted.push("direction");
    if (input.partnerId !== undefined) immutableAttempted.push("partnerId");
    if (input.amount !== undefined) immutableAttempted.push("amount");
    if (input.currency !== undefined) immutableAttempted.push("currency");
    if (input.sourceInvoiceId !== undefined) immutableAttempted.push("sourceInvoiceId");
    return envelope(
      await this.notes.reclassify(
        UUID.parse(id),
        {
          number: input.number ?? null,
          issuingBank: input.issuingBank ?? null,
          maturityDate: input.maturityDate,
          note: input.note ?? null,
          noteAr: input.noteAr ?? null,
        },
        immutableAttempted,
        identity.userId,
      ),
    );
  }

  @Post(":id/endorse")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("notes.notes.endorse")
  async endorse(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = endorseSchema.parse(body);
    return envelope(
      await this.endorsement.endorse({
        noteId: UUID.parse(id),
        eventDate: input.eventDate,
        endorsee: input.endorsee ?? null,
        memo: input.memo ?? null,
        memoAr: input.memoAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/deposit")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("notes.notes.deposit")
  async deposit(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = depositSchema.parse(body);
    return envelope(
      await this.collectionSvc.deposit({
        noteId: UUID.parse(id),
        cashAccountId: input.cashAccountId,
        eventDate: input.eventDate,
        memo: input.memo ?? null,
        memoAr: input.memoAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/collect")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("notes.notes.deposit")
  async collect(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = collectSchema.parse(body);
    return envelope(
      await this.collectionSvc.collect({
        noteId: UUID.parse(id),
        cashAccountId: input.cashAccountId ?? null,
        exchangeRate: input.exchangeRate ?? null,
        eventDate: input.eventDate,
        memo: input.memo ?? null,
        memoAr: input.memoAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/dishonor")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("notes.notes.record_dishonor")
  async dishonor(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = dishonorSchema.parse(body);
    return envelope(
      await this.dishonorSvc.dishonor({
        noteId: UUID.parse(id),
        reason: input.reason,
        bankFee: input.bankFee ?? null,
        cashAccountId: input.cashAccountId ?? null,
        eventDate: input.eventDate,
        memo: input.memo ?? null,
        memoAr: input.memoAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/discount")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("notes.notes.discount")
  async discount(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = discountSchema.parse(body);
    const result = await this.discountSvc.discount({
      noteId: UUID.parse(id),
      cashAccountId: input.cashAccountId,
      fee: input.fee,
      eventDate: input.eventDate,
      memo: input.memo ?? null,
      memoAr: input.memoAr ?? null,
      actorId: identity.userId,
    });
    return envelope(result);
  }

  @Post(":id/return")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("notes.notes.return")
  async returnNote(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = returnSchema.parse(body);
    return envelope(
      await this.dishonorSvc.returnNote({
        noteId: UUID.parse(id),
        eventDate: input.eventDate,
        memo: input.memo ?? null,
        memoAr: input.memoAr ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
