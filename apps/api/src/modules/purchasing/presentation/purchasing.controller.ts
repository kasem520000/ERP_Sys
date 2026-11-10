import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { PurchaseRequestService, PurchaseOrderService } from "../application/orders";
import { GoodsReceiptService } from "../application/goods-receipts";
import { SupplierInvoiceService } from "../application/supplier-invoices";
import { DebitNoteService } from "../application/debit-notes";
import { ReallocationService } from "../application/reallocations";
import { ApQueriesService } from "../application/ap-queries";
import { LandedCostService } from "../application/landed-costs";
import { OpeningApService } from "../application/opening-ap";
import { PurchasingReconciliationService } from "../application/purchasing-reconciliation";

/**
 * Purchasing routes (PHASE-011 §4; matrix §3.3): every route is
 * permission-guarded (the exact seeded matrix keys), Idempotency-Key'd by
 * the global POST guard, and returns the success envelope. Foreign or
 * unknown ids are 404-shaped (A7 — no existence disclosure). Risky keys
 * (supplier-invoice approve/post, matching.override, debit-note
 * approve/post, payments) are approval-separated + audited server-side.
 *
 * Payments themselves ride the PHASE-008 treasury routes
 * (`/api/v1/treasury/payments` — already keyed `purchasing.payments.*`);
 * this controller adds the AP-specific surfaces: re-allocations, AP
 * aging/statements, the GRNI register, and open items.
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
const PRICE = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal (≤ 6dp)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "positive decimal");
const RATE = z.string().regex(/^\d+(\.\d{1,8})?$/, "positive rate").nullable().optional();
const UUID = z.string().uuid();

const requestLineSchema = z.object({
  itemId: UUID,
  qty: QTY,
  note: z.string().min(1).max(300).nullable().optional(),
});

const createRequestSchema = z.object({
  branchId: UUID,
  neededBy: DATE.nullable().optional(),
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
  lines: z.array(requestLineSchema).min(1).max(200),
});

const orderLineSchema = z.object({
  itemId: UUID,
  qty: QTY,
  unitPrice: PRICE.nullable().optional(),
  taxCodeId: UUID.nullable().optional(),
  requestLineId: UUID.nullable().optional(),
  note: z.string().min(1).max(300).nullable().optional(),
});

const createOrderSchema = z.object({
  branchId: UUID,
  supplierId: UUID,
  orderDate: DATE,
  expectedDate: DATE.nullable().optional(),
  currencyCode: z.string().length(3),
  exchangeRate: RATE,
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
  requestId: UUID.nullable().optional(),
  revisionOfId: UUID.nullable().optional(),
  lines: z.array(orderLineSchema).min(1).max(200),
});

const grnLineSchema = z.object({
  poLineId: UUID.nullable().optional(),
  itemId: UUID,
  qty: QTY,
  unitCost: PRICE,
  accountId: UUID.nullable().optional(),
  batchNo: z.string().min(1).max(60).nullable().optional(),
  batchExpiry: DATE.nullable().optional(),
  serialIds: z.array(UUID).max(200).nullable().optional(),
  note: z.string().min(1).max(300).nullable().optional(),
});

const createGrnSchema = z.object({
  branchId: UUID,
  supplierId: UUID,
  poId: UUID.nullable().optional(),
  warehouseId: UUID,
  receiptDate: DATE,
  poLessReason: z.string().min(1).max(300).nullable().optional(),
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
  lines: z.array(grnLineSchema).min(1).max(200),
});

const invoiceLineSchema = z.object({
  grnLineId: UUID.nullable().optional(),
  itemId: UUID.nullable().optional(),
  accountId: UUID.nullable().optional(),
  description: z.string().min(1).max(300).nullable().optional(),
  descriptionAr: z.string().min(1).max(300).nullable().optional(),
  qty: QTY,
  unitPrice: PRICE,
  taxCodeId: UUID.nullable().optional(),
  vatRecoverable: z.boolean().nullable().optional(),
  note: z.string().min(1).max(300).nullable().optional(),
});

const createInvoiceSchema = z.object({
  branchId: UUID,
  supplierId: UUID,
  invoiceNo: z.string().min(1).max(60),
  invoiceDate: DATE,
  dueDate: DATE.nullable().optional(),
  currencyCode: z.string().length(3),
  exchangeRate: RATE,
  poId: UUID.nullable().optional(),
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
  lines: z.array(invoiceLineSchema).min(1).max(200),
});

const dispositionSchema = z.object({
  invoiceLineNo: z.coerce.number().int().min(1),
  type: z.enum(["ACCEPT_WITH_REASON", "DEBIT_NOTE", "GRN_AMENDMENT"]),
  reason: z.string().min(1).max(300),
});

const recordMatchSchema = z.object({
  tolerancesOverride: z
    .object({ qtyPct: z.string().regex(/^\d+(\.\d{1,4})?$/), pricePct: z.string().regex(/^\d+(\.\d{1,4})?$/) })
    .nullable()
    .optional(),
  dispositions: z.array(dispositionSchema).max(200).optional(),
});

const noteLineSchema = z.object({
  invoiceLineId: UUID.nullable().optional(),
  itemId: UUID.nullable().optional(),
  accountId: UUID.nullable().optional(),
  description: z.string().min(1).max(300).nullable().optional(),
  qty: QTY,
  unitPrice: PRICE,
  taxCodeId: UUID.nullable().optional(),
  vatRecoverable: z.boolean().nullable().optional(),
  note: z.string().min(1).max(300).nullable().optional(),
});

const createDebitNoteSchema = z.object({
  branchId: UUID,
  supplierId: UUID,
  refInvoiceId: UUID,
  noteDate: DATE,
  currencyCode: z.string().length(3),
  exchangeRate: RATE,
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
  lines: z.array(noteLineSchema).min(1).max(200),
});

const createLandedCostSchema = z.object({
  grnId: UUID,
  costType: z.enum(["freight", "customs", "insurance", "other"]),
  vendorId: UUID.nullable().optional(),
  amount: MONEY,
  allocationMethod: z.enum(["VALUE", "QTY"]).default("VALUE"),
  chargeAccountId: UUID,
  note: z.string().min(1).max(500).nullable().optional(),
});

/** PHASE-015 T9: the preview payload — a draft landed cost minus the charge account (no posting). */
const landedCostPreviewSchema = z.object({
  grnId: UUID,
  costType: z.enum(["freight", "customs", "insurance", "other"]),
  amount: MONEY,
  allocationMethod: z.enum(["VALUE", "QTY"]).default("VALUE"),
});

