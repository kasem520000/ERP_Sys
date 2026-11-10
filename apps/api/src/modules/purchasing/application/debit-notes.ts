import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { SelfApprovalBlockedError } from "../../accounting/domain/accounting-errors";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { TaxResolverService } from "../../tax/application/tax-resolver-service";
import { recordDocumentTaxSummary } from "../../tax/application/posting-adapter";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/purchasing.store";
import {
  DebitNoteNotFoundError,
  DebitNoteRefInvalidError,
  EmptyDocumentError,
  PurchasingDocumentStateError,
} from "../domain/purchasing-errors";
import { requireSupplier } from "./orders";
import { resolveInputTaxLines, type PurchasingTaxLine } from "./tax-lines";

/**
 * Debit-note service (PHASE-011 T7; golden G-09; INV-003/BR-031): AP
 * corrections mirroring supplier invoices — always NEW documents
 * referencing the original invoice (ref_invoice_id), never edits:
 *
 *   DR AP_CONTROL ΔN×(1+t) (partner — AP closes by the gross)
 *   CR INVENTORY/expense ΔN
 *   CR VAT_RECOVERABLE ΔN×t (the recovered input VAT returns; VAT_EXPENSED
 *   mirrors for expensed lines; reverse-charge reverses the self-accounted
 *   pair).
 */

const DBN_FORMAT = { prefix: "DBN", format: "DBN-{YYYY}-{SEQ:6}", docType: "debit_note" };

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const PRICE_RE = /^\d+(\.\d{1,6})?$/;

export interface DebitNoteLineInput {
  invoiceLineId: string | null;
  itemId: string | null;
  accountId: string | null;
  description: string | null;
  qty: string;
  unitPrice: string;
  taxCodeId: string | null;
  vatRecoverable: boolean | null;
  note: string | null;
}

