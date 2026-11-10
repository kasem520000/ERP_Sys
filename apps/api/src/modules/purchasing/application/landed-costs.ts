import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { RevaluationService } from "../../inventory/application/revaluation-service";
import * as store from "../infrastructure/purchasing.store";
import {
  LandedCostAmountInvalidError,
  LandedCostGrnInvalidError,
  LandedCostNotFoundError,
  PurchasingDocumentStateError,
} from "../domain/purchasing-errors";

/**
 * Landed costs (PHASE-011 T10 baseline → PHASE-015 T9 full workflow;
 * INVENTORY_ACCOUNTING §3): freight/customs/insurance/other amounts on a
 * POSTED GRN allocate across the received lines by VALUE or by QTY
 * (per document), revaluing the affected WAC/layers through the inventory
 * revaluation service BEFORE any issue from that stock where operationally
 * possible; when stock was already issued at the lower cost, the
 * allocation applies to the remaining quantity and the difference posts
 * to COGS (documented, auditable — never silent back-dating).
 *
 *   journal: DR INVENTORY (on-hand allocation) · DR COGS (issued portion)
 *            CR charge account (accrual/cash/AP — tenant's choice)
 *
 * PHASE-015 completes the workflow: the entitlement-gated routes, MULTIPLE
 * landed-cost documents per GRN (each allocates over the remaining
 * unconsumed quantity — the per-item on-hand budget makes the
 * remaining-qty constraint exact across a document's lines AND across
 * sequential documents, since every post re-reads live on-hand), and the
 * read-only allocation PREVIEW (the same math, no writes) the workflow
 * UI renders before committing.
 */

const LDC_FORMAT = { prefix: "LDC", format: "LDC-{YYYY}-{SEQ:6}", docType: "landed_cost" };

type GrnRow = NonNullable<Awaited<ReturnType<typeof store.findGoodsReceiptById>>>;
type GrnLineRow = Awaited<ReturnType<typeof store.listGoodsReceiptLines>>[number];

/** One line's computed allocation (the preview + posted shapes are one). */
export interface LandedCostAllocationLine {
  grnLineId: string;
  itemId: string;
  warehouseId: string;
  qtyAtAllocation: string;
  remainingQty: string;
  allocatedAmount: string;
  cogsAdjustmentAmount: string;
}

export interface LandedCostAllocation {
  allocations: LandedCostAllocationLine[];
  allocatedToStock: string;
  allocatedToCogs: string;
}

