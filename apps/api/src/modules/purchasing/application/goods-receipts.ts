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
import { PutawayService } from "../../inventory/application/putaway-service";
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
 *
 * PHASE-042 standard costing (L2-12) — PPV AT RECEIPT, SHAPE A (the
 * documented decision): when the received item carries an ACTIVE standard
 * (item_standard_costs), the stock plan + the inventory debit ride the
 * STANDARD total (WAC layers absorb at standard — the dual mode keeps
 * non-standard items on the legacy WAC-at-actual path byte-identical), and
 * the SAME G-07 journal carries the purchase-price-variance leg for the
 * difference against the line's actual unit cost:
 *   actual > standard: DR PURCHASE_PRICE_VARIANCE (actual − std) × qty
 *   actual < standard: CR PURCHASE_PRICE_VARIANCE (std − actual) × qty
 * The GRNI credit always rides the ACTUAL total, so the journal balances
 * by construction (std debits + PPV = actual). The variance nets across
 * the receipt's stock lines (one purpose leg per journal — the GRNI
 * precedent); the multi-purpose engine line set makes the second-journal
 * fallback unnecessary (recorded as NOT taken).
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
    // PHASE-041 T-13's boot lesson: EVERY constructor param carries its
    // explicit @Inject — a mixed decorated/undecorated signature breaks
    // the full-AppModule resolution.
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(PutawayService) private readonly putaway: PutawayService,
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

    // (1) Plan every stock line (locks positions, computes WAC/layers — NO
    // writes). PHASE-042 PPV shape A: standard items plan at the ACTIVE
    // standard total (the layers absorb at standard); the actual-vs-standard
    // difference accumulates into ppvNet for the variance leg below.
    const plans: { line: store.GoodsReceiptLineRow; plan: ReceiptPlan }[] = [];
    const expenseLines: store.GoodsReceiptLineRow[] = [];
    let ppvNet = new Decimal(0);
    const stockLineActualValue = new Map<store.GoodsReceiptLineRow, string>();
    for (const line of lines) {
      if (line.accountId !== null) {
        expenseLines.push(line);
        continue;
      }
      const standard = await store.findActiveItemStandardCost(line.itemId);
      const planUnitCost = standard !== undefined ? standard.totalCost : line.unitCost;
      const plan = await planReceipt({
        itemId: line.itemId,
        warehouseId: receipt.warehouseId,
        qty: line.qty,
        unitCost: planUnitCost,
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
      // The actual value at the same 4dp quantum the plan uses (qty × unit
      // cost, HALF_UP) — the GRNI side always rides the actual cost.
      const actualValue = new Decimal(line.qty)
        .times(new Decimal(line.unitCost))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        .toFixed(4);
      stockLineActualValue.set(line, actualValue);
      if (standard !== undefined) {
        ppvNet = ppvNet.plus(new Decimal(actualValue).minus(new Decimal(plan.valueAmount)));
      }
      // Stage the pending position so a later line on the SAME item plans
      // from the cumulative position (the overlay is apply-committed; the
      // plan-all-then-apply-all sequence needs explicit staging).
      stagePendingOverlay(plan);
    }

    // (2) The G-07 journal: DR INVENTORY (per resolved account, at standard
    // for standard items — the plan value) / DR expense accounts · [DR|CR
    // PURCHASE_PRICE_VARIANCE for the net standard-vs-actual difference] ·
    // CR GRNI (single purpose line, at the ACTUAL total).
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
    // The GRNI credit rides the ACTUAL value of every line (std plans only
    // moved the inventory side of stock lines).
    const total = plans.reduce(
      (sum, { line }) => sum.plus(new Decimal(stockLineActualValue.get(line)!)),
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
    // PHASE-042 PPV shape A: the net variance leg on the SAME journal — DR
    // when the receipt cost more than standard, CR when less (the purpose
    // resolves to 5990 PURCHASE_PRICE_VARIANCE).
    const ppvAmount = ppvNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    if (ppvAmount !== "0.0000") {
      journalLines.push({
        purpose: "PURCHASE_PRICE_VARIANCE",
        direction: ppvNet.greaterThan(0) ? "DEBIT" : "CREDIT",
        amount: ppvNet.lessThan(0) ? ppvNet.abs().toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4) : ppvAmount,
        memo: {
          en: `GRN ${receipt.receiptNo ?? id} — purchase price variance (standard vs actual)`,
          ar: `سند استلام ${receipt.receiptNo ?? id} — انحراف سعر الشراء (المعياري مقابل الفعلي)`,
        },
      });
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

    // (3b) PHASE-044 (T-04, §2.3/PP-12): the directed-putaway suggestions —
    // one PUTAWAY task per line whose rule suggestion differs from the
    // landing (DEFAULT) bin; the labels ride the response for the
    // immediate bin-label print (PP-12 — the web layer renders them).
    let putawayTasks: Awaited<ReturnType<PutawayService["generateTasksForReceipt"]>> = [];
    try {
      putawayTasks = await this.putaway.generateTasksForReceipt({
        warehouseId: receipt.warehouseId,
        lines: plans.map(({ line, plan }) => ({
          itemId: plan.itemId,
          qty: plan.qty,
          batchId: plan.batchId,
          lpnId: null,
          sourceType: "goods_receipt",
          sourceId: id,
          sourceLineNo: line.lineNo,
        })),
        actorId,
      });
    } catch {
      // The suggestions NEVER block the posted receipt (the tasks are an
      // operational aid, not an economic leg) — a rule-engine failure is
      // surfaced by the task board, not by the GRN post.
      putawayTasks = [];
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
      putawayTasks,
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
