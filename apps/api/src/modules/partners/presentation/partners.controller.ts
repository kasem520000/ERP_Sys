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
import { AttachmentsService } from "../../files/api/files";
import { AuditService } from "../../audit/api/audit";
import { PartnerService } from "../application/partner-service";
import { CreditTermsService } from "../application/credit-terms-service";
import { CreditCheckService } from "../application/credit-check-service";
import { OpeningBalancesService } from "../application/opening-balances-service";
import { AttachmentOwnerNotFoundError } from "../domain/partner-errors";

/**
 * Partners routes (PHASE-006 §4; matrix §3.6): the partner directory,
 * credit terms, credit-check service interface, opening-balance DRAFT
 * capture, trigram search, and attachment slots on partners + drafts.
 * Every handler resolves the tenant scope through the
 * TenantContextInterceptor and enforces its matrix key.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const partnerCreateSchema = z.object({
  kind: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]),
  code: z.string().min(1).max(20).optional(),
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200).nullish(),
  taxNumber: z.string().min(5).max(30).nullish(),
  creditLimit: z.string().regex(/^-?\d{1,16}(\.\d{1,4})?$/, "decimal string").nullish(),
  creditTermsId: z.string().uuid().nullish(),
  priceListId: z.string().uuid().nullish(),
});

const partnerPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().min(1).max(200).nullish(),
  taxNumber: z.string().min(5).max(30).nullish(),
  creditLimit: z.string().regex(/^-?\d{1,16}(\.\d{1,4})?$/, "decimal string").nullish(),
  creditTermsId: z.string().uuid().nullish(),
  priceListId: z.string().uuid().nullish(),
  // PHASE-017 (0025): customer-tier assignment rides the ordinary partner
  // PATCH (BR-003 level 2 — distribution.customer_tiers; validated in the
  // service against the customer_tiers table).
  customerTierId: z.string().uuid().nullish(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  version: z.number().int().positive().optional(),
});

const kindChangeSchema = z.object({ kind: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]) });

const contactCreateSchema = z.object({
  name: z.string().min(1).max(200),
  phone: z.string().min(6).max(20).nullish(),
  email: z.string().email().max(200).nullish(),
  role: z.string().min(1).max(100).nullish(),
  isPrimary: z.boolean().optional(),
});

const addressCreateSchema = z.object({
  type: z.enum(["BILLING", "SHIPPING", "OTHER"]),
  line1: z.string().min(1).max(300),
  line2: z.string().min(1).max(300).nullish(),
  city: z.string().min(1).max(100).nullish(),
  countryCode: z.string().length(2).nullish(),
});

const creditTermsCreateSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200).nullish(),
  days: z.number().int().min(0).max(365),
  description: z.string().min(1).max(500).nullish(),
});

const creditTermsPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().min(1).max(200).nullish(),
  days: z.number().int().min(0).max(365).optional(),
  description: z.string().min(1).max(500).nullish(),
});

const creditCheckSchema = z.object({
  partnerId: z.string().uuid(),
  amountDelta: z.string().regex(/^-?\d{1,16}(\.\d{1,4})?$/, "decimal string"),
});

const obdCreateSchema = z.object({
  kind: z.enum(["PARTNER", "ACCOUNT", "STOCK"]),
  partnerId: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  itemId: z.string().uuid().optional(),
  amount: z.string().regex(/^-?\d{1,16}(\.\d{1,4})?$/, "decimal string").optional(),
  qty: z.string().regex(/^-?\d{1,16}(\.\d{1,6})?$/, "decimal string").optional(),
  unitCost: z.string().regex(/^-?\d{1,16}(\.\d{1,6})?$/, "decimal string").optional(),
  note: z.string().min(1).max(500).nullish(),
});

const obdPatchSchema = z.object({
  amount: z.string().regex(/^-?\d{1,16}(\.\d{1,4})?$/, "decimal string").optional(),
  qty: z.string().regex(/^-?\d{1,16}(\.\d{1,6})?$/, "decimal string").optional(),
  unitCost: z.string().regex(/^-?\d{1,16}(\.\d{1,6})?$/, "decimal string").optional(),
  note: z.string().min(1).max(500).nullish(),
  version: z.number().int().positive().optional(),
});

const attachmentUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});

const LIMIT = z.coerce.number().int().min(1).max(100).default(25);

@Controller("api/v1/partners")
export class PartnersController {
  constructor(
    @Inject(PartnerService) private readonly partners: PartnerService,
    @Inject(CreditTermsService) private readonly creditTerms: CreditTermsService,
    @Inject(CreditCheckService) private readonly creditCheck: CreditCheckService,
    @Inject(OpeningBalancesService) private readonly openingBalances: OpeningBalancesService,
    @Inject(AttachmentsService) private readonly attachments: AttachmentsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // -- partner directory (BR-025) ----------------------------------------------

  @Get("partners")
  @RequirePermissions("partners.view")
  async list(
    @Query("kind") kind?: string,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    const page = await this.partners.list(
      {
        kind: kind === "CUSTOMER" || kind === "SUPPLIER" || kind === "BOTH" ? kind : undefined,
        status,
        q,
      },
      cursor,
      LIMIT.parse(limit ?? undefined),
    );
    return paginatedEnvelope(page.rows, {
      limit: page.rows.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ?? undefined,
    });
  }

  @Post("partners")
  @RequirePermissions("partners.create")
  @HttpCode(HttpStatus.OK)
  async create(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = partnerCreateSchema.parse(body);
    return envelope(
      await this.partners.create(identity.userId, {
        kind: input.kind,
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        taxNumber: input.taxNumber ?? null,
        creditLimit: input.creditLimit ?? null,
        creditTermsId: input.creditTermsId ?? null,
        priceListId: input.priceListId ?? null,
      }),
    );
  }

  @Get("partners/:id")
  @RequirePermissions("partners.view")
  async get(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.partners.get(id));
  }

  @Patch("partners/:id")
  @RequirePermissions("partners.update")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const patch = partnerPatchSchema.parse(body);
    return envelope(await this.partners.update(identity.userId, id, patch));
  }

  /** BR-025: kind change (only while no postings). */
  @Post("partners/:id/kind")
  @RequirePermissions("partners.update")
  @HttpCode(HttpStatus.OK)
  async changeKind(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = kindChangeSchema.parse(body);
    return envelope(await this.partners.changeKind(identity.userId, id, input.kind));
  }

  @Post("partners/:id/archive")
  @RequirePermissions("partners.archive")
  @HttpCode(HttpStatus.OK)
  async archive(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.partners.archive(identity.userId, id));
  }

  @Get("partners/:id/balance")
  @RequirePermissions("partners.view")
  async balance(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.partners.balance(id));
  }

  // -- contacts + addresses --------------------------------------------------------

  @Get("partners/:id/contacts")
  @RequirePermissions("partners.view")
  async listContacts(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.partners.listContacts(id));
  }

  @Post("partners/:id/contacts")
  @RequirePermissions("partners.update")
  @HttpCode(HttpStatus.OK)
  async addContact(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = contactCreateSchema.parse(body);
    return envelope(
      await this.partners.addContact(identity.userId, id, {
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        role: input.role ?? null,
        isPrimary: input.isPrimary ?? false,
      }),
    );
  }

  @Get("partners/:id/addresses")
  @RequirePermissions("partners.view")
  async listAddresses(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.partners.listAddresses(id));
  }

  @Post("partners/:id/addresses")
  @RequirePermissions("partners.update")
  @HttpCode(HttpStatus.OK)
  async addAddress(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = addressCreateSchema.parse(body);
    return envelope(
      await this.partners.addAddress(identity.userId, id, {
        type: input.type,
        line1: input.line1,
        line2: input.line2 ?? null,
        city: input.city ?? null,
        countryCode: input.countryCode ?? null,
      }),
    );
  }

  // -- credit terms (BR-026; audited risky action) ---------------------------------

  @Get("credit-terms")
  @RequirePermissions("partners.view")
  async listCreditTerms(): Promise<unknown> {
    return envelope(await this.creditTerms.list());
  }

  @Post("credit-terms")
  @RequirePermissions("partners.credit_terms.manage")
  @HttpCode(HttpStatus.OK)
  async createCreditTerms(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = creditTermsCreateSchema.parse(body);
    return envelope(
      await this.creditTerms.create(identity.userId, {
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        days: input.days,
        description: input.description ?? null,
      }),
    );
  }

  @Patch("credit-terms/:id")
  @RequirePermissions("partners.credit_terms.manage")
  async updateCreditTerms(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const patch = creditTermsPatchSchema.parse(body);
    return envelope(await this.creditTerms.update(identity.userId, id, patch));
  }

  // -- credit-check service interface (BR-001) ---------------------------------------

  @Post("credit-check")
  @RequirePermissions("partners.view")
  @HttpCode(HttpStatus.OK)
  async checkCredit(@Body() body: unknown): Promise<unknown> {
    const input = creditCheckSchema.parse(body);
    return envelope(await this.creditCheck.checkCredit(input.partnerId, input.amountDelta));
  }

  // -- opening-balance DRAFT capture (G-16 source; no posting) -----------------------

  @Get("opening-balances")
  @RequirePermissions("partners.view")
  async listOpeningBalances(
    @Query("kind") kind?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    const normalized =
      kind === "PARTNER" || kind === "ACCOUNT" || kind === "STOCK" ? kind : undefined;
    const page = await this.openingBalances.list(normalized, cursor, LIMIT.parse(limit ?? undefined));
    return paginatedEnvelope(page.rows, {
      limit: page.rows.length,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor ?? undefined,
    });
  }

  @Post("opening-balances")
  @RequirePermissions("partners.update")
  @HttpCode(HttpStatus.OK)
  async createOpeningBalance(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = obdCreateSchema.parse(body);
    return envelope(await this.openingBalances.create(identity.userId, input));
  }

  @Get("opening-balances/:id")
  @RequirePermissions("partners.view")
  async getOpeningBalance(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.openingBalances.get(id));
  }

  @Patch("opening-balances/:id")
  @RequirePermissions("partners.update")
  async updateOpeningBalance(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const patch = obdPatchSchema.parse(body);
    return envelope(await this.openingBalances.update(identity.userId, id, patch));
  }

  // -- search (T10; CommandMenu + PartnerPicker) --------------------------------------

  @Get("search")
  @RequirePermissions("partners.view")
  async search(@Query("q") q?: string): Promise<unknown> {
    return envelope(await this.partners.search(q ?? ""));
  }

  // -- attachments (U-01…U-07; A11) ----------------------------------------------------

  @Post("partners/:id/attachments")
  @RequirePermissions("files.upload")
  @HttpCode(HttpStatus.OK)
  async uploadPartnerAttachment(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = attachmentUploadSchema.parse(body);
    try {
      await this.partners.get(id);
    } catch {
      throw new AttachmentOwnerNotFoundError("PARTNER", id);
    }
    const issued = await this.attachments.issueAttachmentUpload("PARTNER", id, input, identity.userId);
    return envelope(issued);
  }

  @Get("partners/:id/attachments")
  @RequirePermissions("files.view")
  async listPartnerAttachments(@Param("id") id: string): Promise<unknown> {
    await this.partners.get(id);
    return envelope(await this.attachments.listAttachments("PARTNER", id));
  }

  @Post("partners/:id/attachments/:attachmentId/archive")
  @RequirePermissions("files.manage")
  @HttpCode(HttpStatus.OK)
  async archivePartnerAttachment(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    await this.attachments.archiveAttachment(attachmentId);
    await this.audit.record({
      action: "attachment.archived",
      entityType: "partner",
      entityId: id,
      actorId: identity.userId,
      after: { attachment_id: attachmentId },
    });
    return envelope({ archived: true });
  }

  @Post("opening-balances/:id/attachments")
  @RequirePermissions("files.upload")
  @HttpCode(HttpStatus.OK)
  async uploadDraftAttachment(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = attachmentUploadSchema.parse(body);
    try {
      await this.openingBalances.get(id);
    } catch {
      throw new AttachmentOwnerNotFoundError("OPENING_BALANCE_DOC", id);
    }
    const issued = await this.attachments.issueAttachmentUpload("OPENING_BALANCE_DOC", id, input, identity.userId);
    return envelope(issued);
  }

  @Get("opening-balances/:id/attachments")
  @RequirePermissions("files.view")
  async listDraftAttachments(@Param("id") id: string): Promise<unknown> {
    await this.openingBalances.get(id);
    return envelope(await this.attachments.listAttachments("OPENING_BALANCE_DOC", id));
  }
}
