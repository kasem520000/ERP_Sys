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
import { CollectionsService } from "../application/collections-service";
import { IncotermsService } from "../application/incoterms-service";

/**
 * PHASE-051 (W-35 — T-07 + T-08, 2026-11-25) the trade collections +
 * incoterms routes (matrix §3.29, the keys-seed-first discipline's
 * second trade binding wave — the keys landed at W-33 (0122 §5), the
 * routes bind as the service waves ship, every change dated at the
 * ROUTE_PERMISSIONS block): the collections family binds
 * trade.collections.manage over the register acts (create · present ·
 * accept — the usance act, D/A only · settle — the settlement
 * linkage · cancel — the stamp law's OPEN-only exit) and the reads
 * bind trade.view (the matrix row's own wording names the
 * LC/collections registers — the finance-read plane; no family view
 * key exists, the LC precedent bound the family key it HAD); the
 * incoterms registry reads bind trade.view (the plane's reference
 * register — the W-39 reference page and the selector's data source)
 * and the tenant-addition MANAGEMENT binds trade.collections.manage
 * (the W-35 wave's register-act key — the matrix's own non-ledger
 * owner posture; the dated interpretation recorded at the block). The
 * routes are feature-gated at the controller on the whole-module unit
 * `trade` (D-04 — the collections/incoterms families carry no own
 * flag; a STARTER tenant sees the feature-gated refusal, the
 * entitlements guard's own envelope). Foreign/unknown ids are
 * 404-shaped (A7 — RLS makes them indistinguishable); the matrix row
 * renders the risk-hint matrix from the registry row's OWN data
 * (D-10) on every read.
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
const CURRENCY = z.string().regex(/^[A-Z]{3}$/, "an ISO-4217 code (3 uppercase letters)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "decimal (≤ 4dp)");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "an ISO date (yyyy-mm-dd)");
const TERMS = z.enum(["D/P", "D/A"]);
const DOC_ENTRY = z
  .string()
  .regex(/^[A-Za-z0-9 _/-]{1,120}$/, "a document entry (1…120 chars)");
const CODE = z
  .string()
  .regex(/^[A-Z0-9]{2,8}$/, "2…8 uppercase letters/digits (the 0120 floor)");
const NAME = z.string().min(2).max(120);
const BOOLEAN = z.boolean();

const createCollectionSchema = z
  .object({
    purchaseOrderId: UUID.nullable().optional(),
    termsType: TERMS,
    amount: MONEY,
    currency: CURRENCY,
    dueDate: DATE.nullable().optional(),
    documents: z.array(DOC_ENTRY).min(1).max(40),
    note: NOTE,
    noteAr: NOTE,
  });

const settleSchema = z.object({
  settlementRef: z.string().min(1).max(200),
});

const createIncotermSchema = z.object({
  code: CODE,
  name: NAME,
  nameAr: NAME,
  carriageBySeller: BOOLEAN,
  insuranceBySeller: BOOLEAN,
  exportClearanceBySeller: BOOLEAN,
  importClearanceBySeller: BOOLEAN,
  importDutyBySeller: BOOLEAN,
  note: NOTE,
  noteAr: NOTE,
});

const updateIncotermSchema = z
  .object({
    // The code is accepted ONLY as the row's own identity (the frozen
    // check renders the rewrite attempt's typed refusal — the audit
    // trail's law); every other field rides the update.
    code: CODE.optional(),
    name: NAME.optional(),
    nameAr: NAME.optional(),
    carriageBySeller: BOOLEAN.optional(),
    insuranceBySeller: BOOLEAN.optional(),
    exportClearanceBySeller: BOOLEAN.optional(),
    importClearanceBySeller: BOOLEAN.optional(),
    importDutyBySeller: BOOLEAN.optional(),
    isActive: BOOLEAN.optional(),
    note: z.string().max(2000).optional(),
    noteAr: z.string().max(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "the update carries at least one field",
  });

@Controller("/api/v1/trade/collections")
export class TradeCollectionsController {
  constructor(@Inject(CollectionsService) private readonly collections: CollectionsService) {}

  // ── the register (the reads — the finance-read plane) ─────────────────

  @Get()
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  listCollections(@Query("status") status?: string) {
    return envelope(
      this.collections.list({
        status: status === undefined || status === "" ? undefined : status,
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  async findCollection(@Param("id") id: string) {
    return envelope(await this.collections.find(id));
  }

  // ── the register acts (the owner-only operational key) ─────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.collections.manage")
  @RequireFeature("trade")
  async createCollection(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createCollectionSchema.parse(body);
    return envelope(
      await this.collections.create({
        purchaseOrderId: input.purchaseOrderId ?? null,
        termsType: input.termsType,
        amount: input.amount,
        currency: input.currency,
        dueDate: input.dueDate ?? null,
        documents: input.documents,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/present")
  @RequirePermissions("trade.collections.manage")
  @RequireFeature("trade")
  async presentCollection(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.collections.present(id, { actorId: identity.userId }));
  }

  @Post(":id/accept")
  @RequirePermissions("trade.collections.manage")
  @RequireFeature("trade")
  async acceptCollection(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.collections.accept(id, { actorId: identity.userId }));
  }

  @Post(":id/settle")
  @RequirePermissions("trade.collections.manage")
  @RequireFeature("trade")
  async settleCollection(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = settleSchema.parse(body);
    return envelope(
      await this.collections.settle(id, {
        settlementRef: input.settlementRef,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/cancel")
  @RequirePermissions("trade.collections.manage")
  @RequireFeature("trade")
  async cancelCollection(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.collections.cancel(id, { actorId: identity.userId }));
  }
}

@Controller("/api/v1/trade/incoterms")
export class TradeIncotermsController {
  constructor(@Inject(IncotermsService) private readonly registry: IncotermsService) {}

  // ── the registry reads (the finance-read plane + the selector's
  // data source — the matrix renders from the row's OWN data) ────────────

  @Get()
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  listIncoterms(@Query("activeOnly") activeOnly?: string) {
    return envelope(
      this.registry.list({
        activeOnly: activeOnly === undefined || activeOnly === "" ? true : activeOnly !== "false",
      }),
    );
  }

  @Get(":code")
  @RequirePermissions("trade.view")
  @RequireFeature("trade")
  async findIncoterm(@Param("code") code: string) {
    return envelope(await this.registry.find(code));
  }

  // ── the registry management (the tenant additions — the W-35
  // register-act key, the dated interpretation at the block) ─────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("trade.collections.manage")
  @RequireFeature("trade")
  async createIncoterm(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createIncotermSchema.parse(body);
    return envelope(
      await this.registry.create({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr,
        carriageBySeller: input.carriageBySeller,
        insuranceBySeller: input.insuranceBySeller,
        exportClearanceBySeller: input.exportClearanceBySeller,
        importClearanceBySeller: input.importClearanceBySeller,
        importDutyBySeller: input.importDutyBySeller,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Put(":code")
  @RequirePermissions("trade.collections.manage")
  @RequireFeature("trade")
  async updateIncoterm(
    @Req() request: Request,
    @Param("code") code: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = updateIncotermSchema.parse(body);
    return envelope(
      await this.registry.update(code, {
        code: input.code ?? null,
        name: input.name ?? null,
        nameAr: input.nameAr ?? null,
        carriageBySeller: input.carriageBySeller ?? null,
        insuranceBySeller: input.insuranceBySeller ?? null,
        exportClearanceBySeller: input.exportClearanceBySeller ?? null,
        importClearanceBySeller: input.importClearanceBySeller ?? null,
        importDutyBySeller: input.importDutyBySeller ?? null,
        isActive: input.isActive ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }
}
