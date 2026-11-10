import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { PostingService } from "../../accounting/application/posting-service";
import { AuditService } from "../../audit/api/audit";
import {
  effectiveNoteRate,
  loadOpenItemForSource,
  postG24,
  requireNotePartner,
  tenantBaseCurrency,
  validateNoteAllocationsUnderLock,
  type NoteAllocationInput,
} from "./note-allocations";
import { invalidatePdcCalendar } from "./pdc-calendar-queries";
import {
  findSourceSalesInvoice,
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
 * PHASE-027 T3 — receive into custody (G-24): recording a received note
 * against a customer invoice posts `DR NOTES_RECEIVABLE · CR AR_CONTROL`,
 * settling the open item via the standard allocation machinery (INV-016
 * bounds under the CC-02 lock; INV-009 partner line on the control side).
 * The unallocated remainder is an explicit on-account credit (BR-027 — a
 * note with no invoice settles nothing, landing entirely on-account).
 *
 * The whole operation (note row + G-24 entry + allocation rows) runs in the
 * caller's ambient UoW — one transaction, zero residue on failure. INV-013:
 * the create IS the post — one journal per note (source note/post).
 */
@Injectable()
export class ReceiveService {
  constructor(
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async receiveNote(input: {
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
    // get the typed 404 before any write — the composite FK alone would
    // surface an untyped 500 (the requireNotePartner seam, P27-G fix).
    await requireNotePartner(input.partnerId);
    const base = await tenantBaseCurrency();
    const rate = input.currency === base ? "1" : (input.exchangeRate ?? "1");

    // -- resolve the settle target (explicit allocations or the single-source default)
    let allocations: NoteAllocationInput[];
    if (input.sourceInvoiceId != null) {
      const sourceType = "sales_invoice" as const;
      const invoice = await findSourceSalesInvoice(input.sourceInvoiceId);
      if (invoice === undefined) {
        throw new NoteSourceInvalidError({
          sourceType,
          sourceId: input.sourceInvoiceId,
          reason: "invoice not found (foreign or unknown)",
        });
      }
      if (invoice.status !== "POSTED" || invoice.kind !== "CREDIT") {
        throw new NoteSourceInvalidError({
          sourceType,
          sourceId: input.sourceInvoiceId,
          reason: `invoice is ${invoice.status}/${invoice.kind} — only POSTED credit invoices carry settleable open items`,
        });
      }
      if (invoice.customerId !== input.partnerId) {
        throw new NoteSourceInvalidError({
          sourceType,
          sourceId: input.sourceInvoiceId,
          reason: "invoice belongs to a different partner",
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
      // INV-008: a foreign note settles at the item's ORIGINAL stored rate —
      // the note's stored rate must match; FX movement accrues to G-25.
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
        // The single-source default: allocate up to the invoice outstanding.
        const applied =
          compareExact(input.amount, item.outstanding) <= 0 ? input.amount : item.outstanding;
        allocations = compareExact(applied, "0.0000") > 0 ? [{ openItemId: item.id, amount: applied }] : [];
      }
    } else {
      // No source invoice: explicit allocations only (a note settles its own
      // partner's items; the default is on-account — BR-027).
      allocations = [...(input.allocations ?? [])];
    }

    // -- INV-016 under lock (document bound + per-item bound, typed treasury codes)
    const { validated } = await validateNoteAllocationsUnderLock({
      noteId: "(new note)",
      noteAmount: input.amount,
      noteCurrency: input.currency,
      partnerId: input.partnerId,
      side: "AR",
      allocations,
    });

    let allocatedBase = "0.0000";
    for (const row of validated) {
      allocatedBase = addExact(allocatedBase, row.base);
    }
    const effectiveRate = effectiveNoteRate({ currency: input.currency, exchangeRate: rate }, base);
    const noteBaseAll = moneyBase(input.amount, effectiveRate);
    const onAccountBase = subExact(noteBaseAll, allocatedBase);

    // -- the note row (IN_CUSTODY) + the G-24 entry + the allocation rows
    const note = await insertNote({
      kind: input.kind,
      direction: "RECEIVED",
      partnerId: input.partnerId,
      number: input.number ?? null,
      issuingBank: input.issuingBank ?? null,
      amount: input.amount,
      currency: input.currency,
      exchangeRate: effectiveRate,
      issueDate: input.issueDate ?? null,
      maturityDate: input.maturityDate,
      sourceType: input.sourceInvoiceId != null ? "sales_invoice" : null,
      sourceId: input.sourceInvoiceId ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    const posted = await postG24(this.posting, {
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
      action: "notes.note_received",
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