const reallocateSchema = z.object({
  reason: z.string().min(1).max(300),
  lines: z
    .array(
      z.object({
        fromOpenItemId: UUID.nullable().optional(),
        toOpenItemId: UUID.nullable().optional(),
        amount: MONEY,
      }),
    )
    .min(1)
    .max(200),
});

const reasonSchema = z.object({ reason: z.string().min(1).max(300) });

@Controller("/api/v1/purchasing")
export class PurchasingController {
  constructor(
    @Inject(PurchaseRequestService) private readonly requests: PurchaseRequestService,
    @Inject(PurchaseOrderService) private readonly orders: PurchaseOrderService,
    @Inject(GoodsReceiptService) private readonly receipts: GoodsReceiptService,
    @Inject(SupplierInvoiceService) private readonly invoices: SupplierInvoiceService,
    @Inject(DebitNoteService) private readonly notes: DebitNoteService,
    @Inject(ReallocationService) private readonly reallocations: ReallocationService,
    @Inject(ApQueriesService) private readonly apQueries: ApQueriesService,
    @Inject(LandedCostService) private readonly landedCosts: LandedCostService,
    @Inject(OpeningApService) private readonly openingAp: OpeningApService,
    @Inject(PurchasingReconciliationService) private readonly reconciliation: PurchasingReconciliationService,
  ) {}

