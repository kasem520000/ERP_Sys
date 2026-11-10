import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { PostingService } from "../../accounting/application/posting-service";
import { AuditService } from "../../audit/api/audit";
import {
  effectiveNoteRate,
  loadOpenItemForSource,
  postG27,
  requireNotePartner,
  tenantBaseCurrency,
  validateNoteAllocationsUnderLock,
  type NoteAllocationInput,
} from "./note-allocations";
import { invalidatePdcCalendar } from "./pdc-calendar-queries";
import {
  findSourceSupplierInvoice,
  insertNote,
  insertNoteAllocations,
  updateNoteStatus,
  type NoteRow,
} from "../infrastructure/notes.store";
import {
  NoteCurrencyMismatchError,
  NoteRateMismatchError,
  NoteSourceInvalidError,
} from "../domain/notes-errors";

/**
 * PHASE-027 T3 — issue to a supplier (G-27 first leg): issuing a note posts
 * `DR AP_CONTROL · CR NOTES_PAYABLE`, settling the supplier invoice's open
 * item via the same standard allocation machinery (INV-016 under the CC-02
 * lock; INV-009 partner line). The paid-at-maturity mirror is the COLLECT
 * action (collection-service). Same ambient-UoW atomicity as G-24.
 */
@Injectable()
export class IssueService {
  constructor(
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async issueNote(input: {
    partnerId: string;
    kind: "CHEQUE" | "PROMISSORY_NOTE";
    number?: string | null;
    issuingBank?: string | null;
    amount: string;
    currency: string;
    exchangeRate?: string | null;
    issueDate?: string | null;
    maturityDate: string;
    sourceInvoiceId?: string | null;
    allocations?: readonly NoteAllocationInput[] | null;
    note?: string | null;
    noteAr?: string | null;
    eventDate: string;
    actorId: string | null;
  }): Promise<NoteRow> {
    // The partner must exist in THIS tenant (A7/S-04): foreign/unknown ids
    // get the typed 404 before any write — the requireNotePartner seam,
    // wired with the receive path (P27-G fix).
    await requireNotePartner(input.partnerId);
    const base = await tenantBaseCurrency();
    const rate = input.currency === base ? "1" : (input.exchangeRate ?? "1");

    let allocations: NoteAllocationInput[];
    if (input.sourceInvoiceId != null) {
      const sourceType = "supplier_invoice" as const;
      const invoice = await findSourceSupplierInvoice(input.sourceInvoiceId);
      if (invoice === undefined) {
        throw new NoteSourceInvalidError({
          sourceType,
          sourceId: input.sourceInvoiceId,
          reason: "supplier invoice not found (foreign or unknown)",
        });
      }
      if (invoice.status !== "POSTED") {
        throw new NoteSourceInvalidError({
          sourceType,
          sourceId: input.sourceInvoiceId,
          reason: `supplier invoice is ${invoice.status} — only POSTED invoices carry settleable open items`,
        });
      }
      if (invoice.supplierId !== input.partnerId) {
        throw new NoteSourceInvalidError({
          sourceType,
          sourceId: input.sourceInvoiceId,
          reason: "supplier invoice belongs to a different partner",
        });
      }
      if (invoice.currencyCode !== input.currency) {
        throw new NoteCurrencyMismatchError({
          noteCurrency: input.currency,
          itemCurrency: invoice.currencyCode,
        });
      }
      const item = await loadOpenItemForSource({
        partnerId: input.partnerId,
        sourceType,
        sourceId: input.sourceInvoiceId,
      });
      if (input.currency !== base && compareExact(rate, item.exchangeRate) !== 0) {
        throw new NoteRateMismatchError({
          noteId: "(new note)",
          noteRate: rate,
          itemRate: item.exchangeRate,
        });
      }
      if (input.allocations != null && input.allocations.length > 0) {
        allocations = [...input.allocations];
      } else {
        const applied =
          compareExact(input.amount, item.outstanding) <= 0 ? input.amount : item.outstanding;
        allocations = compareExact(applied, "0.0000") > 0 ? [{ openItemId: item.id, amount: applied }] : [];
      }
    } else {
      allocations = [...(input.allocations ?? [])];
    }

    const { validated } = await validateNoteAllocationsUnderLock({
      noteId: "(new note)",
      noteAmount: input.amount,
      noteCurrency: input.currency,
      partnerId: input.partnerId,
      side: "AP",
      allocations,
    });

    let allocatedBase = "0.0000";
    for (const row of validated) {
      allocatedBase = addExact(allocatedBase, row.base);
    }
    const effectiveRate = effectiveNoteRate({ currency: input.currency, exchangeRate: rate }, base);
    const noteBaseAll = moneyBase(input.amount, effectiveRate);
    const onAccountBase = subExact(noteBaseAll, allocatedBase);

    const note = await insertNote({
      kind: input.kind,
      direction: "ISSUED",
      partnerId: input.partnerId,
      number: input.number ?? null,
      issuingBank: input.issuingBank ?? null,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: effectiveRate,
      issueDate: input.issueDate ?? null,
      maturityDate: input.maturityDate,
      sourceType: input.sourceInvoiceId != null ? "supplier_invoice" : null,
      sourceId: input.sourceInvoiceId ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    const posted = await postG27(this.posting, {
      note,
      base,
      rate: effectiveRate,
      allocatedBase,
      onAccountBase,
      entryDate: input.eventDate,
      postedBy: input.actorId,
    });
    if (validated.length > 0) {
      await insertNoteAllocations(
        note.id,
        validated.map((row) => ({ openItemId: row.openItemId, amount: row.amount })),
        input.actorId,
      );
    }
    const updated = await updateNoteStatus(note.id, "IN_CUSTODY", {
      journalEntryId: posted.journalEntryId,
    });
    await this.audit.record({
      action: "notes.note_issued",
      entityType: "note",
      entityId: note.id,
      actorId: input.actorId ?? undefined,
      after: {
        kind: note.kind,
        partnerId: note.partnerId,
        amount: note.amount,
        currency: note.currency,
        maturityDate: note.maturityDate,
        journalEntryId: posted.journalEntryId,
        entryNo: posted.entryNo,
        allocations: validated.map((row) => ({ openItemId: row.openItemId, amount: row.amount })),
        onAccountBase,
      },
    });
    invalidatePdcCalendar();
    return updated ?? note;
  }
}

/** amount × rate at canonical 4dp (exact decimal — no Math.*). */
function moneyBase(amount: string, rate: string): string {
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4).toFixed(4);
}
