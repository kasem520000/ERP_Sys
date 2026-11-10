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
    private readonly numbering: NumberingService,
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
    const order = await this.find(id);
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
    const order = await this.find(id);
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

  /** Release every line reservation of an order (cancel/close/delivery). */
  async releaseOrderReservations(orderId: string, actorId: string | null): Promise<void> {
    const lines = await store.listSalesOrderLines(orderId);
    const active = lines.filter((line) => line.reservationId !== null);
    if (active.length === 0) return;
    const reservationService = await import("../../inventory/application/reservation-service");
    const svc = new reservationService.ReservationService(this.audit);
    for (const line of active) {
      await svc.release(line.reservationId!, actorId);
    }
  }
}
