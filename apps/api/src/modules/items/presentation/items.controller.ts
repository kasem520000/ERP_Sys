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
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { envelope, paginatedEnvelope } from "../../../infra/http/envelope";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { UnauthenticatedError } from "../../identity/api/identity";
import { AttachmentsService } from "../../files/api/files";
import { AuditService } from "../../audit/api/audit";
import { UomService } from "../application/uom-service";
import { ItemService } from "../application/item-service";
import { PriceListService } from "../application/price-list-service";
import { CompositeService } from "../application/composite-service";
import { AttachmentOwnerNotFoundError } from "../../partners/domain/partner-errors";

/**
 * Items routes (PHASE-006 §4; matrix §3.6): the item master, categories,
 * UoM registry + conversions, barcodes, price lists + rows, the BR-003
 * resolve-price service endpoint, trigram search, and item attachment
 * slots. PHASE-009 wires the reserved tax_code_id: items + categories
 * accept tax-code assignments (the migration-0013 FK is live — validated
 * in the service with a clean typed error).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const LIMIT = z.coerce.number().int().min(1).max(100).default(25);

const itemCreateSchema = z.object({
  sku: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200).nullish(),
  kind: z.enum(["STOCK", "SERVICE", "COMPOSITE"]),
  uomId: z.string().uuid(),
  categoryId: z.string().uuid().nullish(),
  taxCodeId: z.string().uuid().nullish(),
  costingMethod: z.enum(["WAC", "FIFO"]).optional(),
  trackBatch: z.boolean().optional(),
  trackSerial: z.boolean().optional(),
  trackImei: z.boolean().optional(),
  hasExpiry: z.boolean().optional(),
  reorderLevel: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string").nullish(),
  reorderQty: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string").nullish(),
  basePrice: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string").nullish(),
});

const itemPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().min(1).max(200).nullish(),
  categoryId: z.string().uuid().nullish(),
  taxCodeId: z.string().uuid().nullish(),
  trackBatch: z.boolean().optional(),
  trackSerial: z.boolean().optional(),
  trackImei: z.boolean().optional(),
  hasExpiry: z.boolean().optional(),
  reorderLevel: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string").nullish(),
  reorderQty: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string").nullish(),
  basePrice: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string").nullish(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  version: z.number().int().positive().optional(),
});

const categoryCreateSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200).nullish(),
  parentId: z.string().uuid().nullish(),
  defaultTaxCodeId: z.string().uuid().nullish(),
});

const categoryPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().min(1).max(200).nullish(),
  parentId: z.string().uuid().nullish(),
  defaultTaxCodeId: z.string().uuid().nullish(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
});

const uomCreateSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(1).max(100),
  nameAr: z.string().min(1).max(100).nullish(),
});

const uomPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  nameAr: z.string().min(1).max(100).nullish(),
  isActive: z.boolean().optional(),
});

const conversionCreateSchema = z.object({
  fromUomId: z.string().uuid(),
  toUomId: z.string().uuid(),
  factor: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string"),
});

const barcodeCreateSchema = z.object({
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  code: z.string().min(1).max(64),
});

const priceListCreateSchema = z.object({
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200).nullish(),
  kind: z.enum(["SALE", "PURCHASE"]),
  currencyCode: z.string().length(3),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
});

const priceListPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: z.string().min(1).max(200).nullish(),
  validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  validTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

const priceRowUpsertSchema = z.object({
  itemId: z.string().uuid(),
  uomId: z.string().uuid(),
  unitPrice: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string"),
  minQty: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string").default("1"),
});

const resolvePriceSchema = z.object({
  itemId: z.string().uuid(),
  partnerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  uomId: z.string().uuid().optional(),
  qty: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string").optional(),
});

const attachmentUploadSchema = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(3).max(100),
  sizeBytes: z.number().int().positive(),
});

/** PHASE-015 T9 (`items.composite_products`): full-replace payload. */
const componentsPutSchema = z.object({
  components: z
    .array(
      z.object({
        componentItemId: z.string().uuid(),
        qty: z.string().regex(/^\d{1,16}(\.\d{1,6})?$/, "decimal string"),
      }),
    )
    .max(100),
});

