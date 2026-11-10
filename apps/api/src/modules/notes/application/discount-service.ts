import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { compareExact } from "../../accounting/application/decimal-strings";
import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";
import { PostingService } from "../../accounting/application/posting-service";
import { AuditService } from "../../audit/api/audit";
import {
  findCashAccountById,
  insertCashMovement,
} from "../../treasury/infrastructure/treasury.store";
import { effectiveNoteRate, tenantBaseCurrency } from "./note-allocations";
import { invalidatePdcCalendar } from "./pdc-calendar-queries";
import { assertTransition } from "./custody-machine";
import {
  findNoteById,
  insertNoteEvent,
  updateNoteStatus,
} from "../infrastructure/notes.store";
import {
  NoteAccountCurrencyMismatchError,
  NoteAlreadyResolvedError,
  NoteCashAccountNotFoundError,
  NoteDiscountCurrencyUnsupportedError,
  NoteFeeInvalidError,
  NoteNotFoundError,
} from "../domain/notes-errors";

/**
 * PHASE-027 T6 — discounting at the bank: `DR CASH (proceeds) · DR
 * NOTES_DISCOUNT_EXPENSE (fee) · CR NOTES_RECEIVABLE (amount)` — the fee is
 * EXPLICIT, never netted silently (INV-024: zero note balance after). The
 * proceeds land through the treasury movement API (INV-019 exact).
 *
 * Base-currency notes only in this phase (typed
 * NOTE_DISCOUNT_CURRENCY_UNSUPPORTED for foreign notes — the phase pins no
 * FX semantics for discounting; collect or return instead. Honest deferral,
 * documented in JOURNAL_RULES §7 + the TABLES spec).
 */
@Injectable()
export class DiscountService {
  constructor(
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async discount(input: {
    noteId: string;
    cashAccountId: string;
    fee: string;
    eventDate: string;
    memo?: string | null;
    memoAr?: string | null;
    actorId: string | null;
  }): Promise<{ journalEntryId: string; proceeds: string; fee: string }> {
    const note = await findNoteById(input.noteId);
    if (note === undefined) {
      throw new NoteNotFoundError(input.noteId);
    }
    if (note.status === "DISCOUNTED") {
      throw new NoteAlreadyResolvedError({ noteId: note.id, eventKind: "DISCOUNT", status: note.status });
    }
    assertTransition({ noteId: note.id, direction: note.direction, eventKind: "DISCOUNT", from: note.status });
    const base = await tenantBaseCurrency();
    if (note.currency !== base) {
      throw new NoteDiscountCurrencyUnsupportedError({ noteId: note.id, currency: note.currency, base });
    }
    const account = await findCashAccountById(input.cashAccountId);
    if (account === undefined || account.status !== "ACTIVE") {
      throw new NoteCashAccountNotFoundError(input.cashAccountId);
    }
    if (account.currencyCode !== note.currency) {
      throw new NoteAccountCurrencyMismatchError({
        noteId: note.id,
        noteCurrency: note.currency,
        accountCurrency: account.currencyCode,
      });
    }
    if (compareExact(input.fee, "0.0000") < 0 || compareExact(input.fee, note.amount) > 0) {
      throw new NoteFeeInvalidError({ noteId: note.id, fee: input.fee, amount: note.amount });
    }
    const r0 = effectiveNoteRate(note, base);
    const noteBase = moneyBase(note.amount, r0);
    const proceeds = baseSub(noteBase, input.fee);
    if (compareExact(proceeds, "0.0000") < 0) {
      throw new NoteFeeInvalidError({ noteId: note.id, fee: input.fee, amount: note.amount });
    }

    const lines: JournalLineSpec[] = [
      {
        accountId: account.accountId,
        direction: "DEBIT",
        amount: proceeds,
        memo: {
          en: `Discount proceeds of note ${note.number ?? note.id}`,
          ar: `متصولات خصم الورقة ${note.number ?? note.id}`,
        },
      },
    ];
    if (compareExact(input.fee, "0.0000") !== 0) {
      lines.push({
        purpose: "NOTES_DISCOUNT_EXPENSE",
        direction: "DEBIT",
        amount: input.fee,
        memo: {
          en: `Discount fee — explicit, never netted (INV-024)`,
          ar: `رسوم الخصم — صريحة ولا تُصاف أبدًا (INV-024)`,
        },
      });
    }
    lines.push({
      purpose: "NOTES_RECEIVABLE",
      direction: "CREDIT",
      amount: noteBase,
      memo: {
        en: `Note ${note.number ?? note.id} derecognized on discount`,
        ar: `إطفاء الورقة ${note.number ?? note.id} عند الخصم`,
      },
    });

    const spec: JournalSpec = {
      source: { docType: "note", docId: note.id, operation: "discount" },
      entryDate: input.eventDate,
      description: {
        en: `Note discounted ${note.number ?? note.id} at the bank`,
        ar: `خصم الورقة ${note.number ?? note.id} لدى البنك`,
      },
      currency: base,
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });

    await insertCashMovement({
      cashAccountId: account.id,
      direction: "IN",
      amount: proceeds,
      currencyCode: note.currency,
      exchangeRate: "1",
      baseAmount: proceeds,
      sourceType: "note",
      sourceId: note.id,
      valueDate: input.eventDate,
      memo: input.memo ?? null,
      memoAr: input.memoAr ?? null,
    });

    const updated = (await updateNoteStatus(note.id, "DISCOUNTED")) ?? note;
    void updated;
    await insertNoteEvent({
      noteId: note.id,
      eventKind: "DISCOUNT",
      eventDate: input.eventDate,
      refs: {
        journalEntryId: posted.journalEntryId,
        entryNo: posted.entryNo,
        cashAccountId: account.id,
        proceeds,
        fee: input.fee,
      },
      journalEntryId: posted.journalEntryId,
      memo: input.memo ?? null,
      memoAr: input.memoAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "notes.note_discounted",
      entityType: "note",
      entityId: note.id,
      actorId: input.actorId ?? undefined,
      before: { status: note.status },
      after: {
        status: "DISCOUNTED",
        journalEntryId: posted.journalEntryId,
        entryNo: posted.entryNo,
        proceeds,
        fee: input.fee,
      },
    });
    invalidatePdcCalendar();
    return { journalEntryId: posted.journalEntryId, proceeds, fee: input.fee };
  }
}

function moneyBase(amount: string, rate: string): string {
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4).toFixed(4);
}

function baseSub(a: string, b: string): string {
  return new Decimal(a).minus(new Decimal(b)).toDecimalPlaces(4).toFixed(4);
}