  // -- purchase requests (matrix §3.3) ------------------------------------------

  @Get("purchase-requests")
  @RequirePermissions("purchasing.purchase_requests.view")
  listRequests(@Query("status") status?: string, @Query("limit") limit?: string) {
    return envelope(
      this.requests.list({ status, limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 100) }),
    );
  }

  @Post("purchase-requests")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("purchasing.purchase_requests.create")
  async createRequest(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRequestSchema.parse(body);
    const created = await this.requests.create({
      ...input,
      neededBy: input.neededBy ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: identity.userId,
      lines: input.lines.map((line) => ({ ...line, note: line.note ?? null })),
    });
    return envelope(created);
  }

  @Get("purchase-requests/:id")
  @RequirePermissions("purchasing.purchase_requests.view")
  async findRequest(@Param("id") id: string) {
    return envelope(await this.requests.findWithLines(id));
  }

  @Post("purchase-requests/:id/submit")
  @RequirePermissions("purchasing.purchase_requests.create")
  submitRequest(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.requests.submit(id, identity.userId));
  }

  @Post("purchase-requests/:id/approve")
  @RequirePermissions("purchasing.purchase_requests.approve")
  approveRequest(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.requests.approve(id, identity.userId));
  }

  @Post("purchase-requests/:id/reject")
  @RequirePermissions("purchasing.purchase_requests.approve")
  rejectRequest(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(this.requests.reject(id, reason, identity.userId));
  }

  @Post("purchase-requests/:id/cancel")
  @RequirePermissions("purchasing.purchase_requests.create")
  cancelRequest(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(this.requests.cancel(id, reason, identity.userId));
  }

  // -- purchase orders -------------------------------------------------------------

  @Get("purchase-orders")
  @RequirePermissions("purchasing.purchase_orders.view")
  listOrders(
    @Query("status") status?: string,
    @Query("supplierId") supplierId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      this.orders.list({ status, supplierId, limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 100) }),
    );
  }

  @Post("purchase-orders")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("purchasing.purchase_orders.create")
  async createOrder(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createOrderSchema.parse(body);
    const created = await this.orders.create({
      ...input,
      expectedDate: input.expectedDate ?? null,
      exchangeRate: input.exchangeRate ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      requestId: input.requestId ?? null,
      revisionOfId: input.revisionOfId ?? null,
      actorId: identity.userId,
      lines: input.lines.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        unitPrice: line.unitPrice ?? null,
        taxCodeId: line.taxCodeId ?? null,
        requestLineId: line.requestLineId ?? null,
        note: line.note ?? null,
      })),
    });
    return envelope(created);
  }

  @Get("purchase-orders/:id")
  @RequirePermissions("purchasing.purchase_orders.view")
  async findOrder(@Param("id") id: string) {
    return envelope(await this.orders.findWithLines(id));
  }

  @Post("purchase-orders/:id/submit")
  @RequirePermissions("purchasing.purchase_orders.create")
  submitOrder(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.orders.submit(id, identity.userId));
  }

  @Post("purchase-orders/:id/approve")
  @RequirePermissions("purchasing.purchase_orders.approve")
  approveOrder(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.orders.approve(id, identity.userId));
  }

  @Post("purchase-orders/:id/issue")
  @RequirePermissions("purchasing.purchase_orders.approve")
  issueOrder(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.orders.issue(id, identity.userId));
  }

  @Post("purchase-orders/:id/close")
  @RequirePermissions("purchasing.purchase_orders.approve")
  closeOrder(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.orders.close(id, identity.userId));
  }

  @Post("purchase-orders/:id/cancel")
  @RequirePermissions("purchasing.purchase_orders.create")
  cancelOrder(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(this.orders.cancel(id, reason, identity.userId));
  }

  // -- goods receipts ----------------------------------------------------------------

  @Get("goods-receipts")
  @RequirePermissions("purchasing.goods_receipts.view")
  listReceipts(
    @Query("status") status?: string,
    @Query("supplierId") supplierId?: string,
    @Query("poId") poId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      this.receipts.list({
        status,
        supplierId,
        poId,
        limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 100),
      }),
    );
  }

  @Post("goods-receipts")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("purchasing.goods_receipts.create")
  async createReceipt(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createGrnSchema.parse(body);
    const created = await this.receipts.create({
      ...input,
      poId: input.poId ?? null,
      poLessReason: input.poLessReason ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: identity.userId,
      lines: input.lines.map((line) => ({
        poLineId: line.poLineId ?? null,
        itemId: line.itemId,
        qty: line.qty,
        unitCost: line.unitCost,
        accountId: line.accountId ?? null,
        batchNo: line.batchNo ?? null,
        batchExpiry: line.batchExpiry ?? null,
        serialIds: line.serialIds ?? null,
        note: line.note ?? null,
      })),
    });
    return envelope(created);
  }

  @Get("goods-receipts/:id")
  @RequirePermissions("purchasing.goods_receipts.view")
  async findReceipt(@Param("id") id: string) {
    return envelope(await this.receipts.findWithLines(id));
  }

  @Post("goods-receipts/:id/post")
  @RequirePermissions("purchasing.goods_receipts.approve")
  postReceipt(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.receipts.post(id, identity.userId));
  }

  @Post("goods-receipts/:id/cancel")
  @RequirePermissions("purchasing.goods_receipts.create")
  cancelReceipt(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(this.receipts.cancel(id, reason, identity.userId));
  }

  // -- landed costs (PHASE-011 §2.10 baseline → PHASE-015 T9 full workflow) -------------

  @Get("landed-costs")
  @RequirePermissions("purchasing.goods_receipts.view")
  @RequireFeature("purchasing.landed_costs")
  listLandedCosts(@Query("grnId") grnId?: string, @Query("limit") limit?: string) {
    return envelope(
      this.landedCosts.list({ grnId, limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 100) }),
    );
  }

  /** PHASE-015: the read-only allocation projection the workflow UI renders before committing. */
  @Post("landed-costs/preview")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("purchasing.goods_receipts.view")
  @RequireFeature("purchasing.landed_costs")
  previewLandedCost(@Body() body: unknown) {
    const input = landedCostPreviewSchema.parse(body);
    return envelope(
      this.landedCosts.preview({
        grnId: input.grnId,
        costType: input.costType,
        amount: input.amount,
        allocationMethod: input.allocationMethod,
      }),
    );
  }

  @Post("landed-costs")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("purchasing.goods_receipts.create")
  @RequireFeature("purchasing.landed_costs")
  createLandedCost(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createLandedCostSchema.parse(body);
    return envelope(
      this.landedCosts.create({
        grnId: input.grnId,
        costType: input.costType,
        vendorId: input.vendorId ?? null,
        amount: input.amount,
        allocationMethod: input.allocationMethod,
        chargeAccountId: input.chargeAccountId,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("landed-costs/:id/post")
  @RequirePermissions("purchasing.goods_receipts.approve")
  @RequireFeature("purchasing.landed_costs")
  postLandedCost(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.landedCosts.post(id, identity.userId));
  }

  @Post("landed-costs/:id/cancel")
  @RequirePermissions("purchasing.goods_receipts.create")
  @RequireFeature("purchasing.landed_costs")
  cancelLandedCost(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(this.landedCosts.cancel(id, reason, identity.userId));
  }

  // -- supplier invoices ------------------------------------------------------------------

  @Get("supplier-invoices")
  @RequirePermissions("purchasing.supplier_invoices.view")
  listInvoices(
    @Query("status") status?: string,
    @Query("supplierId") supplierId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      this.invoices.list({
        status,
        supplierId,
        limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 100),
      }),
    );
  }

  @Post("supplier-invoices")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("purchasing.supplier_invoices.create")
  async createInvoice(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createInvoiceSchema.parse(body);
    const created = await this.invoices.create({
      ...input,
      dueDate: input.dueDate ?? null,
      exchangeRate: input.exchangeRate ?? null,
      poId: input.poId ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: identity.userId,
      lines: input.lines.map((line) => ({
        grnLineId: line.grnLineId ?? null,
        itemId: line.itemId ?? null,
        accountId: line.accountId ?? null,
        description: line.description ?? null,
        descriptionAr: line.descriptionAr ?? null,
        qty: line.qty,
        unitPrice: line.unitPrice,
        taxCodeId: line.taxCodeId ?? null,
        vatRecoverable: line.vatRecoverable ?? null,
        note: line.note ?? null,
      })),
    });
    return envelope(created);
  }

  @Get("supplier-invoices/:id")
  @RequirePermissions("purchasing.supplier_invoices.view")
  async findInvoice(@Param("id") id: string) {
    return envelope(await this.invoices.findWithLines(id));
  }

  @Get("supplier-invoices/:id/match")
  @RequirePermissions("purchasing.supplier_invoices.view")
  matchPreview(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.invoices.matchPreview(id, identity.userId));
  }

  @Post("supplier-invoices/:id/match")
  @RequirePermissions("purchasing.supplier_invoices.create")
  recordMatch(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = recordMatchSchema.parse(body);
    return envelope(
      this.invoices.recordMatch({
        id,
        tolerancesOverride: input.tolerancesOverride ?? undefined,
        dispositions: input.dispositions,
        actorId: identity.userId,
      }),
    );
  }

  @Post("supplier-invoices/:id/submit")
  @RequirePermissions("purchasing.supplier_invoices.create")
  submitInvoice(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.invoices.submit(id, identity.userId));
  }

  @Post("supplier-invoices/:id/approve")
  @RequirePermissions("purchasing.supplier_invoices.approve")
  approveInvoice(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.invoices.approve(id, identity.userId));
  }

  @Post("supplier-invoices/:id/post")
  @RequirePermissions("purchasing.supplier_invoices.post")
  postInvoice(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.invoices.post(id, identity.userId));
  }

  @Post("supplier-invoices/:id/cancel")
  @RequirePermissions("purchasing.supplier_invoices.create")
  cancelInvoice(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(this.invoices.cancel(id, reason, identity.userId));
  }

  // -- debit notes ------------------------------------------------------------------------

  @Get("debit-notes")
  @RequirePermissions("purchasing.debit_notes.view")
  listNotes(
    @Query("status") status?: string,
    @Query("supplierId") supplierId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      this.notes.list({
        status,
        supplierId,
        limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 100),
      }),
    );
  }

  @Post("debit-notes")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("purchasing.debit_notes.create")
  async createNote(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createDebitNoteSchema.parse(body);
    const created = await this.notes.create({
      ...input,
      exchangeRate: input.exchangeRate ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: identity.userId,
      lines: input.lines.map((line) => ({
        invoiceLineId: line.invoiceLineId ?? null,
        itemId: line.itemId ?? null,
        accountId: line.accountId ?? null,
        description: line.description ?? null,
        qty: line.qty,
        unitPrice: line.unitPrice,
        taxCodeId: line.taxCodeId ?? null,
        vatRecoverable: line.vatRecoverable ?? null,
        note: line.note ?? null,
      })),
    });
    return envelope(created);
  }

  @Get("debit-notes/:id")
  @RequirePermissions("purchasing.debit_notes.view")
  async findNote(@Param("id") id: string) {
    return envelope(await this.notes.findWithLines(id));
  }

  @Post("debit-notes/:id/submit")
  @RequirePermissions("purchasing.debit_notes.create")
  submitNote(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.notes.submit(id, identity.userId));
  }

  @Post("debit-notes/:id/approve")
  @RequirePermissions("purchasing.debit_notes.approve")
  approveNote(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.notes.approve(id, identity.userId));
  }

  @Post("debit-notes/:id/post")
  @RequirePermissions("purchasing.debit_notes.post")
  postNote(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.notes.post(id, identity.userId));
  }

  @Post("debit-notes/:id/cancel")
  @RequirePermissions("purchasing.debit_notes.create")
  cancelNote(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { reason } = reasonSchema.parse(body);
    return envelope(this.notes.cancel(id, reason, identity.userId));
  }

  // -- payments: re-allocations (money movement rides treasury routes) ---------------------

  @Get("payments/:id/reallocations")
  @RequirePermissions("purchasing.payments.view")
  listReallocations(@Req() request: Request, @Param("id") id: string, @Query("limit") limit?: string) {
    requireIdentity(request);
    return envelope(
      this.reallocations.list({ paymentId: id, limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 100) }),
    );
  }

  @Post("payments/:id/reallocate")
  @RequirePermissions("purchasing.payments.approve")
  reallocate(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = reallocateSchema.parse(body);
    return envelope(
      this.reallocations.execute({
        paymentId: id,
        reason: input.reason,
        actorId: identity.userId,
        lines: input.lines.map((line) => ({
          fromOpenItemId: line.fromOpenItemId ?? null,
          toOpenItemId: line.toOpenItemId ?? null,
          amount: line.amount,
        })),
      }),
    );
  }

  // -- AP views: aging, statements, GRNI register, open items ------------------------------

  @Get("ap/aging")
  @RequirePermissions("purchasing.supplier_invoices.view")
  apAging(@Req() request: Request, @Query("asOf") asOf?: string, @Query("supplierId") supplierId?: string) {
    requireIdentity(request);
    const date = asOf ?? new Date().toISOString().slice(0, 10);
    return envelope(this.apQueries.aging({ asOf: date, supplierId }));
  }

  @Get("ap/statements/:supplierId")
  @RequirePermissions("purchasing.supplier_invoices.view")
  apStatement(@Req() request: Request, @Param("supplierId") supplierId: string, @Query("asOf") asOf?: string) {
    requireIdentity(request);
    const date = asOf ?? new Date().toISOString().slice(0, 10);
    return envelope(this.apQueries.statement({ supplierId, asOf: date }));
  }

  @Get("grni")
  @RequirePermissions("purchasing.goods_receipts.view")
  grniRegister(@Req() request: Request, @Query("asOf") asOf?: string) {
    requireIdentity(request);
    const date = asOf ?? new Date().toISOString().slice(0, 10);
    return envelope(this.apQueries.grniRegister(date));
  }

  @Get("ap/open-items")
  @RequirePermissions("purchasing.supplier_invoices.view")
  apOpenItems(@Req() request: Request, @Query("supplierId") supplierId?: string, @Query("limit") limit?: string) {
    requireIdentity(request);
    return envelope(
      this.apQueries.openItems({ supplierId, limit: z.coerce.number().int().min(1).max(500).parse(limit ?? 200) }),
    );
  }

  @Get("ap/opening-verification")
  @RequirePermissions("purchasing.supplier_invoices.view")
  openingVerification(@Req() request: Request, @Query("asOf") asOf?: string) {
    requireIdentity(request);
    const date = asOf ?? new Date().toISOString().slice(0, 10);
    return envelope(this.openingAp.verifyInv009({ asOf: date }));
  }

  // -- reconciliation (RC-09) ------------------------------------------------------------------

  @Post("reconciliation/grni-check")
  @RequirePermissions("purchasing.supplier_invoices.post")
  runGrniCheck(@Req() request: Request, @Query("asOf") asOf?: string, @Query("mode") mode?: string) {
    const identity = requireIdentity(request);
    const date = asOf ?? new Date().toISOString().slice(0, 10);
    return envelope(
      this.reconciliation.runGrniCheck({
        asOf: date,
        runMode: mode === "NIGHTLY" ? "NIGHTLY" : "ON_DEMAND",
        checkedBy: identity.userId,
      }),
    );
  }
}
