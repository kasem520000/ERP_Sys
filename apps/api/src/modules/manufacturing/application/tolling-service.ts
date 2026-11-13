import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import {
  planIssue,
  applyIssue,
  planReceipt,
  applyReceipt,
  resolveInventoryAccount,
  requireActiveWarehouse,
  type IssuePlan,
  type ReceiptPlan,
} from "../../inventory/application/movement-core";
import { PurchaseOrderService } from "../../purchasing/application/orders";
import { requireSupplier } from "../../purchasing/application/orders";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/planning.store";
import * as mfgStore from "../infrastructure/manufacturing.store";
import {
  BomNotFoundError,
  TollingInputInvalidError,
  TollingOrderNotFoundError,
  TollingStateError,
} from "../domain/manufacturing-errors";

/**
 * Contract manufacturing (tolling) service (PHASE-043 T-10; M-21): the
 * stock-at-processor round trip —
 *
 *   DRAFT → ISSUED (the material issue legs: stock leaves to the
 *            processor, DR TOLLING_MATERIALS 1420 · CR inventory; the
 *            optional conversion-fee PO through the PHASE-038 path) →
 *   RETURNED (the return legs: finished goods back — DR FG inventory ·
 *            CR 1420 (the materials share) · CR TOLLING_CONVERSION_
 *            PAYABLE 2136 (the proportional fee accrual, cleared by the
 *            fee PO's supplier invoice through AP); unused materials
 *            back — DR inventory · CR 1420; the explicit yield loss —
 *            DR TOLLING_YIELD_LOSS 5126 · CR 1420) →
 *   SETTLED (the G-48 gate: the 1420 order balance nets to EXACTLY zero
 *            — Σ issue value = Σ return-finished value + Σ
 *            returned-material value + Σ yield-loss value).
 *
 * The value attribution (deterministic): a finished return of qty q
 * carries the materials share V × q / plannedQty (4dp) + the fee share
 * fee × q / plannedQty (4dp, capitalized into the FG cost); the residual
 * after partial returns is settled explicitly as yield loss (the
 * settle() gate names the exact residual in its typed rejection — never
 * a silent scrap). Every stock leg flows through the movement core and
 * every journal through the centralized engine (ADR-0007).
 */

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function round4(value: Decimal): Decimal {
  return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}
