import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import { NumberingService } from "../../accounting/application/numbering-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/purchasing.store";
import * as collab from "../infrastructure/collaboration.store";
import {
  EmptyDocumentError,
  OrderLineInvalidError,
  PartnerNotSupplierError,
  PoNotOpenError,
  PoRevisionParentInvalidError,
  PurchaseOrderNotFoundError,
  PurchaseRequestNotFoundError,
  PurchasingDocumentStateError,
  SupplierNotFoundError,
} from "../domain/purchasing-errors";
import { lineNetAmount, resolvePurchasePrice, enforceApprovedVendorGate } from "./pricing";
import { findContractById } from "../../crm/infrastructure/crm.store";

/**
 * Purchase requests + orders (PHASE-011 T2; DOCUMENT_LIFECYCLE §3; BR-010/
 * BR-029): PRs route through approval to a PO; POs run DRAFT → (threshold
 * approval per BR-010) → ISSUED → CLOSED with amendments as LINKED NEW
 * REVISIONS (revision_of_id — INV-003: no edits). Official numbers reserve
 * at the boundary transitions (request_no at approval, order_no at issue)
 * via the PHASE-007 numbering service.
 */

const PRN_FORMAT = { prefix: "PRN", format: "PRN-{SEQ:6}", docType: "purchase_request" };
const POR_FORMAT = { prefix: "POR", format: "POR-{YYYY}-{SEQ:6}", docType: "purchase_order" };

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;

export async function requireSupplier(supplierId: string): Promise<store.SupplierRow> {
  const supplier = await store.findSupplierById(supplierId);
  if (supplier === undefined) throw new SupplierNotFoundError(supplierId);
  if (supplier.kind !== "SUPPLIER" && supplier.kind !== "BOTH") {
    throw new PartnerNotSupplierError(supplierId);
  }
  if (supplier.status !== "ACTIVE") {
    throw new PurchasingDocumentStateError(
      `supplier ${supplier.code} is ${supplier.status} and cannot receive purchase documents`,
    );
  }
  return supplier;
}