@Injectable()
export class DebitNoteService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
    private readonly resolver: TaxResolverService,
  ) {}

  async list(filter: { status?: string; supplierId?: string; limit: number }) {
    return store.listDebitNotes(filter);
  }

  async find(id: string) {
    const note = await store.findDebitNoteById(id);
    if (note === undefined) throw new DebitNoteNotFoundError(id);
    return note;
  }

  async findWithLines(id: string) {
    const note = await this.find(id);
    return { ...note, lines: await store.listDebitNoteLines(id) };
  }

  async create(input: {
    branchId: string;
    supplierId: string;
    refInvoiceId: string;
    noteDate: string;
    currencyCode: string;
    exchangeRate: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
    lines: readonly DebitNoteLineInput[];
  }): Promise<store.DebitNoteRow> {
    if (input.lines.length === 0) throw new EmptyDocumentError("debit note");
    await requireSupplier(input.supplierId);
    const base = await ownTenantBaseCurrency();
    if (input.currencyCode !== base && (input.exchangeRate === null || Number(input.exchangeRate) <= 0)) {
      throw new DebitNoteRefInvalidError(
        `debit note in ${input.currencyCode} requires a positive exchange rate (base ${base})`,
      );
    }

    // The referenced invoice must be POSTED and belong to this supplier.
    const refInvoice = await store.findSupplierInvoiceById(input.refInvoiceId);
    if (refInvoice === undefined) {
      throw new DebitNoteRefInvalidError(`supplier invoice ${input.refInvoiceId} does not exist in this tenant`);
    }
    if (refInvoice.status !== "POSTED") {
      throw new DebitNoteRefInvalidError(
        `supplier invoice ${input.refInvoiceId} is ${refInvoice.status} — debit notes reference POSTED invoices`,
      );
    }
    if (refInvoice.supplierId !== input.supplierId) {
      throw new DebitNoteRefInvalidError(
        `debit note supplier ${input.supplierId} does not match the referenced invoice's supplier`,
      );
    }

    // Referenced invoice lines must belong to the referenced invoice.
    const refLines = await store.listSupplierInvoiceLines(input.refInvoiceId);
    const refLineById = new Map(refLines.map((line) => [line.id, line]));

    const taxLines = await resolveInputTaxLines({
      resolver: this.resolver,
      documentDate: input.noteDate,
      currencyCode: input.currencyCode,
      lines: input.lines
        .filter((line) => line.taxCodeId !== null)
        .map((line) => ({
          taxCodeId: line.taxCodeId!,
          amount: new Decimal(line.qty).times(new Decimal(line.unitPrice))
            .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4),
          vatRecoverable: line.vatRecoverable,
        })),
    });
    const taxByIndex = new Map<number, PurchasingTaxLine>();
    let taxIdx = 0;
    input.lines.forEach((line, index) => {
      if (line.taxCodeId !== null) {
        taxByIndex.set(index, taxLines.lines[taxIdx]!);
        taxIdx += 1;
      }
    });

    let totalNet = new Decimal(0);
    let totalTax = new Decimal(0);
    type DnStoreLine = Parameters<typeof store.insertDebitNote>[0]["lines"][number];
    const storeLines: DnStoreLine[] = [];
    for (const [index, line] of input.lines.entries()) {
      if ((line.itemId === null) === (line.accountId === null)) {
        throw new DebitNoteRefInvalidError(
          "each debit-note line targets exactly one of item or account",
        );
      }
      if (!QTY_RE.test(line.qty) || new Decimal(line.qty).lte(0)) {
        throw new DebitNoteRefInvalidError(`debit-note line qty must be positive: ${line.qty}`);
      }
      if (!PRICE_RE.test(line.unitPrice) || new Decimal(line.unitPrice).lt(0)) {
        throw new DebitNoteRefInvalidError(`debit-note line unit price must be non-negative: ${line.unitPrice}`);
      }
      if (line.invoiceLineId !== null && !refLineById.has(line.invoiceLineId)) {
        throw new DebitNoteRefInvalidError(
          `invoice line ${line.invoiceLineId} is not on the referenced invoice ${input.refInvoiceId}`,
        );
      }
      const net = new Decimal(line.qty).times(new Decimal(line.unitPrice))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
      const tax = taxByIndex.get(index);
      const taxAmount = tax?.resolved.taxAmount ?? "0.0000";
      totalNet = totalNet.plus(new Decimal(net));
      totalTax = totalTax.plus(new Decimal(taxAmount));
      storeLines.push({
        invoiceLineId: line.invoiceLineId,
        itemId: line.itemId,
        accountId: line.accountId,
        description: line.description,
        qty: new Decimal(line.qty).toFixed(6),
        unitPrice: new Decimal(line.unitPrice).toFixed(6),
        taxCodeId: line.taxCodeId,
        vatRecoverable: tax?.recoverable ?? true,
        netAmount: net,
        taxAmount,
        taxSnapshot: (tax?.resolved.snapshot as unknown as Record<string, unknown>) ?? null,
        note: line.note,
      });
    }

    const totalNetS = totalNet.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const totalTaxS = totalTax.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const totalGross = totalNet.plus(totalTax).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);

    const created = await store.insertDebitNote({
      branchId: input.branchId,
      supplierId: input.supplierId,
      refInvoiceId: input.refInvoiceId,
      noteDate: input.noteDate,
      currencyCode: input.currencyCode,
      exchangeRate: input.exchangeRate,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
      totalNet: totalNetS,
      totalTax: totalTaxS,
      totalGross,
      taxSummary: { groups: taxLines.summaryGroups, totalTax: taxLines.totalTax },
      lines: storeLines,
    });
    await this.audit.record({
      action: "purchasing.debit_note_created",
      entityType: "debit_note",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { refInvoiceId: input.refInvoiceId, totalGross },
    });
    return created;
  }

  async submit(id: string, actorId: string | null) {
    const note = await this.find(id);
    if (note.status !== "DRAFT") {
      throw new PurchasingDocumentStateError(
        `debit note ${id} is ${note.status} — only DRAFT notes submit`,
      );
    }
    await store.updateDebitNoteStatus({ id, status: "PENDING_APPROVAL", actorId });
    return this.find(id);
  }

  async approve(id: string, actorId: string | null) {
    const note = await this.find(id);
    if (note.status !== "PENDING_APPROVAL" && note.status !== "DRAFT") {
      throw new PurchasingDocumentStateError(
        `debit note ${id} is ${note.status} — only DRAFT/PENDING_APPROVAL notes approve`,
      );
    }
    if (note.createdBy !== null && note.createdBy === actorId) {
      throw new SelfApprovalBlockedError();
    }
    await store.updateDebitNoteStatus({ id, status: "APPROVED", actorId });
    return this.find(id);
  }

  /** Post the G-09 mirror — idempotent (INV-013). */
  async post(id: string, actorId: string | null) {
    const note = await this.find(id);
    if (note.status === "POSTED") {
      return { note, journalEntryId: note.postedJournalId, noteNo: note.noteNo, idempotentReplay: true };
    }
    if (note.status !== "APPROVED") {
      throw new PurchasingDocumentStateError(
        `debit note ${id} is ${note.status} — approval precedes posting`,
      );
    }
    const lines = await store.listDebitNoteLines(id);
    const base = await ownTenantBaseCurrency();

    const taxResolution = await resolveInputTaxLines({
      resolver: this.resolver,
      documentDate: note.noteDate,
      currencyCode: note.currencyCode,
      lines: lines
        .filter((line) => line.taxCodeId !== null)
        .map((line) => ({
          taxCodeId: line.taxCodeId!,
          amount: line.netAmount,
          vatRecoverable: line.vatRecoverable,
        })),
    });
    const taxByLine = new Map<string, PurchasingTaxLine>();
    let taxIdx = 0;
    for (const line of lines) {
      if (line.taxCodeId !== null) {
        taxByLine.set(line.id, taxResolution.lines[taxIdx]!);
        taxIdx += 1;
      }
    }

    // G-09: DR AP_CONTROL gross (partner) · CR INVENTORY/expense net · CR VAT.
    const creditByAccount = new Map<string, string>();
    for (const line of lines) {
      let accountId: string;
      if (line.itemId !== null) {
        const { findActivePurpose } = await import("../../accounting/infrastructure/accounting.store");
        const mapping = await findActivePurpose("INVENTORY");
        accountId = mapping?.accountId ?? "";
      } else {
        accountId = line.accountId!;
      }
      creditByAccount.set(
        accountId,
        new Decimal(creditByAccount.get(accountId) ?? "0").plus(new Decimal(line.netAmount)).toFixed(4),
      );
    }

    const journalLines: JournalLineSpec[] = [];
    if (new Decimal(note.totalGross).gt(0)) {
      journalLines.push({
        purpose: "AP_CONTROL",
        direction: "DEBIT",
        amount: note.totalGross,
        partnerId: note.supplierId,
        memo: {
          en: `Debit note — invoice ${note.refInvoiceId}`,
          ar: `إشعار مدين — فاتورة ${note.refInvoiceId}`,
        },
      });
    }
    for (const [accountId, amount] of [...creditByAccount.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (amount === "0.0000") continue;
      journalLines.push({
        accountId,
        direction: "CREDIT",
        amount,
        memo: {
          en: `Debit note correction — invoice ${note.refInvoiceId}`,
          ar: `تسوية إشعار مدين — فاتورة ${note.refInvoiceId}`,
        },
      });
    }
    for (const tax of taxByLine.values()) {
      // The mirror: debits become credits (the input VAT returns).
      for (const vatLine of tax.vatLines) {
        journalLines.push({
          ...vatLine,
          direction: vatLine.direction === "DEBIT" ? "CREDIT" : "DEBIT",
        });
      }
    }

    const spec: JournalSpec = {
      source: { docType: "debit_note", docId: id, operation: "post" },
      entryDate: note.noteDate,
      description: {
        en: `Debit note on supplier invoice ${note.refInvoiceId}`,
        ar: `إشعار مدين على فاتورة مورد ${note.refInvoiceId}`,
      },
      currency: note.currencyCode,
      exchangeRate: note.currencyCode === base ? undefined : note.exchangeRate ?? undefined,
      lines: journalLines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });
    if (result.idempotentReplay) {
      const current = await this.find(id);
      return { note: current, journalEntryId: result.journalEntryId, noteNo: current.noteNo, idempotentReplay: true };
    }

    await recordDocumentTaxSummary({
      sourceType: "debit_note",
      sourceId: id,
      documentDate: note.noteDate,
      fiscalPeriodId: null,
      direction: "INPUT",
      lines: lines.filter((l) => l.taxCodeId !== null).map((l) => taxByLine.get(l.id)!.resolved),
    });

    const year = note.noteDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: DBN_FORMAT.docType,
      branchId: note.branchId,
      periodKey: year,
      format: DBN_FORMAT.format,
      prefix: DBN_FORMAT.prefix,
      year,
    });
    await store.updateDebitNoteStatus({
      id,
      status: "POSTED",
      actorId,
      noteNo: acquired.number,
      postingDate: note.noteDate,
      postedJournalId: result.journalEntryId,
    });
    await this.numbering.bind(DBN_FORMAT.docType, acquired.number, id);
    await this.audit.record({
      action: "purchasing.debit_note_posted",
      entityType: "debit_note",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { noteNo: acquired.number, journalEntryId: result.journalEntryId, totalGross: note.totalGross },
    });
    return {
      note: await this.find(id),
      journalEntryId: result.journalEntryId,
      noteNo: acquired.number,
      idempotentReplay: false,
    };
  }

  async cancel(id: string, reason: string, actorId: string | null) {
    const note = await this.find(id);
    if (note.status === "POSTED") {
      throw new PurchasingDocumentStateError(
        "posted debit notes are immutable — correction is a new document (INV-003/BR-031)",
      );
    }
    await store.updateDebitNoteStatus({ id, status: "CANCELLED", actorId, cancelReason: reason });
    await this.audit.record({
      action: "purchasing.debit_note_cancelled",
      entityType: "debit_note",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return this.find(id);
  }
}