function round6(value: Decimal): Decimal {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

@Injectable()
export class TollingService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(PurchaseOrderService) private readonly purchaseOrders: PurchaseOrderService,
  ) {}

  // -- reads -------------------------------------------------------------------------

  async find(id: string): Promise<store.ContractMfgOrderRow> {
    const order = await store.findContractMfgOrderById(id);
    if (order === undefined) throw new TollingOrderNotFoundError(id);
    return order;
  }

  async get(id: string): Promise<{
    order: store.ContractMfgOrderRow;
    moves: store.ContractMfgMoveRow[];
    ledger: Record<"ISSUE_TO_PROCESSOR" | "RETURN_FINISHED" | "RETURN_MATERIAL" | "YIELD_LOSS", string>;
    atProcessorBalance: string;
  }> {
    const order = await this.find(id);
    const moves = await store.listContractMfgMoves(id);
    const ledger = await store.sumContractMfgValues(id);
    const balance = new Decimal(ledger.ISSUE_TO_PROCESSOR)
      .minus(new Decimal(ledger.RETURN_FINISHED))
      .minus(new Decimal(ledger.RETURN_MATERIAL))
      .minus(new Decimal(ledger.YIELD_LOSS));
    return { order, moves, ledger, atProcessorBalance: balance.toFixed(4) };
  }

  async list(filter: { status?: string; limit: number }): Promise<store.ContractMfgOrderRow[]> {
    return store.listContractMfgOrders(filter);
  }

  // -- create (DRAFT) -----------------------------------------------------------------

  async create(input: {
    processorPartnerId: string;
    itemId: string;
    bomId: string;
    warehouseId: string;
    plannedQty: string;
    expectedReturnDate?: string | null;
    conversionFee?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.ContractMfgOrderRow> {
    await requireSupplier(input.processorPartnerId);
    const item = await store.findItemPlanning(input.itemId);
    if (item === undefined || item.kind !== "STOCK") {
      throw new TollingInputInvalidError(`item ${input.itemId} must be a STOCK item of this tenant`);
    }
    const bom = await mfgStore.findBomById(input.bomId);
    if (bom === undefined || bom.itemId !== input.itemId) {
      throw new BomNotFoundError(`bill of materials ${input.bomId} is not a version of item ${input.itemId}`);
    }
    await requireActiveWarehouse(input.warehouseId);
    if (!QTY_RE.test(input.plannedQty) || new Decimal(input.plannedQty).lessThanOrEqualTo(0)) {
      throw new TollingInputInvalidError(`plannedQty must be a positive decimal (≤ 6dp): ${input.plannedQty}`);
    }
    if (
      input.expectedReturnDate !== undefined &&
      input.expectedReturnDate !== null &&
      (!DATE_RE.test(input.expectedReturnDate) || Number.isNaN(Date.parse(`${input.expectedReturnDate}T00:00:00Z`)))
    ) {
      throw new TollingInputInvalidError(`expectedReturnDate must be an ISO date: ${input.expectedReturnDate}`);
    }
    if (
      input.conversionFee !== undefined &&
      input.conversionFee !== null &&
      (!MONEY_RE.test(input.conversionFee) || new Decimal(input.conversionFee).lessThan(0))
    ) {
      throw new TollingInputInvalidError(`conversionFee must be a non-negative decimal (≤ 4dp): ${input.conversionFee}`);
    }
    const created = await store.insertContractMfgOrder({
      processorPartnerId: input.processorPartnerId,
      itemId: input.itemId,
      bomId: input.bomId,
      warehouseId: input.warehouseId,
      plannedQty: new Decimal(input.plannedQty).toFixed(6),
      uomId: item.baseUomId,
      expectedReturnDate: input.expectedReturnDate ?? null,
      conversionFee: input.conversionFee === undefined || input.conversionFee === null
        ? null
        : round4(new Decimal(input.conversionFee)).toFixed(4),
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "manufacturing.tolling.created",
      entityType: "contract_mfg_order",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { processorPartnerId: input.processorPartnerId, itemId: input.itemId, plannedQty: created.plannedQty },
    });
    return created;
  }

  // -- issue (DRAFT → ISSUED: the material legs + the optional fee PO) -----------------

  async issue(
    id: string,
    input: {
      materials: readonly { itemId: string; qty: string; batchId?: string | null }[];
      /** The conversion-fee PO inputs (PHASE-038 path); optional — the
       * accrual still lands at the return legs when the order carries a
       * conversion_fee. */
      feePo?: { supplierId: string; serviceItemId: string } | null;
      issuedAt?: string | null;
      note?: string | null;
      actorId: string | null;
    },
  ): Promise<{ order: store.ContractMfgOrderRow; moves: store.ContractMfgMoveRow[]; feePoId: string | null }> {
    const order = await this.find(id);
    if (order.status !== "DRAFT") {
      throw new TollingStateError(`tolling order ${order.tollingNo ?? id} is ${order.status} — only DRAFT orders issue`);
    }
    if (input.materials.length < 1 || input.materials.length > 200) {
      throw new TollingInputInvalidError(`an issue carries 1..200 material lines — got ${input.materials.length}`);
    }
    const issuedAt = input.issuedAt ?? today();
    if (!DATE_RE.test(issuedAt)) {
      throw new TollingInputInvalidError(`issuedAt must be an ISO date: ${issuedAt}`);
    }

    // The BOM's components are the legal issue set (the release-frozen
    // plan precedent — the level-1 lines of the bound BOM version).
    const bomLines = await mfgStore.listBomLines(order.bomId);
    const plannedByItem = new Map(bomLines.map((line) => [line.componentItemId, line]));
    for (const material of input.materials) {
      if (!QTY_RE.test(material.qty) || new Decimal(material.qty).lessThanOrEqualTo(0)) {
        throw new TollingInputInvalidError(`material qty must be a positive decimal (≤ 6dp): ${material.qty}`);
      }
      if (!plannedByItem.has(material.itemId)) {
        throw new TollingInputInvalidError(
          `material ${material.itemId} is not a component of the bound bill of materials — corrections are adjusted issues of planned items`,
        );
      }
    }

    // PLAN every material (the multi-slice pending-overlay discipline),
    // then ONE journal for the whole issue event.
    const plans: { itemId: string; plan: IssuePlan }[] = [];
    for (const material of input.materials) {
      const plan = await planIssue({
        itemId: material.itemId,
        warehouseId: order.warehouseId,
        qty: material.qty,
        movedAt: issuedAt,
        moveKind: "issue",
        sourceType: "contract_mfg",
        sourceId: id,
        batchId: material.batchId ?? null,
        memo: `Tolling ${order.tollingNo ?? id} — materials to processor`,
        memoAr: `تصنيع تعاقدي ${order.tollingNo ?? id} — صرف مواد للمعالج`,
      });
      plans.push({ itemId: material.itemId, plan });
      const { stagePendingOverlay } = await import("../../inventory/application/movement-core");
      stagePendingOverlay(plan);
    }
    const totalValue = plans
      .reduce((sum, { plan }) => sum.plus(new Decimal(plan.valueAmount)), new Decimal(0))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    if (totalValue.lessThanOrEqualTo(0)) {
      throw new TollingInputInvalidError(`the issue of tolling order ${id} values to zero — nothing to post`);
    }
    const inventoryAccount = await resolveInventoryAccount(order.warehouseId);
    const lines: JournalLineSpec[] = [
      {
        purpose: "TOLLING_MATERIALS",
        direction: "DEBIT",
        amount: totalValue.toFixed(4),
        memo: {
          en: `Tolling ${order.tollingNo ?? id} — materials at processor`,
          ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — مواد لدى المعالج`,
        },
      },
      {
        accountId: inventoryAccount,
        direction: "CREDIT",
        amount: totalValue.toFixed(4),
        memo: {
          en: `Tolling ${order.tollingNo ?? id} — materials issued from store`,
          ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — صرف مواد من المخزن`,
        },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "contract_mfg_order", docId: id, operation: "issue" },
      entryDate: issuedAt,
      description: {
        en: `Tolling ${order.tollingNo ?? id} — material issue to processor`,
        ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — صرف مواد للمعالج`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });

    // Apply the stock legs + one ledger row per material.
    for (const { itemId, plan } of plans) {
      await applyIssue(plan, posted.journalEntryId);
      const unitCost = round6(new Decimal(plan.valueAmount).div(new Decimal(plan.qty)));
      await store.insertContractMfgMove({
        orderId: id,
        moveKind: "ISSUE_TO_PROCESSOR",
        itemId,
        qty: plan.qty,
        unitCost: unitCost.toFixed(6),
        valueAmount: new Decimal(plan.valueAmount).toFixed(4),
        batchId: null,
        stockMoveId: null,
        journalId: posted.journalEntryId,
        note: input.note ?? null,
        actorId: input.actorId,
      });
    }

    // The TLG number + the optional fee PO (the 038 path — the
    // AwardService.award precedent; the fee is a SERVICE item line).
    const warehouse = await requireActiveWarehouse(order.warehouseId);
    const year = today().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: "contract_mfg_order",
      branchId: warehouse.branchId,
      periodKey: year,
      format: "TLG-{YYYY}-{SEQ:5}",
      prefix: "TLG",
      year,
    });
    await this.numbering.bind("contract_mfg_order", acquired.number, id);

    let feePoId: string | null = null;
    if (input.feePo !== undefined && input.feePo !== null && order.conversionFee !== null) {
      const feePo = await this.purchaseOrders.create({
        branchId: warehouse.branchId,
        supplierId: input.feePo.supplierId,
        orderDate: today(),
        expectedDate: order.expectedReturnDate,
        currencyCode: await ownTenantBaseCurrency(),
        exchangeRate: null,
        note: `Tolling ${acquired.number} — conversion service fee`,
        noteAr: `تصنيع تعاقدي ${acquired.number} — أجر خدمة التحويل`,
        actorId: input.actorId,
        lines: [
          {
            itemId: input.feePo.serviceItemId,
            qty: "1",
            unitPrice: order.conversionFee,
            taxCodeId: null,
            note: `Tolling ${acquired.number} fee`,
          },
        ],
      });
      feePoId = feePo.id;
    }

    await store.patchContractMfgOrder({ id, status: "ISSUED", tollingNo: acquired.number, feePoId, issuedAt: true });
    await this.audit.record({
      action: "manufacturing.tolling.issued",
      entityType: "contract_mfg_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        tollingNo: acquired.number,
        materials: plans.length,
        value: totalValue.toFixed(4),
        feePoId,
        journalEntryId: posted.journalEntryId,
      },
    });
    return { order: await this.find(id), moves: await store.listContractMfgMoves(id), feePoId };
  }

  // -- return (ISSUED → RETURNED: finished + materials + the explicit yield loss) -------

  async return_(
    id: string,
    input: {
      finished: readonly { qty: string; batchNo?: string | null }[];
      returnedMaterials: readonly { itemId: string; qty: string }[];
      yieldLoss: readonly { itemId: string; qty: string; value: string }[];
      returnedAt?: string | null;
      note?: string | null;
      actorId: string | null;
    },
  ): Promise<{ order: store.ContractMfgOrderRow; moves: store.ContractMfgMoveRow[] }> {
    const order = await this.find(id);
    if (order.status !== "ISSUED") {
      throw new TollingStateError(
        `tolling order ${order.tollingNo ?? id} is ${order.status} — returns land on ISSUED orders only`,
      );
    }
    const returnedAt = input.returnedAt ?? today();
    if (!DATE_RE.test(returnedAt)) {
      throw new TollingInputInvalidError(`returnedAt must be an ISO date: ${returnedAt}`);
    }
    if (input.finished.length + input.returnedMaterials.length + input.yieldLoss.length < 1) {
      throw new TollingInputInvalidError("a return carries at least one leg (finished, materials, or yield loss)");
    }

    const ledger = await store.sumContractMfgValues(id);
    const issuedValue = new Decimal(ledger.ISSUE_TO_PROCESSOR);
    const alreadyReturned =
      new Decimal(ledger.RETURN_FINISHED).plus(new Decimal(ledger.RETURN_MATERIAL)).plus(new Decimal(ledger.YIELD_LOSS));
    const remainingBalance = issuedValue.minus(alreadyReturned);
    const alreadyFinished = await this.finishedQtySoFar(id);
    const planned = new Decimal(order.plannedQty);

    // ---- pass 1 (pure values): the returned-material and yield-loss
    // legs' values FIRST — the FULL-return finished leg takes the exact
    // residual so the ledger closes to zero without rounding residue.
    const issueMoves = (await store.listContractMfgMoves(id)).filter((m) => m.moveKind === "ISSUE_TO_PROCESSOR");
    const materialLegValues: { itemId: string; qty: string; value: Decimal; unitCost: Decimal }[] = [];
    for (const leg of input.returnedMaterials) {
      if (!QTY_RE.test(leg.qty) || new Decimal(leg.qty).lessThanOrEqualTo(0)) {
        throw new TollingInputInvalidError(`returned material qty must be positive (≤ 6dp): ${leg.qty}`);
      }
      const issued = issueMoves.filter((m) => m.itemId === leg.itemId);
      const issuedQty = issued.reduce((sum, m) => sum.plus(new Decimal(m.qty)), new Decimal(0));
      const issuedValueOf = issued.reduce((sum, m) => sum.plus(new Decimal(m.valueAmount ?? "0")), new Decimal(0));
      const unitCost = issuedQty.greaterThan(0) ? round6(issuedValueOf.div(issuedQty)) : new Decimal(0);
      const value = round4(unitCost.times(new Decimal(leg.qty)));
      if (value.lessThanOrEqualTo(0)) {
        throw new TollingInputInvalidError(`the returned material ${leg.itemId} values to zero — nothing to post`);
      }
      materialLegValues.push({ itemId: leg.itemId, qty: leg.qty, value, unitCost });
    }
    const yieldLegValues: { itemId: string; qty: string; value: Decimal }[] = [];
    for (const leg of input.yieldLoss) {
      if (!QTY_RE.test(leg.qty) || new Decimal(leg.qty).lessThanOrEqualTo(0)) {
        throw new TollingInputInvalidError(`yield loss qty must be positive (≤ 6dp): ${leg.qty}`);
      }
      if (!MONEY_RE.test(leg.value) || new Decimal(leg.value).lessThanOrEqualTo(0)) {
        throw new TollingInputInvalidError(`yield loss value must be a positive decimal (≤ 4dp): ${leg.value}`);
      }
      yieldLegValues.push({ itemId: leg.itemId, qty: leg.qty, value: round4(new Decimal(leg.value)) });
    }
    const nonFinishedValue = [...materialLegValues, ...yieldLegValues].reduce(
      (sum, leg) => sum.plus(leg.value),
      new Decimal(0),
    );

    // ---- the finished legs: proportional materials share + fee accrual.
    const journalLines: JournalLineSpec[] = [];
    const legs: {
      kind: "RETURN_FINISHED" | "RETURN_MATERIAL" | "YIELD_LOSS";
      itemId: string;
      qty: string;
      value: Decimal;
    }[] = [];
    for (const leg of input.finished) {
      if (!QTY_RE.test(leg.qty) || new Decimal(leg.qty).lessThanOrEqualTo(0)) {
        throw new TollingInputInvalidError(`finished qty must be a positive decimal (≤ 6dp): ${leg.qty}`);
      }
      const qty = new Decimal(leg.qty);
      const totalFinished = alreadyFinished.plus(qty);
      if (totalFinished.greaterThan(planned)) {
        throw new TollingInputInvalidError(
          `the cumulative finished return (${totalFinished.toFixed(6)}) would exceed the planned quantity (${order.plannedQty})`,
        );
      }
      // The materials share: V × q / planned (4dp) — the FULL-return leg
      // (totalFinished == planned) takes the exact residual (the balance
      // minus this call's other legs) so the ledger closes to zero.
      const materialsShare = totalFinished.equals(planned)
        ? remainingBalance.minus(nonFinishedValue)
        : round4(issuedValue.times(qty).div(planned));
      const fee = order.conversionFee === null ? new Decimal(0) : new Decimal(order.conversionFee);
      const feeShare = fee.greaterThan(0) ? round4(fee.times(qty).div(planned)) : new Decimal(0);
      const fgValue = materialsShare.plus(feeShare);
      if (fgValue.lessThanOrEqualTo(0)) {
        throw new TollingInputInvalidError(`the finished return values to zero — nothing to post`);
      }
      const unitCost = round6(fgValue.div(qty));
      const reconstitution = round4(unitCost.times(qty));
      if (!reconstitution.equals(fgValue)) {
        throw new TollingInputInvalidError(
          `the finished unit cost cannot represent the value at 6dp (${fgValue.toFixed(4)} / ${qty.toFixed(6)}) — split the return`,
        );
      }
      const item = await store.findItemPlanning(order.itemId);
      const batchNo = item?.trackBatch ? (leg.batchNo ?? order.tollingNo) : null;
      const receiptPlan: ReceiptPlan = await planReceipt({
        itemId: order.itemId,
        warehouseId: order.warehouseId,
        qty: qty.toFixed(6),
        unitCost: unitCost.toFixed(6),
        movedAt: returnedAt,
        moveKind: "receipt",
        sourceType: "contract_mfg",
        sourceId: id,
        batchNo,
        batchExpiry: null,
        memo: `Tolling ${order.tollingNo ?? id} — finished goods from processor`,
        memoAr: `تصنيع تعاقدي ${order.tollingNo ?? id} — استلام إنتاج تام من المعالج`,
      });
      journalLines.push(
        {
          accountId: await resolveInventoryAccount(order.warehouseId),
          direction: "DEBIT",
          amount: fgValue.toFixed(4),
          memo: {
            en: `Tolling ${order.tollingNo ?? id} — finished goods back at ${unitCost.toFixed(6)}/unit`,
            ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — إنتاج تام من المعالج بسعر ${unitCost.toFixed(6)}/وحدة`,
          },
        },
        {
          purpose: "TOLLING_MATERIALS",
          direction: "CREDIT",
          amount: materialsShare.toFixed(4),
          memo: {
            en: `Tolling ${order.tollingNo ?? id} — materials share of the returned goods`,
            ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — حصة المواد من البضاعة المردودة`,
          },
        },
      );
      if (feeShare.greaterThan(0)) {
        journalLines.push({
          purpose: "TOLLING_CONVERSION_PAYABLE",
          direction: "CREDIT",
          amount: feeShare.toFixed(4),
          memo: {
            en: `Tolling ${order.tollingNo ?? id} — conversion fee accrual`,
            ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — استحقاق أجر التحويل`,
          },
        });
      }
      legs.push({ kind: "RETURN_FINISHED", itemId: order.itemId, qty: qty.toFixed(6), value: materialsShare });
      // The receipt applies after the journal posts (below) — the plan is
      // held and applied once, with its journal id.
      (legs[legs.length - 1] as { receiptPlan?: ReceiptPlan }).receiptPlan = receiptPlan;
    }

    // ---- the returned-material legs: back to stock at the issue unit
    // cost (the pass-1 values — receipts + journal lines now).
    for (const leg of materialLegValues) {
      const receiptPlan: ReceiptPlan = await planReceipt({
        itemId: leg.itemId,
        warehouseId: order.warehouseId,
        qty: leg.qty,
        unitCost: leg.unitCost.toFixed(6),
        movedAt: returnedAt,
        moveKind: "receipt",
        sourceType: "contract_mfg",
        sourceId: id,
        batchNo: null,
        batchExpiry: null,
        memo: `Tolling ${order.tollingNo ?? id} — unused materials back`,
        memoAr: `تصنيع تعاقدي ${order.tollingNo ?? id} — رد مواد غير مستخدمة`,
      });
      journalLines.push(
        {
          accountId: await resolveInventoryAccount(order.warehouseId),
          direction: "DEBIT",
          amount: leg.value.toFixed(4),
          memo: {
            en: `Tolling ${order.tollingNo ?? id} — unused materials back to store`,
            ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — رد مواد غير مستخدمة للمخزن`,
          },
        },
        {
          purpose: "TOLLING_MATERIALS",
          direction: "CREDIT",
          amount: leg.value.toFixed(4),
          memo: {
            en: `Tolling ${order.tollingNo ?? id} — materials share closed`,
            ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — إقفال حصة المواد`,
          },
        },
      );
      legs.push({ kind: "RETURN_MATERIAL", itemId: leg.itemId, qty: leg.qty, value: leg.value });
      (legs[legs.length - 1] as { receiptPlan?: ReceiptPlan }).receiptPlan = receiptPlan;
    }

    // ---- the explicit yield-loss legs (never a silent scrap).
    for (const leg of yieldLegValues) {
      journalLines.push(
        {
          purpose: "TOLLING_YIELD_LOSS",
          direction: "DEBIT",
          amount: leg.value.toFixed(4),
          memo: {
            en: `Tolling ${order.tollingNo ?? id} — explicit yield loss`,
            ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — هدر صريح`,
          },
        },
        {
          purpose: "TOLLING_MATERIALS",
          direction: "CREDIT",
          amount: leg.value.toFixed(4),
          memo: {
            en: `Tolling ${order.tollingNo ?? id} — yield loss settlement`,
            ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — تسوية الهدر`,
          },
        },
      );
      legs.push({ kind: "YIELD_LOSS", itemId: leg.itemId, qty: leg.qty, value: leg.value });
    }

    // The over-settlement guard: the legs may never exceed the balance.
    const legsTotal = legs.reduce((sum, leg) => sum.plus(leg.value), new Decimal(0));
    if (legsTotal.greaterThan(remainingBalance)) {
      throw new TollingStateError(
        `the return legs (${legsTotal.toFixed(4)}) exceed the stock-at-processor balance (${remainingBalance.toFixed(4)})`,
        { legsTotal: legsTotal.toFixed(4), remainingBalance: remainingBalance.toFixed(4) },
      );
    }

    const spec: JournalSpec = {
      source: { docType: "contract_mfg_order", docId: id, operation: "return" },
      entryDate: returnedAt,
      description: {
        en: `Tolling ${order.tollingNo ?? id} — return from processor`,
        ar: `تصنيع تعاقدي ${order.tollingNo ?? id} — رد من المعالج`,
      },
      currency: await ownTenantBaseCurrency(),
      lines: journalLines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });
    for (const leg of legs) {
      const receiptPlan = (leg as { receiptPlan?: ReceiptPlan }).receiptPlan;
      if (receiptPlan !== undefined) {
        await applyReceipt(receiptPlan, posted.journalEntryId);
      }
      await store.insertContractMfgMove({
        orderId: id,
        moveKind: leg.kind,
        itemId: leg.itemId,
        qty: leg.qty,
        unitCost: null,
        valueAmount: leg.value.toFixed(4),
        batchId: null,
        stockMoveId: null,
        journalId: posted.journalEntryId,
        note: input.note ?? null,
        actorId: input.actorId,
      });
    }
    await store.patchContractMfgOrder({ id, status: "RETURNED", returnedAt: true });
    await this.audit.record({
      action: "manufacturing.tolling.returned",
      entityType: "contract_mfg_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        finished: input.finished.length,
        materials: input.returnedMaterials.length,
        yieldLoss: input.yieldLoss.length,
        legsValue: legsTotal.toFixed(4),
        journalEntryId: posted.journalEntryId,
      },
    });
    return { order: await this.find(id), moves: await store.listContractMfgMoves(id) };
  }

  // -- settle (RETURNED → SETTLED: the G-48 zero-balance gate) --------------------------

  async settle(id: string, actorId: string | null): Promise<store.ContractMfgOrderRow> {
    const order = await this.find(id);
    if (order.status !== "RETURNED") {
      throw new TollingStateError(
        `tolling order ${order.tollingNo ?? id} is ${order.status} — only RETURNED orders settle`,
      );
    }
    const ledger = await store.sumContractMfgValues(id);
    const balance = new Decimal(ledger.ISSUE_TO_PROCESSOR)
      .minus(new Decimal(ledger.RETURN_FINISHED))
      .minus(new Decimal(ledger.RETURN_MATERIAL))
      .minus(new Decimal(ledger.YIELD_LOSS));
    if (!balance.equals(0)) {
      throw new TollingStateError(
        `tolling order ${order.tollingNo ?? id} cannot settle — the stock-at-processor balance is ${balance.toFixed(4)} (post the residual as an explicit yield loss or a returned material)`,
        { residual: balance.toFixed(4) },
      );
    }
    await store.patchContractMfgOrder({ id, status: "SETTLED", settledAt: true });
    await this.audit.record({
      action: "manufacturing.tolling.settled",
      entityType: "contract_mfg_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { tollingNo: order.tollingNo, balance: "0.0000" },
    });
    return this.find(id);
  }

  // -- cancel (DRAFT only — issued material must come back first) -----------------------

  async cancel(id: string, reason: string, actorId: string | null): Promise<store.ContractMfgOrderRow> {
    const order = await this.find(id);
    const trimmed = reason.trim();
    if (trimmed === "" || trimmed.length > 500) {
      throw new TollingInputInvalidError("a cancel reason of 1..500 chars is required");
    }
    if (order.status !== "DRAFT") {
      throw new TollingStateError(
        `tolling order ${order.tollingNo ?? id} is ${order.status} — only DRAFT orders cancel (issued material must return and settle first)`,
      );
    }
    await store.patchContractMfgOrder({ id, status: "CANCELLED", cancelledAt: true, cancelReason: trimmed });
    await this.audit.record({
      action: "manufacturing.tolling.cancelled",
      entityType: "contract_mfg_order",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason: trimmed },
    });
    return this.find(id);
  }

  /** The Σ finished-return qty so far (the proportional-share basis). */
  private async finishedQtySoFar(orderId: string): Promise<Decimal> {
    const moves = await store.listContractMfgMoves(orderId);
    return moves
      .filter((m) => m.moveKind === "RETURN_FINISHED")
      .reduce((sum, m) => sum.plus(new Decimal(m.qty)), new Decimal(0));
  }
}
