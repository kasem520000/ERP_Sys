import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/sales.store";
import {
  CustomerNotFoundError,
  EmptyDocumentError,
  OrderLineInvalidError,
  PartnerNotCustomerError,
  QuotationExpiredError,
  QuotationNotFoundError,
  SalesDocumentStateError,
} from "../domain/sales-errors";
import { resolveSalesPrice, salesLineNetAmount, PRICE_RE } from "./pricing";

/**
 * Quotation service (PHASE-012 T2; DOCUMENT_LIFECYCLE §3; BR-006):
 * DRAFT → SENT (official QOT- number reserves here) → ACCEPTED (converts
 * to a sales order, same transaction) / REJECTED / EXPIRED / CANCELLED —
 * NO ledger effect at any state. An expired quote cannot be accepted or
 * converted (BR-006); the expiry sweep flips lapsed SENT quotes and the
 * accept/convert path re-verifies valid_until defensively.
 */

const QOT_FORMAT = { prefix: "QOT", format: "QOT-{YYYY}-{SEQ:6}", docType: "quotation" };

const QTY_RE = /^\d+(\.\d{1,6})?$/;

export interface QuotationLineInput {
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
export class QuotationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; customerId?: string; limit: number }) {
    return store.listQuotations(filter);
  }

  async find(id: string) {
    const quotation = await store.findQuotationById(id);
    if (quotation === undefined) throw new QuotationNotFoundError(id);
    return quotation;
  }

  async findWithLines(id: string) {
    const quotation = await this.find(id);
    return { ...quotation, lines: await store.listQuotationLines(id) };
  }

  /** Create a DRAFT quotation (validity from BR-006 default when omitted). */
  async create(input: {
    branchId: string;
    customerId: string;
    salesRepId: string | null;
    quoteDate: string;
    validUntil: string | null;
    currencyCode: string;
    exchangeRate: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    lines: readonly QuotationLineInput[];
  }) {
    if (input.lines.length === 0) throw new EmptyDocumentError("quotation");
    const customer = await requireCustomer(input.customerId);
    const base = await ownTenantBaseCurrency();
    if (input.currencyCode !== base && (input.exchangeRate === null || Number(input.exchangeRate) <= 0)) {
      throw new OrderLineInvalidError(
        `quotation in ${input.currencyCode} requires a positive exchange rate (base ${base})`,
      );
    }
    let validUntil = input.validUntil;
    if (validUntil === null) {
      const days = (await store.readSetting<number>("sales.quote_default_validity_days")) ?? 30;
      validUntil = new Date(
        new Date(`${input.quoteDate}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 10);
    }
    if (validUntil < input.quoteDate) {
      throw new OrderLineInvalidError(
        `valid_until ${validUntil} precedes the quote date ${input.quoteDate} (BR-006)`,
      );
    }

    let totalNet = new Decimal(0);
    type QStoreLine = Parameters<typeof store.insertQuotation>[0]["lines"][number];
    const storeLines: QStoreLine[] = [];
    for (const line of input.lines) {
      const item = await requireSellableItem(line.itemId);
      let unitPrice = line.unitPrice;
      if (unitPrice === null) {
        const resolved = await resolveSalesPrice({
          customerId: input.customerId,
          itemId: line.itemId,
          qty: line.qty,
        });
        unitPrice = resolved.unitPrice;
        if (resolved.source === "MANUAL" || Number(unitPrice) === 0) {
          if (Number(item.basePrice ?? "0") === 0) {
            throw new OrderLineInvalidError(
              `line ${storeLines.length + 1}: item ${line.itemId} has no resolvable price — provide unitPrice explicitly (BR-003)`,
            );
          }
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
        taxAmount: "0.0000", // quotations carry no tax snapshot — resolution happens at order/invoice
        note: line.note,
      });
    }
    const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    const created = await store.insertQuotation({
      branchId: input.branchId,
      customerId: input.customerId,
      salesRepId: input.salesRepId,
      quoteDate: input.quoteDate,
      validUntil,
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
    await this.audit.record({
      action: "sales.quotation_created",
      entityType: "quotation",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { customerId: customer.id, validUntil, totalNet: totalNetS },
    });
    return created;
  }

  /** Send: the official QOT- number reserves here (BR-029 boundary). */
  async send(id: string, actorId: string | null) {
    const quotation = await this.find(id);
    if (quotation.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `quotation ${id} is ${quotation.status} — only DRAFT quotations send`,
      );
    }
    if (quotation.validUntil < new Date().toISOString().slice(0, 10)) {
      throw new QuotationExpiredError({ id, validUntil: quotation.validUntil });
    }
    const year = quotation.quoteDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: QOT_FORMAT.docType,
      branchId: quotation.branchId,
      periodKey: year,
      format: QOT_FORMAT.format,
      prefix: QOT_FORMAT.prefix,
      year,
    });
    await store.updateQuotationStatus({ id, status: "SENT", actorId, quoteNo: acquired.number });
    await this.numbering.bind(QOT_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "sales.quotation_sent",
      entityType: "quotation",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { quoteNo: acquired.number, validUntil: quotation.validUntil },
    });
    return this.find(id);
  }

  async reject(id: string, reason: string | null, actorId: string | null) {
    const quotation = await this.find(id);
    if (quotation.status !== "SENT") {
      throw new SalesDocumentStateError(
        `quotation ${id} is ${quotation.status} — only SENT quotations reject`,
      );
    }
    await store.updateQuotationStatus({
      id,
      status: "REJECTED",
      actorId,
      rejectionReason: reason,
    });
    await this.audit.record({
      action: "sales.quotation_rejected",
      entityType: "quotation",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const quotation = await this.find(id);
    if (quotation.status === "ACCEPTED") {
      throw new SalesDocumentStateError(
        `quotation ${id} already converted to an order — cancel the order instead`,
      );
    }
    await store.updateQuotationStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.audit.record({
      action: "sales.quotation_cancelled",
      entityType: "quotation",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }

  /**
   * BR-006 housekeeping: flip lapsed SENT quotes to EXPIRED (the sweep the
   * nightly job calls; accept/convert re-verifies defensively regardless).
   */
  async sweepExpired(actorId: string | null): Promise<number> {
    const flipped = await store.expireLapsedQuotations();
    if (flipped > 0) {
      await this.audit.record({
        action: "sales.quotation_expiry_sweep",
        entityType: "quotation",
        entityId: "00000000-0000-0000-0000-000000000000",
        actorId: actorId ?? undefined,
        after: { flipped },
      });
    }
    return flipped;
  }
}

/** Active customer in THIS tenant (A7: 404-shape on foreign/unknown). */
export async function requireCustomer(customerId: string): Promise<store.CustomerRow> {
  const customer = await store.findCustomerById(customerId);
  if (customer === undefined) throw new CustomerNotFoundError(customerId);
  if (customer.kind !== "CUSTOMER" && customer.kind !== "BOTH") {
    throw new PartnerNotCustomerError(customerId);
  }
  if (customer.status !== "ACTIVE") {
    throw new SalesDocumentStateError(
      `customer ${customer.code} is ${customer.status} and cannot receive sales documents`,
    );
  }
  return customer;
}

/** Active, non-deleted item (the sellable gate; ITEM_INACTIVE vocabulary). */
export async function requireSellableItem(itemId: string) {
  const itemsStore = await import("../../items/infrastructure/items.store");
  const item = await itemsStore.findItemById(itemId);
  if (item === undefined) {
    throw new OrderLineInvalidError(`item ${itemId} does not exist in this tenant`);
  }
  // Soft-deleted (tombstoned) master data is the tenant's OWN row — the
  // no-disclosure principle targets CROSS-tenant probes, not the sync
  // vocabulary. A deleted item is "deactivated master data" (CONFLICT_
  // RESOLUTION §3 ITEM_INACTIVE row: cancel / substitute-and-resend), so
  // the offline client gets the actionable reason, never a generic
  // VALIDATION_ERROR (PHASE-020 C-11; the 016 registry promise).
  if (item.deletedAt !== null) {
    const { ItemInactiveError } = await import("../domain/sales-errors");
    throw new ItemInactiveError(itemId);
  }
  if (item.status !== undefined && item.status !== null && item.status !== "ACTIVE") {
    const { ItemInactiveError } = await import("../domain/sales-errors");
    throw new ItemInactiveError(itemId);
  }
  return item;
}