@Controller("api/v1/items")
export class ItemsController {
  constructor(
    @Inject(ItemService) private readonly items: ItemService,
    @Inject(UomService) private readonly uoms: UomService,
    @Inject(PriceListService) private readonly priceLists: PriceListService,
    @Inject(CompositeService) private readonly composites: CompositeService,
    @Inject(AttachmentsService) private readonly attachments: AttachmentsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // -- item master ------------------------------------------------------------

  @Get("items")
  @RequirePermissions("items.view")
  async list(
    @Query("kind") kind?: string,
    @Query("categoryId") categoryId?: string,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    const page = await this.items.list(
      {
        kind: kind === "STOCK" || kind === "SERVICE" || kind === "COMPOSITE" ? kind : undefined,
        categoryId,
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

  @Post("items")
  @RequirePermissions("items.create")
  @HttpCode(HttpStatus.OK)
  async create(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = itemCreateSchema.parse(body);
    return envelope(
      await this.items.create(identity.userId, {
        sku: input.sku,
        name: input.name,
        nameAr: input.nameAr ?? null,
        kind: input.kind,
        uomId: input.uomId,
        categoryId: input.categoryId ?? null,
        taxCodeId: input.taxCodeId ?? null,
        costingMethod: input.costingMethod ?? "WAC",
        trackBatch: input.trackBatch ?? false,
        trackSerial: input.trackSerial ?? false,
        trackImei: input.trackImei ?? false,
        hasExpiry: input.hasExpiry ?? false,
        reorderLevel: input.reorderLevel ?? null,
        reorderQty: input.reorderQty ?? null,
        basePrice: input.basePrice ?? null,
      }),
    );
  }

  @Get("items/:id")
  @RequirePermissions("items.view")
  async get(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.items.get(id));
  }

  @Patch("items/:id")
  @RequirePermissions("items.update")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const patch = itemPatchSchema.parse(body);
    return envelope(await this.items.update(identity.userId, id, patch));
  }

  @Post("items/:id/archive")
  @RequirePermissions("items.archive")
  @HttpCode(HttpStatus.OK)
  async archive(@Req() request: Request, @Param("id") id: string): Promise<unknown> {
    const identity = requireIdentity(request);
    return envelope(await this.items.archive(identity.userId, id));
  }

  // -- composite components (PHASE-015 T9; items.composite_products) -------------

  @Get("items/:id/components")
  @RequirePermissions("items.view")
  @RequireFeature("items.composite_products")
  async listItemComponents(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.composites.listComponents(id));
  }

  @Put("items/:id/components")
  @RequirePermissions("items.update")
  @RequireFeature("items.composite_products")
  async replaceItemComponents(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = componentsPutSchema.parse(body);
    return envelope(await this.composites.setComponents(identity.userId, id, input.components));
  }

  // -- categories (bilingual tree) ----------------------------------------------

  @Get("item-categories")
  @RequirePermissions("items.view")
  async listCategories(): Promise<unknown> {
    return envelope(await this.items.listCategories());
  }

  @Post("item-categories")
  @RequirePermissions("items.create")
  @HttpCode(HttpStatus.OK)
  async createCategory(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = categoryCreateSchema.parse(body);
    return envelope(
      await this.items.createCategory(identity.userId, {
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        parentId: input.parentId ?? null,
        defaultTaxCodeId: input.defaultTaxCodeId ?? null,
      }),
    );
  }

  @Patch("item-categories/:id")
  @RequirePermissions("items.update")
  async updateCategory(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const patch = categoryPatchSchema.parse(body);
    return envelope(await this.items.updateCategory(identity.userId, id, patch));
  }

  // -- UoM registry + conversions (exact decimal factors) --------------------------

  @Get("uoms")
  @RequirePermissions("items.view")
  async listUoms(): Promise<unknown> {
    return envelope(await this.uoms.list());
  }

  @Post("uoms")
  @RequirePermissions("items.create")
  @HttpCode(HttpStatus.OK)
  async createUom(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = uomCreateSchema.parse(body);
    return envelope(
      await this.uoms.create(identity.userId, {
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
      }),
    );
  }

  @Patch("uoms/:id")
  @RequirePermissions("items.update")
  async updateUom(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const patch = uomPatchSchema.parse(body);
    return envelope(await this.uoms.update(identity.userId, id, patch));
  }

  @Get("uom-conversions")
  @RequirePermissions("items.view")
  async listConversions(): Promise<unknown> {
    return envelope(await this.uoms.listConversions());
  }

  @Post("uom-conversions")
  @RequirePermissions("items.create")
  @HttpCode(HttpStatus.OK)
  async addConversion(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = conversionCreateSchema.parse(body);
    return envelope(await this.uoms.addConversion(identity.userId, input));
  }

  // -- barcodes (scan-unique tenant-wide) ------------------------------------------

  @Get("barcodes")
  @RequirePermissions("items.view")
  async listBarcodes(@Query("itemId") itemId?: string): Promise<unknown> {
    if (itemId === undefined) {
      return envelope({ items: [] });
    }
    return envelope(await this.items.listBarcodes(itemId));
  }

  @Post("barcodes")
  @RequirePermissions("items.update")
  @HttpCode(HttpStatus.OK)
  async addBarcode(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = barcodeCreateSchema.parse(body);
    return envelope(await this.items.addBarcode(identity.userId, input));
  }

  // -- price lists (BR-003 sources) ------------------------------------------------

  @Get("price-lists")
  @RequirePermissions("items.view")
  async listPriceLists(@Query("kind") kind?: string): Promise<unknown> {
    const normalized = kind === "SALE" || kind === "PURCHASE" ? kind : undefined;
    return envelope(await this.priceLists.list(normalized));
  }

  @Post("price-lists")
  @RequirePermissions("items.price_lists.manage")
  @HttpCode(HttpStatus.OK)
  async createPriceList(@Req() request: Request, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = priceListCreateSchema.parse(body);
    return envelope(
      await this.priceLists.create(identity.userId, {
        name: input.name,
        nameAr: input.nameAr ?? null,
        kind: input.kind,
        currencyCode: input.currencyCode,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
      }),
    );
  }

  @Get("price-lists/:id")
  @RequirePermissions("items.view")
  async getPriceList(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.priceLists.get(id));
  }

