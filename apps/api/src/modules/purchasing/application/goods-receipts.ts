import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  planReceipt,
  applyReceipt,
  resolveInventoryAccount,
  stagePendingOverlay,
  type ReceiptPlan,
} from "../../inventory/application/movement-core";
import * as store from "../infrastructure/purchasing.store";
import {
  EmptyDocumentError,
  GoodsReceiptNotFoundError,
  GrnExceedsPoLineError,
  GrnLineTargetInvalidError,
  GrnLineWithoutPoError,
  PoLessGrnForbiddenError,
  PoLessReasonRequiredError,
  PoNotIssuedError,
  PurchasingDocumentStateError,
} from "../domain/purchasing-errors";
import { requireSupplier } from "./orders";

/**
 * Goods-receipt service (PHASE-011 T3; golden G-07; INV-018 discipline):
 * posting a GRN is ONE transaction that (1) plans every stock line through
 * the PHASE-010 movement core (plan* — no writes: an engine rejection
 * leaves zero residue by construction), (2) posts the G-07 journal
 * `DR INVENTORY (or expense/asset account) · CR GRNI` through the posting
 * engine, and (3) applies the stock plans WITH the journal id (apply* —
 * the append-only move rows link their economic effect at INSERT time).
 * Purchasing NEVER writes stock tables itself (MODULE_BOUNDARIES).
 *
 * BR-012: PO-less receipts require an explicit reason and may be forbidden
 * entirely by the `purchasing.allow_po_less_grn` policy (default allow).
 */

const GRN_FORMAT = { prefix: "GRN", format: "GRN-{YYYY}-{SEQ:6}", docType: "goods_receipt" };

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const COST_RE = /^\d+(\.\d{1,6})?$/;

export interface GrnLineInput {
  poLineId: string | null;
  itemId: string;
  qty: string;
  unitCost: string;
  accountId: string | null;
  batchNo: string | null;
  batchExpiry: string | null;
  serialIds: string[] | null;
  note: string | null;
}

