import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { compareExact } from "../../accounting/application/decimal-strings";
import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";
import { PostingService } from "../../accounting/application/posting-service";
import { AuditService } from "../../audit/api/audit";
import { InboxService } from "../../notifications/application/inbox-service";
import {
  findCashAccountById,
  insertCashMovement,
  type CashAccountRow,
} from "../../treasury/infrastructure/treasury.store";
import { effectiveNoteRate, tenantBaseCurrency } from "./note-allocations";
import { invalidatePdcCalendar } from "./pdc-calendar-queries";
import { assertTransition, type CustodyEventKind } from "./custody-machine";
import {
  findControlEntryForJournal,
  findNoteById,
  insertNoteEvent,
  repointNoteAllocations,
  updateNoteStatus,
  type NoteRow,
} from "../infrastructure/notes.store";
import {
  DishonorReasonRequiredError,
  NoteAccountCurrencyMismatchError,
  NoteAccountRequiredError,
  NoteAlreadyResolvedError,
  NoteCashAccountNotFoundError,
  NoteFeeInvalidError,
  NoteNotFoundError,
} from "../domain/notes-errors";

/**
 * PHASE-027 T5/T6 — dishonor (G-26) + return (the restore side without
 * bounce reason/fee). THE REPOINT-RESTORE MECHANIC (the critical bit):
 *
 *   1. Post the restore journal — RECEIVED: `DR AR_CONTROL (partner line —
 *      INV-009(a) forces the partner) · CR NOTES_RECEIVABLE` [+ optional fee
 *      legs: DR BANK_CHARGES fee · CR cash fee]; ISSUED mirror:
 *      `DR NOTES_PAYABLE · CR AP_CONTROL (partner line)`.
 *   2. The engine creates the journal's control debit subledger entry (E3).
 *   3. REPOINT the note's allocations onto E3 (DELETE the note's rows,
 *      INSERT one consolidated row anchored there). The ORIGINAL open item's
 *      outstanding comes back byte-equal (its row is untouched — same id,
 *      partner, amount, original invoice refs); E3 is anchored (outstanding
 *      0) so the aging never double-counts, and partner_balances ties.
 *   4. Custody → DISHONORED/RETURNED (INV-024: zero note balance there);
 *      the treasury fee movement keeps INV-019 exact.
 *
 * On-account notes have no allocations to repoint — the restore journal's
 * partner line then lands as a NEW explicit open item (the honest
 * representation: the debt needs an item to age against; documented).
 *
 * BR-046: dishonor requires a reason; audited + surfaced to the tenant
 * (inbox, category notes — there is no partner-facing channel in this
 * platform; the partner-portal row stays deferred per OQ-007).
 */
@Injectable()
export class DishonorService {
  constructor(
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
  ) {}

  async dishonor(input: {
    noteId: string;
    reason: string;
    bankFee?: string | null;
    cashAccountId?: string | null;
    eventDate: string;
    memo?: string | null;
    memoAr?: string | null;
    actorId: string | null;
  }): Promise<{ note: NoteRow; journalEntryId: string; anchored: boolean }> {
    const note = await requireNote(input.noteId);
    if (note.status === "DISHONORED") {
      throw new NoteAlreadyResolvedError({ noteId: note.id, eventKind: "DISHONOR", status: note.status });
    }
    assertTransition({ noteId: note.id, direction: note.direction, eventKind: "DISHONOR", from: note.status });
    if (input.reason.trim().length === 0) {
      throw new DishonorReasonRequiredError(note.id);
    }
    const { note: updated, journalEntryId, anchored } = await this.restore(
      note,
      "DISHONOR",
      {
        eventDate: input.eventDate,
        bankFee: input.bankFee ?? null,
        cashAccountId: input.cashAccountId ?? null,
        reason: input.reason,
        memo: input.memo ?? null,
        memoAr: input.memoAr ?? null,
        actorId: input.actorId,
      },
    );
    await this.inbox.record({
      category: "notes",
      severity: "warning",
      title: {
        en: "A received note was dishonored — AR restored",
        ar: "ارتداد ورقة قبض — إعادة فتح الذمة",
      },
      body: {
        en: `Note ${note.number ?? note.id} (${note.amount} ${note.currency}, partner ${note.partnerId}, maturity ${note.maturityDate}) was dishonored: "${input.reason}". The original open item is restored exactly (G-26)${input.bankFee != null && compareExact(input.bankFee, "0.0000") !== 0 ? ` with a bank fee of ${input.bankFee}` : ""}.`,
        ar: `ارتداد الورقة ${note.number ?? note.id} (${note.amount} ${note.currency}، الشريك ${note.partnerId}، الاستحقاق ${note.maturityDate}) بسبب: "${input.reason}". أُعيد البند الأصلي كما كان تمامًا (G-26)${input.bankFee != null && compareExact(input.bankFee, "0.0000") !== 0 ? ` مع رسوم بنكية ${input.bankFee}` : ""}.`,
      },
      actionUrl: "/notes",
      dedupeKey: `note-dishonored:${note.id}`,
    });
    return { note: updated, journalEntryId, anchored };
  }

