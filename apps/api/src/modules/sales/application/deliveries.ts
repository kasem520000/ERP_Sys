import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  planIssue,
  applyIssue,
  resolveInventoryAccount,
  stagePendingOverlay,
  type IssuePlan,
} from "../../inventory/application/movement-core";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/sales.store";
import {
  DeliveryLineInvalidError,
  DeliveryNoteNotFoundError,
  EmptyDocumentError,
  SalesDocumentStateError,
} from "../domain/sales-errors";
import { requireCustomer } from "./quotations";

/**
 * Delivery-note service (PHASE-012 T4; BR-007 delivery_then_invoice; golden
 * G-03): posting a DN is ONE transaction that (1) plans every stock issue
 * through the PHASE-010 movement core (planIssue — no writes: an engine
 * rejection leaves zero residue by construction), (2) posts the G-03 COGS
 * journal `DR COGS · CR INVENTORY` at issue cost WITHOUT AR, and (3) applies
 * the issue plans WITH the journal id (INV-018). Sales NEVER writes stock
 * tables itself (MODULE_BOUNDARIES). The per-line issue snapshots
 * (unit cost + value) persist at post — the credit-note re-entry
 * provenance (W-3). The order's soft reservations release once the stock
 * physically moved (they must not double-net availability).
 */

const DEL_FORMAT = { prefix: "DEL", format: "DEL-{YYYY}-{SEQ:6}", docType: "delivery_note" };

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;

export interface DeliveryLineInput {
  orderLineId: string | null;
  itemId: string;
  qty: string;
  unitPrice: string | null;
  discountAmount: string | null;
  batchId: string | null;
  serialIds: string[] | null;
  description: string | null;
  descriptionAr: string | null;
  note: string | null;
}