@Injectable()
export class GoodsReceiptService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; supplierId?: string; poId?: string; limit: number }) {
    return store.listGoodsReceipts(filter);
  }

  async find(id: string) {
    const receipt = await store.findGoodsReceiptById(id);
    if (receipt === undefined) throw new GoodsReceiptNotFoundError(id);
    return receipt;
  }

  async findWithLines(id: string) {
    const receipt = await this.find(id);
    return { ...receipt, lines: await store.listGoodsReceiptLines(id) };
  }

  async create(input: {
    branchId: string;
    supplierId: string;
    poId: string | null;
    warehouseId: string;
    receiptDate: string;
    poLessReason: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    lines: readonly GrnLineInput[];
  }): Promise<store.GoodsReceiptRow> {
    if (input.lines.length === 0) throw new EmptyDocumentError("goods receipt");
    await requireSupplier(input.supplierId);

    let po: store.PurchaseOrderRow | undefined;
    if (input.poId !== null) {
      po = await store.findPurchaseOrderById(input.poId);
      if (po === undefined) {
        throw new GoodsReceiptNotFoundError(input.poId);
      }
      if (po.status !== "ISSUED") throw new PoNotIssuedError(input.poId);
      if (po.supplierId !== input.supplierId) {
        throw new PurchasingDocumentStateError(
          `GRN supplier ${input.supplierId} does not match PO supplier ${po.supplierId}`,
        );
      }
    } else {
      // BR-012: PO-less receipts — policy + explicit reason.
      const allowed = (await store.readSetting<boolean>("purchasing.allow_po_less_grn")) ?? true;
      if (!allowed) throw new PoLessGrnForbiddenError();
      if (input.poLessReason === null || input.poLessReason.trim() === "") {
        throw new PoLessReasonRequiredError();
      }
    }

    // Over-receipt guard per PO line + line-shape validation.
    const received = await store.poLineReceivedQty();
    const poLines = po !== undefined ? await store.listPurchaseOrderLines(po.id) : [];
    const poLineById = new Map(poLines.map((line) => [line.id, line]));
    let totalValue = new Decimal(0);
    type GrnStoreLine = Parameters<typeof store.insertGoodsReceipt>[0]["lines"][number];
    const storeLines: GrnStoreLine[] = [];
    for (const line of input.lines) {
      if (!QTY_RE.test(line.qty) || new Decimal(line.qty).lte(0)) {
        throw new GrnLineTargetInvalidError(`GRN line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      if (!COST_RE.test(line.unitCost) || new Decimal(line.unitCost).lt(0)) {
        throw new GrnLineTargetInvalidError(`GRN line unit cost must be non-negative: ${line.unitCost}`);
      }
      if (line.poLineId !== null) {
        if (po === undefined) {
          throw new GrnLineWithoutPoError({ poId: line.poLineId, lineNo: storeLines.length + 1 });
        }
        const poLine = poLineById.get(line.poLineId);
        if (poLine === undefined) {
          throw new GrnLineTargetInvalidError(
            `GRN line references PO line ${line.poLineId} which is not on PO ${input.poId}`,
          );
        }
        const already = received.get(line.poLineId) ?? "0";
        const after = new Decimal(already).plus(new Decimal(line.qty));
        if (after.comparedTo(new Decimal(poLine.qty)) > 0) {
          throw new GrnExceedsPoLineError({
            poLineId: line.poLineId,
            ordered: poLine.qty,
            alreadyReceived: already,
            requested: line.qty,
          });
        }
      }
      if (line.accountId !== null && line.batchNo !== null) {
        throw new GrnLineTargetInvalidError(
          "expense-account lines cannot carry batch tracking — stock lines only",
        );
      }
      const value = new Decimal(line.qty).times(new Decimal(line.unitCost))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      totalValue = totalValue.plus(new Decimal(value));
      storeLines.push({
        poLineId: line.poLineId,
        itemId: line.itemId,
        qty: new Decimal(line.qty).toFixed(6),
        unitCost: new Decimal(line.unitCost).toFixed(6),
        valueAmount: value,
        accountId: line.accountId,
        batchNo: line.batchNo,
        batchExpiry: line.batchExpiry,
        serialIds: line.serialIds,
        note: line.note,
      });
    }

    const created = await store.insertGoodsReceipt({
      branchId: input.branchId,
      supplierId: input.supplierId,
      poId: input.poId,
      warehouseId: input.warehouseId,
      receiptDate: input.receiptDate,
      poLessReason: input.poId === null ? input.poLessReason : null,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
      totalValue: totalValue.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      lines: storeLines,
    });
    await this.audit.record({
      action: "purchasing.goods_receipt_created",
      entityType: "goods_receipt",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        poId: input.poId,
        poLess: input.poId === null,
        warehouseId: input.warehouseId,
        lines: input.lines.length,
        totalValue: created.totalValue,
      },
    });
    return created;
  }

  /**
   * Post the GRN (G-07): stock plans + journal + applies — one transaction.
   * INV-013 idempotent: a stored entry replays without re-writing moves.
   */
  async post(id: string, actorId: string | null) {
    const receipt = await this.find(id);
    if (receipt.status === "POSTED") {
      // Idempotent replay surface: re-post returns the stored state.
      return {
        receipt: await this.find(id),
        journalEntryId: receipt.postedJournalId,
        receiptNo: receipt.receiptNo,
        idempotentReplay: true,
      };
    }
    if (receipt.status !== "DRAFT") {
      throw new PurchasingDocumentStateError(
        `goods receipt ${id} is ${receipt.status} — only DRAFT receipts post`,
      );
    }
    const lines = await store.listGoodsReceiptLines(id);
    if (lines.length === 0) throw new EmptyDocumentError("goods receipt");

    const base = await ownTenantBaseCurrency();

    // (1) Plan every stock line (locks positions, computes WAC/layers — NO writes).
    const plans: { line: store.GoodsReceiptLineRow; plan: ReceiptPlan }[] = [];
    const expenseLines: store.GoodsReceiptLineRow[] = [];
    for (const line of lines) {
      if (line.accountId !== null) {
        expenseLines.push(line);
        continue;
      }
      const plan = await planReceipt({
        itemId: line.itemId,
        warehouseId: receipt.warehouseId,
        qty: line.qty,
        unitCost: line.unitCost,
        movedAt: receipt.receiptDate,
        moveKind: "receipt",
        sourceType: "goods_receipt",
        sourceId: id,
        batchNo: line.batchNo,
        batchExpiry: line.batchExpiry,
        serialIds: line.serialIds ?? [],
        memo: `GRN ${receipt.receiptNo ?? id}`,
        memoAr: `سند استلام ${receipt.receiptNo ?? id}`,
      });
      plans.push({ line, plan });
      // Stage the pending position so a later line on the SAME item plans
      // from the cumulative position (the overlay is apply-committed; the
      // plan-all-then-apply-all sequence needs explicit staging).
      stagePendingOverlay(plan);
    }

    // (2) The G-07 journal: DR INVENTORY (per resolved account) / DR expense
    // accounts · CR GRNI (single purpose line).
    const debitByAccount = new Map<string, string>();
    for (const { plan } of plans) {
      const accountId = await resolveInventoryAccount(receipt.warehouseId);
      debitByAccount.set(
        accountId,
        new Decimal(debitByAccount.get(accountId) ?? "0").plus(new Decimal(plan.valueAmount)).toFixed(4),
      );
    }
    for (const line of expenseLines) {
      debitByAccount.set(
        line.accountId!,
        new Decimal(debitByAccount.get(line.accountId!) ?? "0").plus(new Decimal(line.valueAmount)).toFixed(4),
      );
    }
    const total = plans.reduce(
      (sum, { plan }) => sum.plus(new Decimal(plan.valueAmount)),
      expenseLines.reduce((sum, line) => sum.plus(new Decimal(line.valueAmount)), new Decimal(0)),
    ).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    const grniMapping = await store.findActiveGrniAccount();
    if (grniMapping === undefined) {
      const { purposeNotMapped } = await import("../../accounting/domain/posting-engine/posting-errors");
      throw purposeNotMapped({ purposeKey: "GRNI" });
    }

    const memo = {
      en: `GRN ${id} — goods received`,
      ar: `سند استلام ${id} — بضاعة مستلمة`,
    };
    const journalLines: JournalLineSpec[] = [];
    for (const [accountId, amount] of [...debitByAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (amount === "0.0000") continue;
      journalLines.push({ accountId, direction: "DEBIT", amount, memo });
    }
    if (total !== "0.0000") {
      journalLines.push({ accountId: grniMapping.accountId, direction: "CREDIT", amount: total, memo });
    }
    if (journalLines.length === 0) {
      throw new PurchasingDocumentStateError(
        `goods receipt ${id} carries zero value — nothing to post`,
      );
    }

    const spec: JournalSpec = {
      source: { docType: "goods_receipt", docId: id, operation: "post" },
      entryDate: receipt.receiptDate,
      description: {
        en: `Goods receipt ${id} — stock received, GRNI accrued`,
        ar: `سند استلام ${id} — استلام مخزون واستحقاق البضاعة غير المفوترة`,
      },
      currency: base,
      lines: journalLines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });

    if (result.idempotentReplay) {
      const current = await this.find(id);
      return {
        receipt: current,
        journalEntryId: result.journalEntryId,
        receiptNo: current.receiptNo,
        idempotentReplay: true,
      };
    }

    // (3) Apply the stock plans with the journal link (INV-018).
    for (const { plan } of plans) {
      await applyReceipt(plan, result.journalEntryId);
    }

    // (4) Official number + status flip.
    const year = receipt.receiptDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: GRN_FORMAT.docType,
      branchId: receipt.branchId,
      periodKey: year,
      format: GRN_FORMAT.format,
      prefix: GRN_FORMAT.prefix,
      year,
    });
    await store.updateGoodsReceiptStatus({
      id,
      status: "POSTED",
      actorId,
      receiptNo: acquired.number,
      postingDate: receipt.receiptDate,
      postedJournalId: result.journalEntryId,
    });
    await this.numbering.bind(GRN_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.goods_receipt_posted",
      entityType: "goods_receipt",
      entityId: id,
      actorId: actorId ?? undefined,
      after: {
        receiptNo: acquired.number,
        journalEntryId: result.journalEntryId,
        totalValue: total,
        stockLines: plans.length,
        expenseLines: expenseLines.length,
      },
    });
    return {
      receipt: await this.find(id),
      journalEntryId: result.journalEntryId,
      receiptNo: acquired.number,
      idempotentReplay: false,
    };
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const receipt = await this.find(id);
    if (receipt.status === "POSTED") {
      throw new PurchasingDocumentStateError(
        "posted goods receipts are immutable — correction is a new document (INV-003/BR-031)",
      );
    }
    await store.updateGoodsReceiptStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.audit.record({
      action: "purchasing.goods_receipt_cancelled",
      entityType: "goods_receipt",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }
}
