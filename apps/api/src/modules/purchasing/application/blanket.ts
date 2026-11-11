import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PurchaseOrderService } from "./orders";
import * as store from "../infrastructure/collaboration.store";
import { blanketReleaseCheck } from "./sourcing-math";
import {
  BlanketExpiredError,
  BlanketOrderNotFoundError,
  BlanketOverReleaseError,
  BlanketReleaseLineInvalidError,
  BlanketStateError,
} from "../domain/sourcing-errors";

/**
 * Blanket agreements service (PHASE-038 T-05; P-03): standing supplier
 * agreements with validity windows, min/max commitments, price-locked
 * lines and the transactional release ledger. Each release decrements the
 * remaining commitment IN THE SAME STATEMENT that guards it (the
 * conditional UPDATE is the over-release race floor — beyond-max is a
 * typed rejection, BR-grade zero residue); expiry blocks new releases;
 * the release generates a purchase order through the PO service (the
 * executable document GRN/AP flow against) and lands append-only in the
 * ledger (NO DELETE).
 */

export const BLANKET_NUMBER_FORMAT = {
  prefix: "BLK",
  format: "BLK-{YYYY}-{SEQ:6}",
  docType: "blanket_order",
} as const;

export const BLANKET_RELEASE_NUMBER_FORMAT = {
  prefix: "BLR",
  format: "BLR-{YYYY}-{SEQ:6}",
  docType: "blanket_release",
} as const;

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;

