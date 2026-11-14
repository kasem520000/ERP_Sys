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
import { PickingService } from "../../inventory/application/picking-service";
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
 * provenance (W-3).
 *
 * THE HARD-PROTECTION BENEFICIARY PATH (the PHASE-043 completion round):
 * the post is the one issue path ENTITLED to draw on the ACTIVE reserved
 * pool — per line, the beneficiary allowance (the line's OWN reservation
 * + its ACTIVE MTO chain) rides planIssue; every OTHER path (another
 * order's delivery, standalone deliveries, manual issues, transfers,
 * adjustments, productions) may consume FREE STOCK ONLY, and the
 * permission-gated, audited release is the only door to reserved stock
 * otherwise. The settlement (step 5) retires the shipped qty through the
 * allowance's exact rows — the verifier that makes a stale allowance
 * harmless (a row that flipped non-ACTIVE makes the settlement throw and
 * the WHOLE post roll back).
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
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(PickingService) private readonly picking: PickingService,
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
   * PHASE-044 (T-15/PP-11): create the directed-pick wave for a DRAFT
   * delivery — the delivery screen's wave button. The wave allocates its
   * PICK tasks from the warehouse's bins NOW (the strategy-ordered walk);
   * the pickers scan-confirm them, and the POST consumes the confirmed
   * takes as its directedTakes (see post). Only DRAFT deliveries wave —
   * a posted delivery's stock already left.
   */
  async createPickWave(
    id: string,
    input: { method?: "FIFO" | "FEFO" | "NEAREST" | null; routeNote: string | null },
    actorId: string | null,
  ) {
    const delivery = await this.find(id);
    if (delivery.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `delivery note ${id} is ${delivery.status} — only DRAFT deliveries wave`,
      );
    }
    const lines = await store.listDeliveryNoteLines(id);
    if (lines.length === 0) throw new EmptyDocumentError("delivery note");
    return this.picking.createWave({
      warehouseId: delivery.warehouseId,
      lines: lines.map((line) => ({
        deliveryNoteId: id,
        lineNo: line.lineNo,
        itemId: line.itemId,
        qty: line.qty,
        batchId: line.batchId,
      })),
      method: input.method ?? null,
      routeNote: input.routeNote,
      actorId,
    });
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

    // THE BENEFICIARY ALLOWANCE (the PHASE-043 completion round — the
    // hard-protection contract's beneficiary side): per DELIVERED line,
    // the qty of the ACTIVE reserved pool this issue is entitled to
    // draw on — the line's OWN reservation (ACTIVE, non-expired) + the
    // ACTIVE MTO chain reservations feeding that line. These are the
    // EXACT rows the settlement below (step 5) retires through its
    // conditional updates, which is what makes a stale allowance
    // harmless: if any row flips non-ACTIVE between this read and the
    // settlement, the settlement THROWS and the whole post rolls back
    // (the issue with it) — the allowance can never commit an
    // over-issue. Lines without an order line (standalone adds) and
    // every other order's lines carry NO allowance: free stock only.
    const orderLines =
      delivery.orderId !== null ? await store.listSalesOrderLines(delivery.orderId) : [];
    const orderLineById = new Map(orderLines.map((row) => [row.id, row]));
    const { listActiveMtoReservationsForSalesLine } = await import(
      "../../manufacturing/application/production-order-service"
    );
    const invStoreModule = await import("../../inventory/infrastructure/inventory.store");
    const allowanceByLine = new Map<string, string>();
    for (const line of lines) {
      if (line.orderLineId === null) continue;
      const orderLine = orderLineById.get(line.orderLineId);
      if (orderLine === undefined) continue;
      let allowance = new Decimal(0);
      if (orderLine.reservationId !== null) {
        allowance = allowance.plus(
          new Decimal(await invStoreModule.activeReservationQty(orderLine.reservationId)),
        );
      }
      for (const mto of await listActiveMtoReservationsForSalesLine({
        salesOrderLineId: line.orderLineId,
        itemId: line.itemId,
        warehouseId: delivery.warehouseId,
      })) {
        allowance = allowance.plus(new Decimal(mto.qty));
      }
      allowanceByLine.set(line.id, allowance.toFixed(6));
    }

    // (1) Plan every issue (locks positions, CC-04, FEFO/serial binding) — NO writes.
    // PHASE-044 (T-05): when a released WAVE's tasks were scan-confirmed
    // for this delivery, the confirmed physical picks drive the issue's
    // bin allocation (directedTakes) — the economic decrements land on
    // the bins the picker actually walked.
    const waveTakes = await this.picking.directedTakesForDelivery(id);
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
        directedTakes: waveTakes.get(line.lineNo),
        reservedAllowance: allowanceByLine.get(line.id) ?? "0",
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

    // (5) The reservation settlement (the 043-audit item-4 fix + the
    // round-2 item-1 finalization) — per DELIVERED line, PARTIAL by the
    // shipped qty, MTO-first. Pre-fix this step released EVERY order
    // line's OWN reservation on ANY delivery of the order (a partial
    // delivery un-reserved the not-yet-shipped lines' stock) and NEVER
    // touched the MTO chain (G-49's PRODUCTION_ORDER holder
    // reservations leaked ACTIVE forever, permanently reducing
    // availability). The contract now: the shipped qty retires coverage
    // in a deterministic order — FIRST the linked MTO reservations (the
    // made-for-this-order stock, oldest MO first), THEN the line's OWN
    // sales reservation — until the shipped qty is exhausted; a remainder
    // stays ACTIVE for the still-undelivered portion; lines not in THIS
    // delivery keep their reservations untouched; and (5c below) when a
    // delivery COMPLETES the line, every remaining reservation feeding
    // it (the MTO surplus + the own remainder) RELEASES — the surplus
    // flows to free stock, never a leaked holder.
    if (delivery.orderId !== null) {
      const reservationService = await import("../../inventory/application/reservation-service");
      const svc = new reservationService.ReservationService(this.audit);
      const orderLines = await store.listSalesOrderLines(delivery.orderId);
      const orderLineById = new Map(orderLines.map((row) => [row.id, row]));
      for (const line of lines) {
        if (line.orderLineId === null) continue;
        const orderLine = orderLineById.get(line.orderLineId);
        if (orderLine === undefined) continue;
        let toRetire = new Decimal(line.qty);
        // (5a) The MTO chain: ACTIVE PRODUCTION_ORDER reservations of the
        // completed MOs linked to THIS sales line (G-49's holders) —
        // through the manufacturing application surface (the AtpService
        // precedent; never another module's store).
        const { listActiveMtoReservationsForSalesLine } = await import(
          "../../manufacturing/application/production-order-service"
        );
        const mtoReservations = await listActiveMtoReservationsForSalesLine({
          salesOrderLineId: line.orderLineId,
          itemId: line.itemId,
          warehouseId: delivery.warehouseId,
        });
        for (const mto of mtoReservations) {
          if (toRetire.lessThanOrEqualTo(0)) break;
          const take = Decimal.min(toRetire, new Decimal(mto.qty));
          const settled = await svc.partialConsume(mto.id, take.toFixed(6), actorId);
          toRetire = toRetire.minus(take);
          if (settled.status === "CONSUMED" && orderLine.reservationId === mto.id) {
            await store.setOrderLineReservation(orderLine.id, null);
          }
        }
        // (5b) The line's OWN sales reservation — the remainder of the
        // shipped qty retires it partially (fully consumed → the link
        // clears; a remainder stays ACTIVE for the next delivery).
        if (toRetire.greaterThan(0) && orderLine.reservationId !== null) {
          const settled = await svc.partialConsume(
            orderLine.reservationId,
            toRetire.toFixed(6),
            actorId,
          );
          if (settled.status === "CONSUMED") {
            await store.setOrderLineReservation(orderLine.id, null);
          }
        }

        // (5c) THE FULLY-DELIVERED FINALIZATION (the 043-audit round-2
        // item-1 fix): when THIS delivery completes the line (the
        // cumulative POSTED delivered qty + this shipment ≥ the line
        // qty), every reservation still feeding it RETIRES — the MTO
        // SURPLUS (an over-producing MO's excess over the line: the
        // completion holds the ACTUAL qty, the line ships only its own)
        // and the line's OWN reservation REMAINDER (the MTO stock
        // shipped in its place — its held stock never ships) flip
        // RELEASED: the surplus flows to FREE stock (available to any
        // holder again). A fully-delivered line has no still-undelivered
        // portion left to cover; pre-fix both remainders leaked ACTIVE
        // forever, permanently reducing availability.
        const priorDelivered = await store.postedDeliveredQtyForOrderLine(line.orderLineId);
        const cumulativeDelivered = new Decimal(priorDelivered).plus(new Decimal(line.qty));
        if (cumulativeDelivered.greaterThanOrEqualTo(new Decimal(orderLine.qty))) {
          const stillFeeding = await listActiveMtoReservationsForSalesLine({
            salesOrderLineId: line.orderLineId,
            itemId: line.itemId,
            warehouseId: delivery.warehouseId,
          });
          for (const mto of stillFeeding) {
            const current = await svc.find(mto.id);
            if (current.status !== "ACTIVE") continue; // a concurrent settle won
            await svc.release(mto.id, actorId);
            if (orderLine.reservationId === mto.id) {
              await store.setOrderLineReservation(orderLine.id, null);
            }
          }
          if (orderLine.reservationId !== null) {
            const own = await svc.find(orderLine.reservationId);
            if (own.status === "ACTIVE") {
              await svc.release(orderLine.reservationId, actorId);
            }
            await store.setOrderLineReservation(orderLine.id, null);
          }
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
