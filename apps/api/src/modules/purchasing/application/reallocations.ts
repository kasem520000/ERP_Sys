import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import * as store from "../infrastructure/purchasing.store";
import {
  ReallocationAmountInvalidError,
  ReallocationSourceInvalidError,
  ReallocationTargetInvalidError,
} from "../domain/purchasing-errors";

/**
 * AP re-allocation service (PHASE-011 T8; RECEIVABLES_AND_PAYABLES §3.3;
 * BR-027): post-allocation re-allocation happens via AUDITED re-allocation
 * documents — never edits. A re-allocation moves settled amounts of a
 * POSTED payment between the supplier's open items (or back to on-account),
 * re-validating the INV-016 bounds under the CC-02 advisory lock, rewriting
 * the payment's allocation rows inside the same transaction, and recording
 * the movement as a durable POSTED document + audit event. The partner
 * subledger is untouched — allocations are settlement metadata; the
 * payment's AP_CONTROL line keeps its 1:1 provenance (INV-009).
 */

const RAL_FORMAT = { prefix: "RAL", format: "RAL-{YYYY}-{SEQ:6}", docType: "purchase_reallocation" };

export interface ReallocationLineInput {
  fromOpenItemId: string | null;
  toOpenItemId: string | null;
  amount: string;
}

@Injectable()
export class ReallocationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { paymentId?: string; limit: number }) {
    return store.listPurchaseReallocations(filter);
  }

  /**
   * Execute a re-allocation document: validate → rewrite → record, ONE
   * transaction. from NULL = allocate an on-account remainder; to NULL =
   * return an allocation to on-account (BR-027 explicit on-account).
   */
  async execute(input: {
    paymentId: string;
    reason: string;
    actorId: string | null;
    lines: readonly ReallocationLineInput[];
  }) {
    if (input.lines.length === 0) {
      throw new ReallocationAmountInvalidError("re-allocation requires at least one line");
    }
    const treasuryStore = await import("../../treasury/infrastructure/treasury.store");
    const payment = await treasuryStore.findPaymentById(input.paymentId);
    if (payment === undefined) {
      throw new ReallocationSourceInvalidError(`payment ${input.paymentId} does not exist in this tenant`);
    }
    if (payment.status !== "POSTED") {
      throw new ReallocationSourceInvalidError(
        `payment ${input.paymentId} is ${payment.status} — only POSTED payments re-allocate`,
      );
    }

    // Current posted allocations (the source-of-truth set to rewrite).
    const current = await store.paymentPostedAllocations(input.paymentId);
    const currentByItem = new Map(current.map((row) => [row.openItemId, row.amount]));

    let totalMoved = new Decimal(0);
    const nextAllocations = new Map<string, string>(currentByItem);
    for (const line of input.lines) {
      const amount = new Decimal(line.amount);
      if (!amount.isFinite() || amount.lte(0)) {
        throw new ReallocationAmountInvalidError(`re-allocation amount must be positive: ${line.amount}`);
      }
      if (line.fromOpenItemId !== null) {
        if (line.fromOpenItemId === line.toOpenItemId) {
          throw new ReallocationTargetInvalidError("from and to open items must differ");
        }
        const settled = new Decimal(currentByItem.get(line.fromOpenItemId) ?? "0");
        if (amount.gt(settled)) {
          throw new ReallocationSourceInvalidError(
            `re-allocation of ${line.amount} exceeds the settled ${settled.toFixed(4)} on open item ${line.fromOpenItemId}`,
          );
        }
        const after = settled.minus(amount);
        if (after.isZero()) nextAllocations.delete(line.fromOpenItemId);
        else nextAllocations.set(line.fromOpenItemId, after.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
      }
      if (line.toOpenItemId !== null) {
        const item = await treasuryStore.findOpenItemById(line.toOpenItemId);
        if (item === undefined) {
          throw new ReallocationTargetInvalidError(`open item ${line.toOpenItemId} does not exist`);
        }
        if (item.partnerId !== payment.partnerId) {
          throw new ReallocationTargetInvalidError(
            `open item ${line.toOpenItemId} belongs to a different partner than the payment`,
          );
        }
        if (item.direction !== "CREDIT") {
          throw new ReallocationTargetInvalidError(
            `open item ${line.toOpenItemId} is not an AP payable (CREDIT) item`,
          );
        }
        const existing = new Decimal(nextAllocations.get(line.toOpenItemId) ?? "0");
        const candidate = existing.plus(amount);
        if (candidate.gt(new Decimal(item.outstanding).plus(existing))) {
          throw new ReallocationTargetInvalidError(
            `re-allocation of ${line.amount} exceeds the outstanding ${item.outstanding} on open item ${line.toOpenItemId} (INV-016)`,
          );
        }
        nextAllocations.set(line.toOpenItemId, candidate.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
      }
      totalMoved = totalMoved.plus(amount);
    }

    // INV-016 document bound: Σ new allocations ≤ payment amount.
    const newTotal = [...nextAllocations.values()].reduce(
      (sum, value) => sum.plus(new Decimal(value)),
      new Decimal(0),
    );
    if (newTotal.gt(new Decimal(payment.amount))) {
      throw new ReallocationAmountInvalidError(
        `re-allocated total ${newTotal.toFixed(4)} exceeds the payment amount ${payment.amount} (INV-016)`,
      );
    }

    // Rewrite the allocation rows (sanctioned posted-replacement path).
    await store.replacePostedAllocations({
      paymentId: input.paymentId,
      allocations: [...nextAllocations.entries()].map(([openItemId, amount]) => ({ openItemId, amount })),
      actorId: input.actorId,
    });

    // The audited document.
    const today = new Date().toISOString().slice(0, 10);
    const acquired = await this.numbering.reserve({
      docType: RAL_FORMAT.docType,
      branchId: null,
      periodKey: today.slice(0, 4),
      format: RAL_FORMAT.format,
      prefix: RAL_FORMAT.prefix,
      year: today.slice(0, 4),
    });
    const document = await store.insertPurchaseReallocation({
      paymentId: input.paymentId,
      supplierId: payment.partnerId,
      reason: input.reason,
      actorId: input.actorId,
      totalAmount: totalMoved.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      docNo: acquired.number,
      lines: input.lines.map((line) => ({
        fromOpenItemId: line.fromOpenItemId,
        toOpenItemId: line.toOpenItemId,
        amount: new Decimal(line.amount).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      })),
    });
    await this.numbering.bind(RAL_FORMAT.docType, acquired.number, document.id);
    await this.audit.record({
      action: "purchasing.payment_reallocated",
      entityType: "purchase_reallocation",
      entityId: document.id,
      actorId: input.actorId ?? undefined,
      after: {
        docNo: acquired.number,
        paymentId: input.paymentId,
        moved: document.totalAmount,
        lines: input.lines.length,
        allocatedAfter: newTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        reason: input.reason,
      },
    });
    return document;
  }
}