@Injectable()
export class BlanketService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly orders: PurchaseOrderService,
  ) {}

  async list(filter: { status?: string; supplierId?: string; limit: number }) {
    return store.listBlanketOrders(filter);
  }

  async find(id: string) {
    const blanket = await store.findBlanketOrderById(id);
    if (blanket === undefined) throw new BlanketOrderNotFoundError(id);
    return blanket;
  }

  async findWithReleases(id: string) {
    const blanket = await this.find(id);
    return { ...blanket, releases: await store.listBlanketReleases(id) };
  }

  async create(input: {
    branchId: string;
    supplierId: string;
    contractId: string | null;
    title: string;
    titleAr: string | null;
    currencyCode: string;
    validFrom: string;
    validTo: string;
    minCommitment: string;
    maxCommitment: string;
    priceLock: readonly { itemId: string; unitPrice: string; note?: string }[];
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    if (input.validFrom > input.validTo) {
      throw new BlanketStateError("the blanket validity window ends before it starts");
    }
    if (new Decimal(input.minCommitment).lt(0) || new Decimal(input.maxCommitment).lt(0)) {
      throw new BlanketStateError("blanket commitments must be non-negative");
    }
    if (new Decimal(input.minCommitment).gt(new Decimal(input.maxCommitment))) {
      throw new BlanketStateError("the minimum commitment exceeds the maximum");
    }
    for (const line of input.priceLock) {
      if (!PRICE_RE.test(line.unitPrice) || new Decimal(line.unitPrice).lt(0)) {
        throw new BlanketReleaseLineInvalidError(
          `price-lock unit price must be a non-negative decimal: ${line.unitPrice}`,
        );
      }
    }
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: BLANKET_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: BLANKET_NUMBER_FORMAT.format,
      prefix: BLANKET_NUMBER_FORMAT.prefix,
      year,
    });
    const id = await store.insertBlanketOrder({
      ...input,
      priceLock: [...input.priceLock],
      blanketNo: acquired.number,
    });
    await this.numbering.bind(BLANKET_NUMBER_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.blanket_created",
      entityType: "blanket_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        blanketNo: acquired.number,
        supplierId: input.supplierId,
        maxCommitment: input.maxCommitment,
        contractId: input.contractId,
        priceLockedLines: input.priceLock.length,
      },
    });
    return this.find(id);
  }

  /** Expire lapses: ACTIVE blankets past their window flip EXPIRED (the
   * idempotent housekeeping call — safe to run per-list/read). */
  async lapseExpired(): Promise<number> {
    const rows = await store.listBlanketOrders({ status: "ACTIVE", limit: 500 });
    const today = new Date().toISOString().slice(0, 10);
    let lapsed = 0;
    for (const blanket of rows) {
      if (blanket.validTo < today) {
        await store.updateBlanketOrder(blanket.id, { status: "EXPIRED" });
        await this.audit.record({
          action: "purchasing.blanket_expired",
          entityType: "blanket_order",
          entityId: blanket.id,
          after: { validTo: blanket.validTo },
        });
        lapsed += 1;
      }
    }
    return lapsed;
  }

  /**
   * Release against the remaining commitment: validates the ACTIVE +
   * un-expired state and the line shapes, computes the amount, then
   * advances the parent + appends the ledger row + generates the
   * purchase order — atomically (the conditional UPDATE is the race
   * floor; a lost race surfaces as the typed over-release).
   */
  async release(input: {
    blanketId: string;
    lines: readonly { itemId: string; qty: string; unitPrice: string | null; note?: string }[];
    releaseDate: string;
    note: string | null;
    actorId: string | null;
  }) {
    const blanket = await this.find(input.blanketId);
    if (blanket.status === "EXPIRED" || blanket.validTo < new Date().toISOString().slice(0, 10)) {
      throw new BlanketExpiredError({ blanketId: blanket.id, validTo: blanket.validTo });
    }
    if (blanket.status !== "ACTIVE") {
      throw new BlanketStateError(
        `blanket ${blanket.id} is ${blanket.status} — releases land on ACTIVE agreements only`,
      );
    }
    if (input.lines.length === 0) {
      throw new BlanketReleaseLineInvalidError("a release must carry at least one line");
    }
    // Price resolution: explicit per-line price wins; otherwise the
    // blanket's price lock MUST carry the item (an unpriced release line
    // is a typed rejection — the lock is the agreement's whole point).
    const lockByItem = new Map(blanket.priceLock.map((l) => [l.itemId, l.unitPrice]));
    const resolved: { itemId: string; qty: string; unitPrice: string; note?: string }[] = [];
    let amount = new Decimal(0);
    for (const line of input.lines) {
      if (!QTY_RE.test(line.qty) || new Decimal(line.qty).lte(0)) {
        throw new BlanketReleaseLineInvalidError(`release line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      let unitPrice: string;
      if (line.unitPrice !== null && line.unitPrice !== undefined) {
        if (!PRICE_RE.test(line.unitPrice) || new Decimal(line.unitPrice).lt(0)) {
          throw new BlanketReleaseLineInvalidError(
            `release line unit price must be a non-negative decimal: ${line.unitPrice}`,
          );
        }
        unitPrice = line.unitPrice;
      } else {
        const locked = lockByItem.get(line.itemId);
        if (locked === undefined) {
          throw new BlanketReleaseLineInvalidError(
            `release line has no explicit price and item ${line.itemId} is not in the blanket's price lock`,
          );
        }
        unitPrice = locked;
      }
      amount = amount.plus(new Decimal(line.qty).times(new Decimal(unitPrice)));
      resolved.push({ itemId: line.itemId, qty: line.qty, unitPrice, note: line.note });
    }
    const amountS = amount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    const guard = blanketReleaseCheck({
      requested: amountS,
      releasedAmount: blanket.releasedAmount,
      maxCommitment: blanket.maxCommitment,
    });
    if (!guard.ok) {
      throw new BlanketOverReleaseError({
        blanketId: blanket.id,
        requested: amountS,
        remaining: guard.remaining,
        maxCommitment: blanket.maxCommitment,
      });
    }

    const year = input.releaseDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: BLANKET_RELEASE_NUMBER_FORMAT.docType,
      branchId: blanket.branchId,
      periodKey: year,
      format: BLANKET_RELEASE_NUMBER_FORMAT.format,
      prefix: BLANKET_RELEASE_NUMBER_FORMAT.prefix,
      year,
    });
    // The executable document first (the release ledger carries its id).
    const po = await this.orders.create({
      branchId: blanket.branchId,
      supplierId: blanket.supplierId,
      orderDate: input.releaseDate,
      expectedDate: null,
      currencyCode: blanket.currencyCode,
      exchangeRate: null,
      note: `Blanket release ${acquired.number} (${blanket.blanketNo})`,
      noteAr: `صرف من الاتفاقية الإطارية ${acquired.number} (${blanket.blanketNo})`,
      actorId: input.actorId,
      contractId: blanket.contractId,
      lines: resolved.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        taxCodeId: null,
        note: `Blanket release ${acquired.number}${line.note ? ` — ${line.note}` : ""}`,
      })),
    });
    const updated = await store.releaseBlanketCommitment({
      blanketId: blanket.id,
      amount: amountS,
      release: {
        releaseNo: acquired.number,
        releaseDate: input.releaseDate,
        lines: resolved.map(({ itemId, qty, unitPrice }) => ({ itemId, qty, unitPrice })),
        purchaseOrderId: po.id,
        note: input.note,
        actorId: input.actorId,
      },
    });
    if (updated === undefined) {
      // The race floor fired (a concurrent release consumed the
      // remaining commitment) — the ambient UoW rolls the generated PO
      // back with the throw (zero residue).
      throw new BlanketOverReleaseError({
        blanketId: blanket.id,
        requested: amountS,
        remaining: new Decimal(blanket.maxCommitment)
          .minus(new Decimal(blanket.releasedAmount))
          .toFixed(4),
        maxCommitment: blanket.maxCommitment,
      });
    }
    await this.numbering.bind(BLANKET_RELEASE_NUMBER_FORMAT.docType, acquired.number, po.id);
    await this.audit.record({
      action: "purchasing.blanket_released",
      entityType: "blanket_order",
      entityId: blanket.id,
      actorId: input.actorId ?? undefined,
      after: {
        releaseNo: acquired.number,
        amount: amountS,
        purchaseOrderId: po.id,
        releasedAmount: updated.blanket.releasedAmount,
      },
    });
    return this.findWithReleases(blanket.id);
  }

  /** The award-service hook: a blanket-targeted award releases directly
   * (lines already carry their awarded prices). */
  async releaseFromAward(input: {
    blanketId: string;
    lines: readonly { itemId: string; qty: string; unitPrice: string }[];
    rfqNo: string | null;
    actorId: string | null;
  }): Promise<{ releaseId: string; releaseNo: string; purchaseOrderId: string }> {
    const blanket = await this.find(input.blanketId);
    if (blanket.status !== "ACTIVE") {
      throw new BlanketStateError(
        `blanket ${blanket.id} is ${blanket.status} — awards release on ACTIVE agreements only`,
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    if (blanket.validTo < today) {
      throw new BlanketExpiredError({ blanketId: blanket.id, validTo: blanket.validTo });
    }
    let amount = new Decimal(0);
    for (const line of input.lines) {
      amount = amount.plus(new Decimal(line.qty).times(new Decimal(line.unitPrice)));
    }
    const amountS = amount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const guard = blanketReleaseCheck({
      requested: amountS,
      releasedAmount: blanket.releasedAmount,
      maxCommitment: blanket.maxCommitment,
    });
    if (!guard.ok) {
      throw new BlanketOverReleaseError({
        blanketId: blanket.id,
        requested: amountS,
        remaining: guard.remaining,
        maxCommitment: blanket.maxCommitment,
      });
    }
    const year = today.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: BLANKET_RELEASE_NUMBER_FORMAT.docType,
      branchId: blanket.branchId,
      periodKey: year,
      format: BLANKET_RELEASE_NUMBER_FORMAT.format,
      prefix: BLANKET_RELEASE_NUMBER_FORMAT.prefix,
      year,
    });
    const po = await this.orders.create({
      branchId: blanket.branchId,
      supplierId: blanket.supplierId,
      orderDate: today,
      expectedDate: null,
      currencyCode: blanket.currencyCode,
      exchangeRate: null,
      note: `Blanket release ${acquired.number} — RFQ award ${input.rfqNo ?? ""}`.trim(),
      noteAr: `صرف من الاتفاقية الإطارية ${acquired.number} — ترسية ${input.rfqNo ?? ""}`.trim(),
      actorId: input.actorId,
      contractId: blanket.contractId,
      lines: input.lines.map((line) => ({
        itemId: line.itemId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        taxCodeId: null,
        note: `Blanket release ${acquired.number} (RFQ award)`,
      })),
    });
    const updated = await store.releaseBlanketCommitment({
      blanketId: blanket.id,
      amount: amountS,
      release: {
        releaseNo: acquired.number,
        releaseDate: today,
        lines: input.lines.map(({ itemId, qty, unitPrice }) => ({ itemId, qty, unitPrice })),
        purchaseOrderId: po.id,
        note: `RFQ award ${input.rfqNo ?? ""}`.trim(),
        actorId: input.actorId,
      },
    });
    if (updated === undefined) {
      throw new BlanketOverReleaseError({
        blanketId: blanket.id,
        requested: amountS,
        remaining: new Decimal(blanket.maxCommitment)
          .minus(new Decimal(blanket.releasedAmount))
          .toFixed(4),
        maxCommitment: blanket.maxCommitment,
      });
    }
    await this.numbering.bind(BLANKET_RELEASE_NUMBER_FORMAT.docType, acquired.number, po.id);
    await this.audit.record({
      action: "purchasing.blanket_released",
      entityType: "blanket_order",
      entityId: blanket.id,
      actorId: input.actorId ?? undefined,
      after: {
        releaseNo: acquired.number,
        amount: amountS,
        purchaseOrderId: po.id,
        via: "rfq_award",
      },
    });
    return {
      releaseId: updated.releaseId,
      releaseNo: acquired.number,
      purchaseOrderId: po.id,
    };
  }

  async close(id: string, actorId: string | null) {
    const blanket = await this.find(id);
    if (blanket.status !== "ACTIVE") {
      throw new BlanketStateError(`blanket ${id} is ${blanket.status} — only ACTIVE agreements close`);
    }
    await store.updateBlanketOrder(id, {
      status: "CLOSED",
      closedAt: new Date().toISOString(),
      closedBy: actorId,
    });
    await this.audit.record({
      action: "purchasing.blanket_closed",
      entityType: "blanket_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { releasedAmount: blanket.releasedAmount, maxCommitment: blanket.maxCommitment },
    });
    return this.find(id);
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const blanket = await this.find(id);
    if (blanket.status === "CANCELLED" || blanket.status === "CLOSED") {
      throw new BlanketStateError(`blanket ${id} is ${blanket.status} — already terminal`);
    }
    await store.updateBlanketOrder(id, {
      status: "CANCELLED",
      closedAt: new Date().toISOString(),
      closedBy: actorId,
      cancelReason: reason,
    });
    await this.audit.record({
      action: "purchasing.blanket_cancelled",
      entityType: "blanket_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }
}