@Injectable()
export class PurchaseRequestService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; limit: number }) {
    return store.listPurchaseRequests(filter);
  }

  async find(id: string) {
    const request = await store.findPurchaseRequestById(id);
    if (request === undefined) throw new PurchaseRequestNotFoundError(id);
    return request;
  }

  async findWithLines(id: string) {
    const request = await this.find(id);
    return { ...request, lines: await store.listPurchaseRequestLines(id) };
  }

  async create(input: {
    branchId: string;
    neededBy: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    lines: readonly { itemId: string; qty: string; note: string | null }[];
  }) {
    if (input.lines.length === 0) throw new EmptyDocumentError("purchase request");
    for (const line of input.lines) {
      if (!QTY_RE.test(line.qty) || new Decimal(line.qty).lte(0)) {
        throw new OrderLineInvalidError(`request line qty must be positive (≤ 6dp): ${line.qty}`);
      }
    }
    const created = await store.insertPurchaseRequest(input);
    await this.audit.record({
      action: "purchasing.purchase_request_created",
      entityType: "purchase_request",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { lines: input.lines.length, branchId: input.branchId, neededBy: input.neededBy },
    });
    return created;
  }

  async submit(id: string, actorId: string | null) {
    const request = await this.find(id);
    if (request.status !== "DRAFT") {
      throw new PurchasingDocumentStateError(
        `purchase request ${id} is ${request.status} — only DRAFT requests can submit`,
      );
    }
    await store.updatePurchaseRequestStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const request = await this.find(id);
    if (request.status !== "PENDING_APPROVAL") {
      throw new PurchasingDocumentStateError(
        `purchase request ${id} is ${request.status} — only PENDING_APPROVAL requests can approve`,
      );
    }
    if (request.createdBy !== null && request.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    const acquired = await this.numbering.reserve({
      docType: PRN_FORMAT.docType,
      branchId: request.branchId,
      periodKey: null,
      format: PRN_FORMAT.format,
      prefix: PRN_FORMAT.prefix,
      year: null,
    });
    await store.updatePurchaseRequestStatus({
      id,
      status: "APPROVED",
      actorId,
      requestNo: acquired.number,
    });
    await this.numbering.bind(PRN_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.purchase_request_approved",
      entityType: "purchase_request",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { requestNo: acquired.number },
    });
    return this.find(id);
  }

  async reject(id: string, reason: string, actorId: string | null) {
    const request = await this.find(id);
    if (request.status !== "PENDING_APPROVAL") {
      throw new PurchasingDocumentStateError(
        `purchase request ${id} is ${request.status} — only PENDING_APPROVAL requests can reject`,
      );
    }
    await store.updatePurchaseRequestStatus({ id, status: "REJECTED", actorId, rejectionReason: reason });
    await this.audit.record({
      action: "purchasing.purchase_request_rejected",
      entityType: "purchase_request",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const request = await this.find(id);
    if (request.status === "CONVERTED" || request.status === "CANCELLED" || request.status === "REJECTED") {
      throw new PurchasingDocumentStateError(
        `purchase request ${id} is ${request.status} — cancellable only from DRAFT/PENDING_APPROVAL/APPROVED`,
      );
    }
    await store.updatePurchaseRequestStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.audit.record({
      action: "purchasing.purchase_request_cancelled",
      entityType: "purchase_request",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }
}

@Injectable()
export class PurchaseOrderService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; supplierId?: string; limit: number }) {
    return store.listPurchaseOrders(filter);
  }

  async find(id: string) {
    const order = await store.findPurchaseOrderById(id);
    if (order === undefined) throw new PurchaseOrderNotFoundError(id);
    return order;
  }

  async findWithLines(id: string) {
    const order = await this.find(id);
    return { ...order, lines: await store.listPurchaseOrderLines(id) };
  }

  /**
   * Create a PO (optionally as a revision of an issued order — the
   * amendment path: linked NEW document, the parent stays immutable).
   */
  async create(input: {
    branchId: string;
    supplierId: string;
    orderDate: string;
    expectedDate: string | null;
    currencyCode: string;
    exchangeRate: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    requestId?: string | null;
    revisionOfId?: string | null;
    /** PHASE-038 (P-06): the optional CRM contract linkage. */
    contractId?: string | null;
    lines: readonly {
      itemId: string;
      qty: string;
      unitPrice: string | null;
      taxCodeId: string | null;
      requestLineId?: string | null;
      note: string | null;
    }[];
  }): Promise<store.PurchaseOrderRow> {
    if (input.lines.length === 0) throw new EmptyDocumentError("purchase order");
    await requireSupplier(input.supplierId);
    // PHASE-038 (P-06): a contract-linked PO must resolve a LIVE contract
    // (foreign/unknown ids are typed 404s; non-ACTIVE contracts reject).
    if (input.contractId !== undefined && input.contractId !== null) {
      const contract = await findContractById(input.contractId);
      if (contract === undefined) {
        throw new OrderLineInvalidError(`contract ${input.contractId} does not exist in this tenant`);
      }
      if (contract.status !== "ACTIVE") {
        throw new OrderLineInvalidError(
          `contract ${input.contractId} is ${contract.status} — contract-linked purchasing requires an ACTIVE contract (P-06)`,
        );
      }
    }
    const base = await ownTenantBaseCurrency();
    if (input.currencyCode !== base && (input.exchangeRate === null || Number(input.exchangeRate) <= 0)) {
      throw new OrderLineInvalidError(
        `PO in ${input.currencyCode} requires a positive exchange rate (base ${base})`,
      );
    }

    const revisionOfId = input.revisionOfId ?? null;
    let revisionNo = 1;
    if (revisionOfId !== null) {
      const parent = await this.find(revisionOfId);
      if (parent.status !== "ISSUED") {
        throw new PoRevisionParentInvalidError(
          `revision parent ${revisionOfId} is ${parent.status} — only ISSUED orders spawn amendments`,
        );
      }
      if (parent.supplierId !== input.supplierId) {
        throw new PoRevisionParentInvalidError(
          `revision parent ${revisionOfId} belongs to a different supplier — amendments cannot switch suppliers`,
        );
      }
      revisionNo = parent.revisionNo + 1;
    }

    let totalNet = new Decimal(0);
    // PHASE-038 (P-04): the approved-vendor gate evaluates once per
    // create (the vendor is the document's, not the line's); the mode
    // decides FLAG (proceed + audited flag) vs BLOCK (typed rejection).
    // The FLAG audit lands AFTER the PO exists (audit entity_id is a
    // uuid — the document is the auditable subject).
    const gateResults = new Map<string, { approved: boolean; mode: string }>();
    const flaggedItems: { itemId: string; mode: string }[] = [];
    type PoStoreLine = Parameters<typeof store.insertPurchaseOrder>[0]["lines"][number];
    const storeLines: PoStoreLine[] = [];
    for (const line of input.lines) {
      if (!QTY_RE.test(line.qty) || new Decimal(line.qty).lte(0)) {
        throw new OrderLineInvalidError(`PO line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      let unitPrice: string;
      let priceSource: string;
      if (line.unitPrice !== null && line.unitPrice !== undefined) {
        if (!PRICE_RE.test(line.unitPrice) || new Decimal(line.unitPrice).lt(0)) {
          throw new OrderLineInvalidError(`PO line unit price must be a non-negative decimal: ${line.unitPrice}`);
        }
        unitPrice = line.unitPrice;
        priceSource = "MANUAL";
      } else {
        const resolved = await resolvePurchasePrice({
          supplierId: input.supplierId,
          itemId: line.itemId,
          qty: line.qty,
        });
        unitPrice = resolved.unitPrice;
        priceSource = resolved.source;
      }
      const netAmount = lineNetAmount(line.qty, unitPrice);
      totalNet = totalNet.plus(new Decimal(netAmount));
      let gate = gateResults.get(line.itemId);
      if (gate === undefined) {
        gate = await enforceApprovedVendorGate({ supplierId: input.supplierId, itemId: line.itemId });
        gateResults.set(line.itemId, gate);
      }
      if (!gate.approved) {
        flaggedItems.push({ itemId: line.itemId, mode: gate.mode });
      }
      storeLines.push({
        itemId: line.itemId,
        qty: new Decimal(line.qty).toFixed(6),
        unitPrice,
        taxCodeId: line.taxCodeId,
        netAmount,
        taxAmount: "0.0000",
        priceSource,
        requestLineId: line.requestLineId ?? null,
        note: line.note,
      });
    }

    const created = await store.insertPurchaseOrder({
      branchId: input.branchId,
      supplierId: input.supplierId,
      orderDate: input.orderDate,
      expectedDate: input.expectedDate,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      revisionOfId,
      revisionNo,
      contractId: input.contractId ?? null,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
      totalNet: totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      totalTax: "0.0000",
      totalGross: totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      taxSummary: null,
      lines: storeLines,
    });

    if (flaggedItems.length > 0) {
      await this.audit.record({
        action: "purchasing.approved_vendor_flagged",
        entityType: "purchase_order",
        entityId: created.id,
        actorId: input.actorId ?? undefined,
        after: { supplierId: input.supplierId, flags: flaggedItems },
      });
    }

    // Convert the source request (audit trail only — the PR was already approved).
    if (input.requestId !== undefined && input.requestId !== null) {
      const request = await store.findPurchaseRequestById(input.requestId);
      if (request === undefined) throw new PurchaseRequestNotFoundError(input.requestId);
      if (request.status !== "APPROVED") {
        throw new PurchasingDocumentStateError(
          `purchase request ${input.requestId} is ${request.status} — only APPROVED requests convert to orders`,
        );
      }
      await store.updatePurchaseRequestStatus({
        id: input.requestId,
        status: "CONVERTED",
        actorId: input.actorId,
        convertedOrderId: created.id,
      });
    }

    await this.audit.record({
      action: "purchasing.purchase_order_created",
      entityType: "purchase_order",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        supplierId: input.supplierId,
        lines: input.lines.length,
        totalNet: created.totalNet,
        revisionOfId,
        revisionNo,
        requestId: input.requestId ?? null,
        contractId: input.contractId ?? null,
      },
    });
    return created;
  }

  /** BR-010: does this order's base-currency gross exceed the threshold? */
  async requiresApproval(order: store.PurchaseOrderRow): Promise<boolean> {
    const threshold = await store.readSetting<string | null>("purchasing.po_approval_threshold");
    if (threshold === null || threshold === undefined) return false;
    const base = await ownTenantBaseCurrency();
    const grossBase =
      order.currencyCode === base
        ? order.totalGross
        : new Decimal(order.totalGross).times(new Decimal(order.exchangeRate ?? "1")).toFixed(4);
    return new Decimal(grossBase).comparedTo(new Decimal(threshold)) > 0;
  }

  async submit(id: string, actorId: string | null) {
    const order = await this.find(id);
    if (order.status !== "DRAFT") {
      throw new PurchasingDocumentStateError(
        `purchase order ${id} is ${order.status} — only DRAFT orders can submit`,
      );
    }
    await store.updatePurchaseOrderStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const order = await this.find(id);
    if (order.status !== "PENDING_APPROVAL") {
      throw new PurchasingDocumentStateError(
        `purchase order ${id} is ${order.status} — only PENDING_APPROVAL orders can approve`,
      );
    }
    if (order.createdBy !== null && order.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    await store.updatePurchaseOrderStatus({ id, status: "APPROVED", actorId });
    await this.audit.record({
      action: "purchasing.purchase_order_approved",
      entityType: "purchase_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { totalGross: order.totalGross },
    });
    return this.find(id);
  }

  /** Issue (the official number reserves here — BR-029). */
  async issue(id: string, actorId: string | null) {
    const order = await this.find(id);
    if (order.status !== "APPROVED") {
      // BR-010: below-threshold orders may skip the approval hop.
      if (order.status === "DRAFT" && !(await this.requiresApproval(order))) {
        await store.updatePurchaseOrderStatus({ id, status: "APPROVED", actorId });
      } else {
        throw new PurchasingDocumentStateError(
          `purchase order ${id} is ${order.status} — approval required before issue (BR-010 threshold routing)`,
        );
      }
    }
    const current = await this.find(id);
    const year = current.orderDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: POR_FORMAT.docType,
      branchId: current.branchId,
      periodKey: year,
      format: POR_FORMAT.format,
      prefix: POR_FORMAT.prefix,
      year,
    });
    await store.updatePurchaseOrderStatus({
      id,
      status: "ISSUED",
      actorId,
      orderNo: acquired.number,
    });
    await this.numbering.bind(POR_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.purchase_order_issued",
      entityType: "purchase_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { orderNo: acquired.number, totalGross: current.totalGross },
    });
    return this.find(id);
  }

  async close(id: string, actorId: string | null) {
    const order = await this.find(id);
    if (order.status !== "ISSUED") throw new PoNotOpenError(id);
    await store.updatePurchaseOrderStatus({ id, status: "CLOSED", actorId });
    await this.audit.record({
      action: "purchasing.purchase_order_closed",
      entityType: "purchase_order",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const order = await this.find(id);
    if (order.status === "POSTED" || order.status === "CLOSED") {
      throw new PurchasingDocumentStateError(
        `purchase order ${id} is ${order.status} — cancellable only before close`,
      );
    }
    await store.updatePurchaseOrderStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.audit.record({
      action: "purchasing.purchase_order_cancelled",
      entityType: "purchase_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  /**
   * PHASE-043 (0076, acceptance criterion 3): stamp the bidirectional
   * MRP-conversion link on a PO the manufacturing suggestion-conversion
   * created through the normal 038 path. Purchasing stays the one writer
   * of purchase_orders rows — the manufacturing module calls THIS method,
   * never the store.
   */
  async linkMrpSuggestion(purchaseOrderId: string, mrpSuggestionId: string): Promise<void> {
    await store.stampPurchaseOrderMrpLink({ purchaseOrderId, mrpSuggestionId });
  }

  /**
   * PHASE-043 (P-04/T-05): the deterministic approved-supplier pick for a
   * PURCHASE conversion — the item's APPROVED sourcing rows, the pick is
   * the earliest non-expiring (expires_at NULLS LAST), then the most
   * recently approved, then the supplier id (a total order — the same
   * input always converts to the same supplier). Undefined when the item
   * has no approved sourcing (the caller decides: BLOCK gate rejection or
   * the price-list fallback).
   */
  async findApprovedSupplierForItem(itemId: string): Promise<string | undefined> {
    const rows = await collab.listApprovedSupplierItems({ itemId, limit: 50 });
    const approved = rows
      .filter((row) => row.status === "APPROVED")
      .filter((row) => row.expiresAt === null || row.expiresAt >= new Date().toISOString().slice(0, 10))
      .sort((a, b) => {
        const aExp = a.expiresAt ?? "9999-12-31";
        const bExp = b.expiresAt ?? "9999-12-31";
        if (aExp !== bExp) return aExp < bExp ? -1 : 1;
        const aAt = a.approvedAt ?? "";
        const bAt = b.approvedAt ?? "";
        if (aAt !== bAt) return aAt > bAt ? -1 : 1;
        return a.supplierId < b.supplierId ? -1 : 1;
      });
    return approved[0]?.supplierId;
  }
}
