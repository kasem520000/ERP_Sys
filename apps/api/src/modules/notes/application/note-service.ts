import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { invalidatePdcCalendar } from "./pdc-calendar-queries";
import {
  findNoteById,
  insertNoteEvent,
  listNoteEventsByNote,
  listNotes,
  updateNoteMetadata,
  type NoteEventRow,
  type NoteRow,
} from "../infrastructure/notes.store";
import {
  NoteFieldsImmutableError,
  NoteNotFoundError,
} from "../domain/notes-errors";

/**
 * PHASE-027 T2 — the note register surface: list/get (the register + the
 * custody timeline) and RECLASSIFY (BR-047's metadata-correction event — no
 * journal, no custody change; the append-only event log records it).
 */
@Injectable()
export class NoteService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async listNotes(filter: {
    kind?: string;
    direction?: string;
    status?: string;
    partnerId?: string;
    maturityFrom?: string;
    maturityTo?: string;
    limit: number;
  }): Promise<NoteRow[]> {
    return listNotes(filter);
  }

  async getNote(id: string): Promise<{ note: NoteRow; events: NoteEventRow[] }> {
    const note = await findNoteById(id);
    if (note === undefined) {
      throw new NoteNotFoundError(id);
    }
    return { note, events: await listNoteEventsByNote(id) };
  }

  /**
   * RECLASSIFY (the §3 edit archetype): audited metadata corrections —
   * number/issuing bank/maturity date/notes. Substantive fields
   * (kind/direction/partner/amount/currency/source) are immutable after
   * create: typed NOTE_FIELDS_IMMUTABLE. No journal, no custody change.
   */
  async reclassify(
    id: string,
    patch: {
      number?: string | null;
      issuingBank?: string | null;
      maturityDate?: string;
      note?: string | null;
      noteAr?: string | null;
    },
    immutableAttemptedFields: string[],
    actorId: string | null,
  ): Promise<{ note: NoteRow; event: NoteEventRow }> {
    const existing = await findNoteById(id);
    if (existing === undefined) {
      throw new NoteNotFoundError(id);
    }
    if (immutableAttemptedFields.length > 0) {
      throw new NoteFieldsImmutableError({ noteId: id, fields: immutableAttemptedFields });
    }
    const before = {
      number: existing.number,
      issuingBank: existing.issuingBank,
      maturityDate: existing.maturityDate,
      note: existing.note,
      noteAr: existing.noteAr,
    };
    const updated = await updateNoteMetadata(id, patch);
    if (updated === undefined) {
      throw new NoteNotFoundError(id);
    }
    const eventDate = new Date().toISOString().slice(0, 10);
    const event = await insertNoteEvent({
      noteId: id,
      eventKind: "RECLASSIFY",
      eventDate,
      refs: { before, after: patch },
      journalEntryId: null,
      memo: patch.note ?? null,
      memoAr: patch.noteAr ?? null,
      createdBy: actorId,
    });
    await this.audit.record({
      action: "notes.note_reclassified",
      entityType: "note",
      entityId: id,
      actorId: actorId ?? undefined,
      before,
      after: patch,
    });
    invalidatePdcCalendar();
    return { note: updated, event };
  }
}
