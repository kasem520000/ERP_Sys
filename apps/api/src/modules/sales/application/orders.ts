import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/sales.store";
import {
  EmptyDocumentError,
  OrderLineInvalidError,
  QuotationExpiredError,
  QuotationNotFoundError,
  SalesDocumentStateError,
  SalesOrderNotFoundError,
} from "../domain/sales-errors";
import { requireCustomer, requireSellableItem } from "./quotations";
import { AtpService } from "../../manufacturing/application/atp-service";
import { resolveSalesPrice, salesLineNetAmount, PRICE_RE } from "./pricing";

/**
 * Sales-order service (PHASE-012 T3; §2.2): DRAFT → PENDING_APPROVAL →
 * APPROVED → ISSUED (official SOR- number reserves at issue, BR-029) →
 * CLOSED / CANCELLED, mirroring the purchasing order discipline. Lines
 * carry the OPTIONAL soft stock reservation (PHASE-010 seam — holder_type
 * 'SALES_ORDER', expiry-honored, non-blocking: availability nets ACTIVE
 * rows, issue paths still enforce on-hand themselves). Quotation
 * acceptance converts into an order (same transaction, lines carried) —
 * BR-006: an expired quote never converts.
 */

const SOR_FORMAT = { prefix: "SOR", format: "SOR-{YYYY}-{SEQ:6}", docType: "sales_order" };

const QTY_RE = /^\d+(\.\d{1,6})?$/;

export interface OrderLineInput {
  itemId: string;
  qty: string;
  unitPrice: string | null;
  discountAmount: string | null;
  taxCodeId: string | null;
  description: string | null;
  descriptionAr: string | null;
  note: string | null;
}