  @Patch("price-lists/:id")
  @RequirePermissions("items.price_lists.manage")
  async updatePriceList(@Req() request: Request, @Param("id") id: string, @Body() body: unknown): Promise<unknown> {
    const identity = requireIdentity(request);
    const patch = priceListPatchSchema.parse(body);
    return envelope(await this.priceLists.update(identity.userId, id, patch));
  }

  @Get("price-lists/:id/items")
  @RequirePermissions("items.view")
  async listPriceRows(@Param("id") id: string): Promise<unknown> {
    return envelope(await this.priceLists.listRows(id));
  }

  @Post("price-lists/:id/items")
  @RequirePermissions("items.price_lists.manage")
  @HttpCode(HttpStatus.OK)
  async upsertPriceRow(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = priceRowUpsertSchema.parse(body);
    return envelope(await this.priceLists.upsertRow(identity.userId, id, input));
  }

  // -- BR-003 service endpoint ------------------------------------------------------

  @Post("resolve-price")
  @RequirePermissions("items.view")
  @HttpCode(HttpStatus.OK)
  async resolvePrice(@Body() body: unknown): Promise<unknown> {
    const input = resolvePriceSchema.parse(body);
    return envelope(await this.priceLists.resolvePrice(input));
  }

  // -- search (T10; CommandMenu + ItemPicker) ----------------------------------------

  @Get("search")
  @RequirePermissions("items.view")
  async search(@Query("q") q?: string): Promise<unknown> {
    return envelope(await this.items.search(q ?? ""));
  }

  // -- attachments (U-01…U-07; A11) --------------------------------------------------

  @Post("items/:id/attachments")
  @RequirePermissions("files.upload")
  @HttpCode(HttpStatus.OK)
  async uploadItemAttachment(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    const input = attachmentUploadSchema.parse(body);
    try {
      await this.items.get(id);
    } catch {
      throw new AttachmentOwnerNotFoundError("ITEM", id);
    }
    const issued = await this.attachments.issueAttachmentUpload("ITEM", id, input, identity.userId);
    return envelope(issued);
  }

  @Get("items/:id/attachments")
  @RequirePermissions("files.view")
  async listItemAttachments(@Param("id") id: string): Promise<unknown> {
    await this.items.get(id);
    return envelope(await this.attachments.listAttachments("ITEM", id));
  }

  @Post("items/:id/attachments/:attachmentId/archive")
  @RequirePermissions("files.manage")
  @HttpCode(HttpStatus.OK)
  async archiveItemAttachment(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("attachmentId") attachmentId: string,
  ): Promise<unknown> {
    const identity = requireIdentity(request);
    await this.attachments.archiveAttachment(attachmentId);
    await this.audit.record({
      action: "attachment.archived",
      entityType: "item",
      entityId: id,
      actorId: identity.userId,
      after: { attachment_id: attachmentId },
    });
    return envelope({ archived: true });
  }
}