  async returnNote(input: {
    noteId: string;
    eventDate: string;
    memo?: string | null;
    memoAr?: string | null;
    actorId: string | null;
  }): Promise<{ note: NoteRow; journalEntryId: string; anchored: boolean }> {
    const note = await requireNote(input.noteId);
    if (note.status === "RETURNED") {
      throw new NoteAlreadyResolvedError({ noteId: note.id, eventKind: "RETURN", status: note.status });
    }
    assertTransition({ noteId: note.id, direction: note.direction, eventKind: "RETURN", from: note.status });
    return this.restore(note, "RETURN", {
      eventDate: input.eventDate,
      bankFee: null,
      cashAccountId: null,
      reason: null,
      memo: input.memo ?? null,
      memoAr: input.memoAr ?? null,
      actorId: input.actorId,
    });
  }

  /** The shared restore core (dishonor carries reason+fee; return neither). */
  private async restore(
    note: NoteRow,
    eventKind: CustodyEventKind,
    input: {
      eventDate: string;
      bankFee: string | null;
      cashAccountId: string | null;
      reason: string | null;
      memo: string | null;
      memoAr: string | null;
      actorId: string | null;
    },
  ): Promise<{ note: NoteRow; journalEntryId: string; anchored: boolean }> {
    const base = await tenantBaseCurrency();
    const r0 = effectiveNoteRate(note, base);
    const noteBase = moneyBase(note.amount, r0);

    // Optional bank fee (base currency — a bank charge leg; the phase pins
    // BANK_CHARGES for it). Requires a cash account + the OUT movement.
    let fee = "0.0000";
    let feeAccount: CashAccountRow | null = null;
    if (input.bankFee !== null && input.bankFee !== undefined && compareExact(input.bankFee, "0.0000") !== 0) {
      if (compareExact(input.bankFee, "0.0000") < 0) {
        throw new NoteFeeInvalidError({ noteId: note.id, fee: input.bankFee, amount: note.amount });
      }
      if (compareExact(input.bankFee, noteBase) > 0) {
        throw new NoteFeeInvalidError({ noteId: note.id, fee: input.bankFee, amount: note.amount });
      }
      const account = await requireAccount(input.cashAccountId ?? note.cashAccountId, note);
      fee = input.bankFee;
      feeAccount = account;
    }

    const lines: JournalLineSpec[] = [];
    if (note.direction === "RECEIVED") {
      // G-26: DR AR_CONTROL (partner) · CR NOTES_RECEIVABLE [+ fee legs].
      lines.push({
        purpose: "AR_CONTROL",
        direction: "DEBIT",
        amount: noteBase,
        partnerId: note.partnerId,
        memo: {
          en: `Dishonor/return restore — the original open item comes back exactly (G-26, INV-024)${input.reason !== null ? `: ${input.reason}` : ""}`,
          ar: `إعادة فتح الذمة عند الارتداد/الإعادة — البند الأصلي يعود كما كان (G-26، INV-024)${input.reason !== null ? `: ${input.reason}` : ""}`,
        },
      });
      lines.push({
        purpose: "NOTES_RECEIVABLE",
        direction: "CREDIT",
        amount: noteBase,
        memo: {
          en: `Note ${note.number ?? note.id} derecognized on restore`,
          ar: `إطفاء الورقة ${note.number ?? note.id} عند الإعادة`,
        },
      });
    } else {
      // ISSUED mirror: DR NOTES_PAYABLE · CR AP_CONTROL (partner).
      lines.push({
        purpose: "NOTES_PAYABLE",
        direction: "DEBIT",
        amount: noteBase,
        memo: {
          en: `Issued note ${note.number ?? note.id} derecognized on restore`,
          ar: `إطفاء ورقة الدفع ${note.number ?? note.id} عند الإعادة`,
        },
      });
      lines.push({
        purpose: "AP_CONTROL",
        direction: "CREDIT",
        amount: noteBase,
        partnerId: note.partnerId,
        memo: {
          en: `Dishonor/return restore — the AP open item comes back exactly${input.reason !== null ? `: ${input.reason}` : ""}`,
          ar: `إعادة فتح الذمة عند الارتداد/الإعادة — بند الدفع يعود كما كان${input.reason !== null ? `: ${input.reason}` : ""}`,
        },
      });
    }
    if (feeAccount !== null) {
      lines.push({
        purpose: "BANK_CHARGES",
        direction: "DEBIT",
        amount: fee,
        memo: {
          en: "Bank fee on the bounced note (BR-046)",
          ar: "رسوم بنكية على الورقة المرتدة (BR-046)",
        },
      });
      lines.push({
        accountId: feeAccount.accountId,
        direction: "CREDIT",
        amount: fee,
        memo: {
          en: "Bank fee charged to the account (INV-019)",
          ar: "رسوم بنكية مخصومة من الحساب (INV-019)",
        },
      });
    }

    const spec: JournalSpec = {
      source: { docType: "note", docId: note.id, operation: eventKind === "DISHONOR" ? "dishonor" : "return" },
      entryDate: input.eventDate,
      description: {
        en: `Note ${eventKind === "DISHONOR" ? "dishonored" : "returned"} ${note.number ?? note.id} (G-26 restore)`,
        ar: `${eventKind === "DISHONOR" ? "ارتداد" : "إعادة"} الورقة ${note.number ?? note.id} (إعادة G-26)`,
      },
      currency: base,
      lines,
    };
    const posted = await this.posting.post(spec, { postedBy: input.actorId });

    // The fee's treasury movement (INV-019 exact — the fee credit leg's base).
    if (feeAccount !== null) {
      await insertCashMovement({
        cashAccountId: feeAccount.id,
        direction: "OUT",
        amount: fee,
        currencyCode: base,
        exchangeRate: "1",
        baseAmount: fee,
        sourceType: "note",
        sourceId: note.id,
        valueDate: input.eventDate,
        memo: `bank fee on ${eventKind.toLowerCase()}: ${input.reason ?? "return"}`,
      });
    }

    // The repoint-restore: anchor the note's allocations on the new control
    // entry so the ORIGINAL item's outstanding returns byte-equal.
    const controlEntry = await findControlEntryForJournal(posted.journalEntryId);
    let anchored = false;
    let repointed: { removed: { openItemId: string; amount: string }[]; anchoredTo: string | null } = {
      removed: [],
      anchoredTo: null,
    };
    if (controlEntry !== undefined) {
      const result = await repointNoteAllocations(note.id, controlEntry.id, input.actorId);
      anchored = result.anchored !== null;
      repointed = {
        removed: result.removed.map((row) => ({ openItemId: row.openItemId, amount: row.amount })),
        anchoredTo: result.anchored?.openItemId ?? null,
      };
    }

    const status = eventKind === "DISHONOR" ? "DISHONORED" : "RETURNED";
    const updated = (await updateNoteStatus(note.id, status)) ?? note;
    const event = await insertNoteEvent({
      noteId: note.id,
      eventKind: eventKind === "DISHONOR" ? "DISHONOR" : "RETURN",
      eventDate: input.eventDate,
      refs: {
        journalEntryId: posted.journalEntryId,
        entryNo: posted.entryNo,
        reason: input.reason,
        bankFee: fee,
        repointed,
      },
      journalEntryId: posted.journalEntryId,
      memo: input.memo ?? null,
      memoAr: input.memoAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: eventKind === "DISHONOR" ? "notes.note_dishonored" : "notes.note_returned",
      entityType: "note",
      entityId: note.id,
      actorId: input.actorId ?? undefined,
      before: { status: note.status },
      after: {
        status,
        journalEntryId: posted.journalEntryId,
        entryNo: posted.entryNo,
        reason: input.reason,
        bankFee: fee,
        repointed,
      },
    });
    void event;
    invalidatePdcCalendar();
    return { note: updated, journalEntryId: posted.journalEntryId, anchored };
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
    throw new NoteAccountRequiredError({ noteId: note.id, action: "bank fee" });
  }
  const account = await findCashAccountById(accountId);
  if (account === undefined || account.status !== "ACTIVE") {
    throw new NoteCashAccountNotFoundError(accountId);
  }
  // The fee is base-currency; the account must be too.
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