@Injectable()
export class SalesOrderService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    // The explicit token: the vitest transform emits no design:paramtypes,
    // so an undecorated param before a later @Inject punches an undefined
    // hole into Nest's token array (the 044 T-08 gate repair precedent).
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(AtpService) private readonly atp: AtpService,
  ) {}

  async list(filter: { status?: string; customerId?: string; limit: number }) {
    return store.listSalesOrders(filter);
  }

  async find(id: string) {
    const order = await store.findSalesOrderById(id);
    if (order === undefined) throw new SalesOrderNotFoundError(id);
    return order;
  }

  async findWithLines(id: string) {
    const order = await this.find(id);
    return { ...order, lines: await store.listSalesOrderLines(id) };
  }

  /**
   * PHASE-043 (T-08, M-06/S-10): ATP-check one sales order line against
   * live supply at the order's warehouse and stamp the verdict — the
   * promise-date suggestion + the over-promise warning (atp_status SHORT
   * + the CTP atp_suggested_date). The hard exclusions (BR-080) live in
   * the ATP service (quarantined, reserved, consignment-owned never
   * promise); this method owns the sales-side stamp.
   */
  async checkLineAtp(
    orderId: string,
    lineId: string,
    input: { promisedDate?: string | null; actorId: string | null },
  ): Promise<{
    line: store.SalesOrderLineRow;
    verdict: "OK" | "SHORT";
    availableNow: string;
    suggestedDate: string | null;
  }> {
    const order = await this.find(orderId);
    const lines = await store.listSalesOrderLines(orderId);
    const line = lines.find((candidate) => candidate.id === lineId);
    if (line === undefined) {
      throw new SalesOrderNotFoundError(`sales order line ${lineId} does not belong to order ${orderId}`);
    }
    const result = await this.atp.check({
      itemId: line.itemId,
      warehouseId: order.warehouseId,
      qty: line.qty,
      date: input.promisedDate ?? order.expectedDate ?? null,
    });
    await store.updateOrderLineAtp({
      lineId,
      promisedDate: input.promisedDate ?? order.expectedDate ?? null,
      atpStatus: result.verdict,
      atpSuggestedDate: result.suggestedDate,
    });
    await this.audit.record({
      action: "sales.sales_order_line.atp_checked",
      entityType: "sales_order",
      entityId: orderId,
      actorId: input.actorId ?? undefined,
      after: {
        lineId,
        verdict: result.verdict,
        availableNow: result.availableNow,
        suggestedDate: result.suggestedDate,
      },
    });
    return {
      line: (await store.listSalesOrderLines(orderId)).find((candidate) => candidate.id === lineId)!,
      verdict: result.verdict,
      availableNow: result.availableNow,
      suggestedDate: result.suggestedDate,
    };
  }

  async create(input: {
    branchId: string;
    customerId: string;
    salesRepId: string | null;
    warehouseId: string;
    quotationId: string | null;
    orderDate: string;
    expectedDate: string | null;
    currencyCode: string;
    exchangeRate: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    reserve: boolean;
    lines: readonly OrderLineInput[];
  }) {
    if (input.lines.length === 0) throw new EmptyDocumentError("sales order");
    await requireCustomer(input.customerId);
    const base = await ownTenantBaseCurrency();
    if (input.currencyCode !== base && (input.exchangeRate === null || Number(input.exchangeRate) <= 0)) {
      throw new OrderLineInvalidError(
        `order in ${input.currencyCode} requires a positive exchange rate (base ${base})`,
      );
    }
    const { InventoryModule } = await import("../../inventory/inventory.module");
    void InventoryModule;
    const inventoryStore = await import("../../inventory/infrastructure/inventory.store");
    const warehouse = await inventoryStore.findWarehouseById(input.warehouseId);
    if (warehouse === undefined) {
      throw new OrderLineInvalidError(`warehouse ${input.warehouseId} does not exist in this tenant`);
    }

    let totalNet = new Decimal(0);
    type SoStoreLine = Parameters<typeof store.insertSalesOrder>[0]["lines"][number];
    const storeLines: SoStoreLine[] = [];
    for (const line of input.lines) {
      await requireSellableItem(line.itemId);
      let unitPrice = line.unitPrice;
      if (unitPrice === null) {
        const resolved = await resolveSalesPrice({
          customerId: input.customerId,
          itemId: line.itemId,
          qty: line.qty,
        });
        unitPrice = resolved.unitPrice;
        if (resolved.source === "MANUAL" && Number(unitPrice) === 0) {
          throw new OrderLineInvalidError(
            `item ${line.itemId} has no resolvable price — provide unitPrice explicitly (BR-003)`,
          );
        }
      }
      if (!PRICE_RE.test(unitPrice) || Number(unitPrice) < 0) {
        throw new OrderLineInvalidError(`line unit price must be a non-negative decimal (≤ 6dp): ${unitPrice}`);
      }
      if (!QTY_RE.test(line.qty) || Number(line.qty) <= 0) {
        throw new OrderLineInvalidError(`line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      const discount = line.discountAmount ?? "0";
      const net = salesLineNetAmount(line.qty, unitPrice, discount);
      totalNet = totalNet.plus(new Decimal(net));
      storeLines.push({
        itemId: line.itemId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        qty: new Decimal(line.qty).toFixed(6),
        unitPrice: new Decimal(unitPrice).toFixed(6),
        discountAmount: new Decimal(discount).toFixed(4),
        taxCodeId: line.taxCodeId,
        netAmount: net,
        taxAmount: "0.0000",
        note: line.note,
      });
    }
    const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    const created = await store.insertSalesOrder({
      branchId: input.branchId,
      customerId: input.customerId,
      salesRepId: input.salesRepId,
      warehouseId: input.warehouseId,
      quotationId: input.quotationId,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
      totalNet: totalNetS,
      totalTax: "0.0000",
      totalGross: totalNetS,
      lines: storeLines,
    });

    // Optional soft reservations (T3): one row per line, expiry-honored.
    if (input.reserve) {
      const reservationService = await import("../../inventory/application/reservation-service");
      const svc = new reservationService.ReservationService(this.audit);
      let lineNo = 0;
      for (const line of storeLines) {
        lineNo += 1;
        const orderLineId = (
          await store.listSalesOrderLines(created.id)
        ).find((row) => row.lineNo === lineNo)!.id;
        const reservation = await svc.create({
          itemId: line.itemId,
          warehouseId: input.warehouseId,
          qty: line.qty,
          holderType: "SALES_ORDER",
          holderId: created.id,
          expiresAt: input.expectedDate !== null ? `${input.expectedDate}T23:59:59Z` : null,
          note: `SOR line ${lineNo}`,
          actorId: input.actorId,
        });
        await store.setOrderLineReservation(orderLineId, reservation.id);
      }
    }

    await this.audit.record({
      action: "sales.order_created",
      entityType: "sales_order",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { customerId: input.customerId, totalNet: totalNetS, reserved: input.reserve },
    });
    return created;
  }

  /** Quotation accept/convert (BR-006): order created + quote ACCEPTED, one transaction. */
  async acceptQuotation(input: {
    quotationId: string;
    warehouseId: string;
    expectedDate: string | null;
    note: string | null;
    actorId: string | null;
    reserve: boolean;
  }) {
    const quotation = await store.findQuotationById(input.quotationId);
    if (quotation === undefined) throw new QuotationNotFoundError(input.quotationId);
    if (quotation.status !== "SENT") {
      throw new SalesDocumentStateError(
        `quotation ${input.quotationId} is ${quotation.status} — only SENT quotations convert`,
      );
    }
    // BR-006: expiry re-verified at the accept boundary (the sweep may lag).
    if (quotation.validUntil < new Date().toISOString().slice(0, 10)) {
      throw new QuotationExpiredError({ id: input.quotationId, validUntil: quotation.validUntil });
    }
    const lines = await store.listQuotationLines(input.quotationId);
    const order = await this.create({
      branchId: quotation.branchId,
      customerId: quotation.customerId,
      salesRepId: quotation.salesRepId,
      warehouseId: input.warehouseId,
      quotationId: quotation.id,
      orderDate: new Date().toISOString().slice(0, 10),
      expectedDate: input.expectedDate,
      currencyCode: quotation.currencyCode,
      exchangeRate: quotation.exchangeRate,
      note: input.note,
      noteAr: null,
      actorId: input.actorId,
      reserve: input.reserve,
      lines: lines.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxCodeId: line.taxCodeId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        note: null,
      })),
    });
    await store.updateQuotationStatus({
      id: quotation.id,
      status: "ACCEPTED",
      actorId: input.actorId,
      convertedOrderId: order.id,
    });
    await this.audit.record({
      action: "sales.quotation_accepted",
      entityType: "quotation",
      entityId: quotation.id,
      actorId: input.actorId ?? undefined,
      after: { convertedOrderId: order.id },
    });
    return { quotation: await store.findQuotationById(quotation.id), order };
  }

  async submit(id: string, actorId: string | null) {
    const order = await this.find(id);
    if (order.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `sales order ${id} is ${order.status} — only DRAFT orders submit`,
      );
    }
    await store.updateSalesOrderStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const order = await this.find(id);
    if (order.status !== "PENDING_APPROVAL" && order.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `sales order ${id} is ${order.status} — only DRAFT/PENDING_APPROVAL orders approve`,
      );
    }
    if (order.createdBy !== null && order.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    await store.updateSalesOrderStatus({ id, status: "APPROVED", actorId });
    await this.audit.record({
      action: "sales.order_approved",
      entityType: "sales_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { totalGross: order.totalGross },
    });
    return this.find(id);
  }

  /** Issue (the official SOR- number reserves here — BR-029). */
  async issue(id: string, actorId: string | null) {
    const order = await this.find(id);
    if (order.status !== "APPROVED") {
      throw new SalesDocumentStateError(
        `sales order ${id} is ${order.status} — approval precedes issue`,
      );
    }
    const year = order.orderDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: SOR_FORMAT.docType,
      branchId: order.branchId,
      periodKey: year,
      format: SOR_FORMAT.format,
      prefix: SOR_FORMAT.prefix,
      year,
    });
    await store.updateSalesOrderStatus({ id, status: "ISSUED", actorId, orderNo: acquired.number });
    await this.numbering.bind(SOR_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "sales.order_issued",
      entityType: "sales_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { orderNo: acquired.number, totalGross: order.totalGross },
    });
    return this.find(id);
  }

  async close(id: string, actorId: string | null) {
    // THE ROUND-4 SERIALIZATION PROTOCOL: the locked header read FIRST —
    // the sales_orders header row is the serialization point between the
    // order's terminations (cancel/close — mutually, through this lock)
    // and the MTO completion's dead-line guard read (the planning store's
    // findSalesOrderStatusByLine locks the same row from the completion
    // side). Holding it from BEFORE the status check to the UoW's commit
    // means: a completion that already passed its guard read has its
    // holder COMMITTED before this close's release loop runs (the loop
    // sees it and releases it — created-then-settled, never an orphan);
    // a close that gets here first forces the completion's guard read to
    // wait and read the post-close status (LINKED_ORDER_CLOSED — the
    // holder is never created); and a racing cancel fails with the typed
    // state error here instead of overwriting the winner's status.
    const order = await store.lockSalesOrderHeader(id);
    if (order === undefined) throw new SalesOrderNotFoundError(id);
    if (order.status !== "ISSUED") {
      throw new SalesDocumentStateError(
        `sales order ${id} is ${order.status} — only ISSUED orders close`,
      );
    }
    await store.updateSalesOrderStatus({ id, status: "CLOSED", actorId });
    await this.releaseOrderReservations(id, actorId);
    await this.audit.record({
      action: "sales.order_closed",
      entityType: "sales_order",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    // THE ROUND-4 SERIALIZATION PROTOCOL (the close comment's contract,
    // verbatim): the locked header read FIRST — the row is shared with
    // the completion's dead-line guard and with every other termination.
    // Pre-fix this was a plain read: a cancel could commit inside the
    // completion's guard-read→holder-creation window (the owner's round-4
    // proof — the order ended CANCELLED with an ACTIVE MTO holder nobody
    // could ever settle), and a racing close could overwrite the cancel's
    // status (both effects landed). The lock closes both doors.
    const order = await store.lockSalesOrderHeader(id);
    if (order === undefined) throw new SalesOrderNotFoundError(id);
    if (order.status === "CLOSED" || order.status === "CANCELLED") {
      throw new SalesDocumentStateError(
        `sales order ${id} is ${order.status} — only open orders cancel`,
      );
    }
    await store.updateSalesOrderStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.releaseOrderReservations(id, actorId);
    await this.audit.record({
      action: "sales.order_cancelled",
      entityType: "sales_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  /**
   * Release EVERY reservation an order's termination touches (cancel /
   * close — the 043-audit round-2 item-1 fix): the LINES' OWN
   * reservations AND the MTO reservations FEEDING those lines (G-49's
   * PRODUCTION_ORDER holders — the made-for-order stock of the linked,
   * completed MOs). A cancelled/closed order ships nothing more, so its
   * coverage retires entirely: the made-for-order stock returns to the
   * FREE pool (the physical stock stays on-hand for disposition — a
   * business decision on re-ordering/scrapping, never a leaked ACTIVE
   * holder reducing availability forever). Pre-fix only the lines' own
   * rows released; the MTO holders leaked.
   */
  async releaseOrderReservations(orderId: string, actorId: string | null): Promise<void> {
    const order = await store.findSalesOrderById(orderId);
    const lines = await store.listSalesOrderLines(orderId);
    if (order === undefined) return;
    const reservationService = await import("../../inventory/application/reservation-service");
    const svc = new reservationService.ReservationService(this.audit);
    // The MTO chain's application surface (the deliveries.ts settlement
    // precedent — never another module's store).
    const { listActiveMtoReservationsForSalesLine } = await import(
      "../../manufacturing/application/production-order-service"
    );
    for (const line of lines) {
      // (a) The line's OWN reservation.
      if (line.reservationId !== null) {
        const own = await svc.find(line.reservationId);
        if (own.status === "ACTIVE") {
          await svc.release(line.reservationId, actorId);
        }
        await store.setOrderLineReservation(line.id, null);
      }
      // (b) The MTO reservations feeding this line (the completion-only
      // holders — nothing exists for an in-progress/cancelled MO).
      const feeding = await listActiveMtoReservationsForSalesLine({
        salesOrderLineId: line.id,
        itemId: line.itemId,
        warehouseId: order.warehouseId,
      });
      for (const mto of feeding) {
        const current = await svc.find(mto.id);
        if (current.status !== "ACTIVE") continue; // a concurrent settle won
        await svc.release(mto.id, actorId);
        if (line.reservationId === mto.id) {
          await store.setOrderLineReservation(line.id, null);
        }
      }
    }
  }
}
