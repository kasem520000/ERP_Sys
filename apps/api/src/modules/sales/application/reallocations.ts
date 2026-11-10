import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import * as store from "../infrastructure/sales.store";
import {
  ReallocationAmountInvalidError,
  ReallocationSourceInvalidError,
  ReallocationTargetInvalidError,
} from "../domain/sales-errors";

/**
 * AR re-allocation service (PHASE-012 T9; RECEIVABLES_AND_PAYABLES §3.3;
 * BR-027): post-allocation re-allocation happens via AUDITED re-allocation
 * documents — never edits. A sales_reallocation moves a settled amount of
 * a POSTED customer receipt from one AR open item to another open item of
 * the SAME partner, re-validating the INV-016 bounds under the CC-02
 * advisory lock, rewriting the receipt's treasury_allocations rows inside
 * the same transaction, and recording the movement as a durable POSTED
 * document + audit event. The partner subledger is untouched — allocations
 * are settlement metadata; the receipt's AR_CONTROL line keeps its 1:1
 * provenance (INV-009). Draft-time allocation editing (FIFO suggestion,
 * partials, on-account) rides the PHASE-008 treasury allocation service
 * (already keyed sales.receipts.*) — this service owns ONLY the
 * post-posting audited path.
 */

const SRA_FORMAT = { prefix: "SRA", format: "SRA-{YYYY}-{SEQ:6}", docType: "sales_reallocation" };

export interface ReallocationLineInput {
  fromOpenItemId: string | null;
  toOpenItemId: string | null;
  amount: string;
}

@Injectable()
export class SalesReallocationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { receiptId?: string; customerId?: string; limit: number }) {
    return store.listSalesReallocations(filter);
  }

  /**
   * Execute a re-allocation document: validate → rewrite → record, ONE
   * transaction. from NULL = allocate an on-account remainder; to NULL =
   * return an allocation to on-account (BR-027 explicit on-account).
   */
  async execute(input: {
    receiptId: string;
    reason: string;
    actorId: string | null;
    lines: readonly ReallocationLineInput[];
  }) {
    if (input.lines.length === 0) {
      throw new ReallocationAmountInvalidError("re-allocation requires at least one line");
    }
    const treasuryStore = await import("../../treasury/infrastructure/treasury.store");
    const receipt = await treasuryStore.findReceiptById(input.receiptId);
    if (receipt === undefined) {
      throw new ReallocationSourceInvalidError(`receipt ${input.receiptId} does not exist in this tenant`);
    }
    if (receipt.status !== "POSTED") {
      throw new ReallocationSourceInvalidError(
        `receipt ${input.receiptId} is ${receipt.status} — only POSTED receipts re-allocate`,
      );
    }

    // Current posted allocations (the source-of-truth set to rewrite).
    const current = await store.receiptPostedAllocations(input.receiptId);
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
        if (item.partnerId !== receipt.partnerId) {
          throw new ReallocationTargetInvalidError(
            `open item ${line.toOpenItemId} belongs to a different partner than the receipt`,
          );
        }
        if (item.direction !== "DEBIT") {
          throw new ReallocationTargetInvalidError(
            `open item ${line.toOpenItemId} is not an AR receivable (DEBIT) item`,
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

    // INV-016 document bound: Σ new allocations ≤ receipt amount.
    const newTotal = [...nextAllocations.values()].reduce(
      (sum, value) => sum.plus(new Decimal(value)),
      new Decimal(0),
    );
    if (newTotal.gt(new Decimal(receipt.amount))) {
      throw new ReallocationAmountInvalidError(
        `re-allocated total ${newTotal.toFixed(4)} exceeds the receipt amount ${receipt.amount} (INV-016)`,
      );
    }

    // Rewrite the allocation rows (sanctioned posted-replacement path).
    await store.replacePostedReceiptAllocations({
      receiptId: input.receiptId,
      allocations: [...nextAllocations.entries()].map(([openItemId, amount]) => ({ openItemId, amount })),
      actorId: input.actorId,
    });

    // The audited document.
    const today = new Date().toISOString().slice(0, 10);
    const acquired = await this.numbering.reserve({
      docType: SRA_FORMAT.docType,
      branchId: null,
      periodKey: today.slice(0, 4),
      format: SRA_FORMAT.format,
      prefix: SRA_FORMAT.prefix,
      year: today.slice(0, 4),
    });
    const document = await store.insertSalesReallocation({
      receiptId: input.receiptId,
      customerId: receipt.partnerId,
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
    await this.numbering.bind(SRA_FORMAT.docType, acquired.number, document.id);
    await this.audit.record({
      action: "sales.receipt_reallocated",
      entityType: "sales_reallocation",
      entityId: document.id,
      actorId: input.actorId ?? undefined,
      after: {
        docNo: acquired.number,
        receiptId: input.receiptId,
        moved: document.totalAmount,
        lines: input.lines.length,
        allocatedAfter: newTotal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
        reason: input.reason,
      },
    });
    return document;
  }
}
