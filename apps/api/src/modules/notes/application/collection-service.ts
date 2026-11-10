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
  insertCashMovement,
  findCashAccountById,
  type CashAccountRow,
} from "../../treasury/infrastructure/treasury.store";
import { effectiveNoteRate, tenantBaseCurrency } from "./note-allocations";
import { invalidatePdcCalendar } from "./pdc-calendar-queries";
import { assertTransition } from "./custody-machine";
import {
  findNoteById,
  insertNoteEvent,
  updateNoteStatus,
  type NoteEventRow,
  type NoteRow,
} from "../infrastructure/notes.store";
import {
  NoteAccountCurrencyMismatchError,
  NoteAccountRequiredError,
  NoteAlreadyResolvedError,
  NoteCashAccountNotFoundError,
  NoteNotFoundError,
} from "../domain/notes-errors";

/**
 * PHASE-027 T4 — the bank chain: DEPOSIT then COLLECT.
 *
 * DEPOSIT moves custody IN_CUSTODY → DEPOSITED with NO journal (BR-047 — the
 * note is at the bank, still our balance) and stores the treasury cash
 * account for the money legs.
 *
 * COLLECT posts G-25 (received): `DR CASH/BANK · CR NOTES_RECEIVABLE` —
 * cash settles at the collection-day rate r₁ while the note leg
 * derecognizes at the ORIGINAL stored rate r₀ (INV-008); the residual is an
 * explicit FX_GAIN/FX_LOSS line (the receipt G-06 mirror — never absorbed).
 * The treasury money movement runs through the treasury store API
 * (cash_movements is treasury-owned; notes never writes it) with INV-019
 * exact (movement base == the journal cash line's base).
 *
 * The ISSUED mirror is the paid-at-maturity leg of G-27: `DR NOTES_PAYABLE ·
 * CR CASH/BANK` (+ FX residual) with the movement OUT.
 */