@Injectable()
export class LandedCostService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
    private readonly revaluation: RevaluationService,
  ) {}

  async list(filter: { grnId?: string; limit: number }) {
    return store.listLandedCosts(filter);
  }

  async find(id: string) {
    const cost = await store.findLandedCostById(id);
    if (cost === undefined) throw new LandedCostNotFoundError(id);
    return cost;
  }

  /**
   * Validate the allocation substrate once (create, post, and preview all
   * agree): the GRN exists + is POSTED and carries stock lines, and the
   * amount is a positive finite decimal.
   */
  private async resolveAllocationBase(input: {
    grnId: string;
    amount: string;
  }): Promise<{
    grn: GrnRow;
    stockLines: GrnLineRow[];
    amount: Decimal;
  }> {
    const grn = await store.findGoodsReceiptById(input.grnId);
    if (grn === undefined) {
      throw new LandedCostGrnInvalidError(`goods receipt ${input.grnId} does not exist in this tenant`);
    }
    if (grn.status !== "POSTED") {
      throw new LandedCostGrnInvalidError(
        `goods receipt ${input.grnId} is ${grn.status} — landed costs attach to POSTED receipts`,
      );
    }
    const amount = new Decimal(input.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new LandedCostAmountInvalidError(`landed-cost amount must be positive: ${input.amount}`);
    }
    const lines = await store.listGoodsReceiptLines(input.grnId);
    const stockLines = lines.filter((line) => line.accountId === null);
    if (stockLines.length === 0) {
      throw new LandedCostGrnInvalidError(
        `goods receipt ${input.grnId} carries no stock lines — landed costs allocate over stock only`,
      );
    }
    return { grn, stockLines, amount };
  }

  /**
   * The ONE allocation computation (POST and PREVIEW share it — the
   * preview matches the eventual posting to the cent by construction):
   * per-line shares by VALUE (line value / Σ values) or QTY (line qty /
   * Σ qty), the exact-Σ rule (the last line absorbs the rounding
   * remainder), and the remaining-qty constraint with a PER-ITEM on-hand
   * budget — the item's live on-hand is counted ONCE per document, so two
   * lines of the same item (or a second landed-cost document after an
   * issue) never double-credit the same physical units
   * (INVENTORY_ACCOUNTING §3).
   */
  private async computeAllocation(input: {
    grn: GrnRow;
    stockLines: GrnLineRow[];
    amount: Decimal;
    allocationMethod: "VALUE" | "QTY";
  }): Promise<LandedCostAllocation> {
    const { grn, stockLines, amount } = input;
    const basis =
      input.allocationMethod === "VALUE"
        ? stockLines.map((line) => new Decimal(line.valueAmount))
        : stockLines.map((line) => new Decimal(line.qty));
    const basisTotal = basis.reduce((sum, value) => sum.plus(value), new Decimal(0));

    const inventoryStore = await import("../../inventory/infrastructure/inventory.store");
    const allocations: LandedCostAllocationLine[] = [];
    const budgetByItem = new Map<string, Decimal>();
    let toStock = new Decimal(0);
    let toCogs = new Decimal(0);
    let distributed = new Decimal(0);
    for (const [index, line] of stockLines.entries()) {
      const share = basisTotal.isZero() ? new Decimal(0) : amount.times(basis[index]!).div(basisTotal);
      const isLast = index === stockLines.length - 1;
      // Exact Σ: the last line absorbs the rounding remainder.
      const allocated = isLast
        ? amount.minus(distributed)
        : share.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      distributed = distributed.plus(allocated);

      // Remaining-qty constraint: the portion still on hand revalues; the
      // issued portion (qty issued at the lower cost) posts to COGS. The
      // per-item budget makes the constraint CUMULATIVE within a document
      // (each unit of on-hand absorbs value once, across every line of the
      // item on this GRN).
      let budget = budgetByItem.get(line.itemId);
      if (budget === undefined) {
        const onHand = await inventoryStore.findItemStock(line.itemId, grn.warehouseId);
        budget = new Decimal(onHand?.qty ?? "0");
      }
      const lineQty = new Decimal(line.qty);
      const remainingQty = Decimal.min(budget, lineQty);
      budgetByItem.set(line.itemId, budget.minus(remainingQty));
      const onHandRatio = lineQty.isZero() ? new Decimal(0) : remainingQty.div(lineQty);
      const stockPart = allocated.times(onHandRatio).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      const cogsPart = allocated.minus(stockPart).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      toStock = toStock.plus(stockPart);
      toCogs = toCogs.plus(cogsPart);
      allocations.push({
        grnLineId: line.id,
        itemId: line.itemId,
        warehouseId: grn.warehouseId,
        qtyAtAllocation: lineQty.toFixed(6),
        remainingQty: remainingQty.toFixed(6),
        allocatedAmount: stockPart.toFixed(4),
        cogsAdjustmentAmount: cogsPart.toFixed(4),
      });
    }
    return {
      allocations,
      allocatedToStock: toStock.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      allocatedToCogs: toCogs.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
    };
  }

  /**
   * The allocation PREVIEW (PHASE-015 full-workflow surface): the exact
   * computation the eventual post will run — read-only, no rows, no
   * journal, no numbering. The on-hand read is live, so a preview matches
   * the posting while no issues land in between (the UI contract).
   */
  async preview(input: {
    grnId: string;
    costType: "freight" | "customs" | "insurance" | "other";
    amount: string;
    allocationMethod: "VALUE" | "QTY";
  }): Promise<
    LandedCostAllocation & {
      grnId: string;
      costType: string;
      amount: string;
      allocationMethod: string;
    }
  > {
    const base = await this.resolveAllocationBase(input);
    const amount = base.amount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const computed = await this.computeAllocation({
      grn: base.grn,
      stockLines: base.stockLines,
      amount: base.amount,
      allocationMethod: input.allocationMethod,
    });
    return {
      grnId: input.grnId,
      costType: input.costType,
      amount,
      allocationMethod: input.allocationMethod,
      ...computed,
    };
  }

  async create(input: {
    grnId: string;
    costType: "freight" | "customs" | "insurance" | "other";
    vendorId: string | null;
    amount: string;
    allocationMethod: "VALUE" | "QTY";
    chargeAccountId: string;
    note: string | null;
    actorId: string | null;
  }): Promise<store.LandedCostRow> {
    const base = await this.resolveAllocationBase(input);
    const created = await store.insertLandedCost({
      grnId: input.grnId,
      costType: input.costType,
      vendorId: input.vendorId,
      amount: base.amount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
      allocationMethod: input.allocationMethod,
      chargeAccountId: input.chargeAccountId,
      note: input.note,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "purchasing.landed_cost_created",
      entityType: "landed_cost",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { grnId: input.grnId, costType: input.costType, amount: created.amount, allocationMethod: input.allocationMethod },
    });
    return created;
  }

  /**
   * Post the allocation: compute per-line shares (VALUE = received line
   * value / Σ values; QTY = received qty / Σ qty), apply the remaining-qty
   * constraint (on-hand at allocation time — cumulative across this GRN's
   * lines and any earlier landed-cost documents), post the journal, and
   * revalue the on-hand stock through the inventory service — one
   * transaction. Multiple documents per GRN post sequentially; each
   * re-reads live on-hand, so every document allocates over the REMAINING
   * unconsumed quantity only.
   */
  async post(id: string, actorId: string | null) {
    const cost = await this.find(id);
    if (cost.status === "POSTED") {
      return { cost, journalEntryId: cost.postedJournalId, costNo: cost.costNo, idempotentReplay: true };
    }
    if (cost.status !== "DRAFT") {
      throw new PurchasingDocumentStateError(`landed cost ${id} is ${cost.status} — only DRAFT costs post`);
    }
    const grn = await store.findGoodsReceiptById(cost.grnId);
    if (grn === undefined || grn.status !== "POSTED") {
      throw new LandedCostGrnInvalidError("the owning goods receipt is no longer POSTED");
    }
    const lines = await store.listGoodsReceiptLines(cost.grnId);
    const stockLines = lines.filter((line) => line.accountId === null);
    const base = await ownTenantBaseCurrency();
    const amount = new Decimal(cost.amount);

    const { allocations, allocatedToStock, allocatedToCogs } = await this.computeAllocation({
      grn,
      stockLines,
      amount,
      allocationMethod: cost.allocationMethod === "VALUE" ? "VALUE" : "QTY",
    });
    const toStock = new Decimal(allocatedToStock);
    const toCogs = new Decimal(allocatedToCogs);

    // Journal: DR INVENTORY (per account) · DR COGS · CR charge account.
    const debitByAccount = new Map<string, string>();
    const inventoryAccount = await (async () => {
      const { resolveInventoryAccount } = await import("../../inventory/application/movement-core");
      return resolveInventoryAccount(grn.warehouseId);
    })();
    if (toStock.gt(0)) {
      debitByAccount.set(inventoryAccount, toStock.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
    }
    let cogsAccount: string | null = null;
    if (toCogs.gt(0)) {
      const { findActivePurpose } = await import("../../accounting/infrastructure/accounting.store");
      const mapping = await findActivePurpose("COGS");
      if (mapping === undefined) {
        const { purposeNotMapped } = await import("../../accounting/domain/posting-engine/posting-errors");
        throw purposeNotMapped({ purposeKey: "COGS" });
      }
      cogsAccount = mapping.accountId;
      debitByAccount.set(cogsAccount, toCogs.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4));
    }
    const journalLines: JournalLineSpec[] = [];
    for (const [accountId, amountLine] of [...debitByAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      journalLines.push({
        accountId,
        direction: "DEBIT",
        amount: amountLine,
        memo: { en: `Landed cost ${cost.costType}`, ar: `تكلفة إضافية (${cost.costType})` },
      });
    }
    journalLines.push({
      accountId: cost.chargeAccountId,
      direction: "CREDIT",
      amount: cost.amount,
      memo: { en: `Landed cost charge — ${cost.costType}`, ar: `تحميل تكلفة إضافية — ${cost.costType}` },
    });

    const spec: JournalSpec = {
      source: { docType: "landed_cost", docId: id, operation: "post" },
      entryDate: grn.receiptDate,
      description: {
        en: `Landed cost (${cost.costType}) on GRN ${cost.grnId}`,
        ar: `تكلفة إضافية (${cost.costType}) على سند استلام ${cost.grnId}`,
      },
      currency: base,
      lines: journalLines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });
    if (result.idempotentReplay) {
      const current = await this.find(id);
      return { cost: current, journalEntryId: result.journalEntryId, costNo: current.costNo, idempotentReplay: true };
    }

    // Substrate revalue through the inventory service (on-hand portions).
    for (const allocation of allocations) {
      if (Number(allocation.allocatedAmount) <= 0) continue;
      await this.revaluation.applyLandedCostRevalue({
        itemId: allocation.itemId,
        warehouseId: allocation.warehouseId,
        amount: allocation.allocatedAmount,
        journalEntryId: result.journalEntryId,
        movedAt: grn.receiptDate,
        sourceType: "landed_cost",
        sourceId: id,
        actorId,
      });
    }

    const year = grn.receiptDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: LDC_FORMAT.docType,
      branchId: grn.branchId,
      periodKey: year,
      format: LDC_FORMAT.format,
      prefix: LDC_FORMAT.prefix,
      year,
    });
    await store.updateLandedCostStatus({
      id,
      status: "POSTED",
      actorId,
      costNo: acquired.number,
      postingDate: grn.receiptDate,
      postedJournalId: result.journalEntryId,
      allocatedToStock,
      allocatedToCogs,
      allocations,
    });
    await this.numbering.bind(LDC_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.landed_cost_posted",
      entityType: "landed_cost",
      entityId: id,
      actorId: actorId ?? undefined,
      after: {
        costNo: acquired.number,
        journalEntryId: result.journalEntryId,
        amount: cost.amount,
        allocatedToStock,
        allocatedToCogs,
        method: cost.allocationMethod,
      },
    });
    return {
      cost: await this.find(id),
      journalEntryId: result.journalEntryId,
      costNo: acquired.number,
      idempotentReplay: false,
    };
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const cost = await this.find(id);
    if (cost.status === "POSTED") {
      throw new PurchasingDocumentStateError(
        "posted landed costs are immutable — correction is a new document (INV-003/BR-031)",
      );
    }
    await store.updateLandedCostStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    return this.find(id);
  }
}