@Injectable()
export class DeliveryNoteService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; customerId?: string; orderId?: string; limit: number }) {
    return store.listDeliveryNotes(filter);
  }

  async find(id: string) {
    const delivery = await store.findDeliveryNoteById(id);
    if (delivery === undefined) throw new DeliveryNoteNotFoundError(id);
    return delivery;
  }

  async findWithLines(id: string) {
    const delivery = await this.find(id);
    return { ...delivery, lines: await store.listDeliveryNoteLines(id) };
  }

  async create(input: {
    branchId: string;
    customerId: string;
    salesRepId: string | null;
    orderId: string | null;
    warehouseId: string;
    deliveryDate: string;
    currencyCode: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    lines: readonly DeliveryLineInput[];
  }) {
    if (input.lines.length === 0) throw new EmptyDocumentError("delivery note");
    await requireCustomer(input.customerId);
    const base = await ownTenantBaseCurrency();
    if (input.currencyCode !== base) {
      throw new DeliveryLineInvalidError(
        `delivery notes post COGS in the base currency (${base}) — document currency ${input.currencyCode} is not supported here (the invoice carries the AR side)`,
      );
    }
    // Order linkage: DNs reference ISSUED orders (or stand alone — a direct
    // counter delivery is legitimate retail flow).
    if (input.orderId !== null) {
      const order = await store.findSalesOrderById(input.orderId);
      if (order === undefined) {
        throw new DeliveryLineInvalidError(`sales order ${input.orderId} does not exist in this tenant`);
      }
      if (order.status !== "ISSUED") {
        throw new SalesDocumentStateError(
          `sales order ${input.orderId} is ${order.status} — deliveries reference issued orders only`,
        );
      }
      if (order.customerId !== input.customerId) {
        throw new DeliveryLineInvalidError(
          `delivery customer does not match the order's customer (INV-006 source chain)`,
        );
      }
    }

    const itemsStore = await import("../../items/infrastructure/items.store");
    let totalNet = new Decimal(0);
    type DnStoreLine = Parameters<typeof store.insertDeliveryNote>[0]["lines"][number];
    const storeLines: DnStoreLine[] = [];
    for (const line of input.lines) {
      const item = await itemsStore.findItemById(line.itemId);
      if (item === undefined || item.deletedAt !== null) {
        throw new DeliveryLineInvalidError(`item ${line.itemId} does not exist in this tenant`);
      }
      if (item.kind !== "STOCK") {
        throw new DeliveryLineInvalidError(`item ${line.itemId} is not a STOCK item — deliveries move stock only`);
      }
      if (!QTY_RE.test(line.qty) || Number(line.qty) <= 0) {
        throw new DeliveryLineInvalidError(`delivery line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      let unitPrice = line.unitPrice;
      if (unitPrice === null) {
        unitPrice = item.basePrice ?? "0";
      }
      if (!PRICE_RE.test(unitPrice) || Number(unitPrice) < 0) {
        throw new DeliveryLineInvalidError(`line unit price must be a non-negative decimal (≤ 6dp): ${unitPrice}`);
      }
      const discount = line.discountAmount ?? "0";
      const gross = new Decimal(line.qty).times(new Decimal(unitPrice));
      const net = gross.minus(new Decimal(discount)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      if (new Decimal(net).lt(0)) {
        throw new DeliveryLineInvalidError("line discount exceeds the gross (BR-008)");
      }
      totalNet = totalNet.plus(new Decimal(net));
      storeLines.push({
        orderLineId: line.orderLineId,
        itemId: line.itemId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        qty: new Decimal(line.qty).toFixed(6),
        unitPrice: new Decimal(unitPrice).toFixed(6),
        discountAmount: new Decimal(discount).toFixed(4),
        netAmount: net,
        batchId: line.batchId,
        serialIds: line.serialIds,
        note: line.note,
      });
    }
    const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    const created = await store.insertDeliveryNote({
      branchId: input.branchId,
      customerId: input.customerId,
      salesRepId: input.salesRepId,
      orderId: input.orderId,
      warehouseId: input.warehouseId,
      deliveryDate: input.deliveryDate,
      currencyCode: input.currencyCode,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
      totalNet: totalNetS,
      totalTax: "0.0000",
      totalGross: totalNetS,
      lines: storeLines,
    });
    await this.audit.record({
      action: "sales.delivery_created",
      entityType: "delivery_note",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { customerId: input.customerId, totalNet: totalNetS, orderId: input.orderId },
    });
    return created;
  }

  /**
   * Post (G-03): plan all issues → COGS journal → apply with the journal id
   * → per-line issue snapshots → DEL- number + status flip. ONE transaction,
   * idempotent (INV-013).
   */
  async post(id: string, actorId: string | null) {
    const delivery = await this.find(id);
    if (delivery.status === "POSTED") {
      return {
        delivery: await this.find(id),
        journalEntryId: delivery.postedJournalId,
        deliveryNo: delivery.deliveryNo,
        idempotentReplay: true,
      };
    }
    if (delivery.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `delivery note ${id} is ${delivery.status} — only DRAFT deliveries post`,
      );
    }
    const lines = await store.listDeliveryNoteLines(id);
    if (lines.length === 0) throw new EmptyDocumentError("delivery note");

    // (1) Plan every issue (locks positions, CC-04, FEFO/serial binding) — NO writes.
    const plans: { line: store.DeliveryNoteLineRow; plan: IssuePlan }[] = [];
    for (const line of lines) {
      const plan = await planIssue({
        itemId: line.itemId,
        warehouseId: delivery.warehouseId,
        qty: line.qty,
        movedAt: delivery.deliveryDate,
        moveKind: "issue",
        sourceType: "delivery_note",
        sourceId: id,
        batchId: line.batchId,
        serialIds: line.serialIds ?? [],
        memo: `Delivery ${delivery.deliveryNo ?? id}`,
        memoAr: `سند تسليم ${delivery.deliveryNo ?? id}`,
      });
      plans.push({ line, plan });
      stagePendingOverlay(plan);
    }

    // (2) The G-03 journal: DR COGS · CR INVENTORY (per resolved account).
    const cogsMapping = (await import("../../accounting/infrastructure/accounting.store")).findActivePurpose(
      "COGS",
    );
    const cogsAccount = (await cogsMapping)?.accountId ?? "";
    if (cogsAccount === "") {
      const { purposeNotMapped } = await import("../../accounting/domain/posting-engine/posting-errors");
      throw purposeNotMapped({ purposeKey: "COGS" });
    }
    const inventoryByAccount = new Map<string, string>();
    let cogsTotal = new Decimal(0);
    for (const { plan } of plans) {
      const inventoryAccount = await resolveInventoryAccount(delivery.warehouseId);
      inventoryByAccount.set(
        inventoryAccount,
        new Decimal(inventoryByAccount.get(inventoryAccount) ?? "0")
          .plus(new Decimal(plan.valueAmount)).toFixed(4),
      );
      cogsTotal = cogsTotal.plus(new Decimal(plan.valueAmount));
    }
    const journalLines: JournalLineSpec[] = [
      {
        purpose: "COGS",
        accountId: cogsAccount,
        direction: "DEBIT",
        amount: cogsTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        memo: {
          en: `Delivery ${delivery.deliveryNo ?? id} — COGS at issue cost`,
          ar: `سند تسليم ${delivery.deliveryNo ?? id} — تكلفة المبيعات بسعر الإصدار`,
        },
      },
    ];
    for (const [accountId, amount] of [...inventoryByAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (amount === "0.0000") continue;
      journalLines.push({
        accountId,
        direction: "CREDIT",
        amount,
        memo: {
          en: `Delivery ${delivery.deliveryNo ?? id} — stock issued`,
          ar: `سند تسليم ${delivery.deliveryNo ?? id} — صرف مخزون`,
        },
      });
    }
    const base = await ownTenantBaseCurrency();
    const spec: JournalSpec = {
      source: { docType: "delivery_note", docId: id, operation: "post" },
      entryDate: delivery.deliveryDate,
      description: {
        en: `Delivery note ${id} — stock issued, COGS recognized`,
        ar: `سند تسليم ${id} — صرف مخزون واعتراف بتكلفة المبيعات`,
      },
      currency: base,
      lines: journalLines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });
    if (result.idempotentReplay) {
      const current = await this.find(id);
      return {
        delivery: current,
        journalEntryId: result.journalEntryId,
        deliveryNo: current.deliveryNo,
        idempotentReplay: true,
      };
    }

    // (3) Apply the issue plans with the journal link (INV-018).
    for (const { plan } of plans) {
      await applyIssue(plan, result.journalEntryId);
    }

    // (4) Per-line issue snapshots (the W-3 re-entry provenance).
    for (const { line, plan } of plans) {
      const unitCost = new Decimal(plan.qty).gt(0)
        ? new Decimal(plan.valueAmount).div(new Decimal(plan.qty)).toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
        : new Decimal(0);
      await store.markDeliveryLineIssued({
        lineId: line.id,
        issueUnitCost: unitCost.toFixed(6),
        issueValue: plan.valueAmount,
      });
    }

    // (5) The order's soft reservations release — stock physically moved.
    if (delivery.orderId !== null) {
      const ordersServiceModule = await import("./orders");
      void ordersServiceModule;
      const orderLines = await store.listSalesOrderLines(delivery.orderId);
      const reservationService = await import("../../inventory/application/reservation-service");
      const svc = new reservationService.ReservationService(this.audit);
      for (const orderLine of orderLines) {
        if (orderLine.reservationId !== null) {
          await svc.release(orderLine.reservationId, actorId);
          await store.setOrderLineReservation(orderLine.id, null);
        }
      }
    }

    // (6) Official DEL- number + status flip.
    const year = delivery.deliveryDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: DEL_FORMAT.docType,
      branchId: delivery.branchId,
      periodKey: year,
      format: DEL_FORMAT.format,
      prefix: DEL_FORMAT.prefix,
      year,
    });
    await store.updateDeliveryNoteStatus({
      id,
      status: "POSTED",
      actorId,
      deliveryNo: acquired.number,
      postingDate: delivery.deliveryDate,
      postedJournalId: result.journalEntryId,
      cogsValue: cogsTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    });
    await this.numbering.bind(DEL_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "sales.delivery_posted",
      entityType: "delivery_note",
      entityId: id,
      actorId: actorId ?? undefined,
      after: {
        deliveryNo: acquired.number,
        journalEntryId: result.journalEntryId,
        cogsValue: cogsTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      },
    });
    return {
      delivery: await this.find(id),
      journalEntryId: result.journalEntryId,
      deliveryNo: acquired.number,
      idempotentReplay: false,
    };
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const delivery = await this.find(id);
    if (delivery.status === "POSTED") {
      throw new SalesDocumentStateError(
        "posted delivery notes are immutable — correction is a credit note or reversal (INV-003)",
      );
    }
    await store.updateDeliveryNoteStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.audit.record({
      action: "sales.delivery_cancelled",
      entityType: "delivery_note",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }
}