@Injectable()
export class CollectionService {
  constructor(
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async deposit(input: {
    noteId: string;
    cashAccountId: string;
    eventDate: string;
    memo?: string | null;
    memoAr?: string | null;
    actorId: string | null;
  }): Promise<{ note: NoteRow; event: NoteEventRow }> {
    const note = await requireNote(input.noteId);
    const account = await requireAccount(input.cashAccountId, note);
    assertTransition({ noteId: note.id, direction: note.direction, eventKind: "DEPOSIT", from: note.status });
    const updated =
      (await updateNoteStatus(note.id, "DEPOSITED", { cashAccountId: account.id })) ?? note;
    const event = await insertNoteEvent({
      noteId: note.id,
      eventKind: "DEPOSIT",
      eventDate: input.eventDate,
      refs: { cashAccountId: account.id, bank: account.name },
      journalEntryId: null,
      memo: input.memo ?? null,
      memoAr: input.memoAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "notes.note_deposited",
      entityType: "note",
      entityId: note.id,
      actorId: input.actorId ?? undefined,
      before: { status: note.status },
      after: { status: "DEPOSITED", cashAccountId: account.id },
    });
    invalidatePdcCalendar();
    return { note: updated, event };
  }

  async collect(input: {
    noteId: string;
    cashAccountId?: string | null;
    exchangeRate?: string | null;
    eventDate: string;
    memo?: string | null;
    memoAr?: string | null;
    actorId: string | null;
  }): Promise<{ note: NoteRow; event: NoteEventRow; journalEntryId: string }> {
    const note = await requireNote(input.noteId);
    if (note.status === "COLLECTED") {
      throw new NoteAlreadyResolvedError({ noteId: note.id, eventKind: "COLLECT", status: note.status });
    }
    assertTransition({ noteId: note.id, direction: note.direction, eventKind: "COLLECT", from: note.status });
    const account = await requireAccount(input.cashAccountId ?? note.cashAccountId, note);
    const base = await tenantBaseCurrency();
    const r0 = effectiveNoteRate(note, base);
    const r1 = note.currency === base ? "1" : (input.exchangeRate ?? r0);

    const noteBase = moneyBase(note.amount, r0);
    const cashBase = moneyBase(note.amount, r1);

    const lines: JournalLineSpec[] = [];
    let fxGainLoss: { direction: "DEBIT" | "CREDIT"; amount: string; kind: "FX_GAIN" | "FX_LOSS" } | null = null;
    if (note.direction === "RECEIVED") {
      // G-25: DR CASH · CR NOTES_RECEIVABLE · [FX residual] (receipt mirror).
      const residual = baseSub(cashBase, noteBase);
      lines.push({
        accountId: account.accountId,
        direction: "DEBIT",
        amount: cashBase,
        memo: {
          en: `Collection of note ${note.number ?? note.id} at maturity (G-25)`,
          ar: `تحصيل ${note.number ?? note.id} عند الاستحقاق (G-25)`,
        },
      });
      lines.push({
        purpose: "NOTES_RECEIVABLE",
        direction: "CREDIT",
        amount: noteBase,
        memo: {
          en: "Note collected — derecognized at the original stored rate (INV-008)",
          ar: "تحصيل الورقة — إطفاء بالسعر الأصلي المخزن (INV-008)",
        },
      });
      if (compareExact(residual, "0.0000") !== 0) {
        fxGainLoss = residual.startsWith("-")
          ? { direction: "DEBIT", amount: residual.slice(1), kind: "FX_LOSS" }
          : { direction: "CREDIT", amount: residual, kind: "FX_GAIN" };
        lines.push({
          purpose: fxGainLoss.kind,
          direction: fxGainLoss.direction,
          amount: fxGainLoss.amount,
          memo: {
            en: "Realized FX difference at collection (G-06 pattern)",
            ar: "فرق عملة محقق عند التحصيل (نمط G-06)",
          },
        });
      }
    } else {
      // The G-27 paid-at-maturity mirror: DR NOTES_PAYABLE · CR CASH · [FX].
      const residual = baseSub(noteBase, cashBase);
      lines.push({
        purpose: "NOTES_PAYABLE",
        direction: "DEBIT",
        amount: noteBase,
        memo: {
          en: `Payment of issued note ${note.number ?? note.id} at maturity (G-27 paid leg)`,
          ar: `سداد ورقة الدفع ${note.number ?? note.id} عند الاستحقاق (G-27)`,
        },
      });
      lines.push({
        accountId: account.accountId,
        direction: "CREDIT",
        amount: cashBase,
        memo: {
          en: "Payment at maturity — cash settles at the payment-day rate (INV-019)",
          ar: "السداد عند الاستحقاق — النقد بسعر يوم السداد (INV-019)",
        },
      });
      if (compareExact(residual, "0.0000") !== 0) {
        // residual = noteBase − cashBase: NEGATIVE ⇒ cash OUT exceeds the
        // derecognized payable (the rate rose — pay MORE ⇒ realized FX LOSS
        // debit); POSITIVE ⇒ the liability extinguished with less cash (the
        // rate fell — pay LESS ⇒ realized FX GAIN credit). The P27-G golden
        // pay-at-3.74 mirror pinned the shape; the pre-fix mapping inverted
        // both legs and could never balance (ENTRY_NOT_BALANCED).
        fxGainLoss = residual.startsWith("-")
          ? { direction: "DEBIT", amount: residual.slice(1), kind: "FX_LOSS" }
          : { direction: "CREDIT", amount: residual, kind: "FX_GAIN" };
        lines.push({
          purpose: fxGainLoss.kind,
          direction: fxGainLoss.direction,
          amount: fxGainLoss.amount,
          memo: {
            en: "Realized FX difference at payment (G-06 pattern)",
            ar: "فرق عملة محقق عند السداد (نمط G-06)",
          },
        });
      }
    }

    const spec: JournalSpec = {
      source: { docType: "note", docId: note.id, operation: "collect" },
      entryDate: input.eventDate,
      description: {
        en: `Note collected ${note.number ?? note.id} (G-25)`,
        ar: `تحصيل الورقة ${note.number ?? note.id} (G-25)`,
      },
      currency: base,
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });

    // The treasury money movement (cash_movements is treasury-owned — the
    // store API; INV-019 exact by construction).
    await insertCashMovement({
      cashAccountId: account.id,
      direction: note.direction === "RECEIVED" ? "IN" : "OUT",
      amount: note.amount,
      currencyCode: note.currency,
      exchangeRate: r1,
      baseAmount: cashBase,
      sourceType: "note",
      sourceId: note.id,
      valueDate: input.eventDate,
      memo: input.memo ?? null,
      memoAr: input.memoAr ?? null,
    });

    const updated = (await updateNoteStatus(note.id, "COLLECTED")) ?? note;
    const event = await insertNoteEvent({
      noteId: note.id,
      eventKind: "COLLECT",
      eventDate: input.eventDate,
      refs: {
        cashAccountId: account.id,
        journalEntryId: posted.journalEntryId,
        entryNo: posted.entryNo,
        collectionRate: r1,
        fxGainLoss: fxGainLoss === null ? null : { ...fxGainLoss },
      },
      journalEntryId: posted.journalEntryId,
      memo: input.memo ?? null,
      memoAr: input.memoAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "notes.note_collected",
      entityType: "note",
      entityId: note.id,
      actorId: input.actorId ?? undefined,
      before: { status: note.status },
      after: {
        status: "COLLECTED",
        journalEntryId: posted.journalEntryId,
        entryNo: posted.entryNo,
        movement: { direction: note.direction === "RECEIVED" ? "IN" : "OUT", baseAmount: cashBase, rate: r1 },
      },
    });
    invalidatePdcCalendar();
    return { note: updated, event, journalEntryId: posted.journalEntryId };
  }
}

// -- shared helpers -------------------------------------------------------------------

async function requireNote(id: string): Promise<NoteRow> {
  const note = await findNoteById(id);
  if (note === undefined) {
    throw new NoteNotFoundError(id);
  }
  return note;
}

async function requireAccount(accountId: string | null, note: NoteRow): Promise<CashAccountRow> {
  if (accountId === null || accountId === undefined || accountId === "") {
    throw new NoteAccountRequiredError({ noteId: note.id, action: "money leg" });
  }
  const account = await findCashAccountById(accountId);
  if (account === undefined) {
    throw new NoteCashAccountNotFoundError(accountId);
  }
  if (account.status !== "ACTIVE") {
    throw new NoteCashAccountNotFoundError(accountId);
  }
  if (account.currencyCode !== note.currency) {
    throw new NoteAccountCurrencyMismatchError({
      noteId: note.id,
      noteCurrency: note.currency,
      accountCurrency: account.currencyCode,
    });
  }
  return account;
}

function moneyBase(amount: string, rate: string): string {
  return new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4).toFixed(4);
}

function baseSub(a: string, b: string): string {
  return new Decimal(a).minus(new Decimal(b)).toDecimalPlaces(4).toFixed(4);
}
