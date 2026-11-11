import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import { findCashAccountById, insertCashMovement } from "../../treasury/infrastructure/treasury.store";
import { InboxService } from "../../notifications/application/inbox-service";
import { readEffectiveSetting, ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as salesStore from "../infrastructure/sales.store";
import * as store from "../infrastructure/returns.store";
import {
  InvoiceLineInvalidError,
  RmaDispositionRequiredError,
  RmaNotFoundError,
  RmaQtyExceedsInvoicedError,
  RmaStateInvalidError,
  SalesDocumentStateError,
  SalesInvoiceNotFoundError,
  ScrapLossAccountUnmappedError,
} from "../domain/sales-errors";
import { salesLineNetAmount } from "./pricing";
import { CreditNoteService, type CreditNoteLineInput } from "./credit-notes";

/**
 * Returns service (PHASE-039 T-02/T-03/T-04; migration 0055; BR-064): the
 * customer RMA workflow — REQUESTED → APPROVED (SoD creator ≠ approver,
 * RMA-{YYYY}-{SEQ:6} reserved at approval) → RECEIVED → INSPECTED
 * (disposition RESTOCK|SCRAP|REFUND recorded) → terminal completion. The
 * three NEW journal goldens (numbering continues from G-34):
 *
 *   G-35 restock (JOURNAL_RULES): the completion credit note's OWN
 *     re-entry leg (source credit_note:reentry) — DR INVENTORY · CR COGS
 *     at the ORIGINAL issue cost snapshotted on the invoice line (W-3 —
 *     never a current-average recompute; batch preserved, the originally
 *     sold serial re-shelves, BR-017/BR-018). The RMA does NOT re-implement
 *     re-entry: it drives the credit note to POSTED and that machinery
 *     re-shelves (this file's only inventory interaction is reading the
 *     cost snapshot for G-36).
 *   G-36 scrap write-off (source return_authorization:scrap): the goods
 *     never re-shelve — the credit note is issued with returnToStock
 *     suppressed, and the cost leg posts directly: DR the tenant-mapped
 *     scrap-loss account (sales.scrap_loss_account; fail-closed when
 *     unmapped — zero partial writes, the RMA stays INSPECTED) · CR COGS
 *     at Σ qty × original issue cost.
 *   G-37 refund (source return_authorization:refund): the credit note
 *     re-enters stock exactly like G-35 (a refund still puts the goods
 *     back) and the cash-out leg pays the customer: DR AR_CONTROL (partner
 *     — reversing the CN's credit) · CR the refund cash account, with the
 *     treasury money movement recorded through the treasury store (the
 *     G-33 disbursement pattern: source return_authorization, base at
 *     rate 1).
 *
 * BR-064 exactly-once: completion only from INSPECTED; an already-terminal
 * RMA rejects typed (RmaStateInvalidError). Everything inside complete()
 * runs in ONE ambient tenant UoW — any throw (unmapped scrap account, CN
 * bound breach, posting rejection) rolls the whole completion back with
 * zero residue. INV-013 idempotency keys every journal through its source
 * {docType, docId, operation}; the terminal stamps carry the disposition
 * journal's entry_no.
 *
 * Credit-note path decision (documented): CreditNoteService.create only
 * PERSISTS the draft — the re-entry machinery lives in its post() step.
 * Completion therefore drives the full CN lifecycle in-transaction
 * (create → approve → post, the job-card warrantyCreditNote precedent):
 * the CN's creator is the RMA's requester (provenance) and the completing
 * actor approves it, so the CN's own SoD gate (creator ≠ approver) forces
 * completer ≠ requester — a deliberate two-person shape on the money leg.
 */

export const RMA_NUMBER_FORMAT = {
  prefix: "RMA",
  format: "RMA-{YYYY}-{SEQ:6}",
  docType: "return_authorization",
} as const;

/** Terminal status per disposition — the explicit map, never string+"ED". */
const TERMINAL_BY_DISPOSITION: Readonly<Record<string, string>> = Object.freeze({
  RESTOCK: "RESTOCKED",
  SCRAP: "SCRAPPED",
  REFUND: "REFUNDED",
});

const QTY_RE = /^\d+(\.\d{1,6})?$/;

/**
 * The availability fold (pure — unit-tested): invoiced − already credited −
 * open-RMA qty, floored at zero, canonical 6dp. Terminal RMAs are excluded
 * from the open fold because their credit note already counts as credited
 * (counting both would double-subtract).
 */
export function computeReturnAvailability(
  invoiced: string,
  credited: string,
  openRma: string,
): string {
  const available = new Decimal(invoiced)
    .minus(new Decimal(credited))
    .minus(new Decimal(openRma));
  if (available.lt(0)) return "0.000000";
  return available.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

@Injectable()
export class ReturnsService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
    private readonly creditNotes: CreditNoteService,
    private readonly inbox: InboxService,
  ) {}

  async list(filter: { status?: string; partnerId?: string; limit: number }) {
    return store.listRmas(filter);
  }

  async find(id: string) {
    const rma = await store.findRmaById(id);
    if (rma === undefined) throw new RmaNotFoundError(id);
    return rma;
  }

  async findWithLines(id: string) {
    const rma = await this.find(id);
    return { ...rma, lines: await store.listRmaLines(id) };
  }

  // -- REQUESTED ----------------------------------------------------------------------

  async create(input: {
    branchId: string;
    invoiceId: string;
    reasonCode: string;
    reason: string | null;
    reasonAr: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    lines: readonly { invoiceLineId: string; qty: string; note?: string | null }[];
  }) {
    if (input.lines.length === 0) {
      throw new InvoiceLineInvalidError("an RMA must carry at least one return line");
    }
    const invoice = await salesStore.findSalesInvoiceById(input.invoiceId);
    if (invoice === undefined) throw new SalesInvoiceNotFoundError(input.invoiceId);
    if (invoice.status !== "POSTED") {
      throw new SalesDocumentStateError(
        `invoice ${input.invoiceId} is ${invoice.status} — RMAs reference POSTED invoices only`,
      );
    }

    const invoiceLines = await salesStore.listSalesInvoiceLines(invoice.id);
    const invoiceLineById = new Map(invoiceLines.map((line) => [line.id, line]));
    const credited = await store.creditedQtyByInvoiceLine(invoice.id);
    const openLines = await store.listOpenRmaLinesByInvoice(invoice.id);
    const openByLine = new Map<string, string>();
    for (const line of openLines) {
      openByLine.set(
        line.invoiceLineId,
        new Decimal(openByLine.get(line.invoiceLineId) ?? "0").plus(new Decimal(line.qty)).toFixed(6),
      );
    }

    let totalNet = new Decimal(0);
    const storeLines: Parameters<typeof store.insertRmaLines>[1][number][] = [];
    for (const line of input.lines) {
      const invoiceLine = invoiceLineById.get(line.invoiceLineId);
      if (invoiceLine === undefined) {
        throw new InvoiceLineInvalidError(
          `invoice line ${line.invoiceLineId} is not on invoice ${input.invoiceId}`,
        );
      }
      if (!QTY_RE.test(line.qty) || new Decimal(line.qty).lte(0)) {
        throw new InvoiceLineInvalidError(`return line qty must be positive (≤ 6dp): ${line.qty}`);
      }
      // The availability bound: invoiced − credited − open RMAs.
      const available = computeReturnAvailability(
        invoiceLine.qty,
        credited.get(line.invoiceLineId) ?? "0",
        openByLine.get(line.invoiceLineId) ?? "0",
      );
      if (new Decimal(line.qty).comparedTo(new Decimal(available)) > 0) {
        throw new RmaQtyExceedsInvoicedError({
          lineId: line.invoiceLineId,
          qty: line.qty,
          available,
        });
      }
      // Snapshot the invoice line's price terms (evidence — the 0055 shape).
      const netAmount = salesLineNetAmount(line.qty, invoiceLine.unitPrice, invoiceLine.discountAmount);
      totalNet = totalNet.plus(new Decimal(netAmount));
      storeLines.push({
        invoiceLineId: line.invoiceLineId,
        itemId: invoiceLine.itemId,
        qty: new Decimal(line.qty).toFixed(6),
        unitPrice: new Decimal(invoiceLine.unitPrice).toFixed(4),
        discountAmount: new Decimal(invoiceLine.discountAmount).toFixed(4),
        taxCodeId: invoiceLine.taxCodeId,
        netAmount,
        // Tax resolves at the completion credit note (the CN mirrors the
        // invoice's own resolution); the RMA totals carry the price snapshot.
        taxAmount: "0.0000",
        note: line.note ?? null,
      });
    }

    const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const id = await store.insertRma({
      branchId: input.branchId,
      partnerId: invoice.customerId,
      invoiceId: invoice.id,
      reasonCode: input.reasonCode,
      reason: input.reason,
      reasonAr: input.reasonAr,
      currencyCode: invoice.currencyCode,
      totalNet: totalNetS,
      totalTax: "0.0000",
      totalGross: totalNetS,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await store.insertRmaLines(id, storeLines);
    await this.audit.record({
      action: "sales.rma_created",
      entityType: "return_authorization",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { invoiceId: invoice.id, totalNet: totalNetS, lines: storeLines.length },
    });
    return this.findWithLines(id);
  }

  // -- APPROVED (SoD + the official number) ---------------------------------------------

  async approve(id: string, actorId: string | null) {
    const rma = await this.find(id);
    if (rma.status !== "REQUESTED") {
      throw new RmaStateInvalidError({ current: rma.status, attempted: "approve" });
    }
    if (rma.createdBy !== null && rma.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: RMA_NUMBER_FORMAT.docType,
      branchId: rma.branchId,
      periodKey: year,
      format: RMA_NUMBER_FORMAT.format,
      prefix: RMA_NUMBER_FORMAT.prefix,
      year,
    });
    await store.updateRma(id, {
      status: "APPROVED",
      rmaNo: acquired.number,
      approvedAt: new Date().toISOString(),
      approvedBy: actorId,
    });
    await this.numbering.bind(RMA_NUMBER_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "sales.rma_approved",
      entityType: "return_authorization",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { rmaNo: acquired.number },
    });
    return this.find(id);
  }

  // -- RECEIVED -------------------------------------------------------------------------

  async receive(id: string, actorId: string | null) {
    const rma = await this.find(id);
    if (rma.status !== "APPROVED") {
      throw new RmaStateInvalidError({ current: rma.status, attempted: "receive" });
    }
    await store.updateRma(id, {
      status: "RECEIVED",
      receivedAt: new Date().toISOString(),
      receivedBy: actorId,
    });
    await this.audit.record({
      action: "sales.rma_received",
      entityType: "return_authorization",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.find(id);
  }

  // -- INSPECTED (the disposition is recorded here, BR-064) ------------------------------

  async inspect(input: {
    rmaId: string;
    disposition: "RESTOCK" | "SCRAP" | "REFUND";
    inspectionNote: string | null;
    actorId: string | null;
  }) {
    const rma = await this.find(input.rmaId);
    if (rma.status !== "RECEIVED") {
      throw new RmaStateInvalidError({ current: rma.status, attempted: "inspect" });
    }
    await store.updateRma(input.rmaId, {
      status: "INSPECTED",
      disposition: input.disposition,
      inspectionNote: input.inspectionNote,
      inspectedAt: new Date().toISOString(),
      inspectedBy: input.actorId,
    });
    await this.audit.record({
      action: "sales.rma_inspected",
      entityType: "return_authorization",
      entityId: input.rmaId,
      actorId: input.actorId ?? undefined,
      after: { disposition: input.disposition },
    });
    return this.find(input.rmaId);
  }

  // -- terminal completion (BR-064 exactly-once) ------------------------------------------

  async complete(input: {
    rmaId: string;
    refundCashAccountId?: string | null;
    entryDate?: string;
    actorId: string | null;
  }) {
    const rma = await this.find(input.rmaId);
    if (TERMINAL_BY_DISPOSITION[rma.status] !== undefined || rma.status === "CANCELLED") {
      throw new RmaStateInvalidError({ current: rma.status, attempted: "complete" });
    }
    if (rma.status !== "INSPECTED") {
      throw new RmaStateInvalidError({ current: rma.status, attempted: "complete" });
    }
    if (rma.disposition === null) {
      throw new RmaDispositionRequiredError(input.rmaId);
    }
    const disposition = rma.disposition as "RESTOCK" | "SCRAP" | "REFUND";
    const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);

    // Fail-closed pre-flights BEFORE any ledger work, so the common
    // misconfigurations reject with zero residue: the scrap-loss mapping
    // (G-36) and the refund cash account (G-37).
    let scrapLossAccount: string | null = null;
    if (disposition === "SCRAP") {
      scrapLossAccount = await readEffectiveSetting<string | null>("sales.scrap_loss_account");
      if (scrapLossAccount === null || scrapLossAccount === undefined) {
        throw new ScrapLossAccountUnmappedError();
      }
    }
    let refundCash: Awaited<ReturnType<typeof findCashAccountById>> = undefined;
    if (disposition === "REFUND") {
      if (input.refundCashAccountId === undefined || input.refundCashAccountId === null) {
        throw new SalesDocumentStateError(
          `RMA ${input.rmaId} is dispositioned REFUND — completion requires refundCashAccountId (the G-37 cash-out leg)`,
        );
      }
      refundCash = await findCashAccountById(input.refundCashAccountId);
      if (refundCash === undefined) {
        throw new SalesDocumentStateError(
          `cash account ${input.refundCashAccountId} does not exist in this tenant`,
        );
      }
    }

    const lines = await store.listRmaLines(input.rmaId);
    if (lines.length === 0) {
      throw new InvoiceLineInvalidError(`RMA ${input.rmaId} carries no lines`);
    }
    const invoiceLines = await salesStore.listSalesInvoiceLines(rma.invoiceId);
    const invoiceLineById = new Map(invoiceLines.map((line) => [line.id, line]));

    // (1) The credit note — the CN's creator is the RMA's requester; the
    // completing actor approves + posts it (the CN's own SoD gate applies).
    // RESTOCK/REFUND keep the CN's re-entry machinery (G-35); SCRAP
    // suppresses re-entry (the goods never re-shelve — G-36 replaces the
    // cost leg). Non-stock lines never re-shelve in any disposition.
    const cnLines: CreditNoteLineInput[] = lines.map((line) => {
      const invoiceLine = invoiceLineById.get(line.invoiceLineId);
      const returnToStock =
        disposition !== "SCRAP" && (invoiceLine?.itemId ?? null) !== null;
      return {
        invoiceLineId: line.invoiceLineId,
        qty: line.qty,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxCodeId: line.taxCodeId,
        returnToStock,
        batchId: null,
        serialIds: null,
        description: invoiceLine?.description ?? null,
        descriptionAr: invoiceLine?.descriptionAr ?? null,
        note: `RMA ${rma.rmaNo ?? rma.id} — ${disposition}`,
      };
    });
    const note = await this.creditNotes.create({
      branchId: rma.branchId,
      salesRepId: null,
      invoiceId: rma.invoiceId,
      noteDate: entryDate,
      note: `RMA ${rma.rmaNo ?? rma.id} completion — ${disposition}`,
      noteAr: `إتمام مرتجع ${rma.rmaNo ?? rma.id}`,
      actorId: rma.createdBy,
      lines: cnLines,
    });
    await this.creditNotes.approve(note.id, input.actorId);
    const cnPosted = await this.creditNotes.post(note.id, input.actorId);

    // (2) The disposition leg — the terminal journal the RMA stamps.
    let postedJournalId = cnPosted.journalEntryId;
    let entryNo: string | null = null;
    if (disposition === "SCRAP") {
      // G-36: DR the mapped scrap-loss account · CR COGS at the original
      // issue cost (the invoice line's W-3 snapshot). Non-stock lines carry
      // no cost; a zero-value scrap skips the journal (the engine demands
      // positive amounts on every line).
      let scrapValue = new Decimal(0);
      for (const line of lines) {
        const invoiceLine = invoiceLineById.get(line.invoiceLineId);
        if (invoiceLine?.issueUnitCost === null || invoiceLine === undefined) continue;
        scrapValue = scrapValue.plus(
          new Decimal(line.qty).times(new Decimal(invoiceLine.issueUnitCost)),
        );
      }
      const scrapAmount = scrapValue.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      if (new Decimal(scrapAmount).gt(0)) {
        const accountingStore = await import("../../accounting/infrastructure/accounting.store");
        const cogsMapping = await accountingStore.findActivePurpose("COGS");
        if (cogsMapping === undefined) {
          const { purposeNotMapped } = await import(
            "../../accounting/domain/posting-engine/posting-errors"
          );
          throw purposeNotMapped({ purposeKey: "COGS" });
        }
        const scrapResult = await this.posting.post(
          {
            source: { docType: RMA_NUMBER_FORMAT.docType, docId: rma.id, operation: "scrap" },
            entryDate,
            description: {
              en: `RMA ${rma.rmaNo ?? rma.id} — scrapped return write-off (G-36)`,
              ar: `مرتجع ${rma.rmaNo ?? rma.id} — إتلاف (G-36)`,
            },
            currency: await ownTenantBaseCurrency(),
            lines: [
              {
                accountId: scrapLossAccount!,
                direction: "DEBIT",
                amount: scrapAmount,
                memo: {
                  en: `Scrap loss — RMA ${rma.rmaNo ?? rma.id}`,
                  ar: `خسارة إتلاف — مرتجع ${rma.rmaNo ?? rma.id}`,
                },
              },
              {
                purpose: "COGS",
                direction: "CREDIT",
                amount: scrapAmount,
                memo: {
                  en: `COGS release — RMA ${rma.rmaNo ?? rma.id}`,
                  ar: `تحرير تكلفة المبيعات — مرتجع ${rma.rmaNo ?? rma.id}`,
                },
              },
            ],
          },
          { postedBy: input.actorId },
        );
        postedJournalId = scrapResult.journalEntryId;
        entryNo = scrapResult.entryNo;
      }
    }
    if (disposition === "REFUND") {
      // G-37: DR AR_CONTROL (partner — reversing the CN's credit) · CR the
      // refund cash account, at the CN's gross; the treasury movement rides
      // the G-33 pattern (base at rate 1).
      const gross = cnPosted.note.totalGross;
      const base = await ownTenantBaseCurrency();
      const invoice = await salesStore.findSalesInvoiceById(rma.invoiceId);
      if (invoice === undefined) throw new SalesInvoiceNotFoundError(rma.invoiceId);
      const refundResult = await this.posting.post(
        {
          source: { docType: RMA_NUMBER_FORMAT.docType, docId: rma.id, operation: "refund" },
          entryDate,
          description: {
            en: `RMA ${rma.rmaNo ?? rma.id} — cash refund (G-37)`,
            ar: `مرتجع ${rma.rmaNo ?? rma.id} — استرداد نقدي (G-37)`,
          },
          currency: rma.currencyCode,
          exchangeRate:
            rma.currencyCode !== base ? (invoice.exchangeRate ?? undefined) : undefined,
          lines: [
            {
              purpose: "AR_CONTROL",
              direction: "DEBIT",
              amount: gross,
              partnerId: rma.partnerId,
              memo: {
                en: `Refund — RMA ${rma.rmaNo ?? rma.id}`,
                ar: `استرداد — مرتجع ${rma.rmaNo ?? rma.id}`,
              },
            },
            {
              accountId: refundCash!.accountId,
              direction: "CREDIT",
              amount: gross,
              memo: {
                en: `Cash refund — RMA ${rma.rmaNo ?? rma.id} (G-37)`,
                ar: `استرداد نقدي — مرتجع ${rma.rmaNo ?? rma.id} (G-37)`,
              },
            },
          ],
        },
        { postedBy: input.actorId },
      );
      postedJournalId = refundResult.journalEntryId;
      entryNo = refundResult.entryNo;
      await insertCashMovement({
        cashAccountId: refundCash!.id,
        direction: "OUT",
        amount: gross,
        currencyCode: base,
        exchangeRate: "1",
        baseAmount: gross,
        sourceType: RMA_NUMBER_FORMAT.docType,
        sourceId: rma.id,
        valueDate: entryDate,
        memo: `Customer refund — RMA ${rma.rmaNo ?? rma.id} (G-37)`,
        memoAr: `استرداد عميل — مرتجع ${rma.rmaNo ?? rma.id} (G-37)`,
      });
    }
    if (entryNo === null) {
      // RESTOCKED (or a cost-less SCRAP) stamps the CN's own entry number.
      const journalStore = await import("../../accounting/infrastructure/journal.store");
      const cnEntry = await journalStore.findEntryBySourceKey("credit_note", note.id, "post");
      entryNo = cnEntry?.entryNo ?? null;
    }

    // (3) The terminal stamps — the explicit disposition map.
    const terminal = TERMINAL_BY_DISPOSITION[disposition]!;
    await store.updateRma(rma.id, {
      status: terminal,
      completedAt: new Date().toISOString(),
      completedBy: input.actorId,
      creditNoteId: note.id,
      postedJournalId,
      entryNo,
      refundCashAccountId:
        disposition === "REFUND" ? (input.refundCashAccountId ?? null) : undefined,
    });
    await this.audit.record({
      action: "sales.rma_completed",
      entityType: "return_authorization",
      entityId: rma.id,
      actorId: input.actorId ?? undefined,
      after: {
        disposition,
        status: terminal,
        creditNoteId: note.id,
        journalEntryId: postedJournalId,
        entryNo,
        totalGross: cnPosted.note.totalGross,
      },
    });
    // The collections-facing notification (deduped once per RMA).
    await this.inbox
      .record({
        category: "collections",
        severity: "info",
        title: {
          en: `Return completed — ${rma.rmaNo ?? rma.id}`,
          ar: `اكتمل المرتجع — ${rma.rmaNo ?? rma.id}`,
        },
        body: {
          en: `RMA ${rma.rmaNo ?? rma.id} completed as ${terminal}; credit note ${cnPosted.noteNo ?? note.id} posted for ${cnPosted.note.totalGross} ${rma.currencyCode}.`,
          ar: `اكتمل المرتجع ${rma.rmaNo ?? rma.id} بحالة ${terminal}؛ تم ترحيل إشعار دائن ${cnPosted.noteNo ?? note.id} بمبلغ ${cnPosted.note.totalGross} ${rma.currencyCode}.`,
        },
        dedupeKey: `rma-completed:${rma.id}`,
      })
      .catch(() => undefined);
    return this.find(rma.id);
  }

  // -- CANCELLED ------------------------------------------------------------------------

  async cancel(id: string, reason: string, actorId: string | null) {
    const rma = await this.find(id);
    if (rma.status !== "REQUESTED" && rma.status !== "APPROVED") {
      throw new RmaStateInvalidError({ current: rma.status, attempted: "cancel" });
    }
    await store.updateRma(id, {
      status: "CANCELLED",
      cancelledAt: new Date().toISOString(),
      cancelledBy: actorId,
      cancelReason: reason,
    });
    await this.audit.record({
      action: "sales.rma_cancelled",
      entityType: "return_authorization",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }
}
