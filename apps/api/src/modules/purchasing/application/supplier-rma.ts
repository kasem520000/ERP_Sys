import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import { readEffectiveSetting, ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import {
  planIssue,
  applyIssue,
  resolveInventoryAccount,
  stagePendingOverlay,
  type IssuePlan,
} from "../../inventory/application/movement-core";
import * as poStore from "../infrastructure/purchasing.store";
import * as store from "../infrastructure/supplier-returns.store";
import {
  DebitNoteRefInvalidError,
  OrderLineInvalidError,
  PurchaseOrderNotFoundError,
} from "../domain/purchasing-errors";
import {
  SupplierReturnAccountUnmappedError,
  SupplierRmaNotFoundError,
  SupplierRmaQtyExceedsPurchasedError,
  SupplierRmaStateInvalidError,
} from "../../sales/domain/sales-errors";

/**
 * Supplier-returns service (PHASE-039 T-13; migration 0059; R-03): the
 * return-to-vendor mirror — REQUESTED → APPROVED (SoD creator ≠ approver,
 * SRTV-{YYYY}-{SEQ:6} reserved at approval) → SHIPPED → CREDITED, with
 * CANCELLED off REQUESTED/APPROVED. Two NEW ledger surfaces:
 *
 *   ship leg (source supplier_return_authorization:ship): the goods leave
 *     through the movement engine (planIssue/applyIssue — no-negative-stock
 *     applies) with ONE inventory journal DR the tenant-mapped
 *     purchase-returns account (purchasing.supplier_return_account;
 *     fail-closed when unmapped) · CR INVENTORY at issue cost. The
 *     stock_moves source CHECK was NOT widened for a new source — the
 *     issue rides the generic 'manual_issue' source with the reason marker
 *     SUPPLIER_RETURN and source_id = the SRMA (documented deviation, per
 *     the migration's no-widening note).
 *   G-38 credit (source supplier_return_authorization:credit):
 *     DR AP_CONTROL (partner, net) · CR the same purchase-returns account
 *     (net) — so at cost == price the two journals net the account to zero
 *     and any cost/value difference stays in the returns account (its
 *     documented purpose, the 0059 header's "cost/value difference" note).
 *
 * Debit-note decision (documented): DebitNoteService does NOT fit the
 * return shape — its create() requires a POSTED supplier-invoice reference
 * AND its post() emits the generic G-09 mirror (DR AP gross · CR
 * INVENTORY/expense · CR VAT), while a supplier return credits the mapped
 * returns account at net with no VAT legs. credit() therefore posts G-38
 * directly and creates the DN document through the debit-notes STORE
 * (insertDebitNote) stamped POSTED against the G-38 journal — the 0059
 * lifecycle CHECK requires debit_note_id at CREDITED, so the DN must exist
 * on the same transaction; it references the PO's supplier invoice (the
 * earliest POSTED one) because debit_notes.ref_invoice_id is NOT NULL.
 *
 * Everything runs in the caller's ambient tenant UoW — a failure anywhere
 * (unmapped account, insufficient stock, posting rejection) rolls the
 * whole step back with zero residue. INV-013 idempotency keys every
 * journal through its source {docType, docId, operation}.
 */

export const SUPPLIER_RMA_NUMBER_FORMAT = {
  prefix: "SRTV",
  format: "SRTV-{YYYY}-{SEQ:6}",
  docType: "supplier_return_authorization",
} as const;

const DBN_FORMAT = { prefix: "DBN", format: "DBN-{YYYY}-{SEQ:6}", docType: "debit_note" } as const;

const QTY_RE = /^\d+(\.\d{1,6})?$/;

/** PO statuses a return may reference (firm orders onward — never drafts). */
const PO_RETURNABLE_STATUSES = new Set(["APPROVED", "ISSUED", "CLOSED"]);

@Injectable()
export class SupplierReturnsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  async list(filter: { status?: string; supplierId?: string; limit: number }) {
    return store.listSupplierRmas(filter);
  }

  async find(id: string) {
    const srma = await store.findSupplierRmaById(id);
    if (srma === undefined) throw new SupplierRmaNotFoundError(id);
    return srma;
  }

  async findWithLines(id: string) {
    const srma = await this.find(id);
    return { ...srma, lines: await store.listSupplierRmaLines(id) };
  }

  // -- REQUESTED -----------------------------------------------------------------------

  async create(input: {
    branchId: string;
    purchaseOrderId: string;
    reasonCode: string;
    reason: string | null;
    reasonAr: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    lines: readonly { poLineId: string; qty: string; note?: string | null }[];
  }) {
    if (input.lines.length === 0) {
      throw new OrderLineInvalidError("a supplier RMA must carry at least one return line");
    }
    const po = await poStore.findPurchaseOrderById(input.purchaseOrderId);
    if (po === undefined) throw new PurchaseOrderNotFoundError(input.purchaseOrderId);
    if (!PO_RETURNABLE_STATUSES.has(po.status)) {
      throw new SupplierRmaStateInvalidError({ current: po.status, attempted: "create" });
    }

    const poLines = await poStore.listPurchaseOrderLines(po.id);
    const poLineById = new Map(poLines.map((line) => [line.id, line]));
    const openLines = await store.listOpenSupplierRmaLinesByPo(po.id);
    const openByLine = new Map<string, string>();
    for (const line of openLines) {
      openByLine.set(
        line.poLineId,
        new Decimal(openByLine.get(line.poLineId) ?? "0").plus(new Decimal(line.qty)).toFixed(6),
      );
    }

    let totalNet = new Decimal(0);
    const storeLines: Parameters<typeof store.insertSupplierRmaLines>[1][number][] = [];
    for (const line of input.lines) {
      const poLine = poLineById.get(line.poLineId);
      if (poLine === undefined) {
        throw new OrderLineInvalidError(
          `PO line ${line.poLineId} is not on purchase order ${input.purchaseOrderId}`,
        );
      }
      if (!QTY_RE.test(line.qty) || new Decimal(line.qty).lte(0)) {
        throw new OrderLineInvalidError(`return line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      // The bound: purchased − already-returned/open supplier RMAs (every
      // non-CANCELLED RMA claims its qty — there is no credited-qty twin on
      // PO lines, so CREDITED rows stay in the fold).
      const available = new Decimal(poLine.qty)
        .minus(new Decimal(openByLine.get(line.poLineId) ?? "0"))
        .toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
      const availableS = available.lt(0)
        ? "0.000000"
        : available.toFixed(6);
      if (new Decimal(line.qty).comparedTo(new Decimal(availableS)) > 0) {
        throw new SupplierRmaQtyExceedsPurchasedError({
          lineId: line.poLineId,
          qty: line.qty,
          available: availableS,
        });
      }
      // Snapshot the PO line's cost (evidence — the 0059 shape). No VAT
      // legs: G-38 credits the returns account at net.
      const netAmount = new Decimal(line.qty)
        .times(new Decimal(poLine.unitPrice))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        .toFixed(4);
      totalNet = totalNet.plus(new Decimal(netAmount));
      storeLines.push({
        poLineId: line.poLineId,
        itemId: poLine.itemId,
        qty: new Decimal(line.qty).toFixed(6),
        unitCost: new Decimal(poLine.unitPrice).toFixed(4),
        netAmount,
        note: line.note ?? null,
      });
    }

    const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const id = await store.insertSupplierRma({
      branchId: input.branchId,
      supplierId: po.supplierId,
      purchaseOrderId: po.id,
      reasonCode: input.reasonCode,
      reason: input.reason,
      reasonAr: input.reasonAr,
      currencyCode: po.currencyCode,
      totalNet: totalNetS,
      totalTax: "0.0000",
      totalGross: totalNetS,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await store.insertSupplierRmaLines(id, storeLines);
    await this.audit.record({
      action: "purchasing.supplier_rma_created",
      entityType: "supplier_return_authorization",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { purchaseOrderId: po.id, totalNet: totalNetS, lines: storeLines.length },
    });
    return this.findWithLines(id);
  }

  // -- APPROVED (SoD + the official number) ----------------------------------------------

  async approve(id: string, actorId: string | null) {
    const srma = await this.find(id);
    if (srma.status !== "REQUESTED") {
      throw new SupplierRmaStateInvalidError({ current: srma.status, attempted: "approve" });
    }
    if (srma.createdBy !== null && srma.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: SUPPLIER_RMA_NUMBER_FORMAT.docType,
      branchId: srma.branchId,
      periodKey: year,
      format: SUPPLIER_RMA_NUMBER_FORMAT.format,
      prefix: SUPPLIER_RMA_NUMBER_FORMAT.prefix,
      year,
    });
    await store.updateSupplierRma(id, {
      status: "APPROVED",
      srmaNo: acquired.number,
      approvedAt: new Date().toISOString(),
      approvedBy: actorId,
    });
    await this.numbering.bind(SUPPLIER_RMA_NUMBER_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.supplier_rma_approved",
      entityType: "supplier_return_authorization",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { srmaNo: acquired.number },
    });
    return this.find(id);
  }

  // -- SHIPPED (the inventory issue leg) ---------------------------------------------------

  async ship(input: { srmaId: string; warehouseId: string; entryDate?: string; actorId: string | null }) {
    const srma = await this.find(input.srmaId);
    if (srma.status !== "APPROVED") {
      throw new SupplierRmaStateInvalidError({ current: srma.status, attempted: "ship" });
    }
    const lines = await store.listSupplierRmaLines(input.srmaId);
    if (lines.length === 0) {
      throw new OrderLineInvalidError(`supplier RMA ${input.srmaId} carries no lines`);
    }
    // Fail-closed pre-flight: the returns account the ship journal debits.
    const returnAccount = await readEffectiveSetting<string | null>(
      "purchasing.supplier_return_account",
    );
    if (returnAccount === null || returnAccount === undefined) {
      throw new SupplierReturnAccountUnmappedError();
    }
    const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);

    // PLAN (no writes): one issue per stock line — the generic
    // 'manual_issue' source with the SUPPLIER_RETURN reason marker and
    // source_id = the SRMA (the CHECK was not widened for a new source).
    const plans: { line: store.SupplierRmaLineRow; plan: IssuePlan }[] = [];
    for (const line of lines) {
      if (line.itemId === null) continue;
      const plan = await planIssue({
        itemId: line.itemId,
        warehouseId: input.warehouseId,
        qty: line.qty,
        movedAt: entryDate,
        moveKind: "issue",
        sourceType: "manual_issue",
        sourceId: srma.id,
        reason: "SUPPLIER_RETURN",
        memo: `Supplier return ${srma.srmaNo ?? srma.id} — line ${line.lineNo}`,
        memoAr: `مرتجع مورد ${srma.srmaNo ?? srma.id} — سطر ${line.lineNo}`,
      });
      plans.push({ line, plan });
      stagePendingOverlay(plan); // later lines see the earlier pending issues
    }

    // ONE inventory journal for the whole shipment: DR the mapped returns
    // account · CR INVENTORY at the issue cost.
    let shipValue = new Decimal(0);
    for (const { plan } of plans) {
      shipValue = shipValue.plus(new Decimal(plan.valueAmount));
    }
    const shipAmount = shipValue.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    let journalEntryId: string | null = null;
    if (new Decimal(shipAmount).gt(0)) {
      const inventoryAccount = await resolveInventoryAccount(input.warehouseId);
      const result = await this.posting.post(
        {
          source: { docType: SUPPLIER_RMA_NUMBER_FORMAT.docType, docId: srma.id, operation: "ship" },
          entryDate,
          description: {
            en: `Supplier return ${srma.srmaNo ?? srma.id} — goods shipped back (RTV)`,
            ar: `مرتجع مورد ${srma.srmaNo ?? srma.id} — إعادة البضاعة للمورد`,
          },
          currency: await ownTenantBaseCurrency(),
          lines: [
            {
              accountId: returnAccount,
              direction: "DEBIT",
              amount: shipAmount,
              memo: {
                en: `Supplier return shipment — ${srma.srmaNo ?? srma.id}`,
                ar: `شحن مرتجع مورد — ${srma.srmaNo ?? srma.id}`,
              },
            },
            {
              accountId: inventoryAccount,
              direction: "CREDIT",
              amount: shipAmount,
              memo: {
                en: `Inventory out — supplier return ${srma.srmaNo ?? srma.id}`,
                ar: `إخراج مخزون — مرتجع مورد ${srma.srmaNo ?? srma.id}`,
              },
            },
          ],
        },
        { postedBy: input.actorId },
      );
      journalEntryId = result.journalEntryId;
    }
    for (const { plan } of plans) {
      await applyIssue(plan, journalEntryId);
    }
    await store.updateSupplierRma(srma.id, {
      status: "SHIPPED",
      shippedAt: new Date().toISOString(),
      shippedBy: input.actorId,
    });
    await this.audit.record({
      action: "purchasing.supplier_rma_shipped",
      entityType: "supplier_return_authorization",
      entityId: srma.id,
      actorId: input.actorId ?? undefined,
      after: {
        warehouseId: input.warehouseId,
        valueAmount: shipAmount,
        journalEntryId,
        reason: "SUPPLIER_RETURN",
      },
    });
    return this.find(srma.id);
  }

  // -- CREDITED (G-38 + the DN document) ---------------------------------------------------

  async credit(input: { srmaId: string; entryDate?: string; actorId: string | null }) {
    const srma = await this.find(input.srmaId);
    if (srma.status === "CREDITED" || srma.status === "CANCELLED") {
      throw new SupplierRmaStateInvalidError({ current: srma.status, attempted: "credit" });
    }
    if (srma.status !== "SHIPPED") {
      throw new SupplierRmaStateInvalidError({ current: srma.status, attempted: "credit" });
    }
    // Fail-closed pre-flights: the returns account (G-38's credit leg) and
    // the DN's invoice reference (debit_notes.ref_invoice_id is NOT NULL).
    const returnAccount = await readEffectiveSetting<string | null>(
      "purchasing.supplier_return_account",
    );
    if (returnAccount === null || returnAccount === undefined) {
      throw new SupplierReturnAccountUnmappedError();
    }
    const refInvoice = await store.findPoSupplierInvoice(srma.purchaseOrderId);
    if (refInvoice === undefined) {
      throw new DebitNoteRefInvalidError(
        `purchase order ${srma.purchaseOrderId} carries no supplier invoice — the return's debit note needs one to reference (post the supplier invoice first)`,
      );
    }
    const po = await poStore.findPurchaseOrderById(srma.purchaseOrderId);
    if (po === undefined) throw new PurchaseOrderNotFoundError(srma.purchaseOrderId);
    const lines = await store.listSupplierRmaLines(srma.id);
    if (lines.length === 0) {
      throw new OrderLineInvalidError(`supplier RMA ${srma.id} carries no lines`);
    }
    const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);
    const base = await ownTenantBaseCurrency();

    // (1) G-38: DR AP_CONTROL (partner, net) · CR the mapped returns
    // account (net) — no VAT legs on a return credit.
    const result = await this.posting.post(
      {
        source: { docType: SUPPLIER_RMA_NUMBER_FORMAT.docType, docId: srma.id, operation: "credit" },
        entryDate,
        description: {
          en: `Supplier return ${srma.srmaNo ?? srma.id} — AP debit note (G-38)`,
          ar: `مرتجع مورد ${srma.srmaNo ?? srma.id} — إشعار مدين (G-38)`,
        },
        currency: srma.currencyCode,
        exchangeRate: srma.currencyCode !== base ? (po.exchangeRate ?? undefined) : undefined,
        lines: [
          {
            purpose: "AP_CONTROL",
            direction: "DEBIT",
            amount: srma.totalNet,
            partnerId: srma.supplierId,
            memo: {
              en: `Supplier return credit — ${srma.srmaNo ?? srma.id}`,
              ar: `دائن مرتجع مورد — ${srma.srmaNo ?? srma.id}`,
            },
          },
          {
            accountId: returnAccount,
            direction: "CREDIT",
            amount: srma.totalNet,
            memo: {
              en: `Purchase returns — ${srma.srmaNo ?? srma.id} (G-38)`,
              ar: `مرتجعات مشتريات — ${srma.srmaNo ?? srma.id} (G-38)`,
            },
          },
        ],
      },
      { postedBy: input.actorId },
    );

    // (2) The DN document — created POSTED against the G-38 journal (the
    // 0059 CHECK demands debit_note_id at CREDITED; DebitNoteService's own
    // G-09 shape does not fit, see the header).
    const year = entryDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: DBN_FORMAT.docType,
      branchId: srma.branchId,
      periodKey: year,
      format: DBN_FORMAT.format,
      prefix: DBN_FORMAT.prefix,
      year,
    });
    const note = await poStore.insertDebitNote({
      branchId: srma.branchId,
      supplierId: srma.supplierId,
      refInvoiceId: refInvoice.id,
      noteDate: entryDate,
      currencyCode: srma.currencyCode,
      exchangeRate: srma.currencyCode !== base ? po.exchangeRate : null,
      note: `Supplier return ${srma.srmaNo ?? srma.id} — auto-generated at credit (G-38)`,
      noteAr: `مرتجع مورد ${srma.srmaNo ?? srma.id} — توليد تلقائي عند التسوية (G-38)`,
      actorId: input.actorId,
      totalNet: srma.totalNet,
      totalTax: "0.0000",
      totalGross: srma.totalNet,
      taxSummary: null,
      lines: lines.map((line) => ({
        invoiceLineId: null,
        itemId: line.itemId,
        accountId: null,
        description: `Supplier return ${srma.srmaNo ?? srma.id} — line ${line.lineNo}`,
        qty: line.qty,
        unitPrice: line.unitCost,
        taxCodeId: null,
        vatRecoverable: true,
        netAmount: line.netAmount,
        taxAmount: "0.0000",
        taxSnapshot: null,
        note: line.note,
      })),
    });
    await poStore.updateDebitNoteStatus({
      id: note.id,
      status: "POSTED",
      actorId: input.actorId,
      noteNo: acquired.number,
      postingDate: entryDate,
      postedJournalId: result.journalEntryId,
    });
    await this.numbering.bind(DBN_FORMAT.docType, acquired.number, note.id);

    // (3) The terminal stamps.
    await store.updateSupplierRma(srma.id, {
      status: "CREDITED",
      creditedAt: new Date().toISOString(),
      creditedBy: input.actorId,
      debitNoteId: note.id,
      postedJournalId: result.journalEntryId,
      entryNo: result.entryNo,
    });
    await this.audit.record({
      action: "purchasing.supplier_rma_credited",
      entityType: "supplier_return_authorization",
      entityId: srma.id,
      actorId: input.actorId ?? undefined,
      after: {
        debitNoteId: note.id,
        debitNoteNo: acquired.number,
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        totalNet: srma.totalNet,
        refInvoiceId: refInvoice.id,
      },
    });
    return this.find(srma.id);
  }

  // -- CANCELLED -----------------------------------------------------------------------------

  async cancel(id: string, reason: string, actorId: string | null) {
    const srma = await this.find(id);
    if (srma.status !== "REQUESTED" && srma.status !== "APPROVED") {
      throw new SupplierRmaStateInvalidError({ current: srma.status, attempted: "cancel" });
    }
    await store.updateSupplierRma(id, {
      status: "CANCELLED",
      cancelledAt: new Date().toISOString(),
      cancelledBy: actorId,
      cancelReason: reason,
    });
    await this.audit.record({
      action: "purchasing.supplier_rma_cancelled",
      entityType: "supplier_return_authorization",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }
}
